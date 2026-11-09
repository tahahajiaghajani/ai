// Access in event management: a requester sees nothing of it; an agent reads alerts and acts only on its team's (the
// module's authority over the alerts it names: assignee, responders, team members); an auditor reads and never acts;
// the seeded operations roles; need-to-know confines agents to their teams' alerts while a paged responder of another
// team still reads the alert; key hashes stay hidden; rotating a key revokes the old one; seeds are idempotent.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";
import { seedEventDefaults } from "@server/modules/event";

let w: EventWorld;
type Row = Record<string, any>;
let netAlert = "";
let dbAlert = "";
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 100 })).rows as Row[];

beforeAll(async () => {
  w = await eventWorld();
  const s = await w.source({ name: "دسترسی" });
  await w.send(s.key, [
    { title: "سوییچ لبه قطع شد", host: "sw-a1", severity: "minor", check: "ping", event_id: "a1" },
    { title: "پایگاه داده کند است", host: "db01", severity: "minor", check: "latency", event_id: "a2" },
  ]);
  await w.drain();
  const alerts = await q("alert", { f: "source_id", op: "eq", v: s.id });
  netAlert = alerts.find((a) => a.node === "sw-a1")!.id;
  dbAlert = alerts.find((a) => a.node === "db01")!.id;
}, 120_000);

describe("who reads and who acts", () => {
  it("keeps requesters out", async () => {
    await w.p.req.client.get(`${w.P}/event/console`, 403);
    await w.p.req.client.get(`${w.P}/r/alert`, 403);
    await w.p.req.client.post(`${w.P}/event/alerts/${netAlert}/ack`, {}, 404);
  });

  it("lets an agent act on its team's alerts only, and an auditor only read", async () => {
    const view = await w.p.other.client.get(`${w.P}/event/console`);
    const all = [...view.alerts, ...view.groups.flatMap((g: Row) => g.alerts)];
    expect(all.find((a: Row) => a.id === netAlert)?.can_respond).toBe(false);
    expect(all.find((a: Row) => a.id === dbAlert)?.can_respond).toBe(true);
    await w.p.other.client.post(`${w.P}/event/alerts/${netAlert}/ack`, {}, 403);
    const acked = await w.p.other.client.post(`${w.P}/event/alerts/${dbAlert}/take`, {});
    expect(acked.row).toMatchObject({ assigned_to: w.p.other.userId, state: "acknowledged" });
    // handing it to a colleague; never to someone outside the organisation
    const handed = await w.p.other.client.post(`${w.P}/event/alerts/${dbAlert}/assign`, { user_id: w.p.mgr.userId });
    expect(handed.row.assigned_to).toBe(w.p.mgr.userId);
    await w.p.other.client.post(`${w.P}/event/alerts/${dbAlert}/assign`, { user_id: "00000000-0000-4000-8000-000000000000" }, 400);
    await w.p.auditor.client.get(`${w.P}/event/console`);
    await w.p.auditor.client.post(`${w.P}/event/alerts/${netAlert}/ack`, {}, 403);
    // the generic API still asks the provider: an agent has no write in area event
    await w.p.agent.client.patch(`${w.P}/r/alert/${netAlert}`, { description: "یادداشت" }, 403);
  });

  it("gives the seeded operations engineer write on its team's alerts and the manager the definitions", async () => {
    await w.p.ops.client.patch(`${w.P}/r/alert/${netAlert}`, { tags: ["بررسی"] });
    await w.p.ops.client.post(`${w.P}/r/event_rule`, { name: "x", action: "ignore" }, 403);
    await w.p.mgr.client.post(`${w.P}/r/event_rule`, { name: "قاعدهٔ مدیر", action: "ignore", condition: { f: "message", op: "contains", v: "noise" } });
  });

  it("hides key hashes and revokes a rotated key", async () => {
    const s = await w.source({ name: "کلید" });
    const asAgent = (await w.p.agent.client.get(`${w.P}/r/event_source/${s.id}`)).row;
    expect(asAgent.token_hash).toBeUndefined();
    expect(asAgent.token_hint).toMatch(/^…/);
    expect((await w.send(s.key, { title: "x", event_id: "k1" })).status).toBe(202);
    const next = await w.o.post(`${w.P}/event/sources/${s.id}/key`, {});
    expect(next.key).not.toBe(s.key);
    expect((await w.send(s.key, { title: "x", event_id: "k2" })).status).toBe(401);
    expect((await w.send(next.key, { title: "x", event_id: "k3" })).status).toBe(202);
    await w.p.agent.client.post(`${w.P}/event/sources/${s.id}/key`, {}, 403);
  });
});

describe("need to know", () => {
  it("confines agents to their teams' alerts; a paged responder of another team still reads the alert", async () => {
    await w.o.put(`${w.P}/access/settings`, { preset: "need_to_know", domain_separation: false });
    await w.p.other.client.get(`${w.P}/r/alert/${netAlert}`, 404);
    const policy = (await w.o.post(`${w.P}/r/escalation_policy`, { name: "فراخوان بیرونی", repeat_times: 0 })).row.id;
    await w.o.post(`${w.P}/r/escalation_level`, { policy_id: policy, level: 1, delay_minutes: 0, target: "users", users: [w.p.other.userId], channels: ["in_app"] });
    await w.o.post(`${w.P}/r/alert_route`, { name: "بیرونی", sort_order: 0, condition: { f: "node", op: "eq", v: "sw-b2" }, escalation_policy_id: policy });
    const s = await w.source({ name: "بیرونی" });
    const sent = await w.send(s.key, { title: "سوییچ ب۲", host: "sw-b2", severity: "major", check: "ping", event_id: "b2" });
    expect(sent.status).toBe(202);
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    expect(a.assignment_group_id).toBe(w.g.network);
    const seen = await w.p.other.client.get(`${w.P}/r/alert/${a.id}`);
    expect(seen.row.responders).toContain(w.p.other.userId);
    expect(seen.meta.event.can_respond).toBe(true);
    await w.p.other.client.post(`${w.P}/event/alerts/${a.id}/ack`, {});
    await w.o.put(`${w.P}/access/settings`, { preset: "open", domain_separation: false });
  });
});

describe("seed", () => {
  it("is idempotent and re-adds what was deleted when forced", async () => {
    const again = await seedEventDefaults(w.e.cfg, w.e.org);
    expect(again.skipped).toBe(true);
    const forced = await seedEventDefaults(w.e.cfg, w.e.org, { force: true });
    expect(forced.created).toEqual({});
    const [rule] = await q("correlation_rule", { f: "name", op: "eq", v: "هشدارهای یک خدمت" });
    await w.o.del(`${w.P}/r/correlation_rule/${rule.id}`);
    const back = await seedEventDefaults(w.e.cfg, w.e.org, { force: true });
    expect(back.created).toEqual({ correlation_rule: 1 });
    const roles = (await w.o.get(`${w.P}/access/roles`)).roles as Row[];
    expect(roles.map((r) => r.key)).toEqual(expect.arrayContaining(["ops_engineer", "ops_manager"]));
  });
});

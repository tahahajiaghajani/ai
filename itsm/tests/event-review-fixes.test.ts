// Regressions of the event and on-call review: concurrent runs process a pending event once; duplicate deliveries
// keep a source's heartbeat; flapping ends while the alert still fires; a re-opened alert inside maintenance waits
// there; ingestion is limited per source, not per client address; the on-call block follows the recipient's access;
// secret labels never reach tags; Z on a group row snoozes; group actions act per member with the caller's access, and
// a group's summary and causes reach a reader only as far as they may read.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";
import { processPending, resetIngestThrottle, sweep } from "@server/modules/event";
import { renderBlocks } from "@server/modules/notify/blocks";
import { updateIn } from "@server/engine";
import { resetRateLimits } from "@server/http/ratelimit";
import { tableDef } from "@shared/tables";
import { normalize, scrubSecrets, stillFlapping } from "@shared/event/logic";
import { groupPlan } from "../src/ui/modules/event/model";

let w: EventWorld;
type Row = Record<string, any>;
const q = async (table: string, filter: unknown, fields?: string[]) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 100, ...(fields ? { fields } : {}) })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
/** the status a request ended with (the client throws on anything but the expected status) */
const code = (p: Promise<unknown>) => p.then(() => 200, (e: Error) => Number(/→ (\d{3})/.exec(String(e.message))?.[1] ?? 0));
const sysWrite = (table: string, id: string, data: Row) => w.sys.write((tx) => updateIn(tx, w.sys, table, id, data, { trusted: true, keepVersion: true }));

beforeAll(async () => {
  w = await eventWorld();
}, 120_000);

describe("processing", () => {
  it("processes a pending event once when two runs read it at the same time (one alert, counted once)", async () => {
    const s = await w.source({ name: "هم‌زمان" });
    expect((await w.send(s.key, { title: "صف پر شد", host: "q-1", severity: "major", event_id: "cc-1" })).status).toBe(202);
    const deadline = Date.now() + 60_000;
    const [a, b] = await Promise.all([processPending(w.e.cfg as never, w.e.org, deadline), processPending(w.e.cfg as never, w.e.org, deadline)]);
    expect(a.processed + b.processed).toBe(1);
    const alerts = await q("alert", { f: "source_id", op: "eq", v: s.id }, ["event_count", "state"]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].event_count).toBe(1);
    expect((await q("event", { f: "source_id", op: "eq", v: s.id }, ["outcome"]))[0].outcome).toBe("created");
    await w.drain();
  });

  it("counts a delivery of duplicates only as the source's activity (no heartbeat alarm while a Watchdog repeats)", async () => {
    const s = await w.source({ name: "نگهبان", heartbeat_minutes: 5 });
    const watchdog = { title: "Watchdog", host: "prom-1", severity: "info", event_id: "wd-1" };
    expect((await w.send(s.key, watchdog)).body.accepted).toBe(1);
    await w.drain();
    // ten minutes on, the tool only repeats the same alert
    await sysWrite("event_source", s.id, { last_event_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    resetIngestThrottle();
    expect((await w.send(s.key, watchdog)).body).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(Date.parse((await one("event_source", s.id)).last_event_at)).toBeGreaterThan(Date.now() - 60_000);
    await sweep(w.sys);
    expect(await q("alert", { f: "fingerprint", op: "eq", v: `heartbeat:${s.id}` })).toHaveLength(0);
  });

  it("takes a flapping alert back to open once its flips aged out while it still fires (next event, and the sweep)", async () => {
    expect(stillFlapping([0, 1000, 2000, 3000], 4000, 60_000, 4)).toBe(true);
    expect(stillFlapping([0, 1000, 2000, 3000], 3600_000, 60_000, 4)).toBe(false);
    const s = await w.source({ name: "نوسان WAN" });
    const fire = (host: string, id: string) => w.send(s.key, { title: "پیوند WAN قطع است", host, check: "wan", severity: "major", event_id: id });
    const clear = (host: string, id: string) => w.send(s.key, { title: "پیوند WAN قطع است", host, check: "wan", status: "ok", event_id: id });
    for (const host of ["wan-1", "wan-2"]) {
      await fire(host, `${host}-f0`);
      await w.drain();
      for (let i = 0; i < 4; i++) {
        await clear(host, `${host}-c${i}`);
        await w.drain();
        await fire(host, `${host}-f${i + 1}`);
        await w.drain();
      }
    }
    const alerts = await q("alert", { f: "source_id", op: "eq", v: s.id }, ["state", "node"]);
    expect(alerts.map((a) => a.state)).toEqual(["flapping", "flapping"]);
    // three hours on: the flips are out of the flap window, the link is still down
    const old = Date.now() - 3 * 3600_000;
    for (const a of alerts) await sysWrite("alert", a.id, { flips: [old, old + 60_000, old + 120_000, old + 180_000] });
    const wan1 = alerts.find((a) => a.node === "wan-1")!;
    const wan2 = alerts.find((a) => a.node === "wan-2")!;
    await fire("wan-1", "wan-1-hard");
    await w.drain();
    expect((await one("alert", wan1.id)).state).toBe("open");
    expect((await one("alert", wan2.id)).state).toBe("flapping");
    const r = await sweep(w.sys);
    expect(r.flapping_ended).toBeGreaterThanOrEqual(1);
    expect((await one("alert", wan2.id)).state).toBe("open");
  });

  it("re-opens a recently cleared alert into maintenance when its CI is inside a window (no paging)", async () => {
    const ci = (await w.o.post(`${w.P}/r/ci`, { name: "db-m2", class: "server", state: "operational", hostname: "db-m2", support_group_id: w.g.network })).row.id as string;
    const s = await w.source({ name: "نگهداری پس از رفع" });
    await w.send(s.key, { title: "db-m2 در دسترس نیست", host: "db-m2", severity: "critical", event_id: "rm-1" });
    await w.drain();
    await w.send(s.key, { title: "db-m2 در دسترس نیست", host: "db-m2", status: "ok", event_id: "rm-2" });
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id }, ["state"]);
    expect(a.state).toBe("cleared");
    const pages = (await q("page", { f: "alert_id", op: "eq", v: a.id })).length;
    const now = Date.now();
    await w.o.post(`${w.P}/r/change_window`, { name: "نگهداری db-m2", kind: "maintenance", start_at: new Date(now - 600_000).toISOString(), end_at: new Date(now + 3600_000).toISOString(), cis: [ci] });
    await w.send(s.key, { title: "db-m2 در دسترس نیست", host: "db-m2", severity: "critical", event_id: "rm-3" });
    await w.drain();
    const back = await one("alert", a.id);
    expect(back.state).toBe("maintenance");
    expect(back.maintenance_window_id).toBeTruthy();
    expect((await q("page", { f: "alert_id", op: "eq", v: a.id })).length).toBe(pages);
  });
});

describe("ingestion limits", () => {
  it("limits a source by its own rate, not by the client's address; wrong keys are limited per client", async () => {
    resetRateLimits();
    const s = await w.source({ name: "زبیکس پرکار", rate_limit: 600 });
    const codes: number[] = [];
    for (let i = 0; i < 130; i++) codes.push((await w.send(s.key, { title: "سوییچ هسته قطع است", host: "core-sw", severity: "critical", event_id: "storm-1" })).status);
    expect(codes.filter((c) => c === 429)).toHaveLength(0);
    const bad: number[] = [];
    for (let i = 0; i < 125; i++) bad.push((await w.send("ev_notarealkeynotarealkeynotarealkey", { title: "x" })).status);
    try {
      expect(bad.slice(0, 120).every((c) => c === 401)).toBe(true);
      expect(bad.slice(120).every((c) => c === 429)).toBe(true);
      // a good key from the same address is not held back by the wrong ones
      expect((await w.send(s.key, { title: "سوییچ هسته قطع است", host: "core-sw", severity: "critical", event_id: "storm-2" })).status).toBe(202);
    } finally {
      resetRateLimits();
    }
    await w.drain();
  });
});

describe("the on-call template block", () => {
  it("names who is on call only for recipients who may read the team's on-call schedules", async () => {
    const def = tableDef("incident")!;
    const input = async (userId: string) => ({ ctx: await w.e.ctxOf(userId), def, id: "00000000-0000-4000-8000-000000000001", row: { assignment_group_id: w.g.network }, event: "custom", link: (p: string) => p });
    const staff = await renderBlocks(["block.oncall"], await input(w.p.agent.userId));
    expect(staff.get("block.oncall")?.markdown ?? "").toContain("کشیک فعلی");
    const requester = await renderBlocks(["block.oncall"], await input(w.p.req.userId));
    expect(requester.get("block.oncall")?.markdown ?? "").toBe("");
  });
});

describe("secrets in events", () => {
  it("masks secret-named labels in tags and the secrets inside the text", () => {
    const [am] = normalize({ kind: "alertmanager" }, {
      alerts: [{ status: "firing", labels: { alertname: "Down", env: "prod", token: "ghp_abcdefghijklmnop", instance: "web1:9100" }, annotations: { summary: "اتصال به postgres://app:S3cretPw@db01:5432/app ناموفق بود", description: "login with password=hunter2 rejected" }, startsAt: "2026-11-09T08:00:00Z", fingerprint: "s1" }],
    }).events;
    expect(am.tags).toContain("env=prod");
    expect(am.tags).toContain("token=***");
    expect(JSON.stringify(am.tags)).not.toContain("ghp_");
    expect(am.message).not.toContain("S3cretPw");
    expect(am.description).not.toContain("hunter2");
    expect((am.payload as Row).labels.token).toBe("***");
    const [gen] = normalize({ kind: "generic" }, { title: "x", host: "h", event_id: "g", tags: { api_key: "k-123456", team: "net" } }).events;
    expect(gen.tags).toEqual(expect.arrayContaining(["api_key=***", "team=net"]));
    expect(scrubSecrets("Authorization: Bearer abcdefghijklmnopqrstuv")).not.toContain("abcdefghijklmnopqrstuv");
    expect(scrubSecrets("دیسک db01 پر شد")).toBe("دیسک db01 پر شد");
  });
});

describe("the console's keys on a group row", () => {
  const alert = (id: string, state: string, can = true) => ({ id, state, can_respond: can }) as never;
  it("snoozes the group's open alerts the caller may act on with Z; never acknowledges in its place", () => {
    const g = { alerts: [alert("a1", "open"), alert("a2", "acknowledged"), alert("a3", "open", false), alert("a4", "cleared")] };
    expect(groupPlan(g, "snooze")).toEqual({ kind: "bulk", action: "snooze", ids: ["a1", "a2"], minutes: 60 });
    expect(groupPlan(g, "ack")).toEqual({ kind: "group", action: "ack" });
    expect(groupPlan(g, "take")).toEqual({ kind: "group", action: "take" });
    expect(groupPlan(g, "assign")).toBeNull();
    expect(groupPlan({ alerts: [alert("a5", "cleared")] }, "snooze")).toBeNull();
  });
});

describe("correlated groups across teams under «نیاز به دانستن»", () => {
  it("acts only on the members the caller may read and act on, and shows only what they may read", async () => {
    await w.o.put(`${w.P}/access/settings`, { preset: "need_to_know", domain_separation: false });
    // the database team pages its own people: without a policy of its own, its alert would page the network on-call
    // through the organisation's default policy, and whose turn that is depends on the day the test runs
    const dbPolicy = (await w.o.post(`${w.P}/r/escalation_policy`, { name: "ارتقای پایگاه داده", group_id: w.g.db, is_default: true, repeat_times: 0 })).row.id as string;
    await w.o.post(`${w.P}/r/escalation_level`, { policy_id: dbPolicy, level: 1, delay_minutes: 0, target: "group", target_group_id: w.g.db, channels: ["in_app"] });
    const host = (await w.o.post(`${w.P}/r/ci`, { name: "srv-x1", class: "server", state: "operational", hostname: "srv-x1", support_group_id: w.g.db })).row.id as string;
    const app = (await w.o.post(`${w.P}/r/ci`, { name: "سامانهٔ انبار", class: "business_application", state: "operational", criticality: "1", support_group_id: w.g.network })).row.id as string;
    await w.o.post(`${w.P}/r/ci_rel`, { parent_id: app, type: "depends_on", child_id: host });
    const s = await w.source({ name: "میان‌تیمی" });
    await w.send(s.key, { title: "سرور srv-x1 در دسترس نیست SECRETDB", host: "srv-x1", severity: "critical", check: "ping", event_id: "x1" });
    await w.drain();
    await w.send(s.key, { title: "انبار خطا می‌دهد", ci: "سامانهٔ انبار", host: "inv-app", severity: "major", check: "http", event_id: "x2" });
    await w.drain();
    const alerts = await q("alert", { f: "source_id", op: "eq", v: s.id }, ["ci_id", "group_id", "number", "state"]);
    expect(alerts).toHaveLength(2);
    const dbAlert = alerts.find((a) => a.ci_id === host)!;
    const gid = dbAlert.group_id as string;
    expect(gid).toBeTruthy();
    expect(alerts.every((a) => a.group_id === gid)).toBe(true);
    const group = await one("alert_group", gid);
    expect(group.assignment_group_id).toBe(w.g.network);
    expect(group.summary).toContain("SECRETDB");
    // the network agent may not read the database team's alert …
    await w.p.agent.client.get(`${w.P}/r/alert/${dbAlert.id}`, 404);
    // … nor its title or number through the group
    const seen = (await w.p.agent.client.get(`${w.P}/r/alert_group/${gid}`)).row;
    expect(JSON.stringify(seen)).not.toContain("SECRETDB");
    expect(JSON.stringify(seen)).not.toContain(String(dbAlert.number));
    const listed = (await w.p.agent.client.post(`${w.P}/r/alert_group/query`, { filter: { f: "id", op: "eq", v: gid }, fields: ["summary", "probable_causes", "title"] })).rows;
    expect(JSON.stringify(listed)).not.toContain("SECRETDB");
    // closing the group closes their own alert only
    const closed = await w.p.agent.client.post(`${w.P}/event/groups/${gid}/close`, { close_code: "fixed" });
    expect(closed).toMatchObject({ done: 1, skipped: 1, failed: [] });
    expect((await one("alert", dbAlert.id)).state).not.toBe("closed");
    expect((await one("alert", alerts.find((a) => a.id !== dbAlert.id)!.id)).state).toBe("closed");
    expect((await one("alert_group", gid)).state).not.toBe("closed");
  });
});

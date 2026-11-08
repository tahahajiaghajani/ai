// Change enablement — access: a requester (no change area), an agent of another group (reads, cannot change), an
// auditor (reads everything, changes nothing, decides nothing), a CAB member (reads and votes, cannot edit), the manual
// authorization that only holders of the change area's approve right may take, and need-to-know scoping.
import { describe, expect, it, beforeAll } from "vitest";
import { world, type World } from "./change-helpers";

let w: World;
let change: Record<string, any>;
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });

beforeAll(async () => {
  w = await world();
  change = await w.change(manual("moderate"));
}, 120_000);

describe("a requester", () => {
  it("has no access to changes or the module's screens", async () => {
    const { P, p } = w;
    await p.req.client.get(`${P}/r/change_request/${change.id}`, 404);
    const list = await p.req.client.post(`${P}/r/change_request/query`, {}, 403).catch(async () => p.req.client.post(`${P}/r/change_request/query`, {}));
    if (list?.rows) expect(list.rows.length).toBe(0);
    await p.req.client.post(`${P}/r/change_request`, { short_description: "تغییر من", type: "normal" }, 403);
    await p.req.client.get(`${P}/change/dashboard`, 403);
    await p.req.client.get(`${P}/change/meta`, 403);
    await p.req.client.get(`${P}/change/records/${change.id}/risk`, 404);
    await p.req.client.post(`${P}/change/seed`, {}, 403);
  });
});

describe("an agent of another group", () => {
  it("reads the change but cannot change it, move it or act on it", async () => {
    const { P, p } = w;
    const r = (await p.other.client.get(`${P}/r/change_request/${change.id}`)).row;
    expect(r.number).toBe(change.number);
    await p.other.client.patch(`${P}/r/change_request/${change.id}`, { description: "ویرایش", version: r.version }, 403);
    await p.other.client.post(`${P}/r/change_request/${change.id}/transition`, { to: "assess", version: r.version }, 403);
    await p.other.client.post(`${P}/change/records/${change.id}/hold`, { reason: "vendor" }, 403);
    await p.other.client.post(`${P}/change/records/${change.id}/conflicts/check`, {}, 403);
    await p.other.client.put(`${P}/change/records/${change.id}/risk`, { answers: {} }, 403);
  });
});

describe("an auditor", () => {
  it("reads changes, the calendar and the dashboard but creates, changes and decides nothing", async () => {
    const { P, p } = w;
    expect((await p.auditor.client.get(`${P}/r/change_request/${change.id}`)).row.id).toBe(change.id);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect((await p.auditor.client.get(`${P}/change/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).changes.length).toBeGreaterThan(0);
    expect((await p.auditor.client.get(`${P}/change/dashboard`)).kpis.total).toBeGreaterThan(0);
    await p.auditor.client.post(`${P}/r/change_request`, { short_description: "x", type: "normal" }, 403);
    const r = (await p.auditor.client.get(`${P}/r/change_request/${change.id}`)).row;
    await p.auditor.client.patch(`${P}/r/change_request/${change.id}`, { description: "x", version: r.version }, 403);
    await p.auditor.client.post(`${P}/change/records/${change.id}/copy`, {}, 403);
    const cab = (await w.o.get(`${P}/r/cab?size=5`)).rows.find((c: any) => c.kind === "change");
    await p.auditor.client.post(`${P}/change/cab/${cab.id}/next`, {}, 403);
    const evidence = await p.auditor.client.get(`${P}/change/records/${change.id}/evidence`);
    expect(evidence.markdown).toContain(String(change.number));
  });
});

describe("CAB members and change managers", () => {
  it("a CAB member reads and votes but does not edit; an agent cannot authorize by hand; a change manager can", async () => {
    const { P, p } = w;
    const c = await w.change(manual("high"));
    let row = await w.move(c.id, ["assess", "authorize"]);
    await p.cab1.client.patch(`${P}/r/change_request/${c.id}`, { description: "ویرایش", version: row.version }, 403);
    await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "scheduled", version: row.version }, 403);
    row = await w.get(c.id, p.cm.client);
    const done = (await p.cm.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "scheduled", version: row.version })).row;
    expect(done.state).toBe("scheduled");
    const approvals = await w.approvals(c.id);
    expect(approvals.every((a) => a.state === "no_longer_required")).toBe(true);
    const journal = (await w.o.get(`${P}/r/change_request/${c.id}/journal?kinds=system`)).entries;
    expect(journal.some((e: any) => String(e.body).includes("دارندهٔ اختیار تأیید"))).toBe(true);
  });
});

describe("need to know", () => {
  it("agents read only their groups' changes", async () => {
    const { P, o, p } = w;
    await o.put(`${P}/access/settings`, { preset: "need_to_know", domain_separation: false });
    await p.other.client.get(`${P}/r/change_request/${change.id}`, 404);
    expect((await p.agent.client.get(`${P}/r/change_request/${change.id}`)).row.id).toBe(change.id);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const cal = await p.other.client.get(`${P}/change/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(cal.changes.some((x: any) => x.id === change.id)).toBe(false);
  });

  it("an approver outside the change's groups reads it only while their approval is open", async () => {
    const { P, o, p } = w;
    const c = await w.change(manual("moderate"));
    await w.move(c.id, ["assess", "authorize"]);
    await p.other.client.get(`${P}/r/change_request/${c.id}`, 404);
    await o.post(`${P}/approvals/record/change_request/${c.id}/request`, { users: [p.other.userId] });
    expect((await p.other.client.get(`${P}/r/change_request/${c.id}`)).row.id).toBe(c.id);
    const mine = (await p.other.client.get(`${P}/approvals/mine?scope=pending`)).approvals.find((a: any) => a.record_id === c.id);
    await p.other.client.post(`${P}/approvals/${mine.id}/decide`, { decision: "approved" });
    await p.other.client.get(`${P}/r/change_request/${c.id}`, 404);
  });
});

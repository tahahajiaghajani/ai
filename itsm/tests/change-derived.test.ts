// Change enablement — what is made from a change keeps its confidentiality (review findings): copies, child changes,
// tasks (the backout task too) and the post-implementation review of a confidential change; «ثبت تغییر» from a record
// of a secure workspace or a restricted group; rows hanging off a change (tasks, reviews, outages, agenda items) only
// from people who work it, and only the change's own review writes its lessons.
import { describe, expect, it, beforeAll } from "vitest";
import { world, type World } from "./change-helpers";

let w: World;
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });
const filterOf = (f: string, v: string) => encodeURIComponent(JSON.stringify({ f, op: "eq", v }));

beforeAll(async () => {
  w = await world();
}, 120_000);

describe("a confidential change", () => {
  it("its copies, children, tasks, backout task and review are confidential too", async () => {
    const { P, p } = w;
    const c = await w.change({ ...manual("moderate"), short_description: "بستن درگاه نفوذ سامانهٔ حقوق", confidential: true, access_list: [p.cm.userId] });
    await p.other.client.get(`${P}/r/change_request/${c.id}`, 404);
    const [copy] = (await p.agent.client.post(`${P}/change/records/${c.id}/copy`, {})).changes;
    const [kid] = (await p.agent.client.post(`${P}/change/records/${c.id}/children`, { titles: ["سرور اول"] })).changes;
    for (const id of [copy.id, kid.id]) {
      const r = await w.get(id, p.agent.client);
      expect(r.confidential).toBe(true);
      expect(r.access_list).toContain(p.cm.userId);
      await p.other.client.get(`${P}/r/change_request/${id}`, 404);
    }
    const task = (await p.agent.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "بستن درگاه" })).row;
    expect(task.confidential).toBe(true);
    await p.other.client.get(`${P}/r/change_task/${task.id}`, 404);
    // the task cannot be made public while its change is confidential
    const opened = (await p.agent.client.patch(`${P}/r/change_task/${task.id}`, { confidential: false, version: task.version })).row;
    expect(opened.confidential).toBe(true);
    // the review: its title names the change
    const { pir } = await p.agent.client.post(`${P}/change/records/${c.id}/pir`, {});
    expect(pir.confidential).toBe(true);
    await p.other.client.get(`${P}/r/change_pir/${pir.id}`, 404);
    expect((await p.other.client.get(`${P}/r/change_pir?size=50`)).rows.some((r: any) => r.id === pir.id)).toBe(false);
    expect((await p.cm.client.get(`${P}/r/change_pir/${pir.id}`)).row.id).toBe(pir.id);
    // the backout task of the implementation
    await w.move(c.id, ["assess", "authorize"]);
    const [a] = (await p.cm.client.get(`${P}/approvals/record/change_request/${c.id}`)).approvals;
    await p.cm.client.post(`${P}/approvals/${a.id}/decide`, { decision: "approved" });
    await w.move(c.id, ["implement"]);
    await p.agent.client.post(`${P}/change/records/${c.id}/backout`, { note: "خطای پیکربندی" });
    const backout = (await p.agent.client.get(`${P}/r/change_task?filter=${filterOf("task_type", "backout")}`)).rows.find((t: any) => t.change_id === c.id);
    expect(backout.confidential).toBe(true);
    await p.other.client.get(`${P}/r/change_task/${backout.id}`, 404);
    // no longer confidential: its tasks and review follow
    const now = await w.get(c.id, p.agent.client);
    await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { confidential: false, version: now.version });
    expect((await p.other.client.get(`${P}/r/change_task/${task.id}`)).row.confidential).toBe(false);
    expect((await p.other.client.get(`${P}/r/change_pir/${pir.id}`)).row.confidential).toBe(false);
  });
});

describe("«ثبت تغییر» from a protected record", () => {
  it("stays in the record's secure workspace and keeps its restricted group", async () => {
    const { P, p, o } = w;
    const ws = (await o.post(`${P}/r/workspace`, { key: "sec", name: "امنیت", secure: true })).row.id;
    await o.put(`${P}/access/members/${p.agent.userId}`, { roles: ["agent"], workspaces: [ws] });
    const todo = (await p.agent.client.post(`${P}/r/todo`, { short_description: "وصلهٔ فوری سامانهٔ امن", description: "جزئیات آسیب‌پذیری", workspace_id: ws })).row;
    await p.other.client.get(`${P}/r/todo/${todo.id}`, 404);
    const change = (await p.agent.client.post(`${P}/change/from/todo/${todo.id}`, { assignment_group_id: w.g.network })).row;
    expect(change.workspace_id).toBe(ws);
    await p.other.client.get(`${P}/r/change_request/${change.id}`, 404);
    // a restricted group: the change stays with it
    const closed = (await o.post(`${P}/r/group`, { name: "تیم واکنش امنیتی", types: ["assignment"], restricted: true })).row.id;
    await o.post(`${P}/access/groups/${closed}/members`, { user_ids: [p.agent.userId] });
    const quiet = (await p.agent.client.post(`${P}/r/todo`, { short_description: "بررسی نشت داده", assignment_group_id: closed })).row;
    await p.agent.client.post(`${P}/change/from/todo/${quiet.id}`, { assignment_group_id: w.g.network }, 400);
    const kept = (await p.agent.client.post(`${P}/change/from/todo/${quiet.id}`, {})).row;
    expect(kept.assignment_group_id).toBe(closed);
    await p.other.client.get(`${P}/r/change_request/${kept.id}`, 404);
  });
});

describe("rows of a change", () => {
  it("only people who work the change add tasks, reviews and outages to it; only its own review writes its lessons", async () => {
    const { P, p, o } = w;
    const c = await w.change(manual("moderate"));
    // the open preset: the other group's agent reads the change but does not work it
    await p.other.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "کار من", mandatory: true }, 403);
    await p.other.client.post(`${P}/r/change_pir`, { change_id: c.id, title: "بازبینی من" }, 403);
    await p.other.client.post(`${P}/r/change_outage`, { change_id: c.id, title: "قطعی", starts_at: c.planned_start, ends_at: c.planned_end }, 403);
    // need to know: a change they cannot read answers like one that does not exist
    await o.put(`${P}/access/settings`, { preset: "need_to_know", domain_separation: false });
    await p.other.client.get(`${P}/r/change_request/${c.id}`, 404);
    const hidden = await p.other.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "کار من" }, 400);
    const unknown = await p.other.client.post(`${P}/r/change_task`, { change_id: "0aaaaaaa-0000-4000-8000-000000000000", short_description: "کار من" }, 400);
    expect(hidden.error.details.fields.change_id).toBe(unknown.error.details.fields.change_id);
    await o.put(`${P}/access/settings`, { preset: "open", domain_separation: false });
    expect((await w.o.get(`${P}/r/change_task?filter=${filterOf("change_id", c.id)}`)).rows.length).toBe(0);
    // the implementer adds one
    expect((await p.agent.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "پشتیبان‌گیری" })).row.id).toBeTruthy();
    // a review that is not the change's own does not write its lessons
    const stray = (await o.post(`${P}/r/change_pir`, { change_id: c.id, title: "بازبینی دیگر" })).row;
    await o.post(`${P}/r/change_pir/${stray.id}/transition`, { to: "completed", data: { objectives_met: "yes", lessons: "درس ساختگی" }, version: stray.version });
    const after = await w.get(c.id);
    expect(after.lessons ?? null).toBeNull();
  });
});

// Who may do what in incident management, under the «نیاز به دانستن» preset: a requester (their own incidents, the
// requester's whitelist, confirming with a rating), an agent of another group (the desk's incidents do not exist for
// them, on every path of the module), an auditor (reads, never acts), the restricted security group, and the
// major-incident manager's grant.
import { describe, it, expect, beforeAll } from "vitest";
import { world, type World } from "./incident-helpers";

let w: World;
let own: Record<string, any>;
let desk: Record<string, any>;
beforeAll(async () => {
  w = await world({ preset: "need_to_know" });
  own = await w.incident({ short_description: "لپ‌تاپ من روشن نمی‌شود", category: "hardware", subcategory: "hardware.computer" }, w.p.req.client);
  desk = await w.incident({ short_description: "لپ‌تاپ همکار روشن نمی‌شود", category: "hardware", subcategory: "hardware.computer", caller_id: w.p.req2.userId, assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId });
});

describe("a requester", () => {
  it("reads and creates only their own incidents", async () => {
    expect(own.caller_id).toBe(w.p.req.userId);
    await w.p.req.client.get(`${w.P}/r/incident/${desk.id}`, 404);
    await w.p.req.client.get(`${w.P}/incident/${desk.id}/timeline`, 404);
    await w.p.req.client.get(`${w.P}/incident/${desk.id}/similar`, 404);
    const hits = (await w.p.req.client.get(`${w.P}/incident/${own.id}/similar`)).hits;
    expect(hits.map((h: any) => h.id)).not.toContain(desk.id);
    const d = await w.p.req.client.get(`${w.P}/incident/dashboard`);
    expect(d.open.total).toBe(1);
  });

  it("cannot work the incident: no overlay, escalation, merge, timeline or updates", async () => {
    await w.p.req.client.post(`${w.P}/incident/${own.id}/major`, { action: "propose", reason: "x" }, 403);
    await w.p.req.client.post(`${w.P}/incident/${own.id}/escalate`, { kind: "hierarchical", reason: "x" }, 403);
    await w.p.req.client.post(`${w.P}/incident/${own.id}/merge`, { ids: [desk.id] }, 403);
    await w.p.req.client.post(`${w.P}/incident/${own.id}/timeline`, { kind: "note", title: "x" }, 403);
    await w.p.req.client.post(`${w.P}/incident/${own.id}/updates`, { audience: "affected", subject: "x", body: "y" }, 403);
    await w.p.req.client.post(`${w.P}/incident/${own.id}/related`, { mode: "child" }, 403);
    const r = await w.p.req.client.patch(`${w.P}/r/incident/${own.id}`, { priority: "1" }, 403);
    expect(r.error.code).toBe("forbidden_field");
    await w.p.req.client.patch(`${w.P}/r/incident/${own.id}`, { description: "از دیروز" });
  });

  it("files incidents, not the desk's part: agent fields dropped, «جدید» only, no tasks, reviews or definitions", async () => {
    const r = w.p.req.client;
    const filed = await w.incident({ short_description: "چاپگر طبقهٔ دوم کار نمی‌کند", urgency: "1", impact: "1", priority: "1", assignment_group_id: w.g.network, close_notes: "حل شد", workaround: "خاموش و روشن", bridge_url: "https://meet.example.com/x", escalation: 3, stakeholders: [w.p.req2.userId] }, r);
    const row = (await w.o.get(`${w.P}/r/incident/${filed.id}`)).row;
    // impact is the desk's assessment: urgency 1 × impact 3 → priority 3; the assignment rules pick the group
    expect([row.impact, row.urgency, row.priority, row.assignment_group_id]).toEqual(["3", "1", "3", w.g.desk]);
    expect([row.escalation, row.close_notes, row.workaround, row.bridge_url, row.stakeholders]).toEqual([0, null, null, null, []]);
    expect(row.caller_id).toBe(w.p.req.userId);
    const resolved = await r.post(`${w.P}/r/incident`, { short_description: "x", state: "resolved", close_code: "solved", close_notes: "x" }, 403);
    expect(resolved.error.message).toContain("جدید");
    // tasks and reviews belong to the people working the incident; definitions to their keepers
    await r.post(`${w.P}/r/incident_task`, { incident_id: own.id, short_description: "x" }, 403);
    await r.post(`${w.P}/r/incident_task`, { incident_id: desk.id, short_description: "x" }, 400);
    await r.post(`${w.P}/r/incident_review`, { incident_id: own.id, title: "x" }, 403);
    await r.post(`${w.P}/r/incident_template`, { name: "الگوی من" }, 403);
    await r.post(`${w.P}/r/incident_response`, { name: "پاسخ من", body: "x" }, 403);
  });

  it("confirms a resolution with a rating, or reopens it", async () => {
    await w.p.agent.client.post(`${w.P}/r/incident/${own.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "باتری تعویض شد" } });
    const closed = await w.p.req.client.post(`${w.P}/r/incident/${own.id}/transition`, { to: "closed", data: { satisfaction: 5, satisfaction_comment: "سریع بود" } });
    expect([closed.row.state, closed.row.satisfaction]).toEqual(["closed", 5]);
    // a closed incident: a follow-up is the way back
    const f = await w.p.req.client.post(`${w.P}/incident/${own.id}/related`, { mode: "follow_up" });
    expect(f.row.follow_up_of).toBe(own.id);
    expect(f.row.caller_id).toBe(w.p.req.userId);
  });
});

describe("an agent of another group (need to know)", () => {
  it("never sees the desk's incidents on the module's paths", async () => {
    const other = w.p.other.client;
    await other.get(`${w.P}/r/incident/${desk.id}`, 404);
    await other.get(`${w.P}/incident/${desk.id}/timeline`, 404);
    await other.get(`${w.P}/incident/${desk.id}/readiness`, 404);
    await other.get(`${w.P}/incident/${desk.id}/known-errors`, 404);
    await other.post(`${w.P}/incident/${desk.id}/escalate`, { kind: "hierarchical", reason: "x" }, 404);
    await other.post(`${w.P}/incident/${desk.id}/review`, {}, 404);
    const mine = await w.incident({ short_description: "لپ‌تاپ روشن نمی‌شود", category: "hardware", subcategory: "hardware.computer", assignment_group_id: w.g.network }, other);
    expect((await other.get(`${w.P}/incident/${mine.id}/similar`)).hits.map((h: any) => h.id)).not.toContain(desk.id);
    const r = await other.post(`${w.P}/incident/${mine.id}/merge`, { ids: [desk.id] });
    expect(r.failed.map((x: any) => x.id)).toEqual([desk.id]);
    expect(r.failed[0].message).toContain("پیدا نشد");
  });

  it("the desk's agent works them", async () => {
    const t = await w.p.agent.client.post(`${w.P}/incident/${desk.id}/timeline`, { kind: "note", title: "بررسی شد" });
    expect(t.event.title).toBe("بررسی شد");
    await w.p.agent.client.post(`${w.P}/incident/${desk.id}/major`, { action: "propose", reason: "چند کاربر" });
    // an agent may not declare (no approve grant); a problem manager neither
    await w.p.agent.client.post(`${w.P}/incident/${desk.id}/major`, { action: "declare" }, 403);
    await w.p.pm.client.post(`${w.P}/incident/${desk.id}/major`, { action: "declare" }, 403);
    // a mandatory task of another group blocks the resolution without being shown to the desk's agent
    const hidden = (await w.o.post(`${w.P}/r/incident_task`, { incident_id: desk.id, short_description: "کار محرمانهٔ شبکه", assignment_group_id: w.g.network })).row;
    const ready = await w.p.agent.client.get(`${w.P}/incident/${desk.id}/readiness`);
    expect([ready.open_tasks, ready.tasks]).toEqual([1, []]);
    const refused = await w.p.agent.client.post(`${w.P}/r/incident/${desk.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "x" } }, 409);
    expect(refused.error.message).toContain("1 کار دیگر");
    expect(refused.error.message).not.toContain(hidden.number);
    expect((await w.o.get(`${w.P}/incident/${desk.id}/readiness`)).tasks.map((t: any) => t.number)).toEqual([hidden.number]);
    // the record tells the screens what the caller may do
    const meta = (await w.p.agent.client.get(`${w.P}/r/incident/${desk.id}`)).meta.incident;
    // `ai`: the AI skills the screens may offer (the AI layer registers them when the app is created)
    expect(meta).toEqual({ can_work: true, can_manage_major: false, ai: expect.arrayContaining(["incident.summarize", "incident.draftUpdate"]) });
    expect((await w.p.mim.client.get(`${w.P}/r/incident/${desk.id}`)).meta.incident.can_manage_major).toBe(true);
  });
});

describe("child records and definitions", () => {
  it("tasks are added by those working the incident or problem; templates and responses by their group or a manager", async () => {
    // the other group's agent cannot read the desk's incident (need to know), the desk's agent works it
    await w.p.other.client.post(`${w.P}/r/incident_task`, { incident_id: desk.id, short_description: "x" }, 400);
    const t = await w.p.agent.client.post(`${w.P}/r/incident_task`, { incident_id: desk.id, short_description: "بررسی کابل", assignment_group_id: w.g.network });
    expect(t.row.assignment_group_id).toBe(w.g.network);
    // a template is kept by the group it assigns to, or by a manager
    const mineT = await w.p.agent.client.post(`${w.P}/r/incident_template`, { name: "الگوی میز", assignment_group_id: w.g.desk });
    await w.p.agent.client.patch(`${w.P}/r/incident_template/${mineT.row.id}`, { description_note: "پیش از ثبت، شمارهٔ اموال را بپرسید", version: mineT.row.version });
    await w.p.agent.client.post(`${w.P}/r/incident_template`, { name: "الگوی شبکه", assignment_group_id: w.g.network }, 403);
    await w.p.agent.client.post(`${w.P}/r/incident_template`, { name: "الگوی همگانی" }, 403);
    await w.p.mim.client.post(`${w.P}/r/incident_template`, { name: "الگوی همگانی" });
    // canned responses: the owning group's members or a manager
    await w.p.agent.client.post(`${w.P}/r/incident_response`, { name: "پاسخ میز", body: "سلام", group_id: w.g.desk });
    await w.p.agent.client.post(`${w.P}/r/incident_response`, { name: "پاسخ همگانی", body: "سلام" }, 403);
    // problems: the network group's problem is not the desk agent's to add tasks to
    const prb = (await w.p.pm.client.post(`${w.P}/r/problem`, { short_description: "قطعی‌های پیاپی سوئیچ", assignment_group_id: w.g.network })).row;
    await w.p.agent.client.post(`${w.P}/r/problem_task`, { problem_id: prb.id, short_description: "x" }, 400);
    await w.p.other.client.post(`${w.P}/r/problem_task`, { problem_id: prb.id, short_description: "بررسی لاگ سوئیچ" });
  });
});

describe("an auditor", () => {
  it("reads everything but acts on nothing", async () => {
    const a = w.p.auditor.client;
    await a.get(`${w.P}/r/incident/${desk.id}`);
    expect((await a.get(`${w.P}/incident/${desk.id}/timeline`)).items.length).toBeGreaterThan(0);
    await a.post(`${w.P}/incident/${desk.id}/escalate`, { kind: "hierarchical", reason: "x" }, 403);
    await a.post(`${w.P}/incident/${desk.id}/timeline`, { kind: "note", title: "x" }, 403);
    await a.post(`${w.P}/incident/${desk.id}/major`, { action: "reject", reason: "x" }, 403);
    await a.post(`${w.P}/incident/${desk.id}/merge`, { ids: [own.id] }, 403);
    await a.post(`${w.P}/incident/seed`, {}, 403);
    const meta = (await a.get(`${w.P}/r/incident/${desk.id}`)).meta.incident;
    expect([meta.can_work, meta.can_manage_major]).toEqual([false, false]);
  });
});

describe("security incidents", () => {
  it("are read only by the restricted security group and the people on the record", async () => {
    await w.o.post(`${w.P}/access/groups/${w.g.security}/members`, { user_ids: [w.p.other.userId] });
    const sec = await w.incident({ short_description: "بدافزار روی سرور", security_incident: true, caller_id: w.p.req.userId }, w.p.agent.client);
    await w.p.mim.client.get(`${w.P}/r/incident/${sec.id}`, 404);
    await w.p.auditor.client.get(`${w.P}/r/incident/${sec.id}`, 404);
    await w.p.other.client.get(`${w.P}/r/incident/${sec.id}`);
    await w.p.req.client.get(`${w.P}/r/incident/${sec.id}`);
    // the agent who opened it keeps it as their own record
    await w.p.agent.client.get(`${w.P}/r/incident/${sec.id}`);
  });
});

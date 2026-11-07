// Major incidents end to end: the overlay's actions and who may take them, the custom events the seeded notification
// rules listen to, the war room's timeline (history projection, manual and back-dated events, key flags, promoted
// notes, removal), stakeholder updates and their cadence, the late-update warning of the sweep, and what follows the
// resolution (the review draft, a problem, publishing the review and «بازبینی انجام شد»).
import { describe, it, expect, beforeAll } from "vitest";
import { sweep } from "@server/modules/incident";
import { backdate, world, type World } from "./incident-helpers";

let w: World;
let inc: Record<string, any>;
beforeAll(async () => {
  w = await world();
  inc = await w.incident({ short_description: "قطعی سامانهٔ فروش", impact: "1", urgency: "1", detected_at: new Date(Date.now() - 3600_000).toISOString(), assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId });
});

const major = (as: World["o"], body: Record<string, unknown>, expect = 200) => as.post(`${w.P}/incident/${inc.id}/major`, body, expect);
const row = async () => (await w.o.get(`${w.P}/r/incident/${inc.id}`)).row;
const customEvents = async (kind: string) => (await w.e.db.query<{ payload: any }>(`select payload from sm_jobs where org_id = $1 and kind = $2`, [w.e.org, kind])).map((j) => j.payload);

describe("the overlay", () => {
  it("is a candidate by the criteria; an agent proposes, only a manager declares", async () => {
    expect(inc.major_state).toBe("candidate");
    // the overlay is not changed through the generic API
    await w.p.agent.client.patch(`${w.P}/r/incident/${inc.id}`, { major_state: "accepted" });
    expect((await row()).major_state).toBe("candidate");
    await major(w.p.agent.client, { action: "propose" }, 400);
    await major(w.p.agent.client, { action: "declare" }, 403);
    await major(w.p.agent.client, { action: "propose", reason: "فروش متوقف است" });
    expect((await row()).major_state).toBe("proposed");
    await w.drain();
    expect((await customEvents("record.incident.major_proposed")).some((e) => e.id === inc.id)).toBe(true);
    // the manager (incident_manager: approve in the incident area) declares
    const d = await major(w.p.mim.client, { action: "declare", reason: "تأیید شد", mi_comms_id: w.p.agent.userId, comm_cadence: 20, bridge_url: "https://meet.example.com/x", stakeholders: [w.p.auditor.userId] });
    expect(d.row.major_state).toBe("accepted");
    expect(d.row.mi_manager_id).toBe(w.p.mim.userId);
    expect(d.row.mi_declared_by).toBe(w.p.mim.userId);
    expect(d.row.comm_cadence).toBe(20);
    expect(Date.parse(d.row.next_update_at) - Date.parse(d.row.mi_declared_at)).toBe(20 * 60_000);
    await major(w.p.mim.client, { action: "declare" }, 409);
    await w.drain();
    const declared = (await customEvents("record.incident.major_declared")).find((e) => e.id === inc.id);
    expect(declared.data.users.sort()).toEqual([w.p.auditor.userId, w.p.mim.userId, w.p.agent.userId].sort());
    // the seeded rule «اعلام رخداد عمده» delivered it (mandatory, in-app) to the stakeholders
    const inbox = await w.e.db.query<{ user_id: string }>(`select user_id from sm_notifications where org_id = $1 and record_id = $2 and rule_key is not null`, [w.e.org, inc.id]).catch(() => []);
    expect(inbox.length).toBeGreaterThan(0);
  });

  it("can be rejected and downgraded with a reason", async () => {
    const other = await w.incident({ impact: "1", urgency: "1" });
    await w.o.post(`${w.P}/incident/${other.id}/major`, { action: "reject" }, 400);
    const r = await w.o.post(`${w.P}/incident/${other.id}/major`, { action: "reject", reason: "اثر محدود" });
    expect([r.row.major_state, r.row.mi_reason]).toEqual(["rejected", "اثر محدود"]);
    await w.o.post(`${w.P}/incident/${other.id}/major`, { action: "declare" });
    const dn = await w.o.post(`${w.P}/incident/${other.id}/major`, { action: "downgrade", reason: "فقط یک کاربر" });
    expect([dn.row.major_state, dn.row.next_update_at]).toEqual(["downgraded", null]);
    // a declared-then-done incident cannot be declared again
    await w.o.post(`${w.P}/r/incident/${other.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "حل" } });
    await w.o.post(`${w.P}/incident/${other.id}/major`, { action: "declare" }, 409);
  });
});

describe("the war room", () => {
  it("projects the history, communications, children and manual events into one timeline", async () => {
    await w.incident({ parent_id: inc.id, short_description: "فروشگاه شعبه ۲ هم متوقف است" });
    const back = new Date(Date.now() - 50 * 60_000).toISOString();
    const ev = await w.p.agent.client.post(`${w.P}/incident/${inc.id}/timeline`, { kind: "detection", at: back, title: "هشدار پایش: خطای ۵۰۰" });
    expect(ev.event.key).toBe(true);
    await w.p.agent.client.post(`${w.P}/incident/${inc.id}/timeline`, { kind: "decision", title: "بازگشت به نسخهٔ قبلی", key: false });
    await w.p.agent.client.post(`${w.P}/incident/${inc.id}/timeline`, { kind: "state", title: "x" }, 400);
    await w.p.agent.client.post(`${w.P}/incident/${inc.id}/timeline`, { kind: "note", title: "x", at: new Date(Date.now() + 86_400_000).toISOString() }, 400);
    const note = await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/journal`, { kind: "work_note", body: "## نسخهٔ ۴٫۲ عقب برگردانده شد\nجزئیات در گزارش" });
    const promoted = await w.p.agent.client.post(`${w.P}/incident/${inc.id}/timeline/promote`, { entry_id: note.entry.id });
    expect(promoted.event.title).toBe("نسخهٔ ۴٫۲ عقب برگردانده شد");
    await w.p.agent.client.post(`${w.P}/incident/${inc.id}/timeline/promote`, { entry_id: note.entry.id }, 409);
    const tl = await w.o.get(`${w.P}/incident/${inc.id}/timeline`);
    const kinds = tl.items.map((x: any) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["detection", "state", "declaration", "role", "bridge", "child", "decision", "note"]));
    // oldest first: the back-dated detection precedes the registration
    expect(tl.items.findIndex((x: any) => x.title === "هشدار پایش: خطای ۵۰۰")).toBeLessThan(tl.items.findIndex((x: any) => x.title === "ثبت رخداد"));
    const child = tl.items.find((x: any) => x.kind === "child");
    expect(tl.display[child.ref.id]).toContain("فروشگاه شعبه ۲");
    const decision = tl.items.find((x: any) => x.kind === "decision");
    expect(decision.key).toBe(false);
    await w.p.agent.client.patch(`${w.P}/incident/${inc.id}/timeline/${decision.id}`, { key: true });
    await w.p.agent.client.del(`${w.P}/incident/${inc.id}/timeline/${promoted.event.id}`);
    const after = (await w.o.get(`${w.P}/incident/${inc.id}/timeline`)).items;
    expect(after.find((x: any) => x.id === decision.id).key).toBe(true);
    expect(after.some((x: any) => x.id === promoted.event.id)).toBe(false);
  });

  it("sends stakeholder updates through the notification service and restarts the cadence", async () => {
    const before = await row();
    await w.p.agent.client.post(`${w.P}/incident/${inc.id}/updates`, { audience: "stakeholders", subject: "", body: "x" }, 400);
    const r = await w.p.agent.client.post(`${w.P}/incident/${inc.id}/updates`, { audience: "stakeholders", subject: "به‌روزرسانی ۱", body: "بازگشت نسخه در جریان است", channels: ["in_app"] });
    expect(r.recipients).toBe(2); // the stakeholder and the manager; the sender is left out
    const after = await row();
    expect(Date.parse(after.last_update_at)).toBeGreaterThan(Date.parse(before.mi_declared_at) - 1);
    expect(Date.parse(after.next_update_at) - Date.parse(after.last_update_at)).toBe(20 * 60_000);
    const sends = await w.e.db.query<{ payload: any }>(`select payload from sm_jobs where org_id = $1 and kind = 'notify.send' and payload->'rule'->>'name' = 'اطلاع‌رسانی رخداد'`, [w.e.org]);
    expect(sends.map((s) => s.payload.user).sort()).toEqual([w.p.auditor.userId, w.p.mim.userId].sort());
    const tl = await w.o.get(`${w.P}/incident/${inc.id}/timeline`);
    expect(tl.items.some((x: any) => x.kind === "communication" && x.title.includes("به‌روزرسانی ۱"))).toBe(true);
    // to the affected people: a public reply on the incident
    await w.p.agent.client.post(`${w.P}/incident/${inc.id}/updates`, { audience: "affected", subject: "اطلاعیه", body: "سامانه تا یک ساعت دیگر برمی‌گردد" });
    const journal = await w.o.get(`${w.P}/r/incident/${inc.id}/journal?kinds=comment`);
    expect(journal.entries[0].body).toContain("اطلاعیه");
  });

  it("warns the communications lead once when an update is late", async () => {
    await backdate(w.e, "sm_incidents", inc.id, "next_update_at", 1);
    const first = await sweep(w.sys);
    expect(first.warned).toBe(1);
    expect((await sweep(w.sys)).warned).toBe(0);
    const warn = await w.e.db.query<{ payload: any }>(`select payload from sm_jobs where org_id = $1 and kind = 'notify.send' and payload->'rule'->>'name' = 'رخداد عمده'`, [w.e.org]);
    expect(warn.map((x) => x.payload.user).sort()).toEqual([w.p.agent.userId, w.p.mim.userId].sort());
  });
});

describe("after the resolution", () => {
  it("drafts the review and opens a problem; publishing needs owners for preventive actions and marks the incident", async () => {
    const res = await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "نسخهٔ قبلی برگردانده شد" } });
    expect(res.row.major_state).toBe("resolved");
    await w.drain();
    const reviews = (await w.o.post(`${w.P}/r/incident_review/query`, { filter: { f: "incident_id", op: "eq", v: inc.id }, fields: ["number", "title", "owner_id", "review_trigger", "timeline_md", "impact", "resolution", "due_at", "state"] })).rows;
    expect(reviews).toHaveLength(1);
    const pir = reviews[0];
    expect([pir.owner_id, pir.review_trigger, pir.state]).toEqual([w.p.mim.userId, "major", "draft"]);
    expect(pir.timeline_md).toContain("هشدار پایش: خطای ۵۰۰");
    expect(pir.resolution).toContain("نسخهٔ قبلی برگردانده شد");
    expect(Date.parse(pir.due_at)).toBeGreaterThan(Date.now());
    // drafting again answers the same review
    const again = await w.o.post(`${w.P}/incident/${inc.id}/review`);
    expect([again.row.id, again.created]).toEqual([pir.id, false]);
    // every major incident gets a problem
    const incident = await row();
    expect(incident.problem_id).toBeTruthy();
    const prb = (await w.o.get(`${w.P}/r/problem/${incident.problem_id}`)).row;
    expect([prb.source, prb.first_incident_id, prb.incident_count]).toEqual(["major_incident", inc.id, 1]);
    // publishing: in review first, an owner on every preventive action, a manager to publish
    await w.o.post(`${w.P}/r/incident_review/${pir.id}/transition`, { to: "in_review", data: { summary: "خلاصه", root_cause: "نسخهٔ معیوب" } });
    const act = (await w.o.post(`${w.P}/r/corrective_action`, { short_description: "آزمون خودکار پیش از انتشار", action_type: "prevent", review_id: pir.id, assigned_to: null })).row;
    const refused = await w.p.mim.client.post(`${w.P}/r/incident_review/${pir.id}/transition`, { to: "published" }, 409);
    expect(refused.error.message).toContain(act.number);
    await w.o.patch(`${w.P}/r/corrective_action/${act.id}`, { assigned_to: w.p.agent.userId });
    await w.p.agent.client.post(`${w.P}/r/incident_review/${pir.id}/transition`, { to: "published" }, 403);
    const pub = await w.p.mim.client.post(`${w.P}/r/incident_review/${pir.id}/transition`, { to: "published" });
    expect(pub.row.published_by).toBe(w.p.mim.userId);
    expect((await row()).major_state).toBe("pir_done");
  });
});

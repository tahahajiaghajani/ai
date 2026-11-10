// Incident management end to end (src/server/modules/incident, docs/modules/incident_FA.md): the defaults and their
// idempotency, the priority matrix, assignment and SLA definitions on new incidents, hold reasons and milestones, the
// guards (open mandatory tasks, the reopen window), follow-ups, templates, security incidents, VIP, parent/child
// cascades and comment propagation, requester replies, the sweep (auto-close, reminders, «بی‌پاسخ»), merging,
// escalation, related incidents, known errors, similar incidents, alerts and the dashboard.
import { describe, it, expect, beforeAll } from "vitest";
import { seedIncidentDefaultsIn, sweep, createFromAlert } from "@server/modules/incident";
import { listJournal } from "@server/engine";
import { backdate, world, type World } from "./incident-helpers";

let w: World;
beforeAll(async () => {
  w = await world();
});

const get = async (id: string) => (await w.o.get(`${w.P}/r/incident/${id}`)).row;
const go = (id: string, to: string, data: Record<string, unknown> = {}, expect = 200) => w.o.post(`${w.P}/r/incident/${id}/transition`, { to, data }, expect);
const timers = async (id: string) => (await w.o.get(`${w.P}/r/incident/${id}`)).meta.sla as { label: string; state: string; target: string }[];
const notes = async (id: string) => (await listJournal(w.sys, "incident", id, { limit: 50 })).entries;

describe("defaults of a new organisation", () => {
  it("adds categories, matrix, SLAs, groups, rules, notifications, templates and responses once", async () => {
    const cats = (await w.o.get(`${w.P}/r/category?size=200&filter=${encodeURIComponent(JSON.stringify({ f: "table_key", op: "eq", v: "incident" }))}`)).rows;
    expect(cats).toHaveLength(34);
    const slas = (await w.o.get(`${w.P}/r/sla_definition?size=50`)).rows.filter((r: any) => r.table_key === "incident");
    expect(slas.map((r: any) => r.name).sort()).toEqual(["پاسخ رخداد", "پاسخ رخداد — اولویت ۱ (شبانه‌روزی)", "حل رخداد", "حل رخداد — اولویت ۱ (شبانه‌روزی)"].sort());
    const cal = (await w.o.get(`${w.P}/r/calendar`)).rows.map((r: any) => r.name).sort();
    expect(cal).toEqual(["ساعات اداری", "شبانه‌روزی"].sort());
    expect((await w.o.get(`${w.P}/r/incident_template`)).rows).toHaveLength(3);
    expect((await w.o.get(`${w.P}/r/incident_response`)).rows).toHaveLength(4);
    const cfg = (await w.o.get(`${w.P}/r/incident_config`)).rows[0];
    expect(cfg.security_group_id).toBe(w.g.security);
    // a second run adds nothing (forced: re-adds only what is missing; plain: skipped)
    const again = await w.o.post(`${w.P}/incident/seed`, {});
    expect(Object.values(again.incident.created).reduce((a: number, b) => a + (b as number), 0)).toBe(0);
    expect(await w.sys.write((tx) => seedIncidentDefaultsIn(tx, w.sys))).toEqual({ skipped: true, created: {} });
  });

  it("a deleted default comes back only when forced", async () => {
    const r = (await w.o.get(`${w.P}/r/incident_response`)).rows.find((x: any) => x.name === "دریافت شد");
    await w.o.del(`${w.P}/r/incident_response/${r.id}?version=${r.version}`);
    expect((await w.sys.write((tx) => seedIncidentDefaultsIn(tx, w.sys))).skipped).toBe(true);
    const forced = await w.sys.write((tx) => seedIncidentDefaultsIn(tx, w.sys, { force: true }));
    expect(forced.created).toEqual({ incident_response: 1 });
  });
});

describe("a new incident", () => {
  it("gets its priority from the matrix, a group and person from the rules, and P1 timers on the 24 × 7 calendar", async () => {
    const inc = await w.incident({ short_description: "قطعی سرور ایمیل", impact: "1", urgency: "1", caller_id: w.p.req.userId });
    expect(inc.number).toMatch(/^INC\d{7}$/);
    expect(inc.priority).toBe("1");
    expect(inc.assignment_group_id).toBe(w.g.desk);
    expect([w.p.agent.userId, w.p.mim.userId]).toContain(inc.assigned_to);
    expect(inc.major_state).toBe("candidate");
    expect((await notes(inc.id)).some((n) => n.body.includes("معیار رخداد عمده"))).toBe(true);
    const t = await timers(inc.id);
    expect(t.map((x) => x.label).sort()).toEqual(["حل رخداد — اولویت ۱ (شبانه‌روزی)", "پاسخ رخداد — اولویت ۱ (شبانه‌روزی)"].sort());
    expect(inc.sla_due).toBeTruthy();
  });

  it("moves to the office-hours timers when the priority falls, and back", async () => {
    const inc = await w.incident({ impact: "2", urgency: "2" });
    expect(inc.priority).toBe("3");
    expect((await timers(inc.id)).map((x) => x.label).sort()).toEqual(["حل رخداد", "پاسخ رخداد"]);
    await w.o.patch(`${w.P}/r/incident/${inc.id}`, { impact: "1", urgency: "1" });
    const after = (await timers(inc.id)).filter((x) => x.state !== "canceled").map((x) => x.label);
    expect(after).toContain("حل رخداد — اولویت ۱ (شبانه‌روزی)");
    expect(after).not.toContain("حل رخداد");
    // the criteria no longer hold once the priority falls again: the candidate flag goes
    expect((await get(inc.id)).major_state).toBe("candidate");
    await w.o.patch(`${w.P}/r/incident/${inc.id}`, { impact: "3", urgency: "3" });
    expect((await get(inc.id)).major_state).toBeNull();
  });

  it("needs a hold reason to wait, pauses the resolution clock on the requester and clears the reason afterwards", async () => {
    const inc = await w.incident({ impact: "2", urgency: "2" });
    await go(inc.id, "on_hold", {}, 400);
    const held = (await go(inc.id, "on_hold", { hold_reason: "awaiting_caller" })).row;
    expect(held.hold_since).toBeTruthy();
    expect((await timers(inc.id)).find((x) => x.target === "resolution")!.state).toBe("paused");
    const back = (await go(inc.id, "in_progress")).row;
    expect(back.hold_reason).toBeNull();
    expect(back.hold_since).toBeNull();
    expect(back.accepted_at).toBeTruthy();
    expect(back.time_to_accept).toBeGreaterThanOrEqual(0);
    expect((await timers(inc.id)).find((x) => x.target === "resolution")!.state).toBe("in_progress");
  });

  it("refuses resolution while a mandatory task is open, and says so", async () => {
    const inc = await w.incident();
    const task = (await w.o.post(`${w.P}/r/incident_task`, { incident_id: inc.id, short_description: "تعویض کابل" })).row;
    expect(task.number).toMatch(/^ITASK/);
    expect(task.assignment_group_id).toBe(inc.assignment_group_id);
    await w.o.post(`${w.P}/r/incident_task`, { incident_id: inc.id, short_description: "اختیاری", mandatory: false });
    const r = await go(inc.id, "resolved", { close_code: "solved", close_notes: "حل شد" }, 409);
    expect(r.error.message).toContain(task.number);
    const ready = await w.o.get(`${w.P}/incident/${inc.id}/readiness`);
    expect(ready.can_resolve).toBe(false);
    expect(ready.tasks.map((t: any) => t.number)).toEqual([task.number]);
    expect(ready.missing).toEqual(["کد حل", "یادداشت حل"]);
    await w.o.post(`${w.P}/r/incident_task/${task.id}/transition`, { to: "closed_complete" });
    expect((await notes(inc.id)).some((n) => n.body.includes("همهٔ کارهای الزامی"))).toBe(true);
    const done = (await go(inc.id, "resolved", { close_code: "solved", close_notes: "حل شد" })).row;
    expect(done.state).toBe("resolved");
    expect(done.time_to_resolve).toBeGreaterThanOrEqual(0);
    // closed incidents take no new tasks
    await go(inc.id, "closed");
    await w.o.post(`${w.P}/r/incident_task`, { incident_id: inc.id, short_description: "دیر" }, 400);
  });

  it("reopens inside the window only; after it, a follow-up incident is opened", async () => {
    const inc = await w.incident({ caller_id: w.p.req.userId });
    await go(inc.id, "resolved", { close_code: "solved", close_notes: "حل شد" });
    const again = (await go(inc.id, "in_progress")).row;
    expect(again.reopen_count).toBe(1);
    expect(again.time_to_resolve).toBeNull();
    await go(inc.id, "resolved", { close_code: "solved", close_notes: "حل شد" });
    await backdate(w.e, "sm_incidents", inc.id, "resolved_at", 10);
    const refused = await go(inc.id, "in_progress", {}, 409);
    expect(refused.error.message).toContain("مهلت بازگشایی");
    const follow = await w.o.post(`${w.P}/incident/${inc.id}/related`, { mode: "follow_up" });
    expect(follow.row.follow_up_of).toBe(inc.id);
    expect(follow.row.short_description).toContain(inc.number);
    await w.o.post(`${w.P}/incident/${follow.row.id}/related`, { mode: "follow_up" }, 409);
  });

  it("applies a template: values from the URL, tasks created on save", async () => {
    const t = (await w.o.get(`${w.P}/r/incident_template`)).rows.find((x: any) => x.name === "قطعی اینترنت ساختمان");
    const inc = await w.incident({ short_description: t.short_description, category: t.category, subcategory: t.subcategory, template_id: t.id });
    const tasks = (await w.o.post(`${w.P}/r/incident_task/query`, { filter: { f: "incident_id", op: "eq", v: inc.id }, sort: "sort_order" })).rows;
    expect(tasks.map((x: any) => [x.short_description, x.mandatory])).toEqual([["بررسی تجهیزات شبکهٔ ساختمان", true], ["پیگیری با سرویس‌دهندهٔ اینترنت", false]]);
    await w.o.post(`${w.P}/r/incident_template`, { name: "الگوی نادرست", tasks: { x: 1 } }, 400);
  });

  it("security incidents become confidential and go to the security group", async () => {
    const inc = await w.incident({ short_description: "ایمیل فیشینگ", security_incident: true, assignment_group_id: w.g.desk });
    const row = (await w.sys.db.one<{ confidential: boolean; assignment_group_id: string }>(`select confidential, assignment_group_id from sm_incidents where id = $1`, [inc.id]))!;
    expect(row).toEqual({ confidential: true, assignment_group_id: w.g.security });
  });

  it("marks incidents of VIPs", async () => {
    await w.o.put(`${w.P}/access/members/${w.p.req2.userId}`, { vip: true });
    const inc = await w.incident({ caller_id: w.p.req2.userId });
    expect(inc.vip).toBe(true);
    expect((await w.incident({ caller_id: w.p.req.userId })).vip).toBe(false);
  });

  it("refuses parent loops", async () => {
    const a = await w.incident();
    const b = await w.incident({ parent_id: a.id });
    await w.o.patch(`${w.P}/r/incident/${a.id}`, { parent_id: b.id }, 400);
    await w.o.patch(`${w.P}/r/incident/${a.id}`, { parent_id: a.id }, 400);
  });
});

describe("parents, children and replies", () => {
  it("resolving a parent resolves its open children with its code and notes", async () => {
    const parent = await w.incident({ short_description: "قطعی گسترده" });
    const kids = [await w.incident({ parent_id: parent.id }), await w.incident({ parent_id: parent.id })];
    const closed = await w.incident({ parent_id: parent.id });
    await go(closed.id, "canceled", { close_notes: "اشتباه" });
    await go(parent.id, "resolved", { close_code: "solved", close_notes: "سوییچ تعویض شد", cause_code: "hardware" });
    await w.drain();
    for (const k of kids) {
      const row = await get(k.id);
      expect(row.state).toBe("resolved");
      expect(row.close_notes).toContain(parent.number);
      expect(row.close_notes).toContain("سوییچ تعویض شد");
      expect(row.cause_code).toBe("hardware");
    }
    expect((await get(closed.id)).state).toBe("canceled");
  });

  it("a public reply on a parent reaches its open children once", async () => {
    const parent = await w.incident();
    const child = await w.incident({ parent_id: parent.id, caller_id: w.p.req.userId });
    await w.o.post(`${w.P}/r/incident/${parent.id}/journal`, { kind: "comment", body: "در حال بررسی هستیم" });
    await w.o.post(`${w.P}/r/incident/${parent.id}/journal`, { kind: "work_note", body: "یادداشت داخلی" });
    await w.drain();
    const copied = (await notes(child.id)).filter((n) => n.kind === "comment");
    expect(copied).toHaveLength(1);
    expect(copied[0].body).toContain("در حال بررسی هستیم");
    expect(copied[0].data).toEqual({ from_parent: parent.id });
  });

  it("a reply of the requester brings an incident awaiting them back to work", async () => {
    const inc = await w.incident({ caller_id: w.p.req.userId });
    await go(inc.id, "on_hold", { hold_reason: "awaiting_caller" });
    await w.p.req.client.post(`${w.P}/r/incident/${inc.id}/journal`, { kind: "comment", body: "اطلاعات خواسته‌شده پیوست شد" });
    await w.drain();
    expect((await get(inc.id)).state).toBe("in_progress");
  });
});

describe("the sweep", () => {
  it("closes resolved incidents after N working days", async () => {
    const inc = await w.incident();
    await go(inc.id, "resolved", { close_code: "solved", close_notes: "حل شد" });
    await sweep(w.sys);
    expect((await get(inc.id)).state).toBe("resolved");
    await backdate(w.e, "sm_incidents", inc.id, "resolved_at", 10);
    const r = await sweep(w.sys);
    expect(r.closed).toBeGreaterThanOrEqual(1);
    const row = await get(inc.id);
    expect(row.state).toBe("closed");
    expect((await notes(inc.id)).some((n) => n.body.includes("روز کاری پس از حل"))).toBe(true);
  });

  it("reminds an awaited requester, then resolves «بی‌پاسخ»", async () => {
    const inc = await w.incident({ caller_id: w.p.req.userId });
    await go(inc.id, "on_hold", { hold_reason: "awaiting_caller" });
    await backdate(w.e, "sm_incidents", inc.id, "hold_since", 10);
    await sweep(w.sys);
    let row = await get(inc.id);
    expect(row.follow_ups).toBe(1);
    expect((await notes(inc.id)).filter((n) => n.kind === "comment" && n.body.startsWith("یادآوری"))).toHaveLength(1);
    // not yet due again
    await sweep(w.sys);
    expect((await get(inc.id)).follow_ups).toBe(1);
    await backdate(w.e, "sm_incidents", inc.id, "last_follow_up_at", 10);
    await sweep(w.sys);
    expect((await get(inc.id)).follow_ups).toBe(2);
    await backdate(w.e, "sm_incidents", inc.id, "last_follow_up_at", 10);
    await sweep(w.sys);
    row = await get(inc.id);
    expect(row.state).toBe("resolved");
    expect(row.close_code).toBe("no_response");
  });
});

describe("agent actions", () => {
  it("merges open duplicates into a primary; the others' people follow it", async () => {
    const primary = await w.incident({ short_description: "چاپگر طبقه سوم", caller_id: w.p.req.userId });
    const d1 = await w.incident({ short_description: "چاپگر طبقه سوم کار نمی‌کند", caller_id: w.p.req2.userId, time_worked: 600 });
    const d2 = await w.incident({ short_description: "چاپگر", watch_list: [w.p.auditor.userId] });
    const done = await w.incident();
    await go(done.id, "resolved", { close_code: "solved", close_notes: "حل شد" });
    const r = await w.o.post(`${w.P}/incident/${primary.id}/merge`, { ids: [d1.id, d2.id, done.id, primary.id] });
    expect(r.merged).toEqual([d1.number, d2.number]);
    expect(r.failed.map((f: any) => f.id)).toEqual([done.id]);
    const m1 = await get(d1.id);
    expect([m1.state, m1.close_code, m1.merged_into]).toEqual(["canceled", "duplicate", primary.id]);
    const p = await get(primary.id);
    expect(p.affected_users).toContain(w.p.req2.userId);
    expect(p.watch_list).toContain(w.p.auditor.userId);
    expect(p.time_worked).toBe(600);
    expect((await notes(primary.id)).some((n) => n.body.includes(d1.number))).toBe(true);
  });

  it("escalates hierarchically (level and managers told) and functionally (another group)", async () => {
    await w.o.patch(`${w.P}/r/group/${w.g.desk}`, { manager_id: w.p.mim.userId });
    const inc = await w.incident();
    const h = await w.o.post(`${w.P}/incident/${inc.id}/escalate`, { kind: "hierarchical", reason: "نیاز به تصمیم مدیر" });
    expect(h.row.escalation).toBe(1);
    // one notification to named people: a `notify.batch` job listing them (or a `notify.send` per person)
    const jobs = await w.e.db.query<{ payload: any }>(`select payload from sm_jobs where org_id = $1 and kind in ('notify.send', 'notify.batch')`, [w.e.org]);
    const told = (j: { payload: any }) => (j.payload.people ? j.payload.people.map((x: any) => x.user) : [j.payload.user]);
    expect(jobs.some((j) => told(j).includes(w.p.mim.userId) && j.payload.rule?.name === "تشدید رخداد")).toBe(true);
    await w.o.post(`${w.P}/incident/${inc.id}/escalate`, { kind: "functional", reason: "x" }, 400);
    const f = await w.o.post(`${w.P}/incident/${inc.id}/escalate`, { kind: "functional", group_id: w.g.network, reason: "مشکل شبکه است" });
    expect([f.row.assignment_group_id, f.row.assigned_to, f.row.escalation]).toEqual([w.g.network, null, 2]);
    await w.o.post(`${w.P}/incident/${inc.id}/escalate`, { kind: "hierarchical", reason: "" }, 400);
  });

  it("creates child and copied incidents", async () => {
    const src = await w.incident({ short_description: "اصلی", category: "software", subcategory: "software.office", caller_id: w.p.req.userId });
    const child = await w.o.post(`${w.P}/incident/${src.id}/related`, { mode: "child" });
    expect([child.row.parent_id, child.row.category, child.row.caller_id]).toEqual([src.id, "software", w.p.req.userId]);
    const copy = await w.o.post(`${w.P}/incident/${src.id}/related`, { mode: "copy", short_description: "رونوشت" });
    expect([copy.row.parent_id, copy.row.short_description]).toEqual([null, "رونوشت"]);
  });

  it("finds similar incidents the caller may read", async () => {
    const a = await w.incident({ short_description: "خطای اتصال VPN در شعبه شمال", category: "network", subcategory: "network.vpn" });
    const b = await w.incident({ short_description: "اتصال VPN شعبه شمال قطع است", category: "network", subcategory: "network.vpn" });
    await w.incident({ short_description: "چاپگر", category: "hardware" });
    const s = await w.o.get(`${w.P}/incident/${a.id}/similar`);
    expect(s.hits[0].id).toBe(b.id);
    expect(s.hits[0].reasons).toContain("همان زیردسته");
  });

  it("applies a known error's workaround and counts it", async () => {
    const prb = (await w.o.post(`${w.P}/r/problem`, { short_description: "قطع VPN پس از به‌روزرسانی" })).row;
    const ke = (await w.o.post(`${w.P}/r/known_error`, { short_description: "قطع VPN پس از به‌روزرسانی", problem_id: prb.id, symptoms: "اتصال VPN پس از به‌روزرسانی قطع می‌شود", workaround: "نسخهٔ قبلی کارخواه را نصب کنید", category: "network", subcategory: "network.vpn" })).row;
    const inc = await w.incident({ short_description: "اتصال VPN پس از به‌روزرسانی قطع می‌شود", category: "network", subcategory: "network.vpn" });
    expect((await w.o.get(`${w.P}/incident/${inc.id}/known-errors`)).hits).toEqual([]); // a draft is not offered
    await w.o.post(`${w.P}/incident/${inc.id}/apply-known-error`, { known_error_id: ke.id }, 409);
    await w.o.post(`${w.P}/r/known_error/${ke.id}/transition`, { to: "published" });
    const hits = (await w.o.get(`${w.P}/incident/${inc.id}/known-errors`)).hits;
    expect(hits[0].id).toBe(ke.id);
    const applied = await w.o.post(`${w.P}/incident/${inc.id}/apply-known-error`, { known_error_id: ke.id, resolve: true });
    expect([applied.row.known_error_id, applied.row.problem_id, applied.row.state, applied.row.close_code]).toEqual([ke.id, prb.id, "resolved", "known_error"]);
    expect(applied.row.workaround).toBe("نسخهٔ قبلی کارخواه را نصب کنید");
    const k = (await w.o.get(`${w.P}/r/known_error/${ke.id}`)).row;
    expect([k.use_count, k.incident_count]).toEqual([1, 1]);
    expect((await w.o.get(`${w.P}/r/problem/${prb.id}`)).row.incident_count).toBe(1);
  });

  it("opens incidents from alerts and adds repeats to the open one", async () => {
    const one = await w.sys.write((tx) => createFromAlert(tx, w.sys, { key: "zabbix:42", source: "Zabbix", title: "سرور پایگاه داده پاسخ نمی‌دهد", severity: "critical" }));
    expect(one.created).toBe(true);
    expect([one.incident.channel, one.incident.priority, one.incident.external_ref]).toEqual(["monitoring", "1", "zabbix:42"]);
    const two = await w.sys.write((tx) => createFromAlert(tx, w.sys, { key: "zabbix:42", source: "Zabbix", title: "سرور پایگاه داده پاسخ نمی‌دهد" }));
    expect([two.created, two.incident.id]).toEqual([false, one.incident.id]);
  });

  it("answers the dashboard with the caller's figures", async () => {
    const d = await w.o.get(`${w.P}/incident/dashboard?days=30`);
    expect(d.open.total).toBeGreaterThan(0);
    expect(d.flow.created).toBeGreaterThan(d.open.total - 1);
    expect(d.ageing.map((x: any) => x.key)).toEqual(["0-1", "1-3", "3-7", "7-30", "30+"]);
    expect(d.times.mttr_median).not.toBeNull();
    expect(d.sla).not.toBeNull();
    await w.o.get(`${w.P}/incident/dashboard?days=3`, 400);
  });
});

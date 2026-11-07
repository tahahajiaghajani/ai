// Problem management end to end (src/server/modules/problem, docs/modules/problem_FA.md): defaults, the lifecycle and
// its milestones, guards and grants (closing, risk acceptance, re-analysis), the RCA canvas, problems from incidents,
// linking and counters, known errors (publication, technical debt, risk), sharing the workaround once per text,
// merging duplicates, incidents waiting on a problem, problem tasks and their findings, the candidate rules (run,
// dedupe, promote, merge), the daily sweep (inactivity, the monitoring window, known-error reviews), access and the
// dashboard.
import { describe, it, expect, beforeAll } from "vitest";
import { uuidv7 } from "@shared/id";
import { problemSweep } from "@server/modules/problem";
import { listJournal } from "@server/engine";
import { backdate, world, type World } from "./incident-helpers";

let w: World;
beforeAll(async () => {
  w = await world();
});

const prb = async (id: string) => (await w.o.get(`${w.P}/r/problem/${id}`)).row;
const go = (id: string, to: string, data: Record<string, unknown> = {}, expect = 200, as = w.o) => as.post(`${w.P}/r/problem/${id}/transition`, { to, data }, expect);
const create = async (data: Record<string, unknown> = {}, as = w.o) => (await as.post(`${w.P}/r/problem`, { short_description: "مشکل آزمایشی", ...data })).row;
const notes = async (table: string, id: string) => (await listJournal(w.sys, table, id, { limit: 50 })).entries;

describe("defaults", () => {
  it("adds the settings, categories, matrix and notification rules of problems", async () => {
    expect((await w.o.get(`${w.P}/r/problem_config`)).rows).toHaveLength(1);
    const cats = (await w.o.post(`${w.P}/r/category/query`, { filter: { f: "table_key", op: "eq", v: "problem" }, size: 100 })).rows;
    expect(cats).toHaveLength(34);
    const rules = (await w.o.get(`${w.P}/r/notification_rule?size=100`)).rows.filter((r: any) => ["problem", "known_error", "problem_candidate"].includes(r.table_key));
    expect(rules).toHaveLength(3);
    const p = await create({ impact: "1", urgency: "2" });
    expect(p.priority).toBe("2");
  });
});

describe("the lifecycle", () => {
  it("records milestones from assessment to fix, and the monitoring window", async () => {
    const p = await create({ source: "vendor", impact: "2", urgency: "2", likelihood: "1" });
    expect([p.proactive, p.number.startsWith("PRB")]).toEqual([true, true]);
    expect(p.risk_score).toBe(42);
    await go(p.id, "assess");
    await go(p.id, "rca");
    await go(p.id, "fix_in_progress", {}, 400);
    const fixing = (await go(p.id, "fix_in_progress", { cause_notes: "حافظهٔ سرور کم است" })).row;
    expect(fixing.rca_at).toBeTruthy();
    expect(fixing.time_to_rca).toBeGreaterThanOrEqual(0);
    await w.o.patch(`${w.P}/r/problem/${p.id}`, { workaround: "سرویس را هر شب دوباره راه‌اندازی کنید" });
    expect((await prb(p.id)).workaround_at).toBeTruthy();
    await go(p.id, "pending", {}, 400);
    const waiting = (await go(p.id, "pending", { pending_reason: "vendor" })).row;
    expect(waiting.state).toBe("pending");
    await go(p.id, "fix_in_progress");
    await go(p.id, "resolved", {}, 400);
    const fixed = (await go(p.id, "resolved", { fix_notes: "حافظه افزایش یافت" })).row;
    expect(fixed.fix_at).toBeTruthy();
    expect(fixed.monitoring_until).toBeTruthy();
    expect(fixed.time_to_fix).toBeGreaterThanOrEqual(0);
    // re-analysis is the problem manager's decision
    await go(p.id, "rca", {}, 403, w.p.agent.client);
    const again = (await go(p.id, "rca", {}, 200, w.p.pm.client)).row;
    expect(again.monitoring_until).toBeNull();
  });

  it("closes only without open mandatory tasks, with a code; accepting a risk needs a manager", async () => {
    const p = await create();
    await go(p.id, "rca");
    await go(p.id, "fix_in_progress", { cause_notes: "علت" });
    await go(p.id, "resolved", { fix_notes: "رفع" });
    const t = (await w.o.post(`${w.P}/r/problem_task`, { problem_id: p.id, short_description: "پایش یک‌هفته‌ای", task_type: "fix" })).row;
    expect(t.number).toMatch(/^PTASK/);
    await go(p.id, "closed", {}, 400);
    const blocked = await go(p.id, "closed", { close_code: "fixed" }, 409);
    expect(blocked.error.message).toContain(t.number);
    await w.o.post(`${w.P}/r/problem_task/${t.id}/transition`, { to: "closed_complete" });
    expect((await go(p.id, "closed", { close_code: "fixed" })).row.state).toBe("closed");
    await w.o.post(`${w.P}/r/problem_task`, { problem_id: p.id, short_description: "دیر" }, 400);
    // risk acceptance
    const r = await create();
    await go(r.id, "rca");
    await go(r.id, "closed", { close_notes: "هزینهٔ رفع بیش از اثر" }, 403, w.p.agent.client);
    const accepted = (await go(r.id, "closed", { close_notes: "هزینهٔ رفع بیش از اثر" }, 200, w.p.pm.client)).row;
    expect(accepted.close_code).toBe("risk_accepted");
  });

  it("keeps the RCA canvas valid and clean", async () => {
    const p = await create();
    await w.o.patch(`${w.P}/r/problem/${p.id}`, { rca: { whys: "x" } }, 400);
    const saved = (await w.o.patch(`${w.P}/r/problem/${p.id}`, { rca: { whys: [{ question: "چرا؟", answer: "زیرا" }], fishbone: { people: ["آموزش"], nope: ["x"] }, junk: 1 } })).row;
    expect(saved.rca.whys).toEqual([{ question: "چرا؟", answer: "زیرا" }]);
    expect(saved.rca.fishbone).toEqual({ people: ["آموزش"] });
    expect(saved.rca.junk).toBeUndefined();
  });
});

describe("problems, incidents and known errors", () => {
  let p: Record<string, any>;
  let incs: Record<string, any>[];

  it("makes a problem from incidents and counts them", async () => {
    incs = [
      await w.incident({ short_description: "ایمیل ارسال نمی‌شود", category: "email", subcategory: "email.mailbox", impact: "2", urgency: "2" }),
      await w.incident({ short_description: "ایمیل‌ها در صف می‌مانند", category: "email", subcategory: "email.mailbox" }),
      await w.incident({ short_description: "خطای ارسال ایمیل", category: "email", subcategory: "email.calendar" }),
    ];
    const r = await w.o.post(`${w.P}/problem/from-incidents`, { incident_ids: incs.map((x) => x.id) });
    p = r.problem;
    expect(r.done).toHaveLength(3);
    expect([p.category, p.subcategory, p.first_incident_id, p.incident_count, p.source, p.investigation_reason]).toEqual(["email", "email.mailbox", incs[0].id, 3, "incident", "recurring"]);
    expect(p.description).toContain(incs[1].number);
    for (const i of incs) expect((await w.o.get(`${w.P}/r/incident/${i.id}`)).row.problem_id).toBe(p.id);
  });

  it("links and unlinks incidents", async () => {
    const extra = await w.incident({ short_description: "ایمیل نمی‌رسد" });
    const l = await w.o.post(`${w.P}/problem/${p.id}/link-incidents`, { incident_ids: [extra.id, incs[0].id] });
    expect(l.done).toEqual([extra.number]);
    expect(l.failed).toHaveLength(1);
    expect((await prb(p.id)).incident_count).toBe(4);
    await w.o.post(`${w.P}/problem/${p.id}/link-incidents`, { incident_ids: [extra.id], unlink: true });
    expect((await prb(p.id)).incident_count).toBe(3);
  });

  it("publishes a known error from the problem; technical debt and risk follow", async () => {
    await w.o.patch(`${w.P}/r/problem/${p.id}`, { symptoms: "پیام‌ها در صف خروجی می‌مانند", workaround: "صف را دستی خالی کنید", cause_notes: "گواهی منقضی" });
    const before = await prb(p.id);
    const ke = (await w.o.post(`${w.P}/problem/${p.id}/known-error`)).row;
    expect([ke.state, ke.problem_id, ke.symptoms, ke.workaround, ke.root_cause, ke.category]).toEqual(["draft", p.id, "پیام‌ها در صف خروجی می‌مانند", "صف را دستی خالی کنید", "گواهی منقضی", "email"]);
    expect((await prb(p.id)).known_error).toBe(false);
    const pub = (await w.o.post(`${w.P}/r/known_error/${ke.id}/transition`, { to: "published" })).row;
    expect(pub.published_at).toBeTruthy();
    expect(pub.review_at).toBeTruthy();
    const after = await prb(p.id);
    expect([after.known_error, after.tech_debt]).toEqual([true, 3]);
    expect(after.risk_score).toBeGreaterThan(before.risk_score);
  });

  it("shares the workaround with the open incidents once per text", async () => {
    const r = await w.o.post(`${w.P}/problem/${p.id}/share`, { kind: "workaround" });
    expect(r.incidents).toBe(3);
    expect((await notes("incident", incs[0].id)).some((n) => n.body.includes("صف را دستی خالی کنید") && n.visibility === "internal")).toBe(true);
    await w.o.post(`${w.P}/problem/${p.id}/share`, { kind: "workaround" }, 409);
    await w.o.post(`${w.P}/problem/${p.id}/share`, { kind: "fix" }, 400);
    const callers = await w.o.post(`${w.P}/problem/${p.id}/share`, { kind: "workaround", audience: "callers" });
    expect(callers.incidents).toBe(3);
    expect((await notes("incident", incs[1].id)).some((n) => n.kind === "comment" && n.body.includes("صف را دستی خالی کنید"))).toBe(true);
  });

  it("merges a duplicate problem: its incidents and known errors move to the master", async () => {
    const dupInc = await w.incident({ short_description: "صف ایمیل" });
    const dup = (await w.o.post(`${w.P}/problem/from-incidents`, { incident_ids: [dupInc.id] })).problem;
    const dupKe = (await w.o.post(`${w.P}/r/known_error`, { short_description: "صف ایمیل", problem_id: dup.id })).row;
    const r = await w.o.post(`${w.P}/problem/${p.id}/merge`, { ids: [dup.id] });
    expect(r.done).toEqual([dup.number]);
    const d = await prb(dup.id);
    expect([d.state, d.close_code, d.duplicate_of, d.incident_count]).toEqual(["canceled", "duplicate", p.id, 0]);
    expect((await w.o.get(`${w.P}/r/incident/${dupInc.id}`)).row.problem_id).toBe(p.id);
    expect((await w.o.get(`${w.P}/r/known_error/${dupKe.id}`)).row.problem_id).toBe(p.id);
    expect((await prb(p.id)).incident_count).toBe(4);
  });

  it("resolves the incidents waiting on it when the problem is fixed", async () => {
    await w.o.post(`${w.P}/r/incident/${incs[0].id}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_problem" } });
    await go(p.id, "rca");
    await go(p.id, "fix_in_progress");
    await go(p.id, "resolved", { fix_notes: "گواهی تمدید شد" });
    await w.drain();
    const i = (await w.o.get(`${w.P}/r/incident/${incs[0].id}`)).row;
    expect([i.state, i.close_code]).toEqual(["resolved", "resolved_by_problem"]);
    expect(i.close_notes).toContain("گواهی تمدید شد");
    expect((await w.o.get(`${w.P}/r/incident/${incs[1].id}`)).row.state).not.toBe("resolved");
  });

  it("copies an RCA task's findings to the problem", async () => {
    const q = await create();
    const t = (await w.o.post(`${w.P}/r/problem_task`, { problem_id: q.id, short_description: "تحلیل لاگ‌ها", task_type: "rca", findings: "حافظهٔ پنهان پر می‌شود" })).row;
    const r = await w.o.post(`${w.P}/problem/tasks/${t.id}/copy-findings`);
    expect(r.row.cause_notes).toBe("حافظهٔ پنهان پر می‌شود");
    expect((await notes("problem", q.id)).some((n) => n.body.includes(t.number))).toBe(true);
  });
});

describe("candidates", () => {
  it("raise recurring incidents once, skip what an open problem covers, and promote or merge", async () => {
    const ci = uuidv7();
    for (const s of ["پایگاه دادهٔ انبار کند است", "کندی پایگاه دادهٔ انبار", "پایگاه دادهٔ انبار قطع شد"]) await w.incident({ short_description: s, ci_id: ci });
    for (const s of ["وای‌فای طبقه ۲", "وای‌فای قطع است", "وای‌فای ضعیف"]) await w.incident({ short_description: s, category: "network", subcategory: "network.wifi" });
    const first = await w.o.post(`${w.P}/problem/candidates/run`);
    expect(first.created).toBeGreaterThanOrEqual(2);
    const again = await w.o.post(`${w.P}/problem/candidates/run`);
    expect(again.created).toBe(0);
    const cands = (await w.o.get(`${w.P}/r/problem_candidate?size=50`)).rows;
    const byCi = cands.find((c: any) => c.ci_id === ci);
    expect([byCi.rule_kind, byCi.incident_count]).toEqual(["recurring_ci", 3]);
    expect(byCi.title).toContain("پایگاه");
    const wifi = cands.find((c: any) => c.rule_kind === "recurring_category" && c.category === "network");
    expect(wifi).toBeTruthy();
    // promote the CI candidate
    const made = await w.o.post(`${w.P}/problem/candidates/${byCi.id}/promote`, {});
    expect([made.problem.source, made.problem.incident_count]).toEqual(["candidate", 3]);
    expect((await w.o.get(`${w.P}/r/problem_candidate/${byCi.id}`)).row.state).toBe("promoted");
    await w.o.post(`${w.P}/problem/candidates/${byCi.id}/promote`, {}, 409);
    // merge the Wi-Fi candidate into an existing problem
    const existing = await create({ short_description: "پوشش ضعیف وای‌فای" });
    const merged = await w.o.post(`${w.P}/problem/candidates/${wifi.id}/merge`, { problem_id: existing.id });
    expect(merged.done).toHaveLength(wifi.incident_count);
    expect((await w.o.get(`${w.P}/r/problem_candidate/${wifi.id}`)).row.state).toBe("merged");
    // an open problem on the same subcategory covers new recurrences
    await w.o.patch(`${w.P}/r/problem/${existing.id}`, { category: "network", subcategory: "network.wifi" });
    for (const s of ["وای‌فای دوباره قطع", "وای‌فای کند", "وای‌فای وصل نمی‌شود"]) await w.incident({ short_description: s, category: "network", subcategory: "network.wifi" });
    const third = await w.o.post(`${w.P}/problem/candidates/run`);
    expect(third.created).toBe(0);
    // only problem people run the rules
    await w.p.req.client.post(`${w.P}/problem/candidates/run`, {}, 403);
  });
});

describe("the daily sweep", () => {
  it("reminds about inactive problems, ends the monitoring window and asks for known-error reviews", async () => {
    const idle = await create({ assigned_to: w.p.agent.userId });
    await backdate(w.e, "sm_problems", idle.id, "last_activity_at", 30);
    const watched = await create();
    await go(watched.id, "rca");
    await go(watched.id, "fix_in_progress", { cause_notes: "علت" });
    await go(watched.id, "resolved", { fix_notes: "رفع" });
    await backdate(w.e, "sm_problems", watched.id, "fix_at", 40);
    await w.e.db.query(`update sm_problems set monitoring_until = current_date - 1 where id = $1`, [watched.id]);
    await w.o.post(`${w.P}/problem/${watched.id}/link-incidents`, { incident_ids: [(await w.incident({ short_description: "دوباره رخ داد" })).id] });
    const ke = (await w.o.post(`${w.P}/r/known_error`, { short_description: "خطای قدیمی", symptoms: "x", workaround: "y", owner_id: w.p.agent.userId })).row;
    await w.o.post(`${w.P}/r/known_error/${ke.id}/transition`, { to: "published" });
    await w.e.db.query(`update sm_known_errors set review_at = current_date - 1 where id = $1`, [ke.id]);
    const r = await problemSweep(w.sys);
    expect(r.reminded).toBeGreaterThanOrEqual(1);
    expect((await prb(idle.id)).reminded_at).toBeTruthy();
    expect(r.monitored).toBe(1);
    expect((await notes("problem", watched.id)).some((n) => n.body.includes("۱ رخداد تازه") || n.body.includes("1 رخداد تازه"))).toBe(true);
    expect(r.reviews).toBe(1);
    expect(Date.parse((await w.o.get(`${w.P}/r/known_error/${ke.id}`)).row.review_at)).toBeGreaterThan(Date.now());
    const again = await problemSweep(w.sys);
    expect([again.monitored, again.reviews]).toEqual([0, 0]);
    expect(again.reminded).toBe(0);
  });
});

describe("access and the dashboard", () => {
  it("requesters do not touch problems; agents of other groups read but do not work them", async () => {
    await w.p.req.client.post(`${w.P}/r/problem`, { short_description: "x" }, 403);
    const p = await create({ assignment_group_id: w.g.desk });
    await w.p.other.client.get(`${w.P}/r/problem/${p.id}`);
    await w.p.other.client.post(`${w.P}/problem/${p.id}/known-error`, {}, 403);
    await w.p.other.client.post(`${w.P}/problem/${p.id}/share`, { kind: "workaround" }, 403);
    const meta = (await w.p.agent.client.get(`${w.P}/r/problem/${p.id}`)).meta.problem;
    expect([meta.can_work, meta.can_manage]).toEqual([true, false]);
    expect((await w.p.pm.client.get(`${w.P}/r/problem/${p.id}`)).meta.problem.can_manage).toBe(true);
  });

  it("answers the dashboard", async () => {
    const d = await w.o.get(`${w.P}/problem/dashboard?days=90`);
    expect(d.open.total).toBeGreaterThan(0);
    expect(d.coverage.linked).toBeGreaterThan(0);
    expect(d.known_errors.active).toBeGreaterThan(0);
    expect(d.top.length).toBeGreaterThan(0);
    expect(d.ageing.map((x: any) => x.key)).toEqual(["0-30", "30-90", "90-180", "180+"]);
  });
});

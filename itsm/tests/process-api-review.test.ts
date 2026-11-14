// F4c review fixes (design F §5, §6.2, §7.2): each case failed before its fix.
//   · F4c-1: a resumed case's timers count on from where they stopped — an escalation (an `auto` decision) or a
//     reminder whose time fell inside the pause does not fire at the resume, and still fires once its time comes;
//   · F4c-2: a manager's «ارجاع» keeps the step's exclusions (never to the requester of an approve step);
//   · F4c-3: pause, resume and «ارجاع» need the case read first (a publisher of an unmanaged case gets a 404);
//   · F4c-4: a step that waits for several decisions is not taken, and a claim ends once its taker's task moves on;
//   · F4c-5: my open step shows my refused submission (its message and my values), my history its message, and
//     «پرونده‌ها» my starts not sent yet;
//   · F4c-6: a confidential process without managers is not published.
import { describe, it, expect, beforeAll } from "vitest";
import { uuidv7 } from "@shared/id";
import { create } from "@server/engine";
import { casesList, caseDetail, claimStep, pauseCase, reassignStep, resumeCase, submitStep } from "@server/modules/process/api";
import { checkDraft } from "@server/modules/process/publish/service";
import { cleanDraft } from "@server/modules/process/publish/draft";
import type { ProcessGraph } from "@shared/process/graph";
import { edge, kase, node, openTask, person, publish, start, tasks, users, world, type World } from "./process-engine-helpers";

let w: World;
const P: Record<string, string> = {};
const MIN = 60_000;

beforeAll(async () => {
  w = await world();
  for (const k of ["r", "a", "b", "c", "mgr", "pub"]) P[k] = await person(w, `شخص ${k}`);
  await w.o.owner.put(`${w.P}/access/members/${P.pub}`, { roles: ["process_publisher"] });
}, 600_000);

const approve = (extra: Record<string, unknown>): ProcessGraph => ({
  nodes: [
    node("t", "trigger"),
    node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
    node("a1", "form_step", { action: "approve", form: w.forms.review, rights: { default: "read", fields: { u_finance_note: "edit" } }, ...extra }, "تأیید"),
    node("ok", "end", { outcome: "completed" }),
    node("no", "end", { outcome: "rejected" }),
  ],
  edges: [edge("t", "s"), edge("s", "a1"), edge("a1", "ok", "approved"), edge("a1", "no", "rejected")],
});

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return { status: (e as { status?: number }).status, message: (e as Error).message };
  }
};
const runTimers = async () => {
  await w.o.db.query(`update sm_jobs set run_at = now() where kind = 'process.timer' and status = 'queued'`);
  await w.k.drain();
};
const ms = (v: unknown) => new Date(v as string).getTime();

describe("F4c review fixes", () => {
  it("F4c-1: a resumed case's escalations and reminders count on from where they stopped, and still come", async () => {
    const proc = await publish(
      w,
      approve({ ...users(P.a), business: false, remind_every: { amount: 30, unit: "minute" }, escalate: [{ after: { amount: 1, unit: "hour" }, action: "auto", outcome: "approved" }] }),
      { managers: [P.mgr] },
    );
    const c = (await start(w, P.r, proc, { values: { u_amount: "100" } })).case!;
    await w.k.drain();
    await pauseCase(await w.o.ctxOf(P.mgr), c, {});
    // the step opened 2 h ago and was paused a minute later: 119 minutes passed while it was paused
    await w.o.db.query(`update sm_process_tasks set opened_at = now() - interval '2 hours' where case_id = $1`, [c]);
    await w.o.db.query(`update sm_process_cases set paused_at = now() - interval '119 minutes' where id = $1`, [c]);
    await resumeCase(await w.o.ctxOf(P.mgr), c, {});
    await runTimers();
    const [t] = (await tasks(w, c)).filter((x) => x.step_key === "a1");
    expect({ status: t.status, state: (await kase(w, c)).state }).toEqual({ status: "open", state: "active" });
    const row = (await w.o.db.one<{ opened_at: unknown; timers_from: unknown; reminded_at: unknown }>(`select opened_at, timers_from, reminded_at from sm_process_tasks where id = $1`, [t.id]))!;
    // no reminder at the resume; «زمان ارجاع» stays the real one, and the timers count from a minute before the resume
    expect(row.reminded_at).toBeNull();
    expect(Math.abs(ms(row.opened_at) - (Date.now() - 120 * MIN))).toBeLessThan(MIN);
    expect(Math.abs(ms(row.timers_from) - (Date.now() - MIN))).toBeLessThan(MIN);
    // once the hour of the step's own time has passed, the escalation decides it
    await w.o.db.query(`update sm_process_tasks set timers_from = now() - interval '61 minutes' where id = $1`, [t.id]);
    await runTimers();
    expect((await kase(w, c)).state).toBe("completed");
  }, 180_000);

  it("F4c-2: a manager's «ارجاع» never hands an approval to the case's requester", async () => {
    const proc = await publish(w, approve({ ...users(P.a) }), { managers: [P.r] });
    const c = (await start(w, P.r, proc, { values: { u_amount: "300" } })).case!;
    await w.k.drain();
    const ta = await openTask(w, c, "a1", P.a);
    expect(await failure(reassignStep(await w.o.ctxOf(P.r), c, { step: "a1", task: ta, to: [P.r] }))).toEqual({ status: 400, message: "درخواست‌دهنده این مرحله را انجام نمی‌دهد" });
    expect((await tasks(w, c)).filter((t) => t.step_key === "a1").map((t) => [t.assigned_to, t.status])).toEqual([[P.a, "open"]]);
    // another person is fine
    await reassignStep(await w.o.ctxOf(P.r), c, { step: "a1", task: ta, to: [P.b] });
    expect((await tasks(w, c)).filter((t) => t.step_key === "a1" && t.status === "open").map((t) => t.assigned_to)).toEqual([P.b]);
  }, 180_000);

  it("F4c-3: pause, resume and «ارجاع» need the case read first", async () => {
    const proc = await publish(w, approve({ ...users(P.a) }), { managers: [] });
    const c = (await start(w, P.r, proc, { values: { u_amount: "400" } })).case!;
    await w.k.drain();
    const pub = await w.o.ctxOf(P.pub);
    expect(await failure(reassignStep(pub, c, { step: "a1", to: [P.pub] }))).toMatchObject({ status: 404 });
    expect(await failure(pauseCase(pub, c, {}))).toMatchObject({ status: 404 });
    expect((await tasks(w, c)).some((t) => t.assigned_to === P.pub)).toBe(false);
    expect((await w.o.db.one<{ paused_at: unknown }>(`select paused_at from sm_process_cases where id = $1`, [c]))?.paused_at).toBeNull();
    // the organisation's owner reads this case and manages it (it names no manager)
    const owner = await w.o.ctxOf(w.o.ownerId);
    await pauseCase(owner, c, {});
    expect(await failure(resumeCase(pub, c, {}))).toMatchObject({ status: 404 });
    await resumeCase(owner, c, {});
  }, 180_000);

  it("F4c-4: a step that waits for every approver is not taken, and a claim ends once its taker's task moves on", async () => {
    const all = await publish(w, approve({ ...users(P.a, P.b), quorum: "all" }), { managers: [P.mgr] });
    const c1 = (await start(w, P.r, all, { values: { u_amount: "200" } })).case!;
    await w.k.drain();
    expect(await failure(claimStep(await w.o.ctxOf(P.a), await openTask(w, c1, "a1", P.a)))).toEqual({ status: 409, message: "این مرحله تصمیم چند نفر را می‌خواهد و برداشتنی نیست" });

    const pool = await publish(w, approve({ ...users(P.a, P.b), quorum: "any" }), { managers: [P.mgr] });
    const c2 = (await start(w, P.r, pool, { values: { u_amount: "210" } })).case!;
    await w.k.drain();
    const ta = await openTask(w, c2, "a1", P.a);
    const tb = await openTask(w, c2, "a1", P.b);
    await claimStep(await w.o.ctxOf(P.a), ta);
    expect(await failure(submitStep(await w.o.ctxOf(P.b), tb, { outcome: "approved" }))).toMatchObject({ status: 409 });
    // the manager moves a's task to c: a's claim ends, and b may decide
    await reassignStep(await w.o.ctxOf(P.mgr), c2, { step: "a1", task: ta, to: [P.c] });
    const claims = await w.o.db.query<{ claimed_by: string | null }>(`select claimed_by from sm_process_tasks where case_id = $1 and step_key = 'a1' and status = 'open'`, [c2]);
    expect(claims.map((x) => x.claimed_by)).toEqual([null, null]);
    await submitStep(await w.o.ctxOf(P.b), tb, { outcome: "approved" });
    await w.k.drain();
    expect((await kase(w, c2)).state).toBe("completed");
  }, 180_000);

  it("F4c-5: my refused submission, its message and my values; my starts not sent yet", async () => {
    const proc = await publish(w, approve({ ...users(P.a) }), { managers: [P.mgr] });
    const c = (await start(w, P.r, proc, { values: { u_amount: "500", u_need: "میز" } })).case!;
    await w.k.drain();
    const ta = await openTask(w, c, "a1", P.a);
    const note = "پیوست «فاکتور پیش» نرسید؛ مرحله را دوباره بفرستید";
    // what a linked Windows app's push leaves on the authority once refused (and the pull brings back)
    const sub = (await create(w.sys, "process_submission", {
      kind: "step", task_id: ta, case_id: c, step_key: "a1", round: 1, outcome: "approved", values: { u_finance_note: "تأیید با شرط", u_secret: "x" },
      submitted_by: P.a, submitted_at: new Date().toISOString(), result: "refused", result_note: note,
    }, { trusted: true })).row;
    const mine = await caseDetail(await w.o.ctxOf(P.a), c);
    expect(mine.my_steps[0].refused).toMatchObject({ id: sub.id, note, values: { u_finance_note: "تأیید با شرط" } });
    expect(mine.history.submissions.find((s) => s.id === sub.id)).toMatchObject({ result: "refused", result_note: note });
    // nobody else sees my refusal
    expect((await caseDetail(await w.o.ctxOf(P.mgr), c)).history.submissions.some((s) => s.id === sub.id)).toBe(false);

    const queued = (await create(w.sys, "process_submission", {
      kind: "start", process_id: proc.process, case_id: uuidv7(), values: { u_amount: "600" }, submitted_by: P.r, submitted_at: new Date().toISOString(), result: "pending",
    }, { trusted: true })).row;
    const list = await casesList(await w.o.ctxOf(P.r), {});
    expect(list.queued_starts).toEqual([expect.objectContaining({ id: queued.id, case_id: queued.case_id, process_id: proc.process, process_name: expect.any(String) })]);
    expect((await casesList(await w.o.ctxOf(P.a), {})).queued_starts).toEqual([]);
  }, 180_000);

  it("F4c-6: a confidential process needs a manager to be published", async () => {
    const owner = await w.o.ctxOf(w.o.ownerId);
    const draft = (more: Record<string, unknown>) => cleanDraft({ graph: approve({ ...users(P.a) }), ...more });
    const errors = async (more: Record<string, unknown>) => (await checkDraft(owner, draft(more))).problems.filter((p) => p.field === "managers").map((p) => `${p.level}: ${p.message}`);
    expect(await errors({ confidential: true })).toEqual(["error: گردش‌کار محرمانه دست‌کم یک مسئول می‌خواهد"]);
    expect(await errors({ confidential: true, managers: [P.mgr] })).toEqual([]);
    expect(await errors({ confidential: false })).toEqual(["warning: این گردش‌کار مسئولی ندارد؛ پرونده‌های متوقف به مدیران سازمان سپرده می‌شوند"]);
  }, 180_000);
});

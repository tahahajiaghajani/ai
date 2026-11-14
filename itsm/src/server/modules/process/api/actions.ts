// What people do to cases from «گردش‌کارها» (design F §5, §6.1, §6.7, §7.1, package F4c), each where cases advance
// («این کار به اتصال نیاز دارد» elsewhere, but a step's submission, which a linked Windows app records and pushes):
//   · «برداشتن کار» on a pool step: the round's tasks name who took it («در دست علی احمدی»); online, the others then
//     cannot send it until it is put back (offline anyone in the pool may still submit; the first apply wins);
//   · managers (named, by group, or — for a case that names none — the organisation's administrators):
//     – «ارجاع»: a step's open task moves to other people, or a step that found nobody gets people; the round stays;
//     – «توقف موقت» / «ادامه»: nobody acts and the timers wait while it is paused; open steps' due times move on by
//       the pause when it resumes;
//     – «لغو پرونده» and «ادامه از مرحلهٔ …» (F4b's recovery services).
//   A requester's «لغو» (before any step after the start was done) is a submission (F4a).
// Each is one transaction under the case's lock, journaled on the case and, for the managers' actions, recorded in
// «گزارش رویدادها».
import { durationMs, formStepOf, processNodeLabel } from "@shared/process/graph";
import { addBusiness } from "@shared/sla/calendar";
import type { Ctx } from "../../../context";
import { pgArray, type Tx } from "../../../db";
import { bad, conflict, forbidden, notFound } from "../../../http/errors";
import { createIn, get, isSystemCtx, orgTz, systemCtx, updateIn } from "../../../engine";
import { audit } from "../../data/crud";
import { Resolution } from "../../positions";
import { config as slaConfig } from "../../sla/common";
import { calendarsOf } from "../../sla/calendars";
import { OPEN_STATES, processesRunHere, refreshCase, cancelCase, submitTask, startCase, type StartCaseInput, type SubmitTaskInput } from "../engine";
import { caseJournal } from "../engine/journal";
import { caseTasks, isId, loadVersionInfo, lockCase, peopleNames, type CaseRow } from "../engine/store";
import { cancelAsManager, resumeFromStep } from "../recovery";
import { wakeTimer } from "../timers/timer";
import { managesCase } from "./common";
import { emitWaiting } from "./notices";

export const CONNECTION_NEEDED = "این کار به اتصال نیاز دارد";
const NOT_MANAGER = "این کار با مسئولان این گردش‌کار است";
const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown): number => (v instanceof Date ? v.getTime() : v === null || v === undefined || v === "" ? NaN : Date.parse(String(v)));
const who = (ctx: Ctx) => (isSystemCtx(ctx) ? "سامانه" : ctx.user.full_name || ctx.user.email);
const comment = (v: unknown) => String(v ?? "").trim().slice(0, 1000);

async function needAuthority(ctx: Ctx): Promise<void> {
  if (!(await processesRunHere(ctx.cfg, ctx.org.id))) throw conflict(CONNECTION_NEEDED);
}

interface TaskRef {
  id: string;
  case_id: string;
  step_key: string;
  round: number;
  status: string;
  assigned_to: string | null;
  delegated_from: string | null;
  claimed_by: string | null;
  due_at: unknown;
}

const taskOf = (tx: Tx, orgId: string, id: string) =>
  isId(id)
    ? tx.one<TaskRef>(`select id, case_id, step_key, round, status, assigned_to, delegated_from, claimed_by, due_at from sm_process_tasks where org_id = $1 and id = $2 and deleted_at is null for update`, [orgId, id.toLowerCase()])
    : Promise.resolve(null);

// ----- start and submit (the engine's services; online a pool step someone took is theirs) --------------------

export const startProcess = (ctx: Ctx, input: StartCaseInput) => startCase(ctx, input);

/** «ارسال» of my step: refused online while someone else took the pool step («در دست …»). */
export async function submitStep(ctx: Ctx, taskId: string, input: SubmitTaskInput) {
  const t = isId(taskId)
    ? await ctx.db.one<{ case_id: string; step_key: string; round: number; claimed_by: string | null }>(
        `select case_id, step_key, round, claimed_by from sm_process_tasks where org_id = $1 and id = $2 and deleted_at is null`,
        [ctx.org.id, taskId.toLowerCase()],
      )
    : null;
  if (!t) throw notFound("این مرحله پیدا نشد");
  if (t.claimed_by && t.claimed_by !== ctx.user.id && (await processesRunHere(ctx.cfg, ctx.org.id))) {
    const name = (await peopleNames(ctx.db, [t.claimed_by])).get(t.claimed_by) ?? "همکارتان";
    throw conflict(`این مرحله در دست ${name} است`);
  }
  return submitTask(ctx, taskId, input);
}

// ----- «برداشتن کار» ----------------------------------------------------------------------------------------------

/** Take (or, with `release`, put back) a pool step: every open task of its round names the taker. */
export async function claimStep(ctx: Ctx, taskId: string, opts: { release?: boolean } = {}): Promise<{ claimed_by: string | null }> {
  await needAuthority(ctx);
  const me = ctx.user.id;
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  return sys.write(async (tx) => {
    const first = await taskOf(tx, ctx.org.id, taskId);
    if (!first) throw notFound("این مرحله پیدا نشد");
    const kase = await lockCase(tx, ctx.org.id, first.case_id);
    const t = await taskOf(tx, ctx.org.id, taskId);
    if (!kase || !t) throw notFound("این مرحله پیدا نشد");
    if (t.assigned_to !== me && t.delegated_from !== me) throw forbidden("این مرحله به شما سپرده نشده است");
    if (t.status !== "open" || !OPEN_STATES.has(kase.state)) throw conflict("این مرحله دیگر باز نیست");
    const round = (await caseTasks(tx, ctx.org.id, kase.id)).filter((x) => x.step_key === t.step_key && Number(x.round) === Number(t.round) && x.status === "open");
    if (opts.release) {
      if (t.claimed_by !== me) throw conflict("این مرحله را شما برنداشته‌اید");
      for (const x of round) await updateIn(tx, sys, "process_task", x.id, { claimed_by: null }, { trusted: true });
      return { claimed_by: null };
    }
    if (t.claimed_by && t.claimed_by !== me) {
      const name = (await peopleNames(tx, [t.claimed_by])).get(t.claimed_by) ?? "همکارتان";
      throw conflict(`این مرحله در دست ${name} است`);
    }
    for (const x of round) await updateIn(tx, sys, "process_task", x.id, { claimed_by: me }, { trusted: true });
    return { claimed_by: me };
  });
}

// ----- the managers' actions ---------------------------------------------------------------------------------

async function managedCase(tx: Tx, ctx: Ctx, caseId: string): Promise<CaseRow> {
  const kase = isId(caseId) ? await lockCase(tx, ctx.org.id, caseId) : null;
  if (!kase) throw notFound("پرونده پیدا نشد");
  if (!(await managesCase(tx, ctx, kase))) throw forbidden(NOT_MANAGER);
  return kase;
}

export interface ReassignInput {
  /** the step (its node key) */
  step: string;
  /** the task that moves (omitted: people are added to a step that found nobody) */
  task?: string | null;
  /** who takes it */
  to: string[];
  comment?: string | null;
}

/** «ارجاع» by a manager (see the header). */
export async function reassignStep(ctx: Ctx, caseId: string, input: ReassignInput): Promise<{ tasks: string[] }> {
  await needAuthority(ctx);
  const to = [...new Set((input.to ?? []).filter(isId).map((x) => x.toLowerCase()))].slice(0, 50);
  if (!to.length) throw bad("کسی را برای ارجاع برگزینید");
  const note = comment(input.comment);
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  return sys.write(async (tx) => {
    const kase = await managedCase(tx, ctx, caseId);
    if (!OPEN_STATES.has(kase.state) || kase.state === "attention") throw conflict("مرحله‌های این پرونده ارجاع نمی‌شوند؛ پرونده باز نیست یا نیاز به بررسی دارد");
    const version = await loadVersionInfo(tx, ctx.org.id, kase.version_id);
    const node = version?.graph.nodes.find((n) => n.id === input.step && n.type === "form_step");
    const round = Number(kase.open_rounds?.[input.step]);
    if (!version || !node || !round) throw bad("این مرحله در پرونده باز نیست");
    const step = formStepOf(node.config);
    const label = processNodeLabel(node);
    const tasks = await caseTasks(tx, ctx.org.id, kase.id);
    const open = tasks.filter((t) => t.step_key === node.id && Number(t.round) === round && t.status === "open");
    let moved: (typeof open)[number] | null = null;
    if (input.task) {
      moved = open.find((t) => t.id === String(input.task).toLowerCase()) ?? null;
      if (!moved) throw conflict("این کار دیگر باز نیست");
    }
    // the people: active members, through today's delegations; those already holding the round are skipped
    const live = new Set(
      (await tx.query<{ user_id: string }>(
        `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = any($2::uuid[]) and m.deleted_at is null and m.is_active and not coalesce(u.disabled, false)`,
        [ctx.org.id, pgArray(to)],
      )).map((r) => String(r.user_id)),
    );
    if (to.some((u) => !live.has(u))) throw bad("یکی از کسانی که برگزیده‌اید عضو فعال سازمان نیست");
    const settled = await new Resolution(tx, sys, { step: { assignees: [] }, action: step.action, requestedBy: kase.requested_by }).settle(
      to.map((user) => ({ user, via: { rule: 0, kind: "users" as const } })),
      new Set(),
    );
    const people = settled.filter((p) => !open.some((t) => t.id !== moved?.id && (t.assigned_to === p.user || t.delegated_from === p.user)));
    if (!people.length) throw conflict("کسانی که برگزیده‌اید این مرحله را در دست دارند");
    const now = Date.now();
    if (moved) await updateIn(tx, sys, "process_task", moved.id, { status: "not_needed", closed_at: iso(now) }, { trusted: true });
    const was = moved ? msOf((await tx.one<{ due_at: unknown }>(`select due_at from sm_process_tasks where id = $1`, [moved.id]))?.due_at) : NaN;
    let due: string | null = Number.isFinite(was) ? iso(was) : null;
    if (!moved && step.due) {
      const ms = durationMs(step.due);
      try {
        const { byId, defaultId } = calendarsOf(await slaConfig(tx, sys), orgTz(sys));
        due = iso(step.business === false ? now + ms : addBusiness(defaultId ? byId.get(defaultId) ?? null : null, now, ms) ?? now + ms);
      } catch {
        due = iso(now + ms);
      }
    }
    const made: string[] = [];
    for (const p of people) {
      const row = await createIn(
        tx, sys, "process_task",
        {
          case_id: kase.id, case_number: kase.number, case_title: kase.title, process_id: kase.process_id, version_id: kase.version_id, step_key: node.id, step_label: label,
          action: step.action, round, assigned_to: p.user, delegated_from: p.delegatedFrom, status: "open", opened_at: iso(now), due_at: due,
        },
        { trusted: true },
      );
      made.push(String(row.id));
    }
    await refreshCase(tx, sys, kase, version.graph);
    const names = await peopleNames(tx, [moved?.assigned_to, ...people.map((p) => p.user)]);
    const toNames = people.map((p) => names.get(p.user) ?? "—").join("، ");
    const from = moved?.assigned_to ? ` از ${names.get(moved.assigned_to) ?? "—"}` : "";
    await caseJournal(tx, sys, kase, `${who(ctx)} (مسئول گردش‌کار) «${label}» را${from} به ${toNames} سپرد${note ? `: ${note}` : ""}`, { author: isSystemCtx(ctx) ? null : ctx.user.id, data: { step: node.id, round, to: people.map((p) => p.user), from: moved?.assigned_to ?? null } });
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.reassign", "process_case", kase.id, `${kase.number ?? ""}: ارجاع «${label}»`, { step: node.id, round, to: people.map((p) => p.user), from: moved?.assigned_to ?? null, comment: note || null });
    await emitWaiting(tx, ctx.org.id, kase, people.map((p) => p.user), label, false, isSystemCtx(ctx) ? null : ctx.user.id);
    await wakeTimer(tx, ctx.org.id, now);
    return { tasks: made };
  });
}

/** «توقف موقت» by a manager. */
export async function pauseCase(ctx: Ctx, caseId: string, input: { comment?: string | null } = {}): Promise<{ paused_at: string }> {
  await needAuthority(ctx);
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const note = comment(input.comment);
  return sys.write(async (tx) => {
    const kase = await managedCase(tx, ctx, caseId);
    if (!OPEN_STATES.has(kase.state) || kase.state === "attention") throw conflict("فقط پرونده‌ای که در جریان است موقتاً متوقف می‌شود");
    if (kase.paused_at) throw conflict("این پرونده پیش‌تر متوقف شده است");
    const at = iso(Date.now());
    await updateIn(tx, sys, "process_case", kase.id, { paused_at: at, state: "waiting" }, { trusted: true });
    await caseJournal(tx, sys, kase, `${who(ctx)} (مسئول گردش‌کار) پرونده را موقتاً متوقف کرد${note ? `: ${note}` : ""}`, { author: isSystemCtx(ctx) ? null : ctx.user.id, data: { paused: true } });
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.pause", "process_case", kase.id, `${kase.number ?? ""}: توقف موقت`, { comment: note || null });
    return { paused_at: at };
  });
}

/** «ادامه» of a paused case: its open steps' due times move on by the pause, and its timers wake. */
export async function resumeCase(ctx: Ctx, caseId: string, input: { comment?: string | null } = {}): Promise<{ state: string }> {
  await needAuthority(ctx);
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const note = comment(input.comment);
  return sys.write(async (tx) => {
    const kase = await managedCase(tx, ctx, caseId);
    if (!kase.paused_at || !OPEN_STATES.has(kase.state)) throw conflict("این پرونده متوقف نشده است");
    const now = Date.now();
    const pausedFor = Math.max(0, now - msOf(kase.paused_at));
    const tasks = await caseTasks(tx, ctx.org.id, kase.id);
    for (const t of tasks.filter((x) => x.status === "open")) {
      const due = await tx.one<{ due_at: unknown }>(`select due_at from sm_process_tasks where id = $1`, [t.id]);
      const d = msOf(due?.due_at);
      if (Number.isFinite(d) && pausedFor > 0) await updateIn(tx, sys, "process_task", t.id, { due_at: iso(d + pausedFor) }, { trusted: true });
    }
    const version = await loadVersionInfo(tx, ctx.org.id, kase.version_id);
    const set = { paused_at: null };
    const row = version ? await refreshCase(tx, sys, kase, version.graph, { tasks, set }) : await updateIn(tx, sys, "process_case", kase.id, { ...set, state: "active" }, { trusted: true });
    await caseJournal(tx, sys, kase, `${who(ctx)} (مسئول گردش‌کار) پرونده را ادامه داد${note ? `: ${note}` : ""}`, { author: isSystemCtx(ctx) ? null : ctx.user.id, data: { paused: false } });
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.resume", "process_case", kase.id, `${kase.number ?? ""}: ادامهٔ پرونده`, { comment: note || null, paused_ms: pausedFor });
    await wakeTimer(tx, ctx.org.id, now);
    return { state: String(row.state ?? "active") };
  });
}

/** «لغو پرونده»: a manager's (any open case) or the requester's (a submission, before any step after the start). */
export async function cancelCaseAs(ctx: Ctx, caseId: string, input: { comment?: string | null } = {}) {
  if (!isId(caseId)) throw notFound("پرونده پیدا نشد");
  await get(ctx, "process_case", caseId);
  const kase = isId(caseId) ? await ctx.db.one<CaseRow>(`select managers, manager_groups from sm_process_cases where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, caseId.toLowerCase()]) : null;
  if (!kase) throw notFound("پرونده پیدا نشد");
  if (await managesCase(ctx.db, ctx, kase)) {
    await cancelAsManager(ctx, caseId, input);
    return { result: "applied" as const, by: "manager" as const };
  }
  const r = await cancelCase(ctx, caseId, input);
  return { ...r, by: "requester" as const };
}

/** «ادامه از مرحلهٔ …» (a case that needs attention). */
export const resumeFrom = (ctx: Ctx, caseId: string, input: { node: string; comment?: string | null }) => resumeFromStep(ctx, caseId, input.node, { comment: input.comment });

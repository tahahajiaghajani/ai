// `process.timer` (design F §3.5 «Step SLA and escalation», §3.6.3, package F4b): one job per organisation, on the
// authority only, that looks after the open rounds of form steps with a time:
//   · «یادآوری مرحله» every `remind_every` to each person still waiting (calendar time, from the opening or the last);
//   · escalations, in the order of their time (`after`, counted from the round's opening — moved on by the time the
//     case was paused, `timers_from` — business time unless the step says otherwise), each once — `notify` the
//     person's manager, the holders of the position's «گزارش به» nearest up from the unit the open task is held in who
//     may be told (a unit whose holders may not be told is passed over, with a note; the process managers when there
//     are none) or the process managers — those who may be told become readers of the case first, and the journal
//     names whom it reached (engine/readers.ts); a manager or holders named of whom none may be told: the process
//     managers instead, with the reasons; `reassign` the round to the people of other rules; `auto` decide it with an
//     outcome;
//   · the step's «پایان مهلت» port, when it is wired: at the due time the round settles on it.
// Each round is handled in its own transaction under the case's lock, with its wait still there and its round open —
// a person's submit that took the lock first wins, and the timer then finds nothing to do (and the reverse: a submit
// after the timer settled the round is late). A pass reads every open round's times in one query per step and locks
// only the rounds with something due; it stops at its tick's budget, and a round that throws is logged and skipped.
// It also re-checks submissions still pending (a missed event, ../sync), each on its own.
// The timer is the organisation's own job (never demo work, FINAL-5), but a round of a demo pack's case is handled
// inside that case's demo scope (docs/DEMO_FA.md): the reminders, escalations, reassignments and decisions it writes
// are the pack's rows, which the purge takes with it.
// The job sleeps until the next time it knows of (at least a minute, at most an hour while anything is watched); a
// step that opens with a time, and every pushed submission, wake it (`wakeTimer`).
import { addBusiness, type BusinessCalendar } from "@shared/sla/calendar";
import { durationMs, formStepOf, OUTCOME_PORT, outEdges, processNodeLabel, stepOutcomes, type Duration, type FormStep, type StepOutcome } from "@shared/process/graph";
import type { AssigneeRule } from "@shared/process/assignees";
import type { Ctx, ServerConfig } from "../../../context";
import { pgArray, type Queryable, type Tx } from "../../../db";
import { createIn, orgTz, systemCtx, updateIn } from "../../../engine";
import { inDemoScope, isDemoRow } from "../../../db/scope";
import { localDate } from "@shared/model/jalali-buckets";
import { enqueue } from "../../../jobs";
import { resumeFlowWait } from "../../flows";
import { notifyPeople } from "../../notify/deliver";
import { Resolution, resolveAssignees } from "../../positions";
import { config as slaConfig } from "../../sla/common";
import { calendarsOf } from "../../sla/calendars";
import { processesRunHere, refreshCase, resolveInput } from "../engine";
import { caseJournal } from "../engine/journal";
import { mayBeTold, nameList, tellCase, type Audience } from "../engine/readers";
import { caseTasks, isId, loadVersionInfo, lockCase, peopleNames, stepWaitKey, type CaseRow, type VersionInfo } from "../engine/store";
import { noticeRecipients, waitingLine } from "../engine/waiting";

export const TIMER_JOB = "process.timer";
/** Pending submissions are looked at again at least this often while any wait. */
export const RECHECK_MS = 3_600_000;
const MIN_SLEEP = 60_000;

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown): number => (v instanceof Date ? v.getTime() : v === null || v === undefined || v === "" ? NaN : Date.parse(String(v)));

/** Make sure the organisation's timer runs by `at` (a queued one later than that is brought forward). */
export async function wakeTimer(q: Queryable, orgId: string, at: number): Promise<void> {
  const when = iso(Math.max(at, Date.now()));
  await enqueue(q, { kind: TIMER_JOB, orgId, runAt: when, dedupeKey: TIMER_JOB, maxAttempts: 50 });
  await q.query(`update sm_jobs set run_at = $3::timestamptz where org_id = $1 and dedupe_key = $2 and status = 'queued' and run_at > $3::timestamptz`, [orgId, TIMER_JOB, when]);
}

/** Does a step keep a time the timer looks after? */
export function hasTimers(graph: VersionInfo["graph"], nodeId: string, step: FormStep): boolean {
  return !!step.remind_every || !!step.escalate?.length || (!!step.due && outEdges(graph, nodeId, "timeout").length > 0);
}

/** The first time a step opened at `opened` needs the timer (calendar time: never later than the business one). */
export function firstTimer(step: FormStep, opened: number, due: number | null): number | null {
  const at = [
    due ?? NaN,
    step.remind_every ? opened + durationMs(step.remind_every) : NaN,
    ...(step.escalate ?? []).map((e) => opened + durationMs(e.after)),
  ].filter(Number.isFinite);
  return at.length ? Math.min(...at) : null;
}

export interface Clock {
  cal: BusinessCalendar | null;
}

/** `from` plus a duration: business time in the organisation's calendar unless the step says otherwise. */
function plus(clock: Clock, step: FormStep, from: number, d: Duration): number {
  const ms = durationMs(d);
  if (step.business === false || !clock.cal) return from + ms;
  return addBusiness(clock.cal, from, ms) ?? from + ms;
}

interface RoundTask {
  id: string;
  assigned_to: string | null;
  delegated_from: string | null;
  status: string;
  opened_at: unknown;
  due_at: unknown;
  reminded_at: unknown;
  escalated_at: unknown;
  timers_from: unknown;
}

/** Where a task's timers count from: its opening, or later when the case was paused meanwhile. */
const fromOf = (t: { opened_at: unknown; timers_from: unknown }) => {
  const f = msOf(t.timers_from);
  return Number.isFinite(f) ? f : msOf(t.opened_at);
};

const roundTasks = (tx: Tx, orgId: string, caseId: string, node: string, round: number) =>
  tx.query<RoundTask>(
    `select id, assigned_to, delegated_from, status, opened_at, due_at, reminded_at, escalated_at, timers_from from sm_process_tasks
     where org_id = $1 and case_id = $2 and step_key = $3 and round = $4 and deleted_at is null order by opened_at, id`,
    [orgId, caseId, node, round],
  );

/** Members of groups, valid now. */
async function groupMembers(q: Queryable, orgId: string, groups: readonly string[]): Promise<string[]> {
  const ids = groups.filter(isId);
  if (!ids.length) return [];
  const rows = await q.query<{ user_id: string }>(
    `select distinct gm.user_id from sm_group_members gm join sm_groups g on g.id = gm.group_id and g.deleted_at is null and g.active is not false
     where g.org_id = $1 and gm.group_id = any($2::uuid[]) and gm.deleted_at is null
       and (gm.valid_from is null or gm.valid_from <= now()) and (gm.valid_to is null or gm.valid_to > now())`,
    [orgId, pgArray(ids)],
  );
  return rows.map((r) => String(r.user_id));
}

/** The process managers of a case (named, and members of its manager groups). */
export async function caseManagers(q: Queryable, kase: Pick<CaseRow, "org_id" | "managers" | "manager_groups">): Promise<string[]> {
  return [...new Set([...(kase.managers ?? []).filter(isId), ...(await groupMembers(q, kase.org_id, kase.manager_groups ?? []))])];
}

/** Whom an escalation's «باخبر کردن» names. */
interface NoticeTarget {
  users: string[];
  /**
   * «گزارش به» found nobody who may be told, or none of the people the notice named may be told: it goes to the
   * process managers instead, and this says why («… دارنده‌ای ندارد», «… عضو فعال سازمان نیست؛ اعلان به او نرسید»)
   */
  instead?: string;
  /** the process managers stand in: the case names none, so the organisation's administrators are told */
  admins?: boolean;
  /** «گزارش به» went up past units whose holders may not be told: a sentence each («… ؛ اعلان به «…» رسید») */
  passed?: string[];
}

/** Why the holders of «گزارش به» at a level passed over are not told: not active members, or the boundary's other side. */
type Passed = "inactive" | "other";

/**
 * The sentence for a level of the chain whose holders of «گزارش به» may none of them be told («… در «شعبهٔ ونک» عضو
 * فعال سازمان نیست»), as the step's resolver says of a unit it passes over (../../positions/resolve.ts `passedNote`).
 * `unit` null: the holders without a unit (the organisation's, above every unit).
 */
function passedNote(position: string, unit: string | null, demoCase: boolean, whys: Passed[]): string {
  const where = unit ? `در «${unit}»` : "در سطح سازمان";
  const kinds = [...new Set(whys)];
  if (kinds.length > 1) return `اعلان به دارندگان «${position}» ${where} نمی‌رسد`;
  const words: Record<Passed, [string, string]> = {
    inactive: ["عضو فعال سازمان نیست", "عضو فعال سازمان نیستند"],
    // the other side: the pack's people on the organisation's own case; anyone else on a case of the pack
    other: demoCase
      ? ["حساب نمایشی نیست و اعلان پروندهٔ نمایشی به او نمی‌رسد", "حساب نمایشی نیستند و اعلان پروندهٔ نمایشی به آن‌ها نمی‌رسد"]
      : ["حساب نمایشی است", "حساب نمایشی‌اند"],
  };
  return whys.length > 1 ? `دارندگان «${position}» ${where} ${words[kinds[0]][1]}` : `«${position}» ${where} ${words[kinds[0]][0]}`;
}

/** Holders of a position valid on `today` (the organisation's day), by the unit they hold it in ("" for none). */
async function holdersByUnit(tx: Tx, orgId: string, positionId: string, today: string, people?: string[]): Promise<Map<string, string[]>> {
  const rows = await tx.query<{ user_id: string; org_unit_id: string | null }>(
    `select user_id, org_unit_id from sm_position_holders
     where org_id = $1 and position_id = $2 and deleted_at is null
       and (valid_from is null or valid_from <= $3::date) and (valid_to is null or valid_to >= $3::date)${people ? " and user_id = any($4::uuid[])" : ""}
     order by user_id`,
    people ? [orgId, positionId, today, pgArray(people)] : [orgId, positionId, today],
  );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const unit = r.org_unit_id ? String(r.org_unit_id).toLowerCase() : "";
    out.set(unit, [...(out.get(unit) ?? []), String(r.user_id).toLowerCase()]);
  }
  return out;
}

/**
 * The holders of «گزارش به» an escalation tells: for each position rule of the step, the holders of the position it
 * reports to in the nearest unit on the chain up from the units the open tasks' people hold the step's position in —
 * the requester's unit (as the case recorded it) when no open task names one; a holding without a unit is the
 * organisation's, above every unit. The nearest unit with a holder who may be told (./readers.ts `mayBeTold`: the
 * case's side of the demo boundary, an active member): a unit whose holders may none of them be told (they left, the
 * directory's sync lags; the pack's people on the organisation's own case) is passed over, a sentence each in
 * `passed`, as the step's own resolver passes over a unit whose holders cannot take the step (engine-access-2, 1.1.5).
 * Nobody on the way: the process managers instead, and the reason (NB2, 1.1.5).
 */
async function reportsTo(
  tx: Tx,
  sys: Ctx,
  kase: CaseRow,
  step: FormStep,
  label: string,
  open: RoundTask[],
  today: string,
): Promise<{ users: string[]; missing: string | null; passed: string[] }> {
  const refs = step.assignees.filter((r): r is Extract<AssigneeRule, { kind: "position" }> => r.kind === "position").map((r) => r.position);
  const positions = refs.length
    ? await tx.query<{ id: string; reports_to: string | null }>(
        `select id, reports_to from sm_positions where org_id = $1 and deleted_at is null and (key = any($2::text[]) or id::text = any($2::text[]))`,
        [kase.org_id, pgArray(refs)],
      )
    : [];
  const ups = positions.filter((p) => isId(p.reports_to));
  if (!ups.length) return { users: [], missing: `نقش‌های «${label}» نقش «گزارش به» ندارند`, passed: [] };
  const people = [...new Set(open.map((t) => t.delegated_from ?? t.assigned_to).filter(isId).map((x) => x.toLowerCase()))];
  const run = new Resolution(tx, sys, { step: { assignees: [] }, action: step.action, caseId: kase.id, requestedBy: kase.requested_by, requestedFor: kase.requested_for, requesterUnit: kase.unit_id });
  const users = new Set<string>();
  const passed = new Set<string>();
  let missing: string | null = null;
  for (const p of ups) {
    const parent = await tx.one<{ name: string }>(`select name from sm_positions where org_id = $1 and id = $2 and deleted_at is null`, [kase.org_id, p.reports_to]);
    if (!parent) continue;
    // where the open tasks' people hold the step's position (today), else the requester's unit (null: no unit at all)
    const held = people.length ? await holdersByUnit(tx, kase.org_id, p.id, today, people) : new Map<string, string[]>();
    const starts: (string | null)[] = [...held.keys()].filter(Boolean);
    if (!starts.length) starts.push(kase.unit_id ? String(kase.unit_id).toLowerCase() : null);
    const above = await holdersByUnit(tx, kase.org_id, String(p.reports_to), today);
    const sides = await mayBeTold(tx, kase, [...above.values()].flat());
    const able = new Set(sides.able);
    const inactive = new Set(sides.inactive);
    for (const start of starts) {
      const chain = start ? await run.chain(start) : [];
      // the units up from the start, nearest first, then the holdings without a unit
      const levels = [...chain.map((c) => ({ unit: c.name as string | null, holders: above.get(String(c.id).toLowerCase()) ?? [] })), { unit: null, holders: above.get("") ?? [] }];
      const notes: string[] = [];
      const near = levels.find((l) => {
        if (!l.holders.length) return false;
        if (l.holders.some((u) => able.has(u))) return true;
        notes.push(passedNote(parent.name, l.unit, sides.demoCase, l.holders.map((u): Passed => (inactive.has(u) ? "inactive" : "other"))));
        return false;
      });
      if (near) {
        for (const u of near.holders) users.add(u);
        const there = near.unit ? `«${near.unit}»` : `«${parent.name}» در سطح سازمان`;
        for (const n of notes) passed.add(`${n}؛ اعلان به ${there} رسید`);
        continue;
      }
      const other = notes.length ? "دارندهٔ دیگری" : "دارنده‌ای";
      missing ??= [...notes, chain[0] ? `«${parent.name}» در بالادست «${chain[0].name}» ${other} ندارد` : `«${parent.name}» ${other} ندارد`].join("؛ ");
    }
  }
  if (users.size) return { users: [...users], missing: null, passed: [...passed] };
  return { users: [], missing: missing ?? `«گزارش به» نقش‌های «${label}» دارنده‌ای ندارد`, passed: [] };
}

/**
 * Whom an escalation's notice names (`today`: the organisation's day, which the holders' periods are in): the managers
 * (profile) of the people the open tasks are for; the holders of «گزارش به» who may be told (`reportsTo`), or the
 * process managers instead when none is found; the process managers — the administrators when the case names none, as
 * for its other notices (engine/waiting.ts `noticeRecipients`). The first two fall to the process managers too when
 * none of the people named may be told (`roundTimersIn`).
 */
async function noticeTo(tx: Tx, sys: Ctx, kase: CaseRow, step: FormStep, label: string, open: RoundTask[], to: "manager" | "reports_to" | "managers", today: string): Promise<NoticeTarget> {
  if (to === "manager") {
    const people = open.map((t) => t.delegated_from ?? t.assigned_to).filter(isId);
    if (!people.length) return { users: [] };
    const rows = await tx.query<{ manager_id: string | null }>(
      `select manager_id from sm_member_profiles where org_id = $1 and user_id = any($2::uuid[]) and deleted_at is null and manager_id is not null`,
      [kase.org_id, pgArray(people)],
    );
    return { users: rows.map((r) => String(r.manager_id)) };
  }
  if (to === "reports_to") {
    const r = await reportsTo(tx, sys, kase, step, label, open, today);
    if (r.users.length) return { users: r.users, passed: r.passed };
    const m = await noticeRecipients(tx, kase.org_id, kase);
    return { users: m.users, admins: m.admins, instead: r.missing ?? undefined };
  }
  const m = await noticeRecipients(tx, kase.org_id, kase);
  return { users: m.users, admins: m.admins };
}

/**
 * The journal's line of an escalation's «باخبر کردن» (./readers.ts `Audience`): whom it reached, by name — and, a
 * sentence each, the units «گزارش به» passed over and whom it could not reach and why; or that nobody was there to tell.
 */
function noticeLine(label: string, target: NoticeTarget, a: Audience): string {
  const told = nameList(a.names);
  const said = (line: string, more: string[]) => (more.length ? waitingLine(line, more) : line);
  if (target.instead) {
    const who = target.admins ? "مدیران سازمان" : "مسئولان گردش‌کار";
    if (a.told.length) return said(`مهلت «${label}» گذشت؛ ${target.instead}؛ به ${who} (${told}) اطلاع داده شد`, a.untold);
    if (a.untold.length) return said(`مهلت «${label}» گذشت؛ ${target.instead}؛ ${a.untold[0]}`, a.untold.slice(1));
    return `مهلت «${label}» گذشت؛ ${target.instead} و مسئولی برای اطلاع پیدا نشد`;
  }
  const passed = target.passed ?? [];
  if (a.told.length) return said(`مهلت گذشت؛ «${label}» به ${told} اطلاع داده شد`, [...passed, ...a.untold]);
  if (a.untold.length) return said(`مهلت «${label}» گذشت؛ ${a.untold[0]}`, [...a.untold.slice(1), ...passed]);
  return `مهلت «${label}» گذشت؛ کسی برای اطلاع پیدا نشد`;
}

const OUTCOME_WORDS: Record<StepOutcome, string> = { submitted: "ثبت", approved: "تأیید", rejected: "رد", returned: "بازگشت برای اصلاح" };

/**
 * The case as a timer notice's body names it: its number and title — a confidential case by its number alone. A title
 * is filled from the start form's values (@shared/process/title), which a person told of the case may not read in it
 * (a reader told of an overdue step sees none of its values), and the notice's e-mail would carry it out of the app.
 */
export const titled = (kase: Pick<CaseRow, "title" | "confidential">): string => (kase.confidential === true ? "" : ` «${kase.title ?? ""}»`);

/** Settle a round without a person: an `auto` escalation's outcome, or «پایان مهلت». */
async function settleRound(tx: Tx, sys: Ctx, kase: CaseRow, version: VersionInfo, node: string, round: number, open: RoundTask[], decision: StepOutcome | "timeout"): Promise<void> {
  const now = Date.now();
  for (const t of open) await updateIn(tx, sys, "process_task", t.id, { status: "not_needed", closed_at: iso(now) }, { trusted: true });
  const port = decision === "timeout" ? "timeout" : OUTCOME_PORT[decision];
  const outcome = decision === "timeout" ? null : decision;
  await resumeFlowWait(tx, kase.org_id, stepWaitKey(kase.id, node, round), { port, outcome, round, actors: [], auto: true });
  await refreshCase(tx, sys, kase, version.graph, { extra: { [node]: { status: "done", outcome, port, round, at: iso(now), actors: [] } } });
}

type Act = { at: number; kind: "timeout" } | { at: number; kind: "escalate"; esc: NonNullable<FormStep["escalate"]>[number] };

/**
 * One round's timers, under the case's lock (see the header). Returns the next time it needs the timer, or null (the
 * round settled, closed, or keeps no further time). A case of the demo pack's is handled inside its demo scope.
 */
export async function roundTimers(sys: Ctx, clock: Clock, caseId: string, nodeId: string, round: number, now = Date.now()): Promise<number | null> {
  const demo = await isDemoRow(sys.cfg.db, sys.org.id, caseId);
  return inDemoScope(demo ? sys.org.id : null, () => sys.write((tx) => roundTimersIn(tx, sys, clock, caseId, nodeId, round, now)));
}

/** `roundTimers` inside the caller's transaction. */
export async function roundTimersIn(tx: Tx, sys: Ctx, clock: Clock, caseId: string, nodeId: string, round: number, now = Date.now()): Promise<number | null> {
  const orgId = sys.org.id;
  const kase = await lockCase(tx, orgId, caseId);
  if (!kase || kase.paused_at || (kase.state !== "active" && kase.state !== "waiting") || Number(kase.open_rounds?.[nodeId]) !== round) return null;
  const version = await loadVersionInfo(tx, orgId, kase.version_id);
  const node = version?.graph.nodes.find((n) => n.id === nodeId && n.type === "form_step");
  if (!version || !node) return null;
  const wait = await tx.one<{ result: unknown }>(`select result from sm_flow_waits where org_id = $1 and key = $2 for update`, [orgId, stepWaitKey(caseId, nodeId, round)]);
  if (!wait || wait.result) return null;
  const step = formStepOf(node.config);
  const label = processNodeLabel(node);
  let rows = await roundTasks(tx, orgId, caseId, nodeId, round);
  let open = rows.filter((t) => t.status === "open");
  if (!open.length) return null;
  let next: number | null = null;
  const later = (t: number) => {
    if (Number.isFinite(t) && t > now && (next === null || t < next)) next = t;
  };
  const opened = Math.min(...rows.map(fromOf).filter(Number.isFinite));
  const mark = Math.max(opened, ...rows.map((t) => msOf(t.escalated_at)).filter(Number.isFinite));
  const acts: Act[] = [];
  for (const esc of step.escalate ?? []) {
    const at = plus(clock, step, opened, esc.after);
    if (at <= mark) continue;
    if (at > now) later(at);
    else acts.push({ at, kind: "escalate", esc });
  }
  const due = Math.min(...open.map((t) => msOf(t.due_at)).filter(Number.isFinite));
  if (Number.isFinite(due) && outEdges(version.graph, nodeId, "timeout").length) {
    if (due > now) later(due);
    else acts.push({ at: due, kind: "timeout" });
  }
  acts.sort((a, b) => a.at - b.at);
  let escalated = false;
  for (const a of acts) {
    if (a.kind === "timeout") {
      await settleRound(tx, sys, kase, version, nodeId, round, open, "timeout");
      await caseJournal(tx, sys, kase, `مهلت «${label}» به پایان رسید؛ پرونده از مسیر «پایان مهلت» ادامه یافت`, { data: { step: nodeId, round } });
      return null;
    }
    const esc = a.esc;
    escalated = true;
    if (esc.action === "auto") {
      const offered = step.start ? ["submitted"] : stepOutcomes(step.action).filter((o) => o !== "returned" || outEdges(version.graph, nodeId, "returned").length > 0);
      if (!offered.includes(esc.outcome)) {
        await caseJournal(tx, sys, kase, `مهلت «${label}» گذشت، ولی تصمیم خودکار «${OUTCOME_WORDS[esc.outcome]}» در این مرحله ممکن نیست`, { data: { step: nodeId, round } });
        continue;
      }
      await settleRound(tx, sys, kase, version, nodeId, round, open, esc.outcome);
      await caseJournal(tx, sys, kase, `مهلت گذشت؛ «${label}» خودکار «${OUTCOME_WORDS[esc.outcome]}» شد`, { kind: step.action === "approve" ? "approval" : "system", data: { step: nodeId, round, decision: esc.outcome, auto: true } });
      return null;
    }
    if (esc.action === "notify") {
      let target = await noticeTo(tx, sys, kase, step, label, open, esc.to, localDate(now, orgTz(sys)));
      // who of them may be told (a case of the demo pack's: the pack's people only; the organisation's own: none of
      // them; active members), made readers of the case before the notice is queued (engine/readers.ts) — the journal
      // names whom it reached, and who it could not and why
      let a = await tellCase(tx, sys, kase, target.users);
      if (!a.told.length && target.users.length && !target.instead && esc.to !== "managers") {
        // the person's manager or the holders of «گزارش به» were named but none of them may be told: the process
        // managers instead (the administrators when the case names none), with the reasons — as when «گزارش به» finds
        // nobody, so the overdue step's alert reaches someone (engine-access-2, 1.1.5)
        const m = await noticeRecipients(tx, kase.org_id, kase);
        const said = new Set(a.untold);
        target = { users: m.users, admins: m.admins, instead: [...(target.passed ?? []), ...a.untold].join("؛ ") || "اعلان به کسانی که نام برده شدند نرسید" };
        a = await tellCase(tx, sys, kase, m.users);
        a = { ...a, untold: a.untold.filter((u) => !said.has(u)) };
      }
      if (a.told.length) {
        await notifyPeople(tx, orgId, {
          table: "process_case", id: kase.id, users: a.told, event: "custom", label: "مهلت گذشت", channels: ["in_app", "email"], actor: null, source: "گردش‌کارها",
          subject: `مهلت گذشت: «${label}» در پروندهٔ ${kase.number ?? ""}`.trim(),
          body: `مرحلهٔ «${label}» از پروندهٔ ${kase.number ?? ""}${titled(kase)} هنوز انجام نشده است`,
        });
      }
      await caseJournal(tx, sys, kase, noticeLine(label, target, a), { data: { step: nodeId, round, to: esc.to, told: a.told } });
      continue;
    }
    // reassign: the round goes to the people of other rules — those it names already keep their task, the other open
    // tasks are no longer needed, and the newcomers get one
    const tasks = await caseTasks(tx, orgId, caseId);
    const r = await resolveAssignees(tx, sys, resolveInput(kase, version, tasks, { ...step, assignees: esc.rules, fallback: undefined, ifNobody: "skip" }, label));
    if (!r.people.length) {
      await caseJournal(tx, sys, kase, `مهلت «${label}» گذشت؛ برای ارجاع کسی پیدا نشد`, { data: { step: nodeId, round } });
      continue;
    }
    const holds = (t: RoundTask, p: (typeof r.people)[number]) => t.assigned_to === p.user && (t.delegated_from ?? null) === (p.delegatedFrom ?? null);
    const people = r.people.filter((p) => !open.some((t) => holds(t, p)));
    const dropped = open.filter((t) => !r.people.some((p) => holds(t, p)));
    if (!people.length && !dropped.length) continue;
    const at = iso(Date.now());
    for (const t of dropped) await updateIn(tx, sys, "process_task", t.id, { status: "not_needed", closed_at: at }, { trusted: true });
    const dueAt = Number.isFinite(due) ? iso(due) : null;
    for (const p of people) {
      await createIn(
        tx, sys, "process_task",
        {
          case_id: kase.id, case_number: kase.number, case_title: kase.title, process_id: kase.process_id, version_id: kase.version_id, step_key: nodeId, step_label: label,
          action: step.action, round, assigned_to: p.user, delegated_from: p.delegatedFrom, status: "open", opened_at: at, due_at: dueAt, escalated_at: at,
        },
        { trusted: true },
      );
    }
    const names = [...(await peopleNames(tx, r.people.map((p) => p.user))).values()];
    if (people.length) {
      await notifyPeople(tx, orgId, {
        table: "process_case", id: kase.id, users: people.map((p) => p.user), event: "custom", label: "مرحله‌ای منتظر شماست", channels: ["in_app", "email"], actor: null, source: "گردش‌کارها",
        subject: `مرحله‌ای منتظر شماست: «${label}»`, body: `مرحلهٔ «${label}» از پروندهٔ ${kase.number ?? ""}${titled(kase)} به شما ارجاع شد`,
      });
    }
    await caseJournal(tx, sys, kase, `مهلت گذشت؛ «${label}» به ${names.join("، ")} ارجاع شد`, { data: { step: nodeId, round, to: r.people.map((p) => p.user) } });
    await refreshCase(tx, sys, kase, version.graph);
    rows = await roundTasks(tx, orgId, caseId, nodeId, round);
    open = rows.filter((t) => t.status === "open");
  }
  // each escalation once: the round remembers until when they were handled
  if (escalated) {
    for (const t of open) if (!(msOf(t.escalated_at) >= now)) await updateIn(tx, sys, "process_task", t.id, { escalated_at: iso(now) }, { trusted: true });
  }
  if (step.remind_every) {
    const every = durationMs(step.remind_every);
    const due = open.filter((t) => (msOf(t.reminded_at) || fromOf(t)) + every <= now);
    for (const t of open) if (!due.includes(t)) later((msOf(t.reminded_at) || fromOf(t)) + every);
    if (due.length) {
      await notifyPeople(tx, orgId, {
        table: "process_case", id: kase.id, users: due.map((t) => t.assigned_to).filter(isId), event: "custom", label: "یادآوری مرحله", channels: ["in_app", "email"], actor: null, source: "گردش‌کارها",
        subject: `یادآوری مرحله: «${label}»`, body: `مرحلهٔ «${label}» از پروندهٔ ${kase.number ?? ""}${titled(kase)} هنوز منتظر شماست`,
      });
      for (const t of due) await updateIn(tx, sys, "process_task", t.id, { reminded_at: iso(now) }, { trusted: true });
      later(now + every);
    }
  }
  return next as number | null;
}

/** What a round's tasks tell of its times (calendar ms; NaN: none). */
export interface RoundFacts {
  /** the round's opening (its first task's) */
  opened: number;
  /** until when its escalations were handled (the opening, or the latest `escalated_at`) */
  mark: number;
  /** the earliest due time of its open tasks */
  due: number;
  /** the earliest last reminder (or opening) of its open tasks */
  remind: number;
}

/**
 * The first time a round needs the timer — an escalation not handled yet, the «پایان مهلت» port (when wired), a
 * reminder — or null. The same times `roundTimersIn` acts on, read without a lock: a pass locks only rounds due now.
 */
export function roundNextAt(clock: Clock, step: FormStep, timeoutWired: boolean, f: RoundFacts): number | null {
  const at: number[] = [];
  if (Number.isFinite(f.opened)) {
    for (const esc of step.escalate ?? []) {
      const t = plus(clock, step, f.opened, esc.after);
      if (t > f.mark) at.push(t);
    }
  }
  if (timeoutWired && Number.isFinite(f.due)) at.push(f.due);
  if (step.remind_every && Number.isFinite(f.remind)) at.push(f.remind + durationMs(step.remind_every));
  const ok = at.filter(Number.isFinite);
  return ok.length ? Math.min(...ok) : null;
}

/** A pass stopped at its tick's budget: run again at once (what it did is committed, round by round). */
export const MORE = "more" as const;
/** A round or a submission that failed is looked at again after this long (the others go on meanwhile). */
const RETRY_MS = 10 * MIN_SLEEP;

const failed = (cfg: ServerConfig, what: string, e: unknown) => cfg.log.warn(`process.timer: ${what}`, String((e as Error)?.message ?? e));

/** Submissions still pending here with no look for their files queued (a missed event): applied now, each on its own. */
async function recheckPending(cfg: ServerConfig, orgId: string, apply: (id: string) => Promise<unknown>, deadline: number): Promise<boolean | typeof MORE> {
  const rows = await cfg.db.query<{ id: string }>(
    `select s.id from sm_process_submissions s where s.org_id = $1 and s.result = 'pending' and s.deleted_at is null
       and not exists (select 1 from sm_jobs j where j.org_id = s.org_id and j.dedupe_key = 'process.apply:' || s.id::text and j.status in ('queued', 'running'))
     order by s.created_at limit 200`,
    [orgId],
  );
  for (const r of rows) {
    if (Date.now() > deadline) return MORE;
    try {
      await apply(String(r.id));
    } catch (e) {
      failed(cfg, `submission ${r.id} was not applied`, e);
    }
  }
  return rows.length > 0;
}

/**
 * One pass of the organisation's timer. Returns when it needs to run again (null: nothing is watched — a step that
 * opens with a time, or a pushed submission, wakes it), or `MORE` when it stopped at `deadline` with work left. Only
 * rounds with something due now are locked; a round or a submission that throws is logged and skipped.
 */
export async function timerPass(cfg: ServerConfig, orgId: string, apply: (id: string) => Promise<unknown>, now = Date.now(), deadline = Infinity): Promise<number | null | typeof MORE> {
  if (!(await processesRunHere(cfg, orgId))) return null;
  const sys = await systemCtx(cfg, orgId);
  let clock: Clock = { cal: null };
  try {
    const { byId, defaultId } = calendarsOf(await slaConfig(cfg.db, sys), orgTz(sys));
    clock = { cal: defaultId ? byId.get(defaultId) ?? null : null };
  } catch {
    // no calendar: calendar time
  }
  let next: number | null = null;
  const later = (t: number | null) => {
    if (t !== null && (next === null || t < next)) next = t;
  };
  const pairs = await cfg.db.query<{ version_id: string; step_key: string }>(
    `select distinct c.version_id, t.step_key from sm_process_tasks t join sm_process_cases c on c.id = t.case_id and c.deleted_at is null and c.state in ('active', 'waiting') and c.paused_at is null
     where t.org_id = $1 and t.status = 'open' and t.deleted_at is null and c.version_id is not null`,
    [orgId],
  );
  const versions = new Map<string, VersionInfo | null>();
  for (const p of pairs) {
    if (!versions.has(p.version_id)) versions.set(p.version_id, await loadVersionInfo(cfg.db, orgId, p.version_id));
    const v = versions.get(p.version_id);
    const n = v?.graph.nodes.find((x) => x.id === p.step_key && x.type === "form_step");
    if (!v || !n || !hasTimers(v.graph, n.id, formStepOf(n.config))) continue;
    const step = formStepOf(n.config);
    const wired = outEdges(v.graph, n.id, "timeout").length > 0;
    // the open rounds of this step, each with its times — one query, no lock
    const rounds = await cfg.db.query<{ case_id: string; round: number; opened: unknown; escalated: unknown; due: unknown; remind: unknown }>(
      `select t.case_id, t.round, min(coalesce(t.timers_from, t.opened_at)) as opened, max(t.escalated_at) as escalated,
         min(t.due_at) filter (where t.status = 'open') as due, min(coalesce(t.reminded_at, t.timers_from, t.opened_at)) filter (where t.status = 'open') as remind
       from sm_process_tasks t join sm_process_cases c on c.id = t.case_id and c.deleted_at is null and c.state in ('active', 'waiting') and c.paused_at is null
       where t.org_id = $1 and c.version_id = $2 and t.step_key = $3 and t.deleted_at is null and c.open_rounds ->> t.step_key = t.round::text
       group by t.case_id, t.round
       having bool_or(t.status = 'open')`,
      [orgId, p.version_id, p.step_key],
    );
    for (const r of rounds) {
      const opened = msOf(r.opened);
      const at = roundNextAt(clock, step, wired, { opened, mark: Math.max(opened, msOf(r.escalated) || -Infinity), due: msOf(r.due), remind: msOf(r.remind) });
      if (at === null) continue;
      if (at > now) {
        later(at);
        continue;
      }
      if (Date.now() > deadline) return MORE;
      try {
        later(await roundTimers(sys, clock, String(r.case_id), p.step_key, Number(r.round), now));
      } catch (e) {
        failed(cfg, `round ${r.round} of «${p.step_key}» in case ${r.case_id} failed`, e);
        later(now + RETRY_MS);
      }
    }
  }
  const rechecked = await recheckPending(cfg, orgId, apply, deadline);
  if (rechecked === MORE) return MORE;
  if (rechecked) later(now + RECHECK_MS);
  const pending = await cfg.db.one(`select 1 as x from sm_process_submissions where org_id = $1 and result = 'pending' and deleted_at is null limit 1`, [orgId]);
  if (pending) later(now + RECHECK_MS);
  const at = next as number | null;
  if (at === null) return null;
  return Math.min(Math.max(at, now + MIN_SLEEP), now + RECHECK_MS);
}

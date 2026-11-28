// Cases for the people who read them (design F §5 «پرونده‌ها», «workflows/c/:id», §3.6.7, §6.3, package F4c):
//   · `casesList`: the cases the caller reads (the record engine's own read: participant sources, managers, area
//     grants, the confidential row rule), filtered by process, state, step, requester, unit and dates — never by
//     values (§10). One page, with names, and my starts a linked Windows app has not sent yet (`queued_starts`, the
//     «در صف ارسال» cards of §7.2);
//   · `caseDetail`: one case for its reader, in one call — the diagram (`stepStatuses`, with `mine_expected` from my
//     positions and a dry run of the resolver for steps that depend on the case), the values I may read (F4b's
//     `caseViews`, the same function the record API's redaction uses), my open steps with their forms, rights,
//     decisions, return targets, next step, drafts and my last refused submission (its message and the values I
//     entered), what I may do (cancel as the requester; pause, resume, reassign, cancel, «ادامه از مرحلهٔ …» and — on a
//     step that waits for people — «دوباره پیدا کردن انجام‌دهنده» as a manager), the steps that wait with nobody to act
//     (`waiting`: why — the resolver's reasons and, past a step's limit, the candidates for its managers only), whether
//     the case is a row of the demo pack, and the history: tasks, submissions (their values cut to what I may read; my
//     own refused ones too, and the message of mine) and the journal;
//   · `casePrint`: what F7's printable view of a case needs — decisions, names and dates, and the readable values as
//     people read them (the one display rule of a workflow's texts, ../engine/display.ts).
import type { Cond } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { effectiveRights, layoutFields, type Right } from "@shared/forms/layout";
import { formatJalali } from "@shared/jalali";
import { CASE_OUTCOMES, CASE_STATES, TASK_ACTIONS, TASK_OUTCOMES } from "@shared/tables/process";
import {
  formStepOf, OUTCOME_PORT, outEdges, processNodeLabel, restartTargets, stepOutcomes, type ProcessGraph, type StepOutcome,
} from "@shared/process/graph";
import { stepStatuses, withUnstaffed, type NodeStatusView } from "@shared/process/status";
import type { Ctx } from "../../../context";
import { pgArray } from "../../../db";
import { bad, notFound } from "../../../http/errors";
import { canOpenRecords, defFor, get, list, listJournal, orgTz, systemCtx } from "../../../engine";
import { resolveAssignees } from "../../positions";
import { caseViews, visibleData } from "../access";
import { OPEN_STATES, resolveInput } from "../engine";
import { caseTasks, isId, loadVersionInfo, type CaseRow, type TaskRow, type VersionInfo } from "../engine/store";
import { caseDisplay } from "../engine/display";
import { waitingSteps } from "../engine/waiting";
import type { StepWaiting } from "@shared/process/waiting";
import { isDemoRow } from "../../../db/scope";
import { CLOSED_CASE, managesCase, nameMap, nextStepLabel, OPEN_CASE, personFacts } from "./common";
import { myGroups } from "./inbox";

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined || v === "" ? null : String(v));
const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? (v === null || v === undefined ? null : String(v));

// ----- «پرونده‌ها» ------------------------------------------------------------------------------------------------

export interface CaseFilters {
  /** process id or key */
  process?: string | null;
  /** states (or «open» / «closed») */
  state?: string[] | null;
  /** a step key: cases with an open task there */
  step?: string | null;
  requester?: string | null;
  /** a unit: cases of requesters in it or below it */
  unit?: string | null;
  from?: string | null;
  to?: string | null;
  /** «آغازشده توسط من» */
  mine?: boolean;
  q?: string | null;
  page?: number;
  size?: number;
}

const LIST_FIELDS = ["title", "process_id", "process_name", "version_no", "state", "outcome", "requested_by", "requested_for", "started_at", "ended_at", "current_steps", "confidential", "paused_at"];

/** The cases the caller reads, filtered (see the header). */
export async function casesList(ctx: Ctx, f: CaseFilters = {}) {
  const and: Cond[] = [];
  let processId: string | null = null;
  if (f.process) {
    const ref = String(f.process).trim();
    const p = await ctx.db.one<{ id: string }>(`select id from sm_processes where org_id = $1 and deleted_at is null and ${isId(ref) ? "id = $2::uuid" : "key = $2"}`, [ctx.org.id, isId(ref) ? ref.toLowerCase() : ref]);
    if (!p) throw notFound("گردش‌کار پیدا نشد");
    and.push({ f: "process_id", op: "eq", v: p.id });
    processId = String(p.id);
  }
  const states = (f.state ?? []).flatMap((s) => (s === "open" ? OPEN_CASE : s === "closed" ? CLOSED_CASE : [s])).filter((s) => CASE_STATES.some((o) => o.value === s));
  if (states.length) and.push({ f: "state", op: "in", v: [...new Set(states)] });
  if (f.requester) {
    if (!isId(f.requester)) throw bad("درخواست‌دهنده معتبر نیست");
    and.push({ f: "requested_by", op: "eq", v: f.requester.toLowerCase() });
  }
  if (f.mine) and.push({ or: [{ f: "requested_by", op: "is_me" }, { f: "requested_for", op: "is_me" }] });
  if (f.from) and.push({ f: "started_at", op: "gte", v: f.from });
  if (f.to) and.push({ f: "started_at", op: "lte", v: f.to });
  const step = f.step ? String(f.step).slice(0, 40) : null;
  const unit = f.unit && isId(f.unit) ? f.unit.toLowerCase() : null;
  if (f.unit && !unit) throw bad("واحد سازمانی معتبر نیست");
  const size = Math.min(Math.max(Number(f.size) || 50, 1), 200);
  // someone who takes part in no case and holds no grant in «پرونده‌های گردش‌کار» has an empty list, not a refusal
  const queued_starts = await queuedStarts(ctx, processId);
  if (!(await canOpenRecords(ctx, (await defFor(ctx, "process_case")).def))) return { rows: [], total: 0, page: 1, size, display: {}, queued_starts };
  const res = await list(ctx, "process_case", {
    filter: and.length ? { and } : null,
    q: f.q ?? undefined,
    sort: "-started_at",
    page: f.page,
    size,
    fields: LIST_FIELDS,
    where:
      step || unit
        ? (t, params) => {
            const parts: string[] = [];
            if (step) {
              params.push(step);
              parts.push(`exists (select 1 from sm_process_tasks x where x.org_id = ${t}.org_id and x.case_id = ${t}.id and x.step_key = $${params.length} and x.status = 'open' and x.deleted_at is null)`);
            }
            if (unit) {
              params.push(unit);
              const u = `$${params.length}::uuid`;
              parts.push(
                `(${t}.unit_id in (with recursive tree as (select id from sm_org_units where id = ${u} union all select c.id from sm_org_units c join tree on c.parent_id = tree.id) select id from tree)
                  or exists (select 1 from sm_member_profiles mp where mp.org_id = ${t}.org_id and mp.user_id = ${t}.requested_by and mp.deleted_at is null and mp.org_unit_id in (with recursive tree as (select id from sm_org_units where id = ${u} union all select c.id from sm_org_units c join tree on c.parent_id = tree.id) select id from tree)))`,
              );
            }
            return parts.join(" and ");
          }
        : null,
  });
  return { ...res, display: { ...res.display, ...(await nameMap(ctx.db, res.rows.flatMap((r) => [r.requested_by as string, r.requested_for as string]))) }, queued_starts };
}

/** My starts a linked Windows app has not sent yet (newest first, at most 20): «در صف ارسال». */
async function queuedStarts(ctx: Ctx, processId: string | null): Promise<{ id: string; case_id: string | null; process_id: string | null; process_name: string | null; submitted_at: string | null }[]> {
  const rows = await ctx.db.query<{ id: string; case_id: string | null; process_id: string | null; process_name: string | null; submitted_at: unknown }>(
    `select s.id, s.case_id, coalesce(s.process_id, v.process_id) as process_id, coalesce(p.name, v.name) as process_name, s.submitted_at
     from sm_process_submissions s
     left join sm_process_versions v on v.org_id = s.org_id and v.id = s.version_id
     left join sm_processes p on p.org_id = s.org_id and p.id = coalesce(s.process_id, v.process_id) and p.deleted_at is null
     where s.org_id = $1 and s.submitted_by = $2 and s.kind = 'start' and s.result = 'pending' and s.deleted_at is null
       and ($3::uuid is null or coalesce(s.process_id, v.process_id) = $3::uuid)
     order by s.submitted_at desc, s.id limit 20`,
    [ctx.org.id, ctx.user.id, processId],
  );
  return rows.map((r) => ({ id: String(r.id), case_id: r.case_id, process_id: r.process_id ? String(r.process_id) : null, process_name: r.process_name, submitted_at: iso(r.submitted_at) }));
}

// ----- one case ---------------------------------------------------------------------------------------------------

export interface MyStep {
  id: string;
  step_key: string;
  label: string;
  action: string;
  round: number;
  opened_at: string | null;
  due_at: string | null;
  delegated_from: string | null;
  claimed_by: string | null;
  /** my submission waits to be sent («در صف ارسال») */
  queued: boolean;
  /** my last submission of this step the authority refused: its message and the values I entered */
  refused: { id: string; note: string | null; submitted_at: string | null; values: Record<string, unknown> } | null;
  form: string | null;
  rights: Record<string, Right>;
  outcomes: StepOutcome[];
  /** the steps a «بازگشت» may send the case back to; the first is the default; `to`: whom it returns to */
  return_targets: { key: string; label: string; default: boolean; to: string | null }[];
  /** the step each decision leads to when known: «ارسال برای "…"» */
  next: Partial<Record<StepOutcome, string | null>>;
  draft: Record<string, unknown> | null;
}

export interface CaseDetail {
  case: Record<string, unknown>;
  graph: ProcessGraph;
  statuses: Record<string, NodeStatusView>;
  /** the version's forms and the fields of the values shown */
  forms: VersionInfo["forms"];
  data: Record<string, unknown>;
  my_steps: MyStep[];
  can: { cancel: boolean; manage: boolean; pause: boolean; resume: boolean; reassign: boolean; resume_from: boolean; reresolve: boolean };
  /** the steps whose open round has no open task (nobody found, or more than the step takes), by node id */
  waiting: Record<string, StepWaiting>;
  /** the case is a row of the organisation's demo pack */
  demo: boolean;
  restart_targets: { key: string; label: string }[];
  /** the earliest due time of the open steps */
  due_at: string | null;
  history: {
    tasks: Record<string, unknown>[];
    submissions: Record<string, unknown>[];
    journal: unknown[];
  };
  display: Record<string, string>;
}

/** The case row as stored (the caller's read is checked first). */
async function readCase(ctx: Ctx, id: string): Promise<{ row: Record<string, unknown>; kase: CaseRow; version: VersionInfo }> {
  if (!isId(id)) throw notFound("پرونده پیدا نشد");
  const { row } = await get(ctx, "process_case", id);
  const kase = await ctx.db.one<CaseRow>(`select * from sm_process_cases where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, id.toLowerCase()]);
  if (!kase) throw notFound("پرونده پیدا نشد");
  const version = await loadVersionInfo(ctx.db, ctx.org.id, kase.version_id);
  if (!version) throw notFound("نسخهٔ گردش‌کار این پرونده پیدا نشد");
  return { row, kase, version };
}

/** Whom a «بازگشت» to `target` reaches: the last round's actors there (acted for, else acted by). */
function returnsTo(tasks: TaskRow[], target: string): string | null {
  const done = tasks.filter((t) => t.step_key === target && t.status === "done").sort((a, b) => Number(b.round) - Number(a.round) || String(b.closed_at ?? "").localeCompare(String(a.closed_at ?? "")));
  return done[0] ? String(done[0].acted_for ?? done[0].acted_by ?? "") || null : null;
}

/** Future steps whose rules depend on the case (manager, unit head, a field, an earlier actor, the requester). */
const CASE_RULES = new Set(["manager", "unit_head", "field", "step_actor", "requester"]);

/** One case for its reader (see the header). */
export async function caseDetail(ctx: Ctx, id: string): Promise<CaseDetail> {
  const { row, kase, version } = await readCase(ctx, id);
  const me = ctx.user.id;
  const graph = version.graph;
  const tasks = await ctx.db.query<TaskRow & { due_at: unknown; claimed_by: string | null }>(
    `select id, case_id, step_key, step_label, action, round, assigned_to, delegated_from, claimed_by, status, outcome, comment, acted_by, acted_for, submission_id, opened_at, closed_at, due_at
     from sm_process_tasks where org_id = $1 and case_id = $2 and deleted_at is null order by opened_at, id`,
    [ctx.org.id, kase.id],
  );
  const view = (await caseViews(ctx.db, ctx, [kase.id])).get(kase.id);
  const data = visibleData(view, kase.data) ?? {};
  const readableKeys = view?.keys ?? new Set<string>();
  const facts = await personFacts(ctx);
  const myTasks = tasks.filter((t) => t.assigned_to === me || t.delegated_from === me || t.acted_by === me || t.acted_for === me);

  // mine_expected: steps ahead whose rules depend on the case — a dry run of the resolver on its data (at most 8)
  const base = stepStatuses(version, kase, myTasks.map((t) => ({ step_key: t.step_key, status: t.status, outcome: t.outcome, round: t.round })), facts);
  const expected: string[] = [];
  if (OPEN_STATES.has(kase.state)) {
    const sys = await systemCtx(ctx.cfg, ctx.org.id);
    let runs = 0;
    for (const n of graph.nodes) {
      if (n.type !== "form_step" || base[n.id]?.status !== "future" || runs >= 8) continue;
      const s = formStepOf(n.config);
      if (!s.assignees.some((r) => CASE_RULES.has(r.kind))) continue;
      runs++;
      try {
        const r = await resolveAssignees(ctx.db, sys, resolveInput(kase, version, tasks, s, processNodeLabel(n)));
        if (r.people.some((p) => p.user === me || p.delegatedFrom === me)) expected.push(n.id);
      } catch {
        // a rule that cannot be resolved now: no mark
      }
    }
  }
  const statuses = expected.length ? stepStatuses(version, kase, myTasks.map((t) => ({ step_key: t.step_key, status: t.status, outcome: t.outcome, round: t.round })), facts, { expected }) : base;

  // my open steps, with their forms and my rights in them
  const groups = await myGroups(ctx);
  const defs = version.forms ? new Map(Object.entries(version.forms.fields)) : new Map<string, FieldDef>();
  const open = tasks.filter((t) => t.status === "open" && (t.assigned_to === me || t.delegated_from === me));
  const queued = open.length
    ? new Set((await ctx.db.query<{ task_id: string }>(`select task_id from sm_process_submissions where org_id = $1 and submitted_by = $2 and result = 'pending' and deleted_at is null and task_id = any($3::uuid[])`, [ctx.org.id, me, pgArray(open.map((t) => t.id))])).map((r) => String(r.task_id)))
    : new Set<string>();
  const refusals = new Map<string, { id: string; result_note: string | null; submitted_at: unknown; values: Record<string, unknown> | null }>();
  if (open.length) {
    for (const r of await ctx.db.query<{ id: string; task_id: string; result_note: string | null; submitted_at: unknown; values: Record<string, unknown> | null }>(
      `select distinct on (task_id) id, task_id, result_note, submitted_at, values from sm_process_submissions
       where org_id = $1 and submitted_by = $2 and kind = 'step' and result = 'refused' and deleted_at is null and task_id = any($3::uuid[])
       order by task_id, submitted_at desc, id desc`,
      [ctx.org.id, me, pgArray(open.map((t) => t.id))],
    )) refusals.set(String(r.task_id), r);
  }
  const drafts = open.length
    ? new Map((await ctx.db.query<{ task_id: string; values: Record<string, unknown> | null }>(`select task_id, values from sm_process_drafts where org_id = $1 and user_id = $2 and deleted_at is null and task_id = any($3::uuid[])`, [ctx.org.id, me, pgArray(open.map((t) => t.id))])).map((r) => [String(r.task_id), r.values ?? null]))
    : new Map<string, Record<string, unknown> | null>();
  const my_steps: MyStep[] = [];
  for (const t of open) {
    const node = graph.nodes.find((n) => n.id === t.step_key && n.type === "form_step");
    if (!node) continue;
    const s = formStepOf(node.config);
    const form = s.form && version.forms ? version.forms.forms[s.form] : undefined;
    const back = outEdges(graph, node.id, "returned").map((e) => e.target);
    const outcomes = s.start ? (["submitted"] as StepOutcome[]) : stepOutcomes(s.action).filter((o) => o !== "returned" || back.length > 0);
    const next: Partial<Record<StepOutcome, string | null>> = {};
    for (const o of outcomes) if (o !== "returned") next[o] = nextStepLabel(graph, node.id, OUTCOME_PORT[o]);
    const rights = form ? effectiveRights(form.layout, s.rights, defs, { groups }) : {};
    const no = refusals.get(t.id);
    // the values I entered, cut to what I read in the case or may enter in this step
    const mayKeep = (k: string) => readableKeys.has(k) || rights[k] === "edit" || rights[k] === "required";
    my_steps.push({
      id: t.id, step_key: t.step_key, label: processNodeLabel(node), action: s.action, round: Number(t.round), opened_at: iso(t.opened_at), due_at: iso(t.due_at),
      delegated_from: t.delegated_from, claimed_by: t.claimed_by, queued: queued.has(t.id), form: s.form,
      refused: no ? { id: String(no.id), note: no.result_note, submitted_at: iso(no.submitted_at), values: Object.fromEntries(Object.entries(no.values ?? {}).filter(([k]) => mayKeep(k))) } : null,
      rights,
      outcomes,
      return_targets: back.map((key, i) => {
        const target = graph.nodes.find((n) => n.id === key);
        return { key, label: target ? processNodeLabel(target) : key, default: i === 0, to: returnsTo(tasks, key) ?? (target && formStepOf(target.config).start ? kase.requested_by : null) };
      }),
      next,
      draft: drafts.get(t.id) ?? null,
    });
  }

  // what I may do
  const manage = await managesCase(ctx.db, ctx, kase);
  const startKey = graph.nodes.find((n) => n.type === "form_step" && formStepOf(n.config).start)?.id;
  const requester = kase.requested_by === me || kase.requested_for === me;
  const open_ = OPEN_STATES.has(kase.state);
  // the steps that wait for people: why (the reasons and the candidates only for the managers)
  const waiting = await waitingSteps(ctx.db, kase, graph, tasks, manage);
  const can = {
    cancel: open_ && ((requester && !tasks.some((t) => t.status === "done" && t.step_key !== startKey)) || manage),
    manage,
    pause: manage && open_ && kase.state !== "attention" && !kase.paused_at,
    resume: manage && !!kase.paused_at && open_,
    reassign: manage && open_ && kase.state !== "attention",
    resume_from: manage && kase.state === "attention",
    reresolve: manage && open_ && kase.state !== "attention" && Object.keys(waiting).length > 0,
  };
  const restart = can.resume_from ? restartTargets(graph).map((key) => ({ key, label: processNodeLabel(graph.nodes.find((n) => n.id === key)!) })) : [];

  // the history: every task, the applied submissions cut to what I read, the journal
  const subs = await ctx.db.query<{ id: string; kind: string; step_key: string | null; round: number | null; outcome: string | null; comment: string | null; values: Record<string, unknown> | null; submitted_by: string | null; on_behalf_of: string | null; submitted_at: unknown; result: string; result_note: string | null; applied_at: unknown }>(
    `select id, kind, step_key, round, outcome, comment, values, submitted_by, on_behalf_of, submitted_at, result, result_note, applied_at from sm_process_submissions
     where org_id = $1 and case_id = $2::text and deleted_at is null and (result in ('applied', 'late') or (result = 'refused' and submitted_by = $3)) order by submitted_at, id`,
    [ctx.org.id, kase.id, me],
  );
  const readable = readableKeys;
  const journal = await listJournal(ctx, "process_case", kase.id, { limit: 200 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
  const openDue = tasks.filter((t) => t.status === "open" && t.due_at).map((t) => Date.parse(String(iso(t.due_at)))).filter(Number.isFinite);
  const people = [
    kase.requested_by, kase.requested_for, ...(kase.managers ?? []),
    ...tasks.flatMap((t) => [t.assigned_to, t.delegated_from, t.claimed_by, t.acted_by, t.acted_for]),
    ...subs.flatMap((s) => [s.submitted_by, s.on_behalf_of]),
  ];
  return {
    case: {
      id: kase.id, number: kase.number, title: kase.title, process_id: kase.process_id, process_name: kase.process_name, version_id: kase.version_id, version_no: kase.version_no,
      state: kase.state, outcome: kase.outcome, requested_by: kase.requested_by, requested_for: kase.requested_for, started_at: iso(kase.started_at), ended_at: iso(kase.ended_at),
      paused_at: iso(kase.paused_at), current_steps: kase.current_steps ?? [], confidential: kase.confidential === true, version: row.version,
    },
    graph,
    // a step that waits for people says so on the diagram, not «در جریان» (1.1.5)
    statuses: withUnstaffed(statuses, Object.keys(waiting)),
    forms: version.forms,
    data,
    my_steps,
    can,
    waiting,
    demo: await isDemoRow(ctx.db, ctx.org.id, kase.id),
    restart_targets: restart,
    due_at: openDue.length ? new Date(Math.min(...openDue)).toISOString() : null,
    history: {
      tasks: tasks.map((t) => ({
        id: t.id, step_key: t.step_key, step_label: t.step_label, action: t.action, round: Number(t.round), assigned_to: t.assigned_to, delegated_from: t.delegated_from,
        claimed_by: t.claimed_by, status: t.status, outcome: t.outcome, comment: t.comment, acted_by: t.acted_by, acted_for: t.acted_for, opened_at: iso(t.opened_at),
        closed_at: iso(t.closed_at), due_at: iso(t.due_at),
      })),
      submissions: subs.map((s) => ({
        id: s.id, kind: s.kind, step_key: s.step_key, round: s.round, outcome: s.outcome, comment: s.comment, submitted_by: s.submitted_by, on_behalf_of: s.on_behalf_of,
        submitted_at: iso(s.submitted_at), result: s.result, result_note: s.submitted_by === me ? s.result_note : null, applied_at: iso(s.applied_at),
        values: Object.fromEntries(Object.entries(s.values ?? {}).filter(([k]) => readable.has(k))),
      })),
      journal: journal.entries,
    },
    display: { ...journal.display, ...(await nameMap(ctx.db, people)) },
  };
}

// ----- the printable view -----------------------------------------------------------------------------------------

export interface CasePrint {
  org: string;
  case: { id: string; number: string | null; title: string | null; process: string | null; version_no: number | null; state: string | null; outcome: string | null; requested_by: string | null; requested_for: string | null; started_at: string | null; ended_at: string | null; finished: boolean };
  decisions: { step: string | null; action: string | null; outcome: string | null; by: string | null; for: string | null; at: string | null; at_text: string | null; comment: string | null; round: number }[];
  values: { field: string; label: string; text: string }[];
  printed_at: string;
}

/** What the printable view of a case shows (see the header). */
export async function casePrint(ctx: Ctx, id: string): Promise<CasePrint> {
  const { kase, version } = await readCase(ctx, id);
  const tasks = await caseTasks(ctx.db, ctx.org.id, kase.id);
  const view = (await caseViews(ctx.db, ctx, [kase.id])).get(kase.id);
  const data = visibleData(view, kase.data) ?? {};
  const defs = version.forms ? version.forms.fields : {};
  // the values I read as people read them: the one display rule of a workflow's texts (../engine/display.ts)
  const shown = await caseDisplay(ctx.db, ctx.org.id, { fields: new Map(Object.entries(defs)), values: data, tz: orgTz(ctx) });
  const people = await nameMap(ctx.db, [kase.requested_by, kase.requested_for, ...tasks.flatMap((t) => [t.acted_by, t.acted_for])]);
  const names = new Map<string, string>(Object.entries(people));
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => String(a.closed_at ?? "").localeCompare(String(b.closed_at ?? "")));
  const order = version.forms ? Object.values(version.forms.forms).flatMap((f) => layoutFields(f.layout)) : [];
  const keys = [...new Set([...order, ...Object.keys(data)])].filter((k) => k in data && defs[k]);
  return {
    org: ctx.org.name,
    case: {
      id: kase.id, number: kase.number, title: kase.title, process: kase.process_name, version_no: kase.version_no, state: label(CASE_STATES, kase.state), outcome: label(CASE_OUTCOMES, kase.outcome),
      requested_by: names.get(String(kase.requested_by)) ?? null, requested_for: names.get(String(kase.requested_for)) ?? null, started_at: iso(kase.started_at), ended_at: iso(kase.ended_at),
      finished: CLOSED_CASE.includes(kase.state),
    },
    decisions: done.map((t) => ({
      step: t.step_label, action: label(TASK_ACTIONS, t.action), outcome: label(TASK_OUTCOMES, t.outcome), by: names.get(String(t.acted_by)) ?? null,
      for: t.acted_for ? names.get(String(t.acted_for)) ?? null : null, at: iso(t.closed_at), at_text: t.closed_at ? formatJalali(String(iso(t.closed_at))) : null, comment: t.comment, round: Number(t.round),
    })),
    values: keys.map((k) => ({ field: k, label: defs[k].label, text: shown.text(k) })),
    printed_at: new Date().toISOString(),
  };
}

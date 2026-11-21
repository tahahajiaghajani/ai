// The user side of «گردش‌کارها» (design F §5, §8.6, package F4c) — one call per page:
//   · `inbox`  «کارتابل»: my open process steps and my pending record approvals (`myApprovals`, kind «تأیید رکورد»),
//     one list by due time; delegated rows name whom they stand in for («به جانشینی از …»), a step whose submission
//     waits to be sent is «در صف ارسال», a pool step someone took names them; the chips «گردش‌کارهای شما» count my
//     open steps per process; the page opens on «کارتابل» when something waits;
//   · `done`   «انجام‌شده‌ها»: the steps I did;
//   · `mine`   «گردش‌کارهای من»: the processes I take part in — as a starter, in a step's rules (a static check of my
//     positions, groups and roles), or in a case — with my parts, what waits for me, and whether I may start one;
//   · `processView` (`workflows/p/:key` and `workflows/start/:key`): the published diagram with my steps, the queue of
//     cases waiting for me at each, and the start form with my rights, the next step's name and my saved draft.
// Every member may look at a published process (hiding a process from people who may not start it is not in version
// 1); case data is never part of these answers, only what my own tasks carry (number, title, step). Whether I may
// start one is the start's own check (`isStarter`, the starters' rules resolved for me — never a static guess that the
// start would refuse), and a process of the demo pack only for the pack's people. A row about a case or record of the
// demo pack says so (`demo`).
import { effectiveRights, type Right } from "@shared/forms/layout";
import { snapshotFields } from "@shared/forms/snapshot";
import { ASSIGNEE_KIND_LABELS, type AssigneeRule } from "@shared/process/assignees";
import { forwardEdges, formStepOf, processNodeLabel, startOf, topoOrder, type ProcessGraph } from "@shared/process/graph";
import { FIELD_GROUPS, type FieldGroup } from "@shared/model/types";
import { faDigits } from "@shared/format";
import type { Ctx } from "../../../context";
import { pgArray } from "../../../db";
import { notFound } from "../../../http/errors";
import { access } from "../../../access/provider";
import { canOpenRecords, condEnv, defFor, get, systemCtx } from "../../../engine";
import { myApprovals } from "../../sla";
import { Resolution } from "../../positions";
import { demoPeople } from "../../../db/scope";
import type { Queryable } from "../../../db";
import { isStarter } from "../engine/apply";
import { isId, loadVersionInfo } from "../engine/store";
import { groupNameMap, myStepKeys, nameMap, nextStepLabel, partOf, personFacts } from "./common";

const ALL_GROUPS = Object.keys(FIELD_GROUPS) as FieldGroup[];
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined || v === "" ? null : String(v));

/** The caller's field groups (what `effectiveRights` takes). */
export async function myGroups(ctx: Ctx): Promise<FieldGroup[]> {
  await condEnv(ctx);
  return ALL_GROUPS.filter((g) => access().hasFieldGroup(ctx, g));
}

// ----- «کارتابل» --------------------------------------------------------------------------------------------------

export interface InboxRow {
  kind: "process_step" | "record_approval";
  id: string;
  /** process_step: the case; record_approval: the record */
  case_id: string | null;
  table: string | null;
  record_id: string | null;
  number: string | null;
  title: string | null;
  /** the process's name, or the table's label */
  source: string;
  process_id: string | null;
  step: string;
  action: string;
  /** who it comes from (the case's requester, or who asked for the approval) */
  from: string | null;
  since: string | null;
  due_at: string | null;
  /** «به جانشینی از …» */
  on_behalf_of: string | null;
  /** a pool step someone took («در دست …») */
  claimed_by: string | null;
  /** my submission waits to be sent («در صف ارسال») */
  queued: boolean;
  /** the case is paused by its managers */
  paused: boolean;
  /** the case (or the record) is a row of the organisation's demo pack */
  demo: boolean;
  can_act: boolean;
  /** the app route that opens it */
  link: string;
}

export interface Inbox {
  rows: InboxRow[];
  chips: { process_id: string; name: string; count: number }[];
  counts: { waiting: number; steps: number; approvals: number };
  default_tab: "inbox" | "mine";
  display: Record<string, string>;
}

interface MyTask {
  id: string;
  case_id: string;
  case_number: string | null;
  case_title: string | null;
  process_id: string | null;
  step_label: string | null;
  action: string;
  delegated_from: string | null;
  claimed_by: string | null;
  opened_at: unknown;
  due_at: unknown;
  process_name: string | null;
  requested_by: string | null;
  paused_at: unknown;
}

/** Of `ids`, the rows of the organisation's demo pack (lower-case). */
async function demoRows(q: Queryable, orgId: string, ids: string[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter(isId).map((x) => x.toLowerCase()))];
  if (!list.length) return new Set();
  const rows = await q.query<{ id: string }>(`select row_id::text as id from sm_demo_rows where org_id = $1 and row_id = any($2::uuid[])`, [orgId, pgArray(list)]);
  return new Set(rows.map((r) => String(r.id).toLowerCase()));
}

/**
 * May I start these processes: the starters' rules resolved for me (`isStarter`, as the start checks them), and a
 * process of the demo pack only if I am one of the pack's people (the start refuses anyone else, DEMO_PROCESS_START).
 */
async function startChecker(ctx: Ctx, processIds: string[]): Promise<(processId: string, starters: AssigneeRule[]) => Promise<boolean>> {
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const me = ctx.user.id;
  const run = new Resolution(ctx.db, sys, { step: { assignees: [] }, action: "fill", requestedBy: me });
  const pack = await demoRows(ctx.db, ctx.org.id, processIds);
  const mine = pack.size ? (await demoPeople(ctx.db, ctx.org.id, [me])).size > 0 : false;
  return async (processId, starters) => {
    if (pack.has(processId.toLowerCase()) && !mine) return false;
    return !starters.length || isStarter(ctx.db, sys, starters, me, run);
  };
}

/** My open process steps (assigned to me, or standing in for me), with their case's process and requester. */
async function myOpenTasks(ctx: Ctx): Promise<MyTask[]> {
  return ctx.db.query<MyTask>(
    `select t.id, t.case_id, t.case_number, t.case_title, t.process_id, t.step_label, t.action, t.delegated_from, t.claimed_by, t.opened_at, t.due_at,
       c.process_name, c.requested_by, c.paused_at
     from sm_process_tasks t join sm_process_cases c on c.id = t.case_id and c.org_id = t.org_id and c.deleted_at is null
     where t.org_id = $1 and t.assigned_to = $2 and t.status = 'open' and t.deleted_at is null
     order by t.due_at nulls last, t.opened_at
     limit 500`,
    [ctx.org.id, ctx.user.id],
  );
}

/** «کارتابل» (see the header). */
export async function inbox(ctx: Ctx): Promise<Inbox> {
  const me = ctx.user.id;
  const tasks = await myOpenTasks(ctx);
  const queued = tasks.length
    ? new Set(
        (await ctx.db.query<{ task_id: string }>(
          `select task_id from sm_process_submissions where org_id = $1 and submitted_by = $2 and result = 'pending' and deleted_at is null and task_id = any($3::uuid[])`,
          [ctx.org.id, me, pgArray(tasks.map((t) => t.id))],
        )).map((r) => String(r.task_id)),
      )
    : new Set<string>();
  const approvals = await myApprovals(ctx, { scope: "pending", limit: 200 });
  const demo = await demoRows(ctx.db, ctx.org.id, [...tasks.map((t) => String(t.case_id)), ...approvals.approvals.map((a) => String(a.record_id))]);
  const rows: InboxRow[] = [
    ...tasks.map((t): InboxRow => ({
      kind: "process_step", id: String(t.id), case_id: String(t.case_id), table: "process_case", record_id: String(t.case_id), number: t.case_number, title: t.case_title,
      source: t.process_name ?? "", process_id: t.process_id, step: t.step_label ?? "", action: t.action, from: t.requested_by, since: iso(t.opened_at), due_at: iso(t.due_at),
      on_behalf_of: t.delegated_from, claimed_by: t.claimed_by && t.claimed_by !== me ? t.claimed_by : null, queued: queued.has(String(t.id)), paused: !!t.paused_at,
      demo: demo.has(String(t.case_id).toLowerCase()),
      can_act: !t.paused_at && !queued.has(String(t.id)) && (!t.claimed_by || t.claimed_by === me), link: `workflows/c/${t.case_id}/s/${t.id}`,
    })),
    ...approvals.approvals.map((a): InboxRow => ({
      kind: "record_approval", id: String(a.id), case_id: null, table: String(a.table_key), record_id: String(a.record_id), number: (a.record_number as string) ?? null,
      title: (a.record_title as string) ?? null, source: a.table_label, process_id: null, step: String(a.level_name ?? a.rule_name ?? "تأیید رکورد"), action: "approve",
      from: (a.requested_by as string) ?? null, since: iso(a.requested_at), due_at: iso(a.due_at), on_behalf_of: a.on_behalf_of, claimed_by: null, queued: false, paused: false,
      demo: demo.has(String(a.record_id).toLowerCase()),
      can_act: a.can_decide, link: `r/${a.table_key}/${a.record_id}`,
    })),
  ];
  const due = (r: InboxRow) => (r.due_at ? Date.parse(r.due_at) : Number.POSITIVE_INFINITY);
  rows.sort((a, b) => due(a) - due(b) || String(a.since ?? "").localeCompare(String(b.since ?? "")));
  const chips = new Map<string, { process_id: string; name: string; count: number }>();
  for (const t of tasks) {
    if (!t.process_id) continue;
    const c = chips.get(t.process_id) ?? { process_id: t.process_id, name: t.process_name ?? "", count: 0 };
    c.count++;
    chips.set(t.process_id, c);
  }
  const names = await nameMap(ctx.db, rows.flatMap((r) => [r.from, r.on_behalf_of, r.claimed_by]));
  return {
    rows,
    chips: [...chips.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fa")),
    counts: { waiting: rows.length, steps: tasks.length, approvals: approvals.approvals.length },
    default_tab: rows.length ? "inbox" : "mine",
    display: { ...approvals.display, ...names },
  };
}

/** The nav count of «گردش‌کارها»: my open steps plus my pending record approvals. */
export async function inboxCount(ctx: Ctx): Promise<{ count: number }> {
  return { count: (await inbox(ctx)).rows.length };
}

// ----- «انجام‌شده‌ها» -------------------------------------------------------------------------------------------

export interface DoneRow {
  id: string;
  case_id: string;
  number: string | null;
  title: string | null;
  process: string | null;
  step: string | null;
  action: string;
  outcome: string | null;
  comment: string | null;
  acted_for: string | null;
  closed_at: string | null;
  link: string;
}

/** The steps I did, newest first. */
export async function doneSteps(ctx: Ctx, opts: { limit?: number } = {}): Promise<{ rows: DoneRow[]; display: Record<string, string> }> {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const rows = await ctx.db.query<{ id: string; case_id: string; case_number: string | null; case_title: string | null; process_name: string | null; step_label: string | null; action: string; outcome: string | null; comment: string | null; acted_for: string | null; closed_at: unknown }>(
    `select t.id, t.case_id, t.case_number, t.case_title, c.process_name, t.step_label, t.action, t.outcome, t.comment, t.acted_for, t.closed_at
     from sm_process_tasks t left join sm_process_cases c on c.id = t.case_id and c.org_id = t.org_id
     where t.org_id = $1 and t.acted_by = $2 and t.status = 'done' and t.deleted_at is null
     order by t.closed_at desc nulls last limit ${limit}`,
    [ctx.org.id, ctx.user.id],
  );
  return {
    rows: rows.map((r) => ({
      id: String(r.id), case_id: String(r.case_id), number: r.case_number, title: r.case_title, process: r.process_name, step: r.step_label, action: r.action, outcome: r.outcome,
      comment: r.comment, acted_for: r.acted_for, closed_at: iso(r.closed_at), link: `workflows/c/${r.case_id}`,
    })),
    display: await nameMap(ctx.db, rows.map((r) => r.acted_for)),
  };
}

// ----- «گردش‌کارهای من» -----------------------------------------------------------------------------------------

export interface MyProcess {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  category: string | null;
  description: string | null;
  /** «آغازکننده»، «تأییدکننده در "تأیید رئیس شعبه"»، «در ۲ پرونده» */
  parts: string[];
  /** my open steps in it («منتظر شما: ۳») */
  waiting: number;
  /** my open cases (as requester or participant) */
  cases: number;
  can_start: boolean;
  link: string;
}

interface PublishedRow {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  category: string | null;
  description: string | null;
  status: string;
  version_id: string;
  graph: unknown;
  starters: unknown;
}

const asGraph = (raw: unknown): ProcessGraph => {
  const g = raw && typeof raw === "object" ? (raw as ProcessGraph) : null;
  return g && Array.isArray(g.nodes) ? { nodes: g.nodes, edges: Array.isArray(g.edges) ? g.edges : [] } : { nodes: [], edges: [] };
};
const asRules = (raw: unknown): AssigneeRule[] => (Array.isArray(raw) ? (raw as AssigneeRule[]) : []);

/** «گردش‌کارهای من» (see the header). */
export async function myProcesses(ctx: Ctx): Promise<{ processes: MyProcess[] }> {
  const me = ctx.user.id;
  // published versions are read by those who read the organisation structure (§6.1)
  if (!(await canOpenRecords(ctx, (await defFor(ctx, "process_version")).def))) return { processes: [] };
  // the latest version of each process; a Windows app of someone who does not read the designs has no process rows,
  // only the versions: their process is named by its id there
  const procs = (
    await ctx.db.query<PublishedRow & { has_row: boolean }>(
      `select distinct on (v.process_id) v.process_id as id, coalesce(p.key, v.process_id::text) as key, coalesce(p.name, v.name) as name, p.icon, p.category, p.description,
         coalesce(p.status, 'published') as status, v.id as version_id, v.graph, v.starters, p.id is not null as has_row, p.current_version_id
       from sm_process_versions v left join sm_processes p on p.id = v.process_id and p.org_id = v.org_id and p.deleted_at is null
       where v.org_id = $1 and v.deleted_at is null
       order by v.process_id, v.version_no desc`,
      [ctx.org.id],
    )
  )
    .filter((p) => p.status === "published")
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "fa"));
  const facts = await personFacts(ctx);
  const cases = new Map(
    (await ctx.db.query<{ process_id: string; n: number }>(
      `select process_id, count(*)::int as n from sm_process_cases
       where org_id = $1 and deleted_at is null and state in ('active', 'waiting', 'attention')
         and (requested_by = $2::uuid or requested_for = $2::uuid or participants ? $3::text) group by process_id`,
      [ctx.org.id, me, me],
    )).map((r) => [String(r.process_id), Number(r.n)]),
  );
  const waiting = new Map(
    (await ctx.db.query<{ process_id: string; n: number }>(
      `select process_id, count(*)::int as n from sm_process_tasks where org_id = $1 and assigned_to = $2 and status = 'open' and deleted_at is null group by process_id`,
      [ctx.org.id, me],
    )).map((r) => [String(r.process_id), Number(r.n)]),
  );
  const out: MyProcess[] = [];
  const mayStart = await startChecker(ctx, procs.map((p) => String(p.id)));
  for (const p of procs) {
    const graph = asGraph(p.graph);
    const starters = asRules(p.starters);
    const canStart = await mayStart(String(p.id), starters);
    const parts: string[] = [];
    if (canStart) parts.push("آغازکننده");
    for (const key of myStepKeys(graph, facts)) {
      const n = graph.nodes.find((x) => x.id === key)!;
      parts.push(partOf(formStepOf(n.config).action, processNodeLabel(n)));
    }
    const nCases = cases.get(String(p.id)) ?? 0;
    const nWaiting = waiting.get(String(p.id)) ?? 0;
    if (nCases) parts.push(`در ${faDigits(nCases)} پروندهٔ باز`);
    if (!parts.length && !nWaiting) continue;
    out.push({
      id: String(p.id), key: p.key, name: p.name, icon: p.icon, category: p.category, description: p.description, parts, waiting: nWaiting, cases: nCases,
      can_start: canStart, link: `workflows/p/${p.key}`,
    });
  }
  out.sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, "fa"));
  return { processes: out };
}

// ----- the diagram and the start form ---------------------------------------------------------------------------

export interface StepView {
  key: string;
  label: string;
  action: string;
  start: boolean;
  /** the rules in words («نقش سازمانی: رئیس شعبه»، «گروه: امور مالی») */
  people: string[];
  /** a step whose rules may include me */
  mine: boolean;
  /** cases waiting for me at this step */
  queue: { task_id: string; case_id: string; number: string | null; title: string | null; since: string | null; due_at: string | null }[];
}

export interface ProcessView {
  process: { id: string; key: string; name: string; icon: string | null; category: string | null; description: string | null; status: string };
  version: { id: string; version_no: number };
  graph: ProcessGraph;
  /** form steps in the diagram's order (numbered by the UI) */
  steps: StepView[];
  start: {
    can_start: boolean;
    step: string | null;
    label: string | null;
    /** the start form (from the version's snapshot) and its fields */
    form: { id: string; name: string; layout: unknown } | null;
    fields: Record<string, unknown>;
    rights: Record<string, Right>;
    /** «ارسال برای "…"» */
    next: string | null;
    /** my saved draft of a start */
    draft: Record<string, unknown> | null;
  };
  display: Record<string, string>;
}

/** The words of an assignee rule (names of positions, groups and people from `names`). */
function ruleWords(r: AssigneeRule, names: Record<string, string>, positions: Record<string, string>): string {
  const kind = ASSIGNEE_KIND_LABELS[r.kind] ?? r.kind;
  switch (r.kind) {
    case "position":
      return `${kind}: ${positions[r.position] ?? r.position}`;
    case "group":
      return `${kind}: ${names[r.group] ?? "—"}`;
    case "users":
      return `${kind}: ${r.users.map((u) => names[u] ?? "—").join("، ")}`;
    case "role":
      return `${kind}: ${r.role}`;
    default:
      return kind;
  }
}

/** The published diagram of a process for me, its queues and its start form (see the header). */
export async function processView(ctx: Ctx, ref: string): Promise<ProcessView> {
  const r = String(ref ?? "").trim();
  type Proc = { id: string; key: string; name: string; icon: string | null; category: string | null; description: string | null; status: string; current_version_id: string | null };
  let p = await ctx.db.one<Proc>(
    `select id, key, name, icon, category, description, status, current_version_id from sm_processes
     where org_id = $1 and deleted_at is null and status in ('published', 'retired') and ${isId(r) ? "id = $2::uuid" : "key = $2"}`,
    [ctx.org.id, isId(r) ? r.toLowerCase() : r],
  );
  // a Windows app without process rows: the process's latest version, by the process's id
  if (!p && isId(r) && !(await ctx.db.one(`select 1 as x from sm_processes where org_id = $1 and id = $2`, [ctx.org.id, r.toLowerCase()]))) {
    const v = await ctx.db.one<{ id: string; name: string }>(`select id, name from sm_process_versions where org_id = $1 and process_id = $2 and deleted_at is null order by version_no desc limit 1`, [ctx.org.id, r.toLowerCase()]);
    if (v) p = { id: r.toLowerCase(), key: r.toLowerCase(), name: v.name, icon: null, category: null, description: null, status: "published", current_version_id: v.id };
  }
  const version = p ? await loadVersionInfo(ctx.db, ctx.org.id, p.current_version_id) : null;
  if (!p || !version) throw notFound("گردش‌کار پیدا نشد");
  // published versions are read by those who read the organisation structure (§6.1)
  await get(ctx, "process_version", version.id);
  const me = ctx.user.id;
  const facts = await personFacts(ctx);
  const graph = version.graph;
  const order = topoOrder(graph, forwardEdges(graph)) ?? graph.nodes.map((n) => n.id);
  const mine = new Set(myStepKeys(graph, facts));
  const queue = await ctx.db.query<{ id: string; case_id: string; case_number: string | null; case_title: string | null; step_key: string; opened_at: unknown; due_at: unknown }>(
    `select id, case_id, case_number, case_title, step_key, opened_at, due_at from sm_process_tasks
     where org_id = $1 and process_id = $2 and assigned_to = $3 and status = 'open' and deleted_at is null order by due_at nulls last, opened_at limit 500`,
    [ctx.org.id, p.id, me],
  );
  // names of the rules' positions, groups and people
  const rules = graph.nodes.filter((n) => n.type === "form_step").flatMap((n) => formStepOf(n.config).assignees);
  const posKeys = [...new Set(rules.flatMap((x) => (x.kind === "position" ? [x.position] : [])))];
  const positions = posKeys.length
    ? Object.fromEntries((await ctx.db.query<{ key: string; name: string }>(`select key, name from sm_positions where org_id = $1 and key = any($2::text[]) and deleted_at is null`, [ctx.org.id, pgArray(posKeys)])).map((x) => [x.key, x.name]))
    : {};
  const names = {
    ...(await nameMap(ctx.db, rules.flatMap((x) => (x.kind === "users" ? x.users : [])))),
    ...(await groupNameMap(ctx.db, ctx.org.id, rules.flatMap((x) => (x.kind === "group" ? [x.group] : [])))),
  };
  // whether I may start it: as the start itself checks (the starters resolved for me; a pack's process only for its people)
  const starts = await (await startChecker(ctx, [String(p.id)]))(String(p.id), version.starters);
  const steps: StepView[] = [];
  for (const id of order) {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n || n.type !== "form_step") continue;
    const s = formStepOf(n.config);
    steps.push({
      key: n.id, label: processNodeLabel(n), action: s.action, start: !!s.start,
      people: s.start ? ["درخواست‌دهنده"] : s.assignees.map((x) => ruleWords(x, names, positions)),
      mine: mine.has(n.id) || (!!s.start && starts),
      queue: queue.filter((t) => t.step_key === n.id).map((t) => ({ task_id: String(t.id), case_id: String(t.case_id), number: t.case_number, title: t.case_title, since: iso(t.opened_at), due_at: iso(t.due_at) })),
    });
  }
  // the start form, with my rights in it
  const { start } = startOf(graph);
  const step = start ? formStepOf(start.config) : null;
  const form = step?.form && version.forms ? version.forms.forms[step.form] ?? null : null;
  const defs = version.forms ? snapshotFields(version.forms) : new Map();
  const rights = form && step ? effectiveRights(form.layout, step.rights, defs, { groups: await myGroups(ctx) }) : {};
  const used = new Set(Object.keys(rights));
  const draft = await ctx.db.one<{ values: Record<string, unknown> | null }>(
    `select values from sm_process_drafts where org_id = $1 and user_id = $2 and process_id = $3 and task_id is null and deleted_at is null order by updated_at desc limit 1`,
    [ctx.org.id, me, p.id],
  );
  const canStart = p.status === "published" && starts;
  return {
    process: { id: String(p.id), key: p.key, name: p.name, icon: p.icon, category: p.category, description: p.description, status: p.status },
    version: { id: version.id, version_no: version.version_no },
    graph,
    steps,
    start: {
      can_start: canStart,
      step: start?.id ?? null,
      label: start ? processNodeLabel(start) : null,
      form: form ? { id: form.id, name: form.name, layout: form.layout } : null,
      fields: Object.fromEntries([...defs].filter(([k]) => used.has(k))),
      rights,
      next: start ? nextStepLabel(graph, start.id, "out") : null,
      draft: draft?.values ?? null,
    },
    display: names,
  };
}

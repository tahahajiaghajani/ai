// The rows the workflow engine reads (design F §3.5–3.6, F4a): a case under its row lock, its published version (the
// graph, the form snapshot, starters, the title template, managers), its tasks, and the key a form step waits on.
// Raw reads through the caller's transaction: the engine writes cases, tasks and submissions as the system, through
// the record engine (`createIn`/`updateIn`, trusted), and only reads here.
import { pgArray, type Queryable } from "../../../db";
import { readSnapshot, type FormsSnapshot } from "@shared/forms/snapshot";
import { cleanRule, type AssigneeRule } from "@shared/process/assignees";
import type { CaseProgress, ProcessGraph } from "@shared/process/graph";

export interface CaseRow {
  id: string;
  org_id: string;
  number: string | null;
  title: string | null;
  process_id: string | null;
  process_name: string | null;
  version_id: string | null;
  version_no: number | null;
  state: string;
  requested_by: string | null;
  requested_for: string | null;
  unit_id: string | null;
  participants: string[] | null;
  managers: string[] | null;
  manager_groups: string[] | null;
  current_steps: { key: string; label: string }[] | null;
  open_rounds: Record<string, number> | null;
  progress: CaseProgress | null;
  outcome: string | null;
  started_at: string | null;
  ended_at: string | null;
  run_ref: string | null;
  confidential: boolean;
  data: Record<string, unknown> | null;
  version: number;
}

export interface VersionInfo {
  id: string;
  process_id: string;
  name: string;
  version_no: number;
  graph: ProcessGraph;
  forms: FormsSnapshot | null;
  /** who may start a case (empty: every member) */
  starters: AssigneeRule[];
  title_template: string | null;
  requester_view: string[];
  managers: string[];
  manager_groups: string[];
  confidential: boolean;
}

export interface TaskRow {
  id: string;
  case_id: string;
  step_key: string;
  step_label: string | null;
  action: string;
  round: number;
  assigned_to: string | null;
  delegated_from: string | null;
  status: string;
  outcome: string | null;
  comment: string | null;
  acted_by: string | null;
  acted_for: string | null;
  submission_id: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

export interface SubmissionRow {
  id: string;
  kind: "start" | "step" | "cancel";
  process_id: string | null;
  version_id: string | null;
  case_id: string | null;
  task_id: string | null;
  step_key: string | null;
  round: number | null;
  outcome: string | null;
  return_to: string | null;
  comment: string | null;
  values: Record<string, unknown> | null;
  requested_for: string | null;
  submitted_by: string | null;
  on_behalf_of: string | null;
  submitted_at: string | null;
  result: string | null;
  result_note: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The key a form step's round waits on (`resumeFlowWait`): one per case, node and round. */
export const stepWaitKey = (caseId: string, node: string, round: number): string => `pstep:${caseId}:${node}:${round}`;

/** The case, locked for this transaction (null: no such live case). Every writer of a case takes this lock first. */
export async function lockCase(q: Queryable, orgId: string, caseId: string): Promise<CaseRow | null> {
  if (!isId(caseId)) return null;
  return q.one<CaseRow>(`select * from sm_process_cases where org_id = $1 and id = $2 and deleted_at is null for update`, [orgId, caseId.toLowerCase()]);
}

/** A published version of a process, its columns read into their shapes (null: none in the organisation). */
export async function loadVersionInfo(q: Queryable, orgId: string, versionId: string | null | undefined): Promise<VersionInfo | null> {
  if (!isId(versionId)) return null;
  const r = await q.one<Record<string, unknown>>(
    `select id, process_id, name, version_no, graph, forms, starters, title_template, requester_view, managers, manager_groups, confidential
     from sm_process_versions where org_id = $1 and id = $2 and deleted_at is null`,
    [orgId, versionId.toLowerCase()],
  );
  if (!r) return null;
  const graph = isObj(r.graph) && Array.isArray(r.graph.nodes) ? (r.graph as unknown as ProcessGraph) : { nodes: [], edges: [] };
  if (!Array.isArray(graph.edges)) graph.edges = [];
  return {
    id: String(r.id),
    process_id: String(r.process_id),
    name: String(r.name ?? ""),
    version_no: Number(r.version_no ?? 0),
    graph,
    forms: readSnapshot(r.forms),
    starters: (Array.isArray(r.starters) ? r.starters : []).map(cleanRule).filter((x): x is AssigneeRule => !!x),
    title_template: typeof r.title_template === "string" ? r.title_template : null,
    requester_view: list(r.requester_view),
    managers: list(r.managers),
    manager_groups: list(r.manager_groups),
    confidential: r.confidential === true,
  };
}

/** Every task of a case, oldest first. */
export async function caseTasks(q: Queryable, orgId: string, caseId: string): Promise<TaskRow[]> {
  return q.query<TaskRow>(
    `select id, case_id, step_key, step_label, action, round, assigned_to, delegated_from, status, outcome, comment, acted_by, acted_for, submission_id, opened_at, closed_at
     from sm_process_tasks where org_id = $1 and case_id = $2 and deleted_at is null order by opened_at, id`,
    [orgId, caseId],
  );
}

/** Names of people (full name, else e-mail), by id. */
export async function peopleNames(q: Queryable, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(isId).map((x) => x.toLowerCase()))];
  if (!wanted.length) return new Map();
  const rows = await q.query<{ id: string; full_name: string | null; email: string | null }>(`select id, full_name, email from sm_users where id = any($1::uuid[])`, [pgArray(wanted)]);
  return new Map(rows.map((r) => [String(r.id), r.full_name || r.email || "—"]));
}

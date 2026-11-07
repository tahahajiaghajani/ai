// Rows of the flows' runtime tables (migration 0011_flows) and the SQL that reads and writes them. Runs are runtime
// state of the runtime that executes them — plain tables, written only here and by the executor.
import type { Queryable } from "../../db";
import type { FlowGraph, FlowRunView, FlowStepView, NodeType, RunState, StepStatus, TriggerConfig } from "@shared/flows";
import { uuidv7 } from "@shared/id";

/** A token: one path of a run, standing at `node` (ready) or waiting there (`wait`). */
export interface Token {
  id: string;
  node: string;
  /** enclosing frames, innermost last: parallel branches (fork) and loop iterations */
  frames: string[];
  wait?: string | null;
}

export interface ForkFrame {
  kind: "fork";
  id: string;
  /** the «اجرای موازی» node */
  node: string;
  expected: number;
  arrived: number;
  dead: number;
  /** the «پیوستن شاخه‌ها» its branches meet at (set by the first arrival) */
  join: string | null;
  /** «any»: the first arrival continued already */
  fired: boolean;
}

export interface LoopFrame {
  kind: "loop";
  id: string;
  /** the «برای هر مورد» node */
  node: string;
  /** how many items (the items themselves are in sm_flow_loop_items, written once) */
  count: number;
  index: number;
  /** the current item ({{item}}) */
  item: unknown;
  /** live tokens of the current iteration */
  live: number;
  /** where each iteration starts */
  target: string;
}

export type Frame = ForkFrame | LoopFrame;

export interface Runtime {
  tokens: Token[];
  frames: Record<string, Frame>;
  /** executed steps (the endless-loop guard) */
  steps: number;
  /** step sequence: step keys are `s<seq>` (idempotency) */
  seq: number;
  /** id counter of tokens and frames */
  ids: number;
}

export interface RunRow {
  id: string;
  org_id: string;
  flow_id: string;
  flow_name: string;
  version_id: string | null;
  version_no: number | null;
  graph: FlowGraph | null;
  state: RunState;
  test: boolean;
  trigger_kind: string;
  trigger_table: string | null;
  trigger_record_id: string | null;
  actor_id: string | null;
  run_as: string | null;
  run_as_kind: "user" | "system";
  depth: number;
  parent_run_id: string | null;
  parent_wait_id: string | null;
  context: Record<string, any>;
  runtime: Runtime;
  current_nodes: string[];
  steps_count: number;
  error: string | null;
  lease_by: string | null;
  lease_until: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface WaitRow {
  id: string;
  org_id: string;
  run_id: string;
  token_id: string;
  node_id: string;
  step_key: string;
  kind: string;
  key: string | null;
  due_at: string | null;
  data: Record<string, any>;
  result: Record<string, any> | null;
  created_at: string;
}

export interface StepRow {
  id: string;
  run_id: string;
  key: string;
  node_id: string;
  node_type: NodeType;
  label: string;
  status: StepStatus;
  port: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
}

/** A published version as the executor reads it. */
export interface VersionRow {
  id: string;
  flow_id: string;
  version_no: number;
  graph: FlowGraph;
  trigger: TriggerConfig;
}

const MAX_JSON = 64 * 1024;

/** A JSON value kept in a log or a run's data: at most 64 KB (a preview of longer ones). */
export function capJson(v: unknown, max = MAX_JSON): unknown {
  if (v === undefined) return null;
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    return { truncated: true, preview: String(v).slice(0, 2000) };
  }
  if (s === undefined) return null;
  return s.length <= max ? v : { truncated: true, size: s.length, preview: s.slice(0, 4000) };
}

export async function loadRun(q: Queryable, id: string): Promise<RunRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return q.one<RunRow>(`select * from sm_flow_runs where id = $1`, [id]);
}

export async function loadVersion(q: Queryable, orgId: string, id: string): Promise<VersionRow | null> {
  return q.one<VersionRow>(`select id, flow_id, version_no, graph, trigger from sm_flow_versions where org_id = $1 and id = $2`, [orgId, id]);
}

export async function loadWait(q: Queryable, id: string): Promise<WaitRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return q.one<WaitRow>(`select * from sm_flow_waits where id = $1`, [id]);
}

export async function waitsOf(q: Queryable, runId: string): Promise<WaitRow[]> {
  return q.query<WaitRow>(`select * from sm_flow_waits where run_id = $1 order by created_at, id`, [runId]);
}

export async function stepsOf(q: Queryable, runId: string): Promise<StepRow[]> {
  return q.query<StepRow>(`select * from sm_flow_run_steps where run_id = $1 order by started_at, key`, [runId]);
}

export interface StepLog {
  key: string;
  node: { id: string; type: string; label: string };
  status: StepStatus;
  port?: string | null;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  startedAt: number;
  endedAt?: number | null;
}

/** Write (or update, by key) one step of a run's log. */
export async function writeStep(q: Queryable, orgId: string, runId: string, s: StepLog): Promise<void> {
  const ended = s.endedAt ?? null;
  await q.query(
    `insert into sm_flow_run_steps (id, org_id, run_id, key, node_id, node_type, label, status, port, input, output, error, started_at, ended_at, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, to_timestamp($13::double precision / 1000), $14::timestamptz, $15)
     on conflict (run_id, key) do update set status = excluded.status, port = excluded.port,
       input = coalesce(excluded.input, sm_flow_run_steps.input), output = excluded.output, error = excluded.error,
       ended_at = excluded.ended_at,
       duration_ms = case when excluded.ended_at is null then null
                          else greatest(0, (extract(epoch from (excluded.ended_at - sm_flow_run_steps.started_at)) * 1000)::int) end`,
    [
      uuidv7(), orgId, runId, s.key, s.node.id, s.node.type, s.node.label.slice(0, 120), s.status, s.port ?? null,
      s.input === undefined ? null : JSON.stringify(capJson(s.input)),
      s.output === undefined ? null : JSON.stringify(capJson(s.output)),
      s.error ? s.error.slice(0, 4000) : null,
      s.startedAt,
      ended === null ? null : new Date(ended).toISOString(),
      ended === null ? null : Math.max(0, Math.round(ended - s.startedAt)),
    ],
  );
}

export function runView(r: RunRow): FlowRunView {
  return {
    id: r.id,
    flow_id: r.flow_id,
    flow_name: r.flow_name,
    version_no: r.version_no,
    state: r.state,
    test: r.test,
    trigger_kind: r.trigger_kind as FlowRunView["trigger_kind"],
    trigger_table: r.trigger_table,
    trigger_record_id: r.trigger_record_id,
    actor_id: r.actor_id,
    run_as: r.run_as_kind === "system" ? null : r.run_as,
    depth: r.depth,
    parent_run_id: r.parent_run_id,
    current_nodes: r.current_nodes ?? [],
    steps_count: r.steps_count,
    error: r.error,
    started_at: new Date(r.started_at).toISOString(),
    ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  };
}

export function stepView(s: StepRow): FlowStepView {
  return {
    id: s.id,
    key: s.key,
    node_id: s.node_id,
    node_type: s.node_type,
    label: s.label,
    status: s.status,
    port: s.port,
    input: s.input,
    output: s.output,
    error: s.error,
    started_at: new Date(s.started_at).toISOString(),
    ended_at: s.ended_at ? new Date(s.ended_at).toISOString() : null,
    duration_ms: s.duration_ms,
  };
}

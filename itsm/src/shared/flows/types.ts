// Flows («گردش‌کارها»): the no-code automation's shared vocabulary — the graph a designer draws, the trigger that
// starts it, schedules, runs and step logs. Pure types, imported by the server (executor, API) and the UI
// (designer, run history). docs/spec/services/flows.md documents all of it.

/** One step of a flow. `config` is the node type's settings (see NODE_TYPES); values may hold data pills. */
export interface FlowNode {
  id: string;
  type: NodeType;
  /** what the designer shows (default: the node type's label) */
  label?: string;
  config: Record<string, unknown>;
  /** designer position (ignored by the executor) */
  position?: { x: number; y: number };
}

/** A connection from an output port of `source` to `target`. */
export interface FlowEdge {
  id: string;
  source: string;
  /** output port of the source (default "out"); see NODE_TYPES[type].ports */
  port?: string;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** designer preferences (layout direction) */
  layout?: { direction?: "TB" | "RL" };
}

export type NodeType =
  | "trigger"
  | "update_record"
  | "create_record"
  | "add_comment"
  | "notify"
  | "approval"
  | "wait_condition"
  | "wait_duration"
  | "branch"
  | "parallel"
  | "join"
  | "for_each"
  | "call_http"
  | "set_vars"
  | "subflow"
  | "ai_skill"
  | "end";

/** What starts a flow. */
export type TriggerKind = "record" | "schedule" | "webhook" | "manual" | "catalog";

/** Record events a record trigger listens to (the engine's `record.<kind>`). */
export type TriggerEvent = "created" | "updated" | "state_changed" | "assigned" | "commented" | "deleted";

/** Whose access a run acts with. */
export type RunAs = "trigger_user" | "user" | "system";

/** The trigger part of a flow as it is published with a version (the flow record's trigger fields). */
export interface TriggerConfig {
  kind: TriggerKind;
  table?: string | null;
  events?: TriggerEvent[];
  /** record.updated only: run only when one of these fields changed (empty = any field) */
  fields?: string[];
  /** engine condition on the trigger record (evaluated when the event is handled) */
  condition?: unknown;
  schedule?: ScheduleSpec | null;
  /** catalog trigger: the catalog item key/id (the catalog module calls `startCatalogFlows`) */
  catalog_item?: string | null;
  run_as: RunAs;
  run_as_user?: string | null;
}

/**
 * When something recurs, in the organisation's time zone. Jalali-friendly: `monthly`/`yearly` count Jalali
 * months and days; `weekly` days are 0 = Saturday … 6 = Friday (the Persian week); `cron` is the classic
 * five fields (minute hour day-of-month month day-of-week, Gregorian, 0 = Sunday) for power users.
 */
export type ScheduleSpec =
  | { kind: "interval"; every: number; unit: "minute" | "hour" | "day"; start?: string | null }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; weekdays: number[] }
  | { kind: "monthly"; time: string; days: number[]; last?: boolean; months?: number[] }
  | { kind: "yearly"; time: string; month: number; day: number }
  | { kind: "cron"; expr: string }
  | { kind: "once"; at: string };

export type RunState = "running" | "waiting" | "completed" | "failed" | "canceled";
export type StepStatus = "running" | "completed" | "failed" | "waiting" | "canceled";

export const RUN_STATES: Record<RunState, { label: string; color: string; done: boolean }> = {
  running: { label: "در حال اجرا", color: "blue", done: false },
  waiting: { label: "در انتظار", color: "gold", done: false },
  completed: { label: "انجام شد", color: "green", done: true },
  failed: { label: "ناموفق", color: "red", done: true },
  canceled: { label: "لغوشده", color: "gray", done: true },
};

export const STEP_STATUSES: Record<StepStatus, { label: string; color: string }> = {
  running: { label: "در حال اجرا", color: "blue" },
  completed: { label: "انجام شد", color: "green" },
  failed: { label: "ناموفق", color: "red" },
  waiting: { label: "در انتظار", color: "gold" },
  canceled: { label: "لغوشده", color: "gray" },
};

/** A run as the API returns it (GET /flows/runs, /flows/runs/:id). */
export interface FlowRunView {
  id: string;
  flow_id: string;
  flow_name: string;
  version_no: number | null;
  state: RunState;
  test: boolean;
  trigger_kind: TriggerKind | "test" | "subflow";
  trigger_table: string | null;
  trigger_record_id: string | null;
  actor_id: string | null;
  run_as: string | null;
  depth: number;
  parent_run_id: string | null;
  current_nodes: string[];
  steps_count: number;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface FlowStepView {
  id: string;
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

/** A wait of a run that a person can act on (the built-in approval). */
export interface FlowWaitView {
  id: string;
  node_id: string;
  kind: string;
  due_at: string | null;
  data: Record<string, unknown>;
  /** may the caller decide it (the built-in approval) */
  can_decide: boolean;
}

export interface FlowRunDetail {
  run: FlowRunView;
  steps: FlowStepView[];
  waits: FlowWaitView[];
  /** the run's data (trigger, vars, step outputs) — null when the caller may not see the records behind it */
  context: Record<string, unknown> | null;
  /** the graph the run executes (its version's, or a test run's draft) */
  graph: FlowGraph | null;
  can_cancel: boolean;
}

/** A problem the validator found (designer badges, publish refusals). */
export interface FlowProblem {
  level: "error" | "warning";
  message: string;
  node?: string;
  edge?: string;
  /** the config key of the node the problem is about */
  field?: string;
}

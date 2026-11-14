// A case's progress (design F §3.6.3, §3.6.7, F4a): what the diagram and the user pages read — `progress` (per node:
// status, outcome, port, round, time, actors), `current_steps`, `open_rounds`, `participants` and the open state —
// recomputed by the authority whenever it writes the case: a form step opens or settles, a parallel branch is
// withdrawn, the run ends.
// `progress` is the case's run replayed from its step log (sm_flow_run_steps of `run_ref`) on top of what the case
// recorded before (a run that «ادامه از مرحلهٔ …» started keeps the earlier run's entries): every node the run
// passed, with the port a «شرط» or «انتخاب» took; form steps with their round, decision and actors (the handler writes
// them into its step's output); a «پایان» with the case's outcome. A form step that runs again (a «بازگشت» reopened
// it, or a new run started at it) drops the entries forward of it — they run again. What the log cannot hold yet (the
// step being opened or settled in this very transaction) comes as `extra`; a round an apply settled stays settled
// while its log row still waits for the executor's resume.
import type { Queryable, Tx } from "../../../db";
import type { Ctx } from "../../../context";
import { updateIn } from "../../../engine";
import {
  endOutcomeOf, forwardEdges, processNodeLabel, reachable, type CaseProgress, type ProcessGraph, type StepOutcome, type StepProgress,
} from "@shared/process/graph";
import { caseTasks, type CaseRow, type TaskRow } from "./store";

/** A row of the run's step log as the replay reads it. */
export interface LogStep {
  key: string;
  node_id: string;
  node_type: string;
  status: string;
  port: string | null;
  output: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
}

/** States of a case in which the engine still moves it. */
export const OPEN_STATES = new Set(["active", "waiting", "attention"]);

const seq = (key: string) => Number(String(key).replace(/^\D+/, "")) || 0;
const iso = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);
const num = (v: unknown, d = 1) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** The step log of a run, in the order the steps ran. */
export async function runLog(q: Queryable, runId: string | null | undefined): Promise<LogStep[]> {
  if (!runId) return [];
  const rows = await q.query<LogStep>(`select key, node_id, node_type, status, port, output, started_at, ended_at from sm_flow_run_steps where run_id = $1`, [runId]);
  return rows.sort((a, b) => seq(a.key) - seq(b.key));
}

/** The nodes downstream of `node` on the forward graph (itself excluded). */
function downstream(graph: ProcessGraph, node: string): Set<string> {
  const out = reachable(forwardEdges(graph), [node]);
  out.delete(node);
  return out;
}

/** What one log row says about its node (null: nothing to record). */
function entryOf(graph: ProcessGraph, s: LogStep): StepProgress | null {
  const node = graph.nodes.find((n) => n.id === s.node_id);
  if (!node) return null;
  const o = s.output && typeof s.output === "object" ? s.output : {};
  const round = node.type === "form_step" ? num(o.round) : 1;
  if (s.status === "waiting" || s.status === "running") {
    return { status: "active", round, at: iso(s.started_at), ...(node.type === "form_step" ? { waiting: Number(o.waiting) || 0 } : {}) };
  }
  if (s.status === "completed") {
    if (node.type === "end") return { status: "done", outcome: endOutcomeOf(node.config), round: 1, at: iso(s.ended_at) };
    if (node.type === "form_step") {
      const actors = Array.isArray(o.actors) ? o.actors.map(String) : [];
      if (o.skipped === true) return { status: "skipped", port: s.port, round, at: iso(s.ended_at) };
      return { status: "done", outcome: (typeof o.outcome === "string" ? o.outcome : null) as StepOutcome | null, port: s.port, round, at: iso(s.ended_at), actors };
    }
    return { status: "done", port: s.port, round: 1, at: iso(s.ended_at) };
  }
  // canceled (a withdrawn branch, an ended run) or failed
  return { status: "canceled", round, at: iso(s.ended_at ?? s.started_at) };
}

/**
 * Replay `steps` on top of `base`, then apply `extra` (entries of this transaction). A form step met again drops the
 * entries downstream of it before it is recorded. A form step whose log row still waits (or runs) for the round
 * `base` records as done or skipped keeps that entry: an apply settled the round, and the executor has not yet run
 * the resume that completes the row.
 */
export function replayProgress(graph: ProcessGraph, base: CaseProgress | null | undefined, steps: readonly LogStep[], extra: Record<string, StepProgress> = {}): CaseProgress {
  const stored: CaseProgress = { ...(base && typeof base === "object" ? base : {}) };
  const out: CaseProgress = { ...stored };
  const isForm = (id: string) => graph.nodes.some((n) => n.id === id && n.type === "form_step");
  const reopen = (id: string) => {
    if (!out[id] || !isForm(id)) return;
    for (const d of downstream(graph, id)) delete out[d];
  };
  for (const s of steps) {
    const e = entryOf(graph, s);
    if (!e) continue;
    reopen(s.node_id);
    const kept = stored[s.node_id];
    const settled = e.status === "active" && isForm(s.node_id) && (kept?.status === "done" || kept?.status === "skipped") && kept.round === e.round;
    out[s.node_id] = settled ? kept : e;
  }
  for (const [id, e] of Object.entries(extra)) {
    const prev = out[id];
    // the step opening now, after it ran before: what lies after it runs again
    if (e.status === "active" && prev && !(prev.status === "active" && prev.round === e.round)) reopen(id);
    out[id] = e;
  }
  return out;
}

/** People of a case's tasks: open ones' assignee and the person they stand in for, done ones' actor and the person acted for. */
export function participantsOf(tasks: readonly TaskRow[]): string[] {
  const out = new Set<string>();
  for (const t of tasks) {
    if (t.status === "open") {
      if (t.assigned_to) out.add(String(t.assigned_to));
      if (t.delegated_from) out.add(String(t.delegated_from));
    } else if (t.status === "done") {
      if (t.acted_by) out.add(String(t.acted_by));
      if (t.acted_for) out.add(String(t.acted_for));
    }
  }
  return [...out].sort();
}

export interface RefreshOptions {
  /** entries of this transaction the log does not hold yet */
  extra?: Record<string, StepProgress>;
  /** further fields to write with it (data, state, outcome, run_ref…) */
  set?: Record<string, unknown>;
  /** the case's tasks as they are now (read when absent) */
  tasks?: TaskRow[];
}

/**
 * Recompute and write a case's progress, current steps, open rounds, participants and open state (inside the
 * transaction that holds its lock). Returns the stored row.
 */
export async function refreshCase(tx: Tx, sys: Ctx, kase: CaseRow, graph: ProcessGraph, opts: RefreshOptions = {}): Promise<Record<string, unknown>> {
  const tasks = opts.tasks ?? (await caseTasks(tx, sys.org.id, kase.id));
  const progress = replayProgress(graph, kase.progress, await runLog(tx, (opts.set?.run_ref as string | undefined) ?? kase.run_ref), opts.extra);
  const current: { key: string; label: string }[] = [];
  const rounds: Record<string, number> = {};
  for (const n of graph.nodes) {
    const p = progress[n.id];
    if (n.type !== "form_step" || p?.status !== "active") continue;
    progress[n.id] = { ...p, waiting: tasks.filter((t) => t.step_key === n.id && Number(t.round) === p.round && t.status === "open").length };
    current.push({ key: n.id, label: processNodeLabel(n) });
    rounds[n.id] = p.round;
  }
  const set: Record<string, unknown> = { progress, current_steps: current, open_rounds: rounds, participants: participantsOf(tasks), ...opts.set };
  const state = String(set.state ?? kase.state);
  if (!OPEN_STATES.has(state)) {
    // a closed case has no open step
    set.current_steps = [];
    set.open_rounds = {};
  } else if (set.state === undefined && (state === "active" || state === "waiting")) {
    // an open case waits while one of its open steps has nobody to do it
    set.state = current.some((c) => !progress[c.key]?.waiting) ? "waiting" : "active";
  }
  return updateIn(tx, sys, "process_case", kase.id, set, { trusted: true });
}

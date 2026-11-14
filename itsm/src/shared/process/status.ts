// The diagram of a case (design F §3.6.7, F4a): `stepStatuses(version, case, myTasks, me)` gives every node of the
// version's graph one status —
//   · `done` (with its outcome), `active` (with how many people it waits for);
//   · `mine_open`, `mine_done`: a step I have open, or one I acted in;
//   · `mine_expected`: a step still to come whose people may include me — by a static check of my positions, groups,
//     roles and named membership (F3's `mayInclude`), plus the steps the server's resolver dry run names (`expected`);
//   · `skipped`: passed by (another branch was taken, the case ended, a parallel branch was withdrawn);
//   · `future`: still to come.
// From the case's `progress` alone (see `CaseProgress`): what lies ahead is what the active steps, and the paths the
// recorded nodes took, still lead to. Pure and shared: the server's case API and the Windows app (from synced rows: the
// version, `progress`, my tasks and my positions) answer the same.
// Imported by the UI: keep it free of server imports.
import { mayInclude, type PersonFacts } from "./assignees";
import { forwardEdges, formStepOf, progressPort, startOf, type CaseProgress, type EndOutcome, type ProcessGraph, type StepOutcome } from "./graph";

export type NodeStatus = "done" | "active" | "mine_open" | "mine_done" | "mine_expected" | "skipped" | "future";

export interface NodeStatusView {
  status: NodeStatus;
  /** done, mine_done: the decision (a form step) or the case's outcome (a «پایان») */
  outcome?: StepOutcome | EndOutcome | null;
  /** active, mine_open: how many people the step waits for */
  waiting?: number;
  round?: number;
}

export interface CaseLike {
  state: string;
  progress?: CaseProgress | null;
  requested_by?: string | null;
  requested_for?: string | null;
}

/** My task rows of the case (status open, done, not_needed, canceled). */
export interface MyTaskLike {
  step_key: string;
  status: string;
  outcome?: string | null;
  round?: number | null;
}

/** Case states after which nothing more happens. */
export const FINISHED_CASE_STATES = ["completed", "rejected", "canceled"] as const;

export function stepStatuses(
  version: { graph: ProcessGraph },
  kase: CaseLike,
  myTasks: readonly MyTaskLike[],
  me: PersonFacts | null,
  opts: { expected?: Iterable<string> } = {},
): Record<string, NodeStatusView> {
  const graph = version.graph;
  const progress: CaseProgress = kase.progress && typeof kase.progress === "object" ? kase.progress : {};
  const finished = (FINISHED_CASE_STATES as readonly string[]).includes(kase.state);
  const fwd = forwardEdges(graph);
  const recorded = (id: string) => !!progress[id];

  // what lies ahead: from the active nodes on every path, from the passed ones on the path they took
  const ahead = new Set<string>();
  if (!finished) {
    const stack: string[] = [];
    const follow = (id: string, port: string | null) => {
      for (const e of fwd) if (e.source === id && (port === null || (e.port ?? "out") === port) && !recorded(e.target)) stack.push(e.target);
    };
    for (const [id, p] of Object.entries(progress)) {
      if (p.status === "active") follow(id, null);
      else if (p.status === "done") follow(id, progressPort(p));
    }
    // a case not yet recorded (a start still in the queue): everything from «آغاز» lies ahead
    if (!Object.keys(progress).length) {
      const { trigger } = startOf(graph);
      if (trigger) stack.push(trigger.id);
    }
    while (stack.length) {
      const id = stack.pop()!;
      if (ahead.has(id)) continue;
      ahead.add(id);
      follow(id, null);
    }
  }

  // my tasks: the latest round per step
  const mine = new Map<string, MyTaskLike>();
  for (const t of myTasks) {
    const prev = mine.get(t.step_key);
    const better = !prev || (t.round ?? 1) > (prev.round ?? 1) || ((t.round ?? 1) === (prev.round ?? 1) && t.status === "open");
    if (better) mine.set(t.step_key, t);
  }
  const expected = new Set(opts.expected ?? []);
  const requester = kase.requested_by ?? null;

  const out: Record<string, NodeStatusView> = {};
  for (const n of graph.nodes) {
    const p = progress[n.id];
    const t = mine.get(n.id);
    const round = p?.round ?? t?.round ?? undefined;
    const base = round ? { round } : {};
    if (t?.status === "open" && !finished && p?.status === "active") {
      out[n.id] = { status: "mine_open", waiting: p.waiting ?? 1, ...base };
      continue;
    }
    if (p?.status === "active") {
      out[n.id] = { status: finished ? "skipped" : "active", waiting: p.waiting ?? 0, ...base };
      continue;
    }
    if (p?.status === "done") {
      const acted = t?.status === "done";
      out[n.id] = { status: acted ? "mine_done" : "done", outcome: (acted && t?.outcome ? t.outcome : p.outcome) as StepOutcome | EndOutcome | null, ...base };
      continue;
    }
    if (p) {
      out[n.id] = { status: "skipped", ...base };
      continue;
    }
    if (!ahead.has(n.id)) {
      out[n.id] = { status: "skipped" };
      continue;
    }
    if (n.type === "form_step") {
      const step = formStepOf(n.config);
      const forMe = expected.has(n.id) || (!!me && (step.start ? requester === me.user : mayInclude(step, step.action, me, requester)));
      if (forMe) {
        out[n.id] = { status: "mine_expected" };
        continue;
      }
    }
    out[n.id] = { status: "future" };
  }
  return out;
}

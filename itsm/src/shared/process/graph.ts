// The graph of a workflow «گردش‌کار» (design F §3.5, package F4a): the flows `FlowGraph` with the process node set. A
// process runs on the flows executor (trigger kind `process`): «آغاز» is a pass-through, «ثبت درخواست» the start
// form, then form steps («مرحلهٔ فرم»، «بررسی»، «تأیید»), conditions on the case's values, parallel branches and
// their join, waits, notices, automations («جریان خودکار»), value assignments and the ends. Each form step carries
// its whole setting in its node's `config` (form, rights, people, quorum, SLA); `processSteps` takes them out for the
// version's `steps` column. The case's values reach conditions as `{{case.<field>}}` (the run's context root `case`,
// refreshed whenever a step settles) — values are never engine fields of the case (D5).
// Only one kind of cycle exists: «بازگشت برای اصلاح», an edge from a review or approve step's `returned` port back to
// an earlier form step on the same branch (`validateProcess`, ./validate.ts). Everything else flows forward.
// Pure and shared: the designer, the validator, the diagram (`stepStatuses`) and the server's engine read it.
// Imported by the UI: keep it free of server imports.
import type { FlowEdge, FlowGraph, FlowNode } from "../flows/types";
import { DURATION_UNITS } from "../flows/nodes";
import { cleanStepRights, type StepRights } from "../forms/layout";
import { cleanRule, cleanStepAssignees, QUORUMS, STEP_ACTIONS, type AssigneeRule, type Quorum, type StepAction, type StepAssignees } from "./assignees";

export type ProcessNodeType =
  | "trigger"
  | "form_step"
  | "branch"
  | "choice"
  | "parallel"
  | "join"
  | "wait_duration"
  | "notify"
  | "subflow"
  | "set_values"
  | "end";

export interface ProcessNode extends Omit<FlowNode, "type"> {
  type: ProcessNodeType;
}

/** A process's graph: the flows graph with the process node set. */
export interface ProcessGraph extends Omit<FlowGraph, "nodes"> {
  nodes: ProcessNode[];
}

/** The run's context root the case's values are read from: `{{case.u_amount}}`, `{{case.number}}`. */
export const CASE_ROOT = "case";
/** Keys of the `case` root beside the values (library fields are `u_*`, so they never collide). */
export const CASE_META_KEYS = ["number", "title", "requested_by", "requested_for", "unit_id"] as const;

// ---------------------------------------------------------------------------------------------------------------
// Ports

export interface ProcessPort {
  key: string;
  label: string;
  /** several edges may leave it (parallel branches) */
  multi?: boolean;
  /** may stay unwired: «پایان مهلت» (nothing happens but the escalations), «بازگشت برای اصلاح» (not offered), the error path (the case needs attention) */
  optional?: boolean;
  /** the edges of this port go back to an earlier step (the only cycle a process may have) */
  back?: boolean;
}

const OUT: ProcessPort = { key: "out", label: "بعدی" };
const TIMEOUT: ProcessPort = { key: "timeout", label: "پایان مهلت", optional: true };
const RETURNED: ProcessPort = { key: "returned", label: "بازگشت برای اصلاح", optional: true, back: true };

/** The port a step decision leaves by. */
export const OUTCOME_PORT = { submitted: "out", approved: "approved", rejected: "rejected", returned: "returned" } as const;
export type StepOutcome = keyof typeof OUTCOME_PORT;

/** The decisions an action offers (`returned` only when the step's «بازگشت» is wired). */
export function stepOutcomes(action: StepAction): StepOutcome[] {
  if (action === "approve") return ["approved", "rejected", "returned"];
  if (action === "review") return ["submitted", "returned"];
  return ["submitted"];
}

/** The ports of a node under its settings (form steps by action, «انتخاب» by its cases). */
export function processPorts(node: Pick<ProcessNode, "type" | "config">): ProcessPort[] {
  const c = (node.config ?? {}) as Record<string, unknown>;
  switch (node.type) {
    case "trigger":
      return [OUT];
    case "form_step": {
      if (c.start === true) return [OUT, TIMEOUT];
      const action = c.action;
      if (action === "approve") return [{ key: "approved", label: "تأیید شد" }, { key: "rejected", label: "رد شد" }, RETURNED, TIMEOUT];
      if (action === "review") return [{ key: "out", label: "ادامه" }, RETURNED, TIMEOUT];
      return [OUT, TIMEOUT];
    }
    case "branch":
      return [{ key: "yes", label: "بله" }, { key: "no", label: "خیر" }];
    case "choice":
      return [...choiceCases(c).map((x) => ({ key: x.key, label: x.label || x.key })), { key: "else", label: "هیچ‌کدام" }];
    case "parallel":
      return [{ key: "out", label: "شاخه‌ها", multi: true }];
    case "subflow":
      return [OUT, { key: "error", label: "خطا", optional: true }];
    case "end":
      return [];
    default:
      return [OUT];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The node set

export interface ProcessNodeDef {
  type: ProcessNodeType;
  label: string;
  hint: string;
  icon: string;
}

/** The nodes a process may use, in the designer's palette order (the flows' other steps run in a «جریان خودکار»). */
export const PROCESS_NODE_TYPES: Record<ProcessNodeType, ProcessNodeDef> = {
  trigger: { type: "trigger", label: "آغاز", hint: "پرونده با ثبت درخواست آغاز می‌شود", icon: "play" },
  form_step: { type: "form_step", label: "مرحلهٔ فرم", hint: "فرمی که کسی پر، بررسی یا تأیید می‌کند", icon: "file-pen" },
  branch: { type: "branch", label: "شرط", hint: "بسته به مقدارهای پرونده یکی از دو مسیر را می‌رود", icon: "git-branch" },
  choice: { type: "choice", label: "انتخاب", hint: "بسته به مقدارهای پرونده یکی از چند مسیر را می‌رود", icon: "signpost" },
  parallel: { type: "parallel", label: "موازی", hint: "چند مسیر را هم‌زمان پیش می‌برد", icon: "split" },
  join: { type: "join", label: "پیوستن", hint: "منتظر شاخه‌های موازی می‌ماند", icon: "merge" },
  wait_duration: { type: "wait_duration", label: "انتظار", hint: "مدتی (به وقت کاری) صبر می‌کند", icon: "timer" },
  notify: { type: "notify", label: "اعلان", hint: "به افرادی پیام می‌دهد", icon: "bell" },
  subflow: { type: "subflow", label: "جریان خودکار", hint: "یک جریان خودکار منتشرشده را برای پرونده اجرا می‌کند", icon: "workflow" },
  set_values: { type: "set_values", label: "تعیین مقدار", hint: "مقدارهایی از پرونده را می‌نویسد", icon: "pencil-line" },
  end: { type: "end", label: "پایان", hint: "پرونده را با نتیجه‌ای به پایان می‌برد", icon: "flag" },
};

export const isProcessNodeType = (t: unknown): t is ProcessNodeType => typeof t === "string" && Object.prototype.hasOwnProperty.call(PROCESS_NODE_TYPES, t);

/** The label a node shows: its own, or «ثبت درخواست» / its action's / its type's. */
export function processNodeLabel(n: { type: string; label?: string | null; config?: Record<string, unknown> | null }): string {
  const own = (n.label ?? "").trim();
  if (own) return own;
  if (n.type === "form_step") {
    const c = n.config ?? {};
    if (c.start === true) return "ثبت درخواست";
    return c.action === "approve" ? "تأیید" : c.action === "review" ? "بررسی" : "مرحلهٔ فرم";
  }
  return isProcessNodeType(n.type) ? PROCESS_NODE_TYPES[n.type].label : n.type;
}

// ---------------------------------------------------------------------------------------------------------------
// Settings of the nodes

export type DurationUnit = (typeof DURATION_UNITS)[number]["value"];
export interface Duration {
  amount: number;
  unit: DurationUnit;
}

/** What happens after a while on a form step: tell someone, give the step to others, or decide it. */
export type Escalation =
  | { after: Duration; action: "notify"; to: "manager" | "reports_to" | "managers" }
  | { after: Duration; action: "reassign"; rules: AssigneeRule[] }
  | { after: Duration; action: "auto"; outcome: StepOutcome };

export const ESCALATION_ACTIONS = ["notify", "reassign", "auto"] as const;
export const ESCALATION_TARGETS = ["manager", "reports_to", "managers"] as const;

/** A form step's settings (its node's `config`). The start step's people are the requester. */
export interface FormStep extends StepAssignees {
  action: StepAction;
  /** «ثبت درخواست»: the first step after «آغاز»; round 1 is the start submission itself */
  start?: boolean;
  /** the form's id (in the version's snapshot) */
  form: string | null;
  rights: StepRights;
  /** approve: how many approvals settle it */
  quorum?: Quorum;
  /** approve, quorum count: how many; percent: what percentage */
  threshold?: number | null;
  /** a returned step reopens for its earlier actor (default) or by its rules */
  returnTo?: "actor" | "rule";
  /** the step's own time («مهلت»), business time unless `business: false` */
  due?: Duration | null;
  business?: boolean;
  remind_every?: Duration | null;
  escalate?: Escalation[];
}

export const RETURN_TO = ["actor", "rule"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const UNITS = new Set<string>(DURATION_UNITS.map((u) => u.value));

/** A duration as stored (null when it is not one). */
export function cleanDuration(v: unknown): Duration | null {
  if (!isObj(v)) return null;
  const amount = Number(v.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !UNITS.has(String(v.unit))) return null;
  return { amount, unit: v.unit as DurationUnit };
}

/** Milliseconds of a duration (calendar time; the server counts business time through its clock). */
export function durationMs(d: Duration): number {
  const unit: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000 };
  return Math.round(d.amount * (unit[d.unit] ?? 0));
}

function cleanEscalation(raw: unknown): Escalation | null {
  if (!isObj(raw)) return null;
  const after = cleanDuration(raw.after);
  if (!after) return null;
  if (raw.action === "notify" && (ESCALATION_TARGETS as readonly string[]).includes(String(raw.to))) return { after, action: "notify", to: raw.to as "manager" };
  if (raw.action === "reassign") {
    const rules = Array.isArray(raw.rules) ? raw.rules.map(cleanRule).filter((r): r is AssigneeRule => !!r).slice(0, 10) : [];
    return { after, action: "reassign", rules };
  }
  if (raw.action === "auto" && typeof raw.outcome === "string" && raw.outcome in OUTCOME_PORT) return { after, action: "auto", outcome: raw.outcome as StepOutcome };
  return null;
}

/** A form step's settings from its node's config: unknown keys dropped; a wrong value kept for the validator to name. */
export function formStepOf(config: unknown): FormStep {
  const c = isObj(config) ? config : {};
  const action = (STEP_ACTIONS as readonly string[]).includes(String(c.action)) ? (c.action as StepAction) : c.start === true ? "fill" : ((typeof c.action === "string" ? c.action : "fill") as StepAction);
  const step: FormStep = { ...cleanStepAssignees(c), action, form: typeof c.form === "string" && c.form.trim() ? c.form.trim() : null, rights: cleanStepRights(c.rights) };
  if (c.start === true) step.start = true;
  if (c.quorum !== undefined && c.quorum !== null && c.quorum !== "") step.quorum = String(c.quorum) as Quorum;
  if (c.threshold !== undefined && c.threshold !== null && c.threshold !== "") step.threshold = Number(c.threshold);
  if (c.returnTo !== undefined && c.returnTo !== null && c.returnTo !== "") step.returnTo = String(c.returnTo) as "actor";
  const due = cleanDuration(c.due);
  if (due) step.due = due;
  if (c.business === false) step.business = false;
  const remind = cleanDuration(c.remind_every);
  if (remind) step.remind_every = remind;
  if (Array.isArray(c.escalate)) step.escalate = c.escalate.map(cleanEscalation).filter((x): x is Escalation => !!x).slice(0, 10);
  return step;
}

/** The quorum an approve step settles by (default «any»). */
export const quorumOf = (step: Pick<FormStep, "quorum">): Quorum => ((QUORUMS as readonly string[]).includes(step.quorum ?? "") ? step.quorum! : "any");

/** The settings of every form step by node id (the version's `steps` column). */
export function processSteps(graph: ProcessGraph): Record<string, FormStep> {
  const out: Record<string, FormStep> = {};
  for (const n of graph.nodes) if (n.type === "form_step") out[n.id] = formStepOf(n.config);
  return out;
}

/** A case of «انتخاب»: its port key, label and the comparisons that choose it (all or any of them). */
export interface ChoiceCase {
  key: string;
  label: string;
  rules: { left?: unknown; op?: unknown; right?: unknown }[];
  match?: "all" | "any";
}

export const CHOICE_KEY = /^[a-z][a-z0-9_]{0,29}$/;
export const MAX_CHOICE_CASES = 12;

/** The cases of a «انتخاب» node as stored (shape only; the validator checks keys and rules). */
export function choiceCases(config: unknown): ChoiceCase[] {
  const c = isObj(config) ? config : {};
  return (Array.isArray(c.cases) ? c.cases : [])
    .filter(isObj)
    .slice(0, MAX_CHOICE_CASES * 2)
    .map((x) => ({ key: String(x.key ?? ""), label: typeof x.label === "string" ? x.label.trim().slice(0, 80) : "", rules: Array.isArray(x.rules) ? x.rules.filter(isObj) : [], ...(x.match === "any" ? { match: "any" as const } : {}) }));
}

/** Outcomes of «پایان»: how the case ends. */
export const END_OUTCOMES = ["completed", "rejected", "canceled"] as const;
export type EndOutcome = (typeof END_OUTCOMES)[number];
export const endOutcomeOf = (config: unknown): EndOutcome => {
  const o = isObj(config) ? config.outcome : undefined;
  return (END_OUTCOMES as readonly string[]).includes(String(o)) ? (o as EndOutcome) : "completed";
};

// ---------------------------------------------------------------------------------------------------------------
// Structure

/** Outgoing edges of a node (on one port). */
export function outEdges(graph: Pick<FlowGraph, "edges">, node: string, port?: string): FlowEdge[] {
  return graph.edges.filter((e) => e.source === node && (port === undefined || (e.port ?? "out") === port));
}

/** Is the edge «بازگشت برای اصلاح» (from a form step's `returned` port)? */
export function isBackEdge(graph: Pick<ProcessGraph, "nodes">, e: FlowEdge): boolean {
  return (e.port ?? "out") === "returned" && graph.nodes.some((n) => n.id === e.source && n.type === "form_step");
}

/** Every edge but the «بازگشت» ones: the graph a case moves forward on (a DAG once valid). */
export function forwardEdges(graph: ProcessGraph): FlowEdge[] {
  return graph.edges.filter((e) => !isBackEdge(graph, e));
}

/** The trigger and the start step («ثبت درخواست») — null when the graph has none (or several). */
export function startOf(graph: ProcessGraph): { trigger: ProcessNode | null; start: ProcessNode | null } {
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  const starts = graph.nodes.filter((n) => n.type === "form_step" && (n.config as Record<string, unknown> | undefined)?.start === true);
  return { trigger: triggers.length === 1 ? triggers[0] : null, start: starts.length === 1 ? starts[0] : null };
}

/** Node ids in an order where every node comes after its forward predecessors (null: a cycle). */
export function topoOrder(graph: ProcessGraph, edges = forwardEdges(graph)): string[] | null {
  const indeg = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  for (const e of edges) if (indeg.has(e.source) && indeg.has(e.target)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = graph.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const e of edges) {
      if (e.source !== id || !indeg.has(e.target)) continue;
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  return out.length === graph.nodes.length ? out : null;
}

/** Nodes reachable from `from` (inclusive) over `edges`. */
export function reachable(edges: readonly FlowEdge[], from: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return seen;
}

export interface ProcessStructure {
  /** forward edges (no «بازگشت») */
  forward: FlowEdge[];
  /** topological order of the forward graph (null: it has a cycle) */
  order: string[] | null;
  /** nodes reachable from «آغاز» */
  reach: Set<string>;
  /** dominators: every node on every forward path from «آغاز» to a node (itself included) */
  dom: Map<string, Set<string>>;
  /** the parallel blocks a node stands in, outermost first (ids of their «موازی» nodes) */
  blocks: Map<string, string[]>;
  /** nodes reached from inside and outside a parallel block (or from two different blocks) */
  mixed: Set<string>;
  /** per «موازی»: the out-edge (branch) index each node inside it belongs to (several: branches meet before the join) */
  branches: Map<string, Map<string, Set<number>>>;
}

const sameStack = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The shape of a process graph: forward order, reach, dominators and parallel blocks. A «موازی» opens a block for its
 * branches and the «پیوستن» they meet at closes it; a node's block is the stack of «موازی» around it.
 */
export function structureOf(graph: ProcessGraph): ProcessStructure {
  const forward = forwardEdges(graph);
  const order = topoOrder(graph, forward);
  const { trigger } = startOf(graph);
  const reach = trigger ? reachable(forward, [trigger.id]) : new Set<string>();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>();
  // (an edge to or from a node that is not there — a draft being edited — is the validator's to report, not a predecessor)
  for (const e of forward) if (byId.has(e.source) && byId.has(e.target) && reach.has(e.source) && reach.has(e.target)) preds.set(e.target, [...(preds.get(e.target) ?? []), e.source]);
  const dom = new Map<string, Set<string>>();
  const blocks = new Map<string, string[]>();
  const mixed = new Set<string>();
  const branches = new Map<string, Map<string, Set<number>>>();
  if (!order || !trigger) return { forward, order, reach, dom, blocks, mixed, branches };
  for (const id of order) {
    if (!reach.has(id)) continue;
    const ps = preds.get(id) ?? [];
    // dominators: itself + what every predecessor's path has in common
    if (id === trigger.id || !ps.length) dom.set(id, new Set([id]));
    else {
      const [first, ...rest] = ps.map((p) => dom.get(p) ?? new Set<string>());
      const common = new Set<string>([...first].filter((x) => rest.every((d) => d.has(x))));
      common.add(id);
      dom.set(id, common);
    }
    // blocks: what each predecessor hands on (a «موازی» opens one, a «پیوستن» closes the innermost)
    let stack: string[] | null = id === trigger.id ? [] : null;
    for (const p of ps) {
      const pn = byId.get(p)!;
      const ps2 = blocks.get(p) ?? [];
      const handed = pn.type === "parallel" ? [...ps2, p] : pn.type === "join" ? ps2.slice(0, -1) : ps2;
      if (stack === null) stack = handed;
      else if (!sameStack(stack, handed)) mixed.add(id);
    }
    blocks.set(id, stack ?? []);
    // branch membership: a node directly after a «موازی» starts branch i; the rest inherit their predecessors'
    for (const p of ps) {
      const pn = byId.get(p)!;
      if (pn.type === "parallel") {
        const i = outEdges(graph, p, "out").findIndex((e) => e.target === id);
        const m = branches.get(p) ?? new Map<string, Set<number>>();
        m.set(id, new Set([...(m.get(id) ?? []), i]));
        branches.set(p, m);
      }
    }
    const own = blocks.get(id)!;
    for (const block of own) {
      const m = branches.get(block) ?? new Map<string, Set<number>>();
      const set = m.get(id) ?? new Set<number>();
      for (const p of ps) {
        if (p === block) continue;
        for (const i of m.get(p) ?? []) set.add(i);
      }
      if (set.size) m.set(id, set);
      branches.set(block, m);
    }
  }
  return { forward, order, reach, dom, blocks, mixed, branches };
}

/** Is `node` inside a parallel block? */
export const inParallel = (s: ProcessStructure, node: string): boolean => (s.blocks.get(node)?.length ?? 0) > 0;

/**
 * May a «بازگشت» of `from` go to `to`? Only to a form step that every path to `from` passes (an earlier step on the
 * same branch, «ثبت درخواست» included) and within the same parallel block — never across a «موازی» or «پیوستن».
 */
export function returnAllowed(graph: ProcessGraph, s: ProcessStructure, from: string, to: string): boolean {
  const target = graph.nodes.find((n) => n.id === to);
  if (!target || target.type !== "form_step" || from === to) return false;
  if (!s.dom.get(from)?.has(to)) return false;
  return sameStack(s.blocks.get(from) ?? [], s.blocks.get(to) ?? []);
}

/** Every step a «بازگشت» of `from` may go to, nearest first (the designer's choice; the first is the default). */
export function returnTargets(graph: ProcessGraph, from: string, s = structureOf(graph)): string[] {
  const order = s.order ?? [];
  return order.filter((id) => returnAllowed(graph, s, from, id)).reverse();
}

/** The default target of a step's «بازگشت»: the nearest earlier form step it may go to. */
export const defaultReturnTarget = (graph: ProcessGraph, from: string): string | null => returnTargets(graph, from)[0] ?? null;

/** Steps a new run may start at («ادامه از مرحلهٔ …», §3.6.6): form steps outside parallel blocks, in order. */
export function restartTargets(graph: ProcessGraph, s = structureOf(graph)): string[] {
  return (s.order ?? []).filter((id) => s.reach.has(id) && !inParallel(s, id) && !s.mixed.has(id) && graph.nodes.find((n) => n.id === id)?.type === "form_step");
}

// ---------------------------------------------------------------------------------------------------------------
// A case's progress (kept by the authority in `process_case.progress`, read by the diagram)

export type StepProgressStatus = "active" | "done" | "skipped" | "canceled";

export interface StepProgress {
  status: StepProgressStatus;
  /** the decision that settled a form step (done); a «پایان»: the case's outcome */
  outcome?: StepOutcome | EndOutcome | null;
  /** the port the node left by (done): the diagram follows only that path; a form step's follows from its outcome */
  port?: string | null;
  round: number;
  /** when it opened or settled (ISO instant) */
  at?: string | null;
  /** names of whoever acted (done) */
  actors?: string[];
  /** people the step waits for (active) */
  waiting?: number;
}

/**
 * Per node id: what happened at the node most recently. The authority records every node the run passed — form steps
 * as they open and settle, the other nodes from the run's step log (with the port a «شرط» or «انتخاب» took), the
 * «پایان» reached with the case's outcome — and drops the entries downstream of a step a «بازگشت» reopens (they run
 * again). Nodes without an entry are still to come or were passed by.
 */
export type CaseProgress = Record<string, StepProgress>;

/** The port a recorded node left by: its own record, else its decision's port. */
export function progressPort(p: StepProgress): string | null {
  if (p.port) return p.port;
  return p.outcome && p.outcome in OUTCOME_PORT ? OUTCOME_PORT[p.outcome as StepOutcome] : null;
}

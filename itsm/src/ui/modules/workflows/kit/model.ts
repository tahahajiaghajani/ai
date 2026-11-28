// The workflows kit's pure logic (design F §8.4, §8.6, package F5k): no React, unit-tested in
// tests/workflows-kit-ui.test.ts.
//   · the process canvas: node size, the dagre layout (top to bottom; «بازگشت» edges take no part in the ranks), the
//     edges a designer may draw under the process rules (one edge per port unless it fans out, nothing into «آغاز», a
//     «بازگشت برای اصلاح» only back to a step it may return to, no other cycle), adding, removing and updating steps,
//     the keyboard's moves between nodes (the nearest node in the arrow's direction), the one-line summary of a node,
//     the path a case took and the phone's numbered list;
//   · the step statuses of a case's diagram: a word, a tone and an icon name each — never colour alone (§8.6);
//   · the rights matrix: its rows (form items with their chips) and the changes it makes to a step's rights;
//   · the role-then-people picker: new rules by kind, a position's scope («کجا») that follows the position until the
//     person chooses one, who of the holders a scope reaches, the holders by unit, its members filter, and the
//     estimate it asks for (only the debounced rules, complete) with the demo pack's people counted apart;
//   · the files input (./files.ts): the ids a «پیوست» value holds, the `accept` attribute, why a file is refused.
// Imported by UI code only; keep it free of server imports.
import dagre from "@dagrejs/dagre";
import type { FlowEdge, FlowProblem } from "@shared/flows";
import { DURATION_UNITS } from "@shared/flows/nodes";
import {
  ASSIGNEE_KIND_LABELS,
  CASE_ROOT,
  IF_NOBODY,
  IF_NOBODY_LABELS,
  PROCESS_NODE_TYPES,
  STEP_ACTION_LABELS,
  choiceCases,
  endOutcomeOf,
  forwardEdges,
  formStepOf,
  isProcessNodeType,
  outEdges,
  processNodeLabel,
  processPorts,
  progressPort,
  quorumOf,
  returnTargets,
  structureOf,
  type AssigneeKind,
  type AssigneeRule,
  type IfNobody,
  type PositionWhere,
  type CaseProgress,
  type NodeStatus,
  type NodeStatusView,
  type ProcessGraph,
  type ProcessNode,
  type ProcessNodeType,
  type ProcessPort,
  type StepAction,
  type StepAssignees,
  type Quorum,
} from "@shared/process";
import { CASE_OUTCOMES, TASK_OUTCOMES } from "@shared/tables/process";
import { DEFAULT_STEP_RIGHTS, effectiveRights, fieldGetter, fieldItems, isFieldItem, isRight, type FieldSource, type FormLayoutV2, type Right, type StepRights } from "@shared/forms/layout";
import { FIELD_GROUPS, type FieldDef, type FieldGroup } from "@shared/model/types";
import { faDigits } from "@shared/format";
import type { EstimateResult, MemberRow } from "./api";

// ---------------------------------------------------------------------------------------------------------------
// The canvas: size and layout

export const NODE_W = 240;
export const NODE_H = 84;

/** Lay the process out top to bottom with dagre (forward edges only: «بازگشت» edges would turn the ranks over). */
export function layoutProcess(g: ProcessGraph): ProcessGraph {
  const d = new dagre.graphlib.Graph();
  d.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 48, marginx: 24, marginy: 24 });
  d.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const n of g.nodes) d.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of forwardEdges(g)) if (ids.has(e.source) && ids.has(e.target)) d.setEdge(e.source, e.target);
  dagre.layout(d);
  return {
    ...g,
    layout: { ...(g.layout ?? {}), direction: "TB" },
    nodes: g.nodes.map((n) => {
      const p = d.node(n.id) as { x: number; y: number } | undefined;
      return p ? { ...n, position: { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) } } : n;
    }),
  };
}

/** Does every node have a position (otherwise the canvas lays the graph out before it draws it)? */
export const isPlaced = (g: ProcessGraph): boolean => g.nodes.every((n) => !!n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y));

// ---------------------------------------------------------------------------------------------------------------
// Edges the designer may draw

const nodeOf = (g: ProcessGraph, id: string) => g.nodes.find((n) => n.id === id);
const portOf = (n: ProcessNode, key: string): ProcessPort | undefined => processPorts(n).find((p) => p.key === key);

/** Why `source.port → target` may not be drawn (Persian), or null when it may. */
export function connectProblem(g: ProcessGraph, source: string, port: string, target: string): string | null {
  if (source === target) return "مرحله‌ای به خودش وصل نمی‌شود";
  const s = nodeOf(g, source);
  const t = nodeOf(g, target);
  if (!s || !t) return "مرحله پیدا نشد";
  if (t.type === "trigger") return "به «آغاز» نمی‌توان وصل شد";
  const p = portOf(s, port);
  if (!p) return "این خروجی وجود ندارد";
  if (g.edges.some((e) => e.source === source && (e.port ?? "out") === port && e.target === target)) return "این اتصال هست";
  if (!p.multi && outEdges(g, source, port).length) return `از خروجی «${p.label}» فقط یک اتصال می‌رود`;
  if (p.back) {
    if (t.type !== "form_step") return "«بازگشت برای اصلاح» فقط به یک مرحلهٔ فرم می‌رود";
    return returnTargets(g, source).includes(target) ? null : "«بازگشت برای اصلاح» فقط به مرحله‌ای پیش از همین مرحله و در همان شاخه می‌رود";
  }
  // any other edge goes forward: the target must not already lead to the source
  const fwd = forwardEdges(g);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return "این اتصال دور می‌سازد؛ برای برگرداندن پرونده از خروجی «بازگشت برای اصلاح» استفاده کنید";
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of fwd) if (e.source === id) stack.push(e.target);
  }
  return null;
}

/** The nodes `source.port` may be connected to now (the keyboard's connect mode offers them). */
export function connectTargets(g: ProcessGraph, source: string, port: string): string[] {
  // a used single port is re-pointed: judge the targets as if its edge were gone
  const s = nodeOf(g, source);
  const p = s ? portOf(s, port) : undefined;
  const base = p && !p.multi ? { ...g, edges: g.edges.filter((e) => !(e.source === source && (e.port ?? "out") === port)) } : g;
  return g.nodes.filter((n) => connectProblem(base, source, port, n.id) === null).map((n) => n.id);
}

export const edgeId = (source: string, port: string, target: string) => `${source}.${port}.${target}`;

/** Connect `source.port → target`; a single port that already has an edge is re-pointed. */
export function connect(g: ProcessGraph, source: string, port: string, target: string): ProcessGraph {
  const s = nodeOf(g, source);
  const p = s ? portOf(s, port) : undefined;
  const kept = p && !p.multi ? g.edges.filter((e) => !(e.source === source && (e.port ?? "out") === port)) : g.edges;
  const edge: FlowEdge = { id: edgeId(source, port, target), source, target, ...(port !== "out" ? { port } : {}) };
  return { ...g, edges: [...kept, edge] };
}

/** Remove the edges of one port of a node. */
export function disconnect(g: ProcessGraph, source: string, port: string): ProcessGraph {
  return { ...g, edges: g.edges.filter((e) => !(e.source === source && (e.port ?? "out") === port)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Adding, removing and changing steps

/** A short id for a new node of `type`, unique in the graph («formStep3»). */
export function newNodeId(g: ProcessGraph, type: ProcessNodeType): string {
  const base = type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  for (let i = 1; ; i++) {
    const id = `${base}${i}`;
    if (!g.nodes.some((n) => n.id === id)) return id;
  }
}

/**
 * The rights a new step of an action starts with: a «تکمیل فرم» step's fields are for filling («ویرایش»; required where
 * the form requires them), a review's and an approval's for reading (release 1.1.5: a new fill step read everything and
 * had nothing to fill).
 */
export function defaultStepRights(action: StepAction): StepRights {
  return { default: action === "fill" ? "edit" : DEFAULT_STEP_RIGHTS.default, fields: {} };
}

/** The settings a new node starts with (a form step: «تکمیل فرم», its fields to fill, no people yet). */
export function defaultProcessConfig(type: ProcessNodeType): Record<string, unknown> {
  switch (type) {
    case "form_step":
      return { action: "fill", form: null, rights: defaultStepRights("fill"), assignees: [] };
    case "branch":
      return { mode: "data", rules: [], match: "all" };
    case "choice":
      return { cases: [] };
    case "join":
      return { mode: "all" };
    case "wait_duration":
      return { mode: "duration", duration: { amount: 1, unit: "day" }, business: true };
    case "set_values":
      return { values: {} };
    case "end":
      return { outcome: "completed" };
    default:
      return {};
  }
}

/** The first port of `node` that may take another edge, or null. */
export function freePort(g: ProcessGraph, node: ProcessNode): string | null {
  for (const p of processPorts(node)) {
    if (p.back || p.optional) continue;
    if (p.multi || !outEdges(g, node.id, p.key).length) return p.key;
  }
  return null;
}

/** Add a step; with `after`, below it and connected from its first free port. */
export function addStep(
  g: ProcessGraph,
  type: ProcessNodeType,
  opts: { after?: string | null; position?: { x: number; y: number }; config?: Record<string, unknown>; label?: string } = {},
): { graph: ProcessGraph; id: string } {
  const id = newNodeId(g, type);
  const after = opts.after ? nodeOf(g, opts.after) : undefined;
  const base = after?.position ?? { x: 0, y: g.nodes.length * (NODE_H + 40) };
  const siblings = after ? outEdges(g, after.id).length : 0;
  const position = opts.position ?? (after ? { x: base.x + siblings * (NODE_W + 40), y: base.y + NODE_H + 56 } : base);
  const node: ProcessNode = { id, type, config: opts.config ?? defaultProcessConfig(type), position, ...(opts.label ? { label: opts.label } : {}) };
  let graph: ProcessGraph = { ...g, nodes: [...g.nodes, node] };
  const port = after ? freePort(g, after) : null;
  if (after && port) graph = connect(graph, after.id, port, id);
  return { graph, id };
}

/** Remove steps (never «آغاز») with their edges. */
export function removeSteps(g: ProcessGraph, ids: readonly string[]): ProcessGraph {
  const drop = new Set(ids.filter((id) => nodeOf(g, id)?.type !== "trigger"));
  if (!drop.size) return g;
  return { ...g, nodes: g.nodes.filter((n) => !drop.has(n.id)), edges: g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)) };
}

export function updateStep(g: ProcessGraph, id: string, patch: Partial<Pick<ProcessNode, "label" | "config" | "position">>): ProcessGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Palette groups of §8.4, in order: steps, paths, the rest («آغاز» is never added). */
export const PALETTE: { group: string; types: ProcessNodeType[] }[] = [
  { group: "مرحله‌ها", types: ["form_step"] },
  { group: "مسیر", types: ["branch", "choice", "parallel", "join"] },
  { group: "دیگر", types: ["wait_duration", "notify", "subflow", "set_values", "end"] },
];

// ---------------------------------------------------------------------------------------------------------------
// Keyboard: the nearest node in an arrow's direction

export type ArrowDir = "up" | "down" | "left" | "right";
export const ARROWS: Record<string, ArrowDir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/**
 * The node a key press moves to from `from`: the nearest centre within 60° of the arrow's direction (screen
 * directions: «راست» is to the right whatever the language); null when there is none.
 */
export function neighbour(nodes: readonly Pick<ProcessNode, "id" | "position">[], from: string, dir: ArrowDir): string | null {
  const c = (n: Pick<ProcessNode, "position">) => ({ x: (n.position?.x ?? 0) + NODE_W / 2, y: (n.position?.y ?? 0) + NODE_H / 2 });
  const me = nodes.find((n) => n.id === from);
  if (!me) return null;
  const o = c(me);
  let best: { id: string; score: number } | null = null;
  for (const n of nodes) {
    if (n.id === from) continue;
    const p = c(n);
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const along = dir === "down" ? dy : dir === "up" ? -dy : dir === "right" ? dx : -dx;
    const across = dir === "down" || dir === "up" ? Math.abs(dx) : Math.abs(dy);
    if (along <= 0 || across > along * Math.tan(Math.PI / 3)) continue;
    // nearer along the arrow first; straying sideways costs twice as much
    const score = along + 2 * across;
    if (!best || score < best.score) best = { id: n.id, score };
  }
  return best?.id ?? null;
}

/** Nodes in reading order: the forward topological order (ties by position), the unreachable ones last. */
export function readingOrder(g: ProcessGraph): string[] {
  const s = structureOf(g);
  const pos = (id: string) => nodeOf(g, id)?.position ?? { x: 0, y: 0 };
  const order = s.order ?? [...g.nodes].sort((a, b) => pos(a.id).y - pos(b.id).y || pos(a.id).x - pos(b.id).x).map((n) => n.id);
  return [...order.filter((id) => s.reach.has(id) || !s.order), ...order.filter((id) => s.order && !s.reach.has(id))];
}

// ---------------------------------------------------------------------------------------------------------------
// What a node says

const unitLabel = (u: unknown) => DURATION_UNITS.find((x) => x.value === u)?.label ?? "";
const durationText = (d: unknown): string => {
  const x = (d ?? {}) as { amount?: unknown; unit?: unknown };
  return x.amount ? `${faDigits(String(x.amount))} ${unitLabel(x.unit)}` : "";
};

/** Who a form step goes to, in a few words: the first rule's kind, «+۲» for the others. */
export function assigneesText(rules: readonly AssigneeRule[]): string {
  if (!rules.length) return "انجام‌دهنده تعیین نشده";
  const first = ASSIGNEE_KIND_LABELS[rules[0].kind as AssigneeKind] ?? "";
  return rules.length > 1 ? `${first} و ${faDigits(rules.length - 1)} قاعدهٔ دیگر` : first;
}

const QUORUM_TEXT: Record<string, string> = { any: "یک نفر کافی است", all: "همه باید تأیید کنند", count: "چند نفر", percent: "درصدی از افراد", first: "نخستین پاسخ" };

/** One line under a node's title: what it does. */
export function nodeSummary(n: ProcessNode): string {
  const c = (n.config ?? {}) as Record<string, unknown>;
  switch (n.type) {
    case "trigger":
      return "پرونده با ثبت درخواست آغاز می‌شود";
    case "form_step": {
      const step = formStepOf(c);
      if (step.start) return "درخواست‌دهنده فرم را پر می‌کند";
      const who = assigneesText(step.assignees);
      return step.action === "approve" ? `${who} · ${QUORUM_TEXT[quorumOf(step)]}` : `${STEP_ACTION_LABELS[step.action as StepAction] ?? ""} · ${who}`;
    }
    case "branch":
      return `شرط روی مقدارهای پرونده · ${faDigits(Array.isArray(c.rules) ? c.rules.length : 0)} مقایسه`;
    case "choice":
      return `${faDigits(choiceCases(c).length)} حالت و «هیچ‌کدام»`;
    case "parallel":
      return "شاخه‌ها هم‌زمان پیش می‌روند";
    case "join":
      return c.mode === "any" ? "پس از نخستین شاخه" : "پس از همهٔ شاخه‌ها";
    case "wait_duration": {
      const d = durationText(c.duration);
      // the engine counts business time only when `business` is true (flows/nodes.ts); a missing key is calendar time
      return d ? `${d}${c.business === true ? " کاری" : ""}` : "مدت را تعیین کنید";
    }
    case "notify":
      return String(c.subject || "پیام بی‌عنوان");
    case "subflow":
      return c.flow ? "اجرای جریان خودکار" : "جریان خودکاری انتخاب نشده";
    case "set_values": {
      const v = c.values && typeof c.values === "object" ? Object.keys(c.values as object).length : 0;
      return v ? `${faDigits(v)} مقدار پرونده` : "مقداری تعیین نشده";
    }
    case "end":
      return `پایان پرونده: ${CASE_OUTCOMES.find((o) => o.value === endOutcomeOf(c))?.label ?? ""}`;
    default: {
      // a type of a newer version
      const t: string = n.type;
      return isProcessNodeType(t) ? PROCESS_NODE_TYPES[t].hint : "";
    }
  }
}

/** The title a node shows. */
export const nodeTitle = (n: ProcessNode): string => processNodeLabel(n);

/** Problems per node: errors and warnings counted, the first message of each kind kept. */
export function problemsByNode(problems: readonly FlowProblem[] | undefined): Map<string, { errors: number; warnings: number; first: string }> {
  const out = new Map<string, { errors: number; warnings: number; first: string }>();
  for (const p of problems ?? []) {
    if (!p.node) continue;
    const c = out.get(p.node) ?? { errors: 0, warnings: 0, first: "" };
    if (p.level === "error") {
      if (!c.errors) c.first = p.message;
      c.errors++;
    } else {
      if (!c.errors && !c.warnings) c.first = p.message;
      c.warnings++;
    }
    out.set(p.node, c);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// A case's diagram: statuses, the path taken, the phone's list

export type StatusTone = "done" | "active" | "waiting" | "mine" | "expected" | "skipped" | "future";

export interface StatusMeta {
  /** the word beside the icon («انجام‌شده»…) */
  label: string;
  tone: StatusTone;
  /** lucide icon name (./icons.tsx draws it) */
  icon: string;
}

/** Every status with its word, tone and icon: «نوبت شما» and «مراحل شما» never rely on colour (§8.6). */
export const STEP_STATUS: Record<NodeStatus, StatusMeta> = {
  done: { label: "انجام‌شده", tone: "done", icon: "circle-check" },
  active: { label: "در جریان", tone: "active", icon: "circle-dot" },
  // a step whose round waits with nobody to act (1.1.5): the case says «در انتظار», the step says whom it waits for
  unstaffed: { label: "منتظر انجام‌دهنده", tone: "waiting", icon: "hourglass" },
  mine_open: { label: "نوبت شما", tone: "mine", icon: "hand" },
  mine_done: { label: "انجام‌شده به دست شما", tone: "done", icon: "user-check" },
  mine_expected: { label: "مرحلهٔ آیندهٔ شما", tone: "expected", icon: "user-round-search" },
  skipped: { label: "نیاز نشد", tone: "skipped", icon: "circle-minus" },
  future: { label: "بعدی", tone: "future", icon: "circle-dashed" },
};

/** The legend's entries, in the order of §8.6 («انجام‌شده · در جریان · منتظر انجام‌دهنده · نوبت شما · مراحل شما · بعدی»). */
export const LEGEND_ORDER: NodeStatus[] = ["done", "active", "unstaffed", "mine_open", "mine_done", "mine_expected", "future", "skipped"];

/** The word of a decision or of how a case ended («تأیید شد»، «ردشده»…). */
export function outcomeLabel(outcome: string | null | undefined, nodeType?: string): string {
  if (!outcome) return "";
  if (nodeType === "end") return CASE_OUTCOMES.find((o) => o.value === outcome)?.label ?? "";
  return TASK_OUTCOMES.find((o) => o.value === outcome)?.label ?? CASE_OUTCOMES.find((o) => o.value === outcome)?.label ?? "";
}

/** The line a node shows for its status: the word, then the outcome or how many people it waits for. */
export function statusLine(v: NodeStatusView, nodeType?: string): string {
  const meta = STEP_STATUS[v.status];
  if (!meta) return "";
  const parts = [meta.label];
  if ((v.status === "done" || v.status === "mine_done") && v.outcome) parts.push(outcomeLabel(v.outcome, nodeType));
  if ((v.status === "active" || v.status === "mine_open") && v.waiting) parts.push(`${faDigits(v.waiting)} نفر`);
  if (v.round && v.round > 1) parts.push(`دور ${faDigits(v.round)}`);
  return parts.filter(Boolean).join(" · ");
}

/** The edges a case went along: from every node it passed, by the port it left (a form step's, by its decision). */
export function takenEdges(g: ProcessGraph, progress: CaseProgress | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!progress) return out;
  for (const e of g.edges) {
    const p = progress[e.source];
    if (!p || p.status !== "done") continue;
    const port = progressPort(p);
    const src = nodeOf(g, e.source);
    // a node with one way out (no decision recorded) went that way
    const ways = src ? processPorts(src).filter((x) => !x.optional) : [];
    if ((port ?? (ways.length === 1 ? ways[0].key : null)) === (e.port ?? "out") && progress[e.target]) out.add(e.id);
  }
  return out;
}

/** The steps of the phone's numbered list: every node in reading order but the structural ones («آغاز», «موازی», «پیوستن»). */
export function listSteps(g: ProcessGraph): ProcessNode[] {
  const order = readingOrder(g);
  return order.map((id) => nodeOf(g, id)!).filter((n) => !!n && n.type !== "trigger" && n.type !== "parallel" && n.type !== "join");
}

/** «مرحلهٔ ۲ از ۴»: the form steps of a case and the position of the first one still open (phone header). */
export function stepCounter(g: ProcessGraph, statuses: Record<string, NodeStatusView> | null | undefined): { at: number; of: number } {
  const steps = listSteps(g).filter((n) => n.type === "form_step" && statuses?.[n.id]?.status !== "skipped");
  const open = steps.findIndex((n) => ["active", "unstaffed", "mine_open"].includes(statuses?.[n.id]?.status ?? ""));
  const done = steps.filter((n) => ["done", "mine_done"].includes(statuses?.[n.id]?.status ?? "")).length;
  return { at: open >= 0 ? open + 1 : Math.min(done, steps.length), of: steps.length };
}

// ---------------------------------------------------------------------------------------------------------------
// The rights matrix

export interface RightsRow {
  field: string;
  label: string;
  /** the section the item sits in («زبانه › بخش») */
  section: string;
  /** the right the step names for the field, or null (the default applies) */
  stated: Right | null;
  /** what a person at the step gets (before their field groups) */
  effective: Right;
  /** rights that cannot be chosen here: editing a locked, read-only or system field */
  disabled: Right[];
  /** chips: the field group and why it is locked, the form's own flags */
  chips: { kind: "group" | "lock" | "form"; label: string }[];
}

const FORM_FLAG_LABEL = { hidden: "پنهان در فرم", readonly: "فقط‌خواندنی در فرم", required: "الزامی در فرم" } as const;

/** The rows of the rights matrix: the form's fields in layout order, each with what the step makes of it. */
export function rightsRows(form: FormLayoutV2, fields: FieldSource, value: StepRights | null | undefined, locked: Iterable<string> = []): RightsRow[] {
  const get = fieldGetter(fields);
  const step = value ?? DEFAULT_STEP_RIGHTS;
  const lockedSet = new Set(locked);
  const eff = effectiveRights(form, step, fields, { groups: "all" }, { locked: lockedSet });
  const rows: RightsRow[] = [];
  for (const tab of form.tabs) {
    for (const section of tab.sections) {
      const where = [tab.label, section.label].filter(Boolean).join(" › ");
      for (const item of section.items) {
        if (!isFieldItem(item)) continue;
        const f: FieldDef | undefined = get(item.field);
        const chips: RightsRow["chips"] = [];
        if (f?.group) chips.push({ kind: "group", label: `گروه: ${FIELD_GROUPS[f.group as FieldGroup] ?? f.group}` });
        const lockedHere = !f || lockedSet.has(item.field) || !!f.locked || !!f.readonly || !!f.system;
        if (!f) chips.push({ kind: "lock", label: "تعریف این فیلد پیدا نشد" });
        else if (lockedHere) chips.push({ kind: "lock", label: f.system ? "قفل: سامانه‌ای" : "قفل: فقط خواندنی" });
        for (const k of ["hidden", "readonly", "required"] as const) if (item[k]) chips.push({ kind: "form", label: FORM_FLAG_LABEL[k] });
        const named = step.fields?.[item.field];
        rows.push({
          field: item.field,
          label: item.label || f?.label || item.field,
          section: where,
          stated: isRight(named) ? named : null,
          effective: eff[item.field] ?? "hidden",
          disabled: lockedHere ? ["edit", "required"] : [],
          chips,
        });
      }
    }
  }
  return rows;
}

/** The step's rights with one field set (a right equal to what the default gives is still stated: explicit wins). */
export function setFieldRight(value: StepRights | null | undefined, field: string, right: Right): StepRights {
  const v = value ?? DEFAULT_STEP_RIGHTS;
  return { default: v.default, fields: { ...(v.fields ?? {}), [field]: right } };
}

/** The step's rights with a new default for the fields it does not name. */
export const setDefaultRight = (value: StepRights | null | undefined, right: Right): StepRights => ({ default: right, fields: { ...(value?.fields ?? {}) } });

/** «همه خواندنی»: every field readable, nothing stated. */
export const allRead = (): StepRights => ({ default: "read", fields: {} });

/** The field names a step's rights name that its form no longer has (kept out when the matrix saves). */
export function strayRights(form: FormLayoutV2, value: StepRights | null | undefined): string[] {
  const inForm = new Set(fieldItems(form).map((i) => i.field));
  return Object.keys(value?.fields ?? {}).filter((k) => !inForm.has(k));
}

// ---------------------------------------------------------------------------------------------------------------
// The role-then-people picker

/**
 * A new rule of a kind, with the settings it starts with. A position starts «همه‌جا» until one is picked (then its
 * scope follows the position: `pickPosition`) — never «واحد درخواست‌دهنده», which reads the requester's own profile
 * unit, rarely the unit where the position is held (release 1.1.5, the owner's «کسی پیدا نشد»).
 */
export function newRule(kind: AssigneeKind): AssigneeRule {
  switch (kind) {
    case "position":
      return { kind, position: "", where: "anywhere" };
    case "group":
      return { kind, group: "" };
    case "role":
      return { kind, role: "" };
    case "users":
      return { kind, users: [] };
    case "manager":
      return { kind, of: "requester" };
    case "unit_head":
      return { kind, of: "requester" };
    case "field":
      return { kind, field: "" };
    case "step_actor":
      return { kind, step: "" };
    default:
      return { kind: "requester" };
  }
}

/**
 * What a list of rules may hold where not every kind applies (a process's starters: rules that name people before any
 * case exists): the kinds offered, and for a position the scopes («کجا») offered. Absent: everything.
 */
export interface RuleScope {
  kinds?: readonly AssigneeKind[];
  wheres?: readonly PositionWhere[];
}

/** A new rule of a kind within a scope: a position starts at the first scope offered when its usual one is not. */
export function scopedRule(kind: AssigneeKind, scope: RuleScope = {}): AssigneeRule {
  const r = newRule(kind);
  if (r.kind === "position" && scope.wheres?.length && !scope.wheres.includes(r.where)) return { ...r, where: scope.wheres[0] };
  return r;
}

/** Does a rule stay within the scope (its kind, and a position's «کجا»)? */
export function ruleInScope(rule: AssigneeRule, scope: RuleScope = {}): boolean {
  if (scope.kinds && !scope.kinds.includes(rule.kind)) return false;
  if (rule.kind === "position" && scope.wheres && !scope.wheres.includes(rule.where)) return false;
  return true;
}

/** The rule with its members filter set: none (every holder), or only the ticked people. */
export function withMembers(rule: AssigneeRule, members: readonly string[] | null): AssigneeRule {
  if (rule.kind !== "position" && rule.kind !== "group" && rule.kind !== "role") return rule;
  const next = { ...rule } as AssigneeRule & { members?: string[] };
  if (members && members.length) next.members = [...new Set(members.map((m) => m.toLowerCase()))];
  else delete next.members;
  return next;
}

export type PositionRule = Extract<AssigneeRule, { kind: "position" }>;

/**
 * The scope («کجا») a position's rule starts with: anywhere for a position not tied to a kind of unit, otherwise its
 * holder up the requester's tree in a unit of its kind — as «نقش‌های سازمانی»'s preview starts (admin/positions'
 * `previewStep`).
 */
export function defaultScope(unitKind: string | null | undefined): Pick<PositionRule, "where" | "unitKind"> {
  return unitKind ? { where: "requester_unit_up", unitKind } : { where: "anywhere" };
}

/** Is the rule's scope the one a position of `unitKind` starts with (up the tree with no kind named is the same)? */
export function isDefaultScope(rule: Pick<PositionRule, "where" | "unitKind">, unitKind: string | null | undefined): boolean {
  if (!unitKind) return rule.where === "anywhere";
  return rule.where === "requester_unit_up" && (!rule.unitKind || rule.unitKind === unitKind);
}

/**
 * The rule once a position is picked. Its scope follows the position while the person has not chosen one: `chosen`
 * (they changed «کجا» or its unit, field or kind here) keeps it, and so does a scope that is not the one the previous
 * position starts with (`was`: that position, null while it is not known) — a saved rule's own. A rule that had no
 * position yet always follows unless chosen. A fixed unit goes (it was one of the previous position's units) and so does
 * the members filter (it named the previous position's holders); a form field and a chosen kind of unit stay. Where only
 * some scopes are offered (`wheres`: a process's starters), a default outside them is the first one offered.
 */
export function pickPosition(
  rule: PositionRule,
  picked: { key: string; unit_kind: string | null },
  o: { chosen: boolean; was: { unit_kind: string | null } | null; wheres?: readonly PositionWhere[] },
): PositionRule {
  const follow = !o.chosen && (!rule.position || (o.was !== null && isDefaultScope(rule, o.was.unit_kind)));
  if (follow) {
    const d = defaultScope(picked.unit_kind);
    if (o.wheres?.length && !o.wheres.includes(d.where)) return { kind: "position", position: picked.key, where: o.wheres[0] };
    return { kind: "position", position: picked.key, ...d };
  }
  return {
    kind: "position",
    position: picked.key,
    where: rule.where,
    ...(rule.where === "unit_field" && rule.unitField ? { unitField: rule.unitField } : {}),
    ...(rule.where === "requester_unit_up" && rule.unitKind ? { unitKind: rule.unitKind } : {}),
  };
}

/** A scope whose holder depends on each case: the requester's unit, up its tree, or the unit a form field names. */
export const isCaseScope = (where: PositionWhere): boolean => where === "requester_unit" || where === "requester_unit_up" || where === "unit_field";

/**
 * Who of a position's holders a scope that depends on each case gives the step to, in one line (the «افراد» list then
 * shows the holders by unit, none of them ticked as if all were included). Null for «همه‌جا» and «واحد مشخص».
 */
export function scopeNote(rule: Pick<PositionRule, "where" | "unitKind" | "unitField">, names: { kind?: (k: string) => string | null | undefined; field?: (f: string) => string | null | undefined } = {}): string | null {
  switch (rule.where) {
    case "requester_unit":
      return "فقط دارندهٔ واحد درخواست‌دهنده (واحدِ پروندهٔ کاربری او) کار را می‌گیرد.";
    case "requester_unit_up": {
      const kind = rule.unitKind ? (names.kind?.(rule.unitKind) ?? rule.unitKind) : null;
      return kind
        ? `فقط دارندهٔ نزدیک‌ترین «${kind}» در بالادستِ واحد درخواست‌دهنده (واحدِ پروندهٔ کاربری او) کار را می‌گیرد.`
        : "فقط دارندهٔ نزدیک‌ترین واحدِ دارای دارنده در بالادستِ واحد درخواست‌دهنده (واحدِ پروندهٔ کاربری او) کار را می‌گیرد.";
    }
    case "unit_field": {
      const field = rule.unitField ? (names.field?.(rule.unitField) ?? rule.unitField) : null;
      return field ? `فقط دارندهٔ واحدی که «${field}» در پرونده می‌گوید کار را می‌گیرد.` : "فقط دارندهٔ واحدی که فیلد فرم در پرونده می‌گوید کار را می‌گیرد.";
    }
    default:
      return null;
  }
}

/** The holders of one unit. */
export interface HolderGroup {
  unit: string | null;
  people: string[];
}

/** Holders valid on `today` by unit (each person once per unit), units by name, holders without a unit last. */
export function holderGroups(rows: readonly { user_id: string; org_unit_id: string | null; valid_from?: unknown; valid_to?: unknown }[], today: string, unitName: (id: string) => string): HolderGroup[] {
  const by = new Map<string, HolderGroup>();
  for (const h of rows) {
    if (!validHolder(h, today)) continue;
    const unit = h.org_unit_id ? h.org_unit_id.toLowerCase() : null;
    const k = unit ?? "";
    const g = by.get(k) ?? { unit, people: [] };
    const who = h.user_id.toLowerCase();
    if (!g.people.includes(who)) g.people.push(who);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => (a.unit === null ? 1 : b.unit === null ? -1 : unitName(a.unit).localeCompare(unitName(b.unit), "fa")));
}

/**
 * «اگر کسی پیدا نشد»'s choices. On an approval «از این مرحله بگذرد» leaves by «تأیید شد» (the engine counts it as
 * approved), so the choice says so there.
 */
export function ifNobodyOptions(action: StepAction): { value: IfNobody; label: string }[] {
  return IF_NOBODY.map((k) => ({ value: k, label: k === "skip" && action === "approve" ? "از این مرحله بگذرد («تأیید شد» به حساب می‌آید)" : IF_NOBODY_LABELS[k] }));
}

/** Is a rule complete enough to be estimated (otherwise the server would only say what is missing)? */
export function ruleComplete(r: AssigneeRule): boolean {
  switch (r.kind) {
    case "position":
      return !!r.position && (r.where !== "unit" || !!r.unit) && (r.where !== "unit_field" || !!r.unitField);
    case "group":
      return !!r.group;
    case "role":
      return !!r.role;
    case "users":
      return r.users.length > 0;
    case "field":
      return !!r.field;
    case "step_actor":
      return !!r.step;
    case "unit_head":
      return r.of !== "unit_field" || !!r.unitField;
    default:
      return true;
  }
}

/** What the static estimate is asked for a step. */
export interface EstimateInput {
  step: StepAssignees;
  action: StepAction;
  quorum: Quorum | null;
}

/** The estimate's body (JSON: the picker debounces it). */
export const estimateBody = (step: StepAssignees, action: StepAction, quorum?: Quorum | null): string => JSON.stringify({ step, action, quorum: quorum ?? null });

/**
 * The estimate a debounced body asks for, and whether it may be asked: readiness is read from the very body that is
 * sent, never from the rules on the screen — a position picked a moment ago must not send the body before it, whose
 * position was still empty (release 1.1.5: a 400 «نقش سازمانی را انتخاب کنید» and a console error).
 */
export function estimateRequest(body: string): { input: EstimateInput | null; ready: boolean } {
  let input: EstimateInput | null = null;
  try {
    input = JSON.parse(body) as EstimateInput;
  } catch {
    return { input: null, ready: false };
  }
  const rules = Array.isArray(input?.step?.assignees) ? input.step.assignees : [];
  return { input, ready: rules.length > 0 && rules.every(ruleComplete) };
}

/** The estimate in lines: each rule's with how many of its people are the demo pack's, the real and demo count, warnings. */
export interface EstimateView {
  rules: { index: number; line: string; demo: string | null }[];
  /** «۰ نفر واقعی و ۲ نفر نمایشی» — only when the pack's people are among them */
  total: string | null;
  warnings: string[];
}

export function estimateView(r: Pick<EstimateResult, "rules" | "total" | "warnings"> & { demo?: number }): EstimateView {
  const rules = r.rules.map((x) => {
    const d = x.demo ?? 0;
    return { index: x.index, line: x.line, demo: d > 0 ? (x.estimate !== null && d >= x.estimate ? "همه نمایشی" : `${faDigits(d)} نفر نمایشی`) : null };
  });
  const demo = r.demo ?? 0;
  const total = demo > 0 ? (r.total !== null ? `${faDigits(Math.max(0, r.total - demo))} نفر واقعی و ${faDigits(demo)} نفر نمایشی` : `${faDigits(demo)} نفر از آن‌ها نمایشی`) : null;
  return { rules, total, warnings: r.warnings };
}

/** A member as a people picker offers them. */
export interface MemberOption {
  value: string;
  label: string;
  /** e-mail and title */
  sub: string | null;
  /** one of the demo pack's people («نمایشی») */
  demo: boolean;
  inactive: boolean;
  me: boolean;
}

export interface MemberOptionGroup {
  /** null: no heading */
  label: string | null;
  options: MemberOption[];
}

/**
 * What a people picker offers (kit/MemberSelect): the members found, the current value always (by the names known),
 * the demo pack's people marked (by `demo`, or by the member search's own mark on a row) — left out with `mode:
 * "hide"` (a real case's step: they never take the organisation's own work, FINAL-1; a current value stays so it can be
 * taken off), or listed first under «حساب‌های نمایشی» with `mode: "first"` while nothing is searched (a sample
 * requester while a pack is loaded). «من» first among the members with `meFirst` while nothing is searched.
 */
export function memberOptions(o: {
  rows: readonly MemberRow[];
  pack?: readonly MemberRow[];
  known?: readonly MemberRow[];
  value: readonly string[];
  display?: Record<string, string>;
  demo: ReadonlySet<string>;
  mode: "hide" | "first" | "mark";
  me?: string | null;
  meFirst?: boolean;
  searching: boolean;
}): MemberOptionGroup[] {
  const me = o.me ? o.me.toLowerCase() : null;
  // the pack's people: the demo-people list (designers, the positions page) or the search's own mark (a case's managers)
  const opt = (r: MemberRow): MemberOption => ({
    value: r.id.toLowerCase(),
    label: r.name,
    sub: [r.email, r.title].filter(Boolean).join("، ") || null,
    demo: o.demo.has(r.id.toLowerCase()) || r.demo === true,
    inactive: !r.active,
    me: r.id.toLowerCase() === me,
  });
  const value = o.value.map((v) => v.toLowerCase());
  const seen = new Set<string>();
  const once = (list: MemberOption[]) => list.filter((x) => (seen.has(x.value) ? false : (seen.add(x.value), true)));
  const known = new Map([...(o.known ?? []), ...(o.pack ?? []), ...o.rows].map((r) => [r.id.toLowerCase(), r]));
  // the current value first, by its row or the name the caller knows
  const current = value.map((id) => (known.has(id) ? opt(known.get(id)!) : { value: id, label: o.display?.[id] ?? "…", sub: null, demo: o.demo.has(id), inactive: false, me: id === me }));
  const keep = (x: MemberOption) => o.mode !== "hide" || !x.demo || value.includes(x.value);
  let members = o.rows.map(opt).filter(keep);
  if (o.meFirst && me && !o.searching) {
    const i = members.findIndex((x) => x.value === me);
    if (i > 0) members = [members[i], ...members.slice(0, i), ...members.slice(i + 1)];
  }
  if (o.mode === "first" && !o.searching && o.pack?.length) {
    const pack = once([...current.filter((x) => x.demo), ...o.pack.map(opt)]);
    const rest = once([...current, ...members]);
    return [
      ...(pack.length ? [{ label: "حساب‌های نمایشی", options: pack }] : []),
      ...(rest.length ? [{ label: "اعضا", options: rest }] : []),
    ];
  }
  return [{ label: null, options: once([...current.filter(keep), ...members]) }];
}

/**
 * What «پیش‌نمایش» says of a step's people for the sample requester: a warning when nobody is found (with what the
 * step then does: waits for the process managers, passes — on an approval as «تأیید شد» —, or goes to them) or too
 * many; null when people are found. The resolver's notes (why nobody: «مدیر گروه» در «…» دارنده‌ای ندارد, the demo
 * pack's people left out of a real case…) are shown under it.
 */
export function previewVerdict(r: { status: string; message?: string | null }, step: { action: StepAction; ifNobody?: string | null }): { tone: "warning" | "danger"; text: string } | null {
  if (r.status === "too_many") return { tone: "warning", text: r.message ?? "بیش از اندازه نفر پیدا می‌شود؛ مسئولان گردش‌کار انتخاب می‌کنند." };
  if (r.status === "managers") return { tone: "warning", text: "کسی پیدا نمی‌شود؛ مرحله به مسئولان گردش‌کار می‌رسد." };
  if (r.status !== "nobody") return null;
  const then =
    step.ifNobody === "skip"
      ? step.action === "approve"
        ? "از این مرحله می‌گذرد و «تأیید شد» به حساب می‌آید"
        : "از این مرحله می‌گذرد"
      : "پرونده منتظر می‌ماند تا مسئولان گردش‌کار کسی را برگزینند";
  return { tone: "danger", text: `با این درخواست‌دهنده برای این مرحله کسی پیدا نمی‌شود؛ ${then}.` };
}

/** The people of a step a preview found («پیش‌نمایش»): each line with whether its person is one of the demo pack's. */
export function previewLines(r: { people: readonly { user: string }[]; lines: readonly string[]; display?: { demo?: string[] } }): { line: string; demo: boolean }[] {
  const demo = new Set((r.display?.demo ?? []).map((x) => x.toLowerCase()));
  return r.lines.map((line, i) => ({ line, demo: !!r.people[i] && demo.has(r.people[i].user.toLowerCase()) }));
}

/** Holders valid on `today` (YYYY-MM-DD): from and to are inclusive, empty means open. */
export function validHolder(h: { valid_from?: unknown; valid_to?: unknown }, today: string): boolean {
  const from = typeof h.valid_from === "string" ? h.valid_from.slice(0, 10) : "";
  const to = typeof h.valid_to === "string" ? h.valid_to.slice(0, 10) : "";
  return (!from || from <= today) && (!to || to >= today);
}

/** Fields of a form a rule may read: people (`field`), units (`unit_field`). */
export function ruleFields<T extends { name: string; type: string; ref?: string | null }>(fields: readonly T[], want: "people" | "unit"): T[] {
  return fields.filter((f) => (want === "people" ? f.type === "user" || f.type === "users" || f.type === "group" : f.type === "ref" && f.ref === "org_unit"));
}

/** The case root a «شرط» reads values from, for the designer's help lines. */
export const CASE_PILL = `{{${CASE_ROOT}.…}}`;

// ---------------------------------------------------------------------------------------------------------------
// The files input («پیوست»): ./files.ts (light: the record forms load it without the canvas)

export * from "./files";

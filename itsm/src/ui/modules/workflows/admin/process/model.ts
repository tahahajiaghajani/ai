// The process designer's pure logic (design F §3.5, §8.4, package F6): no React, no requests — tested in
// tests/workflows-designer-ui.test.ts.
//   · who opens the designer and what it offers (edit, publish, retire, restore, «پیش‌نمایش»);
//   · the designer's draft (the process's name, category, description and its `ProcessDraft`), cleaned as F4c keeps it,
//     and what the autosave sends (nothing when only key order or spaces differ);
//   · the palette (مرحلهٔ فرم، بررسی، تأیید · شرط، انتخاب، موازی، پیوستن · انتظار، اعلان، جریان خودکار، تعیین مقدار،
//     پایان) and adding a step after another — appended, or put between it and the step it led to — or on one way out;
//   · each way out of a step («مسیرها»): where it leads and where it may lead; removing a step reconnects its one way in
//     to its one way on; changing a step's action keeps its paths («بعدی» ↔ «تأیید شد»);
//   · the fields of the process's forms (the case's values) for conditions, titles, «درخواست‌دهنده چه می‌بیند» and the
//     people rules; the title's sample; the notices a step sends; escalations; the problems on the canvas and in the
//     drawer, kept current between autosaves; «نسخه‌ها»; «پیش‌نمایش»'s notes per step.
// Imported by UI code only; keep it free of server imports.
import type { FlowProblem } from "@shared/flows/types";
import { cleanGraph } from "@shared/flows/validate";
import { DURATION_UNITS } from "@shared/flows/nodes";
import type { FieldDef, Option } from "@shared/model/types";
import { fieldItems, type FormLayoutV2 } from "@shared/forms/layout";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { CASE_OUTCOMES, TASK_OUTCOMES } from "@shared/tables/process";
import {
  CASE_ROOT, MAX_RULES, PROCESS_NODE_TYPES, TITLE_MAX, assigneeProblems, cleanRule, choiceCases, cleanStepAssignees, endOutcomeOf, formStepOf, ifNobodyOf, isBackEdge, outEdges,
  processPorts, renderTitle, startOf, stepOutcomes, structureOf,
  type AssigneeRule, type ChoiceCase, type Duration, type Escalation, type ProcessGraph, type ProcessNode, type ProcessNodeType, type ProcessPort, type StepAction,
  type StepAssignees, type StepOutcome,
} from "@shared/process";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { SEP } from "../../../../lib/fa";
import type { ChipTone } from "../../../../components/display";
import { ESTIMATE_GATES } from "../../kit/api";
import {
  NODE_H, NODE_W, connect, connectProblem, connectTargets, defaultProcessConfig, disconnect, edgeId, isPlaced, layoutProcess, newNodeId, nodeTitle, readingOrder, removeSteps,
  ruleInScope, type RuleScope,
} from "../../kit/model";
import type { AccessProbe } from "../fields/model";
import type { DraftInput, ProcessDetail, ProcessDraft, ProcessOut, ResolveBody, ResolveResult, VersionRow } from "./api";

const fa = (n: number) => faDigits(n);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------
// Addresses, access and what the page offers

export const DESIGNER_PATH = "settings/workflows/p/:id";

export interface DesignerAccess {
  /** the page opens: `process_design` read (F4c's GET /process/defs/:id) */
  read: boolean;
  /** «پیش‌نمایش»: F3's resolve — `process_design` write, or `org` write in a unit or wider */
  preview: boolean;
}

export function designerAccess(p: Pick<AccessProbe, "allows">): DesignerAccess {
  return { read: p.allows({ area: PROCESS_DESIGN_AREA }), preview: ESTIMATE_GATES.some((g) => p.allows(g)) };
}

export interface DesignerOffers {
  /** palette, canvas edits, inspector, settings, «فرم تازه»: `process_design` write in a writable organisation, not on phones */
  edit: boolean;
  /** «انتشار»: approve, on the authority (not a Windows app linked to the web version) */
  publish: boolean;
  /** «بازنشسته‌کردن»: as publish, while the process is published */
  retire: boolean;
  /** «بازگرداندن به پیش‌نویس»: write */
  restore: boolean;
  preview: boolean;
}

export function designerOffers(d: Pick<ProcessDetail, "can" | "process">, o: { writable: boolean; phone: boolean; authority: boolean; preview: boolean }): DesignerOffers {
  const edit = d.can.write && o.writable && !o.phone;
  const approve = d.can.publish && o.writable && !o.phone && o.authority;
  return { edit, publish: approve, retire: approve && d.process.status === "published", restore: edit, preview: o.preview && !o.phone };
}

/** The toolbar's line: «پیش‌نویس», «منتشرشده، نسخهٔ ۲», «بازنشسته». */
export function statusChip(p: Pick<ProcessOut, "status" | "version_no">): { label: string; tone: ChipTone } {
  if (p.status === "published") return { label: `منتشرشده، نسخهٔ ${fa(p.version_no ?? 0)}`, tone: "in" };
  if (p.status === "retired") return { label: `بازنشسته، نسخهٔ ${fa(p.version_no ?? 0)}`, tone: "neutral" };
  return { label: "پیش‌نویس", tone: "neutral" };
}

// ---------------------------------------------------------------------------------------------------------------
// The draft and the autosave

/** What the designer edits: the process's own words and its draft (undo and redo step through it). */
export interface DesignerDraft {
  name: string;
  category: string;
  description: string;
  draft: ProcessDraft;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const idList = (v: unknown, max: number): string[] =>
  [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))].slice(0, max);

/** A draft as F4c keeps it (its `cleanDraft`): unknown keys dropped, lists bounded, the graph cleaned. */
export function cleanDraft(raw: unknown): ProcessDraft {
  const o = isObj(raw) ? raw : {};
  const graph = cleanGraph(isObj(o.graph) ? o.graph : { nodes: [], edges: [] }) as unknown as ProcessGraph;
  const title = typeof o.title_template === "string" ? o.title_template.trim().slice(0, TITLE_MAX) : "";
  return {
    graph,
    starters: (Array.isArray(o.starters) ? o.starters : []).map(cleanRule).filter((r): r is AssigneeRule => !!r).slice(0, MAX_RULES),
    title_template: title || null,
    requester_view: [...new Set((Array.isArray(o.requester_view) ? o.requester_view : []).filter((x): x is string => typeof x === "string" && FIELD_NAME.test(x)))].slice(0, 200),
    managers: idList(o.managers, 100),
    manager_groups: idList(o.manager_groups, 50),
    confidential: o.confidential === true,
  };
}

/** JSON with object keys sorted: two values that differ only in key order read the same. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)) ?? "null";
}

/** A new process's graph (F4c's): «آغاز» and «ثبت درخواست» by the requester, joined. */
export function defaultGraph(): ProcessGraph {
  return {
    nodes: [
      { id: "start", type: "trigger", config: {} },
      { id: "request", type: "form_step", label: "ثبت درخواست", config: { action: "fill", start: true, form: null, rights: { default: "edit", fields: {} }, assignees: [{ kind: "requester" }] } },
    ],
    edges: [{ id: "start.out.request", source: "start", target: "request" }],
  };
}

/** The draft the designer starts from: an empty graph (a process made elsewhere) gets «آغاز» and «ثبت درخواست». */
export const startingDraft = (d: ProcessDraft): ProcessDraft => (d.graph.nodes.length ? d : { ...d, graph: defaultGraph() });

export function designerDraft(d: Pick<ProcessDetail, "process" | "draft">): DesignerDraft {
  return { name: d.process.name, category: d.process.category ?? "", description: d.process.description ?? "", draft: startingDraft(cleanDraft(d.draft)) };
}

/**
 * What the autosave sends (null: nothing changed since `saved`): always the whole draft and the version it was edited
 * from (a concurrent save is refused); the name, category and description only when they changed. An empty name is
 * never sent (the settings ask for one).
 */
export function savePatch(saved: Pick<ProcessDetail, "process" | "draft">, d: DesignerDraft): DraftInput | null {
  const draft = cleanDraft(d.draft);
  const out: DraftInput = { draft, version: saved.process.version };
  let changed = stableJson(draft) !== stableJson(cleanDraft(saved.draft));
  const name = d.name.trim().slice(0, 120);
  if (name && name !== saved.process.name) {
    out.name = name;
    changed = true;
  }
  const category = d.category.trim().slice(0, 80) || null;
  if (category !== (saved.process.category?.trim() || null)) {
    out.category = category;
    changed = true;
  }
  const description = d.description.trim().slice(0, 2000) || null;
  if (description !== (saved.process.description?.trim() || null)) {
    out.description = description;
    changed = true;
  }
  return changed ? out : null;
}

/** The name the settings ask for. */
export const nameProblem = (name: string): string => (name.trim() ? "" : "نام گردش‌کار را بنویسید");

// ---------------------------------------------------------------------------------------------------------------
// The palette

export type PaletteKey = "fill" | "review" | "approve" | "branch" | "choice" | "parallel" | "join" | "wait_duration" | "notify" | "subflow" | "set_values" | "end";

export interface PaletteItem {
  key: PaletteKey;
  type: ProcessNodeType;
  label: string;
  hint: string;
}

const typeItem = (t: Exclude<PaletteKey, "fill" | "review" | "approve">): PaletteItem => ({ key: t, type: t, label: PROCESS_NODE_TYPES[t].label, hint: PROCESS_NODE_TYPES[t].hint });

/** §8.4's palette: the steps people do, the paths, the rest («آغاز» is never added). */
export const PALETTE_GROUPS: { group: string; items: PaletteItem[] }[] = [
  {
    group: "مرحله‌ها",
    items: [
      { key: "fill", type: "form_step", label: "مرحلهٔ فرم", hint: "کسی فرمی را پر می‌کند" },
      { key: "review", type: "form_step", label: "بررسی", hint: "کسی پرونده را بررسی می‌کند؛ ادامه می‌دهد یا برای اصلاح برمی‌گرداند" },
      { key: "approve", type: "form_step", label: "تأیید", hint: "کسانی پرونده را تأیید یا رد می‌کنند" },
    ],
  },
  { group: "مسیر", items: [typeItem("branch"), typeItem("choice"), typeItem("parallel"), typeItem("join")] },
  { group: "دیگر", items: [typeItem("wait_duration"), typeItem("notify"), typeItem("subflow"), typeItem("set_values"), typeItem("end")] },
];

export const PALETTE_ITEMS: PaletteItem[] = PALETTE_GROUPS.flatMap((g) => g.items);
export const paletteItem = (key: string): PaletteItem | null => PALETTE_ITEMS.find((i) => i.key === key) ?? null;

/** The settings a palette item's step starts with (an approval: «یک نفر کافی است», the requester kept out). */
export function itemConfig(item: Pick<PaletteItem, "key" | "type">): Record<string, unknown> {
  const base = defaultProcessConfig(item.type);
  if (item.type !== "form_step") return base;
  if (item.key === "approve") return { ...base, action: "approve", quorum: "any" };
  if (item.key === "review") return { ...base, action: "review" };
  return base;
}

// ---------------------------------------------------------------------------------------------------------------
// Adding, wiring and removing steps

const nodeOf = (g: ProcessGraph, id: string | null | undefined) => (id ? g.nodes.find((n) => n.id === id) : undefined);
/** A rank down the canvas. */
export const GAP_Y = NODE_H + 56;
const GAP_X = NODE_W + 40;

/** The way a step goes on by: its first way out that is neither optional nor a «بازگشت» (null: «پایان»). */
export function mainPort(n: Pick<ProcessNode, "type" | "config">): ProcessPort | null {
  return processPorts(n).find((p) => !p.optional && !p.back) ?? null;
}

const lowest = (g: ProcessGraph) => g.nodes.reduce((m, n) => Math.max(m, n.position?.y ?? 0), -GAP_Y);

/** Room for a new rank at `y`: the steps at or below it move down one rank. */
export function makeRoom(g: ProcessGraph, y: number): ProcessGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.position && n.position.y >= y ? { ...n, position: { x: n.position.x, y: n.position.y + GAP_Y } } : n)) };
}

/**
 * A palette item added after a step: on its way on («بعدی», «تأیید شد», «بله»…) when that is free, as one more branch of
 * a «موازی», or between the step and the one it led to (the new step then leads there). Without `after` it is placed
 * below the rest, unconnected. A drop gives its own position (nothing moves).
 */
export function insertAfter(g: ProcessGraph, after: string | null, item: Pick<PaletteItem, "key" | "type">, opts: { position?: { x: number; y: number }; label?: string; config?: Record<string, unknown> } = {}): { graph: ProcessGraph; id: string } {
  const r = placeAfter(g, after, item, opts);
  return { graph: wireRejection(r.graph, r.id), id: r.id };
}

/** A new approval's «رد شد» leads to the process's «پایان (ردشده)» when it has one (the usual way a rejection ends). */
export function wireRejection(g: ProcessGraph, id: string): ProcessGraph {
  const n = nodeOf(g, id);
  if (!n || n.type !== "form_step" || formStepOf(n.config).action !== "approve" || outEdges(g, id, "rejected").length) return g;
  const end = g.nodes.find((x) => x.type === "end" && endOutcomeOf(x.config) === "rejected");
  return end && !connectProblem(g, id, "rejected", end.id) ? connect(g, id, "rejected", end.id) : g;
}

function placeAfter(g0: ProcessGraph, after: string | null, item: Pick<PaletteItem, "key" | "type">, opts: { position?: { x: number; y: number }; label?: string; config?: Record<string, unknown> }): { graph: ProcessGraph; id: string } {
  // a draft saved without positions is laid out first (as the canvas draws it), so the new step lands among the others
  const g = isPlaced(g0) ? g0 : layoutProcess(g0);
  const id = newNodeId(g, item.type);
  const from = nodeOf(g, after);
  const port = from ? mainPort(from) : null;
  const wired = from && port ? outEdges(g, from.id, port.key) : [];
  let base = g;
  let position = opts.position;
  if (!position) {
    if (from?.position && port) {
      position = { x: from.position.x + (port.multi ? wired.length * GAP_X : 0), y: from.position.y + GAP_Y };
      if (!port.multi) base = makeRoom(g, position.y);
    } else position = { x: g.nodes[0]?.position?.x ?? 0, y: lowest(g) + GAP_Y };
  }
  const node: ProcessNode = { id, type: item.type, config: opts.config ?? itemConfig(item), position, ...(opts.label ? { label: opts.label } : {}) };
  let graph: ProcessGraph = { ...base, nodes: [...base.nodes, node] };
  if (!from || !port) return { graph, id };
  if (port.multi || !wired.length) {
    if (!connectProblem(graph, from.id, port.key, id)) graph = connect(graph, from.id, port.key, id);
    return { graph, id };
  }
  // between: the way on now leads to the new step, and the new step to where it led
  const target = wired[0].target;
  graph = connect(graph, from.id, port.key, id);
  const own = mainPort(node);
  if (own && !connectProblem(graph, id, own.key, target)) graph = connect(graph, id, own.key, target);
  return { graph, id };
}

/** A new step on one way out of a step («گام تازه» in «مسیرها»): placed under that way out and connected from it. */
export function addFromPort(g0: ProcessGraph, source: string, port: string, item: Pick<PaletteItem, "key" | "type">, opts: { label?: string; config?: Record<string, unknown> } = {}): { graph: ProcessGraph; id: string } {
  const g = isPlaced(g0) ? g0 : layoutProcess(g0);
  const from = nodeOf(g, source);
  const ports = from ? processPorts(from) : [];
  const at = Math.max(0, ports.findIndex((p) => p.key === port));
  const position = from?.position ? { x: from.position.x + (at - (ports.length - 1) / 2) * GAP_X, y: from.position.y + GAP_Y } : undefined;
  const r = placeAfter(g, null, item, { ...opts, position });
  const graph = connectProblem(r.graph, source, port, r.id) ? r.graph : connect(r.graph, source, port, r.id);
  return { graph: wireRejection(graph, r.id), id: r.id };
}

/** «پایان»s a way out may lead to at once. */
export const END_PRESETS: { key: string; label: string; outcome: "completed" | "rejected" | "canceled" }[] = [
  { key: "end:completed", label: "پایان (انجام‌شده)", outcome: "completed" },
  { key: "end:rejected", label: "پایان (ردشده)", outcome: "rejected" },
];

/** The steps' titles, made unique («تأیید»، «تأیید (۲)») for the lists that name them. */
export function stepTitles(g: ProcessGraph): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const id of readingOrder(g)) {
    const n = nodeOf(g, id);
    if (!n) continue;
    const t = nodeTitle(n);
    const k = (seen.get(t) ?? 0) + 1;
    seen.set(t, k);
    out.set(id, k > 1 ? `${t} (${fa(k)})` : t);
  }
  return out;
}

export interface PortRow {
  port: ProcessPort;
  /** the steps its connections go to now */
  targets: string[];
  /** the steps it may lead to (a single way out: re-pointed) */
  options: { value: string; label: string }[];
}

/** «مسیرها»: every way out of a step, where it leads and where it may lead. */
export function portRows(g: ProcessGraph, id: string): PortRow[] {
  const n = nodeOf(g, id);
  if (!n) return [];
  const titles = stepTitles(g);
  return processPorts(n).map((port) => ({
    port,
    targets: outEdges(g, id, port.key).map((e) => e.target),
    options: connectTargets(g, id, port.key).map((t) => ({ value: t, label: titles.get(t) ?? t })),
  }));
}

/** Point a way out at a step (a single one is re-pointed; a «موازی» gains a branch), or take its connections off. */
export function setPortTarget(g: ProcessGraph, id: string, port: string, target: string | null): ProcessGraph {
  if (!target) return disconnect(g, id, port);
  const n = nodeOf(g, id);
  const p = n ? processPorts(n).find((x) => x.key === port) : undefined;
  if (!p) return g;
  // a single way out is judged as if its connection were gone (it is re-pointed)
  return connectProblem(p.multi ? g : disconnect(g, id, port), id, port, target) ? g : connect(g, id, port, target);
}

/** Take one connection of a way out off (a branch of a «موازی»). */
export const dropConnection = (g: ProcessGraph, id: string, port: string, target: string): ProcessGraph => ({
  ...g,
  edges: g.edges.filter((e) => !(e.source === id && (e.port ?? "out") === port && e.target === target)),
});

/**
 * Steps removed from `prev` leave `next` reconnected where it is plain: a removed step with one way in and one way on
 * (not a «بازگشت», not an optional way) — the way in now leads where the way on led, when the process rules allow it.
 */
export function bridgeRemoved(prev: ProcessGraph, next: ProcessGraph): ProcessGraph {
  const kept = new Set(next.nodes.map((n) => n.id));
  let g = next;
  for (const gone of prev.nodes) {
    if (kept.has(gone.id) || gone.type === "trigger") continue;
    const ins = prev.edges.filter((e) => e.target === gone.id && !isBackEdge(prev, e));
    const optional = new Set(processPorts(gone).filter((p) => p.optional || p.back).map((p) => p.key));
    const outs = prev.edges.filter((e) => e.source === gone.id && !optional.has(e.port ?? "out"));
    if (ins.length !== 1 || outs.length !== 1) continue;
    const from = ins[0];
    const to = outs[0].target;
    if (!kept.has(from.source) || !kept.has(to)) continue;
    const port = from.port ?? "out";
    if (connectProblem(g, from.source, port, to)) continue;
    g = connect(g, from.source, port, to);
  }
  return g;
}

/** Remove a step («آغاز» stays), reconnecting around it where it is plain. */
export const removeNode = (g: ProcessGraph, id: string): ProcessGraph => bridgeRemoved(g, removeSteps(g, [id]));

/** A step's settings with some keys changed (undefined: the key is dropped). */
export function patchConfig(g: ProcessGraph, id: string, patch: Record<string, unknown>): ProcessGraph {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id !== id) return n;
      const config: Record<string, unknown> = { ...(n.config ?? {}), ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete config[k];
      return { ...n, config };
    }),
  };
}

/** A step's name (empty: the default name of its kind). */
export function setLabel(g: ProcessGraph, id: string, label: string): ProcessGraph {
  return {
    ...g,
    nodes: g.nodes.map((n) => {
      if (n.id !== id) return n;
      const { label: _old, ...rest } = n;
      return label.trim() ? { ...rest, label: label.slice(0, 80) } : rest;
    }),
  };
}

/** A way out renamed when a step's action changes: «بعدی» ↔ «تأیید شد». */
const ACTION_PORTS: Record<string, string> = { out: "approved", approved: "out" };

/**
 * A form step's action (تکمیل فرم، بررسی، تأیید): an approval starts with «یک نفر کافی است»; leaving it drops the quorum.
 * The step's way on is kept («بعدی» ↔ «تأیید شد»); ways the new action has not («رد شد», «بازگشت» of a fill step) are
 * taken off, and an automatic decision that no longer fits is dropped.
 */
export function setAction(g: ProcessGraph, id: string, action: StepAction): ProcessGraph {
  const n = nodeOf(g, id);
  if (!n || n.type !== "form_step" || n.config?.start === true) return g;
  const config: Record<string, unknown> = { ...(n.config ?? {}), action };
  if (action === "approve") {
    if (!config.quorum) config.quorum = "any";
  } else {
    delete config.quorum;
    delete config.threshold;
  }
  if (action === "fill") delete config.returnTo;
  if (Array.isArray(config.escalate)) config.escalate = (config.escalate as Escalation[]).filter((x) => x?.action !== "auto" || autoOutcomes(action).includes(x.outcome));
  const next: ProcessNode = { ...n, config };
  const ports = new Set(processPorts(next).map((p) => p.key));
  const edges = g.edges.flatMap((e) => {
    if (e.source !== id) return [e];
    const p = e.port ?? "out";
    if (ports.has(p)) return [e];
    const mapped = ACTION_PORTS[p];
    if (!mapped || !ports.has(mapped)) return [];
    return [{ id: edgeId(id, mapped, e.target), source: id, target: e.target, ...(mapped !== "out" ? { port: mapped } : {}) }];
  });
  return wireRejection({ ...g, nodes: g.nodes.map((x) => (x.id === id ? next : x)), edges }, id);
}

/** The people side of a form step's settings, as the role-then-people picker edits it. */
export const assigneesOf = (config: unknown): StepAssignees => cleanStepAssignees(config);

/** The settings patch of a step's people (undefined drops a key). */
export function assigneesPatch(v: StepAssignees): Record<string, unknown> {
  return { assignees: v.assignees, exclude: v.exclude, fallback: v.fallback?.length ? v.fallback : undefined, ifNobody: v.ifNobody };
}

/** Form steps every path to `id` passes («انجام‌دهندهٔ مرحلهٔ قبل», exclusions), nearest last. */
export function earlierSteps(g: ProcessGraph, id: string): { id: string; label: string }[] {
  const s = structureOf(g);
  const before = s.dom.get(id) ?? new Set<string>();
  const titles = stepTitles(g);
  return (s.order ?? g.nodes.map((n) => n.id)).filter((x) => x !== id && before.has(x) && nodeOf(g, x)?.type === "form_step").map((x) => ({ id: x, label: titles.get(x) ?? x }));
}

/** «پیوستن»: after every branch, or after the first (which must withdraw the others). */
export const joinPatch = (mode: "all" | "any"): Record<string, unknown> => (mode === "any" ? { mode, cancel_rest: true } : { mode, cancel_rest: undefined });

// ---------------------------------------------------------------------------------------------------------------
// «انتخاب»: its cases

/** A free key for a new case («c1», «c2»…). */
export function newCaseKey(cases: readonly Pick<ChoiceCase, "key">[]): string {
  for (let i = 1; ; i++) if (!cases.some((c) => c.key === `c${i}`)) return `c${i}`;
}

/** A «انتخاب» with its cases set; the connections of a case taken out go with it. */
export function setCases(g: ProcessGraph, id: string, cases: ChoiceCase[]): ProcessGraph {
  const keep = new Set([...cases.map((c) => c.key), "else"]);
  const next = patchConfig(g, id, { cases });
  return { ...next, edges: next.edges.filter((e) => e.source !== id || keep.has(e.port ?? "out")) };
}

export const casesOf = (config: unknown): ChoiceCase[] => choiceCases(config);

// ---------------------------------------------------------------------------------------------------------------
// The case's values: the fields of the process's forms

/** A process form as the designer knows it (its layout and the definitions of its fields). */
export interface FormInfo {
  id: string;
  name: string;
  layout: FormLayoutV2;
  fields: Record<string, FieldDef>;
}

/** A value a case keeps (a library field of one of the process's forms). */
export interface CaseField {
  name: string;
  label: string;
  /** storage type: user, users, group, ref (+ ref), money, choice… */
  type: string;
  ref: string | null;
  options: Option[];
  /** the forms it is on */
  forms: string[];
}

/** The forms the steps use, in the graph's order. */
export function graphForms(g: ProcessGraph): string[] {
  const out: string[] = [];
  for (const n of g.nodes) {
    if (n.type !== "form_step") continue;
    const f = formStepOf(n.config).form;
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** The values a case keeps: every field of the process's forms, once, in the forms' order. */
export function caseFields(forms: readonly FormInfo[]): CaseField[] {
  const out = new Map<string, CaseField>();
  for (const f of forms) {
    for (const item of fieldItems(f.layout)) {
      const def = f.fields[item.field];
      const had = out.get(item.field);
      if (had) {
        if (!had.forms.includes(f.name)) had.forms.push(f.name);
        continue;
      }
      const choices = def?.choices;
      out.set(item.field, { name: item.field, label: def?.label || item.label || item.field, type: def?.type ?? "string", ref: def?.ref ?? null, options: Array.isArray(choices) ? choices : [], forms: [f.name] });
    }
  }
  return [...out.values()];
}

/** What F3's resolve needs of the fields (person, unit and group fields of the rules). */
export const resolveFields = (fields: readonly CaseField[]): Record<string, { type: string; ref?: string | null; label?: string | null }> =>
  Object.fromEntries(fields.map((f) => [f.name, { type: f.type, ref: f.ref, label: f.label }]));

/** The keys of the case beside its values (number, title, the requester…), for conditions. */
export const CASE_META: { name: string; label: string; type: string }[] = [
  { name: "number", label: "شمارهٔ پرونده", type: "string" },
  { name: "title", label: "عنوان پرونده", type: "string" },
  { name: "requested_by", label: "درخواست‌دهنده", type: "user" },
  { name: "requested_for", label: "برای چه کسی", type: "user" },
  { name: "unit_id", label: "واحد درخواست‌دهنده", type: "ref" },
];

/** A data pill of a case value: `{{case.u_amount}}`. */
export const casePill = (name: string): string => `{{${CASE_ROOT}.${name}}}`;

/** The case value a pill names when it is just that pill (`{{case.u_amount}}` → «u_amount»), else null. */
export function pillField(expr: unknown): string | null {
  const m = typeof expr === "string" ? expr.trim().match(/^\{\{\s*case\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/) : null;
  return m ? m[1] : null;
}

/** One comparison of «شرط» or a case of «انتخاب». */
export interface CaseRule {
  left: string;
  op: string;
  right: string;
}

export const caseRules = (v: unknown): CaseRule[] =>
  (Array.isArray(v) ? v : []).filter(isObj).map((r) => ({ left: String(r.left ?? ""), op: String(r.op ?? "eq"), right: r.right === undefined || r.right === null ? "" : String(r.right) }));

/** Comparisons with nothing on the right. */
export const NO_RIGHT = new Set(["empty", "nempty"]);

/** A Rial amount in the unit people type (toman: a tenth). */
export function unitFromRial(rial: string, unit: "rial" | "toman"): string {
  const s = rial.trim();
  if (!s || unit === "rial" || !/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (/^-?\d+0$/.test(s)) return s.slice(0, -1);
  const n = Number(s) / 10;
  return Number.isFinite(n) ? String(n) : s;
}

// ---------------------------------------------------------------------------------------------------------------
// Title, «درخواست‌دهنده چه می‌بیند»

/** The fields of the start step's form (the title may name them; the requester always reads them). */
export function startFields(g: ProcessGraph, forms: ReadonlyMap<string, FormInfo>): { name: string; label: string }[] {
  const { start } = startOf(g);
  const id = start ? formStepOf(start.config).form : null;
  const info = id ? forms.get(id) : undefined;
  return info ? fieldItems(info.layout).map((i) => ({ name: i.field, label: info.fields[i.field]?.label || i.label || i.field })) : [];
}

/** What a title may name: the start form's fields, then the requester and «برای چه کسی». */
export function titleFields(g: ProcessGraph, forms: ReadonlyMap<string, FormInfo>): { name: string; label: string }[] {
  return [...startFields(g, forms), { name: "requested_by", label: "درخواست‌دهنده" }, { name: "requested_for", label: "برای چه کسی" }];
}

/** The title a case would get, its pills as «field names» (an empty template: the process's name). */
export function titleSample(template: string | null | undefined, label: (key: string) => string | undefined, processName: string): string {
  return renderTitle(template, (k) => `«${label(k) ?? k}»`, processName);
}

/** Text with `insert` put in place of [start, end) and where the caret goes after it. */
export function insertText(value: string, start: number, end: number, insert: string): { value: string; caret: number } {
  const a = Math.max(0, Math.min(start, value.length));
  const b = Math.max(a, Math.min(end, value.length));
  return { value: value.slice(0, a) + insert + value.slice(b), caret: a + insert.length };
}

/** Fields «درخواست‌دهنده چه می‌بیند» may add: those of the other forms (the start form's are always read). */
export function requesterViewOptions(fields: readonly CaseField[], start: readonly { name: string }[]): CaseField[] {
  const own = new Set(start.map((f) => f.name));
  return fields.filter((f) => !own.has(f.name));
}

// ---------------------------------------------------------------------------------------------------------------
// Times and escalations

const unitLabel = (u: unknown) => DURATION_UNITS.find((x) => x.value === u)?.label ?? "";
export const durationText = (d: Pick<Duration, "amount" | "unit"> | null | undefined): string => (d && d.amount ? `${fa(d.amount)} ${unitLabel(d.unit)}` : "");

export const ESCALATION_LABELS: Record<Escalation["action"], string> = { notify: "باخبر کردن", reassign: "سپردن به دیگران", auto: "تصمیم خودکار" };
export const ESCALATION_TO_LABELS: Record<"manager" | "reports_to" | "managers", string> = {
  manager: "مدیر انجام‌دهنده",
  reports_to: "دارندهٔ نقش بالادست",
  managers: "مسئولان گردش‌کار",
};

/** The decisions a step may take by itself when its time is up (never «بازگشت»). */
export const autoOutcomes = (a: StepAction): StepOutcome[] => stepOutcomes(a).filter((o) => o !== "returned");

export const outcomeText = (o: string): string => TASK_OUTCOMES.find((x) => x.value === o)?.label ?? o;

/** A new escalation of a kind, two days after the step opened. */
export function newEscalation(action: Escalation["action"], stepAction: StepAction): Escalation {
  const after: Duration = { amount: 2, unit: "day" };
  if (action === "notify") return { after, action, to: "manager" };
  if (action === "reassign") return { after, action, rules: [] };
  return { after, action: "auto", outcome: autoOutcomes(stepAction)[0] ?? "submitted" };
}

// ---------------------------------------------------------------------------------------------------------------
// Notices

export interface StepNotice {
  name: string;
  /** who gets it and when */
  when: string;
  /** a seeded rule of «قانون‌های اعلان» (its text is edited there); otherwise the step's timers send it */
  rule: boolean;
}

/**
 * The messages a step sends: the seeded rules («مرحله‌ای منتظر شماست»، «پرونده برای اصلاح به شما بازگشت»، «مرحلهٔ
 * بی‌انجام‌دهنده») as the step's settings call for them, the timers' reminder and overdue notices, and for a «پایان»
 * the requester's notice of how the case ended.
 */
export function stepNotices(g: ProcessGraph, id: string): StepNotice[] {
  const n = nodeOf(g, id);
  if (!n) return [];
  if (n.type === "end") {
    const o = endOutcomeOf(n.config);
    const name = o === "rejected" ? "گردش‌کار شما رد شد" : o === "canceled" ? "گردش‌کار شما لغو شد" : "گردش‌کار شما به پایان رسید";
    return [{ name, when: "به درخواست‌دهنده، وقتی پرونده به این پایان می‌رسد", rule: true }];
  }
  if (n.type !== "form_step") return [];
  const step = formStepOf(n.config);
  const out: StepNotice[] = [];
  if (!step.start) out.push({ name: "مرحله‌ای منتظر شماست", when: "به انجام‌دهندگان، وقتی مرحله برایشان باز می‌شود", rule: true });
  if (g.edges.some((e) => e.target === id && isBackEdge(g, e))) out.push({ name: "پرونده برای اصلاح به شما بازگشت", when: "به انجام‌دهندهٔ پیشین، وقتی پرونده برای اصلاح به این مرحله برمی‌گردد", rule: true });
  if (!step.start && ifNobodyOf(step) !== "skip") out.push({ name: "مرحلهٔ بی‌انجام‌دهنده", when: "به مسئولان گردش‌کار، وقتی کسی برای این مرحله پیدا نشود", rule: true });
  if (step.remind_every) out.push({ name: "یادآوری مرحله", when: `به انجام‌دهندگان، هر ${durationText(step.remind_every)} تا مرحله باز است`, rule: false });
  if (step.due) out.push({ name: "مهلت گذشت", when: `وقتی ${durationText(step.due)} از باز شدن مرحله بگذرد، طبق تشدیدهای مهلت`, rule: false });
  return out;
}

/** The end word of a «پایان» («انجام‌شده»، «ردشده»، «لغوشده»). */
export const endText = (o: string): string => CASE_OUTCOMES.find((x) => x.value === o)?.label ?? o;

// ---------------------------------------------------------------------------------------------------------------
// Problems: badges, the drawer, kept current between autosaves

/** The inspector tabs of a form step. */
export type InspectorTab = "people" | "form" | "time" | "notices" | "paths";

const TAB_OF: Record<string, InspectorTab> = {
  assignees: "people", exclude: "people", ifNobody: "people", fallback: "people",
  form: "form", rights: "form",
  due: "time", remind_every: "time", escalate: "time", business: "time",
};

/** Process settings the server checks (starters, managers, title, what the requester reads). */
export const SETTING_FIELDS = new Set(["starters", "managers", "manager_groups", "requester_view", "title_template"]);

/** Where a problem is fixed: a tab of the step's inspector, or the process settings. */
export function problemTarget(p: Pick<FlowProblem, "node" | "field">): { node: string | null; tab: InspectorTab | null; settings: boolean } {
  if (p.node) return { node: p.node, tab: p.field ? (TAB_OF[p.field] ?? null) : null, settings: false };
  return { node: null, tab: null, settings: !!p.field && SETTING_FIELDS.has(p.field) };
}

const problemKey = (p: FlowProblem) => `${p.level}|${p.node ?? ""}|${p.edge ?? ""}|${p.field ?? ""}|${p.message}`;
const nodeSig = (n: ProcessNode | undefined) => (n ? stableJson({ type: n.type, label: n.label ?? null, config: n.config ?? {} }) : "");
const pathSig = (g: ProcessGraph) => stableJson([g.nodes.map((n) => nodeSig(n)).sort(), g.edges.map((e) => `${e.source}|${e.port ?? "out"}|${e.target}`).sort()]);

/**
 * The problems to show now: the live check of the draft on the screen (its structure, forms and fields) and the
 * server's from the last save (people, positions, groups and automations that exist) where they still apply — a step's
 * while the step is as it was saved, a setting's while the setting is, the process's while its paths are.
 */
export function liveProblems(local: readonly FlowProblem[], server: readonly FlowProblem[], saved: ProcessDraft, now: ProcessDraft): FlowProblem[] {
  const was = new Map(saved.graph.nodes.map((n) => [n.id, nodeSig(n)]));
  const nodes = new Map(now.graph.nodes.map((n) => [n.id, n]));
  const edges = new Set(now.graph.edges.map((e) => e.id));
  const samePaths = pathSig(saved.graph) === pathSig(now.graph);
  const sameSetting = (f: string) => stableJson((saved as unknown as Record<string, unknown>)[f] ?? null) === stableJson((now as unknown as Record<string, unknown>)[f] ?? null);
  const current = (p: FlowProblem) => {
    if (p.edge && !edges.has(p.edge)) return false;
    if (p.node) return nodes.has(p.node) && was.get(p.node) === nodeSig(nodes.get(p.node));
    if (p.field && SETTING_FIELDS.has(p.field)) return sameSetting(p.field);
    return samePaths;
  };
  const out: FlowProblem[] = [];
  const seen = new Set<string>();
  for (const p of [...local, ...server.filter(current)]) {
    const k = problemKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export const countProblems = (problems: readonly FlowProblem[]): { errors: number; warnings: number } => ({
  errors: problems.filter((p) => p.level === "error").length,
  warnings: problems.filter((p) => p.level !== "error").length,
});

/** «۲ ایراد، ۱ هشدار» (empty when there are none). */
export function problemsText(problems: readonly FlowProblem[]): string {
  const { errors, warnings } = countProblems(problems);
  return [errors ? `${fa(errors)} ایراد` : "", warnings ? `${fa(warnings)} هشدار` : ""].filter(Boolean).join(SEP);
}

export interface ProblemGroup {
  /** null: the process as a whole */
  node: string | null;
  title: string;
  items: FlowProblem[];
}

/** The drawer's groups: the process first, then each step in reading order; errors before warnings within each. */
export function problemGroups(problems: readonly FlowProblem[], g: ProcessGraph): ProblemGroup[] {
  const titles = stepTitles(g);
  const order = new Map(readingOrder(g).map((id, i) => [id, i]));
  const groups = new Map<string, ProblemGroup>();
  for (const p of problems) {
    const node = p.node && titles.has(p.node) ? p.node : null;
    const k = node ?? "";
    const grp = groups.get(k) ?? { node, title: node ? (titles.get(node) ?? node) : "گردش‌کار", items: [] };
    grp.items.push(p);
    groups.set(k, grp);
  }
  for (const grp of groups.values()) grp.items.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return [...groups.values()].sort((a, b) => (a.node === null ? -1 : b.node === null ? 1 : (order.get(a.node) ?? 0) - (order.get(b.node) ?? 0)));
}

// ---------------------------------------------------------------------------------------------------------------
// «نسخه‌ها»

export const versionTitle = (v: Pick<VersionRow, "version_no">): string => `نسخهٔ ${fa(v.version_no)}`;

/** «۱۴۰۵/۰۸/۲۳ ۱۰:۲۰، پرویز مسئول انتشار». */
export function versionMeta(v: Pick<VersionRow, "published_at" | "published_by">, names: Record<string, string>, tz?: string): string {
  return [v.published_at ? formatJalaliDateTime(v.published_at, tz) : "", v.published_by ? (names[v.published_by] ?? "") : ""].filter(Boolean).join(SEP);
}

// ---------------------------------------------------------------------------------------------------------------
// «پیش‌نمایش»

/** The steps «پیش‌نمایش» finds people for, in the order a case meets them (not «ثبت درخواست»: the requester). */
export function previewSteps(g: ProcessGraph): ProcessNode[] {
  return readingOrder(g)
    .map((id) => nodeOf(g, id))
    .filter((n): n is ProcessNode => !!n && n.type === "form_step" && n.config?.start !== true);
}

/** What resolve is asked for one step, with the people of the steps before it as their actors. */
export function resolveBody(
  node: ProcessNode,
  o: { requester: string; values: Record<string, unknown>; fields: readonly CaseField[]; draft: Pick<ProcessDraft, "managers" | "manager_groups">; stepActors: Record<string, string[]>; previous: string | null },
): ResolveBody {
  const step = formStepOf(node.config);
  return {
    step: assigneesOf(node.config),
    action: step.action,
    quorum: step.action === "approve" ? (step.quorum ?? "any") : null,
    label: nodeTitle(node),
    requester: o.requester,
    values: o.values,
    fields: resolveFields(o.fields),
    step_actors: o.stepActors,
    previous_actor: o.previous,
    managers: o.draft.managers,
    manager_groups: o.draft.manager_groups,
  };
}

/**
 * Why «پیش‌نمایش» need not ask for a step's people: the first problem of its people settings that needs no lookup
 * («این مرحله انجام‌دهنده ندارد»), the very message resolve would refuse it with.
 */
export const previewBlocked = (node: ProcessNode): string | null => assigneeProblems(assigneesOf(node.config))[0]?.message ?? null;

/** The line a step shows in «پیش‌نمایش»: its first person («علی احمدی — رئیس شعبه (شعبهٔ ونک)») and how many more, or why nobody. */
export function previewNote(r: Pick<ResolveResult, "status" | "lines" | "message">): string {
  if (r.status === "nobody" || r.status === "too_many") return r.message ?? "کسی پیدا نشد";
  if (!r.lines.length) return "کسی پیدا نشد";
  const more = r.lines.length > 1 ? ` و ${fa(r.lines.length - 1)} نفر دیگر` : "";
  return `${r.lines[0]}${more}`;
}

/** The people a step found, as the next steps' actors. */
export const resolvedPeople = (r: Pick<ResolveResult, "people">): string[] => [...new Set(r.people.map((p) => p.user))];

// ---------------------------------------------------------------------------------------------------------------
// Small parts of the inspector and the canvas

/** An approval's rule, in words (§8.4 «قاعده: یک نفر کافی است»). */
export const QUORUM_OPTIONS: { value: string; label: string }[] = [
  { value: "any", label: "یک نفر کافی است" },
  { value: "all", label: "همه باید تأیید کنند" },
  { value: "count", label: "تعداد مشخصی از افراد" },
  { value: "percent", label: "درصدی از افراد" },
  { value: "first", label: "نخستین پاسخ، تأیید یا رد" },
];

/** A form step's action, in words. */
export const ACTION_OPTIONS: { value: StepAction; label: string }[] = [
  { value: "fill", label: "تکمیل فرم" },
  { value: "review", label: "بررسی" },
  { value: "approve", label: "تأیید" },
];

/** «پایان»'s outcomes, in words. */
export const END_OPTIONS: { value: "completed" | "rejected" | "canceled"; label: string }[] = [
  { value: "completed", label: "انجام‌شده" },
  { value: "rejected", label: "ردشده" },
  { value: "canceled", label: "لغوشده" },
];

/** The steps a way out may lead to at once: a «پایان» of either outcome, or a new step of the palette. */
export const NEW_STEP_OPTIONS: { value: string; label: string }[] = [
  ...END_PRESETS.map((p) => ({ value: `new:${p.key}`, label: p.label })),
  { value: "new:fill", label: "مرحلهٔ فرم تازه" },
  { value: "new:approve", label: "تأیید تازه" },
  { value: "new:review", label: "بررسی تازه" },
  { value: "new:branch", label: "شرط تازه" },
];

/** What a «new:…» choice of «مسیرها» adds: the palette item, and a «پایان»'s outcome and name. */
export function newStepOf(value: string): { item: PaletteItem; label?: string; config?: Record<string, unknown> } | null {
  if (!value.startsWith("new:")) return null;
  const key = value.slice(4);
  const end = END_PRESETS.find((p) => p.key === key);
  if (end) return { item: paletteItem("end")!, label: end.label, config: { outcome: end.outcome } };
  const item = paletteItem(key);
  return item ? { item } : null;
}

/** The graph without the canvas's positions: what the checks read (a drag does not re-check anything). */
export const structureKey = (g: ProcessGraph): string => stableJson({ nodes: g.nodes.map(({ position: _p, ...n }) => n), edges: g.edges });

/**
 * An edit that only moved steps (a drag, Shift + an arrow): the history merges the moves of the same steps into one
 * step to undo. Null when anything else changed.
 */
export function moveKey(prev: ProcessGraph, next: ProcessGraph): string | null {
  if (structureKey(prev) !== structureKey(next)) return null;
  const was = new Map(prev.nodes.map((n) => [n.id, n.position]));
  const moved = next.nodes.filter((n) => stableJson(was.get(n.id) ?? null) !== stableJson(n.position ?? null)).map((n) => n.id);
  return moved.length ? `move:${moved.sort().join(",")}` : null;
}

/** A process form for the step's picker. */
export interface FormChoice {
  id: string;
  name: string;
  status: string;
}

/** The process forms of «فرم‌ها»' list (the steps' choices), by name. */
export function processForms(list: readonly { kind: string; id: string | null; name: string; status?: string }[]): FormChoice[] {
  return list
    .filter((f) => f.kind === "process" && !!f.id)
    .map((f) => ({ id: f.id!, name: f.name, status: f.status ?? "draft" }))
    .sort((a, b) => a.name.localeCompare(b.name, "fa"));
}

/** A form's detail (GET /forms/:id) as the designer keeps it. */
export function formInfoOf(d: { form: { id: string; name: string; layout: FormLayoutV2 }; fields: Record<string, { label: string; def: FieldDef | null }> }): FormInfo {
  const fields: Record<string, FieldDef> = {};
  for (const [name, f] of Object.entries(d.fields)) if (f.def) fields[name] = { ...f.def, label: f.def.label || f.label };
  return { id: d.form.id, name: d.form.name, layout: d.form.layout, fields };
}

/** A new step's form: the rights start empty (the default stays) — a field of the old form is not this form's. */
export function formPatch(config: unknown, form: string | null): Record<string, unknown> {
  const step = formStepOf(config);
  return { form, rights: { default: step.rights.default, fields: {} } };
}

/** The phone's line under a step: its problems, else what it does. */
export function phoneNotes(problems: readonly FlowProblem[]): Record<string, string> {
  const out: Record<string, string> = {};
  const byNode = new Map<string, FlowProblem[]>();
  for (const p of problems) if (p.node) byNode.set(p.node, [...(byNode.get(p.node) ?? []), p]);
  for (const [node, list] of byNode) {
    const errors = list.filter((p) => p.level === "error").length;
    out[node] = errors ? `${fa(errors)} ایراد: ${list.find((p) => p.level === "error")!.message}` : `${fa(list.length)} هشدار: ${list[0].message}`;
  }
  return out;
}

/** A «انتخاب»'s cases as stored, for editing (labels as typed: spaces kept while a name is written). */
export function rawCases(config: unknown): ChoiceCase[] {
  const c = isObj(config) ? config : {};
  return (Array.isArray(c.cases) ? c.cases : []).filter(isObj).map((x) => ({
    key: String(x.key ?? ""),
    label: typeof x.label === "string" ? x.label : "",
    rules: Array.isArray(x.rules) ? x.rules.filter(isObj) : [],
    ...(x.match === "any" ? { match: "any" as const } : {}),
  }));
}

/** The values a «تعیین مقدار» writes, in order (field → template). */
export const valueRows = (config: unknown): [string, string][] => {
  const v = isObj(config) && isObj(config.values) ? config.values : {};
  return Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x : x === null || x === undefined ? "" : JSON.stringify(x)]);
};

/** The inputs a «جریان خودکار» hands its automation ([{ name, value }]). */
export const inputRows = (config: unknown): { name: string; value: string }[] =>
  (isObj(config) && Array.isArray(config.inputs) ? config.inputs : []).filter(isObj).map((r) => ({ name: String(r.name ?? ""), value: typeof r.value === "string" ? r.value : "" }));

/** Problems of a step per inspector tab (the tabs show how many each holds). */
export function tabProblems(problems: readonly FlowProblem[]): Partial<Record<InspectorTab, number>> {
  const out: Partial<Record<InspectorTab, number>> = {};
  for (const p of problems) {
    const t = problemTarget(p).tab;
    if (t) out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

/**
 * The rules «چه کسانی آغاز می‌کنند» offers: the person's own positions — held anywhere, or in a fixed unit — their
 * groups, their access roles, or named people. That is what F4c checks to offer «شروع» (`mayInclude` on the person's
 * positions, groups and roles); a rule that depends on a case (a manager, a unit head, the requester, a field, an
 * earlier step, a unit of the requester) has no case to read before the start, so nobody could start the process.
 */
export const STARTER_SCOPE: RuleScope = { kinds: ["position", "group", "role", "users"], wheres: ["anywhere", "unit"] };

/**
 * What «چه کسانی آغاز می‌کنند» warns about: «فقط این نقش‌ها و افراد» chosen with no rule yet (the draft keeps no
 * starters, which means every member), or only rules no person can match before a case exists (each of them also
 * says so in the list).
 */
export function startersNote(starters: readonly AssigneeRule[], some: boolean): string | null {
  if (some && !starters.length) return "هنوز قاعده‌ای نیفزوده‌اید؛ تا قاعده‌ای نباشد، همهٔ اعضای سازمان این گردش‌کار را آغاز می‌کنند.";
  if (starters.length && starters.every((r) => !ruleInScope(r, STARTER_SCOPE))) return "با این قاعده‌ها کسی این گردش‌کار را آغاز نمی‌کند.";
  return null;
}

/** Who may start the process, in words. */
export function startersText(starters: readonly AssigneeRule[]): string {
  if (!starters.length) return "همهٔ اعضای سازمان می‌توانند این گردش‌کار را آغاز کنند.";
  return starters.length === 1 ? "فقط کسانی که قاعدهٔ آغازکنندگان می‌یابد آن را آغاز می‌کنند." : `فقط کسانی که یکی از ${fa(starters.length)} قاعدهٔ آغازکنندگان می‌یابد آن را آغاز می‌کنند.`;
}

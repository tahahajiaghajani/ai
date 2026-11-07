// The designer's pure logic (no React): adding, connecting and removing steps, the one-line summary each node
// shows, which data pills a step may use (the trigger record's fields, earlier steps' outputs, variables, the loop's
// current item, the clock), and the auto-layout with dagre — top to bottom, or right to left as Persian reads.
// Unit-tested in tests/flows-ui.test.ts.
import dagre from "@dagrejs/dagre";
import {
  DURATION_UNITS, NODE_TYPES, defaultConfig, edgesFrom, loopBodies, nodeDef, nodeLabel, upstreamOf,
  type FlowEdge, type FlowGraph, type FlowNode, type NodeType, type TriggerConfig,
} from "@shared/flows";
import { faDigits } from "@shared/format";

export const NODE_W = 248;
export const NODE_H = 76;
export type Direction = "TB" | "RL";

export interface FieldLite {
  name: string;
  label: string;
  type: string;
  readonly?: boolean;
  system?: boolean;
  hidden?: boolean;
}

/** A short id for a new node of `type` (unique in the graph). */
export function newNodeId(g: FlowGraph, type: NodeType): string {
  const base = type.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  for (let i = 1; ; i++) {
    const id = `${base}${i}`;
    if (!g.nodes.some((n) => n.id === id)) return id;
  }
}

/** The first output port of `node` that has no edge yet (multi ports always qualify), else null. */
export function freePort(g: FlowGraph, node: FlowNode): string | null {
  const def = nodeDef(node.type);
  for (const p of def?.ports ?? []) {
    if (p.error) continue;
    if (p.multi || !edgesFrom(g, node.id, p.key).length) return p.key;
  }
  return null;
}

/** Why `source.port → target` may not be drawn (Persian), or null. */
export function connectProblem(g: FlowGraph, source: string, port: string, target: string): string | null {
  if (source === target) return "گامی به خودش وصل نمی‌شود";
  const s = g.nodes.find((n) => n.id === source);
  const t = g.nodes.find((n) => n.id === target);
  if (!s || !t) return "گام پیدا نشد";
  if (t.type === "trigger") return "به «شروع» نمی‌توان وصل شد";
  const p = nodeDef(s.type)?.ports.find((x) => x.key === port);
  if (!p) return "این خروجی وجود ندارد";
  if (!p.multi && edgesFrom(g, source, port).length) return `از خروجی «${p.label}» فقط یک اتصال می‌رود`;
  if (g.edges.some((e) => e.source === source && (e.port ?? "out") === port && e.target === target)) return "این اتصال هست";
  // no cycles: the target must not already reach the source
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === source) return "این اتصال دور می‌سازد";
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of g.edges) if (e.source === id) stack.push(e.target);
  }
  return null;
}

export function connect(g: FlowGraph, source: string, port: string, target: string): FlowGraph {
  const edge: FlowEdge = { id: `${source}-${port}-${target}`, source, target, ...(port !== "out" ? { port } : {}) };
  return { ...g, edges: [...g.edges, edge] };
}

/** Add a step; with `after`, below that step and connected from its first free port. */
export function addNode(g: FlowGraph, type: NodeType, opts: { after?: string | null; position?: { x: number; y: number }; direction?: Direction } = {}): { graph: FlowGraph; id: string } {
  const id = newNodeId(g, type);
  const after = opts.after ? g.nodes.find((n) => n.id === opts.after) : undefined;
  const dir = opts.direction ?? "TB";
  const base = after?.position ?? { x: 0, y: 0 };
  const position = opts.position ?? (after ? (dir === "TB" ? { x: base.x, y: base.y + NODE_H + 70 } : { x: base.x - NODE_W - 70, y: base.y }) : { x: base.x, y: base.y + (g.nodes.length * (NODE_H + 30)) });
  const node: FlowNode = { id, type, config: defaultConfig(type), position };
  let graph: FlowGraph = { ...g, nodes: [...g.nodes, node] };
  const port = after ? freePort(g, after) : null;
  if (after && port) graph = connect(graph, after.id, port, id);
  return { graph, id };
}

/** Remove steps (never «شروع») and their edges. */
export function removeNodes(g: FlowGraph, ids: string[]): FlowGraph {
  const drop = new Set(ids.filter((id) => g.nodes.find((n) => n.id === id)?.type !== "trigger"));
  return { ...g, nodes: g.nodes.filter((n) => !drop.has(n.id)), edges: g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)) };
}

export function updateNode(g: FlowGraph, id: string, patch: Partial<Pick<FlowNode, "label" | "config" | "position">>): FlowGraph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Lay the graph out with dagre: «TB» top to bottom, «RL» right to left. */
export function autoLayout(g: FlowGraph, direction: Direction): FlowGraph {
  const d = new dagre.graphlib.Graph();
  d.setGraph({ rankdir: direction, nodesep: 36, ranksep: 64, marginx: 24, marginy: 24 });
  d.setDefaultEdgeLabel(() => ({}));
  for (const n of g.nodes) d.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of g.edges) if (g.nodes.some((n) => n.id === e.source) && g.nodes.some((n) => n.id === e.target)) d.setEdge(e.source, e.target);
  dagre.layout(d);
  return {
    ...g,
    layout: { ...(g.layout ?? {}), direction },
    nodes: g.nodes.map((n) => {
      const p = d.node(n.id) as { x: number; y: number } | undefined;
      return p ? { ...n, position: { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 2) } } : n;
    }),
  };
}

const unitLabel = (u: unknown) => DURATION_UNITS.find((x) => x.value === u)?.label ?? "";

/** One line under a node's title: what it works on. */
export function nodeSummary(n: FlowNode, tableLabel: (key: string) => string, trigger?: Partial<TriggerConfig> | null): string {
  const c = n.config ?? {};
  const table = () => tableLabel(String(c.table || trigger?.table || "")) || "جدول آغازگر";
  const count = (v: unknown) => (v && typeof v === "object" ? Object.keys(v as object).length : 0);
  switch (n.type) {
    case "update_record":
    case "create_record":
      return `${table()} · ${faDigits(count(c.values))} فیلد`;
    case "add_comment":
      return `${c.kind === "comment" ? "نظر" : "یادداشت کاری"} · ${table()}`;
    case "notify":
      return String(c.subject || "بی‌عنوان");
    case "approval":
      return c.rule === "all" ? "همه باید تأیید کنند" : "تأیید یک نفر کافی است";
    case "wait_condition":
      return `تا برقرار شدن شرط · ${table()}`;
    case "wait_duration": {
      if (c.mode === "until") return `تا ${String(c.until || "…")}`;
      const d = (c.duration ?? {}) as { amount?: unknown; unit?: unknown };
      return d.amount ? `${faDigits(String(d.amount))} ${unitLabel(d.unit)}${c.business ? " کاری" : ""}` : "مدت را تعیین کنید";
    }
    case "branch":
      return c.mode === "data" ? `مقایسهٔ داده‌ها · ${faDigits(Array.isArray(c.rules) ? c.rules.length : 0)} شرط` : `شرط روی ${table()}`;
    case "for_each":
      return c.source === "list" ? "هر مورد فهرست" : `هر رکورد ${table()}`;
    case "call_http":
      return `${String(c.method || "GET")} ${String(c.path || "/")}`;
    case "set_vars":
      return (Array.isArray(c.vars) ? (c.vars as { name?: string }[]) : []).map((v) => v.name).filter(Boolean).join("، ") || "متغیری تعیین نشده";
    case "subflow":
      return c.wait === false ? "اجرا بدون انتظار" : "اجرا و انتظار";
    case "ai_skill":
      return String(c.skill || "مهارتی انتخاب نشده");
    case "join":
      return c.mode === "any" ? "پس از نخستین شاخه" : "پس از همهٔ شاخه‌ها";
    case "parallel":
      return "شاخه‌های هم‌زمان";
    case "end":
      return c.outcome === "failed" ? "پایان ناموفق" : "پایان";
    default:
      return "";
  }
}

// ----- data pills -------------------------------------------------------------------------------------------------

export interface Pill {
  /** the expression inside {{ }} */
  path: string;
  label: string;
  group: string;
}

export interface PillContext {
  trigger: Partial<TriggerConfig> | null;
  fieldsOf: (table: string) => FieldLite[] | undefined;
}

const LABELLED = new Set(["choice", "multichoice", "ref", "refs", "user", "users", "group", "bool", "date", "datetime"]);

function recordPills(prefix: string, fields: FieldLite[] | undefined, group: string): Pill[] {
  const out: Pill[] = [{ path: `${prefix}.id`, label: "شناسه", group }];
  for (const f of fields ?? []) {
    if (f.type === "secret") continue;
    out.push({ path: `${prefix}.${f.name}`, label: f.label, group });
    if (LABELLED.has(f.type)) out.push({ path: `${prefix}.$labels.${f.name}`, label: `${f.label} (متن)`, group });
  }
  return out;
}

/** The pills a node may use: what runs before it, its loop's item, and the trigger. */
export function availablePills(g: FlowGraph, nodeId: string, ctx: PillContext): Pill[] {
  const out: Pill[] = [];
  const t = ctx.trigger;
  if (t?.table) out.push(...recordPills("trigger.record", ctx.fieldsOf(t.table), "رکورد آغازکننده"));
  const tg = "آغازگر";
  out.push({ path: "trigger.actor", label: "کاربر آغازکننده", group: tg });
  if (t?.kind === "record") {
    out.push({ path: "trigger.event", label: "رویداد", group: tg }, { path: "trigger.changed", label: "فیلدهای تغییرکرده", group: tg });
  }
  if (t?.kind === "webhook") out.push({ path: "trigger.body", label: "بدنهٔ وب‌هوک", group: tg }, { path: "trigger.query", label: "پارامترهای نشانی", group: tg });
  if (t?.kind === "schedule") out.push({ path: "trigger.scheduled_at", label: "زمان زمان‌بندی", group: tg });
  if (t?.kind === "manual" || t?.kind === "catalog") out.push({ path: "trigger.inputs", label: "ورودی‌ها", group: tg });
  const before = upstreamOf(g, nodeId);
  const vars = new Set<string>();
  for (const n of g.nodes) {
    if (!before.has(n.id) || n.type === "trigger") continue;
    const def = nodeDef(n.type);
    const group = `گام «${nodeLabel(n)}»`;
    if (n.type === "set_vars") for (const v of Array.isArray(n.config.vars) ? (n.config.vars as { name?: string }[]) : []) if (v.name) vars.add(v.name);
    for (const o of def?.outputs ?? []) out.push({ path: `steps.${n.id}.output.${o.key}`, label: o.label, group });
    if (n.type === "call_http") for (const m of Array.isArray(n.config.map) ? (n.config.map as { name?: string }[]) : []) if (m.name) out.push({ path: `steps.${n.id}.output.${m.name}`, label: m.name, group });
    if (n.type === "create_record" || n.type === "update_record") {
      const table = String(n.config.table || t?.table || "");
      if (table) out.push(...recordPills(`steps.${n.id}.output.record`, ctx.fieldsOf(table), group).filter((p) => !p.path.endsWith(".id")));
    }
    if (def?.ports.some((p) => p.error)) out.push({ path: `steps.${n.id}.error`, label: "پیام خطا", group });
  }
  for (const v of [...vars].sort()) out.push({ path: `vars.${v}`, label: v, group: "متغیرها" });
  if (loopBodies(g).has(nodeId)) {
    // the innermost loop above this node
    const loop = g.nodes.find((n) => n.type === "for_each" && before.has(n.id) && edgesFrom(g, n.id, "each").some((e) => e.target === nodeId || upstreamOf(g, nodeId).has(e.target)));
    const group = "مورد جاری";
    if (loop && loop.config.source !== "list") out.push(...recordPills("item", ctx.fieldsOf(String(loop.config.table || t?.table || "")), group));
    else out.push({ path: "item", label: "مورد", group });
    out.push({ path: "item_index", label: "شمارهٔ مورد (از صفر)", group });
  }
  const clock = "زمان";
  out.push(
    { path: "now", label: "اکنون", group: clock },
    { path: "today", label: "امروز", group: clock },
    { path: "today + 3d", label: "سه روز بعد", group: clock },
    { path: "now + 2h", label: "دو ساعت بعد", group: clock },
    { path: "jalali", label: "تاریخ شمسی", group: clock },
    { path: "jalali.month_name", label: "نام ماه شمسی", group: clock },
    { path: "jalali.year", label: "سال شمسی", group: clock },
  );
  return out;
}

/** Writable fields of a table for «مقدارها» (not system, read-only or hidden). */
export function writableFields(fields: FieldLite[] | undefined): FieldLite[] {
  return (fields ?? []).filter((f) => !f.readonly && !f.system && !f.hidden && f.type !== "secret");
}

/** Node types the palette offers, in groups. */
export function paletteGroups(): { group: string; types: NodeType[] }[] {
  const groups: Record<string, NodeType[]> = {};
  for (const t of Object.keys(NODE_TYPES) as NodeType[]) {
    if (t === "trigger") continue;
    (groups[NODE_TYPES[t].group] ??= []).push(t);
  }
  return Object.entries(groups).map(([group, types]) => ({ group, types }));
}

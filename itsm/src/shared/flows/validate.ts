// Checks a flow's graph: shape, one trigger, ports and edges, no cycles (repetition is «برای هر مورد»), reachable
// steps, each node's required settings, field names of the tables it writes, and the data pills it reads (a pill
// naming a step that does not run before it, or an `item` outside a loop). Errors block publishing; warnings are
// shown on the nodes. Pure: the designer shows the problems live, the server refuses to publish with errors.
import type { FlowEdge, FlowGraph, FlowNode, FlowProblem, TriggerConfig } from "./types";
import { FLOW_LIMITS, NODE_TYPES, RULE_OPS, fieldShown, nodeDef, nodeLabel, type ConfigField } from "./nodes";
import { PILL_ROOTS, pillRoot, pillsOf } from "./template";

export interface FieldInfo {
  name: string;
  label: string;
  type: string;
  readonly?: boolean;
  system?: boolean;
}

export interface ValidateContext {
  trigger?: Partial<TriggerConfig> | null;
  /** fields of a table (undefined: the table does not exist); omit to skip table checks */
  fieldsOf?: (table: string) => FieldInfo[] | undefined;
}

const NODE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

export const hasErrors = (problems: FlowProblem[]) => problems.some((p) => p.level === "error");

/** An empty graph with its trigger. */
export function emptyGraph(): FlowGraph {
  return { nodes: [{ id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } }], edges: [] };
}

/** Normalise what a client sent (unknown keys dropped) — throws nothing; the validator reports what is wrong. */
export function cleanGraph(input: unknown): FlowGraph {
  const g = (input && typeof input === "object" ? input : {}) as Partial<FlowGraph>;
  const nodes: FlowNode[] = (Array.isArray(g.nodes) ? g.nodes : []).filter((n) => n && typeof n === "object").map((n) => {
    const node: FlowNode = { id: String(n.id ?? ""), type: n.type, config: n.config && typeof n.config === "object" && !Array.isArray(n.config) ? n.config : {} };
    if (typeof n.label === "string" && n.label.trim()) node.label = n.label.trim().slice(0, 80);
    if (n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y)) node.position = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    return node;
  });
  const edges: FlowEdge[] = (Array.isArray(g.edges) ? g.edges : []).filter((e) => e && typeof e === "object").map((e) => {
    const edge: FlowEdge = { id: String(e.id ?? ""), source: String(e.source ?? ""), target: String(e.target ?? "") };
    if (e.port && e.port !== "out") edge.port = String(e.port);
    return edge;
  });
  const out: FlowGraph = { nodes, edges };
  if (g.layout?.direction === "RL" || g.layout?.direction === "TB") out.layout = { direction: g.layout.direction };
  return out;
}

/** Outgoing edges per node and port. */
export function edgesFrom(graph: FlowGraph, node: string, port?: string): FlowEdge[] {
  return graph.edges.filter((e) => e.source === node && (port === undefined || (e.port ?? "out") === port));
}

/** Node ids reachable from `start` (inclusive). */
function reach(graph: FlowGraph, starts: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.source === id) stack.push(e.target);
  }
  return seen;
}

/** Ids of the nodes that run before `id` on some path (its ancestors). */
export function upstreamOf(graph: FlowGraph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.target === cur && !seen.has(e.source)) {
        seen.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return seen;
}

/** Nodes inside a «برای هر مورد» body (reachable from an `each` port): they may read {{item}}. */
export function loopBodies(graph: FlowGraph): Set<string> {
  const starts = graph.edges.filter((e) => e.port === "each" && graph.nodes.find((n) => n.id === e.source)?.type === "for_each").map((e) => e.target);
  return reach(graph, starts);
}

function findCycleEdge(graph: FlowGraph): FlowEdge | null {
  const state = new Map<string, 1 | 2>();
  const out = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  let found: FlowEdge | null = null;
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      if (found) return;
      const s = state.get(e.target);
      if (s === 1) {
        found = e;
        return;
      }
      if (!s) visit(e.target);
    }
    state.set(id, 2);
  };
  for (const n of graph.nodes) if (!state.get(n.id) && !found) visit(n.id);
  return found;
}

/** The table a node works on: its own setting, or the trigger's table. */
export function nodeTable(config: Record<string, unknown>, trigger?: Partial<TriggerConfig> | null, key = "table"): string {
  const own = typeof config[key] === "string" ? (config[key] as string).trim() : "";
  return own || (trigger?.table ?? "") || "";
}

const ruleOps = new Set<string>(RULE_OPS.map((o) => o.value));

function checkField(f: ConfigField, node: FlowNode, vctx: ValidateContext, add: (level: FlowProblem["level"], message: string, field?: string) => void) {
  const v = node.config[f.key];
  if (f.required && isEmpty(v)) {
    add("error", `«${f.label}» را وارد کنید`, f.key);
    return;
  }
  if (isEmpty(v)) return;
  switch (f.kind) {
    case "values": {
      if (typeof v !== "object" || Array.isArray(v)) return add("error", `«${f.label}» معتبر نیست`, f.key);
      const table = nodeTable(node.config, vctx.trigger, f.tableKey ?? "table");
      const fields = table && vctx.fieldsOf ? vctx.fieldsOf(table) : undefined;
      if (!fields) return;
      for (const name of Object.keys(v as object)) {
        const fd = fields.find((x) => x.name === name);
        if (!fd) add("error", `فیلد «${name}» در این جدول نیست`, f.key);
        else if (fd.readonly || fd.system) add("error", `فیلد «${fd.label}» فقط‌خواندنی است`, f.key);
      }
      return;
    }
    case "rules": {
      if (!Array.isArray(v)) return add("error", `«${f.label}» معتبر نیست`, f.key);
      for (const r of v as { left?: unknown; op?: unknown }[]) {
        if (isEmpty(r?.left)) add("error", "سمت چپ هر مقایسه را وارد کنید", f.key);
        if (!ruleOps.has(String(r?.op ?? ""))) add("error", "نوع مقایسه معتبر نیست", f.key);
      }
      return;
    }
    case "assignments":
    case "mappings": {
      if (!Array.isArray(v)) return add("error", `«${f.label}» معتبر نیست`, f.key);
      const names = new Set<string>();
      for (const a of v as { name?: unknown; path?: unknown }[]) {
        const name = String(a?.name ?? "").trim();
        if (!VAR_NAME.test(name)) add("error", `نام «${name || "خالی"}» معتبر نیست (حروف لاتین، رقم و _)`, f.key);
        else if (names.has(name)) add("error", `نام «${name}» تکراری است`, f.key);
        names.add(name);
        if (f.kind === "mappings" && isEmpty(a?.path)) add("error", `مسیر «${name}» را وارد کنید`, f.key);
      }
      return;
    }
    case "keyvalues": {
      if (!Array.isArray(v)) return add("error", `«${f.label}» معتبر نیست`, f.key);
      for (const a of v as { key?: unknown }[]) if (!/^[A-Za-z0-9_.-]{1,80}$/.test(String(a?.key ?? ""))) add("error", `نام «${String(a?.key ?? "")}» در «${f.label}» معتبر نیست`, f.key);
      return;
    }
    case "recipients": {
      const r = v as { users?: unknown[]; fields?: unknown[]; groups?: unknown[] };
      if (![r.users, r.fields, r.groups].some((x) => Array.isArray(x) && x.length)) add("error", `«${f.label}» را مشخص کنید`, f.key);
      return;
    }
    case "duration": {
      const d = v as { amount?: unknown; unit?: unknown };
      const amount = Number(d.amount);
      if (!Number.isFinite(amount) || amount <= 0) add("error", `«${f.label}» باید بیشتر از صفر باشد`, f.key);
      if (!["minute", "hour", "day", "week"].includes(String(d.unit ?? ""))) add("error", `واحد «${f.label}» معتبر نیست`, f.key);
      return;
    }
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) add("error", `«${f.label}» باید عددی مثبت باشد`, f.key);
      return;
    }
    case "select": {
      if (f.options && !f.options.some((o) => o.value === v)) add("error", `«${f.label}» معتبر نیست`, f.key);
      return;
    }
    case "table": {
      if (typeof v !== "string") return add("error", `«${f.label}» معتبر نیست`, f.key);
      if (vctx.fieldsOf && !vctx.fieldsOf(v)) add("error", `جدول «${v}» وجود ندارد`, f.key);
      return;
    }
  }
}

/** Every problem of a graph (errors block publishing). */
export function validateGraph(input: unknown, vctx: ValidateContext = {}): FlowProblem[] {
  const problems: FlowProblem[] = [];
  const graph = cleanGraph(input);
  if (!input || typeof input !== "object" || !Array.isArray((input as FlowGraph).nodes) || !Array.isArray((input as FlowGraph).edges)) {
    return [{ level: "error", message: "طرح گردش‌کار معتبر نیست" }];
  }
  if (graph.nodes.length > FLOW_LIMITS.nodes) problems.push({ level: "error", message: `گردش‌کار بیش از ${FLOW_LIMITS.nodes} گام دارد` });
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (!NODE_ID.test(n.id)) problems.push({ level: "error", node: n.id, message: "شناسهٔ گام معتبر نیست" });
    else if (ids.has(n.id)) problems.push({ level: "error", node: n.id, message: "شناسهٔ گام تکراری است" });
    ids.add(n.id);
    if (!nodeDef(n.type)) problems.push({ level: "error", node: n.id, message: `نوع گام «${String(n.type)}» شناخته نیست` });
  }
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) problems.push({ level: "error", message: triggers.length ? "گردش‌کار فقط یک گام «شروع» دارد" : "گام «شروع» پیدا نشد" });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const edgeIds = new Set<string>();
  const portUse = new Map<string, number>();
  const pairs = new Set<string>();
  for (const e of graph.edges) {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    if (!e.id || edgeIds.has(e.id)) problems.push({ level: "error", edge: e.id, message: "شناسهٔ اتصال تکراری یا خالی است" });
    edgeIds.add(e.id);
    if (!src || !dst) {
      problems.push({ level: "error", edge: e.id, message: "اتصال به گامی ناموجود اشاره می‌کند" });
      continue;
    }
    if (e.source === e.target) problems.push({ level: "error", edge: e.id, node: e.source, message: "گامی به خودش وصل شده است" });
    if (dst.type === "trigger") problems.push({ level: "error", edge: e.id, node: dst.id, message: "به «شروع» نمی‌توان وصل شد" });
    const def = nodeDef(src.type);
    const port = e.port ?? "out";
    const pd = def?.ports.find((p) => p.key === port);
    if (def && !pd) problems.push({ level: "error", edge: e.id, node: src.id, message: `«${nodeLabel(src)}» خروجی «${port}» ندارد` });
    const pair = `${e.source}|${port}|${e.target}`;
    if (pairs.has(pair)) problems.push({ level: "error", edge: e.id, message: "این اتصال تکراری است" });
    pairs.add(pair);
    const k = `${e.source}|${port}`;
    portUse.set(k, (portUse.get(k) ?? 0) + 1);
    if (pd && !pd.multi && portUse.get(k) === 2) problems.push({ level: "error", node: src.id, edge: e.id, message: `از خروجی «${pd.label}» فقط یک اتصال می‌رود؛ برای چند مسیر هم‌زمان از «اجرای موازی» استفاده کنید` });
  }
  const cycle = findCycleEdge(graph);
  if (cycle) problems.push({ level: "error", edge: cycle.id, node: cycle.target, message: "این اتصال دور می‌سازد؛ برای تکرار از «برای هر مورد» یا «انتظار برای شرط» استفاده کنید" });

  const trigger = triggers[0];
  const reachable = trigger ? reach(graph, [trigger.id]) : new Set<string>();
  if (trigger && !edgesFrom(graph, trigger.id).length) problems.push({ level: "warning", node: trigger.id, message: "پس از «شروع» گامی نیامده است" });
  const loops = loopBodies(graph);

  for (const n of graph.nodes) {
    const def = nodeDef(n.type);
    if (!def) continue;
    const add = (level: FlowProblem["level"], message: string, field?: string) => problems.push({ level, node: n.id, message, ...(field ? { field } : {}) });
    if (n.type !== "trigger" && !reachable.has(n.id)) add("warning", "این گام به مسیر گردش‌کار وصل نیست و اجرا نمی‌شود");
    for (const f of def.fields) if (fieldShown(f, n.config)) checkField(f, n, vctx, add);
    const outs = edgesFrom(graph, n.id);
    const ins = graph.edges.filter((e) => e.target === n.id);
    // the table a record step works on: its own, or the trigger's
    const needsTable =
      ["update_record", "add_comment", "wait_condition"].includes(n.type) ||
      (n.type === "branch" && (n.config.mode ?? "record") === "record") ||
      (n.type === "for_each" && (n.config.source ?? "query") === "query");
    if (needsTable && !nodeTable(n.config, vctx.trigger)) add("error", "جدول را انتخاب کنید", "table");
    if (n.type === "branch" && (n.config.mode ?? "record") === "record" && isEmpty(n.config.condition)) add("error", "شرط را وارد کنید", "condition");
    if (n.type === "branch" && n.config.mode === "data" && isEmpty(n.config.rules)) add("error", "دست‌کم یک مقایسه لازم است", "rules");
    if (n.type === "for_each" && n.config.source === "list" && isEmpty(n.config.list)) add("error", "فهرست را وارد کنید", "list");
    if (n.type === "for_each") {
      const limit = Number(n.config.limit ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > FLOW_LIMITS.items) add("error", `حداکثر تعداد باید میان ۱ و ${FLOW_LIMITS.items} باشد`, "limit");
      if (!outs.some((e) => e.port === "each")) add("warning", "خروجی «هر مورد» به گامی وصل نیست");
    }
    if (n.type === "wait_duration") {
      if ((n.config.mode ?? "duration") === "duration" && isEmpty(n.config.duration)) add("error", "مدت انتظار را وارد کنید", "duration");
    }
    if (n.type === "call_http" && n.config.timeout !== undefined) {
      const t = Number(n.config.timeout);
      if (!Number.isFinite(t) || t < 1 || t > 60) add("error", "مهلت باید میان ۱ و ۶۰ ثانیه باشد", "timeout");
    }
    if (n.type === "join" && ins.length < 2) add("warning", "«پیوستن شاخه‌ها» دست‌کم دو ورودی لازم دارد");
    if (n.type === "parallel" && outs.length < 2) add("warning", "«اجرای موازی» دست‌کم دو شاخه لازم دارد");
    // data pills
    for (const expr of pillsOf(n.config)) {
      const { root, step } = pillRoot(expr);
      if (!(PILL_ROOTS as readonly string[]).includes(root)) {
        add("warning", `دادهٔ «${expr}» شناخته نیست`);
        continue;
      }
      if (root === "steps") {
        if (!step || !byId.has(step)) add("error", `گام «${step ?? ""}» در «${expr}» وجود ندارد`);
        else if (!upstreamOf(graph, n.id).has(step)) add("warning", `گام «${nodeLabel(byId.get(step)!)}» پیش از این گام اجرا نمی‌شود`);
      }
      if ((root === "item" || root === "item_index") && !loops.has(n.id)) add("warning", "«مورد جاری» فقط درون «برای هر مورد» معنا دارد");
      if (root === "trigger" && expr.startsWith("trigger.record") && vctx.trigger && !vctx.trigger.table && vctx.trigger.kind !== "record") {
        add("warning", "این گردش‌کار با رکوردی آغاز نمی‌شود؛ «رکورد شروع‌کننده» فقط در اجرای آزمایشی یا دستی با رکورد پر است");
      }
    }
  }
  for (const n of graph.nodes) if (n.label && n.label.length > 80) problems.push({ level: "error", node: n.id, message: "نام گام بیش از ۸۰ نویسه است" });
  // keep one copy of each message per node
  const seen = new Set<string>();
  return problems.filter((p) => {
    const k = `${p.level}|${p.node ?? ""}|${p.edge ?? ""}|${p.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Problems of the trigger settings (the flow record's fields), Persian. */
export function triggerProblems(t: Partial<TriggerConfig>, vctx: Pick<ValidateContext, "fieldsOf"> = {}): FlowProblem[] {
  const out: FlowProblem[] = [];
  const add = (message: string, field?: string) => out.push({ level: "error", message, ...(field ? { field } : {}) });
  if (t.kind === "record") {
    if (!t.table) add("جدول رویداد را انتخاب کنید", "trigger_table");
    if (!t.events?.length) add("دست‌کم یک رویداد را انتخاب کنید", "trigger_events");
    if (t.table && vctx.fieldsOf) {
      const fields = vctx.fieldsOf(t.table);
      if (!fields) add(`جدول «${t.table}» وجود ندارد`, "trigger_table");
      else for (const f of t.fields ?? []) if (!fields.some((x) => x.name === f)) add(`فیلد «${f}» در این جدول نیست`, "trigger_fields");
    }
  }
  if (t.kind === "catalog" && !t.catalog_item) add("قلم کاتالوگ را مشخص کنید", "catalog_item");
  if (t.run_as === "user" && !t.run_as_user) add("کاربری را که گردش‌کار با دسترسی او اجرا می‌شود انتخاب کنید", "run_as_user");
  return out;
}

export { NODE_TYPES };

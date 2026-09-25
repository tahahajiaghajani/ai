/**
 * Knowledge-graph model shared by the server (building) and the browser (rendering).
 * Two sources are merged into one graph:
 *  - the app database: projects (root tasks), related tasks, requesters, uploaded files, knowledge items and their tags
 *  - graphify output (`graphify-out/graph.json` in each task folder of the workspace repo):
 *    files, code symbols, documents, concepts and the relations between them
 */

export type GraphKind =
  | "project"
  | "task"
  | "requester"
  | "file"
  | "knowledge"
  | "tag"
  | "code"
  | "document"
  | "paper"
  | "image"
  | "concept"
  | "rationale"
  | "entity";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphKind;
  /** task this node belongs to (for links to the task page) */
  taskId?: string;
  taskCode?: string;
  /** path inside the task folder / workspace repo */
  path?: string;
  url?: string;
  /** graphify community (cluster) */
  group?: string;
  detail?: string;
  /** graphify node (vs. app database node) */
  graphify?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const KIND_META: Record<GraphKind, { label: string; color: string }> = {
  project: { label: "پروژه", color: "#7c5cff" },
  task: { label: "تسک مرتبط", color: "#a78bfa" },
  requester: { label: "تسک‌دهنده", color: "#f59e0b" },
  file: { label: "فایل", color: "#0ea5e9" },
  knowledge: { label: "دانش", color: "#10b981" },
  tag: { label: "برچسب", color: "#14b8a6" },
  code: { label: "کد", color: "#f97316" },
  document: { label: "سند", color: "#3b82f6" },
  paper: { label: "مقاله", color: "#06b6d4" },
  image: { label: "تصویر", color: "#ec4899" },
  concept: { label: "مفهوم", color: "#8b5cf6" },
  rationale: { label: "استدلال", color: "#eab308" },
  entity: { label: "موجودیت", color: "#94a3b8" },
};

const RELATION_FA: Record<string, string> = {
  // app database
  requested: "درخواست داده",
  continuation: "ادامه‌ی تسک",
  rejection: "رد خاتمه",
  clarification: "توضیح تکمیلی",
  revision: "اصلاحیه",
  other: "مرتبط",
  child: "تسک مرتبط",
  file_request: "فایل درخواست",
  file_prework: "فایل پیش‌کار",
  file_main: "فایل کار اصلی",
  file_output: "خروجی",
  file_upgrade: "فایل ارتقا",
  knowledge: "دانش استخراج‌شده",
  tagged: "برچسب",
  has_file: "فایل پروژه",
  // graphify
  contains: "شامل",
  calls: "فراخوانی",
  indirect_call: "فراخوانی غیرمستقیم",
  imports: "وارد می‌کند",
  imports_from: "وارد می‌کند از",
  re_exports: "صادر مجدد",
  references: "ارجاع می‌دهد",
  cites: "استناد می‌کند",
  implements: "پیاده‌سازی می‌کند",
  defines: "تعریف می‌کند",
  uses: "استفاده می‌کند",
  instantiates: "نمونه می‌سازد",
  depends_on: "وابسته است",
  includes: "شامل می‌شود",
  method: "متد",
  rationale_for: "دلیلِ",
  conceptually_related_to: "ارتباط مفهومی",
  semantically_similar_to: "شباهت معنایی",
  shares_data_with: "اشتراک داده",
  participate_in: "مشارکت در",
  implement: "پیاده‌سازی",
  form: "تشکیل می‌دهد",
};

export function relationLabel(relation: string): string {
  return RELATION_FA[relation] ?? relation.replace(/_/g, " ");
}

const GRAPHIFY_KIND: Record<string, GraphKind> = {
  code: "code",
  document: "document",
  doc_ref: "document",
  paper: "paper",
  image: "image",
  concept: "concept",
  rationale: "rationale",
};

function basename(p: string) {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function endpoint(v: unknown): string | null {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (v && typeof v === "object" && "id" in v) return String((v as { id: unknown }).id);
  return null;
}

/**
 * Converts graphify's graph.json (NetworkX node-link data: `nodes` + `links`/`edges`) into graph
 * nodes scoped to one task folder. Every symbol hangs off the node of the file it came from, and
 * every file hangs off the project node, so projects → files → contents read as one tree plus
 * graphify's own cross-links.
 */
export function parseGraphify(
  raw: unknown,
  opts: { prefix: string; rootId: string; taskId?: string; taskCode?: string; fileUrl?: (path: string) => string; maxNodes?: number },
): GraphData {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? (obj.nodes as Record<string, unknown>[]) : [];
  const rawLinks = (Array.isArray(obj.links) ? obj.links : Array.isArray(obj.edges) ? obj.edges : []) as Record<string, unknown>[];
  const max = opts.maxNodes ?? 600;
  const id = (x: string) => `${opts.prefix}:${x}`;

  // Keep the best-connected nodes when the graph is too large to draw.
  let keep = rawNodes;
  if (rawNodes.length > max) {
    const degree = new Map<string, number>();
    for (const l of rawLinks) {
      for (const e of [endpoint(l.source), endpoint(l.target)]) if (e) degree.set(e, (degree.get(e) ?? 0) + 1);
    }
    keep = [...rawNodes].sort((a, b) => (degree.get(String(b.id)) ?? 0) - (degree.get(String(a.id)) ?? 0)).slice(0, max);
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seenLinks = new Set<string>();
  const addLink = (source: string, target: string, relation: string) => {
    if (source === target) return;
    const key = `${source}|${target}|${relation}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push({ source, target, relation });
  };

  const known = new Set<string>();
  const fileNodeOf = new Map<string, string>(); // source_file -> node id representing that file
  for (const n of keep) {
    const rawId = endpoint(n.id);
    if (!rawId) continue;
    const path = typeof n.source_file === "string" && n.source_file ? n.source_file : undefined;
    const label = String(n.label ?? n.name ?? rawId);
    const kind = GRAPHIFY_KIND[String(n.file_type ?? "")] ?? "entity";
    const community = n.community_name ?? (n.community !== null && n.community !== undefined ? `خوشه ${n.community}` : undefined);
    const isFile = !!path && (label === path || label === basename(path));
    nodes.push({
      id: id(rawId),
      label,
      kind: isFile ? "file" : kind,
      path,
      url: path && opts.fileUrl ? opts.fileUrl(path) : undefined,
      group: community ? String(community) : undefined,
      detail: typeof n.rationale === "string" ? n.rationale : typeof n.source_location === "string" ? n.source_location : undefined,
      taskId: opts.taskId,
      taskCode: opts.taskCode,
      graphify: true,
    });
    known.add(id(rawId));
    if (isFile && path && !fileNodeOf.has(path)) fileNodeOf.set(path, id(rawId));
  }

  // Files that only appear as `source_file` of symbols get their own node.
  for (const n of nodes) {
    if (!n.path || fileNodeOf.has(n.path)) continue;
    const fid = id(`file:${n.path}`);
    fileNodeOf.set(n.path, fid);
    nodes.push({ id: fid, label: basename(n.path), kind: "file", path: n.path, url: opts.fileUrl?.(n.path), taskId: opts.taskId, taskCode: opts.taskCode, graphify: true });
    known.add(fid);
  }

  for (const [, fid] of fileNodeOf) addLink(opts.rootId, fid, "has_file");
  for (const n of nodes) {
    if (n.kind === "file" || !n.path) continue;
    addLink(fileNodeOf.get(n.path)!, n.id, "contains");
  }

  for (const l of rawLinks) {
    const s = endpoint(l.source);
    const t = endpoint(l.target);
    if (!s || !t || !known.has(id(s)) || !known.has(id(t))) continue;
    addLink(id(s), id(t), String(l.relation ?? l.type ?? "related"));
  }

  return { nodes, links };
}

export interface TaskLite {
  id: string;
  code: string;
  title: string;
  status: string;
  root_id: string | null;
  parent_id: string | null;
  relation_type: string | null;
  requester_id: string;
  github_path: string | null;
}
export interface ProfileLite {
  id: string;
  full_name: string | null;
  email: string | null;
}
export interface FileLite {
  id: string;
  task_id: string | null;
  name: string;
  context: string;
  github_path: string | null;
}
export interface KnowledgeLite {
  id: string;
  metadata: { title?: string; kind?: string; tags?: string[]; task_id?: string; task_code?: string } | null;
}

export const taskNodeId = (taskId: string) => `task:${taskId}`;

/** Projects, related tasks, requesters, files and knowledge from the app database. */
export function buildOverview(input: { tasks: TaskLite[]; profiles: ProfileLite[]; files: FileLite[]; knowledge: KnowledgeLite[]; fileUrl?: (path: string) => string }): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const ids = new Set<string>();
  const add = (n: GraphNode) => {
    if (ids.has(n.id)) return;
    ids.add(n.id);
    nodes.push(n);
  };
  const names = new Map(input.profiles.map((p) => [p.id, p.full_name || p.email || "تسک‌دهنده"]));
  const byId = new Map(input.tasks.map((t) => [t.id, t]));

  for (const t of input.tasks) {
    const root = !t.root_id || t.root_id === t.id;
    add({ id: taskNodeId(t.id), label: `${t.code} · ${t.title}`, kind: root ? "project" : "task", taskId: t.id, taskCode: t.code, path: t.github_path ?? undefined, url: t.github_path ? input.fileUrl?.(t.github_path) : undefined, detail: t.status });
  }
  for (const t of input.tasks) {
    const parent = t.parent_id ?? (t.root_id && t.root_id !== t.id ? t.root_id : null);
    if (parent && byId.has(parent)) links.push({ source: taskNodeId(parent), target: taskNodeId(t.id), relation: t.relation_type ?? "child" });
    const parentRequester = parent ? byId.get(parent)?.requester_id : undefined;
    if (!parent || parentRequester !== t.requester_id) {
      const uid = `user:${t.requester_id}`;
      add({ id: uid, label: names.get(t.requester_id) ?? "تسک‌دهنده", kind: "requester" });
      links.push({ source: uid, target: taskNodeId(t.id), relation: "requested" });
    }
  }
  for (const f of input.files) {
    if (!f.task_id || !ids.has(taskNodeId(f.task_id))) continue;
    const task = byId.get(f.task_id);
    add({ id: `tf:${f.id}`, label: f.name, kind: "file", taskId: f.task_id, taskCode: task?.code, path: f.github_path ?? undefined, url: f.github_path ? input.fileUrl?.(f.github_path) : undefined, detail: f.context });
    links.push({ source: taskNodeId(f.task_id), target: `tf:${f.id}`, relation: `file_${f.context}` });
  }
  for (const k of input.knowledge) {
    const m = k.metadata ?? {};
    const kid = `kn:${k.id}`;
    add({ id: kid, label: m.title || "دانش", kind: "knowledge", taskId: m.task_id, taskCode: m.task_code, detail: m.kind });
    if (m.task_id && ids.has(taskNodeId(m.task_id))) links.push({ source: taskNodeId(m.task_id), target: kid, relation: "knowledge" });
    for (const tag of (m.tags ?? []).slice(0, 8)) {
      const clean = String(tag).trim();
      if (!clean) continue;
      const tid = `tag:${clean.toLowerCase()}`;
      add({ id: tid, label: `#${clean}`, kind: "tag" });
      links.push({ source: kid, target: tid, relation: "tagged" });
    }
  }
  return { nodes, links };
}

/** Union of graphs; later duplicates of a node id are ignored. */
export function mergeGraphs(...graphs: GraphData[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  for (const g of graphs) for (const n of g.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  for (const g of graphs)
    for (const l of g.links) {
      const key = `${l.source}|${l.target}|${l.relation}`;
      if (seen.has(key) || !nodes.has(l.source) || !nodes.has(l.target)) continue;
      seen.add(key);
      links.push(l);
    }
  return { nodes: [...nodes.values()], links };
}

/**
 * Nodes reachable from a project without walking through shared hubs (tags, requesters),
 * so one project's view does not pull in every other project.
 */
export function projectSubgraph(g: GraphData, projectNodeId: string): GraphData {
  const adj = new Map<string, string[]>();
  for (const l of g.links) {
    adj.set(l.source, [...(adj.get(l.source) ?? []), l.target]);
    adj.set(l.target, [...(adj.get(l.target) ?? []), l.source]);
  }
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const keep = new Set<string>([projectNodeId]);
  const queue = [projectNodeId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (keep.has(next)) continue;
      keep.add(next);
      const k = kind.get(next);
      if (k !== "tag" && k !== "requester" && k !== "project") queue.push(next);
    }
  }
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), links: g.links.filter((l) => keep.has(l.source) && keep.has(l.target)) };
}

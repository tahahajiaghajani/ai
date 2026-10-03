/**
 * Knowledge-graph model shared by the server (building) and the browser (rendering).
 * Two sources are merged into one graph:
 *  - the app's own map of each project: its files (with the main symbols) and which file imports
 *    which, plus the tasks that worked on the project
 *  - graphify output (`.taskflow/graph/graph.json` of each project in the user's repo):
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
  /** project this node belongs to (for links to the project page) */
  projectId?: string;
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
  task: { label: "تسک", color: "#a78bfa" },
  requester: { label: "شخص", color: "#f59e0b" },
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
  worked_on: "روی پروژه کار کرد",
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
  opts: { prefix: string; rootId: string; projectId?: string; taskId?: string; taskCode?: string; fileUrl?: (path: string) => string; maxNodes?: number },
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
      projectId: opts.projectId,
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
    nodes.push({ id: fid, label: basename(n.path), kind: "file", path: n.path, url: opts.fileUrl?.(n.path), taskId: opts.taskId, taskCode: opts.taskCode, projectId: opts.projectId, graphify: true });
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

export const taskNodeId = (taskId: string) => `task:${taskId}`;
export const projectNodeId = (projectId: string) => `proj:${projectId}`;

export interface ProjectLite {
  id: string;
  name: string;
  slug: string;
  root_path: string;
}
export interface ProjectFileLite {
  project_id: string;
  path: string;
  kind: string;
  summary: string | null;
  symbols: string[];
  imports: string[];
}
export interface TaskLite {
  id: string;
  code: string;
  title: string;
  status: string;
  project_id: string | null;
}

const FILE_KIND: Record<string, GraphKind> = { code: "code", doc: "document", data: "file", asset: "image", other: "file" };

/**
 * Each project with its files, the main symbols of each file and the import links between files
 * (built from the app's own file map — available without graphify), plus the tasks that worked on it.
 */
export function buildProjectsOverview(input: {
  projects: ProjectLite[];
  files: ProjectFileLite[];
  tasks: TaskLite[];
  resolve: (from: string, spec: string, paths: Set<string>) => string | null;
  fileUrl?: (project: ProjectLite, path: string) => string;
  maxFilesPerProject?: number;
}): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const max = input.maxFilesPerProject ?? 400;
  for (const p of input.projects) {
    const pid = projectNodeId(p.id);
    nodes.push({ id: pid, label: p.name, kind: "project", projectId: p.id, path: p.root_path });
    const files = input.files.filter((f) => f.project_id === p.id).slice(0, max);
    const paths = new Set(files.map((f) => f.path));
    const fid = (path: string) => `pf:${p.id}:${path}`;
    for (const f of files) {
      nodes.push({ id: fid(f.path), label: basename(f.path), kind: FILE_KIND[f.kind] ?? "file", path: f.path, projectId: p.id, url: input.fileUrl?.(p, f.path), detail: f.summary ?? (f.symbols.length ? f.symbols.slice(0, 6).join("، ") : undefined) });
      links.push({ source: pid, target: fid(f.path), relation: "has_file" });
    }
    for (const f of files) {
      for (const spec of f.imports) {
        const target = input.resolve(f.path, spec, paths);
        if (target && target !== f.path) links.push({ source: fid(f.path), target: fid(target), relation: "imports" });
      }
    }
  }
  const projectIds = new Set(input.projects.map((p) => p.id));
  for (const t of input.tasks) {
    if (!t.project_id || !projectIds.has(t.project_id)) continue;
    nodes.push({ id: taskNodeId(t.id), label: `${t.code} · ${t.title}`, kind: "task", taskId: t.id, taskCode: t.code, projectId: t.project_id, detail: t.status });
    links.push({ source: taskNodeId(t.id), target: projectNodeId(t.project_id), relation: "worked_on" });
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

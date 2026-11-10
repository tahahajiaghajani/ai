// The dependency map (catalogue CMDB-010, CMDB-076): a bounded breadth-first walk over the effective-dated relationships
// around one or more CIs — both ways, or only along what depends on them / what they depend on (each relationship
// type's impact direction says which end depends on the other) — filtered by type and class, at any moment in time.
// The walk runs with system rights over ids only; the result is then cut to what the caller may read: readable CIs
// with the fields they may see, anonymous «محدود» placeholders where a hidden CI keeps a path to a readable one, nothing
// at all where it does not. Overlays count the caller's readable open incidents, problems, findings and drift per CI.
import { CI_STATES } from "@shared/tables/cmdb";
import { dependentSide, impactSteps, type GEdge, type RelTypeInfo } from "@shared/cmdb/logic";
import { CLASS_FAMILIES } from "@shared/cmdb/classes";
import type { MapDirection, MapEdge, MapNode, MapOverlay, MapQuery, MapResult, MapTypeInfo } from "@shared/cmdb/api";
import { tableDef } from "@shared/tables";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import type { Queryable } from "../../db";
import { notFound } from "../../http/errors";
import { aggregate, condEnv, orgSchema, readable } from "../../engine";
import { access } from "../../access/provider";
import { classTree, cmdbConfig, isUuid, relTypes, sysOf, type Row } from "./common";

export interface EdgeRow {
  id: string;
  parent_id: string;
  child_id: string;
  type: string;
  impact_weight: number | null;
  origin_kind: string | null;
  valid_to: string | null;
  hide_on_map: boolean;
}

const STATE_LABEL = new Map(CI_STATES.states.map((s) => [s.value, s.label]));

/** Relationships touching `nodes`, as of an instant (null = now), as the system. */
export async function edgesAround(q: Queryable, ctx: Ctx, nodes: string[], opts: { asOf?: string | null; types?: string[] | null; includeHidden?: boolean } = {}): Promise<EdgeRow[]> {
  if (!nodes.length) return [];
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const def = schema.def("ci_rel") ?? tableDef("ci_rel")!;
  const env = await condEnv(sys);
  const params: unknown[] = [];
  const parts = [readable(sys, def, "r", params, env)];
  params.push(pgArray(nodes));
  parts.push(`(r.parent_id = any($${params.length}::uuid[]) or r.child_id = any($${params.length}::uuid[]))`);
  if (opts.asOf) {
    params.push(opts.asOf);
    const n = params.length;
    parts.push(`(r.valid_from is null or r.valid_from <= $${n}::timestamptz) and (r.valid_to is null or r.valid_to > $${n}::timestamptz)`);
  } else parts.push(`(r.valid_to is null or r.valid_to > now()) and (r.valid_from is null or r.valid_from <= now())`);
  if (!opts.includeHidden) parts.push(`r.hide_on_map is not true`);
  if (opts.types?.length) {
    params.push(pgArray(opts.types));
    parts.push(`r.type = any($${params.length}::text[])`);
  }
  // both ends must be live CIs
  parts.push(`exists (select 1 from sm_cis p where p.id = r.parent_id and p.deleted_at is null) and exists (select 1 from sm_cis c where c.id = r.child_id and c.deleted_at is null)`);
  return q.query<EdgeRow>(
    `select r.id, r.parent_id, r.child_id, r.type, r.impact_weight, r.origin_kind, r.valid_to, r.hide_on_map from sm_ci_rels r where ${parts.join(" and ")} order by r.id limit 20000`,
    params,
  );
}

/** Which neighbours of `u` a walk in `direction` reaches through `e` (both: every relationship). */
export function stepFrom(u: string, e: GEdge, t: RelTypeInfo | undefined, direction: MapDirection): string | null {
  const other = e.parent === u ? e.child : e.child === u ? e.parent : null;
  if (!other || other === u) return null;
  if (direction === "both") return other;
  const steps = impactSteps(e, t);
  // dependents of u: the CIs u's failure reaches; dependencies: the CIs whose failure reaches u
  if (direction === "dependents") return steps.some(([a, b]) => a === u && b === other) ? other : null;
  return steps.some(([a, b]) => a === other && b === u) ? other : null;
}

export interface WalkResult {
  depth: Map<string, number>;
  /** the node each one was reached from (the first time), for paths */
  parent: Map<string, string | null>;
  edges: EdgeRow[];
  /** neighbours not added because of the size limit */
  more: Map<string, number>;
  truncated: boolean;
}

/** A bounded breadth-first walk from `roots` (system rights, ids only). */
export async function walk(q: Queryable, ctx: Ctx, roots: string[], opts: { depth: number; direction: MapDirection; types?: string[] | null; asOf?: string | null; maxNodes: number; includeHidden?: boolean }): Promise<WalkResult> {
  const types = await relTypes(q, ctx);
  const depth = new Map<string, number>(roots.map((r) => [r, 0]));
  const parent = new Map<string, string | null>(roots.map((r) => [r, null]));
  const kept = new Map<string, EdgeRow>();
  const more = new Map<string, number>();
  let frontier = [...roots];
  let truncated = false;
  for (let d = 1; d <= opts.depth && frontier.length; d++) {
    const rows = await edgesAround(q, ctx, frontier, { asOf: opts.asOf, types: opts.types, includeHidden: opts.includeHidden });
    const inFrontier = new Set(frontier);
    const next: string[] = [];
    for (const r of rows) {
      const e: GEdge = { id: r.id, parent: r.parent_id, child: r.child_id, type: r.type, weight: r.impact_weight };
      for (const u of [r.parent_id, r.child_id]) {
        if (!inFrontier.has(u)) continue;
        const v = stepFrom(u, e, types.get(r.type), opts.direction);
        if (!v) continue;
        if (depth.has(v)) {
          kept.set(r.id, r);
          continue;
        }
        if (depth.size >= opts.maxNodes) {
          truncated = true;
          more.set(u, (more.get(u) ?? 0) + 1);
          continue;
        }
        depth.set(v, d);
        parent.set(v, u);
        kept.set(r.id, r);
        next.push(v);
      }
    }
    frontier = next;
  }
  // relationships between nodes already on the map (cross links)
  const all = [...depth.keys()];
  if (all.length > 1) {
    const set = new Set(all);
    for (const r of await edgesAround(q, ctx, all, { asOf: opts.asOf, types: opts.types, includeHidden: opts.includeHidden })) {
      if (set.has(r.parent_id) && set.has(r.child_id) && !kept.has(r.id)) {
        if (opts.direction === "both" || stepFrom(r.parent_id, { id: r.id, parent: r.parent_id, child: r.child_id, type: r.type }, types.get(r.type), opts.direction) || stepFrom(r.child_id, { id: r.id, parent: r.parent_id, child: r.child_id, type: r.type }, types.get(r.type), opts.direction)) kept.set(r.id, r);
      }
    }
  }
  return { depth, parent, edges: [...kept.values()], more, truncated };
}

/** CI rows by id as the system (the columns maps and impact need). */
export async function ciRows(q: Queryable, ctx: Ctx, idList: string[]): Promise<Map<string, Row>> {
  if (!idList.length) return new Map();
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, q);
  const def = schema.def("ci") ?? tableDef("ci")!;
  const env = await condEnv(sys);
  const params: unknown[] = [];
  const where = readable(sys, def, "t", params, env);
  params.push(pgArray(idList));
  const rows = await q.query<Row>(
    `select t.id, t.number, t.name, t.class, t.state, t.operational_status, t.criticality, t.environment, t.health_score, t.is_stale, t.owned_by, t.used_by,
            t.support_group_id, t.supports_critical_function, t.tier
       from ${def.table} t where ${where} and t.id = any($${params.length}::uuid[])`,
    params,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Of `idList`, the CIs the caller may read (one query through the access rule). */
export async function readableCis(q: Queryable, ctx: Ctx, idList: string[]): Promise<Set<string>> {
  if (!idList.length) return new Set();
  if (ctx.actor === "system") return new Set(idList);
  const schema = await orgSchema(ctx, q);
  const def = schema.def("ci") ?? tableDef("ci")!;
  if (!access().canReadTable(ctx, def)) return new Set();
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, def, "t", params, env);
  params.push(pgArray(idList));
  const rows = await q.query<{ id: string }>(`select t.id from ${def.table} t where ${where} and t.id = any($${params.length}::uuid[])`, params);
  return new Set(rows.map((r) => r.id));
}

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const OPEN: Cond = { f: "active", op: "eq", v: true };

/** Counts of a table's open records per CI the caller may read (through the engine's aggregate). */
async function countsBy(ctx: Ctx, table: string, field: string, cis: string[], open: Cond | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const def = tableDef(table);
  if (!def || !def.fields.some((f) => f.name === field) || !cis.length) return out;
  const schema = await orgSchema(ctx);
  const effective = schema.def(table) ?? def;
  if (!access().canReadTable(ctx, effective)) return out;
  const visible = access().visibleFields(ctx, effective);
  if (visible && !visible.has(field)) return out;
  const want = new Set(cis);
  for (const part of chunk(cis, 400)) {
    const filter: Cond = open ? { and: [{ f: field, op: "in", v: part }, open] } : { f: field, op: "in", v: part };
    try {
      const r = await aggregate(ctx, table, { filter, groupBy: [field], metrics: [{ fn: "count" }], limit: 1000 });
      for (const row of r.rows) {
        const key = String(row.keys?.[0] ?? "");
        if (want.has(key)) out.set(key, (out.get(key) ?? 0) + Number(row.values?.count ?? 0));
      }
    } catch {
      // a table the caller may not aggregate adds nothing
    }
  }
  return out;
}

/** Open work on each CI the caller may see (incidents, problems, changes, findings, drift). */
export async function overlays(ctx: Ctx, cis: string[]): Promise<Map<string, MapOverlay>> {
  const out = new Map<string, MapOverlay>();
  const add = (m: Map<string, number>, key: keyof MapOverlay) => {
    for (const [id, n] of m) {
      const o = out.get(id) ?? {};
      o[key] = (o[key] ?? 0) + n;
      out.set(id, o);
    }
  };
  const openTask: Cond = OPEN;
  add(await countsBy(ctx, "incident", "ci_id", cis, openTask), "incidents");
  add(await countsBy(ctx, "incident", "affected_cis", cis, { and: [openTask, { not: { f: "ci_id", op: "in", v: cis.slice(0, 500) } }] }), "incidents");
  add(await countsBy(ctx, "problem", "ci_id", cis, openTask), "problems");
  add(await countsBy(ctx, "change_request", "ci_id", cis, openTask), "changes");
  add(await countsBy(ctx, "cmdb_finding", "ci_id", cis, openTask), "findings");
  add(await countsBy(ctx, "ci_drift", "ci_id", cis, openTask), "drift");
  return out;
}

/** The service records of service CIs the caller may read (ci id → service id). */
async function serviceLinks(q: Queryable, ctx: Ctx, cis: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const def = tableDef("service");
  if (!def || !cis.length) return out;
  const schema = await orgSchema(ctx, q);
  const effective = schema.def("service") ?? def;
  if (ctx.actor !== "system" && !access().canReadTable(ctx, effective)) return out;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, effective, "t", params, env);
  params.push(pgArray(cis));
  for (const r of await q.query<{ id: string; ci_id: string }>(`select t.id, t.ci_id from ${effective.table} t where ${where} and t.ci_id = any($${params.length}::uuid[])`, params)) out.set(r.ci_id, r.id);
  return out;
}

export function typeInfo(types: Map<string, RelTypeInfo>): Record<string, MapTypeInfo> {
  const out: Record<string, MapTypeInfo> = {};
  for (const [k, t] of types) out[k] = { label: t.label, inverse: t.inverse, color: t.color, propagates: t.propagates, impact: t.impact, category: t.category };
  return out;
}

/**
 * Cut a walked graph to what the caller may read: readable nodes get their data, a hidden node stays as an anonymous
 * placeholder only when it lies on the walk's path from a root to a readable node, every other hidden node and its
 * relationships disappear. Placeholder ids are per response («r1», «r2» …), never the CI's id.
 */
export async function redactMap(
  q: Queryable,
  ctx: Ctx,
  w: Pick<WalkResult, "depth" | "parent" | "edges" | "more">,
  roots: string[],
  opts: { overlays?: boolean; asOf?: string | null; truncated?: boolean; severity?: Map<string, { severity: number; absorbed?: boolean }>; countPlaceholdersOnly?: boolean } = {},
): Promise<MapResult> {
  const all = [...w.depth.keys()];
  const rows = await ciRows(q, ctx, all);
  const can = await readableCis(q, ctx, all);
  const tree = await classTree(q, ctx);
  const types = await relTypes(q, ctx);
  // hidden CIs that keep a path: walk up from every readable node to its root
  const needed = new Set<string>();
  for (const id of all) {
    if (!can.has(id)) continue;
    for (let p = w.parent.get(id); p; p = w.parent.get(p) ?? null) if (!can.has(p)) needed.add(p);
  }
  const alias = new Map<string, string>();
  let n = 0;
  for (const id of all) if (!can.has(id) && needed.has(id) && rows.has(id)) alias.set(id, `r${++n}`);
  const keep = (id: string) => (can.has(id) && rows.has(id)) || alias.has(id);
  const outId = (id: string) => alias.get(id) ?? id;
  const visible = access().visibleFields(ctx, (await orgSchema(ctx, q)).def("ci") ?? tableDef("ci")!);
  const show = (f: string) => !visible || visible.has(f);
  const readableIds = all.filter((id) => can.has(id) && rows.has(id));
  const over = opts.overlays ? await overlays(ctx, readableIds) : new Map<string, MapOverlay>();
  const services = await serviceLinks(q, ctx, readableIds);
  const nodes: MapNode[] = [];
  for (const id of all) {
    if (!keep(id)) continue;
    const d = w.depth.get(id) ?? 0;
    const sev = opts.severity?.get(id);
    if (alias.has(id)) {
      nodes.push({ id: alias.get(id)!, restricted: true, depth: d, ...(sev ? { severity: sev.severity, absorbed: sev.absorbed } : {}) });
      continue;
    }
    const r = rows.get(id)!;
    const cls = tree.get(r.class);
    nodes.push({
      id,
      number: r.number ?? null,
      name: r.name,
      class: r.class,
      class_label: tree.label(r.class),
      family: cls?.family ?? "logical",
      icon: cls?.icon ?? CLASS_FAMILIES[cls?.family ?? "logical"]?.icon ?? null,
      state: show("state") ? r.state : null,
      state_label: show("state") ? STATE_LABEL.get(r.state) ?? r.state : null,
      operational_status: show("operational_status") ? r.operational_status ?? null : null,
      criticality: show("criticality") ? r.criticality ?? null : null,
      environment: show("environment") ? r.environment ?? null : null,
      health_score: show("health_score") ? r.health_score ?? null : null,
      is_stale: show("is_stale") ? !!r.is_stale : false,
      depth: d,
      root: roots.includes(id),
      more: w.more.get(id) || undefined,
      overlay: over.get(id),
      service_id: services.get(id) ?? null,
      ...(sev ? { severity: sev.severity, absorbed: sev.absorbed } : {}),
    });
  }
  const edges: MapEdge[] = [];
  for (const r of w.edges) {
    if (!keep(r.parent_id) || !keep(r.child_id)) continue;
    const t = types.get(r.type);
    const side = dependentSide({ id: r.id, parent: r.parent_id, child: r.child_id, type: r.type }, t);
    edges.push({
      id: alias.has(r.parent_id) || alias.has(r.child_id) ? `e${edges.length + 1}` : r.id,
      source: outId(r.parent_id),
      target: outId(r.child_id),
      type: r.type,
      label: t?.label ?? r.type,
      propagates: !!t?.propagates,
      dependent: side ? (side.dependent === r.parent_id ? "source" : "target") : null,
      origin: r.origin_kind,
      weight: r.impact_weight,
      ended: !!r.valid_to && !opts.asOf,
    });
  }
  // hidden CIs of the walk (with a class filter only the placeholders shown: the count must not tell hidden classes)
  const restricted = opts.countPlaceholdersOnly ? alias.size : all.filter((id) => !can.has(id)).length;
  return { nodes, edges, truncated: !!opts.truncated, restricted, as_of: opts.asOf ?? null, types: typeInfo(types) };
}

/** The map around `roots` for the caller (404 when they may not read a root). */
export async function dependencyMap(ctx: Ctx, query: MapQuery): Promise<MapResult> {
  const q = ctx.db;
  const roots = [...new Set(query.roots.filter(isUuid).map((x) => x.toLowerCase()))].slice(0, 20);
  if (!roots.length) throw notFound("پیکربندی پیدا نشد");
  const can = await readableCis(q, ctx, roots);
  if (roots.some((r) => !can.has(r))) throw notFound("پیکربندی پیدا نشد");
  const cfg = await cmdbConfig(q, ctx);
  const maxNodes = Math.max(10, Math.min(query.max_nodes ?? cfg.map_max_nodes, 2000));
  const depth = Math.max(1, Math.min(6, query.depth ?? 2));
  const asOf = query.as_of && !Number.isNaN(Date.parse(query.as_of)) ? new Date(query.as_of).toISOString() : null;
  const w = await walk(q, ctx, roots, { depth, direction: query.direction ?? "both", types: query.types?.length ? query.types : null, asOf, maxNodes, includeHidden: query.include_hidden });
  // a class filter keeps the roots and the paths to the readable CIs of those classes (a hidden CI's class is not the
  // caller's to filter by: it stays only as a placeholder on such a path)
  if (query.classes?.length) {
    const tree = await classTree(q, ctx);
    const rows = await ciRows(q, ctx, [...w.depth.keys()]);
    const readable = await readableCis(q, ctx, [...rows.keys()]);
    const wanted = new Set<string>();
    for (const [id, r] of rows) if (readable.has(id) && query.classes.some((c) => tree.isA(r.class, c))) wanted.add(id);
    const keep = new Set(roots);
    for (const id of wanted) for (let p: string | null | undefined = id; p; p = w.parent.get(p)) keep.add(p);
    for (const id of [...w.depth.keys()]) if (!keep.has(id)) w.depth.delete(id);
    w.edges = w.edges.filter((e) => w.depth.has(e.parent_id) && w.depth.has(e.child_id));
  }
  return redactMap(q, ctx, w, roots, { overlays: query.overlays !== false, asOf, truncated: w.truncated, countPlaceholdersOnly: !!query.classes?.length });
}

/** The shortest relationship path between two CIs (both ways, any type), cut to what the caller may read. */
export async function pathBetween(ctx: Ctx, from: string, to: string, maxDepth = 6): Promise<MapResult & { found: boolean }> {
  const q = ctx.db;
  const can = await readableCis(q, ctx, [from, to]);
  if (!can.has(from) || !can.has(to)) throw notFound("پیکربندی پیدا نشد");
  const w = await walk(q, ctx, [from], { depth: maxDepth, direction: "both", maxNodes: 5000 });
  if (!w.depth.has(to)) return { ...(await redactMap(q, ctx, { depth: new Map([[from, 0]]), parent: new Map([[from, null]]), edges: [], more: new Map() }, [from])), found: false };
  const onPath = new Set<string>();
  for (let p: string | null | undefined = to; p; p = w.parent.get(p)) onPath.add(p);
  const depth = new Map([...w.depth].filter(([id]) => onPath.has(id)));
  const parent = new Map([...w.parent].filter(([id]) => onPath.has(id)));
  const edges = w.edges.filter((e) => onPath.has(e.parent_id) && onPath.has(e.child_id) && (w.parent.get(e.parent_id) === e.child_id || w.parent.get(e.child_id) === e.parent_id));
  return { ...(await redactMap(q, ctx, { depth, parent, edges, more: new Map() }, [from])), found: true };
}

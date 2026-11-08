// Impact analysis and what-if simulation (catalogue CMDB-011/012/013, SPF-010): which CIs, services and offerings
// depend on the CIs in a hypothetical (or real) state, how badly, along which path — with redundancy groups absorbing
// failures, relationship weights and every type's impact direction. The subgraph is collected and the severities are
// computed with system rights (so the answer is right), then everything shown is cut to what the caller may read:
// hidden CIs are counted, never named. Incidents, problems and changes use `servicesImpactedBy` to fill their affected
// services; the AI layer's graph tools call `impactAnalysis` with the asking member's context.
import { propagate, impactPath, STATE_SEVERITY, type GEdge, type Redundancy, type SimState } from "@shared/cmdb/logic";
import type { ImpactQuery, ImpactResult, ImpactedCi, ImpactedService } from "@shared/cmdb/api";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import type { Queryable } from "../../db";
import { bad, notFound } from "../../http/errors";
import { condEnv, orgSchema, readable } from "../../engine";
import { access } from "../../access/provider";
import { classTree, cmdbConfig, isUuid, liveRows, relTypes, sysOf, type Row } from "./common";
import { ciRows, edgesAround, readableCis, redactMap, type EdgeRow } from "./graph";

/** The service family classes (their CIs are the services and offerings impact reaches). */
export const SERVICE_CLASSES = ["service", "business_service", "technical_service", "application_service", "offering"];

export interface ImpactGraph {
  hits: ReturnType<typeof propagate>;
  edges: Map<string, EdgeRow>;
  parent: Map<string, string | null>;
}

/**
 * Collect the propagation subgraph from `sources` (system rights) and compute severities. Redundancy clusters reached
 * on the way bring all of their members' «عضوِ» relationships, so «how many are still up» is exact.
 */
export async function computeImpact(q: Queryable, ctx: Ctx, sources: Map<string, number>, opts: { depth: number; asOf?: string | null }): Promise<ImpactGraph> {
  const types = await relTypes(q, ctx);
  const propagating = [...types.values()].filter((t) => t.propagates && t.impact !== "none").map((t) => t.key);
  const edges = new Map<string, EdgeRow>();
  const seen = new Set(sources.keys());
  let frontier = [...sources.keys()];
  for (let d = 0; d < opts.depth && frontier.length; d++) {
    const rows = await edgesAround(q, ctx, frontier, { asOf: opts.asOf, types: propagating, includeHidden: true });
    const inFrontier = new Set(frontier);
    const next: string[] = [];
    for (const r of rows) {
      const t = types.get(r.type);
      if (!t) continue;
      const steps: [string, string][] = t.impact === "child_to_parent" ? [[r.child_id, r.parent_id]] : t.impact === "parent_to_child" ? [[r.parent_id, r.child_id]] : [[r.child_id, r.parent_id], [r.parent_id, r.child_id]];
      for (const [a, b] of steps) {
        if (!inFrontier.has(a)) continue;
        edges.set(r.id, r);
        if (!seen.has(b)) {
          seen.add(b);
          next.push(b);
        }
      }
    }
    frontier = next;
    if (seen.size > 20_000) break;
  }
  // redundancy groups whose cluster is on the subgraph
  const groups = await liveRows(q, sysOf(ctx), "ci_group", { and: [{ f: "kind", op: "eq", v: "redundancy" }, { f: "active", op: "eq", v: true }, { f: "ci_id", op: "in", v: [...seen].slice(0, 500) }] });
  const redundancy: Redundancy[] = [];
  if (groups.length) {
    const clusters = groups.map((g) => String(g.ci_id));
    for (const r of await edgesAround(q, ctx, clusters, { asOf: opts.asOf, types: ["member_of"], includeHidden: true })) if (clusters.includes(r.child_id)) edges.set(r.id, r);
    for (const g of groups) redundancy.push({ cluster: String(g.ci_id), members: Array.isArray(g.members) && g.members.length ? g.members : null, minUp: g.min_up ?? null, minUpPct: g.min_up_pct !== null && g.min_up_pct !== undefined ? Number(g.min_up_pct) : null });
  }
  const gedges: GEdge[] = [...edges.values()].map((r) => ({ id: r.id, parent: r.parent_id, child: r.child_id, type: r.type, weight: r.impact_weight }));
  const hits = propagate(sources, gedges, types, { maxDepth: opts.depth, redundancy });
  const parent = new Map<string, string | null>();
  for (const [id, h] of hits) parent.set(id, h.from);
  return { hits, edges, parent };
}

/** The service records (and offerings) whose CIs are in `cis` — as the given context. */
async function servicesOf(q: Queryable, ctx: Ctx, cis: string[], table: "service" | "service_offering"): Promise<Row[]> {
  const def = tableDef(table);
  if (!def || !cis.length) return [];
  const schema = await orgSchema(ctx, q);
  const effective = schema.def(table) ?? def;
  if (ctx.actor !== "system" && !access().canReadTable(ctx, effective)) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, effective, "t", params, env);
  params.push(pgArray(cis));
  return q.query<Row>(`select t.* from ${effective.table} t where ${where} and t.ci_id = any($${params.length}::uuid[])`, params);
}

/** How many distinct people use or subscribe to what is impacted (numbers only; computed with system rights). */
async function peopleCounts(q: Queryable, ctx: Ctx, cis: Row[], serviceIds: string[]): Promise<{ users: number; subscribers: number }> {
  const users = new Set(cis.flatMap((r) => [r.used_by].filter(isUuid)));
  let subscribers = 0;
  if (serviceIds.length && tableDef("service_subscription")) {
    const subs = await liveRows(q, sysOf(ctx), "service_subscription", { f: "service_id", op: "in", v: serviceIds.slice(0, 500) }, { limit: 5000 });
    const people = new Set<string>();
    const groups = subs.map((s) => s.group_id).filter(isUuid);
    for (const s of subs) if (isUuid(s.user_id)) people.add(s.user_id);
    if (groups.length) {
      const members = await liveRows(q, sysOf(ctx), "group_member", { f: "group_id", op: "in", v: groups }, { limit: 10000 });
      for (const m of members) if (isUuid(m.user_id)) people.add(m.user_id);
    }
    const units = subs.map((s) => s.org_unit_id).filter(isUuid);
    if (units.length) {
      const profiles = await liveRows(q, sysOf(ctx), "member_profile", { f: "org_unit_id", op: "in", v: units }, { limit: 10000 });
      for (const p of profiles) if (isUuid(p.user_id)) people.add(p.user_id);
    }
    subscribers = people.size;
  }
  return { users: users.size, subscribers };
}

/** Impact of CIs in a state, for the caller (CMDB-011, the what-if simulation of CMDB-013). */
export async function impactAnalysis(ctx: Ctx, query: ImpactQuery): Promise<ImpactResult> {
  const q = ctx.db;
  const sourceIds = [...new Set((query.ci_ids ?? []).filter(isUuid).map((x) => x.toLowerCase()))].slice(0, 50);
  if (!sourceIds.length) throw bad("دست‌کم یک پیکربندی انتخاب کنید");
  const can0 = await readableCis(q, ctx, sourceIds);
  if (sourceIds.some((id) => !can0.has(id))) throw notFound("پیکربندی پیدا نشد");
  const state: SimState = query.state && query.state in STATE_SEVERITY ? query.state : "down";
  const cfg = await cmdbConfig(q, ctx);
  const depth = Math.max(1, Math.min(20, query.depth ?? cfg.impact_depth));
  const asOf = query.as_of && !Number.isNaN(Date.parse(query.as_of)) ? new Date(query.as_of).toISOString() : null;
  const g = await computeImpact(q, ctx, new Map(sourceIds.map((id) => [id, STATE_SEVERITY[state]])), { depth, asOf });
  const all = [...g.hits.keys()];
  const rows = await ciRows(q, ctx, all);
  const can = await readableCis(q, ctx, all);
  const tree = await classTree(q, ctx);
  const types = await relTypes(q, ctx);
  const nameOf = (id: string) => (can.has(id) ? String(rows.get(id)?.name ?? "") : "");
  const impacted = all.filter((id) => !sourceIds.includes(id) && rows.has(id));
  const visibleImpacted = impacted.filter((id) => can.has(id));
  const cis: ImpactedCi[] = visibleImpacted
    .map((id) => {
      const r = rows.get(id)!;
      const h = g.hits.get(id)!;
      const p = impactPath(g.hits, id);
      return {
        id,
        number: r.number ?? null,
        name: r.name,
        class: r.class,
        class_label: tree.label(r.class),
        family: tree.family(r.class),
        severity: Math.round(h.severity * 100) / 100,
        depth: h.depth,
        absorbed: h.absorbed || undefined,
        criticality: r.criticality ?? null,
        environment: r.environment ?? null,
        owned_by: r.owned_by ?? null,
        support_group_id: r.support_group_id ?? null,
        path: p.nodes.map((n, i) => {
          const e = i > 0 ? g.edges.get(p.edges[i - 1]) : undefined;
          return can.has(n) ? { id: n, name: nameOf(n), type: e?.type, type_label: e ? types.get(e.type)?.label ?? e.type : undefined } : { id: "", name: "پیکربندی محدود", restricted: true, type: e?.type, type_label: e ? types.get(e.type)?.label ?? e.type : undefined };
        }),
      };
    })
    .sort((a, b) => b.severity - a.severity || a.depth - b.depth || a.name.localeCompare(b.name, "fa"));
  // services and offerings: their records (the caller's access) on the impacted CIs
  const impactedSet = impacted.filter((id) => (g.hits.get(id)?.severity ?? 0) > 0);
  const services: ImpactedService[] = [];
  for (const s of await servicesOf(q, ctx, impactedSet, "service")) {
    services.push({ id: s.id, number: s.number ?? null, name: s.name, kind: "service", tier: s.tier ?? null, owner_id: s.owner_id ?? null, state: s.state ?? null, ci_id: s.ci_id, severity: Math.round((g.hits.get(s.ci_id)?.severity ?? 0) * 100) / 100, on_status_page: !!s.on_status_page });
  }
  for (const o of await servicesOf(q, ctx, impactedSet, "service_offering")) {
    services.push({ id: o.id, number: o.number ?? null, name: o.name, kind: "offering", service_id: o.service_id ?? null, tier: null, owner_id: o.owner_id ?? null, state: o.state ?? null, ci_id: o.ci_id, severity: Math.round((g.hits.get(o.ci_id)?.severity ?? 0) * 100) / 100 });
  }
  services.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "service" ? -1 : 1) || b.severity - a.severity || (a.tier ?? "z").localeCompare(b.tier ?? "z"));
  // counts (system rights for numbers only)
  const sysServices = await servicesOf(q, sysOf(ctx), impactedSet, "service");
  const people = await peopleCounts(q, ctx, impacted.map((id) => rows.get(id)!).filter(Boolean), sysServices.map((s) => s.id));
  const offeringIds = (await servicesOf(q, sysOf(ctx), impactedSet, "service_offering")).map((o) => o.id);
  const commitments = offeringIds.length && tableDef("service_commitment") ? (await liveRows(q, sysOf(ctx), "service_commitment", { and: [{ f: "offering_id", op: "in", v: offeringIds.slice(0, 500) }, { f: "active", op: "eq", v: true }] }, { limit: 5000 })).length : 0;
  const byClass = new Map<string, number>();
  for (const c of cis) byClass.set(c.class, (byClass.get(c.class) ?? 0) + 1);
  const critical = cis.filter((c) => c.criticality === "1" || c.criticality === "2" || rows.get(c.id)?.supports_critical_function).length;
  let openIncidents = 0;
  if (visibleImpacted.length || sourceIds.length) {
    const schema = await orgSchema(ctx, q);
    const inc = schema.def("incident");
    if (inc && access().canReadTable(ctx, inc)) {
      const env = await condEnv(ctx);
      const params: unknown[] = [];
      const where = readable(ctx, inc, "t", params, env);
      params.push(pgArray([...sourceIds, ...visibleImpacted]));
      const r = await q.one<{ n: number | string }>(`select count(*) as n from ${inc.table} t where ${where} and t.active and t.ci_id = any($${params.length}::uuid[])`, params);
      openIncidents = Number(r?.n ?? 0);
    }
  }
  // the blast radius as a map: the propagation tree plus cross links
  const severity = new Map([...g.hits].map(([id, h]) => [id, { severity: Math.round(h.severity * 100) / 100, absorbed: h.absorbed }]));
  const depthMap = new Map([...g.hits].map(([id, h]) => [id, h.depth]));
  const map = await redactMap(q, ctx, { depth: depthMap, parent: g.parent, edges: [...g.edges.values()], more: new Map() }, sourceIds, { overlays: false, asOf, severity });
  return {
    sources: sourceIds.map((id) => ({ id, number: rows.get(id)?.number ?? null, name: String(rows.get(id)?.name ?? ""), class: String(rows.get(id)?.class ?? "") })),
    state,
    cis,
    services,
    counts: {
      cis: impacted.filter((id) => (g.hits.get(id)?.severity ?? 0) > 0).length,
      restricted: impacted.filter((id) => !can.has(id)).length,
      services: services.filter((s) => s.kind === "service").length,
      offerings: services.filter((s) => s.kind === "offering").length,
      critical,
      users: people.users,
      subscribers: people.subscribers,
      commitments,
      open_incidents: openIncidents,
      by_class: [...byClass].map(([c, n]) => ({ class: c, label: tree.label(c), count: n })).sort((a, b) => b.count - a.count),
    },
    map,
    computed_at: new Date().toISOString(),
  };
}

/**
 * The service records impacted when `ciIds` fail (system rights, inside the caller's transaction): what incidents,
 * problems and changes record as their affected services. The CIs themselves count when they are service CIs.
 */
export async function servicesImpactedBy(q: Queryable, ctx: Ctx, ciIds: string[], depth = 8): Promise<string[]> {
  const sources = [...new Set(ciIds.filter(isUuid).map((x) => x.toLowerCase()))].slice(0, 50);
  if (!sources.length || !tableDef("service")) return [];
  const g = await computeImpact(q, ctx, new Map(sources.map((id) => [id, 1])), { depth });
  const reached = [...g.hits].filter(([, h]) => h.source || h.severity > 0).map(([id]) => id);
  const rows = await servicesOf(q, sysOf(ctx), reached, "service");
  return [...new Set(rows.map((r) => String(r.id)))];
}

/** A short Persian summary of an impact result (for saved simulations and assistant answers). */
export function impactText(r: ImpactResult): string {
  const parts = [`${r.counts.cis} پیکربندی`, `${r.counts.services} خدمت`, `${r.counts.offerings} گزینهٔ خدمت`];
  if (r.counts.critical) parts.push(`${r.counts.critical} پیکربندی حیاتی`);
  if (r.counts.subscribers) parts.push(`${r.counts.subscribers} مشترک`);
  if (r.counts.restricted) parts.push(`${r.counts.restricted} پیکربندی محدود`);
  return `متأثر: ${parts.join("، ")}`;
}

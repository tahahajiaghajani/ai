// Facts about one CI as the caller may see them (catalogue CMDB-017/024/044): the CI 360's summary and the AI
// summary's input — identity, ownership, health, relationships by type (only to readable CIs), open work, the services
// it supports — and the multisource view of its attributes: who set each value, when, and what every source reported.
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { get, orgSchema } from "../../engine";
import { access } from "../../access/provider";
import { classTree, isUuid, liveRows, relTypes, type Row } from "./common";
import { edgesAround, overlays, readableCis } from "./graph";
import { servicesImpactedBy } from "./impact";

export async function ciSummaryFacts(ctx: Ctx, id: string): Promise<Record<string, unknown>> {
  const { row, display } = await get(ctx, "ci", id);
  const tree = await classTree(ctx.db, ctx);
  const types = await relTypes(ctx.db, ctx);
  const edges = await edgesAround(ctx.db, ctx, [id]);
  const others = [...new Set(edges.flatMap((e) => [e.parent_id, e.child_id]).filter((x) => x !== id))];
  const can = await readableCis(ctx.db, ctx, others);
  const byType: Record<string, number> = {};
  let hidden = 0;
  for (const e of edges) {
    const other = e.parent_id === id ? e.child_id : e.parent_id;
    if (!can.has(other)) {
      hidden++;
      continue;
    }
    const label = e.parent_id === id ? types.get(e.type)?.label ?? e.type : types.get(e.type)?.inverse ?? e.type;
    byType[label] = (byType[label] ?? 0) + 1;
  }
  const over = (await overlays(ctx, [id])).get(id) ?? {};
  const services = await servicesImpactedBy(ctx.db, ctx, [id]);
  let readableServices: Row[] = [];
  if (services.length && tableDef("service")) readableServices = await liveRows(ctx.db, ctx, "service", { f: "id", op: "in", v: services }, { limit: 20 }).catch(() => []);
  const label = (k: string) => (row[k] && display[row[k] as string]) || row[k] || null;
  return {
    number: row.number, name: row.name, class: tree.label(String(row.class)), state: row.state, operational_status: row.operational_status ?? null,
    environment: row.environment ?? null, criticality: row.criticality ?? null,
    owner: label("owned_by"), support_group: label("support_group_id"), location: label("location_id"),
    identity: { serial_number: row.serial_number ?? null, hostname: row.hostname ?? null, fqdn: row.fqdn ?? null, ip_address: row.ip_address ?? null, os: row.os ?? null, os_version: row.os_version ?? null },
    health: { score: row.health_score ?? null, issues: row.health_issues ?? [] },
    relationships: byType, restricted_relationships: hidden,
    open_work: over,
    supports_services: readableServices.map((s) => ({ number: s.number, name: s.name, tier: s.tier ?? null })),
    supports_services_hidden: Math.max(0, services.length - readableServices.length),
    last_discovered_at: row.last_discovered_at ?? null,
    expires_at: row.expires_at ?? null,
  };
}

export interface ProvenanceRow {
  field: string;
  label: string;
  value: unknown;
  set_by: { source: string; name: string; at: string | null } | null;
  locked: boolean;
  observations: { source: string; name: string; value: unknown; at: string }[];
}

/** Which source set every attribute and what each one reported (CMDB-024), for the fields the caller may see. */
export async function provenance(ctx: Ctx, id: string): Promise<{ rows: ProvenanceRow[]; sources: Record<string, string> }> {
  const { row } = await get(ctx, "ci", id);
  const schema = await orgSchema(ctx);
  const def = schema.def("ci") ?? tableDef("ci")!;
  const visible = access().visibleFields(ctx, def);
  const meta = ((row.attr_meta ?? null) as Record<string, any> | null) ?? {};
  // `get` strips hidden system fields like attr_meta from members' rows: read it as stored (the CI is readable)
  const stored = (await liveRows(ctx.db, ctx, "ci", { f: "id", op: "eq", v: id }, { limit: 1 }))[0];
  const m: Record<string, any> = Object.keys(meta).length ? meta : ((stored?.attr_meta ?? {}) as Record<string, any>);
  const sources = new Map((await liveRows(ctx.db, ctx, "cmdb_data_source", null, { limit: 500 }).catch(() => [] as Row[])).map((s) => [s.id, s.name]));
  const name = (key: string) => (key === "manual" ? "ویرایش دستی" : key === "import" ? "ورود داده" : sources.get(key) ?? "منبع حذف‌شده");
  const tree = await classTree(ctx.db, ctx);
  const cls = tree.resolve(String(row.class));
  const locked = new Set<string>(Array.isArray(stored?.locked_attrs) ? stored.locked_attrs : []);
  const labelOf = (p: string) => (p.startsWith("attrs.") ? cls?.allAttrs.find((a) => a.name === p.slice(6))?.label ?? p.slice(6) : def.fields.find((f) => f.name === p)?.label ?? p);
  const rows: ProvenanceRow[] = [];
  for (const [path, info] of Object.entries(m)) {
    const bare = path.replace(/^attrs\./, "");
    if (!path.startsWith("attrs.") && visible && !visible.has(path)) continue;
    const value = path.startsWith("attrs.") ? (stored?.attrs ?? {})[bare] ?? null : stored?.[path] ?? null;
    const obs = Object.entries((info?.obs ?? {}) as Record<string, { v: unknown; at: string }>).map(([k, o]) => ({ source: k, name: name(k), value: o.v, at: o.at })).sort((a, b) => b.at.localeCompare(a.at));
    rows.push({
      field: path, label: labelOf(path), value,
      set_by: info?.src ? { source: info.src, name: info.src === "manual" && isUuid(info.by) ? "ویرایش دستی" : name(info.src), at: info.at ?? null } : null,
      locked: locked.has(path) || locked.has(bare),
      observations: obs,
    });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, "fa"));
  return { rows, sources: Object.fromEntries(sources) };
}

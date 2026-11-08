// Helpers of configuration management: the organisation's class tree and relationship types (its rows, else the
// built-in pack — cached per organisation for half a minute and dropped by every class or type write), the module's
// settings row, and the generic read helpers of the incident module (every read goes through the access rule).
import { CMDB_CONFIG_DEFAULTS, type CmdbConfig } from "@shared/tables/cmdb";
import { BUILTIN_CLASSES, BUILTIN_REL_TYPES, ClassTree, classFromRow, relTypeFromRow, type RelTypeInfo } from "@shared/cmdb/logic";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { liveRows, sysOf, type Row } from "../incident/common";
import { grantIn } from "@shared/access/model";
import { subjectOf } from "../../access";
import { orgSchema } from "../../engine";

export { liveRows, liveRow, countRows, eqAll, isUuid, sysOf, UUID, type Row } from "../incident/common";

const TTL = 30_000;
const trees = new Map<string, { at: number; tree: ClassTree }>();
const types = new Map<string, { at: number; types: Map<string, RelTypeInfo> }>();

/** Forget the cached class tree and relationship types of an organisation (after a write to them). */
export function invalidateCmdbCache(orgId?: string): void {
  if (!orgId) {
    trees.clear();
    types.clear();
    return;
  }
  trees.delete(orgId);
  types.delete(orgId);
}

/**
 * The organisation's class tree: its `ci_class` rows (inactive ones included — CIs keep their class) over the built-in
 * pack, so a class the seed has not written yet still has its label, attributes and settings.
 */
export async function classTree(q: Queryable, ctx: Ctx, opts: { fresh?: boolean } = {}): Promise<ClassTree> {
  const hit = trees.get(ctx.org.id);
  if (hit && !opts.fresh && Date.now() - hit.at < TTL) return hit.tree;
  const rows = await liveRows(q, sysOf(ctx), "ci_class", null, { order: "t.sort_order nulls last, t.label" });
  const byKey = new Map(BUILTIN_CLASSES.map((c) => [c.key, c]));
  for (const r of rows) byKey.set(String(r.key), classFromRow(r));
  const tree = new ClassTree([...byKey.values()]);
  trees.set(ctx.org.id, { at: Date.now(), tree });
  return tree;
}

/** The organisation's relationship types by key (its rows over the built-in ones). */
export async function relTypes(q: Queryable, ctx: Ctx, opts: { fresh?: boolean } = {}): Promise<Map<string, RelTypeInfo>> {
  const hit = types.get(ctx.org.id);
  if (hit && !opts.fresh && Date.now() - hit.at < TTL) return hit.types;
  const rows = await liveRows(q, sysOf(ctx), "ci_rel_type", null, { order: "t.sort_order nulls last, t.label" });
  const out = new Map(BUILTIN_REL_TYPES.map((t) => [t.key, t]));
  for (const r of rows) out.set(String(r.key), relTypeFromRow(r));
  types.set(ctx.org.id, { at: Date.now(), types: out });
  return out;
}

const pick = <T extends Record<string, unknown>>(defaults: T, row: Row | null): T => {
  const out = { ...defaults } as Record<string, unknown>;
  if (row) for (const k of Object.keys(defaults)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return out as T;
};

/** The organisation's CMDB settings (its row, else the defaults). */
export async function cmdbConfig(q: Queryable, ctx: Ctx): Promise<CmdbConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "cmdb_config", null, { order: "t.created_at", limit: 1 });
  return { ...pick(CMDB_CONFIG_DEFAULTS, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** `[{ id }]` → ids, de-duplicated, lower-case. */
export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()))];

/** The physical CI columns a class attribute path or field name maps to: `attrs.x` → jsonb text, else the column. */
export function ciColumnSql(alias: string, path: string, params: unknown[]): string {
  const bare = path.replace(/^attrs\./, "");
  if (path.startsWith("attrs.") || !CI_COLUMNS.has(bare)) {
    params.push(bare);
    return `(${alias}.attrs ->> $${params.length})`;
  }
  return `${alias}.${bare}`;
}

/** CI columns a mapping, an identification rule or a relationship rule may name directly. */
export const CI_COLUMNS = new Set([
  "name", "class", "description", "environment", "criticality", "tier", "operational_status", "install_status", "owned_by", "managed_by", "used_by",
  "support_group_id", "managed_by_group_id", "change_approval_group_id", "company_id", "location_id", "cost_center_id", "maintenance_calendar_id",
  "serial_number", "asset_tag", "manufacturer", "model_name", "hostname", "fqdn", "ip_address", "mac_address", "bios_uuid", "cloud_resource_id",
  "os", "os_version", "sw_version", "cpu_count", "ram_mb", "disk_gb", "url", "expires_at", "eol_date", "tags", "state",
]);

/** CI fields a source may write (identity, technical and descriptive data; never ownership anchors it does not know). */
export const SOURCE_FIELDS = [...CI_COLUMNS].filter((f) => f !== "class" && f !== "state");

/**
 * May the caller administer the CMDB — classes, relationship types, identification, reconciliation and data-quality
 * rules, policies, imports of the whole organisation (the area's `admin` grant: configuration managers and tenant
 * administrators)? The system always may.
 */
export async function isCmdbAdmin(ctx: Ctx, q?: Queryable): Promise<boolean> {
  if (ctx.actor === "system") return true;
  // the access subject is loaded by the engine's first entry point
  await orgSchema(ctx, q);
  try {
    return !!grantIn(subjectOf(ctx).eff, "cmdb").admin;
  } catch {
    return false;
  }
}

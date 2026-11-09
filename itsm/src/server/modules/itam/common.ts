// Helpers of IT asset management (and of the supplier and financial modules, which share them): reads of live rows
// through the access rule (the incident module's helpers), the caller's grants and field groups, the module's
// settings row with its defaults, the organisation's «today», and whether this runtime is a Windows app linked to
// the cloud (derived data — reminders, reconciliation, depreciation, capture — is then left to the cloud, so the two
// runtimes never compute the same rows twice — `actsHere` of the notification service).
import { grantIn } from "@shared/access/model";
import { todayISO } from "@shared/jalali";
import { ITAM_CONFIG_DEFAULTS, type ItamConfig } from "@shared/tables/itam";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { access } from "../../access/provider";
import { subjectOf } from "../../access";
import type { Cond } from "@shared/model/conditions";
import { condEnv, get, list, orgSchema, orgTz, readable, toSql } from "../../engine";
import { liveRows, sysOf, type Row } from "../incident/common";

export { liveRow, liveRows, countRows, eqAll, isUuid, sysOf, type Row } from "../incident/common";

export type GrantOp = "read" | "create" | "write" | "delete" | "approve" | "admin";

/** Does the caller hold `op` in `area` (read/write/delete: with a scope of at least `scope`, default own)? */
export async function holds(ctx: Ctx, area: string, op: GrantOp, scope: "own" | "group" | "all" = "own", q?: Queryable): Promise<boolean> {
  if (ctx.actor === "system") return true;
  await orgSchema(ctx, q);
  try {
    const g = grantIn(subjectOf(ctx).eff, area);
    if (op === "create" || op === "approve" || op === "admin") return !!g[op];
    const order = ["none", "own", "group", "unit", "unit_tree", "domain", "all"];
    return order.indexOf(g[op]) >= order.indexOf(scope);
  } catch {
    return false;
  }
}

/** Does the caller carry a field group (financial, personal…)? The system always does. */
export async function hasGroup(ctx: Ctx, group: "financial" | "personal" | "internal", q?: Queryable): Promise<boolean> {
  if (ctx.actor === "system") return true;
  await orgSchema(ctx, q);
  try {
    return access().hasFieldGroup(ctx, group);
  } catch {
    return false;
  }
}

/** The organisation's date today (its time zone). */
export const orgToday = (ctx: Ctx): string => todayISO(orgTz(ctx));

const pick = <T extends Record<string, unknown>>(defaults: T, row: Row | null): T => {
  const out = { ...defaults } as Record<string, unknown>;
  if (row) for (const k of Object.keys(defaults)) if (row[k] !== null && row[k] !== undefined && row[k] !== "") out[k] = row[k];
  return out as T;
};

/** The organisation's ITAM settings (its row, else the defaults). */
export async function itamConfig(q: Queryable, ctx: Ctx): Promise<ItamConfig & { id: string | null; seeded: number; last_reconcile_at: string | null }> {
  const [row] = await liveRows(q, sysOf(ctx), "itam_config", null, { order: "t.created_at", limit: 1 });
  return { ...pick(ITAM_CONFIG_DEFAULTS, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), last_reconcile_at: row?.last_reconcile_at ?? null };
}

/** A settings row of a module (the first live row), with its defaults. */
export async function configRow<T extends Record<string, unknown>>(q: Queryable, ctx: Ctx, table: string, defaults: T): Promise<T & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), table, null, { order: "t.created_at", limit: 1 });
  return { ...pick(defaults, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** Lower-case ids, de-duplicated. */
export const idsOf = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()))];

/** A value's text for a label («—» when empty). */
export const textOf = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

/** The display label of a state value of a table. */
export function stateLabel(states: { states: { value: string; label: string }[] } | undefined, v: unknown): string {
  return states?.states.find((s) => s.value === v)?.label ?? String(v ?? "");
}

/**
 * Ids of live rows of `table` matching `where` through the caller's read rule — participant grants included (the
 * holder of an asset reads its rows without a role in the area, ACCESS §7), newest first.
 */
export async function readableIds(ctx: Ctx, table: string, where: Cond, limit = 200): Promise<string[]> {
  const schema = await orgSchema(ctx);
  const def = schema.def(table);
  if (!def) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const parts = [readable(ctx, def, "t", params, env), "t.deleted_at is null", toSql(where, def, "t", params, env, { ctx, lookup: schema.lookup })];
  const rows = await ctx.db.query<{ id: string }>(`select t.id from ${def.table} t where ${parts.join(" and ")} order by t.updated_at desc limit ${Math.max(1, Math.min(1000, limit))}`, params);
  return rows.map((r) => r.id);
}

/**
 * Rows of `table` the caller may read: a list when their roles read the area, else (a participant such as an asset's
 * holder) the single records the grant opens, each read with `get` (visible fields only, with display values).
 */
export async function readableList(ctx: Ctx, table: string, where: Cond, opts: { sort?: string; size?: number } = {}): Promise<{ rows: Row[]; display: Record<string, string> }> {
  try {
    return await list(ctx, table, { filter: where, sort: opts.sort, size: opts.size ?? 100, total: false });
  } catch (e) {
    if ((e as { status?: number }).status !== 403) throw e;
  }
  const rows: Row[] = [];
  const display: Record<string, string> = {};
  for (const id of await readableIds(ctx, table, where, Math.min(opts.size ?? 50, 50))) {
    const r = await get(ctx, table, id).catch(() => null);
    if (!r) continue;
    rows.push(r.row);
    Object.assign(display, r.display);
  }
  return { rows, display };
}

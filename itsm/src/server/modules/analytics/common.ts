// Helpers of the analytics module: the module's settings row, who may author, administer or certify, and reads of
// live rows through the access rule (the incident module's helpers, shared by every ITSM module).
import { grantIn } from "@shared/access/model";
import { ANALYTICS_CONFIG_DEFAULTS, type AnalyticsConfig } from "@shared/tables/analytics";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { liveRows, sysOf } from "../incident";

export { liveRows, liveRow, sysOf, isUuid, eqAll, countRows, type Row } from "../incident";

export const AREA = "reports";

/** May the caller create reports and dashboards (the area's create flag)? */
export function canAuthor(ctx: Ctx): boolean {
  if (ctx.actor === "system") return true;
  return grantIn(subjectOf(ctx).eff, AREA).create;
}

/** Report administrators: certify, transfer ownership, change the settings, collect now (the area's admin flag). */
export function canAdmin(ctx: Ctx): boolean {
  if (ctx.actor === "system") return true;
  return grantIn(subjectOf(ctx).eff, AREA).admin;
}

/** Does the caller read reports at all (the area's read grant)? */
export function canRead(ctx: Ctx): boolean {
  if (ctx.actor === "system") return true;
  return grantIn(subjectOf(ctx).eff, AREA).read !== "none";
}

/** Load the caller's access subject (the checks above read it synchronously). */
export async function ready(ctx: Ctx): Promise<void> {
  if (ctx.actor !== "system") await prepareSubject(ctx);
}

/** The roles the caller holds (containment resolved). */
export const rolesOf = (ctx: Ctx): string[] => (ctx.actor === "system" ? [] : subjectOf(ctx).eff.roles);

/** The organisation's analytics settings (its row, else the defaults). */
export async function analyticsConfig(q: Queryable, ctx: Ctx): Promise<AnalyticsConfig & { id: string | null; seeded: number; last_snapshot_on: string | null }> {
  const [row] = await liveRows(q, sysOf(ctx), "analytics_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...ANALYTICS_CONFIG_DEFAULTS } as AnalyticsConfig;
  if (row) for (const k of Object.keys(ANALYTICS_CONFIG_DEFAULTS) as (keyof AnalyticsConfig)[]) if (row[k] !== null && row[k] !== undefined) out[k] = Number(row[k]);
  return { ...out, id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), last_snapshot_on: row?.last_snapshot_on ?? null };
}

/** A number from a database value (postgres.js returns numerics as text), or null; float noise of SQL statistics
 *  (7.200000000000001) rounded away at nine decimals. */
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : null;
};

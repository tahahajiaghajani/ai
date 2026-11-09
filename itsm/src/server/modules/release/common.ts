// Helpers of release management: the system acting inside a request, reads of live rows through the access rule
// (shared with change enablement — every read starts from `readable`), the module's settings row, the release
// manager's authority and small value helpers.
import { grantIn } from "@shared/access";
import { RELEASE_CONFIG_DEFAULTS, type ReleaseConfig } from "@shared/tables/release";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { isSystemCtx } from "../../engine";
import { eqAll, isUuid, liveRow, liveRows, countRows, sysOf, msOf, iso, type Row } from "../change/common";

export { eqAll, isUuid, liveRow, liveRows, countRows, sysOf, msOf, iso, type Row };

/** Roles that carry the release manager's authority (the release area's approve right). */
export const RELEASE_AUTHORITY = ["release_manager", "tenant_admin"];

/**
 * Does the acting person hold the release manager's authority — the release area's approve right? Go/no-go
 * decisions, waivers of readiness checks, gate overrides and the module's definitions need it. The system and
 * trusted server code always do.
 */
export async function managesReleases(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return grantIn(subjectOf(ctx).eff, "release").approve === true;
}

const pick = <T extends Record<string, unknown>>(defaults: T, row: Row | null): T => {
  const out = { ...defaults } as Record<string, unknown>;
  if (row) for (const k of Object.keys(defaults)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return out as T;
};

/** The organisation's release settings (its row, else the defaults). */
export async function releaseConfig(q: Queryable, ctx: Ctx): Promise<ReleaseConfig & { id: string | null; seeded: number; dora_definitions: Row | null }> {
  const [row] = await liveRows(q, sysOf(ctx), "release_config", null, { order: "t.created_at", limit: 1 });
  return { ...pick(RELEASE_CONFIG_DEFAULTS, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), dora_definitions: (row?.dora_definitions as Row) ?? null };
}

/** Distinct non-empty ids. */
export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : [xs]).filter(isUuid))];

/** Persian digits. */
export const fa = (v: unknown): string => String(v ?? "").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** «الف، ب و ج». */
export function faList(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join("، ")} و ${xs[xs.length - 1]}`;
}

/** The environment row of a deployment or booking (as the system), cached per transaction-less call. */
export async function environmentOf(q: Queryable, ctx: Ctx, id: unknown): Promise<Row | null> {
  return isUuid(id) ? liveRow(q, sysOf(ctx), "release_environment", id) : null;
}

/** Is an environment row a production one? */
export const isProductionEnv = (env: Row | null | undefined): boolean => env?.kind === "production";

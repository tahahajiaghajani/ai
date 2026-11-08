// Helpers of the service portfolio: the module's settings row, who manages the portfolio (the area's admin grant:
// portfolio managers and tenant administrators), the people behind a subscription, and the read helpers shared with
// configuration management (every read goes through the access rule).
import { SERVICE_CONFIG_DEFAULTS, type ServiceConfig } from "@shared/tables/service_portfolio";
import { grantIn } from "@shared/access/model";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { subjectOf } from "../../access";
import { orgSchema } from "../../engine";
import { groupMembers } from "../notify/recipients";
import { isUuid, liveRows, sysOf, type Row } from "../cmdb/common";

export { liveRows, liveRow, countRows, eqAll, isUuid, sysOf, type Row } from "../cmdb/common";

/** Service states of the catalogue (what people consume); the pipeline is before, retired after. */
export const CATALOGUE_STATES = ["live", "deprecated"];
export const PIPELINE_STATES = ["proposed", "approved", "design", "transition"];
export const RETIRED_STATES = ["retired", "rejected"];

/** Open incidents (not resolved, closed or cancelled). */
export const OPEN_INCIDENT = { f: "state", op: "nin" as const, v: ["resolved", "closed", "canceled"] };

const pick = <T extends Record<string, unknown>>(defaults: T, row: Row | null): T => {
  const out = { ...defaults } as Record<string, unknown>;
  if (row) for (const k of Object.keys(defaults)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return out as T;
};

/** The organisation's portfolio settings (its row, else the defaults). */
export async function serviceConfig(q: Queryable, ctx: Ctx): Promise<ServiceConfig & { id: string | null; seeded: number; status_page_token: string | null }> {
  const [row] = await liveRows(q, sysOf(ctx), "service_config", null, { order: "t.created_at", limit: 1 });
  return { ...pick(SERVICE_CONFIG_DEFAULTS, row ?? null), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), status_page_token: row?.status_page_token ?? null };
}

/**
 * May the caller manage the portfolio — the status page, the taxonomy, the whole catalogue (the `service` area's
 * admin grant, or writing every service: configuration managers, tenant administrators)? The system always may.
 */
export async function isPortfolioManager(ctx: Ctx, q?: Queryable): Promise<boolean> {
  if (ctx.actor === "system") return true;
  await orgSchema(ctx, q);
  try {
    const g = grantIn(subjectOf(ctx).eff, "service");
    return !!g.admin || g.write === "all";
  } catch {
    return false;
  }
}

/** Members of org units (by their member profile). */
export async function unitMembers(q: Queryable, ctx: Ctx, units: string[]): Promise<string[]> {
  const u = [...new Set(units.filter(isUuid))];
  if (!u.length) return [];
  const rows = await liveRows(q, sysOf(ctx), "member_profile", { f: "org_unit_id", op: "in", v: u }, { limit: 5000 });
  return rows.map((r) => String(r.user_id)).filter(isUuid);
}

/** Members at locations (by their member profile). */
export async function locationMembers(q: Queryable, ctx: Ctx, locations: string[]): Promise<string[]> {
  const l = [...new Set(locations.filter(isUuid))];
  if (!l.length) return [];
  const rows = await liveRows(q, sysOf(ctx), "member_profile", { f: "location_id", op: "in", v: l }, { limit: 5000 });
  return rows.map((r) => String(r.user_id)).filter(isUuid);
}

/** The people a subscription reaches (a person, a group's members, a unit's or a location's members). */
export async function subscriptionPeople(q: Queryable, ctx: Ctx, sub: Row): Promise<string[]> {
  switch (sub.subscriber_kind) {
    case "group":
      return isUuid(sub.group_id) ? groupMembers(sysOf(ctx), [sub.group_id], q) : [];
    case "unit":
      return unitMembers(q, ctx, [sub.org_unit_id]);
    case "location":
      return locationMembers(q, ctx, [sub.location_id]);
    default:
      return isUuid(sub.user_id) ? [sub.user_id] : [];
  }
}

/** Is a subscription in force today (`today` as YYYY-MM-DD)? */
export const subscriptionLive = (s: Row, today: string) => (!s.valid_from || String(s.valid_from) <= today) && (!s.valid_to || String(s.valid_to) >= today);

/** The member's groups, unit and location (for «my services» and entitlements). */
export async function memberAnchors(q: Queryable, ctx: Ctx, userId: string): Promise<{ groups: string[]; unit: string | null; location: string | null }> {
  const sys = sysOf(ctx);
  const [profile] = await liveRows(q, sys, "member_profile", { f: "user_id", op: "eq", v: userId }, { limit: 1 });
  const now = new Date().toISOString();
  const groups = await liveRows(q, sys, "group_member", {
    and: [
      { f: "user_id", op: "eq", v: userId },
      { or: [{ f: "valid_from", op: "empty" }, { f: "valid_from", op: "lte", v: now }] },
      { or: [{ f: "valid_to", op: "empty" }, { f: "valid_to", op: "gt", v: now }] },
    ],
  }, { limit: 500 });
  return { groups: groups.map((g) => String(g.group_id)), unit: profile?.org_unit_id ?? null, location: profile?.location_id ?? null };
}


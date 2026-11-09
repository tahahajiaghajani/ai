// Helpers of customer service management: reads through the access rule (shared with the change module — every read
// starts from `readable`), the module's settings row, the CSM manager's authority, and the contact behind a member.
import { grantIn } from "@shared/access";
import { CSM_CONFIG_DEFAULTS, type CsmConfig } from "@shared/tables/csm";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { isSystemCtx } from "../../engine";
import { countRows, eqAll, isUuid, liveRow, liveRows, mayWriteRecord, sysOf, msOf, iso, type Row } from "../change/common";

export { countRows, eqAll, isUuid, liveRow, liveRows, mayWriteRecord, sysOf, msOf, iso, type Row };

/** The organisation's CSM settings (its row, else the defaults). */
export async function csmConfig(q: Queryable, ctx: Ctx): Promise<CsmConfig & { id: string | null; seeded: number; default_group_id: string | null; root_unit_id: string | null }> {
  const [row] = await liveRows(q, sysOf(ctx), "csm_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...CSM_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(CSM_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return { ...(out as unknown as CsmConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), default_group_id: (row?.default_group_id as string) ?? null, root_unit_id: (row?.root_unit_id as string) ?? null };
}

/** The CSM manager's authority: the csm area's approve right (escalations, notices, definitions). */
export async function managesCsm(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return grantIn(subjectOf(ctx).eff, "csm").approve === true;
}

/** The contact records of a member (a member may be a contact of one account, with access to others). */
export async function contactsOfUser(q: Queryable, ctx: Ctx, userId: string): Promise<Row[]> {
  if (!isUuid(userId)) return [];
  return liveRows(q, sysOf(ctx), "customer_contact", { and: [{ f: "user_id", op: "eq", v: userId }, { f: "active", op: "eq", v: true }] }, { limit: 5 });
}

/** Today in UTC (YYYY-MM-DD) — entitlement validity is by day. */
export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : [xs]).filter(isUuid).map((x) => x.toLowerCase()))];

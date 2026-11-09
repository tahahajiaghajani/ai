// Helpers of service level management: reads through the access rule (shared with change and release — every read
// starts from `readable`), the module's settings row, the service level manager's authority and small value helpers.
import { grantIn } from "@shared/access";
import { SLM_CONFIG_DEFAULTS, type SlmConfig } from "@shared/tables/slm";
import { localDate } from "@shared/model/jalali-buckets";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { access } from "../../access/provider";
import { defFor, isSystemCtx, orgTz } from "../../engine";
import { forbidden } from "../../http/errors";
import { countRows, eqAll, isUuid, liveRow, liveRows, mayWriteRecord, msOf, sysOf, type Row } from "../change/common";

export { countRows, eqAll, isUuid, liveRow, liveRows, mayWriteRecord, msOf, sysOf, type Row };

/** Today's local date of the organisation (YYYY-MM-DD). */
export const todayOf = (ctx: Ctx, now = Date.now()): string => localDate(now, orgTz(ctx));

export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : [xs]).filter(isUuid))];

/** The settings row (or the defaults). */
export async function slmConfig(q: Queryable, ctx: Ctx): Promise<SlmConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "slm_config", null, { order: "t.created_at", limit: 1 });
  const out: Record<string, unknown> = { ...SLM_CONFIG_DEFAULTS };
  if (row) for (const k of Object.keys(SLM_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = typeof (SLM_CONFIG_DEFAULTS as Record<string, unknown>)[k] === "number" ? Number(row[k]) : row[k];
  return { ...(out as SlmConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/**
 * The service level manager's authority: the `sla` area's write right over every row (service-desk managers, service
 * owners, «مدیر سطح خدمت», tenant administrators). Templates, XLA policies, measuring on demand and the module's
 * settings need it; the system always has it.
 */
export async function managesSlm(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  const g = grantIn(subjectOf(ctx).eff, "sla");
  return g.write === "all" || g.admin;
}

/** May the caller read the module's tables at all (the `sla` area)? */
export async function readsSlm(ctx: Ctx): Promise<boolean> {
  const { def } = await defFor(ctx, "slm_target");
  return access().canReadTable(ctx, def);
}

export async function needReadsSlm(ctx: Ctx): Promise<void> {
  if (!(await readsSlm(ctx))) throw forbidden("به مدیریت سطح خدمت دسترسی ندارید");
}

/** A readable agreement for the caller (404 semantics: null when unreadable). */
export async function readableAgreement(q: Queryable, ctx: Ctx, id: unknown): Promise<Row | null> {
  return liveRow(q, ctx, "service_agreement", id);
}

export const pctOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

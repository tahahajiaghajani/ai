// Helpers of field service: reads through the access rule (shared with the change module — every read starts from
// `readable`), the module's settings row, the dispatcher's authority and the calendars of technicians.
import { grantIn } from "@shared/access";
import { FSM_CONFIG_DEFAULTS, type FsmConfig } from "@shared/tables/field_service";
import type { BusinessCalendar } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { isSystemCtx, orgTz } from "../../engine";
import { calendarsOf } from "../sla/calendars";
import { config as slaConfig } from "../sla/common";
import { countRows, eqAll, isUuid, liveRow, liveRows, mayWriteRecord, sysOf, msOf, iso, type Row } from "../change/common";

export { countRows, eqAll, isUuid, liveRow, liveRows, mayWriteRecord, sysOf, msOf, iso, type Row };

/** The organisation's field-service settings (its row, else the defaults). */
export async function fsmConfig(q: Queryable, ctx: Ctx): Promise<FsmConfig & { id: string | null; seeded: number; default_group_id: string | null }> {
  const [row] = await liveRows(q, sysOf(ctx), "fsm_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...FSM_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(FSM_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = k === "road_factor" ? Number(row[k]) : row[k];
  return { ...(out as unknown as FsmConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), default_group_id: (row?.default_group_id as string) ?? null };
}

/** The dispatcher's authority: the field-service area's approve right (assigning others, overriding feasibility). */
export async function dispatches(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return grantIn(subjectOf(ctx).eff, "field_service").approve === true;
}

/** A working calendar by id (or the organisation's default; null: around the clock). */
export async function calendarFor(q: Queryable, ctx: Ctx, preferred?: unknown): Promise<BusinessCalendar | null> {
  const sys = sysOf(ctx);
  const { byId, defaultId } = calendarsOf(await slaConfig(q, sys), orgTz(sys));
  const id = [preferred, defaultId].find((x): x is string => typeof x === "string" && byId.has(x)) ?? null;
  return id ? (byId.get(id) ?? null) : null;
}

/** Today in the organisation's zone (YYYY-MM-DD). */
export function todayOf(ctx: Ctx, now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: orgTz(ctx), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : [xs]).filter(isUuid).map((x) => x.toLowerCase()))];

/** States of a task in which it holds the technician's time. */
export const BOOKED = ["assigned", "accepted", "en_route", "on_site", "on_hold", "pending_parts"];
export const TASK_OPEN = ["pending_dispatch", ...BOOKED];

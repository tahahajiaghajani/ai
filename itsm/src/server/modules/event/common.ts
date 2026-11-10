// Helpers of the event module: reads through the access rule (re-used from incident management), the settings row,
// and the module's authority over alerts.
//
// Who may act on an alert («پاسخ‌گویی»): the system; whoever may change it through the access provider (a role with
// write in area `event`); and — because the built-in agent roles only read the area — the people the alert names:
// its assignee, its responders (paged or added), and the members of its team (the assignment group). Their actions
// (acknowledge, assign, snooze, close, raise an incident) run as trusted writes of the module on their behalf, so
// the history names them. Definitions (sources, rules, routes) need the area's create right as usual.
import type { TableDef } from "@shared/model/types";
import { EVENT_CONFIG_DEFAULTS, type EventConfig } from "@shared/tables/event";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { access } from "../../access/provider";
import { subjectOf } from "../../access";
import { condEnv, orgSchema, orgTz, resolveDisplay, RefSet } from "../../engine";
import { liveRows, liveRow, countRows, eqAll, isUuid, sysOf, faList, type Row } from "../incident/common";

export { liveRows, liveRow, countRows, eqAll, isUuid, sysOf, faList, orgTz, type Row };

/** The organisation's event settings (its row, else the defaults). */
export async function eventConfig(q: Queryable, ctx: Ctx): Promise<EventConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "event_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...EVENT_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(EVENT_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return { ...(out as unknown as EventConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Is the caller in the group (as member or lead, not as observer)? */
export function inGroup(ctx: Ctx, groupId: unknown): boolean {
  if (ctx.actor === "system") return true;
  if (!isUuid(groupId)) return false;
  try {
    return subjectOf(ctx).writeGroups.includes(String(groupId).toLowerCase());
  } catch {
    return false;
  }
}

/** May the caller act on this alert (or correlated group) — acknowledge, assign, snooze, close, raise an incident? */
export function canRespond(ctx: Ctx, def: TableDef, row: Row): boolean {
  if (ctx.actor === "system") return true;
  if (access().canWrite(ctx, def, row)) return true;
  const me = ctx.user.id;
  if (row.assigned_to === me) return true;
  if (ids(row.responders).includes(me)) return true;
  return inGroup(ctx, row.assignment_group_id);
}

/** May the caller define the module's sources and rules (create in area `event`)? */
export async function canConfigure(ctx: Ctx, q?: Queryable): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const def = (await orgSchema(ctx, q)).def("event_rule");
  return !!def && access().canCreate(ctx, def, null);
}

/** May the caller manage on-call (create in area `oncall`)? */
export async function canManageOncall(ctx: Ctx, q?: Queryable): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const def = (await orgSchema(ctx, q)).def("oncall_schedule");
  return !!def && access().canCreate(ctx, def, null);
}

/** The value as a list of ids. */
export const idList = ids;

/** Epoch ms of a stored date-time, or null. */
export const msOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

export const nowIso = () => new Date().toISOString();

/** Display values of references for the caller (what they may not read stays absent). */
export async function displayOf(ctx: Ctx, refs: RefSet, q: Queryable = ctx.db): Promise<Record<string, string>> {
  return resolveDisplay(q, ctx, await condEnv(ctx), await orgSchema(ctx, q), refs).catch(() => ({} as Record<string, string>));
}

export { RefSet };

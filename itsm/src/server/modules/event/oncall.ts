// On-call on the server (catalogue EVT-033/034/040/042): schedules with their rotations and overrides, the final
// layer over a range, who is on call now for a group, self-service cover («کشیک را برعهده می‌گیرم»), and the
// platform's plug-in points it serves — the notification service's `oncall` recipients (`registerOnCallSource`) and
// the assignment rules' method «کشیک» (`setOnCallResolver`).
import { finalShifts, gapsOf, onCallAt, rotationShifts, timePerPerson, type OverrideLike, type RotationLike, type Shift } from "@shared/event/oncall";
import type { BusinessCalendar } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { createIn, systemCtx } from "../../engine";
import { forbidden, notFound, bad } from "../../http/errors";
import { calendarFor, setOnCallResolver } from "../sla";
import { officeCalendar } from "../incident/major";
import { registerOnCallSource } from "../notify";
import { canManageOncall, inGroup, isUuid, liveRow, liveRows, orgTz, sysOf, type Row } from "./common";

export interface ScheduleData {
  schedule: Row;
  rotations: RotationLike[];
  overrides: OverrideLike[];
  cal: BusinessCalendar | null;
  tz: string;
}

const DAY = 86_400_000;

/** A schedule with its live rotations, the overrides around [from, to) and its working calendar (system rights). */
export async function scheduleData(q: Queryable, ctx: Ctx, schedule: Row, from = Date.now() - DAY, to = Date.now() + 31 * DAY): Promise<ScheduleData> {
  const sys = sysOf(ctx);
  const rotations = (await liveRows(q, sys, "oncall_rotation", { f: "schedule_id", op: "eq", v: schedule.id }, { order: "t.layer, t.created_at", limit: 50 })) as unknown as RotationLike[];
  const overrides = (await liveRows(q, sys, "oncall_override", {
    and: [
      { f: "schedule_id", op: "eq", v: schedule.id },
      { f: "end_at", op: "gt", v: new Date(from).toISOString() },
      { f: "start_at", op: "lt", v: new Date(to).toISOString() },
    ],
  }, { order: "t.start_at", limit: 500 })) as unknown as OverrideLike[];
  const tz = String(schedule.timezone || orgTz(ctx));
  const cal = isUuid(schedule.calendar_id) ? await calendarFor(q, sys, schedule.calendar_id, tz) : await officeCalendar(q, sys);
  return { schedule, rotations, overrides, cal, tz };
}

/** The active schedules of a group (system rights). */
export async function schedulesOf(q: Queryable, ctx: Ctx, groupId: string): Promise<Row[]> {
  if (!isUuid(groupId)) return [];
  return liveRows(q, sysOf(ctx), "oncall_schedule", { and: [{ f: "group_id", op: "eq", v: groupId }, { f: "active", op: "eq", v: true }] }, { order: "t.name", limit: 20 });
}

/** Who is on call for one schedule at `t`. */
export async function onCallOfSchedule(q: Queryable, ctx: Ctx, schedule: Row, t = Date.now()): Promise<{ user: string | null; override_id: string | null; rotation_id: string | null; until: number | null }> {
  const d = await scheduleData(q, ctx, schedule, t - DAY, t + 31 * DAY);
  const who = onCallAt(d.rotations, d.overrides, t, { tz: d.tz, cal: d.cal });
  const shifts = finalShifts(d.rotations, d.overrides, t, t + 30 * DAY, { tz: d.tz, cal: d.cal });
  return { ...who, until: shifts[0]?.end ?? null };
}

/** Everyone on call now for a group (one per active schedule, deduplicated). */
export async function onCallForGroup(q: Queryable, ctx: Ctx, groupId: string, t = Date.now()): Promise<string[]> {
  const out = new Set<string>();
  for (const s of await schedulesOf(q, ctx, groupId)) {
    const who = await onCallOfSchedule(q, ctx, s, t);
    if (who.user) out.add(who.user);
  }
  return [...out];
}

/** Shifts of a schedule over [from, to): the final layer, each rotation's own row and the coverage gaps. */
export async function scheduleShifts(q: Queryable, ctx: Ctx, schedule: Row, from: number, to: number): Promise<{ final: Shift[]; layers: { rotation: Row; shifts: Shift[] }[]; gaps: { start: number; end: number }[]; overrides: OverrideLike[]; tz: string }> {
  const d = await scheduleData(q, ctx, schedule, from, to);
  const o = { tz: d.tz, cal: d.cal };
  const final = finalShifts(d.rotations, d.overrides, from, to, o);
  const layers = d.rotations.map((r) => ({ rotation: r as unknown as Row, shifts: rotationShifts(r, from, to, o) }));
  return { final, layers, gaps: gapsOf(final), overrides: d.overrides, tz: d.tz };
}

/** The caller's shifts across every schedule of the organisation over [from, to). */
export async function myShifts(q: Queryable, ctx: Ctx, from: number, to: number): Promise<{ schedule_id: string; schedule: string; group_id: string | null; start: number; end: number; override: boolean }[]> {
  const me = ctx.user.id;
  const schedules = await liveRows(q, sysOf(ctx), "oncall_schedule", { f: "active", op: "eq", v: true }, { order: "t.name", limit: 200 });
  const out: { schedule_id: string; schedule: string; group_id: string | null; start: number; end: number; override: boolean }[] = [];
  for (const s of schedules) {
    const r = await scheduleShifts(q, ctx, s, from, to);
    for (const x of r.final) if (x.user === me) out.push({ schedule_id: String(s.id), schedule: String(s.name), group_id: s.group_id ?? null, start: x.start, end: x.end, override: !!x.override_id });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** On-call time per person of a schedule's final layer over [from, to). */
export async function onCallLoad(q: Queryable, ctx: Ctx, schedule: Row, from: number, to: number): Promise<Map<string, number>> {
  const r = await scheduleShifts(q, ctx, schedule, from, to);
  return timePerPerson(r.final);
}

/**
 * «کشیک را برعهده می‌گیرم»: the caller covers a schedule for `minutes` from now (or a window), for everyone or instead
 * of one person — members of the schedule's team and on-call managers.
 */
export async function takeOnCall(tx: Tx, ctx: Ctx, scheduleId: string, input: { minutes?: number; start_at?: string; end_at?: string; replaces_id?: string | null; user_id?: string | null; reason?: string | null }): Promise<Row> {
  const schedule = await liveRow(tx, ctx, "oncall_schedule", scheduleId);
  if (!schedule) throw notFound("برنامهٔ کشیک پیدا نشد");
  const manager = await canManageOncall(ctx, tx);
  if (!manager && !inGroup(ctx, schedule.group_id)) throw forbidden("فقط اعضای تیم این برنامه یا مدیر کشیک جایگزینی ثبت می‌کنند");
  const user = input.user_id && input.user_id !== ctx.user.id ? input.user_id : ctx.user.id;
  if (user !== ctx.user.id && !manager) throw forbidden("ثبت جایگزینی به نام دیگران با مدیر کشیک است");
  const start = input.start_at ? Date.parse(input.start_at) : Date.now();
  const end = input.end_at ? Date.parse(input.end_at) : start + Math.max(15, Math.min(7 * 24 * 60, Number(input.minutes) || 60)) * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw bad("بازهٔ جایگزینی معتبر نیست");
  if (end - start > 92 * DAY) throw bad("جایگزینی حداکثر سه ماه است");
  return createIn(tx, sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id), "oncall_override", {
    schedule_id: scheduleId,
    user_id: user,
    replaces_id: input.replaces_id ?? null,
    start_at: new Date(start).toISOString(),
    end_at: new Date(end).toISOString(),
    reason: String(input.reason ?? "").trim() || (input.minutes ? "برعهده گرفتن کشیک" : "جایگزینی"),
  }, { trusted: true });
}

/** Plug on-call into the notification service and the assignment rules (once per process). */
export function installOnCallSources(): (() => void)[] {
  const off = registerOnCallSource(async (q, orgId, groupId, at) => {
    const sys = await systemCtx({ db: q as never }, orgId);
    return onCallForGroup(q, sys, groupId, at.getTime());
  });
  setOnCallResolver(async (q, ctx, groupId, at) => {
    const people = await onCallForGroup(q, ctx, groupId, at);
    return people[0] ?? null;
  });
  return [off, () => setOnCallResolver(null)];
}

// The on-call engine (catalogue EVT-033/034/040), pure and shared by the server (who is on call now, escalation
// targets, the notification service's `oncall` recipients, the assignment method «کشیک») and the on-call calendar:
//   · a rotation hands over every day, every week (Jalali weeks: the start's weekday and time are the handoff) or
//     every N hours, starting at its `start_at`; its members take turns in order
//   · a rotation may be limited to the calendar's working hours, to the hours outside them (nights, Fridays and the
//     official holidays of the calendar's holiday sets) or to a daily window on chosen weekdays (Saturday first; a
//     window whose end is before its start runs past midnight and belongs to the day it starts)
//   · layers: the highest layer that has someone at that moment wins (a base rotation under a night layer)
//   · overrides beat every layer — for everyone in their window, or only instead of one person (leave, swaps)
//   · the final layer over a range is a list of shifts; shifts without anyone are coverage gaps
import { isWorking, localInstant, workingIntervals, parseTime, type BusinessCalendar } from "../sla/calendar";
import { addDays, weekday } from "../jalali";
import { localDate } from "../model/jalali-buckets";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface RotationLike {
  id: string;
  name?: string | null;
  layer?: number | null;
  rotation_type?: string | null;
  length_hours?: number | null;
  start_at: string;
  end_at?: string | null;
  members?: string[] | null;
  restriction?: string | null;
  restrict_days?: string[] | null;
  restrict_from?: string | null;
  restrict_to?: string | null;
  active?: boolean | null;
}

export interface OverrideLike {
  id: string;
  user_id: string;
  replaces_id?: string | null;
  start_at: string;
  end_at: string;
  reason?: string | null;
}

export interface OnCallOpts {
  tz: string;
  /** the schedule's working calendar (office / off-hours restrictions); null: every hour is working time */
  cal: BusinessCalendar | null;
}

export interface OnCall {
  user: string | null;
  rotation_id: string | null;
  layer: number | null;
  override_id: string | null;
}

export interface Shift extends OnCall {
  start: number;
  end: number;
}

const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/** The length of one turn of a rotation. */
export function turnLength(r: Pick<RotationLike, "rotation_type" | "length_hours">): number {
  if (r.rotation_type === "daily") return DAY_MS;
  if (r.rotation_type === "custom") return Math.max(1, Math.min(2160, Number(r.length_hours) || 12)) * HOUR_MS;
  return 7 * DAY_MS;
}

const members = (r: RotationLike): string[] => (Array.isArray(r.members) ? r.members.filter((x) => typeof x === "string" && x) : []);

/** Whose turn it is at `t` in a rotation (its hours restriction aside), or null. */
export function turnAt(r: RotationLike, t: number): string | null {
  if (r.active === false) return null;
  const list = members(r);
  const start = ms(r.start_at);
  const end = ms(r.end_at);
  if (!list.length || start === null || t < start || (end !== null && t >= end)) return null;
  const k = Math.floor((t - start) / turnLength(r));
  return list[k % list.length];
}

/** Minutes after local midnight and the Saturday-first weekday of an instant in `tz`. */
function localClock(t: number, tz: string): { date: string; minutes: number; day: number } {
  const date = localDate(t, tz);
  const minutes = Math.round((t - localInstant(date, 0, tz)) / 60_000);
  return { date, minutes, day: weekday(date) };
}

/** Does a daily window [from, to) on `days` (Saturday = 0) cover `t`? A window ending before it starts runs past midnight. */
function inWindow(r: RotationLike, t: number, tz: string): boolean {
  const from = parseTime(r.restrict_from ?? "") ?? 0;
  const to = parseTime(r.restrict_to ?? "") ?? 1440;
  const days = (Array.isArray(r.restrict_days) ? r.restrict_days : []).map(Number).filter((n) => n >= 0 && n <= 6);
  const onDay = (d: number) => !days.length || days.includes(d);
  const { date, minutes, day } = localClock(t, tz);
  if (from < to) return onDay(day) && minutes >= from && minutes < to;
  if (from === to) return onDay(day);
  // overnight: today's evening part, or yesterday's window running into this morning
  if (minutes >= from && onDay(day)) return true;
  const yesterday = weekday(addDays(date, -1));
  return minutes < to && onDay(yesterday);
}

/** Does the rotation's hours restriction allow `t`? */
export function restrictionAllows(r: RotationLike, t: number, o: OnCallOpts): boolean {
  switch (r.restriction) {
    case "office":
      return o.cal ? isWorking(o.cal, t) : true;
    case "off_hours":
      return o.cal ? !isWorking(o.cal, t) : true;
    case "custom":
      return inWindow(r, t, o.tz);
    default:
      return true;
  }
}

/** Who a rotation puts on call at `t` (restriction included), or null. */
export function rotationAt(r: RotationLike, t: number, o: OnCallOpts): string | null {
  const who = turnAt(r, t);
  return who && restrictionAllows(r, t, o) ? who : null;
}

const byLayer = (rotations: readonly RotationLike[]) => [...rotations].filter((r) => r.active !== false).sort((a, b) => (Number(b.layer) || 1) - (Number(a.layer) || 1) || String(a.id).localeCompare(String(b.id)));

/** Who is on call at `t`: overrides first, then the highest layer with someone. */
export function onCallAt(rotations: readonly RotationLike[], overrides: readonly OverrideLike[], t: number, o: OnCallOpts): OnCall {
  let base: OnCall = { user: null, rotation_id: null, layer: null, override_id: null };
  for (const r of byLayer(rotations)) {
    const who = rotationAt(r, t, o);
    if (who) {
      base = { user: who, rotation_id: r.id, layer: Number(r.layer) || 1, override_id: null };
      break;
    }
  }
  const live = overrides
    .filter((x) => {
      const s = ms(x.start_at);
      const e = ms(x.end_at);
      return s !== null && e !== null && s <= t && t < e && !!x.user_id;
    })
    .sort((a, b) => (ms(b.start_at) ?? 0) - (ms(a.start_at) ?? 0));
  for (const x of live) {
    if (!x.replaces_id || x.replaces_id === base.user) return { user: x.user_id, rotation_id: base.rotation_id, layer: base.layer, override_id: x.id };
  }
  return base;
}

/** Every instant in (from, to) where who is on call may change. */
function breakpoints(rotations: readonly RotationLike[], overrides: readonly OverrideLike[], from: number, to: number, o: OnCallOpts): number[] {
  const out = new Set<number>([from, to]);
  const add = (t: number | null) => {
    if (t !== null && t > from && t < to) out.add(t);
  };
  let workingDone = false;
  for (const r of rotations) {
    if (r.active === false) continue;
    const start = ms(r.start_at);
    if (start === null) continue;
    add(start);
    add(ms(r.end_at));
    const len = turnLength(r);
    let k = Math.max(0, Math.floor((from - start) / len));
    for (let t = start + k * len; t < to && k < 20_000; k++, t = start + k * len) add(t);
    if ((r.restriction === "office" || r.restriction === "off_hours") && o.cal && !workingDone) {
      workingDone = true;
      for (const [a, b] of workingIntervals(o.cal, from - DAY_MS, to + DAY_MS)) {
        add(a);
        add(b);
      }
    }
    if (r.restriction === "custom") {
      const f = parseTime(r.restrict_from ?? "") ?? 0;
      const e = parseTime(r.restrict_to ?? "") ?? 1440;
      for (let d = localDate(from - DAY_MS, o.tz), guard = 0; guard < 400; guard++, d = addDays(d, 1)) {
        const mid = localInstant(d, 0, o.tz);
        if (mid > to) break;
        add(localInstant(d, f, o.tz));
        add(e > f ? localInstant(d, e, o.tz) : localInstant(addDays(d, 1), e, o.tz));
      }
    }
  }
  for (const x of overrides) {
    add(ms(x.start_at));
    add(ms(x.end_at));
  }
  return [...out].sort((a, b) => a - b);
}

/** The final layer over [from, to): consecutive shifts (gaps have `user: null`). At most 92 days. */
export function finalShifts(rotations: readonly RotationLike[], overrides: readonly OverrideLike[], from: number, to: number, o: OnCallOpts): Shift[] {
  const end = Math.min(to, from + 92 * DAY_MS);
  if (!(end > from)) return [];
  const points = breakpoints(rotations, overrides, from, end, o);
  const out: Shift[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const who = onCallAt(rotations, overrides, a, o);
    const prev = out[out.length - 1];
    if (prev && prev.end === a && prev.user === who.user && prev.override_id === who.override_id && prev.rotation_id === who.rotation_id) prev.end = b;
    else out.push({ start: a, end: b, ...who });
  }
  return out;
}

/** The shifts of one rotation alone over [from, to) (a layer row of the calendar; restriction included). */
export function rotationShifts(r: RotationLike, from: number, to: number, o: OnCallOpts): Shift[] {
  return finalShifts([{ ...r, layer: 1 }], [], from, to, o).filter((s) => s.user);
}

/** Coverage gaps: stretches nobody is on call (at least `minMs` long). */
export function gapsOf(shifts: readonly Shift[], minMs = 60_000): { start: number; end: number }[] {
  return shifts.filter((s) => !s.user && s.end - s.start >= minMs).map((s) => ({ start: s.start, end: s.end }));
}

/** On-call time per person over the shifts (milliseconds). */
export function timePerPerson(shifts: readonly Shift[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shifts) if (s.user) out.set(s.user, (out.get(s.user) ?? 0) + (s.end - s.start));
  return out;
}

/** Why a rotation cannot be used (Persian), or null. */
export function rotationProblem(r: Partial<RotationLike>): string | null {
  if (!members(r as RotationLike).length) return "دست‌کم یک نفر را در نوبت بگذارید";
  const s = ms(r.start_at);
  const e = ms(r.end_at);
  if (s === null) return "زمان آغاز چرخش را وارد کنید";
  if (e !== null && e <= s) return "پایان چرخش باید پس از آغاز آن باشد";
  if (r.restriction === "custom") {
    if (parseTime(r.restrict_from ?? "") === null || parseTime(r.restrict_to ?? "") === null) return "برای بازهٔ روزانه، ساعت آغاز و پایان را به شکل ۰۸:۰۰ وارد کنید";
  }
  return null;
}

/** The next moment at or after `t` when someone else takes over (null within the horizon of 30 days). */
export function nextChange(rotations: readonly RotationLike[], overrides: readonly OverrideLike[], t: number, o: OnCallOpts): number | null {
  const shifts = finalShifts(rotations, overrides, t, t + 30 * DAY_MS, o);
  return shifts.length > 1 ? shifts[1].start : null;
}

// Business-time arithmetic on a working calendar (docs/spec/services/sla.md §2): weekly working hours (several
// intervals per weekday, overnight shifts allowed), an IANA time zone and holidays (whole or half days). Pure — no
// server or UI imports — so the SLA engine, its jobs, the editors' previews and the tests share one implementation.
//
//   const cal = calendarOf({ timezone: "Asia/Tehran", hours: DEFAULT_HOURS }, [{ date: "2026-03-21", half_day: false }]);
//   addBusiness(cal, Date.parse("2026-03-24T15:00:00+03:30"), 4 * HOUR)   // → the instant 4 working hours later
//   businessBetween(cal, from, to)                                          // → working milliseconds in [from, to)
//
// Rules:
// - Weekdays are indexed from Saturday (0) to Friday (6), the Iranian week (`weekday` in @shared/jalali).
// - An interval [start, end) is in minutes from local midnight ("08:00"–"16:00"); "24:00" is the next midnight; an end
//   at or before its start runs into the next day (an overnight shift "22:00"–"06:00").
// - A shift belongs to the day it starts on: a holiday removes the shifts that start on it (also the part of an
//   overnight shift after midnight); a half-day holiday keeps the first half of that day's working time.
// - Local times become instants in the calendar's zone: exact on DST-free zones such as Asia/Tehran, and on days with
//   a DST change each boundary is resolved on its own (a wall time inside a spring-forward gap moves forward).
// - No calendar (`null`) means wall-clock time, 24 × 7.
import { addDays, weekday } from "../jalali";
import { localDate, tzOffsetMs, zonedMidnight } from "../model/jalali-buckets";

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Working intervals of one weekday: [start, end] in minutes from local midnight (end ≤ start = overnight). */
export type DayHours = [number, number][];
/** Seven weekdays, Saturday first. */
export type WeekHours = DayHours[];
/** How working hours are stored (the `hours` JSON of a calendar): seven lists of ["HH:MM", "HH:MM"] pairs. */
export type HoursJson = [string, string][][];

export interface HolidayDay {
  /** a half working day: only the first half of the day's working time counts */
  half?: boolean;
  title?: string;
}

/** A working calendar ready for arithmetic. */
export interface BusinessCalendar {
  tz: string;
  week: WeekHours;
  /** local ISO dates (in `tz`) that are holidays */
  holidays: ReadonlyMap<string, HolidayDay>;
}

/** Saturday–Wednesday 08:00–16:00, Thursday 08:00–12:00, Friday off (the default office calendar). */
export const DEFAULT_HOURS: HoursJson = [
  [["08:00", "16:00"]],
  [["08:00", "16:00"]],
  [["08:00", "16:00"]],
  [["08:00", "16:00"]],
  [["08:00", "16:00"]],
  [["08:00", "12:00"]],
  [],
];

/** Every hour of every day. */
export const FULL_HOURS: HoursJson = Array.from({ length: 7 }, () => [["00:00", "24:00"]] as [string, string][]);

const TIME = /^([01]?\d|2[0-4]):([0-5]\d)$/;

/** "08:30" → 510 (minutes); "24:00" → 1440; null when not a time of day. */
export function parseTime(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = TIME.exec(s.trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h === 24 && mi !== 0) return null;
  return h * 60 + mi;
}

/** 510 → "08:30". */
export function formatTime(min: number): string {
  const h = Math.floor(min / 60);
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Why `raw` is not a valid week of working hours (Persian), or null. */
export function hoursProblem(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length !== 7) return "ساعات کاری باید برای هر هفت روز هفته (از شنبه) تعیین شود";
  for (let d = 0; d < 7; d++) {
    const day = raw[d];
    if (!Array.isArray(day)) return "ساعات کاری هر روز باید فهرستی از بازه‌ها باشد";
    if (day.length > 12) return "هر روز حداکثر دوازده بازهٔ کاری دارد";
    const spans: [number, number][] = [];
    for (const pair of day) {
      if (!Array.isArray(pair) || pair.length !== 2) return "هر بازهٔ کاری یک ساعت شروع و یک ساعت پایان دارد";
      const a = parseTime(pair[0]);
      const b = parseTime(pair[1]);
      if (a === null || b === null) return `«${String(pair[0])}–${String(pair[1])}» ساعت معتبری نیست (مانند ۰۸:۰۰)`;
      if (a === 1440) return "شروع بازه نمی‌تواند ۲۴:۰۰ باشد";
      spans.push([a, b > a ? b : b + 1440]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) return "بازه‌های کاری یک روز هم‌پوشانی دارند";
    if (spans.length && spans[spans.length - 1][1] - spans[0][0] > 2 * 1440) return "بازه‌های کاری یک روز بیش از حد طولانی است";
  }
  return null;
}

/** The stored JSON as minutes (invalid entries left out). */
export function parseHours(raw: unknown): WeekHours {
  const week: WeekHours = [];
  for (let d = 0; d < 7; d++) {
    const day = Array.isArray(raw) && Array.isArray(raw[d]) ? (raw[d] as unknown[]) : [];
    const out: DayHours = [];
    for (const pair of day) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const a = parseTime(pair[0]);
      const b = parseTime(pair[1]);
      if (a === null || b === null || a === 1440) continue;
      out.push([a, b]);
    }
    out.sort((x, y) => x[0] - y[0]);
    week.push(out);
  }
  return week;
}

/** Minutes as the stored JSON. */
export function formatHours(week: WeekHours): HoursJson {
  return week.map((day) => day.map(([a, b]) => [formatTime(a), formatTime(b)] as [string, string]));
}

/** Length of an interval in minutes (overnight intervals run into the next day). */
export const spanMinutes = ([a, b]: [number, number]): number => (b > a ? b - a : b + 1440 - a);

/** Working minutes of each weekday. */
export function weekMinutes(week: WeekHours): number[] {
  return week.map((day) => day.reduce((s, x) => s + spanMinutes(x), 0));
}

/** A calendar from a stored row (`timezone`, `hours`) and its holidays (`date`, `half_day`, `title`). */
export function calendarOf(row: { timezone?: string | null; hours?: unknown }, holidays: readonly { date: string; half_day?: boolean | null; title?: string | null }[] = [], fallbackTz = "Asia/Tehran"): BusinessCalendar {
  const map = new Map<string, HolidayDay>();
  for (const h of holidays) {
    const d = String(h.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const prev = map.get(d);
    // a whole-day holiday wins over a half day on the same date
    if (prev && !prev.half) continue;
    map.set(d, { half: !!h.half_day, title: h.title ?? undefined });
  }
  return { tz: row.timezone || fallbackTz, week: parseHours(row.hours ?? DEFAULT_HOURS), holidays: map };
}

// ---------------------------------------------------------------------------------------------------------------
// Local times → instants

const midnights = new Map<string, number>();

/** The instant local `date` begins in `tz` (memoised). */
export function midnightOf(date: string, tz: string): number {
  const key = `${tz}|${date}`;
  let v = midnights.get(key);
  if (v === undefined) {
    if (midnights.size > 50_000) midnights.clear();
    v = zonedMidnight(date, tz);
    midnights.set(key, v);
  }
  return v;
}

/** The instant of local `date` + `minutes` (0–2880) in `tz`. */
export function localInstant(date: string, minutes: number, tz: string): number {
  let d = date;
  let m = minutes;
  while (m >= 1440) {
    d = addDays(d, 1);
    m -= 1440;
  }
  const start = midnightOf(d, tz);
  if (m === 0) return start;
  const next = midnightOf(addDays(d, 1), tz);
  // a day without a clock change: wall time is a fixed offset from midnight
  if (next - start === DAY) return start + m * MINUTE;
  // a day with a clock change: the instant whose wall clock reads d + m (the earlier one when the hour repeats; a
  // time inside a skipped hour moves forward by the gap)
  const [y, mo, da] = d.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, da) + m * MINUTE;
  const before = tzOffsetMs(wall - DAY, tz);
  const after = tzOffsetMs(wall + DAY, tz);
  const hits = [before, after].map((o) => wall - o).filter((t) => tzOffsetMs(t, tz) === wall - t);
  return hits.length ? Math.min(...hits) : wall - Math.min(before, after);
}

// ---------------------------------------------------------------------------------------------------------------
// Shifts and intervals

/** The working intervals (epoch ms, [start, end)) of the shifts that start on local `date`. */
export function shiftsOf(cal: BusinessCalendar, date: string): [number, number][] {
  const h = cal.holidays.get(date);
  if (h && !h.half) return [];
  const day = cal.week[weekday(date)] ?? [];
  const out: [number, number][] = [];
  for (const [a, b] of day) {
    const s = localInstant(date, a, cal.tz);
    const e = localInstant(date, b > a ? b : b + 1440, cal.tz);
    if (e > s) out.push([s, e]);
  }
  if (!h?.half || !out.length) return out;
  // a half day keeps the first half of the day's working time
  let keep = out.reduce((n, [s, e]) => n + (e - s), 0) / 2;
  const half: [number, number][] = [];
  for (const [s, e] of out) {
    if (keep <= 0) break;
    const len = Math.min(e - s, keep);
    half.push([s, s + len]);
    keep -= len;
  }
  return half;
}

function merge(list: [number, number][]): [number, number][] {
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const [s, e] of list) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Days per block of generated intervals. */
const BLOCK = 21;
/** How far ahead `addBusiness` looks before it gives up (about ten years). */
export const HORIZON_DAYS = 3660;

/**
 * Working intervals of the local days `first` … `first + n - 1` (and the overnight shifts of the day before),
 * merged, clipped to [from, until) where `until` is the start of day `first + n` (later shifts are not generated).
 */
function block(cal: BusinessCalendar, first: string, n: number, from: number): { intervals: [number, number][]; until: number; next: string } {
  const raw: [number, number][] = [];
  for (let i = -1; i < n; i++) raw.push(...shiftsOf(cal, addDays(first, i)));
  const nextDay = addDays(first, n);
  const until = midnightOf(nextDay, cal.tz);
  const intervals = merge(raw)
    .map(([s, e]) => [Math.max(s, from), Math.min(e, until)] as [number, number])
    .filter(([s, e]) => e > s);
  return { intervals, until, next: nextDay };
}

/** Does the week have any working time at all? */
export const hasWorkingTime = (cal: BusinessCalendar): boolean => cal.week.some((d) => d.some((x) => spanMinutes(x) > 0));

/** Working intervals that intersect [from, to), clipped to it. */
export function workingIntervals(cal: BusinessCalendar, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  if (!(to > from)) return out;
  let day = localDate(from, cal.tz);
  let cursor = from;
  for (let guard = 0; cursor < to && guard < 2000; guard++) {
    const b = block(cal, day, BLOCK, cursor);
    for (const [s, e] of b.intervals) {
      if (s >= to) break;
      out.push([s, Math.min(e, to)]);
    }
    cursor = Math.max(cursor, b.until);
    day = b.next;
  }
  return out;
}

/** Working milliseconds in [from, to) (0 when `to` ≤ `from`); wall-clock time without a calendar. */
export function businessBetween(cal: BusinessCalendar | null, from: number, to: number): number {
  if (!(to > from)) return 0;
  if (!cal) return to - from;
  return workingIntervals(cal, from, to).reduce((n, [s, e]) => n + (e - s), 0);
}

/**
 * The instant at which `duration` ms of working time have passed since `start` (wall-clock without a calendar).
 * A zero duration is `start` itself. Null when the calendar has no working time within the horizon.
 */
export function addBusiness(cal: BusinessCalendar | null, start: number, duration: number): number | null {
  if (!(duration > 0)) return start;
  if (!cal) return start + duration;
  if (!hasWorkingTime(cal)) return null;
  let left = duration;
  let day = localDate(start, cal.tz);
  let cursor = start;
  for (let days = 0; days <= HORIZON_DAYS; days += BLOCK) {
    const b = block(cal, day, BLOCK, cursor);
    for (const [s, e] of b.intervals) {
      const len = e - s;
      if (len >= left) return s + left;
      left -= len;
    }
    cursor = Math.max(cursor, b.until);
    day = b.next;
  }
  return null;
}

/** Is `t` inside working time? */
export function isWorking(cal: BusinessCalendar | null, t: number): boolean {
  if (!cal) return true;
  return workingIntervals(cal, t, t + 1).length > 0;
}

/** The first working instant at or after `t` (null when none within the horizon). */
export function nextWorkingInstant(cal: BusinessCalendar | null, t: number): number | null {
  if (!cal) return t;
  if (!hasWorkingTime(cal)) return null;
  let day = localDate(t, cal.tz);
  let cursor = t;
  for (let days = 0; days <= HORIZON_DAYS; days += BLOCK) {
    const b = block(cal, day, BLOCK, cursor);
    if (b.intervals.length) return b.intervals[0][0];
    cursor = Math.max(cursor, b.until);
    day = b.next;
  }
  return null;
}

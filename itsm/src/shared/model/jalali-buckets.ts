// Calendar windows in an organisation's time zone, on the Jalali calendar: the boundaries of a day, a week (Saturday
// to Friday), a month, a quarter (spring/summer/autumn/winter) or a year. Relative-date conditions («۷ روز گذشته»,
// «این ماه») and date buckets of aggregates are computed here — once, in JS — and handed to SQL as parameters, so the
// database and `evaluate()` always agree. Dates are ISO `YYYY-MM-DD` strings; instants are epoch milliseconds.
import { addDays, formatJalali, fromJalali, JALALI_MONTHS, toFa, toJalali, weekday } from "../jalali";

export type DateUnit = "day" | "week" | "month" | "quarter" | "year";
export const DATE_UNITS: Record<DateUnit, string> = { day: "روز", week: "هفته", month: "ماه", quarter: "فصل", year: "سال" };
export const QUARTERS = ["بهار", "تابستان", "پاییز", "زمستان"] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    formatters.set(tz, f);
  }
  return f;
}

function wallClock(ms: number, tz: string) {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (local wall clock = UTC + offset). */
export function tzOffsetMs(ms: number, tz: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const w = wallClock(whole, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - whole;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The calendar date (ISO) of instant `ms` in `tz`. */
export function localDate(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

/** The instant (epoch ms) at which `isoDate` begins in `tz` (local midnight). */
export function zonedMidnight(isoDate: string, tz: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(guess, tz);
  const second = tzOffsetMs(first, tz);
  return guess - second;
}

/** First day (ISO) of the unit that contains `isoDate` — weeks start on Saturday, months are Jalali. */
export function unitStart(isoDate: string, unit: DateUnit): string {
  const iso = isoDate.slice(0, 10);
  switch (unit) {
    case "day":
      return iso;
    case "week":
      return addDays(iso, -weekday(iso));
    case "month": {
      const j = toJalali(iso);
      return fromJalali(j.jy, j.jm, 1);
    }
    case "quarter": {
      const j = toJalali(iso);
      return fromJalali(j.jy, Math.floor((j.jm - 1) / 3) * 3 + 1, 1);
    }
    case "year":
      return fromJalali(toJalali(iso).jy, 1, 1);
  }
}

/** The start of the unit `n` units after the unit starting at `start` (n may be negative). */
export function addUnits(start: string, unit: DateUnit, n: number): string {
  if (unit === "day") return addDays(start, n);
  if (unit === "week") return addDays(start, 7 * n);
  const j = toJalali(start);
  if (unit === "year") return fromJalali(j.jy + n, 1, 1);
  const months = j.jy * 12 + (j.jm - 1) + (unit === "quarter" ? 3 * n : n);
  return fromJalali(Math.floor(months / 12), (months % 12) + 1, 1);
}

/** A relative window: offsets (inclusive) from the current unit, e.g. {unit:"day", from:-6, to:0} = the last 7 days. */
export interface RelativeWindow {
  unit: DateUnit;
  from: number;
  to: number;
}

/** Dates [from, to) of a relative window around `now` in `tz`. */
export function windowDates(w: RelativeWindow, now: number, tz: string): { from: string; to: string } {
  const current = unitStart(localDate(now, tz), w.unit);
  return { from: addUnits(current, w.unit, w.from), to: addUnits(current, w.unit, w.to + 1) };
}

/** Instants [from, to) of a relative window (local midnights of its first day and of the day after it). */
export function windowInstants(w: RelativeWindow, now: number, tz: string): { from: number; to: number } {
  const d = windowDates(w, now, tz);
  return { from: zonedMidnight(d.from, tz), to: zonedMidnight(d.to, tz) };
}

/**
 * Starts (ISO dates) of every bucket of `unit` from the one containing `minDate` to the one containing `maxDate`, at
 * most `cap` of them (the rest falls into the last one). Used as `width_bucket` thresholds.
 */
export function bucketStarts(minDate: string, maxDate: string, unit: DateUnit, cap = 2000): string[] {
  const out: string[] = [];
  let at = unitStart(minDate, unit);
  const last = unitStart(maxDate, unit);
  while (at <= last && out.length < cap) {
    out.push(at);
    at = addUnits(at, unit, 1);
  }
  return out.length ? out : [unitStart(minDate, unit)];
}

/** Stable key of a bucket: 2026-03-21 (day, week), 1405-01 (month), 1405-Q1 (quarter), 1405 (year). */
export function bucketKey(start: string, unit: DateUnit): string {
  if (unit === "day" || unit === "week") return start;
  const j = toJalali(start);
  if (unit === "month") return `${j.jy}-${pad(j.jm)}`;
  if (unit === "quarter") return `${j.jy}-Q${Math.floor((j.jm - 1) / 3) + 1}`;
  return String(j.jy);
}

/** Persian label of a bucket: «۱۴۰۵/۰۱/۱۵»، «هفتهٔ ۱۴۰۵/۰۱/۱۵»، «فروردین ۱۴۰۵»، «بهار ۱۴۰۵»، «۱۴۰۵». */
export function bucketLabel(start: string, unit: DateUnit): string {
  const j = toJalali(start);
  switch (unit) {
    case "day":
      return formatJalali(start);
    case "week":
      return `هفتهٔ ${formatJalali(start)}`;
    case "month":
      return `${JALALI_MONTHS[j.jm - 1]} ${toFa(j.jy)}`;
    case "quarter":
      return `${QUARTERS[Math.floor((j.jm - 1) / 3)]} ${toFa(j.jy)}`;
    case "year":
      return toFa(j.jy);
  }
}

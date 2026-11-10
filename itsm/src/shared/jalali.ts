// Jalali (Persian/Shamsi) calendar helpers. Dates are stored as ISO Gregorian `YYYY-MM-DD`
// strings everywhere (database, API); the UI shows and accepts Jalali dates.
import { toJalaali, toGregorian, jalaaliMonthLength, isValidJalaaliDate } from "jalaali-js";
import { normalizeDigits } from "./money";

export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

/** Index 0 = Saturday (شنبه) — the first day of the Persian week. */
export const WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"] as const;
export const WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

export interface JDate {
  jy: number;
  jm: number;
  jd: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function isoFromParts(gy: number, gm: number, gd: number): string {
  return `${pad(gy, 4)}-${pad(gm)}-${pad(gd)}`;
}

export function parseISO(iso: string): { gy: number; gm: number; gd: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { gy: y, gm: m, gd: d };
}

export function toJalali(iso: string): JDate {
  const { gy, gm, gd } = parseISO(iso);
  return toJalaali(gy, gm, gd);
}

export function fromJalali(jy: number, jm: number, jd: number): string {
  const g = toGregorian(jy, jm, jd);
  return isoFromParts(g.gy, g.gm, g.gd);
}

export function monthLength(jy: number, jm: number): number {
  return jaalaliMonthLengthSafe(jy, jm);
}
function jaalaliMonthLengthSafe(jy: number, jm: number) {
  try {
    return jalaaliMonthLength(jy, jm);
  } catch {
    return 30;
  }
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  try {
    return isValidJalaaliDate(jy, jm, jd);
  } catch {
    return false;
  }
}

/** Today's date (ISO) in the given IANA time zone (default Tehran). */
export function todayISO(timeZone = "Asia/Tehran"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * The calendar date (YYYY-MM-DD) of an instant in a time zone (a goods receipt at 01:30 Tehran on the first of a month
 * belongs to that month, not to the UTC day before); a plain date is returned as it is.
 */
export function dateISOIn(v: string | number | Date, timeZone = "Asia/Tehran"): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function addDays(iso: string, days: number): string {
  const { gy, gm, gd } = parseISO(iso);
  const t = Date.UTC(gy, gm - 1, gd) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pa.gy, pa.gm - 1, pa.gd) - Date.UTC(pb.gy, pb.gm - 1, pb.gd)) / 86400000);
}

/** Day of week, 0 = Saturday. */
export function weekday(iso: string): number {
  const { gy, gm, gd } = parseISO(iso);
  const js = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // 0 = Sunday
  return (js + 1) % 7;
}

export function toFa(s: string | number): string {
  return String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** `1404/08/10` (Persian digits by default). */
export function formatJalali(iso: string | null | undefined, opts: { latin?: boolean; style?: "short" | "long" | "full" | "month" } = {}): string {
  if (!iso) return "";
  const d = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const { jy, jm, jd } = toJalali(d);
  let out: string;
  switch (opts.style) {
    case "long":
      out = `${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
      break;
    case "full":
      out = `${WEEKDAYS[weekday(d)]} ${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
      break;
    case "month":
      out = `${JALALI_MONTHS[jm - 1]} ${jy}`;
      break;
    default:
      out = `${jy}/${pad(jm)}/${pad(jd)}`;
  }
  return opts.latin ? out : toFa(out);
}

/** Date and time of a timestamp in Tehran time, e.g. `۱۴۰۴/۰۸/۱۰ ۱۴:۰۵`. */
export function formatJalaliDateTime(ts: string | null | undefined, timeZone = "Asia/Tehran"): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  const hh = get("hour") === "24" ? "00" : get("hour");
  return `${formatJalali(iso)} ${toFa(`${hh}:${get("minute")}`)}`;
}

/**
 * Parse what a user typed as a Jalali date. Accepts `1404/8/10`, `۱۴۰۴-۰۸-۱۰`, `14040810`,
 * `8/10` (this year), `10` (this month) and `امروز` / `دیروز` / `فردا`. Returns ISO or null.
 */
export function parseJalaliInput(input: string, todayIso = todayISO()): string | null {
  const s = normalizeDigits(String(input || "")).trim();
  if (!s) return null;
  if (s === "امروز") return todayIso;
  if (s === "دیروز") return addDays(todayIso, -1);
  if (s === "فردا") return addDays(todayIso, 1);
  const t = toJalali(todayIso);
  let jy: number, jm: number, jd: number;
  const compact = s.replace(/\s/g, "");
  if (/^\d{8}$/.test(compact)) {
    jy = Number(compact.slice(0, 4));
    jm = Number(compact.slice(4, 6));
    jd = Number(compact.slice(6, 8));
  } else {
    const parts = compact.split(/[/\-.\\]/).filter(Boolean).map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return null;
    if (parts.length === 3) {
      [jy, jm, jd] = parts;
      if (jy < 100) jy += 1400;
    } else if (parts.length === 2) {
      jy = t.jy;
      [jm, jd] = parts;
    } else if (parts.length === 1) {
      jy = t.jy;
      jm = t.jm;
      jd = parts[0];
    } else return null;
  }
  if (!isValidJalali(jy, jm, jd)) return null;
  return fromJalali(jy, jm, jd);
}

/** First and last day (ISO) of a Jalali year. */
export function jalaliYearRange(jy: number): { start: string; end: string } {
  return { start: fromJalali(jy, 1, 1), end: fromJalali(jy, 12, monthLength(jy, 12)) };
}

/** First and last day (ISO) of a Jalali month. */
export function jalaliMonthRange(jy: number, jm: number): { start: string; end: string } {
  return { start: fromJalali(jy, jm, 1), end: fromJalali(jy, jm, monthLength(jy, jm)) };
}

export function currentJalaliYear(todayIso = todayISO()): number {
  return toJalali(todayIso).jy;
}

/** ISO range shortcuts used by report filters. */
export function presetRange(preset: "today" | "week" | "month" | "lastMonth" | "quarter" | "year", todayIso = todayISO()) {
  const t = toJalali(todayIso);
  switch (preset) {
    case "today":
      return { from: todayIso, to: todayIso };
    case "week": {
      const wd = weekday(todayIso);
      return { from: addDays(todayIso, -wd), to: addDays(todayIso, 6 - wd) };
    }
    case "month":
      return { from: jalaliMonthRange(t.jy, t.jm).start, to: jalaliMonthRange(t.jy, t.jm).end };
    case "lastMonth": {
      const jm = t.jm === 1 ? 12 : t.jm - 1;
      const jy = t.jm === 1 ? t.jy - 1 : t.jy;
      const r = jalaliMonthRange(jy, jm);
      return { from: r.start, to: r.end };
    }
    case "quarter": {
      const q = Math.floor((t.jm - 1) / 3);
      return { from: fromJalali(t.jy, q * 3 + 1, 1), to: jalaliMonthRange(t.jy, q * 3 + 3).end };
    }
    case "year":
    default:
      return { from: jalaliYearRange(t.jy).start, to: jalaliYearRange(t.jy).end };
  }
}

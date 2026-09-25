import { toGregorian, toJalaali, jalaaliMonthLength } from "jalaali-js";
import { faNum } from "./utils";

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export const WEEKDAYS_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const TZ = "Asia/Tehran";

export interface JDate {
  jy: number;
  jm: number;
  jd: number;
}

/** Parts of a Date in Tehran time. */
function tehranParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
  };
}

export function toJDate(input: Date | string): JDate {
  const d = typeof input === "string" ? parseDateish(input) : input;
  const p = tehranParts(d);
  return toJalaali(p.y, p.m, p.d);
}

/** "YYYY-MM-DD" (a date-only string) is treated as a calendar date, not a UTC instant. */
function parseDateish(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  }
  return new Date(s);
}

export function jalaliToIso(j: JDate): string {
  const g = toGregorian(j.jy, j.jm, j.jd);
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
}

export function monthLength(jy: number, jm: number) {
  return jaalaliSafe(() => jalaaliMonthLength(jy, jm), 30);
}

function jaalaliSafe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Weekday index where Saturday = 0. */
export function jWeekday(j: JDate): number {
  const iso = jalaliToIso(j);
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (wd + 1) % 7;
}

export function formatJalali(input: Date | string | null | undefined, opts: { withTime?: boolean; short?: boolean } = {}): string {
  if (!input) return "—";
  const d = typeof input === "string" ? parseDateish(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  const j = toJDate(d);
  const date = opts.short
    ? `${faNum(j.jy)}/${faNum(String(j.jm).padStart(2, "0"))}/${faNum(String(j.jd).padStart(2, "0"))}`
    : `${faNum(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy)}`;
  if (!opts.withTime) return date;
  const p = tehranParts(d);
  return `${date}، ساعت ${faNum(String(p.h).padStart(2, "0"))}:${faNum(String(p.min).padStart(2, "0"))}`;
}

export function formatTime(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = typeof input === "string" ? new Date(input) : input;
  const p = tehranParts(d);
  return `${faNum(String(p.h).padStart(2, "0"))}:${faNum(String(p.min).padStart(2, "0"))}`;
}

export function timeAgo(input: Date | string | null | undefined): string {
  if (!input) return "";
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60) return "چند ثانیه دیگر";
    if (ahead < 3600) return `${faNum(Math.round(ahead / 60))} دقیقه دیگر`;
    if (ahead < 86400) return `${faNum(Math.round(ahead / 3600))} ساعت دیگر`;
    return `${faNum(Math.round(ahead / 86400))} روز دیگر`;
  }
  if (diff < 45) return "همین الان";
  if (diff < 3600) return `${faNum(Math.max(1, Math.round(diff / 60)))} دقیقه پیش`;
  if (diff < 86400) return `${faNum(Math.round(diff / 3600))} ساعت پیش`;
  if (diff < 86400 * 30) return `${faNum(Math.round(diff / 86400))} روز پیش`;
  return formatJalali(d);
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${faNum(s)} ثانیه`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${faNum(m)} دقیقه${s % 60 ? ` و ${faNum(s % 60)} ثانیه` : ""}`;
  const h = Math.floor(m / 60);
  return `${faNum(h)} ساعت${m % 60 ? ` و ${faNum(m % 60)} دقیقه` : ""}`;
}

export function todayJalali(): JDate {
  return toJDate(new Date());
}

/** "۱ مهر ۱۴۰۵ ← ۱۵ مهر ۱۴۰۵" or a friendly fallback when dates are missing. */
export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "بدون تاریخ";
  if (!start) return `مهلت: ${formatJalali(end)}`;
  if (!end) return `از ${formatJalali(start)}`;
  return `${formatJalali(start)} ← ${formatJalali(end)}`;
}

import { latinDigits, num, type Lang } from "@/lib/format";

/**
 * Whole Tehran days in the Persian (Jalali) calendar, client-safe and without a dependency: the conversion is the
 * browser's / Node's own Intl Persian calendar — the same one formatDate() prints with — and Tehran's offset comes
 * from the Asia/Tehran time zone, so a day always starts at Tehran's midnight (whatever the offset of that date).
 */

export interface JalaliDay {
  jy: number;
  jm: number;
  jd: number;
}

const DAY = 86_400_000;

let civil: Intl.DateTimeFormat | null = null;
let tehran: Intl.DateTimeFormat | null = null;

function parts(f: Intl.DateTimeFormat, ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = Number(latinDigits(p.value));
  return out;
}

/** The Jalali date of a UTC calendar date (the civil conversion, no time zone involved). */
function jalaliOfCivil(utcMidnight: number): JalaliDay {
  civil ??= new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
  const p = parts(civil, utcMidnight + DAY / 2);
  return { jy: p.year, jm: p.month, jd: p.day };
}

/** Tehran's wall clock at an instant, read as if it were UTC (so wall − instant = Tehran's offset then). */
function tehranWall(ms: number): number {
  tehran ??= new Intl.DateTimeFormat("en-US-u-nu-latn", { timeZone: "Asia/Tehran", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p = parts(tehran, ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** The Jalali day in Tehran at an instant. */
export function toJalali(ms: number): JalaliDay {
  const wall = tehranWall(ms);
  return jalaliOfCivil(Math.floor(wall / DAY) * DAY);
}

/** The instant Tehran's day starts (its midnight), or null for a day that does not exist (Esfand 30 of a common year, Mehr 31…). */
export function tehranDayStart(jy: number, jm: number, jd: number): number | null {
  if (![jy, jm, jd].every(Number.isInteger) || jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  // Nowruz falls on 19–22 March; the day of the year from it is exact, so a few days either side find the date
  const estimate = Date.UTC(jy + 621, 2, 21) + ((jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + jd - 1) * DAY;
  for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
    const g = estimate + shift * DAY;
    const j = jalaliOfCivil(g);
    if (j.jy === jy && j.jm === jm && j.jd === jd) {
      // Tehran's midnight of that civil date: the UTC instant whose wall clock reads 00:00 (at that moment's offset)
      const guess = g - 3.5 * 3_600_000;
      let start = g - (tehranWall(guess) - guess);
      const drift = tehranWall(start) - g;
      if (drift) start -= drift;
      return start;
    }
  }
  return null;
}

/** The first moment after a Tehran day: the start of the next day (a day lasts 23–25 hours where clocks change). */
export function tehranDayEnd(jy: number, jm: number, jd: number): number | null {
  const start = tehranDayStart(jy, jm, jd);
  if (start === null) return null;
  const next = toJalali(start + 26 * 3_600_000);
  return tehranDayStart(next.jy, next.jm, next.jd);
}

/** «۱۴۰۵/۰۹/۳۰» (or 1405/09/30) → the day, accepting Persian or Latin digits and / - . as separators; null when it is not a date. */
export function parseJalali(input: string): JalaliDay | null {
  const m = /^\s*(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*$/.exec(latinDigits(String(input ?? "")));
  if (!m) return null;
  const day = { jy: Number(m[1]), jm: Number(m[2]), jd: Number(m[3]) };
  return tehranDayStart(day.jy, day.jm, day.jd) === null ? null : day;
}

/** A day as the form writes it: «۱۴۰۵/۰۹/۳۰» / "1405/09/30". */
export function formatJalaliDay(d: JalaliDay, lang: Lang): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return num(`${d.jy}/${two(d.jm)}/${two(d.jd)}`, lang);
}

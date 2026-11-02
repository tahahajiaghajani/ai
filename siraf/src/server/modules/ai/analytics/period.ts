// Periods and time buckets for the assistant's tools and the AI features. The model names a
// Jalali preset («this_month», «last_quarter», «fiscal_year»…) or explicit dates (Jalali
// «۱۴۰۵/۰۸/۰۱» or ISO); the server resolves them against the business's own "today" and echoes
// the result with Persian labels, so an answer always states the exact range it covers.
// Pure: no database access (fiscal years are passed in).
import {
  JALALI_MONTHS, addDays, diffDays, formatJalali, fromJalali, jalaliMonthRange, jalaliYearRange, monthLength,
  parseJalaliInput, toFa, toJalali, weekday,
} from "@shared/jalali";
import { normalizeDigits } from "@shared/money";

export const PERIOD_PRESETS = [
  "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_quarter", "last_quarter",
  "this_year", "last_year", "month_to_date", "year_to_date", "fiscal_year", "last_fiscal_year",
  "last_7_days", "last_30_days", "last_90_days", "last_365_days",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const COMPARE_MODES = ["previous_period", "same_period_last_year"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export interface FiscalYearLite {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status?: string;
}

export interface PeriodInput {
  preset?: PeriodPreset | null;
  /** Jalali (1405/08/01) or ISO (2026-10-23); Persian digits are fine */
  from?: string | null;
  to?: string | null;
}

export interface ResolvedPeriod {
  from: string;
  to: string;
  from_fa: string;
  to_fa: string;
  label_fa: string;
  days: number;
  preset: PeriodPreset | null;
}

export class PeriodError extends Error {}

const SEASONS = ["بهار", "تابستان", "پاییز", "زمستان"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A date the model or a user typed: ISO (Gregorian year ≥ 1800) or Jalali in any common shape. */
export function parseDateInput(input: string, today: string): string | null {
  const s = normalizeDigits(String(input ?? "")).trim().replace(/[‌‏‎]/g, "");
  if (!s) return null;
  if (s === "امروز" || s === "today") return today;
  if (s === "دیروز" || s === "yesterday") return addDays(today, -1);
  if (s === "فردا" || s === "tomorrow") return addDays(today, 1);
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m && Number(m[1]) >= 1800) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (!ISO.test(iso)) return null;
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
  }
  return parseJalaliInput(s, today);
}

/** «۱ مهر تا ۱۵ آبان ۱۴۰۵», «آبان ۱۴۰۵», «پاییز ۱۴۰۵», «سال ۱۴۰۵», «۱۱ آبان ۱۴۰۵». */
export function rangeLabel(from: string, to: string): string {
  const a = toJalali(from);
  const b = toJalali(to);
  if (from === to) return formatJalali(from, { style: "long" });
  const wholeMonths = a.jd === 1 && b.jd === monthLength(b.jy, b.jm);
  if (wholeMonths && a.jy === b.jy && a.jm === 1 && b.jm === 12) return `سال ${toFa(a.jy)}`;
  if (wholeMonths && a.jy === b.jy && a.jm === b.jm) return `${JALALI_MONTHS[a.jm - 1]} ${toFa(a.jy)}`;
  if (wholeMonths && a.jy === b.jy && (a.jm - 1) % 3 === 0 && b.jm === a.jm + 2) return `${SEASONS[(a.jm - 1) / 3]} ${toFa(a.jy)}`;
  const left = a.jy === b.jy ? `${toFa(a.jd)} ${JALALI_MONTHS[a.jm - 1]}` : formatJalali(from, { style: "long" });
  return `${left} تا ${formatJalali(to, { style: "long" })}`;
}

function make(from: string, to: string, preset: PeriodPreset | null): ResolvedPeriod {
  if (from > to) throw new PeriodError("ابتدای بازه بعد از انتهای آن است");
  return { from, to, from_fa: formatJalali(from), to_fa: formatJalali(to), label_fa: rangeLabel(from, to), days: diffDays(to, from) + 1, preset };
}

function monthShift(jy: number, jm: number, by: number): { jy: number; jm: number } {
  const i = jy * 12 + (jm - 1) + by;
  return { jy: Math.floor(i / 12), jm: (i % 12) + 1 };
}

function currentFiscal(fys: FiscalYearLite[], today: string): FiscalYearLite | null {
  return fys.find((f) => f.start_date <= today && f.end_date >= today) ?? null;
}

/** Resolve a preset or explicit dates. `def` is used when nothing is given. */
export function resolvePeriod(input: PeriodInput | null | undefined, today: string, opts: { fiscalYears?: FiscalYearLite[]; def?: PeriodPreset } = {}): ResolvedPeriod {
  const p = input ?? {};
  if (p.preset) return presetPeriod(p.preset, today, opts.fiscalYears ?? []);
  if (p.from || p.to) {
    const from = p.from ? parseDateInput(p.from, today) : null;
    const to = p.to ? parseDateInput(p.to, today) : null;
    if (p.from && !from) throw new PeriodError(`تاریخ «${p.from}» معتبر نیست (نمونه: ۱۴۰۵/۰۸/۰۱)`);
    if (p.to && !to) throw new PeriodError(`تاریخ «${p.to}» معتبر نیست (نمونه: ۱۴۰۵/۰۸/۳۰)`);
    const f = from ?? jalaliYearRange(toJalali(to!).jy).start;
    const t = to ?? today;
    return make(f, t, null);
  }
  return presetPeriod(opts.def ?? "this_month", today, opts.fiscalYears ?? []);
}

export function presetPeriod(preset: PeriodPreset, today: string, fiscalYears: FiscalYearLite[] = []): ResolvedPeriod {
  const t = toJalali(today);
  const wd = weekday(today);
  switch (preset) {
    case "today":
      return make(today, today, preset);
    case "yesterday": {
      const y = addDays(today, -1);
      return make(y, y, preset);
    }
    case "this_week":
      return make(addDays(today, -wd), addDays(today, 6 - wd), preset);
    case "last_week":
      return make(addDays(today, -wd - 7), addDays(today, -wd - 1), preset);
    case "this_month": {
      const r = jalaliMonthRange(t.jy, t.jm);
      return make(r.start, r.end, preset);
    }
    case "last_month": {
      const m = monthShift(t.jy, t.jm, -1);
      const r = jalaliMonthRange(m.jy, m.jm);
      return make(r.start, r.end, preset);
    }
    case "this_quarter":
    case "last_quarter": {
      const q0 = Math.floor((t.jm - 1) / 3) * 3 + 1;
      const s = monthShift(t.jy, q0, preset === "last_quarter" ? -3 : 0);
      return make(fromJalali(s.jy, s.jm, 1), jalaliMonthRange(s.jy, s.jm + 2).end, preset);
    }
    case "this_year": {
      const r = jalaliYearRange(t.jy);
      return make(r.start, r.end, preset);
    }
    case "last_year": {
      const r = jalaliYearRange(t.jy - 1);
      return make(r.start, r.end, preset);
    }
    case "month_to_date":
      return make(jalaliMonthRange(t.jy, t.jm).start, today, preset);
    case "year_to_date":
      return make(jalaliYearRange(t.jy).start, today, preset);
    case "fiscal_year":
    case "last_fiscal_year": {
      const cur = currentFiscal(fiscalYears, today);
      if (preset === "fiscal_year") {
        if (cur) return make(cur.start_date, cur.end_date, preset);
        const r = jalaliYearRange(t.jy);
        return make(r.start, r.end, preset);
      }
      const before = fiscalYears
        .filter((f) => f.end_date < (cur?.start_date ?? today))
        .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
      if (before) return make(before.start_date, before.end_date, preset);
      const r = jalaliYearRange((cur ? toJalali(cur.start_date).jy : t.jy) - 1);
      return make(r.start, r.end, preset);
    }
    case "last_7_days":
      return make(addDays(today, -6), today, preset);
    case "last_30_days":
      return make(addDays(today, -29), today, preset);
    case "last_90_days":
      return make(addDays(today, -89), today, preset);
    case "last_365_days":
      return make(addDays(today, -364), today, preset);
    default:
      throw new PeriodError("بازهٔ زمانی معتبر نیست");
  }
}

/** Is [from, to] made of whole Jalali months? Returns the month count (else 0). */
function wholeMonths(from: string, to: string): number {
  const a = toJalali(from);
  const b = toJalali(to);
  if (a.jd !== 1 || b.jd !== monthLength(b.jy, b.jm)) return 0;
  return (b.jy - a.jy) * 12 + (b.jm - a.jm) + 1;
}

/** Same Jalali day one year earlier (the last day of a shorter month when it does not exist). */
function lastYear(iso: string): string {
  const j = toJalali(iso);
  const jd = Math.min(j.jd, monthLength(j.jy - 1, j.jm));
  return fromJalali(j.jy - 1, j.jm, jd);
}

/** The period a comparison is made against. Whole Jalali months shift by whole months. */
export function comparePeriod(p: ResolvedPeriod, mode: CompareMode): ResolvedPeriod {
  if (mode === "same_period_last_year") {
    const months = wholeMonths(p.from, p.to);
    if (months) {
      const a = toJalali(p.from);
      const s = monthShift(a.jy - 1, a.jm, 0);
      const e = monthShift(s.jy, s.jm, months - 1);
      return make(fromJalali(s.jy, s.jm, 1), jalaliMonthRange(e.jy, e.jm).end, null);
    }
    return make(lastYear(p.from), lastYear(p.to), null);
  }
  const months = wholeMonths(p.from, p.to);
  if (months) {
    const a = toJalali(p.from);
    const s = monthShift(a.jy, a.jm, -months);
    const e = monthShift(s.jy, s.jm, months - 1);
    return make(fromJalali(s.jy, s.jm, 1), jalaliMonthRange(e.jy, e.jm).end, null);
  }
  return make(addDays(p.from, -p.days), addDays(p.from, -1), null);
}

// ---------------------------------------------------------------- time buckets

export type TimeGrain = "day" | "week" | "month";

/** Bucket of a date: the date itself, the Saturday that starts its week, or its Jalali month «1405-08». */
export function bucketKey(iso: string, grain: TimeGrain): string {
  if (grain === "day") return iso;
  if (grain === "week") return addDays(iso, -weekday(iso));
  const j = toJalali(iso);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

export function bucketRange(key: string, grain: TimeGrain): { from: string; to: string } {
  if (grain === "day") return { from: key, to: key };
  if (grain === "week") return { from: key, to: addDays(key, 6) };
  const [jy, jm] = key.split("-").map(Number);
  const r = jalaliMonthRange(jy, jm);
  return { from: r.start, to: r.end };
}

export function bucketLabel(key: string, grain: TimeGrain): string {
  if (grain === "day") return formatJalali(key, { style: "long" });
  if (grain === "week") return `هفتهٔ ${formatJalali(key, { style: "long" })}`;
  const [jy, jm] = key.split("-").map(Number);
  return `${JALALI_MONTHS[jm - 1]} ${toFa(jy)}`;
}

/** Every bucket key from `from` to `to` in order (gaps filled). */
export function bucketsBetween(from: string, to: string, grain: TimeGrain, max = 1200): string[] {
  const out: string[] = [];
  let k = bucketKey(from, grain);
  while (out.length < max) {
    out.push(k);
    const next = addDays(bucketRange(k, grain).to, 1);
    if (next > to) break;
    k = bucketKey(next, grain);
  }
  return out;
}

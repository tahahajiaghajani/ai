// Pure logic of supplier and contract management, shared by the server and the screens (tests:
// tests/supplier-logic.test.ts): notice dates, Jalali month arithmetic for renewals, which reminder is due (once per
// threshold), what happens to a contract past its end (expire or renew automatically), the renewal calendar's month
// buckets and the weighted supplier scorecard.
import { addDays, diffDays, fromJalali, JALALI_MONTHS, monthLength, toJalali } from "../jalali";
import { faDigits } from "../format";

/** The last day to give notice: `end` minus the notice period (null without an end). */
export function noticeDate(end: string | null | undefined, noticeDays: number | null | undefined): string | null {
  if (!end) return null;
  return addDays(end, -Math.max(0, Number(noticeDays ?? 0)));
}

/** `iso` plus `months` Jalali months, the day kept where the month has it (31 Shahrivar + 1 month → 30 Mehr). */
export function addJalaliMonths(iso: string, months: number): string {
  const j = toJalali(iso);
  const idx = j.jy * 12 + (j.jm - 1) + Math.trunc(months);
  const jy = Math.floor(idx / 12);
  const jm = (idx % 12) + 1;
  return fromJalali(jy, jm, Math.min(j.jd, monthLength(jy, jm)));
}

/**
 * The reminder due for a date `target` on `today`: the smallest threshold (days before) already reached that was not
 * sent. Thresholds passed over together are announced once (the nearest), like an SLA's warnings.
 */
export function dueReminder(target: string | null | undefined, today: string, thresholds: number[], sent: number[] = []): { threshold: number; days_left: number; skipped: number[] } | null {
  if (!target) return null;
  const left = diffDays(target, today);
  if (left < 0) return null;
  const reached = [...new Set(thresholds.filter((t) => Number.isFinite(t) && t >= 0))].sort((a, b) => a - b).filter((t) => left <= t && !sent.includes(t));
  if (!reached.length) return null;
  return { threshold: reached[0], days_left: left, skipped: reached.slice(1) };
}

/** Clean reminder thresholds (days), at most eight, descending. */
export function reminderList(v: unknown, fallback: number[] = [90, 60, 30, 7]): number[] {
  const xs = Array.isArray(v) ? v.map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 0 && x <= 3650) : [];
  return [...new Set(xs.length ? xs : fallback)].sort((a, b) => b - a).slice(0, 8);
}

export interface ContractLike {
  state?: string | null;
  end_date?: string | null;
  renewal_type?: string | null;
  renewal_term_months?: number | null;
}

/** What a contract past its end becomes on `today`: renewed automatically (its new end), expired, or nothing yet. */
export function endOutcome(c: ContractLike, today: string): { action: "none" } | { action: "expire" } | { action: "renew"; end_date: string; terms: number } {
  if (c.state !== "active" || !c.end_date || c.end_date >= today) return { action: "none" };
  if (c.renewal_type === "auto") {
    const term = Math.max(1, Number(c.renewal_term_months ?? 12));
    let end = c.end_date;
    let terms = 0;
    while (end < today && terms < 120) {
      end = addJalaliMonths(end, term);
      terms++;
    }
    return { action: "renew", end_date: end, terms };
  }
  return { action: "expire" };
}

export interface CalendarEntry {
  date: string;
  kind: "notice" | "end" | "renewal" | "warranty" | "lease" | "entitlement" | "obligation" | "guarantee";
  table: string;
  id: string;
  title: string;
  number?: string | null;
  amount?: string | null;
}

export const ENTRY_LABELS: Record<CalendarEntry["kind"], string> = {
  notice: "آخرین مهلت اعلام",
  end: "پایان قرارداد",
  renewal: "تمدید اشتراک",
  warranty: "پایان ضمانت",
  lease: "پایان اجاره",
  entitlement: "پایان مجوز",
  obligation: "موعد تعهد",
  guarantee: "پایان اعتبار ضمانت‌نامه",
};

/** Entries grouped by Jalali month from `from` for `months` months (empty months kept, in order). */
export function calendarMonths(entries: CalendarEntry[], from: string, months: number): { key: string; label: string; start: string; end: string; entries: CalendarEntry[] }[] {
  const j = toJalali(from);
  const out: { key: string; label: string; start: string; end: string; entries: CalendarEntry[] }[] = [];
  for (let i = 0; i < Math.max(1, Math.min(36, months)); i++) {
    const idx = j.jy * 12 + (j.jm - 1) + i;
    const jy = Math.floor(idx / 12);
    const jm = (idx % 12) + 1;
    const start = fromJalali(jy, jm, 1);
    const end = fromJalali(jy, jm, monthLength(jy, jm));
    out.push({
      key: `${jy}-${String(jm).padStart(2, "0")}`,
      label: `${JALALI_MONTHS[jm - 1]} ${faDigits(jy)}`,
      start,
      end,
      entries: entries.filter((e) => e.date >= start && e.date <= end).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title, "fa"))),
    });
  }
  return out;
}

export interface ScoreWeights {
  w_delivery: number;
  w_quality: number;
  w_sla: number;
  w_review: number;
}

/**
 * A supplier's score (0–100): the weighted mean of the metrics that have data (a metric without data — no orders,
 * no obligations due this period — leaves its weight out instead of counting as zero). Null when none has data.
 */
export function supplierScore(m: { delivery: number | null; quality: number | null; sla: number | null; review: number | null }, w: ScoreWeights): number | null {
  const parts: [number | null, number][] = [[m.delivery, w.w_delivery], [m.quality, w.w_quality], [m.sla, w.w_sla], [m.review, w.w_review]];
  let total = 0;
  let weight = 0;
  for (const [v, wt] of parts) {
    if (v === null || !Number.isFinite(v) || wt <= 0) continue;
    total += Math.max(0, Math.min(100, v)) * wt;
    weight += wt;
  }
  return weight > 0 ? Math.round(total / weight) : null;
}

/** A 1–5 rating mean as a 0–100 score. */
export const ratingToScore = (avg: number | null): number | null => (avg === null || !Number.isFinite(avg) ? null : Math.round(((Math.max(1, Math.min(5, avg)) - 1) / 4) * 100));

/** «1405-08» → «آبان ۱۴۰۵». */
export function periodLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${JALALI_MONTHS[m - 1]} ${faDigits(y)}`;
}

/** The Jalali month key of a date («1405-08»). */
export function monthKey(iso: string): string {
  const j = toJalali(iso);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

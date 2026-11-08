// Delivery promises (REQ-016, REQ-017): «N روز کاری» on a working calendar (Iranian holidays, half days) turned into
// the requested item's due date, the Persian sentence the order form shows, and the statistical expectation (SLE)
// from the item's history — percentiles of fulfilment times, never averaged across items. Pure.
import { addDays } from "../jalali";
import { localDate } from "../model/jalali-buckets";
import { DAY, HOUR, shiftsOf, type BusinessCalendar } from "../sla/calendar";

/**
 * The end of the `days`-th working day after `start` (the day of `start` counts only when it still has working time
 * left): «۳ روز کاری» ordered on a Wednesday afternoon is due at the end of the third working day after it. Without a
 * calendar, `days` × 24 hours. Zero days: the end of today's working time (or `start`).
 */
export function workingDaysDue(cal: BusinessCalendar | null, start: number, days: number): number | null {
  const n = Math.max(0, Math.floor(days));
  if (!cal) return start + n * DAY;
  let date = localDate(start, cal.tz);
  let counted = 0;
  let last: number | null = null;
  // today counts as day 0 when it is a working day that has not ended yet
  for (let guard = 0; guard < 3660; guard++) {
    const shifts = shiftsOf(cal, date);
    const end = shifts.length ? Math.max(...shifts.map(([, e]) => e)) : null;
    if (end !== null && end > start) {
      if (counted === n) return end;
      counted++;
      last = end;
    }
    date = addDays(date, 1);
  }
  return last;
}

/** «حدود ۵ روز کاری» / «همان روز کاری» for a promise in working days. */
export function promiseText(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return "";
  const n = Math.max(0, Math.floor(Number(days)));
  if (n === 0) return "همان روز کاری";
  return `حدود ${n.toLocaleString("fa-IR")} روز کاری`;
}

/** The p-th percentile (0–100) of `values` (nearest rank on sorted values; null for none). */
export function percentile(values: readonly number[], p: number): number | null {
  const xs = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * xs.length);
  return xs[Math.max(0, rank - 1)];
}

/** p50 / p85 / p95 of fulfilment durations (seconds) and the sample size. */
export function sle(durations: readonly number[]): { p50: number | null; p85: number | null; p95: number | null; samples: number } {
  return { p50: percentile(durations, 50), p85: percentile(durations, 85), p95: percentile(durations, 95), samples: durations.filter((x) => Number.isFinite(x)).length };
}

/** «۸۵٪ در کمتر از ۴ روز» for an SLE in seconds (null below `min` samples). */
export function sleText(p85: number | null | undefined, samples: number | null | undefined, min = 5): string {
  if (!p85 || !samples || samples < min) return "";
  const days = p85 / (DAY / 1000);
  if (days >= 1) return `۸۵٪ درخواست‌ها در کمتر از ${Math.ceil(days).toLocaleString("fa-IR")} روز انجام شده‌اند`;
  const hours = Math.max(1, Math.ceil(p85 / (HOUR / 1000)));
  return `۸۵٪ درخواست‌ها در کمتر از ${hours.toLocaleString("fa-IR")} ساعت انجام شده‌اند`;
}

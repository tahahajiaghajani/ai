// Pure logic of the continuity screens (tested in tests/continuity-ui.test.ts): availability and budgets in Persian,
// the BIA matrix's cells and the proposed RTO, the exercise's step sheet.
import { BIA_BUCKETS, BIA_CATEGORIES, BIA_RATINGS } from "@shared/tables/continuity";
import { bucketWorst, proposedRto, type Impacts, type StepTiming } from "@shared/continuity/logic";

const nf = (n: number, d = 0) => n.toLocaleString("fa-IR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** «۹۹٫۹۵٪» (up to `d` decimals, trailing zeros kept for alignment); «—» for null. */
export function availabilityText(v: number | null | undefined, d = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${nf(v, d)}٪`;
}

/** Minutes of a duration in ms («۴۳ دقیقه», «۲ ساعت و ۵ دقیقه»). */
export function minutesText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60_000);
  if (Math.abs(m) < 60) return `${nf(m)} دقیقه`;
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  const sign = m < 0 ? "−" : "";
  if (h < 48) return `${sign}${nf(h)} ساعت${r ? ` و ${nf(r)} دقیقه` : ""}`;
  return `${sign}${nf(Math.round(h / 24))} روز`;
}

/** The tone of an availability against its target. */
export function availabilityTone(v: number | null | undefined, target: number | null | undefined): "good" | "bad" | "warn" | null {
  if (v === null || v === undefined) return null;
  if (target === null || target === undefined) return null;
  if (v >= target) return "good";
  return v >= target - (100 - target) ? "warn" : "bad";
}

/** Seconds as «۴ ساعت» for RTO/RPO/MTPD. */
export function secondsText(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return "—";
  const n = Number(s);
  if (n < 3600) return `${nf(Math.round(n / 60))} دقیقه`;
  if (n < 86_400) return `${nf(Math.round((n / 3600) * 10) / 10)} ساعت`;
  return `${nf(Math.round((n / 86_400) * 10) / 10)} روز`;
}

export const CATEGORIES = BIA_CATEGORIES;
export const BUCKETS = BIA_BUCKETS;
export const RATINGS = BIA_RATINGS;

/** A copy of the matrix with one cell set (0–4) or cleared. */
export function setCell(m: Impacts, category: string, bucket: string, rating: number | null): Impacts {
  const out: Impacts = JSON.parse(JSON.stringify(m ?? {}));
  const row = { ...(out[category] ?? {}) };
  if (rating === null) delete row[bucket];
  else row[bucket] = Math.max(0, Math.min(4, Math.round(rating)));
  out[category] = row;
  return out;
}

/** The worst rating per bucket and the proposed RTO of a matrix (as the server computes them). */
export function matrixSummary(m: Impacts, tolerance = 3): { worst: number[]; rto: number | null } {
  return { worst: bucketWorst(m ?? {}), rto: proposedRto(m ?? {}, tolerance) };
}

/** The step sheet's progress: done steps, late steps (against their target minutes) and the next one. */
export function stepProgress(log: readonly StepTiming[], startedAt: string | null, now = Date.now()): { done: number; total: number; late: number; next: StepTiming | null; elapsed_min: number | null } {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const elapsed = Number.isFinite(start) ? Math.max(0, Math.round((now - start) / 60_000)) : null;
  let late = 0;
  for (const s of log) {
    const at = s.done_at ? Date.parse(s.done_at) : NaN;
    if (Number.isFinite(at) && Number.isFinite(start) && (at - start) / 60_000 > s.target_min) late++;
    else if (!s.done_at && elapsed !== null && elapsed > s.target_min) late++;
  }
  return { done: log.filter((s) => s.done_at).length, total: log.length, late, next: log.find((s) => !s.done_at) ?? null, elapsed_min: elapsed };
}

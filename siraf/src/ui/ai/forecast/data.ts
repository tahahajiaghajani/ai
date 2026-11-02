// «پیش‌بینی و برنامه‌ریزی»: what the page reads from /api/o/:org/ai/forecast/*, /ai/plan(s) (shapes in
// @shared/ai/api) and the small calculations of its charts. Pure functions (no React) are exported for tests.
import type { AiForecastSeries } from "@shared/ai/types";
import { num } from "../kit/model";
import type { AiCashflowDetails, AiCashForecastView, AiCashWeek, AiForecastResponse, AiPlanSummary, AiPlanView, AiRateRange, AiStockAdvice } from "../kit/types";

// ---------------------------------------------------------------- cash flow (13 weeks)

/** GET /ai/forecast/cashflow → the weeks as the page draws them (in = cheques and invoices coming in, out = the rest). */
export function cashOf(r: AiForecastResponse<AiCashflowDetails> | null | undefined): AiCashForecastView {
  const d = r?.details;
  const weeks = (d?.weeks ?? []).map(
    (w): AiCashWeek => ({
      start: w.week_start,
      end: w.week_end,
      label: w.label,
      opening: w.opening,
      inflow: w.inflow,
      outflow: w.outflow,
      closing: w.closing_p50,
      p10: w.closing_p10,
      p90: w.closing_p90,
      shortfall: w.shortfall,
      risk: w.risk,
      items: w.items,
    }),
  );
  return {
    unit: r?.series.unit,
    opening: d?.opening.total ?? weeks[0]?.opening ?? "0",
    weeks,
    method: r?.series.method ?? null,
    notes: d?.assumptions_fa ?? [],
    refused_reason_fa: r?.series.refused_reason_fa ?? null,
  };
}

/** Lowest closing balance and its week, the totals in and out, and the weeks in shortfall. */
export function cashSummary(f: AiCashForecastView) {
  let low = { value: num(f.opening), week: -1 };
  let inflow = 0;
  let outflow = 0;
  f.weeks.forEach((w, i) => {
    inflow += num(w.inflow);
    outflow += num(w.outflow);
    if (num(w.closing) < low.value) low = { value: num(w.closing), week: i };
  });
  const short = f.weeks.map((w, i) => (w.shortfall ? i : -1)).filter((i) => i >= 0);
  return { low, inflow, outflow, short, first: short[0] ?? -1 };
}

// ---------------------------------------------------------------- sales / demand series

/** GET /ai/forecast/sales|demand → the series. */
export const seriesOf = (r: AiForecastResponse | null | undefined): AiForecastSeries | null => r?.series ?? null;

export interface FanRow {
  period: string;
  actual: number | null;
  p50: number | null;
  band: [number, number] | null;
}

/** History and forecast on one axis: the band and the median start at the last actual value so the fan opens from it. */
export function fanRows(s: Pick<AiForecastSeries, "history" | "forecast">): FanRow[] {
  const rows: FanRow[] = s.history.map((h) => ({ period: h.period, actual: num(h.value), p50: null, band: null }));
  const last = rows[rows.length - 1];
  if (last && s.forecast.length) {
    last.p50 = last.actual;
    last.band = [last.actual!, last.actual!];
  }
  for (const f of s.forecast) rows.push({ period: f.period, actual: null, p50: num(f.p50), band: [num(f.p10), num(f.p90)] });
  return rows;
}

/** «۷۸٪ از ۲۴ دوره» style accuracy line pieces: coverage of the 80 % band as a 0…1 ratio, or null. */
export function coverageRatio(c: string | null | undefined): number | null {
  if (c === null || c === undefined || c === "") return null;
  const x = Number(c);
  if (!Number.isFinite(x)) return null;
  return x > 1 ? x / 100 : x;
}

// ---------------------------------------------------------------- reorder, dead stock and rates

export const adviceOf = (r: { items?: AiStockAdvice[] } | null | undefined): AiStockAdvice[] => r?.items ?? [];

export const ratesOf = (r: { rates?: AiRateRange[] } | null | undefined): AiRateRange[] => r?.rates ?? [];

/** Where a value sits in a range, 0…1 (for the range bar), clamped. */
export function rangePos(v: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 0.5;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

// ---------------------------------------------------------------- plans

export const planOf = (r: { plan: AiPlanView }): AiPlanView => r.plan;

export const plansOf = (r: { plans?: AiPlanSummary[] } | null | undefined): AiPlanSummary[] => r?.plans ?? [];

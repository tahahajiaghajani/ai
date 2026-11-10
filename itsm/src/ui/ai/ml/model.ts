// Pure logic of the predictive AI's screens (tests: tests/ai-ml-ui.test.ts): percentages in Persian, the rows of a
// forecast chart (history, the 80% band, holidays and anomalies), the order of «چرا؟» reasons and what a panel shows.
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { confidenceBand, riskBand, type ForecastView, type MlPrediction } from "@shared/ai/ml";

/** «۸۷٪» (one decimal under 10%). */
export function pctFa(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const v = x * 100;
  return `${faDigits(v < 10 ? Math.round(v * 10) / 10 : Math.round(v))}٪`;
}

/** The words beside a score: a confidence for suggestions, a risk band for probabilities. */
export function scoreWords(p: Pick<MlPrediction, "kind" | "score" | "alert">): { key: "high" | "medium" | "low"; label: string } {
  return p.kind === "risk" ? riskBand(p.score, p.alert ?? 0.6) : confidenceBand(p.score);
}

/** «چرا؟»: the strongest reasons first, with a word for their direction. */
export function reasonsOf(p: Pick<MlPrediction, "why" | "kind">, max = 5): { label: string; weight: number; direction: string }[] {
  return [...p.why]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, max)
    .map((r) => ({ ...r, direction: p.kind === "risk" ? (r.weight > 0 ? "افزایش خطر" : "کاهش خطر") : r.weight > 0 ? "به سود این پیشنهاد" : "به زیان این پیشنهاد" }));
}

/** The suggestions a panel shows: confident ones and risks first; a suggestion equal to the current value is not one. */
export function visiblePredictions(ps: readonly MlPrediction[], showAll = false): MlPrediction[] {
  return ps
    .filter((p) => (p.kind !== "classifier" || p.value !== p.current) && (showAll || p.confident || p.kind !== "classifier"))
    .sort((a, b) => (a.kind === b.kind ? b.score - a.score : a.kind === "risk" ? -1 : b.kind === "risk" ? 1 : a.kind === "classifier" ? -1 : 1));
}

export interface ForecastRow {
  date: string;
  label: string;
  actual: number | null;
  p50: number | null;
  /** [p10, p90] for the band */
  band: [number, number] | null;
  holiday: boolean;
  anomaly: boolean;
}

/** History then forecast, one row per day (or week), the last month of history only. */
export function forecastRows(f: Pick<ForecastView, "history" | "points" | "anomalies" | "grain">, keep = f.grain === "day" ? 42 : 26): ForecastRow[] {
  const start = Math.max(0, f.history.length - keep);
  const anomalies = new Set(f.anomalies);
  const hist: ForecastRow[] = f.history.slice(start).map((h, i) => ({ date: h.date, label: formatJalali(h.date, { style: "short" }), actual: h.count, p50: null, band: null, holiday: h.holiday, anomaly: anomalies.has(start + i) }));
  const fut: ForecastRow[] = f.points.map((p) => ({ date: p.date, label: formatJalali(p.date, { style: "short" }), actual: null, p50: p.p50, band: [p.p10, p.p90], holiday: p.holiday, anomaly: false }));
  // the forecast line starts at the last actual value, so the two read as one line
  if (hist.length && fut.length) hist[hist.length - 1] = { ...hist[hist.length - 1], p50: hist[hist.length - 1].actual };
  return [...hist, ...fut];
}

/** «MASE ۰٫۷: بهتر از «بدون تغییر»» — the backtest in a sentence. */
export function backtestText(f: Pick<ForecastView, "backtest" | "method_fa">): string {
  const b = f.backtest;
  if (!b || b.mase === null) return `روش: ${f.method_fa}`;
  const better = b.mase < 1;
  const cov = b.coverage80 === null ? "" : `؛ ${pctFa(b.coverage80)} از مقدارهای واقعی در بازهٔ ۸۰٪ افتاد`;
  return `روش: ${f.method_fa}؛ خطای نسبی ${faDigits(Math.round(b.mase * 100) / 100)} (${better ? "بهتر از" : "نه بهتر از"} فرض «بدون تغییر»)${cov}`;
}

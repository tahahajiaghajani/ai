// Ticket volume forecasting (catalogue AI-052, AI-116, ANA-027; docs/spec/AI.md §13), pure. A daily count series is
// forecast with the toolkit of ai/analytics/forecast.ts (ETS / Holt-Winters / seasonal naive chosen by backtest) with
// the Iranian week as its season (period 7: Friday off, Thursday short — learnt from the data, not assumed) and the
// Jalali official holidays handled apart: the history's holidays are replaced by their weekday's normal level before
// fitting (a holiday is not noise to learn), the holiday effect is measured as the median ratio of a holiday to that
// level, and future holidays get the forecast times that ratio. Weekly series (Jalali weeks from Saturday) use a
// yearly season once two years exist. Staffing hints turn a forecast into people with stated assumptions.
import { addDays, weekday } from "@shared/jalali";
import { forecastSeries, median, type Band, type ForecastOutcome } from "../../analytics/forecast";

export interface DailyPoint {
  date: string;
  count: number;
}

export interface VolumeForecast {
  ok: boolean;
  refused_reason_fa: string | null;
  method_fa: string;
  /** history as used (holidays marked) and the forecast with its 80% band */
  history: { date: string; count: number; holiday: boolean }[];
  points: { date: string; p10: number; p50: number; p90: number; holiday: boolean }[];
  /** ratio of a holiday's volume to its weekday's level (1 = no effect) */
  holiday_factor: number;
  /** the weekly pattern: average share of each weekday (Saturday first) */
  weekday_profile: number[];
  backtest: ForecastOutcome["backtest"];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Fill missing days with zeros between the first and the last date (ascending). */
export function denseDaily(points: readonly DailyPoint[], from?: string, to?: string): DailyPoint[] {
  if (!points.length && !(from && to)) return [];
  const by = new Map(points.map((p) => [p.date, p.count]));
  const sorted = [...by.keys()].sort();
  const start = from ?? sorted[0];
  const end = to ?? sorted[sorted.length - 1];
  const out: DailyPoint[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push({ date: d, count: by.get(d) ?? 0 });
  return out;
}

/** The normal level of a day: the median of the same weekday in the surrounding weeks that are not holidays. */
function weekdayLevel(series: readonly DailyPoint[], at: number, holidays: ReadonlySet<string>, span = 4): number | null {
  const ref: number[] = [];
  for (let k = -span; k <= span; k++) {
    if (!k) continue;
    const j = at + k * 7;
    if (j >= 0 && j < series.length && !holidays.has(series[j].date)) ref.push(series[j].count);
  }
  return ref.length >= 2 ? median(ref) : null;
}

/** Forecast `horizon` days after the last day of `history` (dense, ascending). */
export function forecastDaily(history: readonly DailyPoint[], horizon: number, holidays: ReadonlySet<string> = new Set()): VolumeForecast {
  const ratios: number[] = [];
  const cleaned = history.map((p, t) => {
    if (!holidays.has(p.date)) return p.count;
    const level = weekdayLevel(history, t, holidays);
    if (level === null) return p.count;
    if (level > 0) ratios.push(p.count / level);
    return level;
  });
  // the holiday effect: measured when three holidays or more were seen, else the weekend's ratio (a holiday is a
  // day off like Friday), else none
  const weekdayMeans = Array.from({ length: 7 }, (_, w) => {
    const xs = history.filter((p, t) => weekday(p.date) === w && !holidays.has(p.date)).map((p) => p.count);
    return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
  });
  const workMean = weekdayMeans.slice(0, 5).reduce((a, x) => a + x, 0) / 5;
  const weekendRatio = workMean > 0 ? Math.min(1, weekdayMeans[6] / workMean) : 1;
  const factor = ratios.length >= 3 ? Math.min(1.5, Math.max(0, median(ratios))) : weekendRatio;
  const total = weekdayMeans.reduce((a, x) => a + x, 0);
  const profile = weekdayMeans.map((x) => (total ? r2(x / total) : 0));
  const f = forecastSeries(cleaned, horizon, { seasonPeriod: 7, minPeriods: 21 });
  const last = history.length ? history[history.length - 1].date : null;
  const scale = (b: Band, k: number): Band => ({ p10: b.p10 * k, p50: b.p50 * k, p90: b.p90 * k });
  return {
    ok: f.ok,
    refused_reason_fa: f.refused_reason_fa,
    method_fa: f.method_fa,
    history: history.map((p) => ({ date: p.date, count: p.count, holiday: holidays.has(p.date) })),
    points: !last
      ? []
      : f.points.map((b, i) => {
          const date = addDays(last, i + 1);
          const hol = holidays.has(date);
          const x = hol ? scale(b, factor) : b;
          return { date, p10: r2(x.p10), p50: r2(x.p50), p90: r2(x.p90), holiday: hol };
        }),
    holiday_factor: r2(factor),
    weekday_profile: profile,
    backtest: f.backtest,
  };
}

/** The Saturday that starts the Jalali week of a date. */
export const weekStart = (date: string): string => addDays(date, -weekday(date));

/** Daily counts → weekly counts (Jalali weeks from Saturday; a partial first or last week is left out). */
export function weeklyOf(daily: readonly DailyPoint[]): DailyPoint[] {
  const by = new Map<string, { n: number; days: number }>();
  for (const p of daily) {
    const w = weekStart(p.date);
    const x = by.get(w) ?? { n: 0, days: 0 };
    x.n += p.count;
    x.days++;
    by.set(w, x);
  }
  return [...by.entries()].filter(([, x]) => x.days === 7).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, x]) => ({ date, count: x.n }));
}

/** Forecast `horizon` weeks (a yearly season once two years of weeks exist). */
export function forecastWeekly(weeks: readonly DailyPoint[], horizon: number): VolumeForecast {
  const f = forecastSeries(weeks.map((w) => w.count), horizon, { seasonPeriod: weeks.length >= 104 ? 52 : 0, minPeriods: 8 });
  const last = weeks.length ? weeks[weeks.length - 1].date : null;
  return {
    ok: f.ok,
    refused_reason_fa: f.refused_reason_fa,
    method_fa: f.method_fa,
    history: weeks.map((w) => ({ date: w.date, count: w.count, holiday: false })),
    points: !last ? [] : f.points.map((b, i) => ({ date: addDays(last, 7 * (i + 1)), p10: r2(b.p10), p50: r2(b.p50), p90: r2(b.p90), holiday: false })),
    holiday_factor: 1,
    weekday_profile: [],
    backtest: f.backtest,
  };
}

export interface StaffingAssumptions {
  /** minutes of work one ticket needs on average */
  handle_minutes: number;
  /** productive hours of one person per working day */
  productive_hours: number;
}

export const DEFAULT_STAFFING: StaffingAssumptions = { handle_minutes: 30, productive_hours: 6 };

/** People needed per forecast day (median and busy case), with the assumptions stated (a hint, never a roster). */
export function staffingHints(points: VolumeForecast["points"], a: StaffingAssumptions = DEFAULT_STAFFING): { date: string; people_p50: number; people_p90: number }[] {
  const perPerson = (a.productive_hours * 60) / Math.max(1, a.handle_minutes);
  return points.map((p) => ({ date: p.date, people_p50: Math.ceil(p.p50 / perPerson - 1e-9), people_p90: Math.ceil(p.p90 / perPerson - 1e-9) }));
}

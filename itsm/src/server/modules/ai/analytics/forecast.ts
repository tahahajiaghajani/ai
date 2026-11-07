// Forecasting toolkit — pure TypeScript, no database, no model. Every forecast is a range
// (p10/p50/p90) with its measured accuracy (rolling-origin backtest: MASE against the naive
// benchmark and the hit rate of the 80% band), and the toolkit refuses when the data is too thin.
// The platform's AI layer uses it for count series (e.g. how many records a period will bring);
// the numbers come from here, a model only narrates them.
//
// - Count series are classified by ADI and CV² (Syntetos–Boylan–Croston). Intermittent and lumpy
//   series use Croston, SBA (bias-corrected Croston) or TSB (Teunter–Syntetos–Babai, which decays
//   when occurrences stop); smooth and erratic series use naive, seasonal naive, simple exponential
//   smoothing ETS(A,N,N), damped Holt ETS(A,Ad,N) or additive Holt-Winters ETS(A,A,A). The method
//   with the lowest backtest error wins; its band is widened when the backtest shows that it was
//   too narrow (split-conformal style).
// - Robust outlier scores (median / MAD) for spotting an unusual period.
//
// Estimates are computed in binary floating point — their uncertainty is many orders of magnitude
// larger than its rounding — and the callers round them for display.

export type DemandClass = "smooth" | "erratic" | "intermittent" | "lumpy";

export const CLASS_FA: Record<DemandClass, string> = {
  smooth: "منظم",
  erratic: "نوسانی",
  intermittent: "پراکنده",
  lumpy: "پراکنده و نامنظم",
};

export interface Classification {
  n: number;
  nonzero: number;
  /** average number of periods between demands */
  adi: number;
  /** squared coefficient of variation of the non-zero demand sizes */
  cv2: number;
  cls: DemandClass;
}

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}

export interface Backtest {
  /** mean absolute error of the chosen method at the tested origins */
  mae: number | null;
  /** MAE ÷ in-sample MAE of the naive benchmark; < 1 beats "no change" */
  mase: number | null;
  /** share of actuals that fell inside the 80% band */
  coverage80: number | null;
  /** number of (origin, step) pairs tested */
  n: number;
}

export interface ForecastOutcome {
  ok: boolean;
  refused_reason_fa: string | null;
  method_key: string;
  method_fa: string;
  cls: Classification;
  points: Band[];
  backtest: Backtest | null;
  /** mean of the history (shown when the forecast is refused) */
  mean: number;
}

const Z80 = 1.2815515655446004; // 10% / 90% quantiles of the standard normal

// ---------------------------------------------------------------- descriptive statistics

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Quantile with linear interpolation (type 7, as R and NumPy default). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

/** Median absolute deviation scaled to σ for normal data (1.4826 · MAD). */
export function robustSigma(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/** Robust z-score of `x` against a reference sample (Iglewicz–Hoaglin); 0 when the sample has no spread. */
export function robustZ(x: number, sample: number[]): number {
  const s = robustSigma(sample);
  return s > 0 ? (x - median(sample)) / s : 0;
}

// ---------------------------------------------------------------- classification

export function classify(y: number[]): Classification {
  const n = y.length;
  const sizes = y.filter((v) => v > 0);
  const nonzero = sizes.length;
  const adi = nonzero ? n / nonzero : Infinity;
  const m = mean(sizes);
  const cv2 = nonzero > 1 && m > 0 ? (stdev(sizes) / m) ** 2 : 0;
  const cls: DemandClass = adi < 1.32 ? (cv2 < 0.49 ? "smooth" : "erratic") : cv2 < 0.49 ? "intermittent" : "lumpy";
  return { n, nonzero, adi, cv2, cls };
}

// ---------------------------------------------------------------- models

/** A fitted model: point forecasts for the next h periods and its one-step in-sample errors. */
interface Fitted {
  key: string;
  forecast(h: number): number[];
  /** one-step-ahead in-sample errors (actual − fitted) after the warm-up */
  residuals: number[];
  /** σ multiplier of the h-step error relative to the one-step error */
  spread(h: number): number;
  /** quantiles of the per-period predictive distribution, when the model has its own (intermittent) */
  band?(h: number): Band[];
}

type Fitter = (y: number[], m: number) => Fitted | null;

const ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
const BETAS = [0.05, 0.1, 0.2];
const GAMMAS = [0.05, 0.1, 0.3];
const PHI = 0.95;

function sse(errors: number[]): number {
  return errors.reduce((a, e) => a + e * e, 0);
}

function naive(y: number[]): Fitted | null {
  if (y.length < 2) return null;
  const last = y[y.length - 1];
  return {
    key: "naive",
    forecast: (h) => Array(h).fill(last),
    residuals: y.slice(1).map((v, i) => v - y[i]),
    spread: (h) => Math.sqrt(h),
  };
}

function seasonalNaive(y: number[], m: number): Fitted | null {
  if (m < 2 || y.length < 2 * m) return null;
  return {
    key: "seasonal_naive",
    forecast: (h) => Array.from({ length: h }, (_, i) => y[y.length - m + (i % m)]),
    residuals: y.slice(m).map((v, i) => v - y[i]),
    spread: (h) => Math.sqrt(Math.ceil(h / m)),
  };
}

function sesRun(y: number[], alpha: number) {
  let level = y[0];
  const res: number[] = [];
  for (let t = 1; t < y.length; t++) {
    res.push(y[t] - level);
    level = alpha * y[t] + (1 - alpha) * level;
  }
  return { level, res };
}

function ses(y: number[]): Fitted | null {
  if (y.length < 4) return null;
  let best: { alpha: number; level: number; res: number[] } | null = null;
  for (const alpha of ALPHAS) {
    const r = sesRun(y, alpha);
    if (!best || sse(r.res) < sse(best.res)) best = { alpha, ...r };
  }
  const b = best!;
  return {
    key: "ses",
    forecast: (h) => Array(h).fill(b.level),
    residuals: b.res,
    spread: (h) => Math.sqrt(1 + (h - 1) * b.alpha * b.alpha),
  };
}

function holtRun(y: number[], alpha: number, beta: number) {
  let level = y[0];
  let trend = y[1] - y[0];
  const res: number[] = [];
  for (let t = 1; t < y.length; t++) {
    const fit = level + PHI * trend;
    res.push(y[t] - fit);
    const prev = level;
    level = alpha * y[t] + (1 - alpha) * fit;
    trend = beta * (level - prev) + (1 - beta) * PHI * trend;
  }
  return { level, trend, res };
}

function holtDamped(y: number[]): Fitted | null {
  if (y.length < 10) return null;
  let best: { level: number; trend: number; res: number[] } | null = null;
  for (const alpha of ALPHAS) {
    for (const beta of BETAS) {
      const r = holtRun(y, alpha, beta);
      if (!best || sse(r.res) < sse(best.res)) best = r;
    }
  }
  const b = best!;
  return {
    key: "holt_damped",
    forecast: (h) => {
      const out: number[] = [];
      let damp = 0;
      for (let i = 1; i <= h; i++) {
        damp += PHI ** i;
        out.push(b.level + damp * b.trend);
      }
      return out;
    },
    residuals: b.res.slice(1),
    spread: (h) => Math.sqrt(h),
  };
}

function hwRun(y: number[], m: number, alpha: number, beta: number, gamma: number) {
  const first = y.slice(0, m);
  const second = y.slice(m, 2 * m);
  let level = mean(first);
  let trend = (mean(second) - level) / m;
  const season = first.map((v) => v - level);
  const res: number[] = [];
  for (let t = m; t < y.length; t++) {
    const s = season[t % m];
    const fit = level + trend + s;
    res.push(y[t] - fit);
    const prev = level;
    level = alpha * (y[t] - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
    season[t % m] = gamma * (y[t] - level) + (1 - gamma) * s;
  }
  return { level, trend, season, res, n: y.length };
}

function holtWinters(y: number[], m: number): Fitted | null {
  if (m < 2 || y.length < 2 * m + 2) return null;
  let best: ReturnType<typeof hwRun> | null = null;
  for (const alpha of [0.1, 0.3, 0.5]) {
    for (const beta of [0.01, 0.05, 0.1]) {
      for (const gamma of GAMMAS) {
        const r = hwRun(y, m, alpha, beta, gamma);
        if (!best || sse(r.res) < sse(best.res)) best = r;
      }
    }
  }
  const b = best!;
  return {
    key: "holt_winters",
    forecast: (h) => Array.from({ length: h }, (_, i) => b.level + (i + 1) * b.trend + b.season[(b.n + i) % m]),
    residuals: b.res,
    spread: (h) => Math.sqrt(h),
  };
}

/** Per-period quantiles of an intermittent demand: 0 with probability 1 − p, else a past demand size. */
function intermittentBand(sizes: number[], prob: number, center: number): Band {
  const at = (q: number) => (q <= 1 - prob ? 0 : quantile(sizes, (q - (1 - prob)) / prob));
  return { p10: at(0.1), p50: center, p90: Math.max(at(0.9), center) };
}

function crostonRun(y: number[], alpha: number) {
  let z = NaN;
  let p = NaN;
  let q = 1;
  const res: number[] = [];
  for (let t = 0; t < y.length; t++) {
    if (!Number.isNaN(z)) res.push(y[t] - z / p);
    if (y[t] > 0) {
      if (Number.isNaN(z)) {
        z = y[t];
        p = t + 1;
      } else {
        z += alpha * (y[t] - z);
        p += alpha * (q - p);
      }
      q = 1;
    } else q += 1;
  }
  return { z, p, res };
}

function crostonFamily(variant: "croston" | "sba"): Fitter {
  return (y) => {
    const sizes = y.filter((v) => v > 0);
    if (sizes.length < 2) return null;
    let best: { alpha: number; z: number; p: number; res: number[] } | null = null;
    for (const alpha of [0.05, 0.1, 0.2, 0.3]) {
      const r = crostonRun(y, alpha);
      if (!best || sse(r.res) < sse(best.res)) best = { alpha, ...r };
    }
    const b = best!;
    const level = (b.z / b.p) * (variant === "sba" ? 1 - b.alpha / 2 : 1);
    const prob = Math.min(1, 1 / b.p);
    return {
      key: variant,
      forecast: (h) => Array(h).fill(level),
      residuals: b.res,
      spread: () => 1,
      band: (h) => Array(h).fill(intermittentBand(sizes, prob, level)),
    };
  };
}

function tsbRun(y: number[], alpha: number, beta: number) {
  const first = y.findIndex((v) => v > 0);
  let z = y[first];
  let prob = 1 / (first + 1);
  const res: number[] = [];
  for (let t = first + 1; t < y.length; t++) {
    res.push(y[t] - prob * z);
    if (y[t] > 0) {
      prob += beta * (1 - prob);
      z += alpha * (y[t] - z);
    } else prob += beta * (0 - prob);
  }
  return { z, prob, res };
}

const tsb: Fitter = (y) => {
  const sizes = y.filter((v) => v > 0);
  if (sizes.length < 2) return null;
  let best: { z: number; prob: number; res: number[] } | null = null;
  for (const alpha of [0.05, 0.1, 0.2, 0.3]) {
    for (const beta of [0.05, 0.1, 0.2, 0.3]) {
      const r = tsbRun(y, alpha, beta);
      if (!best || sse(r.res) < sse(best.res)) best = r;
    }
  }
  const b = best!;
  const level = b.prob * b.z;
  return {
    key: "tsb",
    forecast: (h) => Array(h).fill(level),
    residuals: b.res,
    spread: () => 1,
    band: (h) => Array(h).fill(intermittentBand(sizes, b.prob, level)),
  };
};

export const METHOD_FA: Record<string, string> = {
  naive: "بدون تغییر (آخرین مقدار)",
  seasonal_naive: "تکرار فصل گذشته (Seasonal naive)",
  ses: "هموارسازی نمایی ساده — ETS(A,N,N)",
  holt_damped: "هموارسازی نمایی با روند میرا — ETS(A,Ad,N)",
  holt_winters: "هولت-وینترز فصلی — ETS(A,A,A)",
  croston: "کراستون (تقاضای پراکنده)",
  sba: "SBA — کراستون با تصحیح سوگیری",
  tsb: "TSB — احتمال تقاضای رو به کاهش",
};

const FITTERS: Record<string, Fitter> = {
  naive: (y) => naive(y),
  seasonal_naive: seasonalNaive,
  ses: (y) => ses(y),
  holt_damped: (y) => holtDamped(y),
  holt_winters: holtWinters,
  croston: crostonFamily("croston"),
  sba: crostonFamily("sba"),
  tsb,
};

// ---------------------------------------------------------------- bands and backtest

function sigmaOf(model: Fitted): number {
  const r = model.residuals.filter((e) => Number.isFinite(e));
  if (!r.length) return 0;
  return Math.sqrt(sse(r) / r.length);
}

function bandsOf(model: Fitted, h: number, widen: number, nonNegative: boolean): Band[] {
  const point = model.forecast(h);
  const own = model.band?.(h);
  const sigma = sigmaOf(model);
  return point.map((p50, i) => {
    let b: Band;
    if (own) {
      const o = own[i];
      b = { p10: p50 - (p50 - o.p10) * widen, p50, p90: p50 + (o.p90 - p50) * widen };
    } else {
      const d = Z80 * sigma * model.spread(i + 1) * widen;
      b = { p10: p50 - d, p50, p90: p50 + d };
    }
    if (nonNegative) b = { p10: Math.max(0, b.p10), p50: Math.max(0, b.p50), p90: Math.max(0, b.p90) };
    return b;
  });
}

/** In-sample MAE of the naive (lag m, else lag 1) benchmark: the MASE scale. */
function naiveScale(y: number[], m: number): number {
  const lag = m >= 2 && y.length > 2 * m ? m : 1;
  const d: number[] = [];
  for (let t = lag; t < y.length; t++) d.push(Math.abs(y[t] - y[t - lag]));
  return mean(d);
}

interface BacktestRun extends Backtest {
  /** errors divided by the band half-width (for widening) */
  ratios: number[];
  /** the backtest origin of each ratio (chronological) */
  origin: number[];
}

/** Rolling origin: fit on y[0..t), forecast up to `h` steps, compare with what happened. */
function backtest(y: number[], key: string, m: number, h: number, origins: number, nonNegative: boolean): BacktestRun {
  const fitter = FITTERS[key];
  const errs: number[] = [];
  const ratios: number[] = [];
  const origin: number[] = [];
  let inside = 0;
  const start = Math.max(4, y.length - origins);
  for (let t = start; t < y.length; t++) {
    const model = fitter(y.slice(0, t), m);
    if (!model) continue;
    const steps = Math.min(h, y.length - t);
    const bands = bandsOf(model, steps, 1, nonNegative);
    for (let i = 0; i < steps; i++) {
      const actual = y[t + i];
      const b = bands[i];
      errs.push(Math.abs(actual - b.p50));
      if (actual >= b.p10 && actual <= b.p90) inside++;
      const half = actual >= b.p50 ? b.p90 - b.p50 : b.p50 - b.p10;
      ratios.push(half > 0 ? Math.abs(actual - b.p50) / half : actual === b.p50 ? 0 : Infinity);
      origin.push(t);
    }
  }
  const scale = naiveScale(y, m);
  const mae = errs.length ? mean(errs) : null;
  return {
    mae,
    mase: mae !== null && scale > 0 ? mae / scale : null,
    coverage80: errs.length ? inside / errs.length : null,
    n: errs.length,
    ratios,
    origin,
  };
}

const WIDEN_MIN = 6;

/** The factor that widens the model's own band: the 80th percentile of the error ratios (≥ 1). */
function widenOf(ratios: number[]): number {
  const finite = ratios.filter((r) => Number.isFinite(r));
  const k = finite.length >= WIDEN_MIN ? quantile(finite, 0.8) : 1;
  return Math.max(1, Number.isFinite(k) ? k : 1);
}

/**
 * Coverage of the widened band, out of sample: each error is judged against the widening learned
 * from earlier origins only (an expanding window), so a band that keeps being too narrow shows a
 * low coverage. Without enough earlier errors to learn from, the band was not widened from data
 * and its plain backtest coverage is honest; with too few judged errors it is unknown (null).
 */
function outOfSampleCoverage(run: BacktestRun): number | null {
  const finite = run.ratios.filter((r) => Number.isFinite(r)).length;
  if (finite < WIDEN_MIN) return run.coverage80;
  let judged = 0;
  let hits = 0;
  for (let i = 0; i < run.ratios.length; i++) {
    const earlier = run.ratios.filter((_, j) => run.origin[j] < run.origin[i]);
    if (earlier.filter((r) => Number.isFinite(r)).length < WIDEN_MIN) continue;
    judged++;
    if (run.ratios[i] <= widenOf(earlier) + 1e-12) hits++;
  }
  return judged >= 4 ? hits / judged : null;
}

function candidates(c: Classification, n: number, m: number): string[] {
  if (c.cls === "intermittent" || c.cls === "lumpy") return ["croston", "sba", "tsb", "ses"];
  const out = ["naive", "ses"];
  if (n >= 10) out.push("holt_damped");
  if (m >= 2 && n >= 2 * m) out.push("seasonal_naive");
  if (m >= 2 && n >= 2 * m + 2) out.push("holt_winters");
  return out;
}

/**
 * Forecast `h` periods of a count series (oldest first). `seasonPeriod` (12 for Jalali
 * months, 52 for weeks) enables seasonal methods once two full cycles exist.
 */
export function forecastSeries(y: number[], h: number, opts: { seasonPeriod?: number; nonNegative?: boolean; minPeriods?: number } = {}): ForecastOutcome {
  const nonNegative = opts.nonNegative ?? true;
  const series = nonNegative ? y.map((v) => Math.max(0, v)) : y;
  const cls = classify(series);
  const m = opts.seasonPeriod ?? 0;
  const avg = mean(series);
  const refuse = (why: string): ForecastOutcome => ({ ok: false, refused_reason_fa: why, method_key: "none", method_fa: "—", cls, points: [], backtest: null, mean: avg });
  const minPeriods = opts.minPeriods ?? 8;
  if (series.length < minPeriods) return refuse(`دادهٔ کافی نیست: دست‌کم ${minPeriods} دوره لازم است و ${series.length} دوره وجود دارد`);
  if (cls.nonzero === 0) return refuse("در این دوره هیچ مقداری ثبت نشده است");
  const intermittent = cls.cls === "intermittent" || cls.cls === "lumpy";
  if (intermittent && cls.nonzero < 8) return refuse(`دادهٔ کافی نیست: برای سری پراکنده دست‌کم ۸ دورهٔ دارای رخداد لازم است و ${cls.nonzero} دوره وجود دارد`);

  const origins = Math.min(12, Math.max(4, Math.floor(series.length / 3)));
  const steps = Math.min(h, 3);
  let best: { key: string; run: BacktestRun } | null = null;
  for (const key of candidates(cls, series.length, m)) {
    const run = backtest(series, key, m, steps, origins, nonNegative);
    if (run.mae === null) continue;
    if (!best || run.mae < best.run.mae! - 1e-12) best = { key, run };
  }
  if (!best) return refuse("دادهٔ کافی برای آزمودن روش‌ها نیست");
  const model = FITTERS[best.key](series, m);
  if (!model) return refuse("دادهٔ کافی برای این روش نیست");
  // widen the band when the backtest says it was too narrow (empirical 80% of error ratios); the
  // coverage reported is that of the widened band, measured out of sample (never on the errors
  // that set the widening, which would read ≥ 80% whatever the forecast's quality)
  const widen = widenOf(best.run.ratios);
  const coverage80 = outOfSampleCoverage(best.run);
  return {
    ok: true,
    refused_reason_fa: null,
    method_key: best.key,
    method_fa: METHOD_FA[best.key] ?? best.key,
    cls,
    points: bandsOf(model, h, widen, nonNegative),
    backtest: { mae: best.run.mae, mase: best.run.mase, coverage80, n: best.run.n },
    mean: avg,
  };
}

// Anomaly detection (catalogue AI-104, ANA-025/026; docs/spec/AI.md §13), pure:
//   · seasonal robust z-score of the latest periods of a count series — the baseline is the median of the same phase
//     (the same weekday) in the trailing cycles, the scale its MAD, never below the Poisson spread of the baseline;
//   · generalised ESD (Rosner) on the seasonal residuals of a whole series: how many points are outliers;
//   · bursts of events in an hour against the hours before (alert storms);
//   · a rate that moved (two-proportion z-test: reopen rates, breach rates).
import { median } from "../../analytics/forecast";

const MAD_K = 1.4826;

/** Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Quantile of Student's t with ν degrees of freedom (Cornish–Fisher expansion around the normal; good for ν ≥ 4). */
export function tInv(p: number, nu: number): number {
  const z = normInv(p);
  const z3 = z ** 3;
  const z5 = z ** 5;
  const z7 = z ** 7;
  const z9 = z ** 9;
  return (
    z +
    (z3 + z) / (4 * nu) +
    (5 * z5 + 16 * z3 + 3 * z) / (96 * nu ** 2) +
    (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * nu ** 3) +
    (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / (92160 * nu ** 4)
  );
}

export interface PointScore {
  index: number;
  value: number;
  baseline: number;
  z: number;
}

/**
 * Robust seasonal z-scores of the last `last` points of `y` (oldest first): each against the same phase of the
 * `cycles` cycles before it (period 7 for days: the same weekday). Points without enough history get z = 0.
 */
export function seasonalZ(y: readonly number[], opts: { period?: number; cycles?: number; last?: number } = {}): PointScore[] {
  const period = opts.period ?? 7;
  const cycles = opts.cycles ?? 8;
  const last = Math.min(opts.last ?? 1, y.length);
  const out: PointScore[] = [];
  for (let t = y.length - last; t < y.length; t++) {
    const ref: number[] = [];
    for (let k = 1; k <= cycles; k++) if (t - k * period >= 0) ref.push(y[t - k * period]);
    if (ref.length < 3) {
      out.push({ index: t, value: y[t], baseline: ref.length ? median(ref) : y[t], z: 0 });
      continue;
    }
    const base = median(ref);
    const mad = MAD_K * median(ref.map((x) => Math.abs(x - base)));
    const scale = Math.max(mad, Math.sqrt(Math.max(base, 1)), 1);
    out.push({ index: t, value: y[t], baseline: base, z: Math.round(((y[t] - base) / scale) * 100) / 100 });
  }
  return out;
}

/** Residuals of a series against its phase medians (a light seasonal decomposition). */
export function seasonalResiduals(y: readonly number[], period = 7): number[] {
  if (period < 2 || y.length < period * 2) {
    const m = median([...y]);
    return y.map((x) => x - m);
  }
  const phase = Array.from({ length: period }, (_, p) => median(y.filter((_, t) => t % period === p)));
  return y.map((x, t) => x - phase[t % period]);
}

/**
 * Generalised ESD test (Rosner 1983): the indices of up to `maxOutliers` outliers of `xs` at significance `alpha`
 * (two-sided), most extreme first. Needs at least 15 values.
 */
export function generalizedEsd(xs: readonly number[], maxOutliers: number, alpha = 0.05): number[] {
  const n = xs.length;
  if (n < 15) return [];
  const r = Math.min(maxOutliers, Math.floor((n - 1) / 2));
  const left = xs.map((x, i) => ({ x, i }));
  const removed: number[] = [];
  let found = 0;
  for (let k = 1; k <= r; k++) {
    const m = left.reduce((a, p) => a + p.x, 0) / left.length;
    const sd = Math.sqrt(left.reduce((a, p) => a + (p.x - m) ** 2, 0) / (left.length - 1));
    if (!(sd > 0)) break;
    let at = 0;
    for (let q = 1; q < left.length; q++) if (Math.abs(left[q].x - m) > Math.abs(left[at].x - m)) at = q;
    const R = Math.abs(left[at].x - m) / sd;
    const p = 1 - alpha / (2 * (n - k + 1));
    const t = tInv(p, n - k - 1);
    const lambda = ((n - k) * t) / Math.sqrt((n - k - 1 + t * t) * (n - k + 1));
    removed.push(left[at].i);
    left.splice(at, 1);
    if (R > lambda) found = k;
  }
  return removed.slice(0, found);
}

/**
 * A burst: the current count against the counts of the periods before (alert storms per hour). True when it is at
 * least `minCount`, `factor` times the reference's 95th percentile and a robust z of at least `z`.
 */
export function isBurst(current: number, before: readonly number[], opts: { minCount?: number; factor?: number; z?: number } = {}): { burst: boolean; baseline: number; z: number } {
  const ref = [...before].sort((a, b) => a - b);
  const base = ref.length ? median(ref) : 0;
  const p95 = ref.length ? ref[Math.min(ref.length - 1, Math.floor(0.95 * (ref.length - 1)))] : 0;
  const mad = MAD_K * (ref.length ? median(ref.map((x) => Math.abs(x - base))) : 0);
  const z = (current - base) / Math.max(mad, Math.sqrt(Math.max(base, 1)), 1);
  const burst = current >= (opts.minCount ?? 20) && current >= (opts.factor ?? 3) * Math.max(p95, 1) && z >= (opts.z ?? 5);
  return { burst, baseline: base, z: Math.round(z * 100) / 100 };
}

/**
 * Did a rate move: `k` of `n` now against `k0` of `n0` before (two-proportion z-test with the pooled rate). Flags a
 * rise of at least half again over the earlier rate with z ≥ 3 and at least 5 events.
 */
export function rateShift(k: number, n: number, k0: number, n0: number): { rate: number; before: number; z: number; flagged: boolean } {
  const rate = n ? k / n : 0;
  const before = n0 ? k0 / n0 : 0;
  const pooled = n + n0 ? (k + k0) / (n + n0) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(n, 1) + 1 / Math.max(n0, 1)));
  const z = se > 0 ? (rate - before) / se : 0;
  return { rate, before, z: Math.round(z * 100) / 100, flagged: k >= 5 && n >= 10 && n0 >= 10 && z >= 3 && rate >= before * 1.5 };
}

// Probability models for yes/no outcomes (catalogue AI-046 change failure, AI-048 SLA breach; docs/spec/AI.md §13):
// logistic regression over encoded features — categorical values one-hot (values seen fewer than `minCount` times share
// the «other» column), numbers standardised, booleans 0/1 — fitted by full-batch Adam with L2 (no randomness: the same
// rows give the same weights). Examples with a time are split by time (the latest share is the holdout, as the model
// will meet the future); others by a seeded stratified split. Kept only when it beats the base rate (Brier skill > 0
// and AUC ≥ 0.6). A score carries its main drivers («چرا؟»): the features that raise or lower it most.
import { beatsBaseRate, binaryMetrics, type BinaryMetrics } from "./metrics";
import { stratifiedSplit } from "./rng";
import { round4 } from "./features";

export type FeatureKind = "cat" | "num" | "bool";

export interface FeatureSpec {
  name: string;
  kind: FeatureKind;
}

export interface RiskExample {
  x: Record<string, unknown>;
  y: 0 | 1;
  /** when the outcome was known (milliseconds): splits by time */
  t?: number;
}

export interface EncodedFeature {
  name: string;
  kind: FeatureKind;
  /** categorical: the values with their own column (sorted) */
  values?: string[];
  mean?: number;
  sd?: number;
}

export interface RiskParams {
  features: EncodedFeature[];
  /** one name per column: `field=value`, `field` */
  columns: string[];
  w: number[];
  b: number;
  base_rate: number;
}

export interface TrainedRisk {
  params: RiskParams;
  metrics: BinaryMetrics;
  beats: boolean;
  train_n: number;
  test_n: number;
}

export interface RiskScore {
  p: number;
  /** strongest contributions first (positive raise the risk) */
  why: { feature: string; weight: number }[];
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const catOf = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v));

/** Fit the encoding on training rows. */
export function fitEncoding(rows: readonly Record<string, unknown>[], specs: readonly FeatureSpec[], minCount = 5): { features: EncodedFeature[]; columns: string[] } {
  const features: EncodedFeature[] = [];
  const columns: string[] = [];
  for (const s of specs) {
    if (s.kind === "cat") {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const v = catOf(r[s.name]);
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const values = [...counts.entries()].filter(([, c]) => c >= minCount).map(([v]) => v).sort();
      features.push({ name: s.name, kind: "cat", values });
      for (const v of values) columns.push(`${s.name}=${v}`);
    } else if (s.kind === "num") {
      const xs = rows.map((r) => num(r[s.name])).filter((x): x is number => x !== null);
      const mean = xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
      const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1)) : 0;
      features.push({ name: s.name, kind: "num", mean: round4(mean), sd: round4(sd || 1) });
      columns.push(s.name);
    } else {
      features.push({ name: s.name, kind: "bool" });
      columns.push(s.name);
    }
  }
  return { features, columns };
}

/** The column vector of a row under an encoding (missing numbers at the mean, unknown categories in «other»). */
export function encode(features: readonly EncodedFeature[], x: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const f of features) {
    if (f.kind === "cat") {
      const v = catOf(x[f.name]);
      for (const c of f.values ?? []) out.push(v === c ? 1 : 0);
    } else if (f.kind === "num") {
      const n = num(x[f.name]);
      out.push(n === null ? 0 : (n - (f.mean ?? 0)) / (f.sd || 1));
    } else out.push(x[f.name] === true || x[f.name] === 1 || x[f.name] === "true" ? 1 : 0);
  }
  return out;
}

/** Full-batch Adam on the logistic loss with L2 (bias not penalised). */
function fit(xs: number[][], ys: number[], d: number, iterations: number, lambda: number): { w: number[]; b: number } {
  const w = new Float64Array(d);
  let b = 0;
  const m = new Float64Array(d + 1);
  const v = new Float64Array(d + 1);
  const lr = 0.05;
  const [b1, b2, eps] = [0.9, 0.999, 1e-8];
  const n = xs.length;
  for (let it = 1; it <= iterations; it++) {
    const g = new Float64Array(d + 1);
    for (let k = 0; k < n; k++) {
      const x = xs[k];
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * x[j];
      const e = sigmoid(z) - ys[k];
      for (let j = 0; j < d; j++) g[j] += e * x[j];
      g[d] += e;
    }
    for (let j = 0; j <= d; j++) {
      const grad = g[j] / n + (j < d ? lambda * w[j] : 0);
      m[j] = b1 * m[j] + (1 - b1) * grad;
      v[j] = b2 * v[j] + (1 - b2) * grad * grad;
      const step = (lr * (m[j] / (1 - b1 ** it))) / (Math.sqrt(v[j] / (1 - b2 ** it)) + eps);
      if (j < d) w[j] -= step;
      else b -= step;
    }
  }
  return { w: Array.from(w), b };
}

/** Train a risk model (see the file's head); refuses when either outcome has fewer than `minOutcome` examples. */
export function trainRisk(
  examples: readonly RiskExample[],
  specs: readonly FeatureSpec[],
  opts: { seed: number; minCount?: number; minOutcome?: number; iterations?: number; lambda?: number; testShare?: number; maxRows?: number },
): TrainedRisk | { refused: string } {
  const minOutcome = opts.minOutcome ?? 10;
  const rows = [...examples].slice(-(opts.maxRows ?? 20_000));
  const pos = rows.filter((e) => e.y === 1).length;
  const neg = rows.length - pos;
  if (pos < minOutcome || neg < minOutcome) return { refused: `دادهٔ کافی نیست: از هر دو نتیجه دست‌کم ${minOutcome} نمونه لازم است (${pos} مثبت، ${neg} منفی)` };
  const share = opts.testShare ?? 0.2;
  let train: RiskExample[];
  let test: RiskExample[];
  if (rows.every((e) => typeof e.t === "number")) {
    const sorted = [...rows].sort((a, b) => a.t! - b.t!);
    const cut = Math.floor(sorted.length * (1 - share));
    train = sorted.slice(0, cut);
    test = sorted.slice(cut);
    // a time split that leaves one outcome out of either side cannot be judged: fall back to a stratified split
    if (!test.some((e) => e.y === 1) || !test.some((e) => e.y === 0) || !train.some((e) => e.y === 1)) ({ train, test } = stratifiedSplit(rows, (e) => String(e.y), share, opts.seed));
  } else ({ train, test } = stratifiedSplit(rows, (e) => String(e.y), share, opts.seed));
  const enc = fitEncoding(train.map((e) => e.x), specs, opts.minCount ?? 5);
  const xs = train.map((e) => encode(enc.features, e.x));
  const ys = train.map((e) => e.y);
  const { w, b } = fit(xs, ys, enc.columns.length, opts.iterations ?? 400, opts.lambda ?? 1e-3);
  const baseRate = ys.reduce<number>((a, y) => a + y, 0) / ys.length;
  const params: RiskParams = { features: enc.features, columns: enc.columns, w: w.map(round4), b: round4(b), base_rate: round4(baseRate) };
  const p = test.map((e) => scoreRisk(params, e.x).p);
  const metrics = binaryMetrics(p, test.map((e) => e.y), baseRate);
  return { params, metrics, beats: beatsBaseRate(metrics), train_n: train.length, test_n: test.length };
}

/** The probability of a row and its main drivers. */
export function scoreRisk(params: RiskParams, x: Record<string, unknown>, top = 4): RiskScore {
  const v = encode(params.features, x);
  let z = params.b;
  for (let j = 0; j < v.length; j++) z += params.w[j] * v[j];
  const why = v
    .map((xj, j) => ({ feature: params.columns[j], weight: params.w[j] * xj }))
    .filter((c) => Math.abs(c.weight) >= 0.01)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || (a.feature < b.feature ? -1 : 1))
    .slice(0, top)
    .map((c) => ({ feature: c.feature, weight: round4(c.weight) }));
  return { p: round4(sigmoid(z)), why };
}

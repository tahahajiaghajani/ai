// Evaluation of the classical models on their holdout sets (docs/spec/AI.md §13): per-class precision, recall and F1,
// accuracy, macro-F1, coverage and accuracy above a confidence threshold (what «اعمال خودکار» would do), the majority
// baseline; for probabilities: AUC, Brier score, log loss, the base-rate baseline and calibration bins. Pure.

export interface ClassMetrics {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  /** holdout examples of this class */
  support: number;
}

export interface ClassifierMetrics {
  n: number;
  accuracy: number;
  macro_f1: number;
  per_class: ClassMetrics[];
  /** share of predictions at or above each threshold and their accuracy */
  thresholds: { t: number; coverage: number; accuracy: number | null }[];
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Metrics of predictions against truth (labels in `labels` order; unknown predictions count as wrong). */
export function classifierMetrics(truth: readonly string[], pred: readonly string[], conf: readonly number[], labels: readonly string[], thresholds: readonly number[] = [0.5, 0.7, 0.8, 0.9]): ClassifierMetrics {
  const n = truth.length;
  let right = 0;
  const tp = new Map<string, number>();
  const fp = new Map<string, number>();
  const fn = new Map<string, number>();
  for (let k = 0; k < n; k++) {
    if (truth[k] === pred[k]) {
      right++;
      tp.set(truth[k], (tp.get(truth[k]) ?? 0) + 1);
    } else {
      fp.set(pred[k], (fp.get(pred[k]) ?? 0) + 1);
      fn.set(truth[k], (fn.get(truth[k]) ?? 0) + 1);
    }
  }
  const per_class = labels.map((label) => {
    const t = tp.get(label) ?? 0;
    const p = t + (fp.get(label) ?? 0);
    const s = t + (fn.get(label) ?? 0);
    const precision = p ? t / p : 0;
    const recall = s ? t / s : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, precision: r4(precision), recall: r4(recall), f1: r4(f1), support: s };
  });
  const present = per_class.filter((c) => c.support > 0);
  const macro = present.length ? present.reduce((a, c) => a + c.f1, 0) / present.length : 0;
  return {
    n,
    accuracy: n ? r4(right / n) : 0,
    macro_f1: r4(macro),
    per_class,
    thresholds: thresholds.map((t) => {
      let covered = 0;
      let ok = 0;
      for (let k = 0; k < n; k++) {
        if (conf[k] >= t) {
          covered++;
          if (truth[k] === pred[k]) ok++;
        }
      }
      return { t, coverage: n ? r4(covered / n) : 0, accuracy: covered ? r4(ok / covered) : null };
    }),
  };
}

/** The majority class predicted for everything (the baseline every classifier must beat). */
export function majorityBaseline(trainLabels: readonly string[], truth: readonly string[], labels: readonly string[]): ClassifierMetrics & { label: string } {
  const counts = new Map<string, number>();
  for (const l of trainLabels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const label = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "";
  return { ...classifierMetrics(truth, truth.map(() => label), truth.map(() => 1), labels), label };
}

/**
 * Does a classifier beat the majority baseline clearly enough to be used: a macro-F1 at least 0.05 higher and an
 * accuracy no lower than the baseline's.
 */
export function beatsMajority(m: Pick<ClassifierMetrics, "accuracy" | "macro_f1">, base: Pick<ClassifierMetrics, "accuracy" | "macro_f1">): boolean {
  return m.macro_f1 >= base.macro_f1 + 0.05 && m.accuracy >= base.accuracy;
}

// ----- probabilities (risk models) ---------------------------------------------------------------------------------

export interface BinaryMetrics {
  n: number;
  positives: number;
  base_rate: number;
  auc: number | null;
  brier: number;
  /** Brier score of always answering the base rate */
  brier_base: number;
  /** 1 − brier / brier_base: above 0 beats the base rate */
  skill: number;
  log_loss: number;
  /** ten bins of predicted probability: mean prediction and observed rate */
  calibration: { from: number; to: number; n: number; predicted: number | null; observed: number | null }[];
}

/** AUC by the rank-sum (Mann–Whitney) statistic with ties shared; null without both outcomes. */
export function auc(p: readonly number[], y: readonly number[]): number | null {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  let pos = 0;
  let neg = 0;
  for (const v of y) v ? pos++ : neg++;
  if (!pos || !neg) return null;
  let rankSum = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (y[idx[k]]) rankSum += rank;
    i = j + 1;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function binaryMetrics(p: readonly number[], y: readonly number[], baseRate?: number): BinaryMetrics {
  const n = p.length;
  const positives = y.reduce((a, v) => a + (v ? 1 : 0), 0);
  const rate = baseRate ?? (n ? positives / n : 0);
  let brier = 0;
  let brierBase = 0;
  let ll = 0;
  for (let k = 0; k < n; k++) {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, p[k]));
    brier += (p[k] - y[k]) ** 2;
    brierBase += (rate - y[k]) ** 2;
    ll += -(y[k] ? Math.log(q) : Math.log(1 - q));
  }
  brier = n ? brier / n : 0;
  brierBase = n ? brierBase / n : 0;
  const calibration = Array.from({ length: 10 }, (_, b) => {
    const from = b / 10;
    const to = (b + 1) / 10;
    const ks = p.map((x, k) => (x >= from && (x < to || (b === 9 && x <= 1)) ? k : -1)).filter((k) => k >= 0);
    return {
      from,
      to,
      n: ks.length,
      predicted: ks.length ? r4(ks.reduce((a, k) => a + p[k], 0) / ks.length) : null,
      observed: ks.length ? r4(ks.reduce((a, k) => a + y[k], 0) / ks.length) : null,
    };
  });
  const a = auc(p, y);
  return {
    n,
    positives,
    base_rate: r4(rate),
    auc: a === null ? null : r4(a),
    brier: r4(brier),
    brier_base: r4(brierBase),
    skill: brierBase > 0 ? r4(1 - brier / brierBase) : 0,
    log_loss: n ? r4(ll / n) : 0,
    calibration,
  };
}

/** Does a risk model beat the base rate: a positive Brier skill and an AUC of at least 0.6. */
export function beatsBaseRate(m: Pick<BinaryMetrics, "skill" | "auc">): boolean {
  return m.skill > 0.01 && (m.auc ?? 0) >= 0.6;
}

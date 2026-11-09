// Text classification (catalogue AI-041/AI-056; docs/spec/AI.md §13): TF-IDF features of the record's text and its
// categorical inputs, two classical models trained per organisation — multinomial naive Bayes and multinomial logistic
// regression (softmax, L2, SGD with a seeded order) — compared on a stratified holdout; the better macro-F1 wins, its
// confidences are calibrated by temperature scaling on the holdout, and it is used only when it beats the majority
// baseline. A prediction carries the top-k labels with confidences and the features that pushed it («چرا؟»). Pure: the
// caller reads the examples with the access it chose and stores the parameters.
import { fitVocab, round4, tfidf, vocabIndex, type Sparse, type Vocab } from "./features";
import { beatsMajority, classifierMetrics, majorityBaseline, type ClassifierMetrics } from "./metrics";
import { mulberry32, shuffled, stratifiedSplit } from "./rng";

export interface TextExample {
  tokens: string[];
  label: string;
}

export type ClassifierAlgo = "nb" | "logreg";

/** What is stored: the vocabulary, the labels, one weight row and bias per label, the calibration temperature. */
export interface ClassifierParams {
  algo: ClassifierAlgo;
  vocab: Vocab;
  labels: string[];
  w: number[][];
  b: number[];
  temperature: number;
}

export interface TrainedClassifier {
  params: ClassifierParams;
  metrics: ClassifierMetrics;
  baseline: ClassifierMetrics & { label: string };
  beats: boolean;
  candidates: { algo: ClassifierAlgo; accuracy: number; macro_f1: number }[];
  train_n: number;
  test_n: number;
  /** labels left out for having too few examples */
  dropped: string[];
}

export interface Prediction {
  label: string;
  confidence: number;
}

export interface Explained {
  top: Prediction[];
  /** features that favour the first label over the second, strongest first */
  why: { feature: string; weight: number }[];
}

export interface TrainOptions {
  seed: number;
  /** a label needs this many examples to be learnt */
  minClassSize?: number;
  maxFeatures?: number;
  testShare?: number;
  thresholds?: number[];
  /** run only this algorithm (tests) */
  only?: ClassifierAlgo;
}

const softmax = (s: number[], t = 1): number[] => {
  const m = Math.max(...s);
  const e = s.map((x) => Math.exp((x - m) / t));
  const z = e.reduce((a, x) => a + x, 0);
  return e.map((x) => x / z);
};

function scores(p: Pick<ClassifierParams, "w" | "b">, x: Sparse): number[] {
  return p.b.map((b, c) => {
    const row = p.w[c];
    let s = b;
    for (let k = 0; k < x.i.length; k++) s += row[x.i[k]] * x.v[k];
    return s;
  });
}

/** Multinomial naive Bayes over TF-IDF weights (Laplace α), log priors from the class sizes. */
function fitNb(xs: Sparse[], ys: number[], c: number, v: number, alpha = 0.1): Pick<ClassifierParams, "w" | "b"> {
  const counts = Array.from({ length: c }, () => new Float64Array(v));
  const sizes = new Array<number>(c).fill(0);
  xs.forEach((x, k) => {
    sizes[ys[k]]++;
    const row = counts[ys[k]];
    for (let q = 0; q < x.i.length; q++) row[x.i[q]] += x.v[q];
  });
  const n = xs.length;
  const w = counts.map((row) => {
    let total = 0;
    for (let j = 0; j < v; j++) total += row[j];
    const denom = total + alpha * v;
    return Array.from(row, (x) => Math.log((x + alpha) / denom));
  });
  return { w, b: sizes.map((s) => Math.log((s + 1) / (n + c))) };
}

/** Softmax regression: SGD over a seeded order, L2 on the weights it touches, a decaying step. */
function fitLogreg(xs: Sparse[], ys: number[], c: number, v: number, seed: number, epochs = 18, lambda = 1e-4): Pick<ClassifierParams, "w" | "b"> {
  const w = Array.from({ length: c }, () => new Float64Array(v));
  const b = new Array<number>(c).fill(0);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const order = xs.map((_, k) => k);
  let step = 0;
  for (let e = 0; e < epochs; e++) {
    for (const k of shuffled(order, rand)) {
      const x = xs[k];
      const eta = 0.8 / (1 + step / Math.max(1, xs.length * 2));
      step++;
      const s = b.map((bb, q) => {
        let t = bb;
        const row = w[q];
        for (let r = 0; r < x.i.length; r++) t += row[x.i[r]] * x.v[r];
        return t;
      });
      const p = softmax(s);
      for (let q = 0; q < c; q++) {
        const g = p[q] - (q === ys[k] ? 1 : 0);
        b[q] -= eta * g;
        const row = w[q];
        for (let r = 0; r < x.i.length; r++) {
          const j = x.i[r];
          row[j] -= eta * (g * x.v[r] + lambda * row[j]);
        }
      }
    }
  }
  return { w: w.map((row) => Array.from(row)), b };
}

/** The temperature that minimises the holdout's log loss (a grid; 1 when the holdout is empty). */
function fitTemperature(raw: number[][], ys: number[]): number {
  if (!raw.length) return 1;
  let best = { t: 1, nll: Infinity };
  for (let k = -40; k <= 20; k++) {
    const t = Math.exp(k / 10);
    let nll = 0;
    for (let q = 0; q < raw.length; q++) nll -= Math.log(Math.max(1e-12, softmax(raw[q], t)[ys[q]]));
    if (nll < best.nll - 1e-12) best = { t, nll };
  }
  return best.t;
}

/**
 * Train both models on a stratified split and keep the better one (deterministic for a seed). Refuses — with a
 * Persian reason — when fewer than two labels have enough examples.
 */
export function trainTextClassifier(examples: readonly TextExample[], opts: TrainOptions): TrainedClassifier | { refused: string } {
  const min = opts.minClassSize ?? 5;
  const counts = new Map<string, number>();
  for (const e of examples) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
  const labels = [...counts.entries()].filter(([, n]) => n >= min).map(([l]) => l).sort();
  const dropped = [...counts.keys()].filter((l) => !labels.includes(l)).sort();
  if (labels.length < 2) return { refused: `دادهٔ کافی نیست: دست‌کم دو مقدار با ${min} نمونه یا بیشتر لازم است` };
  const usable = examples.filter((e) => labels.includes(e.label));
  const { train, test } = stratifiedSplit(usable, (e) => e.label, opts.testShare ?? 0.2, opts.seed, (e) => e.tokens.join(" "));
  const vocab = fitVocab(train.map((e) => e.tokens), { maxFeatures: opts.maxFeatures ?? 3000 });
  if (!vocab.terms.length) return { refused: "دادهٔ کافی نیست: واژهٔ تکراری در متن‌ها پیدا نشد" };
  const index = vocabIndex(vocab);
  const lab = new Map(labels.map((l, i) => [l, i]));
  const xTrain = train.map((e) => tfidf(vocab, index, e.tokens));
  const yTrain = train.map((e) => lab.get(e.label)!);
  const xTest = test.map((e) => tfidf(vocab, index, e.tokens));
  const yTest = test.map((e) => lab.get(e.label)!);
  const truth = test.map((e) => e.label);
  const thresholds = opts.thresholds ?? [0.5, 0.7, 0.8, 0.9];

  const runs: { algo: ClassifierAlgo; params: ClassifierParams; metrics: ClassifierMetrics }[] = [];
  for (const algo of (opts.only ? [opts.only] : ["nb", "logreg"]) as ClassifierAlgo[]) {
    const fit = algo === "nb" ? fitNb(xTrain, yTrain, labels.length, vocab.terms.length) : fitLogreg(xTrain, yTrain, labels.length, vocab.terms.length, opts.seed);
    const raw = xTest.map((x) => scores(fit, x));
    const temperature = fitTemperature(raw, yTest);
    const probs = raw.map((s) => softmax(s, temperature));
    const pred = probs.map((p) => labels[p.indexOf(Math.max(...p))]);
    const conf = probs.map((p) => Math.max(...p));
    const params: ClassifierParams = { algo, vocab: { terms: vocab.terms, idf: vocab.idf.map(round4) }, labels, w: fit.w.map((row) => row.map(round4)), b: fit.b.map(round4), temperature: round4(temperature) };
    runs.push({ algo, params, metrics: classifierMetrics(truth, pred, conf, labels, thresholds) });
  }
  runs.sort((a, b) => b.metrics.macro_f1 - a.metrics.macro_f1 || b.metrics.accuracy - a.metrics.accuracy || (a.algo < b.algo ? -1 : 1));
  const best = runs[0];
  const baseline = majorityBaseline(train.map((e) => e.label), truth, labels);
  return {
    params: best.params,
    metrics: best.metrics,
    baseline,
    beats: beatsMajority(best.metrics, baseline),
    candidates: runs.map((r) => ({ algo: r.algo, accuracy: r.metrics.accuracy, macro_f1: r.metrics.macro_f1 })),
    train_n: train.length,
    test_n: test.length,
    dropped,
  };
}

/** A model ready to predict (the index built once). */
export interface LoadedClassifier {
  params: ClassifierParams;
  index: Map<string, number>;
}

export const loadClassifier = (params: ClassifierParams): LoadedClassifier => ({ params, index: vocabIndex(params.vocab) });

/** The top-k labels of a document and the features behind the first one (against the runner-up). */
export function predictText(m: LoadedClassifier, tokens: readonly string[], k = 3): Explained {
  const x = tfidf(m.params.vocab, m.index, tokens);
  if (!x.i.length) return { top: [], why: [] };
  const p = softmax(scores(m.params, x), m.params.temperature || 1);
  const order = p.map((_, i) => i).sort((a, b) => p[b] - p[a] || a - b);
  const top = order.slice(0, k).map((i) => ({ label: m.params.labels[i], confidence: round4(p[i]) }));
  const [c, r] = order;
  const why =
    r === undefined
      ? []
      : x.i
          .map((j, q) => ({ feature: m.params.vocab.terms[j], weight: x.v[q] * (m.params.w[c][j] - m.params.w[r][j]) }))
          .filter((f) => f.weight > 0)
          .sort((a, b) => b.weight - a.weight || (a.feature < b.feature ? -1 : 1))
          .slice(0, 5)
          .map((f) => ({ feature: f.feature, weight: round4(f.weight) }));
  return { top, why };
}

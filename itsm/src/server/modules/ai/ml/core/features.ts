// Text and categorical features of the classical models: Persian-normalised words (the search form of @shared/ai/text:
// Arabic letters folded, digits unified, half-spaces removed), stop words dropped, a light stem, word pairs, and the
// values of categorical inputs as tokens `@field=value`. Numbers that look like identifiers (five digits or more:
// national ids, phone numbers, record numbers) are never features — they do not generalise and a model must not keep
// them. TF-IDF with a sublinear term frequency and unit length; the vocabulary is chosen deterministically.
import { STOP_WORDS, stem, words } from "@shared/ai/text";

/** Longest token kept (longer ones are hashes, URLs, base64). */
const MAX_TOKEN = 40;
const ID_LIKE = /\d{5,}/;

/** The word tokens of a text: normalised, no stop words, stemmed, with adjacent pairs (`a_b`). */
export function textTokens(text: string, opts: { pairs?: boolean; max?: number } = {}): string[] {
  const ws: string[] = [];
  for (const w of words(text)) {
    if (STOP_WORDS.has(w) || w.length > MAX_TOKEN || ID_LIKE.test(w) || /@/.test(w)) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    ws.push(stem(w));
    if (ws.length >= (opts.max ?? 400)) break;
  }
  if (opts.pairs === false) return ws;
  const out = [...ws];
  for (let i = 0; i + 1 < ws.length; i++) out.push(`${ws[i]}_${ws[i + 1]}`);
  return out;
}

/** The token of a categorical input (`@category=network`); empty values give none. */
export function fieldToken(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const v = Array.isArray(value) ? value.join("|") : String(value);
  return v.length > 80 ? null : `@${field}=${v}`;
}

export interface Vocab {
  terms: string[];
  idf: number[];
}

/** Sparse vector: ascending indices and their values. */
export interface Sparse {
  i: number[];
  v: number[];
}

/**
 * The vocabulary of a corpus: terms in at least `minDf` documents and at most `maxDf` of them (a share), the
 * `maxFeatures` most frequent ones (ties by the term, so the choice never depends on the order of the documents), with
 * smooth idf = ln((1 + N) / (1 + df)) + 1. Field tokens (`@…`) are always kept when frequent enough.
 */
export function fitVocab(docs: readonly string[][], opts: { minDf?: number; maxDf?: number; maxFeatures?: number } = {}): Vocab {
  const minDf = opts.minDf ?? 2;
  const maxDf = opts.maxDf ?? 0.9;
  const maxFeatures = opts.maxFeatures ?? 3000;
  const n = docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const kept = [...df.entries()]
    .filter(([t, c]) => c >= minDf && (t.startsWith("@") || n < 20 || c / n <= maxDf))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, maxFeatures)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { terms: kept.map(([t]) => t), idf: kept.map(([, c]) => Math.log((1 + n) / (1 + c)) + 1) };
}

/** term → index of a vocabulary (built once per model and cached by the caller). */
export function vocabIndex(v: Vocab): Map<string, number> {
  return new Map(v.terms.map((t, i) => [t, i]));
}

/** The TF-IDF vector of a document: (1 + ln tf) × idf, unit length; tokens outside the vocabulary are ignored. */
export function tfidf(v: Vocab, index: Map<string, number>, tokens: readonly string[]): Sparse {
  const tf = new Map<number, number>();
  for (const t of tokens) {
    const i = index.get(t);
    if (i !== undefined) tf.set(i, (tf.get(i) ?? 0) + 1);
  }
  const ids = [...tf.keys()].sort((a, b) => a - b);
  const vals = ids.map((i) => (1 + Math.log(tf.get(i)!)) * v.idf[i]);
  const norm = Math.sqrt(vals.reduce((a, x) => a + x * x, 0));
  return { i: ids, v: norm ? vals.map((x) => x / norm) : vals };
}

/** Rounds the numbers of stored parameters (smaller JSON, identical decisions to the 4th decimal). */
export const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

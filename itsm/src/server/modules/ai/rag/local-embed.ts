// The local fallback embedder: a deterministic bag of hashed features — words, word pairs and character 3/4-grams of
// the Persian-normalised search form — folded into a fixed number of dimensions with signed hashing (FNV-1a), damped
// with log(1 + x) and scaled to unit length. It needs no model and no network, so retrieval works fully offline and
// before any embedding model is configured; it matches spelling variants, attached suffixes and typos that full-text
// search misses, but it does not understand meaning (the admin page shows it as «پایه»).
import { searchForm, STOP_WORDS } from "@shared/ai/text";

export const LOCAL_DIMS = 384;
/** Key of the local embedding (stored next to every chunk; changes when the algorithm changes). */
export const LOCAL_KEY = `local:hash-v1:${LOCAL_DIMS}`;

/** FNV-1a, 32 bits. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function add(v: Float64Array, feature: string, weight: number): void {
  const h = fnv1a(feature);
  const i = h % v.length;
  // the sign comes from another part of the hash, so collisions cancel out on average
  v[i] += (h & 0x80000000 ? -1 : 1) * weight;
}

/** The local embedding of a text (unit length; all zeros for a text without words). */
export function localEmbed(text: string, dims = LOCAL_DIMS): number[] {
  const v = new Float64Array(dims);
  const words = searchForm(text).split(" ").filter(Boolean).slice(0, 4000);
  let prev: string | null = null;
  for (const w of words) {
    const stop = STOP_WORDS.has(w);
    if (!stop) {
      add(v, `w:${w}`, 1);
      if (prev) add(v, `b:${prev}_${w}`, 0.6);
      prev = w;
    }
    if (w.length < 3) continue;
    const padded = `<${w}>`;
    const cw = stop ? 0.1 : 0.35;
    for (const n of [3, 4]) {
      for (let i = 0; i + n <= padded.length; i++) add(v, `c${n}:${padded.slice(i, i + n)}`, cw);
    }
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) {
    const x = v[i];
    v[i] = x === 0 ? 0 : Math.sign(x) * Math.log1p(Math.abs(x));
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  const out = new Array<number>(dims);
  for (let i = 0; i < dims; i++) out[i] = norm ? Math.fround(v[i] / norm) : 0;
  return out;
}

/** Cosine similarity of two vectors of the same length (0 when either is all zeros). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Fold a vector into fewer dimensions (sum by index modulo `dims`) and scale it to unit length. */
export function foldVector(v: number[], dims: number): number[] {
  if (v.length === dims) return v;
  const out = new Array<number>(dims).fill(0);
  for (let i = 0; i < v.length; i++) out[i % dims] += v[i];
  const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
  return out.map((x) => (n ? Math.fround(x / n) : 0));
}

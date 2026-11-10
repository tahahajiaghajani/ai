// Seeded randomness for the classical models (docs/spec/AI.md §13): every training run that shuffles, splits or
// initialises draws from mulberry32 seeded by the model's seed, so the same data and seed give the same model and the
// same metrics on every runtime (web and Windows) — a test can pin a number.

/** mulberry32: a small, fast, well-mixed 32-bit generator; returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a of a string (a seed from a key, a stable bucket for an id). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A shuffled copy (Fisher–Yates with the given generator). */
export function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A stratified holdout split: from every label, `share` of its examples (at least one when it has two or more) go to
 * the test set. Deterministic for a seed; with `key` (a canonical order inside each label) the order of the input
 * decides nothing either.
 */
export function stratifiedSplit<T>(items: readonly T[], label: (x: T) => string, share: number, seed: number, key?: (x: T) => string): { train: T[]; test: T[] } {
  const rand = mulberry32(seed);
  const by = new Map<string, T[]>();
  for (const x of items) {
    const k = label(x);
    const list = by.get(k);
    if (list) list.push(x);
    else by.set(k, [x]);
  }
  const train: T[] = [];
  const test: T[] = [];
  for (const k of [...by.keys()].sort()) {
    const group = by.get(k)!;
    if (key) group.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const list = shuffled(group, rand);
    const n = list.length >= 2 ? Math.max(1, Math.round(list.length * share)) : 0;
    test.push(...list.slice(0, n));
    train.push(...list.slice(n));
  }
  return { train, test };
}

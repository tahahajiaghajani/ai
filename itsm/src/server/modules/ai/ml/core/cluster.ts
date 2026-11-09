// Similarity and clustering over unit vectors (catalogue AI-043/AI-045; docs/spec/AI.md §13). Records are embedded
// with the local embedder (deterministic, offline). Clustering is density-based and light: a leader pass in the given
// order opens a cluster for every point farther than `join` from every leader, a few spherical k-means rounds move
// the centres, points below `join` of their centre are noise, and only clusters of at least `minSize` members whose
// mean similarity to the centre is at least `cohesion` are kept. Duplicates are pairs at or above a threshold. Pure.

export type Vec = ArrayLike<number>;

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function normalise(v: Float64Array): Float64Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export interface Cluster {
  /** indices of the members, closest to the centre first */
  members: number[];
  /** similarity of each member to the centre (same order) */
  sims: number[];
  cohesion: number;
  centre: number[];
}

export interface ClusterOptions {
  /** a point joins a cluster at this similarity to its centre (and opens one below it) */
  join?: number;
  minSize?: number;
  cohesion?: number;
  rounds?: number;
  maxClusters?: number;
}

/** Cluster unit vectors (see the file's head). Deterministic for an order of the points. */
export function clusterVectors(vs: readonly Vec[], opts: ClusterOptions = {}): { clusters: Cluster[]; noise: number[] } {
  const join = opts.join ?? 0.45;
  const minSize = opts.minSize ?? 3;
  const minCohesion = opts.cohesion ?? 0.5;
  const maxClusters = opts.maxClusters ?? 400;
  const dims = vs[0]?.length ?? 0;
  // leaders
  let centres: Float64Array[] = [];
  for (const v of vs) {
    let best = -1;
    for (const c of centres) best = Math.max(best, dot(v, c));
    if (best < join && centres.length < maxClusters) centres.push(Float64Array.from(v as ArrayLike<number>));
  }
  // spherical k-means rounds
  let assign = new Array<number>(vs.length).fill(-1);
  for (let round = 0; round < (opts.rounds ?? 4); round++) {
    const next = vs.map((v) => {
      let bi = -1;
      let bs = -Infinity;
      centres.forEach((c, i) => {
        const s = dot(v, c);
        if (s > bs + 1e-12) {
          bs = s;
          bi = i;
        }
      });
      return bs >= join ? bi : -1;
    });
    const sums = centres.map(() => new Float64Array(dims));
    const sizes = centres.map(() => 0);
    next.forEach((c, k) => {
      if (c < 0) return;
      sizes[c]++;
      const v = vs[k];
      for (let i = 0; i < dims; i++) sums[c][i] += v[i];
    });
    const changed = next.some((c, k) => c !== assign[k]);
    assign = next;
    // empty clusters disappear; the rest move to their members' mean direction
    const remap = new Map<number, number>();
    const moved: Float64Array[] = [];
    sizes.forEach((size, i) => {
      if (!size) return;
      remap.set(i, moved.length);
      moved.push(normalise(sums[i]));
    });
    centres = moved;
    assign = assign.map((c) => (c < 0 ? -1 : (remap.get(c) ?? -1)));
    if (!changed && round > 0) break;
  }
  const clusters: Cluster[] = [];
  const noise: number[] = [];
  centres.forEach((c, ci) => {
    const members = assign.map((a, k) => (a === ci ? k : -1)).filter((k) => k >= 0);
    const scored = members.map((k) => ({ k, s: dot(vs[k], c) })).sort((a, b) => b.s - a.s || a.k - b.k);
    const cohesion = scored.length ? scored.reduce((a, x) => a + x.s, 0) / scored.length : 0;
    if (scored.length >= minSize && cohesion >= minCohesion) {
      clusters.push({ members: scored.map((x) => x.k), sims: scored.map((x) => Math.round(x.s * 1e4) / 1e4), cohesion: Math.round(cohesion * 1e4) / 1e4, centre: Array.from(c, (x) => Math.round(x * 1e5) / 1e5) });
    } else noise.push(...members);
  });
  assign.forEach((a, k) => {
    if (a < 0) noise.push(k);
  });
  clusters.sort((a, b) => b.members.length - a.members.length || b.cohesion - a.cohesion || a.members[0] - b.members[0]);
  return { clusters, noise: noise.sort((a, b) => a - b) };
}

/** Pairs (i < j) at or above `threshold` similarity, most similar first (at most `max`). */
export function similarPairs(vs: readonly Vec[], threshold: number, max = 200): { a: number; b: number; sim: number }[] {
  const out: { a: number; b: number; sim: number }[] = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const s = dot(vs[i], vs[j]);
      if (s >= threshold) out.push({ a: i, b: j, sim: Math.round(s * 1e4) / 1e4 });
    }
  }
  return out.sort((x, y) => y.sim - x.sim || x.a - y.a || x.b - y.b).slice(0, max);
}

/** The candidates most similar to one vector, at or above `threshold` (at most `k`). */
export function nearest(v: Vec, candidates: readonly Vec[], threshold: number, k = 5): { index: number; sim: number }[] {
  return candidates
    .map((c, index) => ({ index, sim: Math.round(dot(v, c) * 1e4) / 1e4 }))
    .filter((x) => x.sim >= threshold)
    .sort((a, b) => b.sim - a.sim || a.index - b.index)
    .slice(0, k);
}

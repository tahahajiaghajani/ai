/**
 * The geometry of the turning home arcade («سرآغاز»), pure (no imports, shared with the tests).
 *
 * At rest it is exactly the former three-arch flex row: a 45% centre between two 27.5% sides with two 3.5% gaps,
 * which the row shrank by 93/100 to fit its width. Every arch is placed by its offset `o` from the centre
 * (o = 0 the centre, ±1 the sides, beyond that parked out of sight; o > 0 is the end side, where the next picture
 * waits: the left in Persian, the right in English). Between two whole offsets width, height, place, ring gap,
 * keystone, lean depth and the weights of the scroll parting interpolate, so the gap between neighbours stays
 * 3.5% throughout a turn and the rest poses are pixel for pixel the old arcade. Past the sides arches fade.
 */

/** the former flex row's shrink: (100 − 2 × 3.5) / (45 + 27.5 + 27.5) */
const FIT = 0.93;
/** widths and gap, % of the stage width */
export const CENTRE_W = 45 * FIT;
export const SIDE_W = 27.5 * FIT;
export const GAP = 3.5;
/** heights, % of the stage width: the centre arch is 3/4.3 (and sets the stage), the sides 3/4 */
export const CENTRE_H = (CENTRE_W * 4.3) / 3;
export const SIDE_H = (SIDE_W * 4) / 3;
/** centre-to-centre distance from the middle to a side, and between two side-sized arches */
export const STEP = CENTRE_W / 2 + GAP + SIDE_W / 2;
export const OUT = SIDE_W + GAP;
/**
 * Past a side an arch fades over this share of the next step: slowly on the end side, the stage's outer edge, where
 * the next picture glides in from beyond the gutter; quickly on the start side, which faces the words on desktop.
 */
export const FADE_END = 0.9;
export const FADE_START = 0.4;
/** the stage's CSS aspect ratio (width / height) */
export const STAGE_RATIO = `100 / ${+CENTRE_H.toFixed(4)}`;

export interface Pose {
  /** % of the stage width / height */
  left: number;
  width: number;
  height: number;
  z: number;
  /** 0–1: past the sides an arch fades out (0 = parked, hidden) */
  fade: number;
  /** keystone opacity (the centre's diamond) */
  keystone: number;
  /** px between the arch and its hairline ring: 12 in the centre, 8 at the sides */
  ringGap: number;
  /** pointer lean (usePointerDepth): 7 in the centre, 14 at the sides */
  depth: number;
  /** scroll parting at full scroll (hero.tsx sets --part 0 → 1): x / y in % of the arch, scale and opacity taken */
  px: number;
  py: number;
  ps: number;
  po: number;
}

/** The pose of an arch at offset `o` (any real number). `rtl`: Persian, where the end side is the left. */
export function heroPose(o: number, rtl: boolean): Pose {
  const a = Math.abs(o);
  const t = Math.min(1, a);
  const width = CENTRE_W - (CENTRE_W - SIDE_W) * t;
  const h = CENTRE_H - (CENTRE_H - SIDE_H) * t;
  const dist = a <= 1 ? STEP * a : STEP + OUT * (a - 1);
  // +1 = to the right of the centre
  const phys = o === 0 ? 0 : (rtl ? -1 : 1) * Math.sign(o);
  const cx = 50 + phys * dist;
  return {
    left: cx - width / 2,
    width,
    height: (h / CENTRE_H) * 100,
    z: a < 0.5 ? 3 : a < 1.5 ? 2 : 1,
    fade: fadeAt(a, o > 0 ? FADE_END : FADE_START),
    keystone: Math.max(0, 1 - 2 * t),
    ringGap: 12 - 4 * t,
    depth: 7 + 7 * t,
    // the former tweens: sides drift outwards by 18% and down by 8% to 0.35 opacity, the centre rises 6% and grows 4%
    px: 18 * t * phys,
    py: 8 * t - 6 * (1 - t),
    ps: 0.04 * (1 - t),
    po: 0.65 * t,
  };
}

function fadeAt(a: number, window: number): number {
  if (a <= 1) return 1;
  const f = 1 - (a - 1) / window;
  return f < 1e-6 ? 0 : f;
}

const fix = (n: number, d = 4) => +n.toFixed(d);

/** The pose as inline style values (React style object and the per-frame writer use the same strings). */
export function poseStyle(p: Pose): Record<string, string> {
  return {
    left: `${fix(p.left)}%`,
    width: `${fix(p.width)}%`,
    height: `${fix(p.height)}%`,
    zIndex: String(p.z),
    visibility: p.fade > 0 ? "visible" : "hidden",
    "--fade": String(fix(p.fade, 3)),
    "--keystone": String(fix(p.keystone, 3)),
    "--ring-gap": `${fix(p.ringGap, 2)}px`,
    "--part-x": String(fix(p.px, 3)),
    "--part-y": String(fix(p.py, 3)),
    "--part-s": String(fix(p.ps, 4)),
    "--part-o": String(fix(p.po, 3)),
  };
}

/**
 * Length of the virtual ring of arches: a turn shows four distinct arches at once (three and the one arriving), so
 * fewer than four pictures go round the ring more than once (three pictures: twice).
 */
export function ringLength(n: number): number {
  return n >= 4 ? n : Math.max(1, n) * Math.ceil(4 / Math.max(1, n));
}

/** `x` wrapped into [−L/2, L/2): the offset of an arch from the centre on a ring of length L. */
export function wrap(x: number, L: number): number {
  const h = L / 2;
  return ((((x + h) % L) + L) % L) - h;
}

/** Offset of virtual arch `i` when the ring stands at position `v` (v = the virtual index in the centre). */
export const offsetOf = (i: number, v: number, L: number) => wrap(i - v, L);

/** `x` mod L into [0, L). */
export const ringIndex = (x: number, L: number) => ((Math.round(x) % L) + L) % L;

/** The virtual arches within `k` of any whole ring position from `lo` to `hi` (what a turn between them can show). */
export function ringNear(lo: number, hi: number, k: number, L: number): number[] {
  const out = new Set<number>();
  for (let x = Math.floor(Math.min(lo, hi)) - k; x <= Math.ceil(Math.max(lo, hi)) + k; x++) out.add(ringIndex(x, L));
  return [...out].sort((a, b) => a - b);
}

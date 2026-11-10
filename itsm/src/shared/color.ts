// Colour maths shared by the token checker (scripts/ds-tokens.ts) and the style guide (settings/style-guide):
// parsing CSS colours, alpha compositing, WCAG 2 contrast, OKLCH and colour-blind ΔE (Machado et al. 2009, the
// dataviz validator's model). Pure functions, no DOM.

export type RGBA = [number, number, number, number];

/**
 * #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(r g b), rgb(r g b / a), rgba(r, g, b, a) → [r, g, b, a]; anything else → null.
 * (The production CSS minifier writes rgb(r g b / a) as #rrggbbaa, so computed token values can come back that way.)
 */
export function parseColor(v: string): RGBA | null {
  const s = v.trim();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  return null;
}

/** `fg` composited over an opaque `bg`. */
export function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: RGBA) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** WCAG 2 contrast ratio of two opaque colours (1–21). */
export function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const toHex = ([r, g, b]: RGBA) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

function oklabFromLin([r, g, b]: number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const linRgb = (c: RGBA) => [lin(c[0]), lin(c[1]), lin(c[2])];

/** OKLCH: lightness 0–1, chroma, hue in degrees. */
export function oklch(c: RGBA): [number, number, number] {
  const [L, a, b] = oklabFromLin(linRgb(c));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

// Machado, Oliveira & Fernandes 2009, severity 1.0
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;
export type Deficiency = keyof typeof MACHADO;

function simulate(c: RGBA, kind: Deficiency) {
  const [r, g, b] = linRgb(c);
  const M = MACHADO[kind];
  const k = (x: number) => Math.max(0, Math.min(1, x));
  return [k(M[0][0] * r + M[0][1] * g + M[0][2] * b), k(M[1][0] * r + M[1][1] * g + M[1][2] * b), k(M[2][0] * r + M[2][1] * g + M[2][2] * b)];
}

/** OKLab ΔE × 100 between two colours, under normal vision or a simulated deficiency. */
export function deltaE(a: RGBA, b: RGBA, kind?: Deficiency): number {
  const x = oklabFromLin(kind ? simulate(a, kind) : linRgb(a));
  const y = oklabFromLin(kind ? simulate(b, kind) : linRgb(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

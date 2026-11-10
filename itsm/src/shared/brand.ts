// The «کاریز» / Kariz brand drawing: the mark, the Persian and Latin wordmarks, the lockups and the app icon as SVG
// path data and string builders. One source for the React components (src/ui/components/brand.tsx), the asset
// generator (scripts/brand-assets.mts: favicons, PWA icons, the Windows .ico, tray, installer art) and the brand book
// (docs/BRAND_FA.md, docs/brand/). Pure data and string functions — no DOM, no React — so the server and Node
// scripts can use it too.
//
// The mark: the mouth of a kariz (qanat) — the arch where water that travelled unseen under the desert comes to
// light — and the rhombic nuqta, the calligrapher's unit of measure, as the drop at the outlet. Drawn on a 24-unit
// grid with one 2.8-unit stroke and round ends, like the icon set (Lucide, 24 grid).
// The wordmarks are hand-drawn monolines on the same stroke family (2.5 units, round ends, rhombic nuqtas):
// «کاریز» follows the skeleton of Arad, the UI typeface; "kariz" is geometric, its i-dot is the nuqta.

/** The name the drawn wordmarks spell. brand.tsx draws them only while APP_NAME / APP_NAME_EN match these. */
export const BRAND_NAME = { fa: "کاریز", en: "Kariz" } as const;

/** Brand colours (theme-independent); the UI roles derived from them live in src/ui/ds/tokens.css. */
export const BRAND_COLORS = {
  /** فیروزه — turquoise: the primary; 700 is the signature on paper, 400 on charcoal */
  firuzeh: { 50: "#EEF9FA", 100: "#E0F5F7", 200: "#BFEBEF", 300: "#96DCE2", 400: "#61C6CF", 500: "#2CAFB9", 600: "#0C959E", 700: "#0A7178", 800: "#075B61", 900: "#044348", 950: "#022A2D" },
  /** لاجورد — lapis: the night of the brand surfaces, AI and information */
  lajvard: { 50: "#F2F5FE", 100: "#E4EBFD", 200: "#C8D7FE", 300: "#A3BCFC", 400: "#7C9AEF", 500: "#5778DF", 600: "#3D5BC6", 700: "#2E47A9", 800: "#233783", 900: "#16255C", 950: "#0B1538" },
  /** زعفران — saffron: warmth, the lit nuqta, celebration and «on hold» */
  zaferan: { 50: "#FEF5EB", 100: "#FEE9D0", 200: "#FED4A2", 300: "#FEBA5F", 400: "#EEA023", 500: "#C8830B", 600: "#A66C08", 700: "#875806", 800: "#6A4404", 900: "#4E3104", 950: "#331F04" },
  /** ink and paper (کاهگل و مرکب): the neutrals of the light theme; charcoal of the dark one */
  ink: "#221D18",
  paper: "#F7F4F0",
  white: "#FFFFFF",
  charcoal: "#110F0E",
  snow: "#F2F0EC",
} as const;

/** The app icon's tile: lapis night at the top, turquoise water at the bottom end. */
export const TILE_GRADIENT = [
  { offset: 0, color: "#0E1C48" },
  { offset: 0.55, color: "#10456E" },
  { offset: 1, color: "#0A808A" },
] as const;

/** The brand surface (splash, installer, login): the kariz night above the horizon. */
export const SKY_GRADIENT = [
  { offset: 0, color: "#08112D" },
  { offset: 0.5, color: "#0D1E47" },
  { offset: 1, color: "#123A62" },
] as const;

// ------------------------------------------------------------------ the mark (24-unit grid)

export interface MarkGeometry {
  /** the arch: one stroked path, round ends */
  arch: string;
  stroke: number;
  /** the nuqta: a filled rhombus */
  nuqta: string;
  /** the drawing's own box (stroke included) within the 24 grid: x, y, width, height */
  bounds: readonly [number, number, number, number];
}

/** The mark from 32 px up. */
export const MARK: MarkGeometry = {
  arch: "M17.6 19.6V11.4a5.6 5.6 0 0 0-11.2 0v8.2", // from the right foot: it draws in the reading direction
  stroke: 2.8,
  nuqta: "M12 14.1l2.75 2.75L12 19.6l-2.75-2.75z",
  bounds: [5, 4.4, 14, 16.6],
};

/** The optical cut for 24 px and below (favicon, tray, small .ico entries): a heavier arch, a larger nuqta. */
export const MARK_SMALL: MarkGeometry = {
  arch: "M17.9 19.3V11.7a5.9 5.9 0 0 0-11.8 0v7.6",
  stroke: 3.3,
  nuqta: "M12 13.5l3.05 3.05L12 19.6l-3.05-3.05z",
  bounds: [4.45, 4.15, 15.1, 16.8],
};

/** The cut a pixel size should use. */
export const markFor = (px: number): MarkGeometry => (px <= 24 ? MARK_SMALL : MARK);

// ------------------------------------------------------------------ the wordmarks (monoline, baseline y = 18)

export interface WordmarkGeometry {
  text: string;
  dir: "rtl" | "ltr";
  /** stroked paths, round ends and joins */
  strokes: readonly string[];
  stroke: number;
  /** rhombic nuqtas: centre x, centre y, half-diagonal */
  nuqtas: readonly (readonly [number, number, number])[];
  /** x, y, width, height including the stroke */
  bounds: readonly [number, number, number, number];
  baseline: number;
}

const rhombus = (cx: number, cy: number, r: number) => `M${cx} ${+(cy - r).toFixed(3)}l${r} ${r}l${-r} ${r}l${-r} ${-r}z`;

/** «کاریز»: kaf (sarkesh + body into the baseline), alef, re, the initial ye and final ze; three nuqtas. */
export const WORDMARK_FA: WordmarkGeometry = {
  text: BRAND_NAME.fa,
  dir: "rtl",
  strokes: [
    "M55.6 1.4 45.8 5.4l7.4 7.3c1.5 1.5 1.7 3.5.6 4.5-.6.6-1.5.8-2.6.8H40.6",
    "M40.6 18V0.6",
    "M33.6 9.6v7.4c0 4.3-2.6 7.2-7 7.8",
    "M22.6 9.6V15.2c0 1.8-1.1 2.8-2.9 2.8H16.4",
    "M16.4 9.6v7.4c0 4.3-2.6 7.2-7 7.8",
  ],
  stroke: 2.5,
  nuqtas: [
    [16.6, 4.6, 1.75],
    [21.4, 23.4, 1.75],
    [17.4, 23.4, 1.75],
  ],
  bounds: [8.1, -0.7, 48.8, 26.8],
  baseline: 18,
};

/** "kariz": geometric lowercase; the i's dot is the nuqta. */
export const WORDMARK_EN: WordmarkGeometry = {
  text: BRAND_NAME.en,
  dir: "ltr",
  strokes: [
    "M1.25 0.6V18",
    "M8.4 6.4 1.6 13.1",
    "M4.3 10.6 9 18",
    "M22.95 12a5.75 5.75 0 1 1-11.5 0a5.75 5.75 0 1 1 11.5 0",
    "M22.95 6.3V18",
    "M27.6 18V11.6c0-3.3 2.3-5.4 5.6-5.3",
    "M37.1 6.4V18",
    "M41.4 6.4h8.4L41.4 18h8.6",
  ],
  stroke: 2.5,
  nuqtas: [[37.1, 1.9, 1.75]],
  bounds: [0, -0.7, 51.3, 20],
  baseline: 18,
};

// ------------------------------------------------------------------ colours of a drawing

export type BrandTone = "brand" | "brand-dark" | "mono" | "inverse" | "current";

/** What each part is painted with: the arch, the nuqta of the mark, the wordmark's strokes and its nuqtas. */
export function toneColors(tone: BrandTone): { arch: string; nuqta: string; word: string; wordNuqta: string } {
  const c = BRAND_COLORS;
  switch (tone) {
    case "brand": // on paper and light surfaces
      return { arch: c.firuzeh[700], nuqta: c.zaferan[500], word: c.ink, wordNuqta: c.ink };
    case "brand-dark": // on charcoal and dark surfaces
      return { arch: c.firuzeh[400], nuqta: c.zaferan[400], word: c.snow, wordNuqta: c.snow };
    case "mono": // one ink: print, stamps, fax, embossing
      return { arch: c.ink, nuqta: c.ink, word: c.ink, wordNuqta: c.ink };
    case "inverse": // white on the brand surfaces, photographs and the app tile
      return { arch: c.white, nuqta: c.white, word: c.white, wordNuqta: c.white };
    case "current":
      return { arch: "currentColor", nuqta: "currentColor", word: "currentColor", wordNuqta: "currentColor" };
  }
}

// ------------------------------------------------------------------ SVG builders

const f = (n: number) => +n.toFixed(3);

/** The mark's inner SVG (24 grid) with the given colours. */
export function markInner(g: MarkGeometry, arch: string, nuqta: string): string {
  return `<path d="${g.arch}" fill="none" stroke="${arch}" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round"/><path d="${g.nuqta}" fill="${nuqta}"/>`;
}

/** A wordmark's inner SVG (its own coordinates) with the given colours. */
export function wordmarkInner(w: WordmarkGeometry, color: string, nuqtaColor = color): string {
  const strokes = w.strokes.map((d) => `<path d="${d}"/>`).join("");
  const dots = w.nuqtas.map(([x, y, r]) => `<path d="${rhombus(x, y, r)}"/>`).join("");
  return `<g fill="none" stroke="${color}" stroke-width="${w.stroke}" stroke-linecap="round" stroke-linejoin="round">${strokes}</g><g fill="${nuqtaColor}">${dots}</g>`;
}

const svgOpen = (vb: readonly number[], w?: number, h?: number, title?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f).join(" ")}"${w ? ` width="${f(w)}"` : ""}${h ? ` height="${f(h)}"` : ""}${title ? ` role="img" aria-label="${title}"` : ""}>${title ? `<title>${title}</title>` : ""}`;

/** The mark alone, trimmed to its drawing plus `pad` units of clear space. */
export function markSvg({ tone = "brand", px, pad = 0, title }: { tone?: BrandTone; px?: number; pad?: number; title?: string } = {}): string {
  const g = markFor(px ?? 64);
  const t = toneColors(tone);
  const [x, y, w, h] = g.bounds;
  const size = Math.max(w, h) + 2 * pad;
  const vb = [x + w / 2 - size / 2, y + h / 2 - size / 2, size, size];
  return `${svgOpen(vb, px, px, title)}${markInner(g, t.arch, t.nuqta)}</svg>\n`;
}

/** A wordmark alone (its bounds plus `pad`). */
export function wordmarkSvg(lang: "fa" | "en", { tone = "brand", height, pad = 0, title }: { tone?: BrandTone; height?: number; pad?: number; title?: string } = {}): string {
  const w = lang === "fa" ? WORDMARK_FA : WORDMARK_EN;
  const t = toneColors(tone);
  const [x, y, bw, bh] = w.bounds;
  const vb = [x - pad, y - pad, bw + 2 * pad, bh + 2 * pad];
  return `${svgOpen(vb, height ? (height * vb[2]) / vb[3] : undefined, height, title ?? w.text)}${wordmarkInner(w, t.word, t.wordNuqta)}</svg>\n`;
}

export interface LockupPart {
  kind: "mark" | "fa" | "en";
  /** translate and uniform scale applied to the part's own coordinates */
  x: number;
  y: number;
  s: number;
}

/**
 * Lockup layouts in a shared coordinate space (units of the wordmark grid). `horizontal` puts the mark at the start
 * of the reading direction (right of «کاریز», left of "kariz"), baselines aligned and the arch as tall as the alef;
 * `stacked` centres the mark above the Persian name with the Latin one below it.
 */
export function lockupLayout(kind: "horizontal" | "stacked", lang: "fa" | "en"): { parts: LockupPart[]; box: [number, number, number, number] } {
  const m = MARK;
  const mScale = 1.2; // the arch (with its stroke) as tall as the alef and the k's ascender
  const markBottom = (m.bounds[1] + m.bounds[3]) * mScale; // 21.0 × 1.2
  const word = lang === "fa" ? WORDMARK_FA : WORDMARK_EN;
  const baseVisual = word.baseline + word.stroke / 2; // the wordmark's visual baseline (stroke included)
  if (kind === "horizontal") {
    const markW = m.bounds[2] * mScale;
    const gap = 7.2;
    const [wx, , ww] = word.bounds;
    const my = baseVisual - markBottom; // align the arch's feet with the wordmark's baseline
    if (lang === "fa") {
      // RTL: the word, then the mark at its right
      const markX = wx + ww + gap - m.bounds[0] * mScale;
      const parts: LockupPart[] = [
        { kind: "fa", x: 0, y: 0, s: 1 },
        { kind: "mark", x: markX, y: my, s: mScale },
      ];
      const right = wx + ww + gap + markW;
      return { parts, box: [wx, Math.min(word.bounds[1], my + m.bounds[1] * mScale), right - wx, Math.max(word.bounds[1] + word.bounds[3], baseVisual) - Math.min(word.bounds[1], my + m.bounds[1] * mScale)] };
    }
    const markX = -m.bounds[0] * mScale; // mark starts at x = 0
    const wordX = markW + gap - wx;
    const parts: LockupPart[] = [
      { kind: "mark", x: markX, y: my, s: mScale },
      { kind: "en", x: wordX, y: 0, s: 1 },
    ];
    const top = Math.min(word.bounds[1], my + m.bounds[1] * mScale);
    return { parts, box: [0, top, wordX + wx + ww, word.bounds[1] + word.bounds[3] - top] };
  }
  // stacked: mark (scale 2) centred over «کاریز», "kariz" at 0.62 under it
  const ms = 2;
  const fa = WORDMARK_FA;
  const en = WORDMARK_EN;
  const width = fa.bounds[2];
  const cx = fa.bounds[0] + width / 2;
  const markTop = 0;
  const markX = cx - (m.bounds[0] + m.bounds[2] / 2) * ms;
  const markY = markTop - m.bounds[1] * ms;
  const markH = m.bounds[3] * ms;
  const faY = markTop + markH + 7 - fa.bounds[1];
  const es = 0.62;
  const enW = en.bounds[2] * es;
  const enY = faY + fa.bounds[1] + fa.bounds[3] + 4 - en.bounds[1] * es;
  const enX = cx - enW / 2 - en.bounds[0] * es;
  const parts: LockupPart[] = [
    { kind: "mark", x: markX, y: markY, s: ms },
    { kind: "fa", x: 0, y: faY, s: 1 },
    { kind: "en", x: enX, y: enY, s: es },
  ];
  const bottom = enY + (en.bounds[1] + en.bounds[3]) * es;
  return { parts, box: [fa.bounds[0], markTop, width, bottom - markTop] };
}

/** A lockup as SVG, with `pad` units of clear space around it. */
export function lockupSvg(kind: "horizontal" | "stacked", lang: "fa" | "en", { tone = "brand", height, pad = 0, title }: { tone?: BrandTone; height?: number; pad?: number; title?: string } = {}): string {
  const t = toneColors(tone);
  const { parts, box } = lockupLayout(kind, lang);
  const vb = [box[0] - pad, box[1] - pad, box[2] + 2 * pad, box[3] + 2 * pad];
  const body = parts
    .map((p) => {
      const inner = p.kind === "mark" ? markInner(MARK, t.arch, t.nuqta) : wordmarkInner(p.kind === "fa" ? WORDMARK_FA : WORDMARK_EN, t.word, t.wordNuqta);
      return `<g transform="translate(${f(p.x)} ${f(p.y)}) scale(${f(p.s)})">${inner}</g>`;
    })
    .join("");
  const name = title ?? (kind === "stacked" ? `${BRAND_NAME.fa} · ${BRAND_NAME.en}` : lang === "fa" ? BRAND_NAME.fa : BRAND_NAME.en);
  return `${svgOpen(vb, height ? (height * vb[2]) / vb[3] : undefined, height, name)}${body}</svg>\n`;
}

/**
 * The app icon: the mark in white on the lapis-to-turquoise tile (radius 22.5 %), the nuqta lit in saffron.
 * `shape`: "tile" (rounded, transparent corners) or "square" (full bleed: maskable and Apple touch icons, which the
 * platform rounds itself). `inset` shrinks the mark toward the centre (maskable safe zone).
 */
export function appIconSvg({ px, shape = "tile", inset = 1, nuqta = BRAND_COLORS.zaferan[300] }: { px?: number; shape?: "tile" | "square"; inset?: number; nuqta?: string } = {}): string {
  const g = markFor(px ?? 256);
  const stops = TILE_GRADIENT.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("");
  const r = shape === "tile" ? 5.4 : 0;
  // the mark centred in the tile, its optical centre a little above the geometric one
  const [x, y, w, h] = g.bounds;
  const s = (16 / Math.max(w, h)) * inset;
  const tx = 12 - (x + w / 2) * s;
  const ty = 11.75 - (y + h / 2) * s;
  return `${svgOpen([0, 0, 24, 24], px, px, BRAND_NAME.fa)}<defs><linearGradient id="kz-tile" x1="0" y1="0" x2=".42" y2="1">${stops}</linearGradient><radialGradient id="kz-glow" cx=".5" cy="1.05" r=".75"><stop offset="0" stop-color="#2CAFB9" stop-opacity=".45"/><stop offset="1" stop-color="#2CAFB9" stop-opacity="0"/></radialGradient></defs><rect width="24" height="24" rx="${r}" fill="url(#kz-tile)"/><rect width="24" height="24" rx="${r}" fill="url(#kz-glow)"/><g transform="translate(${f(tx)} ${f(ty)}) scale(${f(s)})">${markInner(g, BRAND_COLORS.white, nuqta)}</g></svg>\n`;
}

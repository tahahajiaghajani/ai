// The placeholder mark, the name and the lockup. The product's brand is chosen later: until then the mark is a neutral
// monogram — «IT» built from three bars on a 24-unit grid — and the name is APP_NAME / APP_NAME_EN from
// @shared/constants (never written here). The same drawing is rasterised into every icon by
// desktop/scripts/make-icons.cjs (change both together).
// The mark is one colour: the accent on paper, warm white on charcoal (`variant="color"`, which follows the theme),
// white on the Dusk brand surfaces, ink (`mono` = currentColor) for print.
import type { CSSProperties } from "react";
import { APP_NAME, APP_NAME_EN } from "@shared/constants";

export type MarkVariant = "color" | "mono" | "white";

// the glyph on the 24-unit grid: I, then the T's bar and its stem (x, y, width, height)
const BARS_24: [number, number, number, number][] = [
  [6, 6, 3, 12],
  [11, 6, 7, 3],
  [13, 9, 3, 9],
];
// the pixel cut for exactly 16 px (and 32, 64): every edge on the pixel grid
const BARS_16: [number, number, number, number][] = [
  [3, 3, 2, 10],
  [7, 3, 6, 2],
  [9, 5, 2, 8],
];

const fillOf = (v: MarkVariant) => (v === "white" ? "#FFFFFF" : "currentColor");
const classOf = (v: MarkVariant) => (v === "color" ? "ds-mark-color" : undefined);

interface MarkProps {
  /** Box size in px. 16, 32 and 64 use the pixel cut. */
  size?: number;
  variant?: MarkVariant;
  /** Accessible name; pass "" when the mark sits next to the written name. */
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Animate the three bars setting in one after another (login, the boot screen). */
  launch?: boolean;
}

/** The mark alone: the glyph, filling most of its box. */
export function BrandMark({ size = 24, variant = "color", title = APP_NAME, className, style, launch }: MarkProps) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
  const cls = [classOf(variant), launch ? "ds-launch" : null, className].filter(Boolean).join(" ") || undefined;
  const cut = !launch && (size === 16 || size === 32 || size === 64);
  // the glyph's box plus one unit around it: 14 units of the 24 grid, 12 of the 16 cut
  const viewBox = cut ? "2 2 12 12" : "5 5 14 14";
  return (
    <svg width={size} height={size} viewBox={viewBox} fill={fillOf(variant)} className={cls} style={{ flex: "none", ...style }} shapeRendering={cut ? "crispEdges" : undefined} {...a11y}>
      {(cut ? BARS_16 : BARS_24).map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} className={launch ? "ds-nq" : undefined} />
      ))}
    </svg>
  );
}

export type WordTone = "ink" | "white" | "current";

/** The product's name as text (APP_NAME; APP_NAME_EN with `latin`): a Latin name in Geist, a Persian one in the display face. */
export function Wordmark({ size = 20, tone = "ink", latin, className, style }: { size?: number; tone?: WordTone; latin?: boolean; className?: string; style?: CSSProperties }) {
  const color = tone === "white" ? "#FFFFFF" : tone === "ink" ? "var(--ds-text)" : "currentColor";
  const name = latin ? APP_NAME_EN : APP_NAME;
  if (/^[\x20-\x7e]+$/.test(name)) {
    // Geist 600 at −0.025 em, an LTR isolate
    return (
      <span dir="ltr" className={className} style={{ fontFamily: "var(--ds-font-latin)", fontFeatureSettings: "normal", fontWeight: 600, letterSpacing: "var(--ds-type-brand-tracking)", fontSize: size, lineHeight: 1, color, unicodeBidi: "isolate", whiteSpace: "nowrap", ...style }}>
        {name}
      </span>
    );
  }
  return (
    <span className={className} style={{ fontFamily: "var(--ds-font-display)", fontVariationSettings: '"DSTY" 3', fontWeight: 700, letterSpacing: 0, fontSize: Math.max(16, size), lineHeight: 1, color, whiteSpace: "nowrap", ...style }}>
      {name}
    </span>
  );
}

/**
 * The lockup: the mark at the start, the name beside it, centred on one line. `size` is the name's font size.
 * `compact` shows the mark alone (collapsed rails, tight headers); `latin` gives the Latin lockup (mark on the left).
 * `tone="white"` is for the Dusk gradient and other dark brand surfaces.
 */
export function Logo({ size = 20, tone = "ink", compact, latin, launch, className }: { size?: number; tone?: "ink" | "white"; compact?: boolean; latin?: boolean; launch?: boolean; className?: string }) {
  const markBox = Math.round(size * 1.15);
  const variant: MarkVariant = tone === "white" ? "white" : "color";
  if (compact) return <BrandMark size={markBox} variant={variant} launch={launch} className={className} />;
  return (
    <span
      className={className}
      role="img"
      aria-label={latin ? APP_NAME_EN : APP_NAME}
      dir={latin ? "ltr" : "rtl"}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.max(4, Math.round(size * 0.35)), lineHeight: 1, flex: "none" }}
    >
      <BrandMark size={markBox} variant={variant} title="" launch={launch} />
      <span aria-hidden="true">
        <Wordmark size={size} tone={tone} latin={latin} />
      </span>
    </span>
  );
}

/** The mark in its tile (organisation switcher, About, the home page): the app icon's gradient, the white glyph, radius 23 %. */
export function BrandTile({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{
        display: "inline-grid",
        placeItems: "center",
        inlineSize: size,
        blockSize: size,
        flex: "none",
        borderRadius: Math.round(size * 0.23),
        background: "var(--ds-grad-dusk-tile)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / .14)",
      }}
    >
      <BrandMark size={Math.round(size * 0.66)} variant="white" title="" />
    </span>
  );
}

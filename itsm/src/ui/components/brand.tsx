// Siraf · سیراف — the mark, the wordmark and the lockup (brief §7, final/mark.svg, final/lockup-fa.svg).
// The mark is one colour only: Dusk on paper, warm white on charcoal (both via `variant="color"`, which follows the
// theme), white on the Dusk gradient, ink (`mono` = currentColor) for print. Never gold, outlined, shadowed, rotated,
// recoloured per module or used as a watermark.
import type { CSSProperties } from "react";
import { APP_NAME, APP_NAME_EN } from "@shared/constants";

export type MarkVariant = "color" | "mono" | "white";

// mark A «اندازه»: the measured alef and its three nuqtas, on the 64-unit lattice (clear space 16 units)
const ALEF = "M40 12L48 4V52L40 60Z";
const NUQTAS = ["M24 12L32 20L24 28L16 20Z", "M24 28L32 36L24 44L16 36Z", "M24 44L32 52L24 60L16 52Z"];
// hand-pixelled cuts for exactly 16 px and 24 px (or a whole multiple): every edge on the pixel grid
const CUT_16 = "M11 1h1v1h-1ZM5 2h1v1h-1ZM10 2h2v12h-2ZM4 3h3v1h-3ZM3 4h5v1h-5ZM4 5h3v1h-3ZM5 6h1v1h-1ZM4 7h3v1h-3ZM3 8h5v1h-5ZM4 9h3v1h-3ZM5 10h1v1h-1ZM4 11h3v1h-3ZM3 12h5v1h-5ZM4 13h3v1h-3ZM5 14h1v1h-1ZM10 14h1v1h-1Z";
const CUT_24 = "M17 1h1v1h-1ZM16 2h2v1h-2ZM8 3h1v1h-1ZM15 3h3v17h-3ZM7 4h3v1h-3ZM6 5h5v1h-5ZM5 6h7v1h-7ZM6 7h5v1h-5ZM7 8h3v1h-3ZM8 9h1v1h-1ZM7 10h3v1h-3ZM6 11h5v1h-5ZM5 12h7v1h-7ZM6 13h5v1h-5ZM7 14h3v1h-3ZM8 15h1v1h-1ZM7 16h3v1h-3ZM6 17h5v1h-5ZM5 18h7v1h-7ZM6 19h5v1h-5ZM7 20h3v1h-3ZM15 20h2v1h-2ZM8 21h1v1h-1ZM15 21h1v1h-1Z";

const fillOf = (v: MarkVariant) => (v === "white" ? "#FFFFFF" : "currentColor");
const classOf = (v: MarkVariant) => (v === "color" ? "sf-mark-color" : undefined);

interface MarkProps {
  /** Box size in px (the 64-unit box; the drawing is 56/64 of it). 16 and 24 (and their multiples) use the pixel cuts. */
  size?: number;
  variant?: MarkVariant;
  /** Accessible name; pass "" when the mark sits next to the written name. */
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Animate the three nuqtas setting beside the alef (login and splash only). */
  launch?: boolean;
}

/** The mark alone. */
export function SirafMark({ size = 24, variant = "color", title = APP_NAME, className, style, launch }: MarkProps) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
  const cls = [classOf(variant), launch ? "sf-launch" : null, className].filter(Boolean).join(" ") || undefined;
  const cut = launch ? null : size % 24 === 0 && size <= 48 ? 24 : size % 16 === 0 && size <= 32 ? 16 : null;
  if (cut) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${cut} ${cut}`} fill={fillOf(variant)} className={cls} style={{ flex: "none", ...style }} shapeRendering="crispEdges" {...a11y}>
        <path d={cut === 16 ? CUT_16 : CUT_24} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill={fillOf(variant)} className={cls} style={{ flex: "none", ...style }} {...a11y}>
      <path d={ALEF} />
      {NUQTAS.map((d) => (
        <path key={d} d={d} className={launch ? "sf-nq" : undefined} />
      ))}
    </svg>
  );
}

export type WordTone = "ink" | "white" | "current";

/** «سیراف» set in Arad 760, DSTY 3 (rhombic dots), letter-spacing 0. Arad only at 16 px and above. */
export function Wordmark({ size = 20, tone = "ink", latin, className, style }: { size?: number; tone?: WordTone; latin?: boolean; className?: string; style?: CSSProperties }) {
  const color = tone === "white" ? "#FFFFFF" : tone === "ink" ? "var(--sf-text)" : "currentColor";
  if (latin) {
    // "Siraf" in Geist 600 at −0.025 em, an LTR isolate
    return (
      <span dir="ltr" className={className} style={{ fontFamily: "var(--sf-font-latin)", fontFeatureSettings: "normal", fontWeight: 600, letterSpacing: "var(--sf-type-brand-tracking)", fontSize: size, lineHeight: 1, color, unicodeBidi: "isolate", ...style }}>
        {APP_NAME_EN}
      </span>
    );
  }
  return (
    <span className={className} style={{ fontFamily: "var(--sf-font-display)", fontVariationSettings: '"DSTY" 3', fontWeight: 760, letterSpacing: 0, fontSize: Math.max(16, size), lineHeight: 1, color, whiteSpace: "nowrap", ...style }}>
      {APP_NAME}
    </span>
  );
}

/**
 * The RTL lockup (lockup-fa.svg): the mark at the start (right), the wordmark beside it on a shared baseline.
 * `size` is the wordmark's font size. Proportions from lockup-fa.svg: the mark's 64-unit box is 0.906 em (its 56-unit
 * drawing ≈ the word's alef), 0.057 em from the word (20 units to the drawing), and the drawing's foot sits on the baseline.
 * `compact` shows the mark alone (collapsed rails, tight headers); `latin` gives the Latin lockup (mark on the left).
 * `tone="white"` is for the Dusk gradient and other dark brand surfaces.
 */
export function Logo({ size = 20, tone = "ink", compact, latin, launch, className }: { size?: number; tone?: "ink" | "white"; compact?: boolean; latin?: boolean; launch?: boolean; className?: string }) {
  const markBox = Math.round(size * 0.906);
  const variant: MarkVariant = tone === "white" ? "white" : "color";
  if (compact) return <SirafMark size={markBox} variant={variant} launch={launch} className={className} />;
  return (
    <span
      className={className}
      role="img"
      aria-label={latin ? APP_NAME_EN : APP_NAME}
      dir={latin ? "ltr" : "rtl"}
      style={{ display: "inline-flex", alignItems: "baseline", gap: Math.max(1, Math.round(size * 0.057)), lineHeight: 1, flex: "none" }}
    >
      {/* the drawing's foot (y 60 of 64) sits on the word's baseline */}
      <SirafMark size={markBox} variant={variant} title="" launch={launch} style={{ marginBottom: -Math.round((markBox * 4) / 64), alignSelf: "baseline" }} />
      <span aria-hidden="true">
        <Wordmark size={size} tone={tone} latin={latin} style={latin ? { fontSize: size * 0.92 } : undefined} />
      </span>
    </span>
  );
}

/** The mark in its tile (business switcher, About): the app icon's gradient, the white mark at 64 %, radius 23 %. */
export function SirafTile({ size = 30, className }: { size?: number; className?: string }) {
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
        background: "var(--sf-grad-dusk-tile)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / .14)",
      }}
    >
      <SirafMark size={Math.round(size * 0.66)} variant="white" title="" />
    </span>
  );
}

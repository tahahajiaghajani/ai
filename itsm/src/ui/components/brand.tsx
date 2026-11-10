// The «کاریز» / Kariz mark, wordmarks and lockups (docs/BRAND_FA.md). The drawing lives in @shared/brand (one source
// for these components, the favicons, the Windows icons and installer art — scripts/brand-assets.mts — and the brand
// book); the name comes from @shared/constants. The wordmarks are drawn only while APP_NAME / APP_NAME_EN still spell
// the drawn name; a renamed product falls back to the name set in the UI typefaces.
//
// Colours follow the theme through tokens (--ds-brand-arch, --ds-brand-nuqta, --ds-brand-word): turquoise arch and a
// saffron nuqta on paper, their lighter steps on charcoal. `white` is for the brand surfaces (login, About, the app
// tile): a white arch with the nuqta still lit; `inverse` is all white; `mono` is one ink (currentColor) for print.
import type { CSSProperties, ReactNode } from "react";
import { APP_NAME, APP_NAME_EN } from "@shared/constants";
import { BRAND_NAME, MARK, WORDMARK_EN, WORDMARK_FA, lockupLayout, markFor, type MarkGeometry, type WordmarkGeometry } from "@shared/brand";

export type MarkVariant = "color" | "mono" | "white" | "inverse";

interface Paint {
  arch: string;
  nuqta: string;
  word: string;
}

function paintOf(v: MarkVariant): Paint {
  switch (v) {
    case "color":
      return { arch: "var(--ds-brand-arch)", nuqta: "var(--ds-brand-nuqta)", word: "var(--ds-brand-word)" };
    case "white":
      return { arch: "#FFFFFF", nuqta: "var(--ds-brand-nuqta-on-brand)", word: "#FFFFFF" };
    case "inverse":
      return { arch: "#FFFFFF", nuqta: "#FFFFFF", word: "#FFFFFF" };
    default:
      return { arch: "currentColor", nuqta: "currentColor", word: "currentColor" };
  }
}

/** The arch and the nuqta (24 grid). With `launch` the arch draws itself and the nuqta settles at the outlet. */
function MarkPaths({ g, paint, launch }: { g: MarkGeometry; paint: Paint; launch?: boolean }) {
  return (
    <>
      <path
        d={g.arch}
        fill="none"
        stroke={paint.arch}
        strokeWidth={g.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={launch ? 1 : undefined}
        className={launch ? "ds-arch" : undefined}
      />
      <path d={g.nuqta} fill={paint.nuqta} className={launch ? "ds-nq" : undefined} />
    </>
  );
}

function WordPaths({ w, color }: { w: WordmarkGeometry; color: string }) {
  return (
    <>
      <g fill="none" stroke={color} strokeWidth={w.stroke} strokeLinecap="round" strokeLinejoin="round">
        {w.strokes.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill={color}>
        {w.nuqtas.map(([x, y, r]) => (
          <path key={`${x}-${y}`} d={`M${x} ${y - r}l${r} ${r}l${-r} ${r}l${-r} ${-r}z`} />
        ))}
      </g>
    </>
  );
}

interface MarkProps {
  /** Box size in px. 24 px and below use the heavier small cut. */
  size?: number;
  variant?: MarkVariant;
  /** Accessible name; pass "" when the mark sits next to the written name. */
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Draw the arch and set the nuqta (login, the boot screen, onboarding). Static under reduced motion. */
  launch?: boolean;
}

/** The mark alone: the kariz arch and its nuqta, centred in a square box. */
export function BrandMark({ size = 24, variant = "color", title = APP_NAME, className, style, launch }: MarkProps) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };
  const g = markFor(size);
  const [x, y, w, h] = g.bounds;
  const side = Math.max(w, h) + 1;
  const vb = `${x + w / 2 - side / 2} ${y + h / 2 - side / 2} ${side} ${side}`;
  const cls = [variant === "color" ? "ds-mark-color" : null, launch ? "ds-launch" : null, className].filter(Boolean).join(" ") || undefined;
  return (
    <svg width={size} height={size} viewBox={vb} className={cls} style={{ flex: "none", overflow: "visible", ...style }} {...a11y}>
      <MarkPaths g={g} paint={paintOf(variant)} launch={launch} />
    </svg>
  );
}

export type WordTone = "ink" | "white" | "current";

const drawn = (latin?: boolean) => (latin ? APP_NAME_EN === BRAND_NAME.en : APP_NAME === BRAND_NAME.fa);
/** px per wordmark unit for a given type size: the alef / the k's ascender (18.6 units) is 0.92 × size. */
const unitPx = (size: number) => (size * 0.92) / 18.6;

/** The drawn wordmark at a text size, sitting on the text baseline (descenders hang below it). */
function DrawnWord({ size, color, latin, className, style }: { size: number; color: string; latin?: boolean; className?: string; style?: CSSProperties }) {
  const w = latin ? WORDMARK_EN : WORDMARK_FA;
  const u = unitPx(size);
  const [x, y, bw, bh] = w.bounds;
  const descent = (y + bh - w.baseline) * u;
  return (
    <svg
      viewBox={`${x} ${y} ${bw} ${bh}`}
      width={+(bw * u).toFixed(2)}
      height={+(bh * u).toFixed(2)}
      className={className}
      style={{ flex: "none", verticalAlign: `${-descent.toFixed(2)}px`, overflow: "visible", ...style }}
      aria-hidden="true"
    >
      <WordPaths w={w} color={color} />
    </svg>
  );
}

/** The product's name (APP_NAME; APP_NAME_EN with `latin`): the drawn wordmark, or the name set in type if renamed. */
export function Wordmark({ size = 20, tone = "ink", latin, className, style }: { size?: number; tone?: WordTone; latin?: boolean; className?: string; style?: CSSProperties }) {
  const color = tone === "white" ? "#FFFFFF" : tone === "ink" ? "var(--ds-brand-word)" : "currentColor";
  const name = latin ? APP_NAME_EN : APP_NAME;
  if (drawn(latin)) {
    return (
      <span role="img" aria-label={name} className={className} style={{ display: "inline-flex", lineHeight: 1, ...style }}>
        <DrawnWord size={size} color={color} latin={latin} />
      </span>
    );
  }
  if (/^[\x20-\x7e]+$/.test(name)) {
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
 * The lockup: the mark at the start of the reading direction, the name beside it, baselines aligned and the arch as
 * tall as the alef (docs/brand/logo/kariz-lockup-*.svg). `size` is the name's type size. `compact` shows the mark
 * alone (collapsed rails, tight headers); `latin` gives the Latin lockup (mark on the left).
 * `tone="white"` is for the brand surfaces (login, About).
 */
export function Logo({ size = 20, tone = "ink", compact, latin, launch, className }: { size?: number; tone?: "ink" | "white"; compact?: boolean; latin?: boolean; launch?: boolean; className?: string }) {
  const variant: MarkVariant = tone === "white" ? "white" : "color";
  const label = latin ? APP_NAME_EN : APP_NAME;
  if (compact) return <BrandMark size={Math.round(size * 1.45)} variant={variant} launch={launch} className={className} title={label} />;
  if (!drawn(latin)) {
    // a renamed product: the mark beside the name set in type
    return (
      <span className={className} role="img" aria-label={label} dir={latin ? "ltr" : "rtl"} style={{ display: "inline-flex", alignItems: "center", gap: Math.max(4, Math.round(size * 0.35)), lineHeight: 1, flex: "none" }}>
        <BrandMark size={Math.round(size * 1.3)} variant={variant} title="" launch={launch} />
        <span aria-hidden="true">
          <Wordmark size={size} tone={tone} latin={latin} />
        </span>
      </span>
    );
  }
  const { parts, box } = lockupLayout("horizontal", latin ? "en" : "fa");
  const u = unitPx(size);
  const paint = paintOf(variant);
  return (
    <svg
      viewBox={box.join(" ")}
      width={+(box[2] * u).toFixed(2)}
      height={+(box[3] * u).toFixed(2)}
      role="img"
      aria-label={label}
      className={[launch ? "ds-launch" : null, className].filter(Boolean).join(" ") || undefined}
      style={{ flex: "none", overflow: "visible", display: "inline-block" }}
    >
      {parts.map((p) => (
        <g key={p.kind} transform={`translate(${p.x} ${p.y}) scale(${p.s})`}>
          {p.kind === "mark" ? <MarkPaths g={MARK} paint={paint} launch={launch} /> : <WordPaths w={p.kind === "fa" ? WORDMARK_FA : WORDMARK_EN} color={paint.word} />}
        </g>
      ))}
    </svg>
  );
}

/** The app icon in miniature (organisation switcher, About, the home page): the white mark on the tile gradient. */
export function BrandTile({ size = 30, className, children }: { size?: number; className?: string; children?: ReactNode }) {
  return (
    <span
      className={className}
      style={{
        display: "inline-grid",
        placeItems: "center",
        inlineSize: size,
        blockSize: size,
        flex: "none",
        borderRadius: Math.round(size * 0.225),
        background: "var(--ds-grad-brand-tile)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / .16), inset 0 0 0 1px rgb(255 255 255 / .06)",
      }}
    >
      {children ?? <BrandMark size={Math.round(size * 0.72)} variant="white" title="" style={{ marginBlockStart: -Math.round(size * 0.02) }} />}
    </span>
  );
}

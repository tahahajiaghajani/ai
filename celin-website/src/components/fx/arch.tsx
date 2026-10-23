import type { CSSProperties, ReactNode } from "react";
import type { Media } from "@/lib/media";
import { Picture } from "@/components/ui/picture";
import { Sparkles } from "@/components/fx/sparkles";

/**
 * The CELIN arch: a picture in a plain round arch (Spanish courtyard), optionally with
 * - `ring`: a hairline arch a little outside it (copper on light grounds, champagne on dark),
 * - `keystone`: a small copper diamond at the crown,
 * - `unveil`: the arch fills from the crown down when it enters the viewport,
 * - `parallax`: the picture drifts inside the frame as the page scrolls (CSS scroll timeline),
 * - `sparkle`: live glints on the bright facets of the jewel.
 * The picture keeps its focal point; give `sizes` for the rendered width.
 */
export function Arch({
  media,
  mobile,
  lang = "fa",
  alt,
  sizes = "50vw",
  ratio = "3/4",
  priority,
  ring,
  keystone,
  unveil,
  parallax,
  sparkle,
  delay = 0,
  afterIntro,
  className = "",
  frameClassName = "",
  children,
}: {
  media: Media | null | undefined;
  mobile?: Media | null;
  lang?: "fa" | "en";
  alt?: string;
  sizes?: string;
  ratio?: string;
  priority?: boolean;
  ring?: "copper" | "champagne";
  keystone?: boolean;
  unveil?: boolean;
  parallax?: number;
  sparkle?: boolean | number;
  delay?: number;
  /** wait for the first-visit intro (hero pictures) */
  afterIntro?: boolean;
  className?: string;
  frameClassName?: string;
  children?: ReactNode;
}) {
  const ringColor = ring === "champagne" ? "rgb(228 196 156 / 0.55)" : "rgb(156 94 52 / 0.5)";
  return (
    <div
      className={`relative ${unveil ? "fx-unveil" : ""} ${className}`}
      data-fx={unveil ? (afterIntro ? "now" : "") : undefined}
      style={{ aspectRatio: ratio, "--delay": afterIntro ? `calc(var(--intro-delay, 0s) + ${delay}ms)` : `${delay}ms` } as CSSProperties}
    >
      {ring && <span aria-hidden className="arch-ring" style={{ "--ring": ringColor } as CSSProperties} />}
      {keystone && (
        <svg aria-hidden viewBox="0 0 10 10" className="absolute left-1/2 top-[calc(var(--ring-gap,12px)*-1)] z-[2] size-2.5 -translate-x-1/2 -translate-y-1/2 text-gold-bright">
          <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
        </svg>
      )}
      <div className={`fx-frame arch absolute inset-0 overflow-hidden ${frameClassName}`}>
        <div className={`absolute inset-0 ${parallax ? "fx-parallax" : ""}`} style={parallax ? ({ "--px": parallax } as CSSProperties) : undefined}>
          <Picture media={media} mobile={mobile} lang={lang} alt={alt} sizes={sizes} priority={priority} className="absolute inset-0" />
          {sparkle && <Sparkles count={typeof sparkle === "number" ? sparkle : 12} />}
        </div>
        {children}
      </div>
    </div>
  );
}

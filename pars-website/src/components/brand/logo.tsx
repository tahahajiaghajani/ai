import { MARK_H, MARK_W, RIBBONS, WORDMARK_D } from "@/components/brand/logo-data";

type Palette = "color" | "reverse";

const STOPS: Record<Palette, [string, string, string]> = {
  color: ["#1a183a", "#7b235a", "#df1173"],
  reverse: ["#8f86ff", "#c2479f", "#ff2b8f"],
};

/**
 * The Pars mark, inline. Each ribbon is a separate path so it can move on its own;
 * `animated` exposes CSS hooks (.rb-left / .rb-right, --k = ribbon index).
 */
export function Mark({ palette = "reverse", className, idPrefix = "pm", animated = false, title }: { palette?: Palette; className?: string; idPrefix?: string; animated?: boolean; title?: string }) {
  const [a, b, c] = STOPS[palette];
  return (
    <svg viewBox={`0 0 ${MARK_W} ${MARK_H}`} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`${idPrefix}-l`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="410" y2="0">
          <stop offset="0" stopColor={a} />
          <stop offset=".55" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
        <linearGradient id={`${idPrefix}-r`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={a} />
          <stop offset=".55" stopColor={b} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
      </defs>
      {RIBBONS.map((r, i) => (
        <path
          key={i}
          d={r.d}
          fill={`url(#${idPrefix}-${r.left ? "l" : "r"})`}
          className={animated ? (r.left ? "rb rb-left" : "rb rb-right") : undefined}
          style={animated ? ({ "--k": i } as React.CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}

export function Wordmark({ className, fill = "url(#pw-g)" }: { className?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 1008 99" className={className} aria-hidden>
      <defs>
        <linearGradient id="pw-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff4fa3" />
          <stop offset="1" stopColor="#b8b1ff" />
        </linearGradient>
      </defs>
      <path fill={fill} fillRule="evenodd" d={WORDMARK_D} />
    </svg>
  );
}

/** Header/footer lockup: cached SVG files instead of inline paths (keeps HTML small). */
export function LogoLockup({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/pars-mark-reverse.svg" alt="" width={34} height={36} className="h-9 w-auto" />
      {!compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/pars-wordmark-reverse.svg" alt="Pars Project" width={132} height={13} className="h-[13px] w-auto" />
      )}
    </span>
  );
}

import { MARK_PATH, MARK_STROKE, MARK_VIEWBOX } from "@/components/brand/mark-paths";

/**
 * The personal mark (Hamzad: one stroke, a Latin t and a Persian ط) and the wordmark.
 * currentColor everywhere, so the header can blend and the footer can invert. `.mark-stroke` redraws on a
 * parent's hover (see globals.css).
 */
export function Mark({ className = "", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path className="mark-stroke" d={MARK_PATH} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinecap="butt" strokeLinejoin="miter" pathLength={1} />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`latin inline-flex items-baseline gap-[0.35em] font-medium uppercase tracking-[0.28em] ${className}`} dir="ltr">
      Taha<span className="font-light">Aghajani</span>
    </span>
  );
}

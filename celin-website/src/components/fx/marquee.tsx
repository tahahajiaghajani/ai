import type { CSSProperties } from "react";

/** An endless ribbon of words between small copper diamonds (pauses on hover, still with reduced motion). */
export function Marquee({ items, className = "", seconds = 40, itemClassName = "" }: { items: string[]; className?: string; seconds?: number; itemClassName?: string }) {
  const track = (hidden: boolean) => (
    <div className="fx-marquee-track" aria-hidden={hidden || undefined}>
      {items.map((w, i) => (
        <span key={i} className="flex shrink-0 items-center">
          <span className={`px-6 sm:px-10 ${itemClassName}`}>{w}</span>
          <svg viewBox="0 0 10 10" className="size-2 shrink-0 text-gold-bright" aria-hidden>
            <path d="M5 0 10 5 5 10 0 5Z" fill="currentColor" />
          </svg>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`fx-marquee ${className}`} style={{ "--marquee-s": `${seconds}s` } as CSSProperties}>
      {track(false)}
      {track(true)}
    </div>
  );
}

import type { ReactNode } from "react";

/**
 * A panel shaped as the CELIN arch — a doorway: a round crown, a hairline ring a little outside it with the
 * keystone, a second hairline inside, a sill under it. `tone="night"` fades in an espresso ground (the Pro
 * salon); the change is animated, so a tab can switch it. Put a mark or seal in the crown (`crown`), then the
 * content; keep wide lines below the springline (about half the width down).
 */
export function ArchDoor({ tone = "light", crown, className = "", bodyClassName = "", children }: { tone?: "light" | "night"; crown?: ReactNode; className?: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <div data-door={tone} className={`arch-door ${className}`}>
      <span aria-hidden className="arch-door-night">
        <span className="grain" />
      </span>
      <span aria-hidden className="arch-door-key" />
      <span aria-hidden className="arch-door-sill" />
      <div className={`arch-door-body ${bodyClassName}`}>
        {crown && <div className="arch-door-crown">{crown}</div>}
        {children}
      </div>
    </div>
  );
}

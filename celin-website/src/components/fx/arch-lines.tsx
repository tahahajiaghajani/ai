import type { CSSProperties } from "react";

/**
 * Concentric hairline arches standing on one baseline, like the depth of an arcade; they draw themselves
 * in when they enter the viewport (data-fx). Decorative only. `tone` picks copper (light grounds) or
 * champagne (dark grounds).
 */
export function ArchLines({ count = 4, className = "", tone = "copper", delay = 0, immediate = false }: { count?: number; className?: string; tone?: "copper" | "champagne"; delay?: number; immediate?: boolean }) {
  const W = 200;
  const H = 260;
  const arches = Array.from({ length: count }, (_, i) => {
    const w = 96 + i * ((W - 100) / Math.max(1, count - 1));
    const top = 64 - i * (60 / Math.max(1, count - 1));
    const r = w / 2;
    const x0 = W / 2 - r;
    const x1 = W / 2 + r;
    return `M ${x0} ${H} L ${x0} ${top + r} A ${r} ${r} 0 0 1 ${x1} ${top + r} L ${x1} ${H}`;
  });
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax meet"
      className={`fx-draw pointer-events-none ${className}`}
      data-fx={immediate ? "now" : ""}
      fill="none"
      stroke={tone === "champagne" ? "rgb(228 196 156)" : "rgb(156 94 52)"}
      style={{ "--delay": `${delay}ms` } as CSSProperties}
    >
      {arches.map((d, i) => (
        <path key={i} d={d} pathLength={1} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.5 - i * (0.32 / count)} style={{ "--pd": immediate ? `calc(var(--intro-delay, 0s) + ${delay + i * 160}ms)` : `${delay + i * 160}ms` } as CSSProperties} />
      ))}
    </svg>
  );
}

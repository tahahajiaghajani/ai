/**
 * Small animated diagrams, one per discipline. Pure SVG + CSS (no JS), monochrome, currentColor.
 * They are illustrations: aria-hidden, and still under reduced motion.
 */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, vectorEffect: "non-scaling-stroke" as const };

function Flow({ d, delay = 0, dur = 2.4 }: { d: string; delay?: number; dur?: number }) {
  return (
    <>
      <path d={d} {...S} opacity={0.25} />
      <path d={d} {...S} strokeWidth={1.6} strokeDasharray="6 120" className="glyph-flow" style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }} />
    </>
  );
}

function Node({ x, y, r = 5, label, filled = false }: { x: number; y: number; r?: number; label?: string; filled?: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} {...S} fill={filled ? "currentColor" : "var(--bg)"} />
      {label ? (
        <text x={x} y={y + r + 12} textAnchor="middle" className="fill-current font-mono text-[7px] uppercase tracking-[0.15em] opacity-60">
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function Glyph({ kind }: { kind: string }) {
  switch (kind) {
    case "enterprise":
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={36 + c * 62} y={36 + r * 62} width={44} height={44} rx={2} {...S} opacity={r === 1 && c === 1 ? 1 : 0.45} />),
          )}
          <Flow d="M80 58 H98 M142 58 H160 M80 120 H98 M142 120 H160 M80 182 H98 M142 182 H160" dur={3} />
          <Flow d="M58 80 V98 M120 80 V98 M182 80 V98 M58 142 V160 M120 142 V160 M182 142 V160" delay={0.8} dur={3} />
          <rect x={98} y={98} width={44} height={44} rx={2} fill="currentColor" className="glyph-pulse" />
        </svg>
      );
    case "agents":
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          <Flow d="M40 120 C80 120 80 60 120 60" />
          <Flow d="M40 120 C80 120 80 180 120 180" delay={0.4} />
          <Flow d="M120 60 C160 60 160 120 200 120" delay={1.1} />
          <Flow d="M120 180 C160 180 160 120 200 120" delay={1.5} />
          <Flow d="M120 60 V180" delay={0.7} dur={3} />
          <Node x={40} y={120} label="in" filled />
          <Node x={120} y={60} label="router" />
          <Node x={120} y={180} label="coder" />
          <Node x={200} y={120} label="out" filled />
          <circle cx={120} cy={60} r={11} {...S} opacity={0.4} className="glyph-ping" />
        </svg>
      );
    case "rag":
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(${30 + i * 8} ${40 + i * 10})`} opacity={0.35 + i * 0.15}>
              <rect width={54} height={70} rx={2} {...S} fill="var(--bg)" />
              {[0, 1, 2, 3, 4].map((l) => <line key={l} x1={8} x2={46 - (l % 2) * 12} y1={14 + l * 10} y2={14 + l * 10} {...S} opacity={0.5} />)}
            </g>
          ))}
          <Flow d="M100 110 H140" dur={1.8} />
          {Array.from({ length: 16 }).map((_, i) => (
            <rect key={i} x={146 + (i % 4) * 12} y={86 + Math.floor(i / 4) * 12} width={8} height={8} fill="currentColor" className="glyph-blink" style={{ animationDelay: `${(i * 0.17) % 2}s` }} />
          ))}
          <Flow d="M170 140 V176 H120" delay={0.6} dur={2} />
          <rect x={60} y={166} width={60} height={20} rx={10} {...S} />
          <text x={90} y={179} textAnchor="middle" className="fill-current font-mono text-[7px] uppercase tracking-[0.15em]">answer</text>
        </svg>
      );
    case "vision":
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          {Array.from({ length: 36 }).map((_, i) => (
            <circle key={i} cx={50 + (i % 6) * 28} cy={50 + Math.floor(i / 6) * 28} r={i === 14 || i === 27 ? 6 : 5} {...S} fill={i === 14 || i === 27 ? "currentColor" : "none"} opacity={i === 14 || i === 27 ? 1 : 0.5} />
          ))}
          <rect x={30} y={30} width={180} height={180} {...S} opacity={0.3} />
          <line x1={30} x2={210} y1={30} y2={30} {...S} strokeWidth={1.5} className="glyph-scan" />
          <g className="glyph-blink" style={{ animationDuration: "2.4s" }}>
            <rect x={98} y={66} width={24} height={24} {...S} />
            <rect x={150} y={150} width={24} height={24} {...S} />
          </g>
        </svg>
      );
    case "fullstack":
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          {["ui", "api", "queue", "db"].map((l, i) => (
            <g key={l} transform={`translate(40 ${44 + i * 42})`}>
              <path d="M0 14 L80 0 L160 14 L80 28 Z" {...S} fill="var(--bg)" opacity={1 - i * 0.12} />
              <text x={174} y={18} className="fill-current font-mono text-[7px] uppercase tracking-[0.15em] opacity-60">{l}</text>
            </g>
          ))}
          <Flow d="M120 58 V184" dur={2} />
          <Flow d="M120 184 V58" delay={1} dur={2} />
        </svg>
      );
    case "design":
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          <circle cx={120} cy={120} r={80} {...S} opacity={0.35} />
          <rect x={40} y={40} width={160} height={160} {...S} opacity={0.35} />
          <line x1={40} y1={40} x2={200} y2={200} {...S} opacity={0.25} />
          <line x1={200} y1={40} x2={40} y2={200} {...S} opacity={0.25} />
          <circle cx={120} cy={120} r={49.4} {...S} strokeDasharray="4 6" className="glyph-spin" />
          <path d="M120 40 A80 80 0 0 1 200 120" {...S} strokeWidth={2.4} className="glyph-draw" />
          <text x={120} y={126} textAnchor="middle" className="fill-current font-serif text-[22px] italic">φ</text>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 240 240" aria-hidden className="size-full">
          <g className="glyph-spin" style={{ transformOrigin: "120px 120px", animationDuration: "14s" }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <rect key={i} x={116} y={40} width={8} height={22} {...S} fill="var(--bg)" transform={`rotate(${i * 30} 120 120)`} />
            ))}
            <circle cx={120} cy={120} r={60} {...S} fill="var(--bg)" />
          </g>
          <circle cx={120} cy={120} r={22} {...S} />
          <path d="M60 196 C 90 176 150 176 180 196" {...S} opacity={0.5} />
          <Flow d="M20 210 H220" dur={2.6} />
        </svg>
      );
  }
}

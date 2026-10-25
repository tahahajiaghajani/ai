import type { Diagram as DiagramData, NodeKind } from "@/content/types";
import type { Lang } from "@/lib/i18n";

/**
 * A system diagram from data: nodes on a small grid, edges as curves with packets flowing along them.
 * Laid out left-to-right in both languages (data flow reads like a schematic); labels follow the page language.
 */
const CELL_W = 220;
const CELL_H = 120;
const NODE_W = 172;
const NODE_H = 64;

const KIND_TAG: Record<NodeKind, string> = {
  source: "input",
  process: "step",
  model: "model",
  store: "store",
  output: "output",
  human: "human",
  agent: "agent",
};

export function Diagram({ data, lang }: { data: DiagramData; lang: Lang }) {
  const width = data.cols * CELL_W;
  const height = data.rows * CELL_H;
  const pos = new Map(
    data.nodes.map((n) => {
      const w = NODE_W + ((n.span ?? 1) - 1) * CELL_W;
      const x = n.col * CELL_W + (CELL_W - NODE_W) / 2;
      const y = n.row * CELL_H + (CELL_H - NODE_H) / 2;
      return [n.id, { x, y, w, h: NODE_H }];
    }),
  );

  return (
    <figure className="w-full">
      <div className="overflow-x-auto pb-2 [scrollbar-width:thin]" dir="ltr" data-lenis-prevent-wheel>
        <svg viewBox={`-10 -10 ${width + 20} ${height + 20}`} className="h-auto w-full min-w-[720px] text-fg" role="img" aria-label={data.caption?.[lang] ?? "System diagram"}>
          <defs>
            <marker id="dg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill="currentColor" opacity="0.6" />
            </marker>
          </defs>
          {data.edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            // a long edge between different rows leaves from the node's bottom/top so it doesn't cross its neighbours
            const skip = Math.abs(b.y - a.y) > 1 && Math.abs(b.x - a.x) > CELL_W * 1.5;
            const forward = !skip && b.x >= a.x + a.w - 1;
            const backward = !skip && b.x + b.w <= a.x + 1;
            let x1: number, y1: number, x2: number, y2: number, d: string;
            if (forward || backward) {
              x1 = forward ? a.x + a.w : a.x;
              y1 = a.y + a.h / 2;
              x2 = forward ? b.x : b.x + b.w;
              y2 = b.y + b.h / 2;
              const dx = (x2 - x1) * 0.5;
              d = `M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            } else if (skip) {
              const down = b.y > a.y;
              x1 = a.x + a.w / 2;
              y1 = down ? a.y + a.h : a.y;
              x2 = b.x > a.x ? b.x : b.x + b.w;
              y2 = b.y + b.h / 2;
              d = `M${x1} ${y1} C ${x1} ${y2}, ${x1} ${y2}, ${x2} ${y2}`;
            } else {
              const down = b.y > a.y;
              x1 = a.x + a.w / 2;
              y1 = down ? a.y + a.h : a.y;
              x2 = b.x + b.w / 2;
              y2 = down ? b.y : b.y + b.h;
              const dy = (y2 - y1) * 0.5;
              d = `M${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
            }
            return (
              <g key={i}>
                <path d={d} fill="none" stroke="currentColor" strokeOpacity={0.28} strokeWidth={1.2} strokeDasharray={e.dashed ? "4 5" : undefined} markerEnd="url(#dg-arrow)" />
                <path d={d} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeDasharray="3 160" className="glyph-flow" style={{ animationDelay: `${(i * 0.45) % 2.4}s`, animationDuration: "2.6s" }} />
                {e.label ? (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" className="fill-current font-mono text-[10px] uppercase tracking-[0.12em]" opacity={0.6}>
                    {e.label[lang]}
                  </text>
                ) : null}
              </g>
            );
          })}
          {data.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const strong = n.kind === "model" || n.kind === "agent";
            const out = n.kind === "output";
            return (
              <g key={n.id}>
                {n.kind === "store" ? (
                  <>
                    <path d={`M${p.x} ${p.y + 8} v${p.h - 16} a ${p.w / 2} 8 0 0 0 ${p.w} 0 v${-(p.h - 16)}`} fill="var(--bg)" stroke="currentColor" strokeWidth={1.2} />
                    <ellipse cx={p.x + p.w / 2} cy={p.y + 8} rx={p.w / 2} ry={8} fill="var(--bg)" stroke="currentColor" strokeWidth={1.2} />
                  </>
                ) : (
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.w}
                    height={p.h}
                    rx={n.kind === "human" || out ? p.h / 2 : 3}
                    fill={out ? "currentColor" : "var(--bg)"}
                    stroke="currentColor"
                    strokeWidth={strong ? 2 : 1.2}
                  />
                )}
                {strong ? <rect x={p.x + 4} y={p.y + 4} width={p.w - 8} height={p.h - 8} rx={2} fill="none" stroke="currentColor" strokeOpacity={0.35} /> : null}
                <text x={p.x + p.w / 2} y={p.y + (n.sub ? 28 : 37)} textAnchor="middle" className={`font-sans text-[13px] font-semibold ${out ? "fill-[var(--bg)]" : "fill-current"}`} direction={lang === "fa" ? "rtl" : "ltr"}>
                  {n.label[lang]}
                </text>
                {n.sub ? (
                  <text x={p.x + p.w / 2} y={p.y + 46} textAnchor="middle" className={`font-mono text-[9.5px] ${out ? "fill-[var(--bg)]" : "fill-current"}`} opacity={0.7} direction={lang === "fa" ? "rtl" : "ltr"}>
                    {n.sub[lang]}
                  </text>
                ) : null}
                <text x={p.x + 6} y={p.y - 6} className="fill-current font-mono text-[8.5px] uppercase tracking-[0.18em]" opacity={0.45}>
                  {KIND_TAG[n.kind]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {data.caption ? <figcaption className="mt-4 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-faint">{data.caption[lang]}</figcaption> : null}
    </figure>
  );
}

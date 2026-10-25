import type { ArtKind } from "@/content/types";

/**
 * Generative monochrome covers, deterministic (seeded) so server and client agree. Each kind is a portrait of a
 * system type: a graph of agents, a vision grid, a vibration signal, a flow field, an orbit of systems, a dashboard
 * grid, a typographic study, a 3D wire mesh, a breathing wave.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const W = 800;
const H = 600;
const line = { fill: "none", stroke: "currentColor", vectorEffect: "non-scaling-stroke" as const };

export function Art({ kind, seed = 7, className = "" }: { kind: ArtKind; seed?: number; className?: string }) {
  const r = rng(seed);
  let body: React.ReactNode = null;

  switch (kind) {
    case "graph": {
      const nodes = Array.from({ length: 26 }, () => ({ x: 60 + r() * 680, y: 50 + r() * 500, s: r() }));
      const edges: [number, number][] = [];
      nodes.forEach((a, i) => {
        const near = nodes
          .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
          .filter((n) => n.j !== i)
          .sort((p, q) => p.d - q.d)
          .slice(0, 2);
        near.forEach((n) => i < n.j && edges.push([i, n.j]));
      });
      body = (
        <>
          {edges.map(([a, b], k) => (
            <line key={k} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} {...line} strokeWidth={1} opacity={0.35} />
          ))}
          {edges.slice(0, 14).map(([a, b], k) => (
            <line key={`f${k}`} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} {...line} strokeWidth={2} strokeDasharray="4 140" className="glyph-flow" style={{ animationDelay: `${(k * 0.37) % 3}s`, animationDuration: "3s" }} />
          ))}
          {nodes.map((n, k) => (
            <g key={k}>
              <circle {...(n.s > 0.82 ? {} : line)} cx={n.x} cy={n.y} r={n.s > 0.82 ? 9 : 4} fill={n.s > 0.82 ? "currentColor" : "var(--bg)"} strokeWidth={1.2} />
              {n.s > 0.82 ? <circle cx={n.x} cy={n.y} r={20} {...line} opacity={0.3} /> : null}
            </g>
          ))}
        </>
      );
      break;
    }
    case "vision": {
      const cols = 12;
      const rows = 9;
      body = (
        <>
          {Array.from({ length: cols * rows }, (_, i) => {
            const c = i % cols;
            const rr = Math.floor(i / cols);
            const bad = r() > 0.94;
            return <circle key={i} {...line} cx={95 + c * 56} cy={80 + rr * 56} r={bad ? 9 : 7} fill={bad ? "currentColor" : "none"} strokeWidth={1.2} opacity={bad ? 1 : 0.55} />;
          })}
          <rect x={60} y={50} width={680} height={500} {...line} opacity={0.25} />
          <line x1={60} x2={740} y1={50} y2={50} {...line} strokeWidth={2} className="glyph-scan" style={{ animationDuration: "5s" }} />
          {[0, 1, 2].map((k) => {
            const c = 1 + Math.floor(r() * 10);
            const rr = 1 + Math.floor(r() * 7);
            return (
              <g key={k}>
                <rect x={95 + c * 56 - 20} y={80 + rr * 56 - 20} width={40} height={40} {...line} strokeWidth={1.5} />
                <rect x={95 + c * 56 - 20} y={80 + rr * 56 - 36} width={64} height={14} fill="currentColor" />
              </g>
            );
          })}
        </>
      );
      break;
    }
    case "signal": {
      const pts: string[] = [];
      for (let x = 0; x <= W; x += 4) {
        const t = x / W;
        const spike = Math.abs(x - 520) < 40 ? Math.sin(x * 0.9) * 120 * (1 - Math.abs(x - 520) / 40) : 0;
        const y = 230 + Math.sin(x * 0.11) * 26 + Math.sin(x * 0.37) * 14 * (0.6 + t) + (r() - 0.5) * 18 + spike;
        pts.push(`${x},${y.toFixed(1)}`);
      }
      const rul: string[] = [];
      for (let x = 60; x <= 740; x += 10) rul.push(`${x},${(400 + Math.pow((x - 60) / 680, 2.2) * 150).toFixed(1)}`);
      body = (
        <>
          {Array.from({ length: 9 }, (_, i) => <line key={i} x1={0} x2={W} y1={60 + i * 60} y2={60 + i * 60} {...line} opacity={0.08} />)}
          <polyline points={pts.join(" ")} {...line} strokeWidth={1.3} />
          <rect x={470} y={90} width={100} height={280} {...line} strokeDasharray="4 4" opacity={0.7} />
          <rect x={470} y={70} width={84} height={16} fill="currentColor" />
          <polyline points={rul.join(" ")} {...line} strokeWidth={2.2} strokeDasharray="1200" className="glyph-draw" style={{ strokeDasharray: 1200, animationDuration: "5s" }} />
          <line x1={60} x2={740} y1={550} y2={550} {...line} opacity={0.4} />
        </>
      );
      break;
    }
    case "flow": {
      body = (
        <>
          {Array.from({ length: 22 }, (_, i) => {
            const y0 = 40 + i * 25;
            const a = 40 + r() * 60;
            const d = `M-20 ${y0} C 200 ${y0 - a}, 330 ${y0 + a}, 420 ${y0} S 680 ${y0 - a * 0.6}, 820 ${y0}`;
            return <path key={i} d={d} {...line} strokeWidth={i % 5 === 0 ? 2 : 1} opacity={i % 5 === 0 ? 0.95 : 0.35} />;
          })}
          {Array.from({ length: 6 }, (_, i) => (
            <path key={`k${i}`} d={`M-20 ${140 + i * 70} C 200 ${100 + i * 70}, 330 ${190 + i * 70}, 420 ${140 + i * 70} S 680 ${110 + i * 70}, 820 ${140 + i * 70}`} {...line} strokeWidth={2.5} strokeDasharray="10 220" className="glyph-flow" style={{ animationDuration: `${2.5 + i * 0.3}s` }} />
          ))}
        </>
      );
      break;
    }
    case "orbit": {
      body = (
        <g transform="translate(400 300)">
          {[70, 130, 190, 250].map((rad, i) => (
            <g key={rad} className="glyph-spin" style={{ animationDuration: `${18 + i * 8}s`, animationDirection: i % 2 ? "reverse" : "normal", transformOrigin: "0 0", transformBox: "view-box" }}>
              <circle r={rad} {...line} opacity={0.3} />
              {Array.from({ length: 3 + i }, (_, k) => {
                const a = (k / (3 + i)) * Math.PI * 2 + r();
                return <circle key={k} {...(k === 0 ? {} : line)} cx={Math.cos(a) * rad} cy={Math.sin(a) * rad} r={k === 0 ? 8 : 4.5} fill={k === 0 ? "currentColor" : "var(--bg)"} strokeWidth={1.2} />;
              })}
            </g>
          ))}
          <circle r={26} fill="currentColor" />
        </g>
      );
      break;
    }
    case "grid": {
      const cells = [
        [40, 40, 300, 160], [360, 40, 400, 160], [40, 220, 190, 340], [250, 220, 250, 160], [520, 220, 240, 340], [250, 400, 250, 160],
      ];
      body = (
        <>
          {cells.map(([x, y, w, h], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} {...line} opacity={0.5} />
              {i === 1 ? (
                <polyline points={Array.from({ length: 16 }, (_, k) => `${x + 16 + k * ((w - 32) / 15)},${(y + h - 24 - r() * (h - 60)).toFixed(0)}`).join(" ")} {...line} strokeWidth={1.8} />
              ) : i === 2 ? (
                <g transform={`translate(${x + w / 2} ${y + h / 2})`}>
                  <circle r={62} {...line} strokeWidth={14} opacity={0.18} />
                  <circle r={62} {...line} strokeWidth={14} strokeDasharray={`${290} 400`} transform="rotate(-90)" />
                </g>
              ) : i === 4 ? (
                Array.from({ length: 7 }, (_, k) => <rect key={k} x={x + 20} y={y + 24 + k * 44} width={(w - 40) * (0.25 + r() * 0.75)} height={14} fill="currentColor" opacity={0.25 + k * 0.1} />)
              ) : (
                Array.from({ length: 4 }, (_, k) => <rect key={k} x={x + 18 + k * ((w - 36) / 4)} y={y + h - 20 - (h - 50) * (0.3 + r() * 0.7)} width={(w - 36) / 4 - 10} height={(h - 50) * 0.7} fill="currentColor" opacity={0.35 + k * 0.15} />)
              )}
            </g>
          ))}
        </>
      );
      break;
    }
    case "mesh": {
      const rows = 16;
      const cols = 22;
      const P = (c: number, rr: number) => {
        const x = c / (cols - 1) - 0.5;
        const z = rr / (rows - 1);
        const h = Math.exp(-((x * 3) ** 2) - ((z - 0.55) * 3) ** 2) * 1.3 + Math.sin(c * 0.9 + rr * 0.5) * 0.04;
        const persp = 0.55 + z * 0.75;
        return [400 + x * 900 * persp, 120 + z * 420 - h * 160 * persp] as const;
      };
      body = (
        <>
          {Array.from({ length: rows }, (_, rr) => <polyline key={`r${rr}`} points={Array.from({ length: cols }, (_, c) => P(c, rr).join(",")).join(" ")} {...line} strokeWidth={1} opacity={0.25 + (rr / rows) * 0.75} />)}
          {Array.from({ length: cols }, (_, c) => <polyline key={`c${c}`} points={Array.from({ length: rows }, (_, rr) => P(c, rr).join(",")).join(" ")} {...line} strokeWidth={1} opacity={0.3} />)}
        </>
      );
      break;
    }
    case "wave": {
      body = (
        <>
          {Array.from({ length: 64 }, (_, i) => {
            const x = 40 + i * 11.4;
            const h = (Math.sin(i * 0.28) * 0.5 + 0.6) * (40 + r() * 170);
            return <rect key={i} x={x} y={300 - h / 2} width={4} height={h} rx={2} fill="currentColor" className="glyph-pulse" style={{ animationDelay: `${(i % 16) * 0.12}s`, animationDuration: "3.2s" }} opacity={0.35 + (i % 7) * 0.09} />;
          })}
          <circle cx={400} cy={300} r={220} {...line} opacity={0.15} />
        </>
      );
      break;
    }
    case "type":
    default: {
      body = (
        <>
          {Array.from({ length: 12 }, (_, i) => <line key={i} x1={0} x2={W} y1={50 * i} y2={50 * i} {...line} opacity={0.08} />)}
          {Array.from({ length: 16 }, (_, i) => <line key={`v${i}`} x1={50 * i} x2={50 * i} y1={0} y2={H} {...line} opacity={0.08} />)}
          <text x={400} y={390} textAnchor="middle" className="fill-current font-serif italic" fontSize={330}>Aa</text>
          <circle cx={400} cy={290} r={210} {...line} opacity={0.35} />
          <line x1={150} x2={650} y1={390} y2={390} {...line} opacity={0.6} />
        </>
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={`size-full text-fg ${className}`} aria-hidden>
      <rect width={W} height={H} fill="var(--bg-2)" />
      {body}
    </svg>
  );
}

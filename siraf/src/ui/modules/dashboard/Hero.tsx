// The hero balance (components.md §3.1): «موجودی نقد و بانک» as one light 40 px figure with rolling digits, a delta
// chip, and an area chart whose time runs right to left. Scrubbing (pointer or ←/→/Home/End/Esc on the focused plot)
// snaps to a day and updates the headline instantly; a past day steps the figure down to text-2 and shows the day as
// an accent chip, so a past balance never reads as today's.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Wallet } from "lucide-react";
import { fa, jDayMonth, jLong } from "../../lib/fa";
import { Ic } from "../../components/shell/icons";
import { Delta, Figure, Sk, ratioOf, useWidth } from "./kit";
import type { DayPoint, PeriodSpec } from "./data";

const H = 178; // the whole chart, including the 26 px x-axis band
const AXIS = 26;
const TOP = 10;

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** Monotone cubic (Fritsch–Carlson) through the points, in the order given. */
function smooth(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return "";
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const dl = ys.slice(1).map((y, i) => y - ys[i]);
  const m = ys.map((_, i) => (i === 0 ? dl[0] : i === n - 1 ? dl[n - 2] : dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (dl[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / dl[i];
    const b = m[i + 1] / dl[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * dl[i];
      m[i + 1] = t * b * dl[i];
    }
  }
  let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += `C${(xs[i] + dx).toFixed(1)},${(ys[i] + m[i] / 3).toFixed(1)} ${(xs[i + 1] - dx).toFixed(1)},${(ys[i + 1] - m[i + 1] / 3).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return d;
}

export function Hero({
  total,
  series,
  spec,
  compare,
  unit,
}: {
  total: number | null;
  series: { current: DayPoint[]; previous: DayPoint[] } | null | undefined;
  spec: PeriodSpec;
  compare: boolean;
  unit: string;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const cur = series?.current ?? [];
  const prev = series?.previous ?? [];
  const n = cur.length;
  const showCompare = compare && spec.key !== "today" && prev.length === n && n > 0;

  // the headline: today, or the scrubbed day
  const i = scrub ?? n - 1;
  const value = n ? cur[i].v : total;
  // nothing has moved yet: no figure to roll and no line to draw
  const blank = value !== null && value === 0 && cur.every((p) => p.v === 0);
  // delta: the period's length back (yesterday for «امروز»); while scrubbing, the same day of the previous window
  let before: number | null = null;
  if (n) {
    if (scrub !== null) before = showCompare ? prev[i].v : i > 0 ? cur[i - 1].v : null;
    else if (spec.key === "today") before = n > 1 ? cur[n - 2].v : null;
    else if (spec.days < n) before = cur[n - 1 - spec.days].v;
    else if (spec.days === n && prev.length === n) before = prev[n - 1].v;
  }
  const ratio = value !== null && before !== null ? ratioOf(value, before) : null;
  const vs = scrub !== null ? (showCompare ? "نسبت به همان روزِ دورهٔ پیش" : "نسبت به روز قبل") : spec.vs;

  return (
    <section className="db-card db-hero" aria-label="موجودی نقد و بانک">
      <div className="db-hero-top">
        <span className="db-hero-label">موجودی نقد و بانک</span>
        {n && !blank ? (
          <span className="db-legend">
            <span>
              <i className="key-line" />
              {spec.key === "today" || spec.key === "week" ? "۷ روز اخیر" : spec.phrase}
            </span>
            {showCompare ? (
              <span>
                <i className="key-dash" />
                دورهٔ پیش از آن
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {value === null ? (
        <div className="db-hero-fig" aria-busy="true">
          <Sk w={300} h={34} r={8} />
        </div>
      ) : (
        <div aria-live="polite">
          {blank ? (
            <div className="db-hero-fig is-muted">
              <span className="db-fig-n db-zero">—</span>
            </div>
          ) : scrub !== null ? (
            <div className="db-hero-fig is-muted">
              <span className="db-fig-n">{fa(Math.round(value))}</span>
              <span className="db-unit">{unit}</span>
            </div>
          ) : (
            <Figure size="hero" id="hero" text={fa(Math.round(value))} unit={unit} />
          )}
        </div>
      )}
      <div className="db-hero-sub">
        {scrub !== null ? <span className="db-chip accent">{jLong(dateOf(cur[i].date)).replace(/\s[۰-۹]{4}$/, "")}</span> : <span>امروز</span>}
        {ratio !== null ? (
          <>
            <Delta ratio={ratio} />
            <span className="db-vs">{vs}</span>
          </>
        ) : null}
      </div>
      {series === null ? (
        <div className="db-chart-sk" aria-busy="true">
          <Sk h={Math.round((H - AXIS) * 0.4)} r={6} />
        </div>
      ) : blank ? (
        <div className="db-hero-empty">
          <Ic icon={Wallet} size={20} />
          <span>با ثبت دریافت و پرداخت، روند موجودی صندوق و بانک اینجا می‌آید.</span>
        </div>
      ) : n > 1 ? (
        <Plot cur={cur} prev={showCompare ? prev : null} scrub={scrub} setScrub={setScrub} redrawKey={spec.key} />
      ) : null}
    </section>
  );
}

function Plot({
  cur,
  prev,
  scrub,
  setScrub,
  redrawKey,
}: {
  cur: DayPoint[];
  prev: DayPoint[] | null;
  scrub: number | null;
  setScrub: (i: number | null) => void;
  redrawKey: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const svgRef = useRef<SVGSVGElement>(null);
  const n = cur.length;
  const base = H - AXIS;
  const geo = useMemo(() => {
    const vals = cur.map((p) => p.v).concat(prev ? prev.map((p) => p.v) : []);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) {
      hi += Math.abs(hi) * 0.05 || 1;
      lo -= Math.abs(lo) * 0.05 || 1;
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad * 0.6;
    const step = (W - 8) / (n - 1);
    // time runs right to left: the oldest day at the right edge, today at the left
    const xs = cur.map((_, i) => W - 4 - i * step);
    const y = (v: number) => TOP + (1 - (v - lo) / (hi - lo)) * (base - TOP - 4);
    const yc = cur.map((p) => y(p.v));
    const yp = prev ? prev.map((p) => y(p.v)) : null;
    const line = smooth(xs, yc);
    const area = `${line}L${xs[n - 1].toFixed(1)},${base}L${xs[0].toFixed(1)},${base}Z`;
    const cmp = yp ? smooth(xs, yp) : null;
    const tickCount = n <= 8 && W >= 420 ? n : W < 420 ? 3 : 5;
    const ticks = Array.from({ length: tickCount }, (_, k) => Math.round((k * (n - 1)) / (tickCount - 1)));
    return { xs, yc, yp, line, area, cmp, ticks, step };
  }, [cur, prev, W, n, base]);

  const pick = (e: PointerEvent<SVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const i = Math.round((W - 4 - x) / geo.step);
    setScrub(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const at = scrub ?? n - 1;
    // RTL: ← goes later in time (towards today, at the left), → earlier
    if (e.key === "ArrowLeft") setScrub(Math.min(n - 1, at + 1));
    else if (e.key === "ArrowRight") setScrub(Math.max(0, at - 1));
    else if (e.key === "Home") setScrub(0);
    else if (e.key === "End") setScrub(n - 1);
    else if (e.key === "Escape") setScrub(null);
    else return;
    e.preventDefault();
  };
  const sx = scrub !== null ? geo.xs[scrub] : null;
  const first = cur[0].v;
  const last = cur[n - 1].v;
  const summary = `روند موجودی نقد و بانک از ${jDayMonth(dateOf(cur[0].date))} تا امروز: از ${fa(Math.round(first))} به ${fa(Math.round(last))}`;

  return (
    <div ref={ref} className="db-chart">
      <svg
        ref={svgRef}
        key={redrawKey}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="db-plot"
        role="img"
        aria-label={summary}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setScrub(null)}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setScrub(null)}
      >
        <defs>
          <linearGradient id="db-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="db-area-top" />
            <stop offset="1" className="db-area-bottom" />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} className="db-baseline" />
        <path d={geo.area} fill="url(#db-area)" className="db-area" />
        {geo.cmp ? <path d={geo.cmp} className="db-cmp" /> : null}
        <path d={geo.line} className="db-line" pathLength={1} />
        {sx !== null ? (
          <g>
            <line x1={sx} x2={sx} y1={0} y2={base} className="db-xh" />
            {geo.yp ? <circle cx={sx} cy={geo.yp[scrub!]} r={4} className="db-pt-cmp" /> : null}
            <circle cx={sx} cy={geo.yc[scrub!]} r={4.5} className="db-pt" />
          </g>
        ) : (
          <circle cx={geo.xs[n - 1]} cy={geo.yc[n - 1]} r={4.5} className="db-pt db-end" />
        )}
        <g className="db-xlabs" direction="rtl">
          {geo.ticks.map((t, k) => {
            if (sx !== null && Math.abs(geo.xs[t] - sx) < 46) return null;
            // RTL text: "start" is the right edge (the oldest day), "end" the left (today)
            const anchor = k === 0 ? "start" : k === geo.ticks.length - 1 ? "end" : "middle";
            const x = k === 0 ? W : k === geo.ticks.length - 1 ? 0 : geo.xs[t];
            return (
              <text key={t} x={x} y={H - 6} textAnchor={anchor} className="db-xlab">
                {t === n - 1 ? "امروز" : jDayMonth(dateOf(cur[t].date))}
              </text>
            );
          })}
          {sx !== null ? (
            <text x={Math.min(W - 30, Math.max(30, sx))} y={H - 6} textAnchor="middle" className="db-xlab on">
              {scrub === n - 1 ? "امروز" : jDayMonth(dateOf(cur[scrub!].date))}
            </text>
          ) : null}
        </g>
      </svg>
    </div>
  );
}

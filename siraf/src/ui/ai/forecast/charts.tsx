// Charts of «پیش‌بینی و برنامه‌ریزی» (recharts, Siraf chart tokens): the fan chart (history, median and the p10–p90
// band opening from the last actual value) and the 13-week cash chart (inflow and outflow bars, the closing balance
// line with its band, shortfall weeks shaded). RTL: time runs right to left (reversed X axis, Y axis on the right).
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fa } from "../../lib/fa";
import { scaled, type Scale } from "../../modules/dashboard/kit";
import type { FanRow } from "./data";

const AXIS_TICK = { fontSize: 12, fill: "var(--sf-text-3)" } as const;

function yTick(s: Scale) {
  return (v: number) => (v === 0 ? fa(0) : fa(v / s.div, Math.abs(v / s.div) < 10 && v % s.div ? 1 : 0));
}

type TipProps<T> = { active?: boolean; payload?: { payload: T }[]; s: Scale; label?: (r: T) => string };

function FanTip({ active, payload, s, label }: TipProps<FanRow>) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="ai-tip-card">
      <div>{label ? label(r) : r.period}</div>
      {r.actual !== null ? (
        <div>
          واقعی <b>{scaled(r.actual, s)}</b>
        </div>
      ) : null}
      {r.band && r.actual === null ? (
        <>
          <div>
            پیش‌بینی میانه <b>{scaled(r.p50, s)}</b>
          </div>
          <div>
            بازهٔ ۸۰٪ {scaled(r.band[0], s)} تا {scaled(r.band[1], s)}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** History (ink line), median forecast (dashed Dusk) and the p10–p90 band (Dusk tint). */
export function FanChart({ rows, s, label, height = 280, aria }: { rows: FanRow[]; s: Scale; label: (period: string) => string; height?: number; aria: string }) {
  const firstForecast = rows.findIndex((r) => r.actual === null);
  return (
    <div className="ai-fc-chart" style={{ blockSize: height }} role="img" aria-label={aria}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 0, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--sf-chart-grid)" />
          <XAxis dataKey="period" reversed tickLine={false} axisLine={{ stroke: "var(--sf-chart-axis)" }} tick={AXIS_TICK} tickFormatter={label} minTickGap={20} />
          <YAxis orientation="right" tickCount={4} width={48} axisLine={false} tickLine={false} tickMargin={8} tick={{ ...AXIS_TICK, textAnchor: "start" }} tickFormatter={yTick(s)} />
          <Tooltip cursor={{ stroke: "var(--sf-chart-crosshair)" }} content={<FanTip s={s} label={(r) => label(r.period)} />} isAnimationActive={false} />
          {firstForecast > 0 ? <ReferenceLine x={rows[firstForecast - 1].period} stroke="var(--sf-chart-axis)" strokeDasharray="2 3" /> : null}
          <Area dataKey="band" stroke="none" fill="var(--sf-accent-line)" fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="actual" stroke="var(--sf-text-2)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line dataKey="p50" stroke="var(--sf-accent-line)" strokeWidth={1.75} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface CashRow {
  week: string;
  inflow: number;
  outflow: number;
  closing: number;
  band: [number, number] | null;
  shortfall: boolean;
  title: string;
}

function CashTip({ active, payload, s }: TipProps<CashRow>) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="ai-tip-card">
      <div>{r.title}</div>
      <div>
        ورودی <b>{scaled(r.inflow, s)}</b>
      </div>
      <div>
        خروجی <b>{scaled(r.outflow, s)}</b>
      </div>
      <div>
        ماندهٔ پایان هفته <b className={r.closing < 0 ? "text-danger" : undefined}>{scaled(r.closing, s)}</b>
      </div>
      {r.band ? (
        <div>
          بازهٔ ۸۰٪ {scaled(r.band[0], s)} تا {scaled(r.band[1], s)}
        </div>
      ) : null}
    </div>
  );
}

/** Inflow (Dusk) and outflow (quiet) bars per week, the closing balance as an ink line with its band; shortfall weeks shaded. */
export function CashChart({ rows, s, aria }: { rows: CashRow[]; s: Scale; aria: string }) {
  const data = rows.map((r) => ({ ...r, out: -r.outflow }));
  return (
    <div className="ai-fc-chart" style={{ blockSize: 300 }} role="img" aria-label={aria}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barGap={2} barCategoryGap="24%" stackOffset="sign">
          <CartesianGrid vertical={false} stroke="var(--sf-chart-grid)" />
          {rows.map((r) => (r.shortfall ? <ReferenceArea key={r.week} x1={r.week} x2={r.week} fill="var(--sf-danger)" fillOpacity={0.07} ifOverflow="extendDomain" /> : null))}
          <XAxis dataKey="week" reversed tickLine={false} axisLine={{ stroke: "var(--sf-chart-axis)" }} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={12} />
          <YAxis orientation="right" tickCount={5} width={48} axisLine={false} tickLine={false} tickMargin={8} tick={{ ...AXIS_TICK, textAnchor: "start" }} tickFormatter={yTick(s)} />
          <Tooltip cursor={{ fill: "var(--sf-hover)" }} content={<CashTip s={s} />} isAnimationActive={false} />
          <ReferenceLine y={0} stroke="var(--sf-chart-axis)" />
          <Bar dataKey="inflow" stackId="flow" fill="var(--sf-accent-line)" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Bar dataKey="out" stackId="flow" fill="var(--sf-chart-other)" radius={[0, 0, 3, 3]} maxBarSize={18} isAnimationActive={false} />
          <Area dataKey="band" stroke="none" fill="var(--sf-text)" fillOpacity={0.06} isAnimationActive={false} />
          <Line dataKey="closing" stroke="var(--sf-text)" strokeWidth={1.75} dot={{ r: 2.5, fill: "var(--sf-surface)", strokeWidth: 1.5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

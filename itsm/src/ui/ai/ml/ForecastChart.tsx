// A volume forecast drawn (catalogue AI-116, ANA-027): the last weeks as counted, the forecast's median line and its
// 80% band, official holidays marked on the axis and unusual days as anomaly dots; a table is the text alternative.
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { faDigits } from "@shared/format";
import type { ForecastView } from "@shared/ai/ml";
import { forecastRows, type ForecastRow } from "./model";

const TICK = { fontSize: 12, fill: "var(--ds-text-3)" };

function Tip({ active, payload }: { active?: boolean; payload?: { payload: ForecastRow }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="ml-tip">
      <div>
        {r.label}
        {r.holiday ? " · تعطیل" : ""}
      </div>
      {r.actual !== null ? <div>ثبت‌شده: <span className="ds-num">{faDigits(r.actual)}</span></div> : null}
      {r.band ? (
        <div>
          پیش‌بینی: <span className="ds-num">{faDigits(Math.round(r.p50 ?? 0))}</span> (بین <span className="ds-num">{faDigits(Math.round(r.band[0]))}</span> و{" "}
          <span className="ds-num">{faDigits(Math.round(r.band[1]))}</span>)
        </div>
      ) : null}
      {r.anomaly ? <div className="ml-risk-high">روز غیرعادی</div> : null}
    </div>
  );
}

export function ForecastChart({ f, height = 300 }: { f: Pick<ForecastView, "history" | "points" | "anomalies" | "grain">; height?: number }) {
  const rows = forecastRows(f);
  const anomalies = rows.filter((r) => r.anomaly).map((r) => ({ ...r, dot: r.actual }));
  return (
    <figure className="ml-chart" aria-label="نمودار پیش‌بینی حجم کار">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
          <XAxis dataKey="label" reversed tick={TICK} interval="preserveStartEnd" minTickGap={24} stroke="var(--ds-chart-axis)" />
          <YAxis orientation="right" tick={TICK} tickFormatter={(v: number) => faDigits(v)} width={40} stroke="var(--ds-chart-axis)" allowDecimals={false} />
          <Tooltip content={<Tip />} />
          <Area dataKey="band" stroke="none" fill="var(--ds-chart-1)" fillOpacity={0.14} isAnimationActive={false} name="بازهٔ ۸۰٪" />
          <Line dataKey="actual" stroke="var(--ds-chart-3)" strokeWidth={2} dot={false} isAnimationActive={false} name="ثبت‌شده" connectNulls={false} />
          <Line dataKey="p50" stroke="var(--ds-chart-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} name="پیش‌بینی" connectNulls />
          <Scatter data={anomalies} dataKey="dot" fill="var(--ds-danger)" isAnimationActive={false} name="غیرعادی" />
        </ComposedChart>
      </ResponsiveContainer>
      <figcaption className="ml-legend">
        <span className="ml-key is-actual">ثبت‌شده</span>
        <span className="ml-key is-forecast">پیش‌بینی</span>
        <span className="ml-key is-band">بازهٔ ۸۰٪</span>
        {anomalies.length ? <span className="ml-key is-anomaly">روز غیرعادی</span> : null}
      </figcaption>
    </figure>
  );
}

// One component draws any report result (catalogue ANA-009/011/053): column, horizontal bar, line, area (stacked or
// 100 %), pie, donut, funnel, Pareto, heatmap, single score with the change against the previous period, gauge
// against a target, summary table, pivot, record list and grouped list. Right to left: categories start on the right,
// the value axis sits on the start side, horizontal bars grow from the right. Colours are the design system's chart
// tokens in fixed order (light and dark variants come with the theme), «سایر» is neutral, values are formatted per
// unit with Persian digits, every chart has a text alternative (the table view) and a click on an element drills down
// or opens its records.
import { useMemo, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Funnel, FunnelChart, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownLeft, ArrowUpLeft, Minus } from "lucide-react";
import { formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { VIZ } from "@shared/analytics/model";
import type { KeyValue, ReportResult, ReportSpec, ScorePoint } from "@shared/analytics/types";
import { deltaPct } from "@shared/analytics/kpi";
import { EmptyState } from "../../components/display";
import { cx } from "../../components/blocks";
import { FieldValue, RecordNo } from "../../records";
import { recordPath } from "../../records";
import type { Schema } from "../../records/model/schema";
import { Link } from "react-router";
import { axisValue, chartData, deltaTone, exactValue, gaugeShare, arcPoint, heatFill, heatInk, matrix, cellKey, paretoData, OTHER_COLOR, seriesColor, type ChartData } from "./model";

const AXIS_TICK = { fontSize: 12, fill: "var(--ds-text-3)" };
const GRID = "var(--ds-chart-grid)";
const AXIS = { stroke: "var(--ds-chart-axis)" };

export interface ResultViewProps {
  spec: ReportSpec;
  result: ReportResult;
  /** pixels (charts fill their box when omitted) */
  height?: number;
  /** a click on an element (its keys, one per dimension) */
  onElement?: (keys: KeyValue[]) => void;
  /** the data as a table instead of the chart (the text alternative) */
  asTable?: boolean;
  schema?: Schema;
  /** a widget on a dashboard: fewer axis labels */
  compact?: boolean;
}

/** The result as its visualization (or as a table). */
export function ResultView(p: ResultViewProps) {
  const { spec, result: r } = p;
  if (r.kind === "list") return spec.viz === "grouped" ? <GroupedList {...p} /> : <RecordsTable {...p} />;
  if (!r.rows.length && r.dims.length) return <EmptyState compact title="داده‌ای برای نمایش نیست" description="در این بازه رکوردی که شما اجازهٔ دیدنش را دارید پیدا نشد" />;
  if (p.asTable) return <SummaryTable {...p} />;
  switch (spec.viz) {
    case "score":
      return <ScoreTile {...p} />;
    case "gauge":
      return <Gauge {...p} />;
    case "table":
      return <SummaryTable {...p} />;
    case "pivot":
      return <PivotTable {...p} />;
    case "heatmap":
      return <Heatmap {...p} />;
    case "pie":
    case "donut":
      return <PieView {...p} />;
    case "funnel":
      return <FunnelView {...p} />;
    case "pareto":
      return <ParetoView {...p} />;
    default:
      return <Cartesian {...p} />;
  }
}

/** The chart's summary for screen readers. */
function ariaOf(r: ReportResult, spec: ReportSpec): string {
  const m = r.measures[0];
  return `${VIZ[spec.viz].label}: ${m?.label ?? ""} در «${r.table_label}»${r.dims.length ? ` به تفکیک ${r.dims.map((d) => d.label).join(" و ")}` : ""}، ${faDigits(r.rows.length)} گروه`;
}

function Box({ height, children, label }: { height?: number; children: ReactNode; label: string }) {
  return (
    <div className="an-chart" style={height ? { height } : undefined} role="img" aria-label={label}>
      {children}
    </div>
  );
}

function tooltipFor(data: ChartData) {
  return (v: unknown, name: unknown) => {
    const s = data.series.find((x) => x.key === name || x.label === name);
    return [exactValue(v as number, s?.unit ?? data.unit), s?.label ?? String(name)] as [string, string];
  };
}

// ----- column / bar / line / area --------------------------------------------------------------------------------------

function Cartesian({ spec, result: r, height, onElement, compact }: ResultViewProps) {
  // the previous period on the same axis (by position: the n-th bucket of each window), dashed; new row objects — the
  // chart library freezes the data it is given
  const m0 = r.measures[0];
  const prevKey = r.previous && r.dims.length === 1 && m0 && r.previous.rows.length ? "_prev" : null;
  const data = useMemo(() => {
    const d = chartData(r);
    if (!prevKey || !m0) return d;
    const rows: Record<string, unknown>[] = d.rows.map((row, i) => ({ ...row, [prevKey]: r.previous!.rows[i]?.values[m0.key] ?? null }));
    return { ...d, rows };
  }, [r, prevKey, m0]);
  const horizontal = spec.viz === "bar";
  const stacked = !!spec.options?.stacked || !!spec.options?.percent;
  const percent = !!spec.options?.percent;
  const labels = !!spec.options?.labels;
  const twoDims = r.dims.length === 2;
  const click = (row: Record<string, unknown>, seriesKey?: string) => {
    if (!onElement) return;
    const k0 = (twoDims ? row._key0 : r.rows[Number(row._i)]?.keys[0]) as KeyValue;
    if (twoDims && seriesKey && seriesKey !== "s_other") {
      const label = data.series.find((s) => s.key === seriesKey)?.label;
      const hit = r.rows.find((x) => x.keys[0] === k0 && x.labels[1] === label);
      onElement(hit ? hit.keys : [k0]);
    } else onElement([k0]);
  };
  const fmtAxis = (v: number) => (percent ? `${faDigits(Math.round(v * 100))}٪` : axisValue(v, data.unit));
  const legend = data.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} /> : null;
  const tip = <Tooltip cursor={{ fill: "var(--ds-hover)" }} formatter={tooltipFor(data)} labelFormatter={(l) => String(l)} isAnimationActive={false} />;
  const common = { data: data.rows, margin: { top: 8, right: 4, left: 4, bottom: 0 }, stackOffset: percent ? ("expand" as const) : undefined };
  const catAxis = horizontal ? (
    <YAxis type="category" dataKey="label" orientation="right" width={compact ? 90 : 130} tickLine={false} axisLine={AXIS} tick={AXIS_TICK} interval={0} />
  ) : (
    <XAxis dataKey="label" reversed tickLine={false} axisLine={AXIS} tick={AXIS_TICK} minTickGap={compact ? 12 : 6} interval="preserveStartEnd" />
  );
  const valAxis = horizontal ? (
    <XAxis type="number" reversed tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={fmtAxis} tickCount={4} />
  ) : (
    <YAxis orientation="right" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={fmtAxis} width={48} tickCount={4} allowDecimals={data.unit !== "count"} />
  );
  const aria = ariaOf(r, spec);
  if (spec.viz === "line" || spec.viz === "area") {
    const Chart = spec.viz === "line" ? LineChart : AreaChart;
    return (
      <Box height={height} label={aria}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart {...common} onClick={(e: unknown) => {
            const i = (e as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
            if (typeof i === "number" && data.rows[i]) click(data.rows[i]);
          }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            {catAxis}
            {valAxis}
            {tip}
            {legend}
            {data.series.map((s, i) =>
              spec.viz === "line" ? (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={i === 0 ? 2 : 1.5} dot={data.rows.length <= 31} connectNulls isAnimationActive={false} />
              ) : (
                <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.16} stackId={stacked ? "a" : undefined} connectNulls isAnimationActive={false} />
              ),
            )}
            {prevKey ? <Line dataKey={prevKey} name="دورهٔ پیش" stroke="var(--ds-chart-compare)" strokeDasharray="4 3" strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} /> : null}
          </Chart>
        </ResponsiveContainer>
      </Box>
    );
  }
  return (
    <Box height={height} label={aria}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...common} layout={horizontal ? "vertical" : "horizontal"} barCategoryGap="22%">
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke={GRID} />
          {catAxis}
          {valAxis}
          {tip}
          {legend}
          {data.series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={stacked ? "a" : undefined}
              maxBarSize={horizontal ? 22 : 36}
              radius={stacked ? 0 : horizontal ? [4, 0, 0, 4] : [4, 4, 0, 0]}
              isAnimationActive={false}
              cursor={onElement ? "pointer" : undefined}
              onClick={(d: unknown) => click(((d as { payload?: Record<string, unknown> })?.payload ?? d) as Record<string, unknown>, s.key)}
            >
              {data.series.length === 1
                ? data.rows.map((row) => <Cell key={String(row._key)} fill={row._other ? OTHER_COLOR : seriesColor(i)} />)
                : null}
              {labels ? <LabelList dataKey={s.key} position={horizontal ? "insideLeft" : "top"} formatter={(v: unknown) => axisValue(Number(v ?? 0), s.unit)} style={{ fontSize: 11, fill: "var(--ds-text-2)" }} /> : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

// ----- pareto ----------------------------------------------------------------------------------------------------------

function ParetoView({ spec, result: r, height, onElement }: ResultViewProps) {
  const rows = useMemo(() => paretoData(r), [r]);
  const unit = r.measures[0]?.unit ?? "count";
  return (
    <Box height={height} label={`${ariaOf(r, spec)}، با درصد تجمعی`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" reversed tickLine={false} axisLine={AXIS} tick={AXIS_TICK} interval="preserveStartEnd" />
          <YAxis yAxisId="v" orientation="right" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => axisValue(v, unit)} width={48} />
          <YAxis yAxisId="c" orientation="left" domain={[0, 100]} tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => `${faDigits(v)}٪`} width={40} />
          <Tooltip formatter={(v, name) => (name === "cum" ? [`${faDigits(Number(v))}٪`, "درصد تجمعی"] : [exactValue(Number(v), unit), r.measures[0]?.label ?? ""])} isAnimationActive={false} />
          <Bar yAxisId="v" dataKey="value" fill="var(--ds-chart-1)" maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false} cursor={onElement ? "pointer" : undefined} onClick={(d: unknown) => {
            const row = ((d as { payload?: { row?: { keys: KeyValue[] } } })?.payload ?? d) as { row?: { keys: KeyValue[]; other?: boolean } };
            if (onElement && row.row && !row.row.other) onElement(row.row.keys);
          }}>
            {rows.map((x) => <Cell key={x.label} fill={x.row.other ? OTHER_COLOR : "var(--ds-chart-1)"} />)}
          </Bar>
          <Line yAxisId="c" dataKey="cum" stroke="var(--ds-chart-4)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}

// ----- pie / donut / funnel --------------------------------------------------------------------------------------------

function PieView({ spec, result: r, height, onElement }: ResultViewProps) {
  const m = r.measures[0];
  const rows = r.rows.filter((x) => !x.suppressed).map((x, i) => ({ name: x.labels[0] ?? "", value: Math.max(0, x.values[m?.key ?? ""] ?? 0), keys: x.keys, color: x.other ? OTHER_COLOR : seriesColor(i) }));
  const total = rows.reduce((s, x) => s + x.value, 0);
  const donut = spec.viz === "donut";
  return (
    <Box height={height} label={ariaOf(r, spec)}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip formatter={(v, name) => [`${exactValue(Number(v), m?.unit ?? "count")} (${faDigits(total ? Math.round((Number(v) / total) * 1000) / 10 : 0)}٪)`, String(name)]} isAnimationActive={false} />
          <Legend layout="vertical" align="left" verticalAlign="middle" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius={donut ? "58%" : 0} outerRadius="82%" startAngle={90} endAngle={-270} isAnimationActive={false} stroke="var(--ds-surface)" cursor={onElement ? "pointer" : undefined} onClick={(d: unknown) => {
            const keys = (d as { keys?: KeyValue[]; payload?: { keys?: KeyValue[] } })?.keys ?? (d as { payload?: { keys?: KeyValue[] } })?.payload?.keys;
            if (onElement && keys) onElement(keys);
          }}>
            {rows.map((x) => <Cell key={x.name} fill={x.color} />)}
          </Pie>
          {donut ? (
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="an-donut-total">
              {exactValue(total, m?.unit ?? "count")}
            </text>
          ) : null}
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}

function FunnelView({ spec, result: r, height, onElement }: ResultViewProps) {
  const m = r.measures[0];
  const rows = r.rows.filter((x) => !x.suppressed && !x.other).map((x, i) => ({ name: x.labels[0] ?? "", value: Math.max(0, x.values[m?.key ?? ""] ?? 0), keys: x.keys, fill: seriesColor(i) }));
  return (
    <Box height={height} label={ariaOf(r, spec)}>
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip formatter={(v, name) => [exactValue(Number(v), m?.unit ?? "count"), String(name)]} isAnimationActive={false} />
          <Funnel dataKey="value" data={rows} isAnimationActive={false} cursor={onElement ? "pointer" : undefined} onClick={(d: unknown) => {
            const keys = (d as { keys?: KeyValue[]; payload?: { keys?: KeyValue[] } })?.keys ?? (d as { payload?: { keys?: KeyValue[] } })?.payload?.keys;
            if (onElement && keys) onElement(keys);
          }}>
            <LabelList position="center" dataKey="name" style={{ fontSize: 12, fill: "var(--ds-text)" }} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </Box>
  );
}

// ----- heatmap and pivot -----------------------------------------------------------------------------------------------

function Heatmap({ spec, result: r, onElement }: ResultViewProps) {
  const mx = useMemo(() => matrix(r), [r]);
  const unit = r.measures[0]?.unit ?? "count";
  return (
    <div className="an-heat" role="table" aria-label={ariaOf(r, spec)}>
      <div className="an-heat-grid" style={{ gridTemplateColumns: `minmax(64px, max-content) repeat(${mx.cols.length}, minmax(22px, 1fr))` }}>
        <div role="columnheader" />
        {mx.cols.map((c) => (
          <div key={String(c.key)} role="columnheader" className="an-heat-col" title={c.label}>
            {c.label}
          </div>
        ))}
        {mx.rows.map((row) => (
          <div key={String(row.key)} role="row" className="contents">
            <div role="rowheader" className="an-heat-row">{row.label}</div>
            {mx.cols.map((c) => {
              const cell = mx.cells.get(cellKey(row.key, c.key));
              const v = cell?.v ?? null;
              return (
                <button
                  type="button"
                  key={String(c.key)}
                  role="cell"
                  className="an-heat-cell"
                  style={{ background: heatFill(v, mx.max), color: heatInk(v, mx.max) }}
                  title={`${row.label} · ${c.label}: ${cell?.suppressed ? "کمتر از حد نمایش" : exactValue(v, unit)}`}
                  aria-label={`${row.label}، ${c.label}: ${cell?.suppressed ? "کمتر از حد نمایش" : exactValue(v, unit)}`}
                  disabled={!onElement || !cell}
                  onClick={() => cell && onElement?.(cell.row.keys)}
                >
                  {v !== null && mx.cols.length <= 12 ? axisValue(v, unit) : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PivotTable({ spec, result: r, onElement }: ResultViewProps) {
  const mx = useMemo(() => matrix(r), [r]);
  const m = r.measures[0];
  const unit = m?.unit ?? "count";
  const additive = !!m?.additive;
  return (
    <div className="an-table-wrap">
      <table className="an-table" aria-label={ariaOf(r, spec)}>
        <thead>
          <tr>
            <th scope="col">{r.dims[0]?.label} \ {r.dims[1]?.label}</th>
            {mx.cols.map((c) => (
              <th key={String(c.key)} scope="col">{c.label}</th>
            ))}
            {additive ? <th scope="col">جمع</th> : null}
          </tr>
        </thead>
        <tbody>
          {mx.rows.map((row) => (
            <tr key={String(row.key)}>
              <th scope="row">{row.label}</th>
              {mx.cols.map((c) => {
                const cell = mx.cells.get(cellKey(row.key, c.key));
                return (
                  <td key={String(c.key)} className="an-num">
                    {cell ? (
                      onElement ? <button type="button" className="an-cell-btn" onClick={() => onElement(cell.row.keys)}>{cell.suppressed ? "—" : exactValue(cell.v, unit)}</button> : cell.suppressed ? "—" : exactValue(cell.v, unit)
                    ) : (
                      <span className="ds-zero">—</span>
                    )}
                  </td>
                );
              })}
              {additive ? <td className="an-num an-strong">{exactValue(mx.rowTotals.get(String(row.key ?? "∅")) ?? 0, unit)}</td> : null}
            </tr>
          ))}
        </tbody>
        {additive ? (
          <tfoot>
            <tr>
              <th scope="row">جمع</th>
              {mx.cols.map((c) => (
                <td key={String(c.key)} className="an-num an-strong">{exactValue(mx.colTotals.get(String(c.key ?? "∅")) ?? 0, unit)}</td>
              ))}
              <td className="an-num an-strong">{exactValue(r.totals[m!.key] ?? null, unit)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Groups and their measures as a table (the summary table, and every chart's text alternative). */
function SummaryTable({ spec, result: r, onElement }: ResultViewProps) {
  return (
    <div className="an-table-wrap">
      <table className="an-table" aria-label={ariaOf(r, spec)}>
        <thead>
          <tr>
            {r.dims.map((d) => (
              <th key={d.field + (d.bucket ?? "")} scope="col">{d.label}</th>
            ))}
            {r.measures.map((m) => (
              <th key={m.key} scope="col" className="an-num">{m.label}</th>
            ))}
            <th scope="col" className="an-num">رکوردها</th>
          </tr>
        </thead>
        <tbody>
          {r.dims.length === 0 ? null : r.rows.map((x, i) => (
            <tr key={i} className={cx(x.other && "an-other", x.suppressed && "an-suppressed")}>
              {x.labels.map((l, j) => (
                <td key={j}>
                  {onElement && !x.other && j === 0 ? <button type="button" className="an-cell-btn" onClick={() => onElement(x.keys)}>{l}</button> : l}
                </td>
              ))}
              {r.measures.map((m) => (
                <td key={m.key} className="an-num">{x.suppressed ? <span title="کمتر از حد نمایش">—</span> : exactValue(x.values[m.key] ?? null, m.unit)}</td>
              ))}
              <td className="an-num">{x.suppressed ? "—" : faDigits(x.n)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {r.dims.length ? <th scope="row" colSpan={r.dims.length}>جمع کل</th> : null}
            {r.measures.map((m) => (
              <td key={m.key} className="an-num an-strong">{exactValue(r.totals[m.key] ?? null, m.unit)}</td>
            ))}
            <td className="an-num an-strong">{faDigits(r.total_n)}</td>
          </tr>
        </tfoot>
      </table>
      {r.suppressed ? <p className="an-foot">{faDigits(r.suppressed)} گروه کوچک‌تر از {faDigits(r.k)} رکورد برای حفظ حریم خصوصی بی‌مقدار است.</p> : null}
      {r.truncated ? <p className="an-foot">گروه‌های بیشتری هست؛ فقط بزرگ‌ترین‌ها آمده‌اند.</p> : null}
    </div>
  );
}

// ----- single values ---------------------------------------------------------------------------------------------------

export function DeltaBadge({ delta, direction, label }: { delta: number | null; direction: "up" | "down" | "none"; label?: string }) {
  if (delta === null) return null;
  const tone = deltaTone(delta, direction);
  const Icon = delta > 0 ? ArrowUpLeft : delta < 0 ? ArrowDownLeft : Minus;
  return (
    <span className={cx("an-delta", `is-${tone}`)} title={label ?? "نسبت به دورهٔ پیش"}>
      <Icon size={13} strokeWidth={1.6} aria-hidden />
      {faDigits(Math.abs(Math.round(delta * 10) / 10))}٪
    </span>
  );
}

function ScoreTile({ spec, result: r, onElement }: ResultViewProps) {
  const m = r.measures[0];
  if (!m) return null;
  if (r.dims.length === 1) return <Cartesian spec={{ ...spec, viz: "column" }} result={r} onElement={onElement} />;
  const v = r.totals[m.key] ?? null;
  const prev = r.previous ? (r.previous.totals[m.key] ?? null) : null;
  const delta = r.previous ? deltaPct(v, prev) : null;
  return (
    <div className="an-score">
      <div className="an-score-val ds-t-figure">{exactValue(v, m.unit, spec.options?.decimals)}</div>
      <div className="an-score-label">{m.label}</div>
      <div className="an-score-foot">
        {r.previous ? <DeltaBadge delta={delta} direction="none" /> : null}
        {r.previous ? <span className="an-muted">دورهٔ پیش: {exactValue(prev, m.unit, spec.options?.decimals)}</span> : <span className="an-muted">{faDigits(r.total_n)} رکورد</span>}
      </div>
    </div>
  );
}

function Gauge({ spec, result: r }: ResultViewProps) {
  const m = r.measures[0];
  if (!m) return null;
  const v = r.totals[m.key] ?? null;
  const g = gaugeShare(v, { min: spec.options?.min, max: spec.options?.max, target: spec.options?.target ?? null, unit: m.unit });
  const R = 80;
  const C = { x: 100, y: 96 };
  const end = arcPoint(g.share, R, C.x, C.y);
  const start = arcPoint(0, R, C.x, C.y);
  const full = arcPoint(1, R, C.x, C.y);
  const target = g.target === null ? null : [arcPoint(g.target, R - 14, C.x, C.y), arcPoint(g.target, R + 10, C.x, C.y)];
  return (
    <div className="an-gauge" role="img" aria-label={`${m.label}: ${exactValue(v, m.unit)}${spec.options?.target !== null && spec.options?.target !== undefined ? `، هدف ${exactValue(spec.options.target, m.unit)}` : ""}`}>
      <svg viewBox="0 0 200 116" className="an-gauge-svg">
        <path d={`M ${start.x} ${start.y} A ${R} ${R} 0 0 0 ${full.x} ${full.y}`} fill="none" stroke="var(--ds-sunken)" strokeWidth={16} strokeLinecap="round" />
        {g.share > 0 ? <path d={`M ${start.x} ${start.y} A ${R} ${R} 0 0 0 ${end.x} ${end.y}`} fill="none" stroke="var(--ds-chart-1)" strokeWidth={16} strokeLinecap="round" /> : null}
        {target ? <line x1={target[0].x} y1={target[0].y} x2={target[1].x} y2={target[1].y} stroke="var(--ds-text)" strokeWidth={2} /> : null}
        <text x={C.x} y={C.y - 14} textAnchor="middle" className="an-gauge-val">{exactValue(v, m.unit, spec.options?.decimals)}</text>
      </svg>
      <div className="an-score-label">{m.label}</div>
      <div className="an-gauge-scale"><span>{exactValue(g.min, m.unit)}</span><span>{exactValue(g.max, m.unit)}</span></div>
    </div>
  );
}

// ----- records ---------------------------------------------------------------------------------------------------------

function RecordsTable({ result: r, schema }: ResultViewProps) {
  const l = r.list;
  const def = schema?.def(r.table);
  if (!l || !l.rows.length) return <EmptyState compact title="رکوردی نیست" />;
  return (
    <div className="an-table-wrap">
      <table className="an-table">
        <thead>
          <tr>
            {l.columns.map((c) => (
              <th key={c.name} scope="col">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {l.rows.map((row) => (
            <tr key={String(row.id)}>
              {l.columns.map((c, i) => {
                const f = def?.fields.find((x) => x.name === c.name);
                const v = row[c.name];
                const cell = c.name === "number" ? <RecordNo no={String(v ?? "")} /> : f ? <FieldValue field={f} value={v} table={r.table} schema={schema} display={l.display} compact /> : String(v ?? "");
                return <td key={c.name}>{i === 0 ? <Link to={recordPath(r.table, String(row.id))} className="ds-link">{cell}</Link> : cell}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {l.total !== null && l.total > l.rows.length ? <p className="an-foot">{faDigits(l.rows.length)} از {faDigits(l.total)} رکورد</p> : null}
    </div>
  );
}

function GroupedList(p: ResultViewProps) {
  const groups = p.result.list?.groups ?? [];
  return (
    <div className="flex flex-col gap-2">
      {groups.length ? (
        <div className="an-groups">
          {groups.map((g) => (
            <button type="button" key={String(g.key)} className="an-group-chip" onClick={() => p.onElement?.([g.key])} disabled={!p.onElement}>
              {g.label}
              <b className="ds-t-figure">{faDigits(g.n)}</b>
            </button>
          ))}
        </div>
      ) : null}
      <RecordsTable {...p} />
    </div>
  );
}

// ----- sparkline -------------------------------------------------------------------------------------------------------

/** A small trend line (RTL: the latest point on the left end), with the target as a dashed line. */
export function Sparkline({ points, target, height = 36, tone = "var(--ds-chart-1)" }: { points: ScorePoint[]; target?: number | null; height?: number; tone?: string }) {
  const data = points.map((p) => ({ label: p.label, v: p.value }));
  if (data.filter((d) => d.v !== null).length < 2) return <div className="an-spark-empty" style={{ height }} aria-hidden />;
  return (
    <div style={{ height }} className="an-spark" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, left: 2, bottom: 3 }}>
          <XAxis dataKey="label" reversed hide />
          <YAxis hide domain={["auto", "auto"]} />
          {target !== null && target !== undefined ? <Line dataKey={() => target} stroke="var(--ds-chart-compare)" strokeDasharray="4 3" strokeWidth={1} dot={false} isAnimationActive={false} /> : null}
          <Line dataKey="v" stroke={tone} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** «به‌روز تا …» */
export const freshness = (r: ReportResult, tz?: string) => `به‌روز: ${formatJalaliDateTime(r.generated_at, tz)}`;

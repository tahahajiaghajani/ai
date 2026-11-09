// Pure logic of the analytics screens (tests: tests/analytics-ui.test.ts): a result as chart rows and series (the ds
// categorical palette in fixed order, past eight series folded into «سایر»), Pareto, heatmap and pivot matrices, the
// gauge's arc, which visualizations fit a definition (the gallery), the condition behind a clicked element and the
// records page it opens, sparklines, and the tones of statuses and changes. No React, no fetches.
import { andConds, drillCond, VIZ } from "@shared/analytics/model";
import { formatCompactValue, formatValue, improved } from "@shared/analytics/kpi";
import type { Direction, KeyValue, KpiStatus, MeasureUnit, ReportResult, ReportSpec, ResultRow, ScorePoint, VizType } from "@shared/analytics/types";
import type { Cond, Lookup } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";

export const MAX_SERIES = 8;
export const OTHER_COLOR = "var(--ds-chart-other)";
export const seriesColor = (i: number): string => (i < MAX_SERIES ? `var(--ds-chart-${i + 1})` : OTHER_COLOR);

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  unit: MeasureUnit;
}

export interface ChartData {
  rows: Record<string, unknown>[];
  series: ChartSeries[];
  /** series of the second dimension folded into «سایر» (additive) or left out */
  folded: number;
  /** the unit of the value axis (the first measure's) */
  unit: MeasureUnit;
}

const keyOf = (k: KeyValue) => (k === null || k === undefined ? "∅" : String(k));

/**
 * A result as chart rows: one dimension → one row per group with a value per measure (series = measures); two
 * dimensions → one row per group of the first dimension with a value per group of the second (series = those groups,
 * the eight largest; the rest summed into «سایر» when the measure adds up, else left out).
 */
export function chartData(r: ReportResult): ChartData {
  const unit = r.measures[0]?.unit ?? "count";
  if (r.dims.length < 2) {
    const rows = r.rows.map((x, i) => ({ _i: i, _key: keyOf(x.keys[0] ?? null), label: x.labels[0] ?? "", _n: x.n, _other: !!x.other, _suppressed: !!x.suppressed, ...x.values }));
    return { rows, series: r.measures.map((m, i) => ({ key: m.key, label: m.label, color: seriesColor(i), unit: m.unit })), folded: 0, unit };
  }
  const m = r.measures[0];
  if (!m) return { rows: [], series: [], folded: 0, unit };
  // the series: the second dimension's groups by their total, largest first
  const totals = new Map<string, { label: string; v: number }>();
  for (const x of r.rows) {
    const k = keyOf(x.keys[1] ?? null);
    const t = totals.get(k) ?? { label: x.labels[1] ?? "", v: 0 };
    t.v += Math.abs(x.values[m.key] ?? 0);
    totals.set(k, t);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1].v - a[1].v);
  const kept = ranked.slice(0, MAX_SERIES);
  const rest = new Set(ranked.slice(MAX_SERIES).map(([k]) => k));
  const keptKeys = new Map(kept.map(([k], i) => [k, `s${i}`]));
  const rowsByKey = new Map<string, Record<string, unknown>>();
  for (const x of r.rows) {
    const k0 = keyOf(x.keys[0] ?? null);
    const row = rowsByKey.get(k0) ?? { _key: k0, _key0: x.keys[0] ?? null, label: x.labels[0] ?? "", _n: 0 };
    const v = x.suppressed ? null : (x.values[m.key] ?? null);
    const sk = keptKeys.get(keyOf(x.keys[1] ?? null));
    if (sk) row[sk] = v;
    else if (m.additive && v !== null) row.s_other = Number(row.s_other ?? 0) + v;
    row._n = Number(row._n) + x.n;
    rowsByKey.set(k0, row);
  }
  const series: ChartSeries[] = kept.map(([, t], i) => ({ key: `s${i}`, label: t.label, color: seriesColor(i), unit: m.unit }));
  if (rest.size && m.additive) series.push({ key: "s_other", label: "سایر", color: OTHER_COLOR, unit: m.unit });
  return { rows: [...rowsByKey.values()].map((row, i) => ({ ...row, _i: i })), series, folded: rest.size, unit };
}

/** Pareto: groups from the largest with the cumulative share (percent). */
export function paretoData(r: ReportResult): { label: string; value: number; cum: number; row: ResultRow }[] {
  const m = r.measures[0];
  if (!m) return [];
  const rows = r.rows.filter((x) => !x.suppressed).map((x) => ({ row: x, label: x.labels[0] ?? "", value: x.values[m.key] ?? 0 }));
  const others = rows.filter((x) => x.row.other);
  const sorted = rows.filter((x) => !x.row.other).sort((a, b) => b.value - a.value).concat(others);
  const total = sorted.reduce((s, x) => s + x.value, 0);
  let run = 0;
  return sorted.map((x) => {
    run += x.value;
    return { ...x, cum: total ? Math.round((run / total) * 1000) / 10 : 0 };
  });
}

export interface Matrix {
  rows: { key: KeyValue; label: string }[];
  cols: { key: KeyValue; label: string }[];
  cells: Map<string, { v: number | null; n: number; suppressed: boolean; row: ResultRow }>;
  max: number;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
}

export const cellKey = (r: KeyValue, c: KeyValue) => `${keyOf(r)}|${keyOf(c)}`;

/** Two dimensions as a matrix (heatmap, pivot): rows and columns in the result's order, totals of additive measures. */
export function matrix(r: ReportResult, measureKey?: string): Matrix {
  const mk = measureKey ?? r.measures[0]?.key ?? "";
  const rows = new Map<string, { key: KeyValue; label: string }>();
  const cols = new Map<string, { key: KeyValue; label: string }>();
  const cells: Matrix["cells"] = new Map();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let max = 0;
  for (const x of r.rows) {
    const rk = x.keys[0] ?? null;
    const ck = x.keys[1] ?? null;
    if (!rows.has(keyOf(rk))) rows.set(keyOf(rk), { key: rk, label: x.labels[0] ?? "" });
    if (!cols.has(keyOf(ck))) cols.set(keyOf(ck), { key: ck, label: x.labels[1] ?? "" });
    const v = x.suppressed ? null : (x.values[mk] ?? null);
    cells.set(cellKey(rk, ck), { v, n: x.n, suppressed: !!x.suppressed, row: x });
    if (v !== null) {
      max = Math.max(max, Math.abs(v));
      rowTotals.set(keyOf(rk), (rowTotals.get(keyOf(rk)) ?? 0) + v);
      colTotals.set(keyOf(ck), (colTotals.get(keyOf(ck)) ?? 0) + v);
    }
  }
  // ordinal columns (hours, weekdays, buckets) in their natural order
  const colList = [...cols.values()];
  if (colList.every((c) => typeof c.key === "number")) colList.sort((a, b) => Number(a.key) - Number(b.key));
  return { rows: [...rows.values()], cols: colList, cells, max, rowTotals, colTotals };
}

/** The fill of a heatmap cell: the main series colour mixed with the surface by the value's share of the largest. */
export function heatFill(v: number | null, max: number): string {
  if (v === null || !max) return "var(--ds-sunken)";
  const pct = Math.max(6, Math.round((Math.abs(v) / max) * 100));
  return `color-mix(in oklab, var(--ds-chart-1) ${pct}%, var(--ds-surface))`;
}

/** Ink on a heatmap cell that stays readable on dark and light fills. */
export const heatInk = (v: number | null, max: number) => (v !== null && max && Math.abs(v) / max > 0.55 ? "var(--ds-segment-on, #fff)" : "var(--ds-text)");

/** Does a visualization fit the definition's shape? (the gallery greys out the others, with the reason) */
export function vizFits(viz: VizType, dims: number, measures: number): string | null {
  const v = VIZ[viz];
  if (dims < v.dims[0] || dims > v.dims[1]) return v.dims[0] === v.dims[1] ? `${v.dims[0]} بُعد می‌خواهد` : `${v.dims[0]} تا ${v.dims[1]} بُعد`;
  if (v.kind === "records") return null;
  if (measures < v.measures[0]) return "یک سنجه می‌خواهد";
  if (measures > v.measures[1]) return `${v.measures[1]} سنجه می‌گیرد`;
  if (dims === 2 && measures > 1 && v.kind === "chart") return "با دو بُعد یک سنجه";
  return null;
}

/** The gauge: the share of the scale reached (0–1) and the target's share. */
export function gaugeShare(value: number | null, opts: { min?: number | null; max?: number | null; target?: number | null; unit: MeasureUnit }): { share: number; target: number | null; min: number; max: number } {
  const min = opts.min ?? 0;
  const max = opts.max ?? (opts.unit === "percent" ? 100 : Math.max(1, Math.ceil(((Math.max(value ?? 0, opts.target ?? 0) || 1) * 1.25) / 10) * 10));
  const clamp = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  return { share: value === null ? 0 : clamp(value), target: opts.target === null || opts.target === undefined ? null : clamp(opts.target), min, max };
}

/** A point on the gauge's half circle (angle 0 = the start side). */
export function arcPoint(share: number, r: number, cx: number, cy: number): { x: number; y: number } {
  // RTL: the scale grows from the right (start) to the left (end)
  const a = Math.PI * share;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/** The condition behind a clicked element: the result's own filter and the element's keys (null when not expressible). */
export function elementCond(spec: ReportSpec, r: ReportResult, keys: KeyValue[], def: TableDef, opts: { tz: string; now: number; lookup?: Lookup }): Cond | null {
  const parts: (Cond | null)[] = [r.filter];
  for (const [i, k] of keys.entries()) {
    const dim = spec.dims[i];
    if (!dim) continue;
    const c = drillCond(def, dim, k, opts);
    if (!c && (dim.bucket === "weekday" || dim.bucket === "hour_of_day")) return null;
    parts.push(c);
  }
  return andConds(...parts);
}

/** The records page of a table with a condition («نمایش رکوردها»). */
export const recordsHref = (base: string, cond: Cond | null) => (cond ? `${base}?filter=${encodeURIComponent(JSON.stringify(cond))}` : base);

/** The next drill step of a definition: the clicked element filters, the first dimension becomes the next drill field. */
export function nextDrill(spec: ReportSpec): string | null {
  const steps = spec.options?.drill ?? [];
  const current = spec.dims[0]?.field;
  const at = current ? steps.indexOf(current) : -1;
  return steps[at + 1] ?? null;
}

/** Sparkline points (gaps stay gaps). */
export const sparkData = (points: ScorePoint[]) => points.map((p) => ({ key: p.key, label: p.label, v: p.value }));

export type Tone = "ok" | "warn" | "bad" | "neutral";

export const STATUS_TONE: Record<KpiStatus, Tone> = { good: "ok", warn: "warn", bad: "bad", none: "neutral" };

/** The tone of a change: better is ok, worse is bad, no direction or no change neutral. */
export function deltaTone(delta: number | null, direction: Direction): Tone {
  const b = improved(delta, direction);
  return b === null ? "neutral" : b ? "ok" : "bad";
}

/** Values for axes (compact) and tooltips (exact). */
export const axisValue = (v: number, unit: MeasureUnit) => formatCompactValue(v, unit);
export const exactValue = (v: number | null | undefined, unit: MeasureUnit, decimals?: number | null) => formatValue(v ?? null, unit, decimals);

/** Persian label of a record count. */
export const recordsLabel = (n: number) => `${new Intl.NumberFormat("fa-IR").format(n)} رکورد`;

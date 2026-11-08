// Contracts of analytics (docs/modules/analytics_FA.md): report definitions over any engine table, their results,
// performance indicators (formulas over aggregates), dashboard layouts, sharing and the export bundle. Imported by the
// server and the UI alike: keep it free of server imports.
import type { Cond } from "../model/conditions";
import type { DateUnit, RelativeWindow } from "../model/jalali-buckets";

/** The version of the report definition format (bumped when a definition needs migrating). */
export const SPEC_VERSION = 1;

/**
 * How a report is drawn. `list` and `grouped` show records (the engine's list as the viewer); every other kind shows
 * aggregates computed in SQL under the viewer's access.
 */
export type VizType =
  | "table"
  | "pivot"
  | "bar"
  | "column"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "heatmap"
  | "score"
  | "gauge"
  | "funnel"
  | "pareto"
  | "list"
  | "grouped";

/** Measures: counts, distinct counts, sums and statistics of numbers or of the time between two dates, and rates. */
export type MeasureFn = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "median" | "p90" | "p95" | "ratio";

/** Buckets of a dimension: Jalali calendar units, the hour, the day of the Persian week, the hour of the day. */
export type DimBucket = DateUnit | "hour" | "weekday" | "hour_of_day";

/** What a measured value is, for formatting: durations are seconds, percentages 0–100. */
export type MeasureUnit = "count" | "number" | "duration" | "percent" | "money" | "date";

export interface Measure {
  fn: MeasureFn;
  /** the measured field (a path: `field` or `ref.field`); empty for a plain count */
  field?: string | null;
  /** with a date field: measure the time from this date field to `field` (seconds) — «زمان از ثبت تا حل» */
  from?: string | null;
  /** count only the records matching this condition (`count`), or the share of them (`ratio`, percent) */
  filter?: Cond | null;
  label?: string | null;
}

export interface Dimension {
  /** a field path (one or two dot-walks) */
  field: string;
  /** date fields: a Jalali bucket, the hour, the weekday or the hour of the day */
  bucket?: DimBucket | null;
  /** numbers and durations: ascending boundaries; dates: ages in days (time since the date) */
  ranges?: number[] | null;
  label?: string | null;
}

/** The report's time scope: one date field and a window (relative to today, or fixed dates). */
export interface TimeScope {
  field: string;
  window?: RelativeWindow | null;
  /** fixed range [from, to] (ISO dates, inclusive) when no window */
  from?: string | null;
  to?: string | null;
}

export interface VizOptions {
  stacked?: boolean;
  /** 100 % stacked bars / shares instead of values */
  percent?: boolean;
  /** values written on the marks */
  labels?: boolean;
  /** gauge and score: the target line */
  target?: number | null;
  /** gauge: the scale */
  min?: number | null;
  max?: number | null;
  decimals?: number | null;
  /** the next dimensions a click drills into (breadcrumb) */
  drill?: string[];
  /** the time axis runs from the start side (RTL: right to left) — default true */
  rtlTime?: boolean;
  /** list and grouped list: the records' order (the engine's sort, e.g. "-priority,opened_at") */
  order?: string | null;
  /** list: records shown (default 50, at most 200) */
  size?: number | null;
}

export interface ReportSpec {
  v?: number;
  /** the source table (any engine table the viewer may read) */
  table: string;
  filter?: Cond | null;
  q?: string | null;
  time?: TimeScope | null;
  /** at most six */
  measures: Measure[];
  /** at most three */
  dims: Dimension[];
  /** list and grouped list: the record columns (paths) */
  columns?: string[] | null;
  sort?: { by: "value" | "key"; dir: "asc" | "desc" } | null;
  /** top N groups (1–500) */
  limit?: number | null;
  /** fold the groups past the top N into «سایر» */
  other?: boolean | null;
  /** also compute the previous period (needs a time window) */
  compare?: boolean | null;
  viz: VizType;
  options?: VizOptions | null;
}

// ----- results --------------------------------------------------------------------------------------------------------

export type KeyValue = string | number | boolean | null;

export interface ResultDim {
  field: string;
  label: string;
  /** the field's type (choice, ref, datetime…) */
  type: string;
  bucket?: DimBucket | null;
  ranges?: number[] | null;
  /** a click on an element may filter the records (false for weekday / hour of day) */
  drill: boolean;
  /** choices: option order (funnels, ordered axes) */
  order?: string[];
}

export interface ResultMeasure {
  key: string;
  label: string;
  unit: MeasureUnit;
  /** sums of counts fold into «سایر» exactly; statistics need their own query */
  additive: boolean;
}

export interface ResultRow {
  keys: KeyValue[];
  labels: string[];
  values: Record<string, number | null>;
  /** records behind the row */
  n: number;
  /** the «سایر» fold */
  other?: boolean;
  /** fewer than k records: values withheld */
  suppressed?: boolean;
}

export interface ResultListColumn {
  name: string;
  label: string;
  type: string;
}

export interface ReportResult {
  kind: "agg" | "list";
  table: string;
  table_label: string;
  dims: ResultDim[];
  measures: ResultMeasure[];
  rows: ResultRow[];
  totals: Record<string, number | null>;
  /** records behind the totals */
  total_n: number;
  /** the time window applied (instants, ISO) */
  window: { from: string; to: string } | null;
  previous: { totals: Record<string, number | null>; rows: ResultRow[]; window: { from: string; to: string } } | null;
  list: { columns: ResultListColumn[]; rows: Record<string, unknown>[]; display: Record<string, string>; total: number | null; groups?: { key: KeyValue; label: string; n: number }[] } | null;
  /** more groups exist than were returned */
  truncated: boolean;
  /** groups withheld by the small-cell rule */
  suppressed: number;
  /** the organisation's small-cell threshold (0 = off) */
  k: number;
  /** the condition every row matched (filter + time window), for «نمایش رکوردها» */
  filter: Cond | null;
  generated_at: string;
}

/** A widget or report that could not run for this viewer: no access to the table, a hidden field… */
export interface RestrictedResult {
  restricted: true;
  reason: string;
}

// ----- indicators -----------------------------------------------------------------------------------------------------

export type Direction = "up" | "down" | "none";
export type KpiStatus = "good" | "warn" | "bad" | "none";

/**
 * One aggregate of an indicator's formula. Its filter may hold the placeholders "$start" and "$end" (the period's
 * bounds); with `date_field` and no placeholder, the period filter `date_field ∈ [start, end)` is added for it.
 * Without either, the part is a point-in-time value («باز همین حالا»).
 */
export interface IndicatorPart {
  name: string;
  table: string;
  fn: MeasureFn;
  field?: string | null;
  from?: string | null;
  filter?: Cond | null;
  date_field?: string | null;
}

export interface IndicatorDef {
  key: string;
  name: string;
  description?: string | null;
  practice: string;
  unit: MeasureUnit;
  direction: Direction;
  /** an expression over the parts' names: `breached / total * 100` */
  formula: string;
  parts: IndicatorPart[];
  grain: DateUnit;
  target?: number | null;
  /** amber from here (towards worse) */
  warn?: number | null;
  /** red from here */
  crit?: number | null;
  /** fields of the parts' tables a score is broken down by */
  breakdowns?: string[];
  decimals?: number | null;
}

export interface PeriodInfo {
  key: string;
  label: string;
  /** ISO dates [start, end) */
  start: string;
  end: string;
}

export interface IndicatorValue {
  value: number | null;
  parts: Record<string, number | null>;
  /** records behind the first part */
  n: number;
}

export interface ScorePoint {
  key: string;
  label: string;
  value: number | null;
}

/** One indicator on the scorecard, as the viewer may see it. */
export interface ScorecardItem {
  id: string;
  key: string;
  name: string;
  practice: string;
  unit: MeasureUnit;
  direction: Direction;
  decimals: number | null;
  target: number | null;
  warn: number | null;
  crit: number | null;
  current: PeriodInfo & IndicatorValue;
  previous: PeriodInfo & IndicatorValue;
  status: KpiStatus;
  /** change against the previous period, percent (null when either is missing or zero) */
  delta: number | null;
  /** live series under the viewer's access (bucketed parts only) */
  trend: ScorePoint[];
  /** stored snapshots, when the viewer may read them */
  stored: ScorePoint[] | null;
  /** why the viewer sees no value («شاخص به جدولی تکیه دارد که در دسترس شما نیست») */
  restricted: string | null;
  certified: boolean;
}

// ----- dashboards -----------------------------------------------------------------------------------------------------

export type WidgetKind = "report" | "indicator" | "scorecard" | "text";

export interface Widget {
  id: string;
  kind: WidgetKind;
  /** grid position (12 columns) */
  x: number;
  y: number;
  w: number;
  h: number;
  tab?: string | null;
  title?: string | null;
  /** a saved report (shared separately) … */
  report_id?: string | null;
  /** … or a definition kept in the dashboard */
  spec?: ReportSpec | null;
  indicator_id?: string | null;
  indicator_ids?: string[] | null;
  /** library keys (seeds and imports resolve them to ids) */
  indicator_key?: string | null;
  indicator_keys?: string[] | null;
  text?: string | null;
}

export interface DashboardLayout {
  tabs?: { key: string; label: string }[];
  widgets: Widget[];
}

/** A dashboard-wide control: the time window of every widget, or one field filtered in every widget that has it. */
export interface DashboardFilter {
  key: string;
  kind: "time" | "field";
  field?: string | null;
  label: string;
}

export type FilterValues = Record<string, unknown>;

// ----- sharing --------------------------------------------------------------------------------------------------------

export type ShareKind = "user" | "group" | "unit" | "unit_tree" | "role" | "everyone";
export type ShareRight = "view" | "edit";

/** One entry of a definition's sharing: who, and whether they may change it. Sharing shares the definition, never data. */
export interface Share {
  kind: ShareKind;
  id?: string | null;
  right?: ShareRight;
}

/** The row columns a definition's sharing is compiled into (row rules test the row's own columns only). */
export interface CompiledShares {
  r_users: string[];
  r_groups: string[];
  r_units: string[];
  r_lines: string[];
  r_all: boolean;
  w_users: string[];
  w_groups: string[];
  role_keys: string[];
}

// ----- export bundle --------------------------------------------------------------------------------------------------

export interface BundleReport {
  ref: string;
  name: string;
  description?: string | null;
  folder?: string | null;
  spec: ReportSpec;
}

export interface BundleDashboard {
  ref: string;
  name: string;
  description?: string | null;
  folder?: string | null;
  layout: DashboardLayout;
  filters: DashboardFilter[];
  tv_cycle?: number | null;
  refresh_minutes?: number | null;
}

export interface BundleIndicator extends IndicatorDef {
  ref: string;
}

/** Definitions only: no ids, owners, sharing or data. */
export interface AnalyticsBundle {
  format: "itsm.analytics";
  version: 1;
  exported_at: string;
  reports: BundleReport[];
  dashboards: BundleDashboard[];
  indicators: BundleIndicator[];
}

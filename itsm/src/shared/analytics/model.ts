// The report model, shared by the server's query compiler and the designer: what each visualization takes, which
// measures apply to which fields, the Persian labels, validation of a definition, the time scope and the previous
// period, the condition behind a clicked element (drill-down), dashboard-wide filters and the rules-first chart choice.
// Pure: no server or React imports.
import type { Cond } from "../model/conditions";
import { isNever, relativeWindow, resolvePath, validateCond, type Lookup } from "../model/conditions";
import type { FieldDef, TableDef } from "../model/types";
import { FIELD_TYPES } from "../model/types";
import { addUnits, bucketKey, DATE_UNITS, unitStart, windowDates, zonedMidnight, type DateUnit, type RelativeWindow } from "../model/jalali-buckets";
import { addDays, fromJalali, WEEKDAYS } from "../jalali";
import { zonedTime } from "../flows/schedule";
import { faDigits, formatNumber } from "../format";
import type { DashboardFilter, Dimension, DimBucket, FilterValues, KeyValue, Measure, MeasureFn, MeasureUnit, ReportSpec, TimeScope, VizType } from "./types";

export const MAX_MEASURES = 6;
export const MAX_DIMS = 3;
export const MAX_LIMIT = 500;
/** groups a query returns at most (pivots, heatmaps, long time series) */
export const MAX_GROUPS = 5000;
/** records a list report shows at most */
export const MAX_LIST = 200;

export interface MeasureInfo {
  label: string;
  /** needs a field */
  field: "none" | "optional" | "required";
  /** additive measures fold into «سایر» by summing */
  additive: boolean;
}

export const MEASURES: Record<MeasureFn, MeasureInfo> = {
  count: { label: "تعداد", field: "optional", additive: true },
  count_distinct: { label: "تعداد یکتا", field: "required", additive: false },
  sum: { label: "جمع", field: "required", additive: true },
  avg: { label: "میانگین", field: "required", additive: false },
  min: { label: "کمینه", field: "required", additive: false },
  max: { label: "بیشینه", field: "required", additive: false },
  median: { label: "میانه", field: "required", additive: false },
  p90: { label: "صدک ۹۰", field: "required", additive: false },
  p95: { label: "صدک ۹۵", field: "required", additive: false },
  ratio: { label: "درصد موارد", field: "none", additive: false },
};
export const MEASURE_FNS = Object.keys(MEASURES) as MeasureFn[];

export interface VizInfo {
  label: string;
  /** lucide icon name (the gallery maps it) */
  icon: string;
  dims: [number, number];
  measures: [number, number];
  kind: "chart" | "table" | "single" | "records";
  hint: string;
}

export const VIZ: Record<VizType, VizInfo> = {
  column: { label: "ستونی", icon: "chart-column", dims: [1, 2], measures: [1, 6], kind: "chart", hint: "مقایسهٔ گروه‌ها یا روند در زمان" },
  bar: { label: "میله‌ای افقی", icon: "chart-bar", dims: [1, 2], measures: [1, 6], kind: "chart", hint: "مقایسهٔ گروه‌هایی با نام‌های بلند" },
  line: { label: "خطی", icon: "chart-line", dims: [1, 2], measures: [1, 6], kind: "chart", hint: "روند در زمان" },
  area: { label: "ناحیه‌ای", icon: "chart-area", dims: [1, 2], measures: [1, 6], kind: "chart", hint: "روند و حجم در زمان" },
  pie: { label: "دایره‌ای", icon: "chart-pie", dims: [1, 1], measures: [1, 1], kind: "chart", hint: "سهم چند گروه از کل" },
  donut: { label: "حلقه‌ای", icon: "circle-dot", dims: [1, 1], measures: [1, 1], kind: "chart", hint: "سهم گروه‌ها با جمع در میان" },
  heatmap: { label: "نقشهٔ حرارتی", icon: "grid-3x3", dims: [2, 2], measures: [1, 1], kind: "chart", hint: "دو بُعد با هم، مانند روز هفته × ساعت" },
  funnel: { label: "قیفی", icon: "filter", dims: [1, 1], measures: [1, 1], kind: "chart", hint: "مرحله‌ها به ترتیب" },
  pareto: { label: "پارتو", icon: "chart-no-axes-combined", dims: [1, 1], measures: [1, 1], kind: "chart", hint: "مهم‌ترین علت‌ها با درصد تجمعی" },
  score: { label: "عدد تکی", icon: "hash", dims: [0, 1], measures: [1, 1], kind: "single", hint: "یک عدد با تغییر نسبت به دورهٔ پیش" },
  gauge: { label: "عقربه‌ای", icon: "gauge", dims: [0, 0], measures: [1, 1], kind: "single", hint: "یک عدد در برابر هدف" },
  table: { label: "جدول خلاصه", icon: "table", dims: [0, 3], measures: [1, 6], kind: "table", hint: "گروه‌ها و سنجه‌ها در جدول" },
  pivot: { label: "جدول متقاطع", icon: "table-2", dims: [2, 2], measures: [1, 1], kind: "table", hint: "سطر × ستون" },
  list: { label: "فهرست رکوردها", icon: "list", dims: [0, 0], measures: [0, 0], kind: "records", hint: "خود رکوردها با ستون‌های دلخواه" },
  grouped: { label: "فهرست گروه‌بندی‌شده", icon: "list-tree", dims: [1, 1], measures: [0, 0], kind: "records", hint: "رکوردها زیر گروه‌ها با تعداد هر گروه" },
};
export const VIZ_TYPES = Object.keys(VIZ) as VizType[];

export const BUCKETS: Record<DimBucket, string> = { ...DATE_UNITS, hour: "ساعت", weekday: "روز هفته", hour_of_day: "ساعت روز" };

/** Field types a report can group by (texts, JSON and secrets cannot). */
export function groupable(f: FieldDef): boolean {
  return !["text", "markdown", "json", "conditions", "secret"].includes(f.type);
}

const isDate = (f: FieldDef) => f.type === "date" || f.type === "datetime";
const isNumeric = (f: FieldDef) => !!FIELD_TYPES[f.type]?.numeric;

/** Can `fn` measure this field (and `from`, a date for durations)? A Persian reason, or null. */
export function measureProblem(m: Measure, field: FieldDef | null, from: FieldDef | null): string | null {
  const info = MEASURES[m.fn];
  if (!info) return `سنجهٔ «${String(m.fn)}» شناخته نیست`;
  if (info.field === "required" && !field) return `«${info.label}» فیلد می‌خواهد`;
  if (info.field === "none" && field) return `«${info.label}» فیلد نمی‌گیرد`;
  if (m.fn === "ratio" && !m.filter) return "«درصد موارد» شرطِ موردهایی را که شمرده می‌شوند می‌خواهد";
  if (from) {
    if (!field || !isDate(field) || !isDate(from)) return "زمان میان دو فیلد فقط برای دو تاریخ ممکن است";
    if (m.fn === "count" || m.fn === "count_distinct") return "زمان میان دو تاریخ با شمارش سنجیده نمی‌شود";
    return null;
  }
  if (!field) return null;
  if (m.fn === "count" || m.fn === "count_distinct") return groupable(field) || m.fn === "count" ? null : `«${field.label}» شمردنی نیست`;
  if ((m.fn === "min" || m.fn === "max") && isDate(field)) return null;
  if (!isNumeric(field)) return `«${field.label}» عددی نیست`;
  return null;
}

/** The unit of a measure's values. */
export function measureUnit(m: Measure, field: FieldDef | null): MeasureUnit {
  if (m.fn === "ratio") return "percent";
  if (m.fn === "count" || m.fn === "count_distinct") return "count";
  if (m.from) return "duration";
  if (!field) return "number";
  if (isDate(field)) return "date";
  if (field.type === "duration") return "duration";
  if (field.type === "money") return "money";
  if (field.type === "percent") return "percent";
  return "number";
}

/** «میانگین زمان تا حل»، «تعداد»، «درصد موارد». */
export function measureLabel(m: Measure, field: FieldDef | null, from: FieldDef | null): string {
  if (m.label && String(m.label).trim()) return String(m.label).trim();
  const fn = MEASURES[m.fn]?.label ?? m.fn;
  if (m.fn === "count") return field ? `تعداد «${field.label}» پر` : "تعداد";
  if (m.fn === "ratio") return "درصد موارد";
  if (from && field) return `${fn} زمان «${from.label}» تا «${field.label}»`;
  return field ? `${fn} ${field.label}` : fn;
}

/** «اولویت»، «زمان ثبت (ماه)». */
export function dimLabel(d: Dimension, field: FieldDef | null): string {
  if (d.label && String(d.label).trim()) return String(d.label).trim();
  const base = field?.label ?? d.field;
  if (d.bucket) return `${base} (${BUCKETS[d.bucket] ?? d.bucket})`;
  if (d.ranges?.length) return `${base} (بازه‌ها)`;
  return base;
}

const UNSAFE_PATH = /[^a-z0-9_.]/;

/**
 * Why a definition cannot run against `def` (Persian), or null. Checks the visualization's shape, every path, bucket
 * and measure, and the conditions — not access (the server asks the provider for that).
 */
export function specProblem(spec: ReportSpec, def: TableDef | undefined, lookup?: Lookup): string | null {
  if (!spec || typeof spec !== "object") return "تعریف گزارش معتبر نیست";
  if (!def) return `جدول «${String(spec.table ?? "")}» در این سازمان نیست`;
  // virtual tables, and runtime-only ones no member reads through the record API (`rowAccess.read` NEVER)
  if (def.virtual || isNever(def.rowAccess?.read)) return "از این جدول گزارش گرفته نمی‌شود";
  const viz = VIZ[spec.viz];
  if (!viz) return `نوع نمایش «${String(spec.viz)}» شناخته نیست`;
  const measures = Array.isArray(spec.measures) ? spec.measures : [];
  const dims = Array.isArray(spec.dims) ? spec.dims : [];
  if (measures.length > MAX_MEASURES) return `حداکثر ${faDigits(MAX_MEASURES)} سنجه`;
  if (dims.length > MAX_DIMS) return `حداکثر ${faDigits(MAX_DIMS)} بُعد`;
  if (dims.length < viz.dims[0] || dims.length > viz.dims[1]) {
    return viz.dims[0] === viz.dims[1] ? `«${viz.label}» ${faDigits(viz.dims[0])} بُعد می‌خواهد` : `«${viz.label}» ${faDigits(viz.dims[0])} تا ${faDigits(viz.dims[1])} بُعد می‌گیرد`;
  }
  if (viz.kind !== "records") {
    if (measures.length < viz.measures[0]) return `«${viz.label}» دست‌کم یک سنجه می‌خواهد`;
    if (measures.length > viz.measures[1]) return `«${viz.label}» ${faDigits(viz.measures[1])} سنجه می‌گیرد`;
    if (dims.length === 2 && measures.length > 1 && viz.kind === "chart") return "با دو بُعد فقط یک سنجه رسم می‌شود";
  }
  const resolve = (path: unknown) => (typeof path === "string" && path && !UNSAFE_PATH.test(path) ? resolvePath(def, path, lookup) : null);
  for (const m of measures) {
    if (!m || typeof m !== "object") return "سنجه معتبر نیست";
    const f = m.field ? resolve(m.field) : null;
    if (m.field && !f) return `فیلد «${String(m.field)}» در «${def.label}» نیست`;
    const from = m.from ? resolve(m.from) : null;
    if (m.from && !from) return `فیلد «${String(m.from)}» در «${def.label}» نیست`;
    const p = measureProblem(m, f?.field ?? null, from?.field ?? null);
    if (p) return p;
    if (m.filter) {
      const c = validateCond(m.filter, def, { lookup });
      if (c) return `شرط سنجه: ${c}`;
    }
  }
  for (const d of dims) {
    if (!d || typeof d !== "object") return "بُعد معتبر نیست";
    const r = resolve(d.field);
    if (!r) return `فیلد «${String(d.field)}» در «${def.label}» نیست`;
    if (!groupable(r.field)) return `گروه‌بندی بر پایهٔ «${r.field.label}» ممکن نیست`;
    if (d.bucket && !(d.bucket in BUCKETS)) return `دسته‌بندی «${String(d.bucket)}» شناخته نیست`;
    if (d.bucket && !isDate(r.field)) return `«${r.field.label}» تاریخ نیست`;
    if (d.bucket === "hour" && r.field.type !== "datetime") return `«${r.field.label}» ساعت ندارد`;
    if ((d.bucket === "hour_of_day") && r.field.type !== "datetime") return `«${r.field.label}» ساعت ندارد`;
    if (d.ranges) {
      if (!Array.isArray(d.ranges) || !d.ranges.length || d.ranges.length > 20) return "بازه‌ها باید ۱ تا ۲۰ مرز داشته باشند";
      if (d.ranges.some((x, i) => typeof x !== "number" || !Number.isFinite(x) || (i > 0 && x <= d.ranges![i - 1]))) return "مرزهای بازه باید عدد و صعودی باشند";
      if (!isNumeric(r.field) && !isDate(r.field)) return `«${r.field.label}» عدد یا تاریخ نیست`;
      if (d.bucket) return "بازه و دسته‌بندی زمانی با هم ممکن نیست";
    }
  }
  if (viz.kind === "records") {
    for (const c of spec.columns ?? []) if (!resolve(c)) return `ستون «${String(c)}» در «${def.label}» نیست`;
    if ((spec.columns ?? []).length > 12) return "حداکثر ۱۲ ستون";
  }
  if (spec.time) {
    const r = resolve(spec.time.field);
    if (!r || !isDate(r.field)) return "فیلد زمان گزارش باید تاریخ باشد";
    if (spec.time.window && !relativeWindow(spec.time.window)) return "بازهٔ زمانی معتبر نیست";
    for (const v of [spec.time.from, spec.time.to]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "تاریخ‌های بازه باید به شکل ISO باشند";
  }
  if (spec.filter) {
    const c = validateCond(spec.filter, def, { lookup });
    if (c) return c;
  }
  if (spec.limit !== null && spec.limit !== undefined && (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > MAX_LIMIT)) return `تعداد گروه‌ها باید ۱ تا ${faDigits(MAX_LIMIT)} باشد`;
  if (spec.q && String(spec.q).length > 200) return "عبارت جست‌وجو بلند است";
  if (spec.compare && !spec.time?.window && !(spec.time?.from && spec.time?.to)) return "مقایسه با دورهٔ پیش بازهٔ زمانی می‌خواهد";
  return null;
}

/** A definition with defaults filled and unknown keys dropped (what is stored). */
export function normalizeSpec(spec: ReportSpec): ReportSpec {
  const out: ReportSpec = {
    v: 1,
    table: String(spec.table),
    filter: spec.filter ?? null,
    q: spec.q ? String(spec.q).slice(0, 200) : null,
    time: spec.time ? { field: spec.time.field, window: spec.time.window ?? null, from: spec.time.from ?? null, to: spec.time.to ?? null } : null,
    measures: (spec.measures ?? []).map((m) => ({ fn: m.fn, field: m.field ?? null, from: m.from ?? null, filter: m.filter ?? null, label: m.label ?? null })),
    dims: (spec.dims ?? []).map((d) => ({ field: d.field, bucket: d.bucket ?? null, ranges: d.ranges ?? null, label: d.label ?? null })),
    columns: spec.columns ?? null,
    sort: spec.sort ?? null,
    limit: spec.limit ?? null,
    other: !!spec.other,
    compare: !!spec.compare,
    viz: spec.viz,
    options: spec.options ?? null,
  };
  if (VIZ[out.viz]?.kind === "records") out.measures = [];
  return out;
}

// ----- time ------------------------------------------------------------------------------------------------------------

/** The condition of a time scope (null without one). Dates are inclusive; datetimes run to the next local midnight. */
export function timeCond(time: TimeScope | null | undefined): Cond | null {
  if (!time?.field) return null;
  if (time.window) return { f: time.field, op: "relative", v: { unit: time.window.unit, from: time.window.from, to: time.window.to } };
  const parts: Cond[] = [];
  if (time.from) parts.push({ f: time.field, op: "gte", v: time.from });
  if (time.to) parts.push({ f: time.field, op: "lt", v: addDays(time.to, 1) });
  return parts.length ? (parts.length === 1 ? parts[0] : { and: parts }) : null;
}

/** The scope one period earlier (same length), or null. */
export function previousTime(time: TimeScope | null | undefined): TimeScope | null {
  if (!time?.field) return null;
  if (time.window) {
    const len = time.window.to - time.window.from + 1;
    return { field: time.field, window: { unit: time.window.unit, from: time.window.from - len, to: time.window.to - len } };
  }
  if (time.from && time.to) {
    const days = Math.round((Date.parse(time.to) - Date.parse(time.from)) / 86_400_000) + 1;
    return { field: time.field, from: addDays(time.from, -days), to: addDays(time.to, -days) };
  }
  return null;
}

/** Instants [from, to) a scope covers (ISO), or null for an open scope. */
export function timeRange(time: TimeScope | null | undefined, now: number, tz: string): { from: string; to: string } | null {
  if (!time?.field) return null;
  if (time.window) {
    const d = windowDates(time.window, now, tz);
    return { from: new Date(zonedMidnight(d.from, tz)).toISOString(), to: new Date(zonedMidnight(d.to, tz)).toISOString() };
  }
  if (time.from && time.to) return { from: new Date(zonedMidnight(time.from, tz)).toISOString(), to: new Date(zonedMidnight(addDays(time.to, 1), tz)).toISOString() };
  return null;
}

/** Ready-made windows of the designer and the dashboard's time control. */
export const TIME_PRESETS: { key: string; label: string; window: RelativeWindow }[] = [
  { key: "today", label: "امروز", window: { unit: "day", from: 0, to: 0 } },
  { key: "7d", label: "۷ روز گذشته", window: { unit: "day", from: -6, to: 0 } },
  { key: "30d", label: "۳۰ روز گذشته", window: { unit: "day", from: -29, to: 0 } },
  { key: "90d", label: "۹۰ روز گذشته", window: { unit: "day", from: -89, to: 0 } },
  { key: "week", label: "این هفته", window: { unit: "week", from: 0, to: 0 } },
  { key: "month", label: "این ماه", window: { unit: "month", from: 0, to: 0 } },
  { key: "last_month", label: "ماه گذشته", window: { unit: "month", from: -1, to: -1 } },
  { key: "quarter", label: "این فصل", window: { unit: "quarter", from: 0, to: 0 } },
  { key: "last_quarter", label: "فصل گذشته", window: { unit: "quarter", from: -1, to: -1 } },
  { key: "6m", label: "۶ ماه گذشته", window: { unit: "month", from: -5, to: 0 } },
  { key: "12m", label: "۱۲ ماه گذشته", window: { unit: "month", from: -11, to: 0 } },
  { key: "year", label: "امسال", window: { unit: "year", from: 0, to: 0 } },
  { key: "last_year", label: "پارسال", window: { unit: "year", from: -1, to: -1 } },
];

export function windowLabel(w: RelativeWindow | null | undefined): string {
  if (!w) return "همهٔ زمان‌ها";
  const p = TIME_PRESETS.find((x) => x.window.unit === w.unit && x.window.from === w.from && x.window.to === w.to);
  if (p) return p.label;
  const unit = DATE_UNITS[w.unit];
  if (w.to === 0) return `${faDigits(w.to - w.from + 1)} ${unit} اخیر`;
  return `از ${faDigits(-w.from)} تا ${faDigits(-w.to)} ${unit} پیش`;
}

// ----- ranges and buckets --------------------------------------------------------------------------------------------

/** Labels of range buckets: index 0 is below the first bound, index n at or above the last. */
export function rangeLabel(ranges: number[], i: number, unit: "days" | "number" | "duration" = "number"): string {
  const fmt = (v: number) => (unit === "duration" ? durationShort(v) : formatNumber(v, { dp: 2 }));
  const suffix = unit === "days" ? " روز" : "";
  if (i <= 0) return `کمتر از ${fmt(ranges[0])}${suffix}`;
  if (i >= ranges.length) return `${fmt(ranges[ranges.length - 1])}${suffix} و بیشتر`;
  return `${fmt(ranges[i - 1])} تا ${fmt(ranges[i])}${suffix}`;
}

/** «۲ ساعت»، «۴۵ دقیقه»، «۳ روز» — a short duration for axes and ranges (seconds in). */
export function durationShort(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 3600) return `${formatNumber(Math.round(s / 60))} دقیقه`;
  if (s < 86_400 * 2) return `${formatNumber(s / 3600, { dp: 1 })} ساعت`;
  return `${formatNumber(s / 86_400, { dp: 1 })} روز`;
}

/** The first day (ISO) and the day after the last of a date bucket's key («1405-01», «1405-Q2», «1405», an ISO day). */
export function bucketDates(key: string, unit: DateUnit): { start: string; end: string } | null {
  let start: string | null = null;
  if (unit === "day" || unit === "week") start = /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  else if (unit === "month") {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    start = m ? fromJalali(Number(m[1]), Number(m[2]), 1) : null;
  } else if (unit === "quarter") {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    start = m ? fromJalali(Number(m[1]), (Number(m[2]) - 1) * 3 + 1, 1) : null;
  } else {
    const m = /^(\d{4})$/.exec(key);
    start = m ? fromJalali(Number(m[1]), 1, 1) : null;
  }
  if (!start) return null;
  if (unit === "week") start = unitStart(start, "week");
  return { start, end: addUnits(start, unit, 1) };
}

/** The persian week starts on Saturday: «شنبه»…«جمعه» for keys 0…6. */
export const weekdayLabel = (i: number) => WEEKDAYS[i] ?? String(i);
export const hourLabel = (h: number) => `${faDigits(String(h).padStart(2, "0"))}:۰۰`;

// ----- drill-down ----------------------------------------------------------------------------------------------------

/**
 * The condition that selects the records of one element (a bar, a slice, a cell): `dim` of the report at `key`.
 * Null when the element cannot be expressed as a condition (days of the week, hours of the day).
 */
export function drillCond(def: TableDef, dim: Dimension, key: KeyValue, opts: { tz: string; now: number; lookup?: Lookup }): Cond | null {
  const r = resolvePath(def, dim.field, opts.lookup);
  if (!r) return null;
  const f = r.field;
  const dated = f.type === "date";
  const at = (iso: string) => (dated ? iso : new Date(zonedMidnight(iso, opts.tz)).toISOString());
  if (dim.bucket === "weekday" || dim.bucket === "hour_of_day") return null;
  if (key === null || key === undefined || key === "") {
    if (dim.ranges?.length || dim.bucket) return { f: dim.field, op: "empty" };
    return { f: dim.field, op: "empty" };
  }
  if (dim.bucket === "hour") {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/.exec(String(key));
    if (!m) return null;
    const start = zonedTime(m[1], Number(m[2]) * 60, opts.tz);
    return { and: [{ f: dim.field, op: "gte", v: new Date(start).toISOString() }, { f: dim.field, op: "lt", v: new Date(start + 3600_000).toISOString() }] };
  }
  if (dim.bucket) {
    const b = bucketDates(String(key), dim.bucket as DateUnit);
    if (!b) return null;
    return { and: [{ f: dim.field, op: "gte", v: at(b.start) }, { f: dim.field, op: "lt", v: at(b.end) }] };
  }
  if (dim.ranges?.length) {
    const i = Number(key);
    if (!Number.isInteger(i)) return null;
    const lo = i <= 0 ? null : dim.ranges[i - 1];
    const hi = i >= dim.ranges.length ? null : dim.ranges[i];
    const parts: Cond[] = [];
    if (f.type === "date" || f.type === "datetime") {
      // ages in days: an age in [lo, hi) is a date in (now − hi, now − lo]
      const iso = (days: number) => {
        const ms = opts.now - days * 86_400_000;
        return dated ? new Date(ms).toISOString().slice(0, 10) : new Date(ms).toISOString();
      };
      if (lo !== null) parts.push({ f: dim.field, op: "lte", v: iso(lo) });
      if (hi !== null) parts.push({ f: dim.field, op: "gt", v: iso(hi) });
    } else {
      if (lo !== null) parts.push({ f: dim.field, op: "gte", v: lo });
      if (hi !== null) parts.push({ f: dim.field, op: "lt", v: hi });
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  }
  return { f: dim.field, op: "eq", v: key };
}

/** Every condition a report's rows match (filter, time scope, an extra condition), as one. */
export function andConds(...conds: (Cond | null | undefined)[]): Cond | null {
  const xs = conds.filter((c): c is Cond => !!c);
  return xs.length === 0 ? null : xs.length === 1 ? xs[0] : { and: xs };
}

export function reportFilter(spec: ReportSpec, extra?: Cond | null): Cond | null {
  return andConds(spec.filter ?? null, timeCond(spec.time), extra ?? null);
}

/** The next drill step: the clicked element becomes a filter and the dimension moves to the next drill field. */
export function drillDown(spec: ReportSpec, cond: Cond, next: string | null): ReportSpec {
  const dims = next ? [{ field: next }, ...spec.dims.slice(1)] : spec.dims;
  return { ...spec, filter: andConds(spec.filter ?? null, cond), dims };
}

// ----- dashboard filters ---------------------------------------------------------------------------------------------

export interface AppliedFilters {
  spec: ReportSpec;
  /** filter keys that changed this widget */
  applied: string[];
  /** filter keys this widget's table has no field for */
  ignored: string[];
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

/** Apply the dashboard's controls to one widget's definition. */
export function applyDashboardFilters(spec: ReportSpec, def: TableDef, filters: DashboardFilter[], values: FilterValues, lookup?: Lookup): AppliedFilters {
  let out: ReportSpec = spec;
  const applied: string[] = [];
  const ignored: string[] = [];
  for (const f of filters) {
    const v = values[f.key];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (f.kind === "time") {
      if (!out.time?.field) {
        ignored.push(f.key);
        continue;
      }
      const w = relativeWindow((v as { window?: unknown }).window ?? v);
      const fixed = v as { from?: string; to?: string };
      if (w) out = { ...out, time: { field: out.time!.field, window: { unit: w.unit, from: w.from, to: w.to } } };
      else if (fixed.from && fixed.to) out = { ...out, time: { field: out.time!.field, from: fixed.from, to: fixed.to } };
      else continue;
      applied.push(f.key);
      continue;
    }
    if (!f.field || !resolvePath(def, f.field, lookup)) {
      ignored.push(f.key);
      continue;
    }
    const xs = asArray(v);
    out = { ...out, filter: andConds(out.filter ?? null, xs.length === 1 ? { f: f.field, op: "eq", v: xs[0] } : { f: f.field, op: "in", v: xs }) };
    applied.push(f.key);
  }
  return { spec: out, applied, ignored };
}

// ----- the chart choice ---------------------------------------------------------------------------------------------

/**
 * The visualization a definition reads best as (rules first, catalogue ANA-009): one number → a score; time on the
 * axis → a line; days × hours → a heatmap; two dimensions → stacked columns; a handful of shares → a donut; long
 * names → horizontal bars; otherwise columns.
 */
export function suggestViz(dims: { type: string; bucket?: DimBucket | null; options?: number }[], measures: number): VizType {
  if (!dims.length) return measures > 1 ? "table" : "score";
  if (dims.length >= 3) return "table";
  if (dims.length === 2) {
    const b = dims.map((d) => d.bucket);
    if (b.includes("weekday") && b.includes("hour_of_day")) return "heatmap";
    return measures > 1 ? "table" : "column";
  }
  const d = dims[0];
  if (d.bucket && d.bucket !== "weekday" && d.bucket !== "hour_of_day") return "line";
  if (d.bucket) return "column";
  if (measures === 1 && (d.type === "choice" || d.type === "bool") && (d.options ?? 99) <= 6) return "donut";
  if (d.type === "ref" || d.type === "user" || d.type === "group") return "bar";
  return "column";
}

/** A new definition for a table: the record count by the table's state (or nothing) over the last 30 days. */
export function starterSpec(def: TableDef): ReportSpec {
  const state = def.states?.field ?? def.fields.find((f) => f.type === "choice" && f.list)?.name ?? null;
  const time = def.fields.find((f) => f.name === "opened_at") ?? def.fields.find((f) => f.name === "created_at");
  return {
    v: 1,
    table: def.key,
    filter: null,
    time: time ? { field: time.name, window: { unit: "day", from: -29, to: 0 } } : null,
    measures: [{ fn: "count" }],
    dims: state ? [{ field: state }] : [],
    viz: state ? "column" : "score",
    sort: { by: "value", dir: "desc" },
    limit: null,
    other: false,
    compare: false,
    options: null,
  };
}

/** The key of a bucket an instant falls in (tests and the client's own previews). */
export const keyOfDate = (iso: string, unit: DateUnit) => bucketKey(unitStart(iso, unit), unit);

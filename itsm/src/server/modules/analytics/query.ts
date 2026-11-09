// The report engine (catalogue ANA-006/007/009/011/014/052): a report definition compiled into SQL over the records
// the VIEWER may read — every statement starts from the engine's `readable(ctx, …)` (the access provider's predicate
// and the table's row rule), filters and dot-walks go through `toSql`/`pathExpr` (walks into records the viewer may
// not read yield nothing), every field path is checked with `pathVisible` (field groups hide restricted measures and
// dimensions) — so a report counts exactly what its viewer could list, and a shared dashboard shows each viewer only
// their rows. Aggregation happens in SQL only (GROUP BY, FILTER, percentiles): rows are never loaded into JS to be
// summed. Dates bucket on the Jalali calendar in the organisation's time zone (day, week from Saturday, month,
// quarter, year — the engine's boundaries), by the hour, the Persian weekday or the hour of the day; numbers and ages
// in ranges. Groups with fewer than k records are withheld when the organisation sets the small-cell rule.
import type { Cond } from "@shared/model/conditions";
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { bucketKey, bucketLabel, bucketStarts, localDate, unitStart, windowDates, zonedMidnight, type DateUnit } from "@shared/model/jalali-buckets";
import { addDays, formatJalali } from "@shared/jalali";
import { formatNumber } from "@shared/format";
import {
  dimLabel, hourLabel, MAX_GROUPS, MAX_LIST, measureLabel, measureUnit, MEASURES, previousTime, rangeLabel, reportFilter, specProblem, timeRange, VIZ, weekdayLabel,
} from "@shared/analytics/model";
import type { Dimension, KeyValue, Measure, ReportResult, ReportSpec, ResultDim, ResultMeasure, ResultRow } from "@shared/analytics/types";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { AppError, bad, forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { checkFilter, condEnv, defFor, labelOf, list, optionsOf, pathExpr, pathVisible, readable, RefSet, resolveDisplay, searchSql, toSql, type OrgSchema } from "../../engine";
import { analyticsConfig, num } from "./common";

export interface RunOptions {
  /** an extra condition (a drill-down, a dashboard's controls applied by the caller) */
  extra?: Cond | null;
  /** the reference instant (tests) */
  now?: number;
  /** small-cell threshold (default: the organisation's setting) */
  k?: number;
  /** skip the previous period even when the definition asks for it */
  noCompare?: boolean;
}

type DimKind = "plain" | "array" | "bucket" | "hour" | "weekday" | "hod" | "range" | "age";

interface DimPlan {
  dim: Dimension;
  field: FieldDef;
  /** the table the field belongs to (after walks) */
  owner: TableDef;
  kind: DimKind;
  unit?: DateUnit;
  starts?: string[];
}

interface MeasurePlan {
  m: Measure;
  key: string;
  field: FieldDef | null;
  from: FieldDef | null;
  filter: Cond | null;
}

const DAY = 86_400_000;

/** Run a report as `ctx` (the viewer). Throws 403 for a table or field the viewer may not use, 400 for a bad definition. */
export async function runReport(ctx: Ctx, input: ReportSpec, opts: RunOptions = {}): Promise<ReportResult> {
  const { def, schema } = await defFor(ctx, String(input?.table ?? ""));
  if (def.virtual || !access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const problem = specProblem(input, def, schema.lookup);
  if (problem) throw bad(problem);
  const spec = input;
  // field security: every path the definition names must be visible to the viewer
  const paths = [
    ...spec.dims.map((d) => d.field),
    ...spec.measures.flatMap((m) => [m.field, m.from].filter((x): x is string => !!x)),
    ...(VIZ[spec.viz].kind === "records" ? spec.columns ?? [] : []),
    ...(spec.time?.field ? [spec.time.field] : []),
  ];
  for (const p of paths) if (!pathVisible(ctx, def, p, schema)) throw forbidden(`«${p}» برای شما در دسترس نیست`);
  for (const m of spec.measures) if (m.filter) checkFilter(ctx, def, schema, m.filter);

  const env = await condEnv(ctx);
  const tz = env.tz || "Asia/Tehran";
  const now = opts.now ?? (env.now ? new Date(env.now as string | number).getTime() : Date.now());
  const filter = checkFilter(ctx, def, schema, reportFilter(spec, opts.extra));
  const k = opts.k ?? (await analyticsConfig(ctx.db, ctx)).small_cell_k;

  if (VIZ[spec.viz].kind === "records") return runList(ctx, def, schema, spec, filter, { tz, now, k });
  const core = await aggregateCore(ctx, def, schema, spec, filter, { tz, now, env });
  let previous: ReportResult["previous"] = null;
  if (spec.compare && !opts.noCompare) {
    const prevTime = previousTime(spec.time);
    if (prevTime) {
      const prevSpec: ReportSpec = { ...spec, time: prevTime, compare: false };
      const prevFilter = checkFilter(ctx, def, schema, reportFilter(prevSpec, opts.extra));
      const p = await aggregateCore(ctx, def, schema, prevSpec, prevFilter, { tz, now, env });
      const w = timeRange(prevTime, now, tz);
      previous = { totals: p.totals, rows: suppress(p.rows, k).rows, window: w ?? { from: "", to: "" } };
    }
  }
  const s = suppress(core.rows, k);
  return {
    kind: "agg",
    table: def.key,
    table_label: def.plural,
    dims: core.dims,
    measures: core.measures,
    rows: s.rows,
    totals: core.totals,
    total_n: core.total_n,
    window: timeRange(spec.time, now, tz),
    previous,
    list: null,
    truncated: core.truncated,
    suppressed: s.count,
    k,
    filter,
    generated_at: new Date(now).toISOString(),
  };
}

/** Withhold groups of fewer than k records; one withheld group also withholds the next smallest (no subtraction). */
function suppress(rows: ResultRow[], k: number): { rows: ResultRow[]; count: number } {
  if (!k || k <= 1 || rows.length < 1) return { rows, count: 0 };
  const small = new Set(rows.map((r, i) => (r.n < k && !r.other ? i : -1)).filter((i) => i >= 0));
  if (small.size === 1 && rows.length > 1) {
    const next = rows.map((r, i) => ({ r, i })).filter((x) => !small.has(x.i) && !x.r.other).sort((a, b) => a.r.n - b.r.n)[0];
    if (next) small.add(next.i);
  }
  const out = rows.map((r, i) => (small.has(i) ? { ...r, values: Object.fromEntries(Object.keys(r.values).map((key) => [key, null])), n: 0, suppressed: true } : r));
  return { rows: out, count: small.size };
}

// ----- records ---------------------------------------------------------------------------------------------------------

async function runList(ctx: Ctx, def: TableDef, schema: OrgSchema, spec: ReportSpec, filter: Cond | null, o: { tz: string; now: number; k: number }): Promise<ReportResult> {
  const columns = (spec.columns?.length ? spec.columns : def.list?.columns ?? [def.display]).slice(0, 12);
  const size = Math.max(1, Math.min(MAX_LIST, Math.trunc(spec.options?.size ?? 50) || 50));
  const sort = spec.options?.order ?? def.list?.order ?? undefined;
  const r = await list(ctx, def.key, { filter, q: spec.q ?? undefined, sort, size, fields: columns, total: true });
  const cols = columns.map((c) => {
    const f = schema.lookup(def.key) ? resolveField(def, c, schema) : null;
    return { name: c, label: f?.label ?? c, type: f?.type ?? "string" };
  });
  let groups: NonNullable<ReportResult["list"]>["groups"];
  const dims: ResultDim[] = [];
  if (spec.viz === "grouped" && spec.dims[0]) {
    const g = await aggregateCore(ctx, def, schema, { ...spec, viz: "table", measures: [{ fn: "count" }], dims: [spec.dims[0]], limit: null, other: false }, filter, { tz: o.tz, now: o.now, env: await condEnv(ctx) });
    groups = g.rows.map((x) => ({ key: x.keys[0], label: x.labels[0], n: x.n }));
    dims.push(...g.dims);
  }
  return {
    kind: "list",
    table: def.key,
    table_label: def.plural,
    dims,
    measures: [],
    rows: [],
    totals: {},
    total_n: r.total ?? r.rows.length,
    window: timeRange(spec.time, o.now, o.tz),
    previous: null,
    list: { columns: cols, rows: r.rows, display: r.display, total: r.total ?? null, groups },
    truncated: (r.total ?? 0) > r.rows.length,
    suppressed: 0,
    k: o.k,
    filter,
    generated_at: new Date(o.now).toISOString(),
  };
}

function resolveField(def: TableDef, path: string, schema: OrgSchema): FieldDef | null {
  const parts = path.split(".");
  let at: TableDef | undefined = def;
  for (let i = 0; i < parts.length && at; i++) {
    const f: FieldDef | undefined = at.fields.find((x) => x.name === parts[i]);
    if (!f) return null;
    if (i === parts.length - 1) return f;
    const t = refTarget(f, at.key);
    at = t ? schema.lookup(t) : undefined;
  }
  return null;
}

// ----- aggregates ------------------------------------------------------------------------------------------------------

interface CoreOptions {
  tz: string;
  now: number;
  env: Awaited<ReturnType<typeof condEnv>>;
}

interface Core {
  dims: ResultDim[];
  measures: ResultMeasure[];
  rows: ResultRow[];
  totals: Record<string, number | null>;
  total_n: number;
  truncated: boolean;
}

const isDateField = (f: FieldDef) => f.type === "date" || f.type === "datetime";

async function aggregateCore(ctx: Ctx, def: TableDef, schema: OrgSchema, spec: ReportSpec, filter: Cond | null, o: CoreOptions): Promise<Core> {
  const env = o.env;
  const sqlOpts = { ctx, lookup: schema.lookup };
  const visible = access().visibleFields(ctx, def);
  const scope = (params: unknown[]) => {
    const where = [readable(ctx, def, "t", params, env)];
    if (filter) where.push(toSql(filter, def, "t", params, env, sqlOpts));
    if (spec.q) {
      const s = searchSql(def, "t", spec.q, params, (f) => !visible || visible.has(f.name));
      if (s) where.push(s);
    }
    return where.map((w) => `(${w})`).join(" and ");
  };
  const expr = (path: string, params: unknown[]) => pathExpr(def, path, "t", params, env, sqlOpts);

  // plans
  const dims: DimPlan[] = spec.dims.map((d) => {
    const x = expr(d.field, []);
    const f = x.field;
    let kind: DimKind = "plain";
    if (d.bucket === "hour") kind = "hour";
    else if (d.bucket === "weekday") kind = "weekday";
    else if (d.bucket === "hour_of_day") kind = "hod";
    else if (d.bucket) kind = "bucket";
    else if (d.ranges?.length) kind = isDateField(f) ? "age" : "range";
    else if (FIELD_TYPES[f.type]?.array) kind = "array";
    else if (isDateField(f)) kind = "bucket";
    return { dim: d, field: f, owner: x.def, kind, unit: kind === "bucket" ? ((d.bucket as DateUnit | undefined) ?? "day") : undefined };
  });
  const measures: MeasurePlan[] = spec.measures.map((m, i) => ({
    m,
    key: `m${i}`,
    field: m.field ? expr(m.field, []).field : null,
    from: m.from ? expr(m.from, []).field : null,
    filter: m.filter ?? null,
  }));

  // bucket boundaries: the time window when the dimension is the report's time field, else the data's range
  for (const p of dims.filter((d) => d.kind === "bucket")) {
    const unit = p.unit!;
    const range = spec.time?.field === p.dim.field ? timeDates(spec, o) : null;
    if (range) {
      p.starts = bucketStarts(range.from, range.to, unit);
      continue;
    }
    const params: unknown[] = [];
    const where = scope(params);
    const e = expr(p.dim.field, params).expr;
    const r = await ctx.db.one<{ lo: string | number | null; hi: string | number | null }>(
      p.field.type === "date"
        ? `select min(${e})::text as lo, max(${e})::text as hi from ${def.table} t where ${where}`
        : `select (extract(epoch from min(${e})) * 1000)::float8 as lo, (extract(epoch from max(${e})) * 1000)::float8 as hi from ${def.table} t where ${where}`,
      params,
    );
    if (r?.lo === null || r?.lo === undefined || r.hi === null || r.hi === undefined) {
      p.starts = [];
      continue;
    }
    const day = (v: string | number) => (p.field.type === "date" ? String(v).slice(0, 10) : localDate(Number(v), o.tz));
    p.starts = bucketStarts(day(r.lo), day(r.hi), unit);
  }

  // one statement: group keys + measures + the record count of each group
  const build = (params: unknown[], extraWhere?: (keys: string[], params: unknown[]) => string, grouped = true) => {
    const where = scope(params);
    const joins: string[] = [];
    const keys: string[] = [];
    dims.forEach((p, i) => {
      const e = expr(p.dim.field, params).expr;
      keys.push(keyExpr(p, e, i, params, joins, o));
    });
    const ms = measures.map((mp) => `${measureSql(mp, (path) => expr(path, params).expr, params, def, env, sqlOpts)} as "${mp.key}"`);
    const extra = extraWhere ? ` and ${extraWhere(keys, params)}` : "";
    const select = [...(grouped ? keys.map((k, i) => `${k} as k${i}`) : []), ...ms, "count(*)::int as n"].join(", ");
    return { sql: `select ${select} from ${def.table} t ${joins.join(" ")} where ${where}${extra}`, keys };
  };

  const ordinal = (p: DimPlan) => p.kind !== "plain" && p.kind !== "array";
  const first = measures[0]?.key ?? "n";
  const sortDir = spec.sort?.dir === "asc" ? "asc" : "desc";
  const byKey = spec.sort?.by === "key";
  const single = dims.length === 1 && !ordinal(dims[0]);
  const limit = single && spec.limit ? Math.min(spec.limit, 500) : MAX_GROUPS;

  let rows: Record<string, unknown>[] = [];
  let truncated = false;
  if (dims.length) {
    const params: unknown[] = [];
    const { sql } = build(params);
    const order = dims.some(ordinal)
      ? dims.map((p, i) => (ordinal(p) ? `k${i} asc nulls last` : `"${first}" ${sortDir} nulls last`)).join(", ")
      : byKey
        ? dims.map((_, i) => `k${i} ${sortDir} nulls last`).join(", ")
        : `"${first}" ${sortDir} nulls last, ${dims.map((_, i) => `k${i} nulls last`).join(", ")}`;
    rows = await ctx.db.query<Record<string, unknown>>(`${sql} group by ${dims.map((_, i) => `k${i}`).join(", ")} order by ${order} limit ${limit + 1}`, params);
    if (rows.length > limit) {
      rows = rows.slice(0, limit);
      truncated = !single || !spec.limit;
    }
  }

  // totals over records (an array dimension never counts a record twice here)
  const tParams: unknown[] = [];
  const totalSql = `select ${[...measures.map((mp) => `${measureSql(mp, (path) => expr(path, tParams).expr, tParams, def, env, sqlOpts)} as "${mp.key}"`), "count(*)::int as n"].join(", ")} from ${def.table} t where ${scope(tParams)}`;
  const totalsRow = (await ctx.db.one<Record<string, unknown>>(totalSql, tParams)) ?? {};

  // «سایر»: the groups past the top N, measured in SQL (exact for every measure)
  let otherRow: Record<string, unknown> | null = null;
  const hiddenGroups = single && spec.limit && spec.other && rows.length >= (spec.limit ?? 0);
  if (hiddenGroups) {
    const shown = rows.map((r) => r.k0);
    const nullShown = shown.some((v) => v === null || v === undefined);
    const values = shown.filter((v) => v !== null && v !== undefined).map((v) => String(v));
    const oParams: unknown[] = [];
    const { sql } = build(
      oParams,
      (keys, p) => {
        p.push(pgArray(values));
        const k0 = `(${keys[0]})`;
        const notIn = values.length ? `${k0}::text <> all($${p.length}::text[])` : "true";
        return nullShown ? `(${k0} is not null and ${notIn})` : `(${k0} is null or ${notIn})`;
      },
      false,
    );
    const r = await ctx.db.one<Record<string, unknown>>(sql, oParams);
    if (r && Number(r.n ?? 0) > 0) otherRow = r;
  }

  // labels
  const refs = new RefSet();
  for (const r of rows) dims.forEach((p, i) => {
    if (p.kind === "plain" || p.kind === "array") {
      const t = FIELD_TYPES[p.field.type]?.family === "ref" ? refTarget(p.field, p.owner.key) : null;
      if (t && r[`k${i}`] !== null && r[`k${i}`] !== undefined) refs.add(t, String(r[`k${i}`]));
    }
  });
  const display = await resolveDisplay(ctx.db, ctx, env, schema, refs);

  const resultMeasures: ResultMeasure[] = measures.map((mp) => ({ key: mp.key, label: measureLabel(mp.m, mp.field, mp.from), unit: measureUnit(mp.m, mp.field), additive: MEASURES[mp.m.fn].additive && !mp.from }));
  const values = (r: Record<string, unknown>) => Object.fromEntries(measures.map((mp) => [mp.key, num(r[mp.key])]));
  let outRows: ResultRow[] = rows.map((r) => {
    const keys: KeyValue[] = dims.map((p, i) => keyOut(p, r[`k${i}`]));
    return { keys, labels: dims.map((p, i) => keyText(p, keys[i], display, schema)), values: values(r), n: Number(r.n ?? 0) };
  });
  if (otherRow) outRows.push({ keys: [null], labels: ["سایر"], values: values(otherRow), n: Number(otherRow.n ?? 0), other: true });

  // choices ordered by their options when sorted by key (funnels, ordered axes)
  const resultDims: ResultDim[] = dims.map((p) => {
    const order = p.field.type === "choice" || p.field.type === "multichoice" ? optionsOf(p.field, schema).map((x) => x.value) : undefined;
    return { field: p.dim.field, label: dimLabel(p.dim, p.field), type: p.field.type, bucket: p.dim.bucket ?? (p.kind === "bucket" ? p.unit : null), ranges: p.dim.ranges ?? null, drill: p.kind !== "weekday" && p.kind !== "hod", order };
  });
  if (dims.length === 1 && (byKey || spec.viz === "funnel") && resultDims[0].order) {
    const order = resultDims[0].order;
    const idx = (k: KeyValue) => {
      const i = order.indexOf(String(k));
      return i < 0 ? order.length : i;
    };
    const tail = outRows.filter((r) => r.other);
    outRows = outRows.filter((r) => !r.other).sort((a, b) => (sortDir === "asc" ? idx(a.keys[0]) - idx(b.keys[0]) : idx(b.keys[0]) - idx(a.keys[0]))).concat(tail);
  }
  // a time axis without holes: every bucket of the window, empty ones at zero (counts, sums) or blank
  if (dims.length === 1 && dims[0].kind === "bucket" && dims[0].starts?.length && dims[0].starts.length <= 400) {
    const p = dims[0];
    const have = new Map(outRows.map((r) => [String(r.keys[0]), r]));
    const zero = Object.fromEntries(resultMeasures.map((m) => [m.key, m.additive ? 0 : null]));
    outRows = p.starts!.map((s) => {
      const key = bucketKey(s, p.unit!);
      return have.get(key) ?? { keys: [key], labels: [bucketLabel(s, p.unit!)], values: { ...zero }, n: 0 };
    });
  }
  // hours of the day and days of the week: all of them, in order
  if (dims.length === 1 && (dims[0].kind === "weekday" || dims[0].kind === "hod")) {
    const n = dims[0].kind === "weekday" ? 7 : 24;
    const have = new Map(outRows.map((r) => [Number(r.keys[0]), r]));
    const zero = Object.fromEntries(resultMeasures.map((m) => [m.key, m.additive ? 0 : null]));
    outRows = Array.from({ length: n }, (_, i) => have.get(i) ?? { keys: [i], labels: [keyText(dims[0], i, display, schema)], values: { ...zero }, n: 0 });
  }

  return {
    dims: resultDims,
    measures: resultMeasures,
    rows: outRows,
    totals: values(totalsRow),
    total_n: Number(totalsRow.n ?? 0),
    truncated,
  };
}

/** The dates [from, to] (inclusive) of a definition's time scope, for bucket boundaries. */
function timeDates(spec: ReportSpec, o: CoreOptions): { from: string; to: string } | null {
  const t = spec.time;
  if (!t) return null;
  if (t.window) {
    const d = windowDates(t.window, o.now, o.tz);
    return { from: d.from, to: addDays(d.to, -1) };
  }
  if (t.from && t.to) return { from: t.from, to: t.to };
  return null;
}

/** SQL of a group key (array dimensions add a lateral join). */
function keyExpr(p: DimPlan, e: string, i: number, params: unknown[], joins: string[], o: CoreOptions): string {
  const tz = () => {
    params.push(o.tz);
    return `$${params.length}::text`;
  };
  switch (p.kind) {
    case "array":
      joins.push(`left join lateral jsonb_array_elements_text(case when jsonb_typeof(${e}) = 'array' then ${e} else '[]'::jsonb end) g${i}(v) on true`);
      return `g${i}.v`;
    case "bucket": {
      const starts = p.starts ?? [];
      if (!starts.length) return "null::int";
      if (p.field.type === "date") {
        params.push(pgArray(starts));
        return `width_bucket(${e}, $${params.length}::date[])`;
      }
      params.push(pgArray(starts.map((s) => new Date(zonedMidnight(s, o.tz)).toISOString())));
      return `width_bucket(${e}, $${params.length}::timestamptz[])`;
    }
    case "hour":
      return `to_char(date_trunc('hour', ${e} at time zone ${tz()}), 'YYYY-MM-DD"T"HH24')`;
    case "weekday":
      return p.field.type === "date" ? `((extract(dow from ${e})::int + 1) % 7)` : `((extract(dow from (${e} at time zone ${tz()}))::int + 1) % 7)`;
    case "hod":
      return `extract(hour from (${e} at time zone ${tz()}))::int`;
    case "range":
      params.push(pgArray(p.dim.ranges!));
      return `width_bucket((${e})::numeric, $${params.length}::numeric[])`;
    case "age": {
      params.push(pgArray(p.dim.ranges!));
      const bounds = `$${params.length}::numeric[]`;
      if (p.field.type === "date") {
        params.push(localDate(o.now, o.tz));
        return `width_bucket(($${params.length}::date - ${e})::numeric, ${bounds})`;
      }
      params.push(new Date(o.now).toISOString());
      return `width_bucket((extract(epoch from ($${params.length}::timestamptz - ${e})) / 86400)::numeric, ${bounds})`;
    }
    default:
      return e;
  }
}

/** SQL of one measure (numbers out as float8; durations in seconds; percentages 0–100). */
function measureSql(mp: MeasurePlan, expr: (path: string) => string, params: unknown[], def: TableDef, env: CoreOptions["env"], sqlOpts: Parameters<typeof toSql>[5]): string {
  const m = mp.m;
  const cond = mp.filter ? toSql(mp.filter, def, "t", params, env, sqlOpts) : null;
  const where = cond ? ` filter (where ${cond})` : "";
  if (m.fn === "ratio") return `(100.0 * count(*) filter (where ${cond ?? "true"}) / nullif(count(*), 0))::float8`;
  if (m.fn === "count") return m.field ? `count(${expr(m.field)})${where}::int` : `count(*)${where}::int`;
  const e = expr(m.field!);
  if (m.fn === "count_distinct") return `count(distinct ${e})${where}::int`;
  let v = e;
  if (m.from) {
    const f = expr(m.from);
    v = mp.field?.type === "date" ? `((${e} - ${f}) * 86400)` : `extract(epoch from (${e} - ${f}))`;
  } else if (mp.field && isDateField(mp.field)) {
    // min / max of dates: epoch milliseconds
    v = mp.field.type === "date" ? `(extract(epoch from ${e}::timestamp) * 1000)` : `(extract(epoch from ${e}) * 1000)`;
  }
  switch (m.fn) {
    case "sum":
      return `sum(${v})${where}::float8`;
    case "avg":
      return `avg(${v})${where}::float8`;
    case "min":
      return `min(${v})${where}::float8`;
    case "max":
      return `max(${v})${where}::float8`;
    default: {
      const q = m.fn === "median" ? "0.5" : m.fn === "p90" ? "0.9" : "0.95";
      return `percentile_cont(${q}) within group (order by ${v})${where}::float8`;
    }
  }
}

/** A group key as the result carries it: bucket keys for dates (1405-01…), numbers for ordinals, ids and values. */
function keyOut(p: DimPlan, v: unknown): KeyValue {
  if (v === null || v === undefined) return null;
  if (p.kind === "bucket") {
    const i = Number(v);
    const start = p.starts?.[i - 1] ?? (i <= 0 ? p.starts?.[0] : p.starts?.[p.starts.length - 1]);
    return start ? bucketKey(start, p.unit!) : null;
  }
  if (p.kind === "weekday" || p.kind === "hod" || p.kind === "range" || p.kind === "age") return Number(v);
  if (p.field.type === "bool") return v === true || v === "true" || v === "t";
  if (FIELD_TYPES[p.field.type]?.numeric) return Number(v);
  return String(v);
}

function keyText(p: DimPlan, v: KeyValue, display: Record<string, string>, schema: OrgSchema): string {
  if (v === null || v === undefined || v === "") return "(خالی)";
  switch (p.kind) {
    case "bucket": {
      const start = p.starts?.find((s) => bucketKey(s, p.unit!) === v) ?? unitStart(String(v), p.unit!);
      return bucketLabel(start, p.unit!);
    }
    case "hour": {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})$/.exec(String(v));
      return m ? `${formatJalali(m[1])} ${hourLabel(Number(m[2]))}` : String(v);
    }
    case "weekday":
      return weekdayLabel(Number(v));
    case "hod":
      return hourLabel(Number(v));
    case "range":
      return rangeLabel(p.dim.ranges!, Number(v), p.field.type === "duration" ? "duration" : "number");
    case "age":
      return rangeLabel(p.dim.ranges!, Number(v), "days");
  }
  if (FIELD_TYPES[p.field.type]?.family === "ref") return display[String(v)] ?? "(محدود)";
  if (p.field.type === "bool") return v ? "بله" : "خیر";
  if (FIELD_TYPES[p.field.type]?.numeric && typeof v === "number") return p.field.type === "duration" ? `${formatNumber(v / 3600, { dp: 1 })} ساعت` : formatNumber(v);
  return labelOf(p.field.type === "multichoice" ? { ...p.field, type: "choice" } : p.field, v, schema) || String(v);
}

/** Is this error one a widget shows as «در دسترس شما نیست» (no access to a table or a field)? */
export const isRestricted = (e: unknown): e is AppError => e instanceof AppError && (e.status === 403 || e.status === 404);

/** Dates of the last `days` days for tests and seeds. */
export const daysAgo = (days: number, now = Date.now()) => new Date(now - days * DAY).toISOString();

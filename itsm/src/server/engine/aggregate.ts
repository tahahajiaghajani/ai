// Aggregates in SQL over the records the caller may read: group by fields (choices, references, members, booleans,
// numbers, short texts; array fields count each element), by dot-walked fields, or by date buckets on the Jalali
// calendar (day, week from Saturday, month, quarter, year — in the organisation's time zone); metrics count, sum,
// avg, min, max, median and p90. Bucket boundaries are computed once in JS (jalali-buckets.ts) and handed to
// `width_bucket`, so SQL and the UI agree on every boundary.
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import type { Cond } from "@shared/model/conditions";
import { bucketKey, bucketLabel, bucketStarts, DATE_UNITS, localDate, zonedMidnight, type DateUnit } from "@shared/model/jalali-buckets";
import type { Ctx } from "../context";
import { pgArray } from "../db";
import { bad, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { condEnv } from "./env";
import { defFor, type OrgSchema } from "./schema";
import { pathExpr, readable, searchSql, toSql } from "./sql";
import { archivable, archiveTableOf } from "./ddl";
import { canOpenRecords, pathVisible } from "./read";
import { RefSet, resolveDisplay, labelOf } from "./display";
import { checkFilter } from "./records";

export type MetricFn = "count" | "sum" | "avg" | "min" | "max" | "median" | "p90";
export const METRIC_FNS: MetricFn[] = ["count", "sum", "avg", "min", "max", "median", "p90"];

export interface GroupBy {
  field: string;
  /** date/datetime fields: the bucket (default day) */
  bucket?: DateUnit;
}

export interface AggregateParams {
  filter?: Cond | null;
  q?: string;
  groupBy?: (string | GroupBy)[];
  metrics?: { fn: MetricFn; field?: string }[];
  /** at most this many groups (default 500, at most 5000) */
  limit?: number;
  /** server-side only: one more SQL condition on the row alias (see ListParams.where) */
  where?: ((alias: string, params: unknown[]) => string) | null;
  /** count the table's archive (old closed records, engine/archive.ts) instead of the hot table */
  archived?: boolean;
}

export interface AggregateResult {
  groups: { field: string; label: string; bucket?: DateUnit }[];
  /** one row per group: its keys (bucket keys for dates: 1405-01, 1405-Q1…), their labels and the metrics */
  rows: { keys: unknown[]; labels: string[]; values: Record<string, string | number | null> }[];
  /** the metrics over every matching record (array groupings do not count a record twice here) */
  totals: Record<string, string | number | null>;
  display: Record<string, string>;
}

const metricKey = (m: { fn: MetricFn; field?: string }) => (m.fn === "count" && !m.field ? "count" : `${m.fn}:${m.field}`);

interface Key {
  path: string;
  field: FieldDef;
  def: TableDef;
  expr: string;
  bucket?: DateUnit;
  starts?: string[];
  array?: boolean;
}

const UNGROUPABLE = new Set(["text", "markdown", "json", "conditions", "secret"]);

export async function aggregate(ctx: Ctx, table: string, p: AggregateParams): Promise<AggregateResult> {
  const { def, schema } = await defFor(ctx, table);
  // a participant with a grant of its own counts the rows it takes part in (the read rule below is that grant alone)
  if (def.virtual || !(await canOpenRecords(ctx, def))) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const env = await condEnv(ctx);
  const filter = checkFilter(ctx, def, schema, p.filter);
  const groupBy = (p.groupBy ?? []).map((g) => (typeof g === "string" ? { field: g } : g));
  if (groupBy.length > 3) throw bad("حداکثر سه گروه‌بندی");
  const metrics = p.metrics?.length ? p.metrics : [{ fn: "count" as MetricFn }];
  if (metrics.length > 10) throw bad("حداکثر ده سنجه");
  const limit = Math.min(Math.max(Math.trunc(p.limit ?? 500) || 500, 1), 5000);
  // the archive has the same columns and the same read rule
  const from = p.archived && archivable(def) ? archiveTableOf(def) : def.table;

  // every statement builds its own parameter list (a statement must use exactly the parameters it is given)
  const visible = access().visibleFields(ctx, def);
  const whereOf = (params: unknown[]) => {
    const where = [readable(ctx, def, "t", params, env)];
    if (filter) where.push(toSql(filter, def, "t", params, env, { ctx, lookup: schema.lookup, filter: true }));
    if (typeof p.where === "function") where.push(p.where("t", params));
    if (p.q) {
      const s = searchSql(def, "t", p.q, params, (f) => !visible || visible.has(f.name));
      if (s) where.push(s);
    }
    return where.map((w) => `(${w})`).join(" and ");
  };
  const expr = (path: string, params: unknown[]) => pathExpr(def, path, "t", params, env, { ctx, lookup: schema.lookup });

  // metrics (checked once; their SQL is built per statement)
  for (const m of metrics) {
    if (!METRIC_FNS.includes(m.fn)) throw bad(`سنجهٔ «${String(m.fn)}» شناخته نیست`);
    if (m.fn === "count" && !m.field) continue;
    if (!m.field || !pathVisible(ctx, def, m.field, schema)) throw bad(`فیلد «${m.field ?? ""}» برای سنجه در دسترس نیست`);
    const x = expr(m.field, []);
    const dated = x.field.type === "date" || x.field.type === "datetime";
    if (m.fn !== "count" && !FIELD_TYPES[x.field.type].numeric && !(dated && (m.fn === "min" || m.fn === "max"))) throw bad(`«${x.field.label}» عددی نیست`);
  }
  const metricsOf = (params: unknown[]) =>
    metrics.map((m) => {
      const key = metricKey(m);
      if (m.fn === "count" && !m.field) return `count(*)::int as "count"`;
      const x = expr(m.field!, params);
      const dated = x.field.type === "date" || x.field.type === "datetime";
      if (m.fn === "count") return `count(${x.expr})::int as "${key}"`;
      if (m.fn === "sum") return `sum(${x.expr})::numeric::text as "${key}"`;
      if (m.fn === "avg") return `round(avg(${x.expr})::numeric, 6)::text as "${key}"`;
      if (m.fn === "min" || m.fn === "max") return `${m.fn}(${x.expr})${dated ? "" : "::numeric::text"} as "${key}"`;
      return `percentile_cont(${m.fn === "median" ? "0.5" : "0.9"}) within group (order by ${x.expr})::numeric::text as "${key}"`;
    });

  // group keys
  const keys: Key[] = [];
  for (const g of groupBy) {
    if (!pathVisible(ctx, def, g.field, schema)) throw bad(`گروه‌بندی بر پایهٔ «${g.field}» ممکن نیست`);
    const x = expr(g.field, []);
    if (UNGROUPABLE.has(x.field.type)) throw bad(`گروه‌بندی بر پایهٔ «${x.field.label}» ممکن نیست`);
    const k: Key = { path: g.field, field: x.field, def: x.def, expr: "" };
    if (x.field.type === "date" || x.field.type === "datetime") {
      k.bucket = g.bucket && g.bucket in DATE_UNITS ? g.bucket : "day";
    } else if (g.bucket) throw bad(`«${x.field.label}» تاریخ نیست`);
    if (FIELD_TYPES[x.field.type].array) k.array = true;
    keys.push(k);
  }

  // bucket thresholds from the data's range
  const tz = env.tz || "Asia/Tehran";
  for (const k of keys.filter((x) => x.bucket)) {
    const dated = k.field.type === "date";
    const params: unknown[] = [];
    const whereSql = whereOf(params);
    const e = expr(k.path, params).expr;
    const r = await ctx.db.one<{ lo: string | number | null; hi: string | number | null }>(
      dated
        ? `select min(${e})::text as lo, max(${e})::text as hi from ${from} t where ${whereSql}`
        : `select (extract(epoch from min(${e})) * 1000)::bigint as lo, (extract(epoch from max(${e})) * 1000)::bigint as hi from ${from} t where ${whereSql}`,
      params,
    );
    if (r?.lo === null || r?.lo === undefined || r.hi === null || r.hi === undefined) {
      k.starts = [];
      continue;
    }
    const day = (v: string | number) => (dated ? String(v).slice(0, 10) : localDate(Number(v), tz));
    k.starts = bucketStarts(day(r.lo), day(r.hi), k.bucket!);
  }

  const params: unknown[] = [];
  const whereSql = whereOf(params);
  const joins: string[] = [];
  const selects: string[] = [];
  keys.forEach((k, i) => {
    k.expr = expr(k.path, params).expr;
    if (k.array) {
      joins.push(`left join lateral jsonb_array_elements_text(case when jsonb_typeof(${k.expr}) = 'array' then ${k.expr} else '[]'::jsonb end) g${i}(v) on true`);
      selects.push(`g${i}.v as k${i}`);
    } else if (k.bucket) {
      const starts = k.starts ?? [];
      if (!starts.length) selects.push(`null::int as k${i}`);
      else if (k.field.type === "date") {
        params.push(pgArray(starts));
        selects.push(`width_bucket(${k.expr}, $${params.length}::date[]) as k${i}`);
      } else {
        params.push(pgArray(starts.map((s) => new Date(zonedMidnight(s, tz)).toISOString())));
        selects.push(`width_bucket(${k.expr}, $${params.length}::timestamptz[]) as k${i}`);
      }
    } else selects.push(`${k.expr} as k${i}`);
  });
  const metricSql = metricsOf(params);

  const groupSql = keys.length ? ` group by ${keys.map((_, i) => `k${i}`).join(", ")}` : "";
  const firstMetric = metricKey(metrics[0]);
  const order = keys.length
    ? keys.some((k) => k.bucket)
      ? keys.map((k, i) => `k${i} ${k.bucket ? "asc" : ""} nulls last`).join(", ")
      : `"${firstMetric}" desc nulls last, ${keys.map((_, i) => `k${i} nulls last`).join(", ")}`
    : "1";
  const rows = keys.length
    ? await ctx.db.query<Record<string, unknown>>(
      `select ${[...selects, ...metricSql].join(", ")} from ${from} t ${joins.join(" ")} where ${whereSql}${groupSql} order by ${order} limit ${limit}`,
      params,
    )
    : [];
  const totalParams: unknown[] = [];
  const totalWhere = whereOf(totalParams);
  const totalsRow = await ctx.db.one<Record<string, unknown>>(`select ${metricsOf(totalParams).join(", ")} from ${from} t where ${totalWhere}`, totalParams);

  const metricKeys = metrics.map(metricKey);
  const refs = new RefSet();
  const out: AggregateResult["rows"] = rows.map((r) => {
    const keysOut: unknown[] = [];
    keys.forEach((k, i) => {
      let v = r[`k${i}`] ?? null;
      if (k.bucket && v !== null) {
        const start = k.starts?.[Number(v) - 1] ?? k.starts?.[k.starts.length - 1];
        v = start ? bucketKey(start, k.bucket) : null;
      }
      if (!k.bucket && FIELD_TYPES[k.field.type].family === "ref") refs.add(refTarget(k.field, k.def.key), v);
      keysOut.push(v);
    });
    const values: Record<string, string | number | null> = {};
    for (const mk of metricKeys) values[mk] = (r[mk] as string | number | null) ?? null;
    return { keys: keysOut, labels: [], values };
  });
  const display = await resolveDisplay(ctx.db, ctx, env, schema, refs);
  for (const row of out) {
    row.labels = keys.map((k, i) => keyLabel(k, row.keys[i], display, schema));
  }
  const totals: Record<string, string | number | null> = {};
  for (const mk of metricKeys) totals[mk] = (totalsRow?.[mk] as string | number | null) ?? null;
  return {
    groups: keys.map((k) => ({ field: k.path, label: k.field.label, ...(k.bucket ? { bucket: k.bucket } : {}) })),
    rows: out,
    totals,
    display,
  };
}

function keyLabel(k: Key, v: unknown, display: Record<string, string>, schema: OrgSchema): string {
  if (v === null || v === undefined || v === "") return "(خالی)";
  if (k.bucket) {
    const start = k.starts?.find((s) => bucketKey(s, k.bucket!) === v);
    return start ? bucketLabel(start, k.bucket) : String(v);
  }
  if (FIELD_TYPES[k.field.type].family === "ref") return display[String(v)] ?? "(محدود)";
  return labelOf(k.field.type === "multichoice" ? { ...k.field, type: "choice" } : k.field, v, schema) || String(v);
}

// The incident dashboard (catalogue INC-082 and the KPIs of «Module: incident»): open work by priority and state,
// created vs resolved, MTTA and MTTR (median, p90 by priority), reopen and first-time-resolution rates, reassignment
// and ping-pong, backlog ageing, SLA compliance and what is at risk, major incidents, channels and categories.
// Every number comes from the engine's aggregates with the caller's context, so a person sees the figures of the
// incidents they may read — never more. Durations are seconds.
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import { aggregate, type AggregateResult } from "../../engine";
import type { Bucket, IncidentDashboard } from "@shared/incident/api";

export type { Bucket, IncidentDashboard };


const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const count = (r: AggregateResult | null): number => num(r?.totals.count) ?? 0;
const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const buckets = (r: AggregateResult | null): Bucket[] => (r?.rows ?? []).map((x) => ({ key: String(x.keys[0] ?? ""), label: x.labels[0] ?? "", count: num(x.values.count) ?? 0 }));
const DAY = 86_400_000;

/** The dashboard over the last `days` days (7–365). */
export async function incidentDashboard(ctx: Ctx, days = 30): Promise<IncidentDashboard> {
  const d = Math.max(7, Math.min(365, Math.floor(days)));
  const now = Date.now();
  const from = new Date(now - d * DAY).toISOString();
  const agg = (filter: Cond | null, groupBy: Parameters<typeof aggregate>[2]["groupBy"] = [], metrics: Parameters<typeof aggregate>[2]["metrics"] = [{ fn: "count" }], limit?: number) =>
    aggregate(ctx, "incident", { filter, groupBy, metrics, limit });
  const open: Cond = { f: "active", op: "eq", v: true };
  const created: Cond = { f: "opened_at", op: "gte", v: from };
  const resolved: Cond = { and: [{ f: "resolved_at", op: "gte", v: from }, { f: "state", op: "in", v: ["resolved", "closed"] }] };
  const bucket = d <= 31 ? "day" : d <= 120 ? "week" : "month";
  const ages: [string, string, number, number | null][] = [
    ["0-1", "کمتر از یک روز", 0, 1],
    ["1-3", "۱ تا ۳ روز", 1, 3],
    ["3-7", "۳ تا ۷ روز", 3, 7],
    ["7-30", "۷ تا ۳۰ روز", 7, 30],
    ["30+", "بیش از ۳۰ روز", 30, null],
  ];
  const ageCond = (lo: number, hi: number | null): Cond => ({
    and: [open, { f: "opened_at", op: "lte", v: new Date(now - lo * DAY).toISOString() }, ...(hi === null ? [] : [{ f: "opened_at", op: "gt" as const, v: new Date(now - hi * DAY).toISOString() }])],
  });

  const [byPriority, byState, unassigned, major, createdTrend, resolvedTrend, mtta, mttr, mttrByPriority, reopened, firstTime, reassign, pingPong, withKe, withTemplate, majors, channels, categories, atRisk, ...ageing] = await Promise.all([
    agg(open, ["priority"]),
    agg(open, ["state"]),
    agg({ and: [open, { f: "assigned_to", op: "empty" }] }),
    agg({ and: [open, { f: "major_state", op: "eq", v: "accepted" }] }),
    agg(created, [{ field: "opened_at", bucket }], [{ fn: "count" }], 400),
    agg(resolved, [{ field: "resolved_at", bucket }], [{ fn: "count" }], 400),
    agg({ f: "accepted_at", op: "gte", v: from }, [], [{ fn: "count" }, { fn: "median", field: "time_to_accept" }]),
    agg(resolved, [], [{ fn: "count" }, { fn: "median", field: "time_to_resolve" }, { fn: "p90", field: "time_to_resolve" }]),
    agg(resolved, ["priority"], [{ fn: "count" }, { fn: "median", field: "time_to_resolve" }, { fn: "p90", field: "time_to_resolve" }]),
    agg({ and: [resolved, { f: "reopen_count", op: "gt", v: 0 }] }),
    agg({ and: [resolved, { f: "reopen_count", op: "eq", v: 0 }, { f: "reassignment_count", op: "eq", v: 0 }] }),
    agg(resolved, [], [{ fn: "count" }, { fn: "avg", field: "reassignment_count" }]),
    agg({ and: [resolved, { f: "reassignment_count", op: "gt", v: 2 }] }),
    agg({ and: [resolved, { f: "known_error_id", op: "nempty" }] }),
    agg({ and: [created, { f: "template_id", op: "nempty" }] }),
    agg({ f: "mi_declared_at", op: "gte", v: from }, [], [{ fn: "count" }, { fn: "median", field: "time_to_resolve" }]),
    agg(created, ["channel"]),
    agg(created, ["category"], [{ fn: "count" }], 8),
    agg({ and: [open, { f: "sla_due", op: "between", v: [new Date(now).toISOString(), new Date(now + 2 * 3600_000).toISOString()] }] }),
    ...ages.map(([, , lo, hi]) => agg(ageCond(lo, hi))),
  ]);

  const trend = new Map<string, { key: string; label: string; created: number; resolved: number }>();
  for (const r of createdTrend.rows) trend.set(String(r.keys[0]), { key: String(r.keys[0]), label: r.labels[0] ?? "", created: num(r.values.count) ?? 0, resolved: 0 });
  for (const r of resolvedTrend.rows) {
    const k = String(r.keys[0]);
    const t = trend.get(k) ?? { key: k, label: r.labels[0] ?? "", created: 0, resolved: 0 };
    t.resolved = num(r.values.count) ?? 0;
    trend.set(k, t);
  }

  const resolvedCount = count(mttr);
  const sla = await slaFigures(ctx, from, count(atRisk));
  const reviews = await aggregate(ctx, "incident_review", { filter: { f: "published_at", op: "gte", v: from }, metrics: [{ fn: "count" }] }).catch(() => null);

  return {
    days: d,
    from,
    open: { total: count(byState), unassigned: count(unassigned), major: count(major), by_priority: buckets(byPriority), by_state: buckets(byState) },
    flow: { created: count(createdTrend), resolved: resolvedCount, trend: [...trend.values()].sort((a, b) => (a.key < b.key ? -1 : 1)) },
    times: {
      mtta_median: num(mtta.totals["median:time_to_accept"]),
      mttr_median: num(mttr.totals["median:time_to_resolve"]),
      mttr_p90: num(mttr.totals["p90:time_to_resolve"]),
      by_priority: mttrByPriority.rows.map((r) => ({ key: String(r.keys[0] ?? ""), label: r.labels[0] ?? "", count: num(r.values.count) ?? 0, median: num(r.values["median:time_to_resolve"]), p90: num(r.values["p90:time_to_resolve"]) })),
    },
    quality: {
      reopen_rate: ratio(count(reopened), resolvedCount),
      first_time_rate: ratio(count(firstTime), resolvedCount),
      reassign_avg: num(reassign.totals["avg:reassignment_count"]),
      ping_pong_rate: ratio(count(pingPong), resolvedCount),
      known_error_rate: ratio(count(withKe), resolvedCount),
      template_rate: ratio(count(withTemplate), count(createdTrend)),
    },
    ageing: ages.map(([key, label], i) => ({ key, label, count: count(ageing[i]) })),
    sla,
    major: { declared: count(majors), mttr_median: num(majors.totals["median:time_to_resolve"]), reviews: count(reviews) },
    channels: buckets(channels),
    categories: buckets(categories),
  };
}

/** Met and breached incident SLA timers stopped in the window (null when the caller may not read timers). */
async function slaFigures(ctx: Ctx, from: string, atRisk: number): Promise<IncidentDashboard["sla"]> {
  const r = await aggregate(ctx, "task_sla", {
    filter: { and: [{ f: "table_key", op: "eq", v: "incident" }, { f: "stage", op: "in", v: ["achieved", "breached"] }, { f: "stop_at", op: "gte", v: from }] },
    groupBy: ["breached"],
    metrics: [{ fn: "count" }],
  }).catch(() => null);
  if (!r) return null;
  let met = 0;
  let breached = 0;
  for (const x of r.rows) {
    if (x.keys[0] === true || x.keys[0] === "true") breached += num(x.values.count) ?? 0;
    else met += num(x.values.count) ?? 0;
  }
  return { met, breached, compliance: ratio(met, met + breached), at_risk: atRisk };
}

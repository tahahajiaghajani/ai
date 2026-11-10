// The change dashboard (catalogue CHG-075, CHG-057 trend reviews, CHG-028 risk calibration by band): every number is
// computed here (SQL aggregates through the engine, with the caller's access — records they may not read are not
// counted); the screens and the AI layer only present them.
import { IMPLEMENTED_CODES } from "@shared/tables/change";
import type { Ctx } from "../../context";
import { aggregate, list } from "../../engine";
import { iso, type Row } from "./common";

const DAY = 86_400_000;
const pct = (a: number, b: number): number | null => (b ? Math.round((1000 * a) / b) / 10 : null);

async function counts(ctx: Ctx, filter: Row, groupBy: string): Promise<Record<string, number>> {
  const r = await aggregate(ctx, "change_request", { filter: filter as never, groupBy: [groupBy], metrics: [{ fn: "count" }] });
  return Object.fromEntries(r.rows.map((x) => [String(x.keys[0] ?? ""), Number(x.values.count ?? 0)]));
}

export interface ChangeDashboard {
  period_days: number;
  open_by_state: Record<string, number>;
  by_type: Record<string, number>;
  outcomes: Record<string, number>;
  kpis: Record<string, number | null>;
  trend: { key: string; label: string; values: Record<string, number> }[];
  risk_bands: { risk: string; implemented: number; failed: number; failure_rate: number | null }[];
  backlog: Row[];
  upcoming: Row[];
  scores: Row[];
  display: Record<string, string>;
}

/** KPIs of the last `days` days and the current state of the pipeline. */
export async function changeDashboard(ctx: Ctx, opts: { days?: number } = {}): Promise<ChangeDashboard> {
  const days = Math.max(7, Math.min(730, opts.days ?? 90));
  const since = iso(Date.now() - days * DAY);
  const opened = { f: "opened_at", op: "gte", v: since };
  const implemented = { and: [{ f: "close_code", op: "in", v: IMPLEMENTED_CODES }, { f: "actual_end", op: "gte", v: since }] };

  const open_by_state = await counts(ctx, { f: "active", op: "eq", v: true }, "state");
  const by_type = await counts(ctx, opened, "type");
  const outcomes = await counts(ctx, implemented, "close_code");
  const total = Object.values(by_type).reduce((a, b) => a + b, 0);
  const done = Object.values(outcomes).reduce((a, b) => a + b, 0);
  const failed = (outcomes.unsuccessful ?? 0) + (outcomes.backed_out ?? 0);
  const caused = (await aggregate(ctx, "change_request", { filter: { and: [implemented, { f: "incidents_caused", op: "gt", v: 0 }] } as never, metrics: [{ fn: "count" }] })).totals;
  const causedN = Number((caused as Row).count ?? 0);
  const late = (await counts(ctx, { and: [opened, { f: "submitted_at", op: "nempty" }] }, "is_late"));
  const submitted = Object.values(late).reduce((a, b) => a + b, 0);
  const inWindow = (await aggregate(ctx, "change_request", { filter: { and: [implemented, { f: "in_blackout", op: "eq", v: false }, { f: "outside_window", op: "eq", v: false }] } as never, metrics: [{ fn: "count" }] })).totals as Row;
  const conflicted = (await aggregate(ctx, "change_request", { filter: { and: [{ f: "state", op: "in", v: ["authorize", "scheduled"] }, { f: "conflict_count", op: "gt", v: 0 }] } as never, metrics: [{ fn: "count" }] })).totals as Row;
  const cycle = await aggregate(ctx, "change_request", { filter: { and: [{ f: "authorized_at", op: "gte", v: since }, { f: "submitted_at", op: "nempty" }, { f: "type", op: "eq", v: "normal" }] } as never, metrics: [{ fn: "count" }] });
  const pirs = await aggregate(ctx, "change_pir", { filter: { f: "created_at", op: "gte", v: since } as never, groupBy: ["state"], metrics: [{ fn: "count" }] });
  const pirBy = Object.fromEntries(pirs.rows.map((x) => [String(x.keys[0] ?? ""), Number(x.values.count ?? 0)]));
  const pirTotal = Object.entries(pirBy).filter(([k]) => k !== "canceled").reduce((a, [, b]) => a + b, 0);

  const kpis: Record<string, number | null> = {
    total,
    implemented: done,
    success_rate: pct((outcomes.successful ?? 0) + (outcomes.successful_issues ?? 0), done),
    failure_rate: pct(failed, done),
    backout_rate: pct(outcomes.backed_out ?? 0, done),
    caused_incident_rate: pct(causedN, done),
    emergency_ratio: pct(by_type.emergency ?? 0, total),
    standard_ratio: pct(by_type.standard ?? 0, total),
    late_rate: pct(late.true ?? 0, submitted),
    schedule_compliance: pct(Number(inWindow.count ?? 0), done),
    unresolved_conflicts: Number(conflicted.count ?? 0),
    authorized_normal: Number((cycle.totals as Row).count ?? 0),
    pir_completion: pct(pirBy.completed ?? 0, pirTotal),
    backlog: (open_by_state.assess ?? 0) + (open_by_state.authorize ?? 0),
  };

  const trendRows = await aggregate(ctx, "change_request", { filter: { f: "opened_at", op: "gte", v: iso(Date.now() - 180 * DAY) } as never, groupBy: [{ field: "opened_at", bucket: "month" }, "type"], metrics: [{ fn: "count" }] });
  const byMonth = new Map<string, { key: string; label: string; values: Record<string, number> }>();
  for (const r of trendRows.rows) {
    const key = String(r.keys[0] ?? "");
    const m = byMonth.get(key) ?? { key, label: String(r.labels?.[0] ?? key), values: {} };
    m.values[String(r.keys[1] ?? "")] = Number(r.values.count ?? 0);
    byMonth.set(key, m);
  }

  const bandRows = await aggregate(ctx, "change_request", { filter: implemented as never, groupBy: ["risk", "close_code"], metrics: [{ fn: "count" }] });
  const bands = new Map<string, { implemented: number; failed: number }>();
  for (const r of bandRows.rows) {
    const risk = String(r.keys[0] ?? "");
    const b = bands.get(risk) ?? { implemented: 0, failed: 0 };
    const n = Number(r.values.count ?? 0);
    b.implemented += n;
    if (r.keys[1] === "unsuccessful" || r.keys[1] === "backed_out") b.failed += n;
    bands.set(risk, b);
  }

  const backlog = await list(ctx, "change_request", {
    filter: { f: "state", op: "in", v: ["assess", "authorize"] } as never, sort: "submitted_at", size: 10, total: false,
    fields: ["number", "short_description", "state", "type", "risk", "submitted_at", "planned_start", "assignment_group_id", "approval"],
  });
  const upcoming = await list(ctx, "change_request", {
    filter: { and: [{ f: "state", op: "in", v: ["scheduled", "implement"] }, { f: "planned_start", op: "lte", v: iso(Date.now() + 7 * DAY) }] } as never, sort: "planned_start", size: 15, total: false,
    fields: ["number", "short_description", "state", "type", "risk", "planned_start", "planned_end", "assigned_to", "conflict_count", "in_blackout"],
  });
  const scores = await list(ctx, "change_success_score", { sort: "-score", size: 20, total: false, fields: ["title", "group_id", "score", "band", "implemented", "failed", "computed_at"] });

  return {
    period_days: days, open_by_state, by_type, outcomes, kpis,
    trend: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)),
    risk_bands: ["low", "moderate", "high", "very_high"].map((risk) => {
      const b = bands.get(risk) ?? { implemented: 0, failed: 0 };
      return { risk, ...b, failure_rate: pct(b.failed, b.implemented) };
    }),
    backlog: backlog.rows, upcoming: upcoming.rows, scores: scores.rows,
    display: { ...backlog.display, ...upcoming.display, ...scores.display },
  };
}

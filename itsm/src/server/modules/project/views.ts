// Read models of the project screens, read with the caller's context:
//   gantt       a project's WBS with dates, dependencies, the critical path, baselines and progress (PRJ-020/022)
//   portfolio   projects by health and state with progress, schedule variance, budget and cost; the demand pipeline
//               (PRJ-007/011/045)
//   demands     the intake board: demands by state, best score first (PRJ-002/003/013)
//   resources   allocated hours per person and week against the weekly capacity (PRJ-037/038)
import { heatMap, weeksFrom } from "@shared/project/logic";
import { DEMAND_STATES } from "@shared/tables/project";
import type { Ctx } from "../../context";
import { get, list, listAll, orgTz } from "../../engine";
import { baselineVariance } from "./schedule";
import { dateOf, projectConfig, sysOf, todayIn, type Row } from "./common";

export async function ganttOf(ctx: Ctx, id: string): Promise<Row> {
  const { row: project, display } = await get(ctx, "project", id);
  const r = await listAll(ctx, "project_task", {
    filter: { f: "project_id", op: "eq", v: id },
    fields: ["number", "wbs", "short_description", "kind", "state", "parent_id", "planned_start", "planned_end", "duration_days", "depends_on", "lag_days", "pct_complete", "is_critical", "float_days", "baseline_start", "baseline_end", "assigned_to", "actual_start", "actual_end"],
    sort: "wbs",
  }, 5_000);
  const tasks: Row[] = r.rows.map((t) => ({ ...t, variance: baselineVariance(t) })).sort((a: Row, b: Row) => wbsKey(String(a.wbs ?? "")).localeCompare(wbsKey(String(b.wbs ?? ""))));
  return { project, tasks, truncated: r.truncated, display: { ...display, ...r.display }, today: todayIn(orgTz(ctx)) };
}

/** «1.10» after «1.9»: each part padded. */
const wbsKey = (w: string) => w.split(".").map((p) => p.padStart(4, "0")).join(".");

export async function portfolioView(ctx: Ctx, input: { portfolio?: string | null }): Promise<Row> {
  const filter = { and: [{ f: "state", op: "nin", v: ["canceled"] }, ...(input.portfolio ? [{ f: "portfolio_id", op: "eq", v: input.portfolio }] : [])] };
  const r = await listAll(ctx, "project", {
    filter: filter as never,
    fields: ["number", "name", "state", "health", "pct_complete", "planned_start", "planned_end", "projected_end", "schedule_variance_days", "project_manager_id", "portfolio_id", "budget", "actual_cost", "priority", "type", "open_risks", "tasks_overdue"],
    sort: "-updated_at",
  }, 5_000);
  const byHealth: Record<string, number> = {};
  const byState: Record<string, number> = {};
  for (const p of r.rows) {
    byHealth[String(p.health ?? "unknown")] = (byHealth[String(p.health ?? "unknown")] ?? 0) + 1;
    byState[String(p.state)] = (byState[String(p.state)] ?? 0) + 1;
  }
  const money = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const budget = r.rows.reduce((s, p) => s + money(p.budget), 0);
  const cost = r.rows.reduce((s, p) => s + money(p.actual_cost), 0);
  const demands = await listAll(ctx, "demand", { filter: { f: "state", op: "in", v: ["submitted", "screening", "qualified", "approved"] }, fields: ["state"] }).catch(() => ({ rows: [] as Row[] }));
  const pipeline: Record<string, number> = {};
  for (const d of demands.rows) pipeline[String(d.state)] = (pipeline[String(d.state)] ?? 0) + 1;
  return {
    projects: r.rows,
    by_health: byHealth,
    by_state: byState,
    // money fields of the financial group come back «(محدود)» or absent for people outside it: sums cover what was readable
    totals: { projects: r.rows.length, budget: String(budget), actual_cost: String(cost), at_risk: (byHealth.amber ?? 0) + (byHealth.red ?? 0) },
    demand_pipeline: pipeline,
    truncated: r.truncated,
    display: r.display,
  };
}

export async function demandBoard(ctx: Ctx): Promise<Row> {
  const r = await list(ctx, "demand", {
    filter: { f: "state", op: "nin", v: ["converted", "rejected"] },
    fields: ["number", "title", "type", "state", "score", "score_wsjf", "score_rice", "score_weighted", "scoring_model", "business_value", "time_criticality", "risk_reduction", "job_size", "submitted_by", "needed_by", "portfolio_id", "sponsor_id"],
    sort: "-score", size: 500, total: false,
  });
  const columns = DEMAND_STATES.states.filter((s) => !["converted", "rejected"].includes(s.value)).map((s) => ({
    state: s.value, label: s.label, color: s.color,
    items: r.rows.filter((d) => d.state === s.value).sort((a, b) => Number(b.score ?? -1) - Number(a.score ?? -1)),
  }));
  return { columns, display: r.display };
}

export async function resourceView(ctx: Ctx, input: { from?: string | null; weeks: number; project?: string | null }): Promise<Row> {
  const cfg = await projectConfig(ctx.db, sysOf(ctx));
  const from = input.from ?? todayIn(orgTz(ctx));
  const weeks = weeksFrom(from, input.weeks);
  const last = weeks[weeks.length - 1];
  const filter = { and: [{ f: "end_date", op: "gte", v: weeks[0] }, { f: "start_date", op: "lte", v: last }, ...(input.project ? [{ f: "project_id", op: "eq", v: input.project }] : [])] };
  const r = await listAll(ctx, "resource_allocation", { filter: filter as never, fields: ["user_id", "project_id", "role", "start_date", "end_date", "hours_per_week", "state"], sort: "-start_date" });
  const rows = heatMap(r.rows.map((a) => ({ user_id: String(a.user_id), start_date: dateOf(a.start_date) ?? "", end_date: dateOf(a.end_date) ?? "", hours_per_week: a.hours_per_week, state: a.state, project_id: a.project_id })), weeks, cfg.capacity);
  return { weeks, capacity: cfg.capacity, people: rows, allocations: r.rows, truncated: r.truncated, display: r.display };
}

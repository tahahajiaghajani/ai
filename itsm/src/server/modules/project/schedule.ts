// The plan of a project kept in step (job `project.recalc`, as the system, no version move on stamped fields):
//   · WBS numbers from the parent tree and the order (PRJ-018)
//   · the critical-path schedule from the project's start (PRJ-019): tasks with a duration get their dates from
//     their finish-to-start predecessors (lag, «not before»), phases span their children, each task's float and
//     whether it is critical; a dependency cycle leaves the dates as they are
//   · roll-ups on the project: progress (duration-weighted), tasks done and overdue, overdue milestones, recorded
//     hours (approved time), open risks above the threshold, the projected end and the schedule variance
//   · the deterministic health (PRJ-031) — a manager's override wins — with its reasons; turning amber or red raises
//     `record.project.at_risk` for the seeded notification rule
// A baseline (PRJ-022) copies today's plan into the baseline fields of the project and every task.
import { PROJECT_RUNNING, PROJECT_TASK_DONE } from "@shared/tables/project";
import { daysBetween, projectHealth, rollupPct, schedule, wbsNumbers, type SchedTask } from "@shared/project/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { emitEvent, orgTz, updateIn } from "../../engine";
import { dateOf, liveRow, liveRows, projectConfig, sysOf, todayIn, type Row } from "./common";

const keep = { trusted: true, keepVersion: true, allowLocked: true } as const;

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Recompute a project's plan and roll-ups inside `tx` (as the system). */
export async function recalcProjectIn(tx: Tx, ctx: Ctx, projectId: string, now = Date.now()): Promise<Row | null> {
  const sys = sysOf(ctx);
  const p = await liveRow(tx, sys, "project", projectId);
  if (!p) return null;
  const tz = orgTz(sys);
  const today = todayIn(tz, now);
  const cfg = await projectConfig(tx, sys);
  const tasks = await liveRows(tx, sys, "project_task", { f: "project_id", op: "eq", v: projectId }, { order: "t.sort_order, t.created_at", limit: 2000 });

  // WBS and schedule
  const wbs = wbsNumbers(tasks.map((t) => ({ id: String(t.id), parent_id: t.parent_id ?? null, sort_order: t.sort_order ?? 0, number: t.number ?? null })));
  const sched = schedule(
    tasks.map((t): SchedTask => ({
      id: String(t.id), parent_id: t.parent_id ?? null, kind: t.kind ?? "task",
      duration: t.kind === "milestone" ? 0 : t.duration_days === null || t.duration_days === undefined ? null : Number(t.duration_days),
      depends_on: Array.isArray(t.depends_on) ? (t.depends_on as string[]) : [], lag: Number(t.lag_days ?? 0) || 0,
      not_before: dateOf(t.start_no_earlier), sort_order: Number(t.sort_order ?? 0), start: dateOf(t.planned_start), end: dateOf(t.planned_end),
    })),
    { start: dateOf(p.planned_start) ?? today },
  );
  for (const t of tasks) {
    const patch: Row = {};
    const n = wbs.get(String(t.id));
    if (n && t.wbs !== n) patch.wbs = n;
    const s = sched.ok ? sched.tasks.get(String(t.id)) : undefined;
    if (s) {
      const dated = t.kind === "milestone" || s.summary || (t.duration_days !== null && t.duration_days !== undefined) || !t.planned_start;
      if (dated && !PROJECT_TASK_DONE.includes(String(t.state))) {
        if (dateOf(t.planned_start) !== s.start) patch.planned_start = s.start;
        if (dateOf(t.planned_end) !== s.end) patch.planned_end = s.end;
      }
      if (t.is_critical !== s.critical) patch.is_critical = s.critical;
      if (Number(t.float_days ?? NaN) !== s.float) patch.float_days = s.float;
    }
    if (Object.keys(patch).length) Object.assign(t, await updateIn(tx, sys, "project_task", String(t.id), patch, keep));
  }

  // roll-ups
  const leaves = tasks.filter((t) => !tasks.some((c) => c.parent_id === t.id));
  const open = leaves.filter((t) => !PROJECT_TASK_DONE.includes(String(t.state)));
  const overdue = open.filter((t) => t.kind !== "milestone" && dateOf(t.planned_end) !== null && dateOf(t.planned_end)! < today);
  const milestonesOverdue = open.filter((t) => t.kind === "milestone" && dateOf(t.planned_end) !== null && dateOf(t.planned_end)! < today);
  const hoursRow = await tx.one<{ h: string | null }>(`select sum(hours) as h from sm_time_entries where org_id = $1 and project_id = $2 and state = 'approved' and deleted_at is null`, [sys.org.id, projectId]);
  const risks = await liveRows(tx, sys, "raid_item", { and: [{ f: "project_id", op: "eq", v: projectId }, { f: "kind", op: "eq", v: "risk" }, { f: "state", op: "in", v: ["open", "active", "monitoring"] }] });
  const openRisks = risks.filter((r) => Number(r.score ?? 0) >= cfg.red_risk_score).length;
  const pct = rollupPct(leaves.map((t) => ({ state: t.state, pct_complete: t.pct_complete, duration_days: t.duration_days, kind: t.kind })));
  const ends = tasks.map((t) => dateOf(t.planned_end)).filter((x): x is string => !!x).sort();
  const projected = sched.ok && tasks.length ? sched.end : (ends[ends.length - 1] ?? dateOf(p.planned_end));
  const health = projectHealth({
    state: String(p.state), today, planned_start: dateOf(p.planned_start), planned_end: dateOf(p.planned_end), projected_end: projected, pct,
    tasks_overdue: overdue.length, milestones_overdue: milestonesOverdue.length, open_risks: openRisks, last_status_at: p.last_status_at ?? null, budget: p.budget, actual_cost: p.actual_cost,
  }, cfg);
  const effective = p.health_override && PROJECT_RUNNING.includes(String(p.state)) ? String(p.health_override) : health.health;
  const patch: Row = {
    pct_complete: pct, tasks_total: leaves.length, tasks_done: leaves.filter((t) => t.state === "done").length, tasks_overdue: overdue.length, milestones_overdue: milestonesOverdue.length,
    open_risks: openRisks, actual_hours: hoursRow?.h ? String(hoursRow.h) : "0", projected_end: projected ?? null,
    health: effective, health_reasons: health.reasons, schedule_status: health.schedule_status, schedule_variance_days: health.variance_days,
  };
  const changed = Object.entries(patch).filter(([k, v]) => !same(p[k], v) && !(k === "actual_hours" && Number(p[k] ?? 0) === Number(v)));
  if (!changed.length) return p;
  const next = await updateIn(tx, sys, "project", projectId, { ...Object.fromEntries(changed), health_at: new Date(now).toISOString() }, keep);
  // turning amber or red raises the at-risk alert
  if (patch.health !== p.health && ["amber", "red"].includes(String(patch.health)) && PROJECT_RUNNING.includes(String(p.state))) {
    await emitEvent(tx, sys, { kind: "record.project.at_risk", table: "project", id: projectId, number: p.number ?? null, data: { users: [p.project_manager_id, p.sponsor_id].filter(Boolean), health: patch.health, reasons: health.reasons.map((r) => r.label) } });
  }
  return next;
}

/** Copy today's plan into the baselines of the project and its tasks. */
export async function takeBaselineIn(tx: Tx, ctx: Ctx, projectId: string): Promise<{ tasks: number }> {
  const sys = sysOf(ctx);
  const p = await liveRow(tx, sys, "project", projectId);
  if (!p) return { tasks: 0 };
  const tasks = await liveRows(tx, sys, "project_task", { f: "project_id", op: "eq", v: projectId }, { limit: 2000 });
  for (const t of tasks) await updateIn(tx, sys, "project_task", String(t.id), { baseline_start: dateOf(t.planned_start), baseline_end: dateOf(t.planned_end) }, keep);
  await updateIn(tx, sys, "project", projectId, { baseline_start: dateOf(p.planned_start), baseline_end: dateOf(p.projected_end) ?? dateOf(p.planned_end), baseline_taken_at: new Date().toISOString() }, { trusted: true });
  return { tasks: tasks.length };
}

/** Variance of each task against its baseline (days; positive = later). */
export function baselineVariance(t: Row): { start: number | null; end: number | null } {
  const bs = dateOf(t.baseline_start);
  const be = dateOf(t.baseline_end);
  const s = dateOf(t.planned_start);
  const e = dateOf(t.planned_end);
  return { start: bs && s ? daysBetween(bs, s) : null, end: be && e ? daysBetween(be, e) : null };
}

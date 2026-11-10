// Operations of project and portfolio management that the generic API cannot express (each with the caller's
// context: access, field locks and guards apply):
//   convertDemand    an approved (or qualified) demand becomes a project (PRJ-002/017): its title, sponsor, portfolio,
//                    problem and objectives, estimates and budget; the link «تبدیل‌شده از»; the demand «تبدیل‌شده»
//   projectFrom      a project from an ITSM record (a problem, a change, a request…: «برخاسته از», PRJ-017/032)
//   copyProject      a project from another one as a template (PRJ-016): its WBS with durations, dependencies and
//                    milestones, shifted to a new start
//   baseline         today's plan as the baseline (PRJ-022)
//   draftStatus      a status report drafted from the plan (PRJ-030/046): the metrics, what was done and what is next,
//                    the open risks and issues — AI writes the narrative when it can (project.status_summary)
import { addDaysIso } from "@shared/project/logic";
import type { Ctx } from "../../context";
import { addLinkIn, createIn, defFor, get, list, orgTz, transitionIn, updateIn } from "../../engine";
import { access } from "../../access/provider";
import { bad, conflict, forbidden } from "../../http/errors";
import { runSkill } from "../ai/skills/runtime";
import { noAi } from "../release/ai";
import { takeBaselineIn, recalcProjectIn } from "./schedule";
import { dateOf, ids, isUuid, liveRow, liveRows, managesProjects, sysOf, todayIn, type Row } from "./common";

/** An approved or qualified demand becomes a project. */
export async function convertDemand(ctx: Ctx, demandId: string, input: { name?: string; project_manager_id?: string | null; planned_start?: string | null; planned_end?: string | null }): Promise<Row> {
  const { row: d } = await get(ctx, "demand", demandId);
  if (!["approved", "qualified"].includes(String(d.state))) throw conflict("فقط تقاضای تصویب‌شده یا واجد شرایط به پروژه تبدیل می‌شود");
  if (!(await managesProjects(ctx.db, ctx))) throw forbidden("تبدیل تقاضا به پروژه با مدیر پروژه‌ها است");
  const created = await ctx.write(async (tx) => {
    const project = await createIn(tx, ctx, "project", {
      name: (input.name ?? d.title ?? "پروژهٔ تازه").slice(0, 200),
      type: d.type === "new_service" ? "improvement" : "application",
      sponsor_id: d.sponsor_id ?? d.business_owner_id ?? null,
      portfolio_id: d.portfolio_id ?? null,
      org_unit_id: d.org_unit_id ?? null,
      project_manager_id: input.project_manager_id ?? ctx.user.id,
      description: [d.problem, d.benefits].filter(Boolean).join("\n\n") || null,
      objectives: d.objectives ?? null,
      est_hours: d.est_hours ?? null,
      budget: d.est_capex ?? null,
      planned_start: input.planned_start ?? null,
      planned_end: input.planned_end ?? dateOf(d.needed_by),
    });
    await updateIn(tx, sysOf(ctx), "project", String(project.id), { demand_id: demandId }, { trusted: true, keepVersion: true });
    await addLinkIn(tx, sysOf(ctx), "project", String(project.id), { kind: "converted_from", table: "demand", id: demandId });
    if (d.state === "qualified") await transitionIn(tx, sysOf(ctx), "demand", demandId, "approved", {}, { trusted: true });
    await transitionIn(tx, sysOf(ctx, ctx.user.id), "demand", demandId, "converted", { decision_notes: d.decision_notes || "به پروژه تبدیل شد" }, { trusted: true });
    await updateIn(tx, sysOf(ctx), "demand", demandId, { converted_project_id: project.id }, { trusted: true, keepVersion: true, allowLocked: true });
    return project;
  });
  return (await get(ctx, "project", String(created.id))).row;
}

/** Tables a project may start from (the record is linked «برخاسته از»). */
export const PROJECT_ORIGINS = ["problem", "change_request", "request_item", "incident", "known_error", "demand", "release"];

export async function projectFrom(ctx: Ctx, table: string, id: string, input: { name?: string }): Promise<Row> {
  if (!PROJECT_ORIGINS.includes(table)) throw bad("از این نوع رکورد نمی‌توان پروژه ساخت");
  const { row: src } = await get(ctx, table, id);
  const title = String(src.short_description ?? src.title ?? src.name ?? "").slice(0, 160);
  const created = await ctx.write(async (tx) => {
    const project = await createIn(tx, ctx, "project", {
      name: (input.name ?? (title ? `پروژه: ${title}` : "پروژهٔ تازه")).slice(0, 200),
      description: [`برخاسته از ${src.number ?? ""}.`, typeof src.description === "string" ? src.description : ""].filter(Boolean).join("\n\n"),
      ...(isUuid(src.assignment_group_id) ? { assignment_group_id: src.assignment_group_id } : {}),
    });
    await addLinkIn(tx, ctx, "project", String(project.id), { kind: "originated_from", table, id });
    return project;
  });
  return (await get(ctx, "project", String(created.id))).row;
}

/** A new project from another one's plan (dependencies and parents remapped, dates shifted to `start`). */
export async function copyProject(ctx: Ctx, sourceId: string, input: { name: string; planned_start: string }): Promise<Row> {
  const { row: src } = await get(ctx, "project", sourceId);
  const tasks = (await list(ctx, "project_task", { filter: { f: "project_id", op: "eq", v: sourceId }, sort: "wbs", size: 500, total: false })).rows;
  const shift = dateOf(src.planned_start) ? Math.round((Date.parse(`${input.planned_start}T00:00:00Z`) - Date.parse(`${dateOf(src.planned_start)}T00:00:00Z`)) / 86_400_000) : 0;
  const created = await ctx.write(async (tx) => {
    const project = await createIn(tx, ctx, "project", {
      name: input.name.slice(0, 200), type: src.type, methodology: src.methodology, priority: src.priority, portfolio_id: src.portfolio_id ?? null,
      assignment_group_id: src.assignment_group_id ?? null, objectives: src.objectives ?? null, scope_in: src.scope_in ?? null, scope_out: src.scope_out ?? null, assumptions: src.assumptions ?? null,
      planned_start: input.planned_start, planned_end: dateOf(src.planned_end) ? addDaysIso(dateOf(src.planned_end)!, shift) : null, est_hours: src.est_hours ?? null,
    });
    const map = new Map<string, string>();
    // parents first (WBS order), then dependencies once every task exists
    for (const t of tasks) {
      const row = await createIn(tx, ctx, "project_task", {
        project_id: project.id, short_description: t.short_description, kind: t.kind, sort_order: t.sort_order, duration_days: t.duration_days, lag_days: t.lag_days, est_hours: t.est_hours,
        parent_id: t.parent_id && map.has(String(t.parent_id)) ? map.get(String(t.parent_id)) : null,
        planned_start: dateOf(t.planned_start) ? addDaysIso(dateOf(t.planned_start)!, shift) : null, planned_end: dateOf(t.planned_end) ? addDaysIso(dateOf(t.planned_end)!, shift) : null,
        description: t.description ?? null,
      });
      map.set(String(t.id), String(row.id));
    }
    for (const t of tasks) {
      const deps = ids(t.depends_on).map((d) => map.get(d)).filter((x): x is string => !!x);
      if (deps.length) await updateIn(tx, ctx, "project_task", map.get(String(t.id))!, { depends_on: deps });
    }
    return project;
  });
  return (await get(ctx, "project", String(created.id))).row;
}

/** The caller works this project (writes it). */
export async function needProjectWrite(ctx: Ctx, id: string): Promise<Row> {
  const { row } = await get(ctx, "project", id);
  if (row.$writable === false) throw forbidden("اجازهٔ تغییر این پروژه را ندارید");
  const { def } = await defFor(ctx, "project");
  if (!access().canWrite(ctx, def, row)) throw forbidden("اجازهٔ تغییر این پروژه را ندارید");
  return row;
}

export async function baseline(ctx: Ctx, id: string): Promise<{ tasks: number }> {
  await needProjectWrite(ctx, id);
  return ctx.write((tx) => takeBaselineIn(tx, ctx, id));
}

export async function recalcProject(ctx: Ctx, id: string): Promise<Row | null> {
  return ctx.write((tx) => recalcProjectIn(tx, sysOf(ctx), id));
}

// ---------------------------------------------------------------------------------------------------------------
// Status reports

const fa = (n: unknown) => Number(n ?? 0).toLocaleString("fa-IR");
const RAG_FA: Record<string, string> = { green: "سبز", amber: "زرد", red: "قرمز", unknown: "نامعلوم" };

/** The facts of a status report, read with the caller's access. */
export async function statusFacts(ctx: Ctx, id: string): Promise<{ facts: Row; draft: Row }> {
  const { row: p } = await get(ctx, "project", id);
  const tz = orgTz(ctx);
  const today = todayIn(tz);
  const since = addDaysIso(today, -14);
  const until = addDaysIso(today, 14);
  const tasks = (await list(ctx, "project_task", { filter: { f: "project_id", op: "eq", v: id }, fields: ["number", "wbs", "short_description", "kind", "state", "planned_end", "actual_end", "pct_complete", "is_critical"], size: 500, total: false })).rows;
  const done = tasks.filter((t) => t.state === "done" && (dateOf(t.actual_end) ?? "") >= since);
  const next = tasks.filter((t) => !["done", "canceled"].includes(String(t.state)) && (dateOf(t.planned_end) ?? "9999") <= until).slice(0, 15);
  const raid = (await list(ctx, "raid_item", { filter: { and: [{ f: "project_id", op: "eq", v: id }, { f: "state", op: "in", v: ["open", "active", "monitoring"] }] }, fields: ["number", "kind", "title", "score", "due_date"], sort: "-score", size: 30, total: false })).rows;
  const reasons = Array.isArray(p.health_reasons) ? (p.health_reasons as Row[]) : [];
  const facts = {
    پروژه: { نام: p.name, وضعیت: p.state, سلامت: RAG_FA[String(p.health ?? "unknown")], پیشرفت: p.pct_complete ?? 0, پایان_برنامه: p.planned_end ?? null, پایان_پیش‌بینی: p.projected_end ?? null, انحراف_روز: p.schedule_variance_days ?? null },
    دلیل‌های_سلامت: reasons.map((r) => r.label),
    انجام‌شده‌های_دو_هفتهٔ_اخیر: done.map((t) => `${t.wbs ?? ""} ${t.short_description}`.trim()),
    کارهای_دو_هفتهٔ_آینده: next.map((t) => `${t.wbs ?? ""} ${t.short_description}${t.is_critical ? " (مسیر بحرانی)" : ""}`.trim()),
    ریسک‌ها_و_مسئله‌ها: raid.map((r) => ({ شماره: r.number, گونه: r.kind, عنوان: r.title, امتیاز: r.score ?? null })),
  };
  const summary = [
    `وضعیت کلی پروژه «${RAG_FA[String(p.health ?? "unknown")]}» است؛ پیشرفت ${fa(p.pct_complete ?? 0)}٪${p.schedule_variance_days ? ` و پایان پیش‌بینی‌شده ${fa(p.schedule_variance_days)} روز ${Number(p.schedule_variance_days) > 0 ? "دیرتر" : "زودتر"} از برنامه` : ""}.`,
    ...reasons.map((r) => `- ${r.label}`),
  ].join("\n");
  const draft = {
    title: `گزارش وضعیت ${p.name} — ${today}`,
    period_start: since,
    period_end: today,
    overall: p.health && p.health !== "unknown" ? p.health : null,
    schedule_rag: Number(p.schedule_variance_days ?? 0) >= 15 ? "red" : Number(p.schedule_variance_days ?? 0) >= 5 ? "amber" : "green",
    summary,
    achievements: done.length ? done.map((t) => `- ${t.short_description}`).join("\n") : "در این دوره کاری بسته نشد.",
    next_steps: next.length ? next.map((t) => `- ${t.short_description}${dateOf(t.planned_end) ? ` (تا ${dateOf(t.planned_end)})` : ""}`).join("\n") : "کاری برای دو هفتهٔ آینده برنامه‌ریزی نشده است.",
    risks_issues: raid.length ? raid.map((r) => `- ${r.number} ${r.title}${r.score ? ` (امتیاز ${fa(r.score)})` : ""}`).join("\n") : "ریسک یا مسئلهٔ بازی ثبت نشده است.",
  };
  return { facts, draft };
}

/** A status report draft: AI writes the summary when it can, the rest comes from the plan. */
export async function draftStatus(ctx: Ctx, id: string, opts: { save?: boolean } = {}): Promise<{ draft: Row; ai: boolean; report?: Row }> {
  const { draft } = await statusFacts(ctx, id);
  let ai = false;
  try {
    const r = await runSkill(ctx, "project.status_summary", { table: "project", id }, { noFallback: true });
    if ((r.text ?? "").trim()) {
      draft.summary = r.text;
      ai = true;
    }
  } catch (e) {
    if (!noAi(e)) throw e;
  }
  if (!opts.save) return { draft, ai };
  const report = await ctx.write(async (tx) => {
    const row = await createIn(tx, ctx, "status_report", { project_id: id, state: "draft", ...draft });
    return ai ? updateIn(tx, sysOf(ctx), "status_report", String(row.id), { ai_generated: true }, { trusted: true, keepVersion: true }) : row;
  });
  return { draft, ai, report };
}

/** A person's own time on the tasks of a week (the timesheet), as the caller. */
export async function timesheet(ctx: Ctx, input: { from: string; days: number }): Promise<Row> {
  const to = addDaysIso(input.from, input.days - 1);
  const entries = await list(ctx, "time_entry", { filter: { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "entry_date", op: "gte", v: input.from }, { f: "entry_date", op: "lte", v: to }] }, size: 500, total: false, sort: "entry_date" });
  const tasks = await list(ctx, "project_task", { filter: { and: [{ f: "assigned_to", op: "eq", v: ctx.user.id }, { f: "state", op: "in", v: ["open", "in_progress", "blocked"] }] }, fields: ["number", "short_description", "project_id", "planned_end"], size: 200, total: false });
  return { from: input.from, to, entries: entries.rows, tasks: tasks.rows, display: { ...entries.display, ...tasks.display } };
}

/** Recompute the recorded hours of a task and its project from approved time. */
export async function hoursOfTask(sys: Ctx, taskId: string): Promise<void> {
  await sys.write(async (tx) => {
    const task = await liveRow(tx, sys, "project_task", taskId);
    if (!task) return;
    const r = await tx.one<{ h: string | null }>(`select sum(hours) as h from sm_time_entries where org_id = $1 and task_id = $2 and state = 'approved' and deleted_at is null`, [sys.org.id, taskId]);
    const h = r?.h ? String(r.h) : "0";
    if (Number(task.actual_hours ?? 0) !== Number(h)) await updateIn(tx, sys, "project_task", taskId, { actual_hours: h }, { trusted: true, keepVersion: true, allowLocked: true });
    await recalcProjectIn(tx, sys, String(task.project_id));
  });
}

export { liveRows };

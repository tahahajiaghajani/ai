// Hooks of project and portfolio management (same transaction; no model or network calls):
//   demand           WSJF / RICE / weighted scores and the score of the chosen model (PRJ-003)
//   project          dates, the gates of the lifecycle («project_gate», PRJ-005/033): a complete charter before the
//                    approval gate, a plan before execution, every task finished and lessons written before closing;
//                    actual start and end; the copies on its child rows; a recalculation after changes
//   project_task     the project's manager copied, no cycle in the dependencies (PRJ-019), a milestone has no
//                    duration, done means 100 %, actual dates stamped; the plan recalculated
//   raid_item        score = probability × impact
//   status_report    the project's metrics frozen into the report when it is published, the project's last report
//   resource_allocation  dates in order
//   time_entry       the task's project, the label, approval by the project's manager (never one's own time)
import { PROJECT_TASK_DONE } from "@shared/tables/project";
import { demandScores, wouldCycle } from "@shared/project/logic";
import { emitEvent, isSystemCtx, pushGuard, registerHooks, updateIn, type PushArgs, type WriteArgs } from "../../engine";
import { enqueue } from "../../jobs";
import { bad, conflict, forbidden } from "../../http/errors";
import { PROJECT_CHILDREN, dateOf, ids, liveRow, liveRows, managesProjects, mayWriteRecord, projectConfig, projectCopy, sysOf, type Row } from "./common";
import { initialStateOnly } from "../release/common";

const now = () => new Date().toISOString();
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/** Queue the project's recalculation (deduplicated). */
export const recalcLater = (w: WriteArgs, projectId: unknown) =>
  typeof projectId === "string" && projectId ? enqueue(w.tx, { kind: "project.recalc", orgId: w.ctx.org.id, payload: { id: projectId }, dedupeKey: `project.recalc:${projectId}` }) : Promise.resolve();

/**
 * The project a task, RAID item, status report or allocation is added to (or moved to): it exists, is open, and the
 * person may change it — a member who only reads a project adds nothing to its plan, risks or reports.
 */
async function parentProject(w: WriteArgs): Promise<Row> {
  const p = await liveRow(w.tx, sysOf(w.ctx), "project", w.next.project_id);
  if (!p) throw bad("پروژه پیدا نشد");
  if (["closed", "canceled"].includes(String(p.state)) && w.op === "create") throw conflict("به پروژهٔ بسته یا لغوشده نمی‌توان چیزی افزود");
  if (!w.trusted && !isSystemCtx(w.ctx) && !(await mayWriteRecord(w.tx, w.ctx, "project", p.id))) throw forbidden(`به پروژهٔ «${p.name ?? p.number ?? ""}» فقط کسانی چیزی می‌افزایند که پروژه را تغییر می‌دهند`);
  return p;
}

/** A status report is published by the project's manager (or the project area's manager), never by another member. */
async function publishesReports(w: WriteArgs, project: Row | null): Promise<boolean> {
  if (w.trusted || isSystemCtx(w.ctx)) return true;
  if (project?.project_manager_id && project.project_manager_id === w.ctx.user.id) return true;
  return managesProjects(w.tx, w.ctx);
}

/** Why a project may not pass a gate (PRJ-005/033), or null. */
async function gateProblem(w: WriteArgs): Promise<string | null> {
  const to = w.transition?.to;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (to === "gate") {
    const missing = [["objectives", "هدف‌ها و معیار موفقیت"], ["scope_in", "دامنه"], ["planned_start", "شروع برنامه"], ["planned_end", "پایان برنامه"], ["sponsor_id", "حامی"]].filter(([f]) => blank(n[f])).map(([, l]) => l);
    return missing.length ? `منشور پروژه کامل نیست: ${missing.join("، ")}` : null;
  }
  if (to === "executing") {
    const tasks = await liveRows(w.tx, sys, "project_task", { f: "project_id", op: "eq", v: n.id }, { limit: 1 });
    if (!tasks.length) return "پیش از اجرا، برنامهٔ کار (دست‌کم یک کار یا نقطهٔ عطف) را بسازید";
    if (blank(n.planned_start) || blank(n.planned_end)) return "تاریخ‌های برنامهٔ پروژه را تعیین کنید";
    return null;
  }
  if (to === "closing") return null;
  if (to === "closed") {
    const open = (await liveRows(w.tx, sys, "project_task", { f: "project_id", op: "eq", v: n.id })).filter((t) => !PROJECT_TASK_DONE.includes(String(t.state)));
    if (open.length) return `${open.length.toLocaleString("fa-IR")} کار پروژه هنوز باز است`;
    if (blank(n.lessons)) return "پیش از بستن، درس‌آموخته‌های پروژه را بنویسید";
    return null;
  }
  return null;
}

async function projectBefore(w: WriteArgs): Promise<void> {
  const { next: n, prev } = w;
  if (w.op === "delete") return;
  await initialStateOnly(w, managesProjects);
  const s = dateOf(n.planned_start);
  const e = dateOf(n.planned_end);
  if (s && e && e < s) throw bad("پایان برنامه پیش از شروع آن است");
  if (w.op === "transition" && w.transition) {
    const to = w.transition.to;
    if (to === "executing" && !n.actual_start) n.actual_start = now().slice(0, 10);
    if (to === "closed" || to === "canceled") n.actual_end = n.actual_end ?? now().slice(0, 10);
    if (to === "approved" && prev?.state === "gate" && n.approval === "requested" && !w.trusted && w.ctx.actor !== "system") throw conflict("گردش تصویب این پروژه هنوز باز است");
  }
}

async function projectAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  if (w.op !== "create" && ["project_manager_id", "assignment_group_id"].some((f) => w.changed.has(f))) {
    for (const table of PROJECT_CHILDREN) {
      for (const r of await liveRows(w.tx, sys, table, { f: "project_id", op: "eq", v: w.next.id })) {
        const patch = projectCopy(w.next, table);
        if (Object.entries(patch).some(([k, v]) => r[k] !== v)) await updateIn(w.tx, sys, table, String(r.id), patch, { trusted: true, keepVersion: true, allowLocked: true });
      }
    }
  }
  if (w.op === "create" || ["state", "planned_start", "planned_end", "health_override", "budget", "actual_cost"].some((f) => w.changed.has(f))) await recalcLater(w, w.next.id);
}

async function taskBefore(w: WriteArgs): Promise<void> {
  const n = w.next;
  if (w.op === "delete") return;
  if (w.op === "create" || w.changed.has("project_id")) Object.assign(n, projectCopy(await parentProject(w), "project_task"));
  if (n.kind === "milestone") {
    n.duration_days = 0;
    if (dateOf(n.planned_start) && !dateOf(n.planned_end)) n.planned_end = n.planned_start;
  }
  const s = dateOf(n.planned_start);
  const e = dateOf(n.planned_end);
  if (s && e && e < s) throw bad("پایان کار پیش از شروع آن است");
  if (n.parent_id && n.parent_id === n.id) throw bad("کار نمی‌تواند والد خودش باشد");
  if (n.parent_id && (w.op === "create" || w.changed.has("parent_id"))) {
    const parent = await liveRow(w.tx, sysOf(w.ctx), "project_task", n.parent_id);
    if (!parent || parent.project_id !== n.project_id) throw bad("والد باید کاری از همین پروژه باشد");
    if (parent.kind === "milestone") throw bad("نقطهٔ عطف زیرمجموعه ندارد");
  }
  const deps = ids(n.depends_on);
  if (deps.length && (w.op === "create" || w.changed.has("depends_on"))) {
    if (n.id && deps.includes(String(n.id))) throw bad("کار نمی‌تواند به خودش وابسته باشد");
    const siblings = await liveRows(w.tx, sysOf(w.ctx), "project_task", { f: "project_id", op: "eq", v: n.project_id });
    const foreign = deps.filter((d) => !siblings.some((t) => t.id === d));
    if (foreign.length) throw bad("پیش‌نیازها باید کارهای همین پروژه باشند");
    const graph = siblings.map((t) => ({ id: String(t.id), parent_id: t.parent_id ?? null, depends_on: ids(t.depends_on) }));
    if (wouldCycle(graph, String(n.id ?? "new"), deps)) throw bad("این وابستگی یک چرخه در برنامهٔ پروژه می‌سازد");
  }
  n.depends_on = deps;
  if (w.op === "transition" && w.transition) {
    const to = w.transition.to;
    if (to === "in_progress" && !n.actual_start) n.actual_start = now().slice(0, 10);
    if (to === "done") {
      n.pct_complete = 100;
      n.actual_end = n.actual_end ?? now().slice(0, 10);
      if (!n.actual_start) n.actual_start = n.actual_end;
    }
    if (to === "in_progress" && w.prev?.state === "done") n.actual_end = null;
  }
}

async function timeBefore(w: WriteArgs): Promise<void> {
  const n = w.next;
  if (w.op === "delete") {
    if (w.prev?.state === "approved" && !w.trusted && w.ctx.actor !== "system") throw forbidden("زمان تأییدشده پاک نمی‌شود");
    return;
  }
  await initialStateOnly(w, managesProjects);
  if (w.op === "create" || w.changed.has("task_id")) {
    const task = await liveRow(w.tx, sysOf(w.ctx), "project_task", n.task_id);
    if (!task) throw bad("کار پروژه پیدا نشد");
    n.project_id = task.project_id;
    n.project_manager_id = task.project_manager_id ?? null;
    n.label = `${task.number ?? ""} ${task.short_description ?? ""}`.trim().slice(0, 300);
  }
  if (w.op === "update" && w.prev?.state === "approved" && !w.trusted && w.ctx.actor !== "system") throw forbidden("زمان تأییدشده تغییر نمی‌کند");
  const h = Number(n.hours);
  if (!Number.isFinite(h) || h <= 0 || h > 24) throw bad("ساعت باید بیش از صفر و حداکثر ۲۴ باشد");
}

/**
 * A Windows app's push runs no beforeWrite: the scope columns a row copies from its project (or a time entry from its
 * task) are the cloud's, taken from the stored parent — never from the push.
 */
async function projectCopyOnPush(p: PushArgs): Promise<Row | null> {
  const sys = sysOf(p.ctx);
  if (p.def.key === "time_entry") {
    const task = await liveRow(p.tx, sys, "project_task", p.next.task_id);
    if (!task) return { project_manager_id: null };
    return { project_id: task.project_id, project_manager_id: task.project_manager_id ?? null, label: `${task.number ?? ""} ${task.short_description ?? ""}`.trim().slice(0, 300) };
  }
  const proj = await liveRow(p.tx, sys, "project", p.next.project_id);
  return projectCopy(proj ?? {}, p.def.key);
}

/** The pushed twin of the rules that keep published reports and approved time as they were. */
function frozenOnPush(w: WriteArgs): void {
  if (!w.prev) return;
  if (w.def.key === "status_report" && w.prev.state === "published" && [...w.changed].some((f) => f !== "watch_list")) throw forbidden("گزارش منتشرشده تغییر نمی‌کند؛ گزارش تازه بنویسید");
  if (w.def.key === "time_entry" && w.prev.state === "approved") throw forbidden("زمان تأییدشده تغییر نمی‌کند");
}

export function installProjectHooks(): (() => void)[] {
  return [
    ...PROJECT_CHILDREN.map((t) => registerHooks(t, { derivePush: projectCopyOnPush })),
    ...["status_report", "time_entry"].map((t) => registerHooks(t, { validatePush: pushGuard(frozenOnPush) })),
    // a person's new demand, project or time entry starts in its first state: approval comes through the guarded
    // transitions only (a push as well)
    ...["demand", "project", "time_entry"].map((t) => registerHooks(t, { validatePush: pushGuard((w) => initialStateOnly(w, managesProjects)) })),
    // a pushed status report is published by the project's manager only
    registerHooks("status_report", {
      validatePush: pushGuard(async (w) => {
        if (w.next.state !== "published" || w.prev?.state === "published") return;
        if (!(await publishesReports(w, await liveRow(w.tx, sysOf(w.ctx), "project", w.next.project_id)))) throw forbidden("انتشار گزارش وضعیت با مدیر پروژه است");
      }),
    }),
    // a pushed task, RAID item, report or allocation lands only on a project the person may change
    ...["project_task", "raid_item", "status_report", "resource_allocation"].map((t) => registerHooks(t, {
      validatePush: pushGuard(async (w) => {
        if (!w.prev || w.changed.has("project_id")) await parentProject(w);
      }),
    })),
    registerHooks("demand", {
      async beforeWrite(w) {
        if (w.op === "delete") return;
        await initialStateOnly(w, managesProjects);
        const model = w.next.scoring_model ?? (await projectConfig(w.tx, sysOf(w.ctx))).scoring_model;
        const s = demandScores(w.next, model);
        w.next.score_wsjf = s.wsjf === null ? null : String(s.wsjf);
        w.next.score_rice = s.rice === null ? null : String(s.rice);
        w.next.score_weighted = s.weighted === null ? null : String(s.weighted);
        w.next.score = s.score === null ? null : String(s.score);
      },
    }),
    registerHooks("project", {
      beforeWrite: projectBefore,
      afterWrite: projectAfter,
      guards: { project_gate: gateProblem },
    }),
    registerHooks("project_task", {
      beforeWrite: taskBefore,
      async afterWrite(w) {
        await recalcLater(w, w.op === "delete" ? w.prev?.project_id : w.next.project_id);
      },
    }),
    registerHooks("raid_item", {
      async beforeWrite(w) {
        if (w.op === "delete") return;
        if (w.op === "create" || w.changed.has("project_id")) Object.assign(w.next, projectCopy(await parentProject(w), "raid_item"));
        const p = Number(w.next.probability);
        const i = Number(w.next.impact);
        w.next.score = Number.isFinite(p) && Number.isFinite(i) && p > 0 && i > 0 ? p * i : null;
      },
      async afterWrite(w) {
        await recalcLater(w, w.op === "delete" ? w.prev?.project_id : w.next.project_id);
      },
    }),
    registerHooks("status_report", {
      async beforeWrite(w) {
        if (w.op === "delete") return;
        const p = w.op === "create" || w.changed.has("project_id") ? await parentProject(w) : null;
        if (p) Object.assign(w.next, projectCopy(p, "status_report"));
        if (w.changed.has("state") && w.next.state === "published") {
          if (w.prev?.state === "published") return;
          const proj = p ?? (await liveRow(w.tx, sysOf(w.ctx), "project", w.next.project_id));
          if (!(await publishesReports(w, proj))) throw forbidden("انتشار گزارش وضعیت با مدیر پروژه است");
          w.next.published_at = now();
          w.next.published_by = w.ctx.actor === "system" ? null : w.ctx.user.id;
          if (!w.next.overall && proj?.health && proj.health !== "unknown") w.next.overall = proj.health;
          w.next.metrics = {
            ...(typeof w.next.metrics === "object" && w.next.metrics ? (w.next.metrics as Row) : {}),
            health: proj?.health ?? null, pct_complete: proj?.pct_complete ?? null, tasks_total: proj?.tasks_total ?? 0, tasks_done: proj?.tasks_done ?? 0, tasks_overdue: proj?.tasks_overdue ?? 0,
            milestones_overdue: proj?.milestones_overdue ?? 0, open_risks: proj?.open_risks ?? 0, projected_end: proj?.projected_end ?? null, schedule_variance_days: proj?.schedule_variance_days ?? null,
          };
        } else if (w.prev?.state === "published" && !w.trusted && w.ctx.actor !== "system" && [...w.changed].some((f) => !["watch_list"].includes(f))) {
          throw forbidden("گزارش منتشرشده تغییر نمی‌کند؛ گزارش تازه بنویسید");
        }
      },
      async afterWrite(w) {
        if (w.op === "delete" || !w.changed.has("state") || w.next.state !== "published") return;
        await updateIn(w.tx, sysOf(w.ctx), "project", String(w.next.project_id), { last_status_at: w.next.published_at }, { trusted: true, keepVersion: true, allowLocked: true });
        const p = await liveRow(w.tx, sysOf(w.ctx), "project", w.next.project_id);
        await emitEvent(w.tx, sysOf(w.ctx), { kind: "record.status_report.published", table: "status_report", id: String(w.next.id), number: w.next.number ?? null, data: { users: ids([...(Array.isArray(p?.team) ? p!.team : []), p?.sponsor_id, ...(Array.isArray(w.next.audience) ? w.next.audience : [])]) } });
        await recalcLater(w, w.next.project_id);
      },
    }),
    registerHooks("resource_allocation", {
      async beforeWrite(w) {
        if (w.op === "delete") return;
        if (w.op === "create" || w.changed.has("project_id")) Object.assign(w.next, projectCopy(await parentProject(w), "resource_allocation"));
        const s = dateOf(w.next.start_date);
        const e = dateOf(w.next.end_date);
        if (s && e && e < s) throw bad("پایان تخصیص پیش از شروع آن است");
      },
    }),
    registerHooks("time_entry", {
      beforeWrite: timeBefore,
      async afterWrite(w) {
        if (w.op === "delete" || w.changed.has("state") || w.changed.has("hours")) {
          const task = w.op === "delete" ? w.prev?.task_id : w.next.task_id;
          if (typeof task === "string") await enqueue(w.tx, { kind: "project.hours", orgId: w.ctx.org.id, payload: { task }, dedupeKey: `project.hours:${task}` });
        }
      },
      guards: {
        // the project's manager approves time — never their own
        time_entry_approver: async (w) => {
          if (w.trusted || w.ctx.actor === "system") return null;
          if (w.next.user_id === w.ctx.user.id) return "ثبت زمان خود را نمی‌توانید تأیید یا رد کنید";
          if (w.next.project_manager_id === w.ctx.user.id || (await managesProjects(w.tx, w.ctx))) return null;
          return "تأیید زمان با مدیر همان پروژه است";
        },
      },
    }),
  ];
}

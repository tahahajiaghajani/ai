// Change tasks (catalogue CHG-015, CHG-050): created from a template's task list, waiting («منتظر شروع اجرا») until the
// change is implemented and then made ready in dependency order; planning tasks are workable at once. A change cannot
// finish its implementation while a mandatory task is open (the change's lifecycle guard asks `openMandatoryTasks`).
import { TASK_DONE, TASK_TYPES } from "@shared/tables/change";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { createIn, transitionIn } from "../../engine";
import { eqAll, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";

/** Change states in which implementation tasks may run. */
export const RUNNING_STATES = ["implement", "review"];

/** May this task be worked now (planning tasks always; the others once the change is implemented)? */
export const taskMayRun = (task: Row, change: Row | null): boolean => task.task_type === "planning" || (!!change && RUNNING_STATES.includes(String(change.state)));

/** Unfinished dependencies of a task among its change's tasks (deleted ones do not hold it up). */
export function blockingDeps(task: Row, tasks: readonly Row[]): Row[] {
  const deps = Array.isArray(task.depends_on) ? task.depends_on.map(String) : [];
  return tasks.filter((t) => deps.includes(String(t.id)) && !TASK_DONE.includes(String(t.state)));
}

/** Make waiting tasks ready: those that may run and whose dependencies are done. Returns how many. */
export async function activateTasks(tx: Tx, ctx: Ctx, changeId: string): Promise<number> {
  const sys = sysOf(ctx);
  const change = await liveRow(tx, sys, "change_request", changeId);
  if (!change) return 0;
  const tasks = await liveRows(tx, sys, "change_task", eqAll({ change_id: changeId }), { order: "t.sort_order, t.no" });
  let n = 0;
  for (const t of tasks) {
    if (t.state !== "pending" || !taskMayRun(t, change) || blockingDeps(t, tasks).length) continue;
    await transitionIn(tx, sys, "change_task", String(t.id), "open", {}, { trusted: true });
    t.state = "open";
    n++;
  }
  return n;
}

/** Mandatory tasks of a change that are not finished. */
export async function openMandatoryTasks(q: Queryable, ctx: Ctx, changeId: string): Promise<Row[]> {
  const rows = await liveRows(q, sysOf(ctx), "change_task", { and: [{ f: "change_id", op: "eq", v: changeId }, { f: "mandatory", op: "eq", v: true }, { f: "state", op: "nin", v: TASK_DONE }] }, { order: "t.sort_order, t.no" });
  return rows;
}

export interface TemplateTask {
  short_description: string;
  task_type?: string;
  mandatory?: boolean;
  description?: string;
  /** the task waits for the previous one of the list */
  after_previous?: boolean;
  assignment_group_id?: string;
}

const TYPES = new Set(TASK_TYPES.map((o) => o.value));

/** Why a template's task list is not valid (Persian), or null. */
export function templateTasksProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return "کارهای الگو باید فهرستی از کارها باشد";
  if (raw.length > 50) return "یک الگو حداکثر ۵۰ کار دارد";
  for (const [i, t] of raw.entries()) {
    if (!t || typeof t !== "object") return `کار ${i + 1} معتبر نیست`;
    const x = t as Record<string, unknown>;
    if (typeof x.short_description !== "string" || !x.short_description.trim()) return `عنوان کار ${i + 1} را بنویسید`;
    if (x.short_description.length > 200) return `عنوان کار ${i + 1} بیش از ۲۰۰ نویسه است`;
    if (x.task_type !== undefined && x.task_type !== null && !TYPES.has(String(x.task_type))) return `نوع کار ${i + 1} معتبر نیست`;
    if (x.assignment_group_id !== undefined && x.assignment_group_id !== null && !isUuid(x.assignment_group_id)) return `گروه کار ${i + 1} معتبر نیست`;
  }
  return null;
}

/** The tasks of a template, cleaned. */
export function templateTasks(raw: unknown): TemplateTask[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as Row).short_description === "string" && !!String((t as Row).short_description).trim())
    .slice(0, 50)
    .map((t) => ({
      short_description: String(t.short_description).trim().slice(0, 200),
      task_type: TYPES.has(String(t.task_type)) ? String(t.task_type) : "implementation",
      mandatory: t.mandatory !== false,
      description: typeof t.description === "string" ? t.description : undefined,
      after_previous: t.after_previous === true,
      assignment_group_id: isUuid(t.assignment_group_id) ? String(t.assignment_group_id) : undefined,
    }));
}

/** Create a template's tasks on a change (in order; «پس از قبلی» makes a task wait for the previous one). */
export async function createTemplateTasks(tx: Tx, ctx: Ctx, change: Row, raw: unknown): Promise<number> {
  const sys = sysOf(ctx);
  let prev: Row | null = null;
  let n = 0;
  for (const [i, t] of templateTasks(raw).entries()) {
    prev = await createIn(tx, sys, "change_task", {
      change_id: change.id, short_description: t.short_description, task_type: t.task_type, mandatory: t.mandatory, description: t.description ?? null,
      sort_order: (i + 1) * 10, depends_on: t.after_previous && prev ? [prev.id] : [], assignment_group_id: t.assignment_group_id ?? change.assignment_group_id ?? null,
    }, { trusted: true });
    n++;
  }
  return n;
}

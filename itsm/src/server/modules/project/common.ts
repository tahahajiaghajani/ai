// Helpers of project and portfolio management: reads through the access rule (shared with change and release),
// the module's settings row, the project manager's authority (the project area's approve right) and the copies a
// row hanging off a project keeps of it.
import { grantIn } from "@shared/access";
import { PROJECT_CONFIG_DEFAULTS, type ProjectConfig } from "@shared/tables/project";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { isSystemCtx } from "../../engine";
import { eqAll, isUuid, liveRow, liveRows, mayWriteRecord, sysOf, msOf, type Row } from "../release/common";

export { eqAll, isUuid, liveRow, liveRows, mayWriteRecord, sysOf, msOf, type Row };

/** Tables whose rows hang off a project (they copy its manager and group). */
export const PROJECT_CHILDREN = ["project_task", "raid_item", "status_report", "resource_allocation", "time_entry"];

/** The project manager's authority: the project area's approve right (gates, conversions, approving time). */
export async function managesProjects(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return grantIn(subjectOf(ctx).eff, "project").approve === true;
}

/** The organisation's project settings (its row, else the defaults). */
export async function projectConfig(q: Queryable, ctx: Ctx): Promise<ProjectConfig & { id: string | null; seeded: number; capacity: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "project_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...PROJECT_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(PROJECT_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = row[k];
  return { ...(out as ProjectConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0), capacity: Number(out.weekly_capacity_hours) || 44 };
}

/** The copies a child row keeps of its project. */
export const projectCopy = (p: Row, table: string): Row =>
  table === "project_task" || table === "time_entry" ? { project_manager_id: p.project_manager_id ?? null } : { project_manager_id: p.project_manager_id ?? null, assignment_group_id: p.assignment_group_id ?? null };

/** Today in the organisation's time zone (YYYY-MM-DD). */
export function todayIn(tz: string, now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** A date value as YYYY-MM-DD (or null). */
export const dateOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : [xs]).filter(isUuid))];

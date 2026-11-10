// Helpers of enterprise service management: reads through the access rule (shared with the change and release
// modules — every read starts from `readable`), the module's settings row, the departments (profiles of access
// workspaces) and who belongs to a workspace, the department administrator's authority, calendars and dates.
import { grantIn, scopeRank } from "@shared/access";
import { CASE_TABLE_KIND, ESM_CONFIG_DEFAULTS, type EsmConfig } from "@shared/tables/esm";
import type { BusinessCalendar } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { prepareSubject, snapshotFor, subjectOf, type Snapshot } from "../../access";
import { isSystemCtx, orgTz } from "../../engine";
import { calendarsOf } from "../sla/calendars";
import { config as slaConfig } from "../sla/common";
import { countRows, eqAll, isUuid, liveRow, liveRows, mayWorkRecord, mayWriteRecord, sysOf, msOf, iso, type Row } from "../change/common";

export { countRows, eqAll, isUuid, liveRow, liveRows, mayWorkRecord, mayWriteRecord, sysOf, msOf, iso, type Row };

/** The organisation's ESM settings (its row, else the defaults). */
export async function esmConfig(q: Queryable, ctx: Ctx): Promise<EsmConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "esm_config", null, { order: "t.created_at", limit: 1 });
  const out = { ...ESM_CONFIG_DEFAULTS } as Record<string, unknown>;
  if (row) for (const k of Object.keys(ESM_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined && row[k] !== "") out[k] = row[k];
  return { ...(out as unknown as EsmConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** Every live department (read as the system: the module needs them whatever the caller reads). */
export async function departments(q: Queryable, ctx: Ctx): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "esm_department", null, { order: "t.portal_order, t.name", limit: 500 });
}

export async function departmentById(q: Queryable, ctx: Ctx, id: unknown): Promise<Row | null> {
  return isUuid(id) ? liveRow(q, sysOf(ctx), "esm_department", id) : null;
}

/** The department a case table belongs to when nothing more specific says so: the first live one of its kind. */
export async function defaultDepartment(q: Queryable, ctx: Ctx, table: string): Promise<Row | null> {
  const kind = CASE_TABLE_KIND[table];
  if (!kind) return null;
  const all = (await departments(q, ctx)).filter((d) => d.status !== "retired");
  const own = all.filter((d) => d.kind === kind);
  const hit = own.find((d) => d.case_table === table) ?? own[0] ?? all.find((d) => d.case_table === table);
  if (hit) return hit;
  // a table no department names by kind (purchases of «پشتیبانی و تدارکات»): the department whose services file it
  const [svc] = await liveRows(q, sysOf(ctx), "esm_service", { and: [{ f: "case_table", op: "eq", v: table }] }, { order: "t.sort_order", limit: 1 });
  return svc ? (all.find((d) => d.id === svc.department_id) ?? null) : null;
}

export async function workspaceRow(q: Queryable, ctx: Ctx, id: unknown): Promise<Row | null> {
  return isUuid(id) ? liveRow(q, sysOf(ctx), "workspace", id) : null;
}

/**
 * Does `userId` belong to workspace `ws`: named on their profile, or a member (lead, observer) of one of its groups
 * within the membership's dates? The access model reads exactly these (docs/spec/ACCESS.md §5).
 */
export function inWorkspace(snap: Snapshot, ws: string, userId: string, now = Date.now()): boolean {
  const p = snap.profiles.get(userId);
  if (p?.workspaces?.includes(ws)) return true;
  return snap.memberships.some((m) => {
    if (m.user_id !== userId) return false;
    if (m.valid_from && Date.parse(m.valid_from) > now) return false;
    if (m.valid_to && Date.parse(m.valid_to) < now) return false;
    return snap.groups.get(m.group_id)?.workspace_id === ws;
  });
}

/** Members of a workspace among `users`. */
export async function workspaceMembersOf(q: Queryable, ctx: Ctx, ws: string, users: readonly string[]): Promise<Set<string>> {
  const snap = await snapshotFor(ctx, q);
  return new Set(users.filter((u) => inWorkspace(snap, ws, u)));
}

/** Is the workspace secure (explicit members only)? */
export async function isSecureWorkspace(q: Queryable, ctx: Ctx, ws: unknown): Promise<boolean> {
  if (!isUuid(ws)) return false;
  const snap = await snapshotFor(ctx, q);
  return !!snap.workspaces.get(ws)?.secure;
}

/** The ESM administrator's authority: the esm area's admin flag (tenant administrators and the system hold it). */
export async function administersEsm(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return grantIn(subjectOf(ctx).eff, "esm").admin === true;
}

/** May the caller administer this department: the esm area's admin flag, or named among its delegated admins. */
export async function administersDepartment(q: Queryable, ctx: Ctx, dept: Row | null): Promise<boolean> {
  if (await administersEsm(q, ctx)) return true;
  if (!dept) return false;
  return [...((dept.admins as string[]) ?? []), dept.manager_id].includes(ctx.user.id);
}

/** HR staff: an hr write that reaches groups (HR agents and managers; requesters reach only their own rows), the system. */
export async function hrStaff(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return scopeRank(grantIn(subjectOf(ctx).eff, "hr").write) >= scopeRank("group");
}

/**
 * HR authority over a department's people work (starting or owning an employee journey): its named administrators,
 * or HR staff who belong to its workspace (a secure workspace: its explicit members only).
 */
export async function worksHrOf(q: Queryable, ctx: Ctx, dept: Row | null): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  if (dept && [...((dept.admins as string[]) ?? []), dept.manager_id].includes(ctx.user.id)) return true;
  if (!(await hrStaff(q, ctx))) return false;
  const ws = isUuid(dept?.dept_workspace_id) ? String(dept!.dept_workspace_id).toLowerCase() : null;
  if (!ws) return true;
  const s = subjectOf(ctx);
  return s.workspaces.includes(ws) || (s.eff.workspacesAll && !s.secureWorkspaces.includes(ws));
}

/** HR staff who work a group's HR records: hr write of group or more, in that group unless their write reaches everything. */
export async function hrWorksGroup(q: Queryable, ctx: Ctx, groupId: unknown): Promise<boolean> {
  if (!(await hrStaff(q, ctx))) return false;
  if (isSystemCtx(ctx) || !isUuid(groupId)) return true;
  const s = subjectOf(ctx);
  return grantIn(s.eff, "hr").write === "all" || s.writeGroups.includes(String(groupId).toLowerCase());
}

/** The departments whose workspace the caller belongs to (their «میز واحد» homes). */
export async function myDepartments(q: Queryable, ctx: Ctx): Promise<Row[]> {
  const all = await departments(q, ctx);
  if (isSystemCtx(ctx)) return all;
  await prepareSubject(ctx, q);
  const s = subjectOf(ctx);
  return all.filter((d) => s.workspaces.includes(String(d.dept_workspace_id)) || (s.eff.workspacesAll && !s.secureWorkspaces.includes(String(d.dept_workspace_id))) || [...((d.admins as string[]) ?? []), d.manager_id].includes(ctx.user.id));
}

/** A working calendar by id (or the organisation's default; null: no calendar — every day works). */
export async function calendarFor(q: Queryable, ctx: Ctx, preferred?: unknown): Promise<BusinessCalendar | null> {
  const sys = sysOf(ctx);
  const { byId, defaultId } = calendarsOf(await slaConfig(q, sys), orgTz(sys));
  const id = [preferred, defaultId].find((x): x is string => typeof x === "string" && byId.has(x)) ?? null;
  return id ? (byId.get(id) ?? null) : null;
}

/** Today in the organisation's zone (YYYY-MM-DD). */
export function todayOf(ctx: Ctx, now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: orgTz(ctx), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** Distinct non-empty ids. */
export const ids = (xs: unknown): string[] => [...new Set((Array.isArray(xs) ? xs : [xs]).filter(isUuid).map((x) => x.toLowerCase()))];

export const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

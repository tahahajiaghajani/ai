// Helpers of workforce and agent experience: reads through the access rule (shared with change and release), the
// module's settings row, team membership (the access model's groups) and the authority of workforce managers and team
// leads.
import { grantIn } from "@shared/access";
import { WORKFORCE_CONFIG_DEFAULTS, type WorkforceConfig } from "@shared/tables/workforce";
import { localDate } from "@shared/model/jalali-buckets";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { prepareSubject, subjectOf } from "../../access";
import { isSystemCtx, orgTz } from "../../engine";
import { countRows, eqAll, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "../change/common";

export { countRows, eqAll, isUuid, liveRow, liveRows, msOf, sysOf, type Row };

export const todayOf = (ctx: Ctx, now = Date.now()): string => localDate(now, orgTz(ctx));

/** The settings row (or the defaults). */
export async function workforceConfig(q: Queryable, ctx: Ctx): Promise<WorkforceConfig & { id: string | null; seeded: number }> {
  const [row] = await liveRows(q, sysOf(ctx), "wfm_config", null, { order: "t.created_at", limit: 1 });
  const out: Record<string, unknown> = { ...WORKFORCE_CONFIG_DEFAULTS };
  if (row) for (const k of Object.keys(WORKFORCE_CONFIG_DEFAULTS)) if (row[k] !== null && row[k] !== undefined) out[k] = typeof (WORKFORCE_CONFIG_DEFAULTS as Record<string, unknown>)[k] === "number" ? Number(row[k]) : row[k];
  return { ...(out as WorkforceConfig), id: row?.id ?? null, seeded: Number(row?.seeded ?? 0) };
}

/** The workforce area's grant of the caller (managers and the module's roles). */
export async function workforceGrant(q: Queryable, ctx: Ctx) {
  await prepareSubject(ctx, q);
  return grantIn(subjectOf(ctx).eff, "workforce");
}

/** A workforce manager: reads every team's workforce rows (the area's read scope «all»). */
export async function managesWorkforce(q: Queryable, ctx: Ctx): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  const g = await workforceGrant(q, ctx);
  return g.read === "all" && (g.write === "all" || g.admin || g.approve);
}

/** The groups a person works in (member or lead; valid memberships). */
export async function groupsOfUser(q: Queryable, ctx: Ctx, userId: string): Promise<string[]> {
  const rows = await liveRows(q, sysOf(ctx), "group_member", { and: [{ f: "user_id", op: "eq", v: userId }, { f: "kind", op: "in", v: ["member", "lead"] }] });
  const now = Date.now();
  return [...new Set(rows.filter((r) => (!r.valid_from || (msOf(r.valid_from) ?? 0) <= now) && (!r.valid_to || (msOf(r.valid_to) ?? 0) > now)).map((r) => String(r.group_id)))];
}

/** Members (and leads) of groups, valid now: group → user ids. */
export async function membersOf(q: Queryable, ctx: Ctx, groupIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!groupIds.length) return out;
  const rows = await liveRows(q, sysOf(ctx), "group_member", { and: [{ f: "group_id", op: "in", v: groupIds }, { f: "kind", op: "in", v: ["member", "lead"] }] }, { limit: 10_000 });
  const now = Date.now();
  for (const r of rows) {
    if ((r.valid_from && (msOf(r.valid_from) ?? 0) > now) || (r.valid_to && (msOf(r.valid_to) ?? 0) <= now)) continue;
    const g = String(r.group_id);
    out.set(g, [...new Set([...(out.get(g) ?? []), String(r.user_id)])]);
  }
  return out;
}

/** Active members of the organisation among `ids`. */
export async function activeMembers(q: Queryable, orgId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await q.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [orgId, pgArray(ids)]);
  return new Set(rows.map((r) => r.user_id));
}

/** Display names of members. */
export async function namesOf(q: Queryable, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(ids.filter(isUuid))];
  if (!list.length) return out;
  const rows = await q.query<{ user_id: string; name: string | null; email: string | null }>(
    `select m.user_id, coalesce(nullif(p.name, ''), nullif(u.full_name, ''), u.email) as name, u.email from sm_org_members m join sm_users u on u.id = m.user_id
      left join sm_member_profiles p on p.org_id = m.org_id and p.user_id = m.user_id and p.deleted_at is null
      where m.org_id = $1 and m.user_id = any($2::uuid[]) and m.deleted_at is null`,
    [orgId, pgArray(list)],
  ).catch(() => [] as { user_id: string; name: string | null; email: string | null }[]);
  for (const r of rows) out.set(r.user_id, r.name ?? r.email ?? "");
  return out;
}

/**
 * Which groups' people the caller oversees: every group for workforce managers; otherwise the groups they lead
 * (and the groups under them, from the access subject) — team leads see their teams.
 */
export async function overseenGroups(q: Queryable, ctx: Ctx): Promise<{ all: boolean; groups: string[] }> {
  if (await managesWorkforce(q, ctx)) return { all: true, groups: [] };
  await prepareSubject(ctx, q);
  const s = subjectOf(ctx);
  const g = grantIn(s.eff, "workforce");
  // the groups they lead; a workforce read scope of «group» or wider (the module's team-lead role) reaches the
  // caller's groups too
  const viaGrant = ["group", "unit", "unit_tree", "domain"].includes(g.read) ? s.groups : [];
  return { all: false, groups: [...new Set([...s.ledGroups, ...viaGrant])] };
}

/** May the caller see this team's individual people (presence, schedules, loads)? */
export async function overseesGroup(q: Queryable, ctx: Ctx, groupId: string): Promise<boolean> {
  const o = await overseenGroups(q, ctx);
  return o.all || o.groups.includes(groupId);
}

/** The caller's own groups (member or lead, from the access subject; observers excluded). */
export async function myGroups(q: Queryable, ctx: Ctx): Promise<string[]> {
  await prepareSubject(ctx, q);
  return [...subjectOf(ctx).writeGroups];
}

/** Does the caller hold the field group (hr: individual performance of others)? */
export async function holdsFieldGroup(q: Queryable, ctx: Ctx, group: string): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  await prepareSubject(ctx, q);
  return subjectOf(ctx).eff.fieldGroups.includes(group as never);
}

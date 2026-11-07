// The access model's services: the role catalogue (built-ins + the organisation's rows, diff and reset), member access
// (profile, roles, groups, persona presets, effective permissions), the access checker («بررسی دسترسی»: why a user
// can or cannot see a table or a record), the organisation's access settings, and the helpers other parts of the
// product use to act and check as a given member (notifications to recipients, the AI acting for a user).
import type { Ctx, MemberRow, OrgRow, ServerConfig, AuthUser } from "../context";
import { makeCtx } from "../context";
import type { Queryable } from "../db";
import { bad, conflict, forbidden, notFound } from "../http/errors";
import { audit } from "../modules/data/crud";
import { updateRow } from "../db/sql";
import { createIn, updateIn, removeIn, loadReadable, requireReadable, defFor, condEnv } from "../engine";
import { tableDef } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { FIELD_GROUPS, type FieldGroup } from "@shared/model/types";
import {
  areas, builtinRoles, compactGrant, diffRole, explainRow, fullGrant, grantIn, hiddenFields, isBuiltinRole,
  PERSONA_PRESETS, roleClosure, writeMode, DESK_PRESETS,
  type DeskPreset, type FullGrant, type Grants, type RoleChange, type RoleDef, type RowExplanation, type Subject,
} from "@shared/access";
import { accessSettings, buildSubject, catalogOf, prepareSubject, snapshotFor, subjectOf, type AccessSettings } from "./subject";
import { participantSources, readSql } from "./predicate";

// ----- who may administer access ------------------------------------------------------------------------------

/** The caller's grant in the `users` area (roles, member access, the checker). */
function usersGrant(ctx: Ctx): FullGrant {
  const s = subjectOf(ctx);
  if (s.kind === "system") return fullGrant({ read: "all", create: true, write: "all", delete: "all", approve: true, admin: true });
  return grantIn(s.eff, "users");
}

/** Reading the access configuration of others: `users` read all. */
export async function needAccessView(ctx: Ctx): Promise<void> {
  await prepareSubject(ctx);
  const g = usersGrant(ctx);
  if (g.read !== "all" && !g.admin) throw forbidden("دیدن دسترسی‌های اعضا با مدیر سامانه است");
}

/** Changing roles, settings, and using the access checker: `users` admin. */
export async function needAccessAdmin(ctx: Ctx): Promise<void> {
  await prepareSubject(ctx);
  if (!usersGrant(ctx).admin) throw forbidden("مدیریت نقش‌ها و دسترسی‌ها با مدیر سامانه است");
}

// ----- effective access ---------------------------------------------------------------------------------------

export interface AccessSummary {
  user_id: string;
  kind: Subject["kind"];
  legacy: boolean;
  roles: string[];
  grants: Record<string, FullGrant>;
  field_groups: FieldGroup[];
  workspaces_all: boolean;
  domains_all: boolean;
  groups: string[];
  write_groups: string[];
  led_groups: string[];
  workspaces: string[];
  unit_id: string | null;
  domain_id: string | null;
  managed_units: string[];
  reportees: string[];
  delegators: string[];
  settings: { domain_separation: boolean; preset: DeskPreset };
}

/** A subject as the UI shows it: every registered area's grant spelled out. */
export function summarize(s: Subject, settings: AccessSettings): AccessSummary {
  const grants: Record<string, FullGrant> = {};
  for (const a of areas()) grants[a.key] = grantIn(s.eff, a.key);
  for (const k of Object.keys(s.eff.grants)) if (k !== "*" && !grants[k]) grants[k] = grantIn(s.eff, k);
  return {
    user_id: s.userId,
    kind: s.kind,
    legacy: s.eff.legacy,
    roles: s.eff.roles,
    grants,
    field_groups: s.kind === "system" ? (Object.keys(FIELD_GROUPS) as FieldGroup[]) : s.eff.fieldGroups,
    workspaces_all: s.eff.workspacesAll,
    domains_all: s.eff.domainsAll,
    groups: s.groups,
    write_groups: s.writeGroups,
    led_groups: s.ledGroups,
    workspaces: s.workspaces,
    unit_id: s.unitId,
    domain_id: s.domainId,
    managed_units: s.managedTree,
    reportees: s.reportees,
    delegators: s.delegators,
    settings: { domain_separation: settings.domainSeparation, preset: settings.preset },
  };
}

/** The caller's own effective access (GET /access/me). */
export async function myAccess(ctx: Ctx): Promise<AccessSummary> {
  await prepareSubject(ctx);
  return summarize(subjectOf(ctx), accessSettings(ctx.org));
}

// ----- acting and checking as another member ------------------------------------------------------------------

/**
 * A request context in which member `userId` acts (their membership, their access). Notifications check recipients
 * with it, the AI layer runs a user's tools with it; it never has more than that member has.
 */
export async function memberCtx(cfg: ServerConfig, orgId: string, userId: string, q: Queryable = cfg.db): Promise<Ctx> {
  const [user, org, member] = await Promise.all([
    q.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [userId]),
    q.one<OrgRow>(`select * from sm_orgs where id = $1 and deleted_at is null`, [orgId]),
    q.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [orgId, userId]),
  ]);
  if (!user || !org || !member || !member.is_active || user.disabled) throw notFound("عضو پیدا نشد");
  const ctx = makeCtx(cfg, user, org, member);
  await prepareSubject(ctx, q);
  return ctx;
}

/** Which of `userIds` may read record `id` of `table` (a notification's recipients, an assistant's audience). */
export async function readersOf(cfg: ServerConfig, orgId: string, table: string, id: string, userIds: string[], q: Queryable = cfg.db): Promise<string[]> {
  const def = tableDef(table);
  if (!def || def.virtual) return [];
  const out: string[] = [];
  for (const u of [...new Set(userIds)]) {
    const ctx = await memberCtx(cfg, orgId, u, q).catch(() => null);
    if (!ctx) continue;
    const env = await condEnv(ctx);
    if (await loadReadable(q, ctx, def, id, env)) out.push(u);
  }
  return out;
}

// ----- roles --------------------------------------------------------------------------------------------------

export interface RoleView extends RoleDef {
  builtin: boolean;
  /** the organisation changed this built-in role (its row replaces the default) */
  modified: boolean;
  diff: RoleChange[];
  /** members holding it (directly, through a group, or through a role containing it) */
  holders: number;
  version: number | null;
}

interface RoleRow {
  id: string;
  version: number;
  key: string;
}

async function roleRows(q: Queryable, orgId: string): Promise<RoleRow[]> {
  return q.query<RoleRow>(`select id, version, key from sm_roles where org_id = $1 and deleted_at is null`, [orgId]);
}

export async function listRoles(ctx: Ctx): Promise<{ roles: RoleView[]; preset: DeskPreset; presets: typeof DESK_PRESETS }> {
  await needAccessView(ctx);
  const settings = accessSettings(ctx.org);
  const snap = await snapshotFor(ctx, ctx.db, true);
  const catalog = catalogOf(snap, settings);
  const base = new Map(builtinRoles(settings.preset).map((r) => [r.key, r]));
  const rows = new Map((await roleRows(ctx.db, ctx.org.id)).map((r) => [r.key, r]));
  // who holds what: profile roles and group roles, through containment
  const holders = new Map<string, Set<string>>();
  const members = await ctx.db.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active`, [ctx.org.id]);
  const active = new Set(members.map((m) => m.user_id));
  const now = Date.now();
  for (const p of snap.profiles.values()) {
    if (!active.has(p.user_id)) continue;
    const keys = new Set(p.roles ?? []);
    for (const m of snap.memberships) {
      if (m.user_id !== p.user_id || m.kind === "observer") continue;
      if ((m.valid_from && Date.parse(m.valid_from) > now) || (m.valid_to && Date.parse(m.valid_to) <= now)) continue;
      for (const r of snap.groups.get(m.group_id)?.roles ?? []) keys.add(r);
    }
    for (const k of roleClosure(keys, catalog)) (holders.get(k) ?? holders.set(k, new Set()).get(k)!).add(p.user_id);
  }
  const roles: RoleView[] = [...catalog.values()].map((r) => {
    const b = base.get(r.key);
    const row = rows.get(r.key);
    return {
      ...r,
      builtin: !!b,
      modified: !!b && !!row,
      diff: b && row ? diffRole(b, r) : [],
      holders: holders.get(r.key)?.size ?? 0,
      version: row?.version ?? null,
    };
  });
  roles.sort((a, b) => Number(b.builtin) - Number(a.builtin) || (a.builtin ? builtinOrder(a.key) - builtinOrder(b.key) : a.name.localeCompare(b.name, "fa")));
  return { roles, preset: settings.preset, presets: DESK_PRESETS };
}

const builtinOrder = (key: string) => builtinRoles().findIndex((r) => r.key === key);

export interface RoleInput {
  name: string;
  description?: string | null;
  persona: RoleDef["persona"];
  grants: Grants;
  field_groups: FieldGroup[];
  contains: string[];
  workspaces: RoleDef["workspaces"];
  domains: RoleDef["domains"];
  active?: boolean;
  version?: number | null;
}

/** Only what a grant gives, area by area (empty areas dropped). */
export function compactGrants(grants: Grants): Grants {
  const out: Grants = {};
  for (const [area, g] of Object.entries(grants ?? {})) {
    const c = compactGrant(fullGrant(g));
    if (Object.keys(c).length) out[area] = c;
  }
  return out;
}

/** Create or change role `key` (a built-in key stores the organisation's version of it). */
export async function saveRole(ctx: Ctx, key: string, input: RoleInput): Promise<RoleView> {
  await needAccessAdmin(ctx);
  const data = {
    key,
    name: input.name,
    description: input.description ?? null,
    persona: input.persona,
    grants: compactGrants(input.grants),
    field_groups: [...new Set(input.field_groups ?? [])].sort(),
    contains: [...new Set(input.contains ?? [])],
    workspaces: input.workspaces,
    domains: input.domains,
    active: input.active !== false,
  };
  await ctx.write(async (tx) => {
    const row = (await roleRows(tx, ctx.org.id)).find((r) => r.key === key);
    if (row) await updateIn(tx, ctx, "role", row.id, data, { version: input.version ?? undefined });
    else await createIn(tx, ctx, "role", data);
    await audit(tx, ctx, row ? "update" : "create", "role", null, `${row ? "تغییر" : "ساخت"} نقش «${data.name}» (${key})`, { key, grants: data.grants, field_groups: data.field_groups, contains: data.contains });
  });
  const { roles } = await listRoles(await refreshed(ctx));
  return roles.find((r) => r.key === key)!;
}

/** Bring a built-in role back to its default (removes the organisation's version). */
export async function resetRole(ctx: Ctx, key: string): Promise<void> {
  await needAccessAdmin(ctx);
  if (!isBuiltinRole(key)) throw bad("فقط نقش‌های پیش‌فرض بازگشت دارند؛ نقش سفارشی را حذف کنید");
  await ctx.write(async (tx) => {
    const row = (await roleRows(tx, ctx.org.id)).find((r) => r.key === key);
    if (!row) return;
    await removeIn(tx, ctx, "role", row.id);
    await audit(tx, ctx, "reset", "role", null, `بازگشت نقش «${key}» به پیش‌فرض`, { key });
  });
}

/** Delete a custom role nobody holds and no role contains. */
export async function deleteRole(ctx: Ctx, key: string): Promise<void> {
  await needAccessAdmin(ctx);
  if (isBuiltinRole(key)) throw bad("نقش‌های پیش‌فرض حذف نمی‌شوند؛ می‌توانید آن را غیرفعال کنید یا به پیش‌فرض برگردانید");
  const snap = await snapshotFor(ctx, ctx.db, true);
  const catalog = catalogOf(snap, accessSettings(ctx.org));
  const container = [...catalog.values()].find((r) => r.contains.includes(key));
  if (container) throw conflict(`نقش «${container.name}» این نقش را در بر می‌گیرد`);
  const profiles = [...snap.profiles.values()].filter((p) => (p.roles ?? []).includes(key)).length;
  const groups = [...snap.groups.values()].filter((g) => (g.roles ?? []).includes(key)).length;
  if (profiles || groups) throw conflict(`این نقش به ${profiles ? `${profiles.toLocaleString("fa-IR")} عضو` : ""}${profiles && groups ? " و " : ""}${groups ? `${groups.toLocaleString("fa-IR")} گروه` : ""} داده شده است؛ ابتدا آن را بردارید`);
  await ctx.write(async (tx) => {
    const row = (await roleRows(tx, ctx.org.id)).find((r) => r.key === key);
    if (!row) throw notFound("نقش پیدا نشد");
    await removeIn(tx, ctx, "role", row.id);
    await audit(tx, ctx, "delete", "role", null, `حذف نقش «${key}»`, { key });
  });
}

/** A fresh context for the same caller (a write above changed what the cached subject was built from). */
async function refreshed(ctx: Ctx): Promise<Ctx> {
  const fresh = makeCtx(ctx.cfg, ctx.user, ctx.org, ctx.member, { support: ctx.support ?? null, status: ctx.status ?? null });
  await prepareSubject(fresh);
  return fresh;
}

// ----- settings -----------------------------------------------------------------------------------------------

export async function saveAccessSettings(ctx: Ctx, input: { domain_separation?: boolean; preset?: DeskPreset }): Promise<AccessSettings> {
  await needAccessAdmin(ctx);
  const prev = accessSettings(ctx.org);
  const next = {
    domain_separation: input.domain_separation ?? prev.domainSeparation,
    preset: input.preset ?? prev.preset,
  };
  await ctx.write(async (tx) => {
    const settings = { ...(ctx.org.settings ?? {}), access: { ...((ctx.org.settings?.access as object) ?? {}), ...next } };
    await updateRow(tx, "sm_orgs", { id: ctx.org.id }, { settings, origin: ctx.cfg.origin });
    // every member's readable set may move: their Windows apps re-read
    await tx.query(`select sm_access_bump_everyone($1)`, [ctx.org.id]);
    await audit(tx, ctx, "update", "access_settings", null, `تنظیمات دسترسی: ${next.domain_separation ? "جداسازی دامنه‌ها روشن" : "جداسازی دامنه‌ها خاموش"}، «${DESK_PRESETS[next.preset].label}»`, next);
  });
  return { domainSeparation: next.domain_separation, preset: next.preset };
}

// ----- member access ------------------------------------------------------------------------------------------

export interface MemberAccessRow {
  user_id: string;
  name: string;
  email: string;
  membership_role: string;
  is_active: boolean;
  persona: string | null;
  roles: string[];
  unit_id: string | null;
  title: string | null;
  groups: number;
  legacy: boolean;
}

export async function listMemberAccess(ctx: Ctx): Promise<{ members: MemberAccessRow[] }> {
  await needAccessView(ctx);
  const snap = await snapshotFor(ctx, ctx.db, true);
  const rows = await ctx.db.query<{ user_id: string; name: string; email: string; role: string; is_active: boolean; title: string | null }>(
    `select m.user_id, coalesce(nullif(u.full_name, ''), u.email) as name, u.email, m.role, m.is_active, m.title
     from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.deleted_at is null order by m.is_active desc, name`,
    [ctx.org.id],
  );
  const groupCount = new Map<string, number>();
  for (const m of snap.memberships) groupCount.set(m.user_id, (groupCount.get(m.user_id) ?? 0) + 1);
  return {
    members: rows.map((r) => {
      const p = snap.profiles.get(r.user_id);
      const groupRoles = snap.memberships.filter((m) => m.user_id === r.user_id && m.kind !== "observer").flatMap((m) => snap.groups.get(m.group_id)?.roles ?? []);
      return {
        user_id: r.user_id,
        name: r.name,
        email: r.email,
        membership_role: r.role,
        is_active: r.is_active,
        persona: p?.persona ?? null,
        roles: p?.roles ?? [],
        unit_id: p?.org_unit_id ?? null,
        title: r.title,
        groups: groupCount.get(r.user_id) ?? 0,
        legacy: !(p?.roles?.length || groupRoles.length),
      };
    }),
  };
}

export interface MemberAccessDetail {
  member: { user_id: string; name: string; email: string; membership_role: string; is_active: boolean };
  profile: Record<string, unknown> | null;
  groups: { id: string; group_id: string; name: string; kind: string; roles: string[]; valid_from: string | null; valid_to: string | null; version: number }[];
  /** where each role comes from */
  sources: { profile: string[]; groups: { group_id: string; roles: string[] }[]; membership: string[] };
  effective: AccessSummary;
}

const PROFILE_FIELDS = [
  "id", "version", "user_id", "name", "persona", "roles", "org_unit_id", "location_id", "manager_id", "domain_unit_id", "workspaces", "title", "phone",
  "vip", "skills", "language", "timezone", "out_of_office", "ooo_until", "delegate_id",
];

export async function memberAccess(ctx: Ctx, userId: string): Promise<MemberAccessDetail> {
  await needAccessView(ctx);
  const m = await ctx.db.one<{ user_id: string; name: string; email: string; role: MemberRow["role"]; is_active: boolean; overrides: MemberRow["overrides"] }>(
    `select m.user_id, coalesce(nullif(u.full_name, ''), u.email) as name, u.email, m.role, m.is_active, m.overrides
     from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2 and m.deleted_at is null`,
    [ctx.org.id, userId],
  );
  if (!m) throw notFound("عضو پیدا نشد");
  const settings = accessSettings(ctx.org);
  const snap = await snapshotFor(ctx, ctx.db, true);
  const profile = await ctx.db.one<Record<string, unknown>>(`select ${PROFILE_FIELDS.join(", ")} from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, userId]);
  const groups = await ctx.db.query<MemberAccessDetail["groups"][number]>(
    `select gm.id, gm.group_id, g.name, gm.kind, g.roles, gm.valid_from, gm.valid_to, gm.version
     from sm_group_members gm join sm_groups g on g.id = gm.group_id and g.deleted_at is null
     where gm.org_id = $1 and gm.user_id = $2 and gm.deleted_at is null order by g.name`,
    [ctx.org.id, userId],
  );
  const built = buildSubject(snap, settings, ctx.org.id, userId, m.role, m.overrides ?? null);
  return {
    member: { user_id: m.user_id, name: m.name, email: m.email, membership_role: m.role, is_active: m.is_active },
    profile,
    groups: groups.map((g) => ({ ...g, roles: Array.isArray(g.roles) ? g.roles : [] })),
    sources: {
      profile: Array.isArray(profile?.roles) ? (profile!.roles as string[]) : [],
      groups: groups.filter((g) => g.kind !== "observer" && Array.isArray(g.roles) && g.roles.length).map((g) => ({ group_id: g.group_id, roles: g.roles })),
      membership: m.role === "owner" || m.role === "admin" ? ["tenant_admin"] : [],
    },
    effective: summarize(built.subject, settings),
  };
}

const PROFILE_INPUT = new Set(PROFILE_FIELDS.filter((f) => !["id", "version", "user_id", "name"].includes(f)));

/** Create or change a member's profile (roles, unit, manager, delegate…) through the engine (history, sync, checks). */
export async function saveMemberAccess(ctx: Ctx, userId: string, input: Record<string, unknown>): Promise<MemberAccessDetail> {
  await prepareSubject(ctx);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "version") continue;
    if (!PROFILE_INPUT.has(k)) throw bad(`فیلد «${k}» در نمایهٔ عضو وجود ندارد`);
    data[k] = v;
  }
  const member = await ctx.db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, userId]);
  if (!member) throw notFound("عضو پیدا نشد");
  await ctx.write(async (tx) => {
    const row = await tx.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [ctx.org.id, userId]);
    if (row) await updateIn(tx, ctx, "member_profile", row.id, data, { version: (input.version as number | undefined) ?? undefined });
    else await createIn(tx, ctx, "member_profile", { ...data, user_id: userId });
  });
  return memberAccess(await refreshed(ctx), userId);
}

/** Start a member from a persona preset (its persona and roles). */
export async function applyPreset(ctx: Ctx, userId: string, presetKey: string): Promise<MemberAccessDetail> {
  const preset = PERSONA_PRESETS.find((p) => p.key === presetKey);
  if (!preset) throw bad("پیش‌تنظیم دسترسی شناخته نیست");
  return saveMemberAccess(ctx, userId, { persona: preset.persona, roles: preset.roles });
}

/** Add members to a group (existing memberships take the new kind). */
export async function addGroupMembers(ctx: Ctx, groupId: string, userIds: string[], kind: "member" | "lead" | "observer" = "member"): Promise<{ added: number; updated: number }> {
  await prepareSubject(ctx);
  if (!userIds.length) return { added: 0, updated: 0 };
  if (userIds.length > 500) throw bad("در هر بار حداکثر ۵۰۰ عضو");
  let added = 0;
  let updated = 0;
  await ctx.write(async (tx) => {
    const group = await tx.one(`select 1 from sm_groups where id = $1 and org_id = $2 and deleted_at is null`, [groupId, ctx.org.id]);
    if (!group) throw notFound("گروه پیدا نشد");
    const existing = new Map(
      (await tx.query<{ id: string; user_id: string; kind: string }>(`select id, user_id, kind from sm_group_members where org_id = $1 and group_id = $2 and deleted_at is null`, [ctx.org.id, groupId])).map((r) => [r.user_id, r]),
    );
    for (const u of [...new Set(userIds)]) {
      const e = existing.get(u);
      if (e) {
        if (e.kind !== kind) {
          await updateIn(tx, ctx, "group_member", e.id, { kind });
          updated++;
        }
        continue;
      }
      await createIn(tx, ctx, "group_member", { group_id: groupId, user_id: u, kind });
      added++;
    }
  });
  return { added, updated };
}

// ----- the access checker -------------------------------------------------------------------------------------

export interface AccessCheck {
  user: { id: string; name: string };
  table: { key: string; label: string; plural: string; area: string };
  grant: FullGrant;
  roles: string[];
  legacy: boolean;
  field_groups: FieldGroup[];
  hidden_fields: { name: string; label: string; group: FieldGroup }[];
  can: { read_table: boolean; create: boolean };
  record?: {
    id: string;
    label: string;
    explanation: RowExplanation;
    /** the SQL predicate's verdict for the same user and row (always equal to `explanation.read`) */
    sql_read: boolean;
    writable_fields: string[] | null;
  };
}

/** Why `userId` can or cannot read table `table` (and record `recordId`). The caller must be able to read the record. */
export async function checkAccess(ctx: Ctx, input: { user_id: string; table: string; record_id?: string | null }): Promise<AccessCheck> {
  await needAccessAdmin(ctx);
  const { def } = await defFor(ctx, input.table);
  if (def.virtual) throw bad("دسترسی به فهرست اعضا برای همهٔ اعضا یکسان است");
  const target = await memberCtx(ctx.cfg, ctx.org.id, input.user_id);
  const s = subjectOf(target);
  const g = grantIn(s.eff, def.area);
  const name = target.user.full_name || target.user.email;
  const out: AccessCheck = {
    user: { id: target.user.id, name },
    table: { key: def.key, label: def.label, plural: def.plural, area: def.area },
    grant: g,
    roles: s.eff.roles,
    legacy: s.eff.legacy,
    field_groups: s.eff.fieldGroups,
    hidden_fields: hiddenFields(s, def).map((n) => {
      const f = def.fields.find((x) => x.name === n)!;
      return { name: n, label: f.label, group: f.group! };
    }),
    can: { read_table: g.read !== "none", create: g.create },
  };
  if (input.record_id) {
    // the checker never tells about a record its user may not read
    const mine = await requireReadable(ctx, def, input.record_id, await condEnv(ctx));
    const row = await ctx.db.one<Record<string, unknown>>(`select * from ${def.table} where id = $1 and org_id = $2`, [mine.id, ctx.org.id]);
    const participant = await participantOf(ctx.db, s, def, String(mine.id));
    const explanation = explainRow(s, def, row!, participant === null ? {} : { participant });
    const params: unknown[] = [String(mine.id)];
    const sql = readSql(s, def, "t", params);
    const probe = await ctx.db.one(`select 1 from ${def.table} t where t.id = $1 and ${sql}`, params);
    const mode = writeMode(s, def, row!);
    const seen = new Set(def.fields.map((f) => f.name).filter((n) => !hiddenFields(s, def).includes(n)));
    out.record = {
      id: String(mine.id),
      label: recordLabel(def, row!),
      explanation,
      sql_read: !!probe,
      writable_fields: mode === "requester" ? (def.scope.requesterWritable ?? []).filter((n) => seen.has(n)) : mode ? null : [],
    };
  }
  return out;
}

/** Is the subject a participant of the record through a registered source (null when no source applies)? */
async function participantOf(q: Queryable, s: Subject, def: TableDef, id: string): Promise<boolean | null> {
  const params: unknown[] = [id];
  const terms = participantSources()
    .map((src) => src.sql(def, "t", params, s.userId))
    .filter((x): x is string => !!x);
  if (!terms.length) return null;
  const r = await q.one(`select 1 from ${def.table} t where t.id = $1 and (${terms.join(" or ")})`, params);
  return !!r;
}

function recordLabel(def: TableDef, row: Record<string, unknown>): string {
  const d = row[def.display];
  const text = typeof d === "string" ? d : d === null || d === undefined ? "" : String(d);
  return def.numbered && row.number ? `${row.number}${text ? ` — ${text}` : ""}` : text || String(row.id);
}

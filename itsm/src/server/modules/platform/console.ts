// Read models of «مدیریت سامانه»: the overview, businesses and users, and the admin audit log.
// Platform metadata only — names, modules, members, counts, sizes, devices, activity dates, status —
// never a business's documents (those need a support session) and never a password, key or token.
import type { Db, Queryable } from "../../db";
import { likeContains, pgArray } from "../../db";
import type { ServerConfig } from "../../context";
import { AGGREGATES } from "../../sync/registry";
import { todayISO, toJalali, jalaliMonthRange } from "@shared/jalali";
import { orgAdminState, type OrgAdminState } from "./org-admin";
import { listSecurityEvents, type SecurityEventRow } from "./security";
import { listSupportSessions, type SupportSessionRow } from "./support";
import { FREE_DB_BYTES, systemHealth } from "./health";
import { recentlyAdmin } from "./users";

/** Start of the current Jalali month as an instant (Tehran has had no daylight saving since 2022). */
export function jalaliMonthStart(today = todayISO()): string {
  const t = toJalali(today);
  return `${jalaliMonthRange(t.jy, t.jm).start}T00:00:00+03:30`;
}

const tableExists = async (q: Queryable, table: string) => !!(await q.one<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [table]))?.ok;

// ---------------------------------------------------------------- AI figures (tables of the AI engine)

export interface AiFigures {
  enabled_orgs: number | null;
  calls_month: number | null;
  errors_month: number | null;
  cost_month_usd: string | null;
}

/** AI usage this (Jalali) month from the engine's ledger, when its tables exist; null parts otherwise. */
export async function aiFigures(db: Db): Promise<AiFigures> {
  const out: AiFigures = { enabled_orgs: null, calls_month: null, errors_month: null, cost_month_usd: null };
  if (await tableExists(db, "sm_ai_connections")) {
    const r = await db
      .one<{ n: number }>(
        `select count(distinct c.org_id)::int as n from sm_ai_connections c
         join sm_orgs o on o.id = c.org_id and o.deleted_at is null
         left join sm_org_admin a on a.org_id = c.org_id
         where c.deleted_at is null and c.enabled and not coalesce(a.ai_disabled, false)`,
      )
      .catch(() => null);
    out.enabled_orgs = r?.n ?? null;
  }
  if (await tableExists(db, "sm_ai_usage")) {
    const r = await db
      .one<{ calls: number; errors: number; cost: string }>(
        `select count(*)::int as calls, count(*) filter (where not ok)::int as errors, coalesce(sum(cost_usd), 0)::text as cost
         from sm_ai_usage where created_at >= $1`,
        [jalaliMonthStart()],
      )
      .catch(() => null);
    if (r) {
      out.calls_month = r.calls;
      out.errors_month = r.errors;
      out.cost_month_usd = r.cost;
    }
  }
  return out;
}

// ---------------------------------------------------------------- overview

export interface AttentionItem {
  key: string;
  tone: "danger" | "warning" | "neutral";
  title: string;
  detail?: string;
  /** console path that deals with it */
  path: string;
}

export async function overview(cfg: ServerConfig) {
  const db = cfg.db;
  const k = await db.one<Record<string, number>>(
    `select
       (select count(*)::int from sm_orgs where deleted_at is null) as orgs_total,
       (select count(*)::int from sm_orgs where deleted_at is null and created_at > now() - interval '30 days') as orgs_new_30d,
       (select count(*)::int from (
          select org_id from sm_audit where at > now() - interval '30 days' and org_id is not null and actor_kind = 'user'
          union select org_id from sm_vouchers where updated_at > now() - interval '30 days') t
        join sm_orgs o on o.id = t.org_id and o.deleted_at is null) as orgs_active_30d,
       (select count(*)::int from sm_org_admin a join sm_orgs o on o.id = a.org_id and o.deleted_at is null where a.status = 'read_only') as orgs_read_only,
       (select count(*)::int from sm_org_admin a join sm_orgs o on o.id = a.org_id and o.deleted_at is null where a.status = 'suspended') as orgs_suspended,
       (select count(*)::int from sm_users) as users_total,
       (select count(*)::int from sm_users where disabled) as users_disabled,
       (select count(*)::int from sm_users where is_platform_admin and not disabled) as users_admins,
       (select count(*)::int from sm_users where created_at > now() - interval '30 days') as users_new_30d,
       (select count(distinct user_id)::int from sm_sessions where last_seen_at > now() - interval '1 day') as users_active_today,
       (select count(distinct user_id)::int from sm_sessions where last_seen_at > now() - interval '7 days') as users_active_7d,
       (select count(*)::int from sm_devices where revoked_at is null) as devices_total,
       (select count(*)::int from sm_devices where revoked_at is null and greatest(last_push_at, last_pull_at) > now() - interval '7 days') as devices_active_7d,
       (select count(*)::int from sm_security_events where at > now() - interval '1 day') as events_24h,
       (select count(*)::int from sm_security_events where at > now() - interval '1 day' and kind = 'sign_in' and not ok) as failed_sign_ins_24h,
       (select count(*)::int from sm_support_sessions where ended_at is null and expires_at > now()) as support_active,
       pg_database_size(current_database())::bigint as db_bytes`,
  );
  const n = (key: string) => Number(k?.[key] ?? 0);
  const [ai, health, support, recentOrgs, recentEvents] = await Promise.all([
    aiFigures(db),
    systemHealth(cfg),
    listSupportSessions(db, { active: true, limit: 20 }),
    db.query<{ id: string; name: string; created_at: string; owner_name: string | null }>(
      `select o.id, o.name, o.created_at,
              (select u.full_name from sm_org_members m join sm_users u on u.id = m.user_id
               where m.org_id = o.id and m.role = 'owner' and m.deleted_at is null order by m.created_at limit 1) as owner_name
       from sm_orgs o where o.deleted_at is null order by o.created_at desc limit 5`,
    ),
    listSecurityEvents(db, { limit: 6 }),
  ]);

  const attention: AttentionItem[] = [];
  for (const c of health.checks) if (c.tone === "danger" || c.tone === "warning") attention.push({ key: c.key, tone: c.tone, title: c.title, detail: c.detail, path: "/admin/health" });
  const failed = n("failed_sign_ins_24h");
  if (failed >= 10) attention.push({ key: "sign_ins", tone: failed >= 50 ? "danger" : "warning", title: "ورودهای ناموفق در ۲۴ ساعت گذشته", detail: `${failed}`, path: "/admin/security?ok=false&kind=sign_in" });
  if (n("orgs_suspended")) attention.push({ key: "suspended", tone: "neutral", title: "کسب‌وکارهای معلق", detail: `${n("orgs_suspended")}`, path: "/admin/orgs?status=suspended" });
  if (n("orgs_read_only")) attention.push({ key: "read_only", tone: "neutral", title: "کسب‌وکارهای فقط‌خواندنی", detail: `${n("orgs_read_only")}`, path: "/admin/orgs?status=read_only" });

  return {
    mode: cfg.mode,
    kpis: {
      orgs: { total: n("orgs_total"), active_30d: n("orgs_active_30d"), new_30d: n("orgs_new_30d"), read_only: n("orgs_read_only"), suspended: n("orgs_suspended") },
      users: { total: n("users_total"), active_today: n("users_active_today"), active_7d: n("users_active_7d"), disabled: n("users_disabled"), admins: n("users_admins"), new_30d: n("users_new_30d") },
      devices: { total: n("devices_total"), active_7d: n("devices_active_7d") },
      db: { bytes: n("db_bytes"), limit: cfg.mode === "cloud" ? FREE_DB_BYTES : null },
      ai,
      security: { events_24h: n("events_24h"), failed_sign_ins_24h: failed },
      support: { active: n("support_active") },
    },
    attention,
    active_support: support,
    recent_orgs: recentOrgs,
    recent_events: recentEvents,
  };
}

// ---------------------------------------------------------------- businesses

export interface OrgListFilter {
  q?: string | null;
  status?: "active" | "read_only" | "suspended" | null;
  module?: string | null;
  /** no activity in the last 30 days */
  inactive?: boolean;
  support?: boolean;
}

const LAST_ACTIVITY = `greatest(
  (select max(x.at) from sm_audit x where x.org_id = o.id and x.actor_kind = 'user'),
  (select max(v.updated_at) from sm_vouchers v where v.org_id = o.id))`;

export async function listOrgs(q: Queryable, f: OrgListFilter = {}) {
  const where = ["o.deleted_at is null"];
  const params: unknown[] = [];
  if (f.q?.trim()) {
    params.push(likeContains(f.q.trim()));
    const p = `$${params.length}`;
    where.push(`(o.name ilike ${p} or o.legal_name ilike ${p} or exists (
      select 1 from sm_org_members m join sm_users u on u.id = m.user_id
      where m.org_id = o.id and m.deleted_at is null and (u.email ilike ${p} or u.full_name ilike ${p} or u.mobile ilike ${p})))`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`coalesce(a.status, 'active') = $${params.length}`);
  }
  if (f.module) {
    params.push(f.module);
    where.push(`o.modules @> jsonb_build_array($${params.length}::text)`);
  }
  if (f.support) where.push(`exists (select 1 from sm_support_sessions s where s.org_id = o.id and s.ended_at is null and s.expires_at > now())`);
  const rows = await q.query<Record<string, unknown> & { last_activity: string | null }>(
    `select o.id, o.name, o.legal_name, o.business_kind, o.modules, o.base_currency, o.city, o.created_at,
            coalesce(a.status, 'active') as status, a.status_reason, coalesce(a.ai_disabled, false) as ai_disabled,
            (select count(*)::int from sm_org_members m where m.org_id = o.id and m.deleted_at is null and m.is_active) as members,
            (select json_build_object('name', u.full_name, 'email', u.email, 'mobile', u.mobile)
               from sm_org_members m join sm_users u on u.id = m.user_id
              where m.org_id = o.id and m.role = 'owner' and m.deleted_at is null and m.is_active order by m.created_at limit 1) as owner,
            (select count(*)::int from sm_vouchers v where v.org_id = o.id and v.deleted_at is null) as vouchers,
            (select count(*)::int from sm_devices d where d.org_id = o.id and d.revoked_at is null) as devices,
            ${LAST_ACTIVITY} as last_activity,
            exists (select 1 from sm_support_sessions s where s.org_id = o.id and s.ended_at is null and s.expires_at > now()) as support_active
     from sm_orgs o left join sm_org_admin a on a.org_id = o.id
     where ${where.join(" and ")}
     order by o.created_at desc limit 500`,
    params,
  );
  if (!f.inactive) return rows;
  const cutoff = Date.now() - 30 * 86400_000;
  return rows.filter((r) => !r.last_activity || new Date(r.last_activity).getTime() < cutoff);
}

// tables of a business (roots and children of the synchronised aggregates, plus its audit log)
let sizeTables: { entity: string; table: string; root: boolean }[] | null = null;
async function sizeTablesOf(q: Queryable) {
  if (sizeTables) return sizeTables;
  const all: { entity: string; table: string; root: boolean }[] = [];
  for (const a of AGGREGATES) {
    if (a.entity === "org" || a.entity === "member") continue;
    all.push({ entity: a.entity, table: a.table, root: true });
    for (const ch of a.children ?? []) if (!all.some((x) => x.table === ch.table)) all.push({ entity: a.entity, table: ch.table, root: false });
  }
  all.push({ entity: "audit", table: "sm_audit", root: true });
  const have = new Set(
    (await q.query<{ table_name: string }>(
      `select table_name from information_schema.columns where table_schema = current_schema() and column_name = 'org_id' and table_name = any($1::text[])`,
      [pgArray(all.map((t) => t.table))],
    )).map((r) => r.table_name),
  );
  sizeTables = all.filter((t) => have.has(t.table));
  return sizeTables;
}

export interface OrgSize {
  entity: string;
  rows: number;
  bytes: number;
}

/** Rows and approximate bytes of a business, per kind of record (largest first). */
export async function orgSizes(q: Queryable, orgId: string): Promise<{ total_bytes: number; items: OrgSize[] }> {
  const by = new Map<string, OrgSize>();
  for (const t of await sizeTablesOf(q)) {
    const live = t.root && t.table !== "sm_audit" ? "deleted_at is null" : "true";
    const r = await q.one<{ rows: number; bytes: number }>(
      `select count(*) filter (where ${live})::int as rows, coalesce(sum(pg_column_size(t.*)), 0)::bigint as bytes from ${t.table} t where org_id = $1`,
      [orgId],
    );
    const e = by.get(t.entity) ?? { entity: t.entity, rows: 0, bytes: 0 };
    if (t.root) e.rows += Number(r?.rows ?? 0);
    e.bytes += Number(r?.bytes ?? 0);
    by.set(t.entity, e);
  }
  const items = [...by.values()].filter((e) => e.rows > 0 || e.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  return { total_bytes: items.reduce((s, e) => s + e.bytes, 0), items };
}

export async function orgDetail(cfg: ServerConfig, orgId: string, adminUserId: string) {
  const db = cfg.db;
  const org = await db.one(
    `select id, name, legal_name, business_kind, modules, base_currency, province, city, phone, mobile, email, website, created_at, updated_at, logo
     from sm_orgs where id = $1 and deleted_at is null`,
    [orgId],
  );
  if (!org) return null;
  const [admin, members, devices, activity, sizes, sessions, events, member] = await Promise.all([
    orgAdminState(db, orgId).then(async (a: OrgAdminState) => ({
      ...a,
      updated_by_name: a.updated_by ? ((await db.one<{ full_name: string }>(`select full_name from sm_users where id = $1`, [a.updated_by]))?.full_name ?? null) : null,
    })),
    db.query(
      `select m.id, m.user_id, m.role, m.title, m.is_active, m.created_at, u.full_name, u.email, u.mobile, u.last_login_at, u.disabled
       from sm_org_members m join sm_users u on u.id = m.user_id
       where m.org_id = $1 and m.deleted_at is null
       order by case m.role when 'owner' then 0 when 'admin' then 1 when 'accountant' then 2 else 3 end, m.created_at`,
      [orgId],
    ),
    db.query(
      `select d.id, d.name, d.platform, d.app_version, d.created_at, d.last_push_at, d.last_pull_at, d.revoked_at, u.full_name as user_name
       from sm_devices d left join sm_users u on u.id = d.user_id where d.org_id = $1 order by greatest(d.last_push_at, d.last_pull_at, d.created_at) desc limit 50`,
      [orgId],
    ),
    db.one<{ last_activity: string | null }>(`select ${LAST_ACTIVITY} as last_activity from sm_orgs o where o.id = $1`, [orgId]),
    orgSizes(db, orgId),
    listSupportSessions(db, { org_id: orgId, limit: 30 }),
    listSecurityEvents(db, { org_id: orgId, limit: 30 }),
    db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null and is_active`, [orgId, adminUserId]),
  ]);
  return {
    org,
    admin,
    members,
    owners: (members as { role: string; is_active: boolean }[]).filter((m) => m.role === "owner" && m.is_active),
    devices,
    last_activity: activity?.last_activity ?? null,
    sizes,
    support: { active: sessions.find((s) => s.state === "active" && s.admin_user_id === adminUserId) ?? null, sessions },
    events,
    /** the admin is a member: he opens the business directly, without a support session */
    is_member: !!member,
  };
}

// ---------------------------------------------------------------- users

export interface UserListFilter {
  q?: string | null;
  filter?: "admins" | "disabled" | "never" | "inactive" | null;
}

export async function listUsers(cfg: ServerConfig, f: UserListFilter = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q?.trim()) {
    params.push(likeContains(f.q.trim()));
    where.push(`(u.email ilike $${params.length} or u.full_name ilike $${params.length} or u.mobile ilike $${params.length})`);
  }
  if (f.filter === "admins") where.push("u.is_platform_admin");
  if (f.filter === "disabled") where.push("u.disabled");
  if (f.filter === "never") where.push("u.last_login_at is null");
  if (f.filter === "inactive") where.push(`coalesce((select max(s.last_seen_at) from sm_sessions s where s.user_id = u.id), u.created_at) < now() - interval '30 days'`);
  const rows = await cfg.db.query<{ email: string } & Record<string, unknown>>(
    `select u.id, u.email, u.full_name, u.mobile, u.is_platform_admin, u.disabled, u.created_at, u.last_login_at,
            (select max(s.last_seen_at) from sm_sessions s where s.user_id = u.id) as last_seen_at,
            (select count(*)::int from sm_org_members m join sm_orgs o on o.id = m.org_id and o.deleted_at is null
              where m.user_id = u.id and m.deleted_at is null and m.is_active) as orgs,
            (select count(*)::int from sm_sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as sessions,
            (select count(*)::int from sm_security_events e where e.user_id = u.id and e.kind = 'sign_in' and not e.ok and e.at > now() - interval '1 day') as failed_24h
     from sm_users u ${where.length ? `where ${where.join(" and ")}` : ""}
     order by u.created_at desc limit 300`,
    params,
  );
  return rows.map((r) => ({ ...r, env_admin: cfg.platformAdmins.includes(String(r.email).toLowerCase()) }));
}

export async function userDetail(cfg: ServerConfig, userId: string) {
  const db = cfg.db;
  const user = await db.one<{ email: string } & Record<string, unknown>>(
    `select id, email, full_name, mobile, is_platform_admin, disabled, created_at, updated_at, last_login_at, recovery_hash is not null as has_recovery
     from sm_users where id = $1`,
    [userId],
  );
  if (!user) return null;
  const [memberships, sessions, devices, events, support] = await Promise.all([
    db.query(
      `select m.id, m.org_id, o.name as org_name, m.role, m.title, m.is_active, m.created_at, coalesce(a.status, 'active') as org_status
       from sm_org_members m join sm_orgs o on o.id = m.org_id and o.deleted_at is null left join sm_org_admin a on a.org_id = o.id
       where m.user_id = $1 and m.deleted_at is null order by m.created_at`,
      [userId],
    ),
    db.query(
      `select id, kind, device_name, ip, user_agent, created_at, last_seen_at, expires_at from sm_sessions
       where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc limit 50`,
      [userId],
    ),
    db.query(
      `select d.id, d.name, d.platform, d.app_version, d.created_at, d.last_push_at, d.last_pull_at, o.name as org_name
       from sm_devices d left join sm_orgs o on o.id = d.org_id where d.user_id = $1 and d.revoked_at is null
       order by greatest(d.last_push_at, d.last_pull_at, d.created_at) desc limit 50`,
      [userId],
    ),
    listSecurityEvents(db, { user_id: userId, limit: 50 }),
    user.is_platform_admin ? listSupportSessions(db, { admin_user_id: userId, limit: 20 }) : Promise.resolve([] as SupportSessionRow[]),
  ]);
  // recently_admin: the admin role was taken away lately, so no temporary password (users.ts)
  const recently_admin = !user.is_platform_admin && (await recentlyAdmin(cfg, userId));
  return { user: { ...user, env_admin: cfg.platformAdmins.includes(String(user.email).toLowerCase()), recently_admin }, memberships, sessions, devices, events: events as SecurityEventRow[], support };
}

// ---------------------------------------------------------------- admin audit log

export interface AdminAuditFilter {
  actor?: "platform" | "support" | null;
  q?: string | null;
  org_id?: string | null;
  before?: string | null;
  limit?: number;
}

/** The platform admin's actions: console changes ('platform') and support sessions ('support'). */
export async function adminAudit(q: Queryable, f: AdminAuditFilter = {}) {
  const where = ["a.actor_kind <> 'user'"];
  const params: unknown[] = [];
  if (f.actor) {
    params.push(f.actor);
    where.push(`a.actor_kind = $${params.length}`);
  }
  if (f.org_id) {
    params.push(f.org_id);
    where.push(`(a.org_id = $${params.length} or (a.entity = 'org' and a.entity_id = $${params.length}))`);
  }
  if (f.before) {
    params.push(f.before);
    where.push(`a.at < $${params.length}`);
  }
  if (f.q?.trim()) {
    params.push(likeContains(f.q.trim()));
    const p = `$${params.length}`;
    where.push(`(a.summary ilike ${p} or u.full_name ilike ${p} or o.name ilike ${p} or t.email ilike ${p} or t.full_name ilike ${p})`);
  }
  params.push(Math.min(500, Math.max(1, f.limit ?? 200)));
  return q.query(
    `select a.id, a.at, a.org_id, a.user_id, a.action, a.entity, a.entity_id, a.summary, a.data, a.actor_kind, a.support_session_id,
            u.full_name as actor_name, u.email as actor_email,
            o.id as target_org_id, o.name as org_name,
            t.id as target_user_id, t.full_name as target_name, t.email as target_email
     from sm_audit a
     left join sm_users u on u.id = a.user_id
     left join sm_orgs o on o.id = coalesce(a.org_id, case when a.entity = 'org' then a.entity_id end)
     left join sm_users t on a.entity = 'user' and t.id = a.entity_id
     where ${where.join(" and ")}
     order by a.at desc
     limit $${params.length}`,
    params,
  );
}

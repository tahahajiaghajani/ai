// «حالت پشتیبانی»: the platform admin works inside a business he is not a member of — only with a
// reason, at a chosen level («مشاهده» or «مشاهده و اصلاح»), for at most four hours, ending it early
// when done. The session starts and ends with a row in the business's own audit log; every change
// made during it is tagged (actor_kind 'support') through ctx.write. A business's owners and managers
// see the sessions on their audit page and may end one.
import type { Queryable, Tx } from "../../db";
import type { AuthUser, ServerConfig, SupportLevel, SupportSession } from "../../context";
import { bad, forbidden, notFound } from "../../http/errors";
import { uuidv7 } from "@shared/id";
import { ENTITIES } from "@shared/entities";
import { faDigits } from "@shared/format";
import { securityEvent } from "./security";

export const SUPPORT_MAX_HOURS = 4;
export const SUPPORT_LEVEL_TITLE: Record<SupportLevel, string> = { view: "فقط مشاهده", edit: "مشاهده و اصلاح" };

export type SupportState = "active" | "ended" | "expired";

export interface SupportSessionRow extends SupportSession {
  org_id: string;
  admin_user_id: string;
  ended_at: string | null;
  ended_by: string | null;
  state: SupportState;
  admin_name?: string | null;
  admin_email?: string | null;
  ended_by_name?: string | null;
  org_name?: string | null;
}

const COLUMNS = `s.id, s.org_id, s.admin_user_id, s.level, s.reason, s.started_at, s.expires_at, s.ended_at, s.ended_by,
  case when s.ended_at is not null then 'ended' when s.expires_at <= now() then 'expired' else 'active' end as state`;

/** The admin's live session in a business (null when none, ended or expired). */
export async function activeSupportSession(q: Queryable, orgId: string, adminUserId: string): Promise<SupportSession | null> {
  return q.one<SupportSession>(
    `select id, level, reason, started_at, expires_at from sm_support_sessions
     where org_id = $1 and admin_user_id = $2 and ended_at is null and expires_at > now()
     order by started_at desc limit 1`,
    [orgId, adminUserId],
  );
}

export async function listSupportSessions(
  q: Queryable,
  f: { org_id?: string | null; admin_user_id?: string | null; active?: boolean; limit?: number } = {},
): Promise<SupportSessionRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.org_id) {
    params.push(f.org_id);
    where.push(`s.org_id = $${params.length}`);
  }
  if (f.admin_user_id) {
    params.push(f.admin_user_id);
    where.push(`s.admin_user_id = $${params.length}`);
  }
  if (f.active) where.push(`s.ended_at is null and s.expires_at > now()`);
  params.push(Math.min(500, Math.max(1, f.limit ?? 100)));
  return q.query<SupportSessionRow>(
    `select ${COLUMNS}, a.full_name as admin_name, a.email as admin_email, b.full_name as ended_by_name, o.name as org_name
     from sm_support_sessions s
     left join sm_users a on a.id = s.admin_user_id
     left join sm_users b on b.id = s.ended_by
     left join sm_orgs o on o.id = s.org_id
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by s.started_at desc
     limit $${params.length}`,
    params,
  );
}

const faHours = (h: number) => `${faDigits(h)} ساعت`;

async function supportAudit(
  tx: Tx,
  cfg: ServerConfig,
  e: { org_id: string; user_id: string; action: string; session_id: string; summary: string; data?: Record<string, unknown>; actor_kind: "support" | "user" },
) {
  await tx.query(
    `insert into sm_audit (id, org_id, user_id, action, entity, entity_id, summary, data, origin, actor_kind, support_session_id)
     values ($1, $2, $3, $4, 'support_session', $5, $6, $7, $8, $9, $5)`,
    [uuidv7(), e.org_id, e.user_id, e.action, e.session_id, e.summary.slice(0, 300), e.data ?? null, cfg.origin, e.actor_kind],
  );
}

export interface StartSupportInput {
  level: SupportLevel;
  reason: string;
  hours?: number;
}

/** Starts a support session (replacing the admin's earlier live one in the same business). */
export async function startSupport(
  cfg: ServerConfig,
  admin: AuthUser,
  orgId: string,
  input: StartSupportInput,
  meta: { ip?: string | null; user_agent?: string | null } = {},
): Promise<SupportSessionRow> {
  const db = cfg.db;
  if (!admin.is_platform_admin) throw forbidden("حالت پشتیبانی فقط برای مدیر سامانه است");
  const reason = input.reason.trim();
  if (reason.length < 5) throw bad("دلیل ورود را بنویسید (دست‌کم ۵ نویسه)؛ در گزارش رویدادهای کسب‌وکار دیده می‌شود");
  const hours = Math.round(input.hours ?? SUPPORT_MAX_HOURS);
  if (!(hours >= 1 && hours <= SUPPORT_MAX_HOURS)) throw bad(`مدت حالت پشتیبانی بین ۱ تا ${faHours(SUPPORT_MAX_HOURS)} است`);
  const org = await db.one<{ id: string; name: string }>(`select id, name from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("کسب‌وکار پیدا نشد");
  const member = await db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null and is_active`, [orgId, admin.id]);
  if (member) throw bad("شما عضو این کسب‌وکار هستید و با همان عضویت وارد می‌شوید");
  const id = uuidv7();
  const replaced = await db.tx(async (tx) => {
    const old = await tx.query<{ id: string }>(
      `update sm_support_sessions set ended_at = now(), ended_by = $3
       where org_id = $1 and admin_user_id = $2 and ended_at is null and expires_at > now() returning id`,
      [orgId, admin.id, admin.id],
    );
    for (const o of old)
      await supportAudit(tx, cfg, { org_id: orgId, user_id: admin.id, action: "support_end", session_id: o.id, summary: "پایان حالت پشتیبانی (با آغاز جلسهٔ تازه)", actor_kind: "support" });
    await tx.query(
      `insert into sm_support_sessions (id, org_id, admin_user_id, level, reason, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
      [id, orgId, admin.id, input.level, reason.slice(0, 500), hours],
    );
    await supportAudit(tx, cfg, {
      org_id: orgId,
      user_id: admin.id,
      action: "support_start",
      session_id: id,
      summary: `آغاز حالت پشتیبانی (${SUPPORT_LEVEL_TITLE[input.level]}، ${faHours(hours)}): ${reason}`,
      data: { level: input.level, hours },
      actor_kind: "support",
    });
    return old.map((o) => o.id);
  });
  for (const old of replaced) await securityEvent(db, { kind: "support_end", user_id: admin.id, email: admin.email, org_id: orgId, ...meta, data: { session_id: old, replaced_by: id } });
  await securityEvent(db, { kind: "support_start", user_id: admin.id, email: admin.email, org_id: orgId, ...meta, data: { session_id: id, level: input.level, hours, reason: reason.slice(0, 200) } });
  const [row] = await listSupportSessions(db, { org_id: orgId, admin_user_id: admin.id, limit: 1 });
  return row;
}

/**
 * Ends a live session: by a platform admin, or (`member`) by an owner or manager of the business,
 * who may close the door any time. Ending a session that already ended or expired changes nothing.
 */
export async function endSupport(
  cfg: ServerConfig,
  by: AuthUser,
  sessionId: string,
  opts: { member?: { org_id: string } } = {},
  meta: { ip?: string | null; user_agent?: string | null } = {},
): Promise<SupportSessionRow> {
  const db = cfg.db;
  const s = await db.one<SupportSessionRow>(`select ${COLUMNS} from sm_support_sessions s where s.id = $1`, [sessionId]);
  if (!s || (opts.member && s.org_id !== opts.member.org_id)) throw notFound("جلسهٔ پشتیبانی پیدا نشد");
  if (!opts.member && !by.is_platform_admin) throw forbidden();
  if (s.state === "active") {
    const ended = await db.tx(async (tx) => {
      const r = await tx.one(`update sm_support_sessions set ended_at = now(), ended_by = $2 where id = $1 and ended_at is null returning id`, [sessionId, by.id]);
      if (!r) return false;
      await supportAudit(tx, cfg, {
        org_id: s.org_id,
        user_id: by.id,
        action: "support_end",
        session_id: sessionId,
        summary: opts.member ? "حالت پشتیبانی به دست کسب‌وکار پایان یافت" : "پایان حالت پشتیبانی",
        actor_kind: opts.member ? "user" : "support",
      });
      return true;
    });
    if (ended)
      await securityEvent(db, { kind: "support_end", user_id: by.id, email: by.email, org_id: s.org_id, ...meta, data: { session_id: sessionId, by_member: !!opts.member, admin_user_id: s.admin_user_id } });
  }
  const [row] = await db.query<SupportSessionRow>(
    `select ${COLUMNS}, a.full_name as admin_name, a.email as admin_email, b.full_name as ended_by_name, o.name as org_name
     from sm_support_sessions s left join sm_users a on a.id = s.admin_user_id left join sm_users b on b.id = s.ended_by left join sm_orgs o on o.id = s.org_id
     where s.id = $1`,
    [sessionId],
  );
  return row;
}

export interface AccessibleOrg {
  id: string;
  name: string;
  business_kind: string;
  modules: string[];
  base_currency: string;
  money_decimals: number;
  logo: string | null;
  role: string | null;
  is_active: boolean | null;
  /** set when the platform admin enters through a support session */
  support: { level: SupportLevel; expires_at: string } | null;
}

/**
 * The businesses an account can open: its active memberships, plus — for a platform admin — the
 * businesses where he has a live support session. Nothing else: a platform admin no longer sees
 * every business here (the console lists them).
 */
export async function accessibleOrgs(q: Queryable, user: Pick<AuthUser, "id" | "is_platform_admin">): Promise<AccessibleOrg[]> {
  const rows = await q.query<AccessibleOrg & { support_level: SupportLevel | null; support_expires_at: string | null }>(
    `select o.id, o.name, o.business_kind, o.modules, o.base_currency, o.money_decimals, o.logo, m.role, m.is_active,
            s.level as support_level, s.expires_at as support_expires_at
     from sm_orgs o
     left join sm_org_members m on m.org_id = o.id and m.user_id = $1 and m.deleted_at is null
     left join lateral (
       select level, expires_at from sm_support_sessions x
       where $2::boolean and x.org_id = o.id and x.admin_user_id = $1 and x.ended_at is null and x.expires_at > now()
       order by x.started_at desc limit 1
     ) s on true
     where o.deleted_at is null and (m.is_active or s.level is not null)
     order by o.created_at`,
    [user.id, !!user.is_platform_admin],
  );
  // a member's own membership wins (support sessions are only for businesses he is not in)
  return rows.map(({ support_level, support_expires_at, ...o }) =>
    o.is_active ? { ...o, support: null } : { ...o, role: null, is_active: null, support: { level: support_level!, expires_at: support_expires_at! } },
  );
}

// ---------------------------------------------------------------- support changes in the audit log

const SECTION: Record<string, string> = {
  accounting: "حسابداری",
  treasury: "خزانه‌داری",
  goods: "کالا، خرید و فروش",
  gold: "طلا و جواهر",
  fx: "صرافی",
  integrations: "اتصال‌ها و API",
  ai: "هوش مصنوعی",
  members: "کاربران",
  "fiscal-years": "سال مالی",
  "support-sessions": "حالت پشتیبانی",
};

/** «اصلاح در «حسابداری»» for POST /api/o/<id>/accounting/vouchers. */
export function describeSupportWrite(method: string, path: string): string {
  const rest = path.replace(/^.*?\/o\/[0-9a-f-]{36}\/?/i, "");
  const [first = "", second = ""] = rest.split("/");
  const section = first === "data" ? (ENTITIES[second]?.plural ?? "اطلاعات پایه") : first ? (SECTION[first] ?? first) : "تنظیمات کسب‌وکار";
  const verb = method === "DELETE" ? "حذف" : method === "POST" ? "ثبت" : "ویرایش";
  return `${verb} در «${section}» در حالت پشتیبانی`;
}

/**
 * Inside a support session's write: unless the change already wrote its own audit row (tagged by the
 * sm_audit trigger), list it once so no support change goes unrecorded.
 */
export async function recordSupportWrite(
  tx: Tx,
  cfg: ServerConfig,
  orgId: string,
  userId: string,
  sessionId: string,
  request: { method: string; path: string } | null,
): Promise<void> {
  const logged = await tx.one(`select 1 from sm_audit where org_id = $1 and support_session_id = $2 and at = now() limit 1`, [orgId, sessionId]);
  if (logged) return;
  const path = request?.path.replace(/^.*?\/o\/[0-9a-f-]{36}/i, "") ?? null;
  await tx.query(
    `insert into sm_audit (id, org_id, user_id, action, entity, summary, data, origin, actor_kind, support_session_id)
     values ($1, $2, $3, 'support_write', null, $4, $5, $6, 'support', $7)`,
    [uuidv7(), orgId, userId, request ? describeSupportWrite(request.method, request.path) : "تغییر در حالت پشتیبانی", request ? { method: request.method, path } : null, cfg.origin, sessionId],
  );
}

// The organisation's sign-in and session policy on the server (src/shared/auth/policy.ts holds the rules): the
// policy a new session is issued under, the guard every organisation request passes (a directory sign-in reaches only
// its organisation; a local password reaches an organisation that closed local sign-in only for its break-glass
// accounts), re-authentication before sensitive administration, and tightening the sessions already open when an
// administrator makes the policy stricter.
import type { Context } from "hono";
import type { AuthSession, AuthUser, Ctx, OrgRow } from "../context";
import type { Queryable } from "../db";
import { AppError, forbidden } from "../http/errors";
import { DEFAULT_POLICY, normalizePolicy, strictestSession, type AuthPolicy, type SessionPolicy } from "@shared/auth/policy";

/** The organisation's policy (its settings.auth, normalised). */
export function orgPolicy(org: Pick<OrgRow, "settings"> | null | undefined): AuthPolicy {
  return normalizePolicy((org?.settings as Record<string, unknown> | undefined)?.auth);
}

/** The session policy of an organisation (a directory sign-in there). */
export async function orgSessionPolicy(q: Queryable, orgId: string): Promise<SessionPolicy> {
  const r = await q.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  return orgPolicy({ settings: r?.settings ?? {} }).session;
}

/** The strictest session policy of the organisations a person is an active member of (a local sign-in). */
export async function userSessionPolicy(q: Queryable, userId: string): Promise<SessionPolicy> {
  const rows = await q.query<{ settings: Record<string, unknown> | null }>(
    `select o.settings from sm_org_members m join sm_orgs o on o.id = m.org_id
     where m.user_id = $1 and m.deleted_at is null and m.is_active and o.deleted_at is null`,
    [userId],
  );
  return strictestSession(rows.map((r) => orgPolicy({ settings: r.settings ?? {} }).session));
}

/**
 * May a local password sign-in still be used for this person? Refused only when every organisation they are an active
 * member of has closed local sign-in and none lists them as a break-glass account (platform administrators always may:
 * the installation's owner keeps a way in).
 */
export async function localLoginAllowed(q: Queryable, user: Pick<AuthUser, "id" | "is_platform_admin">): Promise<boolean> {
  if (user.is_platform_admin) return true;
  const rows = await q.query<{ settings: Record<string, unknown> | null }>(
    `select o.settings from sm_org_members m join sm_orgs o on o.id = m.org_id
     where m.user_id = $1 and m.deleted_at is null and m.is_active and o.deleted_at is null`,
    [user.id],
  );
  if (!rows.length) return true;
  return rows.some((r) => {
    const p = orgPolicy({ settings: r.settings ?? {} });
    return p.local_login === "all" || p.breakglass.includes(user.id);
  });
}

export const OTHER_ORG_MESSAGE = "این نشست با حساب سازمانی سازمان دیگری باز شده است؛ برای کار در این سازمان، از حساب خارج شوید و دوباره وارد شوید";
export const LOCAL_CLOSED_MESSAGE = "ورود با ایمیل و رمز عبور در این سازمان بسته است؛ با حساب سازمانی وارد شوید";

/**
 * The guard of every organisation request (loadOrg, sync): a session opened through an organisation's directory
 * reaches only that organisation, and a local password session reaches an organisation that allows only directory
 * sign-in only for its break-glass accounts. Support sessions of platform administrators are not members' sessions.
 */
export function guardOrgSession(org: Pick<OrgRow, "id" | "settings">, session: AuthSession | undefined | null, user: Pick<AuthUser, "id">, member: { id: string } | null, mode?: string): void {
  if (!session) return;
  if (session.org_id && session.org_id !== org.id) throw forbidden(OTHER_ORG_MESSAGE);
  // the Windows app signs its people in locally (the directory's secrets never travel to it): its policy copy does not close that
  if (mode === "desktop") return;
  const method = session.auth_method ?? "password";
  if (!member?.id || session.kind !== "web" || !(method === "password" || method === "signup" || method === "recover")) return;
  const p = orgPolicy(org);
  if (p.local_login === "breakglass" && !p.breakglass.includes(user.id)) throw forbidden(LOCAL_CLOSED_MESSAGE);
}

export const REAUTH_CODE = "reauth_required";

/**
 * Sensitive administration (the security policy, directory sign-in settings and mappings, roles, other people's
 * sessions, passwords) needs a recent proof of identity: a sign-in or a re-authentication within the organisation's
 * reauth minutes. Otherwise 401 `reauth_required` — the screens ask for the password (or Windows) and retry.
 */
export function needRecentAuth(ctx: Pick<Ctx, "org" | "actor"> & { session?: AuthSession | null }, session?: AuthSession | null): void {
  const s = session ?? ctx.session ?? null;
  if (!s || ctx.actor === "system") return;
  const minutes = orgPolicy(ctx.org).session.reauth_minutes;
  if (minutes <= 0) return;
  const at = Date.parse(String(s.reauth_at ?? s.created_at ?? ""));
  if (Number.isFinite(at) && Date.now() - at <= minutes * 60_000) return;
  throw new AppError(401, REAUTH_CODE, "برای این کار دوباره هویت خود را تأیید کنید", { minutes, method: s.auth_method ?? "password" });
}

/** needRecentAuth for a route handler (the session of the request). */
export function needRecentAuthOf(c: Context, ctx: Ctx): void {
  needRecentAuth(ctx, (c as unknown as { get(k: "session"): AuthSession | undefined }).get("session") ?? null);
}

/**
 * needRecentAuth for the platform owner's console (no organisation in the request): the strictest re-authentication
 * window of the owner's organisations, and DEFAULT_POLICY's when none sets one — the console's sensitive actions
 * (backup files and restores, the server edition's air-gap allowlist, its configuration) always ask again.
 */
export async function needRecentPlatformAuth(c: Context): Promise<void> {
  const s = (c as unknown as { get(k: "session"): AuthSession | undefined }).get("session") ?? null;
  const user = (c as unknown as { get(k: "user"): AuthUser | undefined }).get("user");
  const cfg = (c as unknown as { get(k: "cfg"): { db: Queryable } | undefined }).get("cfg");
  if (!s || !user || !cfg) return;
  const minutes = (await userSessionPolicy(cfg.db, user.id)).reauth_minutes || DEFAULT_POLICY.session.reauth_minutes;
  const at = Date.parse(String(s.reauth_at ?? s.created_at ?? ""));
  if (Number.isFinite(at) && Date.now() - at <= minutes * 60_000) return;
  throw new AppError(401, REAUTH_CODE, "برای این کار دوباره هویت خود را تأیید کنید", { minutes, method: s.auth_method ?? "password" });
}

/**
 * Bring the sessions already open in line with a stricter policy: the organisation's directory sessions and its
 * members' local sessions get the shorter idle timeout and absolute end (never a longer one).
 */
export async function tightenSessions(q: Queryable, orgId: string, s: SessionPolicy): Promise<number> {
  const rows = await q.query(
    `update sm_sessions x set
       idle_minutes = case when $2::int > 0 and (x.idle_minutes = 0 or x.idle_minutes > $2::int) then $2::int else x.idle_minutes end,
       expires_at = least(x.expires_at, x.created_at + make_interval(hours => $3::int))
     where x.revoked_at is null and x.kind = 'web'
       and (x.org_id = $1 or (x.org_id is null and x.user_id in (select user_id from sm_org_members where org_id = $1 and deleted_at is null and is_active)))
       and (($2::int > 0 and (x.idle_minutes = 0 or x.idle_minutes > $2::int)) or x.expires_at > x.created_at + make_interval(hours => $3::int))
     returning x.id`,
    [orgId, s.idle_minutes, s.absolute_hours],
  );
  return rows.length;
}

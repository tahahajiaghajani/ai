// Sign-in through an organisation's directory — the flows behind /api/auth/directory and /api/auth/sso, around the
// directory work in modules/integration/directory-login.ts:
//   · an empty password is refused before anything else (an empty simple bind «succeeds» on LDAP servers);
//   · rate limits per client address (in memory) and the persisted local lockout per login name and address
//     (src/server/auth/throttle.ts) keep password spraying away from the domain controllers;
//   · every attempt — method, source, address, result and reason — is a security event (sign_in), the organisation's
//     sign-in audit; repeated failures, a source that cannot reach its domain controllers and spraying across many
//     names tell the organisation's administrators (notification service, at most once an hour each);
//   · refusals never tell whether an account exists unless the password (or Windows) proved the person (shared rules
//     in src/shared/auth/login.ts), and failures take a similar time whatever happened;
//   · a person the directory refuses as disabled or expired loses the sessions this organisation's sign-ins opened;
//   · the session is the organisation's: it reaches only that organisation, under its session policy.
import type { Context } from "hono";
import { APP_NAME } from "@shared/constants";
import { entryFromLdap } from "@shared/integration/directory";
import { GENERIC_LOGIN_MESSAGE, loginMessage, parseLogin, principalParts, VERIFIED_REASONS, type LoginReason, type ParsedLogin } from "@shared/auth/login";
import type { ServerConfig } from "../context";
import type { Queryable } from "../db";
import { AppError } from "../http/errors";
import { rateLimit } from "../http/hono";
import { securityEvent } from "../modules/platform/security";
import { notifyPeople } from "../modules/notify";
import {
  directoryIdentity, loadLoginSource, LoginFailure, provisionMember, routeLogin, verifyDirectoryPassword, type LoginSourceConfig, type ProvisionResult,
} from "../modules/integration/directory-login";
import { clientIp, issueSession, revokeUserSessions, setSessionCookie, type AuthMethod, type IssuedSession } from "./session";
import { orgPolicy } from "./policy";
import { clearFailures, ipKey, lockedUntil, loginKey, recordFailure, sourceFailure, sourceKey } from "./throttle";

/** Failures that count towards the local lockout (a guess at a password or a name). */
const COUNTED = new Set<LoginReason>(["unknown_account", "wrong_password", "locked", "ambiguous_account"]);
/** Failures of the installation, not of the person: the administrators hear of them. */
const CONFIG = new Set<LoginReason>(["dc_unreachable", "tls", "config", "service_bind", "not_approved", "feature_off"]);

export function statusOf(reason: LoginReason): number {
  if (reason === "empty_password" || reason === "bad_login" || reason === "unknown_domain" || reason === "ambiguous_domain" || reason === "no_source") return 400;
  if (reason === "rate_limited") return 429;
  if (CONFIG.has(reason) || reason === "sso_unavailable") return 503;
  return 401;
}

/** The error a refused sign-in answers with: the reason's sentence, the generic one when nothing was proven. */
export function loginError(reason: LoginReason): AppError {
  const status = statusOf(reason);
  const message = status === 401 && !VERIFIED_REASONS.has(reason) && reason !== "local_disabled" && !reason.startsWith("sso") && !reason.startsWith("proxy") && reason !== "ntlm_refused" ? GENERIC_LOGIN_MESSAGE : loginMessage(reason, APP_NAME);
  return new AppError(status, status === 429 ? "rate_limited" : status === 503 ? "directory_unavailable" : status === 400 ? "bad_request" : "sign_in_refused", message, { reason: VERIFIED_REASONS.has(reason) ? reason : undefined });
}

/**
 * Failures take at least ~0.6–0.9 s whatever happened (an unknown name costs one search, a wrong password a search and
 * a bind), so timing does not tell an unknown name from a known one — and guessing stays slow.
 */
async function pad(started: number): Promise<void> {
  const wait = 600 + Math.floor(Math.random() * 300) - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const ADMIN_ROLES = ["owner", "admin"];

/** The organisation's administrators (owners and «مدیر»s who are active). */
async function adminsOf(db: Queryable, orgId: string): Promise<string[]> {
  const rows = await db.query<{ user_id: string }>(
    `select m.user_id from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.deleted_at is null and m.is_active and not u.disabled and m.role = any($2::text[])`,
    [orgId, `{${ADMIN_ROLES.join(",")}}`],
  );
  return rows.map((r) => r.user_id);
}

/** A security notification to the organisation's administrators (in the app and by e-mail; never fails the request). */
export async function notifyAdmins(cfg: ServerConfig, orgId: string, sourceId: string, subject: string, body: string): Promise<void> {
  try {
    const users = await adminsOf(cfg.db, orgId);
    if (!users.length) return;
    await notifyPeople(cfg.db, orgId, { table: "directory_source", id: sourceId, users, subject, body, short_text: subject, label: "امنیت ورود", source: "امنیت ورود", channels: ["in_app", "email"], mandatory: true });
  } catch (e) {
    cfg.log.warn("security notification failed", String((e as Error)?.message ?? e));
  }
}

interface Attempt {
  method: AuthMethod;
  login: string;
  /** what the local lockout counts: the account part of the login name, whatever form it was typed in */
  lockName?: string;
  ip: string;
  userAgent: string | null;
  sourceId: string | null;
  orgId: string | null;
}

async function audit(cfg: ServerConfig, a: Attempt, ok: boolean, extra: { reason?: LoginReason; user_id?: string | null; email?: string | null; detail?: string | null; dc?: string | null; result?: Partial<ProvisionResult> } = {}) {
  await securityEvent(cfg.db, {
    kind: "sign_in",
    ok,
    user_id: extra.user_id ?? null,
    email: (extra.email ?? a.login).slice(0, 200),
    org_id: a.orgId,
    ip: a.ip,
    user_agent: a.userAgent,
    data: {
      method: a.method,
      source: a.sourceId,
      ...(a.login && extra.email && extra.email !== a.login ? { login: a.login.slice(0, 200) } : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.detail ? { detail: extra.detail.slice(0, 300) } : {}),
      ...(extra.dc ? { dc: extra.dc } : {}),
      ...(extra.result?.created ? { created: true } : {}),
      ...(extra.result?.pending_roles?.length ? { pending_roles: extra.result.pending_roles.slice(0, 20) } : {}),
      ...(extra.result?.problems?.length ? { problems: extra.result.problems.slice(0, 5) } : {}),
    },
  });
}

/** A person the directory now refuses (disabled, expired) loses the sessions this organisation's sign-ins opened. */
async function revokeRefused(cfg: ServerConfig, f: LoginFailure): Promise<void> {
  if (!f.known.org_id || !f.known.source_id || !f.known.external_id) return;
  if (!["disabled", "account_expired"].includes(f.reason)) return;
  const link = await cfg.db.one<{ local_id: string }>(`select local_id from sm_directory_links where source_id = $1 and kind = 'user' and external_id = $2`, [f.known.source_id, f.known.external_id]);
  if (!link) return;
  const n = await revokeUserSessions(cfg.db, link.local_id, { reason: "directory", orgId: f.known.org_id });
  if (n) await securityEvent(cfg.db, { kind: "sessions_revoked", user_id: link.local_id, org_id: f.known.org_id, data: { reason: f.reason, by: "directory", sessions: n } });
}

/** What a failure does: counters (and the notifications they raise), the audit, sessions of refused people. */
async function onFailure(cfg: ServerConfig, a: Attempt, f: LoginFailure, conf: LoginSourceConfig | null, lockout: ReturnType<typeof orgPolicy>["lockout"] | null): Promise<void> {
  const orgId = f.known.org_id ?? a.orgId;
  const sourceId = f.known.source_id ?? a.sourceId;
  if (orgId && sourceId && lockout && COUNTED.has(f.reason)) {
    const name = conf?.name ?? "";
    const byName = await recordFailure(cfg.db, loginKey(orgId, sourceId, a.lockName ?? a.login), lockout.threshold, lockout.window_minutes, lockout.lock_minutes);
    const byIp = await recordFailure(cfg.db, ipKey(orgId, a.ip), lockout.ip_threshold, lockout.window_minutes, lockout.lock_minutes);
    const spraying = await sourceFailure(cfg.db, sourceKey(orgId, sourceId, name), Math.max(50, lockout.ip_threshold * 3), lockout.window_minutes);
    if (byName.notify)
      await notifyAdmins(cfg, orgId, sourceId, `قفل موقت ورود «${a.login}»`, `پس از ${byName.failures} تلاش ناموفق، ورود با نام «${a.login}» از راه «${name}» برای ${lockout.lock_minutes} دقیقه بسته شد (نشانی ${a.ip}). اگر این تلاش‌ها از صاحب حساب نبوده، گزارش ورودها را بررسی کنید.`);
    if (byIp.notify)
      await notifyAdmins(cfg, orgId, sourceId, `تلاش‌های ناموفق پیاپی از ${a.ip}`, `از نشانی ${a.ip} ${byIp.failures} ورود ناموفق با نام‌های گوناگون رسید؛ این نشانی برای ${lockout.lock_minutes} دقیقه کنار گذاشته شد. ممکن است حملهٔ حدس گذرواژه (password spraying) باشد.`);
    if (spraying)
      await notifyAdmins(cfg, orgId, sourceId, `ورودهای ناموفق زیاد در «${name}»`, `در ${lockout.window_minutes} دقیقهٔ گذشته ورودهای ناموفق زیادی از راه «${name}» ثبت شد. گزارش ورودها را بررسی کنید.`);
  }
  if (orgId && sourceId && CONFIG.has(f.reason)) {
    const first = await recordFailure(cfg.db, sourceKey(orgId, sourceId, `${conf?.name ?? ""}|cfg`), 1, 60, 1);
    if (first.notify) await notifyAdmins(cfg, orgId, sourceId, `ورود با حساب سازمانی کار نمی‌کند`, `ورود از راه «${conf?.name ?? ""}» انجام نشد: ${f.detail ?? loginMessage(f.reason, APP_NAME)}`);
  }
  if (VERIFIED_REASONS.has(f.reason)) await revokeRefused(cfg, f).catch(() => undefined);
  await audit(cfg, { ...a, orgId, sourceId }, false, { reason: f.reason, user_id: f.known.user_id ?? null, detail: f.detail, dc: f.known.dc ?? null });
}

export interface SignedIn extends IssuedSession {
  user_id: string;
  org_id: string;
  source_id: string;
  result: ProvisionResult;
}

/** Issue the organisation's session for a provisioned member and record the success. */
async function finish(c: Context, cfg: ServerConfig, a: Attempt, conf: LoginSourceConfig, result: ProvisionResult, dc: string | null): Promise<SignedIn> {
  const org = await cfg.db.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [conf.orgId]);
  const policy = orgPolicy({ settings: org?.settings ?? {} });
  const issued = await issueSession(cfg.db, result.user_id, "web", {
    ip: a.ip,
    userAgent: a.userAgent ?? undefined,
    method: a.method,
    orgId: conf.orgId,
    sourceId: conf.id,
    login: a.login,
    policy: policy.session,
  });
  setSessionCookie(c, issued.token, issued.maxAge);
  await audit(cfg, a, true, { user_id: result.user_id, email: result.email, dc, result });
  return { ...issued, user_id: result.user_id, org_id: conf.orgId, source_id: conf.id, result };
}

/** «ورود با حساب سازمانی»: a login name and a password checked by the organisation's domain controllers. */
export async function directorySignIn(c: Context, cfg: ServerConfig, input: { login: string; password: string; source?: string | null }): Promise<SignedIn> {
  const started = Date.now();
  const ip = clientIp(c);
  const userAgent = c.req.header("user-agent") ?? null;
  const parsed = parseLogin(input.login);
  const a: Attempt = { method: "ldap", login: parsed?.key ?? String(input.login ?? "").trim().slice(0, 200), lockName: parsed?.name.toLowerCase(), ip, userAgent, sourceId: null, orgId: null };
  if (!parsed) throw loginError("bad_login");
  // an empty password is an unauthenticated bind that «succeeds»: refused before anything else is asked
  if (typeof input.password !== "string" || input.password.length === 0) throw loginError("empty_password");
  try {
    rateLimit(`dir-login:${ip}`, 40, 60_000);
  } catch {
    await audit(cfg, a, false, { reason: "rate_limited" });
    throw loginError("rate_limited");
  }
  let conf: LoginSourceConfig | null = null;
  let lockout: ReturnType<typeof orgPolicy>["lockout"] | null = null;
  try {
    const ref = await routeLogin(cfg, parsed, input.source ?? null);
    a.sourceId = ref.id;
    a.orgId = ref.org_id;
    const loaded = await loadLoginSource(cfg, ref);
    conf = loaded.conf;
    lockout = orgPolicy(await cfg.db.one(`select settings from sm_orgs where id = $1`, [ref.org_id])).lockout;
    if (await lockedUntil(cfg.db, ipKey(ref.org_id, ip))) throw new LoginFailure("rate_limited", "نشانی پس از تلاش‌های ناموفق کنار گذاشته شده است", { org_id: ref.org_id, source_id: ref.id });
    // a login name locked here is refused without asking the domain controllers (they never see the guesses); every
    // form of one name (ali, CORP\ali, ali@corp…) counts together
    const lockName = parsed.name.toLowerCase();
    if (await lockedUntil(cfg.db, loginKey(ref.org_id, ref.id, lockName))) throw new LoginFailure("throttled", null, { org_id: ref.org_id, source_id: ref.id });
    const identity = await verifyDirectoryPassword(cfg, loaded.sys, conf, parsed, input.password);
    const result = await provisionMember(cfg, conf, identity, loaded.src);
    await clearFailures(cfg.db, loginKey(ref.org_id, ref.id, lockName));
    return await finish(c, cfg, a, conf, result, identity.dc);
  } catch (e) {
    if (!(e instanceof LoginFailure)) throw e;
    await onFailure(cfg, a, e, conf, lockout);
    if (statusOf(e.reason) === 401) await pad(started);
    throw loginError(e.reason);
  }
}

/** Single sign-on: a principal Windows (Kerberos through Negotiate, or the trusted proxy) vouched for. */
export async function principalSignIn(c: Context, cfg: ServerConfig, principal: string, method: "sso" | "proxy", hint: string | null, fixed?: { sourceId: string; orgId: string }): Promise<SignedIn> {
  const ip = clientIp(c);
  const userAgent = c.req.header("user-agent") ?? null;
  const parts = principalParts(principal);
  const a: Attempt = { method, login: String(principal).trim().toLowerCase().slice(0, 200), ip, userAgent, sourceId: fixed?.sourceId ?? null, orgId: fixed?.orgId ?? null };
  if (!parts) {
    await audit(cfg, a, false, { reason: "sso_failed", detail: "نام کاربر خوانده نشد" });
    throw loginError("sso_failed");
  }
  const parsed: ParsedLogin = { form: parts.domain ? (principal.includes("\\") ? "netbios" : "upn") : "plain", name: parts.name, domain: parts.domain, key: a.login };
  let conf: LoginSourceConfig | null = null;
  try {
    const ref = fixed ? { id: fixed.sourceId, org_id: fixed.orgId } : await routeLogin(cfg, parsed, hint, method === "sso" ? "negotiate" : "proxy");
    a.sourceId = ref.id;
    a.orgId = ref.org_id;
    const loaded = await loadLoginSource(cfg, ref);
    conf = loaded.conf;
    if (parts.domain && conf.domains.length && !conf.domains.some((d) => d.toLowerCase() === parts.domain)) throw new LoginFailure("unknown_domain", null, { org_id: ref.org_id, source_id: ref.id });
    const identity = await directoryIdentity(cfg, loaded.sys, conf, parts.name, parts.domain);
    const result = await provisionMember(cfg, conf, identity, loaded.src);
    return await finish(c, cfg, a, conf, result, identity.dc);
  } catch (e) {
    if (!(e instanceof LoginFailure)) throw e;
    await onFailure(cfg, a, e, conf, null);
    // Windows proved who this is: the directory's reason may be told (unless the account is unknown here)
    throw e.reason === "unknown_account" || e.reason === "ambiguous_account" ? loginError("sso_failed") : loginError(e.reason);
  }
}

/** Record a refused single sign-on that never reached a person (spoofed proxy headers, a bad token…). */
export async function ssoRefused(c: Context, cfg: ServerConfig, reason: LoginReason, method: "sso" | "proxy", known: { orgId?: string | null; sourceId?: string | null; detail?: string | null; principal?: string | null } = {}): Promise<AppError> {
  await audit(cfg, { method, login: (known.principal ?? "").toLowerCase().slice(0, 200), ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null, sourceId: known.sourceId ?? null, orgId: known.orgId ?? null }, false, { reason, detail: known.detail ?? null });
  if (reason === "proxy_untrusted" && known.orgId && known.sourceId) {
    const first = await recordFailure(cfg.db, sourceKey(known.orgId, known.sourceId, "proxy"), 1, 60, 1);
    if (first.notify)
      await notifyAdmins(cfg, known.orgId, known.sourceId, "سرآیند ورود ویندوز از نشانی نامعتبر", `درخواستی با سرآیند کاربر پراکسی از نشانی ${clientIp(c)} رسید که در فهرست پراکسی‌های معتمد نیست و پذیرفته نشد. ممکن است کسی بخواهد خود را جای دیگری جا بزند.`);
  }
  return loginError(reason);
}

/** Re-authentication with the directory (a session opened with a domain account): the same person, a fresh proof. */
export async function directoryReauth(cfg: ServerConfig, session: { user_id: string; org_id?: string | null; source_id?: string | null }, login: string, password: string): Promise<boolean> {
  if (!session.source_id || !session.org_id) return false;
  const parsed = parseLogin(login);
  if (!parsed || !password) return false;
  try {
    const { conf, sys } = await loadLoginSource(cfg, { id: session.source_id, org_id: session.org_id });
    const identity = await verifyDirectoryPassword(cfg, sys, conf, parsed, password);
    const external = entryFromLdap(identity.entry.dn, identity.entry.attrs, conf.map).external_id;
    const link = await cfg.db.one<{ local_id: string }>(`select local_id from sm_directory_links where source_id = $1 and kind = 'user' and external_id = $2 and active`, [conf.id, external]);
    return !!link && link.local_id === session.user_id;
  } catch (e) {
    if (e instanceof LoginFailure) return false;
    throw e;
  }
}

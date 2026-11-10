// Sessions: an opaque token `<session id>.<secret>` kept in an HttpOnly cookie (browser) or sent
// as `Authorization: Bearer` (desktop sync). Only a hash of the secret is stored.
//
// A session carries how it was opened (auth_method), the organisation a directory sign-in reaches alone (org_id) and
// the session policy it was issued under (src/shared/auth/policy.ts): its absolute end (expires_at), its idle timeout
// (idle_minutes: ended once the person has been away that long), a browser-only cookie, and when the person last
// proved who they are (reauth_at, for sensitive administration). The cookie is Secure on HTTPS — automatically, with
// X-Forwarded-Proto believed only from a trusted proxy — or as the installation says (cfg.auth / ITSM_COOKIE_SECURE).
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Db, Queryable } from "../db";
import type { AuthSession, AuthUser, ServerConfig } from "../context";
import type { SessionPolicy } from "@shared/auth/policy";
import { ipAllowed } from "@shared/integration/scopes";
import { randomToken, sha256 } from "./password";
import { timingSafeEqual } from "node:crypto";

export const COOKIE = "itsm_session";
const WEB_DAYS = 30;
const DEVICE_DAYS = 365;

export type AuthMethod = "password" | "ldap" | "sso" | "proxy" | "device" | "signup" | "recover";

export interface IssuedSession {
  token: string;
  session: AuthSession;
  /** the cookie's lifetime in seconds; null: a browser-only cookie */
  maxAge: number | null;
}

export interface SessionMeta {
  deviceName?: string;
  ip?: string;
  userAgent?: string;
  method?: AuthMethod;
  /** a directory sign-in: the organisation the session reaches alone */
  orgId?: string | null;
  sourceId?: string | null;
  /** the login name typed (normalised), kept for re-authentication with the directory */
  login?: string | null;
  /** the session policy it is issued under (the organisation's, or the strictest of the person's organisations) */
  policy?: SessionPolicy | null;
}

const SESSION_COLUMNS = "id, user_id, kind, expires_at, auth_method, org_id, source_id, reauth_at, created_at";

export async function issueSession(db: Db, userId: string, kind: AuthSession["kind"], meta: SessionMeta = {}): Promise<IssuedSession> {
  const secret = randomToken(32);
  const policy = kind === "web" ? (meta.policy ?? null) : null;
  const hours = kind === "device" ? DEVICE_DAYS * 24 : policy ? policy.absolute_hours : WEB_DAYS * 24;
  const expires = new Date(Date.now() + hours * 3600_000).toISOString();
  const row = await db.one<AuthSession>(
    `insert into sm_sessions (user_id, token_hash, kind, device_name, ip, user_agent, expires_at, auth_method, org_id, source_id, login, reauth_at, idle_minutes, browser_only)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13) returning ${SESSION_COLUMNS}`,
    [
      userId,
      sha256(secret),
      kind,
      meta.deviceName ?? null,
      meta.ip ?? null,
      (meta.userAgent ?? "").slice(0, 300) || null,
      expires,
      meta.method ?? (kind === "device" ? "device" : "password"),
      meta.orgId ?? null,
      meta.sourceId ?? null,
      meta.login?.slice(0, 256) ?? null,
      policy?.idle_minutes ?? 0,
      !!policy?.browser_session,
    ],
  );
  // one active browser session per person: a new sign-in ends the others
  if (policy?.single_session) {
    await db.query(`update sm_sessions set revoked_at = now(), revoke_reason = 'single_session' where user_id = $1 and id <> $2 and kind = 'web' and revoked_at is null`, [userId, row!.id]);
  }
  await db.query("update sm_users set last_login_at = now() where id = $1", [userId]);
  return { token: `${row!.id}.${secret}`, session: row!, maxAge: policy?.browser_session ? null : Math.floor((hours * 3600_000) / 1000) };
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type SessionRow = AuthSession & { token_hash: string; revoked_at: string | null; last_seen_at: string; idle_minutes: number | null };

/**
 * The header a client sends on requests the person did not make (the live pulse, refresh timers): they never count
 * as activity, so the idle timeout ends a session left open on a visible screen.
 */
export const BACKGROUND_HEADER = "x-itsm-background";

export async function resolveToken(db: Db, token: string | undefined | null, opts: { background?: boolean } = {}): Promise<{ user: AuthUser; session: AuthSession } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !secret) return null;
  const row = await db.one<SessionRow>(`select ${SESSION_COLUMNS}, token_hash, revoked_at, last_seen_at, idle_minutes from sm_sessions where id = $1`, [id]);
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!safeEq(row.token_hash, sha256(secret))) return null;
  const idle = Number(row.idle_minutes ?? 0);
  const quiet = Date.now() - new Date(row.last_seen_at).getTime();
  if (idle > 0 && quiet > idle * 60_000) {
    await db.query(`update sm_sessions set revoked_at = now(), revoke_reason = 'idle' where id = $1 and revoked_at is null`, [row.id]);
    return null;
  }
  const user = await db.one<AuthUser>(
    `select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`,
    [row.user_id],
  );
  if (!user || user.disabled) return null;
  // sliding activity stamp: every 10 minutes, or often enough for the idle timeout to be measured within a tenth —
  // never from a background request while the session has an idle timeout (it would keep an abandoned screen alive)
  const every = idle > 0 ? Math.max(30_000, (idle * 60_000) / 10) : 600_000;
  if (quiet > every && !(idle > 0 && opts.background)) await db.query("update sm_sessions set last_seen_at = now() where id = $1", [row.id]);
  return {
    user,
    session: { id: row.id, user_id: row.user_id, kind: row.kind, expires_at: row.expires_at, auth_method: row.auth_method ?? null, org_id: row.org_id ?? null, source_id: row.source_id ?? null, reauth_at: row.reauth_at ?? null, created_at: row.created_at ?? null },
  };
}

export function tokenFromRequest(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return getCookie(c, COOKIE) ?? null;
}

// ---------------------------------------------------------------- where a request comes from

const cfgOf = (c: Context): ServerConfig | undefined => (c as unknown as { get?(k: "cfg"): ServerConfig | undefined }).get?.("cfg");

/** The TCP peer of the request (the Node server's socket); null where the platform hides it (Vercel, tests). */
export function peerAddress(c: Context): string | null {
  const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return remote ? remote.replace(/^::ffff:/, "") : null;
}

function trustedList(cfg: ServerConfig | undefined): string[] {
  const own = cfg?.auth?.trustedProxies;
  const raw = own ?? String(process.env.ITSM_TRUSTED_PROXIES ?? "").split(/[\s,;]+/);
  return raw.map((x) => x.trim()).filter(Boolean);
}

const isLoopback = (ip: string) => ip === "::1" || /^127\./.test(ip);

/**
 * Is `ip` one of the proxies on `list` (or loopback, a proxy on the same server)? The one rule for the installation's
 * reverse proxies — the server edition's HTTP front applies it to the TCP peer before the API sees the request.
 */
export function proxyTrusted(list: readonly string[], ip: string | null | undefined): boolean {
  if (!ip) return false;
  const a = ip.replace(/^::ffff:/, "");
  if (isLoopback(a)) return true;
  return list.length > 0 && ipAllowed(a, [...list]);
}

/** Is `ip` this installation's own reverse proxy (loopback, or listed in cfg.auth.trustedProxies / ITSM_TRUSTED_PROXIES)? */
export function isTrustedProxy(cfg: ServerConfig | undefined, ip: string | null | undefined): boolean {
  return proxyTrusted(trustedList(cfg), ip);
}

/** Has this installation listed its reverse proxies (cfg.auth.trustedProxies / ITSM_TRUSTED_PROXIES)? */
export const proxiesListed = (cfg: ServerConfig | undefined): boolean => cfg?.auth?.trustedProxies !== undefined || !!String(process.env.ITSM_TRUSTED_PROXIES ?? "").trim();

const stripPort = (hop: string) => {
  const h = hop.trim().replace(/^"|"$/g, "");
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(h);
  if (v6) return v6[1];
  return /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(h) ? h.slice(0, h.lastIndexOf(":")) : h;
};

/**
 * The client's address. Where the platform hides the socket (Vercel), the first X-Forwarded-For hop its proxy set;
 * on a Node server, the socket's peer — and X-Forwarded-For only when that peer is a trusted proxy (the nearest hop
 * that is not one of ours), so a client cannot choose its own address for rate limits and the audit.
 */
export function clientIp(c: Context): string {
  return clientIpUnder(c, trustedList(cfgOf(c)));
}

/**
 * clientIp under an explicit list of the installation's reverse proxies — for code in front of the API that has no
 * cfg (the server edition's first-run setup reads kariz.json trusted_proxies).
 */
export function clientIpUnder(c: Context, proxies: readonly string[]): string {
  const peer = peerAddress(c);
  const xff = c.req.header("x-forwarded-for");
  if (peer === null) {
    if (xff) return stripPort(xff.split(",")[0]);
    return c.req.header("x-real-ip") ?? "local";
  }
  if (!proxyTrusted(proxies, peer)) return peer;
  if (!xff) return c.req.header("x-real-ip")?.trim() || peer;
  const hops = xff.split(",").map(stripPort).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!proxyTrusted(proxies, hops[i])) return hops[i];
  return hops[0] ?? peer;
}

/** Did the request reach the installation over HTTPS? (X-Forwarded-Proto only from a trusted proxy.) */
export function isHttps(c: Context): boolean {
  if (new URL(c.req.url).protocol === "https:") return true;
  const proto = c.req.header("x-forwarded-proto");
  if (!proto) return false;
  const peer = peerAddress(c);
  if (peer !== null && !isTrustedProxy(cfgOf(c), peer)) return false;
  return proto.split(",")[0].trim().toLowerCase() === "https";
}

/** The Secure flag of the session cookie: "auto" (HTTPS requests), "always" or "never" (development only). */
export function cookieSecure(c: Context): boolean {
  const cfg = cfgOf(c);
  const mode = cfg?.auth?.cookieSecure ?? (String(process.env.ITSM_COOKIE_SECURE ?? "").toLowerCase() || "auto");
  if (mode === "always") return true;
  if (mode === "never") return false;
  return isHttps(c);
}

function sameSite(c: Context): "Lax" | "Strict" {
  const cfg = cfgOf(c);
  const v = cfg?.auth?.cookieSameSite ?? (String(process.env.ITSM_COOKIE_SAMESITE ?? "").toLowerCase() === "strict" ? "Strict" : "Lax");
  return v === "Strict" ? "Strict" : "Lax";
}

/** Set the session cookie; `maxAge` null makes it end with the browser (the policy's «browser session»). */
export function setSessionCookie(c: Context, token: string, maxAge: number | null = WEB_DAYS * 86400) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: sameSite(c),
    secure: cookieSecure(c),
    path: "/",
    ...(maxAge === null ? {} : { maxAge }),
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE, { path: "/", secure: cookieSecure(c) });
}

export async function revokeSession(db: Queryable, sessionId: string, reason = "sign_out") {
  await db.query("update sm_sessions set revoked_at = now(), revoke_reason = coalesce(revoke_reason, $2) where id = $1 and revoked_at is null", [sessionId, reason]);
}

/** End sessions of a person (all of them, or those of one organisation's directory sign-ins); how many ended. */
export async function revokeUserSessions(db: Queryable, userId: string, opts: { reason: string; orgId?: string | null; exceptId?: string | null; webOnly?: boolean } = { reason: "admin" }): Promise<number> {
  const params: unknown[] = [userId, opts.reason];
  const where = ["user_id = $1", "revoked_at is null"];
  if (opts.orgId) where.push(`org_id = $${params.push(opts.orgId)}`);
  if (opts.exceptId) where.push(`id <> $${params.push(opts.exceptId)}`);
  if (opts.webOnly) where.push(`kind = 'web'`);
  const rows = await db.query(`update sm_sessions set revoked_at = now(), revoke_reason = $2 where ${where.join(" and ")} returning id`, params);
  return rows.length;
}

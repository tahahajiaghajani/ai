// Sessions: an opaque token `<session id>.<secret>` kept in an HttpOnly cookie (browser) or sent
// as `Authorization: Bearer` (desktop sync). Only a hash of the secret is stored.
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Db } from "../db";
import type { AuthSession, AuthUser } from "../context";
import { randomToken, sha256 } from "./password";
import { timingSafeEqual } from "node:crypto";

export const COOKIE = "itsm_session";
const WEB_DAYS = 30;
const DEVICE_DAYS = 365;

export interface IssuedSession {
  token: string;
  session: AuthSession;
}

export async function issueSession(
  db: Db,
  userId: string,
  kind: AuthSession["kind"],
  meta: { deviceName?: string; ip?: string; userAgent?: string } = {},
): Promise<IssuedSession> {
  const secret = randomToken(32);
  const days = kind === "device" ? DEVICE_DAYS : WEB_DAYS;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const row = await db.one<AuthSession>(
    `insert into sm_sessions (user_id, token_hash, kind, device_name, ip, user_agent, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, user_id, kind, expires_at`,
    [userId, sha256(secret), kind, meta.deviceName ?? null, meta.ip ?? null, (meta.userAgent ?? "").slice(0, 300) || null, expires],
  );
  await db.query("update sm_users set last_login_at = now() where id = $1", [userId]);
  return { token: `${row!.id}.${secret}`, session: row! };
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function resolveToken(db: Db, token: string | undefined | null): Promise<{ user: AuthUser; session: AuthSession } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !secret) return null;
  const row = await db.one<AuthSession & { token_hash: string; revoked_at: string | null; last_seen_at: string }>(
    `select id, user_id, kind, expires_at, token_hash, revoked_at, last_seen_at from sm_sessions where id = $1`,
    [id],
  );
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!safeEq(row.token_hash, sha256(secret))) return null;
  const user = await db.one<AuthUser>(
    `select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`,
    [row.user_id],
  );
  if (!user || user.disabled) return null;
  // sliding activity stamp, at most every 10 minutes
  if (Date.now() - new Date(row.last_seen_at).getTime() > 600000) {
    await db.query("update sm_sessions set last_seen_at = now() where id = $1", [row.id]);
  }
  return { user, session: { id: row.id, user_id: row.user_id, kind: row.kind, expires_at: row.expires_at } };
}

export function tokenFromRequest(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return getCookie(c, COOKIE) ?? null;
}

function isHttps(c: Context): boolean {
  const proto = c.req.header("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(c),
    path: "/",
    maxAge: WEB_DAYS * 86400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.query("update sm_sessions set revoked_at = now() where id = $1", [sessionId]);
}

export function clientIp(c: Context): string {
  const xf = c.req.header("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return c.req.header("x-real-ip") ?? "local";
}

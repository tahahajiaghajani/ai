import "server-only";
import { cache } from "react";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { cookies } from "next/headers";
import { hasSecret, safeEqual, sign } from "@/lib/crypto";
import { db } from "@/lib/db";

/**
 * Visitor accounts in their own table (pars_users), not in Supabase Auth: the Supabase project may be shared
 * with another app whose user list is auth.users. Passwords are scrypt hashes. The browser holds a signed,
 * httpOnly cookie with the user id and a session version, so public pages stay static: only the account
 * button asks /api/me, and only when the readable hint cookie says someone is signed in.
 */

export type Role = "user" | "admin";

export interface Account {
  id: string;
  email: string;
  name: string;
  phone: string;
  organization: string;
  role: Role;
  disabled: boolean;
  session_version: number;
}

const COOKIE = "pars_session";
/** readable by page scripts: "someone is signed in here", grants nothing */
export const USER_HINT = "pars_user_ui";
/** readable: shows the admin shortcut on public pages, grants nothing */
export const ADMIN_HINT = "pars_admin_ui";
const DAYS = 30;

export const PROFILE_COLUMNS = "id, email, name, phone, organization, role, disabled, session_version";
export const USERS = "pars_users";

// ------------------------------------------------------------------ passwords

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 256 * n * r };
  return new Promise((ok, fail) => scryptCb(password.normalize("NFKC"), salt, KEYLEN, opts, (e, key) => (e ? fail(e) : ok(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Constant-time check; a malformed or missing hash never matches. */
export async function checkPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    await scrypt(password, Buffer.alloc(16), N, R, P); // same cost as a real check: no timing hint that the account is missing
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, "base64url");
  const got = await scrypt(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return want.length === got.length && timingSafeEqual(want, got);
}

const payload = (id: string, exp: number, ver: number) => `session:${id}:${exp}:${ver}`;

/** Cookie value for a session; exported for tests. */
export function sessionValue(id: string, ver: number, now = Date.now()): string {
  const exp = now + DAYS * 86400_000;
  return `${id}.${exp}.${ver}.${sign(payload(id, exp, ver))}`;
}

/** Verified { id, ver } from a cookie value, or null (bad signature, expired, malformed). */
export function readSession(raw: string | undefined, now = Date.now()): { id: string; ver: number } | null {
  if (!raw || !hasSecret()) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [id, expS, verS, sig] = parts;
  const exp = Number(expS);
  const ver = Number(verS);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(exp) || exp < now || !Number.isInteger(ver)) return null;
  return safeEqual(sig, sign(payload(id, exp, ver))) ? { id, ver } : null;
}

const secure = () => process.env.NODE_ENV === "production";

export async function startUserSession(a: Pick<Account, "id" | "session_version" | "role">): Promise<void> {
  const jar = await cookies();
  const maxAge = DAYS * 86400;
  jar.set(COOKIE, sessionValue(a.id, a.session_version), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge });
  jar.set(USER_HINT, "1", { httpOnly: false, secure: secure(), sameSite: "lax", path: "/", maxAge });
  if (a.role === "admin") jar.set(ADMIN_HINT, "1", { httpOnly: false, secure: secure(), sameSite: "lax", path: "/", maxAge });
  else jar.delete(ADMIN_HINT);
}

export async function endUserSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(USER_HINT);
  jar.delete(ADMIN_HINT);
}

/** The account row, `null` when there is none; throws on a database error (callers decide how to fail). */
export async function loadAccount(id: string): Promise<Account | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from(USERS).select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`account_read_failed: ${error.message}`);
  return (data as Account | null) ?? null;
}

/** Like loadAccount, but a database error reads as "no account" (logged). */
export async function getProfile(id: string): Promise<Account | null> {
  try {
    return await loadAccount(id);
  } catch (e) {
    console.error("[auth]", e);
    return null;
  }
}

/**
 * The session of this request: "none" (no valid cookie), "revoked" (account gone, disabled or signed out
 * elsewhere), "error" (could not check right now) or the signed-in account.
 */
export const sessionState = cache(async (): Promise<{ state: "none" | "revoked" | "error" } | { state: "ok"; user: Account }> => {
  const s = readSession((await cookies()).get(COOKIE)?.value);
  if (!s) return { state: "none" };
  try {
    const p = await loadAccount(s.id);
    if (!p || p.disabled || p.session_version !== s.ver) return { state: "revoked" };
    return { state: "ok", user: p };
  } catch (e) {
    console.error("[auth]", e);
    return { state: "error" };
  }
});

/** The signed-in account for this request (null when signed out, disabled, revoked or not checkable). */
export async function currentUser(): Promise<Account | null> {
  const s = await sessionState();
  return s.state === "ok" ? s.user : null;
}

export async function isAdminAccount(): Promise<boolean> {
  return (await currentUser())?.role === "admin";
}


/** Signed, short-lived token for a password-reset link; it dies once the password (session version) changes. */
export function resetToken(id: string, ver: number, now = Date.now()): string {
  const exp = now + 3600_000;
  return `${id}.${exp}.${sign(`reset:${id}:${exp}:${ver}`)}`;
}

export function readResetToken(token: string, now = Date.now()): { id: string; exp: number; sig: string } | null {
  const [id, expS, sig] = token.split(".");
  const exp = Number(expS);
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(exp) || exp < now || !hasSecret()) return null;
  return { id, exp, sig };
}

export function resetTokenValid(t: { id: string; exp: number; sig: string }, ver: number): boolean {
  return safeEqual(t.sig, sign(`reset:${t.id}:${t.exp}:${ver}`));
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

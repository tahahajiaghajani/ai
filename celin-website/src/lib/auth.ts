import "server-only";
import { cache } from "react";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { cookies } from "next/headers";
import { hasSecret, safeEqual, sign } from "@/lib/crypto";
import { db } from "@/lib/db";

/**
 * Accounts live in their own table (celin_users), not in Supabase Auth: the Supabase project may be shared
 * with another app. The sign-in name is the mobile number (or the e-mail, when one is saved); passwords are
 * scrypt hashes. The browser holds a signed, httpOnly cookie with the user id and a session version, so public
 * pages stay static: only the header and the Pro price layer ask /api/me, and only when the readable hint
 * cookie says someone is signed in here.
 */

export type Role = "user" | "admin";

export interface Account {
  id: string;
  phone: string;
  email: string;
  name: string;
  business: string;
  city: string;
  address: string;
  postal_code: string;
  role: Role;
  disabled: boolean;
  session_version: number;
}

export const USERS = "celin_users";
export const PROFILE_COLUMNS = "id, phone, email, name, business, city, address, postal_code, role, disabled, session_version";

const COOKIE = "celin_session";
/** readable by page scripts: "someone is signed in here", grants nothing */
export const USER_HINT = "celin_ui";
/** readable: "this account has Pro" — the price layer then asks /api/pro/prices; grants nothing */
export const PRO_HINT = "celin_pro_ui";
/** readable: shows the admin shortcut on public pages, grants nothing */
export const ADMIN_HINT = "celin_admin_ui";
const DAYS = 30;

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

// ------------------------------------------------------------------ sessions

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
const hintOpts = () => ({ httpOnly: false, secure: secure(), sameSite: "lax" as const, path: "/", maxAge: DAYS * 86400 });

export async function startUserSession(a: Pick<Account, "id" | "session_version" | "role">, pro?: boolean): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sessionValue(a.id, a.session_version), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: DAYS * 86400 });
  jar.set(USER_HINT, "1", hintOpts());
  if (a.role === "admin") jar.set(ADMIN_HINT, "1", hintOpts());
  else jar.delete(ADMIN_HINT);
  if (pro !== undefined) await setProHint(pro);
}

/** Keeps the readable Pro hint in step with the account (it only decides whether the page asks for prices). */
export async function setProHint(pro: boolean): Promise<void> {
  const jar = await cookies();
  if (pro) jar.set(PRO_HINT, "1", hintOpts());
  else jar.delete(PRO_HINT);
}

export async function endUserSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(USER_HINT);
  jar.delete(PRO_HINT);
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

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Whether the account has a password (accounts made by the admin may sign in with their Pro code only). */
export async function hasPassword(id: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  const { data } = await c.from(USERS).select("password_hash").eq("id", id).maybeSingle();
  return Boolean((data as { password_hash: string | null } | null)?.password_hash);
}

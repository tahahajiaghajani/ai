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

/**
 * How a session was opened: "pw" = phone/e-mail + password (or sign-up), "code" = the Pro code on its own,
 * "legacy" = a cookie from before this was recorded. Only "pw" sessions may open the admin panel, so a
 * leaked Pro code (sent by SMS, WhatsApp…) never unlocks it.
 */
export type SessionVia = "pw" | "code" | "legacy";

const payload = (id: string, exp: number, ver: number, via?: SessionVia) => (via ? `session:${id}:${exp}:${ver}:${via}` : `session:${id}:${exp}:${ver}`);

/** Cookie value for a session; exported for tests. */
export function sessionValue(id: string, ver: number, now = Date.now(), via: "pw" | "code" = "pw"): string {
  const exp = now + DAYS * 86400_000;
  return `${id}.${exp}.${ver}.${via}.${sign(payload(id, exp, ver, via))}`;
}

/** Verified { id, ver, via } from a cookie value, or null (bad signature, expired, malformed). */
export function readSession(raw: string | undefined, now = Date.now()): { id: string; ver: number; via: SessionVia } | null {
  if (!raw || !hasSecret()) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [id, expS, verS] = parts;
  const via: SessionVia = parts.length === 5 ? (parts[3] as SessionVia) : "legacy";
  const sig = parts[parts.length - 1];
  const exp = Number(expS);
  const ver = Number(verS);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(exp) || exp < now || !Number.isInteger(ver)) return null;
  if (parts.length === 5 && via !== "pw" && via !== "code") return null;
  const expected = sign(payload(id, exp, ver, via === "legacy" ? undefined : via));
  return safeEqual(sig, expected) ? { id, ver, via } : null;
}

/**
 * An admin account: role admin. A phone number alone never makes one — an account becomes admin through an
 * explicit proof of ADMIN_PASSWORD on /admin/login (actions/admin.ts activateAdmin) or Users → «مدیر کردن».
 */
export function isAdminRow(a: { role?: string | null }): boolean {
  return a.role === "admin";
}

const secure = () => process.env.NODE_ENV === "production";
const hintOpts = () => ({ httpOnly: false, secure: secure(), sameSite: "lax" as const, path: "/", maxAge: DAYS * 86400 });

export async function startUserSession(a: Pick<Account, "id" | "session_version" | "role"> & { phone?: string }, pro?: boolean, via: "pw" | "code" = "pw"): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sessionValue(a.id, a.session_version, Date.now(), via), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: DAYS * 86400 });
  jar.set(USER_HINT, "1", hintOpts());
  if (via === "pw" && isAdminRow(a)) jar.set(ADMIN_HINT, "1", hintOpts());
  else jar.delete(ADMIN_HINT);
  if (pro !== undefined) await setProHint(pro);
}

/** Keeps the readable Pro hint in step with the account (it only decides whether the page asks for prices). */
export async function setProHint(pro: boolean): Promise<void> {
  const jar = await cookies();
  if (pro) jar.set(PRO_HINT, "1", hintOpts());
  else jar.delete(PRO_HINT);
}

// A browser that has signed in to an account before carries this (signed, per account and per password): when
// strangers have used up the account's failed-sign-in allowance, its owner can still sign in from a known
// browser (with a ceiling of its own). It is bound to the password hash, so it ends with the password — a
// change, an admin reset or a code-made password removed with its code (members.ts endCodeAccess).
const DEVICE = "celin_device";

const deviceValue = (id: string, passwordHash: string | null | undefined) => sign(`device:${id}:${passwordHash ?? ""}`);

export async function markKnownDevice(id: string, passwordHash: string | null | undefined): Promise<void> {
  if (!passwordHash) return;
  (await cookies()).set(DEVICE, deviceValue(id, passwordHash), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: 365 * 86400 });
}

export async function isKnownDevice(id: string, passwordHash: string | null | undefined): Promise<boolean> {
  const v = (await cookies()).get(DEVICE)?.value;
  return Boolean(v && passwordHash && hasSecret() && safeEqual(v, deviceValue(id, passwordHash)));
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
export const sessionState = cache(async (): Promise<{ state: "none" | "revoked" | "error" } | { state: "ok"; user: Account; via: SessionVia }> => {
  const s = readSession((await cookies()).get(COOKIE)?.value);
  if (!s) return { state: "none" };
  try {
    const p = await loadAccount(s.id);
    if (!p || p.disabled || p.session_version !== s.ver) return { state: "revoked" };
    return { state: "ok", user: p, via: s.via };
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

/** The signed-in account may use the admin panel: an admin account, signed in with its password. */
export async function isAdminAccount(): Promise<boolean> {
  const s = await sessionState();
  return s.state === "ok" && s.via === "pw" && isAdminRow(s.user);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Whether the account has a password (accounts made by the admin may sign in with their Pro code only). */
export async function hasPassword(id: string): Promise<boolean> {
  const c = db();
  if (!c) return false;
  const { data } = await c.from(USERS).select("password_hash").eq("id", id).maybeSingle();
  return Boolean((data as { password_hash: string | null } | null)?.password_hash);
}

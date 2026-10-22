import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { hasSecret, safeEqual, sign } from "@/lib/crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Visitor accounts. Supabase Auth keeps the credentials (auth.users); pars_profiles keeps name, role and
 * a session version. The browser holds a signed, httpOnly cookie with the user id, so public pages stay
 * static: only the account button asks /api/me, and only when the readable hint cookie says someone is signed in.
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

export async function getProfile(id: string): Promise<Account | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from("pars_profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[auth] profile read", error.message);
    return null;
  }
  return (data as Account | null) ?? null;
}

/** The signed-in account for this request (null when signed out, disabled or the session was revoked). */
export const currentUser = cache(async (): Promise<Account | null> => {
  const s = readSession((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  const p = await getProfile(s.id);
  if (!p || p.disabled || p.session_version !== s.ver) return null;
  return p;
});

export async function isAdminAccount(): Promise<boolean> {
  return (await currentUser())?.role === "admin";
}

/**
 * Checks an e-mail and password with Supabase Auth. Uses a throwaway client: signing in on the shared
 * service-role client would make its later queries run as this user.
 */
export async function verifyPassword(email: string, password: string): Promise<{ id: string; name: string } | null> {
  if (!env.supabaseUrl || !env.supabaseKey) return null;
  const c = createClient(env.supabaseUrl, env.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  const meta = (data.user.user_metadata ?? {}) as { name?: unknown };
  return { id: data.user.id, name: typeof meta.name === "string" ? meta.name : "" };
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

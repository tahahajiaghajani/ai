import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { adminPhones, isAdminPhone } from "@/lib/admin-phones";
import { ADMIN_HINT as HINT, isAdminAccount } from "@/lib/auth";
import { hasSecret, safeEqual, sha256, sign } from "@/lib/crypto";
import { db, missingDbVars } from "@/lib/db";

/**
 * Two ways in: an admin account (role "admin" in celin_users) signed in with its password through the normal
 * site sign-in or /admin/login, or the optional ADMIN_PASSWORD session below (break-glass; it never changes
 * any account). An account becomes admin only by an explicit proof of ADMIN_PASSWORD (activateAdmin in
 * actions/admin.ts) or by another admin (Users → «مدیر کردن») — never by its phone number alone.
 */
const COOKIE = "celin_admin";
const DAYS = 7;

function fingerprint(): string {
  // changing ADMIN_PASSWORD signs every session out
  return sha256(`fp:${env.adminPassword}`).slice(0, 12);
}

export function adminConfigured(): boolean {
  return Boolean(env.adminPassword && hasSecret());
}

export interface AdminSetup {
  /** accounts can sign in (Supabase configured) */
  accounts: boolean;
  /** ADMIN_PASSWORD is set: accounts can be made admin with it, and the break-glass login works */
  password: boolean;
  /** valid numbers in the optional ADMIN_PHONES allow-list (0 = any account may be made admin) */
  phones: number;
  /** variables still missing for the first activation (an account made admin with ADMIN_PASSWORD) */
  missing: string[];
}

/** What the owner has configured for the admin panel (for /admin/login and Admin → Connections). */
export function adminSetup(): AdminSetup {
  const password = adminConfigured();
  const missing = [...missingDbVars(), ...(env.adminPassword ? [] : ["ADMIN_PASSWORD"])];
  return { accounts: Boolean(db()) && hasSecret(), password, phones: adminPhones().length, missing };
}

/**
 * Whether this (non-admin) account may be made admin by proving ADMIN_PASSWORD: the password is set, and the
 * account's phone is in ADMIN_PHONES when that allow-list is set.
 */
export function canActivateAdmin(a: { role?: string | null; phone?: string | null }): boolean {
  if (a.role === "admin" || !adminConfigured()) return false;
  return adminPhones().length === 0 || isAdminPhone(a.phone);
}

export function checkPassword(input: string): boolean {
  return adminConfigured() && safeEqual(input, env.adminPassword);
}

export async function startSession(): Promise<void> {
  const exp = Date.now() + DAYS * 86400_000;
  const value = `${exp}.${sign(`admin:${exp}:${fingerprint()}`)}`;
  const jar = await cookies();
  jar.set(COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: DAYS * 86400 });
  jar.set(HINT, "1", { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DAYS * 86400 });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(HINT);
}

async function hasPasswordSession(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(`admin:${exp}:${fingerprint()}`));
}

export async function isAdmin(): Promise<boolean> {
  return (await hasPasswordSession()) || (await isAdminAccount());
}

/** For admin pages: redirects to the login screen. Call it first in every page, not only the layout (layouts can be skipped). */
export async function requireAdminPage(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** For admin Server Actions and admin-only data helpers: throws when not signed in. */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("unauthorized");
}

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { hasSecret, safeEqual, sha256, sign } from "@/lib/crypto";

const COOKIE = "pars_admin";
/** readable by the page script: only shows the admin shortcut on public pages, grants nothing */
const HINT = "pars_admin_ui";
const DAYS = 7;

function fingerprint(): string {
  // changing ADMIN_PASSWORD signs every session out
  return sha256(`fp:${env.adminPassword}`).slice(0, 12);
}

export function adminConfigured(): boolean {
  return Boolean(env.adminPassword && hasSecret());
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

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(`admin:${exp}:${fingerprint()}`));
}

/** For admin pages: redirects to the login screen. Call it first in every page, not only the layout (layouts can be skipped). */
export async function requireAdminPage(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** For admin Server Actions and admin-only data helpers: throws when not signed in. */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("unauthorized");
}

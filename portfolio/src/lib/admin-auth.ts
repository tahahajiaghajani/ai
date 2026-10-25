import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { createHash } from "node:crypto";
import { hasSecret, safeEqual, sign } from "@/lib/crypto";

const COOKIE = "ta_admin";
const TTL = 60 * 60 * 24 * 7; // a week

/** The password is part of what is signed, so changing ADMIN_PASSWORD (and redeploying) signs every session out. */
const payload = (exp: string) => `admin:${exp}:${createHash("sha256").update(env.adminPassword).digest("hex").slice(0, 16)}`;

export function adminConfigured(): boolean {
  return Boolean(env.adminPassword) && hasSecret();
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(payload(exp)));
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

/** For actions that return a result to the panel: refuses instead of redirecting. */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("unauthorized");
}

export async function startSession(password: string): Promise<boolean> {
  if (!adminConfigured() || !safeEqual(password, env.adminPassword)) return false;
  const exp = String(Math.floor(Date.now() / 1000) + TTL);
  (await cookies()).set(COOKIE, `${exp}.${sign(payload(exp))}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin", maxAge: TTL });
  return true;
}

export async function endSession(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: "/admin" });
}

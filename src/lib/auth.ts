import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getSystemSettings } from "@/lib/settings";
import type { Profile } from "@/lib/types";

export interface SessionUser {
  id: string;
  email: string;
  profile: Profile;
  /** the app owner: Vercel/Supabase settings, users, upgrades; sees everyone's work */
  isOwner: boolean;
  /** "full" = the whole app (AI, projects, workflows); "simple" = give and track tasks only */
  mode: "simple" | "full";
}

/**
 * Current signed-in user with profile. The OWNER_EMAIL user becomes the active owner automatically
 * on first sign-in (only while no other active owner exists, so it cannot be taken over later).
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServer();
  // getClaims verifies the session JWT locally (asymmetric signing keys, JWKS cached per instance).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const user = {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown>,
  };

  const admin = db();
  let { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();
  if (!profile) {
    const inserted = await admin
      .from("profiles")
      .upsert({ id: user.id, email: user.email, full_name: (user.user_metadata?.full_name as string) || user.email?.split("@")[0] })
      .select("*")
      .single<Profile>();
    profile = inserted.data;
  }
  if (!profile) return null;

  const email = (user.email ?? "").toLowerCase();
  const isBootstrapOwner =
    env.ownerEmail &&
    email === env.ownerEmail &&
    (profile.role !== "owner" || profile.status !== "active") &&
    !((await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner").eq("status", "active").neq("id", user.id)).count ?? 0);
  if (isBootstrapOwner) {
    const upd = await admin.from("profiles").update({ role: "owner", status: "active", mode: "full" }).eq("id", user.id).select("*").single<Profile>();
    if (upd.data) profile = upd.data;
  } else if (profile.status === "pending" && (await getSystemSettings()).registration.autoApprove) {
    const upd = await admin.from("profiles").update({ status: "active" }).eq("id", user.id).select("*").single<Profile>();
    if (upd.data) profile = upd.data;
  }

  const isOwner = profile.role === "owner" && profile.status === "active";
  return { id: user.id, email, profile, isOwner, mode: isOwner ? "full" : (profile.mode ?? "simple") };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (u.profile.status === "disabled") redirect("/login?disabled=1");
  if (u.profile.status !== "active") redirect("/pending");
  return u;
}

/** Pages of the full app; simple-mode users go to the simple app. */
export async function requireFull(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.mode !== "full") redirect("/portal");
  return u;
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isOwner) redirect(u.mode === "full" ? "/dashboard" : "/portal");
  return u;
}

/** For server actions: throws a Persian error instead of redirecting. */
export async function assertActive(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("ابتدا وارد شوید");
  if (u.profile.status !== "active") throw new Error("حساب شما هنوز فعال نشده است");
  return u;
}

export async function assertFull(): Promise<SessionUser> {
  const u = await assertActive();
  if (u.mode !== "full") throw new Error("این بخش در حالت کامل اپ در دسترس است (تنظیمات ← حالت اپ)");
  return u;
}

export async function assertOwner(): Promise<SessionUser> {
  const u = await assertActive();
  if (!u.isOwner) throw new Error("این بخش فقط برای مالک اپ است");
  return u;
}

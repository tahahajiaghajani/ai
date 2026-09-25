import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { Profile } from "@/lib/types";

export interface SessionUser {
  id: string;
  email: string;
  profile: Profile;
  isAdmin: boolean;
}

/**
 * Current signed-in user with profile. The ADMIN_EMAIL user is promoted to an active admin
 * automatically on first sign-in, so no manual SQL is needed.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const admin = db();
  let { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();

  if (!profile) {
    const inserted = await admin
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        full_name: (user.user_metadata?.full_name as string) || user.email?.split("@")[0],
      })
      .select("*")
      .single<Profile>();
    profile = inserted.data;
  }
  if (!profile) return null;

  const email = (user.email ?? "").toLowerCase();
  if (env.adminEmail && email === env.adminEmail && (profile.role !== "admin" || profile.status !== "active")) {
    const upd = await admin
      .from("profiles")
      .update({ role: "admin", status: "active" })
      .eq("id", user.id)
      .select("*")
      .single<Profile>();
    if (upd.data) profile = upd.data;
  }

  return { id: user.id, email, profile, isAdmin: profile.role === "admin" && profile.status === "active" };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (u.profile.status === "disabled") redirect("/login?disabled=1");
  if (u.profile.status !== "active") redirect("/pending");
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.isAdmin) redirect("/portal");
  return u;
}

/** For server actions: returns an error string instead of redirecting. */
export async function assertAdmin(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !u.isAdmin) throw new Error("دسترسی فقط برای مدیر مجاز است");
  return u;
}

export async function assertActive(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("ابتدا وارد شوید");
  if (u.profile.status !== "active") throw new Error("حساب شما هنوز فعال نشده است");
  return u;
}

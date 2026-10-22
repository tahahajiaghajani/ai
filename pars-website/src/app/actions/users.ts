"use server";

import { revalidatePath } from "next/cache";
import type { AdminResult } from "@/app/actions/admin";
import { guard, str } from "@/lib/admin-action";
import { EMAIL_RE, currentUser, getProfile, type Role } from "@/lib/auth";
import { requireDb } from "@/lib/db";

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const goodPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 8 && p.length <= 72;

/** Role, disable and delete never apply to the admin's own account (no locking yourself out). */
async function other(id: unknown): Promise<{ ok: false; error: string } | null> {
  if (!isId(id)) return { ok: false, error: "شناسه‌ی کاربر معتبر نیست." };
  if ((await currentUser())?.id === id) return { ok: false, error: "این تغییر روی حساب خودتان مجاز نیست." };
  return null;
}

function done(message: string): AdminResult {
  revalidatePath("/admin/users");
  return { ok: true, message };
}

export async function createUserAccount(input: { name: string; email: string; password: string; role: Role }): Promise<AdminResult> {
  return guard(async () => {
    const name = str(input.name, 80);
    const email = str(input.email, 160).toLowerCase();
    if (name.length < 2) return { ok: false, error: "نام را بنویسید." };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "ایمیل معتبر نیست." };
    if (!goodPassword(input.password)) return { ok: false, error: "رمز عبور باید دست‌کم ۸ نویسه باشد." };
    const c = requireDb();
    const { data, error } = await c.auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: { name } });
    if (error || !data.user) {
      if (error && (error.code === "email_exists" || /already|registered|exists/i.test(error.message))) return { ok: false, error: "با این ایمیل قبلاً حساب ساخته شده است." };
      throw new Error(error?.message ?? "create user failed");
    }
    const ins = await c.from("pars_profiles").insert({ id: data.user.id, email, name, role: input.role === "admin" ? "admin" : "user" });
    if (ins.error) {
      await c.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw new Error(ins.error.message);
    }
    return done("کاربر ساخته شد.");
  });
}

export async function setUserRole(id: string, role: Role): Promise<AdminResult> {
  return guard(async () => {
    const no = await other(id);
    if (no) return no;
    const { error } = await requireDb().from("pars_profiles").update({ role: role === "admin" ? "admin" : "user", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    return done(role === "admin" ? "این کاربر حالا مدیر است." : "دسترسی مدیر برداشته شد.");
  });
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<AdminResult> {
  return guard(async () => {
    const no = await other(id);
    if (no) return no;
    const p = await getProfile(id);
    if (!p) return { ok: false, error: "کاربر پیدا نشد." };
    // a new session version signs the user out everywhere
    const { error } = await requireDb()
      .from("pars_profiles")
      .update({ disabled: Boolean(disabled), session_version: p.session_version + 1, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return done(disabled ? "حساب غیرفعال شد و از همه‌ی دستگاه‌ها خارج شد." : "حساب دوباره فعال شد.");
  });
}

export async function setUserPassword(id: string, password: string): Promise<AdminResult> {
  return guard(async () => {
    if (!isId(id)) return { ok: false, error: "شناسه‌ی کاربر معتبر نیست." };
    if (!goodPassword(password)) return { ok: false, error: "رمز عبور باید دست‌کم ۸ نویسه باشد." };
    const p = await getProfile(id);
    if (!p) return { ok: false, error: "کاربر پیدا نشد." };
    const c = requireDb();
    const { error } = await c.auth.admin.updateUserById(id, { password });
    if (error) throw new Error(error.message);
    await c.from("pars_profiles").update({ session_version: p.session_version + 1, updated_at: new Date().toISOString() }).eq("id", id);
    return done("رمز تازه ذخیره شد؛ کاربر باید با آن دوباره وارد شود.");
  });
}

export async function deleteUserAccount(id: string): Promise<AdminResult> {
  return guard(async () => {
    const no = await other(id);
    if (no) return no;
    // the profile goes with the auth user (on delete cascade); the user's tickets stay, without an owner
    const { error } = await requireDb().auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
    return done("کاربر حذف شد؛ درخواست‌هایش در پنل می‌ماند.");
  });
}

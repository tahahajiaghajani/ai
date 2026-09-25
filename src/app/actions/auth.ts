"use server";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/events";
import { env } from "@/lib/env";

export type AuthState = { error?: string; message?: string } | null;

function translate(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "ایمیل یا رمز عبور اشتباه است";
  if (/email not confirmed/i.test(msg)) return "ایمیل شما هنوز تایید نشده است (در Supabase گزینه‌ی Confirm email را خاموش کنید)";
  if (/already registered|already been registered/i.test(msg)) return "با این ایمیل قبلاً ثبت‌نام شده است";
  if (/password/i.test(msg) && /characters/i.test(msg)) return "رمز عبور حداقل باید ۸ کاراکتر باشد";
  if (/rate limit/i.test(msg)) return "تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید";
  if (/invalid path specified|no api key found|invalid api key/i.test(msg))
    return "اتصال به Supabase درست تنظیم نشده است: در Vercel مقدار NEXT_PUBLIC_SUPABASE_URL باید فقط https://<ref>.supabase.co و کلید anon همان پروژه باشد؛ سپس Redeploy کنید";
  return msg;
}

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");
  if (!email || !password) return { error: "ایمیل و رمز عبور را وارد کنید" };
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: translate(error.message) };
  redirect(next.startsWith("/") ? next : "/");
}

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const full_name = String(form.get("full_name") ?? "").trim();
  const org_unit = String(form.get("org_unit") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  if (!email || !password || !full_name) return { error: "نام، ایمیل و رمز عبور الزامی است" };
  if (password.length < 8) return { error: "رمز عبور حداقل باید ۸ کاراکتر باشد" };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, org_unit, phone }, emailRedirectTo: env.appUrl ? `${env.appUrl}/auth/callback` : undefined },
  });
  if (error) return { error: translate(error.message) };
  if (data.user && email !== env.adminEmail) {
    await notifyAdmins({ title: "درخواست عضویت جدید", body: `${full_name} (${email})${org_unit ? ` — ${org_unit}` : ""}`, link: "/users" });
  }
  if (!data.session) return { message: "ثبت‌نام انجام شد. اگر تایید ایمیل فعال است، ایمیل خود را بررسی کنید." };
  redirect("/");
}

export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

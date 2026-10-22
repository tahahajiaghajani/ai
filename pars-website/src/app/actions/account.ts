"use server";

import { redirect } from "next/navigation";
import { endSession } from "@/lib/admin-auth";
import { EMAIL_RE, currentUser, endUserSession, getProfile, readResetToken, resetToken, resetTokenValid, startUserSession, verifyPassword, type Account } from "@/lib/auth";
import { hashIp, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { emailConfig, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { href } from "@/lib/i18n";
import { clientIp } from "@/lib/request";
import { allow } from "@/lib/rate-limit";

type Lang = "fa" | "en";
export type Result<T = object> = ({ ok: true; message?: string } & T) | { ok: false; error: string };

const MSG = {
  db: { fa: "حساب کاربری موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کنید.", en: "Accounts are temporarily unavailable — please try again later." },
  rate: { fa: "تلاش‌های زیادی انجام شد؛ چند دقیقه‌ی دیگر دوباره امتحان کنید.", en: "Too many attempts — please try again in a few minutes." },
  name: { fa: "نام و نام خانوادگی را بنویسید.", en: "Please enter your full name." },
  email: { fa: "نشانی ایمیل معتبر نیست.", en: "The e-mail address is not valid." },
  password: { fa: "رمز عبور باید دست‌کم ۸ نویسه باشد.", en: "The password must be at least 8 characters." },
  exists: { fa: "با این ایمیل قبلاً حساب ساخته شده است؛ وارد شوید.", en: "An account with this e-mail already exists — please sign in." },
  wrong: { fa: "ایمیل یا رمز عبور درست نیست.", en: "The e-mail or password is not correct." },
  disabled: { fa: "این حساب غیرفعال شده است؛ با پشتیبانی تماس بگیرید.", en: "This account has been disabled — please contact support." },
  signedOut: { fa: "نشست شما پایان یافته است؛ دوباره وارد شوید.", en: "Your session has ended — please sign in again." },
  saved: { fa: "ذخیره شد.", en: "Saved." },
  passwordChanged: { fa: "رمز عبور تغییر کرد.", en: "Your password was changed." },
  currentWrong: { fa: "رمز فعلی درست نیست.", en: "The current password is not correct." },
  resetSent: { fa: "اگر حسابی با این ایمیل باشد، پیوند تغییر رمز به آن فرستاده شد.", en: "If an account uses this e-mail, a reset link has been sent to it." },
  resetOff: { fa: "بازیابی خودکار رمز فعال نیست؛ با پشتیبانی تماس بگیرید تا رمز تازه برایتان تنظیم شود.", en: "Automatic password reset is not available — please contact support to set a new password." },
  resetBad: { fa: "پیوند تغییر رمز معتبر نیست یا منقضی شده است؛ دوباره درخواست دهید.", en: "This reset link is invalid or has expired — please request a new one." },
  failed: { fa: "مشکلی پیش آمد؛ دوباره امتحان کنید.", en: "Something went wrong — please try again." },
};

const langOf = (v: unknown): Lang => (v === "en" ? "en" : "fa");

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

/** Same-site path to return to after signing in; anything else falls back to the account page. */
function safeNext(v: unknown, lang: Lang): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?![/\\])[^\s]*$/.test(s) && !s.startsWith("/admin/login") ? s : href(lang, "/account");
}

const goodPassword = (p: string) => p.length >= 8 && p.length <= 72;
const missingTable = (e: { code?: string } | null) => ["42P01", "PGRST205"].includes(e?.code ?? "");

async function ipKey(): Promise<string> {
  return hashIp(await clientIp());
}

const pause = () => new Promise((r) => setTimeout(r, 400));

export async function signUp(input: Record<string, unknown>): Promise<Result<{ next: string }>> {
  const lang = langOf(input.lang);
  if (text(input.website, 200)) return { ok: false, error: MSG.failed[lang] }; // honeypot
  const name = text(input.name, 80);
  const email = text(input.email, 160).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (name.length < 2) return { ok: false, error: MSG.name[lang] };
  if (!EMAIL_RE.test(email)) return { ok: false, error: MSG.email[lang] };
  if (!goodPassword(password)) return { ok: false, error: MSG.password[lang] };
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  if (!(await allow(`signup:${await ipKey()}`, 3600, 5))) return { ok: false, error: MSG.rate[lang] };

  // confirmed right away: the free Supabase mailer allows only a few messages an hour
  const { data, error } = await c.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error || !data.user) {
    if (error && (error.code === "email_exists" || /already|registered|exists/i.test(error.message))) return { ok: false, error: MSG.exists[lang] };
    if (error && (error.code === "weak_password" || /password/i.test(error.message))) return { ok: false, error: MSG.password[lang] };
    console.error("[account] create user", error?.message);
    return { ok: false, error: MSG.failed[lang] };
  }
  const profile = { id: data.user.id, email, name, phone: text(input.phone, 30), organization: text(input.organization, 120), last_sign_in_at: new Date().toISOString() };
  const ins = await c.from("pars_profiles").insert(profile);
  if (ins.error) {
    // no orphan login without a profile
    await c.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    console.error("[account] profile insert", ins.error.message);
    return { ok: false, error: MSG.db[lang] };
  }
  await startUserSession({ id: data.user.id, session_version: 0, role: "user" });
  return { ok: true, next: safeNext(input.next, lang) };
}

export async function signIn(input: Record<string, unknown>): Promise<Result<{ next: string }>> {
  const lang = langOf(input.lang);
  const email = text(input.email, 160).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (!EMAIL_RE.test(email) || !password) return { ok: false, error: MSG.wrong[lang] };
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  if (!(await allow(`signin:${await ipKey()}`, 600, 10)) || !(await allow(`signin-email:${sha256(email).slice(0, 24)}`, 900, 8))) return { ok: false, error: MSG.rate[lang] };

  const v = await verifyPassword(email, password);
  if (!v) {
    await pause();
    return { ok: false, error: MSG.wrong[lang] };
  }
  let p = await getProfile(v.id);
  if (!p) {
    // an account made in the Supabase dashboard: give it a profile on first sign-in
    const ins = await c.from("pars_profiles").insert({ id: v.id, email, name: v.name || email.split("@")[0] });
    if (ins.error && !/duplicate|unique/i.test(ins.error.message)) {
      console.error("[account] profile on sign-in", ins.error.message, missingTable(ins.error) ? "(run the accounts migration)" : "");
      return { ok: false, error: MSG.db[lang] };
    }
    p = await getProfile(v.id);
  }
  if (!p) return { ok: false, error: MSG.db[lang] };
  if (p.disabled) return { ok: false, error: MSG.disabled[lang] };
  await c.from("pars_profiles").update({ last_sign_in_at: new Date().toISOString() }).eq("id", p.id);
  await startUserSession(p);
  return { ok: true, next: safeNext(input.next, lang) };
}

/** Signs out of the account (and of an admin password session in this browser). */
export async function signOut(lang: Lang = "fa"): Promise<void> {
  await endUserSession();
  await endSession();
  redirect(href(langOf(lang), "/"));
}

async function signedIn(lang: Lang): Promise<Account | { ok: false; error: string }> {
  const me = await currentUser();
  return me ?? { ok: false, error: MSG.signedOut[lang] };
}

export async function updateProfile(input: Record<string, unknown>): Promise<Result> {
  const lang = langOf(input.lang);
  const me = await signedIn(lang);
  if ("ok" in me) return me;
  const name = text(input.name, 80);
  if (name.length < 2) return { ok: false, error: MSG.name[lang] };
  const { error } = await db()!
    .from("pars_profiles")
    .update({ name, phone: text(input.phone, 30), organization: text(input.organization, 120), updated_at: new Date().toISOString() })
    .eq("id", me.id);
  if (error) {
    console.error("[account] update profile", error.message);
    return { ok: false, error: MSG.failed[lang] };
  }
  return { ok: true, message: MSG.saved[lang] };
}

/** New password for a user, then every older session (and reset link) stops working. */
async function setPassword(p: Account, password: string): Promise<boolean> {
  const c = db()!;
  const { error } = await c.auth.admin.updateUserById(p.id, { password });
  if (error) {
    console.error("[account] set password", error.message);
    return false;
  }
  const ver = p.session_version + 1;
  await c.from("pars_profiles").update({ session_version: ver, updated_at: new Date().toISOString() }).eq("id", p.id);
  await startUserSession({ ...p, session_version: ver });
  return true;
}

export async function changePassword(input: Record<string, unknown>): Promise<Result> {
  const lang = langOf(input.lang);
  const me = await signedIn(lang);
  if ("ok" in me) return me;
  const current = typeof input.current === "string" ? input.current : "";
  const next = typeof input.password === "string" ? input.password : "";
  if (!goodPassword(next)) return { ok: false, error: MSG.password[lang] };
  if (!(await allow(`password:${me.id}`, 900, 6))) return { ok: false, error: MSG.rate[lang] };
  const v = await verifyPassword(me.email, current);
  if (!v || v.id !== me.id) {
    await pause();
    return { ok: false, error: MSG.currentWrong[lang] };
  }
  return (await setPassword(me, next)) ? { ok: true, message: MSG.passwordChanged[lang] } : { ok: false, error: MSG.failed[lang] };
}

export async function requestReset(input: Record<string, unknown>): Promise<Result> {
  const lang = langOf(input.lang);
  const email = text(input.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: MSG.email[lang] };
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  const mail = await emailConfig();
  if (!mail) return { ok: false, error: MSG.resetOff[lang] };
  if (!(await allow(`reset:${await ipKey()}`, 3600, 5)) || !(await allow(`reset-email:${sha256(email).slice(0, 24)}`, 3600, 3))) return { ok: false, error: MSG.rate[lang] };
  // exact match (emails are stored lower-case); ilike would treat _ and % in the input as wildcards
  const { data } = await c.from("pars_profiles").select("id, email, name, disabled, session_version").eq("email", email).limit(1).maybeSingle();
  const p = data as Pick<Account, "id" | "email" | "name" | "disabled" | "session_version"> | null;
  if (p && !p.disabled) {
    const link = `${env.siteUrl}${href(lang, "/account/reset")}?t=${encodeURIComponent(resetToken(p.id, p.session_version))}`;
    const fa = lang === "fa";
    const html = `<div dir="${fa ? "rtl" : "ltr"}" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9">
<p>${fa ? "سلام" : "Hello"}${p.name ? ` ${escapeHtml(p.name)}` : ""},</p>
<p>${fa ? "برای تغییر رمز حساب کاربری‌تان در سایت پارس، روی پیوند زیر بزنید. این پیوند تا یک ساعت معتبر است." : "To set a new password for your Pars account, open the link below. It is valid for one hour."}</p>
<p><a href="${link}">${fa ? "تغییر رمز عبور" : "Set a new password"}</a></p>
<p style="color:#888">${fa ? "اگر این درخواست را شما نداده‌اید، این ایمیل را نادیده بگیرید." : "If you did not ask for this, you can ignore this e-mail."}</p>
</div>`;
    const r = await sendEmail(p.email, fa ? "تغییر رمز عبور — مدیریت پروژه پارس" : "Reset your password — Pars Project Management", html, mail);
    if (!r.ok) console.error("[account] reset mail", r.error);
  }
  // the same answer either way, so the form does not reveal who has an account
  return { ok: true, message: MSG.resetSent[lang] };
}

export async function resetPassword(input: Record<string, unknown>): Promise<Result<{ next: string }>> {
  const lang = langOf(input.lang);
  const password = typeof input.password === "string" ? input.password : "";
  if (!goodPassword(password)) return { ok: false, error: MSG.password[lang] };
  const t = readResetToken(text(input.token, 400));
  if (!t) return { ok: false, error: MSG.resetBad[lang] };
  if (!(await allow(`reset-set:${await ipKey()}`, 900, 10))) return { ok: false, error: MSG.rate[lang] };
  const p = await getProfile(t.id);
  if (!p || p.disabled || !resetTokenValid(t, p.session_version)) return { ok: false, error: MSG.resetBad[lang] };
  return (await setPassword(p, password)) ? { ok: true, next: href(lang, "/account") } : { ok: false, error: MSG.failed[lang] };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

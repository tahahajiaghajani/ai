"use server";

import { after } from "next/server";
import { endSession } from "@/lib/admin-auth";
import {
  EMAIL_RE,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PROFILE_COLUMNS,
  USERS,
  checkPassword,
  currentUser,
  endUserSession,
  hashPassword,
  setProHint,
  startUserSession,
  type Account,
} from "@/lib/auth";
import { hashIp, sha256 } from "@/lib/crypto";
import { db, isMissingTable } from "@/lib/db";
import { normalizePhone } from "@/lib/format";
import { href } from "@/lib/i18n";
import { markAllRead } from "@/lib/messages";
import { notifyTeam } from "@/lib/notify";
import { codeState, findCode, normalizeCode, proStatus, REQUESTS, touchCode } from "@/lib/pro";
import { allow } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { langOf, text, type Lang, type Result } from "@/lib/action";

const MSG = {
  db: { fa: "حساب کاربری موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کنید.", en: "Accounts are temporarily unavailable — please try again later." },
  rate: { fa: "تلاش‌های زیادی انجام شد؛ چند دقیقه‌ی دیگر دوباره امتحان کنید.", en: "Too many attempts — please try again in a few minutes." },
  name: { fa: "نام و نام خانوادگی را بنویسید.", en: "Please enter your full name." },
  phone: { fa: "شماره‌ی موبایل معتبر نیست (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).", en: "Please enter a valid Iranian mobile number (e.g. 09123456789)." },
  email: { fa: "نشانی ایمیل معتبر نیست.", en: "The e-mail address is not valid." },
  password: { fa: "رمز عبور باید دست‌کم ۸ نویسه باشد.", en: "The password must be at least 8 characters." },
  exists: { fa: "با این شماره قبلاً حساب ساخته شده است؛ وارد شوید.", en: "An account with this number already exists — please sign in." },
  emailTaken: { fa: "این ایمیل برای حساب دیگری ثبت شده است.", en: "This e-mail is already used by another account." },
  wrong: { fa: "شماره (یا ایمیل) یا رمز عبور درست نیست.", en: "The number (or e-mail) or password is not correct." },
  noPassword: { fa: "برای این حساب رمزی تعیین نشده است؛ با کد Pro وارد شوید یا با فروشگاه تماس بگیرید.", en: "This account has no password yet — sign in with your Pro code or contact the store." },
  disabled: { fa: "این حساب غیرفعال شده است؛ با فروشگاه تماس بگیرید.", en: "This account has been disabled — please contact the store." },
  signedOut: { fa: "نشست شما پایان یافته است؛ دوباره وارد شوید.", en: "Your session has ended — please sign in again." },
  saved: { fa: "ذخیره شد.", en: "Saved." },
  passwordChanged: { fa: "رمز عبور ذخیره شد.", en: "Your password has been saved." },
  currentWrong: { fa: "رمز فعلی درست نیست.", en: "The current password is not correct." },
  codeBad: { fa: "این کد معتبر نیست. کد ۱۲ رقمی را همان‌طور که دریافت کرده‌اید وارد کنید.", en: "This code is not valid. Enter the 12-digit code exactly as you received it." },
  codeRevoked: { fa: "این کد دیگر فعال نیست؛ برای کد تازه با فروشگاه تماس بگیرید.", en: "This code is no longer active — contact the store for a new one." },
  codeExpired: { fa: "اعتبار این کد به پایان رسیده است؛ برای تمدید با فروشگاه تماس بگیرید.", en: "This code has expired — contact the store to renew it." },
  codeOther: { fa: "این کد متعلق به حساب دیگری است. اگر حساب دیگری دارید، از این حساب خارج شوید و با کد وارد شوید.", en: "This code belongs to another account. Sign out first and sign in with the code." },
  proOn: { fa: "اشتراک Pro فعال شد؛ قیمت‌ها و موجودی اکنون برای شما نمایش داده می‌شود.", en: "Pro is active — prices and stock are now shown to you." },
  alreadyPro: { fa: "اشتراک Pro شما فعال است.", en: "Your Pro membership is already active." },
  pending: { fa: "درخواست قبلی شما در حال بررسی است.", en: "Your earlier request is still being reviewed." },
  requested: { fa: "درخواست شما ثبت شد. پس از بررسی، کد اشتراک برایتان ارسال می‌شود.", en: "Your request has been received. Once it is reviewed, your code will be sent to you." },
  business: { fa: "نام فروشگاه یا کسب‌وکار را بنویسید (اگر خرید شخصی است، «شخصی» بنویسید).", en: "Please enter your shop or business name (or “personal”)." },
  failed: { fa: "مشکلی پیش آمد؛ دوباره امتحان کنید.", en: "Something went wrong — please try again." },
};

/** Same-site path to return to after signing in; anything else falls back to the account page. */
function safeNext(v: unknown, lang: Lang): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?![/\\])[^\s]*$/.test(s) && !s.startsWith("/admin") ? s : href(lang, "/account");
}

const goodPassword = (p: string) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;

async function ipKey(): Promise<string> {
  return hashIp(await clientIp());
}

export async function signUp(input: Record<string, unknown>): Promise<Result<{ next: string }>> {
  const lang = langOf(input.lang);
  if (text(input.website, 200)) return { ok: false, error: MSG.failed[lang] }; // honeypot
  const name = text(input.name, 80);
  const phone = normalizePhone(text(input.phone, 30));
  const email = text(input.email, 160).toLowerCase();
  const password = typeof input.password === "string" ? input.password : "";
  if (name.length < 2) return { ok: false, error: MSG.name[lang], field: "name" };
  if (!phone) return { ok: false, error: MSG.phone[lang], field: "phone" };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: MSG.email[lang], field: "email" };
  if (!goodPassword(password)) return { ok: false, error: MSG.password[lang], field: "password" };
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  if (!(await allow(`signup:${await ipKey()}`, 3600, 6))) return { ok: false, error: MSG.rate[lang] };

  const row = { phone, email, name, password_hash: await hashPassword(password), business: text(input.business, 120), city: text(input.city, 80), last_sign_in_at: new Date().toISOString() };
  const { data, error } = await c.from(USERS).insert(row).select("id").single();
  if (error || !data) {
    if (error?.code === "23505") return /email/i.test(error.message) ? { ok: false, error: MSG.emailTaken[lang], field: "email" } : { ok: false, error: MSG.exists[lang], field: "phone" };
    console.error("[account] sign-up", error?.message, isMissingTable(error) ? "(run the migration)" : "");
    return { ok: false, error: MSG.db[lang] };
  }
  await startUserSession({ id: (data as { id: string }).id, session_version: 0, role: "user" }, false);
  return { ok: true, next: safeNext(input.next, lang) };
}

export async function signIn(input: Record<string, unknown>): Promise<Result<{ next: string; pro: boolean }>> {
  const lang = langOf(input.lang);
  const login = text(input.login, 160);
  const password = typeof input.password === "string" ? input.password : "";
  const phone = normalizePhone(login);
  const email = phone ? "" : login.toLowerCase();
  if ((!phone && !EMAIL_RE.test(email)) || !password || password.length > PASSWORD_MAX) return { ok: false, error: MSG.wrong[lang] };
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  // per IP, per IP and account (a stranger cannot lock someone out from another network) and a looser per-account ceiling
  const ip = await ipKey();
  const who = sha256(phone || email).slice(0, 24);
  if (!(await allow(`signin:${ip}`, 600, 12)) || !(await allow(`signin:${ip}:${who}`, 900, 6)) || !(await allow(`signin-acct:${who}`, 3600, 40))) {
    return { ok: false, error: MSG.rate[lang] };
  }
  const q = c.from(USERS).select(`${PROFILE_COLUMNS}, password_hash`);
  const { data, error } = await (phone ? q.eq("phone", phone) : q.eq("email", email)).limit(1).maybeSingle();
  if (error) {
    console.error("[account] sign-in", error.message);
    return { ok: false, error: MSG.db[lang] };
  }
  const user = data as (Account & { password_hash: string | null }) | null;
  if (user && !user.password_hash) {
    await checkPassword(password, null); // same timing as a wrong password
    return { ok: false, error: MSG.noPassword[lang] };
  }
  if (!(await checkPassword(password, user?.password_hash)) || !user) return { ok: false, error: MSG.wrong[lang] };
  if (user.disabled) return { ok: false, error: MSG.disabled[lang] };
  await c.from(USERS).update({ last_sign_in_at: new Date().toISOString() }).eq("id", user.id);
  const pro = (await proStatus(user.id)).active;
  await startUserSession(user, pro);
  return { ok: true, next: safeNext(input.next, lang), pro };
}

/**
 * Enters a Pro code. Signed in: unlocks Pro on this account (the code must be its own). Signed out: the code
 * also signs its account in — the way in for accounts the admin created without a password.
 */
export async function enterCode(input: Record<string, unknown>): Promise<Result<{ next: string; signedIn: boolean }>> {
  const lang = langOf(input.lang);
  const norm = normalizeCode(text(input.code, 40));
  const c = db();
  if (!c) return { ok: false, error: MSG.db[lang] };
  const ip = await ipKey();
  if (!(await allow(`code:${ip}`, 900, 10)) || !(await allow("code:global", 60, 120))) return { ok: false, error: MSG.rate[lang] };
  if (!norm) return { ok: false, error: MSG.codeBad[lang], field: "code" };
  let row;
  try {
    row = await findCode(norm);
  } catch (e) {
    console.error("[account] code lookup", e);
    return { ok: false, error: MSG.db[lang] };
  }
  if (!row) return { ok: false, error: MSG.codeBad[lang], field: "code" };
  const state = codeState(row);
  if (state === "revoked") return { ok: false, error: MSG.codeRevoked[lang], field: "code" };
  if (state === "expired") return { ok: false, error: MSG.codeExpired[lang], field: "code" };

  const me = await currentUser();
  if (me && me.id !== row.user_id) return { ok: false, error: MSG.codeOther[lang], field: "code" };
  let user: Account | null = me;
  if (!user) {
    const { data, error } = await c.from(USERS).select(PROFILE_COLUMNS).eq("id", row.user_id).maybeSingle();
    if (error) return { ok: false, error: MSG.db[lang] };
    user = data as Account | null;
    if (!user) return { ok: false, error: MSG.codeBad[lang], field: "code" };
  }
  if (user.disabled) return { ok: false, error: MSG.disabled[lang] };
  try {
    await touchCode(row);
  } catch (e) {
    console.error("[account] code touch", e);
    return { ok: false, error: MSG.failed[lang] };
  }
  if (!me) await c.from(USERS).update({ last_sign_in_at: new Date().toISOString() }).eq("id", user.id);
  await startUserSession(user, true);
  return { ok: true, message: MSG.proOn[lang], next: safeNext(input.next, lang), signedIn: !me };
}

/** Signs out of the account (and of an admin password session in this browser); the page then reloads. */
export async function signOut(): Promise<void> {
  await endUserSession();
  await endSession();
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
  const email = text(input.email, 160).toLowerCase();
  if (name.length < 2) return { ok: false, error: MSG.name[lang], field: "name" };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: MSG.email[lang], field: "email" };
  const { error } = await db()!
    .from(USERS)
    .update({
      name,
      email,
      business: text(input.business, 120),
      city: text(input.city, 80),
      address: text(input.address, 400),
      postal_code: text(input.postal_code, 20),
      updated_at: new Date().toISOString(),
    })
    .eq("id", me.id);
  if (error) {
    if (error.code === "23505") return { ok: false, error: MSG.emailTaken[lang], field: "email" };
    console.error("[account] update profile", error.message);
    return { ok: false, error: MSG.failed[lang] };
  }
  return { ok: true, message: MSG.saved[lang] };
}

/** Sets a new password. Accounts without one (created by the admin) set it without the current password. */
export async function changePassword(input: Record<string, unknown>): Promise<Result> {
  const lang = langOf(input.lang);
  const me = await signedIn(lang);
  if ("ok" in me) return me;
  const current = typeof input.current === "string" ? input.current : "";
  const next = typeof input.password === "string" ? input.password : "";
  if (!goodPassword(next)) return { ok: false, error: MSG.password[lang], field: "password" };
  if (!(await allow(`password:${me.id}`, 900, 6))) return { ok: false, error: MSG.rate[lang] };
  const c = db()!;
  const { data } = await c.from(USERS).select("password_hash").eq("id", me.id).maybeSingle();
  const stored = (data as { password_hash: string | null } | null)?.password_hash ?? null;
  if (stored && !(await checkPassword(current, stored))) return { ok: false, error: MSG.currentWrong[lang], field: "current" };
  const ver = me.session_version + 1;
  const { error } = await c
    .from(USERS)
    .update({ password_hash: await hashPassword(next), session_version: ver, updated_at: new Date().toISOString() })
    .eq("id", me.id)
    .eq("session_version", me.session_version);
  if (error) {
    console.error("[account] set password", error.message);
    return { ok: false, error: MSG.failed[lang] };
  }
  await startUserSession({ ...me, session_version: ver }, (await proStatus(me.id)).active);
  return { ok: true, message: MSG.passwordChanged[lang] };
}

export async function requestPro(input: Record<string, unknown>): Promise<Result> {
  const lang = langOf(input.lang);
  const me = await signedIn(lang);
  if ("ok" in me) return me;
  const status = await proStatus(me.id);
  if (status.active) return { ok: false, error: MSG.alreadyPro[lang] };
  const c = db()!;
  const { data: open } = await c.from(REQUESTS).select("id").eq("user_id", me.id).eq("status", "pending").limit(1).maybeSingle();
  if (open) return { ok: false, error: MSG.pending[lang] };
  if (!(await allow(`pro-request:${me.id}`, 86400, 3))) return { ok: false, error: MSG.rate[lang] };
  const business = text(input.business, 120);
  if (business.length < 2) return { ok: false, error: MSG.business[lang], field: "business" };
  const kinds = ["retail", "online", "wholesale", "personal", "other"];
  const row = {
    user_id: me.id,
    business,
    city: text(input.city, 80),
    instagram: text(input.instagram, 120),
    kind: kinds.includes(String(input.kind)) ? String(input.kind) : "other",
    note: text(input.note, 1000),
  };
  const { error } = await c.from(REQUESTS).insert(row);
  if (error) {
    console.error("[account] pro request", error.message);
    return { ok: false, error: MSG.failed[lang] };
  }
  // keep the business details on the account too, for orders
  if (!me.business || !me.city) await c.from(USERS).update({ business: me.business || business, city: me.city || row.city }).eq("id", me.id);
  after(async () => {
    const s = await getSettings();
    if (s.notify.onRequest) await notifyTeam(`درخواست تازه‌ی اشتراک Pro\n${me.name} — ${me.phone}\n${business}${row.city ? ` (${row.city})` : ""}${row.instagram ? `\nاینستاگرام: ${row.instagram}` : ""}${row.note ? `\n${row.note}` : ""}`, s.notify);
  });
  return { ok: true, message: MSG.requested[lang] };
}

export async function readAllMessages(): Promise<Result> {
  const me = await currentUser();
  if (!me) return { ok: false, error: MSG.signedOut.fa };
  await markAllRead(me.id);
  return { ok: true };
}

/** Re-checks Pro for this browser (e.g. after the admin revoked it) and fixes the readable hint. */
export async function refreshPro(): Promise<{ pro: boolean }> {
  const me = await currentUser();
  const pro = me ? (await proStatus(me.id)).active : false;
  await setProHint(pro);
  return { pro };
}

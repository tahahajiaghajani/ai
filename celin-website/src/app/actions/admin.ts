"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { signIn } from "@/app/actions/account";
import { canActivateAdmin, checkPassword, endSession, isAdminDevice, markAdminDevice, startSession } from "@/lib/admin-auth";
import { USERS, endUserSession, isAdminRow, sessionState, startUserSession } from "@/lib/auth";
import { cleanKey, guard } from "@/lib/admin-action";
import { encrypt, hashIp } from "@/lib/crypto";
import { db, isMissingColumn, UserError } from "@/lib/db";
import { sendEmail, mailHtml } from "@/lib/email";
import { latinDigits, normalizePhone } from "@/lib/format";
import { notifyTeam } from "@/lib/notify";
import { proStatus } from "@/lib/pro";
import { allow, limited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getSettingsFresh, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type NotifyChannel, type SmsProvider } from "@/lib/settings-types";
import { resetSlot, saveSlot } from "@/lib/slots";
import { createVideoUpload, finishVideoUpload, pruneVideos } from "@/lib/admin-video";
import type { Video } from "@/lib/video";
import { sendSms } from "@/lib/sms";
import { text, type Result } from "@/lib/action";

// ---------------------------------------------------------------- session

const RATE = "تلاش‌های زیادی انجام شد؛ ۱۵ دقیقه‌ی دیگر امتحان کنید.";
const RATE_ACCOUNT = "تلاش‌های زیادی برای این حساب انجام شد؛ یک ساعت دیگر امتحان کنید.";
// shared by both ADMIN_PASSWORD forms: a ceiling on wrong guesses from all addresses together (failures only,
// so the owner's right password never uses it up; a browser that proved the password before passes it)
const GLOBAL = { key: "admin-login:global", window: 900, max: 40 } as const;

async function globalCeiling(): Promise<boolean> {
  return !(await isAdminDevice()) && (await limited(GLOBAL.key, GLOBAL.window, GLOBAL.max));
}

async function wrongAdminPassword(): Promise<void> {
  await allow(GLOBAL.key, GLOBAL.window, GLOBAL.max);
  await new Promise((r) => setTimeout(r, 600));
}

/**
 * The optional ADMIN_PASSWORD login (break-glass). It opens the panel in this browser only and never changes
 * an account by itself: accounts become admins by proving ADMIN_PASSWORD on their own account (activateAdmin)
 * or through Users → «مدیر کردن» — in both cases only for a number in ADMIN_PHONES when that list is set.
 */
export async function login(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const ip = hashIp(await clientIp());
  if (!(await allow(`admin-login:${ip}`, 900, 8)) || (await globalCeiling())) return { error: RATE };
  if (!checkPassword(String(form.get("password") ?? ""))) {
    await wrongAdminPassword();
    return { error: "رمز مدیریت درست نیست." };
  }
  await startSession();
  await markAdminDevice();
  console.info("[admin] break-glass session opened with ADMIN_PASSWORD");
  redirect("/admin");
}

/**
 * /admin/login, the account form: the site's own sign-in (same action, limits and messages as /account/login)
 * as a real POST form, so it works before the page's script has loaded and the password never lands in the
 * address bar. An admin goes on to the panel; an account that may be made admin comes back here for the admin
 * password; any other account sees «no admin access».
 */
export async function adminSignIn(_prev: { error: string; login: string } | null, form: FormData): Promise<{ error: string; login: string } | null> {
  const login = String(form.get("username") ?? "").slice(0, 160);
  const r = await signIn({ login, password: String(form.get("password") ?? ""), lang: "fa", next: "/admin" });
  if (!r.ok) return { error: r.error, login };
  redirect(r.next.startsWith("/admin") ? r.next : "/admin/login");
}

/**
 * «فعال کردن پنل روی این حساب»: the account signed in here (with its password) proves ADMIN_PASSWORD once and
 * becomes an admin for good; from then on a normal sign-in opens the panel. Only when ADMIN_PASSWORD is set,
 * and — when the ADMIN_PHONES allow-list is set — only for a listed number. Rate-limited like the password
 * login, logged, the team is told (if notifications are on), and every other session of the account ends.
 */
export async function activateAdmin(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const s = await sessionState();
  if (s.state !== "ok") return { error: "نشست شما پایان یافته است؛ دوباره وارد شوید." };
  const me = s.user;
  if (s.via !== "pw") return { error: "اول با شماره‌ی موبایل و رمز عبور همین حساب وارد شوید." };
  if (!canActivateAdmin(me)) return { error: "پنل مدیریت روی این حساب فعال نمی‌شود." };
  const ip = hashIp(await clientIp());
  const accountKey = `admin-activate:${me.id}`;
  if (!(await allow(`admin-login:${ip}`, 900, 8)) || (await globalCeiling())) return { error: RATE };
  // per account: wrong guesses only, for an hour (the message says so)
  if (await limited(accountKey, 3600, 8)) return { error: RATE_ACCOUNT };
  if (!checkPassword(String(form.get("password") ?? ""))) {
    await allow(accountKey, 3600, 8);
    await wrongAdminPassword();
    console.warn(`[admin] wrong admin password for account ${me.id}`);
    return { error: "رمز مدیریت درست نیست." };
  }
  const c = db();
  if (!c) return { error: "پایگاه داده تنظیم نشده است." };
  const ver = me.session_version + 1;
  // compare-and-set on the session version: every other session of this account ends. The password is the
  // admin's own from now on (a later revoked Pro code must not remove it and lock the admin out).
  const write = (extra: Record<string, unknown>) =>
    c.from(USERS).update({ role: "admin", session_version: ver, updated_at: new Date().toISOString(), ...extra }).eq("id", me.id).eq("session_version", me.session_version).select("id");
  let { data, error } = await write({ password_from_code: false });
  if (isMissingColumn(error)) ({ data, error } = await write({})); // before the hardening migration
  if (error || !data?.length) {
    if (error) console.error("[admin] activate", error.message);
    return { error: "فعال‌سازی انجام نشد؛ دوباره امتحان کنید." };
  }
  console.info(`[admin] account ${me.id} (${me.phone}) is now an admin (proved ADMIN_PASSWORD)`);
  await startUserSession({ ...me, role: "admin", session_version: ver }, (await proStatus(me.id)).active);
  await markAdminDevice();
  after(async () => {
    const s2 = await getSettingsFresh().catch(() => null);
    if (s2) await notifyTeam(`پنل مدیریت سلین روی یک حساب فعال شد\n${me.name} — ${me.phone}`, s2.notify);
  });
  redirect("/admin");
}

/**
 * «خروج»: ends the panel and the account session of this browser. An admin account is signed out on every
 * device (its session version moves on), so a copied session cookie stops opening the panel too.
 */
export async function logout(): Promise<void> {
  const s = await sessionState();
  const c = db();
  if (s.state === "ok" && isAdminRow(s.user) && c) {
    const { error } = await c.from(USERS).update({ session_version: s.user.session_version + 1, updated_at: new Date().toISOString() }).eq("id", s.user.id).eq("session_version", s.user.session_version);
    if (error) console.error("[admin] logout", error.message);
  }
  await endSession();
  await endUserSession();
  redirect("/admin/login");
}

function refresh() {
  revalidatePath("/admin", "layout");
}

const bool = (v: unknown) => v === true || v === "on" || v === "true";

/** An https:// link, or "" for an empty field; anything else is refused with a message instead of being dropped. */
function httpsLink(v: unknown, max: number, label: string): string {
  const s = text(v, max);
  if (!s) return "";
  if (/^https:\/\/[^\s/]+/i.test(s)) return s;
  // a pasted address without the scheme (maps.app.goo.gl/…, neshan.org/…): https is assumed
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  throw new UserError(`${label} باید با https:// شروع شود.`);
}
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(latinDigits(String(v ?? "")).replace(/[,٬\s]/g, "")));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

// ---------------------------------------------------------------- settings

export async function saveContact(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const whatsapp = text(input.whatsapp, 40);
    await saveSettings("contact", {
      phone: latinDigits(text(input.phone, 40)),
      whatsapp: whatsapp ? normalizePhone(whatsapp) || latinDigits(whatsapp) : "",
      instagram: text(input.instagram, 80).replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, ""),
      telegram: text(input.telegram, 80).replace(/^@/, "").replace(/^https?:\/\/t\.me\//, ""),
      email: text(input.email, 120),
      address_fa: text(input.address_fa, 400),
      address_en: text(input.address_en, 400),
      hours_fa: text(input.hours_fa, 200),
      hours_en: text(input.hours_en, 200),
      mapUrl: httpsLink(input.mapUrl, 500, "لینک نقشه"),
    });
    refresh();
    return { ok: true, message: "اطلاعات تماس ذخیره شد." };
  });
}

export async function saveAnnouncement(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const link = text(input.link, 300);
    if (link && !link.startsWith("/") && !/^https:\/\//i.test(link)) throw new UserError("لینک نوار اطلاعیه باید با / (صفحه‌ای از همین سایت) یا https:// شروع شود.");
    if (/^\/[/\\]/.test(link)) throw new UserError("لینک نوار اطلاعیه باید با یک / یا https:// شروع شود.");
    await saveSettings("announcement", { enabled: bool(input.enabled), text_fa: text(input.text_fa, 200), text_en: text(input.text_en, 200), link });
    refresh();
    return { ok: true, message: "نوار اطلاعیه ذخیره شد." };
  });
}

export async function saveShop(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await saveSettings("shop", {
      minOrder: int(input.minOrder, 0, 1e12, 0),
      stockDisplay: input.stockDisplay === "level" ? "level" : "exact",
      lowStock: int(input.lowStock, 0, 1000, 3),
      orderNote_fa: text(input.orderNote_fa, 600),
      orderNote_en: text(input.orderNote_en, 600),
    });
    refresh();
    return { ok: true, message: "تنظیمات سفارش ذخیره شد." };
  });
}

export async function savePro(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await saveSettings("pro", { codeInInbox: bool(input.codeInInbox), defaultDays: int(input.defaultDays, 0, 3650, 365) });
    refresh();
    return { ok: true, message: "تنظیمات اشتراک Pro ذخیره شد." };
  });
}

export async function saveSeo(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await saveSettings("seo", { description_fa: text(input.description_fa, 300), description_en: text(input.description_en, 300) });
    refresh();
    return { ok: true, message: "ذخیره شد." };
  });
}

/** Telegram / Bale team notifications. An empty token field keeps the stored token. */
export async function saveNotify(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const cur = (await getSettingsFresh()).notify;
    const channel: NotifyChannel = input.channel === "telegram" || input.channel === "bale" ? input.channel : "none";
    const token = cleanKey(input.botToken);
    await saveSettings("notify", {
      channel,
      botTokenEnc: input.clearToken ? "" : token ? encrypt(token) : cur.botTokenEnc,
      chatId: text(input.chatId, 40).replace(/\s/g, ""),
      onOrder: bool(input.onOrder),
      onRequest: bool(input.onRequest),
    });
    refresh();
    return { ok: true, message: "تنظیمات اعلان ذخیره شد." };
  });
}

export async function testNotify(): Promise<Result> {
  return guard(async () => {
    const r = await notifyTeam("پیام آزمایشی سایت سلین ✓ اعلان سفارش‌ها و درخواست‌های Pro به این گفتگو می‌رسد.");
    if (!r.ok) throw new UserError(r.error === "not configured" ? "کانال، توکن و شناسه‌ی گفتگو را کامل کنید." : `ارسال نشد: ${r.error}`);
    return { ok: true, message: "پیام آزمایشی فرستاده شد." };
  });
}

export async function saveSms(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const cur = (await getSettingsFresh()).sms;
    const provider: SmsProvider = input.provider === "kavenegar" || input.provider === "smsir" ? input.provider : "none";
    const key = cleanKey(input.apiKey);
    const templateId = (v: unknown) => latinDigits(text(v, 20)).replace(/\D/g, "");
    await saveSettings("sms", {
      provider,
      apiKeyEnc: input.clearKey ? "" : key ? encrypt(key) : cur.apiKeyEnc,
      sender: latinDigits(text(input.sender, 30)).replace(/\s/g, ""),
      codeTemplate: templateId(input.codeTemplate),
      statusTemplate: templateId(input.statusTemplate),
      onCode: bool(input.onCode),
      onStatus: bool(input.onStatus),
    });
    refresh();
    return { ok: true, message: "تنظیمات پیامک ذخیره شد." };
  });
}

export async function testSms(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const phone = normalizePhone(text(input.phone, 30));
    if (!phone) throw new UserError("شماره‌ی موبایل معتبر نیست.");
    const r = await sendSms(phone, { kind: "test", text: "سلین | پیامک آزمایشی سایت ✓" });
    if (!r.ok) throw new UserError(r.error === "not configured" ? "سرویس و کلید پیامک را ذخیره کنید." : `ارسال نشد: ${r.error}`);
    return { ok: true, message: "پیامک آزمایشی فرستاده شد." };
  });
}

export async function saveEmail(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const cur = (await getSettingsFresh()).email;
    const key = cleanKey(input.resendKey);
    await saveSettings("email", { resendKeyEnc: input.clearKey ? "" : key ? encrypt(key) : cur.resendKeyEnc, mailFrom: text(input.mailFrom, 200) });
    refresh();
    return { ok: true, message: "تنظیمات ایمیل ذخیره شد." };
  });
}

export async function testEmail(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const to = text(input.to, 160);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new UserError("ایمیل معتبر نیست.");
    const r = await sendEmail(to, "ایمیل آزمایشی سلین", mailHtml("fa", ["این ایمیل آزمایشی از سایت سلین فرستاده شده است. ایمیل کد اشتراک Pro به همین شکل به اعضا می‌رسد."]));
    if (!r.ok) throw new UserError(r.error === "not configured" ? "کلید Resend و فرستنده را ذخیره کنید." : `ارسال نشد: ${r.error}`);
    return { ok: true, message: "ایمیل آزمایشی فرستاده شد." };
  });
}

/** Restores one settings group to its defaults (secrets are kept). */
export async function resetSettingsGroup(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const key = text(input.key, 30);
    if (key === "contact" || key === "announcement" || key === "shop" || key === "pro" || key === "seo") {
      await saveSettings(key, DEFAULT_SETTINGS[key]);
      refresh();
      return { ok: true, message: "به حالت پیش‌فرض برگشت." };
    }
    throw new UserError("این بخش قابل بازنشانی نیست.");
  });
}

// ---------------------------------------------------------------- design pictures

export async function adminSaveSlot(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await saveSlot(text(input.key, 60), { media_id: input.media_id, media_mobile_id: input.media_mobile_id, ...("video_id" in input ? { video_id: input.video_id } : {}), texts: input.texts });
    refresh();
    return { ok: true, message: "تصویر و متن این بخش ذخیره شد و در سایت نمایش داده می‌شود." };
  });
}

export async function adminResetSlot(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    await resetSlot(text(input.key, 60));
    refresh();
    return { ok: true, message: "این بخش به تصویر و متن پیش‌فرض برگشت." };
  });
}

/** Slot video, step 1: checks the picked file (type, size) and returns a one-time upload URL for the browser. */
export async function adminVideoUploadUrl(input: Record<string, unknown>): Promise<Result<{ path: string; url: string }>> {
  return guard(async () => {
    const r = await createVideoUpload({ type: input.type, name: input.name, size: input.size });
    return { ok: true, ...r };
  });
}

/** Slot video, step 2: after the browser's upload — checks the stored file and records it. */
export async function adminFinishVideo(input: Record<string, unknown>): Promise<Result<{ video: Video }>> {
  return guard(async () => {
    const video = await finishVideoUpload({ path: input.path, width: input.width, height: input.height, duration: input.duration });
    after(() => pruneVideos().catch((e) => console.error("[admin] video cleanup", e)));
    return { ok: true, message: "ویدئو بارگذاری شد؛ برای نمایش در سایت «ذخیره» را بزنید.", video };
  });
}

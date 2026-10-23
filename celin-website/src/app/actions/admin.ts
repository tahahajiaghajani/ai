"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, endSession, startSession } from "@/lib/admin-auth";
import { USERS, currentUser, startUserSession } from "@/lib/auth";
import { cleanKey, guard } from "@/lib/admin-action";
import { encrypt, hashIp } from "@/lib/crypto";
import { requireDb, UserError } from "@/lib/db";
import { sendEmail, mailHtml } from "@/lib/email";
import { latinDigits, normalizePhone } from "@/lib/format";
import { notifyTeam } from "@/lib/notify";
import { proStatus } from "@/lib/pro";
import { allow } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getSettingsFresh, saveSettings } from "@/lib/settings";
import { DEFAULT_SETTINGS, type NotifyChannel, type SmsProvider } from "@/lib/settings-types";
import { resetSlot, saveSlot } from "@/lib/slots";
import { sendSms } from "@/lib/sms";
import { text, type Result } from "@/lib/action";

// ---------------------------------------------------------------- session

export async function login(_prev: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const ip = hashIp(await clientIp());
  if (!(await allow(`admin-login:${ip}`, 900, 8))) return { error: "تلاش‌های زیادی انجام شد؛ ۱۵ دقیقه‌ی دیگر امتحان کنید." };
  if (!checkPassword(String(form.get("password") ?? ""))) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: "رمز عبور درست نیست." };
  }
  await startSession();
  // the password also promotes the account signed in in this browser, so from now on it is recognised as admin
  const me = await currentUser();
  if (me && me.role !== "admin") {
    const { error } = await requireDb().from(USERS).update({ role: "admin", updated_at: new Date().toISOString() }).eq("id", me.id);
    if (!error) await startUserSession({ ...me, role: "admin" }, (await proStatus(me.id)).active);
  }
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/admin/login");
}

function refresh() {
  revalidatePath("/admin", "layout");
}

const bool = (v: unknown) => v === true || v === "on" || v === "true";
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
      mapUrl: /^https:\/\//.test(text(input.mapUrl, 500)) ? text(input.mapUrl, 500) : "",
    });
    refresh();
    return { ok: true, message: "اطلاعات تماس ذخیره شد." };
  });
}

export async function saveAnnouncement(input: Record<string, unknown>): Promise<Result> {
  return guard(async () => {
    const link = text(input.link, 300);
    await saveSettings("announcement", { enabled: bool(input.enabled), text_fa: text(input.text_fa, 200), text_en: text(input.text_en, 200), link: link.startsWith("/") || link.startsWith("https://") ? link : "" });
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
    await saveSlot(text(input.key, 60), { media_id: input.media_id, media_mobile_id: input.media_mobile_id, texts: input.texts });
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

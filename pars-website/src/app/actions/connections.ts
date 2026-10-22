"use server";

import { revalidatePath } from "next/cache";
import type { AdminResult } from "@/app/actions/admin";
import { guard, str } from "@/lib/admin-action";
import { decrypt, encrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { getSettingsFresh, saveSettings } from "@/lib/settings";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Saves the Resend key (encrypted) and the sender address. An empty key keeps the stored one. */
export async function saveEmail(input: { apiKey?: string; mailFrom: string; clearKey?: boolean }): Promise<AdminResult> {
  return guard(async () => {
    const cur = (await getSettingsFresh()).email;
    const mailFrom = str(input.mailFrom, 200);
    const address = /<([^>]+)>\s*$/.exec(mailFrom)?.[1] ?? mailFrom;
    if (mailFrom && !EMAIL.test(address)) return { ok: false, error: "نشانی فرستنده معتبر نیست؛ مثلاً: پشتیبانی پارس <support@parspmi.ir>" };
    const key = str(input.apiKey, 300);
    if (key && !/^re_[A-Za-z0-9_]+$/.test(key)) return { ok: false, error: "کلید Resend معمولاً با re_ شروع می‌شود." };
    await saveSettings("email", {
      mailFrom,
      resendKeyEnc: input.clearKey ? undefined : key ? encrypt(key) : cur.resendKeyEnc,
      resendKeyHint: input.clearKey ? undefined : key ? `…${key.slice(-4)}` : cur.resendKeyHint,
    });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "تنظیمات ایمیل ذخیره شد." };
  });
}

/** Sends a test e-mail with the stored (or just typed) settings. */
export async function testEmail(input: { to: string; apiKey?: string; mailFrom?: string }): Promise<AdminResult> {
  return guard(async () => {
    const to = str(input.to, 200);
    if (!EMAIL.test(to)) return { ok: false, error: "نشانی گیرنده معتبر نیست." };
    const s = (await getSettingsFresh()).email;
    const key = str(input.apiKey, 300) || decrypt(s.resendKeyEnc) || env.resendKey;
    const from = str(input.mailFrom, 200) || s.mailFrom || env.mailFrom;
    if (!key || !from) return { ok: false, error: "کلید Resend و نشانی فرستنده هر دو لازم است." };
    const r = await sendEmail(
      to,
      "آزمایش ایمیل سایت پارس",
      `<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:2">این یک ایمیل آزمایشی از پنل مدیریت سایت مدیریت پروژه پارس است. اگر آن را می‌بینید، ارسال ایمیل به مشتری‌ها درست کار می‌کند.</div>`,
      { key, from },
    );
    if (!r.ok) return { ok: false, error: `ارسال ناموفق: ${r.error}` };
    return { ok: true, message: `ایمیل آزمایشی به ${to} فرستاده شد.` };
  });
}

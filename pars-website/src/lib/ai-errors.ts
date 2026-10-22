/** Persian explanations of AI provider failures for the admin panel (client-safe). */

export const AI_ERROR_HINT: Record<string, string> = {
  auth: "کلید پذیرفته نشد: نامعتبر است، مسدود شده (مثلاً به‌خاطر گزارش نشت) یا پروژه‌اش محدود شده است. در Google AI Studio یک کلید تازه بسازید.",
  region: "سرویس، موقعیت سرور سایت را نپذیرفت. سایت باید از سروری خارج از ایران (مثل Vercel) به سرویس وصل شود؛ اگر آدرس پایه‌ی API را روی درگاه داخلی گذاشته‌اید، خالی‌اش کنید.",
  quota: "سهمیه‌ی روزانه‌ی این مدل تمام شده یا این مدل پلن رایگان ندارد.",
  rate: "محدودیت تعداد درخواست در دقیقه؛ چند ثانیه بعد دوباره ممکن است.",
  overloaded: "این مدل الان شلوغ است (خطای موقت سرویس).",
  timeout: "مدل در زمان مقرر پاسخ نداد.",
  network: "سرور سایت به سرویس وصل نشد (شبکه یا آدرس پایه‌ی API را بررسی کنید).",
  model: "این مدل وجود ندارد یا برای این کلید باز نیست (مدل‌های 2.5 برای کلیدهای جدید بسته شده‌اند).",
  invalid: "سرویس درخواست را نپذیرفت.",
  blocked: "پاسخ توسط فیلتر ایمنی مسدود شد.",
  other: "خطای سرویس.",
  skipped: "به‌تازگی خطای ماندگار داده بود و فعلاً دوباره امتحان نشد.",
};

/** One line for the admin: the explanation, then what the provider itself said. */
export function aiErrorText(e: { kind?: string; status?: number; message?: string }): string {
  const hint = AI_ERROR_HINT[e.kind ?? "other"] ?? AI_ERROR_HINT.other;
  const said = [e.status ? `(${e.status})` : "", (e.message ?? "").slice(0, 200)].filter(Boolean).join(" ");
  return said ? `${hint} ${said}` : hint;
}

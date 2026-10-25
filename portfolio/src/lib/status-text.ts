/** Persian explanations for what the panel's live checks and tests can report (pure, unit-tested where it parses). */
import type { ProviderErrorKind } from "@/lib/ai/gemini";

export const AI_ERROR: Record<ProviderErrorKind, string> = {
  auth: "کلید پذیرفته نشد: نامعتبر است، غیرفعال شده یا Google آن را لو رفته شناخته است. در Google AI Studio کلید تازه بسازید.",
  region: "Google درخواست را از منطقه‌ی این سرور نپذیرفت. در Vercel → Settings → Functions، منطقه را روی یک منطقه‌ی آمریکا یا اروپا بگذارید.",
  quota: "سهمیه‌ی روزانه‌ی رایگان این مدل‌ها تمام شده؛ فردا دوباره امتحان کنید یا مدل دیگری اضافه کنید.",
  rate: "تعداد درخواست در دقیقه زیاد بود؛ چند ثانیه بعد دوباره امتحان کنید.",
  overloaded: "مدل الان شلوغ است؛ کمی بعد دوباره امتحان کنید.",
  timeout: "سرویس هوش مصنوعی در زمان مقرر پاسخ نداد.",
  network: "اتصال به Google برقرار نشد.",
  model: "هیچ‌کدام از مدل‌ها در دسترس این کلید نیست؛ نام مدل‌ها را بررسی کنید.",
  invalid: "درخواست آزمایشی نامعتبر شمرده شد.",
  blocked: "پاسخ به‌دلیل سیاست‌های ایمنی متوقف شد.",
  other: "خطای ناشناخته از سرویس هوش مصنوعی.",
};

/** Failures that say "try again later", not "this setup is wrong". */
export const AI_TRANSIENT: ProviderErrorKind[] = ["rate", "overloaded", "timeout", "network", "quota"];

/** What a Telegram/Bale Bot API error means for the person setting it up. */
export function botErrorFa(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("chat not found")) return "شناسه‌ی گفتگو اشتباه است، یا هنوز به ربات پیام نداده‌اید (/start).";
  if (d.includes("unauthorized") || d === "not found" || d.includes("http 404") || d.includes("http 401")) return "توکن ربات نادرست یا باطل شده است.";
  if (d.includes("blocked")) return "ربات را مسدود کرده‌اید؛ از مسدودی درآورید و دوباره /start بزنید.";
  if (d.includes("kicked") || d.includes("not a member")) return "ربات عضو آن گروه یا کانال نیست.";
  if (d === "network" || d === "timeout") return "اتصال به سرور تلگرام یا بله برقرار نشد.";
  return description;
}

/** GitHub's github-authentication-token-expiration header: "2026-11-25 10:00:00 UTC" or "2026-11-25 10:00:00 +0330". */
export function parseTokenExpiry(header: string | null | undefined): number | null {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) (?:UTC|([+-]\d\d)(\d\d))$/.exec((header ?? "").trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}${m[3] ? `${m[3]}:${m[4]}` : "Z"}`);
  return Number.isFinite(t) ? t : null;
}

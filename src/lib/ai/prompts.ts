import "server-only";
import { db } from "@/lib/supabase/admin";

/** System agents (not workflow steps) whose prompts are versioned too. */
export type AgentKey = "knowledge" | "summarize" | "optimizer";

/** Shared ground rules at the top of every built-in agent prompt (the user's own context is added after). */
export const BASE = `تو عضوی از یک تیم کوچک هوش مصنوعی هستی که برای کاربر کارهای واقعی انجام می‌دهد.
پاسخ باید فنی، دقیق، عملی و بدون حاشیه باشد. زبان: فارسی روان (نام‌ها، کد، فیلدها و دستورات به همان شکل اصلی).

اصول قطعی:
1. منبع حقیقت «درخواست»، فایل‌های پیوست و فایل‌های پروژه است. اگر درخواست به کد یا سند موجود اشاره می‌کند، اول دقیق بفهم آن‌ها چطور کار می‌کنند (فناوری، روش دریافت داده، نام دقیق فیلدها، الگوها و ساختار) و راهکار را بر همان پایه بساز: استفاده‌ی مجدد و تقلید، نه اختراع دوباره.
2. متناسب با اندازه‌ی کار: کار ساده، برنامه‌ی کوتاه. چیزی که خواسته نشده و لازم نیست (زیرساخت، فریم‌ورک، تست، مستند اضافه) پیشنهاد یا تولید نکن.
3. دقیقاً همان چیزی را هدف بگیر که خواسته شده (قالب و تعداد خروجی را از درخواست دربیاور).
4. حدس نزن: نام‌ها و شناسه‌ها را فقط از فایل‌ها نقل کن؛ آنچه نیست را صریحاً «کمبود» بنویس.
5. فایل‌ها همیشه کامل نگه داشته می‌شوند: هیچ فایلی را تکه‌تکه نکن و از هر محتوایی فقط یک نسخه بساز.`;

/** System prompt of the in-app executor (code agent). */
export const CODER_PROMPT = `${BASE}

نقش تو: «مجری». درخواست را خودت کامل انجام بده: فایل‌های مرتبط را پیدا کن، بخوان، ویرایش یا ایجاد کن.
روش کار با ابزارها:
- اول با list_files (با query) و search_code فایل‌های مرتبط را پیدا کن؛ کورکورانه همه‌چیز را نخوان. نقشه‌ی فایل‌ها و دانش پروژه در پیام اول آمده است.
- قبل از تغییر هر فایل آن را با read_file بخوان.
- برای تغییر فایل موجود edit_file (جایگزینی دقیق) را به کار ببر؛ write_file فقط برای فایل جدید یا بازنویسی کامل. فایل جدید را کنار فایل‌های هم‌نوعش در پوشه‌ی مناسب پروژه بساز.
- فایل‌های بزرگ را با write_file و سپس چند append_file (هر بار حداکثر حدود ۱۵۰ خط) بنویس تا هر پاسخ کوتاه بماند؛ نتیجه یک فایل کامل است.
- سبک، کتابخانه‌ها و قراردادهای خود پروژه را حفظ کن؛ فقط آنچه درخواست لازم دارد تغییر کند.
- اگر پروژه‌ای در کار نیست، خروجی خواسته‌شده را به صورت فایل(های) کامل با نام گویا بساز.
- در پایان finish را با خلاصه‌ی کوتاه فارسی صدا بزن: چه کردی، کدام فایل‌ها ساخته یا تغییر کرد، و چه چیزی هنوز لازم است.`;

export const DEFAULT_PROMPTS: Record<AgentKey, string> = {
  knowledge: `${BASE}

نقش تو: «مدیر دانش پروژه». فایل KNOWLEDGE.md فعلی پروژه و گزارش آخرین کار روی پروژه (درخواست، پاسخ، فایل‌های تغییرکرده) را دریافت می‌کنی.
نسخه‌ی به‌روز و کامل KNOWLEDGE.md را برگردان (Markdown، فقط متن فایل):
- ساختار و بخش‌های فعلی را حفظ کن؛ دانش جدید و ماندگار را در جای درست اضافه کن (معماری، فایل‌های کلیدی و نقششان، قراردادها، تصمیم‌ها و دلیلشان، درس‌ها، کارهای باز).
- تکراری‌ها را ادغام کن، موارد منسوخ را اصلاح کن، جزئیات گذرا و کد طولانی را ننویس (فقط نام فایل و نماد).
- فایل باید برای کسی که بعداً روی پروژه کار می‌کند راهنمای سریع و دقیق باشد.`,

  summarize: `${BASE}

نقش تو: «نقشه‌کش پروژه». برای هر فایل پروژه یک خلاصه‌ی یک‌خطی فارسی (حداکثر ۲۰ کلمه) بنویس: این فایل چیست و چه نقشی در پروژه دارد (نام نماد/صفحه/جدول مهم را بیاور).
فقط JSON مطابق اسکیما برگردان.`,

  optimizer: `${BASE}

نقش تو: «مهندس پرامپت و بهبود مستمر».
پرامپت سیستمی فعلی یک ایجنت، بازخوردهای کاربر (مثبت/منفی) و نمونه‌ی خروجی‌ها را دریافت می‌کنی.
یک نسخه‌ی بهبودیافته از پرامپت پیشنهاد بده که مشکلات گزارش‌شده را برطرف کند و نقاط قوت را حفظ کند.
فقط JSON مطابق اسکیما برگردان.`,
};

const cache = new Map<string, { at: number; value: string }>();

/** Forget cached prompts after a new version was saved or activated. */
export function clearPromptCache(userId?: string, agent?: string) {
  if (userId && agent) cache.delete(`${userId}:${agent}`);
  else cache.clear();
}

/** The user's active prompt version of an agent (built-in or custom), else its default. */
export async function getAgentPrompt(userId: string, agent: string, fallback?: string): Promise<string> {
  const key = `${userId}:${agent}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const { data } = await db()
    .from("agent_prompts")
    .select("content")
    .eq("user_id", userId)
    .eq("agent", agent)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const value = data?.content || fallback || DEFAULT_PROMPTS[agent as AgentKey] || "";
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The user's work context, appended to every agent's instructions. */
export function withAbout(prompt: string, about: string): string {
  return about.trim() ? `${prompt}\n\n## زمینه‌ی کاری کاربر\n${about.trim()}` : prompt;
}

// ---------------------------------------------------------------------------
// JSON schemas for structured outputs
// ---------------------------------------------------------------------------

export const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, summary: { type: "string" } },
        required: ["path", "summary"],
      },
    },
  },
  required: ["files"],
};

export const OPTIMIZER_SCHEMA = {
  type: "object",
  properties: {
    improved_prompt: { type: "string" },
    rationale: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
  },
  required: ["improved_prompt", "rationale"],
};

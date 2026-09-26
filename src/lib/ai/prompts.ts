import "server-only";
import { db } from "@/lib/supabase/admin";

/** System agents (not workflow steps); workflow agents live in the registry (lib/workflow/registry). */
export type AgentKey = "knowledge" | "optimizer";

/** Shared ground rules at the top of every built-in agent prompt. */
export const BASE = `تو عضوی از یک تیم کوچک هوش مصنوعی در یک شرکت نرم‌افزاری هستی که برای بانک‌ها نرم‌افزار مدیریتی می‌سازد.
مدیر پروژه خودش توسعه‌دهنده و مهندس IT است؛ پاسخ باید فنی، دقیق، عملی و بدون حاشیه باشد.
زبان: فارسی روان (نام‌ها، کد، فیلدها و دستورات به همان شکل اصلی).

اصول قطعی:
1. منبع حقیقت، «درخواست»، «دستور مدیر» و «فایل‌های پیوست» است. اگر درخواست به نمونه، کد یا سند موجود اشاره می‌کند، اول دقیق بفهم آن نمونه‌ها چطور کار می‌کنند (فناوری، روش دریافت داده، منابع/لیست‌ها/جدول‌ها، نام دقیق فیلدها، الگوها و ساختار) و راهکار را بر همان پایه بساز: هر چه ممکن است استفاده‌ی مجدد و تقلید، نه اختراع دوباره.
2. متناسب با اندازه‌ی کار: کار ساده، برنامه‌ی کوتاه. هیچ زیرساخت، سرور، دیتابیس، کش، فریم‌ورک، تست، اسکریپت استقرار یا مستندی که در درخواست نیامده و واقعاً لازم نیست، پیشنهاد یا تولید نکن.
3. دقیقاً همان چیزی را هدف بگیر که خواسته شده (قالب و تعداد خروجی نهایی را از درخواست دربیاور).
4. حدس نزن: شناسه‌ها، نام‌ها و آدرس‌ها را فقط از فایل‌ها نقل کن. آنچه در فایل‌ها نیست را صریحاً «کمبود» بنویس و بگو دقیقاً چه چیزی لازم است.
5. اگر «دانش بازیابی‌شده» داده شده، فقط موارد واقعاً مرتبط را به کار ببر.`;

export const DEFAULT_PROMPTS: Record<AgentKey, string> = {
  knowledge: `${BASE}

نقش تو: «مدیر دانش سازمانی».
از خروجی‌های این تسک، دانش قابل استفاده‌ی مجدد استخراج کن تا در آینده برای کارهای مشابه از صفر شروع نکنیم:
- snippet: قطعه‌کد/کوئری/اسکریپت قابل استفاده‌ی مجدد (همراه با کد کامل)
- workflow: فرایند یا ورکفلو قابل تکرار
- lesson: درس آموخته، نکته‌ی کلیدی، ترفند
- dead_end: رویکردی که جواب نداد و چرا
- prompt: پرامپت یا دستورالعملی که نتیجه‌ی خوب داد
- decision: تصمیم فنی و دلیلش
- reference: منبع/مستند مفید (مثلاً ساختار یک لیست یا سرویس و نام فیلدهایش)
- requester_profile: نکات نحوه‌ی کار با این تسک‌دهنده (سبک درخواست، انتظارات، ترجیحات، حساسیت‌ها)
هر مورد باید مستقل و بدون نیاز به کانتکست دیگر قابل فهم باشد. به هر مورد امتیاز ارزش استفاده‌ی مجدد ۱ تا ۵ بده.
حداکثر ۶ مورد با بیشترین ارزش؛ محتوای هر مورد حداکثر حدود ۴۰۰ کلمه.
فقط JSON مطابق اسکیما برگردان.`,

  optimizer: `${BASE}

نقش تو: «مهندس پرامپت و بهبود مستمر».
پرامپت سیستمی فعلی یک ایجنت، بازخوردهای مدیر (مثبت/منفی) و نمونه‌ی خروجی‌ها را دریافت می‌کنی.
یک نسخه‌ی بهبودیافته از پرامپت پیشنهاد بده که مشکلات گزارش‌شده را برطرف کند و نقاط قوت را حفظ کند.
فقط JSON مطابق اسکیما برگردان.`,
};

const cache = new Map<string, { at: number; value: string }>();

/** Forget cached prompts after a new version was saved or activated. */
export function clearPromptCache(agent?: string) {
  if (agent) cache.delete(agent);
  else cache.clear();
}

/** Active prompt version of an agent (built-in or custom), else its default. */
export async function getAgentPrompt(agent: string, fallback?: string): Promise<string> {
  const hit = cache.get(agent);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const { data } = await db()
    .from("agent_prompts")
    .select("content")
    .eq("agent", agent)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const value = data?.content || fallback || DEFAULT_PROMPTS[agent as AgentKey] || "";
  cache.set(agent, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------------
// JSON schemas for structured outputs
// ---------------------------------------------------------------------------

export const KNOWLEDGE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["snippet", "workflow", "lesson", "dead_end", "prompt", "decision", "reference", "requester_profile"] },
          title: { type: "string" },
          content: { type: "string", description: "متن کامل Markdown" },
          tags: { type: "array", items: { type: "string" } },
          score: { type: "number", description: "ارزش استفاده‌ی مجدد ۱ تا ۵" },
        },
        required: ["kind", "title", "content", "score"],
      },
    },
  },
  required: ["items"],
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

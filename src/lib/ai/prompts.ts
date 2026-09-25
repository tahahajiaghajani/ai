import "server-only";
import { db } from "@/lib/supabase/admin";

export type AgentKey = "research" | "wbs_outline" | "wbs_detail" | "methods" | "execute" | "report" | "knowledge" | "optimizer";

export const AGENT_LABELS: Record<AgentKey, string> = {
  research: "ایجنت ۱ — تحقیق و راهکار",
  wbs_outline: "ایجنت ۲ — فازهای WBS",
  wbs_detail: "ایجنت ۲ — جزئیات WBS",
  methods: "ایجنت ۳ — روش انجام زیرفعالیت‌ها",
  execute: "ایجنت ۴ — انجام کارهای ساده و آماده‌سازی",
  report: "گزارش پیش‌کار",
  knowledge: "استخراج دانش",
  optimizer: "بهینه‌ساز پرامپت‌ها",
};

const BASE = `تو عضوی از یک تیم چندعاملی (multi-agent) در یک شرکت نرم‌افزاری هستی که اپلیکیشن‌های مدیریتی برای بانک‌ها می‌سازد.
مدیر پروژه، خودش توسعه‌دهنده، طراح سیستم و مهندس IT است؛ پس پاسخ‌هایت باید فنی، دقیق، عملی و بدون حاشیه باشد.
- زبان خروجی: فارسی روان (اصطلاحات فنی، نام ابزارها، کد و دستورات به انگلیسی بمانند).
- ملاحظات حوزه‌ی بانکی (امنیت، محرمانگی داده، لاگ ممیزی، الزامات نظارتی، پایداری) را هر جا مرتبط است لحاظ کن.
- اگر «دانش بازیابی‌شده» در اختیارت است، اول از آن استفاده کن تا کار از صفر ساخته نشود و بن‌بست‌های قبلی تکرار نشوند.
- حدس نزن؛ هر جا فرض می‌کنی، صریحاً بنویس «فرض:».`;

export const DEFAULT_PROMPTS: Record<AgentKey, string> = {
  research: `${BASE}

نقش تو: «پژوهشگر ارشد و معمار راهکار».
وظیفه: درباره‌ی تسک داده‌شده تحقیق کن و توضیح بده این تسک چگونه به بهترین شکل انجام می‌شود.
ساختار خروجی (Markdown):
# خلاصه‌ی درک تسک
# فرضیات و ابهامات (و پیشنهاد برای رفع هرکدام)
# گزینه‌های انجام کار (مقایسه‌ی مزایا/معایب/هزینه/ریسک)
# راهکار پیشنهادی و دلیل انتخاب
# مراحل کلی انجام
# ابزارها، کتابخانه‌ها و منابع لازم
# ریسک‌ها و راه‌های کاهش
# معیارهای پذیرش (Definition of Done)`,

  wbs_outline: `${BASE}

نقش تو: «مدیر پروژه و متخصص WBS».
بر اساس تحقیق انجام‌شده، کار را به فازهای اصلی (سطح ۱ WBS) بشکن. فازها باید کامل (قانون ۱۰۰٪)، بدون هم‌پوشانی و به ترتیب منطقی باشند.
فقط JSON مطابق اسکیمای داده‌شده برگردان.`,

  wbs_detail: `${BASE}

نقش تو: «مدیر پروژه و متخصص WBS».
فقط فاز مشخص‌شده را تا سطح فعالیت‌های قابل انجام (work package) بشکن. هر فعالیت باید کوچک، مشخص، قابل تحویل و قابل تخمین باشد.
برای هر فعالیت تعیین کن:
- complexity: simple (کاملاً توسط هوش مصنوعی در یک مرحله قابل انجام است) | medium | complex
- type: research | design | build | config | data | test | doc | deploy | coordination
- deliverable: خروجی ملموس
شناسه‌ها را به صورت «شماره‌ی فاز.شماره‌ی فعالیت» بساز (مثل 2.3).
فقط JSON مطابق اسکیما برگردان.`,

  methods: `${BASE}

نقش تو: «متخصص اجرا».
برای هر زیرفعالیتی که داده می‌شود، روش دقیق انجام آن را تحقیق کن و بنویس.
برای هر فعالیت دقیقاً با این قالب شروع کن: «### [شناسه] عنوان»
و سپس:
- **ورودی‌ها**
- **گام‌های اجرایی** (شماره‌دار و دقیق؛ دستورات/کد نمونه در صورت نیاز)
- **ابزار/فناوری**
- **خروجی و معیار پذیرش**
- **دام‌ها و نکات**
- **تخمین زمان**`,

  execute: `${BASE}

نقش تو: «مجری».
برای هر فعالیت داده‌شده:
- اگر complexity آن simple است: کار را کامل انجام بده و خروجی نهایی‌اش را تولید کن.
- اگر medium یا complex است: فقط کارهای ابتدایی و آماده‌سازی را انجام بده (اسکلت کد، ساختار پوشه، قالب سند، اسکریپت‌های اولیه، چک‌لیست، داده‌ی نمونه، پیکربندی پایه) تا انجام کار اصلی سریع‌تر شود.
هر فایلی که تولید می‌کنی را دقیقاً در این قالب بنویس:
<<<FILE path="مسیر/نسبی/نام-فایل.پسوند" desc="توضیح کوتاه فایل">>>
محتوای کامل فایل
<<<END FILE>>>
بعد از فایل‌های هر فعالیت، یک بخش «### گزارش [شناسه]» بنویس: چه انجام شد، چه باقی ماند، و چه چیزی برای کار اصلی (Claude) مهم است.
مسیر فایل‌ها نسبی باشد و با شناسه‌ی فعالیت شروع شود (مثل 2.3/schema.sql).`,

  report: `${BASE}

نقش تو: «هماهنگ‌کننده‌ی تحویل».
یک گزارش جامع پیش‌کار بنویس که Claude (مجری کار اصلی) با خواندن آن سریع و بدون سردرگمی کار را تمام کند:
# خلاصه‌ی اجرایی
# آنچه در پیش‌کار انجام شد (به تفکیک فعالیت)
# آنچه باقی مانده (اولویت‌بندی‌شده)
# نقشه‌ی فایل‌ها (کدام فایل چیست و به چه کاری می‌آید)
# پیشنهاد برنامه‌ی کار برای Claude (گام‌به‌گام)
# ریسک‌ها و سوالات باز برای مدیر`,

  knowledge: `${BASE}

نقش تو: «مدیر دانش سازمانی».
از خروجی‌های این تسک، دانش قابل استفاده‌ی مجدد استخراج کن تا در آینده برای کارهای مشابه از صفر شروع نکنیم:
- snippet: قطعه‌کد/کوئری/اسکریپت قابل استفاده‌ی مجدد (همراه با کد کامل)
- workflow: فرایند یا ورکفلو قابل تکرار
- lesson: درس آموخته، نکته‌ی کلیدی، ترفند
- dead_end: رویکردی که جواب نداد و چرا
- prompt: پرامپت یا دستورالعملی که نتیجه‌ی خوب داد
- decision: تصمیم فنی و دلیلش
- reference: منبع/مستند مفید
- requester_profile: نکات نحوه‌ی کار با این تسک‌دهنده (سبک درخواست، انتظارات، ترجیحات، حساسیت‌ها)
هر مورد باید مستقل و بدون نیاز به کانتکست دیگر قابل فهم باشد. به هر مورد امتیاز ارزش استفاده‌ی مجدد ۱ تا ۵ بده.
حداکثر ۸ مورد با بیشترین ارزش؛ محتوای هر مورد حداکثر حدود ۴۰۰ کلمه (کد کامل ولی بدون حاشیه).
فقط JSON مطابق اسکیما برگردان.`,

  optimizer: `${BASE}

نقش تو: «مهندس پرامپت و بهبود مستمر».
پرامپت سیستمی فعلی یک ایجنت، بازخوردهای مدیر (مثبت/منفی) و نمونه‌ی خروجی‌ها را دریافت می‌کنی.
یک نسخه‌ی بهبودیافته از پرامپت پیشنهاد بده که مشکلات گزارش‌شده را برطرف کند و نقاط قوت را حفظ کند.
فقط JSON مطابق اسکیما برگردان.`,
};

const cache = new Map<string, { at: number; value: string }>();

export async function getAgentPrompt(agent: AgentKey): Promise<string> {
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
  const value = data?.content || DEFAULT_PROMPTS[agent];
  cache.set(agent, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------------
// JSON schemas for structured outputs
// ---------------------------------------------------------------------------

export const WBS_OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "یک پاراگراف خلاصه از ساختار کار" },
    phases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "شماره‌ی فاز مثل 1" },
          title: { type: "string" },
          goal: { type: "string" },
          deliverable: { type: "string" },
        },
        required: ["id", "title", "goal"],
      },
    },
  },
  required: ["phases"],
};

export const WBS_DETAIL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          complexity: { type: "string", enum: ["simple", "medium", "complex"] },
          type: { type: "string", enum: ["research", "design", "build", "config", "data", "test", "doc", "deploy", "coordination"] },
          deliverable: { type: "string" },
          estimate_hours: { type: "number" },
          depends_on: { type: "array", items: { type: "string" } },
        },
        required: ["id", "title", "description", "complexity", "type", "deliverable"],
      },
    },
  },
  required: ["items"],
};

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

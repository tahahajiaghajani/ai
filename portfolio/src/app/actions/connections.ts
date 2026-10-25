"use server";

import { updateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { decrypt, encrypt, hasSecret, hint } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ensureLabels, getFile, ghConfigured, GhError, putFile } from "@/lib/github";
import { complete, runtimeFor } from "@/lib/ai/runtime";
import { ProviderError, type ProviderErrorKind } from "@/lib/ai/gemini";
import { getBot, sendBot } from "@/lib/notify";
import { loadSettings, saveSettings, SETTINGS_FILE } from "@/lib/settings";
import { DEFAULT_SETTINGS, parseModels, type NotifyChannel } from "@/lib/settings-types";
import { KNOWLEDGE_FILE, serializeKnowledgeFile } from "@/lib/knowledge-file";
import { SITE_LABELS } from "@/lib/request-issue";

export type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

function failure(e: unknown): { ok: false; error: string } {
  if (e instanceof GhError) {
    if (e.status === 403 || e.status === 404) return { ok: false, error: `GitHub نوشتن را نپذیرفت (${e.status}). توکن باید روی همین مخزن دسترسی Contents و Issues را با Read and write داشته باشد.` };
    if (e.status === 401) return { ok: false, error: "توکن GitHub نامعتبر یا منقضی است." };
    return { ok: false, error: `GitHub: ${e.message}` };
  }
  if (e instanceof Error && e.message === "unauthorized") return { ok: false, error: "نشست شما تمام شده؛ دوباره وارد شوید." };
  console.error("[connections]", e);
  return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "خطای ناشناخته" };
}

function ready(): string | null {
  if (!ghConfigured()) return "اول GITHUB_TOKEN و GITHUB_REPO را در Vercel تنظیم و Redeploy کنید.";
  if (!hasSecret()) return "اول APP_SECRET را در Vercel تنظیم و Redeploy کنید (کلیدها با آن رمز می‌شوند).";
  return null;
}

/** One-time setup of the data repository: labels, settings.json, knowledge.md and a README. Safe to run again. */
export async function setupRepo(): Promise<Result<{ created: string[] }>> {
  try {
    await assertAdmin();
    const blocked = ready();
    if (blocked) return { ok: false, error: blocked };
    const created: string[] = [];
    await ensureLabels(SITE_LABELS);
    if (!(await loadSettings()).sha) {
      await putFile(SETTINGS_FILE, `${JSON.stringify({ ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() }, null, 2)}\n`, "Panel: create settings");
      created.push(SETTINGS_FILE);
    }
    if (!(await getFile(KNOWLEDGE_FILE))) {
      await putFile(KNOWLEDGE_FILE, serializeKnowledgeFile([]), "Panel: create knowledge file");
      created.push(KNOWLEDGE_FILE);
    }
    if (!(await getFile("README.md"))) {
      await putFile(
        "README.md",
        `# داده‌های سایت پورتفولیو\n\nاین مخزن **باید خصوصی بماند**. سایت (Vercel) فقط با یک توکن محدود به همین مخزن به آن دسترسی دارد.\n\n- **Issues با برچسب \`request\`**: درخواست‌های همکاری و دمو؛ هر پیام یک دیدگاه است. پاسخ به بازدیدکننده را از صندوق \`/admin\` سایت بفرستید؛ دیدگاه‌هایی که مستقیم اینجا می‌نویسید یادداشت خصوصی‌اند.\n- **Issue با برچسب \`assistant-unanswered\`**: پرسش‌هایی که دستیار سایت پاسخشان را نداشت.\n- **\`${SETTINGS_FILE}\`**: تنظیمات پنل «اتصالات»؛ کلیدها با APP_SECRET رمز شده‌اند. دستی ویرایش نکنید.\n- **\`${KNOWLEDGE_FILE}\`**: دانش اضافه‌ی دستیار؛ آزادانه ویرایش کنید.\n`,
        "Panel: add README",
      );
      created.push("README.md");
    }
    updateTag("settings");
    updateTag("knowledge");
    return { ok: true, data: { created }, message: created.length ? `ساخته شد: ${created.join("، ")} و برچسب‌ها` : "همه‌چیز از قبل آماده بود؛ برچسب‌ها بررسی شدند." };
  } catch (e) {
    return failure(e);
  }
}

export async function saveAi(input: { enabled: boolean; apiKey?: string; clearKey?: boolean; models: string }): Promise<Result> {
  try {
    await assertAdmin();
    const blocked = ready();
    if (blocked) return { ok: false, error: blocked };
    const key = (input.apiKey ?? "").trim();
    if (key && !/^[\w.-]{20,200}$/.test(key)) return { ok: false, error: "کلید API شکل درستی ندارد (کلیدهای Google AI Studio معمولاً با AIza شروع می‌شوند)." };
    await saveSettings((s) => ({
      ...s,
      ai: {
        enabled: input.enabled,
        keyEnc: input.clearKey ? "" : key ? encrypt(key) : s.ai.keyEnc,
        keyHint: input.clearKey ? "" : key ? hint(key) : s.ai.keyHint,
        models: parseModels(input.models),
      },
    }));
    updateTag("settings");
    return { ok: true, message: "ذخیره شد." };
  } catch (e) {
    return failure(e);
  }
}

const AI_ERROR: Record<ProviderErrorKind, string> = {
  auth: "کلید پذیرفته نشد: نامعتبر است، غیرفعال شده یا Google آن را لو رفته شناخته است. در Google AI Studio کلید تازه بسازید.",
  region: "Google درخواست را از منطقه‌ی این سرور نپذیرفت. در Vercel → Settings → Functions، منطقه را روی یک منطقه‌ی آمریکا یا اروپا بگذارید.",
  quota: "سهمیه‌ی روزانه‌ی رایگان این مدل‌ها تمام شده؛ فردا دوباره امتحان کنید یا مدل دیگری اضافه کنید.",
  rate: "تعداد درخواست در دقیقه زیاد بود؛ چند ثانیه بعد دوباره امتحان کنید.",
  overloaded: "مدل الان شلوغ است؛ کمی بعد دوباره امتحان کنید.",
  timeout: "مدل در زمان مقرر پاسخ نداد.",
  network: "اتصال به Google برقرار نشد.",
  model: "هیچ‌کدام از مدل‌ها در دسترس این کلید نیست؛ نام مدل‌ها را بررسی کنید.",
  invalid: "درخواست آزمایشی نامعتبر شمرده شد.",
  blocked: "پاسخ به‌دلیل سیاست‌های ایمنی متوقف شد.",
  other: "خطای ناشناخته از سرویس هوش مصنوعی.",
};

export interface AiTest {
  model: string;
  ms: number;
  reply: string;
  source: "form" | "panel" | "env";
}

/** A tiny real call with the key in the form, else the saved key, else GEMINI_API_KEY. */
export async function testAi(input: { apiKey?: string; models: string }): Promise<Result<AiTest>> {
  try {
    await assertAdmin();
    let source: AiTest["source"] = "form";
    let key = (input.apiKey ?? "").trim();
    if (!key && ghConfigured()) {
      key = decrypt((await loadSettings().catch(() => ({ settings: DEFAULT_SETTINGS }))).settings.ai.keyEnc);
      source = "panel";
    }
    if (!key) {
      key = env.geminiKey;
      source = "env";
    }
    if (!key) return { ok: false, error: "کلیدی برای آزمایش نیست: کلید را در کادر وارد کنید." };
    const start = Date.now();
    const { text, model } = await complete(runtimeFor(key, parseModels(input.models)), "You are a connection test. Reply with the single word: OK", [{ role: "user", content: "ping" }], {
      maxTokens: 16,
      temperature: 0,
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: true, data: { model, ms: Date.now() - start, reply: text.trim().slice(0, 40), source } };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, error: `${AI_ERROR[e.kind]}${e.model ? ` (${e.model})` : ""}` };
    return failure(e);
  }
}

export async function saveNotify(input: { channel: NotifyChannel; token?: string; clearToken?: boolean; chatId: string }): Promise<Result> {
  try {
    await assertAdmin();
    const blocked = ready();
    if (blocked) return { ok: false, error: blocked };
    const token = (input.token ?? "").trim();
    if (token && !/^\d{4,15}:[\w-]{20,80}$/.test(token)) return { ok: false, error: "توکن ربات شکل درستی ندارد (مثل 123456789:AA…)." };
    const chatId = input.chatId.trim();
    if (chatId && !/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,}$/.test(chatId)) return { ok: false, error: "شناسه‌ی گفتگو باید عدد باشد (مثلاً 123456789) یا @نام‌کانال." };
    const channel = input.channel === "bale" || input.channel === "none" ? input.channel : "telegram";
    await saveSettings((s) => ({
      ...s,
      notify: {
        channel,
        tokenEnc: input.clearToken ? "" : token ? encrypt(token) : s.notify.tokenEnc,
        tokenHint: input.clearToken ? "" : token ? hint(token) : s.notify.tokenHint,
        chatId,
      },
    }));
    updateTag("settings");
    return { ok: true, message: "ذخیره شد." };
  } catch (e) {
    return failure(e);
  }
}

export async function testNotify(): Promise<Result> {
  try {
    await assertAdmin();
    const bot = await getBot();
    if (!bot) return { ok: false, error: "رباتی تنظیم نشده یا اعلان خاموش است." };
    const r = await sendBot(bot, `✅ پیام آزمایشی از پنل سایت پورتفولیو\n${env.siteUrl}`);
    return r.ok ? { ok: true, message: "پیام آزمایشی فرستاده شد." } : { ok: false, error: `ارسال نشد: ${r.error}` };
  } catch (e) {
    return failure(e);
  }
}

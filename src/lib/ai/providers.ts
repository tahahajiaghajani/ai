/**
 * AI providers a user can connect (shared by the settings UI and the server).
 * Three wire protocols cover all of them: Google Gemini, Anthropic Messages and the
 * OpenAI-compatible Chat Completions API (OpenAI, Kimi, NVIDIA, OpenRouter, …).
 */

export type ProviderProtocol = "google" | "anthropic" | "openai";
export type ProviderId = "anthropic" | "google" | "openai" | "moonshot" | "nvidia" | "openrouter" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  protocol: ProviderProtocol;
  /** default API base (custom: entered by the user) */
  baseUrl?: string;
  /** where the user creates a key */
  keyUrl: string;
  keyHint: string;
  /** short Persian note shown in the connect form */
  note: string;
  /** model names are matched against these patterns (in order) to suggest a default */
  prefer: RegExp[];
  /** suggested models when the model list cannot be read */
  suggested: string[];
  /** accepts images / PDFs directly (otherwise PDF text is extracted and images are described) */
  media: { images: boolean; pdf: boolean };
  free?: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    note: "بهترین کیفیت برای کدنویسی و ویرایش فایل‌ها. کلید API از کنسول Anthropic (پرداخت به ازای مصرف).",
    prefer: [/^claude-opus-5-5$/, /^claude-opus/, /^claude-sonnet/],
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
    media: { images: true, pdf: true },
  },
  {
    id: "google",
    label: "Google AI Studio (Gemini)",
    protocol: "google",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza…",
    note: "پلن رایگان دارد. «auto» یعنی همیشه جدیدترین مدل‌های Flash رایگان (با جایگزینی خودکار هنگام رسیدن به سقف روزانه).",
    prefer: [/^auto$/],
    suggested: ["auto", "auto-lite", "gemini-flash-latest", "gemini-pro-latest"],
    media: { images: true, pdf: true },
    free: true,
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
    note: "کلید API از platform.openai.com (اشتراک ChatGPT Plus کلید API نمی‌دهد).",
    prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/],
    suggested: [],
    media: { images: true, pdf: true },
  },
  {
    id: "moonshot",
    label: "Kimi (Moonshot AI)",
    protocol: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    keyHint: "sk-…",
    note: "مدل‌های Kimi با پنجره‌ی متن بلند؛ سازگار با OpenAI.",
    prefer: [/^kimi-k\d+(\.\d+)?$/, /^kimi-k/, /^kimi/],
    suggested: [],
    media: { images: false, pdf: false },
  },
  {
    id: "nvidia",
    label: "NVIDIA (مدل‌های رایگان build.nvidia.com)",
    protocol: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    keyHint: "nvapi-…",
    note: "ده‌ها مدل متن‌باز رایگان (حدود ۴۰ درخواست در دقیقه). مدلی را انتخاب کنید که از ابزار (tool calling) پشتیبانی کند.",
    prefer: [/kimi-k2/i, /qwen3.*coder/i, /deepseek-v3/i, /llama-3\.3-70b/i],
    suggested: [],
    media: { images: false, pdf: false },
    free: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
    note: "یک کلید برای صدها مدل (از جمله مدل‌های رایگان با پسوند :free).",
    prefer: [/:free$/],
    suggested: [],
    media: { images: true, pdf: false },
  },
  {
    id: "custom",
    label: "سرویس دیگر سازگار با OpenAI",
    protocol: "openai",
    keyUrl: "",
    keyHint: "API key",
    note: "هر سرویسی با API سازگار با OpenAI (مثلاً یک سرور شخصی یا ارائه‌دهنده‌ی دیگر). آدرس پایه را کامل وارد کنید (معمولاً به ‎/v1 ختم می‌شود).",
    prefer: [],
    suggested: [],
    media: { images: false, pdf: false },
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderPreset>;

export function providerPreset(id: string): ProviderPreset {
  return PROVIDER_BY_ID[id as ProviderId] ?? PROVIDER_BY_ID.custom;
}

/** Suggested default model from a provider's model list. */
export function suggestModel(provider: string, models: string[]): string {
  const p = providerPreset(provider);
  for (const re of p.prefer) {
    const hit = [...models].sort((a, b) => b.localeCompare(a, "en", { numeric: true })).find((m) => re.test(m));
    if (hit) return hit;
  }
  return p.suggested[0] ?? models[0] ?? "";
}

/** The two work stages that each pick a connection and a model. */
export type StageKey = "prework" | "main";

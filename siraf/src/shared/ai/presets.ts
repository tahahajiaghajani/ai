// AI provider presets: what the connection form offers. Client-safe (the settings page imports it).
// Models listed here are suggestions only — the real list is read from the provider when a key is
// tested, and the business decides; nothing here ever replaces a model the business chose.
import type { AiProtocol } from "./types";

export type AiRuntime = "web" | "desktop";
/** where the service runs: drives the data-leaves-the-country notice */
export type AiRegion = "foreign" | "iran" | "local" | "any";

export interface AiPreset {
  id: string;
  /** Persian label of the provider */
  label: string;
  protocol: AiProtocol;
  /** protocols the business may pick instead (custom services) */
  protocols?: AiProtocol[];
  /** default base URL; null = typed by the business */
  base_url: string | null;
  base_url_required: boolean;
  /** other hosts of the same service tried by «آزمایش اتصال» when the default cannot be reached */
  base_url_candidates?: string[];
  key_required: boolean;
  /** page where the key is created */
  key_url: string | null;
  /** what a key looks like, e.g. "sk-ant-…" */
  key_hint: string | null;
  runtimes: AiRuntime[];
  region: AiRegion;
  /** one or two Persian sentences: what it is good for, access from Iran, where the data goes */
  note: string;
  /** suggested models per job tier, default first */
  models: { smart: string[]; fast: string[]; vision: string[] };
  /** other known model ids worth offering in the picker */
  suggested: string[];
  /** reads images / PDF files natively */
  media: { images: boolean; pdf: boolean };
  /** send max_tokens to this service (local servers pick their own limit) */
  send_max_tokens?: boolean;
  /** accepts `reasoning_effort` on chat completions */
  chat_effort?: boolean;
  badge?: string;
  /** only offered when the server runs with SIRAF_AI_FAKE=1 (tests and screenshots) */
  test_only?: boolean;
}

const NOTE_FOREIGN_DATA = "داده‌های هر پرسش برای پاسخ به خارج از کشور فرستاده می‌شود.";
const NOTE_NO_IRAN = "این سرویس ایران را پشتیبانی نمی‌کند: نسخهٔ وب از سرورهای خارج از ایران وصل می‌شود و نسخهٔ ویندوز از راه اتصال‌های نسخهٔ وب.";
const NOTE_GATEWAY = "درگاه ایرانی با پرداخت ریالی که مدل‌های خارجی را واسطه می‌کند؛ درگاه همهٔ پرسش‌ها و پاسخ‌ها را می‌بیند. از ایران در دسترس است و ممکن است از سرورهای خارج از ایران در دسترس نباشد.";
const NOTE_LOCAL = "مدل روی همین رایانه اجرا می‌شود؛ داده از رایانه بیرون نمی‌رود و اینترنت لازم نیست. فقط در نسخهٔ ویندوز.";

export const AI_PRESETS: AiPreset[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    protocol: "anthropic",
    base_url: "https://api.anthropic.com",
    base_url_required: false,
    key_required: true,
    key_url: "https://platform.claude.com/settings/keys",
    key_hint: "sk-ant-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `کیفیت بالا در نوشتن فارسی، تحلیل و کار با ابزارها. ${NOTE_NO_IRAN} ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["claude-opus-5-5"], fast: ["claude-haiku-5-5"], vision: ["claude-opus-5-5"] },
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    media: { images: true, pdf: true },
    badge: "پیشنهادی",
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    protocol: "openai-responses",
    base_url: "https://api.openai.com/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://platform.openai.com/api-keys",
    key_hint: "sk-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `مدل‌های GPT از راه Responses API (لازم برای ابزارها و استدلال). ${NOTE_NO_IRAN} ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["gpt-6.1-sol"], fast: ["gpt-6-luna"], vision: ["gpt-6.1-terra"] },
    suggested: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"],
    media: { images: true, pdf: true },
  },
  {
    id: "google",
    label: "Gemini (Google AI Studio)",
    protocol: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    base_url_required: false,
    key_required: true,
    key_url: "https://aistudio.google.com/apikey",
    key_hint: "AIza… یا AQ.…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `مدل‌های سریع و ارزان با خواندن خوب تصویر و PDF. با کلید رایگان AI Studio مدل‌های Flash و Flash-Lite رایگان‌اند و هر مدل سقف روزانهٔ خودش را دارد؛ gemini-4-argon فقط با پرداخت. ${NOTE_NO_IRAN} در طرح رایگان، Google از داده‌ها برای بهبود محصولاتش استفاده می‌کند. ${NOTE_FOREIGN_DATA}`,
    // free-tier models first, each with its own daily quota: when one runs out the next one answers
    models: {
      smart: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"],
      fast: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
      vision: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
    },
    suggested: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemma-4-31b-it", "gemma-4-26b-a4b-it", "gemini-4-argon"],
    media: { images: true, pdf: true },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-chat",
    base_url: "https://openrouter.ai/api/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://openrouter.ai/keys",
    key_hint: "sk-or-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `یک کلید برای صدها مدل از سازندگان مختلف؛ هزینهٔ هر پاسخ را خودش گزارش می‌کند. شرکتی آمریکایی است و از ایران در دسترس نیست. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["anthropic/claude-opus-5.5"], fast: ["google/gemini-3.5-flash-lite"], vision: ["google/gemini-3.8-flash"] },
    suggested: ["anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash", "deepseek/deepseek-v4.1-flash", "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"],
    media: { images: true, pdf: false },
    chat_effort: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-chat",
    base_url: "https://api.deepseek.com",
    base_url_required: false,
    key_required: true,
    key_url: "https://platform.deepseek.com/api_keys",
    key_hint: "sk-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `ارزان و توانا در استدلال. داده‌ها در چین پردازش می‌شوند. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["deepseek-v4-pro"], fast: ["deepseek-flash"], vision: ["deepseek-flash"] },
    suggested: ["deepseek-v4-pro", "deepseek-flash"],
    media: { images: true, pdf: false },
  },
  {
    id: "qwen",
    label: "Qwen (Alibaba Cloud)",
    protocol: "openai-chat",
    base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://www.alibabacloud.com/help/en/model-studio/get-api-key",
    key_hint: "sk-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `مدل‌های Qwen علی‌بابا؛ کلید باید در همان منطقه‌ای ساخته شود که نشانی سرویس به آن اشاره می‌کند. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["qwen3.8-max"], fast: ["qwen3.8-flash"], vision: ["qwen3.7-plus"] },
    suggested: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
    media: { images: true, pdf: false },
  },
  {
    id: "moonshot",
    label: "Kimi (Moonshot AI)",
    protocol: "openai-chat",
    base_url: "https://api.moonshot.ai/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://platform.kimi.ai/console/api-keys",
    key_hint: "sk-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `مدل‌های Kimi با پنجرهٔ متن بلند و خواندن تصویر. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["kimi-k3.1-pro"], fast: ["kimi-k3.1-pro-highspeed"], vision: ["kimi-k3.1-pro"] },
    suggested: ["kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3"],
    media: { images: true, pdf: false },
  },
  {
    id: "xai",
    label: "Grok (xAI)",
    protocol: "openai-responses",
    base_url: "https://api.x.ai/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://console.x.ai",
    key_hint: "xai-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `مدل‌های Grok از راه Responses API. شرکتی آمریکایی است و از ایران در دسترس نیست. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["grok-4.7"], fast: ["grok-4.3"], vision: ["grok-4.7"] },
    suggested: ["grok-4.7", "grok-4.6", "grok-4.3"],
    media: { images: true, pdf: false },
  },
  {
    id: "mistral",
    label: "Mistral AI",
    protocol: "openai-chat",
    base_url: "https://api.mistral.ai/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://console.mistral.ai/api-keys",
    key_hint: null,
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `مدل‌های اروپایی Mistral. ${NOTE_FOREIGN_DATA}`,
    // Small is the model of the free mode; Large is a preview model the training opt-out does not cover
    models: { smart: ["mistral-small-latest"], fast: ["mistral-small-latest"], vision: ["mistral-small-latest"] },
    suggested: ["mistral-small-latest", "mistral-large-latest"],
    media: { images: true, pdf: false },
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai-chat",
    base_url: "https://api.groq.com/openai/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://console.groq.com/keys",
    key_hint: "gsk_…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `پاسخ بسیار سریع با مدل‌های متن‌باز. طرح رایگانش هشت هزار توکن در دقیقه می‌پذیرد و فقط برای «کارهای سریع» کافی است، نه دستیار. شرکتی آمریکایی است و از ایران در دسترس نیست. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["openai/gpt-oss-120b"], fast: ["openai/gpt-oss-20b"], vision: [] },
    suggested: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    media: { images: false, pdf: false },
    chat_effort: true,
  },
  {
    id: "nvidia",
    label: "NVIDIA build",
    protocol: "openai-chat",
    base_url: "https://integrate.api.nvidia.com/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://build.nvidia.com/settings/api-keys",
    key_hint: "nvapi-…",
    runtimes: ["web", "desktop"],
    region: "foreign",
    note: `دسترسی آزمایشی رایگان به مدل‌های متن‌باز با سقف تعداد درخواست در دقیقه. شرکتی آمریکایی است و از ایران در دسترس نیست. ${NOTE_FOREIGN_DATA}`,
    models: { smart: ["mistralai/mistral-large-4-1t-a52b"], fast: ["deepseek-ai/deepseek-v4.1-flash"], vision: ["nvidia/nemotron-3.5-super-vl-120b-a12b"] },
    suggested: ["mistralai/mistral-large-4-1t-a52b", "moonshotai/kimi-k2.6", "deepseek-ai/deepseek-v4.1-flash", "google/gemma-4-31b-it"],
    media: { images: false, pdf: false },
    badge: "آزمایش رایگان",
  },
  {
    id: "metis",
    label: "متیس (MetisAI)",
    protocol: "openai-chat",
    base_url: "https://api.metisai.ir/openai/v1",
    base_url_required: false,
    base_url_candidates: [
      "https://api.metisai.ir/openai/v1",
      "https://api.tapsage.com/openai/v1",
      "https://api.metisai.ir/api/v1/wrapper/openai_chat_completion",
      "https://api.tapsage.com/api/v1/wrapper/openai_chat_completion",
    ],
    key_required: true,
    key_url: "https://console.metisai.ir",
    key_hint: "tpsg-…",
    runtimes: ["web", "desktop"],
    region: "iran",
    note: `${NOTE_GATEWAY} نشانی بین‌المللی آن (api.tapsage.com) از نسخهٔ وب هم در دسترس است.`,
    models: { smart: ["claude-sonnet-5-5"], fast: ["gemini-3.5-flash-lite"], vision: ["gemini-3.8-flash"] },
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gemini-3.8-flash", "gemini-3.5-flash-lite", "deepseek-flash"],
    media: { images: true, pdf: false },
    badge: "ایرانی",
  },
  {
    id: "avalai",
    label: "اول‌ای‌آی (AvalAI)",
    protocol: "openai-chat",
    base_url: "https://api.avalai.ir/v1",
    base_url_required: false,
    base_url_candidates: ["https://api.avalai.ir/v1", "https://api.avalapis.ir/v1"],
    key_required: true,
    key_url: "https://avalai.ir",
    key_hint: "aa-…",
    runtimes: ["web", "desktop"],
    region: "iran",
    note: NOTE_GATEWAY,
    models: { smart: ["claude-sonnet-5-5"], fast: ["gemini-3.5-flash-lite"], vision: ["gemini-3.8-flash"] },
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gemini-3.8-flash", "gemini-3.5-flash-lite"],
    media: { images: true, pdf: false },
    badge: "ایرانی",
  },
  {
    id: "gapgpt",
    label: "گپ‌جی‌پی‌تی (GapGPT)",
    protocol: "openai-chat",
    base_url: "https://api.gapgpt.app/v1",
    base_url_required: false,
    key_required: true,
    key_url: "https://gapgpt.app",
    key_hint: "sk-…",
    runtimes: ["web", "desktop"],
    region: "iran",
    note: NOTE_GATEWAY,
    models: { smart: ["claude-sonnet-5-5"], fast: ["gemini-3.5-flash-lite"], vision: ["gemini-3.8-flash"] },
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gemini-3.8-flash"],
    media: { images: true, pdf: false },
    badge: "ایرانی",
  },
  {
    id: "iran-gateway",
    label: "درگاه داخلی دیگر سازگار با OpenAI",
    protocol: "openai-chat",
    base_url: null,
    base_url_required: true,
    key_required: true,
    key_url: null,
    key_hint: null,
    runtimes: ["web", "desktop"],
    region: "iran",
    note: `${NOTE_GATEWAY} نشانی سرویس را از راهنمای همان درگاه بردارید (معمولاً به ‎/v1 ختم می‌شود).`,
    models: { smart: [], fast: [], vision: [] },
    suggested: [],
    media: { images: true, pdf: false },
  },
  {
    id: "ollama",
    label: "Ollama — مدل محلی",
    protocol: "openai-chat",
    base_url: "http://127.0.0.1:11434/v1",
    base_url_required: false,
    key_required: false,
    key_url: "https://ollama.com/download",
    key_hint: null,
    runtimes: ["desktop"],
    region: "local",
    note: `${NOTE_LOCAL} مدل‌ها را پیش‌تر با ollama pull دریافت کنید؛ Qwen و Gemma در فارسی بهترند. طول متن Ollama را به ۳۲ هزار توکن برسانید (راهنمای اتصال‌ها).`,
    models: { smart: ["qwen3.5:9b"], fast: ["qwen3.5:4b"], vision: ["gemma4:e4b"] },
    suggested: ["qwen3.5:4b", "qwen3.5:9b", "gemma4:e4b", "gemma4:12b", "gemma4:26b", "qwen3.8:27b", "gemma4:31b"],
    media: { images: true, pdf: false },
    send_max_tokens: false,
    chat_effort: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio — مدل محلی",
    protocol: "openai-chat",
    base_url: "http://127.0.0.1:1234/v1",
    base_url_required: false,
    key_required: false,
    key_url: "https://lmstudio.ai",
    key_hint: null,
    runtimes: ["desktop"],
    region: "local",
    note: `${NOTE_LOCAL} سرور محلی LM Studio را روشن کنید و مدل را بارگذاری کنید.`,
    models: { smart: [], fast: [], vision: [] },
    suggested: [],
    media: { images: true, pdf: false },
    send_max_tokens: false,
  },
  {
    id: "llamacpp",
    label: "llama.cpp — سرور محلی",
    protocol: "openai-chat",
    base_url: "http://127.0.0.1:9931/v1",
    base_url_required: false,
    key_required: false,
    key_url: "https://github.com/ggml-org/llama.cpp",
    key_hint: null,
    runtimes: ["desktop"],
    region: "local",
    note: `${NOTE_LOCAL} اگر llama-server را با ‎--api-key اجرا کرده‌اید، همان کلید را وارد کنید.`,
    models: { smart: [], fast: [], vision: [] },
    suggested: [],
    media: { images: true, pdf: false },
    send_max_tokens: false,
  },
  {
    id: "custom-openai",
    label: "سرویس دیگر سازگار با OpenAI",
    protocol: "openai-chat",
    protocols: ["openai-chat", "openai-responses"],
    base_url: null,
    base_url_required: true,
    key_required: false,
    key_url: null,
    key_hint: null,
    runtimes: ["web", "desktop"],
    region: "any",
    note: "هر سرویسی که Chat Completions یا Responses سازگار با OpenAI دارد (vLLM، Together، Fireworks و مانند آن‌ها). داده به همان نشانی‌ای می‌رود که وارد می‌کنید.",
    models: { smart: [], fast: [], vision: [] },
    suggested: [],
    media: { images: true, pdf: false },
  },
  {
    id: "custom-anthropic",
    label: "سرویس دیگر سازگار با Anthropic",
    protocol: "anthropic",
    base_url: null,
    base_url_required: true,
    key_required: false,
    key_url: null,
    key_hint: null,
    runtimes: ["web", "desktop"],
    region: "any",
    note: "هر درگاهی که API پیام‌های Anthropic را پیاده کرده است (مانند DeepSeek یا درگاه‌های واسط Claude). داده به همان نشانی‌ای می‌رود که وارد می‌کنید.",
    models: { smart: [], fast: [], vision: [] },
    suggested: [],
    media: { images: true, pdf: true },
  },
  {
    id: "fake",
    label: "پاسخ‌گوی آزمایشی",
    protocol: "openai-chat",
    base_url: null,
    base_url_required: false,
    key_required: false,
    key_url: null,
    key_hint: null,
    runtimes: ["web", "desktop"],
    region: "local",
    note: "پاسخ‌های ساختگی و تکرارپذیر برای آزمون‌ها و تصویربرداری؛ به هیچ سرویسی وصل نمی‌شود.",
    models: { smart: ["fake-smart"], fast: ["fake-fast"], vision: ["fake-vision"] },
    suggested: ["fake-smart", "fake-fast", "fake-vision"],
    media: { images: true, pdf: true },
    test_only: true,
  },
];

const BY_ID = new Map(AI_PRESETS.map((p) => [p.id, p]));

export function presetById(id: string | null | undefined): AiPreset | null {
  return (id && BY_ID.get(id)) || null;
}

/** Presets a business may pick on this runtime (and under the platform policy). */
export function presetsFor(opts: { desktop: boolean; fake: boolean; allowedPresets?: string[] | null; allowedProtocols?: AiProtocol[] | null }): AiPreset[] {
  return AI_PRESETS.filter(
    (p) =>
      (!p.test_only || opts.fake) &&
      p.runtimes.includes(opts.desktop ? "desktop" : "web") &&
      (!opts.allowedPresets || opts.allowedPresets.includes(p.id) || p.test_only) &&
      (!opts.allowedProtocols || opts.allowedProtocols.includes(p.protocol) || p.test_only),
  );
}

/** Model ids for the picker: what the provider listed first, then the preset's suggestions. */
export function modelOptions(preset: AiPreset | null, available: string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of available ?? []) out.add(m);
  for (const m of preset?.suggested ?? []) out.add(m);
  for (const tier of ["smart", "fast", "vision"] as const) for (const m of preset?.models[tier] ?? []) out.add(m);
  return [...out];
}

/** A model id the business may type (provider ids contain letters, digits and . : / @ - _ [ ]). */
export const MODEL_ID_RE = /^[\w.:/@[\]+-]{1,160}$/;

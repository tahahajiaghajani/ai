/**
 * Site settings stored in `pars_settings` (key → jsonb). Client-safe: no secrets here —
 * encrypted keys stay on the server and only a hint (last characters) is exposed.
 */

export type ProviderId = "google" | "anthropic" | "openai";

export interface AiSettings {
  enabled: boolean;
  provider: ProviderId;
  model: string;
  /** tried in order when the main model is out of quota or busy */
  fallbackModels: string[];
  /** optional API base (relay / Iranian gateway / OpenAI-compatible service) */
  baseUrl: string;
  /** encrypted with APP_SECRET (server only) */
  apiKeyEnc?: string;
  apiKeyHint?: string;
  temperature: number;
  maxTokens: number;
  /** extra instructions from the admin (tone, emphasis, things to avoid) */
  instructions: string;
}

export interface ChatSettings {
  greetingFa: string;
  greetingEn: string;
  suggestionsFa: string[];
  suggestionsEn: string[];
  /** messages per visitor per 10 minutes */
  perTenMinutes: number;
  /** messages per visitor per day */
  perDay: number;
  logChats: boolean;
}

export interface Stat {
  value: string;
  labelFa: string;
  labelEn: string;
}

export interface SiteContent {
  ceo: {
    nameFa: string;
    nameEn: string;
    titleFa: string;
    titleEn: string;
    quoteFa: string;
    quoteEn: string;
    bioFa: string;
    bioEn: string;
  };
  contact: {
    phones: string[];
    email: string;
    addressFa: string;
    addressEn: string;
    mapUrl: string;
    hoursFa: string;
    hoursEn: string;
  };
  social: { linkedin: string; telegram: string; instagram: string; bale: string; aparat: string };
  stats: Stat[];
}

export interface NotifySettings {
  channel: "none" | "telegram" | "bale";
  botTokenEnc?: string;
  botTokenHint?: string;
  chatId: string;
  /** customers get an e-mail when the team replies (needs RESEND_API_KEY + MAIL_FROM) */
  emailCustomers: boolean;
}

export interface SupportSettings {
  /** AI suggests an answer from the knowledge base before a ticket is submitted */
  deflection: boolean;
  /** AI triage: category, priority, sentiment, summary and a draft reply for the team */
  triage: boolean;
}

export interface Settings {
  ai: AiSettings;
  chat: ChatSettings;
  site: SiteContent;
  notify: NotifySettings;
  support: SupportSettings;
}

export type SettingsKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    enabled: true,
    provider: "google",
    model: "gemini-flash-latest",
    fallbackModels: ["gemini-flash-lite-latest", "gemini-2.5-flash-lite"],
    baseUrl: "",
    temperature: 0.3,
    maxTokens: 1200,
    instructions: "",
  },
  chat: {
    greetingFa: "سلام! من دستیار هوشمند پارس هستم. درباره‌ی خدمات، محصولات، پروژه‌ها و راهکارهای هوش مصنوعی پارس هر سؤالی دارید بپرسید.",
    greetingEn: "Hi! I'm Pars AI. Ask me anything about Pars Project Management — services, products, projects and AI solutions.",
    suggestionsFa: [
      "پارس دقیقاً چه کاری انجام می‌دهد؟",
      "ایجنت‌های هوش مصنوعی شما چطور کار را تا ۹۰٪ خودکار می‌کنند؟",
      "تجربه‌ی شما با سامانه‌های EPM بانک‌ها چیست؟",
      "پشتیبانی Project Server 2016 تمام شده؛ چه کنم؟",
      "دوره‌های آموزشی مدیریت پروژه دارید؟",
    ],
    suggestionsEn: [
      "What exactly does Pars do?",
      "How do your AI agents automate up to 90% of the work?",
      "What's your experience with bank EPM systems?",
      "Project Server 2016 support has ended — what now?",
      "Do you offer project management training?",
    ],
    perTenMinutes: 20,
    perDay: 120,
    logChats: true,
  },
  site: {
    ceo: {
      nameFa: "امیر محمودی",
      nameEn: "Amir Mahmoudi",
      titleFa: "مدیرعامل",
      titleEn: "Chief Executive Officer",
      quoteFa:
        "بیش از ۱۵ سال کنار تیم‌های پروژه‌ی بانک‌ها و سازمان‌های بزرگ بوده‌ایم و دیده‌ایم چقدر از وقتشان صرف گزارش‌های تکراری می‌شود. جایی که این تجربه به هوش مصنوعی می‌رسد، ایجنت‌ها بیشتر این بار سنگین را به دوش می‌گیرند و آدم‌ها به کار اصلی‌شان برمی‌گردند: تصمیم و قضاوت. فناوری کار را پیش می‌برد؛ حرف آخر را انسان می‌زند.",
      quoteEn:
        "For over fifteen years we've worked alongside project teams in banks and large organizations, watching their best hours disappear into repetitive reports. Where that experience meets AI, agents carry most of the load and people return to their real work: decisions and judgment. Technology moves the work forward; people make the final call.",
      bioFa:
        "امیر محمودی شرکت مدیریت پروژه پارس را هدایت می‌کند. این شرکت بیش از ۱۵ سال تجربه‌ی طراحی، استقرار و آموزش سامانه‌های EPM برای بانک‌ها و سازمان‌های بزرگ دارد و امروز ایجنت‌های هوش مصنوعی می‌سازد.",
      bioEn:
        "Amir Mahmoudi leads Pars Project Management, which has over 15 years of experience designing, deploying and teaching EPM systems for banks and large organizations, and now builds AI agents.",
    },
    contact: {
      phones: ["021-88731601", "021-82803565"],
      email: "info@parspmi.ir",
      addressFa: "تهران، خیابان سهروردی شمالی",
      addressEn: "North Sohrevardi St., Tehran, Iran",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=North+Sohrevardi+Street+Tehran",
      hoursFa: "شنبه تا چهارشنبه، ۸ تا ۱۷",
      hoursEn: "Sat–Wed, 8:00–17:00 (Tehran)",
    },
    social: { linkedin: "", telegram: "", instagram: "", bale: "", aparat: "" },
    stats: [
      { value: "15+", labelFa: "سال تجربه در سامانه‌های سازمانی", labelEn: "years of enterprise systems" },
      { value: "90%", labelFa: "اتوماسیون کارهای تکراری با ایجنت‌ها", labelEn: "of repetitive work automated by agents" },
      { value: "24/7", labelFa: "دستیار هوشمند و پشتیبانی آنلاین", labelEn: "AI assistant and online support" },
      { value: "0", labelFa: "خطا؛ خط‌مشی ما در دقت", labelEn: "errors — our standard for accuracy" },
    ],
  },
  notify: { channel: "none", chatId: "", emailCustomers: true },
  support: { deflection: true, triage: true },
};

export const PROVIDERS: { id: ProviderId; label: string; keyUrl: string; hint: string; models: string[]; note: string }[] = [
  {
    id: "google",
    label: "Google AI Studio (Gemini)",
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "AIza…",
    models: ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    note: "پلن رایگان دارد. اگر سهمیه‌ی مدل اصلی تمام شود، مدل‌های جایگزین به‌ترتیب امتحان می‌شوند.",
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    hint: "sk-ant-…",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-haiku-4-5"],
    note: "کیفیت بسیار بالا در فارسی و پیروی دقیق از دانش؛ پرداخت به ازای مصرف.",
  },
  {
    id: "openai",
    label: "OpenAI / سرویس سازگار با OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "sk-…",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1-mini"],
    note: "برای OpenAI، OpenRouter یا درگاه‌های داخلی سازگار با OpenAI؛ آدرس پایه را (معمولاً با ‎/v1) وارد کنید.",
  },
];

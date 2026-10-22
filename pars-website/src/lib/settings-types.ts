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
    /** floating badge on the portrait, e.g. "20+" (empty hides it) */
    years: string;
    /** short credential chips under the name */
    highlightsFa: string[];
    highlightsEn: string[];
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

/** Customer e-mail through Resend; the panel value wins over RESEND_API_KEY / MAIL_FROM. */
export interface EmailSettings {
  mailFrom: string;
  resendKeyEnc?: string;
  resendKeyHint?: string;
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
  email: EmailSettings;
  support: SupportSettings;
}

export type SettingsKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    enabled: true,
    provider: "google",
    model: "gemini-3.5-flash-lite",
    fallbackModels: ["gemini-3.6-flash", "gemini-3.1-flash-lite"],
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
      "پارس برای کدام بانک‌ها و سازمان‌ها سامانه ساخته است؟",
      "سامانه‌ی EPM ما قدیمی شده؛ مسیر نوسازی چیست؟",
      "«سایمپ» و «سماپ» چه سامانه‌هایی هستند؟",
      "دوره‌های آموزشی مدیریت پروژه دارید؟",
    ],
    suggestionsEn: [
      "What exactly does Pars do?",
      "How do your AI agents automate up to 90% of the work?",
      "Which banks and organizations run Pars systems?",
      "Our EPM system is aging — how do we modernize it?",
      "What are «Saymp» and «Samap»?",
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
        "امیر محمودی ۲۰ سال است به‌عنوان مشاور و مدیر پروژه، راهکارهای مدیریتی را در سازمان‌ها راه‌اندازی می‌کند؛ به‌ویژه مدیریت پروژه، ارزیابی عملکرد و BI. کارشناسی و کارشناسی ارشد مهندسی صنایع را در دانشگاه علم و صنعت ایران و دانشگاه صنعتی شریف گذرانده، مدارک PMP (از PMI) و PSM (از Scrum.org) را دارد، سه کتاب در استانداردها و نرم‌افزارهای مدیریت پروژه نوشته و در بیش از ۲۵۰ دوره‌ی آموزشی مدیریت پروژه تدریس کرده است.",
      bioEn:
        "For 20 years Amir Mahmoudi has set up management solutions in organizations as a consultant and project manager — especially project management, performance evaluation and BI. He studied industrial engineering at Iran University of Science and Technology (BSc) and Sharif University of Technology (MSc), is PMP (PMI) and PSM (Scrum.org) certified, has written three books on project management standards and software, and has taught more than 250 project management courses.",
      years: "20+",
      highlightsFa: ["PMP", "PSM", "کارشناسی ارشد، دانشگاه شریف", "۳ کتاب مدیریت پروژه", "۲۵۰+ دوره‌ی آموزشی"],
      highlightsEn: ["PMP", "PSM", "MSc, Sharif University", "3 books on project management", "250+ courses taught"],
    },
    contact: {
      phones: ["021-88731601", "021-82803565"],
      email: "info@parspmi.ir",
      addressFa: "تهران، خیابان سهروردی شمالی، خیابان خرمشهر (آپادانا)، پلاک ۱۱۸، واحد ۱۳",
      addressEn: "Unit 13, No. 118, Khorramshahr (Apadana) St., North Sohrevardi St., Tehran, Iran",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=118+Khorramshahr+(Apadana)+St+Tehran",
      // no source gives office hours yet: empty hides the row until the admin sets them
      hoursFa: "",
      hoursEn: "",
    },
    social: { linkedin: "", telegram: "", instagram: "", bale: "", aparat: "" },
    stats: [
      { value: "15+", labelFa: "سال تجربه، از ۱۳۸۹", labelEn: "years of experience, since 2010" },
      { value: "20", labelFa: "بانک و سازمان با سامانه‌های پارس", labelEn: "banks and organizations run Pars systems" },
      { value: "60+", labelFa: "سازمان در آموزش، مشاوره و نرم‌افزار", labelEn: "organizations trained, advised or served" },
      { value: "90%", labelFa: "اتوماسیون کارهای تکراری با ایجنت‌ها", labelEn: "of repetitive work automated by agents" },
    ],
  },
  notify: { channel: "none", chatId: "", emailCustomers: true },
  email: { mailFrom: "" },
  support: { deflection: true, triage: true },
};

export const PROVIDERS: { id: ProviderId; label: string; keyUrl: string; hint: string; models: string[]; note: string }[] = [
  {
    id: "google",
    label: "Google AI Studio (Gemini)",
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "AQ.… یا AIza…",
    // free tier for new keys (Oct 2026): 3.x Flash and Flash-Lite; 4 Argon and 3.1 Pro are paid only; 2.5 is closed to new keys
    models: ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-4-argon", "gemini-3.1-pro-preview"],
    note: "پلن رایگان برای مدل‌های Flash و Flash-Lite. اگر مدلی شلوغ باشد یا سهمیه‌اش تمام شود، مدل‌های جایگزین و بعد مدل‌های رایگان 3.5 Flash-Lite، 3.1 Flash-Lite، 3.6 Flash و 3.8 Flash خودکار امتحان می‌شوند. Gemini 4 Argon و 3.1 Pro پلن رایگان ندارند و مدل‌های 2.5 برای کلیدهای جدید بسته‌اند.",
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
    note: "برای OpenAI،\u200F OpenRouter یا درگاه‌های داخلی سازگار با OpenAI؛ آدرس پایه را (معمولاً با ‎/v1) وارد کنید.",
  },
];

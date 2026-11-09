// Pure helpers of the AI screens (settings, the assistant, the home page's AI strip, a module's AI kit): Persian
// labels, confidence levels, chains, budgets and number formatting. No React and no CSS here, so tests can import it
// in node.
import { APP_NAME } from "@shared/constants";
import type { AiConnectionPublic, AiConnectionStatus, AiDataPolicy, AiEffort, AiErrorKind, AiJob, AiSettings } from "@shared/ai/types";
import type { AiStatus } from "@shared/ai/api";
import { AI_SETUP_KINDS } from "@shared/ai/errors";

// ---------------------------------------------------------------- labels

export const JOBS: AiJob[] = ["assistant", "analysis", "fast", "vision"];

export const JOB_LABEL: Record<AiJob, { title: string; about: string; tier: "smart" | "fast" | "vision" }> = {
  assistant: { title: "دستیار", about: `گفت‌وگو با دستیار و کار با ابزارهای ${APP_NAME}`, tier: "smart" },
  analysis: { title: "تحلیل و گزارش", about: "تحلیل گزارش‌ها و خلاصه‌های طولانی", tier: "smart" },
  fast: { title: "کارهای سریع", about: "متن‌های کوتاه، دسته‌بندی و خلاصه‌های ساده", tier: "fast" },
  vision: { title: "خواندن تصویر و سند", about: "تصویر و PDFی که همراه پرسش فرستاده می‌شود", tier: "vision" },
};

export const EFFORTS: AiEffort[] = ["low", "medium", "high", "max"];
export const EFFORT_LABEL: Record<AiEffort, string> = { low: "کم", medium: "متوسط", high: "زیاد", max: "حداکثر" };

export const TIER_LABEL: Record<"smart" | "fast" | "vision", string> = { smart: "هوشمند", fast: "سریع", vision: "تصویر" };

export type ConnectionTone = "ok" | "attention" | "unchecked" | "paused" | "off";

/** «سالم / نیاز به توجه / بررسی نشده / متوقف» and «غیرفعال» for a switched-off connection. */
export function connectionTone(c: Pick<AiConnectionPublic, "status" | "enabled" | "paused_until" | "key_unreadable" | "has_key">, now = Date.now()): ConnectionTone {
  if (!c.enabled) return "off";
  if (c.paused_until && Date.parse(c.paused_until) > now) return "paused";
  if (c.status === "paused") return "paused";
  if (c.key_unreadable || c.status === "error") return "attention";
  if (c.status === "ok") return "ok";
  return "unchecked";
}

export const TONE_LABEL: Record<ConnectionTone, string> = { ok: "سالم", attention: "نیاز به توجه", unchecked: "بررسی نشده", paused: "متوقف", off: "غیرفعال" };

export const STATUS_OF_TONE: Record<ConnectionTone, AiConnectionStatus | "off"> = { ok: "ok", attention: "error", unchecked: "unchecked", paused: "paused", off: "off" };

export const FEATURE_LABEL: Record<keyof AiSettings["features"], { title: string; about: string }> = {
  assistant: { title: "دستیار گفت‌وگو", about: "پرسش از دستیار در همهٔ صفحه‌ها" },
  proposals: { title: "پیش‌نویس به پیشنهاد دستیار", about: "دستیار پیش‌نویس آماده می‌کند؛ ثبت با تأیید شما است" },
  files: { title: "فایل و تصویر", about: "فرستادن تصویر و PDF همراه پرسش، و خواندن سند در بخش‌هایی که آن را دارند" },
  agents: { title: "عامل‌های هوش مصنوعی", about: "عامل‌ها با هویت و نقش‌های خودشان اجرا می‌شوند؛ خاموش کردن، همهٔ عامل‌ها را در گام بعدشان متوقف می‌کند" },
  virtual_agent: { title: "دستیار مجازی درخواست‌کنندگان", about: "دستیار مجازی برای فهم پرسش و نوشتن پاسخ از مدل کمک می‌گیرد؛ بی‌آن با کلیدواژه‌ها کار می‌کند" },
};

export const FEATURE_KEYS = Object.keys(FEATURE_LABEL) as (keyof AiSettings["features"])[];

export const POLICY_LABEL: Record<AiDataPolicy, { title: string; about: string }> = {
  masked: { title: "پوشاندن اطلاعات شخصی", about: "کد ملی، موبایل، شمارهٔ کارت، شبا و گذرنامه پیش از ارسال به مدل پوشانده می‌شود." },
  aggregates: { title: "فقط جمع‌ها", about: "نام افراد هم فرستاده نمی‌شود؛ پاسخ‌ها کلی‌تر و بی‌نام‌اند." },
  full: { title: "بدون پوشاندن", about: `داده‌ها همان‌طور که در ${APP_NAME} هست به مدل فرستاده می‌شود.` },
};

/** Persian explanation and remedy of an error class (used when the server sends only the kind). */
export const ERROR_HELP: Record<AiErrorKind, { title: string; remedy: string }> = {
  auth: { title: "کلید پذیرفته نشد", remedy: "کلید نامعتبر است، باطل شده یا پروژه‌اش محدود است. کلید تازه‌ای بسازید و در «ویرایش» وارد کنید." },
  region: { title: "سرویس موقعیت سرور را نپذیرفت", remedy: "این سرویس از ایران در دسترس نیست. در نسخهٔ ویندوز از درگاه ایرانی یا «اتصال‌های نسخهٔ وب» استفاده کنید." },
  quota: { title: "اعتبار یا سهمیه تمام شده است", remedy: "اعتبار حساب سرویس را شارژ کنید یا مدل دیگری را جایگزین کنید." },
  rate: { title: "محدودیت تعداد درخواست", remedy: "چند لحظه بعد دوباره امتحان کنید؛ تا آن زمان اتصال بعدی پاسخ می‌دهد." },
  overloaded: { title: "سرویس شلوغ است", remedy: "خطای موقت سرویس است؛ کمی بعد دوباره امتحان کنید." },
  model: { title: "مدل پیدا نشد", remedy: "این مدل وجود ندارد یا برای این کلید باز نیست. از «به‌روزرسانی فهرست مدل‌ها» مدل دیگری انتخاب کنید." },
  invalid: { title: "سرویس درخواست را نپذیرفت", remedy: "مدل یا نشانی پایه را بررسی کنید." },
  refusal: { title: "مدل از پاسخ خودداری کرد", remedy: "پرسش را دقیق‌تر بنویسید یا مدل دیگری را امتحان کنید." },
  timeout: { title: "مدل در زمان مقرر پاسخ نداد", remedy: "دوباره امتحان کنید یا مدل سریع‌تری انتخاب کنید." },
  network: { title: "به سرویس وصل نشد", remedy: "اینترنت و «نشانی پایهٔ API» را بررسی کنید." },
  budget: { title: "بودجهٔ هوش مصنوعی تمام شده است", remedy: "سقف بودجه را در «مصرف و بودجه» بالا ببرید یا تا دورهٔ بعد صبر کنید." },
  disabled: { title: "هوش مصنوعی خاموش است", remedy: "در «قابلیت‌ها و حریم خصوصی» روشنش کنید." },
  not_configured: { title: "هوش مصنوعی راه‌اندازی نشده است", remedy: "در «اتصال‌ها» یک کلید API اضافه کنید." },
  empty: { title: "پاسخی نیامد", remedy: "دوباره امتحان کنید." },
  other: { title: "خطای سرویس", remedy: "کمی بعد دوباره امتحان کنید." },
};

// ---------------------------------------------------------------- confidence

export type ConfidenceLevel = "high" | "mid" | "low";

/** Confidence of a value read by a model: high ≥ 0.85, mid ≥ 0.6, otherwise low (BC-style review colours). */
export function confidenceLevel(c: number | null | undefined): ConfidenceLevel {
  const v = typeof c === "number" && Number.isFinite(c) ? c : 0;
  return v >= 0.85 ? "high" : v >= 0.6 ? "mid" : "low";
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = { high: "اطمینان بالا", mid: "بررسی کنید", low: "اطمینان کم" };

// ---------------------------------------------------------------- chains

export type ChainLink = { connection_id: string; model: string };

/** Move a link of a chain up (-1) or down (+1); out-of-range moves return the chain unchanged. */
export function moveLink(chain: ChainLink[], i: number, dir: -1 | 1): ChainLink[] {
  const j = i + dir;
  if (i < 0 || i >= chain.length || j < 0 || j >= chain.length) return chain;
  const next = chain.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Drop links whose connection is gone and duplicates of the same (connection, model). */
export function cleanChain(chain: ChainLink[], connectionIds: Set<string>): ChainLink[] {
  const seen = new Set<string>();
  return chain.filter((l) => {
    const k = `${l.connection_id}\u0000${l.model}`;
    if (!l.connection_id || !l.model.trim() || !connectionIds.has(l.connection_id) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The chain the engine uses when a job has none: the first enabled connection's model of the job's tier. */
export function defaultLink(job: AiJob, connections: AiConnectionPublic[]): ChainLink | null {
  return autoChain(job, connections)[0] ?? null;
}

/**
 * What «خودکار» runs (as the server's chainFor does): every enabled connection by «اولویت», each with every model
 * of the job's tier in order, so a free plan's next model answers when the first one's daily quota runs out.
 */
export function autoChain(job: AiJob, connections: AiConnectionPublic[]): ChainLink[] {
  const tier = JOB_LABEL[job].tier;
  return connections
    .filter((x) => x.enabled)
    .sort((a, b) => a.priority - b.priority)
    .flatMap((c) => {
      const models = c.models[tier].length ? c.models[tier] : c.models.smart;
      return [...new Set(models.filter(Boolean))].map((model) => ({ connection_id: c.id, model }));
    });
}

/** Model suggestions for a connection and a tier: its chosen models first, then the provider's list, no repeats. */
export function modelOptions(c: Pick<AiConnectionPublic, "models" | "available_models"> | null | undefined, tier?: "smart" | "fast" | "vision", extra: string[] = []): string[] {
  if (!c) return extra;
  const first = tier ? c.models[tier] : [...c.models.smart, ...c.models.fast, ...c.models.vision];
  return [...new Set([...first, ...c.models.smart, ...c.models.fast, ...c.models.vision, ...extra, ...(c.available_models ?? [])].filter(Boolean))];
}

// ---------------------------------------------------------------- numbers

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
export const num = n;

/** Share of a budget used, 0…1+ (null without a budget). */
export function budgetShare(spent: unknown, budget: string | null | undefined): number | null {
  const b = n(budget);
  if (!budget || b <= 0) return null;
  return n(spent) / b;
}

/** Budget state for colours: under the alert line, past it, or used up. */
export function budgetState(share: number | null, alertPct: number): "ok" | "alert" | "over" {
  if (share === null) return "ok";
  if (share >= 1) return "over";
  return share * 100 >= alertPct ? "alert" : "ok";
}

/** Persian figure helpers that stay correct in node (Intl fa-IR). */
const nf = (d: number) => new Intl.NumberFormat("fa-IR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** «۱۲٫۴۰ دلار» style: USD with 2 decimals, 4 under one cent so tiny test calls never read as zero. */
export function usd(v: unknown): string {
  const x = n(v);
  if (x === 0) return nf(0).format(0);
  return Math.abs(x) < 0.01 ? nf(4).format(x) : nf(2).format(x);
}

/** «۱٫۲ هزار»، «۳٫۴ میلیون» for token counts. */
export function tokens(v: unknown): string {
  const x = n(v);
  if (x < 1000) return nf(0).format(x);
  if (x < 1e6) return `${nf(x < 1e4 ? 1 : 0).format(x / 1000)} هزار`;
  return `${nf(1).format(x / 1e6)} میلیون`;
}

/** Milliseconds as «۸۴۰ میلی‌ثانیه» or «۲٫۳ ثانیه». */
export function duration(ms: unknown): string {
  const x = n(ms);
  return x < 1000 ? `${nf(0).format(x)} میلی‌ثانیه` : `${nf(1).format(x / 1000)} ثانیه`;
}

/** Strip spaces and invisible direction marks from a pasted key (what the server does too). */
export const cleanKey = (s: string) => s.replace(/[\s\p{Cf}]/gu, "");

// ---------------------------------------------------------------- errors and the AI strip

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The AI error class of a failed request (the server sends it as the error code or in the details), or null. */
export function errorKindOf(e: unknown): AiErrorKind | null {
  if (!e || typeof e !== "object") return null;
  const o = e as { code?: unknown; details?: unknown; kind?: unknown; status?: unknown };
  // status 0 = the app's own server could not be reached (not a provider's network error)
  const code = o.status === 0 ? null : typeof o.code === "string" ? o.code.replace(/^ai_/, "") : null;
  for (const k of [o.kind, rec(o.details).kind, code]) if (typeof k === "string" && k in ERROR_HELP) return k as AiErrorKind;
  return null;
}

export type StripKind = "setup" | "budget" | "problem";

/** What the home page's AI strip says for this status (ai:full only), or null when all is well or AI is off on purpose. */
export function stripOf(s: AiStatus | undefined): StripKind | null {
  if (!s || !s.can_manage || !s.enabled) return null;
  if (!s.configured) return "setup";
  if (s.budget?.state === "stopped") return "budget";
  if (!s.ok && s.kind && AI_SETUP_KINDS.includes(s.kind)) return "problem";
  return null;
}

/** A failed request in one Persian sentence (a missing endpoint reads as «not available here», not «error 404»). */
export function failText(e: unknown): string {
  const o = (e ?? {}) as { status?: unknown; message?: unknown };
  if (o.status === 404) return "این قابلیت روی این سرور در دسترس نیست؛ نسخهٔ برنامه را به‌روز کنید.";
  return typeof o.message === "string" && o.message ? o.message : "خطای پیش‌بینی‌نشده؛ دوباره امتحان کنید.";
}

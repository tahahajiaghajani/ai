// Pure helpers of the AI screens (settings, insights, explain, capture, forecast): Persian labels, confidence levels,
// chains, budgets and number formatting. No React and no CSS here, so tests can import it in node.
import type { AiCaptureResult, AiConnectionPublic, AiConnectionStatus, AiDataPolicy, AiEffort, AiErrorKind, AiInsight, AiJob, AiSettings, AiSeverity } from "@shared/ai/types";
import { AI_CAPTURE_LINE_FIELDS, type AiCaptureField, type AiStatus } from "@shared/ai/api";
import { AI_SETUP_KINDS } from "@shared/ai/errors";
import { formatNumber } from "@shared/format";

// ---------------------------------------------------------------- labels

export const JOBS: AiJob[] = ["assistant", "analysis", "fast", "vision"];

export const JOB_LABEL: Record<AiJob, { title: string; about: string; tier: "smart" | "fast" | "vision" }> = {
  assistant: { title: "دستیار", about: "گفت‌وگو با دستیار و کار با ابزارهای سیراف", tier: "smart" },
  analysis: { title: "تحلیل و گزارش", about: "تحلیل گزارش‌ها، خلاصهٔ روز و برنامهٔ ماه", tier: "smart" },
  fast: { title: "کارهای سریع", about: "متن‌های کوتاه، دسته‌بندی و خلاصه‌های ساده", tier: "fast" },
  vision: { title: "خواندن تصویر و سند", about: "فاکتور خرید، کارت ملی و چک از روی عکس یا PDF", tier: "vision" },
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
  proposals: { title: "پیش‌نویس به پیشنهاد دستیار", about: "دستیار پیش‌نویس سند و فاکتور آماده می‌کند؛ ثبت با تأیید شما است" },
  insights: { title: "بینش‌ها و خلاصهٔ امروز", about: "هشدارهای پیشخوان و خلاصهٔ هر روز" },
  explain: { title: "تحلیل گزارش‌ها", about: "دکمهٔ «تحلیل با هوش مصنوعی» روی گزارش‌ها" },
  capture: { title: "خواندن از تصویر", about: "فاکتور خرید، کارت ملی و چک از روی عکس یا PDF" },
  forecast: { title: "پیش‌بینی و برنامه‌ریزی", about: "جریان نقدی، فروش، نرخ‌ها و برنامهٔ ماه" },
};

export const FEATURE_KEYS = Object.keys(FEATURE_LABEL) as (keyof AiSettings["features"])[];

export const POLICY_LABEL: Record<AiDataPolicy, { title: string; about: string }> = {
  masked: { title: "پوشاندن اطلاعات شخصی", about: "کد ملی، موبایل، شمارهٔ کارت، شبا و گذرنامه پیش از ارسال به مدل پوشانده می‌شود." },
  aggregates: { title: "فقط جمع‌ها", about: "نام اشخاص هم فرستاده نمی‌شود؛ پاسخ‌ها کلی‌تر و بی‌نام‌اند." },
  full: { title: "بدون پوشاندن", about: "داده‌ها همان‌طور که در سیراف هست به مدل فرستاده می‌شود." },
};

export const SEVERITY_LABEL: Record<AiSeverity, string> = { critical: "فوری", warning: "مهم", notice: "توجه", info: "برای اطلاع" };
export const SEVERITY_RANK: Record<AiSeverity, number> = { critical: 0, warning: 1, notice: 2, info: 3 };

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

// ---------------------------------------------------------------- responses of the features (tolerant readers)

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : "")).filter(Boolean) : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** POST /ai/explain → narrative, key points and follow-up questions, whichever names the server used. */
export function explainOf(r: unknown): {
  narrative: string;
  points: string[];
  questions: string[];
  warnings: string[];
  source: "ai" | "template";
  model: string | null;
  /** why the template was shown instead of the model's text */
  note: string | null;
} {
  const o = rec(rec(r).explanation ?? r);
  const narrative = String(o.narrative ?? o.markdown ?? o.text ?? "").trim();
  return {
    narrative,
    points: strs(o.points ?? o.key_points),
    questions: strs(o.questions ?? o.follow_ups ?? o.follow_up),
    warnings: strs(o.warnings),
    source: o.source === "ai" || (o.source === undefined && !!o.model) ? "ai" : "template",
    model: typeof o.model === "string" ? o.model : null,
    note: typeof o.note_fa === "string" && o.note_fa ? o.note_fa : null,
  };
}

/** Labels of the fields a capture returns (keys: AI_CAPTURE_FIELDS of @shared/ai/api), in review order. */
export const CAPTURE_FIELDS: { [K in AiCaptureResult["kind"]]: { key: AiCaptureField<K>; label: string }[] } = {
  purchase_invoice: [
    { key: "seller_name", label: "فروشنده" },
    { key: "seller_national_id", label: "شناسهٔ ملی یا کد ملی فروشنده" },
    { key: "seller_economic_code", label: "کد اقتصادی فروشنده" },
    { key: "seller_phone", label: "تلفن فروشنده" },
    { key: "invoice_no", label: "شمارهٔ فاکتور" },
    { key: "date", label: "تاریخ" },
    { key: "subtotal", label: "جمع پیش از مالیات" },
    { key: "discount", label: "تخفیف" },
    { key: "tax", label: "مالیات و عوارض" },
    { key: "total", label: "مبلغ کل" },
    { key: "currency_unit", label: "واحد پول" },
  ],
  id_card: [
    { key: "first_name", label: "نام" },
    { key: "last_name", label: "نام خانوادگی" },
    { key: "national_id", label: "کد ملی" },
    { key: "birth_date", label: "تاریخ تولد" },
    { key: "father_name", label: "نام پدر" },
    { key: "id_doc_no", label: "شمارهٔ سریال کارت" },
    { key: "expiry", label: "تاریخ انقضا" },
  ],
  cheque: [
    { key: "sayad_id", label: "شناسهٔ صیادی" },
    { key: "serial_no", label: "شمارهٔ چک" },
    { key: "amount", label: "مبلغ" },
    { key: "amount_words", label: "مبلغ به حروف" },
    { key: "due_date", label: "تاریخ سررسید" },
    { key: "bank_name", label: "بانک" },
    { key: "branch_name", label: "شعبه" },
    { key: "account_owner", label: "صاحب حساب (صادرکننده)" },
    { key: "account_no", label: "شمارهٔ حساب" },
    { key: "iban", label: "شبا" },
    { key: "payee", label: "در وجه" },
    { key: "issuer_national_id", label: "کد ملی صادرکننده" },
  ],
  receipt: [
    { key: "payer", label: "پرداخت‌کننده" },
    { key: "payee", label: "دریافت‌کننده" },
    { key: "amount", label: "مبلغ" },
    { key: "date", label: "تاریخ" },
    { key: "reference", label: "شمارهٔ پیگیری" },
    { key: "bank_name", label: "بانک" },
    { key: "card_last4", label: "چهار رقم آخر کارت" },
    { key: "description", label: "شرح" },
  ],
};

export const LINE_FIELDS: { key: (typeof AI_CAPTURE_LINE_FIELDS)[number]; label: string; numeric?: boolean }[] = [
  { key: "description", label: "شرح" },
  { key: "code", label: "کد" },
  { key: "qty", label: "مقدار", numeric: true },
  { key: "unit", label: "واحد" },
  { key: "unit_price", label: "فی", numeric: true },
  { key: "discount", label: "تخفیف", numeric: true },
  { key: "tax", label: "مالیات", numeric: true },
  { key: "total", label: "مبلغ", numeric: true },
];

/** Amounts the server normalised to plain digits get their thousands separators back for reading. */
const AMOUNT_KEYS = new Set(["subtotal", "discount", "tax", "total", "amount"]);
const shown = (key: string, v: string) => (AMOUNT_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(v) ? formatNumber(v, { dp: 4, minDp: 0 }) : v);

/**
 * The rows to review: the kind's fields that have a value, in order, then the party the server matched exactly
 * (its name and code). Helper keys the server adds (`*_iso`) are not shown.
 */
export function captureRows(kind: keyof typeof CAPTURE_FIELDS, fields: Record<string, { value: string | null; confidence: number; note_fa?: string }>) {
  const has = (k: string) => fields[k] && fields[k].value !== null && String(fields[k].value).trim() !== "";
  const rows = (CAPTURE_FIELDS[kind] as { key: string; label: string }[])
    .filter((f) => has(f.key))
    .map((f) => ({ key: f.key, label: f.label, value: shown(f.key, String(fields[f.key].value)), confidence: fields[f.key].confidence, note: fields[f.key].note_fa ?? null }));
  if (has("party_id")) rows.push({ key: "party_id", label: "شخص در سیراف", value: fields.party_id.note_fa ?? "پیدا شد", confidence: fields.party_id.confidence, note: "با کد ملی یا کد اقتصادی دقیق پیدا شد" });
  return rows;
}

/** Lowest confidence of a line's cells (a line is as sure as its weakest value). */
export function lineConfidence(line: Record<string, { value: string | null; confidence: number }>): number {
  const c = Object.values(line).filter((v) => v && v.value !== null).map((v) => v.confidence);
  return c.length ? Math.min(...c) : 0;
}

/** «۱۴۰۵/۰۸/۱۱», «1405-08-11» or «2026-11-02» → ISO (Gregorian) day, or null. Jalali needs the converter. */
export function dayOf(v: string | null | undefined, jalaliToISO: (y: number, m: number, d: number) => string): string | null {
  if (!v) return null;
  const s = v.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const m = s.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y < 1700) return jalaliToISO(y, mo, d);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** An amount read from an image («۱٬۲۵۰٬۰۰۰ ریال», "1,250,000") as a plain decimal string, or null. */
export function amountOf(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .replace(/[^\d.-]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

/** The AI error class of a failed request (the server sends it as the error code or in the details), or null. */
export function errorKindOf(e: unknown): AiErrorKind | null {
  if (!e || typeof e !== "object") return null;
  const o = e as { code?: unknown; details?: unknown; kind?: unknown; status?: unknown };
  // status 0 = the app's own server could not be reached (not a provider's network error)
  const code = o.status === 0 ? null : typeof o.code === "string" ? o.code.replace(/^ai_/, "") : null;
  for (const k of [o.kind, rec(o.details).kind, code]) if (typeof k === "string" && k in ERROR_HELP) return k as AiErrorKind;
  return null;
}

// ---------------------------------------------------------------- dashboard

/** Severity first, then newest. Dismissed, done and snoozed insights leave the feed. */
export function feedOf(list: AiInsight[]): AiInsight[] {
  return list
    .filter((i) => i.status === "new" || i.status === "seen")
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.created_at.localeCompare(a.created_at));
}

export type StripKind = "setup" | "budget" | "problem";

/** What the dashboard's AI strip says for this status (ai:full only), or null when all is well or AI is off on purpose. */
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

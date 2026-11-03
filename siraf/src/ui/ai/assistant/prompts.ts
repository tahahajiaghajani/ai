// Suggested questions: page-aware starters (the empty conversation and the Ctrl K palette) and the «/» menu of quick
// prompts (built-in ones plus the person's own, kept in this browser). Data only; the panel draws them.
import type { ModuleKey } from "@shared/constants";

export type PromptIcon = "summary" | "chart" | "cheque" | "people" | "cash" | "stock" | "gold" | "fx" | "doc" | "search" | "forecast" | "draft";

export interface Suggestion {
  key: string;
  text: string;
  icon: PromptIcon;
  module?: ModuleKey;
  /** prepares a draft: offered only to people who may (ai:edit) */
  draft?: boolean;
  /** has a blank to fill in: goes to the composer instead of being sent */
  fill?: boolean;
}

const S = (key: string, icon: PromptIcon, text: string, extra: Partial<Suggestion> = {}): Suggestion => ({ key, icon, text, ...extra });

const GENERAL: Suggestion[] = [
  S("brief", "summary", "خلاصهٔ امروز کسب‌وکار را با عددها بگو"),
  S("sales-month", "chart", "فروش این ماه را با ماه پیش مقایسه کن"),
  S("cheques-week", "cheque", "چک‌های سررسید این هفته کدام‌اند؟"),
  S("debtors", "people", "کدام مشتری‌ها بیشترین بدهی سررسیدگذشته را دارند؟"),
  S("cash-13", "forecast", "جریان نقدی ۱۳ هفتهٔ آینده را پیش‌بینی کن"),
];

/** Starters by the page's first path segments; the longest matching prefix wins. */
const BY_PAGE: [prefix: string, list: Suggestion[]][] = [
  [
    "reports/trial-balance",
    [S("tb-explain", "search", "این تراز آزمایشی را تحلیل کن و نکته‌های مهمش را بگو"), S("tb-moves", "chart", "کدام حساب‌ها در این دوره بیشترین گردش را داشته‌اند؟"), S("tb-anom", "search", "ناهنجاری‌های اسناد این ماه را پیدا کن")],
  ],
  [
    "reports/income-statement",
    [S("is-compare", "chart", "سود و زیان این دوره را با دورهٔ پیش مقایسه کن"), S("is-costs", "chart", "بزرگ‌ترین هزینه‌های این دوره کدام‌اند؟"), S("is-margin", "summary", "حاشیهٔ سود ناخالص و خالص را حساب کن")],
  ],
  [
    "reports/balance-sheet",
    [S("bs-ratios", "summary", "نسبت جاری و نسبت آنی را از ترازنامه حساب کن"), S("bs-explain", "search", "این ترازنامه را به زبان ساده توضیح بده"), S("bs-cash", "cash", "ماندهٔ نقد و بانک چقدر است؟")],
  ],
  ["reports/ledger", [S("lg-sum", "search", "گردش این حساب را در این دوره خلاصه کن"), S("lg-big", "doc", "بزرگ‌ترین ردیف‌های این دفتر کدام‌اند؟")]],
  ["reports/detail-balances", [S("db-debt", "people", "بدهکاران سررسیدگذشته را به ترتیب مبلغ فهرست کن"), S("db-collect", "people", "برای وصول مطالبات این ماه برنامه بده")]],
  ["reports/journal", [S("jr-anom", "search", "ناهنجاری‌های اسناد این ماه را پیدا کن"), S("jr-sum", "summary", "اسناد این دوره را خلاصه کن")]],
  [
    "sales",
    [
      S("sl-top", "chart", "پرفروش‌ترین کالاهای این ماه کدام‌اند؟", { module: "goods" }),
      S("sl-profit", "chart", "سود ناخالص فروش این ماه چقدر بود؟", { module: "goods" }),
      S("sl-unpaid", "doc", "فاکتورهای فروش تسویه‌نشده را فهرست کن", { module: "goods" }),
      S("sl-draft", "draft", "پیش‌نویس فاکتور فروش برای ", { module: "goods", draft: true, fill: true }),
    ],
  ],
  [
    "purchases",
    [
      S("pu-sum", "chart", "خرید این ماه را به تفکیک تأمین‌کننده نشان بده", { module: "goods" }),
      S("pu-due", "doc", "بدهی‌های ما به تأمین‌کننده‌ها چقدر است؟", { module: "goods" }),
      S("pu-draft", "draft", "پیش‌نویس فاکتور خرید از ", { module: "goods", draft: true, fill: true }),
    ],
  ],
  [
    "inventory",
    [
      S("in-reorder", "stock", "کدام کالاها به نقطهٔ سفارش رسیده‌اند؟", { module: "goods" }),
      S("in-dead", "stock", "کالاهای راکد سه ماه اخیر را نشان بده", { module: "goods" }),
      S("in-value", "summary", "ارزش موجودی انبار چقدر است؟", { module: "goods" }),
      S("in-demand", "forecast", "تقاضای ماه آینده را برای پرفروش‌ها پیش‌بینی کن", { module: "goods" }),
    ],
  ],
  [
    "gold",
    [
      S("gd-bubble", "gold", "حباب سکهٔ امامی امروز چقدر است؟", { module: "gold" }),
      S("gd-position", "gold", "موقعیت طلای کسب‌وکار را به گرم ۷۵۰ بگو", { module: "gold" }),
      S("gd-sales", "chart", "فروش طلای این ماه را به تفکیک نوع نشان بده", { module: "gold" }),
      S("gd-quote", "gold", "قیمت فروش یک سکهٔ تمام بهار آزادی را حساب کن", { module: "gold" }),
    ],
  ],
  [
    "fx",
    [
      S("fx-pos", "fx", "موقعیت باز ارزی و سود و زیان امروز را بگو", { module: "fx" }),
      S("fx-range", "forecast", "محدودهٔ نرخ دلار برای هفتهٔ آینده چقدر است؟", { module: "fx" }),
      S("fx-rem", "fx", "حواله‌های در انتظار کدام‌اند؟", { module: "fx" }),
      S("fx-vol", "chart", "حجم معاملات ارزی این ماه را به تفکیک ارز نشان بده", { module: "fx" }),
    ],
  ],
  [
    "treasury",
    [
      S("tr-balances", "cash", "ماندهٔ صندوق‌ها و حساب‌های بانکی چقدر است؟"),
      S("tr-cheques", "cheque", "چک‌های دریافتی و پرداختی سررسید این هفته کدام‌اند؟"),
      S("tr-cash", "forecast", "جریان نقدی ۱۳ هفتهٔ آینده را پیش‌بینی کن"),
      S("tr-draft", "draft", "پیش‌نویس دریافت وجه از ", { draft: true, fill: true }),
    ],
  ],
  [
    "parties",
    [S("pa-debt", "people", "بدهکاران سررسیدگذشته را به ترتیب مبلغ فهرست کن"), S("pa-best", "chart", "مشتری‌های اصلی این فصل چه کسانی بودند؟"), S("pa-new", "draft", "پیش‌نویس شخص تازه با این مشخصات: ", { draft: true, fill: true })],
  ],
  [
    "accounting",
    [S("ac-drafts", "doc", "سندهای پیش‌نویس را فهرست کن"), S("ac-anom", "search", "ناهنجاری‌های اسناد این ماه را پیدا کن"), S("ac-draft", "draft", "پیش‌نویس سند حسابداری برای ", { draft: true, fill: true })],
  ],
];

/** Detail pages get questions about the record itself first. */
const RECORD: Record<string, Suggestion[]> = {
  invoice: [S("r-inv", "search", "این فاکتور را خلاصه کن و وضعیت تسویه‌اش را بگو")],
  voucher: [S("r-vch", "search", "این سند را توضیح بده؛ چه اثری روی حساب‌ها دارد؟")],
  party: [S("r-party", "people", "خلاصهٔ حساب این شخص را بگو: مانده، چک‌ها و سابقهٔ پرداخت")],
  treasury_doc: [S("r-tdoc", "search", "این دریافت یا پرداخت را توضیح بده")],
  gold_doc: [S("r-gdoc", "gold", "این سند طلا را خلاصه کن: وزن، اجرت و سود", { module: "gold" })],
  fx_deal: [S("r-fx", "fx", "سود این معامله با نرخ امروز چقدر است؟", { module: "fx" })],
  remittance: [S("r-rem", "fx", "وضعیت این حواله و هزینه‌هایش را بگو", { module: "fx" })],
};

export interface SuggestionScope {
  has: (m: ModuleKey) => boolean;
  /** may prepare drafts (ai:edit) */
  canDraft: boolean;
  recordType?: string | null;
}

/** Up to `limit` starters for the page `rel` (org-relative path). */
export function suggestionsFor(rel: string, scope: SuggestionScope, limit = 4): Suggestion[] {
  const path = rel.replace(/^\/+|\/+$/g, "");
  let page: Suggestion[] = [];
  let best = -1;
  for (const [prefix, list] of BY_PAGE) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > best) {
      page = list;
      best = prefix.length;
    }
  }
  const ok = (s: Suggestion) => (!s.module || scope.has(s.module)) && (!s.draft || scope.canDraft);
  const record = scope.recordType ? (RECORD[scope.recordType] ?? []) : [];
  const out: Suggestion[] = [];
  for (const s of [...record, ...page, ...GENERAL]) {
    if (out.length >= limit) break;
    if (ok(s) && !out.some((x) => x.key === s.key || x.text === s.text)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------- the Ctrl K palette

/** A question rather than a page name: the «بپرس» row goes first.  */
export function looksLikeQuestion(q: string): boolean {
  const s = q.trim();
  if (/[؟?]$/.test(s)) return true;
  if (/^(?:چه|چرا|چطور|چگونه|چند|چقدر|کدام|کی|کجا|آیا|کو|مقایسه|تحلیل|پیش‌بینی|پیش بینی|خلاصه|بگو|نشان بده|حساب کن|فهرست)(?:\s|$|‌)/.test(s)) return true;
  return s.split(/\s+/).length >= 5;
}

// ---------------------------------------------------------------- the «/» menu

export interface QuickPrompt {
  key: string;
  /** short name typed after «/» */
  name: string;
  text: string;
  module?: ModuleKey;
  /** saved by the person (can be removed) */
  own?: boolean;
}

export const QUICK_PROMPTS: QuickPrompt[] = [
  { key: "q-brief", name: "خلاصهٔ امروز", text: "خلاصهٔ امروز کسب‌وکار را با عددها بگو: فروش، دریافت و پرداخت، چک‌ها و هشدارها." },
  { key: "q-sales", name: "فروش ماه", text: "فروش این ماه را با ماه پیش مقایسه کن و نمودارش را نشان بده." },
  { key: "q-cheques", name: "چک‌های هفته", text: "چک‌های دریافتی و پرداختی سررسید این هفته را با جمع هر طرف فهرست کن." },
  { key: "q-debtors", name: "بدهکاران", text: "بدهکاران سررسیدگذشته را به ترتیب مبلغ فهرست کن و احتمال وصول هر کدام را بگو." },
  { key: "q-cash", name: "نقدینگی", text: "جریان نقدی ۱۳ هفتهٔ آینده را پیش‌بینی کن و هفته‌های کسری را بگو." },
  { key: "q-anomalies", name: "ناهنجاری‌ها", text: "ناهنجاری‌های اسناد این ماه را پیدا کن و هر کدام را توضیح بده." },
  { key: "q-reorder", name: "سفارش دوباره", text: "کالاهایی را که باید دوباره سفارش داد با مقدار پیشنهادی فهرست کن.", module: "goods" },
  { key: "q-bubble", name: "حباب سکه", text: "حباب سکه‌ها را نسبت به میانگین ۳۰ روز گذشته نشان بده.", module: "gold" },
  { key: "q-gold", name: "موقعیت طلا", text: "موقعیت طلای کسب‌وکار را به گرم خالص و ۷۵۰ معادل با ارزش امروز بگو.", module: "gold" },
  { key: "q-fx", name: "موقعیت ارزی", text: "موقعیت باز ارزی و سود و زیان امروز را به تفکیک ارز بگو.", module: "fx" },
];

const ownKey = (orgId: string) => `siraf.ai.prompts.${orgId}`;

/** The person's own quick prompts (this browser only). */
export function readOwnPrompts(orgId: string): QuickPrompt[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ownKey(orgId)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is { key: string; name: string; text: string } => !!p && typeof p.key === "string" && typeof p.name === "string" && typeof p.text === "string")
      .slice(0, 30)
      .map((p) => ({ key: p.key, name: p.name, text: p.text, own: true }));
  } catch {
    return [];
  }
}

export function writeOwnPrompts(orgId: string, list: QuickPrompt[]): void {
  try {
    localStorage.setItem(ownKey(orgId), JSON.stringify(list.filter((p) => p.own).map(({ key, name, text }) => ({ key, name, text }))));
  } catch {
    /* private window or blocked storage: the prompt lives until reload */
  }
}

/** A short name for a saved prompt: its first words. */
export function promptName(text: string): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  const name = words.slice(0, 4).join(" ");
  return words.length > 4 ? `${name}…` : name;
}

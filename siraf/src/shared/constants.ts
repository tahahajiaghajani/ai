// App-wide constants shared by the web app, the desktop app and the server.

/** The product name «سیراف» (until Nov 2026 «تراز»; internal identifiers such as tz_ tables, TARAZ_* env vars and
 *  taraz.* setting keys keep the old name). Use it wherever the app names itself. */
export const APP_NAME = "سیراف";
/** The Latin name, set in Geist 600 at −0.025 em where it is shown as a wordmark. */
export const APP_NAME_EN = "Siraf";
/** The tagline (brief §2). */
export const APP_TAGLINE = "هر داد و ستد، به حساب می‌نشیند.";
export const APP_TAGLINE_EN = "Where trade settles.";
/** Supporting lines: use one at a time. */
export const APP_LINES = [
  { fa: "کالا، طلا، ارز — یک دفتر.", en: "Goods, gold, currency. One set of books." },
  { fa: "حسابِ روشن، داد و ستدِ آسوده.", en: "Clear books, calm trade." },
] as const;
/** What the app is, in one line (window titles, the About screen, meta descriptions). */
export const APP_DESCRIPTION = "حسابداری و مدیریت کسب‌وکار — کالا، طلا، صرافی";
/** Bumped with every release; the desktop app compares it with the cloud to offer updates. */
export const APP_VERSION = "1.0.0";
/** Sync protocol version — the server refuses pushes from clients with another one. Bump it whenever a
 *  synced table gains a column or a new synced kind appears (2: coins and bars, migration 0013), so a
 *  Windows app that does not know them cannot overwrite them. */
export const SYNC_PROTOCOL = 2;

export type ModuleKey = "goods" | "gold" | "fx";

export const MODULES: { key: ModuleKey; title: string; description: string }[] = [
  { key: "goods", title: "کالا و بازرگانی", description: "انبار، خرید و فروش، فاکتور، فهرست قیمت، کاردکس" },
  { key: "gold", title: "طلا و جواهر", description: "تابلوی قیمت، اتیکت، فروش و خرید طلا، آبشده، حساب وزنی" },
  { key: "fx", title: "صرافی و ارز دیجیتال", description: "نرخ ارز، خرید و فروش، حواله، کیف‌پول‌ها، قیمت زنده" },
];

export type BusinessKind = "trading" | "gold" | "exchange" | "services" | "manufacturing" | "mixed";

export const BUSINESS_KINDS: { key: BusinessKind; title: string; modules: ModuleKey[] }[] = [
  { key: "trading", title: "بازرگانی و فروشگاهی", modules: ["goods"] },
  { key: "gold", title: "طلا و جواهر", modules: ["gold"] },
  { key: "exchange", title: "صرافی (نقدی و دیجیتال)", modules: ["fx"] },
  { key: "manufacturing", title: "تولیدی", modules: ["goods"] },
  { key: "services", title: "خدماتی", modules: [] },
  { key: "mixed", title: "ترکیبی (همه‌ی ماژول‌ها)", modules: ["goods", "gold", "fx"] },
];

export const BASE_CURRENCIES = [
  { code: "IRR", title: "ریال", decimals: 0 },
  { code: "IRT", title: "تومان", decimals: 0 },
  { code: "AFN", title: "افغانی", decimals: 2 },
  { code: "AED", title: "درهم امارات", decimals: 2 },
  { code: "IQD", title: "دینار عراق", decimals: 0 },
  { code: "TRY", title: "لیر ترکیه", decimals: 2 },
  { code: "USD", title: "دلار آمریکا", decimals: 2 },
  { code: "EUR", title: "یورو", decimals: 2 },
] as const;

export const DEFAULT_VAT_PCT = "10";
export const DEFAULT_GOLD_PROFIT_PCT = "7";
export const DEFAULT_TIMEZONE = "Asia/Tehran";

/** Document kinds that carry their own number series. */
export const DOC_SERIES = {
  voucher: "سند حسابداری",
  sale: "فاکتور فروش",
  purchase: "فاکتور خرید",
  sale_return: "برگشت از فروش",
  purchase_return: "برگشت از خرید",
  quote: "پیش‌فاکتور",
  sale_order: "سفارش فروش",
  purchase_order: "سفارش خرید",
  receipt: "دریافت",
  payment: "پرداخت",
  transfer: "انتقال وجه",
  stock_receipt: "رسید انبار",
  stock_issue: "حواله انبار",
  stock_transfer: "انتقال بین انبارها",
  stock_adjust: "تعدیل موجودی",
  stock_count: "انبارگردانی",
  gold_sale: "فاکتور فروش طلا",
  gold_purchase: "فاکتور خرید طلا",
  gold_transfer: "حواله طلا",
  fx_deal: "معامله ارز",
  remittance: "حواله ارزی",
  cheque_op: "عملیات چک",
} as const;
export type DocSeries = keyof typeof DOC_SERIES;

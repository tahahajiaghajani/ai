import { DEFAULT_MEMBER_PCT, DEFAULT_PRO_DAYS, DEFAULT_PRO_THRESHOLD, DEFAULT_STEPS, type PriceStep } from "@/lib/pricing";

/** Client-safe settings shapes and defaults (stored per key in celin_settings, merged over these). */

export interface ContactSettings {
  phone: string;
  whatsapp: string;
  instagram: string;
  telegram: string;
  email: string;
  address_fa: string;
  address_en: string;
  hours_fa: string;
  hours_en: string;
  mapUrl: string;
}

export interface AnnouncementSettings {
  enabled: boolean;
  text_fa: string;
  text_en: string;
  link: string;
}

/** The bar colours (src/lib/sale.ts TONE_CLASS: brand grounds whose text reaches at least 7:1), or the admin's own. */
export const SALE_TONES = ["pomegranate", "night", "cocoa", "paraiba", "copper", "champagne", "custom"] as const;
export type SaleTone = (typeof SALE_TONES)[number];

/**
 * «نوار تخفیف روزهای خاص»: a store-wide percentage off every piece (after the quantity step) while it runs, shown
 * in a coloured bar that takes the announcement's place. The server's clock decides the price (src/lib/sale.ts).
 */
export interface SaleSettings {
  enabled: boolean;
  /** percent off every piece after the quantity step, 1–90 */
  pct: number;
  /** the bar's title and short description (empty title: the site's label «تخفیف روزهای خاص») */
  title_fa: string;
  title_en: string;
  text_fa: string;
  text_en: string;
  tone: SaleTone;
  /** "#rrggbb", only with tone "custom" */
  color: string;
  /** ISO instants of whole Tehran days: from the start of the first day, until the start of the day after the last ("" = open) */
  from: string;
  until: string;
  /** Pro accounts get the discount too */
  pro: boolean;
  /** "/…" inside the site, "https://…", or "" */
  link: string;
}

export interface ShopSettings {
  /** smallest order total in Toman (0 = none) */
  minOrder: number;
  /** how members see stock: the exact number, or «موجود / رو به اتمام / ناموجود» */
  stockDisplay: "exact" | "level";
  /** at or below this the level reads «رو به اتمام» */
  lowStock: number;
  /** shown above the order button (shipping, confirmation by phone, …) */
  orderNote_fa: string;
  orderNote_en: string;
}

export interface ProSettings {
  /** put the code into the member's inbox on the site when it is issued */
  codeInInbox: boolean;
  /** default validity of a new membership code in days (0 = no expiry) */
  defaultDays: number;
  /** members' list price, in percent of the admin's price (src/lib/pricing.ts) */
  memberPct: number;
  /** members' invoice steps by pieces in one order */
  steps: PriceStep[];
  /** accepted orders worth at least this (Toman) within `proDays` days make an account Pro (0 = never) */
  proThreshold: number;
  proDays: number;
}

export type NotifyChannel = "none" | "telegram" | "bale";
export interface NotifySettings {
  channel: NotifyChannel;
  botTokenEnc: string;
  chatId: string;
  onOrder: boolean;
  onRequest: boolean;
}

export type SmsProvider = "none" | "smsir" | "kavenegar";
export interface SmsSettings {
  /** SMS.ir is reachable from Vercel's servers; Kavenegar usually refuses connections from abroad */
  provider: SmsProvider;
  apiKeyEnc: string;
  /** sender line number (SMS.ir bulk sending / Kavenegar; optional) */
  sender: string;
  /** SMS.ir approved template ids (send/verify): the code template has #CODE#, the status one #ORDER# and #STATUS# */
  codeTemplate: string;
  statusTemplate: string;
  onCode: boolean;
  onStatus: boolean;
}

export interface EmailSettings {
  resendKeyEnc: string;
  mailFrom: string;
}

export interface CatalogSettings {
  /** true once the catalogue lives in the database (starter items imported or the first item saved) */
  initialized: boolean;
}

export interface SeoSettings {
  description_fa: string;
  description_en: string;
}

export interface Settings {
  contact: ContactSettings;
  announcement: AnnouncementSettings;
  sale: SaleSettings;
  shop: ShopSettings;
  pro: ProSettings;
  notify: NotifySettings;
  sms: SmsSettings;
  email: EmailSettings;
  catalog: CatalogSettings;
  seo: SeoSettings;
}

export type SettingsKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  contact: {
    phone: "",
    whatsapp: "",
    instagram: "",
    telegram: "",
    email: "",
    address_fa: "",
    address_en: "",
    // the owner sets the hours (Settings → Contact); nothing is shown until then
    hours_fa: "",
    hours_en: "",
    mapUrl: "",
  },
  announcement: { enabled: true, text_fa: "سلین، ۲۰ سال درخشش — به دنیای آنلاین سلین خوش آمدید", text_en: "CELIN, twenty years of brilliance — welcome to CELIN online", link: "/maison" },
  sale: { enabled: false, pct: 10, title_fa: "", title_en: "", text_fa: "", text_en: "", tone: "pomegranate", color: "", from: "", until: "", pro: true, link: "/shop" },
  shop: {
    minOrder: 0,
    stockDisplay: "exact",
    lowStock: 3,
    orderNote_fa: "سفارش شما پس از بررسی موجودی، توسط فروشگاه تأیید می‌شود و برای هماهنگی ارسال با شما تماس می‌گیریم.",
    orderNote_en: "The store confirms your order after checking stock, then contacts you to arrange delivery.",
  },
  pro: { codeInInbox: true, defaultDays: 365, memberPct: DEFAULT_MEMBER_PCT, steps: DEFAULT_STEPS, proThreshold: DEFAULT_PRO_THRESHOLD, proDays: DEFAULT_PRO_DAYS },
  notify: { channel: "none", botTokenEnc: "", chatId: "", onOrder: true, onRequest: true },
  sms: { provider: "none", apiKeyEnc: "", sender: "", codeTemplate: "", statusTemplate: "", onCode: true, onStatus: true },
  email: { resendKeyEnc: "", mailFrom: "" },
  catalog: { initialized: false },
  seo: { description_fa: "", description_en: "" },
};

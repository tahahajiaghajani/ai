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

export interface ShopSettings {
  /** smallest order total in Toman (0 = none) */
  minOrder: number;
  /** how Pro members see stock: the exact number, or «موجود / رو به اتمام / ناموجود» */
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
  /** default validity of a new code in days (0 = no expiry) */
  defaultDays: number;
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
    hours_fa: "شنبه تا پنجشنبه، ۱۰ تا ۲۰",
    hours_en: "Saturday to Thursday, 10:00–20:00",
    mapUrl: "",
  },
  announcement: { enabled: true, text_fa: "سلین، ۲۰ سال درخشش — به دنیای آنلاین سلین خوش آمدید", text_en: "CELIN, twenty years of brilliance — welcome to CELIN online", link: "/maison" },
  shop: {
    minOrder: 0,
    stockDisplay: "exact",
    lowStock: 3,
    orderNote_fa: "سفارش شما پس از بررسی موجودی، توسط فروشگاه تأیید می‌شود و برای هماهنگی ارسال با شما تماس می‌گیریم.",
    orderNote_en: "The store confirms your order after checking stock, then contacts you to arrange delivery.",
  },
  pro: { codeInInbox: true, defaultDays: 365 },
  notify: { channel: "none", botTokenEnc: "", chatId: "", onOrder: true, onRequest: true },
  sms: { provider: "none", apiKeyEnc: "", sender: "", codeTemplate: "", statusTemplate: "", onCode: true, onStatus: true },
  email: { resendKeyEnc: "", mailFrom: "" },
  catalog: { initialized: false },
  seo: { description_fa: "", description_en: "" },
};

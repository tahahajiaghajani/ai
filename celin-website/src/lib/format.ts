/** Client-safe formatting helpers (digits, phone numbers, prices, dates). */

export type Lang = "fa" | "en";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Digits in the page language (Persian digits on fa pages); keeps leading zeros. */
export function num(value: string | number, lang: Lang): string {
  const s = String(value);
  if (lang === "en") return s;
  return s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]).replace(/%/g, "٪");
}

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits → 0-9. */
export function latinDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * An Iranian mobile number as 09xxxxxxxxx, or "" when it is not one. Accepts Persian digits, spaces,
 * dashes and the +98 / 0098 / 98 prefixes.
 */
export function normalizePhone(input: string): string {
  let s = latinDigits(String(input ?? "")).replace(/[\s\-().]/g, "");
  if (s.startsWith("+98")) s = `0${s.slice(3)}`;
  else if (s.startsWith("0098")) s = `0${s.slice(4)}`;
  else if (/^98\d{10}$/.test(s)) s = `0${s.slice(2)}`;
  else if (/^9\d{9}$/.test(s)) s = `0${s}`;
  return /^09\d{9}$/.test(s) ? s : "";
}

/** 0912 345 6789 in the page language. */
export function formatPhone(phone: string, lang: Lang): string {
  const p = /^09\d{9}$/.test(phone) ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}` : phone;
  return num(p, lang);
}

const NF = { fa: new Intl.NumberFormat("fa-IR"), en: new Intl.NumberFormat("en-US") };

/** 12500000 → «۱۲٬۵۰۰٬۰۰۰» / "12,500,000". */
export function formatNumber(n: number, lang: Lang): string {
  return NF[lang].format(Math.round(n));
}

export const CURRENCY = { fa: "تومان", en: "Toman" } as const;

/** Price in Toman with the currency name: «۱۲٬۵۰۰٬۰۰۰ تومان» / "12,500,000 Toman". */
export function formatPrice(n: number, lang: Lang): string {
  return `${formatNumber(n, lang)} ${CURRENCY[lang]}`;
}

export function formatDate(iso: string, lang: Lang, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Tehran",
  }).format(d);
}

// Validators for Iranian identifiers and crypto addresses. All accept Persian digits.
import { normalizeDigits } from "./money";

const digitsOnly = (s: string) => normalizeDigits(String(s ?? "")).replace(/[\s-]/g, "");

/** کد ملی (10 digits with check digit). */
export function isNationalId(input: string): boolean {
  const s = digitsOnly(input);
  if (!/^\d{10}$/.test(s) || /^(\d)\1{9}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const sum = d.slice(0, 9).reduce((a, x, i) => a + x * (10 - i), 0);
  const r = sum % 11;
  return r < 2 ? d[9] === r : d[9] === 11 - r;
}

/** شناسه ملی اشخاص حقوقی (11 digits). */
export function isLegalNationalId(input: string): boolean {
  const s = digitsOnly(input);
  if (!/^\d{11}$/.test(s) || /^(\d)\1{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const dd = d[9] + 2;
  const coef = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] + dd) * coef[i];
  let r = sum % 11;
  if (r === 10) r = 0;
  return r === d[10];
}

/** شماره شبا: IR + 24 digits, ISO 13616 mod-97 check. */
export function isIban(input: string): boolean {
  const s = normalizeDigits(String(input ?? "")).replace(/\s/g, "").toUpperCase();
  const iban = /^\d{24}$/.test(s) ? `IR${s}` : s;
  if (!/^IR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export function normalizeIban(input: string): string {
  const s = normalizeDigits(String(input ?? "")).replace(/\s/g, "").toUpperCase();
  return /^\d{24}$/.test(s) ? `IR${s}` : s;
}

/** شماره کارت (16 digits, Luhn). */
export function isCardNumber(input: string): boolean {
  const s = digitsOnly(input);
  if (!/^\d{16}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let n = Number(s[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** شناسه صیادی چک (16 digits). */
export function isSayadId(input: string): boolean {
  return /^\d{16}$/.test(digitsOnly(input));
}

export function isMobile(input: string): boolean {
  const s = digitsOnly(input).replace(/^\+98/, "0").replace(/^0098/, "0").replace(/^98(?=9\d{9}$)/, "0");
  return /^09\d{9}$/.test(s);
}

export function normalizeMobile(input: string): string {
  const s = digitsOnly(input).replace(/^\+98/, "0").replace(/^0098/, "0").replace(/^98(?=9\d{9}$)/, "0");
  return /^9\d{9}$/.test(s) ? `0${s}` : s;
}

export function isPostalCode(input: string): boolean {
  return /^\d{10}$/.test(digitsOnly(input));
}

/** کد/شماره اقتصادی: 10 (حقیقی)، 11 (حقوقی) یا 12–14 رقم (کدهای قدیمی و جدید). */
export function isEconomicCode(input: string): boolean {
  return /^\d{10,14}$/.test(digitsOnly(input));
}

export function isEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(input ?? "").trim());
}

/** شناسه کالا/خدمت سامانه مؤدیان: 13 digits. */
export function isTaxGoodsId(input: string): boolean {
  return /^\d{13}$/.test(digitsOnly(input));
}

export type ChainId =
  | "BTC" | "LTC" | "DOGE" | "ETH" | "BSC" | "POLYGON" | "ARBITRUM" | "BASE" | "TRON" | "SOL" | "TON";

export function isCryptoAddress(chain: ChainId, address: string): boolean {
  const a = String(address ?? "").trim();
  switch (chain) {
    case "BTC":
      return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
    case "LTC":
      return /^(ltc1[02-9ac-hj-np-z]{11,71}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
    case "DOGE":
      return /^[DA9][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
    case "ETH":
    case "BSC":
    case "POLYGON":
    case "ARBITRUM":
    case "BASE":
      return /^0x[0-9a-fA-F]{40}$/.test(a);
    case "TRON":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    case "SOL":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    case "TON":
      return /^([EUk0][Qf][A-Za-z0-9_-]{46}|-?\d:[0-9a-fA-F]{64})$/.test(a);
    default:
      return a.length > 10;
  }
}

/** Persian message for a named validator, or null when valid. Used by both forms and the API. */
export function checkFormat(kind: string, value: string): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  switch (kind) {
    case "nationalId":
      return isNationalId(value) || isLegalNationalId(value) ? null : "کد/شناسه ملی معتبر نیست";
    case "iban":
      return isIban(value) ? null : "شماره شبا معتبر نیست (IR و ۲۴ رقم)";
    case "card":
      return isCardNumber(value) ? null : "شماره کارت معتبر نیست";
    case "mobile":
      return isMobile(value) ? null : "شماره موبایل معتبر نیست (مثلاً ۰۹۱۲۱۲۳۴۵۶۷)";
    case "email":
      return isEmail(value) ? null : "ایمیل معتبر نیست";
    case "postal":
      return isPostalCode(value) ? null : "کد پستی باید ۱۰ رقم باشد";
    case "economic":
      return isEconomicCode(value) ? null : "کد اقتصادی باید ۱۰ تا ۱۴ رقم باشد";
    case "sayad":
      return isSayadId(value) ? null : "شناسه صیادی باید ۱۶ رقم باشد";
    case "taxGoodsId":
      return isTaxGoodsId(value) ? null : "شناسه کالا باید ۱۳ رقم باشد";
    default:
      return null;
  }
}

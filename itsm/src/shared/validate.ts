// Validators for Iranian identifiers, phone numbers and e-mail addresses. All accept Persian digits.
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

/**
 * An address nobody signs up or is invited with: the `.invalid` top-level domain never receives mail and is reserved
 * for the platform's service accounts (the AI service member's `…@service.invalid`).
 */
export function isReservedEmail(input: string): boolean {
  return /@(?:[^\s@]*\.)?invalid\.?$/i.test(String(input ?? "").trim());
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
    default:
      return null;
  }
}

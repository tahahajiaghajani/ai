// Numbers in Persian words — needed on cheques, invoices and receipts
// («یک میلیون و دویست و پنجاه هزار ریال»).
import { D, type Num } from "./money";

const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "هزار میلیارد", "کوادریلیون", "کوینتیلیون", "سکستیلیون"];
const FRACTIONS = ["", "دهم", "صدم", "هزارم", "ده‌هزارم", "صدهزارم", "میلیونیم", "ده‌میلیونیم", "صدمیلیونیم"];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ONES[o]);
  }
  return parts.join(" و ");
}

/** Words for a non-negative integer given as a digit string (any length up to 24 digits). */
function integerWords(digits: string): string {
  const s = digits.replace(/^0+/, "");
  if (!s) return "صفر";
  const groups: number[] = [];
  for (let i = s.length; i > 0; i -= 3) groups.unshift(Number(s.slice(Math.max(0, i - 3), i)));
  const out: string[] = [];
  groups.forEach((g, idx) => {
    if (!g) return;
    const scale = SCALES[groups.length - 1 - idx] ?? "";
    out.push(scale ? `${threeDigits(g)} ${scale}` : threeDigits(g));
  });
  return out.join(" و ");
}

export function numberToWords(value: Num): string {
  const d = D(value);
  const negative = d.isNeg() && !d.isZero();
  const [intPart, fracPart = ""] = d.abs().toFixed().split(".");
  let words = integerWords(intPart);
  const frac = fracPart.replace(/0+$/, "").slice(0, 8);
  if (frac) words += ` ممیز ${integerWords(frac)} ${FRACTIONS[frac.length]}`;
  return negative ? `منفی ${words}` : words;
}

/** «یک میلیون و دویست هزار ریال» */
export function amountToWords(value: Num, unit = "ریال"): string {
  return `${numberToWords(D(value).toDecimalPlaces(0))} ${unit}`.trim();
}

/** «دوازده گرم و سیصد و پنجاه سوت» — gold weights (1 g = 1000 sut). */
export function weightToWords(grams: Num): string {
  const d = D(grams).abs();
  const g = d.floor();
  const sut = d.minus(g).times(1000).toDecimalPlaces(0);
  const parts: string[] = [];
  if (!g.isZero()) parts.push(`${integerWords(g.toFixed())} گرم`);
  if (!sut.isZero()) parts.push(`${integerWords(sut.toFixed())} سوت`);
  return parts.length ? parts.join(" و ") : "صفر گرم";
}

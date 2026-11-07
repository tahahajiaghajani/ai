// Figures in the assistant's tables, charts and chips. Tool rows carry money and weights as decimal strings
// ("12500000", "-3.250"): they are formatted digit by digit (never through a float), with Persian digits, «٬»
// grouping, «٫» decimals and an isolated true minus. Pure functions (unit-tested).
import { toPersianDigits } from "../../lib/fa";

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const MINUS = "−";

/** True for a decimal string or a finite number. */
export const isNumeric = (v: unknown): boolean => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && DECIMAL.test(v.trim()));

/**
 * «1234567.50» → «۱٬۲۳۴٬۵۶۷٫۵۰» exactly (the decimals as given, at most `maxDp`, truncated never rounded up past them).
 * Returns the sign separately so the caller can isolate it: { neg, text }.
 */
export function decimalParts(v: string | number, maxDp = 4): { neg: boolean; text: string } {
  let s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(Math.min(maxDp, 6)).replace(/0+$/, "").replace(/\.$/, "")) : v.trim();
  if (!DECIMAL.test(s)) return { neg: false, text: toPersianDigits(String(v)) };
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  let [int, dec = ""] = s.split(".");
  int = int.replace(/^0+(?=\d)/, "");
  if (dec.length > maxDp) dec = dec.slice(0, maxDp);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  const text = toPersianDigits(dec ? `${grouped}٫${dec}` : grouped);
  const zero = /^0*$/.test(int) && /^0*$/.test(dec);
  return { neg: neg && !zero, text };
}

/** A figure as plain text with a true minus (for Excel-free places such as tooltips and aria labels). */
export function figureText(v: string | number, maxDp = 4): string {
  const p = decimalParts(v, maxDp);
  return p.neg ? `${MINUS}${p.text}` : p.text;
}

/** A number from a row value (charts only: they plot, they do not add up money). */
export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && DECIMAL.test(v.trim())) return Number(v);
  return 0;
}

/** «۲٫۴ مگابایت», «۳۸۰ کیلوبایت» */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${toPersianDigits((bytes / 1024 / 1024).toFixed(1)).replace(".", "٫")} مگابایت`;
  return `${toPersianDigits(String(Math.max(1, Math.round(bytes / 1024))))} کیلوبایت`;
}

// Display formatting: Persian digits, thousands separators, amounts, quantities, percents.
import { D, type Num } from "./money";

const FA = "۰۱۲۳۴۵۶۷۸۹";

export function faDigits(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\d/g, (d) => FA[Number(d)]);
}

export interface NumberFormat {
  /** maximum decimals shown (rounded half-up) */
  dp?: number;
  /** minimum decimals shown (pads with zeros) */
  minDp?: number;
  /** Persian digits (default true) */
  fa?: boolean;
  /** thousands grouping (default true) */
  group?: boolean;
  /** negative numbers as (1,234) instead of -1,234 */
  parens?: boolean;
  /** show "+" for positive numbers */
  sign?: boolean;
  /** text for zero (e.g. "—") */
  zero?: string;
}

export function formatNumber(value: Num, opts: NumberFormat = {}): string {
  const { dp = 8, minDp = 0, fa = true, group = true, parens = false, sign = false, zero } = opts;
  let d = D(value);
  d = d.toDecimalPlaces(dp);
  if (d.isZero() && zero !== undefined) return zero;
  const negative = d.isNeg() && !d.isZero();
  let [i, f = ""] = d.abs().toFixed().split(".");
  if (f.length < minDp) f = f.padEnd(minDp, "0");
  if (group) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, fa ? "٬" : ",");
  let s = f ? `${i}${fa ? "٫" : "."}${f}` : i;
  if (negative) s = parens ? `(${s})` : `-${s}`;
  else if (sign && !d.isZero()) s = `+${s}`;
  return fa ? faDigits(s) : s;
}

/** Money in a currency with `decimals` digits (rial: 0). */
export function formatMoney(value: Num, decimals = 0, opts: Omit<NumberFormat, "dp" | "minDp"> = {}): string {
  return formatNumber(value, { dp: decimals, minDp: 0, ...opts });
}

export function formatPct(value: Num, dp = 2): string {
  return `${formatNumber(value, { dp })}٪`;
}

export function formatQty(value: Num, dp = 3): string {
  return formatNumber(value, { dp });
}

/** Short human size like ۱٫۲ میلیارد for dashboards. */
export function formatCompact(value: Num): string {
  const d = D(value);
  const a = d.abs();
  const units: [number, string][] = [
    [1e12, "هزار میلیارد"],
    [1e9, "میلیارد"],
    [1e6, "میلیون"],
    [1e3, "هزار"],
  ];
  for (const [n, label] of units) {
    if (a.gte(n)) return `${formatNumber(d.div(n), { dp: 1 })} ${label}`;
  }
  return formatNumber(d, { dp: 2 });
}

/** Mask the middle of a long string (IBAN, card, a token). */
export function maskMiddle(s: string | null | undefined, keep = 6): string {
  if (!s) return "";
  if (s.length <= keep * 2 + 3) return s;
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

/** Group IBAN or card numbers in blocks of 4 for reading. */
export function groupDigits(s: string | null | undefined, size = 4): string {
  if (!s) return "";
  return s.replace(/\s/g, "").replace(new RegExp(`(.{${size}})`, "g"), "$1 ").trim();
}

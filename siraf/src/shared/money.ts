// Exact decimal arithmetic for amounts, rates, weights and quantities.
// Amounts travel as strings (Postgres `numeric` → string) and are only turned into
// JS numbers for display. Never use floating point for money.
import Decimal from "decimal.js";

const Dec = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 60 });

export type Num = string | number | Decimal | null | undefined;
export { Dec as Decimal };

/** Parse anything number-like (including Persian/Arabic digits and thousands separators) to a Decimal. */
export function D(v: Num): Decimal {
  if (v === null || v === undefined || v === "") return new Dec(0);
  if (v instanceof Dec) return v as Decimal;
  if (typeof v === "number") return new Dec(Number.isFinite(v) ? v : 0);
  if (Decimal.isDecimal(v)) return new Dec((v as Decimal).toString());
  const s = normalizeDigits(String(v)).replace(/[,\s٬_]/g, "").replace(/٫/g, ".");
  if (s === "" || s === "-" || s === ".") return new Dec(0);
  try {
    return new Dec(s);
  } catch {
    return new Dec(0);
  }
}

/** Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export const ZERO = "0";

export function add(...xs: Num[]): string {
  return xs.reduce<Decimal>((a, x) => a.plus(D(x)), new Dec(0)).toString();
}
export function sub(a: Num, b: Num): string {
  return D(a).minus(D(b)).toString();
}
export function mul(a: Num, b: Num): string {
  return D(a).times(D(b)).toString();
}
export function div(a: Num, b: Num, dp = 12): string {
  const d = D(b);
  if (d.isZero()) return "0";
  return D(a).div(d).toDecimalPlaces(dp).toString();
}
export function neg(a: Num): string {
  return D(a).neg().toString();
}
export function abs(a: Num): string {
  return D(a).abs().toString();
}
/** Round to `dp` decimal places (half up). */
export function round(a: Num, dp = 0): string {
  return D(a).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toString();
}
export function cmp(a: Num, b: Num): number {
  return D(a).cmp(D(b));
}
export function eq(a: Num, b: Num): boolean {
  return D(a).eq(D(b));
}
export function isZero(a: Num): boolean {
  return D(a).isZero();
}
export function isNeg(a: Num): boolean {
  return D(a).isNeg() && !D(a).isZero();
}
export function isPos(a: Num): boolean {
  return D(a).gt(0);
}
export function max(a: Num, b: Num): string {
  return Decimal.max(D(a), D(b)).toString();
}
export function min(a: Num, b: Num): string {
  return Decimal.min(D(a), D(b)).toString();
}
export function sum<T>(items: T[], pick: (x: T) => Num): string {
  return items.reduce<Decimal>((a, x) => a.plus(D(pick(x))), new Dec(0)).toString();
}
/** percent of a value: pct(1000, 9) = 90 */
export function pct(a: Num, percent: Num, dp = 0): string {
  return D(a).times(D(percent)).div(100).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toString();
}
export function toNumber(a: Num): number {
  return D(a).toNumber();
}
/** Plain decimal string without trailing zeros and without exponent. */
export function clean(a: Num): string {
  return D(a).toFixed();
}
export function isNumeric(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  const s = normalizeDigits(String(v)).replace(/[,\s٬_]/g, "").replace(/٫/g, ".");
  return /^-?\d*(\.\d+)?$/.test(s) && s !== "-" && s !== "";
}

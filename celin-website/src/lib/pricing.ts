/**
 * Who pays what (client-safe; the database function celin_place_order applies the same rules, and orders are
 * never placed at prices other than these). The admin enters one price per piece — the wholesale price.
 *
 * - Visitors and signed-in accounts without membership see no prices and no stock.
 * - Members (an approved account that entered its membership code) see stock, and every price at the list
 *   price: `listPct` percent of the admin's price (200 = twice). The invoice then steps down by the number of
 *   pieces in the order: from 6 pieces 150%, from 11 130%, from 16 110%, from 24 the admin's price itself. The
 *   basket shows the lines at the list price and the step as «تخفیف تعداد».
 * - Pro accounts (automatic once their accepted orders in the last `proDays` days reach `proThreshold` Toman)
 *   always see and pay the admin's price.
 *
 * Percentages are whole numbers so the browser, the server and SQL round the same way: round(price × pct / 100).
 */

export type PriceLevel = "member" | "pro";

export interface PriceStep {
  /** from this many pieces in one order */
  min: number;
  /** percent of the admin's price */
  pct: number;
}

export interface Pricing {
  level: PriceLevel;
  /** what a single piece is shown at, in percent of the admin's price */
  listPct: number;
  /** lower percentages from a number of pieces up (ascending by `min`) */
  steps: PriceStep[];
}

export interface PricingSettings {
  memberPct: number;
  steps: PriceStep[];
}

export const DEFAULT_MEMBER_PCT = 200;
export const DEFAULT_STEPS: PriceStep[] = [
  { min: 6, pct: 150 },
  { min: 11, pct: 130 },
  { min: 16, pct: 110 },
  { min: 24, pct: 100 },
];
/** Toman of accepted orders within `DEFAULT_PRO_DAYS` days that makes an account Pro */
export const DEFAULT_PRO_THRESHOLD = 200_000_000;
export const DEFAULT_PRO_DAYS = 30;

export const MAX_PCT = 1000;

/** A clean ladder: whole numbers, at least 2 pieces, between 100% and the list percentage, sorted, each step lower than the one before. */
export function cleanSteps(input: unknown, listPct: number): PriceStep[] {
  if (!Array.isArray(input)) return [];
  const rows = input
    .map((r) => ({ min: Math.floor(Number((r as PriceStep)?.min)), pct: Math.floor(Number((r as PriceStep)?.pct)) }))
    .filter((r) => Number.isFinite(r.min) && Number.isFinite(r.pct) && r.min >= 2 && r.min <= 999 && r.pct >= 100 && r.pct < listPct)
    .sort((a, b) => a.min - b.min);
  const out: PriceStep[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && r.min === prev.min) continue;
    if (r.pct < (prev?.pct ?? listPct)) out.push(r);
  }
  return out;
}

export function cleanListPct(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 100 && n <= MAX_PCT ? n : DEFAULT_MEMBER_PCT;
}

/** The rules for a level: members get the list price and the steps, Pro the admin's price. */
export function pricingFor(level: PriceLevel, s: PricingSettings): Pricing {
  if (level === "pro") return { level, listPct: 100, steps: [] };
  const listPct = cleanListPct(s.memberPct);
  return { level, listPct, steps: cleanSteps(s.steps, listPct) };
}

/** round(price × pct / 100), in whole Toman. */
export function atPct(price: number, pct: number): number {
  return Math.round((price * pct) / 100);
}

/** What one piece is shown at. */
export function listPrice(price: number, p: Pricing): number {
  return atPct(price, p.listPct);
}

/** The percentage an order of this many pieces is invoiced at. */
export function pctFor(pieces: number, p: Pricing): number {
  let pct = p.listPct;
  for (const s of p.steps) if (pieces >= s.min && s.pct < pct) pct = s.pct;
  return pct;
}

/** The next step up from this many pieces (for «با n قطعه‌ی دیگر…»), or null at the last one. */
export function nextStep(pieces: number, p: Pricing): (PriceStep & { more: number }) | null {
  const s = p.steps.find((x) => x.min > pieces && x.pct < pctFor(pieces, p));
  return s ? { ...s, more: s.min - pieces } : null;
}

export interface InvoiceLine {
  /** the admin's price of one piece (null: on request — counts 0) */
  price: number | null;
  qty: number;
}

export interface Invoice {
  pieces: number;
  /** the lines at the list price */
  list: number;
  /** what is charged: every line at the step's percentage */
  total: number;
  /** list − total («تخفیف تعداد») */
  stepDiscount: number;
  pct: number;
}

/** The invoice of a basket: each line rounded per piece, exactly as celin_place_order does. */
export function invoice(lines: InvoiceLine[], p: Pricing): Invoice {
  const pieces = lines.reduce((n, l) => n + l.qty, 0);
  const pct = pctFor(pieces, p);
  let list = 0;
  let total = 0;
  for (const l of lines) {
    if (l.price === null) continue;
    list += atPct(l.price, p.listPct) * l.qty;
    total += atPct(l.price, pct) * l.qty;
  }
  return { pieces, list, total, stepDiscount: list - total, pct };
}

/** The `p_pricing` argument of celin_place_order. */
export function pricingArg(p: Pricing): { level: PriceLevel; list: number; steps: [number, number][] } {
  return { level: p.level, list: p.listPct, steps: p.steps.map((s) => [s.min, s.pct]) };
}

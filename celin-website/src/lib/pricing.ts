/**
 * Who pays what (client-safe; the database function celin_place_order applies the same rules, and orders are
 * never placed at prices other than these). The admin enters one price per piece — the wholesale price.
 *
 * - Visitors and signed-in accounts without membership see no prices and no stock.
 * - Members (an approved account that entered its membership code) see every price at the list price: `listPct`
 *   percent of the admin's price (200 = twice). The invoice then steps down by the number of pieces in the WHOLE
 *   order — every piece counts, whichever design or option it is: from 6 pieces 150%, from 11 130%, from 16 110%,
 *   from 24 the admin's price itself. The basket shows the lines at the list price and the step as «تخفیف تعداد»,
 *   with its percentage off the list price (`offPct`).
 * - Pro accounts (automatic once their accepted orders in the last `proDays` days reach `proThreshold` Toman)
 *   always see and pay the admin's price.
 * - The special-day discount (Settings → «نوار تخفیف روزهای خاص», src/lib/sale.ts) takes `sale.pct` percent off
 *   every piece after the step, for members and — when the admin allows it — Pro accounts, while it runs by the
 *   server's clock.
 *
 * Percentages are whole numbers so the browser, the server and SQL round the same way, once per piece:
 * round(price × pct / 100), or round(price × pct × (100 − sale) / 10000) with a sale.
 * The invoice reads: list → «تخفیف تعداد» (list − stepped) → the sale (stepped − total) → total.
 */

export type PriceLevel = "member" | "pro";

export interface PriceStep {
  /** from this many pieces in one order */
  min: number;
  /** percent of the admin's price */
  pct: number;
}

/** The special-day discount while it runs (src/lib/sale.ts liveSale). */
export interface SaleRule {
  /** percent off every piece after the quantity step, 1–90 */
  pct: number;
  /** the admin's title ("" = the site's own label, «تخفیف روزهای خاص») */
  title_fa: string;
  title_en: string;
  /** when it ends (ISO; the first moment after it), "" = until the admin switches it off — shown in the basket only */
  until: string;
}

export interface Pricing {
  level: PriceLevel;
  /** what a single piece is shown at, in percent of the admin's price */
  listPct: number;
  /** lower percentages from a number of pieces up (ascending by `min`) */
  steps: PriceStep[];
  /** the special-day discount on top of the step, or null */
  sale: SaleRule | null;
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

export const MAX_SALE_PCT = 90;

/** A sale percentage the database accepts (1–90), or 0. */
export function cleanSalePct(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= MAX_SALE_PCT ? n : 0;
}

/**
 * The rules for a level: members get the list price and the steps, Pro the admin's price; `sale` is the
 * special-day discount that applies to this level right now (liveSale), or null.
 */
export function pricingFor(level: PriceLevel, s: PricingSettings, sale: SaleRule | null = null): Pricing {
  const rule = sale && cleanSalePct(sale.pct) ? { ...sale, pct: cleanSalePct(sale.pct) } : null;
  if (level === "pro") return { level, listPct: 100, steps: [], sale: rule };
  const listPct = cleanListPct(s.memberPct);
  return { level, listPct, steps: cleanSteps(s.steps, listPct), sale: rule };
}

/** round(price × pct / 100), in whole Toman. */
export function atPct(price: number, pct: number): number {
  return Math.round((price * pct) / 100);
}

/**
 * What one piece is charged at: round(price × pct × (100 − sale) / 10000), one rounding per piece exactly like SQL
 * round(numeric) (half away from zero). BigInt, since 10¹³ Toman × 1000% × 100 is beyond 2⁵³.
 */
export function unitAt(price: number, pct: number, sale = 0): number {
  if (!sale) return atPct(price, pct);
  const n = BigInt(Math.round(price)) * BigInt(Math.round(pct)) * BigInt(100 - Math.round(sale));
  const half = n < 0n ? -5000n : 5000n;
  return Number((n + half) / 10000n);
}

/** The sale percentage of a price rule (0 without a sale). */
export const salePct = (p: Pick<Pricing, "sale">): number => p.sale?.pct ?? 0;

/**
 * How much less than the list price a step is, in whole percent, rounded down so we never promise more than the
 * invoice gives: 150 of 200 → 25, 130 → 35, 110 → 45, 100 → 50.
 */
export function offPct(listPct: number, pct: number): number {
  if (!Number.isFinite(listPct) || listPct <= 0 || !Number.isFinite(pct) || pct >= listPct) return 0;
  return Math.floor(((listPct - pct) * 100) / listPct);
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

/** The step an order reaches when it goes from `before` to `after` pieces (null when it stays on the same step or goes down). */
export function stepReached(before: number, after: number, p: Pricing): { pct: number; off: number } | null {
  const pct = pctFor(after, p);
  return pct < pctFor(before, p) ? { pct, off: offPct(p.listPct, pct) } : null;
}

export interface LadderRow {
  from: number;
  /** null: and more */
  to: number | null;
  pct: number;
  /** percent off the list price */
  off: number;
}

/** The whole ladder, from one piece up: the list price, then each step with its range and percentage off. */
export function ladder(p: Pricing): LadderRow[] {
  const steps = p.steps;
  if (!steps.length) return [{ from: 1, to: null, pct: p.listPct, off: 0 }];
  const rows: LadderRow[] = [{ from: 1, to: steps[0].min - 1, pct: p.listPct, off: 0 }];
  steps.forEach((s, i) => rows.push({ from: s.min, to: steps[i + 1] ? steps[i + 1].min - 1 : null, pct: s.pct, off: offPct(p.listPct, s.pct) }));
  return rows;
}

export interface InvoiceLine {
  /** the admin's price of one piece (null: on request — counts 0) */
  price: number | null;
  qty: number;
}

export interface Invoice {
  /** every piece of the order, whichever design or option */
  pieces: number;
  /** the lines at the list price */
  list: number;
  /** the lines at the step's percentage (before the special-day discount) */
  stepped: number;
  /** what is charged: every piece at the step, less the sale, rounded per piece */
  total: number;
  /** list − stepped («تخفیف تعداد») */
  stepDiscount: number;
  /** stepped − total (the special-day discount) */
  saleDiscount: number;
  /** the step's percentage of the admin's price */
  pct: number;
  /** the step in percent off the list price (offPct) */
  off: number;
  /** the special-day discount's percentage (0: none) */
  sale: number;
}

/** The invoice of a basket: each line rounded per piece, exactly as celin_place_order does. */
export function invoice(lines: InvoiceLine[], p: Pricing): Invoice {
  const pieces = lines.reduce((n, l) => n + l.qty, 0);
  const pct = pctFor(pieces, p);
  const sale = salePct(p);
  let list = 0;
  let stepped = 0;
  let total = 0;
  for (const l of lines) {
    if (l.price === null) continue;
    list += atPct(l.price, p.listPct) * l.qty;
    stepped += atPct(l.price, pct) * l.qty;
    total += unitAt(l.price, pct, sale) * l.qty;
  }
  return { pieces, list, stepped, total, stepDiscount: list - stepped, saleDiscount: stepped - total, pct, off: offPct(p.listPct, pct), sale };
}

/** The `p_pricing` argument of celin_place_order (with `sale` only while one applies). */
export function pricingArg(p: Pricing): { level: PriceLevel; list: number; steps: [number, number][]; sale?: { pct: number; fa: string; en: string } } {
  return {
    level: p.level,
    list: p.listPct,
    steps: p.steps.map((s) => [s.min, s.pct]),
    ...(p.sale ? { sale: { pct: p.sale.pct, fa: p.sale.title_fa.slice(0, 80), en: p.sale.title_en.slice(0, 80) } } : {}),
  };
}

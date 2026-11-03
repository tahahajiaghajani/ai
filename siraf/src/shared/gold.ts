// Gold market arithmetic (Iranian market conventions).
//
// - مثقال = 4.6083 g;  سوت = 0.001 g
// - مظنه = price of one mesghal of 705-fineness (17k) gold
// - one mesghal of 705 gold = 4.3318 g of 750 (18k) gold  →  gram18 = mazaneh / 4.3318
// - weight750 = weight × fineness / 750 (all gold balances are kept in 750-equivalent grams)
// - jewellery: gold value + wage (اجرت) + seller profit (سود) + VAT on (wage + profit) only
// - the Iranian «گرم ۲۴» is quoted on a 1000‰ basis: gram24 = gram18 × 1000 / 750
// - coins: intrinsic value on two bases (domestic: weight × fineness / 750 × gram18; world:
//   fine grams / 31.1034768 × ounce × USD) and the bubble (حباب) = price − intrinsic
// - bars: metal (fine content × gram24) + premium (حق ضرب / کارمزد) + optional profit; bought
//   back at the day rate minus a fee (sealed / opened) and an assay fee
//
// Everything here is pure (decimal.js, no floats) and shared by the server and the UI, so a
// price shown on a screen is the price that gets posted.
import { D, type Num } from "./money";

export const MESGHAL_GRAMS = "4.6083";
export const MAZANEH_FINENESS = 705;
export const STANDARD_FINENESS = 750;
export const GRAM18_PER_MAZANEH = "4.3318";
export const TROY_OUNCE_GRAMS = "31.1034768";
/** سوت: one thousandth of a gram (Parsian coins are sized in sut). */
export const SUT_GRAMS = "0.001";

export type WageType = "percent" | "per_gram" | "fixed";

type Dec = ReturnType<typeof D>;
const has = (v: Num) => v !== null && v !== undefined && v !== "";

export function gram18FromMazaneh(mazaneh: Num): string {
  return D(mazaneh).div(GRAM18_PER_MAZANEH).toDecimalPlaces(0).toString();
}

export function mazanehFromGram18(gram18: Num): string {
  return D(gram18).times(GRAM18_PER_MAZANEH).toDecimalPlaces(0).toString();
}

/** Price of one gram at a given fineness (per mille), from the 18k gram price. */
export function gramPriceAt(gram18: Num, fineness: Num = STANDARD_FINENESS): string {
  return D(gram18).times(D(fineness)).div(STANDARD_FINENESS).toString();
}

/** 24k gram (1000‰ basis) from the 18k gram. */
export function gram24FromGram18(gram18: Num): string {
  return D(gram18).times(1000).div(STANDARD_FINENESS).toDecimalPlaces(0).toString();
}

/** 750-equivalent weight. */
export function weight750(weight: Num, fineness: Num = STANDARD_FINENESS): string {
  return D(weight).times(D(fineness)).div(STANDARD_FINENESS).toDecimalPlaces(3).toString();
}

/** Pure (24k / 1000‰) gold content in grams, 4 decimals (a 999.9 gram bar holds 0.9999 g). */
export function pureWeight(weight: Num, fineness: Num): string {
  return D(weight).times(D(fineness)).div(1000).toDecimalPlaces(4).toString();
}

/** Karat (عیار قیراطی) → fineness per mille: 18 → 750. */
export function karatToFineness(karat: Num): string {
  return D(karat).times(1000).div(24).toDecimalPlaces(1).toString();
}
export function finenessToKarat(fineness: Num): string {
  return D(fineness).times(24).div(1000).toDecimalPlaces(2).toString();
}

/** 18k gram price implied by the world ounce price and a USD rate (no local bubble). */
export function gram18FromOunce(ounceUsd: Num, usdRate: Num): string {
  return D(ounceUsd).div(TROY_OUNCE_GRAMS).times(0.75).times(D(usdRate)).toDecimalPlaces(0).toString();
}

/** Rounds to a multiple of `step` (0 or less → whole units), half up. */
export function roundTo(v: Num, step: Num): string {
  const s = D(step);
  if (s.lte(0)) return D(v).toDecimalPlaces(0).toString();
  return D(v).div(s).toDecimalPlaces(0).times(s).toString();
}

function min(a: Dec, b: Dec) {
  return a.lt(b) ? a : b;
}

export interface JewelryPriceInput {
  weight: Num; // net gold weight (without stones)
  fineness?: Num; // default 750
  gram18: Num; // price of one 18k gram
  wageType: WageType;
  wageValue: Num; // percent, per-gram amount or fixed amount
  profitPct?: Num; // default 7
  taxPct?: Num; // VAT on wage + profit (1405: 10)
  stonePrice?: Num; // value of stones, added as is
  discount?: Num; // amount off the total before tax base? (applied to profit first)
  roundStep?: Num; // round final values, e.g. 1000 rials (0 = whole units)
}

export interface JewelryPrice {
  gramPrice: string;
  goldValue: string;
  wage: string;
  profit: string;
  taxBase: string;
  tax: string;
  stone: string;
  discount: string;
  total: string;
}

/**
 * Sale price of a piece of jewellery:
 * gold = weight × gram price; wage by type; profit = pct × (gold + wage);
 * tax = pct × (wage + profit − discount); total = gold + wage + profit − discount + tax + stones.
 * A discount reduces the seller's profit (and then the wage), never the gold value.
 */
export function priceJewelry(input: JewelryPriceInput): JewelryPrice {
  const fineness = input.fineness ?? STANDARD_FINENESS;
  const step = input.roundStep ?? 0;
  const gramPrice = D(gramPriceAt(input.gram18, fineness));
  const gold = D(input.weight).times(gramPrice);
  let wage: Dec;
  switch (input.wageType) {
    case "per_gram":
      wage = D(input.weight).times(D(input.wageValue));
      break;
    case "fixed":
      wage = D(input.wageValue);
      break;
    default:
      wage = gold.times(D(input.wageValue)).div(100);
  }
  const profit = gold.plus(wage).times(D(input.profitPct ?? 7)).div(100);
  const discount = min(D(input.discount ?? 0), wage.plus(profit));
  const taxBase = wage.plus(profit).minus(discount);
  const tax = taxBase.times(D(input.taxPct ?? 10)).div(100);
  const stone = D(input.stonePrice ?? 0);
  const r = (x: Num) => roundTo(x, step);
  const goldR = r(gold);
  const wageR = r(wage);
  const profitR = r(profit);
  // capped again after rounding: a rounded-up discount must not reach into the gold value
  const discountR = min(D(r(discount)), D(wageR).plus(profitR)).toString();
  const taxR = r(tax);
  const stoneR = r(stone);
  const total = D(goldR).plus(wageR).plus(profitR).minus(discountR).plus(taxR).plus(stoneR);
  return {
    gramPrice: gramPrice.toDecimalPlaces(0).toString(),
    goldValue: goldR,
    wage: wageR,
    profit: profitR,
    taxBase: r(taxBase),
    tax: taxR,
    stone: stoneR,
    discount: discountR,
    total: total.toString(),
  };
}

export interface OldGoldInput {
  weight: Num;
  fineness: Num;
  gram18: Num;
  deductionPct?: Num; // کسر کهنگی/ناخالصی
  roundStep?: Num;
}

/** Buying used gold from a customer: 750-equivalent weight × gram price − deduction. */
export function priceOldGold(input: OldGoldInput) {
  const w750 = D(weight750(input.weight, input.fineness));
  const gross = w750.times(D(input.gram18));
  const deduction = gross.times(D(input.deductionPct ?? 0)).div(100);
  const net = gross.minus(deduction);
  const step = input.roundStep ?? 0;
  return {
    weight750: w750.toString(),
    gross: roundTo(gross, step),
    deduction: roundTo(deduction, step),
    total: roundTo(net, step),
  };
}

/** Bullion (آبشده) value from the mazaneh: weight × fineness / 705 / 4.6083 × mazaneh. */
export function priceBullion(weight: Num, fineness: Num, mazaneh: Num, roundStep: Num = 0): string {
  const v = D(weight).times(D(fineness)).div(MAZANEH_FINENESS).div(MESGHAL_GRAMS).times(D(mazaneh));
  return roundTo(v, roundStep);
}

/** Weight that a budget buys at a given price (for «با این مبلغ چند گرم؟»). */
export function weightForBudget(budget: Num, input: Omit<JewelryPriceInput, "weight">): string {
  // total is linear in weight for percent/per_gram wages: total = w × unit + fixed parts
  const one = priceJewelry({ ...input, weight: 1, stonePrice: 0, discount: 0, roundStep: 0 });
  const zero = priceJewelry({ ...input, weight: 0, stonePrice: 0, discount: 0, roundStep: 0 });
  const perGram = D(one.total).minus(D(zero.total));
  if (perGram.lte(0)) return "0";
  return D(budget).minus(D(zero.total)).minus(D(input.stonePrice ?? 0)).div(perGram).toDecimalPlaces(3).toString();
}

// ---------------------------------------------------------------- VAT by date

/**
 * VAT on gold value-added (wage, profit, commission) by date: the VAT law's 9% until the end of
 * 1404 and 10% from 1405 (budget law). An organisation's own dated rates override this table.
 */
export interface VatPeriod {
  /** first day (ISO date) the rate applies */
  from: string;
  pct: string;
}

/** 1405-01-01: the 10% rate of the 1405 budget law. */
export const VAT_1405_FROM = "2026-03-21";
export const DEFAULT_VAT_HISTORY: VatPeriod[] = [{ from: "2021-03-21", pct: "9" }];

/**
 * VAT percent on a date: the organisation's dated rates if it has any, else 9% before 1405 and
 * the current rate (`current`, the organisation's VAT setting) from 1405 on.
 */
export function vatPctAt(date: string | null | undefined, current: Num, history?: VatPeriod[] | null): string {
  const d = (date ?? "").slice(0, 10);
  const own = (history ?? []).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.from) && has(p.pct)).sort((a, b) => a.from.localeCompare(b.from));
  if (own.length) {
    const hit = d ? [...own].reverse().find((p) => p.from <= d) : own[own.length - 1];
    return D((hit ?? own[0]).pct).toString();
  }
  if (d && d < VAT_1405_FROM) {
    const past = [...DEFAULT_VAT_HISTORY].reverse().find((p) => p.from <= d);
    if (past) return past.pct;
  }
  return D(has(current) ? current : 10).toString();
}

// ---------------------------------------------------------------- coins

/** Official specifications of coins: weight and fineness of one coin, tolerance, diameter. */
export interface CoinSpec {
  title: string;
  family: CoinFamily;
  /** grams per coin */
  weight: string;
  /** per mille */
  fineness: string;
  /** allowed deviation of the weight, as a fraction (0.0025 = 2.5‰) */
  tolerance: string | null;
  diameter: number | null;
}

export type CoinFamily = "bank" | "parsian" | "foreign" | "other";

/**
 * Bank coins of the Central Bank (900‰): the full coin's official weight is 8.13598 g (7.322382 g
 * fine); the half and quarter are exactly half and a quarter of it (4.06799 / 2.033995 g). The
 * market's «8.133» is a rounding. Parsian coins are 750 and sized in sut (50 … 2100).
 */
export const COIN_SPECS: Record<string, CoinSpec> = {
  full: { title: "تمام سکه بهار آزادی", family: "bank", weight: "8.13598", fineness: "900", tolerance: "0.0025", diameter: 22 },
  half: { title: "نیم سکه بهار آزادی", family: "bank", weight: "4.06799", fineness: "900", tolerance: "0.005", diameter: 19 },
  quarter: { title: "ربع سکه بهار آزادی", family: "bank", weight: "2.033995", fineness: "900", tolerance: "0.01", diameter: 16 },
  gram: { title: "سکه یک گرمی", family: "bank", weight: "1.01", fineness: "900", tolerance: null, diameter: 13.3 },
  two_half: { title: "دو و نیم سکه بهار آزادی", family: "bank", weight: "20.33995", fineness: "900", tolerance: "0.0025", diameter: 30 },
  five: { title: "پنج سکه بهار آزادی", family: "bank", weight: "40.6799", fineness: "900", tolerance: "0.002", diameter: 40 },
  pahlavi: { title: "یک پهلوی", family: "foreign", weight: "8.136", fineness: "900", tolerance: null, diameter: 22 },
  pahlavi_half: { title: "نیم پهلوی", family: "foreign", weight: "4.068", fineness: "900", tolerance: null, diameter: 19 },
  pahlavi_quarter: { title: "ربع پهلوی", family: "foreign", weight: "2.034", fineness: "900", tolerance: null, diameter: 16 },
  sovereign: { title: "لیره (ساورین)", family: "foreign", weight: "7.98805", fineness: "916.7", tolerance: null, diameter: 22.05 },
  parsian: { title: "سکه پارسیان", family: "parsian", weight: "0", fineness: "750", tolerance: null, diameter: null },
};

/** Parsian sizes in sut (a size's coin weighs sut / 1000 grams). */
export const PARSIAN_SIZES = [50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1500, 1600, 1800, 2000];

/** Gold content of `qty` coins of a weight and fineness: total, pure and 750-equivalent grams. */
export function coinContent(coinWeight: Num, fineness: Num, qty: Num = 1) {
  const w = D(coinWeight || 0).times(D(qty || 0));
  return { weight: w.toDecimalPlaces(4).toString(), pure: pureWeight(w, fineness || 0), weight750: weight750(w, fineness || 0) };
}

/** Whether a measured weight is outside a coin's tolerance (null when the spec has none). */
export function outOfTolerance(measured: Num, spec: { weight: Num; tolerance?: Num | null }): boolean | null {
  if (!has(spec.tolerance) || !has(measured) || D(spec.weight).lte(0)) return null;
  return D(measured).minus(D(spec.weight)).abs().gt(D(spec.weight).times(D(spec.tolerance)));
}

export interface IntrinsicRate {
  gram18?: Num;
  ounce_usd?: Num;
  usd?: Num;
}

/**
 * Intrinsic value of gold content on the two bases shops compare with: domestic (750-equivalent
 * grams × the board's 18k gram) and world parity (fine grams ÷ 31.1034768 × ounce × USD).
 */
export function intrinsicValue(weight: Num, fineness: Num, rate: IntrinsicRate) {
  const g18 = has(rate.gram18) && D(rate.gram18).gt(0) ? D(rate.gram18) : null;
  const ounce = has(rate.ounce_usd) && D(rate.ounce_usd).gt(0) ? D(rate.ounce_usd) : null;
  const usd = has(rate.usd) && D(rate.usd).gt(0) ? D(rate.usd) : null;
  const w750 = D(weight).times(D(fineness)).div(STANDARD_FINENESS);
  const pure = D(weight).times(D(fineness)).div(1000);
  return {
    domestic: g18 ? w750.times(g18).toDecimalPlaces(0).toString() : null,
    world: ounce && usd ? pure.div(TROY_OUNCE_GRAMS).times(ounce).times(usd).toDecimalPlaces(0).toString() : null,
  };
}

export interface Bubble {
  intrinsic: string;
  amount: string;
  /** percent of the intrinsic value, 2 decimals */
  pct: string;
}

/** Bubble (حباب) of a price over an intrinsic value. */
export function bubbleOf(price: Num, intrinsic: Num | null | undefined): Bubble | null {
  if (!has(price) || !has(intrinsic) || D(intrinsic!).lte(0) || D(price).lte(0)) return null;
  const amount = D(price).minus(D(intrinsic!));
  return { intrinsic: D(intrinsic!).toString(), amount: amount.toString(), pct: amount.div(D(intrinsic!)).times(100).toDecimalPlaces(2).toString() };
}

export interface CoinBubble {
  domestic: Bubble | null;
  world: Bubble | null;
}

/** Bubble of one coin's price on both bases. */
export function coinBubble(coin: { weight: Num; fineness: Num }, price: Num, rate: IntrinsicRate): CoinBubble {
  const v = intrinsicValue(coin.weight, coin.fineness, rate);
  return { domestic: bubbleOf(price, v.domestic), world: bubbleOf(price, v.world) };
}

export type CoinPricingMode = "board" | "weight" | "manual";
/** VAT treatment: exempt; on wage + profit (jewellery, Parsian); on the margin over cost; on the whole price. */
export type VatMode = "exempt" | "wage_profit" | "margin" | "full";

export interface CoinPriceInput {
  /** sell: we sell (sale); buy: we buy (purchase, buy-back, trade-in) */
  side: "sell" | "buy";
  mode: CoinPricingMode;
  qty: Num;
  /** board / manual: the price of one coin (sell or buy) */
  unitPrice?: Num;
  /** grams of one coin and its fineness */
  coinWeight: Num;
  fineness: Num;
  /** weight mode: the 18k gram price (sell) or the buy price of an 18k gram (buy) */
  gram18?: Num;
  /** weight mode: wage (sell: making charge; buy: a wholesaler's wage) */
  wageType?: WageType | string | null;
  wageValue?: Num;
  /** weight mode, sell: seller profit (percent of gold + wage) */
  profitPct?: Num;
  vatMode?: VatMode;
  taxPct?: Num;
  /** margin VAT: cost of one coin */
  unitCost?: Num;
  /** sell: discount; buy: deduction for the coin's condition */
  discount?: Num;
  roundStep?: Num;
}

export interface CoinPrice {
  unit: string;
  weight: string;
  weight750: string;
  pure: string;
  gold_value: string;
  wage: string;
  profit: string;
  discount: string;
  tax: string;
  total: string;
}

function wageOf(type: string | null | undefined, value: Num, weight: Dec, gold: Dec): Dec {
  if (type === "per_gram") return weight.times(D(value || 0));
  if (type === "fixed") return D(value || 0);
  return gold.times(D(value || 0)).div(100);
}

function taxOf(mode: VatMode | undefined, pct: Num, parts: { wage: Dec; profit: Dec; discount: Dec; value: Dec; margin: Dec }): Dec {
  const rate = D(pct || 0).div(100);
  switch (mode) {
    case "wage_profit":
      return Decimal_max0(parts.wage.plus(parts.profit).minus(parts.discount)).times(rate);
    case "margin":
      return Decimal_max0(parts.margin).times(rate);
    case "full":
      return Decimal_max0(parts.value.plus(parts.wage).plus(parts.profit).minus(parts.discount)).times(rate);
    default:
      return D(0);
  }
}

function Decimal_max0(x: Dec): Dec {
  return x.isNeg() ? D(0) : x;
}

/**
 * Price of coin lines in their pricing mode:
 * - board / manual: qty × the price of one coin; a sale discount comes off it; VAT by the coin's
 *   VAT mode (exempt for bank coins; margin = rate × (price − cost); full = on the whole price);
 * - weight (Parsian, foreign): the jewellery formula on the coins' gold weight — gold value at the
 *   18k gram price + wage + profit + VAT on wage and profit; buying: gold value at the buy price
 *   (+ a wholesaler's wage);
 * - buying: the deduction for the coin's condition comes off the total.
 */
export function priceCoin(input: CoinPriceInput): CoinPrice {
  const step = input.roundStep ?? 0;
  const r = (x: Num) => roundTo(x, step);
  const qty = D(input.qty || 0);
  const content = coinContent(input.coinWeight, input.fineness, qty);
  const w = D(content.weight);
  const base = { weight: content.weight, weight750: content.weight750, pure: content.pure };
  if (input.mode === "weight") {
    const g18 = D(input.gram18 || 0);
    if (input.side === "sell") {
      const p = priceJewelry({
        weight: w, fineness: input.fineness, gram18: g18, wageType: (input.wageType || "percent") as WageType, wageValue: input.wageValue ?? 0,
        profitPct: input.profitPct ?? 0, taxPct: 0, discount: input.discount ?? 0, roundStep: step,
      });
      const tax = r(taxOf(input.vatMode ?? "wage_profit", input.taxPct ?? 0, {
        wage: D(p.wage), profit: D(p.profit), discount: D(p.discount), value: D(p.goldValue), margin: D(0),
      }));
      const total = D(p.goldValue).plus(p.wage).plus(p.profit).minus(p.discount).plus(tax);
      return { ...base, unit: qty.isZero() ? "0" : total.div(qty).toDecimalPlaces(0).toString(), gold_value: p.goldValue, wage: p.wage, profit: p.profit, discount: p.discount, tax, total: total.toString() };
    }
    const gold = D(r(w.times(D(gramPriceAt(g18, input.fineness)))));
    const wage = D(r(wageOf(input.wageType, input.wageValue ?? 0, w, gold)));
    const gross = gold.plus(wage);
    const ded = min(D(r(input.discount ?? 0)), gross);
    const total = gross.minus(ded);
    return { ...base, unit: qty.isZero() ? "0" : gross.div(qty).toDecimalPlaces(0).toString(), gold_value: gold.toString(), wage: wage.toString(), profit: "0", discount: ded.toString(), tax: "0", total: total.toString() };
  }
  const unit = D(input.unitPrice || 0);
  const value = D(r(qty.times(unit)));
  const disc = min(D(r(input.discount ?? 0)), value);
  if (input.side === "buy") {
    return { ...base, unit: unit.toString(), gold_value: value.toString(), wage: "0", profit: "0", discount: disc.toString(), tax: "0", total: value.minus(disc).toString() };
  }
  const margin = value.minus(disc).minus(qty.times(D(input.unitCost || 0)));
  const tax = D(r(taxOf(input.vatMode ?? "exempt", input.taxPct ?? 0, { wage: D(0), profit: D(0), discount: disc, value, margin })));
  return { ...base, unit: unit.toString(), gold_value: value.toString(), wage: "0", profit: "0", discount: disc.toString(), tax: tax.toString(), total: value.minus(disc).plus(tax).toString() };
}

// ---------------------------------------------------------------- bars

export type BarPremiumType = "pct" | "per_gram" | "per_bar";
export type BarBasis = "actual" | "nominal";

/** A default premium by weight band: up to `max` grams (null = no limit) the premium is `pct` percent. */
export interface PremiumBand {
  max: string | null;
  pct: string;
}

export const DEFAULT_PREMIUM_BANDS: PremiumBand[] = [
  { max: "10", pct: "5" },
  { max: "100", pct: "3" },
  { max: null, pct: "1.25" },
];

/** The band premium (percent) of a bar weight. */
export function bandPremium(weight: Num, bands: PremiumBand[] = DEFAULT_PREMIUM_BANDS): string {
  const w = D(weight || 0);
  const sorted = [...bands].sort((a, b) => (a.max === null ? 1 : b.max === null ? -1 : D(a.max).cmp(D(b.max))));
  const hit = sorted.find((b) => b.max === null || w.lte(D(b.max)));
  return hit ? D(hit.pct).toString() : "0";
}

/** The fineness a bar's metal is priced at: its own, or full 1000‰ for 999+ bars on the nominal basis. */
export function barPricingFineness(fineness: Num, basis: BarBasis = "actual"): string {
  return basis === "nominal" && D(fineness || 0).gte(999) ? "1000" : D(fineness || 0).toString();
}

export interface BarPriceInput {
  weight: Num;
  fineness: Num;
  /** 18k gram price; the metal is priced at gram24 = gram18 × 1000 / 750 */
  gram18: Num;
  basis?: BarBasis;
  premiumType?: BarPremiumType | null;
  premiumValue?: Num;
  profitPct?: Num;
  vatMode?: VatMode;
  taxPct?: Num;
  discount?: Num;
  /** a fixed price for the bar (board or manual) instead of metal + premium */
  unitPrice?: Num;
  /** margin VAT: the bar's own cost */
  unitCost?: Num;
  roundStep?: Num;
}

export interface BarPrice {
  gram24: string;
  fine: string;
  weight750: string;
  metal: string;
  premium: string;
  profit: string;
  discount: string;
  tax: string;
  total: string;
}

/**
 * Sale price of a bar: metal = weight × fineness / 1000 × gram24 (or full 24k for a 999.9 bar on
 * the nominal basis) + premium (percent of the metal, per gram or per bar) + profit (percent of
 * metal + premium). A discount comes off the profit and the premium, never the metal. VAT by the
 * bar's VAT mode (bars are exempt under Art. 9; premium and profit can be taxed).
 */
export function priceBar(input: BarPriceInput): BarPrice {
  const step = input.roundStep ?? 0;
  const r = (x: Num) => roundTo(x, step);
  const g24 = D(gram24FromGram18(input.gram18 || 0));
  const w = D(input.weight || 0);
  const fine = pureWeight(w, input.fineness || 0);
  const w750 = weight750(w, input.fineness || 0);
  if (has(input.unitPrice) && D(input.unitPrice!).gt(0)) {
    const value = D(r(input.unitPrice!));
    const disc = min(D(r(input.discount ?? 0)), value);
    // VAT by the mode on the fixed price: the part above the metal value stands for the premium
    const metalPart = g24.gt(0) ? min(value, D(r(w.times(D(barPricingFineness(input.fineness, input.basis))).div(1000).times(g24)))) : value;
    const tax = D(r(taxOf(input.vatMode ?? "exempt", input.taxPct ?? 0, {
      wage: value.minus(metalPart), profit: D(0), discount: disc, value: metalPart, margin: value.minus(disc).minus(D(input.unitCost || 0)),
    })));
    return { gram24: g24.toString(), fine, weight750: w750, metal: value.toString(), premium: "0", profit: "0", discount: disc.toString(), tax: tax.toString(), total: value.minus(disc).plus(tax).toString() };
  }
  const metal = D(r(w.times(D(barPricingFineness(input.fineness, input.basis))).div(1000).times(g24)));
  const pv = D(input.premiumValue ?? 0);
  const premium = D(r(input.premiumType === "per_gram" ? w.times(pv) : input.premiumType === "per_bar" ? pv : metal.times(pv).div(100)));
  const profit = D(r(metal.plus(premium).times(D(input.profitPct ?? 0)).div(100)));
  const disc = min(D(r(input.discount ?? 0)), premium.plus(profit));
  const margin = metal.plus(premium).plus(profit).minus(disc).minus(D(input.unitCost || 0));
  const tax = D(r(taxOf(input.vatMode ?? "exempt", input.taxPct ?? 0, { wage: premium, profit, discount: disc, value: metal, margin })));
  const total = metal.plus(premium).plus(profit).minus(disc).plus(tax);
  return { gram24: g24.toString(), fine, weight750: w750, metal: metal.toString(), premium: premium.toString(), profit: profit.toString(), discount: disc.toString(), tax: tax.toString(), total: total.toString() };
}

export interface BarBuybackInput {
  weight: Num;
  fineness: Num;
  /** buy price of an 18k gram (the board's gram18 when there is no separate buy price) */
  gram18: Num;
  /** seal (blister, card) intact */
  sealed: boolean;
  feeSealedPct?: Num;
  feeOpenedPct?: Num;
  /** lab fee for an opened bar */
  assayFee?: Num;
  /** an opened bar is bought at no more than this fineness (995) */
  openedFineness?: Num;
  /** deduction for damage, with a reason on the document */
  deduction?: Num;
  /** a fixed buy price for the bar (the board's buy price): it is net — no fee and no fineness cap */
  unitPrice?: Num;
  roundStep?: Num;
}

export interface BarBuyback {
  fineness: string;
  metal: string;
  fee: string;
  assay_fee: string;
  deduction: string;
  total: string;
}

/**
 * Buying a bar back: metal at the day rate − a fee (smaller for a sealed bar); an opened bar is
 * priced at no more than 995 and the assay fee comes off. A fixed buy price (the board's) is net:
 * only the assay fee of an opened bar and a deduction come off it. The premium paid when it was
 * bought is not recovered.
 */
export function buybackBar(input: BarBuybackInput): BarBuyback {
  const step = input.roundStep ?? 0;
  const r = (x: Num) => roundTo(x, step);
  const opened = !input.sealed;
  const fixed = has(input.unitPrice) && D(input.unitPrice!).gt(0);
  const fin = !fixed && opened && has(input.openedFineness) ? min(D(input.fineness || 0), D(input.openedFineness!)) : D(input.fineness || 0);
  const g24 = D(gram24FromGram18(input.gram18 || 0));
  const metal = D(r(fixed ? D(input.unitPrice!) : D(input.weight || 0).times(fin).div(1000).times(g24)));
  // a fixed buy price already is what we pay for the bar: the fee is not taken a second time
  const fee = fixed ? D(0) : D(r(metal.times(D((opened ? input.feeOpenedPct : input.feeSealedPct) ?? 0)).div(100)));
  const assay = D(r(opened ? input.assayFee ?? 0 : 0));
  const ded = D(r(input.deduction ?? 0));
  let total = metal.minus(fee).minus(assay).minus(ded);
  if (total.isNeg()) total = D(0);
  return { fineness: fin.toString(), metal: metal.toString(), fee: fee.toString(), assay_fee: assay.toString(), deduction: ded.toString(), total: total.toString() };
}

// ---------------------------------------------------------------- quotes (with a breakdown)

export interface QuoteLine {
  key: string;
  label: string;
  amount: string;
}

export interface Quote {
  product: "coin" | "bar" | "parsian" | "bullion" | "jewelry";
  side: "sell" | "buy";
  total: string;
  breakdown: QuoteLine[];
  /** grams: total, pure and 750-equivalent */
  weight: string;
  pure: string;
  weight750: string;
  /** coins: bubble over the intrinsic value on both bases */
  bubble?: CoinBubble | null;
}

const line = (key: string, label: string, amount: Num): QuoteLine => ({ key, label, amount: D(amount || 0).toString() });

/** Quote coins (board, weight or manual pricing) with the breakdown and the bubble of one coin. */
export function quoteCoin(input: CoinPriceInput & { rate?: IntrinsicRate }): Quote {
  const p = priceCoin(input);
  const breakdown = [line("gold_value", input.mode === "weight" ? "ارزش طلا" : "بهای سکه", p.gold_value)];
  if (!D(p.wage).isZero()) breakdown.push(line("wage", "اجرت", p.wage));
  if (!D(p.profit).isZero()) breakdown.push(line("profit", "سود فروشنده", p.profit));
  if (!D(p.discount).isZero()) breakdown.push(line("discount", input.side === "sell" ? "تخفیف" : "کسر بابت وضعیت", D(p.discount).neg()));
  if (!D(p.tax).isZero()) breakdown.push(line("tax", "مالیات بر ارزش افزوده", p.tax));
  const qty = D(input.qty || 0);
  const unitPrice = input.mode === "weight" ? (qty.isZero() ? D(0) : D(p.total).div(qty)) : D(input.unitPrice || 0);
  const bubble = input.rate && unitPrice.gt(0) ? coinBubble({ weight: input.coinWeight, fineness: input.fineness }, unitPrice.toDecimalPlaces(0), input.rate) : null;
  return { product: input.mode === "weight" && D(input.fineness).eq(750) ? "parsian" : "coin", side: input.side, total: p.total, breakdown, weight: p.weight, pure: p.pure, weight750: p.weight750, bubble };
}

/** Quote a Parsian coin (or several) of a size in sut: the jewellery formula on its weight. */
export function quoteParsian(input: { sut: Num; qty?: Num; gram18: Num; wageType?: WageType; wageValue?: Num; profitPct?: Num; taxPct?: Num; vatMode?: VatMode; roundStep?: Num }): Quote {
  return quoteCoin({
    side: "sell", mode: "weight", qty: input.qty ?? 1, coinWeight: D(input.sut || 0).times(SUT_GRAMS).toString(), fineness: "750", gram18: input.gram18,
    wageType: input.wageType ?? "percent", wageValue: input.wageValue ?? 0, profitPct: input.profitPct ?? 0, taxPct: input.taxPct ?? 0,
    vatMode: input.vatMode ?? "wage_profit", roundStep: input.roundStep,
  });
}

/** Quote a bar for sale (metal + premium + profit + VAT) or for buy-back (metal − fees). */
export function quoteBar(input: (BarPriceInput & { side?: "sell" }) | (BarBuybackInput & { side: "buy" })): Quote {
  const w = input.weight;
  const fin = input.fineness;
  if (input.side === "buy") {
    const b = buybackBar(input);
    const breakdown = [line("metal", `ارزش طلا (عیار ${D(b.fineness).toString()})`, b.metal)];
    if (!D(b.fee).isZero()) breakdown.push(line("fee", "کارمزد خرید", D(b.fee).neg()));
    if (!D(b.assay_fee).isZero()) breakdown.push(line("assay_fee", "هزینه‌ی ری‌گیری", D(b.assay_fee).neg()));
    if (!D(b.deduction).isZero()) breakdown.push(line("deduction", "کسر بابت وضعیت", D(b.deduction).neg()));
    return { product: "bar", side: "buy", total: b.total, breakdown, weight: D(w || 0).toString(), pure: pureWeight(w || 0, fin || 0), weight750: weight750(w || 0, fin || 0) };
  }
  const p = priceBar(input);
  const breakdown = [line("metal", "ارزش طلا", p.metal)];
  if (!D(p.premium).isZero()) breakdown.push(line("premium", "حق ضرب / کارمزد", p.premium));
  if (!D(p.profit).isZero()) breakdown.push(line("profit", "سود فروشنده", p.profit));
  if (!D(p.discount).isZero()) breakdown.push(line("discount", "تخفیف", D(p.discount).neg()));
  if (!D(p.tax).isZero()) breakdown.push(line("tax", "مالیات بر ارزش افزوده", p.tax));
  return { product: "bar", side: "sell", total: p.total, breakdown, weight: D(w || 0).toString(), pure: p.fine, weight750: p.weight750 };
}

/** Quote آب‌شده by the mazaneh (selling) or at a buy price per 18k gram (buying). */
export function quoteBullion(input: { weight: Num; fineness: Num; mazaneh?: Num; buyGram18?: Num; deductionPct?: Num; roundStep?: Num }): Quote {
  const w = input.weight;
  const fin = input.fineness;
  if (has(input.buyGram18)) {
    const o = priceOldGold({ weight: w, fineness: fin, gram18: input.buyGram18!, deductionPct: input.deductionPct ?? 0, roundStep: input.roundStep });
    const breakdown = [line("gold_value", "ارزش طلا", o.gross)];
    if (!D(o.deduction).isZero()) breakdown.push(line("deduction", "کسر", D(o.deduction).neg()));
    return { product: "bullion", side: "buy", total: o.total, breakdown, weight: D(w || 0).toString(), pure: pureWeight(w || 0, fin || 0), weight750: o.weight750 };
  }
  const total = priceBullion(w, fin, input.mazaneh ?? 0, input.roundStep ?? 0);
  return { product: "bullion", side: "sell", total, breakdown: [line("gold_value", "ارزش آب‌شده (با مظنه)", total)], weight: D(w || 0).toString(), pure: pureWeight(w || 0, fin || 0), weight750: weight750(w || 0, fin || 0) };
}

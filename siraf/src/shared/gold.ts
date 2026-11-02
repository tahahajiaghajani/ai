// Gold market arithmetic (Iranian market conventions).
//
// - مثقال = 4.6083 g;  سوت = 0.001 g
// - مظنه = price of one mesghal of 705-fineness (17k) gold
// - one mesghal of 705 gold = 4.3318 g of 750 (18k) gold  →  gram18 = mazaneh / 4.3318
// - weight750 = weight × fineness / 750 (all gold balances are kept in 750-equivalent grams)
// - jewellery: gold value + wage (اجرت) + seller profit (سود) + VAT on (wage + profit) only
import { D, type Num } from "./money";

export const MESGHAL_GRAMS = "4.6083";
export const MAZANEH_FINENESS = 705;
export const STANDARD_FINENESS = 750;
export const GRAM18_PER_MAZANEH = "4.3318";
export const TROY_OUNCE_GRAMS = "31.1034768";

export type WageType = "percent" | "per_gram" | "fixed";

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

/** 750-equivalent weight. */
export function weight750(weight: Num, fineness: Num = STANDARD_FINENESS): string {
  return D(weight).times(D(fineness)).div(STANDARD_FINENESS).toDecimalPlaces(3).toString();
}

/** Pure (24k/1000) gold content in grams. */
export function pureWeight(weight: Num, fineness: Num): string {
  return D(weight).times(D(fineness)).div(1000).toDecimalPlaces(3).toString();
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

function roundTo(v: Num, step: Num): string {
  const s = D(step);
  if (s.lte(0)) return D(v).toDecimalPlaces(0).toString();
  return D(v).div(s).toDecimalPlaces(0).times(s).toString();
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
  let wage: ReturnType<typeof D>;
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
  const discount = Decimal_min(D(input.discount ?? 0), wage.plus(profit));
  const taxBase = wage.plus(profit).minus(discount);
  const tax = taxBase.times(D(input.taxPct ?? 10)).div(100);
  const stone = D(input.stonePrice ?? 0);
  const r = (x: Num) => roundTo(x, step);
  const goldR = r(gold);
  const wageR = r(wage);
  const profitR = r(profit);
  const discountR = r(discount);
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

function Decimal_min(a: ReturnType<typeof D>, b: ReturnType<typeof D>) {
  return a.lt(b) ? a : b;
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

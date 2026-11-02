// Pure arithmetic of gold documents: the document kinds and their rules, the price of every
// line kind and the document totals. It has no server imports on purpose — the API prices and
// posts documents with it and the UI runs the very same code for the live totals of the
// counter screen, so a preview always equals what gets posted.
import { D, type Num } from "@shared/money";
import {
  gram18FromMazaneh, gramPriceAt, mazanehFromGram18, priceBullion, priceJewelry, priceOldGold, weight750, STANDARD_FINENESS, type WageType,
} from "@shared/gold";

export const DOC_KINDS = ["sale", "purchase", "buyback", "consign_in", "consign_return", "workshop_out", "workshop_in", "melt", "bullion_sale", "opening"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type LineKind = "piece" | "bulk" | "old" | "coin";
export type Direction = "out" | "in";
export type BulkForm = "bullion" | "old" | "scrap";
export type SettleMode = "rial" | "weight";

export interface KindRule {
  title: string;
  /** line kinds allowed per direction */
  lines: { out: LineKind[]; in: LineKind[] };
  party: "required" | "optional" | "none";
  partyLabel: string;
  /** role filter of the party picker */
  partyRole?: string;
  /** market price the document is priced with ("optional": only some lines need it) */
  price: "gram18" | "mazaneh" | "optional" | "none";
  /** rial settlement: the party pays us (receive) or we pay the party (pay) */
  cash: "receive" | "pay" | "none";
  /** the party can be settled in rial or by weight (طلا به طلا) */
  modes?: boolean;
}

export const KINDS: Record<DocKind, KindRule> = {
  sale: { title: "فروش طلا", lines: { out: ["piece", "bulk", "coin"], in: ["old"] }, party: "optional", partyLabel: "مشتری", partyRole: "customer", price: "gram18", cash: "receive" },
  purchase: { title: "خرید از همکار / بنکدار", lines: { out: [], in: ["piece", "bulk", "coin"] }, party: "required", partyLabel: "همکار / بنکدار", price: "gram18", cash: "pay", modes: true },
  buyback: { title: "خرید طلای مستعمل", lines: { out: [], in: ["old"] }, party: "optional", partyLabel: "فروشنده‌ی طلا (مشتری)", partyRole: "customer", price: "gram18", cash: "pay" },
  consign_in: { title: "ورود امانی", lines: { out: [], in: ["piece"] }, party: "required", partyLabel: "امانت‌گذار (همکار)", price: "optional", cash: "none", modes: true },
  consign_return: { title: "برگشت امانی", lines: { out: ["piece"], in: [] }, party: "required", partyLabel: "امانت‌گذار (همکار)", price: "none", cash: "none" },
  workshop_out: { title: "ارسال طلا به کارگاه", lines: { out: ["bulk"], in: [] }, party: "required", partyLabel: "کارگاه / سازنده", partyRole: "workshop", price: "none", cash: "none" },
  workshop_in: { title: "دریافت مصنوعات از کارگاه", lines: { out: [], in: ["piece", "bulk"] }, party: "required", partyLabel: "کارگاه / سازنده", partyRole: "workshop", price: "optional", cash: "pay" },
  melt: { title: "ذوب و ری‌گیری", lines: { out: ["bulk", "piece"], in: ["bulk"] }, party: "optional", partyLabel: "ذوب‌کار / آزمایشگاه", price: "none", cash: "none" },
  bullion_sale: { title: "فروش آبشده", lines: { out: ["bulk"], in: [] }, party: "optional", partyLabel: "خریدار (همکار / بنکدار)", partyRole: "wholesaler", price: "mazaneh", cash: "receive", modes: true },
  opening: { title: "موجودی اول دوره", lines: { out: [], in: ["piece", "bulk", "coin"] }, party: "none", partyLabel: "", price: "optional", cash: "none" },
};

export const LINE_KIND_TITLES: Record<LineKind, string> = { piece: "جنس (اتیکت)", bulk: "طلای وزنی", old: "طلای مستعمل", coin: "سکه" };
export const FORM_TITLES: Record<BulkForm, string> = { bullion: "آبشده / شمش", old: "مستعمل", scrap: "شکسته / قراضه" };
export const WAGE_TYPE_TITLES: Record<WageType, string> = { percent: "درصد", per_gram: "هر گرم", fixed: "ثابت" };

/** Inventory account (system key) of weighed gold by its form. */
export function bulkAccountKey(form: string | null | undefined): "gold_bullion" | "gold_old" {
  return form === "bullion" ? "gold_bullion" : "gold_old";
}

/** Rounds to a multiple of `step` (0 or less → whole units), half up. */
export function roundTo(v: Num, step: Num): string {
  const s = D(step);
  if (s.lte(0)) return D(v).toDecimalPlaces(0).toString();
  return D(v).div(s).toDecimalPlaces(0).times(s).toString();
}

const has = (v: Num) => v !== null && v !== undefined && v !== "";

export interface LineIn {
  kind: LineKind;
  direction: Direction;
  form?: string | null;
  qty?: Num;
  fineness?: Num;
  /** net gold weight in grams (pieces: without stones) */
  weight?: Num;
  /** 18k gram price of this line (default: the document's); coins: price of one coin */
  gram_price?: Num;
  wage_type?: string | null;
  wage_value?: Num;
  profit_pct?: Num;
  /** value of stones (rial) */
  stone?: Num;
  /** sale: discount amount */
  discount?: Num;
  /** used gold: deduction percent (کسر کهنگی/ناخالصی) */
  deduction_pct?: Num;
  /** opening stock: cost of the line */
  cost?: Num;
}

export interface PricedLine {
  qty: string;
  fineness: string;
  weight: string;
  weight750: string;
  gram_price: string | null;
  gold_value: string;
  wage: string;
  profit_pct: string | null;
  profit: string;
  tax: string;
  stone: string;
  /** sale: discount; used gold: the deduction amount */
  discount: string;
  deduction_pct: string | null;
  total: string;
}

export interface PriceEnv {
  /** 18k gram price of the document */
  gram18: Num;
  mazaneh?: Num;
  /** default seller profit (sale) */
  profitPct: Num;
  /** VAT on wage + profit (sale) */
  taxPct: Num;
  /** VAT on the wage of a purchase (input VAT, usually 0) */
  purchaseTaxPct?: Num;
  /** default deduction of used gold */
  deductionPct: Num;
  roundStep: Num;
}

export function defaultFineness(kind: LineKind): string {
  return kind === "coin" ? "900" : String(STANDARD_FINENESS);
}

function wageAmount(type: string | null | undefined, value: Num, weight: Num, gold: Num, step: Num): string {
  switch (type) {
    case "per_gram":
      return roundTo(D(weight).times(D(value)), step);
    case "fixed":
      return roundTo(D(value), step);
    default:
      return roundTo(D(gold).times(D(value)).div(100), step);
  }
}

/** Price of one document line. Values are decimal strings rounded to the round step. */
export function priceLine(docKind: DocKind, line: LineIn, env: PriceEnv): PricedLine {
  const step = env.roundStep;
  const fin = has(line.fineness) ? D(line.fineness) : D(defaultFineness(line.kind));
  const w = D(line.weight ?? 0);
  const w750 = weight750(w, fin);
  const g18 = line.kind !== "coin" && has(line.gram_price) && !D(line.gram_price).isZero() ? D(line.gram_price) : D(env.gram18);
  const base: PricedLine = {
    qty: D(line.qty ?? (line.kind === "coin" ? 0 : 1)).toString(),
    fineness: fin.toString(),
    weight: w.toDecimalPlaces(3).toString(),
    weight750: w750,
    gram_price: null,
    gold_value: "0",
    wage: "0",
    profit_pct: null,
    profit: "0",
    tax: "0",
    stone: "0",
    discount: "0",
    deduction_pct: null,
    total: "0",
  };

  if (line.kind === "coin") {
    const qty = D(line.qty ?? 0);
    const unit = D(line.gram_price ?? 0);
    const value = roundTo(qty.times(unit), step);
    if (docKind === "sale") {
      const disc = D(roundTo(D(line.discount ?? 0), step));
      const discount = disc.gt(D(value)) ? D(value) : disc;
      return { ...base, gram_price: unit.toString(), gold_value: value, discount: discount.toString(), total: D(value).minus(discount).toString() };
    }
    if (docKind === "opening" && has(line.cost)) {
      const cost = roundTo(D(line.cost), step);
      return { ...base, gram_price: qty.isZero() ? unit.toString() : D(cost).div(qty).toDecimalPlaces(2).toString(), gold_value: cost, total: cost };
    }
    if (docKind === "purchase" || docKind === "opening") return { ...base, gram_price: unit.toString(), gold_value: value, total: value };
    return base;
  }

  if (line.kind === "old") {
    const ded = has(line.deduction_pct) ? D(line.deduction_pct) : D(env.deductionPct);
    const p = priceOldGold({ weight: w, fineness: fin, gram18: g18, deductionPct: ded, roundStep: step });
    return { ...base, weight750: p.weight750, gram_price: g18.toString(), gold_value: p.gross, discount: p.deduction, deduction_pct: ded.toString(), total: p.total };
  }

  switch (docKind) {
    case "sale": {
      const piece = line.kind === "piece";
      const profitPct = has(line.profit_pct) ? D(line.profit_pct) : piece ? D(env.profitPct) : D(0);
      const p = priceJewelry({
        weight: w,
        fineness: fin,
        gram18: g18,
        wageType: (line.wage_type || (piece ? "percent" : "fixed")) as WageType,
        wageValue: line.wage_value ?? 0,
        profitPct,
        taxPct: env.taxPct,
        stonePrice: line.stone ?? 0,
        discount: line.discount ?? 0,
        roundStep: step,
      });
      return {
        ...base, gram_price: g18.toString(), gold_value: p.goldValue, wage: p.wage, profit_pct: profitPct.toString(), profit: p.profit,
        tax: p.tax, stone: p.stone, discount: p.discount, total: p.total,
      };
    }
    case "purchase":
    case "opening": {
      const gold = roundTo(w.times(D(gramPriceAt(g18, fin))), step);
      const wage = wageAmount(line.wage_type, line.wage_value ?? 0, w, gold, step);
      const stone = roundTo(D(line.stone ?? 0), step);
      const tax = docKind === "purchase" ? roundTo(D(wage).times(D(env.purchaseTaxPct ?? 0)).div(100), step) : "0";
      let total = D(gold).plus(wage).plus(stone).plus(tax).toString();
      if (docKind === "opening" && has(line.cost)) total = roundTo(D(line.cost), step);
      return { ...base, gram_price: g18.toString(), gold_value: gold, wage, stone, tax, total };
    }
    case "workshop_in":
    case "consign_in": {
      if (line.kind !== "piece") return base;
      // the gold itself is not bought here: only the maker's wage (and stones) are owed
      const gold = g18.gt(0) ? D(w.times(D(gramPriceAt(g18, fin)))).toString() : "0";
      const wage = wageAmount(line.wage_type, line.wage_value ?? 0, w, gold, step);
      const stone = docKind === "workshop_in" ? roundTo(D(line.stone ?? 0), step) : "0";
      const total = docKind === "workshop_in" ? D(wage).plus(stone).toString() : "0";
      return { ...base, gram_price: g18.gt(0) ? g18.toString() : null, wage, stone, total };
    }
    case "bullion_sale": {
      const mz = has(env.mazaneh) && !D(env.mazaneh).isZero() ? D(env.mazaneh) : D(mazanehFromGram18(g18));
      const value = priceBullion(w, fin, mz, step);
      return { ...base, gram_price: gram18FromMazaneh(mz), gold_value: value, total: value };
    }
    default:
      return base; // weight-only documents: costs come from the ledger when posting
  }
}

export interface DocTotals {
  gold_value: string;
  wage: string;
  profit: string;
  tax: string;
  stone: string;
  discount: string;
  old_value: string;
  coins: string;
  /** sale: invoice amount; other kinds: value of the document */
  total: string;
  /** what is settled in rial: sale → total − used gold traded in */
  net: string;
  weight_out: string;
  weight_in: string;
  pieces: number;
  coin_qty: string;
}

export type TotalsLine = Pick<PricedLine, "qty" | "weight750" | "gold_value" | "wage" | "profit" | "tax" | "stone" | "discount" | "total"> & {
  kind: LineKind;
  direction: Direction;
};

/** Totals of priced lines. Weights are 750-equivalent grams (coins excluded). */
export function docTotals(docKind: DocKind, lines: TotalsLine[]): DocTotals {
  let gold = D(0), wage = D(0), profit = D(0), tax = D(0), stone = D(0), discount = D(0), old = D(0), coins = D(0), total = D(0);
  let wOut = D(0), wIn = D(0), coinQty = D(0);
  let pieces = 0;
  for (const l of lines) {
    if (l.kind === "old") {
      old = old.plus(D(l.total));
      wIn = wIn.plus(D(l.weight750));
      continue;
    }
    if (l.kind === "coin") {
      coins = coins.plus(D(l.total));
      coinQty = coinQty.plus(D(l.qty));
      discount = discount.plus(D(l.discount));
    } else {
      gold = gold.plus(D(l.gold_value));
      wage = wage.plus(D(l.wage));
      profit = profit.plus(D(l.profit));
      tax = tax.plus(D(l.tax));
      stone = stone.plus(D(l.stone));
      discount = discount.plus(D(l.discount));
      if (l.direction === "out") wOut = wOut.plus(D(l.weight750));
      else wIn = wIn.plus(D(l.weight750));
      if (l.kind === "piece") pieces += 1;
    }
    if (docKind !== "sale" || l.direction === "out") total = total.plus(D(l.total));
  }
  if (docKind === "buyback") total = old;
  const net = docKind === "sale" ? total.minus(old) : total;
  return {
    gold_value: gold.toString(), wage: wage.toString(), profit: profit.toString(), tax: tax.toString(), stone: stone.toString(),
    discount: discount.toString(), old_value: old.toString(), coins: coins.toString(), total: total.toString(), net: net.toString(),
    weight_out: wOut.toDecimalPlaces(3).toString(), weight_in: wIn.toDecimalPlaces(3).toString(), pieces, coin_qty: coinQty.toString(),
  };
}

export interface SettleAmounts {
  cash?: { amount?: Num } | null;
  pos?: { amount?: Num } | null;
  bank?: { amount?: Num } | null;
}

/** Paid (cash + card + bank transfer) and what remains on the party's account. */
export function settleSplit(net: Num, s: SettleAmounts | null | undefined) {
  const paid = D(s?.cash?.amount ?? 0).plus(D(s?.pos?.amount ?? 0)).plus(D(s?.bank?.amount ?? 0));
  const due = D(net).abs();
  return { due: due.toString(), paid: paid.toString(), remaining: due.minus(paid).toString() };
}

export interface PieceSource {
  net_weight: Num;
  fineness: Num;
  stone_weight?: Num;
  wage_type?: string | null;
  wage_value?: Num;
  profit_pct?: Num;
  stone_price?: Num;
}
export interface CategorySource {
  wage_type?: string | null;
  wage_value?: Num;
  profit_pct?: Num;
  default_fineness?: Num;
}

/**
 * Sale parameters of a tagged piece: the tag's own wage/profit, falling back to its category
 * (a tag without a wage takes the category's) and then to the organisation's defaults.
 */
export function pieceDefaults(item: PieceSource, cat?: CategorySource | null) {
  const itemWage = D(item.wage_value ?? 0);
  const useCat = itemWage.isZero() && cat && !D(cat.wage_value ?? 0).isZero();
  return {
    weight: D(item.net_weight).toString(),
    fineness: D(item.fineness || STANDARD_FINENESS).toString(),
    stone_weight: D(item.stone_weight ?? 0).toString(),
    wage_type: (useCat ? cat!.wage_type : item.wage_type) || "percent",
    wage_value: useCat ? D(cat!.wage_value).toString() : itemWage.toString(),
    profit_pct: has(item.profit_pct) ? D(item.profit_pct).toString() : has(cat?.profit_pct) ? D(cat!.profit_pct).toString() : null,
    stone: D(item.stone_price ?? 0).toString(),
  };
}

/** Coin price key of a coin item in the rate board's `coins` (emami, bahar, nim, rob, gerami). */
export function coinKey(item: { name?: string | null; code?: string | null; sku?: string | null }): string | null {
  const sku = (item.sku ?? "").trim().toLowerCase();
  if (["emami", "bahar", "nim", "rob", "gerami"].includes(sku)) return sku;
  const n = item.name ?? "";
  if (n.includes("امامی")) return "emami";
  if (n.includes("بهار")) return "bahar";
  if (n.includes("نیم")) return "nim";
  if (n.includes("ربع")) return "rob";
  if (n.includes("گرمی")) return "gerami";
  return null;
}

export const COIN_TITLES: Record<string, string> = { emami: "امامی", bahar: "بهار آزادی", nim: "نیم سکه", rob: "ربع سکه", gerami: "گرمی" };

/** Fills the missing one of gram18 / mazaneh. */
export function bothPrices(gram18: Num, mazaneh: Num): { gram18: string | null; mazaneh: string | null } {
  const g = has(gram18) && !D(gram18).isZero() ? D(gram18).toString() : null;
  const m = has(mazaneh) && !D(mazaneh).isZero() ? D(mazaneh).toString() : null;
  if (g && !m) return { gram18: g, mazaneh: mazanehFromGram18(g) };
  if (m && !g) return { gram18: gram18FromMazaneh(m), mazaneh: m };
  return { gram18: g, mazaneh: m };
}

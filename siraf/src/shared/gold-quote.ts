// Prices of catalogue products (coins, Parsian coins, bar models and serial bars) from the rate
// board: the sell and buy price of every board key, the defaults a document line of a coin or a
// bar starts from, and quotes with a breakdown. Pure and shared — the rate board, the «سکه‌ها» and
// «شمش‌ها» pages, the counter and the server all price with these, so a preview is what posts.
import { D, type Num } from "./money";
import {
  bandPremium, buybackBar, coinBubble, priceBar, quoteBar, quoteCoin, DEFAULT_PREMIUM_BANDS,
  type BarBasis, type BarPremiumType, type CoinBubble, type IntrinsicRate, type PremiumBand, type Quote, type VatMode, type WageType,
} from "./gold";
import { coinMeta, isSealed, type GoldMeta, type ProductKind } from "./gold-catalogue";

const has = (v: Num) => v !== null && v !== undefined && v !== "";
const pos = (v: Num) => (has(v) && D(v as string).gt(0) ? D(v as string) : null);

/** A coin item or a bar model of the catalogue (tz_items with kind coin / bar). */
export interface Product {
  id?: string;
  kind: ProductKind | string;
  name?: string | null;
  rate_key?: string | null;
  gold_weight?: Num;
  fineness?: Num;
  gold_meta?: GoldMeta | null;
  /** average cost of one coin / bar of the model in stock (margin VAT of a quote) */
  avg_cost?: Num;
}

/** What the board knows: the gram prices and the sell / buy prices per key. */
export interface BoardRate {
  gram18?: Num;
  buy_gram18?: Num;
  mazaneh?: Num;
  ounce_usd?: Num;
  usd?: Num;
  coins?: Record<string, Num> | null;
  coins_buy?: Record<string, Num> | null;
}

/** Bar defaults of the business (settings.gold.bars). */
export interface BarDefaults {
  basis: BarBasis;
  premium_bands: PremiumBand[];
  fee_sealed_pct: string;
  fee_opened_pct: string;
  assay_fee: string;
  /** an opened bar is bought at no more than this fineness */
  opened_fineness: string;
}

export const DEFAULT_BAR_DEFAULTS: BarDefaults = {
  basis: "actual",
  premium_bands: DEFAULT_PREMIUM_BANDS,
  fee_sealed_pct: "0.5",
  fee_opened_pct: "1.5",
  assay_fee: "0",
  opened_fineness: "995",
};

export const metaOf = (p: Product): GoldMeta => coinMeta(p.kind === "bar" ? "bar" : "coin", p.gold_meta ?? {});

/** Sell or buy price of one unit of a board key (buy: the board's, else the sell price less the spread). */
export function boardUnit(p: Product, rate: BoardRate | null | undefined, side: "sell" | "buy"): string | null {
  const key = p.rate_key;
  if (!key || !rate) return null;
  const sell = pos(rate.coins?.[key]);
  if (side === "sell") return sell ? sell.toString() : null;
  const buy = pos(rate.coins_buy?.[key]);
  if (buy) return buy.toString();
  const spread = pos(metaOf(p).buy_spread_pct);
  return sell && spread ? sell.times(D(100).minus(spread)).div(100).toDecimalPlaces(0).toString() : null;
}

/** The 18k gram price a side is priced at: sell → the board's gram18; buy → its buy price (else gram18). */
export function sideGram18(rate: BoardRate | null | undefined, side: "sell" | "buy"): string | null {
  if (!rate) return null;
  if (side === "buy") {
    const b = pos(rate.buy_gram18);
    if (b) return b.toString();
  }
  const g = pos(rate.gram18);
  return g ? g.toString() : null;
}

/** The premium of a bar model for a weight: its own, else the band of the business. */
export function barPremium(meta: GoldMeta, weight: Num, d: BarDefaults): { type: BarPremiumType; value: string } {
  if (meta.premium_type && has(meta.premium_value)) return { type: meta.premium_type, value: D(meta.premium_value!).toString() };
  return { type: "pct", value: bandPremium(weight || 0, d.premium_bands?.length ? d.premium_bands : DEFAULT_PREMIUM_BANDS) };
}

/** Line wage types store a bar premium type (percent / per gram / per bar). */
export const premiumToWage = (t: BarPremiumType): WageType => (t === "per_bar" ? "fixed" : t === "per_gram" ? "per_gram" : "percent");
export const wageToPremium = (t: string | null | undefined): BarPremiumType => (t === "fixed" ? "per_bar" : t === "per_gram" ? "per_gram" : "pct");

/** Pricing fields of a coin line (LineIn) for a product, a board and a side. */
export interface CoinLineDefaults {
  pricing_mode: "board" | "weight" | "manual";
  /** board / manual: price of one coin; weight: the 18k gram price */
  gram_price: string | null;
  wage_type: WageType | null;
  wage_value: string | null;
  profit_pct: string | null;
  vat_mode: VatMode;
}

/**
 * Defaults of a coin line: board coins take the board's sell or buy price of their key, coins
 * priced by weight (Parsian, foreign) the gram price of the side with their wage and profit when
 * we sell (a wholesaler's wage when we buy from one; nothing when we buy from a customer).
 */
export function coinLineDefaults(p: Product, rate: BoardRate | null | undefined, side: "sell" | "buy", opts: { wholesale?: boolean } = {}): CoinLineDefaults {
  const m = metaOf(p);
  const mode = m.pricing_mode ?? "board";
  const vat_mode = m.vat_mode ?? "exempt";
  if (mode === "weight") {
    const withWage = side === "sell" || opts.wholesale;
    return {
      pricing_mode: "weight", gram_price: sideGram18(rate, side), vat_mode,
      wage_type: withWage ? ((m.wage_type ?? "percent") as WageType) : "fixed",
      wage_value: withWage ? D(m.wage_value ?? 0).toString() : "0",
      profit_pct: side === "sell" ? D(m.profit_pct ?? 0).toString() : null,
    };
  }
  return { pricing_mode: mode, gram_price: mode === "board" ? boardUnit(p, rate, side) : null, wage_type: null, wage_value: null, profit_pct: null, vat_mode };
}

/** Pricing fields of a bar line for its model, the bar itself and a side. */
export interface BarLineDefaults {
  /** a fixed price of the bar from the board (models quoted per piece) */
  unit_price: string | null;
  gram_price: string | null;
  basis: BarBasis;
  premium_type: BarPremiumType;
  premium_value: string;
  vat_mode: VatMode;
  sealed: boolean;
  fee_pct: string;
  assay_fee: string;
  opened_fineness: string;
}

export function barLineDefaults(
  model: Product | null | undefined,
  bar: { weight?: Num; seal_status?: string | null } | null | undefined,
  rate: BoardRate | null | undefined,
  d: BarDefaults,
  side: "sell" | "buy",
): BarLineDefaults {
  const m = model ? metaOf(model) : coinMeta("bar", {});
  const weight = bar?.weight ?? model?.gold_weight ?? 0;
  const prem = barPremium(m, weight, d);
  const sealed = isSealed(bar?.seal_status);
  return {
    // the board's price of one bar is for a sealed bar: an opened one is bought by its metal
    unit_price: model && (side === "sell" || sealed) ? boardUnit(model, rate, side) : null,
    gram_price: sideGram18(rate, side),
    basis: d.basis,
    premium_type: prem.type,
    premium_value: prem.value,
    vat_mode: m.vat_mode ?? "exempt",
    sealed,
    fee_pct: D((sealed ? m.fee_sealed_pct ?? d.fee_sealed_pct : m.fee_opened_pct ?? d.fee_opened_pct) || 0).toString(),
    assay_fee: D((sealed ? 0 : m.assay_fee ?? d.assay_fee) || 0).toString(),
    opened_fineness: d.opened_fineness,
  };
}

export interface ProductQuote extends Quote {
  unit: string | null;
  mode: "board" | "weight" | "manual";
}

export interface QuoteEnv {
  taxPct: Num;
  roundStep: Num;
  bars: BarDefaults;
}

/**
 * Today's price of one unit (or `qty` units) of a product on a side, with its breakdown and — for
 * coins — the bubble over the gold content on both bases. Manual coins without a price give null.
 */
export function productQuote(
  p: Product,
  rate: BoardRate | null | undefined,
  env: QuoteEnv,
  opts: { side: "sell" | "buy"; qty?: Num; weight?: Num; fineness?: Num; seal_status?: string | null; wholesale?: boolean; unitCost?: Num },
): ProductQuote | null {
  const intrinsic: IntrinsicRate = { gram18: rate?.gram18, ounce_usd: rate?.ounce_usd, usd: rate?.usd };
  if (p.kind === "bar") {
    const w = opts.weight ?? p.gold_weight;
    if (!pos(w)) return null;
    const fin = opts.fineness ?? p.fineness ?? "995";
    const b = barLineDefaults(p, { weight: w, seal_status: opts.seal_status }, rate, env.bars, opts.side);
    if (!b.gram_price && !b.unit_price) return null;
    const q =
      opts.side === "buy"
        ? quoteBar({
            side: "buy", weight: w, fineness: fin, gram18: b.gram_price ?? 0, sealed: b.sealed, feeSealedPct: b.fee_pct, feeOpenedPct: b.fee_pct,
            assayFee: b.assay_fee, openedFineness: b.opened_fineness, unitPrice: b.unit_price, roundStep: env.roundStep,
          })
        : quoteBar({
            weight: w, fineness: fin, gram18: b.gram_price ?? 0, basis: b.basis, premiumType: b.premium_type, premiumValue: b.premium_value,
            vatMode: b.vat_mode, taxPct: env.taxPct, unitPrice: b.unit_price, unitCost: opts.unitCost ?? p.avg_cost ?? 0, roundStep: env.roundStep,
          });
    return { ...q, unit: q.total, mode: b.unit_price ? "board" : "weight" };
  }
  const d = coinLineDefaults(p, rate, opts.side, { wholesale: opts.wholesale });
  if (!d.gram_price) return null;
  const qty = opts.qty ?? 1;
  const q = quoteCoin({
    side: opts.side, mode: d.pricing_mode, qty, unitPrice: d.gram_price, gram18: d.gram_price, coinWeight: p.gold_weight ?? 0, fineness: p.fineness ?? 900,
    wageType: d.wage_type, wageValue: d.wage_value ?? 0, profitPct: d.profit_pct ?? 0, vatMode: d.vat_mode, taxPct: env.taxPct, roundStep: env.roundStep, rate: intrinsic,
    // margin VAT is on the price over the cost (the average cost of the stock)
    unitCost: opts.unitCost ?? p.avg_cost ?? 0,
  });
  const unit = D(qty || 0).isZero() ? null : D(q.total).div(D(qty)).toDecimalPlaces(0).toString();
  return { ...q, unit, mode: d.pricing_mode };
}

/** Bubble of a board coin at its sell price on both bases (null without a price or gold content). */
export function productBubble(p: Product, rate: BoardRate | null | undefined): CoinBubble | null {
  if (p.kind === "bar" || !rate) return null;
  const price = boardUnit(p, rate, "sell");
  if (!price || !pos(p.gold_weight)) return null;
  return coinBubble({ weight: p.gold_weight!, fineness: p.fineness ?? 900 }, price, { gram18: rate.gram18, ounce_usd: rate.ounce_usd, usd: rate.usd });
}

/** Bar sale price (exported for the counter's live totals). */
export { priceBar, buybackBar };

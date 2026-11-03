// The coin and bar catalogue as data: the metadata a coin item (tz_items.kind = 'coin') or a bar
// model (kind = 'bar') carries in tz_items.gold_meta, the board key (tz_items.rate_key) its
// prices live under, the standard catalogue seeded for every gold business, the tgju keys of the
// Iranian market feed and the Persian titles of every attribute. Pure and shared by the server
// (seeding, validation, pricing) and the UI (the «سکه‌ها» and «شمش‌ها» pages, the counter).
import { D } from "./money";
import { faDigits, formatNumber } from "./format";
import { COIN_SPECS, PARSIAN_SIZES, type BarPremiumType, type CoinFamily, type CoinPricingMode, type VatMode, type WageType } from "./gold";

/** Board keys: lowercase latin, digits and _, 2–40 characters (emami, rob_pre86, parsian_500, bar_kilo). */
export const RATE_KEY_RE = /^[a-z0-9_]{2,40}$/;

/** The five keys the board used before the catalogue; they stay the keys of these coins. */
export const LEGACY_COIN_KEYS = ["emami", "bahar", "nim", "rob", "gerami"] as const;

export type ProductKind = "coin" | "bar";
export type DateBand = string; // "86" | "pre86" | "1403" | "1404" | "1405" …
export const DATE_BAND_RE = /^(pre86|\d{2}|\d{4})$/;
export type Packaging = "sealed" | "loose";
export type Design = "emami" | "old";
export type BarType = "minted" | "cast" | "kilo" | "other";

/** What a coin item or a bar model knows about itself (tz_items.gold_meta). */
export interface GoldMeta {
  family?: CoinFamily | "bar";
  /** official specification (COIN_SPECS key) */
  spec?: string | null;
  design?: Design | null;
  date_band?: DateBand | null;
  packaging?: Packaging | null;
  /** Parsian size in sut */
  sut?: number | null;
  pricing_mode?: CoinPricingMode;
  /** weight mode: wage and profit of a sale */
  wage_type?: WageType | null;
  wage_value?: string | null;
  profit_pct?: string | null;
  vat_mode?: VatMode;
  /** a buy price derived from the sell price when the board has none (percent below it) */
  buy_spread_pct?: string | null;
  /** grams a measured coin may differ from its weight (default: the official tolerance) */
  tolerance?: string | null;
  /** key of the sell price in the tgju feed */
  tgju?: string | null;
  /** bar models */
  brand?: string | null;
  bar_type?: BarType | null;
  premium_type?: BarPremiumType | null;
  premium_value?: string | null;
  fee_sealed_pct?: string | null;
  fee_opened_pct?: string | null;
  assay_fee?: string | null;
}

export interface CatalogueEntry {
  key: string;
  kind: ProductKind;
  name: string;
  /** grams of one coin / nominal grams of a bar (null: each bar has its own) */
  gold_weight: string | null;
  fineness: string;
  active: boolean;
  meta: GoldMeta;
}

// ---------------------------------------------------------------- titles

export const FAMILY_TITLES: Record<string, string> = { bank: "سکه‌ی بانکی", parsian: "پارسیان", foreign: "خارجی و قدیمی", other: "سایر", bar: "شمش" };
export const DESIGN_TITLES: Record<Design, string> = { emami: "طرح امامی", old: "طرح قدیم" };
export const PACKAGING_TITLES: Record<Packaging, string> = { sealed: "پلمپ", loose: "بدون بسته‌بندی" };
export const PRICING_MODE_TITLES: Record<CoinPricingMode, string> = { board: "تابلوی قیمت", weight: "وزنی (اجرت و سود)", manual: "دستی" };
export const VAT_MODE_TITLES: Record<VatMode, string> = { exempt: "معاف", wage_profit: "بر اجرت و سود", margin: "بر سود خرید و فروش", full: "بر کل مبلغ" };
export const BAR_TYPE_TITLES: Record<BarType, string> = { minted: "شمش کارتی", cast: "شمش ریخته‌گری", kilo: "شمش کیلویی", other: "سایر" };
export const PREMIUM_TYPE_TITLES: Record<BarPremiumType, string> = { pct: "درصد", per_gram: "هر گرم", per_bar: "هر شمش" };

export function dateBandTitle(b: string | null | undefined): string | null {
  if (!b) return null;
  if (b === "pre86") return "زیر ۸۶";
  return faDigits(b);
}

/** The variant chips of a coin: design, date band and packaging («طرح امامی · زیر ۸۶ · پلمپ»). */
export function variantChips(meta: GoldMeta | null | undefined): string[] {
  if (!meta) return [];
  const out: string[] = [];
  if (meta.design) out.push(DESIGN_TITLES[meta.design]);
  const band = dateBandTitle(meta.date_band);
  if (band) out.push(band);
  if (meta.packaging) out.push(PACKAGING_TITLES[meta.packaging]);
  if (meta.sut) out.push(`${faDigits(meta.sut)} سوت`);
  return out;
}

// ---------------------------------------------------------------- bars

export type BarStatus = "in_stock" | "reserved" | "sold" | "consigned_out" | "melted" | "returned";
export type SealStatus = "sealed" | "opened" | "damaged" | "no_card";
export type BarSource = "purchase" | "ice" | "melt" | "buyback" | "opening" | "consignment";
export type BarOwnership = "own" | "consignment" | "customer";

export const BAR_STATUS_TITLES: Record<BarStatus, string> = {
  in_stock: "موجود", reserved: "رزرو", sold: "فروخته‌شده", consigned_out: "امانی نزد دیگران", melted: "ذوب‌شده", returned: "برگشت به همکار",
};
export const SEAL_TITLES: Record<SealStatus, string> = { sealed: "پلمپ سالم", opened: "باز شده", damaged: "پلمپ آسیب‌دیده", no_card: "بدون کارت" };
export const BAR_SOURCE_TITLES: Record<BarSource, string> = {
  purchase: "خرید از همکار", ice: "مرکز مبادله", melt: "ذوب و ری‌گیری", buyback: "خرید از مشتری", opening: "موجودی اول دوره", consignment: "امانی",
};
export const BAR_OWNERSHIP_TITLES: Record<BarOwnership, string> = { own: "متعلق به ما", consignment: "امانی", customer: "امانت مشتری" };
/** a bar is bought back at the sealed fee only with its seal intact */
export const isSealed = (s: string | null | undefined) => !s || s === "sealed";

/** Bar numbers (barcodes of the shop's own labels) start here, apart from the tag numbers (100001…). */
export const BAR_NO_START = 900001;

// ---------------------------------------------------------------- tgju

/** tgju sell keys → board keys (the market's «نقدی» rows). */
export const TGJU_SELL: Record<string, string> = {
  sekee: "emami", sekeb: "bahar", nim: "nim", rob: "rob", gerami: "gerami", sekee_down: "emami_pre86", nim_down: "nim_pre86", rob_down: "rob_pre86",
};
/** tgju retail (تک‌فروشی) keys → board keys. */
export const TGJU_RETAIL: Record<string, string> = { retail_sekee: "emami", retail_sekeb: "bahar", retail_nim: "nim", retail_rob: "rob", retail_gerami: "gerami" };
/** tgju bubble rows (percent, the provider's own formula) → board keys. */
export const TGJU_BUBBLE: Record<string, string> = { coin_blubber: "emami", sekeb_blubber: "bahar", nim_blubber: "nim", rob_blubber: "rob", gerami_blubber: "gerami" };
/** A Parsian row of a feed («parsian_500», «sekke-parsian-1000»…) → the Parsian size in sut. */
export function parsianSut(providerKey: string): number | null {
  const m = /parsian[_-]?(\d{2,4})/i.exec(providerKey);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- defaults

export function metaDefaults(kind: ProductKind, family: string | null | undefined): GoldMeta {
  if (kind === "bar") return { family: "bar", pricing_mode: "weight", vat_mode: "exempt", bar_type: "minted", packaging: "sealed" };
  switch (family) {
    case "parsian":
      return { family: "parsian", spec: "parsian", pricing_mode: "weight", vat_mode: "wage_profit", wage_type: "percent", wage_value: "3", packaging: "sealed" };
    case "foreign":
    case "other":
      return { family: family as CoinFamily, pricing_mode: "weight", vat_mode: "exempt", wage_type: "fixed", wage_value: "0" };
    default:
      return { family: "bank", pricing_mode: "board", vat_mode: "exempt", buy_spread_pct: null };
  }
}

/** A coin item's metadata with the defaults of its family filled in. */
export function coinMeta(kind: ProductKind, raw: GoldMeta | null | undefined): GoldMeta {
  const m = raw ?? {};
  return { ...metaDefaults(kind, m.family ?? (kind === "bar" ? "bar" : "bank")), ...stripNulls(m) };
}

function stripNulls(m: GoldMeta): GoldMeta {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = v;
  return out as GoldMeta;
}

const PRE86_WORDS = ["زیر ۸۶", "زیر 86", "قبل ۸۶", "قبل 86", "قبل از ۸۶", "قبل از 86"];

/**
 * Board key of a coin that has none yet (items made before the catalogue): the SKU when it is
 * one of the old keys, else its name — the specific words first, so «نیم سکه امامی» is «nim»
 * and a Parsian «۱ گرمی» is not the bank's gram coin.
 */
export function legacyCoinKey(item: { name?: string | null; sku?: string | null }): string | null {
  const sku = (item.sku ?? "").trim().toLowerCase();
  if ((LEGACY_COIN_KEYS as readonly string[]).includes(sku)) return sku;
  const n = item.name ?? "";
  if (n.includes("پارسیان") || n.includes("پهلوی")) return null;
  const pre86 = PRE86_WORDS.some((w) => n.includes(w));
  let key: string | null = null;
  if (n.includes("نیم")) key = "nim";
  else if (n.includes("ربع")) key = "rob";
  else if (n.includes("گرمی")) key = "gerami";
  else if (n.includes("امامی")) key = "emami";
  else if (n.includes("بهار")) key = "bahar";
  if (key && pre86 && key !== "gerami" && key !== "bahar") return `${key}_pre86`;
  return key;
}

// ---------------------------------------------------------------- the standard catalogue

const bank = (key: string, name: string, spec: keyof typeof COIN_SPECS, active: boolean, meta: GoldMeta): CatalogueEntry => ({
  key, kind: "coin", name, gold_weight: COIN_SPECS[spec].weight, fineness: COIN_SPECS[spec].fineness, active,
  meta: { family: "bank", spec, pricing_mode: "board", vat_mode: "exempt", ...meta },
});

const parsianName = (sut: number) => (sut < 1000 ? `سکه پارسیان ${faDigits(sut)} سوت` : `سکه پارسیان ${formatNumber(D(sut).div(1000), { dp: 3 })} گرمی`);
const PARSIAN_ACTIVE = new Set([100, 200, 300, 500, 1000, 1500, 2000]);

const BARS: [string, string, string | null, string, boolean, BarType][] = [
  ["bar_1", "شمش ۱ گرمی ۹۹۹٫۹", "1", "999.9", true, "minted"],
  ["bar_2_5", "شمش ۲٫۵ گرمی ۹۹۹٫۹", "2.5", "999.9", true, "minted"],
  ["bar_5", "شمش ۵ گرمی ۹۹۹٫۹", "5", "999.9", true, "minted"],
  ["bar_10", "شمش ۱۰ گرمی ۹۹۹٫۹", "10", "999.9", true, "minted"],
  ["bar_20", "شمش ۲۰ گرمی ۹۹۵", "20", "995", true, "minted"],
  ["bar_50", "شمش ۵۰ گرمی ۹۹۵", "50", "995", false, "cast"],
  ["bar_100", "شمش ۱۰۰ گرمی ۹۹۵", "100", "995", true, "cast"],
  ["bar_kilo", "شمش یک کیلویی ۹۹۵", "1000", "995", true, "kilo"],
  ["bar_other", "شمش (وزن آزاد)", null, "995", true, "other"],
];

/**
 * The standard catalogue every gold business gets: the bank coins of the Central Bank with their
 * date bands (86 / زیر ۸۶ / ۱۴۰۳ / ۱۴۰۴) and packaging, Parsian sizes (50 … 2000 sut), older and
 * foreign coins (inactive), and generic bar models by weight. The first five keep the names and
 * keys the app seeded before the catalogue, so existing data and rates still match them.
 */
export const STANDARD_CATALOGUE: CatalogueEntry[] = [
  bank("emami", "سکه امامی (طرح جدید)", "full", true, { design: "emami", date_band: "86", tgju: "sekee" }),
  bank("bahar", "سکه بهار آزادی (طرح قدیم)", "full", true, { design: "old", tgju: "sekeb" }),
  bank("nim", "نیم سکه", "half", true, { date_band: "86", tgju: "nim" }),
  bank("rob", "ربع سکه", "quarter", true, { date_band: "86", tgju: "rob" }),
  bank("gerami", "سکه یک گرمی", "gram", true, { packaging: "sealed", tgju: "gerami" }),
  bank("emami_pre86", "سکه امامی زیر ۸۶", "full", true, { design: "emami", date_band: "pre86", tgju: "sekee_down" }),
  bank("nim_pre86", "نیم سکه زیر ۸۶", "half", true, { date_band: "pre86", tgju: "nim_down" }),
  bank("rob_pre86", "ربع سکه زیر ۸۶", "quarter", true, { date_band: "pre86", tgju: "rob_down" }),
  bank("emami_1403", "سکه امامی ۱۴۰۳", "full", false, { design: "emami", date_band: "1403" }),
  bank("emami_1404", "سکه امامی ۱۴۰۴", "full", false, { design: "emami", date_band: "1404" }),
  bank("nim_1404", "نیم سکه ۱۴۰۴", "half", false, { date_band: "1404" }),
  bank("rob_1404", "ربع سکه ۱۴۰۴", "quarter", false, { date_band: "1404" }),
  bank("gerami_loose", "سکه یک گرمی بدون بسته‌بندی", "gram", false, { packaging: "loose" }),
  bank("two_half", "دو و نیم سکه بهار آزادی", "two_half", false, {}),
  bank("five", "پنج سکه بهار آزادی", "five", false, {}),
  ...PARSIAN_SIZES.map((sut): CatalogueEntry => ({
    key: `parsian_${sut}`, kind: "coin", name: parsianName(sut), gold_weight: D(sut).div(1000).toString(), fineness: "750", active: PARSIAN_ACTIVE.has(sut),
    meta: { family: "parsian", spec: "parsian", sut, pricing_mode: "weight", vat_mode: "wage_profit", wage_type: "percent", wage_value: sut < 1000 ? "4" : "3", packaging: "sealed" },
  })),
  ...(["pahlavi", "pahlavi_half", "pahlavi_quarter", "sovereign"] as const).map((spec): CatalogueEntry => ({
    key: spec === "pahlavi" ? "pahlavi_1" : spec, kind: "coin", name: COIN_SPECS[spec].title, gold_weight: COIN_SPECS[spec].weight, fineness: COIN_SPECS[spec].fineness, active: false,
    meta: { family: "foreign", spec, pricing_mode: "weight", vat_mode: "exempt", wage_type: "fixed", wage_value: "0" },
  })),
  ...BARS.map(([key, name, weight, fineness, active, bar_type]): CatalogueEntry => ({
    key, kind: "bar", name, gold_weight: weight, fineness, active,
    meta: { family: "bar", bar_type, pricing_mode: "weight", vat_mode: "exempt", ...(bar_type === "minted" ? { packaging: "sealed" as const } : {}) },
  })),
];

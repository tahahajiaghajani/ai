// Gold settings of an organisation (settings.gold) with their defaults, and the pricing
// environment documents are priced with.
import type { OrgRow, Ctx } from "../../context";
import type { Tx } from "../../db";
import { D, isNumeric, type Num } from "@shared/money";
import { DEFAULT_GOLD_PROFIT_PCT, DEFAULT_VAT_PCT } from "@shared/constants";
import { bad } from "../../http/errors";
import { updateRow } from "../../db/sql";
import type { PriceEnv } from "./pricing";
import { vatPctAt, type PremiumBand, type VatPeriod } from "@shared/gold";
import { RATE_KEY_RE } from "@shared/gold-catalogue";
import { DEFAULT_BAR_DEFAULTS, type BarDefaults, type QuoteEnv } from "@shared/gold-quote";

/** Market fields a rate source can deliver (JSON paths of a custom source point at them). */
export const RATE_FIELDS = ["gram18", "mazaneh", "gram24", "ounce_usd", "usd", "buy_gram18"] as const;
export type RateField = (typeof RATE_FIELDS)[number];

/**
 * A path key of a custom source: a market field, a board key (its sell price, e.g. «emami» or
 * «parsian_500») or «buy:<key>» (its buy price).
 */
export const PATH_KEY_RE = /^(?:buy:)?[a-z0-9_]{2,40}$/;
export const isPathKey = (k: string) => (RATE_FIELDS as readonly string[]).includes(k) || (PATH_KEY_RE.test(k) && RATE_KEY_RE.test(k.replace(/^buy:/, "")));

export interface CustomSource {
  url: string;
  /** unit of the prices returned by the source */
  unit?: "rial" | "toman";
  paths: Record<string, string>;
}

/** Identification (KYC) before coins, bars and آب‌شده change hands. */
export interface KycSettings {
  enabled: boolean;
  /** documents of at least this amount need it (null: every document) */
  threshold: string | null;
}

export type LiveProvider = "auto" | "tgju" | "goldapi" | "custom";

export interface GoldSettings {
  profit_pct: string;
  tax_pct: string;
  round_step: string;
  old_deduction_pct: string;
  /** input VAT on the wage of purchases from wholesalers (usually 0) */
  purchase_tax_pct: string;
  provider: LiveProvider;
  /** free-market USD rate for the world-ounce provider when the FX module has none */
  usd: string | null;
  price_source: CustomSource | null;
  kyc: KycSettings;
  bars: BarDefaults;
  /** dated VAT rates of the business (empty: 9% before 1405, then tax_pct) */
  vat_history: VatPeriod[];
  /** minutes after which a board price counts as stale */
  stale_minutes: number;
  /** a manual price further than this percent from the previous one needs a confirmation */
  deviation_pct: string;
}

function parseSource(raw: unknown): CustomSource | null {
  let v = raw;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (s.startsWith("{")) {
      try {
        v = JSON.parse(s);
      } catch {
        return null;
      }
    } else return { url: s, paths: {} };
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.url !== "string" || !o.url.trim()) return null;
  const paths: Record<string, string> = {};
  const src = (o.paths && typeof o.paths === "object" ? o.paths : {}) as Record<string, unknown>;
  for (const [f, v] of Object.entries(src)) if (isPathKey(f) && typeof v === "string" && v.trim()) paths[f] = v.trim();
  return { url: o.url.trim(), unit: o.unit === "toman" ? "toman" : "rial", paths };
}

const num = (v: unknown, fallback: string) => (isNumeric(v) ? D(v as string).toString() : fallback);

function parseBands(raw: unknown): PremiumBand[] {
  if (!Array.isArray(raw)) return DEFAULT_BAR_DEFAULTS.premium_bands;
  const out: PremiumBand[] = [];
  for (const b of raw as Record<string, unknown>[]) {
    if (!b || !isNumeric(b.pct)) continue;
    out.push({ max: isNumeric(b.max) ? D(b.max as string).toString() : null, pct: D(b.pct as string).toString() });
  }
  return out.length ? out : DEFAULT_BAR_DEFAULTS.premium_bands;
}

function parseBars(raw: unknown): BarDefaults {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_BAR_DEFAULTS;
  return {
    basis: b.basis === "nominal" ? "nominal" : "actual",
    premium_bands: parseBands(b.premium_bands),
    fee_sealed_pct: num(b.fee_sealed_pct, d.fee_sealed_pct),
    fee_opened_pct: num(b.fee_opened_pct, d.fee_opened_pct),
    assay_fee: num(b.assay_fee, d.assay_fee),
    opened_fineness: num(b.opened_fineness, d.opened_fineness),
  };
}

function parseVatHistory(raw: unknown): VatPeriod[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((p) => p && typeof p.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.from) && isNumeric(p.pct))
    .map((p) => ({ from: p.from as string, pct: D(p.pct as string).toString() }));
}

export function goldSettings(org: OrgRow): GoldSettings {
  const g = ((org.settings ?? {}).gold ?? {}) as Record<string, unknown>;
  const vat = num((org.settings ?? {}).vat_pct, DEFAULT_VAT_PCT);
  const provider = ["auto", "tgju", "goldapi", "custom"].includes(String(g.provider)) ? (g.provider as LiveProvider) : "auto";
  return {
    profit_pct: num(g.profit_pct, DEFAULT_GOLD_PROFIT_PCT),
    tax_pct: num(g.tax_pct, vat),
    round_step: num(g.round_step, org.money_decimals > 0 ? "0" : "1000"),
    old_deduction_pct: num(g.old_deduction_pct, "0"),
    purchase_tax_pct: num(g.purchase_tax_pct, "0"),
    provider,
    usd: isNumeric(g.usd) && D(g.usd as string).gt(0) ? D(g.usd as string).toString() : null,
    price_source: parseSource(g.price_source),
    kyc: {
      enabled: (g.kyc as Record<string, unknown> | undefined)?.enabled !== false,
      threshold: isNumeric((g.kyc as Record<string, unknown> | undefined)?.threshold) ? D((g.kyc as Record<string, string>).threshold).toString() : null,
    },
    bars: parseBars(g.bars),
    vat_history: parseVatHistory(g.vat_history),
    stale_minutes: isNumeric(g.stale_minutes) && D(g.stale_minutes as string).gt(0) ? Number(g.stale_minutes) : 180,
    deviation_pct: num(g.deviation_pct, "15"),
  };
}

/** Round step for money: the configured step, or the smallest unit of the base currency. */
export function moneyStep(s: GoldSettings, moneyDecimals: number): string {
  if (D(s.round_step).gt(0)) return s.round_step;
  return moneyDecimals > 0 ? D(1).div(D(10).pow(moneyDecimals)).toString() : "1";
}

/** VAT percent of gold value-added on a date (the 1405 rate from 1405, the business's dated rates). */
export function taxPctOn(s: GoldSettings, date?: string | null): string {
  return date ? vatPctAt(date, s.tax_pct, s.vat_history) : s.tax_pct;
}

export function priceEnv(org: OrgRow, prices: { gram18: Num; mazaneh?: Num }, overrides: { taxPct?: Num; date?: string | null } = {}): PriceEnv {
  const s = goldSettings(org);
  return {
    gram18: prices.gram18 ?? 0,
    mazaneh: prices.mazaneh ?? null,
    profitPct: s.profit_pct,
    taxPct: overrides.taxPct ?? taxPctOn(s, overrides.date),
    purchaseTaxPct: s.purchase_tax_pct,
    deductionPct: s.old_deduction_pct,
    roundStep: moneyStep(s, org.money_decimals),
  };
}

/** Pricing environment of catalogue quotes (rate board, coins and bars pages, AI quotes). */
export function quoteEnv(org: OrgRow, date?: string | null): QuoteEnv {
  const s = goldSettings(org);
  return { taxPct: taxPctOn(s, date), roundStep: moneyStep(s, org.money_decimals), bars: s.bars };
}

export interface GoldSettingsInput {
  profit_pct?: string | null;
  tax_pct?: string | null;
  round_step?: string | null;
  old_deduction_pct?: string | null;
  purchase_tax_pct?: string | null;
  provider?: LiveProvider | null;
  usd?: string | null;
  price_source?: { url?: string | null; unit?: "rial" | "toman" | null; paths?: Record<string, string | null | undefined> | null } | null;
  kyc?: { enabled?: boolean | null; threshold?: string | null } | null;
  bars?: Partial<Record<"basis" | "fee_sealed_pct" | "fee_opened_pct" | "assay_fee" | "opened_fineness", string | null>> & { premium_bands?: { max?: string | null; pct: string }[] | null } | null;
  vat_history?: { from: string; pct: string }[] | null;
  stale_minutes?: string | null;
  deviation_pct?: string | null;
}

/** Merge new gold settings into settings.gold (other keys of settings.gold are kept). */
export async function saveGoldSettings(tx: Tx, ctx: Ctx, input: GoldSettingsInput): Promise<GoldSettings> {
  const row = await tx.one<{ settings: Record<string, unknown> }>(`select settings from tz_orgs where id = $1`, [ctx.org.id]);
  const settings = { ...(row?.settings ?? {}) };
  const gold = { ...((settings.gold ?? {}) as Record<string, unknown>) };
  for (const k of ["profit_pct", "tax_pct", "round_step", "old_deduction_pct", "purchase_tax_pct", "usd", "stale_minutes", "deviation_pct"] as const) {
    const v = input[k];
    if (v === undefined) continue;
    if (v === null || v === "") {
      delete gold[k];
      continue;
    }
    if (!isNumeric(v) || D(v).lt(0)) throw bad("مقدار واردشده معتبر نیست");
    if (k.endsWith("_pct") && D(v).gt(100)) throw bad("درصد باید بین ۰ تا ۱۰۰ باشد");
    gold[k] = D(v).toString();
  }
  if (input.provider !== undefined) gold.provider = input.provider ?? "auto";
  if (input.price_source !== undefined) {
    const ps = input.price_source;
    if (!ps || !ps.url?.trim()) delete gold.price_source;
    else {
      const paths: Record<string, string> = {};
      for (const [f, p] of Object.entries(ps.paths ?? {})) {
        if (!isPathKey(f)) throw bad(`کلید «${f}» در مسیرهای منبع قیمت معتبر نیست`);
        if (typeof p === "string" && p.trim()) paths[f] = p.trim();
      }
      if (!paths.gram18 && !paths.mazaneh) throw bad("برای منبع دلخواه، مسیر قیمت «گرم ۱۸» یا «مظنه» را در پاسخ JSON مشخص کنید");
      gold.price_source = { url: ps.url.trim(), unit: ps.unit === "toman" ? "toman" : "rial", paths };
    }
  }
  if (input.kyc !== undefined) {
    const k = input.kyc ?? {};
    if (k.threshold !== undefined && k.threshold !== null && k.threshold !== "" && (!isNumeric(k.threshold) || D(k.threshold).lt(0))) throw bad("سقف شناسایی معتبر نیست");
    gold.kyc = { enabled: k.enabled !== false, threshold: isNumeric(k.threshold) ? D(k.threshold!).toString() : null };
  }
  if (input.bars !== undefined) {
    const b = input.bars ?? {};
    const out: Record<string, unknown> = { basis: b.basis === "nominal" ? "nominal" : "actual" };
    for (const k of ["fee_sealed_pct", "fee_opened_pct", "assay_fee", "opened_fineness"] as const) {
      const v = b[k];
      if (v === undefined || v === null || v === "") continue;
      if (!isNumeric(v) || D(v).lt(0) || (k.endsWith("_pct") && D(v).gt(100)) || (k === "opened_fineness" && D(v).gt(1000))) throw bad("مقدار تنظیمات شمش معتبر نیست");
      out[k] = D(v).toString();
    }
    if (b.premium_bands?.length) {
      out.premium_bands = b.premium_bands.map((x) => {
        if (!isNumeric(x.pct) || D(x.pct).lt(0) || D(x.pct).gt(100) || (x.max && !isNumeric(x.max))) throw bad("پلکان حق ضرب شمش معتبر نیست");
        return { max: x.max ? D(x.max).toString() : null, pct: D(x.pct).toString() };
      });
    }
    gold.bars = out;
  }
  if (input.vat_history !== undefined) {
    const list = input.vat_history ?? [];
    for (const p of list) if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !isNumeric(p.pct) || D(p.pct).lt(0) || D(p.pct).gt(100)) throw bad("نرخ‌های تاریخ‌دار مالیات معتبر نیستند");
    gold.vat_history = list.map((p) => ({ from: p.from, pct: D(p.pct).toString() }));
  }
  settings.gold = gold;
  const saved = await updateRow<OrgRow>(tx, "tz_orgs", { id: ctx.org.id }, { settings, origin: ctx.cfg.origin });
  ctx.org.settings = saved?.settings ?? (settings as OrgRow["settings"]);
  return goldSettings({ ...ctx.org, settings: ctx.org.settings });
}

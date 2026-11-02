// Gold settings of an organisation (settings.gold) with their defaults, and the pricing
// environment documents are priced with.
import type { OrgRow, Ctx } from "../../context";
import type { Tx } from "../../db";
import { D, isNumeric, type Num } from "@shared/money";
import { DEFAULT_GOLD_PROFIT_PCT, DEFAULT_VAT_PCT } from "@shared/constants";
import { bad } from "../../http/errors";
import { updateRow } from "../../db/sql";
import type { PriceEnv } from "./pricing";

/** Fields a rate source can deliver (JSON paths of a custom source point at them). */
export const RATE_FIELDS = ["gram18", "mazaneh", "gram24", "ounce_usd", "usd", "buy_gram18", "emami", "bahar", "nim", "rob", "gerami"] as const;
export type RateField = (typeof RATE_FIELDS)[number];

export interface CustomSource {
  url: string;
  /** unit of the prices returned by the source */
  unit?: "rial" | "toman";
  paths: Partial<Record<RateField, string>>;
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
  const paths: Partial<Record<RateField, string>> = {};
  const src = (o.paths && typeof o.paths === "object" ? o.paths : {}) as Record<string, unknown>;
  for (const f of RATE_FIELDS) if (typeof src[f] === "string" && (src[f] as string).trim()) paths[f] = (src[f] as string).trim();
  return { url: o.url.trim(), unit: o.unit === "toman" ? "toman" : "rial", paths };
}

const num = (v: unknown, fallback: string) => (isNumeric(v) ? D(v as string).toString() : fallback);

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
  };
}

/** Round step for money: the configured step, or the smallest unit of the base currency. */
export function moneyStep(s: GoldSettings, moneyDecimals: number): string {
  if (D(s.round_step).gt(0)) return s.round_step;
  return moneyDecimals > 0 ? D(1).div(D(10).pow(moneyDecimals)).toString() : "1";
}

export function priceEnv(org: OrgRow, prices: { gram18: Num; mazaneh?: Num }, overrides: { taxPct?: Num } = {}): PriceEnv {
  const s = goldSettings(org);
  return {
    gram18: prices.gram18 ?? 0,
    mazaneh: prices.mazaneh ?? null,
    profitPct: s.profit_pct,
    taxPct: overrides.taxPct ?? s.tax_pct,
    purchaseTaxPct: s.purchase_tax_pct,
    deductionPct: s.old_deduction_pct,
    roundStep: moneyStep(s, org.money_decimals),
  };
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
}

/** Merge new gold settings into settings.gold (other keys of settings.gold are kept). */
export async function saveGoldSettings(tx: Tx, ctx: Ctx, input: GoldSettingsInput): Promise<GoldSettings> {
  const row = await tx.one<{ settings: Record<string, unknown> }>(`select settings from tz_orgs where id = $1`, [ctx.org.id]);
  const settings = { ...(row?.settings ?? {}) };
  const gold = { ...((settings.gold ?? {}) as Record<string, unknown>) };
  for (const k of ["profit_pct", "tax_pct", "round_step", "old_deduction_pct", "purchase_tax_pct", "usd"] as const) {
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
      for (const f of RATE_FIELDS) {
        const p = ps.paths?.[f];
        if (typeof p === "string" && p.trim()) paths[f] = p.trim();
      }
      if (!paths.gram18 && !paths.mazaneh) throw bad("برای منبع دلخواه، مسیر قیمت «گرم ۱۸» یا «مظنه» را در پاسخ JSON مشخص کنید");
      gold.price_source = { url: ps.url.trim(), unit: ps.unit === "toman" ? "toman" : "rial", paths };
    }
  }
  settings.gold = gold;
  const saved = await updateRow<OrgRow>(tx, "tz_orgs", { id: ctx.org.id }, { settings, origin: ctx.cfg.origin });
  ctx.org.settings = saved?.settings ?? (settings as OrgRow["settings"]);
  return goldSettings({ ...ctx.org, settings: ctx.org.settings });
}

// Creating a business (organisation) with everything it needs on day one: fiscal year,
// chart of accounts, base currency, a cash box, a warehouse, units and module defaults.
import type { Db, Tx } from "../../db";
import { insertMany, insertRow } from "../../db/sql";
import { lockOrg, type OrgSettings } from "../../context";
import { uuidv7 } from "@shared/id";
import { coaFor, levelOfCode, parentCode } from "../accounting/coa";
import { ensureDetail } from "../accounting/details";
import { seedGoldCatalogue } from "../gold/catalogue";
import { BASE_CURRENCIES, DEFAULT_VAT_PCT, DEFAULT_GOLD_PROFIT_PCT, DEFAULT_TIMEZONE, type BusinessKind, type ModuleKey } from "@shared/constants";
import { currentJalaliYear, jalaliYearRange, todayISO } from "@shared/jalali";
import { toFa } from "@shared/jalali";

export interface CreateOrgInput {
  name: string;
  legal_name?: string | null;
  business_kind: BusinessKind;
  modules: ModuleKey[];
  base_currency: string;
  fiscal_year?: number; // Jalali year; default: current
  economic_code?: string | null;
  national_id?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
}

export const FIAT = [
  ["USD", "دلار آمریکا", "$", 2], ["EUR", "یورو", "€", 2], ["AED", "درهم امارات", "د.إ", 2], ["GBP", "پوند انگلیس", "£", 2],
  ["TRY", "لیر ترکیه", "₺", 2], ["IQD", "دینار عراق", "ع.د", 0], ["AFN", "افغانی", "؋", 2], ["CNY", "یوان چین", "¥", 2],
  ["CAD", "دلار کانادا", "C$", 2], ["AUD", "دلار استرالیا", "A$", 2], ["CHF", "فرانک سوئیس", "Fr", 2], ["JPY", "ین ژاپن", "¥", 0],
  ["RUB", "روبل روسیه", "₽", 2], ["SAR", "ریال عربستان", "﷼", 2], ["KWD", "دینار کویت", "د.ك", 3], ["OMR", "ریال عمان", "ر.ع", 3],
  ["QAR", "ریال قطر", "ر.ق", 2], ["AMD", "درام ارمنستان", "֏", 0], ["GEL", "لاری گرجستان", "₾", 2], ["INR", "روپیه هند", "₹", 2],
] as const;

export const CRYPTO = [
  ["USDT", "تتر", "₮", 6, "tether", "USDT"], ["BTC", "بیت‌کوین", "₿", 8, "bitcoin", "BTC"], ["ETH", "اتریوم", "Ξ", 8, "ethereum", "ETH"],
  ["USDC", "یو‌اس‌دی کوین", "", 6, "usd-coin", "USDC"], ["TRX", "ترون", "", 6, "tron", "TRX"], ["BNB", "بایننس کوین", "", 8, "binancecoin", "BNB"],
  ["SOL", "سولانا", "", 8, "solana", "SOL"], ["TON", "تون‌کوین", "", 8, "the-open-network", "TON"], ["XRP", "ریپل", "", 6, "ripple", "XRP"],
  ["DOGE", "دوج‌کوین", "", 8, "dogecoin", "DOGE"], ["LTC", "لایت‌کوین", "", 8, "litecoin", "LTC"], ["ADA", "کاردانو", "", 6, "cardano", "ADA"],
] as const;

const UNITS: [string, number][] = [
  ["عدد", 0], ["کیلوگرم", 3], ["گرم", 3], ["متر", 2], ["لیتر", 2], ["بسته", 0], ["کارتن", 0], ["دستگاه", 0], ["جفت", 0], ["ساعت", 2],
];

const GOLD_CATEGORIES: [string, string, string][] = [
  ["انگشتر", "percent", "18"], ["گردنبند", "percent", "15"], ["دستبند", "percent", "15"], ["النگو", "percent", "8"],
  ["گوشواره", "percent", "18"], ["سرویس", "percent", "20"], ["آویز", "percent", "18"], ["زنجیر", "percent", "10"],
  ["پابند", "percent", "15"], ["ساعت طلا", "percent", "12"], ["شمش و آبشده", "percent", "0"],
];

const COINS: [string, string, string][] = [
  ["سکه امامی (طرح جدید)", "8.133", "900"],
  ["سکه بهار آزادی (طرح قدیم)", "8.133", "900"],
  ["نیم سکه", "4.066", "900"],
  ["ربع سکه", "2.033", "900"],
  ["سکه یک گرمی", "1.010", "900"],
];

export function defaultSettings(kind: BusinessKind): OrgSettings {
  return {
    vat_pct: DEFAULT_VAT_PCT,
    timezone: DEFAULT_TIMEZONE,
    costing: "average",
    allow_negative_stock: kind === "services",
    gold: { profit_pct: DEFAULT_GOLD_PROFIT_PCT, tax_pct: DEFAULT_VAT_PCT, round_step: "1000", old_deduction_pct: "0" },
    fx: { providers: ["tgju", "kucoin", "okx", "coingecko", "open_er", "gold_api"], margin_pct: "0.5", refresh_seconds: 60 },
    print: { show_logo: true, footer: "" },
  };
}

export async function createOrg(db: Db, userId: string, input: CreateOrgInput, origin: string): Promise<{ id: string }> {
  const orgId = uuidv7();
  const base = BASE_CURRENCIES.find((c) => c.code === input.base_currency) ?? BASE_CURRENCIES[0];
  const modules = Array.from(new Set(input.modules)).filter((m): m is ModuleKey => ["goods", "gold", "fx"].includes(m));
  await db.tx(async (tx) => {
    await lockOrg(tx, orgId);
    await insertRow(tx, "sm_orgs", {
      id: orgId,
      name: input.name.trim(),
      legal_name: input.legal_name?.trim() || null,
      business_kind: input.business_kind,
      modules,
      base_currency: base.code,
      money_decimals: base.decimals,
      economic_code: input.economic_code || null,
      national_id: input.national_id || null,
      phone: input.phone || null,
      address: input.address || null,
      city: input.city || null,
      settings: defaultSettings(input.business_kind),
      created_by: userId,
      origin,
    }, "id");
    await insertRow(tx, "sm_org_members", { id: uuidv7(), org_id: orgId, user_id: userId, role: "owner", origin }, "id");
    await seedOrg(tx, orgId, modules, base, input.fiscal_year ?? currentJalaliYear(todayISO()), origin);
  });
  return { id: orgId };
}

export async function seedOrg(
  tx: Tx,
  orgId: string,
  modules: ModuleKey[],
  base: { code: string; title: string; decimals: number },
  jy: number,
  origin: string,
) {
  // fiscal year
  const range = jalaliYearRange(jy);
  await insertRow(tx, "sm_fiscal_years", { id: uuidv7(), org_id: orgId, title: `سال مالی ${toFa(jy)}`, start_date: range.start, end_date: range.end, status: "open", origin }, "id");

  // currencies (the base currency always exists)
  const baseId = uuidv7();
  const currencies: Record<string, unknown>[] = [
    { id: baseId, org_id: orgId, code: base.code, name: base.title, symbol: base.code === "IRR" ? "ریال" : base.code === "IRT" ? "تومان" : base.code, kind: "fiat", decimals: base.decimals, is_base: true, sort: 0, origin },
  ];
  if (modules.includes("fx")) {
    FIAT.filter(([code]) => code !== base.code).forEach(([code, name, symbol, decimals], i) =>
      currencies.push({ id: uuidv7(), org_id: orgId, code, name, symbol, kind: "fiat", decimals, sort: 10 + i, origin }),
    );
    CRYPTO.forEach(([code, name, symbol, decimals, coingecko, kucoin], i) =>
      currencies.push({ id: uuidv7(), org_id: orgId, code, name, symbol, kind: "crypto", decimals, sort: 100 + i, price_ids: { coingecko, kucoin, okx: kucoin, nobitex: code.toLowerCase() }, origin }),
    );
  }
  await insertMany(tx, "sm_currencies", currencies);

  // chart of accounts
  const entries = coaFor(modules);
  const ids = new Map<string, string>();
  for (const e of entries) ids.set(e.code, uuidv7());
  await insertMany(
    tx,
    "sm_accounts",
    entries.map((e, i) => {
      const level = levelOfCode(e.code);
      const p = parentCode(e.code);
      return {
        id: ids.get(e.code),
        org_id: orgId,
        parent_id: p ? ids.get(p) ?? null : null,
        code: e.code,
        name: e.name,
        level,
        kind: e.kind,
        nature: e.nature,
        is_postable: level === 3,
        detail_mode: e.detail?.mode ?? "none",
        detail_kinds: e.detail?.kinds ?? [],
        fx_mode: e.fx ?? "none",
        weight_mode: e.weight ?? "none",
        system_key: e.key ?? null,
        sort: i,
        origin,
      };
    }),
  );

  // a cash box, a walk-in customer, a warehouse and units
  const cashId = uuidv7();
  const cashDetail = await ensureDetail(tx, orgId, "cash", cashId, "صندوق اصلی");
  await insertRow(tx, "sm_cash_boxes", { id: cashId, org_id: orgId, code: "1", name: "صندوق اصلی", detail_id: cashDetail, origin }, "id");

  const walkinId = uuidv7();
  const walkinDetail = await ensureDetail(tx, orgId, "person", walkinId, "مشتری نقدی (گذری)");
  await insertRow(tx, "sm_parties", { id: walkinId, org_id: orgId, code: "1000", name: "مشتری نقدی (گذری)", roles: ["customer"], detail_id: walkinDetail, notes: "برای فروش‌های نقدی بدون ثبت مشخصات خریدار", origin }, "id");

  if (modules.includes("goods") || modules.includes("gold")) {
    await insertRow(tx, "sm_warehouses", { id: uuidv7(), org_id: orgId, code: "1", name: modules.includes("gold") && !modules.includes("goods") ? "ویترین و گاوصندوق" : "انبار مرکزی", origin }, "id");
  }
  const unitIds: Record<string, string> = {};
  await insertMany(
    tx,
    "sm_units",
    UNITS.map(([name, decimals]) => {
      const id = uuidv7();
      unitIds[name] = id;
      return { id, org_id: orgId, name, decimals, origin };
    }),
  );

  if (modules.includes("gold")) {
    await insertMany(
      tx,
      "sm_gold_categories",
      GOLD_CATEGORIES.map(([name, wage_type, wage_value], i) => ({ id: uuidv7(), org_id: orgId, code: String(i + 1), name, wage_type, wage_value, origin })),
    );
    await insertMany(
      tx,
      "sm_items",
      COINS.map(([name, weight, fineness], i) => ({
        id: uuidv7(), org_id: orgId, code: `C${i + 1}`, name, kind: "coin", unit_id: unitIds["عدد"], gold_weight: weight, fineness, vat_pct: 0, origin,
      })),
    );
    // the full coin and bar catalogue (links the five coins above to their price keys)
    await seedGoldCatalogue(tx, orgId, origin);
  }
}

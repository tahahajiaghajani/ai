// Shared pieces of the exchange module: currencies, the fx settings with their defaults, the
// rate board's latest rates, "legs" (where money comes from or goes to: cash box, bank account,
// crypto wallet or a customer's currency account) and the average cost of a currency.
import type { Queryable } from "../../db";
import type { OrgRow } from "../../context";
import { bad } from "../../http/errors";
import { D, type Num } from "@shared/money";
import { cleanSourceLabel, cleanSourceLink } from "@shared/price-source";
import { accountByKey } from "../accounting/vouchers";

// ---------------------------------------------------------------- currencies

export type CurrencyKind = "fiat" | "crypto" | "metal";

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  kind: CurrencyKind;
  decimals: number;
  is_base: boolean;
  price_ids: Record<string, string>;
  is_active: boolean;
  sort: number;
}

export interface CurrencyBook {
  list: Currency[];
  byId: Map<string, Currency>;
  byCode: Map<string, Currency>;
  base: Currency;
  get(id: string | null | undefined, label?: string): Currency;
}

export async function currencyBook(q: Queryable, orgId: string): Promise<CurrencyBook> {
  const list = await q.query<Currency>(
    `select id, code, name, symbol, kind, decimals, is_base, coalesce(price_ids, '{}'::jsonb) as price_ids, is_active, sort
     from tz_currencies where org_id = $1 and deleted_at is null order by sort, code`,
    [orgId],
  );
  const base = list.find((c) => c.is_base);
  if (!base) throw bad("ارز پایه‌ی کسب‌وکار تعریف نشده است");
  const byId = new Map(list.map((c) => [c.id, c]));
  const byCode = new Map(list.map((c) => [c.code.toUpperCase(), c]));
  return {
    list,
    byId,
    byCode,
    base,
    get(id, label = "ارز") {
      const c = id ? byId.get(id) : undefined;
      if (!c) throw bad(`${label} را انتخاب کنید`);
      return c;
    },
  };
}

/** Round an amount to the currency's own decimals (BTC 8, USD 2, rial 0). */
export function roundTo(v: Num, decimals: number): string {
  return D(v).toDecimalPlaces(Math.max(0, decimals)).toFixed();
}

// ---------------------------------------------------------------- settings

export interface CustomSource {
  /** currency code this source prices (USD, EUR, USDT …) */
  code: string;
  /** may hold {key}: the key saved on this runtime fills it (fx/source-keys.ts) */
  url: string;
  /** path to the price inside the JSON answer (@shared/json-path) */
  path: string;
  /** "base": the price is already in the base currency; "usd": in US dollars */
  unit: "base" | "usd";
  /** multiply the value (e.g. 0.1 to turn rial into toman) */
  factor?: string | null;
  /** request header that carries the key saved on this runtime (X-API-Key); the key itself is never in settings */
  header?: string | null;
  /** the name shown next to its rates («EZRate») and its link */
  label?: string | null;
  link?: string | null;
}

/** A stored row as the settings hold it: written by this module, but also by sync and PATCH /o/:org unchecked. */
function parseCustom(raw: unknown): CustomSource | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!c.code || !c.url || !c.path) return null;
  const link = cleanSourceLink(c.link);
  const label = cleanSourceLabel(c.label) ?? (link ? new URL(link).hostname : null);
  return {
    code: String(c.code),
    url: String(c.url),
    path: String(c.path),
    unit: c.unit === "usd" ? "usd" : "base",
    factor: c.factor === undefined || c.factor === null || c.factor === "" ? null : String(c.factor),
    // kept as written: fx/source-keys.ts refuses a header that may not carry a key before anything is sent
    header: typeof c.header === "string" && c.header.trim() ? c.header.trim().slice(0, 100) : null,
    label,
    link,
  };
}

export interface FxSettings {
  providers: string[];
  margin_pct: string;
  refresh_seconds: number;
  kyc_threshold: string | null;
  allow_negative: boolean;
  custom: CustomSource[];
}

export const PROVIDERS: { id: string; title: string; covers: string }[] = [
  { id: "kucoin", title: "KuCoin", covers: "رمزارزها (جفت‌ارز با تتر)" },
  { id: "okx", title: "OKX", covers: "رمزارزها (جفت‌ارز با تتر)" },
  { id: "coingecko", title: "CoinGecko", covers: "رمزارزها (محدودیت تعداد درخواست)" },
  { id: "mempool", title: "mempool.space", covers: "بیت‌کوین و نسبت ارزهای جهانی" },
  { id: "open_er", title: "open.er-api", covers: "نرخ رسمی ارزهای جهانی به دلار" },
  { id: "tgju", title: "tgju.org", covers: "بازار آزاد تهران: دلار و ارزها به ریال/تومان" },
  { id: "nobitex", title: "نوبیتکس", covers: "قیمت ریالی/تومانی رمزارز و تتر (فقط از داخل ایران)" },
  { id: "gold_api", title: "gold-api", covers: "انس طلا و نقره" },
  { id: "custom", title: "منبع سفارشی", covers: "هر API با نشانی و مسیر JSON دلخواه" },
];

export const DEFAULT_PROVIDERS = ["tgju", "kucoin", "okx", "coingecko", "open_er", "gold_api"];

export function fxSettings(org: Pick<OrgRow, "settings">): FxSettings {
  const s = ((org.settings ?? {}) as Record<string, unknown>).fx as Record<string, unknown> | undefined;
  const providers = Array.isArray(s?.providers) ? (s!.providers as unknown[]).map(String).filter((p) => PROVIDERS.some((x) => x.id === p)) : DEFAULT_PROVIDERS;
  const refresh = Number(s?.refresh_seconds);
  const kyc = s?.kyc_threshold;
  return {
    providers: providers.length ? providers : DEFAULT_PROVIDERS,
    margin_pct: s?.margin_pct !== undefined && s?.margin_pct !== null && s?.margin_pct !== "" ? D(s.margin_pct as string).toFixed() : "0.5",
    refresh_seconds: Number.isFinite(refresh) && refresh >= 10 ? Math.min(Math.round(refresh), 3600) : 60,
    kyc_threshold: kyc !== undefined && kyc !== null && kyc !== "" && D(kyc as string).gt(0) ? D(kyc as string).toFixed() : null,
    allow_negative: s?.allow_negative === true,
    custom: Array.isArray(s?.custom) ? (s!.custom as unknown[]).map(parseCustom).filter((c): c is CustomSource => !!c) : [],
  };
}

export function orgTz(org: Pick<OrgRow, "settings">): string {
  return (org.settings?.timezone as string) || "Asia/Tehran";
}

// ---------------------------------------------------------------- vouchers filter

/**
 * Posted vouchers that represent real activity. Year-end closing vouchers and the opening
 * vouchers generated from them cancel out, so leaving both out gives the same running balance
 * across fiscal years whether or not a year has been closed (manual opening vouchers stay in).
 */
export const LIVE = `v.deleted_at is null and v.status in ('posted','final') and v.kind <> 'closing' and v.source_type is distinct from 'opening'`;

/** Accounts whose balances form the business's own position in a currency. */
export const POSITION_KEYS = ["fx_cash", "fx_bank", "crypto_wallets"];

// ---------------------------------------------------------------- rates

export interface StoredRate {
  id: string;
  currency_id: string;
  buy: string | null;
  sell: string | null;
  mid: string | null;
  at: string;
  source: string;
}

/** Latest rate of every currency against the base (optionally as of the end of `date`). */
export async function latestRates(q: Queryable, orgId: string, opts: { date?: string | null; tz?: string } = {}): Promise<Map<string, StoredRate>> {
  const params: unknown[] = [orgId];
  let cond = "";
  if (opts.date) {
    params.push(opts.date, opts.tz ?? "Asia/Tehran");
    cond = `and (r.at at time zone $3)::date <= $2::date`;
  }
  const rows = await q.query<StoredRate>(
    `select distinct on (r.currency_id) r.id, r.currency_id, r.buy, r.sell, r.mid, r.at, r.source
     from tz_fx_rates r
     where r.org_id = $1 and r.deleted_at is null and r.quote_currency_id is null ${cond}
     order by r.currency_id, r.at desc, r.created_at desc`,
    params,
  );
  return new Map(rows.map((r) => [r.currency_id, r]));
}

/** Middle rate of a stored row: mid, else the average of buy and sell, else whichever exists. */
export function rateMid(r: Pick<StoredRate, "buy" | "sell" | "mid"> | null | undefined): string | null {
  if (!r) return null;
  if (r.mid !== null && r.mid !== undefined && D(r.mid).gt(0)) return D(r.mid).toFixed();
  const b = r.buy !== null && r.buy !== undefined && D(r.buy).gt(0) ? D(r.buy) : null;
  const s = r.sell !== null && r.sell !== undefined && D(r.sell).gt(0) ? D(r.sell) : null;
  if (b && s) return b.plus(s).div(2).toFixed();
  return (b ?? s)?.toFixed() ?? null;
}

// ---------------------------------------------------------------- legs

export type Method = "cash" | "bank" | "wallet" | "party";
export const METHODS: Method[] = ["cash", "bank", "wallet", "party"];
export const METHOD_FA: Record<Method, string> = { cash: "صندوق", bank: "حساب بانکی", wallet: "کیف‌پول", party: "حساب مشتری" };

export interface Leg {
  method: Method;
  ref_id: string;
  ref_name: string;
  account_id: string;
  account_key: string;
  detail_id: string;
  currency: Currency;
  /** the leg is part of the business's own position (fx cash, fx bank, wallet) */
  position: boolean;
}

/**
 * Where an amount in `currency` is received or paid. Cash boxes may be limited to one currency
 * (empty = any currency), bank accounts hold one currency (empty = base), wallets hold their
 * asset, and a customer's account takes any currency.
 */
export async function resolveLeg(
  q: Queryable,
  orgId: string,
  base: Currency,
  method: Method,
  refId: string | null | undefined,
  currency: Currency,
  partyId?: string | null,
): Promise<Leg> {
  const isBase = currency.id === base.id;
  if (!METHODS.includes(method)) throw bad("روش دریافت/پرداخت معتبر نیست");
  if (currency.kind === "crypto" && (method === "cash" || method === "bank")) {
    throw bad(`${currency.code} رمزارز است؛ برای آن کیف‌پول یا حساب مشتری را انتخاب کنید`);
  }
  if (method === "cash") {
    const box = refId
      ? await q.one<{ id: string; name: string; currency_id: string | null; detail_id: string | null; is_active: boolean }>(
          `select id, name, currency_id, detail_id, is_active from tz_cash_boxes where id = $1 and org_id = $2 and deleted_at is null`,
          [refId, orgId],
        )
      : await q.one<{ id: string; name: string; currency_id: string | null; detail_id: string | null; is_active: boolean }>(
          `select id, name, currency_id, detail_id, is_active from tz_cash_boxes
           where org_id = $1 and deleted_at is null and is_active and (currency_id is null or currency_id = $2)
           order by length(code), code limit 1`,
          [orgId, currency.id],
        );
    if (!box) throw bad(refId ? "صندوق پیدا نشد" : "صندوقی برای این ارز تعریف نشده است");
    if (box.currency_id && box.currency_id !== currency.id) throw bad(`صندوق «${box.name}» فقط برای ارز دیگری تعریف شده است`);
    if (!box.detail_id) throw bad(`صندوق «${box.name}» حساب تفصیلی ندارد؛ یک بار آن را ویرایش و ذخیره کنید`);
    return { method, ref_id: box.id, ref_name: box.name, account_key: isBase ? "cash" : "fx_cash", account_id: await accountByKey(q, orgId, isBase ? "cash" : "fx_cash"), detail_id: box.detail_id, currency, position: !isBase };
  }
  if (method === "bank") {
    if (!refId) throw bad("حساب بانکی را انتخاب کنید");
    const bank = await q.one<{ id: string; name: string; currency_id: string | null; detail_id: string | null }>(
      `select id, name, currency_id, detail_id from tz_bank_accounts where id = $1 and org_id = $2 and deleted_at is null`,
      [refId, orgId],
    );
    if (!bank) throw bad("حساب بانکی پیدا نشد");
    if ((bank.currency_id ?? base.id) !== currency.id) throw bad(`حساب بانکی «${bank.name}» به ارز دیگری است`);
    if (!bank.detail_id) throw bad(`حساب بانکی «${bank.name}» حساب تفصیلی ندارد`);
    return { method, ref_id: bank.id, ref_name: bank.name, account_key: isBase ? "bank" : "fx_bank", account_id: await accountByKey(q, orgId, isBase ? "bank" : "fx_bank"), detail_id: bank.detail_id, currency, position: !isBase };
  }
  if (method === "wallet") {
    if (!refId) throw bad("کیف‌پول را انتخاب کنید");
    const w = await q.one<{ id: string; name: string; currency_id: string | null; detail_id: string | null; kind: string }>(
      `select id, name, currency_id, detail_id, kind from tz_wallets where id = $1 and org_id = $2 and deleted_at is null`,
      [refId, orgId],
    );
    if (!w) throw bad("کیف‌پول پیدا نشد");
    if (w.currency_id !== currency.id) throw bad(`کیف‌پول «${w.name}» برای دارایی دیگری است`);
    if (w.kind === "customer") throw bad(`«${w.name}» کیف‌پول مشتری است و نمی‌تواند طرف معامله‌ی ما باشد`);
    if (!w.detail_id) throw bad(`کیف‌پول «${w.name}» حساب تفصیلی ندارد`);
    return { method, ref_id: w.id, ref_name: w.name, account_key: "crypto_wallets", account_id: await accountByKey(q, orgId, "crypto_wallets"), detail_id: w.detail_id, currency, position: true };
  }
  // the customer's own account (rial receivable/payable or currency account)
  const pid = refId || partyId;
  if (!pid) throw bad("برای «حساب مشتری» ابتدا مشتری را انتخاب کنید");
  const p = await q.one<{ id: string; name: string; detail_id: string | null }>(
    `select id, name, detail_id from tz_parties where id = $1 and org_id = $2 and deleted_at is null`,
    [pid, orgId],
  );
  if (!p) throw bad("شخص پیدا نشد");
  if (!p.detail_id) throw bad(`«${p.name}» حساب تفصیلی ندارد`);
  return { method, ref_id: p.id, ref_name: p.name, account_key: isBase ? "ar" : "fx_parties", account_id: await accountByKey(q, orgId, isBase ? "ar" : "fx_parties"), detail_id: p.detail_id, currency, position: false };
}

/** Balance of one leg (detail + currency on its account) up to a date. */
export async function legBalance(q: Queryable, orgId: string, leg: Leg, date: string, exclude?: { type: string; id: string } | null) {
  const params: unknown[] = [orgId, leg.account_id, leg.detail_id, date, leg.currency.id];
  // base-currency accounts may carry no currency at all
  const cur = ["cash", "bank", "ar"].includes(leg.account_key) ? "and (l.currency_id is null or l.currency_id = $5)" : "and l.currency_id = $5";
  let ex = "";
  if (exclude) {
    params.push(exclude.type, exclude.id);
    ex = `and (v.source_type is distinct from $${params.length - 1} or v.source_id is distinct from $${params.length}::uuid)`;
  }
  const r = await q.one<{ fx: string; base: string }>(
    `select coalesce(sum(l.fx_debit - l.fx_credit), 0) as fx, coalesce(sum(l.debit - l.credit), 0) as base
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id
     where l.org_id = $1 and l.account_id = $2 and l.detail_id = $3 and ${LIVE} and v.date <= $4 ${cur} ${ex}`,
    params,
  );
  return { fx: r?.fx ?? "0", base: r?.base ?? "0" };
}

// ---------------------------------------------------------------- average cost

/**
 * Average cost of a currency = Σ base / Σ amount over the position accounts (fx cash, fx bank,
 * crypto wallets) up to `date`, leaving out the document being (re)posted. A back-dated deal is
 * valued with the average known when it is posted; later deals are not re-valued.
 */
export async function averageCost(q: Queryable, orgId: string, currencyId: string, date: string, exclude?: { type: string; id: string } | null) {
  const params: unknown[] = [orgId, currencyId, date, `{${POSITION_KEYS.join(",")}}`];
  let ex = "";
  if (exclude) {
    params.push(exclude.type, exclude.id);
    ex = `and (v.source_type is distinct from $5 or v.source_id is distinct from $6::uuid)`;
  }
  const r = await q.one<{ fx: string; base: string }>(
    `select coalesce(sum(l.fx_debit - l.fx_credit), 0) as fx, coalesce(sum(l.debit - l.credit), 0) as base
     from tz_voucher_lines l join tz_vouchers v on v.id = l.voucher_id join tz_accounts a on a.id = l.account_id
     where l.org_id = $1 and l.currency_id = $2 and a.system_key = any($4::text[]) and ${LIVE} and v.date <= $3 ${ex}`,
    params,
  );
  const fx = D(r?.fx ?? 0);
  const base = D(r?.base ?? 0);
  return { fx: fx.toFixed(), base: base.toFixed(), avg: fx.gt(0) && base.gt(0) ? base.div(fx).toDecimalPlaces(12).toFixed() : null };
}

// ---------------------------------------------------------------- misc

export const KIND_FA: Record<string, string> = { buy: "خرید", sell: "فروش", exchange: "تبدیل" };

export interface Person {
  name?: string | null;
  national_id?: string | null;
  mobile?: string | null;
  passport_no?: string | null;
  nationality?: string | null;
  [k: string]: unknown;
}

/** Trim a small identity record (walk-in customer, sender, beneficiary) to known text fields. */
export function cleanPerson(p: Record<string, unknown> | null | undefined, fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!p || typeof p !== "object") return out;
  for (const f of fields) {
    const v = p[f];
    if (v === null || v === undefined) continue;
    const s = String(v).trim().slice(0, 300);
    if (s) out[f] = s;
  }
  return out;
}

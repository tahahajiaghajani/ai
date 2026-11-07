// Helpers shared by the assistant's tools: units and Persian formatting, record links, bounded
// lists, personal-data masking, the period input, and resolving what the model named (a party, an
// item, an account…) to a row of this business — exactly, or with candidates when it is ambiguous.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import type { Area, Level } from "@shared/permissions";
import type { AiRef } from "@shared/ai/types";
import { bad, forbidden } from "../../../http/errors";
import { D, isNumeric, normalizeDigits, type Num } from "@shared/money";
import { formatMoney, formatNumber, formatWeight } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { isUuid } from "@shared/id";
import { PERIOD_PRESETS, PeriodError, resolvePeriod, type FiscalYearLite, type PeriodInput, type PeriodPreset, type ResolvedPeriod } from "../analytics/period";
import type { ToolRuntime } from "./registry";

// ---------------------------------------------------------------- business basics

export interface MoneyInfo {
  code: string;
  /** Persian unit shown after amounts: «ریال», «تومان», «دلار» … */
  unit: string;
  dp: number;
}

const moneyCache = new WeakMap<Ctx, Promise<MoneyInfo>>();
const fyCache = new WeakMap<Ctx, Promise<FiscalYearLite[]>>();

/** Base currency of the business (amounts in the books are in it). */
export function moneyInfo(ctx: Ctx): Promise<MoneyInfo> {
  let p = moneyCache.get(ctx);
  if (!p) {
    p = ctx.db
      .one<{ code: string; symbol: string | null; name: string; decimals: number }>(
        `select code, symbol, name, decimals from sm_currencies where org_id = $1 and is_base and deleted_at is null limit 1`,
        [ctx.org.id],
      )
      .then((c) => {
        const code = c?.code ?? ctx.org.base_currency;
        const unit = c?.symbol || (code === "IRR" ? "ریال" : code === "IRT" ? "تومان" : c?.name || code);
        return { code, unit, dp: Number(ctx.org.money_decimals ?? c?.decimals ?? 0) || 0 };
      });
    moneyCache.set(ctx, p);
  }
  return p;
}

export function fiscalYears(ctx: Ctx): Promise<FiscalYearLite[]> {
  let p = fyCache.get(ctx);
  if (!p) {
    p = ctx.db.query<FiscalYearLite>(
      `select id, title, start_date, end_date, status from sm_fiscal_years where org_id = $1 and deleted_at is null order by start_date`,
      [ctx.org.id],
    );
    fyCache.set(ctx, p);
  }
  return p;
}

export function orgTimezone(ctx: Ctx): string {
  return (ctx.org.settings?.timezone as string) || "Asia/Tehran";
}

/** Today in the business's time zone (ISO). */
export function businessToday(ctx: Ctx): string {
  return todayISO(orgTimezone(ctx));
}

// ---------------------------------------------------------------- formatting

export function fmtMoney(v: Num, m: MoneyInfo): string {
  return `${formatMoney(v, m.dp)} ${m.unit}`;
}

export function fmtGrams(v: Num): string {
  return `${formatWeight(v)} گرم`;
}

export function fmtCount(v: Num): string {
  return formatNumber(v, { dp: 3 });
}

export function fmtPct(v: Num, dp = 1): string {
  return `${formatNumber(v, { dp, sign: true })}٪`;
}

/** «۱۴۰۵/۰۸/۱۱» or null. */
export function jd(iso: string | null | undefined): string | null {
  return iso ? formatJalali(String(iso).slice(0, 10)) : null;
}

/** Percent change from `prev` to `cur` (2 decimals) or null when `prev` is zero. */
export function changePct(cur: Num, prev: Num): string | null {
  const p = D(prev);
  if (p.isZero()) return null;
  return D(cur).minus(p).div(p.abs()).times(100).toDecimalPlaces(2).toString();
}

// ---------------------------------------------------------------- records

const INVOICE_PATH: Record<string, string> = {
  sale: "sales/invoices",
  sale_return: "sales/returns",
  quote: "sales/quotes",
  sale_order: "sales/orders",
  purchase: "purchases/invoices",
  purchase_return: "purchases/returns",
  purchase_order: "purchases/orders",
};

export const INVOICE_TITLE: Record<string, string> = {
  sale: "فاکتور فروش",
  sale_return: "برگشت از فروش",
  quote: "پیش‌فاکتور",
  sale_order: "سفارش فروش",
  purchase: "فاکتور خرید",
  purchase_return: "برگشت از خرید",
  purchase_order: "سفارش خرید",
};

export const GOLD_KIND_PATH: Record<string, string> = {
  sale: "gold/sale",
  purchase: "gold/purchase",
  buyback: "gold/buyback",
  consign_in: "gold/consignment/in",
  consign_return: "gold/consignment/return",
  workshop_out: "gold/workshop/out",
  workshop_in: "gold/workshop/in",
  melt: "gold/workshop/melt",
  bullion_sale: "gold/workshop/bullion-sale",
  opening: "gold/docs/opening",
};

/** In-app path (without the org prefix) of a record. */
export function pathOf(type: string, id: string, extra: { kind?: string | null; direction?: string | null; tag?: string | null } = {}): string | undefined {
  switch (type) {
    case "invoice":
      return `${INVOICE_PATH[extra.kind ?? "sale"] ?? "sales/invoices"}/${id}`;
    case "voucher":
      return `accounting/vouchers/${id}`;
    case "treasury_doc":
      return `treasury/docs/${id}`;
    case "cheque":
      return `${extra.direction === "issued" ? "treasury/cheques/issued" : "treasury/cheques"}?open=${id}`;
    case "party":
      return `parties/${id}`;
    case "item":
      return `inventory/kardex?item_id=${id}`;
    case "account":
      return `reports/ledger?account=${id}`;
    case "gold_doc":
      return `gold/docs/${id}`;
    case "gold_item":
      return extra.tag ? `gold/items?q=${encodeURIComponent(extra.tag)}` : "gold/items";
    case "gold_bar":
      return extra.tag ? `gold/bars?q=${encodeURIComponent(extra.tag)}` : "gold/bars";
    case "fx_deal":
      return `fx/deals/${id}`;
    case "remittance":
      return `fx/remittances/${id}`;
    case "stock_doc":
      return `inventory/docs/${id}`;
    default:
      return undefined;
  }
}

export function ref(type: string, id: string, label: string, extra: { kind?: string | null; direction?: string | null; tag?: string | null } = {}): AiRef {
  return { type, id, label, path: pathOf(type, id, extra) };
}

/** A report page as a reference (opens the report, not a record). */
export function reportRef(key: string, label: string, path: string): AiRef {
  return { type: "report", id: key, label, path };
}

/** Keep the first `n` rows; tell how many there were. */
export function bounded<T>(rows: T[], n: number): { rows: T[]; total_rows: number; truncated: boolean } {
  return { rows: rows.slice(0, n), total_rows: rows.length, truncated: rows.length > n };
}

// ---------------------------------------------------------------- personal data

/** Mask a personal identifier (national id, mobile, card, IBAN, passport) unless the policy is "full". */
export function maskId(value: string | null | undefined, rt: Pick<ToolRuntime, "dataPolicy">): string | null {
  if (!value) return null;
  if (rt.dataPolicy === "full") return value;
  const s = String(value);
  if (s.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

/** A party's name, or only its code under the "aggregates" policy. */
export function partyName(name: string | null | undefined, code: string | number | null | undefined, rt: Pick<ToolRuntime, "dataPolicy">): string {
  if (rt.dataPolicy === "aggregates") return code ? `شخص ${code}` : "شخص";
  return name || (code ? `شخص ${code}` : "—");
}

// ---------------------------------------------------------------- inputs

export const periodInput = z
  .object({
    preset: z.enum(PERIOD_PRESETS).nullish().describe("Jalali calendar preset resolved on the server (weeks start on Saturday; quarters are Jalali seasons)."),
    from: z.string().max(24).nullish().describe("Start date, Jalali «1405/08/01» or ISO «2026-10-23». Ignored when preset is given."),
    to: z.string().max(24).nullish().describe("End date (inclusive), Jalali or ISO. Ignored when preset is given."),
  })
  .describe("Period. Give a preset OR from/to. The resolved Jalali range is echoed back; quote it in the answer.");

export type PeriodArg = z.infer<typeof periodInput>;

/** Resolve the model's period argument (Persian error on a bad date). */
export async function period(ctx: Ctx, input: PeriodArg | null | undefined, today: string, def: PeriodPreset): Promise<ResolvedPeriod> {
  try {
    return resolvePeriod((input ?? null) as PeriodInput | null, today, { fiscalYears: await fiscalYears(ctx), def });
  } catch (e) {
    if (e instanceof PeriodError) throw bad(e.message);
    throw e;
  }
}

/** Money the model typed, in rial/toman/the base unit, converted to the base currency. */
export const moneyUnitInput = z
  .enum(["base", "rial", "toman"])
  .nullish()
  .describe("Unit of every amount you pass: base = the business's base currency (default), or rial / toman (converted on the server; 1 toman = 10 rial).");

export function toBase(value: Num, unit: "base" | "rial" | "toman" | null | undefined, m: MoneyInfo, label: string): string {
  if (!isNumeric(value)) throw bad(`«${label}» باید عدد باشد`);
  const v = D(value);
  if (!unit || unit === "base") return v.toString();
  if (m.code === "IRR") return unit === "toman" ? v.times(10).toString() : v.toString();
  if (m.code === "IRT") return unit === "rial" ? v.div(10).toString() : v.toString();
  throw bad(`واحد پول این کسب‌وکار ${m.unit} است؛ مبلغ را به ${m.unit} بدهید`);
}

// ---------------------------------------------------------------- permissions

export function needAll(ctx: Ctx, pairs: [Area, Level][]) {
  for (const [a, l] of pairs) ctx.need(a, l);
}

export function canAny(ctx: Ctx, pairs: [Area, Level][]) {
  return pairs.some(([a, l]) => ctx.can(a, l));
}

export function needAny(ctx: Ctx, pairs: [Area, Level][]) {
  if (!canAny(ctx, pairs)) throw forbidden();
}

export function needModule(ctx: Ctx, m: "goods" | "gold" | "fx") {
  const title = { goods: "کالا و بازرگانی", gold: "طلا و جواهر", fx: "صرافی و ارز" }[m];
  if (!ctx.hasModule(m)) throw forbidden(`بخش «${title}» برای این کسب‌وکار فعال نیست`);
}

// ---------------------------------------------------------------- search and resolution

/** SQL expression of a text column normalised for Persian search (ي/ك, ZWNJ, case). */
export function faSql(col: string): string {
  // the same as faNorm: Arabic letters, Persian/Arabic digits → Latin, no ZWNJ/LRM/RLM
  return `lower(translate(coalesce(${col}, ''), 'يكۀة۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩' || chr(8204) || chr(8206) || chr(8207), 'یکهه01234567890123456789'))`;
}

/** The same normalisation in JavaScript, for the search pattern. */
export function faNorm(s: string): string {
  return normalizeDigits(s)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[‌‏‎]/g, "")
    .trim()
    .toLowerCase();
}

export function likePattern(s: string): string {
  return `%${faNorm(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface PartyHit {
  id: string;
  code: string;
  name: string;
  detail_id: string | null;
  national_id: string | null;
  mobile: string | null;
  roles: string[];
  is_active: boolean;
}

function ambiguous(what: string, query: string, rows: { id: string; label: string }[]) {
  return bad(`چند ${what} با «${query}» پیدا شد؛ یکی را با شناسه انتخاب کنید`, {
    candidates: rows.slice(0, 8).map((r) => ({ id: r.id, label: r.label })),
  });
}

/**
 * A party by id, or exactly by code, national id, mobile or name. Ambiguous names return the
 * candidates (as error details) instead of guessing.
 */
export async function resolveParty(q: Queryable, ctx: Ctx, query: string): Promise<PartyHit> {
  const s = String(query ?? "").trim();
  if (!s) throw bad("شخص را مشخص کنید");
  const cols = "id, code, name, detail_id, national_id, mobile, roles, is_active";
  if (isUuid(s)) {
    const r = await q.one<PartyHit>(`select ${cols} from sm_parties where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id]);
    if (!r) throw bad("شخص پیدا نشد");
    return r;
  }
  const digits = normalizeDigits(s).replace(/[\s-]/g, "");
  if (/^\+?\d{3,14}$/.test(digits)) {
    const mobile = digits.replace(/^\+98/, "0").replace(/^0098/, "0").replace(/^98(?=9\d{9}$)/, "0");
    const rows = await q.query<PartyHit>(
      `select ${cols} from sm_parties where org_id = $1 and deleted_at is null and (code = $2 or national_id = $2 or mobile = $3 or economic_code = $2) limit 5`,
      [ctx.org.id, digits, /^9\d{9}$/.test(mobile) ? `0${mobile}` : mobile],
    );
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) throw ambiguous("شخص", s, rows.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` })));
  }
  const rows = await q.query<PartyHit>(
    `select ${cols} from sm_parties where org_id = $1 and deleted_at is null and ${faSql("name")} = $2 order by is_active desc limit 5`,
    [ctx.org.id, faNorm(s)],
  );
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw ambiguous("شخص", s, rows.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` })));
  const near = await q.query<{ id: string; label: string }>(
    `select id, name || ' (' || code || ')' as label from sm_parties where org_id = $1 and deleted_at is null and ${faSql("name")} like $2 order by length(name) limit 6`,
    [ctx.org.id, likePattern(s)],
  );
  throw bad(
    near.length ? `شخصی دقیقاً با نام «${s}» پیدا نشد؛ یکی از این‌ها را با شناسه انتخاب کنید` : `شخص «${s}» پیدا نشد؛ ابتدا آن را تعریف کنید`,
    near.length ? { candidates: near } : undefined,
  );
}

export interface ItemHit {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit_id: string | null;
  sale_price: string | null;
  purchase_price: string | null;
  vat_pct: string | null;
  is_active: boolean;
  gold_weight: string | null;
  fineness: string | null;
}

/** An item (goods, service or coin) by id, exact code/barcode/SKU or exact name. */
export async function resolveItem(q: Queryable, ctx: Ctx, query: string, kinds: string[] = ["goods", "service", "coin"]): Promise<ItemHit> {
  const s = String(query ?? "").trim();
  if (!s) throw bad("کالا را مشخص کنید");
  const cols = "id, code, name, kind, unit_id, sale_price, purchase_price, vat_pct, is_active, gold_weight, fineness";
  const kindArr = `{${kinds.join(",")}}`;
  if (isUuid(s)) {
    const r = await q.one<ItemHit>(`select ${cols} from sm_items where id = $1 and org_id = $2 and deleted_at is null and kind = any($3::text[])`, [s, ctx.org.id, kindArr]);
    if (!r) throw bad("کالا پیدا نشد");
    return r;
  }
  const code = normalizeDigits(s);
  const byCode = await q.query<ItemHit>(
    `select ${cols} from sm_items where org_id = $1 and deleted_at is null and kind = any($3::text[]) and (code = $2 or barcode = $2 or sku = $2) limit 3`,
    [ctx.org.id, code, kindArr],
  );
  if (byCode.length === 1) return byCode[0];
  const byName = await q.query<ItemHit>(
    `select ${cols} from sm_items where org_id = $1 and deleted_at is null and kind = any($3::text[]) and ${faSql("name")} = $2 order by is_active desc limit 5`,
    [ctx.org.id, faNorm(s), kindArr],
  );
  if (byName.length === 1) return byName[0];
  const many = byCode.length > 1 ? byCode : byName;
  if (many.length > 1) throw ambiguous("کالا", s, many.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` })));
  const near = await q.query<{ id: string; label: string }>(
    `select id, name || ' (' || code || ')' as label from sm_items where org_id = $1 and deleted_at is null and kind = any($3::text[]) and ${faSql("name")} like $2 order by length(name) limit 6`,
    [ctx.org.id, likePattern(s), kindArr],
  );
  throw bad(
    near.length ? `کالایی دقیقاً با نام «${s}» پیدا نشد؛ یکی از این‌ها را با شناسه انتخاب کنید` : `کالای «${s}» پیدا نشد`,
    near.length ? { candidates: near } : undefined,
  );
}

export interface AccountHit {
  id: string;
  code: string;
  name: string;
  kind: string;
  is_postable: boolean;
  system_key: string | null;
  detail_mode: string;
}

/** An account by id, exact code or exact name (postable accounts when `postable`). */
export async function resolveAccount(q: Queryable, ctx: Ctx, query: string, opts: { postable?: boolean } = {}): Promise<AccountHit> {
  const s = String(query ?? "").trim();
  if (!s) throw bad("حساب را مشخص کنید");
  const cols = "id, code, name, kind, is_postable, system_key, detail_mode";
  const rows = isUuid(s)
    ? await q.query<AccountHit>(`select ${cols} from sm_accounts where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id])
    : await q.query<AccountHit>(
        `select ${cols} from sm_accounts where org_id = $1 and deleted_at is null and (code = $2 or ${faSql("name")} = $3) order by level desc limit 5`,
        [ctx.org.id, normalizeDigits(s), faNorm(s)],
      );
  if (!rows.length) {
    const near = await q.query<{ id: string; label: string }>(
      `select id, code || ' ' || name as label from sm_accounts where org_id = $1 and deleted_at is null and is_postable and ${faSql("name")} like $2 order by code limit 6`,
      [ctx.org.id, likePattern(s)],
    );
    throw bad(`حساب «${s}» پیدا نشد`, near.length ? { candidates: near } : undefined);
  }
  if (rows.length > 1) throw ambiguous("حساب", s, rows.map((r) => ({ id: r.id, label: `${r.code} ${r.name}` })));
  const a = rows[0];
  if (opts.postable && !a.is_postable) throw bad(`حساب «${a.code} ${a.name}» معین نیست و سند به آن ثبت نمی‌شود؛ یکی از زیرحساب‌هایش را بدهید`);
  return a;
}

/** A cash box or bank account by id, exact code or exact name. */
export async function resolveMoneyBox(q: Queryable, ctx: Ctx, kind: "cash" | "bank", query: string | null | undefined): Promise<{ id: string; name: string; detail_id: string | null }> {
  const table = kind === "cash" ? "sm_cash_boxes" : "sm_bank_accounts";
  const label = kind === "cash" ? "صندوق" : "حساب بانکی";
  const s = String(query ?? "").trim();
  if (!s) {
    const rows = await q.query<{ id: string; name: string; detail_id: string | null }>(
      `select id, name, detail_id from ${table} where org_id = $1 and deleted_at is null and is_active order by length(code), code limit 2`,
      [ctx.org.id],
    );
    if (rows.length === 1) return rows[0];
    throw bad(rows.length ? `${label} را مشخص کنید` : `${label}ی تعریف نشده است`);
  }
  const rows = isUuid(s)
    ? await q.query<{ id: string; name: string; detail_id: string | null }>(`select id, name, detail_id from ${table} where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id])
    : await q.query<{ id: string; name: string; detail_id: string | null }>(
        `select id, name, detail_id from ${table} where org_id = $1 and deleted_at is null and (code = $2 or ${faSql("name")} = $3) limit 3`,
        [ctx.org.id, normalizeDigits(s), faNorm(s)],
      );
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw ambiguous(label, s, rows.map((r) => ({ id: r.id, label: r.name })));
  throw bad(`${label} «${s}» پیدا نشد`);
}

export interface CurrencyHit {
  id: string;
  code: string;
  name: string;
  kind: string;
  decimals: number;
  is_base: boolean;
}

/** A currency by id or code (USD, EUR, USDT…) or exact name. */
export async function resolveCurrency(q: Queryable, ctx: Ctx, query: string): Promise<CurrencyHit> {
  const s = String(query ?? "").trim();
  if (!s) throw bad("ارز را مشخص کنید");
  const cols = "id, code, name, kind, decimals, is_base";
  const r = isUuid(s)
    ? await q.one<CurrencyHit>(`select ${cols} from sm_currencies where id = $1 and org_id = $2 and deleted_at is null`, [s, ctx.org.id])
    : await q.one<CurrencyHit>(
        `select ${cols} from sm_currencies where org_id = $1 and deleted_at is null and (upper(code) = upper($2) or ${faSql("name")} = $3) limit 1`,
        [ctx.org.id, s, faNorm(s)],
      );
  if (!r) throw bad(`ارز «${s}» تعریف نشده است`);
  return r;
}

/** Decimal string of a number-like input or a Persian error. */
export function dec(v: Num, label: string, opts: { positive?: boolean; min0?: boolean } = {}): string {
  if (!isNumeric(v)) throw bad(`«${label}» باید عدد باشد`);
  const d = D(v);
  if (opts.positive && d.lte(0)) throw bad(`«${label}» باید بیشتر از صفر باشد`);
  if (opts.min0 && d.lt(0)) throw bad(`«${label}» نمی‌تواند منفی باشد`);
  return d.toString();
}

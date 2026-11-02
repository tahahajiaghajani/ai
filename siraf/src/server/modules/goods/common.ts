// Shared definitions of the goods module: document kinds, labels, permissions, settings and the
// small look-ups (items with their accounts, walk-in party, default warehouse) used by invoices,
// stock documents, costing and reports.
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { pgArray } from "../../db";
import { ident } from "../../db/sql";
import { bad, forbidden, notFound } from "../../http/errors";
import { accountByKey } from "../accounting/vouchers";
import type { Area, Level } from "@shared/permissions";
import { D } from "@shared/money";
import { DEFAULT_VAT_PCT } from "@shared/constants";
import { nowISO } from "@shared/jalali";

// ---------------------------------------------------------------- invoice kinds

export const INVOICE_KINDS = ["sale", "purchase", "sale_return", "purchase_return", "quote", "sale_order", "purchase_order"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_LABEL: Record<InvoiceKind, string> = {
  sale: "فاکتور فروش",
  purchase: "فاکتور خرید",
  sale_return: "برگشت از فروش",
  purchase_return: "برگشت از خرید",
  quote: "پیش‌فاکتور",
  sale_order: "سفارش فروش",
  purchase_order: "سفارش خرید",
};

/** Kinds that post (stock moves + voucher). Quotes and orders never post. */
export const POSTABLE_KINDS: ReadonlySet<string> = new Set(["sale", "purchase", "sale_return", "purchase_return"]);
export const SALE_SIDE: ReadonlySet<string> = new Set(["sale", "sale_return", "quote", "sale_order"]);
export const RETURN_OF: Partial<Record<InvoiceKind, InvoiceKind>> = { sale_return: "sale", purchase_return: "purchase" };

export const isSaleSide = (kind: string) => SALE_SIDE.has(kind);
export const kindArea = (kind: string): Area => (SALE_SIDE.has(kind) ? "sales" : "purchases");

/** +1: goods come into stock, −1: goods leave, 0: no stock effect. */
export function stockDirection(kind: string): -1 | 0 | 1 {
  if (kind === "sale" || kind === "purchase_return") return -1;
  if (kind === "purchase" || kind === "sale_return") return 1;
  return 0;
}

// ---------------------------------------------------------------- stock documents

export const STOCK_DOC_KINDS = ["receipt", "issue", "transfer", "adjust", "count"] as const;
export type StockDocKind = (typeof STOCK_DOC_KINDS)[number];

export const STOCK_DOC_LABEL: Record<StockDocKind, string> = {
  receipt: "رسید انبار",
  issue: "حواله انبار",
  transfer: "انتقال بین انبارها",
  adjust: "تعدیل موجودی",
  count: "انبارگردانی",
};

/**
 * Order of moves inside one day (tz_stock_moves.seq): receipts before transfers before issues,
 * and stock-count corrections at the end of the day. Ties: document creation time, document id,
 * line, outgoing before incoming (transfers), move id — see MOVE_ORDER.
 */
export const SEQ = { in: 0, transfer: 1, out: 2, count: 3 } as const;
export const MOVE_ORDER = "m.date, m.seq, m.created_at, m.source_id, m.source_line_id nulls last, (m.qty < 0) desc, m.id";

/** Source types whose moves this module values (coins and gold belong to the gold module). */
export const OWN_SOURCES = ["invoice", "stock_doc"] as const;

// ---------------------------------------------------------------- permissions / settings

export function needAny(ctx: Ctx, pairs: [Area, Level][]) {
  if (!pairs.some(([a, l]) => ctx.can(a, l))) throw forbidden();
}

export function moneyDp(ctx: Ctx): number {
  return Number(ctx.org.money_decimals ?? 0) || 0;
}

export function defaultVatPct(ctx: Ctx): string {
  const v = ctx.org.settings?.vat_pct;
  return v === undefined || v === null || v === "" ? DEFAULT_VAT_PCT : D(v as string).toString();
}

export function orgAllowsNegative(ctx: Ctx): boolean {
  return ctx.org.settings?.allow_negative_stock === true;
}

export function orgTimezone(ctx: Ctx): string {
  return (ctx.org.settings?.timezone as string) || "Asia/Tehran";
}

/** created_at for a new document; moves copy it so their order never changes on re-posting. */
export function newCreatedAt(): string {
  return nowISO();
}

// ---------------------------------------------------------------- items

export interface ItemRow {
  id: string;
  code: string;
  name: string;
  kind: "goods" | "service" | "coin";
  category_id: string | null;
  unit_id: string | null;
  unit2_id: string | null;
  unit2_factor: string | null;
  barcode: string | null;
  sale_price: string | null;
  purchase_price: string | null;
  min_sale_price: string | null;
  vat_pct: string | null;
  tax_goods_id: string | null;
  allow_negative: boolean | null;
  inventory_account_id: string | null;
  sales_account_id: string | null;
  cogs_account_id: string | null;
  is_active: boolean;
  unit_name: string | null;
  unit_decimals: number | null;
  unit2_name: string | null;
  unit2_decimals: number | null;
}

export async function loadItems(q: Queryable, orgId: string, ids: string[]): Promise<Map<string, ItemRow>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return new Map();
  const rows = await q.query<ItemRow>(
    `select i.id, i.code, i.name, i.kind, i.category_id, i.unit_id, i.unit2_id, i.unit2_factor, i.barcode, i.sale_price, i.purchase_price,
            i.min_sale_price, i.vat_pct, i.tax_goods_id, i.allow_negative, i.inventory_account_id, i.sales_account_id, i.cogs_account_id,
            i.is_active, u.name as unit_name, u.decimals as unit_decimals, u2.name as unit2_name, u2.decimals as unit2_decimals
     from tz_items i
     left join tz_units u on u.id = i.unit_id
     left join tz_units u2 on u2.id = i.unit2_id
     where i.org_id = $1 and i.deleted_at is null and i.id = any($2::uuid[])`,
    [orgId, pgArray(uniq)],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export interface ItemAccounts {
  inventory: string;
  /** income account of a sale (goods: فروش کالا, services: درآمد خدمات) */
  revenue: string;
  cogs: string;
  /** cost account of a purchased service */
  expense: string;
}

/**
 * Accounts of each item: the item's own override, else its category's (walking up the parent
 * categories), else the standard account of the chart.
 */
export async function itemAccounts(q: Queryable, orgId: string, items: ItemRow[]): Promise<Map<string, ItemAccounts>> {
  const out = new Map<string, ItemAccounts>();
  if (!items.length) return out;
  const cats = await q.query<{ id: string; parent_id: string | null; inventory_account_id: string | null; sales_account_id: string | null; cogs_account_id: string | null }>(
    `select id, parent_id, inventory_account_id, sales_account_id, cogs_account_id from tz_item_categories where org_id = $1 and deleted_at is null`,
    [orgId],
  );
  const byId = new Map(cats.map((c) => [c.id, c]));
  const fromCategory = (catId: string | null, field: "inventory_account_id" | "sales_account_id" | "cogs_account_id") => {
    let c = catId ? byId.get(catId) : undefined;
    for (let depth = 0; c && depth < 8; depth++) {
      if (c[field]) return c[field];
      c = c.parent_id ? byId.get(c.parent_id) : undefined;
    }
    return null;
  };
  for (const it of items) {
    const service = it.kind === "service";
    out.set(it.id, {
      inventory: it.inventory_account_id ?? fromCategory(it.category_id, "inventory_account_id") ?? (await accountByKey(q, orgId, "inventory")),
      revenue: it.sales_account_id ?? fromCategory(it.category_id, "sales_account_id") ?? (await accountByKey(q, orgId, service ? "service_income" : "sales")),
      cogs: it.cogs_account_id ?? fromCategory(it.category_id, "cogs_account_id") ?? (await accountByKey(q, orgId, "cogs")),
      expense: it.cogs_account_id ?? fromCategory(it.category_id, "cogs_account_id") ?? (await accountByKey(q, orgId, "misc_expense")),
    });
  }
  return out;
}

/** Unit factor of a line: 1 for the main unit, unit2_factor for the secondary unit. */
export function unitFactor(item: ItemRow, unitId: string | null | undefined): { unitId: string | null; factor: string; decimals: number | null; name: string | null } {
  if (!unitId || unitId === item.unit_id) return { unitId: item.unit_id, factor: "1", decimals: item.unit_decimals, name: item.unit_name };
  if (unitId === item.unit2_id && item.unit2_factor && D(item.unit2_factor).gt(0)) {
    return { unitId, factor: D(item.unit2_factor).toString(), decimals: item.unit2_decimals, name: item.unit2_name };
  }
  throw bad(`واحد انتخاب‌شده برای «${item.name}» تعریف نشده است`);
}

// ---------------------------------------------------------------- parties / warehouses

export interface PartyRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  detail_id: string | null;
  national_id: string | null;
  economic_code: string | null;
  registration_no: string | null;
  postal_code: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  mobile: string | null;
  price_list_id: string | null;
  discount_pct: string | null;
  credit_limit: string | null;
  group_id: string | null;
}

const PARTY_COLS = "id, code, name, kind, detail_id, national_id, economic_code, registration_no, postal_code, address, city, province, phone, mobile, price_list_id, discount_pct, credit_limit, group_id";

export async function loadParty(q: Queryable, orgId: string, id: string): Promise<PartyRow> {
  const p = await q.one<PartyRow>(`select ${PARTY_COLS} from tz_parties where id = $1 and org_id = $2 and deleted_at is null`, [id, orgId]);
  if (!p) throw notFound("طرف حساب پیدا نشد");
  return p;
}

/** The walk-in customer (code 1000) created with every business. */
export async function walkinParty(q: Queryable, orgId: string): Promise<PartyRow> {
  const p = await q.one<PartyRow>(`select ${PARTY_COLS} from tz_parties where org_id = $1 and code = '1000' and deleted_at is null`, [orgId]);
  if (!p) throw bad("مشتری نقدی (کد ۱۰۰۰) پیدا نشد؛ طرف حساب را انتخاب کنید");
  return p;
}

/** Identity of the buyer copied onto the invoice (needed for e-invoices). */
export function buyerSnapshot(p: PartyRow): Record<string, string | null> {
  return {
    name: p.name,
    kind: p.kind,
    national_id: p.national_id,
    economic_code: p.economic_code,
    registration_no: p.registration_no,
    postal_code: p.postal_code,
    address: p.address,
    city: p.city,
    province: p.province,
    phone: p.phone || p.mobile,
  };
}

export async function defaultWarehouse(q: Queryable, orgId: string): Promise<string> {
  const w = await q.one<{ id: string }>(
    `select id from tz_warehouses where org_id = $1 and deleted_at is null and is_active order by length(code), code limit 1`,
    [orgId],
  );
  if (!w) throw bad("هیچ انباری تعریف نشده است (انبار و کالا ← انبارها)");
  return w.id;
}

export async function checkWarehouses(q: Queryable, orgId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter(Boolean) as string[]));
  if (!uniq.length) return new Map();
  const rows = await q.query<{ id: string; name: string }>(
    `select id, name from tz_warehouses where org_id = $1 and deleted_at is null and id = any($2::uuid[])`,
    [orgId, pgArray(uniq)],
  );
  if (rows.length !== uniq.length) throw bad("انبار انتخاب‌شده پیدا نشد");
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------- roots

/**
 * Touch an aggregate root after its children changed (the sync trigger stamps a new revision),
 * optionally with a few column updates.
 */
export async function touchRoot(tx: Tx, table: "tz_invoices" | "tz_stock_docs", id: string, origin: string, patch: Record<string, unknown> = {}) {
  const cols = Object.keys(patch);
  const params: unknown[] = [id, origin, ...cols.map((c) => patch[c])];
  const sets = ["origin = $2", ...cols.map((c, i) => `${ident(c)} = $${i + 3}`)];
  await tx.query(`update ${ident(table)} set ${sets.join(", ")} where id = $1`, params);
}

/** Sum of treasury allocations (receipts/payments settled against an invoice). */
export async function allocatedFor(q: Queryable, orgId: string, invoiceId: string): Promise<string> {
  const r = await q.one<{ s: string }>(
    `select coalesce(sum(a.amount), 0) as s from tz_treasury_allocs a join tz_treasury_docs d on d.id = a.doc_id
     where a.org_id = $1 and a.invoice_id = $2 and d.deleted_at is null and d.status not in ('draft', 'cancelled', 'void')`,
    [orgId, invoiceId],
  );
  return D(r?.s ?? 0).toString();
}

/** SQL expression of the allocated amount of invoice alias `i`. */
export const ALLOCATED_SQL = `(select coalesce(sum(a.amount), 0) from tz_treasury_allocs a join tz_treasury_docs td on td.id = a.doc_id
  where a.org_id = i.org_id and a.invoice_id = i.id and td.deleted_at is null and td.status not in ('draft', 'cancelled', 'void'))`;

export const num = (v: unknown) => D(v as string).toString();

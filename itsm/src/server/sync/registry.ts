// Synchronised aggregates: a root row (with rev/updated_at/deleted_at) plus child rows that
// always travel and are replaced together. Must match the trigger list in migration 0007.
import type { Area } from "@shared/permissions";

export interface ChildDef {
  table: string;
  fk: string;
}

export interface AggregateDef {
  entity: string;
  table: string;
  area: Area;
  children?: ChildDef[];
  /** numbered document: on a number clash the incoming document takes the next free number */
  numbered?: { byKind: boolean };
  /** unique code column: on a clash the incoming row takes the next free code */
  code?: { column: string; start: number };
  /** apply order (lower first) so referenced rows usually arrive before their users */
  order: number;
}

const moves: ChildDef = { table: "tz_stock_moves", fk: "source_id" };

export const AGGREGATES: AggregateDef[] = [
  { entity: "org", table: "tz_orgs", area: "settings", order: 0 },
  { entity: "member", table: "tz_org_members", area: "users", order: 1 },
  { entity: "fiscal_year", table: "tz_fiscal_years", area: "accounting", order: 2 },
  { entity: "currency", table: "tz_currencies", area: "fx", order: 3, code: { column: "code", start: 0 } },
  { entity: "account", table: "tz_accounts", area: "accounting", order: 4, code: { column: "code", start: 0 } },
  { entity: "detail", table: "tz_details", area: "accounting", order: 5, code: { column: "code", start: 90001 } },
  { entity: "party_group", table: "tz_party_groups", area: "parties", order: 6 },
  { entity: "party", table: "tz_parties", area: "parties", order: 7, code: { column: "code", start: 1001 } },
  { entity: "cash_box", table: "tz_cash_boxes", area: "treasury", order: 8 },
  { entity: "bank_account", table: "tz_bank_accounts", area: "treasury", order: 8 },
  { entity: "pos_terminal", table: "tz_pos_terminals", area: "treasury", order: 9 },
  { entity: "cheque_book", table: "tz_cheque_books", area: "treasury", order: 9 },
  { entity: "unit", table: "tz_units", area: "inventory", order: 10 },
  { entity: "item_category", table: "tz_item_categories", area: "inventory", order: 11 },
  { entity: "item", table: "tz_items", area: "inventory", order: 12, code: { column: "code", start: 10001 } },
  { entity: "warehouse", table: "tz_warehouses", area: "inventory", order: 12 },
  { entity: "price_list", table: "tz_price_lists", area: "sales", order: 13, children: [{ table: "tz_price_list_items", fk: "price_list_id" }] },
  { entity: "wallet", table: "tz_wallets", area: "fx", order: 13 },
  { entity: "gold_category", table: "tz_gold_categories", area: "gold", order: 13 },
  { entity: "gold_item", table: "tz_gold_items", area: "gold", order: 14, code: { column: "tag_no", start: 100001 } },
  { entity: "gold_bar", table: "tz_gold_bars", area: "gold", order: 14, code: { column: "bar_no", start: 900001 } },
  { entity: "gold_rate", table: "tz_gold_rates", area: "gold", order: 15 },
  { entity: "fx_rate", table: "tz_fx_rates", area: "fx", order: 15 },
  { entity: "cheque", table: "tz_cheques", area: "treasury", order: 20 },
  { entity: "voucher", table: "tz_vouchers", area: "accounting", order: 21, children: [{ table: "tz_voucher_lines", fk: "voucher_id" }], numbered: { byKind: false } },
  { entity: "treasury_doc", table: "tz_treasury_docs", area: "treasury", order: 22, children: [{ table: "tz_treasury_lines", fk: "doc_id" }, { table: "tz_treasury_allocs", fk: "doc_id" }], numbered: { byKind: true } },
  { entity: "stock_doc", table: "tz_stock_docs", area: "inventory", order: 22, children: [{ table: "tz_stock_lines", fk: "doc_id" }, moves], numbered: { byKind: true } },
  { entity: "invoice", table: "tz_invoices", area: "sales", order: 22, children: [{ table: "tz_invoice_lines", fk: "invoice_id" }, moves], numbered: { byKind: true } },
  { entity: "gold_doc", table: "tz_gold_docs", area: "gold", order: 22, children: [{ table: "tz_gold_lines", fk: "doc_id" }, moves], numbered: { byKind: true } },
  { entity: "fx_deal", table: "tz_fx_deals", area: "fx", order: 22, numbered: { byKind: false } },
  { entity: "remittance", table: "tz_remittances", area: "fx", order: 22, numbered: { byKind: false } },
];

export const BY_ENTITY = new Map(AGGREGATES.map((a) => [a.entity, a]));
export const BY_TABLE = new Map(AGGREGATES.map((a) => [a.table, a]));

export interface WireAggregate {
  entity: string;
  id: string;
  base_rev: number;
  row: Record<string, unknown>;
  children: Record<string, Record<string, unknown>[]>;
}

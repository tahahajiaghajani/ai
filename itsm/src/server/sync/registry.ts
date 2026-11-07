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

const moves: ChildDef = { table: "sm_stock_moves", fk: "source_id" };

export const AGGREGATES: AggregateDef[] = [
  { entity: "org", table: "sm_orgs", area: "settings", order: 0 },
  { entity: "member", table: "sm_org_members", area: "users", order: 1 },
  { entity: "fiscal_year", table: "sm_fiscal_years", area: "accounting", order: 2 },
  { entity: "currency", table: "sm_currencies", area: "fx", order: 3, code: { column: "code", start: 0 } },
  { entity: "account", table: "sm_accounts", area: "accounting", order: 4, code: { column: "code", start: 0 } },
  { entity: "detail", table: "sm_details", area: "accounting", order: 5, code: { column: "code", start: 90001 } },
  { entity: "party_group", table: "sm_party_groups", area: "parties", order: 6 },
  { entity: "party", table: "sm_parties", area: "parties", order: 7, code: { column: "code", start: 1001 } },
  { entity: "cash_box", table: "sm_cash_boxes", area: "treasury", order: 8 },
  { entity: "bank_account", table: "sm_bank_accounts", area: "treasury", order: 8 },
  { entity: "pos_terminal", table: "sm_pos_terminals", area: "treasury", order: 9 },
  { entity: "cheque_book", table: "sm_cheque_books", area: "treasury", order: 9 },
  { entity: "unit", table: "sm_units", area: "inventory", order: 10 },
  { entity: "item_category", table: "sm_item_categories", area: "inventory", order: 11 },
  { entity: "item", table: "sm_items", area: "inventory", order: 12, code: { column: "code", start: 10001 } },
  { entity: "warehouse", table: "sm_warehouses", area: "inventory", order: 12 },
  { entity: "price_list", table: "sm_price_lists", area: "sales", order: 13, children: [{ table: "sm_price_list_items", fk: "price_list_id" }] },
  { entity: "wallet", table: "sm_wallets", area: "fx", order: 13 },
  { entity: "gold_category", table: "sm_gold_categories", area: "gold", order: 13 },
  { entity: "gold_item", table: "sm_gold_items", area: "gold", order: 14, code: { column: "tag_no", start: 100001 } },
  { entity: "gold_bar", table: "sm_gold_bars", area: "gold", order: 14, code: { column: "bar_no", start: 900001 } },
  { entity: "gold_rate", table: "sm_gold_rates", area: "gold", order: 15 },
  { entity: "fx_rate", table: "sm_fx_rates", area: "fx", order: 15 },
  { entity: "cheque", table: "sm_cheques", area: "treasury", order: 20 },
  { entity: "voucher", table: "sm_vouchers", area: "accounting", order: 21, children: [{ table: "sm_voucher_lines", fk: "voucher_id" }], numbered: { byKind: false } },
  { entity: "treasury_doc", table: "sm_treasury_docs", area: "treasury", order: 22, children: [{ table: "sm_treasury_lines", fk: "doc_id" }, { table: "sm_treasury_allocs", fk: "doc_id" }], numbered: { byKind: true } },
  { entity: "stock_doc", table: "sm_stock_docs", area: "inventory", order: 22, children: [{ table: "sm_stock_lines", fk: "doc_id" }, moves], numbered: { byKind: true } },
  { entity: "invoice", table: "sm_invoices", area: "sales", order: 22, children: [{ table: "sm_invoice_lines", fk: "invoice_id" }, moves], numbered: { byKind: true } },
  { entity: "gold_doc", table: "sm_gold_docs", area: "gold", order: 22, children: [{ table: "sm_gold_lines", fk: "doc_id" }, moves], numbered: { byKind: true } },
  { entity: "fx_deal", table: "sm_fx_deals", area: "fx", order: 22, numbered: { byKind: false } },
  { entity: "remittance", table: "sm_remittances", area: "fx", order: 22, numbered: { byKind: false } },
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

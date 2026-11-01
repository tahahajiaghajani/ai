// Schema changes of the goods module (idempotent: "if not exists", "create or replace").
// - stock documents get the counter account of receipts/issues (and its detail) plus free extras
// - indexes for the costing run (canonical move order), returns and price look-ups
export default /* sql */ `
alter table tz_stock_docs add column if not exists account_id uuid;
alter table tz_stock_docs add column if not exists detail_id uuid;
alter table tz_stock_docs add column if not exists extra jsonb not null default '{}'::jsonb;

create index if not exists tz_stock_moves_cost_idx on tz_stock_moves (org_id, item_id, date, seq, created_at);
create index if not exists tz_stock_moves_line_idx on tz_stock_moves (source_line_id);
create index if not exists tz_stock_moves_wh_idx on tz_stock_moves (org_id, warehouse_id, item_id);
create index if not exists tz_invoices_ref_idx on tz_invoices (org_id, ref_invoice_id) where ref_invoice_id is not null;
create index if not exists tz_stock_lines_item_idx on tz_stock_lines (org_id, item_id);
create index if not exists tz_price_list_items_item_idx on tz_price_list_items (org_id, item_id);
`;

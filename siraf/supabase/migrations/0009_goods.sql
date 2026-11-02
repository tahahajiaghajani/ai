-- «سیراف» migration 0009_goods — کالا، انبار و فاکتور
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0009_goods — کالا، انبار و فاکتور
-- ---------------------------------------------------------------------------
alter table tz_stock_docs add column if not exists account_id uuid;
alter table tz_stock_docs add column if not exists detail_id uuid;
alter table tz_stock_docs add column if not exists extra jsonb not null default '{}'::jsonb;

create index if not exists tz_stock_moves_cost_idx on tz_stock_moves (org_id, item_id, date, seq, created_at);
create index if not exists tz_stock_moves_line_idx on tz_stock_moves (source_line_id);
create index if not exists tz_stock_moves_wh_idx on tz_stock_moves (org_id, warehouse_id, item_id);
create index if not exists tz_invoices_ref_idx on tz_invoices (org_id, ref_invoice_id) where ref_invoice_id is not null;
create index if not exists tz_stock_lines_item_idx on tz_stock_lines (org_id, item_id);
create index if not exists tz_price_list_items_item_idx on tz_price_list_items (org_id, item_id);

insert into tz_migrations (id) values ('0009_goods') on conflict (id) do nothing;

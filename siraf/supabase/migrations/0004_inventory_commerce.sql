-- «سیراف» migration 0004_inventory_commerce — کالا، انبار، خرید و فروش
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0004_inventory_commerce — کالا، انبار، خرید و فروش
-- ---------------------------------------------------------------------------
create table if not exists tz_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  name text not null,
  decimals int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_item_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  parent_id uuid,
  code text,
  name text not null,
  inventory_account_id uuid,
  sales_account_id uuid,
  cogs_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null default 'goods',
  category_id uuid,
  unit_id uuid,
  unit2_id uuid,
  unit2_factor numeric,
  barcode text,
  sku text,
  sale_price numeric,
  purchase_price numeric,
  min_sale_price numeric,
  vat_pct numeric,
  tax_goods_id text,
  track_mode text not null default 'none',
  min_stock numeric,
  max_stock numeric,
  reorder_point numeric,
  brand text,
  model text,
  weight numeric,
  fineness numeric,
  gold_weight numeric,
  description text,
  image text,
  allow_negative boolean,
  inventory_account_id uuid,
  sales_account_id uuid,
  cogs_account_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_items_code_uk on tz_items (org_id, code) where deleted_at is null;
create index if not exists tz_items_barcode_idx on tz_items (org_id, barcode);
create index if not exists tz_items_name_idx on tz_items (org_id, name);

create table if not exists tz_warehouses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  name text not null,
  address text,
  keeper_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_price_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  name text not null,
  currency_id uuid,
  is_default boolean not null default false,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_price_list_items (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references tz_price_lists(id) on delete cascade,
  org_id uuid not null,
  item_id uuid not null,
  price numeric not null,
  min_qty numeric
);
create index if not exists tz_price_list_items_idx on tz_price_list_items (price_list_id, item_id);

create table if not exists tz_stock_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  kind text not null,
  no int not null,
  date date not null,
  warehouse_id uuid,
  dest_warehouse_id uuid,
  party_id uuid,
  reason text,
  description text,
  status text not null default 'posted',
  source_type text,
  source_id uuid,
  voucher_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_stock_docs_no_uk on tz_stock_docs (org_id, fiscal_year_id, kind, no) where deleted_at is null;
create index if not exists tz_stock_docs_date_idx on tz_stock_docs (org_id, date);

create table if not exists tz_stock_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references tz_stock_docs(id) on delete cascade,
  org_id uuid not null,
  line_no int not null default 0,
  item_id uuid not null,
  qty numeric not null default 0,
  unit_id uuid,
  unit_factor numeric not null default 1,
  base_qty numeric not null default 0,
  unit_cost numeric,
  total_cost numeric,
  system_qty numeric,
  counted_qty numeric,
  batch_no text,
  serial_no text,
  expiry_date date,
  description text
);
create index if not exists tz_stock_lines_doc_idx on tz_stock_lines (doc_id);

-- stock ledger: written with its source document (invoice, stock doc, gold doc) and valued by
-- the moving-average costing run in date order
create table if not exists tz_stock_moves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  item_id uuid not null,
  warehouse_id uuid,
  date date not null,
  seq int not null default 0,
  qty numeric not null,
  unit_cost numeric not null default 0,
  value numeric not null default 0,
  fixed_cost boolean not null default false,
  source_type text not null,
  source_id uuid not null,
  source_line_id uuid,
  batch_no text,
  serial_no text,
  created_at timestamptz not null default now()
);
create index if not exists tz_stock_moves_item_idx on tz_stock_moves (org_id, item_id, date, created_at);
create index if not exists tz_stock_moves_source_idx on tz_stock_moves (source_id);

create table if not exists tz_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  kind text not null,
  no int not null,
  ref_no text,
  date date not null,
  due_date date,
  party_id uuid,
  warehouse_id uuid,
  price_list_id uuid,
  salesperson_id uuid,
  currency_id uuid,
  fx_rate numeric,
  status text not null default 'draft',
  subtotal numeric not null default 0,
  line_discount numeric not null default 0,
  discount numeric not null default 0,
  additions numeric not null default 0,
  deductions numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  paid numeric not null default 0,
  settlement text,
  notes text,
  terms text,
  ref_invoice_id uuid,
  voucher_id uuid,
  buyer jsonb not null default '{}'::jsonb,
  moadian jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  external_ref text,
  extra jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_invoices_no_uk on tz_invoices (org_id, fiscal_year_id, kind, no) where deleted_at is null;
create index if not exists tz_invoices_date_idx on tz_invoices (org_id, kind, date);
create index if not exists tz_invoices_party_idx on tz_invoices (org_id, party_id);
create index if not exists tz_invoices_ext_idx on tz_invoices (org_id, source, external_ref);

create table if not exists tz_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references tz_invoices(id) on delete cascade,
  org_id uuid not null,
  line_no int not null default 0,
  item_id uuid,
  description text,
  qty numeric not null default 1,
  unit_id uuid,
  unit_factor numeric not null default 1,
  unit_price numeric not null default 0,
  discount_pct numeric not null default 0,
  discount numeric not null default 0,
  vat_pct numeric not null default 0,
  vat numeric not null default 0,
  total numeric not null default 0,
  warehouse_id uuid,
  batch_no text,
  serial_no text,
  cost numeric
);
create index if not exists tz_invoice_lines_inv_idx on tz_invoice_lines (invoice_id);
create index if not exists tz_invoice_lines_item_idx on tz_invoice_lines (org_id, item_id);

insert into tz_migrations (id) values ('0004_inventory_commerce') on conflict (id) do nothing;

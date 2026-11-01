-- «تراز» migration 0005_gold — طلا و جواهر
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0005_gold — طلا و جواهر
-- ---------------------------------------------------------------------------
create table if not exists tz_gold_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  mazaneh numeric,
  gram18 numeric,
  gram24 numeric,
  ounce_usd numeric,
  usd numeric,
  buy_gram18 numeric,
  coins jsonb not null default '{}'::jsonb,
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists tz_gold_rates_at_idx on tz_gold_rates (org_id, at desc);

create table if not exists tz_gold_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text,
  name text not null,
  default_fineness numeric not null default 750,
  wage_type text not null default 'percent',
  wage_value numeric not null default 0,
  profit_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_gold_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  tag_no text not null,
  category_id uuid,
  title text,
  fineness numeric not null default 750,
  gross_weight numeric not null default 0,
  stone_weight numeric not null default 0,
  net_weight numeric not null default 0,
  wage_type text not null default 'percent',
  wage_value numeric not null default 0,
  profit_pct numeric,
  stone_desc text,
  stone_price numeric not null default 0,
  supplier_id uuid,
  ownership text not null default 'own',
  status text not null default 'in_stock',
  warehouse_id uuid,
  cost numeric,
  in_doc_id uuid,
  out_doc_id uuid,
  image text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_gold_items_tag_uk on tz_gold_items (org_id, tag_no) where deleted_at is null;
create index if not exists tz_gold_items_status_idx on tz_gold_items (org_id, status);

create table if not exists tz_gold_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  kind text not null,
  no int not null,
  date date not null,
  party_id uuid,
  gram18 numeric,
  mazaneh numeric,
  status text not null default 'posted',
  gold_value numeric not null default 0,
  wage numeric not null default 0,
  profit numeric not null default 0,
  tax numeric not null default 0,
  stone numeric not null default 0,
  discount numeric not null default 0,
  old_value numeric not null default 0,
  total numeric not null default 0,
  weight_out numeric not null default 0,
  weight_in numeric not null default 0,
  settle jsonb not null default '{}'::jsonb,
  buyer jsonb not null default '{}'::jsonb,
  moadian jsonb not null default '{}'::jsonb,
  description text,
  voucher_id uuid,
  treasury_doc_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_gold_docs_no_uk on tz_gold_docs (org_id, fiscal_year_id, kind, no) where deleted_at is null;
create index if not exists tz_gold_docs_date_idx on tz_gold_docs (org_id, date);
create index if not exists tz_gold_docs_party_idx on tz_gold_docs (org_id, party_id);

create table if not exists tz_gold_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references tz_gold_docs(id) on delete cascade,
  org_id uuid not null,
  line_no int not null default 0,
  kind text not null,
  direction text not null default 'out',
  gold_item_id uuid,
  item_id uuid,
  category_id uuid,
  title text,
  form text,
  qty numeric not null default 1,
  fineness numeric,
  weight numeric not null default 0,
  weight750 numeric not null default 0,
  stone_weight numeric,
  gram_price numeric,
  gold_value numeric not null default 0,
  wage_type text,
  wage_value numeric,
  wage numeric not null default 0,
  profit_pct numeric,
  profit numeric not null default 0,
  tax numeric not null default 0,
  stone numeric not null default 0,
  deduction_pct numeric,
  discount numeric not null default 0,
  total numeric not null default 0,
  assay_no text,
  description text
);
create index if not exists tz_gold_lines_doc_idx on tz_gold_lines (doc_id);

insert into tz_migrations (id) values ('0005_gold') on conflict (id) do nothing;

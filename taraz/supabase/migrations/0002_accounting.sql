-- «تراز» migration 0002_accounting — حسابداری: سال مالی، کدینگ، اسناد
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0002_accounting — حسابداری: سال مالی، کدینگ، اسناد
-- ---------------------------------------------------------------------------
create table if not exists tz_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open',
  closed_at timestamptz,
  closed_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists tz_fiscal_years_org_idx on tz_fiscal_years (org_id, start_date);

create table if not exists tz_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  parent_id uuid,
  code text not null,
  name text not null,
  level smallint not null,
  kind text not null,
  nature text not null default 'both',
  is_postable boolean not null default false,
  detail_mode text not null default 'none',
  detail_kinds jsonb not null default '[]'::jsonb,
  fx_mode text not null default 'none',
  currency_id uuid,
  weight_mode text not null default 'none',
  system_key text,
  is_active boolean not null default true,
  sort int not null default 0,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_accounts_code_uk on tz_accounts (org_id, code) where deleted_at is null;
create unique index if not exists tz_accounts_key_uk on tz_accounts (org_id, system_key) where system_key is not null and deleted_at is null;
create index if not exists tz_accounts_parent_idx on tz_accounts (org_id, parent_id);

create table if not exists tz_details (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null default 'other',
  ref_id uuid,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_details_code_uk on tz_details (org_id, code) where deleted_at is null;
create index if not exists tz_details_ref_idx on tz_details (org_id, ref_id);

create table if not exists tz_vouchers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  no int not null,
  daily_no int,
  ref_no text,
  date date not null,
  kind text not null default 'normal',
  status text not null default 'draft',
  description text,
  source_type text,
  source_id uuid,
  total_debit numeric not null default 0,
  total_credit numeric not null default 0,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_vouchers_no_uk on tz_vouchers (org_id, fiscal_year_id, no) where deleted_at is null;
create index if not exists tz_vouchers_date_idx on tz_vouchers (org_id, date);
create index if not exists tz_vouchers_source_idx on tz_vouchers (org_id, source_type, source_id);

create table if not exists tz_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references tz_vouchers(id) on delete cascade,
  org_id uuid not null,
  line_no int not null default 0,
  account_id uuid not null,
  detail_id uuid,
  detail2_id uuid,
  description text,
  debit numeric not null default 0,
  credit numeric not null default 0,
  currency_id uuid,
  fx_debit numeric not null default 0,
  fx_credit numeric not null default 0,
  fx_rate numeric,
  w_debit numeric not null default 0,
  w_credit numeric not null default 0,
  fineness numeric,
  raw_weight numeric,
  qty numeric,
  item_id uuid,
  ref_type text,
  ref_id uuid,
  due_date date
);
create index if not exists tz_voucher_lines_voucher_idx on tz_voucher_lines (voucher_id);
create index if not exists tz_voucher_lines_account_idx on tz_voucher_lines (org_id, account_id);
create index if not exists tz_voucher_lines_detail_idx on tz_voucher_lines (org_id, detail_id);

insert into tz_migrations (id) values ('0002_accounting') on conflict (id) do nothing;

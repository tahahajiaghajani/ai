// Exchange (صرافی): currencies and crypto assets, rate board, deals (buy/sell/exchange of any
// pair), remittances (حواله) through correspondents, crypto wallets with live balances.
export default /* sql */ `
create table if not exists tz_currencies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  name text not null,
  symbol text,
  kind text not null default 'fiat',
  decimals int not null default 2,
  is_base boolean not null default false,
  price_ids jsonb not null default '{}'::jsonb,
  icon text,
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_currencies_code_uk on tz_currencies (org_id, code) where deleted_at is null;

create table if not exists tz_fx_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  currency_id uuid not null,
  quote_currency_id uuid,
  buy numeric,
  sell numeric,
  mid numeric,
  at timestamptz not null default now(),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists tz_fx_rates_idx on tz_fx_rates (org_id, currency_id, at desc);

create table if not exists tz_wallets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text,
  name text not null,
  currency_id uuid,
  chain text not null,
  address text not null,
  token_contract text,
  kind text not null default 'hot',
  owner_party_id uuid,
  detail_id uuid,
  last_balance numeric,
  last_checked_at timestamptz,
  last_error text,
  auto_check boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_fx_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  no int not null,
  date date not null,
  kind text not null,
  party_id uuid,
  walkin jsonb not null default '{}'::jsonb,
  in_currency_id uuid not null,
  in_amount numeric not null,
  in_method text not null default 'cash',
  in_ref_id uuid,
  out_currency_id uuid not null,
  out_amount numeric not null,
  out_method text not null default 'cash',
  out_ref_id uuid,
  rate numeric not null,
  fee numeric not null default 0,
  fee_currency_id uuid,
  base_value numeric,
  cost_value numeric,
  profit numeric,
  tx_hash text,
  network text,
  address text,
  status text not null default 'posted',
  description text,
  voucher_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_fx_deals_no_uk on tz_fx_deals (org_id, fiscal_year_id, no) where deleted_at is null;
create index if not exists tz_fx_deals_date_idx on tz_fx_deals (org_id, date);

create table if not exists tz_remittances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  no int not null,
  date date not null,
  direction text not null,
  party_id uuid,
  sender jsonb not null default '{}'::jsonb,
  beneficiary jsonb not null default '{}'::jsonb,
  correspondent_id uuid,
  currency_id uuid not null,
  amount numeric not null,
  rate numeric,
  base_amount numeric,
  fee numeric not null default 0,
  correspondent_fee numeric not null default 0,
  pay_method text not null default 'cash',
  pay_ref_id uuid,
  pay_currency_id uuid,
  pay_amount numeric,
  status text not null default 'pending',
  tracking_code text,
  paid_at timestamptz,
  description text,
  voucher_id uuid,
  history jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_remittances_no_uk on tz_remittances (org_id, fiscal_year_id, no) where deleted_at is null;
create index if not exists tz_remittances_status_idx on tz_remittances (org_id, status, date);
`;

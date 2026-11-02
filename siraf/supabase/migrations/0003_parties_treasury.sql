-- «تراز» migration 0003_parties_treasury — اشخاص و خزانه‌داری
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0003_parties_treasury — اشخاص و خزانه‌داری
-- ---------------------------------------------------------------------------
create table if not exists tz_party_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  name text not null,
  discount_pct numeric,
  price_list_id uuid,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_parties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  kind text not null default 'person',
  roles jsonb not null default '["customer"]'::jsonb,
  name text not null,
  first_name text,
  last_name text,
  company_name text,
  father_name text,
  national_id text,
  economic_code text,
  registration_no text,
  passport_no text,
  nationality text,
  birth_date date,
  id_doc_type text,
  id_doc_no text,
  id_doc_expiry date,
  kyc_status text not null default 'none',
  mobile text,
  phone text,
  email text,
  website text,
  province text,
  city text,
  address text,
  postal_code text,
  group_id uuid,
  price_list_id uuid,
  credit_limit numeric,
  discount_pct numeric,
  iban text,
  card_no text,
  bank_name text,
  detail_id uuid,
  tags jsonb not null default '[]'::jsonb,
  notes text,
  is_active boolean not null default true,
  is_blacklisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_parties_code_uk on tz_parties (org_id, code) where deleted_at is null;
create index if not exists tz_parties_name_idx on tz_parties (org_id, name);
create index if not exists tz_parties_mobile_idx on tz_parties (org_id, mobile);
create index if not exists tz_parties_nid_idx on tz_parties (org_id, national_id);

create table if not exists tz_cash_boxes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  name text not null,
  currency_id uuid,
  keeper_id uuid,
  detail_id uuid,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  code text not null,
  name text not null,
  bank_name text,
  branch_name text,
  branch_code text,
  account_no text,
  card_no text,
  iban text,
  owner_name text,
  account_type text not null default 'current',
  currency_id uuid,
  detail_id uuid,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_pos_terminals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  name text not null,
  terminal_no text,
  provider text,
  bank_account_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_cheque_books (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  bank_account_id uuid not null,
  title text not null,
  serial_from text,
  serial_to text,
  sheets int,
  received_at date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_cheques (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  direction text not null,
  sayad_no text,
  serial_no text,
  bank_name text,
  branch_name text,
  account_no text,
  account_owner text,
  party_id uuid,
  amount numeric not null,
  currency_id uuid,
  issue_date date,
  due_date date not null,
  status text not null,
  bank_account_id uuid,
  cheque_book_id uuid,
  holder_party_id uuid,
  description text,
  source_type text,
  source_id uuid,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists tz_cheques_due_idx on tz_cheques (org_id, direction, status, due_date);
create index if not exists tz_cheques_party_idx on tz_cheques (org_id, party_id);

create table if not exists tz_treasury_docs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  fiscal_year_id uuid not null,
  kind text not null,
  no int not null,
  date date not null,
  party_id uuid,
  account_id uuid,
  detail_id uuid,
  description text,
  total numeric not null default 0,
  status text not null default 'posted',
  voucher_id uuid,
  source_type text,
  source_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_treasury_docs_no_uk on tz_treasury_docs (org_id, fiscal_year_id, kind, no) where deleted_at is null;
create index if not exists tz_treasury_docs_date_idx on tz_treasury_docs (org_id, date);
create index if not exists tz_treasury_docs_party_idx on tz_treasury_docs (org_id, party_id);

create table if not exists tz_treasury_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references tz_treasury_docs(id) on delete cascade,
  org_id uuid not null,
  line_no int not null default 0,
  direction text not null default 'in',
  method text not null,
  cash_box_id uuid,
  bank_account_id uuid,
  pos_id uuid,
  wallet_id uuid,
  cheque_id uuid,
  account_id uuid,
  detail_id uuid,
  amount numeric not null default 0,
  currency_id uuid,
  fx_amount numeric,
  fx_rate numeric,
  fee numeric not null default 0,
  ref_no text,
  description text
);
create index if not exists tz_treasury_lines_doc_idx on tz_treasury_lines (doc_id);

create table if not exists tz_treasury_allocs (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references tz_treasury_docs(id) on delete cascade,
  org_id uuid not null,
  invoice_id uuid not null,
  amount numeric not null
);
create index if not exists tz_treasury_allocs_invoice_idx on tz_treasury_allocs (org_id, invoice_id);

insert into tz_migrations (id) values ('0003_parties_treasury') on conflict (id) do nothing;

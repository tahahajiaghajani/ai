-- ============================================================================
-- «تراز» — پایگاه داده‌ی کامل برای Supabase (PostgreSQL 15+)
-- این فایل را یک بار در Supabase ← SQL Editor ← New query بچسبانید و Run بزنید.
-- اجرای دوباره بی‌خطر است (همه‌ی دستورها idempotent هستند).
-- برنامه هم هنگام اجرا migrationهای جاافتاده را خودکار اعمال می‌کند (AUTO_MIGRATE).
-- این فایل خودکار از src/server/db/migrations ساخته می‌شود: npm run schema
-- ============================================================================

create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0001_core — هسته: کاربران، سازمان‌ها، همگام‌سازی
-- ---------------------------------------------------------------------------
create table if not exists tz_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

-- key/value store (desktop: sync cursors, device id, cloud link; cloud: platform settings)
create table if not exists tz_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- per-organisation revision counter: every write to a synced row takes the next value under a
-- row lock, so revisions of one organisation are handed out in commit order
create table if not exists tz_org_sync (
  org_id uuid primary key,
  rev bigint not null default 0
);

-- desktop only: aggregates changed locally and not yet pushed to the cloud
create table if not exists tz_outbox (
  entity text not null,
  id uuid not null,
  changed_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  primary key (entity, id)
);

create sequence if not exists tz_user_rev_seq;

create table if not exists tz_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  mobile text,
  password_hash text,
  recovery_hash text,
  is_platform_admin boolean not null default false,
  disabled boolean not null default false,
  prefs jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists tz_users_email_uk on tz_users (lower(email));

create table if not exists tz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references tz_users(id) on delete cascade,
  token_hash text not null,
  kind text not null default 'web',
  device_name text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists tz_sessions_user_idx on tz_sessions (user_id);

create table if not exists tz_orgs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid generated always as (id) stored,
  name text not null,
  legal_name text,
  business_kind text not null default 'trading',
  modules jsonb not null default '["goods"]'::jsonb,
  base_currency text not null default 'IRR',
  money_decimals int not null default 0,
  economic_code text,
  national_id text,
  registration_no text,
  phone text,
  mobile text,
  email text,
  website text,
  province text,
  city text,
  address text,
  postal_code text,
  logo text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'viewer',
  overrides jsonb not null default '{}'::jsonb,
  title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists tz_org_members_uk on tz_org_members (org_id, user_id);
create index if not exists tz_org_members_user_idx on tz_org_members (user_id);

-- desktops linked to an organisation in the cloud
create table if not exists tz_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  user_id uuid not null,
  name text not null default '',
  platform text,
  app_version text,
  last_push_at timestamptz,
  last_pull_at timestamptz,
  cursor bigint not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists tz_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  user_id uuid,
  at timestamptz not null default now(),
  action text not null,
  entity text,
  entity_id uuid,
  summary text,
  data jsonb,
  origin text
);
create index if not exists tz_audit_org_idx on tz_audit (org_id, at desc);

-- sync trigger for aggregate roots.
-- cloud: assigns the next per-organisation revision (and stamps updated_at unless a client's
--        version is being applied, which keeps the client's timestamp for last-writer-wins)
-- desktop (session setting taraz.mode = 'desktop'): records the aggregate in the outbox,
--        except while pulled cloud data is being applied (taraz.applying = 'on')
create or replace function tz_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
  v_applying boolean := coalesce(current_setting('taraz.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('taraz.mode', true), '') = 'desktop' then
    if not v_applying then
      insert into tz_outbox (entity, id, changed_at) values (tg_argv[0], new.id, now())
      on conflict (entity, id) do update set changed_at = excluded.changed_at, attempts = 0, last_error = null;
    end if;
    return new;
  end if;
  -- (tz_orgs.org_id is a generated column, still null inside a BEFORE trigger)
  insert into tz_org_sync (org_id, rev) values (coalesce(new.org_id, new.id), 1)
  on conflict (org_id) do update set rev = tz_org_sync.rev + 1
  returning rev into v_rev;
  new.rev := v_rev;
  return new;
end
$fn$;

create or replace function tz_user_touch() returns trigger language plpgsql as $fn$
begin
  if coalesce(current_setting('taraz.applying', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('taraz.mode', true), '') <> 'desktop' then
    new.rev := nextval('tz_user_rev_seq');
  end if;
  return new;
end
$fn$;

drop trigger if exists tz_users_touch on tz_users;
create trigger tz_users_touch before insert or update on tz_users
  for each row execute function tz_user_touch();

insert into tz_migrations (id) values ('0001_core') on conflict (id) do nothing;

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

-- ---------------------------------------------------------------------------
-- 0006_fx — صرافی و ارز دیجیتال
-- ---------------------------------------------------------------------------
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

insert into tz_migrations (id) values ('0006_fx') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0007_integrations_sync — اتصال‌ها، تریگرهای همگام‌سازی و امنیت
-- ---------------------------------------------------------------------------
create table if not exists tz_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes jsonb not null default '["read","write"]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists tz_api_keys_prefix_idx on tz_api_keys (prefix);

create table if not exists tz_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  kind text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  secret text,
  is_active boolean not null default true,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_integration_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  integration_id uuid,
  received_at timestamptz not null default now(),
  topic text,
  external_id text,
  payload jsonb,
  status text not null default 'received',
  result jsonb,
  error text
);
create index if not exists tz_integration_events_idx on tz_integration_events (org_id, received_at desc);
create unique index if not exists tz_integration_events_ext_uk on tz_integration_events (integration_id, topic, external_id) where external_id is not null;

-- attach the sync trigger to every aggregate root (entity name = trigger argument)
do $do$
declare
  r record;
begin
  for r in
    select * from (values
      ('tz_orgs', 'org'), ('tz_org_members', 'member'),
      ('tz_fiscal_years', 'fiscal_year'), ('tz_accounts', 'account'), ('tz_details', 'detail'), ('tz_vouchers', 'voucher'),
      ('tz_party_groups', 'party_group'), ('tz_parties', 'party'),
      ('tz_cash_boxes', 'cash_box'), ('tz_bank_accounts', 'bank_account'), ('tz_pos_terminals', 'pos_terminal'),
      ('tz_cheque_books', 'cheque_book'), ('tz_cheques', 'cheque'), ('tz_treasury_docs', 'treasury_doc'),
      ('tz_units', 'unit'), ('tz_item_categories', 'item_category'), ('tz_items', 'item'), ('tz_warehouses', 'warehouse'),
      ('tz_price_lists', 'price_list'), ('tz_stock_docs', 'stock_doc'), ('tz_invoices', 'invoice'),
      ('tz_gold_rates', 'gold_rate'), ('tz_gold_categories', 'gold_category'), ('tz_gold_items', 'gold_item'), ('tz_gold_docs', 'gold_doc'),
      ('tz_currencies', 'currency'), ('tz_fx_rates', 'fx_rate'), ('tz_wallets', 'wallet'), ('tz_fx_deals', 'fx_deal'), ('tz_remittances', 'remittance'),
      ('tz_integrations', 'integration')
    ) as t(tbl, entity)
  loop
    execute format('drop trigger if exists %I on %I', r.tbl || '_sync', r.tbl);
    execute format('create trigger %I before insert or update on %I for each row execute function tz_sync_touch(%L)', r.tbl || '_sync', r.tbl, r.entity);
  end loop;
end
$do$;

-- Supabase: every table is reachable only through the app's own server connection.
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'tz\_%' loop
    execute format('alter table %I enable row level security', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t.tablename);
    end if;
  end loop;
end
$do$;

insert into tz_migrations (id) values ('0007_integrations_sync') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0008_treasury — خزانه‌داری و چک
-- ---------------------------------------------------------------------------
create index if not exists tz_cheques_source_idx on tz_cheques (org_id, source_type, source_id);
create index if not exists tz_cheques_sayad_idx on tz_cheques (org_id, direction, sayad_no) where sayad_no is not null and deleted_at is null;
create index if not exists tz_cheques_book_idx on tz_cheques (org_id, cheque_book_id, serial_no) where cheque_book_id is not null and deleted_at is null;
create index if not exists tz_cheques_bank_idx on tz_cheques (org_id, bank_account_id, status) where deleted_at is null;
create index if not exists tz_cheques_history_idx on tz_cheques using gin (history jsonb_path_ops);
create index if not exists tz_treasury_docs_kind_idx on tz_treasury_docs (org_id, kind, date);
create index if not exists tz_treasury_lines_cheque_idx on tz_treasury_lines (cheque_id) where cheque_id is not null;
create index if not exists tz_treasury_allocs_doc_idx on tz_treasury_allocs (doc_id);

insert into tz_migrations (id) values ('0008_treasury') on conflict (id) do nothing;

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

-- ---------------------------------------------------------------------------
-- 0010_gold — طلا و جواهر (تکمیلی)
-- ---------------------------------------------------------------------------
alter table tz_gold_lines add column if not exists cost numeric;
alter table tz_gold_lines add column if not exists tag_no text;
alter table tz_gold_lines add column if not exists extra jsonb not null default '{}'::jsonb;

create index if not exists tz_gold_lines_item_idx on tz_gold_lines (org_id, gold_item_id);
create index if not exists tz_gold_docs_kind_idx on tz_gold_docs (org_id, kind, date);
create index if not exists tz_gold_items_in_doc_idx on tz_gold_items (org_id, in_doc_id);
create index if not exists tz_gold_items_out_doc_idx on tz_gold_items (org_id, out_doc_id);
create index if not exists tz_gold_items_category_idx on tz_gold_items (org_id, category_id, status);

insert into tz_migrations (id) values ('0010_gold') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0011_fx — صرافی و رمزارز (تکمیلی)
-- ---------------------------------------------------------------------------
alter table tz_fx_deals add column if not exists fee_base numeric;
alter table tz_fx_deals add column if not exists network_fee numeric not null default 0;
alter table tz_fx_deals add column if not exists avg_cost numeric;
alter table tz_fx_deals add column if not exists market_rate numeric;
alter table tz_fx_deals add column if not exists cancelled_at timestamptz;
alter table tz_fx_deals add column if not exists cancel_reason text;
create index if not exists tz_fx_deals_status_idx on tz_fx_deals (org_id, status, date);

alter table tz_remittances add column if not exists fee_base numeric;
alter table tz_remittances add column if not exists paid_date date;
alter table tz_remittances add column if not exists paid_voucher_id uuid;
create index if not exists tz_remittances_tracking_idx on tz_remittances (org_id, tracking_code);
create index if not exists tz_remittances_corr_idx on tz_remittances (org_id, correspondent_id, status);

create index if not exists tz_fx_rates_latest_idx on tz_fx_rates (org_id, currency_id, at desc)
  where deleted_at is null and quote_currency_id is null;
create index if not exists tz_voucher_lines_currency_idx on tz_voucher_lines (org_id, currency_id)
  where currency_id is not null;

insert into tz_migrations (id) values ('0011_fx') on conflict (id) do nothing;

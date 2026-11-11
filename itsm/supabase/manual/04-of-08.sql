-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۴ از ۸ (0006_engine_tables:12/30 … 0006_engine_tables:15/30)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۲ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 12/30 (a0c3bc7de847)
-- fiscal_period: دوره‌های مالی
do $cols$
begin
  if to_regclass('sm_fiscal_periods') is not null then
    alter table sm_fiscal_periods add column if not exists workspace_id uuid;
    alter table sm_fiscal_periods add column if not exists domain_id uuid;
    alter table sm_fiscal_periods add column if not exists unit_id uuid;
    alter table sm_fiscal_periods add column if not exists created_at timestamptz not null default now();
    alter table sm_fiscal_periods add column if not exists created_by uuid;
    alter table sm_fiscal_periods add column if not exists updated_at timestamptz not null default now();
    alter table sm_fiscal_periods add column if not exists updated_by uuid;
    alter table sm_fiscal_periods add column if not exists rev bigint not null default 0;
    alter table sm_fiscal_periods add column if not exists version integer not null default 1;
    alter table sm_fiscal_periods add column if not exists deleted_at timestamptz;
    alter table sm_fiscal_periods add column if not exists origin text;
    alter table sm_fiscal_periods add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_fiscal_periods add column if not exists fiscal_year_id uuid;
    alter table sm_fiscal_periods add column if not exists month integer;
    alter table sm_fiscal_periods add column if not exists key text;
    alter table sm_fiscal_periods add column if not exists name text;
    alter table sm_fiscal_periods add column if not exists start_date date;
    alter table sm_fiscal_periods add column if not exists end_date date;
    alter table sm_fiscal_periods add column if not exists status text;
  end if;
end
$cols$;
create table if not exists sm_fiscal_periods (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  fiscal_year_id uuid,
  month integer,
  key text,
  name text,
  start_date date,
  end_date date,
  status text
);
create index if not exists sm_fiscal_periods_rev_idx on sm_fiscal_periods (org_id, rev);
create index if not exists sm_fiscal_periods_upd_idx on sm_fiscal_periods (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_fiscal_periods_crt_idx on sm_fiscal_periods (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_fiscal_periods_fiscal_year_id_idx on sm_fiscal_periods (org_id, fiscal_year_id) where deleted_at is null;
create unique index if not exists sm_fiscal_periods_key_uk on sm_fiscal_periods (org_id, key) where deleted_at is null;
create unique index if not exists sm_fiscal_periods_fiscal_year_id_month_uk on sm_fiscal_periods (org_id, fiscal_year_id, month) where deleted_at is null;
drop trigger if exists sm_fiscal_periods_sync on sm_fiscal_periods;
create trigger sm_fiscal_periods_sync before insert or update on sm_fiscal_periods for each row execute function sm_sync_touch('fiscal_period');
create or replace trigger sm_fiscal_periods_demo after insert on sm_fiscal_periods for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_fiscal_periods_demo_t after update or delete on sm_fiscal_periods for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_fiscal_periods enable row level security;

-- fiscal_year: سال‌های مالی
do $cols$
begin
  if to_regclass('sm_fiscal_years') is not null then
    alter table sm_fiscal_years add column if not exists workspace_id uuid;
    alter table sm_fiscal_years add column if not exists domain_id uuid;
    alter table sm_fiscal_years add column if not exists unit_id uuid;
    alter table sm_fiscal_years add column if not exists created_at timestamptz not null default now();
    alter table sm_fiscal_years add column if not exists created_by uuid;
    alter table sm_fiscal_years add column if not exists updated_at timestamptz not null default now();
    alter table sm_fiscal_years add column if not exists updated_by uuid;
    alter table sm_fiscal_years add column if not exists rev bigint not null default 0;
    alter table sm_fiscal_years add column if not exists version integer not null default 1;
    alter table sm_fiscal_years add column if not exists deleted_at timestamptz;
    alter table sm_fiscal_years add column if not exists origin text;
    alter table sm_fiscal_years add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_fiscal_years add column if not exists name text;
    alter table sm_fiscal_years add column if not exists year integer;
    alter table sm_fiscal_years add column if not exists status text;
    alter table sm_fiscal_years add column if not exists start_date date;
    alter table sm_fiscal_years add column if not exists end_date date;
    alter table sm_fiscal_years add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_fiscal_years (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  year integer,
  status text,
  start_date date,
  end_date date,
  description text
);
create index if not exists sm_fiscal_years_rev_idx on sm_fiscal_years (org_id, rev);
create index if not exists sm_fiscal_years_upd_idx on sm_fiscal_years (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_fiscal_years_crt_idx on sm_fiscal_years (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_fiscal_years_year_uk on sm_fiscal_years (org_id, year) where deleted_at is null;
drop trigger if exists sm_fiscal_years_sync on sm_fiscal_years;
create trigger sm_fiscal_years_sync before insert or update on sm_fiscal_years for each row execute function sm_sync_touch('fiscal_year');
create or replace trigger sm_fiscal_years_demo after insert on sm_fiscal_years for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_fiscal_years_demo_t after update or delete on sm_fiscal_years for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_fiscal_years enable row level security;

-- flow: گردش‌کارها
do $cols$
begin
  if to_regclass('sm_flows') is not null then
    alter table sm_flows add column if not exists workspace_id uuid;
    alter table sm_flows add column if not exists domain_id uuid;
    alter table sm_flows add column if not exists unit_id uuid;
    alter table sm_flows add column if not exists created_at timestamptz not null default now();
    alter table sm_flows add column if not exists created_by uuid;
    alter table sm_flows add column if not exists updated_at timestamptz not null default now();
    alter table sm_flows add column if not exists updated_by uuid;
    alter table sm_flows add column if not exists rev bigint not null default 0;
    alter table sm_flows add column if not exists version integer not null default 1;
    alter table sm_flows add column if not exists deleted_at timestamptz;
    alter table sm_flows add column if not exists origin text;
    alter table sm_flows add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_flows add column if not exists name text;
    alter table sm_flows add column if not exists active boolean not null default false;
    alter table sm_flows add column if not exists dirty boolean not null default false;
    alter table sm_flows add column if not exists description text;
    alter table sm_flows add column if not exists trigger text;
    alter table sm_flows add column if not exists trigger_table text;
    alter table sm_flows add column if not exists trigger_events jsonb;
    alter table sm_flows add column if not exists trigger_fields jsonb;
    alter table sm_flows add column if not exists trigger_condition jsonb;
    alter table sm_flows add column if not exists schedule jsonb;
    alter table sm_flows add column if not exists catalog_item text;
    alter table sm_flows add column if not exists webhook_token text;
    alter table sm_flows add column if not exists run_as text;
    alter table sm_flows add column if not exists run_as_user uuid;
    alter table sm_flows add column if not exists graph jsonb;
    alter table sm_flows add column if not exists version_no integer;
    alter table sm_flows add column if not exists version_id uuid;
    alter table sm_flows add column if not exists published_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_flows (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default false,
  dirty boolean not null default false,
  description text,
  trigger text,
  trigger_table text,
  trigger_events jsonb,
  trigger_fields jsonb,
  trigger_condition jsonb,
  schedule jsonb,
  catalog_item text,
  webhook_token text,
  run_as text,
  run_as_user uuid,
  graph jsonb,
  version_no integer,
  version_id uuid,
  published_at timestamptz
);
create index if not exists sm_flows_rev_idx on sm_flows (org_id, rev);
create index if not exists sm_flows_upd_idx on sm_flows (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_flows_crt_idx on sm_flows (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_flows_trigger_table_idx on sm_flows (org_id, trigger_table) where deleted_at is null;
create unique index if not exists sm_flows_name_uk on sm_flows (org_id, name) where deleted_at is null;
drop trigger if exists sm_flows_sync on sm_flows;
create trigger sm_flows_sync before insert or update on sm_flows for each row execute function sm_sync_touch('flow');
create or replace trigger sm_flows_demo after insert on sm_flows for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_flows_demo_t after update or delete on sm_flows for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_flows enable row level security;

-- flow_connection: اتصال‌های HTTP
do $cols$
begin
  if to_regclass('sm_flow_connections') is not null then
    alter table sm_flow_connections add column if not exists workspace_id uuid;
    alter table sm_flow_connections add column if not exists domain_id uuid;
    alter table sm_flow_connections add column if not exists unit_id uuid;
    alter table sm_flow_connections add column if not exists created_at timestamptz not null default now();
    alter table sm_flow_connections add column if not exists created_by uuid;
    alter table sm_flow_connections add column if not exists updated_at timestamptz not null default now();
    alter table sm_flow_connections add column if not exists updated_by uuid;
    alter table sm_flow_connections add column if not exists rev bigint not null default 0;
    alter table sm_flow_connections add column if not exists version integer not null default 1;
    alter table sm_flow_connections add column if not exists deleted_at timestamptz;
    alter table sm_flow_connections add column if not exists origin text;
    alter table sm_flow_connections add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_flow_connections add column if not exists name text;
    alter table sm_flow_connections add column if not exists active boolean not null default true;
    alter table sm_flow_connections add column if not exists base_url text;
    alter table sm_flow_connections add column if not exists hosts jsonb;
    alter table sm_flow_connections add column if not exists auth text;
    alter table sm_flow_connections add column if not exists auth_name text;
    alter table sm_flow_connections add column if not exists username text;
    alter table sm_flow_connections add column if not exists secret text;
    alter table sm_flow_connections add column if not exists headers jsonb;
    alter table sm_flow_connections add column if not exists timeout integer;
    alter table sm_flow_connections add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_flow_connections (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  base_url text,
  hosts jsonb,
  auth text,
  auth_name text,
  username text,
  secret text,
  headers jsonb,
  timeout integer,
  description text
);
create index if not exists sm_flow_connections_rev_idx on sm_flow_connections (org_id, rev);
create index if not exists sm_flow_connections_upd_idx on sm_flow_connections (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_flow_connections_crt_idx on sm_flow_connections (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_flow_connections_name_uk on sm_flow_connections (org_id, name) where deleted_at is null;
drop trigger if exists sm_flow_connections_sync on sm_flow_connections;
create trigger sm_flow_connections_sync before insert or update on sm_flow_connections for each row execute function sm_sync_touch('flow_connection');
create or replace trigger sm_flow_connections_demo after insert on sm_flow_connections for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_flow_connections_demo_t after update or delete on sm_flow_connections for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_flow_connections enable row level security;

-- flow_version: نسخه‌های گردش‌کار
do $cols$
begin
  if to_regclass('sm_flow_versions') is not null then
    alter table sm_flow_versions add column if not exists workspace_id uuid;
    alter table sm_flow_versions add column if not exists domain_id uuid;
    alter table sm_flow_versions add column if not exists unit_id uuid;
    alter table sm_flow_versions add column if not exists created_at timestamptz not null default now();
    alter table sm_flow_versions add column if not exists created_by uuid;
    alter table sm_flow_versions add column if not exists updated_at timestamptz not null default now();
    alter table sm_flow_versions add column if not exists updated_by uuid;
    alter table sm_flow_versions add column if not exists rev bigint not null default 0;
    alter table sm_flow_versions add column if not exists version integer not null default 1;
    alter table sm_flow_versions add column if not exists deleted_at timestamptz;
    alter table sm_flow_versions add column if not exists origin text;
    alter table sm_flow_versions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_flow_versions add column if not exists title text;
    alter table sm_flow_versions add column if not exists flow_id uuid;
    alter table sm_flow_versions add column if not exists version_no integer;
    alter table sm_flow_versions add column if not exists note text;
    alter table sm_flow_versions add column if not exists trigger jsonb;
    alter table sm_flow_versions add column if not exists graph jsonb;
  end if;
end
$cols$;
create table if not exists sm_flow_versions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  title text,
  flow_id uuid,
  version_no integer,
  note text,
  trigger jsonb,
  graph jsonb
);
create index if not exists sm_flow_versions_rev_idx on sm_flow_versions (org_id, rev);
create index if not exists sm_flow_versions_upd_idx on sm_flow_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_flow_versions_crt_idx on sm_flow_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_flow_versions_flow_id_idx on sm_flow_versions (org_id, flow_id) where deleted_at is null;
create unique index if not exists sm_flow_versions_flow_id_version_no_uk on sm_flow_versions (org_id, flow_id, version_no) where deleted_at is null;
drop trigger if exists sm_flow_versions_sync on sm_flow_versions;
create trigger sm_flow_versions_sync before insert or update on sm_flow_versions for each row execute function sm_sync_touch('flow_version');
create or replace trigger sm_flow_versions_demo after insert on sm_flow_versions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_flow_versions_demo_t after update or delete on sm_flow_versions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_flow_versions enable row level security;

-- fsm_config: تنظیمات خدمات میدانی
do $cols$
begin
  if to_regclass('sm_fsm_config') is not null then
    alter table sm_fsm_config add column if not exists workspace_id uuid;
    alter table sm_fsm_config add column if not exists domain_id uuid;
    alter table sm_fsm_config add column if not exists unit_id uuid;
    alter table sm_fsm_config add column if not exists created_at timestamptz not null default now();
    alter table sm_fsm_config add column if not exists created_by uuid;
    alter table sm_fsm_config add column if not exists updated_at timestamptz not null default now();
    alter table sm_fsm_config add column if not exists updated_by uuid;
    alter table sm_fsm_config add column if not exists rev bigint not null default 0;
    alter table sm_fsm_config add column if not exists version integer not null default 1;
    alter table sm_fsm_config add column if not exists deleted_at timestamptz;
    alter table sm_fsm_config add column if not exists origin text;
    alter table sm_fsm_config add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_fsm_config add column if not exists name text;
    alter table sm_fsm_config add column if not exists config_key text;
    alter table sm_fsm_config add column if not exists default_group_id uuid;
    alter table sm_fsm_config add column if not exists travel_speed_kmh integer;
    alter table sm_fsm_config add column if not exists road_factor numeric;
    alter table sm_fsm_config add column if not exists arrival_target_minutes integer;
    alter table sm_fsm_config add column if not exists location_retention_days integer;
    alter table sm_fsm_config add column if not exists map_provider text;
    alter table sm_fsm_config add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_fsm_config (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  default_group_id uuid,
  travel_speed_kmh integer,
  road_factor numeric,
  arrival_target_minutes integer,
  location_retention_days integer,
  map_provider text,
  seeded integer
);
create index if not exists sm_fsm_config_rev_idx on sm_fsm_config (org_id, rev);
create index if not exists sm_fsm_config_upd_idx on sm_fsm_config (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_fsm_config_crt_idx on sm_fsm_config (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_fsm_config_config_key_uk on sm_fsm_config (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_fsm_config_sync on sm_fsm_config;
create trigger sm_fsm_config_sync before insert or update on sm_fsm_config for each row execute function sm_sync_touch('fsm_config');
create or replace trigger sm_fsm_config_demo after insert on sm_fsm_config for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_fsm_config_demo_t after update or delete on sm_fsm_config for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_fsm_config enable row level security;

-- goods_receipt: رسیدهای کالا
do $cols$
begin
  if to_regclass('sm_goods_receipts') is not null then
    alter table sm_goods_receipts add column if not exists workspace_id uuid;
    alter table sm_goods_receipts add column if not exists domain_id uuid;
    alter table sm_goods_receipts add column if not exists unit_id uuid;
    alter table sm_goods_receipts add column if not exists created_at timestamptz not null default now();
    alter table sm_goods_receipts add column if not exists created_by uuid;
    alter table sm_goods_receipts add column if not exists updated_at timestamptz not null default now();
    alter table sm_goods_receipts add column if not exists updated_by uuid;
    alter table sm_goods_receipts add column if not exists rev bigint not null default 0;
    alter table sm_goods_receipts add column if not exists version integer not null default 1;
    alter table sm_goods_receipts add column if not exists deleted_at timestamptz;
    alter table sm_goods_receipts add column if not exists origin text;
    alter table sm_goods_receipts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_goods_receipts add column if not exists no integer;
    alter table sm_goods_receipts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'GRN' || no::text else 'GRN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_goods_receipts add column if not exists po_id uuid;
    alter table sm_goods_receipts add column if not exists stockroom_id uuid;
    alter table sm_goods_receipts add column if not exists received_at timestamptz;
    alter table sm_goods_receipts add column if not exists received_by uuid;
    alter table sm_goods_receipts add column if not exists assets_created integer;
    alter table sm_goods_receipts add column if not exists note text;
    alter table sm_goods_receipts add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_goods_receipts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'GRN' || no::text else 'GRN' || lpad(no::text, 6, '0') end) stored,
  po_id uuid,
  stockroom_id uuid,
  received_at timestamptz,
  received_by uuid,
  assets_created integer,
  note text,
  state text
);
do $search$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_goods_receipts' and column_name ~ '^search_[0-9a-f]{8}$' loop
    execute format('alter table %I drop column if exists %I', 'sm_goods_receipts', old.column_name);
  end loop;
end
$search$;
create unique index if not exists sm_goods_receipts_no_uk on sm_goods_receipts (org_id, no);
create index if not exists sm_goods_receipts_rev_idx on sm_goods_receipts (org_id, rev);
create index if not exists sm_goods_receipts_upd_idx on sm_goods_receipts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_goods_receipts_crt_idx on sm_goods_receipts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_goods_receipts_po_id_idx on sm_goods_receipts (org_id, po_id) where deleted_at is null;
create index if not exists sm_goods_receipts_state_idx on sm_goods_receipts (org_id, state) where deleted_at is null;
drop trigger if exists sm_goods_receipts_sync on sm_goods_receipts;
create trigger sm_goods_receipts_sync before insert or update on sm_goods_receipts for each row execute function sm_sync_touch('goods_receipt');
create or replace trigger sm_goods_receipts_demo after insert on sm_goods_receipts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_goods_receipts_demo_t after update or delete on sm_goods_receipts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_goods_receipts enable row level security;

-- goods_receipt_line: سطرهای رسید کالا
do $cols$
begin
  if to_regclass('sm_goods_receipt_lines') is not null then
    alter table sm_goods_receipt_lines add column if not exists workspace_id uuid;
    alter table sm_goods_receipt_lines add column if not exists domain_id uuid;
    alter table sm_goods_receipt_lines add column if not exists unit_id uuid;
    alter table sm_goods_receipt_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_goods_receipt_lines add column if not exists created_by uuid;
    alter table sm_goods_receipt_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_goods_receipt_lines add column if not exists updated_by uuid;
    alter table sm_goods_receipt_lines add column if not exists rev bigint not null default 0;
    alter table sm_goods_receipt_lines add column if not exists version integer not null default 1;
    alter table sm_goods_receipt_lines add column if not exists deleted_at timestamptz;
    alter table sm_goods_receipt_lines add column if not exists origin text;
    alter table sm_goods_receipt_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_goods_receipt_lines add column if not exists receipt_id uuid;
    alter table sm_goods_receipt_lines add column if not exists po_line_id uuid;
    alter table sm_goods_receipt_lines add column if not exists model_id uuid;
    alter table sm_goods_receipt_lines add column if not exists quantity integer;
    alter table sm_goods_receipt_lines add column if not exists serials text;
    alter table sm_goods_receipt_lines add column if not exists asset_tags text;
    alter table sm_goods_receipt_lines add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_goods_receipt_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  receipt_id uuid,
  po_line_id uuid,
  model_id uuid,
  quantity integer,
  serials text,
  asset_tags text,
  label text
);
create index if not exists sm_goods_receipt_lines_rev_idx on sm_goods_receipt_lines (org_id, rev);
create index if not exists sm_goods_receipt_lines_upd_idx on sm_goods_receipt_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_goods_receipt_lines_crt_idx on sm_goods_receipt_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_goods_receipt_lines_receipt_id_idx on sm_goods_receipt_lines (org_id, receipt_id) where deleted_at is null;
drop trigger if exists sm_goods_receipt_lines_sync on sm_goods_receipt_lines;
create trigger sm_goods_receipt_lines_sync before insert or update on sm_goods_receipt_lines for each row execute function sm_sync_touch('goods_receipt_line');
create or replace trigger sm_goods_receipt_lines_demo after insert on sm_goods_receipt_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_goods_receipt_lines_demo_t after update or delete on sm_goods_receipt_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_goods_receipt_lines enable row level security;

-- grc_audit: ممیزی‌ها
do $cols$
begin
  if to_regclass('sm_grc_audits') is not null then
    alter table sm_grc_audits add column if not exists workspace_id uuid;
    alter table sm_grc_audits add column if not exists domain_id uuid;
    alter table sm_grc_audits add column if not exists unit_id uuid;
    alter table sm_grc_audits add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_audits add column if not exists created_by uuid;
    alter table sm_grc_audits add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_audits add column if not exists updated_by uuid;
    alter table sm_grc_audits add column if not exists rev bigint not null default 0;
    alter table sm_grc_audits add column if not exists version integer not null default 1;
    alter table sm_grc_audits add column if not exists deleted_at timestamptz;
    alter table sm_grc_audits add column if not exists origin text;
    alter table sm_grc_audits add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_audits add column if not exists no integer;
    alter table sm_grc_audits add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AUD' || no::text else 'AUD' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_audits add column if not exists title text;
    alter table sm_grc_audits add column if not exists kind text;
    alter table sm_grc_audits add column if not exists framework_id uuid;
    alter table sm_grc_audits add column if not exists lead_auditor_id uuid;
    alter table sm_grc_audits add column if not exists auditee_owner_id uuid;
    alter table sm_grc_audits add column if not exists auditors jsonb;
    alter table sm_grc_audits add column if not exists auditee_units jsonb;
    alter table sm_grc_audits add column if not exists assignment_group_id uuid;
    alter table sm_grc_audits add column if not exists planned_start date;
    alter table sm_grc_audits add column if not exists planned_end date;
    alter table sm_grc_audits add column if not exists scope_text text;
    alter table sm_grc_audits add column if not exists independence_ok boolean not null default false;
    alter table sm_grc_audits add column if not exists independence_note text;
    alter table sm_grc_audits add column if not exists conclusion text;
    alter table sm_grc_audits add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_audits (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AUD' || no::text else 'AUD' || lpad(no::text, 5, '0') end) stored,
  title text,
  kind text,
  framework_id uuid,
  lead_auditor_id uuid,
  auditee_owner_id uuid,
  auditors jsonb,
  auditee_units jsonb,
  assignment_group_id uuid,
  planned_start date,
  planned_end date,
  scope_text text,
  independence_ok boolean not null default false,
  independence_note text,
  conclusion text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_audits' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_audits', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_audits', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_audits' and indexname like 'sm\_grc\_audits\_search\_%' and indexname not in ('sm_grc_audits_search_cae18f1d_trgm', 'sm_grc_audits_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_audits_search_cae18f1d_trgm', 'sm_grc_audits', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_audits_search_custom_trgm', 'sm_grc_audits', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_audits_no_uk on sm_grc_audits (org_id, no);
create index if not exists sm_grc_audits_rev_idx on sm_grc_audits (org_id, rev);
create index if not exists sm_grc_audits_upd_idx on sm_grc_audits (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_audits_crt_idx on sm_grc_audits (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_audits_lead_auditor_id_idx on sm_grc_audits (org_id, lead_auditor_id) where deleted_at is null;
create index if not exists sm_grc_audits_state_idx on sm_grc_audits (org_id, state) where deleted_at is null;
create index if not exists sm_grc_audits_workspace_acc_idx on sm_grc_audits (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_audits_unit_acc_idx on sm_grc_audits (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_audits_domain_acc_idx on sm_grc_audits (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_audits_auditors_gin on sm_grc_audits using gin (auditors);
drop trigger if exists sm_grc_audits_sync on sm_grc_audits;
create trigger sm_grc_audits_sync before insert or update on sm_grc_audits for each row execute function sm_sync_touch('grc_audit');
create or replace trigger sm_grc_audits_demo after insert on sm_grc_audits for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_audits_demo_t after update or delete on sm_grc_audits for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_audits enable row level security;

-- grc_control: کتابخانهٔ کنترل‌ها
do $cols$
begin
  if to_regclass('sm_grc_controls') is not null then
    alter table sm_grc_controls add column if not exists workspace_id uuid;
    alter table sm_grc_controls add column if not exists domain_id uuid;
    alter table sm_grc_controls add column if not exists unit_id uuid;
    alter table sm_grc_controls add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_controls add column if not exists created_by uuid;
    alter table sm_grc_controls add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_controls add column if not exists updated_by uuid;
    alter table sm_grc_controls add column if not exists rev bigint not null default 0;
    alter table sm_grc_controls add column if not exists version integer not null default 1;
    alter table sm_grc_controls add column if not exists deleted_at timestamptz;
    alter table sm_grc_controls add column if not exists origin text;
    alter table sm_grc_controls add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_controls add column if not exists no integer;
    alter table sm_grc_controls add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CTL' || no::text else 'CTL' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_controls add column if not exists name text;
    alter table sm_grc_controls add column if not exists code text;
    alter table sm_grc_controls add column if not exists objective text;
    alter table sm_grc_controls add column if not exists owner_id uuid;
    alter table sm_grc_controls add column if not exists assignment_group_id uuid;
    alter table sm_grc_controls add column if not exists active boolean not null default true;
    alter table sm_grc_controls add column if not exists type text;
    alter table sm_grc_controls add column if not exists nature text;
    alter table sm_grc_controls add column if not exists frequency text;
    alter table sm_grc_controls add column if not exists cia jsonb;
    alter table sm_grc_controls add column if not exists concepts jsonb;
    alter table sm_grc_controls add column if not exists requirements jsonb;
    alter table sm_grc_controls add column if not exists implementation_status text;
    alter table sm_grc_controls add column if not exists effectiveness text;
    alter table sm_grc_controls add column if not exists test_procedure text;
    alter table sm_grc_controls add column if not exists last_tested_at timestamptz;
    alter table sm_grc_controls add column if not exists next_test_due date;
    alter table sm_grc_controls add column if not exists indicator text;
    alter table sm_grc_controls add column if not exists indicator_threshold numeric;
    alter table sm_grc_controls add column if not exists indicator_value numeric;
    alter table sm_grc_controls add column if not exists indicator_status text;
    alter table sm_grc_controls add column if not exists indicator_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_grc_controls (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CTL' || no::text else 'CTL' || lpad(no::text, 5, '0') end) stored,
  name text,
  code text,
  objective text,
  owner_id uuid,
  assignment_group_id uuid,
  active boolean not null default true,
  type text,
  nature text,
  frequency text,
  cia jsonb,
  concepts jsonb,
  requirements jsonb,
  implementation_status text,
  effectiveness text,
  test_procedure text,
  last_tested_at timestamptz,
  next_test_due date,
  indicator text,
  indicator_threshold numeric,
  indicator_value numeric,
  indicator_status text,
  indicator_at timestamptz,
  search_cbe8b512 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(code, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_controls' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cbe8b512' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_controls', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_controls', 'search_cbe8b512', $x$translate(coalesce(name, '') || ' ' || coalesce(code, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_controls' and indexname like 'sm\_grc\_controls\_search\_%' and indexname not in ('sm_grc_controls_search_cbe8b512_trgm', 'sm_grc_controls_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_controls_search_cbe8b512_trgm', 'sm_grc_controls', 'search_cbe8b512', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_controls_search_custom_trgm', 'sm_grc_controls', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_controls_no_uk on sm_grc_controls (org_id, no);
create index if not exists sm_grc_controls_rev_idx on sm_grc_controls (org_id, rev);
create index if not exists sm_grc_controls_upd_idx on sm_grc_controls (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_controls_crt_idx on sm_grc_controls (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_grc_controls_code_uk on sm_grc_controls (org_id, code) where deleted_at is null;
create index if not exists sm_grc_controls_owner_id_idx on sm_grc_controls (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_controls_assignment_group_id_idx on sm_grc_controls (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_grc_controls_workspace_acc_idx on sm_grc_controls (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_controls_unit_acc_idx on sm_grc_controls (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_controls_domain_acc_idx on sm_grc_controls (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_controls_open_grp_idx on sm_grc_controls (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_grc_controls_sync on sm_grc_controls;
create trigger sm_grc_controls_sync before insert or update on sm_grc_controls for each row execute function sm_sync_touch('grc_control');
create or replace trigger sm_grc_controls_demo after insert on sm_grc_controls for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_controls_demo_t after update or delete on sm_grc_controls for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_controls enable row level security;

-- grc_control_test: آزمون‌ها و خودارزیابی‌های کنترل
do $cols$
begin
  if to_regclass('sm_grc_control_tests') is not null then
    alter table sm_grc_control_tests add column if not exists workspace_id uuid;
    alter table sm_grc_control_tests add column if not exists domain_id uuid;
    alter table sm_grc_control_tests add column if not exists unit_id uuid;
    alter table sm_grc_control_tests add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_control_tests add column if not exists created_by uuid;
    alter table sm_grc_control_tests add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_control_tests add column if not exists updated_by uuid;
    alter table sm_grc_control_tests add column if not exists rev bigint not null default 0;
    alter table sm_grc_control_tests add column if not exists version integer not null default 1;
    alter table sm_grc_control_tests add column if not exists deleted_at timestamptz;
    alter table sm_grc_control_tests add column if not exists origin text;
    alter table sm_grc_control_tests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_control_tests add column if not exists no integer;
    alter table sm_grc_control_tests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'TST' || no::text else 'TST' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_control_tests add column if not exists control_id uuid;
    alter table sm_grc_control_tests add column if not exists kind text;
    alter table sm_grc_control_tests add column if not exists planned_for date;
    alter table sm_grc_control_tests add column if not exists tester_id uuid;
    alter table sm_grc_control_tests add column if not exists assignment_group_id uuid;
    alter table sm_grc_control_tests add column if not exists period_start date;
    alter table sm_grc_control_tests add column if not exists period_end date;
    alter table sm_grc_control_tests add column if not exists population integer;
    alter table sm_grc_control_tests add column if not exists sample_size integer;
    alter table sm_grc_control_tests add column if not exists exceptions integer;
    alter table sm_grc_control_tests add column if not exists procedure text;
    alter table sm_grc_control_tests add column if not exists result_notes text;
    alter table sm_grc_control_tests add column if not exists conclusion text;
    alter table sm_grc_control_tests add column if not exists evidence_hash text;
    alter table sm_grc_control_tests add column if not exists completed_at timestamptz;
    alter table sm_grc_control_tests add column if not exists issue_id uuid;
    alter table sm_grc_control_tests add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_control_tests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'TST' || no::text else 'TST' || lpad(no::text, 6, '0') end) stored,
  control_id uuid,
  kind text,
  planned_for date,
  tester_id uuid,
  assignment_group_id uuid,
  period_start date,
  period_end date,
  population integer,
  sample_size integer,
  exceptions integer,
  procedure text,
  result_notes text,
  conclusion text,
  evidence_hash text,
  completed_at timestamptz,
  issue_id uuid,
  state text
);
do $search$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_control_tests' and column_name ~ '^search_[0-9a-f]{8}$' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_control_tests', old.column_name);
  end loop;
end
$search$;
create unique index if not exists sm_grc_control_tests_no_uk on sm_grc_control_tests (org_id, no);
create index if not exists sm_grc_control_tests_rev_idx on sm_grc_control_tests (org_id, rev);
create index if not exists sm_grc_control_tests_upd_idx on sm_grc_control_tests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_control_tests_crt_idx on sm_grc_control_tests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_control_tests_control_id_idx on sm_grc_control_tests (org_id, control_id) where deleted_at is null;
create index if not exists sm_grc_control_tests_tester_id_idx on sm_grc_control_tests (org_id, tester_id) where deleted_at is null;
create index if not exists sm_grc_control_tests_state_idx on sm_grc_control_tests (org_id, state) where deleted_at is null;
create index if not exists sm_grc_control_tests_workspace_acc_idx on sm_grc_control_tests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_control_tests_unit_acc_idx on sm_grc_control_tests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_control_tests_domain_acc_idx on sm_grc_control_tests (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_control_tests_sync on sm_grc_control_tests;
create trigger sm_grc_control_tests_sync before insert or update on sm_grc_control_tests for each row execute function sm_sync_touch('grc_control_test');
create or replace trigger sm_grc_control_tests_demo after insert on sm_grc_control_tests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_control_tests_demo_t after update or delete on sm_grc_control_tests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_control_tests enable row level security;

-- grc_csf_profile: پروفایل‌های NIST CSF
do $cols$
begin
  if to_regclass('sm_grc_csf_profiles') is not null then
    alter table sm_grc_csf_profiles add column if not exists workspace_id uuid;
    alter table sm_grc_csf_profiles add column if not exists domain_id uuid;
    alter table sm_grc_csf_profiles add column if not exists unit_id uuid;
    alter table sm_grc_csf_profiles add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_csf_profiles add column if not exists created_by uuid;
    alter table sm_grc_csf_profiles add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_csf_profiles add column if not exists updated_by uuid;
    alter table sm_grc_csf_profiles add column if not exists rev bigint not null default 0;
    alter table sm_grc_csf_profiles add column if not exists version integer not null default 1;
    alter table sm_grc_csf_profiles add column if not exists deleted_at timestamptz;
    alter table sm_grc_csf_profiles add column if not exists origin text;
    alter table sm_grc_csf_profiles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_csf_profiles add column if not exists no integer;
    alter table sm_grc_csf_profiles add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PRF' || no::text else 'PRF' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_csf_profiles add column if not exists name text;
    alter table sm_grc_csf_profiles add column if not exists kind text;
    alter table sm_grc_csf_profiles add column if not exists owner_id uuid;
    alter table sm_grc_csf_profiles add column if not exists assignment_group_id uuid;
    alter table sm_grc_csf_profiles add column if not exists tier text;
    alter table sm_grc_csf_profiles add column if not exists target_tier text;
    alter table sm_grc_csf_profiles add column if not exists scope_text text;
    alter table sm_grc_csf_profiles add column if not exists items jsonb;
    alter table sm_grc_csf_profiles add column if not exists gap_total integer;
    alter table sm_grc_csf_profiles add column if not exists scored integer;
    alter table sm_grc_csf_profiles add column if not exists action_plan text;
  end if;
end
$cols$;
create table if not exists sm_grc_csf_profiles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PRF' || no::text else 'PRF' || lpad(no::text, 5, '0') end) stored,
  name text,
  kind text,
  owner_id uuid,
  assignment_group_id uuid,
  tier text,
  target_tier text,
  scope_text text,
  items jsonb,
  gap_total integer,
  scored integer,
  action_plan text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_csf_profiles' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_csf_profiles', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_csf_profiles', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_csf_profiles' and indexname like 'sm\_grc\_csf\_profiles\_search\_%' and indexname not in ('sm_grc_csf_profiles_search_56291d9d_trgm', 'sm_grc_csf_profiles_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_csf_profiles_search_56291d9d_trgm', 'sm_grc_csf_profiles', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_csf_profiles_search_custom_trgm', 'sm_grc_csf_profiles', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_csf_profiles_no_uk on sm_grc_csf_profiles (org_id, no);
create index if not exists sm_grc_csf_profiles_rev_idx on sm_grc_csf_profiles (org_id, rev);
create index if not exists sm_grc_csf_profiles_upd_idx on sm_grc_csf_profiles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_csf_profiles_crt_idx on sm_grc_csf_profiles (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_csf_profiles_workspace_acc_idx on sm_grc_csf_profiles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_csf_profiles_unit_acc_idx on sm_grc_csf_profiles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_csf_profiles_domain_acc_idx on sm_grc_csf_profiles (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_csf_profiles_owner_id_idx on sm_grc_csf_profiles (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_grc_csf_profiles_sync on sm_grc_csf_profiles;
create trigger sm_grc_csf_profiles_sync before insert or update on sm_grc_csf_profiles for each row execute function sm_sync_touch('grc_csf_profile');
create or replace trigger sm_grc_csf_profiles_demo after insert on sm_grc_csf_profiles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_csf_profiles_demo_t after update or delete on sm_grc_csf_profiles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_csf_profiles enable row level security;

-- grc_dsr: درخواست‌های صاحبان داده
do $cols$
begin
  if to_regclass('sm_grc_dsrs') is not null then
    alter table sm_grc_dsrs add column if not exists workspace_id uuid;
    alter table sm_grc_dsrs add column if not exists domain_id uuid;
    alter table sm_grc_dsrs add column if not exists unit_id uuid;
    alter table sm_grc_dsrs add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_dsrs add column if not exists created_by uuid;
    alter table sm_grc_dsrs add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_dsrs add column if not exists updated_by uuid;
    alter table sm_grc_dsrs add column if not exists rev bigint not null default 0;
    alter table sm_grc_dsrs add column if not exists version integer not null default 1;
    alter table sm_grc_dsrs add column if not exists deleted_at timestamptz;
    alter table sm_grc_dsrs add column if not exists origin text;
    alter table sm_grc_dsrs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_dsrs add column if not exists no integer;
    alter table sm_grc_dsrs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DSR' || no::text else 'DSR' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_dsrs add column if not exists subject_name text;
    alter table sm_grc_dsrs add column if not exists subject_contact text;
    alter table sm_grc_dsrs add column if not exists kind text;
    alter table sm_grc_dsrs add column if not exists received_at timestamptz;
    alter table sm_grc_dsrs add column if not exists due_at timestamptz;
    alter table sm_grc_dsrs add column if not exists ropa_id uuid;
    alter table sm_grc_dsrs add column if not exists assigned_to uuid;
    alter table sm_grc_dsrs add column if not exists assignment_group_id uuid;
    alter table sm_grc_dsrs add column if not exists details text;
    alter table sm_grc_dsrs add column if not exists response text;
    alter table sm_grc_dsrs add column if not exists overdue boolean not null default false;
    alter table sm_grc_dsrs add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_dsrs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DSR' || no::text else 'DSR' || lpad(no::text, 6, '0') end) stored,
  subject_name text,
  subject_contact text,
  kind text,
  received_at timestamptz,
  due_at timestamptz,
  ropa_id uuid,
  assigned_to uuid,
  assignment_group_id uuid,
  details text,
  response text,
  overdue boolean not null default false,
  state text
);
do $search$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_dsrs' and column_name ~ '^search_[0-9a-f]{8}$' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_dsrs', old.column_name);
  end loop;
end
$search$;
create unique index if not exists sm_grc_dsrs_no_uk on sm_grc_dsrs (org_id, no);
create index if not exists sm_grc_dsrs_rev_idx on sm_grc_dsrs (org_id, rev);
create index if not exists sm_grc_dsrs_upd_idx on sm_grc_dsrs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_dsrs_crt_idx on sm_grc_dsrs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_dsrs_state_idx on sm_grc_dsrs (org_id, state) where deleted_at is null;
create index if not exists sm_grc_dsrs_workspace_acc_idx on sm_grc_dsrs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_dsrs_unit_acc_idx on sm_grc_dsrs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_dsrs_domain_acc_idx on sm_grc_dsrs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_dsrs_assigned_to_idx on sm_grc_dsrs (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_grc_dsrs_sync on sm_grc_dsrs;
create trigger sm_grc_dsrs_sync before insert or update on sm_grc_dsrs for each row execute function sm_sync_touch('grc_dsr');
create or replace trigger sm_grc_dsrs_demo after insert on sm_grc_dsrs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_dsrs_demo_t after update or delete on sm_grc_dsrs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_dsrs enable row level security;

-- grc_evidence: شواهد انطباق
do $cols$
begin
  if to_regclass('sm_grc_evidence') is not null then
    alter table sm_grc_evidence add column if not exists workspace_id uuid;
    alter table sm_grc_evidence add column if not exists domain_id uuid;
    alter table sm_grc_evidence add column if not exists unit_id uuid;
    alter table sm_grc_evidence add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_evidence add column if not exists created_by uuid;
    alter table sm_grc_evidence add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_evidence add column if not exists updated_by uuid;
    alter table sm_grc_evidence add column if not exists rev bigint not null default 0;
    alter table sm_grc_evidence add column if not exists version integer not null default 1;
    alter table sm_grc_evidence add column if not exists deleted_at timestamptz;
    alter table sm_grc_evidence add column if not exists origin text;
    alter table sm_grc_evidence add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_evidence add column if not exists no integer;
    alter table sm_grc_evidence add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EVI' || no::text else 'EVI' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_evidence add column if not exists title text;
    alter table sm_grc_evidence add column if not exists kind text;
    alter table sm_grc_evidence add column if not exists control_id uuid;
    alter table sm_grc_evidence add column if not exists test_id uuid;
    alter table sm_grc_evidence add column if not exists audit_id uuid;
    alter table sm_grc_evidence add column if not exists finding_id uuid;
    alter table sm_grc_evidence add column if not exists requirement_id uuid;
    alter table sm_grc_evidence add column if not exists period_start date;
    alter table sm_grc_evidence add column if not exists period_end date;
    alter table sm_grc_evidence add column if not exists due_at date;
    alter table sm_grc_evidence add column if not exists owner_id uuid;
    alter table sm_grc_evidence add column if not exists assignment_group_id uuid;
    alter table sm_grc_evidence add column if not exists sha256 text;
    alter table sm_grc_evidence add column if not exists submitted_at timestamptz;
    alter table sm_grc_evidence add column if not exists description text;
    alter table sm_grc_evidence add column if not exists review_notes text;
    alter table sm_grc_evidence add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_evidence (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EVI' || no::text else 'EVI' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  control_id uuid,
  test_id uuid,
  audit_id uuid,
  finding_id uuid,
  requirement_id uuid,
  period_start date,
  period_end date,
  due_at date,
  owner_id uuid,
  assignment_group_id uuid,
  sha256 text,
  submitted_at timestamptz,
  description text,
  review_notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_evidence' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_evidence', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_evidence', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_evidence' and indexname like 'sm\_grc\_evidence\_search\_%' and indexname not in ('sm_grc_evidence_search_cae18f1d_trgm', 'sm_grc_evidence_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_evidence_search_cae18f1d_trgm', 'sm_grc_evidence', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_evidence_search_custom_trgm', 'sm_grc_evidence', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_evidence_no_uk on sm_grc_evidence (org_id, no);
create index if not exists sm_grc_evidence_rev_idx on sm_grc_evidence (org_id, rev);
create index if not exists sm_grc_evidence_upd_idx on sm_grc_evidence (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_evidence_crt_idx on sm_grc_evidence (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_evidence_control_id_idx on sm_grc_evidence (org_id, control_id) where deleted_at is null;
create index if not exists sm_grc_evidence_test_id_idx on sm_grc_evidence (org_id, test_id) where deleted_at is null;
create index if not exists sm_grc_evidence_audit_id_idx on sm_grc_evidence (org_id, audit_id) where deleted_at is null;
create index if not exists sm_grc_evidence_owner_id_idx on sm_grc_evidence (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_evidence_state_idx on sm_grc_evidence (org_id, state) where deleted_at is null;
create index if not exists sm_grc_evidence_workspace_acc_idx on sm_grc_evidence (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_evidence_unit_acc_idx on sm_grc_evidence (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_evidence_domain_acc_idx on sm_grc_evidence (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_evidence_sync on sm_grc_evidence;
create trigger sm_grc_evidence_sync before insert or update on sm_grc_evidence for each row execute function sm_sync_touch('grc_evidence');
create or replace trigger sm_grc_evidence_demo after insert on sm_grc_evidence for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_evidence_demo_t after update or delete on sm_grc_evidence for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_evidence enable row level security;

-- grc_finding: یافته‌های ممیزی
do $cols$
begin
  if to_regclass('sm_grc_findings') is not null then
    alter table sm_grc_findings add column if not exists workspace_id uuid;
    alter table sm_grc_findings add column if not exists domain_id uuid;
    alter table sm_grc_findings add column if not exists unit_id uuid;
    alter table sm_grc_findings add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_findings add column if not exists created_by uuid;
    alter table sm_grc_findings add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_findings add column if not exists updated_by uuid;
    alter table sm_grc_findings add column if not exists rev bigint not null default 0;
    alter table sm_grc_findings add column if not exists version integer not null default 1;
    alter table sm_grc_findings add column if not exists deleted_at timestamptz;
    alter table sm_grc_findings add column if not exists origin text;
    alter table sm_grc_findings add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_findings add column if not exists no integer;
    alter table sm_grc_findings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'FND' || no::text else 'FND' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_findings add column if not exists title text;
    alter table sm_grc_findings add column if not exists audit_id uuid;
    alter table sm_grc_findings add column if not exists kind text;
    alter table sm_grc_findings add column if not exists requirement_id uuid;
    alter table sm_grc_findings add column if not exists control_id uuid;
    alter table sm_grc_findings add column if not exists owner_id uuid;
    alter table sm_grc_findings add column if not exists assignment_group_id uuid;
    alter table sm_grc_findings add column if not exists due_at date;
    alter table sm_grc_findings add column if not exists description text;
    alter table sm_grc_findings add column if not exists root_cause text;
    alter table sm_grc_findings add column if not exists action_plan text;
    alter table sm_grc_findings add column if not exists overdue boolean not null default false;
    alter table sm_grc_findings add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_findings (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'FND' || no::text else 'FND' || lpad(no::text, 6, '0') end) stored,
  title text,
  audit_id uuid,
  kind text,
  requirement_id uuid,
  control_id uuid,
  owner_id uuid,
  assignment_group_id uuid,
  due_at date,
  description text,
  root_cause text,
  action_plan text,
  overdue boolean not null default false,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_findings' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_findings', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_findings', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_findings' and indexname like 'sm\_grc\_findings\_search\_%' and indexname not in ('sm_grc_findings_search_cae18f1d_trgm', 'sm_grc_findings_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_findings_search_cae18f1d_trgm', 'sm_grc_findings', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_findings_search_custom_trgm', 'sm_grc_findings', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_findings_no_uk on sm_grc_findings (org_id, no);
create index if not exists sm_grc_findings_rev_idx on sm_grc_findings (org_id, rev);
create index if not exists sm_grc_findings_upd_idx on sm_grc_findings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_findings_crt_idx on sm_grc_findings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_findings_audit_id_idx on sm_grc_findings (org_id, audit_id) where deleted_at is null;
create index if not exists sm_grc_findings_owner_id_idx on sm_grc_findings (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_findings_state_idx on sm_grc_findings (org_id, state) where deleted_at is null;
create index if not exists sm_grc_findings_workspace_acc_idx on sm_grc_findings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_findings_unit_acc_idx on sm_grc_findings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_findings_domain_acc_idx on sm_grc_findings (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_findings_sync on sm_grc_findings;
create trigger sm_grc_findings_sync before insert or update on sm_grc_findings for each row execute function sm_sync_touch('grc_finding');
create or replace trigger sm_grc_findings_demo after insert on sm_grc_findings for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_findings_demo_t after update or delete on sm_grc_findings for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_findings enable row level security;

-- grc_framework: چارچوب‌ها و مقررات
do $cols$
begin
  if to_regclass('sm_grc_frameworks') is not null then
    alter table sm_grc_frameworks add column if not exists workspace_id uuid;
    alter table sm_grc_frameworks add column if not exists domain_id uuid;
    alter table sm_grc_frameworks add column if not exists unit_id uuid;
    alter table sm_grc_frameworks add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_frameworks add column if not exists created_by uuid;
    alter table sm_grc_frameworks add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_frameworks add column if not exists updated_by uuid;
    alter table sm_grc_frameworks add column if not exists rev bigint not null default 0;
    alter table sm_grc_frameworks add column if not exists version integer not null default 1;
    alter table sm_grc_frameworks add column if not exists deleted_at timestamptz;
    alter table sm_grc_frameworks add column if not exists origin text;
    alter table sm_grc_frameworks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_frameworks add column if not exists name text;
    alter table sm_grc_frameworks add column if not exists key text;
    alter table sm_grc_frameworks add column if not exists active boolean not null default true;
    alter table sm_grc_frameworks add column if not exists kind text;
    alter table sm_grc_frameworks add column if not exists edition text;
    alter table sm_grc_frameworks add column if not exists publisher text;
    alter table sm_grc_frameworks add column if not exists placeholder boolean not null default false;
    alter table sm_grc_frameworks add column if not exists requirement_count integer;
    alter table sm_grc_frameworks add column if not exists compliance_pct numeric;
    alter table sm_grc_frameworks add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_grc_frameworks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  key text,
  active boolean not null default true,
  kind text,
  edition text,
  publisher text,
  placeholder boolean not null default false,
  requirement_count integer,
  compliance_pct numeric,
  description text
);
create index if not exists sm_grc_frameworks_rev_idx on sm_grc_frameworks (org_id, rev);
create index if not exists sm_grc_frameworks_upd_idx on sm_grc_frameworks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_frameworks_crt_idx on sm_grc_frameworks (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_grc_frameworks_key_uk on sm_grc_frameworks (org_id, key) where deleted_at is null;
drop trigger if exists sm_grc_frameworks_sync on sm_grc_frameworks;
create trigger sm_grc_frameworks_sync before insert or update on sm_grc_frameworks for each row execute function sm_sync_touch('grc_framework');
create or replace trigger sm_grc_frameworks_demo after insert on sm_grc_frameworks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_frameworks_demo_t after update or delete on sm_grc_frameworks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_frameworks enable row level security;

-- grc_issue: مسائل و رفع آن‌ها
do $cols$
begin
  if to_regclass('sm_grc_issues') is not null then
    alter table sm_grc_issues add column if not exists workspace_id uuid;
    alter table sm_grc_issues add column if not exists domain_id uuid;
    alter table sm_grc_issues add column if not exists unit_id uuid;
    alter table sm_grc_issues add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_issues add column if not exists created_by uuid;
    alter table sm_grc_issues add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_issues add column if not exists updated_by uuid;
    alter table sm_grc_issues add column if not exists rev bigint not null default 0;
    alter table sm_grc_issues add column if not exists version integer not null default 1;
    alter table sm_grc_issues add column if not exists deleted_at timestamptz;
    alter table sm_grc_issues add column if not exists origin text;
    alter table sm_grc_issues add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_issues add column if not exists no integer;
    alter table sm_grc_issues add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ISS' || no::text else 'ISS' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_issues add column if not exists title text;
    alter table sm_grc_issues add column if not exists source text;
    alter table sm_grc_issues add column if not exists severity text;
    alter table sm_grc_issues add column if not exists due_at date;
    alter table sm_grc_issues add column if not exists control_id uuid;
    alter table sm_grc_issues add column if not exists test_id uuid;
    alter table sm_grc_issues add column if not exists finding_id uuid;
    alter table sm_grc_issues add column if not exists risk_id uuid;
    alter table sm_grc_issues add column if not exists owner_id uuid;
    alter table sm_grc_issues add column if not exists assignment_group_id uuid;
    alter table sm_grc_issues add column if not exists description text;
    alter table sm_grc_issues add column if not exists remediation_plan text;
    alter table sm_grc_issues add column if not exists overdue boolean not null default false;
    alter table sm_grc_issues add column if not exists notes text;
    alter table sm_grc_issues add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_issues (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ISS' || no::text else 'ISS' || lpad(no::text, 6, '0') end) stored,
  title text,
  source text,
  severity text,
  due_at date,
  control_id uuid,
  test_id uuid,
  finding_id uuid,
  risk_id uuid,
  owner_id uuid,
  assignment_group_id uuid,
  description text,
  remediation_plan text,
  overdue boolean not null default false,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_issues' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_issues', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_issues', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_issues' and indexname like 'sm\_grc\_issues\_search\_%' and indexname not in ('sm_grc_issues_search_cae18f1d_trgm', 'sm_grc_issues_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_issues_search_cae18f1d_trgm', 'sm_grc_issues', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_issues_search_custom_trgm', 'sm_grc_issues', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_issues_no_uk on sm_grc_issues (org_id, no);
create index if not exists sm_grc_issues_rev_idx on sm_grc_issues (org_id, rev);
create index if not exists sm_grc_issues_upd_idx on sm_grc_issues (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_issues_crt_idx on sm_grc_issues (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_issues_control_id_idx on sm_grc_issues (org_id, control_id) where deleted_at is null;
create index if not exists sm_grc_issues_owner_id_idx on sm_grc_issues (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_issues_assignment_group_id_idx on sm_grc_issues (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_grc_issues_state_idx on sm_grc_issues (org_id, state) where deleted_at is null;
create index if not exists sm_grc_issues_workspace_acc_idx on sm_grc_issues (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_issues_unit_acc_idx on sm_grc_issues (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_issues_domain_acc_idx on sm_grc_issues (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_issues_sync on sm_grc_issues;
create trigger sm_grc_issues_sync before insert or update on sm_grc_issues for each row execute function sm_sync_touch('grc_issue');
create or replace trigger sm_grc_issues_demo after insert on sm_grc_issues for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_issues_demo_t after update or delete on sm_grc_issues for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_issues enable row level security;

-- grc_kri: شاخص‌های کلیدی ریسک
do $cols$
begin
  if to_regclass('sm_grc_kris') is not null then
    alter table sm_grc_kris add column if not exists workspace_id uuid;
    alter table sm_grc_kris add column if not exists domain_id uuid;
    alter table sm_grc_kris add column if not exists unit_id uuid;
    alter table sm_grc_kris add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_kris add column if not exists created_by uuid;
    alter table sm_grc_kris add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_kris add column if not exists updated_by uuid;
    alter table sm_grc_kris add column if not exists rev bigint not null default 0;
    alter table sm_grc_kris add column if not exists version integer not null default 1;
    alter table sm_grc_kris add column if not exists deleted_at timestamptz;
    alter table sm_grc_kris add column if not exists origin text;
    alter table sm_grc_kris add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_kris add column if not exists name text;
    alter table sm_grc_kris add column if not exists risk_id uuid;
    alter table sm_grc_kris add column if not exists indicator text;
    alter table sm_grc_kris add column if not exists direction text;
    alter table sm_grc_kris add column if not exists warn_at numeric;
    alter table sm_grc_kris add column if not exists breach_at numeric;
    alter table sm_grc_kris add column if not exists owner_id uuid;
    alter table sm_grc_kris add column if not exists assignment_group_id uuid;
    alter table sm_grc_kris add column if not exists last_value numeric;
    alter table sm_grc_kris add column if not exists status text;
    alter table sm_grc_kris add column if not exists measured_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_grc_kris (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  risk_id uuid,
  indicator text,
  direction text,
  warn_at numeric,
  breach_at numeric,
  owner_id uuid,
  assignment_group_id uuid,
  last_value numeric,
  status text,
  measured_at timestamptz
);
create index if not exists sm_grc_kris_rev_idx on sm_grc_kris (org_id, rev);
create index if not exists sm_grc_kris_upd_idx on sm_grc_kris (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_kris_crt_idx on sm_grc_kris (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_kris_risk_id_idx on sm_grc_kris (org_id, risk_id) where deleted_at is null;
create index if not exists sm_grc_kris_workspace_acc_idx on sm_grc_kris (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_kris_unit_acc_idx on sm_grc_kris (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_kris_domain_acc_idx on sm_grc_kris (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_kris_owner_id_idx on sm_grc_kris (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_grc_kris_sync on sm_grc_kris;
create trigger sm_grc_kris_sync before insert or update on sm_grc_kris for each row execute function sm_sync_touch('grc_kri');
create or replace trigger sm_grc_kris_demo after insert on sm_grc_kris for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_kris_demo_t after update or delete on sm_grc_kris for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_kris enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:11', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۳ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 13/30 (a0c3bc7de847)
-- grc_policy: خط‌مشی‌ها و استانداردها
do $cols$
begin
  if to_regclass('sm_grc_policies') is not null then
    alter table sm_grc_policies add column if not exists workspace_id uuid;
    alter table sm_grc_policies add column if not exists domain_id uuid;
    alter table sm_grc_policies add column if not exists unit_id uuid;
    alter table sm_grc_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_policies add column if not exists created_by uuid;
    alter table sm_grc_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_policies add column if not exists updated_by uuid;
    alter table sm_grc_policies add column if not exists rev bigint not null default 0;
    alter table sm_grc_policies add column if not exists version integer not null default 1;
    alter table sm_grc_policies add column if not exists deleted_at timestamptz;
    alter table sm_grc_policies add column if not exists origin text;
    alter table sm_grc_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_policies add column if not exists no integer;
    alter table sm_grc_policies add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'POL' || no::text else 'POL' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_policies add column if not exists title text;
    alter table sm_grc_policies add column if not exists kind text;
    alter table sm_grc_policies add column if not exists version_label text;
    alter table sm_grc_policies add column if not exists classification text;
    alter table sm_grc_policies add column if not exists owner_id uuid;
    alter table sm_grc_policies add column if not exists approver_id uuid;
    alter table sm_grc_policies add column if not exists assignment_group_id uuid;
    alter table sm_grc_policies add column if not exists effective_at date;
    alter table sm_grc_policies add column if not exists next_review_at date;
    alter table sm_grc_policies add column if not exists summary text;
    alter table sm_grc_policies add column if not exists body text;
    alter table sm_grc_policies add column if not exists requirements jsonb;
    alter table sm_grc_policies add column if not exists approval text;
    alter table sm_grc_policies add column if not exists published_at timestamptz;
    alter table sm_grc_policies add column if not exists published_by uuid;
    alter table sm_grc_policies add column if not exists revision integer;
    alter table sm_grc_policies add column if not exists review_noticed_for date;
    alter table sm_grc_policies add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_policies (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'POL' || no::text else 'POL' || lpad(no::text, 5, '0') end) stored,
  title text,
  kind text,
  version_label text,
  classification text,
  owner_id uuid,
  approver_id uuid,
  assignment_group_id uuid,
  effective_at date,
  next_review_at date,
  summary text,
  body text,
  requirements jsonb,
  approval text,
  published_at timestamptz,
  published_by uuid,
  revision integer,
  review_noticed_for date,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_policies' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_policies', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_policies', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_policies' and indexname like 'sm\_grc\_policies\_search\_%' and indexname not in ('sm_grc_policies_search_cae18f1d_trgm', 'sm_grc_policies_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_policies_search_cae18f1d_trgm', 'sm_grc_policies', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_policies_search_custom_trgm', 'sm_grc_policies', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_policies_no_uk on sm_grc_policies (org_id, no);
create index if not exists sm_grc_policies_rev_idx on sm_grc_policies (org_id, rev);
create index if not exists sm_grc_policies_upd_idx on sm_grc_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policies_crt_idx on sm_grc_policies (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policies_owner_id_idx on sm_grc_policies (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_policies_state_idx on sm_grc_policies (org_id, state) where deleted_at is null;
create index if not exists sm_grc_policies_workspace_acc_idx on sm_grc_policies (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_policies_unit_acc_idx on sm_grc_policies (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_policies_domain_acc_idx on sm_grc_policies (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_policies_approver_id_idx on sm_grc_policies (org_id, approver_id) where deleted_at is null;
drop trigger if exists sm_grc_policies_sync on sm_grc_policies;
create trigger sm_grc_policies_sync before insert or update on sm_grc_policies for each row execute function sm_sync_touch('grc_policy');
create or replace trigger sm_grc_policies_demo after insert on sm_grc_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_policies_demo_t after update or delete on sm_grc_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_policies enable row level security;

-- grc_policy_ack: پذیرش‌های خط‌مشی
do $cols$
begin
  if to_regclass('sm_grc_policy_acks') is not null then
    alter table sm_grc_policy_acks add column if not exists workspace_id uuid;
    alter table sm_grc_policy_acks add column if not exists domain_id uuid;
    alter table sm_grc_policy_acks add column if not exists unit_id uuid;
    alter table sm_grc_policy_acks add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_policy_acks add column if not exists created_by uuid;
    alter table sm_grc_policy_acks add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_policy_acks add column if not exists updated_by uuid;
    alter table sm_grc_policy_acks add column if not exists rev bigint not null default 0;
    alter table sm_grc_policy_acks add column if not exists version integer not null default 1;
    alter table sm_grc_policy_acks add column if not exists deleted_at timestamptz;
    alter table sm_grc_policy_acks add column if not exists origin text;
    alter table sm_grc_policy_acks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_policy_acks add column if not exists campaign_id uuid;
    alter table sm_grc_policy_acks add column if not exists policy_id uuid;
    alter table sm_grc_policy_acks add column if not exists user_id uuid;
    alter table sm_grc_policy_acks add column if not exists version_label text;
    alter table sm_grc_policy_acks add column if not exists acked_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_grc_policy_acks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  campaign_id uuid,
  policy_id uuid,
  user_id uuid,
  version_label text,
  acked_at timestamptz
);
create index if not exists sm_grc_policy_acks_rev_idx on sm_grc_policy_acks (org_id, rev);
create index if not exists sm_grc_policy_acks_upd_idx on sm_grc_policy_acks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policy_acks_crt_idx on sm_grc_policy_acks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policy_acks_campaign_id_idx on sm_grc_policy_acks (org_id, campaign_id) where deleted_at is null;
create index if not exists sm_grc_policy_acks_policy_id_idx on sm_grc_policy_acks (org_id, policy_id) where deleted_at is null;
create index if not exists sm_grc_policy_acks_user_id_idx on sm_grc_policy_acks (org_id, user_id) where deleted_at is null;
create unique index if not exists sm_grc_policy_acks_campaign_id_user_id_uk on sm_grc_policy_acks (org_id, campaign_id, user_id) where deleted_at is null;
create index if not exists sm_grc_policy_acks_workspace_acc_idx on sm_grc_policy_acks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_policy_acks_unit_acc_idx on sm_grc_policy_acks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_policy_acks_domain_acc_idx on sm_grc_policy_acks (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_policy_acks_sync on sm_grc_policy_acks;
create trigger sm_grc_policy_acks_sync before insert or update on sm_grc_policy_acks for each row execute function sm_sync_touch('grc_policy_ack');
create or replace trigger sm_grc_policy_acks_demo after insert on sm_grc_policy_acks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_policy_acks_demo_t after update or delete on sm_grc_policy_acks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_policy_acks enable row level security;

-- grc_policy_campaign: کارزارهای پذیرش خط‌مشی
do $cols$
begin
  if to_regclass('sm_grc_policy_campaigns') is not null then
    alter table sm_grc_policy_campaigns add column if not exists workspace_id uuid;
    alter table sm_grc_policy_campaigns add column if not exists domain_id uuid;
    alter table sm_grc_policy_campaigns add column if not exists unit_id uuid;
    alter table sm_grc_policy_campaigns add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_policy_campaigns add column if not exists created_by uuid;
    alter table sm_grc_policy_campaigns add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_policy_campaigns add column if not exists updated_by uuid;
    alter table sm_grc_policy_campaigns add column if not exists rev bigint not null default 0;
    alter table sm_grc_policy_campaigns add column if not exists version integer not null default 1;
    alter table sm_grc_policy_campaigns add column if not exists deleted_at timestamptz;
    alter table sm_grc_policy_campaigns add column if not exists origin text;
    alter table sm_grc_policy_campaigns add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_policy_campaigns add column if not exists no integer;
    alter table sm_grc_policy_campaigns add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PAC' || no::text else 'PAC' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_policy_campaigns add column if not exists title text;
    alter table sm_grc_policy_campaigns add column if not exists policy_id uuid;
    alter table sm_grc_policy_campaigns add column if not exists version_label text;
    alter table sm_grc_policy_campaigns add column if not exists due_at date;
    alter table sm_grc_policy_campaigns add column if not exists owner_id uuid;
    alter table sm_grc_policy_campaigns add column if not exists assignment_group_id uuid;
    alter table sm_grc_policy_campaigns add column if not exists remind_every_days integer;
    alter table sm_grc_policy_campaigns add column if not exists target_all boolean not null default false;
    alter table sm_grc_policy_campaigns add column if not exists target_users jsonb;
    alter table sm_grc_policy_campaigns add column if not exists target_groups jsonb;
    alter table sm_grc_policy_campaigns add column if not exists target_units jsonb;
    alter table sm_grc_policy_campaigns add column if not exists audience_count integer;
    alter table sm_grc_policy_campaigns add column if not exists ack_count integer;
    alter table sm_grc_policy_campaigns add column if not exists reminded_at timestamptz;
    alter table sm_grc_policy_campaigns add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_policy_campaigns (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PAC' || no::text else 'PAC' || lpad(no::text, 6, '0') end) stored,
  title text,
  policy_id uuid,
  version_label text,
  due_at date,
  owner_id uuid,
  assignment_group_id uuid,
  remind_every_days integer,
  target_all boolean not null default false,
  target_users jsonb,
  target_groups jsonb,
  target_units jsonb,
  audience_count integer,
  ack_count integer,
  reminded_at timestamptz,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_policy_campaigns' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_policy_campaigns', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_policy_campaigns', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_policy_campaigns' and indexname like 'sm\_grc\_policy\_campaigns\_search\_%' and indexname not in ('sm_grc_policy_campaigns_search_cae18f1d_trgm', 'sm_grc_policy_campaigns_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_policy_campaigns_search_cae18f1d_trgm', 'sm_grc_policy_campaigns', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_policy_campaigns_search_custom_trgm', 'sm_grc_policy_campaigns', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_policy_campaigns_no_uk on sm_grc_policy_campaigns (org_id, no);
create index if not exists sm_grc_policy_campaigns_rev_idx on sm_grc_policy_campaigns (org_id, rev);
create index if not exists sm_grc_policy_campaigns_upd_idx on sm_grc_policy_campaigns (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policy_campaigns_crt_idx on sm_grc_policy_campaigns (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policy_campaigns_policy_id_idx on sm_grc_policy_campaigns (org_id, policy_id) where deleted_at is null;
create index if not exists sm_grc_policy_campaigns_owner_id_idx on sm_grc_policy_campaigns (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_policy_campaigns_state_idx on sm_grc_policy_campaigns (org_id, state) where deleted_at is null;
create index if not exists sm_grc_policy_campaigns_workspace_acc_idx on sm_grc_policy_campaigns (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_policy_campaigns_unit_acc_idx on sm_grc_policy_campaigns (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_policy_campaigns_domain_acc_idx on sm_grc_policy_campaigns (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_policy_campaigns_sync on sm_grc_policy_campaigns;
create trigger sm_grc_policy_campaigns_sync before insert or update on sm_grc_policy_campaigns for each row execute function sm_sync_touch('grc_policy_campaign');
create or replace trigger sm_grc_policy_campaigns_demo after insert on sm_grc_policy_campaigns for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_policy_campaigns_demo_t after update or delete on sm_grc_policy_campaigns for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_policy_campaigns enable row level security;

-- grc_policy_exception: استثناهای خط‌مشی
do $cols$
begin
  if to_regclass('sm_grc_policy_exceptions') is not null then
    alter table sm_grc_policy_exceptions add column if not exists workspace_id uuid;
    alter table sm_grc_policy_exceptions add column if not exists domain_id uuid;
    alter table sm_grc_policy_exceptions add column if not exists unit_id uuid;
    alter table sm_grc_policy_exceptions add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_policy_exceptions add column if not exists created_by uuid;
    alter table sm_grc_policy_exceptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_policy_exceptions add column if not exists updated_by uuid;
    alter table sm_grc_policy_exceptions add column if not exists rev bigint not null default 0;
    alter table sm_grc_policy_exceptions add column if not exists version integer not null default 1;
    alter table sm_grc_policy_exceptions add column if not exists deleted_at timestamptz;
    alter table sm_grc_policy_exceptions add column if not exists origin text;
    alter table sm_grc_policy_exceptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_policy_exceptions add column if not exists no integer;
    alter table sm_grc_policy_exceptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'WVR' || no::text else 'WVR' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_policy_exceptions add column if not exists title text;
    alter table sm_grc_policy_exceptions add column if not exists policy_id uuid;
    alter table sm_grc_policy_exceptions add column if not exists expires_at date;
    alter table sm_grc_policy_exceptions add column if not exists justification text;
    alter table sm_grc_policy_exceptions add column if not exists compensating_controls text;
    alter table sm_grc_policy_exceptions add column if not exists risk_accepted boolean not null default false;
    alter table sm_grc_policy_exceptions add column if not exists requested_by uuid;
    alter table sm_grc_policy_exceptions add column if not exists approver_id uuid;
    alter table sm_grc_policy_exceptions add column if not exists assignment_group_id uuid;
    alter table sm_grc_policy_exceptions add column if not exists approval text;
    alter table sm_grc_policy_exceptions add column if not exists approved_at timestamptz;
    alter table sm_grc_policy_exceptions add column if not exists warned_at timestamptz;
    alter table sm_grc_policy_exceptions add column if not exists notes text;
    alter table sm_grc_policy_exceptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_policy_exceptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'WVR' || no::text else 'WVR' || lpad(no::text, 6, '0') end) stored,
  title text,
  policy_id uuid,
  expires_at date,
  justification text,
  compensating_controls text,
  risk_accepted boolean not null default false,
  requested_by uuid,
  approver_id uuid,
  assignment_group_id uuid,
  approval text,
  approved_at timestamptz,
  warned_at timestamptz,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_policy_exceptions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_policy_exceptions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_policy_exceptions', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_policy_exceptions' and indexname like 'sm\_grc\_policy\_exceptions\_search\_%' and indexname not in ('sm_grc_policy_exceptions_search_cae18f1d_trgm', 'sm_grc_policy_exceptions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_policy_exceptions_search_cae18f1d_trgm', 'sm_grc_policy_exceptions', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_policy_exceptions_search_custom_trgm', 'sm_grc_policy_exceptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_policy_exceptions_no_uk on sm_grc_policy_exceptions (org_id, no);
create index if not exists sm_grc_policy_exceptions_rev_idx on sm_grc_policy_exceptions (org_id, rev);
create index if not exists sm_grc_policy_exceptions_upd_idx on sm_grc_policy_exceptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policy_exceptions_crt_idx on sm_grc_policy_exceptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_policy_exceptions_policy_id_idx on sm_grc_policy_exceptions (org_id, policy_id) where deleted_at is null;
create index if not exists sm_grc_policy_exceptions_state_idx on sm_grc_policy_exceptions (org_id, state) where deleted_at is null;
create index if not exists sm_grc_policy_exceptions_workspace_acc_idx on sm_grc_policy_exceptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_policy_exceptions_unit_acc_idx on sm_grc_policy_exceptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_policy_exceptions_domain_acc_idx on sm_grc_policy_exceptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_policy_exceptions_requested_by_idx on sm_grc_policy_exceptions (org_id, requested_by) where deleted_at is null;
create index if not exists sm_grc_policy_exceptions_approver_id_idx on sm_grc_policy_exceptions (org_id, approver_id) where deleted_at is null;
drop trigger if exists sm_grc_policy_exceptions_sync on sm_grc_policy_exceptions;
create trigger sm_grc_policy_exceptions_sync before insert or update on sm_grc_policy_exceptions for each row execute function sm_sync_touch('grc_policy_exception');
create or replace trigger sm_grc_policy_exceptions_demo after insert on sm_grc_policy_exceptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_policy_exceptions_demo_t after update or delete on sm_grc_policy_exceptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_policy_exceptions enable row level security;

-- grc_reg_alert: هشدارهای تغییر مقررات
do $cols$
begin
  if to_regclass('sm_grc_reg_alerts') is not null then
    alter table sm_grc_reg_alerts add column if not exists workspace_id uuid;
    alter table sm_grc_reg_alerts add column if not exists domain_id uuid;
    alter table sm_grc_reg_alerts add column if not exists unit_id uuid;
    alter table sm_grc_reg_alerts add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_reg_alerts add column if not exists created_by uuid;
    alter table sm_grc_reg_alerts add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_reg_alerts add column if not exists updated_by uuid;
    alter table sm_grc_reg_alerts add column if not exists rev bigint not null default 0;
    alter table sm_grc_reg_alerts add column if not exists version integer not null default 1;
    alter table sm_grc_reg_alerts add column if not exists deleted_at timestamptz;
    alter table sm_grc_reg_alerts add column if not exists origin text;
    alter table sm_grc_reg_alerts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_reg_alerts add column if not exists no integer;
    alter table sm_grc_reg_alerts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'RAL' || no::text else 'RAL' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_reg_alerts add column if not exists title text;
    alter table sm_grc_reg_alerts add column if not exists issuer text;
    alter table sm_grc_reg_alerts add column if not exists published_on date;
    alter table sm_grc_reg_alerts add column if not exists effective_on date;
    alter table sm_grc_reg_alerts add column if not exists summary text;
    alter table sm_grc_reg_alerts add column if not exists requirements jsonb;
    alter table sm_grc_reg_alerts add column if not exists controls jsonb;
    alter table sm_grc_reg_alerts add column if not exists policies jsonb;
    alter table sm_grc_reg_alerts add column if not exists impact text;
    alter table sm_grc_reg_alerts add column if not exists owner_id uuid;
    alter table sm_grc_reg_alerts add column if not exists assignment_group_id uuid;
    alter table sm_grc_reg_alerts add column if not exists rationale text;
    alter table sm_grc_reg_alerts add column if not exists action_plan text;
    alter table sm_grc_reg_alerts add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_reg_alerts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'RAL' || no::text else 'RAL' || lpad(no::text, 5, '0') end) stored,
  title text,
  issuer text,
  published_on date,
  effective_on date,
  summary text,
  requirements jsonb,
  controls jsonb,
  policies jsonb,
  impact text,
  owner_id uuid,
  assignment_group_id uuid,
  rationale text,
  action_plan text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_reg_alerts' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_reg_alerts', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_reg_alerts', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_reg_alerts' and indexname like 'sm\_grc\_reg\_alerts\_search\_%' and indexname not in ('sm_grc_reg_alerts_search_cae18f1d_trgm', 'sm_grc_reg_alerts_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_reg_alerts_search_cae18f1d_trgm', 'sm_grc_reg_alerts', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_reg_alerts_search_custom_trgm', 'sm_grc_reg_alerts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_reg_alerts_no_uk on sm_grc_reg_alerts (org_id, no);
create index if not exists sm_grc_reg_alerts_rev_idx on sm_grc_reg_alerts (org_id, rev);
create index if not exists sm_grc_reg_alerts_upd_idx on sm_grc_reg_alerts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_reg_alerts_crt_idx on sm_grc_reg_alerts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_reg_alerts_state_idx on sm_grc_reg_alerts (org_id, state) where deleted_at is null;
create index if not exists sm_grc_reg_alerts_workspace_acc_idx on sm_grc_reg_alerts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_reg_alerts_unit_acc_idx on sm_grc_reg_alerts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_reg_alerts_domain_acc_idx on sm_grc_reg_alerts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_reg_alerts_owner_id_idx on sm_grc_reg_alerts (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_grc_reg_alerts_sync on sm_grc_reg_alerts;
create trigger sm_grc_reg_alerts_sync before insert or update on sm_grc_reg_alerts for each row execute function sm_sync_touch('grc_reg_alert');
create or replace trigger sm_grc_reg_alerts_demo after insert on sm_grc_reg_alerts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_reg_alerts_demo_t after update or delete on sm_grc_reg_alerts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_reg_alerts enable row level security;

-- grc_requirement: الزام‌ها و بیانیهٔ کاربست‌پذیری
do $cols$
begin
  if to_regclass('sm_grc_requirements') is not null then
    alter table sm_grc_requirements add column if not exists workspace_id uuid;
    alter table sm_grc_requirements add column if not exists domain_id uuid;
    alter table sm_grc_requirements add column if not exists unit_id uuid;
    alter table sm_grc_requirements add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_requirements add column if not exists created_by uuid;
    alter table sm_grc_requirements add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_requirements add column if not exists updated_by uuid;
    alter table sm_grc_requirements add column if not exists rev bigint not null default 0;
    alter table sm_grc_requirements add column if not exists version integer not null default 1;
    alter table sm_grc_requirements add column if not exists deleted_at timestamptz;
    alter table sm_grc_requirements add column if not exists origin text;
    alter table sm_grc_requirements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_requirements add column if not exists framework_id uuid;
    alter table sm_grc_requirements add column if not exists code text;
    alter table sm_grc_requirements add column if not exists level integer;
    alter table sm_grc_requirements add column if not exists title text;
    alter table sm_grc_requirements add column if not exists title_en text;
    alter table sm_grc_requirements add column if not exists theme text;
    alter table sm_grc_requirements add column if not exists parent_code text;
    alter table sm_grc_requirements add column if not exists sort_order integer;
    alter table sm_grc_requirements add column if not exists attributes jsonb;
    alter table sm_grc_requirements add column if not exists description text;
    alter table sm_grc_requirements add column if not exists applicable boolean not null default true;
    alter table sm_grc_requirements add column if not exists justification text;
    alter table sm_grc_requirements add column if not exists owner_id uuid;
    alter table sm_grc_requirements add column if not exists implementation text;
    alter table sm_grc_requirements add column if not exists compliance text;
    alter table sm_grc_requirements add column if not exists control_count integer;
    alter table sm_grc_requirements add column if not exists soa_state text;
    alter table sm_grc_requirements add column if not exists soa_approved_by uuid;
    alter table sm_grc_requirements add column if not exists soa_approved_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_grc_requirements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  framework_id uuid,
  code text,
  level integer,
  title text,
  title_en text,
  theme text,
  parent_code text,
  sort_order integer,
  attributes jsonb,
  description text,
  applicable boolean not null default true,
  justification text,
  owner_id uuid,
  implementation text,
  compliance text,
  control_count integer,
  soa_state text,
  soa_approved_by uuid,
  soa_approved_at timestamptz
);
create index if not exists sm_grc_requirements_rev_idx on sm_grc_requirements (org_id, rev);
create index if not exists sm_grc_requirements_upd_idx on sm_grc_requirements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_requirements_crt_idx on sm_grc_requirements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_requirements_framework_id_idx on sm_grc_requirements (org_id, framework_id) where deleted_at is null;
create index if not exists sm_grc_requirements_owner_id_idx on sm_grc_requirements (org_id, owner_id) where deleted_at is null;
create unique index if not exists sm_grc_requirements_framework_id_code_uk on sm_grc_requirements (org_id, framework_id, code) where deleted_at is null;
drop trigger if exists sm_grc_requirements_sync on sm_grc_requirements;
create trigger sm_grc_requirements_sync before insert or update on sm_grc_requirements for each row execute function sm_sync_touch('grc_requirement');
create or replace trigger sm_grc_requirements_demo after insert on sm_grc_requirements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_requirements_demo_t after update or delete on sm_grc_requirements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_requirements enable row level security;

-- grc_risk: ثبت ریسک‌ها
do $cols$
begin
  if to_regclass('sm_grc_risks') is not null then
    alter table sm_grc_risks add column if not exists workspace_id uuid;
    alter table sm_grc_risks add column if not exists domain_id uuid;
    alter table sm_grc_risks add column if not exists unit_id uuid;
    alter table sm_grc_risks add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_risks add column if not exists created_by uuid;
    alter table sm_grc_risks add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_risks add column if not exists updated_by uuid;
    alter table sm_grc_risks add column if not exists rev bigint not null default 0;
    alter table sm_grc_risks add column if not exists version integer not null default 1;
    alter table sm_grc_risks add column if not exists deleted_at timestamptz;
    alter table sm_grc_risks add column if not exists origin text;
    alter table sm_grc_risks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_risks add column if not exists no integer;
    alter table sm_grc_risks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'RSK' || no::text else 'RSK' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_risks add column if not exists title text;
    alter table sm_grc_risks add column if not exists category text;
    alter table sm_grc_risks add column if not exists cause text;
    alter table sm_grc_risks add column if not exists event text;
    alter table sm_grc_risks add column if not exists consequence text;
    alter table sm_grc_risks add column if not exists owner_id uuid;
    alter table sm_grc_risks add column if not exists reporter_id uuid;
    alter table sm_grc_risks add column if not exists reporter_role text;
    alter table sm_grc_risks add column if not exists assignment_group_id uuid;
    alter table sm_grc_risks add column if not exists services jsonb;
    alter table sm_grc_risks add column if not exists cis jsonb;
    alter table sm_grc_risks add column if not exists matrix_id uuid;
    alter table sm_grc_risks add column if not exists inherent_likelihood text;
    alter table sm_grc_risks add column if not exists inherent_impact text;
    alter table sm_grc_risks add column if not exists inherent_score integer;
    alter table sm_grc_risks add column if not exists inherent_rating text;
    alter table sm_grc_risks add column if not exists controls jsonb;
    alter table sm_grc_risks add column if not exists control_effectiveness text;
    alter table sm_grc_risks add column if not exists residual_likelihood text;
    alter table sm_grc_risks add column if not exists residual_impact text;
    alter table sm_grc_risks add column if not exists residual_score integer;
    alter table sm_grc_risks add column if not exists residual_rating text;
    alter table sm_grc_risks add column if not exists target_likelihood text;
    alter table sm_grc_risks add column if not exists target_impact text;
    alter table sm_grc_risks add column if not exists target_score integer;
    alter table sm_grc_risks add column if not exists appetite_score integer;
    alter table sm_grc_risks add column if not exists above_appetite boolean not null default false;
    alter table sm_grc_risks add column if not exists sle numeric;
    alter table sm_grc_risks add column if not exists aro numeric;
    alter table sm_grc_risks add column if not exists ale numeric;
    alter table sm_grc_risks add column if not exists treatment text;
    alter table sm_grc_risks add column if not exists review_due date;
    alter table sm_grc_risks add column if not exists last_reviewed_at timestamptz;
    alter table sm_grc_risks add column if not exists treatment_plan text;
    alter table sm_grc_risks add column if not exists notes text;
    alter table sm_grc_risks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_risks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'RSK' || no::text else 'RSK' || lpad(no::text, 5, '0') end) stored,
  title text,
  category text,
  cause text,
  event text,
  consequence text,
  owner_id uuid,
  reporter_id uuid,
  reporter_role text,
  assignment_group_id uuid,
  services jsonb,
  cis jsonb,
  matrix_id uuid,
  inherent_likelihood text,
  inherent_impact text,
  inherent_score integer,
  inherent_rating text,
  controls jsonb,
  control_effectiveness text,
  residual_likelihood text,
  residual_impact text,
  residual_score integer,
  residual_rating text,
  target_likelihood text,
  target_impact text,
  target_score integer,
  appetite_score integer,
  above_appetite boolean not null default false,
  sle numeric,
  aro numeric,
  ale numeric,
  treatment text,
  review_due date,
  last_reviewed_at timestamptz,
  treatment_plan text,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_risks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_risks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_risks', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_risks' and indexname like 'sm\_grc\_risks\_search\_%' and indexname not in ('sm_grc_risks_search_cae18f1d_trgm', 'sm_grc_risks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_risks_search_cae18f1d_trgm', 'sm_grc_risks', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_risks_search_custom_trgm', 'sm_grc_risks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_risks_no_uk on sm_grc_risks (org_id, no);
create index if not exists sm_grc_risks_rev_idx on sm_grc_risks (org_id, rev);
create index if not exists sm_grc_risks_upd_idx on sm_grc_risks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risks_crt_idx on sm_grc_risks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risks_owner_id_idx on sm_grc_risks (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_risks_assignment_group_id_idx on sm_grc_risks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_grc_risks_state_idx on sm_grc_risks (org_id, state) where deleted_at is null;
create index if not exists sm_grc_risks_workspace_acc_idx on sm_grc_risks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_risks_unit_acc_idx on sm_grc_risks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_risks_domain_acc_idx on sm_grc_risks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_risks_reporter_id_idx on sm_grc_risks (org_id, reporter_id) where deleted_at is null;
drop trigger if exists sm_grc_risks_sync on sm_grc_risks;
create trigger sm_grc_risks_sync before insert or update on sm_grc_risks for each row execute function sm_sync_touch('grc_risk');
create or replace trigger sm_grc_risks_demo after insert on sm_grc_risks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_risks_demo_t after update or delete on sm_grc_risks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_risks enable row level security;

-- grc_risk_acceptance: پذیرش‌های ریسک
do $cols$
begin
  if to_regclass('sm_grc_risk_acceptances') is not null then
    alter table sm_grc_risk_acceptances add column if not exists workspace_id uuid;
    alter table sm_grc_risk_acceptances add column if not exists domain_id uuid;
    alter table sm_grc_risk_acceptances add column if not exists unit_id uuid;
    alter table sm_grc_risk_acceptances add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_risk_acceptances add column if not exists created_by uuid;
    alter table sm_grc_risk_acceptances add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_risk_acceptances add column if not exists updated_by uuid;
    alter table sm_grc_risk_acceptances add column if not exists rev bigint not null default 0;
    alter table sm_grc_risk_acceptances add column if not exists version integer not null default 1;
    alter table sm_grc_risk_acceptances add column if not exists deleted_at timestamptz;
    alter table sm_grc_risk_acceptances add column if not exists origin text;
    alter table sm_grc_risk_acceptances add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_risk_acceptances add column if not exists no integer;
    alter table sm_grc_risk_acceptances add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RAC' || no::text else 'RAC' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_risk_acceptances add column if not exists risk_id uuid;
    alter table sm_grc_risk_acceptances add column if not exists expires_at date;
    alter table sm_grc_risk_acceptances add column if not exists accepted_by uuid;
    alter table sm_grc_risk_acceptances add column if not exists requested_by uuid;
    alter table sm_grc_risk_acceptances add column if not exists assignment_group_id uuid;
    alter table sm_grc_risk_acceptances add column if not exists residual_score integer;
    alter table sm_grc_risk_acceptances add column if not exists conditions text;
    alter table sm_grc_risk_acceptances add column if not exists approval text;
    alter table sm_grc_risk_acceptances add column if not exists accepted_at timestamptz;
    alter table sm_grc_risk_acceptances add column if not exists warned_at timestamptz;
    alter table sm_grc_risk_acceptances add column if not exists notes text;
    alter table sm_grc_risk_acceptances add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_risk_acceptances (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RAC' || no::text else 'RAC' || lpad(no::text, 6, '0') end) stored,
  risk_id uuid,
  expires_at date,
  accepted_by uuid,
  requested_by uuid,
  assignment_group_id uuid,
  residual_score integer,
  conditions text,
  approval text,
  accepted_at timestamptz,
  warned_at timestamptz,
  notes text,
  state text
);
do $search$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_risk_acceptances' and column_name ~ '^search_[0-9a-f]{8}$' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_risk_acceptances', old.column_name);
  end loop;
end
$search$;
create unique index if not exists sm_grc_risk_acceptances_no_uk on sm_grc_risk_acceptances (org_id, no);
create index if not exists sm_grc_risk_acceptances_rev_idx on sm_grc_risk_acceptances (org_id, rev);
create index if not exists sm_grc_risk_acceptances_upd_idx on sm_grc_risk_acceptances (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_acceptances_crt_idx on sm_grc_risk_acceptances (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_acceptances_risk_id_idx on sm_grc_risk_acceptances (org_id, risk_id) where deleted_at is null;
create index if not exists sm_grc_risk_acceptances_accepted_by_idx on sm_grc_risk_acceptances (org_id, accepted_by) where deleted_at is null;
create index if not exists sm_grc_risk_acceptances_state_idx on sm_grc_risk_acceptances (org_id, state) where deleted_at is null;
create index if not exists sm_grc_risk_acceptances_workspace_acc_idx on sm_grc_risk_acceptances (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_risk_acceptances_unit_acc_idx on sm_grc_risk_acceptances (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_risk_acceptances_domain_acc_idx on sm_grc_risk_acceptances (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_risk_acceptances_requested_by_idx on sm_grc_risk_acceptances (org_id, requested_by) where deleted_at is null;
drop trigger if exists sm_grc_risk_acceptances_sync on sm_grc_risk_acceptances;
create trigger sm_grc_risk_acceptances_sync before insert or update on sm_grc_risk_acceptances for each row execute function sm_sync_touch('grc_risk_acceptance');
create or replace trigger sm_grc_risk_acceptances_demo after insert on sm_grc_risk_acceptances for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_risk_acceptances_demo_t after update or delete on sm_grc_risk_acceptances for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_risk_acceptances enable row level security;

-- grc_risk_action: اقدام‌های درمان ریسک
do $cols$
begin
  if to_regclass('sm_grc_risk_actions') is not null then
    alter table sm_grc_risk_actions add column if not exists workspace_id uuid;
    alter table sm_grc_risk_actions add column if not exists domain_id uuid;
    alter table sm_grc_risk_actions add column if not exists unit_id uuid;
    alter table sm_grc_risk_actions add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_risk_actions add column if not exists created_by uuid;
    alter table sm_grc_risk_actions add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_risk_actions add column if not exists updated_by uuid;
    alter table sm_grc_risk_actions add column if not exists rev bigint not null default 0;
    alter table sm_grc_risk_actions add column if not exists version integer not null default 1;
    alter table sm_grc_risk_actions add column if not exists deleted_at timestamptz;
    alter table sm_grc_risk_actions add column if not exists origin text;
    alter table sm_grc_risk_actions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_risk_actions add column if not exists no integer;
    alter table sm_grc_risk_actions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RTA' || no::text else 'RTA' || lpad(no::text, 6, '0') end) stored;
    alter table sm_grc_risk_actions add column if not exists title text;
    alter table sm_grc_risk_actions add column if not exists risk_id uuid;
    alter table sm_grc_risk_actions add column if not exists owner_id uuid;
    alter table sm_grc_risk_actions add column if not exists due_at date;
    alter table sm_grc_risk_actions add column if not exists assignment_group_id uuid;
    alter table sm_grc_risk_actions add column if not exists change_id uuid;
    alter table sm_grc_risk_actions add column if not exists overdue boolean not null default false;
    alter table sm_grc_risk_actions add column if not exists notes text;
    alter table sm_grc_risk_actions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_risk_actions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RTA' || no::text else 'RTA' || lpad(no::text, 6, '0') end) stored,
  title text,
  risk_id uuid,
  owner_id uuid,
  due_at date,
  assignment_group_id uuid,
  change_id uuid,
  overdue boolean not null default false,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_risk_actions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_risk_actions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_risk_actions', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_risk_actions' and indexname like 'sm\_grc\_risk\_actions\_search\_%' and indexname not in ('sm_grc_risk_actions_search_cae18f1d_trgm', 'sm_grc_risk_actions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_risk_actions_search_cae18f1d_trgm', 'sm_grc_risk_actions', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_risk_actions_search_custom_trgm', 'sm_grc_risk_actions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_risk_actions_no_uk on sm_grc_risk_actions (org_id, no);
create index if not exists sm_grc_risk_actions_rev_idx on sm_grc_risk_actions (org_id, rev);
create index if not exists sm_grc_risk_actions_upd_idx on sm_grc_risk_actions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_actions_crt_idx on sm_grc_risk_actions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_actions_risk_id_idx on sm_grc_risk_actions (org_id, risk_id) where deleted_at is null;
create index if not exists sm_grc_risk_actions_owner_id_idx on sm_grc_risk_actions (org_id, owner_id) where deleted_at is null;
create index if not exists sm_grc_risk_actions_state_idx on sm_grc_risk_actions (org_id, state) where deleted_at is null;
create index if not exists sm_grc_risk_actions_workspace_acc_idx on sm_grc_risk_actions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_risk_actions_unit_acc_idx on sm_grc_risk_actions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_risk_actions_domain_acc_idx on sm_grc_risk_actions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_grc_risk_actions_sync on sm_grc_risk_actions;
create trigger sm_grc_risk_actions_sync before insert or update on sm_grc_risk_actions for each row execute function sm_sync_touch('grc_risk_action');
create or replace trigger sm_grc_risk_actions_demo after insert on sm_grc_risk_actions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_risk_actions_demo_t after update or delete on sm_grc_risk_actions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_risk_actions enable row level security;

-- grc_risk_appetite: اشتها و تحمل ریسک
do $cols$
begin
  if to_regclass('sm_grc_risk_appetites') is not null then
    alter table sm_grc_risk_appetites add column if not exists workspace_id uuid;
    alter table sm_grc_risk_appetites add column if not exists domain_id uuid;
    alter table sm_grc_risk_appetites add column if not exists unit_id uuid;
    alter table sm_grc_risk_appetites add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_risk_appetites add column if not exists created_by uuid;
    alter table sm_grc_risk_appetites add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_risk_appetites add column if not exists updated_by uuid;
    alter table sm_grc_risk_appetites add column if not exists rev bigint not null default 0;
    alter table sm_grc_risk_appetites add column if not exists version integer not null default 1;
    alter table sm_grc_risk_appetites add column if not exists deleted_at timestamptz;
    alter table sm_grc_risk_appetites add column if not exists origin text;
    alter table sm_grc_risk_appetites add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_risk_appetites add column if not exists category text;
    alter table sm_grc_risk_appetites add column if not exists appetite_score integer;
    alter table sm_grc_risk_appetites add column if not exists tolerance_score integer;
    alter table sm_grc_risk_appetites add column if not exists statement text;
  end if;
end
$cols$;
create table if not exists sm_grc_risk_appetites (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  category text,
  appetite_score integer,
  tolerance_score integer,
  statement text
);
create index if not exists sm_grc_risk_appetites_rev_idx on sm_grc_risk_appetites (org_id, rev);
create index if not exists sm_grc_risk_appetites_upd_idx on sm_grc_risk_appetites (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_appetites_crt_idx on sm_grc_risk_appetites (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_grc_risk_appetites_category_uk on sm_grc_risk_appetites (org_id, category) where deleted_at is null;
drop trigger if exists sm_grc_risk_appetites_sync on sm_grc_risk_appetites;
create trigger sm_grc_risk_appetites_sync before insert or update on sm_grc_risk_appetites for each row execute function sm_sync_touch('grc_risk_appetite');
create or replace trigger sm_grc_risk_appetites_demo after insert on sm_grc_risk_appetites for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_risk_appetites_demo_t after update or delete on sm_grc_risk_appetites for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_risk_appetites enable row level security;

-- grc_risk_event: رویدادهای زیان
do $cols$
begin
  if to_regclass('sm_grc_risk_events') is not null then
    alter table sm_grc_risk_events add column if not exists workspace_id uuid;
    alter table sm_grc_risk_events add column if not exists domain_id uuid;
    alter table sm_grc_risk_events add column if not exists unit_id uuid;
    alter table sm_grc_risk_events add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_risk_events add column if not exists created_by uuid;
    alter table sm_grc_risk_events add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_risk_events add column if not exists updated_by uuid;
    alter table sm_grc_risk_events add column if not exists rev bigint not null default 0;
    alter table sm_grc_risk_events add column if not exists version integer not null default 1;
    alter table sm_grc_risk_events add column if not exists deleted_at timestamptz;
    alter table sm_grc_risk_events add column if not exists origin text;
    alter table sm_grc_risk_events add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_risk_events add column if not exists no integer;
    alter table sm_grc_risk_events add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'LOSS' || no::text else 'LOSS' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_risk_events add column if not exists title text;
    alter table sm_grc_risk_events add column if not exists risk_id uuid;
    alter table sm_grc_risk_events add column if not exists incident_id uuid;
    alter table sm_grc_risk_events add column if not exists occurred_at timestamptz;
    alter table sm_grc_risk_events add column if not exists loss_amount numeric;
    alter table sm_grc_risk_events add column if not exists recovered_amount numeric;
    alter table sm_grc_risk_events add column if not exists owner_id uuid;
    alter table sm_grc_risk_events add column if not exists assignment_group_id uuid;
    alter table sm_grc_risk_events add column if not exists description text;
    alter table sm_grc_risk_events add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_grc_risk_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'LOSS' || no::text else 'LOSS' || lpad(no::text, 5, '0') end) stored,
  title text,
  risk_id uuid,
  incident_id uuid,
  occurred_at timestamptz,
  loss_amount numeric,
  recovered_amount numeric,
  owner_id uuid,
  assignment_group_id uuid,
  description text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_risk_events' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_risk_events', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_risk_events', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_risk_events' and indexname like 'sm\_grc\_risk\_events\_search\_%' and indexname not in ('sm_grc_risk_events_search_cae18f1d_trgm', 'sm_grc_risk_events_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_risk_events_search_cae18f1d_trgm', 'sm_grc_risk_events', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_risk_events_search_custom_trgm', 'sm_grc_risk_events', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_risk_events_no_uk on sm_grc_risk_events (org_id, no);
create index if not exists sm_grc_risk_events_rev_idx on sm_grc_risk_events (org_id, rev);
create index if not exists sm_grc_risk_events_upd_idx on sm_grc_risk_events (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_events_crt_idx on sm_grc_risk_events (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_events_risk_id_idx on sm_grc_risk_events (org_id, risk_id) where deleted_at is null;
create index if not exists sm_grc_risk_events_state_idx on sm_grc_risk_events (org_id, state) where deleted_at is null;
create index if not exists sm_grc_risk_events_workspace_acc_idx on sm_grc_risk_events (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_risk_events_unit_acc_idx on sm_grc_risk_events (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_risk_events_domain_acc_idx on sm_grc_risk_events (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_risk_events_owner_id_idx on sm_grc_risk_events (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_grc_risk_events_sync on sm_grc_risk_events;
create trigger sm_grc_risk_events_sync before insert or update on sm_grc_risk_events for each row execute function sm_sync_touch('grc_risk_event');
create or replace trigger sm_grc_risk_events_demo after insert on sm_grc_risk_events for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_risk_events_demo_t after update or delete on sm_grc_risk_events for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_risk_events enable row level security;

-- grc_risk_matrix: ماتریس‌ها و مقیاس‌های ریسک
do $cols$
begin
  if to_regclass('sm_grc_risk_matrices') is not null then
    alter table sm_grc_risk_matrices add column if not exists workspace_id uuid;
    alter table sm_grc_risk_matrices add column if not exists domain_id uuid;
    alter table sm_grc_risk_matrices add column if not exists unit_id uuid;
    alter table sm_grc_risk_matrices add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_risk_matrices add column if not exists created_by uuid;
    alter table sm_grc_risk_matrices add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_risk_matrices add column if not exists updated_by uuid;
    alter table sm_grc_risk_matrices add column if not exists rev bigint not null default 0;
    alter table sm_grc_risk_matrices add column if not exists version integer not null default 1;
    alter table sm_grc_risk_matrices add column if not exists deleted_at timestamptz;
    alter table sm_grc_risk_matrices add column if not exists origin text;
    alter table sm_grc_risk_matrices add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_risk_matrices add column if not exists name text;
    alter table sm_grc_risk_matrices add column if not exists revision integer;
    alter table sm_grc_risk_matrices add column if not exists is_default boolean not null default false;
    alter table sm_grc_risk_matrices add column if not exists likelihood_labels jsonb;
    alter table sm_grc_risk_matrices add column if not exists impact_labels jsonb;
    alter table sm_grc_risk_matrices add column if not exists cells jsonb;
    alter table sm_grc_risk_matrices add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_grc_risk_matrices (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  revision integer,
  is_default boolean not null default false,
  likelihood_labels jsonb,
  impact_labels jsonb,
  cells jsonb,
  description text
);
create index if not exists sm_grc_risk_matrices_rev_idx on sm_grc_risk_matrices (org_id, rev);
create index if not exists sm_grc_risk_matrices_upd_idx on sm_grc_risk_matrices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_risk_matrices_crt_idx on sm_grc_risk_matrices (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_grc_risk_matrices_sync on sm_grc_risk_matrices;
create trigger sm_grc_risk_matrices_sync before insert or update on sm_grc_risk_matrices for each row execute function sm_sync_touch('grc_risk_matrix');
create or replace trigger sm_grc_risk_matrices_demo after insert on sm_grc_risk_matrices for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_risk_matrices_demo_t after update or delete on sm_grc_risk_matrices for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_risk_matrices enable row level security;

-- grc_ropa: ثبت فعالیت‌های پردازش
do $cols$
begin
  if to_regclass('sm_grc_ropa') is not null then
    alter table sm_grc_ropa add column if not exists workspace_id uuid;
    alter table sm_grc_ropa add column if not exists domain_id uuid;
    alter table sm_grc_ropa add column if not exists unit_id uuid;
    alter table sm_grc_ropa add column if not exists created_at timestamptz not null default now();
    alter table sm_grc_ropa add column if not exists created_by uuid;
    alter table sm_grc_ropa add column if not exists updated_at timestamptz not null default now();
    alter table sm_grc_ropa add column if not exists updated_by uuid;
    alter table sm_grc_ropa add column if not exists rev bigint not null default 0;
    alter table sm_grc_ropa add column if not exists version integer not null default 1;
    alter table sm_grc_ropa add column if not exists deleted_at timestamptz;
    alter table sm_grc_ropa add column if not exists origin text;
    alter table sm_grc_ropa add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_grc_ropa add column if not exists no integer;
    alter table sm_grc_ropa add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ROPA' || no::text else 'ROPA' || lpad(no::text, 5, '0') end) stored;
    alter table sm_grc_ropa add column if not exists name text;
    alter table sm_grc_ropa add column if not exists legal_basis text;
    alter table sm_grc_ropa add column if not exists purpose text;
    alter table sm_grc_ropa add column if not exists data_categories jsonb;
    alter table sm_grc_ropa add column if not exists subject_categories jsonb;
    alter table sm_grc_ropa add column if not exists special_data boolean not null default false;
    alter table sm_grc_ropa add column if not exists recipients text;
    alter table sm_grc_ropa add column if not exists retention text;
    alter table sm_grc_ropa add column if not exists transfers text;
    alter table sm_grc_ropa add column if not exists systems jsonb;
    alter table sm_grc_ropa add column if not exists owner_id uuid;
    alter table sm_grc_ropa add column if not exists assignment_group_id uuid;
    alter table sm_grc_ropa add column if not exists dpia_required boolean not null default false;
    alter table sm_grc_ropa add column if not exists dpia_result text;
    alter table sm_grc_ropa add column if not exists dpia_date date;
    alter table sm_grc_ropa add column if not exists dpia_measures text;
  end if;
end
$cols$;
create table if not exists sm_grc_ropa (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ROPA' || no::text else 'ROPA' || lpad(no::text, 5, '0') end) stored,
  name text,
  legal_basis text,
  purpose text,
  data_categories jsonb,
  subject_categories jsonb,
  special_data boolean not null default false,
  recipients text,
  retention text,
  transfers text,
  systems jsonb,
  owner_id uuid,
  assignment_group_id uuid,
  dpia_required boolean not null default false,
  dpia_result text,
  dpia_date date,
  dpia_measures text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_grc_ropa' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_grc_ropa', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_grc_ropa', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_grc_ropa' and indexname like 'sm\_grc\_ropa\_search\_%' and indexname not in ('sm_grc_ropa_search_56291d9d_trgm', 'sm_grc_ropa_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_grc_ropa_search_56291d9d_trgm', 'sm_grc_ropa', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_grc_ropa_search_custom_trgm', 'sm_grc_ropa', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_grc_ropa_no_uk on sm_grc_ropa (org_id, no);
create index if not exists sm_grc_ropa_rev_idx on sm_grc_ropa (org_id, rev);
create index if not exists sm_grc_ropa_upd_idx on sm_grc_ropa (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_ropa_crt_idx on sm_grc_ropa (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_grc_ropa_workspace_acc_idx on sm_grc_ropa (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_grc_ropa_unit_acc_idx on sm_grc_ropa (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_grc_ropa_domain_acc_idx on sm_grc_ropa (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_grc_ropa_owner_id_idx on sm_grc_ropa (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_grc_ropa_sync on sm_grc_ropa;
create trigger sm_grc_ropa_sync before insert or update on sm_grc_ropa for each row execute function sm_sync_touch('grc_ropa');
create or replace trigger sm_grc_ropa_demo after insert on sm_grc_ropa for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_grc_ropa_demo_t after update or delete on sm_grc_ropa for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_grc_ropa enable row level security;

-- group: گروه‌ها
do $cols$
begin
  if to_regclass('sm_groups') is not null then
    alter table sm_groups add column if not exists workspace_id uuid;
    alter table sm_groups add column if not exists domain_id uuid;
    alter table sm_groups add column if not exists unit_id uuid;
    alter table sm_groups add column if not exists created_at timestamptz not null default now();
    alter table sm_groups add column if not exists created_by uuid;
    alter table sm_groups add column if not exists updated_at timestamptz not null default now();
    alter table sm_groups add column if not exists updated_by uuid;
    alter table sm_groups add column if not exists rev bigint not null default 0;
    alter table sm_groups add column if not exists version integer not null default 1;
    alter table sm_groups add column if not exists deleted_at timestamptz;
    alter table sm_groups add column if not exists origin text;
    alter table sm_groups add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_groups add column if not exists name text;
    alter table sm_groups add column if not exists types jsonb;
    alter table sm_groups add column if not exists parent_id uuid;
    alter table sm_groups add column if not exists manager_id uuid;
    alter table sm_groups add column if not exists email text;
    alter table sm_groups add column if not exists skills jsonb;
    alter table sm_groups add column if not exists roles jsonb;
    alter table sm_groups add column if not exists restricted boolean not null default false;
    alter table sm_groups add column if not exists active boolean not null default true;
    alter table sm_groups add column if not exists notify_mode text;
    alter table sm_groups add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_groups (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  types jsonb,
  parent_id uuid,
  manager_id uuid,
  email text,
  skills jsonb,
  roles jsonb,
  restricted boolean not null default false,
  active boolean not null default true,
  notify_mode text,
  description text
);
create index if not exists sm_groups_rev_idx on sm_groups (org_id, rev);
create index if not exists sm_groups_upd_idx on sm_groups (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_groups_crt_idx on sm_groups (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_groups_parent_id_idx on sm_groups (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_groups_sync on sm_groups;
create trigger sm_groups_sync before insert or update on sm_groups for each row execute function sm_sync_touch('group');
create or replace trigger sm_groups_demo after insert on sm_groups for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_groups_demo_t after update or delete on sm_groups for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_groups enable row level security;

-- group_member: عضویت‌های گروه
do $cols$
begin
  if to_regclass('sm_group_members') is not null then
    alter table sm_group_members add column if not exists workspace_id uuid;
    alter table sm_group_members add column if not exists domain_id uuid;
    alter table sm_group_members add column if not exists unit_id uuid;
    alter table sm_group_members add column if not exists created_at timestamptz not null default now();
    alter table sm_group_members add column if not exists created_by uuid;
    alter table sm_group_members add column if not exists updated_at timestamptz not null default now();
    alter table sm_group_members add column if not exists updated_by uuid;
    alter table sm_group_members add column if not exists rev bigint not null default 0;
    alter table sm_group_members add column if not exists version integer not null default 1;
    alter table sm_group_members add column if not exists deleted_at timestamptz;
    alter table sm_group_members add column if not exists origin text;
    alter table sm_group_members add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_group_members add column if not exists group_id uuid;
    alter table sm_group_members add column if not exists user_id uuid;
    alter table sm_group_members add column if not exists kind text;
    alter table sm_group_members add column if not exists valid_from timestamptz;
    alter table sm_group_members add column if not exists valid_to timestamptz;
  end if;
end
$cols$;
create table if not exists sm_group_members (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  group_id uuid,
  user_id uuid,
  kind text,
  valid_from timestamptz,
  valid_to timestamptz
);
create index if not exists sm_group_members_rev_idx on sm_group_members (org_id, rev);
create index if not exists sm_group_members_upd_idx on sm_group_members (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_group_members_crt_idx on sm_group_members (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_group_members_group_id_idx on sm_group_members (org_id, group_id) where deleted_at is null;
create index if not exists sm_group_members_user_id_idx on sm_group_members (org_id, user_id) where deleted_at is null;
create unique index if not exists sm_group_members_group_id_user_id_uk on sm_group_members (org_id, group_id, user_id) where deleted_at is null;
create index if not exists sm_group_members_workspace_acc_idx on sm_group_members (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_group_members_unit_acc_idx on sm_group_members (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_group_members_domain_acc_idx on sm_group_members (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_group_members_sync on sm_group_members;
create trigger sm_group_members_sync before insert or update on sm_group_members for each row execute function sm_sync_touch('group_member');
create or replace trigger sm_group_members_demo after insert on sm_group_members for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_group_members_demo_t after update or delete on sm_group_members for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_group_members enable row level security;

-- hardware_standard: استانداردهای سخت‌افزار
do $cols$
begin
  if to_regclass('sm_hardware_standards') is not null then
    alter table sm_hardware_standards add column if not exists workspace_id uuid;
    alter table sm_hardware_standards add column if not exists domain_id uuid;
    alter table sm_hardware_standards add column if not exists unit_id uuid;
    alter table sm_hardware_standards add column if not exists created_at timestamptz not null default now();
    alter table sm_hardware_standards add column if not exists created_by uuid;
    alter table sm_hardware_standards add column if not exists updated_at timestamptz not null default now();
    alter table sm_hardware_standards add column if not exists updated_by uuid;
    alter table sm_hardware_standards add column if not exists rev bigint not null default 0;
    alter table sm_hardware_standards add column if not exists version integer not null default 1;
    alter table sm_hardware_standards add column if not exists deleted_at timestamptz;
    alter table sm_hardware_standards add column if not exists origin text;
    alter table sm_hardware_standards add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_hardware_standards add column if not exists name text;
    alter table sm_hardware_standards add column if not exists persona text;
    alter table sm_hardware_standards add column if not exists models jsonb;
    alter table sm_hardware_standards add column if not exists accessories jsonb;
    alter table sm_hardware_standards add column if not exists software jsonb;
    alter table sm_hardware_standards add column if not exists refresh_months integer;
    alter table sm_hardware_standards add column if not exists active boolean not null default true;
    alter table sm_hardware_standards add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_hardware_standards (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  persona text,
  models jsonb,
  accessories jsonb,
  software jsonb,
  refresh_months integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_hardware_standards_rev_idx on sm_hardware_standards (org_id, rev);
create index if not exists sm_hardware_standards_upd_idx on sm_hardware_standards (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hardware_standards_crt_idx on sm_hardware_standards (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_hardware_standards_sync on sm_hardware_standards;
create trigger sm_hardware_standards_sync before insert or update on sm_hardware_standards for each row execute function sm_sync_touch('hardware_standard');
create or replace trigger sm_hardware_standards_demo after insert on sm_hardware_standards for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_hardware_standards_demo_t after update or delete on sm_hardware_standards for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_hardware_standards enable row level security;

-- holiday: تعطیلات
do $cols$
begin
  if to_regclass('sm_holidays') is not null then
    alter table sm_holidays add column if not exists workspace_id uuid;
    alter table sm_holidays add column if not exists domain_id uuid;
    alter table sm_holidays add column if not exists unit_id uuid;
    alter table sm_holidays add column if not exists created_at timestamptz not null default now();
    alter table sm_holidays add column if not exists created_by uuid;
    alter table sm_holidays add column if not exists updated_at timestamptz not null default now();
    alter table sm_holidays add column if not exists updated_by uuid;
    alter table sm_holidays add column if not exists rev bigint not null default 0;
    alter table sm_holidays add column if not exists version integer not null default 1;
    alter table sm_holidays add column if not exists deleted_at timestamptz;
    alter table sm_holidays add column if not exists origin text;
    alter table sm_holidays add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_holidays add column if not exists date date;
    alter table sm_holidays add column if not exists title text;
    alter table sm_holidays add column if not exists holiday_set text;
    alter table sm_holidays add column if not exists half_day boolean not null default false;
    alter table sm_holidays add column if not exists kind text;
    alter table sm_holidays add column if not exists predicted boolean not null default false;
    alter table sm_holidays add column if not exists alternative_date date;
    alter table sm_holidays add column if not exists hijri text;
    alter table sm_holidays add column if not exists note text;
    alter table sm_holidays add column if not exists year integer;
    alter table sm_holidays add column if not exists source text;
    alter table sm_holidays add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_holidays (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  date date,
  title text,
  holiday_set text,
  half_day boolean not null default false,
  kind text,
  predicted boolean not null default false,
  alternative_date date,
  hijri text,
  note text,
  year integer,
  source text,
  active boolean not null default true
);
create index if not exists sm_holidays_rev_idx on sm_holidays (org_id, rev);
create index if not exists sm_holidays_upd_idx on sm_holidays (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_holidays_crt_idx on sm_holidays (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_holidays_date_idx on sm_holidays (org_id, date) where deleted_at is null;
create unique index if not exists sm_holidays_holiday_set_date_uk on sm_holidays (org_id, holiday_set, date) where deleted_at is null;
drop trigger if exists sm_holidays_sync on sm_holidays;
create trigger sm_holidays_sync before insert or update on sm_holidays for each row execute function sm_sync_touch('holiday');
create or replace trigger sm_holidays_demo after insert on sm_holidays for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_holidays_demo_t after update or delete on sm_holidays for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_holidays enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:12', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۴ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 14/30 (a0c3bc7de847)
-- hr_case: پرونده‌های منابع انسانی
do $cols$
begin
  if to_regclass('sm_hr_cases') is not null then
    alter table sm_hr_cases add column if not exists workspace_id uuid;
    alter table sm_hr_cases add column if not exists domain_id uuid;
    alter table sm_hr_cases add column if not exists unit_id uuid;
    alter table sm_hr_cases add column if not exists created_at timestamptz not null default now();
    alter table sm_hr_cases add column if not exists created_by uuid;
    alter table sm_hr_cases add column if not exists updated_at timestamptz not null default now();
    alter table sm_hr_cases add column if not exists updated_by uuid;
    alter table sm_hr_cases add column if not exists rev bigint not null default 0;
    alter table sm_hr_cases add column if not exists version integer not null default 1;
    alter table sm_hr_cases add column if not exists deleted_at timestamptz;
    alter table sm_hr_cases add column if not exists origin text;
    alter table sm_hr_cases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_hr_cases add column if not exists no integer;
    alter table sm_hr_cases add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'HRC' || no::text else 'HRC' || lpad(no::text, 7, '0') end) stored;
    alter table sm_hr_cases add column if not exists short_description text;
    alter table sm_hr_cases add column if not exists description text;
    alter table sm_hr_cases add column if not exists state text;
    alter table sm_hr_cases add column if not exists priority text;
    alter table sm_hr_cases add column if not exists impact text;
    alter table sm_hr_cases add column if not exists urgency text;
    alter table sm_hr_cases add column if not exists category text;
    alter table sm_hr_cases add column if not exists subcategory text;
    alter table sm_hr_cases add column if not exists channel text;
    alter table sm_hr_cases add column if not exists caller_id uuid;
    alter table sm_hr_cases add column if not exists requested_for uuid;
    alter table sm_hr_cases add column if not exists opened_by uuid;
    alter table sm_hr_cases add column if not exists opened_at timestamptz;
    alter table sm_hr_cases add column if not exists assignment_group_id uuid;
    alter table sm_hr_cases add column if not exists assigned_to uuid;
    alter table sm_hr_cases add column if not exists service_id uuid;
    alter table sm_hr_cases add column if not exists offering_id uuid;
    alter table sm_hr_cases add column if not exists ci_id uuid;
    alter table sm_hr_cases add column if not exists location_id uuid;
    alter table sm_hr_cases add column if not exists due_at timestamptz;
    alter table sm_hr_cases add column if not exists resolved_at timestamptz;
    alter table sm_hr_cases add column if not exists resolved_by uuid;
    alter table sm_hr_cases add column if not exists closed_at timestamptz;
    alter table sm_hr_cases add column if not exists closed_by uuid;
    alter table sm_hr_cases add column if not exists close_code text;
    alter table sm_hr_cases add column if not exists close_notes text;
    alter table sm_hr_cases add column if not exists parent_id uuid;
    alter table sm_hr_cases add column if not exists watch_list jsonb;
    alter table sm_hr_cases add column if not exists approval text;
    alter table sm_hr_cases add column if not exists escalation integer;
    alter table sm_hr_cases add column if not exists reassignment_count integer;
    alter table sm_hr_cases add column if not exists reopen_count integer;
    alter table sm_hr_cases add column if not exists time_worked bigint;
    alter table sm_hr_cases add column if not exists first_response_at timestamptz;
    alter table sm_hr_cases add column if not exists active boolean not null default true;
    alter table sm_hr_cases add column if not exists sla_due timestamptz;
    alter table sm_hr_cases add column if not exists knowledge boolean not null default false;
    alter table sm_hr_cases add column if not exists title text;
    alter table sm_hr_cases add column if not exists department_id uuid;
    alter table sm_hr_cases add column if not exists dept_service_id uuid;
    alter table sm_hr_cases add column if not exists sensitive boolean not null default false;
    alter table sm_hr_cases add column if not exists journey_id uuid;
    alter table sm_hr_cases add column if not exists child_total integer;
    alter table sm_hr_cases add column if not exists child_open integer;
    alter table sm_hr_cases add column if not exists satisfaction integer;
    alter table sm_hr_cases add column if not exists subject_person_id uuid;
    alter table sm_hr_cases add column if not exists subject_visible boolean not null default true;
    alter table sm_hr_cases add column if not exists subject_readers jsonb;
    alter table sm_hr_cases add column if not exists coe text;
    alter table sm_hr_cases add column if not exists confidentiality text;
    alter table sm_hr_cases add column if not exists effective_date date;
    alter table sm_hr_cases add column if not exists sensitive_notes text;
    alter table sm_hr_cases add column if not exists pay_details text;
    alter table sm_hr_cases add column if not exists medical_notes text;
    alter table sm_hr_cases add column if not exists disciplinary boolean not null default false;
    alter table sm_hr_cases add column if not exists legal_hold boolean not null default false;
    alter table sm_hr_cases add column if not exists confidential boolean not null default false;
    alter table sm_hr_cases add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_hr_cases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'HRC' || no::text else 'HRC' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  title text,
  department_id uuid,
  dept_service_id uuid,
  sensitive boolean not null default false,
  journey_id uuid,
  child_total integer,
  child_open integer,
  satisfaction integer,
  subject_person_id uuid,
  subject_visible boolean not null default true,
  subject_readers jsonb,
  coe text,
  confidentiality text,
  effective_date date,
  sensitive_notes text,
  pay_details text,
  medical_notes text,
  disciplinary boolean not null default false,
  legal_hold boolean not null default false,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hr_cases' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_hr_cases', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_hr_cases', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_hr_cases' and indexname like 'sm\_hr\_cases\_search\_%' and indexname not in ('sm_hr_cases_search_f3bce210_trgm', 'sm_hr_cases_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_hr_cases_search_f3bce210_trgm', 'sm_hr_cases', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_hr_cases_search_custom_trgm', 'sm_hr_cases', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_hr_cases_no_uk on sm_hr_cases (org_id, no);
create index if not exists sm_hr_cases_rev_idx on sm_hr_cases (org_id, rev);
create index if not exists sm_hr_cases_upd_idx on sm_hr_cases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_cases_crt_idx on sm_hr_cases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_cases_state_idx on sm_hr_cases (org_id, state) where deleted_at is null;
create index if not exists sm_hr_cases_assignment_group_id_idx on sm_hr_cases (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_hr_cases_assigned_to_idx on sm_hr_cases (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_hr_cases_department_id_idx on sm_hr_cases (org_id, department_id) where deleted_at is null;
create index if not exists sm_hr_cases_dept_service_id_idx on sm_hr_cases (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_hr_cases_subject_person_id_idx on sm_hr_cases (org_id, subject_person_id) where deleted_at is null;
create index if not exists sm_hr_cases_workspace_acc_idx on sm_hr_cases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_hr_cases_unit_acc_idx on sm_hr_cases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_hr_cases_domain_acc_idx on sm_hr_cases (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_hr_cases_caller_id_idx on sm_hr_cases (org_id, caller_id) where deleted_at is null;
create index if not exists sm_hr_cases_requested_for_idx on sm_hr_cases (org_id, requested_for) where deleted_at is null;
create index if not exists sm_hr_cases_opened_by_idx on sm_hr_cases (org_id, opened_by) where deleted_at is null;
create index if not exists sm_hr_cases_subject_readers_gin on sm_hr_cases using gin (subject_readers);
create index if not exists sm_hr_cases_watch_list_gin on sm_hr_cases using gin (watch_list);
create index if not exists sm_hr_cases_open_grp_idx on sm_hr_cases (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_hr_cases_opened_brin on sm_hr_cases using brin (opened_at);
drop trigger if exists sm_hr_cases_sync on sm_hr_cases;
create trigger sm_hr_cases_sync before insert or update on sm_hr_cases for each row execute function sm_sync_touch('hr_case');
create or replace trigger sm_hr_cases_demo after insert on sm_hr_cases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_hr_cases_demo_t after update or delete on sm_hr_cases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_hr_cases enable row level security;

-- hr_case_note: یادداشت‌های روابط کار
do $cols$
begin
  if to_regclass('sm_hr_case_notes') is not null then
    alter table sm_hr_case_notes add column if not exists workspace_id uuid;
    alter table sm_hr_case_notes add column if not exists domain_id uuid;
    alter table sm_hr_case_notes add column if not exists unit_id uuid;
    alter table sm_hr_case_notes add column if not exists created_at timestamptz not null default now();
    alter table sm_hr_case_notes add column if not exists created_by uuid;
    alter table sm_hr_case_notes add column if not exists updated_at timestamptz not null default now();
    alter table sm_hr_case_notes add column if not exists updated_by uuid;
    alter table sm_hr_case_notes add column if not exists rev bigint not null default 0;
    alter table sm_hr_case_notes add column if not exists version integer not null default 1;
    alter table sm_hr_case_notes add column if not exists deleted_at timestamptz;
    alter table sm_hr_case_notes add column if not exists origin text;
    alter table sm_hr_case_notes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_hr_case_notes add column if not exists hr_case_id uuid;
    alter table sm_hr_case_notes add column if not exists note_type text;
    alter table sm_hr_case_notes add column if not exists legal_hold boolean not null default false;
    alter table sm_hr_case_notes add column if not exists author_id uuid;
    alter table sm_hr_case_notes add column if not exists specialists jsonb;
    alter table sm_hr_case_notes add column if not exists body text;
  end if;
end
$cols$;
create table if not exists sm_hr_case_notes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  hr_case_id uuid,
  note_type text,
  legal_hold boolean not null default false,
  author_id uuid,
  specialists jsonb,
  body text
);
create index if not exists sm_hr_case_notes_rev_idx on sm_hr_case_notes (org_id, rev);
create index if not exists sm_hr_case_notes_upd_idx on sm_hr_case_notes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_case_notes_crt_idx on sm_hr_case_notes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_case_notes_hr_case_id_idx on sm_hr_case_notes (org_id, hr_case_id) where deleted_at is null;
create index if not exists sm_hr_case_notes_workspace_acc_idx on sm_hr_case_notes (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_hr_case_notes_unit_acc_idx on sm_hr_case_notes (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_hr_case_notes_domain_acc_idx on sm_hr_case_notes (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_hr_case_notes_author_id_idx on sm_hr_case_notes (org_id, author_id) where deleted_at is null;
create index if not exists sm_hr_case_notes_specialists_gin on sm_hr_case_notes using gin (specialists);
drop trigger if exists sm_hr_case_notes_sync on sm_hr_case_notes;
create trigger sm_hr_case_notes_sync before insert or update on sm_hr_case_notes for each row execute function sm_sync_touch('hr_case_note');
create or replace trigger sm_hr_case_notes_demo after insert on sm_hr_case_notes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_hr_case_notes_demo_t after update or delete on sm_hr_case_notes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_hr_case_notes enable row level security;

-- hr_profile: نمایه‌های استخدامی
do $cols$
begin
  if to_regclass('sm_hr_profiles') is not null then
    alter table sm_hr_profiles add column if not exists workspace_id uuid;
    alter table sm_hr_profiles add column if not exists domain_id uuid;
    alter table sm_hr_profiles add column if not exists unit_id uuid;
    alter table sm_hr_profiles add column if not exists created_at timestamptz not null default now();
    alter table sm_hr_profiles add column if not exists created_by uuid;
    alter table sm_hr_profiles add column if not exists updated_at timestamptz not null default now();
    alter table sm_hr_profiles add column if not exists updated_by uuid;
    alter table sm_hr_profiles add column if not exists rev bigint not null default 0;
    alter table sm_hr_profiles add column if not exists version integer not null default 1;
    alter table sm_hr_profiles add column if not exists deleted_at timestamptz;
    alter table sm_hr_profiles add column if not exists origin text;
    alter table sm_hr_profiles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_hr_profiles add column if not exists user_id uuid;
    alter table sm_hr_profiles add column if not exists name text;
    alter table sm_hr_profiles add column if not exists employee_no text;
    alter table sm_hr_profiles add column if not exists status text;
    alter table sm_hr_profiles add column if not exists employment_type text;
    alter table sm_hr_profiles add column if not exists job_title text;
    alter table sm_hr_profiles add column if not exists grade text;
    alter table sm_hr_profiles add column if not exists legal_entity text;
    alter table sm_hr_profiles add column if not exists province text;
    alter table sm_hr_profiles add column if not exists location_id uuid;
    alter table sm_hr_profiles add column if not exists org_unit_id uuid;
    alter table sm_hr_profiles add column if not exists manager_id uuid;
    alter table sm_hr_profiles add column if not exists start_date date;
    alter table sm_hr_profiles add column if not exists end_date date;
    alter table sm_hr_profiles add column if not exists probation_end date;
    alter table sm_hr_profiles add column if not exists hr_group_id uuid;
    alter table sm_hr_profiles add column if not exists emergency_contact text;
    alter table sm_hr_profiles add column if not exists national_id text;
    alter table sm_hr_profiles add column if not exists salary_band text;
  end if;
end
$cols$;
create table if not exists sm_hr_profiles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  name text,
  employee_no text,
  status text,
  employment_type text,
  job_title text,
  grade text,
  legal_entity text,
  province text,
  location_id uuid,
  org_unit_id uuid,
  manager_id uuid,
  start_date date,
  end_date date,
  probation_end date,
  hr_group_id uuid,
  emergency_contact text,
  national_id text,
  salary_band text
);
create index if not exists sm_hr_profiles_rev_idx on sm_hr_profiles (org_id, rev);
create index if not exists sm_hr_profiles_upd_idx on sm_hr_profiles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_profiles_crt_idx on sm_hr_profiles (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_hr_profiles_user_id_uk on sm_hr_profiles (org_id, user_id) where deleted_at is null;
create unique index if not exists sm_hr_profiles_employee_no_uk on sm_hr_profiles (org_id, employee_no) where deleted_at is null;
create index if not exists sm_hr_profiles_workspace_acc_idx on sm_hr_profiles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_hr_profiles_unit_acc_idx on sm_hr_profiles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_hr_profiles_domain_acc_idx on sm_hr_profiles (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_hr_profiles_user_id_idx on sm_hr_profiles (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_hr_profiles_sync on sm_hr_profiles;
create trigger sm_hr_profiles_sync before insert or update on sm_hr_profiles for each row execute function sm_sync_touch('hr_profile');
create or replace trigger sm_hr_profiles_demo after insert on sm_hr_profiles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_hr_profiles_demo_t after update or delete on sm_hr_profiles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_hr_profiles enable row level security;

-- hr_task: کارهای منابع انسانی
do $cols$
begin
  if to_regclass('sm_hr_tasks') is not null then
    alter table sm_hr_tasks add column if not exists workspace_id uuid;
    alter table sm_hr_tasks add column if not exists domain_id uuid;
    alter table sm_hr_tasks add column if not exists unit_id uuid;
    alter table sm_hr_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_hr_tasks add column if not exists created_by uuid;
    alter table sm_hr_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_hr_tasks add column if not exists updated_by uuid;
    alter table sm_hr_tasks add column if not exists rev bigint not null default 0;
    alter table sm_hr_tasks add column if not exists version integer not null default 1;
    alter table sm_hr_tasks add column if not exists deleted_at timestamptz;
    alter table sm_hr_tasks add column if not exists origin text;
    alter table sm_hr_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_hr_tasks add column if not exists no integer;
    alter table sm_hr_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'HRT' || no::text else 'HRT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_hr_tasks add column if not exists short_description text;
    alter table sm_hr_tasks add column if not exists type text;
    alter table sm_hr_tasks add column if not exists assigned_to uuid;
    alter table sm_hr_tasks add column if not exists due_date date;
    alter table sm_hr_tasks add column if not exists assignment_group_id uuid;
    alter table sm_hr_tasks add column if not exists hr_case_id uuid;
    alter table sm_hr_tasks add column if not exists journey_id uuid;
    alter table sm_hr_tasks add column if not exists journey_activity_id uuid;
    alter table sm_hr_tasks add column if not exists instructions text;
    alter table sm_hr_tasks add column if not exists document_url text;
    alter table sm_hr_tasks add column if not exists acknowledged boolean not null default false;
    alter table sm_hr_tasks add column if not exists signed_name text;
    alter table sm_hr_tasks add column if not exists signed_at timestamptz;
    alter table sm_hr_tasks add column if not exists response text;
    alter table sm_hr_tasks add column if not exists outcome text;
    alter table sm_hr_tasks add column if not exists done_at timestamptz;
    alter table sm_hr_tasks add column if not exists case_readers jsonb;
    alter table sm_hr_tasks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_hr_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'HRT' || no::text else 'HRT' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  type text,
  assigned_to uuid,
  due_date date,
  assignment_group_id uuid,
  hr_case_id uuid,
  journey_id uuid,
  journey_activity_id uuid,
  instructions text,
  document_url text,
  acknowledged boolean not null default false,
  signed_name text,
  signed_at timestamptz,
  response text,
  outcome text,
  done_at timestamptz,
  case_readers jsonb,
  state text,
  search_9c3826f0 text generated always as (translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hr_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9c3826f0' loop
    execute format('alter table %I drop column if exists %I', 'sm_hr_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_hr_tasks', 'search_9c3826f0', $x$translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_hr_tasks' and indexname like 'sm\_hr\_tasks\_search\_%' and indexname not in ('sm_hr_tasks_search_9c3826f0_trgm', 'sm_hr_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_hr_tasks_search_9c3826f0_trgm', 'sm_hr_tasks', 'search_9c3826f0', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_hr_tasks_search_custom_trgm', 'sm_hr_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_hr_tasks_no_uk on sm_hr_tasks (org_id, no);
create index if not exists sm_hr_tasks_rev_idx on sm_hr_tasks (org_id, rev);
create index if not exists sm_hr_tasks_upd_idx on sm_hr_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_tasks_crt_idx on sm_hr_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_tasks_assigned_to_idx on sm_hr_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_hr_tasks_assignment_group_id_idx on sm_hr_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_hr_tasks_hr_case_id_idx on sm_hr_tasks (org_id, hr_case_id) where deleted_at is null;
create index if not exists sm_hr_tasks_journey_id_idx on sm_hr_tasks (org_id, journey_id) where deleted_at is null;
create index if not exists sm_hr_tasks_state_idx on sm_hr_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_hr_tasks_workspace_acc_idx on sm_hr_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_hr_tasks_unit_acc_idx on sm_hr_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_hr_tasks_domain_acc_idx on sm_hr_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_hr_tasks_case_readers_gin on sm_hr_tasks using gin (case_readers);
drop trigger if exists sm_hr_tasks_sync on sm_hr_tasks;
create trigger sm_hr_tasks_sync before insert or update on sm_hr_tasks for each row execute function sm_sync_touch('hr_task');
create or replace trigger sm_hr_tasks_demo after insert on sm_hr_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_hr_tasks_demo_t after update or delete on sm_hr_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_hr_tasks enable row level security;

-- hse_event: رویدادهای ایمنی و بهداشت کار
do $cols$
begin
  if to_regclass('sm_hse_events') is not null then
    alter table sm_hse_events add column if not exists workspace_id uuid;
    alter table sm_hse_events add column if not exists domain_id uuid;
    alter table sm_hse_events add column if not exists unit_id uuid;
    alter table sm_hse_events add column if not exists created_at timestamptz not null default now();
    alter table sm_hse_events add column if not exists created_by uuid;
    alter table sm_hse_events add column if not exists updated_at timestamptz not null default now();
    alter table sm_hse_events add column if not exists updated_by uuid;
    alter table sm_hse_events add column if not exists rev bigint not null default 0;
    alter table sm_hse_events add column if not exists version integer not null default 1;
    alter table sm_hse_events add column if not exists deleted_at timestamptz;
    alter table sm_hse_events add column if not exists origin text;
    alter table sm_hse_events add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_hse_events add column if not exists no integer;
    alter table sm_hse_events add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'HSE' || no::text else 'HSE' || lpad(no::text, 7, '0') end) stored;
    alter table sm_hse_events add column if not exists short_description text;
    alter table sm_hse_events add column if not exists description text;
    alter table sm_hse_events add column if not exists state text;
    alter table sm_hse_events add column if not exists priority text;
    alter table sm_hse_events add column if not exists impact text;
    alter table sm_hse_events add column if not exists urgency text;
    alter table sm_hse_events add column if not exists category text;
    alter table sm_hse_events add column if not exists subcategory text;
    alter table sm_hse_events add column if not exists channel text;
    alter table sm_hse_events add column if not exists caller_id uuid;
    alter table sm_hse_events add column if not exists requested_for uuid;
    alter table sm_hse_events add column if not exists opened_by uuid;
    alter table sm_hse_events add column if not exists opened_at timestamptz;
    alter table sm_hse_events add column if not exists assignment_group_id uuid;
    alter table sm_hse_events add column if not exists assigned_to uuid;
    alter table sm_hse_events add column if not exists service_id uuid;
    alter table sm_hse_events add column if not exists offering_id uuid;
    alter table sm_hse_events add column if not exists ci_id uuid;
    alter table sm_hse_events add column if not exists location_id uuid;
    alter table sm_hse_events add column if not exists due_at timestamptz;
    alter table sm_hse_events add column if not exists resolved_at timestamptz;
    alter table sm_hse_events add column if not exists resolved_by uuid;
    alter table sm_hse_events add column if not exists closed_at timestamptz;
    alter table sm_hse_events add column if not exists closed_by uuid;
    alter table sm_hse_events add column if not exists close_code text;
    alter table sm_hse_events add column if not exists close_notes text;
    alter table sm_hse_events add column if not exists parent_id uuid;
    alter table sm_hse_events add column if not exists watch_list jsonb;
    alter table sm_hse_events add column if not exists approval text;
    alter table sm_hse_events add column if not exists escalation integer;
    alter table sm_hse_events add column if not exists reassignment_count integer;
    alter table sm_hse_events add column if not exists reopen_count integer;
    alter table sm_hse_events add column if not exists time_worked bigint;
    alter table sm_hse_events add column if not exists first_response_at timestamptz;
    alter table sm_hse_events add column if not exists active boolean not null default true;
    alter table sm_hse_events add column if not exists sla_due timestamptz;
    alter table sm_hse_events add column if not exists knowledge boolean not null default false;
    alter table sm_hse_events add column if not exists title text;
    alter table sm_hse_events add column if not exists department_id uuid;
    alter table sm_hse_events add column if not exists dept_service_id uuid;
    alter table sm_hse_events add column if not exists sensitive boolean not null default false;
    alter table sm_hse_events add column if not exists journey_id uuid;
    alter table sm_hse_events add column if not exists child_total integer;
    alter table sm_hse_events add column if not exists child_open integer;
    alter table sm_hse_events add column if not exists satisfaction integer;
    alter table sm_hse_events add column if not exists event_type text;
    alter table sm_hse_events add column if not exists occurred_at timestamptz;
    alter table sm_hse_events add column if not exists injured_person text;
    alter table sm_hse_events add column if not exists injury_details text;
    alter table sm_hse_events add column if not exists lost_days integer;
    alter table sm_hse_events add column if not exists immediate_action text;
    alter table sm_hse_events add column if not exists root_cause text;
    alter table sm_hse_events add column if not exists corrective_actions text;
    alter table sm_hse_events add column if not exists actions_due date;
    alter table sm_hse_events add column if not exists reportable boolean not null default false;
    alter table sm_hse_events add column if not exists reported_at timestamptz;
    alter table sm_hse_events add column if not exists confidential boolean not null default false;
    alter table sm_hse_events add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_hse_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'HSE' || no::text else 'HSE' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  title text,
  department_id uuid,
  dept_service_id uuid,
  sensitive boolean not null default false,
  journey_id uuid,
  child_total integer,
  child_open integer,
  satisfaction integer,
  event_type text,
  occurred_at timestamptz,
  injured_person text,
  injury_details text,
  lost_days integer,
  immediate_action text,
  root_cause text,
  corrective_actions text,
  actions_due date,
  reportable boolean not null default false,
  reported_at timestamptz,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hse_events' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_hse_events', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_hse_events', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_hse_events' and indexname like 'sm\_hse\_events\_search\_%' and indexname not in ('sm_hse_events_search_f3bce210_trgm', 'sm_hse_events_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_hse_events_search_f3bce210_trgm', 'sm_hse_events', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_hse_events_search_custom_trgm', 'sm_hse_events', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_hse_events_no_uk on sm_hse_events (org_id, no);
create index if not exists sm_hse_events_rev_idx on sm_hse_events (org_id, rev);
create index if not exists sm_hse_events_upd_idx on sm_hse_events (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hse_events_crt_idx on sm_hse_events (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_hse_events_state_idx on sm_hse_events (org_id, state) where deleted_at is null;
create index if not exists sm_hse_events_assignment_group_id_idx on sm_hse_events (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_hse_events_assigned_to_idx on sm_hse_events (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_hse_events_department_id_idx on sm_hse_events (org_id, department_id) where deleted_at is null;
create index if not exists sm_hse_events_dept_service_id_idx on sm_hse_events (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_hse_events_workspace_acc_idx on sm_hse_events (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_hse_events_unit_acc_idx on sm_hse_events (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_hse_events_domain_acc_idx on sm_hse_events (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_hse_events_caller_id_idx on sm_hse_events (org_id, caller_id) where deleted_at is null;
create index if not exists sm_hse_events_requested_for_idx on sm_hse_events (org_id, requested_for) where deleted_at is null;
create index if not exists sm_hse_events_opened_by_idx on sm_hse_events (org_id, opened_by) where deleted_at is null;
create index if not exists sm_hse_events_watch_list_gin on sm_hse_events using gin (watch_list);
create index if not exists sm_hse_events_open_grp_idx on sm_hse_events (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_hse_events_opened_brin on sm_hse_events using brin (opened_at);
drop trigger if exists sm_hse_events_sync on sm_hse_events;
create trigger sm_hse_events_sync before insert or update on sm_hse_events for each row execute function sm_sync_touch('hse_event');
create or replace trigger sm_hse_events_demo after insert on sm_hse_events for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_hse_events_demo_t after update or delete on sm_hse_events for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_hse_events enable row level security;

-- import_set: مجموعه‌های ورود داده
do $cols$
begin
  if to_regclass('sm_import_sets') is not null then
    alter table sm_import_sets add column if not exists workspace_id uuid;
    alter table sm_import_sets add column if not exists domain_id uuid;
    alter table sm_import_sets add column if not exists unit_id uuid;
    alter table sm_import_sets add column if not exists created_at timestamptz not null default now();
    alter table sm_import_sets add column if not exists created_by uuid;
    alter table sm_import_sets add column if not exists updated_at timestamptz not null default now();
    alter table sm_import_sets add column if not exists updated_by uuid;
    alter table sm_import_sets add column if not exists rev bigint not null default 0;
    alter table sm_import_sets add column if not exists version integer not null default 1;
    alter table sm_import_sets add column if not exists deleted_at timestamptz;
    alter table sm_import_sets add column if not exists origin text;
    alter table sm_import_sets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_import_sets add column if not exists no integer;
    alter table sm_import_sets add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'IMP' || no::text else 'IMP' || lpad(no::text, 6, '0') end) stored;
    alter table sm_import_sets add column if not exists name text;
    alter table sm_import_sets add column if not exists target_table text;
    alter table sm_import_sets add column if not exists transform_map_id uuid;
    alter table sm_import_sets add column if not exists source text;
    alter table sm_import_sets add column if not exists source_url text;
    alter table sm_import_sets add column if not exists schedule_hours integer;
    alter table sm_import_sets add column if not exists status text;
    alter table sm_import_sets add column if not exists headers jsonb;
    alter table sm_import_sets add column if not exists sample jsonb;
    alter table sm_import_sets add column if not exists rows_total integer;
    alter table sm_import_sets add column if not exists stats jsonb;
    alter table sm_import_sets add column if not exists last_run_at timestamptz;
    alter table sm_import_sets add column if not exists next_run_at timestamptz;
    alter table sm_import_sets add column if not exists last_error text;
  end if;
end
$cols$;
create table if not exists sm_import_sets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'IMP' || no::text else 'IMP' || lpad(no::text, 6, '0') end) stored,
  name text,
  target_table text,
  transform_map_id uuid,
  source text,
  source_url text,
  schedule_hours integer,
  status text,
  headers jsonb,
  sample jsonb,
  rows_total integer,
  stats jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_error text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_import_sets' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_import_sets', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_import_sets', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_import_sets' and indexname like 'sm\_import\_sets\_search\_%' and indexname not in ('sm_import_sets_search_56291d9d_trgm', 'sm_import_sets_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_import_sets_search_56291d9d_trgm', 'sm_import_sets', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_import_sets_search_custom_trgm', 'sm_import_sets', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_import_sets_no_uk on sm_import_sets (org_id, no);
create index if not exists sm_import_sets_rev_idx on sm_import_sets (org_id, rev);
create index if not exists sm_import_sets_upd_idx on sm_import_sets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_import_sets_crt_idx on sm_import_sets (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_import_sets_sync on sm_import_sets;
create trigger sm_import_sets_sync before insert or update on sm_import_sets for each row execute function sm_sync_touch('import_set');
create or replace trigger sm_import_sets_demo after insert on sm_import_sets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_import_sets_demo_t after update or delete on sm_import_sets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_import_sets enable row level security;

-- inbound_endpoint: نقطه‌های دریافت
do $cols$
begin
  if to_regclass('sm_inbound_endpoints') is not null then
    alter table sm_inbound_endpoints add column if not exists workspace_id uuid;
    alter table sm_inbound_endpoints add column if not exists domain_id uuid;
    alter table sm_inbound_endpoints add column if not exists unit_id uuid;
    alter table sm_inbound_endpoints add column if not exists created_at timestamptz not null default now();
    alter table sm_inbound_endpoints add column if not exists created_by uuid;
    alter table sm_inbound_endpoints add column if not exists updated_at timestamptz not null default now();
    alter table sm_inbound_endpoints add column if not exists updated_by uuid;
    alter table sm_inbound_endpoints add column if not exists rev bigint not null default 0;
    alter table sm_inbound_endpoints add column if not exists version integer not null default 1;
    alter table sm_inbound_endpoints add column if not exists deleted_at timestamptz;
    alter table sm_inbound_endpoints add column if not exists origin text;
    alter table sm_inbound_endpoints add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_inbound_endpoints add column if not exists name text;
    alter table sm_inbound_endpoints add column if not exists active boolean not null default true;
    alter table sm_inbound_endpoints add column if not exists auth text;
    alter table sm_inbound_endpoints add column if not exists token text;
    alter table sm_inbound_endpoints add column if not exists principal_id uuid;
    alter table sm_inbound_endpoints add column if not exists target_table text;
    alter table sm_inbound_endpoints add column if not exists action text;
    alter table sm_inbound_endpoints add column if not exists match_field text;
    alter table sm_inbound_endpoints add column if not exists match_path text;
    alter table sm_inbound_endpoints add column if not exists mapping jsonb;
    alter table sm_inbound_endpoints add column if not exists defaults jsonb;
    alter table sm_inbound_endpoints add column if not exists description text;
    alter table sm_inbound_endpoints add column if not exists received integer;
    alter table sm_inbound_endpoints add column if not exists failed integer;
    alter table sm_inbound_endpoints add column if not exists last_received_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_inbound_endpoints (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  auth text,
  token text,
  principal_id uuid,
  target_table text,
  action text,
  match_field text,
  match_path text,
  mapping jsonb,
  defaults jsonb,
  description text,
  received integer,
  failed integer,
  last_received_at timestamptz
);
create index if not exists sm_inbound_endpoints_rev_idx on sm_inbound_endpoints (org_id, rev);
create index if not exists sm_inbound_endpoints_upd_idx on sm_inbound_endpoints (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_inbound_endpoints_crt_idx on sm_inbound_endpoints (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_inbound_endpoints_workspace_acc_idx on sm_inbound_endpoints (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_inbound_endpoints_unit_acc_idx on sm_inbound_endpoints (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_inbound_endpoints_domain_acc_idx on sm_inbound_endpoints (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_inbound_endpoints_sync on sm_inbound_endpoints;
create trigger sm_inbound_endpoints_sync before insert or update on sm_inbound_endpoints for each row execute function sm_sync_touch('inbound_endpoint');
create or replace trigger sm_inbound_endpoints_demo after insert on sm_inbound_endpoints for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_inbound_endpoints_demo_t after update or delete on sm_inbound_endpoints for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_inbound_endpoints enable row level security;

-- incident: رخدادها
do $cols$
begin
  if to_regclass('sm_incidents') is not null then
    alter table sm_incidents add column if not exists workspace_id uuid;
    alter table sm_incidents add column if not exists domain_id uuid;
    alter table sm_incidents add column if not exists unit_id uuid;
    alter table sm_incidents add column if not exists created_at timestamptz not null default now();
    alter table sm_incidents add column if not exists created_by uuid;
    alter table sm_incidents add column if not exists updated_at timestamptz not null default now();
    alter table sm_incidents add column if not exists updated_by uuid;
    alter table sm_incidents add column if not exists rev bigint not null default 0;
    alter table sm_incidents add column if not exists version integer not null default 1;
    alter table sm_incidents add column if not exists deleted_at timestamptz;
    alter table sm_incidents add column if not exists origin text;
    alter table sm_incidents add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incidents add column if not exists no integer;
    alter table sm_incidents add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'INC' || no::text else 'INC' || lpad(no::text, 7, '0') end) stored;
    alter table sm_incidents add column if not exists short_description text;
    alter table sm_incidents add column if not exists description text;
    alter table sm_incidents add column if not exists state text;
    alter table sm_incidents add column if not exists priority text;
    alter table sm_incidents add column if not exists impact text;
    alter table sm_incidents add column if not exists urgency text;
    alter table sm_incidents add column if not exists category text;
    alter table sm_incidents add column if not exists subcategory text;
    alter table sm_incidents add column if not exists channel text;
    alter table sm_incidents add column if not exists caller_id uuid;
    alter table sm_incidents add column if not exists requested_for uuid;
    alter table sm_incidents add column if not exists opened_by uuid;
    alter table sm_incidents add column if not exists opened_at timestamptz;
    alter table sm_incidents add column if not exists assignment_group_id uuid;
    alter table sm_incidents add column if not exists assigned_to uuid;
    alter table sm_incidents add column if not exists service_id uuid;
    alter table sm_incidents add column if not exists offering_id uuid;
    alter table sm_incidents add column if not exists ci_id uuid;
    alter table sm_incidents add column if not exists location_id uuid;
    alter table sm_incidents add column if not exists due_at timestamptz;
    alter table sm_incidents add column if not exists resolved_at timestamptz;
    alter table sm_incidents add column if not exists resolved_by uuid;
    alter table sm_incidents add column if not exists closed_at timestamptz;
    alter table sm_incidents add column if not exists closed_by uuid;
    alter table sm_incidents add column if not exists close_code text;
    alter table sm_incidents add column if not exists close_notes text;
    alter table sm_incidents add column if not exists parent_id uuid;
    alter table sm_incidents add column if not exists watch_list jsonb;
    alter table sm_incidents add column if not exists approval text;
    alter table sm_incidents add column if not exists escalation integer;
    alter table sm_incidents add column if not exists reassignment_count integer;
    alter table sm_incidents add column if not exists reopen_count integer;
    alter table sm_incidents add column if not exists time_worked bigint;
    alter table sm_incidents add column if not exists first_response_at timestamptz;
    alter table sm_incidents add column if not exists active boolean not null default true;
    alter table sm_incidents add column if not exists sla_due timestamptz;
    alter table sm_incidents add column if not exists knowledge boolean not null default false;
    alter table sm_incidents add column if not exists hold_reason text;
    alter table sm_incidents add column if not exists vip boolean not null default false;
    alter table sm_incidents add column if not exists security_incident boolean not null default false;
    alter table sm_incidents add column if not exists template_id uuid;
    alter table sm_incidents add column if not exists external_ref text;
    alter table sm_incidents add column if not exists affected_services jsonb;
    alter table sm_incidents add column if not exists affected_cis jsonb;
    alter table sm_incidents add column if not exists affected_users jsonb;
    alter table sm_incidents add column if not exists detected_at timestamptz;
    alter table sm_incidents add column if not exists accepted_at timestamptz;
    alter table sm_incidents add column if not exists hold_since timestamptz;
    alter table sm_incidents add column if not exists follow_ups integer;
    alter table sm_incidents add column if not exists last_follow_up_at timestamptz;
    alter table sm_incidents add column if not exists time_to_accept bigint;
    alter table sm_incidents add column if not exists time_to_resolve bigint;
    alter table sm_incidents add column if not exists cause_code text;
    alter table sm_incidents add column if not exists workaround text;
    alter table sm_incidents add column if not exists problem_id uuid;
    alter table sm_incidents add column if not exists known_error_id uuid;
    alter table sm_incidents add column if not exists merged_into uuid;
    alter table sm_incidents add column if not exists follow_up_of uuid;
    alter table sm_incidents add column if not exists major_state text;
    alter table sm_incidents add column if not exists mi_manager_id uuid;
    alter table sm_incidents add column if not exists mi_comms_id uuid;
    alter table sm_incidents add column if not exists mi_declared_at timestamptz;
    alter table sm_incidents add column if not exists mi_declared_by uuid;
    alter table sm_incidents add column if not exists mi_reason text;
    alter table sm_incidents add column if not exists bridge_url text;
    alter table sm_incidents add column if not exists chat_url text;
    alter table sm_incidents add column if not exists comm_cadence integer;
    alter table sm_incidents add column if not exists last_update_at timestamptz;
    alter table sm_incidents add column if not exists next_update_at timestamptz;
    alter table sm_incidents add column if not exists update_warned_at timestamptz;
    alter table sm_incidents add column if not exists stakeholders jsonb;
    alter table sm_incidents add column if not exists business_impact text;
    alter table sm_incidents add column if not exists timeline jsonb;
    alter table sm_incidents add column if not exists satisfaction integer;
    alter table sm_incidents add column if not exists satisfaction_comment text;
    alter table sm_incidents add column if not exists confidential boolean not null default false;
    alter table sm_incidents add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_incidents (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'INC' || no::text else 'INC' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  hold_reason text,
  vip boolean not null default false,
  security_incident boolean not null default false,
  template_id uuid,
  external_ref text,
  affected_services jsonb,
  affected_cis jsonb,
  affected_users jsonb,
  detected_at timestamptz,
  accepted_at timestamptz,
  hold_since timestamptz,
  follow_ups integer,
  last_follow_up_at timestamptz,
  time_to_accept bigint,
  time_to_resolve bigint,
  cause_code text,
  workaround text,
  problem_id uuid,
  known_error_id uuid,
  merged_into uuid,
  follow_up_of uuid,
  major_state text,
  mi_manager_id uuid,
  mi_comms_id uuid,
  mi_declared_at timestamptz,
  mi_declared_by uuid,
  mi_reason text,
  bridge_url text,
  chat_url text,
  comm_cadence integer,
  last_update_at timestamptz,
  next_update_at timestamptz,
  update_warned_at timestamptz,
  stakeholders jsonb,
  business_impact text,
  timeline jsonb,
  satisfaction integer,
  satisfaction_comment text,
  confidential boolean not null default false,
  access_list jsonb,
  search_2a22db8c text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(external_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incidents' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_2a22db8c' loop
    execute format('alter table %I drop column if exists %I', 'sm_incidents', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_incidents', 'search_2a22db8c', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(external_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_incidents' and indexname like 'sm\_incidents\_search\_%' and indexname not in ('sm_incidents_search_2a22db8c_trgm', 'sm_incidents_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_incidents_search_2a22db8c_trgm', 'sm_incidents', 'search_2a22db8c', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_incidents_search_custom_trgm', 'sm_incidents', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_incidents_no_uk on sm_incidents (org_id, no);
create index if not exists sm_incidents_rev_idx on sm_incidents (org_id, rev);
create index if not exists sm_incidents_upd_idx on sm_incidents (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incidents_crt_idx on sm_incidents (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_incidents_state_idx on sm_incidents (org_id, state) where deleted_at is null;
create index if not exists sm_incidents_assignment_group_id_idx on sm_incidents (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_incidents_assigned_to_idx on sm_incidents (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_incidents_parent_id_idx on sm_incidents (org_id, parent_id) where deleted_at is null;
create index if not exists sm_incidents_external_ref_idx on sm_incidents (org_id, external_ref) where deleted_at is null;
create index if not exists sm_incidents_problem_id_idx on sm_incidents (org_id, problem_id) where deleted_at is null;
create index if not exists sm_incidents_known_error_id_idx on sm_incidents (org_id, known_error_id) where deleted_at is null;
create index if not exists sm_incidents_major_state_idx on sm_incidents (org_id, major_state) where deleted_at is null;
create index if not exists sm_incidents_workspace_acc_idx on sm_incidents (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incidents_unit_acc_idx on sm_incidents (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incidents_domain_acc_idx on sm_incidents (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_incidents_caller_id_idx on sm_incidents (org_id, caller_id) where deleted_at is null;
create index if not exists sm_incidents_requested_for_idx on sm_incidents (org_id, requested_for) where deleted_at is null;
create index if not exists sm_incidents_opened_by_idx on sm_incidents (org_id, opened_by) where deleted_at is null;
create index if not exists sm_incidents_affected_users_gin on sm_incidents using gin (affected_users);
create index if not exists sm_incidents_watch_list_gin on sm_incidents using gin (watch_list);
create index if not exists sm_incidents_open_grp_idx on sm_incidents (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_incidents_opened_brin on sm_incidents using brin (opened_at);
drop trigger if exists sm_incidents_sync on sm_incidents;
create trigger sm_incidents_sync before insert or update on sm_incidents for each row execute function sm_sync_touch('incident');
create or replace trigger sm_incidents_demo after insert on sm_incidents for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incidents_demo_t after update or delete on sm_incidents for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incidents enable row level security;

-- incident_config: تنظیمات رخداد
do $cols$
begin
  if to_regclass('sm_incident_configs') is not null then
    alter table sm_incident_configs add column if not exists workspace_id uuid;
    alter table sm_incident_configs add column if not exists domain_id uuid;
    alter table sm_incident_configs add column if not exists unit_id uuid;
    alter table sm_incident_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_incident_configs add column if not exists created_by uuid;
    alter table sm_incident_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_incident_configs add column if not exists updated_by uuid;
    alter table sm_incident_configs add column if not exists rev bigint not null default 0;
    alter table sm_incident_configs add column if not exists version integer not null default 1;
    alter table sm_incident_configs add column if not exists deleted_at timestamptz;
    alter table sm_incident_configs add column if not exists origin text;
    alter table sm_incident_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incident_configs add column if not exists name text;
    alter table sm_incident_configs add column if not exists config_key text;
    alter table sm_incident_configs add column if not exists auto_close_days integer;
    alter table sm_incident_configs add column if not exists reopen_window_days integer;
    alter table sm_incident_configs add column if not exists follow_up_days integer;
    alter table sm_incident_configs add column if not exists follow_up_max integer;
    alter table sm_incident_configs add column if not exists reassignment_alert integer;
    alter table sm_incident_configs add column if not exists cascade_children boolean not null default true;
    alter table sm_incident_configs add column if not exists propagate_comments boolean not null default true;
    alter table sm_incident_configs add column if not exists security_group_id uuid;
    alter table sm_incident_configs add column if not exists period_review_days integer;
    alter table sm_incident_configs add column if not exists mi_candidate_priorities jsonb;
    alter table sm_incident_configs add column if not exists mi_candidate_affected integer;
    alter table sm_incident_configs add column if not exists mi_default_cadence integer;
    alter table sm_incident_configs add column if not exists mi_auto_problem boolean not null default true;
    alter table sm_incident_configs add column if not exists mi_auto_review boolean not null default true;
    alter table sm_incident_configs add column if not exists review_due_days integer;
    alter table sm_incident_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_incident_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  auto_close_days integer,
  reopen_window_days integer,
  follow_up_days integer,
  follow_up_max integer,
  reassignment_alert integer,
  cascade_children boolean not null default true,
  propagate_comments boolean not null default true,
  security_group_id uuid,
  period_review_days integer,
  mi_candidate_priorities jsonb,
  mi_candidate_affected integer,
  mi_default_cadence integer,
  mi_auto_problem boolean not null default true,
  mi_auto_review boolean not null default true,
  review_due_days integer,
  seeded integer
);
create index if not exists sm_incident_configs_rev_idx on sm_incident_configs (org_id, rev);
create index if not exists sm_incident_configs_upd_idx on sm_incident_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_configs_crt_idx on sm_incident_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_incident_configs_config_key_uk on sm_incident_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_incident_configs_sync on sm_incident_configs;
create trigger sm_incident_configs_sync before insert or update on sm_incident_configs for each row execute function sm_sync_touch('incident_config');
create or replace trigger sm_incident_configs_demo after insert on sm_incident_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incident_configs_demo_t after update or delete on sm_incident_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incident_configs enable row level security;

-- incident_period_review: بازبینی‌های دوره‌ای رخدادها
do $cols$
begin
  if to_regclass('sm_incident_period_reviews') is not null then
    alter table sm_incident_period_reviews add column if not exists workspace_id uuid;
    alter table sm_incident_period_reviews add column if not exists domain_id uuid;
    alter table sm_incident_period_reviews add column if not exists unit_id uuid;
    alter table sm_incident_period_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_incident_period_reviews add column if not exists created_by uuid;
    alter table sm_incident_period_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_incident_period_reviews add column if not exists updated_by uuid;
    alter table sm_incident_period_reviews add column if not exists rev bigint not null default 0;
    alter table sm_incident_period_reviews add column if not exists version integer not null default 1;
    alter table sm_incident_period_reviews add column if not exists deleted_at timestamptz;
    alter table sm_incident_period_reviews add column if not exists origin text;
    alter table sm_incident_period_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incident_period_reviews add column if not exists no integer;
    alter table sm_incident_period_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'IPR' || no::text else 'IPR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_incident_period_reviews add column if not exists title text;
    alter table sm_incident_period_reviews add column if not exists period_from date;
    alter table sm_incident_period_reviews add column if not exists period_to date;
    alter table sm_incident_period_reviews add column if not exists review_trigger text;
    alter table sm_incident_period_reviews add column if not exists owner_id uuid;
    alter table sm_incident_period_reviews add column if not exists participants jsonb;
    alter table sm_incident_period_reviews add column if not exists assignment_group_id uuid;
    alter table sm_incident_period_reviews add column if not exists computed_at timestamptz;
    alter table sm_incident_period_reviews add column if not exists sample_ids jsonb;
    alter table sm_incident_period_reviews add column if not exists stats jsonb;
    alter table sm_incident_period_reviews add column if not exists report text;
    alter table sm_incident_period_reviews add column if not exists findings text;
    alter table sm_incident_period_reviews add column if not exists model_updates text;
    alter table sm_incident_period_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_incident_period_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'IPR' || no::text else 'IPR' || lpad(no::text, 5, '0') end) stored,
  title text,
  period_from date,
  period_to date,
  review_trigger text,
  owner_id uuid,
  participants jsonb,
  assignment_group_id uuid,
  computed_at timestamptz,
  sample_ids jsonb,
  stats jsonb,
  report text,
  findings text,
  model_updates text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incident_period_reviews' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_incident_period_reviews', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_incident_period_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_incident_period_reviews' and indexname like 'sm\_incident\_period\_reviews\_search\_%' and indexname not in ('sm_incident_period_reviews_search_cae18f1d_trgm', 'sm_incident_period_reviews_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_incident_period_reviews_search_cae18f1d_trgm', 'sm_incident_period_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_incident_period_reviews_search_custom_trgm', 'sm_incident_period_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_incident_period_reviews_no_uk on sm_incident_period_reviews (org_id, no);
create index if not exists sm_incident_period_reviews_rev_idx on sm_incident_period_reviews (org_id, rev);
create index if not exists sm_incident_period_reviews_upd_idx on sm_incident_period_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_period_reviews_crt_idx on sm_incident_period_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_period_reviews_owner_id_idx on sm_incident_period_reviews (org_id, owner_id) where deleted_at is null;
create index if not exists sm_incident_period_reviews_assignment_group_id_idx on sm_incident_period_reviews (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_incident_period_reviews_state_idx on sm_incident_period_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_incident_period_reviews_workspace_acc_idx on sm_incident_period_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_period_reviews_unit_acc_idx on sm_incident_period_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_period_reviews_domain_acc_idx on sm_incident_period_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_incident_period_reviews_participants_gin on sm_incident_period_reviews using gin (participants);
drop trigger if exists sm_incident_period_reviews_sync on sm_incident_period_reviews;
create trigger sm_incident_period_reviews_sync before insert or update on sm_incident_period_reviews for each row execute function sm_sync_touch('incident_period_review');
create or replace trigger sm_incident_period_reviews_demo after insert on sm_incident_period_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incident_period_reviews_demo_t after update or delete on sm_incident_period_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incident_period_reviews enable row level security;

-- incident_response: پاسخ‌های آماده
do $cols$
begin
  if to_regclass('sm_incident_responses') is not null then
    alter table sm_incident_responses add column if not exists workspace_id uuid;
    alter table sm_incident_responses add column if not exists domain_id uuid;
    alter table sm_incident_responses add column if not exists unit_id uuid;
    alter table sm_incident_responses add column if not exists created_at timestamptz not null default now();
    alter table sm_incident_responses add column if not exists created_by uuid;
    alter table sm_incident_responses add column if not exists updated_at timestamptz not null default now();
    alter table sm_incident_responses add column if not exists updated_by uuid;
    alter table sm_incident_responses add column if not exists rev bigint not null default 0;
    alter table sm_incident_responses add column if not exists version integer not null default 1;
    alter table sm_incident_responses add column if not exists deleted_at timestamptz;
    alter table sm_incident_responses add column if not exists origin text;
    alter table sm_incident_responses add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incident_responses add column if not exists name text;
    alter table sm_incident_responses add column if not exists kind text;
    alter table sm_incident_responses add column if not exists active boolean not null default true;
    alter table sm_incident_responses add column if not exists category text;
    alter table sm_incident_responses add column if not exists group_id uuid;
    alter table sm_incident_responses add column if not exists sort_order integer;
    alter table sm_incident_responses add column if not exists body text;
  end if;
end
$cols$;
create table if not exists sm_incident_responses (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  active boolean not null default true,
  category text,
  group_id uuid,
  sort_order integer,
  body text
);
create index if not exists sm_incident_responses_rev_idx on sm_incident_responses (org_id, rev);
create index if not exists sm_incident_responses_upd_idx on sm_incident_responses (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_responses_crt_idx on sm_incident_responses (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_incident_responses_name_uk on sm_incident_responses (org_id, name) where deleted_at is null;
create index if not exists sm_incident_responses_workspace_acc_idx on sm_incident_responses (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_responses_unit_acc_idx on sm_incident_responses (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_responses_domain_acc_idx on sm_incident_responses (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_incident_responses_open_grp_idx on sm_incident_responses (org_id, group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_incident_responses_sync on sm_incident_responses;
create trigger sm_incident_responses_sync before insert or update on sm_incident_responses for each row execute function sm_sync_touch('incident_response');
create or replace trigger sm_incident_responses_demo after insert on sm_incident_responses for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incident_responses_demo_t after update or delete on sm_incident_responses for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incident_responses enable row level security;

-- incident_review: بازبینی‌های پس از رخداد
do $cols$
begin
  if to_regclass('sm_incident_reviews') is not null then
    alter table sm_incident_reviews add column if not exists workspace_id uuid;
    alter table sm_incident_reviews add column if not exists domain_id uuid;
    alter table sm_incident_reviews add column if not exists unit_id uuid;
    alter table sm_incident_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_incident_reviews add column if not exists created_by uuid;
    alter table sm_incident_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_incident_reviews add column if not exists updated_by uuid;
    alter table sm_incident_reviews add column if not exists rev bigint not null default 0;
    alter table sm_incident_reviews add column if not exists version integer not null default 1;
    alter table sm_incident_reviews add column if not exists deleted_at timestamptz;
    alter table sm_incident_reviews add column if not exists origin text;
    alter table sm_incident_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incident_reviews add column if not exists no integer;
    alter table sm_incident_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PIR' || no::text else 'PIR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_incident_reviews add column if not exists title text;
    alter table sm_incident_reviews add column if not exists incident_id uuid;
    alter table sm_incident_reviews add column if not exists review_trigger text;
    alter table sm_incident_reviews add column if not exists owner_id uuid;
    alter table sm_incident_reviews add column if not exists authors jsonb;
    alter table sm_incident_reviews add column if not exists assignment_group_id uuid;
    alter table sm_incident_reviews add column if not exists due_at timestamptz;
    alter table sm_incident_reviews add column if not exists published_at timestamptz;
    alter table sm_incident_reviews add column if not exists published_by uuid;
    alter table sm_incident_reviews add column if not exists summary text;
    alter table sm_incident_reviews add column if not exists impact text;
    alter table sm_incident_reviews add column if not exists timeline_md text;
    alter table sm_incident_reviews add column if not exists root_cause text;
    alter table sm_incident_reviews add column if not exists detection text;
    alter table sm_incident_reviews add column if not exists resolution text;
    alter table sm_incident_reviews add column if not exists went_well text;
    alter table sm_incident_reviews add column if not exists went_wrong text;
    alter table sm_incident_reviews add column if not exists lucky text;
    alter table sm_incident_reviews add column if not exists lessons text;
    alter table sm_incident_reviews add column if not exists watch_list jsonb;
    alter table sm_incident_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_incident_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PIR' || no::text else 'PIR' || lpad(no::text, 5, '0') end) stored,
  title text,
  incident_id uuid,
  review_trigger text,
  owner_id uuid,
  authors jsonb,
  assignment_group_id uuid,
  due_at timestamptz,
  published_at timestamptz,
  published_by uuid,
  summary text,
  impact text,
  timeline_md text,
  root_cause text,
  detection text,
  resolution text,
  went_well text,
  went_wrong text,
  lucky text,
  lessons text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incident_reviews' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_incident_reviews', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_incident_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_incident_reviews' and indexname like 'sm\_incident\_reviews\_search\_%' and indexname not in ('sm_incident_reviews_search_cae18f1d_trgm', 'sm_incident_reviews_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_incident_reviews_search_cae18f1d_trgm', 'sm_incident_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_incident_reviews_search_custom_trgm', 'sm_incident_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_incident_reviews_no_uk on sm_incident_reviews (org_id, no);
create index if not exists sm_incident_reviews_rev_idx on sm_incident_reviews (org_id, rev);
create index if not exists sm_incident_reviews_upd_idx on sm_incident_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_reviews_crt_idx on sm_incident_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_reviews_incident_id_idx on sm_incident_reviews (org_id, incident_id) where deleted_at is null;
create index if not exists sm_incident_reviews_owner_id_idx on sm_incident_reviews (org_id, owner_id) where deleted_at is null;
create index if not exists sm_incident_reviews_assignment_group_id_idx on sm_incident_reviews (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_incident_reviews_state_idx on sm_incident_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_incident_reviews_workspace_acc_idx on sm_incident_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_reviews_unit_acc_idx on sm_incident_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_reviews_domain_acc_idx on sm_incident_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_incident_reviews_authors_gin on sm_incident_reviews using gin (authors);
create index if not exists sm_incident_reviews_watch_list_gin on sm_incident_reviews using gin (watch_list);
drop trigger if exists sm_incident_reviews_sync on sm_incident_reviews;
create trigger sm_incident_reviews_sync before insert or update on sm_incident_reviews for each row execute function sm_sync_touch('incident_review');
create or replace trigger sm_incident_reviews_demo after insert on sm_incident_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incident_reviews_demo_t after update or delete on sm_incident_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incident_reviews enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:13', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۵ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 15/30 (a0c3bc7de847)
-- incident_task: کارهای رخداد
do $cols$
begin
  if to_regclass('sm_incident_tasks') is not null then
    alter table sm_incident_tasks add column if not exists workspace_id uuid;
    alter table sm_incident_tasks add column if not exists domain_id uuid;
    alter table sm_incident_tasks add column if not exists unit_id uuid;
    alter table sm_incident_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_incident_tasks add column if not exists created_by uuid;
    alter table sm_incident_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_incident_tasks add column if not exists updated_by uuid;
    alter table sm_incident_tasks add column if not exists rev bigint not null default 0;
    alter table sm_incident_tasks add column if not exists version integer not null default 1;
    alter table sm_incident_tasks add column if not exists deleted_at timestamptz;
    alter table sm_incident_tasks add column if not exists origin text;
    alter table sm_incident_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incident_tasks add column if not exists no integer;
    alter table sm_incident_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'ITASK' || no::text else 'ITASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_incident_tasks add column if not exists short_description text;
    alter table sm_incident_tasks add column if not exists description text;
    alter table sm_incident_tasks add column if not exists state text;
    alter table sm_incident_tasks add column if not exists priority text;
    alter table sm_incident_tasks add column if not exists impact text;
    alter table sm_incident_tasks add column if not exists urgency text;
    alter table sm_incident_tasks add column if not exists category text;
    alter table sm_incident_tasks add column if not exists subcategory text;
    alter table sm_incident_tasks add column if not exists channel text;
    alter table sm_incident_tasks add column if not exists caller_id uuid;
    alter table sm_incident_tasks add column if not exists requested_for uuid;
    alter table sm_incident_tasks add column if not exists opened_by uuid;
    alter table sm_incident_tasks add column if not exists opened_at timestamptz;
    alter table sm_incident_tasks add column if not exists assignment_group_id uuid;
    alter table sm_incident_tasks add column if not exists assigned_to uuid;
    alter table sm_incident_tasks add column if not exists service_id uuid;
    alter table sm_incident_tasks add column if not exists offering_id uuid;
    alter table sm_incident_tasks add column if not exists ci_id uuid;
    alter table sm_incident_tasks add column if not exists location_id uuid;
    alter table sm_incident_tasks add column if not exists due_at timestamptz;
    alter table sm_incident_tasks add column if not exists resolved_at timestamptz;
    alter table sm_incident_tasks add column if not exists resolved_by uuid;
    alter table sm_incident_tasks add column if not exists closed_at timestamptz;
    alter table sm_incident_tasks add column if not exists closed_by uuid;
    alter table sm_incident_tasks add column if not exists close_code text;
    alter table sm_incident_tasks add column if not exists close_notes text;
    alter table sm_incident_tasks add column if not exists parent_id uuid;
    alter table sm_incident_tasks add column if not exists watch_list jsonb;
    alter table sm_incident_tasks add column if not exists approval text;
    alter table sm_incident_tasks add column if not exists escalation integer;
    alter table sm_incident_tasks add column if not exists reassignment_count integer;
    alter table sm_incident_tasks add column if not exists reopen_count integer;
    alter table sm_incident_tasks add column if not exists time_worked bigint;
    alter table sm_incident_tasks add column if not exists first_response_at timestamptz;
    alter table sm_incident_tasks add column if not exists active boolean not null default true;
    alter table sm_incident_tasks add column if not exists sla_due timestamptz;
    alter table sm_incident_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_incident_tasks add column if not exists incident_id uuid;
    alter table sm_incident_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_incident_tasks add column if not exists sort_order integer;
  end if;
end
$cols$;
create table if not exists sm_incident_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'ITASK' || no::text else 'ITASK' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  incident_id uuid,
  mandatory boolean not null default true,
  sort_order integer,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incident_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_incident_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_incident_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_incident_tasks' and indexname like 'sm\_incident\_tasks\_search\_%' and indexname not in ('sm_incident_tasks_search_f3bce210_trgm', 'sm_incident_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_incident_tasks_search_f3bce210_trgm', 'sm_incident_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_incident_tasks_search_custom_trgm', 'sm_incident_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_incident_tasks_no_uk on sm_incident_tasks (org_id, no);
create index if not exists sm_incident_tasks_rev_idx on sm_incident_tasks (org_id, rev);
create index if not exists sm_incident_tasks_upd_idx on sm_incident_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_tasks_crt_idx on sm_incident_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_tasks_state_idx on sm_incident_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_incident_tasks_assignment_group_id_idx on sm_incident_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_incident_tasks_assigned_to_idx on sm_incident_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_incident_tasks_incident_id_idx on sm_incident_tasks (org_id, incident_id) where deleted_at is null;
create index if not exists sm_incident_tasks_workspace_acc_idx on sm_incident_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_tasks_unit_acc_idx on sm_incident_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_tasks_domain_acc_idx on sm_incident_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_incident_tasks_caller_id_idx on sm_incident_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_incident_tasks_requested_for_idx on sm_incident_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_incident_tasks_opened_by_idx on sm_incident_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_incident_tasks_watch_list_gin on sm_incident_tasks using gin (watch_list);
create index if not exists sm_incident_tasks_open_grp_idx on sm_incident_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_incident_tasks_opened_brin on sm_incident_tasks using brin (opened_at);
drop trigger if exists sm_incident_tasks_sync on sm_incident_tasks;
create trigger sm_incident_tasks_sync before insert or update on sm_incident_tasks for each row execute function sm_sync_touch('incident_task');
create or replace trigger sm_incident_tasks_demo after insert on sm_incident_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incident_tasks_demo_t after update or delete on sm_incident_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incident_tasks enable row level security;

-- incident_template: الگوهای رخداد
do $cols$
begin
  if to_regclass('sm_incident_templates') is not null then
    alter table sm_incident_templates add column if not exists workspace_id uuid;
    alter table sm_incident_templates add column if not exists domain_id uuid;
    alter table sm_incident_templates add column if not exists unit_id uuid;
    alter table sm_incident_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_incident_templates add column if not exists created_by uuid;
    alter table sm_incident_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_incident_templates add column if not exists updated_by uuid;
    alter table sm_incident_templates add column if not exists rev bigint not null default 0;
    alter table sm_incident_templates add column if not exists version integer not null default 1;
    alter table sm_incident_templates add column if not exists deleted_at timestamptz;
    alter table sm_incident_templates add column if not exists origin text;
    alter table sm_incident_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_incident_templates add column if not exists name text;
    alter table sm_incident_templates add column if not exists active boolean not null default true;
    alter table sm_incident_templates add column if not exists sort_order integer;
    alter table sm_incident_templates add column if not exists short_description text;
    alter table sm_incident_templates add column if not exists description text;
    alter table sm_incident_templates add column if not exists category text;
    alter table sm_incident_templates add column if not exists subcategory text;
    alter table sm_incident_templates add column if not exists channel text;
    alter table sm_incident_templates add column if not exists impact text;
    alter table sm_incident_templates add column if not exists urgency text;
    alter table sm_incident_templates add column if not exists assignment_group_id uuid;
    alter table sm_incident_templates add column if not exists service_id uuid;
    alter table sm_incident_templates add column if not exists ci_id uuid;
    alter table sm_incident_templates add column if not exists tasks jsonb;
    alter table sm_incident_templates add column if not exists groups jsonb;
    alter table sm_incident_templates add column if not exists description_note text;
  end if;
end
$cols$;
create table if not exists sm_incident_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  sort_order integer,
  short_description text,
  description text,
  category text,
  subcategory text,
  channel text,
  impact text,
  urgency text,
  assignment_group_id uuid,
  service_id uuid,
  ci_id uuid,
  tasks jsonb,
  groups jsonb,
  description_note text
);
create index if not exists sm_incident_templates_rev_idx on sm_incident_templates (org_id, rev);
create index if not exists sm_incident_templates_upd_idx on sm_incident_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_templates_crt_idx on sm_incident_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_incident_templates_name_uk on sm_incident_templates (org_id, name) where deleted_at is null;
create index if not exists sm_incident_templates_workspace_acc_idx on sm_incident_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_templates_unit_acc_idx on sm_incident_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_templates_domain_acc_idx on sm_incident_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_incident_templates_open_grp_idx on sm_incident_templates (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_incident_templates_sync on sm_incident_templates;
create trigger sm_incident_templates_sync before insert or update on sm_incident_templates for each row execute function sm_sync_touch('incident_template');
create or replace trigger sm_incident_templates_demo after insert on sm_incident_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_incident_templates_demo_t after update or delete on sm_incident_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_incident_templates enable row level security;

-- install_base_item: پایگاه نصب
do $cols$
begin
  if to_regclass('sm_install_base_items') is not null then
    alter table sm_install_base_items add column if not exists workspace_id uuid;
    alter table sm_install_base_items add column if not exists domain_id uuid;
    alter table sm_install_base_items add column if not exists unit_id uuid;
    alter table sm_install_base_items add column if not exists created_at timestamptz not null default now();
    alter table sm_install_base_items add column if not exists created_by uuid;
    alter table sm_install_base_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_install_base_items add column if not exists updated_by uuid;
    alter table sm_install_base_items add column if not exists rev bigint not null default 0;
    alter table sm_install_base_items add column if not exists version integer not null default 1;
    alter table sm_install_base_items add column if not exists deleted_at timestamptz;
    alter table sm_install_base_items add column if not exists origin text;
    alter table sm_install_base_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_install_base_items add column if not exists no integer;
    alter table sm_install_base_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'IBI' || no::text else 'IBI' || lpad(no::text, 7, '0') end) stored;
    alter table sm_install_base_items add column if not exists name text;
    alter table sm_install_base_items add column if not exists account_id uuid;
    alter table sm_install_base_items add column if not exists product_id uuid;
    alter table sm_install_base_items add column if not exists serial_no text;
    alter table sm_install_base_items add column if not exists quantity integer;
    alter table sm_install_base_items add column if not exists status text;
    alter table sm_install_base_items add column if not exists parent_id uuid;
    alter table sm_install_base_items add column if not exists ci_id uuid;
    alter table sm_install_base_items add column if not exists asset_ref text;
    alter table sm_install_base_items add column if not exists location_id uuid;
    alter table sm_install_base_items add column if not exists contact_id uuid;
    alter table sm_install_base_items add column if not exists installed_on date;
    alter table sm_install_base_items add column if not exists warranty_end date;
    alter table sm_install_base_items add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_install_base_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'IBI' || no::text else 'IBI' || lpad(no::text, 7, '0') end) stored,
  name text,
  account_id uuid,
  product_id uuid,
  serial_no text,
  quantity integer,
  status text,
  parent_id uuid,
  ci_id uuid,
  asset_ref text,
  location_id uuid,
  contact_id uuid,
  installed_on date,
  warranty_end date,
  support_group_id uuid,
  search_da0ea237 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(serial_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_install_base_items' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_da0ea237' loop
    execute format('alter table %I drop column if exists %I', 'sm_install_base_items', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_install_base_items', 'search_da0ea237', $x$translate(coalesce(name, '') || ' ' || coalesce(serial_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_install_base_items' and indexname like 'sm\_install\_base\_items\_search\_%' and indexname not in ('sm_install_base_items_search_da0ea237_trgm', 'sm_install_base_items_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_install_base_items_search_da0ea237_trgm', 'sm_install_base_items', 'search_da0ea237', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_install_base_items_search_custom_trgm', 'sm_install_base_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_install_base_items_no_uk on sm_install_base_items (org_id, no);
create index if not exists sm_install_base_items_rev_idx on sm_install_base_items (org_id, rev);
create index if not exists sm_install_base_items_upd_idx on sm_install_base_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_install_base_items_crt_idx on sm_install_base_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_install_base_items_account_id_idx on sm_install_base_items (org_id, account_id) where deleted_at is null;
create index if not exists sm_install_base_items_product_id_idx on sm_install_base_items (org_id, product_id) where deleted_at is null;
create index if not exists sm_install_base_items_ci_id_idx on sm_install_base_items (org_id, ci_id) where deleted_at is null;
create index if not exists sm_install_base_items_support_group_id_idx on sm_install_base_items (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_install_base_items_workspace_acc_idx on sm_install_base_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_install_base_items_unit_acc_idx on sm_install_base_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_install_base_items_domain_acc_idx on sm_install_base_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_install_base_items_sync on sm_install_base_items;
create trigger sm_install_base_items_sync before insert or update on sm_install_base_items for each row execute function sm_sync_touch('install_base_item');
create or replace trigger sm_install_base_items_demo after insert on sm_install_base_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_install_base_items_demo_t after update or delete on sm_install_base_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_install_base_items enable row level security;

-- integration_user: کاربران یکپارچه‌سازی
do $cols$
begin
  if to_regclass('sm_integration_users') is not null then
    alter table sm_integration_users add column if not exists workspace_id uuid;
    alter table sm_integration_users add column if not exists domain_id uuid;
    alter table sm_integration_users add column if not exists unit_id uuid;
    alter table sm_integration_users add column if not exists created_at timestamptz not null default now();
    alter table sm_integration_users add column if not exists created_by uuid;
    alter table sm_integration_users add column if not exists updated_at timestamptz not null default now();
    alter table sm_integration_users add column if not exists updated_by uuid;
    alter table sm_integration_users add column if not exists rev bigint not null default 0;
    alter table sm_integration_users add column if not exists version integer not null default 1;
    alter table sm_integration_users add column if not exists deleted_at timestamptz;
    alter table sm_integration_users add column if not exists origin text;
    alter table sm_integration_users add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_integration_users add column if not exists name text;
    alter table sm_integration_users add column if not exists active boolean not null default true;
    alter table sm_integration_users add column if not exists rate_limit integer;
    alter table sm_integration_users add column if not exists owner_id uuid;
    alter table sm_integration_users add column if not exists ip_allowlist text;
    alter table sm_integration_users add column if not exists description text;
    alter table sm_integration_users add column if not exists user_id uuid;
    alter table sm_integration_users add column if not exists last_used_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_integration_users (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  rate_limit integer,
  owner_id uuid,
  ip_allowlist text,
  description text,
  user_id uuid,
  last_used_at timestamptz
);
create index if not exists sm_integration_users_rev_idx on sm_integration_users (org_id, rev);
create index if not exists sm_integration_users_upd_idx on sm_integration_users (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_integration_users_crt_idx on sm_integration_users (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_integration_users_workspace_acc_idx on sm_integration_users (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_integration_users_unit_acc_idx on sm_integration_users (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_integration_users_domain_acc_idx on sm_integration_users (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_integration_users_owner_id_idx on sm_integration_users (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_integration_users_sync on sm_integration_users;
create trigger sm_integration_users_sync before insert or update on sm_integration_users for each row execute function sm_sync_touch('integration_user');
create or replace trigger sm_integration_users_demo after insert on sm_integration_users for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_integration_users_demo_t after update or delete on sm_integration_users for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_integration_users enable row level security;

-- interaction: تعامل‌ها
do $cols$
begin
  if to_regclass('sm_interactions') is not null then
    alter table sm_interactions add column if not exists workspace_id uuid;
    alter table sm_interactions add column if not exists domain_id uuid;
    alter table sm_interactions add column if not exists unit_id uuid;
    alter table sm_interactions add column if not exists created_at timestamptz not null default now();
    alter table sm_interactions add column if not exists created_by uuid;
    alter table sm_interactions add column if not exists updated_at timestamptz not null default now();
    alter table sm_interactions add column if not exists updated_by uuid;
    alter table sm_interactions add column if not exists rev bigint not null default 0;
    alter table sm_interactions add column if not exists version integer not null default 1;
    alter table sm_interactions add column if not exists deleted_at timestamptz;
    alter table sm_interactions add column if not exists origin text;
    alter table sm_interactions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_interactions add column if not exists no integer;
    alter table sm_interactions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'INT' || no::text else 'INT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_interactions add column if not exists short_description text;
    alter table sm_interactions add column if not exists channel text;
    alter table sm_interactions add column if not exists caller_id uuid;
    alter table sm_interactions add column if not exists agent_id uuid;
    alter table sm_interactions add column if not exists assignment_group_id uuid;
    alter table sm_interactions add column if not exists started_at timestamptz;
    alter table sm_interactions add column if not exists ended_at timestamptz;
    alter table sm_interactions add column if not exists duration bigint;
    alter table sm_interactions add column if not exists transcript text;
    alter table sm_interactions add column if not exists wrap_up text;
    alter table sm_interactions add column if not exists incident_id uuid;
    alter table sm_interactions add column if not exists wrap_up_notes text;
    alter table sm_interactions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_interactions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'INT' || no::text else 'INT' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  channel text,
  caller_id uuid,
  agent_id uuid,
  assignment_group_id uuid,
  started_at timestamptz,
  ended_at timestamptz,
  duration bigint,
  transcript text,
  wrap_up text,
  incident_id uuid,
  wrap_up_notes text,
  state text,
  search_2b0ba683 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(transcript, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_interactions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_2b0ba683' loop
    execute format('alter table %I drop column if exists %I', 'sm_interactions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_interactions', 'search_2b0ba683', $x$translate(coalesce(short_description, '') || ' ' || coalesce(transcript, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_interactions' and indexname like 'sm\_interactions\_search\_%' and indexname not in ('sm_interactions_search_2b0ba683_trgm', 'sm_interactions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_interactions_search_2b0ba683_trgm', 'sm_interactions', 'search_2b0ba683', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_interactions_search_custom_trgm', 'sm_interactions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_interactions_no_uk on sm_interactions (org_id, no);
create index if not exists sm_interactions_rev_idx on sm_interactions (org_id, rev);
create index if not exists sm_interactions_upd_idx on sm_interactions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_interactions_crt_idx on sm_interactions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_interactions_caller_id_idx on sm_interactions (org_id, caller_id) where deleted_at is null;
create index if not exists sm_interactions_agent_id_idx on sm_interactions (org_id, agent_id) where deleted_at is null;
create index if not exists sm_interactions_assignment_group_id_idx on sm_interactions (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_interactions_incident_id_idx on sm_interactions (org_id, incident_id) where deleted_at is null;
create index if not exists sm_interactions_state_idx on sm_interactions (org_id, state) where deleted_at is null;
create index if not exists sm_interactions_workspace_acc_idx on sm_interactions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_interactions_unit_acc_idx on sm_interactions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_interactions_domain_acc_idx on sm_interactions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_interactions_sync on sm_interactions;
create trigger sm_interactions_sync before insert or update on sm_interactions for each row execute function sm_sync_touch('interaction');
create or replace trigger sm_interactions_demo after insert on sm_interactions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_interactions_demo_t after update or delete on sm_interactions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_interactions enable row level security;

-- inventory_audit: شمارش‌های دارایی
do $cols$
begin
  if to_regclass('sm_inventory_audits') is not null then
    alter table sm_inventory_audits add column if not exists workspace_id uuid;
    alter table sm_inventory_audits add column if not exists domain_id uuid;
    alter table sm_inventory_audits add column if not exists unit_id uuid;
    alter table sm_inventory_audits add column if not exists created_at timestamptz not null default now();
    alter table sm_inventory_audits add column if not exists created_by uuid;
    alter table sm_inventory_audits add column if not exists updated_at timestamptz not null default now();
    alter table sm_inventory_audits add column if not exists updated_by uuid;
    alter table sm_inventory_audits add column if not exists rev bigint not null default 0;
    alter table sm_inventory_audits add column if not exists version integer not null default 1;
    alter table sm_inventory_audits add column if not exists deleted_at timestamptz;
    alter table sm_inventory_audits add column if not exists origin text;
    alter table sm_inventory_audits add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_inventory_audits add column if not exists no integer;
    alter table sm_inventory_audits add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AUD' || no::text else 'AUD' || lpad(no::text, 5, '0') end) stored;
    alter table sm_inventory_audits add column if not exists name text;
    alter table sm_inventory_audits add column if not exists scope_kind text;
    alter table sm_inventory_audits add column if not exists branch_id uuid;
    alter table sm_inventory_audits add column if not exists stockroom_id uuid;
    alter table sm_inventory_audits add column if not exists location_id uuid;
    alter table sm_inventory_audits add column if not exists owner_id uuid;
    alter table sm_inventory_audits add column if not exists group_id uuid;
    alter table sm_inventory_audits add column if not exists planned_date date;
    alter table sm_inventory_audits add column if not exists mark_missing boolean not null default false;
    alter table sm_inventory_audits add column if not exists expected_count integer;
    alter table sm_inventory_audits add column if not exists found_count integer;
    alter table sm_inventory_audits add column if not exists missing_count integer;
    alter table sm_inventory_audits add column if not exists unexpected_count integer;
    alter table sm_inventory_audits add column if not exists discrepancy_open integer;
    alter table sm_inventory_audits add column if not exists started_at timestamptz;
    alter table sm_inventory_audits add column if not exists completed_at timestamptz;
    alter table sm_inventory_audits add column if not exists notes text;
    alter table sm_inventory_audits add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_inventory_audits (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AUD' || no::text else 'AUD' || lpad(no::text, 5, '0') end) stored,
  name text,
  scope_kind text,
  branch_id uuid,
  stockroom_id uuid,
  location_id uuid,
  owner_id uuid,
  group_id uuid,
  planned_date date,
  mark_missing boolean not null default false,
  expected_count integer,
  found_count integer,
  missing_count integer,
  unexpected_count integer,
  discrepancy_open integer,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_inventory_audits' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_inventory_audits', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_inventory_audits', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_inventory_audits' and indexname like 'sm\_inventory\_audits\_search\_%' and indexname not in ('sm_inventory_audits_search_56291d9d_trgm', 'sm_inventory_audits_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_inventory_audits_search_56291d9d_trgm', 'sm_inventory_audits', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_inventory_audits_search_custom_trgm', 'sm_inventory_audits', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_inventory_audits_no_uk on sm_inventory_audits (org_id, no);
create index if not exists sm_inventory_audits_rev_idx on sm_inventory_audits (org_id, rev);
create index if not exists sm_inventory_audits_upd_idx on sm_inventory_audits (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_inventory_audits_crt_idx on sm_inventory_audits (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_inventory_audits_branch_id_idx on sm_inventory_audits (org_id, branch_id) where deleted_at is null;
create index if not exists sm_inventory_audits_state_idx on sm_inventory_audits (org_id, state) where deleted_at is null;
create index if not exists sm_inventory_audits_workspace_acc_idx on sm_inventory_audits (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_inventory_audits_unit_acc_idx on sm_inventory_audits (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_inventory_audits_domain_acc_idx on sm_inventory_audits (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_inventory_audits_owner_id_idx on sm_inventory_audits (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_inventory_audits_sync on sm_inventory_audits;
create trigger sm_inventory_audits_sync before insert or update on sm_inventory_audits for each row execute function sm_sync_touch('inventory_audit');
create or replace trigger sm_inventory_audits_demo after insert on sm_inventory_audits for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_inventory_audits_demo_t after update or delete on sm_inventory_audits for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_inventory_audits enable row level security;

-- inventory_audit_item: اقلام شمارش
do $cols$
begin
  if to_regclass('sm_inventory_audit_items') is not null then
    alter table sm_inventory_audit_items add column if not exists workspace_id uuid;
    alter table sm_inventory_audit_items add column if not exists domain_id uuid;
    alter table sm_inventory_audit_items add column if not exists unit_id uuid;
    alter table sm_inventory_audit_items add column if not exists created_at timestamptz not null default now();
    alter table sm_inventory_audit_items add column if not exists created_by uuid;
    alter table sm_inventory_audit_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_inventory_audit_items add column if not exists updated_by uuid;
    alter table sm_inventory_audit_items add column if not exists rev bigint not null default 0;
    alter table sm_inventory_audit_items add column if not exists version integer not null default 1;
    alter table sm_inventory_audit_items add column if not exists deleted_at timestamptz;
    alter table sm_inventory_audit_items add column if not exists origin text;
    alter table sm_inventory_audit_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_inventory_audit_items add column if not exists audit_id uuid;
    alter table sm_inventory_audit_items add column if not exists asset_id uuid;
    alter table sm_inventory_audit_items add column if not exists expected boolean not null default false;
    alter table sm_inventory_audit_items add column if not exists result text;
    alter table sm_inventory_audit_items add column if not exists scanned_code text;
    alter table sm_inventory_audit_items add column if not exists scanned_at timestamptz;
    alter table sm_inventory_audit_items add column if not exists scanned_by uuid;
    alter table sm_inventory_audit_items add column if not exists note text;
    alter table sm_inventory_audit_items add column if not exists branch_id uuid;
    alter table sm_inventory_audit_items add column if not exists expected_branch_id uuid;
    alter table sm_inventory_audit_items add column if not exists resolution text;
    alter table sm_inventory_audit_items add column if not exists resolved_by uuid;
    alter table sm_inventory_audit_items add column if not exists resolved_at timestamptz;
    alter table sm_inventory_audit_items add column if not exists transfer_id uuid;
    alter table sm_inventory_audit_items add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_inventory_audit_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  audit_id uuid,
  asset_id uuid,
  expected boolean not null default false,
  result text,
  scanned_code text,
  scanned_at timestamptz,
  scanned_by uuid,
  note text,
  branch_id uuid,
  expected_branch_id uuid,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  transfer_id uuid,
  label text
);
create index if not exists sm_inventory_audit_items_rev_idx on sm_inventory_audit_items (org_id, rev);
create index if not exists sm_inventory_audit_items_upd_idx on sm_inventory_audit_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_inventory_audit_items_crt_idx on sm_inventory_audit_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_inventory_audit_items_audit_id_idx on sm_inventory_audit_items (org_id, audit_id) where deleted_at is null;
create index if not exists sm_inventory_audit_items_asset_id_idx on sm_inventory_audit_items (org_id, asset_id) where deleted_at is null;
create index if not exists sm_inventory_audit_items_branch_id_idx on sm_inventory_audit_items (org_id, branch_id) where deleted_at is null;
drop trigger if exists sm_inventory_audit_items_sync on sm_inventory_audit_items;
create trigger sm_inventory_audit_items_sync before insert or update on sm_inventory_audit_items for each row execute function sm_sync_touch('inventory_audit_item');
create or replace trigger sm_inventory_audit_items_demo after insert on sm_inventory_audit_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_inventory_audit_items_demo_t after update or delete on sm_inventory_audit_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_inventory_audit_items enable row level security;

-- issue_connection: اتصال‌های Jira و GitHub
do $cols$
begin
  if to_regclass('sm_issue_connections') is not null then
    alter table sm_issue_connections add column if not exists workspace_id uuid;
    alter table sm_issue_connections add column if not exists domain_id uuid;
    alter table sm_issue_connections add column if not exists unit_id uuid;
    alter table sm_issue_connections add column if not exists created_at timestamptz not null default now();
    alter table sm_issue_connections add column if not exists created_by uuid;
    alter table sm_issue_connections add column if not exists updated_at timestamptz not null default now();
    alter table sm_issue_connections add column if not exists updated_by uuid;
    alter table sm_issue_connections add column if not exists rev bigint not null default 0;
    alter table sm_issue_connections add column if not exists version integer not null default 1;
    alter table sm_issue_connections add column if not exists deleted_at timestamptz;
    alter table sm_issue_connections add column if not exists origin text;
    alter table sm_issue_connections add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_issue_connections add column if not exists name text;
    alter table sm_issue_connections add column if not exists kind text;
    alter table sm_issue_connections add column if not exists active boolean not null default true;
    alter table sm_issue_connections add column if not exists base_url text;
    alter table sm_issue_connections add column if not exists repo text;
    alter table sm_issue_connections add column if not exists project_key text;
    alter table sm_issue_connections add column if not exists issue_type text;
    alter table sm_issue_connections add column if not exists auth_user text;
    alter table sm_issue_connections add column if not exists token text;
    alter table sm_issue_connections add column if not exists webhook_secret text;
    alter table sm_issue_connections add column if not exists principal_id uuid;
    alter table sm_issue_connections add column if not exists tables jsonb;
    alter table sm_issue_connections add column if not exists sync_comments text;
    alter table sm_issue_connections add column if not exists state_on_close text;
    alter table sm_issue_connections add column if not exists health text;
    alter table sm_issue_connections add column if not exists last_event_at timestamptz;
    alter table sm_issue_connections add column if not exists last_error text;
  end if;
end
$cols$;
create table if not exists sm_issue_connections (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  active boolean not null default true,
  base_url text,
  repo text,
  project_key text,
  issue_type text,
  auth_user text,
  token text,
  webhook_secret text,
  principal_id uuid,
  tables jsonb,
  sync_comments text,
  state_on_close text,
  health text,
  last_event_at timestamptz,
  last_error text
);
create index if not exists sm_issue_connections_rev_idx on sm_issue_connections (org_id, rev);
create index if not exists sm_issue_connections_upd_idx on sm_issue_connections (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_issue_connections_crt_idx on sm_issue_connections (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_issue_connections_workspace_acc_idx on sm_issue_connections (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_issue_connections_unit_acc_idx on sm_issue_connections (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_issue_connections_domain_acc_idx on sm_issue_connections (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_issue_connections_sync on sm_issue_connections;
create trigger sm_issue_connections_sync before insert or update on sm_issue_connections for each row execute function sm_sync_touch('issue_connection');
create or replace trigger sm_issue_connections_demo after insert on sm_issue_connections for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_issue_connections_demo_t after update or delete on sm_issue_connections for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_issue_connections enable row level security;

-- itam_config: تنظیمات دارایی‌ها
do $cols$
begin
  if to_regclass('sm_itam_configs') is not null then
    alter table sm_itam_configs add column if not exists workspace_id uuid;
    alter table sm_itam_configs add column if not exists domain_id uuid;
    alter table sm_itam_configs add column if not exists unit_id uuid;
    alter table sm_itam_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_itam_configs add column if not exists created_by uuid;
    alter table sm_itam_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_itam_configs add column if not exists updated_by uuid;
    alter table sm_itam_configs add column if not exists rev bigint not null default 0;
    alter table sm_itam_configs add column if not exists version integer not null default 1;
    alter table sm_itam_configs add column if not exists deleted_at timestamptz;
    alter table sm_itam_configs add column if not exists origin text;
    alter table sm_itam_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_itam_configs add column if not exists name text;
    alter table sm_itam_configs add column if not exists config_key text;
    alter table sm_itam_configs add column if not exists tag_prefix text;
    alter table sm_itam_configs add column if not exists auto_ci boolean not null default true;
    alter table sm_itam_configs add column if not exists auto_assets boolean not null default true;
    alter table sm_itam_configs add column if not exists auto_assets_confirmed_at timestamptz;
    alter table sm_itam_configs add column if not exists auto_assets_pending integer;
    alter table sm_itam_configs add column if not exists ack_expire_days integer;
    alter table sm_itam_configs add column if not exists ack_remind_days integer;
    alter table sm_itam_configs add column if not exists warranty_reminders jsonb;
    alter table sm_itam_configs add column if not exists unused_days integer;
    alter table sm_itam_configs add column if not exists qr_base_url text;
    alter table sm_itam_configs add column if not exists tag_pattern text;
    alter table sm_itam_configs add column if not exists attestation_months integer;
    alter table sm_itam_configs add column if not exists attestation_due_days integer;
    alter table sm_itam_configs add column if not exists last_reconcile_at timestamptz;
    alter table sm_itam_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_itam_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  tag_prefix text,
  auto_ci boolean not null default true,
  auto_assets boolean not null default true,
  auto_assets_confirmed_at timestamptz,
  auto_assets_pending integer,
  ack_expire_days integer,
  ack_remind_days integer,
  warranty_reminders jsonb,
  unused_days integer,
  qr_base_url text,
  tag_pattern text,
  attestation_months integer,
  attestation_due_days integer,
  last_reconcile_at timestamptz,
  seeded integer
);
create index if not exists sm_itam_configs_rev_idx on sm_itam_configs (org_id, rev);
create index if not exists sm_itam_configs_upd_idx on sm_itam_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_itam_configs_crt_idx on sm_itam_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_itam_configs_config_key_uk on sm_itam_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_itam_configs_sync on sm_itam_configs;
create trigger sm_itam_configs_sync before insert or update on sm_itam_configs for each row execute function sm_sync_touch('itam_config');
create or replace trigger sm_itam_configs_demo after insert on sm_itam_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_itam_configs_demo_t after update or delete on sm_itam_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_itam_configs enable row level security;

-- journey: سفرهای کارکنان
do $cols$
begin
  if to_regclass('sm_journeys') is not null then
    alter table sm_journeys add column if not exists workspace_id uuid;
    alter table sm_journeys add column if not exists domain_id uuid;
    alter table sm_journeys add column if not exists unit_id uuid;
    alter table sm_journeys add column if not exists created_at timestamptz not null default now();
    alter table sm_journeys add column if not exists created_by uuid;
    alter table sm_journeys add column if not exists updated_at timestamptz not null default now();
    alter table sm_journeys add column if not exists updated_by uuid;
    alter table sm_journeys add column if not exists rev bigint not null default 0;
    alter table sm_journeys add column if not exists version integer not null default 1;
    alter table sm_journeys add column if not exists deleted_at timestamptz;
    alter table sm_journeys add column if not exists origin text;
    alter table sm_journeys add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_journeys add column if not exists no integer;
    alter table sm_journeys add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'JRN' || no::text else 'JRN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_journeys add column if not exists name text;
    alter table sm_journeys add column if not exists type text;
    alter table sm_journeys add column if not exists template_id uuid;
    alter table sm_journeys add column if not exists template_version integer;
    alter table sm_journeys add column if not exists anchor_date date;
    alter table sm_journeys add column if not exists subject_person_id uuid;
    alter table sm_journeys add column if not exists subject_name text;
    alter table sm_journeys add column if not exists manager_id uuid;
    alter table sm_journeys add column if not exists hr_owner_id uuid;
    alter table sm_journeys add column if not exists assignment_group_id uuid;
    alter table sm_journeys add column if not exists employment_type text;
    alter table sm_journeys add column if not exists location_id uuid;
    alter table sm_journeys add column if not exists org_unit_id uuid;
    alter table sm_journeys add column if not exists calendar_id uuid;
    alter table sm_journeys add column if not exists hr_case_id uuid;
    alter table sm_journeys add column if not exists notes text;
    alter table sm_journeys add column if not exists progress numeric;
    alter table sm_journeys add column if not exists activities_total integer;
    alter table sm_journeys add column if not exists activities_done integer;
    alter table sm_journeys add column if not exists activities_overdue integer;
    alter table sm_journeys add column if not exists day_one_total integer;
    alter table sm_journeys add column if not exists day_one_done integer;
    alter table sm_journeys add column if not exists day_one_ready boolean not null default false;
    alter table sm_journeys add column if not exists next_due date;
    alter table sm_journeys add column if not exists started_at timestamptz;
    alter table sm_journeys add column if not exists completed_at timestamptz;
    alter table sm_journeys add column if not exists cycle_time bigint;
    alter table sm_journeys add column if not exists opened_by uuid;
    alter table sm_journeys add column if not exists watch_list jsonb;
    alter table sm_journeys add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_journeys (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'JRN' || no::text else 'JRN' || lpad(no::text, 6, '0') end) stored,
  name text,
  type text,
  template_id uuid,
  template_version integer,
  anchor_date date,
  subject_person_id uuid,
  subject_name text,
  manager_id uuid,
  hr_owner_id uuid,
  assignment_group_id uuid,
  employment_type text,
  location_id uuid,
  org_unit_id uuid,
  calendar_id uuid,
  hr_case_id uuid,
  notes text,
  progress numeric,
  activities_total integer,
  activities_done integer,
  activities_overdue integer,
  day_one_total integer,
  day_one_done integer,
  day_one_ready boolean not null default false,
  next_due date,
  started_at timestamptz,
  completed_at timestamptz,
  cycle_time bigint,
  opened_by uuid,
  watch_list jsonb,
  state text,
  search_ee4d45e2 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(subject_name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_journeys' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_ee4d45e2' loop
    execute format('alter table %I drop column if exists %I', 'sm_journeys', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_journeys', 'search_ee4d45e2', $x$translate(coalesce(name, '') || ' ' || coalesce(subject_name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_journeys' and indexname like 'sm\_journeys\_search\_%' and indexname not in ('sm_journeys_search_ee4d45e2_trgm', 'sm_journeys_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_journeys_search_ee4d45e2_trgm', 'sm_journeys', 'search_ee4d45e2', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_journeys_search_custom_trgm', 'sm_journeys', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_journeys_no_uk on sm_journeys (org_id, no);
create index if not exists sm_journeys_rev_idx on sm_journeys (org_id, rev);
create index if not exists sm_journeys_upd_idx on sm_journeys (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_journeys_crt_idx on sm_journeys (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_journeys_subject_person_id_idx on sm_journeys (org_id, subject_person_id) where deleted_at is null;
create index if not exists sm_journeys_manager_id_idx on sm_journeys (org_id, manager_id) where deleted_at is null;
create index if not exists sm_journeys_hr_owner_id_idx on sm_journeys (org_id, hr_owner_id) where deleted_at is null;
create index if not exists sm_journeys_assignment_group_id_idx on sm_journeys (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_journeys_state_idx on sm_journeys (org_id, state) where deleted_at is null;
create index if not exists sm_journeys_workspace_acc_idx on sm_journeys (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_journeys_unit_acc_idx on sm_journeys (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_journeys_domain_acc_idx on sm_journeys (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_journeys_opened_by_idx on sm_journeys (org_id, opened_by) where deleted_at is null;
create index if not exists sm_journeys_watch_list_gin on sm_journeys using gin (watch_list);
drop trigger if exists sm_journeys_sync on sm_journeys;
create trigger sm_journeys_sync before insert or update on sm_journeys for each row execute function sm_sync_touch('journey');
create or replace trigger sm_journeys_demo after insert on sm_journeys for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_journeys_demo_t after update or delete on sm_journeys for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_journeys enable row level security;

-- journey_activity: فعالیت‌های سفر
do $cols$
begin
  if to_regclass('sm_journey_activities') is not null then
    alter table sm_journey_activities add column if not exists workspace_id uuid;
    alter table sm_journey_activities add column if not exists domain_id uuid;
    alter table sm_journey_activities add column if not exists unit_id uuid;
    alter table sm_journey_activities add column if not exists created_at timestamptz not null default now();
    alter table sm_journey_activities add column if not exists created_by uuid;
    alter table sm_journey_activities add column if not exists updated_at timestamptz not null default now();
    alter table sm_journey_activities add column if not exists updated_by uuid;
    alter table sm_journey_activities add column if not exists rev bigint not null default 0;
    alter table sm_journey_activities add column if not exists version integer not null default 1;
    alter table sm_journey_activities add column if not exists deleted_at timestamptz;
    alter table sm_journey_activities add column if not exists origin text;
    alter table sm_journey_activities add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_journey_activities add column if not exists journey_id uuid;
    alter table sm_journey_activities add column if not exists name text;
    alter table sm_journey_activities add column if not exists code text;
    alter table sm_journey_activities add column if not exists phase text;
    alter table sm_journey_activities add column if not exists kind text;
    alter table sm_journey_activities add column if not exists assignee_kind text;
    alter table sm_journey_activities add column if not exists assignee_id uuid;
    alter table sm_journey_activities add column if not exists group_id uuid;
    alter table sm_journey_activities add column if not exists start_date date;
    alter table sm_journey_activities add column if not exists due_date date;
    alter table sm_journey_activities add column if not exists start_offset integer;
    alter table sm_journey_activities add column if not exists duration_days integer;
    alter table sm_journey_activities add column if not exists after jsonb;
    alter table sm_journey_activities add column if not exists day_one boolean not null default false;
    alter table sm_journey_activities add column if not exists overdue boolean not null default false;
    alter table sm_journey_activities add column if not exists condition jsonb;
    alter table sm_journey_activities add column if not exists catalog_item_code text;
    alter table sm_journey_activities add column if not exists order_answers jsonb;
    alter table sm_journey_activities add column if not exists approval text;
    alter table sm_journey_activities add column if not exists case_table text;
    alter table sm_journey_activities add column if not exists case_department_id uuid;
    alter table sm_journey_activities add column if not exists record_table text;
    alter table sm_journey_activities add column if not exists record_id text;
    alter table sm_journey_activities add column if not exists record_number text;
    alter table sm_journey_activities add column if not exists started_at timestamptz;
    alter table sm_journey_activities add column if not exists done_at timestamptz;
    alter table sm_journey_activities add column if not exists document_url text;
    alter table sm_journey_activities add column if not exists instructions text;
    alter table sm_journey_activities add column if not exists outcome text;
    alter table sm_journey_activities add column if not exists sort_order integer;
    alter table sm_journey_activities add column if not exists journey_readers jsonb;
    alter table sm_journey_activities add column if not exists hr_group_id uuid;
    alter table sm_journey_activities add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_journey_activities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  journey_id uuid,
  name text,
  code text,
  phase text,
  kind text,
  assignee_kind text,
  assignee_id uuid,
  group_id uuid,
  start_date date,
  due_date date,
  start_offset integer,
  duration_days integer,
  after jsonb,
  day_one boolean not null default false,
  overdue boolean not null default false,
  condition jsonb,
  catalog_item_code text,
  order_answers jsonb,
  approval text,
  case_table text,
  case_department_id uuid,
  record_table text,
  record_id text,
  record_number text,
  started_at timestamptz,
  done_at timestamptz,
  document_url text,
  instructions text,
  outcome text,
  sort_order integer,
  journey_readers jsonb,
  hr_group_id uuid,
  state text
);
create index if not exists sm_journey_activities_rev_idx on sm_journey_activities (org_id, rev);
create index if not exists sm_journey_activities_upd_idx on sm_journey_activities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_journey_activities_crt_idx on sm_journey_activities (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_journey_activities_journey_id_idx on sm_journey_activities (org_id, journey_id) where deleted_at is null;
create index if not exists sm_journey_activities_assignee_id_idx on sm_journey_activities (org_id, assignee_id) where deleted_at is null;
create index if not exists sm_journey_activities_state_idx on sm_journey_activities (org_id, state) where deleted_at is null;
create index if not exists sm_journey_activities_workspace_acc_idx on sm_journey_activities (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_journey_activities_unit_acc_idx on sm_journey_activities (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_journey_activities_domain_acc_idx on sm_journey_activities (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_journey_activities_journey_readers_gin on sm_journey_activities using gin (journey_readers);
drop trigger if exists sm_journey_activities_sync on sm_journey_activities;
create trigger sm_journey_activities_sync before insert or update on sm_journey_activities for each row execute function sm_sync_touch('journey_activity');
create or replace trigger sm_journey_activities_demo after insert on sm_journey_activities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_journey_activities_demo_t after update or delete on sm_journey_activities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_journey_activities enable row level security;

-- journey_template: الگوهای سفر کارمند
do $cols$
begin
  if to_regclass('sm_journey_templates') is not null then
    alter table sm_journey_templates add column if not exists workspace_id uuid;
    alter table sm_journey_templates add column if not exists domain_id uuid;
    alter table sm_journey_templates add column if not exists unit_id uuid;
    alter table sm_journey_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_journey_templates add column if not exists created_by uuid;
    alter table sm_journey_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_journey_templates add column if not exists updated_by uuid;
    alter table sm_journey_templates add column if not exists rev bigint not null default 0;
    alter table sm_journey_templates add column if not exists version integer not null default 1;
    alter table sm_journey_templates add column if not exists deleted_at timestamptz;
    alter table sm_journey_templates add column if not exists origin text;
    alter table sm_journey_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_journey_templates add column if not exists name text;
    alter table sm_journey_templates add column if not exists type text;
    alter table sm_journey_templates add column if not exists code text;
    alter table sm_journey_templates add column if not exists department_id uuid;
    alter table sm_journey_templates add column if not exists template_version integer;
    alter table sm_journey_templates add column if not exists anchor_label text;
    alter table sm_journey_templates add column if not exists owner_group_id uuid;
    alter table sm_journey_templates add column if not exists calendar_id uuid;
    alter table sm_journey_templates add column if not exists active boolean not null default true;
    alter table sm_journey_templates add column if not exists description text;
    alter table sm_journey_templates add column if not exists dept_admins jsonb;
  end if;
end
$cols$;
create table if not exists sm_journey_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  type text,
  code text,
  department_id uuid,
  template_version integer,
  anchor_label text,
  owner_group_id uuid,
  calendar_id uuid,
  active boolean not null default true,
  description text,
  dept_admins jsonb
);
create index if not exists sm_journey_templates_rev_idx on sm_journey_templates (org_id, rev);
create index if not exists sm_journey_templates_upd_idx on sm_journey_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_journey_templates_crt_idx on sm_journey_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_journey_templates_code_uk on sm_journey_templates (org_id, code) where deleted_at is null;
create index if not exists sm_journey_templates_workspace_acc_idx on sm_journey_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_journey_templates_unit_acc_idx on sm_journey_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_journey_templates_domain_acc_idx on sm_journey_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_journey_templates_dept_admins_gin on sm_journey_templates using gin (dept_admins);
create index if not exists sm_journey_templates_open_grp_idx on sm_journey_templates (org_id, owner_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_journey_templates_sync on sm_journey_templates;
create trigger sm_journey_templates_sync before insert or update on sm_journey_templates for each row execute function sm_sync_touch('journey_template');
create or replace trigger sm_journey_templates_demo after insert on sm_journey_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_journey_templates_demo_t after update or delete on sm_journey_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_journey_templates enable row level security;

-- journey_template_activity: فعالیت‌های الگوهای سفر
do $cols$
begin
  if to_regclass('sm_journey_template_activities') is not null then
    alter table sm_journey_template_activities add column if not exists workspace_id uuid;
    alter table sm_journey_template_activities add column if not exists domain_id uuid;
    alter table sm_journey_template_activities add column if not exists unit_id uuid;
    alter table sm_journey_template_activities add column if not exists created_at timestamptz not null default now();
    alter table sm_journey_template_activities add column if not exists created_by uuid;
    alter table sm_journey_template_activities add column if not exists updated_at timestamptz not null default now();
    alter table sm_journey_template_activities add column if not exists updated_by uuid;
    alter table sm_journey_template_activities add column if not exists rev bigint not null default 0;
    alter table sm_journey_template_activities add column if not exists version integer not null default 1;
    alter table sm_journey_template_activities add column if not exists deleted_at timestamptz;
    alter table sm_journey_template_activities add column if not exists origin text;
    alter table sm_journey_template_activities add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_journey_template_activities add column if not exists template_id uuid;
    alter table sm_journey_template_activities add column if not exists code text;
    alter table sm_journey_template_activities add column if not exists sort_order integer;
    alter table sm_journey_template_activities add column if not exists name text;
    alter table sm_journey_template_activities add column if not exists phase text;
    alter table sm_journey_template_activities add column if not exists kind text;
    alter table sm_journey_template_activities add column if not exists assignee text;
    alter table sm_journey_template_activities add column if not exists group_id uuid;
    alter table sm_journey_template_activities add column if not exists start_offset integer;
    alter table sm_journey_template_activities add column if not exists duration_days integer;
    alter table sm_journey_template_activities add column if not exists after jsonb;
    alter table sm_journey_template_activities add column if not exists condition jsonb;
    alter table sm_journey_template_activities add column if not exists catalog_item_code text;
    alter table sm_journey_template_activities add column if not exists order_answers jsonb;
    alter table sm_journey_template_activities add column if not exists case_table text;
    alter table sm_journey_template_activities add column if not exists case_department_id uuid;
    alter table sm_journey_template_activities add column if not exists day_one boolean not null default false;
    alter table sm_journey_template_activities add column if not exists active boolean not null default true;
    alter table sm_journey_template_activities add column if not exists document_url text;
    alter table sm_journey_template_activities add column if not exists instructions text;
    alter table sm_journey_template_activities add column if not exists dept_admins jsonb;
  end if;
end
$cols$;
create table if not exists sm_journey_template_activities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  template_id uuid,
  code text,
  sort_order integer,
  name text,
  phase text,
  kind text,
  assignee text,
  group_id uuid,
  start_offset integer,
  duration_days integer,
  after jsonb,
  condition jsonb,
  catalog_item_code text,
  order_answers jsonb,
  case_table text,
  case_department_id uuid,
  day_one boolean not null default false,
  active boolean not null default true,
  document_url text,
  instructions text,
  dept_admins jsonb
);
create index if not exists sm_journey_template_activities_rev_idx on sm_journey_template_activities (org_id, rev);
create index if not exists sm_journey_template_activities_upd_idx on sm_journey_template_activities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_journey_template_activities_crt_idx on sm_journey_template_activities (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_journey_template_activities_template_id_idx on sm_journey_template_activities (org_id, template_id) where deleted_at is null;
create unique index if not exists sm_journey_template_activities_template_id_code_uk on sm_journey_template_activities (org_id, template_id, code) where deleted_at is null;
create index if not exists sm_journey_template_activities_workspace_acc_idx on sm_journey_template_activities (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_journey_template_activities_unit_acc_idx on sm_journey_template_activities (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_journey_template_activities_domain_acc_idx on sm_journey_template_activities (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_journey_template_activities_dept_admins_gin on sm_journey_template_activities using gin (dept_admins);
drop trigger if exists sm_journey_template_activities_sync on sm_journey_template_activities;
create trigger sm_journey_template_activities_sync before insert or update on sm_journey_template_activities for each row execute function sm_sync_touch('journey_template_activity');
create or replace trigger sm_journey_template_activities_demo after insert on sm_journey_template_activities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_journey_template_activities_demo_t after update or delete on sm_journey_template_activities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_journey_template_activities enable row level security;

-- kb_ack: تأییدهای مطالعه
do $cols$
begin
  if to_regclass('sm_kb_acks') is not null then
    alter table sm_kb_acks add column if not exists workspace_id uuid;
    alter table sm_kb_acks add column if not exists domain_id uuid;
    alter table sm_kb_acks add column if not exists unit_id uuid;
    alter table sm_kb_acks add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_acks add column if not exists created_by uuid;
    alter table sm_kb_acks add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_acks add column if not exists updated_by uuid;
    alter table sm_kb_acks add column if not exists rev bigint not null default 0;
    alter table sm_kb_acks add column if not exists version integer not null default 1;
    alter table sm_kb_acks add column if not exists deleted_at timestamptz;
    alter table sm_kb_acks add column if not exists origin text;
    alter table sm_kb_acks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_acks add column if not exists attestation_id uuid;
    alter table sm_kb_acks add column if not exists article_id uuid;
    alter table sm_kb_acks add column if not exists user_id uuid;
    alter table sm_kb_acks add column if not exists version_label text;
    alter table sm_kb_acks add column if not exists acked_at timestamptz;
    alter table sm_kb_acks add column if not exists k_users jsonb;
    alter table sm_kb_acks add column if not exists k_groups jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_acks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  attestation_id uuid,
  article_id uuid,
  user_id uuid,
  version_label text,
  acked_at timestamptz,
  k_users jsonb,
  k_groups jsonb
);
create index if not exists sm_kb_acks_rev_idx on sm_kb_acks (org_id, rev);
create index if not exists sm_kb_acks_upd_idx on sm_kb_acks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_acks_crt_idx on sm_kb_acks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_acks_attestation_id_idx on sm_kb_acks (org_id, attestation_id) where deleted_at is null;
create index if not exists sm_kb_acks_article_id_idx on sm_kb_acks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_acks_user_id_idx on sm_kb_acks (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_acks_k_users_gin on sm_kb_acks using gin (k_users);
create index if not exists sm_kb_acks_k_groups_gin on sm_kb_acks using gin (k_groups);
create unique index if not exists sm_kb_acks_attestation_id_user_id_uk on sm_kb_acks (org_id, attestation_id, user_id) where deleted_at is null;
create index if not exists sm_kb_acks_workspace_acc_idx on sm_kb_acks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_acks_unit_acc_idx on sm_kb_acks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_acks_domain_acc_idx on sm_kb_acks (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_acks_sync on sm_kb_acks;
create trigger sm_kb_acks_sync before insert or update on sm_kb_acks for each row execute function sm_sync_touch('kb_ack');
create or replace trigger sm_kb_acks_demo after insert on sm_kb_acks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_acks_demo_t after update or delete on sm_kb_acks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_acks enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:14', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

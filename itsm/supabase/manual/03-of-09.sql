-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۳ از ۹ (0006_engine_tables:7/28 … 0006_engine_tables:10/28)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۷ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 7/28 (e746bd22eb04)
-- continuity_config: تنظیمات تداوم و دسترس‌پذیری
do $cols$
begin
  if to_regclass('sm_continuity_configs') is not null then
    alter table sm_continuity_configs add column if not exists workspace_id uuid;
    alter table sm_continuity_configs add column if not exists domain_id uuid;
    alter table sm_continuity_configs add column if not exists unit_id uuid;
    alter table sm_continuity_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_continuity_configs add column if not exists created_by uuid;
    alter table sm_continuity_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_continuity_configs add column if not exists updated_by uuid;
    alter table sm_continuity_configs add column if not exists rev bigint not null default 0;
    alter table sm_continuity_configs add column if not exists version integer not null default 1;
    alter table sm_continuity_configs add column if not exists deleted_at timestamptz;
    alter table sm_continuity_configs add column if not exists origin text;
    alter table sm_continuity_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_continuity_configs add column if not exists name text;
    alter table sm_continuity_configs add column if not exists config_key text;
    alter table sm_continuity_configs add column if not exists exclude_planned boolean not null default true;
    alter table sm_continuity_configs add column if not exists degradation_weight integer;
    alter table sm_continuity_configs add column if not exists plan_review_months integer;
    alter table sm_continuity_configs add column if not exists bia_review_months integer;
    alter table sm_continuity_configs add column if not exists propose_on_major boolean not null default true;
    alter table sm_continuity_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_continuity_configs (
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
  exclude_planned boolean not null default true,
  degradation_weight integer,
  plan_review_months integer,
  bia_review_months integer,
  propose_on_major boolean not null default true,
  seeded integer
);
create index if not exists sm_continuity_configs_rev_idx on sm_continuity_configs (org_id, rev);
create index if not exists sm_continuity_configs_upd_idx on sm_continuity_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_continuity_configs_crt_idx on sm_continuity_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_continuity_configs_config_key_uk on sm_continuity_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_continuity_configs_sync on sm_continuity_configs;
create trigger sm_continuity_configs_sync before insert or update on sm_continuity_configs for each row execute function sm_sync_touch('continuity_config');
create or replace trigger sm_continuity_configs_demo after insert on sm_continuity_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_continuity_configs_demo_t after update or delete on sm_continuity_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_continuity_configs enable row level security;

-- continuity_plan: طرح‌های تداوم و بازیابی
do $cols$
begin
  if to_regclass('sm_continuity_plans') is not null then
    alter table sm_continuity_plans add column if not exists workspace_id uuid;
    alter table sm_continuity_plans add column if not exists domain_id uuid;
    alter table sm_continuity_plans add column if not exists unit_id uuid;
    alter table sm_continuity_plans add column if not exists created_at timestamptz not null default now();
    alter table sm_continuity_plans add column if not exists created_by uuid;
    alter table sm_continuity_plans add column if not exists updated_at timestamptz not null default now();
    alter table sm_continuity_plans add column if not exists updated_by uuid;
    alter table sm_continuity_plans add column if not exists rev bigint not null default 0;
    alter table sm_continuity_plans add column if not exists version integer not null default 1;
    alter table sm_continuity_plans add column if not exists deleted_at timestamptz;
    alter table sm_continuity_plans add column if not exists origin text;
    alter table sm_continuity_plans add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_continuity_plans add column if not exists no integer;
    alter table sm_continuity_plans add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BCP' || no::text else 'BCP' || lpad(no::text, 5, '0') end) stored;
    alter table sm_continuity_plans add column if not exists title text;
    alter table sm_continuity_plans add column if not exists plan_type text;
    alter table sm_continuity_plans add column if not exists service_id uuid;
    alter table sm_continuity_plans add column if not exists bia_id uuid;
    alter table sm_continuity_plans add column if not exists sites jsonb;
    alter table sm_continuity_plans add column if not exists owner_id uuid;
    alter table sm_continuity_plans add column if not exists assignment_group_id uuid;
    alter table sm_continuity_plans add column if not exists rto bigint;
    alter table sm_continuity_plans add column if not exists rpo bigint;
    alter table sm_continuity_plans add column if not exists version_label text;
    alter table sm_continuity_plans add column if not exists invocation_criteria text;
    alter table sm_continuity_plans add column if not exists call_tree text;
    alter table sm_continuity_plans add column if not exists return_to_normal text;
    alter table sm_continuity_plans add column if not exists review_months integer;
    alter table sm_continuity_plans add column if not exists last_reviewed_at date;
    alter table sm_continuity_plans add column if not exists next_review_at date;
    alter table sm_continuity_plans add column if not exists last_tested_at date;
    alter table sm_continuity_plans add column if not exists last_test_result text;
    alter table sm_continuity_plans add column if not exists approved_at timestamptz;
    alter table sm_continuity_plans add column if not exists watch_list jsonb;
    alter table sm_continuity_plans add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_continuity_plans (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BCP' || no::text else 'BCP' || lpad(no::text, 5, '0') end) stored,
  title text,
  plan_type text,
  service_id uuid,
  bia_id uuid,
  sites jsonb,
  owner_id uuid,
  assignment_group_id uuid,
  rto bigint,
  rpo bigint,
  version_label text,
  invocation_criteria text,
  call_tree text,
  return_to_normal text,
  review_months integer,
  last_reviewed_at date,
  next_review_at date,
  last_tested_at date,
  last_test_result text,
  approved_at timestamptz,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_continuity_plans', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_continuity_plans_search_cae18f1d_trgm', 'sm_continuity_plans', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_continuity_plans_search_custom_trgm', 'sm_continuity_plans', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_continuity_plans_no_uk on sm_continuity_plans (org_id, no);
create index if not exists sm_continuity_plans_rev_idx on sm_continuity_plans (org_id, rev);
create index if not exists sm_continuity_plans_upd_idx on sm_continuity_plans (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_continuity_plans_crt_idx on sm_continuity_plans (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_continuity_plans_state_idx on sm_continuity_plans (org_id, state) where deleted_at is null;
create index if not exists sm_continuity_plans_workspace_acc_idx on sm_continuity_plans (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_continuity_plans_unit_acc_idx on sm_continuity_plans (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_continuity_plans_domain_acc_idx on sm_continuity_plans (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_continuity_plans_owner_id_idx on sm_continuity_plans (org_id, owner_id) where deleted_at is null;
create index if not exists sm_continuity_plans_watch_list_gin on sm_continuity_plans using gin (watch_list);
drop trigger if exists sm_continuity_plans_sync on sm_continuity_plans;
create trigger sm_continuity_plans_sync before insert or update on sm_continuity_plans for each row execute function sm_sync_touch('continuity_plan');
create or replace trigger sm_continuity_plans_demo after insert on sm_continuity_plans for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_continuity_plans_demo_t after update or delete on sm_continuity_plans for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_continuity_plans enable row level security;

-- contract: قراردادها
do $cols$
begin
  if to_regclass('sm_contracts') is not null then
    alter table sm_contracts add column if not exists workspace_id uuid;
    alter table sm_contracts add column if not exists domain_id uuid;
    alter table sm_contracts add column if not exists unit_id uuid;
    alter table sm_contracts add column if not exists created_at timestamptz not null default now();
    alter table sm_contracts add column if not exists created_by uuid;
    alter table sm_contracts add column if not exists updated_at timestamptz not null default now();
    alter table sm_contracts add column if not exists updated_by uuid;
    alter table sm_contracts add column if not exists rev bigint not null default 0;
    alter table sm_contracts add column if not exists version integer not null default 1;
    alter table sm_contracts add column if not exists deleted_at timestamptz;
    alter table sm_contracts add column if not exists origin text;
    alter table sm_contracts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_contracts add column if not exists no integer;
    alter table sm_contracts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CNT' || no::text else 'CNT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_contracts add column if not exists name text;
    alter table sm_contracts add column if not exists supplier_id uuid;
    alter table sm_contracts add column if not exists contract_type text;
    alter table sm_contracts add column if not exists vendor_ref text;
    alter table sm_contracts add column if not exists owner_id uuid;
    alter table sm_contracts add column if not exists owner_group_id uuid;
    alter table sm_contracts add column if not exists parent_id uuid;
    alter table sm_contracts add column if not exists previous_contract_id uuid;
    alter table sm_contracts add column if not exists renewed_by_id uuid;
    alter table sm_contracts add column if not exists document_id uuid;
    alter table sm_contracts add column if not exists approval text;
    alter table sm_contracts add column if not exists terms text;
    alter table sm_contracts add column if not exists termination_reason text;
    alter table sm_contracts add column if not exists start_date date;
    alter table sm_contracts add column if not exists end_date date;
    alter table sm_contracts add column if not exists notice_period_days integer;
    alter table sm_contracts add column if not exists notice_date date;
    alter table sm_contracts add column if not exists renewal_type text;
    alter table sm_contracts add column if not exists renewal_term_months integer;
    alter table sm_contracts add column if not exists reminder_days jsonb;
    alter table sm_contracts add column if not exists reminded jsonb;
    alter table sm_contracts add column if not exists value numeric;
    alter table sm_contracts add column if not exists annual_value numeric;
    alter table sm_contracts add column if not exists payment_frequency text;
    alter table sm_contracts add column if not exists currency text;
    alter table sm_contracts add column if not exists foreign_value numeric;
    alter table sm_contracts add column if not exists fx_rate numeric;
    alter table sm_contracts add column if not exists cost_center_id uuid;
    alter table sm_contracts add column if not exists cost_type_id uuid;
    alter table sm_contracts add column if not exists service_id uuid;
    alter table sm_contracts add column if not exists sla_definitions jsonb;
    alter table sm_contracts add column if not exists uc_targets text;
    alter table sm_contracts add column if not exists watch_list jsonb;
    alter table sm_contracts add column if not exists confidential boolean not null default false;
    alter table sm_contracts add column if not exists access_list jsonb;
    alter table sm_contracts add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_contracts (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CNT' || no::text else 'CNT' || lpad(no::text, 6, '0') end) stored,
  name text,
  supplier_id uuid,
  contract_type text,
  vendor_ref text,
  owner_id uuid,
  owner_group_id uuid,
  parent_id uuid,
  previous_contract_id uuid,
  renewed_by_id uuid,
  document_id uuid,
  approval text,
  terms text,
  termination_reason text,
  start_date date,
  end_date date,
  notice_period_days integer,
  notice_date date,
  renewal_type text,
  renewal_term_months integer,
  reminder_days jsonb,
  reminded jsonb,
  value numeric,
  annual_value numeric,
  payment_frequency text,
  currency text,
  foreign_value numeric,
  fx_rate numeric,
  cost_center_id uuid,
  cost_type_id uuid,
  service_id uuid,
  sla_definitions jsonb,
  uc_targets text,
  watch_list jsonb,
  confidential boolean not null default false,
  access_list jsonb,
  state text,
  search_dbfbeeb6 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(vendor_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_contracts', 'search_dbfbeeb6', $x$translate(coalesce(name, '') || ' ' || coalesce(vendor_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_contracts_search_dbfbeeb6_trgm', 'sm_contracts', 'search_dbfbeeb6', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_contracts_search_custom_trgm', 'sm_contracts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_contracts_no_uk on sm_contracts (org_id, no);
create index if not exists sm_contracts_rev_idx on sm_contracts (org_id, rev);
create index if not exists sm_contracts_upd_idx on sm_contracts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_contracts_crt_idx on sm_contracts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_contracts_supplier_id_idx on sm_contracts (org_id, supplier_id) where deleted_at is null;
create index if not exists sm_contracts_end_date_idx on sm_contracts (org_id, end_date) where deleted_at is null;
create index if not exists sm_contracts_notice_date_idx on sm_contracts (org_id, notice_date) where deleted_at is null;
create index if not exists sm_contracts_state_idx on sm_contracts (org_id, state) where deleted_at is null;
create index if not exists sm_contracts_workspace_acc_idx on sm_contracts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_contracts_unit_acc_idx on sm_contracts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_contracts_domain_acc_idx on sm_contracts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_contracts_owner_id_idx on sm_contracts (org_id, owner_id) where deleted_at is null;
create index if not exists sm_contracts_watch_list_gin on sm_contracts using gin (watch_list);
drop trigger if exists sm_contracts_sync on sm_contracts;
create trigger sm_contracts_sync before insert or update on sm_contracts for each row execute function sm_sync_touch('contract');
create or replace trigger sm_contracts_demo after insert on sm_contracts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_contracts_demo_t after update or delete on sm_contracts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_contracts enable row level security;

-- contract_coverage: پوشش‌های قرارداد
do $cols$
begin
  if to_regclass('sm_contract_coverages') is not null then
    alter table sm_contract_coverages add column if not exists workspace_id uuid;
    alter table sm_contract_coverages add column if not exists domain_id uuid;
    alter table sm_contract_coverages add column if not exists unit_id uuid;
    alter table sm_contract_coverages add column if not exists created_at timestamptz not null default now();
    alter table sm_contract_coverages add column if not exists created_by uuid;
    alter table sm_contract_coverages add column if not exists updated_at timestamptz not null default now();
    alter table sm_contract_coverages add column if not exists updated_by uuid;
    alter table sm_contract_coverages add column if not exists rev bigint not null default 0;
    alter table sm_contract_coverages add column if not exists version integer not null default 1;
    alter table sm_contract_coverages add column if not exists deleted_at timestamptz;
    alter table sm_contract_coverages add column if not exists origin text;
    alter table sm_contract_coverages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_contract_coverages add column if not exists contract_id uuid;
    alter table sm_contract_coverages add column if not exists target_kind text;
    alter table sm_contract_coverages add column if not exists asset_id uuid;
    alter table sm_contract_coverages add column if not exists ci_id uuid;
    alter table sm_contract_coverages add column if not exists service_id uuid;
    alter table sm_contract_coverages add column if not exists software_model_id uuid;
    alter table sm_contract_coverages add column if not exists location_id uuid;
    alter table sm_contract_coverages add column if not exists coverage_level text;
    alter table sm_contract_coverages add column if not exists valid_from date;
    alter table sm_contract_coverages add column if not exists valid_to date;
    alter table sm_contract_coverages add column if not exists label text;
    alter table sm_contract_coverages add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_contract_coverages (
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
  contract_id uuid,
  target_kind text,
  asset_id uuid,
  ci_id uuid,
  service_id uuid,
  software_model_id uuid,
  location_id uuid,
  coverage_level text,
  valid_from date,
  valid_to date,
  label text,
  note text
);
create index if not exists sm_contract_coverages_rev_idx on sm_contract_coverages (org_id, rev);
create index if not exists sm_contract_coverages_upd_idx on sm_contract_coverages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_coverages_crt_idx on sm_contract_coverages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_coverages_contract_id_idx on sm_contract_coverages (org_id, contract_id) where deleted_at is null;
create index if not exists sm_contract_coverages_asset_id_idx on sm_contract_coverages (org_id, asset_id) where deleted_at is null;
create index if not exists sm_contract_coverages_ci_id_idx on sm_contract_coverages (org_id, ci_id) where deleted_at is null;
create index if not exists sm_contract_coverages_service_id_idx on sm_contract_coverages (org_id, service_id) where deleted_at is null;
drop trigger if exists sm_contract_coverages_sync on sm_contract_coverages;
create trigger sm_contract_coverages_sync before insert or update on sm_contract_coverages for each row execute function sm_sync_touch('contract_coverage');
create or replace trigger sm_contract_coverages_demo after insert on sm_contract_coverages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_contract_coverages_demo_t after update or delete on sm_contract_coverages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_contract_coverages enable row level security;

-- contract_guarantee: ضمانت‌نامه‌ها و سپرده‌ها
do $cols$
begin
  if to_regclass('sm_contract_guarantees') is not null then
    alter table sm_contract_guarantees add column if not exists workspace_id uuid;
    alter table sm_contract_guarantees add column if not exists domain_id uuid;
    alter table sm_contract_guarantees add column if not exists unit_id uuid;
    alter table sm_contract_guarantees add column if not exists created_at timestamptz not null default now();
    alter table sm_contract_guarantees add column if not exists created_by uuid;
    alter table sm_contract_guarantees add column if not exists updated_at timestamptz not null default now();
    alter table sm_contract_guarantees add column if not exists updated_by uuid;
    alter table sm_contract_guarantees add column if not exists rev bigint not null default 0;
    alter table sm_contract_guarantees add column if not exists version integer not null default 1;
    alter table sm_contract_guarantees add column if not exists deleted_at timestamptz;
    alter table sm_contract_guarantees add column if not exists origin text;
    alter table sm_contract_guarantees add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_contract_guarantees add column if not exists no integer;
    alter table sm_contract_guarantees add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'GRT' || no::text else 'GRT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_contract_guarantees add column if not exists contract_id uuid;
    alter table sm_contract_guarantees add column if not exists kind text;
    alter table sm_contract_guarantees add column if not exists form text;
    alter table sm_contract_guarantees add column if not exists issuer text;
    alter table sm_contract_guarantees add column if not exists reference_no text;
    alter table sm_contract_guarantees add column if not exists amount numeric;
    alter table sm_contract_guarantees add column if not exists issue_date date;
    alter table sm_contract_guarantees add column if not exists expiry_date date;
    alter table sm_contract_guarantees add column if not exists release_due date;
    alter table sm_contract_guarantees add column if not exists released_at timestamptz;
    alter table sm_contract_guarantees add column if not exists owner_id uuid;
    alter table sm_contract_guarantees add column if not exists note text;
    alter table sm_contract_guarantees add column if not exists reminded jsonb;
    alter table sm_contract_guarantees add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_contract_guarantees (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'GRT' || no::text else 'GRT' || lpad(no::text, 6, '0') end) stored,
  contract_id uuid,
  kind text,
  form text,
  issuer text,
  reference_no text,
  amount numeric,
  issue_date date,
  expiry_date date,
  release_due date,
  released_at timestamptz,
  owner_id uuid,
  note text,
  reminded jsonb,
  state text,
  search_a176303d text generated always as (translate(coalesce(issuer, '') || ' ' || coalesce(reference_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_contract_guarantees', 'search_a176303d', $x$translate(coalesce(issuer, '') || ' ' || coalesce(reference_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_contract_guarantees_search_a176303d_trgm', 'sm_contract_guarantees', 'search_a176303d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_contract_guarantees_search_custom_trgm', 'sm_contract_guarantees', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_contract_guarantees_no_uk on sm_contract_guarantees (org_id, no);
create index if not exists sm_contract_guarantees_rev_idx on sm_contract_guarantees (org_id, rev);
create index if not exists sm_contract_guarantees_upd_idx on sm_contract_guarantees (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_guarantees_crt_idx on sm_contract_guarantees (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_guarantees_contract_id_idx on sm_contract_guarantees (org_id, contract_id) where deleted_at is null;
create index if not exists sm_contract_guarantees_expiry_date_idx on sm_contract_guarantees (org_id, expiry_date) where deleted_at is null;
create index if not exists sm_contract_guarantees_state_idx on sm_contract_guarantees (org_id, state) where deleted_at is null;
create index if not exists sm_contract_guarantees_workspace_acc_idx on sm_contract_guarantees (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_contract_guarantees_unit_acc_idx on sm_contract_guarantees (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_contract_guarantees_domain_acc_idx on sm_contract_guarantees (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_contract_guarantees_owner_id_idx on sm_contract_guarantees (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_contract_guarantees_sync on sm_contract_guarantees;
create trigger sm_contract_guarantees_sync before insert or update on sm_contract_guarantees for each row execute function sm_sync_touch('contract_guarantee');
create or replace trigger sm_contract_guarantees_demo after insert on sm_contract_guarantees for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_contract_guarantees_demo_t after update or delete on sm_contract_guarantees for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_contract_guarantees enable row level security;

-- contract_line: سطرهای قرارداد
do $cols$
begin
  if to_regclass('sm_contract_lines') is not null then
    alter table sm_contract_lines add column if not exists workspace_id uuid;
    alter table sm_contract_lines add column if not exists domain_id uuid;
    alter table sm_contract_lines add column if not exists unit_id uuid;
    alter table sm_contract_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_contract_lines add column if not exists created_by uuid;
    alter table sm_contract_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_contract_lines add column if not exists updated_by uuid;
    alter table sm_contract_lines add column if not exists rev bigint not null default 0;
    alter table sm_contract_lines add column if not exists version integer not null default 1;
    alter table sm_contract_lines add column if not exists deleted_at timestamptz;
    alter table sm_contract_lines add column if not exists origin text;
    alter table sm_contract_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_contract_lines add column if not exists contract_id uuid;
    alter table sm_contract_lines add column if not exists description text;
    alter table sm_contract_lines add column if not exists quantity numeric;
    alter table sm_contract_lines add column if not exists unit_price numeric;
    alter table sm_contract_lines add column if not exists amount numeric;
    alter table sm_contract_lines add column if not exists period text;
    alter table sm_contract_lines add column if not exists model_id uuid;
    alter table sm_contract_lines add column if not exists software_model_id uuid;
    alter table sm_contract_lines add column if not exists start_date date;
    alter table sm_contract_lines add column if not exists end_date date;
  end if;
end
$cols$;
create table if not exists sm_contract_lines (
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
  contract_id uuid,
  description text,
  quantity numeric,
  unit_price numeric,
  amount numeric,
  period text,
  model_id uuid,
  software_model_id uuid,
  start_date date,
  end_date date
);
create index if not exists sm_contract_lines_rev_idx on sm_contract_lines (org_id, rev);
create index if not exists sm_contract_lines_upd_idx on sm_contract_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_lines_crt_idx on sm_contract_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_lines_contract_id_idx on sm_contract_lines (org_id, contract_id) where deleted_at is null;
drop trigger if exists sm_contract_lines_sync on sm_contract_lines;
create trigger sm_contract_lines_sync before insert or update on sm_contract_lines for each row execute function sm_sync_touch('contract_line');
create or replace trigger sm_contract_lines_demo after insert on sm_contract_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_contract_lines_demo_t after update or delete on sm_contract_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_contract_lines enable row level security;

-- contract_obligation: تعهدهای قراردادی
do $cols$
begin
  if to_regclass('sm_contract_obligations') is not null then
    alter table sm_contract_obligations add column if not exists workspace_id uuid;
    alter table sm_contract_obligations add column if not exists domain_id uuid;
    alter table sm_contract_obligations add column if not exists unit_id uuid;
    alter table sm_contract_obligations add column if not exists created_at timestamptz not null default now();
    alter table sm_contract_obligations add column if not exists created_by uuid;
    alter table sm_contract_obligations add column if not exists updated_at timestamptz not null default now();
    alter table sm_contract_obligations add column if not exists updated_by uuid;
    alter table sm_contract_obligations add column if not exists rev bigint not null default 0;
    alter table sm_contract_obligations add column if not exists version integer not null default 1;
    alter table sm_contract_obligations add column if not exists deleted_at timestamptz;
    alter table sm_contract_obligations add column if not exists origin text;
    alter table sm_contract_obligations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_contract_obligations add column if not exists no integer;
    alter table sm_contract_obligations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'OBL' || no::text else 'OBL' || lpad(no::text, 6, '0') end) stored;
    alter table sm_contract_obligations add column if not exists contract_id uuid;
    alter table sm_contract_obligations add column if not exists title text;
    alter table sm_contract_obligations add column if not exists party text;
    alter table sm_contract_obligations add column if not exists owner_id uuid;
    alter table sm_contract_obligations add column if not exists due_date date;
    alter table sm_contract_obligations add column if not exists recurrence text;
    alter table sm_contract_obligations add column if not exists fulfilled_at timestamptz;
    alter table sm_contract_obligations add column if not exists description text;
    alter table sm_contract_obligations add column if not exists note text;
    alter table sm_contract_obligations add column if not exists reminded jsonb;
    alter table sm_contract_obligations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_contract_obligations (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'OBL' || no::text else 'OBL' || lpad(no::text, 6, '0') end) stored,
  contract_id uuid,
  title text,
  party text,
  owner_id uuid,
  due_date date,
  recurrence text,
  fulfilled_at timestamptz,
  description text,
  note text,
  reminded jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_contract_obligations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_contract_obligations_search_cae18f1d_trgm', 'sm_contract_obligations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_contract_obligations_search_custom_trgm', 'sm_contract_obligations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_contract_obligations_no_uk on sm_contract_obligations (org_id, no);
create index if not exists sm_contract_obligations_rev_idx on sm_contract_obligations (org_id, rev);
create index if not exists sm_contract_obligations_upd_idx on sm_contract_obligations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_obligations_crt_idx on sm_contract_obligations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_contract_obligations_contract_id_idx on sm_contract_obligations (org_id, contract_id) where deleted_at is null;
create index if not exists sm_contract_obligations_due_date_idx on sm_contract_obligations (org_id, due_date) where deleted_at is null;
create index if not exists sm_contract_obligations_state_idx on sm_contract_obligations (org_id, state) where deleted_at is null;
create index if not exists sm_contract_obligations_workspace_acc_idx on sm_contract_obligations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_contract_obligations_unit_acc_idx on sm_contract_obligations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_contract_obligations_domain_acc_idx on sm_contract_obligations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_contract_obligations_owner_id_idx on sm_contract_obligations (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_contract_obligations_sync on sm_contract_obligations;
create trigger sm_contract_obligations_sync before insert or update on sm_contract_obligations for each row execute function sm_sync_touch('contract_obligation');
create or replace trigger sm_contract_obligations_demo after insert on sm_contract_obligations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_contract_obligations_demo_t after update or delete on sm_contract_obligations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_contract_obligations enable row level security;

-- corrective_action: اقدام‌های اصلاحی و پیشگیرانه
do $cols$
begin
  if to_regclass('sm_corrective_actions') is not null then
    alter table sm_corrective_actions add column if not exists workspace_id uuid;
    alter table sm_corrective_actions add column if not exists domain_id uuid;
    alter table sm_corrective_actions add column if not exists unit_id uuid;
    alter table sm_corrective_actions add column if not exists created_at timestamptz not null default now();
    alter table sm_corrective_actions add column if not exists created_by uuid;
    alter table sm_corrective_actions add column if not exists updated_at timestamptz not null default now();
    alter table sm_corrective_actions add column if not exists updated_by uuid;
    alter table sm_corrective_actions add column if not exists rev bigint not null default 0;
    alter table sm_corrective_actions add column if not exists version integer not null default 1;
    alter table sm_corrective_actions add column if not exists deleted_at timestamptz;
    alter table sm_corrective_actions add column if not exists origin text;
    alter table sm_corrective_actions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_corrective_actions add column if not exists no integer;
    alter table sm_corrective_actions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ACT' || no::text else 'ACT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_corrective_actions add column if not exists short_description text;
    alter table sm_corrective_actions add column if not exists description text;
    alter table sm_corrective_actions add column if not exists state text;
    alter table sm_corrective_actions add column if not exists priority text;
    alter table sm_corrective_actions add column if not exists impact text;
    alter table sm_corrective_actions add column if not exists urgency text;
    alter table sm_corrective_actions add column if not exists category text;
    alter table sm_corrective_actions add column if not exists subcategory text;
    alter table sm_corrective_actions add column if not exists channel text;
    alter table sm_corrective_actions add column if not exists caller_id uuid;
    alter table sm_corrective_actions add column if not exists requested_for uuid;
    alter table sm_corrective_actions add column if not exists opened_by uuid;
    alter table sm_corrective_actions add column if not exists opened_at timestamptz;
    alter table sm_corrective_actions add column if not exists assignment_group_id uuid;
    alter table sm_corrective_actions add column if not exists assigned_to uuid;
    alter table sm_corrective_actions add column if not exists service_id uuid;
    alter table sm_corrective_actions add column if not exists offering_id uuid;
    alter table sm_corrective_actions add column if not exists ci_id uuid;
    alter table sm_corrective_actions add column if not exists location_id uuid;
    alter table sm_corrective_actions add column if not exists due_at timestamptz;
    alter table sm_corrective_actions add column if not exists resolved_at timestamptz;
    alter table sm_corrective_actions add column if not exists resolved_by uuid;
    alter table sm_corrective_actions add column if not exists closed_at timestamptz;
    alter table sm_corrective_actions add column if not exists closed_by uuid;
    alter table sm_corrective_actions add column if not exists close_code text;
    alter table sm_corrective_actions add column if not exists close_notes text;
    alter table sm_corrective_actions add column if not exists parent_id uuid;
    alter table sm_corrective_actions add column if not exists watch_list jsonb;
    alter table sm_corrective_actions add column if not exists approval text;
    alter table sm_corrective_actions add column if not exists escalation integer;
    alter table sm_corrective_actions add column if not exists reassignment_count integer;
    alter table sm_corrective_actions add column if not exists reopen_count integer;
    alter table sm_corrective_actions add column if not exists time_worked bigint;
    alter table sm_corrective_actions add column if not exists first_response_at timestamptz;
    alter table sm_corrective_actions add column if not exists active boolean not null default true;
    alter table sm_corrective_actions add column if not exists sla_due timestamptz;
    alter table sm_corrective_actions add column if not exists knowledge boolean not null default false;
    alter table sm_corrective_actions add column if not exists action_type text;
    alter table sm_corrective_actions add column if not exists problem_id uuid;
    alter table sm_corrective_actions add column if not exists review_id uuid;
    alter table sm_corrective_actions add column if not exists incident_id uuid;
    alter table sm_corrective_actions add column if not exists period_review_id uuid;
    alter table sm_corrective_actions add column if not exists tracker_url text;
    alter table sm_corrective_actions add column if not exists evidence text;
  end if;
end
$cols$;
create table if not exists sm_corrective_actions (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ACT' || no::text else 'ACT' || lpad(no::text, 6, '0') end) stored,
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
  action_type text,
  problem_id uuid,
  review_id uuid,
  incident_id uuid,
  period_review_id uuid,
  tracker_url text,
  evidence text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_corrective_actions', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_corrective_actions_search_f3bce210_trgm', 'sm_corrective_actions', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_corrective_actions_search_custom_trgm', 'sm_corrective_actions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_corrective_actions_no_uk on sm_corrective_actions (org_id, no);
create index if not exists sm_corrective_actions_rev_idx on sm_corrective_actions (org_id, rev);
create index if not exists sm_corrective_actions_upd_idx on sm_corrective_actions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_corrective_actions_crt_idx on sm_corrective_actions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_corrective_actions_state_idx on sm_corrective_actions (org_id, state) where deleted_at is null;
create index if not exists sm_corrective_actions_assignment_group_id_idx on sm_corrective_actions (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_corrective_actions_assigned_to_idx on sm_corrective_actions (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_corrective_actions_problem_id_idx on sm_corrective_actions (org_id, problem_id) where deleted_at is null;
create index if not exists sm_corrective_actions_review_id_idx on sm_corrective_actions (org_id, review_id) where deleted_at is null;
create index if not exists sm_corrective_actions_period_review_id_idx on sm_corrective_actions (org_id, period_review_id) where deleted_at is null;
create index if not exists sm_corrective_actions_workspace_acc_idx on sm_corrective_actions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_corrective_actions_unit_acc_idx on sm_corrective_actions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_corrective_actions_domain_acc_idx on sm_corrective_actions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_corrective_actions_caller_id_idx on sm_corrective_actions (org_id, caller_id) where deleted_at is null;
create index if not exists sm_corrective_actions_requested_for_idx on sm_corrective_actions (org_id, requested_for) where deleted_at is null;
create index if not exists sm_corrective_actions_opened_by_idx on sm_corrective_actions (org_id, opened_by) where deleted_at is null;
create index if not exists sm_corrective_actions_watch_list_gin on sm_corrective_actions using gin (watch_list);
create index if not exists sm_corrective_actions_open_grp_idx on sm_corrective_actions (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_corrective_actions_opened_brin on sm_corrective_actions using brin (opened_at);
drop trigger if exists sm_corrective_actions_sync on sm_corrective_actions;
create trigger sm_corrective_actions_sync before insert or update on sm_corrective_actions for each row execute function sm_sync_touch('corrective_action');
create or replace trigger sm_corrective_actions_demo after insert on sm_corrective_actions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_corrective_actions_demo_t after update or delete on sm_corrective_actions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_corrective_actions enable row level security;

-- correlation_rule: قاعده‌های هم‌بستگی
do $cols$
begin
  if to_regclass('sm_correlation_rules') is not null then
    alter table sm_correlation_rules add column if not exists workspace_id uuid;
    alter table sm_correlation_rules add column if not exists domain_id uuid;
    alter table sm_correlation_rules add column if not exists unit_id uuid;
    alter table sm_correlation_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_correlation_rules add column if not exists created_by uuid;
    alter table sm_correlation_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_correlation_rules add column if not exists updated_by uuid;
    alter table sm_correlation_rules add column if not exists rev bigint not null default 0;
    alter table sm_correlation_rules add column if not exists version integer not null default 1;
    alter table sm_correlation_rules add column if not exists deleted_at timestamptz;
    alter table sm_correlation_rules add column if not exists origin text;
    alter table sm_correlation_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_correlation_rules add column if not exists name text;
    alter table sm_correlation_rules add column if not exists kind text;
    alter table sm_correlation_rules add column if not exists active boolean not null default true;
    alter table sm_correlation_rules add column if not exists sort_order integer;
    alter table sm_correlation_rules add column if not exists window_minutes integer;
    alter table sm_correlation_rules add column if not exists max_hops integer;
    alter table sm_correlation_rules add column if not exists match_fields jsonb;
    alter table sm_correlation_rules add column if not exists condition jsonb;
    alter table sm_correlation_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_correlation_rules (
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
  sort_order integer,
  window_minutes integer,
  max_hops integer,
  match_fields jsonb,
  condition jsonb,
  description text
);
create index if not exists sm_correlation_rules_rev_idx on sm_correlation_rules (org_id, rev);
create index if not exists sm_correlation_rules_upd_idx on sm_correlation_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_correlation_rules_crt_idx on sm_correlation_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_correlation_rules_sync on sm_correlation_rules;
create trigger sm_correlation_rules_sync before insert or update on sm_correlation_rules for each row execute function sm_sync_touch('correlation_rule');
create or replace trigger sm_correlation_rules_demo after insert on sm_correlation_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_correlation_rules_demo_t after update or delete on sm_correlation_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_correlation_rules enable row level security;

-- cost_entry: دفتر هزینه
do $cols$
begin
  if to_regclass('sm_cost_entries') is not null then
    alter table sm_cost_entries add column if not exists workspace_id uuid;
    alter table sm_cost_entries add column if not exists domain_id uuid;
    alter table sm_cost_entries add column if not exists unit_id uuid;
    alter table sm_cost_entries add column if not exists created_at timestamptz not null default now();
    alter table sm_cost_entries add column if not exists created_by uuid;
    alter table sm_cost_entries add column if not exists updated_at timestamptz not null default now();
    alter table sm_cost_entries add column if not exists updated_by uuid;
    alter table sm_cost_entries add column if not exists rev bigint not null default 0;
    alter table sm_cost_entries add column if not exists version integer not null default 1;
    alter table sm_cost_entries add column if not exists deleted_at timestamptz;
    alter table sm_cost_entries add column if not exists origin text;
    alter table sm_cost_entries add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cost_entries add column if not exists no integer;
    alter table sm_cost_entries add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CST' || no::text else 'CST' || lpad(no::text, 7, '0') end) stored;
    alter table sm_cost_entries add column if not exists entry_date date;
    alter table sm_cost_entries add column if not exists period_id uuid;
    alter table sm_cost_entries add column if not exists amount numeric;
    alter table sm_cost_entries add column if not exists capex_opex text;
    alter table sm_cost_entries add column if not exists description text;
    alter table sm_cost_entries add column if not exists cost_center_id uuid;
    alter table sm_cost_entries add column if not exists cost_type_id uuid;
    alter table sm_cost_entries add column if not exists source text;
    alter table sm_cost_entries add column if not exists source_table text;
    alter table sm_cost_entries add column if not exists source_id text;
    alter table sm_cost_entries add column if not exists source_key text;
    alter table sm_cost_entries add column if not exists asset_id uuid;
    alter table sm_cost_entries add column if not exists ci_id uuid;
    alter table sm_cost_entries add column if not exists service_id uuid;
    alter table sm_cost_entries add column if not exists supplier_id uuid;
    alter table sm_cost_entries add column if not exists contract_id uuid;
    alter table sm_cost_entries add column if not exists reversal_of uuid;
    alter table sm_cost_entries add column if not exists reversed boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_cost_entries (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CST' || no::text else 'CST' || lpad(no::text, 7, '0') end) stored,
  entry_date date,
  period_id uuid,
  amount numeric,
  capex_opex text,
  description text,
  cost_center_id uuid,
  cost_type_id uuid,
  source text,
  source_table text,
  source_id text,
  source_key text,
  asset_id uuid,
  ci_id uuid,
  service_id uuid,
  supplier_id uuid,
  contract_id uuid,
  reversal_of uuid,
  reversed boolean not null default false,
  search_919a62cc text generated always as (translate(coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cost_entries', 'search_919a62cc', $x$translate(coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cost_entries_search_919a62cc_trgm', 'sm_cost_entries', 'search_919a62cc', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cost_entries_search_custom_trgm', 'sm_cost_entries', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_cost_entries_no_uk on sm_cost_entries (org_id, no);
create index if not exists sm_cost_entries_rev_idx on sm_cost_entries (org_id, rev);
create index if not exists sm_cost_entries_upd_idx on sm_cost_entries (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cost_entries_crt_idx on sm_cost_entries (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cost_entries_entry_date_idx on sm_cost_entries (org_id, entry_date) where deleted_at is null;
create index if not exists sm_cost_entries_period_id_idx on sm_cost_entries (org_id, period_id) where deleted_at is null;
create index if not exists sm_cost_entries_cost_center_id_idx on sm_cost_entries (org_id, cost_center_id) where deleted_at is null;
create index if not exists sm_cost_entries_cost_type_id_idx on sm_cost_entries (org_id, cost_type_id) where deleted_at is null;
create index if not exists sm_cost_entries_source_id_idx on sm_cost_entries (org_id, source_id) where deleted_at is null;
create index if not exists sm_cost_entries_source_key_idx on sm_cost_entries (org_id, source_key) where deleted_at is null;
create index if not exists sm_cost_entries_asset_id_idx on sm_cost_entries (org_id, asset_id) where deleted_at is null;
create index if not exists sm_cost_entries_service_id_idx on sm_cost_entries (org_id, service_id) where deleted_at is null;
create index if not exists sm_cost_entries_supplier_id_idx on sm_cost_entries (org_id, supplier_id) where deleted_at is null;
drop trigger if exists sm_cost_entries_sync on sm_cost_entries;
create trigger sm_cost_entries_sync before insert or update on sm_cost_entries for each row execute function sm_sync_touch('cost_entry');
create or replace trigger sm_cost_entries_demo after insert on sm_cost_entries for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cost_entries_demo_t after update or delete on sm_cost_entries for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cost_entries enable row level security;

-- cost_type: انواع هزینه
do $cols$
begin
  if to_regclass('sm_cost_types') is not null then
    alter table sm_cost_types add column if not exists workspace_id uuid;
    alter table sm_cost_types add column if not exists domain_id uuid;
    alter table sm_cost_types add column if not exists unit_id uuid;
    alter table sm_cost_types add column if not exists created_at timestamptz not null default now();
    alter table sm_cost_types add column if not exists created_by uuid;
    alter table sm_cost_types add column if not exists updated_at timestamptz not null default now();
    alter table sm_cost_types add column if not exists updated_by uuid;
    alter table sm_cost_types add column if not exists rev bigint not null default 0;
    alter table sm_cost_types add column if not exists version integer not null default 1;
    alter table sm_cost_types add column if not exists deleted_at timestamptz;
    alter table sm_cost_types add column if not exists origin text;
    alter table sm_cost_types add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cost_types add column if not exists code text;
    alter table sm_cost_types add column if not exists name text;
    alter table sm_cost_types add column if not exists parent_id uuid;
    alter table sm_cost_types add column if not exists category text;
    alter table sm_cost_types add column if not exists capex_opex text;
    alter table sm_cost_types add column if not exists gl_account text;
    alter table sm_cost_types add column if not exists active boolean not null default true;
    alter table sm_cost_types add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_cost_types (
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
  code text,
  name text,
  parent_id uuid,
  category text,
  capex_opex text,
  gl_account text,
  active boolean not null default true,
  description text
);
create index if not exists sm_cost_types_rev_idx on sm_cost_types (org_id, rev);
create index if not exists sm_cost_types_upd_idx on sm_cost_types (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cost_types_crt_idx on sm_cost_types (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cost_types_code_uk on sm_cost_types (org_id, code) where deleted_at is null;
drop trigger if exists sm_cost_types_sync on sm_cost_types;
create trigger sm_cost_types_sync before insert or update on sm_cost_types for each row execute function sm_sync_touch('cost_type');
create or replace trigger sm_cost_types_demo after insert on sm_cost_types for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cost_types_demo_t after update or delete on sm_cost_types for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cost_types enable row level security;

-- csm_config: تنظیمات خدمات مشتریان
do $cols$
begin
  if to_regclass('sm_csm_config') is not null then
    alter table sm_csm_config add column if not exists workspace_id uuid;
    alter table sm_csm_config add column if not exists domain_id uuid;
    alter table sm_csm_config add column if not exists unit_id uuid;
    alter table sm_csm_config add column if not exists created_at timestamptz not null default now();
    alter table sm_csm_config add column if not exists created_by uuid;
    alter table sm_csm_config add column if not exists updated_at timestamptz not null default now();
    alter table sm_csm_config add column if not exists updated_by uuid;
    alter table sm_csm_config add column if not exists rev bigint not null default 0;
    alter table sm_csm_config add column if not exists version integer not null default 1;
    alter table sm_csm_config add column if not exists deleted_at timestamptz;
    alter table sm_csm_config add column if not exists origin text;
    alter table sm_csm_config add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_csm_config add column if not exists name text;
    alter table sm_csm_config add column if not exists config_key text;
    alter table sm_csm_config add column if not exists auto_close_days integer;
    alter table sm_csm_config add column if not exists proactive_on_major boolean not null default true;
    alter table sm_csm_config add column if not exists health_green integer;
    alter table sm_csm_config add column if not exists health_amber integer;
    alter table sm_csm_config add column if not exists default_group_id uuid;
    alter table sm_csm_config add column if not exists root_unit_id uuid;
    alter table sm_csm_config add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_csm_config (
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
  proactive_on_major boolean not null default true,
  health_green integer,
  health_amber integer,
  default_group_id uuid,
  root_unit_id uuid,
  seeded integer
);
create index if not exists sm_csm_config_rev_idx on sm_csm_config (org_id, rev);
create index if not exists sm_csm_config_upd_idx on sm_csm_config (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_csm_config_crt_idx on sm_csm_config (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_csm_config_config_key_uk on sm_csm_config (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_csm_config_sync on sm_csm_config;
create trigger sm_csm_config_sync before insert or update on sm_csm_config for each row execute function sm_sync_touch('csm_config');
create or replace trigger sm_csm_config_demo after insert on sm_csm_config for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_csm_config_demo_t after update or delete on sm_csm_config for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_csm_config enable row level security;

-- custom_01: جدول سفارشی ۱
do $cols$
begin
  if to_regclass('sm_custom_01') is not null then
    alter table sm_custom_01 add column if not exists workspace_id uuid;
    alter table sm_custom_01 add column if not exists domain_id uuid;
    alter table sm_custom_01 add column if not exists unit_id uuid;
    alter table sm_custom_01 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_01 add column if not exists created_by uuid;
    alter table sm_custom_01 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_01 add column if not exists updated_by uuid;
    alter table sm_custom_01 add column if not exists rev bigint not null default 0;
    alter table sm_custom_01 add column if not exists version integer not null default 1;
    alter table sm_custom_01 add column if not exists deleted_at timestamptz;
    alter table sm_custom_01 add column if not exists origin text;
    alter table sm_custom_01 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_01 add column if not exists no integer;
    alter table sm_custom_01 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT01' || no::text else 'CT01' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_01 add column if not exists title text;
    alter table sm_custom_01 add column if not exists owner_id uuid;
    alter table sm_custom_01 add column if not exists group_id uuid;
    alter table sm_custom_01 add column if not exists description text;
    alter table sm_custom_01 add column if not exists watch_list jsonb;
    alter table sm_custom_01 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_01 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT01' || no::text else 'CT01' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_01', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_01_search_cae18f1d_trgm', 'sm_custom_01', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_01_search_custom_trgm', 'sm_custom_01', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_01_no_uk on sm_custom_01 (org_id, no);
create index if not exists sm_custom_01_rev_idx on sm_custom_01 (org_id, rev);
create index if not exists sm_custom_01_upd_idx on sm_custom_01 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_01_crt_idx on sm_custom_01 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_01_state_idx on sm_custom_01 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_01_workspace_acc_idx on sm_custom_01 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_01_unit_acc_idx on sm_custom_01 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_01_domain_acc_idx on sm_custom_01 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_01_owner_id_idx on sm_custom_01 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_01_sync on sm_custom_01;
create trigger sm_custom_01_sync before insert or update on sm_custom_01 for each row execute function sm_sync_touch('custom_01');
create or replace trigger sm_custom_01_demo after insert on sm_custom_01 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_01_demo_t after update or delete on sm_custom_01 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_01 enable row level security;

-- custom_02: جدول سفارشی ۲
do $cols$
begin
  if to_regclass('sm_custom_02') is not null then
    alter table sm_custom_02 add column if not exists workspace_id uuid;
    alter table sm_custom_02 add column if not exists domain_id uuid;
    alter table sm_custom_02 add column if not exists unit_id uuid;
    alter table sm_custom_02 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_02 add column if not exists created_by uuid;
    alter table sm_custom_02 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_02 add column if not exists updated_by uuid;
    alter table sm_custom_02 add column if not exists rev bigint not null default 0;
    alter table sm_custom_02 add column if not exists version integer not null default 1;
    alter table sm_custom_02 add column if not exists deleted_at timestamptz;
    alter table sm_custom_02 add column if not exists origin text;
    alter table sm_custom_02 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_02 add column if not exists no integer;
    alter table sm_custom_02 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT02' || no::text else 'CT02' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_02 add column if not exists title text;
    alter table sm_custom_02 add column if not exists owner_id uuid;
    alter table sm_custom_02 add column if not exists group_id uuid;
    alter table sm_custom_02 add column if not exists description text;
    alter table sm_custom_02 add column if not exists watch_list jsonb;
    alter table sm_custom_02 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_02 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT02' || no::text else 'CT02' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_02', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_02_search_cae18f1d_trgm', 'sm_custom_02', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_02_search_custom_trgm', 'sm_custom_02', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_02_no_uk on sm_custom_02 (org_id, no);
create index if not exists sm_custom_02_rev_idx on sm_custom_02 (org_id, rev);
create index if not exists sm_custom_02_upd_idx on sm_custom_02 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_02_crt_idx on sm_custom_02 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_02_state_idx on sm_custom_02 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_02_workspace_acc_idx on sm_custom_02 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_02_unit_acc_idx on sm_custom_02 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_02_domain_acc_idx on sm_custom_02 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_02_owner_id_idx on sm_custom_02 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_02_sync on sm_custom_02;
create trigger sm_custom_02_sync before insert or update on sm_custom_02 for each row execute function sm_sync_touch('custom_02');
create or replace trigger sm_custom_02_demo after insert on sm_custom_02 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_02_demo_t after update or delete on sm_custom_02 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_02 enable row level security;

-- custom_03: جدول سفارشی ۳
do $cols$
begin
  if to_regclass('sm_custom_03') is not null then
    alter table sm_custom_03 add column if not exists workspace_id uuid;
    alter table sm_custom_03 add column if not exists domain_id uuid;
    alter table sm_custom_03 add column if not exists unit_id uuid;
    alter table sm_custom_03 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_03 add column if not exists created_by uuid;
    alter table sm_custom_03 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_03 add column if not exists updated_by uuid;
    alter table sm_custom_03 add column if not exists rev bigint not null default 0;
    alter table sm_custom_03 add column if not exists version integer not null default 1;
    alter table sm_custom_03 add column if not exists deleted_at timestamptz;
    alter table sm_custom_03 add column if not exists origin text;
    alter table sm_custom_03 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_03 add column if not exists no integer;
    alter table sm_custom_03 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT03' || no::text else 'CT03' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_03 add column if not exists title text;
    alter table sm_custom_03 add column if not exists owner_id uuid;
    alter table sm_custom_03 add column if not exists group_id uuid;
    alter table sm_custom_03 add column if not exists description text;
    alter table sm_custom_03 add column if not exists watch_list jsonb;
    alter table sm_custom_03 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_03 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT03' || no::text else 'CT03' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_03', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_03_search_cae18f1d_trgm', 'sm_custom_03', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_03_search_custom_trgm', 'sm_custom_03', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_03_no_uk on sm_custom_03 (org_id, no);
create index if not exists sm_custom_03_rev_idx on sm_custom_03 (org_id, rev);
create index if not exists sm_custom_03_upd_idx on sm_custom_03 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_03_crt_idx on sm_custom_03 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_03_state_idx on sm_custom_03 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_03_workspace_acc_idx on sm_custom_03 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_03_unit_acc_idx on sm_custom_03 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_03_domain_acc_idx on sm_custom_03 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_03_owner_id_idx on sm_custom_03 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_03_sync on sm_custom_03;
create trigger sm_custom_03_sync before insert or update on sm_custom_03 for each row execute function sm_sync_touch('custom_03');
create or replace trigger sm_custom_03_demo after insert on sm_custom_03 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_03_demo_t after update or delete on sm_custom_03 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_03 enable row level security;

-- custom_04: جدول سفارشی ۴
do $cols$
begin
  if to_regclass('sm_custom_04') is not null then
    alter table sm_custom_04 add column if not exists workspace_id uuid;
    alter table sm_custom_04 add column if not exists domain_id uuid;
    alter table sm_custom_04 add column if not exists unit_id uuid;
    alter table sm_custom_04 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_04 add column if not exists created_by uuid;
    alter table sm_custom_04 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_04 add column if not exists updated_by uuid;
    alter table sm_custom_04 add column if not exists rev bigint not null default 0;
    alter table sm_custom_04 add column if not exists version integer not null default 1;
    alter table sm_custom_04 add column if not exists deleted_at timestamptz;
    alter table sm_custom_04 add column if not exists origin text;
    alter table sm_custom_04 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_04 add column if not exists no integer;
    alter table sm_custom_04 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT04' || no::text else 'CT04' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_04 add column if not exists title text;
    alter table sm_custom_04 add column if not exists owner_id uuid;
    alter table sm_custom_04 add column if not exists group_id uuid;
    alter table sm_custom_04 add column if not exists description text;
    alter table sm_custom_04 add column if not exists watch_list jsonb;
    alter table sm_custom_04 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_04 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT04' || no::text else 'CT04' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_04', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_04_search_cae18f1d_trgm', 'sm_custom_04', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_04_search_custom_trgm', 'sm_custom_04', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_04_no_uk on sm_custom_04 (org_id, no);
create index if not exists sm_custom_04_rev_idx on sm_custom_04 (org_id, rev);
create index if not exists sm_custom_04_upd_idx on sm_custom_04 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_04_crt_idx on sm_custom_04 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_04_state_idx on sm_custom_04 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_04_workspace_acc_idx on sm_custom_04 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_04_unit_acc_idx on sm_custom_04 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_04_domain_acc_idx on sm_custom_04 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_04_owner_id_idx on sm_custom_04 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_04_sync on sm_custom_04;
create trigger sm_custom_04_sync before insert or update on sm_custom_04 for each row execute function sm_sync_touch('custom_04');
create or replace trigger sm_custom_04_demo after insert on sm_custom_04 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_04_demo_t after update or delete on sm_custom_04 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_04 enable row level security;

-- custom_05: جدول سفارشی ۵
do $cols$
begin
  if to_regclass('sm_custom_05') is not null then
    alter table sm_custom_05 add column if not exists workspace_id uuid;
    alter table sm_custom_05 add column if not exists domain_id uuid;
    alter table sm_custom_05 add column if not exists unit_id uuid;
    alter table sm_custom_05 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_05 add column if not exists created_by uuid;
    alter table sm_custom_05 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_05 add column if not exists updated_by uuid;
    alter table sm_custom_05 add column if not exists rev bigint not null default 0;
    alter table sm_custom_05 add column if not exists version integer not null default 1;
    alter table sm_custom_05 add column if not exists deleted_at timestamptz;
    alter table sm_custom_05 add column if not exists origin text;
    alter table sm_custom_05 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_05 add column if not exists no integer;
    alter table sm_custom_05 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT05' || no::text else 'CT05' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_05 add column if not exists title text;
    alter table sm_custom_05 add column if not exists owner_id uuid;
    alter table sm_custom_05 add column if not exists group_id uuid;
    alter table sm_custom_05 add column if not exists description text;
    alter table sm_custom_05 add column if not exists watch_list jsonb;
    alter table sm_custom_05 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_05 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT05' || no::text else 'CT05' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_05', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_05_search_cae18f1d_trgm', 'sm_custom_05', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_05_search_custom_trgm', 'sm_custom_05', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_05_no_uk on sm_custom_05 (org_id, no);
create index if not exists sm_custom_05_rev_idx on sm_custom_05 (org_id, rev);
create index if not exists sm_custom_05_upd_idx on sm_custom_05 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_05_crt_idx on sm_custom_05 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_05_state_idx on sm_custom_05 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_05_workspace_acc_idx on sm_custom_05 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_05_unit_acc_idx on sm_custom_05 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_05_domain_acc_idx on sm_custom_05 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_05_owner_id_idx on sm_custom_05 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_05_sync on sm_custom_05;
create trigger sm_custom_05_sync before insert or update on sm_custom_05 for each row execute function sm_sync_touch('custom_05');
create or replace trigger sm_custom_05_demo after insert on sm_custom_05 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_05_demo_t after update or delete on sm_custom_05 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_05 enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:6', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:%') >= 28 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۸ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 8/28 (e746bd22eb04)
-- custom_06: جدول سفارشی ۶
do $cols$
begin
  if to_regclass('sm_custom_06') is not null then
    alter table sm_custom_06 add column if not exists workspace_id uuid;
    alter table sm_custom_06 add column if not exists domain_id uuid;
    alter table sm_custom_06 add column if not exists unit_id uuid;
    alter table sm_custom_06 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_06 add column if not exists created_by uuid;
    alter table sm_custom_06 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_06 add column if not exists updated_by uuid;
    alter table sm_custom_06 add column if not exists rev bigint not null default 0;
    alter table sm_custom_06 add column if not exists version integer not null default 1;
    alter table sm_custom_06 add column if not exists deleted_at timestamptz;
    alter table sm_custom_06 add column if not exists origin text;
    alter table sm_custom_06 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_06 add column if not exists no integer;
    alter table sm_custom_06 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT06' || no::text else 'CT06' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_06 add column if not exists title text;
    alter table sm_custom_06 add column if not exists owner_id uuid;
    alter table sm_custom_06 add column if not exists group_id uuid;
    alter table sm_custom_06 add column if not exists description text;
    alter table sm_custom_06 add column if not exists watch_list jsonb;
    alter table sm_custom_06 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_06 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT06' || no::text else 'CT06' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_06', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_06_search_cae18f1d_trgm', 'sm_custom_06', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_06_search_custom_trgm', 'sm_custom_06', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_06_no_uk on sm_custom_06 (org_id, no);
create index if not exists sm_custom_06_rev_idx on sm_custom_06 (org_id, rev);
create index if not exists sm_custom_06_upd_idx on sm_custom_06 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_06_crt_idx on sm_custom_06 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_06_state_idx on sm_custom_06 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_06_workspace_acc_idx on sm_custom_06 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_06_unit_acc_idx on sm_custom_06 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_06_domain_acc_idx on sm_custom_06 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_06_owner_id_idx on sm_custom_06 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_06_sync on sm_custom_06;
create trigger sm_custom_06_sync before insert or update on sm_custom_06 for each row execute function sm_sync_touch('custom_06');
create or replace trigger sm_custom_06_demo after insert on sm_custom_06 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_06_demo_t after update or delete on sm_custom_06 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_06 enable row level security;

-- custom_07: جدول سفارشی ۷
do $cols$
begin
  if to_regclass('sm_custom_07') is not null then
    alter table sm_custom_07 add column if not exists workspace_id uuid;
    alter table sm_custom_07 add column if not exists domain_id uuid;
    alter table sm_custom_07 add column if not exists unit_id uuid;
    alter table sm_custom_07 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_07 add column if not exists created_by uuid;
    alter table sm_custom_07 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_07 add column if not exists updated_by uuid;
    alter table sm_custom_07 add column if not exists rev bigint not null default 0;
    alter table sm_custom_07 add column if not exists version integer not null default 1;
    alter table sm_custom_07 add column if not exists deleted_at timestamptz;
    alter table sm_custom_07 add column if not exists origin text;
    alter table sm_custom_07 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_07 add column if not exists no integer;
    alter table sm_custom_07 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT07' || no::text else 'CT07' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_07 add column if not exists title text;
    alter table sm_custom_07 add column if not exists owner_id uuid;
    alter table sm_custom_07 add column if not exists group_id uuid;
    alter table sm_custom_07 add column if not exists description text;
    alter table sm_custom_07 add column if not exists watch_list jsonb;
    alter table sm_custom_07 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_07 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT07' || no::text else 'CT07' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_07', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_07_search_cae18f1d_trgm', 'sm_custom_07', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_07_search_custom_trgm', 'sm_custom_07', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_07_no_uk on sm_custom_07 (org_id, no);
create index if not exists sm_custom_07_rev_idx on sm_custom_07 (org_id, rev);
create index if not exists sm_custom_07_upd_idx on sm_custom_07 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_07_crt_idx on sm_custom_07 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_07_state_idx on sm_custom_07 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_07_workspace_acc_idx on sm_custom_07 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_07_unit_acc_idx on sm_custom_07 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_07_domain_acc_idx on sm_custom_07 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_07_owner_id_idx on sm_custom_07 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_07_sync on sm_custom_07;
create trigger sm_custom_07_sync before insert or update on sm_custom_07 for each row execute function sm_sync_touch('custom_07');
create or replace trigger sm_custom_07_demo after insert on sm_custom_07 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_07_demo_t after update or delete on sm_custom_07 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_07 enable row level security;

-- custom_08: جدول سفارشی ۸
do $cols$
begin
  if to_regclass('sm_custom_08') is not null then
    alter table sm_custom_08 add column if not exists workspace_id uuid;
    alter table sm_custom_08 add column if not exists domain_id uuid;
    alter table sm_custom_08 add column if not exists unit_id uuid;
    alter table sm_custom_08 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_08 add column if not exists created_by uuid;
    alter table sm_custom_08 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_08 add column if not exists updated_by uuid;
    alter table sm_custom_08 add column if not exists rev bigint not null default 0;
    alter table sm_custom_08 add column if not exists version integer not null default 1;
    alter table sm_custom_08 add column if not exists deleted_at timestamptz;
    alter table sm_custom_08 add column if not exists origin text;
    alter table sm_custom_08 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_08 add column if not exists no integer;
    alter table sm_custom_08 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT08' || no::text else 'CT08' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_08 add column if not exists title text;
    alter table sm_custom_08 add column if not exists owner_id uuid;
    alter table sm_custom_08 add column if not exists group_id uuid;
    alter table sm_custom_08 add column if not exists description text;
    alter table sm_custom_08 add column if not exists watch_list jsonb;
    alter table sm_custom_08 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_08 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT08' || no::text else 'CT08' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_08', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_08_search_cae18f1d_trgm', 'sm_custom_08', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_08_search_custom_trgm', 'sm_custom_08', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_08_no_uk on sm_custom_08 (org_id, no);
create index if not exists sm_custom_08_rev_idx on sm_custom_08 (org_id, rev);
create index if not exists sm_custom_08_upd_idx on sm_custom_08 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_08_crt_idx on sm_custom_08 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_08_state_idx on sm_custom_08 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_08_workspace_acc_idx on sm_custom_08 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_08_unit_acc_idx on sm_custom_08 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_08_domain_acc_idx on sm_custom_08 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_08_owner_id_idx on sm_custom_08 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_08_sync on sm_custom_08;
create trigger sm_custom_08_sync before insert or update on sm_custom_08 for each row execute function sm_sync_touch('custom_08');
create or replace trigger sm_custom_08_demo after insert on sm_custom_08 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_08_demo_t after update or delete on sm_custom_08 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_08 enable row level security;

-- custom_09: جدول سفارشی ۹
do $cols$
begin
  if to_regclass('sm_custom_09') is not null then
    alter table sm_custom_09 add column if not exists workspace_id uuid;
    alter table sm_custom_09 add column if not exists domain_id uuid;
    alter table sm_custom_09 add column if not exists unit_id uuid;
    alter table sm_custom_09 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_09 add column if not exists created_by uuid;
    alter table sm_custom_09 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_09 add column if not exists updated_by uuid;
    alter table sm_custom_09 add column if not exists rev bigint not null default 0;
    alter table sm_custom_09 add column if not exists version integer not null default 1;
    alter table sm_custom_09 add column if not exists deleted_at timestamptz;
    alter table sm_custom_09 add column if not exists origin text;
    alter table sm_custom_09 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_09 add column if not exists no integer;
    alter table sm_custom_09 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT09' || no::text else 'CT09' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_09 add column if not exists title text;
    alter table sm_custom_09 add column if not exists owner_id uuid;
    alter table sm_custom_09 add column if not exists group_id uuid;
    alter table sm_custom_09 add column if not exists description text;
    alter table sm_custom_09 add column if not exists watch_list jsonb;
    alter table sm_custom_09 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_09 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT09' || no::text else 'CT09' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_09', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_09_search_cae18f1d_trgm', 'sm_custom_09', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_09_search_custom_trgm', 'sm_custom_09', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_09_no_uk on sm_custom_09 (org_id, no);
create index if not exists sm_custom_09_rev_idx on sm_custom_09 (org_id, rev);
create index if not exists sm_custom_09_upd_idx on sm_custom_09 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_09_crt_idx on sm_custom_09 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_09_state_idx on sm_custom_09 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_09_workspace_acc_idx on sm_custom_09 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_09_unit_acc_idx on sm_custom_09 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_09_domain_acc_idx on sm_custom_09 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_09_owner_id_idx on sm_custom_09 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_09_sync on sm_custom_09;
create trigger sm_custom_09_sync before insert or update on sm_custom_09 for each row execute function sm_sync_touch('custom_09');
create or replace trigger sm_custom_09_demo after insert on sm_custom_09 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_09_demo_t after update or delete on sm_custom_09 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_09 enable row level security;

-- custom_10: جدول سفارشی ۱۰
do $cols$
begin
  if to_regclass('sm_custom_10') is not null then
    alter table sm_custom_10 add column if not exists workspace_id uuid;
    alter table sm_custom_10 add column if not exists domain_id uuid;
    alter table sm_custom_10 add column if not exists unit_id uuid;
    alter table sm_custom_10 add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_10 add column if not exists created_by uuid;
    alter table sm_custom_10 add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_10 add column if not exists updated_by uuid;
    alter table sm_custom_10 add column if not exists rev bigint not null default 0;
    alter table sm_custom_10 add column if not exists version integer not null default 1;
    alter table sm_custom_10 add column if not exists deleted_at timestamptz;
    alter table sm_custom_10 add column if not exists origin text;
    alter table sm_custom_10 add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_10 add column if not exists no integer;
    alter table sm_custom_10 add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT10' || no::text else 'CT10' || lpad(no::text, 6, '0') end) stored;
    alter table sm_custom_10 add column if not exists title text;
    alter table sm_custom_10 add column if not exists owner_id uuid;
    alter table sm_custom_10 add column if not exists group_id uuid;
    alter table sm_custom_10 add column if not exists description text;
    alter table sm_custom_10 add column if not exists watch_list jsonb;
    alter table sm_custom_10 add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_custom_10 (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CT10' || no::text else 'CT10' || lpad(no::text, 6, '0') end) stored,
  title text,
  owner_id uuid,
  group_id uuid,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_custom_10', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_custom_10_search_cae18f1d_trgm', 'sm_custom_10', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_custom_10_search_custom_trgm', 'sm_custom_10', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_custom_10_no_uk on sm_custom_10 (org_id, no);
create index if not exists sm_custom_10_rev_idx on sm_custom_10 (org_id, rev);
create index if not exists sm_custom_10_upd_idx on sm_custom_10 (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_10_crt_idx on sm_custom_10 (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_10_state_idx on sm_custom_10 (org_id, state) where deleted_at is null;
create index if not exists sm_custom_10_workspace_acc_idx on sm_custom_10 (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_custom_10_unit_acc_idx on sm_custom_10 (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_custom_10_domain_acc_idx on sm_custom_10 (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_custom_10_owner_id_idx on sm_custom_10 (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_custom_10_sync on sm_custom_10;
create trigger sm_custom_10_sync before insert or update on sm_custom_10 for each row execute function sm_sync_touch('custom_10');
create or replace trigger sm_custom_10_demo after insert on sm_custom_10 for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_10_demo_t after update or delete on sm_custom_10 for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_10 enable row level security;

-- custom_field: فیلدهای سفارشی
do $cols$
begin
  if to_regclass('sm_custom_fields') is not null then
    alter table sm_custom_fields add column if not exists workspace_id uuid;
    alter table sm_custom_fields add column if not exists domain_id uuid;
    alter table sm_custom_fields add column if not exists unit_id uuid;
    alter table sm_custom_fields add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_fields add column if not exists created_by uuid;
    alter table sm_custom_fields add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_fields add column if not exists updated_by uuid;
    alter table sm_custom_fields add column if not exists rev bigint not null default 0;
    alter table sm_custom_fields add column if not exists version integer not null default 1;
    alter table sm_custom_fields add column if not exists deleted_at timestamptz;
    alter table sm_custom_fields add column if not exists origin text;
    alter table sm_custom_fields add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_fields add column if not exists table_key text;
    alter table sm_custom_fields add column if not exists name text;
    alter table sm_custom_fields add column if not exists label text;
    alter table sm_custom_fields add column if not exists type text;
    alter table sm_custom_fields add column if not exists choices text;
    alter table sm_custom_fields add column if not exists options jsonb;
    alter table sm_custom_fields add column if not exists ref text;
    alter table sm_custom_fields add column if not exists required boolean not null default false;
    alter table sm_custom_fields add column if not exists list boolean not null default false;
    alter table sm_custom_fields add column if not exists search boolean not null default false;
    alter table sm_custom_fields add column if not exists filter boolean not null default false;
    alter table sm_custom_fields add column if not exists help text;
    alter table sm_custom_fields add column if not exists field_group text;
    alter table sm_custom_fields add column if not exists section text;
    alter table sm_custom_fields add column if not exists max_length integer;
    alter table sm_custom_fields add column if not exists sort_order integer;
    alter table sm_custom_fields add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_custom_fields (
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
  table_key text,
  name text,
  label text,
  type text,
  choices text,
  options jsonb,
  ref text,
  required boolean not null default false,
  list boolean not null default false,
  search boolean not null default false,
  filter boolean not null default false,
  help text,
  field_group text,
  section text,
  max_length integer,
  sort_order integer,
  active boolean not null default true
);
create index if not exists sm_custom_fields_rev_idx on sm_custom_fields (org_id, rev);
create index if not exists sm_custom_fields_upd_idx on sm_custom_fields (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_fields_crt_idx on sm_custom_fields (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_custom_fields_table_key_name_uk on sm_custom_fields (org_id, table_key, name) where deleted_at is null;
drop trigger if exists sm_custom_fields_sync on sm_custom_fields;
create trigger sm_custom_fields_sync before insert or update on sm_custom_fields for each row execute function sm_sync_touch('custom_field');
create or replace trigger sm_custom_fields_demo after insert on sm_custom_fields for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_fields_demo_t after update or delete on sm_custom_fields for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_fields enable row level security;

-- custom_table: جدول‌های سفارشی
do $cols$
begin
  if to_regclass('sm_custom_tables') is not null then
    alter table sm_custom_tables add column if not exists workspace_id uuid;
    alter table sm_custom_tables add column if not exists domain_id uuid;
    alter table sm_custom_tables add column if not exists unit_id uuid;
    alter table sm_custom_tables add column if not exists created_at timestamptz not null default now();
    alter table sm_custom_tables add column if not exists created_by uuid;
    alter table sm_custom_tables add column if not exists updated_at timestamptz not null default now();
    alter table sm_custom_tables add column if not exists updated_by uuid;
    alter table sm_custom_tables add column if not exists rev bigint not null default 0;
    alter table sm_custom_tables add column if not exists version integer not null default 1;
    alter table sm_custom_tables add column if not exists deleted_at timestamptz;
    alter table sm_custom_tables add column if not exists origin text;
    alter table sm_custom_tables add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_custom_tables add column if not exists label text;
    alter table sm_custom_tables add column if not exists plural text;
    alter table sm_custom_tables add column if not exists code text;
    alter table sm_custom_tables add column if not exists slot text;
    alter table sm_custom_tables add column if not exists icon text;
    alter table sm_custom_tables add column if not exists active boolean not null default true;
    alter table sm_custom_tables add column if not exists description text;
    alter table sm_custom_tables add column if not exists revision integer;
    alter table sm_custom_tables add column if not exists published_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_custom_tables (
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
  label text,
  plural text,
  code text,
  slot text,
  icon text,
  active boolean not null default true,
  description text,
  revision integer,
  published_at timestamptz
);
create index if not exists sm_custom_tables_rev_idx on sm_custom_tables (org_id, rev);
create index if not exists sm_custom_tables_upd_idx on sm_custom_tables (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_tables_crt_idx on sm_custom_tables (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_custom_tables_slot_uk on sm_custom_tables (org_id, slot) where deleted_at is null;
create unique index if not exists sm_custom_tables_code_uk on sm_custom_tables (org_id, code) where deleted_at is null;
drop trigger if exists sm_custom_tables_sync on sm_custom_tables;
create trigger sm_custom_tables_sync before insert or update on sm_custom_tables for each row execute function sm_sync_touch('custom_table');
create or replace trigger sm_custom_tables_demo after insert on sm_custom_tables for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_custom_tables_demo_t after update or delete on sm_custom_tables for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_custom_tables enable row level security;

-- customer_account: حساب‌های مشتری
do $cols$
begin
  if to_regclass('sm_customer_accounts') is not null then
    alter table sm_customer_accounts add column if not exists workspace_id uuid;
    alter table sm_customer_accounts add column if not exists domain_id uuid;
    alter table sm_customer_accounts add column if not exists unit_id uuid;
    alter table sm_customer_accounts add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_accounts add column if not exists created_by uuid;
    alter table sm_customer_accounts add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_accounts add column if not exists updated_by uuid;
    alter table sm_customer_accounts add column if not exists rev bigint not null default 0;
    alter table sm_customer_accounts add column if not exists version integer not null default 1;
    alter table sm_customer_accounts add column if not exists deleted_at timestamptz;
    alter table sm_customer_accounts add column if not exists origin text;
    alter table sm_customer_accounts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_accounts add column if not exists name text;
    alter table sm_customer_accounts add column if not exists code text;
    alter table sm_customer_accounts add column if not exists kind text;
    alter table sm_customer_accounts add column if not exists parent_id uuid;
    alter table sm_customer_accounts add column if not exists org_unit_id uuid;
    alter table sm_customer_accounts add column if not exists segment text;
    alter table sm_customer_accounts add column if not exists tier text;
    alter table sm_customer_accounts add column if not exists relationship_type text;
    alter table sm_customer_accounts add column if not exists email_domain text;
    alter table sm_customer_accounts add column if not exists phone text;
    alter table sm_customer_accounts add column if not exists website text;
    alter table sm_customer_accounts add column if not exists city text;
    alter table sm_customer_accounts add column if not exists address text;
    alter table sm_customer_accounts add column if not exists active boolean not null default true;
    alter table sm_customer_accounts add column if not exists relationship_manager_id uuid;
    alter table sm_customer_accounts add column if not exists service_delivery_manager_id uuid;
    alter table sm_customer_accounts add column if not exists technical_account_manager_id uuid;
    alter table sm_customer_accounts add column if not exists support_group_id uuid;
    alter table sm_customer_accounts add column if not exists health_score integer;
    alter table sm_customer_accounts add column if not exists health_status text;
    alter table sm_customer_accounts add column if not exists churn_risk text;
    alter table sm_customer_accounts add column if not exists health_factors jsonb;
    alter table sm_customer_accounts add column if not exists health_at timestamptz;
    alter table sm_customer_accounts add column if not exists open_cases integer;
    alter table sm_customer_accounts add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_customer_accounts (
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
  code text,
  kind text,
  parent_id uuid,
  org_unit_id uuid,
  segment text,
  tier text,
  relationship_type text,
  email_domain text,
  phone text,
  website text,
  city text,
  address text,
  active boolean not null default true,
  relationship_manager_id uuid,
  service_delivery_manager_id uuid,
  technical_account_manager_id uuid,
  support_group_id uuid,
  health_score integer,
  health_status text,
  churn_risk text,
  health_factors jsonb,
  health_at timestamptz,
  open_cases integer,
  notes text
);
create index if not exists sm_customer_accounts_rev_idx on sm_customer_accounts (org_id, rev);
create index if not exists sm_customer_accounts_upd_idx on sm_customer_accounts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_accounts_crt_idx on sm_customer_accounts (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_customer_accounts_code_uk on sm_customer_accounts (org_id, code) where deleted_at is null;
create index if not exists sm_customer_accounts_parent_id_idx on sm_customer_accounts (org_id, parent_id) where deleted_at is null;
create index if not exists sm_customer_accounts_relationship_manager_id_idx on sm_customer_accounts (org_id, relationship_manager_id) where deleted_at is null;
create index if not exists sm_customer_accounts_service_delivery_manager_id_idx on sm_customer_accounts (org_id, service_delivery_manager_id) where deleted_at is null;
create index if not exists sm_customer_accounts_technical_account_manager_id_idx on sm_customer_accounts (org_id, technical_account_manager_id) where deleted_at is null;
create index if not exists sm_customer_accounts_support_group_id_idx on sm_customer_accounts (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_customer_accounts_workspace_acc_idx on sm_customer_accounts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_accounts_unit_acc_idx on sm_customer_accounts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_accounts_domain_acc_idx on sm_customer_accounts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_accounts_open_grp_idx on sm_customer_accounts (org_id, support_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_customer_accounts_sync on sm_customer_accounts;
create trigger sm_customer_accounts_sync before insert or update on sm_customer_accounts for each row execute function sm_sync_touch('customer_account');
create or replace trigger sm_customer_accounts_demo after insert on sm_customer_accounts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_accounts_demo_t after update or delete on sm_customer_accounts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_accounts enable row level security;

-- customer_case: پرونده‌های مشتری
do $cols$
begin
  if to_regclass('sm_customer_cases') is not null then
    alter table sm_customer_cases add column if not exists workspace_id uuid;
    alter table sm_customer_cases add column if not exists domain_id uuid;
    alter table sm_customer_cases add column if not exists unit_id uuid;
    alter table sm_customer_cases add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_cases add column if not exists created_by uuid;
    alter table sm_customer_cases add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_cases add column if not exists updated_by uuid;
    alter table sm_customer_cases add column if not exists rev bigint not null default 0;
    alter table sm_customer_cases add column if not exists version integer not null default 1;
    alter table sm_customer_cases add column if not exists deleted_at timestamptz;
    alter table sm_customer_cases add column if not exists origin text;
    alter table sm_customer_cases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_cases add column if not exists no integer;
    alter table sm_customer_cases add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CS' || no::text else 'CS' || lpad(no::text, 7, '0') end) stored;
    alter table sm_customer_cases add column if not exists short_description text;
    alter table sm_customer_cases add column if not exists description text;
    alter table sm_customer_cases add column if not exists state text;
    alter table sm_customer_cases add column if not exists priority text;
    alter table sm_customer_cases add column if not exists impact text;
    alter table sm_customer_cases add column if not exists urgency text;
    alter table sm_customer_cases add column if not exists category text;
    alter table sm_customer_cases add column if not exists subcategory text;
    alter table sm_customer_cases add column if not exists channel text;
    alter table sm_customer_cases add column if not exists caller_id uuid;
    alter table sm_customer_cases add column if not exists requested_for uuid;
    alter table sm_customer_cases add column if not exists opened_by uuid;
    alter table sm_customer_cases add column if not exists opened_at timestamptz;
    alter table sm_customer_cases add column if not exists assignment_group_id uuid;
    alter table sm_customer_cases add column if not exists assigned_to uuid;
    alter table sm_customer_cases add column if not exists service_id uuid;
    alter table sm_customer_cases add column if not exists offering_id uuid;
    alter table sm_customer_cases add column if not exists ci_id uuid;
    alter table sm_customer_cases add column if not exists location_id uuid;
    alter table sm_customer_cases add column if not exists due_at timestamptz;
    alter table sm_customer_cases add column if not exists resolved_at timestamptz;
    alter table sm_customer_cases add column if not exists resolved_by uuid;
    alter table sm_customer_cases add column if not exists closed_at timestamptz;
    alter table sm_customer_cases add column if not exists closed_by uuid;
    alter table sm_customer_cases add column if not exists close_code text;
    alter table sm_customer_cases add column if not exists close_notes text;
    alter table sm_customer_cases add column if not exists parent_id uuid;
    alter table sm_customer_cases add column if not exists watch_list jsonb;
    alter table sm_customer_cases add column if not exists approval text;
    alter table sm_customer_cases add column if not exists escalation integer;
    alter table sm_customer_cases add column if not exists reassignment_count integer;
    alter table sm_customer_cases add column if not exists reopen_count integer;
    alter table sm_customer_cases add column if not exists time_worked bigint;
    alter table sm_customer_cases add column if not exists first_response_at timestamptz;
    alter table sm_customer_cases add column if not exists active boolean not null default true;
    alter table sm_customer_cases add column if not exists sla_due timestamptz;
    alter table sm_customer_cases add column if not exists knowledge boolean not null default false;
    alter table sm_customer_cases add column if not exists case_type text;
    alter table sm_customer_cases add column if not exists account_id uuid;
    alter table sm_customer_cases add column if not exists contact_id uuid;
    alter table sm_customer_cases add column if not exists product_id uuid;
    alter table sm_customer_cases add column if not exists ibi_id uuid;
    alter table sm_customer_cases add column if not exists entitlement_id uuid;
    alter table sm_customer_cases add column if not exists contract_id uuid;
    alter table sm_customer_cases add column if not exists entitlement_status text;
    alter table sm_customer_cases add column if not exists entitlement_snapshot jsonb;
    alter table sm_customer_cases add column if not exists support_level text;
    alter table sm_customer_cases add column if not exists complaint boolean not null default false;
    alter table sm_customer_cases add column if not exists complaint_severity text;
    alter table sm_customer_cases add column if not exists is_major boolean not null default false;
    alter table sm_customer_cases add column if not exists major_case_id uuid;
    alter table sm_customer_cases add column if not exists proactive boolean not null default false;
    alter table sm_customer_cases add column if not exists customer_status text;
    alter table sm_customer_cases add column if not exists sentiment text;
    alter table sm_customer_cases add column if not exists escalated boolean not null default false;
    alter table sm_customer_cases add column if not exists root_cause text;
    alter table sm_customer_cases add column if not exists resolution_accepted boolean not null default false;
    alter table sm_customer_cases add column if not exists satisfaction integer;
    alter table sm_customer_cases add column if not exists units_charged numeric;
  end if;
end
$cols$;
create table if not exists sm_customer_cases (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CS' || no::text else 'CS' || lpad(no::text, 7, '0') end) stored,
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
  case_type text,
  account_id uuid,
  contact_id uuid,
  product_id uuid,
  ibi_id uuid,
  entitlement_id uuid,
  contract_id uuid,
  entitlement_status text,
  entitlement_snapshot jsonb,
  support_level text,
  complaint boolean not null default false,
  complaint_severity text,
  is_major boolean not null default false,
  major_case_id uuid,
  proactive boolean not null default false,
  customer_status text,
  sentiment text,
  escalated boolean not null default false,
  root_cause text,
  resolution_accepted boolean not null default false,
  satisfaction integer,
  units_charged numeric,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_customer_cases', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_customer_cases_search_f3bce210_trgm', 'sm_customer_cases', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_customer_cases_search_custom_trgm', 'sm_customer_cases', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_customer_cases_no_uk on sm_customer_cases (org_id, no);
create index if not exists sm_customer_cases_rev_idx on sm_customer_cases (org_id, rev);
create index if not exists sm_customer_cases_upd_idx on sm_customer_cases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_cases_crt_idx on sm_customer_cases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_cases_state_idx on sm_customer_cases (org_id, state) where deleted_at is null;
create index if not exists sm_customer_cases_assignment_group_id_idx on sm_customer_cases (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_customer_cases_assigned_to_idx on sm_customer_cases (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_customer_cases_account_id_idx on sm_customer_cases (org_id, account_id) where deleted_at is null;
create index if not exists sm_customer_cases_contact_id_idx on sm_customer_cases (org_id, contact_id) where deleted_at is null;
create index if not exists sm_customer_cases_product_id_idx on sm_customer_cases (org_id, product_id) where deleted_at is null;
create index if not exists sm_customer_cases_entitlement_id_idx on sm_customer_cases (org_id, entitlement_id) where deleted_at is null;
create index if not exists sm_customer_cases_major_case_id_idx on sm_customer_cases (org_id, major_case_id) where deleted_at is null;
create index if not exists sm_customer_cases_workspace_acc_idx on sm_customer_cases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_cases_unit_acc_idx on sm_customer_cases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_cases_domain_acc_idx on sm_customer_cases (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_cases_caller_id_idx on sm_customer_cases (org_id, caller_id) where deleted_at is null;
create index if not exists sm_customer_cases_requested_for_idx on sm_customer_cases (org_id, requested_for) where deleted_at is null;
create index if not exists sm_customer_cases_opened_by_idx on sm_customer_cases (org_id, opened_by) where deleted_at is null;
create index if not exists sm_customer_cases_watch_list_gin on sm_customer_cases using gin (watch_list);
create index if not exists sm_customer_cases_open_grp_idx on sm_customer_cases (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_customer_cases_opened_brin on sm_customer_cases using brin (opened_at);
drop trigger if exists sm_customer_cases_sync on sm_customer_cases;
create trigger sm_customer_cases_sync before insert or update on sm_customer_cases for each row execute function sm_sync_touch('customer_case');
create or replace trigger sm_customer_cases_demo after insert on sm_customer_cases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_cases_demo_t after update or delete on sm_customer_cases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_cases enable row level security;

-- customer_contact: مخاطبان مشتری
do $cols$
begin
  if to_regclass('sm_customer_contacts') is not null then
    alter table sm_customer_contacts add column if not exists workspace_id uuid;
    alter table sm_customer_contacts add column if not exists domain_id uuid;
    alter table sm_customer_contacts add column if not exists unit_id uuid;
    alter table sm_customer_contacts add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_contacts add column if not exists created_by uuid;
    alter table sm_customer_contacts add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_contacts add column if not exists updated_by uuid;
    alter table sm_customer_contacts add column if not exists rev bigint not null default 0;
    alter table sm_customer_contacts add column if not exists version integer not null default 1;
    alter table sm_customer_contacts add column if not exists deleted_at timestamptz;
    alter table sm_customer_contacts add column if not exists origin text;
    alter table sm_customer_contacts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_contacts add column if not exists name text;
    alter table sm_customer_contacts add column if not exists account_id uuid;
    alter table sm_customer_contacts add column if not exists user_id uuid;
    alter table sm_customer_contacts add column if not exists email text;
    alter table sm_customer_contacts add column if not exists phone text;
    alter table sm_customer_contacts add column if not exists job_title text;
    alter table sm_customer_contacts add column if not exists roles jsonb;
    alter table sm_customer_contacts add column if not exists is_primary boolean not null default false;
    alter table sm_customer_contacts add column if not exists preferred_channel text;
    alter table sm_customer_contacts add column if not exists language text;
    alter table sm_customer_contacts add column if not exists other_accounts jsonb;
    alter table sm_customer_contacts add column if not exists active boolean not null default true;
    alter table sm_customer_contacts add column if not exists notes text;
    alter table sm_customer_contacts add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_customer_contacts (
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
  account_id uuid,
  user_id uuid,
  email text,
  phone text,
  job_title text,
  roles jsonb,
  is_primary boolean not null default false,
  preferred_channel text,
  language text,
  other_accounts jsonb,
  active boolean not null default true,
  notes text,
  support_group_id uuid
);
create index if not exists sm_customer_contacts_rev_idx on sm_customer_contacts (org_id, rev);
create index if not exists sm_customer_contacts_upd_idx on sm_customer_contacts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_contacts_crt_idx on sm_customer_contacts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_contacts_account_id_idx on sm_customer_contacts (org_id, account_id) where deleted_at is null;
create unique index if not exists sm_customer_contacts_user_id_uk on sm_customer_contacts (org_id, user_id) where deleted_at is null;
create index if not exists sm_customer_contacts_user_id_idx on sm_customer_contacts (org_id, user_id) where deleted_at is null;
create index if not exists sm_customer_contacts_support_group_id_idx on sm_customer_contacts (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_customer_contacts_workspace_acc_idx on sm_customer_contacts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_contacts_unit_acc_idx on sm_customer_contacts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_contacts_domain_acc_idx on sm_customer_contacts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_contacts_open_grp_idx on sm_customer_contacts (org_id, support_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_customer_contacts_sync on sm_customer_contacts;
create trigger sm_customer_contacts_sync before insert or update on sm_customer_contacts for each row execute function sm_sync_touch('customer_contact');
create or replace trigger sm_customer_contacts_demo after insert on sm_customer_contacts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_contacts_demo_t after update or delete on sm_customer_contacts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_contacts enable row level security;

-- customer_contract: قراردادهای مشتری
do $cols$
begin
  if to_regclass('sm_customer_contracts') is not null then
    alter table sm_customer_contracts add column if not exists workspace_id uuid;
    alter table sm_customer_contracts add column if not exists domain_id uuid;
    alter table sm_customer_contracts add column if not exists unit_id uuid;
    alter table sm_customer_contracts add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_contracts add column if not exists created_by uuid;
    alter table sm_customer_contracts add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_contracts add column if not exists updated_by uuid;
    alter table sm_customer_contracts add column if not exists rev bigint not null default 0;
    alter table sm_customer_contracts add column if not exists version integer not null default 1;
    alter table sm_customer_contracts add column if not exists deleted_at timestamptz;
    alter table sm_customer_contracts add column if not exists origin text;
    alter table sm_customer_contracts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_contracts add column if not exists no integer;
    alter table sm_customer_contracts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CTR' || no::text else 'CTR' || lpad(no::text, 6, '0') end) stored;
    alter table sm_customer_contracts add column if not exists name text;
    alter table sm_customer_contracts add column if not exists account_id uuid;
    alter table sm_customer_contracts add column if not exists status text;
    alter table sm_customer_contracts add column if not exists starts_on date;
    alter table sm_customer_contracts add column if not exists ends_on date;
    alter table sm_customer_contracts add column if not exists products jsonb;
    alter table sm_customer_contracts add column if not exists value numeric;
    alter table sm_customer_contracts add column if not exists owner_id uuid;
    alter table sm_customer_contracts add column if not exists document_url text;
    alter table sm_customer_contracts add column if not exists terms text;
    alter table sm_customer_contracts add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_customer_contracts (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CTR' || no::text else 'CTR' || lpad(no::text, 6, '0') end) stored,
  name text,
  account_id uuid,
  status text,
  starts_on date,
  ends_on date,
  products jsonb,
  value numeric,
  owner_id uuid,
  document_url text,
  terms text,
  support_group_id uuid,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_customer_contracts', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_customer_contracts_search_56291d9d_trgm', 'sm_customer_contracts', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_customer_contracts_search_custom_trgm', 'sm_customer_contracts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_customer_contracts_no_uk on sm_customer_contracts (org_id, no);
create index if not exists sm_customer_contracts_rev_idx on sm_customer_contracts (org_id, rev);
create index if not exists sm_customer_contracts_upd_idx on sm_customer_contracts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_contracts_crt_idx on sm_customer_contracts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_contracts_account_id_idx on sm_customer_contracts (org_id, account_id) where deleted_at is null;
create index if not exists sm_customer_contracts_support_group_id_idx on sm_customer_contracts (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_customer_contracts_workspace_acc_idx on sm_customer_contracts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_contracts_unit_acc_idx on sm_customer_contracts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_contracts_domain_acc_idx on sm_customer_contracts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_contracts_owner_id_idx on sm_customer_contracts (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_customer_contracts_sync on sm_customer_contracts;
create trigger sm_customer_contracts_sync before insert or update on sm_customer_contracts for each row execute function sm_sync_touch('customer_contract');
create or replace trigger sm_customer_contracts_demo after insert on sm_customer_contracts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_contracts_demo_t after update or delete on sm_customer_contracts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_contracts enable row level security;

-- customer_experience: تجربه‌های مشتری
do $cols$
begin
  if to_regclass('sm_customer_experiences') is not null then
    alter table sm_customer_experiences add column if not exists workspace_id uuid;
    alter table sm_customer_experiences add column if not exists domain_id uuid;
    alter table sm_customer_experiences add column if not exists unit_id uuid;
    alter table sm_customer_experiences add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_experiences add column if not exists created_by uuid;
    alter table sm_customer_experiences add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_experiences add column if not exists updated_by uuid;
    alter table sm_customer_experiences add column if not exists rev bigint not null default 0;
    alter table sm_customer_experiences add column if not exists version integer not null default 1;
    alter table sm_customer_experiences add column if not exists deleted_at timestamptz;
    alter table sm_customer_experiences add column if not exists origin text;
    alter table sm_customer_experiences add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_experiences add column if not exists name text;
    alter table sm_customer_experiences add column if not exists brand_name text;
    alter table sm_customer_experiences add column if not exists color text;
    alter table sm_customer_experiences add column if not exists logo_url text;
    alter table sm_customer_experiences add column if not exists accounts jsonb;
    alter table sm_customer_experiences add column if not exists products jsonb;
    alter table sm_customer_experiences add column if not exists channels jsonb;
    alter table sm_customer_experiences add column if not exists support_group_id uuid;
    alter table sm_customer_experiences add column if not exists kb_base_id uuid;
    alter table sm_customer_experiences add column if not exists default_case_type text;
    alter table sm_customer_experiences add column if not exists greeting text;
    alter table sm_customer_experiences add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_customer_experiences (
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
  brand_name text,
  color text,
  logo_url text,
  accounts jsonb,
  products jsonb,
  channels jsonb,
  support_group_id uuid,
  kb_base_id uuid,
  default_case_type text,
  greeting text,
  active boolean not null default true
);
create index if not exists sm_customer_experiences_rev_idx on sm_customer_experiences (org_id, rev);
create index if not exists sm_customer_experiences_upd_idx on sm_customer_experiences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_experiences_crt_idx on sm_customer_experiences (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_experiences_workspace_acc_idx on sm_customer_experiences (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_experiences_unit_acc_idx on sm_customer_experiences (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_experiences_domain_acc_idx on sm_customer_experiences (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_experiences_open_grp_idx on sm_customer_experiences (org_id, support_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_customer_experiences_sync on sm_customer_experiences;
create trigger sm_customer_experiences_sync before insert or update on sm_customer_experiences for each row execute function sm_sync_touch('customer_experience');
create or replace trigger sm_customer_experiences_demo after insert on sm_customer_experiences for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_experiences_demo_t after update or delete on sm_customer_experiences for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_experiences enable row level security;

-- customer_notice: اطلاع‌رسانی‌های مشتریان
do $cols$
begin
  if to_regclass('sm_customer_notices') is not null then
    alter table sm_customer_notices add column if not exists workspace_id uuid;
    alter table sm_customer_notices add column if not exists domain_id uuid;
    alter table sm_customer_notices add column if not exists unit_id uuid;
    alter table sm_customer_notices add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_notices add column if not exists created_by uuid;
    alter table sm_customer_notices add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_notices add column if not exists updated_by uuid;
    alter table sm_customer_notices add column if not exists rev bigint not null default 0;
    alter table sm_customer_notices add column if not exists version integer not null default 1;
    alter table sm_customer_notices add column if not exists deleted_at timestamptz;
    alter table sm_customer_notices add column if not exists origin text;
    alter table sm_customer_notices add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_notices add column if not exists no integer;
    alter table sm_customer_notices add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'NTC' || no::text else 'NTC' || lpad(no::text, 6, '0') end) stored;
    alter table sm_customer_notices add column if not exists title text;
    alter table sm_customer_notices add column if not exists regulation text;
    alter table sm_customer_notices add column if not exists incident_id uuid;
    alter table sm_customer_notices add column if not exists accounts jsonb;
    alter table sm_customer_notices add column if not exists body text;
    alter table sm_customer_notices add column if not exists channels jsonb;
    alter table sm_customer_notices add column if not exists owner_id uuid;
    alter table sm_customer_notices add column if not exists recipients jsonb;
    alter table sm_customer_notices add column if not exists recipient_count integer;
    alter table sm_customer_notices add column if not exists sent_at timestamptz;
    alter table sm_customer_notices add column if not exists evidence jsonb;
    alter table sm_customer_notices add column if not exists approval text;
    alter table sm_customer_notices add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_customer_notices (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'NTC' || no::text else 'NTC' || lpad(no::text, 6, '0') end) stored,
  title text,
  regulation text,
  incident_id uuid,
  accounts jsonb,
  body text,
  channels jsonb,
  owner_id uuid,
  recipients jsonb,
  recipient_count integer,
  sent_at timestamptz,
  evidence jsonb,
  approval text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_customer_notices', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_customer_notices_search_cae18f1d_trgm', 'sm_customer_notices', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_customer_notices_search_custom_trgm', 'sm_customer_notices', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_customer_notices_no_uk on sm_customer_notices (org_id, no);
create index if not exists sm_customer_notices_rev_idx on sm_customer_notices (org_id, rev);
create index if not exists sm_customer_notices_upd_idx on sm_customer_notices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_notices_crt_idx on sm_customer_notices (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_notices_state_idx on sm_customer_notices (org_id, state) where deleted_at is null;
create index if not exists sm_customer_notices_workspace_acc_idx on sm_customer_notices (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_notices_unit_acc_idx on sm_customer_notices (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_notices_domain_acc_idx on sm_customer_notices (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_notices_owner_id_idx on sm_customer_notices (org_id, owner_id) where deleted_at is null;
create index if not exists sm_customer_notices_recipients_gin on sm_customer_notices using gin (recipients);
drop trigger if exists sm_customer_notices_sync on sm_customer_notices;
create trigger sm_customer_notices_sync before insert or update on sm_customer_notices for each row execute function sm_sync_touch('customer_notice');
create or replace trigger sm_customer_notices_demo after insert on sm_customer_notices for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_notices_demo_t after update or delete on sm_customer_notices for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_notices enable row level security;

-- customer_product: محصولات
do $cols$
begin
  if to_regclass('sm_customer_products') is not null then
    alter table sm_customer_products add column if not exists workspace_id uuid;
    alter table sm_customer_products add column if not exists domain_id uuid;
    alter table sm_customer_products add column if not exists unit_id uuid;
    alter table sm_customer_products add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_products add column if not exists created_by uuid;
    alter table sm_customer_products add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_products add column if not exists updated_by uuid;
    alter table sm_customer_products add column if not exists rev bigint not null default 0;
    alter table sm_customer_products add column if not exists version integer not null default 1;
    alter table sm_customer_products add column if not exists deleted_at timestamptz;
    alter table sm_customer_products add column if not exists origin text;
    alter table sm_customer_products add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_products add column if not exists name text;
    alter table sm_customer_products add column if not exists code text;
    alter table sm_customer_products add column if not exists product_version text;
    alter table sm_customer_products add column if not exists family text;
    alter table sm_customer_products add column if not exists support_group_id uuid;
    alter table sm_customer_products add column if not exists owner_id uuid;
    alter table sm_customer_products add column if not exists skills jsonb;
    alter table sm_customer_products add column if not exists active boolean not null default true;
    alter table sm_customer_products add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_customer_products (
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
  code text,
  product_version text,
  family text,
  support_group_id uuid,
  owner_id uuid,
  skills jsonb,
  active boolean not null default true,
  description text
);
create index if not exists sm_customer_products_rev_idx on sm_customer_products (org_id, rev);
create index if not exists sm_customer_products_upd_idx on sm_customer_products (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_products_crt_idx on sm_customer_products (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_customer_products_code_uk on sm_customer_products (org_id, code) where deleted_at is null;
create index if not exists sm_customer_products_workspace_acc_idx on sm_customer_products (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_products_unit_acc_idx on sm_customer_products (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_products_domain_acc_idx on sm_customer_products (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_products_open_grp_idx on sm_customer_products (org_id, support_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_customer_products_sync on sm_customer_products;
create trigger sm_customer_products_sync before insert or update on sm_customer_products for each row execute function sm_sync_touch('customer_product');
create or replace trigger sm_customer_products_demo after insert on sm_customer_products for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_products_demo_t after update or delete on sm_customer_products for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_products enable row level security;

-- customer_relationship: ارتباط با مشتریان
do $cols$
begin
  if to_regclass('sm_customer_relationships') is not null then
    alter table sm_customer_relationships add column if not exists workspace_id uuid;
    alter table sm_customer_relationships add column if not exists domain_id uuid;
    alter table sm_customer_relationships add column if not exists unit_id uuid;
    alter table sm_customer_relationships add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_relationships add column if not exists created_by uuid;
    alter table sm_customer_relationships add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_relationships add column if not exists updated_by uuid;
    alter table sm_customer_relationships add column if not exists rev bigint not null default 0;
    alter table sm_customer_relationships add column if not exists version integer not null default 1;
    alter table sm_customer_relationships add column if not exists deleted_at timestamptz;
    alter table sm_customer_relationships add column if not exists origin text;
    alter table sm_customer_relationships add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_relationships add column if not exists name text;
    alter table sm_customer_relationships add column if not exists customer_unit_id uuid;
    alter table sm_customer_relationships add column if not exists manager_id uuid;
    alter table sm_customer_relationships add column if not exists relationship_type text;
    alter table sm_customer_relationships add column if not exists channels text;
    alter table sm_customer_relationships add column if not exists expectations text;
    alter table sm_customer_relationships add column if not exists opportunities text;
    alter table sm_customer_relationships add column if not exists satisfaction integer;
    alter table sm_customer_relationships add column if not exists next_review_at date;
    alter table sm_customer_relationships add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_customer_relationships (
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
  customer_unit_id uuid,
  manager_id uuid,
  relationship_type text,
  channels text,
  expectations text,
  opportunities text,
  satisfaction integer,
  next_review_at date,
  active boolean not null default true
);
create index if not exists sm_customer_relationships_rev_idx on sm_customer_relationships (org_id, rev);
create index if not exists sm_customer_relationships_upd_idx on sm_customer_relationships (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_relationships_crt_idx on sm_customer_relationships (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_relationships_workspace_acc_idx on sm_customer_relationships (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_relationships_unit_acc_idx on sm_customer_relationships (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_relationships_domain_acc_idx on sm_customer_relationships (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_relationships_manager_id_idx on sm_customer_relationships (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_customer_relationships_sync on sm_customer_relationships;
create trigger sm_customer_relationships_sync before insert or update on sm_customer_relationships for each row execute function sm_sync_touch('customer_relationship');
create or replace trigger sm_customer_relationships_demo after insert on sm_customer_relationships for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_relationships_demo_t after update or delete on sm_customer_relationships for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_relationships enable row level security;

-- customer_review: بازبینی‌های با مشتری
do $cols$
begin
  if to_regclass('sm_customer_reviews') is not null then
    alter table sm_customer_reviews add column if not exists workspace_id uuid;
    alter table sm_customer_reviews add column if not exists domain_id uuid;
    alter table sm_customer_reviews add column if not exists unit_id uuid;
    alter table sm_customer_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_customer_reviews add column if not exists created_by uuid;
    alter table sm_customer_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_customer_reviews add column if not exists updated_by uuid;
    alter table sm_customer_reviews add column if not exists rev bigint not null default 0;
    alter table sm_customer_reviews add column if not exists version integer not null default 1;
    alter table sm_customer_reviews add column if not exists deleted_at timestamptz;
    alter table sm_customer_reviews add column if not exists origin text;
    alter table sm_customer_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_customer_reviews add column if not exists no integer;
    alter table sm_customer_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRV' || no::text else 'CRV' || lpad(no::text, 5, '0') end) stored;
    alter table sm_customer_reviews add column if not exists title text;
    alter table sm_customer_reviews add column if not exists relationship_id uuid;
    alter table sm_customer_reviews add column if not exists held_at timestamptz;
    alter table sm_customer_reviews add column if not exists manager_id uuid;
    alter table sm_customer_reviews add column if not exists attendees jsonb;
    alter table sm_customer_reviews add column if not exists minutes text;
    alter table sm_customer_reviews add column if not exists actions text;
    alter table sm_customer_reviews add column if not exists agreement_changes text;
    alter table sm_customer_reviews add column if not exists satisfaction integer;
    alter table sm_customer_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_customer_reviews (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRV' || no::text else 'CRV' || lpad(no::text, 5, '0') end) stored,
  title text,
  relationship_id uuid,
  held_at timestamptz,
  manager_id uuid,
  attendees jsonb,
  minutes text,
  actions text,
  agreement_changes text,
  satisfaction integer,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_customer_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_customer_reviews_search_cae18f1d_trgm', 'sm_customer_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_customer_reviews_search_custom_trgm', 'sm_customer_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_customer_reviews_no_uk on sm_customer_reviews (org_id, no);
create index if not exists sm_customer_reviews_rev_idx on sm_customer_reviews (org_id, rev);
create index if not exists sm_customer_reviews_upd_idx on sm_customer_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_reviews_crt_idx on sm_customer_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_reviews_relationship_id_idx on sm_customer_reviews (org_id, relationship_id) where deleted_at is null;
create index if not exists sm_customer_reviews_state_idx on sm_customer_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_customer_reviews_workspace_acc_idx on sm_customer_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_reviews_unit_acc_idx on sm_customer_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_reviews_domain_acc_idx on sm_customer_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_reviews_manager_id_idx on sm_customer_reviews (org_id, manager_id) where deleted_at is null;
create index if not exists sm_customer_reviews_attendees_gin on sm_customer_reviews using gin (attendees);
drop trigger if exists sm_customer_reviews_sync on sm_customer_reviews;
create trigger sm_customer_reviews_sync before insert or update on sm_customer_reviews for each row execute function sm_sync_touch('customer_review');
create or replace trigger sm_customer_reviews_demo after insert on sm_customer_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_customer_reviews_demo_t after update or delete on sm_customer_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_customer_reviews enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:7', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:%') >= 28 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۹ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 9/28 (e746bd22eb04)
-- data_export: خروجی‌های داده
do $cols$
begin
  if to_regclass('sm_data_exports') is not null then
    alter table sm_data_exports add column if not exists workspace_id uuid;
    alter table sm_data_exports add column if not exists domain_id uuid;
    alter table sm_data_exports add column if not exists unit_id uuid;
    alter table sm_data_exports add column if not exists created_at timestamptz not null default now();
    alter table sm_data_exports add column if not exists created_by uuid;
    alter table sm_data_exports add column if not exists updated_at timestamptz not null default now();
    alter table sm_data_exports add column if not exists updated_by uuid;
    alter table sm_data_exports add column if not exists rev bigint not null default 0;
    alter table sm_data_exports add column if not exists version integer not null default 1;
    alter table sm_data_exports add column if not exists deleted_at timestamptz;
    alter table sm_data_exports add column if not exists origin text;
    alter table sm_data_exports add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_data_exports add column if not exists no integer;
    alter table sm_data_exports add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DEX' || no::text else 'DEX' || lpad(no::text, 6, '0') end) stored;
    alter table sm_data_exports add column if not exists title text;
    alter table sm_data_exports add column if not exists tables jsonb;
    alter table sm_data_exports add column if not exists format text;
    alter table sm_data_exports add column if not exists include_journal boolean not null default false;
    alter table sm_data_exports add column if not exists status text;
    alter table sm_data_exports add column if not exists requested_for uuid;
    alter table sm_data_exports add column if not exists schedule_id uuid;
    alter table sm_data_exports add column if not exists stats jsonb;
    alter table sm_data_exports add column if not exists error text;
    alter table sm_data_exports add column if not exists expires_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_data_exports (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DEX' || no::text else 'DEX' || lpad(no::text, 6, '0') end) stored,
  title text,
  tables jsonb,
  format text,
  include_journal boolean not null default false,
  status text,
  requested_for uuid,
  schedule_id uuid,
  stats jsonb,
  error text,
  expires_at timestamptz,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_data_exports', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_data_exports_search_cae18f1d_trgm', 'sm_data_exports', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_data_exports_search_custom_trgm', 'sm_data_exports', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_data_exports_no_uk on sm_data_exports (org_id, no);
create index if not exists sm_data_exports_rev_idx on sm_data_exports (org_id, rev);
create index if not exists sm_data_exports_upd_idx on sm_data_exports (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_data_exports_crt_idx on sm_data_exports (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_data_exports_workspace_acc_idx on sm_data_exports (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_data_exports_unit_acc_idx on sm_data_exports (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_data_exports_domain_acc_idx on sm_data_exports (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_data_exports_requested_for_idx on sm_data_exports (org_id, requested_for) where deleted_at is null;
drop trigger if exists sm_data_exports_sync on sm_data_exports;
create trigger sm_data_exports_sync before insert or update on sm_data_exports for each row execute function sm_sync_touch('data_export');
create or replace trigger sm_data_exports_demo after insert on sm_data_exports for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_data_exports_demo_t after update or delete on sm_data_exports for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_data_exports enable row level security;

-- defect: نقص‌ها
do $cols$
begin
  if to_regclass('sm_defects') is not null then
    alter table sm_defects add column if not exists workspace_id uuid;
    alter table sm_defects add column if not exists domain_id uuid;
    alter table sm_defects add column if not exists unit_id uuid;
    alter table sm_defects add column if not exists created_at timestamptz not null default now();
    alter table sm_defects add column if not exists created_by uuid;
    alter table sm_defects add column if not exists updated_at timestamptz not null default now();
    alter table sm_defects add column if not exists updated_by uuid;
    alter table sm_defects add column if not exists rev bigint not null default 0;
    alter table sm_defects add column if not exists version integer not null default 1;
    alter table sm_defects add column if not exists deleted_at timestamptz;
    alter table sm_defects add column if not exists origin text;
    alter table sm_defects add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_defects add column if not exists no integer;
    alter table sm_defects add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'DEF' || no::text else 'DEF' || lpad(no::text, 7, '0') end) stored;
    alter table sm_defects add column if not exists short_description text;
    alter table sm_defects add column if not exists description text;
    alter table sm_defects add column if not exists state text;
    alter table sm_defects add column if not exists priority text;
    alter table sm_defects add column if not exists impact text;
    alter table sm_defects add column if not exists urgency text;
    alter table sm_defects add column if not exists category text;
    alter table sm_defects add column if not exists subcategory text;
    alter table sm_defects add column if not exists channel text;
    alter table sm_defects add column if not exists caller_id uuid;
    alter table sm_defects add column if not exists requested_for uuid;
    alter table sm_defects add column if not exists opened_by uuid;
    alter table sm_defects add column if not exists opened_at timestamptz;
    alter table sm_defects add column if not exists assignment_group_id uuid;
    alter table sm_defects add column if not exists assigned_to uuid;
    alter table sm_defects add column if not exists service_id uuid;
    alter table sm_defects add column if not exists offering_id uuid;
    alter table sm_defects add column if not exists ci_id uuid;
    alter table sm_defects add column if not exists location_id uuid;
    alter table sm_defects add column if not exists due_at timestamptz;
    alter table sm_defects add column if not exists resolved_at timestamptz;
    alter table sm_defects add column if not exists resolved_by uuid;
    alter table sm_defects add column if not exists closed_at timestamptz;
    alter table sm_defects add column if not exists closed_by uuid;
    alter table sm_defects add column if not exists close_code text;
    alter table sm_defects add column if not exists close_notes text;
    alter table sm_defects add column if not exists parent_id uuid;
    alter table sm_defects add column if not exists watch_list jsonb;
    alter table sm_defects add column if not exists approval text;
    alter table sm_defects add column if not exists escalation integer;
    alter table sm_defects add column if not exists reassignment_count integer;
    alter table sm_defects add column if not exists reopen_count integer;
    alter table sm_defects add column if not exists time_worked bigint;
    alter table sm_defects add column if not exists first_response_at timestamptz;
    alter table sm_defects add column if not exists active boolean not null default true;
    alter table sm_defects add column if not exists sla_due timestamptz;
    alter table sm_defects add column if not exists knowledge boolean not null default false;
    alter table sm_defects add column if not exists release_id uuid;
    alter table sm_defects add column if not exists severity text;
    alter table sm_defects add column if not exists found_in_env uuid;
    alter table sm_defects add column if not exists escaped boolean not null default false;
    alter table sm_defects add column if not exists fix_version text;
    alter table sm_defects add column if not exists known_error_id uuid;
    alter table sm_defects add column if not exists steps text;
  end if;
end
$cols$;
create table if not exists sm_defects (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'DEF' || no::text else 'DEF' || lpad(no::text, 7, '0') end) stored,
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
  release_id uuid,
  severity text,
  found_in_env uuid,
  escaped boolean not null default false,
  fix_version text,
  known_error_id uuid,
  steps text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_defects', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_defects_search_f3bce210_trgm', 'sm_defects', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_defects_search_custom_trgm', 'sm_defects', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_defects_no_uk on sm_defects (org_id, no);
create index if not exists sm_defects_rev_idx on sm_defects (org_id, rev);
create index if not exists sm_defects_upd_idx on sm_defects (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_defects_crt_idx on sm_defects (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_defects_state_idx on sm_defects (org_id, state) where deleted_at is null;
create index if not exists sm_defects_assignment_group_id_idx on sm_defects (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_defects_assigned_to_idx on sm_defects (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_defects_release_id_idx on sm_defects (org_id, release_id) where deleted_at is null;
create index if not exists sm_defects_workspace_acc_idx on sm_defects (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_defects_unit_acc_idx on sm_defects (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_defects_domain_acc_idx on sm_defects (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_defects_caller_id_idx on sm_defects (org_id, caller_id) where deleted_at is null;
create index if not exists sm_defects_requested_for_idx on sm_defects (org_id, requested_for) where deleted_at is null;
create index if not exists sm_defects_opened_by_idx on sm_defects (org_id, opened_by) where deleted_at is null;
create index if not exists sm_defects_watch_list_gin on sm_defects using gin (watch_list);
create index if not exists sm_defects_open_grp_idx on sm_defects (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_defects_opened_brin on sm_defects using brin (opened_at);
drop trigger if exists sm_defects_sync on sm_defects;
create trigger sm_defects_sync before insert or update on sm_defects for each row execute function sm_sync_touch('defect');
create or replace trigger sm_defects_demo after insert on sm_defects for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_defects_demo_t after update or delete on sm_defects for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_defects enable row level security;

-- delegation: جانشینی‌ها
do $cols$
begin
  if to_regclass('sm_delegations') is not null then
    alter table sm_delegations add column if not exists workspace_id uuid;
    alter table sm_delegations add column if not exists domain_id uuid;
    alter table sm_delegations add column if not exists unit_id uuid;
    alter table sm_delegations add column if not exists created_at timestamptz not null default now();
    alter table sm_delegations add column if not exists created_by uuid;
    alter table sm_delegations add column if not exists updated_at timestamptz not null default now();
    alter table sm_delegations add column if not exists updated_by uuid;
    alter table sm_delegations add column if not exists rev bigint not null default 0;
    alter table sm_delegations add column if not exists version integer not null default 1;
    alter table sm_delegations add column if not exists deleted_at timestamptz;
    alter table sm_delegations add column if not exists origin text;
    alter table sm_delegations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_delegations add column if not exists from_user uuid;
    alter table sm_delegations add column if not exists to_user uuid;
    alter table sm_delegations add column if not exists starts_at timestamptz;
    alter table sm_delegations add column if not exists ends_at timestamptz;
    alter table sm_delegations add column if not exists scopes jsonb;
    alter table sm_delegations add column if not exists reason text;
    alter table sm_delegations add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_delegations (
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
  from_user uuid,
  to_user uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  scopes jsonb,
  reason text,
  active boolean not null default true
);
create index if not exists sm_delegations_rev_idx on sm_delegations (org_id, rev);
create index if not exists sm_delegations_upd_idx on sm_delegations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_delegations_crt_idx on sm_delegations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_delegations_from_user_idx on sm_delegations (org_id, from_user) where deleted_at is null;
create index if not exists sm_delegations_to_user_idx on sm_delegations (org_id, to_user) where deleted_at is null;
create index if not exists sm_delegations_workspace_acc_idx on sm_delegations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_delegations_unit_acc_idx on sm_delegations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_delegations_domain_acc_idx on sm_delegations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_delegations_sync on sm_delegations;
create trigger sm_delegations_sync before insert or update on sm_delegations for each row execute function sm_sync_touch('delegation');
create or replace trigger sm_delegations_demo after insert on sm_delegations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_delegations_demo_t after update or delete on sm_delegations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_delegations enable row level security;

-- demand: تقاضاها
do $cols$
begin
  if to_regclass('sm_demands') is not null then
    alter table sm_demands add column if not exists workspace_id uuid;
    alter table sm_demands add column if not exists domain_id uuid;
    alter table sm_demands add column if not exists unit_id uuid;
    alter table sm_demands add column if not exists created_at timestamptz not null default now();
    alter table sm_demands add column if not exists created_by uuid;
    alter table sm_demands add column if not exists updated_at timestamptz not null default now();
    alter table sm_demands add column if not exists updated_by uuid;
    alter table sm_demands add column if not exists rev bigint not null default 0;
    alter table sm_demands add column if not exists version integer not null default 1;
    alter table sm_demands add column if not exists deleted_at timestamptz;
    alter table sm_demands add column if not exists origin text;
    alter table sm_demands add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_demands add column if not exists no integer;
    alter table sm_demands add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DMD' || no::text else 'DMD' || lpad(no::text, 6, '0') end) stored;
    alter table sm_demands add column if not exists title text;
    alter table sm_demands add column if not exists type text;
    alter table sm_demands add column if not exists submitted_by uuid;
    alter table sm_demands add column if not exists business_owner_id uuid;
    alter table sm_demands add column if not exists sponsor_id uuid;
    alter table sm_demands add column if not exists portfolio_id uuid;
    alter table sm_demands add column if not exists org_unit_id uuid;
    alter table sm_demands add column if not exists problem text;
    alter table sm_demands add column if not exists objectives text;
    alter table sm_demands add column if not exists benefits text;
    alter table sm_demands add column if not exists risk text;
    alter table sm_demands add column if not exists est_hours numeric;
    alter table sm_demands add column if not exists est_capex numeric;
    alter table sm_demands add column if not exists est_opex numeric;
    alter table sm_demands add column if not exists needed_by date;
    alter table sm_demands add column if not exists scoring_model text;
    alter table sm_demands add column if not exists business_value integer;
    alter table sm_demands add column if not exists time_criticality integer;
    alter table sm_demands add column if not exists risk_reduction integer;
    alter table sm_demands add column if not exists job_size integer;
    alter table sm_demands add column if not exists alignment integer;
    alter table sm_demands add column if not exists reach integer;
    alter table sm_demands add column if not exists impact_level text;
    alter table sm_demands add column if not exists confidence numeric;
    alter table sm_demands add column if not exists effort_months numeric;
    alter table sm_demands add column if not exists score numeric;
    alter table sm_demands add column if not exists score_wsjf numeric;
    alter table sm_demands add column if not exists score_rice numeric;
    alter table sm_demands add column if not exists score_weighted numeric;
    alter table sm_demands add column if not exists decision_notes text;
    alter table sm_demands add column if not exists converted_project_id uuid;
    alter table sm_demands add column if not exists watch_list jsonb;
    alter table sm_demands add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_demands (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DMD' || no::text else 'DMD' || lpad(no::text, 6, '0') end) stored,
  title text,
  type text,
  submitted_by uuid,
  business_owner_id uuid,
  sponsor_id uuid,
  portfolio_id uuid,
  org_unit_id uuid,
  problem text,
  objectives text,
  benefits text,
  risk text,
  est_hours numeric,
  est_capex numeric,
  est_opex numeric,
  needed_by date,
  scoring_model text,
  business_value integer,
  time_criticality integer,
  risk_reduction integer,
  job_size integer,
  alignment integer,
  reach integer,
  impact_level text,
  confidence numeric,
  effort_months numeric,
  score numeric,
  score_wsjf numeric,
  score_rice numeric,
  score_weighted numeric,
  decision_notes text,
  converted_project_id uuid,
  watch_list jsonb,
  state text,
  search_b9324430 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(problem, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_demands', 'search_b9324430', $x$translate(coalesce(title, '') || ' ' || coalesce(problem, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_demands_search_b9324430_trgm', 'sm_demands', 'search_b9324430', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_demands_search_custom_trgm', 'sm_demands', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_demands_no_uk on sm_demands (org_id, no);
create index if not exists sm_demands_rev_idx on sm_demands (org_id, rev);
create index if not exists sm_demands_upd_idx on sm_demands (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_demands_crt_idx on sm_demands (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_demands_state_idx on sm_demands (org_id, state) where deleted_at is null;
create index if not exists sm_demands_workspace_acc_idx on sm_demands (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_demands_unit_acc_idx on sm_demands (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_demands_domain_acc_idx on sm_demands (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_demands_submitted_by_idx on sm_demands (org_id, submitted_by) where deleted_at is null;
create index if not exists sm_demands_business_owner_id_idx on sm_demands (org_id, business_owner_id) where deleted_at is null;
create index if not exists sm_demands_sponsor_id_idx on sm_demands (org_id, sponsor_id) where deleted_at is null;
create index if not exists sm_demands_watch_list_gin on sm_demands using gin (watch_list);
drop trigger if exists sm_demands_sync on sm_demands;
create trigger sm_demands_sync before insert or update on sm_demands for each row execute function sm_sync_touch('demand');
create or replace trigger sm_demands_demo after insert on sm_demands for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_demands_demo_t after update or delete on sm_demands for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_demands enable row level security;

-- deployment: استقرارها
do $cols$
begin
  if to_regclass('sm_deployments') is not null then
    alter table sm_deployments add column if not exists workspace_id uuid;
    alter table sm_deployments add column if not exists domain_id uuid;
    alter table sm_deployments add column if not exists unit_id uuid;
    alter table sm_deployments add column if not exists created_at timestamptz not null default now();
    alter table sm_deployments add column if not exists created_by uuid;
    alter table sm_deployments add column if not exists updated_at timestamptz not null default now();
    alter table sm_deployments add column if not exists updated_by uuid;
    alter table sm_deployments add column if not exists rev bigint not null default 0;
    alter table sm_deployments add column if not exists version integer not null default 1;
    alter table sm_deployments add column if not exists deleted_at timestamptz;
    alter table sm_deployments add column if not exists origin text;
    alter table sm_deployments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_deployments add column if not exists no integer;
    alter table sm_deployments add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'DEP' || no::text else 'DEP' || lpad(no::text, 7, '0') end) stored;
    alter table sm_deployments add column if not exists short_description text;
    alter table sm_deployments add column if not exists description text;
    alter table sm_deployments add column if not exists state text;
    alter table sm_deployments add column if not exists priority text;
    alter table sm_deployments add column if not exists impact text;
    alter table sm_deployments add column if not exists urgency text;
    alter table sm_deployments add column if not exists category text;
    alter table sm_deployments add column if not exists subcategory text;
    alter table sm_deployments add column if not exists channel text;
    alter table sm_deployments add column if not exists caller_id uuid;
    alter table sm_deployments add column if not exists requested_for uuid;
    alter table sm_deployments add column if not exists opened_by uuid;
    alter table sm_deployments add column if not exists opened_at timestamptz;
    alter table sm_deployments add column if not exists assignment_group_id uuid;
    alter table sm_deployments add column if not exists assigned_to uuid;
    alter table sm_deployments add column if not exists service_id uuid;
    alter table sm_deployments add column if not exists offering_id uuid;
    alter table sm_deployments add column if not exists ci_id uuid;
    alter table sm_deployments add column if not exists location_id uuid;
    alter table sm_deployments add column if not exists due_at timestamptz;
    alter table sm_deployments add column if not exists resolved_at timestamptz;
    alter table sm_deployments add column if not exists resolved_by uuid;
    alter table sm_deployments add column if not exists closed_at timestamptz;
    alter table sm_deployments add column if not exists closed_by uuid;
    alter table sm_deployments add column if not exists close_code text;
    alter table sm_deployments add column if not exists close_notes text;
    alter table sm_deployments add column if not exists parent_id uuid;
    alter table sm_deployments add column if not exists watch_list jsonb;
    alter table sm_deployments add column if not exists approval text;
    alter table sm_deployments add column if not exists escalation integer;
    alter table sm_deployments add column if not exists reassignment_count integer;
    alter table sm_deployments add column if not exists reopen_count integer;
    alter table sm_deployments add column if not exists time_worked bigint;
    alter table sm_deployments add column if not exists first_response_at timestamptz;
    alter table sm_deployments add column if not exists active boolean not null default true;
    alter table sm_deployments add column if not exists sla_due timestamptz;
    alter table sm_deployments add column if not exists knowledge boolean not null default false;
    alter table sm_deployments add column if not exists release_id uuid;
    alter table sm_deployments add column if not exists environment_id uuid;
    alter table sm_deployments add column if not exists is_production boolean not null default false;
    alter table sm_deployments add column if not exists change_id uuid;
    alter table sm_deployments add column if not exists approach text;
    alter table sm_deployments add column if not exists kind text;
    alter table sm_deployments add column if not exists artifact_version text;
    alter table sm_deployments add column if not exists artifact_id uuid;
    alter table sm_deployments add column if not exists commit_sha text;
    alter table sm_deployments add column if not exists targets jsonb;
    alter table sm_deployments add column if not exists rollout_pct numeric;
    alter table sm_deployments add column if not exists planned_start timestamptz;
    alter table sm_deployments add column if not exists planned_end timestamptz;
    alter table sm_deployments add column if not exists actual_start timestamptz;
    alter table sm_deployments add column if not exists actual_end timestamptz;
    alter table sm_deployments add column if not exists duration bigint;
    alter table sm_deployments add column if not exists rollback_plan text;
    alter table sm_deployments add column if not exists verification text;
    alter table sm_deployments add column if not exists verification_notes text;
    alter table sm_deployments add column if not exists result_notes text;
    alter table sm_deployments add column if not exists rollback_of uuid;
    alter table sm_deployments add column if not exists pipeline_id uuid;
    alter table sm_deployments add column if not exists build_id uuid;
    alter table sm_deployments add column if not exists connection_id uuid;
    alter table sm_deployments add column if not exists external_id text;
    alter table sm_deployments add column if not exists external_url text;
    alter table sm_deployments add column if not exists initiated_by text;
    alter table sm_deployments add column if not exists on_behalf_of uuid;
    alter table sm_deployments add column if not exists first_commit_at timestamptz;
    alter table sm_deployments add column if not exists lead_time bigint;
    alter table sm_deployments add column if not exists restored_at timestamptz;
    alter table sm_deployments add column if not exists incidents_caused integer;
    alter table sm_deployments add column if not exists change_failure boolean not null default false;
    alter table sm_deployments add column if not exists policy_note text;
    alter table sm_deployments add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_deployments (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'DEP' || no::text else 'DEP' || lpad(no::text, 7, '0') end) stored,
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
  release_id uuid,
  environment_id uuid,
  is_production boolean not null default false,
  change_id uuid,
  approach text,
  kind text,
  artifact_version text,
  artifact_id uuid,
  commit_sha text,
  targets jsonb,
  rollout_pct numeric,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  duration bigint,
  rollback_plan text,
  verification text,
  verification_notes text,
  result_notes text,
  rollback_of uuid,
  pipeline_id uuid,
  build_id uuid,
  connection_id uuid,
  external_id text,
  external_url text,
  initiated_by text,
  on_behalf_of uuid,
  first_commit_at timestamptz,
  lead_time bigint,
  restored_at timestamptz,
  incidents_caused integer,
  change_failure boolean not null default false,
  policy_note text,
  release_manager_id uuid,
  search_a6d70860 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(artifact_version, '') || ' ' || coalesce(commit_sha, '') || ' ' || coalesce(external_id, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_deployments', 'search_a6d70860', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(artifact_version, '') || ' ' || coalesce(commit_sha, '') || ' ' || coalesce(external_id, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_deployments_search_a6d70860_trgm', 'sm_deployments', 'search_a6d70860', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_deployments_search_custom_trgm', 'sm_deployments', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_deployments_no_uk on sm_deployments (org_id, no);
create index if not exists sm_deployments_rev_idx on sm_deployments (org_id, rev);
create index if not exists sm_deployments_upd_idx on sm_deployments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_deployments_crt_idx on sm_deployments (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_deployments_state_idx on sm_deployments (org_id, state) where deleted_at is null;
create index if not exists sm_deployments_assignment_group_id_idx on sm_deployments (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_deployments_assigned_to_idx on sm_deployments (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_deployments_service_id_idx on sm_deployments (org_id, service_id) where deleted_at is null;
create index if not exists sm_deployments_release_id_idx on sm_deployments (org_id, release_id) where deleted_at is null;
create index if not exists sm_deployments_environment_id_idx on sm_deployments (org_id, environment_id) where deleted_at is null;
create index if not exists sm_deployments_change_id_idx on sm_deployments (org_id, change_id) where deleted_at is null;
create index if not exists sm_deployments_actual_end_idx on sm_deployments (org_id, actual_end) where deleted_at is null;
create index if not exists sm_deployments_workspace_acc_idx on sm_deployments (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_deployments_unit_acc_idx on sm_deployments (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_deployments_domain_acc_idx on sm_deployments (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_deployments_caller_id_idx on sm_deployments (org_id, caller_id) where deleted_at is null;
create index if not exists sm_deployments_requested_for_idx on sm_deployments (org_id, requested_for) where deleted_at is null;
create index if not exists sm_deployments_opened_by_idx on sm_deployments (org_id, opened_by) where deleted_at is null;
create index if not exists sm_deployments_release_manager_id_idx on sm_deployments (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_deployments_on_behalf_of_idx on sm_deployments (org_id, on_behalf_of) where deleted_at is null;
create index if not exists sm_deployments_watch_list_gin on sm_deployments using gin (watch_list);
create index if not exists sm_deployments_open_grp_idx on sm_deployments (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_deployments_opened_brin on sm_deployments using brin (opened_at);
drop trigger if exists sm_deployments_sync on sm_deployments;
create trigger sm_deployments_sync before insert or update on sm_deployments for each row execute function sm_sync_touch('deployment');
create or replace trigger sm_deployments_demo after insert on sm_deployments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_deployments_demo_t after update or delete on sm_deployments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_deployments enable row level security;

-- depreciation_rule: قاعده‌های استهلاک
do $cols$
begin
  if to_regclass('sm_depreciation_rules') is not null then
    alter table sm_depreciation_rules add column if not exists workspace_id uuid;
    alter table sm_depreciation_rules add column if not exists domain_id uuid;
    alter table sm_depreciation_rules add column if not exists unit_id uuid;
    alter table sm_depreciation_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_depreciation_rules add column if not exists created_by uuid;
    alter table sm_depreciation_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_depreciation_rules add column if not exists updated_by uuid;
    alter table sm_depreciation_rules add column if not exists rev bigint not null default 0;
    alter table sm_depreciation_rules add column if not exists version integer not null default 1;
    alter table sm_depreciation_rules add column if not exists deleted_at timestamptz;
    alter table sm_depreciation_rules add column if not exists origin text;
    alter table sm_depreciation_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_depreciation_rules add column if not exists name text;
    alter table sm_depreciation_rules add column if not exists method text;
    alter table sm_depreciation_rules add column if not exists life_months integer;
    alter table sm_depreciation_rules add column if not exists rate_percent numeric;
    alter table sm_depreciation_rules add column if not exists salvage_percent numeric;
    alter table sm_depreciation_rules add column if not exists start_basis text;
    alter table sm_depreciation_rules add column if not exists start_convention text;
    alter table sm_depreciation_rules add column if not exists device_classes jsonb;
    alter table sm_depreciation_rules add column if not exists active boolean not null default true;
    alter table sm_depreciation_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_depreciation_rules (
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
  method text,
  life_months integer,
  rate_percent numeric,
  salvage_percent numeric,
  start_basis text,
  start_convention text,
  device_classes jsonb,
  active boolean not null default true,
  description text
);
create index if not exists sm_depreciation_rules_rev_idx on sm_depreciation_rules (org_id, rev);
create index if not exists sm_depreciation_rules_upd_idx on sm_depreciation_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_depreciation_rules_crt_idx on sm_depreciation_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_depreciation_rules_sync on sm_depreciation_rules;
create trigger sm_depreciation_rules_sync before insert or update on sm_depreciation_rules for each row execute function sm_sync_touch('depreciation_rule');
create or replace trigger sm_depreciation_rules_demo after insert on sm_depreciation_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_depreciation_rules_demo_t after update or delete on sm_depreciation_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_depreciation_rules enable row level security;

-- dev_build: اجراهای خط لوله
do $cols$
begin
  if to_regclass('sm_dev_builds') is not null then
    alter table sm_dev_builds add column if not exists workspace_id uuid;
    alter table sm_dev_builds add column if not exists domain_id uuid;
    alter table sm_dev_builds add column if not exists unit_id uuid;
    alter table sm_dev_builds add column if not exists created_at timestamptz not null default now();
    alter table sm_dev_builds add column if not exists created_by uuid;
    alter table sm_dev_builds add column if not exists updated_at timestamptz not null default now();
    alter table sm_dev_builds add column if not exists updated_by uuid;
    alter table sm_dev_builds add column if not exists rev bigint not null default 0;
    alter table sm_dev_builds add column if not exists version integer not null default 1;
    alter table sm_dev_builds add column if not exists deleted_at timestamptz;
    alter table sm_dev_builds add column if not exists origin text;
    alter table sm_dev_builds add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_dev_builds add column if not exists run_number text;
    alter table sm_dev_builds add column if not exists pipeline_id uuid;
    alter table sm_dev_builds add column if not exists connection_id uuid;
    alter table sm_dev_builds add column if not exists repository_id uuid;
    alter table sm_dev_builds add column if not exists status text;
    alter table sm_dev_builds add column if not exists branch text;
    alter table sm_dev_builds add column if not exists commit_sha text;
    alter table sm_dev_builds add column if not exists started_at timestamptz;
    alter table sm_dev_builds add column if not exists finished_at timestamptz;
    alter table sm_dev_builds add column if not exists duration bigint;
    alter table sm_dev_builds add column if not exists tests_total integer;
    alter table sm_dev_builds add column if not exists tests_failed integer;
    alter table sm_dev_builds add column if not exists coverage numeric;
    alter table sm_dev_builds add column if not exists url text;
    alter table sm_dev_builds add column if not exists on_behalf_of uuid;
    alter table sm_dev_builds add column if not exists external_id text;
    alter table sm_dev_builds add column if not exists keys jsonb;
  end if;
end
$cols$;
create table if not exists sm_dev_builds (
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
  run_number text,
  pipeline_id uuid,
  connection_id uuid,
  repository_id uuid,
  status text,
  branch text,
  commit_sha text,
  started_at timestamptz,
  finished_at timestamptz,
  duration bigint,
  tests_total integer,
  tests_failed integer,
  coverage numeric,
  url text,
  on_behalf_of uuid,
  external_id text,
  keys jsonb
);
create index if not exists sm_dev_builds_rev_idx on sm_dev_builds (org_id, rev);
create index if not exists sm_dev_builds_upd_idx on sm_dev_builds (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_builds_crt_idx on sm_dev_builds (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_builds_pipeline_id_idx on sm_dev_builds (org_id, pipeline_id) where deleted_at is null;
create index if not exists sm_dev_builds_connection_id_idx on sm_dev_builds (org_id, connection_id) where deleted_at is null;
create index if not exists sm_dev_builds_started_at_idx on sm_dev_builds (org_id, started_at) where deleted_at is null;
create index if not exists sm_dev_builds_keys_gin on sm_dev_builds using gin (keys);
create unique index if not exists sm_dev_builds_connection_id_external_id_uk on sm_dev_builds (org_id, connection_id, external_id) where deleted_at is null;
drop trigger if exists sm_dev_builds_sync on sm_dev_builds;
create trigger sm_dev_builds_sync before insert or update on sm_dev_builds for each row execute function sm_sync_touch('dev_build');
create or replace trigger sm_dev_builds_demo after insert on sm_dev_builds for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_dev_builds_demo_t after update or delete on sm_dev_builds for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_dev_builds enable row level security;

-- dev_commit: کامیت‌ها
do $cols$
begin
  if to_regclass('sm_dev_commits') is not null then
    alter table sm_dev_commits add column if not exists workspace_id uuid;
    alter table sm_dev_commits add column if not exists domain_id uuid;
    alter table sm_dev_commits add column if not exists unit_id uuid;
    alter table sm_dev_commits add column if not exists created_at timestamptz not null default now();
    alter table sm_dev_commits add column if not exists created_by uuid;
    alter table sm_dev_commits add column if not exists updated_at timestamptz not null default now();
    alter table sm_dev_commits add column if not exists updated_by uuid;
    alter table sm_dev_commits add column if not exists rev bigint not null default 0;
    alter table sm_dev_commits add column if not exists version integer not null default 1;
    alter table sm_dev_commits add column if not exists deleted_at timestamptz;
    alter table sm_dev_commits add column if not exists origin text;
    alter table sm_dev_commits add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_dev_commits add column if not exists sha text;
    alter table sm_dev_commits add column if not exists repository_id uuid;
    alter table sm_dev_commits add column if not exists message text;
    alter table sm_dev_commits add column if not exists author_name text;
    alter table sm_dev_commits add column if not exists author_email text;
    alter table sm_dev_commits add column if not exists committed_at timestamptz;
    alter table sm_dev_commits add column if not exists branch text;
    alter table sm_dev_commits add column if not exists url text;
    alter table sm_dev_commits add column if not exists keys jsonb;
  end if;
end
$cols$;
create table if not exists sm_dev_commits (
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
  sha text,
  repository_id uuid,
  message text,
  author_name text,
  author_email text,
  committed_at timestamptz,
  branch text,
  url text,
  keys jsonb
);
create index if not exists sm_dev_commits_rev_idx on sm_dev_commits (org_id, rev);
create index if not exists sm_dev_commits_upd_idx on sm_dev_commits (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_commits_crt_idx on sm_dev_commits (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_commits_repository_id_idx on sm_dev_commits (org_id, repository_id) where deleted_at is null;
create index if not exists sm_dev_commits_committed_at_idx on sm_dev_commits (org_id, committed_at) where deleted_at is null;
create index if not exists sm_dev_commits_keys_gin on sm_dev_commits using gin (keys);
create unique index if not exists sm_dev_commits_repository_id_sha_uk on sm_dev_commits (org_id, repository_id, sha) where deleted_at is null;
drop trigger if exists sm_dev_commits_sync on sm_dev_commits;
create trigger sm_dev_commits_sync before insert or update on sm_dev_commits for each row execute function sm_sync_touch('dev_commit');
create or replace trigger sm_dev_commits_demo after insert on sm_dev_commits for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_dev_commits_demo_t after update or delete on sm_dev_commits for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_dev_commits enable row level security;

-- dev_event: رویدادهای دریافتی
do $cols$
begin
  if to_regclass('sm_dev_events') is not null then
    alter table sm_dev_events add column if not exists workspace_id uuid;
    alter table sm_dev_events add column if not exists domain_id uuid;
    alter table sm_dev_events add column if not exists unit_id uuid;
    alter table sm_dev_events add column if not exists created_at timestamptz not null default now();
    alter table sm_dev_events add column if not exists created_by uuid;
    alter table sm_dev_events add column if not exists updated_at timestamptz not null default now();
    alter table sm_dev_events add column if not exists updated_by uuid;
    alter table sm_dev_events add column if not exists rev bigint not null default 0;
    alter table sm_dev_events add column if not exists version integer not null default 1;
    alter table sm_dev_events add column if not exists deleted_at timestamptz;
    alter table sm_dev_events add column if not exists origin text;
    alter table sm_dev_events add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_dev_events add column if not exists connection_id uuid;
    alter table sm_dev_events add column if not exists delivery_id text;
    alter table sm_dev_events add column if not exists kind text;
    alter table sm_dev_events add column if not exists provider_event text;
    alter table sm_dev_events add column if not exists status text;
    alter table sm_dev_events add column if not exists verified_by text;
    alter table sm_dev_events add column if not exists received_at timestamptz;
    alter table sm_dev_events add column if not exists processed_at timestamptz;
    alter table sm_dev_events add column if not exists payload_hash text;
    alter table sm_dev_events add column if not exists error text;
    alter table sm_dev_events add column if not exists result jsonb;
    alter table sm_dev_events add column if not exists payload jsonb;
  end if;
end
$cols$;
create table if not exists sm_dev_events (
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
  connection_id uuid,
  delivery_id text,
  kind text,
  provider_event text,
  status text,
  verified_by text,
  received_at timestamptz,
  processed_at timestamptz,
  payload_hash text,
  error text,
  result jsonb,
  payload jsonb
);
create index if not exists sm_dev_events_rev_idx on sm_dev_events (org_id, rev);
create index if not exists sm_dev_events_upd_idx on sm_dev_events (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_events_crt_idx on sm_dev_events (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_events_connection_id_idx on sm_dev_events (org_id, connection_id) where deleted_at is null;
create index if not exists sm_dev_events_received_at_idx on sm_dev_events (org_id, received_at) where deleted_at is null;
create index if not exists sm_dev_events_payload_hash_idx on sm_dev_events (org_id, payload_hash) where deleted_at is null;
create unique index if not exists sm_dev_events_connection_id_delivery_id_uk on sm_dev_events (org_id, connection_id, delivery_id) where deleted_at is null;
drop trigger if exists sm_dev_events_sync on sm_dev_events;
create or replace trigger sm_dev_events_demo after insert on sm_dev_events for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_dev_events_demo_t after update or delete on sm_dev_events for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_dev_events enable row level security;

-- dev_pipeline: خط لوله‌ها
do $cols$
begin
  if to_regclass('sm_dev_pipelines') is not null then
    alter table sm_dev_pipelines add column if not exists workspace_id uuid;
    alter table sm_dev_pipelines add column if not exists domain_id uuid;
    alter table sm_dev_pipelines add column if not exists unit_id uuid;
    alter table sm_dev_pipelines add column if not exists created_at timestamptz not null default now();
    alter table sm_dev_pipelines add column if not exists created_by uuid;
    alter table sm_dev_pipelines add column if not exists updated_at timestamptz not null default now();
    alter table sm_dev_pipelines add column if not exists updated_by uuid;
    alter table sm_dev_pipelines add column if not exists rev bigint not null default 0;
    alter table sm_dev_pipelines add column if not exists version integer not null default 1;
    alter table sm_dev_pipelines add column if not exists deleted_at timestamptz;
    alter table sm_dev_pipelines add column if not exists origin text;
    alter table sm_dev_pipelines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_dev_pipelines add column if not exists name text;
    alter table sm_dev_pipelines add column if not exists connection_id uuid;
    alter table sm_dev_pipelines add column if not exists repository_id uuid;
    alter table sm_dev_pipelines add column if not exists service_id uuid;
    alter table sm_dev_pipelines add column if not exists environments jsonb;
    alter table sm_dev_pipelines add column if not exists change_template_id uuid;
    alter table sm_dev_pipelines add column if not exists external_id text;
    alter table sm_dev_pipelines add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_dev_pipelines (
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
  connection_id uuid,
  repository_id uuid,
  service_id uuid,
  environments jsonb,
  change_template_id uuid,
  external_id text,
  active boolean not null default true
);
create index if not exists sm_dev_pipelines_rev_idx on sm_dev_pipelines (org_id, rev);
create index if not exists sm_dev_pipelines_upd_idx on sm_dev_pipelines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_pipelines_crt_idx on sm_dev_pipelines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_pipelines_connection_id_idx on sm_dev_pipelines (org_id, connection_id) where deleted_at is null;
create unique index if not exists sm_dev_pipelines_connection_id_name_uk on sm_dev_pipelines (org_id, connection_id, name) where deleted_at is null;
drop trigger if exists sm_dev_pipelines_sync on sm_dev_pipelines;
create trigger sm_dev_pipelines_sync before insert or update on sm_dev_pipelines for each row execute function sm_sync_touch('dev_pipeline');
create or replace trigger sm_dev_pipelines_demo after insert on sm_dev_pipelines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_dev_pipelines_demo_t after update or delete on sm_dev_pipelines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_dev_pipelines enable row level security;

-- dev_pull_request: درخواست‌های ادغام
do $cols$
begin
  if to_regclass('sm_dev_pull_requests') is not null then
    alter table sm_dev_pull_requests add column if not exists workspace_id uuid;
    alter table sm_dev_pull_requests add column if not exists domain_id uuid;
    alter table sm_dev_pull_requests add column if not exists unit_id uuid;
    alter table sm_dev_pull_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_dev_pull_requests add column if not exists created_by uuid;
    alter table sm_dev_pull_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_dev_pull_requests add column if not exists updated_by uuid;
    alter table sm_dev_pull_requests add column if not exists rev bigint not null default 0;
    alter table sm_dev_pull_requests add column if not exists version integer not null default 1;
    alter table sm_dev_pull_requests add column if not exists deleted_at timestamptz;
    alter table sm_dev_pull_requests add column if not exists origin text;
    alter table sm_dev_pull_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_dev_pull_requests add column if not exists title text;
    alter table sm_dev_pull_requests add column if not exists pr_number integer;
    alter table sm_dev_pull_requests add column if not exists repository_id uuid;
    alter table sm_dev_pull_requests add column if not exists state text;
    alter table sm_dev_pull_requests add column if not exists author text;
    alter table sm_dev_pull_requests add column if not exists source_branch text;
    alter table sm_dev_pull_requests add column if not exists target_branch text;
    alter table sm_dev_pull_requests add column if not exists opened_at timestamptz;
    alter table sm_dev_pull_requests add column if not exists merged_at timestamptz;
    alter table sm_dev_pull_requests add column if not exists url text;
    alter table sm_dev_pull_requests add column if not exists keys jsonb;
  end if;
end
$cols$;
create table if not exists sm_dev_pull_requests (
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
  pr_number integer,
  repository_id uuid,
  state text,
  author text,
  source_branch text,
  target_branch text,
  opened_at timestamptz,
  merged_at timestamptz,
  url text,
  keys jsonb
);
create index if not exists sm_dev_pull_requests_rev_idx on sm_dev_pull_requests (org_id, rev);
create index if not exists sm_dev_pull_requests_upd_idx on sm_dev_pull_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_pull_requests_crt_idx on sm_dev_pull_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_pull_requests_repository_id_idx on sm_dev_pull_requests (org_id, repository_id) where deleted_at is null;
create index if not exists sm_dev_pull_requests_keys_gin on sm_dev_pull_requests using gin (keys);
create unique index if not exists sm_dev_pull_requests_repository_id_pr_number_uk on sm_dev_pull_requests (org_id, repository_id, pr_number) where deleted_at is null;
create index if not exists sm_dev_pull_requests_opened_brin on sm_dev_pull_requests using brin (opened_at);
drop trigger if exists sm_dev_pull_requests_sync on sm_dev_pull_requests;
create trigger sm_dev_pull_requests_sync before insert or update on sm_dev_pull_requests for each row execute function sm_sync_touch('dev_pull_request');
create or replace trigger sm_dev_pull_requests_demo after insert on sm_dev_pull_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_dev_pull_requests_demo_t after update or delete on sm_dev_pull_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_dev_pull_requests enable row level security;

-- dev_repository: مخزن‌های کد
do $cols$
begin
  if to_regclass('sm_dev_repositories') is not null then
    alter table sm_dev_repositories add column if not exists workspace_id uuid;
    alter table sm_dev_repositories add column if not exists domain_id uuid;
    alter table sm_dev_repositories add column if not exists unit_id uuid;
    alter table sm_dev_repositories add column if not exists created_at timestamptz not null default now();
    alter table sm_dev_repositories add column if not exists created_by uuid;
    alter table sm_dev_repositories add column if not exists updated_at timestamptz not null default now();
    alter table sm_dev_repositories add column if not exists updated_by uuid;
    alter table sm_dev_repositories add column if not exists rev bigint not null default 0;
    alter table sm_dev_repositories add column if not exists version integer not null default 1;
    alter table sm_dev_repositories add column if not exists deleted_at timestamptz;
    alter table sm_dev_repositories add column if not exists origin text;
    alter table sm_dev_repositories add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_dev_repositories add column if not exists name text;
    alter table sm_dev_repositories add column if not exists connection_id uuid;
    alter table sm_dev_repositories add column if not exists url text;
    alter table sm_dev_repositories add column if not exists default_branch text;
    alter table sm_dev_repositories add column if not exists visibility text;
    alter table sm_dev_repositories add column if not exists service_id uuid;
    alter table sm_dev_repositories add column if not exists owner_group_id uuid;
    alter table sm_dev_repositories add column if not exists external_id text;
    alter table sm_dev_repositories add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_dev_repositories (
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
  connection_id uuid,
  url text,
  default_branch text,
  visibility text,
  service_id uuid,
  owner_group_id uuid,
  external_id text,
  active boolean not null default true
);
create index if not exists sm_dev_repositories_rev_idx on sm_dev_repositories (org_id, rev);
create index if not exists sm_dev_repositories_upd_idx on sm_dev_repositories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_repositories_crt_idx on sm_dev_repositories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_dev_repositories_connection_id_idx on sm_dev_repositories (org_id, connection_id) where deleted_at is null;
create unique index if not exists sm_dev_repositories_connection_id_name_uk on sm_dev_repositories (org_id, connection_id, name) where deleted_at is null;
create index if not exists sm_dev_repositories_workspace_acc_idx on sm_dev_repositories (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_dev_repositories_unit_acc_idx on sm_dev_repositories (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_dev_repositories_domain_acc_idx on sm_dev_repositories (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_dev_repositories_open_grp_idx on sm_dev_repositories (org_id, owner_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_dev_repositories_sync on sm_dev_repositories;
create trigger sm_dev_repositories_sync before insert or update on sm_dev_repositories for each row execute function sm_sync_touch('dev_repository');
create or replace trigger sm_dev_repositories_demo after insert on sm_dev_repositories for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_dev_repositories_demo_t after update or delete on sm_dev_repositories for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_dev_repositories enable row level security;

-- device_status_event: تاریخچهٔ وضعیت دستگاه‌ها
do $cols$
begin
  if to_regclass('sm_device_status_events') is not null then
    alter table sm_device_status_events add column if not exists workspace_id uuid;
    alter table sm_device_status_events add column if not exists domain_id uuid;
    alter table sm_device_status_events add column if not exists unit_id uuid;
    alter table sm_device_status_events add column if not exists created_at timestamptz not null default now();
    alter table sm_device_status_events add column if not exists created_by uuid;
    alter table sm_device_status_events add column if not exists updated_at timestamptz not null default now();
    alter table sm_device_status_events add column if not exists updated_by uuid;
    alter table sm_device_status_events add column if not exists rev bigint not null default 0;
    alter table sm_device_status_events add column if not exists version integer not null default 1;
    alter table sm_device_status_events add column if not exists deleted_at timestamptz;
    alter table sm_device_status_events add column if not exists origin text;
    alter table sm_device_status_events add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_device_status_events add column if not exists asset_id uuid;
    alter table sm_device_status_events add column if not exists status text;
    alter table sm_device_status_events add column if not exists from_at timestamptz;
    alter table sm_device_status_events add column if not exists to_at timestamptz;
    alter table sm_device_status_events add column if not exists minutes integer;
    alter table sm_device_status_events add column if not exists branch_id uuid;
    alter table sm_device_status_events add column if not exists contract_id uuid;
    alter table sm_device_status_events add column if not exists incident_id uuid;
    alter table sm_device_status_events add column if not exists reason text;
    alter table sm_device_status_events add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_device_status_events (
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
  asset_id uuid,
  status text,
  from_at timestamptz,
  to_at timestamptz,
  minutes integer,
  branch_id uuid,
  contract_id uuid,
  incident_id uuid,
  reason text,
  label text
);
create index if not exists sm_device_status_events_rev_idx on sm_device_status_events (org_id, rev);
create index if not exists sm_device_status_events_upd_idx on sm_device_status_events (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_device_status_events_crt_idx on sm_device_status_events (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_device_status_events_asset_id_idx on sm_device_status_events (org_id, asset_id) where deleted_at is null;
create index if not exists sm_device_status_events_branch_id_idx on sm_device_status_events (org_id, branch_id) where deleted_at is null;
drop trigger if exists sm_device_status_events_sync on sm_device_status_events;
create trigger sm_device_status_events_sync before insert or update on sm_device_status_events for each row execute function sm_sync_touch('device_status_event');
create or replace trigger sm_device_status_events_demo after insert on sm_device_status_events for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_device_status_events_demo_t after update or delete on sm_device_status_events for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_device_status_events enable row level security;

-- devops_connection: اتصال‌های دواپس
do $cols$
begin
  if to_regclass('sm_devops_connections') is not null then
    alter table sm_devops_connections add column if not exists workspace_id uuid;
    alter table sm_devops_connections add column if not exists domain_id uuid;
    alter table sm_devops_connections add column if not exists unit_id uuid;
    alter table sm_devops_connections add column if not exists created_at timestamptz not null default now();
    alter table sm_devops_connections add column if not exists created_by uuid;
    alter table sm_devops_connections add column if not exists updated_at timestamptz not null default now();
    alter table sm_devops_connections add column if not exists updated_by uuid;
    alter table sm_devops_connections add column if not exists rev bigint not null default 0;
    alter table sm_devops_connections add column if not exists version integer not null default 1;
    alter table sm_devops_connections add column if not exists deleted_at timestamptz;
    alter table sm_devops_connections add column if not exists origin text;
    alter table sm_devops_connections add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_devops_connections add column if not exists name text;
    alter table sm_devops_connections add column if not exists kind text;
    alter table sm_devops_connections add column if not exists active boolean not null default true;
    alter table sm_devops_connections add column if not exists base_url text;
    alter table sm_devops_connections add column if not exists principal text;
    alter table sm_devops_connections add column if not exists hook_key text;
    alter table sm_devops_connections add column if not exists secret text;
    alter table sm_devops_connections add column if not exists secret_rotated_at timestamptz;
    alter table sm_devops_connections add column if not exists service_id uuid;
    alter table sm_devops_connections add column if not exists assignment_group_id uuid;
    alter table sm_devops_connections add column if not exists description text;
    alter table sm_devops_connections add column if not exists auto_change boolean not null default true;
    alter table sm_devops_connections add column if not exists change_template_id uuid;
    alter table sm_devops_connections add column if not exists close_changes boolean not null default true;
    alter table sm_devops_connections add column if not exists gate_timeout_minutes integer;
    alter table sm_devops_connections add column if not exists env_map jsonb;
    alter table sm_devops_connections add column if not exists health text;
    alter table sm_devops_connections add column if not exists last_event_at timestamptz;
    alter table sm_devops_connections add column if not exists events_total integer;
    alter table sm_devops_connections add column if not exists events_failed integer;
    alter table sm_devops_connections add column if not exists last_error text;
  end if;
end
$cols$;
create table if not exists sm_devops_connections (
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
  principal text,
  hook_key text,
  secret text,
  secret_rotated_at timestamptz,
  service_id uuid,
  assignment_group_id uuid,
  description text,
  auto_change boolean not null default true,
  change_template_id uuid,
  close_changes boolean not null default true,
  gate_timeout_minutes integer,
  env_map jsonb,
  health text,
  last_event_at timestamptz,
  events_total integer,
  events_failed integer,
  last_error text
);
create index if not exists sm_devops_connections_rev_idx on sm_devops_connections (org_id, rev);
create index if not exists sm_devops_connections_upd_idx on sm_devops_connections (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_devops_connections_crt_idx on sm_devops_connections (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_devops_connections_hook_key_uk on sm_devops_connections (org_id, hook_key) where deleted_at is null;
drop trigger if exists sm_devops_connections_sync on sm_devops_connections;
create trigger sm_devops_connections_sync before insert or update on sm_devops_connections for each row execute function sm_sync_touch('devops_connection');
create or replace trigger sm_devops_connections_demo after insert on sm_devops_connections for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_devops_connections_demo_t after update or delete on sm_devops_connections for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_devops_connections enable row level security;

-- directory_source: منبع‌های فهرست کاربران
do $cols$
begin
  if to_regclass('sm_directory_sources') is not null then
    alter table sm_directory_sources add column if not exists workspace_id uuid;
    alter table sm_directory_sources add column if not exists domain_id uuid;
    alter table sm_directory_sources add column if not exists unit_id uuid;
    alter table sm_directory_sources add column if not exists created_at timestamptz not null default now();
    alter table sm_directory_sources add column if not exists created_by uuid;
    alter table sm_directory_sources add column if not exists updated_at timestamptz not null default now();
    alter table sm_directory_sources add column if not exists updated_by uuid;
    alter table sm_directory_sources add column if not exists rev bigint not null default 0;
    alter table sm_directory_sources add column if not exists version integer not null default 1;
    alter table sm_directory_sources add column if not exists deleted_at timestamptz;
    alter table sm_directory_sources add column if not exists origin text;
    alter table sm_directory_sources add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_directory_sources add column if not exists name text;
    alter table sm_directory_sources add column if not exists kind text;
    alter table sm_directory_sources add column if not exists active boolean not null default true;
    alter table sm_directory_sources add column if not exists mode text;
    alter table sm_directory_sources add column if not exists default_role text;
    alter table sm_directory_sources add column if not exists membership_role text;
    alter table sm_directory_sources add column if not exists auto_roles boolean not null default false;
    alter table sm_directory_sources add column if not exists deactivate_missing boolean not null default true;
    alter table sm_directory_sources add column if not exists unit_from text;
    alter table sm_directory_sources add column if not exists schedule_hours integer;
    alter table sm_directory_sources add column if not exists approved_by uuid;
    alter table sm_directory_sources add column if not exists ldap_url text;
    alter table sm_directory_sources add column if not exists bind_dn text;
    alter table sm_directory_sources add column if not exists bind_password text;
    alter table sm_directory_sources add column if not exists base_dn text;
    alter table sm_directory_sources add column if not exists user_filter text;
    alter table sm_directory_sources add column if not exists attr_map jsonb;
    alter table sm_directory_sources add column if not exists scim_token text;
    alter table sm_directory_sources add column if not exists group_map jsonb;
    alter table sm_directory_sources add column if not exists login_enabled boolean not null default false;
    alter table sm_directory_sources add column if not exists login_domains jsonb;
    alter table sm_directory_sources add column if not exists tls_mode text;
    alter table sm_directory_sources add column if not exists login_attr text;
    alter table sm_directory_sources add column if not exists dc_urls text;
    alter table sm_directory_sources add column if not exists ca_cert text;
    alter table sm_directory_sources add column if not exists group_base_dn text;
    alter table sm_directory_sources add column if not exists timeout_seconds integer;
    alter table sm_directory_sources add column if not exists nested_groups boolean not null default true;
    alter table sm_directory_sources add column if not exists jit boolean not null default true;
    alter table sm_directory_sources add column if not exists sso_mode text;
    alter table sm_directory_sources add column if not exists sso_auto boolean not null default false;
    alter table sm_directory_sources add column if not exists sso_host text;
    alter table sm_directory_sources add column if not exists sso_account text;
    alter table sm_directory_sources add column if not exists ntlm boolean not null default false;
    alter table sm_directory_sources add column if not exists proxy_header text;
    alter table sm_directory_sources add column if not exists proxy_ips text;
    alter table sm_directory_sources add column if not exists proxy_secret text;
    alter table sm_directory_sources add column if not exists health text;
    alter table sm_directory_sources add column if not exists last_run_at timestamptz;
    alter table sm_directory_sources add column if not exists next_run_at timestamptz;
    alter table sm_directory_sources add column if not exists last_summary text;
    alter table sm_directory_sources add column if not exists approved_map_hash text;
  end if;
end
$cols$;
create table if not exists sm_directory_sources (
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
  mode text,
  default_role text,
  membership_role text,
  auto_roles boolean not null default false,
  deactivate_missing boolean not null default true,
  unit_from text,
  schedule_hours integer,
  approved_by uuid,
  ldap_url text,
  bind_dn text,
  bind_password text,
  base_dn text,
  user_filter text,
  attr_map jsonb,
  scim_token text,
  group_map jsonb,
  login_enabled boolean not null default false,
  login_domains jsonb,
  tls_mode text,
  login_attr text,
  dc_urls text,
  ca_cert text,
  group_base_dn text,
  timeout_seconds integer,
  nested_groups boolean not null default true,
  jit boolean not null default true,
  sso_mode text,
  sso_auto boolean not null default false,
  sso_host text,
  sso_account text,
  ntlm boolean not null default false,
  proxy_header text,
  proxy_ips text,
  proxy_secret text,
  health text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_summary text,
  approved_map_hash text
);
create index if not exists sm_directory_sources_rev_idx on sm_directory_sources (org_id, rev);
create index if not exists sm_directory_sources_upd_idx on sm_directory_sources (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_directory_sources_crt_idx on sm_directory_sources (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_directory_sources_workspace_acc_idx on sm_directory_sources (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_directory_sources_unit_acc_idx on sm_directory_sources (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_directory_sources_domain_acc_idx on sm_directory_sources (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_directory_sources_sync on sm_directory_sources;
create trigger sm_directory_sources_sync before insert or update on sm_directory_sources for each row execute function sm_sync_touch('directory_source');
create or replace trigger sm_directory_sources_demo after insert on sm_directory_sources for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_directory_sources_demo_t after update or delete on sm_directory_sources for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_directory_sources enable row level security;

-- discovery_collector: جمع‌آورنده‌های کشف
do $cols$
begin
  if to_regclass('sm_discovery_collectors') is not null then
    alter table sm_discovery_collectors add column if not exists workspace_id uuid;
    alter table sm_discovery_collectors add column if not exists domain_id uuid;
    alter table sm_discovery_collectors add column if not exists unit_id uuid;
    alter table sm_discovery_collectors add column if not exists created_at timestamptz not null default now();
    alter table sm_discovery_collectors add column if not exists created_by uuid;
    alter table sm_discovery_collectors add column if not exists updated_at timestamptz not null default now();
    alter table sm_discovery_collectors add column if not exists updated_by uuid;
    alter table sm_discovery_collectors add column if not exists rev bigint not null default 0;
    alter table sm_discovery_collectors add column if not exists version integer not null default 1;
    alter table sm_discovery_collectors add column if not exists deleted_at timestamptz;
    alter table sm_discovery_collectors add column if not exists origin text;
    alter table sm_discovery_collectors add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_discovery_collectors add column if not exists name text;
    alter table sm_discovery_collectors add column if not exists kind text;
    alter table sm_discovery_collectors add column if not exists machine_id text;
    alter table sm_discovery_collectors add column if not exists hostname text;
    alter table sm_discovery_collectors add column if not exists platform text;
    alter table sm_discovery_collectors add column if not exists agent_version text;
    alter table sm_discovery_collectors add column if not exists active boolean not null default true;
    alter table sm_discovery_collectors add column if not exists every_hours integer;
    alter table sm_discovery_collectors add column if not exists include_software boolean not null default false;
    alter table sm_discovery_collectors add column if not exists ci_id uuid;
    alter table sm_discovery_collectors add column if not exists source_id uuid;
    alter table sm_discovery_collectors add column if not exists last_heartbeat timestamptz;
    alter table sm_discovery_collectors add column if not exists last_run_at timestamptz;
    alter table sm_discovery_collectors add column if not exists last_result text;
  end if;
end
$cols$;
create table if not exists sm_discovery_collectors (
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
  machine_id text,
  hostname text,
  platform text,
  agent_version text,
  active boolean not null default true,
  every_hours integer,
  include_software boolean not null default false,
  ci_id uuid,
  source_id uuid,
  last_heartbeat timestamptz,
  last_run_at timestamptz,
  last_result text
);
create index if not exists sm_discovery_collectors_rev_idx on sm_discovery_collectors (org_id, rev);
create index if not exists sm_discovery_collectors_upd_idx on sm_discovery_collectors (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_discovery_collectors_crt_idx on sm_discovery_collectors (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_discovery_collectors_machine_id_idx on sm_discovery_collectors (org_id, machine_id) where deleted_at is null;
drop trigger if exists sm_discovery_collectors_sync on sm_discovery_collectors;
create trigger sm_discovery_collectors_sync before insert or update on sm_discovery_collectors for each row execute function sm_sync_touch('discovery_collector');
create or replace trigger sm_discovery_collectors_demo after insert on sm_discovery_collectors for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_discovery_collectors_demo_t after update or delete on sm_discovery_collectors for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_discovery_collectors enable row level security;

-- disposal_item: اقلام اسقاط
do $cols$
begin
  if to_regclass('sm_disposal_items') is not null then
    alter table sm_disposal_items add column if not exists workspace_id uuid;
    alter table sm_disposal_items add column if not exists domain_id uuid;
    alter table sm_disposal_items add column if not exists unit_id uuid;
    alter table sm_disposal_items add column if not exists created_at timestamptz not null default now();
    alter table sm_disposal_items add column if not exists created_by uuid;
    alter table sm_disposal_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_disposal_items add column if not exists updated_by uuid;
    alter table sm_disposal_items add column if not exists rev bigint not null default 0;
    alter table sm_disposal_items add column if not exists version integer not null default 1;
    alter table sm_disposal_items add column if not exists deleted_at timestamptz;
    alter table sm_disposal_items add column if not exists origin text;
    alter table sm_disposal_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_disposal_items add column if not exists order_id uuid;
    alter table sm_disposal_items add column if not exists asset_id uuid;
    alter table sm_disposal_items add column if not exists sanitization_method text;
    alter table sm_disposal_items add column if not exists sanitized_at timestamptz;
    alter table sm_disposal_items add column if not exists sanitized_by uuid;
    alter table sm_disposal_items add column if not exists certificate_no text;
    alter table sm_disposal_items add column if not exists verified boolean not null default false;
    alter table sm_disposal_items add column if not exists wipe_tool text;
    alter table sm_disposal_items add column if not exists witness_id uuid;
    alter table sm_disposal_items add column if not exists evidence_by uuid;
    alter table sm_disposal_items add column if not exists certificate_issued_at timestamptz;
    alter table sm_disposal_items add column if not exists certificate_hash text;
    alter table sm_disposal_items add column if not exists note text;
    alter table sm_disposal_items add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_disposal_items (
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
  order_id uuid,
  asset_id uuid,
  sanitization_method text,
  sanitized_at timestamptz,
  sanitized_by uuid,
  certificate_no text,
  verified boolean not null default false,
  wipe_tool text,
  witness_id uuid,
  evidence_by uuid,
  certificate_issued_at timestamptz,
  certificate_hash text,
  note text,
  label text
);
create index if not exists sm_disposal_items_rev_idx on sm_disposal_items (org_id, rev);
create index if not exists sm_disposal_items_upd_idx on sm_disposal_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_disposal_items_crt_idx on sm_disposal_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_disposal_items_order_id_idx on sm_disposal_items (org_id, order_id) where deleted_at is null;
create index if not exists sm_disposal_items_asset_id_idx on sm_disposal_items (org_id, asset_id) where deleted_at is null;
create unique index if not exists sm_disposal_items_order_id_asset_id_uk on sm_disposal_items (org_id, order_id, asset_id) where deleted_at is null;
drop trigger if exists sm_disposal_items_sync on sm_disposal_items;
create trigger sm_disposal_items_sync before insert or update on sm_disposal_items for each row execute function sm_sync_touch('disposal_item');
create or replace trigger sm_disposal_items_demo after insert on sm_disposal_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_disposal_items_demo_t after update or delete on sm_disposal_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_disposal_items enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:8', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:%') >= 28 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۰ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 10/28 (e746bd22eb04)
-- disposal_order: دستورهای اسقاط
do $cols$
begin
  if to_regclass('sm_disposal_orders') is not null then
    alter table sm_disposal_orders add column if not exists workspace_id uuid;
    alter table sm_disposal_orders add column if not exists domain_id uuid;
    alter table sm_disposal_orders add column if not exists unit_id uuid;
    alter table sm_disposal_orders add column if not exists created_at timestamptz not null default now();
    alter table sm_disposal_orders add column if not exists created_by uuid;
    alter table sm_disposal_orders add column if not exists updated_at timestamptz not null default now();
    alter table sm_disposal_orders add column if not exists updated_by uuid;
    alter table sm_disposal_orders add column if not exists rev bigint not null default 0;
    alter table sm_disposal_orders add column if not exists version integer not null default 1;
    alter table sm_disposal_orders add column if not exists deleted_at timestamptz;
    alter table sm_disposal_orders add column if not exists origin text;
    alter table sm_disposal_orders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_disposal_orders add column if not exists no integer;
    alter table sm_disposal_orders add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'DSP' || no::text else 'DSP' || lpad(no::text, 5, '0') end) stored;
    alter table sm_disposal_orders add column if not exists title text;
    alter table sm_disposal_orders add column if not exists method text;
    alter table sm_disposal_orders add column if not exists vendor_id uuid;
    alter table sm_disposal_orders add column if not exists owner_id uuid;
    alter table sm_disposal_orders add column if not exists group_id uuid;
    alter table sm_disposal_orders add column if not exists approval text;
    alter table sm_disposal_orders add column if not exists certificate_no text;
    alter table sm_disposal_orders add column if not exists certificate_date date;
    alter table sm_disposal_orders add column if not exists proceeds numeric;
    alter table sm_disposal_orders add column if not exists notes text;
    alter table sm_disposal_orders add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_disposal_orders (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'DSP' || no::text else 'DSP' || lpad(no::text, 5, '0') end) stored,
  title text,
  method text,
  vendor_id uuid,
  owner_id uuid,
  group_id uuid,
  approval text,
  certificate_no text,
  certificate_date date,
  proceeds numeric,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_disposal_orders', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_disposal_orders_search_cae18f1d_trgm', 'sm_disposal_orders', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_disposal_orders_search_custom_trgm', 'sm_disposal_orders', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_disposal_orders_no_uk on sm_disposal_orders (org_id, no);
create index if not exists sm_disposal_orders_rev_idx on sm_disposal_orders (org_id, rev);
create index if not exists sm_disposal_orders_upd_idx on sm_disposal_orders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_disposal_orders_crt_idx on sm_disposal_orders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_disposal_orders_state_idx on sm_disposal_orders (org_id, state) where deleted_at is null;
create index if not exists sm_disposal_orders_workspace_acc_idx on sm_disposal_orders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_disposal_orders_unit_acc_idx on sm_disposal_orders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_disposal_orders_domain_acc_idx on sm_disposal_orders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_disposal_orders_owner_id_idx on sm_disposal_orders (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_disposal_orders_sync on sm_disposal_orders;
create trigger sm_disposal_orders_sync before insert or update on sm_disposal_orders for each row execute function sm_sync_touch('disposal_order');
create or replace trigger sm_disposal_orders_demo after insert on sm_disposal_orders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_disposal_orders_demo_t after update or delete on sm_disposal_orders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_disposal_orders enable row level security;

-- doc_collection: مجموعه‌های اسناد
do $cols$
begin
  if to_regclass('sm_doc_collections') is not null then
    alter table sm_doc_collections add column if not exists workspace_id uuid;
    alter table sm_doc_collections add column if not exists domain_id uuid;
    alter table sm_doc_collections add column if not exists unit_id uuid;
    alter table sm_doc_collections add column if not exists created_at timestamptz not null default now();
    alter table sm_doc_collections add column if not exists created_by uuid;
    alter table sm_doc_collections add column if not exists updated_at timestamptz not null default now();
    alter table sm_doc_collections add column if not exists updated_by uuid;
    alter table sm_doc_collections add column if not exists rev bigint not null default 0;
    alter table sm_doc_collections add column if not exists version integer not null default 1;
    alter table sm_doc_collections add column if not exists deleted_at timestamptz;
    alter table sm_doc_collections add column if not exists origin text;
    alter table sm_doc_collections add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_doc_collections add column if not exists name text;
    alter table sm_doc_collections add column if not exists classification text;
    alter table sm_doc_collections add column if not exists description text;
    alter table sm_doc_collections add column if not exists owner_id uuid;
    alter table sm_doc_collections add column if not exists sharing text;
    alter table sm_doc_collections add column if not exists share_users jsonb;
    alter table sm_doc_collections add column if not exists share_groups jsonb;
    alter table sm_doc_collections add column if not exists share_units jsonb;
    alter table sm_doc_collections add column if not exists ai_enabled boolean not null default true;
    alter table sm_doc_collections add column if not exists open_contrib boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_doc_collections (
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
  classification text,
  description text,
  owner_id uuid,
  sharing text,
  share_users jsonb,
  share_groups jsonb,
  share_units jsonb,
  ai_enabled boolean not null default true,
  open_contrib boolean not null default false
);
create index if not exists sm_doc_collections_rev_idx on sm_doc_collections (org_id, rev);
create index if not exists sm_doc_collections_upd_idx on sm_doc_collections (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_doc_collections_crt_idx on sm_doc_collections (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_doc_collections_owner_id_idx on sm_doc_collections (org_id, owner_id) where deleted_at is null;
create index if not exists sm_doc_collections_workspace_acc_idx on sm_doc_collections (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_doc_collections_unit_acc_idx on sm_doc_collections (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_doc_collections_domain_acc_idx on sm_doc_collections (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_doc_collections_sync on sm_doc_collections;
create trigger sm_doc_collections_sync before insert or update on sm_doc_collections for each row execute function sm_sync_touch('doc_collection');
create or replace trigger sm_doc_collections_demo after insert on sm_doc_collections for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_doc_collections_demo_t after update or delete on sm_doc_collections for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_doc_collections enable row level security;

-- doc_document: اسناد
do $cols$
begin
  if to_regclass('sm_doc_documents') is not null then
    alter table sm_doc_documents add column if not exists workspace_id uuid;
    alter table sm_doc_documents add column if not exists domain_id uuid;
    alter table sm_doc_documents add column if not exists unit_id uuid;
    alter table sm_doc_documents add column if not exists created_at timestamptz not null default now();
    alter table sm_doc_documents add column if not exists created_by uuid;
    alter table sm_doc_documents add column if not exists updated_at timestamptz not null default now();
    alter table sm_doc_documents add column if not exists updated_by uuid;
    alter table sm_doc_documents add column if not exists rev bigint not null default 0;
    alter table sm_doc_documents add column if not exists version integer not null default 1;
    alter table sm_doc_documents add column if not exists deleted_at timestamptz;
    alter table sm_doc_documents add column if not exists origin text;
    alter table sm_doc_documents add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_doc_documents add column if not exists title text;
    alter table sm_doc_documents add column if not exists collection_id uuid;
    alter table sm_doc_documents add column if not exists owner_id uuid;
    alter table sm_doc_documents add column if not exists status text;
    alter table sm_doc_documents add column if not exists language text;
    alter table sm_doc_documents add column if not exists pages integer;
    alter table sm_doc_documents add column if not exists file_id text;
    alter table sm_doc_documents add column if not exists file_name text;
    alter table sm_doc_documents add column if not exists mime text;
    alter table sm_doc_documents add column if not exists size integer;
    alter table sm_doc_documents add column if not exists ocr boolean not null default false;
    alter table sm_doc_documents add column if not exists error text;
    alter table sm_doc_documents add column if not exists summary text;
    alter table sm_doc_documents add column if not exists tags jsonb;
  end if;
end
$cols$;
create table if not exists sm_doc_documents (
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
  collection_id uuid,
  owner_id uuid,
  status text,
  language text,
  pages integer,
  file_id text,
  file_name text,
  mime text,
  size integer,
  ocr boolean not null default false,
  error text,
  summary text,
  tags jsonb
);
create index if not exists sm_doc_documents_rev_idx on sm_doc_documents (org_id, rev);
create index if not exists sm_doc_documents_upd_idx on sm_doc_documents (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_doc_documents_crt_idx on sm_doc_documents (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_doc_documents_collection_id_idx on sm_doc_documents (org_id, collection_id) where deleted_at is null;
create index if not exists sm_doc_documents_owner_id_idx on sm_doc_documents (org_id, owner_id) where deleted_at is null;
create index if not exists sm_doc_documents_workspace_acc_idx on sm_doc_documents (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_doc_documents_unit_acc_idx on sm_doc_documents (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_doc_documents_domain_acc_idx on sm_doc_documents (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_doc_documents_sync on sm_doc_documents;
create trigger sm_doc_documents_sync before insert or update on sm_doc_documents for each row execute function sm_sync_touch('doc_document');
create or replace trigger sm_doc_documents_demo after insert on sm_doc_documents for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_doc_documents_demo_t after update or delete on sm_doc_documents for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_doc_documents enable row level security;

-- email_channel: کانال‌های ایمیل
do $cols$
begin
  if to_regclass('sm_email_channels') is not null then
    alter table sm_email_channels add column if not exists workspace_id uuid;
    alter table sm_email_channels add column if not exists domain_id uuid;
    alter table sm_email_channels add column if not exists unit_id uuid;
    alter table sm_email_channels add column if not exists created_at timestamptz not null default now();
    alter table sm_email_channels add column if not exists created_by uuid;
    alter table sm_email_channels add column if not exists updated_at timestamptz not null default now();
    alter table sm_email_channels add column if not exists updated_by uuid;
    alter table sm_email_channels add column if not exists rev bigint not null default 0;
    alter table sm_email_channels add column if not exists version integer not null default 1;
    alter table sm_email_channels add column if not exists deleted_at timestamptz;
    alter table sm_email_channels add column if not exists origin text;
    alter table sm_email_channels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_email_channels add column if not exists name text;
    alter table sm_email_channels add column if not exists active boolean not null default true;
    alter table sm_email_channels add column if not exists is_default boolean not null default false;
    alter table sm_email_channels add column if not exists from_name text;
    alter table sm_email_channels add column if not exists from_address text;
    alter table sm_email_channels add column if not exists reply_to text;
    alter table sm_email_channels add column if not exists smtp_host text;
    alter table sm_email_channels add column if not exists smtp_port integer;
    alter table sm_email_channels add column if not exists smtp_security text;
    alter table sm_email_channels add column if not exists smtp_user text;
    alter table sm_email_channels add column if not exists smtp_password text;
    alter table sm_email_channels add column if not exists inbound boolean not null default false;
    alter table sm_email_channels add column if not exists imap_host text;
    alter table sm_email_channels add column if not exists imap_port integer;
    alter table sm_email_channels add column if not exists imap_security text;
    alter table sm_email_channels add column if not exists imap_user text;
    alter table sm_email_channels add column if not exists imap_password text;
    alter table sm_email_channels add column if not exists imap_folder text;
    alter table sm_email_channels add column if not exists target_table text;
    alter table sm_email_channels add column if not exists allow_list jsonb;
    alter table sm_email_channels add column if not exists deny_list jsonb;
    alter table sm_email_channels add column if not exists signature text;
    alter table sm_email_channels add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_email_channels (
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
  is_default boolean not null default false,
  from_name text,
  from_address text,
  reply_to text,
  smtp_host text,
  smtp_port integer,
  smtp_security text,
  smtp_user text,
  smtp_password text,
  inbound boolean not null default false,
  imap_host text,
  imap_port integer,
  imap_security text,
  imap_user text,
  imap_password text,
  imap_folder text,
  target_table text,
  allow_list jsonb,
  deny_list jsonb,
  signature text,
  description text
);
create index if not exists sm_email_channels_rev_idx on sm_email_channels (org_id, rev);
create index if not exists sm_email_channels_upd_idx on sm_email_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_email_channels_crt_idx on sm_email_channels (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_email_channels_sync on sm_email_channels;
create trigger sm_email_channels_sync before insert or update on sm_email_channels for each row execute function sm_sync_touch('email_channel');
create or replace trigger sm_email_channels_demo after insert on sm_email_channels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_email_channels_demo_t after update or delete on sm_email_channels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_email_channels enable row level security;

-- entitlement: استحقاق‌ها
do $cols$
begin
  if to_regclass('sm_entitlements') is not null then
    alter table sm_entitlements add column if not exists workspace_id uuid;
    alter table sm_entitlements add column if not exists domain_id uuid;
    alter table sm_entitlements add column if not exists unit_id uuid;
    alter table sm_entitlements add column if not exists created_at timestamptz not null default now();
    alter table sm_entitlements add column if not exists created_by uuid;
    alter table sm_entitlements add column if not exists updated_at timestamptz not null default now();
    alter table sm_entitlements add column if not exists updated_by uuid;
    alter table sm_entitlements add column if not exists rev bigint not null default 0;
    alter table sm_entitlements add column if not exists version integer not null default 1;
    alter table sm_entitlements add column if not exists deleted_at timestamptz;
    alter table sm_entitlements add column if not exists origin text;
    alter table sm_entitlements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_entitlements add column if not exists no integer;
    alter table sm_entitlements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ENT' || no::text else 'ENT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_entitlements add column if not exists name text;
    alter table sm_entitlements add column if not exists account_id uuid;
    alter table sm_entitlements add column if not exists contract_id uuid;
    alter table sm_entitlements add column if not exists product_id uuid;
    alter table sm_entitlements add column if not exists ibi_id uuid;
    alter table sm_entitlements add column if not exists contact_id uuid;
    alter table sm_entitlements add column if not exists support_level text;
    alter table sm_entitlements add column if not exists channels jsonb;
    alter table sm_entitlements add column if not exists coverage_calendar_id uuid;
    alter table sm_entitlements add column if not exists response_hours integer;
    alter table sm_entitlements add column if not exists resolution_hours integer;
    alter table sm_entitlements add column if not exists starts_on date;
    alter table sm_entitlements add column if not exists ends_on date;
    alter table sm_entitlements add column if not exists unit_type text;
    alter table sm_entitlements add column if not exists units_total numeric;
    alter table sm_entitlements add column if not exists units_used numeric;
    alter table sm_entitlements add column if not exists units_remaining numeric;
    alter table sm_entitlements add column if not exists warn_percent integer;
    alter table sm_entitlements add column if not exists block_when_exhausted boolean not null default false;
    alter table sm_entitlements add column if not exists service_credit_pct numeric;
    alter table sm_entitlements add column if not exists credits_earned numeric;
    alter table sm_entitlements add column if not exists notes text;
    alter table sm_entitlements add column if not exists support_group_id uuid;
    alter table sm_entitlements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_entitlements (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ENT' || no::text else 'ENT' || lpad(no::text, 6, '0') end) stored,
  name text,
  account_id uuid,
  contract_id uuid,
  product_id uuid,
  ibi_id uuid,
  contact_id uuid,
  support_level text,
  channels jsonb,
  coverage_calendar_id uuid,
  response_hours integer,
  resolution_hours integer,
  starts_on date,
  ends_on date,
  unit_type text,
  units_total numeric,
  units_used numeric,
  units_remaining numeric,
  warn_percent integer,
  block_when_exhausted boolean not null default false,
  service_credit_pct numeric,
  credits_earned numeric,
  notes text,
  support_group_id uuid,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_entitlements', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_entitlements_search_56291d9d_trgm', 'sm_entitlements', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_entitlements_search_custom_trgm', 'sm_entitlements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_entitlements_no_uk on sm_entitlements (org_id, no);
create index if not exists sm_entitlements_rev_idx on sm_entitlements (org_id, rev);
create index if not exists sm_entitlements_upd_idx on sm_entitlements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_entitlements_crt_idx on sm_entitlements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_entitlements_account_id_idx on sm_entitlements (org_id, account_id) where deleted_at is null;
create index if not exists sm_entitlements_contract_id_idx on sm_entitlements (org_id, contract_id) where deleted_at is null;
create index if not exists sm_entitlements_product_id_idx on sm_entitlements (org_id, product_id) where deleted_at is null;
create index if not exists sm_entitlements_support_group_id_idx on sm_entitlements (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_entitlements_state_idx on sm_entitlements (org_id, state) where deleted_at is null;
create index if not exists sm_entitlements_workspace_acc_idx on sm_entitlements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_entitlements_unit_acc_idx on sm_entitlements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_entitlements_domain_acc_idx on sm_entitlements (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_entitlements_sync on sm_entitlements;
create trigger sm_entitlements_sync before insert or update on sm_entitlements for each row execute function sm_sync_touch('entitlement');
create or replace trigger sm_entitlements_demo after insert on sm_entitlements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_entitlements_demo_t after update or delete on sm_entitlements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_entitlements enable row level security;

-- entitlement_ledger: دفتر مصرف استحقاق
do $cols$
begin
  if to_regclass('sm_entitlement_ledger') is not null then
    alter table sm_entitlement_ledger add column if not exists workspace_id uuid;
    alter table sm_entitlement_ledger add column if not exists domain_id uuid;
    alter table sm_entitlement_ledger add column if not exists unit_id uuid;
    alter table sm_entitlement_ledger add column if not exists created_at timestamptz not null default now();
    alter table sm_entitlement_ledger add column if not exists created_by uuid;
    alter table sm_entitlement_ledger add column if not exists updated_at timestamptz not null default now();
    alter table sm_entitlement_ledger add column if not exists updated_by uuid;
    alter table sm_entitlement_ledger add column if not exists rev bigint not null default 0;
    alter table sm_entitlement_ledger add column if not exists version integer not null default 1;
    alter table sm_entitlement_ledger add column if not exists deleted_at timestamptz;
    alter table sm_entitlement_ledger add column if not exists origin text;
    alter table sm_entitlement_ledger add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_entitlement_ledger add column if not exists entitlement_id uuid;
    alter table sm_entitlement_ledger add column if not exists case_id uuid;
    alter table sm_entitlement_ledger add column if not exists at timestamptz;
    alter table sm_entitlement_ledger add column if not exists delta numeric;
    alter table sm_entitlement_ledger add column if not exists balance_after numeric;
    alter table sm_entitlement_ledger add column if not exists reason text;
    alter table sm_entitlement_ledger add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_entitlement_ledger (
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
  entitlement_id uuid,
  case_id uuid,
  at timestamptz,
  delta numeric,
  balance_after numeric,
  reason text,
  support_group_id uuid
);
create index if not exists sm_entitlement_ledger_rev_idx on sm_entitlement_ledger (org_id, rev);
create index if not exists sm_entitlement_ledger_upd_idx on sm_entitlement_ledger (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_entitlement_ledger_crt_idx on sm_entitlement_ledger (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_entitlement_ledger_entitlement_id_idx on sm_entitlement_ledger (org_id, entitlement_id) where deleted_at is null;
create index if not exists sm_entitlement_ledger_case_id_idx on sm_entitlement_ledger (org_id, case_id) where deleted_at is null;
create index if not exists sm_entitlement_ledger_support_group_id_idx on sm_entitlement_ledger (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_entitlement_ledger_workspace_acc_idx on sm_entitlement_ledger (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_entitlement_ledger_unit_acc_idx on sm_entitlement_ledger (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_entitlement_ledger_domain_acc_idx on sm_entitlement_ledger (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_entitlement_ledger_sync on sm_entitlement_ledger;
create trigger sm_entitlement_ledger_sync before insert or update on sm_entitlement_ledger for each row execute function sm_sync_touch('entitlement_ledger');
create or replace trigger sm_entitlement_ledger_demo after insert on sm_entitlement_ledger for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_entitlement_ledger_demo_t after update or delete on sm_entitlement_ledger for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_entitlement_ledger enable row level security;

-- environment_booking: رزروهای محیط
do $cols$
begin
  if to_regclass('sm_environment_bookings') is not null then
    alter table sm_environment_bookings add column if not exists workspace_id uuid;
    alter table sm_environment_bookings add column if not exists domain_id uuid;
    alter table sm_environment_bookings add column if not exists unit_id uuid;
    alter table sm_environment_bookings add column if not exists created_at timestamptz not null default now();
    alter table sm_environment_bookings add column if not exists created_by uuid;
    alter table sm_environment_bookings add column if not exists updated_at timestamptz not null default now();
    alter table sm_environment_bookings add column if not exists updated_by uuid;
    alter table sm_environment_bookings add column if not exists rev bigint not null default 0;
    alter table sm_environment_bookings add column if not exists version integer not null default 1;
    alter table sm_environment_bookings add column if not exists deleted_at timestamptz;
    alter table sm_environment_bookings add column if not exists origin text;
    alter table sm_environment_bookings add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_environment_bookings add column if not exists no integer;
    alter table sm_environment_bookings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EB' || no::text else 'EB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_environment_bookings add column if not exists environment_id uuid;
    alter table sm_environment_bookings add column if not exists purpose text;
    alter table sm_environment_bookings add column if not exists requested_by uuid;
    alter table sm_environment_bookings add column if not exists release_id uuid;
    alter table sm_environment_bookings add column if not exists start_at timestamptz;
    alter table sm_environment_bookings add column if not exists end_at timestamptz;
    alter table sm_environment_bookings add column if not exists notes text;
    alter table sm_environment_bookings add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_environment_bookings (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EB' || no::text else 'EB' || lpad(no::text, 6, '0') end) stored,
  environment_id uuid,
  purpose text,
  requested_by uuid,
  release_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  notes text,
  state text,
  search_062cb4a6 text generated always as (translate(coalesce(purpose, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_environment_bookings', 'search_062cb4a6', $x$translate(coalesce(purpose, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_environment_bookings_search_062cb4a6_trgm', 'sm_environment_bookings', 'search_062cb4a6', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_environment_bookings_search_custom_trgm', 'sm_environment_bookings', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_environment_bookings_no_uk on sm_environment_bookings (org_id, no);
create index if not exists sm_environment_bookings_rev_idx on sm_environment_bookings (org_id, rev);
create index if not exists sm_environment_bookings_upd_idx on sm_environment_bookings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_environment_bookings_crt_idx on sm_environment_bookings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_environment_bookings_environment_id_idx on sm_environment_bookings (org_id, environment_id) where deleted_at is null;
create index if not exists sm_environment_bookings_state_idx on sm_environment_bookings (org_id, state) where deleted_at is null;
create index if not exists sm_environment_bookings_workspace_acc_idx on sm_environment_bookings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_environment_bookings_unit_acc_idx on sm_environment_bookings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_environment_bookings_domain_acc_idx on sm_environment_bookings (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_environment_bookings_requested_by_idx on sm_environment_bookings (org_id, requested_by) where deleted_at is null;
drop trigger if exists sm_environment_bookings_sync on sm_environment_bookings;
create trigger sm_environment_bookings_sync before insert or update on sm_environment_bookings for each row execute function sm_sync_touch('environment_booking');
create or replace trigger sm_environment_bookings_demo after insert on sm_environment_bookings for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_environment_bookings_demo_t after update or delete on sm_environment_bookings for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_environment_bookings enable row level security;

-- escalation_level: سطح‌های ارتقا
do $cols$
begin
  if to_regclass('sm_escalation_levels') is not null then
    alter table sm_escalation_levels add column if not exists workspace_id uuid;
    alter table sm_escalation_levels add column if not exists domain_id uuid;
    alter table sm_escalation_levels add column if not exists unit_id uuid;
    alter table sm_escalation_levels add column if not exists created_at timestamptz not null default now();
    alter table sm_escalation_levels add column if not exists created_by uuid;
    alter table sm_escalation_levels add column if not exists updated_at timestamptz not null default now();
    alter table sm_escalation_levels add column if not exists updated_by uuid;
    alter table sm_escalation_levels add column if not exists rev bigint not null default 0;
    alter table sm_escalation_levels add column if not exists version integer not null default 1;
    alter table sm_escalation_levels add column if not exists deleted_at timestamptz;
    alter table sm_escalation_levels add column if not exists origin text;
    alter table sm_escalation_levels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_escalation_levels add column if not exists policy_id uuid;
    alter table sm_escalation_levels add column if not exists level integer;
    alter table sm_escalation_levels add column if not exists delay_minutes integer;
    alter table sm_escalation_levels add column if not exists target text;
    alter table sm_escalation_levels add column if not exists schedule_id uuid;
    alter table sm_escalation_levels add column if not exists users jsonb;
    alter table sm_escalation_levels add column if not exists target_group_id uuid;
    alter table sm_escalation_levels add column if not exists channels jsonb;
    alter table sm_escalation_levels add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_escalation_levels (
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
  policy_id uuid,
  level integer,
  delay_minutes integer,
  target text,
  schedule_id uuid,
  users jsonb,
  target_group_id uuid,
  channels jsonb,
  description text
);
create index if not exists sm_escalation_levels_rev_idx on sm_escalation_levels (org_id, rev);
create index if not exists sm_escalation_levels_upd_idx on sm_escalation_levels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_escalation_levels_crt_idx on sm_escalation_levels (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_escalation_levels_policy_id_idx on sm_escalation_levels (org_id, policy_id) where deleted_at is null;
create unique index if not exists sm_escalation_levels_policy_id_level_uk on sm_escalation_levels (org_id, policy_id, level) where deleted_at is null;
drop trigger if exists sm_escalation_levels_sync on sm_escalation_levels;
create trigger sm_escalation_levels_sync before insert or update on sm_escalation_levels for each row execute function sm_sync_touch('escalation_level');
create or replace trigger sm_escalation_levels_demo after insert on sm_escalation_levels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_escalation_levels_demo_t after update or delete on sm_escalation_levels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_escalation_levels enable row level security;

-- escalation_policy: سیاست‌های ارتقا
do $cols$
begin
  if to_regclass('sm_escalation_policies') is not null then
    alter table sm_escalation_policies add column if not exists workspace_id uuid;
    alter table sm_escalation_policies add column if not exists domain_id uuid;
    alter table sm_escalation_policies add column if not exists unit_id uuid;
    alter table sm_escalation_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_escalation_policies add column if not exists created_by uuid;
    alter table sm_escalation_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_escalation_policies add column if not exists updated_by uuid;
    alter table sm_escalation_policies add column if not exists rev bigint not null default 0;
    alter table sm_escalation_policies add column if not exists version integer not null default 1;
    alter table sm_escalation_policies add column if not exists deleted_at timestamptz;
    alter table sm_escalation_policies add column if not exists origin text;
    alter table sm_escalation_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_escalation_policies add column if not exists name text;
    alter table sm_escalation_policies add column if not exists group_id uuid;
    alter table sm_escalation_policies add column if not exists active boolean not null default true;
    alter table sm_escalation_policies add column if not exists is_default boolean not null default false;
    alter table sm_escalation_policies add column if not exists repeat_times integer;
    alter table sm_escalation_policies add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_escalation_policies (
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
  group_id uuid,
  active boolean not null default true,
  is_default boolean not null default false,
  repeat_times integer,
  description text
);
create index if not exists sm_escalation_policies_rev_idx on sm_escalation_policies (org_id, rev);
create index if not exists sm_escalation_policies_upd_idx on sm_escalation_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_escalation_policies_crt_idx on sm_escalation_policies (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_escalation_policies_workspace_acc_idx on sm_escalation_policies (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_escalation_policies_unit_acc_idx on sm_escalation_policies (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_escalation_policies_domain_acc_idx on sm_escalation_policies (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_escalation_policies_open_grp_idx on sm_escalation_policies (org_id, group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_escalation_policies_sync on sm_escalation_policies;
create trigger sm_escalation_policies_sync before insert or update on sm_escalation_policies for each row execute function sm_sync_touch('escalation_policy');
create or replace trigger sm_escalation_policies_demo after insert on sm_escalation_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_escalation_policies_demo_t after update or delete on sm_escalation_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_escalation_policies enable row level security;

-- esm_config: تنظیمات خدمات سازمانی
do $cols$
begin
  if to_regclass('sm_esm_config') is not null then
    alter table sm_esm_config add column if not exists workspace_id uuid;
    alter table sm_esm_config add column if not exists domain_id uuid;
    alter table sm_esm_config add column if not exists unit_id uuid;
    alter table sm_esm_config add column if not exists created_at timestamptz not null default now();
    alter table sm_esm_config add column if not exists created_by uuid;
    alter table sm_esm_config add column if not exists updated_at timestamptz not null default now();
    alter table sm_esm_config add column if not exists updated_by uuid;
    alter table sm_esm_config add column if not exists rev bigint not null default 0;
    alter table sm_esm_config add column if not exists version integer not null default 1;
    alter table sm_esm_config add column if not exists deleted_at timestamptz;
    alter table sm_esm_config add column if not exists origin text;
    alter table sm_esm_config add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_esm_config add column if not exists name text;
    alter table sm_esm_config add column if not exists config_key text;
    alter table sm_esm_config add column if not exists auto_close_days integer;
    alter table sm_esm_config add column if not exists no_show_grace_minutes integer;
    alter table sm_esm_config add column if not exists masked_title text;
    alter table sm_esm_config add column if not exists journey_horizon_days integer;
    alter table sm_esm_config add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_esm_config (
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
  no_show_grace_minutes integer,
  masked_title text,
  journey_horizon_days integer,
  seeded integer
);
create index if not exists sm_esm_config_rev_idx on sm_esm_config (org_id, rev);
create index if not exists sm_esm_config_upd_idx on sm_esm_config (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_esm_config_crt_idx on sm_esm_config (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_esm_config_config_key_uk on sm_esm_config (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_esm_config_sync on sm_esm_config;
create trigger sm_esm_config_sync before insert or update on sm_esm_config for each row execute function sm_sync_touch('esm_config');
create or replace trigger sm_esm_config_demo after insert on sm_esm_config for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_esm_config_demo_t after update or delete on sm_esm_config for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_esm_config enable row level security;

-- esm_department: واحدهای خدمت‌دهنده
do $cols$
begin
  if to_regclass('sm_esm_departments') is not null then
    alter table sm_esm_departments add column if not exists workspace_id uuid;
    alter table sm_esm_departments add column if not exists domain_id uuid;
    alter table sm_esm_departments add column if not exists unit_id uuid;
    alter table sm_esm_departments add column if not exists created_at timestamptz not null default now();
    alter table sm_esm_departments add column if not exists created_by uuid;
    alter table sm_esm_departments add column if not exists updated_at timestamptz not null default now();
    alter table sm_esm_departments add column if not exists updated_by uuid;
    alter table sm_esm_departments add column if not exists rev bigint not null default 0;
    alter table sm_esm_departments add column if not exists version integer not null default 1;
    alter table sm_esm_departments add column if not exists deleted_at timestamptz;
    alter table sm_esm_departments add column if not exists origin text;
    alter table sm_esm_departments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_esm_departments add column if not exists name text;
    alter table sm_esm_departments add column if not exists key text;
    alter table sm_esm_departments add column if not exists kind text;
    alter table sm_esm_departments add column if not exists status text;
    alter table sm_esm_departments add column if not exists dept_workspace_id uuid;
    alter table sm_esm_departments add column if not exists case_table text;
    alter table sm_esm_departments add column if not exists default_group_id uuid;
    alter table sm_esm_departments add column if not exists manager_id uuid;
    alter table sm_esm_departments add column if not exists admins jsonb;
    alter table sm_esm_departments add column if not exists calendar_id uuid;
    alter table sm_esm_departments add column if not exists catalog_id uuid;
    alter table sm_esm_departments add column if not exists kb_base_id uuid;
    alter table sm_esm_departments add column if not exists sensitive boolean not null default false;
    alter table sm_esm_departments add column if not exists portal_visible boolean not null default true;
    alter table sm_esm_departments add column if not exists portal_order integer;
    alter table sm_esm_departments add column if not exists icon text;
    alter table sm_esm_departments add column if not exists color text;
    alter table sm_esm_departments add column if not exists pack_key text;
    alter table sm_esm_departments add column if not exists pack_version integer;
    alter table sm_esm_departments add column if not exists intro text;
    alter table sm_esm_departments add column if not exists description text;
    alter table sm_esm_departments add column if not exists dept_admins jsonb;
  end if;
end
$cols$;
create table if not exists sm_esm_departments (
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
  kind text,
  status text,
  dept_workspace_id uuid,
  case_table text,
  default_group_id uuid,
  manager_id uuid,
  admins jsonb,
  calendar_id uuid,
  catalog_id uuid,
  kb_base_id uuid,
  sensitive boolean not null default false,
  portal_visible boolean not null default true,
  portal_order integer,
  icon text,
  color text,
  pack_key text,
  pack_version integer,
  intro text,
  description text,
  dept_admins jsonb
);
create index if not exists sm_esm_departments_rev_idx on sm_esm_departments (org_id, rev);
create index if not exists sm_esm_departments_upd_idx on sm_esm_departments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_esm_departments_crt_idx on sm_esm_departments (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_esm_departments_key_uk on sm_esm_departments (org_id, key) where deleted_at is null;
create unique index if not exists sm_esm_departments_dept_workspace_id_uk on sm_esm_departments (org_id, dept_workspace_id) where deleted_at is null;
create index if not exists sm_esm_departments_workspace_acc_idx on sm_esm_departments (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_esm_departments_unit_acc_idx on sm_esm_departments (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_esm_departments_domain_acc_idx on sm_esm_departments (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_esm_departments_dept_admins_gin on sm_esm_departments using gin (dept_admins);
drop trigger if exists sm_esm_departments_sync on sm_esm_departments;
create trigger sm_esm_departments_sync before insert or update on sm_esm_departments for each row execute function sm_sync_touch('esm_department');
create or replace trigger sm_esm_departments_demo after insert on sm_esm_departments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_esm_departments_demo_t after update or delete on sm_esm_departments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_esm_departments enable row level security;

-- esm_service: خدمت‌های واحدها
do $cols$
begin
  if to_regclass('sm_esm_services') is not null then
    alter table sm_esm_services add column if not exists workspace_id uuid;
    alter table sm_esm_services add column if not exists domain_id uuid;
    alter table sm_esm_services add column if not exists unit_id uuid;
    alter table sm_esm_services add column if not exists created_at timestamptz not null default now();
    alter table sm_esm_services add column if not exists created_by uuid;
    alter table sm_esm_services add column if not exists updated_at timestamptz not null default now();
    alter table sm_esm_services add column if not exists updated_by uuid;
    alter table sm_esm_services add column if not exists rev bigint not null default 0;
    alter table sm_esm_services add column if not exists version integer not null default 1;
    alter table sm_esm_services add column if not exists deleted_at timestamptz;
    alter table sm_esm_services add column if not exists origin text;
    alter table sm_esm_services add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_esm_services add column if not exists name text;
    alter table sm_esm_services add column if not exists department_id uuid;
    alter table sm_esm_services add column if not exists category text;
    alter table sm_esm_services add column if not exists topic text;
    alter table sm_esm_services add column if not exists code text;
    alter table sm_esm_services add column if not exists case_table text;
    alter table sm_esm_services add column if not exists case_category text;
    alter table sm_esm_services add column if not exists catalog_item_id uuid;
    alter table sm_esm_services add column if not exists group_id uuid;
    alter table sm_esm_services add column if not exists priority text;
    alter table sm_esm_services add column if not exists journey_template_id uuid;
    alter table sm_esm_services add column if not exists on_behalf text;
    alter table sm_esm_services add column if not exists audience jsonb;
    alter table sm_esm_services add column if not exists confidential boolean not null default false;
    alter table sm_esm_services add column if not exists sensitive boolean not null default false;
    alter table sm_esm_services add column if not exists subject_visible boolean not null default true;
    alter table sm_esm_services add column if not exists target_hours integer;
    alter table sm_esm_services add column if not exists keywords jsonb;
    alter table sm_esm_services add column if not exists icon text;
    alter table sm_esm_services add column if not exists sort_order integer;
    alter table sm_esm_services add column if not exists active boolean not null default true;
    alter table sm_esm_services add column if not exists description text;
    alter table sm_esm_services add column if not exists dept_admins jsonb;
  end if;
end
$cols$;
create table if not exists sm_esm_services (
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
  department_id uuid,
  category text,
  topic text,
  code text,
  case_table text,
  case_category text,
  catalog_item_id uuid,
  group_id uuid,
  priority text,
  journey_template_id uuid,
  on_behalf text,
  audience jsonb,
  confidential boolean not null default false,
  sensitive boolean not null default false,
  subject_visible boolean not null default true,
  target_hours integer,
  keywords jsonb,
  icon text,
  sort_order integer,
  active boolean not null default true,
  description text,
  dept_admins jsonb
);
create index if not exists sm_esm_services_rev_idx on sm_esm_services (org_id, rev);
create index if not exists sm_esm_services_upd_idx on sm_esm_services (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_esm_services_crt_idx on sm_esm_services (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_esm_services_department_id_idx on sm_esm_services (org_id, department_id) where deleted_at is null;
create unique index if not exists sm_esm_services_code_uk on sm_esm_services (org_id, code) where deleted_at is null;
create index if not exists sm_esm_services_workspace_acc_idx on sm_esm_services (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_esm_services_unit_acc_idx on sm_esm_services (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_esm_services_domain_acc_idx on sm_esm_services (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_esm_services_dept_admins_gin on sm_esm_services using gin (dept_admins);
drop trigger if exists sm_esm_services_sync on sm_esm_services;
create trigger sm_esm_services_sync before insert or update on sm_esm_services for each row execute function sm_sync_touch('esm_service');
create or replace trigger sm_esm_services_demo after insert on sm_esm_services for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_esm_services_demo_t after update or delete on sm_esm_services for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_esm_services enable row level security;

-- event: رویدادها
do $cols$
begin
  if to_regclass('sm_events') is not null then
    alter table sm_events add column if not exists workspace_id uuid;
    alter table sm_events add column if not exists domain_id uuid;
    alter table sm_events add column if not exists unit_id uuid;
    alter table sm_events add column if not exists created_at timestamptz not null default now();
    alter table sm_events add column if not exists created_by uuid;
    alter table sm_events add column if not exists updated_at timestamptz not null default now();
    alter table sm_events add column if not exists updated_by uuid;
    alter table sm_events add column if not exists rev bigint not null default 0;
    alter table sm_events add column if not exists version integer not null default 1;
    alter table sm_events add column if not exists deleted_at timestamptz;
    alter table sm_events add column if not exists origin text;
    alter table sm_events add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_events add column if not exists message text;
    alter table sm_events add column if not exists source_id uuid;
    alter table sm_events add column if not exists status text;
    alter table sm_events add column if not exists severity text;
    alter table sm_events add column if not exists node text;
    alter table sm_events add column if not exists resource text;
    alter table sm_events add column if not exists metric text;
    alter table sm_events add column if not exists value numeric;
    alter table sm_events add column if not exists tags jsonb;
    alter table sm_events add column if not exists description text;
    alter table sm_events add column if not exists occurred_at timestamptz;
    alter table sm_events add column if not exists received_at timestamptz;
    alter table sm_events add column if not exists processed_at timestamptz;
    alter table sm_events add column if not exists fingerprint text;
    alter table sm_events add column if not exists dedupe_key text;
    alter table sm_events add column if not exists ci_id uuid;
    alter table sm_events add column if not exists service_id uuid;
    alter table sm_events add column if not exists assignment_group_id uuid;
    alter table sm_events add column if not exists alert_id uuid;
    alter table sm_events add column if not exists outcome text;
    alter table sm_events add column if not exists decision jsonb;
    alter table sm_events add column if not exists payload jsonb;
  end if;
end
$cols$;
create table if not exists sm_events (
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
  message text,
  source_id uuid,
  status text,
  severity text,
  node text,
  resource text,
  metric text,
  value numeric,
  tags jsonb,
  description text,
  occurred_at timestamptz,
  received_at timestamptz,
  processed_at timestamptz,
  fingerprint text,
  dedupe_key text,
  ci_id uuid,
  service_id uuid,
  assignment_group_id uuid,
  alert_id uuid,
  outcome text,
  decision jsonb,
  payload jsonb
);
create index if not exists sm_events_rev_idx on sm_events (org_id, rev);
create index if not exists sm_events_upd_idx on sm_events (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_events_crt_idx on sm_events (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_events_source_id_idx on sm_events (org_id, source_id) where deleted_at is null;
create index if not exists sm_events_received_at_idx on sm_events (org_id, received_at) where deleted_at is null;
create index if not exists sm_events_fingerprint_idx on sm_events (org_id, fingerprint) where deleted_at is null;
create index if not exists sm_events_dedupe_key_idx on sm_events (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_events_alert_id_idx on sm_events (org_id, alert_id) where deleted_at is null;
create index if not exists sm_events_outcome_idx on sm_events (org_id, outcome) where deleted_at is null;
drop trigger if exists sm_events_sync on sm_events;
create or replace trigger sm_events_demo after insert on sm_events for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_events_demo_t after update or delete on sm_events for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_events enable row level security;

-- event_config: تنظیمات رویداد و کشیک
do $cols$
begin
  if to_regclass('sm_event_configs') is not null then
    alter table sm_event_configs add column if not exists workspace_id uuid;
    alter table sm_event_configs add column if not exists domain_id uuid;
    alter table sm_event_configs add column if not exists unit_id uuid;
    alter table sm_event_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_event_configs add column if not exists created_by uuid;
    alter table sm_event_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_event_configs add column if not exists updated_by uuid;
    alter table sm_event_configs add column if not exists rev bigint not null default 0;
    alter table sm_event_configs add column if not exists version integer not null default 1;
    alter table sm_event_configs add column if not exists deleted_at timestamptz;
    alter table sm_event_configs add column if not exists origin text;
    alter table sm_event_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_event_configs add column if not exists name text;
    alter table sm_event_configs add column if not exists config_key text;
    alter table sm_event_configs add column if not exists retention_days integer;
    alter table sm_event_configs add column if not exists flap_threshold integer;
    alter table sm_event_configs add column if not exists flap_window_minutes integer;
    alter table sm_event_configs add column if not exists reopen_minutes integer;
    alter table sm_event_configs add column if not exists auto_close_minutes integer;
    alter table sm_event_configs add column if not exists transient_seconds integer;
    alter table sm_event_configs add column if not exists ack_link_hours integer;
    alter table sm_event_configs add column if not exists incident_on_exhausted boolean not null default true;
    alter table sm_event_configs add column if not exists default_policy_id uuid;
    alter table sm_event_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_event_configs (
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
  retention_days integer,
  flap_threshold integer,
  flap_window_minutes integer,
  reopen_minutes integer,
  auto_close_minutes integer,
  transient_seconds integer,
  ack_link_hours integer,
  incident_on_exhausted boolean not null default true,
  default_policy_id uuid,
  seeded integer
);
create index if not exists sm_event_configs_rev_idx on sm_event_configs (org_id, rev);
create index if not exists sm_event_configs_upd_idx on sm_event_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_event_configs_crt_idx on sm_event_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_event_configs_config_key_uk on sm_event_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_event_configs_sync on sm_event_configs;
create trigger sm_event_configs_sync before insert or update on sm_event_configs for each row execute function sm_sync_touch('event_config');
create or replace trigger sm_event_configs_demo after insert on sm_event_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_event_configs_demo_t after update or delete on sm_event_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_event_configs enable row level security;

-- event_rule: قاعده‌های پردازش رویداد
do $cols$
begin
  if to_regclass('sm_event_rules') is not null then
    alter table sm_event_rules add column if not exists workspace_id uuid;
    alter table sm_event_rules add column if not exists domain_id uuid;
    alter table sm_event_rules add column if not exists unit_id uuid;
    alter table sm_event_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_event_rules add column if not exists created_by uuid;
    alter table sm_event_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_event_rules add column if not exists updated_by uuid;
    alter table sm_event_rules add column if not exists rev bigint not null default 0;
    alter table sm_event_rules add column if not exists version integer not null default 1;
    alter table sm_event_rules add column if not exists deleted_at timestamptz;
    alter table sm_event_rules add column if not exists origin text;
    alter table sm_event_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_event_rules add column if not exists name text;
    alter table sm_event_rules add column if not exists action text;
    alter table sm_event_rules add column if not exists active boolean not null default true;
    alter table sm_event_rules add column if not exists sort_order integer;
    alter table sm_event_rules add column if not exists source_id uuid;
    alter table sm_event_rules add column if not exists stop boolean not null default false;
    alter table sm_event_rules add column if not exists condition jsonb;
    alter table sm_event_rules add column if not exists pattern text;
    alter table sm_event_rules add column if not exists set_severity text;
    alter table sm_event_rules add column if not exists set_group_id uuid;
    alter table sm_event_rules add column if not exists set_service_id uuid;
    alter table sm_event_rules add column if not exists set_ci_id uuid;
    alter table sm_event_rules add column if not exists add_tags jsonb;
    alter table sm_event_rules add column if not exists message_prefix text;
    alter table sm_event_rules add column if not exists threshold_count integer;
    alter table sm_event_rules add column if not exists threshold_minutes integer;
    alter table sm_event_rules add column if not exists hits integer;
    alter table sm_event_rules add column if not exists last_hit_at timestamptz;
    alter table sm_event_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_event_rules (
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
  action text,
  active boolean not null default true,
  sort_order integer,
  source_id uuid,
  stop boolean not null default false,
  condition jsonb,
  pattern text,
  set_severity text,
  set_group_id uuid,
  set_service_id uuid,
  set_ci_id uuid,
  add_tags jsonb,
  message_prefix text,
  threshold_count integer,
  threshold_minutes integer,
  hits integer,
  last_hit_at timestamptz,
  description text
);
create index if not exists sm_event_rules_rev_idx on sm_event_rules (org_id, rev);
create index if not exists sm_event_rules_upd_idx on sm_event_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_event_rules_crt_idx on sm_event_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_event_rules_sync on sm_event_rules;
create trigger sm_event_rules_sync before insert or update on sm_event_rules for each row execute function sm_sync_touch('event_rule');
create or replace trigger sm_event_rules_demo after insert on sm_event_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_event_rules_demo_t after update or delete on sm_event_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_event_rules enable row level security;

-- event_source: منبع‌های رویداد
do $cols$
begin
  if to_regclass('sm_event_sources') is not null then
    alter table sm_event_sources add column if not exists workspace_id uuid;
    alter table sm_event_sources add column if not exists domain_id uuid;
    alter table sm_event_sources add column if not exists unit_id uuid;
    alter table sm_event_sources add column if not exists created_at timestamptz not null default now();
    alter table sm_event_sources add column if not exists created_by uuid;
    alter table sm_event_sources add column if not exists updated_at timestamptz not null default now();
    alter table sm_event_sources add column if not exists updated_by uuid;
    alter table sm_event_sources add column if not exists rev bigint not null default 0;
    alter table sm_event_sources add column if not exists version integer not null default 1;
    alter table sm_event_sources add column if not exists deleted_at timestamptz;
    alter table sm_event_sources add column if not exists origin text;
    alter table sm_event_sources add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_event_sources add column if not exists name text;
    alter table sm_event_sources add column if not exists kind text;
    alter table sm_event_sources add column if not exists active boolean not null default true;
    alter table sm_event_sources add column if not exists assignment_group_id uuid;
    alter table sm_event_sources add column if not exists service_id uuid;
    alter table sm_event_sources add column if not exists default_severity text;
    alter table sm_event_sources add column if not exists rate_limit integer;
    alter table sm_event_sources add column if not exists heartbeat_minutes integer;
    alter table sm_event_sources add column if not exists token_hint text;
    alter table sm_event_sources add column if not exists token_hash text;
    alter table sm_event_sources add column if not exists token_rotated_at timestamptz;
    alter table sm_event_sources add column if not exists mapping jsonb;
    alter table sm_event_sources add column if not exists severity_map jsonb;
    alter table sm_event_sources add column if not exists last_event_at timestamptz;
    alter table sm_event_sources add column if not exists event_count integer;
    alter table sm_event_sources add column if not exists heartbeat_alert_id uuid;
    alter table sm_event_sources add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_event_sources (
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
  assignment_group_id uuid,
  service_id uuid,
  default_severity text,
  rate_limit integer,
  heartbeat_minutes integer,
  token_hint text,
  token_hash text,
  token_rotated_at timestamptz,
  mapping jsonb,
  severity_map jsonb,
  last_event_at timestamptz,
  event_count integer,
  heartbeat_alert_id uuid,
  description text
);
create index if not exists sm_event_sources_rev_idx on sm_event_sources (org_id, rev);
create index if not exists sm_event_sources_upd_idx on sm_event_sources (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_event_sources_crt_idx on sm_event_sources (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_event_sources_token_hash_idx on sm_event_sources (org_id, token_hash) where deleted_at is null;
drop trigger if exists sm_event_sources_sync on sm_event_sources;
create trigger sm_event_sources_sync before insert or update on sm_event_sources for each row execute function sm_sync_touch('event_source');
create or replace trigger sm_event_sources_demo after insert on sm_event_sources for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_event_sources_demo_t after update or delete on sm_event_sources for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_event_sources enable row level security;

-- exchange_rate: نرخ‌های ارز
do $cols$
begin
  if to_regclass('sm_exchange_rates') is not null then
    alter table sm_exchange_rates add column if not exists workspace_id uuid;
    alter table sm_exchange_rates add column if not exists domain_id uuid;
    alter table sm_exchange_rates add column if not exists unit_id uuid;
    alter table sm_exchange_rates add column if not exists created_at timestamptz not null default now();
    alter table sm_exchange_rates add column if not exists created_by uuid;
    alter table sm_exchange_rates add column if not exists updated_at timestamptz not null default now();
    alter table sm_exchange_rates add column if not exists updated_by uuid;
    alter table sm_exchange_rates add column if not exists rev bigint not null default 0;
    alter table sm_exchange_rates add column if not exists version integer not null default 1;
    alter table sm_exchange_rates add column if not exists deleted_at timestamptz;
    alter table sm_exchange_rates add column if not exists origin text;
    alter table sm_exchange_rates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_exchange_rates add column if not exists currency text;
    alter table sm_exchange_rates add column if not exists rate numeric;
    alter table sm_exchange_rates add column if not exists rate_date date;
    alter table sm_exchange_rates add column if not exists rate_type text;
    alter table sm_exchange_rates add column if not exists source text;
  end if;
end
$cols$;
create table if not exists sm_exchange_rates (
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
  currency text,
  rate numeric,
  rate_date date,
  rate_type text,
  source text
);
create index if not exists sm_exchange_rates_rev_idx on sm_exchange_rates (org_id, rev);
create index if not exists sm_exchange_rates_upd_idx on sm_exchange_rates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_exchange_rates_crt_idx on sm_exchange_rates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_exchange_rates_currency_rate_date_rate_type_uk on sm_exchange_rates (org_id, currency, rate_date, rate_type) where deleted_at is null;
drop trigger if exists sm_exchange_rates_sync on sm_exchange_rates;
create trigger sm_exchange_rates_sync before insert or update on sm_exchange_rates for each row execute function sm_sync_touch('exchange_rate');
create or replace trigger sm_exchange_rates_demo after insert on sm_exchange_rates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_exchange_rates_demo_t after update or delete on sm_exchange_rates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_exchange_rates enable row level security;

-- exercise: مانورهای تداوم
do $cols$
begin
  if to_regclass('sm_exercises') is not null then
    alter table sm_exercises add column if not exists workspace_id uuid;
    alter table sm_exercises add column if not exists domain_id uuid;
    alter table sm_exercises add column if not exists unit_id uuid;
    alter table sm_exercises add column if not exists created_at timestamptz not null default now();
    alter table sm_exercises add column if not exists created_by uuid;
    alter table sm_exercises add column if not exists updated_at timestamptz not null default now();
    alter table sm_exercises add column if not exists updated_by uuid;
    alter table sm_exercises add column if not exists rev bigint not null default 0;
    alter table sm_exercises add column if not exists version integer not null default 1;
    alter table sm_exercises add column if not exists deleted_at timestamptz;
    alter table sm_exercises add column if not exists origin text;
    alter table sm_exercises add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_exercises add column if not exists no integer;
    alter table sm_exercises add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'EXR' || no::text else 'EXR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_exercises add column if not exists title text;
    alter table sm_exercises add column if not exists plan_id uuid;
    alter table sm_exercises add column if not exists exercise_type text;
    alter table sm_exercises add column if not exists scheduled_at timestamptz;
    alter table sm_exercises add column if not exists started_at timestamptz;
    alter table sm_exercises add column if not exists ended_at timestamptz;
    alter table sm_exercises add column if not exists owner_id uuid;
    alter table sm_exercises add column if not exists assignment_group_id uuid;
    alter table sm_exercises add column if not exists participants jsonb;
    alter table sm_exercises add column if not exists scenario text;
    alter table sm_exercises add column if not exists objectives text;
    alter table sm_exercises add column if not exists rto_target bigint;
    alter table sm_exercises add column if not exists rpo_target bigint;
    alter table sm_exercises add column if not exists actual_recovery bigint;
    alter table sm_exercises add column if not exists actual_data_loss bigint;
    alter table sm_exercises add column if not exists rto_met boolean not null default false;
    alter table sm_exercises add column if not exists rpo_met boolean not null default false;
    alter table sm_exercises add column if not exists result text;
    alter table sm_exercises add column if not exists step_log jsonb;
    alter table sm_exercises add column if not exists findings text;
    alter table sm_exercises add column if not exists lessons text;
    alter table sm_exercises add column if not exists watch_list jsonb;
    alter table sm_exercises add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_exercises (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'EXR' || no::text else 'EXR' || lpad(no::text, 5, '0') end) stored,
  title text,
  plan_id uuid,
  exercise_type text,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  owner_id uuid,
  assignment_group_id uuid,
  participants jsonb,
  scenario text,
  objectives text,
  rto_target bigint,
  rpo_target bigint,
  actual_recovery bigint,
  actual_data_loss bigint,
  rto_met boolean not null default false,
  rpo_met boolean not null default false,
  result text,
  step_log jsonb,
  findings text,
  lessons text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_exercises', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_exercises_search_cae18f1d_trgm', 'sm_exercises', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_exercises_search_custom_trgm', 'sm_exercises', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_exercises_no_uk on sm_exercises (org_id, no);
create index if not exists sm_exercises_rev_idx on sm_exercises (org_id, rev);
create index if not exists sm_exercises_upd_idx on sm_exercises (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_exercises_crt_idx on sm_exercises (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_exercises_plan_id_idx on sm_exercises (org_id, plan_id) where deleted_at is null;
create index if not exists sm_exercises_state_idx on sm_exercises (org_id, state) where deleted_at is null;
create index if not exists sm_exercises_workspace_acc_idx on sm_exercises (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_exercises_unit_acc_idx on sm_exercises (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_exercises_domain_acc_idx on sm_exercises (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_exercises_owner_id_idx on sm_exercises (org_id, owner_id) where deleted_at is null;
create index if not exists sm_exercises_participants_gin on sm_exercises using gin (participants);
create index if not exists sm_exercises_watch_list_gin on sm_exercises using gin (watch_list);
drop trigger if exists sm_exercises_sync on sm_exercises;
create trigger sm_exercises_sync before insert or update on sm_exercises for each row execute function sm_sync_touch('exercise');
create or replace trigger sm_exercises_demo after insert on sm_exercises for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_exercises_demo_t after update or delete on sm_exercises for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_exercises enable row level security;

-- export_schedule: خروجی‌های زمان‌بندی‌شده
do $cols$
begin
  if to_regclass('sm_export_schedules') is not null then
    alter table sm_export_schedules add column if not exists workspace_id uuid;
    alter table sm_export_schedules add column if not exists domain_id uuid;
    alter table sm_export_schedules add column if not exists unit_id uuid;
    alter table sm_export_schedules add column if not exists created_at timestamptz not null default now();
    alter table sm_export_schedules add column if not exists created_by uuid;
    alter table sm_export_schedules add column if not exists updated_at timestamptz not null default now();
    alter table sm_export_schedules add column if not exists updated_by uuid;
    alter table sm_export_schedules add column if not exists rev bigint not null default 0;
    alter table sm_export_schedules add column if not exists version integer not null default 1;
    alter table sm_export_schedules add column if not exists deleted_at timestamptz;
    alter table sm_export_schedules add column if not exists origin text;
    alter table sm_export_schedules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_export_schedules add column if not exists name text;
    alter table sm_export_schedules add column if not exists active boolean not null default true;
    alter table sm_export_schedules add column if not exists tables jsonb;
    alter table sm_export_schedules add column if not exists format text;
    alter table sm_export_schedules add column if not exists every_hours integer;
    alter table sm_export_schedules add column if not exists principal_id uuid;
    alter table sm_export_schedules add column if not exists destination text;
    alter table sm_export_schedules add column if not exists url text;
    alter table sm_export_schedules add column if not exists secret text;
    alter table sm_export_schedules add column if not exists health text;
    alter table sm_export_schedules add column if not exists last_run_at timestamptz;
    alter table sm_export_schedules add column if not exists next_run_at timestamptz;
    alter table sm_export_schedules add column if not exists last_status text;
  end if;
end
$cols$;
create table if not exists sm_export_schedules (
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
  tables jsonb,
  format text,
  every_hours integer,
  principal_id uuid,
  destination text,
  url text,
  secret text,
  health text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text
);
create index if not exists sm_export_schedules_rev_idx on sm_export_schedules (org_id, rev);
create index if not exists sm_export_schedules_upd_idx on sm_export_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_export_schedules_crt_idx on sm_export_schedules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_export_schedules_workspace_acc_idx on sm_export_schedules (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_export_schedules_unit_acc_idx on sm_export_schedules (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_export_schedules_domain_acc_idx on sm_export_schedules (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_export_schedules_sync on sm_export_schedules;
create trigger sm_export_schedules_sync before insert or update on sm_export_schedules for each row execute function sm_sync_touch('export_schedule');
create or replace trigger sm_export_schedules_demo after insert on sm_export_schedules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_export_schedules_demo_t after update or delete on sm_export_schedules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_export_schedules enable row level security;

-- external_ref: پیوندهای بیرونی
do $cols$
begin
  if to_regclass('sm_external_refs') is not null then
    alter table sm_external_refs add column if not exists workspace_id uuid;
    alter table sm_external_refs add column if not exists domain_id uuid;
    alter table sm_external_refs add column if not exists unit_id uuid;
    alter table sm_external_refs add column if not exists created_at timestamptz not null default now();
    alter table sm_external_refs add column if not exists created_by uuid;
    alter table sm_external_refs add column if not exists updated_at timestamptz not null default now();
    alter table sm_external_refs add column if not exists updated_by uuid;
    alter table sm_external_refs add column if not exists rev bigint not null default 0;
    alter table sm_external_refs add column if not exists version integer not null default 1;
    alter table sm_external_refs add column if not exists deleted_at timestamptz;
    alter table sm_external_refs add column if not exists origin text;
    alter table sm_external_refs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_external_refs add column if not exists remote_key text;
    alter table sm_external_refs add column if not exists connection_id uuid;
    alter table sm_external_refs add column if not exists table_key text;
    alter table sm_external_refs add column if not exists record_id text;
    alter table sm_external_refs add column if not exists record_label text;
    alter table sm_external_refs add column if not exists remote_id text;
    alter table sm_external_refs add column if not exists remote_url text;
    alter table sm_external_refs add column if not exists remote_state text;
    alter table sm_external_refs add column if not exists sync_state text;
    alter table sm_external_refs add column if not exists last_synced_at timestamptz;
    alter table sm_external_refs add column if not exists error text;
  end if;
end
$cols$;
create table if not exists sm_external_refs (
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
  remote_key text,
  connection_id uuid,
  table_key text,
  record_id text,
  record_label text,
  remote_id text,
  remote_url text,
  remote_state text,
  sync_state text,
  last_synced_at timestamptz,
  error text
);
create index if not exists sm_external_refs_rev_idx on sm_external_refs (org_id, rev);
create index if not exists sm_external_refs_upd_idx on sm_external_refs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_external_refs_crt_idx on sm_external_refs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_external_refs_record_id_idx on sm_external_refs (org_id, record_id) where deleted_at is null;
create unique index if not exists sm_external_refs_connection_id_remote_key_uk on sm_external_refs (org_id, connection_id, remote_key) where deleted_at is null;
drop trigger if exists sm_external_refs_sync on sm_external_refs;
create trigger sm_external_refs_sync before insert or update on sm_external_refs for each row execute function sm_sync_touch('external_ref');
create or replace trigger sm_external_refs_demo after insert on sm_external_refs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_external_refs_demo_t after update or delete on sm_external_refs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_external_refs enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:9', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:%') >= 28 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۷ از ۸ (0006_engine_tables:24/30 … 0006_engine_tables:27/30)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۴ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 24/30 (a0c3bc7de847)
-- service_offering: گزینه‌های خدمت
do $cols$
begin
  if to_regclass('sm_service_offerings') is not null then
    alter table sm_service_offerings add column if not exists workspace_id uuid;
    alter table sm_service_offerings add column if not exists domain_id uuid;
    alter table sm_service_offerings add column if not exists unit_id uuid;
    alter table sm_service_offerings add column if not exists created_at timestamptz not null default now();
    alter table sm_service_offerings add column if not exists created_by uuid;
    alter table sm_service_offerings add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_offerings add column if not exists updated_by uuid;
    alter table sm_service_offerings add column if not exists rev bigint not null default 0;
    alter table sm_service_offerings add column if not exists version integer not null default 1;
    alter table sm_service_offerings add column if not exists deleted_at timestamptz;
    alter table sm_service_offerings add column if not exists origin text;
    alter table sm_service_offerings add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_offerings add column if not exists no integer;
    alter table sm_service_offerings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'OFR' || no::text else 'OFR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_service_offerings add column if not exists name text;
    alter table sm_service_offerings add column if not exists service_id uuid;
    alter table sm_service_offerings add column if not exists level text;
    alter table sm_service_offerings add column if not exists region text;
    alter table sm_service_offerings add column if not exists ci_id uuid;
    alter table sm_service_offerings add column if not exists description text;
    alter table sm_service_offerings add column if not exists support_group_id uuid;
    alter table sm_service_offerings add column if not exists approval_group_id uuid;
    alter table sm_service_offerings add column if not exists calendar_id uuid;
    alter table sm_service_offerings add column if not exists availability_target numeric;
    alter table sm_service_offerings add column if not exists price numeric;
    alter table sm_service_offerings add column if not exists price_unit text;
    alter table sm_service_offerings add column if not exists utility text;
    alter table sm_service_offerings add column if not exists warranty text;
    alter table sm_service_offerings add column if not exists entitled_everyone boolean not null default true;
    alter table sm_service_offerings add column if not exists entitled_units jsonb;
    alter table sm_service_offerings add column if not exists entitled_groups jsonb;
    alter table sm_service_offerings add column if not exists entitled_locations jsonb;
    alter table sm_service_offerings add column if not exists owner_id uuid;
    alter table sm_service_offerings add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_service_offerings (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'OFR' || no::text else 'OFR' || lpad(no::text, 5, '0') end) stored,
  name text,
  service_id uuid,
  level text,
  region text,
  ci_id uuid,
  description text,
  support_group_id uuid,
  approval_group_id uuid,
  calendar_id uuid,
  availability_target numeric,
  price numeric,
  price_unit text,
  utility text,
  warranty text,
  entitled_everyone boolean not null default true,
  entitled_units jsonb,
  entitled_groups jsonb,
  entitled_locations jsonb,
  owner_id uuid,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_offerings' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_service_offerings', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_offerings', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_service_offerings' and indexname like 'sm\_service\_offerings\_search\_%' and indexname not in ('sm_service_offerings_search_56291d9d_trgm', 'sm_service_offerings_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_offerings_search_56291d9d_trgm', 'sm_service_offerings', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_offerings_search_custom_trgm', 'sm_service_offerings', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_offerings_no_uk on sm_service_offerings (org_id, no);
create index if not exists sm_service_offerings_rev_idx on sm_service_offerings (org_id, rev);
create index if not exists sm_service_offerings_upd_idx on sm_service_offerings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_offerings_crt_idx on sm_service_offerings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_offerings_service_id_idx on sm_service_offerings (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_offerings_ci_id_idx on sm_service_offerings (org_id, ci_id) where deleted_at is null;
create index if not exists sm_service_offerings_state_idx on sm_service_offerings (org_id, state) where deleted_at is null;
create index if not exists sm_service_offerings_workspace_acc_idx on sm_service_offerings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_offerings_unit_acc_idx on sm_service_offerings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_offerings_domain_acc_idx on sm_service_offerings (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_offerings_owner_id_idx on sm_service_offerings (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_service_offerings_sync on sm_service_offerings;
create trigger sm_service_offerings_sync before insert or update on sm_service_offerings for each row execute function sm_sync_touch('service_offering');
create or replace trigger sm_service_offerings_demo after insert on sm_service_offerings for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_offerings_demo_t after update or delete on sm_service_offerings for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_offerings enable row level security;

-- service_proposal: پیشنهادهای خدمت
do $cols$
begin
  if to_regclass('sm_service_proposals') is not null then
    alter table sm_service_proposals add column if not exists workspace_id uuid;
    alter table sm_service_proposals add column if not exists domain_id uuid;
    alter table sm_service_proposals add column if not exists unit_id uuid;
    alter table sm_service_proposals add column if not exists created_at timestamptz not null default now();
    alter table sm_service_proposals add column if not exists created_by uuid;
    alter table sm_service_proposals add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_proposals add column if not exists updated_by uuid;
    alter table sm_service_proposals add column if not exists rev bigint not null default 0;
    alter table sm_service_proposals add column if not exists version integer not null default 1;
    alter table sm_service_proposals add column if not exists deleted_at timestamptz;
    alter table sm_service_proposals add column if not exists origin text;
    alter table sm_service_proposals add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_proposals add column if not exists no integer;
    alter table sm_service_proposals add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SPR' || no::text else 'SPR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_service_proposals add column if not exists name text;
    alter table sm_service_proposals add column if not exists kind text;
    alter table sm_service_proposals add column if not exists service_type text;
    alter table sm_service_proposals add column if not exists service_id uuid;
    alter table sm_service_proposals add column if not exists proposer_id uuid;
    alter table sm_service_proposals add column if not exists portfolio_node_id uuid;
    alter table sm_service_proposals add column if not exists business_need text;
    alter table sm_service_proposals add column if not exists expected_benefits text;
    alter table sm_service_proposals add column if not exists predicted_demand text;
    alter table sm_service_proposals add column if not exists resources text;
    alter table sm_service_proposals add column if not exists risks text;
    alter table sm_service_proposals add column if not exists value_score text;
    alter table sm_service_proposals add column if not exists fit_score text;
    alter table sm_service_proposals add column if not exists risk_score text;
    alter table sm_service_proposals add column if not exists score integer;
    alter table sm_service_proposals add column if not exists decision_notes text;
    alter table sm_service_proposals add column if not exists chartered_service_id uuid;
    alter table sm_service_proposals add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_service_proposals (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SPR' || no::text else 'SPR' || lpad(no::text, 5, '0') end) stored,
  name text,
  kind text,
  service_type text,
  service_id uuid,
  proposer_id uuid,
  portfolio_node_id uuid,
  business_need text,
  expected_benefits text,
  predicted_demand text,
  resources text,
  risks text,
  value_score text,
  fit_score text,
  risk_score text,
  score integer,
  decision_notes text,
  chartered_service_id uuid,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_proposals' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_service_proposals', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_proposals', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_service_proposals' and indexname like 'sm\_service\_proposals\_search\_%' and indexname not in ('sm_service_proposals_search_56291d9d_trgm', 'sm_service_proposals_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_proposals_search_56291d9d_trgm', 'sm_service_proposals', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_proposals_search_custom_trgm', 'sm_service_proposals', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_proposals_no_uk on sm_service_proposals (org_id, no);
create index if not exists sm_service_proposals_rev_idx on sm_service_proposals (org_id, rev);
create index if not exists sm_service_proposals_upd_idx on sm_service_proposals (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_proposals_crt_idx on sm_service_proposals (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_proposals_state_idx on sm_service_proposals (org_id, state) where deleted_at is null;
create index if not exists sm_service_proposals_workspace_acc_idx on sm_service_proposals (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_proposals_unit_acc_idx on sm_service_proposals (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_proposals_domain_acc_idx on sm_service_proposals (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_proposals_proposer_id_idx on sm_service_proposals (org_id, proposer_id) where deleted_at is null;
drop trigger if exists sm_service_proposals_sync on sm_service_proposals;
create trigger sm_service_proposals_sync before insert or update on sm_service_proposals for each row execute function sm_sync_touch('service_proposal');
create or replace trigger sm_service_proposals_demo after insert on sm_service_proposals for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_proposals_demo_t after update or delete on sm_service_proposals for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_proposals enable row level security;

-- service_score_fact: امتیازهای روزانهٔ خدمت
do $cols$
begin
  if to_regclass('sm_service_score_facts') is not null then
    alter table sm_service_score_facts add column if not exists workspace_id uuid;
    alter table sm_service_score_facts add column if not exists domain_id uuid;
    alter table sm_service_score_facts add column if not exists unit_id uuid;
    alter table sm_service_score_facts add column if not exists created_at timestamptz not null default now();
    alter table sm_service_score_facts add column if not exists created_by uuid;
    alter table sm_service_score_facts add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_score_facts add column if not exists updated_by uuid;
    alter table sm_service_score_facts add column if not exists rev bigint not null default 0;
    alter table sm_service_score_facts add column if not exists version integer not null default 1;
    alter table sm_service_score_facts add column if not exists deleted_at timestamptz;
    alter table sm_service_score_facts add column if not exists origin text;
    alter table sm_service_score_facts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_score_facts add column if not exists day date;
    alter table sm_service_score_facts add column if not exists service_id uuid;
    alter table sm_service_score_facts add column if not exists availability numeric;
    alter table sm_service_score_facts add column if not exists incidents integer;
    alter table sm_service_score_facts add column if not exists major integer;
    alter table sm_service_score_facts add column if not exists breaches integer;
    alter table sm_service_score_facts add column if not exists problems integer;
    alter table sm_service_score_facts add column if not exists csat numeric;
    alter table sm_service_score_facts add column if not exists score integer;
    alter table sm_service_score_facts add column if not exists components jsonb;
  end if;
end
$cols$;
create table if not exists sm_service_score_facts (
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
  day date,
  service_id uuid,
  availability numeric,
  incidents integer,
  major integer,
  breaches integer,
  problems integer,
  csat numeric,
  score integer,
  components jsonb
);
create index if not exists sm_service_score_facts_rev_idx on sm_service_score_facts (org_id, rev);
create index if not exists sm_service_score_facts_upd_idx on sm_service_score_facts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_score_facts_crt_idx on sm_service_score_facts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_score_facts_day_idx on sm_service_score_facts (org_id, day) where deleted_at is null;
create index if not exists sm_service_score_facts_service_id_idx on sm_service_score_facts (org_id, service_id) where deleted_at is null;
create unique index if not exists sm_service_score_facts_day_service_id_uk on sm_service_score_facts (org_id, day, service_id) where deleted_at is null;
drop trigger if exists sm_service_score_facts_sync on sm_service_score_facts;
create trigger sm_service_score_facts_sync before insert or update on sm_service_score_facts for each row execute function sm_sync_touch('service_score_fact');
create or replace trigger sm_service_score_facts_demo after insert on sm_service_score_facts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_score_facts_demo_t after update or delete on sm_service_score_facts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_score_facts enable row level security;

-- service_subscription: اشتراک‌های اطلاع‌رسانی خدمت
do $cols$
begin
  if to_regclass('sm_service_subscriptions') is not null then
    alter table sm_service_subscriptions add column if not exists workspace_id uuid;
    alter table sm_service_subscriptions add column if not exists domain_id uuid;
    alter table sm_service_subscriptions add column if not exists unit_id uuid;
    alter table sm_service_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_service_subscriptions add column if not exists created_by uuid;
    alter table sm_service_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_subscriptions add column if not exists updated_by uuid;
    alter table sm_service_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_service_subscriptions add column if not exists version integer not null default 1;
    alter table sm_service_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_service_subscriptions add column if not exists origin text;
    alter table sm_service_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_subscriptions add column if not exists service_id uuid;
    alter table sm_service_subscriptions add column if not exists offering_id uuid;
    alter table sm_service_subscriptions add column if not exists subscriber_kind text;
    alter table sm_service_subscriptions add column if not exists user_id uuid;
    alter table sm_service_subscriptions add column if not exists group_id uuid;
    alter table sm_service_subscriptions add column if not exists org_unit_id uuid;
    alter table sm_service_subscriptions add column if not exists location_id uuid;
    alter table sm_service_subscriptions add column if not exists valid_from date;
    alter table sm_service_subscriptions add column if not exists valid_to date;
    alter table sm_service_subscriptions add column if not exists notify boolean not null default true;
    alter table sm_service_subscriptions add column if not exists origin_kind text;
    alter table sm_service_subscriptions add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_service_subscriptions (
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
  service_id uuid,
  offering_id uuid,
  subscriber_kind text,
  user_id uuid,
  group_id uuid,
  org_unit_id uuid,
  location_id uuid,
  valid_from date,
  valid_to date,
  notify boolean not null default true,
  origin_kind text,
  label text
);
create index if not exists sm_service_subscriptions_rev_idx on sm_service_subscriptions (org_id, rev);
create index if not exists sm_service_subscriptions_upd_idx on sm_service_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_subscriptions_crt_idx on sm_service_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_subscriptions_service_id_idx on sm_service_subscriptions (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_subscriptions_offering_id_idx on sm_service_subscriptions (org_id, offering_id) where deleted_at is null;
create index if not exists sm_service_subscriptions_user_id_idx on sm_service_subscriptions (org_id, user_id) where deleted_at is null;
create index if not exists sm_service_subscriptions_workspace_acc_idx on sm_service_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_subscriptions_unit_acc_idx on sm_service_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_subscriptions_domain_acc_idx on sm_service_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_service_subscriptions_sync on sm_service_subscriptions;
create trigger sm_service_subscriptions_sync before insert or update on sm_service_subscriptions for each row execute function sm_sync_touch('service_subscription');
create or replace trigger sm_service_subscriptions_demo after insert on sm_service_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_subscriptions_demo_t after update or delete on sm_service_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_subscriptions enable row level security;

-- sla_definition: تعریف‌های توافق سطح خدمت
do $cols$
begin
  if to_regclass('sm_sla_definitions') is not null then
    alter table sm_sla_definitions add column if not exists workspace_id uuid;
    alter table sm_sla_definitions add column if not exists domain_id uuid;
    alter table sm_sla_definitions add column if not exists unit_id uuid;
    alter table sm_sla_definitions add column if not exists created_at timestamptz not null default now();
    alter table sm_sla_definitions add column if not exists created_by uuid;
    alter table sm_sla_definitions add column if not exists updated_at timestamptz not null default now();
    alter table sm_sla_definitions add column if not exists updated_by uuid;
    alter table sm_sla_definitions add column if not exists rev bigint not null default 0;
    alter table sm_sla_definitions add column if not exists version integer not null default 1;
    alter table sm_sla_definitions add column if not exists deleted_at timestamptz;
    alter table sm_sla_definitions add column if not exists origin text;
    alter table sm_sla_definitions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sla_definitions add column if not exists name text;
    alter table sm_sla_definitions add column if not exists table_key text;
    alter table sm_sla_definitions add column if not exists type text;
    alter table sm_sla_definitions add column if not exists target text;
    alter table sm_sla_definitions add column if not exists active boolean not null default true;
    alter table sm_sla_definitions add column if not exists duration_mode text;
    alter table sm_sla_definitions add column if not exists duration bigint;
    alter table sm_sla_definitions add column if not exists priority_field text;
    alter table sm_sla_definitions add column if not exists durations jsonb;
    alter table sm_sla_definitions add column if not exists calendar_id uuid;
    alter table sm_sla_definitions add column if not exists timezone_source text;
    alter table sm_sla_definitions add column if not exists start_condition jsonb;
    alter table sm_sla_definitions add column if not exists pause_condition jsonb;
    alter table sm_sla_definitions add column if not exists stop_condition jsonb;
    alter table sm_sla_definitions add column if not exists reset_condition jsonb;
    alter table sm_sla_definitions add column if not exists cancel_condition jsonb;
    alter table sm_sla_definitions add column if not exists retroactive boolean not null default false;
    alter table sm_sla_definitions add column if not exists retroactive_field text;
    alter table sm_sla_definitions add column if not exists warn_percents jsonb;
    alter table sm_sla_definitions add column if not exists breach_actions jsonb;
    alter table sm_sla_definitions add column if not exists service_id uuid;
    alter table sm_sla_definitions add column if not exists customer_unit_id uuid;
    alter table sm_sla_definitions add column if not exists sort_order integer;
    alter table sm_sla_definitions add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_sla_definitions (
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
  table_key text,
  type text,
  target text,
  active boolean not null default true,
  duration_mode text,
  duration bigint,
  priority_field text,
  durations jsonb,
  calendar_id uuid,
  timezone_source text,
  start_condition jsonb,
  pause_condition jsonb,
  stop_condition jsonb,
  reset_condition jsonb,
  cancel_condition jsonb,
  retroactive boolean not null default false,
  retroactive_field text,
  warn_percents jsonb,
  breach_actions jsonb,
  service_id uuid,
  customer_unit_id uuid,
  sort_order integer,
  description text
);
create index if not exists sm_sla_definitions_rev_idx on sm_sla_definitions (org_id, rev);
create index if not exists sm_sla_definitions_upd_idx on sm_sla_definitions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sla_definitions_crt_idx on sm_sla_definitions (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sla_definitions_table_key_name_uk on sm_sla_definitions (org_id, table_key, name) where deleted_at is null;
drop trigger if exists sm_sla_definitions_sync on sm_sla_definitions;
create trigger sm_sla_definitions_sync before insert or update on sm_sla_definitions for each row execute function sm_sync_touch('sla_definition');
create or replace trigger sm_sla_definitions_demo after insert on sm_sla_definitions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sla_definitions_demo_t after update or delete on sm_sla_definitions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sla_definitions enable row level security;

-- slm_compliance: انطباق دوره‌ها
do $cols$
begin
  if to_regclass('sm_slm_compliance') is not null then
    alter table sm_slm_compliance add column if not exists workspace_id uuid;
    alter table sm_slm_compliance add column if not exists domain_id uuid;
    alter table sm_slm_compliance add column if not exists unit_id uuid;
    alter table sm_slm_compliance add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_compliance add column if not exists created_by uuid;
    alter table sm_slm_compliance add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_compliance add column if not exists updated_by uuid;
    alter table sm_slm_compliance add column if not exists rev bigint not null default 0;
    alter table sm_slm_compliance add column if not exists version integer not null default 1;
    alter table sm_slm_compliance add column if not exists deleted_at timestamptz;
    alter table sm_slm_compliance add column if not exists origin text;
    alter table sm_slm_compliance add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_compliance add column if not exists agreement_id uuid;
    alter table sm_slm_compliance add column if not exists target_id uuid;
    alter table sm_slm_compliance add column if not exists period_key text;
    alter table sm_slm_compliance add column if not exists period_label text;
    alter table sm_slm_compliance add column if not exists period_start date;
    alter table sm_slm_compliance add column if not exists period_end date;
    alter table sm_slm_compliance add column if not exists total integer;
    alter table sm_slm_compliance add column if not exists met integer;
    alter table sm_slm_compliance add column if not exists breached integer;
    alter table sm_slm_compliance add column if not exists excluded integer;
    alter table sm_slm_compliance add column if not exists value numeric;
    alter table sm_slm_compliance add column if not exists goal numeric;
    alter table sm_slm_compliance add column if not exists status text;
    alter table sm_slm_compliance add column if not exists final boolean not null default false;
    alter table sm_slm_compliance add column if not exists volume integer;
    alter table sm_slm_compliance add column if not exists over_limit boolean not null default false;
    alter table sm_slm_compliance add column if not exists computed_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_slm_compliance (
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
  agreement_id uuid,
  target_id uuid,
  period_key text,
  period_label text,
  period_start date,
  period_end date,
  total integer,
  met integer,
  breached integer,
  excluded integer,
  value numeric,
  goal numeric,
  status text,
  final boolean not null default false,
  volume integer,
  over_limit boolean not null default false,
  computed_at timestamptz
);
create index if not exists sm_slm_compliance_rev_idx on sm_slm_compliance (org_id, rev);
create index if not exists sm_slm_compliance_upd_idx on sm_slm_compliance (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_compliance_crt_idx on sm_slm_compliance (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_compliance_agreement_id_idx on sm_slm_compliance (org_id, agreement_id) where deleted_at is null;
create index if not exists sm_slm_compliance_target_id_idx on sm_slm_compliance (org_id, target_id) where deleted_at is null;
create unique index if not exists sm_slm_compliance_target_id_period_key_uk on sm_slm_compliance (org_id, target_id, period_key) where deleted_at is null;
drop trigger if exists sm_slm_compliance_sync on sm_slm_compliance;
create trigger sm_slm_compliance_sync before insert or update on sm_slm_compliance for each row execute function sm_sync_touch('slm_compliance');
create or replace trigger sm_slm_compliance_demo after insert on sm_slm_compliance for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_compliance_demo_t after update or delete on sm_slm_compliance for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_compliance enable row level security;

-- slm_config: تنظیمات سطح خدمت
do $cols$
begin
  if to_regclass('sm_slm_config') is not null then
    alter table sm_slm_config add column if not exists workspace_id uuid;
    alter table sm_slm_config add column if not exists domain_id uuid;
    alter table sm_slm_config add column if not exists unit_id uuid;
    alter table sm_slm_config add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_config add column if not exists created_by uuid;
    alter table sm_slm_config add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_config add column if not exists updated_by uuid;
    alter table sm_slm_config add column if not exists rev bigint not null default 0;
    alter table sm_slm_config add column if not exists version integer not null default 1;
    alter table sm_slm_config add column if not exists deleted_at timestamptz;
    alter table sm_slm_config add column if not exists origin text;
    alter table sm_slm_config add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_config add column if not exists name text;
    alter table sm_slm_config add column if not exists config_key text;
    alter table sm_slm_config add column if not exists compliance_target numeric;
    alter table sm_slm_config add column if not exists at_risk_target numeric;
    alter table sm_slm_config add column if not exists review_months integer;
    alter table sm_slm_config add column if not exists review_reminder_days integer;
    alter table sm_slm_config add column if not exists expiry_reminder_days integer;
    alter table sm_slm_config add column if not exists k_min integer;
    alter table sm_slm_config add column if not exists watermelon_gap integer;
    alter table sm_slm_config add column if not exists require_experience_target boolean not null default false;
    alter table sm_slm_config add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_slm_config (
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
  compliance_target numeric,
  at_risk_target numeric,
  review_months integer,
  review_reminder_days integer,
  expiry_reminder_days integer,
  k_min integer,
  watermelon_gap integer,
  require_experience_target boolean not null default false,
  seeded integer
);
create index if not exists sm_slm_config_rev_idx on sm_slm_config (org_id, rev);
create index if not exists sm_slm_config_upd_idx on sm_slm_config (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_config_crt_idx on sm_slm_config (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_slm_config_config_key_uk on sm_slm_config (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_slm_config_sync on sm_slm_config;
create trigger sm_slm_config_sync before insert or update on sm_slm_config for each row execute function sm_sync_touch('slm_config');
create or replace trigger sm_slm_config_demo after insert on sm_slm_config for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_config_demo_t after update or delete on sm_slm_config for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_config enable row level security;

-- slm_credit: جریمه‌های خدمت
do $cols$
begin
  if to_regclass('sm_slm_credits') is not null then
    alter table sm_slm_credits add column if not exists workspace_id uuid;
    alter table sm_slm_credits add column if not exists domain_id uuid;
    alter table sm_slm_credits add column if not exists unit_id uuid;
    alter table sm_slm_credits add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_credits add column if not exists created_by uuid;
    alter table sm_slm_credits add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_credits add column if not exists updated_by uuid;
    alter table sm_slm_credits add column if not exists rev bigint not null default 0;
    alter table sm_slm_credits add column if not exists version integer not null default 1;
    alter table sm_slm_credits add column if not exists deleted_at timestamptz;
    alter table sm_slm_credits add column if not exists origin text;
    alter table sm_slm_credits add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_credits add column if not exists no integer;
    alter table sm_slm_credits add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRD' || no::text else 'CRD' || lpad(no::text, 5, '0') end) stored;
    alter table sm_slm_credits add column if not exists agreement_id uuid;
    alter table sm_slm_credits add column if not exists target_id uuid;
    alter table sm_slm_credits add column if not exists compliance_id uuid;
    alter table sm_slm_credits add column if not exists period_label text;
    alter table sm_slm_credits add column if not exists period_key text;
    alter table sm_slm_credits add column if not exists value numeric;
    alter table sm_slm_credits add column if not exists goal numeric;
    alter table sm_slm_credits add column if not exists credit_pct numeric;
    alter table sm_slm_credits add column if not exists amount numeric;
    alter table sm_slm_credits add column if not exists dispute_reason text;
    alter table sm_slm_credits add column if not exists decision_note text;
    alter table sm_slm_credits add column if not exists manager_id uuid;
    alter table sm_slm_credits add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_slm_credits (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRD' || no::text else 'CRD' || lpad(no::text, 5, '0') end) stored,
  agreement_id uuid,
  target_id uuid,
  compliance_id uuid,
  period_label text,
  period_key text,
  value numeric,
  goal numeric,
  credit_pct numeric,
  amount numeric,
  dispute_reason text,
  decision_note text,
  manager_id uuid,
  state text,
  search_6c74edb0 text generated always as (translate(coalesce(period_label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_slm_credits' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_6c74edb0' loop
    execute format('alter table %I drop column if exists %I', 'sm_slm_credits', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_credits', 'search_6c74edb0', $x$translate(coalesce(period_label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_slm_credits' and indexname like 'sm\_slm\_credits\_search\_%' and indexname not in ('sm_slm_credits_search_6c74edb0_trgm', 'sm_slm_credits_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_slm_credits_search_6c74edb0_trgm', 'sm_slm_credits', 'search_6c74edb0', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_slm_credits_search_custom_trgm', 'sm_slm_credits', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_slm_credits_no_uk on sm_slm_credits (org_id, no);
create index if not exists sm_slm_credits_rev_idx on sm_slm_credits (org_id, rev);
create index if not exists sm_slm_credits_upd_idx on sm_slm_credits (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_credits_crt_idx on sm_slm_credits (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_credits_agreement_id_idx on sm_slm_credits (org_id, agreement_id) where deleted_at is null;
create index if not exists sm_slm_credits_state_idx on sm_slm_credits (org_id, state) where deleted_at is null;
create unique index if not exists sm_slm_credits_target_id_period_key_uk on sm_slm_credits (org_id, target_id, period_key) where deleted_at is null;
create index if not exists sm_slm_credits_workspace_acc_idx on sm_slm_credits (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_slm_credits_unit_acc_idx on sm_slm_credits (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_slm_credits_domain_acc_idx on sm_slm_credits (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_slm_credits_manager_id_idx on sm_slm_credits (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_slm_credits_sync on sm_slm_credits;
create trigger sm_slm_credits_sync before insert or update on sm_slm_credits for each row execute function sm_sync_touch('slm_credit');
create or replace trigger sm_slm_credits_demo after insert on sm_slm_credits for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_credits_demo_t after update or delete on sm_slm_credits for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_credits enable row level security;

-- slm_csi_plan: برنامه‌های بهبود
do $cols$
begin
  if to_regclass('sm_slm_csi_plans') is not null then
    alter table sm_slm_csi_plans add column if not exists workspace_id uuid;
    alter table sm_slm_csi_plans add column if not exists domain_id uuid;
    alter table sm_slm_csi_plans add column if not exists unit_id uuid;
    alter table sm_slm_csi_plans add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_csi_plans add column if not exists created_by uuid;
    alter table sm_slm_csi_plans add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_csi_plans add column if not exists updated_by uuid;
    alter table sm_slm_csi_plans add column if not exists rev bigint not null default 0;
    alter table sm_slm_csi_plans add column if not exists version integer not null default 1;
    alter table sm_slm_csi_plans add column if not exists deleted_at timestamptz;
    alter table sm_slm_csi_plans add column if not exists origin text;
    alter table sm_slm_csi_plans add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_csi_plans add column if not exists name text;
    alter table sm_slm_csi_plans add column if not exists owner_id uuid;
    alter table sm_slm_csi_plans add column if not exists service_id uuid;
    alter table sm_slm_csi_plans add column if not exists period_from date;
    alter table sm_slm_csi_plans add column if not exists period_to date;
    alter table sm_slm_csi_plans add column if not exists objective text;
    alter table sm_slm_csi_plans add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_slm_csi_plans (
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
  owner_id uuid,
  service_id uuid,
  period_from date,
  period_to date,
  objective text,
  state text
);
create index if not exists sm_slm_csi_plans_rev_idx on sm_slm_csi_plans (org_id, rev);
create index if not exists sm_slm_csi_plans_upd_idx on sm_slm_csi_plans (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_csi_plans_crt_idx on sm_slm_csi_plans (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_csi_plans_state_idx on sm_slm_csi_plans (org_id, state) where deleted_at is null;
create index if not exists sm_slm_csi_plans_workspace_acc_idx on sm_slm_csi_plans (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_slm_csi_plans_unit_acc_idx on sm_slm_csi_plans (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_slm_csi_plans_domain_acc_idx on sm_slm_csi_plans (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_slm_csi_plans_owner_id_idx on sm_slm_csi_plans (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_slm_csi_plans_sync on sm_slm_csi_plans;
create trigger sm_slm_csi_plans_sync before insert or update on sm_slm_csi_plans for each row execute function sm_sync_touch('slm_csi_plan');
create or replace trigger sm_slm_csi_plans_demo after insert on sm_slm_csi_plans for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_csi_plans_demo_t after update or delete on sm_slm_csi_plans for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_csi_plans enable row level security;

-- slm_improvement: ثبت بهبود مستمر
do $cols$
begin
  if to_regclass('sm_slm_improvements') is not null then
    alter table sm_slm_improvements add column if not exists workspace_id uuid;
    alter table sm_slm_improvements add column if not exists domain_id uuid;
    alter table sm_slm_improvements add column if not exists unit_id uuid;
    alter table sm_slm_improvements add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_improvements add column if not exists created_by uuid;
    alter table sm_slm_improvements add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_improvements add column if not exists updated_by uuid;
    alter table sm_slm_improvements add column if not exists rev bigint not null default 0;
    alter table sm_slm_improvements add column if not exists version integer not null default 1;
    alter table sm_slm_improvements add column if not exists deleted_at timestamptz;
    alter table sm_slm_improvements add column if not exists origin text;
    alter table sm_slm_improvements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_improvements add column if not exists no integer;
    alter table sm_slm_improvements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CSI' || no::text else 'CSI' || lpad(no::text, 5, '0') end) stored;
    alter table sm_slm_improvements add column if not exists short_description text;
    alter table sm_slm_improvements add column if not exists description text;
    alter table sm_slm_improvements add column if not exists state text;
    alter table sm_slm_improvements add column if not exists priority text;
    alter table sm_slm_improvements add column if not exists impact text;
    alter table sm_slm_improvements add column if not exists urgency text;
    alter table sm_slm_improvements add column if not exists category text;
    alter table sm_slm_improvements add column if not exists subcategory text;
    alter table sm_slm_improvements add column if not exists channel text;
    alter table sm_slm_improvements add column if not exists caller_id uuid;
    alter table sm_slm_improvements add column if not exists requested_for uuid;
    alter table sm_slm_improvements add column if not exists opened_by uuid;
    alter table sm_slm_improvements add column if not exists opened_at timestamptz;
    alter table sm_slm_improvements add column if not exists assignment_group_id uuid;
    alter table sm_slm_improvements add column if not exists assigned_to uuid;
    alter table sm_slm_improvements add column if not exists service_id uuid;
    alter table sm_slm_improvements add column if not exists offering_id uuid;
    alter table sm_slm_improvements add column if not exists ci_id uuid;
    alter table sm_slm_improvements add column if not exists location_id uuid;
    alter table sm_slm_improvements add column if not exists due_at timestamptz;
    alter table sm_slm_improvements add column if not exists resolved_at timestamptz;
    alter table sm_slm_improvements add column if not exists resolved_by uuid;
    alter table sm_slm_improvements add column if not exists closed_at timestamptz;
    alter table sm_slm_improvements add column if not exists closed_by uuid;
    alter table sm_slm_improvements add column if not exists close_code text;
    alter table sm_slm_improvements add column if not exists close_notes text;
    alter table sm_slm_improvements add column if not exists parent_id uuid;
    alter table sm_slm_improvements add column if not exists watch_list jsonb;
    alter table sm_slm_improvements add column if not exists approval text;
    alter table sm_slm_improvements add column if not exists escalation integer;
    alter table sm_slm_improvements add column if not exists reassignment_count integer;
    alter table sm_slm_improvements add column if not exists reopen_count integer;
    alter table sm_slm_improvements add column if not exists time_worked bigint;
    alter table sm_slm_improvements add column if not exists first_response_at timestamptz;
    alter table sm_slm_improvements add column if not exists active boolean not null default true;
    alter table sm_slm_improvements add column if not exists sla_due timestamptz;
    alter table sm_slm_improvements add column if not exists knowledge boolean not null default false;
    alter table sm_slm_improvements add column if not exists source text;
    alter table sm_slm_improvements add column if not exists agreement_id uuid;
    alter table sm_slm_improvements add column if not exists review_id uuid;
    alter table sm_slm_improvements add column if not exists plan_id uuid;
    alter table sm_slm_improvements add column if not exists value integer;
    alter table sm_slm_improvements add column if not exists effort integer;
    alter table sm_slm_improvements add column if not exists score numeric;
    alter table sm_slm_improvements add column if not exists benefit text;
    alter table sm_slm_improvements add column if not exists kpi_name text;
    alter table sm_slm_improvements add column if not exists kpi_baseline numeric;
    alter table sm_slm_improvements add column if not exists kpi_target numeric;
    alter table sm_slm_improvements add column if not exists kpi_actual numeric;
    alter table sm_slm_improvements add column if not exists outcome text;
  end if;
end
$cols$;
create table if not exists sm_slm_improvements (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CSI' || no::text else 'CSI' || lpad(no::text, 5, '0') end) stored,
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
  source text,
  agreement_id uuid,
  review_id uuid,
  plan_id uuid,
  value integer,
  effort integer,
  score numeric,
  benefit text,
  kpi_name text,
  kpi_baseline numeric,
  kpi_target numeric,
  kpi_actual numeric,
  outcome text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_slm_improvements' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_slm_improvements', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_improvements', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_slm_improvements' and indexname like 'sm\_slm\_improvements\_search\_%' and indexname not in ('sm_slm_improvements_search_f3bce210_trgm', 'sm_slm_improvements_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_slm_improvements_search_f3bce210_trgm', 'sm_slm_improvements', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_slm_improvements_search_custom_trgm', 'sm_slm_improvements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_slm_improvements_no_uk on sm_slm_improvements (org_id, no);
create index if not exists sm_slm_improvements_rev_idx on sm_slm_improvements (org_id, rev);
create index if not exists sm_slm_improvements_upd_idx on sm_slm_improvements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_improvements_crt_idx on sm_slm_improvements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_improvements_state_idx on sm_slm_improvements (org_id, state) where deleted_at is null;
create index if not exists sm_slm_improvements_assignment_group_id_idx on sm_slm_improvements (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_slm_improvements_assigned_to_idx on sm_slm_improvements (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_slm_improvements_agreement_id_idx on sm_slm_improvements (org_id, agreement_id) where deleted_at is null;
create index if not exists sm_slm_improvements_review_id_idx on sm_slm_improvements (org_id, review_id) where deleted_at is null;
create index if not exists sm_slm_improvements_plan_id_idx on sm_slm_improvements (org_id, plan_id) where deleted_at is null;
create index if not exists sm_slm_improvements_workspace_acc_idx on sm_slm_improvements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_slm_improvements_unit_acc_idx on sm_slm_improvements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_slm_improvements_domain_acc_idx on sm_slm_improvements (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_slm_improvements_caller_id_idx on sm_slm_improvements (org_id, caller_id) where deleted_at is null;
create index if not exists sm_slm_improvements_requested_for_idx on sm_slm_improvements (org_id, requested_for) where deleted_at is null;
create index if not exists sm_slm_improvements_opened_by_idx on sm_slm_improvements (org_id, opened_by) where deleted_at is null;
create index if not exists sm_slm_improvements_watch_list_gin on sm_slm_improvements using gin (watch_list);
create index if not exists sm_slm_improvements_open_grp_idx on sm_slm_improvements (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_slm_improvements_opened_brin on sm_slm_improvements using brin (opened_at);
drop trigger if exists sm_slm_improvements_sync on sm_slm_improvements;
create trigger sm_slm_improvements_sync before insert or update on sm_slm_improvements for each row execute function sm_sync_touch('slm_improvement');
create or replace trigger sm_slm_improvements_demo after insert on sm_slm_improvements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_improvements_demo_t after update or delete on sm_slm_improvements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_improvements enable row level security;

-- slm_review: بازبینی‌های خدمت
do $cols$
begin
  if to_regclass('sm_slm_reviews') is not null then
    alter table sm_slm_reviews add column if not exists workspace_id uuid;
    alter table sm_slm_reviews add column if not exists domain_id uuid;
    alter table sm_slm_reviews add column if not exists unit_id uuid;
    alter table sm_slm_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_reviews add column if not exists created_by uuid;
    alter table sm_slm_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_reviews add column if not exists updated_by uuid;
    alter table sm_slm_reviews add column if not exists rev bigint not null default 0;
    alter table sm_slm_reviews add column if not exists version integer not null default 1;
    alter table sm_slm_reviews add column if not exists deleted_at timestamptz;
    alter table sm_slm_reviews add column if not exists origin text;
    alter table sm_slm_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_reviews add column if not exists no integer;
    alter table sm_slm_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'REV' || no::text else 'REV' || lpad(no::text, 5, '0') end) stored;
    alter table sm_slm_reviews add column if not exists title text;
    alter table sm_slm_reviews add column if not exists kind text;
    alter table sm_slm_reviews add column if not exists agreement_id uuid;
    alter table sm_slm_reviews add column if not exists service_id uuid;
    alter table sm_slm_reviews add column if not exists period_from date;
    alter table sm_slm_reviews add column if not exists period_to date;
    alter table sm_slm_reviews add column if not exists scheduled_at timestamptz;
    alter table sm_slm_reviews add column if not exists held_at timestamptz;
    alter table sm_slm_reviews add column if not exists chair_id uuid;
    alter table sm_slm_reviews add column if not exists attendees jsonb;
    alter table sm_slm_reviews add column if not exists event_ref text;
    alter table sm_slm_reviews add column if not exists narrative text;
    alter table sm_slm_reviews add column if not exists narrative_ai boolean not null default false;
    alter table sm_slm_reviews add column if not exists pack jsonb;
    alter table sm_slm_reviews add column if not exists pack_at timestamptz;
    alter table sm_slm_reviews add column if not exists minutes text;
    alter table sm_slm_reviews add column if not exists decisions text;
    alter table sm_slm_reviews add column if not exists satisfaction integer;
    alter table sm_slm_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_slm_reviews (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'REV' || no::text else 'REV' || lpad(no::text, 5, '0') end) stored,
  title text,
  kind text,
  agreement_id uuid,
  service_id uuid,
  period_from date,
  period_to date,
  scheduled_at timestamptz,
  held_at timestamptz,
  chair_id uuid,
  attendees jsonb,
  event_ref text,
  narrative text,
  narrative_ai boolean not null default false,
  pack jsonb,
  pack_at timestamptz,
  minutes text,
  decisions text,
  satisfaction integer,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_slm_reviews' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_slm_reviews', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_slm_reviews' and indexname like 'sm\_slm\_reviews\_search\_%' and indexname not in ('sm_slm_reviews_search_cae18f1d_trgm', 'sm_slm_reviews_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_slm_reviews_search_cae18f1d_trgm', 'sm_slm_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_slm_reviews_search_custom_trgm', 'sm_slm_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_slm_reviews_no_uk on sm_slm_reviews (org_id, no);
create index if not exists sm_slm_reviews_rev_idx on sm_slm_reviews (org_id, rev);
create index if not exists sm_slm_reviews_upd_idx on sm_slm_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_reviews_crt_idx on sm_slm_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_reviews_agreement_id_idx on sm_slm_reviews (org_id, agreement_id) where deleted_at is null;
create index if not exists sm_slm_reviews_service_id_idx on sm_slm_reviews (org_id, service_id) where deleted_at is null;
create index if not exists sm_slm_reviews_state_idx on sm_slm_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_slm_reviews_workspace_acc_idx on sm_slm_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_slm_reviews_unit_acc_idx on sm_slm_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_slm_reviews_domain_acc_idx on sm_slm_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_slm_reviews_chair_id_idx on sm_slm_reviews (org_id, chair_id) where deleted_at is null;
create index if not exists sm_slm_reviews_attendees_gin on sm_slm_reviews using gin (attendees);
drop trigger if exists sm_slm_reviews_sync on sm_slm_reviews;
create trigger sm_slm_reviews_sync before insert or update on sm_slm_reviews for each row execute function sm_sync_touch('slm_review');
create or replace trigger sm_slm_reviews_demo after insert on sm_slm_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_reviews_demo_t after update or delete on sm_slm_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_reviews enable row level security;

-- slm_target: اهداف توافق‌ها
do $cols$
begin
  if to_regclass('sm_slm_targets') is not null then
    alter table sm_slm_targets add column if not exists workspace_id uuid;
    alter table sm_slm_targets add column if not exists domain_id uuid;
    alter table sm_slm_targets add column if not exists unit_id uuid;
    alter table sm_slm_targets add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_targets add column if not exists created_by uuid;
    alter table sm_slm_targets add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_targets add column if not exists updated_by uuid;
    alter table sm_slm_targets add column if not exists rev bigint not null default 0;
    alter table sm_slm_targets add column if not exists version integer not null default 1;
    alter table sm_slm_targets add column if not exists deleted_at timestamptz;
    alter table sm_slm_targets add column if not exists origin text;
    alter table sm_slm_targets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_targets add column if not exists agreement_id uuid;
    alter table sm_slm_targets add column if not exists name text;
    alter table sm_slm_targets add column if not exists kind text;
    alter table sm_slm_targets add column if not exists metric_category text;
    alter table sm_slm_targets add column if not exists goal numeric;
    alter table sm_slm_targets add column if not exists at_risk numeric;
    alter table sm_slm_targets add column if not exists customer_facing boolean not null default true;
    alter table sm_slm_targets add column if not exists xla_clause text;
    alter table sm_slm_targets add column if not exists sort_order integer;
    alter table sm_slm_targets add column if not exists table_key text;
    alter table sm_slm_targets add column if not exists timer_target text;
    alter table sm_slm_targets add column if not exists p1_hours numeric;
    alter table sm_slm_targets add column if not exists p2_hours numeric;
    alter table sm_slm_targets add column if not exists p3_hours numeric;
    alter table sm_slm_targets add column if not exists p4_hours numeric;
    alter table sm_slm_targets add column if not exists p5_hours numeric;
    alter table sm_slm_targets add column if not exists credit_tiers jsonb;
    alter table sm_slm_targets add column if not exists credit_cap_pct numeric;
    alter table sm_slm_targets add column if not exists active boolean not null default true;
    alter table sm_slm_targets add column if not exists weight integer;
    alter table sm_slm_targets add column if not exists definition_id uuid;
    alter table sm_slm_targets add column if not exists calendar_id uuid;
    alter table sm_slm_targets add column if not exists generated boolean not null default false;
    alter table sm_slm_targets add column if not exists indicator_id uuid;
    alter table sm_slm_targets add column if not exists current_value numeric;
    alter table sm_slm_targets add column if not exists current_status text;
    alter table sm_slm_targets add column if not exists current_n integer;
    alter table sm_slm_targets add column if not exists measured_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_slm_targets (
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
  agreement_id uuid,
  name text,
  kind text,
  metric_category text,
  goal numeric,
  at_risk numeric,
  customer_facing boolean not null default true,
  xla_clause text,
  sort_order integer,
  table_key text,
  timer_target text,
  p1_hours numeric,
  p2_hours numeric,
  p3_hours numeric,
  p4_hours numeric,
  p5_hours numeric,
  credit_tiers jsonb,
  credit_cap_pct numeric,
  active boolean not null default true,
  weight integer,
  definition_id uuid,
  calendar_id uuid,
  generated boolean not null default false,
  indicator_id uuid,
  current_value numeric,
  current_status text,
  current_n integer,
  measured_at timestamptz
);
create index if not exists sm_slm_targets_rev_idx on sm_slm_targets (org_id, rev);
create index if not exists sm_slm_targets_upd_idx on sm_slm_targets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_targets_crt_idx on sm_slm_targets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_targets_agreement_id_idx on sm_slm_targets (org_id, agreement_id) where deleted_at is null;
create index if not exists sm_slm_targets_definition_id_idx on sm_slm_targets (org_id, definition_id) where deleted_at is null;
drop trigger if exists sm_slm_targets_sync on sm_slm_targets;
create trigger sm_slm_targets_sync before insert or update on sm_slm_targets for each row execute function sm_sync_touch('slm_target');
create or replace trigger sm_slm_targets_demo after insert on sm_slm_targets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_targets_demo_t after update or delete on sm_slm_targets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_targets enable row level security;

-- slm_template: الگوهای توافق
do $cols$
begin
  if to_regclass('sm_slm_templates') is not null then
    alter table sm_slm_templates add column if not exists workspace_id uuid;
    alter table sm_slm_templates add column if not exists domain_id uuid;
    alter table sm_slm_templates add column if not exists unit_id uuid;
    alter table sm_slm_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_templates add column if not exists created_by uuid;
    alter table sm_slm_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_templates add column if not exists updated_by uuid;
    alter table sm_slm_templates add column if not exists rev bigint not null default 0;
    alter table sm_slm_templates add column if not exists version integer not null default 1;
    alter table sm_slm_templates add column if not exists deleted_at timestamptz;
    alter table sm_slm_templates add column if not exists origin text;
    alter table sm_slm_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_templates add column if not exists name text;
    alter table sm_slm_templates add column if not exists kind text;
    alter table sm_slm_templates add column if not exists level text;
    alter table sm_slm_templates add column if not exists active boolean not null default true;
    alter table sm_slm_templates add column if not exists review_months integer;
    alter table sm_slm_templates add column if not exists compliance_target numeric;
    alter table sm_slm_templates add column if not exists at_risk_target numeric;
    alter table sm_slm_templates add column if not exists review_period text;
    alter table sm_slm_templates add column if not exists description text;
    alter table sm_slm_templates add column if not exists terms text;
    alter table sm_slm_templates add column if not exists service_hours text;
    alter table sm_slm_templates add column if not exists responsibilities text;
    alter table sm_slm_templates add column if not exists escalation text;
    alter table sm_slm_templates add column if not exists exclusions text;
  end if;
end
$cols$;
create table if not exists sm_slm_templates (
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
  level text,
  active boolean not null default true,
  review_months integer,
  compliance_target numeric,
  at_risk_target numeric,
  review_period text,
  description text,
  terms text,
  service_hours text,
  responsibilities text,
  escalation text,
  exclusions text
);
create index if not exists sm_slm_templates_rev_idx on sm_slm_templates (org_id, rev);
create index if not exists sm_slm_templates_upd_idx on sm_slm_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_templates_crt_idx on sm_slm_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_slm_templates_sync on sm_slm_templates;
create trigger sm_slm_templates_sync before insert or update on sm_slm_templates for each row execute function sm_sync_touch('slm_template');
create or replace trigger sm_slm_templates_demo after insert on sm_slm_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_templates_demo_t after update or delete on sm_slm_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_templates enable row level security;

-- slm_template_target: اهداف الگوها
do $cols$
begin
  if to_regclass('sm_slm_template_targets') is not null then
    alter table sm_slm_template_targets add column if not exists workspace_id uuid;
    alter table sm_slm_template_targets add column if not exists domain_id uuid;
    alter table sm_slm_template_targets add column if not exists unit_id uuid;
    alter table sm_slm_template_targets add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_template_targets add column if not exists created_by uuid;
    alter table sm_slm_template_targets add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_template_targets add column if not exists updated_by uuid;
    alter table sm_slm_template_targets add column if not exists rev bigint not null default 0;
    alter table sm_slm_template_targets add column if not exists version integer not null default 1;
    alter table sm_slm_template_targets add column if not exists deleted_at timestamptz;
    alter table sm_slm_template_targets add column if not exists origin text;
    alter table sm_slm_template_targets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_template_targets add column if not exists template_id uuid;
    alter table sm_slm_template_targets add column if not exists name text;
    alter table sm_slm_template_targets add column if not exists kind text;
    alter table sm_slm_template_targets add column if not exists metric_category text;
    alter table sm_slm_template_targets add column if not exists goal numeric;
    alter table sm_slm_template_targets add column if not exists at_risk numeric;
    alter table sm_slm_template_targets add column if not exists customer_facing boolean not null default true;
    alter table sm_slm_template_targets add column if not exists xla_clause text;
    alter table sm_slm_template_targets add column if not exists sort_order integer;
    alter table sm_slm_template_targets add column if not exists table_key text;
    alter table sm_slm_template_targets add column if not exists timer_target text;
    alter table sm_slm_template_targets add column if not exists p1_hours numeric;
    alter table sm_slm_template_targets add column if not exists p2_hours numeric;
    alter table sm_slm_template_targets add column if not exists p3_hours numeric;
    alter table sm_slm_template_targets add column if not exists p4_hours numeric;
    alter table sm_slm_template_targets add column if not exists p5_hours numeric;
    alter table sm_slm_template_targets add column if not exists credit_tiers jsonb;
    alter table sm_slm_template_targets add column if not exists credit_cap_pct numeric;
  end if;
end
$cols$;
create table if not exists sm_slm_template_targets (
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
  name text,
  kind text,
  metric_category text,
  goal numeric,
  at_risk numeric,
  customer_facing boolean not null default true,
  xla_clause text,
  sort_order integer,
  table_key text,
  timer_target text,
  p1_hours numeric,
  p2_hours numeric,
  p3_hours numeric,
  p4_hours numeric,
  p5_hours numeric,
  credit_tiers jsonb,
  credit_cap_pct numeric
);
create index if not exists sm_slm_template_targets_rev_idx on sm_slm_template_targets (org_id, rev);
create index if not exists sm_slm_template_targets_upd_idx on sm_slm_template_targets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_template_targets_crt_idx on sm_slm_template_targets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_template_targets_template_id_idx on sm_slm_template_targets (org_id, template_id) where deleted_at is null;
drop trigger if exists sm_slm_template_targets_sync on sm_slm_template_targets;
create trigger sm_slm_template_targets_sync before insert or update on sm_slm_template_targets for each row execute function sm_sync_touch('slm_template_target');
create or replace trigger sm_slm_template_targets_demo after insert on sm_slm_template_targets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_template_targets_demo_t after update or delete on sm_slm_template_targets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_template_targets enable row level security;

-- slm_xla_policy: سیاست‌های تجربه (XLA)
do $cols$
begin
  if to_regclass('sm_slm_xla_policies') is not null then
    alter table sm_slm_xla_policies add column if not exists workspace_id uuid;
    alter table sm_slm_xla_policies add column if not exists domain_id uuid;
    alter table sm_slm_xla_policies add column if not exists unit_id uuid;
    alter table sm_slm_xla_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_xla_policies add column if not exists created_by uuid;
    alter table sm_slm_xla_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_xla_policies add column if not exists updated_by uuid;
    alter table sm_slm_xla_policies add column if not exists rev bigint not null default 0;
    alter table sm_slm_xla_policies add column if not exists version integer not null default 1;
    alter table sm_slm_xla_policies add column if not exists deleted_at timestamptz;
    alter table sm_slm_xla_policies add column if not exists origin text;
    alter table sm_slm_xla_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_xla_policies add column if not exists no integer;
    alter table sm_slm_xla_policies add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'XLA' || no::text else 'XLA' || lpad(no::text, 4, '0') end) stored;
    alter table sm_slm_xla_policies add column if not exists name text;
    alter table sm_slm_xla_policies add column if not exists table_key text;
    alter table sm_slm_xla_policies add column if not exists active boolean not null default true;
    alter table sm_slm_xla_policies add column if not exists sort_order integer;
    alter table sm_slm_xla_policies add column if not exists threshold integer;
    alter table sm_slm_xla_policies add column if not exists condition jsonb;
    alter table sm_slm_xla_policies add column if not exists w_reliability integer;
    alter table sm_slm_xla_policies add column if not exists w_quality integer;
    alter table sm_slm_xla_policies add column if not exists w_effort integer;
    alter table sm_slm_xla_policies add column if not exists p_breach integer;
    alter table sm_slm_xla_policies add column if not exists p_reopen integer;
    alter table sm_slm_xla_policies add column if not exists p_reassign integer;
    alter table sm_slm_xla_policies add column if not exists p_late_response integer;
    alter table sm_slm_xla_policies add column if not exists response_hours numeric;
    alter table sm_slm_xla_policies add column if not exists p_chase integer;
    alter table sm_slm_xla_policies add column if not exists use_survey boolean not null default true;
    alter table sm_slm_xla_policies add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_slm_xla_policies (
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
  number text generated always as (case when no is null then null when length(no::text) >= 4 then 'XLA' || no::text else 'XLA' || lpad(no::text, 4, '0') end) stored,
  name text,
  table_key text,
  active boolean not null default true,
  sort_order integer,
  threshold integer,
  condition jsonb,
  w_reliability integer,
  w_quality integer,
  w_effort integer,
  p_breach integer,
  p_reopen integer,
  p_reassign integer,
  p_late_response integer,
  response_hours numeric,
  p_chase integer,
  use_survey boolean not null default true,
  description text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_slm_xla_policies' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_slm_xla_policies', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_xla_policies', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_slm_xla_policies' and indexname like 'sm\_slm\_xla\_policies\_search\_%' and indexname not in ('sm_slm_xla_policies_search_56291d9d_trgm', 'sm_slm_xla_policies_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_slm_xla_policies_search_56291d9d_trgm', 'sm_slm_xla_policies', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_slm_xla_policies_search_custom_trgm', 'sm_slm_xla_policies', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_slm_xla_policies_no_uk on sm_slm_xla_policies (org_id, no);
create index if not exists sm_slm_xla_policies_rev_idx on sm_slm_xla_policies (org_id, rev);
create index if not exists sm_slm_xla_policies_upd_idx on sm_slm_xla_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_xla_policies_crt_idx on sm_slm_xla_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_slm_xla_policies_sync on sm_slm_xla_policies;
create trigger sm_slm_xla_policies_sync before insert or update on sm_slm_xla_policies for each row execute function sm_sync_touch('slm_xla_policy');
create or replace trigger sm_slm_xla_policies_demo after insert on sm_slm_xla_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_xla_policies_demo_t after update or delete on sm_slm_xla_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_xla_policies enable row level security;

-- slm_xla_score: امتیازهای تجربه
do $cols$
begin
  if to_regclass('sm_slm_xla_scores') is not null then
    alter table sm_slm_xla_scores add column if not exists workspace_id uuid;
    alter table sm_slm_xla_scores add column if not exists domain_id uuid;
    alter table sm_slm_xla_scores add column if not exists unit_id uuid;
    alter table sm_slm_xla_scores add column if not exists created_at timestamptz not null default now();
    alter table sm_slm_xla_scores add column if not exists created_by uuid;
    alter table sm_slm_xla_scores add column if not exists updated_at timestamptz not null default now();
    alter table sm_slm_xla_scores add column if not exists updated_by uuid;
    alter table sm_slm_xla_scores add column if not exists rev bigint not null default 0;
    alter table sm_slm_xla_scores add column if not exists version integer not null default 1;
    alter table sm_slm_xla_scores add column if not exists deleted_at timestamptz;
    alter table sm_slm_xla_scores add column if not exists origin text;
    alter table sm_slm_xla_scores add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_slm_xla_scores add column if not exists table_key text;
    alter table sm_slm_xla_scores add column if not exists record_id text;
    alter table sm_slm_xla_scores add column if not exists record_number text;
    alter table sm_slm_xla_scores add column if not exists policy_id uuid;
    alter table sm_slm_xla_scores add column if not exists score integer;
    alter table sm_slm_xla_scores add column if not exists band text;
    alter table sm_slm_xla_scores add column if not exists reliability integer;
    alter table sm_slm_xla_scores add column if not exists quality integer;
    alter table sm_slm_xla_scores add column if not exists effort integer;
    alter table sm_slm_xla_scores add column if not exists survey boolean not null default false;
    alter table sm_slm_xla_scores add column if not exists drivers jsonb;
    alter table sm_slm_xla_scores add column if not exists service_id uuid;
    alter table sm_slm_xla_scores add column if not exists assignment_group_id uuid;
    alter table sm_slm_xla_scores add column if not exists assigned_to uuid;
    alter table sm_slm_xla_scores add column if not exists alerted boolean not null default false;
    alter table sm_slm_xla_scores add column if not exists computed_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_slm_xla_scores (
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
  record_id text,
  record_number text,
  policy_id uuid,
  score integer,
  band text,
  reliability integer,
  quality integer,
  effort integer,
  survey boolean not null default false,
  drivers jsonb,
  service_id uuid,
  assignment_group_id uuid,
  assigned_to uuid,
  alerted boolean not null default false,
  computed_at timestamptz
);
create index if not exists sm_slm_xla_scores_rev_idx on sm_slm_xla_scores (org_id, rev);
create index if not exists sm_slm_xla_scores_upd_idx on sm_slm_xla_scores (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_xla_scores_crt_idx on sm_slm_xla_scores (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_xla_scores_record_id_idx on sm_slm_xla_scores (org_id, record_id) where deleted_at is null;
create index if not exists sm_slm_xla_scores_service_id_idx on sm_slm_xla_scores (org_id, service_id) where deleted_at is null;
create unique index if not exists sm_slm_xla_scores_table_key_record_id_uk on sm_slm_xla_scores (org_id, table_key, record_id) where deleted_at is null;
create index if not exists sm_slm_xla_scores_workspace_acc_idx on sm_slm_xla_scores (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_slm_xla_scores_unit_acc_idx on sm_slm_xla_scores (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_slm_xla_scores_domain_acc_idx on sm_slm_xla_scores (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_slm_xla_scores_assigned_to_idx on sm_slm_xla_scores (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_slm_xla_scores_sync on sm_slm_xla_scores;
create trigger sm_slm_xla_scores_sync before insert or update on sm_slm_xla_scores for each row execute function sm_sync_touch('slm_xla_score');
create or replace trigger sm_slm_xla_scores_demo after insert on sm_slm_xla_scores for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_slm_xla_scores_demo_t after update or delete on sm_slm_xla_scores for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_slm_xla_scores enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:23', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۵ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 25/30 (a0c3bc7de847)
-- software_install: نصب‌های نرم‌افزار
do $cols$
begin
  if to_regclass('sm_software_installs') is not null then
    alter table sm_software_installs add column if not exists workspace_id uuid;
    alter table sm_software_installs add column if not exists domain_id uuid;
    alter table sm_software_installs add column if not exists unit_id uuid;
    alter table sm_software_installs add column if not exists created_at timestamptz not null default now();
    alter table sm_software_installs add column if not exists created_by uuid;
    alter table sm_software_installs add column if not exists updated_at timestamptz not null default now();
    alter table sm_software_installs add column if not exists updated_by uuid;
    alter table sm_software_installs add column if not exists rev bigint not null default 0;
    alter table sm_software_installs add column if not exists version integer not null default 1;
    alter table sm_software_installs add column if not exists deleted_at timestamptz;
    alter table sm_software_installs add column if not exists origin text;
    alter table sm_software_installs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_software_installs add column if not exists ci_id uuid;
    alter table sm_software_installs add column if not exists software_model_id uuid;
    alter table sm_software_installs add column if not exists raw_name text;
    alter table sm_software_installs add column if not exists raw_version text;
    alter table sm_software_installs add column if not exists raw_publisher text;
    alter table sm_software_installs add column if not exists source text;
    alter table sm_software_installs add column if not exists source_ci_id uuid;
    alter table sm_software_installs add column if not exists user_id uuid;
    alter table sm_software_installs add column if not exists cores integer;
    alter table sm_software_installs add column if not exists first_seen_at timestamptz;
    alter table sm_software_installs add column if not exists last_seen_at timestamptz;
    alter table sm_software_installs add column if not exists last_used_at timestamptz;
    alter table sm_software_installs add column if not exists active boolean not null default true;
    alter table sm_software_installs add column if not exists removed_at timestamptz;
    alter table sm_software_installs add column if not exists normalized_by text;
    alter table sm_software_installs add column if not exists reclaim_state text;
  end if;
end
$cols$;
create table if not exists sm_software_installs (
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
  ci_id uuid,
  software_model_id uuid,
  raw_name text,
  raw_version text,
  raw_publisher text,
  source text,
  source_ci_id uuid,
  user_id uuid,
  cores integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_used_at timestamptz,
  active boolean not null default true,
  removed_at timestamptz,
  normalized_by text,
  reclaim_state text
);
create index if not exists sm_software_installs_rev_idx on sm_software_installs (org_id, rev);
create index if not exists sm_software_installs_upd_idx on sm_software_installs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_software_installs_crt_idx on sm_software_installs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_software_installs_ci_id_idx on sm_software_installs (org_id, ci_id) where deleted_at is null;
create index if not exists sm_software_installs_software_model_id_idx on sm_software_installs (org_id, software_model_id) where deleted_at is null;
create index if not exists sm_software_installs_source_ci_id_idx on sm_software_installs (org_id, source_ci_id) where deleted_at is null;
create index if not exists sm_software_installs_workspace_acc_idx on sm_software_installs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_software_installs_unit_acc_idx on sm_software_installs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_software_installs_domain_acc_idx on sm_software_installs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_software_installs_user_id_idx on sm_software_installs (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_software_installs_sync on sm_software_installs;
create trigger sm_software_installs_sync before insert or update on sm_software_installs for each row execute function sm_sync_touch('software_install');
create or replace trigger sm_software_installs_demo after insert on sm_software_installs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_software_installs_demo_t after update or delete on sm_software_installs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_software_installs enable row level security;

-- software_model: مدل‌های نرم‌افزار
do $cols$
begin
  if to_regclass('sm_software_models') is not null then
    alter table sm_software_models add column if not exists workspace_id uuid;
    alter table sm_software_models add column if not exists domain_id uuid;
    alter table sm_software_models add column if not exists unit_id uuid;
    alter table sm_software_models add column if not exists created_at timestamptz not null default now();
    alter table sm_software_models add column if not exists created_by uuid;
    alter table sm_software_models add column if not exists updated_at timestamptz not null default now();
    alter table sm_software_models add column if not exists updated_by uuid;
    alter table sm_software_models add column if not exists rev bigint not null default 0;
    alter table sm_software_models add column if not exists version integer not null default 1;
    alter table sm_software_models add column if not exists deleted_at timestamptz;
    alter table sm_software_models add column if not exists origin text;
    alter table sm_software_models add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_software_models add column if not exists no integer;
    alter table sm_software_models add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SWM' || no::text else 'SWM' || lpad(no::text, 5, '0') end) stored;
    alter table sm_software_models add column if not exists name text;
    alter table sm_software_models add column if not exists publisher_id uuid;
    alter table sm_software_models add column if not exists product text;
    alter table sm_software_models add column if not exists edition text;
    alter table sm_software_models add column if not exists sw_version text;
    alter table sm_software_models add column if not exists category text;
    alter table sm_software_models add column if not exists license_metric text;
    alter table sm_software_models add column if not exists status text;
    alter table sm_software_models add column if not exists list_price numeric;
    alter table sm_software_models add column if not exists eol_date date;
    alter table sm_software_models add column if not exists is_saas boolean not null default false;
    alter table sm_software_models add column if not exists description text;
    alter table sm_software_models add column if not exists match_patterns jsonb;
    alter table sm_software_models add column if not exists publisher_patterns jsonb;
    alter table sm_software_models add column if not exists exclude_patterns jsonb;
  end if;
end
$cols$;
create table if not exists sm_software_models (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SWM' || no::text else 'SWM' || lpad(no::text, 5, '0') end) stored,
  name text,
  publisher_id uuid,
  product text,
  edition text,
  sw_version text,
  category text,
  license_metric text,
  status text,
  list_price numeric,
  eol_date date,
  is_saas boolean not null default false,
  description text,
  match_patterns jsonb,
  publisher_patterns jsonb,
  exclude_patterns jsonb,
  search_b648b2b6 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(product, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_software_models' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_b648b2b6' loop
    execute format('alter table %I drop column if exists %I', 'sm_software_models', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_software_models', 'search_b648b2b6', $x$translate(coalesce(name, '') || ' ' || coalesce(product, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_software_models' and indexname like 'sm\_software\_models\_search\_%' and indexname not in ('sm_software_models_search_b648b2b6_trgm', 'sm_software_models_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_software_models_search_b648b2b6_trgm', 'sm_software_models', 'search_b648b2b6', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_software_models_search_custom_trgm', 'sm_software_models', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_software_models_no_uk on sm_software_models (org_id, no);
create index if not exists sm_software_models_rev_idx on sm_software_models (org_id, rev);
create index if not exists sm_software_models_upd_idx on sm_software_models (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_software_models_crt_idx on sm_software_models (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_software_models_sync on sm_software_models;
create trigger sm_software_models_sync before insert or update on sm_software_models for each row execute function sm_sync_touch('software_model');
create or replace trigger sm_software_models_demo after insert on sm_software_models for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_software_models_demo_t after update or delete on sm_software_models for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_software_models enable row level security;

-- space: فضاها و منابع
do $cols$
begin
  if to_regclass('sm_spaces') is not null then
    alter table sm_spaces add column if not exists workspace_id uuid;
    alter table sm_spaces add column if not exists domain_id uuid;
    alter table sm_spaces add column if not exists unit_id uuid;
    alter table sm_spaces add column if not exists created_at timestamptz not null default now();
    alter table sm_spaces add column if not exists created_by uuid;
    alter table sm_spaces add column if not exists updated_at timestamptz not null default now();
    alter table sm_spaces add column if not exists updated_by uuid;
    alter table sm_spaces add column if not exists rev bigint not null default 0;
    alter table sm_spaces add column if not exists version integer not null default 1;
    alter table sm_spaces add column if not exists deleted_at timestamptz;
    alter table sm_spaces add column if not exists origin text;
    alter table sm_spaces add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_spaces add column if not exists name text;
    alter table sm_spaces add column if not exists code text;
    alter table sm_spaces add column if not exists kind text;
    alter table sm_spaces add column if not exists location_id uuid;
    alter table sm_spaces add column if not exists capacity integer;
    alter table sm_spaces add column if not exists active boolean not null default true;
    alter table sm_spaces add column if not exists attributes jsonb;
    alter table sm_spaces add column if not exists bookable boolean not null default true;
    alter table sm_spaces add column if not exists requires_approval boolean not null default false;
    alter table sm_spaces add column if not exists check_in_minutes integer;
    alter table sm_spaces add column if not exists auto_release boolean not null default true;
    alter table sm_spaces add column if not exists max_hours integer;
    alter table sm_spaces add column if not exists owner_group_id uuid;
    alter table sm_spaces add column if not exists map_x integer;
    alter table sm_spaces add column if not exists map_y integer;
    alter table sm_spaces add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_spaces (
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
  location_id uuid,
  capacity integer,
  active boolean not null default true,
  attributes jsonb,
  bookable boolean not null default true,
  requires_approval boolean not null default false,
  check_in_minutes integer,
  auto_release boolean not null default true,
  max_hours integer,
  owner_group_id uuid,
  map_x integer,
  map_y integer,
  description text
);
create index if not exists sm_spaces_rev_idx on sm_spaces (org_id, rev);
create index if not exists sm_spaces_upd_idx on sm_spaces (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_spaces_crt_idx on sm_spaces (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_spaces_code_uk on sm_spaces (org_id, code) where deleted_at is null;
create index if not exists sm_spaces_location_id_idx on sm_spaces (org_id, location_id) where deleted_at is null;
create index if not exists sm_spaces_workspace_acc_idx on sm_spaces (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_spaces_unit_acc_idx on sm_spaces (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_spaces_domain_acc_idx on sm_spaces (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_spaces_open_grp_idx on sm_spaces (org_id, owner_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_spaces_sync on sm_spaces;
create trigger sm_spaces_sync before insert or update on sm_spaces for each row execute function sm_sync_touch('space');
create or replace trigger sm_spaces_demo after insert on sm_spaces for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_spaces_demo_t after update or delete on sm_spaces for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_spaces enable row level security;

-- status_report: گزارش‌های وضعیت
do $cols$
begin
  if to_regclass('sm_status_reports') is not null then
    alter table sm_status_reports add column if not exists workspace_id uuid;
    alter table sm_status_reports add column if not exists domain_id uuid;
    alter table sm_status_reports add column if not exists unit_id uuid;
    alter table sm_status_reports add column if not exists created_at timestamptz not null default now();
    alter table sm_status_reports add column if not exists created_by uuid;
    alter table sm_status_reports add column if not exists updated_at timestamptz not null default now();
    alter table sm_status_reports add column if not exists updated_by uuid;
    alter table sm_status_reports add column if not exists rev bigint not null default 0;
    alter table sm_status_reports add column if not exists version integer not null default 1;
    alter table sm_status_reports add column if not exists deleted_at timestamptz;
    alter table sm_status_reports add column if not exists origin text;
    alter table sm_status_reports add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_status_reports add column if not exists no integer;
    alter table sm_status_reports add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PSR' || no::text else 'PSR' || lpad(no::text, 6, '0') end) stored;
    alter table sm_status_reports add column if not exists title text;
    alter table sm_status_reports add column if not exists project_id uuid;
    alter table sm_status_reports add column if not exists period_start date;
    alter table sm_status_reports add column if not exists period_end date;
    alter table sm_status_reports add column if not exists state text;
    alter table sm_status_reports add column if not exists overall text;
    alter table sm_status_reports add column if not exists schedule_rag text;
    alter table sm_status_reports add column if not exists cost_rag text;
    alter table sm_status_reports add column if not exists scope_rag text;
    alter table sm_status_reports add column if not exists summary text;
    alter table sm_status_reports add column if not exists achievements text;
    alter table sm_status_reports add column if not exists next_steps text;
    alter table sm_status_reports add column if not exists risks_issues text;
    alter table sm_status_reports add column if not exists metrics jsonb;
    alter table sm_status_reports add column if not exists ai_generated boolean not null default false;
    alter table sm_status_reports add column if not exists published_at timestamptz;
    alter table sm_status_reports add column if not exists published_by uuid;
    alter table sm_status_reports add column if not exists audience jsonb;
    alter table sm_status_reports add column if not exists project_manager_id uuid;
    alter table sm_status_reports add column if not exists assignment_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_status_reports (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PSR' || no::text else 'PSR' || lpad(no::text, 6, '0') end) stored,
  title text,
  project_id uuid,
  period_start date,
  period_end date,
  state text,
  overall text,
  schedule_rag text,
  cost_rag text,
  scope_rag text,
  summary text,
  achievements text,
  next_steps text,
  risks_issues text,
  metrics jsonb,
  ai_generated boolean not null default false,
  published_at timestamptz,
  published_by uuid,
  audience jsonb,
  project_manager_id uuid,
  assignment_group_id uuid,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_status_reports' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_status_reports', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_status_reports', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_status_reports' and indexname like 'sm\_status\_reports\_search\_%' and indexname not in ('sm_status_reports_search_cae18f1d_trgm', 'sm_status_reports_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_status_reports_search_cae18f1d_trgm', 'sm_status_reports', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_status_reports_search_custom_trgm', 'sm_status_reports', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_status_reports_no_uk on sm_status_reports (org_id, no);
create index if not exists sm_status_reports_rev_idx on sm_status_reports (org_id, rev);
create index if not exists sm_status_reports_upd_idx on sm_status_reports (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_status_reports_crt_idx on sm_status_reports (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_status_reports_project_id_idx on sm_status_reports (org_id, project_id) where deleted_at is null;
create index if not exists sm_status_reports_workspace_acc_idx on sm_status_reports (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_status_reports_unit_acc_idx on sm_status_reports (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_status_reports_domain_acc_idx on sm_status_reports (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_status_reports_project_manager_id_idx on sm_status_reports (org_id, project_manager_id) where deleted_at is null;
drop trigger if exists sm_status_reports_sync on sm_status_reports;
create trigger sm_status_reports_sync before insert or update on sm_status_reports for each row execute function sm_sync_touch('status_report');
create or replace trigger sm_status_reports_demo after insert on sm_status_reports for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_status_reports_demo_t after update or delete on sm_status_reports for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_status_reports enable row level security;

-- stock_movement: گردش موجودی
do $cols$
begin
  if to_regclass('sm_stock_movements') is not null then
    alter table sm_stock_movements add column if not exists workspace_id uuid;
    alter table sm_stock_movements add column if not exists domain_id uuid;
    alter table sm_stock_movements add column if not exists unit_id uuid;
    alter table sm_stock_movements add column if not exists created_at timestamptz not null default now();
    alter table sm_stock_movements add column if not exists created_by uuid;
    alter table sm_stock_movements add column if not exists updated_at timestamptz not null default now();
    alter table sm_stock_movements add column if not exists updated_by uuid;
    alter table sm_stock_movements add column if not exists rev bigint not null default 0;
    alter table sm_stock_movements add column if not exists version integer not null default 1;
    alter table sm_stock_movements add column if not exists deleted_at timestamptz;
    alter table sm_stock_movements add column if not exists origin text;
    alter table sm_stock_movements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_stock_movements add column if not exists moved_at timestamptz;
    alter table sm_stock_movements add column if not exists kind text;
    alter table sm_stock_movements add column if not exists quantity integer;
    alter table sm_stock_movements add column if not exists model_id uuid;
    alter table sm_stock_movements add column if not exists stockroom_id uuid;
    alter table sm_stock_movements add column if not exists asset_id uuid;
    alter table sm_stock_movements add column if not exists moved_by uuid;
    alter table sm_stock_movements add column if not exists reference text;
    alter table sm_stock_movements add column if not exists reversal_of uuid;
    alter table sm_stock_movements add column if not exists note text;
    alter table sm_stock_movements add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_stock_movements (
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
  moved_at timestamptz,
  kind text,
  quantity integer,
  model_id uuid,
  stockroom_id uuid,
  asset_id uuid,
  moved_by uuid,
  reference text,
  reversal_of uuid,
  note text,
  label text
);
create index if not exists sm_stock_movements_rev_idx on sm_stock_movements (org_id, rev);
create index if not exists sm_stock_movements_upd_idx on sm_stock_movements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_stock_movements_crt_idx on sm_stock_movements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_stock_movements_model_id_idx on sm_stock_movements (org_id, model_id) where deleted_at is null;
create index if not exists sm_stock_movements_stockroom_id_idx on sm_stock_movements (org_id, stockroom_id) where deleted_at is null;
create index if not exists sm_stock_movements_asset_id_idx on sm_stock_movements (org_id, asset_id) where deleted_at is null;
drop trigger if exists sm_stock_movements_sync on sm_stock_movements;
create trigger sm_stock_movements_sync before insert or update on sm_stock_movements for each row execute function sm_sync_touch('stock_movement');
create or replace trigger sm_stock_movements_demo after insert on sm_stock_movements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_stock_movements_demo_t after update or delete on sm_stock_movements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_stock_movements enable row level security;

-- stock_rule: قاعده‌های موجودی
do $cols$
begin
  if to_regclass('sm_stock_rules') is not null then
    alter table sm_stock_rules add column if not exists workspace_id uuid;
    alter table sm_stock_rules add column if not exists domain_id uuid;
    alter table sm_stock_rules add column if not exists unit_id uuid;
    alter table sm_stock_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_stock_rules add column if not exists created_by uuid;
    alter table sm_stock_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_stock_rules add column if not exists updated_by uuid;
    alter table sm_stock_rules add column if not exists rev bigint not null default 0;
    alter table sm_stock_rules add column if not exists version integer not null default 1;
    alter table sm_stock_rules add column if not exists deleted_at timestamptz;
    alter table sm_stock_rules add column if not exists origin text;
    alter table sm_stock_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_stock_rules add column if not exists model_id uuid;
    alter table sm_stock_rules add column if not exists stockroom_id uuid;
    alter table sm_stock_rules add column if not exists min_qty integer;
    alter table sm_stock_rules add column if not exists max_qty integer;
    alter table sm_stock_rules add column if not exists reorder_qty integer;
    alter table sm_stock_rules add column if not exists lead_days integer;
    alter table sm_stock_rules add column if not exists auto_requisition boolean not null default false;
    alter table sm_stock_rules add column if not exists active boolean not null default true;
    alter table sm_stock_rules add column if not exists available integer;
    alter table sm_stock_rules add column if not exists status text;
    alter table sm_stock_rules add column if not exists last_alert_at timestamptz;
    alter table sm_stock_rules add column if not exists last_requisition_id uuid;
    alter table sm_stock_rules add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_stock_rules (
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
  model_id uuid,
  stockroom_id uuid,
  min_qty integer,
  max_qty integer,
  reorder_qty integer,
  lead_days integer,
  auto_requisition boolean not null default false,
  active boolean not null default true,
  available integer,
  status text,
  last_alert_at timestamptz,
  last_requisition_id uuid,
  label text
);
create index if not exists sm_stock_rules_rev_idx on sm_stock_rules (org_id, rev);
create index if not exists sm_stock_rules_upd_idx on sm_stock_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_stock_rules_crt_idx on sm_stock_rules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_stock_rules_model_id_idx on sm_stock_rules (org_id, model_id) where deleted_at is null;
create index if not exists sm_stock_rules_stockroom_id_idx on sm_stock_rules (org_id, stockroom_id) where deleted_at is null;
create unique index if not exists sm_stock_rules_model_id_stockroom_id_uk on sm_stock_rules (org_id, model_id, stockroom_id) where deleted_at is null;
drop trigger if exists sm_stock_rules_sync on sm_stock_rules;
create trigger sm_stock_rules_sync before insert or update on sm_stock_rules for each row execute function sm_sync_touch('stock_rule');
create or replace trigger sm_stock_rules_demo after insert on sm_stock_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_stock_rules_demo_t after update or delete on sm_stock_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_stock_rules enable row level security;

-- stockroom: انبارها
do $cols$
begin
  if to_regclass('sm_stockrooms') is not null then
    alter table sm_stockrooms add column if not exists workspace_id uuid;
    alter table sm_stockrooms add column if not exists domain_id uuid;
    alter table sm_stockrooms add column if not exists unit_id uuid;
    alter table sm_stockrooms add column if not exists created_at timestamptz not null default now();
    alter table sm_stockrooms add column if not exists created_by uuid;
    alter table sm_stockrooms add column if not exists updated_at timestamptz not null default now();
    alter table sm_stockrooms add column if not exists updated_by uuid;
    alter table sm_stockrooms add column if not exists rev bigint not null default 0;
    alter table sm_stockrooms add column if not exists version integer not null default 1;
    alter table sm_stockrooms add column if not exists deleted_at timestamptz;
    alter table sm_stockrooms add column if not exists origin text;
    alter table sm_stockrooms add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_stockrooms add column if not exists name text;
    alter table sm_stockrooms add column if not exists code text;
    alter table sm_stockrooms add column if not exists stockroom_type text;
    alter table sm_stockrooms add column if not exists location_id uuid;
    alter table sm_stockrooms add column if not exists parent_id uuid;
    alter table sm_stockrooms add column if not exists manager_id uuid;
    alter table sm_stockrooms add column if not exists group_id uuid;
    alter table sm_stockrooms add column if not exists branch_id uuid;
    alter table sm_stockrooms add column if not exists active boolean not null default true;
    alter table sm_stockrooms add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_stockrooms (
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
  stockroom_type text,
  location_id uuid,
  parent_id uuid,
  manager_id uuid,
  group_id uuid,
  branch_id uuid,
  active boolean not null default true,
  description text
);
create index if not exists sm_stockrooms_rev_idx on sm_stockrooms (org_id, rev);
create index if not exists sm_stockrooms_upd_idx on sm_stockrooms (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_stockrooms_crt_idx on sm_stockrooms (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_stockrooms_code_uk on sm_stockrooms (org_id, code) where deleted_at is null;
create index if not exists sm_stockrooms_workspace_acc_idx on sm_stockrooms (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_stockrooms_unit_acc_idx on sm_stockrooms (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_stockrooms_domain_acc_idx on sm_stockrooms (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_stockrooms_manager_id_idx on sm_stockrooms (org_id, manager_id) where deleted_at is null;
create index if not exists sm_stockrooms_open_grp_idx on sm_stockrooms (org_id, group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_stockrooms_sync on sm_stockrooms;
create trigger sm_stockrooms_sync before insert or update on sm_stockrooms for each row execute function sm_sync_touch('stockroom');
create or replace trigger sm_stockrooms_demo after insert on sm_stockrooms for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_stockrooms_demo_t after update or delete on sm_stockrooms for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_stockrooms enable row level security;

-- studio_version: نسخه‌های استودیو
do $cols$
begin
  if to_regclass('sm_studio_versions') is not null then
    alter table sm_studio_versions add column if not exists workspace_id uuid;
    alter table sm_studio_versions add column if not exists domain_id uuid;
    alter table sm_studio_versions add column if not exists unit_id uuid;
    alter table sm_studio_versions add column if not exists created_at timestamptz not null default now();
    alter table sm_studio_versions add column if not exists created_by uuid;
    alter table sm_studio_versions add column if not exists updated_at timestamptz not null default now();
    alter table sm_studio_versions add column if not exists updated_by uuid;
    alter table sm_studio_versions add column if not exists rev bigint not null default 0;
    alter table sm_studio_versions add column if not exists version integer not null default 1;
    alter table sm_studio_versions add column if not exists deleted_at timestamptz;
    alter table sm_studio_versions add column if not exists origin text;
    alter table sm_studio_versions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_studio_versions add column if not exists title text;
    alter table sm_studio_versions add column if not exists table_code text;
    alter table sm_studio_versions add column if not exists revision integer;
    alter table sm_studio_versions add column if not exists kind text;
    alter table sm_studio_versions add column if not exists note text;
    alter table sm_studio_versions add column if not exists snapshot jsonb;
  end if;
end
$cols$;
create table if not exists sm_studio_versions (
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
  table_code text,
  revision integer,
  kind text,
  note text,
  snapshot jsonb
);
create index if not exists sm_studio_versions_rev_idx on sm_studio_versions (org_id, rev);
create index if not exists sm_studio_versions_upd_idx on sm_studio_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_studio_versions_crt_idx on sm_studio_versions (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_studio_versions_sync on sm_studio_versions;
create trigger sm_studio_versions_sync before insert or update on sm_studio_versions for each row execute function sm_sync_touch('studio_version');
create or replace trigger sm_studio_versions_demo after insert on sm_studio_versions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_studio_versions_demo_t after update or delete on sm_studio_versions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_studio_versions enable row level security;

-- supplier: تأمین‌کنندگان
do $cols$
begin
  if to_regclass('sm_suppliers') is not null then
    alter table sm_suppliers add column if not exists workspace_id uuid;
    alter table sm_suppliers add column if not exists domain_id uuid;
    alter table sm_suppliers add column if not exists unit_id uuid;
    alter table sm_suppliers add column if not exists created_at timestamptz not null default now();
    alter table sm_suppliers add column if not exists created_by uuid;
    alter table sm_suppliers add column if not exists updated_at timestamptz not null default now();
    alter table sm_suppliers add column if not exists updated_by uuid;
    alter table sm_suppliers add column if not exists rev bigint not null default 0;
    alter table sm_suppliers add column if not exists version integer not null default 1;
    alter table sm_suppliers add column if not exists deleted_at timestamptz;
    alter table sm_suppliers add column if not exists origin text;
    alter table sm_suppliers add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_suppliers add column if not exists no integer;
    alter table sm_suppliers add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SUP' || no::text else 'SUP' || lpad(no::text, 5, '0') end) stored;
    alter table sm_suppliers add column if not exists name text;
    alter table sm_suppliers add column if not exists kinds jsonb;
    alter table sm_suppliers add column if not exists segment text;
    alter table sm_suppliers add column if not exists criticality text;
    alter table sm_suppliers add column if not exists computed_criticality text;
    alter table sm_suppliers add column if not exists owner_id uuid;
    alter table sm_suppliers add column if not exists group_id uuid;
    alter table sm_suppliers add column if not exists status_reason text;
    alter table sm_suppliers add column if not exists notes text;
    alter table sm_suppliers add column if not exists legal_name text;
    alter table sm_suppliers add column if not exists national_id text;
    alter table sm_suppliers add column if not exists economic_code text;
    alter table sm_suppliers add column if not exists registration_no text;
    alter table sm_suppliers add column if not exists country text;
    alter table sm_suppliers add column if not exists city text;
    alter table sm_suppliers add column if not exists website text;
    alter table sm_suppliers add column if not exists email text;
    alter table sm_suppliers add column if not exists phone text;
    alter table sm_suppliers add column if not exists address text;
    alter table sm_suppliers add column if not exists payment_terms text;
    alter table sm_suppliers add column if not exists bank_account text;
    alter table sm_suppliers add column if not exists annual_spend numeric;
    alter table sm_suppliers add column if not exists score integer;
    alter table sm_suppliers add column if not exists score_at timestamptz;
    alter table sm_suppliers add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_suppliers (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SUP' || no::text else 'SUP' || lpad(no::text, 5, '0') end) stored,
  name text,
  kinds jsonb,
  segment text,
  criticality text,
  computed_criticality text,
  owner_id uuid,
  group_id uuid,
  status_reason text,
  notes text,
  legal_name text,
  national_id text,
  economic_code text,
  registration_no text,
  country text,
  city text,
  website text,
  email text,
  phone text,
  address text,
  payment_terms text,
  bank_account text,
  annual_spend numeric,
  score integer,
  score_at timestamptz,
  state text,
  search_cac17606 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(legal_name, '') || ' ' || coalesce(national_id, '') || ' ' || coalesce(economic_code, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_suppliers' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cac17606' loop
    execute format('alter table %I drop column if exists %I', 'sm_suppliers', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_suppliers', 'search_cac17606', $x$translate(coalesce(name, '') || ' ' || coalesce(legal_name, '') || ' ' || coalesce(national_id, '') || ' ' || coalesce(economic_code, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_suppliers' and indexname like 'sm\_suppliers\_search\_%' and indexname not in ('sm_suppliers_search_cac17606_trgm', 'sm_suppliers_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_suppliers_search_cac17606_trgm', 'sm_suppliers', 'search_cac17606', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_suppliers_search_custom_trgm', 'sm_suppliers', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_suppliers_no_uk on sm_suppliers (org_id, no);
create index if not exists sm_suppliers_rev_idx on sm_suppliers (org_id, rev);
create index if not exists sm_suppliers_upd_idx on sm_suppliers (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_suppliers_crt_idx on sm_suppliers (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_suppliers_state_idx on sm_suppliers (org_id, state) where deleted_at is null;
create index if not exists sm_suppliers_workspace_acc_idx on sm_suppliers (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_suppliers_unit_acc_idx on sm_suppliers (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_suppliers_domain_acc_idx on sm_suppliers (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_suppliers_owner_id_idx on sm_suppliers (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_suppliers_sync on sm_suppliers;
create trigger sm_suppliers_sync before insert or update on sm_suppliers for each row execute function sm_sync_touch('supplier');
create or replace trigger sm_suppliers_demo after insert on sm_suppliers for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_suppliers_demo_t after update or delete on sm_suppliers for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_suppliers enable row level security;

-- supplier_config: تنظیمات تأمین‌کنندگان و قراردادها
do $cols$
begin
  if to_regclass('sm_supplier_configs') is not null then
    alter table sm_supplier_configs add column if not exists workspace_id uuid;
    alter table sm_supplier_configs add column if not exists domain_id uuid;
    alter table sm_supplier_configs add column if not exists unit_id uuid;
    alter table sm_supplier_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_supplier_configs add column if not exists created_by uuid;
    alter table sm_supplier_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_supplier_configs add column if not exists updated_by uuid;
    alter table sm_supplier_configs add column if not exists rev bigint not null default 0;
    alter table sm_supplier_configs add column if not exists version integer not null default 1;
    alter table sm_supplier_configs add column if not exists deleted_at timestamptz;
    alter table sm_supplier_configs add column if not exists origin text;
    alter table sm_supplier_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_supplier_configs add column if not exists name text;
    alter table sm_supplier_configs add column if not exists config_key text;
    alter table sm_supplier_configs add column if not exists expire_auto boolean not null default true;
    alter table sm_supplier_configs add column if not exists default_reminders jsonb;
    alter table sm_supplier_configs add column if not exists w_delivery integer;
    alter table sm_supplier_configs add column if not exists w_quality integer;
    alter table sm_supplier_configs add column if not exists w_sla integer;
    alter table sm_supplier_configs add column if not exists w_review integer;
    alter table sm_supplier_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_supplier_configs (
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
  expire_auto boolean not null default true,
  default_reminders jsonb,
  w_delivery integer,
  w_quality integer,
  w_sla integer,
  w_review integer,
  seeded integer
);
create index if not exists sm_supplier_configs_rev_idx on sm_supplier_configs (org_id, rev);
create index if not exists sm_supplier_configs_upd_idx on sm_supplier_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_configs_crt_idx on sm_supplier_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_supplier_configs_config_key_uk on sm_supplier_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_supplier_configs_sync on sm_supplier_configs;
create trigger sm_supplier_configs_sync before insert or update on sm_supplier_configs for each row execute function sm_sync_touch('supplier_config');
create or replace trigger sm_supplier_configs_demo after insert on sm_supplier_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_supplier_configs_demo_t after update or delete on sm_supplier_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_supplier_configs enable row level security;

-- supplier_contact: مخاطبان تأمین‌کنندگان
do $cols$
begin
  if to_regclass('sm_supplier_contacts') is not null then
    alter table sm_supplier_contacts add column if not exists workspace_id uuid;
    alter table sm_supplier_contacts add column if not exists domain_id uuid;
    alter table sm_supplier_contacts add column if not exists unit_id uuid;
    alter table sm_supplier_contacts add column if not exists created_at timestamptz not null default now();
    alter table sm_supplier_contacts add column if not exists created_by uuid;
    alter table sm_supplier_contacts add column if not exists updated_at timestamptz not null default now();
    alter table sm_supplier_contacts add column if not exists updated_by uuid;
    alter table sm_supplier_contacts add column if not exists rev bigint not null default 0;
    alter table sm_supplier_contacts add column if not exists version integer not null default 1;
    alter table sm_supplier_contacts add column if not exists deleted_at timestamptz;
    alter table sm_supplier_contacts add column if not exists origin text;
    alter table sm_supplier_contacts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_supplier_contacts add column if not exists supplier_id uuid;
    alter table sm_supplier_contacts add column if not exists name text;
    alter table sm_supplier_contacts add column if not exists contact_type text;
    alter table sm_supplier_contacts add column if not exists role text;
    alter table sm_supplier_contacts add column if not exists escalation_level integer;
    alter table sm_supplier_contacts add column if not exists email text;
    alter table sm_supplier_contacts add column if not exists phone text;
    alter table sm_supplier_contacts add column if not exists mobile text;
    alter table sm_supplier_contacts add column if not exists is_primary boolean not null default false;
    alter table sm_supplier_contacts add column if not exists user_id uuid;
    alter table sm_supplier_contacts add column if not exists active boolean not null default true;
    alter table sm_supplier_contacts add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_supplier_contacts (
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
  supplier_id uuid,
  name text,
  contact_type text,
  role text,
  escalation_level integer,
  email text,
  phone text,
  mobile text,
  is_primary boolean not null default false,
  user_id uuid,
  active boolean not null default true,
  notes text
);
create index if not exists sm_supplier_contacts_rev_idx on sm_supplier_contacts (org_id, rev);
create index if not exists sm_supplier_contacts_upd_idx on sm_supplier_contacts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_contacts_crt_idx on sm_supplier_contacts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_contacts_supplier_id_idx on sm_supplier_contacts (org_id, supplier_id) where deleted_at is null;
drop trigger if exists sm_supplier_contacts_sync on sm_supplier_contacts;
create trigger sm_supplier_contacts_sync before insert or update on sm_supplier_contacts for each row execute function sm_sync_touch('supplier_contact');
create or replace trigger sm_supplier_contacts_demo after insert on sm_supplier_contacts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_supplier_contacts_demo_t after update or delete on sm_supplier_contacts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_supplier_contacts enable row level security;

-- supplier_review: بازبینی‌های تأمین‌کنندگان
do $cols$
begin
  if to_regclass('sm_supplier_reviews') is not null then
    alter table sm_supplier_reviews add column if not exists workspace_id uuid;
    alter table sm_supplier_reviews add column if not exists domain_id uuid;
    alter table sm_supplier_reviews add column if not exists unit_id uuid;
    alter table sm_supplier_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_supplier_reviews add column if not exists created_by uuid;
    alter table sm_supplier_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_supplier_reviews add column if not exists updated_by uuid;
    alter table sm_supplier_reviews add column if not exists rev bigint not null default 0;
    alter table sm_supplier_reviews add column if not exists version integer not null default 1;
    alter table sm_supplier_reviews add column if not exists deleted_at timestamptz;
    alter table sm_supplier_reviews add column if not exists origin text;
    alter table sm_supplier_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_supplier_reviews add column if not exists no integer;
    alter table sm_supplier_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'QBR' || no::text else 'QBR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_supplier_reviews add column if not exists supplier_id uuid;
    alter table sm_supplier_reviews add column if not exists title text;
    alter table sm_supplier_reviews add column if not exists review_date date;
    alter table sm_supplier_reviews add column if not exists reviewer_id uuid;
    alter table sm_supplier_reviews add column if not exists quality integer;
    alter table sm_supplier_reviews add column if not exists delivery integer;
    alter table sm_supplier_reviews add column if not exists communication integer;
    alter table sm_supplier_reviews add column if not exists value_for_money integer;
    alter table sm_supplier_reviews add column if not exists overall numeric;
    alter table sm_supplier_reviews add column if not exists summary text;
    alter table sm_supplier_reviews add column if not exists actions text;
    alter table sm_supplier_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_supplier_reviews (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'QBR' || no::text else 'QBR' || lpad(no::text, 5, '0') end) stored,
  supplier_id uuid,
  title text,
  review_date date,
  reviewer_id uuid,
  quality integer,
  delivery integer,
  communication integer,
  value_for_money integer,
  overall numeric,
  summary text,
  actions text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_supplier_reviews' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_supplier_reviews', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_supplier_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_supplier_reviews' and indexname like 'sm\_supplier\_reviews\_search\_%' and indexname not in ('sm_supplier_reviews_search_cae18f1d_trgm', 'sm_supplier_reviews_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_supplier_reviews_search_cae18f1d_trgm', 'sm_supplier_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_supplier_reviews_search_custom_trgm', 'sm_supplier_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_supplier_reviews_no_uk on sm_supplier_reviews (org_id, no);
create index if not exists sm_supplier_reviews_rev_idx on sm_supplier_reviews (org_id, rev);
create index if not exists sm_supplier_reviews_upd_idx on sm_supplier_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_reviews_crt_idx on sm_supplier_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_reviews_supplier_id_idx on sm_supplier_reviews (org_id, supplier_id) where deleted_at is null;
create index if not exists sm_supplier_reviews_state_idx on sm_supplier_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_supplier_reviews_workspace_acc_idx on sm_supplier_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_supplier_reviews_unit_acc_idx on sm_supplier_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_supplier_reviews_domain_acc_idx on sm_supplier_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_supplier_reviews_reviewer_id_idx on sm_supplier_reviews (org_id, reviewer_id) where deleted_at is null;
drop trigger if exists sm_supplier_reviews_sync on sm_supplier_reviews;
create trigger sm_supplier_reviews_sync before insert or update on sm_supplier_reviews for each row execute function sm_sync_touch('supplier_review');
create or replace trigger sm_supplier_reviews_demo after insert on sm_supplier_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_supplier_reviews_demo_t after update or delete on sm_supplier_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_supplier_reviews enable row level security;

-- supplier_scorecard: کارنامه‌های تأمین‌کنندگان
do $cols$
begin
  if to_regclass('sm_supplier_scorecards') is not null then
    alter table sm_supplier_scorecards add column if not exists workspace_id uuid;
    alter table sm_supplier_scorecards add column if not exists domain_id uuid;
    alter table sm_supplier_scorecards add column if not exists unit_id uuid;
    alter table sm_supplier_scorecards add column if not exists created_at timestamptz not null default now();
    alter table sm_supplier_scorecards add column if not exists created_by uuid;
    alter table sm_supplier_scorecards add column if not exists updated_at timestamptz not null default now();
    alter table sm_supplier_scorecards add column if not exists updated_by uuid;
    alter table sm_supplier_scorecards add column if not exists rev bigint not null default 0;
    alter table sm_supplier_scorecards add column if not exists version integer not null default 1;
    alter table sm_supplier_scorecards add column if not exists deleted_at timestamptz;
    alter table sm_supplier_scorecards add column if not exists origin text;
    alter table sm_supplier_scorecards add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_supplier_scorecards add column if not exists supplier_id uuid;
    alter table sm_supplier_scorecards add column if not exists period text;
    alter table sm_supplier_scorecards add column if not exists period_label text;
    alter table sm_supplier_scorecards add column if not exists score integer;
    alter table sm_supplier_scorecards add column if not exists delivery_score integer;
    alter table sm_supplier_scorecards add column if not exists quality_score integer;
    alter table sm_supplier_scorecards add column if not exists sla_score integer;
    alter table sm_supplier_scorecards add column if not exists review_score integer;
    alter table sm_supplier_scorecards add column if not exists metrics jsonb;
    alter table sm_supplier_scorecards add column if not exists computed_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_supplier_scorecards (
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
  supplier_id uuid,
  period text,
  period_label text,
  score integer,
  delivery_score integer,
  quality_score integer,
  sla_score integer,
  review_score integer,
  metrics jsonb,
  computed_at timestamptz
);
create index if not exists sm_supplier_scorecards_rev_idx on sm_supplier_scorecards (org_id, rev);
create index if not exists sm_supplier_scorecards_upd_idx on sm_supplier_scorecards (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_scorecards_crt_idx on sm_supplier_scorecards (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_supplier_scorecards_supplier_id_idx on sm_supplier_scorecards (org_id, supplier_id) where deleted_at is null;
create index if not exists sm_supplier_scorecards_period_idx on sm_supplier_scorecards (org_id, period) where deleted_at is null;
create unique index if not exists sm_supplier_scorecards_supplier_id_period_uk on sm_supplier_scorecards (org_id, supplier_id, period) where deleted_at is null;
drop trigger if exists sm_supplier_scorecards_sync on sm_supplier_scorecards;
create trigger sm_supplier_scorecards_sync before insert or update on sm_supplier_scorecards for each row execute function sm_sync_touch('supplier_scorecard');
create or replace trigger sm_supplier_scorecards_demo after insert on sm_supplier_scorecards for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_supplier_scorecards_demo_t after update or delete on sm_supplier_scorecards for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_supplier_scorecards enable row level security;

-- survey: نظرسنجی‌ها
do $cols$
begin
  if to_regclass('sm_surveys') is not null then
    alter table sm_surveys add column if not exists workspace_id uuid;
    alter table sm_surveys add column if not exists domain_id uuid;
    alter table sm_surveys add column if not exists unit_id uuid;
    alter table sm_surveys add column if not exists created_at timestamptz not null default now();
    alter table sm_surveys add column if not exists created_by uuid;
    alter table sm_surveys add column if not exists updated_at timestamptz not null default now();
    alter table sm_surveys add column if not exists updated_by uuid;
    alter table sm_surveys add column if not exists rev bigint not null default 0;
    alter table sm_surveys add column if not exists version integer not null default 1;
    alter table sm_surveys add column if not exists deleted_at timestamptz;
    alter table sm_surveys add column if not exists origin text;
    alter table sm_surveys add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_surveys add column if not exists no integer;
    alter table sm_surveys add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SRV' || no::text else 'SRV' || lpad(no::text, 5, '0') end) stored;
    alter table sm_surveys add column if not exists name text;
    alter table sm_surveys add column if not exists kind text;
    alter table sm_surveys add column if not exists active boolean not null default true;
    alter table sm_surveys add column if not exists intro text;
    alter table sm_surveys add column if not exists thanks text;
    alter table sm_surveys add column if not exists anonymous boolean not null default false;
    alter table sm_surveys add column if not exists expires_days integer;
    alter table sm_surveys add column if not exists owner_group_id uuid;
    alter table sm_surveys add column if not exists satisfied_from integer;
    alter table sm_surveys add column if not exists aud_units jsonb;
    alter table sm_surveys add column if not exists aud_groups jsonb;
    alter table sm_surveys add column if not exists aud_locations jsonb;
    alter table sm_surveys add column if not exists aud_users jsonb;
    alter table sm_surveys add column if not exists sent_at timestamptz;
    alter table sm_surveys add column if not exists sent_count integer;
    alter table sm_surveys add column if not exists response_count integer;
  end if;
end
$cols$;
create table if not exists sm_surveys (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SRV' || no::text else 'SRV' || lpad(no::text, 5, '0') end) stored,
  name text,
  kind text,
  active boolean not null default true,
  intro text,
  thanks text,
  anonymous boolean not null default false,
  expires_days integer,
  owner_group_id uuid,
  satisfied_from integer,
  aud_units jsonb,
  aud_groups jsonb,
  aud_locations jsonb,
  aud_users jsonb,
  sent_at timestamptz,
  sent_count integer,
  response_count integer,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_surveys' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_surveys', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_surveys', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_surveys' and indexname like 'sm\_surveys\_search\_%' and indexname not in ('sm_surveys_search_56291d9d_trgm', 'sm_surveys_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_surveys_search_56291d9d_trgm', 'sm_surveys', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_surveys_search_custom_trgm', 'sm_surveys', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_surveys_no_uk on sm_surveys (org_id, no);
create index if not exists sm_surveys_rev_idx on sm_surveys (org_id, rev);
create index if not exists sm_surveys_upd_idx on sm_surveys (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_surveys_crt_idx on sm_surveys (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_surveys_owner_group_id_idx on sm_surveys (org_id, owner_group_id) where deleted_at is null;
create index if not exists sm_surveys_workspace_acc_idx on sm_surveys (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_surveys_unit_acc_idx on sm_surveys (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_surveys_domain_acc_idx on sm_surveys (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_surveys_open_grp_idx on sm_surveys (org_id, owner_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_surveys_sync on sm_surveys;
create trigger sm_surveys_sync before insert or update on sm_surveys for each row execute function sm_sync_touch('survey');
create or replace trigger sm_surveys_demo after insert on sm_surveys for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_surveys_demo_t after update or delete on sm_surveys for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_surveys enable row level security;

-- survey_invitation: دعوت‌های نظرسنجی
do $cols$
begin
  if to_regclass('sm_survey_invitations') is not null then
    alter table sm_survey_invitations add column if not exists workspace_id uuid;
    alter table sm_survey_invitations add column if not exists domain_id uuid;
    alter table sm_survey_invitations add column if not exists unit_id uuid;
    alter table sm_survey_invitations add column if not exists created_at timestamptz not null default now();
    alter table sm_survey_invitations add column if not exists created_by uuid;
    alter table sm_survey_invitations add column if not exists updated_at timestamptz not null default now();
    alter table sm_survey_invitations add column if not exists updated_by uuid;
    alter table sm_survey_invitations add column if not exists rev bigint not null default 0;
    alter table sm_survey_invitations add column if not exists version integer not null default 1;
    alter table sm_survey_invitations add column if not exists deleted_at timestamptz;
    alter table sm_survey_invitations add column if not exists origin text;
    alter table sm_survey_invitations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_survey_invitations add column if not exists no integer;
    alter table sm_survey_invitations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SVI' || no::text else 'SVI' || lpad(no::text, 7, '0') end) stored;
    alter table sm_survey_invitations add column if not exists title text;
    alter table sm_survey_invitations add column if not exists survey_id uuid;
    alter table sm_survey_invitations add column if not exists trigger_id uuid;
    alter table sm_survey_invitations add column if not exists user_id uuid;
    alter table sm_survey_invitations add column if not exists group_id uuid;
    alter table sm_survey_invitations add column if not exists table_key text;
    alter table sm_survey_invitations add column if not exists record_id text;
    alter table sm_survey_invitations add column if not exists record_number text;
    alter table sm_survey_invitations add column if not exists status text;
    alter table sm_survey_invitations add column if not exists sent_at timestamptz;
    alter table sm_survey_invitations add column if not exists expires_at timestamptz;
    alter table sm_survey_invitations add column if not exists answered_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_survey_invitations (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SVI' || no::text else 'SVI' || lpad(no::text, 7, '0') end) stored,
  title text,
  survey_id uuid,
  trigger_id uuid,
  user_id uuid,
  group_id uuid,
  table_key text,
  record_id text,
  record_number text,
  status text,
  sent_at timestamptz,
  expires_at timestamptz,
  answered_at timestamptz,
  search_7c9c2be2 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(record_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_survey_invitations' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_7c9c2be2' loop
    execute format('alter table %I drop column if exists %I', 'sm_survey_invitations', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_survey_invitations', 'search_7c9c2be2', $x$translate(coalesce(title, '') || ' ' || coalesce(record_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_survey_invitations' and indexname like 'sm\_survey\_invitations\_search\_%' and indexname not in ('sm_survey_invitations_search_7c9c2be2_trgm', 'sm_survey_invitations_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_survey_invitations_search_7c9c2be2_trgm', 'sm_survey_invitations', 'search_7c9c2be2', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_survey_invitations_search_custom_trgm', 'sm_survey_invitations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_survey_invitations_no_uk on sm_survey_invitations (org_id, no);
create index if not exists sm_survey_invitations_rev_idx on sm_survey_invitations (org_id, rev);
create index if not exists sm_survey_invitations_upd_idx on sm_survey_invitations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_invitations_crt_idx on sm_survey_invitations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_invitations_survey_id_idx on sm_survey_invitations (org_id, survey_id) where deleted_at is null;
create index if not exists sm_survey_invitations_user_id_idx on sm_survey_invitations (org_id, user_id) where deleted_at is null;
create index if not exists sm_survey_invitations_group_id_idx on sm_survey_invitations (org_id, group_id) where deleted_at is null;
create index if not exists sm_survey_invitations_record_id_idx on sm_survey_invitations (org_id, record_id) where deleted_at is null;
create index if not exists sm_survey_invitations_workspace_acc_idx on sm_survey_invitations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_survey_invitations_unit_acc_idx on sm_survey_invitations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_survey_invitations_domain_acc_idx on sm_survey_invitations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_survey_invitations_sync on sm_survey_invitations;
create trigger sm_survey_invitations_sync before insert or update on sm_survey_invitations for each row execute function sm_sync_touch('survey_invitation');
create or replace trigger sm_survey_invitations_demo after insert on sm_survey_invitations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_survey_invitations_demo_t after update or delete on sm_survey_invitations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_survey_invitations enable row level security;

-- survey_question: پرسش‌های نظرسنجی
do $cols$
begin
  if to_regclass('sm_survey_questions') is not null then
    alter table sm_survey_questions add column if not exists workspace_id uuid;
    alter table sm_survey_questions add column if not exists domain_id uuid;
    alter table sm_survey_questions add column if not exists unit_id uuid;
    alter table sm_survey_questions add column if not exists created_at timestamptz not null default now();
    alter table sm_survey_questions add column if not exists created_by uuid;
    alter table sm_survey_questions add column if not exists updated_at timestamptz not null default now();
    alter table sm_survey_questions add column if not exists updated_by uuid;
    alter table sm_survey_questions add column if not exists rev bigint not null default 0;
    alter table sm_survey_questions add column if not exists version integer not null default 1;
    alter table sm_survey_questions add column if not exists deleted_at timestamptz;
    alter table sm_survey_questions add column if not exists origin text;
    alter table sm_survey_questions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_survey_questions add column if not exists survey_id uuid;
    alter table sm_survey_questions add column if not exists sort_order integer;
    alter table sm_survey_questions add column if not exists required boolean not null default false;
    alter table sm_survey_questions add column if not exists label text;
    alter table sm_survey_questions add column if not exists kind text;
    alter table sm_survey_questions add column if not exists metric text;
    alter table sm_survey_questions add column if not exists options jsonb;
    alter table sm_survey_questions add column if not exists help text;
  end if;
end
$cols$;
create table if not exists sm_survey_questions (
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
  survey_id uuid,
  sort_order integer,
  required boolean not null default false,
  label text,
  kind text,
  metric text,
  options jsonb,
  help text
);
create index if not exists sm_survey_questions_rev_idx on sm_survey_questions (org_id, rev);
create index if not exists sm_survey_questions_upd_idx on sm_survey_questions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_questions_crt_idx on sm_survey_questions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_questions_survey_id_idx on sm_survey_questions (org_id, survey_id) where deleted_at is null;
drop trigger if exists sm_survey_questions_sync on sm_survey_questions;
create trigger sm_survey_questions_sync before insert or update on sm_survey_questions for each row execute function sm_sync_touch('survey_question');
create or replace trigger sm_survey_questions_demo after insert on sm_survey_questions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_survey_questions_demo_t after update or delete on sm_survey_questions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_survey_questions enable row level security;

-- survey_response: پاسخ‌های نظرسنجی
do $cols$
begin
  if to_regclass('sm_survey_responses') is not null then
    alter table sm_survey_responses add column if not exists workspace_id uuid;
    alter table sm_survey_responses add column if not exists domain_id uuid;
    alter table sm_survey_responses add column if not exists unit_id uuid;
    alter table sm_survey_responses add column if not exists created_at timestamptz not null default now();
    alter table sm_survey_responses add column if not exists created_by uuid;
    alter table sm_survey_responses add column if not exists updated_at timestamptz not null default now();
    alter table sm_survey_responses add column if not exists updated_by uuid;
    alter table sm_survey_responses add column if not exists rev bigint not null default 0;
    alter table sm_survey_responses add column if not exists version integer not null default 1;
    alter table sm_survey_responses add column if not exists deleted_at timestamptz;
    alter table sm_survey_responses add column if not exists origin text;
    alter table sm_survey_responses add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_survey_responses add column if not exists no integer;
    alter table sm_survey_responses add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SVR' || no::text else 'SVR' || lpad(no::text, 7, '0') end) stored;
    alter table sm_survey_responses add column if not exists title text;
    alter table sm_survey_responses add column if not exists survey_id uuid;
    alter table sm_survey_responses add column if not exists invitation_id uuid;
    alter table sm_survey_responses add column if not exists respondent_id uuid;
    alter table sm_survey_responses add column if not exists group_id uuid;
    alter table sm_survey_responses add column if not exists table_key text;
    alter table sm_survey_responses add column if not exists record_id text;
    alter table sm_survey_responses add column if not exists record_number text;
    alter table sm_survey_responses add column if not exists service_id uuid;
    alter table sm_survey_responses add column if not exists channel text;
    alter table sm_survey_responses add column if not exists answers jsonb;
    alter table sm_survey_responses add column if not exists csat integer;
    alter table sm_survey_responses add column if not exists satisfied boolean not null default false;
    alter table sm_survey_responses add column if not exists nps integer;
    alter table sm_survey_responses add column if not exists ces integer;
    alter table sm_survey_responses add column if not exists happiness integer;
    alter table sm_survey_responses add column if not exists lost_minutes integer;
    alter table sm_survey_responses add column if not exists score integer;
    alter table sm_survey_responses add column if not exists comment text;
    alter table sm_survey_responses add column if not exists submitted_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_survey_responses (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SVR' || no::text else 'SVR' || lpad(no::text, 7, '0') end) stored,
  title text,
  survey_id uuid,
  invitation_id uuid,
  respondent_id uuid,
  group_id uuid,
  table_key text,
  record_id text,
  record_number text,
  service_id uuid,
  channel text,
  answers jsonb,
  csat integer,
  satisfied boolean not null default false,
  nps integer,
  ces integer,
  happiness integer,
  lost_minutes integer,
  score integer,
  comment text,
  submitted_at timestamptz,
  search_9f010d4f text generated always as (translate(coalesce(title, '') || ' ' || coalesce(record_number, '') || ' ' || coalesce(comment, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_survey_responses' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9f010d4f' loop
    execute format('alter table %I drop column if exists %I', 'sm_survey_responses', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_survey_responses', 'search_9f010d4f', $x$translate(coalesce(title, '') || ' ' || coalesce(record_number, '') || ' ' || coalesce(comment, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_survey_responses' and indexname like 'sm\_survey\_responses\_search\_%' and indexname not in ('sm_survey_responses_search_9f010d4f_trgm', 'sm_survey_responses_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_survey_responses_search_9f010d4f_trgm', 'sm_survey_responses', 'search_9f010d4f', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_survey_responses_search_custom_trgm', 'sm_survey_responses', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_survey_responses_no_uk on sm_survey_responses (org_id, no);
create index if not exists sm_survey_responses_rev_idx on sm_survey_responses (org_id, rev);
create index if not exists sm_survey_responses_upd_idx on sm_survey_responses (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_responses_crt_idx on sm_survey_responses (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_responses_survey_id_idx on sm_survey_responses (org_id, survey_id) where deleted_at is null;
create unique index if not exists sm_survey_responses_invitation_id_uk on sm_survey_responses (org_id, invitation_id) where deleted_at is null;
create index if not exists sm_survey_responses_respondent_id_idx on sm_survey_responses (org_id, respondent_id) where deleted_at is null;
create index if not exists sm_survey_responses_group_id_idx on sm_survey_responses (org_id, group_id) where deleted_at is null;
create index if not exists sm_survey_responses_record_id_idx on sm_survey_responses (org_id, record_id) where deleted_at is null;
create index if not exists sm_survey_responses_workspace_acc_idx on sm_survey_responses (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_survey_responses_unit_acc_idx on sm_survey_responses (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_survey_responses_domain_acc_idx on sm_survey_responses (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_survey_responses_sync on sm_survey_responses;
create trigger sm_survey_responses_sync before insert or update on sm_survey_responses for each row execute function sm_sync_touch('survey_response');
create or replace trigger sm_survey_responses_demo after insert on sm_survey_responses for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_survey_responses_demo_t after update or delete on sm_survey_responses for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_survey_responses enable row level security;

-- survey_trigger: زمان‌های ارسال نظرسنجی
do $cols$
begin
  if to_regclass('sm_survey_triggers') is not null then
    alter table sm_survey_triggers add column if not exists workspace_id uuid;
    alter table sm_survey_triggers add column if not exists domain_id uuid;
    alter table sm_survey_triggers add column if not exists unit_id uuid;
    alter table sm_survey_triggers add column if not exists created_at timestamptz not null default now();
    alter table sm_survey_triggers add column if not exists created_by uuid;
    alter table sm_survey_triggers add column if not exists updated_at timestamptz not null default now();
    alter table sm_survey_triggers add column if not exists updated_by uuid;
    alter table sm_survey_triggers add column if not exists rev bigint not null default 0;
    alter table sm_survey_triggers add column if not exists version integer not null default 1;
    alter table sm_survey_triggers add column if not exists deleted_at timestamptz;
    alter table sm_survey_triggers add column if not exists origin text;
    alter table sm_survey_triggers add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_survey_triggers add column if not exists name text;
    alter table sm_survey_triggers add column if not exists survey_id uuid;
    alter table sm_survey_triggers add column if not exists table_key text;
    alter table sm_survey_triggers add column if not exists fire_on text;
    alter table sm_survey_triggers add column if not exists active boolean not null default true;
    alter table sm_survey_triggers add column if not exists condition jsonb;
    alter table sm_survey_triggers add column if not exists sample_pct integer;
    alter table sm_survey_triggers add column if not exists cooldown_days integer;
    alter table sm_survey_triggers add column if not exists channels jsonb;
  end if;
end
$cols$;
create table if not exists sm_survey_triggers (
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
  survey_id uuid,
  table_key text,
  fire_on text,
  active boolean not null default true,
  condition jsonb,
  sample_pct integer,
  cooldown_days integer,
  channels jsonb
);
create index if not exists sm_survey_triggers_rev_idx on sm_survey_triggers (org_id, rev);
create index if not exists sm_survey_triggers_upd_idx on sm_survey_triggers (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_triggers_crt_idx on sm_survey_triggers (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_survey_triggers_survey_id_idx on sm_survey_triggers (org_id, survey_id) where deleted_at is null;
drop trigger if exists sm_survey_triggers_sync on sm_survey_triggers;
create trigger sm_survey_triggers_sync before insert or update on sm_survey_triggers for each row execute function sm_sync_touch('survey_trigger');
create or replace trigger sm_survey_triggers_demo after insert on sm_survey_triggers for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_survey_triggers_demo_t after update or delete on sm_survey_triggers for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_survey_triggers enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:24', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۶ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 26/30 (a0c3bc7de847)
-- system_notice: اطلاعیه‌های سامانه
do $cols$
begin
  if to_regclass('sm_system_notices') is not null then
    alter table sm_system_notices add column if not exists workspace_id uuid;
    alter table sm_system_notices add column if not exists domain_id uuid;
    alter table sm_system_notices add column if not exists unit_id uuid;
    alter table sm_system_notices add column if not exists created_at timestamptz not null default now();
    alter table sm_system_notices add column if not exists created_by uuid;
    alter table sm_system_notices add column if not exists updated_at timestamptz not null default now();
    alter table sm_system_notices add column if not exists updated_by uuid;
    alter table sm_system_notices add column if not exists rev bigint not null default 0;
    alter table sm_system_notices add column if not exists version integer not null default 1;
    alter table sm_system_notices add column if not exists deleted_at timestamptz;
    alter table sm_system_notices add column if not exists origin text;
    alter table sm_system_notices add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_system_notices add column if not exists title text;
    alter table sm_system_notices add column if not exists body text;
    alter table sm_system_notices add column if not exists severity text;
    alter table sm_system_notices add column if not exists active boolean not null default true;
    alter table sm_system_notices add column if not exists starts_at timestamptz;
    alter table sm_system_notices add column if not exists ends_at timestamptz;
    alter table sm_system_notices add column if not exists source text;
    alter table sm_system_notices add column if not exists announcement_id text;
    alter table sm_system_notices add column if not exists published_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_system_notices (
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
  body text,
  severity text,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  source text,
  announcement_id text,
  published_at timestamptz
);
create index if not exists sm_system_notices_rev_idx on sm_system_notices (org_id, rev);
create index if not exists sm_system_notices_upd_idx on sm_system_notices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_system_notices_crt_idx on sm_system_notices (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_system_notices_sync on sm_system_notices;
create trigger sm_system_notices_sync before insert or update on sm_system_notices for each row execute function sm_sync_touch('system_notice');
create or replace trigger sm_system_notices_demo after insert on sm_system_notices for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_system_notices_demo_t after update or delete on sm_system_notices for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_system_notices enable row level security;

-- task_sla: زمان‌سنج‌های توافق
do $cols$
begin
  if to_regclass('sm_task_slas') is not null then
    alter table sm_task_slas add column if not exists workspace_id uuid;
    alter table sm_task_slas add column if not exists domain_id uuid;
    alter table sm_task_slas add column if not exists unit_id uuid;
    alter table sm_task_slas add column if not exists created_at timestamptz not null default now();
    alter table sm_task_slas add column if not exists created_by uuid;
    alter table sm_task_slas add column if not exists updated_at timestamptz not null default now();
    alter table sm_task_slas add column if not exists updated_by uuid;
    alter table sm_task_slas add column if not exists rev bigint not null default 0;
    alter table sm_task_slas add column if not exists version integer not null default 1;
    alter table sm_task_slas add column if not exists deleted_at timestamptz;
    alter table sm_task_slas add column if not exists origin text;
    alter table sm_task_slas add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_task_slas add column if not exists name text;
    alter table sm_task_slas add column if not exists definition_id uuid;
    alter table sm_task_slas add column if not exists table_key text;
    alter table sm_task_slas add column if not exists record_id text;
    alter table sm_task_slas add column if not exists record_number text;
    alter table sm_task_slas add column if not exists type text;
    alter table sm_task_slas add column if not exists target text;
    alter table sm_task_slas add column if not exists stage text;
    alter table sm_task_slas add column if not exists active boolean not null default true;
    alter table sm_task_slas add column if not exists breached boolean not null default false;
    alter table sm_task_slas add column if not exists start_at timestamptz;
    alter table sm_task_slas add column if not exists planned_end_at timestamptz;
    alter table sm_task_slas add column if not exists stop_at timestamptz;
    alter table sm_task_slas add column if not exists breached_at timestamptz;
    alter table sm_task_slas add column if not exists pause_started_at timestamptz;
    alter table sm_task_slas add column if not exists paused_total bigint;
    alter table sm_task_slas add column if not exists duration bigint;
    alter table sm_task_slas add column if not exists business_elapsed bigint;
    alter table sm_task_slas add column if not exists percent numeric;
    alter table sm_task_slas add column if not exists warned integer;
    alter table sm_task_slas add column if not exists calendar_id uuid;
    alter table sm_task_slas add column if not exists timezone text;
    alter table sm_task_slas add column if not exists computed_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_task_slas (
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
  definition_id uuid,
  table_key text,
  record_id text,
  record_number text,
  type text,
  target text,
  stage text,
  active boolean not null default true,
  breached boolean not null default false,
  start_at timestamptz,
  planned_end_at timestamptz,
  stop_at timestamptz,
  breached_at timestamptz,
  pause_started_at timestamptz,
  paused_total bigint,
  duration bigint,
  business_elapsed bigint,
  percent numeric,
  warned integer,
  calendar_id uuid,
  timezone text,
  computed_at timestamptz
);
create index if not exists sm_task_slas_rev_idx on sm_task_slas (org_id, rev);
create index if not exists sm_task_slas_upd_idx on sm_task_slas (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_task_slas_crt_idx on sm_task_slas (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_task_slas_definition_id_idx on sm_task_slas (org_id, definition_id) where deleted_at is null;
create index if not exists sm_task_slas_record_id_idx on sm_task_slas (org_id, record_id) where deleted_at is null;
create index if not exists sm_task_slas_stage_idx on sm_task_slas (org_id, stage) where deleted_at is null;
create index if not exists sm_task_slas_planned_end_at_idx on sm_task_slas (org_id, planned_end_at) where deleted_at is null;
drop trigger if exists sm_task_slas_sync on sm_task_slas;
create trigger sm_task_slas_sync before insert or update on sm_task_slas for each row execute function sm_sync_touch('task_sla');
create or replace trigger sm_task_slas_demo after insert on sm_task_slas for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_task_slas_demo_t after update or delete on sm_task_slas for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_task_slas enable row level security;

-- tech_debt: بدهی‌های فنی
do $cols$
begin
  if to_regclass('sm_tech_debts') is not null then
    alter table sm_tech_debts add column if not exists workspace_id uuid;
    alter table sm_tech_debts add column if not exists domain_id uuid;
    alter table sm_tech_debts add column if not exists unit_id uuid;
    alter table sm_tech_debts add column if not exists created_at timestamptz not null default now();
    alter table sm_tech_debts add column if not exists created_by uuid;
    alter table sm_tech_debts add column if not exists updated_at timestamptz not null default now();
    alter table sm_tech_debts add column if not exists updated_by uuid;
    alter table sm_tech_debts add column if not exists rev bigint not null default 0;
    alter table sm_tech_debts add column if not exists version integer not null default 1;
    alter table sm_tech_debts add column if not exists deleted_at timestamptz;
    alter table sm_tech_debts add column if not exists origin text;
    alter table sm_tech_debts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_tech_debts add column if not exists no integer;
    alter table sm_tech_debts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'TD' || no::text else 'TD' || lpad(no::text, 6, '0') end) stored;
    alter table sm_tech_debts add column if not exists title text;
    alter table sm_tech_debts add column if not exists service_id uuid;
    alter table sm_tech_debts add column if not exists repository_id uuid;
    alter table sm_tech_debts add column if not exists cause text;
    alter table sm_tech_debts add column if not exists interest text;
    alter table sm_tech_debts add column if not exists principal_hours numeric;
    alter table sm_tech_debts add column if not exists owner_id uuid;
    alter table sm_tech_debts add column if not exists owner_group_id uuid;
    alter table sm_tech_debts add column if not exists known_error_id uuid;
    alter table sm_tech_debts add column if not exists due_date date;
    alter table sm_tech_debts add column if not exists description text;
    alter table sm_tech_debts add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_tech_debts (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'TD' || no::text else 'TD' || lpad(no::text, 6, '0') end) stored,
  title text,
  service_id uuid,
  repository_id uuid,
  cause text,
  interest text,
  principal_hours numeric,
  owner_id uuid,
  owner_group_id uuid,
  known_error_id uuid,
  due_date date,
  description text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_tech_debts' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_tech_debts', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_tech_debts', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_tech_debts' and indexname like 'sm\_tech\_debts\_search\_%' and indexname not in ('sm_tech_debts_search_cae18f1d_trgm', 'sm_tech_debts_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_tech_debts_search_cae18f1d_trgm', 'sm_tech_debts', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_tech_debts_search_custom_trgm', 'sm_tech_debts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_tech_debts_no_uk on sm_tech_debts (org_id, no);
create index if not exists sm_tech_debts_rev_idx on sm_tech_debts (org_id, rev);
create index if not exists sm_tech_debts_upd_idx on sm_tech_debts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_tech_debts_crt_idx on sm_tech_debts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_tech_debts_state_idx on sm_tech_debts (org_id, state) where deleted_at is null;
create index if not exists sm_tech_debts_workspace_acc_idx on sm_tech_debts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_tech_debts_unit_acc_idx on sm_tech_debts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_tech_debts_domain_acc_idx on sm_tech_debts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_tech_debts_owner_id_idx on sm_tech_debts (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_tech_debts_sync on sm_tech_debts;
create trigger sm_tech_debts_sync before insert or update on sm_tech_debts for each row execute function sm_sync_touch('tech_debt');
create or replace trigger sm_tech_debts_demo after insert on sm_tech_debts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_tech_debts_demo_t after update or delete on sm_tech_debts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_tech_debts enable row level security;

-- technician: تکنسین‌ها
do $cols$
begin
  if to_regclass('sm_technicians') is not null then
    alter table sm_technicians add column if not exists workspace_id uuid;
    alter table sm_technicians add column if not exists domain_id uuid;
    alter table sm_technicians add column if not exists unit_id uuid;
    alter table sm_technicians add column if not exists created_at timestamptz not null default now();
    alter table sm_technicians add column if not exists created_by uuid;
    alter table sm_technicians add column if not exists updated_at timestamptz not null default now();
    alter table sm_technicians add column if not exists updated_by uuid;
    alter table sm_technicians add column if not exists rev bigint not null default 0;
    alter table sm_technicians add column if not exists version integer not null default 1;
    alter table sm_technicians add column if not exists deleted_at timestamptz;
    alter table sm_technicians add column if not exists origin text;
    alter table sm_technicians add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_technicians add column if not exists user_id uuid;
    alter table sm_technicians add column if not exists name text;
    alter table sm_technicians add column if not exists territories jsonb;
    alter table sm_technicians add column if not exists dispatch_group_id uuid;
    alter table sm_technicians add column if not exists skills jsonb;
    alter table sm_technicians add column if not exists skill_tags jsonb;
    alter table sm_technicians add column if not exists certifications jsonb;
    alter table sm_technicians add column if not exists calendar_id uuid;
    alter table sm_technicians add column if not exists max_tasks_per_day integer;
    alter table sm_technicians add column if not exists contractor boolean not null default false;
    alter table sm_technicians add column if not exists company text;
    alter table sm_technicians add column if not exists vehicle text;
    alter table sm_technicians add column if not exists home_lat numeric;
    alter table sm_technicians add column if not exists home_lng numeric;
    alter table sm_technicians add column if not exists last_lat numeric;
    alter table sm_technicians add column if not exists last_lng numeric;
    alter table sm_technicians add column if not exists last_seen_at timestamptz;
    alter table sm_technicians add column if not exists available boolean not null default true;
    alter table sm_technicians add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_technicians (
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
  territories jsonb,
  dispatch_group_id uuid,
  skills jsonb,
  skill_tags jsonb,
  certifications jsonb,
  calendar_id uuid,
  max_tasks_per_day integer,
  contractor boolean not null default false,
  company text,
  vehicle text,
  home_lat numeric,
  home_lng numeric,
  last_lat numeric,
  last_lng numeric,
  last_seen_at timestamptz,
  available boolean not null default true,
  active boolean not null default true
);
create index if not exists sm_technicians_rev_idx on sm_technicians (org_id, rev);
create index if not exists sm_technicians_upd_idx on sm_technicians (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_technicians_crt_idx on sm_technicians (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_technicians_user_id_uk on sm_technicians (org_id, user_id) where deleted_at is null;
create index if not exists sm_technicians_workspace_acc_idx on sm_technicians (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_technicians_unit_acc_idx on sm_technicians (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_technicians_domain_acc_idx on sm_technicians (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_technicians_user_id_idx on sm_technicians (org_id, user_id) where deleted_at is null;
create index if not exists sm_technicians_open_grp_idx on sm_technicians (org_id, dispatch_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_technicians_sync on sm_technicians;
create trigger sm_technicians_sync before insert or update on sm_technicians for each row execute function sm_sync_touch('technician');
create or replace trigger sm_technicians_demo after insert on sm_technicians for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_technicians_demo_t after update or delete on sm_technicians for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_technicians enable row level security;

-- technology_standard: استانداردهای فناوری
do $cols$
begin
  if to_regclass('sm_technology_standards') is not null then
    alter table sm_technology_standards add column if not exists workspace_id uuid;
    alter table sm_technology_standards add column if not exists domain_id uuid;
    alter table sm_technology_standards add column if not exists unit_id uuid;
    alter table sm_technology_standards add column if not exists created_at timestamptz not null default now();
    alter table sm_technology_standards add column if not exists created_by uuid;
    alter table sm_technology_standards add column if not exists updated_at timestamptz not null default now();
    alter table sm_technology_standards add column if not exists updated_by uuid;
    alter table sm_technology_standards add column if not exists rev bigint not null default 0;
    alter table sm_technology_standards add column if not exists version integer not null default 1;
    alter table sm_technology_standards add column if not exists deleted_at timestamptz;
    alter table sm_technology_standards add column if not exists origin text;
    alter table sm_technology_standards add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_technology_standards add column if not exists name text;
    alter table sm_technology_standards add column if not exists vendor text;
    alter table sm_technology_standards add column if not exists product_version text;
    alter table sm_technology_standards add column if not exists status text;
    alter table sm_technology_standards add column if not exists eol_date date;
    alter table sm_technology_standards add column if not exists valid_from date;
    alter table sm_technology_standards add column if not exists valid_to date;
    alter table sm_technology_standards add column if not exists owner_id uuid;
    alter table sm_technology_standards add column if not exists match_field text;
    alter table sm_technology_standards add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_technology_standards (
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
  vendor text,
  product_version text,
  status text,
  eol_date date,
  valid_from date,
  valid_to date,
  owner_id uuid,
  match_field text,
  notes text
);
create index if not exists sm_technology_standards_rev_idx on sm_technology_standards (org_id, rev);
create index if not exists sm_technology_standards_upd_idx on sm_technology_standards (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_technology_standards_crt_idx on sm_technology_standards (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_technology_standards_sync on sm_technology_standards;
create trigger sm_technology_standards_sync before insert or update on sm_technology_standards for each row execute function sm_sync_touch('technology_standard');
create or replace trigger sm_technology_standards_demo after insert on sm_technology_standards for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_technology_standards_demo_t after update or delete on sm_technology_standards for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_technology_standards enable row level security;

-- territory: قلمروها
do $cols$
begin
  if to_regclass('sm_territories') is not null then
    alter table sm_territories add column if not exists workspace_id uuid;
    alter table sm_territories add column if not exists domain_id uuid;
    alter table sm_territories add column if not exists unit_id uuid;
    alter table sm_territories add column if not exists created_at timestamptz not null default now();
    alter table sm_territories add column if not exists created_by uuid;
    alter table sm_territories add column if not exists updated_at timestamptz not null default now();
    alter table sm_territories add column if not exists updated_by uuid;
    alter table sm_territories add column if not exists rev bigint not null default 0;
    alter table sm_territories add column if not exists version integer not null default 1;
    alter table sm_territories add column if not exists deleted_at timestamptz;
    alter table sm_territories add column if not exists origin text;
    alter table sm_territories add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_territories add column if not exists name text;
    alter table sm_territories add column if not exists code text;
    alter table sm_territories add column if not exists active boolean not null default true;
    alter table sm_territories add column if not exists locations jsonb;
    alter table sm_territories add column if not exists dispatch_group_id uuid;
    alter table sm_territories add column if not exists calendar_id uuid;
    alter table sm_territories add column if not exists center_lat numeric;
    alter table sm_territories add column if not exists center_lng numeric;
    alter table sm_territories add column if not exists radius_km integer;
    alter table sm_territories add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_territories (
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
  active boolean not null default true,
  locations jsonb,
  dispatch_group_id uuid,
  calendar_id uuid,
  center_lat numeric,
  center_lng numeric,
  radius_km integer,
  description text
);
create index if not exists sm_territories_rev_idx on sm_territories (org_id, rev);
create index if not exists sm_territories_upd_idx on sm_territories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_territories_crt_idx on sm_territories (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_territories_code_uk on sm_territories (org_id, code) where deleted_at is null;
create index if not exists sm_territories_workspace_acc_idx on sm_territories (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_territories_unit_acc_idx on sm_territories (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_territories_domain_acc_idx on sm_territories (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_territories_open_grp_idx on sm_territories (org_id, dispatch_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_territories_sync on sm_territories;
create trigger sm_territories_sync before insert or update on sm_territories for each row execute function sm_sync_touch('territory');
create or replace trigger sm_territories_demo after insert on sm_territories for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_territories_demo_t after update or delete on sm_territories for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_territories enable row level security;

-- time_entry: ثبت‌های زمان
do $cols$
begin
  if to_regclass('sm_time_entries') is not null then
    alter table sm_time_entries add column if not exists workspace_id uuid;
    alter table sm_time_entries add column if not exists domain_id uuid;
    alter table sm_time_entries add column if not exists unit_id uuid;
    alter table sm_time_entries add column if not exists created_at timestamptz not null default now();
    alter table sm_time_entries add column if not exists created_by uuid;
    alter table sm_time_entries add column if not exists updated_at timestamptz not null default now();
    alter table sm_time_entries add column if not exists updated_by uuid;
    alter table sm_time_entries add column if not exists rev bigint not null default 0;
    alter table sm_time_entries add column if not exists version integer not null default 1;
    alter table sm_time_entries add column if not exists deleted_at timestamptz;
    alter table sm_time_entries add column if not exists origin text;
    alter table sm_time_entries add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_time_entries add column if not exists label text;
    alter table sm_time_entries add column if not exists user_id uuid;
    alter table sm_time_entries add column if not exists entry_date date;
    alter table sm_time_entries add column if not exists hours numeric;
    alter table sm_time_entries add column if not exists task_id uuid;
    alter table sm_time_entries add column if not exists project_id uuid;
    alter table sm_time_entries add column if not exists billable boolean not null default false;
    alter table sm_time_entries add column if not exists note text;
    alter table sm_time_entries add column if not exists reject_reason text;
    alter table sm_time_entries add column if not exists project_manager_id uuid;
    alter table sm_time_entries add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_time_entries (
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
  user_id uuid,
  entry_date date,
  hours numeric,
  task_id uuid,
  project_id uuid,
  billable boolean not null default false,
  note text,
  reject_reason text,
  project_manager_id uuid,
  state text
);
create index if not exists sm_time_entries_rev_idx on sm_time_entries (org_id, rev);
create index if not exists sm_time_entries_upd_idx on sm_time_entries (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_time_entries_crt_idx on sm_time_entries (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_time_entries_user_id_idx on sm_time_entries (org_id, user_id) where deleted_at is null;
create index if not exists sm_time_entries_entry_date_idx on sm_time_entries (org_id, entry_date) where deleted_at is null;
create index if not exists sm_time_entries_task_id_idx on sm_time_entries (org_id, task_id) where deleted_at is null;
create index if not exists sm_time_entries_project_id_idx on sm_time_entries (org_id, project_id) where deleted_at is null;
create index if not exists sm_time_entries_state_idx on sm_time_entries (org_id, state) where deleted_at is null;
create index if not exists sm_time_entries_workspace_acc_idx on sm_time_entries (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_time_entries_unit_acc_idx on sm_time_entries (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_time_entries_domain_acc_idx on sm_time_entries (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_time_entries_project_manager_id_idx on sm_time_entries (org_id, project_manager_id) where deleted_at is null;
drop trigger if exists sm_time_entries_sync on sm_time_entries;
create trigger sm_time_entries_sync before insert or update on sm_time_entries for each row execute function sm_sync_touch('time_entry');
create or replace trigger sm_time_entries_demo after insert on sm_time_entries for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_time_entries_demo_t after update or delete on sm_time_entries for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_time_entries enable row level security;

-- todo: کارها
do $cols$
begin
  if to_regclass('sm_todos') is not null then
    alter table sm_todos add column if not exists workspace_id uuid;
    alter table sm_todos add column if not exists domain_id uuid;
    alter table sm_todos add column if not exists unit_id uuid;
    alter table sm_todos add column if not exists created_at timestamptz not null default now();
    alter table sm_todos add column if not exists created_by uuid;
    alter table sm_todos add column if not exists updated_at timestamptz not null default now();
    alter table sm_todos add column if not exists updated_by uuid;
    alter table sm_todos add column if not exists rev bigint not null default 0;
    alter table sm_todos add column if not exists version integer not null default 1;
    alter table sm_todos add column if not exists deleted_at timestamptz;
    alter table sm_todos add column if not exists origin text;
    alter table sm_todos add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_todos add column if not exists no integer;
    alter table sm_todos add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'TODO' || no::text else 'TODO' || lpad(no::text, 7, '0') end) stored;
    alter table sm_todos add column if not exists short_description text;
    alter table sm_todos add column if not exists description text;
    alter table sm_todos add column if not exists state text;
    alter table sm_todos add column if not exists priority text;
    alter table sm_todos add column if not exists impact text;
    alter table sm_todos add column if not exists urgency text;
    alter table sm_todos add column if not exists category text;
    alter table sm_todos add column if not exists subcategory text;
    alter table sm_todos add column if not exists channel text;
    alter table sm_todos add column if not exists caller_id uuid;
    alter table sm_todos add column if not exists requested_for uuid;
    alter table sm_todos add column if not exists opened_by uuid;
    alter table sm_todos add column if not exists opened_at timestamptz;
    alter table sm_todos add column if not exists assignment_group_id uuid;
    alter table sm_todos add column if not exists assigned_to uuid;
    alter table sm_todos add column if not exists service_id uuid;
    alter table sm_todos add column if not exists offering_id uuid;
    alter table sm_todos add column if not exists ci_id uuid;
    alter table sm_todos add column if not exists location_id uuid;
    alter table sm_todos add column if not exists due_at timestamptz;
    alter table sm_todos add column if not exists resolved_at timestamptz;
    alter table sm_todos add column if not exists resolved_by uuid;
    alter table sm_todos add column if not exists closed_at timestamptz;
    alter table sm_todos add column if not exists closed_by uuid;
    alter table sm_todos add column if not exists close_code text;
    alter table sm_todos add column if not exists close_notes text;
    alter table sm_todos add column if not exists parent_id uuid;
    alter table sm_todos add column if not exists watch_list jsonb;
    alter table sm_todos add column if not exists approval text;
    alter table sm_todos add column if not exists escalation integer;
    alter table sm_todos add column if not exists reassignment_count integer;
    alter table sm_todos add column if not exists reopen_count integer;
    alter table sm_todos add column if not exists time_worked bigint;
    alter table sm_todos add column if not exists first_response_at timestamptz;
    alter table sm_todos add column if not exists active boolean not null default true;
    alter table sm_todos add column if not exists sla_due timestamptz;
    alter table sm_todos add column if not exists knowledge boolean not null default false;
    alter table sm_todos add column if not exists tags jsonb;
    alter table sm_todos add column if not exists estimate numeric;
  end if;
end
$cols$;
create table if not exists sm_todos (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'TODO' || no::text else 'TODO' || lpad(no::text, 7, '0') end) stored,
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
  tags jsonb,
  estimate numeric,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_todos' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_todos', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_todos', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_todos' and indexname like 'sm\_todos\_search\_%' and indexname not in ('sm_todos_search_f3bce210_trgm', 'sm_todos_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_todos_search_f3bce210_trgm', 'sm_todos', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_todos_search_custom_trgm', 'sm_todos', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_todos_no_uk on sm_todos (org_id, no);
create index if not exists sm_todos_rev_idx on sm_todos (org_id, rev);
create index if not exists sm_todos_upd_idx on sm_todos (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_todos_crt_idx on sm_todos (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_todos_state_idx on sm_todos (org_id, state) where deleted_at is null;
create index if not exists sm_todos_assignment_group_id_idx on sm_todos (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_todos_assigned_to_idx on sm_todos (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_todos_workspace_acc_idx on sm_todos (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_todos_unit_acc_idx on sm_todos (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_todos_domain_acc_idx on sm_todos (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_todos_caller_id_idx on sm_todos (org_id, caller_id) where deleted_at is null;
create index if not exists sm_todos_requested_for_idx on sm_todos (org_id, requested_for) where deleted_at is null;
create index if not exists sm_todos_opened_by_idx on sm_todos (org_id, opened_by) where deleted_at is null;
create index if not exists sm_todos_watch_list_gin on sm_todos using gin (watch_list);
create index if not exists sm_todos_open_grp_idx on sm_todos (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_todos_opened_brin on sm_todos using brin (opened_at);
drop trigger if exists sm_todos_sync on sm_todos;
create trigger sm_todos_sync before insert or update on sm_todos for each row execute function sm_sync_touch('todo');
create or replace trigger sm_todos_demo after insert on sm_todos for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_todos_demo_t after update or delete on sm_todos for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_todos enable row level security;

-- transform_map: نقشه‌های تبدیل
do $cols$
begin
  if to_regclass('sm_transform_maps') is not null then
    alter table sm_transform_maps add column if not exists workspace_id uuid;
    alter table sm_transform_maps add column if not exists domain_id uuid;
    alter table sm_transform_maps add column if not exists unit_id uuid;
    alter table sm_transform_maps add column if not exists created_at timestamptz not null default now();
    alter table sm_transform_maps add column if not exists created_by uuid;
    alter table sm_transform_maps add column if not exists updated_at timestamptz not null default now();
    alter table sm_transform_maps add column if not exists updated_by uuid;
    alter table sm_transform_maps add column if not exists rev bigint not null default 0;
    alter table sm_transform_maps add column if not exists version integer not null default 1;
    alter table sm_transform_maps add column if not exists deleted_at timestamptz;
    alter table sm_transform_maps add column if not exists origin text;
    alter table sm_transform_maps add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_transform_maps add column if not exists name text;
    alter table sm_transform_maps add column if not exists target_table text;
    alter table sm_transform_maps add column if not exists rules jsonb;
    alter table sm_transform_maps add column if not exists key_field text;
    alter table sm_transform_maps add column if not exists active boolean not null default true;
    alter table sm_transform_maps add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_transform_maps (
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
  target_table text,
  rules jsonb,
  key_field text,
  active boolean not null default true,
  description text
);
create index if not exists sm_transform_maps_rev_idx on sm_transform_maps (org_id, rev);
create index if not exists sm_transform_maps_upd_idx on sm_transform_maps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_transform_maps_crt_idx on sm_transform_maps (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_transform_maps_sync on sm_transform_maps;
create trigger sm_transform_maps_sync before insert or update on sm_transform_maps for each row execute function sm_sync_touch('transform_map');
create or replace trigger sm_transform_maps_demo after insert on sm_transform_maps for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_transform_maps_demo_t after update or delete on sm_transform_maps for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_transform_maps enable row level security;

-- ui_policy: سیاست‌های فرم
do $cols$
begin
  if to_regclass('sm_ui_policies') is not null then
    alter table sm_ui_policies add column if not exists workspace_id uuid;
    alter table sm_ui_policies add column if not exists domain_id uuid;
    alter table sm_ui_policies add column if not exists unit_id uuid;
    alter table sm_ui_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_ui_policies add column if not exists created_by uuid;
    alter table sm_ui_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_ui_policies add column if not exists updated_by uuid;
    alter table sm_ui_policies add column if not exists rev bigint not null default 0;
    alter table sm_ui_policies add column if not exists version integer not null default 1;
    alter table sm_ui_policies add column if not exists deleted_at timestamptz;
    alter table sm_ui_policies add column if not exists origin text;
    alter table sm_ui_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ui_policies add column if not exists name text;
    alter table sm_ui_policies add column if not exists table_key text;
    alter table sm_ui_policies add column if not exists condition jsonb;
    alter table sm_ui_policies add column if not exists actions jsonb;
    alter table sm_ui_policies add column if not exists applies_on text;
    alter table sm_ui_policies add column if not exists message text;
    alter table sm_ui_policies add column if not exists tone text;
    alter table sm_ui_policies add column if not exists sort_order integer;
    alter table sm_ui_policies add column if not exists active boolean not null default true;
    alter table sm_ui_policies add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_ui_policies (
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
  table_key text,
  condition jsonb,
  actions jsonb,
  applies_on text,
  message text,
  tone text,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_ui_policies_rev_idx on sm_ui_policies (org_id, rev);
create index if not exists sm_ui_policies_upd_idx on sm_ui_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ui_policies_crt_idx on sm_ui_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ui_policies_sync on sm_ui_policies;
create trigger sm_ui_policies_sync before insert or update on sm_ui_policies for each row execute function sm_sync_touch('ui_policy');
create or replace trigger sm_ui_policies_demo after insert on sm_ui_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ui_policies_demo_t after update or delete on sm_ui_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ui_policies enable row level security;

-- va_conversation: گفتگوهای دستیار مجازی
do $cols$
begin
  if to_regclass('sm_va_conversations') is not null then
    alter table sm_va_conversations add column if not exists workspace_id uuid;
    alter table sm_va_conversations add column if not exists domain_id uuid;
    alter table sm_va_conversations add column if not exists unit_id uuid;
    alter table sm_va_conversations add column if not exists created_at timestamptz not null default now();
    alter table sm_va_conversations add column if not exists created_by uuid;
    alter table sm_va_conversations add column if not exists updated_at timestamptz not null default now();
    alter table sm_va_conversations add column if not exists updated_by uuid;
    alter table sm_va_conversations add column if not exists rev bigint not null default 0;
    alter table sm_va_conversations add column if not exists version integer not null default 1;
    alter table sm_va_conversations add column if not exists deleted_at timestamptz;
    alter table sm_va_conversations add column if not exists origin text;
    alter table sm_va_conversations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_va_conversations add column if not exists requester_id uuid;
    alter table sm_va_conversations add column if not exists title text;
    alter table sm_va_conversations add column if not exists channel text;
    alter table sm_va_conversations add column if not exists state text;
    alter table sm_va_conversations add column if not exists topic text;
    alter table sm_va_conversations add column if not exists slots jsonb;
    alter table sm_va_conversations add column if not exists language text;
    alter table sm_va_conversations add column if not exists handoff_table text;
    alter table sm_va_conversations add column if not exists handoff_id text;
    alter table sm_va_conversations add column if not exists messages_count integer;
    alter table sm_va_conversations add column if not exists last_at timestamptz;
    alter table sm_va_conversations add column if not exists ended_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_va_conversations (
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
  requester_id uuid,
  title text,
  channel text,
  state text,
  topic text,
  slots jsonb,
  language text,
  handoff_table text,
  handoff_id text,
  messages_count integer,
  last_at timestamptz,
  ended_at timestamptz
);
create index if not exists sm_va_conversations_rev_idx on sm_va_conversations (org_id, rev);
create index if not exists sm_va_conversations_upd_idx on sm_va_conversations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_va_conversations_crt_idx on sm_va_conversations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_va_conversations_requester_id_idx on sm_va_conversations (org_id, requester_id) where deleted_at is null;
create index if not exists sm_va_conversations_workspace_acc_idx on sm_va_conversations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_va_conversations_unit_acc_idx on sm_va_conversations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_va_conversations_domain_acc_idx on sm_va_conversations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_va_conversations_sync on sm_va_conversations;
create or replace trigger sm_va_conversations_demo after insert on sm_va_conversations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_va_conversations_demo_t after update or delete on sm_va_conversations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_va_conversations enable row level security;

-- va_message: پیام‌های دستیار مجازی
do $cols$
begin
  if to_regclass('sm_va_messages') is not null then
    alter table sm_va_messages add column if not exists workspace_id uuid;
    alter table sm_va_messages add column if not exists domain_id uuid;
    alter table sm_va_messages add column if not exists unit_id uuid;
    alter table sm_va_messages add column if not exists created_at timestamptz not null default now();
    alter table sm_va_messages add column if not exists created_by uuid;
    alter table sm_va_messages add column if not exists updated_at timestamptz not null default now();
    alter table sm_va_messages add column if not exists updated_by uuid;
    alter table sm_va_messages add column if not exists rev bigint not null default 0;
    alter table sm_va_messages add column if not exists version integer not null default 1;
    alter table sm_va_messages add column if not exists deleted_at timestamptz;
    alter table sm_va_messages add column if not exists origin text;
    alter table sm_va_messages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_va_messages add column if not exists conversation_id uuid;
    alter table sm_va_messages add column if not exists requester_id uuid;
    alter table sm_va_messages add column if not exists role text;
    alter table sm_va_messages add column if not exists text text;
    alter table sm_va_messages add column if not exists cards jsonb;
    alter table sm_va_messages add column if not exists topic text;
    alter table sm_va_messages add column if not exists route text;
  end if;
end
$cols$;
create table if not exists sm_va_messages (
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
  conversation_id uuid,
  requester_id uuid,
  role text,
  text text,
  cards jsonb,
  topic text,
  route text
);
create index if not exists sm_va_messages_rev_idx on sm_va_messages (org_id, rev);
create index if not exists sm_va_messages_upd_idx on sm_va_messages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_va_messages_crt_idx on sm_va_messages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_va_messages_conversation_id_idx on sm_va_messages (org_id, conversation_id) where deleted_at is null;
create index if not exists sm_va_messages_requester_id_idx on sm_va_messages (org_id, requester_id) where deleted_at is null;
create index if not exists sm_va_messages_workspace_acc_idx on sm_va_messages (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_va_messages_unit_acc_idx on sm_va_messages (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_va_messages_domain_acc_idx on sm_va_messages (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_va_messages_sync on sm_va_messages;
create or replace trigger sm_va_messages_demo after insert on sm_va_messages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_va_messages_demo_t after update or delete on sm_va_messages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_va_messages enable row level security;

-- va_topic: موضوع‌های دستیار مجازی
do $cols$
begin
  if to_regclass('sm_va_topics') is not null then
    alter table sm_va_topics add column if not exists workspace_id uuid;
    alter table sm_va_topics add column if not exists domain_id uuid;
    alter table sm_va_topics add column if not exists unit_id uuid;
    alter table sm_va_topics add column if not exists created_at timestamptz not null default now();
    alter table sm_va_topics add column if not exists created_by uuid;
    alter table sm_va_topics add column if not exists updated_at timestamptz not null default now();
    alter table sm_va_topics add column if not exists updated_by uuid;
    alter table sm_va_topics add column if not exists rev bigint not null default 0;
    alter table sm_va_topics add column if not exists version integer not null default 1;
    alter table sm_va_topics add column if not exists deleted_at timestamptz;
    alter table sm_va_topics add column if not exists origin text;
    alter table sm_va_topics add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_va_topics add column if not exists key text;
    alter table sm_va_topics add column if not exists name text;
    alter table sm_va_topics add column if not exists kind text;
    alter table sm_va_topics add column if not exists enabled boolean not null default true;
    alter table sm_va_topics add column if not exists builtin boolean not null default false;
    alter table sm_va_topics add column if not exists priority integer;
    alter table sm_va_topics add column if not exists keywords jsonb;
    alter table sm_va_topics add column if not exists examples text;
    alter table sm_va_topics add column if not exists item_id uuid;
    alter table sm_va_topics add column if not exists tables jsonb;
    alter table sm_va_topics add column if not exists answer text;
  end if;
end
$cols$;
create table if not exists sm_va_topics (
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
  key text,
  name text,
  kind text,
  enabled boolean not null default true,
  builtin boolean not null default false,
  priority integer,
  keywords jsonb,
  examples text,
  item_id uuid,
  tables jsonb,
  answer text
);
create index if not exists sm_va_topics_rev_idx on sm_va_topics (org_id, rev);
create index if not exists sm_va_topics_upd_idx on sm_va_topics (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_va_topics_crt_idx on sm_va_topics (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_va_topics_key_uk on sm_va_topics (org_id, key) where deleted_at is null;
drop trigger if exists sm_va_topics_sync on sm_va_topics;
create trigger sm_va_topics_sync before insert or update on sm_va_topics for each row execute function sm_sync_touch('va_topic');
create or replace trigger sm_va_topics_demo after insert on sm_va_topics for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_va_topics_demo_t after update or delete on sm_va_topics for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_va_topics enable row level security;

-- variable_set: مجموعه‌پرسش‌ها
do $cols$
begin
  if to_regclass('sm_variable_sets') is not null then
    alter table sm_variable_sets add column if not exists workspace_id uuid;
    alter table sm_variable_sets add column if not exists domain_id uuid;
    alter table sm_variable_sets add column if not exists unit_id uuid;
    alter table sm_variable_sets add column if not exists created_at timestamptz not null default now();
    alter table sm_variable_sets add column if not exists created_by uuid;
    alter table sm_variable_sets add column if not exists updated_at timestamptz not null default now();
    alter table sm_variable_sets add column if not exists updated_by uuid;
    alter table sm_variable_sets add column if not exists rev bigint not null default 0;
    alter table sm_variable_sets add column if not exists version integer not null default 1;
    alter table sm_variable_sets add column if not exists deleted_at timestamptz;
    alter table sm_variable_sets add column if not exists origin text;
    alter table sm_variable_sets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_variable_sets add column if not exists name text;
    alter table sm_variable_sets add column if not exists code text;
    alter table sm_variable_sets add column if not exists multi_row boolean not null default false;
    alter table sm_variable_sets add column if not exists min_rows integer;
    alter table sm_variable_sets add column if not exists max_rows integer;
    alter table sm_variable_sets add column if not exists shared boolean not null default true;
    alter table sm_variable_sets add column if not exists active boolean not null default true;
    alter table sm_variable_sets add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_variable_sets (
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
  multi_row boolean not null default false,
  min_rows integer,
  max_rows integer,
  shared boolean not null default true,
  active boolean not null default true,
  description text
);
create index if not exists sm_variable_sets_rev_idx on sm_variable_sets (org_id, rev);
create index if not exists sm_variable_sets_upd_idx on sm_variable_sets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_variable_sets_crt_idx on sm_variable_sets (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_variable_sets_code_uk on sm_variable_sets (org_id, code) where deleted_at is null;
drop trigger if exists sm_variable_sets_sync on sm_variable_sets;
create trigger sm_variable_sets_sync before insert or update on sm_variable_sets for each row execute function sm_sync_touch('variable_set');
create or replace trigger sm_variable_sets_demo after insert on sm_variable_sets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_variable_sets_demo_t after update or delete on sm_variable_sets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_variable_sets enable row level security;

-- view: نماهای ذخیره‌شده
do $cols$
begin
  if to_regclass('sm_views') is not null then
    alter table sm_views add column if not exists workspace_id uuid;
    alter table sm_views add column if not exists domain_id uuid;
    alter table sm_views add column if not exists unit_id uuid;
    alter table sm_views add column if not exists created_at timestamptz not null default now();
    alter table sm_views add column if not exists created_by uuid;
    alter table sm_views add column if not exists updated_at timestamptz not null default now();
    alter table sm_views add column if not exists updated_by uuid;
    alter table sm_views add column if not exists rev bigint not null default 0;
    alter table sm_views add column if not exists version integer not null default 1;
    alter table sm_views add column if not exists deleted_at timestamptz;
    alter table sm_views add column if not exists origin text;
    alter table sm_views add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_views add column if not exists table_key text;
    alter table sm_views add column if not exists name text;
    alter table sm_views add column if not exists owner_id uuid;
    alter table sm_views add column if not exists shared boolean not null default false;
    alter table sm_views add column if not exists is_default boolean not null default false;
    alter table sm_views add column if not exists kind text;
    alter table sm_views add column if not exists filter jsonb;
    alter table sm_views add column if not exists q text;
    alter table sm_views add column if not exists columns jsonb;
    alter table sm_views add column if not exists sort text;
    alter table sm_views add column if not exists group_by text;
    alter table sm_views add column if not exists page_size integer;
  end if;
end
$cols$;
create table if not exists sm_views (
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
  owner_id uuid,
  shared boolean not null default false,
  is_default boolean not null default false,
  kind text,
  filter jsonb,
  q text,
  columns jsonb,
  sort text,
  group_by text,
  page_size integer
);
create index if not exists sm_views_rev_idx on sm_views (org_id, rev);
create index if not exists sm_views_upd_idx on sm_views (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_views_crt_idx on sm_views (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_views_workspace_acc_idx on sm_views (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_views_unit_acc_idx on sm_views (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_views_domain_acc_idx on sm_views (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_views_owner_id_idx on sm_views (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_views_sync on sm_views;
create trigger sm_views_sync before insert or update on sm_views for each row execute function sm_sync_touch('view');
create or replace trigger sm_views_demo after insert on sm_views for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_views_demo_t after update or delete on sm_views for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_views enable row level security;

-- visit: مراجعه‌کنندگان
do $cols$
begin
  if to_regclass('sm_visits') is not null then
    alter table sm_visits add column if not exists workspace_id uuid;
    alter table sm_visits add column if not exists domain_id uuid;
    alter table sm_visits add column if not exists unit_id uuid;
    alter table sm_visits add column if not exists created_at timestamptz not null default now();
    alter table sm_visits add column if not exists created_by uuid;
    alter table sm_visits add column if not exists updated_at timestamptz not null default now();
    alter table sm_visits add column if not exists updated_by uuid;
    alter table sm_visits add column if not exists rev bigint not null default 0;
    alter table sm_visits add column if not exists version integer not null default 1;
    alter table sm_visits add column if not exists deleted_at timestamptz;
    alter table sm_visits add column if not exists origin text;
    alter table sm_visits add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_visits add column if not exists no integer;
    alter table sm_visits add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'VIS' || no::text else 'VIS' || lpad(no::text, 7, '0') end) stored;
    alter table sm_visits add column if not exists visitor_name text;
    alter table sm_visits add column if not exists visitor_company text;
    alter table sm_visits add column if not exists visitor_phone text;
    alter table sm_visits add column if not exists visitor_email text;
    alter table sm_visits add column if not exists visitor_id_no text;
    alter table sm_visits add column if not exists host_id uuid;
    alter table sm_visits add column if not exists site_id uuid;
    alter table sm_visits add column if not exists reception_group_id uuid;
    alter table sm_visits add column if not exists expected_at timestamptz;
    alter table sm_visits add column if not exists expected_until timestamptz;
    alter table sm_visits add column if not exists badge_no text;
    alter table sm_visits add column if not exists purpose text;
    alter table sm_visits add column if not exists nda_ack boolean not null default false;
    alter table sm_visits add column if not exists safety_ack boolean not null default false;
    alter table sm_visits add column if not exists requires_nda boolean not null default false;
    alter table sm_visits add column if not exists checked_in_at timestamptz;
    alter table sm_visits add column if not exists checked_out_at timestamptz;
    alter table sm_visits add column if not exists late_minutes integer;
    alter table sm_visits add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_visits (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'VIS' || no::text else 'VIS' || lpad(no::text, 7, '0') end) stored,
  visitor_name text,
  visitor_company text,
  visitor_phone text,
  visitor_email text,
  visitor_id_no text,
  host_id uuid,
  site_id uuid,
  reception_group_id uuid,
  expected_at timestamptz,
  expected_until timestamptz,
  badge_no text,
  purpose text,
  nda_ack boolean not null default false,
  safety_ack boolean not null default false,
  requires_nda boolean not null default false,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  late_minutes integer,
  state text,
  search_efc3a717 text generated always as (translate(coalesce(visitor_name, '') || ' ' || coalesce(visitor_company, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_visits' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_efc3a717' loop
    execute format('alter table %I drop column if exists %I', 'sm_visits', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_visits', 'search_efc3a717', $x$translate(coalesce(visitor_name, '') || ' ' || coalesce(visitor_company, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_visits' and indexname like 'sm\_visits\_search\_%' and indexname not in ('sm_visits_search_efc3a717_trgm', 'sm_visits_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_visits_search_efc3a717_trgm', 'sm_visits', 'search_efc3a717', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_visits_search_custom_trgm', 'sm_visits', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_visits_no_uk on sm_visits (org_id, no);
create index if not exists sm_visits_rev_idx on sm_visits (org_id, rev);
create index if not exists sm_visits_upd_idx on sm_visits (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_visits_crt_idx on sm_visits (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_visits_host_id_idx on sm_visits (org_id, host_id) where deleted_at is null;
create index if not exists sm_visits_reception_group_id_idx on sm_visits (org_id, reception_group_id) where deleted_at is null;
create index if not exists sm_visits_state_idx on sm_visits (org_id, state) where deleted_at is null;
create index if not exists sm_visits_workspace_acc_idx on sm_visits (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_visits_unit_acc_idx on sm_visits (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_visits_domain_acc_idx on sm_visits (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_visits_sync on sm_visits;
create trigger sm_visits_sync before insert or update on sm_visits for each row execute function sm_sync_touch('visit');
create or replace trigger sm_visits_demo after insert on sm_visits for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_visits_demo_t after update or delete on sm_visits for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_visits enable row level security;

-- webhook_subscription: وب‌هوک‌های خروجی
do $cols$
begin
  if to_regclass('sm_webhook_subscriptions') is not null then
    alter table sm_webhook_subscriptions add column if not exists workspace_id uuid;
    alter table sm_webhook_subscriptions add column if not exists domain_id uuid;
    alter table sm_webhook_subscriptions add column if not exists unit_id uuid;
    alter table sm_webhook_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_webhook_subscriptions add column if not exists created_by uuid;
    alter table sm_webhook_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_webhook_subscriptions add column if not exists updated_by uuid;
    alter table sm_webhook_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_webhook_subscriptions add column if not exists version integer not null default 1;
    alter table sm_webhook_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_webhook_subscriptions add column if not exists origin text;
    alter table sm_webhook_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_webhook_subscriptions add column if not exists name text;
    alter table sm_webhook_subscriptions add column if not exists active boolean not null default true;
    alter table sm_webhook_subscriptions add column if not exists paused boolean not null default false;
    alter table sm_webhook_subscriptions add column if not exists url text;
    alter table sm_webhook_subscriptions add column if not exists secret text;
    alter table sm_webhook_subscriptions add column if not exists principal_id uuid;
    alter table sm_webhook_subscriptions add column if not exists table_key text;
    alter table sm_webhook_subscriptions add column if not exists events jsonb;
    alter table sm_webhook_subscriptions add column if not exists condition jsonb;
    alter table sm_webhook_subscriptions add column if not exists fields jsonb;
    alter table sm_webhook_subscriptions add column if not exists description text;
    alter table sm_webhook_subscriptions add column if not exists health text;
    alter table sm_webhook_subscriptions add column if not exists failures integer;
    alter table sm_webhook_subscriptions add column if not exists last_delivery_at timestamptz;
    alter table sm_webhook_subscriptions add column if not exists last_status text;
  end if;
end
$cols$;
create table if not exists sm_webhook_subscriptions (
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
  paused boolean not null default false,
  url text,
  secret text,
  principal_id uuid,
  table_key text,
  events jsonb,
  condition jsonb,
  fields jsonb,
  description text,
  health text,
  failures integer,
  last_delivery_at timestamptz,
  last_status text
);
create index if not exists sm_webhook_subscriptions_rev_idx on sm_webhook_subscriptions (org_id, rev);
create index if not exists sm_webhook_subscriptions_upd_idx on sm_webhook_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_webhook_subscriptions_crt_idx on sm_webhook_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_webhook_subscriptions_workspace_acc_idx on sm_webhook_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_webhook_subscriptions_unit_acc_idx on sm_webhook_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_webhook_subscriptions_domain_acc_idx on sm_webhook_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_webhook_subscriptions_sync on sm_webhook_subscriptions;
create trigger sm_webhook_subscriptions_sync before insert or update on sm_webhook_subscriptions for each row execute function sm_sync_touch('webhook_subscription');
create or replace trigger sm_webhook_subscriptions_demo after insert on sm_webhook_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_webhook_subscriptions_demo_t after update or delete on sm_webhook_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_webhook_subscriptions enable row level security;

-- wfm_absence: مرخصی‌ها و غیبت‌ها
do $cols$
begin
  if to_regclass('sm_wfm_absences') is not null then
    alter table sm_wfm_absences add column if not exists workspace_id uuid;
    alter table sm_wfm_absences add column if not exists domain_id uuid;
    alter table sm_wfm_absences add column if not exists unit_id uuid;
    alter table sm_wfm_absences add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_absences add column if not exists created_by uuid;
    alter table sm_wfm_absences add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_absences add column if not exists updated_by uuid;
    alter table sm_wfm_absences add column if not exists rev bigint not null default 0;
    alter table sm_wfm_absences add column if not exists version integer not null default 1;
    alter table sm_wfm_absences add column if not exists deleted_at timestamptz;
    alter table sm_wfm_absences add column if not exists origin text;
    alter table sm_wfm_absences add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_absences add column if not exists no integer;
    alter table sm_wfm_absences add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ABS' || no::text else 'ABS' || lpad(no::text, 6, '0') end) stored;
    alter table sm_wfm_absences add column if not exists user_id uuid;
    alter table sm_wfm_absences add column if not exists group_id uuid;
    alter table sm_wfm_absences add column if not exists type text;
    alter table sm_wfm_absences add column if not exists start_at timestamptz;
    alter table sm_wfm_absences add column if not exists end_at timestamptz;
    alter table sm_wfm_absences add column if not exists days numeric;
    alter table sm_wfm_absences add column if not exists delegate_id uuid;
    alter table sm_wfm_absences add column if not exists approval text;
    alter table sm_wfm_absences add column if not exists note text;
    alter table sm_wfm_absences add column if not exists reject_reason text;
    alter table sm_wfm_absences add column if not exists requested_by uuid;
    alter table sm_wfm_absences add column if not exists applied boolean not null default false;
    alter table sm_wfm_absences add column if not exists applied_until timestamptz;
    alter table sm_wfm_absences add column if not exists prev_delegate_id uuid;
    alter table sm_wfm_absences add column if not exists label text;
    alter table sm_wfm_absences add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_wfm_absences (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ABS' || no::text else 'ABS' || lpad(no::text, 6, '0') end) stored,
  user_id uuid,
  group_id uuid,
  type text,
  start_at timestamptz,
  end_at timestamptz,
  days numeric,
  delegate_id uuid,
  approval text,
  note text,
  reject_reason text,
  requested_by uuid,
  applied boolean not null default false,
  applied_until timestamptz,
  prev_delegate_id uuid,
  label text,
  state text,
  search_9e3cdfc8 text generated always as (translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_wfm_absences' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9e3cdfc8' loop
    execute format('alter table %I drop column if exists %I', 'sm_wfm_absences', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_wfm_absences', 'search_9e3cdfc8', $x$translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_wfm_absences' and indexname like 'sm\_wfm\_absences\_search\_%' and indexname not in ('sm_wfm_absences_search_9e3cdfc8_trgm', 'sm_wfm_absences_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_wfm_absences_search_9e3cdfc8_trgm', 'sm_wfm_absences', 'search_9e3cdfc8', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_wfm_absences_search_custom_trgm', 'sm_wfm_absences', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_wfm_absences_no_uk on sm_wfm_absences (org_id, no);
create index if not exists sm_wfm_absences_rev_idx on sm_wfm_absences (org_id, rev);
create index if not exists sm_wfm_absences_upd_idx on sm_wfm_absences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_absences_crt_idx on sm_wfm_absences (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_absences_user_id_idx on sm_wfm_absences (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_absences_group_id_idx on sm_wfm_absences (org_id, group_id) where deleted_at is null;
create index if not exists sm_wfm_absences_state_idx on sm_wfm_absences (org_id, state) where deleted_at is null;
create index if not exists sm_wfm_absences_workspace_acc_idx on sm_wfm_absences (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_absences_unit_acc_idx on sm_wfm_absences (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_absences_domain_acc_idx on sm_wfm_absences (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_absences_sync on sm_wfm_absences;
create trigger sm_wfm_absences_sync before insert or update on sm_wfm_absences for each row execute function sm_sync_touch('wfm_absence');
create or replace trigger sm_wfm_absences_demo after insert on sm_wfm_absences for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_absences_demo_t after update or delete on sm_wfm_absences for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_absences enable row level security;

-- wfm_agent: وضعیت کارشناسان
do $cols$
begin
  if to_regclass('sm_wfm_agents') is not null then
    alter table sm_wfm_agents add column if not exists workspace_id uuid;
    alter table sm_wfm_agents add column if not exists domain_id uuid;
    alter table sm_wfm_agents add column if not exists unit_id uuid;
    alter table sm_wfm_agents add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_agents add column if not exists created_by uuid;
    alter table sm_wfm_agents add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_agents add column if not exists updated_by uuid;
    alter table sm_wfm_agents add column if not exists rev bigint not null default 0;
    alter table sm_wfm_agents add column if not exists version integer not null default 1;
    alter table sm_wfm_agents add column if not exists deleted_at timestamptz;
    alter table sm_wfm_agents add column if not exists origin text;
    alter table sm_wfm_agents add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_agents add column if not exists user_id uuid;
    alter table sm_wfm_agents add column if not exists presence text;
    alter table sm_wfm_agents add column if not exists presence_note text;
    alter table sm_wfm_agents add column if not exists presence_since timestamptz;
    alter table sm_wfm_agents add column if not exists last_seen timestamptz;
    alter table sm_wfm_agents add column if not exists auto_away boolean not null default false;
    alter table sm_wfm_agents add column if not exists wip_limit integer;
    alter table sm_wfm_agents add column if not exists leaderboard boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_wfm_agents (
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
  presence text,
  presence_note text,
  presence_since timestamptz,
  last_seen timestamptz,
  auto_away boolean not null default false,
  wip_limit integer,
  leaderboard boolean not null default false
);
create index if not exists sm_wfm_agents_rev_idx on sm_wfm_agents (org_id, rev);
create index if not exists sm_wfm_agents_upd_idx on sm_wfm_agents (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_agents_crt_idx on sm_wfm_agents (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_wfm_agents_user_id_uk on sm_wfm_agents (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_agents_workspace_acc_idx on sm_wfm_agents (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_agents_unit_acc_idx on sm_wfm_agents (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_agents_domain_acc_idx on sm_wfm_agents (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_wfm_agents_user_id_idx on sm_wfm_agents (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_wfm_agents_sync on sm_wfm_agents;
create or replace trigger sm_wfm_agents_demo after insert on sm_wfm_agents for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_agents_demo_t after update or delete on sm_wfm_agents for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_agents enable row level security;

-- wfm_capacity: ظرفیت تیم‌ها
do $cols$
begin
  if to_regclass('sm_wfm_capacity') is not null then
    alter table sm_wfm_capacity add column if not exists workspace_id uuid;
    alter table sm_wfm_capacity add column if not exists domain_id uuid;
    alter table sm_wfm_capacity add column if not exists unit_id uuid;
    alter table sm_wfm_capacity add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_capacity add column if not exists created_by uuid;
    alter table sm_wfm_capacity add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_capacity add column if not exists updated_by uuid;
    alter table sm_wfm_capacity add column if not exists rev bigint not null default 0;
    alter table sm_wfm_capacity add column if not exists version integer not null default 1;
    alter table sm_wfm_capacity add column if not exists deleted_at timestamptz;
    alter table sm_wfm_capacity add column if not exists origin text;
    alter table sm_wfm_capacity add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_capacity add column if not exists group_id uuid;
    alter table sm_wfm_capacity add column if not exists user_id uuid;
    alter table sm_wfm_capacity add column if not exists max_open integer;
    alter table sm_wfm_capacity add column if not exists daily_throughput numeric;
    alter table sm_wfm_capacity add column if not exists aht_hours numeric;
    alter table sm_wfm_capacity add column if not exists occupancy numeric;
    alter table sm_wfm_capacity add column if not exists shrinkage numeric;
    alter table sm_wfm_capacity add column if not exists min_staff integer;
    alter table sm_wfm_capacity add column if not exists note text;
    alter table sm_wfm_capacity add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_wfm_capacity (
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
  max_open integer,
  daily_throughput numeric,
  aht_hours numeric,
  occupancy numeric,
  shrinkage numeric,
  min_staff integer,
  note text,
  label text
);
create index if not exists sm_wfm_capacity_rev_idx on sm_wfm_capacity (org_id, rev);
create index if not exists sm_wfm_capacity_upd_idx on sm_wfm_capacity (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_capacity_crt_idx on sm_wfm_capacity (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_capacity_group_id_idx on sm_wfm_capacity (org_id, group_id) where deleted_at is null;
create unique index if not exists sm_wfm_capacity_group_id_user_id_uk on sm_wfm_capacity (org_id, group_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_capacity_workspace_acc_idx on sm_wfm_capacity (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_capacity_unit_acc_idx on sm_wfm_capacity (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_capacity_domain_acc_idx on sm_wfm_capacity (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_wfm_capacity_user_id_idx on sm_wfm_capacity (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_wfm_capacity_sync on sm_wfm_capacity;
create trigger sm_wfm_capacity_sync before insert or update on sm_wfm_capacity for each row execute function sm_sync_touch('wfm_capacity');
create or replace trigger sm_wfm_capacity_demo after insert on sm_wfm_capacity for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_capacity_demo_t after update or delete on sm_wfm_capacity for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_capacity enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:25', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۷ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 27/30 (a0c3bc7de847)
-- wfm_certification: گواهینامه‌ها
do $cols$
begin
  if to_regclass('sm_wfm_certifications') is not null then
    alter table sm_wfm_certifications add column if not exists workspace_id uuid;
    alter table sm_wfm_certifications add column if not exists domain_id uuid;
    alter table sm_wfm_certifications add column if not exists unit_id uuid;
    alter table sm_wfm_certifications add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_certifications add column if not exists created_by uuid;
    alter table sm_wfm_certifications add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_certifications add column if not exists updated_by uuid;
    alter table sm_wfm_certifications add column if not exists rev bigint not null default 0;
    alter table sm_wfm_certifications add column if not exists version integer not null default 1;
    alter table sm_wfm_certifications add column if not exists deleted_at timestamptz;
    alter table sm_wfm_certifications add column if not exists origin text;
    alter table sm_wfm_certifications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_certifications add column if not exists user_id uuid;
    alter table sm_wfm_certifications add column if not exists name text;
    alter table sm_wfm_certifications add column if not exists issuer text;
    alter table sm_wfm_certifications add column if not exists cert_number text;
    alter table sm_wfm_certifications add column if not exists skill_id uuid;
    alter table sm_wfm_certifications add column if not exists issued_at date;
    alter table sm_wfm_certifications add column if not exists expires_at date;
    alter table sm_wfm_certifications add column if not exists verified boolean not null default false;
    alter table sm_wfm_certifications add column if not exists reminded_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_wfm_certifications (
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
  issuer text,
  cert_number text,
  skill_id uuid,
  issued_at date,
  expires_at date,
  verified boolean not null default false,
  reminded_at timestamptz
);
create index if not exists sm_wfm_certifications_rev_idx on sm_wfm_certifications (org_id, rev);
create index if not exists sm_wfm_certifications_upd_idx on sm_wfm_certifications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_certifications_crt_idx on sm_wfm_certifications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_certifications_user_id_idx on sm_wfm_certifications (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_certifications_workspace_acc_idx on sm_wfm_certifications (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_certifications_unit_acc_idx on sm_wfm_certifications (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_certifications_domain_acc_idx on sm_wfm_certifications (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_certifications_sync on sm_wfm_certifications;
create trigger sm_wfm_certifications_sync before insert or update on sm_wfm_certifications for each row execute function sm_sync_touch('wfm_certification');
create or replace trigger sm_wfm_certifications_demo after insert on sm_wfm_certifications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_certifications_demo_t after update or delete on sm_wfm_certifications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_certifications enable row level security;

-- wfm_config: تنظیمات نیروی کار
do $cols$
begin
  if to_regclass('sm_wfm_config') is not null then
    alter table sm_wfm_config add column if not exists workspace_id uuid;
    alter table sm_wfm_config add column if not exists domain_id uuid;
    alter table sm_wfm_config add column if not exists unit_id uuid;
    alter table sm_wfm_config add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_config add column if not exists created_by uuid;
    alter table sm_wfm_config add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_config add column if not exists updated_by uuid;
    alter table sm_wfm_config add column if not exists rev bigint not null default 0;
    alter table sm_wfm_config add column if not exists version integer not null default 1;
    alter table sm_wfm_config add column if not exists deleted_at timestamptz;
    alter table sm_wfm_config add column if not exists origin text;
    alter table sm_wfm_config add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_config add column if not exists name text;
    alter table sm_wfm_config add column if not exists config_key text;
    alter table sm_wfm_config add column if not exists routing_min_level integer;
    alter table sm_wfm_config add column if not exists routing_needs_verified boolean not null default false;
    alter table sm_wfm_config add column if not exists sync_profile_skills boolean not null default true;
    alter table sm_wfm_config add column if not exists idle_minutes integer;
    alter table sm_wfm_config add column if not exists shift_end_guard_minutes integer;
    alter table sm_wfm_config add column if not exists weekly_hours_max numeric;
    alter table sm_wfm_config add column if not exists min_rest_hours numeric;
    alter table sm_wfm_config add column if not exists points_resolved integer;
    alter table sm_wfm_config add column if not exists points_within_sla integer;
    alter table sm_wfm_config add column if not exists points_first_contact integer;
    alter table sm_wfm_config add column if not exists points_csat integer;
    alter table sm_wfm_config add column if not exists points_knowledge integer;
    alter table sm_wfm_config add column if not exists points_kudos integer;
    alter table sm_wfm_config add column if not exists leaderboard_enabled boolean not null default true;
    alter table sm_wfm_config add column if not exists team_min_size integer;
    alter table sm_wfm_config add column if not exists forecast_days integer;
    alter table sm_wfm_config add column if not exists history_weeks integer;
    alter table sm_wfm_config add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_wfm_config (
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
  routing_min_level integer,
  routing_needs_verified boolean not null default false,
  sync_profile_skills boolean not null default true,
  idle_minutes integer,
  shift_end_guard_minutes integer,
  weekly_hours_max numeric,
  min_rest_hours numeric,
  points_resolved integer,
  points_within_sla integer,
  points_first_contact integer,
  points_csat integer,
  points_knowledge integer,
  points_kudos integer,
  leaderboard_enabled boolean not null default true,
  team_min_size integer,
  forecast_days integer,
  history_weeks integer,
  seeded integer
);
create index if not exists sm_wfm_config_rev_idx on sm_wfm_config (org_id, rev);
create index if not exists sm_wfm_config_upd_idx on sm_wfm_config (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_config_crt_idx on sm_wfm_config (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_wfm_config_config_key_uk on sm_wfm_config (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_wfm_config_sync on sm_wfm_config;
create trigger sm_wfm_config_sync before insert or update on sm_wfm_config for each row execute function sm_sync_touch('wfm_config');
create or replace trigger sm_wfm_config_demo after insert on sm_wfm_config for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_config_demo_t after update or delete on sm_wfm_config for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_config enable row level security;

-- wfm_coverage: نیازهای مهارتی
do $cols$
begin
  if to_regclass('sm_wfm_coverage') is not null then
    alter table sm_wfm_coverage add column if not exists workspace_id uuid;
    alter table sm_wfm_coverage add column if not exists domain_id uuid;
    alter table sm_wfm_coverage add column if not exists unit_id uuid;
    alter table sm_wfm_coverage add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_coverage add column if not exists created_by uuid;
    alter table sm_wfm_coverage add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_coverage add column if not exists updated_by uuid;
    alter table sm_wfm_coverage add column if not exists rev bigint not null default 0;
    alter table sm_wfm_coverage add column if not exists version integer not null default 1;
    alter table sm_wfm_coverage add column if not exists deleted_at timestamptz;
    alter table sm_wfm_coverage add column if not exists origin text;
    alter table sm_wfm_coverage add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_coverage add column if not exists group_id uuid;
    alter table sm_wfm_coverage add column if not exists service_id uuid;
    alter table sm_wfm_coverage add column if not exists skill_id uuid;
    alter table sm_wfm_coverage add column if not exists min_level integer;
    alter table sm_wfm_coverage add column if not exists min_people integer;
    alter table sm_wfm_coverage add column if not exists critical boolean not null default false;
    alter table sm_wfm_coverage add column if not exists note text;
    alter table sm_wfm_coverage add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_wfm_coverage (
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
  service_id uuid,
  skill_id uuid,
  min_level integer,
  min_people integer,
  critical boolean not null default false,
  note text,
  label text
);
create index if not exists sm_wfm_coverage_rev_idx on sm_wfm_coverage (org_id, rev);
create index if not exists sm_wfm_coverage_upd_idx on sm_wfm_coverage (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_coverage_crt_idx on sm_wfm_coverage (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_coverage_group_id_idx on sm_wfm_coverage (org_id, group_id) where deleted_at is null;
create index if not exists sm_wfm_coverage_workspace_acc_idx on sm_wfm_coverage (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_coverage_unit_acc_idx on sm_wfm_coverage (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_coverage_domain_acc_idx on sm_wfm_coverage (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_coverage_sync on sm_wfm_coverage;
create trigger sm_wfm_coverage_sync before insert or update on sm_wfm_coverage for each row execute function sm_sync_touch('wfm_coverage');
create or replace trigger sm_wfm_coverage_demo after insert on sm_wfm_coverage for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_coverage_demo_t after update or delete on sm_wfm_coverage for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_coverage enable row level security;

-- wfm_kudos: قدردانی‌ها
do $cols$
begin
  if to_regclass('sm_wfm_kudos') is not null then
    alter table sm_wfm_kudos add column if not exists workspace_id uuid;
    alter table sm_wfm_kudos add column if not exists domain_id uuid;
    alter table sm_wfm_kudos add column if not exists unit_id uuid;
    alter table sm_wfm_kudos add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_kudos add column if not exists created_by uuid;
    alter table sm_wfm_kudos add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_kudos add column if not exists updated_by uuid;
    alter table sm_wfm_kudos add column if not exists rev bigint not null default 0;
    alter table sm_wfm_kudos add column if not exists version integer not null default 1;
    alter table sm_wfm_kudos add column if not exists deleted_at timestamptz;
    alter table sm_wfm_kudos add column if not exists origin text;
    alter table sm_wfm_kudos add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_kudos add column if not exists from_id uuid;
    alter table sm_wfm_kudos add column if not exists to_id uuid;
    alter table sm_wfm_kudos add column if not exists message text;
    alter table sm_wfm_kudos add column if not exists table_key text;
    alter table sm_wfm_kudos add column if not exists record_id text;
    alter table sm_wfm_kudos add column if not exists record_number text;
  end if;
end
$cols$;
create table if not exists sm_wfm_kudos (
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
  from_id uuid,
  to_id uuid,
  message text,
  table_key text,
  record_id text,
  record_number text
);
create index if not exists sm_wfm_kudos_rev_idx on sm_wfm_kudos (org_id, rev);
create index if not exists sm_wfm_kudos_upd_idx on sm_wfm_kudos (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_kudos_crt_idx on sm_wfm_kudos (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_kudos_to_id_idx on sm_wfm_kudos (org_id, to_id) where deleted_at is null;
create index if not exists sm_wfm_kudos_workspace_acc_idx on sm_wfm_kudos (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_kudos_unit_acc_idx on sm_wfm_kudos (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_kudos_domain_acc_idx on sm_wfm_kudos (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_wfm_kudos_from_id_idx on sm_wfm_kudos (org_id, from_id) where deleted_at is null;
drop trigger if exists sm_wfm_kudos_sync on sm_wfm_kudos;
create trigger sm_wfm_kudos_sync before insert or update on sm_wfm_kudos for each row execute function sm_sync_touch('wfm_kudos');
create or replace trigger sm_wfm_kudos_demo after insert on sm_wfm_kudos for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_kudos_demo_t after update or delete on sm_wfm_kudos for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_kudos enable row level security;

-- wfm_person_skill: مهارت‌های افراد
do $cols$
begin
  if to_regclass('sm_wfm_person_skills') is not null then
    alter table sm_wfm_person_skills add column if not exists workspace_id uuid;
    alter table sm_wfm_person_skills add column if not exists domain_id uuid;
    alter table sm_wfm_person_skills add column if not exists unit_id uuid;
    alter table sm_wfm_person_skills add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_person_skills add column if not exists created_by uuid;
    alter table sm_wfm_person_skills add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_person_skills add column if not exists updated_by uuid;
    alter table sm_wfm_person_skills add column if not exists rev bigint not null default 0;
    alter table sm_wfm_person_skills add column if not exists version integer not null default 1;
    alter table sm_wfm_person_skills add column if not exists deleted_at timestamptz;
    alter table sm_wfm_person_skills add column if not exists origin text;
    alter table sm_wfm_person_skills add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_person_skills add column if not exists user_id uuid;
    alter table sm_wfm_person_skills add column if not exists skill_id uuid;
    alter table sm_wfm_person_skills add column if not exists level integer;
    alter table sm_wfm_person_skills add column if not exists source text;
    alter table sm_wfm_person_skills add column if not exists status text;
    alter table sm_wfm_person_skills add column if not exists expires_at date;
    alter table sm_wfm_person_skills add column if not exists evidence text;
    alter table sm_wfm_person_skills add column if not exists verified boolean not null default false;
    alter table sm_wfm_person_skills add column if not exists verified_by uuid;
    alter table sm_wfm_person_skills add column if not exists verified_at timestamptz;
    alter table sm_wfm_person_skills add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_wfm_person_skills (
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
  skill_id uuid,
  level integer,
  source text,
  status text,
  expires_at date,
  evidence text,
  verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  label text
);
create index if not exists sm_wfm_person_skills_rev_idx on sm_wfm_person_skills (org_id, rev);
create index if not exists sm_wfm_person_skills_upd_idx on sm_wfm_person_skills (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_person_skills_crt_idx on sm_wfm_person_skills (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_person_skills_user_id_idx on sm_wfm_person_skills (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_person_skills_skill_id_idx on sm_wfm_person_skills (org_id, skill_id) where deleted_at is null;
create unique index if not exists sm_wfm_person_skills_user_id_skill_id_uk on sm_wfm_person_skills (org_id, user_id, skill_id) where deleted_at is null;
create index if not exists sm_wfm_person_skills_workspace_acc_idx on sm_wfm_person_skills (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_person_skills_unit_acc_idx on sm_wfm_person_skills (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_person_skills_domain_acc_idx on sm_wfm_person_skills (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_person_skills_sync on sm_wfm_person_skills;
create trigger sm_wfm_person_skills_sync before insert or update on sm_wfm_person_skills for each row execute function sm_sync_touch('wfm_person_skill');
create or replace trigger sm_wfm_person_skills_demo after insert on sm_wfm_person_skills for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_person_skills_demo_t after update or delete on sm_wfm_person_skills for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_person_skills enable row level security;

-- wfm_points: دفتر امتیازها
do $cols$
begin
  if to_regclass('sm_wfm_points') is not null then
    alter table sm_wfm_points add column if not exists workspace_id uuid;
    alter table sm_wfm_points add column if not exists domain_id uuid;
    alter table sm_wfm_points add column if not exists unit_id uuid;
    alter table sm_wfm_points add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_points add column if not exists created_by uuid;
    alter table sm_wfm_points add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_points add column if not exists updated_by uuid;
    alter table sm_wfm_points add column if not exists rev bigint not null default 0;
    alter table sm_wfm_points add column if not exists version integer not null default 1;
    alter table sm_wfm_points add column if not exists deleted_at timestamptz;
    alter table sm_wfm_points add column if not exists origin text;
    alter table sm_wfm_points add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_points add column if not exists user_id uuid;
    alter table sm_wfm_points add column if not exists points integer;
    alter table sm_wfm_points add column if not exists reason text;
    alter table sm_wfm_points add column if not exists table_key text;
    alter table sm_wfm_points add column if not exists record_id text;
    alter table sm_wfm_points add column if not exists record_number text;
    alter table sm_wfm_points add column if not exists period text;
    alter table sm_wfm_points add column if not exists at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_wfm_points (
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
  points integer,
  reason text,
  table_key text,
  record_id text,
  record_number text,
  period text,
  at timestamptz
);
create index if not exists sm_wfm_points_rev_idx on sm_wfm_points (org_id, rev);
create index if not exists sm_wfm_points_upd_idx on sm_wfm_points (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_points_crt_idx on sm_wfm_points (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_points_user_id_idx on sm_wfm_points (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_points_period_idx on sm_wfm_points (org_id, period) where deleted_at is null;
create unique index if not exists sm_wfm_points_user_id_reason_record_id_uk on sm_wfm_points (org_id, user_id, reason, record_id) where deleted_at is null;
create index if not exists sm_wfm_points_workspace_acc_idx on sm_wfm_points (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_points_unit_acc_idx on sm_wfm_points (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_points_domain_acc_idx on sm_wfm_points (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_points_sync on sm_wfm_points;
create trigger sm_wfm_points_sync before insert or update on sm_wfm_points for each row execute function sm_sync_touch('wfm_points');
create or replace trigger sm_wfm_points_demo after insert on sm_wfm_points for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_points_demo_t after update or delete on sm_wfm_points for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_points enable row level security;

-- wfm_presence_log: سابقهٔ حضور
do $cols$
begin
  if to_regclass('sm_wfm_presence_log') is not null then
    alter table sm_wfm_presence_log add column if not exists workspace_id uuid;
    alter table sm_wfm_presence_log add column if not exists domain_id uuid;
    alter table sm_wfm_presence_log add column if not exists unit_id uuid;
    alter table sm_wfm_presence_log add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_presence_log add column if not exists created_by uuid;
    alter table sm_wfm_presence_log add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_presence_log add column if not exists updated_by uuid;
    alter table sm_wfm_presence_log add column if not exists rev bigint not null default 0;
    alter table sm_wfm_presence_log add column if not exists version integer not null default 1;
    alter table sm_wfm_presence_log add column if not exists deleted_at timestamptz;
    alter table sm_wfm_presence_log add column if not exists origin text;
    alter table sm_wfm_presence_log add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_presence_log add column if not exists user_id uuid;
    alter table sm_wfm_presence_log add column if not exists state text;
    alter table sm_wfm_presence_log add column if not exists from_at timestamptz;
    alter table sm_wfm_presence_log add column if not exists to_at timestamptz;
    alter table sm_wfm_presence_log add column if not exists minutes integer;
  end if;
end
$cols$;
create table if not exists sm_wfm_presence_log (
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
  state text,
  from_at timestamptz,
  to_at timestamptz,
  minutes integer
);
create index if not exists sm_wfm_presence_log_rev_idx on sm_wfm_presence_log (org_id, rev);
create index if not exists sm_wfm_presence_log_upd_idx on sm_wfm_presence_log (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_presence_log_crt_idx on sm_wfm_presence_log (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_presence_log_user_id_idx on sm_wfm_presence_log (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_presence_log_workspace_acc_idx on sm_wfm_presence_log (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_presence_log_unit_acc_idx on sm_wfm_presence_log (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_presence_log_domain_acc_idx on sm_wfm_presence_log (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_presence_log_sync on sm_wfm_presence_log;
create or replace trigger sm_wfm_presence_log_demo after insert on sm_wfm_presence_log for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_presence_log_demo_t after update or delete on sm_wfm_presence_log for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_presence_log enable row level security;

-- wfm_roster: برنامه‌های شیفت
do $cols$
begin
  if to_regclass('sm_wfm_rosters') is not null then
    alter table sm_wfm_rosters add column if not exists workspace_id uuid;
    alter table sm_wfm_rosters add column if not exists domain_id uuid;
    alter table sm_wfm_rosters add column if not exists unit_id uuid;
    alter table sm_wfm_rosters add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_rosters add column if not exists created_by uuid;
    alter table sm_wfm_rosters add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_rosters add column if not exists updated_by uuid;
    alter table sm_wfm_rosters add column if not exists rev bigint not null default 0;
    alter table sm_wfm_rosters add column if not exists version integer not null default 1;
    alter table sm_wfm_rosters add column if not exists deleted_at timestamptz;
    alter table sm_wfm_rosters add column if not exists origin text;
    alter table sm_wfm_rosters add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_rosters add column if not exists no integer;
    alter table sm_wfm_rosters add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SCH' || no::text else 'SCH' || lpad(no::text, 5, '0') end) stored;
    alter table sm_wfm_rosters add column if not exists group_id uuid;
    alter table sm_wfm_rosters add column if not exists user_id uuid;
    alter table sm_wfm_rosters add column if not exists pattern_id uuid;
    alter table sm_wfm_rosters add column if not exists role text;
    alter table sm_wfm_rosters add column if not exists valid_from date;
    alter table sm_wfm_rosters add column if not exists valid_to date;
    alter table sm_wfm_rosters add column if not exists note text;
    alter table sm_wfm_rosters add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_wfm_rosters (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SCH' || no::text else 'SCH' || lpad(no::text, 5, '0') end) stored,
  group_id uuid,
  user_id uuid,
  pattern_id uuid,
  role text,
  valid_from date,
  valid_to date,
  note text,
  label text,
  search_9e3cdfc8 text generated always as (translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_wfm_rosters' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9e3cdfc8' loop
    execute format('alter table %I drop column if exists %I', 'sm_wfm_rosters', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_wfm_rosters', 'search_9e3cdfc8', $x$translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_wfm_rosters' and indexname like 'sm\_wfm\_rosters\_search\_%' and indexname not in ('sm_wfm_rosters_search_9e3cdfc8_trgm', 'sm_wfm_rosters_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_wfm_rosters_search_9e3cdfc8_trgm', 'sm_wfm_rosters', 'search_9e3cdfc8', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_wfm_rosters_search_custom_trgm', 'sm_wfm_rosters', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_wfm_rosters_no_uk on sm_wfm_rosters (org_id, no);
create index if not exists sm_wfm_rosters_rev_idx on sm_wfm_rosters (org_id, rev);
create index if not exists sm_wfm_rosters_upd_idx on sm_wfm_rosters (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_rosters_crt_idx on sm_wfm_rosters (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_rosters_group_id_idx on sm_wfm_rosters (org_id, group_id) where deleted_at is null;
create index if not exists sm_wfm_rosters_user_id_idx on sm_wfm_rosters (org_id, user_id) where deleted_at is null;
create index if not exists sm_wfm_rosters_workspace_acc_idx on sm_wfm_rosters (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wfm_rosters_unit_acc_idx on sm_wfm_rosters (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wfm_rosters_domain_acc_idx on sm_wfm_rosters (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wfm_rosters_sync on sm_wfm_rosters;
create trigger sm_wfm_rosters_sync before insert or update on sm_wfm_rosters for each row execute function sm_sync_touch('wfm_roster');
create or replace trigger sm_wfm_rosters_demo after insert on sm_wfm_rosters for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_rosters_demo_t after update or delete on sm_wfm_rosters for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_rosters enable row level security;

-- wfm_shift_pattern: الگوهای شیفت
do $cols$
begin
  if to_regclass('sm_wfm_shift_patterns') is not null then
    alter table sm_wfm_shift_patterns add column if not exists workspace_id uuid;
    alter table sm_wfm_shift_patterns add column if not exists domain_id uuid;
    alter table sm_wfm_shift_patterns add column if not exists unit_id uuid;
    alter table sm_wfm_shift_patterns add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_shift_patterns add column if not exists created_by uuid;
    alter table sm_wfm_shift_patterns add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_shift_patterns add column if not exists updated_by uuid;
    alter table sm_wfm_shift_patterns add column if not exists rev bigint not null default 0;
    alter table sm_wfm_shift_patterns add column if not exists version integer not null default 1;
    alter table sm_wfm_shift_patterns add column if not exists deleted_at timestamptz;
    alter table sm_wfm_shift_patterns add column if not exists origin text;
    alter table sm_wfm_shift_patterns add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_shift_patterns add column if not exists name text;
    alter table sm_wfm_shift_patterns add column if not exists code text;
    alter table sm_wfm_shift_patterns add column if not exists color text;
    alter table sm_wfm_shift_patterns add column if not exists calendar_id uuid;
    alter table sm_wfm_shift_patterns add column if not exists kind text;
    alter table sm_wfm_shift_patterns add column if not exists active boolean not null default true;
    alter table sm_wfm_shift_patterns add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_wfm_shift_patterns (
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
  color text,
  calendar_id uuid,
  kind text,
  active boolean not null default true,
  description text
);
create index if not exists sm_wfm_shift_patterns_rev_idx on sm_wfm_shift_patterns (org_id, rev);
create index if not exists sm_wfm_shift_patterns_upd_idx on sm_wfm_shift_patterns (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_shift_patterns_crt_idx on sm_wfm_shift_patterns (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_wfm_shift_patterns_name_uk on sm_wfm_shift_patterns (org_id, name) where deleted_at is null;
drop trigger if exists sm_wfm_shift_patterns_sync on sm_wfm_shift_patterns;
create trigger sm_wfm_shift_patterns_sync before insert or update on sm_wfm_shift_patterns for each row execute function sm_sync_touch('wfm_shift_pattern');
create or replace trigger sm_wfm_shift_patterns_demo after insert on sm_wfm_shift_patterns for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_shift_patterns_demo_t after update or delete on sm_wfm_shift_patterns for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_shift_patterns enable row level security;

-- wfm_skill: فهرست مهارت‌ها
do $cols$
begin
  if to_regclass('sm_wfm_skills') is not null then
    alter table sm_wfm_skills add column if not exists workspace_id uuid;
    alter table sm_wfm_skills add column if not exists domain_id uuid;
    alter table sm_wfm_skills add column if not exists unit_id uuid;
    alter table sm_wfm_skills add column if not exists created_at timestamptz not null default now();
    alter table sm_wfm_skills add column if not exists created_by uuid;
    alter table sm_wfm_skills add column if not exists updated_at timestamptz not null default now();
    alter table sm_wfm_skills add column if not exists updated_by uuid;
    alter table sm_wfm_skills add column if not exists rev bigint not null default 0;
    alter table sm_wfm_skills add column if not exists version integer not null default 1;
    alter table sm_wfm_skills add column if not exists deleted_at timestamptz;
    alter table sm_wfm_skills add column if not exists origin text;
    alter table sm_wfm_skills add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wfm_skills add column if not exists name text;
    alter table sm_wfm_skills add column if not exists category text;
    alter table sm_wfm_skills add column if not exists active boolean not null default true;
    alter table sm_wfm_skills add column if not exists sfia_code text;
    alter table sm_wfm_skills add column if not exists routing boolean not null default true;
    alter table sm_wfm_skills add column if not exists keywords jsonb;
    alter table sm_wfm_skills add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_wfm_skills (
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
  category text,
  active boolean not null default true,
  sfia_code text,
  routing boolean not null default true,
  keywords jsonb,
  description text
);
create index if not exists sm_wfm_skills_rev_idx on sm_wfm_skills (org_id, rev);
create index if not exists sm_wfm_skills_upd_idx on sm_wfm_skills (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wfm_skills_crt_idx on sm_wfm_skills (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_wfm_skills_name_uk on sm_wfm_skills (org_id, name) where deleted_at is null;
drop trigger if exists sm_wfm_skills_sync on sm_wfm_skills;
create trigger sm_wfm_skills_sync before insert or update on sm_wfm_skills for each row execute function sm_sync_touch('wfm_skill');
create or replace trigger sm_wfm_skills_demo after insert on sm_wfm_skills for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wfm_skills_demo_t after update or delete on sm_wfm_skills for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wfm_skills enable row level security;

-- wo_task: وظیفه‌های دستور کار
do $cols$
begin
  if to_regclass('sm_wo_tasks') is not null then
    alter table sm_wo_tasks add column if not exists workspace_id uuid;
    alter table sm_wo_tasks add column if not exists domain_id uuid;
    alter table sm_wo_tasks add column if not exists unit_id uuid;
    alter table sm_wo_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_wo_tasks add column if not exists created_by uuid;
    alter table sm_wo_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_wo_tasks add column if not exists updated_by uuid;
    alter table sm_wo_tasks add column if not exists rev bigint not null default 0;
    alter table sm_wo_tasks add column if not exists version integer not null default 1;
    alter table sm_wo_tasks add column if not exists deleted_at timestamptz;
    alter table sm_wo_tasks add column if not exists origin text;
    alter table sm_wo_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wo_tasks add column if not exists no integer;
    alter table sm_wo_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'WOT' || no::text else 'WOT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_wo_tasks add column if not exists short_description text;
    alter table sm_wo_tasks add column if not exists work_order_id uuid;
    alter table sm_wo_tasks add column if not exists technician_id uuid;
    alter table sm_wo_tasks add column if not exists assignment_group_id uuid;
    alter table sm_wo_tasks add column if not exists priority text;
    alter table sm_wo_tasks add column if not exists template_id uuid;
    alter table sm_wo_tasks add column if not exists required_skills jsonb;
    alter table sm_wo_tasks add column if not exists est_work_minutes integer;
    alter table sm_wo_tasks add column if not exists est_travel_minutes integer;
    alter table sm_wo_tasks add column if not exists window_start timestamptz;
    alter table sm_wo_tasks add column if not exists window_end timestamptz;
    alter table sm_wo_tasks add column if not exists scheduled_start timestamptz;
    alter table sm_wo_tasks add column if not exists scheduled_end timestamptz;
    alter table sm_wo_tasks add column if not exists instructions text;
    alter table sm_wo_tasks add column if not exists location_id uuid;
    alter table sm_wo_tasks add column if not exists territory_id uuid;
    alter table sm_wo_tasks add column if not exists account_id uuid;
    alter table sm_wo_tasks add column if not exists site_lat numeric;
    alter table sm_wo_tasks add column if not exists site_lng numeric;
    alter table sm_wo_tasks add column if not exists dispatched_at timestamptz;
    alter table sm_wo_tasks add column if not exists accepted_at timestamptz;
    alter table sm_wo_tasks add column if not exists en_route_at timestamptz;
    alter table sm_wo_tasks add column if not exists arrived_at timestamptz;
    alter table sm_wo_tasks add column if not exists completed_at timestamptz;
    alter table sm_wo_tasks add column if not exists eta_at timestamptz;
    alter table sm_wo_tasks add column if not exists travel_minutes integer;
    alter table sm_wo_tasks add column if not exists work_minutes integer;
    alter table sm_wo_tasks add column if not exists break_minutes integer;
    alter table sm_wo_tasks add column if not exists visit_no integer;
    alter table sm_wo_tasks add column if not exists sla_due timestamptz;
    alter table sm_wo_tasks add column if not exists hold_reason text;
    alter table sm_wo_tasks add column if not exists revisit_reason text;
    alter table sm_wo_tasks add column if not exists checklist jsonb;
    alter table sm_wo_tasks add column if not exists checklist_answers jsonb;
    alter table sm_wo_tasks add column if not exists checklist_done boolean not null default false;
    alter table sm_wo_tasks add column if not exists resolution text;
    alter table sm_wo_tasks add column if not exists signer_name text;
    alter table sm_wo_tasks add column if not exists signed_at timestamptz;
    alter table sm_wo_tasks add column if not exists signature_id text;
    alter table sm_wo_tasks add column if not exists service_report text;
    alter table sm_wo_tasks add column if not exists check_in_lat numeric;
    alter table sm_wo_tasks add column if not exists check_in_lng numeric;
    alter table sm_wo_tasks add column if not exists check_out_lat numeric;
    alter table sm_wo_tasks add column if not exists check_out_lng numeric;
    alter table sm_wo_tasks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_wo_tasks (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'WOT' || no::text else 'WOT' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  work_order_id uuid,
  technician_id uuid,
  assignment_group_id uuid,
  priority text,
  template_id uuid,
  required_skills jsonb,
  est_work_minutes integer,
  est_travel_minutes integer,
  window_start timestamptz,
  window_end timestamptz,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  instructions text,
  location_id uuid,
  territory_id uuid,
  account_id uuid,
  site_lat numeric,
  site_lng numeric,
  dispatched_at timestamptz,
  accepted_at timestamptz,
  en_route_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  eta_at timestamptz,
  travel_minutes integer,
  work_minutes integer,
  break_minutes integer,
  visit_no integer,
  sla_due timestamptz,
  hold_reason text,
  revisit_reason text,
  checklist jsonb,
  checklist_answers jsonb,
  checklist_done boolean not null default false,
  resolution text,
  signer_name text,
  signed_at timestamptz,
  signature_id text,
  service_report text,
  check_in_lat numeric,
  check_in_lng numeric,
  check_out_lat numeric,
  check_out_lng numeric,
  state text,
  search_9c3826f0 text generated always as (translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_wo_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9c3826f0' loop
    execute format('alter table %I drop column if exists %I', 'sm_wo_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_wo_tasks', 'search_9c3826f0', $x$translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_wo_tasks' and indexname like 'sm\_wo\_tasks\_search\_%' and indexname not in ('sm_wo_tasks_search_9c3826f0_trgm', 'sm_wo_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_wo_tasks_search_9c3826f0_trgm', 'sm_wo_tasks', 'search_9c3826f0', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_wo_tasks_search_custom_trgm', 'sm_wo_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_wo_tasks_no_uk on sm_wo_tasks (org_id, no);
create index if not exists sm_wo_tasks_rev_idx on sm_wo_tasks (org_id, rev);
create index if not exists sm_wo_tasks_upd_idx on sm_wo_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wo_tasks_crt_idx on sm_wo_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_wo_tasks_work_order_id_idx on sm_wo_tasks (org_id, work_order_id) where deleted_at is null;
create index if not exists sm_wo_tasks_technician_id_idx on sm_wo_tasks (org_id, technician_id) where deleted_at is null;
create index if not exists sm_wo_tasks_assignment_group_id_idx on sm_wo_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_wo_tasks_territory_id_idx on sm_wo_tasks (org_id, territory_id) where deleted_at is null;
create index if not exists sm_wo_tasks_state_idx on sm_wo_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_wo_tasks_workspace_acc_idx on sm_wo_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_wo_tasks_unit_acc_idx on sm_wo_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_wo_tasks_domain_acc_idx on sm_wo_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_wo_tasks_sync on sm_wo_tasks;
create trigger sm_wo_tasks_sync before insert or update on sm_wo_tasks for each row execute function sm_sync_touch('wo_task');
create or replace trigger sm_wo_tasks_demo after insert on sm_wo_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wo_tasks_demo_t after update or delete on sm_wo_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wo_tasks enable row level security;

-- wo_task_template: الگوهای وظیفهٔ میدانی
do $cols$
begin
  if to_regclass('sm_wo_task_templates') is not null then
    alter table sm_wo_task_templates add column if not exists workspace_id uuid;
    alter table sm_wo_task_templates add column if not exists domain_id uuid;
    alter table sm_wo_task_templates add column if not exists unit_id uuid;
    alter table sm_wo_task_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_wo_task_templates add column if not exists created_by uuid;
    alter table sm_wo_task_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_wo_task_templates add column if not exists updated_by uuid;
    alter table sm_wo_task_templates add column if not exists rev bigint not null default 0;
    alter table sm_wo_task_templates add column if not exists version integer not null default 1;
    alter table sm_wo_task_templates add column if not exists deleted_at timestamptz;
    alter table sm_wo_task_templates add column if not exists origin text;
    alter table sm_wo_task_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_wo_task_templates add column if not exists name text;
    alter table sm_wo_task_templates add column if not exists work_type text;
    alter table sm_wo_task_templates add column if not exists active boolean not null default true;
    alter table sm_wo_task_templates add column if not exists required_skills jsonb;
    alter table sm_wo_task_templates add column if not exists est_work_minutes integer;
    alter table sm_wo_task_templates add column if not exists checklist jsonb;
    alter table sm_wo_task_templates add column if not exists parts jsonb;
    alter table sm_wo_task_templates add column if not exists instructions text;
    alter table sm_wo_task_templates add column if not exists safety text;
  end if;
end
$cols$;
create table if not exists sm_wo_task_templates (
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
  work_type text,
  active boolean not null default true,
  required_skills jsonb,
  est_work_minutes integer,
  checklist jsonb,
  parts jsonb,
  instructions text,
  safety text
);
create index if not exists sm_wo_task_templates_rev_idx on sm_wo_task_templates (org_id, rev);
create index if not exists sm_wo_task_templates_upd_idx on sm_wo_task_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_wo_task_templates_crt_idx on sm_wo_task_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_wo_task_templates_sync on sm_wo_task_templates;
create trigger sm_wo_task_templates_sync before insert or update on sm_wo_task_templates for each row execute function sm_sync_touch('wo_task_template');
create or replace trigger sm_wo_task_templates_demo after insert on sm_wo_task_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_wo_task_templates_demo_t after update or delete on sm_wo_task_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_wo_task_templates enable row level security;

-- work_order: دستورهای کار
do $cols$
begin
  if to_regclass('sm_work_orders') is not null then
    alter table sm_work_orders add column if not exists workspace_id uuid;
    alter table sm_work_orders add column if not exists domain_id uuid;
    alter table sm_work_orders add column if not exists unit_id uuid;
    alter table sm_work_orders add column if not exists created_at timestamptz not null default now();
    alter table sm_work_orders add column if not exists created_by uuid;
    alter table sm_work_orders add column if not exists updated_at timestamptz not null default now();
    alter table sm_work_orders add column if not exists updated_by uuid;
    alter table sm_work_orders add column if not exists rev bigint not null default 0;
    alter table sm_work_orders add column if not exists version integer not null default 1;
    alter table sm_work_orders add column if not exists deleted_at timestamptz;
    alter table sm_work_orders add column if not exists origin text;
    alter table sm_work_orders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_work_orders add column if not exists no integer;
    alter table sm_work_orders add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'WO' || no::text else 'WO' || lpad(no::text, 7, '0') end) stored;
    alter table sm_work_orders add column if not exists short_description text;
    alter table sm_work_orders add column if not exists description text;
    alter table sm_work_orders add column if not exists state text;
    alter table sm_work_orders add column if not exists priority text;
    alter table sm_work_orders add column if not exists impact text;
    alter table sm_work_orders add column if not exists urgency text;
    alter table sm_work_orders add column if not exists category text;
    alter table sm_work_orders add column if not exists subcategory text;
    alter table sm_work_orders add column if not exists channel text;
    alter table sm_work_orders add column if not exists caller_id uuid;
    alter table sm_work_orders add column if not exists requested_for uuid;
    alter table sm_work_orders add column if not exists opened_by uuid;
    alter table sm_work_orders add column if not exists opened_at timestamptz;
    alter table sm_work_orders add column if not exists assignment_group_id uuid;
    alter table sm_work_orders add column if not exists assigned_to uuid;
    alter table sm_work_orders add column if not exists service_id uuid;
    alter table sm_work_orders add column if not exists offering_id uuid;
    alter table sm_work_orders add column if not exists ci_id uuid;
    alter table sm_work_orders add column if not exists location_id uuid;
    alter table sm_work_orders add column if not exists due_at timestamptz;
    alter table sm_work_orders add column if not exists resolved_at timestamptz;
    alter table sm_work_orders add column if not exists resolved_by uuid;
    alter table sm_work_orders add column if not exists closed_at timestamptz;
    alter table sm_work_orders add column if not exists closed_by uuid;
    alter table sm_work_orders add column if not exists close_code text;
    alter table sm_work_orders add column if not exists close_notes text;
    alter table sm_work_orders add column if not exists parent_id uuid;
    alter table sm_work_orders add column if not exists watch_list jsonb;
    alter table sm_work_orders add column if not exists approval text;
    alter table sm_work_orders add column if not exists escalation integer;
    alter table sm_work_orders add column if not exists reassignment_count integer;
    alter table sm_work_orders add column if not exists reopen_count integer;
    alter table sm_work_orders add column if not exists time_worked bigint;
    alter table sm_work_orders add column if not exists first_response_at timestamptz;
    alter table sm_work_orders add column if not exists active boolean not null default true;
    alter table sm_work_orders add column if not exists sla_due timestamptz;
    alter table sm_work_orders add column if not exists knowledge boolean not null default false;
    alter table sm_work_orders add column if not exists work_type text;
    alter table sm_work_orders add column if not exists symptoms text;
    alter table sm_work_orders add column if not exists required_skills jsonb;
    alter table sm_work_orders add column if not exists template_id uuid;
    alter table sm_work_orders add column if not exists parent_table text;
    alter table sm_work_orders add column if not exists parent_record text;
    alter table sm_work_orders add column if not exists parent_number text;
    alter table sm_work_orders add column if not exists maintenance_plan_id uuid;
    alter table sm_work_orders add column if not exists territory_id uuid;
    alter table sm_work_orders add column if not exists account_id uuid;
    alter table sm_work_orders add column if not exists contact_id uuid;
    alter table sm_work_orders add column if not exists site_phone text;
    alter table sm_work_orders add column if not exists site_address text;
    alter table sm_work_orders add column if not exists site_lat numeric;
    alter table sm_work_orders add column if not exists site_lng numeric;
    alter table sm_work_orders add column if not exists access_notes text;
    alter table sm_work_orders add column if not exists asset_ref text;
    alter table sm_work_orders add column if not exists billing_type text;
    alter table sm_work_orders add column if not exists coverage text;
    alter table sm_work_orders add column if not exists entitlement_id uuid;
    alter table sm_work_orders add column if not exists tasks_total integer;
    alter table sm_work_orders add column if not exists tasks_open integer;
    alter table sm_work_orders add column if not exists visits integer;
    alter table sm_work_orders add column if not exists first_time_fix boolean not null default false;
    alter table sm_work_orders add column if not exists scheduled_start timestamptz;
    alter table sm_work_orders add column if not exists work_minutes integer;
    alter table sm_work_orders add column if not exists travel_minutes integer;
    alter table sm_work_orders add column if not exists technicians jsonb;
  end if;
end
$cols$;
create table if not exists sm_work_orders (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'WO' || no::text else 'WO' || lpad(no::text, 7, '0') end) stored,
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
  work_type text,
  symptoms text,
  required_skills jsonb,
  template_id uuid,
  parent_table text,
  parent_record text,
  parent_number text,
  maintenance_plan_id uuid,
  territory_id uuid,
  account_id uuid,
  contact_id uuid,
  site_phone text,
  site_address text,
  site_lat numeric,
  site_lng numeric,
  access_notes text,
  asset_ref text,
  billing_type text,
  coverage text,
  entitlement_id uuid,
  tasks_total integer,
  tasks_open integer,
  visits integer,
  first_time_fix boolean not null default false,
  scheduled_start timestamptz,
  work_minutes integer,
  travel_minutes integer,
  technicians jsonb,
  search_8fe328e6 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(parent_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_work_orders' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_8fe328e6' loop
    execute format('alter table %I drop column if exists %I', 'sm_work_orders', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_work_orders', 'search_8fe328e6', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(parent_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_work_orders' and indexname like 'sm\_work\_orders\_search\_%' and indexname not in ('sm_work_orders_search_8fe328e6_trgm', 'sm_work_orders_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_work_orders_search_8fe328e6_trgm', 'sm_work_orders', 'search_8fe328e6', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_work_orders_search_custom_trgm', 'sm_work_orders', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_work_orders_no_uk on sm_work_orders (org_id, no);
create index if not exists sm_work_orders_rev_idx on sm_work_orders (org_id, rev);
create index if not exists sm_work_orders_upd_idx on sm_work_orders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_work_orders_crt_idx on sm_work_orders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_work_orders_state_idx on sm_work_orders (org_id, state) where deleted_at is null;
create index if not exists sm_work_orders_assignment_group_id_idx on sm_work_orders (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_work_orders_assigned_to_idx on sm_work_orders (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_work_orders_territory_id_idx on sm_work_orders (org_id, territory_id) where deleted_at is null;
create index if not exists sm_work_orders_account_id_idx on sm_work_orders (org_id, account_id) where deleted_at is null;
create index if not exists sm_work_orders_workspace_acc_idx on sm_work_orders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_work_orders_unit_acc_idx on sm_work_orders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_work_orders_domain_acc_idx on sm_work_orders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_work_orders_caller_id_idx on sm_work_orders (org_id, caller_id) where deleted_at is null;
create index if not exists sm_work_orders_requested_for_idx on sm_work_orders (org_id, requested_for) where deleted_at is null;
create index if not exists sm_work_orders_opened_by_idx on sm_work_orders (org_id, opened_by) where deleted_at is null;
create index if not exists sm_work_orders_technicians_gin on sm_work_orders using gin (technicians);
create index if not exists sm_work_orders_watch_list_gin on sm_work_orders using gin (watch_list);
create index if not exists sm_work_orders_open_grp_idx on sm_work_orders (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_work_orders_opened_brin on sm_work_orders using brin (opened_at);
drop trigger if exists sm_work_orders_sync on sm_work_orders;
create trigger sm_work_orders_sync before insert or update on sm_work_orders for each row execute function sm_sync_touch('work_order');
create or replace trigger sm_work_orders_demo after insert on sm_work_orders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_work_orders_demo_t after update or delete on sm_work_orders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_work_orders enable row level security;

-- workspace: فضاهای کاری
do $cols$
begin
  if to_regclass('sm_workspaces') is not null then
    alter table sm_workspaces add column if not exists workspace_id uuid;
    alter table sm_workspaces add column if not exists domain_id uuid;
    alter table sm_workspaces add column if not exists unit_id uuid;
    alter table sm_workspaces add column if not exists created_at timestamptz not null default now();
    alter table sm_workspaces add column if not exists created_by uuid;
    alter table sm_workspaces add column if not exists updated_at timestamptz not null default now();
    alter table sm_workspaces add column if not exists updated_by uuid;
    alter table sm_workspaces add column if not exists rev bigint not null default 0;
    alter table sm_workspaces add column if not exists version integer not null default 1;
    alter table sm_workspaces add column if not exists deleted_at timestamptz;
    alter table sm_workspaces add column if not exists origin text;
    alter table sm_workspaces add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_workspaces add column if not exists key text;
    alter table sm_workspaces add column if not exists name text;
    alter table sm_workspaces add column if not exists icon text;
    alter table sm_workspaces add column if not exists color text;
    alter table sm_workspaces add column if not exists is_default boolean not null default false;
    alter table sm_workspaces add column if not exists secure boolean not null default false;
    alter table sm_workspaces add column if not exists active boolean not null default true;
    alter table sm_workspaces add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_workspaces (
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
  key text,
  name text,
  icon text,
  color text,
  is_default boolean not null default false,
  secure boolean not null default false,
  active boolean not null default true,
  description text
);
create index if not exists sm_workspaces_rev_idx on sm_workspaces (org_id, rev);
create index if not exists sm_workspaces_upd_idx on sm_workspaces (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_workspaces_crt_idx on sm_workspaces (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_workspaces_key_uk on sm_workspaces (org_id, key) where deleted_at is null;
drop trigger if exists sm_workspaces_sync on sm_workspaces;
create trigger sm_workspaces_sync before insert or update on sm_workspaces for each row execute function sm_sync_touch('workspace');
create or replace trigger sm_workspaces_demo after insert on sm_workspaces for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_workspaces_demo_t after update or delete on sm_workspaces for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_workspaces enable row level security;

-- alert: archive
create table if not exists sm_alerts_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_alerts_arc add column if not exists workspace_id uuid;
alter table sm_alerts_arc add column if not exists domain_id uuid;
alter table sm_alerts_arc add column if not exists unit_id uuid;
alter table sm_alerts_arc add column if not exists created_at timestamptz not null default now();
alter table sm_alerts_arc add column if not exists created_by uuid;
alter table sm_alerts_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_alerts_arc add column if not exists updated_by uuid;
alter table sm_alerts_arc add column if not exists rev bigint not null default 0;
alter table sm_alerts_arc add column if not exists version integer not null default 1;
alter table sm_alerts_arc add column if not exists deleted_at timestamptz;
alter table sm_alerts_arc add column if not exists origin text;
alter table sm_alerts_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_alerts_arc add column if not exists no integer;
alter table sm_alerts_arc add column if not exists number text;
alter table sm_alerts_arc add column if not exists short_description text;
alter table sm_alerts_arc add column if not exists description text;
alter table sm_alerts_arc add column if not exists severity text;
alter table sm_alerts_arc add column if not exists priority text;
alter table sm_alerts_arc add column if not exists impact text;
alter table sm_alerts_arc add column if not exists source_id uuid;
alter table sm_alerts_arc add column if not exists node text;
alter table sm_alerts_arc add column if not exists resource text;
alter table sm_alerts_arc add column if not exists metric text;
alter table sm_alerts_arc add column if not exists tags jsonb;
alter table sm_alerts_arc add column if not exists ci_id uuid;
alter table sm_alerts_arc add column if not exists service_id uuid;
alter table sm_alerts_arc add column if not exists affected_services jsonb;
alter table sm_alerts_arc add column if not exists assignment_group_id uuid;
alter table sm_alerts_arc add column if not exists assigned_to uuid;
alter table sm_alerts_arc add column if not exists responders jsonb;
alter table sm_alerts_arc add column if not exists event_count integer;
alter table sm_alerts_arc add column if not exists first_seen_at timestamptz;
alter table sm_alerts_arc add column if not exists last_seen_at timestamptz;
alter table sm_alerts_arc add column if not exists opened_at timestamptz;
alter table sm_alerts_arc add column if not exists acknowledged_at timestamptz;
alter table sm_alerts_arc add column if not exists acknowledged_by uuid;
alter table sm_alerts_arc add column if not exists resolved_at timestamptz;
alter table sm_alerts_arc add column if not exists resolved_by uuid;
alter table sm_alerts_arc add column if not exists closed_at timestamptz;
alter table sm_alerts_arc add column if not exists closed_by uuid;
alter table sm_alerts_arc add column if not exists snoozed_until timestamptz;
alter table sm_alerts_arc add column if not exists reopen_count integer;
alter table sm_alerts_arc add column if not exists fingerprint text;
alter table sm_alerts_arc add column if not exists severity_history jsonb;
alter table sm_alerts_arc add column if not exists flips jsonb;
alter table sm_alerts_arc add column if not exists flap_count integer;
alter table sm_alerts_arc add column if not exists last_value numeric;
alter table sm_alerts_arc add column if not exists close_code text;
alter table sm_alerts_arc add column if not exists close_notes text;
alter table sm_alerts_arc add column if not exists active boolean not null default true;
alter table sm_alerts_arc add column if not exists sla_due timestamptz;
alter table sm_alerts_arc add column if not exists group_id uuid;
alter table sm_alerts_arc add column if not exists symptom boolean not null default false;
alter table sm_alerts_arc add column if not exists incident_id uuid;
alter table sm_alerts_arc add column if not exists incident_auto_resolve boolean not null default false;
alter table sm_alerts_arc add column if not exists change_id uuid;
alter table sm_alerts_arc add column if not exists maintenance_window_id uuid;
alter table sm_alerts_arc add column if not exists last_event_id uuid;
alter table sm_alerts_arc add column if not exists escalation_policy_id uuid;
alter table sm_alerts_arc add column if not exists escalation_state text;
alter table sm_alerts_arc add column if not exists escalation_level integer;
alter table sm_alerts_arc add column if not exists escalation_round integer;
alter table sm_alerts_arc add column if not exists next_escalation_at timestamptz;
alter table sm_alerts_arc add column if not exists pages_sent integer;
alter table sm_alerts_arc add column if not exists noise_label text;
alter table sm_alerts_arc add column if not exists noise_reason text;
alter table sm_alerts_arc add column if not exists watch_list jsonb;
alter table sm_alerts_arc add column if not exists state text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_alerts_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_3e573310' loop
    execute format('alter table %I drop column if exists %I', 'sm_alerts_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_alerts_arc' and column_name = 'search_3e573310') then
    execute format('alter table %I add column %I text', 'sm_alerts_arc', 'search_3e573310');
    execute format('update %I set %I = (%s)', 'sm_alerts_arc', 'search_3e573310', $x$translate(coalesce(short_description, '') || ' ' || coalesce(node, '') || ' ' || coalesce(resource, '') || ' ' || coalesce(metric, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_alerts_arc_no_idx on sm_alerts_arc (org_id, no);
create index if not exists sm_alerts_arc_arch_idx on sm_alerts_arc (org_id, archived_at);
create index if not exists sm_alerts_arc_upd_idx on sm_alerts_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_alerts_arc_assigned_to_idx on sm_alerts_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_alerts_arc_assignment_group_id_idx on sm_alerts_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_alerts_arc_unit_id_idx on sm_alerts_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_alerts_arc_search_3e573310_trgm', 'sm_alerts_arc', 'search_3e573310', s); end if;
end
$arc$;
alter table sm_alerts_arc enable row level security;

-- alert_group: archive
create table if not exists sm_alert_groups_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_alert_groups_arc add column if not exists workspace_id uuid;
alter table sm_alert_groups_arc add column if not exists domain_id uuid;
alter table sm_alert_groups_arc add column if not exists unit_id uuid;
alter table sm_alert_groups_arc add column if not exists created_at timestamptz not null default now();
alter table sm_alert_groups_arc add column if not exists created_by uuid;
alter table sm_alert_groups_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_alert_groups_arc add column if not exists updated_by uuid;
alter table sm_alert_groups_arc add column if not exists rev bigint not null default 0;
alter table sm_alert_groups_arc add column if not exists version integer not null default 1;
alter table sm_alert_groups_arc add column if not exists deleted_at timestamptz;
alter table sm_alert_groups_arc add column if not exists origin text;
alter table sm_alert_groups_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_alert_groups_arc add column if not exists no integer;
alter table sm_alert_groups_arc add column if not exists number text;
alter table sm_alert_groups_arc add column if not exists title text;
alter table sm_alert_groups_arc add column if not exists severity text;
alter table sm_alert_groups_arc add column if not exists priority text;
alter table sm_alert_groups_arc add column if not exists reason text;
alter table sm_alert_groups_arc add column if not exists rule_id uuid;
alter table sm_alert_groups_arc add column if not exists corr_key text;
alter table sm_alert_groups_arc add column if not exists ci_id uuid;
alter table sm_alert_groups_arc add column if not exists service_id uuid;
alter table sm_alert_groups_arc add column if not exists affected_services jsonb;
alter table sm_alert_groups_arc add column if not exists assignment_group_id uuid;
alter table sm_alert_groups_arc add column if not exists assigned_to uuid;
alter table sm_alert_groups_arc add column if not exists alert_count integer;
alter table sm_alert_groups_arc add column if not exists open_count integer;
alter table sm_alert_groups_arc add column if not exists first_seen_at timestamptz;
alter table sm_alert_groups_arc add column if not exists last_seen_at timestamptz;
alter table sm_alert_groups_arc add column if not exists incident_id uuid;
alter table sm_alert_groups_arc add column if not exists summary text;
alter table sm_alert_groups_arc add column if not exists probable_causes jsonb;
alter table sm_alert_groups_arc add column if not exists active boolean not null default true;
alter table sm_alert_groups_arc add column if not exists opened_at timestamptz;
alter table sm_alert_groups_arc add column if not exists resolved_at timestamptz;
alter table sm_alert_groups_arc add column if not exists closed_at timestamptz;
alter table sm_alert_groups_arc add column if not exists watch_list jsonb;
alter table sm_alert_groups_arc add column if not exists state text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_alert_groups_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_alert_groups_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_alert_groups_arc' and column_name = 'search_cae18f1d') then
    execute format('alter table %I add column %I text', 'sm_alert_groups_arc', 'search_cae18f1d');
    execute format('update %I set %I = (%s)', 'sm_alert_groups_arc', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_alert_groups_arc_no_idx on sm_alert_groups_arc (org_id, no);
create index if not exists sm_alert_groups_arc_arch_idx on sm_alert_groups_arc (org_id, archived_at);
create index if not exists sm_alert_groups_arc_upd_idx on sm_alert_groups_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_alert_groups_arc_assigned_to_idx on sm_alert_groups_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_alert_groups_arc_assignment_group_id_idx on sm_alert_groups_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_alert_groups_arc_unit_id_idx on sm_alert_groups_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_alert_groups_arc_search_cae18f1d_trgm', 'sm_alert_groups_arc', 'search_cae18f1d', s); end if;
end
$arc$;
alter table sm_alert_groups_arc enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:26', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۲ از ۸ (0006_engine_tables:4/30 … 0006_engine_tables:7/30)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۴ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 4/30 (a0c3bc7de847)
-- cab_agenda_item: موردهای دستور جلسه
do $cols$
begin
  if to_regclass('sm_cab_agenda_items') is not null then
    alter table sm_cab_agenda_items add column if not exists workspace_id uuid;
    alter table sm_cab_agenda_items add column if not exists domain_id uuid;
    alter table sm_cab_agenda_items add column if not exists unit_id uuid;
    alter table sm_cab_agenda_items add column if not exists created_at timestamptz not null default now();
    alter table sm_cab_agenda_items add column if not exists created_by uuid;
    alter table sm_cab_agenda_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_cab_agenda_items add column if not exists updated_by uuid;
    alter table sm_cab_agenda_items add column if not exists rev bigint not null default 0;
    alter table sm_cab_agenda_items add column if not exists version integer not null default 1;
    alter table sm_cab_agenda_items add column if not exists deleted_at timestamptz;
    alter table sm_cab_agenda_items add column if not exists origin text;
    alter table sm_cab_agenda_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cab_agenda_items add column if not exists title text;
    alter table sm_cab_agenda_items add column if not exists meeting_id uuid;
    alter table sm_cab_agenda_items add column if not exists change_id uuid;
    alter table sm_cab_agenda_items add column if not exists kind text;
    alter table sm_cab_agenda_items add column if not exists sort_order integer;
    alter table sm_cab_agenda_items add column if not exists presenter_id uuid;
    alter table sm_cab_agenda_items add column if not exists decision text;
    alter table sm_cab_agenda_items add column if not exists decided_by uuid;
    alter table sm_cab_agenda_items add column if not exists decided_at timestamptz;
    alter table sm_cab_agenda_items add column if not exists decision_notes text;
    alter table sm_cab_agenda_items add column if not exists votes jsonb;
  end if;
end
$cols$;
create table if not exists sm_cab_agenda_items (
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
  meeting_id uuid,
  change_id uuid,
  kind text,
  sort_order integer,
  presenter_id uuid,
  decision text,
  decided_by uuid,
  decided_at timestamptz,
  decision_notes text,
  votes jsonb
);
create index if not exists sm_cab_agenda_items_rev_idx on sm_cab_agenda_items (org_id, rev);
create index if not exists sm_cab_agenda_items_upd_idx on sm_cab_agenda_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_agenda_items_crt_idx on sm_cab_agenda_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_agenda_items_meeting_id_idx on sm_cab_agenda_items (org_id, meeting_id) where deleted_at is null;
create index if not exists sm_cab_agenda_items_change_id_idx on sm_cab_agenda_items (org_id, change_id) where deleted_at is null;
create unique index if not exists sm_cab_agenda_items_meeting_id_change_id_kind_uk on sm_cab_agenda_items (org_id, meeting_id, change_id, kind) where deleted_at is null;
drop trigger if exists sm_cab_agenda_items_sync on sm_cab_agenda_items;
create trigger sm_cab_agenda_items_sync before insert or update on sm_cab_agenda_items for each row execute function sm_sync_touch('cab_agenda_item');
create or replace trigger sm_cab_agenda_items_demo after insert on sm_cab_agenda_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cab_agenda_items_demo_t after update or delete on sm_cab_agenda_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cab_agenda_items enable row level security;

-- cab_meeting: جلسه‌های CAB
do $cols$
begin
  if to_regclass('sm_cab_meetings') is not null then
    alter table sm_cab_meetings add column if not exists workspace_id uuid;
    alter table sm_cab_meetings add column if not exists domain_id uuid;
    alter table sm_cab_meetings add column if not exists unit_id uuid;
    alter table sm_cab_meetings add column if not exists created_at timestamptz not null default now();
    alter table sm_cab_meetings add column if not exists created_by uuid;
    alter table sm_cab_meetings add column if not exists updated_at timestamptz not null default now();
    alter table sm_cab_meetings add column if not exists updated_by uuid;
    alter table sm_cab_meetings add column if not exists rev bigint not null default 0;
    alter table sm_cab_meetings add column if not exists version integer not null default 1;
    alter table sm_cab_meetings add column if not exists deleted_at timestamptz;
    alter table sm_cab_meetings add column if not exists origin text;
    alter table sm_cab_meetings add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cab_meetings add column if not exists no integer;
    alter table sm_cab_meetings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CABM' || no::text else 'CABM' || lpad(no::text, 5, '0') end) stored;
    alter table sm_cab_meetings add column if not exists title text;
    alter table sm_cab_meetings add column if not exists cab_id uuid;
    alter table sm_cab_meetings add column if not exists starts_at timestamptz;
    alter table sm_cab_meetings add column if not exists ends_at timestamptz;
    alter table sm_cab_meetings add column if not exists chair_id uuid;
    alter table sm_cab_meetings add column if not exists attendees jsonb;
    alter table sm_cab_meetings add column if not exists present jsonb;
    alter table sm_cab_meetings add column if not exists location text;
    alter table sm_cab_meetings add column if not exists conference_url text;
    alter table sm_cab_meetings add column if not exists notes text;
    alter table sm_cab_meetings add column if not exists minutes text;
    alter table sm_cab_meetings add column if not exists action_items text;
    alter table sm_cab_meetings add column if not exists minutes_sent_at timestamptz;
    alter table sm_cab_meetings add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_cab_meetings (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CABM' || no::text else 'CABM' || lpad(no::text, 5, '0') end) stored,
  title text,
  cab_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  chair_id uuid,
  attendees jsonb,
  present jsonb,
  location text,
  conference_url text,
  notes text,
  minutes text,
  action_items text,
  minutes_sent_at timestamptz,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cab_meetings' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_cab_meetings', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cab_meetings', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_cab_meetings' and indexname like 'sm\_cab\_meetings\_search\_%' and indexname not in ('sm_cab_meetings_search_cae18f1d_trgm', 'sm_cab_meetings_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cab_meetings_search_cae18f1d_trgm', 'sm_cab_meetings', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cab_meetings_search_custom_trgm', 'sm_cab_meetings', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_cab_meetings_no_uk on sm_cab_meetings (org_id, no);
create index if not exists sm_cab_meetings_rev_idx on sm_cab_meetings (org_id, rev);
create index if not exists sm_cab_meetings_upd_idx on sm_cab_meetings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_meetings_crt_idx on sm_cab_meetings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_meetings_cab_id_idx on sm_cab_meetings (org_id, cab_id) where deleted_at is null;
create index if not exists sm_cab_meetings_starts_at_idx on sm_cab_meetings (org_id, starts_at) where deleted_at is null;
create index if not exists sm_cab_meetings_state_idx on sm_cab_meetings (org_id, state) where deleted_at is null;
create index if not exists sm_cab_meetings_workspace_acc_idx on sm_cab_meetings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cab_meetings_unit_acc_idx on sm_cab_meetings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cab_meetings_domain_acc_idx on sm_cab_meetings (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cab_meetings_chair_id_idx on sm_cab_meetings (org_id, chair_id) where deleted_at is null;
drop trigger if exists sm_cab_meetings_sync on sm_cab_meetings;
create trigger sm_cab_meetings_sync before insert or update on sm_cab_meetings for each row execute function sm_sync_touch('cab_meeting');
create or replace trigger sm_cab_meetings_demo after insert on sm_cab_meetings for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cab_meetings_demo_t after update or delete on sm_cab_meetings for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cab_meetings enable row level security;

-- calendar: تقویم‌های کاری
do $cols$
begin
  if to_regclass('sm_calendars') is not null then
    alter table sm_calendars add column if not exists workspace_id uuid;
    alter table sm_calendars add column if not exists domain_id uuid;
    alter table sm_calendars add column if not exists unit_id uuid;
    alter table sm_calendars add column if not exists created_at timestamptz not null default now();
    alter table sm_calendars add column if not exists created_by uuid;
    alter table sm_calendars add column if not exists updated_at timestamptz not null default now();
    alter table sm_calendars add column if not exists updated_by uuid;
    alter table sm_calendars add column if not exists rev bigint not null default 0;
    alter table sm_calendars add column if not exists version integer not null default 1;
    alter table sm_calendars add column if not exists deleted_at timestamptz;
    alter table sm_calendars add column if not exists origin text;
    alter table sm_calendars add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_calendars add column if not exists name text;
    alter table sm_calendars add column if not exists timezone text;
    alter table sm_calendars add column if not exists hours jsonb;
    alter table sm_calendars add column if not exists holiday_sets jsonb;
    alter table sm_calendars add column if not exists is_default boolean not null default false;
    alter table sm_calendars add column if not exists active boolean not null default true;
    alter table sm_calendars add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_calendars (
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
  timezone text,
  hours jsonb,
  holiday_sets jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  description text
);
create index if not exists sm_calendars_rev_idx on sm_calendars (org_id, rev);
create index if not exists sm_calendars_upd_idx on sm_calendars (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_calendars_crt_idx on sm_calendars (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_calendars_name_uk on sm_calendars (org_id, name) where deleted_at is null;
drop trigger if exists sm_calendars_sync on sm_calendars;
create trigger sm_calendars_sync before insert or update on sm_calendars for each row execute function sm_sync_touch('calendar');
create or replace trigger sm_calendars_demo after insert on sm_calendars for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_calendars_demo_t after update or delete on sm_calendars for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_calendars enable row level security;

-- capacity_record: رکوردهای ظرفیت
do $cols$
begin
  if to_regclass('sm_capacity_records') is not null then
    alter table sm_capacity_records add column if not exists workspace_id uuid;
    alter table sm_capacity_records add column if not exists domain_id uuid;
    alter table sm_capacity_records add column if not exists unit_id uuid;
    alter table sm_capacity_records add column if not exists created_at timestamptz not null default now();
    alter table sm_capacity_records add column if not exists created_by uuid;
    alter table sm_capacity_records add column if not exists updated_at timestamptz not null default now();
    alter table sm_capacity_records add column if not exists updated_by uuid;
    alter table sm_capacity_records add column if not exists rev bigint not null default 0;
    alter table sm_capacity_records add column if not exists version integer not null default 1;
    alter table sm_capacity_records add column if not exists deleted_at timestamptz;
    alter table sm_capacity_records add column if not exists origin text;
    alter table sm_capacity_records add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_capacity_records add column if not exists name text;
    alter table sm_capacity_records add column if not exists kind text;
    alter table sm_capacity_records add column if not exists status text;
    alter table sm_capacity_records add column if not exists ci_id uuid;
    alter table sm_capacity_records add column if not exists service_id uuid;
    alter table sm_capacity_records add column if not exists metric text;
    alter table sm_capacity_records add column if not exists unit text;
    alter table sm_capacity_records add column if not exists capacity numeric;
    alter table sm_capacity_records add column if not exists utilisation numeric;
    alter table sm_capacity_records add column if not exists utilisation_pct numeric;
    alter table sm_capacity_records add column if not exists warning_pct numeric;
    alter table sm_capacity_records add column if not exists critical_pct numeric;
    alter table sm_capacity_records add column if not exists measured_at timestamptz;
    alter table sm_capacity_records add column if not exists event_match text;
    alter table sm_capacity_records add column if not exists samples jsonb;
    alter table sm_capacity_records add column if not exists exhaustion_at timestamptz;
    alter table sm_capacity_records add column if not exists lead_time_days integer;
    alter table sm_capacity_records add column if not exists owner_id uuid;
    alter table sm_capacity_records add column if not exists assignment_group_id uuid;
    alter table sm_capacity_records add column if not exists notified_status text;
    alter table sm_capacity_records add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_capacity_records (
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
  status text,
  ci_id uuid,
  service_id uuid,
  metric text,
  unit text,
  capacity numeric,
  utilisation numeric,
  utilisation_pct numeric,
  warning_pct numeric,
  critical_pct numeric,
  measured_at timestamptz,
  event_match text,
  samples jsonb,
  exhaustion_at timestamptz,
  lead_time_days integer,
  owner_id uuid,
  assignment_group_id uuid,
  notified_status text,
  notes text
);
create index if not exists sm_capacity_records_rev_idx on sm_capacity_records (org_id, rev);
create index if not exists sm_capacity_records_upd_idx on sm_capacity_records (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_capacity_records_crt_idx on sm_capacity_records (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_capacity_records_workspace_acc_idx on sm_capacity_records (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_capacity_records_unit_acc_idx on sm_capacity_records (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_capacity_records_domain_acc_idx on sm_capacity_records (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_capacity_records_owner_id_idx on sm_capacity_records (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_capacity_records_sync on sm_capacity_records;
create trigger sm_capacity_records_sync before insert or update on sm_capacity_records for each row execute function sm_sync_touch('capacity_record');
create or replace trigger sm_capacity_records_demo after insert on sm_capacity_records for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_capacity_records_demo_t after update or delete on sm_capacity_records for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_capacity_records enable row level security;

-- case_escalation: تشدیدها
do $cols$
begin
  if to_regclass('sm_case_escalations') is not null then
    alter table sm_case_escalations add column if not exists workspace_id uuid;
    alter table sm_case_escalations add column if not exists domain_id uuid;
    alter table sm_case_escalations add column if not exists unit_id uuid;
    alter table sm_case_escalations add column if not exists created_at timestamptz not null default now();
    alter table sm_case_escalations add column if not exists created_by uuid;
    alter table sm_case_escalations add column if not exists updated_at timestamptz not null default now();
    alter table sm_case_escalations add column if not exists updated_by uuid;
    alter table sm_case_escalations add column if not exists rev bigint not null default 0;
    alter table sm_case_escalations add column if not exists version integer not null default 1;
    alter table sm_case_escalations add column if not exists deleted_at timestamptz;
    alter table sm_case_escalations add column if not exists origin text;
    alter table sm_case_escalations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_case_escalations add column if not exists no integer;
    alter table sm_case_escalations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ESC' || no::text else 'ESC' || lpad(no::text, 6, '0') end) stored;
    alter table sm_case_escalations add column if not exists short_description text;
    alter table sm_case_escalations add column if not exists reason text;
    alter table sm_case_escalations add column if not exists case_id uuid;
    alter table sm_case_escalations add column if not exists account_id uuid;
    alter table sm_case_escalations add column if not exists severity text;
    alter table sm_case_escalations add column if not exists owner_id uuid;
    alter table sm_case_escalations add column if not exists executive_sponsor_id uuid;
    alter table sm_case_escalations add column if not exists cadence text;
    alter table sm_case_escalations add column if not exists next_update_at timestamptz;
    alter table sm_case_escalations add column if not exists requested_by uuid;
    alter table sm_case_escalations add column if not exists plan text;
    alter table sm_case_escalations add column if not exists resolution text;
    alter table sm_case_escalations add column if not exists support_group_id uuid;
    alter table sm_case_escalations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_case_escalations (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ESC' || no::text else 'ESC' || lpad(no::text, 6, '0') end) stored,
  short_description text,
  reason text,
  case_id uuid,
  account_id uuid,
  severity text,
  owner_id uuid,
  executive_sponsor_id uuid,
  cadence text,
  next_update_at timestamptz,
  requested_by uuid,
  plan text,
  resolution text,
  support_group_id uuid,
  state text,
  search_9c3826f0 text generated always as (translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_case_escalations' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9c3826f0' loop
    execute format('alter table %I drop column if exists %I', 'sm_case_escalations', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_case_escalations', 'search_9c3826f0', $x$translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_case_escalations' and indexname like 'sm\_case\_escalations\_search\_%' and indexname not in ('sm_case_escalations_search_9c3826f0_trgm', 'sm_case_escalations_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_case_escalations_search_9c3826f0_trgm', 'sm_case_escalations', 'search_9c3826f0', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_case_escalations_search_custom_trgm', 'sm_case_escalations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_case_escalations_no_uk on sm_case_escalations (org_id, no);
create index if not exists sm_case_escalations_rev_idx on sm_case_escalations (org_id, rev);
create index if not exists sm_case_escalations_upd_idx on sm_case_escalations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_case_escalations_crt_idx on sm_case_escalations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_case_escalations_case_id_idx on sm_case_escalations (org_id, case_id) where deleted_at is null;
create index if not exists sm_case_escalations_account_id_idx on sm_case_escalations (org_id, account_id) where deleted_at is null;
create index if not exists sm_case_escalations_owner_id_idx on sm_case_escalations (org_id, owner_id) where deleted_at is null;
create index if not exists sm_case_escalations_executive_sponsor_id_idx on sm_case_escalations (org_id, executive_sponsor_id) where deleted_at is null;
create index if not exists sm_case_escalations_support_group_id_idx on sm_case_escalations (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_case_escalations_state_idx on sm_case_escalations (org_id, state) where deleted_at is null;
create index if not exists sm_case_escalations_workspace_acc_idx on sm_case_escalations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_case_escalations_unit_acc_idx on sm_case_escalations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_case_escalations_domain_acc_idx on sm_case_escalations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_case_escalations_requested_by_idx on sm_case_escalations (org_id, requested_by) where deleted_at is null;
drop trigger if exists sm_case_escalations_sync on sm_case_escalations;
create trigger sm_case_escalations_sync before insert or update on sm_case_escalations for each row execute function sm_sync_touch('case_escalation');
create or replace trigger sm_case_escalations_demo after insert on sm_case_escalations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_case_escalations_demo_t after update or delete on sm_case_escalations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_case_escalations enable row level security;

-- catalog: کاتالوگ‌ها
do $cols$
begin
  if to_regclass('sm_catalogs') is not null then
    alter table sm_catalogs add column if not exists workspace_id uuid;
    alter table sm_catalogs add column if not exists domain_id uuid;
    alter table sm_catalogs add column if not exists unit_id uuid;
    alter table sm_catalogs add column if not exists created_at timestamptz not null default now();
    alter table sm_catalogs add column if not exists created_by uuid;
    alter table sm_catalogs add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalogs add column if not exists updated_by uuid;
    alter table sm_catalogs add column if not exists rev bigint not null default 0;
    alter table sm_catalogs add column if not exists version integer not null default 1;
    alter table sm_catalogs add column if not exists deleted_at timestamptz;
    alter table sm_catalogs add column if not exists origin text;
    alter table sm_catalogs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalogs add column if not exists name text;
    alter table sm_catalogs add column if not exists active boolean not null default true;
    alter table sm_catalogs add column if not exists sort_order integer;
    alter table sm_catalogs add column if not exists description text;
    alter table sm_catalogs add column if not exists icon text;
    alter table sm_catalogs add column if not exists color text;
    alter table sm_catalogs add column if not exists category_order text;
    alter table sm_catalogs add column if not exists banner text;
    alter table sm_catalogs add column if not exists owner_id uuid;
    alter table sm_catalogs add column if not exists managers jsonb;
    alter table sm_catalogs add column if not exists available_for jsonb;
    alter table sm_catalogs add column if not exists not_available_for jsonb;
  end if;
end
$cols$;
create table if not exists sm_catalogs (
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
  description text,
  icon text,
  color text,
  category_order text,
  banner text,
  owner_id uuid,
  managers jsonb,
  available_for jsonb,
  not_available_for jsonb
);
create index if not exists sm_catalogs_rev_idx on sm_catalogs (org_id, rev);
create index if not exists sm_catalogs_upd_idx on sm_catalogs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalogs_crt_idx on sm_catalogs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_catalogs_name_uk on sm_catalogs (org_id, name) where deleted_at is null;
create index if not exists sm_catalogs_workspace_acc_idx on sm_catalogs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_catalogs_unit_acc_idx on sm_catalogs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_catalogs_domain_acc_idx on sm_catalogs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_catalogs_owner_id_idx on sm_catalogs (org_id, owner_id) where deleted_at is null;
create index if not exists sm_catalogs_managers_gin on sm_catalogs using gin (managers);
drop trigger if exists sm_catalogs_sync on sm_catalogs;
create trigger sm_catalogs_sync before insert or update on sm_catalogs for each row execute function sm_sync_touch('catalog');
create or replace trigger sm_catalogs_demo after insert on sm_catalogs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalogs_demo_t after update or delete on sm_catalogs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalogs enable row level security;

-- catalog_audience: مخاطبان کاتالوگ
do $cols$
begin
  if to_regclass('sm_catalog_audiences') is not null then
    alter table sm_catalog_audiences add column if not exists workspace_id uuid;
    alter table sm_catalog_audiences add column if not exists domain_id uuid;
    alter table sm_catalog_audiences add column if not exists unit_id uuid;
    alter table sm_catalog_audiences add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_audiences add column if not exists created_by uuid;
    alter table sm_catalog_audiences add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_audiences add column if not exists updated_by uuid;
    alter table sm_catalog_audiences add column if not exists rev bigint not null default 0;
    alter table sm_catalog_audiences add column if not exists version integer not null default 1;
    alter table sm_catalog_audiences add column if not exists deleted_at timestamptz;
    alter table sm_catalog_audiences add column if not exists origin text;
    alter table sm_catalog_audiences add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_audiences add column if not exists name text;
    alter table sm_catalog_audiences add column if not exists match text;
    alter table sm_catalog_audiences add column if not exists active boolean not null default true;
    alter table sm_catalog_audiences add column if not exists users jsonb;
    alter table sm_catalog_audiences add column if not exists groups jsonb;
    alter table sm_catalog_audiences add column if not exists units jsonb;
    alter table sm_catalog_audiences add column if not exists include_subunits boolean not null default true;
    alter table sm_catalog_audiences add column if not exists locations jsonb;
    alter table sm_catalog_audiences add column if not exists include_sublocations boolean not null default true;
    alter table sm_catalog_audiences add column if not exists roles jsonb;
    alter table sm_catalog_audiences add column if not exists personas jsonb;
    alter table sm_catalog_audiences add column if not exists vip_only boolean not null default false;
    alter table sm_catalog_audiences add column if not exists condition jsonb;
    alter table sm_catalog_audiences add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_catalog_audiences (
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
  match text,
  active boolean not null default true,
  users jsonb,
  groups jsonb,
  units jsonb,
  include_subunits boolean not null default true,
  locations jsonb,
  include_sublocations boolean not null default true,
  roles jsonb,
  personas jsonb,
  vip_only boolean not null default false,
  condition jsonb,
  description text
);
create index if not exists sm_catalog_audiences_rev_idx on sm_catalog_audiences (org_id, rev);
create index if not exists sm_catalog_audiences_upd_idx on sm_catalog_audiences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_audiences_crt_idx on sm_catalog_audiences (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_catalog_audiences_name_uk on sm_catalog_audiences (org_id, name) where deleted_at is null;
drop trigger if exists sm_catalog_audiences_sync on sm_catalog_audiences;
create trigger sm_catalog_audiences_sync before insert or update on sm_catalog_audiences for each row execute function sm_sync_touch('catalog_audience');
create or replace trigger sm_catalog_audiences_demo after insert on sm_catalog_audiences for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_audiences_demo_t after update or delete on sm_catalog_audiences for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_audiences enable row level security;

-- catalog_category: دسته‌های کاتالوگ
do $cols$
begin
  if to_regclass('sm_catalog_categories') is not null then
    alter table sm_catalog_categories add column if not exists workspace_id uuid;
    alter table sm_catalog_categories add column if not exists domain_id uuid;
    alter table sm_catalog_categories add column if not exists unit_id uuid;
    alter table sm_catalog_categories add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_categories add column if not exists created_by uuid;
    alter table sm_catalog_categories add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_categories add column if not exists updated_by uuid;
    alter table sm_catalog_categories add column if not exists rev bigint not null default 0;
    alter table sm_catalog_categories add column if not exists version integer not null default 1;
    alter table sm_catalog_categories add column if not exists deleted_at timestamptz;
    alter table sm_catalog_categories add column if not exists origin text;
    alter table sm_catalog_categories add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_categories add column if not exists name text;
    alter table sm_catalog_categories add column if not exists catalog_id uuid;
    alter table sm_catalog_categories add column if not exists parent_id uuid;
    alter table sm_catalog_categories add column if not exists sort_order integer;
    alter table sm_catalog_categories add column if not exists active boolean not null default true;
    alter table sm_catalog_categories add column if not exists description text;
    alter table sm_catalog_categories add column if not exists icon text;
    alter table sm_catalog_categories add column if not exists available_for jsonb;
    alter table sm_catalog_categories add column if not exists not_available_for jsonb;
  end if;
end
$cols$;
create table if not exists sm_catalog_categories (
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
  catalog_id uuid,
  parent_id uuid,
  sort_order integer,
  active boolean not null default true,
  description text,
  icon text,
  available_for jsonb,
  not_available_for jsonb
);
create index if not exists sm_catalog_categories_rev_idx on sm_catalog_categories (org_id, rev);
create index if not exists sm_catalog_categories_upd_idx on sm_catalog_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_categories_crt_idx on sm_catalog_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_categories_catalog_id_idx on sm_catalog_categories (org_id, catalog_id) where deleted_at is null;
drop trigger if exists sm_catalog_categories_sync on sm_catalog_categories;
create trigger sm_catalog_categories_sync before insert or update on sm_catalog_categories for each row execute function sm_sync_touch('catalog_category');
create or replace trigger sm_catalog_categories_demo after insert on sm_catalog_categories for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_categories_demo_t after update or delete on sm_catalog_categories for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_categories enable row level security;

-- catalog_item: اقلام کاتالوگ
do $cols$
begin
  if to_regclass('sm_catalog_items') is not null then
    alter table sm_catalog_items add column if not exists workspace_id uuid;
    alter table sm_catalog_items add column if not exists domain_id uuid;
    alter table sm_catalog_items add column if not exists unit_id uuid;
    alter table sm_catalog_items add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_items add column if not exists created_by uuid;
    alter table sm_catalog_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_items add column if not exists updated_by uuid;
    alter table sm_catalog_items add column if not exists rev bigint not null default 0;
    alter table sm_catalog_items add column if not exists version integer not null default 1;
    alter table sm_catalog_items add column if not exists deleted_at timestamptz;
    alter table sm_catalog_items add column if not exists origin text;
    alter table sm_catalog_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_items add column if not exists no integer;
    alter table sm_catalog_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ITM' || no::text else 'ITM' || lpad(no::text, 5, '0') end) stored;
    alter table sm_catalog_items add column if not exists name text;
    alter table sm_catalog_items add column if not exists code text;
    alter table sm_catalog_items add column if not exists type text;
    alter table sm_catalog_items add column if not exists catalog_id uuid;
    alter table sm_catalog_items add column if not exists category_id uuid;
    alter table sm_catalog_items add column if not exists offering_id uuid;
    alter table sm_catalog_items add column if not exists short_description text;
    alter table sm_catalog_items add column if not exists description text;
    alter table sm_catalog_items add column if not exists icon text;
    alter table sm_catalog_items add column if not exists color text;
    alter table sm_catalog_items add column if not exists sort_order integer;
    alter table sm_catalog_items add column if not exists owner_id uuid;
    alter table sm_catalog_items add column if not exists editors jsonb;
    alter table sm_catalog_items add column if not exists featured boolean not null default false;
    alter table sm_catalog_items add column if not exists hidden boolean not null default false;
    alter table sm_catalog_items add column if not exists ad_hoc boolean not null default false;
    alter table sm_catalog_items add column if not exists content_url text;
    alter table sm_catalog_items add column if not exists button_label text;
    alter table sm_catalog_items add column if not exists title_template text;
    alter table sm_catalog_items add column if not exists on_behalf text;
    alter table sm_catalog_items add column if not exists multi_user boolean not null default false;
    alter table sm_catalog_items add column if not exists cart_allowed boolean not null default true;
    alter table sm_catalog_items add column if not exists quantity_allowed boolean not null default false;
    alter table sm_catalog_items add column if not exists max_quantity integer;
    alter table sm_catalog_items add column if not exists requester_edit boolean not null default true;
    alter table sm_catalog_items add column if not exists requester_cancel text;
    alter table sm_catalog_items add column if not exists requires_confirmation boolean not null default true;
    alter table sm_catalog_items add column if not exists price numeric;
    alter table sm_catalog_items add column if not exists recurring_price numeric;
    alter table sm_catalog_items add column if not exists recurring_frequency text;
    alter table sm_catalog_items add column if not exists show_price boolean not null default true;
    alter table sm_catalog_items add column if not exists creates_subscription boolean not null default false;
    alter table sm_catalog_items add column if not exists delivery_days integer;
    alter table sm_catalog_items add column if not exists calendar_id uuid;
    alter table sm_catalog_items add column if not exists fulfilment_group_id uuid;
    alter table sm_catalog_items add column if not exists flow_id uuid;
    alter table sm_catalog_items add column if not exists approval_rule_id uuid;
    alter table sm_catalog_items add column if not exists target_table text;
    alter table sm_catalog_items add column if not exists field_map jsonb;
    alter table sm_catalog_items add column if not exists std_change_template text;
    alter table sm_catalog_items add column if not exists variable_sets jsonb;
    alter table sm_catalog_items add column if not exists stages jsonb;
    alter table sm_catalog_items add column if not exists available_for jsonb;
    alter table sm_catalog_items add column if not exists not_available_for jsonb;
    alter table sm_catalog_items add column if not exists conversational boolean not null default true;
    alter table sm_catalog_items add column if not exists review_interval_days integer;
    alter table sm_catalog_items add column if not exists next_review_at date;
    alter table sm_catalog_items add column if not exists version_no integer;
    alter table sm_catalog_items add column if not exists version_id uuid;
    alter table sm_catalog_items add column if not exists published_at timestamptz;
    alter table sm_catalog_items add column if not exists dirty boolean not null default false;
    alter table sm_catalog_items add column if not exists sle_p50 bigint;
    alter table sm_catalog_items add column if not exists sle_p85 bigint;
    alter table sm_catalog_items add column if not exists sle_p95 bigint;
    alter table sm_catalog_items add column if not exists sle_samples integer;
    alter table sm_catalog_items add column if not exists orders_90d integer;
    alter table sm_catalog_items add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_catalog_items (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ITM' || no::text else 'ITM' || lpad(no::text, 5, '0') end) stored,
  name text,
  code text,
  type text,
  catalog_id uuid,
  category_id uuid,
  offering_id uuid,
  short_description text,
  description text,
  icon text,
  color text,
  sort_order integer,
  owner_id uuid,
  editors jsonb,
  featured boolean not null default false,
  hidden boolean not null default false,
  ad_hoc boolean not null default false,
  content_url text,
  button_label text,
  title_template text,
  on_behalf text,
  multi_user boolean not null default false,
  cart_allowed boolean not null default true,
  quantity_allowed boolean not null default false,
  max_quantity integer,
  requester_edit boolean not null default true,
  requester_cancel text,
  requires_confirmation boolean not null default true,
  price numeric,
  recurring_price numeric,
  recurring_frequency text,
  show_price boolean not null default true,
  creates_subscription boolean not null default false,
  delivery_days integer,
  calendar_id uuid,
  fulfilment_group_id uuid,
  flow_id uuid,
  approval_rule_id uuid,
  target_table text,
  field_map jsonb,
  std_change_template text,
  variable_sets jsonb,
  stages jsonb,
  available_for jsonb,
  not_available_for jsonb,
  conversational boolean not null default true,
  review_interval_days integer,
  next_review_at date,
  version_no integer,
  version_id uuid,
  published_at timestamptz,
  dirty boolean not null default false,
  sle_p50 bigint,
  sle_p85 bigint,
  sle_p95 bigint,
  sle_samples integer,
  orders_90d integer,
  state text,
  search_f0aaf655 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_catalog_items' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f0aaf655' loop
    execute format('alter table %I drop column if exists %I', 'sm_catalog_items', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_catalog_items', 'search_f0aaf655', $x$translate(coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_catalog_items' and indexname like 'sm\_catalog\_items\_search\_%' and indexname not in ('sm_catalog_items_search_f0aaf655_trgm', 'sm_catalog_items_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_catalog_items_search_f0aaf655_trgm', 'sm_catalog_items', 'search_f0aaf655', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_catalog_items_search_custom_trgm', 'sm_catalog_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_catalog_items_no_uk on sm_catalog_items (org_id, no);
create index if not exists sm_catalog_items_rev_idx on sm_catalog_items (org_id, rev);
create index if not exists sm_catalog_items_upd_idx on sm_catalog_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_items_crt_idx on sm_catalog_items (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_catalog_items_code_uk on sm_catalog_items (org_id, code) where deleted_at is null;
create index if not exists sm_catalog_items_catalog_id_idx on sm_catalog_items (org_id, catalog_id) where deleted_at is null;
create index if not exists sm_catalog_items_category_id_idx on sm_catalog_items (org_id, category_id) where deleted_at is null;
create index if not exists sm_catalog_items_offering_id_idx on sm_catalog_items (org_id, offering_id) where deleted_at is null;
create index if not exists sm_catalog_items_state_idx on sm_catalog_items (org_id, state) where deleted_at is null;
create index if not exists sm_catalog_items_workspace_acc_idx on sm_catalog_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_catalog_items_unit_acc_idx on sm_catalog_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_catalog_items_domain_acc_idx on sm_catalog_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_catalog_items_owner_id_idx on sm_catalog_items (org_id, owner_id) where deleted_at is null;
create index if not exists sm_catalog_items_editors_gin on sm_catalog_items using gin (editors);
drop trigger if exists sm_catalog_items_sync on sm_catalog_items;
create trigger sm_catalog_items_sync before insert or update on sm_catalog_items for each row execute function sm_sync_touch('catalog_item');
create or replace trigger sm_catalog_items_demo after insert on sm_catalog_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_items_demo_t after update or delete on sm_catalog_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_items enable row level security;

-- catalog_item_model: مدل‌های اقلام کاتالوگ
do $cols$
begin
  if to_regclass('sm_catalog_item_models') is not null then
    alter table sm_catalog_item_models add column if not exists workspace_id uuid;
    alter table sm_catalog_item_models add column if not exists domain_id uuid;
    alter table sm_catalog_item_models add column if not exists unit_id uuid;
    alter table sm_catalog_item_models add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_item_models add column if not exists created_by uuid;
    alter table sm_catalog_item_models add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_item_models add column if not exists updated_by uuid;
    alter table sm_catalog_item_models add column if not exists rev bigint not null default 0;
    alter table sm_catalog_item_models add column if not exists version integer not null default 1;
    alter table sm_catalog_item_models add column if not exists deleted_at timestamptz;
    alter table sm_catalog_item_models add column if not exists origin text;
    alter table sm_catalog_item_models add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_item_models add column if not exists catalog_item_id uuid;
    alter table sm_catalog_item_models add column if not exists model_id uuid;
    alter table sm_catalog_item_models add column if not exists consume_stock boolean not null default true;
    alter table sm_catalog_item_models add column if not exists raise_purchase boolean not null default true;
    alter table sm_catalog_item_models add column if not exists preference integer;
    alter table sm_catalog_item_models add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_catalog_item_models (
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
  catalog_item_id uuid,
  model_id uuid,
  consume_stock boolean not null default true,
  raise_purchase boolean not null default true,
  preference integer,
  label text
);
create index if not exists sm_catalog_item_models_rev_idx on sm_catalog_item_models (org_id, rev);
create index if not exists sm_catalog_item_models_upd_idx on sm_catalog_item_models (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_item_models_crt_idx on sm_catalog_item_models (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_item_models_catalog_item_id_idx on sm_catalog_item_models (org_id, catalog_item_id) where deleted_at is null;
create index if not exists sm_catalog_item_models_model_id_idx on sm_catalog_item_models (org_id, model_id) where deleted_at is null;
create unique index if not exists sm_catalog_item_models_catalog_item_id_model_id_uk on sm_catalog_item_models (org_id, catalog_item_id, model_id) where deleted_at is null;
drop trigger if exists sm_catalog_item_models_sync on sm_catalog_item_models;
create trigger sm_catalog_item_models_sync before insert or update on sm_catalog_item_models for each row execute function sm_sync_touch('catalog_item_model');
create or replace trigger sm_catalog_item_models_demo after insert on sm_catalog_item_models for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_item_models_demo_t after update or delete on sm_catalog_item_models for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_item_models enable row level security;

-- catalog_item_version: نسخه‌های قلم کاتالوگ
do $cols$
begin
  if to_regclass('sm_catalog_item_versions') is not null then
    alter table sm_catalog_item_versions add column if not exists workspace_id uuid;
    alter table sm_catalog_item_versions add column if not exists domain_id uuid;
    alter table sm_catalog_item_versions add column if not exists unit_id uuid;
    alter table sm_catalog_item_versions add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_item_versions add column if not exists created_by uuid;
    alter table sm_catalog_item_versions add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_item_versions add column if not exists updated_by uuid;
    alter table sm_catalog_item_versions add column if not exists rev bigint not null default 0;
    alter table sm_catalog_item_versions add column if not exists version integer not null default 1;
    alter table sm_catalog_item_versions add column if not exists deleted_at timestamptz;
    alter table sm_catalog_item_versions add column if not exists origin text;
    alter table sm_catalog_item_versions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_item_versions add column if not exists title text;
    alter table sm_catalog_item_versions add column if not exists item_id uuid;
    alter table sm_catalog_item_versions add column if not exists version_no integer;
    alter table sm_catalog_item_versions add column if not exists note text;
    alter table sm_catalog_item_versions add column if not exists schema jsonb;
  end if;
end
$cols$;
create table if not exists sm_catalog_item_versions (
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
  item_id uuid,
  version_no integer,
  note text,
  schema jsonb
);
create index if not exists sm_catalog_item_versions_rev_idx on sm_catalog_item_versions (org_id, rev);
create index if not exists sm_catalog_item_versions_upd_idx on sm_catalog_item_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_item_versions_crt_idx on sm_catalog_item_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_item_versions_item_id_idx on sm_catalog_item_versions (org_id, item_id) where deleted_at is null;
create unique index if not exists sm_catalog_item_versions_item_id_version_no_uk on sm_catalog_item_versions (org_id, item_id, version_no) where deleted_at is null;
drop trigger if exists sm_catalog_item_versions_sync on sm_catalog_item_versions;
create trigger sm_catalog_item_versions_sync before insert or update on sm_catalog_item_versions for each row execute function sm_sync_touch('catalog_item_version');
create or replace trigger sm_catalog_item_versions_demo after insert on sm_catalog_item_versions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_item_versions_demo_t after update or delete on sm_catalog_item_versions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_item_versions enable row level security;

-- catalog_task_template: الگوهای وظیفهٔ انجام
do $cols$
begin
  if to_regclass('sm_catalog_task_templates') is not null then
    alter table sm_catalog_task_templates add column if not exists workspace_id uuid;
    alter table sm_catalog_task_templates add column if not exists domain_id uuid;
    alter table sm_catalog_task_templates add column if not exists unit_id uuid;
    alter table sm_catalog_task_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_task_templates add column if not exists created_by uuid;
    alter table sm_catalog_task_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_task_templates add column if not exists updated_by uuid;
    alter table sm_catalog_task_templates add column if not exists rev bigint not null default 0;
    alter table sm_catalog_task_templates add column if not exists version integer not null default 1;
    alter table sm_catalog_task_templates add column if not exists deleted_at timestamptz;
    alter table sm_catalog_task_templates add column if not exists origin text;
    alter table sm_catalog_task_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_task_templates add column if not exists short_description text;
    alter table sm_catalog_task_templates add column if not exists sort_order integer;
    alter table sm_catalog_task_templates add column if not exists item_id uuid;
    alter table sm_catalog_task_templates add column if not exists assignment_group_id uuid;
    alter table sm_catalog_task_templates add column if not exists phase text;
    alter table sm_catalog_task_templates add column if not exists depends_on_previous boolean not null default true;
    alter table sm_catalog_task_templates add column if not exists requester_visible boolean not null default false;
    alter table sm_catalog_task_templates add column if not exists class_of_service text;
    alter table sm_catalog_task_templates add column if not exists condition jsonb;
    alter table sm_catalog_task_templates add column if not exists instructions text;
    alter table sm_catalog_task_templates add column if not exists checklist jsonb;
    alter table sm_catalog_task_templates add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_catalog_task_templates (
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
  short_description text,
  sort_order integer,
  item_id uuid,
  assignment_group_id uuid,
  phase text,
  depends_on_previous boolean not null default true,
  requester_visible boolean not null default false,
  class_of_service text,
  condition jsonb,
  instructions text,
  checklist jsonb,
  active boolean not null default true
);
create index if not exists sm_catalog_task_templates_rev_idx on sm_catalog_task_templates (org_id, rev);
create index if not exists sm_catalog_task_templates_upd_idx on sm_catalog_task_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_task_templates_crt_idx on sm_catalog_task_templates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_task_templates_item_id_idx on sm_catalog_task_templates (org_id, item_id) where deleted_at is null;
drop trigger if exists sm_catalog_task_templates_sync on sm_catalog_task_templates;
create trigger sm_catalog_task_templates_sync before insert or update on sm_catalog_task_templates for each row execute function sm_sync_touch('catalog_task_template');
create or replace trigger sm_catalog_task_templates_demo after insert on sm_catalog_task_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_task_templates_demo_t after update or delete on sm_catalog_task_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_task_templates enable row level security;

-- catalog_ui_policy: سیاست‌های فرم سفارش
do $cols$
begin
  if to_regclass('sm_catalog_ui_policies') is not null then
    alter table sm_catalog_ui_policies add column if not exists workspace_id uuid;
    alter table sm_catalog_ui_policies add column if not exists domain_id uuid;
    alter table sm_catalog_ui_policies add column if not exists unit_id uuid;
    alter table sm_catalog_ui_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_ui_policies add column if not exists created_by uuid;
    alter table sm_catalog_ui_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_ui_policies add column if not exists updated_by uuid;
    alter table sm_catalog_ui_policies add column if not exists rev bigint not null default 0;
    alter table sm_catalog_ui_policies add column if not exists version integer not null default 1;
    alter table sm_catalog_ui_policies add column if not exists deleted_at timestamptz;
    alter table sm_catalog_ui_policies add column if not exists origin text;
    alter table sm_catalog_ui_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_ui_policies add column if not exists name text;
    alter table sm_catalog_ui_policies add column if not exists item_id uuid;
    alter table sm_catalog_ui_policies add column if not exists set_id uuid;
    alter table sm_catalog_ui_policies add column if not exists applies_to text;
    alter table sm_catalog_ui_policies add column if not exists condition jsonb;
    alter table sm_catalog_ui_policies add column if not exists actions jsonb;
    alter table sm_catalog_ui_policies add column if not exists message text;
    alter table sm_catalog_ui_policies add column if not exists sort_order integer;
    alter table sm_catalog_ui_policies add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_catalog_ui_policies (
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
  item_id uuid,
  set_id uuid,
  applies_to text,
  condition jsonb,
  actions jsonb,
  message text,
  sort_order integer,
  active boolean not null default true
);
create index if not exists sm_catalog_ui_policies_rev_idx on sm_catalog_ui_policies (org_id, rev);
create index if not exists sm_catalog_ui_policies_upd_idx on sm_catalog_ui_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_ui_policies_crt_idx on sm_catalog_ui_policies (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_ui_policies_item_id_idx on sm_catalog_ui_policies (org_id, item_id) where deleted_at is null;
create index if not exists sm_catalog_ui_policies_set_id_idx on sm_catalog_ui_policies (org_id, set_id) where deleted_at is null;
drop trigger if exists sm_catalog_ui_policies_sync on sm_catalog_ui_policies;
create trigger sm_catalog_ui_policies_sync before insert or update on sm_catalog_ui_policies for each row execute function sm_sync_touch('catalog_ui_policy');
create or replace trigger sm_catalog_ui_policies_demo after insert on sm_catalog_ui_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_ui_policies_demo_t after update or delete on sm_catalog_ui_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_ui_policies enable row level security;

-- catalog_variable: پرسش‌های فرم
do $cols$
begin
  if to_regclass('sm_catalog_variables') is not null then
    alter table sm_catalog_variables add column if not exists workspace_id uuid;
    alter table sm_catalog_variables add column if not exists domain_id uuid;
    alter table sm_catalog_variables add column if not exists unit_id uuid;
    alter table sm_catalog_variables add column if not exists created_at timestamptz not null default now();
    alter table sm_catalog_variables add column if not exists created_by uuid;
    alter table sm_catalog_variables add column if not exists updated_at timestamptz not null default now();
    alter table sm_catalog_variables add column if not exists updated_by uuid;
    alter table sm_catalog_variables add column if not exists rev bigint not null default 0;
    alter table sm_catalog_variables add column if not exists version integer not null default 1;
    alter table sm_catalog_variables add column if not exists deleted_at timestamptz;
    alter table sm_catalog_variables add column if not exists origin text;
    alter table sm_catalog_variables add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_catalog_variables add column if not exists label text;
    alter table sm_catalog_variables add column if not exists name text;
    alter table sm_catalog_variables add column if not exists type text;
    alter table sm_catalog_variables add column if not exists item_id uuid;
    alter table sm_catalog_variables add column if not exists set_id uuid;
    alter table sm_catalog_variables add column if not exists sort_order integer;
    alter table sm_catalog_variables add column if not exists required boolean not null default false;
    alter table sm_catalog_variables add column if not exists readonly boolean not null default false;
    alter table sm_catalog_variables add column if not exists hidden boolean not null default false;
    alter table sm_catalog_variables add column if not exists width text;
    alter table sm_catalog_variables add column if not exists field_class text;
    alter table sm_catalog_variables add column if not exists default_value text;
    alter table sm_catalog_variables add column if not exists choices jsonb;
    alter table sm_catalog_variables add column if not exists ref_table text;
    alter table sm_catalog_variables add column if not exists ref_filter jsonb;
    alter table sm_catalog_variables add column if not exists min numeric;
    alter table sm_catalog_variables add column if not exists max numeric;
    alter table sm_catalog_variables add column if not exists max_length integer;
    alter table sm_catalog_variables add column if not exists price_per_unit numeric;
    alter table sm_catalog_variables add column if not exists regex text;
    alter table sm_catalog_variables add column if not exists regex_message text;
    alter table sm_catalog_variables add column if not exists help text;
    alter table sm_catalog_variables add column if not exists placeholder text;
    alter table sm_catalog_variables add column if not exists map_to text;
    alter table sm_catalog_variables add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_catalog_variables (
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
  name text,
  type text,
  item_id uuid,
  set_id uuid,
  sort_order integer,
  required boolean not null default false,
  readonly boolean not null default false,
  hidden boolean not null default false,
  width text,
  field_class text,
  default_value text,
  choices jsonb,
  ref_table text,
  ref_filter jsonb,
  min numeric,
  max numeric,
  max_length integer,
  price_per_unit numeric,
  regex text,
  regex_message text,
  help text,
  placeholder text,
  map_to text,
  active boolean not null default true
);
create index if not exists sm_catalog_variables_rev_idx on sm_catalog_variables (org_id, rev);
create index if not exists sm_catalog_variables_upd_idx on sm_catalog_variables (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_variables_crt_idx on sm_catalog_variables (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_variables_item_id_idx on sm_catalog_variables (org_id, item_id) where deleted_at is null;
create index if not exists sm_catalog_variables_set_id_idx on sm_catalog_variables (org_id, set_id) where deleted_at is null;
drop trigger if exists sm_catalog_variables_sync on sm_catalog_variables;
create trigger sm_catalog_variables_sync before insert or update on sm_catalog_variables for each row execute function sm_sync_touch('catalog_variable');
create or replace trigger sm_catalog_variables_demo after insert on sm_catalog_variables for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_catalog_variables_demo_t after update or delete on sm_catalog_variables for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_catalog_variables enable row level security;

-- category: دسته‌بندی‌ها
do $cols$
begin
  if to_regclass('sm_categories') is not null then
    alter table sm_categories add column if not exists workspace_id uuid;
    alter table sm_categories add column if not exists domain_id uuid;
    alter table sm_categories add column if not exists unit_id uuid;
    alter table sm_categories add column if not exists created_at timestamptz not null default now();
    alter table sm_categories add column if not exists created_by uuid;
    alter table sm_categories add column if not exists updated_at timestamptz not null default now();
    alter table sm_categories add column if not exists updated_by uuid;
    alter table sm_categories add column if not exists rev bigint not null default 0;
    alter table sm_categories add column if not exists version integer not null default 1;
    alter table sm_categories add column if not exists deleted_at timestamptz;
    alter table sm_categories add column if not exists origin text;
    alter table sm_categories add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_categories add column if not exists name text;
    alter table sm_categories add column if not exists table_key text;
    alter table sm_categories add column if not exists value text;
    alter table sm_categories add column if not exists parent_id uuid;
    alter table sm_categories add column if not exists default_group_id uuid;
    alter table sm_categories add column if not exists sort_order integer;
    alter table sm_categories add column if not exists active boolean not null default true;
    alter table sm_categories add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_categories (
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
  value text,
  parent_id uuid,
  default_group_id uuid,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_categories_rev_idx on sm_categories (org_id, rev);
create index if not exists sm_categories_upd_idx on sm_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_categories_crt_idx on sm_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_categories_parent_id_idx on sm_categories (org_id, parent_id) where deleted_at is null;
create unique index if not exists sm_categories_table_key_value_uk on sm_categories (org_id, table_key, value) where deleted_at is null;
drop trigger if exists sm_categories_sync on sm_categories;
create trigger sm_categories_sync before insert or update on sm_categories for each row execute function sm_sync_touch('category');
create or replace trigger sm_categories_demo after insert on sm_categories for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_categories_demo_t after update or delete on sm_categories for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_categories enable row level security;

-- change_config: تنظیمات تغییر
do $cols$
begin
  if to_regclass('sm_change_configs') is not null then
    alter table sm_change_configs add column if not exists workspace_id uuid;
    alter table sm_change_configs add column if not exists domain_id uuid;
    alter table sm_change_configs add column if not exists unit_id uuid;
    alter table sm_change_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_change_configs add column if not exists created_by uuid;
    alter table sm_change_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_configs add column if not exists updated_by uuid;
    alter table sm_change_configs add column if not exists rev bigint not null default 0;
    alter table sm_change_configs add column if not exists version integer not null default 1;
    alter table sm_change_configs add column if not exists deleted_at timestamptz;
    alter table sm_change_configs add column if not exists origin text;
    alter table sm_change_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_configs add column if not exists name text;
    alter table sm_change_configs add column if not exists config_key text;
    alter table sm_change_configs add column if not exists risk_moderate_from integer;
    alter table sm_change_configs add column if not exists risk_high_from integer;
    alter table sm_change_configs add column if not exists risk_very_high_from integer;
    alter table sm_change_configs add column if not exists questionnaire_weight integer;
    alter table sm_change_configs add column if not exists lead_days_low integer;
    alter table sm_change_configs add column if not exists lead_days_moderate integer;
    alter table sm_change_configs add column if not exists lead_days_high integer;
    alter table sm_change_configs add column if not exists lead_days_very_high integer;
    alter table sm_change_configs add column if not exists reauthorize_on_edit boolean not null default true;
    alter table sm_change_configs add column if not exists hold_blocks_cancel boolean not null default true;
    alter table sm_change_configs add column if not exists pir_required_for jsonb;
    alter table sm_change_configs add column if not exists pir_due_days integer;
    alter table sm_change_configs add column if not exists review_auto_close_days integer;
    alter table sm_change_configs add column if not exists stale_draft_days integer;
    alter table sm_change_configs add column if not exists window_alert_minutes integer;
    alter table sm_change_configs add column if not exists success_window_days integer;
    alter table sm_change_configs add column if not exists related_ci_conflicts boolean not null default true;
    alter table sm_change_configs add column if not exists lockdown_on_major boolean not null default false;
    alter table sm_change_configs add column if not exists cab_risks jsonb;
    alter table sm_change_configs add column if not exists change_manager_group_id uuid;
    alter table sm_change_configs add column if not exists default_cab_id uuid;
    alter table sm_change_configs add column if not exists emergency_cab_id uuid;
    alter table sm_change_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_change_configs (
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
  risk_moderate_from integer,
  risk_high_from integer,
  risk_very_high_from integer,
  questionnaire_weight integer,
  lead_days_low integer,
  lead_days_moderate integer,
  lead_days_high integer,
  lead_days_very_high integer,
  reauthorize_on_edit boolean not null default true,
  hold_blocks_cancel boolean not null default true,
  pir_required_for jsonb,
  pir_due_days integer,
  review_auto_close_days integer,
  stale_draft_days integer,
  window_alert_minutes integer,
  success_window_days integer,
  related_ci_conflicts boolean not null default true,
  lockdown_on_major boolean not null default false,
  cab_risks jsonb,
  change_manager_group_id uuid,
  default_cab_id uuid,
  emergency_cab_id uuid,
  seeded integer
);
create index if not exists sm_change_configs_rev_idx on sm_change_configs (org_id, rev);
create index if not exists sm_change_configs_upd_idx on sm_change_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_configs_crt_idx on sm_change_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_change_configs_config_key_uk on sm_change_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_change_configs_sync on sm_change_configs;
create trigger sm_change_configs_sync before insert or update on sm_change_configs for each row execute function sm_sync_touch('change_config');
create or replace trigger sm_change_configs_demo after insert on sm_change_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_configs_demo_t after update or delete on sm_change_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_configs enable row level security;

-- change_conflict: تداخل‌های تغییر
do $cols$
begin
  if to_regclass('sm_change_conflicts') is not null then
    alter table sm_change_conflicts add column if not exists workspace_id uuid;
    alter table sm_change_conflicts add column if not exists domain_id uuid;
    alter table sm_change_conflicts add column if not exists unit_id uuid;
    alter table sm_change_conflicts add column if not exists created_at timestamptz not null default now();
    alter table sm_change_conflicts add column if not exists created_by uuid;
    alter table sm_change_conflicts add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_conflicts add column if not exists updated_by uuid;
    alter table sm_change_conflicts add column if not exists rev bigint not null default 0;
    alter table sm_change_conflicts add column if not exists version integer not null default 1;
    alter table sm_change_conflicts add column if not exists deleted_at timestamptz;
    alter table sm_change_conflicts add column if not exists origin text;
    alter table sm_change_conflicts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_conflicts add column if not exists summary text;
    alter table sm_change_conflicts add column if not exists change_id uuid;
    alter table sm_change_conflicts add column if not exists kind text;
    alter table sm_change_conflicts add column if not exists status text;
    alter table sm_change_conflicts add column if not exists justification text;
    alter table sm_change_conflicts add column if not exists other_change_id uuid;
    alter table sm_change_conflicts add column if not exists window_id uuid;
    alter table sm_change_conflicts add column if not exists lockdown_id uuid;
    alter table sm_change_conflicts add column if not exists ci_id uuid;
    alter table sm_change_conflicts add column if not exists service_id uuid;
    alter table sm_change_conflicts add column if not exists overlap_start timestamptz;
    alter table sm_change_conflicts add column if not exists overlap_end timestamptz;
    alter table sm_change_conflicts add column if not exists active boolean not null default true;
    alter table sm_change_conflicts add column if not exists key text;
    alter table sm_change_conflicts add column if not exists detected_at timestamptz;
    alter table sm_change_conflicts add column if not exists assignment_group_id uuid;
    alter table sm_change_conflicts add column if not exists assigned_to uuid;
    alter table sm_change_conflicts add column if not exists change_owner_id uuid;
  end if;
end
$cols$;
create table if not exists sm_change_conflicts (
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
  summary text,
  change_id uuid,
  kind text,
  status text,
  justification text,
  other_change_id uuid,
  window_id uuid,
  lockdown_id uuid,
  ci_id uuid,
  service_id uuid,
  overlap_start timestamptz,
  overlap_end timestamptz,
  active boolean not null default true,
  key text,
  detected_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  change_owner_id uuid
);
create index if not exists sm_change_conflicts_rev_idx on sm_change_conflicts (org_id, rev);
create index if not exists sm_change_conflicts_upd_idx on sm_change_conflicts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_conflicts_crt_idx on sm_change_conflicts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_conflicts_change_id_idx on sm_change_conflicts (org_id, change_id) where deleted_at is null;
create index if not exists sm_change_conflicts_other_change_id_idx on sm_change_conflicts (org_id, other_change_id) where deleted_at is null;
create unique index if not exists sm_change_conflicts_change_id_key_uk on sm_change_conflicts (org_id, change_id, key) where deleted_at is null;
create index if not exists sm_change_conflicts_workspace_acc_idx on sm_change_conflicts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_conflicts_unit_acc_idx on sm_change_conflicts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_conflicts_domain_acc_idx on sm_change_conflicts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_conflicts_change_owner_id_idx on sm_change_conflicts (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_conflicts_assigned_to_idx on sm_change_conflicts (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_conflicts_open_grp_idx on sm_change_conflicts (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_change_conflicts_sync on sm_change_conflicts;
create trigger sm_change_conflicts_sync before insert or update on sm_change_conflicts for each row execute function sm_sync_touch('change_conflict');
create or replace trigger sm_change_conflicts_demo after insert on sm_change_conflicts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_conflicts_demo_t after update or delete on sm_change_conflicts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_conflicts enable row level security;

-- change_gate: دروازه‌های استقرار
do $cols$
begin
  if to_regclass('sm_change_gates') is not null then
    alter table sm_change_gates add column if not exists workspace_id uuid;
    alter table sm_change_gates add column if not exists domain_id uuid;
    alter table sm_change_gates add column if not exists unit_id uuid;
    alter table sm_change_gates add column if not exists created_at timestamptz not null default now();
    alter table sm_change_gates add column if not exists created_by uuid;
    alter table sm_change_gates add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_gates add column if not exists updated_by uuid;
    alter table sm_change_gates add column if not exists rev bigint not null default 0;
    alter table sm_change_gates add column if not exists version integer not null default 1;
    alter table sm_change_gates add column if not exists deleted_at timestamptz;
    alter table sm_change_gates add column if not exists origin text;
    alter table sm_change_gates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_gates add column if not exists no integer;
    alter table sm_change_gates add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'GATE' || no::text else 'GATE' || lpad(no::text, 7, '0') end) stored;
    alter table sm_change_gates add column if not exists summary text;
    alter table sm_change_gates add column if not exists connection_id uuid;
    alter table sm_change_gates add column if not exists pipeline_id uuid;
    alter table sm_change_gates add column if not exists environment_id uuid;
    alter table sm_change_gates add column if not exists service_id uuid;
    alter table sm_change_gates add column if not exists run_ref text;
    alter table sm_change_gates add column if not exists artifact_version text;
    alter table sm_change_gates add column if not exists commit_sha text;
    alter table sm_change_gates add column if not exists change_id uuid;
    alter table sm_change_gates add column if not exists deployment_id uuid;
    alter table sm_change_gates add column if not exists rule text;
    alter table sm_change_gates add column if not exists reason text;
    alter table sm_change_gates add column if not exists requested_at timestamptz;
    alter table sm_change_gates add column if not exists timeout_at timestamptz;
    alter table sm_change_gates add column if not exists decided_at timestamptz;
    alter table sm_change_gates add column if not exists decided_by uuid;
    alter table sm_change_gates add column if not exists wait_seconds bigint;
    alter table sm_change_gates add column if not exists approval text;
    alter table sm_change_gates add column if not exists evidence jsonb;
    alter table sm_change_gates add column if not exists evidence_hash text;
    alter table sm_change_gates add column if not exists prev_hash text;
    alter table sm_change_gates add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_change_gates (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'GATE' || no::text else 'GATE' || lpad(no::text, 7, '0') end) stored,
  summary text,
  connection_id uuid,
  pipeline_id uuid,
  environment_id uuid,
  service_id uuid,
  run_ref text,
  artifact_version text,
  commit_sha text,
  change_id uuid,
  deployment_id uuid,
  rule text,
  reason text,
  requested_at timestamptz,
  timeout_at timestamptz,
  decided_at timestamptz,
  decided_by uuid,
  wait_seconds bigint,
  approval text,
  evidence jsonb,
  evidence_hash text,
  prev_hash text,
  state text,
  search_6ba6e1c7 text generated always as (translate(coalesce(summary, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_gates' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_6ba6e1c7' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_gates', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_gates', 'search_6ba6e1c7', $x$translate(coalesce(summary, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_gates' and indexname like 'sm\_change\_gates\_search\_%' and indexname not in ('sm_change_gates_search_6ba6e1c7_trgm', 'sm_change_gates_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_gates_search_6ba6e1c7_trgm', 'sm_change_gates', 'search_6ba6e1c7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_gates_search_custom_trgm', 'sm_change_gates', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_gates_no_uk on sm_change_gates (org_id, no);
create index if not exists sm_change_gates_rev_idx on sm_change_gates (org_id, rev);
create index if not exists sm_change_gates_upd_idx on sm_change_gates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_gates_crt_idx on sm_change_gates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_gates_connection_id_idx on sm_change_gates (org_id, connection_id) where deleted_at is null;
create index if not exists sm_change_gates_state_idx on sm_change_gates (org_id, state) where deleted_at is null;
drop trigger if exists sm_change_gates_sync on sm_change_gates;
create trigger sm_change_gates_sync before insert or update on sm_change_gates for each row execute function sm_sync_touch('change_gate');
create or replace trigger sm_change_gates_demo after insert on sm_change_gates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_gates_demo_t after update or delete on sm_change_gates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_gates enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:3', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۵ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 5/30 (a0c3bc7de847)
-- change_lockdown: قرنطینه‌های تغییرات
do $cols$
begin
  if to_regclass('sm_change_lockdowns') is not null then
    alter table sm_change_lockdowns add column if not exists workspace_id uuid;
    alter table sm_change_lockdowns add column if not exists domain_id uuid;
    alter table sm_change_lockdowns add column if not exists unit_id uuid;
    alter table sm_change_lockdowns add column if not exists created_at timestamptz not null default now();
    alter table sm_change_lockdowns add column if not exists created_by uuid;
    alter table sm_change_lockdowns add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_lockdowns add column if not exists updated_by uuid;
    alter table sm_change_lockdowns add column if not exists rev bigint not null default 0;
    alter table sm_change_lockdowns add column if not exists version integer not null default 1;
    alter table sm_change_lockdowns add column if not exists deleted_at timestamptz;
    alter table sm_change_lockdowns add column if not exists origin text;
    alter table sm_change_lockdowns add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_lockdowns add column if not exists no integer;
    alter table sm_change_lockdowns add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'LCK' || no::text else 'LCK' || lpad(no::text, 4, '0') end) stored;
    alter table sm_change_lockdowns add column if not exists title text;
    alter table sm_change_lockdowns add column if not exists starts_at timestamptz;
    alter table sm_change_lockdowns add column if not exists ends_at timestamptz;
    alter table sm_change_lockdowns add column if not exists hold_in_flight boolean not null default true;
    alter table sm_change_lockdowns add column if not exists incident_id uuid;
    alter table sm_change_lockdowns add column if not exists services jsonb;
    alter table sm_change_lockdowns add column if not exists cis jsonb;
    alter table sm_change_lockdowns add column if not exists scope_condition jsonb;
    alter table sm_change_lockdowns add column if not exists reason text;
    alter table sm_change_lockdowns add column if not exists released_at timestamptz;
    alter table sm_change_lockdowns add column if not exists released_by uuid;
    alter table sm_change_lockdowns add column if not exists held_count integer;
    alter table sm_change_lockdowns add column if not exists applied_at timestamptz;
    alter table sm_change_lockdowns add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_change_lockdowns (
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
  number text generated always as (case when no is null then null when length(no::text) >= 4 then 'LCK' || no::text else 'LCK' || lpad(no::text, 4, '0') end) stored,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  hold_in_flight boolean not null default true,
  incident_id uuid,
  services jsonb,
  cis jsonb,
  scope_condition jsonb,
  reason text,
  released_at timestamptz,
  released_by uuid,
  held_count integer,
  applied_at timestamptz,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_lockdowns' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_lockdowns', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_lockdowns', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_lockdowns' and indexname like 'sm\_change\_lockdowns\_search\_%' and indexname not in ('sm_change_lockdowns_search_cae18f1d_trgm', 'sm_change_lockdowns_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_lockdowns_search_cae18f1d_trgm', 'sm_change_lockdowns', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_lockdowns_search_custom_trgm', 'sm_change_lockdowns', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_lockdowns_no_uk on sm_change_lockdowns (org_id, no);
create index if not exists sm_change_lockdowns_rev_idx on sm_change_lockdowns (org_id, rev);
create index if not exists sm_change_lockdowns_upd_idx on sm_change_lockdowns (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_lockdowns_crt_idx on sm_change_lockdowns (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_lockdowns_state_idx on sm_change_lockdowns (org_id, state) where deleted_at is null;
drop trigger if exists sm_change_lockdowns_sync on sm_change_lockdowns;
create trigger sm_change_lockdowns_sync before insert or update on sm_change_lockdowns for each row execute function sm_sync_touch('change_lockdown');
create or replace trigger sm_change_lockdowns_demo after insert on sm_change_lockdowns for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_lockdowns_demo_t after update or delete on sm_change_lockdowns for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_lockdowns enable row level security;

-- change_model: مدل‌های تغییر
do $cols$
begin
  if to_regclass('sm_change_models') is not null then
    alter table sm_change_models add column if not exists workspace_id uuid;
    alter table sm_change_models add column if not exists domain_id uuid;
    alter table sm_change_models add column if not exists unit_id uuid;
    alter table sm_change_models add column if not exists created_at timestamptz not null default now();
    alter table sm_change_models add column if not exists created_by uuid;
    alter table sm_change_models add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_models add column if not exists updated_by uuid;
    alter table sm_change_models add column if not exists rev bigint not null default 0;
    alter table sm_change_models add column if not exists version integer not null default 1;
    alter table sm_change_models add column if not exists deleted_at timestamptz;
    alter table sm_change_models add column if not exists origin text;
    alter table sm_change_models add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_models add column if not exists name text;
    alter table sm_change_models add column if not exists type text;
    alter table sm_change_models add column if not exists is_default boolean not null default false;
    alter table sm_change_models add column if not exists active boolean not null default true;
    alter table sm_change_models add column if not exists sort_order integer;
    alter table sm_change_models add column if not exists states jsonb;
    alter table sm_change_models add column if not exists docs_deferred boolean not null default false;
    alter table sm_change_models add column if not exists lead_time_exempt boolean not null default false;
    alter table sm_change_models add column if not exists cab_policy text;
    alter table sm_change_models add column if not exists pir_policy text;
    alter table sm_change_models add column if not exists requirements jsonb;
    alter table sm_change_models add column if not exists locks jsonb;
    alter table sm_change_models add column if not exists description text;
    alter table sm_change_models add column if not exists revision integer;
  end if;
end
$cols$;
create table if not exists sm_change_models (
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
  is_default boolean not null default false,
  active boolean not null default true,
  sort_order integer,
  states jsonb,
  docs_deferred boolean not null default false,
  lead_time_exempt boolean not null default false,
  cab_policy text,
  pir_policy text,
  requirements jsonb,
  locks jsonb,
  description text,
  revision integer
);
create index if not exists sm_change_models_rev_idx on sm_change_models (org_id, rev);
create index if not exists sm_change_models_upd_idx on sm_change_models (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_models_crt_idx on sm_change_models (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_change_models_name_uk on sm_change_models (org_id, name) where deleted_at is null;
drop trigger if exists sm_change_models_sync on sm_change_models;
create trigger sm_change_models_sync before insert or update on sm_change_models for each row execute function sm_sync_touch('change_model');
create or replace trigger sm_change_models_demo after insert on sm_change_models for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_models_demo_t after update or delete on sm_change_models for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_models enable row level security;

-- change_outage: قطعی‌های برنامه‌ریزی‌شده
do $cols$
begin
  if to_regclass('sm_change_outages') is not null then
    alter table sm_change_outages add column if not exists workspace_id uuid;
    alter table sm_change_outages add column if not exists domain_id uuid;
    alter table sm_change_outages add column if not exists unit_id uuid;
    alter table sm_change_outages add column if not exists created_at timestamptz not null default now();
    alter table sm_change_outages add column if not exists created_by uuid;
    alter table sm_change_outages add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_outages add column if not exists updated_by uuid;
    alter table sm_change_outages add column if not exists rev bigint not null default 0;
    alter table sm_change_outages add column if not exists version integer not null default 1;
    alter table sm_change_outages add column if not exists deleted_at timestamptz;
    alter table sm_change_outages add column if not exists origin text;
    alter table sm_change_outages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_outages add column if not exists title text;
    alter table sm_change_outages add column if not exists outage_type text;
    alter table sm_change_outages add column if not exists change_id uuid;
    alter table sm_change_outages add column if not exists service_id uuid;
    alter table sm_change_outages add column if not exists ci_id uuid;
    alter table sm_change_outages add column if not exists starts_at timestamptz;
    alter table sm_change_outages add column if not exists ends_at timestamptz;
    alter table sm_change_outages add column if not exists announce boolean not null default true;
    alter table sm_change_outages add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_change_outages (
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
  outage_type text,
  change_id uuid,
  service_id uuid,
  ci_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  announce boolean not null default true,
  description text
);
create index if not exists sm_change_outages_rev_idx on sm_change_outages (org_id, rev);
create index if not exists sm_change_outages_upd_idx on sm_change_outages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_outages_crt_idx on sm_change_outages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_outages_change_id_idx on sm_change_outages (org_id, change_id) where deleted_at is null;
drop trigger if exists sm_change_outages_sync on sm_change_outages;
create trigger sm_change_outages_sync before insert or update on sm_change_outages for each row execute function sm_sync_touch('change_outage');
create or replace trigger sm_change_outages_demo after insert on sm_change_outages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_outages_demo_t after update or delete on sm_change_outages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_outages enable row level security;

-- change_pir: بازبینی‌های پس از اجرا
do $cols$
begin
  if to_regclass('sm_change_pirs') is not null then
    alter table sm_change_pirs add column if not exists workspace_id uuid;
    alter table sm_change_pirs add column if not exists domain_id uuid;
    alter table sm_change_pirs add column if not exists unit_id uuid;
    alter table sm_change_pirs add column if not exists created_at timestamptz not null default now();
    alter table sm_change_pirs add column if not exists created_by uuid;
    alter table sm_change_pirs add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_pirs add column if not exists updated_by uuid;
    alter table sm_change_pirs add column if not exists rev bigint not null default 0;
    alter table sm_change_pirs add column if not exists version integer not null default 1;
    alter table sm_change_pirs add column if not exists deleted_at timestamptz;
    alter table sm_change_pirs add column if not exists origin text;
    alter table sm_change_pirs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_pirs add column if not exists no integer;
    alter table sm_change_pirs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CPIR' || no::text else 'CPIR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_change_pirs add column if not exists title text;
    alter table sm_change_pirs add column if not exists change_id uuid;
    alter table sm_change_pirs add column if not exists reason text;
    alter table sm_change_pirs add column if not exists owner_id uuid;
    alter table sm_change_pirs add column if not exists assignment_group_id uuid;
    alter table sm_change_pirs add column if not exists due_at timestamptz;
    alter table sm_change_pirs add column if not exists completed_at timestamptz;
    alter table sm_change_pirs add column if not exists objectives_met text;
    alter table sm_change_pirs add column if not exists plan_accuracy integer;
    alter table sm_change_pirs add column if not exists incidents_caused integer;
    alter table sm_change_pirs add column if not exists side_effects text;
    alter table sm_change_pirs add column if not exists timeline_md text;
    alter table sm_change_pirs add column if not exists went_well text;
    alter table sm_change_pirs add column if not exists went_wrong text;
    alter table sm_change_pirs add column if not exists lessons text;
    alter table sm_change_pirs add column if not exists follow_up text;
    alter table sm_change_pirs add column if not exists watch_list jsonb;
    alter table sm_change_pirs add column if not exists confidential boolean not null default false;
    alter table sm_change_pirs add column if not exists access_list jsonb;
    alter table sm_change_pirs add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_change_pirs (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CPIR' || no::text else 'CPIR' || lpad(no::text, 5, '0') end) stored,
  title text,
  change_id uuid,
  reason text,
  owner_id uuid,
  assignment_group_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  objectives_met text,
  plan_accuracy integer,
  incidents_caused integer,
  side_effects text,
  timeline_md text,
  went_well text,
  went_wrong text,
  lessons text,
  follow_up text,
  watch_list jsonb,
  confidential boolean not null default false,
  access_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_pirs' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_pirs', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_pirs', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_pirs' and indexname like 'sm\_change\_pirs\_search\_%' and indexname not in ('sm_change_pirs_search_cae18f1d_trgm', 'sm_change_pirs_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_pirs_search_cae18f1d_trgm', 'sm_change_pirs', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_pirs_search_custom_trgm', 'sm_change_pirs', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_pirs_no_uk on sm_change_pirs (org_id, no);
create index if not exists sm_change_pirs_rev_idx on sm_change_pirs (org_id, rev);
create index if not exists sm_change_pirs_upd_idx on sm_change_pirs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_pirs_crt_idx on sm_change_pirs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_pirs_change_id_idx on sm_change_pirs (org_id, change_id) where deleted_at is null;
create index if not exists sm_change_pirs_owner_id_idx on sm_change_pirs (org_id, owner_id) where deleted_at is null;
create index if not exists sm_change_pirs_assignment_group_id_idx on sm_change_pirs (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_pirs_state_idx on sm_change_pirs (org_id, state) where deleted_at is null;
create index if not exists sm_change_pirs_workspace_acc_idx on sm_change_pirs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_pirs_unit_acc_idx on sm_change_pirs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_pirs_domain_acc_idx on sm_change_pirs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_change_pirs_sync on sm_change_pirs;
create trigger sm_change_pirs_sync before insert or update on sm_change_pirs for each row execute function sm_sync_touch('change_pir');
create or replace trigger sm_change_pirs_demo after insert on sm_change_pirs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_pirs_demo_t after update or delete on sm_change_pirs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_pirs enable row level security;

-- change_request: تغییرها
do $cols$
begin
  if to_regclass('sm_change_requests') is not null then
    alter table sm_change_requests add column if not exists workspace_id uuid;
    alter table sm_change_requests add column if not exists domain_id uuid;
    alter table sm_change_requests add column if not exists unit_id uuid;
    alter table sm_change_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_change_requests add column if not exists created_by uuid;
    alter table sm_change_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_requests add column if not exists updated_by uuid;
    alter table sm_change_requests add column if not exists rev bigint not null default 0;
    alter table sm_change_requests add column if not exists version integer not null default 1;
    alter table sm_change_requests add column if not exists deleted_at timestamptz;
    alter table sm_change_requests add column if not exists origin text;
    alter table sm_change_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_requests add column if not exists no integer;
    alter table sm_change_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CHG' || no::text else 'CHG' || lpad(no::text, 7, '0') end) stored;
    alter table sm_change_requests add column if not exists short_description text;
    alter table sm_change_requests add column if not exists description text;
    alter table sm_change_requests add column if not exists state text;
    alter table sm_change_requests add column if not exists priority text;
    alter table sm_change_requests add column if not exists impact text;
    alter table sm_change_requests add column if not exists urgency text;
    alter table sm_change_requests add column if not exists category text;
    alter table sm_change_requests add column if not exists subcategory text;
    alter table sm_change_requests add column if not exists channel text;
    alter table sm_change_requests add column if not exists caller_id uuid;
    alter table sm_change_requests add column if not exists requested_for uuid;
    alter table sm_change_requests add column if not exists opened_by uuid;
    alter table sm_change_requests add column if not exists opened_at timestamptz;
    alter table sm_change_requests add column if not exists assignment_group_id uuid;
    alter table sm_change_requests add column if not exists assigned_to uuid;
    alter table sm_change_requests add column if not exists service_id uuid;
    alter table sm_change_requests add column if not exists offering_id uuid;
    alter table sm_change_requests add column if not exists ci_id uuid;
    alter table sm_change_requests add column if not exists location_id uuid;
    alter table sm_change_requests add column if not exists due_at timestamptz;
    alter table sm_change_requests add column if not exists resolved_at timestamptz;
    alter table sm_change_requests add column if not exists resolved_by uuid;
    alter table sm_change_requests add column if not exists closed_at timestamptz;
    alter table sm_change_requests add column if not exists closed_by uuid;
    alter table sm_change_requests add column if not exists close_code text;
    alter table sm_change_requests add column if not exists close_notes text;
    alter table sm_change_requests add column if not exists parent_id uuid;
    alter table sm_change_requests add column if not exists watch_list jsonb;
    alter table sm_change_requests add column if not exists approval text;
    alter table sm_change_requests add column if not exists escalation integer;
    alter table sm_change_requests add column if not exists reassignment_count integer;
    alter table sm_change_requests add column if not exists reopen_count integer;
    alter table sm_change_requests add column if not exists time_worked bigint;
    alter table sm_change_requests add column if not exists first_response_at timestamptz;
    alter table sm_change_requests add column if not exists active boolean not null default true;
    alter table sm_change_requests add column if not exists sla_due timestamptz;
    alter table sm_change_requests add column if not exists knowledge boolean not null default false;
    alter table sm_change_requests add column if not exists type text;
    alter table sm_change_requests add column if not exists model_id uuid;
    alter table sm_change_requests add column if not exists template_id uuid;
    alter table sm_change_requests add column if not exists justification text;
    alter table sm_change_requests add column if not exists expected_outcome text;
    alter table sm_change_requests add column if not exists status_reason text;
    alter table sm_change_requests add column if not exists change_owner_id uuid;
    alter table sm_change_requests add column if not exists change_manager_id uuid;
    alter table sm_change_requests add column if not exists stakeholders jsonb;
    alter table sm_change_requests add column if not exists external_ref text;
    alter table sm_change_requests add column if not exists on_hold boolean not null default false;
    alter table sm_change_requests add column if not exists on_hold_reason text;
    alter table sm_change_requests add column if not exists on_hold_since timestamptz;
    alter table sm_change_requests add column if not exists affected_cis jsonb;
    alter table sm_change_requests add column if not exists affected_services jsonb;
    alter table sm_change_requests add column if not exists impacted_services jsonb;
    alter table sm_change_requests add column if not exists outage_expected boolean not null default false;
    alter table sm_change_requests add column if not exists outage_minutes integer;
    alter table sm_change_requests add column if not exists planned_start timestamptz;
    alter table sm_change_requests add column if not exists planned_end timestamptz;
    alter table sm_change_requests add column if not exists maintenance_window_id uuid;
    alter table sm_change_requests add column if not exists actual_start timestamptz;
    alter table sm_change_requests add column if not exists actual_end timestamptz;
    alter table sm_change_requests add column if not exists duration_actual bigint;
    alter table sm_change_requests add column if not exists is_late boolean not null default false;
    alter table sm_change_requests add column if not exists lead_days integer;
    alter table sm_change_requests add column if not exists in_blackout boolean not null default false;
    alter table sm_change_requests add column if not exists outside_window boolean not null default false;
    alter table sm_change_requests add column if not exists blackout_override_reason text;
    alter table sm_change_requests add column if not exists conflict_status text;
    alter table sm_change_requests add column if not exists conflict_count integer;
    alter table sm_change_requests add column if not exists conflict_checked_at timestamptz;
    alter table sm_change_requests add column if not exists exclude_conflicts boolean not null default false;
    alter table sm_change_requests add column if not exists lockdown_id uuid;
    alter table sm_change_requests add column if not exists window_alerted_at timestamptz;
    alter table sm_change_requests add column if not exists overrun_alerted_at timestamptz;
    alter table sm_change_requests add column if not exists implementation_plan text;
    alter table sm_change_requests add column if not exists test_plan text;
    alter table sm_change_requests add column if not exists test_results text;
    alter table sm_change_requests add column if not exists backout_plan text;
    alter table sm_change_requests add column if not exists backout_tested boolean not null default false;
    alter table sm_change_requests add column if not exists communication_plan text;
    alter table sm_change_requests add column if not exists planned_effort numeric;
    alter table sm_change_requests add column if not exists planned_cost numeric;
    alter table sm_change_requests add column if not exists risk text;
    alter table sm_change_requests add column if not exists risk_score integer;
    alter table sm_change_requests add column if not exists risk_calculated text;
    alter table sm_change_requests add column if not exists risk_source text;
    alter table sm_change_requests add column if not exists risk_override_reason text;
    alter table sm_change_requests add column if not exists risk_answers jsonb;
    alter table sm_change_requests add column if not exists risk_factors jsonb;
    alter table sm_change_requests add column if not exists risk_explanation text;
    alter table sm_change_requests add column if not exists risk_assessed_at timestamptz;
    alter table sm_change_requests add column if not exists cab_required boolean not null default false;
    alter table sm_change_requests add column if not exists cab_id uuid;
    alter table sm_change_requests add column if not exists cab_meeting_id uuid;
    alter table sm_change_requests add column if not exists cab_recommendation text;
    alter table sm_change_requests add column if not exists submitted_at timestamptz;
    alter table sm_change_requests add column if not exists auth_cycle_at timestamptz;
    alter table sm_change_requests add column if not exists authorized_at timestamptz;
    alter table sm_change_requests add column if not exists requester_confirmed boolean not null default false;
    alter table sm_change_requests add column if not exists implementation_rating integer;
    alter table sm_change_requests add column if not exists lessons text;
    alter table sm_change_requests add column if not exists pir_required boolean not null default false;
    alter table sm_change_requests add column if not exists pir_id uuid;
    alter table sm_change_requests add column if not exists incidents_caused integer;
    alter table sm_change_requests add column if not exists retrospective boolean not null default false;
    alter table sm_change_requests add column if not exists discovered_by text;
    alter table sm_change_requests add column if not exists origin_table text;
    alter table sm_change_requests add column if not exists origin_id text;
    alter table sm_change_requests add column if not exists model_states jsonb;
    alter table sm_change_requests add column if not exists confidential boolean not null default false;
    alter table sm_change_requests add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_change_requests (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CHG' || no::text else 'CHG' || lpad(no::text, 7, '0') end) stored,
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
  type text,
  model_id uuid,
  template_id uuid,
  justification text,
  expected_outcome text,
  status_reason text,
  change_owner_id uuid,
  change_manager_id uuid,
  stakeholders jsonb,
  external_ref text,
  on_hold boolean not null default false,
  on_hold_reason text,
  on_hold_since timestamptz,
  affected_cis jsonb,
  affected_services jsonb,
  impacted_services jsonb,
  outage_expected boolean not null default false,
  outage_minutes integer,
  planned_start timestamptz,
  planned_end timestamptz,
  maintenance_window_id uuid,
  actual_start timestamptz,
  actual_end timestamptz,
  duration_actual bigint,
  is_late boolean not null default false,
  lead_days integer,
  in_blackout boolean not null default false,
  outside_window boolean not null default false,
  blackout_override_reason text,
  conflict_status text,
  conflict_count integer,
  conflict_checked_at timestamptz,
  exclude_conflicts boolean not null default false,
  lockdown_id uuid,
  window_alerted_at timestamptz,
  overrun_alerted_at timestamptz,
  implementation_plan text,
  test_plan text,
  test_results text,
  backout_plan text,
  backout_tested boolean not null default false,
  communication_plan text,
  planned_effort numeric,
  planned_cost numeric,
  risk text,
  risk_score integer,
  risk_calculated text,
  risk_source text,
  risk_override_reason text,
  risk_answers jsonb,
  risk_factors jsonb,
  risk_explanation text,
  risk_assessed_at timestamptz,
  cab_required boolean not null default false,
  cab_id uuid,
  cab_meeting_id uuid,
  cab_recommendation text,
  submitted_at timestamptz,
  auth_cycle_at timestamptz,
  authorized_at timestamptz,
  requester_confirmed boolean not null default false,
  implementation_rating integer,
  lessons text,
  pir_required boolean not null default false,
  pir_id uuid,
  incidents_caused integer,
  retrospective boolean not null default false,
  discovered_by text,
  origin_table text,
  origin_id text,
  model_states jsonb,
  confidential boolean not null default false,
  access_list jsonb,
  search_1f830243 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(justification, '') || ' ' || coalesce(external_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_requests' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_1f830243' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_requests', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_requests', 'search_1f830243', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(justification, '') || ' ' || coalesce(external_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_requests' and indexname like 'sm\_change\_requests\_search\_%' and indexname not in ('sm_change_requests_search_1f830243_trgm', 'sm_change_requests_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_requests_search_1f830243_trgm', 'sm_change_requests', 'search_1f830243', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_requests_search_custom_trgm', 'sm_change_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_requests_no_uk on sm_change_requests (org_id, no);
create index if not exists sm_change_requests_rev_idx on sm_change_requests (org_id, rev);
create index if not exists sm_change_requests_upd_idx on sm_change_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_requests_crt_idx on sm_change_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_requests_state_idx on sm_change_requests (org_id, state) where deleted_at is null;
create index if not exists sm_change_requests_assignment_group_id_idx on sm_change_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_requests_assigned_to_idx on sm_change_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_requests_parent_id_idx on sm_change_requests (org_id, parent_id) where deleted_at is null;
create index if not exists sm_change_requests_type_idx on sm_change_requests (org_id, type) where deleted_at is null;
create index if not exists sm_change_requests_change_owner_id_idx on sm_change_requests (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_requests_change_manager_id_idx on sm_change_requests (org_id, change_manager_id) where deleted_at is null;
create index if not exists sm_change_requests_planned_start_idx on sm_change_requests (org_id, planned_start) where deleted_at is null;
create index if not exists sm_change_requests_planned_end_idx on sm_change_requests (org_id, planned_end) where deleted_at is null;
create index if not exists sm_change_requests_risk_idx on sm_change_requests (org_id, risk) where deleted_at is null;
create index if not exists sm_change_requests_workspace_acc_idx on sm_change_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_requests_unit_acc_idx on sm_change_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_requests_domain_acc_idx on sm_change_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_requests_caller_id_idx on sm_change_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_change_requests_requested_for_idx on sm_change_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_change_requests_opened_by_idx on sm_change_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_change_requests_watch_list_gin on sm_change_requests using gin (watch_list);
create index if not exists sm_change_requests_open_grp_idx on sm_change_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_change_requests_opened_brin on sm_change_requests using brin (opened_at);
drop trigger if exists sm_change_requests_sync on sm_change_requests;
create trigger sm_change_requests_sync before insert or update on sm_change_requests for each row execute function sm_sync_touch('change_request');
create or replace trigger sm_change_requests_demo after insert on sm_change_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_requests_demo_t after update or delete on sm_change_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_requests enable row level security;

-- change_risk_question: پرسش‌های ارزیابی ریسک
do $cols$
begin
  if to_regclass('sm_change_risk_questions') is not null then
    alter table sm_change_risk_questions add column if not exists workspace_id uuid;
    alter table sm_change_risk_questions add column if not exists domain_id uuid;
    alter table sm_change_risk_questions add column if not exists unit_id uuid;
    alter table sm_change_risk_questions add column if not exists created_at timestamptz not null default now();
    alter table sm_change_risk_questions add column if not exists created_by uuid;
    alter table sm_change_risk_questions add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_risk_questions add column if not exists updated_by uuid;
    alter table sm_change_risk_questions add column if not exists rev bigint not null default 0;
    alter table sm_change_risk_questions add column if not exists version integer not null default 1;
    alter table sm_change_risk_questions add column if not exists deleted_at timestamptz;
    alter table sm_change_risk_questions add column if not exists origin text;
    alter table sm_change_risk_questions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_risk_questions add column if not exists question text;
    alter table sm_change_risk_questions add column if not exists kind text;
    alter table sm_change_risk_questions add column if not exists weight integer;
    alter table sm_change_risk_questions add column if not exists sort_order integer;
    alter table sm_change_risk_questions add column if not exists options jsonb;
    alter table sm_change_risk_questions add column if not exists change_types jsonb;
    alter table sm_change_risk_questions add column if not exists condition jsonb;
    alter table sm_change_risk_questions add column if not exists mandatory boolean not null default true;
    alter table sm_change_risk_questions add column if not exists active boolean not null default true;
    alter table sm_change_risk_questions add column if not exists help text;
  end if;
end
$cols$;
create table if not exists sm_change_risk_questions (
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
  question text,
  kind text,
  weight integer,
  sort_order integer,
  options jsonb,
  change_types jsonb,
  condition jsonb,
  mandatory boolean not null default true,
  active boolean not null default true,
  help text
);
create index if not exists sm_change_risk_questions_rev_idx on sm_change_risk_questions (org_id, rev);
create index if not exists sm_change_risk_questions_upd_idx on sm_change_risk_questions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_risk_questions_crt_idx on sm_change_risk_questions (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_change_risk_questions_sync on sm_change_risk_questions;
create trigger sm_change_risk_questions_sync before insert or update on sm_change_risk_questions for each row execute function sm_sync_touch('change_risk_question');
create or replace trigger sm_change_risk_questions_demo after insert on sm_change_risk_questions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_risk_questions_demo_t after update or delete on sm_change_risk_questions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_risk_questions enable row level security;

-- change_success_score: امتیازهای موفقیت تیم‌ها
do $cols$
begin
  if to_regclass('sm_change_success_scores') is not null then
    alter table sm_change_success_scores add column if not exists workspace_id uuid;
    alter table sm_change_success_scores add column if not exists domain_id uuid;
    alter table sm_change_success_scores add column if not exists unit_id uuid;
    alter table sm_change_success_scores add column if not exists created_at timestamptz not null default now();
    alter table sm_change_success_scores add column if not exists created_by uuid;
    alter table sm_change_success_scores add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_success_scores add column if not exists updated_by uuid;
    alter table sm_change_success_scores add column if not exists rev bigint not null default 0;
    alter table sm_change_success_scores add column if not exists version integer not null default 1;
    alter table sm_change_success_scores add column if not exists deleted_at timestamptz;
    alter table sm_change_success_scores add column if not exists origin text;
    alter table sm_change_success_scores add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_success_scores add column if not exists title text;
    alter table sm_change_success_scores add column if not exists group_id uuid;
    alter table sm_change_success_scores add column if not exists score integer;
    alter table sm_change_success_scores add column if not exists band text;
    alter table sm_change_success_scores add column if not exists implemented integer;
    alter table sm_change_success_scores add column if not exists successful integer;
    alter table sm_change_success_scores add column if not exists with_issues integer;
    alter table sm_change_success_scores add column if not exists failed integer;
    alter table sm_change_success_scores add column if not exists caused_incidents integer;
    alter table sm_change_success_scores add column if not exists emergency integer;
    alter table sm_change_success_scores add column if not exists computed_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_change_success_scores (
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
  group_id uuid,
  score integer,
  band text,
  implemented integer,
  successful integer,
  with_issues integer,
  failed integer,
  caused_incidents integer,
  emergency integer,
  computed_at timestamptz
);
create index if not exists sm_change_success_scores_rev_idx on sm_change_success_scores (org_id, rev);
create index if not exists sm_change_success_scores_upd_idx on sm_change_success_scores (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_success_scores_crt_idx on sm_change_success_scores (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_change_success_scores_group_id_uk on sm_change_success_scores (org_id, group_id) where deleted_at is null;
drop trigger if exists sm_change_success_scores_sync on sm_change_success_scores;
create trigger sm_change_success_scores_sync before insert or update on sm_change_success_scores for each row execute function sm_sync_touch('change_success_score');
create or replace trigger sm_change_success_scores_demo after insert on sm_change_success_scores for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_success_scores_demo_t after update or delete on sm_change_success_scores for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_success_scores enable row level security;

-- change_task: کارهای تغییر
do $cols$
begin
  if to_regclass('sm_change_tasks') is not null then
    alter table sm_change_tasks add column if not exists workspace_id uuid;
    alter table sm_change_tasks add column if not exists domain_id uuid;
    alter table sm_change_tasks add column if not exists unit_id uuid;
    alter table sm_change_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_change_tasks add column if not exists created_by uuid;
    alter table sm_change_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_tasks add column if not exists updated_by uuid;
    alter table sm_change_tasks add column if not exists rev bigint not null default 0;
    alter table sm_change_tasks add column if not exists version integer not null default 1;
    alter table sm_change_tasks add column if not exists deleted_at timestamptz;
    alter table sm_change_tasks add column if not exists origin text;
    alter table sm_change_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_tasks add column if not exists no integer;
    alter table sm_change_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CTASK' || no::text else 'CTASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_change_tasks add column if not exists short_description text;
    alter table sm_change_tasks add column if not exists description text;
    alter table sm_change_tasks add column if not exists state text;
    alter table sm_change_tasks add column if not exists priority text;
    alter table sm_change_tasks add column if not exists impact text;
    alter table sm_change_tasks add column if not exists urgency text;
    alter table sm_change_tasks add column if not exists category text;
    alter table sm_change_tasks add column if not exists subcategory text;
    alter table sm_change_tasks add column if not exists channel text;
    alter table sm_change_tasks add column if not exists caller_id uuid;
    alter table sm_change_tasks add column if not exists requested_for uuid;
    alter table sm_change_tasks add column if not exists opened_by uuid;
    alter table sm_change_tasks add column if not exists opened_at timestamptz;
    alter table sm_change_tasks add column if not exists assignment_group_id uuid;
    alter table sm_change_tasks add column if not exists assigned_to uuid;
    alter table sm_change_tasks add column if not exists service_id uuid;
    alter table sm_change_tasks add column if not exists offering_id uuid;
    alter table sm_change_tasks add column if not exists ci_id uuid;
    alter table sm_change_tasks add column if not exists location_id uuid;
    alter table sm_change_tasks add column if not exists due_at timestamptz;
    alter table sm_change_tasks add column if not exists resolved_at timestamptz;
    alter table sm_change_tasks add column if not exists resolved_by uuid;
    alter table sm_change_tasks add column if not exists closed_at timestamptz;
    alter table sm_change_tasks add column if not exists closed_by uuid;
    alter table sm_change_tasks add column if not exists close_code text;
    alter table sm_change_tasks add column if not exists close_notes text;
    alter table sm_change_tasks add column if not exists parent_id uuid;
    alter table sm_change_tasks add column if not exists watch_list jsonb;
    alter table sm_change_tasks add column if not exists approval text;
    alter table sm_change_tasks add column if not exists escalation integer;
    alter table sm_change_tasks add column if not exists reassignment_count integer;
    alter table sm_change_tasks add column if not exists reopen_count integer;
    alter table sm_change_tasks add column if not exists time_worked bigint;
    alter table sm_change_tasks add column if not exists first_response_at timestamptz;
    alter table sm_change_tasks add column if not exists active boolean not null default true;
    alter table sm_change_tasks add column if not exists sla_due timestamptz;
    alter table sm_change_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_change_tasks add column if not exists change_id uuid;
    alter table sm_change_tasks add column if not exists task_type text;
    alter table sm_change_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_change_tasks add column if not exists sort_order integer;
    alter table sm_change_tasks add column if not exists depends_on jsonb;
    alter table sm_change_tasks add column if not exists planned_start timestamptz;
    alter table sm_change_tasks add column if not exists planned_end timestamptz;
    alter table sm_change_tasks add column if not exists actual_start timestamptz;
    alter table sm_change_tasks add column if not exists actual_end timestamptz;
    alter table sm_change_tasks add column if not exists checklist text;
    alter table sm_change_tasks add column if not exists change_owner_id uuid;
    alter table sm_change_tasks add column if not exists confidential boolean not null default false;
    alter table sm_change_tasks add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_change_tasks (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CTASK' || no::text else 'CTASK' || lpad(no::text, 7, '0') end) stored,
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
  change_id uuid,
  task_type text,
  mandatory boolean not null default true,
  sort_order integer,
  depends_on jsonb,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  checklist text,
  change_owner_id uuid,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_tasks' and indexname like 'sm\_change\_tasks\_search\_%' and indexname not in ('sm_change_tasks_search_f3bce210_trgm', 'sm_change_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_tasks_search_f3bce210_trgm', 'sm_change_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_tasks_search_custom_trgm', 'sm_change_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_tasks_no_uk on sm_change_tasks (org_id, no);
create index if not exists sm_change_tasks_rev_idx on sm_change_tasks (org_id, rev);
create index if not exists sm_change_tasks_upd_idx on sm_change_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_tasks_crt_idx on sm_change_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_tasks_state_idx on sm_change_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_change_tasks_assignment_group_id_idx on sm_change_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_tasks_assigned_to_idx on sm_change_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_tasks_change_id_idx on sm_change_tasks (org_id, change_id) where deleted_at is null;
create index if not exists sm_change_tasks_workspace_acc_idx on sm_change_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_tasks_unit_acc_idx on sm_change_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_tasks_domain_acc_idx on sm_change_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_tasks_caller_id_idx on sm_change_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_change_tasks_requested_for_idx on sm_change_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_change_tasks_opened_by_idx on sm_change_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_change_tasks_change_owner_id_idx on sm_change_tasks (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_tasks_watch_list_gin on sm_change_tasks using gin (watch_list);
create index if not exists sm_change_tasks_open_grp_idx on sm_change_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_change_tasks_opened_brin on sm_change_tasks using brin (opened_at);
drop trigger if exists sm_change_tasks_sync on sm_change_tasks;
create trigger sm_change_tasks_sync before insert or update on sm_change_tasks for each row execute function sm_sync_touch('change_task');
create or replace trigger sm_change_tasks_demo after insert on sm_change_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_tasks_demo_t after update or delete on sm_change_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_tasks enable row level security;

-- change_template: الگوها و تغییرهای استاندارد
do $cols$
begin
  if to_regclass('sm_change_templates') is not null then
    alter table sm_change_templates add column if not exists workspace_id uuid;
    alter table sm_change_templates add column if not exists domain_id uuid;
    alter table sm_change_templates add column if not exists unit_id uuid;
    alter table sm_change_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_change_templates add column if not exists created_by uuid;
    alter table sm_change_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_templates add column if not exists updated_by uuid;
    alter table sm_change_templates add column if not exists rev bigint not null default 0;
    alter table sm_change_templates add column if not exists version integer not null default 1;
    alter table sm_change_templates add column if not exists deleted_at timestamptz;
    alter table sm_change_templates add column if not exists origin text;
    alter table sm_change_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_templates add column if not exists no integer;
    alter table sm_change_templates add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CHGT' || no::text else 'CHGT' || lpad(no::text, 5, '0') end) stored;
    alter table sm_change_templates add column if not exists name text;
    alter table sm_change_templates add column if not exists kind text;
    alter table sm_change_templates add column if not exists category text;
    alter table sm_change_templates add column if not exists model_id uuid;
    alter table sm_change_templates add column if not exists owner_id uuid;
    alter table sm_change_templates add column if not exists authoring_group_id uuid;
    alter table sm_change_templates add column if not exists review_date date;
    alter table sm_change_templates add column if not exists max_duration bigint;
    alter table sm_change_templates add column if not exists short_description text;
    alter table sm_change_templates add column if not exists description text;
    alter table sm_change_templates add column if not exists justification text;
    alter table sm_change_templates add column if not exists implementation_plan text;
    alter table sm_change_templates add column if not exists test_plan text;
    alter table sm_change_templates add column if not exists backout_plan text;
    alter table sm_change_templates add column if not exists communication_plan text;
    alter table sm_change_templates add column if not exists risk text;
    alter table sm_change_templates add column if not exists impact text;
    alter table sm_change_templates add column if not exists assignment_group_id uuid;
    alter table sm_change_templates add column if not exists service_id uuid;
    alter table sm_change_templates add column if not exists services jsonb;
    alter table sm_change_templates add column if not exists ci_classes jsonb;
    alter table sm_change_templates add column if not exists tasks jsonb;
    alter table sm_change_templates add column if not exists usage_count integer;
    alter table sm_change_templates add column if not exists success_count integer;
    alter table sm_change_templates add column if not exists failure_count integer;
    alter table sm_change_templates add column if not exists last_used_at timestamptz;
    alter table sm_change_templates add column if not exists revision integer;
    alter table sm_change_templates add column if not exists published_at timestamptz;
    alter table sm_change_templates add column if not exists published_by uuid;
    alter table sm_change_templates add column if not exists approval text;
    alter table sm_change_templates add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_change_templates (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CHGT' || no::text else 'CHGT' || lpad(no::text, 5, '0') end) stored,
  name text,
  kind text,
  category text,
  model_id uuid,
  owner_id uuid,
  authoring_group_id uuid,
  review_date date,
  max_duration bigint,
  short_description text,
  description text,
  justification text,
  implementation_plan text,
  test_plan text,
  backout_plan text,
  communication_plan text,
  risk text,
  impact text,
  assignment_group_id uuid,
  service_id uuid,
  services jsonb,
  ci_classes jsonb,
  tasks jsonb,
  usage_count integer,
  success_count integer,
  failure_count integer,
  last_used_at timestamptz,
  revision integer,
  published_at timestamptz,
  published_by uuid,
  approval text,
  state text,
  search_1af384f7 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_templates' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_1af384f7' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_templates', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_templates', 'search_1af384f7', $x$translate(coalesce(name, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_templates' and indexname like 'sm\_change\_templates\_search\_%' and indexname not in ('sm_change_templates_search_1af384f7_trgm', 'sm_change_templates_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_templates_search_1af384f7_trgm', 'sm_change_templates', 'search_1af384f7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_templates_search_custom_trgm', 'sm_change_templates', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_templates_no_uk on sm_change_templates (org_id, no);
create index if not exists sm_change_templates_rev_idx on sm_change_templates (org_id, rev);
create index if not exists sm_change_templates_upd_idx on sm_change_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_templates_crt_idx on sm_change_templates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_templates_state_idx on sm_change_templates (org_id, state) where deleted_at is null;
create index if not exists sm_change_templates_workspace_acc_idx on sm_change_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_templates_unit_acc_idx on sm_change_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_templates_domain_acc_idx on sm_change_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_templates_owner_id_idx on sm_change_templates (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_change_templates_sync on sm_change_templates;
create trigger sm_change_templates_sync before insert or update on sm_change_templates for each row execute function sm_sync_touch('change_template');
create or replace trigger sm_change_templates_demo after insert on sm_change_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_templates_demo_t after update or delete on sm_change_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_templates enable row level security;

-- change_window: پنجره‌های زمانی
do $cols$
begin
  if to_regclass('sm_change_windows') is not null then
    alter table sm_change_windows add column if not exists workspace_id uuid;
    alter table sm_change_windows add column if not exists domain_id uuid;
    alter table sm_change_windows add column if not exists unit_id uuid;
    alter table sm_change_windows add column if not exists created_at timestamptz not null default now();
    alter table sm_change_windows add column if not exists created_by uuid;
    alter table sm_change_windows add column if not exists updated_at timestamptz not null default now();
    alter table sm_change_windows add column if not exists updated_by uuid;
    alter table sm_change_windows add column if not exists rev bigint not null default 0;
    alter table sm_change_windows add column if not exists version integer not null default 1;
    alter table sm_change_windows add column if not exists deleted_at timestamptz;
    alter table sm_change_windows add column if not exists origin text;
    alter table sm_change_windows add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_change_windows add column if not exists no integer;
    alter table sm_change_windows add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'WIN' || no::text else 'WIN' || lpad(no::text, 4, '0') end) stored;
    alter table sm_change_windows add column if not exists name text;
    alter table sm_change_windows add column if not exists kind text;
    alter table sm_change_windows add column if not exists active boolean not null default true;
    alter table sm_change_windows add column if not exists start_at timestamptz;
    alter table sm_change_windows add column if not exists end_at timestamptz;
    alter table sm_change_windows add column if not exists enforcement text;
    alter table sm_change_windows add column if not exists recurrence text;
    alter table sm_change_windows add column if not exists weekdays jsonb;
    alter table sm_change_windows add column if not exists until date;
    alter table sm_change_windows add column if not exists exempt_emergency boolean not null default true;
    alter table sm_change_windows add column if not exists change_types jsonb;
    alter table sm_change_windows add column if not exists services jsonb;
    alter table sm_change_windows add column if not exists cis jsonb;
    alter table sm_change_windows add column if not exists scope_condition jsonb;
    alter table sm_change_windows add column if not exists owner_group_id uuid;
    alter table sm_change_windows add column if not exists source text;
    alter table sm_change_windows add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_change_windows (
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
  number text generated always as (case when no is null then null when length(no::text) >= 4 then 'WIN' || no::text else 'WIN' || lpad(no::text, 4, '0') end) stored,
  name text,
  kind text,
  active boolean not null default true,
  start_at timestamptz,
  end_at timestamptz,
  enforcement text,
  recurrence text,
  weekdays jsonb,
  until date,
  exempt_emergency boolean not null default true,
  change_types jsonb,
  services jsonb,
  cis jsonb,
  scope_condition jsonb,
  owner_group_id uuid,
  source text,
  description text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_windows' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_windows', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_change_windows', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_change_windows' and indexname like 'sm\_change\_windows\_search\_%' and indexname not in ('sm_change_windows_search_56291d9d_trgm', 'sm_change_windows_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_windows_search_56291d9d_trgm', 'sm_change_windows', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_change_windows_search_custom_trgm', 'sm_change_windows', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_change_windows_no_uk on sm_change_windows (org_id, no);
create index if not exists sm_change_windows_rev_idx on sm_change_windows (org_id, rev);
create index if not exists sm_change_windows_upd_idx on sm_change_windows (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_windows_crt_idx on sm_change_windows (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_windows_workspace_acc_idx on sm_change_windows (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_windows_unit_acc_idx on sm_change_windows (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_windows_domain_acc_idx on sm_change_windows (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_windows_open_grp_idx on sm_change_windows (org_id, owner_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_change_windows_sync on sm_change_windows;
create trigger sm_change_windows_sync before insert or update on sm_change_windows for each row execute function sm_sync_touch('change_window');
create or replace trigger sm_change_windows_demo after insert on sm_change_windows for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_change_windows_demo_t after update or delete on sm_change_windows for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_change_windows enable row level security;

-- choice: فهرست‌های گزینه
do $cols$
begin
  if to_regclass('sm_choices') is not null then
    alter table sm_choices add column if not exists workspace_id uuid;
    alter table sm_choices add column if not exists domain_id uuid;
    alter table sm_choices add column if not exists unit_id uuid;
    alter table sm_choices add column if not exists created_at timestamptz not null default now();
    alter table sm_choices add column if not exists created_by uuid;
    alter table sm_choices add column if not exists updated_at timestamptz not null default now();
    alter table sm_choices add column if not exists updated_by uuid;
    alter table sm_choices add column if not exists rev bigint not null default 0;
    alter table sm_choices add column if not exists version integer not null default 1;
    alter table sm_choices add column if not exists deleted_at timestamptz;
    alter table sm_choices add column if not exists origin text;
    alter table sm_choices add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_choices add column if not exists list text;
    alter table sm_choices add column if not exists value text;
    alter table sm_choices add column if not exists label text;
    alter table sm_choices add column if not exists color text;
    alter table sm_choices add column if not exists sort_order integer;
    alter table sm_choices add column if not exists parent text;
    alter table sm_choices add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_choices (
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
  list text,
  value text,
  label text,
  color text,
  sort_order integer,
  parent text,
  active boolean not null default true
);
create index if not exists sm_choices_rev_idx on sm_choices (org_id, rev);
create index if not exists sm_choices_upd_idx on sm_choices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_choices_crt_idx on sm_choices (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_choices_list_value_uk on sm_choices (org_id, list, value) where deleted_at is null;
drop trigger if exists sm_choices_sync on sm_choices;
create trigger sm_choices_sync before insert or update on sm_choices for each row execute function sm_sync_touch('choice');
create or replace trigger sm_choices_demo after insert on sm_choices for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_choices_demo_t after update or delete on sm_choices for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_choices enable row level security;

-- ci: پیکربندی‌ها
do $cols$
begin
  if to_regclass('sm_cis') is not null then
    alter table sm_cis add column if not exists workspace_id uuid;
    alter table sm_cis add column if not exists domain_id uuid;
    alter table sm_cis add column if not exists unit_id uuid;
    alter table sm_cis add column if not exists created_at timestamptz not null default now();
    alter table sm_cis add column if not exists created_by uuid;
    alter table sm_cis add column if not exists updated_at timestamptz not null default now();
    alter table sm_cis add column if not exists updated_by uuid;
    alter table sm_cis add column if not exists rev bigint not null default 0;
    alter table sm_cis add column if not exists version integer not null default 1;
    alter table sm_cis add column if not exists deleted_at timestamptz;
    alter table sm_cis add column if not exists origin text;
    alter table sm_cis add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cis add column if not exists no integer;
    alter table sm_cis add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CI' || no::text else 'CI' || lpad(no::text, 7, '0') end) stored;
    alter table sm_cis add column if not exists name text;
    alter table sm_cis add column if not exists class text;
    alter table sm_cis add column if not exists description text;
    alter table sm_cis add column if not exists environment text;
    alter table sm_cis add column if not exists criticality text;
    alter table sm_cis add column if not exists tier text;
    alter table sm_cis add column if not exists operational_status text;
    alter table sm_cis add column if not exists install_status text;
    alter table sm_cis add column if not exists tags jsonb;
    alter table sm_cis add column if not exists owned_by uuid;
    alter table sm_cis add column if not exists managed_by uuid;
    alter table sm_cis add column if not exists used_by uuid;
    alter table sm_cis add column if not exists support_group_id uuid;
    alter table sm_cis add column if not exists managed_by_group_id uuid;
    alter table sm_cis add column if not exists change_approval_group_id uuid;
    alter table sm_cis add column if not exists company_id uuid;
    alter table sm_cis add column if not exists location_id uuid;
    alter table sm_cis add column if not exists cost_center_id uuid;
    alter table sm_cis add column if not exists maintenance_calendar_id uuid;
    alter table sm_cis add column if not exists serial_number text;
    alter table sm_cis add column if not exists asset_tag text;
    alter table sm_cis add column if not exists manufacturer text;
    alter table sm_cis add column if not exists model_name text;
    alter table sm_cis add column if not exists hostname text;
    alter table sm_cis add column if not exists fqdn text;
    alter table sm_cis add column if not exists ip_address text;
    alter table sm_cis add column if not exists mac_address text;
    alter table sm_cis add column if not exists bios_uuid text;
    alter table sm_cis add column if not exists cloud_resource_id text;
    alter table sm_cis add column if not exists os text;
    alter table sm_cis add column if not exists os_version text;
    alter table sm_cis add column if not exists sw_version text;
    alter table sm_cis add column if not exists cpu_count integer;
    alter table sm_cis add column if not exists ram_mb integer;
    alter table sm_cis add column if not exists disk_gb integer;
    alter table sm_cis add column if not exists url text;
    alter table sm_cis add column if not exists expires_at date;
    alter table sm_cis add column if not exists eol_date date;
    alter table sm_cis add column if not exists attrs jsonb;
    alter table sm_cis add column if not exists change_id uuid;
    alter table sm_cis add column if not exists disposal_notes text;
    alter table sm_cis add column if not exists discovery_source_id uuid;
    alter table sm_cis add column if not exists first_discovered_at timestamptz;
    alter table sm_cis add column if not exists last_discovered_at timestamptz;
    alter table sm_cis add column if not exists is_stale boolean not null default false;
    alter table sm_cis add column if not exists health_score integer;
    alter table sm_cis add column if not exists health_issues jsonb;
    alter table sm_cis add column if not exists health jsonb;
    alter table sm_cis add column if not exists health_at timestamptz;
    alter table sm_cis add column if not exists locked_attrs jsonb;
    alter table sm_cis add column if not exists attr_meta jsonb;
    alter table sm_cis add column if not exists certified_at timestamptz;
    alter table sm_cis add column if not exists certified_by uuid;
    alter table sm_cis add column if not exists supports_critical_function boolean not null default false;
    alter table sm_cis add column if not exists max_criticality text;
    alter table sm_cis add column if not exists merged_into uuid;
    alter table sm_cis add column if not exists watch_list jsonb;
    alter table sm_cis add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_cis (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CI' || no::text else 'CI' || lpad(no::text, 7, '0') end) stored,
  name text,
  class text,
  description text,
  environment text,
  criticality text,
  tier text,
  operational_status text,
  install_status text,
  tags jsonb,
  owned_by uuid,
  managed_by uuid,
  used_by uuid,
  support_group_id uuid,
  managed_by_group_id uuid,
  change_approval_group_id uuid,
  company_id uuid,
  location_id uuid,
  cost_center_id uuid,
  maintenance_calendar_id uuid,
  serial_number text,
  asset_tag text,
  manufacturer text,
  model_name text,
  hostname text,
  fqdn text,
  ip_address text,
  mac_address text,
  bios_uuid text,
  cloud_resource_id text,
  os text,
  os_version text,
  sw_version text,
  cpu_count integer,
  ram_mb integer,
  disk_gb integer,
  url text,
  expires_at date,
  eol_date date,
  attrs jsonb,
  change_id uuid,
  disposal_notes text,
  discovery_source_id uuid,
  first_discovered_at timestamptz,
  last_discovered_at timestamptz,
  is_stale boolean not null default false,
  health_score integer,
  health_issues jsonb,
  health jsonb,
  health_at timestamptz,
  locked_attrs jsonb,
  attr_meta jsonb,
  certified_at timestamptz,
  certified_by uuid,
  supports_critical_function boolean not null default false,
  max_criticality text,
  merged_into uuid,
  watch_list jsonb,
  state text,
  search_e2d43903 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(serial_number, '') || ' ' || coalesce(asset_tag, '') || ' ' || coalesce(hostname, '') || ' ' || coalesce(fqdn, '') || ' ' || coalesce(ip_address, '') || ' ' || coalesce(mac_address, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cis' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_e2d43903' loop
    execute format('alter table %I drop column if exists %I', 'sm_cis', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cis', 'search_e2d43903', $x$translate(coalesce(name, '') || ' ' || coalesce(serial_number, '') || ' ' || coalesce(asset_tag, '') || ' ' || coalesce(hostname, '') || ' ' || coalesce(fqdn, '') || ' ' || coalesce(ip_address, '') || ' ' || coalesce(mac_address, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_cis' and indexname like 'sm\_cis\_search\_%' and indexname not in ('sm_cis_search_e2d43903_trgm', 'sm_cis_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cis_search_e2d43903_trgm', 'sm_cis', 'search_e2d43903', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cis_search_custom_trgm', 'sm_cis', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_cis_no_uk on sm_cis (org_id, no);
create index if not exists sm_cis_rev_idx on sm_cis (org_id, rev);
create index if not exists sm_cis_upd_idx on sm_cis (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cis_crt_idx on sm_cis (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cis_class_idx on sm_cis (org_id, class) where deleted_at is null;
create index if not exists sm_cis_serial_number_idx on sm_cis (org_id, serial_number) where deleted_at is null;
create index if not exists sm_cis_asset_tag_idx on sm_cis (org_id, asset_tag) where deleted_at is null;
create index if not exists sm_cis_hostname_idx on sm_cis (org_id, hostname) where deleted_at is null;
create index if not exists sm_cis_fqdn_idx on sm_cis (org_id, fqdn) where deleted_at is null;
create index if not exists sm_cis_ip_address_idx on sm_cis (org_id, ip_address) where deleted_at is null;
create index if not exists sm_cis_mac_address_idx on sm_cis (org_id, mac_address) where deleted_at is null;
create index if not exists sm_cis_bios_uuid_idx on sm_cis (org_id, bios_uuid) where deleted_at is null;
create index if not exists sm_cis_cloud_resource_id_idx on sm_cis (org_id, cloud_resource_id) where deleted_at is null;
create index if not exists sm_cis_expires_at_idx on sm_cis (org_id, expires_at) where deleted_at is null;
create index if not exists sm_cis_state_idx on sm_cis (org_id, state) where deleted_at is null;
create index if not exists sm_cis_workspace_acc_idx on sm_cis (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cis_unit_acc_idx on sm_cis (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cis_domain_acc_idx on sm_cis (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cis_owned_by_idx on sm_cis (org_id, owned_by) where deleted_at is null;
create index if not exists sm_cis_managed_by_idx on sm_cis (org_id, managed_by) where deleted_at is null;
create index if not exists sm_cis_used_by_idx on sm_cis (org_id, used_by) where deleted_at is null;
create index if not exists sm_cis_watch_list_gin on sm_cis using gin (watch_list);
drop trigger if exists sm_cis_sync on sm_cis;
create trigger sm_cis_sync before insert or update on sm_cis for each row execute function sm_sync_touch('ci');
create or replace trigger sm_cis_demo after insert on sm_cis for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cis_demo_t after update or delete on sm_cis for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cis enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:4', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۶ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 6/30 (a0c3bc7de847)
-- ci_baseline: خط‌های مبنای پیکربندی
do $cols$
begin
  if to_regclass('sm_ci_baselines') is not null then
    alter table sm_ci_baselines add column if not exists workspace_id uuid;
    alter table sm_ci_baselines add column if not exists domain_id uuid;
    alter table sm_ci_baselines add column if not exists unit_id uuid;
    alter table sm_ci_baselines add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_baselines add column if not exists created_by uuid;
    alter table sm_ci_baselines add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_baselines add column if not exists updated_by uuid;
    alter table sm_ci_baselines add column if not exists rev bigint not null default 0;
    alter table sm_ci_baselines add column if not exists version integer not null default 1;
    alter table sm_ci_baselines add column if not exists deleted_at timestamptz;
    alter table sm_ci_baselines add column if not exists origin text;
    alter table sm_ci_baselines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_baselines add column if not exists no integer;
    alter table sm_ci_baselines add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BSL' || no::text else 'BSL' || lpad(no::text, 5, '0') end) stored;
    alter table sm_ci_baselines add column if not exists name text;
    alter table sm_ci_baselines add column if not exists kind text;
    alter table sm_ci_baselines add column if not exists scope_kind text;
    alter table sm_ci_baselines add column if not exists class text;
    alter table sm_ci_baselines add column if not exists group_id uuid;
    alter table sm_ci_baselines add column if not exists ci_ids jsonb;
    alter table sm_ci_baselines add column if not exists include_relations boolean not null default true;
    alter table sm_ci_baselines add column if not exists owner_id uuid;
    alter table sm_ci_baselines add column if not exists taken_at timestamptz;
    alter table sm_ci_baselines add column if not exists item_count integer;
    alter table sm_ci_baselines add column if not exists approved_by uuid;
    alter table sm_ci_baselines add column if not exists approved_at timestamptz;
    alter table sm_ci_baselines add column if not exists items jsonb;
    alter table sm_ci_baselines add column if not exists description text;
    alter table sm_ci_baselines add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_ci_baselines (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BSL' || no::text else 'BSL' || lpad(no::text, 5, '0') end) stored,
  name text,
  kind text,
  scope_kind text,
  class text,
  group_id uuid,
  ci_ids jsonb,
  include_relations boolean not null default true,
  owner_id uuid,
  taken_at timestamptz,
  item_count integer,
  approved_by uuid,
  approved_at timestamptz,
  items jsonb,
  description text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_baselines' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_ci_baselines', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_ci_baselines', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_ci_baselines' and indexname like 'sm\_ci\_baselines\_search\_%' and indexname not in ('sm_ci_baselines_search_56291d9d_trgm', 'sm_ci_baselines_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_ci_baselines_search_56291d9d_trgm', 'sm_ci_baselines', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_ci_baselines_search_custom_trgm', 'sm_ci_baselines', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_ci_baselines_no_uk on sm_ci_baselines (org_id, no);
create index if not exists sm_ci_baselines_rev_idx on sm_ci_baselines (org_id, rev);
create index if not exists sm_ci_baselines_upd_idx on sm_ci_baselines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_baselines_crt_idx on sm_ci_baselines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_baselines_state_idx on sm_ci_baselines (org_id, state) where deleted_at is null;
create index if not exists sm_ci_baselines_workspace_acc_idx on sm_ci_baselines (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_baselines_unit_acc_idx on sm_ci_baselines (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_baselines_domain_acc_idx on sm_ci_baselines (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_baselines_owner_id_idx on sm_ci_baselines (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_ci_baselines_sync on sm_ci_baselines;
create trigger sm_ci_baselines_sync before insert or update on sm_ci_baselines for each row execute function sm_sync_touch('ci_baseline');
create or replace trigger sm_ci_baselines_demo after insert on sm_ci_baselines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_baselines_demo_t after update or delete on sm_ci_baselines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_baselines enable row level security;

-- ci_cert_campaign: دوره‌های تأیید داده
do $cols$
begin
  if to_regclass('sm_ci_cert_campaigns') is not null then
    alter table sm_ci_cert_campaigns add column if not exists workspace_id uuid;
    alter table sm_ci_cert_campaigns add column if not exists domain_id uuid;
    alter table sm_ci_cert_campaigns add column if not exists unit_id uuid;
    alter table sm_ci_cert_campaigns add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_cert_campaigns add column if not exists created_by uuid;
    alter table sm_ci_cert_campaigns add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_cert_campaigns add column if not exists updated_by uuid;
    alter table sm_ci_cert_campaigns add column if not exists rev bigint not null default 0;
    alter table sm_ci_cert_campaigns add column if not exists version integer not null default 1;
    alter table sm_ci_cert_campaigns add column if not exists deleted_at timestamptz;
    alter table sm_ci_cert_campaigns add column if not exists origin text;
    alter table sm_ci_cert_campaigns add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_cert_campaigns add column if not exists no integer;
    alter table sm_ci_cert_campaigns add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRC' || no::text else 'CRC' || lpad(no::text, 5, '0') end) stored;
    alter table sm_ci_cert_campaigns add column if not exists name text;
    alter table sm_ci_cert_campaigns add column if not exists condition jsonb;
    alter table sm_ci_cert_campaigns add column if not exists fields_to_confirm jsonb;
    alter table sm_ci_cert_campaigns add column if not exists due_at timestamptz;
    alter table sm_ci_cert_campaigns add column if not exists owner_id uuid;
    alter table sm_ci_cert_campaigns add column if not exists task_count integer;
    alter table sm_ci_cert_campaigns add column if not exists done_count integer;
    alter table sm_ci_cert_campaigns add column if not exists description text;
    alter table sm_ci_cert_campaigns add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_ci_cert_campaigns (
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRC' || no::text else 'CRC' || lpad(no::text, 5, '0') end) stored,
  name text,
  condition jsonb,
  fields_to_confirm jsonb,
  due_at timestamptz,
  owner_id uuid,
  task_count integer,
  done_count integer,
  description text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_cert_campaigns' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_ci_cert_campaigns', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_ci_cert_campaigns', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_ci_cert_campaigns' and indexname like 'sm\_ci\_cert\_campaigns\_search\_%' and indexname not in ('sm_ci_cert_campaigns_search_56291d9d_trgm', 'sm_ci_cert_campaigns_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_ci_cert_campaigns_search_56291d9d_trgm', 'sm_ci_cert_campaigns', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_ci_cert_campaigns_search_custom_trgm', 'sm_ci_cert_campaigns', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_ci_cert_campaigns_no_uk on sm_ci_cert_campaigns (org_id, no);
create index if not exists sm_ci_cert_campaigns_rev_idx on sm_ci_cert_campaigns (org_id, rev);
create index if not exists sm_ci_cert_campaigns_upd_idx on sm_ci_cert_campaigns (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_campaigns_crt_idx on sm_ci_cert_campaigns (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_campaigns_state_idx on sm_ci_cert_campaigns (org_id, state) where deleted_at is null;
create index if not exists sm_ci_cert_campaigns_workspace_acc_idx on sm_ci_cert_campaigns (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_cert_campaigns_unit_acc_idx on sm_ci_cert_campaigns (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_cert_campaigns_domain_acc_idx on sm_ci_cert_campaigns (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_cert_campaigns_owner_id_idx on sm_ci_cert_campaigns (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_ci_cert_campaigns_sync on sm_ci_cert_campaigns;
create trigger sm_ci_cert_campaigns_sync before insert or update on sm_ci_cert_campaigns for each row execute function sm_sync_touch('ci_cert_campaign');
create or replace trigger sm_ci_cert_campaigns_demo after insert on sm_ci_cert_campaigns for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_cert_campaigns_demo_t after update or delete on sm_ci_cert_campaigns for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_cert_campaigns enable row level security;

-- ci_cert_task: تأییدهای دادهٔ پیکربندی
do $cols$
begin
  if to_regclass('sm_ci_cert_tasks') is not null then
    alter table sm_ci_cert_tasks add column if not exists workspace_id uuid;
    alter table sm_ci_cert_tasks add column if not exists domain_id uuid;
    alter table sm_ci_cert_tasks add column if not exists unit_id uuid;
    alter table sm_ci_cert_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_cert_tasks add column if not exists created_by uuid;
    alter table sm_ci_cert_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_cert_tasks add column if not exists updated_by uuid;
    alter table sm_ci_cert_tasks add column if not exists rev bigint not null default 0;
    alter table sm_ci_cert_tasks add column if not exists version integer not null default 1;
    alter table sm_ci_cert_tasks add column if not exists deleted_at timestamptz;
    alter table sm_ci_cert_tasks add column if not exists origin text;
    alter table sm_ci_cert_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_cert_tasks add column if not exists no integer;
    alter table sm_ci_cert_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CRT' || no::text else 'CRT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_ci_cert_tasks add column if not exists short_description text;
    alter table sm_ci_cert_tasks add column if not exists description text;
    alter table sm_ci_cert_tasks add column if not exists state text;
    alter table sm_ci_cert_tasks add column if not exists priority text;
    alter table sm_ci_cert_tasks add column if not exists impact text;
    alter table sm_ci_cert_tasks add column if not exists urgency text;
    alter table sm_ci_cert_tasks add column if not exists category text;
    alter table sm_ci_cert_tasks add column if not exists subcategory text;
    alter table sm_ci_cert_tasks add column if not exists channel text;
    alter table sm_ci_cert_tasks add column if not exists caller_id uuid;
    alter table sm_ci_cert_tasks add column if not exists requested_for uuid;
    alter table sm_ci_cert_tasks add column if not exists opened_by uuid;
    alter table sm_ci_cert_tasks add column if not exists opened_at timestamptz;
    alter table sm_ci_cert_tasks add column if not exists assignment_group_id uuid;
    alter table sm_ci_cert_tasks add column if not exists assigned_to uuid;
    alter table sm_ci_cert_tasks add column if not exists service_id uuid;
    alter table sm_ci_cert_tasks add column if not exists offering_id uuid;
    alter table sm_ci_cert_tasks add column if not exists ci_id uuid;
    alter table sm_ci_cert_tasks add column if not exists location_id uuid;
    alter table sm_ci_cert_tasks add column if not exists due_at timestamptz;
    alter table sm_ci_cert_tasks add column if not exists resolved_at timestamptz;
    alter table sm_ci_cert_tasks add column if not exists resolved_by uuid;
    alter table sm_ci_cert_tasks add column if not exists closed_at timestamptz;
    alter table sm_ci_cert_tasks add column if not exists closed_by uuid;
    alter table sm_ci_cert_tasks add column if not exists close_code text;
    alter table sm_ci_cert_tasks add column if not exists close_notes text;
    alter table sm_ci_cert_tasks add column if not exists parent_id uuid;
    alter table sm_ci_cert_tasks add column if not exists watch_list jsonb;
    alter table sm_ci_cert_tasks add column if not exists approval text;
    alter table sm_ci_cert_tasks add column if not exists escalation integer;
    alter table sm_ci_cert_tasks add column if not exists reassignment_count integer;
    alter table sm_ci_cert_tasks add column if not exists reopen_count integer;
    alter table sm_ci_cert_tasks add column if not exists time_worked bigint;
    alter table sm_ci_cert_tasks add column if not exists first_response_at timestamptz;
    alter table sm_ci_cert_tasks add column if not exists active boolean not null default true;
    alter table sm_ci_cert_tasks add column if not exists sla_due timestamptz;
    alter table sm_ci_cert_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_ci_cert_tasks add column if not exists campaign_id uuid;
    alter table sm_ci_cert_tasks add column if not exists ci_ids jsonb;
    alter table sm_ci_cert_tasks add column if not exists corrections text;
    alter table sm_ci_cert_tasks add column if not exists confirmed_count integer;
  end if;
end
$cols$;
create table if not exists sm_ci_cert_tasks (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CRT' || no::text else 'CRT' || lpad(no::text, 6, '0') end) stored,
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
  campaign_id uuid,
  ci_ids jsonb,
  corrections text,
  confirmed_count integer,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_cert_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_ci_cert_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_ci_cert_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_ci_cert_tasks' and indexname like 'sm\_ci\_cert\_tasks\_search\_%' and indexname not in ('sm_ci_cert_tasks_search_f3bce210_trgm', 'sm_ci_cert_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_ci_cert_tasks_search_f3bce210_trgm', 'sm_ci_cert_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_ci_cert_tasks_search_custom_trgm', 'sm_ci_cert_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_ci_cert_tasks_no_uk on sm_ci_cert_tasks (org_id, no);
create index if not exists sm_ci_cert_tasks_rev_idx on sm_ci_cert_tasks (org_id, rev);
create index if not exists sm_ci_cert_tasks_upd_idx on sm_ci_cert_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_crt_idx on sm_ci_cert_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_state_idx on sm_ci_cert_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_assignment_group_id_idx on sm_ci_cert_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_assigned_to_idx on sm_ci_cert_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_campaign_id_idx on sm_ci_cert_tasks (org_id, campaign_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_workspace_acc_idx on sm_ci_cert_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_cert_tasks_unit_acc_idx on sm_ci_cert_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_cert_tasks_domain_acc_idx on sm_ci_cert_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_cert_tasks_caller_id_idx on sm_ci_cert_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_requested_for_idx on sm_ci_cert_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_opened_by_idx on sm_ci_cert_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_watch_list_gin on sm_ci_cert_tasks using gin (watch_list);
create index if not exists sm_ci_cert_tasks_open_grp_idx on sm_ci_cert_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_ci_cert_tasks_opened_brin on sm_ci_cert_tasks using brin (opened_at);
drop trigger if exists sm_ci_cert_tasks_sync on sm_ci_cert_tasks;
create trigger sm_ci_cert_tasks_sync before insert or update on sm_ci_cert_tasks for each row execute function sm_sync_touch('ci_cert_task');
create or replace trigger sm_ci_cert_tasks_demo after insert on sm_ci_cert_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_cert_tasks_demo_t after update or delete on sm_ci_cert_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_cert_tasks enable row level security;

-- ci_class: کلاس‌های پیکربندی
do $cols$
begin
  if to_regclass('sm_ci_classes') is not null then
    alter table sm_ci_classes add column if not exists workspace_id uuid;
    alter table sm_ci_classes add column if not exists domain_id uuid;
    alter table sm_ci_classes add column if not exists unit_id uuid;
    alter table sm_ci_classes add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_classes add column if not exists created_by uuid;
    alter table sm_ci_classes add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_classes add column if not exists updated_by uuid;
    alter table sm_ci_classes add column if not exists rev bigint not null default 0;
    alter table sm_ci_classes add column if not exists version integer not null default 1;
    alter table sm_ci_classes add column if not exists deleted_at timestamptz;
    alter table sm_ci_classes add column if not exists origin text;
    alter table sm_ci_classes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_classes add column if not exists label text;
    alter table sm_ci_classes add column if not exists key text;
    alter table sm_ci_classes add column if not exists parent_key text;
    alter table sm_ci_classes add column if not exists family text;
    alter table sm_ci_classes add column if not exists icon text;
    alter table sm_ci_classes add column if not exists color text;
    alter table sm_ci_classes add column if not exists sort_order integer;
    alter table sm_ci_classes add column if not exists abstract boolean not null default false;
    alter table sm_ci_classes add column if not exists principal boolean not null default false;
    alter table sm_ci_classes add column if not exists create_disabled boolean not null default false;
    alter table sm_ci_classes add column if not exists active boolean not null default true;
    alter table sm_ci_classes add column if not exists builtin boolean not null default false;
    alter table sm_ci_classes add column if not exists pack_version integer;
    alter table sm_ci_classes add column if not exists description text;
    alter table sm_ci_classes add column if not exists attrs jsonb;
    alter table sm_ci_classes add column if not exists required_fields jsonb;
    alter table sm_ci_classes add column if not exists recommended_fields jsonb;
    alter table sm_ci_classes add column if not exists owner_required boolean not null default false;
    alter table sm_ci_classes add column if not exists stale_days integer;
    alter table sm_ci_classes add column if not exists operational_requires jsonb;
    alter table sm_ci_classes add column if not exists rel_rules jsonb;
    alter table sm_ci_classes add column if not exists controlled_attrs jsonb;
    alter table sm_ci_classes add column if not exists asset_class text;
  end if;
end
$cols$;
create table if not exists sm_ci_classes (
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
  key text,
  parent_key text,
  family text,
  icon text,
  color text,
  sort_order integer,
  abstract boolean not null default false,
  principal boolean not null default false,
  create_disabled boolean not null default false,
  active boolean not null default true,
  builtin boolean not null default false,
  pack_version integer,
  description text,
  attrs jsonb,
  required_fields jsonb,
  recommended_fields jsonb,
  owner_required boolean not null default false,
  stale_days integer,
  operational_requires jsonb,
  rel_rules jsonb,
  controlled_attrs jsonb,
  asset_class text
);
create index if not exists sm_ci_classes_rev_idx on sm_ci_classes (org_id, rev);
create index if not exists sm_ci_classes_upd_idx on sm_ci_classes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_classes_crt_idx on sm_ci_classes (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ci_classes_key_uk on sm_ci_classes (org_id, key) where deleted_at is null;
drop trigger if exists sm_ci_classes_sync on sm_ci_classes;
create trigger sm_ci_classes_sync before insert or update on sm_ci_classes for each row execute function sm_sync_touch('ci_class');
create or replace trigger sm_ci_classes_demo after insert on sm_ci_classes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_classes_demo_t after update or delete on sm_ci_classes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_classes enable row level security;

-- ci_drift: انحراف‌های پیکربندی
do $cols$
begin
  if to_regclass('sm_ci_drifts') is not null then
    alter table sm_ci_drifts add column if not exists workspace_id uuid;
    alter table sm_ci_drifts add column if not exists domain_id uuid;
    alter table sm_ci_drifts add column if not exists unit_id uuid;
    alter table sm_ci_drifts add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_drifts add column if not exists created_by uuid;
    alter table sm_ci_drifts add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_drifts add column if not exists updated_by uuid;
    alter table sm_ci_drifts add column if not exists rev bigint not null default 0;
    alter table sm_ci_drifts add column if not exists version integer not null default 1;
    alter table sm_ci_drifts add column if not exists deleted_at timestamptz;
    alter table sm_ci_drifts add column if not exists origin text;
    alter table sm_ci_drifts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_drifts add column if not exists no integer;
    alter table sm_ci_drifts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DRF' || no::text else 'DRF' || lpad(no::text, 6, '0') end) stored;
    alter table sm_ci_drifts add column if not exists short_description text;
    alter table sm_ci_drifts add column if not exists description text;
    alter table sm_ci_drifts add column if not exists state text;
    alter table sm_ci_drifts add column if not exists priority text;
    alter table sm_ci_drifts add column if not exists impact text;
    alter table sm_ci_drifts add column if not exists urgency text;
    alter table sm_ci_drifts add column if not exists category text;
    alter table sm_ci_drifts add column if not exists subcategory text;
    alter table sm_ci_drifts add column if not exists channel text;
    alter table sm_ci_drifts add column if not exists caller_id uuid;
    alter table sm_ci_drifts add column if not exists requested_for uuid;
    alter table sm_ci_drifts add column if not exists opened_by uuid;
    alter table sm_ci_drifts add column if not exists opened_at timestamptz;
    alter table sm_ci_drifts add column if not exists assignment_group_id uuid;
    alter table sm_ci_drifts add column if not exists assigned_to uuid;
    alter table sm_ci_drifts add column if not exists service_id uuid;
    alter table sm_ci_drifts add column if not exists offering_id uuid;
    alter table sm_ci_drifts add column if not exists ci_id uuid;
    alter table sm_ci_drifts add column if not exists location_id uuid;
    alter table sm_ci_drifts add column if not exists due_at timestamptz;
    alter table sm_ci_drifts add column if not exists resolved_at timestamptz;
    alter table sm_ci_drifts add column if not exists resolved_by uuid;
    alter table sm_ci_drifts add column if not exists closed_at timestamptz;
    alter table sm_ci_drifts add column if not exists closed_by uuid;
    alter table sm_ci_drifts add column if not exists close_code text;
    alter table sm_ci_drifts add column if not exists close_notes text;
    alter table sm_ci_drifts add column if not exists parent_id uuid;
    alter table sm_ci_drifts add column if not exists watch_list jsonb;
    alter table sm_ci_drifts add column if not exists approval text;
    alter table sm_ci_drifts add column if not exists escalation integer;
    alter table sm_ci_drifts add column if not exists reassignment_count integer;
    alter table sm_ci_drifts add column if not exists reopen_count integer;
    alter table sm_ci_drifts add column if not exists time_worked bigint;
    alter table sm_ci_drifts add column if not exists first_response_at timestamptz;
    alter table sm_ci_drifts add column if not exists active boolean not null default true;
    alter table sm_ci_drifts add column if not exists sla_due timestamptz;
    alter table sm_ci_drifts add column if not exists knowledge boolean not null default false;
    alter table sm_ci_drifts add column if not exists attribute text;
    alter table sm_ci_drifts add column if not exists expected text;
    alter table sm_ci_drifts add column if not exists actual text;
    alter table sm_ci_drifts add column if not exists baseline_id uuid;
    alter table sm_ci_drifts add column if not exists source_id uuid;
    alter table sm_ci_drifts add column if not exists change_id uuid;
    alter table sm_ci_drifts add column if not exists decision text;
    alter table sm_ci_drifts add column if not exists dedupe_key text;
  end if;
end
$cols$;
create table if not exists sm_ci_drifts (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DRF' || no::text else 'DRF' || lpad(no::text, 6, '0') end) stored,
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
  attribute text,
  expected text,
  actual text,
  baseline_id uuid,
  source_id uuid,
  change_id uuid,
  decision text,
  dedupe_key text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_drifts' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_ci_drifts', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_ci_drifts', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_ci_drifts' and indexname like 'sm\_ci\_drifts\_search\_%' and indexname not in ('sm_ci_drifts_search_f3bce210_trgm', 'sm_ci_drifts_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_ci_drifts_search_f3bce210_trgm', 'sm_ci_drifts', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_ci_drifts_search_custom_trgm', 'sm_ci_drifts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_ci_drifts_no_uk on sm_ci_drifts (org_id, no);
create index if not exists sm_ci_drifts_rev_idx on sm_ci_drifts (org_id, rev);
create index if not exists sm_ci_drifts_upd_idx on sm_ci_drifts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_drifts_crt_idx on sm_ci_drifts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_drifts_state_idx on sm_ci_drifts (org_id, state) where deleted_at is null;
create index if not exists sm_ci_drifts_assignment_group_id_idx on sm_ci_drifts (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_ci_drifts_assigned_to_idx on sm_ci_drifts (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_ci_drifts_ci_id_idx on sm_ci_drifts (org_id, ci_id) where deleted_at is null;
create index if not exists sm_ci_drifts_dedupe_key_idx on sm_ci_drifts (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_ci_drifts_workspace_acc_idx on sm_ci_drifts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_drifts_unit_acc_idx on sm_ci_drifts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_drifts_domain_acc_idx on sm_ci_drifts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_drifts_caller_id_idx on sm_ci_drifts (org_id, caller_id) where deleted_at is null;
create index if not exists sm_ci_drifts_requested_for_idx on sm_ci_drifts (org_id, requested_for) where deleted_at is null;
create index if not exists sm_ci_drifts_opened_by_idx on sm_ci_drifts (org_id, opened_by) where deleted_at is null;
create index if not exists sm_ci_drifts_watch_list_gin on sm_ci_drifts using gin (watch_list);
create index if not exists sm_ci_drifts_open_grp_idx on sm_ci_drifts (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_ci_drifts_opened_brin on sm_ci_drifts using brin (opened_at);
drop trigger if exists sm_ci_drifts_sync on sm_ci_drifts;
create trigger sm_ci_drifts_sync before insert or update on sm_ci_drifts for each row execute function sm_sync_touch('ci_drift');
create or replace trigger sm_ci_drifts_demo after insert on sm_ci_drifts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_drifts_demo_t after update or delete on sm_ci_drifts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_drifts enable row level security;

-- ci_group: گروه‌های پیکربندی
do $cols$
begin
  if to_regclass('sm_ci_groups') is not null then
    alter table sm_ci_groups add column if not exists workspace_id uuid;
    alter table sm_ci_groups add column if not exists domain_id uuid;
    alter table sm_ci_groups add column if not exists unit_id uuid;
    alter table sm_ci_groups add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_groups add column if not exists created_by uuid;
    alter table sm_ci_groups add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_groups add column if not exists updated_by uuid;
    alter table sm_ci_groups add column if not exists rev bigint not null default 0;
    alter table sm_ci_groups add column if not exists version integer not null default 1;
    alter table sm_ci_groups add column if not exists deleted_at timestamptz;
    alter table sm_ci_groups add column if not exists origin text;
    alter table sm_ci_groups add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_groups add column if not exists name text;
    alter table sm_ci_groups add column if not exists kind text;
    alter table sm_ci_groups add column if not exists condition jsonb;
    alter table sm_ci_groups add column if not exists members jsonb;
    alter table sm_ci_groups add column if not exists ci_id uuid;
    alter table sm_ci_groups add column if not exists min_up integer;
    alter table sm_ci_groups add column if not exists min_up_pct numeric;
    alter table sm_ci_groups add column if not exists owner_group_id uuid;
    alter table sm_ci_groups add column if not exists active boolean not null default true;
    alter table sm_ci_groups add column if not exists member_count integer;
    alter table sm_ci_groups add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_ci_groups (
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
  condition jsonb,
  members jsonb,
  ci_id uuid,
  min_up integer,
  min_up_pct numeric,
  owner_group_id uuid,
  active boolean not null default true,
  member_count integer,
  description text
);
create index if not exists sm_ci_groups_rev_idx on sm_ci_groups (org_id, rev);
create index if not exists sm_ci_groups_upd_idx on sm_ci_groups (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_groups_crt_idx on sm_ci_groups (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_groups_ci_id_idx on sm_ci_groups (org_id, ci_id) where deleted_at is null;
create index if not exists sm_ci_groups_workspace_acc_idx on sm_ci_groups (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_groups_unit_acc_idx on sm_ci_groups (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_groups_domain_acc_idx on sm_ci_groups (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_groups_open_grp_idx on sm_ci_groups (org_id, owner_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_ci_groups_sync on sm_ci_groups;
create trigger sm_ci_groups_sync before insert or update on sm_ci_groups for each row execute function sm_sync_touch('ci_group');
create or replace trigger sm_ci_groups_demo after insert on sm_ci_groups for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_groups_demo_t after update or delete on sm_ci_groups for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_groups enable row level security;

-- ci_identification_rule: قاعده‌های شناسایی
do $cols$
begin
  if to_regclass('sm_ci_ident_rules') is not null then
    alter table sm_ci_ident_rules add column if not exists workspace_id uuid;
    alter table sm_ci_ident_rules add column if not exists domain_id uuid;
    alter table sm_ci_ident_rules add column if not exists unit_id uuid;
    alter table sm_ci_ident_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_ident_rules add column if not exists created_by uuid;
    alter table sm_ci_ident_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_ident_rules add column if not exists updated_by uuid;
    alter table sm_ci_ident_rules add column if not exists rev bigint not null default 0;
    alter table sm_ci_ident_rules add column if not exists version integer not null default 1;
    alter table sm_ci_ident_rules add column if not exists deleted_at timestamptz;
    alter table sm_ci_ident_rules add column if not exists origin text;
    alter table sm_ci_ident_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_ident_rules add column if not exists name text;
    alter table sm_ci_ident_rules add column if not exists class text;
    alter table sm_ci_ident_rules add column if not exists entries jsonb;
    alter table sm_ci_ident_rules add column if not exists active boolean not null default true;
    alter table sm_ci_ident_rules add column if not exists sort_order integer;
    alter table sm_ci_ident_rules add column if not exists builtin boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_ci_ident_rules (
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
  class text,
  entries jsonb,
  active boolean not null default true,
  sort_order integer,
  builtin boolean not null default false
);
create index if not exists sm_ci_ident_rules_rev_idx on sm_ci_ident_rules (org_id, rev);
create index if not exists sm_ci_ident_rules_upd_idx on sm_ci_ident_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_ident_rules_crt_idx on sm_ci_ident_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ci_ident_rules_sync on sm_ci_ident_rules;
create trigger sm_ci_ident_rules_sync before insert or update on sm_ci_ident_rules for each row execute function sm_sync_touch('ci_identification_rule');
create or replace trigger sm_ci_ident_rules_demo after insert on sm_ci_ident_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_ident_rules_demo_t after update or delete on sm_ci_ident_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_ident_rules enable row level security;

-- ci_impact_sim: شبیه‌سازی‌های اثر
do $cols$
begin
  if to_regclass('sm_ci_impact_sims') is not null then
    alter table sm_ci_impact_sims add column if not exists workspace_id uuid;
    alter table sm_ci_impact_sims add column if not exists domain_id uuid;
    alter table sm_ci_impact_sims add column if not exists unit_id uuid;
    alter table sm_ci_impact_sims add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_impact_sims add column if not exists created_by uuid;
    alter table sm_ci_impact_sims add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_impact_sims add column if not exists updated_by uuid;
    alter table sm_ci_impact_sims add column if not exists rev bigint not null default 0;
    alter table sm_ci_impact_sims add column if not exists version integer not null default 1;
    alter table sm_ci_impact_sims add column if not exists deleted_at timestamptz;
    alter table sm_ci_impact_sims add column if not exists origin text;
    alter table sm_ci_impact_sims add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_impact_sims add column if not exists name text;
    alter table sm_ci_impact_sims add column if not exists sim_state text;
    alter table sm_ci_impact_sims add column if not exists ci_ids jsonb;
    alter table sm_ci_impact_sims add column if not exists linked_table text;
    alter table sm_ci_impact_sims add column if not exists linked_id text;
    alter table sm_ci_impact_sims add column if not exists linked_label text;
    alter table sm_ci_impact_sims add column if not exists owner_id uuid;
    alter table sm_ci_impact_sims add column if not exists summary text;
    alter table sm_ci_impact_sims add column if not exists result jsonb;
  end if;
end
$cols$;
create table if not exists sm_ci_impact_sims (
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
  sim_state text,
  ci_ids jsonb,
  linked_table text,
  linked_id text,
  linked_label text,
  owner_id uuid,
  summary text,
  result jsonb
);
create index if not exists sm_ci_impact_sims_rev_idx on sm_ci_impact_sims (org_id, rev);
create index if not exists sm_ci_impact_sims_upd_idx on sm_ci_impact_sims (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_impact_sims_crt_idx on sm_ci_impact_sims (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_impact_sims_workspace_acc_idx on sm_ci_impact_sims (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_impact_sims_unit_acc_idx on sm_ci_impact_sims (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_impact_sims_domain_acc_idx on sm_ci_impact_sims (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_impact_sims_owner_id_idx on sm_ci_impact_sims (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_ci_impact_sims_sync on sm_ci_impact_sims;
create trigger sm_ci_impact_sims_sync before insert or update on sm_ci_impact_sims for each row execute function sm_sync_touch('ci_impact_sim');
create or replace trigger sm_ci_impact_sims_demo after insert on sm_ci_impact_sims for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_impact_sims_demo_t after update or delete on sm_ci_impact_sims for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_impact_sims enable row level security;

-- ci_reconciliation_rule: قاعده‌های آشتی داده
do $cols$
begin
  if to_regclass('sm_ci_recon_rules') is not null then
    alter table sm_ci_recon_rules add column if not exists workspace_id uuid;
    alter table sm_ci_recon_rules add column if not exists domain_id uuid;
    alter table sm_ci_recon_rules add column if not exists unit_id uuid;
    alter table sm_ci_recon_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_recon_rules add column if not exists created_by uuid;
    alter table sm_ci_recon_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_recon_rules add column if not exists updated_by uuid;
    alter table sm_ci_recon_rules add column if not exists rev bigint not null default 0;
    alter table sm_ci_recon_rules add column if not exists version integer not null default 1;
    alter table sm_ci_recon_rules add column if not exists deleted_at timestamptz;
    alter table sm_ci_recon_rules add column if not exists origin text;
    alter table sm_ci_recon_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_recon_rules add column if not exists name text;
    alter table sm_ci_recon_rules add column if not exists class text;
    alter table sm_ci_recon_rules add column if not exists attributes jsonb;
    alter table sm_ci_recon_rules add column if not exists source_id uuid;
    alter table sm_ci_recon_rules add column if not exists priority integer;
    alter table sm_ci_recon_rules add column if not exists max_age_days integer;
    alter table sm_ci_recon_rules add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_ci_recon_rules (
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
  class text,
  attributes jsonb,
  source_id uuid,
  priority integer,
  max_age_days integer,
  active boolean not null default true
);
create index if not exists sm_ci_recon_rules_rev_idx on sm_ci_recon_rules (org_id, rev);
create index if not exists sm_ci_recon_rules_upd_idx on sm_ci_recon_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_recon_rules_crt_idx on sm_ci_recon_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ci_recon_rules_sync on sm_ci_recon_rules;
create trigger sm_ci_recon_rules_sync before insert or update on sm_ci_recon_rules for each row execute function sm_sync_touch('ci_reconciliation_rule');
create or replace trigger sm_ci_recon_rules_demo after insert on sm_ci_recon_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_recon_rules_demo_t after update or delete on sm_ci_recon_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_recon_rules enable row level security;

-- ci_rel: رابطه‌های پیکربندی
do $cols$
begin
  if to_regclass('sm_ci_rels') is not null then
    alter table sm_ci_rels add column if not exists workspace_id uuid;
    alter table sm_ci_rels add column if not exists domain_id uuid;
    alter table sm_ci_rels add column if not exists unit_id uuid;
    alter table sm_ci_rels add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_rels add column if not exists created_by uuid;
    alter table sm_ci_rels add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_rels add column if not exists updated_by uuid;
    alter table sm_ci_rels add column if not exists rev bigint not null default 0;
    alter table sm_ci_rels add column if not exists version integer not null default 1;
    alter table sm_ci_rels add column if not exists deleted_at timestamptz;
    alter table sm_ci_rels add column if not exists origin text;
    alter table sm_ci_rels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_rels add column if not exists parent_id uuid;
    alter table sm_ci_rels add column if not exists type text;
    alter table sm_ci_rels add column if not exists child_id uuid;
    alter table sm_ci_rels add column if not exists label text;
    alter table sm_ci_rels add column if not exists origin_kind text;
    alter table sm_ci_rels add column if not exists source_id uuid;
    alter table sm_ci_rels add column if not exists impact_weight integer;
    alter table sm_ci_rels add column if not exists valid_from timestamptz;
    alter table sm_ci_rels add column if not exists valid_to timestamptz;
    alter table sm_ci_rels add column if not exists discovered_at timestamptz;
    alter table sm_ci_rels add column if not exists last_seen_at timestamptz;
    alter table sm_ci_rels add column if not exists hide_on_map boolean not null default false;
    alter table sm_ci_rels add column if not exists note text;
    alter table sm_ci_rels add column if not exists owned_by uuid;
    alter table sm_ci_rels add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_ci_rels (
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
  parent_id uuid,
  type text,
  child_id uuid,
  label text,
  origin_kind text,
  source_id uuid,
  impact_weight integer,
  valid_from timestamptz,
  valid_to timestamptz,
  discovered_at timestamptz,
  last_seen_at timestamptz,
  hide_on_map boolean not null default false,
  note text,
  owned_by uuid,
  support_group_id uuid
);
create index if not exists sm_ci_rels_rev_idx on sm_ci_rels (org_id, rev);
create index if not exists sm_ci_rels_upd_idx on sm_ci_rels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rels_crt_idx on sm_ci_rels (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rels_parent_id_idx on sm_ci_rels (org_id, parent_id) where deleted_at is null;
create index if not exists sm_ci_rels_type_idx on sm_ci_rels (org_id, type) where deleted_at is null;
create index if not exists sm_ci_rels_child_id_idx on sm_ci_rels (org_id, child_id) where deleted_at is null;
create index if not exists sm_ci_rels_workspace_acc_idx on sm_ci_rels (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_rels_unit_acc_idx on sm_ci_rels (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_rels_domain_acc_idx on sm_ci_rels (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_rels_owned_by_idx on sm_ci_rels (org_id, owned_by) where deleted_at is null;
drop trigger if exists sm_ci_rels_sync on sm_ci_rels;
create trigger sm_ci_rels_sync before insert or update on sm_ci_rels for each row execute function sm_sync_touch('ci_rel');
create or replace trigger sm_ci_rels_demo after insert on sm_ci_rels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_rels_demo_t after update or delete on sm_ci_rels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_rels enable row level security;

-- ci_rel_rule: قاعده‌های رابطه‌سازی
do $cols$
begin
  if to_regclass('sm_ci_rel_rules') is not null then
    alter table sm_ci_rel_rules add column if not exists workspace_id uuid;
    alter table sm_ci_rel_rules add column if not exists domain_id uuid;
    alter table sm_ci_rel_rules add column if not exists unit_id uuid;
    alter table sm_ci_rel_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_rel_rules add column if not exists created_by uuid;
    alter table sm_ci_rel_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_rel_rules add column if not exists updated_by uuid;
    alter table sm_ci_rel_rules add column if not exists rev bigint not null default 0;
    alter table sm_ci_rel_rules add column if not exists version integer not null default 1;
    alter table sm_ci_rel_rules add column if not exists deleted_at timestamptz;
    alter table sm_ci_rel_rules add column if not exists origin text;
    alter table sm_ci_rel_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_rel_rules add column if not exists name text;
    alter table sm_ci_rel_rules add column if not exists source_class text;
    alter table sm_ci_rel_rules add column if not exists source_attr text;
    alter table sm_ci_rel_rules add column if not exists target_class text;
    alter table sm_ci_rel_rules add column if not exists target_attr text;
    alter table sm_ci_rel_rules add column if not exists type text;
    alter table sm_ci_rel_rules add column if not exists mode text;
    alter table sm_ci_rel_rules add column if not exists active boolean not null default true;
    alter table sm_ci_rel_rules add column if not exists last_run_at timestamptz;
    alter table sm_ci_rel_rules add column if not exists last_result text;
  end if;
end
$cols$;
create table if not exists sm_ci_rel_rules (
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
  source_class text,
  source_attr text,
  target_class text,
  target_attr text,
  type text,
  mode text,
  active boolean not null default true,
  last_run_at timestamptz,
  last_result text
);
create index if not exists sm_ci_rel_rules_rev_idx on sm_ci_rel_rules (org_id, rev);
create index if not exists sm_ci_rel_rules_upd_idx on sm_ci_rel_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_rules_crt_idx on sm_ci_rel_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ci_rel_rules_sync on sm_ci_rel_rules;
create trigger sm_ci_rel_rules_sync before insert or update on sm_ci_rel_rules for each row execute function sm_sync_touch('ci_rel_rule');
create or replace trigger sm_ci_rel_rules_demo after insert on sm_ci_rel_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_rel_rules_demo_t after update or delete on sm_ci_rel_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_rel_rules enable row level security;

-- ci_rel_suggestion: پیشنهادهای رابطه
do $cols$
begin
  if to_regclass('sm_ci_rel_suggestions') is not null then
    alter table sm_ci_rel_suggestions add column if not exists workspace_id uuid;
    alter table sm_ci_rel_suggestions add column if not exists domain_id uuid;
    alter table sm_ci_rel_suggestions add column if not exists unit_id uuid;
    alter table sm_ci_rel_suggestions add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_rel_suggestions add column if not exists created_by uuid;
    alter table sm_ci_rel_suggestions add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_rel_suggestions add column if not exists updated_by uuid;
    alter table sm_ci_rel_suggestions add column if not exists rev bigint not null default 0;
    alter table sm_ci_rel_suggestions add column if not exists version integer not null default 1;
    alter table sm_ci_rel_suggestions add column if not exists deleted_at timestamptz;
    alter table sm_ci_rel_suggestions add column if not exists origin text;
    alter table sm_ci_rel_suggestions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_rel_suggestions add column if not exists parent_id uuid;
    alter table sm_ci_rel_suggestions add column if not exists type text;
    alter table sm_ci_rel_suggestions add column if not exists child_id uuid;
    alter table sm_ci_rel_suggestions add column if not exists label text;
    alter table sm_ci_rel_suggestions add column if not exists score integer;
    alter table sm_ci_rel_suggestions add column if not exists method text;
    alter table sm_ci_rel_suggestions add column if not exists evidence jsonb;
    alter table sm_ci_rel_suggestions add column if not exists decided_by uuid;
    alter table sm_ci_rel_suggestions add column if not exists rel_id uuid;
    alter table sm_ci_rel_suggestions add column if not exists pair_key text;
    alter table sm_ci_rel_suggestions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_ci_rel_suggestions (
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
  parent_id uuid,
  type text,
  child_id uuid,
  label text,
  score integer,
  method text,
  evidence jsonb,
  decided_by uuid,
  rel_id uuid,
  pair_key text,
  state text
);
create index if not exists sm_ci_rel_suggestions_rev_idx on sm_ci_rel_suggestions (org_id, rev);
create index if not exists sm_ci_rel_suggestions_upd_idx on sm_ci_rel_suggestions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_crt_idx on sm_ci_rel_suggestions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_parent_id_idx on sm_ci_rel_suggestions (org_id, parent_id) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_child_id_idx on sm_ci_rel_suggestions (org_id, child_id) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_pair_key_idx on sm_ci_rel_suggestions (org_id, pair_key) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_state_idx on sm_ci_rel_suggestions (org_id, state) where deleted_at is null;
drop trigger if exists sm_ci_rel_suggestions_sync on sm_ci_rel_suggestions;
create trigger sm_ci_rel_suggestions_sync before insert or update on sm_ci_rel_suggestions for each row execute function sm_sync_touch('ci_rel_suggestion');
create or replace trigger sm_ci_rel_suggestions_demo after insert on sm_ci_rel_suggestions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_rel_suggestions_demo_t after update or delete on sm_ci_rel_suggestions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_rel_suggestions enable row level security;

-- ci_rel_type: نوع‌های رابطه
do $cols$
begin
  if to_regclass('sm_ci_rel_types') is not null then
    alter table sm_ci_rel_types add column if not exists workspace_id uuid;
    alter table sm_ci_rel_types add column if not exists domain_id uuid;
    alter table sm_ci_rel_types add column if not exists unit_id uuid;
    alter table sm_ci_rel_types add column if not exists created_at timestamptz not null default now();
    alter table sm_ci_rel_types add column if not exists created_by uuid;
    alter table sm_ci_rel_types add column if not exists updated_at timestamptz not null default now();
    alter table sm_ci_rel_types add column if not exists updated_by uuid;
    alter table sm_ci_rel_types add column if not exists rev bigint not null default 0;
    alter table sm_ci_rel_types add column if not exists version integer not null default 1;
    alter table sm_ci_rel_types add column if not exists deleted_at timestamptz;
    alter table sm_ci_rel_types add column if not exists origin text;
    alter table sm_ci_rel_types add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ci_rel_types add column if not exists label text;
    alter table sm_ci_rel_types add column if not exists inverse_label text;
    alter table sm_ci_rel_types add column if not exists key text;
    alter table sm_ci_rel_types add column if not exists category text;
    alter table sm_ci_rel_types add column if not exists is_symmetric boolean not null default false;
    alter table sm_ci_rel_types add column if not exists propagates boolean not null default true;
    alter table sm_ci_rel_types add column if not exists impact text;
    alter table sm_ci_rel_types add column if not exists color text;
    alter table sm_ci_rel_types add column if not exists active boolean not null default true;
    alter table sm_ci_rel_types add column if not exists builtin boolean not null default false;
    alter table sm_ci_rel_types add column if not exists sort_order integer;
    alter table sm_ci_rel_types add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_ci_rel_types (
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
  inverse_label text,
  key text,
  category text,
  is_symmetric boolean not null default false,
  propagates boolean not null default true,
  impact text,
  color text,
  active boolean not null default true,
  builtin boolean not null default false,
  sort_order integer,
  description text
);
create index if not exists sm_ci_rel_types_rev_idx on sm_ci_rel_types (org_id, rev);
create index if not exists sm_ci_rel_types_upd_idx on sm_ci_rel_types (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_types_crt_idx on sm_ci_rel_types (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ci_rel_types_key_uk on sm_ci_rel_types (org_id, key) where deleted_at is null;
drop trigger if exists sm_ci_rel_types_sync on sm_ci_rel_types;
create trigger sm_ci_rel_types_sync before insert or update on sm_ci_rel_types for each row execute function sm_sync_touch('ci_rel_type');
create or replace trigger sm_ci_rel_types_demo after insert on sm_ci_rel_types for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ci_rel_types_demo_t after update or delete on sm_ci_rel_types for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ci_rel_types enable row level security;

-- cmdb_config: تنظیمات پیکربندی
do $cols$
begin
  if to_regclass('sm_cmdb_configs') is not null then
    alter table sm_cmdb_configs add column if not exists workspace_id uuid;
    alter table sm_cmdb_configs add column if not exists domain_id uuid;
    alter table sm_cmdb_configs add column if not exists unit_id uuid;
    alter table sm_cmdb_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_configs add column if not exists created_by uuid;
    alter table sm_cmdb_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_configs add column if not exists updated_by uuid;
    alter table sm_cmdb_configs add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_configs add column if not exists version integer not null default 1;
    alter table sm_cmdb_configs add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_configs add column if not exists origin text;
    alter table sm_cmdb_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_configs add column if not exists name text;
    alter table sm_cmdb_configs add column if not exists config_key text;
    alter table sm_cmdb_configs add column if not exists w_completeness integer;
    alter table sm_cmdb_configs add column if not exists w_correctness integer;
    alter table sm_cmdb_configs add column if not exists w_compliance integer;
    alter table sm_cmdb_configs add column if not exists health_findings boolean not null default true;
    alter table sm_cmdb_configs add column if not exists certify_days integer;
    alter table sm_cmdb_configs add column if not exists impact_depth integer;
    alter table sm_cmdb_configs add column if not exists map_max_nodes integer;
    alter table sm_cmdb_configs add column if not exists suggest_min_support integer;
    alter table sm_cmdb_configs add column if not exists manual_priority integer;
    alter table sm_cmdb_configs add column if not exists controlled_mode text;
    alter table sm_cmdb_configs add column if not exists cert_warn_days jsonb;
    alter table sm_cmdb_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_cmdb_configs (
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
  w_completeness integer,
  w_correctness integer,
  w_compliance integer,
  health_findings boolean not null default true,
  certify_days integer,
  impact_depth integer,
  map_max_nodes integer,
  suggest_min_support integer,
  manual_priority integer,
  controlled_mode text,
  cert_warn_days jsonb,
  seeded integer
);
create index if not exists sm_cmdb_configs_rev_idx on sm_cmdb_configs (org_id, rev);
create index if not exists sm_cmdb_configs_upd_idx on sm_cmdb_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_configs_crt_idx on sm_cmdb_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cmdb_configs_config_key_uk on sm_cmdb_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_cmdb_configs_sync on sm_cmdb_configs;
create trigger sm_cmdb_configs_sync before insert or update on sm_cmdb_configs for each row execute function sm_sync_touch('cmdb_config');
create or replace trigger sm_cmdb_configs_demo after insert on sm_cmdb_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_configs_demo_t after update or delete on sm_cmdb_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_configs enable row level security;

-- cmdb_data_source: منبع‌های دادهٔ پیکربندی
do $cols$
begin
  if to_regclass('sm_cmdb_sources') is not null then
    alter table sm_cmdb_sources add column if not exists workspace_id uuid;
    alter table sm_cmdb_sources add column if not exists domain_id uuid;
    alter table sm_cmdb_sources add column if not exists unit_id uuid;
    alter table sm_cmdb_sources add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_sources add column if not exists created_by uuid;
    alter table sm_cmdb_sources add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_sources add column if not exists updated_by uuid;
    alter table sm_cmdb_sources add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_sources add column if not exists version integer not null default 1;
    alter table sm_cmdb_sources add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_sources add column if not exists origin text;
    alter table sm_cmdb_sources add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_sources add column if not exists name text;
    alter table sm_cmdb_sources add column if not exists kind text;
    alter table sm_cmdb_sources add column if not exists priority integer;
    alter table sm_cmdb_sources add column if not exists default_class text;
    alter table sm_cmdb_sources add column if not exists active boolean not null default true;
    alter table sm_cmdb_sources add column if not exists stale_after_days integer;
    alter table sm_cmdb_sources add column if not exists delete_policy text;
    alter table sm_cmdb_sources add column if not exists owner_id uuid;
    alter table sm_cmdb_sources add column if not exists url text;
    alter table sm_cmdb_sources add column if not exists format text;
    alter table sm_cmdb_sources add column if not exists json_path text;
    alter table sm_cmdb_sources add column if not exists every_hours integer;
    alter table sm_cmdb_sources add column if not exists mapping jsonb;
    alter table sm_cmdb_sources add column if not exists last_run_at timestamptz;
    alter table sm_cmdb_sources add column if not exists last_status text;
    alter table sm_cmdb_sources add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_cmdb_sources (
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
  priority integer,
  default_class text,
  active boolean not null default true,
  stale_after_days integer,
  delete_policy text,
  owner_id uuid,
  url text,
  format text,
  json_path text,
  every_hours integer,
  mapping jsonb,
  last_run_at timestamptz,
  last_status text,
  description text
);
create index if not exists sm_cmdb_sources_rev_idx on sm_cmdb_sources (org_id, rev);
create index if not exists sm_cmdb_sources_upd_idx on sm_cmdb_sources (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_sources_crt_idx on sm_cmdb_sources (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cmdb_sources_name_uk on sm_cmdb_sources (org_id, name) where deleted_at is null;
create index if not exists sm_cmdb_sources_workspace_acc_idx on sm_cmdb_sources (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_sources_unit_acc_idx on sm_cmdb_sources (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_sources_domain_acc_idx on sm_cmdb_sources (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_sources_owner_id_idx on sm_cmdb_sources (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_cmdb_sources_sync on sm_cmdb_sources;
create trigger sm_cmdb_sources_sync before insert or update on sm_cmdb_sources for each row execute function sm_sync_touch('cmdb_data_source');
create or replace trigger sm_cmdb_sources_demo after insert on sm_cmdb_sources for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_sources_demo_t after update or delete on sm_cmdb_sources for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_sources enable row level security;

-- cmdb_dedup_task: بررسی‌های تکراری
do $cols$
begin
  if to_regclass('sm_cmdb_dedup_tasks') is not null then
    alter table sm_cmdb_dedup_tasks add column if not exists workspace_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists domain_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists unit_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_dedup_tasks add column if not exists created_by uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_dedup_tasks add column if not exists updated_by uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_dedup_tasks add column if not exists version integer not null default 1;
    alter table sm_cmdb_dedup_tasks add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists origin text;
    alter table sm_cmdb_dedup_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_dedup_tasks add column if not exists no integer;
    alter table sm_cmdb_dedup_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DUP' || no::text else 'DUP' || lpad(no::text, 6, '0') end) stored;
    alter table sm_cmdb_dedup_tasks add column if not exists short_description text;
    alter table sm_cmdb_dedup_tasks add column if not exists description text;
    alter table sm_cmdb_dedup_tasks add column if not exists state text;
    alter table sm_cmdb_dedup_tasks add column if not exists priority text;
    alter table sm_cmdb_dedup_tasks add column if not exists impact text;
    alter table sm_cmdb_dedup_tasks add column if not exists urgency text;
    alter table sm_cmdb_dedup_tasks add column if not exists category text;
    alter table sm_cmdb_dedup_tasks add column if not exists subcategory text;
    alter table sm_cmdb_dedup_tasks add column if not exists channel text;
    alter table sm_cmdb_dedup_tasks add column if not exists caller_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists requested_for uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists opened_by uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists opened_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists assignment_group_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists assigned_to uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists service_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists offering_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists ci_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists location_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists due_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists resolved_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists resolved_by uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists closed_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists closed_by uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists close_code text;
    alter table sm_cmdb_dedup_tasks add column if not exists close_notes text;
    alter table sm_cmdb_dedup_tasks add column if not exists parent_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists watch_list jsonb;
    alter table sm_cmdb_dedup_tasks add column if not exists approval text;
    alter table sm_cmdb_dedup_tasks add column if not exists escalation integer;
    alter table sm_cmdb_dedup_tasks add column if not exists reassignment_count integer;
    alter table sm_cmdb_dedup_tasks add column if not exists reopen_count integer;
    alter table sm_cmdb_dedup_tasks add column if not exists time_worked bigint;
    alter table sm_cmdb_dedup_tasks add column if not exists first_response_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists active boolean not null default true;
    alter table sm_cmdb_dedup_tasks add column if not exists sla_due timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_cmdb_dedup_tasks add column if not exists candidates jsonb;
    alter table sm_cmdb_dedup_tasks add column if not exists main_ci_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists score integer;
    alter table sm_cmdb_dedup_tasks add column if not exists source_id uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists reason text;
    alter table sm_cmdb_dedup_tasks add column if not exists candidate_key text;
    alter table sm_cmdb_dedup_tasks add column if not exists merged_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists merged_by uuid;
    alter table sm_cmdb_dedup_tasks add column if not exists undone_at timestamptz;
    alter table sm_cmdb_dedup_tasks add column if not exists merge_journal jsonb;
  end if;
end
$cols$;
create table if not exists sm_cmdb_dedup_tasks (
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DUP' || no::text else 'DUP' || lpad(no::text, 6, '0') end) stored,
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
  candidates jsonb,
  main_ci_id uuid,
  score integer,
  source_id uuid,
  reason text,
  candidate_key text,
  merged_at timestamptz,
  merged_by uuid,
  undone_at timestamptz,
  merge_journal jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_dedup_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_cmdb_dedup_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cmdb_dedup_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_cmdb_dedup_tasks' and indexname like 'sm\_cmdb\_dedup\_tasks\_search\_%' and indexname not in ('sm_cmdb_dedup_tasks_search_f3bce210_trgm', 'sm_cmdb_dedup_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cmdb_dedup_tasks_search_f3bce210_trgm', 'sm_cmdb_dedup_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cmdb_dedup_tasks_search_custom_trgm', 'sm_cmdb_dedup_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_cmdb_dedup_tasks_no_uk on sm_cmdb_dedup_tasks (org_id, no);
create index if not exists sm_cmdb_dedup_tasks_rev_idx on sm_cmdb_dedup_tasks (org_id, rev);
create index if not exists sm_cmdb_dedup_tasks_upd_idx on sm_cmdb_dedup_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_crt_idx on sm_cmdb_dedup_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_state_idx on sm_cmdb_dedup_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_assignment_group_id_idx on sm_cmdb_dedup_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_assigned_to_idx on sm_cmdb_dedup_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_candidate_key_idx on sm_cmdb_dedup_tasks (org_id, candidate_key) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_workspace_acc_idx on sm_cmdb_dedup_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_dedup_tasks_unit_acc_idx on sm_cmdb_dedup_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_dedup_tasks_domain_acc_idx on sm_cmdb_dedup_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_dedup_tasks_caller_id_idx on sm_cmdb_dedup_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_requested_for_idx on sm_cmdb_dedup_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_opened_by_idx on sm_cmdb_dedup_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_watch_list_gin on sm_cmdb_dedup_tasks using gin (watch_list);
create index if not exists sm_cmdb_dedup_tasks_open_grp_idx on sm_cmdb_dedup_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_cmdb_dedup_tasks_opened_brin on sm_cmdb_dedup_tasks using brin (opened_at);
drop trigger if exists sm_cmdb_dedup_tasks_sync on sm_cmdb_dedup_tasks;
create trigger sm_cmdb_dedup_tasks_sync before insert or update on sm_cmdb_dedup_tasks for each row execute function sm_sync_touch('cmdb_dedup_task');
create or replace trigger sm_cmdb_dedup_tasks_demo after insert on sm_cmdb_dedup_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_dedup_tasks_demo_t after update or delete on sm_cmdb_dedup_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_dedup_tasks enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:5', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۷ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 7/30 (a0c3bc7de847)
-- cmdb_finding: یافته‌های کیفیت داده
do $cols$
begin
  if to_regclass('sm_cmdb_findings') is not null then
    alter table sm_cmdb_findings add column if not exists workspace_id uuid;
    alter table sm_cmdb_findings add column if not exists domain_id uuid;
    alter table sm_cmdb_findings add column if not exists unit_id uuid;
    alter table sm_cmdb_findings add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_findings add column if not exists created_by uuid;
    alter table sm_cmdb_findings add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_findings add column if not exists updated_by uuid;
    alter table sm_cmdb_findings add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_findings add column if not exists version integer not null default 1;
    alter table sm_cmdb_findings add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_findings add column if not exists origin text;
    alter table sm_cmdb_findings add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_findings add column if not exists no integer;
    alter table sm_cmdb_findings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'FND' || no::text else 'FND' || lpad(no::text, 7, '0') end) stored;
    alter table sm_cmdb_findings add column if not exists short_description text;
    alter table sm_cmdb_findings add column if not exists description text;
    alter table sm_cmdb_findings add column if not exists state text;
    alter table sm_cmdb_findings add column if not exists priority text;
    alter table sm_cmdb_findings add column if not exists impact text;
    alter table sm_cmdb_findings add column if not exists urgency text;
    alter table sm_cmdb_findings add column if not exists category text;
    alter table sm_cmdb_findings add column if not exists subcategory text;
    alter table sm_cmdb_findings add column if not exists channel text;
    alter table sm_cmdb_findings add column if not exists caller_id uuid;
    alter table sm_cmdb_findings add column if not exists requested_for uuid;
    alter table sm_cmdb_findings add column if not exists opened_by uuid;
    alter table sm_cmdb_findings add column if not exists opened_at timestamptz;
    alter table sm_cmdb_findings add column if not exists assignment_group_id uuid;
    alter table sm_cmdb_findings add column if not exists assigned_to uuid;
    alter table sm_cmdb_findings add column if not exists service_id uuid;
    alter table sm_cmdb_findings add column if not exists offering_id uuid;
    alter table sm_cmdb_findings add column if not exists ci_id uuid;
    alter table sm_cmdb_findings add column if not exists location_id uuid;
    alter table sm_cmdb_findings add column if not exists due_at timestamptz;
    alter table sm_cmdb_findings add column if not exists resolved_at timestamptz;
    alter table sm_cmdb_findings add column if not exists resolved_by uuid;
    alter table sm_cmdb_findings add column if not exists closed_at timestamptz;
    alter table sm_cmdb_findings add column if not exists closed_by uuid;
    alter table sm_cmdb_findings add column if not exists close_code text;
    alter table sm_cmdb_findings add column if not exists close_notes text;
    alter table sm_cmdb_findings add column if not exists parent_id uuid;
    alter table sm_cmdb_findings add column if not exists watch_list jsonb;
    alter table sm_cmdb_findings add column if not exists approval text;
    alter table sm_cmdb_findings add column if not exists escalation integer;
    alter table sm_cmdb_findings add column if not exists reassignment_count integer;
    alter table sm_cmdb_findings add column if not exists reopen_count integer;
    alter table sm_cmdb_findings add column if not exists time_worked bigint;
    alter table sm_cmdb_findings add column if not exists first_response_at timestamptz;
    alter table sm_cmdb_findings add column if not exists active boolean not null default true;
    alter table sm_cmdb_findings add column if not exists sla_due timestamptz;
    alter table sm_cmdb_findings add column if not exists knowledge boolean not null default false;
    alter table sm_cmdb_findings add column if not exists kind text;
    alter table sm_cmdb_findings add column if not exists severity text;
    alter table sm_cmdb_findings add column if not exists rule_id uuid;
    alter table sm_cmdb_findings add column if not exists detail text;
    alter table sm_cmdb_findings add column if not exists dedupe_key text;
    alter table sm_cmdb_findings add column if not exists auto boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_cmdb_findings (
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'FND' || no::text else 'FND' || lpad(no::text, 7, '0') end) stored,
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
  kind text,
  severity text,
  rule_id uuid,
  detail text,
  dedupe_key text,
  auto boolean not null default false,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_findings' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_cmdb_findings', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cmdb_findings', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_cmdb_findings' and indexname like 'sm\_cmdb\_findings\_search\_%' and indexname not in ('sm_cmdb_findings_search_f3bce210_trgm', 'sm_cmdb_findings_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cmdb_findings_search_f3bce210_trgm', 'sm_cmdb_findings', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cmdb_findings_search_custom_trgm', 'sm_cmdb_findings', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_cmdb_findings_no_uk on sm_cmdb_findings (org_id, no);
create index if not exists sm_cmdb_findings_rev_idx on sm_cmdb_findings (org_id, rev);
create index if not exists sm_cmdb_findings_upd_idx on sm_cmdb_findings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_findings_crt_idx on sm_cmdb_findings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_findings_state_idx on sm_cmdb_findings (org_id, state) where deleted_at is null;
create index if not exists sm_cmdb_findings_assignment_group_id_idx on sm_cmdb_findings (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_assigned_to_idx on sm_cmdb_findings (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_cmdb_findings_ci_id_idx on sm_cmdb_findings (org_id, ci_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_dedupe_key_idx on sm_cmdb_findings (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_cmdb_findings_workspace_acc_idx on sm_cmdb_findings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_findings_unit_acc_idx on sm_cmdb_findings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_findings_domain_acc_idx on sm_cmdb_findings (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_findings_caller_id_idx on sm_cmdb_findings (org_id, caller_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_requested_for_idx on sm_cmdb_findings (org_id, requested_for) where deleted_at is null;
create index if not exists sm_cmdb_findings_opened_by_idx on sm_cmdb_findings (org_id, opened_by) where deleted_at is null;
create index if not exists sm_cmdb_findings_watch_list_gin on sm_cmdb_findings using gin (watch_list);
create index if not exists sm_cmdb_findings_open_grp_idx on sm_cmdb_findings (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_cmdb_findings_opened_brin on sm_cmdb_findings using brin (opened_at);
drop trigger if exists sm_cmdb_findings_sync on sm_cmdb_findings;
create trigger sm_cmdb_findings_sync before insert or update on sm_cmdb_findings for each row execute function sm_sync_touch('cmdb_finding');
create or replace trigger sm_cmdb_findings_demo after insert on sm_cmdb_findings for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_findings_demo_t after update or delete on sm_cmdb_findings for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_findings enable row level security;

-- cmdb_health_fact: سلامت روزانهٔ کلاس‌ها
do $cols$
begin
  if to_regclass('sm_cmdb_health_facts') is not null then
    alter table sm_cmdb_health_facts add column if not exists workspace_id uuid;
    alter table sm_cmdb_health_facts add column if not exists domain_id uuid;
    alter table sm_cmdb_health_facts add column if not exists unit_id uuid;
    alter table sm_cmdb_health_facts add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_health_facts add column if not exists created_by uuid;
    alter table sm_cmdb_health_facts add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_health_facts add column if not exists updated_by uuid;
    alter table sm_cmdb_health_facts add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_health_facts add column if not exists version integer not null default 1;
    alter table sm_cmdb_health_facts add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_health_facts add column if not exists origin text;
    alter table sm_cmdb_health_facts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_health_facts add column if not exists day date;
    alter table sm_cmdb_health_facts add column if not exists class text;
    alter table sm_cmdb_health_facts add column if not exists total integer;
    alter table sm_cmdb_health_facts add column if not exists complete integer;
    alter table sm_cmdb_health_facts add column if not exists correct integer;
    alter table sm_cmdb_health_facts add column if not exists compliant integer;
    alter table sm_cmdb_health_facts add column if not exists stale integer;
    alter table sm_cmdb_health_facts add column if not exists duplicates integer;
    alter table sm_cmdb_health_facts add column if not exists orphans integer;
    alter table sm_cmdb_health_facts add column if not exists no_owner integer;
    alter table sm_cmdb_health_facts add column if not exists score integer;
  end if;
end
$cols$;
create table if not exists sm_cmdb_health_facts (
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
  class text,
  total integer,
  complete integer,
  correct integer,
  compliant integer,
  stale integer,
  duplicates integer,
  orphans integer,
  no_owner integer,
  score integer
);
create index if not exists sm_cmdb_health_facts_rev_idx on sm_cmdb_health_facts (org_id, rev);
create index if not exists sm_cmdb_health_facts_upd_idx on sm_cmdb_health_facts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_health_facts_crt_idx on sm_cmdb_health_facts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_health_facts_day_idx on sm_cmdb_health_facts (org_id, day) where deleted_at is null;
create unique index if not exists sm_cmdb_health_facts_day_class_uk on sm_cmdb_health_facts (org_id, day, class) where deleted_at is null;
drop trigger if exists sm_cmdb_health_facts_sync on sm_cmdb_health_facts;
create trigger sm_cmdb_health_facts_sync before insert or update on sm_cmdb_health_facts for each row execute function sm_sync_touch('cmdb_health_fact');
create or replace trigger sm_cmdb_health_facts_demo after insert on sm_cmdb_health_facts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_health_facts_demo_t after update or delete on sm_cmdb_health_facts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_health_facts enable row level security;

-- cmdb_import_run: اجراهای ورود داده
do $cols$
begin
  if to_regclass('sm_cmdb_import_runs') is not null then
    alter table sm_cmdb_import_runs add column if not exists workspace_id uuid;
    alter table sm_cmdb_import_runs add column if not exists domain_id uuid;
    alter table sm_cmdb_import_runs add column if not exists unit_id uuid;
    alter table sm_cmdb_import_runs add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_import_runs add column if not exists created_by uuid;
    alter table sm_cmdb_import_runs add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_import_runs add column if not exists updated_by uuid;
    alter table sm_cmdb_import_runs add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_import_runs add column if not exists version integer not null default 1;
    alter table sm_cmdb_import_runs add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_import_runs add column if not exists origin text;
    alter table sm_cmdb_import_runs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_import_runs add column if not exists no integer;
    alter table sm_cmdb_import_runs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'IMP' || no::text else 'IMP' || lpad(no::text, 6, '0') end) stored;
    alter table sm_cmdb_import_runs add column if not exists name text;
    alter table sm_cmdb_import_runs add column if not exists source_id uuid;
    alter table sm_cmdb_import_runs add column if not exists class text;
    alter table sm_cmdb_import_runs add column if not exists dry_run boolean not null default false;
    alter table sm_cmdb_import_runs add column if not exists file_name text;
    alter table sm_cmdb_import_runs add column if not exists total integer;
    alter table sm_cmdb_import_runs add column if not exists created integer;
    alter table sm_cmdb_import_runs add column if not exists updated integer;
    alter table sm_cmdb_import_runs add column if not exists unchanged integer;
    alter table sm_cmdb_import_runs add column if not exists duplicates integer;
    alter table sm_cmdb_import_runs add column if not exists failed integer;
    alter table sm_cmdb_import_runs add column if not exists started_at timestamptz;
    alter table sm_cmdb_import_runs add column if not exists finished_at timestamptz;
    alter table sm_cmdb_import_runs add column if not exists results jsonb;
    alter table sm_cmdb_import_runs add column if not exists error text;
    alter table sm_cmdb_import_runs add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_cmdb_import_runs (
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
  source_id uuid,
  class text,
  dry_run boolean not null default false,
  file_name text,
  total integer,
  created integer,
  updated integer,
  unchanged integer,
  duplicates integer,
  failed integer,
  started_at timestamptz,
  finished_at timestamptz,
  results jsonb,
  error text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_import_runs' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_cmdb_import_runs', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cmdb_import_runs', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_cmdb_import_runs' and indexname like 'sm\_cmdb\_import\_runs\_search\_%' and indexname not in ('sm_cmdb_import_runs_search_56291d9d_trgm', 'sm_cmdb_import_runs_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cmdb_import_runs_search_56291d9d_trgm', 'sm_cmdb_import_runs', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cmdb_import_runs_search_custom_trgm', 'sm_cmdb_import_runs', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_cmdb_import_runs_no_uk on sm_cmdb_import_runs (org_id, no);
create index if not exists sm_cmdb_import_runs_rev_idx on sm_cmdb_import_runs (org_id, rev);
create index if not exists sm_cmdb_import_runs_upd_idx on sm_cmdb_import_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_import_runs_crt_idx on sm_cmdb_import_runs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_import_runs_state_idx on sm_cmdb_import_runs (org_id, state) where deleted_at is null;
create index if not exists sm_cmdb_import_runs_workspace_acc_idx on sm_cmdb_import_runs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_import_runs_unit_acc_idx on sm_cmdb_import_runs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_import_runs_domain_acc_idx on sm_cmdb_import_runs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_cmdb_import_runs_sync on sm_cmdb_import_runs;
create trigger sm_cmdb_import_runs_sync before insert or update on sm_cmdb_import_runs for each row execute function sm_sync_touch('cmdb_import_run');
create or replace trigger sm_cmdb_import_runs_demo after insert on sm_cmdb_import_runs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_import_runs_demo_t after update or delete on sm_cmdb_import_runs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_import_runs enable row level security;

-- cmdb_map: نقشه‌های ذخیره‌شده
do $cols$
begin
  if to_regclass('sm_cmdb_maps') is not null then
    alter table sm_cmdb_maps add column if not exists workspace_id uuid;
    alter table sm_cmdb_maps add column if not exists domain_id uuid;
    alter table sm_cmdb_maps add column if not exists unit_id uuid;
    alter table sm_cmdb_maps add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_maps add column if not exists created_by uuid;
    alter table sm_cmdb_maps add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_maps add column if not exists updated_by uuid;
    alter table sm_cmdb_maps add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_maps add column if not exists version integer not null default 1;
    alter table sm_cmdb_maps add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_maps add column if not exists origin text;
    alter table sm_cmdb_maps add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_maps add column if not exists name text;
    alter table sm_cmdb_maps add column if not exists root_ids jsonb;
    alter table sm_cmdb_maps add column if not exists depth integer;
    alter table sm_cmdb_maps add column if not exists direction text;
    alter table sm_cmdb_maps add column if not exists types jsonb;
    alter table sm_cmdb_maps add column if not exists classes jsonb;
    alter table sm_cmdb_maps add column if not exists layout text;
    alter table sm_cmdb_maps add column if not exists shared boolean not null default false;
    alter table sm_cmdb_maps add column if not exists owner_id uuid;
    alter table sm_cmdb_maps add column if not exists positions jsonb;
    alter table sm_cmdb_maps add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_cmdb_maps (
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
  root_ids jsonb,
  depth integer,
  direction text,
  types jsonb,
  classes jsonb,
  layout text,
  shared boolean not null default false,
  owner_id uuid,
  positions jsonb,
  description text
);
create index if not exists sm_cmdb_maps_rev_idx on sm_cmdb_maps (org_id, rev);
create index if not exists sm_cmdb_maps_upd_idx on sm_cmdb_maps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_maps_crt_idx on sm_cmdb_maps (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_maps_workspace_acc_idx on sm_cmdb_maps (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_maps_unit_acc_idx on sm_cmdb_maps (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_maps_domain_acc_idx on sm_cmdb_maps (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_maps_owner_id_idx on sm_cmdb_maps (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_cmdb_maps_sync on sm_cmdb_maps;
create trigger sm_cmdb_maps_sync before insert or update on sm_cmdb_maps for each row execute function sm_sync_touch('cmdb_map');
create or replace trigger sm_cmdb_maps_demo after insert on sm_cmdb_maps for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_maps_demo_t after update or delete on sm_cmdb_maps for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_maps enable row level security;

-- cmdb_policy: سیاست‌های دادهٔ پیکربندی
do $cols$
begin
  if to_regclass('sm_cmdb_policies') is not null then
    alter table sm_cmdb_policies add column if not exists workspace_id uuid;
    alter table sm_cmdb_policies add column if not exists domain_id uuid;
    alter table sm_cmdb_policies add column if not exists unit_id uuid;
    alter table sm_cmdb_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_policies add column if not exists created_by uuid;
    alter table sm_cmdb_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_policies add column if not exists updated_by uuid;
    alter table sm_cmdb_policies add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_policies add column if not exists version integer not null default 1;
    alter table sm_cmdb_policies add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_policies add column if not exists origin text;
    alter table sm_cmdb_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_policies add column if not exists name text;
    alter table sm_cmdb_policies add column if not exists action text;
    alter table sm_cmdb_policies add column if not exists condition jsonb;
    alter table sm_cmdb_policies add column if not exists after_days integer;
    alter table sm_cmdb_policies add column if not exists max_per_run integer;
    alter table sm_cmdb_policies add column if not exists active boolean not null default false;
    alter table sm_cmdb_policies add column if not exists last_run_at timestamptz;
    alter table sm_cmdb_policies add column if not exists last_affected integer;
    alter table sm_cmdb_policies add column if not exists last_skipped integer;
    alter table sm_cmdb_policies add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_cmdb_policies (
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
  condition jsonb,
  after_days integer,
  max_per_run integer,
  active boolean not null default false,
  last_run_at timestamptz,
  last_affected integer,
  last_skipped integer,
  description text
);
create index if not exists sm_cmdb_policies_rev_idx on sm_cmdb_policies (org_id, rev);
create index if not exists sm_cmdb_policies_upd_idx on sm_cmdb_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_policies_crt_idx on sm_cmdb_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_cmdb_policies_sync on sm_cmdb_policies;
create trigger sm_cmdb_policies_sync before insert or update on sm_cmdb_policies for each row execute function sm_sync_touch('cmdb_policy');
create or replace trigger sm_cmdb_policies_demo after insert on sm_cmdb_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_policies_demo_t after update or delete on sm_cmdb_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_policies enable row level security;

-- cmdb_query: پرس‌وجوهای پیکربندی
do $cols$
begin
  if to_regclass('sm_cmdb_queries') is not null then
    alter table sm_cmdb_queries add column if not exists workspace_id uuid;
    alter table sm_cmdb_queries add column if not exists domain_id uuid;
    alter table sm_cmdb_queries add column if not exists unit_id uuid;
    alter table sm_cmdb_queries add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_queries add column if not exists created_by uuid;
    alter table sm_cmdb_queries add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_queries add column if not exists updated_by uuid;
    alter table sm_cmdb_queries add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_queries add column if not exists version integer not null default 1;
    alter table sm_cmdb_queries add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_queries add column if not exists origin text;
    alter table sm_cmdb_queries add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_queries add column if not exists name text;
    alter table sm_cmdb_queries add column if not exists class text;
    alter table sm_cmdb_queries add column if not exists condition jsonb;
    alter table sm_cmdb_queries add column if not exists steps jsonb;
    alter table sm_cmdb_queries add column if not exists shared boolean not null default false;
    alter table sm_cmdb_queries add column if not exists owner_id uuid;
    alter table sm_cmdb_queries add column if not exists text text;
  end if;
end
$cols$;
create table if not exists sm_cmdb_queries (
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
  class text,
  condition jsonb,
  steps jsonb,
  shared boolean not null default false,
  owner_id uuid,
  text text
);
create index if not exists sm_cmdb_queries_rev_idx on sm_cmdb_queries (org_id, rev);
create index if not exists sm_cmdb_queries_upd_idx on sm_cmdb_queries (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_queries_crt_idx on sm_cmdb_queries (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_queries_workspace_acc_idx on sm_cmdb_queries (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_queries_unit_acc_idx on sm_cmdb_queries (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_queries_domain_acc_idx on sm_cmdb_queries (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_queries_owner_id_idx on sm_cmdb_queries (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_cmdb_queries_sync on sm_cmdb_queries;
create trigger sm_cmdb_queries_sync before insert or update on sm_cmdb_queries for each row execute function sm_sync_touch('cmdb_query');
create or replace trigger sm_cmdb_queries_demo after insert on sm_cmdb_queries for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_queries_demo_t after update or delete on sm_cmdb_queries for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_queries enable row level security;

-- cmdb_rule: قاعده‌های کیفیت داده و ممیزی
do $cols$
begin
  if to_regclass('sm_cmdb_rules') is not null then
    alter table sm_cmdb_rules add column if not exists workspace_id uuid;
    alter table sm_cmdb_rules add column if not exists domain_id uuid;
    alter table sm_cmdb_rules add column if not exists unit_id uuid;
    alter table sm_cmdb_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_cmdb_rules add column if not exists created_by uuid;
    alter table sm_cmdb_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_cmdb_rules add column if not exists updated_by uuid;
    alter table sm_cmdb_rules add column if not exists rev bigint not null default 0;
    alter table sm_cmdb_rules add column if not exists version integer not null default 1;
    alter table sm_cmdb_rules add column if not exists deleted_at timestamptz;
    alter table sm_cmdb_rules add column if not exists origin text;
    alter table sm_cmdb_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_cmdb_rules add column if not exists name text;
    alter table sm_cmdb_rules add column if not exists kind text;
    alter table sm_cmdb_rules add column if not exists severity text;
    alter table sm_cmdb_rules add column if not exists class text;
    alter table sm_cmdb_rules add column if not exists category text;
    alter table sm_cmdb_rules add column if not exists scope_condition jsonb;
    alter table sm_cmdb_rules add column if not exists check_condition jsonb;
    alter table sm_cmdb_rules add column if not exists required_rel jsonb;
    alter table sm_cmdb_rules add column if not exists creates_findings boolean not null default true;
    alter table sm_cmdb_rules add column if not exists due_days integer;
    alter table sm_cmdb_rules add column if not exists active boolean not null default true;
    alter table sm_cmdb_rules add column if not exists last_run_at timestamptz;
    alter table sm_cmdb_rules add column if not exists last_checked integer;
    alter table sm_cmdb_rules add column if not exists last_failing integer;
    alter table sm_cmdb_rules add column if not exists compliance numeric;
    alter table sm_cmdb_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_cmdb_rules (
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
  severity text,
  class text,
  category text,
  scope_condition jsonb,
  check_condition jsonb,
  required_rel jsonb,
  creates_findings boolean not null default true,
  due_days integer,
  active boolean not null default true,
  last_run_at timestamptz,
  last_checked integer,
  last_failing integer,
  compliance numeric,
  description text
);
create index if not exists sm_cmdb_rules_rev_idx on sm_cmdb_rules (org_id, rev);
create index if not exists sm_cmdb_rules_upd_idx on sm_cmdb_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_rules_crt_idx on sm_cmdb_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_cmdb_rules_sync on sm_cmdb_rules;
create trigger sm_cmdb_rules_sync before insert or update on sm_cmdb_rules for each row execute function sm_sync_touch('cmdb_rule');
create or replace trigger sm_cmdb_rules_demo after insert on sm_cmdb_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cmdb_rules_demo_t after update or delete on sm_cmdb_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cmdb_rules enable row level security;

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
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_continuity_plans' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_continuity_plans', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_continuity_plans', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_continuity_plans' and indexname like 'sm\_continuity\_plans\_search\_%' and indexname not in ('sm_continuity_plans_search_cae18f1d_trgm', 'sm_continuity_plans_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
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
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_contracts' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_dbfbeeb6' loop
    execute format('alter table %I drop column if exists %I', 'sm_contracts', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_contracts', 'search_dbfbeeb6', $x$translate(coalesce(name, '') || ' ' || coalesce(vendor_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_contracts' and indexname like 'sm\_contracts\_search\_%' and indexname not in ('sm_contracts_search_dbfbeeb6_trgm', 'sm_contracts_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
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
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_contract_guarantees' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_a176303d' loop
    execute format('alter table %I drop column if exists %I', 'sm_contract_guarantees', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_contract_guarantees', 'search_a176303d', $x$translate(coalesce(issuer, '') || ' ' || coalesce(reference_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_contract_guarantees' and indexname like 'sm\_contract\_guarantees\_search\_%' and indexname not in ('sm_contract_guarantees_search_a176303d_trgm', 'sm_contract_guarantees_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
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
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_contract_obligations' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_contract_obligations', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_contract_obligations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_contract_obligations' and indexname like 'sm\_contract\_obligations\_search\_%' and indexname not in ('sm_contract_obligations_search_cae18f1d_trgm', 'sm_contract_obligations_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
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
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_corrective_actions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_corrective_actions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_corrective_actions', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_corrective_actions' and indexname like 'sm\_corrective\_actions\_search\_%' and indexname not in ('sm_corrective_actions_search_f3bce210_trgm', 'sm_corrective_actions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:6', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۵ از ۹ (0006_engine_tables:14/28 … 0006_engine_tables:16/28)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۴ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 14/28 (e746bd22eb04)
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_incident_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_incident_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_install_base_items', 'search_da0ea237', $x$translate(coalesce(name, '') || ' ' || coalesce(serial_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_interactions', 'search_2b0ba683', $x$translate(coalesce(short_description, '') || ' ' || coalesce(transcript, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_inventory_audits', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_journeys', 'search_ee4d45e2', $x$translate(coalesce(name, '') || ' ' || coalesce(subject_name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:13', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۵ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 15/28 (e746bd22eb04)
-- kb_article: مقاله‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_articles') is not null then
    alter table sm_kb_articles add column if not exists workspace_id uuid;
    alter table sm_kb_articles add column if not exists domain_id uuid;
    alter table sm_kb_articles add column if not exists unit_id uuid;
    alter table sm_kb_articles add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_articles add column if not exists created_by uuid;
    alter table sm_kb_articles add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_articles add column if not exists updated_by uuid;
    alter table sm_kb_articles add column if not exists rev bigint not null default 0;
    alter table sm_kb_articles add column if not exists version integer not null default 1;
    alter table sm_kb_articles add column if not exists deleted_at timestamptz;
    alter table sm_kb_articles add column if not exists origin text;
    alter table sm_kb_articles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_articles add column if not exists no integer;
    alter table sm_kb_articles add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KB' || no::text else 'KB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_articles add column if not exists title text;
    alter table sm_kb_articles add column if not exists summary text;
    alter table sm_kb_articles add column if not exists body text;
    alter table sm_kb_articles add column if not exists internal_body text;
    alter table sm_kb_articles add column if not exists keywords jsonb;
    alter table sm_kb_articles add column if not exists tags jsonb;
    alter table sm_kb_articles add column if not exists article_type text;
    alter table sm_kb_articles add column if not exists template_id uuid;
    alter table sm_kb_articles add column if not exists language text;
    alter table sm_kb_articles add column if not exists external_url text;
    alter table sm_kb_articles add column if not exists base_id uuid;
    alter table sm_kb_articles add column if not exists category_id uuid;
    alter table sm_kb_articles add column if not exists author_id uuid;
    alter table sm_kb_articles add column if not exists owner_id uuid;
    alter table sm_kb_articles add column if not exists owner_group_id uuid;
    alter table sm_kb_articles add column if not exists visibility text;
    alter table sm_kb_articles add column if not exists confidential boolean not null default false;
    alter table sm_kb_articles add column if not exists access_list jsonb;
    alter table sm_kb_articles add column if not exists audience_mode text;
    alter table sm_kb_articles add column if not exists units_tree boolean not null default true;
    alter table sm_kb_articles add column if not exists read_users jsonb;
    alter table sm_kb_articles add column if not exists read_groups jsonb;
    alter table sm_kb_articles add column if not exists read_units jsonb;
    alter table sm_kb_articles add column if not exists deny_users jsonb;
    alter table sm_kb_articles add column if not exists deny_groups jsonb;
    alter table sm_kb_articles add column if not exists deny_units jsonb;
    alter table sm_kb_articles add column if not exists kcs_confidence text;
    alter table sm_kb_articles add column if not exists governance text;
    alter table sm_kb_articles add column if not exists classification text;
    alter table sm_kb_articles add column if not exists valid_from date;
    alter table sm_kb_articles add column if not exists valid_to date;
    alter table sm_kb_articles add column if not exists review_at date;
    alter table sm_kb_articles add column if not exists retire_at date;
    alter table sm_kb_articles add column if not exists retire_reason text;
    alter table sm_kb_articles add column if not exists replaced_by uuid;
    alter table sm_kb_articles add column if not exists doc_number text;
    alter table sm_kb_articles add column if not exists issuing_authority text;
    alter table sm_kb_articles add column if not exists effective_date date;
    alter table sm_kb_articles add column if not exists last_reviewed_at timestamptz;
    alter table sm_kb_articles add column if not exists last_reviewed_by uuid;
    alter table sm_kb_articles add column if not exists review_due boolean not null default false;
    alter table sm_kb_articles add column if not exists published_at timestamptz;
    alter table sm_kb_articles add column if not exists published_by uuid;
    alter table sm_kb_articles add column if not exists first_published_at timestamptz;
    alter table sm_kb_articles add column if not exists retired_at timestamptz;
    alter table sm_kb_articles add column if not exists version_label text;
    alter table sm_kb_articles add column if not exists major integer;
    alter table sm_kb_articles add column if not exists minor integer;
    alter table sm_kb_articles add column if not exists published_version_id uuid;
    alter table sm_kb_articles add column if not exists draft_version_id uuid;
    alter table sm_kb_articles add column if not exists has_draft boolean not null default false;
    alter table sm_kb_articles add column if not exists service_id uuid;
    alter table sm_kb_articles add column if not exists ci_id uuid;
    alter table sm_kb_articles add column if not exists known_error_id uuid;
    alter table sm_kb_articles add column if not exists problem_id uuid;
    alter table sm_kb_articles add column if not exists translation_of uuid;
    alter table sm_kb_articles add column if not exists master_version integer;
    alter table sm_kb_articles add column if not exists translation_stale boolean not null default false;
    alter table sm_kb_articles add column if not exists machine_translated boolean not null default false;
    alter table sm_kb_articles add column if not exists source_table text;
    alter table sm_kb_articles add column if not exists source_id text;
    alter table sm_kb_articles add column if not exists source_number text;
    alter table sm_kb_articles add column if not exists ai_use text;
    alter table sm_kb_articles add column if not exists ai_requesters boolean not null default true;
    alter table sm_kb_articles add column if not exists ai_provenance jsonb;
    alter table sm_kb_articles add column if not exists view_count integer;
    alter table sm_kb_articles add column if not exists reuse_count integer;
    alter table sm_kb_articles add column if not exists helpful_yes integer;
    alter table sm_kb_articles add column if not exists helpful_no integer;
    alter table sm_kb_articles add column if not exists rating_avg numeric;
    alter table sm_kb_articles add column if not exists rating_count integer;
    alter table sm_kb_articles add column if not exists open_flags integer;
    alter table sm_kb_articles add column if not exists health_score integer;
    alter table sm_kb_articles add column if not exists quality_score integer;
    alter table sm_kb_articles add column if not exists next_action text;
    alter table sm_kb_articles add column if not exists last_used_at timestamptz;
    alter table sm_kb_articles add column if not exists reviewer_ids jsonb;
    alter table sm_kb_articles add column if not exists approval text;
    alter table sm_kb_articles add column if not exists r_units jsonb;
    alter table sm_kb_articles add column if not exists x_units jsonb;
    alter table sm_kb_articles add column if not exists trashed_at timestamptz;
    alter table sm_kb_articles add column if not exists k_users jsonb;
    alter table sm_kb_articles add column if not exists k_groups jsonb;
    alter table sm_kb_articles add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_articles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KB' || no::text else 'KB' || lpad(no::text, 6, '0') end) stored,
  title text,
  summary text,
  body text,
  internal_body text,
  keywords jsonb,
  tags jsonb,
  article_type text,
  template_id uuid,
  language text,
  external_url text,
  base_id uuid,
  category_id uuid,
  author_id uuid,
  owner_id uuid,
  owner_group_id uuid,
  visibility text,
  confidential boolean not null default false,
  access_list jsonb,
  audience_mode text,
  units_tree boolean not null default true,
  read_users jsonb,
  read_groups jsonb,
  read_units jsonb,
  deny_users jsonb,
  deny_groups jsonb,
  deny_units jsonb,
  kcs_confidence text,
  governance text,
  classification text,
  valid_from date,
  valid_to date,
  review_at date,
  retire_at date,
  retire_reason text,
  replaced_by uuid,
  doc_number text,
  issuing_authority text,
  effective_date date,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid,
  review_due boolean not null default false,
  published_at timestamptz,
  published_by uuid,
  first_published_at timestamptz,
  retired_at timestamptz,
  version_label text,
  major integer,
  minor integer,
  published_version_id uuid,
  draft_version_id uuid,
  has_draft boolean not null default false,
  service_id uuid,
  ci_id uuid,
  known_error_id uuid,
  problem_id uuid,
  translation_of uuid,
  master_version integer,
  translation_stale boolean not null default false,
  machine_translated boolean not null default false,
  source_table text,
  source_id text,
  source_number text,
  ai_use text,
  ai_requesters boolean not null default true,
  ai_provenance jsonb,
  view_count integer,
  reuse_count integer,
  helpful_yes integer,
  helpful_no integer,
  rating_avg numeric,
  rating_count integer,
  open_flags integer,
  health_score integer,
  quality_score integer,
  next_action text,
  last_used_at timestamptz,
  reviewer_ids jsonb,
  approval text,
  r_units jsonb,
  x_units jsonb,
  trashed_at timestamptz,
  k_users jsonb,
  k_groups jsonb,
  state text,
  search_5f9fce8f text generated always as (translate(coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '') || ' ' || coalesce(doc_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_articles', 'search_5f9fce8f', $x$translate(coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '') || ' ' || coalesce(doc_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_articles_search_5f9fce8f_trgm', 'sm_kb_articles', 'search_5f9fce8f', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_articles_search_custom_trgm', 'sm_kb_articles', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_articles_no_uk on sm_kb_articles (org_id, no);
create index if not exists sm_kb_articles_rev_idx on sm_kb_articles (org_id, rev);
create index if not exists sm_kb_articles_upd_idx on sm_kb_articles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_articles_crt_idx on sm_kb_articles (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_articles_base_id_idx on sm_kb_articles (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_articles_category_id_idx on sm_kb_articles (org_id, category_id) where deleted_at is null;
create index if not exists sm_kb_articles_author_id_idx on sm_kb_articles (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_articles_owner_id_idx on sm_kb_articles (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_articles_owner_group_id_idx on sm_kb_articles (org_id, owner_group_id) where deleted_at is null;
create index if not exists sm_kb_articles_known_error_id_idx on sm_kb_articles (org_id, known_error_id) where deleted_at is null;
create index if not exists sm_kb_articles_translation_of_idx on sm_kb_articles (org_id, translation_of) where deleted_at is null;
create index if not exists sm_kb_articles_source_id_idx on sm_kb_articles (org_id, source_id) where deleted_at is null;
create index if not exists sm_kb_articles_reviewer_ids_gin on sm_kb_articles using gin (reviewer_ids);
create index if not exists sm_kb_articles_k_users_gin on sm_kb_articles using gin (k_users);
create index if not exists sm_kb_articles_k_groups_gin on sm_kb_articles using gin (k_groups);
create index if not exists sm_kb_articles_state_idx on sm_kb_articles (org_id, state) where deleted_at is null;
create index if not exists sm_kb_articles_workspace_acc_idx on sm_kb_articles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_articles_unit_acc_idx on sm_kb_articles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_articles_domain_acc_idx on sm_kb_articles (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_articles_sync on sm_kb_articles;
create trigger sm_kb_articles_sync before insert or update on sm_kb_articles for each row execute function sm_sync_touch('kb_article');
create or replace trigger sm_kb_articles_demo after insert on sm_kb_articles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_articles_demo_t after update or delete on sm_kb_articles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_articles enable row level security;

-- kb_attestation: کارزارهای تأیید مطالعه
do $cols$
begin
  if to_regclass('sm_kb_attestations') is not null then
    alter table sm_kb_attestations add column if not exists workspace_id uuid;
    alter table sm_kb_attestations add column if not exists domain_id uuid;
    alter table sm_kb_attestations add column if not exists unit_id uuid;
    alter table sm_kb_attestations add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_attestations add column if not exists created_by uuid;
    alter table sm_kb_attestations add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_attestations add column if not exists updated_by uuid;
    alter table sm_kb_attestations add column if not exists rev bigint not null default 0;
    alter table sm_kb_attestations add column if not exists version integer not null default 1;
    alter table sm_kb_attestations add column if not exists deleted_at timestamptz;
    alter table sm_kb_attestations add column if not exists origin text;
    alter table sm_kb_attestations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_attestations add column if not exists no integer;
    alter table sm_kb_attestations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ATT' || no::text else 'ATT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_attestations add column if not exists title text;
    alter table sm_kb_attestations add column if not exists article_id uuid;
    alter table sm_kb_attestations add column if not exists version_label text;
    alter table sm_kb_attestations add column if not exists due_at date;
    alter table sm_kb_attestations add column if not exists owner_id uuid;
    alter table sm_kb_attestations add column if not exists remind_every_days integer;
    alter table sm_kb_attestations add column if not exists target_users jsonb;
    alter table sm_kb_attestations add column if not exists target_groups jsonb;
    alter table sm_kb_attestations add column if not exists target_units jsonb;
    alter table sm_kb_attestations add column if not exists audience_count integer;
    alter table sm_kb_attestations add column if not exists ack_count integer;
    alter table sm_kb_attestations add column if not exists reminded_at timestamptz;
    alter table sm_kb_attestations add column if not exists k_users jsonb;
    alter table sm_kb_attestations add column if not exists k_groups jsonb;
    alter table sm_kb_attestations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_attestations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ATT' || no::text else 'ATT' || lpad(no::text, 6, '0') end) stored,
  title text,
  article_id uuid,
  version_label text,
  due_at date,
  owner_id uuid,
  remind_every_days integer,
  target_users jsonb,
  target_groups jsonb,
  target_units jsonb,
  audience_count integer,
  ack_count integer,
  reminded_at timestamptz,
  k_users jsonb,
  k_groups jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_attestations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_attestations_search_cae18f1d_trgm', 'sm_kb_attestations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_attestations_search_custom_trgm', 'sm_kb_attestations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_attestations_no_uk on sm_kb_attestations (org_id, no);
create index if not exists sm_kb_attestations_rev_idx on sm_kb_attestations (org_id, rev);
create index if not exists sm_kb_attestations_upd_idx on sm_kb_attestations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_crt_idx on sm_kb_attestations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_article_id_idx on sm_kb_attestations (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_attestations_owner_id_idx on sm_kb_attestations (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_attestations_k_users_gin on sm_kb_attestations using gin (k_users);
create index if not exists sm_kb_attestations_k_groups_gin on sm_kb_attestations using gin (k_groups);
create index if not exists sm_kb_attestations_state_idx on sm_kb_attestations (org_id, state) where deleted_at is null;
create index if not exists sm_kb_attestations_workspace_acc_idx on sm_kb_attestations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_attestations_unit_acc_idx on sm_kb_attestations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_attestations_domain_acc_idx on sm_kb_attestations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_attestations_sync on sm_kb_attestations;
create trigger sm_kb_attestations_sync before insert or update on sm_kb_attestations for each row execute function sm_sync_touch('kb_attestation');
create or replace trigger sm_kb_attestations_demo after insert on sm_kb_attestations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_attestations_demo_t after update or delete on sm_kb_attestations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_attestations enable row level security;

-- kb_base: پایگاه‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_bases') is not null then
    alter table sm_kb_bases add column if not exists workspace_id uuid;
    alter table sm_kb_bases add column if not exists domain_id uuid;
    alter table sm_kb_bases add column if not exists unit_id uuid;
    alter table sm_kb_bases add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_bases add column if not exists created_by uuid;
    alter table sm_kb_bases add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_bases add column if not exists updated_by uuid;
    alter table sm_kb_bases add column if not exists rev bigint not null default 0;
    alter table sm_kb_bases add column if not exists version integer not null default 1;
    alter table sm_kb_bases add column if not exists deleted_at timestamptz;
    alter table sm_kb_bases add column if not exists origin text;
    alter table sm_kb_bases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_bases add column if not exists name text;
    alter table sm_kb_bases add column if not exists kind text;
    alter table sm_kb_bases add column if not exists description text;
    alter table sm_kb_bases add column if not exists icon text;
    alter table sm_kb_bases add column if not exists color text;
    alter table sm_kb_bases add column if not exists sort_order integer;
    alter table sm_kb_bases add column if not exists owner_id uuid;
    alter table sm_kb_bases add column if not exists manager_group_id uuid;
    alter table sm_kb_bases add column if not exists classification text;
    alter table sm_kb_bases add column if not exists languages jsonb;
    alter table sm_kb_bases add column if not exists read_mode text;
    alter table sm_kb_bases add column if not exists units_tree boolean not null default true;
    alter table sm_kb_bases add column if not exists read_users jsonb;
    alter table sm_kb_bases add column if not exists read_groups jsonb;
    alter table sm_kb_bases add column if not exists read_units jsonb;
    alter table sm_kb_bases add column if not exists deny_users jsonb;
    alter table sm_kb_bases add column if not exists deny_groups jsonb;
    alter table sm_kb_bases add column if not exists deny_units jsonb;
    alter table sm_kb_bases add column if not exists contrib_mode text;
    alter table sm_kb_bases add column if not exists contrib_users jsonb;
    alter table sm_kb_bases add column if not exists contrib_groups jsonb;
    alter table sm_kb_bases add column if not exists nocontrib_users jsonb;
    alter table sm_kb_bases add column if not exists nocontrib_groups jsonb;
    alter table sm_kb_bases add column if not exists publish_approval boolean not null default true;
    alter table sm_kb_bases add column if not exists approval_mode text;
    alter table sm_kb_bases add column if not exists retire_approval boolean not null default false;
    alter table sm_kb_bases add column if not exists approvers jsonb;
    alter table sm_kb_bases add column if not exists approver_groups jsonb;
    alter table sm_kb_bases add column if not exists allowed_templates jsonb;
    alter table sm_kb_bases add column if not exists default_template_id uuid;
    alter table sm_kb_bases add column if not exists default_valid_days integer;
    alter table sm_kb_bases add column if not exists review_days integer;
    alter table sm_kb_bases add column if not exists review_policy text;
    alter table sm_kb_bases add column if not exists kcs_enabled boolean not null default false;
    alter table sm_kb_bases add column if not exists publishing_model text;
    alter table sm_kb_bases add column if not exists external_after_reuses integer;
    alter table sm_kb_bases add column if not exists conveyor_days integer;
    alter table sm_kb_bases add column if not exists allow_comments boolean not null default true;
    alter table sm_kb_bases add column if not exists allow_ratings boolean not null default true;
    alter table sm_kb_bases add column if not exists ai_enabled boolean not null default true;
    alter table sm_kb_bases add column if not exists ai_requesters boolean not null default true;
    alter table sm_kb_bases add column if not exists confidential boolean not null default false;
    alter table sm_kb_bases add column if not exists k_users jsonb;
    alter table sm_kb_bases add column if not exists k_groups jsonb;
    alter table sm_kb_bases add column if not exists r_units jsonb;
    alter table sm_kb_bases add column if not exists x_units jsonb;
    alter table sm_kb_bases add column if not exists article_count integer;
    alter table sm_kb_bases add column if not exists access_list jsonb;
    alter table sm_kb_bases add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_bases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  description text,
  icon text,
  color text,
  sort_order integer,
  owner_id uuid,
  manager_group_id uuid,
  classification text,
  languages jsonb,
  read_mode text,
  units_tree boolean not null default true,
  read_users jsonb,
  read_groups jsonb,
  read_units jsonb,
  deny_users jsonb,
  deny_groups jsonb,
  deny_units jsonb,
  contrib_mode text,
  contrib_users jsonb,
  contrib_groups jsonb,
  nocontrib_users jsonb,
  nocontrib_groups jsonb,
  publish_approval boolean not null default true,
  approval_mode text,
  retire_approval boolean not null default false,
  approvers jsonb,
  approver_groups jsonb,
  allowed_templates jsonb,
  default_template_id uuid,
  default_valid_days integer,
  review_days integer,
  review_policy text,
  kcs_enabled boolean not null default false,
  publishing_model text,
  external_after_reuses integer,
  conveyor_days integer,
  allow_comments boolean not null default true,
  allow_ratings boolean not null default true,
  ai_enabled boolean not null default true,
  ai_requesters boolean not null default true,
  confidential boolean not null default false,
  k_users jsonb,
  k_groups jsonb,
  r_units jsonb,
  x_units jsonb,
  article_count integer,
  access_list jsonb,
  state text
);
create index if not exists sm_kb_bases_rev_idx on sm_kb_bases (org_id, rev);
create index if not exists sm_kb_bases_upd_idx on sm_kb_bases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_bases_crt_idx on sm_kb_bases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_bases_owner_id_idx on sm_kb_bases (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_bases_manager_group_id_idx on sm_kb_bases (org_id, manager_group_id) where deleted_at is null;
create index if not exists sm_kb_bases_k_users_gin on sm_kb_bases using gin (k_users);
create index if not exists sm_kb_bases_k_groups_gin on sm_kb_bases using gin (k_groups);
create index if not exists sm_kb_bases_state_idx on sm_kb_bases (org_id, state) where deleted_at is null;
create unique index if not exists sm_kb_bases_name_uk on sm_kb_bases (org_id, name) where deleted_at is null;
create index if not exists sm_kb_bases_workspace_acc_idx on sm_kb_bases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_bases_unit_acc_idx on sm_kb_bases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_bases_domain_acc_idx on sm_kb_bases (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_bases_sync on sm_kb_bases;
create trigger sm_kb_bases_sync before insert or update on sm_kb_bases for each row execute function sm_sync_touch('kb_base');
create or replace trigger sm_kb_bases_demo after insert on sm_kb_bases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_bases_demo_t after update or delete on sm_kb_bases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_bases enable row level security;

-- kb_block: بلوک‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_blocks') is not null then
    alter table sm_kb_blocks add column if not exists workspace_id uuid;
    alter table sm_kb_blocks add column if not exists domain_id uuid;
    alter table sm_kb_blocks add column if not exists unit_id uuid;
    alter table sm_kb_blocks add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_blocks add column if not exists created_by uuid;
    alter table sm_kb_blocks add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_blocks add column if not exists updated_by uuid;
    alter table sm_kb_blocks add column if not exists rev bigint not null default 0;
    alter table sm_kb_blocks add column if not exists version integer not null default 1;
    alter table sm_kb_blocks add column if not exists deleted_at timestamptz;
    alter table sm_kb_blocks add column if not exists origin text;
    alter table sm_kb_blocks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_blocks add column if not exists no integer;
    alter table sm_kb_blocks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBB' || no::text else 'KBB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_blocks add column if not exists title text;
    alter table sm_kb_blocks add column if not exists visibility text;
    alter table sm_kb_blocks add column if not exists body text;
    alter table sm_kb_blocks add column if not exists owner_id uuid;
    alter table sm_kb_blocks add column if not exists owner_group_id uuid;
    alter table sm_kb_blocks add column if not exists confidential boolean not null default false;
    alter table sm_kb_blocks add column if not exists used_in jsonb;
    alter table sm_kb_blocks add column if not exists access_list jsonb;
    alter table sm_kb_blocks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_blocks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBB' || no::text else 'KBB' || lpad(no::text, 6, '0') end) stored,
  title text,
  visibility text,
  body text,
  owner_id uuid,
  owner_group_id uuid,
  confidential boolean not null default false,
  used_in jsonb,
  access_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_blocks', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_blocks_search_cae18f1d_trgm', 'sm_kb_blocks', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_blocks_search_custom_trgm', 'sm_kb_blocks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_blocks_no_uk on sm_kb_blocks (org_id, no);
create index if not exists sm_kb_blocks_rev_idx on sm_kb_blocks (org_id, rev);
create index if not exists sm_kb_blocks_upd_idx on sm_kb_blocks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_blocks_crt_idx on sm_kb_blocks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_blocks_owner_id_idx on sm_kb_blocks (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_blocks_state_idx on sm_kb_blocks (org_id, state) where deleted_at is null;
create index if not exists sm_kb_blocks_workspace_acc_idx on sm_kb_blocks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_blocks_unit_acc_idx on sm_kb_blocks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_blocks_domain_acc_idx on sm_kb_blocks (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_blocks_sync on sm_kb_blocks;
create trigger sm_kb_blocks_sync before insert or update on sm_kb_blocks for each row execute function sm_sync_touch('kb_block');
create or replace trigger sm_kb_blocks_demo after insert on sm_kb_blocks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_blocks_demo_t after update or delete on sm_kb_blocks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_blocks enable row level security;

-- kb_category: دسته‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_categories') is not null then
    alter table sm_kb_categories add column if not exists workspace_id uuid;
    alter table sm_kb_categories add column if not exists domain_id uuid;
    alter table sm_kb_categories add column if not exists unit_id uuid;
    alter table sm_kb_categories add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_categories add column if not exists created_by uuid;
    alter table sm_kb_categories add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_categories add column if not exists updated_by uuid;
    alter table sm_kb_categories add column if not exists rev bigint not null default 0;
    alter table sm_kb_categories add column if not exists version integer not null default 1;
    alter table sm_kb_categories add column if not exists deleted_at timestamptz;
    alter table sm_kb_categories add column if not exists origin text;
    alter table sm_kb_categories add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_categories add column if not exists name text;
    alter table sm_kb_categories add column if not exists base_id uuid;
    alter table sm_kb_categories add column if not exists parent_id uuid;
    alter table sm_kb_categories add column if not exists sort_order integer;
    alter table sm_kb_categories add column if not exists icon text;
    alter table sm_kb_categories add column if not exists description text;
    alter table sm_kb_categories add column if not exists featured jsonb;
    alter table sm_kb_categories add column if not exists managed_by_groups jsonb;
    alter table sm_kb_categories add column if not exists read_mode text;
    alter table sm_kb_categories add column if not exists units_tree boolean not null default true;
    alter table sm_kb_categories add column if not exists read_users jsonb;
    alter table sm_kb_categories add column if not exists read_groups jsonb;
    alter table sm_kb_categories add column if not exists read_units jsonb;
    alter table sm_kb_categories add column if not exists path text;
    alter table sm_kb_categories add column if not exists depth integer;
    alter table sm_kb_categories add column if not exists c_all boolean not null default true;
    alter table sm_kb_categories add column if not exists c_users jsonb;
    alter table sm_kb_categories add column if not exists c_groups jsonb;
    alter table sm_kb_categories add column if not exists c_units jsonb;
    alter table sm_kb_categories add column if not exists m_groups jsonb;
    alter table sm_kb_categories add column if not exists article_count integer;
    alter table sm_kb_categories add column if not exists k_users jsonb;
    alter table sm_kb_categories add column if not exists k_groups jsonb;
    alter table sm_kb_categories add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_categories (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  base_id uuid,
  parent_id uuid,
  sort_order integer,
  icon text,
  description text,
  featured jsonb,
  managed_by_groups jsonb,
  read_mode text,
  units_tree boolean not null default true,
  read_users jsonb,
  read_groups jsonb,
  read_units jsonb,
  path text,
  depth integer,
  c_all boolean not null default true,
  c_users jsonb,
  c_groups jsonb,
  c_units jsonb,
  m_groups jsonb,
  article_count integer,
  k_users jsonb,
  k_groups jsonb,
  state text
);
create index if not exists sm_kb_categories_rev_idx on sm_kb_categories (org_id, rev);
create index if not exists sm_kb_categories_upd_idx on sm_kb_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_crt_idx on sm_kb_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_base_id_idx on sm_kb_categories (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_categories_parent_id_idx on sm_kb_categories (org_id, parent_id) where deleted_at is null;
create index if not exists sm_kb_categories_m_groups_gin on sm_kb_categories using gin (m_groups);
create index if not exists sm_kb_categories_k_users_gin on sm_kb_categories using gin (k_users);
create index if not exists sm_kb_categories_k_groups_gin on sm_kb_categories using gin (k_groups);
create index if not exists sm_kb_categories_state_idx on sm_kb_categories (org_id, state) where deleted_at is null;
drop trigger if exists sm_kb_categories_sync on sm_kb_categories;
create trigger sm_kb_categories_sync before insert or update on sm_kb_categories for each row execute function sm_sync_touch('kb_category');
create or replace trigger sm_kb_categories_demo after insert on sm_kb_categories for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_categories_demo_t after update or delete on sm_kb_categories for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_categories enable row level security;

-- kb_config: تنظیمات دانش
do $cols$
begin
  if to_regclass('sm_kb_configs') is not null then
    alter table sm_kb_configs add column if not exists workspace_id uuid;
    alter table sm_kb_configs add column if not exists domain_id uuid;
    alter table sm_kb_configs add column if not exists unit_id uuid;
    alter table sm_kb_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_configs add column if not exists created_by uuid;
    alter table sm_kb_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_configs add column if not exists updated_by uuid;
    alter table sm_kb_configs add column if not exists rev bigint not null default 0;
    alter table sm_kb_configs add column if not exists version integer not null default 1;
    alter table sm_kb_configs add column if not exists deleted_at timestamptz;
    alter table sm_kb_configs add column if not exists origin text;
    alter table sm_kb_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_configs add column if not exists name text;
    alter table sm_kb_configs add column if not exists config_key text;
    alter table sm_kb_configs add column if not exists default_group_id uuid;
    alter table sm_kb_configs add column if not exists review_remind_days integer;
    alter table sm_kb_configs add column if not exists negative_ratio integer;
    alter table sm_kb_configs add column if not exists negative_min_votes integer;
    alter table sm_kb_configs add column if not exists trash_days integer;
    alter table sm_kb_configs add column if not exists events_days integer;
    alter table sm_kb_configs add column if not exists deflection_hours integer;
    alter table sm_kb_configs add column if not exists aqi_per_author integer;
    alter table sm_kb_configs add column if not exists aqi_items jsonb;
    alter table sm_kb_configs add column if not exists duplicate_threshold integer;
    alter table sm_kb_configs add column if not exists suggest_limit integer;
    alter table sm_kb_configs add column if not exists stale_days integer;
    alter table sm_kb_configs add column if not exists capture_on_resolve boolean not null default true;
    alter table sm_kb_configs add column if not exists ack_suggestions boolean not null default false;
    alter table sm_kb_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_kb_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  review_remind_days integer,
  negative_ratio integer,
  negative_min_votes integer,
  trash_days integer,
  events_days integer,
  deflection_hours integer,
  aqi_per_author integer,
  aqi_items jsonb,
  duplicate_threshold integer,
  suggest_limit integer,
  stale_days integer,
  capture_on_resolve boolean not null default true,
  ack_suggestions boolean not null default false,
  seeded integer
);
create index if not exists sm_kb_configs_rev_idx on sm_kb_configs (org_id, rev);
create index if not exists sm_kb_configs_upd_idx on sm_kb_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_configs_crt_idx on sm_kb_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_configs_config_key_uk on sm_kb_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_kb_configs_sync on sm_kb_configs;
create trigger sm_kb_configs_sync before insert or update on sm_kb_configs for each row execute function sm_sync_touch('kb_config');
create or replace trigger sm_kb_configs_demo after insert on sm_kb_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_configs_demo_t after update or delete on sm_kb_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_configs enable row level security;

-- kb_decision_tree: درخت‌های تصمیم
do $cols$
begin
  if to_regclass('sm_kb_decision_trees') is not null then
    alter table sm_kb_decision_trees add column if not exists workspace_id uuid;
    alter table sm_kb_decision_trees add column if not exists domain_id uuid;
    alter table sm_kb_decision_trees add column if not exists unit_id uuid;
    alter table sm_kb_decision_trees add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_decision_trees add column if not exists created_by uuid;
    alter table sm_kb_decision_trees add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_decision_trees add column if not exists updated_by uuid;
    alter table sm_kb_decision_trees add column if not exists rev bigint not null default 0;
    alter table sm_kb_decision_trees add column if not exists version integer not null default 1;
    alter table sm_kb_decision_trees add column if not exists deleted_at timestamptz;
    alter table sm_kb_decision_trees add column if not exists origin text;
    alter table sm_kb_decision_trees add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_decision_trees add column if not exists no integer;
    alter table sm_kb_decision_trees add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'KDT' || no::text else 'KDT' || lpad(no::text, 5, '0') end) stored;
    alter table sm_kb_decision_trees add column if not exists title text;
    alter table sm_kb_decision_trees add column if not exists base_id uuid;
    alter table sm_kb_decision_trees add column if not exists description text;
    alter table sm_kb_decision_trees add column if not exists nodes jsonb;
    alter table sm_kb_decision_trees add column if not exists start text;
    alter table sm_kb_decision_trees add column if not exists owner_id uuid;
    alter table sm_kb_decision_trees add column if not exists owner_group_id uuid;
    alter table sm_kb_decision_trees add column if not exists visibility text;
    alter table sm_kb_decision_trees add column if not exists confidential boolean not null default false;
    alter table sm_kb_decision_trees add column if not exists starts integer;
    alter table sm_kb_decision_trees add column if not exists finishes integer;
    alter table sm_kb_decision_trees add column if not exists k_users jsonb;
    alter table sm_kb_decision_trees add column if not exists k_groups jsonb;
    alter table sm_kb_decision_trees add column if not exists access_list jsonb;
    alter table sm_kb_decision_trees add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_decision_trees (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'KDT' || no::text else 'KDT' || lpad(no::text, 5, '0') end) stored,
  title text,
  base_id uuid,
  description text,
  nodes jsonb,
  start text,
  owner_id uuid,
  owner_group_id uuid,
  visibility text,
  confidential boolean not null default false,
  starts integer,
  finishes integer,
  k_users jsonb,
  k_groups jsonb,
  access_list jsonb,
  state text,
  search_e3000752 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_decision_trees', 'search_e3000752', $x$translate(coalesce(title, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_decision_trees_search_e3000752_trgm', 'sm_kb_decision_trees', 'search_e3000752', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_decision_trees_search_custom_trgm', 'sm_kb_decision_trees', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_decision_trees_no_uk on sm_kb_decision_trees (org_id, no);
create index if not exists sm_kb_decision_trees_rev_idx on sm_kb_decision_trees (org_id, rev);
create index if not exists sm_kb_decision_trees_upd_idx on sm_kb_decision_trees (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_crt_idx on sm_kb_decision_trees (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_k_users_gin on sm_kb_decision_trees using gin (k_users);
create index if not exists sm_kb_decision_trees_k_groups_gin on sm_kb_decision_trees using gin (k_groups);
create index if not exists sm_kb_decision_trees_state_idx on sm_kb_decision_trees (org_id, state) where deleted_at is null;
create index if not exists sm_kb_decision_trees_workspace_acc_idx on sm_kb_decision_trees (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_decision_trees_unit_acc_idx on sm_kb_decision_trees (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_decision_trees_domain_acc_idx on sm_kb_decision_trees (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_kb_decision_trees_owner_id_idx on sm_kb_decision_trees (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_kb_decision_trees_sync on sm_kb_decision_trees;
create trigger sm_kb_decision_trees_sync before insert or update on sm_kb_decision_trees for each row execute function sm_sync_touch('kb_decision_tree');
create or replace trigger sm_kb_decision_trees_demo after insert on sm_kb_decision_trees for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_decision_trees_demo_t after update or delete on sm_kb_decision_trees for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_decision_trees enable row level security;

-- kb_domain: حوزه‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_domains') is not null then
    alter table sm_kb_domains add column if not exists workspace_id uuid;
    alter table sm_kb_domains add column if not exists domain_id uuid;
    alter table sm_kb_domains add column if not exists unit_id uuid;
    alter table sm_kb_domains add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_domains add column if not exists created_by uuid;
    alter table sm_kb_domains add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_domains add column if not exists updated_by uuid;
    alter table sm_kb_domains add column if not exists rev bigint not null default 0;
    alter table sm_kb_domains add column if not exists version integer not null default 1;
    alter table sm_kb_domains add column if not exists deleted_at timestamptz;
    alter table sm_kb_domains add column if not exists origin text;
    alter table sm_kb_domains add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_domains add column if not exists name text;
    alter table sm_kb_domains add column if not exists kde_id uuid;
    alter table sm_kb_domains add column if not exists bases jsonb;
    alter table sm_kb_domains add column if not exists categories jsonb;
    alter table sm_kb_domains add column if not exists capture_days integer;
    alter table sm_kb_domains add column if not exists description text;
    alter table sm_kb_domains add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_kb_domains (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  kde_id uuid,
  bases jsonb,
  categories jsonb,
  capture_days integer,
  description text,
  active boolean not null default true
);
create index if not exists sm_kb_domains_rev_idx on sm_kb_domains (org_id, rev);
create index if not exists sm_kb_domains_upd_idx on sm_kb_domains (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_domains_crt_idx on sm_kb_domains (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_domains_name_uk on sm_kb_domains (org_id, name) where deleted_at is null;
drop trigger if exists sm_kb_domains_sync on sm_kb_domains;
create trigger sm_kb_domains_sync before insert or update on sm_kb_domains for each row execute function sm_sync_touch('kb_domain');
create or replace trigger sm_kb_domains_demo after insert on sm_kb_domains for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_domains_demo_t after update or delete on sm_kb_domains for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_domains enable row level security;

-- kb_duplicate: مقاله‌های احتمالاً تکراری
do $cols$
begin
  if to_regclass('sm_kb_duplicates') is not null then
    alter table sm_kb_duplicates add column if not exists workspace_id uuid;
    alter table sm_kb_duplicates add column if not exists domain_id uuid;
    alter table sm_kb_duplicates add column if not exists unit_id uuid;
    alter table sm_kb_duplicates add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_duplicates add column if not exists created_by uuid;
    alter table sm_kb_duplicates add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_duplicates add column if not exists updated_by uuid;
    alter table sm_kb_duplicates add column if not exists rev bigint not null default 0;
    alter table sm_kb_duplicates add column if not exists version integer not null default 1;
    alter table sm_kb_duplicates add column if not exists deleted_at timestamptz;
    alter table sm_kb_duplicates add column if not exists origin text;
    alter table sm_kb_duplicates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_duplicates add column if not exists article_a uuid;
    alter table sm_kb_duplicates add column if not exists article_b uuid;
    alter table sm_kb_duplicates add column if not exists similarity integer;
    alter table sm_kb_duplicates add column if not exists method text;
    alter table sm_kb_duplicates add column if not exists pair_key text;
    alter table sm_kb_duplicates add column if not exists confidential boolean not null default true;
    alter table sm_kb_duplicates add column if not exists access_list jsonb;
    alter table sm_kb_duplicates add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_duplicates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_a uuid,
  article_b uuid,
  similarity integer,
  method text,
  pair_key text,
  confidential boolean not null default true,
  access_list jsonb,
  state text
);
create index if not exists sm_kb_duplicates_rev_idx on sm_kb_duplicates (org_id, rev);
create index if not exists sm_kb_duplicates_upd_idx on sm_kb_duplicates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_duplicates_crt_idx on sm_kb_duplicates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_duplicates_article_a_idx on sm_kb_duplicates (org_id, article_a) where deleted_at is null;
create index if not exists sm_kb_duplicates_article_b_idx on sm_kb_duplicates (org_id, article_b) where deleted_at is null;
create index if not exists sm_kb_duplicates_state_idx on sm_kb_duplicates (org_id, state) where deleted_at is null;
create unique index if not exists sm_kb_duplicates_pair_key_uk on sm_kb_duplicates (org_id, pair_key) where deleted_at is null;
drop trigger if exists sm_kb_duplicates_sync on sm_kb_duplicates;
create trigger sm_kb_duplicates_sync before insert or update on sm_kb_duplicates for each row execute function sm_sync_touch('kb_duplicate');
create or replace trigger sm_kb_duplicates_demo after insert on sm_kb_duplicates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_duplicates_demo_t after update or delete on sm_kb_duplicates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_duplicates enable row level security;

-- kb_feedback: بازخوردهای مقاله
do $cols$
begin
  if to_regclass('sm_kb_feedback') is not null then
    alter table sm_kb_feedback add column if not exists workspace_id uuid;
    alter table sm_kb_feedback add column if not exists domain_id uuid;
    alter table sm_kb_feedback add column if not exists unit_id uuid;
    alter table sm_kb_feedback add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_feedback add column if not exists created_by uuid;
    alter table sm_kb_feedback add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_feedback add column if not exists updated_by uuid;
    alter table sm_kb_feedback add column if not exists rev bigint not null default 0;
    alter table sm_kb_feedback add column if not exists version integer not null default 1;
    alter table sm_kb_feedback add column if not exists deleted_at timestamptz;
    alter table sm_kb_feedback add column if not exists origin text;
    alter table sm_kb_feedback add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_feedback add column if not exists article_id uuid;
    alter table sm_kb_feedback add column if not exists version_label text;
    alter table sm_kb_feedback add column if not exists kind text;
    alter table sm_kb_feedback add column if not exists user_id uuid;
    alter table sm_kb_feedback add column if not exists reason text;
    alter table sm_kb_feedback add column if not exists rating integer;
    alter table sm_kb_feedback add column if not exists comment text;
    alter table sm_kb_feedback add column if not exists channel text;
    alter table sm_kb_feedback add column if not exists state text;
    alter table sm_kb_feedback add column if not exists task_id uuid;
    alter table sm_kb_feedback add column if not exists k_users jsonb;
    alter table sm_kb_feedback add column if not exists k_groups jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_feedback (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_id uuid,
  version_label text,
  kind text,
  user_id uuid,
  reason text,
  rating integer,
  comment text,
  channel text,
  state text,
  task_id uuid,
  k_users jsonb,
  k_groups jsonb
);
create index if not exists sm_kb_feedback_rev_idx on sm_kb_feedback (org_id, rev);
create index if not exists sm_kb_feedback_upd_idx on sm_kb_feedback (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_crt_idx on sm_kb_feedback (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_article_id_idx on sm_kb_feedback (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_feedback_user_id_idx on sm_kb_feedback (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_feedback_k_users_gin on sm_kb_feedback using gin (k_users);
create index if not exists sm_kb_feedback_k_groups_gin on sm_kb_feedback using gin (k_groups);
create index if not exists sm_kb_feedback_workspace_acc_idx on sm_kb_feedback (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_feedback_unit_acc_idx on sm_kb_feedback (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_feedback_domain_acc_idx on sm_kb_feedback (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_feedback_sync on sm_kb_feedback;
create trigger sm_kb_feedback_sync before insert or update on sm_kb_feedback for each row execute function sm_sync_touch('kb_feedback');
create or replace trigger sm_kb_feedback_demo after insert on sm_kb_feedback for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_feedback_demo_t after update or delete on sm_kb_feedback for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_feedback enable row level security;

-- kb_gap: شکاف‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_gaps') is not null then
    alter table sm_kb_gaps add column if not exists workspace_id uuid;
    alter table sm_kb_gaps add column if not exists domain_id uuid;
    alter table sm_kb_gaps add column if not exists unit_id uuid;
    alter table sm_kb_gaps add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_gaps add column if not exists created_by uuid;
    alter table sm_kb_gaps add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_gaps add column if not exists updated_by uuid;
    alter table sm_kb_gaps add column if not exists rev bigint not null default 0;
    alter table sm_kb_gaps add column if not exists version integer not null default 1;
    alter table sm_kb_gaps add column if not exists deleted_at timestamptz;
    alter table sm_kb_gaps add column if not exists origin text;
    alter table sm_kb_gaps add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_gaps add column if not exists no integer;
    alter table sm_kb_gaps add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KGP' || no::text else 'KGP' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_gaps add column if not exists title text;
    alter table sm_kb_gaps add column if not exists kind text;
    alter table sm_kb_gaps add column if not exists signature text;
    alter table sm_kb_gaps add column if not exists demand integer;
    alter table sm_kb_gaps add column if not exists score integer;
    alter table sm_kb_gaps add column if not exists last_seen_at timestamptz;
    alter table sm_kb_gaps add column if not exists samples jsonb;
    alter table sm_kb_gaps add column if not exists outline text;
    alter table sm_kb_gaps add column if not exists base_id uuid;
    alter table sm_kb_gaps add column if not exists group_id uuid;
    alter table sm_kb_gaps add column if not exists article_id uuid;
    alter table sm_kb_gaps add column if not exists confidential boolean not null default true;
    alter table sm_kb_gaps add column if not exists access_list jsonb;
    alter table sm_kb_gaps add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_gaps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KGP' || no::text else 'KGP' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  signature text,
  demand integer,
  score integer,
  last_seen_at timestamptz,
  samples jsonb,
  outline text,
  base_id uuid,
  group_id uuid,
  article_id uuid,
  confidential boolean not null default true,
  access_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_gaps', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_gaps_search_cae18f1d_trgm', 'sm_kb_gaps', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_gaps_search_custom_trgm', 'sm_kb_gaps', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_gaps_no_uk on sm_kb_gaps (org_id, no);
create index if not exists sm_kb_gaps_rev_idx on sm_kb_gaps (org_id, rev);
create index if not exists sm_kb_gaps_upd_idx on sm_kb_gaps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_gaps_crt_idx on sm_kb_gaps (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_gaps_signature_idx on sm_kb_gaps (org_id, signature) where deleted_at is null;
create index if not exists sm_kb_gaps_group_id_idx on sm_kb_gaps (org_id, group_id) where deleted_at is null;
create index if not exists sm_kb_gaps_state_idx on sm_kb_gaps (org_id, state) where deleted_at is null;
create index if not exists sm_kb_gaps_workspace_acc_idx on sm_kb_gaps (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_gaps_unit_acc_idx on sm_kb_gaps (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_gaps_domain_acc_idx on sm_kb_gaps (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_gaps_sync on sm_kb_gaps;
create trigger sm_kb_gaps_sync before insert or update on sm_kb_gaps for each row execute function sm_sync_touch('kb_gap');
create or replace trigger sm_kb_gaps_demo after insert on sm_kb_gaps for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_gaps_demo_t after update or delete on sm_kb_gaps for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_gaps enable row level security;

-- kb_glossary: واژه‌نامهٔ سازمان
do $cols$
begin
  if to_regclass('sm_kb_glossary') is not null then
    alter table sm_kb_glossary add column if not exists workspace_id uuid;
    alter table sm_kb_glossary add column if not exists domain_id uuid;
    alter table sm_kb_glossary add column if not exists unit_id uuid;
    alter table sm_kb_glossary add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_glossary add column if not exists created_by uuid;
    alter table sm_kb_glossary add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_glossary add column if not exists updated_by uuid;
    alter table sm_kb_glossary add column if not exists rev bigint not null default 0;
    alter table sm_kb_glossary add column if not exists version integer not null default 1;
    alter table sm_kb_glossary add column if not exists deleted_at timestamptz;
    alter table sm_kb_glossary add column if not exists origin text;
    alter table sm_kb_glossary add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_glossary add column if not exists term text;
    alter table sm_kb_glossary add column if not exists approved_fa text;
    alter table sm_kb_glossary add column if not exists synonyms jsonb;
    alter table sm_kb_glossary add column if not exists definition text;
    alter table sm_kb_glossary add column if not exists language text;
    alter table sm_kb_glossary add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_kb_glossary (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  term text,
  approved_fa text,
  synonyms jsonb,
  definition text,
  language text,
  active boolean not null default true
);
create index if not exists sm_kb_glossary_rev_idx on sm_kb_glossary (org_id, rev);
create index if not exists sm_kb_glossary_upd_idx on sm_kb_glossary (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_glossary_crt_idx on sm_kb_glossary (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_glossary_term_uk on sm_kb_glossary (org_id, term) where deleted_at is null;
drop trigger if exists sm_kb_glossary_sync on sm_kb_glossary;
create trigger sm_kb_glossary_sync before insert or update on sm_kb_glossary for each row execute function sm_sync_touch('kb_glossary');
create or replace trigger sm_kb_glossary_demo after insert on sm_kb_glossary for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_glossary_demo_t after update or delete on sm_kb_glossary for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_glossary enable row level security;

-- kb_licence: مجوزهای KCS
do $cols$
begin
  if to_regclass('sm_kb_licences') is not null then
    alter table sm_kb_licences add column if not exists workspace_id uuid;
    alter table sm_kb_licences add column if not exists domain_id uuid;
    alter table sm_kb_licences add column if not exists unit_id uuid;
    alter table sm_kb_licences add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_licences add column if not exists created_by uuid;
    alter table sm_kb_licences add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_licences add column if not exists updated_by uuid;
    alter table sm_kb_licences add column if not exists rev bigint not null default 0;
    alter table sm_kb_licences add column if not exists version integer not null default 1;
    alter table sm_kb_licences add column if not exists deleted_at timestamptz;
    alter table sm_kb_licences add column if not exists origin text;
    alter table sm_kb_licences add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_licences add column if not exists user_id uuid;
    alter table sm_kb_licences add column if not exists level text;
    alter table sm_kb_licences add column if not exists base_id uuid;
    alter table sm_kb_licences add column if not exists coach_id uuid;
    alter table sm_kb_licences add column if not exists granted_at date;
    alter table sm_kb_licences add column if not exists expires_at date;
    alter table sm_kb_licences add column if not exists evidence text;
    alter table sm_kb_licences add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_licences (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  level text,
  base_id uuid,
  coach_id uuid,
  granted_at date,
  expires_at date,
  evidence text,
  state text
);
create index if not exists sm_kb_licences_rev_idx on sm_kb_licences (org_id, rev);
create index if not exists sm_kb_licences_upd_idx on sm_kb_licences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_licences_crt_idx on sm_kb_licences (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_licences_user_id_idx on sm_kb_licences (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_licences_state_idx on sm_kb_licences (org_id, state) where deleted_at is null;
drop trigger if exists sm_kb_licences_sync on sm_kb_licences;
create trigger sm_kb_licences_sync before insert or update on sm_kb_licences for each row execute function sm_sync_touch('kb_licence');
create or replace trigger sm_kb_licences_demo after insert on sm_kb_licences for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_licences_demo_t after update or delete on sm_kb_licences for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_licences enable row level security;

-- kb_quality_review: ارزیابی‌های کیفیت (AQI)
do $cols$
begin
  if to_regclass('sm_kb_quality_reviews') is not null then
    alter table sm_kb_quality_reviews add column if not exists workspace_id uuid;
    alter table sm_kb_quality_reviews add column if not exists domain_id uuid;
    alter table sm_kb_quality_reviews add column if not exists unit_id uuid;
    alter table sm_kb_quality_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_quality_reviews add column if not exists created_by uuid;
    alter table sm_kb_quality_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_quality_reviews add column if not exists updated_by uuid;
    alter table sm_kb_quality_reviews add column if not exists rev bigint not null default 0;
    alter table sm_kb_quality_reviews add column if not exists version integer not null default 1;
    alter table sm_kb_quality_reviews add column if not exists deleted_at timestamptz;
    alter table sm_kb_quality_reviews add column if not exists origin text;
    alter table sm_kb_quality_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_quality_reviews add column if not exists article_id uuid;
    alter table sm_kb_quality_reviews add column if not exists version_label text;
    alter table sm_kb_quality_reviews add column if not exists period text;
    alter table sm_kb_quality_reviews add column if not exists author_id uuid;
    alter table sm_kb_quality_reviews add column if not exists reviewer_id uuid;
    alter table sm_kb_quality_reviews add column if not exists results jsonb;
    alter table sm_kb_quality_reviews add column if not exists score integer;
    alter table sm_kb_quality_reviews add column if not exists notes text;
    alter table sm_kb_quality_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_quality_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_id uuid,
  version_label text,
  period text,
  author_id uuid,
  reviewer_id uuid,
  results jsonb,
  score integer,
  notes text,
  state text
);
create index if not exists sm_kb_quality_reviews_rev_idx on sm_kb_quality_reviews (org_id, rev);
create index if not exists sm_kb_quality_reviews_upd_idx on sm_kb_quality_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_crt_idx on sm_kb_quality_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_article_id_idx on sm_kb_quality_reviews (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_author_id_idx on sm_kb_quality_reviews (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_reviewer_id_idx on sm_kb_quality_reviews (org_id, reviewer_id) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_state_idx on sm_kb_quality_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_workspace_acc_idx on sm_kb_quality_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_quality_reviews_unit_acc_idx on sm_kb_quality_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_quality_reviews_domain_acc_idx on sm_kb_quality_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_quality_reviews_sync on sm_kb_quality_reviews;
create trigger sm_kb_quality_reviews_sync before insert or update on sm_kb_quality_reviews for each row execute function sm_sync_touch('kb_quality_review');
create or replace trigger sm_kb_quality_reviews_demo after insert on sm_kb_quality_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_quality_reviews_demo_t after update or delete on sm_kb_quality_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_quality_reviews enable row level security;

-- kb_search_rule: قاعده‌های جست‌وجوی دانش
do $cols$
begin
  if to_regclass('sm_kb_search_rules') is not null then
    alter table sm_kb_search_rules add column if not exists workspace_id uuid;
    alter table sm_kb_search_rules add column if not exists domain_id uuid;
    alter table sm_kb_search_rules add column if not exists unit_id uuid;
    alter table sm_kb_search_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_search_rules add column if not exists created_by uuid;
    alter table sm_kb_search_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_search_rules add column if not exists updated_by uuid;
    alter table sm_kb_search_rules add column if not exists rev bigint not null default 0;
    alter table sm_kb_search_rules add column if not exists version integer not null default 1;
    alter table sm_kb_search_rules add column if not exists deleted_at timestamptz;
    alter table sm_kb_search_rules add column if not exists origin text;
    alter table sm_kb_search_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_search_rules add column if not exists query text;
    alter table sm_kb_search_rules add column if not exists kind text;
    alter table sm_kb_search_rules add column if not exists active boolean not null default true;
    alter table sm_kb_search_rules add column if not exists articles jsonb;
    alter table sm_kb_search_rules add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_kb_search_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  query text,
  kind text,
  active boolean not null default true,
  articles jsonb,
  note text
);
create index if not exists sm_kb_search_rules_rev_idx on sm_kb_search_rules (org_id, rev);
create index if not exists sm_kb_search_rules_upd_idx on sm_kb_search_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_search_rules_crt_idx on sm_kb_search_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_kb_search_rules_sync on sm_kb_search_rules;
create trigger sm_kb_search_rules_sync before insert or update on sm_kb_search_rules for each row execute function sm_sync_touch('kb_search_rule');
create or replace trigger sm_kb_search_rules_demo after insert on sm_kb_search_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_search_rules_demo_t after update or delete on sm_kb_search_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_search_rules enable row level security;

-- kb_snippet: پاسخ‌های کوتاه
do $cols$
begin
  if to_regclass('sm_kb_snippets') is not null then
    alter table sm_kb_snippets add column if not exists workspace_id uuid;
    alter table sm_kb_snippets add column if not exists domain_id uuid;
    alter table sm_kb_snippets add column if not exists unit_id uuid;
    alter table sm_kb_snippets add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_snippets add column if not exists created_by uuid;
    alter table sm_kb_snippets add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_snippets add column if not exists updated_by uuid;
    alter table sm_kb_snippets add column if not exists rev bigint not null default 0;
    alter table sm_kb_snippets add column if not exists version integer not null default 1;
    alter table sm_kb_snippets add column if not exists deleted_at timestamptz;
    alter table sm_kb_snippets add column if not exists origin text;
    alter table sm_kb_snippets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_snippets add column if not exists no integer;
    alter table sm_kb_snippets add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBS' || no::text else 'KBS' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_snippets add column if not exists question text;
    alter table sm_kb_snippets add column if not exists answer text;
    alter table sm_kb_snippets add column if not exists base_id uuid;
    alter table sm_kb_snippets add column if not exists source_article_id uuid;
    alter table sm_kb_snippets add column if not exists language text;
    alter table sm_kb_snippets add column if not exists owner_id uuid;
    alter table sm_kb_snippets add column if not exists owner_group_id uuid;
    alter table sm_kb_snippets add column if not exists valid_to date;
    alter table sm_kb_snippets add column if not exists visibility text;
    alter table sm_kb_snippets add column if not exists confidential boolean not null default false;
    alter table sm_kb_snippets add column if not exists ai_generated boolean not null default false;
    alter table sm_kb_snippets add column if not exists k_users jsonb;
    alter table sm_kb_snippets add column if not exists k_groups jsonb;
    alter table sm_kb_snippets add column if not exists access_list jsonb;
    alter table sm_kb_snippets add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_snippets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBS' || no::text else 'KBS' || lpad(no::text, 6, '0') end) stored,
  question text,
  answer text,
  base_id uuid,
  source_article_id uuid,
  language text,
  owner_id uuid,
  owner_group_id uuid,
  valid_to date,
  visibility text,
  confidential boolean not null default false,
  ai_generated boolean not null default false,
  k_users jsonb,
  k_groups jsonb,
  access_list jsonb,
  state text,
  search_398fabe7 text generated always as (translate(coalesce(question, '') || ' ' || coalesce(answer, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_snippets', 'search_398fabe7', $x$translate(coalesce(question, '') || ' ' || coalesce(answer, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_snippets_search_398fabe7_trgm', 'sm_kb_snippets', 'search_398fabe7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_snippets_search_custom_trgm', 'sm_kb_snippets', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_snippets_no_uk on sm_kb_snippets (org_id, no);
create index if not exists sm_kb_snippets_rev_idx on sm_kb_snippets (org_id, rev);
create index if not exists sm_kb_snippets_upd_idx on sm_kb_snippets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_crt_idx on sm_kb_snippets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_base_id_idx on sm_kb_snippets (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_snippets_owner_id_idx on sm_kb_snippets (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_snippets_k_users_gin on sm_kb_snippets using gin (k_users);
create index if not exists sm_kb_snippets_k_groups_gin on sm_kb_snippets using gin (k_groups);
create index if not exists sm_kb_snippets_state_idx on sm_kb_snippets (org_id, state) where deleted_at is null;
create index if not exists sm_kb_snippets_workspace_acc_idx on sm_kb_snippets (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_snippets_unit_acc_idx on sm_kb_snippets (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_snippets_domain_acc_idx on sm_kb_snippets (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_snippets_sync on sm_kb_snippets;
create trigger sm_kb_snippets_sync before insert or update on sm_kb_snippets for each row execute function sm_sync_touch('kb_snippet');
create or replace trigger sm_kb_snippets_demo after insert on sm_kb_snippets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_snippets_demo_t after update or delete on sm_kb_snippets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_snippets enable row level security;

-- kb_subscription: اشتراک‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_subscriptions') is not null then
    alter table sm_kb_subscriptions add column if not exists workspace_id uuid;
    alter table sm_kb_subscriptions add column if not exists domain_id uuid;
    alter table sm_kb_subscriptions add column if not exists unit_id uuid;
    alter table sm_kb_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_subscriptions add column if not exists created_by uuid;
    alter table sm_kb_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_subscriptions add column if not exists updated_by uuid;
    alter table sm_kb_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_kb_subscriptions add column if not exists version integer not null default 1;
    alter table sm_kb_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_kb_subscriptions add column if not exists origin text;
    alter table sm_kb_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_subscriptions add column if not exists user_id uuid;
    alter table sm_kb_subscriptions add column if not exists target_table text;
    alter table sm_kb_subscriptions add column if not exists target_id text;
    alter table sm_kb_subscriptions add column if not exists target_label text;
    alter table sm_kb_subscriptions add column if not exists events jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_subscriptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  target_table text,
  target_id text,
  target_label text,
  events jsonb
);
create index if not exists sm_kb_subscriptions_rev_idx on sm_kb_subscriptions (org_id, rev);
create index if not exists sm_kb_subscriptions_upd_idx on sm_kb_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_subscriptions_crt_idx on sm_kb_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_subscriptions_user_id_idx on sm_kb_subscriptions (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_subscriptions_target_id_idx on sm_kb_subscriptions (org_id, target_id) where deleted_at is null;
create unique index if not exists sm_kb_subscriptions_user_id_target_table_target_id_uk on sm_kb_subscriptions (org_id, user_id, target_table, target_id) where deleted_at is null;
create index if not exists sm_kb_subscriptions_workspace_acc_idx on sm_kb_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_subscriptions_unit_acc_idx on sm_kb_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_subscriptions_domain_acc_idx on sm_kb_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_subscriptions_sync on sm_kb_subscriptions;
create trigger sm_kb_subscriptions_sync before insert or update on sm_kb_subscriptions for each row execute function sm_sync_touch('kb_subscription');
create or replace trigger sm_kb_subscriptions_demo after insert on sm_kb_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_subscriptions_demo_t after update or delete on sm_kb_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_subscriptions enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:14', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۶ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 16/28 (e746bd22eb04)
-- kb_task: کارهای دانش
do $cols$
begin
  if to_regclass('sm_kb_tasks') is not null then
    alter table sm_kb_tasks add column if not exists workspace_id uuid;
    alter table sm_kb_tasks add column if not exists domain_id uuid;
    alter table sm_kb_tasks add column if not exists unit_id uuid;
    alter table sm_kb_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_tasks add column if not exists created_by uuid;
    alter table sm_kb_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_tasks add column if not exists updated_by uuid;
    alter table sm_kb_tasks add column if not exists rev bigint not null default 0;
    alter table sm_kb_tasks add column if not exists version integer not null default 1;
    alter table sm_kb_tasks add column if not exists deleted_at timestamptz;
    alter table sm_kb_tasks add column if not exists origin text;
    alter table sm_kb_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_tasks add column if not exists no integer;
    alter table sm_kb_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBT' || no::text else 'KBT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_tasks add column if not exists short_description text;
    alter table sm_kb_tasks add column if not exists description text;
    alter table sm_kb_tasks add column if not exists state text;
    alter table sm_kb_tasks add column if not exists priority text;
    alter table sm_kb_tasks add column if not exists impact text;
    alter table sm_kb_tasks add column if not exists urgency text;
    alter table sm_kb_tasks add column if not exists category text;
    alter table sm_kb_tasks add column if not exists subcategory text;
    alter table sm_kb_tasks add column if not exists channel text;
    alter table sm_kb_tasks add column if not exists caller_id uuid;
    alter table sm_kb_tasks add column if not exists requested_for uuid;
    alter table sm_kb_tasks add column if not exists opened_by uuid;
    alter table sm_kb_tasks add column if not exists opened_at timestamptz;
    alter table sm_kb_tasks add column if not exists assignment_group_id uuid;
    alter table sm_kb_tasks add column if not exists assigned_to uuid;
    alter table sm_kb_tasks add column if not exists service_id uuid;
    alter table sm_kb_tasks add column if not exists offering_id uuid;
    alter table sm_kb_tasks add column if not exists ci_id uuid;
    alter table sm_kb_tasks add column if not exists location_id uuid;
    alter table sm_kb_tasks add column if not exists due_at timestamptz;
    alter table sm_kb_tasks add column if not exists resolved_at timestamptz;
    alter table sm_kb_tasks add column if not exists resolved_by uuid;
    alter table sm_kb_tasks add column if not exists closed_at timestamptz;
    alter table sm_kb_tasks add column if not exists closed_by uuid;
    alter table sm_kb_tasks add column if not exists close_code text;
    alter table sm_kb_tasks add column if not exists close_notes text;
    alter table sm_kb_tasks add column if not exists parent_id uuid;
    alter table sm_kb_tasks add column if not exists watch_list jsonb;
    alter table sm_kb_tasks add column if not exists approval text;
    alter table sm_kb_tasks add column if not exists escalation integer;
    alter table sm_kb_tasks add column if not exists reassignment_count integer;
    alter table sm_kb_tasks add column if not exists reopen_count integer;
    alter table sm_kb_tasks add column if not exists time_worked bigint;
    alter table sm_kb_tasks add column if not exists first_response_at timestamptz;
    alter table sm_kb_tasks add column if not exists active boolean not null default true;
    alter table sm_kb_tasks add column if not exists sla_due timestamptz;
    alter table sm_kb_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_kb_tasks add column if not exists kind text;
    alter table sm_kb_tasks add column if not exists article_id uuid;
    alter table sm_kb_tasks add column if not exists gap_id uuid;
    alter table sm_kb_tasks add column if not exists feedback_count integer;
    alter table sm_kb_tasks add column if not exists source_table text;
    alter table sm_kb_tasks add column if not exists source_id text;
    alter table sm_kb_tasks add column if not exists source_number text;
    alter table sm_kb_tasks add column if not exists k_users jsonb;
    alter table sm_kb_tasks add column if not exists k_groups jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBT' || no::text else 'KBT' || lpad(no::text, 6, '0') end) stored,
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
  article_id uuid,
  gap_id uuid,
  feedback_count integer,
  source_table text,
  source_id text,
  source_number text,
  k_users jsonb,
  k_groups jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_tasks_search_f3bce210_trgm', 'sm_kb_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_tasks_search_custom_trgm', 'sm_kb_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_tasks_no_uk on sm_kb_tasks (org_id, no);
create index if not exists sm_kb_tasks_rev_idx on sm_kb_tasks (org_id, rev);
create index if not exists sm_kb_tasks_upd_idx on sm_kb_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_crt_idx on sm_kb_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_state_idx on sm_kb_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_kb_tasks_assignment_group_id_idx on sm_kb_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_kb_tasks_assigned_to_idx on sm_kb_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_kb_tasks_article_id_idx on sm_kb_tasks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_tasks_source_id_idx on sm_kb_tasks (org_id, source_id) where deleted_at is null;
create index if not exists sm_kb_tasks_k_users_gin on sm_kb_tasks using gin (k_users);
create index if not exists sm_kb_tasks_k_groups_gin on sm_kb_tasks using gin (k_groups);
create index if not exists sm_kb_tasks_workspace_acc_idx on sm_kb_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_tasks_unit_acc_idx on sm_kb_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_tasks_domain_acc_idx on sm_kb_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_kb_tasks_caller_id_idx on sm_kb_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_kb_tasks_requested_for_idx on sm_kb_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_kb_tasks_opened_by_idx on sm_kb_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_kb_tasks_watch_list_gin on sm_kb_tasks using gin (watch_list);
create index if not exists sm_kb_tasks_open_grp_idx on sm_kb_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_kb_tasks_opened_brin on sm_kb_tasks using brin (opened_at);
drop trigger if exists sm_kb_tasks_sync on sm_kb_tasks;
create trigger sm_kb_tasks_sync before insert or update on sm_kb_tasks for each row execute function sm_sync_touch('kb_task');
create or replace trigger sm_kb_tasks_demo after insert on sm_kb_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_tasks_demo_t after update or delete on sm_kb_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_tasks enable row level security;

-- kb_template: قالب‌های مقاله
do $cols$
begin
  if to_regclass('sm_kb_templates') is not null then
    alter table sm_kb_templates add column if not exists workspace_id uuid;
    alter table sm_kb_templates add column if not exists domain_id uuid;
    alter table sm_kb_templates add column if not exists unit_id uuid;
    alter table sm_kb_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_templates add column if not exists created_by uuid;
    alter table sm_kb_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_templates add column if not exists updated_by uuid;
    alter table sm_kb_templates add column if not exists rev bigint not null default 0;
    alter table sm_kb_templates add column if not exists version integer not null default 1;
    alter table sm_kb_templates add column if not exists deleted_at timestamptz;
    alter table sm_kb_templates add column if not exists origin text;
    alter table sm_kb_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_templates add column if not exists name text;
    alter table sm_kb_templates add column if not exists article_type text;
    alter table sm_kb_templates add column if not exists active boolean not null default true;
    alter table sm_kb_templates add column if not exists description text;
    alter table sm_kb_templates add column if not exists sections jsonb;
    alter table sm_kb_templates add column if not exists sort_order integer;
    alter table sm_kb_templates add column if not exists builtin text;
  end if;
end
$cols$;
create table if not exists sm_kb_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  article_type text,
  active boolean not null default true,
  description text,
  sections jsonb,
  sort_order integer,
  builtin text
);
create index if not exists sm_kb_templates_rev_idx on sm_kb_templates (org_id, rev);
create index if not exists sm_kb_templates_upd_idx on sm_kb_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_templates_crt_idx on sm_kb_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_templates_name_uk on sm_kb_templates (org_id, name) where deleted_at is null;
drop trigger if exists sm_kb_templates_sync on sm_kb_templates;
create trigger sm_kb_templates_sync before insert or update on sm_kb_templates for each row execute function sm_sync_touch('kb_template');
create or replace trigger sm_kb_templates_demo after insert on sm_kb_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_templates_demo_t after update or delete on sm_kb_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_templates enable row level security;

-- kb_version: نسخه‌های مقاله
do $cols$
begin
  if to_regclass('sm_kb_versions') is not null then
    alter table sm_kb_versions add column if not exists workspace_id uuid;
    alter table sm_kb_versions add column if not exists domain_id uuid;
    alter table sm_kb_versions add column if not exists unit_id uuid;
    alter table sm_kb_versions add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_versions add column if not exists created_by uuid;
    alter table sm_kb_versions add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_versions add column if not exists updated_by uuid;
    alter table sm_kb_versions add column if not exists rev bigint not null default 0;
    alter table sm_kb_versions add column if not exists version integer not null default 1;
    alter table sm_kb_versions add column if not exists deleted_at timestamptz;
    alter table sm_kb_versions add column if not exists origin text;
    alter table sm_kb_versions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_versions add column if not exists article_id uuid;
    alter table sm_kb_versions add column if not exists version_label text;
    alter table sm_kb_versions add column if not exists change_kind text;
    alter table sm_kb_versions add column if not exists major integer;
    alter table sm_kb_versions add column if not exists minor integer;
    alter table sm_kb_versions add column if not exists title text;
    alter table sm_kb_versions add column if not exists summary text;
    alter table sm_kb_versions add column if not exists body text;
    alter table sm_kb_versions add column if not exists internal_body text;
    alter table sm_kb_versions add column if not exists keywords jsonb;
    alter table sm_kb_versions add column if not exists tags jsonb;
    alter table sm_kb_versions add column if not exists change_note text;
    alter table sm_kb_versions add column if not exists author_id uuid;
    alter table sm_kb_versions add column if not exists publish_at timestamptz;
    alter table sm_kb_versions add column if not exists submitted_at timestamptz;
    alter table sm_kb_versions add column if not exists submitted_by uuid;
    alter table sm_kb_versions add column if not exists approved_at timestamptz;
    alter table sm_kb_versions add column if not exists approved_by uuid;
    alter table sm_kb_versions add column if not exists published_at timestamptz;
    alter table sm_kb_versions add column if not exists published_by uuid;
    alter table sm_kb_versions add column if not exists approval text;
    alter table sm_kb_versions add column if not exists needs_approval boolean not null default false;
    alter table sm_kb_versions add column if not exists approval_mode text;
    alter table sm_kb_versions add column if not exists reviewer_ids jsonb;
    alter table sm_kb_versions add column if not exists ai_provenance jsonb;
    alter table sm_kb_versions add column if not exists ai_validated_by uuid;
    alter table sm_kb_versions add column if not exists content_hash text;
    alter table sm_kb_versions add column if not exists word_count integer;
    alter table sm_kb_versions add column if not exists checks jsonb;
    alter table sm_kb_versions add column if not exists k_users jsonb;
    alter table sm_kb_versions add column if not exists k_groups jsonb;
    alter table sm_kb_versions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_versions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_id uuid,
  version_label text,
  change_kind text,
  major integer,
  minor integer,
  title text,
  summary text,
  body text,
  internal_body text,
  keywords jsonb,
  tags jsonb,
  change_note text,
  author_id uuid,
  publish_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  published_at timestamptz,
  published_by uuid,
  approval text,
  needs_approval boolean not null default false,
  approval_mode text,
  reviewer_ids jsonb,
  ai_provenance jsonb,
  ai_validated_by uuid,
  content_hash text,
  word_count integer,
  checks jsonb,
  k_users jsonb,
  k_groups jsonb,
  state text
);
create index if not exists sm_kb_versions_rev_idx on sm_kb_versions (org_id, rev);
create index if not exists sm_kb_versions_upd_idx on sm_kb_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_crt_idx on sm_kb_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_article_id_idx on sm_kb_versions (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_versions_author_id_idx on sm_kb_versions (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_versions_reviewer_ids_gin on sm_kb_versions using gin (reviewer_ids);
create index if not exists sm_kb_versions_k_users_gin on sm_kb_versions using gin (k_users);
create index if not exists sm_kb_versions_k_groups_gin on sm_kb_versions using gin (k_groups);
create index if not exists sm_kb_versions_state_idx on sm_kb_versions (org_id, state) where deleted_at is null;
create index if not exists sm_kb_versions_workspace_acc_idx on sm_kb_versions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_versions_unit_acc_idx on sm_kb_versions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_versions_domain_acc_idx on sm_kb_versions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_versions_sync on sm_kb_versions;
create trigger sm_kb_versions_sync before insert or update on sm_kb_versions for each row execute function sm_sync_touch('kb_version');
create or replace trigger sm_kb_versions_demo after insert on sm_kb_versions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_versions_demo_t after update or delete on sm_kb_versions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_versions enable row level security;

-- known_error: خطاهای شناخته‌شده
do $cols$
begin
  if to_regclass('sm_known_errors') is not null then
    alter table sm_known_errors add column if not exists workspace_id uuid;
    alter table sm_known_errors add column if not exists domain_id uuid;
    alter table sm_known_errors add column if not exists unit_id uuid;
    alter table sm_known_errors add column if not exists created_at timestamptz not null default now();
    alter table sm_known_errors add column if not exists created_by uuid;
    alter table sm_known_errors add column if not exists updated_at timestamptz not null default now();
    alter table sm_known_errors add column if not exists updated_by uuid;
    alter table sm_known_errors add column if not exists rev bigint not null default 0;
    alter table sm_known_errors add column if not exists version integer not null default 1;
    alter table sm_known_errors add column if not exists deleted_at timestamptz;
    alter table sm_known_errors add column if not exists origin text;
    alter table sm_known_errors add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_known_errors add column if not exists no integer;
    alter table sm_known_errors add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KE' || no::text else 'KE' || lpad(no::text, 6, '0') end) stored;
    alter table sm_known_errors add column if not exists short_description text;
    alter table sm_known_errors add column if not exists problem_id uuid;
    alter table sm_known_errors add column if not exists owner_id uuid;
    alter table sm_known_errors add column if not exists assignment_group_id uuid;
    alter table sm_known_errors add column if not exists symptoms text;
    alter table sm_known_errors add column if not exists root_cause text;
    alter table sm_known_errors add column if not exists workaround text;
    alter table sm_known_errors add column if not exists category text;
    alter table sm_known_errors add column if not exists subcategory text;
    alter table sm_known_errors add column if not exists service_id uuid;
    alter table sm_known_errors add column if not exists ci_id uuid;
    alter table sm_known_errors add column if not exists affected_cis jsonb;
    alter table sm_known_errors add column if not exists effectiveness text;
    alter table sm_known_errors add column if not exists review_at date;
    alter table sm_known_errors add column if not exists published_at timestamptz;
    alter table sm_known_errors add column if not exists published_by uuid;
    alter table sm_known_errors add column if not exists use_count integer;
    alter table sm_known_errors add column if not exists last_used_at timestamptz;
    alter table sm_known_errors add column if not exists incident_count integer;
    alter table sm_known_errors add column if not exists watch_list jsonb;
    alter table sm_known_errors add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_known_errors (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KE' || no::text else 'KE' || lpad(no::text, 6, '0') end) stored,
  short_description text,
  problem_id uuid,
  owner_id uuid,
  assignment_group_id uuid,
  symptoms text,
  root_cause text,
  workaround text,
  category text,
  subcategory text,
  service_id uuid,
  ci_id uuid,
  affected_cis jsonb,
  effectiveness text,
  review_at date,
  published_at timestamptz,
  published_by uuid,
  use_count integer,
  last_used_at timestamptz,
  incident_count integer,
  watch_list jsonb,
  state text,
  search_36af9f51 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(symptoms, '') || ' ' || coalesce(root_cause, '') || ' ' || coalesce(workaround, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_known_errors', 'search_36af9f51', $x$translate(coalesce(short_description, '') || ' ' || coalesce(symptoms, '') || ' ' || coalesce(root_cause, '') || ' ' || coalesce(workaround, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_known_errors_search_36af9f51_trgm', 'sm_known_errors', 'search_36af9f51', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_known_errors_search_custom_trgm', 'sm_known_errors', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_known_errors_no_uk on sm_known_errors (org_id, no);
create index if not exists sm_known_errors_rev_idx on sm_known_errors (org_id, rev);
create index if not exists sm_known_errors_upd_idx on sm_known_errors (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_known_errors_crt_idx on sm_known_errors (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_known_errors_problem_id_idx on sm_known_errors (org_id, problem_id) where deleted_at is null;
create index if not exists sm_known_errors_owner_id_idx on sm_known_errors (org_id, owner_id) where deleted_at is null;
create index if not exists sm_known_errors_assignment_group_id_idx on sm_known_errors (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_known_errors_state_idx on sm_known_errors (org_id, state) where deleted_at is null;
create index if not exists sm_known_errors_workspace_acc_idx on sm_known_errors (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_known_errors_unit_acc_idx on sm_known_errors (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_known_errors_domain_acc_idx on sm_known_errors (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_known_errors_watch_list_gin on sm_known_errors using gin (watch_list);
drop trigger if exists sm_known_errors_sync on sm_known_errors;
create trigger sm_known_errors_sync before insert or update on sm_known_errors for each row execute function sm_sync_touch('known_error');
create or replace trigger sm_known_errors_demo after insert on sm_known_errors for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_known_errors_demo_t after update or delete on sm_known_errors for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_known_errors enable row level security;

-- label_template: الگوهای برچسب
do $cols$
begin
  if to_regclass('sm_label_templates') is not null then
    alter table sm_label_templates add column if not exists workspace_id uuid;
    alter table sm_label_templates add column if not exists domain_id uuid;
    alter table sm_label_templates add column if not exists unit_id uuid;
    alter table sm_label_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_label_templates add column if not exists created_by uuid;
    alter table sm_label_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_label_templates add column if not exists updated_by uuid;
    alter table sm_label_templates add column if not exists rev bigint not null default 0;
    alter table sm_label_templates add column if not exists version integer not null default 1;
    alter table sm_label_templates add column if not exists deleted_at timestamptz;
    alter table sm_label_templates add column if not exists origin text;
    alter table sm_label_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_label_templates add column if not exists name text;
    alter table sm_label_templates add column if not exists is_default boolean not null default false;
    alter table sm_label_templates add column if not exists active boolean not null default true;
    alter table sm_label_templates add column if not exists cols_count integer;
    alter table sm_label_templates add column if not exists rows_count integer;
    alter table sm_label_templates add column if not exists label_width_mm numeric;
    alter table sm_label_templates add column if not exists label_height_mm numeric;
    alter table sm_label_templates add column if not exists margin_top_mm numeric;
    alter table sm_label_templates add column if not exists margin_side_mm numeric;
    alter table sm_label_templates add column if not exists gap_x_mm numeric;
    alter table sm_label_templates add column if not exists gap_y_mm numeric;
    alter table sm_label_templates add column if not exists fields jsonb;
    alter table sm_label_templates add column if not exists title text;
  end if;
end
$cols$;
create table if not exists sm_label_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  is_default boolean not null default false,
  active boolean not null default true,
  cols_count integer,
  rows_count integer,
  label_width_mm numeric,
  label_height_mm numeric,
  margin_top_mm numeric,
  margin_side_mm numeric,
  gap_x_mm numeric,
  gap_y_mm numeric,
  fields jsonb,
  title text
);
create index if not exists sm_label_templates_rev_idx on sm_label_templates (org_id, rev);
create index if not exists sm_label_templates_upd_idx on sm_label_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_label_templates_crt_idx on sm_label_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_label_templates_sync on sm_label_templates;
create trigger sm_label_templates_sync before insert or update on sm_label_templates for each row execute function sm_sync_touch('label_template');
create or replace trigger sm_label_templates_demo after insert on sm_label_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_label_templates_demo_t after update or delete on sm_label_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_label_templates enable row level security;

-- legal_request: درخواست‌های حقوقی
do $cols$
begin
  if to_regclass('sm_legal_requests') is not null then
    alter table sm_legal_requests add column if not exists workspace_id uuid;
    alter table sm_legal_requests add column if not exists domain_id uuid;
    alter table sm_legal_requests add column if not exists unit_id uuid;
    alter table sm_legal_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_legal_requests add column if not exists created_by uuid;
    alter table sm_legal_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_legal_requests add column if not exists updated_by uuid;
    alter table sm_legal_requests add column if not exists rev bigint not null default 0;
    alter table sm_legal_requests add column if not exists version integer not null default 1;
    alter table sm_legal_requests add column if not exists deleted_at timestamptz;
    alter table sm_legal_requests add column if not exists origin text;
    alter table sm_legal_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_legal_requests add column if not exists no integer;
    alter table sm_legal_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'LGL' || no::text else 'LGL' || lpad(no::text, 7, '0') end) stored;
    alter table sm_legal_requests add column if not exists short_description text;
    alter table sm_legal_requests add column if not exists description text;
    alter table sm_legal_requests add column if not exists state text;
    alter table sm_legal_requests add column if not exists priority text;
    alter table sm_legal_requests add column if not exists impact text;
    alter table sm_legal_requests add column if not exists urgency text;
    alter table sm_legal_requests add column if not exists category text;
    alter table sm_legal_requests add column if not exists subcategory text;
    alter table sm_legal_requests add column if not exists channel text;
    alter table sm_legal_requests add column if not exists caller_id uuid;
    alter table sm_legal_requests add column if not exists requested_for uuid;
    alter table sm_legal_requests add column if not exists opened_by uuid;
    alter table sm_legal_requests add column if not exists opened_at timestamptz;
    alter table sm_legal_requests add column if not exists assignment_group_id uuid;
    alter table sm_legal_requests add column if not exists assigned_to uuid;
    alter table sm_legal_requests add column if not exists service_id uuid;
    alter table sm_legal_requests add column if not exists offering_id uuid;
    alter table sm_legal_requests add column if not exists ci_id uuid;
    alter table sm_legal_requests add column if not exists location_id uuid;
    alter table sm_legal_requests add column if not exists due_at timestamptz;
    alter table sm_legal_requests add column if not exists resolved_at timestamptz;
    alter table sm_legal_requests add column if not exists resolved_by uuid;
    alter table sm_legal_requests add column if not exists closed_at timestamptz;
    alter table sm_legal_requests add column if not exists closed_by uuid;
    alter table sm_legal_requests add column if not exists close_code text;
    alter table sm_legal_requests add column if not exists close_notes text;
    alter table sm_legal_requests add column if not exists parent_id uuid;
    alter table sm_legal_requests add column if not exists watch_list jsonb;
    alter table sm_legal_requests add column if not exists approval text;
    alter table sm_legal_requests add column if not exists escalation integer;
    alter table sm_legal_requests add column if not exists reassignment_count integer;
    alter table sm_legal_requests add column if not exists reopen_count integer;
    alter table sm_legal_requests add column if not exists time_worked bigint;
    alter table sm_legal_requests add column if not exists first_response_at timestamptz;
    alter table sm_legal_requests add column if not exists active boolean not null default true;
    alter table sm_legal_requests add column if not exists sla_due timestamptz;
    alter table sm_legal_requests add column if not exists knowledge boolean not null default false;
    alter table sm_legal_requests add column if not exists title text;
    alter table sm_legal_requests add column if not exists department_id uuid;
    alter table sm_legal_requests add column if not exists dept_service_id uuid;
    alter table sm_legal_requests add column if not exists sensitive boolean not null default false;
    alter table sm_legal_requests add column if not exists journey_id uuid;
    alter table sm_legal_requests add column if not exists child_total integer;
    alter table sm_legal_requests add column if not exists child_open integer;
    alter table sm_legal_requests add column if not exists satisfaction integer;
    alter table sm_legal_requests add column if not exists matter_type text;
    alter table sm_legal_requests add column if not exists privileged boolean not null default true;
    alter table sm_legal_requests add column if not exists counterparty text;
    alter table sm_legal_requests add column if not exists contract_value numeric;
    alter table sm_legal_requests add column if not exists deadline date;
    alter table sm_legal_requests add column if not exists conflict_checked boolean not null default false;
    alter table sm_legal_requests add column if not exists conflict_notes text;
    alter table sm_legal_requests add column if not exists outcome text;
    alter table sm_legal_requests add column if not exists confidential boolean not null default false;
    alter table sm_legal_requests add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_legal_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'LGL' || no::text else 'LGL' || lpad(no::text, 7, '0') end) stored,
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
  matter_type text,
  privileged boolean not null default true,
  counterparty text,
  contract_value numeric,
  deadline date,
  conflict_checked boolean not null default false,
  conflict_notes text,
  outcome text,
  confidential boolean not null default false,
  access_list jsonb,
  search_3b95400c text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(counterparty, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_legal_requests', 'search_3b95400c', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(counterparty, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_legal_requests_search_3b95400c_trgm', 'sm_legal_requests', 'search_3b95400c', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_legal_requests_search_custom_trgm', 'sm_legal_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_legal_requests_no_uk on sm_legal_requests (org_id, no);
create index if not exists sm_legal_requests_rev_idx on sm_legal_requests (org_id, rev);
create index if not exists sm_legal_requests_upd_idx on sm_legal_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_legal_requests_crt_idx on sm_legal_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_legal_requests_state_idx on sm_legal_requests (org_id, state) where deleted_at is null;
create index if not exists sm_legal_requests_assignment_group_id_idx on sm_legal_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_legal_requests_assigned_to_idx on sm_legal_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_legal_requests_department_id_idx on sm_legal_requests (org_id, department_id) where deleted_at is null;
create index if not exists sm_legal_requests_dept_service_id_idx on sm_legal_requests (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_legal_requests_workspace_acc_idx on sm_legal_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_legal_requests_unit_acc_idx on sm_legal_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_legal_requests_domain_acc_idx on sm_legal_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_legal_requests_caller_id_idx on sm_legal_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_legal_requests_requested_for_idx on sm_legal_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_legal_requests_opened_by_idx on sm_legal_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_legal_requests_watch_list_gin on sm_legal_requests using gin (watch_list);
create index if not exists sm_legal_requests_open_grp_idx on sm_legal_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_legal_requests_opened_brin on sm_legal_requests using brin (opened_at);
drop trigger if exists sm_legal_requests_sync on sm_legal_requests;
create trigger sm_legal_requests_sync before insert or update on sm_legal_requests for each row execute function sm_sync_touch('legal_request');
create or replace trigger sm_legal_requests_demo after insert on sm_legal_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_legal_requests_demo_t after update or delete on sm_legal_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_legal_requests enable row level security;

-- licence_pool: مجوزها و صندلی‌ها
do $cols$
begin
  if to_regclass('sm_licence_pools') is not null then
    alter table sm_licence_pools add column if not exists workspace_id uuid;
    alter table sm_licence_pools add column if not exists domain_id uuid;
    alter table sm_licence_pools add column if not exists unit_id uuid;
    alter table sm_licence_pools add column if not exists created_at timestamptz not null default now();
    alter table sm_licence_pools add column if not exists created_by uuid;
    alter table sm_licence_pools add column if not exists updated_at timestamptz not null default now();
    alter table sm_licence_pools add column if not exists updated_by uuid;
    alter table sm_licence_pools add column if not exists rev bigint not null default 0;
    alter table sm_licence_pools add column if not exists version integer not null default 1;
    alter table sm_licence_pools add column if not exists deleted_at timestamptz;
    alter table sm_licence_pools add column if not exists origin text;
    alter table sm_licence_pools add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_licence_pools add column if not exists name text;
    alter table sm_licence_pools add column if not exists kind text;
    alter table sm_licence_pools add column if not exists quantity integer;
    alter table sm_licence_pools add column if not exists valid_until date;
    alter table sm_licence_pools add column if not exists active boolean not null default true;
    alter table sm_licence_pools add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_licence_pools (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  quantity integer,
  valid_until date,
  active boolean not null default true,
  note text
);
create index if not exists sm_licence_pools_rev_idx on sm_licence_pools (org_id, rev);
create index if not exists sm_licence_pools_upd_idx on sm_licence_pools (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_licence_pools_crt_idx on sm_licence_pools (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_licence_pools_sync on sm_licence_pools;
create trigger sm_licence_pools_sync before insert or update on sm_licence_pools for each row execute function sm_sync_touch('licence_pool');
create or replace trigger sm_licence_pools_demo after insert on sm_licence_pools for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_licence_pools_demo_t after update or delete on sm_licence_pools for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_licence_pools enable row level security;

-- license_allocation: تخصیص‌های مجوز
do $cols$
begin
  if to_regclass('sm_license_allocations') is not null then
    alter table sm_license_allocations add column if not exists workspace_id uuid;
    alter table sm_license_allocations add column if not exists domain_id uuid;
    alter table sm_license_allocations add column if not exists unit_id uuid;
    alter table sm_license_allocations add column if not exists created_at timestamptz not null default now();
    alter table sm_license_allocations add column if not exists created_by uuid;
    alter table sm_license_allocations add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_allocations add column if not exists updated_by uuid;
    alter table sm_license_allocations add column if not exists rev bigint not null default 0;
    alter table sm_license_allocations add column if not exists version integer not null default 1;
    alter table sm_license_allocations add column if not exists deleted_at timestamptz;
    alter table sm_license_allocations add column if not exists origin text;
    alter table sm_license_allocations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_allocations add column if not exists entitlement_id uuid;
    alter table sm_license_allocations add column if not exists user_id uuid;
    alter table sm_license_allocations add column if not exists ci_id uuid;
    alter table sm_license_allocations add column if not exists allocated_at timestamptz;
    alter table sm_license_allocations add column if not exists released_at timestamptz;
    alter table sm_license_allocations add column if not exists active boolean not null default true;
    alter table sm_license_allocations add column if not exists note text;
    alter table sm_license_allocations add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_license_allocations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  user_id uuid,
  ci_id uuid,
  allocated_at timestamptz,
  released_at timestamptz,
  active boolean not null default true,
  note text,
  label text
);
create index if not exists sm_license_allocations_rev_idx on sm_license_allocations (org_id, rev);
create index if not exists sm_license_allocations_upd_idx on sm_license_allocations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_allocations_crt_idx on sm_license_allocations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_allocations_entitlement_id_idx on sm_license_allocations (org_id, entitlement_id) where deleted_at is null;
create index if not exists sm_license_allocations_workspace_acc_idx on sm_license_allocations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_license_allocations_unit_acc_idx on sm_license_allocations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_license_allocations_domain_acc_idx on sm_license_allocations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_license_allocations_user_id_idx on sm_license_allocations (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_license_allocations_sync on sm_license_allocations;
create trigger sm_license_allocations_sync before insert or update on sm_license_allocations for each row execute function sm_sync_touch('license_allocation');
create or replace trigger sm_license_allocations_demo after insert on sm_license_allocations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_allocations_demo_t after update or delete on sm_license_allocations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_allocations enable row level security;

-- license_entitlement: مجوزهای نرم‌افزار
do $cols$
begin
  if to_regclass('sm_license_entitlements') is not null then
    alter table sm_license_entitlements add column if not exists workspace_id uuid;
    alter table sm_license_entitlements add column if not exists domain_id uuid;
    alter table sm_license_entitlements add column if not exists unit_id uuid;
    alter table sm_license_entitlements add column if not exists created_at timestamptz not null default now();
    alter table sm_license_entitlements add column if not exists created_by uuid;
    alter table sm_license_entitlements add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_entitlements add column if not exists updated_by uuid;
    alter table sm_license_entitlements add column if not exists rev bigint not null default 0;
    alter table sm_license_entitlements add column if not exists version integer not null default 1;
    alter table sm_license_entitlements add column if not exists deleted_at timestamptz;
    alter table sm_license_entitlements add column if not exists origin text;
    alter table sm_license_entitlements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_entitlements add column if not exists no integer;
    alter table sm_license_entitlements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ENT' || no::text else 'ENT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_license_entitlements add column if not exists name text;
    alter table sm_license_entitlements add column if not exists software_model_id uuid;
    alter table sm_license_entitlements add column if not exists metric text;
    alter table sm_license_entitlements add column if not exists quantity integer;
    alter table sm_license_entitlements add column if not exists min_cores integer;
    alter table sm_license_entitlements add column if not exists supplier_id uuid;
    alter table sm_license_entitlements add column if not exists contract_id uuid;
    alter table sm_license_entitlements add column if not exists owner_id uuid;
    alter table sm_license_entitlements add column if not exists cost_center_id uuid;
    alter table sm_license_entitlements add column if not exists po_number text;
    alter table sm_license_entitlements add column if not exists purchase_date date;
    alter table sm_license_entitlements add column if not exists start_date date;
    alter table sm_license_entitlements add column if not exists end_date date;
    alter table sm_license_entitlements add column if not exists true_up_date date;
    alter table sm_license_entitlements add column if not exists unit_cost numeric;
    alter table sm_license_entitlements add column if not exists total_cost numeric;
    alter table sm_license_entitlements add column if not exists annual_cost numeric;
    alter table sm_license_entitlements add column if not exists license_key text;
    alter table sm_license_entitlements add column if not exists downgrade_rights boolean not null default false;
    alter table sm_license_entitlements add column if not exists allocation_required boolean not null default false;
    alter table sm_license_entitlements add column if not exists reminded jsonb;
    alter table sm_license_entitlements add column if not exists notes text;
    alter table sm_license_entitlements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_license_entitlements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  software_model_id uuid,
  metric text,
  quantity integer,
  min_cores integer,
  supplier_id uuid,
  contract_id uuid,
  owner_id uuid,
  cost_center_id uuid,
  po_number text,
  purchase_date date,
  start_date date,
  end_date date,
  true_up_date date,
  unit_cost numeric,
  total_cost numeric,
  annual_cost numeric,
  license_key text,
  downgrade_rights boolean not null default false,
  allocation_required boolean not null default false,
  reminded jsonb,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_license_entitlements', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_license_entitlements_search_56291d9d_trgm', 'sm_license_entitlements', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_license_entitlements_search_custom_trgm', 'sm_license_entitlements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_license_entitlements_no_uk on sm_license_entitlements (org_id, no);
create index if not exists sm_license_entitlements_rev_idx on sm_license_entitlements (org_id, rev);
create index if not exists sm_license_entitlements_upd_idx on sm_license_entitlements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_entitlements_crt_idx on sm_license_entitlements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_entitlements_software_model_id_idx on sm_license_entitlements (org_id, software_model_id) where deleted_at is null;
create index if not exists sm_license_entitlements_end_date_idx on sm_license_entitlements (org_id, end_date) where deleted_at is null;
create index if not exists sm_license_entitlements_state_idx on sm_license_entitlements (org_id, state) where deleted_at is null;
create index if not exists sm_license_entitlements_workspace_acc_idx on sm_license_entitlements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_license_entitlements_unit_acc_idx on sm_license_entitlements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_license_entitlements_domain_acc_idx on sm_license_entitlements (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_license_entitlements_owner_id_idx on sm_license_entitlements (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_license_entitlements_sync on sm_license_entitlements;
create trigger sm_license_entitlements_sync before insert or update on sm_license_entitlements for each row execute function sm_sync_touch('license_entitlement');
create or replace trigger sm_license_entitlements_demo after insert on sm_license_entitlements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_entitlements_demo_t after update or delete on sm_license_entitlements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_entitlements enable row level security;

-- license_position: وضعیت مجوزها
do $cols$
begin
  if to_regclass('sm_license_positions') is not null then
    alter table sm_license_positions add column if not exists workspace_id uuid;
    alter table sm_license_positions add column if not exists domain_id uuid;
    alter table sm_license_positions add column if not exists unit_id uuid;
    alter table sm_license_positions add column if not exists created_at timestamptz not null default now();
    alter table sm_license_positions add column if not exists created_by uuid;
    alter table sm_license_positions add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_positions add column if not exists updated_by uuid;
    alter table sm_license_positions add column if not exists rev bigint not null default 0;
    alter table sm_license_positions add column if not exists version integer not null default 1;
    alter table sm_license_positions add column if not exists deleted_at timestamptz;
    alter table sm_license_positions add column if not exists origin text;
    alter table sm_license_positions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_positions add column if not exists run_id uuid;
    alter table sm_license_positions add column if not exists software_model_id uuid;
    alter table sm_license_positions add column if not exists metric text;
    alter table sm_license_positions add column if not exists entitled integer;
    alter table sm_license_positions add column if not exists consumed integer;
    alter table sm_license_positions add column if not exists delta integer;
    alter table sm_license_positions add column if not exists installs integer;
    alter table sm_license_positions add column if not exists devices integer;
    alter table sm_license_positions add column if not exists users integer;
    alter table sm_license_positions add column if not exists unused_installs integer;
    alter table sm_license_positions add column if not exists status text;
    alter table sm_license_positions add column if not exists unit_price numeric;
    alter table sm_license_positions add column if not exists exposure numeric;
    alter table sm_license_positions add column if not exists savings numeric;
    alter table sm_license_positions add column if not exists detail jsonb;
    alter table sm_license_positions add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_license_positions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  run_id uuid,
  software_model_id uuid,
  metric text,
  entitled integer,
  consumed integer,
  delta integer,
  installs integer,
  devices integer,
  users integer,
  unused_installs integer,
  status text,
  unit_price numeric,
  exposure numeric,
  savings numeric,
  detail jsonb,
  label text
);
create index if not exists sm_license_positions_rev_idx on sm_license_positions (org_id, rev);
create index if not exists sm_license_positions_upd_idx on sm_license_positions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_positions_crt_idx on sm_license_positions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_positions_run_id_idx on sm_license_positions (org_id, run_id) where deleted_at is null;
create index if not exists sm_license_positions_software_model_id_idx on sm_license_positions (org_id, software_model_id) where deleted_at is null;
drop trigger if exists sm_license_positions_sync on sm_license_positions;
create trigger sm_license_positions_sync before insert or update on sm_license_positions for each row execute function sm_sync_touch('license_position');
create or replace trigger sm_license_positions_demo after insert on sm_license_positions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_positions_demo_t after update or delete on sm_license_positions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_positions enable row level security;

-- license_reconcile_run: اجراهای تطبیق مجوز
do $cols$
begin
  if to_regclass('sm_license_reconcile_runs') is not null then
    alter table sm_license_reconcile_runs add column if not exists workspace_id uuid;
    alter table sm_license_reconcile_runs add column if not exists domain_id uuid;
    alter table sm_license_reconcile_runs add column if not exists unit_id uuid;
    alter table sm_license_reconcile_runs add column if not exists created_at timestamptz not null default now();
    alter table sm_license_reconcile_runs add column if not exists created_by uuid;
    alter table sm_license_reconcile_runs add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_reconcile_runs add column if not exists updated_by uuid;
    alter table sm_license_reconcile_runs add column if not exists rev bigint not null default 0;
    alter table sm_license_reconcile_runs add column if not exists version integer not null default 1;
    alter table sm_license_reconcile_runs add column if not exists deleted_at timestamptz;
    alter table sm_license_reconcile_runs add column if not exists origin text;
    alter table sm_license_reconcile_runs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_reconcile_runs add column if not exists no integer;
    alter table sm_license_reconcile_runs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'LRN' || no::text else 'LRN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_license_reconcile_runs add column if not exists status text;
    alter table sm_license_reconcile_runs add column if not exists trigger text;
    alter table sm_license_reconcile_runs add column if not exists started_at timestamptz;
    alter table sm_license_reconcile_runs add column if not exists finished_at timestamptz;
    alter table sm_license_reconcile_runs add column if not exists products integer;
    alter table sm_license_reconcile_runs add column if not exists compliant integer;
    alter table sm_license_reconcile_runs add column if not exists under_licensed integer;
    alter table sm_license_reconcile_runs add column if not exists over_licensed integer;
    alter table sm_license_reconcile_runs add column if not exists exposure numeric;
    alter table sm_license_reconcile_runs add column if not exists savings numeric;
    alter table sm_license_reconcile_runs add column if not exists error text;
  end if;
end
$cols$;
create table if not exists sm_license_reconcile_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'LRN' || no::text else 'LRN' || lpad(no::text, 6, '0') end) stored,
  status text,
  trigger text,
  started_at timestamptz,
  finished_at timestamptz,
  products integer,
  compliant integer,
  under_licensed integer,
  over_licensed integer,
  exposure numeric,
  savings numeric,
  error text
);
create unique index if not exists sm_license_reconcile_runs_no_uk on sm_license_reconcile_runs (org_id, no);
create index if not exists sm_license_reconcile_runs_rev_idx on sm_license_reconcile_runs (org_id, rev);
create index if not exists sm_license_reconcile_runs_upd_idx on sm_license_reconcile_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_reconcile_runs_crt_idx on sm_license_reconcile_runs (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_license_reconcile_runs_sync on sm_license_reconcile_runs;
create trigger sm_license_reconcile_runs_sync before insert or update on sm_license_reconcile_runs for each row execute function sm_sync_touch('license_reconcile_run');
create or replace trigger sm_license_reconcile_runs_demo after insert on sm_license_reconcile_runs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_reconcile_runs_demo_t after update or delete on sm_license_reconcile_runs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_reconcile_runs enable row level security;

-- location: مکان‌ها
do $cols$
begin
  if to_regclass('sm_locations') is not null then
    alter table sm_locations add column if not exists workspace_id uuid;
    alter table sm_locations add column if not exists domain_id uuid;
    alter table sm_locations add column if not exists unit_id uuid;
    alter table sm_locations add column if not exists created_at timestamptz not null default now();
    alter table sm_locations add column if not exists created_by uuid;
    alter table sm_locations add column if not exists updated_at timestamptz not null default now();
    alter table sm_locations add column if not exists updated_by uuid;
    alter table sm_locations add column if not exists rev bigint not null default 0;
    alter table sm_locations add column if not exists version integer not null default 1;
    alter table sm_locations add column if not exists deleted_at timestamptz;
    alter table sm_locations add column if not exists origin text;
    alter table sm_locations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_locations add column if not exists name text;
    alter table sm_locations add column if not exists code text;
    alter table sm_locations add column if not exists kind text;
    alter table sm_locations add column if not exists parent_id uuid;
    alter table sm_locations add column if not exists timezone text;
    alter table sm_locations add column if not exists address text;
    alter table sm_locations add column if not exists active boolean not null default true;
    alter table sm_locations add column if not exists path text;
    alter table sm_locations add column if not exists depth integer;
  end if;
end
$cols$;
create table if not exists sm_locations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  timezone text,
  address text,
  active boolean not null default true,
  path text,
  depth integer
);
create index if not exists sm_locations_rev_idx on sm_locations (org_id, rev);
create index if not exists sm_locations_upd_idx on sm_locations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_locations_crt_idx on sm_locations (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_locations_code_uk on sm_locations (org_id, code) where deleted_at is null;
create index if not exists sm_locations_parent_id_idx on sm_locations (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_locations_sync on sm_locations;
create trigger sm_locations_sync before insert or update on sm_locations for each row execute function sm_sync_touch('location');
create or replace trigger sm_locations_demo after insert on sm_locations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_locations_demo_t after update or delete on sm_locations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_locations enable row level security;

-- maintenance_plan: برنامه‌های نگهداری
do $cols$
begin
  if to_regclass('sm_maintenance_plans') is not null then
    alter table sm_maintenance_plans add column if not exists workspace_id uuid;
    alter table sm_maintenance_plans add column if not exists domain_id uuid;
    alter table sm_maintenance_plans add column if not exists unit_id uuid;
    alter table sm_maintenance_plans add column if not exists created_at timestamptz not null default now();
    alter table sm_maintenance_plans add column if not exists created_by uuid;
    alter table sm_maintenance_plans add column if not exists updated_at timestamptz not null default now();
    alter table sm_maintenance_plans add column if not exists updated_by uuid;
    alter table sm_maintenance_plans add column if not exists rev bigint not null default 0;
    alter table sm_maintenance_plans add column if not exists version integer not null default 1;
    alter table sm_maintenance_plans add column if not exists deleted_at timestamptz;
    alter table sm_maintenance_plans add column if not exists origin text;
    alter table sm_maintenance_plans add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_maintenance_plans add column if not exists no integer;
    alter table sm_maintenance_plans add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PMP' || no::text else 'PMP' || lpad(no::text, 5, '0') end) stored;
    alter table sm_maintenance_plans add column if not exists name text;
    alter table sm_maintenance_plans add column if not exists status text;
    alter table sm_maintenance_plans add column if not exists generates text;
    alter table sm_maintenance_plans add column if not exists ci_id uuid;
    alter table sm_maintenance_plans add column if not exists location_id uuid;
    alter table sm_maintenance_plans add column if not exists account_id uuid;
    alter table sm_maintenance_plans add column if not exists template_id uuid;
    alter table sm_maintenance_plans add column if not exists group_id uuid;
    alter table sm_maintenance_plans add column if not exists territory_id uuid;
    alter table sm_maintenance_plans add column if not exists every_n integer;
    alter table sm_maintenance_plans add column if not exists interval_unit text;
    alter table sm_maintenance_plans add column if not exists lead_days integer;
    alter table sm_maintenance_plans add column if not exists horizon integer;
    alter table sm_maintenance_plans add column if not exists next_due date;
    alter table sm_maintenance_plans add column if not exists last_generated_due date;
    alter table sm_maintenance_plans add column if not exists priority text;
    alter table sm_maintenance_plans add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_maintenance_plans (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PMP' || no::text else 'PMP' || lpad(no::text, 5, '0') end) stored,
  name text,
  status text,
  generates text,
  ci_id uuid,
  location_id uuid,
  account_id uuid,
  template_id uuid,
  group_id uuid,
  territory_id uuid,
  every_n integer,
  interval_unit text,
  lead_days integer,
  horizon integer,
  next_due date,
  last_generated_due date,
  priority text,
  description text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_maintenance_plans', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_maintenance_plans_search_56291d9d_trgm', 'sm_maintenance_plans', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_maintenance_plans_search_custom_trgm', 'sm_maintenance_plans', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_maintenance_plans_no_uk on sm_maintenance_plans (org_id, no);
create index if not exists sm_maintenance_plans_rev_idx on sm_maintenance_plans (org_id, rev);
create index if not exists sm_maintenance_plans_upd_idx on sm_maintenance_plans (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_maintenance_plans_crt_idx on sm_maintenance_plans (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_maintenance_plans_workspace_acc_idx on sm_maintenance_plans (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_maintenance_plans_unit_acc_idx on sm_maintenance_plans (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_maintenance_plans_domain_acc_idx on sm_maintenance_plans (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_maintenance_plans_sync on sm_maintenance_plans;
create trigger sm_maintenance_plans_sync before insert or update on sm_maintenance_plans for each row execute function sm_sync_touch('maintenance_plan');
create or replace trigger sm_maintenance_plans_demo after insert on sm_maintenance_plans for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_maintenance_plans_demo_t after update or delete on sm_maintenance_plans for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_maintenance_plans enable row level security;

-- maintenance_sla: تعهدهای نگهداری دستگاه‌ها
do $cols$
begin
  if to_regclass('sm_maintenance_slas') is not null then
    alter table sm_maintenance_slas add column if not exists workspace_id uuid;
    alter table sm_maintenance_slas add column if not exists domain_id uuid;
    alter table sm_maintenance_slas add column if not exists unit_id uuid;
    alter table sm_maintenance_slas add column if not exists created_at timestamptz not null default now();
    alter table sm_maintenance_slas add column if not exists created_by uuid;
    alter table sm_maintenance_slas add column if not exists updated_at timestamptz not null default now();
    alter table sm_maintenance_slas add column if not exists updated_by uuid;
    alter table sm_maintenance_slas add column if not exists rev bigint not null default 0;
    alter table sm_maintenance_slas add column if not exists version integer not null default 1;
    alter table sm_maintenance_slas add column if not exists deleted_at timestamptz;
    alter table sm_maintenance_slas add column if not exists origin text;
    alter table sm_maintenance_slas add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_maintenance_slas add column if not exists name text;
    alter table sm_maintenance_slas add column if not exists contract_id uuid;
    alter table sm_maintenance_slas add column if not exists categories jsonb;
    alter table sm_maintenance_slas add column if not exists response_hours integer;
    alter table sm_maintenance_slas add column if not exists restore_hours integer;
    alter table sm_maintenance_slas add column if not exists availability_target numeric;
    alter table sm_maintenance_slas add column if not exists counts_maintenance boolean not null default false;
    alter table sm_maintenance_slas add column if not exists penalty_per_hour numeric;
    alter table sm_maintenance_slas add column if not exists penalty_cap numeric;
    alter table sm_maintenance_slas add column if not exists active boolean not null default true;
    alter table sm_maintenance_slas add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_maintenance_slas (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  contract_id uuid,
  categories jsonb,
  response_hours integer,
  restore_hours integer,
  availability_target numeric,
  counts_maintenance boolean not null default false,
  penalty_per_hour numeric,
  penalty_cap numeric,
  active boolean not null default true,
  notes text
);
create index if not exists sm_maintenance_slas_rev_idx on sm_maintenance_slas (org_id, rev);
create index if not exists sm_maintenance_slas_upd_idx on sm_maintenance_slas (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_maintenance_slas_crt_idx on sm_maintenance_slas (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_maintenance_slas_sync on sm_maintenance_slas;
create trigger sm_maintenance_slas_sync before insert or update on sm_maintenance_slas for each row execute function sm_sync_touch('maintenance_sla');
create or replace trigger sm_maintenance_slas_demo after insert on sm_maintenance_slas for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_maintenance_slas_demo_t after update or delete on sm_maintenance_slas for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_maintenance_slas enable row level security;

-- member_profile: نمایه‌های اعضا
do $cols$
begin
  if to_regclass('sm_member_profiles') is not null then
    alter table sm_member_profiles add column if not exists workspace_id uuid;
    alter table sm_member_profiles add column if not exists domain_id uuid;
    alter table sm_member_profiles add column if not exists unit_id uuid;
    alter table sm_member_profiles add column if not exists created_at timestamptz not null default now();
    alter table sm_member_profiles add column if not exists created_by uuid;
    alter table sm_member_profiles add column if not exists updated_at timestamptz not null default now();
    alter table sm_member_profiles add column if not exists updated_by uuid;
    alter table sm_member_profiles add column if not exists rev bigint not null default 0;
    alter table sm_member_profiles add column if not exists version integer not null default 1;
    alter table sm_member_profiles add column if not exists deleted_at timestamptz;
    alter table sm_member_profiles add column if not exists origin text;
    alter table sm_member_profiles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_member_profiles add column if not exists user_id uuid;
    alter table sm_member_profiles add column if not exists name text;
    alter table sm_member_profiles add column if not exists persona text;
    alter table sm_member_profiles add column if not exists roles jsonb;
    alter table sm_member_profiles add column if not exists org_unit_id uuid;
    alter table sm_member_profiles add column if not exists location_id uuid;
    alter table sm_member_profiles add column if not exists manager_id uuid;
    alter table sm_member_profiles add column if not exists domain_unit_id uuid;
    alter table sm_member_profiles add column if not exists workspaces jsonb;
    alter table sm_member_profiles add column if not exists title text;
    alter table sm_member_profiles add column if not exists phone text;
    alter table sm_member_profiles add column if not exists vip boolean not null default false;
    alter table sm_member_profiles add column if not exists skills jsonb;
    alter table sm_member_profiles add column if not exists language text;
    alter table sm_member_profiles add column if not exists timezone text;
    alter table sm_member_profiles add column if not exists out_of_office boolean not null default false;
    alter table sm_member_profiles add column if not exists ooo_until timestamptz;
    alter table sm_member_profiles add column if not exists delegate_id uuid;
  end if;
end
$cols$;
create table if not exists sm_member_profiles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  persona text,
  roles jsonb,
  org_unit_id uuid,
  location_id uuid,
  manager_id uuid,
  domain_unit_id uuid,
  workspaces jsonb,
  title text,
  phone text,
  vip boolean not null default false,
  skills jsonb,
  language text,
  timezone text,
  out_of_office boolean not null default false,
  ooo_until timestamptz,
  delegate_id uuid
);
create index if not exists sm_member_profiles_rev_idx on sm_member_profiles (org_id, rev);
create index if not exists sm_member_profiles_upd_idx on sm_member_profiles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_member_profiles_crt_idx on sm_member_profiles (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_member_profiles_user_id_uk on sm_member_profiles (org_id, user_id) where deleted_at is null;
create index if not exists sm_member_profiles_org_unit_id_idx on sm_member_profiles (org_id, org_unit_id) where deleted_at is null;
create index if not exists sm_member_profiles_manager_id_idx on sm_member_profiles (org_id, manager_id) where deleted_at is null;
create index if not exists sm_member_profiles_workspace_acc_idx on sm_member_profiles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_member_profiles_unit_acc_idx on sm_member_profiles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_member_profiles_domain_acc_idx on sm_member_profiles (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_member_profiles_user_id_idx on sm_member_profiles (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_member_profiles_sync on sm_member_profiles;
create trigger sm_member_profiles_sync before insert or update on sm_member_profiles for each row execute function sm_sync_touch('member_profile');
create or replace trigger sm_member_profiles_demo after insert on sm_member_profiles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_member_profiles_demo_t after update or delete on sm_member_profiles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_member_profiles enable row level security;

-- notification: اعلان‌ها
do $cols$
begin
  if to_regclass('sm_notifications') is not null then
    alter table sm_notifications add column if not exists workspace_id uuid;
    alter table sm_notifications add column if not exists domain_id uuid;
    alter table sm_notifications add column if not exists unit_id uuid;
    alter table sm_notifications add column if not exists created_at timestamptz not null default now();
    alter table sm_notifications add column if not exists created_by uuid;
    alter table sm_notifications add column if not exists updated_at timestamptz not null default now();
    alter table sm_notifications add column if not exists updated_by uuid;
    alter table sm_notifications add column if not exists rev bigint not null default 0;
    alter table sm_notifications add column if not exists version integer not null default 1;
    alter table sm_notifications add column if not exists deleted_at timestamptz;
    alter table sm_notifications add column if not exists origin text;
    alter table sm_notifications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notifications add column if not exists user_id uuid;
    alter table sm_notifications add column if not exists title text;
    alter table sm_notifications add column if not exists body text;
    alter table sm_notifications add column if not exists link text;
    alter table sm_notifications add column if not exists table_key text;
    alter table sm_notifications add column if not exists record_id text;
    alter table sm_notifications add column if not exists record_number text;
    alter table sm_notifications add column if not exists event text;
    alter table sm_notifications add column if not exists kind text;
    alter table sm_notifications add column if not exists actor_id uuid;
    alter table sm_notifications add column if not exists rule_key text;
    alter table sm_notifications add column if not exists read_at timestamptz;
    alter table sm_notifications add column if not exists snoozed_until timestamptz;
  end if;
end
$cols$;
create table if not exists sm_notifications (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  title text,
  body text,
  link text,
  table_key text,
  record_id text,
  record_number text,
  event text,
  kind text,
  actor_id uuid,
  rule_key text,
  read_at timestamptz,
  snoozed_until timestamptz
);
create index if not exists sm_notifications_rev_idx on sm_notifications (org_id, rev);
create index if not exists sm_notifications_upd_idx on sm_notifications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notifications_crt_idx on sm_notifications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_notifications_workspace_acc_idx on sm_notifications (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_notifications_unit_acc_idx on sm_notifications (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_notifications_domain_acc_idx on sm_notifications (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_notifications_user_id_idx on sm_notifications (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_notifications_sync on sm_notifications;
create trigger sm_notifications_sync before insert or update on sm_notifications for each row execute function sm_sync_touch('notification');
create or replace trigger sm_notifications_demo after insert on sm_notifications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notifications_demo_t after update or delete on sm_notifications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notifications enable row level security;

-- notification_channel: کانال‌های پیام
do $cols$
begin
  if to_regclass('sm_notification_channels') is not null then
    alter table sm_notification_channels add column if not exists workspace_id uuid;
    alter table sm_notification_channels add column if not exists domain_id uuid;
    alter table sm_notification_channels add column if not exists unit_id uuid;
    alter table sm_notification_channels add column if not exists created_at timestamptz not null default now();
    alter table sm_notification_channels add column if not exists created_by uuid;
    alter table sm_notification_channels add column if not exists updated_at timestamptz not null default now();
    alter table sm_notification_channels add column if not exists updated_by uuid;
    alter table sm_notification_channels add column if not exists rev bigint not null default 0;
    alter table sm_notification_channels add column if not exists version integer not null default 1;
    alter table sm_notification_channels add column if not exists deleted_at timestamptz;
    alter table sm_notification_channels add column if not exists origin text;
    alter table sm_notification_channels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notification_channels add column if not exists name text;
    alter table sm_notification_channels add column if not exists kind text;
    alter table sm_notification_channels add column if not exists active boolean not null default true;
    alter table sm_notification_channels add column if not exists principal_id uuid;
    alter table sm_notification_channels add column if not exists endpoint text;
    alter table sm_notification_channels add column if not exists token text;
    alter table sm_notification_channels add column if not exists chat_id text;
    alter table sm_notification_channels add column if not exists sms_url text;
    alter table sm_notification_channels add column if not exists sms_method text;
    alter table sm_notification_channels add column if not exists sms_content_type text;
    alter table sm_notification_channels add column if not exists sms_sender text;
    alter table sm_notification_channels add column if not exists sms_body text;
    alter table sm_notification_channels add column if not exists sms_headers jsonb;
    alter table sm_notification_channels add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_notification_channels (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  principal_id uuid,
  endpoint text,
  token text,
  chat_id text,
  sms_url text,
  sms_method text,
  sms_content_type text,
  sms_sender text,
  sms_body text,
  sms_headers jsonb,
  description text
);
create index if not exists sm_notification_channels_rev_idx on sm_notification_channels (org_id, rev);
create index if not exists sm_notification_channels_upd_idx on sm_notification_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_channels_crt_idx on sm_notification_channels (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_notification_channels_sync on sm_notification_channels;
create trigger sm_notification_channels_sync before insert or update on sm_notification_channels for each row execute function sm_sync_touch('notification_channel');
create or replace trigger sm_notification_channels_demo after insert on sm_notification_channels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_channels_demo_t after update or delete on sm_notification_channels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_channels enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:15', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

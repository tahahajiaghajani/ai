-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۸ از ۸ (0006_engine_tables:28/30 … 0099_demo_touch)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۸ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 28/30 (a0c3bc7de847)
-- change_request: archive
create table if not exists sm_change_requests_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_change_requests_arc add column if not exists workspace_id uuid;
alter table sm_change_requests_arc add column if not exists domain_id uuid;
alter table sm_change_requests_arc add column if not exists unit_id uuid;
alter table sm_change_requests_arc add column if not exists created_at timestamptz not null default now();
alter table sm_change_requests_arc add column if not exists created_by uuid;
alter table sm_change_requests_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_change_requests_arc add column if not exists updated_by uuid;
alter table sm_change_requests_arc add column if not exists rev bigint not null default 0;
alter table sm_change_requests_arc add column if not exists version integer not null default 1;
alter table sm_change_requests_arc add column if not exists deleted_at timestamptz;
alter table sm_change_requests_arc add column if not exists origin text;
alter table sm_change_requests_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_requests_arc add column if not exists no integer;
alter table sm_change_requests_arc add column if not exists number text;
alter table sm_change_requests_arc add column if not exists short_description text;
alter table sm_change_requests_arc add column if not exists description text;
alter table sm_change_requests_arc add column if not exists state text;
alter table sm_change_requests_arc add column if not exists priority text;
alter table sm_change_requests_arc add column if not exists impact text;
alter table sm_change_requests_arc add column if not exists urgency text;
alter table sm_change_requests_arc add column if not exists category text;
alter table sm_change_requests_arc add column if not exists subcategory text;
alter table sm_change_requests_arc add column if not exists channel text;
alter table sm_change_requests_arc add column if not exists caller_id uuid;
alter table sm_change_requests_arc add column if not exists requested_for uuid;
alter table sm_change_requests_arc add column if not exists opened_by uuid;
alter table sm_change_requests_arc add column if not exists opened_at timestamptz;
alter table sm_change_requests_arc add column if not exists assignment_group_id uuid;
alter table sm_change_requests_arc add column if not exists assigned_to uuid;
alter table sm_change_requests_arc add column if not exists service_id uuid;
alter table sm_change_requests_arc add column if not exists offering_id uuid;
alter table sm_change_requests_arc add column if not exists ci_id uuid;
alter table sm_change_requests_arc add column if not exists location_id uuid;
alter table sm_change_requests_arc add column if not exists due_at timestamptz;
alter table sm_change_requests_arc add column if not exists resolved_at timestamptz;
alter table sm_change_requests_arc add column if not exists resolved_by uuid;
alter table sm_change_requests_arc add column if not exists closed_at timestamptz;
alter table sm_change_requests_arc add column if not exists closed_by uuid;
alter table sm_change_requests_arc add column if not exists close_code text;
alter table sm_change_requests_arc add column if not exists close_notes text;
alter table sm_change_requests_arc add column if not exists parent_id uuid;
alter table sm_change_requests_arc add column if not exists watch_list jsonb;
alter table sm_change_requests_arc add column if not exists approval text;
alter table sm_change_requests_arc add column if not exists escalation integer;
alter table sm_change_requests_arc add column if not exists reassignment_count integer;
alter table sm_change_requests_arc add column if not exists reopen_count integer;
alter table sm_change_requests_arc add column if not exists time_worked bigint;
alter table sm_change_requests_arc add column if not exists first_response_at timestamptz;
alter table sm_change_requests_arc add column if not exists active boolean not null default true;
alter table sm_change_requests_arc add column if not exists sla_due timestamptz;
alter table sm_change_requests_arc add column if not exists knowledge boolean not null default false;
alter table sm_change_requests_arc add column if not exists type text;
alter table sm_change_requests_arc add column if not exists model_id uuid;
alter table sm_change_requests_arc add column if not exists template_id uuid;
alter table sm_change_requests_arc add column if not exists justification text;
alter table sm_change_requests_arc add column if not exists expected_outcome text;
alter table sm_change_requests_arc add column if not exists status_reason text;
alter table sm_change_requests_arc add column if not exists change_owner_id uuid;
alter table sm_change_requests_arc add column if not exists change_manager_id uuid;
alter table sm_change_requests_arc add column if not exists stakeholders jsonb;
alter table sm_change_requests_arc add column if not exists external_ref text;
alter table sm_change_requests_arc add column if not exists on_hold boolean not null default false;
alter table sm_change_requests_arc add column if not exists on_hold_reason text;
alter table sm_change_requests_arc add column if not exists on_hold_since timestamptz;
alter table sm_change_requests_arc add column if not exists affected_cis jsonb;
alter table sm_change_requests_arc add column if not exists affected_services jsonb;
alter table sm_change_requests_arc add column if not exists impacted_services jsonb;
alter table sm_change_requests_arc add column if not exists outage_expected boolean not null default false;
alter table sm_change_requests_arc add column if not exists outage_minutes integer;
alter table sm_change_requests_arc add column if not exists planned_start timestamptz;
alter table sm_change_requests_arc add column if not exists planned_end timestamptz;
alter table sm_change_requests_arc add column if not exists maintenance_window_id uuid;
alter table sm_change_requests_arc add column if not exists actual_start timestamptz;
alter table sm_change_requests_arc add column if not exists actual_end timestamptz;
alter table sm_change_requests_arc add column if not exists duration_actual bigint;
alter table sm_change_requests_arc add column if not exists is_late boolean not null default false;
alter table sm_change_requests_arc add column if not exists lead_days integer;
alter table sm_change_requests_arc add column if not exists in_blackout boolean not null default false;
alter table sm_change_requests_arc add column if not exists outside_window boolean not null default false;
alter table sm_change_requests_arc add column if not exists blackout_override_reason text;
alter table sm_change_requests_arc add column if not exists conflict_status text;
alter table sm_change_requests_arc add column if not exists conflict_count integer;
alter table sm_change_requests_arc add column if not exists conflict_checked_at timestamptz;
alter table sm_change_requests_arc add column if not exists exclude_conflicts boolean not null default false;
alter table sm_change_requests_arc add column if not exists lockdown_id uuid;
alter table sm_change_requests_arc add column if not exists window_alerted_at timestamptz;
alter table sm_change_requests_arc add column if not exists overrun_alerted_at timestamptz;
alter table sm_change_requests_arc add column if not exists implementation_plan text;
alter table sm_change_requests_arc add column if not exists test_plan text;
alter table sm_change_requests_arc add column if not exists test_results text;
alter table sm_change_requests_arc add column if not exists backout_plan text;
alter table sm_change_requests_arc add column if not exists backout_tested boolean not null default false;
alter table sm_change_requests_arc add column if not exists communication_plan text;
alter table sm_change_requests_arc add column if not exists planned_effort numeric;
alter table sm_change_requests_arc add column if not exists planned_cost numeric;
alter table sm_change_requests_arc add column if not exists risk text;
alter table sm_change_requests_arc add column if not exists risk_score integer;
alter table sm_change_requests_arc add column if not exists risk_calculated text;
alter table sm_change_requests_arc add column if not exists risk_source text;
alter table sm_change_requests_arc add column if not exists risk_override_reason text;
alter table sm_change_requests_arc add column if not exists risk_answers jsonb;
alter table sm_change_requests_arc add column if not exists risk_factors jsonb;
alter table sm_change_requests_arc add column if not exists risk_explanation text;
alter table sm_change_requests_arc add column if not exists risk_assessed_at timestamptz;
alter table sm_change_requests_arc add column if not exists cab_required boolean not null default false;
alter table sm_change_requests_arc add column if not exists cab_id uuid;
alter table sm_change_requests_arc add column if not exists cab_meeting_id uuid;
alter table sm_change_requests_arc add column if not exists cab_recommendation text;
alter table sm_change_requests_arc add column if not exists submitted_at timestamptz;
alter table sm_change_requests_arc add column if not exists auth_cycle_at timestamptz;
alter table sm_change_requests_arc add column if not exists authorized_at timestamptz;
alter table sm_change_requests_arc add column if not exists requester_confirmed boolean not null default false;
alter table sm_change_requests_arc add column if not exists implementation_rating integer;
alter table sm_change_requests_arc add column if not exists lessons text;
alter table sm_change_requests_arc add column if not exists pir_required boolean not null default false;
alter table sm_change_requests_arc add column if not exists pir_id uuid;
alter table sm_change_requests_arc add column if not exists incidents_caused integer;
alter table sm_change_requests_arc add column if not exists retrospective boolean not null default false;
alter table sm_change_requests_arc add column if not exists discovered_by text;
alter table sm_change_requests_arc add column if not exists origin_table text;
alter table sm_change_requests_arc add column if not exists origin_id text;
alter table sm_change_requests_arc add column if not exists model_states jsonb;
alter table sm_change_requests_arc add column if not exists confidential boolean not null default false;
alter table sm_change_requests_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_requests_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_1f830243' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_requests_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_requests_arc' and column_name = 'search_1f830243') then
    execute format('alter table %I add column %I text', 'sm_change_requests_arc', 'search_1f830243');
    execute format('update %I set %I = (%s)', 'sm_change_requests_arc', 'search_1f830243', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(justification, '') || ' ' || coalesce(external_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_change_requests_arc_no_idx on sm_change_requests_arc (org_id, no);
create index if not exists sm_change_requests_arc_arch_idx on sm_change_requests_arc (org_id, archived_at);
create index if not exists sm_change_requests_arc_upd_idx on sm_change_requests_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_requests_arc_caller_id_idx on sm_change_requests_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_change_requests_arc_requested_for_idx on sm_change_requests_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_change_requests_arc_opened_by_idx on sm_change_requests_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_change_requests_arc_assigned_to_idx on sm_change_requests_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_requests_arc_change_owner_id_idx on sm_change_requests_arc (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_requests_arc_change_manager_id_idx on sm_change_requests_arc (org_id, change_manager_id) where deleted_at is null;
create index if not exists sm_change_requests_arc_assignment_group_id_idx on sm_change_requests_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_requests_arc_unit_id_idx on sm_change_requests_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_requests_arc_search_1f830243_trgm', 'sm_change_requests_arc', 'search_1f830243', s); end if;
end
$arc$;
alter table sm_change_requests_arc enable row level security;

-- change_task: archive
create table if not exists sm_change_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_change_tasks_arc add column if not exists workspace_id uuid;
alter table sm_change_tasks_arc add column if not exists domain_id uuid;
alter table sm_change_tasks_arc add column if not exists unit_id uuid;
alter table sm_change_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_change_tasks_arc add column if not exists created_by uuid;
alter table sm_change_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_change_tasks_arc add column if not exists updated_by uuid;
alter table sm_change_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_change_tasks_arc add column if not exists version integer not null default 1;
alter table sm_change_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_change_tasks_arc add column if not exists origin text;
alter table sm_change_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_tasks_arc add column if not exists no integer;
alter table sm_change_tasks_arc add column if not exists number text;
alter table sm_change_tasks_arc add column if not exists short_description text;
alter table sm_change_tasks_arc add column if not exists description text;
alter table sm_change_tasks_arc add column if not exists state text;
alter table sm_change_tasks_arc add column if not exists priority text;
alter table sm_change_tasks_arc add column if not exists impact text;
alter table sm_change_tasks_arc add column if not exists urgency text;
alter table sm_change_tasks_arc add column if not exists category text;
alter table sm_change_tasks_arc add column if not exists subcategory text;
alter table sm_change_tasks_arc add column if not exists channel text;
alter table sm_change_tasks_arc add column if not exists caller_id uuid;
alter table sm_change_tasks_arc add column if not exists requested_for uuid;
alter table sm_change_tasks_arc add column if not exists opened_by uuid;
alter table sm_change_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_change_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_change_tasks_arc add column if not exists assigned_to uuid;
alter table sm_change_tasks_arc add column if not exists service_id uuid;
alter table sm_change_tasks_arc add column if not exists offering_id uuid;
alter table sm_change_tasks_arc add column if not exists ci_id uuid;
alter table sm_change_tasks_arc add column if not exists location_id uuid;
alter table sm_change_tasks_arc add column if not exists due_at timestamptz;
alter table sm_change_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_change_tasks_arc add column if not exists resolved_by uuid;
alter table sm_change_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_change_tasks_arc add column if not exists closed_by uuid;
alter table sm_change_tasks_arc add column if not exists close_code text;
alter table sm_change_tasks_arc add column if not exists close_notes text;
alter table sm_change_tasks_arc add column if not exists parent_id uuid;
alter table sm_change_tasks_arc add column if not exists watch_list jsonb;
alter table sm_change_tasks_arc add column if not exists approval text;
alter table sm_change_tasks_arc add column if not exists escalation integer;
alter table sm_change_tasks_arc add column if not exists reassignment_count integer;
alter table sm_change_tasks_arc add column if not exists reopen_count integer;
alter table sm_change_tasks_arc add column if not exists time_worked bigint;
alter table sm_change_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_change_tasks_arc add column if not exists active boolean not null default true;
alter table sm_change_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_change_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_change_tasks_arc add column if not exists change_id uuid;
alter table sm_change_tasks_arc add column if not exists task_type text;
alter table sm_change_tasks_arc add column if not exists mandatory boolean not null default true;
alter table sm_change_tasks_arc add column if not exists sort_order integer;
alter table sm_change_tasks_arc add column if not exists depends_on jsonb;
alter table sm_change_tasks_arc add column if not exists planned_start timestamptz;
alter table sm_change_tasks_arc add column if not exists planned_end timestamptz;
alter table sm_change_tasks_arc add column if not exists actual_start timestamptz;
alter table sm_change_tasks_arc add column if not exists actual_end timestamptz;
alter table sm_change_tasks_arc add column if not exists checklist text;
alter table sm_change_tasks_arc add column if not exists change_owner_id uuid;
alter table sm_change_tasks_arc add column if not exists confidential boolean not null default false;
alter table sm_change_tasks_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_change_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_change_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_change_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_change_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_change_tasks_arc_no_idx on sm_change_tasks_arc (org_id, no);
create index if not exists sm_change_tasks_arc_arch_idx on sm_change_tasks_arc (org_id, archived_at);
create index if not exists sm_change_tasks_arc_upd_idx on sm_change_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_tasks_arc_caller_id_idx on sm_change_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_change_tasks_arc_requested_for_idx on sm_change_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_change_tasks_arc_opened_by_idx on sm_change_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_change_tasks_arc_assigned_to_idx on sm_change_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_tasks_arc_change_owner_id_idx on sm_change_tasks_arc (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_tasks_arc_assignment_group_id_idx on sm_change_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_tasks_arc_unit_id_idx on sm_change_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_change_tasks_arc_search_f3bce210_trgm', 'sm_change_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_change_tasks_arc enable row level security;

-- ci_cert_task: archive
create table if not exists sm_ci_cert_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_ci_cert_tasks_arc add column if not exists workspace_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists domain_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists unit_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_ci_cert_tasks_arc add column if not exists created_by uuid;
alter table sm_ci_cert_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_cert_tasks_arc add column if not exists updated_by uuid;
alter table sm_ci_cert_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_ci_cert_tasks_arc add column if not exists version integer not null default 1;
alter table sm_ci_cert_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists origin text;
alter table sm_ci_cert_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_cert_tasks_arc add column if not exists no integer;
alter table sm_ci_cert_tasks_arc add column if not exists number text;
alter table sm_ci_cert_tasks_arc add column if not exists short_description text;
alter table sm_ci_cert_tasks_arc add column if not exists description text;
alter table sm_ci_cert_tasks_arc add column if not exists state text;
alter table sm_ci_cert_tasks_arc add column if not exists priority text;
alter table sm_ci_cert_tasks_arc add column if not exists impact text;
alter table sm_ci_cert_tasks_arc add column if not exists urgency text;
alter table sm_ci_cert_tasks_arc add column if not exists category text;
alter table sm_ci_cert_tasks_arc add column if not exists subcategory text;
alter table sm_ci_cert_tasks_arc add column if not exists channel text;
alter table sm_ci_cert_tasks_arc add column if not exists caller_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists requested_for uuid;
alter table sm_ci_cert_tasks_arc add column if not exists opened_by uuid;
alter table sm_ci_cert_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists assigned_to uuid;
alter table sm_ci_cert_tasks_arc add column if not exists service_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists offering_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists ci_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists location_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists due_at timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists resolved_by uuid;
alter table sm_ci_cert_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists closed_by uuid;
alter table sm_ci_cert_tasks_arc add column if not exists close_code text;
alter table sm_ci_cert_tasks_arc add column if not exists close_notes text;
alter table sm_ci_cert_tasks_arc add column if not exists parent_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists watch_list jsonb;
alter table sm_ci_cert_tasks_arc add column if not exists approval text;
alter table sm_ci_cert_tasks_arc add column if not exists escalation integer;
alter table sm_ci_cert_tasks_arc add column if not exists reassignment_count integer;
alter table sm_ci_cert_tasks_arc add column if not exists reopen_count integer;
alter table sm_ci_cert_tasks_arc add column if not exists time_worked bigint;
alter table sm_ci_cert_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists active boolean not null default true;
alter table sm_ci_cert_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_ci_cert_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_ci_cert_tasks_arc add column if not exists campaign_id uuid;
alter table sm_ci_cert_tasks_arc add column if not exists ci_ids jsonb;
alter table sm_ci_cert_tasks_arc add column if not exists corrections text;
alter table sm_ci_cert_tasks_arc add column if not exists confirmed_count integer;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_cert_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_ci_cert_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_cert_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_ci_cert_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_ci_cert_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_ci_cert_tasks_arc_no_idx on sm_ci_cert_tasks_arc (org_id, no);
create index if not exists sm_ci_cert_tasks_arc_arch_idx on sm_ci_cert_tasks_arc (org_id, archived_at);
create index if not exists sm_ci_cert_tasks_arc_upd_idx on sm_ci_cert_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_arc_caller_id_idx on sm_ci_cert_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_arc_requested_for_idx on sm_ci_cert_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_arc_opened_by_idx on sm_ci_cert_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_arc_assigned_to_idx on sm_ci_cert_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_arc_assignment_group_id_idx on sm_ci_cert_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_arc_unit_id_idx on sm_ci_cert_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_ci_cert_tasks_arc_search_f3bce210_trgm', 'sm_ci_cert_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_ci_cert_tasks_arc enable row level security;

-- ci_drift: archive
create table if not exists sm_ci_drifts_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_ci_drifts_arc add column if not exists workspace_id uuid;
alter table sm_ci_drifts_arc add column if not exists domain_id uuid;
alter table sm_ci_drifts_arc add column if not exists unit_id uuid;
alter table sm_ci_drifts_arc add column if not exists created_at timestamptz not null default now();
alter table sm_ci_drifts_arc add column if not exists created_by uuid;
alter table sm_ci_drifts_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_drifts_arc add column if not exists updated_by uuid;
alter table sm_ci_drifts_arc add column if not exists rev bigint not null default 0;
alter table sm_ci_drifts_arc add column if not exists version integer not null default 1;
alter table sm_ci_drifts_arc add column if not exists deleted_at timestamptz;
alter table sm_ci_drifts_arc add column if not exists origin text;
alter table sm_ci_drifts_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_drifts_arc add column if not exists no integer;
alter table sm_ci_drifts_arc add column if not exists number text;
alter table sm_ci_drifts_arc add column if not exists short_description text;
alter table sm_ci_drifts_arc add column if not exists description text;
alter table sm_ci_drifts_arc add column if not exists state text;
alter table sm_ci_drifts_arc add column if not exists priority text;
alter table sm_ci_drifts_arc add column if not exists impact text;
alter table sm_ci_drifts_arc add column if not exists urgency text;
alter table sm_ci_drifts_arc add column if not exists category text;
alter table sm_ci_drifts_arc add column if not exists subcategory text;
alter table sm_ci_drifts_arc add column if not exists channel text;
alter table sm_ci_drifts_arc add column if not exists caller_id uuid;
alter table sm_ci_drifts_arc add column if not exists requested_for uuid;
alter table sm_ci_drifts_arc add column if not exists opened_by uuid;
alter table sm_ci_drifts_arc add column if not exists opened_at timestamptz;
alter table sm_ci_drifts_arc add column if not exists assignment_group_id uuid;
alter table sm_ci_drifts_arc add column if not exists assigned_to uuid;
alter table sm_ci_drifts_arc add column if not exists service_id uuid;
alter table sm_ci_drifts_arc add column if not exists offering_id uuid;
alter table sm_ci_drifts_arc add column if not exists ci_id uuid;
alter table sm_ci_drifts_arc add column if not exists location_id uuid;
alter table sm_ci_drifts_arc add column if not exists due_at timestamptz;
alter table sm_ci_drifts_arc add column if not exists resolved_at timestamptz;
alter table sm_ci_drifts_arc add column if not exists resolved_by uuid;
alter table sm_ci_drifts_arc add column if not exists closed_at timestamptz;
alter table sm_ci_drifts_arc add column if not exists closed_by uuid;
alter table sm_ci_drifts_arc add column if not exists close_code text;
alter table sm_ci_drifts_arc add column if not exists close_notes text;
alter table sm_ci_drifts_arc add column if not exists parent_id uuid;
alter table sm_ci_drifts_arc add column if not exists watch_list jsonb;
alter table sm_ci_drifts_arc add column if not exists approval text;
alter table sm_ci_drifts_arc add column if not exists escalation integer;
alter table sm_ci_drifts_arc add column if not exists reassignment_count integer;
alter table sm_ci_drifts_arc add column if not exists reopen_count integer;
alter table sm_ci_drifts_arc add column if not exists time_worked bigint;
alter table sm_ci_drifts_arc add column if not exists first_response_at timestamptz;
alter table sm_ci_drifts_arc add column if not exists active boolean not null default true;
alter table sm_ci_drifts_arc add column if not exists sla_due timestamptz;
alter table sm_ci_drifts_arc add column if not exists knowledge boolean not null default false;
alter table sm_ci_drifts_arc add column if not exists attribute text;
alter table sm_ci_drifts_arc add column if not exists expected text;
alter table sm_ci_drifts_arc add column if not exists actual text;
alter table sm_ci_drifts_arc add column if not exists baseline_id uuid;
alter table sm_ci_drifts_arc add column if not exists source_id uuid;
alter table sm_ci_drifts_arc add column if not exists change_id uuid;
alter table sm_ci_drifts_arc add column if not exists decision text;
alter table sm_ci_drifts_arc add column if not exists dedupe_key text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_drifts_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_ci_drifts_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_ci_drifts_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_ci_drifts_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_ci_drifts_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_ci_drifts_arc_no_idx on sm_ci_drifts_arc (org_id, no);
create index if not exists sm_ci_drifts_arc_arch_idx on sm_ci_drifts_arc (org_id, archived_at);
create index if not exists sm_ci_drifts_arc_upd_idx on sm_ci_drifts_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_drifts_arc_caller_id_idx on sm_ci_drifts_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_ci_drifts_arc_requested_for_idx on sm_ci_drifts_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_ci_drifts_arc_opened_by_idx on sm_ci_drifts_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_ci_drifts_arc_assigned_to_idx on sm_ci_drifts_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_ci_drifts_arc_assignment_group_id_idx on sm_ci_drifts_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_ci_drifts_arc_unit_id_idx on sm_ci_drifts_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_ci_drifts_arc_search_f3bce210_trgm', 'sm_ci_drifts_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_ci_drifts_arc enable row level security;

-- cmdb_dedup_task: archive
create table if not exists sm_cmdb_dedup_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_cmdb_dedup_tasks_arc add column if not exists workspace_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists domain_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists unit_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_dedup_tasks_arc add column if not exists created_by uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_dedup_tasks_arc add column if not exists updated_by uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_cmdb_dedup_tasks_arc add column if not exists version integer not null default 1;
alter table sm_cmdb_dedup_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists origin text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_dedup_tasks_arc add column if not exists no integer;
alter table sm_cmdb_dedup_tasks_arc add column if not exists number text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists short_description text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists description text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists state text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists priority text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists impact text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists urgency text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists category text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists subcategory text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists channel text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists caller_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists requested_for uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists opened_by uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists assigned_to uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists service_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists offering_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists ci_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists location_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists due_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists resolved_by uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists closed_by uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists close_code text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists close_notes text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists parent_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists watch_list jsonb;
alter table sm_cmdb_dedup_tasks_arc add column if not exists approval text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists escalation integer;
alter table sm_cmdb_dedup_tasks_arc add column if not exists reassignment_count integer;
alter table sm_cmdb_dedup_tasks_arc add column if not exists reopen_count integer;
alter table sm_cmdb_dedup_tasks_arc add column if not exists time_worked bigint;
alter table sm_cmdb_dedup_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists active boolean not null default true;
alter table sm_cmdb_dedup_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_cmdb_dedup_tasks_arc add column if not exists candidates jsonb;
alter table sm_cmdb_dedup_tasks_arc add column if not exists main_ci_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists score integer;
alter table sm_cmdb_dedup_tasks_arc add column if not exists source_id uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists reason text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists candidate_key text;
alter table sm_cmdb_dedup_tasks_arc add column if not exists merged_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists merged_by uuid;
alter table sm_cmdb_dedup_tasks_arc add column if not exists undone_at timestamptz;
alter table sm_cmdb_dedup_tasks_arc add column if not exists merge_journal jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_dedup_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_cmdb_dedup_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_dedup_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_cmdb_dedup_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_cmdb_dedup_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_cmdb_dedup_tasks_arc_no_idx on sm_cmdb_dedup_tasks_arc (org_id, no);
create index if not exists sm_cmdb_dedup_tasks_arc_arch_idx on sm_cmdb_dedup_tasks_arc (org_id, archived_at);
create index if not exists sm_cmdb_dedup_tasks_arc_upd_idx on sm_cmdb_dedup_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_arc_caller_id_idx on sm_cmdb_dedup_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_arc_requested_for_idx on sm_cmdb_dedup_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_arc_opened_by_idx on sm_cmdb_dedup_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_arc_assigned_to_idx on sm_cmdb_dedup_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_arc_assignment_group_id_idx on sm_cmdb_dedup_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_arc_unit_id_idx on sm_cmdb_dedup_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cmdb_dedup_tasks_arc_search_f3bce210_trgm', 'sm_cmdb_dedup_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_cmdb_dedup_tasks_arc enable row level security;

-- cmdb_finding: archive
create table if not exists sm_cmdb_findings_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_cmdb_findings_arc add column if not exists workspace_id uuid;
alter table sm_cmdb_findings_arc add column if not exists domain_id uuid;
alter table sm_cmdb_findings_arc add column if not exists unit_id uuid;
alter table sm_cmdb_findings_arc add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_findings_arc add column if not exists created_by uuid;
alter table sm_cmdb_findings_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_findings_arc add column if not exists updated_by uuid;
alter table sm_cmdb_findings_arc add column if not exists rev bigint not null default 0;
alter table sm_cmdb_findings_arc add column if not exists version integer not null default 1;
alter table sm_cmdb_findings_arc add column if not exists deleted_at timestamptz;
alter table sm_cmdb_findings_arc add column if not exists origin text;
alter table sm_cmdb_findings_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_findings_arc add column if not exists no integer;
alter table sm_cmdb_findings_arc add column if not exists number text;
alter table sm_cmdb_findings_arc add column if not exists short_description text;
alter table sm_cmdb_findings_arc add column if not exists description text;
alter table sm_cmdb_findings_arc add column if not exists state text;
alter table sm_cmdb_findings_arc add column if not exists priority text;
alter table sm_cmdb_findings_arc add column if not exists impact text;
alter table sm_cmdb_findings_arc add column if not exists urgency text;
alter table sm_cmdb_findings_arc add column if not exists category text;
alter table sm_cmdb_findings_arc add column if not exists subcategory text;
alter table sm_cmdb_findings_arc add column if not exists channel text;
alter table sm_cmdb_findings_arc add column if not exists caller_id uuid;
alter table sm_cmdb_findings_arc add column if not exists requested_for uuid;
alter table sm_cmdb_findings_arc add column if not exists opened_by uuid;
alter table sm_cmdb_findings_arc add column if not exists opened_at timestamptz;
alter table sm_cmdb_findings_arc add column if not exists assignment_group_id uuid;
alter table sm_cmdb_findings_arc add column if not exists assigned_to uuid;
alter table sm_cmdb_findings_arc add column if not exists service_id uuid;
alter table sm_cmdb_findings_arc add column if not exists offering_id uuid;
alter table sm_cmdb_findings_arc add column if not exists ci_id uuid;
alter table sm_cmdb_findings_arc add column if not exists location_id uuid;
alter table sm_cmdb_findings_arc add column if not exists due_at timestamptz;
alter table sm_cmdb_findings_arc add column if not exists resolved_at timestamptz;
alter table sm_cmdb_findings_arc add column if not exists resolved_by uuid;
alter table sm_cmdb_findings_arc add column if not exists closed_at timestamptz;
alter table sm_cmdb_findings_arc add column if not exists closed_by uuid;
alter table sm_cmdb_findings_arc add column if not exists close_code text;
alter table sm_cmdb_findings_arc add column if not exists close_notes text;
alter table sm_cmdb_findings_arc add column if not exists parent_id uuid;
alter table sm_cmdb_findings_arc add column if not exists watch_list jsonb;
alter table sm_cmdb_findings_arc add column if not exists approval text;
alter table sm_cmdb_findings_arc add column if not exists escalation integer;
alter table sm_cmdb_findings_arc add column if not exists reassignment_count integer;
alter table sm_cmdb_findings_arc add column if not exists reopen_count integer;
alter table sm_cmdb_findings_arc add column if not exists time_worked bigint;
alter table sm_cmdb_findings_arc add column if not exists first_response_at timestamptz;
alter table sm_cmdb_findings_arc add column if not exists active boolean not null default true;
alter table sm_cmdb_findings_arc add column if not exists sla_due timestamptz;
alter table sm_cmdb_findings_arc add column if not exists knowledge boolean not null default false;
alter table sm_cmdb_findings_arc add column if not exists kind text;
alter table sm_cmdb_findings_arc add column if not exists severity text;
alter table sm_cmdb_findings_arc add column if not exists rule_id uuid;
alter table sm_cmdb_findings_arc add column if not exists detail text;
alter table sm_cmdb_findings_arc add column if not exists dedupe_key text;
alter table sm_cmdb_findings_arc add column if not exists auto boolean not null default false;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_findings_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_cmdb_findings_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_cmdb_findings_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_cmdb_findings_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_cmdb_findings_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_cmdb_findings_arc_no_idx on sm_cmdb_findings_arc (org_id, no);
create index if not exists sm_cmdb_findings_arc_arch_idx on sm_cmdb_findings_arc (org_id, archived_at);
create index if not exists sm_cmdb_findings_arc_upd_idx on sm_cmdb_findings_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_findings_arc_caller_id_idx on sm_cmdb_findings_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_arc_requested_for_idx on sm_cmdb_findings_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_cmdb_findings_arc_opened_by_idx on sm_cmdb_findings_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_cmdb_findings_arc_assigned_to_idx on sm_cmdb_findings_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_cmdb_findings_arc_assignment_group_id_idx on sm_cmdb_findings_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_arc_unit_id_idx on sm_cmdb_findings_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cmdb_findings_arc_search_f3bce210_trgm', 'sm_cmdb_findings_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_cmdb_findings_arc enable row level security;

-- corrective_action: archive
create table if not exists sm_corrective_actions_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_corrective_actions_arc add column if not exists workspace_id uuid;
alter table sm_corrective_actions_arc add column if not exists domain_id uuid;
alter table sm_corrective_actions_arc add column if not exists unit_id uuid;
alter table sm_corrective_actions_arc add column if not exists created_at timestamptz not null default now();
alter table sm_corrective_actions_arc add column if not exists created_by uuid;
alter table sm_corrective_actions_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_corrective_actions_arc add column if not exists updated_by uuid;
alter table sm_corrective_actions_arc add column if not exists rev bigint not null default 0;
alter table sm_corrective_actions_arc add column if not exists version integer not null default 1;
alter table sm_corrective_actions_arc add column if not exists deleted_at timestamptz;
alter table sm_corrective_actions_arc add column if not exists origin text;
alter table sm_corrective_actions_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_corrective_actions_arc add column if not exists no integer;
alter table sm_corrective_actions_arc add column if not exists number text;
alter table sm_corrective_actions_arc add column if not exists short_description text;
alter table sm_corrective_actions_arc add column if not exists description text;
alter table sm_corrective_actions_arc add column if not exists state text;
alter table sm_corrective_actions_arc add column if not exists priority text;
alter table sm_corrective_actions_arc add column if not exists impact text;
alter table sm_corrective_actions_arc add column if not exists urgency text;
alter table sm_corrective_actions_arc add column if not exists category text;
alter table sm_corrective_actions_arc add column if not exists subcategory text;
alter table sm_corrective_actions_arc add column if not exists channel text;
alter table sm_corrective_actions_arc add column if not exists caller_id uuid;
alter table sm_corrective_actions_arc add column if not exists requested_for uuid;
alter table sm_corrective_actions_arc add column if not exists opened_by uuid;
alter table sm_corrective_actions_arc add column if not exists opened_at timestamptz;
alter table sm_corrective_actions_arc add column if not exists assignment_group_id uuid;
alter table sm_corrective_actions_arc add column if not exists assigned_to uuid;
alter table sm_corrective_actions_arc add column if not exists service_id uuid;
alter table sm_corrective_actions_arc add column if not exists offering_id uuid;
alter table sm_corrective_actions_arc add column if not exists ci_id uuid;
alter table sm_corrective_actions_arc add column if not exists location_id uuid;
alter table sm_corrective_actions_arc add column if not exists due_at timestamptz;
alter table sm_corrective_actions_arc add column if not exists resolved_at timestamptz;
alter table sm_corrective_actions_arc add column if not exists resolved_by uuid;
alter table sm_corrective_actions_arc add column if not exists closed_at timestamptz;
alter table sm_corrective_actions_arc add column if not exists closed_by uuid;
alter table sm_corrective_actions_arc add column if not exists close_code text;
alter table sm_corrective_actions_arc add column if not exists close_notes text;
alter table sm_corrective_actions_arc add column if not exists parent_id uuid;
alter table sm_corrective_actions_arc add column if not exists watch_list jsonb;
alter table sm_corrective_actions_arc add column if not exists approval text;
alter table sm_corrective_actions_arc add column if not exists escalation integer;
alter table sm_corrective_actions_arc add column if not exists reassignment_count integer;
alter table sm_corrective_actions_arc add column if not exists reopen_count integer;
alter table sm_corrective_actions_arc add column if not exists time_worked bigint;
alter table sm_corrective_actions_arc add column if not exists first_response_at timestamptz;
alter table sm_corrective_actions_arc add column if not exists active boolean not null default true;
alter table sm_corrective_actions_arc add column if not exists sla_due timestamptz;
alter table sm_corrective_actions_arc add column if not exists knowledge boolean not null default false;
alter table sm_corrective_actions_arc add column if not exists action_type text;
alter table sm_corrective_actions_arc add column if not exists problem_id uuid;
alter table sm_corrective_actions_arc add column if not exists review_id uuid;
alter table sm_corrective_actions_arc add column if not exists incident_id uuid;
alter table sm_corrective_actions_arc add column if not exists period_review_id uuid;
alter table sm_corrective_actions_arc add column if not exists tracker_url text;
alter table sm_corrective_actions_arc add column if not exists evidence text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_corrective_actions_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_corrective_actions_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_corrective_actions_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_corrective_actions_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_corrective_actions_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_corrective_actions_arc_no_idx on sm_corrective_actions_arc (org_id, no);
create index if not exists sm_corrective_actions_arc_arch_idx on sm_corrective_actions_arc (org_id, archived_at);
create index if not exists sm_corrective_actions_arc_upd_idx on sm_corrective_actions_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_corrective_actions_arc_caller_id_idx on sm_corrective_actions_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_corrective_actions_arc_requested_for_idx on sm_corrective_actions_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_corrective_actions_arc_opened_by_idx on sm_corrective_actions_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_corrective_actions_arc_assigned_to_idx on sm_corrective_actions_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_corrective_actions_arc_assignment_group_id_idx on sm_corrective_actions_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_corrective_actions_arc_unit_id_idx on sm_corrective_actions_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_corrective_actions_arc_search_f3bce210_trgm', 'sm_corrective_actions_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_corrective_actions_arc enable row level security;

-- customer_case: archive
create table if not exists sm_customer_cases_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_customer_cases_arc add column if not exists workspace_id uuid;
alter table sm_customer_cases_arc add column if not exists domain_id uuid;
alter table sm_customer_cases_arc add column if not exists unit_id uuid;
alter table sm_customer_cases_arc add column if not exists created_at timestamptz not null default now();
alter table sm_customer_cases_arc add column if not exists created_by uuid;
alter table sm_customer_cases_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_customer_cases_arc add column if not exists updated_by uuid;
alter table sm_customer_cases_arc add column if not exists rev bigint not null default 0;
alter table sm_customer_cases_arc add column if not exists version integer not null default 1;
alter table sm_customer_cases_arc add column if not exists deleted_at timestamptz;
alter table sm_customer_cases_arc add column if not exists origin text;
alter table sm_customer_cases_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_customer_cases_arc add column if not exists no integer;
alter table sm_customer_cases_arc add column if not exists number text;
alter table sm_customer_cases_arc add column if not exists short_description text;
alter table sm_customer_cases_arc add column if not exists description text;
alter table sm_customer_cases_arc add column if not exists state text;
alter table sm_customer_cases_arc add column if not exists priority text;
alter table sm_customer_cases_arc add column if not exists impact text;
alter table sm_customer_cases_arc add column if not exists urgency text;
alter table sm_customer_cases_arc add column if not exists category text;
alter table sm_customer_cases_arc add column if not exists subcategory text;
alter table sm_customer_cases_arc add column if not exists channel text;
alter table sm_customer_cases_arc add column if not exists caller_id uuid;
alter table sm_customer_cases_arc add column if not exists requested_for uuid;
alter table sm_customer_cases_arc add column if not exists opened_by uuid;
alter table sm_customer_cases_arc add column if not exists opened_at timestamptz;
alter table sm_customer_cases_arc add column if not exists assignment_group_id uuid;
alter table sm_customer_cases_arc add column if not exists assigned_to uuid;
alter table sm_customer_cases_arc add column if not exists service_id uuid;
alter table sm_customer_cases_arc add column if not exists offering_id uuid;
alter table sm_customer_cases_arc add column if not exists ci_id uuid;
alter table sm_customer_cases_arc add column if not exists location_id uuid;
alter table sm_customer_cases_arc add column if not exists due_at timestamptz;
alter table sm_customer_cases_arc add column if not exists resolved_at timestamptz;
alter table sm_customer_cases_arc add column if not exists resolved_by uuid;
alter table sm_customer_cases_arc add column if not exists closed_at timestamptz;
alter table sm_customer_cases_arc add column if not exists closed_by uuid;
alter table sm_customer_cases_arc add column if not exists close_code text;
alter table sm_customer_cases_arc add column if not exists close_notes text;
alter table sm_customer_cases_arc add column if not exists parent_id uuid;
alter table sm_customer_cases_arc add column if not exists watch_list jsonb;
alter table sm_customer_cases_arc add column if not exists approval text;
alter table sm_customer_cases_arc add column if not exists escalation integer;
alter table sm_customer_cases_arc add column if not exists reassignment_count integer;
alter table sm_customer_cases_arc add column if not exists reopen_count integer;
alter table sm_customer_cases_arc add column if not exists time_worked bigint;
alter table sm_customer_cases_arc add column if not exists first_response_at timestamptz;
alter table sm_customer_cases_arc add column if not exists active boolean not null default true;
alter table sm_customer_cases_arc add column if not exists sla_due timestamptz;
alter table sm_customer_cases_arc add column if not exists knowledge boolean not null default false;
alter table sm_customer_cases_arc add column if not exists case_type text;
alter table sm_customer_cases_arc add column if not exists account_id uuid;
alter table sm_customer_cases_arc add column if not exists contact_id uuid;
alter table sm_customer_cases_arc add column if not exists product_id uuid;
alter table sm_customer_cases_arc add column if not exists ibi_id uuid;
alter table sm_customer_cases_arc add column if not exists entitlement_id uuid;
alter table sm_customer_cases_arc add column if not exists contract_id uuid;
alter table sm_customer_cases_arc add column if not exists entitlement_status text;
alter table sm_customer_cases_arc add column if not exists entitlement_snapshot jsonb;
alter table sm_customer_cases_arc add column if not exists support_level text;
alter table sm_customer_cases_arc add column if not exists complaint boolean not null default false;
alter table sm_customer_cases_arc add column if not exists complaint_severity text;
alter table sm_customer_cases_arc add column if not exists is_major boolean not null default false;
alter table sm_customer_cases_arc add column if not exists major_case_id uuid;
alter table sm_customer_cases_arc add column if not exists proactive boolean not null default false;
alter table sm_customer_cases_arc add column if not exists customer_status text;
alter table sm_customer_cases_arc add column if not exists sentiment text;
alter table sm_customer_cases_arc add column if not exists escalated boolean not null default false;
alter table sm_customer_cases_arc add column if not exists root_cause text;
alter table sm_customer_cases_arc add column if not exists resolution_accepted boolean not null default false;
alter table sm_customer_cases_arc add column if not exists satisfaction integer;
alter table sm_customer_cases_arc add column if not exists units_charged numeric;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_customer_cases_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_customer_cases_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_customer_cases_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_customer_cases_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_customer_cases_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_customer_cases_arc_no_idx on sm_customer_cases_arc (org_id, no);
create index if not exists sm_customer_cases_arc_arch_idx on sm_customer_cases_arc (org_id, archived_at);
create index if not exists sm_customer_cases_arc_upd_idx on sm_customer_cases_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_cases_arc_caller_id_idx on sm_customer_cases_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_customer_cases_arc_requested_for_idx on sm_customer_cases_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_customer_cases_arc_opened_by_idx on sm_customer_cases_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_customer_cases_arc_assigned_to_idx on sm_customer_cases_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_customer_cases_arc_assignment_group_id_idx on sm_customer_cases_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_customer_cases_arc_unit_id_idx on sm_customer_cases_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_customer_cases_arc_search_f3bce210_trgm', 'sm_customer_cases_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_customer_cases_arc enable row level security;

-- defect: archive
create table if not exists sm_defects_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_defects_arc add column if not exists workspace_id uuid;
alter table sm_defects_arc add column if not exists domain_id uuid;
alter table sm_defects_arc add column if not exists unit_id uuid;
alter table sm_defects_arc add column if not exists created_at timestamptz not null default now();
alter table sm_defects_arc add column if not exists created_by uuid;
alter table sm_defects_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_defects_arc add column if not exists updated_by uuid;
alter table sm_defects_arc add column if not exists rev bigint not null default 0;
alter table sm_defects_arc add column if not exists version integer not null default 1;
alter table sm_defects_arc add column if not exists deleted_at timestamptz;
alter table sm_defects_arc add column if not exists origin text;
alter table sm_defects_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_defects_arc add column if not exists no integer;
alter table sm_defects_arc add column if not exists number text;
alter table sm_defects_arc add column if not exists short_description text;
alter table sm_defects_arc add column if not exists description text;
alter table sm_defects_arc add column if not exists state text;
alter table sm_defects_arc add column if not exists priority text;
alter table sm_defects_arc add column if not exists impact text;
alter table sm_defects_arc add column if not exists urgency text;
alter table sm_defects_arc add column if not exists category text;
alter table sm_defects_arc add column if not exists subcategory text;
alter table sm_defects_arc add column if not exists channel text;
alter table sm_defects_arc add column if not exists caller_id uuid;
alter table sm_defects_arc add column if not exists requested_for uuid;
alter table sm_defects_arc add column if not exists opened_by uuid;
alter table sm_defects_arc add column if not exists opened_at timestamptz;
alter table sm_defects_arc add column if not exists assignment_group_id uuid;
alter table sm_defects_arc add column if not exists assigned_to uuid;
alter table sm_defects_arc add column if not exists service_id uuid;
alter table sm_defects_arc add column if not exists offering_id uuid;
alter table sm_defects_arc add column if not exists ci_id uuid;
alter table sm_defects_arc add column if not exists location_id uuid;
alter table sm_defects_arc add column if not exists due_at timestamptz;
alter table sm_defects_arc add column if not exists resolved_at timestamptz;
alter table sm_defects_arc add column if not exists resolved_by uuid;
alter table sm_defects_arc add column if not exists closed_at timestamptz;
alter table sm_defects_arc add column if not exists closed_by uuid;
alter table sm_defects_arc add column if not exists close_code text;
alter table sm_defects_arc add column if not exists close_notes text;
alter table sm_defects_arc add column if not exists parent_id uuid;
alter table sm_defects_arc add column if not exists watch_list jsonb;
alter table sm_defects_arc add column if not exists approval text;
alter table sm_defects_arc add column if not exists escalation integer;
alter table sm_defects_arc add column if not exists reassignment_count integer;
alter table sm_defects_arc add column if not exists reopen_count integer;
alter table sm_defects_arc add column if not exists time_worked bigint;
alter table sm_defects_arc add column if not exists first_response_at timestamptz;
alter table sm_defects_arc add column if not exists active boolean not null default true;
alter table sm_defects_arc add column if not exists sla_due timestamptz;
alter table sm_defects_arc add column if not exists knowledge boolean not null default false;
alter table sm_defects_arc add column if not exists release_id uuid;
alter table sm_defects_arc add column if not exists severity text;
alter table sm_defects_arc add column if not exists found_in_env uuid;
alter table sm_defects_arc add column if not exists escaped boolean not null default false;
alter table sm_defects_arc add column if not exists fix_version text;
alter table sm_defects_arc add column if not exists known_error_id uuid;
alter table sm_defects_arc add column if not exists steps text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_defects_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_defects_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_defects_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_defects_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_defects_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_defects_arc_no_idx on sm_defects_arc (org_id, no);
create index if not exists sm_defects_arc_arch_idx on sm_defects_arc (org_id, archived_at);
create index if not exists sm_defects_arc_upd_idx on sm_defects_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_defects_arc_caller_id_idx on sm_defects_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_defects_arc_requested_for_idx on sm_defects_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_defects_arc_opened_by_idx on sm_defects_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_defects_arc_assigned_to_idx on sm_defects_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_defects_arc_assignment_group_id_idx on sm_defects_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_defects_arc_unit_id_idx on sm_defects_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_defects_arc_search_f3bce210_trgm', 'sm_defects_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_defects_arc enable row level security;

-- deployment: archive
create table if not exists sm_deployments_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_deployments_arc add column if not exists workspace_id uuid;
alter table sm_deployments_arc add column if not exists domain_id uuid;
alter table sm_deployments_arc add column if not exists unit_id uuid;
alter table sm_deployments_arc add column if not exists created_at timestamptz not null default now();
alter table sm_deployments_arc add column if not exists created_by uuid;
alter table sm_deployments_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_deployments_arc add column if not exists updated_by uuid;
alter table sm_deployments_arc add column if not exists rev bigint not null default 0;
alter table sm_deployments_arc add column if not exists version integer not null default 1;
alter table sm_deployments_arc add column if not exists deleted_at timestamptz;
alter table sm_deployments_arc add column if not exists origin text;
alter table sm_deployments_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_deployments_arc add column if not exists no integer;
alter table sm_deployments_arc add column if not exists number text;
alter table sm_deployments_arc add column if not exists short_description text;
alter table sm_deployments_arc add column if not exists description text;
alter table sm_deployments_arc add column if not exists state text;
alter table sm_deployments_arc add column if not exists priority text;
alter table sm_deployments_arc add column if not exists impact text;
alter table sm_deployments_arc add column if not exists urgency text;
alter table sm_deployments_arc add column if not exists category text;
alter table sm_deployments_arc add column if not exists subcategory text;
alter table sm_deployments_arc add column if not exists channel text;
alter table sm_deployments_arc add column if not exists caller_id uuid;
alter table sm_deployments_arc add column if not exists requested_for uuid;
alter table sm_deployments_arc add column if not exists opened_by uuid;
alter table sm_deployments_arc add column if not exists opened_at timestamptz;
alter table sm_deployments_arc add column if not exists assignment_group_id uuid;
alter table sm_deployments_arc add column if not exists assigned_to uuid;
alter table sm_deployments_arc add column if not exists service_id uuid;
alter table sm_deployments_arc add column if not exists offering_id uuid;
alter table sm_deployments_arc add column if not exists ci_id uuid;
alter table sm_deployments_arc add column if not exists location_id uuid;
alter table sm_deployments_arc add column if not exists due_at timestamptz;
alter table sm_deployments_arc add column if not exists resolved_at timestamptz;
alter table sm_deployments_arc add column if not exists resolved_by uuid;
alter table sm_deployments_arc add column if not exists closed_at timestamptz;
alter table sm_deployments_arc add column if not exists closed_by uuid;
alter table sm_deployments_arc add column if not exists close_code text;
alter table sm_deployments_arc add column if not exists close_notes text;
alter table sm_deployments_arc add column if not exists parent_id uuid;
alter table sm_deployments_arc add column if not exists watch_list jsonb;
alter table sm_deployments_arc add column if not exists approval text;
alter table sm_deployments_arc add column if not exists escalation integer;
alter table sm_deployments_arc add column if not exists reassignment_count integer;
alter table sm_deployments_arc add column if not exists reopen_count integer;
alter table sm_deployments_arc add column if not exists time_worked bigint;
alter table sm_deployments_arc add column if not exists first_response_at timestamptz;
alter table sm_deployments_arc add column if not exists active boolean not null default true;
alter table sm_deployments_arc add column if not exists sla_due timestamptz;
alter table sm_deployments_arc add column if not exists knowledge boolean not null default false;
alter table sm_deployments_arc add column if not exists release_id uuid;
alter table sm_deployments_arc add column if not exists environment_id uuid;
alter table sm_deployments_arc add column if not exists is_production boolean not null default false;
alter table sm_deployments_arc add column if not exists change_id uuid;
alter table sm_deployments_arc add column if not exists approach text;
alter table sm_deployments_arc add column if not exists kind text;
alter table sm_deployments_arc add column if not exists artifact_version text;
alter table sm_deployments_arc add column if not exists artifact_id uuid;
alter table sm_deployments_arc add column if not exists commit_sha text;
alter table sm_deployments_arc add column if not exists targets jsonb;
alter table sm_deployments_arc add column if not exists rollout_pct numeric;
alter table sm_deployments_arc add column if not exists planned_start timestamptz;
alter table sm_deployments_arc add column if not exists planned_end timestamptz;
alter table sm_deployments_arc add column if not exists actual_start timestamptz;
alter table sm_deployments_arc add column if not exists actual_end timestamptz;
alter table sm_deployments_arc add column if not exists duration bigint;
alter table sm_deployments_arc add column if not exists rollback_plan text;
alter table sm_deployments_arc add column if not exists verification text;
alter table sm_deployments_arc add column if not exists verification_notes text;
alter table sm_deployments_arc add column if not exists result_notes text;
alter table sm_deployments_arc add column if not exists rollback_of uuid;
alter table sm_deployments_arc add column if not exists pipeline_id uuid;
alter table sm_deployments_arc add column if not exists build_id uuid;
alter table sm_deployments_arc add column if not exists connection_id uuid;
alter table sm_deployments_arc add column if not exists external_id text;
alter table sm_deployments_arc add column if not exists external_url text;
alter table sm_deployments_arc add column if not exists initiated_by text;
alter table sm_deployments_arc add column if not exists on_behalf_of uuid;
alter table sm_deployments_arc add column if not exists first_commit_at timestamptz;
alter table sm_deployments_arc add column if not exists lead_time bigint;
alter table sm_deployments_arc add column if not exists restored_at timestamptz;
alter table sm_deployments_arc add column if not exists incidents_caused integer;
alter table sm_deployments_arc add column if not exists change_failure boolean not null default false;
alter table sm_deployments_arc add column if not exists policy_note text;
alter table sm_deployments_arc add column if not exists release_manager_id uuid;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_deployments_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_a6d70860' loop
    execute format('alter table %I drop column if exists %I', 'sm_deployments_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_deployments_arc' and column_name = 'search_a6d70860') then
    execute format('alter table %I add column %I text', 'sm_deployments_arc', 'search_a6d70860');
    execute format('update %I set %I = (%s)', 'sm_deployments_arc', 'search_a6d70860', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(artifact_version, '') || ' ' || coalesce(commit_sha, '') || ' ' || coalesce(external_id, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_deployments_arc_no_idx on sm_deployments_arc (org_id, no);
create index if not exists sm_deployments_arc_arch_idx on sm_deployments_arc (org_id, archived_at);
create index if not exists sm_deployments_arc_upd_idx on sm_deployments_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_deployments_arc_caller_id_idx on sm_deployments_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_deployments_arc_requested_for_idx on sm_deployments_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_deployments_arc_opened_by_idx on sm_deployments_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_deployments_arc_assigned_to_idx on sm_deployments_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_deployments_arc_release_manager_id_idx on sm_deployments_arc (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_deployments_arc_on_behalf_of_idx on sm_deployments_arc (org_id, on_behalf_of) where deleted_at is null;
create index if not exists sm_deployments_arc_assignment_group_id_idx on sm_deployments_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_deployments_arc_unit_id_idx on sm_deployments_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_deployments_arc_search_a6d70860_trgm', 'sm_deployments_arc', 'search_a6d70860', s); end if;
end
$arc$;
alter table sm_deployments_arc enable row level security;

-- facility_request: archive
create table if not exists sm_facility_requests_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_facility_requests_arc add column if not exists workspace_id uuid;
alter table sm_facility_requests_arc add column if not exists domain_id uuid;
alter table sm_facility_requests_arc add column if not exists unit_id uuid;
alter table sm_facility_requests_arc add column if not exists created_at timestamptz not null default now();
alter table sm_facility_requests_arc add column if not exists created_by uuid;
alter table sm_facility_requests_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_facility_requests_arc add column if not exists updated_by uuid;
alter table sm_facility_requests_arc add column if not exists rev bigint not null default 0;
alter table sm_facility_requests_arc add column if not exists version integer not null default 1;
alter table sm_facility_requests_arc add column if not exists deleted_at timestamptz;
alter table sm_facility_requests_arc add column if not exists origin text;
alter table sm_facility_requests_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_facility_requests_arc add column if not exists no integer;
alter table sm_facility_requests_arc add column if not exists number text;
alter table sm_facility_requests_arc add column if not exists short_description text;
alter table sm_facility_requests_arc add column if not exists description text;
alter table sm_facility_requests_arc add column if not exists state text;
alter table sm_facility_requests_arc add column if not exists priority text;
alter table sm_facility_requests_arc add column if not exists impact text;
alter table sm_facility_requests_arc add column if not exists urgency text;
alter table sm_facility_requests_arc add column if not exists category text;
alter table sm_facility_requests_arc add column if not exists subcategory text;
alter table sm_facility_requests_arc add column if not exists channel text;
alter table sm_facility_requests_arc add column if not exists caller_id uuid;
alter table sm_facility_requests_arc add column if not exists requested_for uuid;
alter table sm_facility_requests_arc add column if not exists opened_by uuid;
alter table sm_facility_requests_arc add column if not exists opened_at timestamptz;
alter table sm_facility_requests_arc add column if not exists assignment_group_id uuid;
alter table sm_facility_requests_arc add column if not exists assigned_to uuid;
alter table sm_facility_requests_arc add column if not exists service_id uuid;
alter table sm_facility_requests_arc add column if not exists offering_id uuid;
alter table sm_facility_requests_arc add column if not exists ci_id uuid;
alter table sm_facility_requests_arc add column if not exists location_id uuid;
alter table sm_facility_requests_arc add column if not exists due_at timestamptz;
alter table sm_facility_requests_arc add column if not exists resolved_at timestamptz;
alter table sm_facility_requests_arc add column if not exists resolved_by uuid;
alter table sm_facility_requests_arc add column if not exists closed_at timestamptz;
alter table sm_facility_requests_arc add column if not exists closed_by uuid;
alter table sm_facility_requests_arc add column if not exists close_code text;
alter table sm_facility_requests_arc add column if not exists close_notes text;
alter table sm_facility_requests_arc add column if not exists parent_id uuid;
alter table sm_facility_requests_arc add column if not exists watch_list jsonb;
alter table sm_facility_requests_arc add column if not exists approval text;
alter table sm_facility_requests_arc add column if not exists escalation integer;
alter table sm_facility_requests_arc add column if not exists reassignment_count integer;
alter table sm_facility_requests_arc add column if not exists reopen_count integer;
alter table sm_facility_requests_arc add column if not exists time_worked bigint;
alter table sm_facility_requests_arc add column if not exists first_response_at timestamptz;
alter table sm_facility_requests_arc add column if not exists active boolean not null default true;
alter table sm_facility_requests_arc add column if not exists sla_due timestamptz;
alter table sm_facility_requests_arc add column if not exists knowledge boolean not null default false;
alter table sm_facility_requests_arc add column if not exists title text;
alter table sm_facility_requests_arc add column if not exists department_id uuid;
alter table sm_facility_requests_arc add column if not exists dept_service_id uuid;
alter table sm_facility_requests_arc add column if not exists sensitive boolean not null default false;
alter table sm_facility_requests_arc add column if not exists journey_id uuid;
alter table sm_facility_requests_arc add column if not exists child_total integer;
alter table sm_facility_requests_arc add column if not exists child_open integer;
alter table sm_facility_requests_arc add column if not exists satisfaction integer;
alter table sm_facility_requests_arc add column if not exists request_type text;
alter table sm_facility_requests_arc add column if not exists space_id uuid;
alter table sm_facility_requests_arc add column if not exists preferred_at timestamptz;
alter table sm_facility_requests_arc add column if not exists reservation_id uuid;
alter table sm_facility_requests_arc add column if not exists contractor text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_facility_requests_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_facility_requests_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_facility_requests_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_facility_requests_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_facility_requests_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_facility_requests_arc_no_idx on sm_facility_requests_arc (org_id, no);
create index if not exists sm_facility_requests_arc_arch_idx on sm_facility_requests_arc (org_id, archived_at);
create index if not exists sm_facility_requests_arc_upd_idx on sm_facility_requests_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_facility_requests_arc_caller_id_idx on sm_facility_requests_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_facility_requests_arc_requested_for_idx on sm_facility_requests_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_facility_requests_arc_opened_by_idx on sm_facility_requests_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_facility_requests_arc_assigned_to_idx on sm_facility_requests_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_facility_requests_arc_assignment_group_id_idx on sm_facility_requests_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_facility_requests_arc_unit_id_idx on sm_facility_requests_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_facility_requests_arc_search_f3bce210_trgm', 'sm_facility_requests_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_facility_requests_arc enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:27', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۹ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 29/30 (a0c3bc7de847)
-- finance_case: archive
create table if not exists sm_finance_cases_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_finance_cases_arc add column if not exists workspace_id uuid;
alter table sm_finance_cases_arc add column if not exists domain_id uuid;
alter table sm_finance_cases_arc add column if not exists unit_id uuid;
alter table sm_finance_cases_arc add column if not exists created_at timestamptz not null default now();
alter table sm_finance_cases_arc add column if not exists created_by uuid;
alter table sm_finance_cases_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_finance_cases_arc add column if not exists updated_by uuid;
alter table sm_finance_cases_arc add column if not exists rev bigint not null default 0;
alter table sm_finance_cases_arc add column if not exists version integer not null default 1;
alter table sm_finance_cases_arc add column if not exists deleted_at timestamptz;
alter table sm_finance_cases_arc add column if not exists origin text;
alter table sm_finance_cases_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_finance_cases_arc add column if not exists no integer;
alter table sm_finance_cases_arc add column if not exists number text;
alter table sm_finance_cases_arc add column if not exists short_description text;
alter table sm_finance_cases_arc add column if not exists description text;
alter table sm_finance_cases_arc add column if not exists state text;
alter table sm_finance_cases_arc add column if not exists priority text;
alter table sm_finance_cases_arc add column if not exists impact text;
alter table sm_finance_cases_arc add column if not exists urgency text;
alter table sm_finance_cases_arc add column if not exists category text;
alter table sm_finance_cases_arc add column if not exists subcategory text;
alter table sm_finance_cases_arc add column if not exists channel text;
alter table sm_finance_cases_arc add column if not exists caller_id uuid;
alter table sm_finance_cases_arc add column if not exists requested_for uuid;
alter table sm_finance_cases_arc add column if not exists opened_by uuid;
alter table sm_finance_cases_arc add column if not exists opened_at timestamptz;
alter table sm_finance_cases_arc add column if not exists assignment_group_id uuid;
alter table sm_finance_cases_arc add column if not exists assigned_to uuid;
alter table sm_finance_cases_arc add column if not exists service_id uuid;
alter table sm_finance_cases_arc add column if not exists offering_id uuid;
alter table sm_finance_cases_arc add column if not exists ci_id uuid;
alter table sm_finance_cases_arc add column if not exists location_id uuid;
alter table sm_finance_cases_arc add column if not exists due_at timestamptz;
alter table sm_finance_cases_arc add column if not exists resolved_at timestamptz;
alter table sm_finance_cases_arc add column if not exists resolved_by uuid;
alter table sm_finance_cases_arc add column if not exists closed_at timestamptz;
alter table sm_finance_cases_arc add column if not exists closed_by uuid;
alter table sm_finance_cases_arc add column if not exists close_code text;
alter table sm_finance_cases_arc add column if not exists close_notes text;
alter table sm_finance_cases_arc add column if not exists parent_id uuid;
alter table sm_finance_cases_arc add column if not exists watch_list jsonb;
alter table sm_finance_cases_arc add column if not exists approval text;
alter table sm_finance_cases_arc add column if not exists escalation integer;
alter table sm_finance_cases_arc add column if not exists reassignment_count integer;
alter table sm_finance_cases_arc add column if not exists reopen_count integer;
alter table sm_finance_cases_arc add column if not exists time_worked bigint;
alter table sm_finance_cases_arc add column if not exists first_response_at timestamptz;
alter table sm_finance_cases_arc add column if not exists active boolean not null default true;
alter table sm_finance_cases_arc add column if not exists sla_due timestamptz;
alter table sm_finance_cases_arc add column if not exists knowledge boolean not null default false;
alter table sm_finance_cases_arc add column if not exists title text;
alter table sm_finance_cases_arc add column if not exists department_id uuid;
alter table sm_finance_cases_arc add column if not exists dept_service_id uuid;
alter table sm_finance_cases_arc add column if not exists sensitive boolean not null default false;
alter table sm_finance_cases_arc add column if not exists journey_id uuid;
alter table sm_finance_cases_arc add column if not exists child_total integer;
alter table sm_finance_cases_arc add column if not exists child_open integer;
alter table sm_finance_cases_arc add column if not exists satisfaction integer;
alter table sm_finance_cases_arc add column if not exists case_kind text;
alter table sm_finance_cases_arc add column if not exists amount numeric;
alter table sm_finance_cases_arc add column if not exists currency text;
alter table sm_finance_cases_arc add column if not exists invoice_no text;
alter table sm_finance_cases_arc add column if not exists vendor_name text;
alter table sm_finance_cases_arc add column if not exists cost_center_id uuid;
alter table sm_finance_cases_arc add column if not exists payment_due date;
alter table sm_finance_cases_arc add column if not exists iban text;
alter table sm_finance_cases_arc add column if not exists payment_ref text;
alter table sm_finance_cases_arc add column if not exists paid_on date;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_finance_cases_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_7a2f1724' loop
    execute format('alter table %I drop column if exists %I', 'sm_finance_cases_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_finance_cases_arc' and column_name = 'search_7a2f1724') then
    execute format('alter table %I add column %I text', 'sm_finance_cases_arc', 'search_7a2f1724');
    execute format('update %I set %I = (%s)', 'sm_finance_cases_arc', 'search_7a2f1724', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(invoice_no, '') || ' ' || coalesce(vendor_name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_finance_cases_arc_no_idx on sm_finance_cases_arc (org_id, no);
create index if not exists sm_finance_cases_arc_arch_idx on sm_finance_cases_arc (org_id, archived_at);
create index if not exists sm_finance_cases_arc_upd_idx on sm_finance_cases_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_finance_cases_arc_caller_id_idx on sm_finance_cases_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_finance_cases_arc_requested_for_idx on sm_finance_cases_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_finance_cases_arc_opened_by_idx on sm_finance_cases_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_finance_cases_arc_assigned_to_idx on sm_finance_cases_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_finance_cases_arc_assignment_group_id_idx on sm_finance_cases_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_finance_cases_arc_unit_id_idx on sm_finance_cases_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_finance_cases_arc_search_7a2f1724_trgm', 'sm_finance_cases_arc', 'search_7a2f1724', s); end if;
end
$arc$;
alter table sm_finance_cases_arc enable row level security;

-- hr_case: archive
create table if not exists sm_hr_cases_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_hr_cases_arc add column if not exists workspace_id uuid;
alter table sm_hr_cases_arc add column if not exists domain_id uuid;
alter table sm_hr_cases_arc add column if not exists unit_id uuid;
alter table sm_hr_cases_arc add column if not exists created_at timestamptz not null default now();
alter table sm_hr_cases_arc add column if not exists created_by uuid;
alter table sm_hr_cases_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_hr_cases_arc add column if not exists updated_by uuid;
alter table sm_hr_cases_arc add column if not exists rev bigint not null default 0;
alter table sm_hr_cases_arc add column if not exists version integer not null default 1;
alter table sm_hr_cases_arc add column if not exists deleted_at timestamptz;
alter table sm_hr_cases_arc add column if not exists origin text;
alter table sm_hr_cases_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_hr_cases_arc add column if not exists no integer;
alter table sm_hr_cases_arc add column if not exists number text;
alter table sm_hr_cases_arc add column if not exists short_description text;
alter table sm_hr_cases_arc add column if not exists description text;
alter table sm_hr_cases_arc add column if not exists state text;
alter table sm_hr_cases_arc add column if not exists priority text;
alter table sm_hr_cases_arc add column if not exists impact text;
alter table sm_hr_cases_arc add column if not exists urgency text;
alter table sm_hr_cases_arc add column if not exists category text;
alter table sm_hr_cases_arc add column if not exists subcategory text;
alter table sm_hr_cases_arc add column if not exists channel text;
alter table sm_hr_cases_arc add column if not exists caller_id uuid;
alter table sm_hr_cases_arc add column if not exists requested_for uuid;
alter table sm_hr_cases_arc add column if not exists opened_by uuid;
alter table sm_hr_cases_arc add column if not exists opened_at timestamptz;
alter table sm_hr_cases_arc add column if not exists assignment_group_id uuid;
alter table sm_hr_cases_arc add column if not exists assigned_to uuid;
alter table sm_hr_cases_arc add column if not exists service_id uuid;
alter table sm_hr_cases_arc add column if not exists offering_id uuid;
alter table sm_hr_cases_arc add column if not exists ci_id uuid;
alter table sm_hr_cases_arc add column if not exists location_id uuid;
alter table sm_hr_cases_arc add column if not exists due_at timestamptz;
alter table sm_hr_cases_arc add column if not exists resolved_at timestamptz;
alter table sm_hr_cases_arc add column if not exists resolved_by uuid;
alter table sm_hr_cases_arc add column if not exists closed_at timestamptz;
alter table sm_hr_cases_arc add column if not exists closed_by uuid;
alter table sm_hr_cases_arc add column if not exists close_code text;
alter table sm_hr_cases_arc add column if not exists close_notes text;
alter table sm_hr_cases_arc add column if not exists parent_id uuid;
alter table sm_hr_cases_arc add column if not exists watch_list jsonb;
alter table sm_hr_cases_arc add column if not exists approval text;
alter table sm_hr_cases_arc add column if not exists escalation integer;
alter table sm_hr_cases_arc add column if not exists reassignment_count integer;
alter table sm_hr_cases_arc add column if not exists reopen_count integer;
alter table sm_hr_cases_arc add column if not exists time_worked bigint;
alter table sm_hr_cases_arc add column if not exists first_response_at timestamptz;
alter table sm_hr_cases_arc add column if not exists active boolean not null default true;
alter table sm_hr_cases_arc add column if not exists sla_due timestamptz;
alter table sm_hr_cases_arc add column if not exists knowledge boolean not null default false;
alter table sm_hr_cases_arc add column if not exists title text;
alter table sm_hr_cases_arc add column if not exists department_id uuid;
alter table sm_hr_cases_arc add column if not exists dept_service_id uuid;
alter table sm_hr_cases_arc add column if not exists sensitive boolean not null default false;
alter table sm_hr_cases_arc add column if not exists journey_id uuid;
alter table sm_hr_cases_arc add column if not exists child_total integer;
alter table sm_hr_cases_arc add column if not exists child_open integer;
alter table sm_hr_cases_arc add column if not exists satisfaction integer;
alter table sm_hr_cases_arc add column if not exists subject_person_id uuid;
alter table sm_hr_cases_arc add column if not exists subject_visible boolean not null default true;
alter table sm_hr_cases_arc add column if not exists subject_readers jsonb;
alter table sm_hr_cases_arc add column if not exists coe text;
alter table sm_hr_cases_arc add column if not exists confidentiality text;
alter table sm_hr_cases_arc add column if not exists effective_date date;
alter table sm_hr_cases_arc add column if not exists sensitive_notes text;
alter table sm_hr_cases_arc add column if not exists pay_details text;
alter table sm_hr_cases_arc add column if not exists medical_notes text;
alter table sm_hr_cases_arc add column if not exists disciplinary boolean not null default false;
alter table sm_hr_cases_arc add column if not exists legal_hold boolean not null default false;
alter table sm_hr_cases_arc add column if not exists confidential boolean not null default false;
alter table sm_hr_cases_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hr_cases_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_hr_cases_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hr_cases_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_hr_cases_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_hr_cases_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_hr_cases_arc_no_idx on sm_hr_cases_arc (org_id, no);
create index if not exists sm_hr_cases_arc_arch_idx on sm_hr_cases_arc (org_id, archived_at);
create index if not exists sm_hr_cases_arc_upd_idx on sm_hr_cases_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hr_cases_arc_caller_id_idx on sm_hr_cases_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_hr_cases_arc_requested_for_idx on sm_hr_cases_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_hr_cases_arc_opened_by_idx on sm_hr_cases_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_hr_cases_arc_assigned_to_idx on sm_hr_cases_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_hr_cases_arc_assignment_group_id_idx on sm_hr_cases_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_hr_cases_arc_unit_id_idx on sm_hr_cases_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_hr_cases_arc_search_f3bce210_trgm', 'sm_hr_cases_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_hr_cases_arc enable row level security;

-- hse_event: archive
create table if not exists sm_hse_events_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_hse_events_arc add column if not exists workspace_id uuid;
alter table sm_hse_events_arc add column if not exists domain_id uuid;
alter table sm_hse_events_arc add column if not exists unit_id uuid;
alter table sm_hse_events_arc add column if not exists created_at timestamptz not null default now();
alter table sm_hse_events_arc add column if not exists created_by uuid;
alter table sm_hse_events_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_hse_events_arc add column if not exists updated_by uuid;
alter table sm_hse_events_arc add column if not exists rev bigint not null default 0;
alter table sm_hse_events_arc add column if not exists version integer not null default 1;
alter table sm_hse_events_arc add column if not exists deleted_at timestamptz;
alter table sm_hse_events_arc add column if not exists origin text;
alter table sm_hse_events_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_hse_events_arc add column if not exists no integer;
alter table sm_hse_events_arc add column if not exists number text;
alter table sm_hse_events_arc add column if not exists short_description text;
alter table sm_hse_events_arc add column if not exists description text;
alter table sm_hse_events_arc add column if not exists state text;
alter table sm_hse_events_arc add column if not exists priority text;
alter table sm_hse_events_arc add column if not exists impact text;
alter table sm_hse_events_arc add column if not exists urgency text;
alter table sm_hse_events_arc add column if not exists category text;
alter table sm_hse_events_arc add column if not exists subcategory text;
alter table sm_hse_events_arc add column if not exists channel text;
alter table sm_hse_events_arc add column if not exists caller_id uuid;
alter table sm_hse_events_arc add column if not exists requested_for uuid;
alter table sm_hse_events_arc add column if not exists opened_by uuid;
alter table sm_hse_events_arc add column if not exists opened_at timestamptz;
alter table sm_hse_events_arc add column if not exists assignment_group_id uuid;
alter table sm_hse_events_arc add column if not exists assigned_to uuid;
alter table sm_hse_events_arc add column if not exists service_id uuid;
alter table sm_hse_events_arc add column if not exists offering_id uuid;
alter table sm_hse_events_arc add column if not exists ci_id uuid;
alter table sm_hse_events_arc add column if not exists location_id uuid;
alter table sm_hse_events_arc add column if not exists due_at timestamptz;
alter table sm_hse_events_arc add column if not exists resolved_at timestamptz;
alter table sm_hse_events_arc add column if not exists resolved_by uuid;
alter table sm_hse_events_arc add column if not exists closed_at timestamptz;
alter table sm_hse_events_arc add column if not exists closed_by uuid;
alter table sm_hse_events_arc add column if not exists close_code text;
alter table sm_hse_events_arc add column if not exists close_notes text;
alter table sm_hse_events_arc add column if not exists parent_id uuid;
alter table sm_hse_events_arc add column if not exists watch_list jsonb;
alter table sm_hse_events_arc add column if not exists approval text;
alter table sm_hse_events_arc add column if not exists escalation integer;
alter table sm_hse_events_arc add column if not exists reassignment_count integer;
alter table sm_hse_events_arc add column if not exists reopen_count integer;
alter table sm_hse_events_arc add column if not exists time_worked bigint;
alter table sm_hse_events_arc add column if not exists first_response_at timestamptz;
alter table sm_hse_events_arc add column if not exists active boolean not null default true;
alter table sm_hse_events_arc add column if not exists sla_due timestamptz;
alter table sm_hse_events_arc add column if not exists knowledge boolean not null default false;
alter table sm_hse_events_arc add column if not exists title text;
alter table sm_hse_events_arc add column if not exists department_id uuid;
alter table sm_hse_events_arc add column if not exists dept_service_id uuid;
alter table sm_hse_events_arc add column if not exists sensitive boolean not null default false;
alter table sm_hse_events_arc add column if not exists journey_id uuid;
alter table sm_hse_events_arc add column if not exists child_total integer;
alter table sm_hse_events_arc add column if not exists child_open integer;
alter table sm_hse_events_arc add column if not exists satisfaction integer;
alter table sm_hse_events_arc add column if not exists event_type text;
alter table sm_hse_events_arc add column if not exists occurred_at timestamptz;
alter table sm_hse_events_arc add column if not exists injured_person text;
alter table sm_hse_events_arc add column if not exists injury_details text;
alter table sm_hse_events_arc add column if not exists lost_days integer;
alter table sm_hse_events_arc add column if not exists immediate_action text;
alter table sm_hse_events_arc add column if not exists root_cause text;
alter table sm_hse_events_arc add column if not exists corrective_actions text;
alter table sm_hse_events_arc add column if not exists actions_due date;
alter table sm_hse_events_arc add column if not exists reportable boolean not null default false;
alter table sm_hse_events_arc add column if not exists reported_at timestamptz;
alter table sm_hse_events_arc add column if not exists confidential boolean not null default false;
alter table sm_hse_events_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hse_events_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_hse_events_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_hse_events_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_hse_events_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_hse_events_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_hse_events_arc_no_idx on sm_hse_events_arc (org_id, no);
create index if not exists sm_hse_events_arc_arch_idx on sm_hse_events_arc (org_id, archived_at);
create index if not exists sm_hse_events_arc_upd_idx on sm_hse_events_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_hse_events_arc_caller_id_idx on sm_hse_events_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_hse_events_arc_requested_for_idx on sm_hse_events_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_hse_events_arc_opened_by_idx on sm_hse_events_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_hse_events_arc_assigned_to_idx on sm_hse_events_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_hse_events_arc_assignment_group_id_idx on sm_hse_events_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_hse_events_arc_unit_id_idx on sm_hse_events_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_hse_events_arc_search_f3bce210_trgm', 'sm_hse_events_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_hse_events_arc enable row level security;

-- incident: archive
create table if not exists sm_incidents_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_incidents_arc add column if not exists workspace_id uuid;
alter table sm_incidents_arc add column if not exists domain_id uuid;
alter table sm_incidents_arc add column if not exists unit_id uuid;
alter table sm_incidents_arc add column if not exists created_at timestamptz not null default now();
alter table sm_incidents_arc add column if not exists created_by uuid;
alter table sm_incidents_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_incidents_arc add column if not exists updated_by uuid;
alter table sm_incidents_arc add column if not exists rev bigint not null default 0;
alter table sm_incidents_arc add column if not exists version integer not null default 1;
alter table sm_incidents_arc add column if not exists deleted_at timestamptz;
alter table sm_incidents_arc add column if not exists origin text;
alter table sm_incidents_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_incidents_arc add column if not exists no integer;
alter table sm_incidents_arc add column if not exists number text;
alter table sm_incidents_arc add column if not exists short_description text;
alter table sm_incidents_arc add column if not exists description text;
alter table sm_incidents_arc add column if not exists state text;
alter table sm_incidents_arc add column if not exists priority text;
alter table sm_incidents_arc add column if not exists impact text;
alter table sm_incidents_arc add column if not exists urgency text;
alter table sm_incidents_arc add column if not exists category text;
alter table sm_incidents_arc add column if not exists subcategory text;
alter table sm_incidents_arc add column if not exists channel text;
alter table sm_incidents_arc add column if not exists caller_id uuid;
alter table sm_incidents_arc add column if not exists requested_for uuid;
alter table sm_incidents_arc add column if not exists opened_by uuid;
alter table sm_incidents_arc add column if not exists opened_at timestamptz;
alter table sm_incidents_arc add column if not exists assignment_group_id uuid;
alter table sm_incidents_arc add column if not exists assigned_to uuid;
alter table sm_incidents_arc add column if not exists service_id uuid;
alter table sm_incidents_arc add column if not exists offering_id uuid;
alter table sm_incidents_arc add column if not exists ci_id uuid;
alter table sm_incidents_arc add column if not exists location_id uuid;
alter table sm_incidents_arc add column if not exists due_at timestamptz;
alter table sm_incidents_arc add column if not exists resolved_at timestamptz;
alter table sm_incidents_arc add column if not exists resolved_by uuid;
alter table sm_incidents_arc add column if not exists closed_at timestamptz;
alter table sm_incidents_arc add column if not exists closed_by uuid;
alter table sm_incidents_arc add column if not exists close_code text;
alter table sm_incidents_arc add column if not exists close_notes text;
alter table sm_incidents_arc add column if not exists parent_id uuid;
alter table sm_incidents_arc add column if not exists watch_list jsonb;
alter table sm_incidents_arc add column if not exists approval text;
alter table sm_incidents_arc add column if not exists escalation integer;
alter table sm_incidents_arc add column if not exists reassignment_count integer;
alter table sm_incidents_arc add column if not exists reopen_count integer;
alter table sm_incidents_arc add column if not exists time_worked bigint;
alter table sm_incidents_arc add column if not exists first_response_at timestamptz;
alter table sm_incidents_arc add column if not exists active boolean not null default true;
alter table sm_incidents_arc add column if not exists sla_due timestamptz;
alter table sm_incidents_arc add column if not exists knowledge boolean not null default false;
alter table sm_incidents_arc add column if not exists hold_reason text;
alter table sm_incidents_arc add column if not exists vip boolean not null default false;
alter table sm_incidents_arc add column if not exists security_incident boolean not null default false;
alter table sm_incidents_arc add column if not exists template_id uuid;
alter table sm_incidents_arc add column if not exists external_ref text;
alter table sm_incidents_arc add column if not exists affected_services jsonb;
alter table sm_incidents_arc add column if not exists affected_cis jsonb;
alter table sm_incidents_arc add column if not exists affected_users jsonb;
alter table sm_incidents_arc add column if not exists detected_at timestamptz;
alter table sm_incidents_arc add column if not exists accepted_at timestamptz;
alter table sm_incidents_arc add column if not exists hold_since timestamptz;
alter table sm_incidents_arc add column if not exists follow_ups integer;
alter table sm_incidents_arc add column if not exists last_follow_up_at timestamptz;
alter table sm_incidents_arc add column if not exists time_to_accept bigint;
alter table sm_incidents_arc add column if not exists time_to_resolve bigint;
alter table sm_incidents_arc add column if not exists cause_code text;
alter table sm_incidents_arc add column if not exists workaround text;
alter table sm_incidents_arc add column if not exists problem_id uuid;
alter table sm_incidents_arc add column if not exists known_error_id uuid;
alter table sm_incidents_arc add column if not exists merged_into uuid;
alter table sm_incidents_arc add column if not exists follow_up_of uuid;
alter table sm_incidents_arc add column if not exists major_state text;
alter table sm_incidents_arc add column if not exists mi_manager_id uuid;
alter table sm_incidents_arc add column if not exists mi_comms_id uuid;
alter table sm_incidents_arc add column if not exists mi_declared_at timestamptz;
alter table sm_incidents_arc add column if not exists mi_declared_by uuid;
alter table sm_incidents_arc add column if not exists mi_reason text;
alter table sm_incidents_arc add column if not exists bridge_url text;
alter table sm_incidents_arc add column if not exists chat_url text;
alter table sm_incidents_arc add column if not exists comm_cadence integer;
alter table sm_incidents_arc add column if not exists last_update_at timestamptz;
alter table sm_incidents_arc add column if not exists next_update_at timestamptz;
alter table sm_incidents_arc add column if not exists update_warned_at timestamptz;
alter table sm_incidents_arc add column if not exists stakeholders jsonb;
alter table sm_incidents_arc add column if not exists business_impact text;
alter table sm_incidents_arc add column if not exists timeline jsonb;
alter table sm_incidents_arc add column if not exists satisfaction integer;
alter table sm_incidents_arc add column if not exists satisfaction_comment text;
alter table sm_incidents_arc add column if not exists confidential boolean not null default false;
alter table sm_incidents_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incidents_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_2a22db8c' loop
    execute format('alter table %I drop column if exists %I', 'sm_incidents_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incidents_arc' and column_name = 'search_2a22db8c') then
    execute format('alter table %I add column %I text', 'sm_incidents_arc', 'search_2a22db8c');
    execute format('update %I set %I = (%s)', 'sm_incidents_arc', 'search_2a22db8c', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(external_ref, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_incidents_arc_no_idx on sm_incidents_arc (org_id, no);
create index if not exists sm_incidents_arc_arch_idx on sm_incidents_arc (org_id, archived_at);
create index if not exists sm_incidents_arc_upd_idx on sm_incidents_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incidents_arc_caller_id_idx on sm_incidents_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_incidents_arc_requested_for_idx on sm_incidents_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_incidents_arc_opened_by_idx on sm_incidents_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_incidents_arc_assigned_to_idx on sm_incidents_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_incidents_arc_assignment_group_id_idx on sm_incidents_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_incidents_arc_unit_id_idx on sm_incidents_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_incidents_arc_search_2a22db8c_trgm', 'sm_incidents_arc', 'search_2a22db8c', s); end if;
end
$arc$;
alter table sm_incidents_arc enable row level security;

-- incident_task: archive
create table if not exists sm_incident_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_incident_tasks_arc add column if not exists workspace_id uuid;
alter table sm_incident_tasks_arc add column if not exists domain_id uuid;
alter table sm_incident_tasks_arc add column if not exists unit_id uuid;
alter table sm_incident_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_incident_tasks_arc add column if not exists created_by uuid;
alter table sm_incident_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_incident_tasks_arc add column if not exists updated_by uuid;
alter table sm_incident_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_incident_tasks_arc add column if not exists version integer not null default 1;
alter table sm_incident_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_incident_tasks_arc add column if not exists origin text;
alter table sm_incident_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_incident_tasks_arc add column if not exists no integer;
alter table sm_incident_tasks_arc add column if not exists number text;
alter table sm_incident_tasks_arc add column if not exists short_description text;
alter table sm_incident_tasks_arc add column if not exists description text;
alter table sm_incident_tasks_arc add column if not exists state text;
alter table sm_incident_tasks_arc add column if not exists priority text;
alter table sm_incident_tasks_arc add column if not exists impact text;
alter table sm_incident_tasks_arc add column if not exists urgency text;
alter table sm_incident_tasks_arc add column if not exists category text;
alter table sm_incident_tasks_arc add column if not exists subcategory text;
alter table sm_incident_tasks_arc add column if not exists channel text;
alter table sm_incident_tasks_arc add column if not exists caller_id uuid;
alter table sm_incident_tasks_arc add column if not exists requested_for uuid;
alter table sm_incident_tasks_arc add column if not exists opened_by uuid;
alter table sm_incident_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_incident_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_incident_tasks_arc add column if not exists assigned_to uuid;
alter table sm_incident_tasks_arc add column if not exists service_id uuid;
alter table sm_incident_tasks_arc add column if not exists offering_id uuid;
alter table sm_incident_tasks_arc add column if not exists ci_id uuid;
alter table sm_incident_tasks_arc add column if not exists location_id uuid;
alter table sm_incident_tasks_arc add column if not exists due_at timestamptz;
alter table sm_incident_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_incident_tasks_arc add column if not exists resolved_by uuid;
alter table sm_incident_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_incident_tasks_arc add column if not exists closed_by uuid;
alter table sm_incident_tasks_arc add column if not exists close_code text;
alter table sm_incident_tasks_arc add column if not exists close_notes text;
alter table sm_incident_tasks_arc add column if not exists parent_id uuid;
alter table sm_incident_tasks_arc add column if not exists watch_list jsonb;
alter table sm_incident_tasks_arc add column if not exists approval text;
alter table sm_incident_tasks_arc add column if not exists escalation integer;
alter table sm_incident_tasks_arc add column if not exists reassignment_count integer;
alter table sm_incident_tasks_arc add column if not exists reopen_count integer;
alter table sm_incident_tasks_arc add column if not exists time_worked bigint;
alter table sm_incident_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_incident_tasks_arc add column if not exists active boolean not null default true;
alter table sm_incident_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_incident_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_incident_tasks_arc add column if not exists incident_id uuid;
alter table sm_incident_tasks_arc add column if not exists mandatory boolean not null default true;
alter table sm_incident_tasks_arc add column if not exists sort_order integer;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incident_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_incident_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_incident_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_incident_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_incident_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_incident_tasks_arc_no_idx on sm_incident_tasks_arc (org_id, no);
create index if not exists sm_incident_tasks_arc_arch_idx on sm_incident_tasks_arc (org_id, archived_at);
create index if not exists sm_incident_tasks_arc_upd_idx on sm_incident_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_tasks_arc_caller_id_idx on sm_incident_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_incident_tasks_arc_requested_for_idx on sm_incident_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_incident_tasks_arc_opened_by_idx on sm_incident_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_incident_tasks_arc_assigned_to_idx on sm_incident_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_incident_tasks_arc_assignment_group_id_idx on sm_incident_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_incident_tasks_arc_unit_id_idx on sm_incident_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_incident_tasks_arc_search_f3bce210_trgm', 'sm_incident_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_incident_tasks_arc enable row level security;

-- kb_task: archive
create table if not exists sm_kb_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_kb_tasks_arc add column if not exists workspace_id uuid;
alter table sm_kb_tasks_arc add column if not exists domain_id uuid;
alter table sm_kb_tasks_arc add column if not exists unit_id uuid;
alter table sm_kb_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_kb_tasks_arc add column if not exists created_by uuid;
alter table sm_kb_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_kb_tasks_arc add column if not exists updated_by uuid;
alter table sm_kb_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_kb_tasks_arc add column if not exists version integer not null default 1;
alter table sm_kb_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_kb_tasks_arc add column if not exists origin text;
alter table sm_kb_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_kb_tasks_arc add column if not exists no integer;
alter table sm_kb_tasks_arc add column if not exists number text;
alter table sm_kb_tasks_arc add column if not exists short_description text;
alter table sm_kb_tasks_arc add column if not exists description text;
alter table sm_kb_tasks_arc add column if not exists state text;
alter table sm_kb_tasks_arc add column if not exists priority text;
alter table sm_kb_tasks_arc add column if not exists impact text;
alter table sm_kb_tasks_arc add column if not exists urgency text;
alter table sm_kb_tasks_arc add column if not exists category text;
alter table sm_kb_tasks_arc add column if not exists subcategory text;
alter table sm_kb_tasks_arc add column if not exists channel text;
alter table sm_kb_tasks_arc add column if not exists caller_id uuid;
alter table sm_kb_tasks_arc add column if not exists requested_for uuid;
alter table sm_kb_tasks_arc add column if not exists opened_by uuid;
alter table sm_kb_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_kb_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_kb_tasks_arc add column if not exists assigned_to uuid;
alter table sm_kb_tasks_arc add column if not exists service_id uuid;
alter table sm_kb_tasks_arc add column if not exists offering_id uuid;
alter table sm_kb_tasks_arc add column if not exists ci_id uuid;
alter table sm_kb_tasks_arc add column if not exists location_id uuid;
alter table sm_kb_tasks_arc add column if not exists due_at timestamptz;
alter table sm_kb_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_kb_tasks_arc add column if not exists resolved_by uuid;
alter table sm_kb_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_kb_tasks_arc add column if not exists closed_by uuid;
alter table sm_kb_tasks_arc add column if not exists close_code text;
alter table sm_kb_tasks_arc add column if not exists close_notes text;
alter table sm_kb_tasks_arc add column if not exists parent_id uuid;
alter table sm_kb_tasks_arc add column if not exists watch_list jsonb;
alter table sm_kb_tasks_arc add column if not exists approval text;
alter table sm_kb_tasks_arc add column if not exists escalation integer;
alter table sm_kb_tasks_arc add column if not exists reassignment_count integer;
alter table sm_kb_tasks_arc add column if not exists reopen_count integer;
alter table sm_kb_tasks_arc add column if not exists time_worked bigint;
alter table sm_kb_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_kb_tasks_arc add column if not exists active boolean not null default true;
alter table sm_kb_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_kb_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_kb_tasks_arc add column if not exists kind text;
alter table sm_kb_tasks_arc add column if not exists article_id uuid;
alter table sm_kb_tasks_arc add column if not exists gap_id uuid;
alter table sm_kb_tasks_arc add column if not exists feedback_count integer;
alter table sm_kb_tasks_arc add column if not exists source_table text;
alter table sm_kb_tasks_arc add column if not exists source_id text;
alter table sm_kb_tasks_arc add column if not exists source_number text;
alter table sm_kb_tasks_arc add column if not exists k_users jsonb;
alter table sm_kb_tasks_arc add column if not exists k_groups jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_kb_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_kb_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_kb_tasks_arc_no_idx on sm_kb_tasks_arc (org_id, no);
create index if not exists sm_kb_tasks_arc_arch_idx on sm_kb_tasks_arc (org_id, archived_at);
create index if not exists sm_kb_tasks_arc_upd_idx on sm_kb_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_arc_caller_id_idx on sm_kb_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_kb_tasks_arc_requested_for_idx on sm_kb_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_kb_tasks_arc_opened_by_idx on sm_kb_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_kb_tasks_arc_assigned_to_idx on sm_kb_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_kb_tasks_arc_assignment_group_id_idx on sm_kb_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_kb_tasks_arc_unit_id_idx on sm_kb_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_tasks_arc_search_f3bce210_trgm', 'sm_kb_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_kb_tasks_arc enable row level security;

-- legal_request: archive
create table if not exists sm_legal_requests_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_legal_requests_arc add column if not exists workspace_id uuid;
alter table sm_legal_requests_arc add column if not exists domain_id uuid;
alter table sm_legal_requests_arc add column if not exists unit_id uuid;
alter table sm_legal_requests_arc add column if not exists created_at timestamptz not null default now();
alter table sm_legal_requests_arc add column if not exists created_by uuid;
alter table sm_legal_requests_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_legal_requests_arc add column if not exists updated_by uuid;
alter table sm_legal_requests_arc add column if not exists rev bigint not null default 0;
alter table sm_legal_requests_arc add column if not exists version integer not null default 1;
alter table sm_legal_requests_arc add column if not exists deleted_at timestamptz;
alter table sm_legal_requests_arc add column if not exists origin text;
alter table sm_legal_requests_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_legal_requests_arc add column if not exists no integer;
alter table sm_legal_requests_arc add column if not exists number text;
alter table sm_legal_requests_arc add column if not exists short_description text;
alter table sm_legal_requests_arc add column if not exists description text;
alter table sm_legal_requests_arc add column if not exists state text;
alter table sm_legal_requests_arc add column if not exists priority text;
alter table sm_legal_requests_arc add column if not exists impact text;
alter table sm_legal_requests_arc add column if not exists urgency text;
alter table sm_legal_requests_arc add column if not exists category text;
alter table sm_legal_requests_arc add column if not exists subcategory text;
alter table sm_legal_requests_arc add column if not exists channel text;
alter table sm_legal_requests_arc add column if not exists caller_id uuid;
alter table sm_legal_requests_arc add column if not exists requested_for uuid;
alter table sm_legal_requests_arc add column if not exists opened_by uuid;
alter table sm_legal_requests_arc add column if not exists opened_at timestamptz;
alter table sm_legal_requests_arc add column if not exists assignment_group_id uuid;
alter table sm_legal_requests_arc add column if not exists assigned_to uuid;
alter table sm_legal_requests_arc add column if not exists service_id uuid;
alter table sm_legal_requests_arc add column if not exists offering_id uuid;
alter table sm_legal_requests_arc add column if not exists ci_id uuid;
alter table sm_legal_requests_arc add column if not exists location_id uuid;
alter table sm_legal_requests_arc add column if not exists due_at timestamptz;
alter table sm_legal_requests_arc add column if not exists resolved_at timestamptz;
alter table sm_legal_requests_arc add column if not exists resolved_by uuid;
alter table sm_legal_requests_arc add column if not exists closed_at timestamptz;
alter table sm_legal_requests_arc add column if not exists closed_by uuid;
alter table sm_legal_requests_arc add column if not exists close_code text;
alter table sm_legal_requests_arc add column if not exists close_notes text;
alter table sm_legal_requests_arc add column if not exists parent_id uuid;
alter table sm_legal_requests_arc add column if not exists watch_list jsonb;
alter table sm_legal_requests_arc add column if not exists approval text;
alter table sm_legal_requests_arc add column if not exists escalation integer;
alter table sm_legal_requests_arc add column if not exists reassignment_count integer;
alter table sm_legal_requests_arc add column if not exists reopen_count integer;
alter table sm_legal_requests_arc add column if not exists time_worked bigint;
alter table sm_legal_requests_arc add column if not exists first_response_at timestamptz;
alter table sm_legal_requests_arc add column if not exists active boolean not null default true;
alter table sm_legal_requests_arc add column if not exists sla_due timestamptz;
alter table sm_legal_requests_arc add column if not exists knowledge boolean not null default false;
alter table sm_legal_requests_arc add column if not exists title text;
alter table sm_legal_requests_arc add column if not exists department_id uuid;
alter table sm_legal_requests_arc add column if not exists dept_service_id uuid;
alter table sm_legal_requests_arc add column if not exists sensitive boolean not null default false;
alter table sm_legal_requests_arc add column if not exists journey_id uuid;
alter table sm_legal_requests_arc add column if not exists child_total integer;
alter table sm_legal_requests_arc add column if not exists child_open integer;
alter table sm_legal_requests_arc add column if not exists satisfaction integer;
alter table sm_legal_requests_arc add column if not exists matter_type text;
alter table sm_legal_requests_arc add column if not exists privileged boolean not null default true;
alter table sm_legal_requests_arc add column if not exists counterparty text;
alter table sm_legal_requests_arc add column if not exists contract_value numeric;
alter table sm_legal_requests_arc add column if not exists deadline date;
alter table sm_legal_requests_arc add column if not exists conflict_checked boolean not null default false;
alter table sm_legal_requests_arc add column if not exists conflict_notes text;
alter table sm_legal_requests_arc add column if not exists outcome text;
alter table sm_legal_requests_arc add column if not exists confidential boolean not null default false;
alter table sm_legal_requests_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_legal_requests_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_3b95400c' loop
    execute format('alter table %I drop column if exists %I', 'sm_legal_requests_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_legal_requests_arc' and column_name = 'search_3b95400c') then
    execute format('alter table %I add column %I text', 'sm_legal_requests_arc', 'search_3b95400c');
    execute format('update %I set %I = (%s)', 'sm_legal_requests_arc', 'search_3b95400c', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(counterparty, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_legal_requests_arc_no_idx on sm_legal_requests_arc (org_id, no);
create index if not exists sm_legal_requests_arc_arch_idx on sm_legal_requests_arc (org_id, archived_at);
create index if not exists sm_legal_requests_arc_upd_idx on sm_legal_requests_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_legal_requests_arc_caller_id_idx on sm_legal_requests_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_legal_requests_arc_requested_for_idx on sm_legal_requests_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_legal_requests_arc_opened_by_idx on sm_legal_requests_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_legal_requests_arc_assigned_to_idx on sm_legal_requests_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_legal_requests_arc_assignment_group_id_idx on sm_legal_requests_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_legal_requests_arc_unit_id_idx on sm_legal_requests_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_legal_requests_arc_search_3b95400c_trgm', 'sm_legal_requests_arc', 'search_3b95400c', s); end if;
end
$arc$;
alter table sm_legal_requests_arc enable row level security;

-- portal_feedback: archive
create table if not exists sm_portal_feedback_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_portal_feedback_arc add column if not exists workspace_id uuid;
alter table sm_portal_feedback_arc add column if not exists domain_id uuid;
alter table sm_portal_feedback_arc add column if not exists unit_id uuid;
alter table sm_portal_feedback_arc add column if not exists created_at timestamptz not null default now();
alter table sm_portal_feedback_arc add column if not exists created_by uuid;
alter table sm_portal_feedback_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_portal_feedback_arc add column if not exists updated_by uuid;
alter table sm_portal_feedback_arc add column if not exists rev bigint not null default 0;
alter table sm_portal_feedback_arc add column if not exists version integer not null default 1;
alter table sm_portal_feedback_arc add column if not exists deleted_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists origin text;
alter table sm_portal_feedback_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_portal_feedback_arc add column if not exists no integer;
alter table sm_portal_feedback_arc add column if not exists number text;
alter table sm_portal_feedback_arc add column if not exists short_description text;
alter table sm_portal_feedback_arc add column if not exists description text;
alter table sm_portal_feedback_arc add column if not exists state text;
alter table sm_portal_feedback_arc add column if not exists priority text;
alter table sm_portal_feedback_arc add column if not exists impact text;
alter table sm_portal_feedback_arc add column if not exists urgency text;
alter table sm_portal_feedback_arc add column if not exists category text;
alter table sm_portal_feedback_arc add column if not exists subcategory text;
alter table sm_portal_feedback_arc add column if not exists channel text;
alter table sm_portal_feedback_arc add column if not exists caller_id uuid;
alter table sm_portal_feedback_arc add column if not exists requested_for uuid;
alter table sm_portal_feedback_arc add column if not exists opened_by uuid;
alter table sm_portal_feedback_arc add column if not exists opened_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists assignment_group_id uuid;
alter table sm_portal_feedback_arc add column if not exists assigned_to uuid;
alter table sm_portal_feedback_arc add column if not exists service_id uuid;
alter table sm_portal_feedback_arc add column if not exists offering_id uuid;
alter table sm_portal_feedback_arc add column if not exists ci_id uuid;
alter table sm_portal_feedback_arc add column if not exists location_id uuid;
alter table sm_portal_feedback_arc add column if not exists due_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists resolved_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists resolved_by uuid;
alter table sm_portal_feedback_arc add column if not exists closed_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists closed_by uuid;
alter table sm_portal_feedback_arc add column if not exists close_code text;
alter table sm_portal_feedback_arc add column if not exists close_notes text;
alter table sm_portal_feedback_arc add column if not exists parent_id uuid;
alter table sm_portal_feedback_arc add column if not exists watch_list jsonb;
alter table sm_portal_feedback_arc add column if not exists approval text;
alter table sm_portal_feedback_arc add column if not exists escalation integer;
alter table sm_portal_feedback_arc add column if not exists reassignment_count integer;
alter table sm_portal_feedback_arc add column if not exists reopen_count integer;
alter table sm_portal_feedback_arc add column if not exists time_worked bigint;
alter table sm_portal_feedback_arc add column if not exists first_response_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists active boolean not null default true;
alter table sm_portal_feedback_arc add column if not exists sla_due timestamptz;
alter table sm_portal_feedback_arc add column if not exists knowledge boolean not null default false;
alter table sm_portal_feedback_arc add column if not exists kind text;
alter table sm_portal_feedback_arc add column if not exists privacy_right text;
alter table sm_portal_feedback_arc add column if not exists response text;
alter table sm_portal_feedback_arc add column if not exists acknowledged_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists responded_at timestamptz;
alter table sm_portal_feedback_arc add column if not exists confidential boolean not null default false;
alter table sm_portal_feedback_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_portal_feedback_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_portal_feedback_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_portal_feedback_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_portal_feedback_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_portal_feedback_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_portal_feedback_arc_no_idx on sm_portal_feedback_arc (org_id, no);
create index if not exists sm_portal_feedback_arc_arch_idx on sm_portal_feedback_arc (org_id, archived_at);
create index if not exists sm_portal_feedback_arc_upd_idx on sm_portal_feedback_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_feedback_arc_caller_id_idx on sm_portal_feedback_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_portal_feedback_arc_requested_for_idx on sm_portal_feedback_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_portal_feedback_arc_opened_by_idx on sm_portal_feedback_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_portal_feedback_arc_assigned_to_idx on sm_portal_feedback_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_portal_feedback_arc_assignment_group_id_idx on sm_portal_feedback_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_portal_feedback_arc_unit_id_idx on sm_portal_feedback_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_portal_feedback_arc_search_f3bce210_trgm', 'sm_portal_feedback_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_portal_feedback_arc enable row level security;

-- problem: archive
create table if not exists sm_problems_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_problems_arc add column if not exists workspace_id uuid;
alter table sm_problems_arc add column if not exists domain_id uuid;
alter table sm_problems_arc add column if not exists unit_id uuid;
alter table sm_problems_arc add column if not exists created_at timestamptz not null default now();
alter table sm_problems_arc add column if not exists created_by uuid;
alter table sm_problems_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_problems_arc add column if not exists updated_by uuid;
alter table sm_problems_arc add column if not exists rev bigint not null default 0;
alter table sm_problems_arc add column if not exists version integer not null default 1;
alter table sm_problems_arc add column if not exists deleted_at timestamptz;
alter table sm_problems_arc add column if not exists origin text;
alter table sm_problems_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problems_arc add column if not exists no integer;
alter table sm_problems_arc add column if not exists number text;
alter table sm_problems_arc add column if not exists short_description text;
alter table sm_problems_arc add column if not exists description text;
alter table sm_problems_arc add column if not exists state text;
alter table sm_problems_arc add column if not exists priority text;
alter table sm_problems_arc add column if not exists impact text;
alter table sm_problems_arc add column if not exists urgency text;
alter table sm_problems_arc add column if not exists category text;
alter table sm_problems_arc add column if not exists subcategory text;
alter table sm_problems_arc add column if not exists channel text;
alter table sm_problems_arc add column if not exists caller_id uuid;
alter table sm_problems_arc add column if not exists requested_for uuid;
alter table sm_problems_arc add column if not exists opened_by uuid;
alter table sm_problems_arc add column if not exists opened_at timestamptz;
alter table sm_problems_arc add column if not exists assignment_group_id uuid;
alter table sm_problems_arc add column if not exists assigned_to uuid;
alter table sm_problems_arc add column if not exists service_id uuid;
alter table sm_problems_arc add column if not exists offering_id uuid;
alter table sm_problems_arc add column if not exists ci_id uuid;
alter table sm_problems_arc add column if not exists location_id uuid;
alter table sm_problems_arc add column if not exists due_at timestamptz;
alter table sm_problems_arc add column if not exists resolved_at timestamptz;
alter table sm_problems_arc add column if not exists resolved_by uuid;
alter table sm_problems_arc add column if not exists closed_at timestamptz;
alter table sm_problems_arc add column if not exists closed_by uuid;
alter table sm_problems_arc add column if not exists close_code text;
alter table sm_problems_arc add column if not exists close_notes text;
alter table sm_problems_arc add column if not exists parent_id uuid;
alter table sm_problems_arc add column if not exists watch_list jsonb;
alter table sm_problems_arc add column if not exists approval text;
alter table sm_problems_arc add column if not exists escalation integer;
alter table sm_problems_arc add column if not exists reassignment_count integer;
alter table sm_problems_arc add column if not exists reopen_count integer;
alter table sm_problems_arc add column if not exists time_worked bigint;
alter table sm_problems_arc add column if not exists first_response_at timestamptz;
alter table sm_problems_arc add column if not exists active boolean not null default true;
alter table sm_problems_arc add column if not exists sla_due timestamptz;
alter table sm_problems_arc add column if not exists knowledge boolean not null default false;
alter table sm_problems_arc add column if not exists source text;
alter table sm_problems_arc add column if not exists proactive boolean not null default false;
alter table sm_problems_arc add column if not exists investigation_reason text;
alter table sm_problems_arc add column if not exists likelihood text;
alter table sm_problems_arc add column if not exists risk_score integer;
alter table sm_problems_arc add column if not exists manager_id uuid;
alter table sm_problems_arc add column if not exists pending_reason text;
alter table sm_problems_arc add column if not exists affected_services jsonb;
alter table sm_problems_arc add column if not exists affected_cis jsonb;
alter table sm_problems_arc add column if not exists first_incident_id uuid;
alter table sm_problems_arc add column if not exists template_id uuid;
alter table sm_problems_arc add column if not exists symptoms text;
alter table sm_problems_arc add column if not exists workaround text;
alter table sm_problems_arc add column if not exists cause_code text;
alter table sm_problems_arc add column if not exists rca_method text;
alter table sm_problems_arc add column if not exists rca_sections jsonb;
alter table sm_problems_arc add column if not exists contributing_factors jsonb;
alter table sm_problems_arc add column if not exists cause_notes text;
alter table sm_problems_arc add column if not exists fix_notes text;
alter table sm_problems_arc add column if not exists rca jsonb;
alter table sm_problems_arc add column if not exists duplicate_of uuid;
alter table sm_problems_arc add column if not exists known_error boolean not null default false;
alter table sm_problems_arc add column if not exists target_date date;
alter table sm_problems_arc add column if not exists review_date date;
alter table sm_problems_arc add column if not exists incident_count integer;
alter table sm_problems_arc add column if not exists tech_debt integer;
alter table sm_problems_arc add column if not exists rca_at timestamptz;
alter table sm_problems_arc add column if not exists workaround_at timestamptz;
alter table sm_problems_arc add column if not exists fix_at timestamptz;
alter table sm_problems_arc add column if not exists monitoring_until date;
alter table sm_problems_arc add column if not exists time_to_rca bigint;
alter table sm_problems_arc add column if not exists time_to_fix bigint;
alter table sm_problems_arc add column if not exists last_activity_at timestamptz;
alter table sm_problems_arc add column if not exists shared jsonb;
alter table sm_problems_arc add column if not exists reminded_at timestamptz;
alter table sm_problems_arc add column if not exists monitoring_done boolean not null default false;
alter table sm_problems_arc add column if not exists confidential boolean not null default false;
alter table sm_problems_arc add column if not exists access_list jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problems_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_problems_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problems_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_problems_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_problems_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_problems_arc_no_idx on sm_problems_arc (org_id, no);
create index if not exists sm_problems_arc_arch_idx on sm_problems_arc (org_id, archived_at);
create index if not exists sm_problems_arc_upd_idx on sm_problems_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problems_arc_caller_id_idx on sm_problems_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_problems_arc_requested_for_idx on sm_problems_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_problems_arc_opened_by_idx on sm_problems_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_problems_arc_assigned_to_idx on sm_problems_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problems_arc_manager_id_idx on sm_problems_arc (org_id, manager_id) where deleted_at is null;
create index if not exists sm_problems_arc_assignment_group_id_idx on sm_problems_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_problems_arc_unit_id_idx on sm_problems_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problems_arc_search_f3bce210_trgm', 'sm_problems_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_problems_arc enable row level security;

-- problem_task: archive
create table if not exists sm_problem_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_problem_tasks_arc add column if not exists workspace_id uuid;
alter table sm_problem_tasks_arc add column if not exists domain_id uuid;
alter table sm_problem_tasks_arc add column if not exists unit_id uuid;
alter table sm_problem_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_problem_tasks_arc add column if not exists created_by uuid;
alter table sm_problem_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_problem_tasks_arc add column if not exists updated_by uuid;
alter table sm_problem_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_problem_tasks_arc add column if not exists version integer not null default 1;
alter table sm_problem_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_problem_tasks_arc add column if not exists origin text;
alter table sm_problem_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problem_tasks_arc add column if not exists no integer;
alter table sm_problem_tasks_arc add column if not exists number text;
alter table sm_problem_tasks_arc add column if not exists short_description text;
alter table sm_problem_tasks_arc add column if not exists description text;
alter table sm_problem_tasks_arc add column if not exists state text;
alter table sm_problem_tasks_arc add column if not exists priority text;
alter table sm_problem_tasks_arc add column if not exists impact text;
alter table sm_problem_tasks_arc add column if not exists urgency text;
alter table sm_problem_tasks_arc add column if not exists category text;
alter table sm_problem_tasks_arc add column if not exists subcategory text;
alter table sm_problem_tasks_arc add column if not exists channel text;
alter table sm_problem_tasks_arc add column if not exists caller_id uuid;
alter table sm_problem_tasks_arc add column if not exists requested_for uuid;
alter table sm_problem_tasks_arc add column if not exists opened_by uuid;
alter table sm_problem_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_problem_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_problem_tasks_arc add column if not exists assigned_to uuid;
alter table sm_problem_tasks_arc add column if not exists service_id uuid;
alter table sm_problem_tasks_arc add column if not exists offering_id uuid;
alter table sm_problem_tasks_arc add column if not exists ci_id uuid;
alter table sm_problem_tasks_arc add column if not exists location_id uuid;
alter table sm_problem_tasks_arc add column if not exists due_at timestamptz;
alter table sm_problem_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_problem_tasks_arc add column if not exists resolved_by uuid;
alter table sm_problem_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_problem_tasks_arc add column if not exists closed_by uuid;
alter table sm_problem_tasks_arc add column if not exists close_code text;
alter table sm_problem_tasks_arc add column if not exists close_notes text;
alter table sm_problem_tasks_arc add column if not exists parent_id uuid;
alter table sm_problem_tasks_arc add column if not exists watch_list jsonb;
alter table sm_problem_tasks_arc add column if not exists approval text;
alter table sm_problem_tasks_arc add column if not exists escalation integer;
alter table sm_problem_tasks_arc add column if not exists reassignment_count integer;
alter table sm_problem_tasks_arc add column if not exists reopen_count integer;
alter table sm_problem_tasks_arc add column if not exists time_worked bigint;
alter table sm_problem_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_problem_tasks_arc add column if not exists active boolean not null default true;
alter table sm_problem_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_problem_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_problem_tasks_arc add column if not exists problem_id uuid;
alter table sm_problem_tasks_arc add column if not exists task_type text;
alter table sm_problem_tasks_arc add column if not exists mandatory boolean not null default true;
alter table sm_problem_tasks_arc add column if not exists findings text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problem_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_problem_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problem_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_problem_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_problem_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_problem_tasks_arc_no_idx on sm_problem_tasks_arc (org_id, no);
create index if not exists sm_problem_tasks_arc_arch_idx on sm_problem_tasks_arc (org_id, archived_at);
create index if not exists sm_problem_tasks_arc_upd_idx on sm_problem_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_tasks_arc_caller_id_idx on sm_problem_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_problem_tasks_arc_requested_for_idx on sm_problem_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_problem_tasks_arc_opened_by_idx on sm_problem_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_problem_tasks_arc_assigned_to_idx on sm_problem_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problem_tasks_arc_assignment_group_id_idx on sm_problem_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_problem_tasks_arc_unit_id_idx on sm_problem_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problem_tasks_arc_search_f3bce210_trgm', 'sm_problem_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_problem_tasks_arc enable row level security;

-- purchase_request: archive
create table if not exists sm_purchase_requests_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_purchase_requests_arc add column if not exists workspace_id uuid;
alter table sm_purchase_requests_arc add column if not exists domain_id uuid;
alter table sm_purchase_requests_arc add column if not exists unit_id uuid;
alter table sm_purchase_requests_arc add column if not exists created_at timestamptz not null default now();
alter table sm_purchase_requests_arc add column if not exists created_by uuid;
alter table sm_purchase_requests_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_purchase_requests_arc add column if not exists updated_by uuid;
alter table sm_purchase_requests_arc add column if not exists rev bigint not null default 0;
alter table sm_purchase_requests_arc add column if not exists version integer not null default 1;
alter table sm_purchase_requests_arc add column if not exists deleted_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists origin text;
alter table sm_purchase_requests_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_purchase_requests_arc add column if not exists no integer;
alter table sm_purchase_requests_arc add column if not exists number text;
alter table sm_purchase_requests_arc add column if not exists short_description text;
alter table sm_purchase_requests_arc add column if not exists description text;
alter table sm_purchase_requests_arc add column if not exists state text;
alter table sm_purchase_requests_arc add column if not exists priority text;
alter table sm_purchase_requests_arc add column if not exists impact text;
alter table sm_purchase_requests_arc add column if not exists urgency text;
alter table sm_purchase_requests_arc add column if not exists category text;
alter table sm_purchase_requests_arc add column if not exists subcategory text;
alter table sm_purchase_requests_arc add column if not exists channel text;
alter table sm_purchase_requests_arc add column if not exists caller_id uuid;
alter table sm_purchase_requests_arc add column if not exists requested_for uuid;
alter table sm_purchase_requests_arc add column if not exists opened_by uuid;
alter table sm_purchase_requests_arc add column if not exists opened_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists assignment_group_id uuid;
alter table sm_purchase_requests_arc add column if not exists assigned_to uuid;
alter table sm_purchase_requests_arc add column if not exists service_id uuid;
alter table sm_purchase_requests_arc add column if not exists offering_id uuid;
alter table sm_purchase_requests_arc add column if not exists ci_id uuid;
alter table sm_purchase_requests_arc add column if not exists location_id uuid;
alter table sm_purchase_requests_arc add column if not exists due_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists resolved_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists resolved_by uuid;
alter table sm_purchase_requests_arc add column if not exists closed_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists closed_by uuid;
alter table sm_purchase_requests_arc add column if not exists close_code text;
alter table sm_purchase_requests_arc add column if not exists close_notes text;
alter table sm_purchase_requests_arc add column if not exists parent_id uuid;
alter table sm_purchase_requests_arc add column if not exists watch_list jsonb;
alter table sm_purchase_requests_arc add column if not exists approval text;
alter table sm_purchase_requests_arc add column if not exists escalation integer;
alter table sm_purchase_requests_arc add column if not exists reassignment_count integer;
alter table sm_purchase_requests_arc add column if not exists reopen_count integer;
alter table sm_purchase_requests_arc add column if not exists time_worked bigint;
alter table sm_purchase_requests_arc add column if not exists first_response_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists active boolean not null default true;
alter table sm_purchase_requests_arc add column if not exists sla_due timestamptz;
alter table sm_purchase_requests_arc add column if not exists knowledge boolean not null default false;
alter table sm_purchase_requests_arc add column if not exists title text;
alter table sm_purchase_requests_arc add column if not exists department_id uuid;
alter table sm_purchase_requests_arc add column if not exists dept_service_id uuid;
alter table sm_purchase_requests_arc add column if not exists sensitive boolean not null default false;
alter table sm_purchase_requests_arc add column if not exists journey_id uuid;
alter table sm_purchase_requests_arc add column if not exists child_total integer;
alter table sm_purchase_requests_arc add column if not exists child_open integer;
alter table sm_purchase_requests_arc add column if not exists satisfaction integer;
alter table sm_purchase_requests_arc add column if not exists items text;
alter table sm_purchase_requests_arc add column if not exists amount numeric;
alter table sm_purchase_requests_arc add column if not exists currency text;
alter table sm_purchase_requests_arc add column if not exists supplier text;
alter table sm_purchase_requests_arc add column if not exists cost_center_id uuid;
alter table sm_purchase_requests_arc add column if not exists budget_line text;
alter table sm_purchase_requests_arc add column if not exists needed_by date;
alter table sm_purchase_requests_arc add column if not exists receiver_id uuid;
alter table sm_purchase_requests_arc add column if not exists po_number text;
alter table sm_purchase_requests_arc add column if not exists received_at timestamptz;
alter table sm_purchase_requests_arc add column if not exists receipt_notes text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_purchase_requests_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_0aff9df4' loop
    execute format('alter table %I drop column if exists %I', 'sm_purchase_requests_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_purchase_requests_arc' and column_name = 'search_0aff9df4') then
    execute format('alter table %I add column %I text', 'sm_purchase_requests_arc', 'search_0aff9df4');
    execute format('update %I set %I = (%s)', 'sm_purchase_requests_arc', 'search_0aff9df4', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '') || ' ' || coalesce(po_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_purchase_requests_arc_no_idx on sm_purchase_requests_arc (org_id, no);
create index if not exists sm_purchase_requests_arc_arch_idx on sm_purchase_requests_arc (org_id, archived_at);
create index if not exists sm_purchase_requests_arc_upd_idx on sm_purchase_requests_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requests_arc_caller_id_idx on sm_purchase_requests_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_purchase_requests_arc_requested_for_idx on sm_purchase_requests_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_purchase_requests_arc_opened_by_idx on sm_purchase_requests_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_purchase_requests_arc_assigned_to_idx on sm_purchase_requests_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_purchase_requests_arc_assignment_group_id_idx on sm_purchase_requests_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_purchase_requests_arc_unit_id_idx on sm_purchase_requests_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_requests_arc_search_0aff9df4_trgm', 'sm_purchase_requests_arc', 'search_0aff9df4', s); end if;
end
$arc$;
alter table sm_purchase_requests_arc enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:28', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۳۰ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 30/30 (a0c3bc7de847)
-- release: archive
create table if not exists sm_releases_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_releases_arc add column if not exists workspace_id uuid;
alter table sm_releases_arc add column if not exists domain_id uuid;
alter table sm_releases_arc add column if not exists unit_id uuid;
alter table sm_releases_arc add column if not exists created_at timestamptz not null default now();
alter table sm_releases_arc add column if not exists created_by uuid;
alter table sm_releases_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_releases_arc add column if not exists updated_by uuid;
alter table sm_releases_arc add column if not exists rev bigint not null default 0;
alter table sm_releases_arc add column if not exists version integer not null default 1;
alter table sm_releases_arc add column if not exists deleted_at timestamptz;
alter table sm_releases_arc add column if not exists origin text;
alter table sm_releases_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_releases_arc add column if not exists no integer;
alter table sm_releases_arc add column if not exists number text;
alter table sm_releases_arc add column if not exists short_description text;
alter table sm_releases_arc add column if not exists description text;
alter table sm_releases_arc add column if not exists state text;
alter table sm_releases_arc add column if not exists priority text;
alter table sm_releases_arc add column if not exists impact text;
alter table sm_releases_arc add column if not exists urgency text;
alter table sm_releases_arc add column if not exists category text;
alter table sm_releases_arc add column if not exists subcategory text;
alter table sm_releases_arc add column if not exists channel text;
alter table sm_releases_arc add column if not exists caller_id uuid;
alter table sm_releases_arc add column if not exists requested_for uuid;
alter table sm_releases_arc add column if not exists opened_by uuid;
alter table sm_releases_arc add column if not exists opened_at timestamptz;
alter table sm_releases_arc add column if not exists assignment_group_id uuid;
alter table sm_releases_arc add column if not exists assigned_to uuid;
alter table sm_releases_arc add column if not exists service_id uuid;
alter table sm_releases_arc add column if not exists offering_id uuid;
alter table sm_releases_arc add column if not exists ci_id uuid;
alter table sm_releases_arc add column if not exists location_id uuid;
alter table sm_releases_arc add column if not exists due_at timestamptz;
alter table sm_releases_arc add column if not exists resolved_at timestamptz;
alter table sm_releases_arc add column if not exists resolved_by uuid;
alter table sm_releases_arc add column if not exists closed_at timestamptz;
alter table sm_releases_arc add column if not exists closed_by uuid;
alter table sm_releases_arc add column if not exists close_code text;
alter table sm_releases_arc add column if not exists close_notes text;
alter table sm_releases_arc add column if not exists parent_id uuid;
alter table sm_releases_arc add column if not exists watch_list jsonb;
alter table sm_releases_arc add column if not exists approval text;
alter table sm_releases_arc add column if not exists escalation integer;
alter table sm_releases_arc add column if not exists reassignment_count integer;
alter table sm_releases_arc add column if not exists reopen_count integer;
alter table sm_releases_arc add column if not exists time_worked bigint;
alter table sm_releases_arc add column if not exists first_response_at timestamptz;
alter table sm_releases_arc add column if not exists active boolean not null default true;
alter table sm_releases_arc add column if not exists sla_due timestamptz;
alter table sm_releases_arc add column if not exists knowledge boolean not null default false;
alter table sm_releases_arc add column if not exists version_name text;
alter table sm_releases_arc add column if not exists type text;
alter table sm_releases_arc add column if not exists template_id uuid;
alter table sm_releases_arc add column if not exists release_manager_id uuid;
alter table sm_releases_arc add column if not exists parent_release_id uuid;
alter table sm_releases_arc add column if not exists project_id uuid;
alter table sm_releases_arc add column if not exists stakeholders jsonb;
alter table sm_releases_arc add column if not exists affected_cis jsonb;
alter table sm_releases_arc add column if not exists affected_services jsonb;
alter table sm_releases_arc add column if not exists impacted_services jsonb;
alter table sm_releases_arc add column if not exists known_errors_accepted jsonb;
alter table sm_releases_arc add column if not exists changes_total integer;
alter table sm_releases_arc add column if not exists changes_open integer;
alter table sm_releases_arc add column if not exists problems_fixed integer;
alter table sm_releases_arc add column if not exists planned_start timestamptz;
alter table sm_releases_arc add column if not exists planned_end timestamptz;
alter table sm_releases_arc add column if not exists readiness_target_at timestamptz;
alter table sm_releases_arc add column if not exists window_id uuid;
alter table sm_releases_arc add column if not exists actual_start timestamptz;
alter table sm_releases_arc add column if not exists actual_end timestamptz;
alter table sm_releases_arc add column if not exists deployed_at timestamptz;
alter table sm_releases_arc add column if not exists released_at timestamptz;
alter table sm_releases_arc add column if not exists els_days integer;
alter table sm_releases_arc add column if not exists els_end_at timestamptz;
alter table sm_releases_arc add column if not exists hold_reason text;
alter table sm_releases_arc add column if not exists frozen_until timestamptz;
alter table sm_releases_arc add column if not exists build_plan text;
alter table sm_releases_arc add column if not exists test_plan text;
alter table sm_releases_arc add column if not exists deployment_plan text;
alter table sm_releases_arc add column if not exists rollback_plan text;
alter table sm_releases_arc add column if not exists communication_plan text;
alter table sm_releases_arc add column if not exists release_notes text;
alter table sm_releases_arc add column if not exists go_no_go text;
alter table sm_releases_arc add column if not exists go_no_go_at timestamptz;
alter table sm_releases_arc add column if not exists go_conditions text;
alter table sm_releases_arc add column if not exists checks_total integer;
alter table sm_releases_arc add column if not exists checks_failed integer;
alter table sm_releases_arc add column if not exists checks_pending integer;
alter table sm_releases_arc add column if not exists readiness_pct integer;
alter table sm_releases_arc add column if not exists checks_run_at timestamptz;
alter table sm_releases_arc add column if not exists risk_score integer;
alter table sm_releases_arc add column if not exists risk_band text;
alter table sm_releases_arc add column if not exists risk_factors jsonb;
alter table sm_releases_arc add column if not exists lessons text;
alter table sm_releases_arc add column if not exists els_incidents integer;
alter table sm_releases_arc add column if not exists rolled_back boolean not null default false;
alter table sm_releases_arc add column if not exists on_schedule boolean not null default false;
alter table sm_releases_arc add column if not exists state_before_hold text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_releases_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9202f273' loop
    execute format('alter table %I drop column if exists %I', 'sm_releases_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_releases_arc' and column_name = 'search_9202f273') then
    execute format('alter table %I add column %I text', 'sm_releases_arc', 'search_9202f273');
    execute format('update %I set %I = (%s)', 'sm_releases_arc', 'search_9202f273', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(version_name, '') || ' ' || coalesce(release_notes, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_releases_arc_no_idx on sm_releases_arc (org_id, no);
create index if not exists sm_releases_arc_arch_idx on sm_releases_arc (org_id, archived_at);
create index if not exists sm_releases_arc_upd_idx on sm_releases_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_releases_arc_caller_id_idx on sm_releases_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_releases_arc_requested_for_idx on sm_releases_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_releases_arc_opened_by_idx on sm_releases_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_releases_arc_assigned_to_idx on sm_releases_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_releases_arc_release_manager_id_idx on sm_releases_arc (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_releases_arc_assignment_group_id_idx on sm_releases_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_releases_arc_unit_id_idx on sm_releases_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_releases_arc_search_9202f273_trgm', 'sm_releases_arc', 'search_9202f273', s); end if;
end
$arc$;
alter table sm_releases_arc enable row level security;

-- release_task: archive
create table if not exists sm_release_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_release_tasks_arc add column if not exists workspace_id uuid;
alter table sm_release_tasks_arc add column if not exists domain_id uuid;
alter table sm_release_tasks_arc add column if not exists unit_id uuid;
alter table sm_release_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_release_tasks_arc add column if not exists created_by uuid;
alter table sm_release_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_release_tasks_arc add column if not exists updated_by uuid;
alter table sm_release_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_release_tasks_arc add column if not exists version integer not null default 1;
alter table sm_release_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_release_tasks_arc add column if not exists origin text;
alter table sm_release_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_release_tasks_arc add column if not exists no integer;
alter table sm_release_tasks_arc add column if not exists number text;
alter table sm_release_tasks_arc add column if not exists short_description text;
alter table sm_release_tasks_arc add column if not exists description text;
alter table sm_release_tasks_arc add column if not exists state text;
alter table sm_release_tasks_arc add column if not exists priority text;
alter table sm_release_tasks_arc add column if not exists impact text;
alter table sm_release_tasks_arc add column if not exists urgency text;
alter table sm_release_tasks_arc add column if not exists category text;
alter table sm_release_tasks_arc add column if not exists subcategory text;
alter table sm_release_tasks_arc add column if not exists channel text;
alter table sm_release_tasks_arc add column if not exists caller_id uuid;
alter table sm_release_tasks_arc add column if not exists requested_for uuid;
alter table sm_release_tasks_arc add column if not exists opened_by uuid;
alter table sm_release_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_release_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_release_tasks_arc add column if not exists assigned_to uuid;
alter table sm_release_tasks_arc add column if not exists service_id uuid;
alter table sm_release_tasks_arc add column if not exists offering_id uuid;
alter table sm_release_tasks_arc add column if not exists ci_id uuid;
alter table sm_release_tasks_arc add column if not exists location_id uuid;
alter table sm_release_tasks_arc add column if not exists due_at timestamptz;
alter table sm_release_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_release_tasks_arc add column if not exists resolved_by uuid;
alter table sm_release_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_release_tasks_arc add column if not exists closed_by uuid;
alter table sm_release_tasks_arc add column if not exists close_code text;
alter table sm_release_tasks_arc add column if not exists close_notes text;
alter table sm_release_tasks_arc add column if not exists parent_id uuid;
alter table sm_release_tasks_arc add column if not exists watch_list jsonb;
alter table sm_release_tasks_arc add column if not exists approval text;
alter table sm_release_tasks_arc add column if not exists escalation integer;
alter table sm_release_tasks_arc add column if not exists reassignment_count integer;
alter table sm_release_tasks_arc add column if not exists reopen_count integer;
alter table sm_release_tasks_arc add column if not exists time_worked bigint;
alter table sm_release_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_release_tasks_arc add column if not exists active boolean not null default true;
alter table sm_release_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_release_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_release_tasks_arc add column if not exists release_id uuid;
alter table sm_release_tasks_arc add column if not exists phase text;
alter table sm_release_tasks_arc add column if not exists mandatory boolean not null default true;
alter table sm_release_tasks_arc add column if not exists depends_on jsonb;
alter table sm_release_tasks_arc add column if not exists sort_order integer;
alter table sm_release_tasks_arc add column if not exists planned_hours numeric;
alter table sm_release_tasks_arc add column if not exists release_manager_id uuid;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_release_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_release_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_release_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_release_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_release_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_release_tasks_arc_no_idx on sm_release_tasks_arc (org_id, no);
create index if not exists sm_release_tasks_arc_arch_idx on sm_release_tasks_arc (org_id, archived_at);
create index if not exists sm_release_tasks_arc_upd_idx on sm_release_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_tasks_arc_caller_id_idx on sm_release_tasks_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_release_tasks_arc_requested_for_idx on sm_release_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_release_tasks_arc_opened_by_idx on sm_release_tasks_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_release_tasks_arc_assigned_to_idx on sm_release_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_release_tasks_arc_release_manager_id_idx on sm_release_tasks_arc (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_tasks_arc_assignment_group_id_idx on sm_release_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_release_tasks_arc_unit_id_idx on sm_release_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_release_tasks_arc_search_f3bce210_trgm', 'sm_release_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_release_tasks_arc enable row level security;

-- request: archive
create table if not exists sm_requests_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_requests_arc add column if not exists workspace_id uuid;
alter table sm_requests_arc add column if not exists domain_id uuid;
alter table sm_requests_arc add column if not exists unit_id uuid;
alter table sm_requests_arc add column if not exists created_at timestamptz not null default now();
alter table sm_requests_arc add column if not exists created_by uuid;
alter table sm_requests_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_requests_arc add column if not exists updated_by uuid;
alter table sm_requests_arc add column if not exists rev bigint not null default 0;
alter table sm_requests_arc add column if not exists version integer not null default 1;
alter table sm_requests_arc add column if not exists deleted_at timestamptz;
alter table sm_requests_arc add column if not exists origin text;
alter table sm_requests_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_requests_arc add column if not exists no integer;
alter table sm_requests_arc add column if not exists number text;
alter table sm_requests_arc add column if not exists short_description text;
alter table sm_requests_arc add column if not exists description text;
alter table sm_requests_arc add column if not exists state text;
alter table sm_requests_arc add column if not exists priority text;
alter table sm_requests_arc add column if not exists impact text;
alter table sm_requests_arc add column if not exists urgency text;
alter table sm_requests_arc add column if not exists category text;
alter table sm_requests_arc add column if not exists subcategory text;
alter table sm_requests_arc add column if not exists channel text;
alter table sm_requests_arc add column if not exists caller_id uuid;
alter table sm_requests_arc add column if not exists requested_for uuid;
alter table sm_requests_arc add column if not exists opened_by uuid;
alter table sm_requests_arc add column if not exists opened_at timestamptz;
alter table sm_requests_arc add column if not exists assignment_group_id uuid;
alter table sm_requests_arc add column if not exists assigned_to uuid;
alter table sm_requests_arc add column if not exists service_id uuid;
alter table sm_requests_arc add column if not exists offering_id uuid;
alter table sm_requests_arc add column if not exists ci_id uuid;
alter table sm_requests_arc add column if not exists location_id uuid;
alter table sm_requests_arc add column if not exists due_at timestamptz;
alter table sm_requests_arc add column if not exists resolved_at timestamptz;
alter table sm_requests_arc add column if not exists resolved_by uuid;
alter table sm_requests_arc add column if not exists closed_at timestamptz;
alter table sm_requests_arc add column if not exists closed_by uuid;
alter table sm_requests_arc add column if not exists close_code text;
alter table sm_requests_arc add column if not exists close_notes text;
alter table sm_requests_arc add column if not exists parent_id uuid;
alter table sm_requests_arc add column if not exists watch_list jsonb;
alter table sm_requests_arc add column if not exists approval text;
alter table sm_requests_arc add column if not exists escalation integer;
alter table sm_requests_arc add column if not exists reassignment_count integer;
alter table sm_requests_arc add column if not exists reopen_count integer;
alter table sm_requests_arc add column if not exists time_worked bigint;
alter table sm_requests_arc add column if not exists first_response_at timestamptz;
alter table sm_requests_arc add column if not exists active boolean not null default true;
alter table sm_requests_arc add column if not exists sla_due timestamptz;
alter table sm_requests_arc add column if not exists knowledge boolean not null default false;
alter table sm_requests_arc add column if not exists needed_by date;
alter table sm_requests_arc add column if not exists cost_center_id uuid;
alter table sm_requests_arc add column if not exists items_count integer;
alter table sm_requests_arc add column if not exists total_price numeric;
alter table sm_requests_arc add column if not exists recurring_total numeric;
alter table sm_requests_arc add column if not exists stage text;
alter table sm_requests_arc add column if not exists fulfillers jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_requests_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_requests_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_requests_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_requests_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_requests_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_requests_arc_no_idx on sm_requests_arc (org_id, no);
create index if not exists sm_requests_arc_arch_idx on sm_requests_arc (org_id, archived_at);
create index if not exists sm_requests_arc_upd_idx on sm_requests_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_requests_arc_caller_id_idx on sm_requests_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_requests_arc_requested_for_idx on sm_requests_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_requests_arc_opened_by_idx on sm_requests_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_requests_arc_assigned_to_idx on sm_requests_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_requests_arc_assignment_group_id_idx on sm_requests_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_requests_arc_unit_id_idx on sm_requests_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_requests_arc_search_f3bce210_trgm', 'sm_requests_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_requests_arc enable row level security;

-- request_item: archive
create table if not exists sm_request_items_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_request_items_arc add column if not exists workspace_id uuid;
alter table sm_request_items_arc add column if not exists domain_id uuid;
alter table sm_request_items_arc add column if not exists unit_id uuid;
alter table sm_request_items_arc add column if not exists created_at timestamptz not null default now();
alter table sm_request_items_arc add column if not exists created_by uuid;
alter table sm_request_items_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_request_items_arc add column if not exists updated_by uuid;
alter table sm_request_items_arc add column if not exists rev bigint not null default 0;
alter table sm_request_items_arc add column if not exists version integer not null default 1;
alter table sm_request_items_arc add column if not exists deleted_at timestamptz;
alter table sm_request_items_arc add column if not exists origin text;
alter table sm_request_items_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_request_items_arc add column if not exists no integer;
alter table sm_request_items_arc add column if not exists number text;
alter table sm_request_items_arc add column if not exists short_description text;
alter table sm_request_items_arc add column if not exists description text;
alter table sm_request_items_arc add column if not exists state text;
alter table sm_request_items_arc add column if not exists priority text;
alter table sm_request_items_arc add column if not exists impact text;
alter table sm_request_items_arc add column if not exists urgency text;
alter table sm_request_items_arc add column if not exists category text;
alter table sm_request_items_arc add column if not exists subcategory text;
alter table sm_request_items_arc add column if not exists channel text;
alter table sm_request_items_arc add column if not exists caller_id uuid;
alter table sm_request_items_arc add column if not exists requested_for uuid;
alter table sm_request_items_arc add column if not exists opened_by uuid;
alter table sm_request_items_arc add column if not exists opened_at timestamptz;
alter table sm_request_items_arc add column if not exists assignment_group_id uuid;
alter table sm_request_items_arc add column if not exists assigned_to uuid;
alter table sm_request_items_arc add column if not exists service_id uuid;
alter table sm_request_items_arc add column if not exists offering_id uuid;
alter table sm_request_items_arc add column if not exists ci_id uuid;
alter table sm_request_items_arc add column if not exists location_id uuid;
alter table sm_request_items_arc add column if not exists due_at timestamptz;
alter table sm_request_items_arc add column if not exists resolved_at timestamptz;
alter table sm_request_items_arc add column if not exists resolved_by uuid;
alter table sm_request_items_arc add column if not exists closed_at timestamptz;
alter table sm_request_items_arc add column if not exists closed_by uuid;
alter table sm_request_items_arc add column if not exists close_code text;
alter table sm_request_items_arc add column if not exists close_notes text;
alter table sm_request_items_arc add column if not exists parent_id uuid;
alter table sm_request_items_arc add column if not exists watch_list jsonb;
alter table sm_request_items_arc add column if not exists approval text;
alter table sm_request_items_arc add column if not exists escalation integer;
alter table sm_request_items_arc add column if not exists reassignment_count integer;
alter table sm_request_items_arc add column if not exists reopen_count integer;
alter table sm_request_items_arc add column if not exists time_worked bigint;
alter table sm_request_items_arc add column if not exists first_response_at timestamptz;
alter table sm_request_items_arc add column if not exists active boolean not null default true;
alter table sm_request_items_arc add column if not exists sla_due timestamptz;
alter table sm_request_items_arc add column if not exists knowledge boolean not null default false;
alter table sm_request_items_arc add column if not exists request_id uuid;
alter table sm_request_items_arc add column if not exists cat_item_id uuid;
alter table sm_request_items_arc add column if not exists item_version_id uuid;
alter table sm_request_items_arc add column if not exists category_id uuid;
alter table sm_request_items_arc add column if not exists quantity integer;
alter table sm_request_items_arc add column if not exists stage text;
alter table sm_request_items_arc add column if not exists answers jsonb;
alter table sm_request_items_arc add column if not exists private_answers jsonb;
alter table sm_request_items_arc add column if not exists secret_answers text;
alter table sm_request_items_arc add column if not exists price numeric;
alter table sm_request_items_arc add column if not exists total numeric;
alter table sm_request_items_arc add column if not exists recurring_price numeric;
alter table sm_request_items_arc add column if not exists recurring_frequency text;
alter table sm_request_items_arc add column if not exists cost numeric;
alter table sm_request_items_arc add column if not exists ad_hoc boolean not null default false;
alter table sm_request_items_arc add column if not exists fulfilment text;
alter table sm_request_items_arc add column if not exists approval_rule_id uuid;
alter table sm_request_items_arc add column if not exists produced_table text;
alter table sm_request_items_arc add column if not exists produced_id text;
alter table sm_request_items_arc add column if not exists requires_confirmation boolean not null default false;
alter table sm_request_items_arc add column if not exists access_until date;
alter table sm_request_items_arc add column if not exists revoked_at timestamptz;
alter table sm_request_items_arc add column if not exists subscription_id uuid;
alter table sm_request_items_arc add column if not exists entitlement jsonb;
alter table sm_request_items_arc add column if not exists flow_runs jsonb;
alter table sm_request_items_arc add column if not exists fulfillers jsonb;
alter table sm_request_items_arc add column if not exists rating integer;
alter table sm_request_items_arc add column if not exists feedback text;
alter table sm_request_items_arc add column if not exists sle_p85 bigint;
alter table sm_request_items_arc add column if not exists approval_requested_at timestamptz;
alter table sm_request_items_arc add column if not exists approved_at timestamptz;
alter table sm_request_items_arc add column if not exists fulfilment_started_at timestamptz;
alter table sm_request_items_arc add column if not exists info_requested boolean not null default false;
alter table sm_request_items_arc add column if not exists info_since timestamptz;
alter table sm_request_items_arc add column if not exists info_wait bigint;
alter table sm_request_items_arc add column if not exists reminded_at timestamptz;
alter table sm_request_items_arc add column if not exists zero_touch boolean not null default false;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_items_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_request_items_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_items_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_request_items_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_request_items_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_request_items_arc_no_idx on sm_request_items_arc (org_id, no);
create index if not exists sm_request_items_arc_arch_idx on sm_request_items_arc (org_id, archived_at);
create index if not exists sm_request_items_arc_upd_idx on sm_request_items_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_items_arc_caller_id_idx on sm_request_items_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_request_items_arc_requested_for_idx on sm_request_items_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_items_arc_opened_by_idx on sm_request_items_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_request_items_arc_assigned_to_idx on sm_request_items_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_request_items_arc_assignment_group_id_idx on sm_request_items_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_request_items_arc_unit_id_idx on sm_request_items_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_items_arc_search_f3bce210_trgm', 'sm_request_items_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_request_items_arc enable row level security;

-- request_task: archive
create table if not exists sm_request_tasks_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_request_tasks_arc add column if not exists workspace_id uuid;
alter table sm_request_tasks_arc add column if not exists domain_id uuid;
alter table sm_request_tasks_arc add column if not exists unit_id uuid;
alter table sm_request_tasks_arc add column if not exists created_at timestamptz not null default now();
alter table sm_request_tasks_arc add column if not exists created_by uuid;
alter table sm_request_tasks_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_request_tasks_arc add column if not exists updated_by uuid;
alter table sm_request_tasks_arc add column if not exists rev bigint not null default 0;
alter table sm_request_tasks_arc add column if not exists version integer not null default 1;
alter table sm_request_tasks_arc add column if not exists deleted_at timestamptz;
alter table sm_request_tasks_arc add column if not exists origin text;
alter table sm_request_tasks_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_request_tasks_arc add column if not exists no integer;
alter table sm_request_tasks_arc add column if not exists number text;
alter table sm_request_tasks_arc add column if not exists short_description text;
alter table sm_request_tasks_arc add column if not exists description text;
alter table sm_request_tasks_arc add column if not exists state text;
alter table sm_request_tasks_arc add column if not exists priority text;
alter table sm_request_tasks_arc add column if not exists impact text;
alter table sm_request_tasks_arc add column if not exists urgency text;
alter table sm_request_tasks_arc add column if not exists category text;
alter table sm_request_tasks_arc add column if not exists subcategory text;
alter table sm_request_tasks_arc add column if not exists channel text;
alter table sm_request_tasks_arc add column if not exists caller_id uuid;
alter table sm_request_tasks_arc add column if not exists requested_for uuid;
alter table sm_request_tasks_arc add column if not exists opened_by uuid;
alter table sm_request_tasks_arc add column if not exists opened_at timestamptz;
alter table sm_request_tasks_arc add column if not exists assignment_group_id uuid;
alter table sm_request_tasks_arc add column if not exists assigned_to uuid;
alter table sm_request_tasks_arc add column if not exists service_id uuid;
alter table sm_request_tasks_arc add column if not exists offering_id uuid;
alter table sm_request_tasks_arc add column if not exists ci_id uuid;
alter table sm_request_tasks_arc add column if not exists location_id uuid;
alter table sm_request_tasks_arc add column if not exists due_at timestamptz;
alter table sm_request_tasks_arc add column if not exists resolved_at timestamptz;
alter table sm_request_tasks_arc add column if not exists resolved_by uuid;
alter table sm_request_tasks_arc add column if not exists closed_at timestamptz;
alter table sm_request_tasks_arc add column if not exists closed_by uuid;
alter table sm_request_tasks_arc add column if not exists close_code text;
alter table sm_request_tasks_arc add column if not exists close_notes text;
alter table sm_request_tasks_arc add column if not exists parent_id uuid;
alter table sm_request_tasks_arc add column if not exists watch_list jsonb;
alter table sm_request_tasks_arc add column if not exists approval text;
alter table sm_request_tasks_arc add column if not exists escalation integer;
alter table sm_request_tasks_arc add column if not exists reassignment_count integer;
alter table sm_request_tasks_arc add column if not exists reopen_count integer;
alter table sm_request_tasks_arc add column if not exists time_worked bigint;
alter table sm_request_tasks_arc add column if not exists first_response_at timestamptz;
alter table sm_request_tasks_arc add column if not exists active boolean not null default true;
alter table sm_request_tasks_arc add column if not exists sla_due timestamptz;
alter table sm_request_tasks_arc add column if not exists knowledge boolean not null default false;
alter table sm_request_tasks_arc add column if not exists request_item_id uuid;
alter table sm_request_tasks_arc add column if not exists request_id uuid;
alter table sm_request_tasks_arc add column if not exists template_id uuid;
alter table sm_request_tasks_arc add column if not exists sort_order integer;
alter table sm_request_tasks_arc add column if not exists depends_on uuid;
alter table sm_request_tasks_arc add column if not exists requester_visible boolean not null default false;
alter table sm_request_tasks_arc add column if not exists instructions text;
alter table sm_request_tasks_arc add column if not exists checklist jsonb;
alter table sm_request_tasks_arc add column if not exists class_of_service text;
alter table sm_request_tasks_arc add column if not exists blocked boolean not null default false;
alter table sm_request_tasks_arc add column if not exists blocked_reason text;
alter table sm_request_tasks_arc add column if not exists blocked_since timestamptz;
alter table sm_request_tasks_arc add column if not exists blocked_time bigint;
alter table sm_request_tasks_arc add column if not exists deviation boolean not null default false;
alter table sm_request_tasks_arc add column if not exists deviation_note text;
alter table sm_request_tasks_arc add column if not exists revocation boolean not null default false;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_tasks_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_request_tasks_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_tasks_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_request_tasks_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_request_tasks_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_request_tasks_arc_no_idx on sm_request_tasks_arc (org_id, no);
create index if not exists sm_request_tasks_arc_arch_idx on sm_request_tasks_arc (org_id, archived_at);
create index if not exists sm_request_tasks_arc_upd_idx on sm_request_tasks_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_tasks_arc_assigned_to_idx on sm_request_tasks_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_request_tasks_arc_requested_for_idx on sm_request_tasks_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_tasks_arc_assignment_group_id_idx on sm_request_tasks_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_request_tasks_arc_unit_id_idx on sm_request_tasks_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_tasks_arc_search_f3bce210_trgm', 'sm_request_tasks_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_request_tasks_arc enable row level security;

-- service_case: archive
create table if not exists sm_service_cases_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_service_cases_arc add column if not exists workspace_id uuid;
alter table sm_service_cases_arc add column if not exists domain_id uuid;
alter table sm_service_cases_arc add column if not exists unit_id uuid;
alter table sm_service_cases_arc add column if not exists created_at timestamptz not null default now();
alter table sm_service_cases_arc add column if not exists created_by uuid;
alter table sm_service_cases_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_service_cases_arc add column if not exists updated_by uuid;
alter table sm_service_cases_arc add column if not exists rev bigint not null default 0;
alter table sm_service_cases_arc add column if not exists version integer not null default 1;
alter table sm_service_cases_arc add column if not exists deleted_at timestamptz;
alter table sm_service_cases_arc add column if not exists origin text;
alter table sm_service_cases_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_service_cases_arc add column if not exists no integer;
alter table sm_service_cases_arc add column if not exists number text;
alter table sm_service_cases_arc add column if not exists short_description text;
alter table sm_service_cases_arc add column if not exists description text;
alter table sm_service_cases_arc add column if not exists state text;
alter table sm_service_cases_arc add column if not exists priority text;
alter table sm_service_cases_arc add column if not exists impact text;
alter table sm_service_cases_arc add column if not exists urgency text;
alter table sm_service_cases_arc add column if not exists category text;
alter table sm_service_cases_arc add column if not exists subcategory text;
alter table sm_service_cases_arc add column if not exists channel text;
alter table sm_service_cases_arc add column if not exists caller_id uuid;
alter table sm_service_cases_arc add column if not exists requested_for uuid;
alter table sm_service_cases_arc add column if not exists opened_by uuid;
alter table sm_service_cases_arc add column if not exists opened_at timestamptz;
alter table sm_service_cases_arc add column if not exists assignment_group_id uuid;
alter table sm_service_cases_arc add column if not exists assigned_to uuid;
alter table sm_service_cases_arc add column if not exists service_id uuid;
alter table sm_service_cases_arc add column if not exists offering_id uuid;
alter table sm_service_cases_arc add column if not exists ci_id uuid;
alter table sm_service_cases_arc add column if not exists location_id uuid;
alter table sm_service_cases_arc add column if not exists due_at timestamptz;
alter table sm_service_cases_arc add column if not exists resolved_at timestamptz;
alter table sm_service_cases_arc add column if not exists resolved_by uuid;
alter table sm_service_cases_arc add column if not exists closed_at timestamptz;
alter table sm_service_cases_arc add column if not exists closed_by uuid;
alter table sm_service_cases_arc add column if not exists close_code text;
alter table sm_service_cases_arc add column if not exists close_notes text;
alter table sm_service_cases_arc add column if not exists parent_id uuid;
alter table sm_service_cases_arc add column if not exists watch_list jsonb;
alter table sm_service_cases_arc add column if not exists approval text;
alter table sm_service_cases_arc add column if not exists escalation integer;
alter table sm_service_cases_arc add column if not exists reassignment_count integer;
alter table sm_service_cases_arc add column if not exists reopen_count integer;
alter table sm_service_cases_arc add column if not exists time_worked bigint;
alter table sm_service_cases_arc add column if not exists first_response_at timestamptz;
alter table sm_service_cases_arc add column if not exists active boolean not null default true;
alter table sm_service_cases_arc add column if not exists sla_due timestamptz;
alter table sm_service_cases_arc add column if not exists knowledge boolean not null default false;
alter table sm_service_cases_arc add column if not exists title text;
alter table sm_service_cases_arc add column if not exists department_id uuid;
alter table sm_service_cases_arc add column if not exists dept_service_id uuid;
alter table sm_service_cases_arc add column if not exists sensitive boolean not null default false;
alter table sm_service_cases_arc add column if not exists journey_id uuid;
alter table sm_service_cases_arc add column if not exists child_total integer;
alter table sm_service_cases_arc add column if not exists child_open integer;
alter table sm_service_cases_arc add column if not exists satisfaction integer;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_cases_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_service_cases_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_cases_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_service_cases_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_service_cases_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_service_cases_arc_no_idx on sm_service_cases_arc (org_id, no);
create index if not exists sm_service_cases_arc_arch_idx on sm_service_cases_arc (org_id, archived_at);
create index if not exists sm_service_cases_arc_upd_idx on sm_service_cases_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_cases_arc_caller_id_idx on sm_service_cases_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_service_cases_arc_requested_for_idx on sm_service_cases_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_service_cases_arc_opened_by_idx on sm_service_cases_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_service_cases_arc_assigned_to_idx on sm_service_cases_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_service_cases_arc_assignment_group_id_idx on sm_service_cases_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_service_cases_arc_unit_id_idx on sm_service_cases_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_cases_arc_search_f3bce210_trgm', 'sm_service_cases_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_service_cases_arc enable row level security;

-- slm_improvement: archive
create table if not exists sm_slm_improvements_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_slm_improvements_arc add column if not exists workspace_id uuid;
alter table sm_slm_improvements_arc add column if not exists domain_id uuid;
alter table sm_slm_improvements_arc add column if not exists unit_id uuid;
alter table sm_slm_improvements_arc add column if not exists created_at timestamptz not null default now();
alter table sm_slm_improvements_arc add column if not exists created_by uuid;
alter table sm_slm_improvements_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_slm_improvements_arc add column if not exists updated_by uuid;
alter table sm_slm_improvements_arc add column if not exists rev bigint not null default 0;
alter table sm_slm_improvements_arc add column if not exists version integer not null default 1;
alter table sm_slm_improvements_arc add column if not exists deleted_at timestamptz;
alter table sm_slm_improvements_arc add column if not exists origin text;
alter table sm_slm_improvements_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_slm_improvements_arc add column if not exists no integer;
alter table sm_slm_improvements_arc add column if not exists number text;
alter table sm_slm_improvements_arc add column if not exists short_description text;
alter table sm_slm_improvements_arc add column if not exists description text;
alter table sm_slm_improvements_arc add column if not exists state text;
alter table sm_slm_improvements_arc add column if not exists priority text;
alter table sm_slm_improvements_arc add column if not exists impact text;
alter table sm_slm_improvements_arc add column if not exists urgency text;
alter table sm_slm_improvements_arc add column if not exists category text;
alter table sm_slm_improvements_arc add column if not exists subcategory text;
alter table sm_slm_improvements_arc add column if not exists channel text;
alter table sm_slm_improvements_arc add column if not exists caller_id uuid;
alter table sm_slm_improvements_arc add column if not exists requested_for uuid;
alter table sm_slm_improvements_arc add column if not exists opened_by uuid;
alter table sm_slm_improvements_arc add column if not exists opened_at timestamptz;
alter table sm_slm_improvements_arc add column if not exists assignment_group_id uuid;
alter table sm_slm_improvements_arc add column if not exists assigned_to uuid;
alter table sm_slm_improvements_arc add column if not exists service_id uuid;
alter table sm_slm_improvements_arc add column if not exists offering_id uuid;
alter table sm_slm_improvements_arc add column if not exists ci_id uuid;
alter table sm_slm_improvements_arc add column if not exists location_id uuid;
alter table sm_slm_improvements_arc add column if not exists due_at timestamptz;
alter table sm_slm_improvements_arc add column if not exists resolved_at timestamptz;
alter table sm_slm_improvements_arc add column if not exists resolved_by uuid;
alter table sm_slm_improvements_arc add column if not exists closed_at timestamptz;
alter table sm_slm_improvements_arc add column if not exists closed_by uuid;
alter table sm_slm_improvements_arc add column if not exists close_code text;
alter table sm_slm_improvements_arc add column if not exists close_notes text;
alter table sm_slm_improvements_arc add column if not exists parent_id uuid;
alter table sm_slm_improvements_arc add column if not exists watch_list jsonb;
alter table sm_slm_improvements_arc add column if not exists approval text;
alter table sm_slm_improvements_arc add column if not exists escalation integer;
alter table sm_slm_improvements_arc add column if not exists reassignment_count integer;
alter table sm_slm_improvements_arc add column if not exists reopen_count integer;
alter table sm_slm_improvements_arc add column if not exists time_worked bigint;
alter table sm_slm_improvements_arc add column if not exists first_response_at timestamptz;
alter table sm_slm_improvements_arc add column if not exists active boolean not null default true;
alter table sm_slm_improvements_arc add column if not exists sla_due timestamptz;
alter table sm_slm_improvements_arc add column if not exists knowledge boolean not null default false;
alter table sm_slm_improvements_arc add column if not exists source text;
alter table sm_slm_improvements_arc add column if not exists agreement_id uuid;
alter table sm_slm_improvements_arc add column if not exists review_id uuid;
alter table sm_slm_improvements_arc add column if not exists plan_id uuid;
alter table sm_slm_improvements_arc add column if not exists value integer;
alter table sm_slm_improvements_arc add column if not exists effort integer;
alter table sm_slm_improvements_arc add column if not exists score numeric;
alter table sm_slm_improvements_arc add column if not exists benefit text;
alter table sm_slm_improvements_arc add column if not exists kpi_name text;
alter table sm_slm_improvements_arc add column if not exists kpi_baseline numeric;
alter table sm_slm_improvements_arc add column if not exists kpi_target numeric;
alter table sm_slm_improvements_arc add column if not exists kpi_actual numeric;
alter table sm_slm_improvements_arc add column if not exists outcome text;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_slm_improvements_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_slm_improvements_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_slm_improvements_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_slm_improvements_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_slm_improvements_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_slm_improvements_arc_no_idx on sm_slm_improvements_arc (org_id, no);
create index if not exists sm_slm_improvements_arc_arch_idx on sm_slm_improvements_arc (org_id, archived_at);
create index if not exists sm_slm_improvements_arc_upd_idx on sm_slm_improvements_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_slm_improvements_arc_caller_id_idx on sm_slm_improvements_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_slm_improvements_arc_requested_for_idx on sm_slm_improvements_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_slm_improvements_arc_opened_by_idx on sm_slm_improvements_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_slm_improvements_arc_assigned_to_idx on sm_slm_improvements_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_slm_improvements_arc_assignment_group_id_idx on sm_slm_improvements_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_slm_improvements_arc_unit_id_idx on sm_slm_improvements_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_slm_improvements_arc_search_f3bce210_trgm', 'sm_slm_improvements_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_slm_improvements_arc enable row level security;

-- todo: archive
create table if not exists sm_todos_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_todos_arc add column if not exists workspace_id uuid;
alter table sm_todos_arc add column if not exists domain_id uuid;
alter table sm_todos_arc add column if not exists unit_id uuid;
alter table sm_todos_arc add column if not exists created_at timestamptz not null default now();
alter table sm_todos_arc add column if not exists created_by uuid;
alter table sm_todos_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_todos_arc add column if not exists updated_by uuid;
alter table sm_todos_arc add column if not exists rev bigint not null default 0;
alter table sm_todos_arc add column if not exists version integer not null default 1;
alter table sm_todos_arc add column if not exists deleted_at timestamptz;
alter table sm_todos_arc add column if not exists origin text;
alter table sm_todos_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_todos_arc add column if not exists no integer;
alter table sm_todos_arc add column if not exists number text;
alter table sm_todos_arc add column if not exists short_description text;
alter table sm_todos_arc add column if not exists description text;
alter table sm_todos_arc add column if not exists state text;
alter table sm_todos_arc add column if not exists priority text;
alter table sm_todos_arc add column if not exists impact text;
alter table sm_todos_arc add column if not exists urgency text;
alter table sm_todos_arc add column if not exists category text;
alter table sm_todos_arc add column if not exists subcategory text;
alter table sm_todos_arc add column if not exists channel text;
alter table sm_todos_arc add column if not exists caller_id uuid;
alter table sm_todos_arc add column if not exists requested_for uuid;
alter table sm_todos_arc add column if not exists opened_by uuid;
alter table sm_todos_arc add column if not exists opened_at timestamptz;
alter table sm_todos_arc add column if not exists assignment_group_id uuid;
alter table sm_todos_arc add column if not exists assigned_to uuid;
alter table sm_todos_arc add column if not exists service_id uuid;
alter table sm_todos_arc add column if not exists offering_id uuid;
alter table sm_todos_arc add column if not exists ci_id uuid;
alter table sm_todos_arc add column if not exists location_id uuid;
alter table sm_todos_arc add column if not exists due_at timestamptz;
alter table sm_todos_arc add column if not exists resolved_at timestamptz;
alter table sm_todos_arc add column if not exists resolved_by uuid;
alter table sm_todos_arc add column if not exists closed_at timestamptz;
alter table sm_todos_arc add column if not exists closed_by uuid;
alter table sm_todos_arc add column if not exists close_code text;
alter table sm_todos_arc add column if not exists close_notes text;
alter table sm_todos_arc add column if not exists parent_id uuid;
alter table sm_todos_arc add column if not exists watch_list jsonb;
alter table sm_todos_arc add column if not exists approval text;
alter table sm_todos_arc add column if not exists escalation integer;
alter table sm_todos_arc add column if not exists reassignment_count integer;
alter table sm_todos_arc add column if not exists reopen_count integer;
alter table sm_todos_arc add column if not exists time_worked bigint;
alter table sm_todos_arc add column if not exists first_response_at timestamptz;
alter table sm_todos_arc add column if not exists active boolean not null default true;
alter table sm_todos_arc add column if not exists sla_due timestamptz;
alter table sm_todos_arc add column if not exists knowledge boolean not null default false;
alter table sm_todos_arc add column if not exists tags jsonb;
alter table sm_todos_arc add column if not exists estimate numeric;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_todos_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_todos_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_todos_arc' and column_name = 'search_f3bce210') then
    execute format('alter table %I add column %I text', 'sm_todos_arc', 'search_f3bce210');
    execute format('update %I set %I = (%s)', 'sm_todos_arc', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_todos_arc_no_idx on sm_todos_arc (org_id, no);
create index if not exists sm_todos_arc_arch_idx on sm_todos_arc (org_id, archived_at);
create index if not exists sm_todos_arc_upd_idx on sm_todos_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_todos_arc_caller_id_idx on sm_todos_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_todos_arc_requested_for_idx on sm_todos_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_todos_arc_opened_by_idx on sm_todos_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_todos_arc_assigned_to_idx on sm_todos_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_todos_arc_assignment_group_id_idx on sm_todos_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_todos_arc_unit_id_idx on sm_todos_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_todos_arc_search_f3bce210_trgm', 'sm_todos_arc', 'search_f3bce210', s); end if;
end
$arc$;
alter table sm_todos_arc enable row level security;

-- work_order: archive
create table if not exists sm_work_orders_arc (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  archived_at timestamptz not null default now()
);
alter table sm_work_orders_arc add column if not exists workspace_id uuid;
alter table sm_work_orders_arc add column if not exists domain_id uuid;
alter table sm_work_orders_arc add column if not exists unit_id uuid;
alter table sm_work_orders_arc add column if not exists created_at timestamptz not null default now();
alter table sm_work_orders_arc add column if not exists created_by uuid;
alter table sm_work_orders_arc add column if not exists updated_at timestamptz not null default now();
alter table sm_work_orders_arc add column if not exists updated_by uuid;
alter table sm_work_orders_arc add column if not exists rev bigint not null default 0;
alter table sm_work_orders_arc add column if not exists version integer not null default 1;
alter table sm_work_orders_arc add column if not exists deleted_at timestamptz;
alter table sm_work_orders_arc add column if not exists origin text;
alter table sm_work_orders_arc add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_work_orders_arc add column if not exists no integer;
alter table sm_work_orders_arc add column if not exists number text;
alter table sm_work_orders_arc add column if not exists short_description text;
alter table sm_work_orders_arc add column if not exists description text;
alter table sm_work_orders_arc add column if not exists state text;
alter table sm_work_orders_arc add column if not exists priority text;
alter table sm_work_orders_arc add column if not exists impact text;
alter table sm_work_orders_arc add column if not exists urgency text;
alter table sm_work_orders_arc add column if not exists category text;
alter table sm_work_orders_arc add column if not exists subcategory text;
alter table sm_work_orders_arc add column if not exists channel text;
alter table sm_work_orders_arc add column if not exists caller_id uuid;
alter table sm_work_orders_arc add column if not exists requested_for uuid;
alter table sm_work_orders_arc add column if not exists opened_by uuid;
alter table sm_work_orders_arc add column if not exists opened_at timestamptz;
alter table sm_work_orders_arc add column if not exists assignment_group_id uuid;
alter table sm_work_orders_arc add column if not exists assigned_to uuid;
alter table sm_work_orders_arc add column if not exists service_id uuid;
alter table sm_work_orders_arc add column if not exists offering_id uuid;
alter table sm_work_orders_arc add column if not exists ci_id uuid;
alter table sm_work_orders_arc add column if not exists location_id uuid;
alter table sm_work_orders_arc add column if not exists due_at timestamptz;
alter table sm_work_orders_arc add column if not exists resolved_at timestamptz;
alter table sm_work_orders_arc add column if not exists resolved_by uuid;
alter table sm_work_orders_arc add column if not exists closed_at timestamptz;
alter table sm_work_orders_arc add column if not exists closed_by uuid;
alter table sm_work_orders_arc add column if not exists close_code text;
alter table sm_work_orders_arc add column if not exists close_notes text;
alter table sm_work_orders_arc add column if not exists parent_id uuid;
alter table sm_work_orders_arc add column if not exists watch_list jsonb;
alter table sm_work_orders_arc add column if not exists approval text;
alter table sm_work_orders_arc add column if not exists escalation integer;
alter table sm_work_orders_arc add column if not exists reassignment_count integer;
alter table sm_work_orders_arc add column if not exists reopen_count integer;
alter table sm_work_orders_arc add column if not exists time_worked bigint;
alter table sm_work_orders_arc add column if not exists first_response_at timestamptz;
alter table sm_work_orders_arc add column if not exists active boolean not null default true;
alter table sm_work_orders_arc add column if not exists sla_due timestamptz;
alter table sm_work_orders_arc add column if not exists knowledge boolean not null default false;
alter table sm_work_orders_arc add column if not exists work_type text;
alter table sm_work_orders_arc add column if not exists symptoms text;
alter table sm_work_orders_arc add column if not exists required_skills jsonb;
alter table sm_work_orders_arc add column if not exists template_id uuid;
alter table sm_work_orders_arc add column if not exists parent_table text;
alter table sm_work_orders_arc add column if not exists parent_record text;
alter table sm_work_orders_arc add column if not exists parent_number text;
alter table sm_work_orders_arc add column if not exists maintenance_plan_id uuid;
alter table sm_work_orders_arc add column if not exists territory_id uuid;
alter table sm_work_orders_arc add column if not exists account_id uuid;
alter table sm_work_orders_arc add column if not exists contact_id uuid;
alter table sm_work_orders_arc add column if not exists site_phone text;
alter table sm_work_orders_arc add column if not exists site_address text;
alter table sm_work_orders_arc add column if not exists site_lat numeric;
alter table sm_work_orders_arc add column if not exists site_lng numeric;
alter table sm_work_orders_arc add column if not exists access_notes text;
alter table sm_work_orders_arc add column if not exists asset_ref text;
alter table sm_work_orders_arc add column if not exists billing_type text;
alter table sm_work_orders_arc add column if not exists coverage text;
alter table sm_work_orders_arc add column if not exists entitlement_id uuid;
alter table sm_work_orders_arc add column if not exists tasks_total integer;
alter table sm_work_orders_arc add column if not exists tasks_open integer;
alter table sm_work_orders_arc add column if not exists visits integer;
alter table sm_work_orders_arc add column if not exists first_time_fix boolean not null default false;
alter table sm_work_orders_arc add column if not exists scheduled_start timestamptz;
alter table sm_work_orders_arc add column if not exists work_minutes integer;
alter table sm_work_orders_arc add column if not exists travel_minutes integer;
alter table sm_work_orders_arc add column if not exists technicians jsonb;
do $arcs$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_work_orders_arc' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_8fe328e6' loop
    execute format('alter table %I drop column if exists %I', 'sm_work_orders_arc', old.column_name);
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'sm_work_orders_arc' and column_name = 'search_8fe328e6') then
    execute format('alter table %I add column %I text', 'sm_work_orders_arc', 'search_8fe328e6');
    execute format('update %I set %I = (%s)', 'sm_work_orders_arc', 'search_8fe328e6', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(parent_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  end if;
end
$arcs$;
create index if not exists sm_work_orders_arc_no_idx on sm_work_orders_arc (org_id, no);
create index if not exists sm_work_orders_arc_arch_idx on sm_work_orders_arc (org_id, archived_at);
create index if not exists sm_work_orders_arc_upd_idx on sm_work_orders_arc (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_work_orders_arc_caller_id_idx on sm_work_orders_arc (org_id, caller_id) where deleted_at is null;
create index if not exists sm_work_orders_arc_requested_for_idx on sm_work_orders_arc (org_id, requested_for) where deleted_at is null;
create index if not exists sm_work_orders_arc_opened_by_idx on sm_work_orders_arc (org_id, opened_by) where deleted_at is null;
create index if not exists sm_work_orders_arc_assigned_to_idx on sm_work_orders_arc (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_work_orders_arc_assignment_group_id_idx on sm_work_orders_arc (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_work_orders_arc_unit_id_idx on sm_work_orders_arc (org_id, unit_id) where deleted_at is null;
do $arc$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_work_orders_arc_search_8fe328e6_trgm', 'sm_work_orders_arc', 'search_8fe328e6', s); end if;
end
$arc$;
alter table sm_work_orders_arc enable row level security;

do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'sm\_%' loop
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:29', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0007_access — دسترسی: نسخهٔ پیکربندی دسترسی و شمارندهٔ دامنهٔ دید اعضا
-- ---------------------------------------------------------------------------
create table if not exists sm_access_state (
  org_id uuid primary key references sm_orgs(id) on delete cascade,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table sm_access_state enable row level security;

create or replace function sm_access_bump(p_org uuid) returns void language plpgsql as $fn$
begin
  insert into sm_access_state (org_id, version) values (p_org, 1)
  on conflict (org_id) do update set version = sm_access_state.version + 1, updated_at = now();
end
$fn$;

create or replace function sm_access_bump_user(p_org uuid, p_user uuid) returns void language plpgsql as $fn$
begin
  if p_user is null then return; end if;
  insert into sm_scope_epochs (org_id, user_id, epoch) values (p_org, p_user, 1)
  on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
end
$fn$;

create or replace function sm_access_bump_everyone(p_org uuid) returns void language plpgsql as $fn$
begin
  insert into sm_scope_epochs (org_id, user_id, epoch)
  select m.org_id, m.user_id, 1 from sm_org_members m where m.org_id = p_org and m.deleted_at is null
  on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
end
$fn$;

-- one trigger function per table (OLD is null on insert, NEW on delete)
create or replace function sm_access_group_members() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id or new.kind is distinct from old.kind
     or new.valid_from is distinct from old.valid_from or new.valid_to is distinct from old.valid_to or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(org);
    perform sm_access_bump_user(org, new.user_id);
    if old.user_id is distinct from new.user_id then perform sm_access_bump_user(org, old.user_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_member_profiles() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.roles is distinct from old.roles or new.org_unit_id is distinct from old.org_unit_id
     or new.domain_unit_id is distinct from old.domain_unit_id or new.workspaces is distinct from old.workspaces
     or new.manager_id is distinct from old.manager_id or new.delegate_id is distinct from old.delegate_id
     or new.out_of_office is distinct from old.out_of_office or new.ooo_until is distinct from old.ooo_until
     or new.persona is distinct from old.persona or new.user_id is distinct from old.user_id or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(org);
    perform sm_access_bump_user(org, new.user_id);
    perform sm_access_bump_user(org, new.manager_id);
    perform sm_access_bump_user(org, new.delegate_id);
    if old.user_id is distinct from new.user_id then perform sm_access_bump_user(org, old.user_id); end if;
    if old.manager_id is distinct from new.manager_id then perform sm_access_bump_user(org, old.manager_id); end if;
    if old.delegate_id is distinct from new.delegate_id then perform sm_access_bump_user(org, old.delegate_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_groups() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.roles is distinct from old.roles or new.parent_id is distinct from old.parent_id or new.restricted is distinct from old.restricted
     or new.workspace_id is distinct from old.workspace_id or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

create or replace function sm_access_org_units() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.parent_id is distinct from old.parent_id or new.path is distinct from old.path or new.manager_id is distinct from old.manager_id
     or new.is_domain is distinct from old.is_domain or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

create or replace function sm_access_workspaces() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.secure is distinct from old.secure or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

create or replace function sm_access_roles() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.key is distinct from old.key or new.grants is distinct from old.grants or new.field_groups is distinct from old.field_groups
     or new.contains is distinct from old.contains or new.workspaces is distinct from old.workspaces or new.domains is distinct from old.domains
     or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_group_members_access on sm_group_members;
create trigger sm_group_members_access after insert or update or delete on sm_group_members for each row execute function sm_access_group_members();
drop trigger if exists sm_member_profiles_access on sm_member_profiles;
create trigger sm_member_profiles_access after insert or update or delete on sm_member_profiles for each row execute function sm_access_member_profiles();
drop trigger if exists sm_groups_access on sm_groups;
create trigger sm_groups_access after insert or update or delete on sm_groups for each row execute function sm_access_groups();
drop trigger if exists sm_org_units_access on sm_org_units;
create trigger sm_org_units_access after insert or update or delete on sm_org_units for each row execute function sm_access_org_units();
drop trigger if exists sm_workspaces_access on sm_workspaces;
create trigger sm_workspaces_access after insert or update or delete on sm_workspaces for each row execute function sm_access_workspaces();
drop trigger if exists sm_roles_access on sm_roles;
create trigger sm_roles_access after insert or update or delete on sm_roles for each row execute function sm_access_roles();

insert into sm_migrations (id) values ('0007_access') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0010_notify — اعلان‌ها: گزارش ارسال، ایمیل‌های ارسالی و دریافتی و وضعیت صندوق‌ها
-- ---------------------------------------------------------------------------
create table if not exists sm_notification_log (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rule_key text,
  rule_name text,
  event text not null,
  table_key text,
  record_id uuid,
  record_number text,
  channel text not null,
  recipient_id uuid,
  target text,
  status text not null,
  reason text,
  error text,
  provider_id text,
  subject text,
  body_hash text,
  due_at timestamptz,
  payload jsonb
);
create index if not exists sm_notification_log_org_idx on sm_notification_log (org_id, created_at desc, id desc);
create index if not exists sm_notification_log_held_idx on sm_notification_log (org_id, recipient_id, channel, due_at) where status = 'held';
alter table sm_notification_log enable row level security;

create table if not exists sm_email_messages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  channel_id uuid,
  direction text not null,
  message_id text not null,
  in_reply_to text,
  refs jsonb not null default '[]'::jsonb,
  from_addr text,
  to_addrs text,
  subject text,
  table_key text,
  record_id uuid,
  status text not null,
  reason text,
  uid bigint,
  size integer,
  created_at timestamptz not null default now(),
  data jsonb
);
create unique index if not exists sm_email_messages_msgid_idx on sm_email_messages (org_id, message_id, direction);
create index if not exists sm_email_messages_org_idx on sm_email_messages (org_id, created_at desc, id desc);
create index if not exists sm_email_messages_from_idx on sm_email_messages (org_id, from_addr, created_at desc) where direction = 'in';
alter table sm_email_messages enable row level security;

create table if not exists sm_notify_state (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table sm_notify_state enable row level security;

insert into sm_migrations (id) values ('0010_notify') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0011_flows — گردش‌کارها: اجراها، گزارش گام‌ها، انتظارها و زمان‌بندی
-- ---------------------------------------------------------------------------
create table if not exists sm_flow_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  flow_id uuid not null,
  flow_name text not null default '',
  version_id uuid,
  version_no integer,
  graph jsonb,
  state text not null default 'running',
  test boolean not null default false,
  trigger_kind text not null,
  trigger_table text,
  trigger_record_id uuid,
  actor_id uuid,
  run_as uuid,
  run_as_kind text not null default 'user',
  depth integer not null default 0,
  parent_run_id uuid,
  parent_wait_id uuid,
  context jsonb not null default '{}'::jsonb,
  runtime jsonb not null default '{}'::jsonb,
  current_nodes text[] not null default '{}',
  steps_count integer not null default 0,
  error text,
  lease_by text,
  lease_until timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists sm_flow_runs_org_idx on sm_flow_runs (org_id, started_at desc, id desc);
create index if not exists sm_flow_runs_flow_idx on sm_flow_runs (org_id, flow_id, started_at desc);
create index if not exists sm_flow_runs_open_idx on sm_flow_runs (org_id, state) where state in ('running', 'waiting');
create index if not exists sm_flow_runs_parent_idx on sm_flow_runs (parent_run_id) where parent_run_id is not null;
create index if not exists sm_flow_runs_ended_idx on sm_flow_runs (ended_at) where ended_at is not null;
alter table sm_flow_runs enable row level security;

create table if not exists sm_flow_run_steps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  run_id uuid not null references sm_flow_runs(id) on delete cascade,
  key text not null,
  node_id text not null,
  node_type text not null,
  label text not null default '',
  status text not null,
  port text,
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer
);
create unique index if not exists sm_flow_run_steps_key_idx on sm_flow_run_steps (run_id, key);
alter table sm_flow_run_steps enable row level security;

create table if not exists sm_flow_waits (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  run_id uuid not null references sm_flow_runs(id) on delete cascade,
  token_id text not null,
  node_id text not null,
  step_key text not null,
  kind text not null,
  key text,
  due_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sm_flow_waits_key_idx on sm_flow_waits (org_id, key) where key is not null;
create index if not exists sm_flow_waits_run_idx on sm_flow_waits (run_id);
alter table sm_flow_waits enable row level security;

create table if not exists sm_flow_loop_items (
  run_id uuid not null references sm_flow_runs(id) on delete cascade,
  frame_id text not null,
  items jsonb not null,
  primary key (run_id, frame_id)
);
alter table sm_flow_loop_items enable row level security;

create table if not exists sm_flow_timers (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null,
  ref_id uuid not null,
  spec_key text not null,
  next_at timestamptz,
  last_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (org_id, kind, ref_id)
);
alter table sm_flow_timers enable row level security;

insert into sm_migrations (id) values ('0011_flows') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0020_ai_rag — هوش مصنوعی: نمایه و بازیابی (قطعه‌ها، بردارها، متن اسناد هوشمند)
-- ---------------------------------------------------------------------------
alter table sm_ai_connections add column if not exists embed jsonb;

create table if not exists sm_ai_rag_docs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  -- the record's engine version when it was indexed, and the hash of everything indexed from it
  version int,
  hash text,
  title text,
  chunks int not null default 0,
  -- ok | empty | error
  status text not null default 'ok',
  error text,
  -- the provider embedding the chunks carry; vec_pending: some chunks still wait for it
  vec_key text,
  vec_pending boolean not null default false,
  workspace_id uuid,
  unit_id uuid,
  domain_id uuid,
  indexed_at timestamptz not null default now()
);
create unique index if not exists sm_ai_rag_docs_rec_key on sm_ai_rag_docs (org_id, table_key, record_id);
create index if not exists sm_ai_rag_docs_pending_idx on sm_ai_rag_docs (org_id) where vec_pending;

create table if not exists sm_ai_chunks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  -- chunk: retrievable passage; parent: the section a chunk belongs to (small-to-big)
  kind text not null default 'chunk',
  parent_id uuid,
  ord int not null default 0,
  field text,
  fields text[] not null default '{}',
  -- field groups whose values the chunk contains: a caller lacking one never gets the chunk
  groups text[] not null default '{}',
  heading text,
  page int,
  page_end int,
  lang text,
  text text not null,
  -- the Persian-normalised search form (title, heading and text)
  norm text not null default '',
  tsv tsvector generated always as (to_tsvector('simple', norm)) stored,
  -- content hash of what was embedded (unchanged text keeps its vectors)
  hash text not null,
  tokens int not null default 0,
  version int,
  workspace_id uuid,
  unit_id uuid,
  domain_id uuid,
  -- local embedding (always) and the provider's (key = preset:model:dims); vector columns are added with pgvector
  lvec real[],
  vec_key text,
  vec real[],
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_chunks_rec_idx on sm_ai_chunks (org_id, table_key, record_id);
create index if not exists sm_ai_chunks_tsv_idx on sm_ai_chunks using gin (tsv);
create index if not exists sm_ai_chunks_vec_idx on sm_ai_chunks (org_id, vec_key) where kind = 'chunk';

-- text read from a smart document (page by page), on the runtime that read it
create table if not exists sm_ai_doc_pages (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  doc_id uuid not null,
  page int not null,
  text text not null,
  ocr boolean not null default false,
  primary key (doc_id, page)
);
create index if not exists sm_ai_doc_pages_org_idx on sm_ai_doc_pages (org_id, doc_id);

-- index runs (backfills, re-embedding, reconciliation) for the admin page
create table if not exists sm_ai_rag_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists sm_ai_rag_runs_org_idx on sm_ai_rag_runs (org_id, started_at desc);

-- Supabase: reachable only through the app's own server connection
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename in ('sm_ai_rag_docs', 'sm_ai_chunks', 'sm_ai_doc_pages', 'sm_ai_rag_runs') loop
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

insert into sm_migrations (id) values ('0020_ai_rag') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0045_knowledge — مدیریت دانش: جریان رویدادهای دانش (جست‌وجو، بازدید، رأی، پیوند، حل بدون درخواست)
-- ---------------------------------------------------------------------------
create table if not exists sm_kb_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  -- search | view | click | vote | rating | flag | link | unlink | deflect | suggest | create | attest | tree
  kind text not null,
  user_id uuid,
  -- the browser session (deflection: search → view → no request)
  session_id text,
  -- requester | agent
  persona text,
  -- portal | record | search | chat | api
  channel text,
  article_id uuid,
  record_table text,
  record_id uuid,
  -- the search form of the query (Persian-normalised) and how many results it found
  query text,
  results int,
  position int,
  value int,
  data jsonb
);
create index if not exists sm_kb_events_org_at_idx on sm_kb_events (org_id, at desc);
create index if not exists sm_kb_events_article_idx on sm_kb_events (org_id, article_id, at desc) where article_id is not null;
create index if not exists sm_kb_events_user_idx on sm_kb_events (org_id, user_id, at desc) where user_id is not null;
create index if not exists sm_kb_events_kind_idx on sm_kb_events (org_id, kind, at desc);
alter table sm_kb_events enable row level security;

insert into sm_migrations (id) values ('0045_knowledge') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0050_access_locations — دسترسی: مکان عضو در محیط شرط‌ها (مکان من)
-- ---------------------------------------------------------------------------
create or replace function sm_access_profile_location() returns trigger language plpgsql as $fn$
begin
  if new.location_id is distinct from old.location_id then
    perform sm_access_bump(new.org_id);
  end if;
  return null;
end
$fn$;

create or replace function sm_access_locations() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.parent_id is distinct from old.parent_id or new.path is distinct from old.path or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_member_profiles_location on sm_member_profiles;
create trigger sm_member_profiles_location after update on sm_member_profiles for each row execute function sm_access_profile_location();
drop trigger if exists sm_locations_access on sm_locations;
create trigger sm_locations_access after insert or update or delete on sm_locations for each row execute function sm_access_locations();

insert into sm_migrations (id) values ('0050_access_locations') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0052_ai_skills — مهارت‌های هوش مصنوعی: پیشنهادهای وابسته به رکورد
-- ---------------------------------------------------------------------------
alter table sm_ai_actions add column if not exists record_table text;
alter table sm_ai_actions add column if not exists record_id uuid;
alter table sm_ai_actions add column if not exists fields text[];
alter table sm_ai_actions add column if not exists skill_run_id uuid;
-- person | service
alter table sm_ai_actions add column if not exists principal text;
create index if not exists sm_ai_actions_record_idx on sm_ai_actions (org_id, record_table, record_id, created_at desc) where record_id is not null;

insert into sm_migrations (id) values ('0052_ai_skills') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0053_grant_epochs — دسترسی: بازخوانی برنامهٔ ویندوز وقتی دسترسی مالکان خدمت، تأییدکنندگان و جانشینان تغییر می‌کند
-- ---------------------------------------------------------------------------
create or replace function sm_access_services() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.owner_id is distinct from old.owner_id or new.product_owner_id is distinct from old.product_owner_id
     or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump_user(org, new.owner_id);
    perform sm_access_bump_user(org, new.product_owner_id);
    if old.owner_id is distinct from new.owner_id then perform sm_access_bump_user(org, old.owner_id); end if;
    if old.product_owner_id is distinct from new.product_owner_id then perform sm_access_bump_user(org, old.product_owner_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_delegations() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.from_user is distinct from old.from_user or new.to_user is distinct from old.to_user
     or new.active is distinct from old.active or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.scopes is distinct from old.scopes or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump_user(org, new.from_user);
    perform sm_access_bump_user(org, new.to_user);
    if old.from_user is distinct from new.from_user then perform sm_access_bump_user(org, old.from_user); end if;
    if old.to_user is distinct from new.to_user then perform sm_access_bump_user(org, old.to_user); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_approvals() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  -- a new approval grants its approver; a removed or skipped one takes the grant away; a decision names who decided
  if tg_op <> 'UPDATE' or new.approver_id is distinct from old.approver_id or new.delegated_from is distinct from old.delegated_from
     or new.decided_by is distinct from old.decided_by or new.deleted_at is distinct from old.deleted_at
     or (new.state = 'skipped') is distinct from (old.state = 'skipped') then
    perform sm_access_bump_user(org, new.approver_id);
    perform sm_access_bump_user(org, new.delegated_from);
    perform sm_access_bump_user(org, new.decided_by);
    if old.approver_id is distinct from new.approver_id then perform sm_access_bump_user(org, old.approver_id); end if;
    if old.delegated_from is distinct from new.delegated_from then perform sm_access_bump_user(org, old.delegated_from); end if;
    if old.decided_by is distinct from new.decided_by then perform sm_access_bump_user(org, old.decided_by); end if;
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_services_access on sm_services;
create trigger sm_services_access after insert or update or delete on sm_services for each row execute function sm_access_services();
drop trigger if exists sm_delegations_access on sm_delegations;
create trigger sm_delegations_access after insert or update or delete on sm_delegations for each row execute function sm_access_delegations();
drop trigger if exists sm_approvals_access on sm_approvals;
create trigger sm_approvals_access after insert or update or delete on sm_approvals for each row execute function sm_access_approvals();

insert into sm_migrations (id) values ('0053_grant_epochs') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0058_ai_agents — عامل‌های هوش مصنوعی: پیشنهادهای عامل‌ها، مسیر رسیدگی و نتیجهٔ هر ردیف
-- ---------------------------------------------------------------------------
alter table sm_ai_actions add column if not exists agent_id uuid;
alter table sm_ai_actions add column if not exists agent_run_id uuid;
alter table sm_ai_actions add column if not exists route_users uuid[];
alter table sm_ai_actions add column if not exists route_groups uuid[];
alter table sm_ai_actions add column if not exists outcome jsonb;
alter table sm_ai_actions add column if not exists route_only boolean not null default false;
create index if not exists sm_ai_actions_agent_idx on sm_ai_actions (org_id, agent_id, created_at desc) where agent_id is not null;
create index if not exists sm_ai_actions_open_idx on sm_ai_actions (org_id, status, created_at desc) where status = 'proposed';

insert into sm_migrations (id) values ('0058_ai_agents') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0064_ai_ml — هوش مصنوعی پیش‌بین: مدل‌ها، پیش‌بینی‌ها، خوشه‌ها، بینش‌ها و گزارش حاکمیت
-- ---------------------------------------------------------------------------
create table if not exists sm_ai_models (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  key text not null,
  kind text not null,
  name text not null,
  table_key text not null,
  target text,
  inputs jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  status text not null default 'new',
  version integer not null default 0,
  seed integer not null default 1,
  threshold_show numeric not null default 0.5,
  threshold_apply numeric,
  schedule text not null default 'weekly',
  metrics jsonb,
  baseline jsonb,
  beats_baseline boolean not null default false,
  history jsonb not null default '[]'::jsonb,
  params jsonb,
  training_rows integer not null default 0,
  trained_at timestamptz,
  train_after timestamptz,
  last_error text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sm_ai_models_key_idx on sm_ai_models (org_id, key);
create index if not exists sm_ai_models_table_idx on sm_ai_models (org_id, table_key);

create table if not exists sm_ai_predictions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  model_id uuid not null references sm_ai_models(id) on delete cascade,
  model_key text not null,
  model_version integer not null default 0,
  kind text not null,
  table_key text not null,
  record_id uuid not null,
  field text,
  value text,
  score numeric not null default 0,
  alternatives jsonb not null default '[]'::jsonb,
  why jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  actual text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sm_ai_predictions_model_record_idx on sm_ai_predictions (org_id, model_key, record_id);
create index if not exists sm_ai_predictions_record_idx on sm_ai_predictions (org_id, table_key, record_id);
create index if not exists sm_ai_predictions_status_idx on sm_ai_predictions (org_id, model_key, status, updated_at desc);

create table if not exists sm_ai_clusters (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  run_at timestamptz not null default now(),
  table_key text not null,
  size integer not null default 0,
  cohesion numeric not null default 0,
  members uuid[] not null default '{}',
  sims jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  problem_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_clusters_org_idx on sm_ai_clusters (org_id, table_key, status, run_at desc);

create table if not exists sm_ai_insights (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  period text not null,
  period_key text not null,
  kind text not null,
  table_key text not null,
  subject text not null default '',
  scope jsonb not null default '{}'::jsonb,
  fields text[] not null default '{}',
  refs jsonb not null default '[]'::jsonb,
  severity text not null default 'info',
  score numeric not null default 0,
  title text not null,
  numbers jsonb not null default '{}'::jsonb,
  drivers jsonb not null default '[]'::jsonb,
  narrative text,
  narrative_ai boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists sm_ai_insights_key_idx on sm_ai_insights (org_id, period, period_key, kind, table_key, subject);
create index if not exists sm_ai_insights_recent_idx on sm_ai_insights (org_id, created_at desc);

create table if not exists sm_ai_guard_log (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  feature text,
  tables text[] not null default '{}',
  user_id uuid,
  detail text
);
create index if not exists sm_ai_guard_log_idx on sm_ai_guard_log (org_id, at desc);

-- Supabase: reachable only through the app's own server connection
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename in ('sm_ai_models', 'sm_ai_predictions', 'sm_ai_clusters', 'sm_ai_insights', 'sm_ai_guard_log') loop
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

insert into sm_migrations (id) values ('0064_ai_ml') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0067_portal — درگاه سلف‌سرویس: جریان رویدادهای درگاه و گزارش پیام‌های کانال‌های پیام‌رسان
-- ---------------------------------------------------------------------------
create table if not exists sm_portal_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  -- search | click | answer | deflect | order | report | home | widget_search | public_view | public_search | public_vote | survey
  kind text not null,
  user_id uuid,
  session_id text,
  -- portal | widget | public | messenger
  channel text,
  query text,
  results int,
  value int,
  ref_table text,
  ref_id uuid,
  data jsonb
);
create index if not exists sm_portal_events_org_at_idx on sm_portal_events (org_id, at desc);
create index if not exists sm_portal_events_kind_idx on sm_portal_events (org_id, kind, at desc);
alter table sm_portal_events enable row level security;

create table if not exists sm_portal_channel_log (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  channel_id uuid not null,
  -- in | out
  direction text not null,
  -- received | replied | linked | unlinked | ignored | rate_limited | duplicate | failed | sent
  status text not null,
  message_key text,
  external_id text,
  user_id uuid,
  text text,
  conversation_id uuid,
  error text
);
create index if not exists sm_portal_channel_log_org_at_idx on sm_portal_channel_log (org_id, channel_id, at desc);
create unique index if not exists sm_portal_channel_log_msg_key on sm_portal_channel_log (org_id, channel_id, message_key) where direction = 'in' and message_key is not null;
alter table sm_portal_channel_log enable row level security;

insert into sm_migrations (id) values ('0067_portal') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0070_portal_surveys — درگاه سلف‌سرویس: پاسخ‌های نظرسنجی بی‌نام در انتظار ثبت دسته‌ای
-- ---------------------------------------------------------------------------
create table if not exists sm_survey_held (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  survey_id uuid not null,
  payload jsonb not null
);
create index if not exists sm_survey_held_survey_idx on sm_survey_held (org_id, survey_id);
alter table sm_survey_held enable row level security;

insert into sm_migrations (id) values ('0070_portal_surveys') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0080_admin_integration — مدیریت و اتصال‌ها: طرح‌ها، کلیدهای قابلیت، اطلاعیه‌ها، پشتیبان‌ها، کلیدهای API کاربران یکپارچه‌سازی، گزارش اتصال‌ها و فهرست کاربران
-- ---------------------------------------------------------------------------
create table if not exists sm_plans (
  key text primary key,
  name text not null,
  description text,
  limits jsonb not null default '{}'::jsonb,
  features text[] not null default '{}',
  sort_order int not null default 0,
  is_default boolean not null default false,
  active boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table sm_plans enable row level security;
insert into sm_plans (key, name, description, limits, features, sort_order, is_default) values
  ('free', 'رایگان', 'برای آزمودن: چند عضو، بدون API و همگام‌سازی فهرست کاربران',
   '{"members": 10, "custom_tables": 1, "custom_fields": 20, "integration_users": 0, "api_rate": 0, "webhooks": 0, "storage_mb": 500}'::jsonb,
   '{}', 10, false),
  ('standard', 'پایه', 'بیشتر سازمان‌ها: API، وب‌هوک و ورود داده',
   '{"members": 500, "custom_tables": 5, "custom_fields": 150, "integration_users": 10, "api_rate": 600, "webhooks": 20, "storage_mb": 20000}'::jsonb,
   '{}', 20, true),
  ('enterprise', 'سازمانی', 'بدون سقف؛ همگام‌سازی فهرست کاربران، SCIM و پشتیبان‌گیری زمان‌بندی‌شده',
   '{}'::jsonb, '{}', 30, false)
on conflict (key) do nothing;

create table if not exists sm_platform_flags (
  key text primary key,
  label text not null,
  description text,
  stage text not null default 'on' check (stage in ('off', 'beta', 'on')),
  percent int not null default 100 check (percent between 0 and 100),
  plans text[] not null default '{}',
  orgs_on uuid[] not null default '{}',
  orgs_off uuid[] not null default '{}',
  tenant_toggle boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table sm_platform_flags enable row level security;
insert into sm_platform_flags (key, label, description, stage, plans) values
  ('public_api', 'API رکوردها', 'API یکپارچهٔ REST با کلیدهای کاربران یکپارچه‌سازی و سند OpenAPI', 'on', '{standard,enterprise}'),
  ('webhooks', 'وب‌هوک‌های خروجی و ورودی', 'اشتراک رویداد رکوردها و نقطه‌های دریافت', 'on', '{standard,enterprise}'),
  ('directory_sync', 'همگام‌سازی LDAP و Active Directory', 'ورود و به‌روزرسانی اعضا و گروه‌ها از فهرست کاربران', 'on', '{enterprise}'),
  ('scim', 'تأمین کاربر با SCIM (Entra ID)', 'ساخت و غیرفعال کردن اعضا از Microsoft Entra ID و دیگر IdPها', 'on', '{enterprise}'),
  ('issue_sync', 'پیوند Jira و GitHub', 'ساخت issue از رکورد و همگام‌سازی وضعیت و یادداشت‌ها', 'on', '{}'),
  ('custom_tables', 'جدول‌های سفارشی', 'استودیوی جدول‌ها و فیلدهای سفارشی', 'on', '{}'),
  ('scheduled_exports', 'خروجی‌های زمان‌بندی‌شده', 'ارسال دوره‌ای دادهٔ جدول‌ها به نشانی یا فایل', 'on', '{standard,enterprise}'),
  ('data_import', 'ورود داده با نگاشت', 'مجموعه‌های ورود از CSV و اکسل با نقشهٔ تبدیل و ورود زمان‌بندی‌شده', 'on', '{}')
on conflict (key) do nothing;

create table if not exists sm_platform_announcements (
  id uuid primary key,
  title text not null,
  body text not null default '',
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical', 'maintenance')),
  audience text not null default 'all' check (audience in ('all', 'orgs', 'plans')),
  org_ids uuid[] not null default '{}',
  plans text[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  published_at timestamptz,
  delivered int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table sm_platform_announcements enable row level security;

create table if not exists sm_backups (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null default 'manual',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  tables int not null default 0,
  rows int not null default 0,
  bytes bigint not null default 0,
  sha256 text,
  content bytea,
  note text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists sm_backups_org_idx on sm_backups (org_id, created_at desc);
alter table sm_backups enable row level security;

alter table sm_api_keys add column if not exists integration_user_id uuid;
alter table sm_api_keys add column if not exists table_scopes jsonb;
alter table sm_api_keys add column if not exists rate_limit int;
alter table sm_api_keys add column if not exists expires_at timestamptz;
alter table sm_api_keys add column if not exists ip_allowlist text[];
alter table sm_api_keys add column if not exists revoked_by uuid;
alter table sm_api_keys add column if not exists calls bigint not null default 0;
create index if not exists sm_api_keys_user_idx on sm_api_keys (org_id, integration_user_id) where integration_user_id is not null;

create table if not exists sm_api_usage (
  org_id uuid not null,
  key_id uuid not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key_id, window_start)
);
alter table sm_api_usage enable row level security;

create table if not exists sm_int_log (
  id uuid primary key,
  org_id uuid not null,
  at timestamptz not null default now(),
  kind text not null,
  ref_id uuid,
  actor uuid,
  method text,
  target text,
  status int,
  ok boolean not null default true,
  latency_ms int,
  summary text,
  error text
);
create index if not exists sm_int_log_org_idx on sm_int_log (org_id, at desc);
create index if not exists sm_int_log_kind_idx on sm_int_log (org_id, kind, at desc);
create index if not exists sm_int_log_ref_idx on sm_int_log (org_id, ref_id, at desc) where ref_id is not null;
alter table sm_int_log enable row level security;

create table if not exists sm_webhook_deliveries (
  id uuid primary key,
  org_id uuid not null,
  subscription_id uuid not null,
  event text not null,
  table_key text not null,
  record_id uuid,
  record_number text,
  actor uuid,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'dead', 'skipped')),
  attempts int not null default 0,
  response_code int,
  latency_ms int,
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  next_retry_at timestamptz
);
create index if not exists sm_webhook_deliveries_sub_idx on sm_webhook_deliveries (org_id, subscription_id, created_at desc);
create index if not exists sm_webhook_deliveries_dead_idx on sm_webhook_deliveries (org_id, status, created_at desc) where status in ('dead', 'failed');
alter table sm_webhook_deliveries enable row level security;

create table if not exists sm_directory_runs (
  id uuid primary key,
  org_id uuid not null,
  source_id uuid not null,
  kind text not null check (kind in ('preview', 'apply', 'scim')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  plan jsonb,
  error text
);
create index if not exists sm_directory_runs_idx on sm_directory_runs (org_id, source_id, started_at desc);
alter table sm_directory_runs enable row level security;

create table if not exists sm_directory_links (
  org_id uuid not null,
  source_id uuid not null,
  kind text not null check (kind in ('user', 'group')),
  external_id text not null,
  local_id uuid not null,
  external_name text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (source_id, kind, external_id)
);
create index if not exists sm_directory_links_local_idx on sm_directory_links (org_id, kind, local_id);
alter table sm_directory_links enable row level security;

insert into sm_migrations (id) values ('0080_admin_integration') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0090_auth_directory — ورود با حساب سازمانی و ورود خودکار ویندوز: روش و دامنهٔ نشست‌ها، سیاست نشست، شمارش ورودهای ناموفق و قفل محلی
-- ---------------------------------------------------------------------------
alter table sm_sessions add column if not exists auth_method text;
alter table sm_sessions add column if not exists org_id uuid;
alter table sm_sessions add column if not exists source_id uuid;
alter table sm_sessions add column if not exists login text;
alter table sm_sessions add column if not exists reauth_at timestamptz;
alter table sm_sessions add column if not exists idle_minutes int not null default 0;
alter table sm_sessions add column if not exists browser_only boolean not null default false;
alter table sm_sessions add column if not exists revoke_reason text;
create index if not exists sm_sessions_org_idx on sm_sessions (org_id) where revoked_at is null;
create index if not exists sm_sessions_live_idx on sm_sessions (user_id, last_seen_at desc) where revoked_at is null;

create table if not exists sm_auth_throttle (
  key text primary key,
  org_id uuid,
  kind text not null,
  subject text,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists sm_auth_throttle_org_idx on sm_auth_throttle (org_id, updated_at desc);
alter table sm_auth_throttle enable row level security;

alter table sm_directory_links add column if not exists granted jsonb;

insert into sm_migrations (id) values ('0090_auth_directory') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0091_directory_identity — پیوند حساب‌ها با خود شیء فهرست کاربران (objectGUID)، نه فقط نام آن
-- ---------------------------------------------------------------------------
alter table sm_directory_links add column if not exists object_id text;
create index if not exists sm_directory_links_object_idx on sm_directory_links (source_id, kind, object_id) where object_id is not null;

insert into sm_migrations (id) values ('0091_directory_identity') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0095_scale — مقیاس بانکی: جست‌وجوی سه‌حرفی (pg_trgm) و نمایه‌های BRIN جریان‌های افزایشی
-- ---------------------------------------------------------------------------
do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin
      create extension pg_trgm;
    exception when others then
      raise notice 'pg_trgm not installed: %', sqlerrm;
    end;
  end if;
end
$ext$;

create index if not exists sm_journal_created_brin on sm_journal using brin (created_at);
create index if not exists sm_history_at_brin on sm_history using brin (at);
create index if not exists sm_audit_at_brin on sm_audit using brin (at);
create index if not exists sm_notification_log_created_brin on sm_notification_log using brin (created_at);

insert into sm_migrations (id) values ('0095_scale') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0098_demo — داده‌های نمایشی: بستهٔ نمایشی سازمان و فهرست همهٔ ردیف‌هایی که ساخته است (برای حذف بی‌ردپا)
-- ---------------------------------------------------------------------------
create table if not exists sm_demo_packs (
  org_id uuid primary key references sm_orgs(id) on delete cascade,
  state text not null default 'loading',
  size text not null default 'small',
  options jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,
  report jsonb,
  error text,
  started_by uuid,
  started_at timestamptz not null default now(),
  loaded_at timestamptz,
  purge_started_at timestamptz,
  purge_mark bigint,
  updated_at timestamptz not null default now()
);

create table if not exists sm_demo_rows (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  primary key (org_id, row_id)
);
create index if not exists sm_demo_rows_tbl_idx on sm_demo_rows (org_id, tbl);

-- the computed tables' rows as they were before the load (purge.ts COMPUTED_TABLES): put back by the purge
create table if not exists sm_demo_saved (
  org_id uuid not null,
  tbl text not null,
  row_id uuid not null,
  data jsonb not null,
  primary key (org_id, tbl, row_id)
);

alter table sm_demo_packs enable row level security;
alter table sm_demo_rows enable row level security;
alter table sm_demo_saved enable row level security;

create or replace function sm_demo_capture() returns trigger language plpgsql as $demo$
begin
  insert into sm_demo_rows (org_id, row_id, tbl) values (new.org_id, new.id, tg_table_name) on conflict do nothing;
  return null;
end
$demo$;

-- the platform's own tables with id + org_id (the engine's tables got theirs with their DDL): read from pg_catalog,
-- which is fast everywhere (information_schema is slow on the embedded database), and only where it is missing
do $capture$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\_%' and c.relname not like '%\_arc'
       and c.relname not in ('sm_orgs', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo', 63))
  loop
    execute format('create trigger %I after insert on %I for each row when (current_setting(''itsm.demo'', true) = new.org_id::text) execute function sm_demo_capture()', left(t.table_name || '_demo', 63), t.table_name);
  end loop;
end
$capture$;

insert into sm_migrations (id) values ('0098_demo') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0099_demo_touch — داده‌های نمایشی: ثبت تغییرهای کار نمایشی در ردیف‌های واقعی (تا حذف فقط همان‌ها را برگرداند) و نفرستادن کار نمایشی از برنامهٔ ویندوز
-- ---------------------------------------------------------------------------
create table if not exists sm_demo_touched (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  before jsonb not null,
  after jsonb,
  conflict boolean not null default false,
  at timestamptz not null default now(),
  primary key (org_id, row_id)
);
create index if not exists sm_demo_touched_tbl_idx on sm_demo_touched (org_id, tbl);
alter table sm_demo_touched enable row level security;

create or replace function sm_demo_touch() returns trigger language plpgsql as $demo$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
begin
  if exists (select 1 from sm_demo_rows d where d.org_id = old.org_id and d.row_id = old.id) then
    return null;
  end if;
  insert into sm_demo_touched (org_id, row_id, tbl, before, after, conflict, at)
  values (old.org_id, old.id, tg_table_name, v_old, v_new, false, now())
  on conflict (org_id, row_id) do update
     set after = excluded.after,
         -- something outside the demo scope changed the row between two demo writes: never put it back blindly
         conflict = sm_demo_touched.conflict or sm_demo_touched.after is null
           or (sm_demo_touched.after - 'rev' - 'updated_at') <> (v_old - 'rev' - 'updated_at'),
         at = now();
  return null;
end
$demo$;

do $touch$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\_%' and c.relname not like '%\_arc'
       and c.relname not in ('sm_orgs', 'sm_users', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved', 'sm_demo_touched')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo_t', 63))
  loop
    execute format('create trigger %I after update or delete on %I for each row when (current_setting(''itsm.demo'', true) = old.org_id::text) execute function sm_demo_touch()', left(t.table_name || '_demo_t', 63), t.table_name);
  end loop;
end
$touch$;

create or replace function sm_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
  v_applying boolean := coalesce(current_setting('itsm.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    -- demo work is never pushed from a Windows app (docs/DEMO_FA.md: load the demo on the server)
    if not v_applying and (new.org_id is null or coalesce(current_setting('itsm.demo', true), '') <> new.org_id::text) then
      insert into sm_outbox (entity, id, changed_at) values (tg_argv[0], new.id, now())
      on conflict (entity, id) do update set changed_at = excluded.changed_at, attempts = 0, last_error = null;
    end if;
    return new;
  end if;
  -- (sm_orgs.org_id is a generated column, still null inside a BEFORE trigger)
  insert into sm_org_sync (org_id, rev) values (coalesce(new.org_id, new.id), 1)
  on conflict (org_id) do update set rev = sm_org_sync.rev + 1
  returning rev into v_rev;
  new.rev := v_rev;
  return new;
end
$fn$;

insert into sm_migrations (id) values ('0099_demo_touch') on conflict (id) do nothing;

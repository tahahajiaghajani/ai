-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۷ از ۹ (0006_engine_tables:21/28 … 0006_engine_tables:24/28)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۱ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 21/28 (e746bd22eb04)
-- sec_config: تنظیمات امنیت
do $cols$
begin
  if to_regclass('sm_sec_configs') is not null then
    alter table sm_sec_configs add column if not exists workspace_id uuid;
    alter table sm_sec_configs add column if not exists domain_id uuid;
    alter table sm_sec_configs add column if not exists unit_id uuid;
    alter table sm_sec_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_configs add column if not exists created_by uuid;
    alter table sm_sec_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_configs add column if not exists updated_by uuid;
    alter table sm_sec_configs add column if not exists rev bigint not null default 0;
    alter table sm_sec_configs add column if not exists version integer not null default 1;
    alter table sm_sec_configs add column if not exists deleted_at timestamptz;
    alter table sm_sec_configs add column if not exists origin text;
    alter table sm_sec_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_configs add column if not exists name text;
    alter table sm_sec_configs add column if not exists config_key text;
    alter table sm_sec_configs add column if not exists secure_workspace_id uuid;
    alter table sm_sec_configs add column if not exists soc_group_id uuid;
    alter table sm_sec_configs add column if not exists auto_promote boolean not null default true;
    alter table sm_sec_configs add column if not exists auto_playbook boolean not null default true;
    alter table sm_sec_configs add column if not exists sir_weights jsonb;
    alter table sm_sec_configs add column if not exists ai_max_classification text;
    alter table sm_sec_configs add column if not exists vuln_group_id uuid;
    alter table sm_sec_configs add column if not exists vuln_sla_critical integer;
    alter table sm_sec_configs add column if not exists vuln_sla_high integer;
    alter table sm_sec_configs add column if not exists vuln_sla_medium integer;
    alter table sm_sec_configs add column if not exists vuln_sla_low integer;
    alter table sm_sec_configs add column if not exists autoclose_missing boolean not null default true;
    alter table sm_sec_configs add column if not exists exception_warn_days integer;
    alter table sm_sec_configs add column if not exists review_changes boolean not null default true;
    alter table sm_sec_configs add column if not exists grc_group_id uuid;
    alter table sm_sec_configs add column if not exists policy_review_months integer;
    alter table sm_sec_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_sec_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  secure_workspace_id uuid,
  soc_group_id uuid,
  auto_promote boolean not null default true,
  auto_playbook boolean not null default true,
  sir_weights jsonb,
  ai_max_classification text,
  vuln_group_id uuid,
  vuln_sla_critical integer,
  vuln_sla_high integer,
  vuln_sla_medium integer,
  vuln_sla_low integer,
  autoclose_missing boolean not null default true,
  exception_warn_days integer,
  review_changes boolean not null default true,
  grc_group_id uuid,
  policy_review_months integer,
  seeded integer
);
create index if not exists sm_sec_configs_rev_idx on sm_sec_configs (org_id, rev);
create index if not exists sm_sec_configs_upd_idx on sm_sec_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_configs_crt_idx on sm_sec_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sec_configs_config_key_uk on sm_sec_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_sec_configs_sync on sm_sec_configs;
create trigger sm_sec_configs_sync before insert or update on sm_sec_configs for each row execute function sm_sync_touch('sec_config');
create or replace trigger sm_sec_configs_demo after insert on sm_sec_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_configs_demo_t after update or delete on sm_sec_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_configs enable row level security;

-- sec_evidence: شواهد و زنجیرهٔ حضانت
do $cols$
begin
  if to_regclass('sm_sec_evidence') is not null then
    alter table sm_sec_evidence add column if not exists workspace_id uuid;
    alter table sm_sec_evidence add column if not exists domain_id uuid;
    alter table sm_sec_evidence add column if not exists unit_id uuid;
    alter table sm_sec_evidence add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_evidence add column if not exists created_by uuid;
    alter table sm_sec_evidence add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_evidence add column if not exists updated_by uuid;
    alter table sm_sec_evidence add column if not exists rev bigint not null default 0;
    alter table sm_sec_evidence add column if not exists version integer not null default 1;
    alter table sm_sec_evidence add column if not exists deleted_at timestamptz;
    alter table sm_sec_evidence add column if not exists origin text;
    alter table sm_sec_evidence add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_evidence add column if not exists no integer;
    alter table sm_sec_evidence add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EVD' || no::text else 'EVD' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_evidence add column if not exists title text;
    alter table sm_sec_evidence add column if not exists kind text;
    alter table sm_sec_evidence add column if not exists sec_incident_id uuid;
    alter table sm_sec_evidence add column if not exists sha256 text;
    alter table sm_sec_evidence add column if not exists description text;
    alter table sm_sec_evidence add column if not exists collected_at timestamptz;
    alter table sm_sec_evidence add column if not exists collected_by uuid;
    alter table sm_sec_evidence add column if not exists custodian_id uuid;
    alter table sm_sec_evidence add column if not exists location text;
    alter table sm_sec_evidence add column if not exists legal_hold boolean not null default false;
    alter table sm_sec_evidence add column if not exists assignment_group_id uuid;
    alter table sm_sec_evidence add column if not exists custody_log jsonb;
    alter table sm_sec_evidence add column if not exists notes text;
    alter table sm_sec_evidence add column if not exists confidential boolean not null default false;
    alter table sm_sec_evidence add column if not exists access_list jsonb;
    alter table sm_sec_evidence add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_evidence (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EVD' || no::text else 'EVD' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  sec_incident_id uuid,
  sha256 text,
  description text,
  collected_at timestamptz,
  collected_by uuid,
  custodian_id uuid,
  location text,
  legal_hold boolean not null default false,
  assignment_group_id uuid,
  custody_log jsonb,
  notes text,
  confidential boolean not null default false,
  access_list jsonb,
  state text,
  search_8f465c07 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(sha256, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_evidence', 'search_8f465c07', $x$translate(coalesce(title, '') || ' ' || coalesce(sha256, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_evidence_search_8f465c07_trgm', 'sm_sec_evidence', 'search_8f465c07', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_evidence_search_custom_trgm', 'sm_sec_evidence', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_evidence_no_uk on sm_sec_evidence (org_id, no);
create index if not exists sm_sec_evidence_rev_idx on sm_sec_evidence (org_id, rev);
create index if not exists sm_sec_evidence_upd_idx on sm_sec_evidence (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_evidence_crt_idx on sm_sec_evidence (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_evidence_sec_incident_id_idx on sm_sec_evidence (org_id, sec_incident_id) where deleted_at is null;
create index if not exists sm_sec_evidence_sha256_idx on sm_sec_evidence (org_id, sha256) where deleted_at is null;
create index if not exists sm_sec_evidence_state_idx on sm_sec_evidence (org_id, state) where deleted_at is null;
create index if not exists sm_sec_evidence_workspace_acc_idx on sm_sec_evidence (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_evidence_unit_acc_idx on sm_sec_evidence (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_evidence_domain_acc_idx on sm_sec_evidence (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_evidence_custodian_id_idx on sm_sec_evidence (org_id, custodian_id) where deleted_at is null;
create index if not exists sm_sec_evidence_collected_by_idx on sm_sec_evidence (org_id, collected_by) where deleted_at is null;
drop trigger if exists sm_sec_evidence_sync on sm_sec_evidence;
create trigger sm_sec_evidence_sync before insert or update on sm_sec_evidence for each row execute function sm_sync_touch('sec_evidence');
create or replace trigger sm_sec_evidence_demo after insert on sm_sec_evidence for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_evidence_demo_t after update or delete on sm_sec_evidence for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_evidence enable row level security;

-- sec_incident: رخدادهای امنیتی
do $cols$
begin
  if to_regclass('sm_sec_incidents') is not null then
    alter table sm_sec_incidents add column if not exists workspace_id uuid;
    alter table sm_sec_incidents add column if not exists domain_id uuid;
    alter table sm_sec_incidents add column if not exists unit_id uuid;
    alter table sm_sec_incidents add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_incidents add column if not exists created_by uuid;
    alter table sm_sec_incidents add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_incidents add column if not exists updated_by uuid;
    alter table sm_sec_incidents add column if not exists rev bigint not null default 0;
    alter table sm_sec_incidents add column if not exists version integer not null default 1;
    alter table sm_sec_incidents add column if not exists deleted_at timestamptz;
    alter table sm_sec_incidents add column if not exists origin text;
    alter table sm_sec_incidents add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_incidents add column if not exists no integer;
    alter table sm_sec_incidents add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIR' || no::text else 'SIR' || lpad(no::text, 7, '0') end) stored;
    alter table sm_sec_incidents add column if not exists short_description text;
    alter table sm_sec_incidents add column if not exists description text;
    alter table sm_sec_incidents add column if not exists state text;
    alter table sm_sec_incidents add column if not exists priority text;
    alter table sm_sec_incidents add column if not exists impact text;
    alter table sm_sec_incidents add column if not exists urgency text;
    alter table sm_sec_incidents add column if not exists category text;
    alter table sm_sec_incidents add column if not exists subcategory text;
    alter table sm_sec_incidents add column if not exists channel text;
    alter table sm_sec_incidents add column if not exists caller_id uuid;
    alter table sm_sec_incidents add column if not exists requested_for uuid;
    alter table sm_sec_incidents add column if not exists opened_by uuid;
    alter table sm_sec_incidents add column if not exists opened_at timestamptz;
    alter table sm_sec_incidents add column if not exists assignment_group_id uuid;
    alter table sm_sec_incidents add column if not exists assigned_to uuid;
    alter table sm_sec_incidents add column if not exists service_id uuid;
    alter table sm_sec_incidents add column if not exists offering_id uuid;
    alter table sm_sec_incidents add column if not exists ci_id uuid;
    alter table sm_sec_incidents add column if not exists location_id uuid;
    alter table sm_sec_incidents add column if not exists due_at timestamptz;
    alter table sm_sec_incidents add column if not exists resolved_at timestamptz;
    alter table sm_sec_incidents add column if not exists resolved_by uuid;
    alter table sm_sec_incidents add column if not exists closed_at timestamptz;
    alter table sm_sec_incidents add column if not exists closed_by uuid;
    alter table sm_sec_incidents add column if not exists close_code text;
    alter table sm_sec_incidents add column if not exists close_notes text;
    alter table sm_sec_incidents add column if not exists parent_id uuid;
    alter table sm_sec_incidents add column if not exists watch_list jsonb;
    alter table sm_sec_incidents add column if not exists approval text;
    alter table sm_sec_incidents add column if not exists escalation integer;
    alter table sm_sec_incidents add column if not exists reassignment_count integer;
    alter table sm_sec_incidents add column if not exists reopen_count integer;
    alter table sm_sec_incidents add column if not exists time_worked bigint;
    alter table sm_sec_incidents add column if not exists first_response_at timestamptz;
    alter table sm_sec_incidents add column if not exists active boolean not null default true;
    alter table sm_sec_incidents add column if not exists sla_due timestamptz;
    alter table sm_sec_incidents add column if not exists knowledge boolean not null default false;
    alter table sm_sec_incidents add column if not exists severity text;
    alter table sm_sec_incidents add column if not exists business_impact text;
    alter table sm_sec_incidents add column if not exists classification text;
    alter table sm_sec_incidents add column if not exists risk_score integer;
    alter table sm_sec_incidents add column if not exists source text;
    alter table sm_sec_incidents add column if not exists attack_vector text;
    alter table sm_sec_incidents add column if not exists mitre_techniques jsonb;
    alter table sm_sec_incidents add column if not exists lead_id uuid;
    alter table sm_sec_incidents add column if not exists playbook_id uuid;
    alter table sm_sec_incidents add column if not exists major boolean not null default false;
    alter table sm_sec_incidents add column if not exists personal_data_breach boolean not null default false;
    alter table sm_sec_incidents add column if not exists records_affected integer;
    alter table sm_sec_incidents add column if not exists affected_users jsonb;
    alter table sm_sec_incidents add column if not exists affected_cis jsonb;
    alter table sm_sec_incidents add column if not exists affected_services jsonb;
    alter table sm_sec_incidents add column if not exists affected_data text;
    alter table sm_sec_incidents add column if not exists it_incident_id uuid;
    alter table sm_sec_incidents add column if not exists problem_id uuid;
    alter table sm_sec_incidents add column if not exists first_malicious_at timestamptz;
    alter table sm_sec_incidents add column if not exists detected_at timestamptz;
    alter table sm_sec_incidents add column if not exists contained_at timestamptz;
    alter table sm_sec_incidents add column if not exists eradicated_at timestamptz;
    alter table sm_sec_incidents add column if not exists recovered_at timestamptz;
    alter table sm_sec_incidents add column if not exists time_to_detect bigint;
    alter table sm_sec_incidents add column if not exists time_to_contain bigint;
    alter table sm_sec_incidents add column if not exists time_to_recover bigint;
    alter table sm_sec_incidents add column if not exists regulatory boolean not null default false;
    alter table sm_sec_incidents add column if not exists regulatory_overdue boolean not null default false;
    alter table sm_sec_incidents add column if not exists root_cause text;
    alter table sm_sec_incidents add column if not exists actions_taken text;
    alter table sm_sec_incidents add column if not exists lessons text;
    alter table sm_sec_incidents add column if not exists pir_done_at timestamptz;
    alter table sm_sec_incidents add column if not exists confidential boolean not null default false;
    alter table sm_sec_incidents add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_sec_incidents (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIR' || no::text else 'SIR' || lpad(no::text, 7, '0') end) stored,
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
  severity text,
  business_impact text,
  classification text,
  risk_score integer,
  source text,
  attack_vector text,
  mitre_techniques jsonb,
  lead_id uuid,
  playbook_id uuid,
  major boolean not null default false,
  personal_data_breach boolean not null default false,
  records_affected integer,
  affected_users jsonb,
  affected_cis jsonb,
  affected_services jsonb,
  affected_data text,
  it_incident_id uuid,
  problem_id uuid,
  first_malicious_at timestamptz,
  detected_at timestamptz,
  contained_at timestamptz,
  eradicated_at timestamptz,
  recovered_at timestamptz,
  time_to_detect bigint,
  time_to_contain bigint,
  time_to_recover bigint,
  regulatory boolean not null default false,
  regulatory_overdue boolean not null default false,
  root_cause text,
  actions_taken text,
  lessons text,
  pir_done_at timestamptz,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_incidents', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_incidents_search_f3bce210_trgm', 'sm_sec_incidents', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_incidents_search_custom_trgm', 'sm_sec_incidents', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_incidents_no_uk on sm_sec_incidents (org_id, no);
create index if not exists sm_sec_incidents_rev_idx on sm_sec_incidents (org_id, rev);
create index if not exists sm_sec_incidents_upd_idx on sm_sec_incidents (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_incidents_crt_idx on sm_sec_incidents (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_incidents_state_idx on sm_sec_incidents (org_id, state) where deleted_at is null;
create index if not exists sm_sec_incidents_caller_id_idx on sm_sec_incidents (org_id, caller_id) where deleted_at is null;
create index if not exists sm_sec_incidents_assignment_group_id_idx on sm_sec_incidents (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_incidents_assigned_to_idx on sm_sec_incidents (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_sec_incidents_lead_id_idx on sm_sec_incidents (org_id, lead_id) where deleted_at is null;
create index if not exists sm_sec_incidents_it_incident_id_idx on sm_sec_incidents (org_id, it_incident_id) where deleted_at is null;
create index if not exists sm_sec_incidents_workspace_acc_idx on sm_sec_incidents (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_incidents_unit_acc_idx on sm_sec_incidents (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_incidents_domain_acc_idx on sm_sec_incidents (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_incidents_watch_list_gin on sm_sec_incidents using gin (watch_list);
create index if not exists sm_sec_incidents_open_grp_idx on sm_sec_incidents (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_sec_incidents_opened_brin on sm_sec_incidents using brin (opened_at);
drop trigger if exists sm_sec_incidents_sync on sm_sec_incidents;
create trigger sm_sec_incidents_sync before insert or update on sm_sec_incidents for each row execute function sm_sync_touch('sec_incident');
create or replace trigger sm_sec_incidents_demo after insert on sm_sec_incidents for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_incidents_demo_t after update or delete on sm_sec_incidents for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_incidents enable row level security;

-- sec_observable: نشانگرها و اطلاعات تهدید
do $cols$
begin
  if to_regclass('sm_sec_observables') is not null then
    alter table sm_sec_observables add column if not exists workspace_id uuid;
    alter table sm_sec_observables add column if not exists domain_id uuid;
    alter table sm_sec_observables add column if not exists unit_id uuid;
    alter table sm_sec_observables add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_observables add column if not exists created_by uuid;
    alter table sm_sec_observables add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_observables add column if not exists updated_by uuid;
    alter table sm_sec_observables add column if not exists rev bigint not null default 0;
    alter table sm_sec_observables add column if not exists version integer not null default 1;
    alter table sm_sec_observables add column if not exists deleted_at timestamptz;
    alter table sm_sec_observables add column if not exists origin text;
    alter table sm_sec_observables add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_observables add column if not exists value text;
    alter table sm_sec_observables add column if not exists type text;
    alter table sm_sec_observables add column if not exists normalized text;
    alter table sm_sec_observables add column if not exists verdict text;
    alter table sm_sec_observables add column if not exists confidence integer;
    alter table sm_sec_observables add column if not exists tlp text;
    alter table sm_sec_observables add column if not exists is_ioc boolean not null default false;
    alter table sm_sec_observables add column if not exists source text;
    alter table sm_sec_observables add column if not exists mitre jsonb;
    alter table sm_sec_observables add column if not exists incidents jsonb;
    alter table sm_sec_observables add column if not exists sightings integer;
    alter table sm_sec_observables add column if not exists first_seen timestamptz;
    alter table sm_sec_observables add column if not exists last_seen timestamptz;
    alter table sm_sec_observables add column if not exists expires_at timestamptz;
    alter table sm_sec_observables add column if not exists enrichment jsonb;
    alter table sm_sec_observables add column if not exists enriched_at timestamptz;
    alter table sm_sec_observables add column if not exists assignment_group_id uuid;
    alter table sm_sec_observables add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_sec_observables (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  value text,
  type text,
  normalized text,
  verdict text,
  confidence integer,
  tlp text,
  is_ioc boolean not null default false,
  source text,
  mitre jsonb,
  incidents jsonb,
  sightings integer,
  first_seen timestamptz,
  last_seen timestamptz,
  expires_at timestamptz,
  enrichment jsonb,
  enriched_at timestamptz,
  assignment_group_id uuid,
  notes text
);
create index if not exists sm_sec_observables_rev_idx on sm_sec_observables (org_id, rev);
create index if not exists sm_sec_observables_upd_idx on sm_sec_observables (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_observables_crt_idx on sm_sec_observables (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_observables_normalized_idx on sm_sec_observables (org_id, normalized) where deleted_at is null;
create index if not exists sm_sec_observables_assignment_group_id_idx on sm_sec_observables (org_id, assignment_group_id) where deleted_at is null;
create unique index if not exists sm_sec_observables_type_normalized_uk on sm_sec_observables (org_id, type, normalized) where deleted_at is null;
create index if not exists sm_sec_observables_workspace_acc_idx on sm_sec_observables (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_observables_unit_acc_idx on sm_sec_observables (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_observables_domain_acc_idx on sm_sec_observables (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_sec_observables_sync on sm_sec_observables;
create trigger sm_sec_observables_sync before insert or update on sm_sec_observables for each row execute function sm_sync_touch('sec_observable');
create or replace trigger sm_sec_observables_demo after insert on sm_sec_observables for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_observables_demo_t after update or delete on sm_sec_observables for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_observables enable row level security;

-- sec_playbook: دستورالعمل‌های پاسخ
do $cols$
begin
  if to_regclass('sm_sec_playbooks') is not null then
    alter table sm_sec_playbooks add column if not exists workspace_id uuid;
    alter table sm_sec_playbooks add column if not exists domain_id uuid;
    alter table sm_sec_playbooks add column if not exists unit_id uuid;
    alter table sm_sec_playbooks add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_playbooks add column if not exists created_by uuid;
    alter table sm_sec_playbooks add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_playbooks add column if not exists updated_by uuid;
    alter table sm_sec_playbooks add column if not exists rev bigint not null default 0;
    alter table sm_sec_playbooks add column if not exists version integer not null default 1;
    alter table sm_sec_playbooks add column if not exists deleted_at timestamptz;
    alter table sm_sec_playbooks add column if not exists origin text;
    alter table sm_sec_playbooks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_playbooks add column if not exists name text;
    alter table sm_sec_playbooks add column if not exists category text;
    alter table sm_sec_playbooks add column if not exists active boolean not null default true;
    alter table sm_sec_playbooks add column if not exists auto_apply boolean not null default true;
    alter table sm_sec_playbooks add column if not exists revision integer;
    alter table sm_sec_playbooks add column if not exists steps jsonb;
    alter table sm_sec_playbooks add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_sec_playbooks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  auto_apply boolean not null default true,
  revision integer,
  steps jsonb,
  description text
);
create index if not exists sm_sec_playbooks_rev_idx on sm_sec_playbooks (org_id, rev);
create index if not exists sm_sec_playbooks_upd_idx on sm_sec_playbooks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_playbooks_crt_idx on sm_sec_playbooks (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_sec_playbooks_sync on sm_sec_playbooks;
create trigger sm_sec_playbooks_sync before insert or update on sm_sec_playbooks for each row execute function sm_sync_touch('sec_playbook');
create or replace trigger sm_sec_playbooks_demo after insert on sm_sec_playbooks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_playbooks_demo_t after update or delete on sm_sec_playbooks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_playbooks enable row level security;

-- sec_reg_clock: ساعت‌های اطلاع‌رسانی الزامی
do $cols$
begin
  if to_regclass('sm_sec_reg_clocks') is not null then
    alter table sm_sec_reg_clocks add column if not exists workspace_id uuid;
    alter table sm_sec_reg_clocks add column if not exists domain_id uuid;
    alter table sm_sec_reg_clocks add column if not exists unit_id uuid;
    alter table sm_sec_reg_clocks add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_reg_clocks add column if not exists created_by uuid;
    alter table sm_sec_reg_clocks add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_reg_clocks add column if not exists updated_by uuid;
    alter table sm_sec_reg_clocks add column if not exists rev bigint not null default 0;
    alter table sm_sec_reg_clocks add column if not exists version integer not null default 1;
    alter table sm_sec_reg_clocks add column if not exists deleted_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists origin text;
    alter table sm_sec_reg_clocks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_reg_clocks add column if not exists no integer;
    alter table sm_sec_reg_clocks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'REG' || no::text else 'REG' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_reg_clocks add column if not exists sec_incident_id uuid;
    alter table sm_sec_reg_clocks add column if not exists regime_id uuid;
    alter table sm_sec_reg_clocks add column if not exists aware_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists authority text;
    alter table sm_sec_reg_clocks add column if not exists owner_id uuid;
    alter table sm_sec_reg_clocks add column if not exists next_stage text;
    alter table sm_sec_reg_clocks add column if not exists next_due_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists overdue boolean not null default false;
    alter table sm_sec_reg_clocks add column if not exists deadlines jsonb;
    alter table sm_sec_reg_clocks add column if not exists reference text;
    alter table sm_sec_reg_clocks add column if not exists submitted_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists assignment_group_id uuid;
    alter table sm_sec_reg_clocks add column if not exists notes text;
    alter table sm_sec_reg_clocks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_reg_clocks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'REG' || no::text else 'REG' || lpad(no::text, 6, '0') end) stored,
  sec_incident_id uuid,
  regime_id uuid,
  aware_at timestamptz,
  authority text,
  owner_id uuid,
  next_stage text,
  next_due_at timestamptz,
  overdue boolean not null default false,
  deadlines jsonb,
  reference text,
  submitted_at timestamptz,
  assignment_group_id uuid,
  notes text,
  state text,
  search_18ed5af9 text generated always as (translate(coalesce(authority, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_reg_clocks', 'search_18ed5af9', $x$translate(coalesce(authority, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_reg_clocks_search_18ed5af9_trgm', 'sm_sec_reg_clocks', 'search_18ed5af9', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_reg_clocks_search_custom_trgm', 'sm_sec_reg_clocks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_reg_clocks_no_uk on sm_sec_reg_clocks (org_id, no);
create index if not exists sm_sec_reg_clocks_rev_idx on sm_sec_reg_clocks (org_id, rev);
create index if not exists sm_sec_reg_clocks_upd_idx on sm_sec_reg_clocks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_crt_idx on sm_sec_reg_clocks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_sec_incident_id_idx on sm_sec_reg_clocks (org_id, sec_incident_id) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_state_idx on sm_sec_reg_clocks (org_id, state) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_workspace_acc_idx on sm_sec_reg_clocks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_reg_clocks_unit_acc_idx on sm_sec_reg_clocks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_reg_clocks_domain_acc_idx on sm_sec_reg_clocks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_reg_clocks_owner_id_idx on sm_sec_reg_clocks (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_sec_reg_clocks_sync on sm_sec_reg_clocks;
create trigger sm_sec_reg_clocks_sync before insert or update on sm_sec_reg_clocks for each row execute function sm_sync_touch('sec_reg_clock');
create or replace trigger sm_sec_reg_clocks_demo after insert on sm_sec_reg_clocks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_reg_clocks_demo_t after update or delete on sm_sec_reg_clocks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_reg_clocks enable row level security;

-- sec_reg_regime: مقررات اطلاع‌رسانی
do $cols$
begin
  if to_regclass('sm_sec_reg_regimes') is not null then
    alter table sm_sec_reg_regimes add column if not exists workspace_id uuid;
    alter table sm_sec_reg_regimes add column if not exists domain_id uuid;
    alter table sm_sec_reg_regimes add column if not exists unit_id uuid;
    alter table sm_sec_reg_regimes add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_reg_regimes add column if not exists created_by uuid;
    alter table sm_sec_reg_regimes add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_reg_regimes add column if not exists updated_by uuid;
    alter table sm_sec_reg_regimes add column if not exists rev bigint not null default 0;
    alter table sm_sec_reg_regimes add column if not exists version integer not null default 1;
    alter table sm_sec_reg_regimes add column if not exists deleted_at timestamptz;
    alter table sm_sec_reg_regimes add column if not exists origin text;
    alter table sm_sec_reg_regimes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_reg_regimes add column if not exists name text;
    alter table sm_sec_reg_regimes add column if not exists key text;
    alter table sm_sec_reg_regimes add column if not exists active boolean not null default true;
    alter table sm_sec_reg_regimes add column if not exists authority text;
    alter table sm_sec_reg_regimes add column if not exists personal_data boolean not null default false;
    alter table sm_sec_reg_regimes add column if not exists placeholder boolean not null default false;
    alter table sm_sec_reg_regimes add column if not exists stages jsonb;
    alter table sm_sec_reg_regimes add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_sec_reg_regimes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  authority text,
  personal_data boolean not null default false,
  placeholder boolean not null default false,
  stages jsonb,
  description text
);
create index if not exists sm_sec_reg_regimes_rev_idx on sm_sec_reg_regimes (org_id, rev);
create index if not exists sm_sec_reg_regimes_upd_idx on sm_sec_reg_regimes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reg_regimes_crt_idx on sm_sec_reg_regimes (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sec_reg_regimes_key_uk on sm_sec_reg_regimes (org_id, key) where deleted_at is null;
drop trigger if exists sm_sec_reg_regimes_sync on sm_sec_reg_regimes;
create trigger sm_sec_reg_regimes_sync before insert or update on sm_sec_reg_regimes for each row execute function sm_sync_touch('sec_reg_regime');
create or replace trigger sm_sec_reg_regimes_demo after insert on sm_sec_reg_regimes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_reg_regimes_demo_t after update or delete on sm_sec_reg_regimes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_reg_regimes enable row level security;

-- sec_review: بازبینی‌های امنیتی
do $cols$
begin
  if to_regclass('sm_sec_reviews') is not null then
    alter table sm_sec_reviews add column if not exists workspace_id uuid;
    alter table sm_sec_reviews add column if not exists domain_id uuid;
    alter table sm_sec_reviews add column if not exists unit_id uuid;
    alter table sm_sec_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_reviews add column if not exists created_by uuid;
    alter table sm_sec_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_reviews add column if not exists updated_by uuid;
    alter table sm_sec_reviews add column if not exists rev bigint not null default 0;
    alter table sm_sec_reviews add column if not exists version integer not null default 1;
    alter table sm_sec_reviews add column if not exists deleted_at timestamptz;
    alter table sm_sec_reviews add column if not exists origin text;
    alter table sm_sec_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_reviews add column if not exists no integer;
    alter table sm_sec_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SRV' || no::text else 'SRV' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_reviews add column if not exists title text;
    alter table sm_sec_reviews add column if not exists kind text;
    alter table sm_sec_reviews add column if not exists change_id uuid;
    alter table sm_sec_reviews add column if not exists due_at timestamptz;
    alter table sm_sec_reviews add column if not exists flags jsonb;
    alter table sm_sec_reviews add column if not exists reviewer_id uuid;
    alter table sm_sec_reviews add column if not exists assignment_group_id uuid;
    alter table sm_sec_reviews add column if not exists decision text;
    alter table sm_sec_reviews add column if not exists findings text;
    alter table sm_sec_reviews add column if not exists conditions text;
    alter table sm_sec_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SRV' || no::text else 'SRV' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  change_id uuid,
  due_at timestamptz,
  flags jsonb,
  reviewer_id uuid,
  assignment_group_id uuid,
  decision text,
  findings text,
  conditions text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_reviews_search_cae18f1d_trgm', 'sm_sec_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_reviews_search_custom_trgm', 'sm_sec_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_reviews_no_uk on sm_sec_reviews (org_id, no);
create index if not exists sm_sec_reviews_rev_idx on sm_sec_reviews (org_id, rev);
create index if not exists sm_sec_reviews_upd_idx on sm_sec_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reviews_crt_idx on sm_sec_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reviews_change_id_idx on sm_sec_reviews (org_id, change_id) where deleted_at is null;
create index if not exists sm_sec_reviews_state_idx on sm_sec_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_sec_reviews_workspace_acc_idx on sm_sec_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_reviews_unit_acc_idx on sm_sec_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_reviews_domain_acc_idx on sm_sec_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_reviews_reviewer_id_idx on sm_sec_reviews (org_id, reviewer_id) where deleted_at is null;
drop trigger if exists sm_sec_reviews_sync on sm_sec_reviews;
create trigger sm_sec_reviews_sync before insert or update on sm_sec_reviews for each row execute function sm_sync_touch('sec_review');
create or replace trigger sm_sec_reviews_demo after insert on sm_sec_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_reviews_demo_t after update or delete on sm_sec_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_reviews enable row level security;

-- sec_scan_import: ورودهای پویش
do $cols$
begin
  if to_regclass('sm_sec_scan_imports') is not null then
    alter table sm_sec_scan_imports add column if not exists workspace_id uuid;
    alter table sm_sec_scan_imports add column if not exists domain_id uuid;
    alter table sm_sec_scan_imports add column if not exists unit_id uuid;
    alter table sm_sec_scan_imports add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_scan_imports add column if not exists created_by uuid;
    alter table sm_sec_scan_imports add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_scan_imports add column if not exists updated_by uuid;
    alter table sm_sec_scan_imports add column if not exists rev bigint not null default 0;
    alter table sm_sec_scan_imports add column if not exists version integer not null default 1;
    alter table sm_sec_scan_imports add column if not exists deleted_at timestamptz;
    alter table sm_sec_scan_imports add column if not exists origin text;
    alter table sm_sec_scan_imports add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_scan_imports add column if not exists no integer;
    alter table sm_sec_scan_imports add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SCN' || no::text else 'SCN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_scan_imports add column if not exists name text;
    alter table sm_sec_scan_imports add column if not exists scanner text;
    alter table sm_sec_scan_imports add column if not exists format text;
    alter table sm_sec_scan_imports add column if not exists imported_at timestamptz;
    alter table sm_sec_scan_imports add column if not exists imported_by uuid;
    alter table sm_sec_scan_imports add column if not exists hosts integer;
    alter table sm_sec_scan_imports add column if not exists finding_count integer;
    alter table sm_sec_scan_imports add column if not exists created_count integer;
    alter table sm_sec_scan_imports add column if not exists updated_count integer;
    alter table sm_sec_scan_imports add column if not exists reopened_count integer;
    alter table sm_sec_scan_imports add column if not exists closed_count integer;
    alter table sm_sec_scan_imports add column if not exists unmatched_count integer;
    alter table sm_sec_scan_imports add column if not exists skipped_count integer;
    alter table sm_sec_scan_imports add column if not exists covered_cis jsonb;
    alter table sm_sec_scan_imports add column if not exists errors jsonb;
  end if;
end
$cols$;
create table if not exists sm_sec_scan_imports (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SCN' || no::text else 'SCN' || lpad(no::text, 6, '0') end) stored,
  name text,
  scanner text,
  format text,
  imported_at timestamptz,
  imported_by uuid,
  hosts integer,
  finding_count integer,
  created_count integer,
  updated_count integer,
  reopened_count integer,
  closed_count integer,
  unmatched_count integer,
  skipped_count integer,
  covered_cis jsonb,
  errors jsonb,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_scan_imports', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_scan_imports_search_56291d9d_trgm', 'sm_sec_scan_imports', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_scan_imports_search_custom_trgm', 'sm_sec_scan_imports', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_scan_imports_no_uk on sm_sec_scan_imports (org_id, no);
create index if not exists sm_sec_scan_imports_rev_idx on sm_sec_scan_imports (org_id, rev);
create index if not exists sm_sec_scan_imports_upd_idx on sm_sec_scan_imports (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_scan_imports_crt_idx on sm_sec_scan_imports (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_sec_scan_imports_sync on sm_sec_scan_imports;
create trigger sm_sec_scan_imports_sync before insert or update on sm_sec_scan_imports for each row execute function sm_sync_touch('sec_scan_import');
create or replace trigger sm_sec_scan_imports_demo after insert on sm_sec_scan_imports for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_scan_imports_demo_t after update or delete on sm_sec_scan_imports for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_scan_imports enable row level security;

-- sec_task: کارهای پاسخ
do $cols$
begin
  if to_regclass('sm_sec_tasks') is not null then
    alter table sm_sec_tasks add column if not exists workspace_id uuid;
    alter table sm_sec_tasks add column if not exists domain_id uuid;
    alter table sm_sec_tasks add column if not exists unit_id uuid;
    alter table sm_sec_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_tasks add column if not exists created_by uuid;
    alter table sm_sec_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_tasks add column if not exists updated_by uuid;
    alter table sm_sec_tasks add column if not exists rev bigint not null default 0;
    alter table sm_sec_tasks add column if not exists version integer not null default 1;
    alter table sm_sec_tasks add column if not exists deleted_at timestamptz;
    alter table sm_sec_tasks add column if not exists origin text;
    alter table sm_sec_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_tasks add column if not exists no integer;
    alter table sm_sec_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIT' || no::text else 'SIT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_sec_tasks add column if not exists short_description text;
    alter table sm_sec_tasks add column if not exists description text;
    alter table sm_sec_tasks add column if not exists state text;
    alter table sm_sec_tasks add column if not exists priority text;
    alter table sm_sec_tasks add column if not exists impact text;
    alter table sm_sec_tasks add column if not exists urgency text;
    alter table sm_sec_tasks add column if not exists category text;
    alter table sm_sec_tasks add column if not exists subcategory text;
    alter table sm_sec_tasks add column if not exists channel text;
    alter table sm_sec_tasks add column if not exists caller_id uuid;
    alter table sm_sec_tasks add column if not exists requested_for uuid;
    alter table sm_sec_tasks add column if not exists opened_by uuid;
    alter table sm_sec_tasks add column if not exists opened_at timestamptz;
    alter table sm_sec_tasks add column if not exists assignment_group_id uuid;
    alter table sm_sec_tasks add column if not exists assigned_to uuid;
    alter table sm_sec_tasks add column if not exists service_id uuid;
    alter table sm_sec_tasks add column if not exists offering_id uuid;
    alter table sm_sec_tasks add column if not exists ci_id uuid;
    alter table sm_sec_tasks add column if not exists location_id uuid;
    alter table sm_sec_tasks add column if not exists due_at timestamptz;
    alter table sm_sec_tasks add column if not exists resolved_at timestamptz;
    alter table sm_sec_tasks add column if not exists resolved_by uuid;
    alter table sm_sec_tasks add column if not exists closed_at timestamptz;
    alter table sm_sec_tasks add column if not exists closed_by uuid;
    alter table sm_sec_tasks add column if not exists close_code text;
    alter table sm_sec_tasks add column if not exists close_notes text;
    alter table sm_sec_tasks add column if not exists parent_id uuid;
    alter table sm_sec_tasks add column if not exists watch_list jsonb;
    alter table sm_sec_tasks add column if not exists approval text;
    alter table sm_sec_tasks add column if not exists escalation integer;
    alter table sm_sec_tasks add column if not exists reassignment_count integer;
    alter table sm_sec_tasks add column if not exists reopen_count integer;
    alter table sm_sec_tasks add column if not exists time_worked bigint;
    alter table sm_sec_tasks add column if not exists first_response_at timestamptz;
    alter table sm_sec_tasks add column if not exists active boolean not null default true;
    alter table sm_sec_tasks add column if not exists sla_due timestamptz;
    alter table sm_sec_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_sec_tasks add column if not exists sec_incident_id uuid;
    alter table sm_sec_tasks add column if not exists phase text;
    alter table sm_sec_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_sec_tasks add column if not exists sort_order integer;
    alter table sm_sec_tasks add column if not exists action text;
    alter table sm_sec_tasks add column if not exists action_target text;
    alter table sm_sec_tasks add column if not exists requires_approval boolean not null default false;
    alter table sm_sec_tasks add column if not exists executed_at timestamptz;
    alter table sm_sec_tasks add column if not exists executed_by uuid;
    alter table sm_sec_tasks add column if not exists started_by uuid;
    alter table sm_sec_tasks add column if not exists action_result text;
  end if;
end
$cols$;
create table if not exists sm_sec_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIT' || no::text else 'SIT' || lpad(no::text, 7, '0') end) stored,
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
  sec_incident_id uuid,
  phase text,
  mandatory boolean not null default true,
  sort_order integer,
  action text,
  action_target text,
  requires_approval boolean not null default false,
  executed_at timestamptz,
  executed_by uuid,
  started_by uuid,
  action_result text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_tasks_search_f3bce210_trgm', 'sm_sec_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_tasks_search_custom_trgm', 'sm_sec_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_tasks_no_uk on sm_sec_tasks (org_id, no);
create index if not exists sm_sec_tasks_rev_idx on sm_sec_tasks (org_id, rev);
create index if not exists sm_sec_tasks_upd_idx on sm_sec_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_tasks_crt_idx on sm_sec_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_tasks_state_idx on sm_sec_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_sec_tasks_assignment_group_id_idx on sm_sec_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_tasks_assigned_to_idx on sm_sec_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_sec_tasks_sec_incident_id_idx on sm_sec_tasks (org_id, sec_incident_id) where deleted_at is null;
create index if not exists sm_sec_tasks_workspace_acc_idx on sm_sec_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_tasks_unit_acc_idx on sm_sec_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_tasks_domain_acc_idx on sm_sec_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_tasks_caller_id_idx on sm_sec_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_sec_tasks_requested_for_idx on sm_sec_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_sec_tasks_opened_by_idx on sm_sec_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_sec_tasks_watch_list_gin on sm_sec_tasks using gin (watch_list);
create index if not exists sm_sec_tasks_open_grp_idx on sm_sec_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_sec_tasks_opened_brin on sm_sec_tasks using brin (opened_at);
drop trigger if exists sm_sec_tasks_sync on sm_sec_tasks;
create trigger sm_sec_tasks_sync before insert or update on sm_sec_tasks for each row execute function sm_sync_touch('sec_task');
create or replace trigger sm_sec_tasks_demo after insert on sm_sec_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_tasks_demo_t after update or delete on sm_sec_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_tasks enable row level security;

-- sec_verification: احراز هویت‌های تماس‌گیرنده
do $cols$
begin
  if to_regclass('sm_sec_verifications') is not null then
    alter table sm_sec_verifications add column if not exists workspace_id uuid;
    alter table sm_sec_verifications add column if not exists domain_id uuid;
    alter table sm_sec_verifications add column if not exists unit_id uuid;
    alter table sm_sec_verifications add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_verifications add column if not exists created_by uuid;
    alter table sm_sec_verifications add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_verifications add column if not exists updated_by uuid;
    alter table sm_sec_verifications add column if not exists rev bigint not null default 0;
    alter table sm_sec_verifications add column if not exists version integer not null default 1;
    alter table sm_sec_verifications add column if not exists deleted_at timestamptz;
    alter table sm_sec_verifications add column if not exists origin text;
    alter table sm_sec_verifications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_verifications add column if not exists user_id uuid;
    alter table sm_sec_verifications add column if not exists record_table text;
    alter table sm_sec_verifications add column if not exists record_id text;
    alter table sm_sec_verifications add column if not exists record_number text;
    alter table sm_sec_verifications add column if not exists channel text;
    alter table sm_sec_verifications add column if not exists status text;
    alter table sm_sec_verifications add column if not exists code_hash text;
    alter table sm_sec_verifications add column if not exists expires_at timestamptz;
    alter table sm_sec_verifications add column if not exists attempts integer;
    alter table sm_sec_verifications add column if not exists requested_by uuid;
    alter table sm_sec_verifications add column if not exists verified_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_sec_verifications (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  record_table text,
  record_id text,
  record_number text,
  channel text,
  status text,
  code_hash text,
  expires_at timestamptz,
  attempts integer,
  requested_by uuid,
  verified_at timestamptz
);
create index if not exists sm_sec_verifications_rev_idx on sm_sec_verifications (org_id, rev);
create index if not exists sm_sec_verifications_upd_idx on sm_sec_verifications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_verifications_crt_idx on sm_sec_verifications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_verifications_user_id_idx on sm_sec_verifications (org_id, user_id) where deleted_at is null;
create index if not exists sm_sec_verifications_record_id_idx on sm_sec_verifications (org_id, record_id) where deleted_at is null;
create index if not exists sm_sec_verifications_workspace_acc_idx on sm_sec_verifications (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_verifications_unit_acc_idx on sm_sec_verifications (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_verifications_domain_acc_idx on sm_sec_verifications (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_verifications_requested_by_idx on sm_sec_verifications (org_id, requested_by) where deleted_at is null;
drop trigger if exists sm_sec_verifications_sync on sm_sec_verifications;
create trigger sm_sec_verifications_sync before insert or update on sm_sec_verifications for each row execute function sm_sync_touch('sec_verification');
create or replace trigger sm_sec_verifications_demo after insert on sm_sec_verifications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_verifications_demo_t after update or delete on sm_sec_verifications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_verifications enable row level security;

-- sec_vuln_exception: استثناهای آسیب‌پذیری
do $cols$
begin
  if to_regclass('sm_sec_vuln_exceptions') is not null then
    alter table sm_sec_vuln_exceptions add column if not exists workspace_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists domain_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists unit_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vuln_exceptions add column if not exists created_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vuln_exceptions add column if not exists updated_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists rev bigint not null default 0;
    alter table sm_sec_vuln_exceptions add column if not exists version integer not null default 1;
    alter table sm_sec_vuln_exceptions add column if not exists deleted_at timestamptz;
    alter table sm_sec_vuln_exceptions add column if not exists origin text;
    alter table sm_sec_vuln_exceptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vuln_exceptions add column if not exists no integer;
    alter table sm_sec_vuln_exceptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EXC' || no::text else 'EXC' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_vuln_exceptions add column if not exists title text;
    alter table sm_sec_vuln_exceptions add column if not exists kind text;
    alter table sm_sec_vuln_exceptions add column if not exists vulnerability_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists expires_at date;
    alter table sm_sec_vuln_exceptions add column if not exists items jsonb;
    alter table sm_sec_vuln_exceptions add column if not exists justification text;
    alter table sm_sec_vuln_exceptions add column if not exists vex_justification text;
    alter table sm_sec_vuln_exceptions add column if not exists compensating_controls text;
    alter table sm_sec_vuln_exceptions add column if not exists requested_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists approver_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists assignment_group_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists approval text;
    alter table sm_sec_vuln_exceptions add column if not exists approved_at timestamptz;
    alter table sm_sec_vuln_exceptions add column if not exists approved_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists warned_at timestamptz;
    alter table sm_sec_vuln_exceptions add column if not exists notes text;
    alter table sm_sec_vuln_exceptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_vuln_exceptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EXC' || no::text else 'EXC' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  vulnerability_id uuid,
  expires_at date,
  items jsonb,
  justification text,
  vex_justification text,
  compensating_controls text,
  requested_by uuid,
  approver_id uuid,
  assignment_group_id uuid,
  approval text,
  approved_at timestamptz,
  approved_by uuid,
  warned_at timestamptz,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_vuln_exceptions', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_vuln_exceptions_search_cae18f1d_trgm', 'sm_sec_vuln_exceptions', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_vuln_exceptions_search_custom_trgm', 'sm_sec_vuln_exceptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_vuln_exceptions_no_uk on sm_sec_vuln_exceptions (org_id, no);
create index if not exists sm_sec_vuln_exceptions_rev_idx on sm_sec_vuln_exceptions (org_id, rev);
create index if not exists sm_sec_vuln_exceptions_upd_idx on sm_sec_vuln_exceptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_crt_idx on sm_sec_vuln_exceptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_state_idx on sm_sec_vuln_exceptions (org_id, state) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_workspace_acc_idx on sm_sec_vuln_exceptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_vuln_exceptions_unit_acc_idx on sm_sec_vuln_exceptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_vuln_exceptions_domain_acc_idx on sm_sec_vuln_exceptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_vuln_exceptions_requested_by_idx on sm_sec_vuln_exceptions (org_id, requested_by) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_approver_id_idx on sm_sec_vuln_exceptions (org_id, approver_id) where deleted_at is null;
drop trigger if exists sm_sec_vuln_exceptions_sync on sm_sec_vuln_exceptions;
create trigger sm_sec_vuln_exceptions_sync before insert or update on sm_sec_vuln_exceptions for each row execute function sm_sync_touch('sec_vuln_exception');
create or replace trigger sm_sec_vuln_exceptions_demo after insert on sm_sec_vuln_exceptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vuln_exceptions_demo_t after update or delete on sm_sec_vuln_exceptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vuln_exceptions enable row level security;

-- sec_vuln_item: موردهای آسیب‌پذیر
do $cols$
begin
  if to_regclass('sm_sec_vuln_items') is not null then
    alter table sm_sec_vuln_items add column if not exists workspace_id uuid;
    alter table sm_sec_vuln_items add column if not exists domain_id uuid;
    alter table sm_sec_vuln_items add column if not exists unit_id uuid;
    alter table sm_sec_vuln_items add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vuln_items add column if not exists created_by uuid;
    alter table sm_sec_vuln_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vuln_items add column if not exists updated_by uuid;
    alter table sm_sec_vuln_items add column if not exists rev bigint not null default 0;
    alter table sm_sec_vuln_items add column if not exists version integer not null default 1;
    alter table sm_sec_vuln_items add column if not exists deleted_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists origin text;
    alter table sm_sec_vuln_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vuln_items add column if not exists no integer;
    alter table sm_sec_vuln_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'VIT' || no::text else 'VIT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_sec_vuln_items add column if not exists title text;
    alter table sm_sec_vuln_items add column if not exists vulnerability_id uuid;
    alter table sm_sec_vuln_items add column if not exists ci_id uuid;
    alter table sm_sec_vuln_items add column if not exists host text;
    alter table sm_sec_vuln_items add column if not exists ip_address text;
    alter table sm_sec_vuln_items add column if not exists port integer;
    alter table sm_sec_vuln_items add column if not exists protocol text;
    alter table sm_sec_vuln_items add column if not exists service_id uuid;
    alter table sm_sec_vuln_items add column if not exists source text;
    alter table sm_sec_vuln_items add column if not exists scanner_ref text;
    alter table sm_sec_vuln_items add column if not exists dedupe_key text;
    alter table sm_sec_vuln_items add column if not exists first_detected_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists last_seen_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists times_seen integer;
    alter table sm_sec_vuln_items add column if not exists last_scan_id uuid;
    alter table sm_sec_vuln_items add column if not exists missing_since timestamptz;
    alter table sm_sec_vuln_items add column if not exists proof text;
    alter table sm_sec_vuln_items add column if not exists cvss_score numeric;
    alter table sm_sec_vuln_items add column if not exists epss numeric;
    alter table sm_sec_vuln_items add column if not exists kev boolean not null default false;
    alter table sm_sec_vuln_items add column if not exists asset_criticality text;
    alter table sm_sec_vuln_items add column if not exists exposure text;
    alter table sm_sec_vuln_items add column if not exists compensating text;
    alter table sm_sec_vuln_items add column if not exists risk_score integer;
    alter table sm_sec_vuln_items add column if not exists risk_rating text;
    alter table sm_sec_vuln_items add column if not exists ssvc text;
    alter table sm_sec_vuln_items add column if not exists risk_factors jsonb;
    alter table sm_sec_vuln_items add column if not exists due_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists overdue boolean not null default false;
    alter table sm_sec_vuln_items add column if not exists sla_due timestamptz;
    alter table sm_sec_vuln_items add column if not exists assignment_group_id uuid;
    alter table sm_sec_vuln_items add column if not exists assigned_to uuid;
    alter table sm_sec_vuln_items add column if not exists remediation_id uuid;
    alter table sm_sec_vuln_items add column if not exists change_id uuid;
    alter table sm_sec_vuln_items add column if not exists exception_id uuid;
    alter table sm_sec_vuln_items add column if not exists vex_status text;
    alter table sm_sec_vuln_items add column if not exists vex_justification text;
    alter table sm_sec_vuln_items add column if not exists fixed_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists verified_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists reopen_count integer;
    alter table sm_sec_vuln_items add column if not exists close_notes text;
    alter table sm_sec_vuln_items add column if not exists watch_list jsonb;
    alter table sm_sec_vuln_items add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_vuln_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'VIT' || no::text else 'VIT' || lpad(no::text, 7, '0') end) stored,
  title text,
  vulnerability_id uuid,
  ci_id uuid,
  host text,
  ip_address text,
  port integer,
  protocol text,
  service_id uuid,
  source text,
  scanner_ref text,
  dedupe_key text,
  first_detected_at timestamptz,
  last_seen_at timestamptz,
  times_seen integer,
  last_scan_id uuid,
  missing_since timestamptz,
  proof text,
  cvss_score numeric,
  epss numeric,
  kev boolean not null default false,
  asset_criticality text,
  exposure text,
  compensating text,
  risk_score integer,
  risk_rating text,
  ssvc text,
  risk_factors jsonb,
  due_at timestamptz,
  overdue boolean not null default false,
  sla_due timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  remediation_id uuid,
  change_id uuid,
  exception_id uuid,
  vex_status text,
  vex_justification text,
  fixed_at timestamptz,
  verified_at timestamptz,
  reopen_count integer,
  close_notes text,
  watch_list jsonb,
  state text,
  search_cf51b86c text generated always as (translate(coalesce(title, '') || ' ' || coalesce(host, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_vuln_items', 'search_cf51b86c', $x$translate(coalesce(title, '') || ' ' || coalesce(host, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_vuln_items_search_cf51b86c_trgm', 'sm_sec_vuln_items', 'search_cf51b86c', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_vuln_items_search_custom_trgm', 'sm_sec_vuln_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_vuln_items_no_uk on sm_sec_vuln_items (org_id, no);
create index if not exists sm_sec_vuln_items_rev_idx on sm_sec_vuln_items (org_id, rev);
create index if not exists sm_sec_vuln_items_upd_idx on sm_sec_vuln_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_items_crt_idx on sm_sec_vuln_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_items_vulnerability_id_idx on sm_sec_vuln_items (org_id, vulnerability_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_ci_id_idx on sm_sec_vuln_items (org_id, ci_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_host_idx on sm_sec_vuln_items (org_id, host) where deleted_at is null;
create index if not exists sm_sec_vuln_items_dedupe_key_idx on sm_sec_vuln_items (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_sec_vuln_items_risk_rating_idx on sm_sec_vuln_items (org_id, risk_rating) where deleted_at is null;
create index if not exists sm_sec_vuln_items_assignment_group_id_idx on sm_sec_vuln_items (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_assigned_to_idx on sm_sec_vuln_items (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_sec_vuln_items_remediation_id_idx on sm_sec_vuln_items (org_id, remediation_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_state_idx on sm_sec_vuln_items (org_id, state) where deleted_at is null;
create unique index if not exists sm_sec_vuln_items_dedupe_key_uk on sm_sec_vuln_items (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_sec_vuln_items_workspace_acc_idx on sm_sec_vuln_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_vuln_items_unit_acc_idx on sm_sec_vuln_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_vuln_items_domain_acc_idx on sm_sec_vuln_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_vuln_items_watch_list_gin on sm_sec_vuln_items using gin (watch_list);
drop trigger if exists sm_sec_vuln_items_sync on sm_sec_vuln_items;
create trigger sm_sec_vuln_items_sync before insert or update on sm_sec_vuln_items for each row execute function sm_sync_touch('sec_vuln_item');
create or replace trigger sm_sec_vuln_items_demo after insert on sm_sec_vuln_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vuln_items_demo_t after update or delete on sm_sec_vuln_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vuln_items enable row level security;

-- sec_vuln_remediation: گروه‌های رفع آسیب‌پذیری
do $cols$
begin
  if to_regclass('sm_sec_vuln_remediations') is not null then
    alter table sm_sec_vuln_remediations add column if not exists workspace_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists domain_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists unit_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vuln_remediations add column if not exists created_by uuid;
    alter table sm_sec_vuln_remediations add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vuln_remediations add column if not exists updated_by uuid;
    alter table sm_sec_vuln_remediations add column if not exists rev bigint not null default 0;
    alter table sm_sec_vuln_remediations add column if not exists version integer not null default 1;
    alter table sm_sec_vuln_remediations add column if not exists deleted_at timestamptz;
    alter table sm_sec_vuln_remediations add column if not exists origin text;
    alter table sm_sec_vuln_remediations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vuln_remediations add column if not exists no integer;
    alter table sm_sec_vuln_remediations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'VG' || no::text else 'VG' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_vuln_remediations add column if not exists title text;
    alter table sm_sec_vuln_remediations add column if not exists vulnerability_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists basis text;
    alter table sm_sec_vuln_remediations add column if not exists assignment_group_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists assigned_to uuid;
    alter table sm_sec_vuln_remediations add column if not exists due_at timestamptz;
    alter table sm_sec_vuln_remediations add column if not exists item_count integer;
    alter table sm_sec_vuln_remediations add column if not exists open_count integer;
    alter table sm_sec_vuln_remediations add column if not exists change_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists solution text;
    alter table sm_sec_vuln_remediations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_vuln_remediations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'VG' || no::text else 'VG' || lpad(no::text, 6, '0') end) stored,
  title text,
  vulnerability_id uuid,
  basis text,
  assignment_group_id uuid,
  assigned_to uuid,
  due_at timestamptz,
  item_count integer,
  open_count integer,
  change_id uuid,
  solution text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_vuln_remediations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_vuln_remediations_search_cae18f1d_trgm', 'sm_sec_vuln_remediations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_vuln_remediations_search_custom_trgm', 'sm_sec_vuln_remediations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_vuln_remediations_no_uk on sm_sec_vuln_remediations (org_id, no);
create index if not exists sm_sec_vuln_remediations_rev_idx on sm_sec_vuln_remediations (org_id, rev);
create index if not exists sm_sec_vuln_remediations_upd_idx on sm_sec_vuln_remediations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_crt_idx on sm_sec_vuln_remediations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_vulnerability_id_idx on sm_sec_vuln_remediations (org_id, vulnerability_id) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_assignment_group_id_idx on sm_sec_vuln_remediations (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_state_idx on sm_sec_vuln_remediations (org_id, state) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_workspace_acc_idx on sm_sec_vuln_remediations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_vuln_remediations_unit_acc_idx on sm_sec_vuln_remediations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_vuln_remediations_domain_acc_idx on sm_sec_vuln_remediations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_vuln_remediations_assigned_to_idx on sm_sec_vuln_remediations (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_sec_vuln_remediations_sync on sm_sec_vuln_remediations;
create trigger sm_sec_vuln_remediations_sync before insert or update on sm_sec_vuln_remediations for each row execute function sm_sync_touch('sec_vuln_remediation');
create or replace trigger sm_sec_vuln_remediations_demo after insert on sm_sec_vuln_remediations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vuln_remediations_demo_t after update or delete on sm_sec_vuln_remediations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vuln_remediations enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:20', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۲ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 22/28 (e746bd22eb04)
-- sec_vulnerability: کتابخانهٔ آسیب‌پذیری‌ها
do $cols$
begin
  if to_regclass('sm_sec_vulnerabilities') is not null then
    alter table sm_sec_vulnerabilities add column if not exists workspace_id uuid;
    alter table sm_sec_vulnerabilities add column if not exists domain_id uuid;
    alter table sm_sec_vulnerabilities add column if not exists unit_id uuid;
    alter table sm_sec_vulnerabilities add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vulnerabilities add column if not exists created_by uuid;
    alter table sm_sec_vulnerabilities add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vulnerabilities add column if not exists updated_by uuid;
    alter table sm_sec_vulnerabilities add column if not exists rev bigint not null default 0;
    alter table sm_sec_vulnerabilities add column if not exists version integer not null default 1;
    alter table sm_sec_vulnerabilities add column if not exists deleted_at timestamptz;
    alter table sm_sec_vulnerabilities add column if not exists origin text;
    alter table sm_sec_vulnerabilities add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vulnerabilities add column if not exists cve_id text;
    alter table sm_sec_vulnerabilities add column if not exists title text;
    alter table sm_sec_vulnerabilities add column if not exists severity text;
    alter table sm_sec_vulnerabilities add column if not exists cvss_score numeric;
    alter table sm_sec_vulnerabilities add column if not exists cvss_version text;
    alter table sm_sec_vulnerabilities add column if not exists cvss_vector text;
    alter table sm_sec_vulnerabilities add column if not exists epss numeric;
    alter table sm_sec_vulnerabilities add column if not exists epss_percentile numeric;
    alter table sm_sec_vulnerabilities add column if not exists kev boolean not null default false;
    alter table sm_sec_vulnerabilities add column if not exists kev_due date;
    alter table sm_sec_vulnerabilities add column if not exists exploit_maturity text;
    alter table sm_sec_vulnerabilities add column if not exists published_at date;
    alter table sm_sec_vulnerabilities add column if not exists cwe text;
    alter table sm_sec_vulnerabilities add column if not exists vendor text;
    alter table sm_sec_vulnerabilities add column if not exists product text;
    alter table sm_sec_vulnerabilities add column if not exists source text;
    alter table sm_sec_vulnerabilities add column if not exists affected_versions text;
    alter table sm_sec_vulnerabilities add column if not exists fixed_versions text;
    alter table sm_sec_vulnerabilities add column if not exists description text;
    alter table sm_sec_vulnerabilities add column if not exists solution text;
    alter table sm_sec_vulnerabilities add column if not exists advisories text;
    alter table sm_sec_vulnerabilities add column if not exists open_items integer;
    alter table sm_sec_vulnerabilities add column if not exists last_seen_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_sec_vulnerabilities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  cve_id text,
  title text,
  severity text,
  cvss_score numeric,
  cvss_version text,
  cvss_vector text,
  epss numeric,
  epss_percentile numeric,
  kev boolean not null default false,
  kev_due date,
  exploit_maturity text,
  published_at date,
  cwe text,
  vendor text,
  product text,
  source text,
  affected_versions text,
  fixed_versions text,
  description text,
  solution text,
  advisories text,
  open_items integer,
  last_seen_at timestamptz
);
create index if not exists sm_sec_vulnerabilities_rev_idx on sm_sec_vulnerabilities (org_id, rev);
create index if not exists sm_sec_vulnerabilities_upd_idx on sm_sec_vulnerabilities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vulnerabilities_crt_idx on sm_sec_vulnerabilities (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sec_vulnerabilities_cve_id_uk on sm_sec_vulnerabilities (org_id, cve_id) where deleted_at is null;
drop trigger if exists sm_sec_vulnerabilities_sync on sm_sec_vulnerabilities;
create trigger sm_sec_vulnerabilities_sync before insert or update on sm_sec_vulnerabilities for each row execute function sm_sync_touch('sec_vulnerability');
create or replace trigger sm_sec_vulnerabilities_demo after insert on sm_sec_vulnerabilities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vulnerabilities_demo_t after update or delete on sm_sec_vulnerabilities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vulnerabilities enable row level security;

-- service: خدمت‌ها
do $cols$
begin
  if to_regclass('sm_services') is not null then
    alter table sm_services add column if not exists workspace_id uuid;
    alter table sm_services add column if not exists domain_id uuid;
    alter table sm_services add column if not exists unit_id uuid;
    alter table sm_services add column if not exists created_at timestamptz not null default now();
    alter table sm_services add column if not exists created_by uuid;
    alter table sm_services add column if not exists updated_at timestamptz not null default now();
    alter table sm_services add column if not exists updated_by uuid;
    alter table sm_services add column if not exists rev bigint not null default 0;
    alter table sm_services add column if not exists version integer not null default 1;
    alter table sm_services add column if not exists deleted_at timestamptz;
    alter table sm_services add column if not exists origin text;
    alter table sm_services add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_services add column if not exists no integer;
    alter table sm_services add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SVC' || no::text else 'SVC' || lpad(no::text, 5, '0') end) stored;
    alter table sm_services add column if not exists name text;
    alter table sm_services add column if not exists service_type text;
    alter table sm_services add column if not exists portfolio_node_id uuid;
    alter table sm_services add column if not exists ci_id uuid;
    alter table sm_services add column if not exists description text;
    alter table sm_services add column if not exists value_proposition text;
    alter table sm_services add column if not exists outcomes text;
    alter table sm_services add column if not exists tags jsonb;
    alter table sm_services add column if not exists service_key text;
    alter table sm_services add column if not exists owner_id uuid;
    alter table sm_services add column if not exists owner_group_id uuid;
    alter table sm_services add column if not exists product_owner_id uuid;
    alter table sm_services add column if not exists relationship_manager_id uuid;
    alter table sm_services add column if not exists support_group_id uuid;
    alter table sm_services add column if not exists change_approval_group_id uuid;
    alter table sm_services add column if not exists stakeholder_groups jsonb;
    alter table sm_services add column if not exists provider_unit_id uuid;
    alter table sm_services add column if not exists consumer_units jsonb;
    alter table sm_services add column if not exists tier text;
    alter table sm_services add column if not exists criticality text;
    alter table sm_services add column if not exists availability_target numeric;
    alter table sm_services add column if not exists calendar_id uuid;
    alter table sm_services add column if not exists channels jsonb;
    alter table sm_services add column if not exists continuity_tier text;
    alter table sm_services add column if not exists rto bigint;
    alter table sm_services add column if not exists rpo bigint;
    alter table sm_services add column if not exists security_classification text;
    alter table sm_services add column if not exists digital_spectrum text;
    alter table sm_services add column if not exists status text;
    alter table sm_services add column if not exists status_override text;
    alter table sm_services add column if not exists status_since timestamptz;
    alter table sm_services add column if not exists status_reason text;
    alter table sm_services add column if not exists status_note text;
    alter table sm_services add column if not exists on_status_page boolean not null default false;
    alter table sm_services add column if not exists documentation_url text;
    alter table sm_services add column if not exists name_en text;
    alter table sm_services add column if not exists description_en text;
    alter table sm_services add column if not exists annual_cost numeric;
    alter table sm_services add column if not exists cost_model text;
    alter table sm_services add column if not exists last_reviewed_at date;
    alter table sm_services add column if not exists review_months integer;
    alter table sm_services add column if not exists review_warned_for date;
    alter table sm_services add column if not exists retire_reason text;
    alter table sm_services add column if not exists approved_at timestamptz;
    alter table sm_services add column if not exists live_at timestamptz;
    alter table sm_services add column if not exists retired_at timestamptz;
    alter table sm_services add column if not exists score integer;
    alter table sm_services add column if not exists watch_list jsonb;
    alter table sm_services add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_services (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SVC' || no::text else 'SVC' || lpad(no::text, 5, '0') end) stored,
  name text,
  service_type text,
  portfolio_node_id uuid,
  ci_id uuid,
  description text,
  value_proposition text,
  outcomes text,
  tags jsonb,
  service_key text,
  owner_id uuid,
  owner_group_id uuid,
  product_owner_id uuid,
  relationship_manager_id uuid,
  support_group_id uuid,
  change_approval_group_id uuid,
  stakeholder_groups jsonb,
  provider_unit_id uuid,
  consumer_units jsonb,
  tier text,
  criticality text,
  availability_target numeric,
  calendar_id uuid,
  channels jsonb,
  continuity_tier text,
  rto bigint,
  rpo bigint,
  security_classification text,
  digital_spectrum text,
  status text,
  status_override text,
  status_since timestamptz,
  status_reason text,
  status_note text,
  on_status_page boolean not null default false,
  documentation_url text,
  name_en text,
  description_en text,
  annual_cost numeric,
  cost_model text,
  last_reviewed_at date,
  review_months integer,
  review_warned_for date,
  retire_reason text,
  approved_at timestamptz,
  live_at timestamptz,
  retired_at timestamptz,
  score integer,
  watch_list jsonb,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_services', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_services_search_56291d9d_trgm', 'sm_services', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_services_search_custom_trgm', 'sm_services', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_services_no_uk on sm_services (org_id, no);
create index if not exists sm_services_rev_idx on sm_services (org_id, rev);
create index if not exists sm_services_upd_idx on sm_services (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_services_crt_idx on sm_services (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_services_portfolio_node_id_idx on sm_services (org_id, portfolio_node_id) where deleted_at is null;
create index if not exists sm_services_ci_id_idx on sm_services (org_id, ci_id) where deleted_at is null;
create unique index if not exists sm_services_service_key_uk on sm_services (org_id, service_key) where deleted_at is null;
create index if not exists sm_services_state_idx on sm_services (org_id, state) where deleted_at is null;
create index if not exists sm_services_workspace_acc_idx on sm_services (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_services_unit_acc_idx on sm_services (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_services_domain_acc_idx on sm_services (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_services_owner_id_idx on sm_services (org_id, owner_id) where deleted_at is null;
create index if not exists sm_services_product_owner_id_idx on sm_services (org_id, product_owner_id) where deleted_at is null;
create index if not exists sm_services_relationship_manager_id_idx on sm_services (org_id, relationship_manager_id) where deleted_at is null;
create index if not exists sm_services_watch_list_gin on sm_services using gin (watch_list);
drop trigger if exists sm_services_sync on sm_services;
create trigger sm_services_sync before insert or update on sm_services for each row execute function sm_sync_touch('service');
create or replace trigger sm_services_demo after insert on sm_services for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_services_demo_t after update or delete on sm_services for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_services enable row level security;

-- service_agreement: توافق‌های مشتری
do $cols$
begin
  if to_regclass('sm_service_agreements') is not null then
    alter table sm_service_agreements add column if not exists workspace_id uuid;
    alter table sm_service_agreements add column if not exists domain_id uuid;
    alter table sm_service_agreements add column if not exists unit_id uuid;
    alter table sm_service_agreements add column if not exists created_at timestamptz not null default now();
    alter table sm_service_agreements add column if not exists created_by uuid;
    alter table sm_service_agreements add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_agreements add column if not exists updated_by uuid;
    alter table sm_service_agreements add column if not exists rev bigint not null default 0;
    alter table sm_service_agreements add column if not exists version integer not null default 1;
    alter table sm_service_agreements add column if not exists deleted_at timestamptz;
    alter table sm_service_agreements add column if not exists origin text;
    alter table sm_service_agreements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_agreements add column if not exists no integer;
    alter table sm_service_agreements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AGR' || no::text else 'AGR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_service_agreements add column if not exists name text;
    alter table sm_service_agreements add column if not exists customer_unit_id uuid;
    alter table sm_service_agreements add column if not exists service_id uuid;
    alter table sm_service_agreements add column if not exists offerings jsonb;
    alter table sm_service_agreements add column if not exists valid_from date;
    alter table sm_service_agreements add column if not exists valid_to date;
    alter table sm_service_agreements add column if not exists status text;
    alter table sm_service_agreements add column if not exists terms text;
    alter table sm_service_agreements add column if not exists manager_id uuid;
    alter table sm_service_agreements add column if not exists document_url text;
    alter table sm_service_agreements add column if not exists kind text;
    alter table sm_service_agreements add column if not exists provider_group_id uuid;
    alter table sm_service_agreements add column if not exists customer_contact_id uuid;
    alter table sm_service_agreements add column if not exists supplier_name text;
    alter table sm_service_agreements add column if not exists contract_ref text;
    alter table sm_service_agreements add column if not exists parent_agreement_id uuid;
    alter table sm_service_agreements add column if not exists compliance_target numeric;
    alter table sm_service_agreements add column if not exists at_risk_target numeric;
    alter table sm_service_agreements add column if not exists review_period text;
    alter table sm_service_agreements add column if not exists calendar_id uuid;
    alter table sm_service_agreements add column if not exists volume_limit integer;
    alter table sm_service_agreements add column if not exists monthly_fee numeric;
    alter table sm_service_agreements add column if not exists compliance_pct numeric;
    alter table sm_service_agreements add column if not exists compliance_status text;
    alter table sm_service_agreements add column if not exists experience_pct numeric;
    alter table sm_service_agreements add column if not exists watermelon boolean not null default false;
    alter table sm_service_agreements add column if not exists measured_at timestamptz;
    alter table sm_service_agreements add column if not exists service_hours text;
    alter table sm_service_agreements add column if not exists responsibilities text;
    alter table sm_service_agreements add column if not exists escalation text;
    alter table sm_service_agreements add column if not exists exclusions text;
    alter table sm_service_agreements add column if not exists agreement_version integer;
    alter table sm_service_agreements add column if not exists review_months integer;
    alter table sm_service_agreements add column if not exists next_review_at date;
    alter table sm_service_agreements add column if not exists last_review_at date;
    alter table sm_service_agreements add column if not exists review_overdue boolean not null default false;
    alter table sm_service_agreements add column if not exists review_reminded_for date;
    alter table sm_service_agreements add column if not exists expiry_reminded_for date;
    alter table sm_service_agreements add column if not exists left_force_on date;
    alter table sm_service_agreements add column if not exists approval text;
    alter table sm_service_agreements add column if not exists accepted_at timestamptz;
    alter table sm_service_agreements add column if not exists accepted_by uuid;
    alter table sm_service_agreements add column if not exists template_id uuid;
    alter table sm_service_agreements add column if not exists closed_note text;
    alter table sm_service_agreements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_service_agreements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AGR' || no::text else 'AGR' || lpad(no::text, 5, '0') end) stored,
  name text,
  customer_unit_id uuid,
  service_id uuid,
  offerings jsonb,
  valid_from date,
  valid_to date,
  status text,
  terms text,
  manager_id uuid,
  document_url text,
  kind text,
  provider_group_id uuid,
  customer_contact_id uuid,
  supplier_name text,
  contract_ref text,
  parent_agreement_id uuid,
  compliance_target numeric,
  at_risk_target numeric,
  review_period text,
  calendar_id uuid,
  volume_limit integer,
  monthly_fee numeric,
  compliance_pct numeric,
  compliance_status text,
  experience_pct numeric,
  watermelon boolean not null default false,
  measured_at timestamptz,
  service_hours text,
  responsibilities text,
  escalation text,
  exclusions text,
  agreement_version integer,
  review_months integer,
  next_review_at date,
  last_review_at date,
  review_overdue boolean not null default false,
  review_reminded_for date,
  expiry_reminded_for date,
  left_force_on date,
  approval text,
  accepted_at timestamptz,
  accepted_by uuid,
  template_id uuid,
  closed_note text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_agreements', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_agreements_search_56291d9d_trgm', 'sm_service_agreements', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_agreements_search_custom_trgm', 'sm_service_agreements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_agreements_no_uk on sm_service_agreements (org_id, no);
create index if not exists sm_service_agreements_rev_idx on sm_service_agreements (org_id, rev);
create index if not exists sm_service_agreements_upd_idx on sm_service_agreements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_agreements_crt_idx on sm_service_agreements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_agreements_service_id_idx on sm_service_agreements (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_agreements_provider_group_id_idx on sm_service_agreements (org_id, provider_group_id) where deleted_at is null;
create index if not exists sm_service_agreements_parent_agreement_id_idx on sm_service_agreements (org_id, parent_agreement_id) where deleted_at is null;
create index if not exists sm_service_agreements_state_idx on sm_service_agreements (org_id, state) where deleted_at is null;
create index if not exists sm_service_agreements_workspace_acc_idx on sm_service_agreements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_agreements_unit_acc_idx on sm_service_agreements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_agreements_domain_acc_idx on sm_service_agreements (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_agreements_manager_id_idx on sm_service_agreements (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_service_agreements_sync on sm_service_agreements;
create trigger sm_service_agreements_sync before insert or update on sm_service_agreements for each row execute function sm_sync_touch('service_agreement');
create or replace trigger sm_service_agreements_demo after insert on sm_service_agreements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_agreements_demo_t after update or delete on sm_service_agreements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_agreements enable row level security;

-- service_case: پرونده‌های واحدها
do $cols$
begin
  if to_regclass('sm_service_cases') is not null then
    alter table sm_service_cases add column if not exists workspace_id uuid;
    alter table sm_service_cases add column if not exists domain_id uuid;
    alter table sm_service_cases add column if not exists unit_id uuid;
    alter table sm_service_cases add column if not exists created_at timestamptz not null default now();
    alter table sm_service_cases add column if not exists created_by uuid;
    alter table sm_service_cases add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_cases add column if not exists updated_by uuid;
    alter table sm_service_cases add column if not exists rev bigint not null default 0;
    alter table sm_service_cases add column if not exists version integer not null default 1;
    alter table sm_service_cases add column if not exists deleted_at timestamptz;
    alter table sm_service_cases add column if not exists origin text;
    alter table sm_service_cases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_cases add column if not exists no integer;
    alter table sm_service_cases add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CAS' || no::text else 'CAS' || lpad(no::text, 7, '0') end) stored;
    alter table sm_service_cases add column if not exists short_description text;
    alter table sm_service_cases add column if not exists description text;
    alter table sm_service_cases add column if not exists state text;
    alter table sm_service_cases add column if not exists priority text;
    alter table sm_service_cases add column if not exists impact text;
    alter table sm_service_cases add column if not exists urgency text;
    alter table sm_service_cases add column if not exists category text;
    alter table sm_service_cases add column if not exists subcategory text;
    alter table sm_service_cases add column if not exists channel text;
    alter table sm_service_cases add column if not exists caller_id uuid;
    alter table sm_service_cases add column if not exists requested_for uuid;
    alter table sm_service_cases add column if not exists opened_by uuid;
    alter table sm_service_cases add column if not exists opened_at timestamptz;
    alter table sm_service_cases add column if not exists assignment_group_id uuid;
    alter table sm_service_cases add column if not exists assigned_to uuid;
    alter table sm_service_cases add column if not exists service_id uuid;
    alter table sm_service_cases add column if not exists offering_id uuid;
    alter table sm_service_cases add column if not exists ci_id uuid;
    alter table sm_service_cases add column if not exists location_id uuid;
    alter table sm_service_cases add column if not exists due_at timestamptz;
    alter table sm_service_cases add column if not exists resolved_at timestamptz;
    alter table sm_service_cases add column if not exists resolved_by uuid;
    alter table sm_service_cases add column if not exists closed_at timestamptz;
    alter table sm_service_cases add column if not exists closed_by uuid;
    alter table sm_service_cases add column if not exists close_code text;
    alter table sm_service_cases add column if not exists close_notes text;
    alter table sm_service_cases add column if not exists parent_id uuid;
    alter table sm_service_cases add column if not exists watch_list jsonb;
    alter table sm_service_cases add column if not exists approval text;
    alter table sm_service_cases add column if not exists escalation integer;
    alter table sm_service_cases add column if not exists reassignment_count integer;
    alter table sm_service_cases add column if not exists reopen_count integer;
    alter table sm_service_cases add column if not exists time_worked bigint;
    alter table sm_service_cases add column if not exists first_response_at timestamptz;
    alter table sm_service_cases add column if not exists active boolean not null default true;
    alter table sm_service_cases add column if not exists sla_due timestamptz;
    alter table sm_service_cases add column if not exists knowledge boolean not null default false;
    alter table sm_service_cases add column if not exists title text;
    alter table sm_service_cases add column if not exists department_id uuid;
    alter table sm_service_cases add column if not exists dept_service_id uuid;
    alter table sm_service_cases add column if not exists sensitive boolean not null default false;
    alter table sm_service_cases add column if not exists journey_id uuid;
    alter table sm_service_cases add column if not exists child_total integer;
    alter table sm_service_cases add column if not exists child_open integer;
    alter table sm_service_cases add column if not exists satisfaction integer;
  end if;
end
$cols$;
create table if not exists sm_service_cases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CAS' || no::text else 'CAS' || lpad(no::text, 7, '0') end) stored,
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
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_cases', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_cases_search_f3bce210_trgm', 'sm_service_cases', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_cases_search_custom_trgm', 'sm_service_cases', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_cases_no_uk on sm_service_cases (org_id, no);
create index if not exists sm_service_cases_rev_idx on sm_service_cases (org_id, rev);
create index if not exists sm_service_cases_upd_idx on sm_service_cases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_cases_crt_idx on sm_service_cases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_cases_state_idx on sm_service_cases (org_id, state) where deleted_at is null;
create index if not exists sm_service_cases_assignment_group_id_idx on sm_service_cases (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_service_cases_assigned_to_idx on sm_service_cases (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_service_cases_department_id_idx on sm_service_cases (org_id, department_id) where deleted_at is null;
create index if not exists sm_service_cases_dept_service_id_idx on sm_service_cases (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_service_cases_workspace_acc_idx on sm_service_cases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_cases_unit_acc_idx on sm_service_cases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_cases_domain_acc_idx on sm_service_cases (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_cases_caller_id_idx on sm_service_cases (org_id, caller_id) where deleted_at is null;
create index if not exists sm_service_cases_requested_for_idx on sm_service_cases (org_id, requested_for) where deleted_at is null;
create index if not exists sm_service_cases_opened_by_idx on sm_service_cases (org_id, opened_by) where deleted_at is null;
create index if not exists sm_service_cases_watch_list_gin on sm_service_cases using gin (watch_list);
create index if not exists sm_service_cases_open_grp_idx on sm_service_cases (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_service_cases_opened_brin on sm_service_cases using brin (opened_at);
drop trigger if exists sm_service_cases_sync on sm_service_cases;
create trigger sm_service_cases_sync before insert or update on sm_service_cases for each row execute function sm_sync_touch('service_case');
create or replace trigger sm_service_cases_demo after insert on sm_service_cases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_cases_demo_t after update or delete on sm_service_cases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_cases enable row level security;

-- service_commitment: تعهدهای خدمت
do $cols$
begin
  if to_regclass('sm_service_commitments') is not null then
    alter table sm_service_commitments add column if not exists workspace_id uuid;
    alter table sm_service_commitments add column if not exists domain_id uuid;
    alter table sm_service_commitments add column if not exists unit_id uuid;
    alter table sm_service_commitments add column if not exists created_at timestamptz not null default now();
    alter table sm_service_commitments add column if not exists created_by uuid;
    alter table sm_service_commitments add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_commitments add column if not exists updated_by uuid;
    alter table sm_service_commitments add column if not exists rev bigint not null default 0;
    alter table sm_service_commitments add column if not exists version integer not null default 1;
    alter table sm_service_commitments add column if not exists deleted_at timestamptz;
    alter table sm_service_commitments add column if not exists origin text;
    alter table sm_service_commitments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_commitments add column if not exists offering_id uuid;
    alter table sm_service_commitments add column if not exists kind text;
    alter table sm_service_commitments add column if not exists target numeric;
    alter table sm_service_commitments add column if not exists priority text;
    alter table sm_service_commitments add column if not exists calendar_id uuid;
    alter table sm_service_commitments add column if not exists valid_from date;
    alter table sm_service_commitments add column if not exists valid_to date;
    alter table sm_service_commitments add column if not exists generate_sla boolean not null default true;
    alter table sm_service_commitments add column if not exists active boolean not null default true;
    alter table sm_service_commitments add column if not exists revision integer;
    alter table sm_service_commitments add column if not exists sla_definition_id uuid;
    alter table sm_service_commitments add column if not exists label text;
    alter table sm_service_commitments add column if not exists owner_id uuid;
  end if;
end
$cols$;
create table if not exists sm_service_commitments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  offering_id uuid,
  kind text,
  target numeric,
  priority text,
  calendar_id uuid,
  valid_from date,
  valid_to date,
  generate_sla boolean not null default true,
  active boolean not null default true,
  revision integer,
  sla_definition_id uuid,
  label text,
  owner_id uuid
);
create index if not exists sm_service_commitments_rev_idx on sm_service_commitments (org_id, rev);
create index if not exists sm_service_commitments_upd_idx on sm_service_commitments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_commitments_crt_idx on sm_service_commitments (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_commitments_offering_id_idx on sm_service_commitments (org_id, offering_id) where deleted_at is null;
create index if not exists sm_service_commitments_workspace_acc_idx on sm_service_commitments (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_commitments_unit_acc_idx on sm_service_commitments (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_commitments_domain_acc_idx on sm_service_commitments (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_commitments_owner_id_idx on sm_service_commitments (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_service_commitments_sync on sm_service_commitments;
create trigger sm_service_commitments_sync before insert or update on sm_service_commitments for each row execute function sm_sync_touch('service_commitment');
create or replace trigger sm_service_commitments_demo after insert on sm_service_commitments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_commitments_demo_t after update or delete on sm_service_commitments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_commitments enable row level security;

-- service_config: تنظیمات سبد خدمات
do $cols$
begin
  if to_regclass('sm_service_configs') is not null then
    alter table sm_service_configs add column if not exists workspace_id uuid;
    alter table sm_service_configs add column if not exists domain_id uuid;
    alter table sm_service_configs add column if not exists unit_id uuid;
    alter table sm_service_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_service_configs add column if not exists created_by uuid;
    alter table sm_service_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_configs add column if not exists updated_by uuid;
    alter table sm_service_configs add column if not exists rev bigint not null default 0;
    alter table sm_service_configs add column if not exists version integer not null default 1;
    alter table sm_service_configs add column if not exists deleted_at timestamptz;
    alter table sm_service_configs add column if not exists origin text;
    alter table sm_service_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_configs add column if not exists name text;
    alter table sm_service_configs add column if not exists config_key text;
    alter table sm_service_configs add column if not exists status_page_title text;
    alter table sm_service_configs add column if not exists notify_subscribers boolean not null default true;
    alter table sm_service_configs add column if not exists status_page_public boolean not null default false;
    alter table sm_service_configs add column if not exists status_page_token text;
    alter table sm_service_configs add column if not exists review_warn_days integer;
    alter table sm_service_configs add column if not exists w_availability integer;
    alter table sm_service_configs add column if not exists w_incidents integer;
    alter table sm_service_configs add column if not exists w_breaches integer;
    alter table sm_service_configs add column if not exists w_csat integer;
    alter table sm_service_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_service_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  status_page_title text,
  notify_subscribers boolean not null default true,
  status_page_public boolean not null default false,
  status_page_token text,
  review_warn_days integer,
  w_availability integer,
  w_incidents integer,
  w_breaches integer,
  w_csat integer,
  seeded integer
);
create index if not exists sm_service_configs_rev_idx on sm_service_configs (org_id, rev);
create index if not exists sm_service_configs_upd_idx on sm_service_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_configs_crt_idx on sm_service_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_service_configs_config_key_uk on sm_service_configs (org_id, config_key) where deleted_at is null;
create index if not exists sm_service_configs_status_page_token_idx on sm_service_configs (org_id, status_page_token) where deleted_at is null;
drop trigger if exists sm_service_configs_sync on sm_service_configs;
create trigger sm_service_configs_sync before insert or update on sm_service_configs for each row execute function sm_sync_touch('service_config');
create or replace trigger sm_service_configs_demo after insert on sm_service_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_configs_demo_t after update or delete on sm_service_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_configs enable row level security;

-- service_design_package: بسته‌های طراحی و گذار
do $cols$
begin
  if to_regclass('sm_service_design_packages') is not null then
    alter table sm_service_design_packages add column if not exists workspace_id uuid;
    alter table sm_service_design_packages add column if not exists domain_id uuid;
    alter table sm_service_design_packages add column if not exists unit_id uuid;
    alter table sm_service_design_packages add column if not exists created_at timestamptz not null default now();
    alter table sm_service_design_packages add column if not exists created_by uuid;
    alter table sm_service_design_packages add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_design_packages add column if not exists updated_by uuid;
    alter table sm_service_design_packages add column if not exists rev bigint not null default 0;
    alter table sm_service_design_packages add column if not exists version integer not null default 1;
    alter table sm_service_design_packages add column if not exists deleted_at timestamptz;
    alter table sm_service_design_packages add column if not exists origin text;
    alter table sm_service_design_packages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_design_packages add column if not exists no integer;
    alter table sm_service_design_packages add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SDT' || no::text else 'SDT' || lpad(no::text, 5, '0') end) stored;
    alter table sm_service_design_packages add column if not exists name text;
    alter table sm_service_design_packages add column if not exists service_id uuid;
    alter table sm_service_design_packages add column if not exists owner_id uuid;
    alter table sm_service_design_packages add column if not exists reviewer_id uuid;
    alter table sm_service_design_packages add column if not exists functional_reqs text;
    alter table sm_service_design_packages add column if not exists nonfunctional_reqs text;
    alter table sm_service_design_packages add column if not exists design_specs text;
    alter table sm_service_design_packages add column if not exists acceptance_criteria text;
    alter table sm_service_design_packages add column if not exists readiness jsonb;
    alter table sm_service_design_packages add column if not exists readiness_pct numeric;
    alter table sm_service_design_packages add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_service_design_packages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SDT' || no::text else 'SDT' || lpad(no::text, 5, '0') end) stored,
  name text,
  service_id uuid,
  owner_id uuid,
  reviewer_id uuid,
  functional_reqs text,
  nonfunctional_reqs text,
  design_specs text,
  acceptance_criteria text,
  readiness jsonb,
  readiness_pct numeric,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_design_packages', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_design_packages_search_56291d9d_trgm', 'sm_service_design_packages', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_design_packages_search_custom_trgm', 'sm_service_design_packages', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_design_packages_no_uk on sm_service_design_packages (org_id, no);
create index if not exists sm_service_design_packages_rev_idx on sm_service_design_packages (org_id, rev);
create index if not exists sm_service_design_packages_upd_idx on sm_service_design_packages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_design_packages_crt_idx on sm_service_design_packages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_design_packages_service_id_idx on sm_service_design_packages (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_design_packages_state_idx on sm_service_design_packages (org_id, state) where deleted_at is null;
create index if not exists sm_service_design_packages_workspace_acc_idx on sm_service_design_packages (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_design_packages_unit_acc_idx on sm_service_design_packages (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_design_packages_domain_acc_idx on sm_service_design_packages (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_design_packages_owner_id_idx on sm_service_design_packages (org_id, owner_id) where deleted_at is null;
create index if not exists sm_service_design_packages_reviewer_id_idx on sm_service_design_packages (org_id, reviewer_id) where deleted_at is null;
drop trigger if exists sm_service_design_packages_sync on sm_service_design_packages;
create trigger sm_service_design_packages_sync before insert or update on sm_service_design_packages for each row execute function sm_sync_touch('service_design_package');
create or replace trigger sm_service_design_packages_demo after insert on sm_service_design_packages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_design_packages_demo_t after update or delete on sm_service_design_packages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_design_packages enable row level security;

-- service_instance: نمونه‌های استقرار خدمت
do $cols$
begin
  if to_regclass('sm_service_instances') is not null then
    alter table sm_service_instances add column if not exists workspace_id uuid;
    alter table sm_service_instances add column if not exists domain_id uuid;
    alter table sm_service_instances add column if not exists unit_id uuid;
    alter table sm_service_instances add column if not exists created_at timestamptz not null default now();
    alter table sm_service_instances add column if not exists created_by uuid;
    alter table sm_service_instances add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_instances add column if not exists updated_by uuid;
    alter table sm_service_instances add column if not exists rev bigint not null default 0;
    alter table sm_service_instances add column if not exists version integer not null default 1;
    alter table sm_service_instances add column if not exists deleted_at timestamptz;
    alter table sm_service_instances add column if not exists origin text;
    alter table sm_service_instances add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_instances add column if not exists name text;
    alter table sm_service_instances add column if not exists service_id uuid;
    alter table sm_service_instances add column if not exists environment text;
    alter table sm_service_instances add column if not exists region text;
    alter table sm_service_instances add column if not exists active boolean not null default true;
    alter table sm_service_instances add column if not exists ci_id uuid;
    alter table sm_service_instances add column if not exists ci_group_id uuid;
    alter table sm_service_instances add column if not exists support_group_id uuid;
    alter table sm_service_instances add column if not exists owner_id uuid;
  end if;
end
$cols$;
create table if not exists sm_service_instances (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  service_id uuid,
  environment text,
  region text,
  active boolean not null default true,
  ci_id uuid,
  ci_group_id uuid,
  support_group_id uuid,
  owner_id uuid
);
create index if not exists sm_service_instances_rev_idx on sm_service_instances (org_id, rev);
create index if not exists sm_service_instances_upd_idx on sm_service_instances (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_instances_crt_idx on sm_service_instances (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_instances_service_id_idx on sm_service_instances (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_instances_workspace_acc_idx on sm_service_instances (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_instances_unit_acc_idx on sm_service_instances (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_instances_domain_acc_idx on sm_service_instances (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_instances_owner_id_idx on sm_service_instances (org_id, owner_id) where deleted_at is null;
create index if not exists sm_service_instances_open_grp_idx on sm_service_instances (org_id, support_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_service_instances_sync on sm_service_instances;
create trigger sm_service_instances_sync before insert or update on sm_service_instances for each row execute function sm_sync_touch('service_instance');
create or replace trigger sm_service_instances_demo after insert on sm_service_instances for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_instances_demo_t after update or delete on sm_service_instances for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_instances enable row level security;

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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_offerings', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_proposals', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:21', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۳ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 23/28 (e746bd22eb04)
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_credits', 'search_6c74edb0', $x$translate(coalesce(period_label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_improvements', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_slm_xla_policies', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_software_models', 'search_b648b2b6', $x$translate(coalesce(name, '') || ' ' || coalesce(product, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_status_reports', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:22', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۴ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 24/28 (e746bd22eb04)
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_suppliers', 'search_cac17606', $x$translate(coalesce(name, '') || ' ' || coalesce(legal_name, '') || ' ' || coalesce(national_id, '') || ' ' || coalesce(economic_code, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_supplier_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_surveys', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_survey_invitations', 'search_7c9c2be2', $x$translate(coalesce(title, '') || ' ' || coalesce(record_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_survey_responses', 'search_9f010d4f', $x$translate(coalesce(title, '') || ' ' || coalesce(record_number, '') || ' ' || coalesce(comment, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_tech_debts', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_todos', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:23', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

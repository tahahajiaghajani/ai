-- «ITSM» migration 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)
-- ---------------------------------------------------------------------------
-- announcement: اطلاعیه‌ها
create table if not exists sm_announcements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_announcements add column if not exists workspace_id uuid;
alter table sm_announcements add column if not exists domain_id uuid;
alter table sm_announcements add column if not exists unit_id uuid;
alter table sm_announcements add column if not exists created_at timestamptz not null default now();
alter table sm_announcements add column if not exists created_by uuid;
alter table sm_announcements add column if not exists updated_at timestamptz not null default now();
alter table sm_announcements add column if not exists updated_by uuid;
alter table sm_announcements add column if not exists rev bigint not null default 0;
alter table sm_announcements add column if not exists version integer not null default 1;
alter table sm_announcements add column if not exists deleted_at timestamptz;
alter table sm_announcements add column if not exists origin text;
alter table sm_announcements add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_announcements add column if not exists no integer;
alter table sm_announcements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ANN' || no::text else 'ANN' || lpad(no::text, 5, '0') end) stored;
alter table sm_announcements add column if not exists title text;
alter table sm_announcements add column if not exists body text;
alter table sm_announcements add column if not exists kind text;
alter table sm_announcements add column if not exists starts_at timestamptz;
alter table sm_announcements add column if not exists ends_at timestamptz;
alter table sm_announcements add column if not exists incident_id uuid;
alter table sm_announcements add column if not exists end_with_incident boolean not null default true;
alter table sm_announcements add column if not exists assignment_group_id uuid;
alter table sm_announcements add column if not exists owner_id uuid;
alter table sm_announcements add column if not exists audience text;
alter table sm_announcements add column if not exists groups jsonb;
alter table sm_announcements add column if not exists units jsonb;
alter table sm_announcements add column if not exists locations jsonb;
alter table sm_announcements add column if not exists users jsonb;
alter table sm_announcements add column if not exists published_at timestamptz;
alter table sm_announcements add column if not exists published_by uuid;
alter table sm_announcements add column if not exists ended_at timestamptz;
alter table sm_announcements add column if not exists state text;
create unique index if not exists sm_announcements_no_uk on sm_announcements (org_id, no);
create index if not exists sm_announcements_rev_idx on sm_announcements (org_id, rev);
create index if not exists sm_announcements_upd_idx on sm_announcements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_announcements_crt_idx on sm_announcements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_announcements_incident_id_idx on sm_announcements (org_id, incident_id) where deleted_at is null;
create index if not exists sm_announcements_assignment_group_id_idx on sm_announcements (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_announcements_state_idx on sm_announcements (org_id, state) where deleted_at is null;
create index if not exists sm_announcements_workspace_acc_idx on sm_announcements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_announcements_unit_acc_idx on sm_announcements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_announcements_domain_acc_idx on sm_announcements (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_announcements_sync on sm_announcements;
create trigger sm_announcements_sync before insert or update on sm_announcements for each row execute function sm_sync_touch('announcement');
alter table sm_announcements enable row level security;

-- approval: تأییدها
create table if not exists sm_approvals (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_approvals add column if not exists workspace_id uuid;
alter table sm_approvals add column if not exists domain_id uuid;
alter table sm_approvals add column if not exists unit_id uuid;
alter table sm_approvals add column if not exists created_at timestamptz not null default now();
alter table sm_approvals add column if not exists created_by uuid;
alter table sm_approvals add column if not exists updated_at timestamptz not null default now();
alter table sm_approvals add column if not exists updated_by uuid;
alter table sm_approvals add column if not exists rev bigint not null default 0;
alter table sm_approvals add column if not exists version integer not null default 1;
alter table sm_approvals add column if not exists deleted_at timestamptz;
alter table sm_approvals add column if not exists origin text;
alter table sm_approvals add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_approvals add column if not exists table_key text;
alter table sm_approvals add column if not exists record_id text;
alter table sm_approvals add column if not exists record_number text;
alter table sm_approvals add column if not exists record_title text;
alter table sm_approvals add column if not exists rule_id uuid;
alter table sm_approvals add column if not exists level integer;
alter table sm_approvals add column if not exists level_name text;
alter table sm_approvals add column if not exists round integer;
alter table sm_approvals add column if not exists approver_id uuid;
alter table sm_approvals add column if not exists group_id uuid;
alter table sm_approvals add column if not exists source text;
alter table sm_approvals add column if not exists rule text;
alter table sm_approvals add column if not exists threshold integer;
alter table sm_approvals add column if not exists state text;
alter table sm_approvals add column if not exists comments text;
alter table sm_approvals add column if not exists due_at timestamptz;
alter table sm_approvals add column if not exists requested_at timestamptz;
alter table sm_approvals add column if not exists requested_by uuid;
alter table sm_approvals add column if not exists decided_at timestamptz;
alter table sm_approvals add column if not exists decided_by uuid;
alter table sm_approvals add column if not exists delegated_from uuid;
alter table sm_approvals add column if not exists reminded_at timestamptz;
create index if not exists sm_approvals_rev_idx on sm_approvals (org_id, rev);
create index if not exists sm_approvals_upd_idx on sm_approvals (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_approvals_crt_idx on sm_approvals (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_approvals_record_id_idx on sm_approvals (org_id, record_id) where deleted_at is null;
create index if not exists sm_approvals_approver_id_idx on sm_approvals (org_id, approver_id) where deleted_at is null;
create index if not exists sm_approvals_state_idx on sm_approvals (org_id, state) where deleted_at is null;
create index if not exists sm_approvals_workspace_acc_idx on sm_approvals (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_approvals_unit_acc_idx on sm_approvals (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_approvals_domain_acc_idx on sm_approvals (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_approvals_delegated_from_idx on sm_approvals (org_id, delegated_from) where deleted_at is null;
drop trigger if exists sm_approvals_sync on sm_approvals;
create trigger sm_approvals_sync before insert or update on sm_approvals for each row execute function sm_sync_touch('approval');
alter table sm_approvals enable row level security;

-- approval_rule: قواعد تأیید
create table if not exists sm_approval_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_approval_rules add column if not exists workspace_id uuid;
alter table sm_approval_rules add column if not exists domain_id uuid;
alter table sm_approval_rules add column if not exists unit_id uuid;
alter table sm_approval_rules add column if not exists created_at timestamptz not null default now();
alter table sm_approval_rules add column if not exists created_by uuid;
alter table sm_approval_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_approval_rules add column if not exists updated_by uuid;
alter table sm_approval_rules add column if not exists rev bigint not null default 0;
alter table sm_approval_rules add column if not exists version integer not null default 1;
alter table sm_approval_rules add column if not exists deleted_at timestamptz;
alter table sm_approval_rules add column if not exists origin text;
alter table sm_approval_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_approval_rules add column if not exists name text;
alter table sm_approval_rules add column if not exists table_key text;
alter table sm_approval_rules add column if not exists condition jsonb;
alter table sm_approval_rules add column if not exists mode text;
alter table sm_approval_rules add column if not exists levels jsonb;
alter table sm_approval_rules add column if not exists auto_approve jsonb;
alter table sm_approval_rules add column if not exists allow_self_approval boolean not null default false;
alter table sm_approval_rules add column if not exists remind_every bigint;
alter table sm_approval_rules add column if not exists expire_after bigint;
alter table sm_approval_rules add column if not exists expire_action text;
alter table sm_approval_rules add column if not exists sort_order integer;
alter table sm_approval_rules add column if not exists active boolean not null default true;
alter table sm_approval_rules add column if not exists description text;
create index if not exists sm_approval_rules_rev_idx on sm_approval_rules (org_id, rev);
create index if not exists sm_approval_rules_upd_idx on sm_approval_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_approval_rules_crt_idx on sm_approval_rules (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_approval_rules_table_key_name_uk on sm_approval_rules (org_id, table_key, name) where deleted_at is null;
drop trigger if exists sm_approval_rules_sync on sm_approval_rules;
create trigger sm_approval_rules_sync before insert or update on sm_approval_rules for each row execute function sm_sync_touch('approval_rule');
alter table sm_approval_rules enable row level security;

-- assignment_rule: قواعد ارجاع
create table if not exists sm_assignment_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_assignment_rules add column if not exists workspace_id uuid;
alter table sm_assignment_rules add column if not exists domain_id uuid;
alter table sm_assignment_rules add column if not exists unit_id uuid;
alter table sm_assignment_rules add column if not exists created_at timestamptz not null default now();
alter table sm_assignment_rules add column if not exists created_by uuid;
alter table sm_assignment_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_assignment_rules add column if not exists updated_by uuid;
alter table sm_assignment_rules add column if not exists rev bigint not null default 0;
alter table sm_assignment_rules add column if not exists version integer not null default 1;
alter table sm_assignment_rules add column if not exists deleted_at timestamptz;
alter table sm_assignment_rules add column if not exists origin text;
alter table sm_assignment_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_assignment_rules add column if not exists name text;
alter table sm_assignment_rules add column if not exists table_key text;
alter table sm_assignment_rules add column if not exists condition jsonb;
alter table sm_assignment_rules add column if not exists group_id uuid;
alter table sm_assignment_rules add column if not exists method text;
alter table sm_assignment_rules add column if not exists user_id uuid;
alter table sm_assignment_rules add column if not exists skills jsonb;
alter table sm_assignment_rules add column if not exists sort_order integer;
alter table sm_assignment_rules add column if not exists active boolean not null default true;
alter table sm_assignment_rules add column if not exists description text;
create index if not exists sm_assignment_rules_rev_idx on sm_assignment_rules (org_id, rev);
create index if not exists sm_assignment_rules_upd_idx on sm_assignment_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_assignment_rules_crt_idx on sm_assignment_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_assignment_rules_sync on sm_assignment_rules;
create trigger sm_assignment_rules_sync before insert or update on sm_assignment_rules for each row execute function sm_sync_touch('assignment_rule');
alter table sm_assignment_rules enable row level security;

-- business_rule: قواعد کسب‌وکار
create table if not exists sm_business_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_business_rules add column if not exists workspace_id uuid;
alter table sm_business_rules add column if not exists domain_id uuid;
alter table sm_business_rules add column if not exists unit_id uuid;
alter table sm_business_rules add column if not exists created_at timestamptz not null default now();
alter table sm_business_rules add column if not exists created_by uuid;
alter table sm_business_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_business_rules add column if not exists updated_by uuid;
alter table sm_business_rules add column if not exists rev bigint not null default 0;
alter table sm_business_rules add column if not exists version integer not null default 1;
alter table sm_business_rules add column if not exists deleted_at timestamptz;
alter table sm_business_rules add column if not exists origin text;
alter table sm_business_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_business_rules add column if not exists name text;
alter table sm_business_rules add column if not exists table_key text;
alter table sm_business_rules add column if not exists timing text;
alter table sm_business_rules add column if not exists events jsonb;
alter table sm_business_rules add column if not exists condition jsonb;
alter table sm_business_rules add column if not exists actions jsonb;
alter table sm_business_rules add column if not exists sort_order integer;
alter table sm_business_rules add column if not exists active boolean not null default true;
alter table sm_business_rules add column if not exists description text;
create index if not exists sm_business_rules_rev_idx on sm_business_rules (org_id, rev);
create index if not exists sm_business_rules_upd_idx on sm_business_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_business_rules_crt_idx on sm_business_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_business_rules_sync on sm_business_rules;
create trigger sm_business_rules_sync before insert or update on sm_business_rules for each row execute function sm_sync_touch('business_rule');
alter table sm_business_rules enable row level security;

-- calendar: تقویم‌های کاری
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_calendars_rev_idx on sm_calendars (org_id, rev);
create index if not exists sm_calendars_upd_idx on sm_calendars (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_calendars_crt_idx on sm_calendars (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_calendars_name_uk on sm_calendars (org_id, name) where deleted_at is null;
drop trigger if exists sm_calendars_sync on sm_calendars;
create trigger sm_calendars_sync before insert or update on sm_calendars for each row execute function sm_sync_touch('calendar');
alter table sm_calendars enable row level security;

-- category: دسته‌بندی‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_categories_rev_idx on sm_categories (org_id, rev);
create index if not exists sm_categories_upd_idx on sm_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_categories_crt_idx on sm_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_categories_parent_id_idx on sm_categories (org_id, parent_id) where deleted_at is null;
create unique index if not exists sm_categories_table_key_value_uk on sm_categories (org_id, table_key, value) where deleted_at is null;
drop trigger if exists sm_categories_sync on sm_categories;
create trigger sm_categories_sync before insert or update on sm_categories for each row execute function sm_sync_touch('category');
alter table sm_categories enable row level security;

-- choice: فهرست‌های گزینه
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_choices_rev_idx on sm_choices (org_id, rev);
create index if not exists sm_choices_upd_idx on sm_choices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_choices_crt_idx on sm_choices (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_choices_list_value_uk on sm_choices (org_id, list, value) where deleted_at is null;
drop trigger if exists sm_choices_sync on sm_choices;
create trigger sm_choices_sync before insert or update on sm_choices for each row execute function sm_sync_touch('choice');
alter table sm_choices enable row level security;

-- corrective_action: اقدام‌های اصلاحی و پیشگیرانه
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
  custom jsonb not null default '{}'::jsonb
);
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
drop trigger if exists sm_corrective_actions_sync on sm_corrective_actions;
create trigger sm_corrective_actions_sync before insert or update on sm_corrective_actions for each row execute function sm_sync_touch('corrective_action');
alter table sm_corrective_actions enable row level security;

-- custom_field: فیلدهای سفارشی
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_custom_fields add column if not exists section text;
alter table sm_custom_fields add column if not exists max_length integer;
alter table sm_custom_fields add column if not exists sort_order integer;
alter table sm_custom_fields add column if not exists active boolean not null default true;
create index if not exists sm_custom_fields_rev_idx on sm_custom_fields (org_id, rev);
create index if not exists sm_custom_fields_upd_idx on sm_custom_fields (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_custom_fields_crt_idx on sm_custom_fields (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_custom_fields_table_key_name_uk on sm_custom_fields (org_id, table_key, name) where deleted_at is null;
drop trigger if exists sm_custom_fields_sync on sm_custom_fields;
create trigger sm_custom_fields_sync before insert or update on sm_custom_fields for each row execute function sm_sync_touch('custom_field');
alter table sm_custom_fields enable row level security;

-- delegation: جانشینی‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_delegations enable row level security;

-- doc_collection: مجموعه‌های اسناد
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_doc_collections_rev_idx on sm_doc_collections (org_id, rev);
create index if not exists sm_doc_collections_upd_idx on sm_doc_collections (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_doc_collections_crt_idx on sm_doc_collections (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_doc_collections_owner_id_idx on sm_doc_collections (org_id, owner_id) where deleted_at is null;
create index if not exists sm_doc_collections_workspace_acc_idx on sm_doc_collections (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_doc_collections_unit_acc_idx on sm_doc_collections (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_doc_collections_domain_acc_idx on sm_doc_collections (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_doc_collections_sync on sm_doc_collections;
create trigger sm_doc_collections_sync before insert or update on sm_doc_collections for each row execute function sm_sync_touch('doc_collection');
alter table sm_doc_collections enable row level security;

-- doc_document: اسناد
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_doc_documents enable row level security;

-- email_channel: کانال‌های ایمیل
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_email_channels_rev_idx on sm_email_channels (org_id, rev);
create index if not exists sm_email_channels_upd_idx on sm_email_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_email_channels_crt_idx on sm_email_channels (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_email_channels_sync on sm_email_channels;
create trigger sm_email_channels_sync before insert or update on sm_email_channels for each row execute function sm_sync_touch('email_channel');
alter table sm_email_channels enable row level security;

-- flow: گردش‌کارها
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_flows_rev_idx on sm_flows (org_id, rev);
create index if not exists sm_flows_upd_idx on sm_flows (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_flows_crt_idx on sm_flows (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_flows_trigger_table_idx on sm_flows (org_id, trigger_table) where deleted_at is null;
create unique index if not exists sm_flows_name_uk on sm_flows (org_id, name) where deleted_at is null;
drop trigger if exists sm_flows_sync on sm_flows;
create trigger sm_flows_sync before insert or update on sm_flows for each row execute function sm_sync_touch('flow');
alter table sm_flows enable row level security;

-- flow_connection: اتصال‌های HTTP
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_flow_connections_rev_idx on sm_flow_connections (org_id, rev);
create index if not exists sm_flow_connections_upd_idx on sm_flow_connections (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_flow_connections_crt_idx on sm_flow_connections (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_flow_connections_name_uk on sm_flow_connections (org_id, name) where deleted_at is null;
drop trigger if exists sm_flow_connections_sync on sm_flow_connections;
create trigger sm_flow_connections_sync before insert or update on sm_flow_connections for each row execute function sm_sync_touch('flow_connection');
alter table sm_flow_connections enable row level security;

-- flow_version: نسخه‌های گردش‌کار
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_flow_versions_rev_idx on sm_flow_versions (org_id, rev);
create index if not exists sm_flow_versions_upd_idx on sm_flow_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_flow_versions_crt_idx on sm_flow_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_flow_versions_flow_id_idx on sm_flow_versions (org_id, flow_id) where deleted_at is null;
create unique index if not exists sm_flow_versions_flow_id_version_no_uk on sm_flow_versions (org_id, flow_id, version_no) where deleted_at is null;
drop trigger if exists sm_flow_versions_sync on sm_flow_versions;
create trigger sm_flow_versions_sync before insert or update on sm_flow_versions for each row execute function sm_sync_touch('flow_version');
alter table sm_flow_versions enable row level security;

-- group: گروه‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_groups add column if not exists description text;
create index if not exists sm_groups_rev_idx on sm_groups (org_id, rev);
create index if not exists sm_groups_upd_idx on sm_groups (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_groups_crt_idx on sm_groups (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_groups_parent_id_idx on sm_groups (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_groups_sync on sm_groups;
create trigger sm_groups_sync before insert or update on sm_groups for each row execute function sm_sync_touch('group');
alter table sm_groups enable row level security;

-- group_member: عضویت‌های گروه
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_group_members enable row level security;

-- holiday: تعطیلات
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_holidays_rev_idx on sm_holidays (org_id, rev);
create index if not exists sm_holidays_upd_idx on sm_holidays (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_holidays_crt_idx on sm_holidays (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_holidays_date_idx on sm_holidays (org_id, date) where deleted_at is null;
create unique index if not exists sm_holidays_holiday_set_date_uk on sm_holidays (org_id, holiday_set, date) where deleted_at is null;
drop trigger if exists sm_holidays_sync on sm_holidays;
create trigger sm_holidays_sync before insert or update on sm_holidays for each row execute function sm_sync_touch('holiday');
alter table sm_holidays enable row level security;

-- incident: رخدادها
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
  custom jsonb not null default '{}'::jsonb
);
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
drop trigger if exists sm_incidents_sync on sm_incidents;
create trigger sm_incidents_sync before insert or update on sm_incidents for each row execute function sm_sync_touch('incident');
alter table sm_incidents enable row level security;

-- incident_config: تنظیمات رخداد
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_incident_configs_rev_idx on sm_incident_configs (org_id, rev);
create index if not exists sm_incident_configs_upd_idx on sm_incident_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_configs_crt_idx on sm_incident_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_incident_configs_config_key_uk on sm_incident_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_incident_configs_sync on sm_incident_configs;
create trigger sm_incident_configs_sync before insert or update on sm_incident_configs for each row execute function sm_sync_touch('incident_config');
alter table sm_incident_configs enable row level security;

-- incident_period_review: بازبینی‌های دوره‌ای رخدادها
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_incident_period_reviews enable row level security;

-- incident_response: پاسخ‌های آماده
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_incident_responses_rev_idx on sm_incident_responses (org_id, rev);
create index if not exists sm_incident_responses_upd_idx on sm_incident_responses (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_responses_crt_idx on sm_incident_responses (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_incident_responses_name_uk on sm_incident_responses (org_id, name) where deleted_at is null;
create index if not exists sm_incident_responses_workspace_acc_idx on sm_incident_responses (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_responses_unit_acc_idx on sm_incident_responses (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_responses_domain_acc_idx on sm_incident_responses (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_incident_responses_sync on sm_incident_responses;
create trigger sm_incident_responses_sync before insert or update on sm_incident_responses for each row execute function sm_sync_touch('incident_response');
alter table sm_incident_responses enable row level security;

-- incident_review: بازبینی‌های پس از رخداد
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_incident_reviews enable row level security;

-- incident_task: کارهای رخداد
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
  custom jsonb not null default '{}'::jsonb
);
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
drop trigger if exists sm_incident_tasks_sync on sm_incident_tasks;
create trigger sm_incident_tasks_sync before insert or update on sm_incident_tasks for each row execute function sm_sync_touch('incident_task');
alter table sm_incident_tasks enable row level security;

-- incident_template: الگوهای رخداد
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_incident_templates_rev_idx on sm_incident_templates (org_id, rev);
create index if not exists sm_incident_templates_upd_idx on sm_incident_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_incident_templates_crt_idx on sm_incident_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_incident_templates_name_uk on sm_incident_templates (org_id, name) where deleted_at is null;
create index if not exists sm_incident_templates_workspace_acc_idx on sm_incident_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_incident_templates_unit_acc_idx on sm_incident_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_incident_templates_domain_acc_idx on sm_incident_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_incident_templates_sync on sm_incident_templates;
create trigger sm_incident_templates_sync before insert or update on sm_incident_templates for each row execute function sm_sync_touch('incident_template');
alter table sm_incident_templates enable row level security;

-- interaction: تعامل‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_interactions enable row level security;

-- kb_ack: تأییدهای مطالعه
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_acks_rev_idx on sm_kb_acks (org_id, rev);
create index if not exists sm_kb_acks_upd_idx on sm_kb_acks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_acks_crt_idx on sm_kb_acks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_acks_attestation_id_idx on sm_kb_acks (org_id, attestation_id) where deleted_at is null;
create index if not exists sm_kb_acks_article_id_idx on sm_kb_acks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_acks_user_id_idx on sm_kb_acks (org_id, user_id) where deleted_at is null;
create unique index if not exists sm_kb_acks_attestation_id_user_id_uk on sm_kb_acks (org_id, attestation_id, user_id) where deleted_at is null;
create index if not exists sm_kb_acks_workspace_acc_idx on sm_kb_acks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_acks_unit_acc_idx on sm_kb_acks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_acks_domain_acc_idx on sm_kb_acks (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_acks_sync on sm_kb_acks;
create trigger sm_kb_acks_sync before insert or update on sm_kb_acks for each row execute function sm_sync_touch('kb_ack');
alter table sm_kb_acks enable row level security;

-- kb_article: مقاله‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_articles add column if not exists state text;
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
create index if not exists sm_kb_articles_state_idx on sm_kb_articles (org_id, state) where deleted_at is null;
create index if not exists sm_kb_articles_workspace_acc_idx on sm_kb_articles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_articles_unit_acc_idx on sm_kb_articles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_articles_domain_acc_idx on sm_kb_articles (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_articles_sync on sm_kb_articles;
create trigger sm_kb_articles_sync before insert or update on sm_kb_articles for each row execute function sm_sync_touch('kb_article');
alter table sm_kb_articles enable row level security;

-- kb_attestation: کارزارهای تأیید مطالعه
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_attestations add column if not exists state text;
create unique index if not exists sm_kb_attestations_no_uk on sm_kb_attestations (org_id, no);
create index if not exists sm_kb_attestations_rev_idx on sm_kb_attestations (org_id, rev);
create index if not exists sm_kb_attestations_upd_idx on sm_kb_attestations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_crt_idx on sm_kb_attestations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_article_id_idx on sm_kb_attestations (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_attestations_owner_id_idx on sm_kb_attestations (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_attestations_state_idx on sm_kb_attestations (org_id, state) where deleted_at is null;
create index if not exists sm_kb_attestations_workspace_acc_idx on sm_kb_attestations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_attestations_unit_acc_idx on sm_kb_attestations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_attestations_domain_acc_idx on sm_kb_attestations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_attestations_sync on sm_kb_attestations;
create trigger sm_kb_attestations_sync before insert or update on sm_kb_attestations for each row execute function sm_sync_touch('kb_attestation');
alter table sm_kb_attestations enable row level security;

-- kb_base: پایگاه‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_bases enable row level security;

-- kb_block: بلوک‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_blocks enable row level security;

-- kb_category: دسته‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_categories add column if not exists state text;
create index if not exists sm_kb_categories_rev_idx on sm_kb_categories (org_id, rev);
create index if not exists sm_kb_categories_upd_idx on sm_kb_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_crt_idx on sm_kb_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_base_id_idx on sm_kb_categories (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_categories_parent_id_idx on sm_kb_categories (org_id, parent_id) where deleted_at is null;
create index if not exists sm_kb_categories_m_groups_gin on sm_kb_categories using gin (m_groups);
create index if not exists sm_kb_categories_state_idx on sm_kb_categories (org_id, state) where deleted_at is null;
drop trigger if exists sm_kb_categories_sync on sm_kb_categories;
create trigger sm_kb_categories_sync before insert or update on sm_kb_categories for each row execute function sm_sync_touch('kb_category');
alter table sm_kb_categories enable row level security;

-- kb_config: تنظیمات دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_configs_rev_idx on sm_kb_configs (org_id, rev);
create index if not exists sm_kb_configs_upd_idx on sm_kb_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_configs_crt_idx on sm_kb_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_configs_config_key_uk on sm_kb_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_kb_configs_sync on sm_kb_configs;
create trigger sm_kb_configs_sync before insert or update on sm_kb_configs for each row execute function sm_sync_touch('kb_config');
alter table sm_kb_configs enable row level security;

-- kb_decision_tree: درخت‌های تصمیم
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_decision_trees add column if not exists access_list jsonb;
alter table sm_kb_decision_trees add column if not exists state text;
create unique index if not exists sm_kb_decision_trees_no_uk on sm_kb_decision_trees (org_id, no);
create index if not exists sm_kb_decision_trees_rev_idx on sm_kb_decision_trees (org_id, rev);
create index if not exists sm_kb_decision_trees_upd_idx on sm_kb_decision_trees (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_crt_idx on sm_kb_decision_trees (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_state_idx on sm_kb_decision_trees (org_id, state) where deleted_at is null;
create index if not exists sm_kb_decision_trees_workspace_acc_idx on sm_kb_decision_trees (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_decision_trees_unit_acc_idx on sm_kb_decision_trees (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_decision_trees_domain_acc_idx on sm_kb_decision_trees (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_kb_decision_trees_owner_id_idx on sm_kb_decision_trees (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_kb_decision_trees_sync on sm_kb_decision_trees;
create trigger sm_kb_decision_trees_sync before insert or update on sm_kb_decision_trees for each row execute function sm_sync_touch('kb_decision_tree');
alter table sm_kb_decision_trees enable row level security;

-- kb_domain: حوزه‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_domains_rev_idx on sm_kb_domains (org_id, rev);
create index if not exists sm_kb_domains_upd_idx on sm_kb_domains (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_domains_crt_idx on sm_kb_domains (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_domains_name_uk on sm_kb_domains (org_id, name) where deleted_at is null;
drop trigger if exists sm_kb_domains_sync on sm_kb_domains;
create trigger sm_kb_domains_sync before insert or update on sm_kb_domains for each row execute function sm_sync_touch('kb_domain');
alter table sm_kb_domains enable row level security;

-- kb_duplicate: مقاله‌های احتمالاً تکراری
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_duplicates_rev_idx on sm_kb_duplicates (org_id, rev);
create index if not exists sm_kb_duplicates_upd_idx on sm_kb_duplicates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_duplicates_crt_idx on sm_kb_duplicates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_duplicates_article_a_idx on sm_kb_duplicates (org_id, article_a) where deleted_at is null;
create index if not exists sm_kb_duplicates_article_b_idx on sm_kb_duplicates (org_id, article_b) where deleted_at is null;
create index if not exists sm_kb_duplicates_state_idx on sm_kb_duplicates (org_id, state) where deleted_at is null;
create unique index if not exists sm_kb_duplicates_pair_key_uk on sm_kb_duplicates (org_id, pair_key) where deleted_at is null;
drop trigger if exists sm_kb_duplicates_sync on sm_kb_duplicates;
create trigger sm_kb_duplicates_sync before insert or update on sm_kb_duplicates for each row execute function sm_sync_touch('kb_duplicate');
alter table sm_kb_duplicates enable row level security;

-- kb_feedback: بازخوردهای مقاله
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_feedback_rev_idx on sm_kb_feedback (org_id, rev);
create index if not exists sm_kb_feedback_upd_idx on sm_kb_feedback (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_crt_idx on sm_kb_feedback (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_article_id_idx on sm_kb_feedback (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_feedback_user_id_idx on sm_kb_feedback (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_feedback_workspace_acc_idx on sm_kb_feedback (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_feedback_unit_acc_idx on sm_kb_feedback (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_feedback_domain_acc_idx on sm_kb_feedback (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_feedback_sync on sm_kb_feedback;
create trigger sm_kb_feedback_sync before insert or update on sm_kb_feedback for each row execute function sm_sync_touch('kb_feedback');
alter table sm_kb_feedback enable row level security;

-- kb_gap: شکاف‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_gaps enable row level security;

-- kb_glossary: واژه‌نامهٔ سازمان
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_glossary_rev_idx on sm_kb_glossary (org_id, rev);
create index if not exists sm_kb_glossary_upd_idx on sm_kb_glossary (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_glossary_crt_idx on sm_kb_glossary (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_glossary_term_uk on sm_kb_glossary (org_id, term) where deleted_at is null;
drop trigger if exists sm_kb_glossary_sync on sm_kb_glossary;
create trigger sm_kb_glossary_sync before insert or update on sm_kb_glossary for each row execute function sm_sync_touch('kb_glossary');
alter table sm_kb_glossary enable row level security;

-- kb_licence: مجوزهای KCS
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_licences_rev_idx on sm_kb_licences (org_id, rev);
create index if not exists sm_kb_licences_upd_idx on sm_kb_licences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_licences_crt_idx on sm_kb_licences (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_licences_user_id_idx on sm_kb_licences (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_licences_state_idx on sm_kb_licences (org_id, state) where deleted_at is null;
drop trigger if exists sm_kb_licences_sync on sm_kb_licences;
create trigger sm_kb_licences_sync before insert or update on sm_kb_licences for each row execute function sm_sync_touch('kb_licence');
alter table sm_kb_licences enable row level security;

-- kb_quality_review: ارزیابی‌های کیفیت (AQI)
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_quality_reviews enable row level security;

-- kb_search_rule: قاعده‌های جست‌وجوی دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_search_rules_rev_idx on sm_kb_search_rules (org_id, rev);
create index if not exists sm_kb_search_rules_upd_idx on sm_kb_search_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_search_rules_crt_idx on sm_kb_search_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_kb_search_rules_sync on sm_kb_search_rules;
create trigger sm_kb_search_rules_sync before insert or update on sm_kb_search_rules for each row execute function sm_sync_touch('kb_search_rule');
alter table sm_kb_search_rules enable row level security;

-- kb_snippet: پاسخ‌های کوتاه
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_snippets add column if not exists access_list jsonb;
alter table sm_kb_snippets add column if not exists state text;
create unique index if not exists sm_kb_snippets_no_uk on sm_kb_snippets (org_id, no);
create index if not exists sm_kb_snippets_rev_idx on sm_kb_snippets (org_id, rev);
create index if not exists sm_kb_snippets_upd_idx on sm_kb_snippets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_crt_idx on sm_kb_snippets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_base_id_idx on sm_kb_snippets (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_snippets_owner_id_idx on sm_kb_snippets (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_snippets_state_idx on sm_kb_snippets (org_id, state) where deleted_at is null;
create index if not exists sm_kb_snippets_workspace_acc_idx on sm_kb_snippets (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_snippets_unit_acc_idx on sm_kb_snippets (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_snippets_domain_acc_idx on sm_kb_snippets (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_snippets_sync on sm_kb_snippets;
create trigger sm_kb_snippets_sync before insert or update on sm_kb_snippets for each row execute function sm_sync_touch('kb_snippet');
alter table sm_kb_snippets enable row level security;

-- kb_subscription: اشتراک‌های دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_subscriptions enable row level security;

-- kb_task: کارهای دانش
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
  custom jsonb not null default '{}'::jsonb
);
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
create unique index if not exists sm_kb_tasks_no_uk on sm_kb_tasks (org_id, no);
create index if not exists sm_kb_tasks_rev_idx on sm_kb_tasks (org_id, rev);
create index if not exists sm_kb_tasks_upd_idx on sm_kb_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_crt_idx on sm_kb_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_state_idx on sm_kb_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_kb_tasks_assignment_group_id_idx on sm_kb_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_kb_tasks_assigned_to_idx on sm_kb_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_kb_tasks_article_id_idx on sm_kb_tasks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_tasks_source_id_idx on sm_kb_tasks (org_id, source_id) where deleted_at is null;
create index if not exists sm_kb_tasks_workspace_acc_idx on sm_kb_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_tasks_unit_acc_idx on sm_kb_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_tasks_domain_acc_idx on sm_kb_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_kb_tasks_caller_id_idx on sm_kb_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_kb_tasks_requested_for_idx on sm_kb_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_kb_tasks_opened_by_idx on sm_kb_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_kb_tasks_watch_list_gin on sm_kb_tasks using gin (watch_list);
drop trigger if exists sm_kb_tasks_sync on sm_kb_tasks;
create trigger sm_kb_tasks_sync before insert or update on sm_kb_tasks for each row execute function sm_sync_touch('kb_task');
alter table sm_kb_tasks enable row level security;

-- kb_template: قالب‌های مقاله
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_kb_templates_rev_idx on sm_kb_templates (org_id, rev);
create index if not exists sm_kb_templates_upd_idx on sm_kb_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_templates_crt_idx on sm_kb_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_templates_name_uk on sm_kb_templates (org_id, name) where deleted_at is null;
drop trigger if exists sm_kb_templates_sync on sm_kb_templates;
create trigger sm_kb_templates_sync before insert or update on sm_kb_templates for each row execute function sm_sync_touch('kb_template');
alter table sm_kb_templates enable row level security;

-- kb_version: نسخه‌های مقاله
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_kb_versions add column if not exists state text;
create index if not exists sm_kb_versions_rev_idx on sm_kb_versions (org_id, rev);
create index if not exists sm_kb_versions_upd_idx on sm_kb_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_crt_idx on sm_kb_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_article_id_idx on sm_kb_versions (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_versions_author_id_idx on sm_kb_versions (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_versions_reviewer_ids_gin on sm_kb_versions using gin (reviewer_ids);
create index if not exists sm_kb_versions_state_idx on sm_kb_versions (org_id, state) where deleted_at is null;
create index if not exists sm_kb_versions_workspace_acc_idx on sm_kb_versions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_versions_unit_acc_idx on sm_kb_versions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_versions_domain_acc_idx on sm_kb_versions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_versions_sync on sm_kb_versions;
create trigger sm_kb_versions_sync before insert or update on sm_kb_versions for each row execute function sm_sync_touch('kb_version');
alter table sm_kb_versions enable row level security;

-- known_error: خطاهای شناخته‌شده
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_known_errors enable row level security;

-- location: مکان‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_locations_rev_idx on sm_locations (org_id, rev);
create index if not exists sm_locations_upd_idx on sm_locations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_locations_crt_idx on sm_locations (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_locations_code_uk on sm_locations (org_id, code) where deleted_at is null;
create index if not exists sm_locations_parent_id_idx on sm_locations (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_locations_sync on sm_locations;
create trigger sm_locations_sync before insert or update on sm_locations for each row execute function sm_sync_touch('location');
alter table sm_locations enable row level security;

-- member_profile: نمایه‌های اعضا
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_member_profiles enable row level security;

-- notification: اعلان‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_notifications_rev_idx on sm_notifications (org_id, rev);
create index if not exists sm_notifications_upd_idx on sm_notifications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notifications_crt_idx on sm_notifications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_notifications_workspace_acc_idx on sm_notifications (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_notifications_unit_acc_idx on sm_notifications (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_notifications_domain_acc_idx on sm_notifications (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_notifications_user_id_idx on sm_notifications (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_notifications_sync on sm_notifications;
create trigger sm_notifications_sync before insert or update on sm_notifications for each row execute function sm_sync_touch('notification');
alter table sm_notifications enable row level security;

-- notification_channel: کانال‌های پیام
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_notification_channels_rev_idx on sm_notification_channels (org_id, rev);
create index if not exists sm_notification_channels_upd_idx on sm_notification_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_channels_crt_idx on sm_notification_channels (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_notification_channels_sync on sm_notification_channels;
create trigger sm_notification_channels_sync before insert or update on sm_notification_channels for each row execute function sm_sync_touch('notification_channel');
alter table sm_notification_channels enable row level security;

-- notification_pref: تنظیمات اعلان
create table if not exists sm_notification_prefs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_notification_prefs add column if not exists workspace_id uuid;
alter table sm_notification_prefs add column if not exists domain_id uuid;
alter table sm_notification_prefs add column if not exists unit_id uuid;
alter table sm_notification_prefs add column if not exists created_at timestamptz not null default now();
alter table sm_notification_prefs add column if not exists created_by uuid;
alter table sm_notification_prefs add column if not exists updated_at timestamptz not null default now();
alter table sm_notification_prefs add column if not exists updated_by uuid;
alter table sm_notification_prefs add column if not exists rev bigint not null default 0;
alter table sm_notification_prefs add column if not exists version integer not null default 1;
alter table sm_notification_prefs add column if not exists deleted_at timestamptz;
alter table sm_notification_prefs add column if not exists origin text;
alter table sm_notification_prefs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_notification_prefs add column if not exists user_id uuid;
alter table sm_notification_prefs add column if not exists optouts jsonb;
alter table sm_notification_prefs add column if not exists digest text;
alter table sm_notification_prefs add column if not exists digest_hour integer;
alter table sm_notification_prefs add column if not exists quiet_from text;
alter table sm_notification_prefs add column if not exists quiet_to text;
alter table sm_notification_prefs add column if not exists read_before timestamptz;
create index if not exists sm_notification_prefs_rev_idx on sm_notification_prefs (org_id, rev);
create index if not exists sm_notification_prefs_upd_idx on sm_notification_prefs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_prefs_crt_idx on sm_notification_prefs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_notification_prefs_user_id_uk on sm_notification_prefs (org_id, user_id) where deleted_at is null;
create index if not exists sm_notification_prefs_workspace_acc_idx on sm_notification_prefs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_notification_prefs_unit_acc_idx on sm_notification_prefs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_notification_prefs_domain_acc_idx on sm_notification_prefs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_notification_prefs_user_id_idx on sm_notification_prefs (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_notification_prefs_sync on sm_notification_prefs;
create trigger sm_notification_prefs_sync before insert or update on sm_notification_prefs for each row execute function sm_sync_touch('notification_pref');
alter table sm_notification_prefs enable row level security;

-- notification_rule: قانون‌های اعلان
create table if not exists sm_notification_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_notification_rules add column if not exists workspace_id uuid;
alter table sm_notification_rules add column if not exists domain_id uuid;
alter table sm_notification_rules add column if not exists unit_id uuid;
alter table sm_notification_rules add column if not exists created_at timestamptz not null default now();
alter table sm_notification_rules add column if not exists created_by uuid;
alter table sm_notification_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_notification_rules add column if not exists updated_by uuid;
alter table sm_notification_rules add column if not exists rev bigint not null default 0;
alter table sm_notification_rules add column if not exists version integer not null default 1;
alter table sm_notification_rules add column if not exists deleted_at timestamptz;
alter table sm_notification_rules add column if not exists origin text;
alter table sm_notification_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_notification_rules add column if not exists name text;
alter table sm_notification_rules add column if not exists active boolean not null default true;
alter table sm_notification_rules add column if not exists mandatory boolean not null default false;
alter table sm_notification_rules add column if not exists table_key text;
alter table sm_notification_rules add column if not exists event text;
alter table sm_notification_rules add column if not exists custom_event text;
alter table sm_notification_rules add column if not exists entry_kinds jsonb;
alter table sm_notification_rules add column if not exists condition jsonb;
alter table sm_notification_rules add column if not exists recipients jsonb;
alter table sm_notification_rules add column if not exists notify_actor boolean not null default false;
alter table sm_notification_rules add column if not exists channels jsonb;
alter table sm_notification_rules add column if not exists targets jsonb;
alter table sm_notification_rules add column if not exists template_id uuid;
alter table sm_notification_rules add column if not exists digest boolean not null default true;
alter table sm_notification_rules add column if not exists builtin text;
alter table sm_notification_rules add column if not exists description text;
create index if not exists sm_notification_rules_rev_idx on sm_notification_rules (org_id, rev);
create index if not exists sm_notification_rules_upd_idx on sm_notification_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_rules_crt_idx on sm_notification_rules (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_notification_rules_builtin_uk on sm_notification_rules (org_id, builtin) where deleted_at is null;
drop trigger if exists sm_notification_rules_sync on sm_notification_rules;
create trigger sm_notification_rules_sync before insert or update on sm_notification_rules for each row execute function sm_sync_touch('notification_rule');
alter table sm_notification_rules enable row level security;

-- notification_template: الگوهای اعلان
create table if not exists sm_notification_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_notification_templates add column if not exists workspace_id uuid;
alter table sm_notification_templates add column if not exists domain_id uuid;
alter table sm_notification_templates add column if not exists unit_id uuid;
alter table sm_notification_templates add column if not exists created_at timestamptz not null default now();
alter table sm_notification_templates add column if not exists created_by uuid;
alter table sm_notification_templates add column if not exists updated_at timestamptz not null default now();
alter table sm_notification_templates add column if not exists updated_by uuid;
alter table sm_notification_templates add column if not exists rev bigint not null default 0;
alter table sm_notification_templates add column if not exists version integer not null default 1;
alter table sm_notification_templates add column if not exists deleted_at timestamptz;
alter table sm_notification_templates add column if not exists origin text;
alter table sm_notification_templates add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_notification_templates add column if not exists name text;
alter table sm_notification_templates add column if not exists event text;
alter table sm_notification_templates add column if not exists table_key text;
alter table sm_notification_templates add column if not exists subject text;
alter table sm_notification_templates add column if not exists body text;
alter table sm_notification_templates add column if not exists short_text text;
alter table sm_notification_templates add column if not exists active boolean not null default true;
alter table sm_notification_templates add column if not exists description text;
create index if not exists sm_notification_templates_rev_idx on sm_notification_templates (org_id, rev);
create index if not exists sm_notification_templates_upd_idx on sm_notification_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_templates_crt_idx on sm_notification_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_notification_templates_sync on sm_notification_templates;
create trigger sm_notification_templates_sync before insert or update on sm_notification_templates for each row execute function sm_sync_touch('notification_template');
alter table sm_notification_templates enable row level security;

-- org_unit: واحدهای سازمانی
create table if not exists sm_org_units (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_org_units add column if not exists workspace_id uuid;
alter table sm_org_units add column if not exists domain_id uuid;
alter table sm_org_units add column if not exists unit_id uuid;
alter table sm_org_units add column if not exists created_at timestamptz not null default now();
alter table sm_org_units add column if not exists created_by uuid;
alter table sm_org_units add column if not exists updated_at timestamptz not null default now();
alter table sm_org_units add column if not exists updated_by uuid;
alter table sm_org_units add column if not exists rev bigint not null default 0;
alter table sm_org_units add column if not exists version integer not null default 1;
alter table sm_org_units add column if not exists deleted_at timestamptz;
alter table sm_org_units add column if not exists origin text;
alter table sm_org_units add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_org_units add column if not exists name text;
alter table sm_org_units add column if not exists code text;
alter table sm_org_units add column if not exists kind text;
alter table sm_org_units add column if not exists parent_id uuid;
alter table sm_org_units add column if not exists manager_id uuid;
alter table sm_org_units add column if not exists location_id uuid;
alter table sm_org_units add column if not exists is_domain boolean not null default false;
alter table sm_org_units add column if not exists active boolean not null default true;
alter table sm_org_units add column if not exists description text;
alter table sm_org_units add column if not exists path text;
alter table sm_org_units add column if not exists depth integer;
create index if not exists sm_org_units_rev_idx on sm_org_units (org_id, rev);
create index if not exists sm_org_units_upd_idx on sm_org_units (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_org_units_crt_idx on sm_org_units (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_org_units_code_uk on sm_org_units (org_id, code) where deleted_at is null;
create index if not exists sm_org_units_parent_id_idx on sm_org_units (org_id, parent_id) where deleted_at is null;
create index if not exists sm_org_units_manager_id_idx on sm_org_units (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_org_units_sync on sm_org_units;
create trigger sm_org_units_sync before insert or update on sm_org_units for each row execute function sm_sync_touch('org_unit');
alter table sm_org_units enable row level security;

-- priority_matrix: ماتریس‌های اولویت
create table if not exists sm_priority_matrices (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_priority_matrices add column if not exists workspace_id uuid;
alter table sm_priority_matrices add column if not exists domain_id uuid;
alter table sm_priority_matrices add column if not exists unit_id uuid;
alter table sm_priority_matrices add column if not exists created_at timestamptz not null default now();
alter table sm_priority_matrices add column if not exists created_by uuid;
alter table sm_priority_matrices add column if not exists updated_at timestamptz not null default now();
alter table sm_priority_matrices add column if not exists updated_by uuid;
alter table sm_priority_matrices add column if not exists rev bigint not null default 0;
alter table sm_priority_matrices add column if not exists version integer not null default 1;
alter table sm_priority_matrices add column if not exists deleted_at timestamptz;
alter table sm_priority_matrices add column if not exists origin text;
alter table sm_priority_matrices add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_priority_matrices add column if not exists name text;
alter table sm_priority_matrices add column if not exists table_key text;
alter table sm_priority_matrices add column if not exists impact_field text;
alter table sm_priority_matrices add column if not exists urgency_field text;
alter table sm_priority_matrices add column if not exists priority_field text;
alter table sm_priority_matrices add column if not exists cells jsonb;
alter table sm_priority_matrices add column if not exists active boolean not null default true;
alter table sm_priority_matrices add column if not exists description text;
create index if not exists sm_priority_matrices_rev_idx on sm_priority_matrices (org_id, rev);
create index if not exists sm_priority_matrices_upd_idx on sm_priority_matrices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_priority_matrices_crt_idx on sm_priority_matrices (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_priority_matrices_table_key_uk on sm_priority_matrices (org_id, table_key) where deleted_at is null;
drop trigger if exists sm_priority_matrices_sync on sm_priority_matrices;
create trigger sm_priority_matrices_sync before insert or update on sm_priority_matrices for each row execute function sm_sync_touch('priority_matrix');
alter table sm_priority_matrices enable row level security;

-- problem: مشکلات
create table if not exists sm_problems (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_problems add column if not exists workspace_id uuid;
alter table sm_problems add column if not exists domain_id uuid;
alter table sm_problems add column if not exists unit_id uuid;
alter table sm_problems add column if not exists created_at timestamptz not null default now();
alter table sm_problems add column if not exists created_by uuid;
alter table sm_problems add column if not exists updated_at timestamptz not null default now();
alter table sm_problems add column if not exists updated_by uuid;
alter table sm_problems add column if not exists rev bigint not null default 0;
alter table sm_problems add column if not exists version integer not null default 1;
alter table sm_problems add column if not exists deleted_at timestamptz;
alter table sm_problems add column if not exists origin text;
alter table sm_problems add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problems add column if not exists no integer;
alter table sm_problems add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PRB' || no::text else 'PRB' || lpad(no::text, 7, '0') end) stored;
alter table sm_problems add column if not exists short_description text;
alter table sm_problems add column if not exists description text;
alter table sm_problems add column if not exists state text;
alter table sm_problems add column if not exists priority text;
alter table sm_problems add column if not exists impact text;
alter table sm_problems add column if not exists urgency text;
alter table sm_problems add column if not exists category text;
alter table sm_problems add column if not exists subcategory text;
alter table sm_problems add column if not exists channel text;
alter table sm_problems add column if not exists caller_id uuid;
alter table sm_problems add column if not exists requested_for uuid;
alter table sm_problems add column if not exists opened_by uuid;
alter table sm_problems add column if not exists opened_at timestamptz;
alter table sm_problems add column if not exists assignment_group_id uuid;
alter table sm_problems add column if not exists assigned_to uuid;
alter table sm_problems add column if not exists service_id uuid;
alter table sm_problems add column if not exists offering_id uuid;
alter table sm_problems add column if not exists ci_id uuid;
alter table sm_problems add column if not exists location_id uuid;
alter table sm_problems add column if not exists due_at timestamptz;
alter table sm_problems add column if not exists resolved_at timestamptz;
alter table sm_problems add column if not exists resolved_by uuid;
alter table sm_problems add column if not exists closed_at timestamptz;
alter table sm_problems add column if not exists closed_by uuid;
alter table sm_problems add column if not exists close_code text;
alter table sm_problems add column if not exists close_notes text;
alter table sm_problems add column if not exists parent_id uuid;
alter table sm_problems add column if not exists watch_list jsonb;
alter table sm_problems add column if not exists approval text;
alter table sm_problems add column if not exists escalation integer;
alter table sm_problems add column if not exists reassignment_count integer;
alter table sm_problems add column if not exists reopen_count integer;
alter table sm_problems add column if not exists time_worked bigint;
alter table sm_problems add column if not exists first_response_at timestamptz;
alter table sm_problems add column if not exists active boolean not null default true;
alter table sm_problems add column if not exists sla_due timestamptz;
alter table sm_problems add column if not exists knowledge boolean not null default false;
alter table sm_problems add column if not exists source text;
alter table sm_problems add column if not exists proactive boolean not null default false;
alter table sm_problems add column if not exists investigation_reason text;
alter table sm_problems add column if not exists likelihood text;
alter table sm_problems add column if not exists risk_score integer;
alter table sm_problems add column if not exists manager_id uuid;
alter table sm_problems add column if not exists pending_reason text;
alter table sm_problems add column if not exists affected_services jsonb;
alter table sm_problems add column if not exists affected_cis jsonb;
alter table sm_problems add column if not exists first_incident_id uuid;
alter table sm_problems add column if not exists template_id uuid;
alter table sm_problems add column if not exists symptoms text;
alter table sm_problems add column if not exists workaround text;
alter table sm_problems add column if not exists cause_code text;
alter table sm_problems add column if not exists rca_method text;
alter table sm_problems add column if not exists rca_sections jsonb;
alter table sm_problems add column if not exists contributing_factors jsonb;
alter table sm_problems add column if not exists cause_notes text;
alter table sm_problems add column if not exists fix_notes text;
alter table sm_problems add column if not exists rca jsonb;
alter table sm_problems add column if not exists duplicate_of uuid;
alter table sm_problems add column if not exists known_error boolean not null default false;
alter table sm_problems add column if not exists target_date date;
alter table sm_problems add column if not exists review_date date;
alter table sm_problems add column if not exists incident_count integer;
alter table sm_problems add column if not exists tech_debt integer;
alter table sm_problems add column if not exists rca_at timestamptz;
alter table sm_problems add column if not exists workaround_at timestamptz;
alter table sm_problems add column if not exists fix_at timestamptz;
alter table sm_problems add column if not exists monitoring_until date;
alter table sm_problems add column if not exists time_to_rca bigint;
alter table sm_problems add column if not exists time_to_fix bigint;
alter table sm_problems add column if not exists last_activity_at timestamptz;
alter table sm_problems add column if not exists shared jsonb;
alter table sm_problems add column if not exists reminded_at timestamptz;
alter table sm_problems add column if not exists monitoring_done boolean not null default false;
alter table sm_problems add column if not exists confidential boolean not null default false;
alter table sm_problems add column if not exists access_list jsonb;
create unique index if not exists sm_problems_no_uk on sm_problems (org_id, no);
create index if not exists sm_problems_rev_idx on sm_problems (org_id, rev);
create index if not exists sm_problems_upd_idx on sm_problems (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problems_crt_idx on sm_problems (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_problems_state_idx on sm_problems (org_id, state) where deleted_at is null;
create index if not exists sm_problems_assignment_group_id_idx on sm_problems (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_problems_assigned_to_idx on sm_problems (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problems_manager_id_idx on sm_problems (org_id, manager_id) where deleted_at is null;
create index if not exists sm_problems_workspace_acc_idx on sm_problems (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problems_unit_acc_idx on sm_problems (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problems_domain_acc_idx on sm_problems (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_problems_caller_id_idx on sm_problems (org_id, caller_id) where deleted_at is null;
create index if not exists sm_problems_requested_for_idx on sm_problems (org_id, requested_for) where deleted_at is null;
create index if not exists sm_problems_opened_by_idx on sm_problems (org_id, opened_by) where deleted_at is null;
create index if not exists sm_problems_watch_list_gin on sm_problems using gin (watch_list);
drop trigger if exists sm_problems_sync on sm_problems;
create trigger sm_problems_sync before insert or update on sm_problems for each row execute function sm_sync_touch('problem');
alter table sm_problems enable row level security;

-- problem_candidate: نامزدهای مشکل
create table if not exists sm_problem_candidates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_problem_candidates add column if not exists workspace_id uuid;
alter table sm_problem_candidates add column if not exists domain_id uuid;
alter table sm_problem_candidates add column if not exists unit_id uuid;
alter table sm_problem_candidates add column if not exists created_at timestamptz not null default now();
alter table sm_problem_candidates add column if not exists created_by uuid;
alter table sm_problem_candidates add column if not exists updated_at timestamptz not null default now();
alter table sm_problem_candidates add column if not exists updated_by uuid;
alter table sm_problem_candidates add column if not exists rev bigint not null default 0;
alter table sm_problem_candidates add column if not exists version integer not null default 1;
alter table sm_problem_candidates add column if not exists deleted_at timestamptz;
alter table sm_problem_candidates add column if not exists origin text;
alter table sm_problem_candidates add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problem_candidates add column if not exists no integer;
alter table sm_problem_candidates add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PCN' || no::text else 'PCN' || lpad(no::text, 6, '0') end) stored;
alter table sm_problem_candidates add column if not exists title text;
alter table sm_problem_candidates add column if not exists rule_kind text;
alter table sm_problem_candidates add column if not exists score integer;
alter table sm_problem_candidates add column if not exists assigned_to uuid;
alter table sm_problem_candidates add column if not exists incidents jsonb;
alter table sm_problem_candidates add column if not exists incident_count integer;
alter table sm_problem_candidates add column if not exists first_at timestamptz;
alter table sm_problem_candidates add column if not exists last_at timestamptz;
alter table sm_problem_candidates add column if not exists category text;
alter table sm_problem_candidates add column if not exists ci_id uuid;
alter table sm_problem_candidates add column if not exists service_id uuid;
alter table sm_problem_candidates add column if not exists signature text;
alter table sm_problem_candidates add column if not exists problem_id uuid;
alter table sm_problem_candidates add column if not exists review_notes text;
alter table sm_problem_candidates add column if not exists state text;
create unique index if not exists sm_problem_candidates_no_uk on sm_problem_candidates (org_id, no);
create index if not exists sm_problem_candidates_rev_idx on sm_problem_candidates (org_id, rev);
create index if not exists sm_problem_candidates_upd_idx on sm_problem_candidates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_candidates_crt_idx on sm_problem_candidates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_candidates_assigned_to_idx on sm_problem_candidates (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problem_candidates_signature_idx on sm_problem_candidates (org_id, signature) where deleted_at is null;
create index if not exists sm_problem_candidates_state_idx on sm_problem_candidates (org_id, state) where deleted_at is null;
create index if not exists sm_problem_candidates_workspace_acc_idx on sm_problem_candidates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_candidates_unit_acc_idx on sm_problem_candidates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_candidates_domain_acc_idx on sm_problem_candidates (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_problem_candidates_sync on sm_problem_candidates;
create trigger sm_problem_candidates_sync before insert or update on sm_problem_candidates for each row execute function sm_sync_touch('problem_candidate');
alter table sm_problem_candidates enable row level security;

-- problem_config: تنظیمات مشکل
create table if not exists sm_problem_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_problem_configs add column if not exists workspace_id uuid;
alter table sm_problem_configs add column if not exists domain_id uuid;
alter table sm_problem_configs add column if not exists unit_id uuid;
alter table sm_problem_configs add column if not exists created_at timestamptz not null default now();
alter table sm_problem_configs add column if not exists created_by uuid;
alter table sm_problem_configs add column if not exists updated_at timestamptz not null default now();
alter table sm_problem_configs add column if not exists updated_by uuid;
alter table sm_problem_configs add column if not exists rev bigint not null default 0;
alter table sm_problem_configs add column if not exists version integer not null default 1;
alter table sm_problem_configs add column if not exists deleted_at timestamptz;
alter table sm_problem_configs add column if not exists origin text;
alter table sm_problem_configs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problem_configs add column if not exists name text;
alter table sm_problem_configs add column if not exists config_key text;
alter table sm_problem_configs add column if not exists inactivity_days integer;
alter table sm_problem_configs add column if not exists monitoring_days integer;
alter table sm_problem_configs add column if not exists ke_review_days integer;
alter table sm_problem_configs add column if not exists candidate_window_days integer;
alter table sm_problem_configs add column if not exists candidate_min_incidents integer;
alter table sm_problem_configs add column if not exists candidate_reopen_min integer;
alter table sm_problem_configs add column if not exists close_requires_incident boolean not null default false;
alter table sm_problem_configs add column if not exists resolve_waiting_incidents boolean not null default true;
alter table sm_problem_configs add column if not exists seeded integer;
create index if not exists sm_problem_configs_rev_idx on sm_problem_configs (org_id, rev);
create index if not exists sm_problem_configs_upd_idx on sm_problem_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_configs_crt_idx on sm_problem_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_problem_configs_config_key_uk on sm_problem_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_problem_configs_sync on sm_problem_configs;
create trigger sm_problem_configs_sync before insert or update on sm_problem_configs for each row execute function sm_sync_touch('problem_config');
alter table sm_problem_configs enable row level security;

-- problem_task: کارهای مشکل
create table if not exists sm_problem_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_problem_tasks add column if not exists workspace_id uuid;
alter table sm_problem_tasks add column if not exists domain_id uuid;
alter table sm_problem_tasks add column if not exists unit_id uuid;
alter table sm_problem_tasks add column if not exists created_at timestamptz not null default now();
alter table sm_problem_tasks add column if not exists created_by uuid;
alter table sm_problem_tasks add column if not exists updated_at timestamptz not null default now();
alter table sm_problem_tasks add column if not exists updated_by uuid;
alter table sm_problem_tasks add column if not exists rev bigint not null default 0;
alter table sm_problem_tasks add column if not exists version integer not null default 1;
alter table sm_problem_tasks add column if not exists deleted_at timestamptz;
alter table sm_problem_tasks add column if not exists origin text;
alter table sm_problem_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problem_tasks add column if not exists no integer;
alter table sm_problem_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored;
alter table sm_problem_tasks add column if not exists short_description text;
alter table sm_problem_tasks add column if not exists description text;
alter table sm_problem_tasks add column if not exists state text;
alter table sm_problem_tasks add column if not exists priority text;
alter table sm_problem_tasks add column if not exists impact text;
alter table sm_problem_tasks add column if not exists urgency text;
alter table sm_problem_tasks add column if not exists category text;
alter table sm_problem_tasks add column if not exists subcategory text;
alter table sm_problem_tasks add column if not exists channel text;
alter table sm_problem_tasks add column if not exists caller_id uuid;
alter table sm_problem_tasks add column if not exists requested_for uuid;
alter table sm_problem_tasks add column if not exists opened_by uuid;
alter table sm_problem_tasks add column if not exists opened_at timestamptz;
alter table sm_problem_tasks add column if not exists assignment_group_id uuid;
alter table sm_problem_tasks add column if not exists assigned_to uuid;
alter table sm_problem_tasks add column if not exists service_id uuid;
alter table sm_problem_tasks add column if not exists offering_id uuid;
alter table sm_problem_tasks add column if not exists ci_id uuid;
alter table sm_problem_tasks add column if not exists location_id uuid;
alter table sm_problem_tasks add column if not exists due_at timestamptz;
alter table sm_problem_tasks add column if not exists resolved_at timestamptz;
alter table sm_problem_tasks add column if not exists resolved_by uuid;
alter table sm_problem_tasks add column if not exists closed_at timestamptz;
alter table sm_problem_tasks add column if not exists closed_by uuid;
alter table sm_problem_tasks add column if not exists close_code text;
alter table sm_problem_tasks add column if not exists close_notes text;
alter table sm_problem_tasks add column if not exists parent_id uuid;
alter table sm_problem_tasks add column if not exists watch_list jsonb;
alter table sm_problem_tasks add column if not exists approval text;
alter table sm_problem_tasks add column if not exists escalation integer;
alter table sm_problem_tasks add column if not exists reassignment_count integer;
alter table sm_problem_tasks add column if not exists reopen_count integer;
alter table sm_problem_tasks add column if not exists time_worked bigint;
alter table sm_problem_tasks add column if not exists first_response_at timestamptz;
alter table sm_problem_tasks add column if not exists active boolean not null default true;
alter table sm_problem_tasks add column if not exists sla_due timestamptz;
alter table sm_problem_tasks add column if not exists knowledge boolean not null default false;
alter table sm_problem_tasks add column if not exists problem_id uuid;
alter table sm_problem_tasks add column if not exists task_type text;
alter table sm_problem_tasks add column if not exists mandatory boolean not null default true;
alter table sm_problem_tasks add column if not exists findings text;
create unique index if not exists sm_problem_tasks_no_uk on sm_problem_tasks (org_id, no);
create index if not exists sm_problem_tasks_rev_idx on sm_problem_tasks (org_id, rev);
create index if not exists sm_problem_tasks_upd_idx on sm_problem_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_tasks_crt_idx on sm_problem_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_tasks_state_idx on sm_problem_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_problem_tasks_assignment_group_id_idx on sm_problem_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_problem_tasks_assigned_to_idx on sm_problem_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problem_tasks_problem_id_idx on sm_problem_tasks (org_id, problem_id) where deleted_at is null;
create index if not exists sm_problem_tasks_workspace_acc_idx on sm_problem_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_tasks_unit_acc_idx on sm_problem_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_tasks_domain_acc_idx on sm_problem_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_problem_tasks_caller_id_idx on sm_problem_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_problem_tasks_requested_for_idx on sm_problem_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_problem_tasks_opened_by_idx on sm_problem_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_problem_tasks_watch_list_gin on sm_problem_tasks using gin (watch_list);
drop trigger if exists sm_problem_tasks_sync on sm_problem_tasks;
create trigger sm_problem_tasks_sync before insert or update on sm_problem_tasks for each row execute function sm_sync_touch('problem_task');
alter table sm_problem_tasks enable row level security;

-- problem_template: الگوهای مشکل
create table if not exists sm_problem_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_problem_templates add column if not exists workspace_id uuid;
alter table sm_problem_templates add column if not exists domain_id uuid;
alter table sm_problem_templates add column if not exists unit_id uuid;
alter table sm_problem_templates add column if not exists created_at timestamptz not null default now();
alter table sm_problem_templates add column if not exists created_by uuid;
alter table sm_problem_templates add column if not exists updated_at timestamptz not null default now();
alter table sm_problem_templates add column if not exists updated_by uuid;
alter table sm_problem_templates add column if not exists rev bigint not null default 0;
alter table sm_problem_templates add column if not exists version integer not null default 1;
alter table sm_problem_templates add column if not exists deleted_at timestamptz;
alter table sm_problem_templates add column if not exists origin text;
alter table sm_problem_templates add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_problem_templates add column if not exists name text;
alter table sm_problem_templates add column if not exists active boolean not null default true;
alter table sm_problem_templates add column if not exists sort_order integer;
alter table sm_problem_templates add column if not exists short_description text;
alter table sm_problem_templates add column if not exists description text;
alter table sm_problem_templates add column if not exists source text;
alter table sm_problem_templates add column if not exists category text;
alter table sm_problem_templates add column if not exists subcategory text;
alter table sm_problem_templates add column if not exists impact text;
alter table sm_problem_templates add column if not exists urgency text;
alter table sm_problem_templates add column if not exists likelihood text;
alter table sm_problem_templates add column if not exists assignment_group_id uuid;
alter table sm_problem_templates add column if not exists service_id uuid;
alter table sm_problem_templates add column if not exists ci_id uuid;
alter table sm_problem_templates add column if not exists rca_method text;
alter table sm_problem_templates add column if not exists rca_sections jsonb;
alter table sm_problem_templates add column if not exists tasks jsonb;
alter table sm_problem_templates add column if not exists groups jsonb;
alter table sm_problem_templates add column if not exists description_note text;
create index if not exists sm_problem_templates_rev_idx on sm_problem_templates (org_id, rev);
create index if not exists sm_problem_templates_upd_idx on sm_problem_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_templates_crt_idx on sm_problem_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_problem_templates_name_uk on sm_problem_templates (org_id, name) where deleted_at is null;
create index if not exists sm_problem_templates_workspace_acc_idx on sm_problem_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_templates_unit_acc_idx on sm_problem_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_templates_domain_acc_idx on sm_problem_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_problem_templates_sync on sm_problem_templates;
create trigger sm_problem_templates_sync before insert or update on sm_problem_templates for each row execute function sm_sync_touch('problem_template');
alter table sm_problem_templates enable row level security;

-- role: نقش‌ها
create table if not exists sm_roles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_roles add column if not exists workspace_id uuid;
alter table sm_roles add column if not exists domain_id uuid;
alter table sm_roles add column if not exists unit_id uuid;
alter table sm_roles add column if not exists created_at timestamptz not null default now();
alter table sm_roles add column if not exists created_by uuid;
alter table sm_roles add column if not exists updated_at timestamptz not null default now();
alter table sm_roles add column if not exists updated_by uuid;
alter table sm_roles add column if not exists rev bigint not null default 0;
alter table sm_roles add column if not exists version integer not null default 1;
alter table sm_roles add column if not exists deleted_at timestamptz;
alter table sm_roles add column if not exists origin text;
alter table sm_roles add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_roles add column if not exists key text;
alter table sm_roles add column if not exists name text;
alter table sm_roles add column if not exists description text;
alter table sm_roles add column if not exists persona text;
alter table sm_roles add column if not exists workspaces text;
alter table sm_roles add column if not exists domains text;
alter table sm_roles add column if not exists grants jsonb;
alter table sm_roles add column if not exists field_groups jsonb;
alter table sm_roles add column if not exists contains jsonb;
alter table sm_roles add column if not exists active boolean not null default true;
create index if not exists sm_roles_rev_idx on sm_roles (org_id, rev);
create index if not exists sm_roles_upd_idx on sm_roles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_roles_crt_idx on sm_roles (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_roles_key_uk on sm_roles (org_id, key) where deleted_at is null;
drop trigger if exists sm_roles_sync on sm_roles;
create trigger sm_roles_sync before insert or update on sm_roles for each row execute function sm_sync_touch('role');
alter table sm_roles enable row level security;

-- schedule: زمان‌بندی‌ها
create table if not exists sm_schedules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb
);
alter table sm_schedules add column if not exists workspace_id uuid;
alter table sm_schedules add column if not exists domain_id uuid;
alter table sm_schedules add column if not exists unit_id uuid;
alter table sm_schedules add column if not exists created_at timestamptz not null default now();
alter table sm_schedules add column if not exists created_by uuid;
alter table sm_schedules add column if not exists updated_at timestamptz not null default now();
alter table sm_schedules add column if not exists updated_by uuid;
alter table sm_schedules add column if not exists rev bigint not null default 0;
alter table sm_schedules add column if not exists version integer not null default 1;
alter table sm_schedules add column if not exists deleted_at timestamptz;
alter table sm_schedules add column if not exists origin text;
alter table sm_schedules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_schedules add column if not exists name text;
alter table sm_schedules add column if not exists active boolean not null default false;
alter table sm_schedules add column if not exists table_key text;
alter table sm_schedules add column if not exists spec jsonb;
alter table sm_schedules add column if not exists template jsonb;
alter table sm_schedules add column if not exists run_as uuid;
alter table sm_schedules add column if not exists description text;
create index if not exists sm_schedules_rev_idx on sm_schedules (org_id, rev);
create index if not exists sm_schedules_upd_idx on sm_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_schedules_crt_idx on sm_schedules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_schedules_sync on sm_schedules;
create trigger sm_schedules_sync before insert or update on sm_schedules for each row execute function sm_sync_touch('schedule');
alter table sm_schedules enable row level security;

-- sla_definition: تعریف‌های توافق سطح خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_sla_definitions_rev_idx on sm_sla_definitions (org_id, rev);
create index if not exists sm_sla_definitions_upd_idx on sm_sla_definitions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sla_definitions_crt_idx on sm_sla_definitions (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sla_definitions_table_key_name_uk on sm_sla_definitions (org_id, table_key, name) where deleted_at is null;
drop trigger if exists sm_sla_definitions_sync on sm_sla_definitions;
create trigger sm_sla_definitions_sync before insert or update on sm_sla_definitions for each row execute function sm_sync_touch('sla_definition');
alter table sm_sla_definitions enable row level security;

-- task_sla: زمان‌سنج‌های توافق
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_task_slas_rev_idx on sm_task_slas (org_id, rev);
create index if not exists sm_task_slas_upd_idx on sm_task_slas (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_task_slas_crt_idx on sm_task_slas (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_task_slas_definition_id_idx on sm_task_slas (org_id, definition_id) where deleted_at is null;
create index if not exists sm_task_slas_record_id_idx on sm_task_slas (org_id, record_id) where deleted_at is null;
create index if not exists sm_task_slas_stage_idx on sm_task_slas (org_id, stage) where deleted_at is null;
create index if not exists sm_task_slas_planned_end_at_idx on sm_task_slas (org_id, planned_end_at) where deleted_at is null;
drop trigger if exists sm_task_slas_sync on sm_task_slas;
create trigger sm_task_slas_sync before insert or update on sm_task_slas for each row execute function sm_sync_touch('task_sla');
alter table sm_task_slas enable row level security;

-- todo: کارها
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
  custom jsonb not null default '{}'::jsonb
);
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
drop trigger if exists sm_todos_sync on sm_todos;
create trigger sm_todos_sync before insert or update on sm_todos for each row execute function sm_sync_touch('todo');
alter table sm_todos enable row level security;

-- ui_policy: سیاست‌های فرم
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_ui_policies_rev_idx on sm_ui_policies (org_id, rev);
create index if not exists sm_ui_policies_upd_idx on sm_ui_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ui_policies_crt_idx on sm_ui_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ui_policies_sync on sm_ui_policies;
create trigger sm_ui_policies_sync before insert or update on sm_ui_policies for each row execute function sm_sync_touch('ui_policy');
alter table sm_ui_policies enable row level security;

-- view: نماهای ذخیره‌شده
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_views_rev_idx on sm_views (org_id, rev);
create index if not exists sm_views_upd_idx on sm_views (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_views_crt_idx on sm_views (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_views_workspace_acc_idx on sm_views (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_views_unit_acc_idx on sm_views (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_views_domain_acc_idx on sm_views (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_views_owner_id_idx on sm_views (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_views_sync on sm_views;
create trigger sm_views_sync before insert or update on sm_views for each row execute function sm_sync_touch('view');
alter table sm_views enable row level security;

-- workspace: فضاهای کاری
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_workspaces_rev_idx on sm_workspaces (org_id, rev);
create index if not exists sm_workspaces_upd_idx on sm_workspaces (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_workspaces_crt_idx on sm_workspaces (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_workspaces_key_uk on sm_workspaces (org_id, key) where deleted_at is null;
drop trigger if exists sm_workspaces_sync on sm_workspaces;
create trigger sm_workspaces_sync before insert or update on sm_workspaces for each row execute function sm_sync_touch('workspace');
alter table sm_workspaces enable row level security;

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

insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;

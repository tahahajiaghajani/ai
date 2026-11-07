-- «ITSM» migration 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)
-- ---------------------------------------------------------------------------
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

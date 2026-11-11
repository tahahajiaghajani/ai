-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۶ از ۹ (0006_engine_tables:17/28 … 0006_engine_tables:20/28)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۷ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 17/28 (e746bd22eb04)
-- notification_pref: تنظیمات اعلان
do $cols$
begin
  if to_regclass('sm_notification_prefs') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  optouts jsonb,
  digest text,
  digest_hour integer,
  quiet_from text,
  quiet_to text,
  read_before timestamptz
);
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
create or replace trigger sm_notification_prefs_demo after insert on sm_notification_prefs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_prefs_demo_t after update or delete on sm_notification_prefs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_prefs enable row level security;

-- notification_rule: قانون‌های اعلان
do $cols$
begin
  if to_regclass('sm_notification_rules') is not null then
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
    alter table sm_notification_rules add column if not exists large_groups text;
    alter table sm_notification_rules add column if not exists channels jsonb;
    alter table sm_notification_rules add column if not exists targets jsonb;
    alter table sm_notification_rules add column if not exists template_id uuid;
    alter table sm_notification_rules add column if not exists digest boolean not null default true;
    alter table sm_notification_rules add column if not exists builtin text;
    alter table sm_notification_rules add column if not exists description text;
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  mandatory boolean not null default false,
  table_key text,
  event text,
  custom_event text,
  entry_kinds jsonb,
  condition jsonb,
  recipients jsonb,
  notify_actor boolean not null default false,
  large_groups text,
  channels jsonb,
  targets jsonb,
  template_id uuid,
  digest boolean not null default true,
  builtin text,
  description text
);
create index if not exists sm_notification_rules_rev_idx on sm_notification_rules (org_id, rev);
create index if not exists sm_notification_rules_upd_idx on sm_notification_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_rules_crt_idx on sm_notification_rules (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_notification_rules_builtin_uk on sm_notification_rules (org_id, builtin) where deleted_at is null;
drop trigger if exists sm_notification_rules_sync on sm_notification_rules;
create trigger sm_notification_rules_sync before insert or update on sm_notification_rules for each row execute function sm_sync_touch('notification_rule');
create or replace trigger sm_notification_rules_demo after insert on sm_notification_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_rules_demo_t after update or delete on sm_notification_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_rules enable row level security;

-- notification_template: الگوهای اعلان
do $cols$
begin
  if to_regclass('sm_notification_templates') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  event text,
  table_key text,
  subject text,
  body text,
  short_text text,
  active boolean not null default true,
  description text
);
create index if not exists sm_notification_templates_rev_idx on sm_notification_templates (org_id, rev);
create index if not exists sm_notification_templates_upd_idx on sm_notification_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_templates_crt_idx on sm_notification_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_notification_templates_sync on sm_notification_templates;
create trigger sm_notification_templates_sync before insert or update on sm_notification_templates for each row execute function sm_sync_touch('notification_template');
create or replace trigger sm_notification_templates_demo after insert on sm_notification_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_templates_demo_t after update or delete on sm_notification_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_templates enable row level security;

-- oncall_override: جایگزینی‌های کشیک
do $cols$
begin
  if to_regclass('sm_oncall_overrides') is not null then
    alter table sm_oncall_overrides add column if not exists workspace_id uuid;
    alter table sm_oncall_overrides add column if not exists domain_id uuid;
    alter table sm_oncall_overrides add column if not exists unit_id uuid;
    alter table sm_oncall_overrides add column if not exists created_at timestamptz not null default now();
    alter table sm_oncall_overrides add column if not exists created_by uuid;
    alter table sm_oncall_overrides add column if not exists updated_at timestamptz not null default now();
    alter table sm_oncall_overrides add column if not exists updated_by uuid;
    alter table sm_oncall_overrides add column if not exists rev bigint not null default 0;
    alter table sm_oncall_overrides add column if not exists version integer not null default 1;
    alter table sm_oncall_overrides add column if not exists deleted_at timestamptz;
    alter table sm_oncall_overrides add column if not exists origin text;
    alter table sm_oncall_overrides add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_oncall_overrides add column if not exists schedule_id uuid;
    alter table sm_oncall_overrides add column if not exists user_id uuid;
    alter table sm_oncall_overrides add column if not exists replaces_id uuid;
    alter table sm_oncall_overrides add column if not exists start_at timestamptz;
    alter table sm_oncall_overrides add column if not exists end_at timestamptz;
    alter table sm_oncall_overrides add column if not exists reason text;
  end if;
end
$cols$;
create table if not exists sm_oncall_overrides (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  schedule_id uuid,
  user_id uuid,
  replaces_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  reason text
);
create index if not exists sm_oncall_overrides_rev_idx on sm_oncall_overrides (org_id, rev);
create index if not exists sm_oncall_overrides_upd_idx on sm_oncall_overrides (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_overrides_crt_idx on sm_oncall_overrides (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_overrides_schedule_id_idx on sm_oncall_overrides (org_id, schedule_id) where deleted_at is null;
create index if not exists sm_oncall_overrides_workspace_acc_idx on sm_oncall_overrides (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_oncall_overrides_unit_acc_idx on sm_oncall_overrides (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_oncall_overrides_domain_acc_idx on sm_oncall_overrides (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_oncall_overrides_user_id_idx on sm_oncall_overrides (org_id, user_id) where deleted_at is null;
create index if not exists sm_oncall_overrides_replaces_id_idx on sm_oncall_overrides (org_id, replaces_id) where deleted_at is null;
drop trigger if exists sm_oncall_overrides_sync on sm_oncall_overrides;
create trigger sm_oncall_overrides_sync before insert or update on sm_oncall_overrides for each row execute function sm_sync_touch('oncall_override');
create or replace trigger sm_oncall_overrides_demo after insert on sm_oncall_overrides for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_oncall_overrides_demo_t after update or delete on sm_oncall_overrides for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_oncall_overrides enable row level security;

-- oncall_rotation: چرخش‌های کشیک
do $cols$
begin
  if to_regclass('sm_oncall_rotations') is not null then
    alter table sm_oncall_rotations add column if not exists workspace_id uuid;
    alter table sm_oncall_rotations add column if not exists domain_id uuid;
    alter table sm_oncall_rotations add column if not exists unit_id uuid;
    alter table sm_oncall_rotations add column if not exists created_at timestamptz not null default now();
    alter table sm_oncall_rotations add column if not exists created_by uuid;
    alter table sm_oncall_rotations add column if not exists updated_at timestamptz not null default now();
    alter table sm_oncall_rotations add column if not exists updated_by uuid;
    alter table sm_oncall_rotations add column if not exists rev bigint not null default 0;
    alter table sm_oncall_rotations add column if not exists version integer not null default 1;
    alter table sm_oncall_rotations add column if not exists deleted_at timestamptz;
    alter table sm_oncall_rotations add column if not exists origin text;
    alter table sm_oncall_rotations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_oncall_rotations add column if not exists schedule_id uuid;
    alter table sm_oncall_rotations add column if not exists name text;
    alter table sm_oncall_rotations add column if not exists layer integer;
    alter table sm_oncall_rotations add column if not exists rotation_type text;
    alter table sm_oncall_rotations add column if not exists length_hours integer;
    alter table sm_oncall_rotations add column if not exists active boolean not null default true;
    alter table sm_oncall_rotations add column if not exists start_at timestamptz;
    alter table sm_oncall_rotations add column if not exists end_at timestamptz;
    alter table sm_oncall_rotations add column if not exists members jsonb;
    alter table sm_oncall_rotations add column if not exists restriction text;
    alter table sm_oncall_rotations add column if not exists restrict_days jsonb;
    alter table sm_oncall_rotations add column if not exists restrict_from text;
    alter table sm_oncall_rotations add column if not exists restrict_to text;
  end if;
end
$cols$;
create table if not exists sm_oncall_rotations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  schedule_id uuid,
  name text,
  layer integer,
  rotation_type text,
  length_hours integer,
  active boolean not null default true,
  start_at timestamptz,
  end_at timestamptz,
  members jsonb,
  restriction text,
  restrict_days jsonb,
  restrict_from text,
  restrict_to text
);
create index if not exists sm_oncall_rotations_rev_idx on sm_oncall_rotations (org_id, rev);
create index if not exists sm_oncall_rotations_upd_idx on sm_oncall_rotations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_rotations_crt_idx on sm_oncall_rotations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_rotations_schedule_id_idx on sm_oncall_rotations (org_id, schedule_id) where deleted_at is null;
drop trigger if exists sm_oncall_rotations_sync on sm_oncall_rotations;
create trigger sm_oncall_rotations_sync before insert or update on sm_oncall_rotations for each row execute function sm_sync_touch('oncall_rotation');
create or replace trigger sm_oncall_rotations_demo after insert on sm_oncall_rotations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_oncall_rotations_demo_t after update or delete on sm_oncall_rotations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_oncall_rotations enable row level security;

-- oncall_schedule: برنامه‌های کشیک
do $cols$
begin
  if to_regclass('sm_oncall_schedules') is not null then
    alter table sm_oncall_schedules add column if not exists workspace_id uuid;
    alter table sm_oncall_schedules add column if not exists domain_id uuid;
    alter table sm_oncall_schedules add column if not exists unit_id uuid;
    alter table sm_oncall_schedules add column if not exists created_at timestamptz not null default now();
    alter table sm_oncall_schedules add column if not exists created_by uuid;
    alter table sm_oncall_schedules add column if not exists updated_at timestamptz not null default now();
    alter table sm_oncall_schedules add column if not exists updated_by uuid;
    alter table sm_oncall_schedules add column if not exists rev bigint not null default 0;
    alter table sm_oncall_schedules add column if not exists version integer not null default 1;
    alter table sm_oncall_schedules add column if not exists deleted_at timestamptz;
    alter table sm_oncall_schedules add column if not exists origin text;
    alter table sm_oncall_schedules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_oncall_schedules add column if not exists name text;
    alter table sm_oncall_schedules add column if not exists group_id uuid;
    alter table sm_oncall_schedules add column if not exists calendar_id uuid;
    alter table sm_oncall_schedules add column if not exists timezone text;
    alter table sm_oncall_schedules add column if not exists active boolean not null default true;
    alter table sm_oncall_schedules add column if not exists notify_shifts boolean not null default true;
    alter table sm_oncall_schedules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_oncall_schedules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  calendar_id uuid,
  timezone text,
  active boolean not null default true,
  notify_shifts boolean not null default true,
  description text
);
create index if not exists sm_oncall_schedules_rev_idx on sm_oncall_schedules (org_id, rev);
create index if not exists sm_oncall_schedules_upd_idx on sm_oncall_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_schedules_crt_idx on sm_oncall_schedules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_schedules_workspace_acc_idx on sm_oncall_schedules (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_oncall_schedules_unit_acc_idx on sm_oncall_schedules (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_oncall_schedules_domain_acc_idx on sm_oncall_schedules (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_oncall_schedules_open_grp_idx on sm_oncall_schedules (org_id, group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_oncall_schedules_sync on sm_oncall_schedules;
create trigger sm_oncall_schedules_sync before insert or update on sm_oncall_schedules for each row execute function sm_sync_touch('oncall_schedule');
create or replace trigger sm_oncall_schedules_demo after insert on sm_oncall_schedules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_oncall_schedules_demo_t after update or delete on sm_oncall_schedules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_oncall_schedules enable row level security;

-- order_guide_rule: قاعده‌های راهنمای سفارش
do $cols$
begin
  if to_regclass('sm_order_guide_rules') is not null then
    alter table sm_order_guide_rules add column if not exists workspace_id uuid;
    alter table sm_order_guide_rules add column if not exists domain_id uuid;
    alter table sm_order_guide_rules add column if not exists unit_id uuid;
    alter table sm_order_guide_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_order_guide_rules add column if not exists created_by uuid;
    alter table sm_order_guide_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_order_guide_rules add column if not exists updated_by uuid;
    alter table sm_order_guide_rules add column if not exists rev bigint not null default 0;
    alter table sm_order_guide_rules add column if not exists version integer not null default 1;
    alter table sm_order_guide_rules add column if not exists deleted_at timestamptz;
    alter table sm_order_guide_rules add column if not exists origin text;
    alter table sm_order_guide_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_order_guide_rules add column if not exists name text;
    alter table sm_order_guide_rules add column if not exists guide_id uuid;
    alter table sm_order_guide_rules add column if not exists item_id uuid;
    alter table sm_order_guide_rules add column if not exists condition jsonb;
    alter table sm_order_guide_rules add column if not exists mandatory boolean not null default false;
    alter table sm_order_guide_rules add column if not exists selected boolean not null default true;
    alter table sm_order_guide_rules add column if not exists cascade boolean not null default true;
    alter table sm_order_guide_rules add column if not exists quantity integer;
    alter table sm_order_guide_rules add column if not exists sort_order integer;
    alter table sm_order_guide_rules add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_order_guide_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  guide_id uuid,
  item_id uuid,
  condition jsonb,
  mandatory boolean not null default false,
  selected boolean not null default true,
  cascade boolean not null default true,
  quantity integer,
  sort_order integer,
  active boolean not null default true
);
create index if not exists sm_order_guide_rules_rev_idx on sm_order_guide_rules (org_id, rev);
create index if not exists sm_order_guide_rules_upd_idx on sm_order_guide_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_order_guide_rules_crt_idx on sm_order_guide_rules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_order_guide_rules_guide_id_idx on sm_order_guide_rules (org_id, guide_id) where deleted_at is null;
drop trigger if exists sm_order_guide_rules_sync on sm_order_guide_rules;
create trigger sm_order_guide_rules_sync before insert or update on sm_order_guide_rules for each row execute function sm_sync_touch('order_guide_rule');
create or replace trigger sm_order_guide_rules_demo after insert on sm_order_guide_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_order_guide_rules_demo_t after update or delete on sm_order_guide_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_order_guide_rules enable row level security;

-- org_unit: واحدهای سازمانی
do $cols$
begin
  if to_regclass('sm_org_units') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  code text,
  kind text,
  parent_id uuid,
  manager_id uuid,
  location_id uuid,
  is_domain boolean not null default false,
  active boolean not null default true,
  description text,
  path text,
  depth integer
);
create index if not exists sm_org_units_rev_idx on sm_org_units (org_id, rev);
create index if not exists sm_org_units_upd_idx on sm_org_units (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_org_units_crt_idx on sm_org_units (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_org_units_code_uk on sm_org_units (org_id, code) where deleted_at is null;
create index if not exists sm_org_units_parent_id_idx on sm_org_units (org_id, parent_id) where deleted_at is null;
create index if not exists sm_org_units_manager_id_idx on sm_org_units (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_org_units_sync on sm_org_units;
create trigger sm_org_units_sync before insert or update on sm_org_units for each row execute function sm_sync_touch('org_unit');
create or replace trigger sm_org_units_demo after insert on sm_org_units for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_org_units_demo_t after update or delete on sm_org_units for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_org_units enable row level security;

-- outage: قطعی‌ها
do $cols$
begin
  if to_regclass('sm_outages') is not null then
    alter table sm_outages add column if not exists workspace_id uuid;
    alter table sm_outages add column if not exists domain_id uuid;
    alter table sm_outages add column if not exists unit_id uuid;
    alter table sm_outages add column if not exists created_at timestamptz not null default now();
    alter table sm_outages add column if not exists created_by uuid;
    alter table sm_outages add column if not exists updated_at timestamptz not null default now();
    alter table sm_outages add column if not exists updated_by uuid;
    alter table sm_outages add column if not exists rev bigint not null default 0;
    alter table sm_outages add column if not exists version integer not null default 1;
    alter table sm_outages add column if not exists deleted_at timestamptz;
    alter table sm_outages add column if not exists origin text;
    alter table sm_outages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_outages add column if not exists no integer;
    alter table sm_outages add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'OUT' || no::text else 'OUT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_outages add column if not exists title text;
    alter table sm_outages add column if not exists outage_type text;
    alter table sm_outages add column if not exists service_id uuid;
    alter table sm_outages add column if not exists offering_id uuid;
    alter table sm_outages add column if not exists ci_id uuid;
    alter table sm_outages add column if not exists owner_id uuid;
    alter table sm_outages add column if not exists assignment_group_id uuid;
    alter table sm_outages add column if not exists begin_at timestamptz;
    alter table sm_outages add column if not exists end_at timestamptz;
    alter table sm_outages add column if not exists duration bigint;
    alter table sm_outages add column if not exists impact_pct numeric;
    alter table sm_outages add column if not exists affected_users integer;
    alter table sm_outages add column if not exists customer_minutes integer;
    alter table sm_outages add column if not exists excluded boolean not null default false;
    alter table sm_outages add column if not exists cause text;
    alter table sm_outages add column if not exists cause_detail text;
    alter table sm_outages add column if not exists incident_id uuid;
    alter table sm_outages add column if not exists change_id uuid;
    alter table sm_outages add column if not exists alert_id uuid;
    alter table sm_outages add column if not exists problem_id uuid;
    alter table sm_outages add column if not exists proposed_by text;
    alter table sm_outages add column if not exists description text;
    alter table sm_outages add column if not exists watch_list jsonb;
    alter table sm_outages add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_outages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'OUT' || no::text else 'OUT' || lpad(no::text, 6, '0') end) stored,
  title text,
  outage_type text,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  owner_id uuid,
  assignment_group_id uuid,
  begin_at timestamptz,
  end_at timestamptz,
  duration bigint,
  impact_pct numeric,
  affected_users integer,
  customer_minutes integer,
  excluded boolean not null default false,
  cause text,
  cause_detail text,
  incident_id uuid,
  change_id uuid,
  alert_id uuid,
  problem_id uuid,
  proposed_by text,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_outages', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_outages_search_cae18f1d_trgm', 'sm_outages', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_outages_search_custom_trgm', 'sm_outages', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_outages_no_uk on sm_outages (org_id, no);
create index if not exists sm_outages_rev_idx on sm_outages (org_id, rev);
create index if not exists sm_outages_upd_idx on sm_outages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_outages_crt_idx on sm_outages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_outages_service_id_idx on sm_outages (org_id, service_id) where deleted_at is null;
create index if not exists sm_outages_begin_at_idx on sm_outages (org_id, begin_at) where deleted_at is null;
create index if not exists sm_outages_incident_id_idx on sm_outages (org_id, incident_id) where deleted_at is null;
create index if not exists sm_outages_state_idx on sm_outages (org_id, state) where deleted_at is null;
create index if not exists sm_outages_workspace_acc_idx on sm_outages (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_outages_unit_acc_idx on sm_outages (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_outages_domain_acc_idx on sm_outages (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_outages_owner_id_idx on sm_outages (org_id, owner_id) where deleted_at is null;
create index if not exists sm_outages_watch_list_gin on sm_outages using gin (watch_list);
drop trigger if exists sm_outages_sync on sm_outages;
create trigger sm_outages_sync before insert or update on sm_outages for each row execute function sm_sync_touch('outage');
create or replace trigger sm_outages_demo after insert on sm_outages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_outages_demo_t after update or delete on sm_outages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_outages enable row level security;

-- page: فراخوان‌ها
do $cols$
begin
  if to_regclass('sm_pages') is not null then
    alter table sm_pages add column if not exists workspace_id uuid;
    alter table sm_pages add column if not exists domain_id uuid;
    alter table sm_pages add column if not exists unit_id uuid;
    alter table sm_pages add column if not exists created_at timestamptz not null default now();
    alter table sm_pages add column if not exists created_by uuid;
    alter table sm_pages add column if not exists updated_at timestamptz not null default now();
    alter table sm_pages add column if not exists updated_by uuid;
    alter table sm_pages add column if not exists rev bigint not null default 0;
    alter table sm_pages add column if not exists version integer not null default 1;
    alter table sm_pages add column if not exists deleted_at timestamptz;
    alter table sm_pages add column if not exists origin text;
    alter table sm_pages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_pages add column if not exists no integer;
    alter table sm_pages add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PG' || no::text else 'PG' || lpad(no::text, 7, '0') end) stored;
    alter table sm_pages add column if not exists summary text;
    alter table sm_pages add column if not exists alert_id uuid;
    alter table sm_pages add column if not exists user_id uuid;
    alter table sm_pages add column if not exists policy_id uuid;
    alter table sm_pages add column if not exists level integer;
    alter table sm_pages add column if not exists round integer;
    alter table sm_pages add column if not exists channels jsonb;
    alter table sm_pages add column if not exists sent_at timestamptz;
    alter table sm_pages add column if not exists acknowledged_at timestamptz;
    alter table sm_pages add column if not exists ack_via text;
    alter table sm_pages add column if not exists expires_at timestamptz;
    alter table sm_pages add column if not exists failure_reason text;
    alter table sm_pages add column if not exists ack_token_hash text;
    alter table sm_pages add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_pages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PG' || no::text else 'PG' || lpad(no::text, 7, '0') end) stored,
  summary text,
  alert_id uuid,
  user_id uuid,
  policy_id uuid,
  level integer,
  round integer,
  channels jsonb,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  ack_via text,
  expires_at timestamptz,
  failure_reason text,
  ack_token_hash text,
  state text,
  search_6ba6e1c7 text generated always as (translate(coalesce(summary, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_pages', 'search_6ba6e1c7', $x$translate(coalesce(summary, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_pages_search_6ba6e1c7_trgm', 'sm_pages', 'search_6ba6e1c7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_pages_search_custom_trgm', 'sm_pages', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_pages_no_uk on sm_pages (org_id, no);
create index if not exists sm_pages_rev_idx on sm_pages (org_id, rev);
create index if not exists sm_pages_upd_idx on sm_pages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_pages_crt_idx on sm_pages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_pages_alert_id_idx on sm_pages (org_id, alert_id) where deleted_at is null;
create index if not exists sm_pages_user_id_idx on sm_pages (org_id, user_id) where deleted_at is null;
create index if not exists sm_pages_ack_token_hash_idx on sm_pages (org_id, ack_token_hash) where deleted_at is null;
create index if not exists sm_pages_state_idx on sm_pages (org_id, state) where deleted_at is null;
drop trigger if exists sm_pages_sync on sm_pages;
create trigger sm_pages_sync before insert or update on sm_pages for each row execute function sm_sync_touch('page');
create or replace trigger sm_pages_demo after insert on sm_pages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_pages_demo_t after update or delete on sm_pages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_pages enable row level security;

-- parts_requirement: قطعه‌های لازم
do $cols$
begin
  if to_regclass('sm_parts_requirements') is not null then
    alter table sm_parts_requirements add column if not exists workspace_id uuid;
    alter table sm_parts_requirements add column if not exists domain_id uuid;
    alter table sm_parts_requirements add column if not exists unit_id uuid;
    alter table sm_parts_requirements add column if not exists created_at timestamptz not null default now();
    alter table sm_parts_requirements add column if not exists created_by uuid;
    alter table sm_parts_requirements add column if not exists updated_at timestamptz not null default now();
    alter table sm_parts_requirements add column if not exists updated_by uuid;
    alter table sm_parts_requirements add column if not exists rev bigint not null default 0;
    alter table sm_parts_requirements add column if not exists version integer not null default 1;
    alter table sm_parts_requirements add column if not exists deleted_at timestamptz;
    alter table sm_parts_requirements add column if not exists origin text;
    alter table sm_parts_requirements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_parts_requirements add column if not exists part_name text;
    alter table sm_parts_requirements add column if not exists part_code text;
    alter table sm_parts_requirements add column if not exists quantity numeric;
    alter table sm_parts_requirements add column if not exists wo_task_id uuid;
    alter table sm_parts_requirements add column if not exists work_order_id uuid;
    alter table sm_parts_requirements add column if not exists stockroom text;
    alter table sm_parts_requirements add column if not exists serial_no text;
    alter table sm_parts_requirements add column if not exists defective_returned boolean not null default false;
    alter table sm_parts_requirements add column if not exists rma_no text;
    alter table sm_parts_requirements add column if not exists technician_id uuid;
    alter table sm_parts_requirements add column if not exists assignment_group_id uuid;
    alter table sm_parts_requirements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_parts_requirements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  part_name text,
  part_code text,
  quantity numeric,
  wo_task_id uuid,
  work_order_id uuid,
  stockroom text,
  serial_no text,
  defective_returned boolean not null default false,
  rma_no text,
  technician_id uuid,
  assignment_group_id uuid,
  state text
);
create index if not exists sm_parts_requirements_rev_idx on sm_parts_requirements (org_id, rev);
create index if not exists sm_parts_requirements_upd_idx on sm_parts_requirements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_parts_requirements_crt_idx on sm_parts_requirements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_parts_requirements_wo_task_id_idx on sm_parts_requirements (org_id, wo_task_id) where deleted_at is null;
create index if not exists sm_parts_requirements_work_order_id_idx on sm_parts_requirements (org_id, work_order_id) where deleted_at is null;
create index if not exists sm_parts_requirements_technician_id_idx on sm_parts_requirements (org_id, technician_id) where deleted_at is null;
create index if not exists sm_parts_requirements_assignment_group_id_idx on sm_parts_requirements (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_parts_requirements_state_idx on sm_parts_requirements (org_id, state) where deleted_at is null;
create index if not exists sm_parts_requirements_workspace_acc_idx on sm_parts_requirements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_parts_requirements_unit_acc_idx on sm_parts_requirements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_parts_requirements_domain_acc_idx on sm_parts_requirements (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_parts_requirements_sync on sm_parts_requirements;
create trigger sm_parts_requirements_sync before insert or update on sm_parts_requirements for each row execute function sm_sync_touch('parts_requirement');
create or replace trigger sm_parts_requirements_demo after insert on sm_parts_requirements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_parts_requirements_demo_t after update or delete on sm_parts_requirements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_parts_requirements enable row level security;

-- plan_step: گام‌های بازیابی
do $cols$
begin
  if to_regclass('sm_plan_steps') is not null then
    alter table sm_plan_steps add column if not exists workspace_id uuid;
    alter table sm_plan_steps add column if not exists domain_id uuid;
    alter table sm_plan_steps add column if not exists unit_id uuid;
    alter table sm_plan_steps add column if not exists created_at timestamptz not null default now();
    alter table sm_plan_steps add column if not exists created_by uuid;
    alter table sm_plan_steps add column if not exists updated_at timestamptz not null default now();
    alter table sm_plan_steps add column if not exists updated_by uuid;
    alter table sm_plan_steps add column if not exists rev bigint not null default 0;
    alter table sm_plan_steps add column if not exists version integer not null default 1;
    alter table sm_plan_steps add column if not exists deleted_at timestamptz;
    alter table sm_plan_steps add column if not exists origin text;
    alter table sm_plan_steps add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_plan_steps add column if not exists plan_id uuid;
    alter table sm_plan_steps add column if not exists seq integer;
    alter table sm_plan_steps add column if not exists rto_offset_minutes integer;
    alter table sm_plan_steps add column if not exists title text;
    alter table sm_plan_steps add column if not exists role text;
    alter table sm_plan_steps add column if not exists owner_id uuid;
    alter table sm_plan_steps add column if not exists action text;
  end if;
end
$cols$;
create table if not exists sm_plan_steps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  plan_id uuid,
  seq integer,
  rto_offset_minutes integer,
  title text,
  role text,
  owner_id uuid,
  action text
);
create index if not exists sm_plan_steps_rev_idx on sm_plan_steps (org_id, rev);
create index if not exists sm_plan_steps_upd_idx on sm_plan_steps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_plan_steps_crt_idx on sm_plan_steps (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_plan_steps_plan_id_idx on sm_plan_steps (org_id, plan_id) where deleted_at is null;
create index if not exists sm_plan_steps_workspace_acc_idx on sm_plan_steps (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_plan_steps_unit_acc_idx on sm_plan_steps (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_plan_steps_domain_acc_idx on sm_plan_steps (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_plan_steps_owner_id_idx on sm_plan_steps (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_plan_steps_sync on sm_plan_steps;
create trigger sm_plan_steps_sync before insert or update on sm_plan_steps for each row execute function sm_sync_touch('plan_step');
create or replace trigger sm_plan_steps_demo after insert on sm_plan_steps for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_plan_steps_demo_t after update or delete on sm_plan_steps for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_plan_steps enable row level security;

-- portal: درگاه‌ها
do $cols$
begin
  if to_regclass('sm_portals') is not null then
    alter table sm_portals add column if not exists workspace_id uuid;
    alter table sm_portals add column if not exists domain_id uuid;
    alter table sm_portals add column if not exists unit_id uuid;
    alter table sm_portals add column if not exists created_at timestamptz not null default now();
    alter table sm_portals add column if not exists created_by uuid;
    alter table sm_portals add column if not exists updated_at timestamptz not null default now();
    alter table sm_portals add column if not exists updated_by uuid;
    alter table sm_portals add column if not exists rev bigint not null default 0;
    alter table sm_portals add column if not exists version integer not null default 1;
    alter table sm_portals add column if not exists deleted_at timestamptz;
    alter table sm_portals add column if not exists origin text;
    alter table sm_portals add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portals add column if not exists name text;
    alter table sm_portals add column if not exists active boolean not null default true;
    alter table sm_portals add column if not exists sort_order integer;
    alter table sm_portals add column if not exists title text;
    alter table sm_portals add column if not exists subtitle text;
    alter table sm_portals add column if not exists brand_name text;
    alter table sm_portals add column if not exists accent text;
    alter table sm_portals add column if not exists hero text;
    alter table sm_portals add column if not exists logo_id text;
    alter table sm_portals add column if not exists footer text;
    alter table sm_portals add column if not exists privacy_notice text;
    alter table sm_portals add column if not exists chat_enabled boolean not null default true;
    alter table sm_portals add column if not exists chat_name text;
    alter table sm_portals add column if not exists ai_answers boolean not null default true;
    alter table sm_portals add column if not exists report_item_id uuid;
    alter table sm_portals add column if not exists layout jsonb;
    alter table sm_portals add column if not exists published_layout jsonb;
    alter table sm_portals add column if not exists layout_version integer;
    alter table sm_portals add column if not exists published_at timestamptz;
    alter table sm_portals add column if not exists published_by uuid;
    alter table sm_portals add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_portals (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  title text,
  subtitle text,
  brand_name text,
  accent text,
  hero text,
  logo_id text,
  footer text,
  privacy_notice text,
  chat_enabled boolean not null default true,
  chat_name text,
  ai_answers boolean not null default true,
  report_item_id uuid,
  layout jsonb,
  published_layout jsonb,
  layout_version integer,
  published_at timestamptz,
  published_by uuid,
  seeded integer
);
create index if not exists sm_portals_rev_idx on sm_portals (org_id, rev);
create index if not exists sm_portals_upd_idx on sm_portals (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portals_crt_idx on sm_portals (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_portals_sync on sm_portals;
create trigger sm_portals_sync before insert or update on sm_portals for each row execute function sm_sync_touch('portal');
create or replace trigger sm_portals_demo after insert on sm_portals for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portals_demo_t after update or delete on sm_portals for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portals enable row level security;

-- portal_channel: کانال‌های پیام‌رسان
do $cols$
begin
  if to_regclass('sm_portal_channels') is not null then
    alter table sm_portal_channels add column if not exists workspace_id uuid;
    alter table sm_portal_channels add column if not exists domain_id uuid;
    alter table sm_portal_channels add column if not exists unit_id uuid;
    alter table sm_portal_channels add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_channels add column if not exists created_by uuid;
    alter table sm_portal_channels add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_channels add column if not exists updated_by uuid;
    alter table sm_portal_channels add column if not exists rev bigint not null default 0;
    alter table sm_portal_channels add column if not exists version integer not null default 1;
    alter table sm_portal_channels add column if not exists deleted_at timestamptz;
    alter table sm_portal_channels add column if not exists origin text;
    alter table sm_portal_channels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_channels add column if not exists name text;
    alter table sm_portal_channels add column if not exists kind text;
    alter table sm_portal_channels add column if not exists active boolean not null default true;
    alter table sm_portal_channels add column if not exists bot_username text;
    alter table sm_portal_channels add column if not exists welcome text;
    alter table sm_portal_channels add column if not exists allow_groups boolean not null default false;
    alter table sm_portal_channels add column if not exists rate_per_minute integer;
    alter table sm_portal_channels add column if not exists token text;
    alter table sm_portal_channels add column if not exists outbound_url text;
    alter table sm_portal_channels add column if not exists auth_mode text;
    alter table sm_portal_channels add column if not exists secret text;
    alter table sm_portal_channels add column if not exists hook_key text;
    alter table sm_portal_channels add column if not exists registered_at timestamptz;
    alter table sm_portal_channels add column if not exists last_in_at timestamptz;
    alter table sm_portal_channels add column if not exists received_count integer;
    alter table sm_portal_channels add column if not exists failed_count integer;
    alter table sm_portal_channels add column if not exists last_error text;
  end if;
end
$cols$;
create table if not exists sm_portal_channels (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  bot_username text,
  welcome text,
  allow_groups boolean not null default false,
  rate_per_minute integer,
  token text,
  outbound_url text,
  auth_mode text,
  secret text,
  hook_key text,
  registered_at timestamptz,
  last_in_at timestamptz,
  received_count integer,
  failed_count integer,
  last_error text
);
create index if not exists sm_portal_channels_rev_idx on sm_portal_channels (org_id, rev);
create index if not exists sm_portal_channels_upd_idx on sm_portal_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channels_crt_idx on sm_portal_channels (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channels_hook_key_idx on sm_portal_channels (org_id, hook_key) where deleted_at is null;
drop trigger if exists sm_portal_channels_sync on sm_portal_channels;
create or replace trigger sm_portal_channels_demo after insert on sm_portal_channels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_channels_demo_t after update or delete on sm_portal_channels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_channels enable row level security;

-- portal_channel_identity: حساب‌های پیام‌رسان
do $cols$
begin
  if to_regclass('sm_portal_channel_identities') is not null then
    alter table sm_portal_channel_identities add column if not exists workspace_id uuid;
    alter table sm_portal_channel_identities add column if not exists domain_id uuid;
    alter table sm_portal_channel_identities add column if not exists unit_id uuid;
    alter table sm_portal_channel_identities add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_channel_identities add column if not exists created_by uuid;
    alter table sm_portal_channel_identities add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_channel_identities add column if not exists updated_by uuid;
    alter table sm_portal_channel_identities add column if not exists rev bigint not null default 0;
    alter table sm_portal_channel_identities add column if not exists version integer not null default 1;
    alter table sm_portal_channel_identities add column if not exists deleted_at timestamptz;
    alter table sm_portal_channel_identities add column if not exists origin text;
    alter table sm_portal_channel_identities add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_channel_identities add column if not exists channel_id uuid;
    alter table sm_portal_channel_identities add column if not exists user_id uuid;
    alter table sm_portal_channel_identities add column if not exists external_id text;
    alter table sm_portal_channel_identities add column if not exists external_name text;
    alter table sm_portal_channel_identities add column if not exists linked_at timestamptz;
    alter table sm_portal_channel_identities add column if not exists conversation_id text;
    alter table sm_portal_channel_identities add column if not exists options jsonb;
    alter table sm_portal_channel_identities add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_portal_channel_identities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  channel_id uuid,
  user_id uuid,
  external_id text,
  external_name text,
  linked_at timestamptz,
  conversation_id text,
  options jsonb,
  active boolean not null default true
);
create index if not exists sm_portal_channel_identities_rev_idx on sm_portal_channel_identities (org_id, rev);
create index if not exists sm_portal_channel_identities_upd_idx on sm_portal_channel_identities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channel_identities_crt_idx on sm_portal_channel_identities (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channel_identities_channel_id_idx on sm_portal_channel_identities (org_id, channel_id) where deleted_at is null;
create index if not exists sm_portal_channel_identities_user_id_idx on sm_portal_channel_identities (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_channel_identities_external_id_idx on sm_portal_channel_identities (org_id, external_id) where deleted_at is null;
create index if not exists sm_portal_channel_identities_workspace_acc_idx on sm_portal_channel_identities (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_channel_identities_unit_acc_idx on sm_portal_channel_identities (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_channel_identities_domain_acc_idx on sm_portal_channel_identities (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_portal_channel_identities_sync on sm_portal_channel_identities;
create or replace trigger sm_portal_channel_identities_demo after insert on sm_portal_channel_identities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_channel_identities_demo_t after update or delete on sm_portal_channel_identities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_channel_identities enable row level security;

-- portal_feedback: بازخوردها
do $cols$
begin
  if to_regclass('sm_portal_feedback') is not null then
    alter table sm_portal_feedback add column if not exists workspace_id uuid;
    alter table sm_portal_feedback add column if not exists domain_id uuid;
    alter table sm_portal_feedback add column if not exists unit_id uuid;
    alter table sm_portal_feedback add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_feedback add column if not exists created_by uuid;
    alter table sm_portal_feedback add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_feedback add column if not exists updated_by uuid;
    alter table sm_portal_feedback add column if not exists rev bigint not null default 0;
    alter table sm_portal_feedback add column if not exists version integer not null default 1;
    alter table sm_portal_feedback add column if not exists deleted_at timestamptz;
    alter table sm_portal_feedback add column if not exists origin text;
    alter table sm_portal_feedback add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_feedback add column if not exists no integer;
    alter table sm_portal_feedback add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'FBK' || no::text else 'FBK' || lpad(no::text, 6, '0') end) stored;
    alter table sm_portal_feedback add column if not exists short_description text;
    alter table sm_portal_feedback add column if not exists description text;
    alter table sm_portal_feedback add column if not exists state text;
    alter table sm_portal_feedback add column if not exists priority text;
    alter table sm_portal_feedback add column if not exists impact text;
    alter table sm_portal_feedback add column if not exists urgency text;
    alter table sm_portal_feedback add column if not exists category text;
    alter table sm_portal_feedback add column if not exists subcategory text;
    alter table sm_portal_feedback add column if not exists channel text;
    alter table sm_portal_feedback add column if not exists caller_id uuid;
    alter table sm_portal_feedback add column if not exists requested_for uuid;
    alter table sm_portal_feedback add column if not exists opened_by uuid;
    alter table sm_portal_feedback add column if not exists opened_at timestamptz;
    alter table sm_portal_feedback add column if not exists assignment_group_id uuid;
    alter table sm_portal_feedback add column if not exists assigned_to uuid;
    alter table sm_portal_feedback add column if not exists service_id uuid;
    alter table sm_portal_feedback add column if not exists offering_id uuid;
    alter table sm_portal_feedback add column if not exists ci_id uuid;
    alter table sm_portal_feedback add column if not exists location_id uuid;
    alter table sm_portal_feedback add column if not exists due_at timestamptz;
    alter table sm_portal_feedback add column if not exists resolved_at timestamptz;
    alter table sm_portal_feedback add column if not exists resolved_by uuid;
    alter table sm_portal_feedback add column if not exists closed_at timestamptz;
    alter table sm_portal_feedback add column if not exists closed_by uuid;
    alter table sm_portal_feedback add column if not exists close_code text;
    alter table sm_portal_feedback add column if not exists close_notes text;
    alter table sm_portal_feedback add column if not exists parent_id uuid;
    alter table sm_portal_feedback add column if not exists watch_list jsonb;
    alter table sm_portal_feedback add column if not exists approval text;
    alter table sm_portal_feedback add column if not exists escalation integer;
    alter table sm_portal_feedback add column if not exists reassignment_count integer;
    alter table sm_portal_feedback add column if not exists reopen_count integer;
    alter table sm_portal_feedback add column if not exists time_worked bigint;
    alter table sm_portal_feedback add column if not exists first_response_at timestamptz;
    alter table sm_portal_feedback add column if not exists active boolean not null default true;
    alter table sm_portal_feedback add column if not exists sla_due timestamptz;
    alter table sm_portal_feedback add column if not exists knowledge boolean not null default false;
    alter table sm_portal_feedback add column if not exists kind text;
    alter table sm_portal_feedback add column if not exists privacy_right text;
    alter table sm_portal_feedback add column if not exists response text;
    alter table sm_portal_feedback add column if not exists acknowledged_at timestamptz;
    alter table sm_portal_feedback add column if not exists responded_at timestamptz;
    alter table sm_portal_feedback add column if not exists confidential boolean not null default false;
    alter table sm_portal_feedback add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_portal_feedback (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'FBK' || no::text else 'FBK' || lpad(no::text, 6, '0') end) stored,
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
  privacy_right text,
  response text,
  acknowledged_at timestamptz,
  responded_at timestamptz,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_portal_feedback', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_portal_feedback_search_f3bce210_trgm', 'sm_portal_feedback', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_portal_feedback_search_custom_trgm', 'sm_portal_feedback', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_portal_feedback_no_uk on sm_portal_feedback (org_id, no);
create index if not exists sm_portal_feedback_rev_idx on sm_portal_feedback (org_id, rev);
create index if not exists sm_portal_feedback_upd_idx on sm_portal_feedback (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_feedback_crt_idx on sm_portal_feedback (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_feedback_state_idx on sm_portal_feedback (org_id, state) where deleted_at is null;
create index if not exists sm_portal_feedback_assignment_group_id_idx on sm_portal_feedback (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_portal_feedback_assigned_to_idx on sm_portal_feedback (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_portal_feedback_workspace_acc_idx on sm_portal_feedback (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_feedback_unit_acc_idx on sm_portal_feedback (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_feedback_domain_acc_idx on sm_portal_feedback (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_portal_feedback_caller_id_idx on sm_portal_feedback (org_id, caller_id) where deleted_at is null;
create index if not exists sm_portal_feedback_requested_for_idx on sm_portal_feedback (org_id, requested_for) where deleted_at is null;
create index if not exists sm_portal_feedback_opened_by_idx on sm_portal_feedback (org_id, opened_by) where deleted_at is null;
create index if not exists sm_portal_feedback_watch_list_gin on sm_portal_feedback using gin (watch_list);
create index if not exists sm_portal_feedback_open_grp_idx on sm_portal_feedback (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_portal_feedback_opened_brin on sm_portal_feedback using brin (opened_at);
drop trigger if exists sm_portal_feedback_sync on sm_portal_feedback;
create trigger sm_portal_feedback_sync before insert or update on sm_portal_feedback for each row execute function sm_sync_touch('portal_feedback');
create or replace trigger sm_portal_feedback_demo after insert on sm_portal_feedback for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_feedback_demo_t after update or delete on sm_portal_feedback for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_feedback enable row level security;

-- portal_kb_publication: انتشارهای عمومی دانش
do $cols$
begin
  if to_regclass('sm_portal_kb_publications') is not null then
    alter table sm_portal_kb_publications add column if not exists workspace_id uuid;
    alter table sm_portal_kb_publications add column if not exists domain_id uuid;
    alter table sm_portal_kb_publications add column if not exists unit_id uuid;
    alter table sm_portal_kb_publications add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_kb_publications add column if not exists created_by uuid;
    alter table sm_portal_kb_publications add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_kb_publications add column if not exists updated_by uuid;
    alter table sm_portal_kb_publications add column if not exists rev bigint not null default 0;
    alter table sm_portal_kb_publications add column if not exists version integer not null default 1;
    alter table sm_portal_kb_publications add column if not exists deleted_at timestamptz;
    alter table sm_portal_kb_publications add column if not exists origin text;
    alter table sm_portal_kb_publications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_kb_publications add column if not exists name text;
    alter table sm_portal_kb_publications add column if not exists active boolean not null default false;
    alter table sm_portal_kb_publications add column if not exists allow_feedback boolean not null default true;
    alter table sm_portal_kb_publications add column if not exists bases jsonb;
    alter table sm_portal_kb_publications add column if not exists title text;
    alter table sm_portal_kb_publications add column if not exists intro text;
    alter table sm_portal_kb_publications add column if not exists token text;
    alter table sm_portal_kb_publications add column if not exists published_at timestamptz;
    alter table sm_portal_kb_publications add column if not exists published_by uuid;
  end if;
end
$cols$;
create table if not exists sm_portal_kb_publications (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  allow_feedback boolean not null default true,
  bases jsonb,
  title text,
  intro text,
  token text,
  published_at timestamptz,
  published_by uuid
);
create index if not exists sm_portal_kb_publications_rev_idx on sm_portal_kb_publications (org_id, rev);
create index if not exists sm_portal_kb_publications_upd_idx on sm_portal_kb_publications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_kb_publications_crt_idx on sm_portal_kb_publications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_kb_publications_token_idx on sm_portal_kb_publications (org_id, token) where deleted_at is null;
drop trigger if exists sm_portal_kb_publications_sync on sm_portal_kb_publications;
create trigger sm_portal_kb_publications_sync before insert or update on sm_portal_kb_publications for each row execute function sm_sync_touch('portal_kb_publication');
create or replace trigger sm_portal_kb_publications_demo after insert on sm_portal_kb_publications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_kb_publications_demo_t after update or delete on sm_portal_kb_publications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_kb_publications enable row level security;

-- portal_link: پیوندهای سریع
do $cols$
begin
  if to_regclass('sm_portal_links') is not null then
    alter table sm_portal_links add column if not exists workspace_id uuid;
    alter table sm_portal_links add column if not exists domain_id uuid;
    alter table sm_portal_links add column if not exists unit_id uuid;
    alter table sm_portal_links add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_links add column if not exists created_by uuid;
    alter table sm_portal_links add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_links add column if not exists updated_by uuid;
    alter table sm_portal_links add column if not exists rev bigint not null default 0;
    alter table sm_portal_links add column if not exists version integer not null default 1;
    alter table sm_portal_links add column if not exists deleted_at timestamptz;
    alter table sm_portal_links add column if not exists origin text;
    alter table sm_portal_links add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_links add column if not exists name text;
    alter table sm_portal_links add column if not exists url text;
    alter table sm_portal_links add column if not exists description text;
    alter table sm_portal_links add column if not exists icon text;
    alter table sm_portal_links add column if not exists section_name text;
    alter table sm_portal_links add column if not exists sort_order integer;
    alter table sm_portal_links add column if not exists new_tab boolean not null default true;
    alter table sm_portal_links add column if not exists active boolean not null default true;
    alter table sm_portal_links add column if not exists aud_units jsonb;
    alter table sm_portal_links add column if not exists aud_groups jsonb;
    alter table sm_portal_links add column if not exists aud_locations jsonb;
    alter table sm_portal_links add column if not exists aud_users jsonb;
  end if;
end
$cols$;
create table if not exists sm_portal_links (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  url text,
  description text,
  icon text,
  section_name text,
  sort_order integer,
  new_tab boolean not null default true,
  active boolean not null default true,
  aud_units jsonb,
  aud_groups jsonb,
  aud_locations jsonb,
  aud_users jsonb
);
create index if not exists sm_portal_links_rev_idx on sm_portal_links (org_id, rev);
create index if not exists sm_portal_links_upd_idx on sm_portal_links (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_links_crt_idx on sm_portal_links (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_portal_links_sync on sm_portal_links;
create trigger sm_portal_links_sync before insert or update on sm_portal_links for each row execute function sm_sync_touch('portal_link');
create or replace trigger sm_portal_links_demo after insert on sm_portal_links for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_links_demo_t after update or delete on sm_portal_links for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_links enable row level security;

-- portal_link_code: کدهای اتصال پیام‌رسان
do $cols$
begin
  if to_regclass('sm_portal_link_codes') is not null then
    alter table sm_portal_link_codes add column if not exists workspace_id uuid;
    alter table sm_portal_link_codes add column if not exists domain_id uuid;
    alter table sm_portal_link_codes add column if not exists unit_id uuid;
    alter table sm_portal_link_codes add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_link_codes add column if not exists created_by uuid;
    alter table sm_portal_link_codes add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_link_codes add column if not exists updated_by uuid;
    alter table sm_portal_link_codes add column if not exists rev bigint not null default 0;
    alter table sm_portal_link_codes add column if not exists version integer not null default 1;
    alter table sm_portal_link_codes add column if not exists deleted_at timestamptz;
    alter table sm_portal_link_codes add column if not exists origin text;
    alter table sm_portal_link_codes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_link_codes add column if not exists user_id uuid;
    alter table sm_portal_link_codes add column if not exists code_hash text;
    alter table sm_portal_link_codes add column if not exists expires_at timestamptz;
    alter table sm_portal_link_codes add column if not exists used_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_portal_link_codes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  code_hash text,
  expires_at timestamptz,
  used_at timestamptz
);
create index if not exists sm_portal_link_codes_rev_idx on sm_portal_link_codes (org_id, rev);
create index if not exists sm_portal_link_codes_upd_idx on sm_portal_link_codes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_link_codes_crt_idx on sm_portal_link_codes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_link_codes_user_id_idx on sm_portal_link_codes (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_link_codes_code_hash_idx on sm_portal_link_codes (org_id, code_hash) where deleted_at is null;
create index if not exists sm_portal_link_codes_workspace_acc_idx on sm_portal_link_codes (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_link_codes_unit_acc_idx on sm_portal_link_codes (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_link_codes_domain_acc_idx on sm_portal_link_codes (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_portal_link_codes_sync on sm_portal_link_codes;
create or replace trigger sm_portal_link_codes_demo after insert on sm_portal_link_codes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_link_codes_demo_t after update or delete on sm_portal_link_codes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_link_codes enable row level security;

-- portal_pref: ترجیح‌های درگاه
do $cols$
begin
  if to_regclass('sm_portal_prefs') is not null then
    alter table sm_portal_prefs add column if not exists workspace_id uuid;
    alter table sm_portal_prefs add column if not exists domain_id uuid;
    alter table sm_portal_prefs add column if not exists unit_id uuid;
    alter table sm_portal_prefs add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_prefs add column if not exists created_by uuid;
    alter table sm_portal_prefs add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_prefs add column if not exists updated_by uuid;
    alter table sm_portal_prefs add column if not exists rev bigint not null default 0;
    alter table sm_portal_prefs add column if not exists version integer not null default 1;
    alter table sm_portal_prefs add column if not exists deleted_at timestamptz;
    alter table sm_portal_prefs add column if not exists origin text;
    alter table sm_portal_prefs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_prefs add column if not exists user_id uuid;
    alter table sm_portal_prefs add column if not exists favorites jsonb;
    alter table sm_portal_prefs add column if not exists portal_id uuid;
  end if;
end
$cols$;
create table if not exists sm_portal_prefs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  favorites jsonb,
  portal_id uuid
);
create index if not exists sm_portal_prefs_rev_idx on sm_portal_prefs (org_id, rev);
create index if not exists sm_portal_prefs_upd_idx on sm_portal_prefs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_prefs_crt_idx on sm_portal_prefs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_portal_prefs_user_id_uk on sm_portal_prefs (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_prefs_user_id_idx on sm_portal_prefs (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_prefs_workspace_acc_idx on sm_portal_prefs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_prefs_unit_acc_idx on sm_portal_prefs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_prefs_domain_acc_idx on sm_portal_prefs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_portal_prefs_sync on sm_portal_prefs;
create trigger sm_portal_prefs_sync before insert or update on sm_portal_prefs for each row execute function sm_sync_touch('portal_pref');
create or replace trigger sm_portal_prefs_demo after insert on sm_portal_prefs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_prefs_demo_t after update or delete on sm_portal_prefs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_prefs enable row level security;

-- portal_topic: موضوع‌های درگاه
do $cols$
begin
  if to_regclass('sm_portal_topics') is not null then
    alter table sm_portal_topics add column if not exists workspace_id uuid;
    alter table sm_portal_topics add column if not exists domain_id uuid;
    alter table sm_portal_topics add column if not exists unit_id uuid;
    alter table sm_portal_topics add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_topics add column if not exists created_by uuid;
    alter table sm_portal_topics add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_topics add column if not exists updated_by uuid;
    alter table sm_portal_topics add column if not exists rev bigint not null default 0;
    alter table sm_portal_topics add column if not exists version integer not null default 1;
    alter table sm_portal_topics add column if not exists deleted_at timestamptz;
    alter table sm_portal_topics add column if not exists origin text;
    alter table sm_portal_topics add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_topics add column if not exists name text;
    alter table sm_portal_topics add column if not exists parent_id uuid;
    alter table sm_portal_topics add column if not exists description text;
    alter table sm_portal_topics add column if not exists icon text;
    alter table sm_portal_topics add column if not exists sort_order integer;
    alter table sm_portal_topics add column if not exists active boolean not null default true;
    alter table sm_portal_topics add column if not exists items jsonb;
    alter table sm_portal_topics add column if not exists articles jsonb;
    alter table sm_portal_topics add column if not exists links jsonb;
    alter table sm_portal_topics add column if not exists aud_units jsonb;
    alter table sm_portal_topics add column if not exists aud_groups jsonb;
    alter table sm_portal_topics add column if not exists aud_locations jsonb;
    alter table sm_portal_topics add column if not exists aud_users jsonb;
  end if;
end
$cols$;
create table if not exists sm_portal_topics (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  parent_id uuid,
  description text,
  icon text,
  sort_order integer,
  active boolean not null default true,
  items jsonb,
  articles jsonb,
  links jsonb,
  aud_units jsonb,
  aud_groups jsonb,
  aud_locations jsonb,
  aud_users jsonb
);
create index if not exists sm_portal_topics_rev_idx on sm_portal_topics (org_id, rev);
create index if not exists sm_portal_topics_upd_idx on sm_portal_topics (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_topics_crt_idx on sm_portal_topics (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_topics_parent_id_idx on sm_portal_topics (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_portal_topics_sync on sm_portal_topics;
create trigger sm_portal_topics_sync before insert or update on sm_portal_topics for each row execute function sm_sync_touch('portal_topic');
create or replace trigger sm_portal_topics_demo after insert on sm_portal_topics for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_topics_demo_t after update or delete on sm_portal_topics for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_topics enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:16', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۸ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 18/28 (e746bd22eb04)
-- portal_widget: ابزارک‌های وب‌سایت
do $cols$
begin
  if to_regclass('sm_portal_widgets') is not null then
    alter table sm_portal_widgets add column if not exists workspace_id uuid;
    alter table sm_portal_widgets add column if not exists domain_id uuid;
    alter table sm_portal_widgets add column if not exists unit_id uuid;
    alter table sm_portal_widgets add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_widgets add column if not exists created_by uuid;
    alter table sm_portal_widgets add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_widgets add column if not exists updated_by uuid;
    alter table sm_portal_widgets add column if not exists rev bigint not null default 0;
    alter table sm_portal_widgets add column if not exists version integer not null default 1;
    alter table sm_portal_widgets add column if not exists deleted_at timestamptz;
    alter table sm_portal_widgets add column if not exists origin text;
    alter table sm_portal_widgets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_widgets add column if not exists name text;
    alter table sm_portal_widgets add column if not exists active boolean not null default true;
    alter table sm_portal_widgets add column if not exists accent text;
    alter table sm_portal_widgets add column if not exists title text;
    alter table sm_portal_widgets add column if not exists greeting text;
    alter table sm_portal_widgets add column if not exists allowed_origins jsonb;
    alter table sm_portal_widgets add column if not exists publication_id uuid;
    alter table sm_portal_widgets add column if not exists chat boolean not null default true;
    alter table sm_portal_widgets add column if not exists consent text;
    alter table sm_portal_widgets add column if not exists widget_key text;
  end if;
end
$cols$;
create table if not exists sm_portal_widgets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  accent text,
  title text,
  greeting text,
  allowed_origins jsonb,
  publication_id uuid,
  chat boolean not null default true,
  consent text,
  widget_key text
);
create index if not exists sm_portal_widgets_rev_idx on sm_portal_widgets (org_id, rev);
create index if not exists sm_portal_widgets_upd_idx on sm_portal_widgets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_widgets_crt_idx on sm_portal_widgets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_widgets_widget_key_idx on sm_portal_widgets (org_id, widget_key) where deleted_at is null;
drop trigger if exists sm_portal_widgets_sync on sm_portal_widgets;
create or replace trigger sm_portal_widgets_demo after insert on sm_portal_widgets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_widgets_demo_t after update or delete on sm_portal_widgets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_widgets enable row level security;

-- portfolio: سبدهای پروژه
do $cols$
begin
  if to_regclass('sm_portfolios') is not null then
    alter table sm_portfolios add column if not exists workspace_id uuid;
    alter table sm_portfolios add column if not exists domain_id uuid;
    alter table sm_portfolios add column if not exists unit_id uuid;
    alter table sm_portfolios add column if not exists created_at timestamptz not null default now();
    alter table sm_portfolios add column if not exists created_by uuid;
    alter table sm_portfolios add column if not exists updated_at timestamptz not null default now();
    alter table sm_portfolios add column if not exists updated_by uuid;
    alter table sm_portfolios add column if not exists rev bigint not null default 0;
    alter table sm_portfolios add column if not exists version integer not null default 1;
    alter table sm_portfolios add column if not exists deleted_at timestamptz;
    alter table sm_portfolios add column if not exists origin text;
    alter table sm_portfolios add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portfolios add column if not exists no integer;
    alter table sm_portfolios add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'PFL' || no::text else 'PFL' || lpad(no::text, 4, '0') end) stored;
    alter table sm_portfolios add column if not exists name text;
    alter table sm_portfolios add column if not exists code text;
    alter table sm_portfolios add column if not exists parent_id uuid;
    alter table sm_portfolios add column if not exists owner_id uuid;
    alter table sm_portfolios add column if not exists manager_id uuid;
    alter table sm_portfolios add column if not exists budget numeric;
    alter table sm_portfolios add column if not exists goals text;
    alter table sm_portfolios add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_portfolios (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 4 then 'PFL' || no::text else 'PFL' || lpad(no::text, 4, '0') end) stored,
  name text,
  code text,
  parent_id uuid,
  owner_id uuid,
  manager_id uuid,
  budget numeric,
  goals text,
  active boolean not null default true,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_portfolios', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_portfolios_search_56291d9d_trgm', 'sm_portfolios', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_portfolios_search_custom_trgm', 'sm_portfolios', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_portfolios_no_uk on sm_portfolios (org_id, no);
create index if not exists sm_portfolios_rev_idx on sm_portfolios (org_id, rev);
create index if not exists sm_portfolios_upd_idx on sm_portfolios (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolios_crt_idx on sm_portfolios (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_portfolios_code_uk on sm_portfolios (org_id, code) where deleted_at is null;
create index if not exists sm_portfolios_workspace_acc_idx on sm_portfolios (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portfolios_unit_acc_idx on sm_portfolios (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portfolios_domain_acc_idx on sm_portfolios (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_portfolios_owner_id_idx on sm_portfolios (org_id, owner_id) where deleted_at is null;
create index if not exists sm_portfolios_manager_id_idx on sm_portfolios (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_portfolios_sync on sm_portfolios;
create trigger sm_portfolios_sync before insert or update on sm_portfolios for each row execute function sm_sync_touch('portfolio');
create or replace trigger sm_portfolios_demo after insert on sm_portfolios for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portfolios_demo_t after update or delete on sm_portfolios for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portfolios enable row level security;

-- portfolio_node: شاخه‌های سبد خدمات
do $cols$
begin
  if to_regclass('sm_portfolio_nodes') is not null then
    alter table sm_portfolio_nodes add column if not exists workspace_id uuid;
    alter table sm_portfolio_nodes add column if not exists domain_id uuid;
    alter table sm_portfolio_nodes add column if not exists unit_id uuid;
    alter table sm_portfolio_nodes add column if not exists created_at timestamptz not null default now();
    alter table sm_portfolio_nodes add column if not exists created_by uuid;
    alter table sm_portfolio_nodes add column if not exists updated_at timestamptz not null default now();
    alter table sm_portfolio_nodes add column if not exists updated_by uuid;
    alter table sm_portfolio_nodes add column if not exists rev bigint not null default 0;
    alter table sm_portfolio_nodes add column if not exists version integer not null default 1;
    alter table sm_portfolio_nodes add column if not exists deleted_at timestamptz;
    alter table sm_portfolio_nodes add column if not exists origin text;
    alter table sm_portfolio_nodes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portfolio_nodes add column if not exists name text;
    alter table sm_portfolio_nodes add column if not exists parent_id uuid;
    alter table sm_portfolio_nodes add column if not exists kind text;
    alter table sm_portfolio_nodes add column if not exists owner_id uuid;
    alter table sm_portfolio_nodes add column if not exists sort_order integer;
    alter table sm_portfolio_nodes add column if not exists path text;
    alter table sm_portfolio_nodes add column if not exists depth integer;
    alter table sm_portfolio_nodes add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_portfolio_nodes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  parent_id uuid,
  kind text,
  owner_id uuid,
  sort_order integer,
  path text,
  depth integer,
  description text
);
create index if not exists sm_portfolio_nodes_rev_idx on sm_portfolio_nodes (org_id, rev);
create index if not exists sm_portfolio_nodes_upd_idx on sm_portfolio_nodes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolio_nodes_crt_idx on sm_portfolio_nodes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolio_nodes_parent_id_idx on sm_portfolio_nodes (org_id, parent_id) where deleted_at is null;
create index if not exists sm_portfolio_nodes_path_idx on sm_portfolio_nodes (org_id, path) where deleted_at is null;
drop trigger if exists sm_portfolio_nodes_sync on sm_portfolio_nodes;
create trigger sm_portfolio_nodes_sync before insert or update on sm_portfolio_nodes for each row execute function sm_sync_touch('portfolio_node');
create or replace trigger sm_portfolio_nodes_demo after insert on sm_portfolio_nodes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portfolio_nodes_demo_t after update or delete on sm_portfolio_nodes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portfolio_nodes enable row level security;

-- priority_matrix: ماتریس‌های اولویت
do $cols$
begin
  if to_regclass('sm_priority_matrices') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  table_key text,
  impact_field text,
  urgency_field text,
  priority_field text,
  cells jsonb,
  active boolean not null default true,
  description text
);
create index if not exists sm_priority_matrices_rev_idx on sm_priority_matrices (org_id, rev);
create index if not exists sm_priority_matrices_upd_idx on sm_priority_matrices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_priority_matrices_crt_idx on sm_priority_matrices (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_priority_matrices_table_key_uk on sm_priority_matrices (org_id, table_key) where deleted_at is null;
drop trigger if exists sm_priority_matrices_sync on sm_priority_matrices;
create trigger sm_priority_matrices_sync before insert or update on sm_priority_matrices for each row execute function sm_sync_touch('priority_matrix');
create or replace trigger sm_priority_matrices_demo after insert on sm_priority_matrices for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_priority_matrices_demo_t after update or delete on sm_priority_matrices for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_priority_matrices enable row level security;

-- problem: مشکلات
do $cols$
begin
  if to_regclass('sm_problems') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PRB' || no::text else 'PRB' || lpad(no::text, 7, '0') end) stored,
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
  proactive boolean not null default false,
  investigation_reason text,
  likelihood text,
  risk_score integer,
  manager_id uuid,
  pending_reason text,
  affected_services jsonb,
  affected_cis jsonb,
  first_incident_id uuid,
  template_id uuid,
  symptoms text,
  workaround text,
  cause_code text,
  rca_method text,
  rca_sections jsonb,
  contributing_factors jsonb,
  cause_notes text,
  fix_notes text,
  rca jsonb,
  duplicate_of uuid,
  known_error boolean not null default false,
  target_date date,
  review_date date,
  incident_count integer,
  tech_debt integer,
  rca_at timestamptz,
  workaround_at timestamptz,
  fix_at timestamptz,
  monitoring_until date,
  time_to_rca bigint,
  time_to_fix bigint,
  last_activity_at timestamptz,
  shared jsonb,
  reminded_at timestamptz,
  monitoring_done boolean not null default false,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_problems', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problems_search_f3bce210_trgm', 'sm_problems', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_problems_search_custom_trgm', 'sm_problems', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
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
create index if not exists sm_problems_open_grp_idx on sm_problems (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_problems_opened_brin on sm_problems using brin (opened_at);
drop trigger if exists sm_problems_sync on sm_problems;
create trigger sm_problems_sync before insert or update on sm_problems for each row execute function sm_sync_touch('problem');
create or replace trigger sm_problems_demo after insert on sm_problems for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problems_demo_t after update or delete on sm_problems for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problems enable row level security;

-- problem_candidate: نامزدهای مشکل
do $cols$
begin
  if to_regclass('sm_problem_candidates') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PCN' || no::text else 'PCN' || lpad(no::text, 6, '0') end) stored,
  title text,
  rule_kind text,
  score integer,
  assigned_to uuid,
  incidents jsonb,
  incident_count integer,
  first_at timestamptz,
  last_at timestamptz,
  category text,
  ci_id uuid,
  service_id uuid,
  signature text,
  problem_id uuid,
  review_notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_problem_candidates', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problem_candidates_search_cae18f1d_trgm', 'sm_problem_candidates', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_problem_candidates_search_custom_trgm', 'sm_problem_candidates', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
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
create or replace trigger sm_problem_candidates_demo after insert on sm_problem_candidates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_candidates_demo_t after update or delete on sm_problem_candidates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_candidates enable row level security;

-- problem_config: تنظیمات مشکل
do $cols$
begin
  if to_regclass('sm_problem_configs') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  inactivity_days integer,
  monitoring_days integer,
  ke_review_days integer,
  candidate_window_days integer,
  candidate_min_incidents integer,
  candidate_reopen_min integer,
  close_requires_incident boolean not null default false,
  resolve_waiting_incidents boolean not null default true,
  seeded integer
);
create index if not exists sm_problem_configs_rev_idx on sm_problem_configs (org_id, rev);
create index if not exists sm_problem_configs_upd_idx on sm_problem_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_configs_crt_idx on sm_problem_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_problem_configs_config_key_uk on sm_problem_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_problem_configs_sync on sm_problem_configs;
create trigger sm_problem_configs_sync before insert or update on sm_problem_configs for each row execute function sm_sync_touch('problem_config');
create or replace trigger sm_problem_configs_demo after insert on sm_problem_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_configs_demo_t after update or delete on sm_problem_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_configs enable row level security;

-- problem_task: کارهای مشکل
do $cols$
begin
  if to_regclass('sm_problem_tasks') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored,
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
  problem_id uuid,
  task_type text,
  mandatory boolean not null default true,
  findings text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_problem_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problem_tasks_search_f3bce210_trgm', 'sm_problem_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_problem_tasks_search_custom_trgm', 'sm_problem_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
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
create index if not exists sm_problem_tasks_open_grp_idx on sm_problem_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_problem_tasks_opened_brin on sm_problem_tasks using brin (opened_at);
drop trigger if exists sm_problem_tasks_sync on sm_problem_tasks;
create trigger sm_problem_tasks_sync before insert or update on sm_problem_tasks for each row execute function sm_sync_touch('problem_task');
create or replace trigger sm_problem_tasks_demo after insert on sm_problem_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_tasks_demo_t after update or delete on sm_problem_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_tasks enable row level security;

-- problem_template: الگوهای مشکل
do $cols$
begin
  if to_regclass('sm_problem_templates') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  sort_order integer,
  short_description text,
  description text,
  source text,
  category text,
  subcategory text,
  impact text,
  urgency text,
  likelihood text,
  assignment_group_id uuid,
  service_id uuid,
  ci_id uuid,
  rca_method text,
  rca_sections jsonb,
  tasks jsonb,
  groups jsonb,
  description_note text
);
create index if not exists sm_problem_templates_rev_idx on sm_problem_templates (org_id, rev);
create index if not exists sm_problem_templates_upd_idx on sm_problem_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_templates_crt_idx on sm_problem_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_problem_templates_name_uk on sm_problem_templates (org_id, name) where deleted_at is null;
create index if not exists sm_problem_templates_workspace_acc_idx on sm_problem_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_templates_unit_acc_idx on sm_problem_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_templates_domain_acc_idx on sm_problem_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_problem_templates_open_grp_idx on sm_problem_templates (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_problem_templates_sync on sm_problem_templates;
create trigger sm_problem_templates_sync before insert or update on sm_problem_templates for each row execute function sm_sync_touch('problem_template');
create or replace trigger sm_problem_templates_demo after insert on sm_problem_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_templates_demo_t after update or delete on sm_problem_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_templates enable row level security;

-- project: پروژه‌ها
do $cols$
begin
  if to_regclass('sm_projects') is not null then
    alter table sm_projects add column if not exists workspace_id uuid;
    alter table sm_projects add column if not exists domain_id uuid;
    alter table sm_projects add column if not exists unit_id uuid;
    alter table sm_projects add column if not exists created_at timestamptz not null default now();
    alter table sm_projects add column if not exists created_by uuid;
    alter table sm_projects add column if not exists updated_at timestamptz not null default now();
    alter table sm_projects add column if not exists updated_by uuid;
    alter table sm_projects add column if not exists rev bigint not null default 0;
    alter table sm_projects add column if not exists version integer not null default 1;
    alter table sm_projects add column if not exists deleted_at timestamptz;
    alter table sm_projects add column if not exists origin text;
    alter table sm_projects add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_projects add column if not exists no integer;
    alter table sm_projects add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRJ' || no::text else 'PRJ' || lpad(no::text, 6, '0') end) stored;
    alter table sm_projects add column if not exists name text;
    alter table sm_projects add column if not exists code text;
    alter table sm_projects add column if not exists type text;
    alter table sm_projects add column if not exists methodology text;
    alter table sm_projects add column if not exists priority text;
    alter table sm_projects add column if not exists project_manager_id uuid;
    alter table sm_projects add column if not exists sponsor_id uuid;
    alter table sm_projects add column if not exists portfolio_id uuid;
    alter table sm_projects add column if not exists assignment_group_id uuid;
    alter table sm_projects add column if not exists team jsonb;
    alter table sm_projects add column if not exists org_unit_id uuid;
    alter table sm_projects add column if not exists demand_id uuid;
    alter table sm_projects add column if not exists description text;
    alter table sm_projects add column if not exists planned_start date;
    alter table sm_projects add column if not exists planned_end date;
    alter table sm_projects add column if not exists projected_end date;
    alter table sm_projects add column if not exists actual_start date;
    alter table sm_projects add column if not exists actual_end date;
    alter table sm_projects add column if not exists baseline_end date;
    alter table sm_projects add column if not exists baseline_start date;
    alter table sm_projects add column if not exists baseline_taken_at timestamptz;
    alter table sm_projects add column if not exists est_hours numeric;
    alter table sm_projects add column if not exists actual_hours numeric;
    alter table sm_projects add column if not exists budget numeric;
    alter table sm_projects add column if not exists actual_cost numeric;
    alter table sm_projects add column if not exists objectives text;
    alter table sm_projects add column if not exists scope_in text;
    alter table sm_projects add column if not exists scope_out text;
    alter table sm_projects add column if not exists assumptions text;
    alter table sm_projects add column if not exists health text;
    alter table sm_projects add column if not exists health_override text;
    alter table sm_projects add column if not exists health_reasons jsonb;
    alter table sm_projects add column if not exists schedule_status text;
    alter table sm_projects add column if not exists schedule_variance_days integer;
    alter table sm_projects add column if not exists pct_complete numeric;
    alter table sm_projects add column if not exists tasks_total integer;
    alter table sm_projects add column if not exists tasks_done integer;
    alter table sm_projects add column if not exists tasks_overdue integer;
    alter table sm_projects add column if not exists milestones_overdue integer;
    alter table sm_projects add column if not exists open_risks integer;
    alter table sm_projects add column if not exists last_status_at timestamptz;
    alter table sm_projects add column if not exists health_at timestamptz;
    alter table sm_projects add column if not exists approval text;
    alter table sm_projects add column if not exists lessons text;
    alter table sm_projects add column if not exists closure_notes text;
    alter table sm_projects add column if not exists watch_list jsonb;
    alter table sm_projects add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_projects (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRJ' || no::text else 'PRJ' || lpad(no::text, 6, '0') end) stored,
  name text,
  code text,
  type text,
  methodology text,
  priority text,
  project_manager_id uuid,
  sponsor_id uuid,
  portfolio_id uuid,
  assignment_group_id uuid,
  team jsonb,
  org_unit_id uuid,
  demand_id uuid,
  description text,
  planned_start date,
  planned_end date,
  projected_end date,
  actual_start date,
  actual_end date,
  baseline_end date,
  baseline_start date,
  baseline_taken_at timestamptz,
  est_hours numeric,
  actual_hours numeric,
  budget numeric,
  actual_cost numeric,
  objectives text,
  scope_in text,
  scope_out text,
  assumptions text,
  health text,
  health_override text,
  health_reasons jsonb,
  schedule_status text,
  schedule_variance_days integer,
  pct_complete numeric,
  tasks_total integer,
  tasks_done integer,
  tasks_overdue integer,
  milestones_overdue integer,
  open_risks integer,
  last_status_at timestamptz,
  health_at timestamptz,
  approval text,
  lessons text,
  closure_notes text,
  watch_list jsonb,
  state text,
  search_a180b3a5 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_projects', 'search_a180b3a5', $x$translate(coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_projects_search_a180b3a5_trgm', 'sm_projects', 'search_a180b3a5', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_projects_search_custom_trgm', 'sm_projects', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_projects_no_uk on sm_projects (org_id, no);
create index if not exists sm_projects_rev_idx on sm_projects (org_id, rev);
create index if not exists sm_projects_upd_idx on sm_projects (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_projects_crt_idx on sm_projects (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_projects_code_uk on sm_projects (org_id, code) where deleted_at is null;
create index if not exists sm_projects_project_manager_id_idx on sm_projects (org_id, project_manager_id) where deleted_at is null;
create index if not exists sm_projects_sponsor_id_idx on sm_projects (org_id, sponsor_id) where deleted_at is null;
create index if not exists sm_projects_portfolio_id_idx on sm_projects (org_id, portfolio_id) where deleted_at is null;
create index if not exists sm_projects_assignment_group_id_idx on sm_projects (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_projects_state_idx on sm_projects (org_id, state) where deleted_at is null;
create index if not exists sm_projects_workspace_acc_idx on sm_projects (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_projects_unit_acc_idx on sm_projects (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_projects_domain_acc_idx on sm_projects (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_projects_team_gin on sm_projects using gin (team);
create index if not exists sm_projects_watch_list_gin on sm_projects using gin (watch_list);
drop trigger if exists sm_projects_sync on sm_projects;
create trigger sm_projects_sync before insert or update on sm_projects for each row execute function sm_sync_touch('project');
create or replace trigger sm_projects_demo after insert on sm_projects for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_projects_demo_t after update or delete on sm_projects for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_projects enable row level security;

-- project_config: تنظیمات پروژه‌ها
do $cols$
begin
  if to_regclass('sm_project_configs') is not null then
    alter table sm_project_configs add column if not exists workspace_id uuid;
    alter table sm_project_configs add column if not exists domain_id uuid;
    alter table sm_project_configs add column if not exists unit_id uuid;
    alter table sm_project_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_project_configs add column if not exists created_by uuid;
    alter table sm_project_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_project_configs add column if not exists updated_by uuid;
    alter table sm_project_configs add column if not exists rev bigint not null default 0;
    alter table sm_project_configs add column if not exists version integer not null default 1;
    alter table sm_project_configs add column if not exists deleted_at timestamptz;
    alter table sm_project_configs add column if not exists origin text;
    alter table sm_project_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_project_configs add column if not exists name text;
    alter table sm_project_configs add column if not exists config_key text;
    alter table sm_project_configs add column if not exists scoring_model text;
    alter table sm_project_configs add column if not exists weekly_capacity_hours numeric;
    alter table sm_project_configs add column if not exists status_report_days integer;
    alter table sm_project_configs add column if not exists amber_variance_days integer;
    alter table sm_project_configs add column if not exists red_variance_days integer;
    alter table sm_project_configs add column if not exists red_risk_score integer;
    alter table sm_project_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_project_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  scoring_model text,
  weekly_capacity_hours numeric,
  status_report_days integer,
  amber_variance_days integer,
  red_variance_days integer,
  red_risk_score integer,
  seeded integer
);
create index if not exists sm_project_configs_rev_idx on sm_project_configs (org_id, rev);
create index if not exists sm_project_configs_upd_idx on sm_project_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_project_configs_crt_idx on sm_project_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_project_configs_config_key_uk on sm_project_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_project_configs_sync on sm_project_configs;
create trigger sm_project_configs_sync before insert or update on sm_project_configs for each row execute function sm_sync_touch('project_config');
create or replace trigger sm_project_configs_demo after insert on sm_project_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_project_configs_demo_t after update or delete on sm_project_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_project_configs enable row level security;

-- project_task: کارهای پروژه
do $cols$
begin
  if to_regclass('sm_project_tasks') is not null then
    alter table sm_project_tasks add column if not exists workspace_id uuid;
    alter table sm_project_tasks add column if not exists domain_id uuid;
    alter table sm_project_tasks add column if not exists unit_id uuid;
    alter table sm_project_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_project_tasks add column if not exists created_by uuid;
    alter table sm_project_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_project_tasks add column if not exists updated_by uuid;
    alter table sm_project_tasks add column if not exists rev bigint not null default 0;
    alter table sm_project_tasks add column if not exists version integer not null default 1;
    alter table sm_project_tasks add column if not exists deleted_at timestamptz;
    alter table sm_project_tasks add column if not exists origin text;
    alter table sm_project_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_project_tasks add column if not exists no integer;
    alter table sm_project_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_project_tasks add column if not exists short_description text;
    alter table sm_project_tasks add column if not exists project_id uuid;
    alter table sm_project_tasks add column if not exists parent_id uuid;
    alter table sm_project_tasks add column if not exists kind text;
    alter table sm_project_tasks add column if not exists wbs text;
    alter table sm_project_tasks add column if not exists sort_order integer;
    alter table sm_project_tasks add column if not exists assigned_to uuid;
    alter table sm_project_tasks add column if not exists assignment_group_id uuid;
    alter table sm_project_tasks add column if not exists planned_start date;
    alter table sm_project_tasks add column if not exists planned_end date;
    alter table sm_project_tasks add column if not exists duration_days integer;
    alter table sm_project_tasks add column if not exists depends_on jsonb;
    alter table sm_project_tasks add column if not exists lag_days integer;
    alter table sm_project_tasks add column if not exists start_no_earlier date;
    alter table sm_project_tasks add column if not exists est_hours numeric;
    alter table sm_project_tasks add column if not exists actual_hours numeric;
    alter table sm_project_tasks add column if not exists pct_complete numeric;
    alter table sm_project_tasks add column if not exists baseline_start date;
    alter table sm_project_tasks add column if not exists baseline_end date;
    alter table sm_project_tasks add column if not exists is_critical boolean not null default false;
    alter table sm_project_tasks add column if not exists float_days integer;
    alter table sm_project_tasks add column if not exists actual_start date;
    alter table sm_project_tasks add column if not exists actual_end date;
    alter table sm_project_tasks add column if not exists release_id uuid;
    alter table sm_project_tasks add column if not exists description text;
    alter table sm_project_tasks add column if not exists project_manager_id uuid;
    alter table sm_project_tasks add column if not exists watch_list jsonb;
    alter table sm_project_tasks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_project_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  project_id uuid,
  parent_id uuid,
  kind text,
  wbs text,
  sort_order integer,
  assigned_to uuid,
  assignment_group_id uuid,
  planned_start date,
  planned_end date,
  duration_days integer,
  depends_on jsonb,
  lag_days integer,
  start_no_earlier date,
  est_hours numeric,
  actual_hours numeric,
  pct_complete numeric,
  baseline_start date,
  baseline_end date,
  is_critical boolean not null default false,
  float_days integer,
  actual_start date,
  actual_end date,
  release_id uuid,
  description text,
  project_manager_id uuid,
  watch_list jsonb,
  state text,
  search_9c3826f0 text generated always as (translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_project_tasks', 'search_9c3826f0', $x$translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_project_tasks_search_9c3826f0_trgm', 'sm_project_tasks', 'search_9c3826f0', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_project_tasks_search_custom_trgm', 'sm_project_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_project_tasks_no_uk on sm_project_tasks (org_id, no);
create index if not exists sm_project_tasks_rev_idx on sm_project_tasks (org_id, rev);
create index if not exists sm_project_tasks_upd_idx on sm_project_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_project_tasks_crt_idx on sm_project_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_project_tasks_project_id_idx on sm_project_tasks (org_id, project_id) where deleted_at is null;
create index if not exists sm_project_tasks_parent_id_idx on sm_project_tasks (org_id, parent_id) where deleted_at is null;
create index if not exists sm_project_tasks_assigned_to_idx on sm_project_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_project_tasks_state_idx on sm_project_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_project_tasks_workspace_acc_idx on sm_project_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_project_tasks_unit_acc_idx on sm_project_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_project_tasks_domain_acc_idx on sm_project_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_project_tasks_project_manager_id_idx on sm_project_tasks (org_id, project_manager_id) where deleted_at is null;
create index if not exists sm_project_tasks_watch_list_gin on sm_project_tasks using gin (watch_list);
drop trigger if exists sm_project_tasks_sync on sm_project_tasks;
create trigger sm_project_tasks_sync before insert or update on sm_project_tasks for each row execute function sm_sync_touch('project_task');
create or replace trigger sm_project_tasks_demo after insert on sm_project_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_project_tasks_demo_t after update or delete on sm_project_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_project_tasks enable row level security;

-- purchase_order: سفارش‌های خرید
do $cols$
begin
  if to_regclass('sm_purchase_orders') is not null then
    alter table sm_purchase_orders add column if not exists workspace_id uuid;
    alter table sm_purchase_orders add column if not exists domain_id uuid;
    alter table sm_purchase_orders add column if not exists unit_id uuid;
    alter table sm_purchase_orders add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_orders add column if not exists created_by uuid;
    alter table sm_purchase_orders add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_orders add column if not exists updated_by uuid;
    alter table sm_purchase_orders add column if not exists rev bigint not null default 0;
    alter table sm_purchase_orders add column if not exists version integer not null default 1;
    alter table sm_purchase_orders add column if not exists deleted_at timestamptz;
    alter table sm_purchase_orders add column if not exists origin text;
    alter table sm_purchase_orders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_orders add column if not exists no integer;
    alter table sm_purchase_orders add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PO' || no::text else 'PO' || lpad(no::text, 6, '0') end) stored;
    alter table sm_purchase_orders add column if not exists title text;
    alter table sm_purchase_orders add column if not exists supplier_id uuid;
    alter table sm_purchase_orders add column if not exists requisition_id uuid;
    alter table sm_purchase_orders add column if not exists owner_id uuid;
    alter table sm_purchase_orders add column if not exists order_date date;
    alter table sm_purchase_orders add column if not exists expected_date date;
    alter table sm_purchase_orders add column if not exists delivery_stockroom_id uuid;
    alter table sm_purchase_orders add column if not exists cost_center_id uuid;
    alter table sm_purchase_orders add column if not exists currency text;
    alter table sm_purchase_orders add column if not exists fx_rate numeric;
    alter table sm_purchase_orders add column if not exists total numeric;
    alter table sm_purchase_orders add column if not exists received_at timestamptz;
    alter table sm_purchase_orders add column if not exists notes text;
    alter table sm_purchase_orders add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_purchase_orders (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PO' || no::text else 'PO' || lpad(no::text, 6, '0') end) stored,
  title text,
  supplier_id uuid,
  requisition_id uuid,
  owner_id uuid,
  order_date date,
  expected_date date,
  delivery_stockroom_id uuid,
  cost_center_id uuid,
  currency text,
  fx_rate numeric,
  total numeric,
  received_at timestamptz,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_purchase_orders', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_orders_search_cae18f1d_trgm', 'sm_purchase_orders', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_purchase_orders_search_custom_trgm', 'sm_purchase_orders', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_purchase_orders_no_uk on sm_purchase_orders (org_id, no);
create index if not exists sm_purchase_orders_rev_idx on sm_purchase_orders (org_id, rev);
create index if not exists sm_purchase_orders_upd_idx on sm_purchase_orders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_orders_crt_idx on sm_purchase_orders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_orders_supplier_id_idx on sm_purchase_orders (org_id, supplier_id) where deleted_at is null;
create index if not exists sm_purchase_orders_state_idx on sm_purchase_orders (org_id, state) where deleted_at is null;
create index if not exists sm_purchase_orders_workspace_acc_idx on sm_purchase_orders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_purchase_orders_unit_acc_idx on sm_purchase_orders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_purchase_orders_domain_acc_idx on sm_purchase_orders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_purchase_orders_owner_id_idx on sm_purchase_orders (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_purchase_orders_sync on sm_purchase_orders;
create trigger sm_purchase_orders_sync before insert or update on sm_purchase_orders for each row execute function sm_sync_touch('purchase_order');
create or replace trigger sm_purchase_orders_demo after insert on sm_purchase_orders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_orders_demo_t after update or delete on sm_purchase_orders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_orders enable row level security;

-- purchase_order_line: سطرهای سفارش خرید
do $cols$
begin
  if to_regclass('sm_purchase_order_lines') is not null then
    alter table sm_purchase_order_lines add column if not exists workspace_id uuid;
    alter table sm_purchase_order_lines add column if not exists domain_id uuid;
    alter table sm_purchase_order_lines add column if not exists unit_id uuid;
    alter table sm_purchase_order_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_order_lines add column if not exists created_by uuid;
    alter table sm_purchase_order_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_order_lines add column if not exists updated_by uuid;
    alter table sm_purchase_order_lines add column if not exists rev bigint not null default 0;
    alter table sm_purchase_order_lines add column if not exists version integer not null default 1;
    alter table sm_purchase_order_lines add column if not exists deleted_at timestamptz;
    alter table sm_purchase_order_lines add column if not exists origin text;
    alter table sm_purchase_order_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_order_lines add column if not exists po_id uuid;
    alter table sm_purchase_order_lines add column if not exists line_no integer;
    alter table sm_purchase_order_lines add column if not exists model_id uuid;
    alter table sm_purchase_order_lines add column if not exists description text;
    alter table sm_purchase_order_lines add column if not exists quantity integer;
    alter table sm_purchase_order_lines add column if not exists received_qty integer;
    alter table sm_purchase_order_lines add column if not exists unit_price numeric;
    alter table sm_purchase_order_lines add column if not exists amount numeric;
    alter table sm_purchase_order_lines add column if not exists requisition_line_id uuid;
  end if;
end
$cols$;
create table if not exists sm_purchase_order_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  po_id uuid,
  line_no integer,
  model_id uuid,
  description text,
  quantity integer,
  received_qty integer,
  unit_price numeric,
  amount numeric,
  requisition_line_id uuid
);
create index if not exists sm_purchase_order_lines_rev_idx on sm_purchase_order_lines (org_id, rev);
create index if not exists sm_purchase_order_lines_upd_idx on sm_purchase_order_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_order_lines_crt_idx on sm_purchase_order_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_order_lines_po_id_idx on sm_purchase_order_lines (org_id, po_id) where deleted_at is null;
drop trigger if exists sm_purchase_order_lines_sync on sm_purchase_order_lines;
create trigger sm_purchase_order_lines_sync before insert or update on sm_purchase_order_lines for each row execute function sm_sync_touch('purchase_order_line');
create or replace trigger sm_purchase_order_lines_demo after insert on sm_purchase_order_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_order_lines_demo_t after update or delete on sm_purchase_order_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_order_lines enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:17', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۹ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 19/28 (e746bd22eb04)
-- purchase_request: درخواست‌های خرید
do $cols$
begin
  if to_regclass('sm_purchase_requests') is not null then
    alter table sm_purchase_requests add column if not exists workspace_id uuid;
    alter table sm_purchase_requests add column if not exists domain_id uuid;
    alter table sm_purchase_requests add column if not exists unit_id uuid;
    alter table sm_purchase_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_requests add column if not exists created_by uuid;
    alter table sm_purchase_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_requests add column if not exists updated_by uuid;
    alter table sm_purchase_requests add column if not exists rev bigint not null default 0;
    alter table sm_purchase_requests add column if not exists version integer not null default 1;
    alter table sm_purchase_requests add column if not exists deleted_at timestamptz;
    alter table sm_purchase_requests add column if not exists origin text;
    alter table sm_purchase_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_requests add column if not exists no integer;
    alter table sm_purchase_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PUR' || no::text else 'PUR' || lpad(no::text, 7, '0') end) stored;
    alter table sm_purchase_requests add column if not exists short_description text;
    alter table sm_purchase_requests add column if not exists description text;
    alter table sm_purchase_requests add column if not exists state text;
    alter table sm_purchase_requests add column if not exists priority text;
    alter table sm_purchase_requests add column if not exists impact text;
    alter table sm_purchase_requests add column if not exists urgency text;
    alter table sm_purchase_requests add column if not exists category text;
    alter table sm_purchase_requests add column if not exists subcategory text;
    alter table sm_purchase_requests add column if not exists channel text;
    alter table sm_purchase_requests add column if not exists caller_id uuid;
    alter table sm_purchase_requests add column if not exists requested_for uuid;
    alter table sm_purchase_requests add column if not exists opened_by uuid;
    alter table sm_purchase_requests add column if not exists opened_at timestamptz;
    alter table sm_purchase_requests add column if not exists assignment_group_id uuid;
    alter table sm_purchase_requests add column if not exists assigned_to uuid;
    alter table sm_purchase_requests add column if not exists service_id uuid;
    alter table sm_purchase_requests add column if not exists offering_id uuid;
    alter table sm_purchase_requests add column if not exists ci_id uuid;
    alter table sm_purchase_requests add column if not exists location_id uuid;
    alter table sm_purchase_requests add column if not exists due_at timestamptz;
    alter table sm_purchase_requests add column if not exists resolved_at timestamptz;
    alter table sm_purchase_requests add column if not exists resolved_by uuid;
    alter table sm_purchase_requests add column if not exists closed_at timestamptz;
    alter table sm_purchase_requests add column if not exists closed_by uuid;
    alter table sm_purchase_requests add column if not exists close_code text;
    alter table sm_purchase_requests add column if not exists close_notes text;
    alter table sm_purchase_requests add column if not exists parent_id uuid;
    alter table sm_purchase_requests add column if not exists watch_list jsonb;
    alter table sm_purchase_requests add column if not exists approval text;
    alter table sm_purchase_requests add column if not exists escalation integer;
    alter table sm_purchase_requests add column if not exists reassignment_count integer;
    alter table sm_purchase_requests add column if not exists reopen_count integer;
    alter table sm_purchase_requests add column if not exists time_worked bigint;
    alter table sm_purchase_requests add column if not exists first_response_at timestamptz;
    alter table sm_purchase_requests add column if not exists active boolean not null default true;
    alter table sm_purchase_requests add column if not exists sla_due timestamptz;
    alter table sm_purchase_requests add column if not exists knowledge boolean not null default false;
    alter table sm_purchase_requests add column if not exists title text;
    alter table sm_purchase_requests add column if not exists department_id uuid;
    alter table sm_purchase_requests add column if not exists dept_service_id uuid;
    alter table sm_purchase_requests add column if not exists sensitive boolean not null default false;
    alter table sm_purchase_requests add column if not exists journey_id uuid;
    alter table sm_purchase_requests add column if not exists child_total integer;
    alter table sm_purchase_requests add column if not exists child_open integer;
    alter table sm_purchase_requests add column if not exists satisfaction integer;
    alter table sm_purchase_requests add column if not exists items text;
    alter table sm_purchase_requests add column if not exists amount numeric;
    alter table sm_purchase_requests add column if not exists currency text;
    alter table sm_purchase_requests add column if not exists supplier text;
    alter table sm_purchase_requests add column if not exists cost_center_id uuid;
    alter table sm_purchase_requests add column if not exists budget_line text;
    alter table sm_purchase_requests add column if not exists needed_by date;
    alter table sm_purchase_requests add column if not exists receiver_id uuid;
    alter table sm_purchase_requests add column if not exists po_number text;
    alter table sm_purchase_requests add column if not exists received_at timestamptz;
    alter table sm_purchase_requests add column if not exists receipt_notes text;
  end if;
end
$cols$;
create table if not exists sm_purchase_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PUR' || no::text else 'PUR' || lpad(no::text, 7, '0') end) stored,
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
  items text,
  amount numeric,
  currency text,
  supplier text,
  cost_center_id uuid,
  budget_line text,
  needed_by date,
  receiver_id uuid,
  po_number text,
  received_at timestamptz,
  receipt_notes text,
  search_0aff9df4 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '') || ' ' || coalesce(po_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_purchase_requests', 'search_0aff9df4', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '') || ' ' || coalesce(po_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_requests_search_0aff9df4_trgm', 'sm_purchase_requests', 'search_0aff9df4', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_purchase_requests_search_custom_trgm', 'sm_purchase_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_purchase_requests_no_uk on sm_purchase_requests (org_id, no);
create index if not exists sm_purchase_requests_rev_idx on sm_purchase_requests (org_id, rev);
create index if not exists sm_purchase_requests_upd_idx on sm_purchase_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requests_crt_idx on sm_purchase_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requests_state_idx on sm_purchase_requests (org_id, state) where deleted_at is null;
create index if not exists sm_purchase_requests_assignment_group_id_idx on sm_purchase_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_purchase_requests_assigned_to_idx on sm_purchase_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_purchase_requests_department_id_idx on sm_purchase_requests (org_id, department_id) where deleted_at is null;
create index if not exists sm_purchase_requests_dept_service_id_idx on sm_purchase_requests (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_purchase_requests_receiver_id_idx on sm_purchase_requests (org_id, receiver_id) where deleted_at is null;
create index if not exists sm_purchase_requests_workspace_acc_idx on sm_purchase_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_purchase_requests_unit_acc_idx on sm_purchase_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_purchase_requests_domain_acc_idx on sm_purchase_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_purchase_requests_caller_id_idx on sm_purchase_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_purchase_requests_requested_for_idx on sm_purchase_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_purchase_requests_opened_by_idx on sm_purchase_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_purchase_requests_watch_list_gin on sm_purchase_requests using gin (watch_list);
create index if not exists sm_purchase_requests_open_grp_idx on sm_purchase_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_purchase_requests_opened_brin on sm_purchase_requests using brin (opened_at);
drop trigger if exists sm_purchase_requests_sync on sm_purchase_requests;
create trigger sm_purchase_requests_sync before insert or update on sm_purchase_requests for each row execute function sm_sync_touch('purchase_request');
create or replace trigger sm_purchase_requests_demo after insert on sm_purchase_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_requests_demo_t after update or delete on sm_purchase_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_requests enable row level security;

-- purchase_requisition: درخواست‌های خرید
do $cols$
begin
  if to_regclass('sm_purchase_requisitions') is not null then
    alter table sm_purchase_requisitions add column if not exists workspace_id uuid;
    alter table sm_purchase_requisitions add column if not exists domain_id uuid;
    alter table sm_purchase_requisitions add column if not exists unit_id uuid;
    alter table sm_purchase_requisitions add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_requisitions add column if not exists created_by uuid;
    alter table sm_purchase_requisitions add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_requisitions add column if not exists updated_by uuid;
    alter table sm_purchase_requisitions add column if not exists rev bigint not null default 0;
    alter table sm_purchase_requisitions add column if not exists version integer not null default 1;
    alter table sm_purchase_requisitions add column if not exists deleted_at timestamptz;
    alter table sm_purchase_requisitions add column if not exists origin text;
    alter table sm_purchase_requisitions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_requisitions add column if not exists no integer;
    alter table sm_purchase_requisitions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRQ' || no::text else 'PRQ' || lpad(no::text, 6, '0') end) stored;
    alter table sm_purchase_requisitions add column if not exists title text;
    alter table sm_purchase_requisitions add column if not exists requested_for uuid;
    alter table sm_purchase_requisitions add column if not exists needed_by date;
    alter table sm_purchase_requisitions add column if not exists cost_center_id uuid;
    alter table sm_purchase_requisitions add column if not exists supplier_id uuid;
    alter table sm_purchase_requisitions add column if not exists total numeric;
    alter table sm_purchase_requisitions add column if not exists approval text;
    alter table sm_purchase_requisitions add column if not exists source text;
    alter table sm_purchase_requisitions add column if not exists request_item_id uuid;
    alter table sm_purchase_requisitions add column if not exists stock_rule_id uuid;
    alter table sm_purchase_requisitions add column if not exists purchase_order_id uuid;
    alter table sm_purchase_requisitions add column if not exists justification text;
    alter table sm_purchase_requisitions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_purchase_requisitions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRQ' || no::text else 'PRQ' || lpad(no::text, 6, '0') end) stored,
  title text,
  requested_for uuid,
  needed_by date,
  cost_center_id uuid,
  supplier_id uuid,
  total numeric,
  approval text,
  source text,
  request_item_id uuid,
  stock_rule_id uuid,
  purchase_order_id uuid,
  justification text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_purchase_requisitions', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_requisitions_search_cae18f1d_trgm', 'sm_purchase_requisitions', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_purchase_requisitions_search_custom_trgm', 'sm_purchase_requisitions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_purchase_requisitions_no_uk on sm_purchase_requisitions (org_id, no);
create index if not exists sm_purchase_requisitions_rev_idx on sm_purchase_requisitions (org_id, rev);
create index if not exists sm_purchase_requisitions_upd_idx on sm_purchase_requisitions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisitions_crt_idx on sm_purchase_requisitions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisitions_state_idx on sm_purchase_requisitions (org_id, state) where deleted_at is null;
create index if not exists sm_purchase_requisitions_workspace_acc_idx on sm_purchase_requisitions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_purchase_requisitions_unit_acc_idx on sm_purchase_requisitions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_purchase_requisitions_domain_acc_idx on sm_purchase_requisitions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_purchase_requisitions_requested_for_idx on sm_purchase_requisitions (org_id, requested_for) where deleted_at is null;
drop trigger if exists sm_purchase_requisitions_sync on sm_purchase_requisitions;
create trigger sm_purchase_requisitions_sync before insert or update on sm_purchase_requisitions for each row execute function sm_sync_touch('purchase_requisition');
create or replace trigger sm_purchase_requisitions_demo after insert on sm_purchase_requisitions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_requisitions_demo_t after update or delete on sm_purchase_requisitions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_requisitions enable row level security;

-- purchase_requisition_line: اقلام درخواست خرید
do $cols$
begin
  if to_regclass('sm_purchase_requisition_lines') is not null then
    alter table sm_purchase_requisition_lines add column if not exists workspace_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists domain_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists unit_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_requisition_lines add column if not exists created_by uuid;
    alter table sm_purchase_requisition_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_requisition_lines add column if not exists updated_by uuid;
    alter table sm_purchase_requisition_lines add column if not exists rev bigint not null default 0;
    alter table sm_purchase_requisition_lines add column if not exists version integer not null default 1;
    alter table sm_purchase_requisition_lines add column if not exists deleted_at timestamptz;
    alter table sm_purchase_requisition_lines add column if not exists origin text;
    alter table sm_purchase_requisition_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_requisition_lines add column if not exists requisition_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists model_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists description text;
    alter table sm_purchase_requisition_lines add column if not exists quantity integer;
    alter table sm_purchase_requisition_lines add column if not exists unit_price numeric;
    alter table sm_purchase_requisition_lines add column if not exists amount numeric;
  end if;
end
$cols$;
create table if not exists sm_purchase_requisition_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  requisition_id uuid,
  model_id uuid,
  description text,
  quantity integer,
  unit_price numeric,
  amount numeric
);
create index if not exists sm_purchase_requisition_lines_rev_idx on sm_purchase_requisition_lines (org_id, rev);
create index if not exists sm_purchase_requisition_lines_upd_idx on sm_purchase_requisition_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisition_lines_crt_idx on sm_purchase_requisition_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisition_lines_requisition_id_idx on sm_purchase_requisition_lines (org_id, requisition_id) where deleted_at is null;
drop trigger if exists sm_purchase_requisition_lines_sync on sm_purchase_requisition_lines;
create trigger sm_purchase_requisition_lines_sync before insert or update on sm_purchase_requisition_lines for each row execute function sm_sync_touch('purchase_requisition_line');
create or replace trigger sm_purchase_requisition_lines_demo after insert on sm_purchase_requisition_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_requisition_lines_demo_t after update or delete on sm_purchase_requisition_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_requisition_lines enable row level security;

-- raid_item: ریسک‌ها، مسئله‌ها و تصمیم‌ها
do $cols$
begin
  if to_regclass('sm_raid_items') is not null then
    alter table sm_raid_items add column if not exists workspace_id uuid;
    alter table sm_raid_items add column if not exists domain_id uuid;
    alter table sm_raid_items add column if not exists unit_id uuid;
    alter table sm_raid_items add column if not exists created_at timestamptz not null default now();
    alter table sm_raid_items add column if not exists created_by uuid;
    alter table sm_raid_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_raid_items add column if not exists updated_by uuid;
    alter table sm_raid_items add column if not exists rev bigint not null default 0;
    alter table sm_raid_items add column if not exists version integer not null default 1;
    alter table sm_raid_items add column if not exists deleted_at timestamptz;
    alter table sm_raid_items add column if not exists origin text;
    alter table sm_raid_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_raid_items add column if not exists no integer;
    alter table sm_raid_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RAID' || no::text else 'RAID' || lpad(no::text, 6, '0') end) stored;
    alter table sm_raid_items add column if not exists title text;
    alter table sm_raid_items add column if not exists kind text;
    alter table sm_raid_items add column if not exists project_id uuid;
    alter table sm_raid_items add column if not exists owner_id uuid;
    alter table sm_raid_items add column if not exists probability integer;
    alter table sm_raid_items add column if not exists impact integer;
    alter table sm_raid_items add column if not exists score integer;
    alter table sm_raid_items add column if not exists due_date date;
    alter table sm_raid_items add column if not exists description text;
    alter table sm_raid_items add column if not exists response text;
    alter table sm_raid_items add column if not exists ai_draft boolean not null default false;
    alter table sm_raid_items add column if not exists project_manager_id uuid;
    alter table sm_raid_items add column if not exists assignment_group_id uuid;
    alter table sm_raid_items add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_raid_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RAID' || no::text else 'RAID' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  project_id uuid,
  owner_id uuid,
  probability integer,
  impact integer,
  score integer,
  due_date date,
  description text,
  response text,
  ai_draft boolean not null default false,
  project_manager_id uuid,
  assignment_group_id uuid,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_raid_items', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_raid_items_search_cae18f1d_trgm', 'sm_raid_items', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_raid_items_search_custom_trgm', 'sm_raid_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_raid_items_no_uk on sm_raid_items (org_id, no);
create index if not exists sm_raid_items_rev_idx on sm_raid_items (org_id, rev);
create index if not exists sm_raid_items_upd_idx on sm_raid_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_raid_items_crt_idx on sm_raid_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_raid_items_project_id_idx on sm_raid_items (org_id, project_id) where deleted_at is null;
create index if not exists sm_raid_items_state_idx on sm_raid_items (org_id, state) where deleted_at is null;
create index if not exists sm_raid_items_workspace_acc_idx on sm_raid_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_raid_items_unit_acc_idx on sm_raid_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_raid_items_domain_acc_idx on sm_raid_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_raid_items_owner_id_idx on sm_raid_items (org_id, owner_id) where deleted_at is null;
create index if not exists sm_raid_items_project_manager_id_idx on sm_raid_items (org_id, project_manager_id) where deleted_at is null;
drop trigger if exists sm_raid_items_sync on sm_raid_items;
create trigger sm_raid_items_sync before insert or update on sm_raid_items for each row execute function sm_sync_touch('raid_item');
create or replace trigger sm_raid_items_demo after insert on sm_raid_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_raid_items_demo_t after update or delete on sm_raid_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_raid_items enable row level security;

-- release: انتشارها
do $cols$
begin
  if to_regclass('sm_releases') is not null then
    alter table sm_releases add column if not exists workspace_id uuid;
    alter table sm_releases add column if not exists domain_id uuid;
    alter table sm_releases add column if not exists unit_id uuid;
    alter table sm_releases add column if not exists created_at timestamptz not null default now();
    alter table sm_releases add column if not exists created_by uuid;
    alter table sm_releases add column if not exists updated_at timestamptz not null default now();
    alter table sm_releases add column if not exists updated_by uuid;
    alter table sm_releases add column if not exists rev bigint not null default 0;
    alter table sm_releases add column if not exists version integer not null default 1;
    alter table sm_releases add column if not exists deleted_at timestamptz;
    alter table sm_releases add column if not exists origin text;
    alter table sm_releases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_releases add column if not exists no integer;
    alter table sm_releases add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REL' || no::text else 'REL' || lpad(no::text, 7, '0') end) stored;
    alter table sm_releases add column if not exists short_description text;
    alter table sm_releases add column if not exists description text;
    alter table sm_releases add column if not exists state text;
    alter table sm_releases add column if not exists priority text;
    alter table sm_releases add column if not exists impact text;
    alter table sm_releases add column if not exists urgency text;
    alter table sm_releases add column if not exists category text;
    alter table sm_releases add column if not exists subcategory text;
    alter table sm_releases add column if not exists channel text;
    alter table sm_releases add column if not exists caller_id uuid;
    alter table sm_releases add column if not exists requested_for uuid;
    alter table sm_releases add column if not exists opened_by uuid;
    alter table sm_releases add column if not exists opened_at timestamptz;
    alter table sm_releases add column if not exists assignment_group_id uuid;
    alter table sm_releases add column if not exists assigned_to uuid;
    alter table sm_releases add column if not exists service_id uuid;
    alter table sm_releases add column if not exists offering_id uuid;
    alter table sm_releases add column if not exists ci_id uuid;
    alter table sm_releases add column if not exists location_id uuid;
    alter table sm_releases add column if not exists due_at timestamptz;
    alter table sm_releases add column if not exists resolved_at timestamptz;
    alter table sm_releases add column if not exists resolved_by uuid;
    alter table sm_releases add column if not exists closed_at timestamptz;
    alter table sm_releases add column if not exists closed_by uuid;
    alter table sm_releases add column if not exists close_code text;
    alter table sm_releases add column if not exists close_notes text;
    alter table sm_releases add column if not exists parent_id uuid;
    alter table sm_releases add column if not exists watch_list jsonb;
    alter table sm_releases add column if not exists approval text;
    alter table sm_releases add column if not exists escalation integer;
    alter table sm_releases add column if not exists reassignment_count integer;
    alter table sm_releases add column if not exists reopen_count integer;
    alter table sm_releases add column if not exists time_worked bigint;
    alter table sm_releases add column if not exists first_response_at timestamptz;
    alter table sm_releases add column if not exists active boolean not null default true;
    alter table sm_releases add column if not exists sla_due timestamptz;
    alter table sm_releases add column if not exists knowledge boolean not null default false;
    alter table sm_releases add column if not exists version_name text;
    alter table sm_releases add column if not exists type text;
    alter table sm_releases add column if not exists template_id uuid;
    alter table sm_releases add column if not exists release_manager_id uuid;
    alter table sm_releases add column if not exists parent_release_id uuid;
    alter table sm_releases add column if not exists project_id uuid;
    alter table sm_releases add column if not exists stakeholders jsonb;
    alter table sm_releases add column if not exists affected_cis jsonb;
    alter table sm_releases add column if not exists affected_services jsonb;
    alter table sm_releases add column if not exists impacted_services jsonb;
    alter table sm_releases add column if not exists known_errors_accepted jsonb;
    alter table sm_releases add column if not exists changes_total integer;
    alter table sm_releases add column if not exists changes_open integer;
    alter table sm_releases add column if not exists problems_fixed integer;
    alter table sm_releases add column if not exists planned_start timestamptz;
    alter table sm_releases add column if not exists planned_end timestamptz;
    alter table sm_releases add column if not exists readiness_target_at timestamptz;
    alter table sm_releases add column if not exists window_id uuid;
    alter table sm_releases add column if not exists actual_start timestamptz;
    alter table sm_releases add column if not exists actual_end timestamptz;
    alter table sm_releases add column if not exists deployed_at timestamptz;
    alter table sm_releases add column if not exists released_at timestamptz;
    alter table sm_releases add column if not exists els_days integer;
    alter table sm_releases add column if not exists els_end_at timestamptz;
    alter table sm_releases add column if not exists hold_reason text;
    alter table sm_releases add column if not exists frozen_until timestamptz;
    alter table sm_releases add column if not exists build_plan text;
    alter table sm_releases add column if not exists test_plan text;
    alter table sm_releases add column if not exists deployment_plan text;
    alter table sm_releases add column if not exists rollback_plan text;
    alter table sm_releases add column if not exists communication_plan text;
    alter table sm_releases add column if not exists release_notes text;
    alter table sm_releases add column if not exists go_no_go text;
    alter table sm_releases add column if not exists go_no_go_at timestamptz;
    alter table sm_releases add column if not exists go_conditions text;
    alter table sm_releases add column if not exists checks_total integer;
    alter table sm_releases add column if not exists checks_failed integer;
    alter table sm_releases add column if not exists checks_pending integer;
    alter table sm_releases add column if not exists readiness_pct integer;
    alter table sm_releases add column if not exists checks_run_at timestamptz;
    alter table sm_releases add column if not exists risk_score integer;
    alter table sm_releases add column if not exists risk_band text;
    alter table sm_releases add column if not exists risk_factors jsonb;
    alter table sm_releases add column if not exists lessons text;
    alter table sm_releases add column if not exists els_incidents integer;
    alter table sm_releases add column if not exists rolled_back boolean not null default false;
    alter table sm_releases add column if not exists on_schedule boolean not null default false;
    alter table sm_releases add column if not exists state_before_hold text;
  end if;
end
$cols$;
create table if not exists sm_releases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REL' || no::text else 'REL' || lpad(no::text, 7, '0') end) stored,
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
  version_name text,
  type text,
  template_id uuid,
  release_manager_id uuid,
  parent_release_id uuid,
  project_id uuid,
  stakeholders jsonb,
  affected_cis jsonb,
  affected_services jsonb,
  impacted_services jsonb,
  known_errors_accepted jsonb,
  changes_total integer,
  changes_open integer,
  problems_fixed integer,
  planned_start timestamptz,
  planned_end timestamptz,
  readiness_target_at timestamptz,
  window_id uuid,
  actual_start timestamptz,
  actual_end timestamptz,
  deployed_at timestamptz,
  released_at timestamptz,
  els_days integer,
  els_end_at timestamptz,
  hold_reason text,
  frozen_until timestamptz,
  build_plan text,
  test_plan text,
  deployment_plan text,
  rollback_plan text,
  communication_plan text,
  release_notes text,
  go_no_go text,
  go_no_go_at timestamptz,
  go_conditions text,
  checks_total integer,
  checks_failed integer,
  checks_pending integer,
  readiness_pct integer,
  checks_run_at timestamptz,
  risk_score integer,
  risk_band text,
  risk_factors jsonb,
  lessons text,
  els_incidents integer,
  rolled_back boolean not null default false,
  on_schedule boolean not null default false,
  state_before_hold text,
  search_9202f273 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(version_name, '') || ' ' || coalesce(release_notes, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_releases', 'search_9202f273', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(version_name, '') || ' ' || coalesce(release_notes, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_releases_search_9202f273_trgm', 'sm_releases', 'search_9202f273', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_releases_search_custom_trgm', 'sm_releases', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_releases_no_uk on sm_releases (org_id, no);
create index if not exists sm_releases_rev_idx on sm_releases (org_id, rev);
create index if not exists sm_releases_upd_idx on sm_releases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_releases_crt_idx on sm_releases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_releases_state_idx on sm_releases (org_id, state) where deleted_at is null;
create index if not exists sm_releases_assignment_group_id_idx on sm_releases (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_releases_assigned_to_idx on sm_releases (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_releases_type_idx on sm_releases (org_id, type) where deleted_at is null;
create index if not exists sm_releases_release_manager_id_idx on sm_releases (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_releases_parent_release_id_idx on sm_releases (org_id, parent_release_id) where deleted_at is null;
create index if not exists sm_releases_project_id_idx on sm_releases (org_id, project_id) where deleted_at is null;
create index if not exists sm_releases_planned_start_idx on sm_releases (org_id, planned_start) where deleted_at is null;
create index if not exists sm_releases_planned_end_idx on sm_releases (org_id, planned_end) where deleted_at is null;
create index if not exists sm_releases_workspace_acc_idx on sm_releases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_releases_unit_acc_idx on sm_releases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_releases_domain_acc_idx on sm_releases (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_releases_caller_id_idx on sm_releases (org_id, caller_id) where deleted_at is null;
create index if not exists sm_releases_requested_for_idx on sm_releases (org_id, requested_for) where deleted_at is null;
create index if not exists sm_releases_opened_by_idx on sm_releases (org_id, opened_by) where deleted_at is null;
create index if not exists sm_releases_watch_list_gin on sm_releases using gin (watch_list);
create index if not exists sm_releases_open_grp_idx on sm_releases (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_releases_opened_brin on sm_releases using brin (opened_at);
drop trigger if exists sm_releases_sync on sm_releases;
create trigger sm_releases_sync before insert or update on sm_releases for each row execute function sm_sync_touch('release');
create or replace trigger sm_releases_demo after insert on sm_releases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_releases_demo_t after update or delete on sm_releases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_releases enable row level security;

-- release_check: بررسی‌های آمادگی
do $cols$
begin
  if to_regclass('sm_release_checks') is not null then
    alter table sm_release_checks add column if not exists workspace_id uuid;
    alter table sm_release_checks add column if not exists domain_id uuid;
    alter table sm_release_checks add column if not exists unit_id uuid;
    alter table sm_release_checks add column if not exists created_at timestamptz not null default now();
    alter table sm_release_checks add column if not exists created_by uuid;
    alter table sm_release_checks add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_checks add column if not exists updated_by uuid;
    alter table sm_release_checks add column if not exists rev bigint not null default 0;
    alter table sm_release_checks add column if not exists version integer not null default 1;
    alter table sm_release_checks add column if not exists deleted_at timestamptz;
    alter table sm_release_checks add column if not exists origin text;
    alter table sm_release_checks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_checks add column if not exists name text;
    alter table sm_release_checks add column if not exists key text;
    alter table sm_release_checks add column if not exists rule text;
    alter table sm_release_checks add column if not exists phase text;
    alter table sm_release_checks add column if not exists blocking boolean not null default true;
    alter table sm_release_checks add column if not exists condition jsonb;
    alter table sm_release_checks add column if not exists types jsonb;
    alter table sm_release_checks add column if not exists sort_order integer;
    alter table sm_release_checks add column if not exists active boolean not null default true;
    alter table sm_release_checks add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_release_checks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  rule text,
  phase text,
  blocking boolean not null default true,
  condition jsonb,
  types jsonb,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_release_checks_rev_idx on sm_release_checks (org_id, rev);
create index if not exists sm_release_checks_upd_idx on sm_release_checks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_checks_crt_idx on sm_release_checks (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_release_checks_key_uk on sm_release_checks (org_id, key) where deleted_at is null;
drop trigger if exists sm_release_checks_sync on sm_release_checks;
create trigger sm_release_checks_sync before insert or update on sm_release_checks for each row execute function sm_sync_touch('release_check');
create or replace trigger sm_release_checks_demo after insert on sm_release_checks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_checks_demo_t after update or delete on sm_release_checks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_checks enable row level security;

-- release_check_result: نتیجه‌های بررسی آمادگی
do $cols$
begin
  if to_regclass('sm_release_check_results') is not null then
    alter table sm_release_check_results add column if not exists workspace_id uuid;
    alter table sm_release_check_results add column if not exists domain_id uuid;
    alter table sm_release_check_results add column if not exists unit_id uuid;
    alter table sm_release_check_results add column if not exists created_at timestamptz not null default now();
    alter table sm_release_check_results add column if not exists created_by uuid;
    alter table sm_release_check_results add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_check_results add column if not exists updated_by uuid;
    alter table sm_release_check_results add column if not exists rev bigint not null default 0;
    alter table sm_release_check_results add column if not exists version integer not null default 1;
    alter table sm_release_check_results add column if not exists deleted_at timestamptz;
    alter table sm_release_check_results add column if not exists origin text;
    alter table sm_release_check_results add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_check_results add column if not exists release_id uuid;
    alter table sm_release_check_results add column if not exists check_id uuid;
    alter table sm_release_check_results add column if not exists name text;
    alter table sm_release_check_results add column if not exists rule text;
    alter table sm_release_check_results add column if not exists phase text;
    alter table sm_release_check_results add column if not exists blocking boolean not null default true;
    alter table sm_release_check_results add column if not exists status text;
    alter table sm_release_check_results add column if not exists message text;
    alter table sm_release_check_results add column if not exists evidence text;
    alter table sm_release_check_results add column if not exists evaluated_at timestamptz;
    alter table sm_release_check_results add column if not exists checked_by uuid;
    alter table sm_release_check_results add column if not exists waiver_reason text;
    alter table sm_release_check_results add column if not exists waived_by uuid;
    alter table sm_release_check_results add column if not exists assignment_group_id uuid;
    alter table sm_release_check_results add column if not exists assigned_to uuid;
    alter table sm_release_check_results add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_check_results (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  release_id uuid,
  check_id uuid,
  name text,
  rule text,
  phase text,
  blocking boolean not null default true,
  status text,
  message text,
  evidence text,
  evaluated_at timestamptz,
  checked_by uuid,
  waiver_reason text,
  waived_by uuid,
  assignment_group_id uuid,
  assigned_to uuid,
  release_manager_id uuid
);
create index if not exists sm_release_check_results_rev_idx on sm_release_check_results (org_id, rev);
create index if not exists sm_release_check_results_upd_idx on sm_release_check_results (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_check_results_crt_idx on sm_release_check_results (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_check_results_release_id_idx on sm_release_check_results (org_id, release_id) where deleted_at is null;
create unique index if not exists sm_release_check_results_release_id_check_id_uk on sm_release_check_results (org_id, release_id, check_id) where deleted_at is null;
create index if not exists sm_release_check_results_workspace_acc_idx on sm_release_check_results (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_check_results_unit_acc_idx on sm_release_check_results (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_check_results_domain_acc_idx on sm_release_check_results (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_check_results_release_manager_id_idx on sm_release_check_results (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_check_results_assigned_to_idx on sm_release_check_results (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_release_check_results_sync on sm_release_check_results;
create trigger sm_release_check_results_sync before insert or update on sm_release_check_results for each row execute function sm_sync_touch('release_check_result');
create or replace trigger sm_release_check_results_demo after insert on sm_release_check_results for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_check_results_demo_t after update or delete on sm_release_check_results for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_check_results enable row level security;

-- release_config: تنظیمات انتشار
do $cols$
begin
  if to_regclass('sm_release_configs') is not null then
    alter table sm_release_configs add column if not exists workspace_id uuid;
    alter table sm_release_configs add column if not exists domain_id uuid;
    alter table sm_release_configs add column if not exists unit_id uuid;
    alter table sm_release_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_release_configs add column if not exists created_by uuid;
    alter table sm_release_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_configs add column if not exists updated_by uuid;
    alter table sm_release_configs add column if not exists rev bigint not null default 0;
    alter table sm_release_configs add column if not exists version integer not null default 1;
    alter table sm_release_configs add column if not exists deleted_at timestamptz;
    alter table sm_release_configs add column if not exists origin text;
    alter table sm_release_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_configs add column if not exists name text;
    alter table sm_release_configs add column if not exists config_key text;
    alter table sm_release_configs add column if not exists els_days integer;
    alter table sm_release_configs add column if not exists failure_window_hours integer;
    alter table sm_release_configs add column if not exists auto_advance boolean not null default true;
    alter table sm_release_configs add column if not exists release_on_production boolean not null default true;
    alter table sm_release_configs add column if not exists update_cmdb_versions boolean not null default true;
    alter table sm_release_configs add column if not exists tag_els_incidents boolean not null default true;
    alter table sm_release_configs add column if not exists default_change_template_id uuid;
    alter table sm_release_configs add column if not exists dora_days integer;
    alter table sm_release_configs add column if not exists dora_definitions jsonb;
    alter table sm_release_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_release_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  els_days integer,
  failure_window_hours integer,
  auto_advance boolean not null default true,
  release_on_production boolean not null default true,
  update_cmdb_versions boolean not null default true,
  tag_els_incidents boolean not null default true,
  default_change_template_id uuid,
  dora_days integer,
  dora_definitions jsonb,
  seeded integer
);
create index if not exists sm_release_configs_rev_idx on sm_release_configs (org_id, rev);
create index if not exists sm_release_configs_upd_idx on sm_release_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_configs_crt_idx on sm_release_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_release_configs_config_key_uk on sm_release_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_release_configs_sync on sm_release_configs;
create trigger sm_release_configs_sync before insert or update on sm_release_configs for each row execute function sm_sync_touch('release_config');
create or replace trigger sm_release_configs_demo after insert on sm_release_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_configs_demo_t after update or delete on sm_release_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_configs enable row level security;

-- release_decision: تصمیم‌های اجرا
do $cols$
begin
  if to_regclass('sm_release_decisions') is not null then
    alter table sm_release_decisions add column if not exists workspace_id uuid;
    alter table sm_release_decisions add column if not exists domain_id uuid;
    alter table sm_release_decisions add column if not exists unit_id uuid;
    alter table sm_release_decisions add column if not exists created_at timestamptz not null default now();
    alter table sm_release_decisions add column if not exists created_by uuid;
    alter table sm_release_decisions add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_decisions add column if not exists updated_by uuid;
    alter table sm_release_decisions add column if not exists rev bigint not null default 0;
    alter table sm_release_decisions add column if not exists version integer not null default 1;
    alter table sm_release_decisions add column if not exists deleted_at timestamptz;
    alter table sm_release_decisions add column if not exists origin text;
    alter table sm_release_decisions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_decisions add column if not exists release_id uuid;
    alter table sm_release_decisions add column if not exists decision text;
    alter table sm_release_decisions add column if not exists conditions text;
    alter table sm_release_decisions add column if not exists rationale text;
    alter table sm_release_decisions add column if not exists decided_by uuid;
    alter table sm_release_decisions add column if not exists decided_at timestamptz;
    alter table sm_release_decisions add column if not exists via text;
    alter table sm_release_decisions add column if not exists snapshot jsonb;
    alter table sm_release_decisions add column if not exists assignment_group_id uuid;
    alter table sm_release_decisions add column if not exists assigned_to uuid;
    alter table sm_release_decisions add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_decisions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  release_id uuid,
  decision text,
  conditions text,
  rationale text,
  decided_by uuid,
  decided_at timestamptz,
  via text,
  snapshot jsonb,
  assignment_group_id uuid,
  assigned_to uuid,
  release_manager_id uuid
);
create index if not exists sm_release_decisions_rev_idx on sm_release_decisions (org_id, rev);
create index if not exists sm_release_decisions_upd_idx on sm_release_decisions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_decisions_crt_idx on sm_release_decisions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_decisions_release_id_idx on sm_release_decisions (org_id, release_id) where deleted_at is null;
create index if not exists sm_release_decisions_workspace_acc_idx on sm_release_decisions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_decisions_unit_acc_idx on sm_release_decisions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_decisions_domain_acc_idx on sm_release_decisions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_decisions_release_manager_id_idx on sm_release_decisions (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_decisions_assigned_to_idx on sm_release_decisions (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_release_decisions_sync on sm_release_decisions;
create trigger sm_release_decisions_sync before insert or update on sm_release_decisions for each row execute function sm_sync_touch('release_decision');
create or replace trigger sm_release_decisions_demo after insert on sm_release_decisions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_decisions_demo_t after update or delete on sm_release_decisions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_decisions enable row level security;

-- release_environment: محیط‌ها
do $cols$
begin
  if to_regclass('sm_release_environments') is not null then
    alter table sm_release_environments add column if not exists workspace_id uuid;
    alter table sm_release_environments add column if not exists domain_id uuid;
    alter table sm_release_environments add column if not exists unit_id uuid;
    alter table sm_release_environments add column if not exists created_at timestamptz not null default now();
    alter table sm_release_environments add column if not exists created_by uuid;
    alter table sm_release_environments add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_environments add column if not exists updated_by uuid;
    alter table sm_release_environments add column if not exists rev bigint not null default 0;
    alter table sm_release_environments add column if not exists version integer not null default 1;
    alter table sm_release_environments add column if not exists deleted_at timestamptz;
    alter table sm_release_environments add column if not exists origin text;
    alter table sm_release_environments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_environments add column if not exists name text;
    alter table sm_release_environments add column if not exists key text;
    alter table sm_release_environments add column if not exists kind text;
    alter table sm_release_environments add column if not exists aliases jsonb;
    alter table sm_release_environments add column if not exists protection text;
    alter table sm_release_environments add column if not exists sort_order integer;
    alter table sm_release_environments add column if not exists allowed_data jsonb;
    alter table sm_release_environments add column if not exists owner_id uuid;
    alter table sm_release_environments add column if not exists assignment_group_id uuid;
    alter table sm_release_environments add column if not exists ci_id uuid;
    alter table sm_release_environments add column if not exists bookable boolean not null default false;
    alter table sm_release_environments add column if not exists color text;
    alter table sm_release_environments add column if not exists active boolean not null default true;
    alter table sm_release_environments add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_release_environments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  aliases jsonb,
  protection text,
  sort_order integer,
  allowed_data jsonb,
  owner_id uuid,
  assignment_group_id uuid,
  ci_id uuid,
  bookable boolean not null default false,
  color text,
  active boolean not null default true,
  description text
);
create index if not exists sm_release_environments_rev_idx on sm_release_environments (org_id, rev);
create index if not exists sm_release_environments_upd_idx on sm_release_environments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_environments_crt_idx on sm_release_environments (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_release_environments_key_uk on sm_release_environments (org_id, key) where deleted_at is null;
drop trigger if exists sm_release_environments_sync on sm_release_environments;
create trigger sm_release_environments_sync before insert or update on sm_release_environments for each row execute function sm_sync_touch('release_environment');
create or replace trigger sm_release_environments_demo after insert on sm_release_environments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_environments_demo_t after update or delete on sm_release_environments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_environments enable row level security;

-- release_note: یادداشت‌های انتشار
do $cols$
begin
  if to_regclass('sm_release_notes') is not null then
    alter table sm_release_notes add column if not exists workspace_id uuid;
    alter table sm_release_notes add column if not exists domain_id uuid;
    alter table sm_release_notes add column if not exists unit_id uuid;
    alter table sm_release_notes add column if not exists created_at timestamptz not null default now();
    alter table sm_release_notes add column if not exists created_by uuid;
    alter table sm_release_notes add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_notes add column if not exists updated_by uuid;
    alter table sm_release_notes add column if not exists rev bigint not null default 0;
    alter table sm_release_notes add column if not exists version integer not null default 1;
    alter table sm_release_notes add column if not exists deleted_at timestamptz;
    alter table sm_release_notes add column if not exists origin text;
    alter table sm_release_notes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_notes add column if not exists release_id uuid;
    alter table sm_release_notes add column if not exists title text;
    alter table sm_release_notes add column if not exists audience text;
    alter table sm_release_notes add column if not exists language text;
    alter table sm_release_notes add column if not exists state text;
    alter table sm_release_notes add column if not exists body text;
    alter table sm_release_notes add column if not exists sources jsonb;
    alter table sm_release_notes add column if not exists ai_generated boolean not null default false;
    alter table sm_release_notes add column if not exists published_at timestamptz;
    alter table sm_release_notes add column if not exists published_by uuid;
    alter table sm_release_notes add column if not exists audience_users jsonb;
    alter table sm_release_notes add column if not exists assignment_group_id uuid;
    alter table sm_release_notes add column if not exists assigned_to uuid;
    alter table sm_release_notes add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_notes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  release_id uuid,
  title text,
  audience text,
  language text,
  state text,
  body text,
  sources jsonb,
  ai_generated boolean not null default false,
  published_at timestamptz,
  published_by uuid,
  audience_users jsonb,
  assignment_group_id uuid,
  assigned_to uuid,
  release_manager_id uuid
);
create index if not exists sm_release_notes_rev_idx on sm_release_notes (org_id, rev);
create index if not exists sm_release_notes_upd_idx on sm_release_notes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_notes_crt_idx on sm_release_notes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_notes_release_id_idx on sm_release_notes (org_id, release_id) where deleted_at is null;
create index if not exists sm_release_notes_workspace_acc_idx on sm_release_notes (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_notes_unit_acc_idx on sm_release_notes (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_notes_domain_acc_idx on sm_release_notes (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_notes_release_manager_id_idx on sm_release_notes (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_notes_assigned_to_idx on sm_release_notes (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_release_notes_sync on sm_release_notes;
create trigger sm_release_notes_sync before insert or update on sm_release_notes for each row execute function sm_sync_touch('release_note');
create or replace trigger sm_release_notes_demo after insert on sm_release_notes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_notes_demo_t after update or delete on sm_release_notes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_notes enable row level security;

-- release_policy: خط‌مشی‌های انتشار
do $cols$
begin
  if to_regclass('sm_release_policies') is not null then
    alter table sm_release_policies add column if not exists workspace_id uuid;
    alter table sm_release_policies add column if not exists domain_id uuid;
    alter table sm_release_policies add column if not exists unit_id uuid;
    alter table sm_release_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_release_policies add column if not exists created_by uuid;
    alter table sm_release_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_policies add column if not exists updated_by uuid;
    alter table sm_release_policies add column if not exists rev bigint not null default 0;
    alter table sm_release_policies add column if not exists version integer not null default 1;
    alter table sm_release_policies add column if not exists deleted_at timestamptz;
    alter table sm_release_policies add column if not exists origin text;
    alter table sm_release_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_policies add column if not exists name text;
    alter table sm_release_policies add column if not exists type text;
    alter table sm_release_policies add column if not exists cadence text;
    alter table sm_release_policies add column if not exists mandatory_checks jsonb;
    alter table sm_release_policies add column if not exists go_no_go_required boolean not null default true;
    alter table sm_release_policies add column if not exists els_days integer;
    alter table sm_release_policies add column if not exists min_lead_days integer;
    alter table sm_release_policies add column if not exists transition_package boolean not null default false;
    alter table sm_release_policies add column if not exists procedure text;
    alter table sm_release_policies add column if not exists revision integer;
    alter table sm_release_policies add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_release_policies (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  cadence text,
  mandatory_checks jsonb,
  go_no_go_required boolean not null default true,
  els_days integer,
  min_lead_days integer,
  transition_package boolean not null default false,
  procedure text,
  revision integer,
  active boolean not null default true
);
create index if not exists sm_release_policies_rev_idx on sm_release_policies (org_id, rev);
create index if not exists sm_release_policies_upd_idx on sm_release_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_policies_crt_idx on sm_release_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_release_policies_sync on sm_release_policies;
create trigger sm_release_policies_sync before insert or update on sm_release_policies for each row execute function sm_sync_touch('release_policy');
create or replace trigger sm_release_policies_demo after insert on sm_release_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_policies_demo_t after update or delete on sm_release_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_policies enable row level security;

-- release_task: کارهای انتشار
do $cols$
begin
  if to_regclass('sm_release_tasks') is not null then
    alter table sm_release_tasks add column if not exists workspace_id uuid;
    alter table sm_release_tasks add column if not exists domain_id uuid;
    alter table sm_release_tasks add column if not exists unit_id uuid;
    alter table sm_release_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_release_tasks add column if not exists created_by uuid;
    alter table sm_release_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_tasks add column if not exists updated_by uuid;
    alter table sm_release_tasks add column if not exists rev bigint not null default 0;
    alter table sm_release_tasks add column if not exists version integer not null default 1;
    alter table sm_release_tasks add column if not exists deleted_at timestamptz;
    alter table sm_release_tasks add column if not exists origin text;
    alter table sm_release_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_tasks add column if not exists no integer;
    alter table sm_release_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTASK' || no::text else 'RTASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_release_tasks add column if not exists short_description text;
    alter table sm_release_tasks add column if not exists description text;
    alter table sm_release_tasks add column if not exists state text;
    alter table sm_release_tasks add column if not exists priority text;
    alter table sm_release_tasks add column if not exists impact text;
    alter table sm_release_tasks add column if not exists urgency text;
    alter table sm_release_tasks add column if not exists category text;
    alter table sm_release_tasks add column if not exists subcategory text;
    alter table sm_release_tasks add column if not exists channel text;
    alter table sm_release_tasks add column if not exists caller_id uuid;
    alter table sm_release_tasks add column if not exists requested_for uuid;
    alter table sm_release_tasks add column if not exists opened_by uuid;
    alter table sm_release_tasks add column if not exists opened_at timestamptz;
    alter table sm_release_tasks add column if not exists assignment_group_id uuid;
    alter table sm_release_tasks add column if not exists assigned_to uuid;
    alter table sm_release_tasks add column if not exists service_id uuid;
    alter table sm_release_tasks add column if not exists offering_id uuid;
    alter table sm_release_tasks add column if not exists ci_id uuid;
    alter table sm_release_tasks add column if not exists location_id uuid;
    alter table sm_release_tasks add column if not exists due_at timestamptz;
    alter table sm_release_tasks add column if not exists resolved_at timestamptz;
    alter table sm_release_tasks add column if not exists resolved_by uuid;
    alter table sm_release_tasks add column if not exists closed_at timestamptz;
    alter table sm_release_tasks add column if not exists closed_by uuid;
    alter table sm_release_tasks add column if not exists close_code text;
    alter table sm_release_tasks add column if not exists close_notes text;
    alter table sm_release_tasks add column if not exists parent_id uuid;
    alter table sm_release_tasks add column if not exists watch_list jsonb;
    alter table sm_release_tasks add column if not exists approval text;
    alter table sm_release_tasks add column if not exists escalation integer;
    alter table sm_release_tasks add column if not exists reassignment_count integer;
    alter table sm_release_tasks add column if not exists reopen_count integer;
    alter table sm_release_tasks add column if not exists time_worked bigint;
    alter table sm_release_tasks add column if not exists first_response_at timestamptz;
    alter table sm_release_tasks add column if not exists active boolean not null default true;
    alter table sm_release_tasks add column if not exists sla_due timestamptz;
    alter table sm_release_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_release_tasks add column if not exists release_id uuid;
    alter table sm_release_tasks add column if not exists phase text;
    alter table sm_release_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_release_tasks add column if not exists depends_on jsonb;
    alter table sm_release_tasks add column if not exists sort_order integer;
    alter table sm_release_tasks add column if not exists planned_hours numeric;
    alter table sm_release_tasks add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTASK' || no::text else 'RTASK' || lpad(no::text, 7, '0') end) stored,
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
  phase text,
  mandatory boolean not null default true,
  depends_on jsonb,
  sort_order integer,
  planned_hours numeric,
  release_manager_id uuid,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_release_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_release_tasks_search_f3bce210_trgm', 'sm_release_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_release_tasks_search_custom_trgm', 'sm_release_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_release_tasks_no_uk on sm_release_tasks (org_id, no);
create index if not exists sm_release_tasks_rev_idx on sm_release_tasks (org_id, rev);
create index if not exists sm_release_tasks_upd_idx on sm_release_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_tasks_crt_idx on sm_release_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_tasks_state_idx on sm_release_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_release_tasks_assignment_group_id_idx on sm_release_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_release_tasks_assigned_to_idx on sm_release_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_release_tasks_release_id_idx on sm_release_tasks (org_id, release_id) where deleted_at is null;
create index if not exists sm_release_tasks_workspace_acc_idx on sm_release_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_tasks_unit_acc_idx on sm_release_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_tasks_domain_acc_idx on sm_release_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_tasks_caller_id_idx on sm_release_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_release_tasks_requested_for_idx on sm_release_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_release_tasks_opened_by_idx on sm_release_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_release_tasks_release_manager_id_idx on sm_release_tasks (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_tasks_watch_list_gin on sm_release_tasks using gin (watch_list);
create index if not exists sm_release_tasks_open_grp_idx on sm_release_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_release_tasks_opened_brin on sm_release_tasks using brin (opened_at);
drop trigger if exists sm_release_tasks_sync on sm_release_tasks;
create trigger sm_release_tasks_sync before insert or update on sm_release_tasks for each row execute function sm_sync_touch('release_task');
create or replace trigger sm_release_tasks_demo after insert on sm_release_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_tasks_demo_t after update or delete on sm_release_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_tasks enable row level security;

-- release_template: الگوهای انتشار
do $cols$
begin
  if to_regclass('sm_release_templates') is not null then
    alter table sm_release_templates add column if not exists workspace_id uuid;
    alter table sm_release_templates add column if not exists domain_id uuid;
    alter table sm_release_templates add column if not exists unit_id uuid;
    alter table sm_release_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_release_templates add column if not exists created_by uuid;
    alter table sm_release_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_templates add column if not exists updated_by uuid;
    alter table sm_release_templates add column if not exists rev bigint not null default 0;
    alter table sm_release_templates add column if not exists version integer not null default 1;
    alter table sm_release_templates add column if not exists deleted_at timestamptz;
    alter table sm_release_templates add column if not exists origin text;
    alter table sm_release_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_templates add column if not exists name text;
    alter table sm_release_templates add column if not exists type text;
    alter table sm_release_templates add column if not exists description text;
    alter table sm_release_templates add column if not exists tasks jsonb;
    alter table sm_release_templates add column if not exists checks jsonb;
    alter table sm_release_templates add column if not exists build_plan text;
    alter table sm_release_templates add column if not exists test_plan text;
    alter table sm_release_templates add column if not exists deployment_plan text;
    alter table sm_release_templates add column if not exists rollback_plan text;
    alter table sm_release_templates add column if not exists communication_plan text;
    alter table sm_release_templates add column if not exists els_days integer;
    alter table sm_release_templates add column if not exists services jsonb;
    alter table sm_release_templates add column if not exists revision integer;
    alter table sm_release_templates add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_release_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  description text,
  tasks jsonb,
  checks jsonb,
  build_plan text,
  test_plan text,
  deployment_plan text,
  rollback_plan text,
  communication_plan text,
  els_days integer,
  services jsonb,
  revision integer,
  active boolean not null default true
);
create index if not exists sm_release_templates_rev_idx on sm_release_templates (org_id, rev);
create index if not exists sm_release_templates_upd_idx on sm_release_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_templates_crt_idx on sm_release_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_release_templates_sync on sm_release_templates;
create trigger sm_release_templates_sync before insert or update on sm_release_templates for each row execute function sm_sync_touch('release_template');
create or replace trigger sm_release_templates_demo after insert on sm_release_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_templates_demo_t after update or delete on sm_release_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_templates enable row level security;

-- release_window: پنجره‌های انتشار
do $cols$
begin
  if to_regclass('sm_release_windows') is not null then
    alter table sm_release_windows add column if not exists workspace_id uuid;
    alter table sm_release_windows add column if not exists domain_id uuid;
    alter table sm_release_windows add column if not exists unit_id uuid;
    alter table sm_release_windows add column if not exists created_at timestamptz not null default now();
    alter table sm_release_windows add column if not exists created_by uuid;
    alter table sm_release_windows add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_windows add column if not exists updated_by uuid;
    alter table sm_release_windows add column if not exists rev bigint not null default 0;
    alter table sm_release_windows add column if not exists version integer not null default 1;
    alter table sm_release_windows add column if not exists deleted_at timestamptz;
    alter table sm_release_windows add column if not exists origin text;
    alter table sm_release_windows add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_windows add column if not exists name text;
    alter table sm_release_windows add column if not exists kind text;
    alter table sm_release_windows add column if not exists capacity integer;
    alter table sm_release_windows add column if not exists start_at timestamptz;
    alter table sm_release_windows add column if not exists end_at timestamptz;
    alter table sm_release_windows add column if not exists recurrence text;
    alter table sm_release_windows add column if not exists weekdays jsonb;
    alter table sm_release_windows add column if not exists until date;
    alter table sm_release_windows add column if not exists types jsonb;
    alter table sm_release_windows add column if not exists services jsonb;
    alter table sm_release_windows add column if not exists active boolean not null default true;
    alter table sm_release_windows add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_release_windows (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  capacity integer,
  start_at timestamptz,
  end_at timestamptz,
  recurrence text,
  weekdays jsonb,
  until date,
  types jsonb,
  services jsonb,
  active boolean not null default true,
  description text
);
create index if not exists sm_release_windows_rev_idx on sm_release_windows (org_id, rev);
create index if not exists sm_release_windows_upd_idx on sm_release_windows (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_windows_crt_idx on sm_release_windows (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_release_windows_sync on sm_release_windows;
create trigger sm_release_windows_sync before insert or update on sm_release_windows for each row execute function sm_sync_touch('release_window');
create or replace trigger sm_release_windows_demo after insert on sm_release_windows for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_windows_demo_t after update or delete on sm_release_windows for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_windows enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:18', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۰ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 20/28 (e746bd22eb04)
-- repair_order: تعمیرهای دارایی
do $cols$
begin
  if to_regclass('sm_repair_orders') is not null then
    alter table sm_repair_orders add column if not exists workspace_id uuid;
    alter table sm_repair_orders add column if not exists domain_id uuid;
    alter table sm_repair_orders add column if not exists unit_id uuid;
    alter table sm_repair_orders add column if not exists created_at timestamptz not null default now();
    alter table sm_repair_orders add column if not exists created_by uuid;
    alter table sm_repair_orders add column if not exists updated_at timestamptz not null default now();
    alter table sm_repair_orders add column if not exists updated_by uuid;
    alter table sm_repair_orders add column if not exists rev bigint not null default 0;
    alter table sm_repair_orders add column if not exists version integer not null default 1;
    alter table sm_repair_orders add column if not exists deleted_at timestamptz;
    alter table sm_repair_orders add column if not exists origin text;
    alter table sm_repair_orders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_repair_orders add column if not exists no integer;
    alter table sm_repair_orders add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RMA' || no::text else 'RMA' || lpad(no::text, 6, '0') end) stored;
    alter table sm_repair_orders add column if not exists asset_id uuid;
    alter table sm_repair_orders add column if not exists title text;
    alter table sm_repair_orders add column if not exists repair_kind text;
    alter table sm_repair_orders add column if not exists vendor_id uuid;
    alter table sm_repair_orders add column if not exists contract_id uuid;
    alter table sm_repair_orders add column if not exists under_warranty boolean not null default false;
    alter table sm_repair_orders add column if not exists assigned_to uuid;
    alter table sm_repair_orders add column if not exists group_id uuid;
    alter table sm_repair_orders add column if not exists loaner_asset_id uuid;
    alter table sm_repair_orders add column if not exists fault text;
    alter table sm_repair_orders add column if not exists resolution text;
    alter table sm_repair_orders add column if not exists cost numeric;
    alter table sm_repair_orders add column if not exists sent_at timestamptz;
    alter table sm_repair_orders add column if not exists returned_at timestamptz;
    alter table sm_repair_orders add column if not exists previous_state text;
    alter table sm_repair_orders add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_repair_orders (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RMA' || no::text else 'RMA' || lpad(no::text, 6, '0') end) stored,
  asset_id uuid,
  title text,
  repair_kind text,
  vendor_id uuid,
  contract_id uuid,
  under_warranty boolean not null default false,
  assigned_to uuid,
  group_id uuid,
  loaner_asset_id uuid,
  fault text,
  resolution text,
  cost numeric,
  sent_at timestamptz,
  returned_at timestamptz,
  previous_state text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_repair_orders', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_repair_orders_search_cae18f1d_trgm', 'sm_repair_orders', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_repair_orders_search_custom_trgm', 'sm_repair_orders', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_repair_orders_no_uk on sm_repair_orders (org_id, no);
create index if not exists sm_repair_orders_rev_idx on sm_repair_orders (org_id, rev);
create index if not exists sm_repair_orders_upd_idx on sm_repair_orders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_repair_orders_crt_idx on sm_repair_orders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_repair_orders_asset_id_idx on sm_repair_orders (org_id, asset_id) where deleted_at is null;
create index if not exists sm_repair_orders_state_idx on sm_repair_orders (org_id, state) where deleted_at is null;
create index if not exists sm_repair_orders_workspace_acc_idx on sm_repair_orders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_repair_orders_unit_acc_idx on sm_repair_orders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_repair_orders_domain_acc_idx on sm_repair_orders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_repair_orders_assigned_to_idx on sm_repair_orders (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_repair_orders_sync on sm_repair_orders;
create trigger sm_repair_orders_sync before insert or update on sm_repair_orders for each row execute function sm_sync_touch('repair_order');
create or replace trigger sm_repair_orders_demo after insert on sm_repair_orders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_repair_orders_demo_t after update or delete on sm_repair_orders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_repair_orders enable row level security;

-- request: درخواست‌های خدمت
do $cols$
begin
  if to_regclass('sm_requests') is not null then
    alter table sm_requests add column if not exists workspace_id uuid;
    alter table sm_requests add column if not exists domain_id uuid;
    alter table sm_requests add column if not exists unit_id uuid;
    alter table sm_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_requests add column if not exists created_by uuid;
    alter table sm_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_requests add column if not exists updated_by uuid;
    alter table sm_requests add column if not exists rev bigint not null default 0;
    alter table sm_requests add column if not exists version integer not null default 1;
    alter table sm_requests add column if not exists deleted_at timestamptz;
    alter table sm_requests add column if not exists origin text;
    alter table sm_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_requests add column if not exists no integer;
    alter table sm_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REQ' || no::text else 'REQ' || lpad(no::text, 7, '0') end) stored;
    alter table sm_requests add column if not exists short_description text;
    alter table sm_requests add column if not exists description text;
    alter table sm_requests add column if not exists state text;
    alter table sm_requests add column if not exists priority text;
    alter table sm_requests add column if not exists impact text;
    alter table sm_requests add column if not exists urgency text;
    alter table sm_requests add column if not exists category text;
    alter table sm_requests add column if not exists subcategory text;
    alter table sm_requests add column if not exists channel text;
    alter table sm_requests add column if not exists caller_id uuid;
    alter table sm_requests add column if not exists requested_for uuid;
    alter table sm_requests add column if not exists opened_by uuid;
    alter table sm_requests add column if not exists opened_at timestamptz;
    alter table sm_requests add column if not exists assignment_group_id uuid;
    alter table sm_requests add column if not exists assigned_to uuid;
    alter table sm_requests add column if not exists service_id uuid;
    alter table sm_requests add column if not exists offering_id uuid;
    alter table sm_requests add column if not exists ci_id uuid;
    alter table sm_requests add column if not exists location_id uuid;
    alter table sm_requests add column if not exists due_at timestamptz;
    alter table sm_requests add column if not exists resolved_at timestamptz;
    alter table sm_requests add column if not exists resolved_by uuid;
    alter table sm_requests add column if not exists closed_at timestamptz;
    alter table sm_requests add column if not exists closed_by uuid;
    alter table sm_requests add column if not exists close_code text;
    alter table sm_requests add column if not exists close_notes text;
    alter table sm_requests add column if not exists parent_id uuid;
    alter table sm_requests add column if not exists watch_list jsonb;
    alter table sm_requests add column if not exists approval text;
    alter table sm_requests add column if not exists escalation integer;
    alter table sm_requests add column if not exists reassignment_count integer;
    alter table sm_requests add column if not exists reopen_count integer;
    alter table sm_requests add column if not exists time_worked bigint;
    alter table sm_requests add column if not exists first_response_at timestamptz;
    alter table sm_requests add column if not exists active boolean not null default true;
    alter table sm_requests add column if not exists sla_due timestamptz;
    alter table sm_requests add column if not exists knowledge boolean not null default false;
    alter table sm_requests add column if not exists needed_by date;
    alter table sm_requests add column if not exists cost_center_id uuid;
    alter table sm_requests add column if not exists items_count integer;
    alter table sm_requests add column if not exists total_price numeric;
    alter table sm_requests add column if not exists recurring_total numeric;
    alter table sm_requests add column if not exists stage text;
    alter table sm_requests add column if not exists fulfillers jsonb;
  end if;
end
$cols$;
create table if not exists sm_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REQ' || no::text else 'REQ' || lpad(no::text, 7, '0') end) stored,
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
  needed_by date,
  cost_center_id uuid,
  items_count integer,
  total_price numeric,
  recurring_total numeric,
  stage text,
  fulfillers jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_requests', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_requests_search_f3bce210_trgm', 'sm_requests', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_requests_search_custom_trgm', 'sm_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_requests_no_uk on sm_requests (org_id, no);
create index if not exists sm_requests_rev_idx on sm_requests (org_id, rev);
create index if not exists sm_requests_upd_idx on sm_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_requests_crt_idx on sm_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_requests_state_idx on sm_requests (org_id, state) where deleted_at is null;
create index if not exists sm_requests_assignment_group_id_idx on sm_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_requests_assigned_to_idx on sm_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_requests_workspace_acc_idx on sm_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_requests_unit_acc_idx on sm_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_requests_domain_acc_idx on sm_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_requests_caller_id_idx on sm_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_requests_requested_for_idx on sm_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_requests_opened_by_idx on sm_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_requests_fulfillers_gin on sm_requests using gin (fulfillers);
create index if not exists sm_requests_watch_list_gin on sm_requests using gin (watch_list);
create index if not exists sm_requests_open_grp_idx on sm_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_requests_opened_brin on sm_requests using brin (opened_at);
drop trigger if exists sm_requests_sync on sm_requests;
create trigger sm_requests_sync before insert or update on sm_requests for each row execute function sm_sync_touch('request');
create or replace trigger sm_requests_demo after insert on sm_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_requests_demo_t after update or delete on sm_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_requests enable row level security;

-- request_answer: پاسخ‌های سفارش
do $cols$
begin
  if to_regclass('sm_request_answers') is not null then
    alter table sm_request_answers add column if not exists workspace_id uuid;
    alter table sm_request_answers add column if not exists domain_id uuid;
    alter table sm_request_answers add column if not exists unit_id uuid;
    alter table sm_request_answers add column if not exists created_at timestamptz not null default now();
    alter table sm_request_answers add column if not exists created_by uuid;
    alter table sm_request_answers add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_answers add column if not exists updated_by uuid;
    alter table sm_request_answers add column if not exists rev bigint not null default 0;
    alter table sm_request_answers add column if not exists version integer not null default 1;
    alter table sm_request_answers add column if not exists deleted_at timestamptz;
    alter table sm_request_answers add column if not exists origin text;
    alter table sm_request_answers add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_answers add column if not exists label text;
    alter table sm_request_answers add column if not exists variable text;
    alter table sm_request_answers add column if not exists request_item_id uuid;
    alter table sm_request_answers add column if not exists item_id uuid;
    alter table sm_request_answers add column if not exists value_text text;
    alter table sm_request_answers add column if not exists value_num numeric;
    alter table sm_request_answers add column if not exists value_date date;
    alter table sm_request_answers add column if not exists requested_for uuid;
    alter table sm_request_answers add column if not exists caller_id uuid;
    alter table sm_request_answers add column if not exists assignment_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_request_answers (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  variable text,
  request_item_id uuid,
  item_id uuid,
  value_text text,
  value_num numeric,
  value_date date,
  requested_for uuid,
  caller_id uuid,
  assignment_group_id uuid
);
create index if not exists sm_request_answers_rev_idx on sm_request_answers (org_id, rev);
create index if not exists sm_request_answers_upd_idx on sm_request_answers (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_answers_crt_idx on sm_request_answers (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_answers_variable_idx on sm_request_answers (org_id, variable) where deleted_at is null;
create index if not exists sm_request_answers_request_item_id_idx on sm_request_answers (org_id, request_item_id) where deleted_at is null;
create index if not exists sm_request_answers_item_id_idx on sm_request_answers (org_id, item_id) where deleted_at is null;
create index if not exists sm_request_answers_workspace_acc_idx on sm_request_answers (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_answers_unit_acc_idx on sm_request_answers (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_answers_domain_acc_idx on sm_request_answers (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_answers_requested_for_idx on sm_request_answers (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_answers_caller_id_idx on sm_request_answers (org_id, caller_id) where deleted_at is null;
drop trigger if exists sm_request_answers_sync on sm_request_answers;
create trigger sm_request_answers_sync before insert or update on sm_request_answers for each row execute function sm_sync_touch('request_answer');
create or replace trigger sm_request_answers_demo after insert on sm_request_answers for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_answers_demo_t after update or delete on sm_request_answers for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_answers enable row level security;

-- request_cart: سبدهای سفارش
do $cols$
begin
  if to_regclass('sm_request_carts') is not null then
    alter table sm_request_carts add column if not exists workspace_id uuid;
    alter table sm_request_carts add column if not exists domain_id uuid;
    alter table sm_request_carts add column if not exists unit_id uuid;
    alter table sm_request_carts add column if not exists created_at timestamptz not null default now();
    alter table sm_request_carts add column if not exists created_by uuid;
    alter table sm_request_carts add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_carts add column if not exists updated_by uuid;
    alter table sm_request_carts add column if not exists rev bigint not null default 0;
    alter table sm_request_carts add column if not exists version integer not null default 1;
    alter table sm_request_carts add column if not exists deleted_at timestamptz;
    alter table sm_request_carts add column if not exists origin text;
    alter table sm_request_carts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_carts add column if not exists name text;
    alter table sm_request_carts add column if not exists kind text;
    alter table sm_request_carts add column if not exists user_id uuid;
    alter table sm_request_carts add column if not exists requested_for uuid;
    alter table sm_request_carts add column if not exists location_id uuid;
    alter table sm_request_carts add column if not exists needed_by date;
    alter table sm_request_carts add column if not exists cost_center_id uuid;
    alter table sm_request_carts add column if not exists instructions text;
    alter table sm_request_carts add column if not exists request_id uuid;
    alter table sm_request_carts add column if not exists checked_out_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_request_carts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  user_id uuid,
  requested_for uuid,
  location_id uuid,
  needed_by date,
  cost_center_id uuid,
  instructions text,
  request_id uuid,
  checked_out_at timestamptz
);
create index if not exists sm_request_carts_rev_idx on sm_request_carts (org_id, rev);
create index if not exists sm_request_carts_upd_idx on sm_request_carts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_carts_crt_idx on sm_request_carts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_carts_user_id_idx on sm_request_carts (org_id, user_id) where deleted_at is null;
create index if not exists sm_request_carts_workspace_acc_idx on sm_request_carts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_carts_unit_acc_idx on sm_request_carts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_carts_domain_acc_idx on sm_request_carts (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_request_carts_sync on sm_request_carts;
create trigger sm_request_carts_sync before insert or update on sm_request_carts for each row execute function sm_sync_touch('request_cart');
create or replace trigger sm_request_carts_demo after insert on sm_request_carts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_carts_demo_t after update or delete on sm_request_carts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_carts enable row level security;

-- request_cart_line: اقلام سبد
do $cols$
begin
  if to_regclass('sm_request_cart_lines') is not null then
    alter table sm_request_cart_lines add column if not exists workspace_id uuid;
    alter table sm_request_cart_lines add column if not exists domain_id uuid;
    alter table sm_request_cart_lines add column if not exists unit_id uuid;
    alter table sm_request_cart_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_request_cart_lines add column if not exists created_by uuid;
    alter table sm_request_cart_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_cart_lines add column if not exists updated_by uuid;
    alter table sm_request_cart_lines add column if not exists rev bigint not null default 0;
    alter table sm_request_cart_lines add column if not exists version integer not null default 1;
    alter table sm_request_cart_lines add column if not exists deleted_at timestamptz;
    alter table sm_request_cart_lines add column if not exists origin text;
    alter table sm_request_cart_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_cart_lines add column if not exists title text;
    alter table sm_request_cart_lines add column if not exists cart_id uuid;
    alter table sm_request_cart_lines add column if not exists user_id uuid;
    alter table sm_request_cart_lines add column if not exists item_id uuid;
    alter table sm_request_cart_lines add column if not exists version_id uuid;
    alter table sm_request_cart_lines add column if not exists quantity integer;
    alter table sm_request_cart_lines add column if not exists price numeric;
    alter table sm_request_cart_lines add column if not exists requested_for uuid;
    alter table sm_request_cart_lines add column if not exists requested_for_list jsonb;
    alter table sm_request_cart_lines add column if not exists answers jsonb;
    alter table sm_request_cart_lines add column if not exists saved boolean not null default false;
    alter table sm_request_cart_lines add column if not exists guide_id uuid;
    alter table sm_request_cart_lines add column if not exists sort_order integer;
  end if;
end
$cols$;
create table if not exists sm_request_cart_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  cart_id uuid,
  user_id uuid,
  item_id uuid,
  version_id uuid,
  quantity integer,
  price numeric,
  requested_for uuid,
  requested_for_list jsonb,
  answers jsonb,
  saved boolean not null default false,
  guide_id uuid,
  sort_order integer
);
create index if not exists sm_request_cart_lines_rev_idx on sm_request_cart_lines (org_id, rev);
create index if not exists sm_request_cart_lines_upd_idx on sm_request_cart_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_cart_lines_crt_idx on sm_request_cart_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_cart_lines_cart_id_idx on sm_request_cart_lines (org_id, cart_id) where deleted_at is null;
create index if not exists sm_request_cart_lines_user_id_idx on sm_request_cart_lines (org_id, user_id) where deleted_at is null;
create index if not exists sm_request_cart_lines_workspace_acc_idx on sm_request_cart_lines (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_cart_lines_unit_acc_idx on sm_request_cart_lines (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_cart_lines_domain_acc_idx on sm_request_cart_lines (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_request_cart_lines_sync on sm_request_cart_lines;
create trigger sm_request_cart_lines_sync before insert or update on sm_request_cart_lines for each row execute function sm_sync_touch('request_cart_line');
create or replace trigger sm_request_cart_lines_demo after insert on sm_request_cart_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_cart_lines_demo_t after update or delete on sm_request_cart_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_cart_lines enable row level security;

-- request_config: تنظیمات درخواست خدمت
do $cols$
begin
  if to_regclass('sm_request_configs') is not null then
    alter table sm_request_configs add column if not exists workspace_id uuid;
    alter table sm_request_configs add column if not exists domain_id uuid;
    alter table sm_request_configs add column if not exists unit_id uuid;
    alter table sm_request_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_request_configs add column if not exists created_by uuid;
    alter table sm_request_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_configs add column if not exists updated_by uuid;
    alter table sm_request_configs add column if not exists rev bigint not null default 0;
    alter table sm_request_configs add column if not exists version integer not null default 1;
    alter table sm_request_configs add column if not exists deleted_at timestamptz;
    alter table sm_request_configs add column if not exists origin text;
    alter table sm_request_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_configs add column if not exists name text;
    alter table sm_request_configs add column if not exists confirm_days integer;
    alter table sm_request_configs add column if not exists info_reminder_days integer;
    alter table sm_request_configs add column if not exists info_cancel_days integer;
    alter table sm_request_configs add column if not exists sle_window_days integer;
    alter table sm_request_configs add column if not exists default_group_id uuid;
    alter table sm_request_configs add column if not exists calendar_id uuid;
    alter table sm_request_configs add column if not exists seeded boolean not null default false;
    alter table sm_request_configs add column if not exists seed_version integer;
  end if;
end
$cols$;
create table if not exists sm_request_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  confirm_days integer,
  info_reminder_days integer,
  info_cancel_days integer,
  sle_window_days integer,
  default_group_id uuid,
  calendar_id uuid,
  seeded boolean not null default false,
  seed_version integer
);
create index if not exists sm_request_configs_rev_idx on sm_request_configs (org_id, rev);
create index if not exists sm_request_configs_upd_idx on sm_request_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_configs_crt_idx on sm_request_configs (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_request_configs_sync on sm_request_configs;
create trigger sm_request_configs_sync before insert or update on sm_request_configs for each row execute function sm_sync_touch('request_config');
create or replace trigger sm_request_configs_demo after insert on sm_request_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_configs_demo_t after update or delete on sm_request_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_configs enable row level security;

-- request_item: اقلام درخواست‌شده
do $cols$
begin
  if to_regclass('sm_request_items') is not null then
    alter table sm_request_items add column if not exists workspace_id uuid;
    alter table sm_request_items add column if not exists domain_id uuid;
    alter table sm_request_items add column if not exists unit_id uuid;
    alter table sm_request_items add column if not exists created_at timestamptz not null default now();
    alter table sm_request_items add column if not exists created_by uuid;
    alter table sm_request_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_items add column if not exists updated_by uuid;
    alter table sm_request_items add column if not exists rev bigint not null default 0;
    alter table sm_request_items add column if not exists version integer not null default 1;
    alter table sm_request_items add column if not exists deleted_at timestamptz;
    alter table sm_request_items add column if not exists origin text;
    alter table sm_request_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_items add column if not exists no integer;
    alter table sm_request_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RITM' || no::text else 'RITM' || lpad(no::text, 7, '0') end) stored;
    alter table sm_request_items add column if not exists short_description text;
    alter table sm_request_items add column if not exists description text;
    alter table sm_request_items add column if not exists state text;
    alter table sm_request_items add column if not exists priority text;
    alter table sm_request_items add column if not exists impact text;
    alter table sm_request_items add column if not exists urgency text;
    alter table sm_request_items add column if not exists category text;
    alter table sm_request_items add column if not exists subcategory text;
    alter table sm_request_items add column if not exists channel text;
    alter table sm_request_items add column if not exists caller_id uuid;
    alter table sm_request_items add column if not exists requested_for uuid;
    alter table sm_request_items add column if not exists opened_by uuid;
    alter table sm_request_items add column if not exists opened_at timestamptz;
    alter table sm_request_items add column if not exists assignment_group_id uuid;
    alter table sm_request_items add column if not exists assigned_to uuid;
    alter table sm_request_items add column if not exists service_id uuid;
    alter table sm_request_items add column if not exists offering_id uuid;
    alter table sm_request_items add column if not exists ci_id uuid;
    alter table sm_request_items add column if not exists location_id uuid;
    alter table sm_request_items add column if not exists due_at timestamptz;
    alter table sm_request_items add column if not exists resolved_at timestamptz;
    alter table sm_request_items add column if not exists resolved_by uuid;
    alter table sm_request_items add column if not exists closed_at timestamptz;
    alter table sm_request_items add column if not exists closed_by uuid;
    alter table sm_request_items add column if not exists close_code text;
    alter table sm_request_items add column if not exists close_notes text;
    alter table sm_request_items add column if not exists parent_id uuid;
    alter table sm_request_items add column if not exists watch_list jsonb;
    alter table sm_request_items add column if not exists approval text;
    alter table sm_request_items add column if not exists escalation integer;
    alter table sm_request_items add column if not exists reassignment_count integer;
    alter table sm_request_items add column if not exists reopen_count integer;
    alter table sm_request_items add column if not exists time_worked bigint;
    alter table sm_request_items add column if not exists first_response_at timestamptz;
    alter table sm_request_items add column if not exists active boolean not null default true;
    alter table sm_request_items add column if not exists sla_due timestamptz;
    alter table sm_request_items add column if not exists knowledge boolean not null default false;
    alter table sm_request_items add column if not exists request_id uuid;
    alter table sm_request_items add column if not exists cat_item_id uuid;
    alter table sm_request_items add column if not exists item_version_id uuid;
    alter table sm_request_items add column if not exists category_id uuid;
    alter table sm_request_items add column if not exists quantity integer;
    alter table sm_request_items add column if not exists stage text;
    alter table sm_request_items add column if not exists answers jsonb;
    alter table sm_request_items add column if not exists private_answers jsonb;
    alter table sm_request_items add column if not exists secret_answers text;
    alter table sm_request_items add column if not exists price numeric;
    alter table sm_request_items add column if not exists total numeric;
    alter table sm_request_items add column if not exists recurring_price numeric;
    alter table sm_request_items add column if not exists recurring_frequency text;
    alter table sm_request_items add column if not exists cost numeric;
    alter table sm_request_items add column if not exists ad_hoc boolean not null default false;
    alter table sm_request_items add column if not exists fulfilment text;
    alter table sm_request_items add column if not exists approval_rule_id uuid;
    alter table sm_request_items add column if not exists produced_table text;
    alter table sm_request_items add column if not exists produced_id text;
    alter table sm_request_items add column if not exists requires_confirmation boolean not null default false;
    alter table sm_request_items add column if not exists access_until date;
    alter table sm_request_items add column if not exists revoked_at timestamptz;
    alter table sm_request_items add column if not exists subscription_id uuid;
    alter table sm_request_items add column if not exists entitlement jsonb;
    alter table sm_request_items add column if not exists flow_runs jsonb;
    alter table sm_request_items add column if not exists fulfillers jsonb;
    alter table sm_request_items add column if not exists rating integer;
    alter table sm_request_items add column if not exists feedback text;
    alter table sm_request_items add column if not exists sle_p85 bigint;
    alter table sm_request_items add column if not exists approval_requested_at timestamptz;
    alter table sm_request_items add column if not exists approved_at timestamptz;
    alter table sm_request_items add column if not exists fulfilment_started_at timestamptz;
    alter table sm_request_items add column if not exists info_requested boolean not null default false;
    alter table sm_request_items add column if not exists info_since timestamptz;
    alter table sm_request_items add column if not exists info_wait bigint;
    alter table sm_request_items add column if not exists reminded_at timestamptz;
    alter table sm_request_items add column if not exists zero_touch boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_request_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RITM' || no::text else 'RITM' || lpad(no::text, 7, '0') end) stored,
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
  request_id uuid,
  cat_item_id uuid,
  item_version_id uuid,
  category_id uuid,
  quantity integer,
  stage text,
  answers jsonb,
  private_answers jsonb,
  secret_answers text,
  price numeric,
  total numeric,
  recurring_price numeric,
  recurring_frequency text,
  cost numeric,
  ad_hoc boolean not null default false,
  fulfilment text,
  approval_rule_id uuid,
  produced_table text,
  produced_id text,
  requires_confirmation boolean not null default false,
  access_until date,
  revoked_at timestamptz,
  subscription_id uuid,
  entitlement jsonb,
  flow_runs jsonb,
  fulfillers jsonb,
  rating integer,
  feedback text,
  sle_p85 bigint,
  approval_requested_at timestamptz,
  approved_at timestamptz,
  fulfilment_started_at timestamptz,
  info_requested boolean not null default false,
  info_since timestamptz,
  info_wait bigint,
  reminded_at timestamptz,
  zero_touch boolean not null default false,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_request_items', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_items_search_f3bce210_trgm', 'sm_request_items', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_request_items_search_custom_trgm', 'sm_request_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_request_items_no_uk on sm_request_items (org_id, no);
create index if not exists sm_request_items_rev_idx on sm_request_items (org_id, rev);
create index if not exists sm_request_items_upd_idx on sm_request_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_items_crt_idx on sm_request_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_items_state_idx on sm_request_items (org_id, state) where deleted_at is null;
create index if not exists sm_request_items_assignment_group_id_idx on sm_request_items (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_request_items_assigned_to_idx on sm_request_items (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_request_items_request_id_idx on sm_request_items (org_id, request_id) where deleted_at is null;
create index if not exists sm_request_items_cat_item_id_idx on sm_request_items (org_id, cat_item_id) where deleted_at is null;
create index if not exists sm_request_items_workspace_acc_idx on sm_request_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_items_unit_acc_idx on sm_request_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_items_domain_acc_idx on sm_request_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_items_caller_id_idx on sm_request_items (org_id, caller_id) where deleted_at is null;
create index if not exists sm_request_items_requested_for_idx on sm_request_items (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_items_opened_by_idx on sm_request_items (org_id, opened_by) where deleted_at is null;
create index if not exists sm_request_items_fulfillers_gin on sm_request_items using gin (fulfillers);
create index if not exists sm_request_items_watch_list_gin on sm_request_items using gin (watch_list);
create index if not exists sm_request_items_open_grp_idx on sm_request_items (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_request_items_opened_brin on sm_request_items using brin (opened_at);
drop trigger if exists sm_request_items_sync on sm_request_items;
create trigger sm_request_items_sync before insert or update on sm_request_items for each row execute function sm_sync_touch('request_item');
create or replace trigger sm_request_items_demo after insert on sm_request_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_items_demo_t after update or delete on sm_request_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_items enable row level security;

-- request_subscription: اشتراک‌های خدمت
do $cols$
begin
  if to_regclass('sm_request_subscriptions') is not null then
    alter table sm_request_subscriptions add column if not exists workspace_id uuid;
    alter table sm_request_subscriptions add column if not exists domain_id uuid;
    alter table sm_request_subscriptions add column if not exists unit_id uuid;
    alter table sm_request_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_request_subscriptions add column if not exists created_by uuid;
    alter table sm_request_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_subscriptions add column if not exists updated_by uuid;
    alter table sm_request_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_request_subscriptions add column if not exists version integer not null default 1;
    alter table sm_request_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_request_subscriptions add column if not exists origin text;
    alter table sm_request_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_subscriptions add column if not exists no integer;
    alter table sm_request_subscriptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SUB' || no::text else 'SUB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_request_subscriptions add column if not exists name text;
    alter table sm_request_subscriptions add column if not exists item_id uuid;
    alter table sm_request_subscriptions add column if not exists subscriber_id uuid;
    alter table sm_request_subscriptions add column if not exists request_item_id uuid;
    alter table sm_request_subscriptions add column if not exists quantity integer;
    alter table sm_request_subscriptions add column if not exists recurring_price numeric;
    alter table sm_request_subscriptions add column if not exists recurring_frequency text;
    alter table sm_request_subscriptions add column if not exists start_on date;
    alter table sm_request_subscriptions add column if not exists end_on date;
    alter table sm_request_subscriptions add column if not exists notes text;
    alter table sm_request_subscriptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_request_subscriptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SUB' || no::text else 'SUB' || lpad(no::text, 6, '0') end) stored,
  name text,
  item_id uuid,
  subscriber_id uuid,
  request_item_id uuid,
  quantity integer,
  recurring_price numeric,
  recurring_frequency text,
  start_on date,
  end_on date,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_request_subscriptions', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_subscriptions_search_56291d9d_trgm', 'sm_request_subscriptions', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_request_subscriptions_search_custom_trgm', 'sm_request_subscriptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_request_subscriptions_no_uk on sm_request_subscriptions (org_id, no);
create index if not exists sm_request_subscriptions_rev_idx on sm_request_subscriptions (org_id, rev);
create index if not exists sm_request_subscriptions_upd_idx on sm_request_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_subscriptions_crt_idx on sm_request_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_subscriptions_state_idx on sm_request_subscriptions (org_id, state) where deleted_at is null;
create index if not exists sm_request_subscriptions_workspace_acc_idx on sm_request_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_subscriptions_unit_acc_idx on sm_request_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_subscriptions_domain_acc_idx on sm_request_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_subscriptions_subscriber_id_idx on sm_request_subscriptions (org_id, subscriber_id) where deleted_at is null;
drop trigger if exists sm_request_subscriptions_sync on sm_request_subscriptions;
create trigger sm_request_subscriptions_sync before insert or update on sm_request_subscriptions for each row execute function sm_sync_touch('request_subscription');
create or replace trigger sm_request_subscriptions_demo after insert on sm_request_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_subscriptions_demo_t after update or delete on sm_request_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_subscriptions enable row level security;

-- request_task: وظایف انجام
do $cols$
begin
  if to_regclass('sm_request_tasks') is not null then
    alter table sm_request_tasks add column if not exists workspace_id uuid;
    alter table sm_request_tasks add column if not exists domain_id uuid;
    alter table sm_request_tasks add column if not exists unit_id uuid;
    alter table sm_request_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_request_tasks add column if not exists created_by uuid;
    alter table sm_request_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_tasks add column if not exists updated_by uuid;
    alter table sm_request_tasks add column if not exists rev bigint not null default 0;
    alter table sm_request_tasks add column if not exists version integer not null default 1;
    alter table sm_request_tasks add column if not exists deleted_at timestamptz;
    alter table sm_request_tasks add column if not exists origin text;
    alter table sm_request_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_tasks add column if not exists no integer;
    alter table sm_request_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTSK' || no::text else 'RTSK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_request_tasks add column if not exists short_description text;
    alter table sm_request_tasks add column if not exists description text;
    alter table sm_request_tasks add column if not exists state text;
    alter table sm_request_tasks add column if not exists priority text;
    alter table sm_request_tasks add column if not exists impact text;
    alter table sm_request_tasks add column if not exists urgency text;
    alter table sm_request_tasks add column if not exists category text;
    alter table sm_request_tasks add column if not exists subcategory text;
    alter table sm_request_tasks add column if not exists channel text;
    alter table sm_request_tasks add column if not exists caller_id uuid;
    alter table sm_request_tasks add column if not exists requested_for uuid;
    alter table sm_request_tasks add column if not exists opened_by uuid;
    alter table sm_request_tasks add column if not exists opened_at timestamptz;
    alter table sm_request_tasks add column if not exists assignment_group_id uuid;
    alter table sm_request_tasks add column if not exists assigned_to uuid;
    alter table sm_request_tasks add column if not exists service_id uuid;
    alter table sm_request_tasks add column if not exists offering_id uuid;
    alter table sm_request_tasks add column if not exists ci_id uuid;
    alter table sm_request_tasks add column if not exists location_id uuid;
    alter table sm_request_tasks add column if not exists due_at timestamptz;
    alter table sm_request_tasks add column if not exists resolved_at timestamptz;
    alter table sm_request_tasks add column if not exists resolved_by uuid;
    alter table sm_request_tasks add column if not exists closed_at timestamptz;
    alter table sm_request_tasks add column if not exists closed_by uuid;
    alter table sm_request_tasks add column if not exists close_code text;
    alter table sm_request_tasks add column if not exists close_notes text;
    alter table sm_request_tasks add column if not exists parent_id uuid;
    alter table sm_request_tasks add column if not exists watch_list jsonb;
    alter table sm_request_tasks add column if not exists approval text;
    alter table sm_request_tasks add column if not exists escalation integer;
    alter table sm_request_tasks add column if not exists reassignment_count integer;
    alter table sm_request_tasks add column if not exists reopen_count integer;
    alter table sm_request_tasks add column if not exists time_worked bigint;
    alter table sm_request_tasks add column if not exists first_response_at timestamptz;
    alter table sm_request_tasks add column if not exists active boolean not null default true;
    alter table sm_request_tasks add column if not exists sla_due timestamptz;
    alter table sm_request_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_request_tasks add column if not exists request_item_id uuid;
    alter table sm_request_tasks add column if not exists request_id uuid;
    alter table sm_request_tasks add column if not exists template_id uuid;
    alter table sm_request_tasks add column if not exists sort_order integer;
    alter table sm_request_tasks add column if not exists depends_on uuid;
    alter table sm_request_tasks add column if not exists requester_visible boolean not null default false;
    alter table sm_request_tasks add column if not exists instructions text;
    alter table sm_request_tasks add column if not exists checklist jsonb;
    alter table sm_request_tasks add column if not exists class_of_service text;
    alter table sm_request_tasks add column if not exists blocked boolean not null default false;
    alter table sm_request_tasks add column if not exists blocked_reason text;
    alter table sm_request_tasks add column if not exists blocked_since timestamptz;
    alter table sm_request_tasks add column if not exists blocked_time bigint;
    alter table sm_request_tasks add column if not exists deviation boolean not null default false;
    alter table sm_request_tasks add column if not exists deviation_note text;
    alter table sm_request_tasks add column if not exists revocation boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_request_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTSK' || no::text else 'RTSK' || lpad(no::text, 7, '0') end) stored,
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
  request_item_id uuid,
  request_id uuid,
  template_id uuid,
  sort_order integer,
  depends_on uuid,
  requester_visible boolean not null default false,
  instructions text,
  checklist jsonb,
  class_of_service text,
  blocked boolean not null default false,
  blocked_reason text,
  blocked_since timestamptz,
  blocked_time bigint,
  deviation boolean not null default false,
  deviation_note text,
  revocation boolean not null default false,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_request_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_tasks_search_f3bce210_trgm', 'sm_request_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_request_tasks_search_custom_trgm', 'sm_request_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_request_tasks_no_uk on sm_request_tasks (org_id, no);
create index if not exists sm_request_tasks_rev_idx on sm_request_tasks (org_id, rev);
create index if not exists sm_request_tasks_upd_idx on sm_request_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_tasks_crt_idx on sm_request_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_tasks_state_idx on sm_request_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_request_tasks_assignment_group_id_idx on sm_request_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_request_tasks_assigned_to_idx on sm_request_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_request_tasks_request_item_id_idx on sm_request_tasks (org_id, request_item_id) where deleted_at is null;
create index if not exists sm_request_tasks_request_id_idx on sm_request_tasks (org_id, request_id) where deleted_at is null;
create index if not exists sm_request_tasks_workspace_acc_idx on sm_request_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_tasks_unit_acc_idx on sm_request_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_tasks_domain_acc_idx on sm_request_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_tasks_requested_for_idx on sm_request_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_tasks_watch_list_gin on sm_request_tasks using gin (watch_list);
create index if not exists sm_request_tasks_open_grp_idx on sm_request_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_request_tasks_opened_brin on sm_request_tasks using brin (opened_at);
drop trigger if exists sm_request_tasks_sync on sm_request_tasks;
create trigger sm_request_tasks_sync before insert or update on sm_request_tasks for each row execute function sm_sync_touch('request_task');
create or replace trigger sm_request_tasks_demo after insert on sm_request_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_tasks_demo_t after update or delete on sm_request_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_tasks enable row level security;

-- reservation: رزروها
do $cols$
begin
  if to_regclass('sm_reservations') is not null then
    alter table sm_reservations add column if not exists workspace_id uuid;
    alter table sm_reservations add column if not exists domain_id uuid;
    alter table sm_reservations add column if not exists unit_id uuid;
    alter table sm_reservations add column if not exists created_at timestamptz not null default now();
    alter table sm_reservations add column if not exists created_by uuid;
    alter table sm_reservations add column if not exists updated_at timestamptz not null default now();
    alter table sm_reservations add column if not exists updated_by uuid;
    alter table sm_reservations add column if not exists rev bigint not null default 0;
    alter table sm_reservations add column if not exists version integer not null default 1;
    alter table sm_reservations add column if not exists deleted_at timestamptz;
    alter table sm_reservations add column if not exists origin text;
    alter table sm_reservations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_reservations add column if not exists no integer;
    alter table sm_reservations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RSV' || no::text else 'RSV' || lpad(no::text, 7, '0') end) stored;
    alter table sm_reservations add column if not exists title text;
    alter table sm_reservations add column if not exists space_id uuid;
    alter table sm_reservations add column if not exists start_at timestamptz;
    alter table sm_reservations add column if not exists end_at timestamptz;
    alter table sm_reservations add column if not exists attendees integer;
    alter table sm_reservations add column if not exists booked_for uuid;
    alter table sm_reservations add column if not exists booked_by uuid;
    alter table sm_reservations add column if not exists recurrence text;
    alter table sm_reservations add column if not exists recurrence_until date;
    alter table sm_reservations add column if not exists series_id text;
    alter table sm_reservations add column if not exists services jsonb;
    alter table sm_reservations add column if not exists service_notes text;
    alter table sm_reservations add column if not exists waitlist_position integer;
    alter table sm_reservations add column if not exists checked_in_at timestamptz;
    alter table sm_reservations add column if not exists released_at timestamptz;
    alter table sm_reservations add column if not exists approval text;
    alter table sm_reservations add column if not exists location_id uuid;
    alter table sm_reservations add column if not exists assignment_group_id uuid;
    alter table sm_reservations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_reservations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RSV' || no::text else 'RSV' || lpad(no::text, 7, '0') end) stored,
  title text,
  space_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  attendees integer,
  booked_for uuid,
  booked_by uuid,
  recurrence text,
  recurrence_until date,
  series_id text,
  services jsonb,
  service_notes text,
  waitlist_position integer,
  checked_in_at timestamptz,
  released_at timestamptz,
  approval text,
  location_id uuid,
  assignment_group_id uuid,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_reservations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_reservations_search_cae18f1d_trgm', 'sm_reservations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_reservations_search_custom_trgm', 'sm_reservations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_reservations_no_uk on sm_reservations (org_id, no);
create index if not exists sm_reservations_rev_idx on sm_reservations (org_id, rev);
create index if not exists sm_reservations_upd_idx on sm_reservations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_reservations_crt_idx on sm_reservations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_reservations_space_id_idx on sm_reservations (org_id, space_id) where deleted_at is null;
create index if not exists sm_reservations_booked_for_idx on sm_reservations (org_id, booked_for) where deleted_at is null;
create index if not exists sm_reservations_booked_by_idx on sm_reservations (org_id, booked_by) where deleted_at is null;
create index if not exists sm_reservations_location_id_idx on sm_reservations (org_id, location_id) where deleted_at is null;
create index if not exists sm_reservations_assignment_group_id_idx on sm_reservations (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_reservations_state_idx on sm_reservations (org_id, state) where deleted_at is null;
create index if not exists sm_reservations_workspace_acc_idx on sm_reservations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_reservations_unit_acc_idx on sm_reservations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_reservations_domain_acc_idx on sm_reservations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_reservations_sync on sm_reservations;
create trigger sm_reservations_sync before insert or update on sm_reservations for each row execute function sm_sync_touch('reservation');
create or replace trigger sm_reservations_demo after insert on sm_reservations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_reservations_demo_t after update or delete on sm_reservations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_reservations enable row level security;

-- resource_allocation: تخصیص‌های منابع
do $cols$
begin
  if to_regclass('sm_resource_allocations') is not null then
    alter table sm_resource_allocations add column if not exists workspace_id uuid;
    alter table sm_resource_allocations add column if not exists domain_id uuid;
    alter table sm_resource_allocations add column if not exists unit_id uuid;
    alter table sm_resource_allocations add column if not exists created_at timestamptz not null default now();
    alter table sm_resource_allocations add column if not exists created_by uuid;
    alter table sm_resource_allocations add column if not exists updated_at timestamptz not null default now();
    alter table sm_resource_allocations add column if not exists updated_by uuid;
    alter table sm_resource_allocations add column if not exists rev bigint not null default 0;
    alter table sm_resource_allocations add column if not exists version integer not null default 1;
    alter table sm_resource_allocations add column if not exists deleted_at timestamptz;
    alter table sm_resource_allocations add column if not exists origin text;
    alter table sm_resource_allocations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_resource_allocations add column if not exists user_id uuid;
    alter table sm_resource_allocations add column if not exists project_id uuid;
    alter table sm_resource_allocations add column if not exists role text;
    alter table sm_resource_allocations add column if not exists state text;
    alter table sm_resource_allocations add column if not exists start_date date;
    alter table sm_resource_allocations add column if not exists end_date date;
    alter table sm_resource_allocations add column if not exists hours_per_week numeric;
    alter table sm_resource_allocations add column if not exists notes text;
    alter table sm_resource_allocations add column if not exists project_manager_id uuid;
    alter table sm_resource_allocations add column if not exists assignment_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_resource_allocations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  project_id uuid,
  role text,
  state text,
  start_date date,
  end_date date,
  hours_per_week numeric,
  notes text,
  project_manager_id uuid,
  assignment_group_id uuid
);
create index if not exists sm_resource_allocations_rev_idx on sm_resource_allocations (org_id, rev);
create index if not exists sm_resource_allocations_upd_idx on sm_resource_allocations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_resource_allocations_crt_idx on sm_resource_allocations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_resource_allocations_user_id_idx on sm_resource_allocations (org_id, user_id) where deleted_at is null;
create index if not exists sm_resource_allocations_project_id_idx on sm_resource_allocations (org_id, project_id) where deleted_at is null;
create index if not exists sm_resource_allocations_workspace_acc_idx on sm_resource_allocations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_resource_allocations_unit_acc_idx on sm_resource_allocations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_resource_allocations_domain_acc_idx on sm_resource_allocations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_resource_allocations_project_manager_id_idx on sm_resource_allocations (org_id, project_manager_id) where deleted_at is null;
drop trigger if exists sm_resource_allocations_sync on sm_resource_allocations;
create trigger sm_resource_allocations_sync before insert or update on sm_resource_allocations for each row execute function sm_sync_touch('resource_allocation');
create or replace trigger sm_resource_allocations_demo after insert on sm_resource_allocations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_resource_allocations_demo_t after update or delete on sm_resource_allocations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_resource_allocations enable row level security;

-- role: نقش‌ها
do $cols$
begin
  if to_regclass('sm_roles') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  key text,
  name text,
  description text,
  persona text,
  workspaces text,
  domains text,
  grants jsonb,
  field_groups jsonb,
  contains jsonb,
  active boolean not null default true
);
create index if not exists sm_roles_rev_idx on sm_roles (org_id, rev);
create index if not exists sm_roles_upd_idx on sm_roles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_roles_crt_idx on sm_roles (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_roles_key_uk on sm_roles (org_id, key) where deleted_at is null;
drop trigger if exists sm_roles_sync on sm_roles;
create trigger sm_roles_sync before insert or update on sm_roles for each row execute function sm_sync_touch('role');
create or replace trigger sm_roles_demo after insert on sm_roles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_roles_demo_t after update or delete on sm_roles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_roles enable row level security;

-- saas_account: حساب‌های SaaS
do $cols$
begin
  if to_regclass('sm_saas_accounts') is not null then
    alter table sm_saas_accounts add column if not exists workspace_id uuid;
    alter table sm_saas_accounts add column if not exists domain_id uuid;
    alter table sm_saas_accounts add column if not exists unit_id uuid;
    alter table sm_saas_accounts add column if not exists created_at timestamptz not null default now();
    alter table sm_saas_accounts add column if not exists created_by uuid;
    alter table sm_saas_accounts add column if not exists updated_at timestamptz not null default now();
    alter table sm_saas_accounts add column if not exists updated_by uuid;
    alter table sm_saas_accounts add column if not exists rev bigint not null default 0;
    alter table sm_saas_accounts add column if not exists version integer not null default 1;
    alter table sm_saas_accounts add column if not exists deleted_at timestamptz;
    alter table sm_saas_accounts add column if not exists origin text;
    alter table sm_saas_accounts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_saas_accounts add column if not exists subscription_id uuid;
    alter table sm_saas_accounts add column if not exists user_id uuid;
    alter table sm_saas_accounts add column if not exists email text;
    alter table sm_saas_accounts add column if not exists external_id text;
    alter table sm_saas_accounts add column if not exists role text;
    alter table sm_saas_accounts add column if not exists last_active_at timestamptz;
    alter table sm_saas_accounts add column if not exists active boolean not null default true;
    alter table sm_saas_accounts add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_saas_accounts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  subscription_id uuid,
  user_id uuid,
  email text,
  external_id text,
  role text,
  last_active_at timestamptz,
  active boolean not null default true,
  label text
);
create index if not exists sm_saas_accounts_rev_idx on sm_saas_accounts (org_id, rev);
create index if not exists sm_saas_accounts_upd_idx on sm_saas_accounts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_accounts_crt_idx on sm_saas_accounts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_accounts_subscription_id_idx on sm_saas_accounts (org_id, subscription_id) where deleted_at is null;
create index if not exists sm_saas_accounts_workspace_acc_idx on sm_saas_accounts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_saas_accounts_unit_acc_idx on sm_saas_accounts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_saas_accounts_domain_acc_idx on sm_saas_accounts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_saas_accounts_user_id_idx on sm_saas_accounts (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_saas_accounts_sync on sm_saas_accounts;
create trigger sm_saas_accounts_sync before insert or update on sm_saas_accounts for each row execute function sm_sync_touch('saas_account');
create or replace trigger sm_saas_accounts_demo after insert on sm_saas_accounts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_saas_accounts_demo_t after update or delete on sm_saas_accounts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_saas_accounts enable row level security;

-- saas_subscription: اشتراک‌های SaaS
do $cols$
begin
  if to_regclass('sm_saas_subscriptions') is not null then
    alter table sm_saas_subscriptions add column if not exists workspace_id uuid;
    alter table sm_saas_subscriptions add column if not exists domain_id uuid;
    alter table sm_saas_subscriptions add column if not exists unit_id uuid;
    alter table sm_saas_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_saas_subscriptions add column if not exists created_by uuid;
    alter table sm_saas_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_saas_subscriptions add column if not exists updated_by uuid;
    alter table sm_saas_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_saas_subscriptions add column if not exists version integer not null default 1;
    alter table sm_saas_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_saas_subscriptions add column if not exists origin text;
    alter table sm_saas_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_saas_subscriptions add column if not exists no integer;
    alter table sm_saas_subscriptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SAAS' || no::text else 'SAAS' || lpad(no::text, 5, '0') end) stored;
    alter table sm_saas_subscriptions add column if not exists name text;
    alter table sm_saas_subscriptions add column if not exists supplier_id uuid;
    alter table sm_saas_subscriptions add column if not exists software_model_id uuid;
    alter table sm_saas_subscriptions add column if not exists contract_id uuid;
    alter table sm_saas_subscriptions add column if not exists plan text;
    alter table sm_saas_subscriptions add column if not exists billing_cycle text;
    alter table sm_saas_subscriptions add column if not exists owner_id uuid;
    alter table sm_saas_subscriptions add column if not exists seats integer;
    alter table sm_saas_subscriptions add column if not exists seats_assigned integer;
    alter table sm_saas_subscriptions add column if not exists seats_active integer;
    alter table sm_saas_subscriptions add column if not exists cost_per_seat numeric;
    alter table sm_saas_subscriptions add column if not exists annual_cost numeric;
    alter table sm_saas_subscriptions add column if not exists renewal_date date;
    alter table sm_saas_subscriptions add column if not exists auto_renew boolean not null default true;
    alter table sm_saas_subscriptions add column if not exists cost_center_id uuid;
    alter table sm_saas_subscriptions add column if not exists sso boolean not null default false;
    alter table sm_saas_subscriptions add column if not exists admin_url text;
    alter table sm_saas_subscriptions add column if not exists reminded jsonb;
    alter table sm_saas_subscriptions add column if not exists notes text;
    alter table sm_saas_subscriptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_saas_subscriptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SAAS' || no::text else 'SAAS' || lpad(no::text, 5, '0') end) stored,
  name text,
  supplier_id uuid,
  software_model_id uuid,
  contract_id uuid,
  plan text,
  billing_cycle text,
  owner_id uuid,
  seats integer,
  seats_assigned integer,
  seats_active integer,
  cost_per_seat numeric,
  annual_cost numeric,
  renewal_date date,
  auto_renew boolean not null default true,
  cost_center_id uuid,
  sso boolean not null default false,
  admin_url text,
  reminded jsonb,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_saas_subscriptions', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_saas_subscriptions_search_56291d9d_trgm', 'sm_saas_subscriptions', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_saas_subscriptions_search_custom_trgm', 'sm_saas_subscriptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_saas_subscriptions_no_uk on sm_saas_subscriptions (org_id, no);
create index if not exists sm_saas_subscriptions_rev_idx on sm_saas_subscriptions (org_id, rev);
create index if not exists sm_saas_subscriptions_upd_idx on sm_saas_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_subscriptions_crt_idx on sm_saas_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_subscriptions_renewal_date_idx on sm_saas_subscriptions (org_id, renewal_date) where deleted_at is null;
create index if not exists sm_saas_subscriptions_state_idx on sm_saas_subscriptions (org_id, state) where deleted_at is null;
create index if not exists sm_saas_subscriptions_workspace_acc_idx on sm_saas_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_saas_subscriptions_unit_acc_idx on sm_saas_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_saas_subscriptions_domain_acc_idx on sm_saas_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_saas_subscriptions_owner_id_idx on sm_saas_subscriptions (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_saas_subscriptions_sync on sm_saas_subscriptions;
create trigger sm_saas_subscriptions_sync before insert or update on sm_saas_subscriptions for each row execute function sm_sync_touch('saas_subscription');
create or replace trigger sm_saas_subscriptions_demo after insert on sm_saas_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_saas_subscriptions_demo_t after update or delete on sm_saas_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_saas_subscriptions enable row level security;

-- schedule: زمان‌بندی‌ها
do $cols$
begin
  if to_regclass('sm_schedules') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default false,
  table_key text,
  spec jsonb,
  template jsonb,
  run_as uuid,
  description text
);
create index if not exists sm_schedules_rev_idx on sm_schedules (org_id, rev);
create index if not exists sm_schedules_upd_idx on sm_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_schedules_crt_idx on sm_schedules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_schedules_sync on sm_schedules;
create trigger sm_schedules_sync before insert or update on sm_schedules for each row execute function sm_sync_touch('schedule');
create or replace trigger sm_schedules_demo after insert on sm_schedules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_schedules_demo_t after update or delete on sm_schedules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_schedules enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:19', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

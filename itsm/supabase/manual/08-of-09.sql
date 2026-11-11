-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۸ از ۹ (0006_engine_tables:25/28 … 0010_notify)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۵ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 25/28 (e746bd22eb04)
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_visits', 'search_efc3a717', $x$translate(coalesce(visitor_name, '') || ' ' || coalesce(visitor_company, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_wfm_absences', 'search_9e3cdfc8', $x$translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_wfm_rosters', 'search_9e3cdfc8', $x$translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:24', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۶ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 26/28 (e746bd22eb04)
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_wo_tasks', 'search_9c3826f0', $x$translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_work_orders', 'search_8fe328e6', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(parent_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:25', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۷ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 27/28 (e746bd22eb04)
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:26', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۸ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 28/28 (e746bd22eb04)
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
begin
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
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:27', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

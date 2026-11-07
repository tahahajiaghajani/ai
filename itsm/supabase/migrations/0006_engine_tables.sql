-- «ITSM» migration 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها)
-- ---------------------------------------------------------------------------
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
alter table sm_schedules add column if not exists active boolean not null default true;
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

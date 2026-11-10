-- «کاریز» migration 0080_admin_integration — مدیریت و اتصال‌ها: طرح‌ها، کلیدهای قابلیت، اطلاعیه‌ها، پشتیبان‌ها، کلیدهای API کاربران یکپارچه‌سازی، گزارش اتصال‌ها و فهرست کاربران
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

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

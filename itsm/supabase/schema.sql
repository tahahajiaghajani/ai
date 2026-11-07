-- ============================================================================
-- «ITSM» — پایگاه دادهٔ کامل برای Supabase (PostgreSQL 15+)
-- این فایل را یک بار در Supabase ← SQL Editor ← New query بچسبانید و Run بزنید.
-- اجرای دوباره بی‌خطر است (همهٔ دستورها idempotent هستند).
-- برنامه هم هنگام اجرا migrationهای جاافتاده را خودکار اعمال می‌کند (AUTO_MIGRATE).
-- این فایل خودکار از src/server/db/migrations ساخته می‌شود: npm run schema
-- ============================================================================

create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0001_core — هسته: کاربران، سازمان‌ها، اعضا، همگام‌سازی و گزارش رویدادها
-- ---------------------------------------------------------------------------
create table if not exists sm_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

-- key/value store (desktop: sync cursors, the last backup; cloud: platform settings)
create table if not exists sm_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- per-organisation revision counter (and, under the nil id, the user accounts' counter)
create table if not exists sm_org_sync (
  org_id uuid primary key,
  rev bigint not null default 0
);

-- desktop only: aggregates changed locally and not yet pushed to the cloud
create table if not exists sm_outbox (
  entity text not null,
  id uuid not null,
  changed_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  primary key (entity, id)
);

create table if not exists sm_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  mobile text,
  password_hash text,
  recovery_hash text,
  is_platform_admin boolean not null default false,
  disabled boolean not null default false,
  prefs jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists sm_users_email_uk on sm_users (lower(email));
create index if not exists sm_users_rev_idx on sm_users (rev);

create table if not exists sm_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sm_users(id) on delete cascade,
  token_hash text not null,
  kind text not null default 'web',
  device_name text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists sm_sessions_user_idx on sm_sessions (user_id);

create table if not exists sm_orgs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid generated always as (id) stored,
  name text not null,
  legal_name text,
  modules jsonb not null default '[]'::jsonb,
  phone text,
  email text,
  website text,
  city text,
  address text,
  logo text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists sm_org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'viewer',
  overrides jsonb not null default '{}'::jsonb,
  title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists sm_org_members_uk on sm_org_members (org_id, user_id);
create index if not exists sm_org_members_user_idx on sm_org_members (user_id);
create index if not exists sm_org_members_rev_idx on sm_org_members (org_id, rev);

-- Windows apps linked to an organisation in the cloud
create table if not exists sm_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  user_id uuid not null,
  name text not null default '',
  platform text,
  app_version text,
  last_push_at timestamptz,
  last_pull_at timestamptz,
  cursor bigint not null default 0,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- every change of an organisation; actor_kind 'user' (a member), 'support' (the platform admin in a support
-- session) or 'platform' (a change the platform admin made from the console)
create table if not exists sm_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  user_id uuid,
  at timestamptz not null default now(),
  action text not null,
  entity text,
  entity_id uuid,
  summary text,
  data jsonb,
  origin text,
  actor_kind text not null default 'user',
  support_session_id uuid
);
create index if not exists sm_audit_org_idx on sm_audit (org_id, at desc);
create index if not exists sm_audit_actor_idx on sm_audit (at desc) where actor_kind <> 'user';

create or replace function sm_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
  v_applying boolean := coalesce(current_setting('itsm.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    if not v_applying then
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

create or replace function sm_user_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
begin
  if coalesce(current_setting('itsm.applying', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') <> 'desktop' then
    insert into sm_org_sync (org_id, rev) values ('00000000-0000-0000-0000-000000000000', 1)
    on conflict (org_id) do update set rev = sm_org_sync.rev + 1
    returning rev into v_rev;
    new.rev := v_rev;
  end if;
  return new;
end
$fn$;

drop trigger if exists sm_users_touch on sm_users;
create trigger sm_users_touch before insert or update on sm_users
  for each row execute function sm_user_touch();

-- the sync trigger on the platform's aggregate roots (entity name = trigger argument, see sync/registry.ts)
drop trigger if exists sm_orgs_sync on sm_orgs;
create trigger sm_orgs_sync before insert or update on sm_orgs for each row execute function sm_sync_touch('org');
drop trigger if exists sm_org_members_sync on sm_org_members;
create trigger sm_org_members_sync before insert or update on sm_org_members for each row execute function sm_sync_touch('member');

-- Supabase: every table is reachable only through the app's own server connection (RLS on, no policies;
-- the public anon/authenticated roles get nothing). Each migration ends with this block.
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

insert into sm_migrations (id) values ('0001_core') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0002_platform — مدیریت سامانه: حالت پشتیبانی، رویدادهای امنیتی و وضعیت سازمان‌ها
-- ---------------------------------------------------------------------------
create table if not exists sm_support_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  admin_user_id uuid not null,
  level text not null check (level in ('view', 'edit')),
  reason text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_by uuid
);
create index if not exists sm_support_sessions_org_idx on sm_support_sessions (org_id, started_at desc);
create index if not exists sm_support_sessions_admin_idx on sm_support_sessions (admin_user_id, started_at desc);

create table if not exists sm_security_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null,
  user_id uuid,
  email text,
  org_id uuid,
  ip text,
  user_agent text,
  ok boolean not null default true,
  data jsonb
);
create index if not exists sm_security_events_at_idx on sm_security_events (at desc);
create index if not exists sm_security_events_user_idx on sm_security_events (user_id, at desc);
create index if not exists sm_security_events_org_idx on sm_security_events (org_id, at desc);

create table if not exists sm_org_admin (
  org_id uuid primary key,
  status text not null default 'active' check (status in ('active', 'read_only', 'suspended')),
  status_reason text,
  notes text,
  ai_disabled boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create or replace function sm_audit_actor() returns trigger language plpgsql as $fn$
declare
  v_kind text := coalesce(current_setting('itsm.actor_kind', true), '');
  v_session text := coalesce(current_setting('itsm.support_session', true), '');
begin
  if v_kind <> '' and new.actor_kind = 'user' then
    new.actor_kind := v_kind;
  end if;
  if v_session <> '' and new.support_session_id is null then
    new.support_session_id := v_session::uuid;
  end if;
  return new;
end
$fn$;
drop trigger if exists sm_audit_actor on sm_audit;
create trigger sm_audit_actor before insert on sm_audit for each row execute function sm_audit_actor();

-- Supabase: reachable only through the app's own server connection
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

insert into sm_migrations (id) values ('0002_platform') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0003_integrations — اتصال‌ها: کلیدهای API و وب‌هوک‌ها
-- ---------------------------------------------------------------------------
create table if not exists sm_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes jsonb not null default '["read","write"]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists sm_api_keys_prefix_idx on sm_api_keys (prefix);

create table if not exists sm_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null default 'webhook',
  name text not null,
  config jsonb not null default '{}'::jsonb,
  secret text,
  is_active boolean not null default true,
  last_event_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sm_integrations_org_idx on sm_integrations (org_id) where deleted_at is null;

create table if not exists sm_integration_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  integration_id uuid,
  received_at timestamptz not null default now(),
  topic text,
  external_id text,
  payload jsonb,
  status text not null default 'received',
  result jsonb,
  error text
);
create index if not exists sm_integration_events_idx on sm_integration_events (org_id, received_at desc);
create unique index if not exists sm_integration_events_ext_uk on sm_integration_events (integration_id, topic, external_id) where external_id is not null;

-- Supabase: reachable only through the app's own server connection
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

insert into sm_migrations (id) values ('0003_integrations') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0004_ai — هوش مصنوعی: اتصال‌ها، مصرف، گفتگوها و پیشنهادها
-- ---------------------------------------------------------------------------
create table if not exists sm_ai_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  label text not null,
  preset text not null,
  protocol text not null,
  base_url text,
  secret_enc text,
  key_hint text,
  key_fp text,
  models jsonb not null default '{"smart":[],"fast":[],"vision":[]}'::jsonb,
  available_models jsonb,
  models_at timestamptz,
  status text not null default 'unchecked',
  last_error jsonb,
  checked_at timestamptz,
  enabled boolean not null default true,
  -- the provider's free plan («طرح رایگان»): its calls are recorded at zero cost and do not count against budgets
  free_tier boolean not null default false,
  priority int not null default 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sm_ai_connections_org_idx on sm_ai_connections (org_id, priority) where deleted_at is null;

create table if not exists sm_ai_settings (
  org_id uuid primary key references sm_orgs(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- a connection (model = '') or one of its models paused after a rate limit or an exhausted quota
create table if not exists sm_ai_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  connection_id uuid not null references sm_ai_connections(id) on delete cascade,
  model text not null default '',
  until timestamptz not null,
  kind text,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists sm_ai_holds_key on sm_ai_holds (connection_id, model);

create table if not exists sm_ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references sm_orgs(id) on delete cascade,
  user_id uuid,
  feature text not null,
  job text,
  connection_id uuid,
  preset text,
  model text,
  route text not null default 'direct',
  input int not null default 0,
  output int not null default 0,
  cache_read int not null default 0,
  cache_write int not null default 0,
  reasoning int not null default 0,
  cost_usd numeric(16,6) not null default 0,
  priced boolean not null default true,
  ms int,
  ok boolean not null default true,
  error_kind text,
  thread_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_usage_org_idx on sm_ai_usage (org_id, created_at);
create index if not exists sm_ai_usage_user_idx on sm_ai_usage (org_id, user_id, created_at);

create table if not exists sm_ai_threads (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  user_id uuid not null,
  title text not null default '',
  context jsonb,
  pinned boolean not null default false,
  archived_at timestamptz,
  -- the request answering right now (a lease, so a crashed run does not block the thread forever)
  run_id uuid,
  run_until timestamptz,
  stop_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sm_ai_threads_user_idx on sm_ai_threads (org_id, user_id, updated_at desc);

-- append-only: one row per user message and one per finished step of an answer
create table if not exists sm_ai_messages (
  id uuid primary key,
  seq bigserial,
  thread_id uuid not null references sm_ai_threads(id) on delete cascade,
  org_id uuid not null,
  user_id uuid,
  role text not null,
  kind text not null default 'message',
  reply_to uuid,
  text text not null default '',
  parts jsonb,
  native jsonb,
  model text,
  connection_id uuid,
  usage jsonb,
  rating smallint,
  status text not null default 'done',
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_messages_thread_idx on sm_ai_messages (thread_id, seq);

create table if not exists sm_ai_tool_calls (
  id uuid primary key,
  thread_id uuid references sm_ai_threads(id) on delete cascade,
  message_id uuid,
  org_id uuid not null,
  user_id uuid,
  tool text not null,
  input jsonb,
  ok boolean not null default true,
  summary text,
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_tool_calls_org_idx on sm_ai_tool_calls (org_id, created_at desc);
create index if not exists sm_ai_tool_calls_thread_idx on sm_ai_tool_calls (thread_id);

-- proposals: a write the assistant prepared; nothing happens until a permitted person confirms it
create table if not exists sm_ai_actions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  thread_id uuid,
  message_id uuid,
  user_id uuid not null,
  kind text not null,
  tool text,
  area text not null,
  level text not null,
  payload jsonb not null,
  payload_hash text not null,
  preview jsonb not null,
  status text not null default 'proposed',
  idempotency_key text not null,
  confirmed_by uuid,
  confirmed_at timestamptz,
  result jsonb,
  error text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sm_ai_actions_idem on sm_ai_actions (idempotency_key);
create index if not exists sm_ai_actions_org_idx on sm_ai_actions (org_id, created_at desc);
create index if not exists sm_ai_actions_thread_idx on sm_ai_actions (thread_id, payload_hash);

-- rows behind a chart or a table shown in an answer (the model never writes these numbers)
create table if not exists sm_ai_data_refs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  user_id uuid not null,
  thread_id uuid references sm_ai_threads(id) on delete cascade,
  rows jsonb not null,
  meta jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_data_refs_org_idx on sm_ai_data_refs (org_id, expires_at);

-- Supabase: reachable only through the app's own server connection
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

insert into sm_migrations (id) values ('0004_ai') on conflict (id) do nothing;

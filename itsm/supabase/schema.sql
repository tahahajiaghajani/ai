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

-- ---------------------------------------------------------------------------
-- 0005_engine — موتور رکوردها: صف کارها، تاریخچه، یادداشت‌ها، پیوست‌ها، پیوندها و شماره‌ها
-- ---------------------------------------------------------------------------
create table if not exists sm_meta (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create table if not exists sm_numbers (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  last integer not null default 0,
  primary key (org_id, table_key)
);

create table if not exists sm_jobs (
  id uuid primary key,
  org_id uuid references sm_orgs(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  locked_until timestamptz,
  locked_by text,
  dedupe_key text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists sm_jobs_due_idx on sm_jobs (run_at) where status = 'queued';
create index if not exists sm_jobs_running_idx on sm_jobs (locked_until) where status = 'running';
create index if not exists sm_jobs_finished_idx on sm_jobs (done_at) where status in ('done', 'failed');
create index if not exists sm_jobs_org_idx on sm_jobs (org_id, created_at desc);
create unique index if not exists sm_jobs_dedupe_uk on sm_jobs (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key)
  where dedupe_key is not null and status = 'queued';

create table if not exists sm_history (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  field text not null,
  old jsonb,
  new jsonb,
  actor uuid,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists sm_history_record_idx on sm_history (org_id, table_key, record_id, at);
create index if not exists sm_history_rev_idx on sm_history (org_id, rev);

create table if not exists sm_journal (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  kind text not null default 'comment',
  visibility text not null default 'public',
  body text not null default '',
  author uuid,
  data jsonb,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists sm_journal_record_idx on sm_journal (org_id, table_key, record_id, created_at);
create index if not exists sm_journal_rev_idx on sm_journal (org_id, rev);

create table if not exists sm_attachments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  name text not null,
  mime text not null,
  size bigint not null,
  sha256 text not null,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create index if not exists sm_attachments_record_idx on sm_attachments (org_id, table_key, record_id) where deleted_at is null;
create index if not exists sm_attachments_sha_idx on sm_attachments (org_id, sha256);
create index if not exists sm_attachments_rev_idx on sm_attachments (org_id, rev);

create table if not exists sm_blobs (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  sha256 text not null,
  size bigint not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (org_id, sha256)
);

create table if not exists sm_links (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null,
  from_table text not null,
  from_id uuid not null,
  to_table text not null,
  to_id uuid not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);
create unique index if not exists sm_links_uk on sm_links (org_id, kind, from_id, to_id) where deleted_at is null;
create index if not exists sm_links_from_idx on sm_links (org_id, from_id) where deleted_at is null;
create index if not exists sm_links_to_idx on sm_links (org_id, to_id) where deleted_at is null;
create index if not exists sm_links_rev_idx on sm_links (org_id, rev);

create table if not exists sm_scope_epochs (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  user_id uuid not null,
  epoch integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- what a member may read changes with their role, per-area access or membership: their Windows app re-reads
create or replace function sm_member_scope_touch() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'INSERT' or new.role is distinct from old.role or new.overrides is distinct from old.overrides
     or new.is_active is distinct from old.is_active or new.deleted_at is distinct from old.deleted_at then
    insert into sm_scope_epochs (org_id, user_id, epoch) values (new.org_id, new.user_id, 1)
    on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
  end if;
  return new;
end
$fn$;
drop trigger if exists sm_org_members_scope on sm_org_members;
create trigger sm_org_members_scope after insert or update on sm_org_members for each row execute function sm_member_scope_touch();

drop trigger if exists sm_history_sync on sm_history;
create trigger sm_history_sync before insert or update on sm_history for each row execute function sm_sync_touch('history');
drop trigger if exists sm_journal_sync on sm_journal;
create trigger sm_journal_sync before insert or update on sm_journal for each row execute function sm_sync_touch('journal');
drop trigger if exists sm_attachments_sync on sm_attachments;
create trigger sm_attachments_sync before insert or update on sm_attachments for each row execute function sm_sync_touch('attachment');
drop trigger if exists sm_links_sync on sm_links;
create trigger sm_links_sync before insert or update on sm_links for each row execute function sm_sync_touch('link');

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

insert into sm_migrations (id) values ('0005_engine') on conflict (id) do nothing;

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

-- catalog: کاتالوگ‌ها
create table if not exists sm_catalogs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalogs add column if not exists workspace_id uuid;
alter table sm_catalogs add column if not exists domain_id uuid;
alter table sm_catalogs add column if not exists unit_id uuid;
alter table sm_catalogs add column if not exists created_at timestamptz not null default now();
alter table sm_catalogs add column if not exists created_by uuid;
alter table sm_catalogs add column if not exists updated_at timestamptz not null default now();
alter table sm_catalogs add column if not exists updated_by uuid;
alter table sm_catalogs add column if not exists rev bigint not null default 0;
alter table sm_catalogs add column if not exists version integer not null default 1;
alter table sm_catalogs add column if not exists deleted_at timestamptz;
alter table sm_catalogs add column if not exists origin text;
alter table sm_catalogs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalogs add column if not exists name text;
alter table sm_catalogs add column if not exists active boolean not null default true;
alter table sm_catalogs add column if not exists sort_order integer;
alter table sm_catalogs add column if not exists description text;
alter table sm_catalogs add column if not exists icon text;
alter table sm_catalogs add column if not exists color text;
alter table sm_catalogs add column if not exists category_order text;
alter table sm_catalogs add column if not exists banner text;
alter table sm_catalogs add column if not exists owner_id uuid;
alter table sm_catalogs add column if not exists managers jsonb;
alter table sm_catalogs add column if not exists available_for jsonb;
alter table sm_catalogs add column if not exists not_available_for jsonb;
create index if not exists sm_catalogs_rev_idx on sm_catalogs (org_id, rev);
create index if not exists sm_catalogs_upd_idx on sm_catalogs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalogs_crt_idx on sm_catalogs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_catalogs_name_uk on sm_catalogs (org_id, name) where deleted_at is null;
create index if not exists sm_catalogs_workspace_acc_idx on sm_catalogs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_catalogs_unit_acc_idx on sm_catalogs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_catalogs_domain_acc_idx on sm_catalogs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_catalogs_owner_id_idx on sm_catalogs (org_id, owner_id) where deleted_at is null;
create index if not exists sm_catalogs_managers_gin on sm_catalogs using gin (managers);
drop trigger if exists sm_catalogs_sync on sm_catalogs;
create trigger sm_catalogs_sync before insert or update on sm_catalogs for each row execute function sm_sync_touch('catalog');
alter table sm_catalogs enable row level security;

-- catalog_audience: مخاطبان کاتالوگ
create table if not exists sm_catalog_audiences (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_audiences add column if not exists workspace_id uuid;
alter table sm_catalog_audiences add column if not exists domain_id uuid;
alter table sm_catalog_audiences add column if not exists unit_id uuid;
alter table sm_catalog_audiences add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_audiences add column if not exists created_by uuid;
alter table sm_catalog_audiences add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_audiences add column if not exists updated_by uuid;
alter table sm_catalog_audiences add column if not exists rev bigint not null default 0;
alter table sm_catalog_audiences add column if not exists version integer not null default 1;
alter table sm_catalog_audiences add column if not exists deleted_at timestamptz;
alter table sm_catalog_audiences add column if not exists origin text;
alter table sm_catalog_audiences add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_audiences add column if not exists name text;
alter table sm_catalog_audiences add column if not exists match text;
alter table sm_catalog_audiences add column if not exists active boolean not null default true;
alter table sm_catalog_audiences add column if not exists users jsonb;
alter table sm_catalog_audiences add column if not exists groups jsonb;
alter table sm_catalog_audiences add column if not exists units jsonb;
alter table sm_catalog_audiences add column if not exists include_subunits boolean not null default true;
alter table sm_catalog_audiences add column if not exists locations jsonb;
alter table sm_catalog_audiences add column if not exists include_sublocations boolean not null default true;
alter table sm_catalog_audiences add column if not exists roles jsonb;
alter table sm_catalog_audiences add column if not exists personas jsonb;
alter table sm_catalog_audiences add column if not exists vip_only boolean not null default false;
alter table sm_catalog_audiences add column if not exists condition jsonb;
alter table sm_catalog_audiences add column if not exists description text;
create index if not exists sm_catalog_audiences_rev_idx on sm_catalog_audiences (org_id, rev);
create index if not exists sm_catalog_audiences_upd_idx on sm_catalog_audiences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_audiences_crt_idx on sm_catalog_audiences (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_catalog_audiences_name_uk on sm_catalog_audiences (org_id, name) where deleted_at is null;
drop trigger if exists sm_catalog_audiences_sync on sm_catalog_audiences;
create trigger sm_catalog_audiences_sync before insert or update on sm_catalog_audiences for each row execute function sm_sync_touch('catalog_audience');
alter table sm_catalog_audiences enable row level security;

-- catalog_category: دسته‌های کاتالوگ
create table if not exists sm_catalog_categories (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_categories add column if not exists workspace_id uuid;
alter table sm_catalog_categories add column if not exists domain_id uuid;
alter table sm_catalog_categories add column if not exists unit_id uuid;
alter table sm_catalog_categories add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_categories add column if not exists created_by uuid;
alter table sm_catalog_categories add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_categories add column if not exists updated_by uuid;
alter table sm_catalog_categories add column if not exists rev bigint not null default 0;
alter table sm_catalog_categories add column if not exists version integer not null default 1;
alter table sm_catalog_categories add column if not exists deleted_at timestamptz;
alter table sm_catalog_categories add column if not exists origin text;
alter table sm_catalog_categories add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_categories add column if not exists name text;
alter table sm_catalog_categories add column if not exists catalog_id uuid;
alter table sm_catalog_categories add column if not exists parent_id uuid;
alter table sm_catalog_categories add column if not exists sort_order integer;
alter table sm_catalog_categories add column if not exists active boolean not null default true;
alter table sm_catalog_categories add column if not exists description text;
alter table sm_catalog_categories add column if not exists icon text;
alter table sm_catalog_categories add column if not exists available_for jsonb;
alter table sm_catalog_categories add column if not exists not_available_for jsonb;
create index if not exists sm_catalog_categories_rev_idx on sm_catalog_categories (org_id, rev);
create index if not exists sm_catalog_categories_upd_idx on sm_catalog_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_categories_crt_idx on sm_catalog_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_categories_catalog_id_idx on sm_catalog_categories (org_id, catalog_id) where deleted_at is null;
drop trigger if exists sm_catalog_categories_sync on sm_catalog_categories;
create trigger sm_catalog_categories_sync before insert or update on sm_catalog_categories for each row execute function sm_sync_touch('catalog_category');
alter table sm_catalog_categories enable row level security;

-- catalog_item: اقلام کاتالوگ
create table if not exists sm_catalog_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_items add column if not exists workspace_id uuid;
alter table sm_catalog_items add column if not exists domain_id uuid;
alter table sm_catalog_items add column if not exists unit_id uuid;
alter table sm_catalog_items add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_items add column if not exists created_by uuid;
alter table sm_catalog_items add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_items add column if not exists updated_by uuid;
alter table sm_catalog_items add column if not exists rev bigint not null default 0;
alter table sm_catalog_items add column if not exists version integer not null default 1;
alter table sm_catalog_items add column if not exists deleted_at timestamptz;
alter table sm_catalog_items add column if not exists origin text;
alter table sm_catalog_items add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_items add column if not exists no integer;
alter table sm_catalog_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ITM' || no::text else 'ITM' || lpad(no::text, 5, '0') end) stored;
alter table sm_catalog_items add column if not exists name text;
alter table sm_catalog_items add column if not exists code text;
alter table sm_catalog_items add column if not exists type text;
alter table sm_catalog_items add column if not exists catalog_id uuid;
alter table sm_catalog_items add column if not exists category_id uuid;
alter table sm_catalog_items add column if not exists short_description text;
alter table sm_catalog_items add column if not exists description text;
alter table sm_catalog_items add column if not exists icon text;
alter table sm_catalog_items add column if not exists color text;
alter table sm_catalog_items add column if not exists sort_order integer;
alter table sm_catalog_items add column if not exists owner_id uuid;
alter table sm_catalog_items add column if not exists editors jsonb;
alter table sm_catalog_items add column if not exists featured boolean not null default false;
alter table sm_catalog_items add column if not exists hidden boolean not null default false;
alter table sm_catalog_items add column if not exists ad_hoc boolean not null default false;
alter table sm_catalog_items add column if not exists content_url text;
alter table sm_catalog_items add column if not exists button_label text;
alter table sm_catalog_items add column if not exists title_template text;
alter table sm_catalog_items add column if not exists on_behalf text;
alter table sm_catalog_items add column if not exists multi_user boolean not null default false;
alter table sm_catalog_items add column if not exists cart_allowed boolean not null default true;
alter table sm_catalog_items add column if not exists quantity_allowed boolean not null default false;
alter table sm_catalog_items add column if not exists max_quantity integer;
alter table sm_catalog_items add column if not exists requester_edit boolean not null default true;
alter table sm_catalog_items add column if not exists requester_cancel text;
alter table sm_catalog_items add column if not exists requires_confirmation boolean not null default true;
alter table sm_catalog_items add column if not exists price numeric;
alter table sm_catalog_items add column if not exists recurring_price numeric;
alter table sm_catalog_items add column if not exists recurring_frequency text;
alter table sm_catalog_items add column if not exists show_price boolean not null default true;
alter table sm_catalog_items add column if not exists creates_subscription boolean not null default false;
alter table sm_catalog_items add column if not exists delivery_days integer;
alter table sm_catalog_items add column if not exists calendar_id uuid;
alter table sm_catalog_items add column if not exists fulfilment_group_id uuid;
alter table sm_catalog_items add column if not exists flow_id uuid;
alter table sm_catalog_items add column if not exists approval_rule_id uuid;
alter table sm_catalog_items add column if not exists target_table text;
alter table sm_catalog_items add column if not exists field_map jsonb;
alter table sm_catalog_items add column if not exists std_change_template text;
alter table sm_catalog_items add column if not exists variable_sets jsonb;
alter table sm_catalog_items add column if not exists stages jsonb;
alter table sm_catalog_items add column if not exists available_for jsonb;
alter table sm_catalog_items add column if not exists not_available_for jsonb;
alter table sm_catalog_items add column if not exists conversational boolean not null default true;
alter table sm_catalog_items add column if not exists review_interval_days integer;
alter table sm_catalog_items add column if not exists next_review_at date;
alter table sm_catalog_items add column if not exists version_no integer;
alter table sm_catalog_items add column if not exists version_id uuid;
alter table sm_catalog_items add column if not exists published_at timestamptz;
alter table sm_catalog_items add column if not exists dirty boolean not null default false;
alter table sm_catalog_items add column if not exists sle_p50 bigint;
alter table sm_catalog_items add column if not exists sle_p85 bigint;
alter table sm_catalog_items add column if not exists sle_p95 bigint;
alter table sm_catalog_items add column if not exists sle_samples integer;
alter table sm_catalog_items add column if not exists orders_90d integer;
alter table sm_catalog_items add column if not exists state text;
create unique index if not exists sm_catalog_items_no_uk on sm_catalog_items (org_id, no);
create index if not exists sm_catalog_items_rev_idx on sm_catalog_items (org_id, rev);
create index if not exists sm_catalog_items_upd_idx on sm_catalog_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_items_crt_idx on sm_catalog_items (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_catalog_items_code_uk on sm_catalog_items (org_id, code) where deleted_at is null;
create index if not exists sm_catalog_items_catalog_id_idx on sm_catalog_items (org_id, catalog_id) where deleted_at is null;
create index if not exists sm_catalog_items_category_id_idx on sm_catalog_items (org_id, category_id) where deleted_at is null;
create index if not exists sm_catalog_items_state_idx on sm_catalog_items (org_id, state) where deleted_at is null;
create index if not exists sm_catalog_items_workspace_acc_idx on sm_catalog_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_catalog_items_unit_acc_idx on sm_catalog_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_catalog_items_domain_acc_idx on sm_catalog_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_catalog_items_owner_id_idx on sm_catalog_items (org_id, owner_id) where deleted_at is null;
create index if not exists sm_catalog_items_editors_gin on sm_catalog_items using gin (editors);
drop trigger if exists sm_catalog_items_sync on sm_catalog_items;
create trigger sm_catalog_items_sync before insert or update on sm_catalog_items for each row execute function sm_sync_touch('catalog_item');
alter table sm_catalog_items enable row level security;

-- catalog_item_version: نسخه‌های قلم کاتالوگ
create table if not exists sm_catalog_item_versions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_item_versions add column if not exists workspace_id uuid;
alter table sm_catalog_item_versions add column if not exists domain_id uuid;
alter table sm_catalog_item_versions add column if not exists unit_id uuid;
alter table sm_catalog_item_versions add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_item_versions add column if not exists created_by uuid;
alter table sm_catalog_item_versions add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_item_versions add column if not exists updated_by uuid;
alter table sm_catalog_item_versions add column if not exists rev bigint not null default 0;
alter table sm_catalog_item_versions add column if not exists version integer not null default 1;
alter table sm_catalog_item_versions add column if not exists deleted_at timestamptz;
alter table sm_catalog_item_versions add column if not exists origin text;
alter table sm_catalog_item_versions add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_item_versions add column if not exists title text;
alter table sm_catalog_item_versions add column if not exists item_id uuid;
alter table sm_catalog_item_versions add column if not exists version_no integer;
alter table sm_catalog_item_versions add column if not exists note text;
alter table sm_catalog_item_versions add column if not exists schema jsonb;
create index if not exists sm_catalog_item_versions_rev_idx on sm_catalog_item_versions (org_id, rev);
create index if not exists sm_catalog_item_versions_upd_idx on sm_catalog_item_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_item_versions_crt_idx on sm_catalog_item_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_item_versions_item_id_idx on sm_catalog_item_versions (org_id, item_id) where deleted_at is null;
create unique index if not exists sm_catalog_item_versions_item_id_version_no_uk on sm_catalog_item_versions (org_id, item_id, version_no) where deleted_at is null;
drop trigger if exists sm_catalog_item_versions_sync on sm_catalog_item_versions;
create trigger sm_catalog_item_versions_sync before insert or update on sm_catalog_item_versions for each row execute function sm_sync_touch('catalog_item_version');
alter table sm_catalog_item_versions enable row level security;

-- catalog_task_template: الگوهای وظیفهٔ انجام
create table if not exists sm_catalog_task_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_task_templates add column if not exists workspace_id uuid;
alter table sm_catalog_task_templates add column if not exists domain_id uuid;
alter table sm_catalog_task_templates add column if not exists unit_id uuid;
alter table sm_catalog_task_templates add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_task_templates add column if not exists created_by uuid;
alter table sm_catalog_task_templates add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_task_templates add column if not exists updated_by uuid;
alter table sm_catalog_task_templates add column if not exists rev bigint not null default 0;
alter table sm_catalog_task_templates add column if not exists version integer not null default 1;
alter table sm_catalog_task_templates add column if not exists deleted_at timestamptz;
alter table sm_catalog_task_templates add column if not exists origin text;
alter table sm_catalog_task_templates add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_task_templates add column if not exists short_description text;
alter table sm_catalog_task_templates add column if not exists sort_order integer;
alter table sm_catalog_task_templates add column if not exists item_id uuid;
alter table sm_catalog_task_templates add column if not exists assignment_group_id uuid;
alter table sm_catalog_task_templates add column if not exists phase text;
alter table sm_catalog_task_templates add column if not exists depends_on_previous boolean not null default true;
alter table sm_catalog_task_templates add column if not exists requester_visible boolean not null default false;
alter table sm_catalog_task_templates add column if not exists class_of_service text;
alter table sm_catalog_task_templates add column if not exists condition jsonb;
alter table sm_catalog_task_templates add column if not exists instructions text;
alter table sm_catalog_task_templates add column if not exists checklist jsonb;
alter table sm_catalog_task_templates add column if not exists active boolean not null default true;
create index if not exists sm_catalog_task_templates_rev_idx on sm_catalog_task_templates (org_id, rev);
create index if not exists sm_catalog_task_templates_upd_idx on sm_catalog_task_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_task_templates_crt_idx on sm_catalog_task_templates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_task_templates_item_id_idx on sm_catalog_task_templates (org_id, item_id) where deleted_at is null;
drop trigger if exists sm_catalog_task_templates_sync on sm_catalog_task_templates;
create trigger sm_catalog_task_templates_sync before insert or update on sm_catalog_task_templates for each row execute function sm_sync_touch('catalog_task_template');
alter table sm_catalog_task_templates enable row level security;

-- catalog_ui_policy: سیاست‌های فرم سفارش
create table if not exists sm_catalog_ui_policies (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_ui_policies add column if not exists workspace_id uuid;
alter table sm_catalog_ui_policies add column if not exists domain_id uuid;
alter table sm_catalog_ui_policies add column if not exists unit_id uuid;
alter table sm_catalog_ui_policies add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_ui_policies add column if not exists created_by uuid;
alter table sm_catalog_ui_policies add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_ui_policies add column if not exists updated_by uuid;
alter table sm_catalog_ui_policies add column if not exists rev bigint not null default 0;
alter table sm_catalog_ui_policies add column if not exists version integer not null default 1;
alter table sm_catalog_ui_policies add column if not exists deleted_at timestamptz;
alter table sm_catalog_ui_policies add column if not exists origin text;
alter table sm_catalog_ui_policies add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_ui_policies add column if not exists name text;
alter table sm_catalog_ui_policies add column if not exists item_id uuid;
alter table sm_catalog_ui_policies add column if not exists set_id uuid;
alter table sm_catalog_ui_policies add column if not exists applies_to text;
alter table sm_catalog_ui_policies add column if not exists condition jsonb;
alter table sm_catalog_ui_policies add column if not exists actions jsonb;
alter table sm_catalog_ui_policies add column if not exists message text;
alter table sm_catalog_ui_policies add column if not exists sort_order integer;
alter table sm_catalog_ui_policies add column if not exists active boolean not null default true;
create index if not exists sm_catalog_ui_policies_rev_idx on sm_catalog_ui_policies (org_id, rev);
create index if not exists sm_catalog_ui_policies_upd_idx on sm_catalog_ui_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_ui_policies_crt_idx on sm_catalog_ui_policies (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_ui_policies_item_id_idx on sm_catalog_ui_policies (org_id, item_id) where deleted_at is null;
create index if not exists sm_catalog_ui_policies_set_id_idx on sm_catalog_ui_policies (org_id, set_id) where deleted_at is null;
drop trigger if exists sm_catalog_ui_policies_sync on sm_catalog_ui_policies;
create trigger sm_catalog_ui_policies_sync before insert or update on sm_catalog_ui_policies for each row execute function sm_sync_touch('catalog_ui_policy');
alter table sm_catalog_ui_policies enable row level security;

-- catalog_variable: پرسش‌های فرم
create table if not exists sm_catalog_variables (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_catalog_variables add column if not exists workspace_id uuid;
alter table sm_catalog_variables add column if not exists domain_id uuid;
alter table sm_catalog_variables add column if not exists unit_id uuid;
alter table sm_catalog_variables add column if not exists created_at timestamptz not null default now();
alter table sm_catalog_variables add column if not exists created_by uuid;
alter table sm_catalog_variables add column if not exists updated_at timestamptz not null default now();
alter table sm_catalog_variables add column if not exists updated_by uuid;
alter table sm_catalog_variables add column if not exists rev bigint not null default 0;
alter table sm_catalog_variables add column if not exists version integer not null default 1;
alter table sm_catalog_variables add column if not exists deleted_at timestamptz;
alter table sm_catalog_variables add column if not exists origin text;
alter table sm_catalog_variables add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_catalog_variables add column if not exists label text;
alter table sm_catalog_variables add column if not exists name text;
alter table sm_catalog_variables add column if not exists type text;
alter table sm_catalog_variables add column if not exists item_id uuid;
alter table sm_catalog_variables add column if not exists set_id uuid;
alter table sm_catalog_variables add column if not exists sort_order integer;
alter table sm_catalog_variables add column if not exists required boolean not null default false;
alter table sm_catalog_variables add column if not exists readonly boolean not null default false;
alter table sm_catalog_variables add column if not exists hidden boolean not null default false;
alter table sm_catalog_variables add column if not exists width text;
alter table sm_catalog_variables add column if not exists field_class text;
alter table sm_catalog_variables add column if not exists default_value text;
alter table sm_catalog_variables add column if not exists choices jsonb;
alter table sm_catalog_variables add column if not exists ref_table text;
alter table sm_catalog_variables add column if not exists ref_filter jsonb;
alter table sm_catalog_variables add column if not exists min numeric;
alter table sm_catalog_variables add column if not exists max numeric;
alter table sm_catalog_variables add column if not exists max_length integer;
alter table sm_catalog_variables add column if not exists price_per_unit numeric;
alter table sm_catalog_variables add column if not exists regex text;
alter table sm_catalog_variables add column if not exists regex_message text;
alter table sm_catalog_variables add column if not exists help text;
alter table sm_catalog_variables add column if not exists placeholder text;
alter table sm_catalog_variables add column if not exists map_to text;
alter table sm_catalog_variables add column if not exists active boolean not null default true;
create index if not exists sm_catalog_variables_rev_idx on sm_catalog_variables (org_id, rev);
create index if not exists sm_catalog_variables_upd_idx on sm_catalog_variables (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_variables_crt_idx on sm_catalog_variables (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_catalog_variables_item_id_idx on sm_catalog_variables (org_id, item_id) where deleted_at is null;
create index if not exists sm_catalog_variables_set_id_idx on sm_catalog_variables (org_id, set_id) where deleted_at is null;
drop trigger if exists sm_catalog_variables_sync on sm_catalog_variables;
create trigger sm_catalog_variables_sync before insert or update on sm_catalog_variables for each row execute function sm_sync_touch('catalog_variable');
alter table sm_catalog_variables enable row level security;

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

-- order_guide_rule: قاعده‌های راهنمای سفارش
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_order_guide_rules_rev_idx on sm_order_guide_rules (org_id, rev);
create index if not exists sm_order_guide_rules_upd_idx on sm_order_guide_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_order_guide_rules_crt_idx on sm_order_guide_rules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_order_guide_rules_guide_id_idx on sm_order_guide_rules (org_id, guide_id) where deleted_at is null;
drop trigger if exists sm_order_guide_rules_sync on sm_order_guide_rules;
create trigger sm_order_guide_rules_sync before insert or update on sm_order_guide_rules for each row execute function sm_sync_touch('order_guide_rule');
alter table sm_order_guide_rules enable row level security;

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

-- request: درخواست‌های خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_requests_watch_list_gin on sm_requests using gin (watch_list);
drop trigger if exists sm_requests_sync on sm_requests;
create trigger sm_requests_sync before insert or update on sm_requests for each row execute function sm_sync_touch('request');
alter table sm_requests enable row level security;

-- request_answer: پاسخ‌های سفارش
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_request_answers enable row level security;

-- request_cart: سبدهای سفارش
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_request_carts_rev_idx on sm_request_carts (org_id, rev);
create index if not exists sm_request_carts_upd_idx on sm_request_carts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_carts_crt_idx on sm_request_carts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_carts_user_id_idx on sm_request_carts (org_id, user_id) where deleted_at is null;
create index if not exists sm_request_carts_workspace_acc_idx on sm_request_carts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_carts_unit_acc_idx on sm_request_carts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_carts_domain_acc_idx on sm_request_carts (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_request_carts_sync on sm_request_carts;
create trigger sm_request_carts_sync before insert or update on sm_request_carts for each row execute function sm_sync_touch('request_cart');
alter table sm_request_carts enable row level security;

-- request_cart_line: اقلام سبد
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_request_cart_lines enable row level security;

-- request_config: تنظیمات درخواست خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_request_configs_rev_idx on sm_request_configs (org_id, rev);
create index if not exists sm_request_configs_upd_idx on sm_request_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_configs_crt_idx on sm_request_configs (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_request_configs_sync on sm_request_configs;
create trigger sm_request_configs_sync before insert or update on sm_request_configs for each row execute function sm_sync_touch('request_config');
alter table sm_request_configs enable row level security;

-- request_item: اقلام درخواست‌شده
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_request_items add column if not exists secret_answers text;
alter table sm_request_items add column if not exists price numeric;
alter table sm_request_items add column if not exists total numeric;
alter table sm_request_items add column if not exists recurring_price numeric;
alter table sm_request_items add column if not exists recurring_frequency text;
alter table sm_request_items add column if not exists cost numeric;
alter table sm_request_items add column if not exists ad_hoc boolean not null default false;
alter table sm_request_items add column if not exists fulfilment text;
alter table sm_request_items add column if not exists requires_confirmation boolean not null default false;
alter table sm_request_items add column if not exists access_until date;
alter table sm_request_items add column if not exists revoked_at timestamptz;
alter table sm_request_items add column if not exists subscription_id uuid;
alter table sm_request_items add column if not exists flow_runs jsonb;
alter table sm_request_items add column if not exists sle_p85 bigint;
alter table sm_request_items add column if not exists approval_requested_at timestamptz;
alter table sm_request_items add column if not exists approved_at timestamptz;
alter table sm_request_items add column if not exists fulfilment_started_at timestamptz;
alter table sm_request_items add column if not exists info_requested boolean not null default false;
alter table sm_request_items add column if not exists info_since timestamptz;
alter table sm_request_items add column if not exists info_wait bigint;
alter table sm_request_items add column if not exists reminded_at timestamptz;
alter table sm_request_items add column if not exists zero_touch boolean not null default false;
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
create index if not exists sm_request_items_watch_list_gin on sm_request_items using gin (watch_list);
drop trigger if exists sm_request_items_sync on sm_request_items;
create trigger sm_request_items_sync before insert or update on sm_request_items for each row execute function sm_sync_touch('request_item');
alter table sm_request_items enable row level security;

-- request_subscription: اشتراک‌های خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_request_subscriptions enable row level security;

-- request_task: وظایف انجام
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
  custom jsonb not null default '{}'::jsonb
);
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
drop trigger if exists sm_request_tasks_sync on sm_request_tasks;
create trigger sm_request_tasks_sync before insert or update on sm_request_tasks for each row execute function sm_sync_touch('request_task');
alter table sm_request_tasks enable row level security;

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

-- variable_set: مجموعه‌پرسش‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_variable_sets_rev_idx on sm_variable_sets (org_id, rev);
create index if not exists sm_variable_sets_upd_idx on sm_variable_sets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_variable_sets_crt_idx on sm_variable_sets (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_variable_sets_code_uk on sm_variable_sets (org_id, code) where deleted_at is null;
drop trigger if exists sm_variable_sets_sync on sm_variable_sets;
create trigger sm_variable_sets_sync before insert or update on sm_variable_sets for each row execute function sm_sync_touch('variable_set');
alter table sm_variable_sets enable row level security;

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

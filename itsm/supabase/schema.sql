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
-- ai_skill: مهارت‌های هوش مصنوعی
create table if not exists sm_ai_skills (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ai_skills add column if not exists workspace_id uuid;
alter table sm_ai_skills add column if not exists domain_id uuid;
alter table sm_ai_skills add column if not exists unit_id uuid;
alter table sm_ai_skills add column if not exists created_at timestamptz not null default now();
alter table sm_ai_skills add column if not exists created_by uuid;
alter table sm_ai_skills add column if not exists updated_at timestamptz not null default now();
alter table sm_ai_skills add column if not exists updated_by uuid;
alter table sm_ai_skills add column if not exists rev bigint not null default 0;
alter table sm_ai_skills add column if not exists version integer not null default 1;
alter table sm_ai_skills add column if not exists deleted_at timestamptz;
alter table sm_ai_skills add column if not exists origin text;
alter table sm_ai_skills add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ai_skills add column if not exists key text;
alter table sm_ai_skills add column if not exists name text;
alter table sm_ai_skills add column if not exists description text;
alter table sm_ai_skills add column if not exists module text;
alter table sm_ai_skills add column if not exists base_key text;
alter table sm_ai_skills add column if not exists builtin boolean not null default false;
alter table sm_ai_skills add column if not exists enabled boolean not null default true;
alter table sm_ai_skills add column if not exists target text;
alter table sm_ai_skills add column if not exists output text;
alter table sm_ai_skills add column if not exists tables jsonb;
alter table sm_ai_skills add column if not exists tier text;
alter table sm_ai_skills add column if not exists grounding text;
alter table sm_ai_skills add column if not exists grounding_k integer;
alter table sm_ai_skills add column if not exists collections jsonb;
alter table sm_ai_skills add column if not exists triggers jsonb;
alter table sm_ai_skills add column if not exists events jsonb;
alter table sm_ai_skills add column if not exists condition jsonb;
alter table sm_ai_skills add column if not exists schedule_minutes integer;
alter table sm_ai_skills add column if not exists schedule_filter jsonb;
alter table sm_ai_skills add column if not exists roles jsonb;
alter table sm_ai_skills add column if not exists field_groups jsonb;
alter table sm_ai_skills add column if not exists auto_apply jsonb;
alter table sm_ai_skills add column if not exists daily_limit integer;
alter table sm_ai_skills add column if not exists user_daily_limit integer;
alter table sm_ai_skills add column if not exists active_version_id uuid;
alter table sm_ai_skills add column if not exists last_scheduled_at timestamptz;
create index if not exists sm_ai_skills_rev_idx on sm_ai_skills (org_id, rev);
create index if not exists sm_ai_skills_upd_idx on sm_ai_skills (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skills_crt_idx on sm_ai_skills (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ai_skills_key_uk on sm_ai_skills (org_id, key) where deleted_at is null;
drop trigger if exists sm_ai_skills_sync on sm_ai_skills;
create trigger sm_ai_skills_sync before insert or update on sm_ai_skills for each row execute function sm_sync_touch('ai_skill');
alter table sm_ai_skills enable row level security;

-- ai_skill_eval: مجموعه‌های ارزیابی مهارت
create table if not exists sm_ai_skill_evals (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ai_skill_evals add column if not exists workspace_id uuid;
alter table sm_ai_skill_evals add column if not exists domain_id uuid;
alter table sm_ai_skill_evals add column if not exists unit_id uuid;
alter table sm_ai_skill_evals add column if not exists created_at timestamptz not null default now();
alter table sm_ai_skill_evals add column if not exists created_by uuid;
alter table sm_ai_skill_evals add column if not exists updated_at timestamptz not null default now();
alter table sm_ai_skill_evals add column if not exists updated_by uuid;
alter table sm_ai_skill_evals add column if not exists rev bigint not null default 0;
alter table sm_ai_skill_evals add column if not exists version integer not null default 1;
alter table sm_ai_skill_evals add column if not exists deleted_at timestamptz;
alter table sm_ai_skill_evals add column if not exists origin text;
alter table sm_ai_skill_evals add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ai_skill_evals add column if not exists skill_key text;
alter table sm_ai_skill_evals add column if not exists name text;
alter table sm_ai_skill_evals add column if not exists cases jsonb;
alter table sm_ai_skill_evals add column if not exists last_score numeric;
alter table sm_ai_skill_evals add column if not exists last_run_at timestamptz;
alter table sm_ai_skill_evals add column if not exists last_model text;
alter table sm_ai_skill_evals add column if not exists last_results jsonb;
create index if not exists sm_ai_skill_evals_rev_idx on sm_ai_skill_evals (org_id, rev);
create index if not exists sm_ai_skill_evals_upd_idx on sm_ai_skill_evals (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_evals_crt_idx on sm_ai_skill_evals (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_evals_skill_key_idx on sm_ai_skill_evals (org_id, skill_key) where deleted_at is null;
drop trigger if exists sm_ai_skill_evals_sync on sm_ai_skill_evals;
create trigger sm_ai_skill_evals_sync before insert or update on sm_ai_skill_evals for each row execute function sm_sync_touch('ai_skill_eval');
alter table sm_ai_skill_evals enable row level security;

-- ai_skill_run: اجراهای مهارت
create table if not exists sm_ai_skill_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ai_skill_runs add column if not exists workspace_id uuid;
alter table sm_ai_skill_runs add column if not exists domain_id uuid;
alter table sm_ai_skill_runs add column if not exists unit_id uuid;
alter table sm_ai_skill_runs add column if not exists created_at timestamptz not null default now();
alter table sm_ai_skill_runs add column if not exists created_by uuid;
alter table sm_ai_skill_runs add column if not exists updated_at timestamptz not null default now();
alter table sm_ai_skill_runs add column if not exists updated_by uuid;
alter table sm_ai_skill_runs add column if not exists rev bigint not null default 0;
alter table sm_ai_skill_runs add column if not exists version integer not null default 1;
alter table sm_ai_skill_runs add column if not exists deleted_at timestamptz;
alter table sm_ai_skill_runs add column if not exists origin text;
alter table sm_ai_skill_runs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ai_skill_runs add column if not exists skill_key text;
alter table sm_ai_skill_runs add column if not exists skill_id uuid;
alter table sm_ai_skill_runs add column if not exists version_id uuid;
alter table sm_ai_skill_runs add column if not exists version_no integer;
alter table sm_ai_skill_runs add column if not exists invoker_id uuid;
alter table sm_ai_skill_runs add column if not exists principal text;
alter table sm_ai_skill_runs add column if not exists table_key text;
alter table sm_ai_skill_runs add column if not exists record_id text;
alter table sm_ai_skill_runs add column if not exists record_number text;
alter table sm_ai_skill_runs add column if not exists input_hash text;
alter table sm_ai_skill_runs add column if not exists params jsonb;
alter table sm_ai_skill_runs add column if not exists status text;
alter table sm_ai_skill_runs add column if not exists output_kind text;
alter table sm_ai_skill_runs add column if not exists output_text text;
alter table sm_ai_skill_runs add column if not exists output_json jsonb;
alter table sm_ai_skill_runs add column if not exists citations jsonb;
alter table sm_ai_skill_runs add column if not exists clearance jsonb;
alter table sm_ai_skill_runs add column if not exists model text;
alter table sm_ai_skill_runs add column if not exists connection text;
alter table sm_ai_skill_runs add column if not exists tokens_in integer;
alter table sm_ai_skill_runs add column if not exists tokens_out integer;
alter table sm_ai_skill_runs add column if not exists cost_usd text;
alter table sm_ai_skill_runs add column if not exists latency_ms integer;
alter table sm_ai_skill_runs add column if not exists error text;
alter table sm_ai_skill_runs add column if not exists proposal_id text;
alter table sm_ai_skill_runs add column if not exists feedback integer;
alter table sm_ai_skill_runs add column if not exists feedback_comment text;
create index if not exists sm_ai_skill_runs_rev_idx on sm_ai_skill_runs (org_id, rev);
create index if not exists sm_ai_skill_runs_upd_idx on sm_ai_skill_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_runs_crt_idx on sm_ai_skill_runs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_runs_skill_key_idx on sm_ai_skill_runs (org_id, skill_key) where deleted_at is null;
create index if not exists sm_ai_skill_runs_invoker_id_idx on sm_ai_skill_runs (org_id, invoker_id) where deleted_at is null;
create index if not exists sm_ai_skill_runs_record_id_idx on sm_ai_skill_runs (org_id, record_id) where deleted_at is null;
create index if not exists sm_ai_skill_runs_workspace_acc_idx on sm_ai_skill_runs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ai_skill_runs_unit_acc_idx on sm_ai_skill_runs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ai_skill_runs_domain_acc_idx on sm_ai_skill_runs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_ai_skill_runs_sync on sm_ai_skill_runs;
alter table sm_ai_skill_runs enable row level security;

-- ai_skill_version: نسخه‌های مهارت
create table if not exists sm_ai_skill_versions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ai_skill_versions add column if not exists workspace_id uuid;
alter table sm_ai_skill_versions add column if not exists domain_id uuid;
alter table sm_ai_skill_versions add column if not exists unit_id uuid;
alter table sm_ai_skill_versions add column if not exists created_at timestamptz not null default now();
alter table sm_ai_skill_versions add column if not exists created_by uuid;
alter table sm_ai_skill_versions add column if not exists updated_at timestamptz not null default now();
alter table sm_ai_skill_versions add column if not exists updated_by uuid;
alter table sm_ai_skill_versions add column if not exists rev bigint not null default 0;
alter table sm_ai_skill_versions add column if not exists version integer not null default 1;
alter table sm_ai_skill_versions add column if not exists deleted_at timestamptz;
alter table sm_ai_skill_versions add column if not exists origin text;
alter table sm_ai_skill_versions add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ai_skill_versions add column if not exists skill_id uuid;
alter table sm_ai_skill_versions add column if not exists revision integer;
alter table sm_ai_skill_versions add column if not exists label text;
alter table sm_ai_skill_versions add column if not exists state text;
alter table sm_ai_skill_versions add column if not exists system text;
alter table sm_ai_skill_versions add column if not exists template text;
alter table sm_ai_skill_versions add column if not exists output_schema jsonb;
alter table sm_ai_skill_versions add column if not exists temperature numeric;
alter table sm_ai_skill_versions add column if not exists max_tokens integer;
alter table sm_ai_skill_versions add column if not exists note text;
alter table sm_ai_skill_versions add column if not exists published_at timestamptz;
alter table sm_ai_skill_versions add column if not exists published_by uuid;
create index if not exists sm_ai_skill_versions_rev_idx on sm_ai_skill_versions (org_id, rev);
create index if not exists sm_ai_skill_versions_upd_idx on sm_ai_skill_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_versions_crt_idx on sm_ai_skill_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_versions_skill_id_idx on sm_ai_skill_versions (org_id, skill_id) where deleted_at is null;
drop trigger if exists sm_ai_skill_versions_sync on sm_ai_skill_versions;
create trigger sm_ai_skill_versions_sync before insert or update on sm_ai_skill_versions for each row execute function sm_sync_touch('ai_skill_version');
alter table sm_ai_skill_versions enable row level security;

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

-- app_assessment: ارزیابی‌های سامانه
create table if not exists sm_app_assessments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_app_assessments add column if not exists workspace_id uuid;
alter table sm_app_assessments add column if not exists domain_id uuid;
alter table sm_app_assessments add column if not exists unit_id uuid;
alter table sm_app_assessments add column if not exists created_at timestamptz not null default now();
alter table sm_app_assessments add column if not exists created_by uuid;
alter table sm_app_assessments add column if not exists updated_at timestamptz not null default now();
alter table sm_app_assessments add column if not exists updated_by uuid;
alter table sm_app_assessments add column if not exists rev bigint not null default 0;
alter table sm_app_assessments add column if not exists version integer not null default 1;
alter table sm_app_assessments add column if not exists deleted_at timestamptz;
alter table sm_app_assessments add column if not exists origin text;
alter table sm_app_assessments add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_app_assessments add column if not exists no integer;
alter table sm_app_assessments add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ASM' || no::text else 'ASM' || lpad(no::text, 5, '0') end) stored;
alter table sm_app_assessments add column if not exists title text;
alter table sm_app_assessments add column if not exists ci_id uuid;
alter table sm_app_assessments add column if not exists assessor_id uuid;
alter table sm_app_assessments add column if not exists owner_id uuid;
alter table sm_app_assessments add column if not exists business_value integer;
alter table sm_app_assessments add column if not exists technical_fit integer;
alter table sm_app_assessments add column if not exists cost_score integer;
alter table sm_app_assessments add column if not exists risk_score integer;
alter table sm_app_assessments add column if not exists satisfaction integer;
alter table sm_app_assessments add column if not exists time_disposition text;
alter table sm_app_assessments add column if not exists recommendation text;
alter table sm_app_assessments add column if not exists state text;
create unique index if not exists sm_app_assessments_no_uk on sm_app_assessments (org_id, no);
create index if not exists sm_app_assessments_rev_idx on sm_app_assessments (org_id, rev);
create index if not exists sm_app_assessments_upd_idx on sm_app_assessments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_app_assessments_crt_idx on sm_app_assessments (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_app_assessments_ci_id_idx on sm_app_assessments (org_id, ci_id) where deleted_at is null;
create index if not exists sm_app_assessments_state_idx on sm_app_assessments (org_id, state) where deleted_at is null;
create index if not exists sm_app_assessments_workspace_acc_idx on sm_app_assessments (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_app_assessments_unit_acc_idx on sm_app_assessments (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_app_assessments_domain_acc_idx on sm_app_assessments (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_app_assessments_assessor_id_idx on sm_app_assessments (org_id, assessor_id) where deleted_at is null;
create index if not exists sm_app_assessments_owner_id_idx on sm_app_assessments (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_app_assessments_sync on sm_app_assessments;
create trigger sm_app_assessments_sync before insert or update on sm_app_assessments for each row execute function sm_sync_touch('app_assessment');
alter table sm_app_assessments enable row level security;

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
create index if not exists sm_approvals_decided_by_idx on sm_approvals (org_id, decided_by) where deleted_at is null;
create index if not exists sm_approvals_delegated_from_idx on sm_approvals (org_id, delegated_from) where deleted_at is null;
create index if not exists sm_approvals_workspace_acc_idx on sm_approvals (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_approvals_unit_acc_idx on sm_approvals (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_approvals_domain_acc_idx on sm_approvals (org_id, domain_id) where deleted_at is null and domain_id is not null;
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

-- business_capability: قابلیت‌های کسب‌وکار
create table if not exists sm_business_capabilities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_business_capabilities add column if not exists workspace_id uuid;
alter table sm_business_capabilities add column if not exists domain_id uuid;
alter table sm_business_capabilities add column if not exists unit_id uuid;
alter table sm_business_capabilities add column if not exists created_at timestamptz not null default now();
alter table sm_business_capabilities add column if not exists created_by uuid;
alter table sm_business_capabilities add column if not exists updated_at timestamptz not null default now();
alter table sm_business_capabilities add column if not exists updated_by uuid;
alter table sm_business_capabilities add column if not exists rev bigint not null default 0;
alter table sm_business_capabilities add column if not exists version integer not null default 1;
alter table sm_business_capabilities add column if not exists deleted_at timestamptz;
alter table sm_business_capabilities add column if not exists origin text;
alter table sm_business_capabilities add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_business_capabilities add column if not exists name text;
alter table sm_business_capabilities add column if not exists parent_id uuid;
alter table sm_business_capabilities add column if not exists level integer;
alter table sm_business_capabilities add column if not exists owner_id uuid;
alter table sm_business_capabilities add column if not exists sort_order integer;
alter table sm_business_capabilities add column if not exists coverage text;
alter table sm_business_capabilities add column if not exists services jsonb;
alter table sm_business_capabilities add column if not exists applications jsonb;
alter table sm_business_capabilities add column if not exists description text;
create index if not exists sm_business_capabilities_rev_idx on sm_business_capabilities (org_id, rev);
create index if not exists sm_business_capabilities_upd_idx on sm_business_capabilities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_business_capabilities_crt_idx on sm_business_capabilities (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_business_capabilities_parent_id_idx on sm_business_capabilities (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_business_capabilities_sync on sm_business_capabilities;
create trigger sm_business_capabilities_sync before insert or update on sm_business_capabilities for each row execute function sm_sync_touch('business_capability');
alter table sm_business_capabilities enable row level security;

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

-- cab: هیئت‌های CAB
create table if not exists sm_cabs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cabs add column if not exists workspace_id uuid;
alter table sm_cabs add column if not exists domain_id uuid;
alter table sm_cabs add column if not exists unit_id uuid;
alter table sm_cabs add column if not exists created_at timestamptz not null default now();
alter table sm_cabs add column if not exists created_by uuid;
alter table sm_cabs add column if not exists updated_at timestamptz not null default now();
alter table sm_cabs add column if not exists updated_by uuid;
alter table sm_cabs add column if not exists rev bigint not null default 0;
alter table sm_cabs add column if not exists version integer not null default 1;
alter table sm_cabs add column if not exists deleted_at timestamptz;
alter table sm_cabs add column if not exists origin text;
alter table sm_cabs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cabs add column if not exists name text;
alter table sm_cabs add column if not exists kind text;
alter table sm_cabs add column if not exists active boolean not null default true;
alter table sm_cabs add column if not exists manager_id uuid;
alter table sm_cabs add column if not exists group_id uuid;
alter table sm_cabs add column if not exists members jsonb;
alter table sm_cabs add column if not exists meeting_weekday text;
alter table sm_cabs add column if not exists meeting_time text;
alter table sm_cabs add column if not exists meeting_minutes integer;
alter table sm_cabs add column if not exists quorum integer;
alter table sm_cabs add column if not exists location text;
alter table sm_cabs add column if not exists conference_url text;
alter table sm_cabs add column if not exists agenda_condition jsonb;
alter table sm_cabs add column if not exists description text;
create index if not exists sm_cabs_rev_idx on sm_cabs (org_id, rev);
create index if not exists sm_cabs_upd_idx on sm_cabs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cabs_crt_idx on sm_cabs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cabs_name_uk on sm_cabs (org_id, name) where deleted_at is null;
create index if not exists sm_cabs_workspace_acc_idx on sm_cabs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cabs_unit_acc_idx on sm_cabs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cabs_domain_acc_idx on sm_cabs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cabs_manager_id_idx on sm_cabs (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_cabs_sync on sm_cabs;
create trigger sm_cabs_sync before insert or update on sm_cabs for each row execute function sm_sync_touch('cab');
alter table sm_cabs enable row level security;

-- cab_agenda_item: موردهای دستور جلسه
create table if not exists sm_cab_agenda_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cab_agenda_items add column if not exists workspace_id uuid;
alter table sm_cab_agenda_items add column if not exists domain_id uuid;
alter table sm_cab_agenda_items add column if not exists unit_id uuid;
alter table sm_cab_agenda_items add column if not exists created_at timestamptz not null default now();
alter table sm_cab_agenda_items add column if not exists created_by uuid;
alter table sm_cab_agenda_items add column if not exists updated_at timestamptz not null default now();
alter table sm_cab_agenda_items add column if not exists updated_by uuid;
alter table sm_cab_agenda_items add column if not exists rev bigint not null default 0;
alter table sm_cab_agenda_items add column if not exists version integer not null default 1;
alter table sm_cab_agenda_items add column if not exists deleted_at timestamptz;
alter table sm_cab_agenda_items add column if not exists origin text;
alter table sm_cab_agenda_items add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cab_agenda_items add column if not exists title text;
alter table sm_cab_agenda_items add column if not exists meeting_id uuid;
alter table sm_cab_agenda_items add column if not exists change_id uuid;
alter table sm_cab_agenda_items add column if not exists kind text;
alter table sm_cab_agenda_items add column if not exists sort_order integer;
alter table sm_cab_agenda_items add column if not exists presenter_id uuid;
alter table sm_cab_agenda_items add column if not exists decision text;
alter table sm_cab_agenda_items add column if not exists decided_by uuid;
alter table sm_cab_agenda_items add column if not exists decided_at timestamptz;
alter table sm_cab_agenda_items add column if not exists decision_notes text;
alter table sm_cab_agenda_items add column if not exists votes jsonb;
create index if not exists sm_cab_agenda_items_rev_idx on sm_cab_agenda_items (org_id, rev);
create index if not exists sm_cab_agenda_items_upd_idx on sm_cab_agenda_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_agenda_items_crt_idx on sm_cab_agenda_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_agenda_items_meeting_id_idx on sm_cab_agenda_items (org_id, meeting_id) where deleted_at is null;
create index if not exists sm_cab_agenda_items_change_id_idx on sm_cab_agenda_items (org_id, change_id) where deleted_at is null;
create unique index if not exists sm_cab_agenda_items_meeting_id_change_id_kind_uk on sm_cab_agenda_items (org_id, meeting_id, change_id, kind) where deleted_at is null;
drop trigger if exists sm_cab_agenda_items_sync on sm_cab_agenda_items;
create trigger sm_cab_agenda_items_sync before insert or update on sm_cab_agenda_items for each row execute function sm_sync_touch('cab_agenda_item');
alter table sm_cab_agenda_items enable row level security;

-- cab_meeting: جلسه‌های CAB
create table if not exists sm_cab_meetings (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cab_meetings add column if not exists workspace_id uuid;
alter table sm_cab_meetings add column if not exists domain_id uuid;
alter table sm_cab_meetings add column if not exists unit_id uuid;
alter table sm_cab_meetings add column if not exists created_at timestamptz not null default now();
alter table sm_cab_meetings add column if not exists created_by uuid;
alter table sm_cab_meetings add column if not exists updated_at timestamptz not null default now();
alter table sm_cab_meetings add column if not exists updated_by uuid;
alter table sm_cab_meetings add column if not exists rev bigint not null default 0;
alter table sm_cab_meetings add column if not exists version integer not null default 1;
alter table sm_cab_meetings add column if not exists deleted_at timestamptz;
alter table sm_cab_meetings add column if not exists origin text;
alter table sm_cab_meetings add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cab_meetings add column if not exists no integer;
alter table sm_cab_meetings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CABM' || no::text else 'CABM' || lpad(no::text, 5, '0') end) stored;
alter table sm_cab_meetings add column if not exists title text;
alter table sm_cab_meetings add column if not exists cab_id uuid;
alter table sm_cab_meetings add column if not exists starts_at timestamptz;
alter table sm_cab_meetings add column if not exists ends_at timestamptz;
alter table sm_cab_meetings add column if not exists chair_id uuid;
alter table sm_cab_meetings add column if not exists attendees jsonb;
alter table sm_cab_meetings add column if not exists present jsonb;
alter table sm_cab_meetings add column if not exists location text;
alter table sm_cab_meetings add column if not exists conference_url text;
alter table sm_cab_meetings add column if not exists notes text;
alter table sm_cab_meetings add column if not exists minutes text;
alter table sm_cab_meetings add column if not exists action_items text;
alter table sm_cab_meetings add column if not exists minutes_sent_at timestamptz;
alter table sm_cab_meetings add column if not exists state text;
create unique index if not exists sm_cab_meetings_no_uk on sm_cab_meetings (org_id, no);
create index if not exists sm_cab_meetings_rev_idx on sm_cab_meetings (org_id, rev);
create index if not exists sm_cab_meetings_upd_idx on sm_cab_meetings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_meetings_crt_idx on sm_cab_meetings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_meetings_cab_id_idx on sm_cab_meetings (org_id, cab_id) where deleted_at is null;
create index if not exists sm_cab_meetings_starts_at_idx on sm_cab_meetings (org_id, starts_at) where deleted_at is null;
create index if not exists sm_cab_meetings_state_idx on sm_cab_meetings (org_id, state) where deleted_at is null;
create index if not exists sm_cab_meetings_workspace_acc_idx on sm_cab_meetings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cab_meetings_unit_acc_idx on sm_cab_meetings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cab_meetings_domain_acc_idx on sm_cab_meetings (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cab_meetings_chair_id_idx on sm_cab_meetings (org_id, chair_id) where deleted_at is null;
drop trigger if exists sm_cab_meetings_sync on sm_cab_meetings;
create trigger sm_cab_meetings_sync before insert or update on sm_cab_meetings for each row execute function sm_sync_touch('cab_meeting');
alter table sm_cab_meetings enable row level security;

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
alter table sm_catalog_items add column if not exists offering_id uuid;
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
create index if not exists sm_catalog_items_offering_id_idx on sm_catalog_items (org_id, offering_id) where deleted_at is null;
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

-- change_config: تنظیمات تغییر
create table if not exists sm_change_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_configs add column if not exists workspace_id uuid;
alter table sm_change_configs add column if not exists domain_id uuid;
alter table sm_change_configs add column if not exists unit_id uuid;
alter table sm_change_configs add column if not exists created_at timestamptz not null default now();
alter table sm_change_configs add column if not exists created_by uuid;
alter table sm_change_configs add column if not exists updated_at timestamptz not null default now();
alter table sm_change_configs add column if not exists updated_by uuid;
alter table sm_change_configs add column if not exists rev bigint not null default 0;
alter table sm_change_configs add column if not exists version integer not null default 1;
alter table sm_change_configs add column if not exists deleted_at timestamptz;
alter table sm_change_configs add column if not exists origin text;
alter table sm_change_configs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_configs add column if not exists name text;
alter table sm_change_configs add column if not exists config_key text;
alter table sm_change_configs add column if not exists risk_moderate_from integer;
alter table sm_change_configs add column if not exists risk_high_from integer;
alter table sm_change_configs add column if not exists risk_very_high_from integer;
alter table sm_change_configs add column if not exists questionnaire_weight integer;
alter table sm_change_configs add column if not exists lead_days_low integer;
alter table sm_change_configs add column if not exists lead_days_moderate integer;
alter table sm_change_configs add column if not exists lead_days_high integer;
alter table sm_change_configs add column if not exists lead_days_very_high integer;
alter table sm_change_configs add column if not exists reauthorize_on_edit boolean not null default true;
alter table sm_change_configs add column if not exists hold_blocks_cancel boolean not null default true;
alter table sm_change_configs add column if not exists pir_required_for jsonb;
alter table sm_change_configs add column if not exists pir_due_days integer;
alter table sm_change_configs add column if not exists review_auto_close_days integer;
alter table sm_change_configs add column if not exists stale_draft_days integer;
alter table sm_change_configs add column if not exists window_alert_minutes integer;
alter table sm_change_configs add column if not exists success_window_days integer;
alter table sm_change_configs add column if not exists related_ci_conflicts boolean not null default true;
alter table sm_change_configs add column if not exists lockdown_on_major boolean not null default false;
alter table sm_change_configs add column if not exists cab_risks jsonb;
alter table sm_change_configs add column if not exists change_manager_group_id uuid;
alter table sm_change_configs add column if not exists default_cab_id uuid;
alter table sm_change_configs add column if not exists emergency_cab_id uuid;
alter table sm_change_configs add column if not exists seeded integer;
create index if not exists sm_change_configs_rev_idx on sm_change_configs (org_id, rev);
create index if not exists sm_change_configs_upd_idx on sm_change_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_configs_crt_idx on sm_change_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_change_configs_config_key_uk on sm_change_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_change_configs_sync on sm_change_configs;
create trigger sm_change_configs_sync before insert or update on sm_change_configs for each row execute function sm_sync_touch('change_config');
alter table sm_change_configs enable row level security;

-- change_conflict: تداخل‌های تغییر
create table if not exists sm_change_conflicts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_conflicts add column if not exists workspace_id uuid;
alter table sm_change_conflicts add column if not exists domain_id uuid;
alter table sm_change_conflicts add column if not exists unit_id uuid;
alter table sm_change_conflicts add column if not exists created_at timestamptz not null default now();
alter table sm_change_conflicts add column if not exists created_by uuid;
alter table sm_change_conflicts add column if not exists updated_at timestamptz not null default now();
alter table sm_change_conflicts add column if not exists updated_by uuid;
alter table sm_change_conflicts add column if not exists rev bigint not null default 0;
alter table sm_change_conflicts add column if not exists version integer not null default 1;
alter table sm_change_conflicts add column if not exists deleted_at timestamptz;
alter table sm_change_conflicts add column if not exists origin text;
alter table sm_change_conflicts add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_conflicts add column if not exists summary text;
alter table sm_change_conflicts add column if not exists change_id uuid;
alter table sm_change_conflicts add column if not exists kind text;
alter table sm_change_conflicts add column if not exists status text;
alter table sm_change_conflicts add column if not exists justification text;
alter table sm_change_conflicts add column if not exists other_change_id uuid;
alter table sm_change_conflicts add column if not exists window_id uuid;
alter table sm_change_conflicts add column if not exists lockdown_id uuid;
alter table sm_change_conflicts add column if not exists ci_id uuid;
alter table sm_change_conflicts add column if not exists service_id uuid;
alter table sm_change_conflicts add column if not exists overlap_start timestamptz;
alter table sm_change_conflicts add column if not exists overlap_end timestamptz;
alter table sm_change_conflicts add column if not exists active boolean not null default true;
alter table sm_change_conflicts add column if not exists key text;
alter table sm_change_conflicts add column if not exists detected_at timestamptz;
alter table sm_change_conflicts add column if not exists assignment_group_id uuid;
alter table sm_change_conflicts add column if not exists assigned_to uuid;
alter table sm_change_conflicts add column if not exists change_owner_id uuid;
create index if not exists sm_change_conflicts_rev_idx on sm_change_conflicts (org_id, rev);
create index if not exists sm_change_conflicts_upd_idx on sm_change_conflicts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_conflicts_crt_idx on sm_change_conflicts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_conflicts_change_id_idx on sm_change_conflicts (org_id, change_id) where deleted_at is null;
create index if not exists sm_change_conflicts_other_change_id_idx on sm_change_conflicts (org_id, other_change_id) where deleted_at is null;
create unique index if not exists sm_change_conflicts_change_id_key_uk on sm_change_conflicts (org_id, change_id, key) where deleted_at is null;
create index if not exists sm_change_conflicts_workspace_acc_idx on sm_change_conflicts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_conflicts_unit_acc_idx on sm_change_conflicts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_conflicts_domain_acc_idx on sm_change_conflicts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_conflicts_change_owner_id_idx on sm_change_conflicts (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_conflicts_assigned_to_idx on sm_change_conflicts (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_change_conflicts_sync on sm_change_conflicts;
create trigger sm_change_conflicts_sync before insert or update on sm_change_conflicts for each row execute function sm_sync_touch('change_conflict');
alter table sm_change_conflicts enable row level security;

-- change_lockdown: قرنطینه‌های تغییرات
create table if not exists sm_change_lockdowns (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_lockdowns add column if not exists workspace_id uuid;
alter table sm_change_lockdowns add column if not exists domain_id uuid;
alter table sm_change_lockdowns add column if not exists unit_id uuid;
alter table sm_change_lockdowns add column if not exists created_at timestamptz not null default now();
alter table sm_change_lockdowns add column if not exists created_by uuid;
alter table sm_change_lockdowns add column if not exists updated_at timestamptz not null default now();
alter table sm_change_lockdowns add column if not exists updated_by uuid;
alter table sm_change_lockdowns add column if not exists rev bigint not null default 0;
alter table sm_change_lockdowns add column if not exists version integer not null default 1;
alter table sm_change_lockdowns add column if not exists deleted_at timestamptz;
alter table sm_change_lockdowns add column if not exists origin text;
alter table sm_change_lockdowns add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_lockdowns add column if not exists no integer;
alter table sm_change_lockdowns add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'LCK' || no::text else 'LCK' || lpad(no::text, 4, '0') end) stored;
alter table sm_change_lockdowns add column if not exists title text;
alter table sm_change_lockdowns add column if not exists starts_at timestamptz;
alter table sm_change_lockdowns add column if not exists ends_at timestamptz;
alter table sm_change_lockdowns add column if not exists hold_in_flight boolean not null default true;
alter table sm_change_lockdowns add column if not exists incident_id uuid;
alter table sm_change_lockdowns add column if not exists services jsonb;
alter table sm_change_lockdowns add column if not exists cis jsonb;
alter table sm_change_lockdowns add column if not exists scope_condition jsonb;
alter table sm_change_lockdowns add column if not exists reason text;
alter table sm_change_lockdowns add column if not exists released_at timestamptz;
alter table sm_change_lockdowns add column if not exists released_by uuid;
alter table sm_change_lockdowns add column if not exists held_count integer;
alter table sm_change_lockdowns add column if not exists applied_at timestamptz;
alter table sm_change_lockdowns add column if not exists state text;
create unique index if not exists sm_change_lockdowns_no_uk on sm_change_lockdowns (org_id, no);
create index if not exists sm_change_lockdowns_rev_idx on sm_change_lockdowns (org_id, rev);
create index if not exists sm_change_lockdowns_upd_idx on sm_change_lockdowns (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_lockdowns_crt_idx on sm_change_lockdowns (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_lockdowns_state_idx on sm_change_lockdowns (org_id, state) where deleted_at is null;
drop trigger if exists sm_change_lockdowns_sync on sm_change_lockdowns;
create trigger sm_change_lockdowns_sync before insert or update on sm_change_lockdowns for each row execute function sm_sync_touch('change_lockdown');
alter table sm_change_lockdowns enable row level security;

-- change_model: مدل‌های تغییر
create table if not exists sm_change_models (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_models add column if not exists workspace_id uuid;
alter table sm_change_models add column if not exists domain_id uuid;
alter table sm_change_models add column if not exists unit_id uuid;
alter table sm_change_models add column if not exists created_at timestamptz not null default now();
alter table sm_change_models add column if not exists created_by uuid;
alter table sm_change_models add column if not exists updated_at timestamptz not null default now();
alter table sm_change_models add column if not exists updated_by uuid;
alter table sm_change_models add column if not exists rev bigint not null default 0;
alter table sm_change_models add column if not exists version integer not null default 1;
alter table sm_change_models add column if not exists deleted_at timestamptz;
alter table sm_change_models add column if not exists origin text;
alter table sm_change_models add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_models add column if not exists name text;
alter table sm_change_models add column if not exists type text;
alter table sm_change_models add column if not exists is_default boolean not null default false;
alter table sm_change_models add column if not exists active boolean not null default true;
alter table sm_change_models add column if not exists sort_order integer;
alter table sm_change_models add column if not exists states jsonb;
alter table sm_change_models add column if not exists docs_deferred boolean not null default false;
alter table sm_change_models add column if not exists lead_time_exempt boolean not null default false;
alter table sm_change_models add column if not exists cab_policy text;
alter table sm_change_models add column if not exists pir_policy text;
alter table sm_change_models add column if not exists requirements jsonb;
alter table sm_change_models add column if not exists locks jsonb;
alter table sm_change_models add column if not exists description text;
alter table sm_change_models add column if not exists revision integer;
create index if not exists sm_change_models_rev_idx on sm_change_models (org_id, rev);
create index if not exists sm_change_models_upd_idx on sm_change_models (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_models_crt_idx on sm_change_models (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_change_models_name_uk on sm_change_models (org_id, name) where deleted_at is null;
drop trigger if exists sm_change_models_sync on sm_change_models;
create trigger sm_change_models_sync before insert or update on sm_change_models for each row execute function sm_sync_touch('change_model');
alter table sm_change_models enable row level security;

-- change_outage: قطعی‌های برنامه‌ریزی‌شده
create table if not exists sm_change_outages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_outages add column if not exists workspace_id uuid;
alter table sm_change_outages add column if not exists domain_id uuid;
alter table sm_change_outages add column if not exists unit_id uuid;
alter table sm_change_outages add column if not exists created_at timestamptz not null default now();
alter table sm_change_outages add column if not exists created_by uuid;
alter table sm_change_outages add column if not exists updated_at timestamptz not null default now();
alter table sm_change_outages add column if not exists updated_by uuid;
alter table sm_change_outages add column if not exists rev bigint not null default 0;
alter table sm_change_outages add column if not exists version integer not null default 1;
alter table sm_change_outages add column if not exists deleted_at timestamptz;
alter table sm_change_outages add column if not exists origin text;
alter table sm_change_outages add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_outages add column if not exists title text;
alter table sm_change_outages add column if not exists outage_type text;
alter table sm_change_outages add column if not exists change_id uuid;
alter table sm_change_outages add column if not exists service_id uuid;
alter table sm_change_outages add column if not exists ci_id uuid;
alter table sm_change_outages add column if not exists starts_at timestamptz;
alter table sm_change_outages add column if not exists ends_at timestamptz;
alter table sm_change_outages add column if not exists announce boolean not null default true;
alter table sm_change_outages add column if not exists description text;
create index if not exists sm_change_outages_rev_idx on sm_change_outages (org_id, rev);
create index if not exists sm_change_outages_upd_idx on sm_change_outages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_outages_crt_idx on sm_change_outages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_outages_change_id_idx on sm_change_outages (org_id, change_id) where deleted_at is null;
drop trigger if exists sm_change_outages_sync on sm_change_outages;
create trigger sm_change_outages_sync before insert or update on sm_change_outages for each row execute function sm_sync_touch('change_outage');
alter table sm_change_outages enable row level security;

-- change_pir: بازبینی‌های پس از اجرا
create table if not exists sm_change_pirs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_pirs add column if not exists workspace_id uuid;
alter table sm_change_pirs add column if not exists domain_id uuid;
alter table sm_change_pirs add column if not exists unit_id uuid;
alter table sm_change_pirs add column if not exists created_at timestamptz not null default now();
alter table sm_change_pirs add column if not exists created_by uuid;
alter table sm_change_pirs add column if not exists updated_at timestamptz not null default now();
alter table sm_change_pirs add column if not exists updated_by uuid;
alter table sm_change_pirs add column if not exists rev bigint not null default 0;
alter table sm_change_pirs add column if not exists version integer not null default 1;
alter table sm_change_pirs add column if not exists deleted_at timestamptz;
alter table sm_change_pirs add column if not exists origin text;
alter table sm_change_pirs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_pirs add column if not exists no integer;
alter table sm_change_pirs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CPIR' || no::text else 'CPIR' || lpad(no::text, 5, '0') end) stored;
alter table sm_change_pirs add column if not exists title text;
alter table sm_change_pirs add column if not exists change_id uuid;
alter table sm_change_pirs add column if not exists reason text;
alter table sm_change_pirs add column if not exists owner_id uuid;
alter table sm_change_pirs add column if not exists assignment_group_id uuid;
alter table sm_change_pirs add column if not exists due_at timestamptz;
alter table sm_change_pirs add column if not exists completed_at timestamptz;
alter table sm_change_pirs add column if not exists objectives_met text;
alter table sm_change_pirs add column if not exists plan_accuracy integer;
alter table sm_change_pirs add column if not exists incidents_caused integer;
alter table sm_change_pirs add column if not exists side_effects text;
alter table sm_change_pirs add column if not exists timeline_md text;
alter table sm_change_pirs add column if not exists went_well text;
alter table sm_change_pirs add column if not exists went_wrong text;
alter table sm_change_pirs add column if not exists lessons text;
alter table sm_change_pirs add column if not exists follow_up text;
alter table sm_change_pirs add column if not exists watch_list jsonb;
alter table sm_change_pirs add column if not exists confidential boolean not null default false;
alter table sm_change_pirs add column if not exists access_list jsonb;
alter table sm_change_pirs add column if not exists state text;
create unique index if not exists sm_change_pirs_no_uk on sm_change_pirs (org_id, no);
create index if not exists sm_change_pirs_rev_idx on sm_change_pirs (org_id, rev);
create index if not exists sm_change_pirs_upd_idx on sm_change_pirs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_pirs_crt_idx on sm_change_pirs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_pirs_change_id_idx on sm_change_pirs (org_id, change_id) where deleted_at is null;
create index if not exists sm_change_pirs_owner_id_idx on sm_change_pirs (org_id, owner_id) where deleted_at is null;
create index if not exists sm_change_pirs_assignment_group_id_idx on sm_change_pirs (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_pirs_state_idx on sm_change_pirs (org_id, state) where deleted_at is null;
create index if not exists sm_change_pirs_workspace_acc_idx on sm_change_pirs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_pirs_unit_acc_idx on sm_change_pirs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_pirs_domain_acc_idx on sm_change_pirs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_change_pirs_sync on sm_change_pirs;
create trigger sm_change_pirs_sync before insert or update on sm_change_pirs for each row execute function sm_sync_touch('change_pir');
alter table sm_change_pirs enable row level security;

-- change_request: تغییرها
create table if not exists sm_change_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_requests add column if not exists workspace_id uuid;
alter table sm_change_requests add column if not exists domain_id uuid;
alter table sm_change_requests add column if not exists unit_id uuid;
alter table sm_change_requests add column if not exists created_at timestamptz not null default now();
alter table sm_change_requests add column if not exists created_by uuid;
alter table sm_change_requests add column if not exists updated_at timestamptz not null default now();
alter table sm_change_requests add column if not exists updated_by uuid;
alter table sm_change_requests add column if not exists rev bigint not null default 0;
alter table sm_change_requests add column if not exists version integer not null default 1;
alter table sm_change_requests add column if not exists deleted_at timestamptz;
alter table sm_change_requests add column if not exists origin text;
alter table sm_change_requests add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_requests add column if not exists no integer;
alter table sm_change_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CHG' || no::text else 'CHG' || lpad(no::text, 7, '0') end) stored;
alter table sm_change_requests add column if not exists short_description text;
alter table sm_change_requests add column if not exists description text;
alter table sm_change_requests add column if not exists state text;
alter table sm_change_requests add column if not exists priority text;
alter table sm_change_requests add column if not exists impact text;
alter table sm_change_requests add column if not exists urgency text;
alter table sm_change_requests add column if not exists category text;
alter table sm_change_requests add column if not exists subcategory text;
alter table sm_change_requests add column if not exists channel text;
alter table sm_change_requests add column if not exists caller_id uuid;
alter table sm_change_requests add column if not exists requested_for uuid;
alter table sm_change_requests add column if not exists opened_by uuid;
alter table sm_change_requests add column if not exists opened_at timestamptz;
alter table sm_change_requests add column if not exists assignment_group_id uuid;
alter table sm_change_requests add column if not exists assigned_to uuid;
alter table sm_change_requests add column if not exists service_id uuid;
alter table sm_change_requests add column if not exists offering_id uuid;
alter table sm_change_requests add column if not exists ci_id uuid;
alter table sm_change_requests add column if not exists location_id uuid;
alter table sm_change_requests add column if not exists due_at timestamptz;
alter table sm_change_requests add column if not exists resolved_at timestamptz;
alter table sm_change_requests add column if not exists resolved_by uuid;
alter table sm_change_requests add column if not exists closed_at timestamptz;
alter table sm_change_requests add column if not exists closed_by uuid;
alter table sm_change_requests add column if not exists close_code text;
alter table sm_change_requests add column if not exists close_notes text;
alter table sm_change_requests add column if not exists parent_id uuid;
alter table sm_change_requests add column if not exists watch_list jsonb;
alter table sm_change_requests add column if not exists approval text;
alter table sm_change_requests add column if not exists escalation integer;
alter table sm_change_requests add column if not exists reassignment_count integer;
alter table sm_change_requests add column if not exists reopen_count integer;
alter table sm_change_requests add column if not exists time_worked bigint;
alter table sm_change_requests add column if not exists first_response_at timestamptz;
alter table sm_change_requests add column if not exists active boolean not null default true;
alter table sm_change_requests add column if not exists sla_due timestamptz;
alter table sm_change_requests add column if not exists knowledge boolean not null default false;
alter table sm_change_requests add column if not exists type text;
alter table sm_change_requests add column if not exists model_id uuid;
alter table sm_change_requests add column if not exists template_id uuid;
alter table sm_change_requests add column if not exists justification text;
alter table sm_change_requests add column if not exists expected_outcome text;
alter table sm_change_requests add column if not exists status_reason text;
alter table sm_change_requests add column if not exists change_owner_id uuid;
alter table sm_change_requests add column if not exists change_manager_id uuid;
alter table sm_change_requests add column if not exists stakeholders jsonb;
alter table sm_change_requests add column if not exists external_ref text;
alter table sm_change_requests add column if not exists on_hold boolean not null default false;
alter table sm_change_requests add column if not exists on_hold_reason text;
alter table sm_change_requests add column if not exists on_hold_since timestamptz;
alter table sm_change_requests add column if not exists affected_cis jsonb;
alter table sm_change_requests add column if not exists affected_services jsonb;
alter table sm_change_requests add column if not exists impacted_services jsonb;
alter table sm_change_requests add column if not exists outage_expected boolean not null default false;
alter table sm_change_requests add column if not exists outage_minutes integer;
alter table sm_change_requests add column if not exists planned_start timestamptz;
alter table sm_change_requests add column if not exists planned_end timestamptz;
alter table sm_change_requests add column if not exists maintenance_window_id uuid;
alter table sm_change_requests add column if not exists actual_start timestamptz;
alter table sm_change_requests add column if not exists actual_end timestamptz;
alter table sm_change_requests add column if not exists duration_actual bigint;
alter table sm_change_requests add column if not exists is_late boolean not null default false;
alter table sm_change_requests add column if not exists lead_days integer;
alter table sm_change_requests add column if not exists in_blackout boolean not null default false;
alter table sm_change_requests add column if not exists outside_window boolean not null default false;
alter table sm_change_requests add column if not exists blackout_override_reason text;
alter table sm_change_requests add column if not exists conflict_status text;
alter table sm_change_requests add column if not exists conflict_count integer;
alter table sm_change_requests add column if not exists conflict_checked_at timestamptz;
alter table sm_change_requests add column if not exists exclude_conflicts boolean not null default false;
alter table sm_change_requests add column if not exists lockdown_id uuid;
alter table sm_change_requests add column if not exists window_alerted_at timestamptz;
alter table sm_change_requests add column if not exists overrun_alerted_at timestamptz;
alter table sm_change_requests add column if not exists implementation_plan text;
alter table sm_change_requests add column if not exists test_plan text;
alter table sm_change_requests add column if not exists test_results text;
alter table sm_change_requests add column if not exists backout_plan text;
alter table sm_change_requests add column if not exists backout_tested boolean not null default false;
alter table sm_change_requests add column if not exists communication_plan text;
alter table sm_change_requests add column if not exists planned_effort numeric;
alter table sm_change_requests add column if not exists planned_cost numeric;
alter table sm_change_requests add column if not exists risk text;
alter table sm_change_requests add column if not exists risk_score integer;
alter table sm_change_requests add column if not exists risk_calculated text;
alter table sm_change_requests add column if not exists risk_source text;
alter table sm_change_requests add column if not exists risk_override_reason text;
alter table sm_change_requests add column if not exists risk_answers jsonb;
alter table sm_change_requests add column if not exists risk_factors jsonb;
alter table sm_change_requests add column if not exists risk_explanation text;
alter table sm_change_requests add column if not exists risk_assessed_at timestamptz;
alter table sm_change_requests add column if not exists cab_required boolean not null default false;
alter table sm_change_requests add column if not exists cab_id uuid;
alter table sm_change_requests add column if not exists cab_meeting_id uuid;
alter table sm_change_requests add column if not exists cab_recommendation text;
alter table sm_change_requests add column if not exists submitted_at timestamptz;
alter table sm_change_requests add column if not exists auth_cycle_at timestamptz;
alter table sm_change_requests add column if not exists authorized_at timestamptz;
alter table sm_change_requests add column if not exists requester_confirmed boolean not null default false;
alter table sm_change_requests add column if not exists implementation_rating integer;
alter table sm_change_requests add column if not exists lessons text;
alter table sm_change_requests add column if not exists pir_required boolean not null default false;
alter table sm_change_requests add column if not exists pir_id uuid;
alter table sm_change_requests add column if not exists incidents_caused integer;
alter table sm_change_requests add column if not exists retrospective boolean not null default false;
alter table sm_change_requests add column if not exists discovered_by text;
alter table sm_change_requests add column if not exists origin_table text;
alter table sm_change_requests add column if not exists origin_id text;
alter table sm_change_requests add column if not exists model_states jsonb;
alter table sm_change_requests add column if not exists confidential boolean not null default false;
alter table sm_change_requests add column if not exists access_list jsonb;
create unique index if not exists sm_change_requests_no_uk on sm_change_requests (org_id, no);
create index if not exists sm_change_requests_rev_idx on sm_change_requests (org_id, rev);
create index if not exists sm_change_requests_upd_idx on sm_change_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_requests_crt_idx on sm_change_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_requests_state_idx on sm_change_requests (org_id, state) where deleted_at is null;
create index if not exists sm_change_requests_assignment_group_id_idx on sm_change_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_requests_assigned_to_idx on sm_change_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_requests_parent_id_idx on sm_change_requests (org_id, parent_id) where deleted_at is null;
create index if not exists sm_change_requests_type_idx on sm_change_requests (org_id, type) where deleted_at is null;
create index if not exists sm_change_requests_change_owner_id_idx on sm_change_requests (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_requests_change_manager_id_idx on sm_change_requests (org_id, change_manager_id) where deleted_at is null;
create index if not exists sm_change_requests_planned_start_idx on sm_change_requests (org_id, planned_start) where deleted_at is null;
create index if not exists sm_change_requests_planned_end_idx on sm_change_requests (org_id, planned_end) where deleted_at is null;
create index if not exists sm_change_requests_risk_idx on sm_change_requests (org_id, risk) where deleted_at is null;
create index if not exists sm_change_requests_workspace_acc_idx on sm_change_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_requests_unit_acc_idx on sm_change_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_requests_domain_acc_idx on sm_change_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_requests_caller_id_idx on sm_change_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_change_requests_requested_for_idx on sm_change_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_change_requests_opened_by_idx on sm_change_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_change_requests_watch_list_gin on sm_change_requests using gin (watch_list);
drop trigger if exists sm_change_requests_sync on sm_change_requests;
create trigger sm_change_requests_sync before insert or update on sm_change_requests for each row execute function sm_sync_touch('change_request');
alter table sm_change_requests enable row level security;

-- change_risk_question: پرسش‌های ارزیابی ریسک
create table if not exists sm_change_risk_questions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_risk_questions add column if not exists workspace_id uuid;
alter table sm_change_risk_questions add column if not exists domain_id uuid;
alter table sm_change_risk_questions add column if not exists unit_id uuid;
alter table sm_change_risk_questions add column if not exists created_at timestamptz not null default now();
alter table sm_change_risk_questions add column if not exists created_by uuid;
alter table sm_change_risk_questions add column if not exists updated_at timestamptz not null default now();
alter table sm_change_risk_questions add column if not exists updated_by uuid;
alter table sm_change_risk_questions add column if not exists rev bigint not null default 0;
alter table sm_change_risk_questions add column if not exists version integer not null default 1;
alter table sm_change_risk_questions add column if not exists deleted_at timestamptz;
alter table sm_change_risk_questions add column if not exists origin text;
alter table sm_change_risk_questions add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_risk_questions add column if not exists question text;
alter table sm_change_risk_questions add column if not exists kind text;
alter table sm_change_risk_questions add column if not exists weight integer;
alter table sm_change_risk_questions add column if not exists sort_order integer;
alter table sm_change_risk_questions add column if not exists options jsonb;
alter table sm_change_risk_questions add column if not exists change_types jsonb;
alter table sm_change_risk_questions add column if not exists condition jsonb;
alter table sm_change_risk_questions add column if not exists mandatory boolean not null default true;
alter table sm_change_risk_questions add column if not exists active boolean not null default true;
alter table sm_change_risk_questions add column if not exists help text;
create index if not exists sm_change_risk_questions_rev_idx on sm_change_risk_questions (org_id, rev);
create index if not exists sm_change_risk_questions_upd_idx on sm_change_risk_questions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_risk_questions_crt_idx on sm_change_risk_questions (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_change_risk_questions_sync on sm_change_risk_questions;
create trigger sm_change_risk_questions_sync before insert or update on sm_change_risk_questions for each row execute function sm_sync_touch('change_risk_question');
alter table sm_change_risk_questions enable row level security;

-- change_success_score: امتیازهای موفقیت تیم‌ها
create table if not exists sm_change_success_scores (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_success_scores add column if not exists workspace_id uuid;
alter table sm_change_success_scores add column if not exists domain_id uuid;
alter table sm_change_success_scores add column if not exists unit_id uuid;
alter table sm_change_success_scores add column if not exists created_at timestamptz not null default now();
alter table sm_change_success_scores add column if not exists created_by uuid;
alter table sm_change_success_scores add column if not exists updated_at timestamptz not null default now();
alter table sm_change_success_scores add column if not exists updated_by uuid;
alter table sm_change_success_scores add column if not exists rev bigint not null default 0;
alter table sm_change_success_scores add column if not exists version integer not null default 1;
alter table sm_change_success_scores add column if not exists deleted_at timestamptz;
alter table sm_change_success_scores add column if not exists origin text;
alter table sm_change_success_scores add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_success_scores add column if not exists title text;
alter table sm_change_success_scores add column if not exists group_id uuid;
alter table sm_change_success_scores add column if not exists score integer;
alter table sm_change_success_scores add column if not exists band text;
alter table sm_change_success_scores add column if not exists implemented integer;
alter table sm_change_success_scores add column if not exists successful integer;
alter table sm_change_success_scores add column if not exists with_issues integer;
alter table sm_change_success_scores add column if not exists failed integer;
alter table sm_change_success_scores add column if not exists caused_incidents integer;
alter table sm_change_success_scores add column if not exists emergency integer;
alter table sm_change_success_scores add column if not exists computed_at timestamptz;
create index if not exists sm_change_success_scores_rev_idx on sm_change_success_scores (org_id, rev);
create index if not exists sm_change_success_scores_upd_idx on sm_change_success_scores (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_success_scores_crt_idx on sm_change_success_scores (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_change_success_scores_group_id_uk on sm_change_success_scores (org_id, group_id) where deleted_at is null;
drop trigger if exists sm_change_success_scores_sync on sm_change_success_scores;
create trigger sm_change_success_scores_sync before insert or update on sm_change_success_scores for each row execute function sm_sync_touch('change_success_score');
alter table sm_change_success_scores enable row level security;

-- change_task: کارهای تغییر
create table if not exists sm_change_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_tasks add column if not exists workspace_id uuid;
alter table sm_change_tasks add column if not exists domain_id uuid;
alter table sm_change_tasks add column if not exists unit_id uuid;
alter table sm_change_tasks add column if not exists created_at timestamptz not null default now();
alter table sm_change_tasks add column if not exists created_by uuid;
alter table sm_change_tasks add column if not exists updated_at timestamptz not null default now();
alter table sm_change_tasks add column if not exists updated_by uuid;
alter table sm_change_tasks add column if not exists rev bigint not null default 0;
alter table sm_change_tasks add column if not exists version integer not null default 1;
alter table sm_change_tasks add column if not exists deleted_at timestamptz;
alter table sm_change_tasks add column if not exists origin text;
alter table sm_change_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_tasks add column if not exists no integer;
alter table sm_change_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CTASK' || no::text else 'CTASK' || lpad(no::text, 7, '0') end) stored;
alter table sm_change_tasks add column if not exists short_description text;
alter table sm_change_tasks add column if not exists description text;
alter table sm_change_tasks add column if not exists state text;
alter table sm_change_tasks add column if not exists priority text;
alter table sm_change_tasks add column if not exists impact text;
alter table sm_change_tasks add column if not exists urgency text;
alter table sm_change_tasks add column if not exists category text;
alter table sm_change_tasks add column if not exists subcategory text;
alter table sm_change_tasks add column if not exists channel text;
alter table sm_change_tasks add column if not exists caller_id uuid;
alter table sm_change_tasks add column if not exists requested_for uuid;
alter table sm_change_tasks add column if not exists opened_by uuid;
alter table sm_change_tasks add column if not exists opened_at timestamptz;
alter table sm_change_tasks add column if not exists assignment_group_id uuid;
alter table sm_change_tasks add column if not exists assigned_to uuid;
alter table sm_change_tasks add column if not exists service_id uuid;
alter table sm_change_tasks add column if not exists offering_id uuid;
alter table sm_change_tasks add column if not exists ci_id uuid;
alter table sm_change_tasks add column if not exists location_id uuid;
alter table sm_change_tasks add column if not exists due_at timestamptz;
alter table sm_change_tasks add column if not exists resolved_at timestamptz;
alter table sm_change_tasks add column if not exists resolved_by uuid;
alter table sm_change_tasks add column if not exists closed_at timestamptz;
alter table sm_change_tasks add column if not exists closed_by uuid;
alter table sm_change_tasks add column if not exists close_code text;
alter table sm_change_tasks add column if not exists close_notes text;
alter table sm_change_tasks add column if not exists parent_id uuid;
alter table sm_change_tasks add column if not exists watch_list jsonb;
alter table sm_change_tasks add column if not exists approval text;
alter table sm_change_tasks add column if not exists escalation integer;
alter table sm_change_tasks add column if not exists reassignment_count integer;
alter table sm_change_tasks add column if not exists reopen_count integer;
alter table sm_change_tasks add column if not exists time_worked bigint;
alter table sm_change_tasks add column if not exists first_response_at timestamptz;
alter table sm_change_tasks add column if not exists active boolean not null default true;
alter table sm_change_tasks add column if not exists sla_due timestamptz;
alter table sm_change_tasks add column if not exists knowledge boolean not null default false;
alter table sm_change_tasks add column if not exists change_id uuid;
alter table sm_change_tasks add column if not exists task_type text;
alter table sm_change_tasks add column if not exists mandatory boolean not null default true;
alter table sm_change_tasks add column if not exists sort_order integer;
alter table sm_change_tasks add column if not exists depends_on jsonb;
alter table sm_change_tasks add column if not exists planned_start timestamptz;
alter table sm_change_tasks add column if not exists planned_end timestamptz;
alter table sm_change_tasks add column if not exists actual_start timestamptz;
alter table sm_change_tasks add column if not exists actual_end timestamptz;
alter table sm_change_tasks add column if not exists checklist text;
alter table sm_change_tasks add column if not exists change_owner_id uuid;
alter table sm_change_tasks add column if not exists confidential boolean not null default false;
alter table sm_change_tasks add column if not exists access_list jsonb;
create unique index if not exists sm_change_tasks_no_uk on sm_change_tasks (org_id, no);
create index if not exists sm_change_tasks_rev_idx on sm_change_tasks (org_id, rev);
create index if not exists sm_change_tasks_upd_idx on sm_change_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_tasks_crt_idx on sm_change_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_tasks_state_idx on sm_change_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_change_tasks_assignment_group_id_idx on sm_change_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_change_tasks_assigned_to_idx on sm_change_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_change_tasks_change_id_idx on sm_change_tasks (org_id, change_id) where deleted_at is null;
create index if not exists sm_change_tasks_workspace_acc_idx on sm_change_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_tasks_unit_acc_idx on sm_change_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_tasks_domain_acc_idx on sm_change_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_tasks_caller_id_idx on sm_change_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_change_tasks_requested_for_idx on sm_change_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_change_tasks_opened_by_idx on sm_change_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_change_tasks_change_owner_id_idx on sm_change_tasks (org_id, change_owner_id) where deleted_at is null;
create index if not exists sm_change_tasks_watch_list_gin on sm_change_tasks using gin (watch_list);
drop trigger if exists sm_change_tasks_sync on sm_change_tasks;
create trigger sm_change_tasks_sync before insert or update on sm_change_tasks for each row execute function sm_sync_touch('change_task');
alter table sm_change_tasks enable row level security;

-- change_template: الگوها و تغییرهای استاندارد
create table if not exists sm_change_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_templates add column if not exists workspace_id uuid;
alter table sm_change_templates add column if not exists domain_id uuid;
alter table sm_change_templates add column if not exists unit_id uuid;
alter table sm_change_templates add column if not exists created_at timestamptz not null default now();
alter table sm_change_templates add column if not exists created_by uuid;
alter table sm_change_templates add column if not exists updated_at timestamptz not null default now();
alter table sm_change_templates add column if not exists updated_by uuid;
alter table sm_change_templates add column if not exists rev bigint not null default 0;
alter table sm_change_templates add column if not exists version integer not null default 1;
alter table sm_change_templates add column if not exists deleted_at timestamptz;
alter table sm_change_templates add column if not exists origin text;
alter table sm_change_templates add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_templates add column if not exists no integer;
alter table sm_change_templates add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CHGT' || no::text else 'CHGT' || lpad(no::text, 5, '0') end) stored;
alter table sm_change_templates add column if not exists name text;
alter table sm_change_templates add column if not exists kind text;
alter table sm_change_templates add column if not exists category text;
alter table sm_change_templates add column if not exists model_id uuid;
alter table sm_change_templates add column if not exists owner_id uuid;
alter table sm_change_templates add column if not exists authoring_group_id uuid;
alter table sm_change_templates add column if not exists review_date date;
alter table sm_change_templates add column if not exists max_duration bigint;
alter table sm_change_templates add column if not exists short_description text;
alter table sm_change_templates add column if not exists description text;
alter table sm_change_templates add column if not exists justification text;
alter table sm_change_templates add column if not exists implementation_plan text;
alter table sm_change_templates add column if not exists test_plan text;
alter table sm_change_templates add column if not exists backout_plan text;
alter table sm_change_templates add column if not exists communication_plan text;
alter table sm_change_templates add column if not exists risk text;
alter table sm_change_templates add column if not exists impact text;
alter table sm_change_templates add column if not exists assignment_group_id uuid;
alter table sm_change_templates add column if not exists service_id uuid;
alter table sm_change_templates add column if not exists services jsonb;
alter table sm_change_templates add column if not exists ci_classes jsonb;
alter table sm_change_templates add column if not exists tasks jsonb;
alter table sm_change_templates add column if not exists usage_count integer;
alter table sm_change_templates add column if not exists success_count integer;
alter table sm_change_templates add column if not exists failure_count integer;
alter table sm_change_templates add column if not exists last_used_at timestamptz;
alter table sm_change_templates add column if not exists revision integer;
alter table sm_change_templates add column if not exists published_at timestamptz;
alter table sm_change_templates add column if not exists published_by uuid;
alter table sm_change_templates add column if not exists approval text;
alter table sm_change_templates add column if not exists state text;
create unique index if not exists sm_change_templates_no_uk on sm_change_templates (org_id, no);
create index if not exists sm_change_templates_rev_idx on sm_change_templates (org_id, rev);
create index if not exists sm_change_templates_upd_idx on sm_change_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_templates_crt_idx on sm_change_templates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_templates_state_idx on sm_change_templates (org_id, state) where deleted_at is null;
create index if not exists sm_change_templates_workspace_acc_idx on sm_change_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_templates_unit_acc_idx on sm_change_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_templates_domain_acc_idx on sm_change_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_change_templates_owner_id_idx on sm_change_templates (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_change_templates_sync on sm_change_templates;
create trigger sm_change_templates_sync before insert or update on sm_change_templates for each row execute function sm_sync_touch('change_template');
alter table sm_change_templates enable row level security;

-- change_window: پنجره‌های زمانی
create table if not exists sm_change_windows (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_change_windows add column if not exists workspace_id uuid;
alter table sm_change_windows add column if not exists domain_id uuid;
alter table sm_change_windows add column if not exists unit_id uuid;
alter table sm_change_windows add column if not exists created_at timestamptz not null default now();
alter table sm_change_windows add column if not exists created_by uuid;
alter table sm_change_windows add column if not exists updated_at timestamptz not null default now();
alter table sm_change_windows add column if not exists updated_by uuid;
alter table sm_change_windows add column if not exists rev bigint not null default 0;
alter table sm_change_windows add column if not exists version integer not null default 1;
alter table sm_change_windows add column if not exists deleted_at timestamptz;
alter table sm_change_windows add column if not exists origin text;
alter table sm_change_windows add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_change_windows add column if not exists no integer;
alter table sm_change_windows add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'WIN' || no::text else 'WIN' || lpad(no::text, 4, '0') end) stored;
alter table sm_change_windows add column if not exists name text;
alter table sm_change_windows add column if not exists kind text;
alter table sm_change_windows add column if not exists active boolean not null default true;
alter table sm_change_windows add column if not exists start_at timestamptz;
alter table sm_change_windows add column if not exists end_at timestamptz;
alter table sm_change_windows add column if not exists enforcement text;
alter table sm_change_windows add column if not exists recurrence text;
alter table sm_change_windows add column if not exists weekdays jsonb;
alter table sm_change_windows add column if not exists until date;
alter table sm_change_windows add column if not exists exempt_emergency boolean not null default true;
alter table sm_change_windows add column if not exists change_types jsonb;
alter table sm_change_windows add column if not exists services jsonb;
alter table sm_change_windows add column if not exists cis jsonb;
alter table sm_change_windows add column if not exists scope_condition jsonb;
alter table sm_change_windows add column if not exists owner_group_id uuid;
alter table sm_change_windows add column if not exists source text;
alter table sm_change_windows add column if not exists description text;
create unique index if not exists sm_change_windows_no_uk on sm_change_windows (org_id, no);
create index if not exists sm_change_windows_rev_idx on sm_change_windows (org_id, rev);
create index if not exists sm_change_windows_upd_idx on sm_change_windows (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_windows_crt_idx on sm_change_windows (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_change_windows_workspace_acc_idx on sm_change_windows (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_change_windows_unit_acc_idx on sm_change_windows (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_change_windows_domain_acc_idx on sm_change_windows (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_change_windows_sync on sm_change_windows;
create trigger sm_change_windows_sync before insert or update on sm_change_windows for each row execute function sm_sync_touch('change_window');
alter table sm_change_windows enable row level security;

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

-- ci: پیکربندی‌ها
create table if not exists sm_cis (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cis add column if not exists workspace_id uuid;
alter table sm_cis add column if not exists domain_id uuid;
alter table sm_cis add column if not exists unit_id uuid;
alter table sm_cis add column if not exists created_at timestamptz not null default now();
alter table sm_cis add column if not exists created_by uuid;
alter table sm_cis add column if not exists updated_at timestamptz not null default now();
alter table sm_cis add column if not exists updated_by uuid;
alter table sm_cis add column if not exists rev bigint not null default 0;
alter table sm_cis add column if not exists version integer not null default 1;
alter table sm_cis add column if not exists deleted_at timestamptz;
alter table sm_cis add column if not exists origin text;
alter table sm_cis add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cis add column if not exists no integer;
alter table sm_cis add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CI' || no::text else 'CI' || lpad(no::text, 7, '0') end) stored;
alter table sm_cis add column if not exists name text;
alter table sm_cis add column if not exists class text;
alter table sm_cis add column if not exists description text;
alter table sm_cis add column if not exists environment text;
alter table sm_cis add column if not exists criticality text;
alter table sm_cis add column if not exists tier text;
alter table sm_cis add column if not exists operational_status text;
alter table sm_cis add column if not exists install_status text;
alter table sm_cis add column if not exists tags jsonb;
alter table sm_cis add column if not exists owned_by uuid;
alter table sm_cis add column if not exists managed_by uuid;
alter table sm_cis add column if not exists used_by uuid;
alter table sm_cis add column if not exists support_group_id uuid;
alter table sm_cis add column if not exists managed_by_group_id uuid;
alter table sm_cis add column if not exists change_approval_group_id uuid;
alter table sm_cis add column if not exists company_id uuid;
alter table sm_cis add column if not exists location_id uuid;
alter table sm_cis add column if not exists cost_center_id uuid;
alter table sm_cis add column if not exists maintenance_calendar_id uuid;
alter table sm_cis add column if not exists serial_number text;
alter table sm_cis add column if not exists asset_tag text;
alter table sm_cis add column if not exists manufacturer text;
alter table sm_cis add column if not exists model_name text;
alter table sm_cis add column if not exists hostname text;
alter table sm_cis add column if not exists fqdn text;
alter table sm_cis add column if not exists ip_address text;
alter table sm_cis add column if not exists mac_address text;
alter table sm_cis add column if not exists bios_uuid text;
alter table sm_cis add column if not exists cloud_resource_id text;
alter table sm_cis add column if not exists os text;
alter table sm_cis add column if not exists os_version text;
alter table sm_cis add column if not exists sw_version text;
alter table sm_cis add column if not exists cpu_count integer;
alter table sm_cis add column if not exists ram_mb integer;
alter table sm_cis add column if not exists disk_gb integer;
alter table sm_cis add column if not exists url text;
alter table sm_cis add column if not exists expires_at date;
alter table sm_cis add column if not exists eol_date date;
alter table sm_cis add column if not exists attrs jsonb;
alter table sm_cis add column if not exists change_id uuid;
alter table sm_cis add column if not exists disposal_notes text;
alter table sm_cis add column if not exists discovery_source_id uuid;
alter table sm_cis add column if not exists first_discovered_at timestamptz;
alter table sm_cis add column if not exists last_discovered_at timestamptz;
alter table sm_cis add column if not exists is_stale boolean not null default false;
alter table sm_cis add column if not exists health_score integer;
alter table sm_cis add column if not exists health_issues jsonb;
alter table sm_cis add column if not exists health jsonb;
alter table sm_cis add column if not exists health_at timestamptz;
alter table sm_cis add column if not exists locked_attrs jsonb;
alter table sm_cis add column if not exists attr_meta jsonb;
alter table sm_cis add column if not exists certified_at timestamptz;
alter table sm_cis add column if not exists certified_by uuid;
alter table sm_cis add column if not exists supports_critical_function boolean not null default false;
alter table sm_cis add column if not exists max_criticality text;
alter table sm_cis add column if not exists merged_into uuid;
alter table sm_cis add column if not exists watch_list jsonb;
alter table sm_cis add column if not exists state text;
create unique index if not exists sm_cis_no_uk on sm_cis (org_id, no);
create index if not exists sm_cis_rev_idx on sm_cis (org_id, rev);
create index if not exists sm_cis_upd_idx on sm_cis (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cis_crt_idx on sm_cis (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cis_class_idx on sm_cis (org_id, class) where deleted_at is null;
create index if not exists sm_cis_serial_number_idx on sm_cis (org_id, serial_number) where deleted_at is null;
create index if not exists sm_cis_asset_tag_idx on sm_cis (org_id, asset_tag) where deleted_at is null;
create index if not exists sm_cis_hostname_idx on sm_cis (org_id, hostname) where deleted_at is null;
create index if not exists sm_cis_fqdn_idx on sm_cis (org_id, fqdn) where deleted_at is null;
create index if not exists sm_cis_ip_address_idx on sm_cis (org_id, ip_address) where deleted_at is null;
create index if not exists sm_cis_mac_address_idx on sm_cis (org_id, mac_address) where deleted_at is null;
create index if not exists sm_cis_bios_uuid_idx on sm_cis (org_id, bios_uuid) where deleted_at is null;
create index if not exists sm_cis_cloud_resource_id_idx on sm_cis (org_id, cloud_resource_id) where deleted_at is null;
create index if not exists sm_cis_expires_at_idx on sm_cis (org_id, expires_at) where deleted_at is null;
create index if not exists sm_cis_state_idx on sm_cis (org_id, state) where deleted_at is null;
create index if not exists sm_cis_workspace_acc_idx on sm_cis (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cis_unit_acc_idx on sm_cis (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cis_domain_acc_idx on sm_cis (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cis_owned_by_idx on sm_cis (org_id, owned_by) where deleted_at is null;
create index if not exists sm_cis_managed_by_idx on sm_cis (org_id, managed_by) where deleted_at is null;
create index if not exists sm_cis_used_by_idx on sm_cis (org_id, used_by) where deleted_at is null;
create index if not exists sm_cis_watch_list_gin on sm_cis using gin (watch_list);
drop trigger if exists sm_cis_sync on sm_cis;
create trigger sm_cis_sync before insert or update on sm_cis for each row execute function sm_sync_touch('ci');
alter table sm_cis enable row level security;

-- ci_baseline: خط‌های مبنای پیکربندی
create table if not exists sm_ci_baselines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_baselines add column if not exists workspace_id uuid;
alter table sm_ci_baselines add column if not exists domain_id uuid;
alter table sm_ci_baselines add column if not exists unit_id uuid;
alter table sm_ci_baselines add column if not exists created_at timestamptz not null default now();
alter table sm_ci_baselines add column if not exists created_by uuid;
alter table sm_ci_baselines add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_baselines add column if not exists updated_by uuid;
alter table sm_ci_baselines add column if not exists rev bigint not null default 0;
alter table sm_ci_baselines add column if not exists version integer not null default 1;
alter table sm_ci_baselines add column if not exists deleted_at timestamptz;
alter table sm_ci_baselines add column if not exists origin text;
alter table sm_ci_baselines add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_baselines add column if not exists no integer;
alter table sm_ci_baselines add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BSL' || no::text else 'BSL' || lpad(no::text, 5, '0') end) stored;
alter table sm_ci_baselines add column if not exists name text;
alter table sm_ci_baselines add column if not exists kind text;
alter table sm_ci_baselines add column if not exists scope_kind text;
alter table sm_ci_baselines add column if not exists class text;
alter table sm_ci_baselines add column if not exists group_id uuid;
alter table sm_ci_baselines add column if not exists ci_ids jsonb;
alter table sm_ci_baselines add column if not exists include_relations boolean not null default true;
alter table sm_ci_baselines add column if not exists owner_id uuid;
alter table sm_ci_baselines add column if not exists taken_at timestamptz;
alter table sm_ci_baselines add column if not exists item_count integer;
alter table sm_ci_baselines add column if not exists approved_by uuid;
alter table sm_ci_baselines add column if not exists approved_at timestamptz;
alter table sm_ci_baselines add column if not exists items jsonb;
alter table sm_ci_baselines add column if not exists description text;
alter table sm_ci_baselines add column if not exists state text;
create unique index if not exists sm_ci_baselines_no_uk on sm_ci_baselines (org_id, no);
create index if not exists sm_ci_baselines_rev_idx on sm_ci_baselines (org_id, rev);
create index if not exists sm_ci_baselines_upd_idx on sm_ci_baselines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_baselines_crt_idx on sm_ci_baselines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_baselines_state_idx on sm_ci_baselines (org_id, state) where deleted_at is null;
create index if not exists sm_ci_baselines_workspace_acc_idx on sm_ci_baselines (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_baselines_unit_acc_idx on sm_ci_baselines (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_baselines_domain_acc_idx on sm_ci_baselines (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_baselines_owner_id_idx on sm_ci_baselines (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_ci_baselines_sync on sm_ci_baselines;
create trigger sm_ci_baselines_sync before insert or update on sm_ci_baselines for each row execute function sm_sync_touch('ci_baseline');
alter table sm_ci_baselines enable row level security;

-- ci_cert_campaign: دوره‌های تأیید داده
create table if not exists sm_ci_cert_campaigns (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_cert_campaigns add column if not exists workspace_id uuid;
alter table sm_ci_cert_campaigns add column if not exists domain_id uuid;
alter table sm_ci_cert_campaigns add column if not exists unit_id uuid;
alter table sm_ci_cert_campaigns add column if not exists created_at timestamptz not null default now();
alter table sm_ci_cert_campaigns add column if not exists created_by uuid;
alter table sm_ci_cert_campaigns add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_cert_campaigns add column if not exists updated_by uuid;
alter table sm_ci_cert_campaigns add column if not exists rev bigint not null default 0;
alter table sm_ci_cert_campaigns add column if not exists version integer not null default 1;
alter table sm_ci_cert_campaigns add column if not exists deleted_at timestamptz;
alter table sm_ci_cert_campaigns add column if not exists origin text;
alter table sm_ci_cert_campaigns add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_cert_campaigns add column if not exists no integer;
alter table sm_ci_cert_campaigns add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRC' || no::text else 'CRC' || lpad(no::text, 5, '0') end) stored;
alter table sm_ci_cert_campaigns add column if not exists name text;
alter table sm_ci_cert_campaigns add column if not exists condition jsonb;
alter table sm_ci_cert_campaigns add column if not exists fields_to_confirm jsonb;
alter table sm_ci_cert_campaigns add column if not exists due_at timestamptz;
alter table sm_ci_cert_campaigns add column if not exists owner_id uuid;
alter table sm_ci_cert_campaigns add column if not exists task_count integer;
alter table sm_ci_cert_campaigns add column if not exists done_count integer;
alter table sm_ci_cert_campaigns add column if not exists description text;
alter table sm_ci_cert_campaigns add column if not exists state text;
create unique index if not exists sm_ci_cert_campaigns_no_uk on sm_ci_cert_campaigns (org_id, no);
create index if not exists sm_ci_cert_campaigns_rev_idx on sm_ci_cert_campaigns (org_id, rev);
create index if not exists sm_ci_cert_campaigns_upd_idx on sm_ci_cert_campaigns (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_campaigns_crt_idx on sm_ci_cert_campaigns (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_campaigns_state_idx on sm_ci_cert_campaigns (org_id, state) where deleted_at is null;
create index if not exists sm_ci_cert_campaigns_workspace_acc_idx on sm_ci_cert_campaigns (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_cert_campaigns_unit_acc_idx on sm_ci_cert_campaigns (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_cert_campaigns_domain_acc_idx on sm_ci_cert_campaigns (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_cert_campaigns_owner_id_idx on sm_ci_cert_campaigns (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_ci_cert_campaigns_sync on sm_ci_cert_campaigns;
create trigger sm_ci_cert_campaigns_sync before insert or update on sm_ci_cert_campaigns for each row execute function sm_sync_touch('ci_cert_campaign');
alter table sm_ci_cert_campaigns enable row level security;

-- ci_cert_task: تأییدهای دادهٔ پیکربندی
create table if not exists sm_ci_cert_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_cert_tasks add column if not exists workspace_id uuid;
alter table sm_ci_cert_tasks add column if not exists domain_id uuid;
alter table sm_ci_cert_tasks add column if not exists unit_id uuid;
alter table sm_ci_cert_tasks add column if not exists created_at timestamptz not null default now();
alter table sm_ci_cert_tasks add column if not exists created_by uuid;
alter table sm_ci_cert_tasks add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_cert_tasks add column if not exists updated_by uuid;
alter table sm_ci_cert_tasks add column if not exists rev bigint not null default 0;
alter table sm_ci_cert_tasks add column if not exists version integer not null default 1;
alter table sm_ci_cert_tasks add column if not exists deleted_at timestamptz;
alter table sm_ci_cert_tasks add column if not exists origin text;
alter table sm_ci_cert_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_cert_tasks add column if not exists no integer;
alter table sm_ci_cert_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'CRT' || no::text else 'CRT' || lpad(no::text, 6, '0') end) stored;
alter table sm_ci_cert_tasks add column if not exists short_description text;
alter table sm_ci_cert_tasks add column if not exists description text;
alter table sm_ci_cert_tasks add column if not exists state text;
alter table sm_ci_cert_tasks add column if not exists priority text;
alter table sm_ci_cert_tasks add column if not exists impact text;
alter table sm_ci_cert_tasks add column if not exists urgency text;
alter table sm_ci_cert_tasks add column if not exists category text;
alter table sm_ci_cert_tasks add column if not exists subcategory text;
alter table sm_ci_cert_tasks add column if not exists channel text;
alter table sm_ci_cert_tasks add column if not exists caller_id uuid;
alter table sm_ci_cert_tasks add column if not exists requested_for uuid;
alter table sm_ci_cert_tasks add column if not exists opened_by uuid;
alter table sm_ci_cert_tasks add column if not exists opened_at timestamptz;
alter table sm_ci_cert_tasks add column if not exists assignment_group_id uuid;
alter table sm_ci_cert_tasks add column if not exists assigned_to uuid;
alter table sm_ci_cert_tasks add column if not exists service_id uuid;
alter table sm_ci_cert_tasks add column if not exists offering_id uuid;
alter table sm_ci_cert_tasks add column if not exists ci_id uuid;
alter table sm_ci_cert_tasks add column if not exists location_id uuid;
alter table sm_ci_cert_tasks add column if not exists due_at timestamptz;
alter table sm_ci_cert_tasks add column if not exists resolved_at timestamptz;
alter table sm_ci_cert_tasks add column if not exists resolved_by uuid;
alter table sm_ci_cert_tasks add column if not exists closed_at timestamptz;
alter table sm_ci_cert_tasks add column if not exists closed_by uuid;
alter table sm_ci_cert_tasks add column if not exists close_code text;
alter table sm_ci_cert_tasks add column if not exists close_notes text;
alter table sm_ci_cert_tasks add column if not exists parent_id uuid;
alter table sm_ci_cert_tasks add column if not exists watch_list jsonb;
alter table sm_ci_cert_tasks add column if not exists approval text;
alter table sm_ci_cert_tasks add column if not exists escalation integer;
alter table sm_ci_cert_tasks add column if not exists reassignment_count integer;
alter table sm_ci_cert_tasks add column if not exists reopen_count integer;
alter table sm_ci_cert_tasks add column if not exists time_worked bigint;
alter table sm_ci_cert_tasks add column if not exists first_response_at timestamptz;
alter table sm_ci_cert_tasks add column if not exists active boolean not null default true;
alter table sm_ci_cert_tasks add column if not exists sla_due timestamptz;
alter table sm_ci_cert_tasks add column if not exists knowledge boolean not null default false;
alter table sm_ci_cert_tasks add column if not exists campaign_id uuid;
alter table sm_ci_cert_tasks add column if not exists ci_ids jsonb;
alter table sm_ci_cert_tasks add column if not exists corrections text;
alter table sm_ci_cert_tasks add column if not exists confirmed_count integer;
create unique index if not exists sm_ci_cert_tasks_no_uk on sm_ci_cert_tasks (org_id, no);
create index if not exists sm_ci_cert_tasks_rev_idx on sm_ci_cert_tasks (org_id, rev);
create index if not exists sm_ci_cert_tasks_upd_idx on sm_ci_cert_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_crt_idx on sm_ci_cert_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_state_idx on sm_ci_cert_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_assignment_group_id_idx on sm_ci_cert_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_assigned_to_idx on sm_ci_cert_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_campaign_id_idx on sm_ci_cert_tasks (org_id, campaign_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_workspace_acc_idx on sm_ci_cert_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_cert_tasks_unit_acc_idx on sm_ci_cert_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_cert_tasks_domain_acc_idx on sm_ci_cert_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_cert_tasks_caller_id_idx on sm_ci_cert_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_requested_for_idx on sm_ci_cert_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_opened_by_idx on sm_ci_cert_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_ci_cert_tasks_watch_list_gin on sm_ci_cert_tasks using gin (watch_list);
drop trigger if exists sm_ci_cert_tasks_sync on sm_ci_cert_tasks;
create trigger sm_ci_cert_tasks_sync before insert or update on sm_ci_cert_tasks for each row execute function sm_sync_touch('ci_cert_task');
alter table sm_ci_cert_tasks enable row level security;

-- ci_class: کلاس‌های پیکربندی
create table if not exists sm_ci_classes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_classes add column if not exists workspace_id uuid;
alter table sm_ci_classes add column if not exists domain_id uuid;
alter table sm_ci_classes add column if not exists unit_id uuid;
alter table sm_ci_classes add column if not exists created_at timestamptz not null default now();
alter table sm_ci_classes add column if not exists created_by uuid;
alter table sm_ci_classes add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_classes add column if not exists updated_by uuid;
alter table sm_ci_classes add column if not exists rev bigint not null default 0;
alter table sm_ci_classes add column if not exists version integer not null default 1;
alter table sm_ci_classes add column if not exists deleted_at timestamptz;
alter table sm_ci_classes add column if not exists origin text;
alter table sm_ci_classes add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_classes add column if not exists label text;
alter table sm_ci_classes add column if not exists key text;
alter table sm_ci_classes add column if not exists parent_key text;
alter table sm_ci_classes add column if not exists family text;
alter table sm_ci_classes add column if not exists icon text;
alter table sm_ci_classes add column if not exists color text;
alter table sm_ci_classes add column if not exists sort_order integer;
alter table sm_ci_classes add column if not exists abstract boolean not null default false;
alter table sm_ci_classes add column if not exists principal boolean not null default false;
alter table sm_ci_classes add column if not exists create_disabled boolean not null default false;
alter table sm_ci_classes add column if not exists active boolean not null default true;
alter table sm_ci_classes add column if not exists builtin boolean not null default false;
alter table sm_ci_classes add column if not exists pack_version integer;
alter table sm_ci_classes add column if not exists description text;
alter table sm_ci_classes add column if not exists attrs jsonb;
alter table sm_ci_classes add column if not exists required_fields jsonb;
alter table sm_ci_classes add column if not exists recommended_fields jsonb;
alter table sm_ci_classes add column if not exists owner_required boolean not null default false;
alter table sm_ci_classes add column if not exists stale_days integer;
alter table sm_ci_classes add column if not exists operational_requires jsonb;
alter table sm_ci_classes add column if not exists rel_rules jsonb;
alter table sm_ci_classes add column if not exists controlled_attrs jsonb;
alter table sm_ci_classes add column if not exists asset_class text;
create index if not exists sm_ci_classes_rev_idx on sm_ci_classes (org_id, rev);
create index if not exists sm_ci_classes_upd_idx on sm_ci_classes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_classes_crt_idx on sm_ci_classes (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ci_classes_key_uk on sm_ci_classes (org_id, key) where deleted_at is null;
drop trigger if exists sm_ci_classes_sync on sm_ci_classes;
create trigger sm_ci_classes_sync before insert or update on sm_ci_classes for each row execute function sm_sync_touch('ci_class');
alter table sm_ci_classes enable row level security;

-- ci_drift: انحراف‌های پیکربندی
create table if not exists sm_ci_drifts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_drifts add column if not exists workspace_id uuid;
alter table sm_ci_drifts add column if not exists domain_id uuid;
alter table sm_ci_drifts add column if not exists unit_id uuid;
alter table sm_ci_drifts add column if not exists created_at timestamptz not null default now();
alter table sm_ci_drifts add column if not exists created_by uuid;
alter table sm_ci_drifts add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_drifts add column if not exists updated_by uuid;
alter table sm_ci_drifts add column if not exists rev bigint not null default 0;
alter table sm_ci_drifts add column if not exists version integer not null default 1;
alter table sm_ci_drifts add column if not exists deleted_at timestamptz;
alter table sm_ci_drifts add column if not exists origin text;
alter table sm_ci_drifts add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_drifts add column if not exists no integer;
alter table sm_ci_drifts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DRF' || no::text else 'DRF' || lpad(no::text, 6, '0') end) stored;
alter table sm_ci_drifts add column if not exists short_description text;
alter table sm_ci_drifts add column if not exists description text;
alter table sm_ci_drifts add column if not exists state text;
alter table sm_ci_drifts add column if not exists priority text;
alter table sm_ci_drifts add column if not exists impact text;
alter table sm_ci_drifts add column if not exists urgency text;
alter table sm_ci_drifts add column if not exists category text;
alter table sm_ci_drifts add column if not exists subcategory text;
alter table sm_ci_drifts add column if not exists channel text;
alter table sm_ci_drifts add column if not exists caller_id uuid;
alter table sm_ci_drifts add column if not exists requested_for uuid;
alter table sm_ci_drifts add column if not exists opened_by uuid;
alter table sm_ci_drifts add column if not exists opened_at timestamptz;
alter table sm_ci_drifts add column if not exists assignment_group_id uuid;
alter table sm_ci_drifts add column if not exists assigned_to uuid;
alter table sm_ci_drifts add column if not exists service_id uuid;
alter table sm_ci_drifts add column if not exists offering_id uuid;
alter table sm_ci_drifts add column if not exists ci_id uuid;
alter table sm_ci_drifts add column if not exists location_id uuid;
alter table sm_ci_drifts add column if not exists due_at timestamptz;
alter table sm_ci_drifts add column if not exists resolved_at timestamptz;
alter table sm_ci_drifts add column if not exists resolved_by uuid;
alter table sm_ci_drifts add column if not exists closed_at timestamptz;
alter table sm_ci_drifts add column if not exists closed_by uuid;
alter table sm_ci_drifts add column if not exists close_code text;
alter table sm_ci_drifts add column if not exists close_notes text;
alter table sm_ci_drifts add column if not exists parent_id uuid;
alter table sm_ci_drifts add column if not exists watch_list jsonb;
alter table sm_ci_drifts add column if not exists approval text;
alter table sm_ci_drifts add column if not exists escalation integer;
alter table sm_ci_drifts add column if not exists reassignment_count integer;
alter table sm_ci_drifts add column if not exists reopen_count integer;
alter table sm_ci_drifts add column if not exists time_worked bigint;
alter table sm_ci_drifts add column if not exists first_response_at timestamptz;
alter table sm_ci_drifts add column if not exists active boolean not null default true;
alter table sm_ci_drifts add column if not exists sla_due timestamptz;
alter table sm_ci_drifts add column if not exists knowledge boolean not null default false;
alter table sm_ci_drifts add column if not exists attribute text;
alter table sm_ci_drifts add column if not exists expected text;
alter table sm_ci_drifts add column if not exists actual text;
alter table sm_ci_drifts add column if not exists baseline_id uuid;
alter table sm_ci_drifts add column if not exists source_id uuid;
alter table sm_ci_drifts add column if not exists change_id uuid;
alter table sm_ci_drifts add column if not exists decision text;
alter table sm_ci_drifts add column if not exists dedupe_key text;
create unique index if not exists sm_ci_drifts_no_uk on sm_ci_drifts (org_id, no);
create index if not exists sm_ci_drifts_rev_idx on sm_ci_drifts (org_id, rev);
create index if not exists sm_ci_drifts_upd_idx on sm_ci_drifts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_drifts_crt_idx on sm_ci_drifts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_drifts_state_idx on sm_ci_drifts (org_id, state) where deleted_at is null;
create index if not exists sm_ci_drifts_assignment_group_id_idx on sm_ci_drifts (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_ci_drifts_assigned_to_idx on sm_ci_drifts (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_ci_drifts_ci_id_idx on sm_ci_drifts (org_id, ci_id) where deleted_at is null;
create index if not exists sm_ci_drifts_dedupe_key_idx on sm_ci_drifts (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_ci_drifts_workspace_acc_idx on sm_ci_drifts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_drifts_unit_acc_idx on sm_ci_drifts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_drifts_domain_acc_idx on sm_ci_drifts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_drifts_caller_id_idx on sm_ci_drifts (org_id, caller_id) where deleted_at is null;
create index if not exists sm_ci_drifts_requested_for_idx on sm_ci_drifts (org_id, requested_for) where deleted_at is null;
create index if not exists sm_ci_drifts_opened_by_idx on sm_ci_drifts (org_id, opened_by) where deleted_at is null;
create index if not exists sm_ci_drifts_watch_list_gin on sm_ci_drifts using gin (watch_list);
drop trigger if exists sm_ci_drifts_sync on sm_ci_drifts;
create trigger sm_ci_drifts_sync before insert or update on sm_ci_drifts for each row execute function sm_sync_touch('ci_drift');
alter table sm_ci_drifts enable row level security;

-- ci_group: گروه‌های پیکربندی
create table if not exists sm_ci_groups (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_groups add column if not exists workspace_id uuid;
alter table sm_ci_groups add column if not exists domain_id uuid;
alter table sm_ci_groups add column if not exists unit_id uuid;
alter table sm_ci_groups add column if not exists created_at timestamptz not null default now();
alter table sm_ci_groups add column if not exists created_by uuid;
alter table sm_ci_groups add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_groups add column if not exists updated_by uuid;
alter table sm_ci_groups add column if not exists rev bigint not null default 0;
alter table sm_ci_groups add column if not exists version integer not null default 1;
alter table sm_ci_groups add column if not exists deleted_at timestamptz;
alter table sm_ci_groups add column if not exists origin text;
alter table sm_ci_groups add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_groups add column if not exists name text;
alter table sm_ci_groups add column if not exists kind text;
alter table sm_ci_groups add column if not exists condition jsonb;
alter table sm_ci_groups add column if not exists members jsonb;
alter table sm_ci_groups add column if not exists ci_id uuid;
alter table sm_ci_groups add column if not exists min_up integer;
alter table sm_ci_groups add column if not exists min_up_pct numeric;
alter table sm_ci_groups add column if not exists owner_group_id uuid;
alter table sm_ci_groups add column if not exists active boolean not null default true;
alter table sm_ci_groups add column if not exists member_count integer;
alter table sm_ci_groups add column if not exists description text;
create index if not exists sm_ci_groups_rev_idx on sm_ci_groups (org_id, rev);
create index if not exists sm_ci_groups_upd_idx on sm_ci_groups (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_groups_crt_idx on sm_ci_groups (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_groups_ci_id_idx on sm_ci_groups (org_id, ci_id) where deleted_at is null;
create index if not exists sm_ci_groups_workspace_acc_idx on sm_ci_groups (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_groups_unit_acc_idx on sm_ci_groups (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_groups_domain_acc_idx on sm_ci_groups (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_ci_groups_sync on sm_ci_groups;
create trigger sm_ci_groups_sync before insert or update on sm_ci_groups for each row execute function sm_sync_touch('ci_group');
alter table sm_ci_groups enable row level security;

-- ci_identification_rule: قاعده‌های شناسایی
create table if not exists sm_ci_ident_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_ident_rules add column if not exists workspace_id uuid;
alter table sm_ci_ident_rules add column if not exists domain_id uuid;
alter table sm_ci_ident_rules add column if not exists unit_id uuid;
alter table sm_ci_ident_rules add column if not exists created_at timestamptz not null default now();
alter table sm_ci_ident_rules add column if not exists created_by uuid;
alter table sm_ci_ident_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_ident_rules add column if not exists updated_by uuid;
alter table sm_ci_ident_rules add column if not exists rev bigint not null default 0;
alter table sm_ci_ident_rules add column if not exists version integer not null default 1;
alter table sm_ci_ident_rules add column if not exists deleted_at timestamptz;
alter table sm_ci_ident_rules add column if not exists origin text;
alter table sm_ci_ident_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_ident_rules add column if not exists name text;
alter table sm_ci_ident_rules add column if not exists class text;
alter table sm_ci_ident_rules add column if not exists entries jsonb;
alter table sm_ci_ident_rules add column if not exists active boolean not null default true;
alter table sm_ci_ident_rules add column if not exists sort_order integer;
alter table sm_ci_ident_rules add column if not exists builtin boolean not null default false;
create index if not exists sm_ci_ident_rules_rev_idx on sm_ci_ident_rules (org_id, rev);
create index if not exists sm_ci_ident_rules_upd_idx on sm_ci_ident_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_ident_rules_crt_idx on sm_ci_ident_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ci_ident_rules_sync on sm_ci_ident_rules;
create trigger sm_ci_ident_rules_sync before insert or update on sm_ci_ident_rules for each row execute function sm_sync_touch('ci_identification_rule');
alter table sm_ci_ident_rules enable row level security;

-- ci_impact_sim: شبیه‌سازی‌های اثر
create table if not exists sm_ci_impact_sims (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_impact_sims add column if not exists workspace_id uuid;
alter table sm_ci_impact_sims add column if not exists domain_id uuid;
alter table sm_ci_impact_sims add column if not exists unit_id uuid;
alter table sm_ci_impact_sims add column if not exists created_at timestamptz not null default now();
alter table sm_ci_impact_sims add column if not exists created_by uuid;
alter table sm_ci_impact_sims add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_impact_sims add column if not exists updated_by uuid;
alter table sm_ci_impact_sims add column if not exists rev bigint not null default 0;
alter table sm_ci_impact_sims add column if not exists version integer not null default 1;
alter table sm_ci_impact_sims add column if not exists deleted_at timestamptz;
alter table sm_ci_impact_sims add column if not exists origin text;
alter table sm_ci_impact_sims add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_impact_sims add column if not exists name text;
alter table sm_ci_impact_sims add column if not exists sim_state text;
alter table sm_ci_impact_sims add column if not exists ci_ids jsonb;
alter table sm_ci_impact_sims add column if not exists linked_table text;
alter table sm_ci_impact_sims add column if not exists linked_id text;
alter table sm_ci_impact_sims add column if not exists linked_label text;
alter table sm_ci_impact_sims add column if not exists owner_id uuid;
alter table sm_ci_impact_sims add column if not exists summary text;
alter table sm_ci_impact_sims add column if not exists result jsonb;
create index if not exists sm_ci_impact_sims_rev_idx on sm_ci_impact_sims (org_id, rev);
create index if not exists sm_ci_impact_sims_upd_idx on sm_ci_impact_sims (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_impact_sims_crt_idx on sm_ci_impact_sims (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_impact_sims_workspace_acc_idx on sm_ci_impact_sims (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_impact_sims_unit_acc_idx on sm_ci_impact_sims (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_impact_sims_domain_acc_idx on sm_ci_impact_sims (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_impact_sims_owner_id_idx on sm_ci_impact_sims (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_ci_impact_sims_sync on sm_ci_impact_sims;
create trigger sm_ci_impact_sims_sync before insert or update on sm_ci_impact_sims for each row execute function sm_sync_touch('ci_impact_sim');
alter table sm_ci_impact_sims enable row level security;

-- ci_reconciliation_rule: قاعده‌های آشتی داده
create table if not exists sm_ci_recon_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_recon_rules add column if not exists workspace_id uuid;
alter table sm_ci_recon_rules add column if not exists domain_id uuid;
alter table sm_ci_recon_rules add column if not exists unit_id uuid;
alter table sm_ci_recon_rules add column if not exists created_at timestamptz not null default now();
alter table sm_ci_recon_rules add column if not exists created_by uuid;
alter table sm_ci_recon_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_recon_rules add column if not exists updated_by uuid;
alter table sm_ci_recon_rules add column if not exists rev bigint not null default 0;
alter table sm_ci_recon_rules add column if not exists version integer not null default 1;
alter table sm_ci_recon_rules add column if not exists deleted_at timestamptz;
alter table sm_ci_recon_rules add column if not exists origin text;
alter table sm_ci_recon_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_recon_rules add column if not exists name text;
alter table sm_ci_recon_rules add column if not exists class text;
alter table sm_ci_recon_rules add column if not exists attributes jsonb;
alter table sm_ci_recon_rules add column if not exists source_id uuid;
alter table sm_ci_recon_rules add column if not exists priority integer;
alter table sm_ci_recon_rules add column if not exists max_age_days integer;
alter table sm_ci_recon_rules add column if not exists active boolean not null default true;
create index if not exists sm_ci_recon_rules_rev_idx on sm_ci_recon_rules (org_id, rev);
create index if not exists sm_ci_recon_rules_upd_idx on sm_ci_recon_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_recon_rules_crt_idx on sm_ci_recon_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ci_recon_rules_sync on sm_ci_recon_rules;
create trigger sm_ci_recon_rules_sync before insert or update on sm_ci_recon_rules for each row execute function sm_sync_touch('ci_reconciliation_rule');
alter table sm_ci_recon_rules enable row level security;

-- ci_rel: رابطه‌های پیکربندی
create table if not exists sm_ci_rels (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_rels add column if not exists workspace_id uuid;
alter table sm_ci_rels add column if not exists domain_id uuid;
alter table sm_ci_rels add column if not exists unit_id uuid;
alter table sm_ci_rels add column if not exists created_at timestamptz not null default now();
alter table sm_ci_rels add column if not exists created_by uuid;
alter table sm_ci_rels add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_rels add column if not exists updated_by uuid;
alter table sm_ci_rels add column if not exists rev bigint not null default 0;
alter table sm_ci_rels add column if not exists version integer not null default 1;
alter table sm_ci_rels add column if not exists deleted_at timestamptz;
alter table sm_ci_rels add column if not exists origin text;
alter table sm_ci_rels add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_rels add column if not exists parent_id uuid;
alter table sm_ci_rels add column if not exists type text;
alter table sm_ci_rels add column if not exists child_id uuid;
alter table sm_ci_rels add column if not exists label text;
alter table sm_ci_rels add column if not exists origin_kind text;
alter table sm_ci_rels add column if not exists source_id uuid;
alter table sm_ci_rels add column if not exists impact_weight integer;
alter table sm_ci_rels add column if not exists valid_from timestamptz;
alter table sm_ci_rels add column if not exists valid_to timestamptz;
alter table sm_ci_rels add column if not exists discovered_at timestamptz;
alter table sm_ci_rels add column if not exists last_seen_at timestamptz;
alter table sm_ci_rels add column if not exists hide_on_map boolean not null default false;
alter table sm_ci_rels add column if not exists note text;
alter table sm_ci_rels add column if not exists owned_by uuid;
alter table sm_ci_rels add column if not exists support_group_id uuid;
create index if not exists sm_ci_rels_rev_idx on sm_ci_rels (org_id, rev);
create index if not exists sm_ci_rels_upd_idx on sm_ci_rels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rels_crt_idx on sm_ci_rels (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rels_parent_id_idx on sm_ci_rels (org_id, parent_id) where deleted_at is null;
create index if not exists sm_ci_rels_type_idx on sm_ci_rels (org_id, type) where deleted_at is null;
create index if not exists sm_ci_rels_child_id_idx on sm_ci_rels (org_id, child_id) where deleted_at is null;
create index if not exists sm_ci_rels_workspace_acc_idx on sm_ci_rels (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ci_rels_unit_acc_idx on sm_ci_rels (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ci_rels_domain_acc_idx on sm_ci_rels (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_ci_rels_owned_by_idx on sm_ci_rels (org_id, owned_by) where deleted_at is null;
drop trigger if exists sm_ci_rels_sync on sm_ci_rels;
create trigger sm_ci_rels_sync before insert or update on sm_ci_rels for each row execute function sm_sync_touch('ci_rel');
alter table sm_ci_rels enable row level security;

-- ci_rel_rule: قاعده‌های رابطه‌سازی
create table if not exists sm_ci_rel_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_rel_rules add column if not exists workspace_id uuid;
alter table sm_ci_rel_rules add column if not exists domain_id uuid;
alter table sm_ci_rel_rules add column if not exists unit_id uuid;
alter table sm_ci_rel_rules add column if not exists created_at timestamptz not null default now();
alter table sm_ci_rel_rules add column if not exists created_by uuid;
alter table sm_ci_rel_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_rel_rules add column if not exists updated_by uuid;
alter table sm_ci_rel_rules add column if not exists rev bigint not null default 0;
alter table sm_ci_rel_rules add column if not exists version integer not null default 1;
alter table sm_ci_rel_rules add column if not exists deleted_at timestamptz;
alter table sm_ci_rel_rules add column if not exists origin text;
alter table sm_ci_rel_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_rel_rules add column if not exists name text;
alter table sm_ci_rel_rules add column if not exists source_class text;
alter table sm_ci_rel_rules add column if not exists source_attr text;
alter table sm_ci_rel_rules add column if not exists target_class text;
alter table sm_ci_rel_rules add column if not exists target_attr text;
alter table sm_ci_rel_rules add column if not exists type text;
alter table sm_ci_rel_rules add column if not exists mode text;
alter table sm_ci_rel_rules add column if not exists active boolean not null default true;
alter table sm_ci_rel_rules add column if not exists last_run_at timestamptz;
alter table sm_ci_rel_rules add column if not exists last_result text;
create index if not exists sm_ci_rel_rules_rev_idx on sm_ci_rel_rules (org_id, rev);
create index if not exists sm_ci_rel_rules_upd_idx on sm_ci_rel_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_rules_crt_idx on sm_ci_rel_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_ci_rel_rules_sync on sm_ci_rel_rules;
create trigger sm_ci_rel_rules_sync before insert or update on sm_ci_rel_rules for each row execute function sm_sync_touch('ci_rel_rule');
alter table sm_ci_rel_rules enable row level security;

-- ci_rel_suggestion: پیشنهادهای رابطه
create table if not exists sm_ci_rel_suggestions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_rel_suggestions add column if not exists workspace_id uuid;
alter table sm_ci_rel_suggestions add column if not exists domain_id uuid;
alter table sm_ci_rel_suggestions add column if not exists unit_id uuid;
alter table sm_ci_rel_suggestions add column if not exists created_at timestamptz not null default now();
alter table sm_ci_rel_suggestions add column if not exists created_by uuid;
alter table sm_ci_rel_suggestions add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_rel_suggestions add column if not exists updated_by uuid;
alter table sm_ci_rel_suggestions add column if not exists rev bigint not null default 0;
alter table sm_ci_rel_suggestions add column if not exists version integer not null default 1;
alter table sm_ci_rel_suggestions add column if not exists deleted_at timestamptz;
alter table sm_ci_rel_suggestions add column if not exists origin text;
alter table sm_ci_rel_suggestions add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_rel_suggestions add column if not exists parent_id uuid;
alter table sm_ci_rel_suggestions add column if not exists type text;
alter table sm_ci_rel_suggestions add column if not exists child_id uuid;
alter table sm_ci_rel_suggestions add column if not exists label text;
alter table sm_ci_rel_suggestions add column if not exists score integer;
alter table sm_ci_rel_suggestions add column if not exists method text;
alter table sm_ci_rel_suggestions add column if not exists evidence jsonb;
alter table sm_ci_rel_suggestions add column if not exists decided_by uuid;
alter table sm_ci_rel_suggestions add column if not exists rel_id uuid;
alter table sm_ci_rel_suggestions add column if not exists pair_key text;
alter table sm_ci_rel_suggestions add column if not exists state text;
create index if not exists sm_ci_rel_suggestions_rev_idx on sm_ci_rel_suggestions (org_id, rev);
create index if not exists sm_ci_rel_suggestions_upd_idx on sm_ci_rel_suggestions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_crt_idx on sm_ci_rel_suggestions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_parent_id_idx on sm_ci_rel_suggestions (org_id, parent_id) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_child_id_idx on sm_ci_rel_suggestions (org_id, child_id) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_pair_key_idx on sm_ci_rel_suggestions (org_id, pair_key) where deleted_at is null;
create index if not exists sm_ci_rel_suggestions_state_idx on sm_ci_rel_suggestions (org_id, state) where deleted_at is null;
drop trigger if exists sm_ci_rel_suggestions_sync on sm_ci_rel_suggestions;
create trigger sm_ci_rel_suggestions_sync before insert or update on sm_ci_rel_suggestions for each row execute function sm_sync_touch('ci_rel_suggestion');
alter table sm_ci_rel_suggestions enable row level security;

-- ci_rel_type: نوع‌های رابطه
create table if not exists sm_ci_rel_types (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_ci_rel_types add column if not exists workspace_id uuid;
alter table sm_ci_rel_types add column if not exists domain_id uuid;
alter table sm_ci_rel_types add column if not exists unit_id uuid;
alter table sm_ci_rel_types add column if not exists created_at timestamptz not null default now();
alter table sm_ci_rel_types add column if not exists created_by uuid;
alter table sm_ci_rel_types add column if not exists updated_at timestamptz not null default now();
alter table sm_ci_rel_types add column if not exists updated_by uuid;
alter table sm_ci_rel_types add column if not exists rev bigint not null default 0;
alter table sm_ci_rel_types add column if not exists version integer not null default 1;
alter table sm_ci_rel_types add column if not exists deleted_at timestamptz;
alter table sm_ci_rel_types add column if not exists origin text;
alter table sm_ci_rel_types add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_ci_rel_types add column if not exists label text;
alter table sm_ci_rel_types add column if not exists inverse_label text;
alter table sm_ci_rel_types add column if not exists key text;
alter table sm_ci_rel_types add column if not exists category text;
alter table sm_ci_rel_types add column if not exists is_symmetric boolean not null default false;
alter table sm_ci_rel_types add column if not exists propagates boolean not null default true;
alter table sm_ci_rel_types add column if not exists impact text;
alter table sm_ci_rel_types add column if not exists color text;
alter table sm_ci_rel_types add column if not exists active boolean not null default true;
alter table sm_ci_rel_types add column if not exists builtin boolean not null default false;
alter table sm_ci_rel_types add column if not exists sort_order integer;
alter table sm_ci_rel_types add column if not exists description text;
create index if not exists sm_ci_rel_types_rev_idx on sm_ci_rel_types (org_id, rev);
create index if not exists sm_ci_rel_types_upd_idx on sm_ci_rel_types (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ci_rel_types_crt_idx on sm_ci_rel_types (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ci_rel_types_key_uk on sm_ci_rel_types (org_id, key) where deleted_at is null;
drop trigger if exists sm_ci_rel_types_sync on sm_ci_rel_types;
create trigger sm_ci_rel_types_sync before insert or update on sm_ci_rel_types for each row execute function sm_sync_touch('ci_rel_type');
alter table sm_ci_rel_types enable row level security;

-- cmdb_config: تنظیمات پیکربندی
create table if not exists sm_cmdb_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_configs add column if not exists workspace_id uuid;
alter table sm_cmdb_configs add column if not exists domain_id uuid;
alter table sm_cmdb_configs add column if not exists unit_id uuid;
alter table sm_cmdb_configs add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_configs add column if not exists created_by uuid;
alter table sm_cmdb_configs add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_configs add column if not exists updated_by uuid;
alter table sm_cmdb_configs add column if not exists rev bigint not null default 0;
alter table sm_cmdb_configs add column if not exists version integer not null default 1;
alter table sm_cmdb_configs add column if not exists deleted_at timestamptz;
alter table sm_cmdb_configs add column if not exists origin text;
alter table sm_cmdb_configs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_configs add column if not exists name text;
alter table sm_cmdb_configs add column if not exists config_key text;
alter table sm_cmdb_configs add column if not exists w_completeness integer;
alter table sm_cmdb_configs add column if not exists w_correctness integer;
alter table sm_cmdb_configs add column if not exists w_compliance integer;
alter table sm_cmdb_configs add column if not exists health_findings boolean not null default true;
alter table sm_cmdb_configs add column if not exists certify_days integer;
alter table sm_cmdb_configs add column if not exists impact_depth integer;
alter table sm_cmdb_configs add column if not exists map_max_nodes integer;
alter table sm_cmdb_configs add column if not exists suggest_min_support integer;
alter table sm_cmdb_configs add column if not exists manual_priority integer;
alter table sm_cmdb_configs add column if not exists controlled_mode text;
alter table sm_cmdb_configs add column if not exists cert_warn_days jsonb;
alter table sm_cmdb_configs add column if not exists seeded integer;
create index if not exists sm_cmdb_configs_rev_idx on sm_cmdb_configs (org_id, rev);
create index if not exists sm_cmdb_configs_upd_idx on sm_cmdb_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_configs_crt_idx on sm_cmdb_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cmdb_configs_config_key_uk on sm_cmdb_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_cmdb_configs_sync on sm_cmdb_configs;
create trigger sm_cmdb_configs_sync before insert or update on sm_cmdb_configs for each row execute function sm_sync_touch('cmdb_config');
alter table sm_cmdb_configs enable row level security;

-- cmdb_data_source: منبع‌های دادهٔ پیکربندی
create table if not exists sm_cmdb_sources (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_sources add column if not exists workspace_id uuid;
alter table sm_cmdb_sources add column if not exists domain_id uuid;
alter table sm_cmdb_sources add column if not exists unit_id uuid;
alter table sm_cmdb_sources add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_sources add column if not exists created_by uuid;
alter table sm_cmdb_sources add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_sources add column if not exists updated_by uuid;
alter table sm_cmdb_sources add column if not exists rev bigint not null default 0;
alter table sm_cmdb_sources add column if not exists version integer not null default 1;
alter table sm_cmdb_sources add column if not exists deleted_at timestamptz;
alter table sm_cmdb_sources add column if not exists origin text;
alter table sm_cmdb_sources add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_sources add column if not exists name text;
alter table sm_cmdb_sources add column if not exists kind text;
alter table sm_cmdb_sources add column if not exists priority integer;
alter table sm_cmdb_sources add column if not exists default_class text;
alter table sm_cmdb_sources add column if not exists active boolean not null default true;
alter table sm_cmdb_sources add column if not exists stale_after_days integer;
alter table sm_cmdb_sources add column if not exists delete_policy text;
alter table sm_cmdb_sources add column if not exists owner_id uuid;
alter table sm_cmdb_sources add column if not exists url text;
alter table sm_cmdb_sources add column if not exists format text;
alter table sm_cmdb_sources add column if not exists json_path text;
alter table sm_cmdb_sources add column if not exists every_hours integer;
alter table sm_cmdb_sources add column if not exists mapping jsonb;
alter table sm_cmdb_sources add column if not exists last_run_at timestamptz;
alter table sm_cmdb_sources add column if not exists last_status text;
alter table sm_cmdb_sources add column if not exists description text;
create index if not exists sm_cmdb_sources_rev_idx on sm_cmdb_sources (org_id, rev);
create index if not exists sm_cmdb_sources_upd_idx on sm_cmdb_sources (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_sources_crt_idx on sm_cmdb_sources (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cmdb_sources_name_uk on sm_cmdb_sources (org_id, name) where deleted_at is null;
create index if not exists sm_cmdb_sources_workspace_acc_idx on sm_cmdb_sources (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_sources_unit_acc_idx on sm_cmdb_sources (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_sources_domain_acc_idx on sm_cmdb_sources (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_sources_owner_id_idx on sm_cmdb_sources (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_cmdb_sources_sync on sm_cmdb_sources;
create trigger sm_cmdb_sources_sync before insert or update on sm_cmdb_sources for each row execute function sm_sync_touch('cmdb_data_source');
alter table sm_cmdb_sources enable row level security;

-- cmdb_dedup_task: بررسی‌های تکراری
create table if not exists sm_cmdb_dedup_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_dedup_tasks add column if not exists workspace_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists domain_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists unit_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_dedup_tasks add column if not exists created_by uuid;
alter table sm_cmdb_dedup_tasks add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_dedup_tasks add column if not exists updated_by uuid;
alter table sm_cmdb_dedup_tasks add column if not exists rev bigint not null default 0;
alter table sm_cmdb_dedup_tasks add column if not exists version integer not null default 1;
alter table sm_cmdb_dedup_tasks add column if not exists deleted_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists origin text;
alter table sm_cmdb_dedup_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_dedup_tasks add column if not exists no integer;
alter table sm_cmdb_dedup_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'DUP' || no::text else 'DUP' || lpad(no::text, 6, '0') end) stored;
alter table sm_cmdb_dedup_tasks add column if not exists short_description text;
alter table sm_cmdb_dedup_tasks add column if not exists description text;
alter table sm_cmdb_dedup_tasks add column if not exists state text;
alter table sm_cmdb_dedup_tasks add column if not exists priority text;
alter table sm_cmdb_dedup_tasks add column if not exists impact text;
alter table sm_cmdb_dedup_tasks add column if not exists urgency text;
alter table sm_cmdb_dedup_tasks add column if not exists category text;
alter table sm_cmdb_dedup_tasks add column if not exists subcategory text;
alter table sm_cmdb_dedup_tasks add column if not exists channel text;
alter table sm_cmdb_dedup_tasks add column if not exists caller_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists requested_for uuid;
alter table sm_cmdb_dedup_tasks add column if not exists opened_by uuid;
alter table sm_cmdb_dedup_tasks add column if not exists opened_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists assignment_group_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists assigned_to uuid;
alter table sm_cmdb_dedup_tasks add column if not exists service_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists offering_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists ci_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists location_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists due_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists resolved_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists resolved_by uuid;
alter table sm_cmdb_dedup_tasks add column if not exists closed_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists closed_by uuid;
alter table sm_cmdb_dedup_tasks add column if not exists close_code text;
alter table sm_cmdb_dedup_tasks add column if not exists close_notes text;
alter table sm_cmdb_dedup_tasks add column if not exists parent_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists watch_list jsonb;
alter table sm_cmdb_dedup_tasks add column if not exists approval text;
alter table sm_cmdb_dedup_tasks add column if not exists escalation integer;
alter table sm_cmdb_dedup_tasks add column if not exists reassignment_count integer;
alter table sm_cmdb_dedup_tasks add column if not exists reopen_count integer;
alter table sm_cmdb_dedup_tasks add column if not exists time_worked bigint;
alter table sm_cmdb_dedup_tasks add column if not exists first_response_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists active boolean not null default true;
alter table sm_cmdb_dedup_tasks add column if not exists sla_due timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists knowledge boolean not null default false;
alter table sm_cmdb_dedup_tasks add column if not exists candidates jsonb;
alter table sm_cmdb_dedup_tasks add column if not exists main_ci_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists score integer;
alter table sm_cmdb_dedup_tasks add column if not exists source_id uuid;
alter table sm_cmdb_dedup_tasks add column if not exists reason text;
alter table sm_cmdb_dedup_tasks add column if not exists candidate_key text;
alter table sm_cmdb_dedup_tasks add column if not exists merged_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists merged_by uuid;
alter table sm_cmdb_dedup_tasks add column if not exists undone_at timestamptz;
alter table sm_cmdb_dedup_tasks add column if not exists merge_journal jsonb;
create unique index if not exists sm_cmdb_dedup_tasks_no_uk on sm_cmdb_dedup_tasks (org_id, no);
create index if not exists sm_cmdb_dedup_tasks_rev_idx on sm_cmdb_dedup_tasks (org_id, rev);
create index if not exists sm_cmdb_dedup_tasks_upd_idx on sm_cmdb_dedup_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_crt_idx on sm_cmdb_dedup_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_state_idx on sm_cmdb_dedup_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_assignment_group_id_idx on sm_cmdb_dedup_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_assigned_to_idx on sm_cmdb_dedup_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_candidate_key_idx on sm_cmdb_dedup_tasks (org_id, candidate_key) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_workspace_acc_idx on sm_cmdb_dedup_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_dedup_tasks_unit_acc_idx on sm_cmdb_dedup_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_dedup_tasks_domain_acc_idx on sm_cmdb_dedup_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_dedup_tasks_caller_id_idx on sm_cmdb_dedup_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_requested_for_idx on sm_cmdb_dedup_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_opened_by_idx on sm_cmdb_dedup_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_cmdb_dedup_tasks_watch_list_gin on sm_cmdb_dedup_tasks using gin (watch_list);
drop trigger if exists sm_cmdb_dedup_tasks_sync on sm_cmdb_dedup_tasks;
create trigger sm_cmdb_dedup_tasks_sync before insert or update on sm_cmdb_dedup_tasks for each row execute function sm_sync_touch('cmdb_dedup_task');
alter table sm_cmdb_dedup_tasks enable row level security;

-- cmdb_finding: یافته‌های کیفیت داده
create table if not exists sm_cmdb_findings (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_findings add column if not exists workspace_id uuid;
alter table sm_cmdb_findings add column if not exists domain_id uuid;
alter table sm_cmdb_findings add column if not exists unit_id uuid;
alter table sm_cmdb_findings add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_findings add column if not exists created_by uuid;
alter table sm_cmdb_findings add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_findings add column if not exists updated_by uuid;
alter table sm_cmdb_findings add column if not exists rev bigint not null default 0;
alter table sm_cmdb_findings add column if not exists version integer not null default 1;
alter table sm_cmdb_findings add column if not exists deleted_at timestamptz;
alter table sm_cmdb_findings add column if not exists origin text;
alter table sm_cmdb_findings add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_findings add column if not exists no integer;
alter table sm_cmdb_findings add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'FND' || no::text else 'FND' || lpad(no::text, 7, '0') end) stored;
alter table sm_cmdb_findings add column if not exists short_description text;
alter table sm_cmdb_findings add column if not exists description text;
alter table sm_cmdb_findings add column if not exists state text;
alter table sm_cmdb_findings add column if not exists priority text;
alter table sm_cmdb_findings add column if not exists impact text;
alter table sm_cmdb_findings add column if not exists urgency text;
alter table sm_cmdb_findings add column if not exists category text;
alter table sm_cmdb_findings add column if not exists subcategory text;
alter table sm_cmdb_findings add column if not exists channel text;
alter table sm_cmdb_findings add column if not exists caller_id uuid;
alter table sm_cmdb_findings add column if not exists requested_for uuid;
alter table sm_cmdb_findings add column if not exists opened_by uuid;
alter table sm_cmdb_findings add column if not exists opened_at timestamptz;
alter table sm_cmdb_findings add column if not exists assignment_group_id uuid;
alter table sm_cmdb_findings add column if not exists assigned_to uuid;
alter table sm_cmdb_findings add column if not exists service_id uuid;
alter table sm_cmdb_findings add column if not exists offering_id uuid;
alter table sm_cmdb_findings add column if not exists ci_id uuid;
alter table sm_cmdb_findings add column if not exists location_id uuid;
alter table sm_cmdb_findings add column if not exists due_at timestamptz;
alter table sm_cmdb_findings add column if not exists resolved_at timestamptz;
alter table sm_cmdb_findings add column if not exists resolved_by uuid;
alter table sm_cmdb_findings add column if not exists closed_at timestamptz;
alter table sm_cmdb_findings add column if not exists closed_by uuid;
alter table sm_cmdb_findings add column if not exists close_code text;
alter table sm_cmdb_findings add column if not exists close_notes text;
alter table sm_cmdb_findings add column if not exists parent_id uuid;
alter table sm_cmdb_findings add column if not exists watch_list jsonb;
alter table sm_cmdb_findings add column if not exists approval text;
alter table sm_cmdb_findings add column if not exists escalation integer;
alter table sm_cmdb_findings add column if not exists reassignment_count integer;
alter table sm_cmdb_findings add column if not exists reopen_count integer;
alter table sm_cmdb_findings add column if not exists time_worked bigint;
alter table sm_cmdb_findings add column if not exists first_response_at timestamptz;
alter table sm_cmdb_findings add column if not exists active boolean not null default true;
alter table sm_cmdb_findings add column if not exists sla_due timestamptz;
alter table sm_cmdb_findings add column if not exists knowledge boolean not null default false;
alter table sm_cmdb_findings add column if not exists kind text;
alter table sm_cmdb_findings add column if not exists severity text;
alter table sm_cmdb_findings add column if not exists rule_id uuid;
alter table sm_cmdb_findings add column if not exists detail text;
alter table sm_cmdb_findings add column if not exists dedupe_key text;
alter table sm_cmdb_findings add column if not exists auto boolean not null default false;
create unique index if not exists sm_cmdb_findings_no_uk on sm_cmdb_findings (org_id, no);
create index if not exists sm_cmdb_findings_rev_idx on sm_cmdb_findings (org_id, rev);
create index if not exists sm_cmdb_findings_upd_idx on sm_cmdb_findings (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_findings_crt_idx on sm_cmdb_findings (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_findings_state_idx on sm_cmdb_findings (org_id, state) where deleted_at is null;
create index if not exists sm_cmdb_findings_assignment_group_id_idx on sm_cmdb_findings (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_assigned_to_idx on sm_cmdb_findings (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_cmdb_findings_ci_id_idx on sm_cmdb_findings (org_id, ci_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_dedupe_key_idx on sm_cmdb_findings (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_cmdb_findings_workspace_acc_idx on sm_cmdb_findings (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_findings_unit_acc_idx on sm_cmdb_findings (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_findings_domain_acc_idx on sm_cmdb_findings (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_findings_caller_id_idx on sm_cmdb_findings (org_id, caller_id) where deleted_at is null;
create index if not exists sm_cmdb_findings_requested_for_idx on sm_cmdb_findings (org_id, requested_for) where deleted_at is null;
create index if not exists sm_cmdb_findings_opened_by_idx on sm_cmdb_findings (org_id, opened_by) where deleted_at is null;
create index if not exists sm_cmdb_findings_watch_list_gin on sm_cmdb_findings using gin (watch_list);
drop trigger if exists sm_cmdb_findings_sync on sm_cmdb_findings;
create trigger sm_cmdb_findings_sync before insert or update on sm_cmdb_findings for each row execute function sm_sync_touch('cmdb_finding');
alter table sm_cmdb_findings enable row level security;

-- cmdb_health_fact: سلامت روزانهٔ کلاس‌ها
create table if not exists sm_cmdb_health_facts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_health_facts add column if not exists workspace_id uuid;
alter table sm_cmdb_health_facts add column if not exists domain_id uuid;
alter table sm_cmdb_health_facts add column if not exists unit_id uuid;
alter table sm_cmdb_health_facts add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_health_facts add column if not exists created_by uuid;
alter table sm_cmdb_health_facts add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_health_facts add column if not exists updated_by uuid;
alter table sm_cmdb_health_facts add column if not exists rev bigint not null default 0;
alter table sm_cmdb_health_facts add column if not exists version integer not null default 1;
alter table sm_cmdb_health_facts add column if not exists deleted_at timestamptz;
alter table sm_cmdb_health_facts add column if not exists origin text;
alter table sm_cmdb_health_facts add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_health_facts add column if not exists day date;
alter table sm_cmdb_health_facts add column if not exists class text;
alter table sm_cmdb_health_facts add column if not exists total integer;
alter table sm_cmdb_health_facts add column if not exists complete integer;
alter table sm_cmdb_health_facts add column if not exists correct integer;
alter table sm_cmdb_health_facts add column if not exists compliant integer;
alter table sm_cmdb_health_facts add column if not exists stale integer;
alter table sm_cmdb_health_facts add column if not exists duplicates integer;
alter table sm_cmdb_health_facts add column if not exists orphans integer;
alter table sm_cmdb_health_facts add column if not exists no_owner integer;
alter table sm_cmdb_health_facts add column if not exists score integer;
create index if not exists sm_cmdb_health_facts_rev_idx on sm_cmdb_health_facts (org_id, rev);
create index if not exists sm_cmdb_health_facts_upd_idx on sm_cmdb_health_facts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_health_facts_crt_idx on sm_cmdb_health_facts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_health_facts_day_idx on sm_cmdb_health_facts (org_id, day) where deleted_at is null;
create unique index if not exists sm_cmdb_health_facts_day_class_uk on sm_cmdb_health_facts (org_id, day, class) where deleted_at is null;
drop trigger if exists sm_cmdb_health_facts_sync on sm_cmdb_health_facts;
create trigger sm_cmdb_health_facts_sync before insert or update on sm_cmdb_health_facts for each row execute function sm_sync_touch('cmdb_health_fact');
alter table sm_cmdb_health_facts enable row level security;

-- cmdb_import_run: اجراهای ورود داده
create table if not exists sm_cmdb_import_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_import_runs add column if not exists workspace_id uuid;
alter table sm_cmdb_import_runs add column if not exists domain_id uuid;
alter table sm_cmdb_import_runs add column if not exists unit_id uuid;
alter table sm_cmdb_import_runs add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_import_runs add column if not exists created_by uuid;
alter table sm_cmdb_import_runs add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_import_runs add column if not exists updated_by uuid;
alter table sm_cmdb_import_runs add column if not exists rev bigint not null default 0;
alter table sm_cmdb_import_runs add column if not exists version integer not null default 1;
alter table sm_cmdb_import_runs add column if not exists deleted_at timestamptz;
alter table sm_cmdb_import_runs add column if not exists origin text;
alter table sm_cmdb_import_runs add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_import_runs add column if not exists no integer;
alter table sm_cmdb_import_runs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'IMP' || no::text else 'IMP' || lpad(no::text, 6, '0') end) stored;
alter table sm_cmdb_import_runs add column if not exists name text;
alter table sm_cmdb_import_runs add column if not exists source_id uuid;
alter table sm_cmdb_import_runs add column if not exists class text;
alter table sm_cmdb_import_runs add column if not exists dry_run boolean not null default false;
alter table sm_cmdb_import_runs add column if not exists file_name text;
alter table sm_cmdb_import_runs add column if not exists total integer;
alter table sm_cmdb_import_runs add column if not exists created integer;
alter table sm_cmdb_import_runs add column if not exists updated integer;
alter table sm_cmdb_import_runs add column if not exists unchanged integer;
alter table sm_cmdb_import_runs add column if not exists duplicates integer;
alter table sm_cmdb_import_runs add column if not exists failed integer;
alter table sm_cmdb_import_runs add column if not exists started_at timestamptz;
alter table sm_cmdb_import_runs add column if not exists finished_at timestamptz;
alter table sm_cmdb_import_runs add column if not exists results jsonb;
alter table sm_cmdb_import_runs add column if not exists error text;
alter table sm_cmdb_import_runs add column if not exists state text;
create unique index if not exists sm_cmdb_import_runs_no_uk on sm_cmdb_import_runs (org_id, no);
create index if not exists sm_cmdb_import_runs_rev_idx on sm_cmdb_import_runs (org_id, rev);
create index if not exists sm_cmdb_import_runs_upd_idx on sm_cmdb_import_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_import_runs_crt_idx on sm_cmdb_import_runs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_import_runs_state_idx on sm_cmdb_import_runs (org_id, state) where deleted_at is null;
create index if not exists sm_cmdb_import_runs_workspace_acc_idx on sm_cmdb_import_runs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_import_runs_unit_acc_idx on sm_cmdb_import_runs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_import_runs_domain_acc_idx on sm_cmdb_import_runs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_cmdb_import_runs_sync on sm_cmdb_import_runs;
create trigger sm_cmdb_import_runs_sync before insert or update on sm_cmdb_import_runs for each row execute function sm_sync_touch('cmdb_import_run');
alter table sm_cmdb_import_runs enable row level security;

-- cmdb_map: نقشه‌های ذخیره‌شده
create table if not exists sm_cmdb_maps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_maps add column if not exists workspace_id uuid;
alter table sm_cmdb_maps add column if not exists domain_id uuid;
alter table sm_cmdb_maps add column if not exists unit_id uuid;
alter table sm_cmdb_maps add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_maps add column if not exists created_by uuid;
alter table sm_cmdb_maps add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_maps add column if not exists updated_by uuid;
alter table sm_cmdb_maps add column if not exists rev bigint not null default 0;
alter table sm_cmdb_maps add column if not exists version integer not null default 1;
alter table sm_cmdb_maps add column if not exists deleted_at timestamptz;
alter table sm_cmdb_maps add column if not exists origin text;
alter table sm_cmdb_maps add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_maps add column if not exists name text;
alter table sm_cmdb_maps add column if not exists root_ids jsonb;
alter table sm_cmdb_maps add column if not exists depth integer;
alter table sm_cmdb_maps add column if not exists direction text;
alter table sm_cmdb_maps add column if not exists types jsonb;
alter table sm_cmdb_maps add column if not exists classes jsonb;
alter table sm_cmdb_maps add column if not exists layout text;
alter table sm_cmdb_maps add column if not exists shared boolean not null default false;
alter table sm_cmdb_maps add column if not exists owner_id uuid;
alter table sm_cmdb_maps add column if not exists positions jsonb;
alter table sm_cmdb_maps add column if not exists description text;
create index if not exists sm_cmdb_maps_rev_idx on sm_cmdb_maps (org_id, rev);
create index if not exists sm_cmdb_maps_upd_idx on sm_cmdb_maps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_maps_crt_idx on sm_cmdb_maps (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_maps_workspace_acc_idx on sm_cmdb_maps (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_maps_unit_acc_idx on sm_cmdb_maps (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_maps_domain_acc_idx on sm_cmdb_maps (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_maps_owner_id_idx on sm_cmdb_maps (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_cmdb_maps_sync on sm_cmdb_maps;
create trigger sm_cmdb_maps_sync before insert or update on sm_cmdb_maps for each row execute function sm_sync_touch('cmdb_map');
alter table sm_cmdb_maps enable row level security;

-- cmdb_policy: سیاست‌های دادهٔ پیکربندی
create table if not exists sm_cmdb_policies (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_policies add column if not exists workspace_id uuid;
alter table sm_cmdb_policies add column if not exists domain_id uuid;
alter table sm_cmdb_policies add column if not exists unit_id uuid;
alter table sm_cmdb_policies add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_policies add column if not exists created_by uuid;
alter table sm_cmdb_policies add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_policies add column if not exists updated_by uuid;
alter table sm_cmdb_policies add column if not exists rev bigint not null default 0;
alter table sm_cmdb_policies add column if not exists version integer not null default 1;
alter table sm_cmdb_policies add column if not exists deleted_at timestamptz;
alter table sm_cmdb_policies add column if not exists origin text;
alter table sm_cmdb_policies add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_policies add column if not exists name text;
alter table sm_cmdb_policies add column if not exists action text;
alter table sm_cmdb_policies add column if not exists condition jsonb;
alter table sm_cmdb_policies add column if not exists after_days integer;
alter table sm_cmdb_policies add column if not exists max_per_run integer;
alter table sm_cmdb_policies add column if not exists active boolean not null default false;
alter table sm_cmdb_policies add column if not exists last_run_at timestamptz;
alter table sm_cmdb_policies add column if not exists last_affected integer;
alter table sm_cmdb_policies add column if not exists last_skipped integer;
alter table sm_cmdb_policies add column if not exists description text;
create index if not exists sm_cmdb_policies_rev_idx on sm_cmdb_policies (org_id, rev);
create index if not exists sm_cmdb_policies_upd_idx on sm_cmdb_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_policies_crt_idx on sm_cmdb_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_cmdb_policies_sync on sm_cmdb_policies;
create trigger sm_cmdb_policies_sync before insert or update on sm_cmdb_policies for each row execute function sm_sync_touch('cmdb_policy');
alter table sm_cmdb_policies enable row level security;

-- cmdb_query: پرس‌وجوهای پیکربندی
create table if not exists sm_cmdb_queries (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_queries add column if not exists workspace_id uuid;
alter table sm_cmdb_queries add column if not exists domain_id uuid;
alter table sm_cmdb_queries add column if not exists unit_id uuid;
alter table sm_cmdb_queries add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_queries add column if not exists created_by uuid;
alter table sm_cmdb_queries add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_queries add column if not exists updated_by uuid;
alter table sm_cmdb_queries add column if not exists rev bigint not null default 0;
alter table sm_cmdb_queries add column if not exists version integer not null default 1;
alter table sm_cmdb_queries add column if not exists deleted_at timestamptz;
alter table sm_cmdb_queries add column if not exists origin text;
alter table sm_cmdb_queries add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_queries add column if not exists name text;
alter table sm_cmdb_queries add column if not exists class text;
alter table sm_cmdb_queries add column if not exists condition jsonb;
alter table sm_cmdb_queries add column if not exists steps jsonb;
alter table sm_cmdb_queries add column if not exists shared boolean not null default false;
alter table sm_cmdb_queries add column if not exists owner_id uuid;
alter table sm_cmdb_queries add column if not exists text text;
create index if not exists sm_cmdb_queries_rev_idx on sm_cmdb_queries (org_id, rev);
create index if not exists sm_cmdb_queries_upd_idx on sm_cmdb_queries (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_queries_crt_idx on sm_cmdb_queries (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_queries_workspace_acc_idx on sm_cmdb_queries (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cmdb_queries_unit_acc_idx on sm_cmdb_queries (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cmdb_queries_domain_acc_idx on sm_cmdb_queries (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cmdb_queries_owner_id_idx on sm_cmdb_queries (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_cmdb_queries_sync on sm_cmdb_queries;
create trigger sm_cmdb_queries_sync before insert or update on sm_cmdb_queries for each row execute function sm_sync_touch('cmdb_query');
alter table sm_cmdb_queries enable row level security;

-- cmdb_rule: قاعده‌های کیفیت داده و ممیزی
create table if not exists sm_cmdb_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_cmdb_rules add column if not exists workspace_id uuid;
alter table sm_cmdb_rules add column if not exists domain_id uuid;
alter table sm_cmdb_rules add column if not exists unit_id uuid;
alter table sm_cmdb_rules add column if not exists created_at timestamptz not null default now();
alter table sm_cmdb_rules add column if not exists created_by uuid;
alter table sm_cmdb_rules add column if not exists updated_at timestamptz not null default now();
alter table sm_cmdb_rules add column if not exists updated_by uuid;
alter table sm_cmdb_rules add column if not exists rev bigint not null default 0;
alter table sm_cmdb_rules add column if not exists version integer not null default 1;
alter table sm_cmdb_rules add column if not exists deleted_at timestamptz;
alter table sm_cmdb_rules add column if not exists origin text;
alter table sm_cmdb_rules add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_cmdb_rules add column if not exists name text;
alter table sm_cmdb_rules add column if not exists kind text;
alter table sm_cmdb_rules add column if not exists severity text;
alter table sm_cmdb_rules add column if not exists class text;
alter table sm_cmdb_rules add column if not exists category text;
alter table sm_cmdb_rules add column if not exists scope_condition jsonb;
alter table sm_cmdb_rules add column if not exists check_condition jsonb;
alter table sm_cmdb_rules add column if not exists required_rel jsonb;
alter table sm_cmdb_rules add column if not exists creates_findings boolean not null default true;
alter table sm_cmdb_rules add column if not exists due_days integer;
alter table sm_cmdb_rules add column if not exists active boolean not null default true;
alter table sm_cmdb_rules add column if not exists last_run_at timestamptz;
alter table sm_cmdb_rules add column if not exists last_checked integer;
alter table sm_cmdb_rules add column if not exists last_failing integer;
alter table sm_cmdb_rules add column if not exists compliance numeric;
alter table sm_cmdb_rules add column if not exists description text;
create index if not exists sm_cmdb_rules_rev_idx on sm_cmdb_rules (org_id, rev);
create index if not exists sm_cmdb_rules_upd_idx on sm_cmdb_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cmdb_rules_crt_idx on sm_cmdb_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_cmdb_rules_sync on sm_cmdb_rules;
create trigger sm_cmdb_rules_sync before insert or update on sm_cmdb_rules for each row execute function sm_sync_touch('cmdb_rule');
alter table sm_cmdb_rules enable row level security;

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

-- customer_relationship: ارتباط با مشتریان
create table if not exists sm_customer_relationships (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_customer_relationships add column if not exists workspace_id uuid;
alter table sm_customer_relationships add column if not exists domain_id uuid;
alter table sm_customer_relationships add column if not exists unit_id uuid;
alter table sm_customer_relationships add column if not exists created_at timestamptz not null default now();
alter table sm_customer_relationships add column if not exists created_by uuid;
alter table sm_customer_relationships add column if not exists updated_at timestamptz not null default now();
alter table sm_customer_relationships add column if not exists updated_by uuid;
alter table sm_customer_relationships add column if not exists rev bigint not null default 0;
alter table sm_customer_relationships add column if not exists version integer not null default 1;
alter table sm_customer_relationships add column if not exists deleted_at timestamptz;
alter table sm_customer_relationships add column if not exists origin text;
alter table sm_customer_relationships add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_customer_relationships add column if not exists name text;
alter table sm_customer_relationships add column if not exists customer_unit_id uuid;
alter table sm_customer_relationships add column if not exists manager_id uuid;
alter table sm_customer_relationships add column if not exists relationship_type text;
alter table sm_customer_relationships add column if not exists channels text;
alter table sm_customer_relationships add column if not exists expectations text;
alter table sm_customer_relationships add column if not exists opportunities text;
alter table sm_customer_relationships add column if not exists satisfaction integer;
alter table sm_customer_relationships add column if not exists next_review_at date;
alter table sm_customer_relationships add column if not exists active boolean not null default true;
create index if not exists sm_customer_relationships_rev_idx on sm_customer_relationships (org_id, rev);
create index if not exists sm_customer_relationships_upd_idx on sm_customer_relationships (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_relationships_crt_idx on sm_customer_relationships (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_relationships_workspace_acc_idx on sm_customer_relationships (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_relationships_unit_acc_idx on sm_customer_relationships (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_relationships_domain_acc_idx on sm_customer_relationships (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_relationships_manager_id_idx on sm_customer_relationships (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_customer_relationships_sync on sm_customer_relationships;
create trigger sm_customer_relationships_sync before insert or update on sm_customer_relationships for each row execute function sm_sync_touch('customer_relationship');
alter table sm_customer_relationships enable row level security;

-- customer_review: بازبینی‌های با مشتری
create table if not exists sm_customer_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_customer_reviews add column if not exists workspace_id uuid;
alter table sm_customer_reviews add column if not exists domain_id uuid;
alter table sm_customer_reviews add column if not exists unit_id uuid;
alter table sm_customer_reviews add column if not exists created_at timestamptz not null default now();
alter table sm_customer_reviews add column if not exists created_by uuid;
alter table sm_customer_reviews add column if not exists updated_at timestamptz not null default now();
alter table sm_customer_reviews add column if not exists updated_by uuid;
alter table sm_customer_reviews add column if not exists rev bigint not null default 0;
alter table sm_customer_reviews add column if not exists version integer not null default 1;
alter table sm_customer_reviews add column if not exists deleted_at timestamptz;
alter table sm_customer_reviews add column if not exists origin text;
alter table sm_customer_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_customer_reviews add column if not exists no integer;
alter table sm_customer_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CRV' || no::text else 'CRV' || lpad(no::text, 5, '0') end) stored;
alter table sm_customer_reviews add column if not exists title text;
alter table sm_customer_reviews add column if not exists relationship_id uuid;
alter table sm_customer_reviews add column if not exists held_at timestamptz;
alter table sm_customer_reviews add column if not exists manager_id uuid;
alter table sm_customer_reviews add column if not exists attendees jsonb;
alter table sm_customer_reviews add column if not exists minutes text;
alter table sm_customer_reviews add column if not exists actions text;
alter table sm_customer_reviews add column if not exists agreement_changes text;
alter table sm_customer_reviews add column if not exists satisfaction integer;
alter table sm_customer_reviews add column if not exists state text;
create unique index if not exists sm_customer_reviews_no_uk on sm_customer_reviews (org_id, no);
create index if not exists sm_customer_reviews_rev_idx on sm_customer_reviews (org_id, rev);
create index if not exists sm_customer_reviews_upd_idx on sm_customer_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_reviews_crt_idx on sm_customer_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_customer_reviews_relationship_id_idx on sm_customer_reviews (org_id, relationship_id) where deleted_at is null;
create index if not exists sm_customer_reviews_state_idx on sm_customer_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_customer_reviews_workspace_acc_idx on sm_customer_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_customer_reviews_unit_acc_idx on sm_customer_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_customer_reviews_domain_acc_idx on sm_customer_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_customer_reviews_manager_id_idx on sm_customer_reviews (org_id, manager_id) where deleted_at is null;
create index if not exists sm_customer_reviews_attendees_gin on sm_customer_reviews using gin (attendees);
drop trigger if exists sm_customer_reviews_sync on sm_customer_reviews;
create trigger sm_customer_reviews_sync before insert or update on sm_customer_reviews for each row execute function sm_sync_touch('customer_review');
alter table sm_customer_reviews enable row level security;

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

-- discovery_collector: جمع‌آورنده‌های کشف
create table if not exists sm_discovery_collectors (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
alter table sm_discovery_collectors add column if not exists workspace_id uuid;
alter table sm_discovery_collectors add column if not exists domain_id uuid;
alter table sm_discovery_collectors add column if not exists unit_id uuid;
alter table sm_discovery_collectors add column if not exists created_at timestamptz not null default now();
alter table sm_discovery_collectors add column if not exists created_by uuid;
alter table sm_discovery_collectors add column if not exists updated_at timestamptz not null default now();
alter table sm_discovery_collectors add column if not exists updated_by uuid;
alter table sm_discovery_collectors add column if not exists rev bigint not null default 0;
alter table sm_discovery_collectors add column if not exists version integer not null default 1;
alter table sm_discovery_collectors add column if not exists deleted_at timestamptz;
alter table sm_discovery_collectors add column if not exists origin text;
alter table sm_discovery_collectors add column if not exists custom jsonb not null default '{}'::jsonb;
alter table sm_discovery_collectors add column if not exists name text;
alter table sm_discovery_collectors add column if not exists kind text;
alter table sm_discovery_collectors add column if not exists machine_id text;
alter table sm_discovery_collectors add column if not exists hostname text;
alter table sm_discovery_collectors add column if not exists platform text;
alter table sm_discovery_collectors add column if not exists agent_version text;
alter table sm_discovery_collectors add column if not exists active boolean not null default true;
alter table sm_discovery_collectors add column if not exists every_hours integer;
alter table sm_discovery_collectors add column if not exists include_software boolean not null default false;
alter table sm_discovery_collectors add column if not exists ci_id uuid;
alter table sm_discovery_collectors add column if not exists source_id uuid;
alter table sm_discovery_collectors add column if not exists last_heartbeat timestamptz;
alter table sm_discovery_collectors add column if not exists last_run_at timestamptz;
alter table sm_discovery_collectors add column if not exists last_result text;
create index if not exists sm_discovery_collectors_rev_idx on sm_discovery_collectors (org_id, rev);
create index if not exists sm_discovery_collectors_upd_idx on sm_discovery_collectors (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_discovery_collectors_crt_idx on sm_discovery_collectors (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_discovery_collectors_machine_id_idx on sm_discovery_collectors (org_id, machine_id) where deleted_at is null;
drop trigger if exists sm_discovery_collectors_sync on sm_discovery_collectors;
create trigger sm_discovery_collectors_sync before insert or update on sm_discovery_collectors for each row execute function sm_sync_touch('discovery_collector');
alter table sm_discovery_collectors enable row level security;

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
alter table sm_kb_acks add column if not exists k_users jsonb;
alter table sm_kb_acks add column if not exists k_groups jsonb;
create index if not exists sm_kb_acks_rev_idx on sm_kb_acks (org_id, rev);
create index if not exists sm_kb_acks_upd_idx on sm_kb_acks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_acks_crt_idx on sm_kb_acks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_acks_attestation_id_idx on sm_kb_acks (org_id, attestation_id) where deleted_at is null;
create index if not exists sm_kb_acks_article_id_idx on sm_kb_acks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_acks_user_id_idx on sm_kb_acks (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_acks_k_users_gin on sm_kb_acks using gin (k_users);
create index if not exists sm_kb_acks_k_groups_gin on sm_kb_acks using gin (k_groups);
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
alter table sm_kb_articles add column if not exists k_users jsonb;
alter table sm_kb_articles add column if not exists k_groups jsonb;
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
create index if not exists sm_kb_articles_k_users_gin on sm_kb_articles using gin (k_users);
create index if not exists sm_kb_articles_k_groups_gin on sm_kb_articles using gin (k_groups);
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
alter table sm_kb_attestations add column if not exists k_users jsonb;
alter table sm_kb_attestations add column if not exists k_groups jsonb;
alter table sm_kb_attestations add column if not exists state text;
create unique index if not exists sm_kb_attestations_no_uk on sm_kb_attestations (org_id, no);
create index if not exists sm_kb_attestations_rev_idx on sm_kb_attestations (org_id, rev);
create index if not exists sm_kb_attestations_upd_idx on sm_kb_attestations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_crt_idx on sm_kb_attestations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_article_id_idx on sm_kb_attestations (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_attestations_owner_id_idx on sm_kb_attestations (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_attestations_k_users_gin on sm_kb_attestations using gin (k_users);
create index if not exists sm_kb_attestations_k_groups_gin on sm_kb_attestations using gin (k_groups);
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
alter table sm_kb_categories add column if not exists k_users jsonb;
alter table sm_kb_categories add column if not exists k_groups jsonb;
alter table sm_kb_categories add column if not exists state text;
create index if not exists sm_kb_categories_rev_idx on sm_kb_categories (org_id, rev);
create index if not exists sm_kb_categories_upd_idx on sm_kb_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_crt_idx on sm_kb_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_base_id_idx on sm_kb_categories (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_categories_parent_id_idx on sm_kb_categories (org_id, parent_id) where deleted_at is null;
create index if not exists sm_kb_categories_m_groups_gin on sm_kb_categories using gin (m_groups);
create index if not exists sm_kb_categories_k_users_gin on sm_kb_categories using gin (k_users);
create index if not exists sm_kb_categories_k_groups_gin on sm_kb_categories using gin (k_groups);
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
alter table sm_kb_decision_trees add column if not exists k_users jsonb;
alter table sm_kb_decision_trees add column if not exists k_groups jsonb;
alter table sm_kb_decision_trees add column if not exists access_list jsonb;
alter table sm_kb_decision_trees add column if not exists state text;
create unique index if not exists sm_kb_decision_trees_no_uk on sm_kb_decision_trees (org_id, no);
create index if not exists sm_kb_decision_trees_rev_idx on sm_kb_decision_trees (org_id, rev);
create index if not exists sm_kb_decision_trees_upd_idx on sm_kb_decision_trees (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_crt_idx on sm_kb_decision_trees (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_k_users_gin on sm_kb_decision_trees using gin (k_users);
create index if not exists sm_kb_decision_trees_k_groups_gin on sm_kb_decision_trees using gin (k_groups);
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
alter table sm_kb_feedback add column if not exists k_users jsonb;
alter table sm_kb_feedback add column if not exists k_groups jsonb;
create index if not exists sm_kb_feedback_rev_idx on sm_kb_feedback (org_id, rev);
create index if not exists sm_kb_feedback_upd_idx on sm_kb_feedback (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_crt_idx on sm_kb_feedback (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_article_id_idx on sm_kb_feedback (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_feedback_user_id_idx on sm_kb_feedback (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_feedback_k_users_gin on sm_kb_feedback using gin (k_users);
create index if not exists sm_kb_feedback_k_groups_gin on sm_kb_feedback using gin (k_groups);
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
alter table sm_kb_snippets add column if not exists k_users jsonb;
alter table sm_kb_snippets add column if not exists k_groups jsonb;
alter table sm_kb_snippets add column if not exists access_list jsonb;
alter table sm_kb_snippets add column if not exists state text;
create unique index if not exists sm_kb_snippets_no_uk on sm_kb_snippets (org_id, no);
create index if not exists sm_kb_snippets_rev_idx on sm_kb_snippets (org_id, rev);
create index if not exists sm_kb_snippets_upd_idx on sm_kb_snippets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_crt_idx on sm_kb_snippets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_base_id_idx on sm_kb_snippets (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_snippets_owner_id_idx on sm_kb_snippets (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_snippets_k_users_gin on sm_kb_snippets using gin (k_users);
create index if not exists sm_kb_snippets_k_groups_gin on sm_kb_snippets using gin (k_groups);
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
alter table sm_kb_tasks add column if not exists k_users jsonb;
alter table sm_kb_tasks add column if not exists k_groups jsonb;
create unique index if not exists sm_kb_tasks_no_uk on sm_kb_tasks (org_id, no);
create index if not exists sm_kb_tasks_rev_idx on sm_kb_tasks (org_id, rev);
create index if not exists sm_kb_tasks_upd_idx on sm_kb_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_crt_idx on sm_kb_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_state_idx on sm_kb_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_kb_tasks_assignment_group_id_idx on sm_kb_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_kb_tasks_assigned_to_idx on sm_kb_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_kb_tasks_article_id_idx on sm_kb_tasks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_tasks_source_id_idx on sm_kb_tasks (org_id, source_id) where deleted_at is null;
create index if not exists sm_kb_tasks_k_users_gin on sm_kb_tasks using gin (k_users);
create index if not exists sm_kb_tasks_k_groups_gin on sm_kb_tasks using gin (k_groups);
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
alter table sm_kb_versions add column if not exists k_users jsonb;
alter table sm_kb_versions add column if not exists k_groups jsonb;
alter table sm_kb_versions add column if not exists state text;
create index if not exists sm_kb_versions_rev_idx on sm_kb_versions (org_id, rev);
create index if not exists sm_kb_versions_upd_idx on sm_kb_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_crt_idx on sm_kb_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_article_id_idx on sm_kb_versions (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_versions_author_id_idx on sm_kb_versions (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_versions_reviewer_ids_gin on sm_kb_versions using gin (reviewer_ids);
create index if not exists sm_kb_versions_k_users_gin on sm_kb_versions using gin (k_users);
create index if not exists sm_kb_versions_k_groups_gin on sm_kb_versions using gin (k_groups);
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

-- portfolio_node: شاخه‌های سبد خدمات
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_portfolio_nodes_rev_idx on sm_portfolio_nodes (org_id, rev);
create index if not exists sm_portfolio_nodes_upd_idx on sm_portfolio_nodes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolio_nodes_crt_idx on sm_portfolio_nodes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolio_nodes_parent_id_idx on sm_portfolio_nodes (org_id, parent_id) where deleted_at is null;
create index if not exists sm_portfolio_nodes_path_idx on sm_portfolio_nodes (org_id, path) where deleted_at is null;
drop trigger if exists sm_portfolio_nodes_sync on sm_portfolio_nodes;
create trigger sm_portfolio_nodes_sync before insert or update on sm_portfolio_nodes for each row execute function sm_sync_touch('portfolio_node');
alter table sm_portfolio_nodes enable row level security;

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
alter table sm_requests add column if not exists fulfillers jsonb;
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
alter table sm_request_tasks add column if not exists revocation boolean not null default false;
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

-- service: خدمت‌ها
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_services enable row level security;

-- service_agreement: توافق‌های مشتری
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
  custom jsonb not null default '{}'::jsonb
);
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
create unique index if not exists sm_service_agreements_no_uk on sm_service_agreements (org_id, no);
create index if not exists sm_service_agreements_rev_idx on sm_service_agreements (org_id, rev);
create index if not exists sm_service_agreements_upd_idx on sm_service_agreements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_agreements_crt_idx on sm_service_agreements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_agreements_service_id_idx on sm_service_agreements (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_agreements_workspace_acc_idx on sm_service_agreements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_agreements_unit_acc_idx on sm_service_agreements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_agreements_domain_acc_idx on sm_service_agreements (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_agreements_manager_id_idx on sm_service_agreements (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_service_agreements_sync on sm_service_agreements;
create trigger sm_service_agreements_sync before insert or update on sm_service_agreements for each row execute function sm_sync_touch('service_agreement');
alter table sm_service_agreements enable row level security;

-- service_commitment: تعهدهای خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_service_commitments enable row level security;

-- service_config: تنظیمات سبد خدمات
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_service_configs_rev_idx on sm_service_configs (org_id, rev);
create index if not exists sm_service_configs_upd_idx on sm_service_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_configs_crt_idx on sm_service_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_service_configs_config_key_uk on sm_service_configs (org_id, config_key) where deleted_at is null;
create index if not exists sm_service_configs_status_page_token_idx on sm_service_configs (org_id, status_page_token) where deleted_at is null;
drop trigger if exists sm_service_configs_sync on sm_service_configs;
create trigger sm_service_configs_sync before insert or update on sm_service_configs for each row execute function sm_sync_touch('service_config');
alter table sm_service_configs enable row level security;

-- service_design_package: بسته‌های طراحی و گذار
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_service_design_packages enable row level security;

-- service_instance: نمونه‌های استقرار خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_service_instances_rev_idx on sm_service_instances (org_id, rev);
create index if not exists sm_service_instances_upd_idx on sm_service_instances (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_instances_crt_idx on sm_service_instances (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_instances_service_id_idx on sm_service_instances (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_instances_workspace_acc_idx on sm_service_instances (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_instances_unit_acc_idx on sm_service_instances (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_instances_domain_acc_idx on sm_service_instances (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_instances_owner_id_idx on sm_service_instances (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_service_instances_sync on sm_service_instances;
create trigger sm_service_instances_sync before insert or update on sm_service_instances for each row execute function sm_sync_touch('service_instance');
alter table sm_service_instances enable row level security;

-- service_offering: گزینه‌های خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_service_offerings enable row level security;

-- service_proposal: پیشنهادهای خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_service_proposals enable row level security;

-- service_score_fact: امتیازهای روزانهٔ خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_service_score_facts_rev_idx on sm_service_score_facts (org_id, rev);
create index if not exists sm_service_score_facts_upd_idx on sm_service_score_facts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_score_facts_crt_idx on sm_service_score_facts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_score_facts_day_idx on sm_service_score_facts (org_id, day) where deleted_at is null;
create index if not exists sm_service_score_facts_service_id_idx on sm_service_score_facts (org_id, service_id) where deleted_at is null;
create unique index if not exists sm_service_score_facts_day_service_id_uk on sm_service_score_facts (org_id, day, service_id) where deleted_at is null;
drop trigger if exists sm_service_score_facts_sync on sm_service_score_facts;
create trigger sm_service_score_facts_sync before insert or update on sm_service_score_facts for each row execute function sm_sync_touch('service_score_fact');
alter table sm_service_score_facts enable row level security;

-- service_subscription: اشتراک‌های اطلاع‌رسانی خدمت
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
  custom jsonb not null default '{}'::jsonb
);
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
alter table sm_service_subscriptions enable row level security;

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

-- technology_standard: استانداردهای فناوری
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
  custom jsonb not null default '{}'::jsonb
);
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
create index if not exists sm_technology_standards_rev_idx on sm_technology_standards (org_id, rev);
create index if not exists sm_technology_standards_upd_idx on sm_technology_standards (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_technology_standards_crt_idx on sm_technology_standards (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_technology_standards_sync on sm_technology_standards;
create trigger sm_technology_standards_sync before insert or update on sm_technology_standards for each row execute function sm_sync_touch('technology_standard');
alter table sm_technology_standards enable row level security;

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

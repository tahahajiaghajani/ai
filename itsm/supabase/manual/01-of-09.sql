-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۱ از ۹ (0001_core … 0006_engine_tables:3/28)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 1/28 (e746bd22eb04)
create or replace function sm_demo_capture() returns trigger language plpgsql as $demo$
begin
  insert into sm_demo_rows (org_id, row_id, tbl) values (new.org_id, new.id, tg_table_name) on conflict do nothing;
  return null;
end
$demo$;

create or replace function sm_demo_touch() returns trigger language plpgsql as $demo$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
begin
  if exists (select 1 from sm_demo_rows d where d.org_id = old.org_id and d.row_id = old.id) then
    return null;
  end if;
  insert into sm_demo_touched (org_id, row_id, tbl, before, after, conflict, at)
  values (old.org_id, old.id, tg_table_name, v_old, v_new, false, now())
  on conflict (org_id, row_id) do update
     set after = excluded.after,
         -- something outside the demo scope changed the row between two demo writes: never put it back blindly
         conflict = sm_demo_touched.conflict or sm_demo_touched.after is null
           or (sm_demo_touched.after - 'rev' - 'updated_at') <> (v_old - 'rev' - 'updated_at'),
         at = now();
  return null;
end
$demo$;

do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin
      create extension pg_trgm;
    exception when others then
      raise notice 'pg_trgm not installed: %', sqlerrm;
    end;
  end if;
end
$ext$;

-- account_health: سلامت روزانهٔ حساب‌ها
do $cols$
begin
  if to_regclass('sm_account_health') is not null then
    alter table sm_account_health add column if not exists workspace_id uuid;
    alter table sm_account_health add column if not exists domain_id uuid;
    alter table sm_account_health add column if not exists unit_id uuid;
    alter table sm_account_health add column if not exists created_at timestamptz not null default now();
    alter table sm_account_health add column if not exists created_by uuid;
    alter table sm_account_health add column if not exists updated_at timestamptz not null default now();
    alter table sm_account_health add column if not exists updated_by uuid;
    alter table sm_account_health add column if not exists rev bigint not null default 0;
    alter table sm_account_health add column if not exists version integer not null default 1;
    alter table sm_account_health add column if not exists deleted_at timestamptz;
    alter table sm_account_health add column if not exists origin text;
    alter table sm_account_health add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_account_health add column if not exists account_id uuid;
    alter table sm_account_health add column if not exists day date;
    alter table sm_account_health add column if not exists score integer;
    alter table sm_account_health add column if not exists status text;
    alter table sm_account_health add column if not exists csat numeric;
    alter table sm_account_health add column if not exists sla_attainment numeric;
    alter table sm_account_health add column if not exists open_cases integer;
    alter table sm_account_health add column if not exists escalations integer;
    alter table sm_account_health add column if not exists complaints integer;
    alter table sm_account_health add column if not exists factors jsonb;
    alter table sm_account_health add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_account_health (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  account_id uuid,
  day date,
  score integer,
  status text,
  csat numeric,
  sla_attainment numeric,
  open_cases integer,
  escalations integer,
  complaints integer,
  factors jsonb,
  support_group_id uuid
);
create index if not exists sm_account_health_rev_idx on sm_account_health (org_id, rev);
create index if not exists sm_account_health_upd_idx on sm_account_health (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_health_crt_idx on sm_account_health (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_health_account_id_idx on sm_account_health (org_id, account_id) where deleted_at is null;
create index if not exists sm_account_health_support_group_id_idx on sm_account_health (org_id, support_group_id) where deleted_at is null;
create unique index if not exists sm_account_health_account_id_day_uk on sm_account_health (org_id, account_id, day) where deleted_at is null;
create index if not exists sm_account_health_workspace_acc_idx on sm_account_health (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_account_health_unit_acc_idx on sm_account_health (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_account_health_domain_acc_idx on sm_account_health (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_account_health_sync on sm_account_health;
create trigger sm_account_health_sync before insert or update on sm_account_health for each row execute function sm_sync_touch('account_health');
create or replace trigger sm_account_health_demo after insert on sm_account_health for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_account_health_demo_t after update or delete on sm_account_health for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_account_health enable row level security;

-- account_plan: برنامه‌های حساب
do $cols$
begin
  if to_regclass('sm_account_plans') is not null then
    alter table sm_account_plans add column if not exists workspace_id uuid;
    alter table sm_account_plans add column if not exists domain_id uuid;
    alter table sm_account_plans add column if not exists unit_id uuid;
    alter table sm_account_plans add column if not exists created_at timestamptz not null default now();
    alter table sm_account_plans add column if not exists created_by uuid;
    alter table sm_account_plans add column if not exists updated_at timestamptz not null default now();
    alter table sm_account_plans add column if not exists updated_by uuid;
    alter table sm_account_plans add column if not exists rev bigint not null default 0;
    alter table sm_account_plans add column if not exists version integer not null default 1;
    alter table sm_account_plans add column if not exists deleted_at timestamptz;
    alter table sm_account_plans add column if not exists origin text;
    alter table sm_account_plans add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_account_plans add column if not exists name text;
    alter table sm_account_plans add column if not exists account_id uuid;
    alter table sm_account_plans add column if not exists period text;
    alter table sm_account_plans add column if not exists status text;
    alter table sm_account_plans add column if not exists review_cadence text;
    alter table sm_account_plans add column if not exists next_review date;
    alter table sm_account_plans add column if not exists owner_id uuid;
    alter table sm_account_plans add column if not exists objectives text;
    alter table sm_account_plans add column if not exists initiatives text;
    alter table sm_account_plans add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_account_plans (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  account_id uuid,
  period text,
  status text,
  review_cadence text,
  next_review date,
  owner_id uuid,
  objectives text,
  initiatives text,
  support_group_id uuid
);
create index if not exists sm_account_plans_rev_idx on sm_account_plans (org_id, rev);
create index if not exists sm_account_plans_upd_idx on sm_account_plans (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_plans_crt_idx on sm_account_plans (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_plans_account_id_idx on sm_account_plans (org_id, account_id) where deleted_at is null;
create index if not exists sm_account_plans_owner_id_idx on sm_account_plans (org_id, owner_id) where deleted_at is null;
create index if not exists sm_account_plans_support_group_id_idx on sm_account_plans (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_account_plans_workspace_acc_idx on sm_account_plans (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_account_plans_unit_acc_idx on sm_account_plans (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_account_plans_domain_acc_idx on sm_account_plans (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_account_plans_sync on sm_account_plans;
create trigger sm_account_plans_sync before insert or update on sm_account_plans for each row execute function sm_sync_touch('account_plan');
create or replace trigger sm_account_plans_demo after insert on sm_account_plans for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_account_plans_demo_t after update or delete on sm_account_plans for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_account_plans enable row level security;

-- account_review: بازبینی‌های خدمت (فصلی)
do $cols$
begin
  if to_regclass('sm_account_reviews') is not null then
    alter table sm_account_reviews add column if not exists workspace_id uuid;
    alter table sm_account_reviews add column if not exists domain_id uuid;
    alter table sm_account_reviews add column if not exists unit_id uuid;
    alter table sm_account_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_account_reviews add column if not exists created_by uuid;
    alter table sm_account_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_account_reviews add column if not exists updated_by uuid;
    alter table sm_account_reviews add column if not exists rev bigint not null default 0;
    alter table sm_account_reviews add column if not exists version integer not null default 1;
    alter table sm_account_reviews add column if not exists deleted_at timestamptz;
    alter table sm_account_reviews add column if not exists origin text;
    alter table sm_account_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_account_reviews add column if not exists no integer;
    alter table sm_account_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'QBR' || no::text else 'QBR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_account_reviews add column if not exists title text;
    alter table sm_account_reviews add column if not exists account_id uuid;
    alter table sm_account_reviews add column if not exists period_from date;
    alter table sm_account_reviews add column if not exists period_to date;
    alter table sm_account_reviews add column if not exists held_at timestamptz;
    alter table sm_account_reviews add column if not exists owner_id uuid;
    alter table sm_account_reviews add column if not exists attendees jsonb;
    alter table sm_account_reviews add column if not exists pack jsonb;
    alter table sm_account_reviews add column if not exists pack_at timestamptz;
    alter table sm_account_reviews add column if not exists narrative text;
    alter table sm_account_reviews add column if not exists actions text;
    alter table sm_account_reviews add column if not exists support_group_id uuid;
    alter table sm_account_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_account_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  title text,
  account_id uuid,
  period_from date,
  period_to date,
  held_at timestamptz,
  owner_id uuid,
  attendees jsonb,
  pack jsonb,
  pack_at timestamptz,
  narrative text,
  actions text,
  support_group_id uuid,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_account_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_account_reviews_search_cae18f1d_trgm', 'sm_account_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_account_reviews_search_custom_trgm', 'sm_account_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_account_reviews_no_uk on sm_account_reviews (org_id, no);
create index if not exists sm_account_reviews_rev_idx on sm_account_reviews (org_id, rev);
create index if not exists sm_account_reviews_upd_idx on sm_account_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_reviews_crt_idx on sm_account_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_reviews_account_id_idx on sm_account_reviews (org_id, account_id) where deleted_at is null;
create index if not exists sm_account_reviews_owner_id_idx on sm_account_reviews (org_id, owner_id) where deleted_at is null;
create index if not exists sm_account_reviews_support_group_id_idx on sm_account_reviews (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_account_reviews_state_idx on sm_account_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_account_reviews_workspace_acc_idx on sm_account_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_account_reviews_unit_acc_idx on sm_account_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_account_reviews_domain_acc_idx on sm_account_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_account_reviews_sync on sm_account_reviews;
create trigger sm_account_reviews_sync before insert or update on sm_account_reviews for each row execute function sm_sync_touch('account_review');
create or replace trigger sm_account_reviews_demo after insert on sm_account_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_account_reviews_demo_t after update or delete on sm_account_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_account_reviews enable row level security;

-- account_stakeholder: نقشهٔ ذی‌نفعان
do $cols$
begin
  if to_regclass('sm_account_stakeholders') is not null then
    alter table sm_account_stakeholders add column if not exists workspace_id uuid;
    alter table sm_account_stakeholders add column if not exists domain_id uuid;
    alter table sm_account_stakeholders add column if not exists unit_id uuid;
    alter table sm_account_stakeholders add column if not exists created_at timestamptz not null default now();
    alter table sm_account_stakeholders add column if not exists created_by uuid;
    alter table sm_account_stakeholders add column if not exists updated_at timestamptz not null default now();
    alter table sm_account_stakeholders add column if not exists updated_by uuid;
    alter table sm_account_stakeholders add column if not exists rev bigint not null default 0;
    alter table sm_account_stakeholders add column if not exists version integer not null default 1;
    alter table sm_account_stakeholders add column if not exists deleted_at timestamptz;
    alter table sm_account_stakeholders add column if not exists origin text;
    alter table sm_account_stakeholders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_account_stakeholders add column if not exists name text;
    alter table sm_account_stakeholders add column if not exists account_id uuid;
    alter table sm_account_stakeholders add column if not exists contact_id uuid;
    alter table sm_account_stakeholders add column if not exists role_title text;
    alter table sm_account_stakeholders add column if not exists influence integer;
    alter table sm_account_stakeholders add column if not exists interest integer;
    alter table sm_account_stakeholders add column if not exists attitude text;
    alter table sm_account_stakeholders add column if not exists owner_id uuid;
    alter table sm_account_stakeholders add column if not exists notes text;
    alter table sm_account_stakeholders add column if not exists support_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_account_stakeholders (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  account_id uuid,
  contact_id uuid,
  role_title text,
  influence integer,
  interest integer,
  attitude text,
  owner_id uuid,
  notes text,
  support_group_id uuid
);
create index if not exists sm_account_stakeholders_rev_idx on sm_account_stakeholders (org_id, rev);
create index if not exists sm_account_stakeholders_upd_idx on sm_account_stakeholders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_stakeholders_crt_idx on sm_account_stakeholders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_account_stakeholders_account_id_idx on sm_account_stakeholders (org_id, account_id) where deleted_at is null;
create index if not exists sm_account_stakeholders_support_group_id_idx on sm_account_stakeholders (org_id, support_group_id) where deleted_at is null;
create index if not exists sm_account_stakeholders_workspace_acc_idx on sm_account_stakeholders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_account_stakeholders_unit_acc_idx on sm_account_stakeholders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_account_stakeholders_domain_acc_idx on sm_account_stakeholders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_account_stakeholders_owner_id_idx on sm_account_stakeholders (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_account_stakeholders_sync on sm_account_stakeholders;
create trigger sm_account_stakeholders_sync before insert or update on sm_account_stakeholders for each row execute function sm_sync_touch('account_stakeholder');
create or replace trigger sm_account_stakeholders_demo after insert on sm_account_stakeholders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_account_stakeholders_demo_t after update or delete on sm_account_stakeholders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_account_stakeholders enable row level security;

-- admin_config: تنظیمات کنسول مدیریت
do $cols$
begin
  if to_regclass('sm_admin_config') is not null then
    alter table sm_admin_config add column if not exists workspace_id uuid;
    alter table sm_admin_config add column if not exists domain_id uuid;
    alter table sm_admin_config add column if not exists unit_id uuid;
    alter table sm_admin_config add column if not exists created_at timestamptz not null default now();
    alter table sm_admin_config add column if not exists created_by uuid;
    alter table sm_admin_config add column if not exists updated_at timestamptz not null default now();
    alter table sm_admin_config add column if not exists updated_by uuid;
    alter table sm_admin_config add column if not exists rev bigint not null default 0;
    alter table sm_admin_config add column if not exists version integer not null default 1;
    alter table sm_admin_config add column if not exists deleted_at timestamptz;
    alter table sm_admin_config add column if not exists origin text;
    alter table sm_admin_config add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_admin_config add column if not exists key text;
    alter table sm_admin_config add column if not exists seeded integer;
    alter table sm_admin_config add column if not exists onboarding jsonb;
    alter table sm_admin_config add column if not exists flags jsonb;
  end if;
end
$cols$;
create table if not exists sm_admin_config (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  seeded integer,
  onboarding jsonb,
  flags jsonb
);
create index if not exists sm_admin_config_rev_idx on sm_admin_config (org_id, rev);
create index if not exists sm_admin_config_upd_idx on sm_admin_config (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_admin_config_crt_idx on sm_admin_config (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_admin_config_key_uk on sm_admin_config (org_id, key) where deleted_at is null;
drop trigger if exists sm_admin_config_sync on sm_admin_config;
create trigger sm_admin_config_sync before insert or update on sm_admin_config for each row execute function sm_sync_touch('admin_config');
create or replace trigger sm_admin_config_demo after insert on sm_admin_config for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_admin_config_demo_t after update or delete on sm_admin_config for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_admin_config enable row level security;

-- ai_agent: عامل‌های هوش مصنوعی
do $cols$
begin
  if to_regclass('sm_ai_agents') is not null then
    alter table sm_ai_agents add column if not exists workspace_id uuid;
    alter table sm_ai_agents add column if not exists domain_id uuid;
    alter table sm_ai_agents add column if not exists unit_id uuid;
    alter table sm_ai_agents add column if not exists created_at timestamptz not null default now();
    alter table sm_ai_agents add column if not exists created_by uuid;
    alter table sm_ai_agents add column if not exists updated_at timestamptz not null default now();
    alter table sm_ai_agents add column if not exists updated_by uuid;
    alter table sm_ai_agents add column if not exists rev bigint not null default 0;
    alter table sm_ai_agents add column if not exists version integer not null default 1;
    alter table sm_ai_agents add column if not exists deleted_at timestamptz;
    alter table sm_ai_agents add column if not exists origin text;
    alter table sm_ai_agents add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ai_agents add column if not exists key text;
    alter table sm_ai_agents add column if not exists name text;
    alter table sm_ai_agents add column if not exists description text;
    alter table sm_ai_agents add column if not exists module text;
    alter table sm_ai_agents add column if not exists base_key text;
    alter table sm_ai_agents add column if not exists builtin boolean not null default false;
    alter table sm_ai_agents add column if not exists enabled boolean not null default false;
    alter table sm_ai_agents add column if not exists goal text;
    alter table sm_ai_agents add column if not exists tables jsonb;
    alter table sm_ai_agents add column if not exists triggers jsonb;
    alter table sm_ai_agents add column if not exists events jsonb;
    alter table sm_ai_agents add column if not exists condition jsonb;
    alter table sm_ai_agents add column if not exists schedule_minutes integer;
    alter table sm_ai_agents add column if not exists schedule_filter jsonb;
    alter table sm_ai_agents add column if not exists tools jsonb;
    alter table sm_ai_agents add column if not exists autonomy text;
    alter table sm_ai_agents add column if not exists auto_actions jsonb;
    alter table sm_ai_agents add column if not exists approvers jsonb;
    alter table sm_ai_agents add column if not exists approver_group_id uuid;
    alter table sm_ai_agents add column if not exists tier text;
    alter table sm_ai_agents add column if not exists max_steps integer;
    alter table sm_ai_agents add column if not exists max_tokens integer;
    alter table sm_ai_agents add column if not exists max_actions integer;
    alter table sm_ai_agents add column if not exists daily_runs integer;
    alter table sm_ai_agents add column if not exists forbidden_tables jsonb;
    alter table sm_ai_agents add column if not exists forbidden_fields jsonb;
    alter table sm_ai_agents add column if not exists forbidden_states jsonb;
    alter table sm_ai_agents add column if not exists roles jsonb;
    alter table sm_ai_agents add column if not exists field_groups jsonb;
    alter table sm_ai_agents add column if not exists principal_id uuid;
    alter table sm_ai_agents add column if not exists last_scheduled_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_ai_agents (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  module text,
  base_key text,
  builtin boolean not null default false,
  enabled boolean not null default false,
  goal text,
  tables jsonb,
  triggers jsonb,
  events jsonb,
  condition jsonb,
  schedule_minutes integer,
  schedule_filter jsonb,
  tools jsonb,
  autonomy text,
  auto_actions jsonb,
  approvers jsonb,
  approver_group_id uuid,
  tier text,
  max_steps integer,
  max_tokens integer,
  max_actions integer,
  daily_runs integer,
  forbidden_tables jsonb,
  forbidden_fields jsonb,
  forbidden_states jsonb,
  roles jsonb,
  field_groups jsonb,
  principal_id uuid,
  last_scheduled_at timestamptz
);
create index if not exists sm_ai_agents_rev_idx on sm_ai_agents (org_id, rev);
create index if not exists sm_ai_agents_upd_idx on sm_ai_agents (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_agents_crt_idx on sm_ai_agents (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ai_agents_key_uk on sm_ai_agents (org_id, key) where deleted_at is null;
drop trigger if exists sm_ai_agents_sync on sm_ai_agents;
create trigger sm_ai_agents_sync before insert or update on sm_ai_agents for each row execute function sm_sync_touch('ai_agent');
create or replace trigger sm_ai_agents_demo after insert on sm_ai_agents for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_agents_demo_t after update or delete on sm_ai_agents for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_agents enable row level security;

-- ai_agent_run: اجراهای عامل
do $cols$
begin
  if to_regclass('sm_ai_agent_runs') is not null then
    alter table sm_ai_agent_runs add column if not exists workspace_id uuid;
    alter table sm_ai_agent_runs add column if not exists domain_id uuid;
    alter table sm_ai_agent_runs add column if not exists unit_id uuid;
    alter table sm_ai_agent_runs add column if not exists created_at timestamptz not null default now();
    alter table sm_ai_agent_runs add column if not exists created_by uuid;
    alter table sm_ai_agent_runs add column if not exists updated_at timestamptz not null default now();
    alter table sm_ai_agent_runs add column if not exists updated_by uuid;
    alter table sm_ai_agent_runs add column if not exists rev bigint not null default 0;
    alter table sm_ai_agent_runs add column if not exists version integer not null default 1;
    alter table sm_ai_agent_runs add column if not exists deleted_at timestamptz;
    alter table sm_ai_agent_runs add column if not exists origin text;
    alter table sm_ai_agent_runs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ai_agent_runs add column if not exists agent_id uuid;
    alter table sm_ai_agent_runs add column if not exists agent_key text;
    alter table sm_ai_agent_runs add column if not exists agent_name text;
    alter table sm_ai_agent_runs add column if not exists trigger text;
    alter table sm_ai_agent_runs add column if not exists why text;
    alter table sm_ai_agent_runs add column if not exists started_by uuid;
    alter table sm_ai_agent_runs add column if not exists principal_id uuid;
    alter table sm_ai_agent_runs add column if not exists table_key text;
    alter table sm_ai_agent_runs add column if not exists record_id text;
    alter table sm_ai_agent_runs add column if not exists record_number text;
    alter table sm_ai_agent_runs add column if not exists status text;
    alter table sm_ai_agent_runs add column if not exists dry_run boolean not null default false;
    alter table sm_ai_agent_runs add column if not exists step_count integer;
    alter table sm_ai_agent_runs add column if not exists tool_calls integer;
    alter table sm_ai_agent_runs add column if not exists actions integer;
    alter table sm_ai_agent_runs add column if not exists applied integer;
    alter table sm_ai_agent_runs add column if not exists proposals jsonb;
    alter table sm_ai_agent_runs add column if not exists steps jsonb;
    alter table sm_ai_agent_runs add column if not exists state jsonb;
    alter table sm_ai_agent_runs add column if not exists tokens_in integer;
    alter table sm_ai_agent_runs add column if not exists tokens_out integer;
    alter table sm_ai_agent_runs add column if not exists cost_usd text;
    alter table sm_ai_agent_runs add column if not exists outcome text;
    alter table sm_ai_agent_runs add column if not exists error text;
    alter table sm_ai_agent_runs add column if not exists started_at timestamptz;
    alter table sm_ai_agent_runs add column if not exists ended_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_ai_agent_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  agent_id uuid,
  agent_key text,
  agent_name text,
  trigger text,
  why text,
  started_by uuid,
  principal_id uuid,
  table_key text,
  record_id text,
  record_number text,
  status text,
  dry_run boolean not null default false,
  step_count integer,
  tool_calls integer,
  actions integer,
  applied integer,
  proposals jsonb,
  steps jsonb,
  state jsonb,
  tokens_in integer,
  tokens_out integer,
  cost_usd text,
  outcome text,
  error text,
  started_at timestamptz,
  ended_at timestamptz
);
create index if not exists sm_ai_agent_runs_rev_idx on sm_ai_agent_runs (org_id, rev);
create index if not exists sm_ai_agent_runs_upd_idx on sm_ai_agent_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_agent_runs_crt_idx on sm_ai_agent_runs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_agent_runs_agent_id_idx on sm_ai_agent_runs (org_id, agent_id) where deleted_at is null;
create index if not exists sm_ai_agent_runs_agent_key_idx on sm_ai_agent_runs (org_id, agent_key) where deleted_at is null;
create index if not exists sm_ai_agent_runs_started_by_idx on sm_ai_agent_runs (org_id, started_by) where deleted_at is null;
create index if not exists sm_ai_agent_runs_record_id_idx on sm_ai_agent_runs (org_id, record_id) where deleted_at is null;
create index if not exists sm_ai_agent_runs_workspace_acc_idx on sm_ai_agent_runs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ai_agent_runs_unit_acc_idx on sm_ai_agent_runs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ai_agent_runs_domain_acc_idx on sm_ai_agent_runs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_ai_agent_runs_sync on sm_ai_agent_runs;
create or replace trigger sm_ai_agent_runs_demo after insert on sm_ai_agent_runs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_agent_runs_demo_t after update or delete on sm_ai_agent_runs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_agent_runs enable row level security;

-- ai_data_policy: سیاست‌های دادهٔ هوش مصنوعی
do $cols$
begin
  if to_regclass('sm_ai_data_policies') is not null then
    alter table sm_ai_data_policies add column if not exists workspace_id uuid;
    alter table sm_ai_data_policies add column if not exists domain_id uuid;
    alter table sm_ai_data_policies add column if not exists unit_id uuid;
    alter table sm_ai_data_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_ai_data_policies add column if not exists created_by uuid;
    alter table sm_ai_data_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_ai_data_policies add column if not exists updated_by uuid;
    alter table sm_ai_data_policies add column if not exists rev bigint not null default 0;
    alter table sm_ai_data_policies add column if not exists version integer not null default 1;
    alter table sm_ai_data_policies add column if not exists deleted_at timestamptz;
    alter table sm_ai_data_policies add column if not exists origin text;
    alter table sm_ai_data_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ai_data_policies add column if not exists table_key text;
    alter table sm_ai_data_policies add column if not exists use text;
    alter table sm_ai_data_policies add column if not exists pii text;
    alter table sm_ai_data_policies add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_ai_data_policies (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  use text,
  pii text,
  note text
);
create index if not exists sm_ai_data_policies_rev_idx on sm_ai_data_policies (org_id, rev);
create index if not exists sm_ai_data_policies_upd_idx on sm_ai_data_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_data_policies_crt_idx on sm_ai_data_policies (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ai_data_policies_table_key_uk on sm_ai_data_policies (org_id, table_key) where deleted_at is null;
drop trigger if exists sm_ai_data_policies_sync on sm_ai_data_policies;
create trigger sm_ai_data_policies_sync before insert or update on sm_ai_data_policies for each row execute function sm_sync_touch('ai_data_policy');
create or replace trigger sm_ai_data_policies_demo after insert on sm_ai_data_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_data_policies_demo_t after update or delete on sm_ai_data_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_data_policies enable row level security;

-- ai_digest: خلاصه‌های بینش
do $cols$
begin
  if to_regclass('sm_ai_digests') is not null then
    alter table sm_ai_digests add column if not exists workspace_id uuid;
    alter table sm_ai_digests add column if not exists domain_id uuid;
    alter table sm_ai_digests add column if not exists unit_id uuid;
    alter table sm_ai_digests add column if not exists created_at timestamptz not null default now();
    alter table sm_ai_digests add column if not exists created_by uuid;
    alter table sm_ai_digests add column if not exists updated_at timestamptz not null default now();
    alter table sm_ai_digests add column if not exists updated_by uuid;
    alter table sm_ai_digests add column if not exists rev bigint not null default 0;
    alter table sm_ai_digests add column if not exists version integer not null default 1;
    alter table sm_ai_digests add column if not exists deleted_at timestamptz;
    alter table sm_ai_digests add column if not exists origin text;
    alter table sm_ai_digests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_ai_digests add column if not exists title text;
    alter table sm_ai_digests add column if not exists recipient_id uuid;
    alter table sm_ai_digests add column if not exists period text;
    alter table sm_ai_digests add column if not exists period_key text;
    alter table sm_ai_digests add column if not exists insights integer;
    alter table sm_ai_digests add column if not exists body text;
    alter table sm_ai_digests add column if not exists delivered_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_ai_digests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  recipient_id uuid,
  period text,
  period_key text,
  insights integer,
  body text,
  delivered_at timestamptz
);
create index if not exists sm_ai_digests_rev_idx on sm_ai_digests (org_id, rev);
create index if not exists sm_ai_digests_upd_idx on sm_ai_digests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_digests_crt_idx on sm_ai_digests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_digests_recipient_id_idx on sm_ai_digests (org_id, recipient_id) where deleted_at is null;
create unique index if not exists sm_ai_digests_recipient_id_period_period_key_uk on sm_ai_digests (org_id, recipient_id, period, period_key) where deleted_at is null;
create index if not exists sm_ai_digests_workspace_acc_idx on sm_ai_digests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_ai_digests_unit_acc_idx on sm_ai_digests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_ai_digests_domain_acc_idx on sm_ai_digests (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_ai_digests_sync on sm_ai_digests;
create trigger sm_ai_digests_sync before insert or update on sm_ai_digests for each row execute function sm_sync_touch('ai_digest');
create or replace trigger sm_ai_digests_demo after insert on sm_ai_digests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_digests_demo_t after update or delete on sm_ai_digests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_digests enable row level security;

-- ai_skill: مهارت‌های هوش مصنوعی
do $cols$
begin
  if to_regclass('sm_ai_skills') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  key text,
  name text,
  description text,
  module text,
  base_key text,
  builtin boolean not null default false,
  enabled boolean not null default true,
  target text,
  output text,
  tables jsonb,
  tier text,
  grounding text,
  grounding_k integer,
  collections jsonb,
  triggers jsonb,
  events jsonb,
  condition jsonb,
  schedule_minutes integer,
  schedule_filter jsonb,
  roles jsonb,
  field_groups jsonb,
  auto_apply jsonb,
  daily_limit integer,
  user_daily_limit integer,
  active_version_id uuid,
  last_scheduled_at timestamptz
);
create index if not exists sm_ai_skills_rev_idx on sm_ai_skills (org_id, rev);
create index if not exists sm_ai_skills_upd_idx on sm_ai_skills (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skills_crt_idx on sm_ai_skills (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_ai_skills_key_uk on sm_ai_skills (org_id, key) where deleted_at is null;
drop trigger if exists sm_ai_skills_sync on sm_ai_skills;
create trigger sm_ai_skills_sync before insert or update on sm_ai_skills for each row execute function sm_sync_touch('ai_skill');
create or replace trigger sm_ai_skills_demo after insert on sm_ai_skills for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_skills_demo_t after update or delete on sm_ai_skills for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_skills enable row level security;

-- ai_skill_eval: مجموعه‌های ارزیابی مهارت
do $cols$
begin
  if to_regclass('sm_ai_skill_evals') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  skill_key text,
  name text,
  cases jsonb,
  last_score numeric,
  last_run_at timestamptz,
  last_model text,
  last_results jsonb
);
create index if not exists sm_ai_skill_evals_rev_idx on sm_ai_skill_evals (org_id, rev);
create index if not exists sm_ai_skill_evals_upd_idx on sm_ai_skill_evals (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_evals_crt_idx on sm_ai_skill_evals (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_evals_skill_key_idx on sm_ai_skill_evals (org_id, skill_key) where deleted_at is null;
drop trigger if exists sm_ai_skill_evals_sync on sm_ai_skill_evals;
create trigger sm_ai_skill_evals_sync before insert or update on sm_ai_skill_evals for each row execute function sm_sync_touch('ai_skill_eval');
create or replace trigger sm_ai_skill_evals_demo after insert on sm_ai_skill_evals for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_skill_evals_demo_t after update or delete on sm_ai_skill_evals for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_skill_evals enable row level security;

-- ai_skill_run: اجراهای مهارت
do $cols$
begin
  if to_regclass('sm_ai_skill_runs') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  skill_key text,
  skill_id uuid,
  version_id uuid,
  version_no integer,
  invoker_id uuid,
  principal text,
  table_key text,
  record_id text,
  record_number text,
  input_hash text,
  params jsonb,
  status text,
  output_kind text,
  output_text text,
  output_json jsonb,
  citations jsonb,
  clearance jsonb,
  model text,
  connection text,
  tokens_in integer,
  tokens_out integer,
  cost_usd text,
  latency_ms integer,
  error text,
  proposal_id text,
  feedback integer,
  feedback_comment text
);
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
create or replace trigger sm_ai_skill_runs_demo after insert on sm_ai_skill_runs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_skill_runs_demo_t after update or delete on sm_ai_skill_runs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_skill_runs enable row level security;

-- ai_skill_version: نسخه‌های مهارت
do $cols$
begin
  if to_regclass('sm_ai_skill_versions') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  skill_id uuid,
  revision integer,
  label text,
  state text,
  system text,
  template text,
  output_schema jsonb,
  temperature numeric,
  max_tokens integer,
  note text,
  published_at timestamptz,
  published_by uuid
);
create index if not exists sm_ai_skill_versions_rev_idx on sm_ai_skill_versions (org_id, rev);
create index if not exists sm_ai_skill_versions_upd_idx on sm_ai_skill_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_versions_crt_idx on sm_ai_skill_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_ai_skill_versions_skill_id_idx on sm_ai_skill_versions (org_id, skill_id) where deleted_at is null;
drop trigger if exists sm_ai_skill_versions_sync on sm_ai_skill_versions;
create trigger sm_ai_skill_versions_sync before insert or update on sm_ai_skill_versions for each row execute function sm_sync_touch('ai_skill_version');
create or replace trigger sm_ai_skill_versions_demo after insert on sm_ai_skill_versions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_ai_skill_versions_demo_t after update or delete on sm_ai_skill_versions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_ai_skill_versions enable row level security;

-- alert: هشدارها
do $cols$
begin
  if to_regclass('sm_alerts') is not null then
    alter table sm_alerts add column if not exists workspace_id uuid;
    alter table sm_alerts add column if not exists domain_id uuid;
    alter table sm_alerts add column if not exists unit_id uuid;
    alter table sm_alerts add column if not exists created_at timestamptz not null default now();
    alter table sm_alerts add column if not exists created_by uuid;
    alter table sm_alerts add column if not exists updated_at timestamptz not null default now();
    alter table sm_alerts add column if not exists updated_by uuid;
    alter table sm_alerts add column if not exists rev bigint not null default 0;
    alter table sm_alerts add column if not exists version integer not null default 1;
    alter table sm_alerts add column if not exists deleted_at timestamptz;
    alter table sm_alerts add column if not exists origin text;
    alter table sm_alerts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_alerts add column if not exists no integer;
    alter table sm_alerts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'ALR' || no::text else 'ALR' || lpad(no::text, 7, '0') end) stored;
    alter table sm_alerts add column if not exists short_description text;
    alter table sm_alerts add column if not exists description text;
    alter table sm_alerts add column if not exists severity text;
    alter table sm_alerts add column if not exists priority text;
    alter table sm_alerts add column if not exists impact text;
    alter table sm_alerts add column if not exists source_id uuid;
    alter table sm_alerts add column if not exists node text;
    alter table sm_alerts add column if not exists resource text;
    alter table sm_alerts add column if not exists metric text;
    alter table sm_alerts add column if not exists tags jsonb;
    alter table sm_alerts add column if not exists ci_id uuid;
    alter table sm_alerts add column if not exists service_id uuid;
    alter table sm_alerts add column if not exists affected_services jsonb;
    alter table sm_alerts add column if not exists assignment_group_id uuid;
    alter table sm_alerts add column if not exists assigned_to uuid;
    alter table sm_alerts add column if not exists responders jsonb;
    alter table sm_alerts add column if not exists event_count integer;
    alter table sm_alerts add column if not exists first_seen_at timestamptz;
    alter table sm_alerts add column if not exists last_seen_at timestamptz;
    alter table sm_alerts add column if not exists opened_at timestamptz;
    alter table sm_alerts add column if not exists acknowledged_at timestamptz;
    alter table sm_alerts add column if not exists acknowledged_by uuid;
    alter table sm_alerts add column if not exists resolved_at timestamptz;
    alter table sm_alerts add column if not exists resolved_by uuid;
    alter table sm_alerts add column if not exists closed_at timestamptz;
    alter table sm_alerts add column if not exists closed_by uuid;
    alter table sm_alerts add column if not exists snoozed_until timestamptz;
    alter table sm_alerts add column if not exists reopen_count integer;
    alter table sm_alerts add column if not exists fingerprint text;
    alter table sm_alerts add column if not exists severity_history jsonb;
    alter table sm_alerts add column if not exists flips jsonb;
    alter table sm_alerts add column if not exists flap_count integer;
    alter table sm_alerts add column if not exists last_value numeric;
    alter table sm_alerts add column if not exists close_code text;
    alter table sm_alerts add column if not exists close_notes text;
    alter table sm_alerts add column if not exists active boolean not null default true;
    alter table sm_alerts add column if not exists sla_due timestamptz;
    alter table sm_alerts add column if not exists group_id uuid;
    alter table sm_alerts add column if not exists symptom boolean not null default false;
    alter table sm_alerts add column if not exists incident_id uuid;
    alter table sm_alerts add column if not exists incident_auto_resolve boolean not null default false;
    alter table sm_alerts add column if not exists change_id uuid;
    alter table sm_alerts add column if not exists maintenance_window_id uuid;
    alter table sm_alerts add column if not exists last_event_id uuid;
    alter table sm_alerts add column if not exists escalation_policy_id uuid;
    alter table sm_alerts add column if not exists escalation_state text;
    alter table sm_alerts add column if not exists escalation_level integer;
    alter table sm_alerts add column if not exists escalation_round integer;
    alter table sm_alerts add column if not exists next_escalation_at timestamptz;
    alter table sm_alerts add column if not exists pages_sent integer;
    alter table sm_alerts add column if not exists noise_label text;
    alter table sm_alerts add column if not exists noise_reason text;
    alter table sm_alerts add column if not exists watch_list jsonb;
    alter table sm_alerts add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_alerts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'ALR' || no::text else 'ALR' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  severity text,
  priority text,
  impact text,
  source_id uuid,
  node text,
  resource text,
  metric text,
  tags jsonb,
  ci_id uuid,
  service_id uuid,
  affected_services jsonb,
  assignment_group_id uuid,
  assigned_to uuid,
  responders jsonb,
  event_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  opened_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  snoozed_until timestamptz,
  reopen_count integer,
  fingerprint text,
  severity_history jsonb,
  flips jsonb,
  flap_count integer,
  last_value numeric,
  close_code text,
  close_notes text,
  active boolean not null default true,
  sla_due timestamptz,
  group_id uuid,
  symptom boolean not null default false,
  incident_id uuid,
  incident_auto_resolve boolean not null default false,
  change_id uuid,
  maintenance_window_id uuid,
  last_event_id uuid,
  escalation_policy_id uuid,
  escalation_state text,
  escalation_level integer,
  escalation_round integer,
  next_escalation_at timestamptz,
  pages_sent integer,
  noise_label text,
  noise_reason text,
  watch_list jsonb,
  state text,
  search_3e573310 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(node, '') || ' ' || coalesce(resource, '') || ' ' || coalesce(metric, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_alerts', 'search_3e573310', $x$translate(coalesce(short_description, '') || ' ' || coalesce(node, '') || ' ' || coalesce(resource, '') || ' ' || coalesce(metric, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_alerts_search_3e573310_trgm', 'sm_alerts', 'search_3e573310', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_alerts_search_custom_trgm', 'sm_alerts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_alerts_no_uk on sm_alerts (org_id, no);
create index if not exists sm_alerts_rev_idx on sm_alerts (org_id, rev);
create index if not exists sm_alerts_upd_idx on sm_alerts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_alerts_crt_idx on sm_alerts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_alerts_severity_idx on sm_alerts (org_id, severity) where deleted_at is null;
create index if not exists sm_alerts_ci_id_idx on sm_alerts (org_id, ci_id) where deleted_at is null;
create index if not exists sm_alerts_service_id_idx on sm_alerts (org_id, service_id) where deleted_at is null;
create index if not exists sm_alerts_assignment_group_id_idx on sm_alerts (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_alerts_assigned_to_idx on sm_alerts (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_alerts_fingerprint_idx on sm_alerts (org_id, fingerprint) where deleted_at is null;
create index if not exists sm_alerts_group_id_idx on sm_alerts (org_id, group_id) where deleted_at is null;
create index if not exists sm_alerts_incident_id_idx on sm_alerts (org_id, incident_id) where deleted_at is null;
create index if not exists sm_alerts_state_idx on sm_alerts (org_id, state) where deleted_at is null;
create index if not exists sm_alerts_workspace_acc_idx on sm_alerts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_alerts_unit_acc_idx on sm_alerts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_alerts_domain_acc_idx on sm_alerts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_alerts_responders_gin on sm_alerts using gin (responders);
create index if not exists sm_alerts_watch_list_gin on sm_alerts using gin (watch_list);
create index if not exists sm_alerts_open_grp_idx on sm_alerts (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_alerts_opened_brin on sm_alerts using brin (opened_at);
drop trigger if exists sm_alerts_sync on sm_alerts;
create trigger sm_alerts_sync before insert or update on sm_alerts for each row execute function sm_sync_touch('alert');
create or replace trigger sm_alerts_demo after insert on sm_alerts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_alerts_demo_t after update or delete on sm_alerts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_alerts enable row level security;

-- alert_group: گروه‌های هم‌بسته
do $cols$
begin
  if to_regclass('sm_alert_groups') is not null then
    alter table sm_alert_groups add column if not exists workspace_id uuid;
    alter table sm_alert_groups add column if not exists domain_id uuid;
    alter table sm_alert_groups add column if not exists unit_id uuid;
    alter table sm_alert_groups add column if not exists created_at timestamptz not null default now();
    alter table sm_alert_groups add column if not exists created_by uuid;
    alter table sm_alert_groups add column if not exists updated_at timestamptz not null default now();
    alter table sm_alert_groups add column if not exists updated_by uuid;
    alter table sm_alert_groups add column if not exists rev bigint not null default 0;
    alter table sm_alert_groups add column if not exists version integer not null default 1;
    alter table sm_alert_groups add column if not exists deleted_at timestamptz;
    alter table sm_alert_groups add column if not exists origin text;
    alter table sm_alert_groups add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_alert_groups add column if not exists no integer;
    alter table sm_alert_groups add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SIT' || no::text else 'SIT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_alert_groups add column if not exists title text;
    alter table sm_alert_groups add column if not exists severity text;
    alter table sm_alert_groups add column if not exists priority text;
    alter table sm_alert_groups add column if not exists reason text;
    alter table sm_alert_groups add column if not exists rule_id uuid;
    alter table sm_alert_groups add column if not exists corr_key text;
    alter table sm_alert_groups add column if not exists ci_id uuid;
    alter table sm_alert_groups add column if not exists service_id uuid;
    alter table sm_alert_groups add column if not exists affected_services jsonb;
    alter table sm_alert_groups add column if not exists assignment_group_id uuid;
    alter table sm_alert_groups add column if not exists assigned_to uuid;
    alter table sm_alert_groups add column if not exists alert_count integer;
    alter table sm_alert_groups add column if not exists open_count integer;
    alter table sm_alert_groups add column if not exists first_seen_at timestamptz;
    alter table sm_alert_groups add column if not exists last_seen_at timestamptz;
    alter table sm_alert_groups add column if not exists incident_id uuid;
    alter table sm_alert_groups add column if not exists summary text;
    alter table sm_alert_groups add column if not exists probable_causes jsonb;
    alter table sm_alert_groups add column if not exists active boolean not null default true;
    alter table sm_alert_groups add column if not exists opened_at timestamptz;
    alter table sm_alert_groups add column if not exists resolved_at timestamptz;
    alter table sm_alert_groups add column if not exists closed_at timestamptz;
    alter table sm_alert_groups add column if not exists watch_list jsonb;
    alter table sm_alert_groups add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_alert_groups (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SIT' || no::text else 'SIT' || lpad(no::text, 6, '0') end) stored,
  title text,
  severity text,
  priority text,
  reason text,
  rule_id uuid,
  corr_key text,
  ci_id uuid,
  service_id uuid,
  affected_services jsonb,
  assignment_group_id uuid,
  assigned_to uuid,
  alert_count integer,
  open_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  incident_id uuid,
  summary text,
  probable_causes jsonb,
  active boolean not null default true,
  opened_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_alert_groups', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_alert_groups_search_cae18f1d_trgm', 'sm_alert_groups', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_alert_groups_search_custom_trgm', 'sm_alert_groups', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_alert_groups_no_uk on sm_alert_groups (org_id, no);
create index if not exists sm_alert_groups_rev_idx on sm_alert_groups (org_id, rev);
create index if not exists sm_alert_groups_upd_idx on sm_alert_groups (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_alert_groups_crt_idx on sm_alert_groups (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_alert_groups_corr_key_idx on sm_alert_groups (org_id, corr_key) where deleted_at is null;
create index if not exists sm_alert_groups_assignment_group_id_idx on sm_alert_groups (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_alert_groups_state_idx on sm_alert_groups (org_id, state) where deleted_at is null;
create index if not exists sm_alert_groups_workspace_acc_idx on sm_alert_groups (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_alert_groups_unit_acc_idx on sm_alert_groups (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_alert_groups_domain_acc_idx on sm_alert_groups (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_alert_groups_assigned_to_idx on sm_alert_groups (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_alert_groups_watch_list_gin on sm_alert_groups using gin (watch_list);
create index if not exists sm_alert_groups_open_grp_idx on sm_alert_groups (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_alert_groups_opened_brin on sm_alert_groups using brin (opened_at);
drop trigger if exists sm_alert_groups_sync on sm_alert_groups;
create trigger sm_alert_groups_sync before insert or update on sm_alert_groups for each row execute function sm_sync_touch('alert_group');
create or replace trigger sm_alert_groups_demo after insert on sm_alert_groups for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_alert_groups_demo_t after update or delete on sm_alert_groups for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_alert_groups enable row level security;

-- alert_incident_rule: قاعده‌های ساخت رخداد
do $cols$
begin
  if to_regclass('sm_alert_incident_rules') is not null then
    alter table sm_alert_incident_rules add column if not exists workspace_id uuid;
    alter table sm_alert_incident_rules add column if not exists domain_id uuid;
    alter table sm_alert_incident_rules add column if not exists unit_id uuid;
    alter table sm_alert_incident_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_alert_incident_rules add column if not exists created_by uuid;
    alter table sm_alert_incident_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_alert_incident_rules add column if not exists updated_by uuid;
    alter table sm_alert_incident_rules add column if not exists rev bigint not null default 0;
    alter table sm_alert_incident_rules add column if not exists version integer not null default 1;
    alter table sm_alert_incident_rules add column if not exists deleted_at timestamptz;
    alter table sm_alert_incident_rules add column if not exists origin text;
    alter table sm_alert_incident_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_alert_incident_rules add column if not exists name text;
    alter table sm_alert_incident_rules add column if not exists active boolean not null default true;
    alter table sm_alert_incident_rules add column if not exists sort_order integer;
    alter table sm_alert_incident_rules add column if not exists min_severity text;
    alter table sm_alert_incident_rules add column if not exists delay_minutes integer;
    alter table sm_alert_incident_rules add column if not exists per_group boolean not null default true;
    alter table sm_alert_incident_rules add column if not exists condition jsonb;
    alter table sm_alert_incident_rules add column if not exists assignment_group_id uuid;
    alter table sm_alert_incident_rules add column if not exists category text;
    alter table sm_alert_incident_rules add column if not exists auto_resolve boolean not null default true;
    alter table sm_alert_incident_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_alert_incident_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  min_severity text,
  delay_minutes integer,
  per_group boolean not null default true,
  condition jsonb,
  assignment_group_id uuid,
  category text,
  auto_resolve boolean not null default true,
  description text
);
create index if not exists sm_alert_incident_rules_rev_idx on sm_alert_incident_rules (org_id, rev);
create index if not exists sm_alert_incident_rules_upd_idx on sm_alert_incident_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_alert_incident_rules_crt_idx on sm_alert_incident_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_alert_incident_rules_sync on sm_alert_incident_rules;
create trigger sm_alert_incident_rules_sync before insert or update on sm_alert_incident_rules for each row execute function sm_sync_touch('alert_incident_rule');
create or replace trigger sm_alert_incident_rules_demo after insert on sm_alert_incident_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_alert_incident_rules_demo_t after update or delete on sm_alert_incident_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_alert_incident_rules enable row level security;

-- alert_route: قاعده‌های مسیریابی هشدار
do $cols$
begin
  if to_regclass('sm_alert_routes') is not null then
    alter table sm_alert_routes add column if not exists workspace_id uuid;
    alter table sm_alert_routes add column if not exists domain_id uuid;
    alter table sm_alert_routes add column if not exists unit_id uuid;
    alter table sm_alert_routes add column if not exists created_at timestamptz not null default now();
    alter table sm_alert_routes add column if not exists created_by uuid;
    alter table sm_alert_routes add column if not exists updated_at timestamptz not null default now();
    alter table sm_alert_routes add column if not exists updated_by uuid;
    alter table sm_alert_routes add column if not exists rev bigint not null default 0;
    alter table sm_alert_routes add column if not exists version integer not null default 1;
    alter table sm_alert_routes add column if not exists deleted_at timestamptz;
    alter table sm_alert_routes add column if not exists origin text;
    alter table sm_alert_routes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_alert_routes add column if not exists name text;
    alter table sm_alert_routes add column if not exists active boolean not null default true;
    alter table sm_alert_routes add column if not exists sort_order integer;
    alter table sm_alert_routes add column if not exists condition jsonb;
    alter table sm_alert_routes add column if not exists time text;
    alter table sm_alert_routes add column if not exists calendar_id uuid;
    alter table sm_alert_routes add column if not exists assignment_group_id uuid;
    alter table sm_alert_routes add column if not exists escalation_policy_id uuid;
    alter table sm_alert_routes add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_alert_routes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  condition jsonb,
  time text,
  calendar_id uuid,
  assignment_group_id uuid,
  escalation_policy_id uuid,
  description text
);
create index if not exists sm_alert_routes_rev_idx on sm_alert_routes (org_id, rev);
create index if not exists sm_alert_routes_upd_idx on sm_alert_routes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_alert_routes_crt_idx on sm_alert_routes (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_alert_routes_sync on sm_alert_routes;
create trigger sm_alert_routes_sync before insert or update on sm_alert_routes for each row execute function sm_sync_touch('alert_route');
create or replace trigger sm_alert_routes_demo after insert on sm_alert_routes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_alert_routes_demo_t after update or delete on sm_alert_routes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_alert_routes enable row level security;

-- allocation_result: نتیجه‌های تسهیم
do $cols$
begin
  if to_regclass('sm_allocation_results') is not null then
    alter table sm_allocation_results add column if not exists workspace_id uuid;
    alter table sm_allocation_results add column if not exists domain_id uuid;
    alter table sm_allocation_results add column if not exists unit_id uuid;
    alter table sm_allocation_results add column if not exists created_at timestamptz not null default now();
    alter table sm_allocation_results add column if not exists created_by uuid;
    alter table sm_allocation_results add column if not exists updated_at timestamptz not null default now();
    alter table sm_allocation_results add column if not exists updated_by uuid;
    alter table sm_allocation_results add column if not exists rev bigint not null default 0;
    alter table sm_allocation_results add column if not exists version integer not null default 1;
    alter table sm_allocation_results add column if not exists deleted_at timestamptz;
    alter table sm_allocation_results add column if not exists origin text;
    alter table sm_allocation_results add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_allocation_results add column if not exists run_id uuid;
    alter table sm_allocation_results add column if not exists rule_id uuid;
    alter table sm_allocation_results add column if not exists stage text;
    alter table sm_allocation_results add column if not exists source_cost_center_id uuid;
    alter table sm_allocation_results add column if not exists service_id uuid;
    alter table sm_allocation_results add column if not exists consumer_unit_id uuid;
    alter table sm_allocation_results add column if not exists amount numeric;
    alter table sm_allocation_results add column if not exists driver_value numeric;
    alter table sm_allocation_results add column if not exists basis text;
  end if;
end
$cols$;
create table if not exists sm_allocation_results (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  run_id uuid,
  rule_id uuid,
  stage text,
  source_cost_center_id uuid,
  service_id uuid,
  consumer_unit_id uuid,
  amount numeric,
  driver_value numeric,
  basis text
);
create index if not exists sm_allocation_results_rev_idx on sm_allocation_results (org_id, rev);
create index if not exists sm_allocation_results_upd_idx on sm_allocation_results (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_results_crt_idx on sm_allocation_results (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_results_run_id_idx on sm_allocation_results (org_id, run_id) where deleted_at is null;
create index if not exists sm_allocation_results_service_id_idx on sm_allocation_results (org_id, service_id) where deleted_at is null;
drop trigger if exists sm_allocation_results_sync on sm_allocation_results;
create trigger sm_allocation_results_sync before insert or update on sm_allocation_results for each row execute function sm_sync_touch('allocation_result');
create or replace trigger sm_allocation_results_demo after insert on sm_allocation_results for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_allocation_results_demo_t after update or delete on sm_allocation_results for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_allocation_results enable row level security;

-- allocation_rule: قاعده‌های تسهیم
do $cols$
begin
  if to_regclass('sm_allocation_rules') is not null then
    alter table sm_allocation_rules add column if not exists workspace_id uuid;
    alter table sm_allocation_rules add column if not exists domain_id uuid;
    alter table sm_allocation_rules add column if not exists unit_id uuid;
    alter table sm_allocation_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_allocation_rules add column if not exists created_by uuid;
    alter table sm_allocation_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_allocation_rules add column if not exists updated_by uuid;
    alter table sm_allocation_rules add column if not exists rev bigint not null default 0;
    alter table sm_allocation_rules add column if not exists version integer not null default 1;
    alter table sm_allocation_rules add column if not exists deleted_at timestamptz;
    alter table sm_allocation_rules add column if not exists origin text;
    alter table sm_allocation_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_allocation_rules add column if not exists name text;
    alter table sm_allocation_rules add column if not exists active boolean not null default true;
    alter table sm_allocation_rules add column if not exists sort_order integer;
    alter table sm_allocation_rules add column if not exists source_cost_center_id uuid;
    alter table sm_allocation_rules add column if not exists cost_types jsonb;
    alter table sm_allocation_rules add column if not exists method text;
    alter table sm_allocation_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_allocation_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  source_cost_center_id uuid,
  cost_types jsonb,
  method text,
  description text
);
create index if not exists sm_allocation_rules_rev_idx on sm_allocation_rules (org_id, rev);
create index if not exists sm_allocation_rules_upd_idx on sm_allocation_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_rules_crt_idx on sm_allocation_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_allocation_rules_sync on sm_allocation_rules;
create trigger sm_allocation_rules_sync before insert or update on sm_allocation_rules for each row execute function sm_sync_touch('allocation_rule');
create or replace trigger sm_allocation_rules_demo after insert on sm_allocation_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_allocation_rules_demo_t after update or delete on sm_allocation_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_allocation_rules enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:0', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 2/28 (e746bd22eb04)
-- allocation_run: اجراهای تسهیم
do $cols$
begin
  if to_regclass('sm_allocation_runs') is not null then
    alter table sm_allocation_runs add column if not exists workspace_id uuid;
    alter table sm_allocation_runs add column if not exists domain_id uuid;
    alter table sm_allocation_runs add column if not exists unit_id uuid;
    alter table sm_allocation_runs add column if not exists created_at timestamptz not null default now();
    alter table sm_allocation_runs add column if not exists created_by uuid;
    alter table sm_allocation_runs add column if not exists updated_at timestamptz not null default now();
    alter table sm_allocation_runs add column if not exists updated_by uuid;
    alter table sm_allocation_runs add column if not exists rev bigint not null default 0;
    alter table sm_allocation_runs add column if not exists version integer not null default 1;
    alter table sm_allocation_runs add column if not exists deleted_at timestamptz;
    alter table sm_allocation_runs add column if not exists origin text;
    alter table sm_allocation_runs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_allocation_runs add column if not exists no integer;
    alter table sm_allocation_runs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ALC' || no::text else 'ALC' || lpad(no::text, 5, '0') end) stored;
    alter table sm_allocation_runs add column if not exists name text;
    alter table sm_allocation_runs add column if not exists mode text;
    alter table sm_allocation_runs add column if not exists fiscal_year_id uuid;
    alter table sm_allocation_runs add column if not exists period_from_id uuid;
    alter table sm_allocation_runs add column if not exists period_to_id uuid;
    alter table sm_allocation_runs add column if not exists total_pool numeric;
    alter table sm_allocation_runs add column if not exists total_allocated numeric;
    alter table sm_allocation_runs add column if not exists unallocated numeric;
    alter table sm_allocation_runs add column if not exists calculated_at timestamptz;
    alter table sm_allocation_runs add column if not exists input_hash text;
    alter table sm_allocation_runs add column if not exists notes text;
    alter table sm_allocation_runs add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_allocation_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ALC' || no::text else 'ALC' || lpad(no::text, 5, '0') end) stored,
  name text,
  mode text,
  fiscal_year_id uuid,
  period_from_id uuid,
  period_to_id uuid,
  total_pool numeric,
  total_allocated numeric,
  unallocated numeric,
  calculated_at timestamptz,
  input_hash text,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_allocation_runs', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_allocation_runs_search_56291d9d_trgm', 'sm_allocation_runs', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_allocation_runs_search_custom_trgm', 'sm_allocation_runs', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_allocation_runs_no_uk on sm_allocation_runs (org_id, no);
create index if not exists sm_allocation_runs_rev_idx on sm_allocation_runs (org_id, rev);
create index if not exists sm_allocation_runs_upd_idx on sm_allocation_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_runs_crt_idx on sm_allocation_runs (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_runs_state_idx on sm_allocation_runs (org_id, state) where deleted_at is null;
drop trigger if exists sm_allocation_runs_sync on sm_allocation_runs;
create trigger sm_allocation_runs_sync before insert or update on sm_allocation_runs for each row execute function sm_sync_touch('allocation_run');
create or replace trigger sm_allocation_runs_demo after insert on sm_allocation_runs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_allocation_runs_demo_t after update or delete on sm_allocation_runs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_allocation_runs enable row level security;

-- allocation_target: مقصدهای تسهیم
do $cols$
begin
  if to_regclass('sm_allocation_targets') is not null then
    alter table sm_allocation_targets add column if not exists workspace_id uuid;
    alter table sm_allocation_targets add column if not exists domain_id uuid;
    alter table sm_allocation_targets add column if not exists unit_id uuid;
    alter table sm_allocation_targets add column if not exists created_at timestamptz not null default now();
    alter table sm_allocation_targets add column if not exists created_by uuid;
    alter table sm_allocation_targets add column if not exists updated_at timestamptz not null default now();
    alter table sm_allocation_targets add column if not exists updated_by uuid;
    alter table sm_allocation_targets add column if not exists rev bigint not null default 0;
    alter table sm_allocation_targets add column if not exists version integer not null default 1;
    alter table sm_allocation_targets add column if not exists deleted_at timestamptz;
    alter table sm_allocation_targets add column if not exists origin text;
    alter table sm_allocation_targets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_allocation_targets add column if not exists rule_id uuid;
    alter table sm_allocation_targets add column if not exists service_id uuid;
    alter table sm_allocation_targets add column if not exists percent numeric;
    alter table sm_allocation_targets add column if not exists driver_value numeric;
  end if;
end
$cols$;
create table if not exists sm_allocation_targets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  rule_id uuid,
  service_id uuid,
  percent numeric,
  driver_value numeric
);
create index if not exists sm_allocation_targets_rev_idx on sm_allocation_targets (org_id, rev);
create index if not exists sm_allocation_targets_upd_idx on sm_allocation_targets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_targets_crt_idx on sm_allocation_targets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_allocation_targets_rule_id_idx on sm_allocation_targets (org_id, rule_id) where deleted_at is null;
create unique index if not exists sm_allocation_targets_rule_id_service_id_uk on sm_allocation_targets (org_id, rule_id, service_id) where deleted_at is null;
drop trigger if exists sm_allocation_targets_sync on sm_allocation_targets;
create trigger sm_allocation_targets_sync before insert or update on sm_allocation_targets for each row execute function sm_sync_touch('allocation_target');
create or replace trigger sm_allocation_targets_demo after insert on sm_allocation_targets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_allocation_targets_demo_t after update or delete on sm_allocation_targets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_allocation_targets enable row level security;

-- analytics_config: تنظیمات گزارش‌ها
do $cols$
begin
  if to_regclass('sm_analytics_configs') is not null then
    alter table sm_analytics_configs add column if not exists workspace_id uuid;
    alter table sm_analytics_configs add column if not exists domain_id uuid;
    alter table sm_analytics_configs add column if not exists unit_id uuid;
    alter table sm_analytics_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_configs add column if not exists created_by uuid;
    alter table sm_analytics_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_configs add column if not exists updated_by uuid;
    alter table sm_analytics_configs add column if not exists rev bigint not null default 0;
    alter table sm_analytics_configs add column if not exists version integer not null default 1;
    alter table sm_analytics_configs add column if not exists deleted_at timestamptz;
    alter table sm_analytics_configs add column if not exists origin text;
    alter table sm_analytics_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_configs add column if not exists name text;
    alter table sm_analytics_configs add column if not exists config_key text;
    alter table sm_analytics_configs add column if not exists small_cell_k integer;
    alter table sm_analytics_configs add column if not exists snapshot_hour integer;
    alter table sm_analytics_configs add column if not exists keep_days integer;
    alter table sm_analytics_configs add column if not exists backfill_periods integer;
    alter table sm_analytics_configs add column if not exists last_snapshot_on date;
    alter table sm_analytics_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_analytics_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  small_cell_k integer,
  snapshot_hour integer,
  keep_days integer,
  backfill_periods integer,
  last_snapshot_on date,
  seeded integer
);
create index if not exists sm_analytics_configs_rev_idx on sm_analytics_configs (org_id, rev);
create index if not exists sm_analytics_configs_upd_idx on sm_analytics_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_configs_crt_idx on sm_analytics_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_analytics_configs_config_key_uk on sm_analytics_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_analytics_configs_sync on sm_analytics_configs;
create trigger sm_analytics_configs_sync before insert or update on sm_analytics_configs for each row execute function sm_sync_touch('analytics_config');
create or replace trigger sm_analytics_configs_demo after insert on sm_analytics_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_configs_demo_t after update or delete on sm_analytics_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_configs enable row level security;

-- analytics_dashboard: داشبوردها
do $cols$
begin
  if to_regclass('sm_analytics_dashboards') is not null then
    alter table sm_analytics_dashboards add column if not exists workspace_id uuid;
    alter table sm_analytics_dashboards add column if not exists domain_id uuid;
    alter table sm_analytics_dashboards add column if not exists unit_id uuid;
    alter table sm_analytics_dashboards add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_dashboards add column if not exists created_by uuid;
    alter table sm_analytics_dashboards add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_dashboards add column if not exists updated_by uuid;
    alter table sm_analytics_dashboards add column if not exists rev bigint not null default 0;
    alter table sm_analytics_dashboards add column if not exists version integer not null default 1;
    alter table sm_analytics_dashboards add column if not exists deleted_at timestamptz;
    alter table sm_analytics_dashboards add column if not exists origin text;
    alter table sm_analytics_dashboards add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_dashboards add column if not exists no integer;
    alter table sm_analytics_dashboards add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'DSH' || no::text else 'DSH' || lpad(no::text, 5, '0') end) stored;
    alter table sm_analytics_dashboards add column if not exists name text;
    alter table sm_analytics_dashboards add column if not exists status text;
    alter table sm_analytics_dashboards add column if not exists description text;
    alter table sm_analytics_dashboards add column if not exists folder text;
    alter table sm_analytics_dashboards add column if not exists is_home boolean not null default false;
    alter table sm_analytics_dashboards add column if not exists home_workspaces jsonb;
    alter table sm_analytics_dashboards add column if not exists tv_cycle integer;
    alter table sm_analytics_dashboards add column if not exists refresh_minutes integer;
    alter table sm_analytics_dashboards add column if not exists certified boolean not null default false;
    alter table sm_analytics_dashboards add column if not exists trashed boolean not null default false;
    alter table sm_analytics_dashboards add column if not exists trashed_at timestamptz;
    alter table sm_analytics_dashboards add column if not exists layout jsonb;
    alter table sm_analytics_dashboards add column if not exists filters jsonb;
    alter table sm_analytics_dashboards add column if not exists library_key text;
    alter table sm_analytics_dashboards add column if not exists owner_id uuid;
    alter table sm_analytics_dashboards add column if not exists shares jsonb;
    alter table sm_analytics_dashboards add column if not exists r_users jsonb;
    alter table sm_analytics_dashboards add column if not exists r_groups jsonb;
    alter table sm_analytics_dashboards add column if not exists r_units jsonb;
    alter table sm_analytics_dashboards add column if not exists r_lines jsonb;
    alter table sm_analytics_dashboards add column if not exists r_all boolean not null default false;
    alter table sm_analytics_dashboards add column if not exists w_users jsonb;
    alter table sm_analytics_dashboards add column if not exists w_groups jsonb;
    alter table sm_analytics_dashboards add column if not exists role_keys jsonb;
  end if;
end
$cols$;
create table if not exists sm_analytics_dashboards (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'DSH' || no::text else 'DSH' || lpad(no::text, 5, '0') end) stored,
  name text,
  status text,
  description text,
  folder text,
  is_home boolean not null default false,
  home_workspaces jsonb,
  tv_cycle integer,
  refresh_minutes integer,
  certified boolean not null default false,
  trashed boolean not null default false,
  trashed_at timestamptz,
  layout jsonb,
  filters jsonb,
  library_key text,
  owner_id uuid,
  shares jsonb,
  r_users jsonb,
  r_groups jsonb,
  r_units jsonb,
  r_lines jsonb,
  r_all boolean not null default false,
  w_users jsonb,
  w_groups jsonb,
  role_keys jsonb,
  search_e402ec00 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(folder, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_analytics_dashboards', 'search_e402ec00', $x$translate(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(folder, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_analytics_dashboards_search_e402ec00_trgm', 'sm_analytics_dashboards', 'search_e402ec00', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_analytics_dashboards_search_custom_trgm', 'sm_analytics_dashboards', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_analytics_dashboards_no_uk on sm_analytics_dashboards (org_id, no);
create index if not exists sm_analytics_dashboards_rev_idx on sm_analytics_dashboards (org_id, rev);
create index if not exists sm_analytics_dashboards_upd_idx on sm_analytics_dashboards (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_dashboards_crt_idx on sm_analytics_dashboards (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_dashboards_workspace_acc_idx on sm_analytics_dashboards (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_analytics_dashboards_unit_acc_idx on sm_analytics_dashboards (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_analytics_dashboards_domain_acc_idx on sm_analytics_dashboards (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_analytics_dashboards_owner_id_idx on sm_analytics_dashboards (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_analytics_dashboards_sync on sm_analytics_dashboards;
create trigger sm_analytics_dashboards_sync before insert or update on sm_analytics_dashboards for each row execute function sm_sync_touch('analytics_dashboard');
create or replace trigger sm_analytics_dashboards_demo after insert on sm_analytics_dashboards for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_dashboards_demo_t after update or delete on sm_analytics_dashboards for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_dashboards enable row level security;

-- analytics_delivery: گزارش‌های تحویل‌شده
do $cols$
begin
  if to_regclass('sm_analytics_deliveries') is not null then
    alter table sm_analytics_deliveries add column if not exists workspace_id uuid;
    alter table sm_analytics_deliveries add column if not exists domain_id uuid;
    alter table sm_analytics_deliveries add column if not exists unit_id uuid;
    alter table sm_analytics_deliveries add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_deliveries add column if not exists created_by uuid;
    alter table sm_analytics_deliveries add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_deliveries add column if not exists updated_by uuid;
    alter table sm_analytics_deliveries add column if not exists rev bigint not null default 0;
    alter table sm_analytics_deliveries add column if not exists version integer not null default 1;
    alter table sm_analytics_deliveries add column if not exists deleted_at timestamptz;
    alter table sm_analytics_deliveries add column if not exists origin text;
    alter table sm_analytics_deliveries add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_deliveries add column if not exists title text;
    alter table sm_analytics_deliveries add column if not exists recipient_id uuid;
    alter table sm_analytics_deliveries add column if not exists status text;
    alter table sm_analytics_deliveries add column if not exists delivered_at timestamptz;
    alter table sm_analytics_deliveries add column if not exists schedule_id uuid;
    alter table sm_analytics_deliveries add column if not exists report_id uuid;
    alter table sm_analytics_deliveries add column if not exists dashboard_id uuid;
    alter table sm_analytics_deliveries add column if not exists rows integer;
    alter table sm_analytics_deliveries add column if not exists summary text;
    alter table sm_analytics_deliveries add column if not exists error text;
  end if;
end
$cols$;
create table if not exists sm_analytics_deliveries (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  recipient_id uuid,
  status text,
  delivered_at timestamptz,
  schedule_id uuid,
  report_id uuid,
  dashboard_id uuid,
  rows integer,
  summary text,
  error text
);
create index if not exists sm_analytics_deliveries_rev_idx on sm_analytics_deliveries (org_id, rev);
create index if not exists sm_analytics_deliveries_upd_idx on sm_analytics_deliveries (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_deliveries_crt_idx on sm_analytics_deliveries (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_deliveries_workspace_acc_idx on sm_analytics_deliveries (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_analytics_deliveries_unit_acc_idx on sm_analytics_deliveries (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_analytics_deliveries_domain_acc_idx on sm_analytics_deliveries (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_analytics_deliveries_recipient_id_idx on sm_analytics_deliveries (org_id, recipient_id) where deleted_at is null;
drop trigger if exists sm_analytics_deliveries_sync on sm_analytics_deliveries;
create trigger sm_analytics_deliveries_sync before insert or update on sm_analytics_deliveries for each row execute function sm_sync_touch('analytics_delivery');
create or replace trigger sm_analytics_deliveries_demo after insert on sm_analytics_deliveries for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_deliveries_demo_t after update or delete on sm_analytics_deliveries for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_deliveries enable row level security;

-- analytics_indicator: شاخص‌ها
do $cols$
begin
  if to_regclass('sm_analytics_indicators') is not null then
    alter table sm_analytics_indicators add column if not exists workspace_id uuid;
    alter table sm_analytics_indicators add column if not exists domain_id uuid;
    alter table sm_analytics_indicators add column if not exists unit_id uuid;
    alter table sm_analytics_indicators add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_indicators add column if not exists created_by uuid;
    alter table sm_analytics_indicators add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_indicators add column if not exists updated_by uuid;
    alter table sm_analytics_indicators add column if not exists rev bigint not null default 0;
    alter table sm_analytics_indicators add column if not exists version integer not null default 1;
    alter table sm_analytics_indicators add column if not exists deleted_at timestamptz;
    alter table sm_analytics_indicators add column if not exists origin text;
    alter table sm_analytics_indicators add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_indicators add column if not exists no integer;
    alter table sm_analytics_indicators add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'KPI' || no::text else 'KPI' || lpad(no::text, 4, '0') end) stored;
    alter table sm_analytics_indicators add column if not exists name text;
    alter table sm_analytics_indicators add column if not exists key text;
    alter table sm_analytics_indicators add column if not exists description text;
    alter table sm_analytics_indicators add column if not exists practice text;
    alter table sm_analytics_indicators add column if not exists unit text;
    alter table sm_analytics_indicators add column if not exists direction text;
    alter table sm_analytics_indicators add column if not exists grain text;
    alter table sm_analytics_indicators add column if not exists decimals integer;
    alter table sm_analytics_indicators add column if not exists active boolean not null default true;
    alter table sm_analytics_indicators add column if not exists formula text;
    alter table sm_analytics_indicators add column if not exists parts jsonb;
    alter table sm_analytics_indicators add column if not exists breakdowns jsonb;
    alter table sm_analytics_indicators add column if not exists target numeric;
    alter table sm_analytics_indicators add column if not exists warn numeric;
    alter table sm_analytics_indicators add column if not exists crit numeric;
    alter table sm_analytics_indicators add column if not exists alert_users jsonb;
    alter table sm_analytics_indicators add column if not exists collect boolean not null default true;
    alter table sm_analytics_indicators add column if not exists score_shares jsonb;
    alter table sm_analytics_indicators add column if not exists certified boolean not null default false;
    alter table sm_analytics_indicators add column if not exists owner_id uuid;
    alter table sm_analytics_indicators add column if not exists formula_version integer;
    alter table sm_analytics_indicators add column if not exists library_key text;
    alter table sm_analytics_indicators add column if not exists collected_at timestamptz;
    alter table sm_analytics_indicators add column if not exists s_users jsonb;
    alter table sm_analytics_indicators add column if not exists s_groups jsonb;
    alter table sm_analytics_indicators add column if not exists s_all boolean not null default false;
    alter table sm_analytics_indicators add column if not exists s_roles jsonb;
  end if;
end
$cols$;
create table if not exists sm_analytics_indicators (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 4 then 'KPI' || no::text else 'KPI' || lpad(no::text, 4, '0') end) stored,
  name text,
  key text,
  description text,
  practice text,
  unit text,
  direction text,
  grain text,
  decimals integer,
  active boolean not null default true,
  formula text,
  parts jsonb,
  breakdowns jsonb,
  target numeric,
  warn numeric,
  crit numeric,
  alert_users jsonb,
  collect boolean not null default true,
  score_shares jsonb,
  certified boolean not null default false,
  owner_id uuid,
  formula_version integer,
  library_key text,
  collected_at timestamptz,
  s_users jsonb,
  s_groups jsonb,
  s_all boolean not null default false,
  s_roles jsonb,
  search_efd326e7 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(key, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_analytics_indicators', 'search_efd326e7', $x$translate(coalesce(name, '') || ' ' || coalesce(key, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_analytics_indicators_search_efd326e7_trgm', 'sm_analytics_indicators', 'search_efd326e7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_analytics_indicators_search_custom_trgm', 'sm_analytics_indicators', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_analytics_indicators_no_uk on sm_analytics_indicators (org_id, no);
create index if not exists sm_analytics_indicators_rev_idx on sm_analytics_indicators (org_id, rev);
create index if not exists sm_analytics_indicators_upd_idx on sm_analytics_indicators (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_indicators_crt_idx on sm_analytics_indicators (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_analytics_indicators_key_uk on sm_analytics_indicators (org_id, key) where deleted_at is null;
create index if not exists sm_analytics_indicators_workspace_acc_idx on sm_analytics_indicators (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_analytics_indicators_unit_acc_idx on sm_analytics_indicators (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_analytics_indicators_domain_acc_idx on sm_analytics_indicators (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_analytics_indicators_owner_id_idx on sm_analytics_indicators (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_analytics_indicators_sync on sm_analytics_indicators;
create trigger sm_analytics_indicators_sync before insert or update on sm_analytics_indicators for each row execute function sm_sync_touch('analytics_indicator');
create or replace trigger sm_analytics_indicators_demo after insert on sm_analytics_indicators for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_indicators_demo_t after update or delete on sm_analytics_indicators for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_indicators enable row level security;

-- analytics_report: گزارش‌ها
do $cols$
begin
  if to_regclass('sm_analytics_reports') is not null then
    alter table sm_analytics_reports add column if not exists workspace_id uuid;
    alter table sm_analytics_reports add column if not exists domain_id uuid;
    alter table sm_analytics_reports add column if not exists unit_id uuid;
    alter table sm_analytics_reports add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_reports add column if not exists created_by uuid;
    alter table sm_analytics_reports add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_reports add column if not exists updated_by uuid;
    alter table sm_analytics_reports add column if not exists rev bigint not null default 0;
    alter table sm_analytics_reports add column if not exists version integer not null default 1;
    alter table sm_analytics_reports add column if not exists deleted_at timestamptz;
    alter table sm_analytics_reports add column if not exists origin text;
    alter table sm_analytics_reports add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_reports add column if not exists no integer;
    alter table sm_analytics_reports add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'RPT' || no::text else 'RPT' || lpad(no::text, 5, '0') end) stored;
    alter table sm_analytics_reports add column if not exists name text;
    alter table sm_analytics_reports add column if not exists status text;
    alter table sm_analytics_reports add column if not exists description text;
    alter table sm_analytics_reports add column if not exists folder text;
    alter table sm_analytics_reports add column if not exists table_key text;
    alter table sm_analytics_reports add column if not exists viz text;
    alter table sm_analytics_reports add column if not exists certified boolean not null default false;
    alter table sm_analytics_reports add column if not exists trashed boolean not null default false;
    alter table sm_analytics_reports add column if not exists trashed_at timestamptz;
    alter table sm_analytics_reports add column if not exists spec jsonb;
    alter table sm_analytics_reports add column if not exists spec_version integer;
    alter table sm_analytics_reports add column if not exists owner_id uuid;
    alter table sm_analytics_reports add column if not exists shares jsonb;
    alter table sm_analytics_reports add column if not exists r_users jsonb;
    alter table sm_analytics_reports add column if not exists r_groups jsonb;
    alter table sm_analytics_reports add column if not exists r_units jsonb;
    alter table sm_analytics_reports add column if not exists r_lines jsonb;
    alter table sm_analytics_reports add column if not exists r_all boolean not null default false;
    alter table sm_analytics_reports add column if not exists w_users jsonb;
    alter table sm_analytics_reports add column if not exists w_groups jsonb;
    alter table sm_analytics_reports add column if not exists role_keys jsonb;
  end if;
end
$cols$;
create table if not exists sm_analytics_reports (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'RPT' || no::text else 'RPT' || lpad(no::text, 5, '0') end) stored,
  name text,
  status text,
  description text,
  folder text,
  table_key text,
  viz text,
  certified boolean not null default false,
  trashed boolean not null default false,
  trashed_at timestamptz,
  spec jsonb,
  spec_version integer,
  owner_id uuid,
  shares jsonb,
  r_users jsonb,
  r_groups jsonb,
  r_units jsonb,
  r_lines jsonb,
  r_all boolean not null default false,
  w_users jsonb,
  w_groups jsonb,
  role_keys jsonb,
  search_e402ec00 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(folder, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_analytics_reports', 'search_e402ec00', $x$translate(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(folder, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_analytics_reports_search_e402ec00_trgm', 'sm_analytics_reports', 'search_e402ec00', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_analytics_reports_search_custom_trgm', 'sm_analytics_reports', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_analytics_reports_no_uk on sm_analytics_reports (org_id, no);
create index if not exists sm_analytics_reports_rev_idx on sm_analytics_reports (org_id, rev);
create index if not exists sm_analytics_reports_upd_idx on sm_analytics_reports (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_reports_crt_idx on sm_analytics_reports (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_reports_workspace_acc_idx on sm_analytics_reports (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_analytics_reports_unit_acc_idx on sm_analytics_reports (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_analytics_reports_domain_acc_idx on sm_analytics_reports (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_analytics_reports_owner_id_idx on sm_analytics_reports (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_analytics_reports_sync on sm_analytics_reports;
create trigger sm_analytics_reports_sync before insert or update on sm_analytics_reports for each row execute function sm_sync_touch('analytics_report');
create or replace trigger sm_analytics_reports_demo after insert on sm_analytics_reports for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_reports_demo_t after update or delete on sm_analytics_reports for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_reports enable row level security;

-- analytics_schedule: ارسال‌های زمان‌بندی‌شده
do $cols$
begin
  if to_regclass('sm_analytics_schedules') is not null then
    alter table sm_analytics_schedules add column if not exists workspace_id uuid;
    alter table sm_analytics_schedules add column if not exists domain_id uuid;
    alter table sm_analytics_schedules add column if not exists unit_id uuid;
    alter table sm_analytics_schedules add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_schedules add column if not exists created_by uuid;
    alter table sm_analytics_schedules add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_schedules add column if not exists updated_by uuid;
    alter table sm_analytics_schedules add column if not exists rev bigint not null default 0;
    alter table sm_analytics_schedules add column if not exists version integer not null default 1;
    alter table sm_analytics_schedules add column if not exists deleted_at timestamptz;
    alter table sm_analytics_schedules add column if not exists origin text;
    alter table sm_analytics_schedules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_schedules add column if not exists no integer;
    alter table sm_analytics_schedules add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SCD' || no::text else 'SCD' || lpad(no::text, 5, '0') end) stored;
    alter table sm_analytics_schedules add column if not exists name text;
    alter table sm_analytics_schedules add column if not exists active boolean not null default true;
    alter table sm_analytics_schedules add column if not exists report_id uuid;
    alter table sm_analytics_schedules add column if not exists dashboard_id uuid;
    alter table sm_analytics_schedules add column if not exists schedule jsonb;
    alter table sm_analytics_schedules add column if not exists recipients jsonb;
    alter table sm_analytics_schedules add column if not exists recipient_groups jsonb;
    alter table sm_analytics_schedules add column if not exists include_owner boolean not null default true;
    alter table sm_analytics_schedules add column if not exists channels jsonb;
    alter table sm_analytics_schedules add column if not exists formats jsonb;
    alter table sm_analytics_schedules add column if not exists skip_if_empty boolean not null default true;
    alter table sm_analytics_schedules add column if not exists message text;
    alter table sm_analytics_schedules add column if not exists owner_id uuid;
    alter table sm_analytics_schedules add column if not exists next_run_at timestamptz;
    alter table sm_analytics_schedules add column if not exists last_run_at timestamptz;
    alter table sm_analytics_schedules add column if not exists last_result text;
  end if;
end
$cols$;
create table if not exists sm_analytics_schedules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SCD' || no::text else 'SCD' || lpad(no::text, 5, '0') end) stored,
  name text,
  active boolean not null default true,
  report_id uuid,
  dashboard_id uuid,
  schedule jsonb,
  recipients jsonb,
  recipient_groups jsonb,
  include_owner boolean not null default true,
  channels jsonb,
  formats jsonb,
  skip_if_empty boolean not null default true,
  message text,
  owner_id uuid,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_result text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_analytics_schedules', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_analytics_schedules_search_56291d9d_trgm', 'sm_analytics_schedules', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_analytics_schedules_search_custom_trgm', 'sm_analytics_schedules', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_analytics_schedules_no_uk on sm_analytics_schedules (org_id, no);
create index if not exists sm_analytics_schedules_rev_idx on sm_analytics_schedules (org_id, rev);
create index if not exists sm_analytics_schedules_upd_idx on sm_analytics_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_schedules_crt_idx on sm_analytics_schedules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_schedules_workspace_acc_idx on sm_analytics_schedules (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_analytics_schedules_unit_acc_idx on sm_analytics_schedules (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_analytics_schedules_domain_acc_idx on sm_analytics_schedules (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_analytics_schedules_owner_id_idx on sm_analytics_schedules (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_analytics_schedules_sync on sm_analytics_schedules;
create trigger sm_analytics_schedules_sync before insert or update on sm_analytics_schedules for each row execute function sm_sync_touch('analytics_schedule');
create or replace trigger sm_analytics_schedules_demo after insert on sm_analytics_schedules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_schedules_demo_t after update or delete on sm_analytics_schedules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_schedules enable row level security;

-- analytics_score: امتیازهای شاخص
do $cols$
begin
  if to_regclass('sm_analytics_scores') is not null then
    alter table sm_analytics_scores add column if not exists workspace_id uuid;
    alter table sm_analytics_scores add column if not exists domain_id uuid;
    alter table sm_analytics_scores add column if not exists unit_id uuid;
    alter table sm_analytics_scores add column if not exists created_at timestamptz not null default now();
    alter table sm_analytics_scores add column if not exists created_by uuid;
    alter table sm_analytics_scores add column if not exists updated_at timestamptz not null default now();
    alter table sm_analytics_scores add column if not exists updated_by uuid;
    alter table sm_analytics_scores add column if not exists rev bigint not null default 0;
    alter table sm_analytics_scores add column if not exists version integer not null default 1;
    alter table sm_analytics_scores add column if not exists deleted_at timestamptz;
    alter table sm_analytics_scores add column if not exists origin text;
    alter table sm_analytics_scores add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_analytics_scores add column if not exists indicator_id uuid;
    alter table sm_analytics_scores add column if not exists indicator_key text;
    alter table sm_analytics_scores add column if not exists formula_version integer;
    alter table sm_analytics_scores add column if not exists grain text;
    alter table sm_analytics_scores add column if not exists period_key text;
    alter table sm_analytics_scores add column if not exists period_label text;
    alter table sm_analytics_scores add column if not exists period_start date;
    alter table sm_analytics_scores add column if not exists period_end date;
    alter table sm_analytics_scores add column if not exists breakdown text;
    alter table sm_analytics_scores add column if not exists element text;
    alter table sm_analytics_scores add column if not exists element_label text;
    alter table sm_analytics_scores add column if not exists value numeric;
    alter table sm_analytics_scores add column if not exists status text;
    alter table sm_analytics_scores add column if not exists n integer;
    alter table sm_analytics_scores add column if not exists parts jsonb;
    alter table sm_analytics_scores add column if not exists final boolean not null default false;
    alter table sm_analytics_scores add column if not exists collected_at timestamptz;
    alter table sm_analytics_scores add column if not exists ids jsonb;
    alter table sm_analytics_scores add column if not exists s_users jsonb;
    alter table sm_analytics_scores add column if not exists s_groups jsonb;
    alter table sm_analytics_scores add column if not exists s_all boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_analytics_scores (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  indicator_id uuid,
  indicator_key text,
  formula_version integer,
  grain text,
  period_key text,
  period_label text,
  period_start date,
  period_end date,
  breakdown text,
  element text,
  element_label text,
  value numeric,
  status text,
  n integer,
  parts jsonb,
  final boolean not null default false,
  collected_at timestamptz,
  ids jsonb,
  s_users jsonb,
  s_groups jsonb,
  s_all boolean not null default false
);
create index if not exists sm_analytics_scores_rev_idx on sm_analytics_scores (org_id, rev);
create index if not exists sm_analytics_scores_upd_idx on sm_analytics_scores (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_scores_crt_idx on sm_analytics_scores (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_analytics_scores_indicator_id_idx on sm_analytics_scores (org_id, indicator_id) where deleted_at is null;
create unique index if not exists sm_analytics_scores_indicator_id_formula_version_perio_12ed0422 on sm_analytics_scores (org_id, indicator_id, formula_version, period_key, breakdown, element) where deleted_at is null;
drop trigger if exists sm_analytics_scores_sync on sm_analytics_scores;
create trigger sm_analytics_scores_sync before insert or update on sm_analytics_scores for each row execute function sm_sync_touch('analytics_score');
create or replace trigger sm_analytics_scores_demo after insert on sm_analytics_scores for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_analytics_scores_demo_t after update or delete on sm_analytics_scores for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_analytics_scores enable row level security;

-- announcement: اطلاعیه‌ها
do $cols$
begin
  if to_regclass('sm_announcements') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ANN' || no::text else 'ANN' || lpad(no::text, 5, '0') end) stored,
  title text,
  body text,
  kind text,
  starts_at timestamptz,
  ends_at timestamptz,
  incident_id uuid,
  end_with_incident boolean not null default true,
  assignment_group_id uuid,
  owner_id uuid,
  audience text,
  groups jsonb,
  units jsonb,
  locations jsonb,
  users jsonb,
  published_at timestamptz,
  published_by uuid,
  ended_at timestamptz,
  state text,
  search_dcf60e35 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(body, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_announcements', 'search_dcf60e35', $x$translate(coalesce(title, '') || ' ' || coalesce(body, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_announcements_search_dcf60e35_trgm', 'sm_announcements', 'search_dcf60e35', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_announcements_search_custom_trgm', 'sm_announcements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
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
create or replace trigger sm_announcements_demo after insert on sm_announcements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_announcements_demo_t after update or delete on sm_announcements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_announcements enable row level security;

-- app_assessment: ارزیابی‌های سامانه
do $cols$
begin
  if to_regclass('sm_app_assessments') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'ASM' || no::text else 'ASM' || lpad(no::text, 5, '0') end) stored,
  title text,
  ci_id uuid,
  assessor_id uuid,
  owner_id uuid,
  business_value integer,
  technical_fit integer,
  cost_score integer,
  risk_score integer,
  satisfaction integer,
  time_disposition text,
  recommendation text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_app_assessments', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_app_assessments_search_cae18f1d_trgm', 'sm_app_assessments', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_app_assessments_search_custom_trgm', 'sm_app_assessments', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
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
create or replace trigger sm_app_assessments_demo after insert on sm_app_assessments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_app_assessments_demo_t after update or delete on sm_app_assessments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_app_assessments enable row level security;

-- approval: تأییدها
do $cols$
begin
  if to_regclass('sm_approvals') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  table_key text,
  record_id text,
  record_number text,
  record_title text,
  rule_id uuid,
  level integer,
  level_name text,
  round integer,
  approver_id uuid,
  group_id uuid,
  source text,
  rule text,
  threshold integer,
  state text,
  comments text,
  due_at timestamptz,
  requested_at timestamptz,
  requested_by uuid,
  decided_at timestamptz,
  decided_by uuid,
  delegated_from uuid,
  reminded_at timestamptz
);
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
create or replace trigger sm_approvals_demo after insert on sm_approvals for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_approvals_demo_t after update or delete on sm_approvals for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_approvals enable row level security;

-- approval_rule: قواعد تأیید
do $cols$
begin
  if to_regclass('sm_approval_rules') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  table_key text,
  condition jsonb,
  mode text,
  levels jsonb,
  auto_approve jsonb,
  allow_self_approval boolean not null default false,
  remind_every bigint,
  expire_after bigint,
  expire_action text,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_approval_rules_rev_idx on sm_approval_rules (org_id, rev);
create index if not exists sm_approval_rules_upd_idx on sm_approval_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_approval_rules_crt_idx on sm_approval_rules (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_approval_rules_table_key_name_uk on sm_approval_rules (org_id, table_key, name) where deleted_at is null;
drop trigger if exists sm_approval_rules_sync on sm_approval_rules;
create trigger sm_approval_rules_sync before insert or update on sm_approval_rules for each row execute function sm_sync_touch('approval_rule');
create or replace trigger sm_approval_rules_demo after insert on sm_approval_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_approval_rules_demo_t after update or delete on sm_approval_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_approval_rules enable row level security;

-- artifact: کتابخانهٔ نرم‌افزار (DML)
do $cols$
begin
  if to_regclass('sm_artifacts') is not null then
    alter table sm_artifacts add column if not exists workspace_id uuid;
    alter table sm_artifacts add column if not exists domain_id uuid;
    alter table sm_artifacts add column if not exists unit_id uuid;
    alter table sm_artifacts add column if not exists created_at timestamptz not null default now();
    alter table sm_artifacts add column if not exists created_by uuid;
    alter table sm_artifacts add column if not exists updated_at timestamptz not null default now();
    alter table sm_artifacts add column if not exists updated_by uuid;
    alter table sm_artifacts add column if not exists rev bigint not null default 0;
    alter table sm_artifacts add column if not exists version integer not null default 1;
    alter table sm_artifacts add column if not exists deleted_at timestamptz;
    alter table sm_artifacts add column if not exists origin text;
    alter table sm_artifacts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_artifacts add column if not exists no integer;
    alter table sm_artifacts add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ART' || no::text else 'ART' || lpad(no::text, 6, '0') end) stored;
    alter table sm_artifacts add column if not exists name text;
    alter table sm_artifacts add column if not exists artifact_version text;
    alter table sm_artifacts add column if not exists approval_state text;
    alter table sm_artifacts add column if not exists digest text;
    alter table sm_artifacts add column if not exists signed boolean not null default false;
    alter table sm_artifacts add column if not exists location text;
    alter table sm_artifacts add column if not exists service_id uuid;
    alter table sm_artifacts add column if not exists release_id uuid;
    alter table sm_artifacts add column if not exists build_id uuid;
    alter table sm_artifacts add column if not exists source_commit text;
    alter table sm_artifacts add column if not exists sbom jsonb;
    alter table sm_artifacts add column if not exists components integer;
    alter table sm_artifacts add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_artifacts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ART' || no::text else 'ART' || lpad(no::text, 6, '0') end) stored,
  name text,
  artifact_version text,
  approval_state text,
  digest text,
  signed boolean not null default false,
  location text,
  service_id uuid,
  release_id uuid,
  build_id uuid,
  source_commit text,
  sbom jsonb,
  components integer,
  description text,
  search_3f2095eb text generated always as (translate(coalesce(name, '') || ' ' || coalesce(artifact_version, '') || ' ' || coalesce(digest, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_artifacts', 'search_3f2095eb', $x$translate(coalesce(name, '') || ' ' || coalesce(artifact_version, '') || ' ' || coalesce(digest, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_artifacts_search_3f2095eb_trgm', 'sm_artifacts', 'search_3f2095eb', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_artifacts_search_custom_trgm', 'sm_artifacts', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_artifacts_no_uk on sm_artifacts (org_id, no);
create index if not exists sm_artifacts_rev_idx on sm_artifacts (org_id, rev);
create index if not exists sm_artifacts_upd_idx on sm_artifacts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_artifacts_crt_idx on sm_artifacts (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_artifacts_name_artifact_version_uk on sm_artifacts (org_id, name, artifact_version) where deleted_at is null;
drop trigger if exists sm_artifacts_sync on sm_artifacts;
create trigger sm_artifacts_sync before insert or update on sm_artifacts for each row execute function sm_sync_touch('artifact');
create or replace trigger sm_artifacts_demo after insert on sm_artifacts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_artifacts_demo_t after update or delete on sm_artifacts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_artifacts enable row level security;

-- asset: دارایی‌ها
do $cols$
begin
  if to_regclass('sm_assets') is not null then
    alter table sm_assets add column if not exists workspace_id uuid;
    alter table sm_assets add column if not exists domain_id uuid;
    alter table sm_assets add column if not exists unit_id uuid;
    alter table sm_assets add column if not exists created_at timestamptz not null default now();
    alter table sm_assets add column if not exists created_by uuid;
    alter table sm_assets add column if not exists updated_at timestamptz not null default now();
    alter table sm_assets add column if not exists updated_by uuid;
    alter table sm_assets add column if not exists rev bigint not null default 0;
    alter table sm_assets add column if not exists version integer not null default 1;
    alter table sm_assets add column if not exists deleted_at timestamptz;
    alter table sm_assets add column if not exists origin text;
    alter table sm_assets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_assets add column if not exists no integer;
    alter table sm_assets add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'AST' || no::text else 'AST' || lpad(no::text, 7, '0') end) stored;
    alter table sm_assets add column if not exists name text;
    alter table sm_assets add column if not exists asset_tag text;
    alter table sm_assets add column if not exists serial_number text;
    alter table sm_assets add column if not exists model_id uuid;
    alter table sm_assets add column if not exists category text;
    alter table sm_assets add column if not exists asset_class text;
    alter table sm_assets add column if not exists substate text;
    alter table sm_assets add column if not exists quantity integer;
    alter table sm_assets add column if not exists ci_id uuid;
    alter table sm_assets add column if not exists parent_asset_id uuid;
    alter table sm_assets add column if not exists managed_by uuid;
    alter table sm_assets add column if not exists managed_by_group_id uuid;
    alter table sm_assets add column if not exists tags jsonb;
    alter table sm_assets add column if not exists notes text;
    alter table sm_assets add column if not exists assigned_to uuid;
    alter table sm_assets add column if not exists assigned_at timestamptz;
    alter table sm_assets add column if not exists usage_type text;
    alter table sm_assets add column if not exists expected_return_at date;
    alter table sm_assets add column if not exists department_id uuid;
    alter table sm_assets add column if not exists location_id uuid;
    alter table sm_assets add column if not exists stockroom_id uuid;
    alter table sm_assets add column if not exists reserved_for uuid;
    alter table sm_assets add column if not exists request_item_id uuid;
    alter table sm_assets add column if not exists ack_state text;
    alter table sm_assets add column if not exists branch_id uuid;
    alter table sm_assets add column if not exists sensitivity text;
    alter table sm_assets add column if not exists terminal_id text;
    alter table sm_assets add column if not exists device_status text;
    alter table sm_assets add column if not exists device_status_at timestamptz;
    alter table sm_assets add column if not exists site_type text;
    alter table sm_assets add column if not exists psp text;
    alter table sm_assets add column if not exists merchant_id text;
    alter table sm_assets add column if not exists os_name text;
    alter table sm_assets add column if not exists os_eos_date date;
    alter table sm_assets add column if not exists firmware_version text;
    alter table sm_assets add column if not exists attributes jsonb;
    alter table sm_assets add column if not exists purchase_cost numeric;
    alter table sm_assets add column if not exists purchase_date date;
    alter table sm_assets add column if not exists vendor_id uuid;
    alter table sm_assets add column if not exists po_id uuid;
    alter table sm_assets add column if not exists invoice_number text;
    alter table sm_assets add column if not exists cost_center_id uuid;
    alter table sm_assets add column if not exists depreciation_rule_id uuid;
    alter table sm_assets add column if not exists in_service_date date;
    alter table sm_assets add column if not exists salvage_value numeric;
    alter table sm_assets add column if not exists book_value numeric;
    alter table sm_assets add column if not exists accumulated_depreciation numeric;
    alter table sm_assets add column if not exists book_value_at date;
    alter table sm_assets add column if not exists warranty_start date;
    alter table sm_assets add column if not exists warranty_end date;
    alter table sm_assets add column if not exists warranty_contract_id uuid;
    alter table sm_assets add column if not exists support_contract_id uuid;
    alter table sm_assets add column if not exists lease_contract_id uuid;
    alter table sm_assets add column if not exists lease_end date;
    alter table sm_assets add column if not exists insurance_policy text;
    alter table sm_assets add column if not exists insurance_end date;
    alter table sm_assets add column if not exists reminded jsonb;
    alter table sm_assets add column if not exists received_at timestamptz;
    alter table sm_assets add column if not exists deployed_at timestamptz;
    alter table sm_assets add column if not exists retired_at timestamptz;
    alter table sm_assets add column if not exists disposed_at timestamptz;
    alter table sm_assets add column if not exists last_audit_at timestamptz;
    alter table sm_assets add column if not exists last_audit_result text;
    alter table sm_assets add column if not exists encrypted boolean not null default false;
    alter table sm_assets add column if not exists mdm_enrolled boolean not null default false;
    alter table sm_assets add column if not exists retire_reason text;
    alter table sm_assets add column if not exists disposal_method text;
    alter table sm_assets add column if not exists disposal_order_id uuid;
    alter table sm_assets add column if not exists sanitization_method text;
    alter table sm_assets add column if not exists sanitized_at timestamptz;
    alter table sm_assets add column if not exists certificate_no text;
    alter table sm_assets add column if not exists last_attested_at timestamptz;
    alter table sm_assets add column if not exists watch_list jsonb;
    alter table sm_assets add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_assets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'AST' || no::text else 'AST' || lpad(no::text, 7, '0') end) stored,
  name text,
  asset_tag text,
  serial_number text,
  model_id uuid,
  category text,
  asset_class text,
  substate text,
  quantity integer,
  ci_id uuid,
  parent_asset_id uuid,
  managed_by uuid,
  managed_by_group_id uuid,
  tags jsonb,
  notes text,
  assigned_to uuid,
  assigned_at timestamptz,
  usage_type text,
  expected_return_at date,
  department_id uuid,
  location_id uuid,
  stockroom_id uuid,
  reserved_for uuid,
  request_item_id uuid,
  ack_state text,
  branch_id uuid,
  sensitivity text,
  terminal_id text,
  device_status text,
  device_status_at timestamptz,
  site_type text,
  psp text,
  merchant_id text,
  os_name text,
  os_eos_date date,
  firmware_version text,
  attributes jsonb,
  purchase_cost numeric,
  purchase_date date,
  vendor_id uuid,
  po_id uuid,
  invoice_number text,
  cost_center_id uuid,
  depreciation_rule_id uuid,
  in_service_date date,
  salvage_value numeric,
  book_value numeric,
  accumulated_depreciation numeric,
  book_value_at date,
  warranty_start date,
  warranty_end date,
  warranty_contract_id uuid,
  support_contract_id uuid,
  lease_contract_id uuid,
  lease_end date,
  insurance_policy text,
  insurance_end date,
  reminded jsonb,
  received_at timestamptz,
  deployed_at timestamptz,
  retired_at timestamptz,
  disposed_at timestamptz,
  last_audit_at timestamptz,
  last_audit_result text,
  encrypted boolean not null default false,
  mdm_enrolled boolean not null default false,
  retire_reason text,
  disposal_method text,
  disposal_order_id uuid,
  sanitization_method text,
  sanitized_at timestamptz,
  certificate_no text,
  last_attested_at timestamptz,
  watch_list jsonb,
  state text,
  search_e45f7a02 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(asset_tag, '') || ' ' || coalesce(serial_number, '') || ' ' || coalesce(terminal_id, '') || ' ' || coalesce(merchant_id, '') || ' ' || coalesce(certificate_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_assets', 'search_e45f7a02', $x$translate(coalesce(name, '') || ' ' || coalesce(asset_tag, '') || ' ' || coalesce(serial_number, '') || ' ' || coalesce(terminal_id, '') || ' ' || coalesce(merchant_id, '') || ' ' || coalesce(certificate_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_assets_search_e45f7a02_trgm', 'sm_assets', 'search_e45f7a02', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_assets_search_custom_trgm', 'sm_assets', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_assets_no_uk on sm_assets (org_id, no);
create index if not exists sm_assets_rev_idx on sm_assets (org_id, rev);
create index if not exists sm_assets_upd_idx on sm_assets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_assets_crt_idx on sm_assets (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_assets_asset_tag_uk on sm_assets (org_id, asset_tag) where deleted_at is null;
create index if not exists sm_assets_asset_tag_idx on sm_assets (org_id, asset_tag) where deleted_at is null;
create index if not exists sm_assets_serial_number_idx on sm_assets (org_id, serial_number) where deleted_at is null;
create index if not exists sm_assets_model_id_idx on sm_assets (org_id, model_id) where deleted_at is null;
create unique index if not exists sm_assets_ci_id_uk on sm_assets (org_id, ci_id) where deleted_at is null;
create index if not exists sm_assets_stockroom_id_idx on sm_assets (org_id, stockroom_id) where deleted_at is null;
create index if not exists sm_assets_branch_id_idx on sm_assets (org_id, branch_id) where deleted_at is null;
create index if not exists sm_assets_terminal_id_idx on sm_assets (org_id, terminal_id) where deleted_at is null;
create index if not exists sm_assets_warranty_end_idx on sm_assets (org_id, warranty_end) where deleted_at is null;
create index if not exists sm_assets_state_idx on sm_assets (org_id, state) where deleted_at is null;
create index if not exists sm_assets_workspace_acc_idx on sm_assets (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_assets_unit_acc_idx on sm_assets (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_assets_domain_acc_idx on sm_assets (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_assets_assigned_to_idx on sm_assets (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_assets_managed_by_idx on sm_assets (org_id, managed_by) where deleted_at is null;
create index if not exists sm_assets_watch_list_gin on sm_assets using gin (watch_list);
drop trigger if exists sm_assets_sync on sm_assets;
create trigger sm_assets_sync before insert or update on sm_assets for each row execute function sm_sync_touch('asset');
create or replace trigger sm_assets_demo after insert on sm_assets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_assets_demo_t after update or delete on sm_assets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_assets enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:1', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۳ از ۲۸
-- ---------------------------------------------------------------------------
-- engine DDL 3/28 (e746bd22eb04)
-- asset_acknowledgement: تعهدنامه‌های دارایی
do $cols$
begin
  if to_regclass('sm_asset_acks') is not null then
    alter table sm_asset_acks add column if not exists workspace_id uuid;
    alter table sm_asset_acks add column if not exists domain_id uuid;
    alter table sm_asset_acks add column if not exists unit_id uuid;
    alter table sm_asset_acks add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_acks add column if not exists created_by uuid;
    alter table sm_asset_acks add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_acks add column if not exists updated_by uuid;
    alter table sm_asset_acks add column if not exists rev bigint not null default 0;
    alter table sm_asset_acks add column if not exists version integer not null default 1;
    alter table sm_asset_acks add column if not exists deleted_at timestamptz;
    alter table sm_asset_acks add column if not exists origin text;
    alter table sm_asset_acks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_acks add column if not exists no integer;
    alter table sm_asset_acks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ACK' || no::text else 'ACK' || lpad(no::text, 6, '0') end) stored;
    alter table sm_asset_acks add column if not exists asset_id uuid;
    alter table sm_asset_acks add column if not exists user_id uuid;
    alter table sm_asset_acks add column if not exists assignment_id uuid;
    alter table sm_asset_acks add column if not exists requested_at timestamptz;
    alter table sm_asset_acks add column if not exists decided_at timestamptz;
    alter table sm_asset_acks add column if not exists terms text;
    alter table sm_asset_acks add column if not exists signature_name text;
    alter table sm_asset_acks add column if not exists decision_note text;
    alter table sm_asset_acks add column if not exists reminded_at timestamptz;
    alter table sm_asset_acks add column if not exists label text;
    alter table sm_asset_acks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_asset_acks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ACK' || no::text else 'ACK' || lpad(no::text, 6, '0') end) stored,
  asset_id uuid,
  user_id uuid,
  assignment_id uuid,
  requested_at timestamptz,
  decided_at timestamptz,
  terms text,
  signature_name text,
  decision_note text,
  reminded_at timestamptz,
  label text,
  state text,
  search_9e3cdfc8 text generated always as (translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_asset_acks', 'search_9e3cdfc8', $x$translate(coalesce(label, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_asset_acks_search_9e3cdfc8_trgm', 'sm_asset_acks', 'search_9e3cdfc8', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_asset_acks_search_custom_trgm', 'sm_asset_acks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_asset_acks_no_uk on sm_asset_acks (org_id, no);
create index if not exists sm_asset_acks_rev_idx on sm_asset_acks (org_id, rev);
create index if not exists sm_asset_acks_upd_idx on sm_asset_acks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_acks_crt_idx on sm_asset_acks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_acks_asset_id_idx on sm_asset_acks (org_id, asset_id) where deleted_at is null;
create index if not exists sm_asset_acks_state_idx on sm_asset_acks (org_id, state) where deleted_at is null;
create index if not exists sm_asset_acks_workspace_acc_idx on sm_asset_acks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_asset_acks_unit_acc_idx on sm_asset_acks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_asset_acks_domain_acc_idx on sm_asset_acks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_asset_acks_user_id_idx on sm_asset_acks (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_asset_acks_sync on sm_asset_acks;
create trigger sm_asset_acks_sync before insert or update on sm_asset_acks for each row execute function sm_sync_touch('asset_acknowledgement');
create or replace trigger sm_asset_acks_demo after insert on sm_asset_acks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_acks_demo_t after update or delete on sm_asset_acks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_acks enable row level security;

-- asset_assignment: تاریخچهٔ تحویل دارایی‌ها
do $cols$
begin
  if to_regclass('sm_asset_assignments') is not null then
    alter table sm_asset_assignments add column if not exists workspace_id uuid;
    alter table sm_asset_assignments add column if not exists domain_id uuid;
    alter table sm_asset_assignments add column if not exists unit_id uuid;
    alter table sm_asset_assignments add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_assignments add column if not exists created_by uuid;
    alter table sm_asset_assignments add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_assignments add column if not exists updated_by uuid;
    alter table sm_asset_assignments add column if not exists rev bigint not null default 0;
    alter table sm_asset_assignments add column if not exists version integer not null default 1;
    alter table sm_asset_assignments add column if not exists deleted_at timestamptz;
    alter table sm_asset_assignments add column if not exists origin text;
    alter table sm_asset_assignments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_assignments add column if not exists asset_id uuid;
    alter table sm_asset_assignments add column if not exists assigned_to uuid;
    alter table sm_asset_assignments add column if not exists department_id uuid;
    alter table sm_asset_assignments add column if not exists location_id uuid;
    alter table sm_asset_assignments add column if not exists usage_type text;
    alter table sm_asset_assignments add column if not exists from_at timestamptz;
    alter table sm_asset_assignments add column if not exists to_at timestamptz;
    alter table sm_asset_assignments add column if not exists expected_return_at date;
    alter table sm_asset_assignments add column if not exists condition_out text;
    alter table sm_asset_assignments add column if not exists condition_in text;
    alter table sm_asset_assignments add column if not exists assigned_by uuid;
    alter table sm_asset_assignments add column if not exists acknowledgement_id uuid;
    alter table sm_asset_assignments add column if not exists request_item_id uuid;
    alter table sm_asset_assignments add column if not exists note text;
    alter table sm_asset_assignments add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_asset_assignments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  asset_id uuid,
  assigned_to uuid,
  department_id uuid,
  location_id uuid,
  usage_type text,
  from_at timestamptz,
  to_at timestamptz,
  expected_return_at date,
  condition_out text,
  condition_in text,
  assigned_by uuid,
  acknowledgement_id uuid,
  request_item_id uuid,
  note text,
  label text
);
create index if not exists sm_asset_assignments_rev_idx on sm_asset_assignments (org_id, rev);
create index if not exists sm_asset_assignments_upd_idx on sm_asset_assignments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_assignments_crt_idx on sm_asset_assignments (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_assignments_asset_id_idx on sm_asset_assignments (org_id, asset_id) where deleted_at is null;
create index if not exists sm_asset_assignments_workspace_acc_idx on sm_asset_assignments (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_asset_assignments_unit_acc_idx on sm_asset_assignments (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_asset_assignments_domain_acc_idx on sm_asset_assignments (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_asset_assignments_assigned_to_idx on sm_asset_assignments (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_asset_assignments_sync on sm_asset_assignments;
create trigger sm_asset_assignments_sync before insert or update on sm_asset_assignments for each row execute function sm_sync_touch('asset_assignment');
create or replace trigger sm_asset_assignments_demo after insert on sm_asset_assignments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_assignments_demo_t after update or delete on sm_asset_assignments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_assignments enable row level security;

-- asset_custody: زنجیرهٔ نگهداری دارایی‌ها
do $cols$
begin
  if to_regclass('sm_asset_custody') is not null then
    alter table sm_asset_custody add column if not exists workspace_id uuid;
    alter table sm_asset_custody add column if not exists domain_id uuid;
    alter table sm_asset_custody add column if not exists unit_id uuid;
    alter table sm_asset_custody add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_custody add column if not exists created_by uuid;
    alter table sm_asset_custody add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_custody add column if not exists updated_by uuid;
    alter table sm_asset_custody add column if not exists rev bigint not null default 0;
    alter table sm_asset_custody add column if not exists version integer not null default 1;
    alter table sm_asset_custody add column if not exists deleted_at timestamptz;
    alter table sm_asset_custody add column if not exists origin text;
    alter table sm_asset_custody add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_custody add column if not exists asset_id uuid;
    alter table sm_asset_custody add column if not exists seq integer;
    alter table sm_asset_custody add column if not exists at timestamptz;
    alter table sm_asset_custody add column if not exists event text;
    alter table sm_asset_custody add column if not exists branch_id uuid;
    alter table sm_asset_custody add column if not exists from_branch_id uuid;
    alter table sm_asset_custody add column if not exists holder_id uuid;
    alter table sm_asset_custody add column if not exists from_holder_id uuid;
    alter table sm_asset_custody add column if not exists actor_id uuid;
    alter table sm_asset_custody add column if not exists reference text;
    alter table sm_asset_custody add column if not exists note text;
    alter table sm_asset_custody add column if not exists prev_hash text;
    alter table sm_asset_custody add column if not exists hash text;
    alter table sm_asset_custody add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_asset_custody (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  asset_id uuid,
  seq integer,
  at timestamptz,
  event text,
  branch_id uuid,
  from_branch_id uuid,
  holder_id uuid,
  from_holder_id uuid,
  actor_id uuid,
  reference text,
  note text,
  prev_hash text,
  hash text,
  label text
);
create index if not exists sm_asset_custody_rev_idx on sm_asset_custody (org_id, rev);
create index if not exists sm_asset_custody_upd_idx on sm_asset_custody (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_custody_crt_idx on sm_asset_custody (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_custody_asset_id_idx on sm_asset_custody (org_id, asset_id) where deleted_at is null;
create index if not exists sm_asset_custody_branch_id_idx on sm_asset_custody (org_id, branch_id) where deleted_at is null;
drop trigger if exists sm_asset_custody_sync on sm_asset_custody;
create trigger sm_asset_custody_sync before insert or update on sm_asset_custody for each row execute function sm_sync_touch('asset_custody');
create or replace trigger sm_asset_custody_demo after insert on sm_asset_custody for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_custody_demo_t after update or delete on sm_asset_custody for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_custody enable row level security;

-- asset_model: مدل‌های کالا
do $cols$
begin
  if to_regclass('sm_asset_models') is not null then
    alter table sm_asset_models add column if not exists workspace_id uuid;
    alter table sm_asset_models add column if not exists domain_id uuid;
    alter table sm_asset_models add column if not exists unit_id uuid;
    alter table sm_asset_models add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_models add column if not exists created_by uuid;
    alter table sm_asset_models add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_models add column if not exists updated_by uuid;
    alter table sm_asset_models add column if not exists rev bigint not null default 0;
    alter table sm_asset_models add column if not exists version integer not null default 1;
    alter table sm_asset_models add column if not exists deleted_at timestamptz;
    alter table sm_asset_models add column if not exists origin text;
    alter table sm_asset_models add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_models add column if not exists no integer;
    alter table sm_asset_models add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'MDL' || no::text else 'MDL' || lpad(no::text, 5, '0') end) stored;
    alter table sm_asset_models add column if not exists name text;
    alter table sm_asset_models add column if not exists manufacturer_id uuid;
    alter table sm_asset_models add column if not exists model_number text;
    alter table sm_asset_models add column if not exists category text;
    alter table sm_asset_models add column if not exists asset_class text;
    alter table sm_asset_models add column if not exists tracking text;
    alter table sm_asset_models add column if not exists ci_class text;
    alter table sm_asset_models add column if not exists status text;
    alter table sm_asset_models add column if not exists data_bearing boolean not null default false;
    alter table sm_asset_models add column if not exists specs text;
    alter table sm_asset_models add column if not exists procurement_mode text;
    alter table sm_asset_models add column if not exists unit_cost numeric;
    alter table sm_asset_models add column if not exists default_vendor_id uuid;
    alter table sm_asset_models add column if not exists warranty_months integer;
    alter table sm_asset_models add column if not exists useful_life_months integer;
    alter table sm_asset_models add column if not exists depreciation_rule_id uuid;
    alter table sm_asset_models add column if not exists release_date date;
    alter table sm_asset_models add column if not exists end_of_sale date;
    alter table sm_asset_models add column if not exists eol_date date;
    alter table sm_asset_models add column if not exists lifecycle_source text;
    alter table sm_asset_models add column if not exists requires_acknowledgement boolean not null default false;
    alter table sm_asset_models add column if not exists acknowledgement_terms text;
  end if;
end
$cols$;
create table if not exists sm_asset_models (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'MDL' || no::text else 'MDL' || lpad(no::text, 5, '0') end) stored,
  name text,
  manufacturer_id uuid,
  model_number text,
  category text,
  asset_class text,
  tracking text,
  ci_class text,
  status text,
  data_bearing boolean not null default false,
  specs text,
  procurement_mode text,
  unit_cost numeric,
  default_vendor_id uuid,
  warranty_months integer,
  useful_life_months integer,
  depreciation_rule_id uuid,
  release_date date,
  end_of_sale date,
  eol_date date,
  lifecycle_source text,
  requires_acknowledgement boolean not null default false,
  acknowledgement_terms text,
  search_2a1e757d text generated always as (translate(coalesce(name, '') || ' ' || coalesce(model_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_asset_models', 'search_2a1e757d', $x$translate(coalesce(name, '') || ' ' || coalesce(model_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_asset_models_search_2a1e757d_trgm', 'sm_asset_models', 'search_2a1e757d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_asset_models_search_custom_trgm', 'sm_asset_models', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_asset_models_no_uk on sm_asset_models (org_id, no);
create index if not exists sm_asset_models_rev_idx on sm_asset_models (org_id, rev);
create index if not exists sm_asset_models_upd_idx on sm_asset_models (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_models_crt_idx on sm_asset_models (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_asset_models_sync on sm_asset_models;
create trigger sm_asset_models_sync before insert or update on sm_asset_models for each row execute function sm_sync_touch('asset_model');
create or replace trigger sm_asset_models_demo after insert on sm_asset_models for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_models_demo_t after update or delete on sm_asset_models for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_models enable row level security;

-- asset_reservation: رزروهای دارایی امانی
do $cols$
begin
  if to_regclass('sm_asset_reservations') is not null then
    alter table sm_asset_reservations add column if not exists workspace_id uuid;
    alter table sm_asset_reservations add column if not exists domain_id uuid;
    alter table sm_asset_reservations add column if not exists unit_id uuid;
    alter table sm_asset_reservations add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_reservations add column if not exists created_by uuid;
    alter table sm_asset_reservations add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_reservations add column if not exists updated_by uuid;
    alter table sm_asset_reservations add column if not exists rev bigint not null default 0;
    alter table sm_asset_reservations add column if not exists version integer not null default 1;
    alter table sm_asset_reservations add column if not exists deleted_at timestamptz;
    alter table sm_asset_reservations add column if not exists origin text;
    alter table sm_asset_reservations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_reservations add column if not exists no integer;
    alter table sm_asset_reservations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RSV' || no::text else 'RSV' || lpad(no::text, 6, '0') end) stored;
    alter table sm_asset_reservations add column if not exists purpose text;
    alter table sm_asset_reservations add column if not exists user_id uuid;
    alter table sm_asset_reservations add column if not exists model_id uuid;
    alter table sm_asset_reservations add column if not exists asset_id uuid;
    alter table sm_asset_reservations add column if not exists from_date date;
    alter table sm_asset_reservations add column if not exists to_date date;
    alter table sm_asset_reservations add column if not exists note text;
    alter table sm_asset_reservations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_asset_reservations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RSV' || no::text else 'RSV' || lpad(no::text, 6, '0') end) stored,
  purpose text,
  user_id uuid,
  model_id uuid,
  asset_id uuid,
  from_date date,
  to_date date,
  note text,
  state text,
  search_062cb4a6 text generated always as (translate(coalesce(purpose, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_asset_reservations', 'search_062cb4a6', $x$translate(coalesce(purpose, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_asset_reservations_search_062cb4a6_trgm', 'sm_asset_reservations', 'search_062cb4a6', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_asset_reservations_search_custom_trgm', 'sm_asset_reservations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_asset_reservations_no_uk on sm_asset_reservations (org_id, no);
create index if not exists sm_asset_reservations_rev_idx on sm_asset_reservations (org_id, rev);
create index if not exists sm_asset_reservations_upd_idx on sm_asset_reservations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_reservations_crt_idx on sm_asset_reservations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_reservations_state_idx on sm_asset_reservations (org_id, state) where deleted_at is null;
create index if not exists sm_asset_reservations_workspace_acc_idx on sm_asset_reservations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_asset_reservations_unit_acc_idx on sm_asset_reservations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_asset_reservations_domain_acc_idx on sm_asset_reservations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_asset_reservations_user_id_idx on sm_asset_reservations (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_asset_reservations_sync on sm_asset_reservations;
create trigger sm_asset_reservations_sync before insert or update on sm_asset_reservations for each row execute function sm_sync_touch('asset_reservation');
create or replace trigger sm_asset_reservations_demo after insert on sm_asset_reservations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_reservations_demo_t after update or delete on sm_asset_reservations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_reservations enable row level security;

-- asset_transfer: حواله‌های انتقال دارایی
do $cols$
begin
  if to_regclass('sm_asset_transfers') is not null then
    alter table sm_asset_transfers add column if not exists workspace_id uuid;
    alter table sm_asset_transfers add column if not exists domain_id uuid;
    alter table sm_asset_transfers add column if not exists unit_id uuid;
    alter table sm_asset_transfers add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_transfers add column if not exists created_by uuid;
    alter table sm_asset_transfers add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_transfers add column if not exists updated_by uuid;
    alter table sm_asset_transfers add column if not exists rev bigint not null default 0;
    alter table sm_asset_transfers add column if not exists version integer not null default 1;
    alter table sm_asset_transfers add column if not exists deleted_at timestamptz;
    alter table sm_asset_transfers add column if not exists origin text;
    alter table sm_asset_transfers add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_transfers add column if not exists no integer;
    alter table sm_asset_transfers add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'TRF' || no::text else 'TRF' || lpad(no::text, 6, '0') end) stored;
    alter table sm_asset_transfers add column if not exists title text;
    alter table sm_asset_transfers add column if not exists reason text;
    alter table sm_asset_transfers add column if not exists from_branch_id uuid;
    alter table sm_asset_transfers add column if not exists to_branch_id uuid;
    alter table sm_asset_transfers add column if not exists from_stockroom_id uuid;
    alter table sm_asset_transfers add column if not exists to_stockroom_id uuid;
    alter table sm_asset_transfers add column if not exists requested_by uuid;
    alter table sm_asset_transfers add column if not exists approval text;
    alter table sm_asset_transfers add column if not exists item_count integer;
    alter table sm_asset_transfers add column if not exists carrier text;
    alter table sm_asset_transfers add column if not exists waybill_no text;
    alter table sm_asset_transfers add column if not exists dispatched_at timestamptz;
    alter table sm_asset_transfers add column if not exists dispatched_by uuid;
    alter table sm_asset_transfers add column if not exists notes text;
    alter table sm_asset_transfers add column if not exists received_at timestamptz;
    alter table sm_asset_transfers add column if not exists received_by uuid;
    alter table sm_asset_transfers add column if not exists received_count integer;
    alter table sm_asset_transfers add column if not exists discrepancy_count integer;
    alter table sm_asset_transfers add column if not exists receipt_note text;
    alter table sm_asset_transfers add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_asset_transfers (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'TRF' || no::text else 'TRF' || lpad(no::text, 6, '0') end) stored,
  title text,
  reason text,
  from_branch_id uuid,
  to_branch_id uuid,
  from_stockroom_id uuid,
  to_stockroom_id uuid,
  requested_by uuid,
  approval text,
  item_count integer,
  carrier text,
  waybill_no text,
  dispatched_at timestamptz,
  dispatched_by uuid,
  notes text,
  received_at timestamptz,
  received_by uuid,
  received_count integer,
  discrepancy_count integer,
  receipt_note text,
  state text,
  search_4d12f1bb text generated always as (translate(coalesce(title, '') || ' ' || coalesce(waybill_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_asset_transfers', 'search_4d12f1bb', $x$translate(coalesce(title, '') || ' ' || coalesce(waybill_no, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_asset_transfers_search_4d12f1bb_trgm', 'sm_asset_transfers', 'search_4d12f1bb', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_asset_transfers_search_custom_trgm', 'sm_asset_transfers', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_asset_transfers_no_uk on sm_asset_transfers (org_id, no);
create index if not exists sm_asset_transfers_rev_idx on sm_asset_transfers (org_id, rev);
create index if not exists sm_asset_transfers_upd_idx on sm_asset_transfers (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_transfers_crt_idx on sm_asset_transfers (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_transfers_from_branch_id_idx on sm_asset_transfers (org_id, from_branch_id) where deleted_at is null;
create index if not exists sm_asset_transfers_to_branch_id_idx on sm_asset_transfers (org_id, to_branch_id) where deleted_at is null;
create index if not exists sm_asset_transfers_state_idx on sm_asset_transfers (org_id, state) where deleted_at is null;
create index if not exists sm_asset_transfers_workspace_acc_idx on sm_asset_transfers (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_asset_transfers_unit_acc_idx on sm_asset_transfers (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_asset_transfers_domain_acc_idx on sm_asset_transfers (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_asset_transfers_requested_by_idx on sm_asset_transfers (org_id, requested_by) where deleted_at is null;
drop trigger if exists sm_asset_transfers_sync on sm_asset_transfers;
create trigger sm_asset_transfers_sync before insert or update on sm_asset_transfers for each row execute function sm_sync_touch('asset_transfer');
create or replace trigger sm_asset_transfers_demo after insert on sm_asset_transfers for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_transfers_demo_t after update or delete on sm_asset_transfers for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_transfers enable row level security;

-- asset_transfer_item: اقلام حواله‌های انتقال
do $cols$
begin
  if to_regclass('sm_asset_transfer_items') is not null then
    alter table sm_asset_transfer_items add column if not exists workspace_id uuid;
    alter table sm_asset_transfer_items add column if not exists domain_id uuid;
    alter table sm_asset_transfer_items add column if not exists unit_id uuid;
    alter table sm_asset_transfer_items add column if not exists created_at timestamptz not null default now();
    alter table sm_asset_transfer_items add column if not exists created_by uuid;
    alter table sm_asset_transfer_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_asset_transfer_items add column if not exists updated_by uuid;
    alter table sm_asset_transfer_items add column if not exists rev bigint not null default 0;
    alter table sm_asset_transfer_items add column if not exists version integer not null default 1;
    alter table sm_asset_transfer_items add column if not exists deleted_at timestamptz;
    alter table sm_asset_transfer_items add column if not exists origin text;
    alter table sm_asset_transfer_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_asset_transfer_items add column if not exists transfer_id uuid;
    alter table sm_asset_transfer_items add column if not exists asset_id uuid;
    alter table sm_asset_transfer_items add column if not exists condition_out text;
    alter table sm_asset_transfer_items add column if not exists result text;
    alter table sm_asset_transfer_items add column if not exists condition_in text;
    alter table sm_asset_transfer_items add column if not exists note text;
    alter table sm_asset_transfer_items add column if not exists from_branch_id uuid;
    alter table sm_asset_transfer_items add column if not exists to_branch_id uuid;
    alter table sm_asset_transfer_items add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_asset_transfer_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  transfer_id uuid,
  asset_id uuid,
  condition_out text,
  result text,
  condition_in text,
  note text,
  from_branch_id uuid,
  to_branch_id uuid,
  label text
);
create index if not exists sm_asset_transfer_items_rev_idx on sm_asset_transfer_items (org_id, rev);
create index if not exists sm_asset_transfer_items_upd_idx on sm_asset_transfer_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_transfer_items_crt_idx on sm_asset_transfer_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_asset_transfer_items_transfer_id_idx on sm_asset_transfer_items (org_id, transfer_id) where deleted_at is null;
create index if not exists sm_asset_transfer_items_asset_id_idx on sm_asset_transfer_items (org_id, asset_id) where deleted_at is null;
create index if not exists sm_asset_transfer_items_from_branch_id_idx on sm_asset_transfer_items (org_id, from_branch_id) where deleted_at is null;
create index if not exists sm_asset_transfer_items_to_branch_id_idx on sm_asset_transfer_items (org_id, to_branch_id) where deleted_at is null;
create unique index if not exists sm_asset_transfer_items_transfer_id_asset_id_uk on sm_asset_transfer_items (org_id, transfer_id, asset_id) where deleted_at is null;
drop trigger if exists sm_asset_transfer_items_sync on sm_asset_transfer_items;
create trigger sm_asset_transfer_items_sync before insert or update on sm_asset_transfer_items for each row execute function sm_sync_touch('asset_transfer_item');
create or replace trigger sm_asset_transfer_items_demo after insert on sm_asset_transfer_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_asset_transfer_items_demo_t after update or delete on sm_asset_transfer_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_asset_transfer_items enable row level security;

-- assignment_rule: قواعد ارجاع
do $cols$
begin
  if to_regclass('sm_assignment_rules') is not null then
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
    alter table sm_assignment_rules add column if not exists ai_group boolean not null default false;
    alter table sm_assignment_rules add column if not exists sort_order integer;
    alter table sm_assignment_rules add column if not exists active boolean not null default true;
    alter table sm_assignment_rules add column if not exists description text;
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  table_key text,
  condition jsonb,
  group_id uuid,
  method text,
  user_id uuid,
  skills jsonb,
  ai_group boolean not null default false,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_assignment_rules_rev_idx on sm_assignment_rules (org_id, rev);
create index if not exists sm_assignment_rules_upd_idx on sm_assignment_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_assignment_rules_crt_idx on sm_assignment_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_assignment_rules_sync on sm_assignment_rules;
create trigger sm_assignment_rules_sync before insert or update on sm_assignment_rules for each row execute function sm_sync_touch('assignment_rule');
create or replace trigger sm_assignment_rules_demo after insert on sm_assignment_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_assignment_rules_demo_t after update or delete on sm_assignment_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_assignment_rules enable row level security;

-- bia: تحلیل‌های اثر کسب‌وکار
do $cols$
begin
  if to_regclass('sm_bias') is not null then
    alter table sm_bias add column if not exists workspace_id uuid;
    alter table sm_bias add column if not exists domain_id uuid;
    alter table sm_bias add column if not exists unit_id uuid;
    alter table sm_bias add column if not exists created_at timestamptz not null default now();
    alter table sm_bias add column if not exists created_by uuid;
    alter table sm_bias add column if not exists updated_at timestamptz not null default now();
    alter table sm_bias add column if not exists updated_by uuid;
    alter table sm_bias add column if not exists rev bigint not null default 0;
    alter table sm_bias add column if not exists version integer not null default 1;
    alter table sm_bias add column if not exists deleted_at timestamptz;
    alter table sm_bias add column if not exists origin text;
    alter table sm_bias add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_bias add column if not exists no integer;
    alter table sm_bias add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BIA' || no::text else 'BIA' || lpad(no::text, 5, '0') end) stored;
    alter table sm_bias add column if not exists title text;
    alter table sm_bias add column if not exists service_id uuid;
    alter table sm_bias add column if not exists activity text;
    alter table sm_bias add column if not exists org_unit_id uuid;
    alter table sm_bias add column if not exists owner_id uuid;
    alter table sm_bias add column if not exists respondent_id uuid;
    alter table sm_bias add column if not exists assignment_group_id uuid;
    alter table sm_bias add column if not exists vital boolean not null default false;
    alter table sm_bias add column if not exists is_template boolean not null default false;
    alter table sm_bias add column if not exists impacts jsonb;
    alter table sm_bias add column if not exists tolerance integer;
    alter table sm_bias add column if not exists proposed_rto bigint;
    alter table sm_bias add column if not exists mtpd bigint;
    alter table sm_bias add column if not exists rto bigint;
    alter table sm_bias add column if not exists rpo bigint;
    alter table sm_bias add column if not exists mbco text;
    alter table sm_bias add column if not exists depends_cis jsonb;
    alter table sm_bias add column if not exists depends_services jsonb;
    alter table sm_bias add column if not exists key_people jsonb;
    alter table sm_bias add column if not exists sites jsonb;
    alter table sm_bias add column if not exists suppliers text;
    alter table sm_bias add column if not exists review_due date;
    alter table sm_bias add column if not exists approved_at timestamptz;
    alter table sm_bias add column if not exists approved_by uuid;
    alter table sm_bias add column if not exists notes text;
    alter table sm_bias add column if not exists watch_list jsonb;
    alter table sm_bias add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_bias (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BIA' || no::text else 'BIA' || lpad(no::text, 5, '0') end) stored,
  title text,
  service_id uuid,
  activity text,
  org_unit_id uuid,
  owner_id uuid,
  respondent_id uuid,
  assignment_group_id uuid,
  vital boolean not null default false,
  is_template boolean not null default false,
  impacts jsonb,
  tolerance integer,
  proposed_rto bigint,
  mtpd bigint,
  rto bigint,
  rpo bigint,
  mbco text,
  depends_cis jsonb,
  depends_services jsonb,
  key_people jsonb,
  sites jsonb,
  suppliers text,
  review_due date,
  approved_at timestamptz,
  approved_by uuid,
  notes text,
  watch_list jsonb,
  state text,
  search_ad195841 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(activity, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_bias', 'search_ad195841', $x$translate(coalesce(title, '') || ' ' || coalesce(activity, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_bias_search_ad195841_trgm', 'sm_bias', 'search_ad195841', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_bias_search_custom_trgm', 'sm_bias', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_bias_no_uk on sm_bias (org_id, no);
create index if not exists sm_bias_rev_idx on sm_bias (org_id, rev);
create index if not exists sm_bias_upd_idx on sm_bias (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_bias_crt_idx on sm_bias (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_bias_state_idx on sm_bias (org_id, state) where deleted_at is null;
create index if not exists sm_bias_workspace_acc_idx on sm_bias (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_bias_unit_acc_idx on sm_bias (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_bias_domain_acc_idx on sm_bias (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_bias_owner_id_idx on sm_bias (org_id, owner_id) where deleted_at is null;
create index if not exists sm_bias_respondent_id_idx on sm_bias (org_id, respondent_id) where deleted_at is null;
create index if not exists sm_bias_watch_list_gin on sm_bias using gin (watch_list);
drop trigger if exists sm_bias_sync on sm_bias;
create trigger sm_bias_sync before insert or update on sm_bias for each row execute function sm_sync_touch('bia');
create or replace trigger sm_bias_demo after insert on sm_bias for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_bias_demo_t after update or delete on sm_bias for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_bias enable row level security;

-- branch_attestation: تأییدهای دوره‌ای اموال شعبه‌ها
do $cols$
begin
  if to_regclass('sm_branch_attestations') is not null then
    alter table sm_branch_attestations add column if not exists workspace_id uuid;
    alter table sm_branch_attestations add column if not exists domain_id uuid;
    alter table sm_branch_attestations add column if not exists unit_id uuid;
    alter table sm_branch_attestations add column if not exists created_at timestamptz not null default now();
    alter table sm_branch_attestations add column if not exists created_by uuid;
    alter table sm_branch_attestations add column if not exists updated_at timestamptz not null default now();
    alter table sm_branch_attestations add column if not exists updated_by uuid;
    alter table sm_branch_attestations add column if not exists rev bigint not null default 0;
    alter table sm_branch_attestations add column if not exists version integer not null default 1;
    alter table sm_branch_attestations add column if not exists deleted_at timestamptz;
    alter table sm_branch_attestations add column if not exists origin text;
    alter table sm_branch_attestations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_branch_attestations add column if not exists no integer;
    alter table sm_branch_attestations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ATT' || no::text else 'ATT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_branch_attestations add column if not exists title text;
    alter table sm_branch_attestations add column if not exists branch_id uuid;
    alter table sm_branch_attestations add column if not exists manager_id uuid;
    alter table sm_branch_attestations add column if not exists period_label text;
    alter table sm_branch_attestations add column if not exists due_date date;
    alter table sm_branch_attestations add column if not exists asset_count integer;
    alter table sm_branch_attestations add column if not exists exception_count integer;
    alter table sm_branch_attestations add column if not exists overdue boolean not null default false;
    alter table sm_branch_attestations add column if not exists exceptions jsonb;
    alter table sm_branch_attestations add column if not exists signed_name text;
    alter table sm_branch_attestations add column if not exists attested_at timestamptz;
    alter table sm_branch_attestations add column if not exists attested_by uuid;
    alter table sm_branch_attestations add column if not exists review_note text;
    alter table sm_branch_attestations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_branch_attestations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ATT' || no::text else 'ATT' || lpad(no::text, 6, '0') end) stored,
  title text,
  branch_id uuid,
  manager_id uuid,
  period_label text,
  due_date date,
  asset_count integer,
  exception_count integer,
  overdue boolean not null default false,
  exceptions jsonb,
  signed_name text,
  attested_at timestamptz,
  attested_by uuid,
  review_note text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_branch_attestations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_branch_attestations_search_cae18f1d_trgm', 'sm_branch_attestations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_branch_attestations_search_custom_trgm', 'sm_branch_attestations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_branch_attestations_no_uk on sm_branch_attestations (org_id, no);
create index if not exists sm_branch_attestations_rev_idx on sm_branch_attestations (org_id, rev);
create index if not exists sm_branch_attestations_upd_idx on sm_branch_attestations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_branch_attestations_crt_idx on sm_branch_attestations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_branch_attestations_branch_id_idx on sm_branch_attestations (org_id, branch_id) where deleted_at is null;
create index if not exists sm_branch_attestations_state_idx on sm_branch_attestations (org_id, state) where deleted_at is null;
create index if not exists sm_branch_attestations_workspace_acc_idx on sm_branch_attestations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_branch_attestations_unit_acc_idx on sm_branch_attestations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_branch_attestations_domain_acc_idx on sm_branch_attestations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_branch_attestations_manager_id_idx on sm_branch_attestations (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_branch_attestations_sync on sm_branch_attestations;
create trigger sm_branch_attestations_sync before insert or update on sm_branch_attestations for each row execute function sm_sync_touch('branch_attestation');
create or replace trigger sm_branch_attestations_demo after insert on sm_branch_attestations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_branch_attestations_demo_t after update or delete on sm_branch_attestations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_branch_attestations enable row level security;

-- budget: بودجه‌ها
do $cols$
begin
  if to_regclass('sm_budgets') is not null then
    alter table sm_budgets add column if not exists workspace_id uuid;
    alter table sm_budgets add column if not exists domain_id uuid;
    alter table sm_budgets add column if not exists unit_id uuid;
    alter table sm_budgets add column if not exists created_at timestamptz not null default now();
    alter table sm_budgets add column if not exists created_by uuid;
    alter table sm_budgets add column if not exists updated_at timestamptz not null default now();
    alter table sm_budgets add column if not exists updated_by uuid;
    alter table sm_budgets add column if not exists rev bigint not null default 0;
    alter table sm_budgets add column if not exists version integer not null default 1;
    alter table sm_budgets add column if not exists deleted_at timestamptz;
    alter table sm_budgets add column if not exists origin text;
    alter table sm_budgets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_budgets add column if not exists no integer;
    alter table sm_budgets add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BDG' || no::text else 'BDG' || lpad(no::text, 5, '0') end) stored;
    alter table sm_budgets add column if not exists name text;
    alter table sm_budgets add column if not exists fiscal_year_id uuid;
    alter table sm_budgets add column if not exists cost_center_id uuid;
    alter table sm_budgets add column if not exists owner_id uuid;
    alter table sm_budgets add column if not exists total numeric;
    alter table sm_budgets add column if not exists alert_percent integer;
    alter table sm_budgets add column if not exists alerted_percent integer;
    alter table sm_budgets add column if not exists approval text;
    alter table sm_budgets add column if not exists notes text;
    alter table sm_budgets add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_budgets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'BDG' || no::text else 'BDG' || lpad(no::text, 5, '0') end) stored,
  name text,
  fiscal_year_id uuid,
  cost_center_id uuid,
  owner_id uuid,
  total numeric,
  alert_percent integer,
  alerted_percent integer,
  approval text,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_budgets', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_budgets_search_56291d9d_trgm', 'sm_budgets', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_budgets_search_custom_trgm', 'sm_budgets', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_budgets_no_uk on sm_budgets (org_id, no);
create index if not exists sm_budgets_rev_idx on sm_budgets (org_id, rev);
create index if not exists sm_budgets_upd_idx on sm_budgets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_budgets_crt_idx on sm_budgets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_budgets_fiscal_year_id_idx on sm_budgets (org_id, fiscal_year_id) where deleted_at is null;
create index if not exists sm_budgets_cost_center_id_idx on sm_budgets (org_id, cost_center_id) where deleted_at is null;
create index if not exists sm_budgets_state_idx on sm_budgets (org_id, state) where deleted_at is null;
create unique index if not exists sm_budgets_fiscal_year_id_cost_center_id_name_uk on sm_budgets (org_id, fiscal_year_id, cost_center_id, name) where deleted_at is null;
create index if not exists sm_budgets_workspace_acc_idx on sm_budgets (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_budgets_unit_acc_idx on sm_budgets (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_budgets_domain_acc_idx on sm_budgets (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_budgets_owner_id_idx on sm_budgets (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_budgets_sync on sm_budgets;
create trigger sm_budgets_sync before insert or update on sm_budgets for each row execute function sm_sync_touch('budget');
create or replace trigger sm_budgets_demo after insert on sm_budgets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_budgets_demo_t after update or delete on sm_budgets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_budgets enable row level security;

-- budget_line: سطرهای بودجه
do $cols$
begin
  if to_regclass('sm_budget_lines') is not null then
    alter table sm_budget_lines add column if not exists workspace_id uuid;
    alter table sm_budget_lines add column if not exists domain_id uuid;
    alter table sm_budget_lines add column if not exists unit_id uuid;
    alter table sm_budget_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_budget_lines add column if not exists created_by uuid;
    alter table sm_budget_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_budget_lines add column if not exists updated_by uuid;
    alter table sm_budget_lines add column if not exists rev bigint not null default 0;
    alter table sm_budget_lines add column if not exists version integer not null default 1;
    alter table sm_budget_lines add column if not exists deleted_at timestamptz;
    alter table sm_budget_lines add column if not exists origin text;
    alter table sm_budget_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_budget_lines add column if not exists budget_id uuid;
    alter table sm_budget_lines add column if not exists cost_type_id uuid;
    alter table sm_budget_lines add column if not exists period_id uuid;
    alter table sm_budget_lines add column if not exists service_id uuid;
    alter table sm_budget_lines add column if not exists amount numeric;
    alter table sm_budget_lines add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_budget_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  budget_id uuid,
  cost_type_id uuid,
  period_id uuid,
  service_id uuid,
  amount numeric,
  note text
);
create index if not exists sm_budget_lines_rev_idx on sm_budget_lines (org_id, rev);
create index if not exists sm_budget_lines_upd_idx on sm_budget_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_budget_lines_crt_idx on sm_budget_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_budget_lines_budget_id_idx on sm_budget_lines (org_id, budget_id) where deleted_at is null;
drop trigger if exists sm_budget_lines_sync on sm_budget_lines;
create trigger sm_budget_lines_sync before insert or update on sm_budget_lines for each row execute function sm_sync_touch('budget_line');
create or replace trigger sm_budget_lines_demo after insert on sm_budget_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_budget_lines_demo_t after update or delete on sm_budget_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_budget_lines enable row level security;

-- business_capability: قابلیت‌های کسب‌وکار
do $cols$
begin
  if to_regclass('sm_business_capabilities') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  parent_id uuid,
  level integer,
  owner_id uuid,
  sort_order integer,
  coverage text,
  services jsonb,
  applications jsonb,
  description text
);
create index if not exists sm_business_capabilities_rev_idx on sm_business_capabilities (org_id, rev);
create index if not exists sm_business_capabilities_upd_idx on sm_business_capabilities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_business_capabilities_crt_idx on sm_business_capabilities (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_business_capabilities_parent_id_idx on sm_business_capabilities (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_business_capabilities_sync on sm_business_capabilities;
create trigger sm_business_capabilities_sync before insert or update on sm_business_capabilities for each row execute function sm_sync_touch('business_capability');
create or replace trigger sm_business_capabilities_demo after insert on sm_business_capabilities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_business_capabilities_demo_t after update or delete on sm_business_capabilities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_business_capabilities enable row level security;

-- business_rule: قواعد کسب‌وکار
do $cols$
begin
  if to_regclass('sm_business_rules') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  table_key text,
  timing text,
  events jsonb,
  condition jsonb,
  actions jsonb,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_business_rules_rev_idx on sm_business_rules (org_id, rev);
create index if not exists sm_business_rules_upd_idx on sm_business_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_business_rules_crt_idx on sm_business_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_business_rules_sync on sm_business_rules;
create trigger sm_business_rules_sync before insert or update on sm_business_rules for each row execute function sm_sync_touch('business_rule');
create or replace trigger sm_business_rules_demo after insert on sm_business_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_business_rules_demo_t after update or delete on sm_business_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_business_rules enable row level security;

-- cab: هیئت‌های CAB
do $cols$
begin
  if to_regclass('sm_cabs') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  active boolean not null default true,
  manager_id uuid,
  group_id uuid,
  members jsonb,
  meeting_weekday text,
  meeting_time text,
  meeting_minutes integer,
  quorum integer,
  location text,
  conference_url text,
  agenda_condition jsonb,
  description text
);
create index if not exists sm_cabs_rev_idx on sm_cabs (org_id, rev);
create index if not exists sm_cabs_upd_idx on sm_cabs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cabs_crt_idx on sm_cabs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_cabs_name_uk on sm_cabs (org_id, name) where deleted_at is null;
create index if not exists sm_cabs_workspace_acc_idx on sm_cabs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_cabs_unit_acc_idx on sm_cabs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_cabs_domain_acc_idx on sm_cabs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_cabs_manager_id_idx on sm_cabs (org_id, manager_id) where deleted_at is null;
create index if not exists sm_cabs_open_grp_idx on sm_cabs (org_id, group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_cabs_sync on sm_cabs;
create trigger sm_cabs_sync before insert or update on sm_cabs for each row execute function sm_sync_touch('cab');
create or replace trigger sm_cabs_demo after insert on sm_cabs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cabs_demo_t after update or delete on sm_cabs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cabs enable row level security;

-- cab_agenda_item: موردهای دستور جلسه
do $cols$
begin
  if to_regclass('sm_cab_agenda_items') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  title text,
  meeting_id uuid,
  change_id uuid,
  kind text,
  sort_order integer,
  presenter_id uuid,
  decision text,
  decided_by uuid,
  decided_at timestamptz,
  decision_notes text,
  votes jsonb
);
create index if not exists sm_cab_agenda_items_rev_idx on sm_cab_agenda_items (org_id, rev);
create index if not exists sm_cab_agenda_items_upd_idx on sm_cab_agenda_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_agenda_items_crt_idx on sm_cab_agenda_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_cab_agenda_items_meeting_id_idx on sm_cab_agenda_items (org_id, meeting_id) where deleted_at is null;
create index if not exists sm_cab_agenda_items_change_id_idx on sm_cab_agenda_items (org_id, change_id) where deleted_at is null;
create unique index if not exists sm_cab_agenda_items_meeting_id_change_id_kind_uk on sm_cab_agenda_items (org_id, meeting_id, change_id, kind) where deleted_at is null;
drop trigger if exists sm_cab_agenda_items_sync on sm_cab_agenda_items;
create trigger sm_cab_agenda_items_sync before insert or update on sm_cab_agenda_items for each row execute function sm_sync_touch('cab_agenda_item');
create or replace trigger sm_cab_agenda_items_demo after insert on sm_cab_agenda_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cab_agenda_items_demo_t after update or delete on sm_cab_agenda_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cab_agenda_items enable row level security;

-- cab_meeting: جلسه‌های CAB
do $cols$
begin
  if to_regclass('sm_cab_meetings') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'CABM' || no::text else 'CABM' || lpad(no::text, 5, '0') end) stored,
  title text,
  cab_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  chair_id uuid,
  attendees jsonb,
  present jsonb,
  location text,
  conference_url text,
  notes text,
  minutes text,
  action_items text,
  minutes_sent_at timestamptz,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text;
begin
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_cab_meetings', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_cab_meetings_search_cae18f1d_trgm', 'sm_cab_meetings', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_cab_meetings_search_custom_trgm', 'sm_cab_meetings', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
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
create or replace trigger sm_cab_meetings_demo after insert on sm_cab_meetings for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_cab_meetings_demo_t after update or delete on sm_cab_meetings for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_cab_meetings enable row level security;

-- calendar: تقویم‌های کاری
do $cols$
begin
  if to_regclass('sm_calendars') is not null then
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
  end if;
end
$cols$;
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
  custom jsonb not null default '{}'::jsonb,
  name text,
  timezone text,
  hours jsonb,
  holiday_sets jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  description text
);
create index if not exists sm_calendars_rev_idx on sm_calendars (org_id, rev);
create index if not exists sm_calendars_upd_idx on sm_calendars (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_calendars_crt_idx on sm_calendars (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_calendars_name_uk on sm_calendars (org_id, name) where deleted_at is null;
drop trigger if exists sm_calendars_sync on sm_calendars;
create trigger sm_calendars_sync before insert or update on sm_calendars for each row execute function sm_sync_touch('calendar');
create or replace trigger sm_calendars_demo after insert on sm_calendars for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_calendars_demo_t after update or delete on sm_calendars for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_calendars enable row level security;

-- capacity_record: رکوردهای ظرفیت
do $cols$
begin
  if to_regclass('sm_capacity_records') is not null then
    alter table sm_capacity_records add column if not exists workspace_id uuid;
    alter table sm_capacity_records add column if not exists domain_id uuid;
    alter table sm_capacity_records add column if not exists unit_id uuid;
    alter table sm_capacity_records add column if not exists created_at timestamptz not null default now();
    alter table sm_capacity_records add column if not exists created_by uuid;
    alter table sm_capacity_records add column if not exists updated_at timestamptz not null default now();
    alter table sm_capacity_records add column if not exists updated_by uuid;
    alter table sm_capacity_records add column if not exists rev bigint not null default 0;
    alter table sm_capacity_records add column if not exists version integer not null default 1;
    alter table sm_capacity_records add column if not exists deleted_at timestamptz;
    alter table sm_capacity_records add column if not exists origin text;
    alter table sm_capacity_records add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_capacity_records add column if not exists name text;
    alter table sm_capacity_records add column if not exists kind text;
    alter table sm_capacity_records add column if not exists status text;
    alter table sm_capacity_records add column if not exists ci_id uuid;
    alter table sm_capacity_records add column if not exists service_id uuid;
    alter table sm_capacity_records add column if not exists metric text;
    alter table sm_capacity_records add column if not exists unit text;
    alter table sm_capacity_records add column if not exists capacity numeric;
    alter table sm_capacity_records add column if not exists utilisation numeric;
    alter table sm_capacity_records add column if not exists utilisation_pct numeric;
    alter table sm_capacity_records add column if not exists warning_pct numeric;
    alter table sm_capacity_records add column if not exists critical_pct numeric;
    alter table sm_capacity_records add column if not exists measured_at timestamptz;
    alter table sm_capacity_records add column if not exists event_match text;
    alter table sm_capacity_records add column if not exists samples jsonb;
    alter table sm_capacity_records add column if not exists exhaustion_at timestamptz;
    alter table sm_capacity_records add column if not exists lead_time_days integer;
    alter table sm_capacity_records add column if not exists owner_id uuid;
    alter table sm_capacity_records add column if not exists assignment_group_id uuid;
    alter table sm_capacity_records add column if not exists notified_status text;
    alter table sm_capacity_records add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_capacity_records (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
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
  status text,
  ci_id uuid,
  service_id uuid,
  metric text,
  unit text,
  capacity numeric,
  utilisation numeric,
  utilisation_pct numeric,
  warning_pct numeric,
  critical_pct numeric,
  measured_at timestamptz,
  event_match text,
  samples jsonb,
  exhaustion_at timestamptz,
  lead_time_days integer,
  owner_id uuid,
  assignment_group_id uuid,
  notified_status text,
  notes text
);
create index if not exists sm_capacity_records_rev_idx on sm_capacity_records (org_id, rev);
create index if not exists sm_capacity_records_upd_idx on sm_capacity_records (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_capacity_records_crt_idx on sm_capacity_records (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_capacity_records_workspace_acc_idx on sm_capacity_records (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_capacity_records_unit_acc_idx on sm_capacity_records (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_capacity_records_domain_acc_idx on sm_capacity_records (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_capacity_records_owner_id_idx on sm_capacity_records (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_capacity_records_sync on sm_capacity_records;
create trigger sm_capacity_records_sync before insert or update on sm_capacity_records for each row execute function sm_sync_touch('capacity_record');
create or replace trigger sm_capacity_records_demo after insert on sm_capacity_records for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_capacity_records_demo_t after update or delete on sm_capacity_records for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_capacity_records enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:e746bd22eb04c5c31fd9a2d1db8bf37197416870b04ba559e556114f1cf98290:2', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
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

-- «کاریز» migration 0001_core — هسته: کاربران، سازمان‌ها، اعضا، همگام‌سازی و گزارش رویدادها
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

-- «سیراف» migration 0001_core — هسته: کاربران، سازمان‌ها، همگام‌سازی
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0001_core — هسته: کاربران، سازمان‌ها، همگام‌سازی
-- ---------------------------------------------------------------------------
create table if not exists tz_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

-- key/value store (desktop: sync cursors, device id, cloud link; cloud: platform settings)
create table if not exists tz_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- per-organisation revision counter: every write to a synced row takes the next value under a
-- row lock, so revisions of one organisation are handed out in commit order
create table if not exists tz_org_sync (
  org_id uuid primary key,
  rev bigint not null default 0
);

-- desktop only: aggregates changed locally and not yet pushed to the cloud
create table if not exists tz_outbox (
  entity text not null,
  id uuid not null,
  changed_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  primary key (entity, id)
);

create sequence if not exists tz_user_rev_seq;

create table if not exists tz_users (
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
create unique index if not exists tz_users_email_uk on tz_users (lower(email));

create table if not exists tz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references tz_users(id) on delete cascade,
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
create index if not exists tz_sessions_user_idx on tz_sessions (user_id);

create table if not exists tz_orgs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid generated always as (id) stored,
  name text not null,
  legal_name text,
  business_kind text not null default 'trading',
  modules jsonb not null default '["goods"]'::jsonb,
  base_currency text not null default 'IRR',
  money_decimals int not null default 0,
  economic_code text,
  national_id text,
  registration_no text,
  phone text,
  mobile text,
  email text,
  website text,
  province text,
  city text,
  address text,
  postal_code text,
  logo text,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
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
create unique index if not exists tz_org_members_uk on tz_org_members (org_id, user_id);
create index if not exists tz_org_members_user_idx on tz_org_members (user_id);

-- desktops linked to an organisation in the cloud
create table if not exists tz_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
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

create table if not exists tz_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  user_id uuid,
  at timestamptz not null default now(),
  action text not null,
  entity text,
  entity_id uuid,
  summary text,
  data jsonb,
  origin text
);
create index if not exists tz_audit_org_idx on tz_audit (org_id, at desc);

-- sync trigger for aggregate roots.
-- cloud: assigns the next per-organisation revision (and stamps updated_at unless a client's
--        version is being applied, which keeps the client's timestamp for last-writer-wins)
-- desktop (session setting taraz.mode = 'desktop'): records the aggregate in the outbox,
--        except while pulled cloud data is being applied (taraz.applying = 'on')
create or replace function tz_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
  v_applying boolean := coalesce(current_setting('taraz.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('taraz.mode', true), '') = 'desktop' then
    if not v_applying then
      insert into tz_outbox (entity, id, changed_at) values (tg_argv[0], new.id, now())
      on conflict (entity, id) do update set changed_at = excluded.changed_at, attempts = 0, last_error = null;
    end if;
    return new;
  end if;
  -- (tz_orgs.org_id is a generated column, still null inside a BEFORE trigger)
  insert into tz_org_sync (org_id, rev) values (coalesce(new.org_id, new.id), 1)
  on conflict (org_id) do update set rev = tz_org_sync.rev + 1
  returning rev into v_rev;
  new.rev := v_rev;
  return new;
end
$fn$;

create or replace function tz_user_touch() returns trigger language plpgsql as $fn$
begin
  if coalesce(current_setting('taraz.applying', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('taraz.mode', true), '') <> 'desktop' then
    new.rev := nextval('tz_user_rev_seq');
  end if;
  return new;
end
$fn$;

drop trigger if exists tz_users_touch on tz_users;
create trigger tz_users_touch before insert or update on tz_users
  for each row execute function tz_user_touch();

insert into tz_migrations (id) values ('0001_core') on conflict (id) do nothing;

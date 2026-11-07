-- «ITSM» migration 0002_platform — مدیریت سامانه: حالت پشتیبانی، رویدادهای امنیتی و وضعیت سازمان‌ها
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

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

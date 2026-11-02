// Platform administration: support sessions of the super admin, security events, and the platform
// status of each business. All three tables are local to each runtime (never synchronised): the web
// version is where they matter; a Windows app keeps its own (its installation administrator).
//
// - tz_support_sessions: «حالت پشتیبانی» — the platform admin works inside a business he is not a
//   member of, with a reason, a level (view | edit) and an end time (at most 4 hours; he can end it
//   early). Without an active session he sees only platform metadata of that business.
// - tz_security_events: sign-ins (failed ones too), password changes and resets, role changes,
//   platform-admin grants, support sessions, AI key changes. org_id is set when the event concerns
//   one business.
// - tz_org_admin: status active | read_only | suspended (enforced on writes; suspended also closes the
//   business to its members), internal notes, the per-business AI switch and limits. A table of its
//   own instead of tz_orgs columns: tz_orgs is synchronised to every member's Windows app and sent to
//   every member, while these notes are the platform's.
// - tz_audit gains actor_kind ('user' | 'support' | 'platform') and support_session_id. Writes made
//   inside a support session are tagged by the trigger below from the transaction-local settings
//   taraz.actor_kind / taraz.support_session that ctx.write sets, so every module's own audit rows
//   carry them without changes.
export default /* sql */ `
create table if not exists tz_support_sessions (
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
create index if not exists tz_support_sessions_org_idx on tz_support_sessions (org_id, started_at desc);
create index if not exists tz_support_sessions_admin_idx on tz_support_sessions (admin_user_id, started_at desc);

create table if not exists tz_security_events (
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
create index if not exists tz_security_events_at_idx on tz_security_events (at desc);
create index if not exists tz_security_events_user_idx on tz_security_events (user_id, at desc);
create index if not exists tz_security_events_org_idx on tz_security_events (org_id, at desc);

create table if not exists tz_org_admin (
  org_id uuid primary key,
  status text not null default 'active' check (status in ('active', 'read_only', 'suspended')),
  status_reason text,
  notes text,
  ai_disabled boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table tz_audit add column if not exists actor_kind text not null default 'user';
alter table tz_audit add column if not exists support_session_id uuid;
create index if not exists tz_audit_actor_idx on tz_audit (at desc) where actor_kind <> 'user';

create or replace function tz_audit_actor() returns trigger language plpgsql as $fn$
declare
  v_kind text := coalesce(current_setting('taraz.actor_kind', true), '');
  v_session text := coalesce(current_setting('taraz.support_session', true), '');
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
drop trigger if exists tz_audit_actor on tz_audit;
create trigger tz_audit_actor before insert on tz_audit for each row execute function tz_audit_actor();

alter table tz_support_sessions enable row level security;
alter table tz_security_events enable row level security;
alter table tz_org_admin enable row level security;
do $do$
declare
  t text;
begin
  foreach t in array array['tz_support_sessions', 'tz_security_events', 'tz_org_admin'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end
$do$;
`;

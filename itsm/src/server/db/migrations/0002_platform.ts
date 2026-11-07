// Platform administration: support sessions of the super admin, security events, and the platform status of
// each organisation. All three tables are local to each runtime (never synchronised): the web version is
// where they matter; a Windows app keeps its own (its installation administrator).
//
// - sm_support_sessions: «حالت پشتیبانی» — the platform admin works inside an organisation he is not a member
//   of, with a reason, a level (view | edit) and an end time (at most 4 hours; he can end it early). Without
//   an active session he sees only platform metadata of that organisation.
// - sm_security_events: sign-ins (failed ones too), password changes and resets, role changes, platform-admin
//   grants, support sessions, AI key changes. org_id is set when the event concerns one organisation.
// - sm_org_admin: status active | read_only | suspended (enforced on writes; suspended also closes the
//   organisation to its members), internal notes, the per-organisation AI switch and limits. A table of its own
//   instead of sm_orgs columns: sm_orgs is synchronised to every member's Windows app and sent to every
//   member, while these notes are the platform's.
// - Writes made inside a support session are tagged in sm_audit (actor_kind 'support', support_session_id) by
//   the trigger below from the transaction-local settings itsm.actor_kind / itsm.support_session that
//   ctx.write sets, so every module's own audit rows carry them without changes.
export default /* sql */ `
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
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'sm\\_%' loop
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
`;

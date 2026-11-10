-- «کاریز» migration 0096_xid_revisions — همگام‌سازی بی قفل: بازبینی‌ها با شناسهٔ تراکنش، نسل همگام‌سازی سازمان و مرز پاک‌سازی
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0096_xid_revisions — همگام‌سازی بی قفل: بازبینی‌ها با شناسهٔ تراکنش، نسل همگام‌سازی سازمان و مرز پاک‌سازی
-- ---------------------------------------------------------------------------
alter table sm_org_sync add column if not exists epoch bigint not null default 0;
alter table sm_org_sync add column if not exists purged bigint not null default 0;

create table if not exists sm_sync_seen (
  entity text not null,
  id uuid not null,
  primary key (entity, id)
);

create or replace function sm_sync_touch() returns trigger language plpgsql as $fn$
declare
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
  -- the writing transaction's id: no lock, any commit order (pulls compare snapshots)
  new.rev := pg_current_xact_id()::text::bigint;
  return new;
end
$fn$;

create or replace function sm_user_touch() returns trigger language plpgsql as $fn$
begin
  if coalesce(current_setting('itsm.applying', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') <> 'desktop' then
    new.rev := pg_current_xact_id()::text::bigint;
  end if;
  return new;
end
$fn$;

do $mig$
declare
  v_xid bigint;
  t record;
begin
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    return;
  end if;
  v_xid := pg_current_xact_id()::text::bigint;
  perform set_config('itsm.applying', 'on', true);
  for t in
    select distinct c.relname as tbl
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = g.tgfoid
    where n.nspname = current_schema() and p.proname in ('sm_sync_touch', 'sm_user_touch') and not g.tgisinternal
  loop
    execute format('update %I set rev = %s where rev >= %s', t.tbl, v_xid, v_xid);
  end loop;
  perform set_config('itsm.applying', '', true);
end
$mig$;

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

insert into sm_migrations (id) values ('0096_xid_revisions') on conflict (id) do nothing;

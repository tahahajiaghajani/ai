// Sync revisions become transaction ids (docs/spec/ENGINE.md §13, docs/PERFORMANCE_FA.md «دور سوم»): the sync trigger
// stamps a synced row with the id of the transaction that writes it (`pg_current_xact_id()`, 64-bit, never wraps)
// instead of taking the next value of the organisation's counter row in sm_org_sync. That counter row was locked until
// commit by every synced write so that revisions came in commit order — one lock serialising all writes of an
// organisation. Pulls now compare snapshots (src/server/sync/snapshot.ts), which needs no order at all.
//
// Numbered 0100, after the demo pack's 0098/0099: installed 1.1.0-beta servers ran those already, and migrations run in
// this list's order (src/server/db/migrate.ts applies every id missing from sm_migrations), so this one runs after them
// on every database — fresh or upgraded — and its definition of the sync trigger function is the last one.
//
// · sm_sync_touch() — the one definition that must win: it keeps what 0099_demo_touch added (on a Windows app, a write
//   inside the demo scope never enters sm_outbox: demo data is loaded on the server, never pushed from an app) and
//   stamps the writing transaction's id on the server instead of taking the counter (tests/sync-trigger.test.ts).
// · sm_org_sync keeps one row per organisation for what is still organisation-wide and rare: the sync `epoch` (bumped
//   by restores, imports and a detected transaction-id regression: every Windows app reads everything again) and the
//   `purged` watermark (rows removed for good that a Windows app may still hold — tombstones of archived records, the
//   demo pack's purge: an app whose cursor does not see it reads everything again). Its `rev` column is no longer moved.
// · Revisions written before this migration were counter values. A counter can be ahead of the transaction ids (one
//   transaction importing 10 000 rows took 10 000 revisions and one id): such rows would look written by transactions
//   that have not happened yet. They are stamped with this migration's own transaction id (`itsm.applying` keeps their
//   timestamps). Windows apps read everything again anyway (SYNC_PROTOCOL 16). Not on a Windows app's own database
//   (`itsm.mode = 'desktop'`): its revisions are the server's, opaque to it.
// · Counter values kept elsewhere: the Windows apps' cursors (`sm_devices.cursor`, now the oldest transaction id a
//   device's last complete pull had not seen) start again at 0 — every app reads everything again after the update —
//   and a demo pack waiting for the apps to pull its tombstones (`sm_demo_packs.purge_mark`) waits for that read.
// · sm_sync_seen (Windows app): what a pull session from nothing received; at its end the rest of the organisation's
//   rows (waiting for no upload) leave the computer.
export default /* sql */ `
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
    -- demo work is never pushed from a Windows app (docs/DEMO_FA.md: load the demo on the server; 0099_demo_touch)
    -- (sm_orgs.org_id is a generated column, still null inside a BEFORE trigger)
    if not v_applying and (new.org_id is null or coalesce(current_setting('itsm.demo', true), '') <> new.org_id::text) then
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
  -- once (supabase/schema.sql may run again on a live database): counter values kept outside the synced rows
  if not exists (select 1 from sm_migrations where id = '0100_xid_revisions') then
    -- the Windows apps' counter cursors: each app reads everything again after the update (its cursor then follows)
    update sm_devices set cursor = 0 where cursor <> 0;
    -- a demo pack whose tombstones wait for the apps (purge_mark was a counter value): it waits for that read
    update sm_demo_packs set purge_mark = v_xid + 1 where state = 'tombstoned';
  end if;
  perform set_config('itsm.applying', '', true);
end
$mig$;

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

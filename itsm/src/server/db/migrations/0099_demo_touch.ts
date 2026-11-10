// Demo data, safety round (docs/DEMO_FA.md, src/server/modules/demo):
//
// · sm_demo_touched — what demo work (inside the demo scope, src/server/db/scope.ts) changed or deleted in REAL rows:
//   the row's image before demo work first touched it (`before`), its image after the last demo write (`after`, null
//   for a delete) and whether anything outside the demo scope wrote it between two demo writes (`conflict`). The purge
//   puts back exactly these rows, and only when the row is still as demo work left it; anything else is reported.
//   This replaces the blanket snapshot of real tables taken at load time: what the system or real people change
//   outside the demo scope is never reverted.
// · sm_demo_touch() and one AFTER UPDATE OR DELETE trigger on every table that has `id` and `org_id` (the engine's
//   tables get theirs from the generated DDL, engine/ddl.ts `demoTouchDdl`), active only inside the demo scope.
// · sm_sync_touch(): on a Windows app, a write inside the demo scope never enters sm_outbox (demo data is loaded on
//   the server, never pushed from an app).
import { DEMO_TOUCH_FN } from "../../engine/ddl";

export default /* sql */ `
create table if not exists sm_demo_touched (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  before jsonb not null,
  after jsonb,
  conflict boolean not null default false,
  at timestamptz not null default now(),
  primary key (org_id, row_id)
);
create index if not exists sm_demo_touched_tbl_idx on sm_demo_touched (org_id, tbl);
alter table sm_demo_touched enable row level security;

${DEMO_TOUCH_FN}

do $touch$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\\_%' and c.relname not like '%\\_arc'
       and c.relname not in ('sm_orgs', 'sm_users', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved', 'sm_demo_touched')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo_t', 63))
  loop
    execute format('create trigger %I after update or delete on %I for each row when (current_setting(''itsm.demo'', true) = old.org_id::text) execute function sm_demo_touch()', left(t.table_name || '_demo_t', 63), t.table_name);
  end loop;
end
$touch$;

create or replace function sm_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
  v_applying boolean := coalesce(current_setting('itsm.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    -- demo work is never pushed from a Windows app (docs/DEMO_FA.md: load the demo on the server)
    if not v_applying and (new.org_id is null or coalesce(current_setting('itsm.demo', true), '') <> new.org_id::text) then
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
`;

// Demo data (docs/DEMO_FA.md, src/server/modules/demo): one demo pack per organisation and the registry of every row
// it created.
//
// · sm_demo_packs — the pack of an organisation: its state (loading → loaded → purging → tombstoned), size, progress,
//   the counts it made, the numbering counters as they were before the load (the purge puts them back) and the
//   sync revision its tombstones need every Windows app to pass before they are removed for good.
// · sm_demo_saved — the computed tables' rows (KPI scores, trained models…) as they were before the load.
// · sm_demo_rows — (organisation, row id, table) of every row a demo transaction inserted. Ids are UUIDs, unique
//   across tables, so the primary key (org_id, row_id) also answers «is this id demo data?» for any column.
// · sm_demo_capture() and one AFTER INSERT trigger on every table that has `id` and `org_id` (the engine's tables get
//   theirs from the generated DDL as well, engine/ddl.ts `demoCaptureDdl`): inside a transaction whose setting
//   `itsm.demo` names the row's organisation (src/server/db/scope.ts), the new row is recorded. The WHEN clause keeps
//   ordinary writes free of the function call.
import { DEMO_CAPTURE_FN } from "../../engine/ddl";

export default /* sql */ `
create table if not exists sm_demo_packs (
  org_id uuid primary key references sm_orgs(id) on delete cascade,
  state text not null default 'loading',
  size text not null default 'small',
  options jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,
  report jsonb,
  error text,
  started_by uuid,
  started_at timestamptz not null default now(),
  loaded_at timestamptz,
  purge_started_at timestamptz,
  purge_mark bigint,
  updated_at timestamptz not null default now()
);

create table if not exists sm_demo_rows (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  primary key (org_id, row_id)
);
create index if not exists sm_demo_rows_tbl_idx on sm_demo_rows (org_id, tbl);

-- the computed tables' rows as they were before the load (purge.ts COMPUTED_TABLES): put back by the purge
create table if not exists sm_demo_saved (
  org_id uuid not null,
  tbl text not null,
  row_id uuid not null,
  data jsonb not null,
  primary key (org_id, tbl, row_id)
);

alter table sm_demo_packs enable row level security;
alter table sm_demo_rows enable row level security;
alter table sm_demo_saved enable row level security;

${DEMO_CAPTURE_FN}

-- the platform's own tables with id + org_id (the engine's tables got theirs with their DDL): read from pg_catalog,
-- which is fast everywhere (information_schema is slow on the embedded database), and only where it is missing
do $capture$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\\_%' and c.relname not like '%\\_arc'
       and c.relname not in ('sm_orgs', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo', 63))
  loop
    execute format('create trigger %I after insert on %I for each row when (current_setting(''itsm.demo'', true) = new.org_id::text) execute function sm_demo_capture()', left(t.table_name || '_demo', 63), t.table_name);
  end loop;
end
$capture$;
`;

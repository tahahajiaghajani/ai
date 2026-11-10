// Demo data (docs/DEMO_FA.md, src/server/modules/demo): one demo pack per organisation and the registry of every row
// it created.
//
// · sm_demo_packs — the pack of an organisation: its state (loading → loaded → purging → tombstoned), size, progress,
//   the counts it made, the numbering counters as they were before the load (the purge puts them back) and the
//   sync revision its tombstones need every Windows app to pass before they are removed for good.
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

alter table sm_demo_packs enable row level security;
alter table sm_demo_rows enable row level security;

${DEMO_CAPTURE_FN}

do $capture$
declare
  t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    join information_schema.columns o on o.table_schema = c.table_schema and o.table_name = c.table_name and o.column_name = 'org_id' and o.data_type = 'uuid'
    where c.table_schema = current_schema() and c.column_name = 'id' and c.data_type = 'uuid'
      and c.table_name like 'sm\\_%' and c.table_name not like '%\\_arc'
      and c.table_name not in ('sm_orgs', 'sm_demo_rows', 'sm_demo_packs')
  loop
    execute format('drop trigger if exists %I on %I', left(t.table_name || '_demo', 63), t.table_name);
    execute format('create trigger %I after insert on %I for each row when (current_setting(''itsm.demo'', true) = new.org_id::text) execute function sm_demo_capture()', left(t.table_name || '_demo', 63), t.table_name);
  end loop;
end
$capture$;
`;

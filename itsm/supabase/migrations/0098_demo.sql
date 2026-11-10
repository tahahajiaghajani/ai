-- «کاریز» migration 0098_demo — داده‌های نمایشی: بستهٔ نمایشی سازمان و فهرست همهٔ ردیف‌هایی که ساخته است (برای حذف بی‌ردپا)
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0098_demo — داده‌های نمایشی: بستهٔ نمایشی سازمان و فهرست همهٔ ردیف‌هایی که ساخته است (برای حذف بی‌ردپا)
-- ---------------------------------------------------------------------------
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

create or replace function sm_demo_capture() returns trigger language plpgsql as $demo$
begin
  insert into sm_demo_rows (org_id, row_id, tbl) values (new.org_id, new.id, tg_table_name) on conflict do nothing;
  return null;
end
$demo$;

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
     where c.relkind = 'r' and c.relname like 'sm\_%' and c.relname not like '%\_arc'
       and c.relname not in ('sm_orgs', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo', 63))
  loop
    execute format('create trigger %I after insert on %I for each row when (current_setting(''itsm.demo'', true) = new.org_id::text) execute function sm_demo_capture()', left(t.table_name || '_demo', 63), t.table_name);
  end loop;
end
$capture$;

insert into sm_migrations (id) values ('0098_demo') on conflict (id) do nothing;

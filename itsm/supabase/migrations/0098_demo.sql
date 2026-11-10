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

alter table sm_demo_packs enable row level security;
alter table sm_demo_rows enable row level security;

create or replace function sm_demo_capture() returns trigger language plpgsql as $demo$
begin
  insert into sm_demo_rows (org_id, row_id, tbl) values (new.org_id, new.id, tg_table_name) on conflict do nothing;
  return null;
end
$demo$;

do $capture$
declare
  t record;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    join information_schema.columns o on o.table_schema = c.table_schema and o.table_name = c.table_name and o.column_name = 'org_id' and o.data_type = 'uuid'
    where c.table_schema = current_schema() and c.column_name = 'id' and c.data_type = 'uuid'
      and c.table_name like 'sm\_%' and c.table_name not like '%\_arc'
      and c.table_name not in ('sm_orgs', 'sm_demo_rows', 'sm_demo_packs')
  loop
    execute format('drop trigger if exists %I on %I', left(t.table_name || '_demo', 63), t.table_name);
    execute format('create trigger %I after insert on %I for each row when (current_setting(''itsm.demo'', true) = new.org_id::text) execute function sm_demo_capture()', left(t.table_name || '_demo', 63), t.table_name);
  end loop;
end
$capture$;

insert into sm_migrations (id) values ('0098_demo') on conflict (id) do nothing;

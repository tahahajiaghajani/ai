-- «کاریز» migration 0099_demo_touch — داده‌های نمایشی: ثبت تغییرهای کار نمایشی در ردیف‌های واقعی (تا حذف فقط همان‌ها را برگرداند) و نفرستادن کار نمایشی از برنامهٔ ویندوز
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0099_demo_touch — داده‌های نمایشی: ثبت تغییرهای کار نمایشی در ردیف‌های واقعی (تا حذف فقط همان‌ها را برگرداند) و نفرستادن کار نمایشی از برنامهٔ ویندوز
-- ---------------------------------------------------------------------------
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

create or replace function sm_demo_touch() returns trigger language plpgsql as $demo$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
begin
  if exists (select 1 from sm_demo_rows d where d.org_id = old.org_id and d.row_id = old.id) then
    return null;
  end if;
  insert into sm_demo_touched (org_id, row_id, tbl, before, after, conflict, at)
  values (old.org_id, old.id, tg_table_name, v_old, v_new, false, now())
  on conflict (org_id, row_id) do update
     set after = excluded.after,
         -- something outside the demo scope changed the row between two demo writes: never put it back blindly
         conflict = sm_demo_touched.conflict or sm_demo_touched.after is null
           or (sm_demo_touched.after - 'rev' - 'updated_at') <> (v_old - 'rev' - 'updated_at'),
         at = now();
  return null;
end
$demo$;

do $touch$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\_%' and c.relname not like '%\_arc'
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

insert into sm_migrations (id) values ('0099_demo_touch') on conflict (id) do nothing;

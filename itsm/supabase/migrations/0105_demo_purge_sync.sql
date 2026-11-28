-- «کاریز» migration 0105_demo_purge_sync — داده‌های نمایشی و برنامه‌های ویندوز: فهرست شناسه‌های حذف‌شده تا برنامه‌ای که دور بوده آن‌ها را برنگرداند، و یک بار به‌روزرسانی دامنهٔ دید اعضا در هر مرحلهٔ حذف
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0105_demo_purge_sync — داده‌های نمایشی و برنامه‌های ویندوز: فهرست شناسه‌های حذف‌شده تا برنامه‌ای که دور بوده آن‌ها را برنگرداند، و یک بار به‌روزرسانی دامنهٔ دید اعضا در هر مرحلهٔ حذف
-- ---------------------------------------------------------------------------
create table if not exists sm_demo_purged (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  purged_at timestamptz not null default now(),
  primary key (org_id, row_id)
);
create index if not exists sm_demo_purged_at_idx on sm_demo_purged (org_id, purged_at);
alter table sm_demo_purged enable row level security;

create or replace function sm_access_bump(p_org uuid) returns void language plpgsql as $fn$
begin
  if coalesce(current_setting('itsm.access_bulk', true), '') = p_org::text then
    perform set_config('itsm.access_version', p_org::text, true);
    return;
  end if;
  insert into sm_access_state (org_id, version) values (p_org, 1)
  on conflict (org_id) do update set version = sm_access_state.version + 1, updated_at = now();
end
$fn$;

create or replace function sm_access_bump_everyone(p_org uuid) returns void language plpgsql as $fn$
begin
  if coalesce(current_setting('itsm.access_bulk', true), '') = p_org::text then
    perform set_config('itsm.access_everyone', p_org::text, true);
    return;
  end if;
  insert into sm_scope_epochs (org_id, user_id, epoch)
  select m.org_id, m.user_id, 1 from sm_org_members m where m.org_id = p_org and m.deleted_at is null
  on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
end
$fn$;

insert into sm_migrations (id) values ('0105_demo_purge_sync') on conflict (id) do nothing;

-- «سیراف» migration 0017_rate_key_unique — طلا: یک کالا برای هر کلید تابلو
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0017_rate_key_unique — طلا: یک کالا برای هر کلید تابلو
-- ---------------------------------------------------------------------------
update tz_items i set rate_key = null
 where i.rate_key is not null and i.deleted_at is null
   and exists (select 1 from tz_items j where j.org_id = i.org_id and j.rate_key = i.rate_key and j.deleted_at is null and j.id < i.id);
drop index if exists tz_items_rate_key_idx;
create unique index if not exists tz_items_rate_key_uk on tz_items (org_id, rate_key) where rate_key is not null and deleted_at is null;

insert into tz_migrations (id) values ('0017_rate_key_unique') on conflict (id) do nothing;

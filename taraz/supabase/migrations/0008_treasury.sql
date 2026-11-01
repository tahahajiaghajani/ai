-- «تراز» migration 0008_treasury — خزانه‌داری و چک
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0008_treasury — خزانه‌داری و چک
-- ---------------------------------------------------------------------------
select 1;

insert into tz_migrations (id) values ('0008_treasury') on conflict (id) do nothing;

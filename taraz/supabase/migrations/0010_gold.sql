-- «تراز» migration 0010_gold — طلا و جواهر (تکمیلی)
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0010_gold — طلا و جواهر (تکمیلی)
-- ---------------------------------------------------------------------------
select 1;

insert into tz_migrations (id) values ('0010_gold') on conflict (id) do nothing;

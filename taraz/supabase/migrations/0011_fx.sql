-- «تراز» migration 0011_fx — صرافی و رمزارز (تکمیلی)
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0011_fx — صرافی و رمزارز (تکمیلی)
-- ---------------------------------------------------------------------------
select 1;

insert into tz_migrations (id) values ('0011_fx') on conflict (id) do nothing;

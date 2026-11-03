-- «سیراف» migration 0018_ai_free_tier — هوش مصنوعی: طرح رایگان اتصال‌ها
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0018_ai_free_tier — هوش مصنوعی: طرح رایگان اتصال‌ها
-- ---------------------------------------------------------------------------
alter table tz_ai_connections add column if not exists free_tier boolean not null default false;

insert into tz_migrations (id) values ('0018_ai_free_tier') on conflict (id) do nothing;

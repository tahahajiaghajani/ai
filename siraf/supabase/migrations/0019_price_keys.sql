-- «سیراف» migration 0019_price_keys — قیمت زنده: کلید منبع‌های سفارشی در هر نسخه
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0019_price_keys — قیمت زنده: کلید منبع‌های سفارشی در هر نسخه
-- ---------------------------------------------------------------------------
create table if not exists tz_price_keys (
  org_id uuid not null references tz_orgs(id) on delete cascade,
  board text not null,
  origin text not null,
  secret_enc text not null,
  key_hint text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, board, origin)
);

-- Supabase: reachable only through the app's own server connection
alter table tz_price_keys enable row level security;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table tz_price_keys from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table tz_price_keys from authenticated;
  end if;
end
$do$;

insert into tz_migrations (id) values ('0019_price_keys') on conflict (id) do nothing;

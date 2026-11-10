-- «ITSM» migration 0090_auth_directory — ورود با حساب سازمانی و ورود خودکار ویندوز: روش و دامنهٔ نشست‌ها، سیاست نشست، شمارش ورودهای ناموفق و قفل محلی
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0090_auth_directory — ورود با حساب سازمانی و ورود خودکار ویندوز: روش و دامنهٔ نشست‌ها، سیاست نشست، شمارش ورودهای ناموفق و قفل محلی
-- ---------------------------------------------------------------------------
alter table sm_sessions add column if not exists auth_method text;
alter table sm_sessions add column if not exists org_id uuid;
alter table sm_sessions add column if not exists source_id uuid;
alter table sm_sessions add column if not exists login text;
alter table sm_sessions add column if not exists reauth_at timestamptz;
alter table sm_sessions add column if not exists idle_minutes int not null default 0;
alter table sm_sessions add column if not exists browser_only boolean not null default false;
alter table sm_sessions add column if not exists revoke_reason text;
create index if not exists sm_sessions_org_idx on sm_sessions (org_id) where revoked_at is null;
create index if not exists sm_sessions_live_idx on sm_sessions (user_id, last_seen_at desc) where revoked_at is null;

create table if not exists sm_auth_throttle (
  key text primary key,
  org_id uuid,
  kind text not null,
  subject text,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists sm_auth_throttle_org_idx on sm_auth_throttle (org_id, updated_at desc);
alter table sm_auth_throttle enable row level security;

alter table sm_directory_links add column if not exists granted jsonb;

insert into sm_migrations (id) values ('0090_auth_directory') on conflict (id) do nothing;

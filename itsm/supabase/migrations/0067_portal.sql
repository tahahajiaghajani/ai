-- «ITSM» migration 0067_portal — درگاه سلف‌سرویس: جریان رویدادهای درگاه و گزارش پیام‌های کانال‌های پیام‌رسان
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0067_portal — درگاه سلف‌سرویس: جریان رویدادهای درگاه و گزارش پیام‌های کانال‌های پیام‌رسان
-- ---------------------------------------------------------------------------
create table if not exists sm_portal_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  -- search | click | answer | deflect | order | report | home | widget_search | public_view | public_search | public_vote | survey
  kind text not null,
  user_id uuid,
  session_id text,
  -- portal | widget | public | messenger
  channel text,
  query text,
  results int,
  value int,
  ref_table text,
  ref_id uuid,
  data jsonb
);
create index if not exists sm_portal_events_org_at_idx on sm_portal_events (org_id, at desc);
create index if not exists sm_portal_events_kind_idx on sm_portal_events (org_id, kind, at desc);
alter table sm_portal_events enable row level security;

create table if not exists sm_portal_channel_log (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  channel_id uuid not null,
  -- in | out
  direction text not null,
  -- received | replied | linked | unlinked | ignored | rate_limited | duplicate | failed | sent
  status text not null,
  message_key text,
  external_id text,
  user_id uuid,
  text text,
  conversation_id uuid,
  error text
);
create index if not exists sm_portal_channel_log_org_at_idx on sm_portal_channel_log (org_id, channel_id, at desc);
create unique index if not exists sm_portal_channel_log_msg_key on sm_portal_channel_log (org_id, channel_id, message_key) where direction = 'in' and message_key is not null;
alter table sm_portal_channel_log enable row level security;

insert into sm_migrations (id) values ('0067_portal') on conflict (id) do nothing;

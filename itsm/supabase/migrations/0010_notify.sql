-- «کاریز» migration 0010_notify — اعلان‌ها: گزارش ارسال، ایمیل‌های ارسالی و دریافتی و وضعیت صندوق‌ها
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0010_notify — اعلان‌ها: گزارش ارسال، ایمیل‌های ارسالی و دریافتی و وضعیت صندوق‌ها
-- ---------------------------------------------------------------------------
create table if not exists sm_notification_log (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rule_key text,
  rule_name text,
  event text not null,
  table_key text,
  record_id uuid,
  record_number text,
  channel text not null,
  recipient_id uuid,
  target text,
  status text not null,
  reason text,
  error text,
  provider_id text,
  subject text,
  body_hash text,
  due_at timestamptz,
  payload jsonb
);
create index if not exists sm_notification_log_org_idx on sm_notification_log (org_id, created_at desc, id desc);
create index if not exists sm_notification_log_held_idx on sm_notification_log (org_id, recipient_id, channel, due_at) where status = 'held';
alter table sm_notification_log enable row level security;

create table if not exists sm_email_messages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  channel_id uuid,
  direction text not null,
  message_id text not null,
  in_reply_to text,
  refs jsonb not null default '[]'::jsonb,
  from_addr text,
  to_addrs text,
  subject text,
  table_key text,
  record_id uuid,
  status text not null,
  reason text,
  uid bigint,
  size integer,
  created_at timestamptz not null default now(),
  data jsonb
);
create unique index if not exists sm_email_messages_msgid_idx on sm_email_messages (org_id, message_id, direction);
create index if not exists sm_email_messages_org_idx on sm_email_messages (org_id, created_at desc, id desc);
create index if not exists sm_email_messages_from_idx on sm_email_messages (org_id, from_addr, created_at desc) where direction = 'in';
alter table sm_email_messages enable row level security;

create table if not exists sm_notify_state (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table sm_notify_state enable row level security;

insert into sm_migrations (id) values ('0010_notify') on conflict (id) do nothing;

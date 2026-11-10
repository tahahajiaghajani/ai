-- «کاریز» migration 0011_flows — گردش‌کارها: اجراها، گزارش گام‌ها، انتظارها و زمان‌بندی
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0011_flows — گردش‌کارها: اجراها، گزارش گام‌ها، انتظارها و زمان‌بندی
-- ---------------------------------------------------------------------------
create table if not exists sm_flow_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  flow_id uuid not null,
  flow_name text not null default '',
  version_id uuid,
  version_no integer,
  graph jsonb,
  state text not null default 'running',
  test boolean not null default false,
  trigger_kind text not null,
  trigger_table text,
  trigger_record_id uuid,
  actor_id uuid,
  run_as uuid,
  run_as_kind text not null default 'user',
  depth integer not null default 0,
  parent_run_id uuid,
  parent_wait_id uuid,
  context jsonb not null default '{}'::jsonb,
  runtime jsonb not null default '{}'::jsonb,
  current_nodes text[] not null default '{}',
  steps_count integer not null default 0,
  error text,
  lease_by text,
  lease_until timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists sm_flow_runs_org_idx on sm_flow_runs (org_id, started_at desc, id desc);
create index if not exists sm_flow_runs_flow_idx on sm_flow_runs (org_id, flow_id, started_at desc);
create index if not exists sm_flow_runs_open_idx on sm_flow_runs (org_id, state) where state in ('running', 'waiting');
create index if not exists sm_flow_runs_parent_idx on sm_flow_runs (parent_run_id) where parent_run_id is not null;
create index if not exists sm_flow_runs_ended_idx on sm_flow_runs (ended_at) where ended_at is not null;
alter table sm_flow_runs enable row level security;

create table if not exists sm_flow_run_steps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  run_id uuid not null references sm_flow_runs(id) on delete cascade,
  key text not null,
  node_id text not null,
  node_type text not null,
  label text not null default '',
  status text not null,
  port text,
  input jsonb,
  output jsonb,
  error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer
);
create unique index if not exists sm_flow_run_steps_key_idx on sm_flow_run_steps (run_id, key);
alter table sm_flow_run_steps enable row level security;

create table if not exists sm_flow_waits (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  run_id uuid not null references sm_flow_runs(id) on delete cascade,
  token_id text not null,
  node_id text not null,
  step_key text not null,
  kind text not null,
  key text,
  due_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sm_flow_waits_key_idx on sm_flow_waits (org_id, key) where key is not null;
create index if not exists sm_flow_waits_run_idx on sm_flow_waits (run_id);
alter table sm_flow_waits enable row level security;

create table if not exists sm_flow_loop_items (
  run_id uuid not null references sm_flow_runs(id) on delete cascade,
  frame_id text not null,
  items jsonb not null,
  primary key (run_id, frame_id)
);
alter table sm_flow_loop_items enable row level security;

create table if not exists sm_flow_timers (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null,
  ref_id uuid not null,
  spec_key text not null,
  next_at timestamptz,
  last_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (org_id, kind, ref_id)
);
alter table sm_flow_timers enable row level security;

insert into sm_migrations (id) values ('0011_flows') on conflict (id) do nothing;

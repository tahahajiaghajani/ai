-- «ITSM» migration 0064_ai_ml — هوش مصنوعی پیش‌بین: مدل‌ها، پیش‌بینی‌ها، خوشه‌ها، بینش‌ها و گزارش حاکمیت
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0064_ai_ml — هوش مصنوعی پیش‌بین: مدل‌ها، پیش‌بینی‌ها، خوشه‌ها، بینش‌ها و گزارش حاکمیت
-- ---------------------------------------------------------------------------
create table if not exists sm_ai_models (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  key text not null,
  kind text not null,
  name text not null,
  table_key text not null,
  target text,
  inputs jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  status text not null default 'new',
  version integer not null default 0,
  seed integer not null default 1,
  threshold_show numeric not null default 0.5,
  threshold_apply numeric,
  schedule text not null default 'weekly',
  metrics jsonb,
  baseline jsonb,
  beats_baseline boolean not null default false,
  history jsonb not null default '[]'::jsonb,
  params jsonb,
  training_rows integer not null default 0,
  trained_at timestamptz,
  train_after timestamptz,
  last_error text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sm_ai_models_key_idx on sm_ai_models (org_id, key);
create index if not exists sm_ai_models_table_idx on sm_ai_models (org_id, table_key);

create table if not exists sm_ai_predictions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  model_id uuid not null references sm_ai_models(id) on delete cascade,
  model_key text not null,
  model_version integer not null default 0,
  kind text not null,
  table_key text not null,
  record_id uuid not null,
  field text,
  value text,
  score numeric not null default 0,
  alternatives jsonb not null default '[]'::jsonb,
  why jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  actual text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sm_ai_predictions_model_record_idx on sm_ai_predictions (org_id, model_key, record_id);
create index if not exists sm_ai_predictions_record_idx on sm_ai_predictions (org_id, table_key, record_id);
create index if not exists sm_ai_predictions_status_idx on sm_ai_predictions (org_id, model_key, status, updated_at desc);

create table if not exists sm_ai_clusters (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  run_at timestamptz not null default now(),
  table_key text not null,
  size integer not null default 0,
  cohesion numeric not null default 0,
  members uuid[] not null default '{}',
  sims jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  problem_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_clusters_org_idx on sm_ai_clusters (org_id, table_key, status, run_at desc);

create table if not exists sm_ai_insights (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  period text not null,
  period_key text not null,
  kind text not null,
  table_key text not null,
  subject text not null default '',
  scope jsonb not null default '{}'::jsonb,
  fields text[] not null default '{}',
  refs jsonb not null default '[]'::jsonb,
  severity text not null default 'info',
  score numeric not null default 0,
  title text not null,
  numbers jsonb not null default '{}'::jsonb,
  drivers jsonb not null default '[]'::jsonb,
  narrative text,
  narrative_ai boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists sm_ai_insights_key_idx on sm_ai_insights (org_id, period, period_key, kind, table_key, subject);
create index if not exists sm_ai_insights_recent_idx on sm_ai_insights (org_id, created_at desc);

create table if not exists sm_ai_guard_log (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  feature text,
  tables text[] not null default '{}',
  user_id uuid,
  detail text
);
create index if not exists sm_ai_guard_log_idx on sm_ai_guard_log (org_id, at desc);

-- Supabase: reachable only through the app's own server connection
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename in ('sm_ai_models', 'sm_ai_predictions', 'sm_ai_clusters', 'sm_ai_insights', 'sm_ai_guard_log') loop
    execute format('alter table %I enable row level security', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t.tablename);
    end if;
  end loop;
end
$do$;

insert into sm_migrations (id) values ('0064_ai_ml') on conflict (id) do nothing;

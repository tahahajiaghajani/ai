-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۹ از ۹ (0011_flows … 0101_device_protocol)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
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

-- ---------------------------------------------------------------------------
-- 0020_ai_rag — هوش مصنوعی: نمایه و بازیابی (قطعه‌ها، بردارها، متن اسناد هوشمند)
-- ---------------------------------------------------------------------------
alter table sm_ai_connections add column if not exists embed jsonb;

create table if not exists sm_ai_rag_docs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  -- the record's engine version when it was indexed, and the hash of everything indexed from it
  version int,
  hash text,
  title text,
  chunks int not null default 0,
  -- ok | empty | error
  status text not null default 'ok',
  error text,
  -- the provider embedding the chunks carry; vec_pending: some chunks still wait for it
  vec_key text,
  vec_pending boolean not null default false,
  workspace_id uuid,
  unit_id uuid,
  domain_id uuid,
  indexed_at timestamptz not null default now()
);
create unique index if not exists sm_ai_rag_docs_rec_key on sm_ai_rag_docs (org_id, table_key, record_id);
create index if not exists sm_ai_rag_docs_pending_idx on sm_ai_rag_docs (org_id) where vec_pending;

create table if not exists sm_ai_chunks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  table_key text not null,
  record_id uuid not null,
  -- chunk: retrievable passage; parent: the section a chunk belongs to (small-to-big)
  kind text not null default 'chunk',
  parent_id uuid,
  ord int not null default 0,
  field text,
  fields text[] not null default '{}',
  -- field groups whose values the chunk contains: a caller lacking one never gets the chunk
  groups text[] not null default '{}',
  heading text,
  page int,
  page_end int,
  lang text,
  text text not null,
  -- the Persian-normalised search form (title, heading and text)
  norm text not null default '',
  tsv tsvector generated always as (to_tsvector('simple', norm)) stored,
  -- content hash of what was embedded (unchanged text keeps its vectors)
  hash text not null,
  tokens int not null default 0,
  version int,
  workspace_id uuid,
  unit_id uuid,
  domain_id uuid,
  -- local embedding (always) and the provider's (key = preset:model:dims); vector columns are added with pgvector
  lvec real[],
  vec_key text,
  vec real[],
  created_at timestamptz not null default now()
);
create index if not exists sm_ai_chunks_rec_idx on sm_ai_chunks (org_id, table_key, record_id);
create index if not exists sm_ai_chunks_tsv_idx on sm_ai_chunks using gin (tsv);
create index if not exists sm_ai_chunks_vec_idx on sm_ai_chunks (org_id, vec_key) where kind = 'chunk';

-- text read from a smart document (page by page), on the runtime that read it
create table if not exists sm_ai_doc_pages (
  org_id uuid not null references sm_orgs(id) on delete cascade,
  doc_id uuid not null,
  page int not null,
  text text not null,
  ocr boolean not null default false,
  primary key (doc_id, page)
);
create index if not exists sm_ai_doc_pages_org_idx on sm_ai_doc_pages (org_id, doc_id);

-- index runs (backfills, re-embedding, reconciliation) for the admin page
create table if not exists sm_ai_rag_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists sm_ai_rag_runs_org_idx on sm_ai_rag_runs (org_id, started_at desc);

-- Supabase: reachable only through the app's own server connection
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename in ('sm_ai_rag_docs', 'sm_ai_chunks', 'sm_ai_doc_pages', 'sm_ai_rag_runs') loop
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

insert into sm_migrations (id) values ('0020_ai_rag') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0045_knowledge — مدیریت دانش: جریان رویدادهای دانش (جست‌وجو، بازدید، رأی، پیوند، حل بدون درخواست)
-- ---------------------------------------------------------------------------
create table if not exists sm_kb_events (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  at timestamptz not null default now(),
  -- search | view | click | vote | rating | flag | link | unlink | deflect | suggest | create | attest | tree
  kind text not null,
  user_id uuid,
  -- the browser session (deflection: search → view → no request)
  session_id text,
  -- requester | agent
  persona text,
  -- portal | record | search | chat | api
  channel text,
  article_id uuid,
  record_table text,
  record_id uuid,
  -- the search form of the query (Persian-normalised) and how many results it found
  query text,
  results int,
  position int,
  value int,
  data jsonb
);
create index if not exists sm_kb_events_org_at_idx on sm_kb_events (org_id, at desc);
create index if not exists sm_kb_events_article_idx on sm_kb_events (org_id, article_id, at desc) where article_id is not null;
create index if not exists sm_kb_events_user_idx on sm_kb_events (org_id, user_id, at desc) where user_id is not null;
create index if not exists sm_kb_events_kind_idx on sm_kb_events (org_id, kind, at desc);
alter table sm_kb_events enable row level security;

insert into sm_migrations (id) values ('0045_knowledge') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0050_access_locations — دسترسی: مکان عضو در محیط شرط‌ها (مکان من)
-- ---------------------------------------------------------------------------
create or replace function sm_access_profile_location() returns trigger language plpgsql as $fn$
begin
  if new.location_id is distinct from old.location_id then
    perform sm_access_bump(new.org_id);
  end if;
  return null;
end
$fn$;

create or replace function sm_access_locations() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.parent_id is distinct from old.parent_id or new.path is distinct from old.path or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_member_profiles_location on sm_member_profiles;
create trigger sm_member_profiles_location after update on sm_member_profiles for each row execute function sm_access_profile_location();
drop trigger if exists sm_locations_access on sm_locations;
create trigger sm_locations_access after insert or update or delete on sm_locations for each row execute function sm_access_locations();

insert into sm_migrations (id) values ('0050_access_locations') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0052_ai_skills — مهارت‌های هوش مصنوعی: پیشنهادهای وابسته به رکورد
-- ---------------------------------------------------------------------------
alter table sm_ai_actions add column if not exists record_table text;
alter table sm_ai_actions add column if not exists record_id uuid;
alter table sm_ai_actions add column if not exists fields text[];
alter table sm_ai_actions add column if not exists skill_run_id uuid;
-- person | service
alter table sm_ai_actions add column if not exists principal text;
create index if not exists sm_ai_actions_record_idx on sm_ai_actions (org_id, record_table, record_id, created_at desc) where record_id is not null;

insert into sm_migrations (id) values ('0052_ai_skills') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0053_grant_epochs — دسترسی: بازخوانی برنامهٔ ویندوز وقتی دسترسی مالکان خدمت، تأییدکنندگان و جانشینان تغییر می‌کند
-- ---------------------------------------------------------------------------
create or replace function sm_access_services() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.owner_id is distinct from old.owner_id or new.product_owner_id is distinct from old.product_owner_id
     or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump_user(org, new.owner_id);
    perform sm_access_bump_user(org, new.product_owner_id);
    if old.owner_id is distinct from new.owner_id then perform sm_access_bump_user(org, old.owner_id); end if;
    if old.product_owner_id is distinct from new.product_owner_id then perform sm_access_bump_user(org, old.product_owner_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_delegations() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.from_user is distinct from old.from_user or new.to_user is distinct from old.to_user
     or new.active is distinct from old.active or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.scopes is distinct from old.scopes or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump_user(org, new.from_user);
    perform sm_access_bump_user(org, new.to_user);
    if old.from_user is distinct from new.from_user then perform sm_access_bump_user(org, old.from_user); end if;
    if old.to_user is distinct from new.to_user then perform sm_access_bump_user(org, old.to_user); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_approvals() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  -- a new approval grants its approver; a removed or skipped one takes the grant away; a decision names who decided
  if tg_op <> 'UPDATE' or new.approver_id is distinct from old.approver_id or new.delegated_from is distinct from old.delegated_from
     or new.decided_by is distinct from old.decided_by or new.deleted_at is distinct from old.deleted_at
     or (new.state = 'skipped') is distinct from (old.state = 'skipped') then
    perform sm_access_bump_user(org, new.approver_id);
    perform sm_access_bump_user(org, new.delegated_from);
    perform sm_access_bump_user(org, new.decided_by);
    if old.approver_id is distinct from new.approver_id then perform sm_access_bump_user(org, old.approver_id); end if;
    if old.delegated_from is distinct from new.delegated_from then perform sm_access_bump_user(org, old.delegated_from); end if;
    if old.decided_by is distinct from new.decided_by then perform sm_access_bump_user(org, old.decided_by); end if;
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_services_access on sm_services;
create trigger sm_services_access after insert or update or delete on sm_services for each row execute function sm_access_services();
drop trigger if exists sm_delegations_access on sm_delegations;
create trigger sm_delegations_access after insert or update or delete on sm_delegations for each row execute function sm_access_delegations();
drop trigger if exists sm_approvals_access on sm_approvals;
create trigger sm_approvals_access after insert or update or delete on sm_approvals for each row execute function sm_access_approvals();

insert into sm_migrations (id) values ('0053_grant_epochs') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0058_ai_agents — عامل‌های هوش مصنوعی: پیشنهادهای عامل‌ها، مسیر رسیدگی و نتیجهٔ هر ردیف
-- ---------------------------------------------------------------------------
alter table sm_ai_actions add column if not exists agent_id uuid;
alter table sm_ai_actions add column if not exists agent_run_id uuid;
alter table sm_ai_actions add column if not exists route_users uuid[];
alter table sm_ai_actions add column if not exists route_groups uuid[];
alter table sm_ai_actions add column if not exists outcome jsonb;
alter table sm_ai_actions add column if not exists route_only boolean not null default false;
create index if not exists sm_ai_actions_agent_idx on sm_ai_actions (org_id, agent_id, created_at desc) where agent_id is not null;
create index if not exists sm_ai_actions_open_idx on sm_ai_actions (org_id, status, created_at desc) where status = 'proposed';

insert into sm_migrations (id) values ('0058_ai_agents') on conflict (id) do nothing;

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

-- ---------------------------------------------------------------------------
-- 0070_portal_surveys — درگاه سلف‌سرویس: پاسخ‌های نظرسنجی بی‌نام در انتظار ثبت دسته‌ای
-- ---------------------------------------------------------------------------
create table if not exists sm_survey_held (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  survey_id uuid not null,
  payload jsonb not null
);
create index if not exists sm_survey_held_survey_idx on sm_survey_held (org_id, survey_id);
alter table sm_survey_held enable row level security;

insert into sm_migrations (id) values ('0070_portal_surveys') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0080_admin_integration — مدیریت و اتصال‌ها: طرح‌ها، کلیدهای قابلیت، اطلاعیه‌ها، پشتیبان‌ها، کلیدهای API کاربران یکپارچه‌سازی، گزارش اتصال‌ها و فهرست کاربران
-- ---------------------------------------------------------------------------
create table if not exists sm_plans (
  key text primary key,
  name text not null,
  description text,
  limits jsonb not null default '{}'::jsonb,
  features text[] not null default '{}',
  sort_order int not null default 0,
  is_default boolean not null default false,
  active boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table sm_plans enable row level security;
insert into sm_plans (key, name, description, limits, features, sort_order, is_default) values
  ('free', 'رایگان', 'برای آزمودن: چند عضو، بدون API و همگام‌سازی فهرست کاربران',
   '{"members": 10, "custom_tables": 1, "custom_fields": 20, "integration_users": 0, "api_rate": 0, "webhooks": 0, "storage_mb": 500}'::jsonb,
   '{}', 10, false),
  ('standard', 'پایه', 'بیشتر سازمان‌ها: API، وب‌هوک و ورود داده',
   '{"members": 500, "custom_tables": 5, "custom_fields": 150, "integration_users": 10, "api_rate": 600, "webhooks": 20, "storage_mb": 20000}'::jsonb,
   '{}', 20, true),
  ('enterprise', 'سازمانی', 'بدون سقف؛ همگام‌سازی فهرست کاربران، SCIM و پشتیبان‌گیری زمان‌بندی‌شده',
   '{}'::jsonb, '{}', 30, false)
on conflict (key) do nothing;

create table if not exists sm_platform_flags (
  key text primary key,
  label text not null,
  description text,
  stage text not null default 'on' check (stage in ('off', 'beta', 'on')),
  percent int not null default 100 check (percent between 0 and 100),
  plans text[] not null default '{}',
  orgs_on uuid[] not null default '{}',
  orgs_off uuid[] not null default '{}',
  tenant_toggle boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table sm_platform_flags enable row level security;
insert into sm_platform_flags (key, label, description, stage, plans) values
  ('public_api', 'API رکوردها', 'API یکپارچهٔ REST با کلیدهای کاربران یکپارچه‌سازی و سند OpenAPI', 'on', '{standard,enterprise}'),
  ('webhooks', 'وب‌هوک‌های خروجی و ورودی', 'اشتراک رویداد رکوردها و نقطه‌های دریافت', 'on', '{standard,enterprise}'),
  ('directory_sync', 'همگام‌سازی LDAP و Active Directory', 'ورود و به‌روزرسانی اعضا و گروه‌ها از فهرست کاربران', 'on', '{enterprise}'),
  ('scim', 'تأمین کاربر با SCIM (Entra ID)', 'ساخت و غیرفعال کردن اعضا از Microsoft Entra ID و دیگر IdPها', 'on', '{enterprise}'),
  ('issue_sync', 'پیوند Jira و GitHub', 'ساخت issue از رکورد و همگام‌سازی وضعیت و یادداشت‌ها', 'on', '{}'),
  ('custom_tables', 'جدول‌های سفارشی', 'استودیوی جدول‌ها و فیلدهای سفارشی', 'on', '{}'),
  ('scheduled_exports', 'خروجی‌های زمان‌بندی‌شده', 'ارسال دوره‌ای دادهٔ جدول‌ها به نشانی یا فایل', 'on', '{standard,enterprise}'),
  ('data_import', 'ورود داده با نگاشت', 'مجموعه‌های ورود از CSV و اکسل با نقشهٔ تبدیل و ورود زمان‌بندی‌شده', 'on', '{}')
on conflict (key) do nothing;

create table if not exists sm_platform_announcements (
  id uuid primary key,
  title text not null,
  body text not null default '',
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical', 'maintenance')),
  audience text not null default 'all' check (audience in ('all', 'orgs', 'plans')),
  org_ids uuid[] not null default '{}',
  plans text[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  published_at timestamptz,
  delivered int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table sm_platform_announcements enable row level security;

create table if not exists sm_backups (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  kind text not null default 'manual',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  tables int not null default 0,
  rows int not null default 0,
  bytes bigint not null default 0,
  sha256 text,
  content bytea,
  note text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists sm_backups_org_idx on sm_backups (org_id, created_at desc);
alter table sm_backups enable row level security;

alter table sm_api_keys add column if not exists integration_user_id uuid;
alter table sm_api_keys add column if not exists table_scopes jsonb;
alter table sm_api_keys add column if not exists rate_limit int;
alter table sm_api_keys add column if not exists expires_at timestamptz;
alter table sm_api_keys add column if not exists ip_allowlist text[];
alter table sm_api_keys add column if not exists revoked_by uuid;
alter table sm_api_keys add column if not exists calls bigint not null default 0;
create index if not exists sm_api_keys_user_idx on sm_api_keys (org_id, integration_user_id) where integration_user_id is not null;

create table if not exists sm_api_usage (
  org_id uuid not null,
  key_id uuid not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key_id, window_start)
);
alter table sm_api_usage enable row level security;

create table if not exists sm_int_log (
  id uuid primary key,
  org_id uuid not null,
  at timestamptz not null default now(),
  kind text not null,
  ref_id uuid,
  actor uuid,
  method text,
  target text,
  status int,
  ok boolean not null default true,
  latency_ms int,
  summary text,
  error text
);
create index if not exists sm_int_log_org_idx on sm_int_log (org_id, at desc);
create index if not exists sm_int_log_kind_idx on sm_int_log (org_id, kind, at desc);
create index if not exists sm_int_log_ref_idx on sm_int_log (org_id, ref_id, at desc) where ref_id is not null;
alter table sm_int_log enable row level security;

create table if not exists sm_webhook_deliveries (
  id uuid primary key,
  org_id uuid not null,
  subscription_id uuid not null,
  event text not null,
  table_key text not null,
  record_id uuid,
  record_number text,
  actor uuid,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'dead', 'skipped')),
  attempts int not null default 0,
  response_code int,
  latency_ms int,
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  next_retry_at timestamptz
);
create index if not exists sm_webhook_deliveries_sub_idx on sm_webhook_deliveries (org_id, subscription_id, created_at desc);
create index if not exists sm_webhook_deliveries_dead_idx on sm_webhook_deliveries (org_id, status, created_at desc) where status in ('dead', 'failed');
alter table sm_webhook_deliveries enable row level security;

create table if not exists sm_directory_runs (
  id uuid primary key,
  org_id uuid not null,
  source_id uuid not null,
  kind text not null check (kind in ('preview', 'apply', 'scim')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  plan jsonb,
  error text
);
create index if not exists sm_directory_runs_idx on sm_directory_runs (org_id, source_id, started_at desc);
alter table sm_directory_runs enable row level security;

create table if not exists sm_directory_links (
  org_id uuid not null,
  source_id uuid not null,
  kind text not null check (kind in ('user', 'group')),
  external_id text not null,
  local_id uuid not null,
  external_name text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (source_id, kind, external_id)
);
create index if not exists sm_directory_links_local_idx on sm_directory_links (org_id, kind, local_id);
alter table sm_directory_links enable row level security;

insert into sm_migrations (id) values ('0080_admin_integration') on conflict (id) do nothing;

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

-- ---------------------------------------------------------------------------
-- 0091_directory_identity — پیوند حساب‌ها با خود شیء فهرست کاربران (objectGUID)، نه فقط نام آن
-- ---------------------------------------------------------------------------
alter table sm_directory_links add column if not exists object_id text;
create index if not exists sm_directory_links_object_idx on sm_directory_links (source_id, kind, object_id) where object_id is not null;

insert into sm_migrations (id) values ('0091_directory_identity') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0095_scale — مقیاس بانکی: جست‌وجوی سه‌حرفی (pg_trgm) و نمایه‌های BRIN جریان‌های افزایشی
-- ---------------------------------------------------------------------------
do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin
      create extension pg_trgm;
    exception when others then
      raise notice 'pg_trgm not installed: %', sqlerrm;
    end;
  end if;
end
$ext$;

create index if not exists sm_journal_created_brin on sm_journal using brin (created_at);
create index if not exists sm_history_at_brin on sm_history using brin (at);
create index if not exists sm_audit_at_brin on sm_audit using brin (at);
create index if not exists sm_notification_log_created_brin on sm_notification_log using brin (created_at);

insert into sm_migrations (id) values ('0095_scale') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0098_demo — داده‌های نمایشی: بستهٔ نمایشی سازمان و فهرست همهٔ ردیف‌هایی که ساخته است (برای حذف بی‌ردپا)
-- ---------------------------------------------------------------------------
create table if not exists sm_demo_packs (
  org_id uuid primary key references sm_orgs(id) on delete cascade,
  state text not null default 'loading',
  size text not null default 'small',
  options jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,
  report jsonb,
  error text,
  started_by uuid,
  started_at timestamptz not null default now(),
  loaded_at timestamptz,
  purge_started_at timestamptz,
  purge_mark bigint,
  updated_at timestamptz not null default now()
);

create table if not exists sm_demo_rows (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  primary key (org_id, row_id)
);
create index if not exists sm_demo_rows_tbl_idx on sm_demo_rows (org_id, tbl);

-- the computed tables' rows as they were before the load (purge.ts COMPUTED_TABLES): put back by the purge
create table if not exists sm_demo_saved (
  org_id uuid not null,
  tbl text not null,
  row_id uuid not null,
  data jsonb not null,
  primary key (org_id, tbl, row_id)
);

alter table sm_demo_packs enable row level security;
alter table sm_demo_rows enable row level security;
alter table sm_demo_saved enable row level security;

create or replace function sm_demo_capture() returns trigger language plpgsql as $demo$
begin
  insert into sm_demo_rows (org_id, row_id, tbl) values (new.org_id, new.id, tg_table_name) on conflict do nothing;
  return null;
end
$demo$;

-- the platform's own tables with id + org_id (the engine's tables got theirs with their DDL): read from pg_catalog,
-- which is fast everywhere (information_schema is slow on the embedded database), and only where it is missing
do $capture$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\_%' and c.relname not like '%\_arc'
       and c.relname not in ('sm_orgs', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo', 63))
  loop
    execute format('create trigger %I after insert on %I for each row when (current_setting(''itsm.demo'', true) = new.org_id::text) execute function sm_demo_capture()', left(t.table_name || '_demo', 63), t.table_name);
  end loop;
end
$capture$;

insert into sm_migrations (id) values ('0098_demo') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0099_demo_touch — داده‌های نمایشی: ثبت تغییرهای کار نمایشی در ردیف‌های واقعی (تا حذف فقط همان‌ها را برگرداند) و نفرستادن کار نمایشی از برنامهٔ ویندوز
-- ---------------------------------------------------------------------------
create table if not exists sm_demo_touched (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  before jsonb not null,
  after jsonb,
  conflict boolean not null default false,
  at timestamptz not null default now(),
  primary key (org_id, row_id)
);
create index if not exists sm_demo_touched_tbl_idx on sm_demo_touched (org_id, tbl);
alter table sm_demo_touched enable row level security;

create or replace function sm_demo_touch() returns trigger language plpgsql as $demo$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
begin
  if exists (select 1 from sm_demo_rows d where d.org_id = old.org_id and d.row_id = old.id) then
    return null;
  end if;
  insert into sm_demo_touched (org_id, row_id, tbl, before, after, conflict, at)
  values (old.org_id, old.id, tg_table_name, v_old, v_new, false, now())
  on conflict (org_id, row_id) do update
     set after = excluded.after,
         -- something outside the demo scope changed the row between two demo writes: never put it back blindly
         conflict = sm_demo_touched.conflict or sm_demo_touched.after is null
           or (sm_demo_touched.after - 'rev' - 'updated_at') <> (v_old - 'rev' - 'updated_at'),
         at = now();
  return null;
end
$demo$;

do $touch$
declare
  t record;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema()
     where c.relkind = 'r' and c.relname like 'sm\_%' and c.relname not like '%\_arc'
       and c.relname not in ('sm_orgs', 'sm_users', 'sm_demo_rows', 'sm_demo_packs', 'sm_demo_saved', 'sm_demo_touched')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.atttypid = 'uuid'::regtype and not a.attisdropped)
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = left(c.relname || '_demo_t', 63))
  loop
    execute format('create trigger %I after update or delete on %I for each row when (current_setting(''itsm.demo'', true) = old.org_id::text) execute function sm_demo_touch()', left(t.table_name || '_demo_t', 63), t.table_name);
  end loop;
end
$touch$;

create or replace function sm_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
  v_applying boolean := coalesce(current_setting('itsm.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    -- demo work is never pushed from a Windows app (docs/DEMO_FA.md: load the demo on the server)
    if not v_applying and (new.org_id is null or coalesce(current_setting('itsm.demo', true), '') <> new.org_id::text) then
      insert into sm_outbox (entity, id, changed_at) values (tg_argv[0], new.id, now())
      on conflict (entity, id) do update set changed_at = excluded.changed_at, attempts = 0, last_error = null;
    end if;
    return new;
  end if;
  -- (sm_orgs.org_id is a generated column, still null inside a BEFORE trigger)
  insert into sm_org_sync (org_id, rev) values (coalesce(new.org_id, new.id), 1)
  on conflict (org_id) do update set rev = sm_org_sync.rev + 1
  returning rev into v_rev;
  new.rev := v_rev;
  return new;
end
$fn$;

insert into sm_migrations (id) values ('0099_demo_touch') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0100_xid_revisions — همگام‌سازی بی قفل: بازبینی‌ها با شناسهٔ تراکنش، نسل همگام‌سازی سازمان و مرز پاک‌سازی
-- ---------------------------------------------------------------------------
alter table sm_org_sync add column if not exists epoch bigint not null default 0;
alter table sm_org_sync add column if not exists purged bigint not null default 0;

create table if not exists sm_sync_seen (
  entity text not null,
  id uuid not null,
  primary key (entity, id)
);

create or replace function sm_sync_touch() returns trigger language plpgsql as $fn$
declare
  v_applying boolean := coalesce(current_setting('itsm.applying', true), '') = 'on';
begin
  if not v_applying then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    -- demo work is never pushed from a Windows app (docs/DEMO_FA.md: load the demo on the server; 0099_demo_touch)
    -- (sm_orgs.org_id is a generated column, still null inside a BEFORE trigger)
    if not v_applying and (new.org_id is null or coalesce(current_setting('itsm.demo', true), '') <> new.org_id::text) then
      insert into sm_outbox (entity, id, changed_at) values (tg_argv[0], new.id, now())
      on conflict (entity, id) do update set changed_at = excluded.changed_at, attempts = 0, last_error = null;
    end if;
    return new;
  end if;
  -- the writing transaction's id: no lock, any commit order (pulls compare snapshots)
  new.rev := pg_current_xact_id()::text::bigint;
  return new;
end
$fn$;

create or replace function sm_user_touch() returns trigger language plpgsql as $fn$
begin
  if coalesce(current_setting('itsm.applying', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('itsm.mode', true), '') <> 'desktop' then
    new.rev := pg_current_xact_id()::text::bigint;
  end if;
  return new;
end
$fn$;

do $mig$
declare
  v_xid bigint;
  t record;
begin
  if coalesce(current_setting('itsm.mode', true), '') = 'desktop' then
    return;
  end if;
  v_xid := pg_current_xact_id()::text::bigint;
  perform set_config('itsm.applying', 'on', true);
  for t in
    select distinct c.relname as tbl
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = g.tgfoid
    where n.nspname = current_schema() and p.proname in ('sm_sync_touch', 'sm_user_touch') and not g.tgisinternal
  loop
    execute format('update %I set rev = %s where rev >= %s', t.tbl, v_xid, v_xid);
  end loop;
  -- once (supabase/schema.sql may run again on a live database): counter values kept outside the synced rows
  if not exists (select 1 from sm_migrations where id = '0100_xid_revisions') then
    -- the Windows apps' counter cursors: each app reads everything again after the update (its cursor then follows)
    update sm_devices set cursor = 0 where cursor <> 0;
    -- a demo pack whose tombstones wait for the apps (purge_mark was a counter value): it waits for that read
    update sm_demo_packs set purge_mark = v_xid + 1 where state = 'tombstoned';
  end if;
  perform set_config('itsm.applying', '', true);
end
$mig$;

do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'sm\_%' loop
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

insert into sm_migrations (id) values ('0100_xid_revisions') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0103_jobs_failed_idx — سرعت: نمایهٔ کارهای ناموفق پس‌زمینه برای خلاصهٔ کارهای کنسول‌ها
-- ---------------------------------------------------------------------------
create index if not exists sm_jobs_failed_idx on sm_jobs (org_id, done_at) where status = 'failed';

insert into sm_migrations (id) values ('0103_jobs_failed_idx') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 0101_device_protocol — برنامه‌های ویندوز: پروتکل همگام‌سازی هر دستگاه، تا برنامه‌های قدیمی‌ای که سرور نمی‌پذیرد شمرده شوند
-- ---------------------------------------------------------------------------
alter table sm_devices add column if not exists sync_protocol integer;

insert into sm_migrations (id) values ('0101_device_protocol') on conflict (id) do nothing;

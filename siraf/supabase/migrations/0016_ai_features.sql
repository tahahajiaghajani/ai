-- «سیراف» migration 0016_ai_features — هوش مصنوعی: بینش‌ها، برنامه‌ها و خواندن اسناد
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0016_ai_features — هوش مصنوعی: بینش‌ها، برنامه‌ها و خواندن اسناد
-- ---------------------------------------------------------------------------
-- One row per insight of a business. The id is a stable hash of the organisation and the rule's
-- dedupe key, so the same condition keeps the same id from day to day (and on every runtime) and
-- what each member did with it survives a recompute. status is the insight's own life cycle
-- (active while the rule still fires, resolved once it stops); what each member did with it
-- (seen, dismissed, snoozed until a date, done) lives in user_states keyed by user id.
create table if not exists tz_ai_insights (
  id text primary key,
  org_id uuid not null,
  kind text not null,
  module text not null,
  area text not null,
  severity text not null,
  title_fa text not null,
  body_fa text not null default '',
  why_fa text not null default '',
  facts jsonb not null default '[]'::jsonb,
  refs jsonb not null default '[]'::jsonb,
  action jsonb,
  status text not null default 'active',
  user_states jsonb not null default '{}'::jsonb,
  rank int not null default 0,
  day date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists tz_ai_insights_org_idx on tz_ai_insights (org_id, status, rank desc);

-- Plans written from forecasts (deterministic sections) plus the model's steps; private to the author.
create table if not exists tz_ai_plans (
  id uuid primary key,
  org_id uuid not null,
  user_id uuid not null,
  horizon text not null,
  title text not null,
  focus text,
  content jsonb not null default '{}'::jsonb,
  markdown text not null default '',
  source text not null default 'template',
  model text,
  created_at timestamptz not null default now()
);
create index if not exists tz_ai_plans_owner_idx on tz_ai_plans (org_id, user_id, created_at desc);

-- Documents read by AI (invoice, ID card, cheque, receipt): only the file's SHA-256 and the
-- validated result are kept, never the file itself.
create table if not exists tz_ai_captures (
  id uuid primary key,
  org_id uuid not null,
  user_id uuid not null,
  kind text not null,
  sha256 text not null,
  mime text,
  result jsonb not null,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists tz_ai_captures_hash_idx on tz_ai_captures (org_id, user_id, kind, sha256);
create index if not exists tz_ai_captures_age_idx on tz_ai_captures (org_id, created_at);

-- Supabase: reachable only through the app's own server connection.
do $do$
declare
  t text;
begin
  foreach t in array array['tz_ai_insights', 'tz_ai_plans', 'tz_ai_captures'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end
$do$;

insert into tz_migrations (id) values ('0016_ai_features') on conflict (id) do nothing;

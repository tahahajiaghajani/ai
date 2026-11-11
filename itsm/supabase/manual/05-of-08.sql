-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۵ از ۸ (0006_engine_tables:16/30 … 0006_engine_tables:19/30)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۶ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 16/30 (a0c3bc7de847)
-- kb_article: مقاله‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_articles') is not null then
    alter table sm_kb_articles add column if not exists workspace_id uuid;
    alter table sm_kb_articles add column if not exists domain_id uuid;
    alter table sm_kb_articles add column if not exists unit_id uuid;
    alter table sm_kb_articles add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_articles add column if not exists created_by uuid;
    alter table sm_kb_articles add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_articles add column if not exists updated_by uuid;
    alter table sm_kb_articles add column if not exists rev bigint not null default 0;
    alter table sm_kb_articles add column if not exists version integer not null default 1;
    alter table sm_kb_articles add column if not exists deleted_at timestamptz;
    alter table sm_kb_articles add column if not exists origin text;
    alter table sm_kb_articles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_articles add column if not exists no integer;
    alter table sm_kb_articles add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KB' || no::text else 'KB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_articles add column if not exists title text;
    alter table sm_kb_articles add column if not exists summary text;
    alter table sm_kb_articles add column if not exists body text;
    alter table sm_kb_articles add column if not exists internal_body text;
    alter table sm_kb_articles add column if not exists keywords jsonb;
    alter table sm_kb_articles add column if not exists tags jsonb;
    alter table sm_kb_articles add column if not exists article_type text;
    alter table sm_kb_articles add column if not exists template_id uuid;
    alter table sm_kb_articles add column if not exists language text;
    alter table sm_kb_articles add column if not exists external_url text;
    alter table sm_kb_articles add column if not exists base_id uuid;
    alter table sm_kb_articles add column if not exists category_id uuid;
    alter table sm_kb_articles add column if not exists author_id uuid;
    alter table sm_kb_articles add column if not exists owner_id uuid;
    alter table sm_kb_articles add column if not exists owner_group_id uuid;
    alter table sm_kb_articles add column if not exists visibility text;
    alter table sm_kb_articles add column if not exists confidential boolean not null default false;
    alter table sm_kb_articles add column if not exists access_list jsonb;
    alter table sm_kb_articles add column if not exists audience_mode text;
    alter table sm_kb_articles add column if not exists units_tree boolean not null default true;
    alter table sm_kb_articles add column if not exists read_users jsonb;
    alter table sm_kb_articles add column if not exists read_groups jsonb;
    alter table sm_kb_articles add column if not exists read_units jsonb;
    alter table sm_kb_articles add column if not exists deny_users jsonb;
    alter table sm_kb_articles add column if not exists deny_groups jsonb;
    alter table sm_kb_articles add column if not exists deny_units jsonb;
    alter table sm_kb_articles add column if not exists kcs_confidence text;
    alter table sm_kb_articles add column if not exists governance text;
    alter table sm_kb_articles add column if not exists classification text;
    alter table sm_kb_articles add column if not exists valid_from date;
    alter table sm_kb_articles add column if not exists valid_to date;
    alter table sm_kb_articles add column if not exists review_at date;
    alter table sm_kb_articles add column if not exists retire_at date;
    alter table sm_kb_articles add column if not exists retire_reason text;
    alter table sm_kb_articles add column if not exists replaced_by uuid;
    alter table sm_kb_articles add column if not exists doc_number text;
    alter table sm_kb_articles add column if not exists issuing_authority text;
    alter table sm_kb_articles add column if not exists effective_date date;
    alter table sm_kb_articles add column if not exists last_reviewed_at timestamptz;
    alter table sm_kb_articles add column if not exists last_reviewed_by uuid;
    alter table sm_kb_articles add column if not exists review_due boolean not null default false;
    alter table sm_kb_articles add column if not exists published_at timestamptz;
    alter table sm_kb_articles add column if not exists published_by uuid;
    alter table sm_kb_articles add column if not exists first_published_at timestamptz;
    alter table sm_kb_articles add column if not exists retired_at timestamptz;
    alter table sm_kb_articles add column if not exists version_label text;
    alter table sm_kb_articles add column if not exists major integer;
    alter table sm_kb_articles add column if not exists minor integer;
    alter table sm_kb_articles add column if not exists published_version_id uuid;
    alter table sm_kb_articles add column if not exists draft_version_id uuid;
    alter table sm_kb_articles add column if not exists has_draft boolean not null default false;
    alter table sm_kb_articles add column if not exists service_id uuid;
    alter table sm_kb_articles add column if not exists ci_id uuid;
    alter table sm_kb_articles add column if not exists known_error_id uuid;
    alter table sm_kb_articles add column if not exists problem_id uuid;
    alter table sm_kb_articles add column if not exists translation_of uuid;
    alter table sm_kb_articles add column if not exists master_version integer;
    alter table sm_kb_articles add column if not exists translation_stale boolean not null default false;
    alter table sm_kb_articles add column if not exists machine_translated boolean not null default false;
    alter table sm_kb_articles add column if not exists source_table text;
    alter table sm_kb_articles add column if not exists source_id text;
    alter table sm_kb_articles add column if not exists source_number text;
    alter table sm_kb_articles add column if not exists ai_use text;
    alter table sm_kb_articles add column if not exists ai_requesters boolean not null default true;
    alter table sm_kb_articles add column if not exists ai_provenance jsonb;
    alter table sm_kb_articles add column if not exists view_count integer;
    alter table sm_kb_articles add column if not exists reuse_count integer;
    alter table sm_kb_articles add column if not exists helpful_yes integer;
    alter table sm_kb_articles add column if not exists helpful_no integer;
    alter table sm_kb_articles add column if not exists rating_avg numeric;
    alter table sm_kb_articles add column if not exists rating_count integer;
    alter table sm_kb_articles add column if not exists open_flags integer;
    alter table sm_kb_articles add column if not exists health_score integer;
    alter table sm_kb_articles add column if not exists quality_score integer;
    alter table sm_kb_articles add column if not exists next_action text;
    alter table sm_kb_articles add column if not exists last_used_at timestamptz;
    alter table sm_kb_articles add column if not exists reviewer_ids jsonb;
    alter table sm_kb_articles add column if not exists approval text;
    alter table sm_kb_articles add column if not exists r_units jsonb;
    alter table sm_kb_articles add column if not exists x_units jsonb;
    alter table sm_kb_articles add column if not exists trashed_at timestamptz;
    alter table sm_kb_articles add column if not exists k_users jsonb;
    alter table sm_kb_articles add column if not exists k_groups jsonb;
    alter table sm_kb_articles add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_articles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KB' || no::text else 'KB' || lpad(no::text, 6, '0') end) stored,
  title text,
  summary text,
  body text,
  internal_body text,
  keywords jsonb,
  tags jsonb,
  article_type text,
  template_id uuid,
  language text,
  external_url text,
  base_id uuid,
  category_id uuid,
  author_id uuid,
  owner_id uuid,
  owner_group_id uuid,
  visibility text,
  confidential boolean not null default false,
  access_list jsonb,
  audience_mode text,
  units_tree boolean not null default true,
  read_users jsonb,
  read_groups jsonb,
  read_units jsonb,
  deny_users jsonb,
  deny_groups jsonb,
  deny_units jsonb,
  kcs_confidence text,
  governance text,
  classification text,
  valid_from date,
  valid_to date,
  review_at date,
  retire_at date,
  retire_reason text,
  replaced_by uuid,
  doc_number text,
  issuing_authority text,
  effective_date date,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid,
  review_due boolean not null default false,
  published_at timestamptz,
  published_by uuid,
  first_published_at timestamptz,
  retired_at timestamptz,
  version_label text,
  major integer,
  minor integer,
  published_version_id uuid,
  draft_version_id uuid,
  has_draft boolean not null default false,
  service_id uuid,
  ci_id uuid,
  known_error_id uuid,
  problem_id uuid,
  translation_of uuid,
  master_version integer,
  translation_stale boolean not null default false,
  machine_translated boolean not null default false,
  source_table text,
  source_id text,
  source_number text,
  ai_use text,
  ai_requesters boolean not null default true,
  ai_provenance jsonb,
  view_count integer,
  reuse_count integer,
  helpful_yes integer,
  helpful_no integer,
  rating_avg numeric,
  rating_count integer,
  open_flags integer,
  health_score integer,
  quality_score integer,
  next_action text,
  last_used_at timestamptz,
  reviewer_ids jsonb,
  approval text,
  r_units jsonb,
  x_units jsonb,
  trashed_at timestamptz,
  k_users jsonb,
  k_groups jsonb,
  state text,
  search_5f9fce8f text generated always as (translate(coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '') || ' ' || coalesce(doc_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_articles' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_5f9fce8f' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_articles', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_articles', 'search_5f9fce8f', $x$translate(coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '') || ' ' || coalesce(doc_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_articles' and indexname like 'sm\_kb\_articles\_search\_%' and indexname not in ('sm_kb_articles_search_5f9fce8f_trgm', 'sm_kb_articles_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_articles_search_5f9fce8f_trgm', 'sm_kb_articles', 'search_5f9fce8f', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_articles_search_custom_trgm', 'sm_kb_articles', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_articles_no_uk on sm_kb_articles (org_id, no);
create index if not exists sm_kb_articles_rev_idx on sm_kb_articles (org_id, rev);
create index if not exists sm_kb_articles_upd_idx on sm_kb_articles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_articles_crt_idx on sm_kb_articles (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_articles_base_id_idx on sm_kb_articles (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_articles_category_id_idx on sm_kb_articles (org_id, category_id) where deleted_at is null;
create index if not exists sm_kb_articles_author_id_idx on sm_kb_articles (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_articles_owner_id_idx on sm_kb_articles (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_articles_owner_group_id_idx on sm_kb_articles (org_id, owner_group_id) where deleted_at is null;
create index if not exists sm_kb_articles_known_error_id_idx on sm_kb_articles (org_id, known_error_id) where deleted_at is null;
create index if not exists sm_kb_articles_translation_of_idx on sm_kb_articles (org_id, translation_of) where deleted_at is null;
create index if not exists sm_kb_articles_source_id_idx on sm_kb_articles (org_id, source_id) where deleted_at is null;
create index if not exists sm_kb_articles_reviewer_ids_gin on sm_kb_articles using gin (reviewer_ids);
create index if not exists sm_kb_articles_k_users_gin on sm_kb_articles using gin (k_users);
create index if not exists sm_kb_articles_k_groups_gin on sm_kb_articles using gin (k_groups);
create index if not exists sm_kb_articles_state_idx on sm_kb_articles (org_id, state) where deleted_at is null;
create index if not exists sm_kb_articles_workspace_acc_idx on sm_kb_articles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_articles_unit_acc_idx on sm_kb_articles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_articles_domain_acc_idx on sm_kb_articles (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_articles_sync on sm_kb_articles;
create trigger sm_kb_articles_sync before insert or update on sm_kb_articles for each row execute function sm_sync_touch('kb_article');
create or replace trigger sm_kb_articles_demo after insert on sm_kb_articles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_articles_demo_t after update or delete on sm_kb_articles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_articles enable row level security;

-- kb_attestation: کارزارهای تأیید مطالعه
do $cols$
begin
  if to_regclass('sm_kb_attestations') is not null then
    alter table sm_kb_attestations add column if not exists workspace_id uuid;
    alter table sm_kb_attestations add column if not exists domain_id uuid;
    alter table sm_kb_attestations add column if not exists unit_id uuid;
    alter table sm_kb_attestations add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_attestations add column if not exists created_by uuid;
    alter table sm_kb_attestations add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_attestations add column if not exists updated_by uuid;
    alter table sm_kb_attestations add column if not exists rev bigint not null default 0;
    alter table sm_kb_attestations add column if not exists version integer not null default 1;
    alter table sm_kb_attestations add column if not exists deleted_at timestamptz;
    alter table sm_kb_attestations add column if not exists origin text;
    alter table sm_kb_attestations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_attestations add column if not exists no integer;
    alter table sm_kb_attestations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ATT' || no::text else 'ATT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_attestations add column if not exists title text;
    alter table sm_kb_attestations add column if not exists article_id uuid;
    alter table sm_kb_attestations add column if not exists version_label text;
    alter table sm_kb_attestations add column if not exists due_at date;
    alter table sm_kb_attestations add column if not exists owner_id uuid;
    alter table sm_kb_attestations add column if not exists remind_every_days integer;
    alter table sm_kb_attestations add column if not exists target_users jsonb;
    alter table sm_kb_attestations add column if not exists target_groups jsonb;
    alter table sm_kb_attestations add column if not exists target_units jsonb;
    alter table sm_kb_attestations add column if not exists audience_count integer;
    alter table sm_kb_attestations add column if not exists ack_count integer;
    alter table sm_kb_attestations add column if not exists reminded_at timestamptz;
    alter table sm_kb_attestations add column if not exists k_users jsonb;
    alter table sm_kb_attestations add column if not exists k_groups jsonb;
    alter table sm_kb_attestations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_attestations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ATT' || no::text else 'ATT' || lpad(no::text, 6, '0') end) stored,
  title text,
  article_id uuid,
  version_label text,
  due_at date,
  owner_id uuid,
  remind_every_days integer,
  target_users jsonb,
  target_groups jsonb,
  target_units jsonb,
  audience_count integer,
  ack_count integer,
  reminded_at timestamptz,
  k_users jsonb,
  k_groups jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_attestations' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_attestations', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_attestations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_attestations' and indexname like 'sm\_kb\_attestations\_search\_%' and indexname not in ('sm_kb_attestations_search_cae18f1d_trgm', 'sm_kb_attestations_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_attestations_search_cae18f1d_trgm', 'sm_kb_attestations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_attestations_search_custom_trgm', 'sm_kb_attestations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_attestations_no_uk on sm_kb_attestations (org_id, no);
create index if not exists sm_kb_attestations_rev_idx on sm_kb_attestations (org_id, rev);
create index if not exists sm_kb_attestations_upd_idx on sm_kb_attestations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_crt_idx on sm_kb_attestations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_attestations_article_id_idx on sm_kb_attestations (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_attestations_owner_id_idx on sm_kb_attestations (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_attestations_k_users_gin on sm_kb_attestations using gin (k_users);
create index if not exists sm_kb_attestations_k_groups_gin on sm_kb_attestations using gin (k_groups);
create index if not exists sm_kb_attestations_state_idx on sm_kb_attestations (org_id, state) where deleted_at is null;
create index if not exists sm_kb_attestations_workspace_acc_idx on sm_kb_attestations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_attestations_unit_acc_idx on sm_kb_attestations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_attestations_domain_acc_idx on sm_kb_attestations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_attestations_sync on sm_kb_attestations;
create trigger sm_kb_attestations_sync before insert or update on sm_kb_attestations for each row execute function sm_sync_touch('kb_attestation');
create or replace trigger sm_kb_attestations_demo after insert on sm_kb_attestations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_attestations_demo_t after update or delete on sm_kb_attestations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_attestations enable row level security;

-- kb_base: پایگاه‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_bases') is not null then
    alter table sm_kb_bases add column if not exists workspace_id uuid;
    alter table sm_kb_bases add column if not exists domain_id uuid;
    alter table sm_kb_bases add column if not exists unit_id uuid;
    alter table sm_kb_bases add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_bases add column if not exists created_by uuid;
    alter table sm_kb_bases add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_bases add column if not exists updated_by uuid;
    alter table sm_kb_bases add column if not exists rev bigint not null default 0;
    alter table sm_kb_bases add column if not exists version integer not null default 1;
    alter table sm_kb_bases add column if not exists deleted_at timestamptz;
    alter table sm_kb_bases add column if not exists origin text;
    alter table sm_kb_bases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_bases add column if not exists name text;
    alter table sm_kb_bases add column if not exists kind text;
    alter table sm_kb_bases add column if not exists description text;
    alter table sm_kb_bases add column if not exists icon text;
    alter table sm_kb_bases add column if not exists color text;
    alter table sm_kb_bases add column if not exists sort_order integer;
    alter table sm_kb_bases add column if not exists owner_id uuid;
    alter table sm_kb_bases add column if not exists manager_group_id uuid;
    alter table sm_kb_bases add column if not exists classification text;
    alter table sm_kb_bases add column if not exists languages jsonb;
    alter table sm_kb_bases add column if not exists read_mode text;
    alter table sm_kb_bases add column if not exists units_tree boolean not null default true;
    alter table sm_kb_bases add column if not exists read_users jsonb;
    alter table sm_kb_bases add column if not exists read_groups jsonb;
    alter table sm_kb_bases add column if not exists read_units jsonb;
    alter table sm_kb_bases add column if not exists deny_users jsonb;
    alter table sm_kb_bases add column if not exists deny_groups jsonb;
    alter table sm_kb_bases add column if not exists deny_units jsonb;
    alter table sm_kb_bases add column if not exists contrib_mode text;
    alter table sm_kb_bases add column if not exists contrib_users jsonb;
    alter table sm_kb_bases add column if not exists contrib_groups jsonb;
    alter table sm_kb_bases add column if not exists nocontrib_users jsonb;
    alter table sm_kb_bases add column if not exists nocontrib_groups jsonb;
    alter table sm_kb_bases add column if not exists publish_approval boolean not null default true;
    alter table sm_kb_bases add column if not exists approval_mode text;
    alter table sm_kb_bases add column if not exists retire_approval boolean not null default false;
    alter table sm_kb_bases add column if not exists approvers jsonb;
    alter table sm_kb_bases add column if not exists approver_groups jsonb;
    alter table sm_kb_bases add column if not exists allowed_templates jsonb;
    alter table sm_kb_bases add column if not exists default_template_id uuid;
    alter table sm_kb_bases add column if not exists default_valid_days integer;
    alter table sm_kb_bases add column if not exists review_days integer;
    alter table sm_kb_bases add column if not exists review_policy text;
    alter table sm_kb_bases add column if not exists kcs_enabled boolean not null default false;
    alter table sm_kb_bases add column if not exists publishing_model text;
    alter table sm_kb_bases add column if not exists external_after_reuses integer;
    alter table sm_kb_bases add column if not exists conveyor_days integer;
    alter table sm_kb_bases add column if not exists allow_comments boolean not null default true;
    alter table sm_kb_bases add column if not exists allow_ratings boolean not null default true;
    alter table sm_kb_bases add column if not exists ai_enabled boolean not null default true;
    alter table sm_kb_bases add column if not exists ai_requesters boolean not null default true;
    alter table sm_kb_bases add column if not exists confidential boolean not null default false;
    alter table sm_kb_bases add column if not exists k_users jsonb;
    alter table sm_kb_bases add column if not exists k_groups jsonb;
    alter table sm_kb_bases add column if not exists r_units jsonb;
    alter table sm_kb_bases add column if not exists x_units jsonb;
    alter table sm_kb_bases add column if not exists article_count integer;
    alter table sm_kb_bases add column if not exists access_list jsonb;
    alter table sm_kb_bases add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_bases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  description text,
  icon text,
  color text,
  sort_order integer,
  owner_id uuid,
  manager_group_id uuid,
  classification text,
  languages jsonb,
  read_mode text,
  units_tree boolean not null default true,
  read_users jsonb,
  read_groups jsonb,
  read_units jsonb,
  deny_users jsonb,
  deny_groups jsonb,
  deny_units jsonb,
  contrib_mode text,
  contrib_users jsonb,
  contrib_groups jsonb,
  nocontrib_users jsonb,
  nocontrib_groups jsonb,
  publish_approval boolean not null default true,
  approval_mode text,
  retire_approval boolean not null default false,
  approvers jsonb,
  approver_groups jsonb,
  allowed_templates jsonb,
  default_template_id uuid,
  default_valid_days integer,
  review_days integer,
  review_policy text,
  kcs_enabled boolean not null default false,
  publishing_model text,
  external_after_reuses integer,
  conveyor_days integer,
  allow_comments boolean not null default true,
  allow_ratings boolean not null default true,
  ai_enabled boolean not null default true,
  ai_requesters boolean not null default true,
  confidential boolean not null default false,
  k_users jsonb,
  k_groups jsonb,
  r_units jsonb,
  x_units jsonb,
  article_count integer,
  access_list jsonb,
  state text
);
create index if not exists sm_kb_bases_rev_idx on sm_kb_bases (org_id, rev);
create index if not exists sm_kb_bases_upd_idx on sm_kb_bases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_bases_crt_idx on sm_kb_bases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_bases_owner_id_idx on sm_kb_bases (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_bases_manager_group_id_idx on sm_kb_bases (org_id, manager_group_id) where deleted_at is null;
create index if not exists sm_kb_bases_k_users_gin on sm_kb_bases using gin (k_users);
create index if not exists sm_kb_bases_k_groups_gin on sm_kb_bases using gin (k_groups);
create index if not exists sm_kb_bases_state_idx on sm_kb_bases (org_id, state) where deleted_at is null;
create unique index if not exists sm_kb_bases_name_uk on sm_kb_bases (org_id, name) where deleted_at is null;
create index if not exists sm_kb_bases_workspace_acc_idx on sm_kb_bases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_bases_unit_acc_idx on sm_kb_bases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_bases_domain_acc_idx on sm_kb_bases (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_bases_sync on sm_kb_bases;
create trigger sm_kb_bases_sync before insert or update on sm_kb_bases for each row execute function sm_sync_touch('kb_base');
create or replace trigger sm_kb_bases_demo after insert on sm_kb_bases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_bases_demo_t after update or delete on sm_kb_bases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_bases enable row level security;

-- kb_block: بلوک‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_blocks') is not null then
    alter table sm_kb_blocks add column if not exists workspace_id uuid;
    alter table sm_kb_blocks add column if not exists domain_id uuid;
    alter table sm_kb_blocks add column if not exists unit_id uuid;
    alter table sm_kb_blocks add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_blocks add column if not exists created_by uuid;
    alter table sm_kb_blocks add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_blocks add column if not exists updated_by uuid;
    alter table sm_kb_blocks add column if not exists rev bigint not null default 0;
    alter table sm_kb_blocks add column if not exists version integer not null default 1;
    alter table sm_kb_blocks add column if not exists deleted_at timestamptz;
    alter table sm_kb_blocks add column if not exists origin text;
    alter table sm_kb_blocks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_blocks add column if not exists no integer;
    alter table sm_kb_blocks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBB' || no::text else 'KBB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_blocks add column if not exists title text;
    alter table sm_kb_blocks add column if not exists visibility text;
    alter table sm_kb_blocks add column if not exists body text;
    alter table sm_kb_blocks add column if not exists owner_id uuid;
    alter table sm_kb_blocks add column if not exists owner_group_id uuid;
    alter table sm_kb_blocks add column if not exists confidential boolean not null default false;
    alter table sm_kb_blocks add column if not exists used_in jsonb;
    alter table sm_kb_blocks add column if not exists access_list jsonb;
    alter table sm_kb_blocks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_blocks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBB' || no::text else 'KBB' || lpad(no::text, 6, '0') end) stored,
  title text,
  visibility text,
  body text,
  owner_id uuid,
  owner_group_id uuid,
  confidential boolean not null default false,
  used_in jsonb,
  access_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_blocks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_blocks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_blocks', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_blocks' and indexname like 'sm\_kb\_blocks\_search\_%' and indexname not in ('sm_kb_blocks_search_cae18f1d_trgm', 'sm_kb_blocks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_blocks_search_cae18f1d_trgm', 'sm_kb_blocks', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_blocks_search_custom_trgm', 'sm_kb_blocks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_blocks_no_uk on sm_kb_blocks (org_id, no);
create index if not exists sm_kb_blocks_rev_idx on sm_kb_blocks (org_id, rev);
create index if not exists sm_kb_blocks_upd_idx on sm_kb_blocks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_blocks_crt_idx on sm_kb_blocks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_blocks_owner_id_idx on sm_kb_blocks (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_blocks_state_idx on sm_kb_blocks (org_id, state) where deleted_at is null;
create index if not exists sm_kb_blocks_workspace_acc_idx on sm_kb_blocks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_blocks_unit_acc_idx on sm_kb_blocks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_blocks_domain_acc_idx on sm_kb_blocks (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_blocks_sync on sm_kb_blocks;
create trigger sm_kb_blocks_sync before insert or update on sm_kb_blocks for each row execute function sm_sync_touch('kb_block');
create or replace trigger sm_kb_blocks_demo after insert on sm_kb_blocks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_blocks_demo_t after update or delete on sm_kb_blocks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_blocks enable row level security;

-- kb_category: دسته‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_categories') is not null then
    alter table sm_kb_categories add column if not exists workspace_id uuid;
    alter table sm_kb_categories add column if not exists domain_id uuid;
    alter table sm_kb_categories add column if not exists unit_id uuid;
    alter table sm_kb_categories add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_categories add column if not exists created_by uuid;
    alter table sm_kb_categories add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_categories add column if not exists updated_by uuid;
    alter table sm_kb_categories add column if not exists rev bigint not null default 0;
    alter table sm_kb_categories add column if not exists version integer not null default 1;
    alter table sm_kb_categories add column if not exists deleted_at timestamptz;
    alter table sm_kb_categories add column if not exists origin text;
    alter table sm_kb_categories add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_categories add column if not exists name text;
    alter table sm_kb_categories add column if not exists base_id uuid;
    alter table sm_kb_categories add column if not exists parent_id uuid;
    alter table sm_kb_categories add column if not exists sort_order integer;
    alter table sm_kb_categories add column if not exists icon text;
    alter table sm_kb_categories add column if not exists description text;
    alter table sm_kb_categories add column if not exists featured jsonb;
    alter table sm_kb_categories add column if not exists managed_by_groups jsonb;
    alter table sm_kb_categories add column if not exists read_mode text;
    alter table sm_kb_categories add column if not exists units_tree boolean not null default true;
    alter table sm_kb_categories add column if not exists read_users jsonb;
    alter table sm_kb_categories add column if not exists read_groups jsonb;
    alter table sm_kb_categories add column if not exists read_units jsonb;
    alter table sm_kb_categories add column if not exists path text;
    alter table sm_kb_categories add column if not exists depth integer;
    alter table sm_kb_categories add column if not exists c_all boolean not null default true;
    alter table sm_kb_categories add column if not exists c_users jsonb;
    alter table sm_kb_categories add column if not exists c_groups jsonb;
    alter table sm_kb_categories add column if not exists c_units jsonb;
    alter table sm_kb_categories add column if not exists m_groups jsonb;
    alter table sm_kb_categories add column if not exists article_count integer;
    alter table sm_kb_categories add column if not exists k_users jsonb;
    alter table sm_kb_categories add column if not exists k_groups jsonb;
    alter table sm_kb_categories add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_categories (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  base_id uuid,
  parent_id uuid,
  sort_order integer,
  icon text,
  description text,
  featured jsonb,
  managed_by_groups jsonb,
  read_mode text,
  units_tree boolean not null default true,
  read_users jsonb,
  read_groups jsonb,
  read_units jsonb,
  path text,
  depth integer,
  c_all boolean not null default true,
  c_users jsonb,
  c_groups jsonb,
  c_units jsonb,
  m_groups jsonb,
  article_count integer,
  k_users jsonb,
  k_groups jsonb,
  state text
);
create index if not exists sm_kb_categories_rev_idx on sm_kb_categories (org_id, rev);
create index if not exists sm_kb_categories_upd_idx on sm_kb_categories (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_crt_idx on sm_kb_categories (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_categories_base_id_idx on sm_kb_categories (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_categories_parent_id_idx on sm_kb_categories (org_id, parent_id) where deleted_at is null;
create index if not exists sm_kb_categories_m_groups_gin on sm_kb_categories using gin (m_groups);
create index if not exists sm_kb_categories_k_users_gin on sm_kb_categories using gin (k_users);
create index if not exists sm_kb_categories_k_groups_gin on sm_kb_categories using gin (k_groups);
create index if not exists sm_kb_categories_state_idx on sm_kb_categories (org_id, state) where deleted_at is null;
drop trigger if exists sm_kb_categories_sync on sm_kb_categories;
create trigger sm_kb_categories_sync before insert or update on sm_kb_categories for each row execute function sm_sync_touch('kb_category');
create or replace trigger sm_kb_categories_demo after insert on sm_kb_categories for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_categories_demo_t after update or delete on sm_kb_categories for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_categories enable row level security;

-- kb_config: تنظیمات دانش
do $cols$
begin
  if to_regclass('sm_kb_configs') is not null then
    alter table sm_kb_configs add column if not exists workspace_id uuid;
    alter table sm_kb_configs add column if not exists domain_id uuid;
    alter table sm_kb_configs add column if not exists unit_id uuid;
    alter table sm_kb_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_configs add column if not exists created_by uuid;
    alter table sm_kb_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_configs add column if not exists updated_by uuid;
    alter table sm_kb_configs add column if not exists rev bigint not null default 0;
    alter table sm_kb_configs add column if not exists version integer not null default 1;
    alter table sm_kb_configs add column if not exists deleted_at timestamptz;
    alter table sm_kb_configs add column if not exists origin text;
    alter table sm_kb_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_configs add column if not exists name text;
    alter table sm_kb_configs add column if not exists config_key text;
    alter table sm_kb_configs add column if not exists default_group_id uuid;
    alter table sm_kb_configs add column if not exists review_remind_days integer;
    alter table sm_kb_configs add column if not exists negative_ratio integer;
    alter table sm_kb_configs add column if not exists negative_min_votes integer;
    alter table sm_kb_configs add column if not exists trash_days integer;
    alter table sm_kb_configs add column if not exists events_days integer;
    alter table sm_kb_configs add column if not exists deflection_hours integer;
    alter table sm_kb_configs add column if not exists aqi_per_author integer;
    alter table sm_kb_configs add column if not exists aqi_items jsonb;
    alter table sm_kb_configs add column if not exists duplicate_threshold integer;
    alter table sm_kb_configs add column if not exists suggest_limit integer;
    alter table sm_kb_configs add column if not exists stale_days integer;
    alter table sm_kb_configs add column if not exists capture_on_resolve boolean not null default true;
    alter table sm_kb_configs add column if not exists ack_suggestions boolean not null default false;
    alter table sm_kb_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_kb_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  default_group_id uuid,
  review_remind_days integer,
  negative_ratio integer,
  negative_min_votes integer,
  trash_days integer,
  events_days integer,
  deflection_hours integer,
  aqi_per_author integer,
  aqi_items jsonb,
  duplicate_threshold integer,
  suggest_limit integer,
  stale_days integer,
  capture_on_resolve boolean not null default true,
  ack_suggestions boolean not null default false,
  seeded integer
);
create index if not exists sm_kb_configs_rev_idx on sm_kb_configs (org_id, rev);
create index if not exists sm_kb_configs_upd_idx on sm_kb_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_configs_crt_idx on sm_kb_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_configs_config_key_uk on sm_kb_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_kb_configs_sync on sm_kb_configs;
create trigger sm_kb_configs_sync before insert or update on sm_kb_configs for each row execute function sm_sync_touch('kb_config');
create or replace trigger sm_kb_configs_demo after insert on sm_kb_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_configs_demo_t after update or delete on sm_kb_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_configs enable row level security;

-- kb_decision_tree: درخت‌های تصمیم
do $cols$
begin
  if to_regclass('sm_kb_decision_trees') is not null then
    alter table sm_kb_decision_trees add column if not exists workspace_id uuid;
    alter table sm_kb_decision_trees add column if not exists domain_id uuid;
    alter table sm_kb_decision_trees add column if not exists unit_id uuid;
    alter table sm_kb_decision_trees add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_decision_trees add column if not exists created_by uuid;
    alter table sm_kb_decision_trees add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_decision_trees add column if not exists updated_by uuid;
    alter table sm_kb_decision_trees add column if not exists rev bigint not null default 0;
    alter table sm_kb_decision_trees add column if not exists version integer not null default 1;
    alter table sm_kb_decision_trees add column if not exists deleted_at timestamptz;
    alter table sm_kb_decision_trees add column if not exists origin text;
    alter table sm_kb_decision_trees add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_decision_trees add column if not exists no integer;
    alter table sm_kb_decision_trees add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'KDT' || no::text else 'KDT' || lpad(no::text, 5, '0') end) stored;
    alter table sm_kb_decision_trees add column if not exists title text;
    alter table sm_kb_decision_trees add column if not exists base_id uuid;
    alter table sm_kb_decision_trees add column if not exists description text;
    alter table sm_kb_decision_trees add column if not exists nodes jsonb;
    alter table sm_kb_decision_trees add column if not exists start text;
    alter table sm_kb_decision_trees add column if not exists owner_id uuid;
    alter table sm_kb_decision_trees add column if not exists owner_group_id uuid;
    alter table sm_kb_decision_trees add column if not exists visibility text;
    alter table sm_kb_decision_trees add column if not exists confidential boolean not null default false;
    alter table sm_kb_decision_trees add column if not exists starts integer;
    alter table sm_kb_decision_trees add column if not exists finishes integer;
    alter table sm_kb_decision_trees add column if not exists k_users jsonb;
    alter table sm_kb_decision_trees add column if not exists k_groups jsonb;
    alter table sm_kb_decision_trees add column if not exists access_list jsonb;
    alter table sm_kb_decision_trees add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_decision_trees (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'KDT' || no::text else 'KDT' || lpad(no::text, 5, '0') end) stored,
  title text,
  base_id uuid,
  description text,
  nodes jsonb,
  start text,
  owner_id uuid,
  owner_group_id uuid,
  visibility text,
  confidential boolean not null default false,
  starts integer,
  finishes integer,
  k_users jsonb,
  k_groups jsonb,
  access_list jsonb,
  state text,
  search_e3000752 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_decision_trees' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_e3000752' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_decision_trees', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_decision_trees', 'search_e3000752', $x$translate(coalesce(title, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_decision_trees' and indexname like 'sm\_kb\_decision\_trees\_search\_%' and indexname not in ('sm_kb_decision_trees_search_e3000752_trgm', 'sm_kb_decision_trees_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_decision_trees_search_e3000752_trgm', 'sm_kb_decision_trees', 'search_e3000752', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_decision_trees_search_custom_trgm', 'sm_kb_decision_trees', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_decision_trees_no_uk on sm_kb_decision_trees (org_id, no);
create index if not exists sm_kb_decision_trees_rev_idx on sm_kb_decision_trees (org_id, rev);
create index if not exists sm_kb_decision_trees_upd_idx on sm_kb_decision_trees (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_crt_idx on sm_kb_decision_trees (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_decision_trees_k_users_gin on sm_kb_decision_trees using gin (k_users);
create index if not exists sm_kb_decision_trees_k_groups_gin on sm_kb_decision_trees using gin (k_groups);
create index if not exists sm_kb_decision_trees_state_idx on sm_kb_decision_trees (org_id, state) where deleted_at is null;
create index if not exists sm_kb_decision_trees_workspace_acc_idx on sm_kb_decision_trees (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_decision_trees_unit_acc_idx on sm_kb_decision_trees (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_decision_trees_domain_acc_idx on sm_kb_decision_trees (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_kb_decision_trees_owner_id_idx on sm_kb_decision_trees (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_kb_decision_trees_sync on sm_kb_decision_trees;
create trigger sm_kb_decision_trees_sync before insert or update on sm_kb_decision_trees for each row execute function sm_sync_touch('kb_decision_tree');
create or replace trigger sm_kb_decision_trees_demo after insert on sm_kb_decision_trees for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_decision_trees_demo_t after update or delete on sm_kb_decision_trees for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_decision_trees enable row level security;

-- kb_domain: حوزه‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_domains') is not null then
    alter table sm_kb_domains add column if not exists workspace_id uuid;
    alter table sm_kb_domains add column if not exists domain_id uuid;
    alter table sm_kb_domains add column if not exists unit_id uuid;
    alter table sm_kb_domains add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_domains add column if not exists created_by uuid;
    alter table sm_kb_domains add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_domains add column if not exists updated_by uuid;
    alter table sm_kb_domains add column if not exists rev bigint not null default 0;
    alter table sm_kb_domains add column if not exists version integer not null default 1;
    alter table sm_kb_domains add column if not exists deleted_at timestamptz;
    alter table sm_kb_domains add column if not exists origin text;
    alter table sm_kb_domains add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_domains add column if not exists name text;
    alter table sm_kb_domains add column if not exists kde_id uuid;
    alter table sm_kb_domains add column if not exists bases jsonb;
    alter table sm_kb_domains add column if not exists categories jsonb;
    alter table sm_kb_domains add column if not exists capture_days integer;
    alter table sm_kb_domains add column if not exists description text;
    alter table sm_kb_domains add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_kb_domains (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kde_id uuid,
  bases jsonb,
  categories jsonb,
  capture_days integer,
  description text,
  active boolean not null default true
);
create index if not exists sm_kb_domains_rev_idx on sm_kb_domains (org_id, rev);
create index if not exists sm_kb_domains_upd_idx on sm_kb_domains (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_domains_crt_idx on sm_kb_domains (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_domains_name_uk on sm_kb_domains (org_id, name) where deleted_at is null;
drop trigger if exists sm_kb_domains_sync on sm_kb_domains;
create trigger sm_kb_domains_sync before insert or update on sm_kb_domains for each row execute function sm_sync_touch('kb_domain');
create or replace trigger sm_kb_domains_demo after insert on sm_kb_domains for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_domains_demo_t after update or delete on sm_kb_domains for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_domains enable row level security;

-- kb_duplicate: مقاله‌های احتمالاً تکراری
do $cols$
begin
  if to_regclass('sm_kb_duplicates') is not null then
    alter table sm_kb_duplicates add column if not exists workspace_id uuid;
    alter table sm_kb_duplicates add column if not exists domain_id uuid;
    alter table sm_kb_duplicates add column if not exists unit_id uuid;
    alter table sm_kb_duplicates add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_duplicates add column if not exists created_by uuid;
    alter table sm_kb_duplicates add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_duplicates add column if not exists updated_by uuid;
    alter table sm_kb_duplicates add column if not exists rev bigint not null default 0;
    alter table sm_kb_duplicates add column if not exists version integer not null default 1;
    alter table sm_kb_duplicates add column if not exists deleted_at timestamptz;
    alter table sm_kb_duplicates add column if not exists origin text;
    alter table sm_kb_duplicates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_duplicates add column if not exists article_a uuid;
    alter table sm_kb_duplicates add column if not exists article_b uuid;
    alter table sm_kb_duplicates add column if not exists similarity integer;
    alter table sm_kb_duplicates add column if not exists method text;
    alter table sm_kb_duplicates add column if not exists pair_key text;
    alter table sm_kb_duplicates add column if not exists confidential boolean not null default true;
    alter table sm_kb_duplicates add column if not exists access_list jsonb;
    alter table sm_kb_duplicates add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_duplicates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_a uuid,
  article_b uuid,
  similarity integer,
  method text,
  pair_key text,
  confidential boolean not null default true,
  access_list jsonb,
  state text
);
create index if not exists sm_kb_duplicates_rev_idx on sm_kb_duplicates (org_id, rev);
create index if not exists sm_kb_duplicates_upd_idx on sm_kb_duplicates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_duplicates_crt_idx on sm_kb_duplicates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_duplicates_article_a_idx on sm_kb_duplicates (org_id, article_a) where deleted_at is null;
create index if not exists sm_kb_duplicates_article_b_idx on sm_kb_duplicates (org_id, article_b) where deleted_at is null;
create index if not exists sm_kb_duplicates_state_idx on sm_kb_duplicates (org_id, state) where deleted_at is null;
create unique index if not exists sm_kb_duplicates_pair_key_uk on sm_kb_duplicates (org_id, pair_key) where deleted_at is null;
drop trigger if exists sm_kb_duplicates_sync on sm_kb_duplicates;
create trigger sm_kb_duplicates_sync before insert or update on sm_kb_duplicates for each row execute function sm_sync_touch('kb_duplicate');
create or replace trigger sm_kb_duplicates_demo after insert on sm_kb_duplicates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_duplicates_demo_t after update or delete on sm_kb_duplicates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_duplicates enable row level security;

-- kb_feedback: بازخوردهای مقاله
do $cols$
begin
  if to_regclass('sm_kb_feedback') is not null then
    alter table sm_kb_feedback add column if not exists workspace_id uuid;
    alter table sm_kb_feedback add column if not exists domain_id uuid;
    alter table sm_kb_feedback add column if not exists unit_id uuid;
    alter table sm_kb_feedback add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_feedback add column if not exists created_by uuid;
    alter table sm_kb_feedback add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_feedback add column if not exists updated_by uuid;
    alter table sm_kb_feedback add column if not exists rev bigint not null default 0;
    alter table sm_kb_feedback add column if not exists version integer not null default 1;
    alter table sm_kb_feedback add column if not exists deleted_at timestamptz;
    alter table sm_kb_feedback add column if not exists origin text;
    alter table sm_kb_feedback add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_feedback add column if not exists article_id uuid;
    alter table sm_kb_feedback add column if not exists version_label text;
    alter table sm_kb_feedback add column if not exists kind text;
    alter table sm_kb_feedback add column if not exists user_id uuid;
    alter table sm_kb_feedback add column if not exists reason text;
    alter table sm_kb_feedback add column if not exists rating integer;
    alter table sm_kb_feedback add column if not exists comment text;
    alter table sm_kb_feedback add column if not exists channel text;
    alter table sm_kb_feedback add column if not exists state text;
    alter table sm_kb_feedback add column if not exists task_id uuid;
    alter table sm_kb_feedback add column if not exists k_users jsonb;
    alter table sm_kb_feedback add column if not exists k_groups jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_feedback (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_id uuid,
  version_label text,
  kind text,
  user_id uuid,
  reason text,
  rating integer,
  comment text,
  channel text,
  state text,
  task_id uuid,
  k_users jsonb,
  k_groups jsonb
);
create index if not exists sm_kb_feedback_rev_idx on sm_kb_feedback (org_id, rev);
create index if not exists sm_kb_feedback_upd_idx on sm_kb_feedback (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_crt_idx on sm_kb_feedback (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_feedback_article_id_idx on sm_kb_feedback (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_feedback_user_id_idx on sm_kb_feedback (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_feedback_k_users_gin on sm_kb_feedback using gin (k_users);
create index if not exists sm_kb_feedback_k_groups_gin on sm_kb_feedback using gin (k_groups);
create index if not exists sm_kb_feedback_workspace_acc_idx on sm_kb_feedback (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_feedback_unit_acc_idx on sm_kb_feedback (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_feedback_domain_acc_idx on sm_kb_feedback (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_feedback_sync on sm_kb_feedback;
create trigger sm_kb_feedback_sync before insert or update on sm_kb_feedback for each row execute function sm_sync_touch('kb_feedback');
create or replace trigger sm_kb_feedback_demo after insert on sm_kb_feedback for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_feedback_demo_t after update or delete on sm_kb_feedback for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_feedback enable row level security;

-- kb_gap: شکاف‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_gaps') is not null then
    alter table sm_kb_gaps add column if not exists workspace_id uuid;
    alter table sm_kb_gaps add column if not exists domain_id uuid;
    alter table sm_kb_gaps add column if not exists unit_id uuid;
    alter table sm_kb_gaps add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_gaps add column if not exists created_by uuid;
    alter table sm_kb_gaps add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_gaps add column if not exists updated_by uuid;
    alter table sm_kb_gaps add column if not exists rev bigint not null default 0;
    alter table sm_kb_gaps add column if not exists version integer not null default 1;
    alter table sm_kb_gaps add column if not exists deleted_at timestamptz;
    alter table sm_kb_gaps add column if not exists origin text;
    alter table sm_kb_gaps add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_gaps add column if not exists no integer;
    alter table sm_kb_gaps add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KGP' || no::text else 'KGP' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_gaps add column if not exists title text;
    alter table sm_kb_gaps add column if not exists kind text;
    alter table sm_kb_gaps add column if not exists signature text;
    alter table sm_kb_gaps add column if not exists demand integer;
    alter table sm_kb_gaps add column if not exists score integer;
    alter table sm_kb_gaps add column if not exists last_seen_at timestamptz;
    alter table sm_kb_gaps add column if not exists samples jsonb;
    alter table sm_kb_gaps add column if not exists outline text;
    alter table sm_kb_gaps add column if not exists base_id uuid;
    alter table sm_kb_gaps add column if not exists group_id uuid;
    alter table sm_kb_gaps add column if not exists article_id uuid;
    alter table sm_kb_gaps add column if not exists confidential boolean not null default true;
    alter table sm_kb_gaps add column if not exists access_list jsonb;
    alter table sm_kb_gaps add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_gaps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KGP' || no::text else 'KGP' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  signature text,
  demand integer,
  score integer,
  last_seen_at timestamptz,
  samples jsonb,
  outline text,
  base_id uuid,
  group_id uuid,
  article_id uuid,
  confidential boolean not null default true,
  access_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_gaps' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_gaps', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_gaps', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_gaps' and indexname like 'sm\_kb\_gaps\_search\_%' and indexname not in ('sm_kb_gaps_search_cae18f1d_trgm', 'sm_kb_gaps_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_gaps_search_cae18f1d_trgm', 'sm_kb_gaps', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_gaps_search_custom_trgm', 'sm_kb_gaps', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_gaps_no_uk on sm_kb_gaps (org_id, no);
create index if not exists sm_kb_gaps_rev_idx on sm_kb_gaps (org_id, rev);
create index if not exists sm_kb_gaps_upd_idx on sm_kb_gaps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_gaps_crt_idx on sm_kb_gaps (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_gaps_signature_idx on sm_kb_gaps (org_id, signature) where deleted_at is null;
create index if not exists sm_kb_gaps_group_id_idx on sm_kb_gaps (org_id, group_id) where deleted_at is null;
create index if not exists sm_kb_gaps_state_idx on sm_kb_gaps (org_id, state) where deleted_at is null;
create index if not exists sm_kb_gaps_workspace_acc_idx on sm_kb_gaps (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_gaps_unit_acc_idx on sm_kb_gaps (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_gaps_domain_acc_idx on sm_kb_gaps (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_gaps_sync on sm_kb_gaps;
create trigger sm_kb_gaps_sync before insert or update on sm_kb_gaps for each row execute function sm_sync_touch('kb_gap');
create or replace trigger sm_kb_gaps_demo after insert on sm_kb_gaps for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_gaps_demo_t after update or delete on sm_kb_gaps for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_gaps enable row level security;

-- kb_glossary: واژه‌نامهٔ سازمان
do $cols$
begin
  if to_regclass('sm_kb_glossary') is not null then
    alter table sm_kb_glossary add column if not exists workspace_id uuid;
    alter table sm_kb_glossary add column if not exists domain_id uuid;
    alter table sm_kb_glossary add column if not exists unit_id uuid;
    alter table sm_kb_glossary add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_glossary add column if not exists created_by uuid;
    alter table sm_kb_glossary add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_glossary add column if not exists updated_by uuid;
    alter table sm_kb_glossary add column if not exists rev bigint not null default 0;
    alter table sm_kb_glossary add column if not exists version integer not null default 1;
    alter table sm_kb_glossary add column if not exists deleted_at timestamptz;
    alter table sm_kb_glossary add column if not exists origin text;
    alter table sm_kb_glossary add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_glossary add column if not exists term text;
    alter table sm_kb_glossary add column if not exists approved_fa text;
    alter table sm_kb_glossary add column if not exists synonyms jsonb;
    alter table sm_kb_glossary add column if not exists definition text;
    alter table sm_kb_glossary add column if not exists language text;
    alter table sm_kb_glossary add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_kb_glossary (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  term text,
  approved_fa text,
  synonyms jsonb,
  definition text,
  language text,
  active boolean not null default true
);
create index if not exists sm_kb_glossary_rev_idx on sm_kb_glossary (org_id, rev);
create index if not exists sm_kb_glossary_upd_idx on sm_kb_glossary (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_glossary_crt_idx on sm_kb_glossary (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_glossary_term_uk on sm_kb_glossary (org_id, term) where deleted_at is null;
drop trigger if exists sm_kb_glossary_sync on sm_kb_glossary;
create trigger sm_kb_glossary_sync before insert or update on sm_kb_glossary for each row execute function sm_sync_touch('kb_glossary');
create or replace trigger sm_kb_glossary_demo after insert on sm_kb_glossary for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_glossary_demo_t after update or delete on sm_kb_glossary for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_glossary enable row level security;

-- kb_licence: مجوزهای KCS
do $cols$
begin
  if to_regclass('sm_kb_licences') is not null then
    alter table sm_kb_licences add column if not exists workspace_id uuid;
    alter table sm_kb_licences add column if not exists domain_id uuid;
    alter table sm_kb_licences add column if not exists unit_id uuid;
    alter table sm_kb_licences add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_licences add column if not exists created_by uuid;
    alter table sm_kb_licences add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_licences add column if not exists updated_by uuid;
    alter table sm_kb_licences add column if not exists rev bigint not null default 0;
    alter table sm_kb_licences add column if not exists version integer not null default 1;
    alter table sm_kb_licences add column if not exists deleted_at timestamptz;
    alter table sm_kb_licences add column if not exists origin text;
    alter table sm_kb_licences add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_licences add column if not exists user_id uuid;
    alter table sm_kb_licences add column if not exists level text;
    alter table sm_kb_licences add column if not exists base_id uuid;
    alter table sm_kb_licences add column if not exists coach_id uuid;
    alter table sm_kb_licences add column if not exists granted_at date;
    alter table sm_kb_licences add column if not exists expires_at date;
    alter table sm_kb_licences add column if not exists evidence text;
    alter table sm_kb_licences add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_licences (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  level text,
  base_id uuid,
  coach_id uuid,
  granted_at date,
  expires_at date,
  evidence text,
  state text
);
create index if not exists sm_kb_licences_rev_idx on sm_kb_licences (org_id, rev);
create index if not exists sm_kb_licences_upd_idx on sm_kb_licences (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_licences_crt_idx on sm_kb_licences (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_licences_user_id_idx on sm_kb_licences (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_licences_state_idx on sm_kb_licences (org_id, state) where deleted_at is null;
drop trigger if exists sm_kb_licences_sync on sm_kb_licences;
create trigger sm_kb_licences_sync before insert or update on sm_kb_licences for each row execute function sm_sync_touch('kb_licence');
create or replace trigger sm_kb_licences_demo after insert on sm_kb_licences for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_licences_demo_t after update or delete on sm_kb_licences for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_licences enable row level security;

-- kb_quality_review: ارزیابی‌های کیفیت (AQI)
do $cols$
begin
  if to_regclass('sm_kb_quality_reviews') is not null then
    alter table sm_kb_quality_reviews add column if not exists workspace_id uuid;
    alter table sm_kb_quality_reviews add column if not exists domain_id uuid;
    alter table sm_kb_quality_reviews add column if not exists unit_id uuid;
    alter table sm_kb_quality_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_quality_reviews add column if not exists created_by uuid;
    alter table sm_kb_quality_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_quality_reviews add column if not exists updated_by uuid;
    alter table sm_kb_quality_reviews add column if not exists rev bigint not null default 0;
    alter table sm_kb_quality_reviews add column if not exists version integer not null default 1;
    alter table sm_kb_quality_reviews add column if not exists deleted_at timestamptz;
    alter table sm_kb_quality_reviews add column if not exists origin text;
    alter table sm_kb_quality_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_quality_reviews add column if not exists article_id uuid;
    alter table sm_kb_quality_reviews add column if not exists version_label text;
    alter table sm_kb_quality_reviews add column if not exists period text;
    alter table sm_kb_quality_reviews add column if not exists author_id uuid;
    alter table sm_kb_quality_reviews add column if not exists reviewer_id uuid;
    alter table sm_kb_quality_reviews add column if not exists results jsonb;
    alter table sm_kb_quality_reviews add column if not exists score integer;
    alter table sm_kb_quality_reviews add column if not exists notes text;
    alter table sm_kb_quality_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_quality_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_id uuid,
  version_label text,
  period text,
  author_id uuid,
  reviewer_id uuid,
  results jsonb,
  score integer,
  notes text,
  state text
);
create index if not exists sm_kb_quality_reviews_rev_idx on sm_kb_quality_reviews (org_id, rev);
create index if not exists sm_kb_quality_reviews_upd_idx on sm_kb_quality_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_crt_idx on sm_kb_quality_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_article_id_idx on sm_kb_quality_reviews (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_author_id_idx on sm_kb_quality_reviews (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_reviewer_id_idx on sm_kb_quality_reviews (org_id, reviewer_id) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_state_idx on sm_kb_quality_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_kb_quality_reviews_workspace_acc_idx on sm_kb_quality_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_quality_reviews_unit_acc_idx on sm_kb_quality_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_quality_reviews_domain_acc_idx on sm_kb_quality_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_quality_reviews_sync on sm_kb_quality_reviews;
create trigger sm_kb_quality_reviews_sync before insert or update on sm_kb_quality_reviews for each row execute function sm_sync_touch('kb_quality_review');
create or replace trigger sm_kb_quality_reviews_demo after insert on sm_kb_quality_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_quality_reviews_demo_t after update or delete on sm_kb_quality_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_quality_reviews enable row level security;

-- kb_search_rule: قاعده‌های جست‌وجوی دانش
do $cols$
begin
  if to_regclass('sm_kb_search_rules') is not null then
    alter table sm_kb_search_rules add column if not exists workspace_id uuid;
    alter table sm_kb_search_rules add column if not exists domain_id uuid;
    alter table sm_kb_search_rules add column if not exists unit_id uuid;
    alter table sm_kb_search_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_search_rules add column if not exists created_by uuid;
    alter table sm_kb_search_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_search_rules add column if not exists updated_by uuid;
    alter table sm_kb_search_rules add column if not exists rev bigint not null default 0;
    alter table sm_kb_search_rules add column if not exists version integer not null default 1;
    alter table sm_kb_search_rules add column if not exists deleted_at timestamptz;
    alter table sm_kb_search_rules add column if not exists origin text;
    alter table sm_kb_search_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_search_rules add column if not exists query text;
    alter table sm_kb_search_rules add column if not exists kind text;
    alter table sm_kb_search_rules add column if not exists active boolean not null default true;
    alter table sm_kb_search_rules add column if not exists articles jsonb;
    alter table sm_kb_search_rules add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_kb_search_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  query text,
  kind text,
  active boolean not null default true,
  articles jsonb,
  note text
);
create index if not exists sm_kb_search_rules_rev_idx on sm_kb_search_rules (org_id, rev);
create index if not exists sm_kb_search_rules_upd_idx on sm_kb_search_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_search_rules_crt_idx on sm_kb_search_rules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_kb_search_rules_sync on sm_kb_search_rules;
create trigger sm_kb_search_rules_sync before insert or update on sm_kb_search_rules for each row execute function sm_sync_touch('kb_search_rule');
create or replace trigger sm_kb_search_rules_demo after insert on sm_kb_search_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_search_rules_demo_t after update or delete on sm_kb_search_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_search_rules enable row level security;

-- kb_snippet: پاسخ‌های کوتاه
do $cols$
begin
  if to_regclass('sm_kb_snippets') is not null then
    alter table sm_kb_snippets add column if not exists workspace_id uuid;
    alter table sm_kb_snippets add column if not exists domain_id uuid;
    alter table sm_kb_snippets add column if not exists unit_id uuid;
    alter table sm_kb_snippets add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_snippets add column if not exists created_by uuid;
    alter table sm_kb_snippets add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_snippets add column if not exists updated_by uuid;
    alter table sm_kb_snippets add column if not exists rev bigint not null default 0;
    alter table sm_kb_snippets add column if not exists version integer not null default 1;
    alter table sm_kb_snippets add column if not exists deleted_at timestamptz;
    alter table sm_kb_snippets add column if not exists origin text;
    alter table sm_kb_snippets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_snippets add column if not exists no integer;
    alter table sm_kb_snippets add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBS' || no::text else 'KBS' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_snippets add column if not exists question text;
    alter table sm_kb_snippets add column if not exists answer text;
    alter table sm_kb_snippets add column if not exists base_id uuid;
    alter table sm_kb_snippets add column if not exists source_article_id uuid;
    alter table sm_kb_snippets add column if not exists language text;
    alter table sm_kb_snippets add column if not exists owner_id uuid;
    alter table sm_kb_snippets add column if not exists owner_group_id uuid;
    alter table sm_kb_snippets add column if not exists valid_to date;
    alter table sm_kb_snippets add column if not exists visibility text;
    alter table sm_kb_snippets add column if not exists confidential boolean not null default false;
    alter table sm_kb_snippets add column if not exists ai_generated boolean not null default false;
    alter table sm_kb_snippets add column if not exists k_users jsonb;
    alter table sm_kb_snippets add column if not exists k_groups jsonb;
    alter table sm_kb_snippets add column if not exists access_list jsonb;
    alter table sm_kb_snippets add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_snippets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBS' || no::text else 'KBS' || lpad(no::text, 6, '0') end) stored,
  question text,
  answer text,
  base_id uuid,
  source_article_id uuid,
  language text,
  owner_id uuid,
  owner_group_id uuid,
  valid_to date,
  visibility text,
  confidential boolean not null default false,
  ai_generated boolean not null default false,
  k_users jsonb,
  k_groups jsonb,
  access_list jsonb,
  state text,
  search_398fabe7 text generated always as (translate(coalesce(question, '') || ' ' || coalesce(answer, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_snippets' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_398fabe7' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_snippets', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_snippets', 'search_398fabe7', $x$translate(coalesce(question, '') || ' ' || coalesce(answer, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_snippets' and indexname like 'sm\_kb\_snippets\_search\_%' and indexname not in ('sm_kb_snippets_search_398fabe7_trgm', 'sm_kb_snippets_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_snippets_search_398fabe7_trgm', 'sm_kb_snippets', 'search_398fabe7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_snippets_search_custom_trgm', 'sm_kb_snippets', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_snippets_no_uk on sm_kb_snippets (org_id, no);
create index if not exists sm_kb_snippets_rev_idx on sm_kb_snippets (org_id, rev);
create index if not exists sm_kb_snippets_upd_idx on sm_kb_snippets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_crt_idx on sm_kb_snippets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_snippets_base_id_idx on sm_kb_snippets (org_id, base_id) where deleted_at is null;
create index if not exists sm_kb_snippets_owner_id_idx on sm_kb_snippets (org_id, owner_id) where deleted_at is null;
create index if not exists sm_kb_snippets_k_users_gin on sm_kb_snippets using gin (k_users);
create index if not exists sm_kb_snippets_k_groups_gin on sm_kb_snippets using gin (k_groups);
create index if not exists sm_kb_snippets_state_idx on sm_kb_snippets (org_id, state) where deleted_at is null;
create index if not exists sm_kb_snippets_workspace_acc_idx on sm_kb_snippets (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_snippets_unit_acc_idx on sm_kb_snippets (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_snippets_domain_acc_idx on sm_kb_snippets (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_snippets_sync on sm_kb_snippets;
create trigger sm_kb_snippets_sync before insert or update on sm_kb_snippets for each row execute function sm_sync_touch('kb_snippet');
create or replace trigger sm_kb_snippets_demo after insert on sm_kb_snippets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_snippets_demo_t after update or delete on sm_kb_snippets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_snippets enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:15', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۷ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 17/30 (a0c3bc7de847)
-- kb_subscription: اشتراک‌های دانش
do $cols$
begin
  if to_regclass('sm_kb_subscriptions') is not null then
    alter table sm_kb_subscriptions add column if not exists workspace_id uuid;
    alter table sm_kb_subscriptions add column if not exists domain_id uuid;
    alter table sm_kb_subscriptions add column if not exists unit_id uuid;
    alter table sm_kb_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_subscriptions add column if not exists created_by uuid;
    alter table sm_kb_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_subscriptions add column if not exists updated_by uuid;
    alter table sm_kb_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_kb_subscriptions add column if not exists version integer not null default 1;
    alter table sm_kb_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_kb_subscriptions add column if not exists origin text;
    alter table sm_kb_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_subscriptions add column if not exists user_id uuid;
    alter table sm_kb_subscriptions add column if not exists target_table text;
    alter table sm_kb_subscriptions add column if not exists target_id text;
    alter table sm_kb_subscriptions add column if not exists target_label text;
    alter table sm_kb_subscriptions add column if not exists events jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_subscriptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  target_table text,
  target_id text,
  target_label text,
  events jsonb
);
create index if not exists sm_kb_subscriptions_rev_idx on sm_kb_subscriptions (org_id, rev);
create index if not exists sm_kb_subscriptions_upd_idx on sm_kb_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_subscriptions_crt_idx on sm_kb_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_subscriptions_user_id_idx on sm_kb_subscriptions (org_id, user_id) where deleted_at is null;
create index if not exists sm_kb_subscriptions_target_id_idx on sm_kb_subscriptions (org_id, target_id) where deleted_at is null;
create unique index if not exists sm_kb_subscriptions_user_id_target_table_target_id_uk on sm_kb_subscriptions (org_id, user_id, target_table, target_id) where deleted_at is null;
create index if not exists sm_kb_subscriptions_workspace_acc_idx on sm_kb_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_subscriptions_unit_acc_idx on sm_kb_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_subscriptions_domain_acc_idx on sm_kb_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_subscriptions_sync on sm_kb_subscriptions;
create trigger sm_kb_subscriptions_sync before insert or update on sm_kb_subscriptions for each row execute function sm_sync_touch('kb_subscription');
create or replace trigger sm_kb_subscriptions_demo after insert on sm_kb_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_subscriptions_demo_t after update or delete on sm_kb_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_subscriptions enable row level security;

-- kb_task: کارهای دانش
do $cols$
begin
  if to_regclass('sm_kb_tasks') is not null then
    alter table sm_kb_tasks add column if not exists workspace_id uuid;
    alter table sm_kb_tasks add column if not exists domain_id uuid;
    alter table sm_kb_tasks add column if not exists unit_id uuid;
    alter table sm_kb_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_tasks add column if not exists created_by uuid;
    alter table sm_kb_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_tasks add column if not exists updated_by uuid;
    alter table sm_kb_tasks add column if not exists rev bigint not null default 0;
    alter table sm_kb_tasks add column if not exists version integer not null default 1;
    alter table sm_kb_tasks add column if not exists deleted_at timestamptz;
    alter table sm_kb_tasks add column if not exists origin text;
    alter table sm_kb_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_tasks add column if not exists no integer;
    alter table sm_kb_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBT' || no::text else 'KBT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_kb_tasks add column if not exists short_description text;
    alter table sm_kb_tasks add column if not exists description text;
    alter table sm_kb_tasks add column if not exists state text;
    alter table sm_kb_tasks add column if not exists priority text;
    alter table sm_kb_tasks add column if not exists impact text;
    alter table sm_kb_tasks add column if not exists urgency text;
    alter table sm_kb_tasks add column if not exists category text;
    alter table sm_kb_tasks add column if not exists subcategory text;
    alter table sm_kb_tasks add column if not exists channel text;
    alter table sm_kb_tasks add column if not exists caller_id uuid;
    alter table sm_kb_tasks add column if not exists requested_for uuid;
    alter table sm_kb_tasks add column if not exists opened_by uuid;
    alter table sm_kb_tasks add column if not exists opened_at timestamptz;
    alter table sm_kb_tasks add column if not exists assignment_group_id uuid;
    alter table sm_kb_tasks add column if not exists assigned_to uuid;
    alter table sm_kb_tasks add column if not exists service_id uuid;
    alter table sm_kb_tasks add column if not exists offering_id uuid;
    alter table sm_kb_tasks add column if not exists ci_id uuid;
    alter table sm_kb_tasks add column if not exists location_id uuid;
    alter table sm_kb_tasks add column if not exists due_at timestamptz;
    alter table sm_kb_tasks add column if not exists resolved_at timestamptz;
    alter table sm_kb_tasks add column if not exists resolved_by uuid;
    alter table sm_kb_tasks add column if not exists closed_at timestamptz;
    alter table sm_kb_tasks add column if not exists closed_by uuid;
    alter table sm_kb_tasks add column if not exists close_code text;
    alter table sm_kb_tasks add column if not exists close_notes text;
    alter table sm_kb_tasks add column if not exists parent_id uuid;
    alter table sm_kb_tasks add column if not exists watch_list jsonb;
    alter table sm_kb_tasks add column if not exists approval text;
    alter table sm_kb_tasks add column if not exists escalation integer;
    alter table sm_kb_tasks add column if not exists reassignment_count integer;
    alter table sm_kb_tasks add column if not exists reopen_count integer;
    alter table sm_kb_tasks add column if not exists time_worked bigint;
    alter table sm_kb_tasks add column if not exists first_response_at timestamptz;
    alter table sm_kb_tasks add column if not exists active boolean not null default true;
    alter table sm_kb_tasks add column if not exists sla_due timestamptz;
    alter table sm_kb_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_kb_tasks add column if not exists kind text;
    alter table sm_kb_tasks add column if not exists article_id uuid;
    alter table sm_kb_tasks add column if not exists gap_id uuid;
    alter table sm_kb_tasks add column if not exists feedback_count integer;
    alter table sm_kb_tasks add column if not exists source_table text;
    alter table sm_kb_tasks add column if not exists source_id text;
    alter table sm_kb_tasks add column if not exists source_number text;
    alter table sm_kb_tasks add column if not exists k_users jsonb;
    alter table sm_kb_tasks add column if not exists k_groups jsonb;
  end if;
end
$cols$;
create table if not exists sm_kb_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KBT' || no::text else 'KBT' || lpad(no::text, 6, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  kind text,
  article_id uuid,
  gap_id uuid,
  feedback_count integer,
  source_table text,
  source_id text,
  source_number text,
  k_users jsonb,
  k_groups jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_kb_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_kb_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_kb_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_kb_tasks' and indexname like 'sm\_kb\_tasks\_search\_%' and indexname not in ('sm_kb_tasks_search_f3bce210_trgm', 'sm_kb_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_kb_tasks_search_f3bce210_trgm', 'sm_kb_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_kb_tasks_search_custom_trgm', 'sm_kb_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_kb_tasks_no_uk on sm_kb_tasks (org_id, no);
create index if not exists sm_kb_tasks_rev_idx on sm_kb_tasks (org_id, rev);
create index if not exists sm_kb_tasks_upd_idx on sm_kb_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_crt_idx on sm_kb_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_tasks_state_idx on sm_kb_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_kb_tasks_assignment_group_id_idx on sm_kb_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_kb_tasks_assigned_to_idx on sm_kb_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_kb_tasks_article_id_idx on sm_kb_tasks (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_tasks_source_id_idx on sm_kb_tasks (org_id, source_id) where deleted_at is null;
create index if not exists sm_kb_tasks_k_users_gin on sm_kb_tasks using gin (k_users);
create index if not exists sm_kb_tasks_k_groups_gin on sm_kb_tasks using gin (k_groups);
create index if not exists sm_kb_tasks_workspace_acc_idx on sm_kb_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_tasks_unit_acc_idx on sm_kb_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_tasks_domain_acc_idx on sm_kb_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_kb_tasks_caller_id_idx on sm_kb_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_kb_tasks_requested_for_idx on sm_kb_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_kb_tasks_opened_by_idx on sm_kb_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_kb_tasks_watch_list_gin on sm_kb_tasks using gin (watch_list);
create index if not exists sm_kb_tasks_open_grp_idx on sm_kb_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_kb_tasks_opened_brin on sm_kb_tasks using brin (opened_at);
drop trigger if exists sm_kb_tasks_sync on sm_kb_tasks;
create trigger sm_kb_tasks_sync before insert or update on sm_kb_tasks for each row execute function sm_sync_touch('kb_task');
create or replace trigger sm_kb_tasks_demo after insert on sm_kb_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_tasks_demo_t after update or delete on sm_kb_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_tasks enable row level security;

-- kb_template: قالب‌های مقاله
do $cols$
begin
  if to_regclass('sm_kb_templates') is not null then
    alter table sm_kb_templates add column if not exists workspace_id uuid;
    alter table sm_kb_templates add column if not exists domain_id uuid;
    alter table sm_kb_templates add column if not exists unit_id uuid;
    alter table sm_kb_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_templates add column if not exists created_by uuid;
    alter table sm_kb_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_templates add column if not exists updated_by uuid;
    alter table sm_kb_templates add column if not exists rev bigint not null default 0;
    alter table sm_kb_templates add column if not exists version integer not null default 1;
    alter table sm_kb_templates add column if not exists deleted_at timestamptz;
    alter table sm_kb_templates add column if not exists origin text;
    alter table sm_kb_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_templates add column if not exists name text;
    alter table sm_kb_templates add column if not exists article_type text;
    alter table sm_kb_templates add column if not exists active boolean not null default true;
    alter table sm_kb_templates add column if not exists description text;
    alter table sm_kb_templates add column if not exists sections jsonb;
    alter table sm_kb_templates add column if not exists sort_order integer;
    alter table sm_kb_templates add column if not exists builtin text;
  end if;
end
$cols$;
create table if not exists sm_kb_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  article_type text,
  active boolean not null default true,
  description text,
  sections jsonb,
  sort_order integer,
  builtin text
);
create index if not exists sm_kb_templates_rev_idx on sm_kb_templates (org_id, rev);
create index if not exists sm_kb_templates_upd_idx on sm_kb_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_templates_crt_idx on sm_kb_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_kb_templates_name_uk on sm_kb_templates (org_id, name) where deleted_at is null;
drop trigger if exists sm_kb_templates_sync on sm_kb_templates;
create trigger sm_kb_templates_sync before insert or update on sm_kb_templates for each row execute function sm_sync_touch('kb_template');
create or replace trigger sm_kb_templates_demo after insert on sm_kb_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_templates_demo_t after update or delete on sm_kb_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_templates enable row level security;

-- kb_version: نسخه‌های مقاله
do $cols$
begin
  if to_regclass('sm_kb_versions') is not null then
    alter table sm_kb_versions add column if not exists workspace_id uuid;
    alter table sm_kb_versions add column if not exists domain_id uuid;
    alter table sm_kb_versions add column if not exists unit_id uuid;
    alter table sm_kb_versions add column if not exists created_at timestamptz not null default now();
    alter table sm_kb_versions add column if not exists created_by uuid;
    alter table sm_kb_versions add column if not exists updated_at timestamptz not null default now();
    alter table sm_kb_versions add column if not exists updated_by uuid;
    alter table sm_kb_versions add column if not exists rev bigint not null default 0;
    alter table sm_kb_versions add column if not exists version integer not null default 1;
    alter table sm_kb_versions add column if not exists deleted_at timestamptz;
    alter table sm_kb_versions add column if not exists origin text;
    alter table sm_kb_versions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_kb_versions add column if not exists article_id uuid;
    alter table sm_kb_versions add column if not exists version_label text;
    alter table sm_kb_versions add column if not exists change_kind text;
    alter table sm_kb_versions add column if not exists major integer;
    alter table sm_kb_versions add column if not exists minor integer;
    alter table sm_kb_versions add column if not exists title text;
    alter table sm_kb_versions add column if not exists summary text;
    alter table sm_kb_versions add column if not exists body text;
    alter table sm_kb_versions add column if not exists internal_body text;
    alter table sm_kb_versions add column if not exists keywords jsonb;
    alter table sm_kb_versions add column if not exists tags jsonb;
    alter table sm_kb_versions add column if not exists change_note text;
    alter table sm_kb_versions add column if not exists author_id uuid;
    alter table sm_kb_versions add column if not exists publish_at timestamptz;
    alter table sm_kb_versions add column if not exists submitted_at timestamptz;
    alter table sm_kb_versions add column if not exists submitted_by uuid;
    alter table sm_kb_versions add column if not exists approved_at timestamptz;
    alter table sm_kb_versions add column if not exists approved_by uuid;
    alter table sm_kb_versions add column if not exists published_at timestamptz;
    alter table sm_kb_versions add column if not exists published_by uuid;
    alter table sm_kb_versions add column if not exists approval text;
    alter table sm_kb_versions add column if not exists needs_approval boolean not null default false;
    alter table sm_kb_versions add column if not exists approval_mode text;
    alter table sm_kb_versions add column if not exists reviewer_ids jsonb;
    alter table sm_kb_versions add column if not exists ai_provenance jsonb;
    alter table sm_kb_versions add column if not exists ai_validated_by uuid;
    alter table sm_kb_versions add column if not exists content_hash text;
    alter table sm_kb_versions add column if not exists word_count integer;
    alter table sm_kb_versions add column if not exists checks jsonb;
    alter table sm_kb_versions add column if not exists k_users jsonb;
    alter table sm_kb_versions add column if not exists k_groups jsonb;
    alter table sm_kb_versions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_kb_versions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  article_id uuid,
  version_label text,
  change_kind text,
  major integer,
  minor integer,
  title text,
  summary text,
  body text,
  internal_body text,
  keywords jsonb,
  tags jsonb,
  change_note text,
  author_id uuid,
  publish_at timestamptz,
  submitted_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  published_at timestamptz,
  published_by uuid,
  approval text,
  needs_approval boolean not null default false,
  approval_mode text,
  reviewer_ids jsonb,
  ai_provenance jsonb,
  ai_validated_by uuid,
  content_hash text,
  word_count integer,
  checks jsonb,
  k_users jsonb,
  k_groups jsonb,
  state text
);
create index if not exists sm_kb_versions_rev_idx on sm_kb_versions (org_id, rev);
create index if not exists sm_kb_versions_upd_idx on sm_kb_versions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_crt_idx on sm_kb_versions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_kb_versions_article_id_idx on sm_kb_versions (org_id, article_id) where deleted_at is null;
create index if not exists sm_kb_versions_author_id_idx on sm_kb_versions (org_id, author_id) where deleted_at is null;
create index if not exists sm_kb_versions_reviewer_ids_gin on sm_kb_versions using gin (reviewer_ids);
create index if not exists sm_kb_versions_k_users_gin on sm_kb_versions using gin (k_users);
create index if not exists sm_kb_versions_k_groups_gin on sm_kb_versions using gin (k_groups);
create index if not exists sm_kb_versions_state_idx on sm_kb_versions (org_id, state) where deleted_at is null;
create index if not exists sm_kb_versions_workspace_acc_idx on sm_kb_versions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_kb_versions_unit_acc_idx on sm_kb_versions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_kb_versions_domain_acc_idx on sm_kb_versions (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_kb_versions_sync on sm_kb_versions;
create trigger sm_kb_versions_sync before insert or update on sm_kb_versions for each row execute function sm_sync_touch('kb_version');
create or replace trigger sm_kb_versions_demo after insert on sm_kb_versions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_kb_versions_demo_t after update or delete on sm_kb_versions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_kb_versions enable row level security;

-- known_error: خطاهای شناخته‌شده
do $cols$
begin
  if to_regclass('sm_known_errors') is not null then
    alter table sm_known_errors add column if not exists workspace_id uuid;
    alter table sm_known_errors add column if not exists domain_id uuid;
    alter table sm_known_errors add column if not exists unit_id uuid;
    alter table sm_known_errors add column if not exists created_at timestamptz not null default now();
    alter table sm_known_errors add column if not exists created_by uuid;
    alter table sm_known_errors add column if not exists updated_at timestamptz not null default now();
    alter table sm_known_errors add column if not exists updated_by uuid;
    alter table sm_known_errors add column if not exists rev bigint not null default 0;
    alter table sm_known_errors add column if not exists version integer not null default 1;
    alter table sm_known_errors add column if not exists deleted_at timestamptz;
    alter table sm_known_errors add column if not exists origin text;
    alter table sm_known_errors add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_known_errors add column if not exists no integer;
    alter table sm_known_errors add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KE' || no::text else 'KE' || lpad(no::text, 6, '0') end) stored;
    alter table sm_known_errors add column if not exists short_description text;
    alter table sm_known_errors add column if not exists problem_id uuid;
    alter table sm_known_errors add column if not exists owner_id uuid;
    alter table sm_known_errors add column if not exists assignment_group_id uuid;
    alter table sm_known_errors add column if not exists symptoms text;
    alter table sm_known_errors add column if not exists root_cause text;
    alter table sm_known_errors add column if not exists workaround text;
    alter table sm_known_errors add column if not exists category text;
    alter table sm_known_errors add column if not exists subcategory text;
    alter table sm_known_errors add column if not exists service_id uuid;
    alter table sm_known_errors add column if not exists ci_id uuid;
    alter table sm_known_errors add column if not exists affected_cis jsonb;
    alter table sm_known_errors add column if not exists effectiveness text;
    alter table sm_known_errors add column if not exists review_at date;
    alter table sm_known_errors add column if not exists published_at timestamptz;
    alter table sm_known_errors add column if not exists published_by uuid;
    alter table sm_known_errors add column if not exists use_count integer;
    alter table sm_known_errors add column if not exists last_used_at timestamptz;
    alter table sm_known_errors add column if not exists incident_count integer;
    alter table sm_known_errors add column if not exists watch_list jsonb;
    alter table sm_known_errors add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_known_errors (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'KE' || no::text else 'KE' || lpad(no::text, 6, '0') end) stored,
  short_description text,
  problem_id uuid,
  owner_id uuid,
  assignment_group_id uuid,
  symptoms text,
  root_cause text,
  workaround text,
  category text,
  subcategory text,
  service_id uuid,
  ci_id uuid,
  affected_cis jsonb,
  effectiveness text,
  review_at date,
  published_at timestamptz,
  published_by uuid,
  use_count integer,
  last_used_at timestamptz,
  incident_count integer,
  watch_list jsonb,
  state text,
  search_36af9f51 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(symptoms, '') || ' ' || coalesce(root_cause, '') || ' ' || coalesce(workaround, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_known_errors' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_36af9f51' loop
    execute format('alter table %I drop column if exists %I', 'sm_known_errors', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_known_errors', 'search_36af9f51', $x$translate(coalesce(short_description, '') || ' ' || coalesce(symptoms, '') || ' ' || coalesce(root_cause, '') || ' ' || coalesce(workaround, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_known_errors' and indexname like 'sm\_known\_errors\_search\_%' and indexname not in ('sm_known_errors_search_36af9f51_trgm', 'sm_known_errors_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_known_errors_search_36af9f51_trgm', 'sm_known_errors', 'search_36af9f51', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_known_errors_search_custom_trgm', 'sm_known_errors', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_known_errors_no_uk on sm_known_errors (org_id, no);
create index if not exists sm_known_errors_rev_idx on sm_known_errors (org_id, rev);
create index if not exists sm_known_errors_upd_idx on sm_known_errors (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_known_errors_crt_idx on sm_known_errors (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_known_errors_problem_id_idx on sm_known_errors (org_id, problem_id) where deleted_at is null;
create index if not exists sm_known_errors_owner_id_idx on sm_known_errors (org_id, owner_id) where deleted_at is null;
create index if not exists sm_known_errors_assignment_group_id_idx on sm_known_errors (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_known_errors_state_idx on sm_known_errors (org_id, state) where deleted_at is null;
create index if not exists sm_known_errors_workspace_acc_idx on sm_known_errors (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_known_errors_unit_acc_idx on sm_known_errors (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_known_errors_domain_acc_idx on sm_known_errors (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_known_errors_watch_list_gin on sm_known_errors using gin (watch_list);
drop trigger if exists sm_known_errors_sync on sm_known_errors;
create trigger sm_known_errors_sync before insert or update on sm_known_errors for each row execute function sm_sync_touch('known_error');
create or replace trigger sm_known_errors_demo after insert on sm_known_errors for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_known_errors_demo_t after update or delete on sm_known_errors for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_known_errors enable row level security;

-- label_template: الگوهای برچسب
do $cols$
begin
  if to_regclass('sm_label_templates') is not null then
    alter table sm_label_templates add column if not exists workspace_id uuid;
    alter table sm_label_templates add column if not exists domain_id uuid;
    alter table sm_label_templates add column if not exists unit_id uuid;
    alter table sm_label_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_label_templates add column if not exists created_by uuid;
    alter table sm_label_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_label_templates add column if not exists updated_by uuid;
    alter table sm_label_templates add column if not exists rev bigint not null default 0;
    alter table sm_label_templates add column if not exists version integer not null default 1;
    alter table sm_label_templates add column if not exists deleted_at timestamptz;
    alter table sm_label_templates add column if not exists origin text;
    alter table sm_label_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_label_templates add column if not exists name text;
    alter table sm_label_templates add column if not exists is_default boolean not null default false;
    alter table sm_label_templates add column if not exists active boolean not null default true;
    alter table sm_label_templates add column if not exists cols_count integer;
    alter table sm_label_templates add column if not exists rows_count integer;
    alter table sm_label_templates add column if not exists label_width_mm numeric;
    alter table sm_label_templates add column if not exists label_height_mm numeric;
    alter table sm_label_templates add column if not exists margin_top_mm numeric;
    alter table sm_label_templates add column if not exists margin_side_mm numeric;
    alter table sm_label_templates add column if not exists gap_x_mm numeric;
    alter table sm_label_templates add column if not exists gap_y_mm numeric;
    alter table sm_label_templates add column if not exists fields jsonb;
    alter table sm_label_templates add column if not exists title text;
  end if;
end
$cols$;
create table if not exists sm_label_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  is_default boolean not null default false,
  active boolean not null default true,
  cols_count integer,
  rows_count integer,
  label_width_mm numeric,
  label_height_mm numeric,
  margin_top_mm numeric,
  margin_side_mm numeric,
  gap_x_mm numeric,
  gap_y_mm numeric,
  fields jsonb,
  title text
);
create index if not exists sm_label_templates_rev_idx on sm_label_templates (org_id, rev);
create index if not exists sm_label_templates_upd_idx on sm_label_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_label_templates_crt_idx on sm_label_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_label_templates_sync on sm_label_templates;
create trigger sm_label_templates_sync before insert or update on sm_label_templates for each row execute function sm_sync_touch('label_template');
create or replace trigger sm_label_templates_demo after insert on sm_label_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_label_templates_demo_t after update or delete on sm_label_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_label_templates enable row level security;

-- legal_request: درخواست‌های حقوقی
do $cols$
begin
  if to_regclass('sm_legal_requests') is not null then
    alter table sm_legal_requests add column if not exists workspace_id uuid;
    alter table sm_legal_requests add column if not exists domain_id uuid;
    alter table sm_legal_requests add column if not exists unit_id uuid;
    alter table sm_legal_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_legal_requests add column if not exists created_by uuid;
    alter table sm_legal_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_legal_requests add column if not exists updated_by uuid;
    alter table sm_legal_requests add column if not exists rev bigint not null default 0;
    alter table sm_legal_requests add column if not exists version integer not null default 1;
    alter table sm_legal_requests add column if not exists deleted_at timestamptz;
    alter table sm_legal_requests add column if not exists origin text;
    alter table sm_legal_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_legal_requests add column if not exists no integer;
    alter table sm_legal_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'LGL' || no::text else 'LGL' || lpad(no::text, 7, '0') end) stored;
    alter table sm_legal_requests add column if not exists short_description text;
    alter table sm_legal_requests add column if not exists description text;
    alter table sm_legal_requests add column if not exists state text;
    alter table sm_legal_requests add column if not exists priority text;
    alter table sm_legal_requests add column if not exists impact text;
    alter table sm_legal_requests add column if not exists urgency text;
    alter table sm_legal_requests add column if not exists category text;
    alter table sm_legal_requests add column if not exists subcategory text;
    alter table sm_legal_requests add column if not exists channel text;
    alter table sm_legal_requests add column if not exists caller_id uuid;
    alter table sm_legal_requests add column if not exists requested_for uuid;
    alter table sm_legal_requests add column if not exists opened_by uuid;
    alter table sm_legal_requests add column if not exists opened_at timestamptz;
    alter table sm_legal_requests add column if not exists assignment_group_id uuid;
    alter table sm_legal_requests add column if not exists assigned_to uuid;
    alter table sm_legal_requests add column if not exists service_id uuid;
    alter table sm_legal_requests add column if not exists offering_id uuid;
    alter table sm_legal_requests add column if not exists ci_id uuid;
    alter table sm_legal_requests add column if not exists location_id uuid;
    alter table sm_legal_requests add column if not exists due_at timestamptz;
    alter table sm_legal_requests add column if not exists resolved_at timestamptz;
    alter table sm_legal_requests add column if not exists resolved_by uuid;
    alter table sm_legal_requests add column if not exists closed_at timestamptz;
    alter table sm_legal_requests add column if not exists closed_by uuid;
    alter table sm_legal_requests add column if not exists close_code text;
    alter table sm_legal_requests add column if not exists close_notes text;
    alter table sm_legal_requests add column if not exists parent_id uuid;
    alter table sm_legal_requests add column if not exists watch_list jsonb;
    alter table sm_legal_requests add column if not exists approval text;
    alter table sm_legal_requests add column if not exists escalation integer;
    alter table sm_legal_requests add column if not exists reassignment_count integer;
    alter table sm_legal_requests add column if not exists reopen_count integer;
    alter table sm_legal_requests add column if not exists time_worked bigint;
    alter table sm_legal_requests add column if not exists first_response_at timestamptz;
    alter table sm_legal_requests add column if not exists active boolean not null default true;
    alter table sm_legal_requests add column if not exists sla_due timestamptz;
    alter table sm_legal_requests add column if not exists knowledge boolean not null default false;
    alter table sm_legal_requests add column if not exists title text;
    alter table sm_legal_requests add column if not exists department_id uuid;
    alter table sm_legal_requests add column if not exists dept_service_id uuid;
    alter table sm_legal_requests add column if not exists sensitive boolean not null default false;
    alter table sm_legal_requests add column if not exists journey_id uuid;
    alter table sm_legal_requests add column if not exists child_total integer;
    alter table sm_legal_requests add column if not exists child_open integer;
    alter table sm_legal_requests add column if not exists satisfaction integer;
    alter table sm_legal_requests add column if not exists matter_type text;
    alter table sm_legal_requests add column if not exists privileged boolean not null default true;
    alter table sm_legal_requests add column if not exists counterparty text;
    alter table sm_legal_requests add column if not exists contract_value numeric;
    alter table sm_legal_requests add column if not exists deadline date;
    alter table sm_legal_requests add column if not exists conflict_checked boolean not null default false;
    alter table sm_legal_requests add column if not exists conflict_notes text;
    alter table sm_legal_requests add column if not exists outcome text;
    alter table sm_legal_requests add column if not exists confidential boolean not null default false;
    alter table sm_legal_requests add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_legal_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'LGL' || no::text else 'LGL' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  title text,
  department_id uuid,
  dept_service_id uuid,
  sensitive boolean not null default false,
  journey_id uuid,
  child_total integer,
  child_open integer,
  satisfaction integer,
  matter_type text,
  privileged boolean not null default true,
  counterparty text,
  contract_value numeric,
  deadline date,
  conflict_checked boolean not null default false,
  conflict_notes text,
  outcome text,
  confidential boolean not null default false,
  access_list jsonb,
  search_3b95400c text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(counterparty, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_legal_requests' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_3b95400c' loop
    execute format('alter table %I drop column if exists %I', 'sm_legal_requests', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_legal_requests', 'search_3b95400c', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(counterparty, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_legal_requests' and indexname like 'sm\_legal\_requests\_search\_%' and indexname not in ('sm_legal_requests_search_3b95400c_trgm', 'sm_legal_requests_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_legal_requests_search_3b95400c_trgm', 'sm_legal_requests', 'search_3b95400c', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_legal_requests_search_custom_trgm', 'sm_legal_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_legal_requests_no_uk on sm_legal_requests (org_id, no);
create index if not exists sm_legal_requests_rev_idx on sm_legal_requests (org_id, rev);
create index if not exists sm_legal_requests_upd_idx on sm_legal_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_legal_requests_crt_idx on sm_legal_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_legal_requests_state_idx on sm_legal_requests (org_id, state) where deleted_at is null;
create index if not exists sm_legal_requests_assignment_group_id_idx on sm_legal_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_legal_requests_assigned_to_idx on sm_legal_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_legal_requests_department_id_idx on sm_legal_requests (org_id, department_id) where deleted_at is null;
create index if not exists sm_legal_requests_dept_service_id_idx on sm_legal_requests (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_legal_requests_workspace_acc_idx on sm_legal_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_legal_requests_unit_acc_idx on sm_legal_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_legal_requests_domain_acc_idx on sm_legal_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_legal_requests_caller_id_idx on sm_legal_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_legal_requests_requested_for_idx on sm_legal_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_legal_requests_opened_by_idx on sm_legal_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_legal_requests_watch_list_gin on sm_legal_requests using gin (watch_list);
create index if not exists sm_legal_requests_open_grp_idx on sm_legal_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_legal_requests_opened_brin on sm_legal_requests using brin (opened_at);
drop trigger if exists sm_legal_requests_sync on sm_legal_requests;
create trigger sm_legal_requests_sync before insert or update on sm_legal_requests for each row execute function sm_sync_touch('legal_request');
create or replace trigger sm_legal_requests_demo after insert on sm_legal_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_legal_requests_demo_t after update or delete on sm_legal_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_legal_requests enable row level security;

-- licence_pool: مجوزها و صندلی‌ها
do $cols$
begin
  if to_regclass('sm_licence_pools') is not null then
    alter table sm_licence_pools add column if not exists workspace_id uuid;
    alter table sm_licence_pools add column if not exists domain_id uuid;
    alter table sm_licence_pools add column if not exists unit_id uuid;
    alter table sm_licence_pools add column if not exists created_at timestamptz not null default now();
    alter table sm_licence_pools add column if not exists created_by uuid;
    alter table sm_licence_pools add column if not exists updated_at timestamptz not null default now();
    alter table sm_licence_pools add column if not exists updated_by uuid;
    alter table sm_licence_pools add column if not exists rev bigint not null default 0;
    alter table sm_licence_pools add column if not exists version integer not null default 1;
    alter table sm_licence_pools add column if not exists deleted_at timestamptz;
    alter table sm_licence_pools add column if not exists origin text;
    alter table sm_licence_pools add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_licence_pools add column if not exists name text;
    alter table sm_licence_pools add column if not exists kind text;
    alter table sm_licence_pools add column if not exists quantity integer;
    alter table sm_licence_pools add column if not exists valid_until date;
    alter table sm_licence_pools add column if not exists active boolean not null default true;
    alter table sm_licence_pools add column if not exists note text;
  end if;
end
$cols$;
create table if not exists sm_licence_pools (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  quantity integer,
  valid_until date,
  active boolean not null default true,
  note text
);
create index if not exists sm_licence_pools_rev_idx on sm_licence_pools (org_id, rev);
create index if not exists sm_licence_pools_upd_idx on sm_licence_pools (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_licence_pools_crt_idx on sm_licence_pools (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_licence_pools_sync on sm_licence_pools;
create trigger sm_licence_pools_sync before insert or update on sm_licence_pools for each row execute function sm_sync_touch('licence_pool');
create or replace trigger sm_licence_pools_demo after insert on sm_licence_pools for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_licence_pools_demo_t after update or delete on sm_licence_pools for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_licence_pools enable row level security;

-- license_allocation: تخصیص‌های مجوز
do $cols$
begin
  if to_regclass('sm_license_allocations') is not null then
    alter table sm_license_allocations add column if not exists workspace_id uuid;
    alter table sm_license_allocations add column if not exists domain_id uuid;
    alter table sm_license_allocations add column if not exists unit_id uuid;
    alter table sm_license_allocations add column if not exists created_at timestamptz not null default now();
    alter table sm_license_allocations add column if not exists created_by uuid;
    alter table sm_license_allocations add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_allocations add column if not exists updated_by uuid;
    alter table sm_license_allocations add column if not exists rev bigint not null default 0;
    alter table sm_license_allocations add column if not exists version integer not null default 1;
    alter table sm_license_allocations add column if not exists deleted_at timestamptz;
    alter table sm_license_allocations add column if not exists origin text;
    alter table sm_license_allocations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_allocations add column if not exists entitlement_id uuid;
    alter table sm_license_allocations add column if not exists user_id uuid;
    alter table sm_license_allocations add column if not exists ci_id uuid;
    alter table sm_license_allocations add column if not exists allocated_at timestamptz;
    alter table sm_license_allocations add column if not exists released_at timestamptz;
    alter table sm_license_allocations add column if not exists active boolean not null default true;
    alter table sm_license_allocations add column if not exists note text;
    alter table sm_license_allocations add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_license_allocations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  entitlement_id uuid,
  user_id uuid,
  ci_id uuid,
  allocated_at timestamptz,
  released_at timestamptz,
  active boolean not null default true,
  note text,
  label text
);
create index if not exists sm_license_allocations_rev_idx on sm_license_allocations (org_id, rev);
create index if not exists sm_license_allocations_upd_idx on sm_license_allocations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_allocations_crt_idx on sm_license_allocations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_allocations_entitlement_id_idx on sm_license_allocations (org_id, entitlement_id) where deleted_at is null;
create index if not exists sm_license_allocations_workspace_acc_idx on sm_license_allocations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_license_allocations_unit_acc_idx on sm_license_allocations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_license_allocations_domain_acc_idx on sm_license_allocations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_license_allocations_user_id_idx on sm_license_allocations (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_license_allocations_sync on sm_license_allocations;
create trigger sm_license_allocations_sync before insert or update on sm_license_allocations for each row execute function sm_sync_touch('license_allocation');
create or replace trigger sm_license_allocations_demo after insert on sm_license_allocations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_allocations_demo_t after update or delete on sm_license_allocations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_allocations enable row level security;

-- license_entitlement: مجوزهای نرم‌افزار
do $cols$
begin
  if to_regclass('sm_license_entitlements') is not null then
    alter table sm_license_entitlements add column if not exists workspace_id uuid;
    alter table sm_license_entitlements add column if not exists domain_id uuid;
    alter table sm_license_entitlements add column if not exists unit_id uuid;
    alter table sm_license_entitlements add column if not exists created_at timestamptz not null default now();
    alter table sm_license_entitlements add column if not exists created_by uuid;
    alter table sm_license_entitlements add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_entitlements add column if not exists updated_by uuid;
    alter table sm_license_entitlements add column if not exists rev bigint not null default 0;
    alter table sm_license_entitlements add column if not exists version integer not null default 1;
    alter table sm_license_entitlements add column if not exists deleted_at timestamptz;
    alter table sm_license_entitlements add column if not exists origin text;
    alter table sm_license_entitlements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_entitlements add column if not exists no integer;
    alter table sm_license_entitlements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ENT' || no::text else 'ENT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_license_entitlements add column if not exists name text;
    alter table sm_license_entitlements add column if not exists software_model_id uuid;
    alter table sm_license_entitlements add column if not exists metric text;
    alter table sm_license_entitlements add column if not exists quantity integer;
    alter table sm_license_entitlements add column if not exists min_cores integer;
    alter table sm_license_entitlements add column if not exists supplier_id uuid;
    alter table sm_license_entitlements add column if not exists contract_id uuid;
    alter table sm_license_entitlements add column if not exists owner_id uuid;
    alter table sm_license_entitlements add column if not exists cost_center_id uuid;
    alter table sm_license_entitlements add column if not exists po_number text;
    alter table sm_license_entitlements add column if not exists purchase_date date;
    alter table sm_license_entitlements add column if not exists start_date date;
    alter table sm_license_entitlements add column if not exists end_date date;
    alter table sm_license_entitlements add column if not exists true_up_date date;
    alter table sm_license_entitlements add column if not exists unit_cost numeric;
    alter table sm_license_entitlements add column if not exists total_cost numeric;
    alter table sm_license_entitlements add column if not exists annual_cost numeric;
    alter table sm_license_entitlements add column if not exists license_key text;
    alter table sm_license_entitlements add column if not exists downgrade_rights boolean not null default false;
    alter table sm_license_entitlements add column if not exists allocation_required boolean not null default false;
    alter table sm_license_entitlements add column if not exists reminded jsonb;
    alter table sm_license_entitlements add column if not exists notes text;
    alter table sm_license_entitlements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_license_entitlements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'ENT' || no::text else 'ENT' || lpad(no::text, 6, '0') end) stored,
  name text,
  software_model_id uuid,
  metric text,
  quantity integer,
  min_cores integer,
  supplier_id uuid,
  contract_id uuid,
  owner_id uuid,
  cost_center_id uuid,
  po_number text,
  purchase_date date,
  start_date date,
  end_date date,
  true_up_date date,
  unit_cost numeric,
  total_cost numeric,
  annual_cost numeric,
  license_key text,
  downgrade_rights boolean not null default false,
  allocation_required boolean not null default false,
  reminded jsonb,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_license_entitlements' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_license_entitlements', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_license_entitlements', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_license_entitlements' and indexname like 'sm\_license\_entitlements\_search\_%' and indexname not in ('sm_license_entitlements_search_56291d9d_trgm', 'sm_license_entitlements_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_license_entitlements_search_56291d9d_trgm', 'sm_license_entitlements', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_license_entitlements_search_custom_trgm', 'sm_license_entitlements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_license_entitlements_no_uk on sm_license_entitlements (org_id, no);
create index if not exists sm_license_entitlements_rev_idx on sm_license_entitlements (org_id, rev);
create index if not exists sm_license_entitlements_upd_idx on sm_license_entitlements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_entitlements_crt_idx on sm_license_entitlements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_entitlements_software_model_id_idx on sm_license_entitlements (org_id, software_model_id) where deleted_at is null;
create index if not exists sm_license_entitlements_end_date_idx on sm_license_entitlements (org_id, end_date) where deleted_at is null;
create index if not exists sm_license_entitlements_state_idx on sm_license_entitlements (org_id, state) where deleted_at is null;
create index if not exists sm_license_entitlements_workspace_acc_idx on sm_license_entitlements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_license_entitlements_unit_acc_idx on sm_license_entitlements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_license_entitlements_domain_acc_idx on sm_license_entitlements (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_license_entitlements_owner_id_idx on sm_license_entitlements (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_license_entitlements_sync on sm_license_entitlements;
create trigger sm_license_entitlements_sync before insert or update on sm_license_entitlements for each row execute function sm_sync_touch('license_entitlement');
create or replace trigger sm_license_entitlements_demo after insert on sm_license_entitlements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_entitlements_demo_t after update or delete on sm_license_entitlements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_entitlements enable row level security;

-- license_position: وضعیت مجوزها
do $cols$
begin
  if to_regclass('sm_license_positions') is not null then
    alter table sm_license_positions add column if not exists workspace_id uuid;
    alter table sm_license_positions add column if not exists domain_id uuid;
    alter table sm_license_positions add column if not exists unit_id uuid;
    alter table sm_license_positions add column if not exists created_at timestamptz not null default now();
    alter table sm_license_positions add column if not exists created_by uuid;
    alter table sm_license_positions add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_positions add column if not exists updated_by uuid;
    alter table sm_license_positions add column if not exists rev bigint not null default 0;
    alter table sm_license_positions add column if not exists version integer not null default 1;
    alter table sm_license_positions add column if not exists deleted_at timestamptz;
    alter table sm_license_positions add column if not exists origin text;
    alter table sm_license_positions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_positions add column if not exists run_id uuid;
    alter table sm_license_positions add column if not exists software_model_id uuid;
    alter table sm_license_positions add column if not exists metric text;
    alter table sm_license_positions add column if not exists entitled integer;
    alter table sm_license_positions add column if not exists consumed integer;
    alter table sm_license_positions add column if not exists delta integer;
    alter table sm_license_positions add column if not exists installs integer;
    alter table sm_license_positions add column if not exists devices integer;
    alter table sm_license_positions add column if not exists users integer;
    alter table sm_license_positions add column if not exists unused_installs integer;
    alter table sm_license_positions add column if not exists status text;
    alter table sm_license_positions add column if not exists unit_price numeric;
    alter table sm_license_positions add column if not exists exposure numeric;
    alter table sm_license_positions add column if not exists savings numeric;
    alter table sm_license_positions add column if not exists detail jsonb;
    alter table sm_license_positions add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_license_positions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  run_id uuid,
  software_model_id uuid,
  metric text,
  entitled integer,
  consumed integer,
  delta integer,
  installs integer,
  devices integer,
  users integer,
  unused_installs integer,
  status text,
  unit_price numeric,
  exposure numeric,
  savings numeric,
  detail jsonb,
  label text
);
create index if not exists sm_license_positions_rev_idx on sm_license_positions (org_id, rev);
create index if not exists sm_license_positions_upd_idx on sm_license_positions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_positions_crt_idx on sm_license_positions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_positions_run_id_idx on sm_license_positions (org_id, run_id) where deleted_at is null;
create index if not exists sm_license_positions_software_model_id_idx on sm_license_positions (org_id, software_model_id) where deleted_at is null;
drop trigger if exists sm_license_positions_sync on sm_license_positions;
create trigger sm_license_positions_sync before insert or update on sm_license_positions for each row execute function sm_sync_touch('license_position');
create or replace trigger sm_license_positions_demo after insert on sm_license_positions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_positions_demo_t after update or delete on sm_license_positions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_positions enable row level security;

-- license_reconcile_run: اجراهای تطبیق مجوز
do $cols$
begin
  if to_regclass('sm_license_reconcile_runs') is not null then
    alter table sm_license_reconcile_runs add column if not exists workspace_id uuid;
    alter table sm_license_reconcile_runs add column if not exists domain_id uuid;
    alter table sm_license_reconcile_runs add column if not exists unit_id uuid;
    alter table sm_license_reconcile_runs add column if not exists created_at timestamptz not null default now();
    alter table sm_license_reconcile_runs add column if not exists created_by uuid;
    alter table sm_license_reconcile_runs add column if not exists updated_at timestamptz not null default now();
    alter table sm_license_reconcile_runs add column if not exists updated_by uuid;
    alter table sm_license_reconcile_runs add column if not exists rev bigint not null default 0;
    alter table sm_license_reconcile_runs add column if not exists version integer not null default 1;
    alter table sm_license_reconcile_runs add column if not exists deleted_at timestamptz;
    alter table sm_license_reconcile_runs add column if not exists origin text;
    alter table sm_license_reconcile_runs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_license_reconcile_runs add column if not exists no integer;
    alter table sm_license_reconcile_runs add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'LRN' || no::text else 'LRN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_license_reconcile_runs add column if not exists status text;
    alter table sm_license_reconcile_runs add column if not exists trigger text;
    alter table sm_license_reconcile_runs add column if not exists started_at timestamptz;
    alter table sm_license_reconcile_runs add column if not exists finished_at timestamptz;
    alter table sm_license_reconcile_runs add column if not exists products integer;
    alter table sm_license_reconcile_runs add column if not exists compliant integer;
    alter table sm_license_reconcile_runs add column if not exists under_licensed integer;
    alter table sm_license_reconcile_runs add column if not exists over_licensed integer;
    alter table sm_license_reconcile_runs add column if not exists exposure numeric;
    alter table sm_license_reconcile_runs add column if not exists savings numeric;
    alter table sm_license_reconcile_runs add column if not exists error text;
  end if;
end
$cols$;
create table if not exists sm_license_reconcile_runs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'LRN' || no::text else 'LRN' || lpad(no::text, 6, '0') end) stored,
  status text,
  trigger text,
  started_at timestamptz,
  finished_at timestamptz,
  products integer,
  compliant integer,
  under_licensed integer,
  over_licensed integer,
  exposure numeric,
  savings numeric,
  error text
);
do $search$
declare old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_license_reconcile_runs' and column_name ~ '^search_[0-9a-f]{8}$' loop
    execute format('alter table %I drop column if exists %I', 'sm_license_reconcile_runs', old.column_name);
  end loop;
end
$search$;
create unique index if not exists sm_license_reconcile_runs_no_uk on sm_license_reconcile_runs (org_id, no);
create index if not exists sm_license_reconcile_runs_rev_idx on sm_license_reconcile_runs (org_id, rev);
create index if not exists sm_license_reconcile_runs_upd_idx on sm_license_reconcile_runs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_license_reconcile_runs_crt_idx on sm_license_reconcile_runs (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_license_reconcile_runs_sync on sm_license_reconcile_runs;
create trigger sm_license_reconcile_runs_sync before insert or update on sm_license_reconcile_runs for each row execute function sm_sync_touch('license_reconcile_run');
create or replace trigger sm_license_reconcile_runs_demo after insert on sm_license_reconcile_runs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_license_reconcile_runs_demo_t after update or delete on sm_license_reconcile_runs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_license_reconcile_runs enable row level security;

-- location: مکان‌ها
do $cols$
begin
  if to_regclass('sm_locations') is not null then
    alter table sm_locations add column if not exists workspace_id uuid;
    alter table sm_locations add column if not exists domain_id uuid;
    alter table sm_locations add column if not exists unit_id uuid;
    alter table sm_locations add column if not exists created_at timestamptz not null default now();
    alter table sm_locations add column if not exists created_by uuid;
    alter table sm_locations add column if not exists updated_at timestamptz not null default now();
    alter table sm_locations add column if not exists updated_by uuid;
    alter table sm_locations add column if not exists rev bigint not null default 0;
    alter table sm_locations add column if not exists version integer not null default 1;
    alter table sm_locations add column if not exists deleted_at timestamptz;
    alter table sm_locations add column if not exists origin text;
    alter table sm_locations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_locations add column if not exists name text;
    alter table sm_locations add column if not exists code text;
    alter table sm_locations add column if not exists kind text;
    alter table sm_locations add column if not exists parent_id uuid;
    alter table sm_locations add column if not exists timezone text;
    alter table sm_locations add column if not exists address text;
    alter table sm_locations add column if not exists active boolean not null default true;
    alter table sm_locations add column if not exists path text;
    alter table sm_locations add column if not exists depth integer;
  end if;
end
$cols$;
create table if not exists sm_locations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  code text,
  kind text,
  parent_id uuid,
  timezone text,
  address text,
  active boolean not null default true,
  path text,
  depth integer
);
create index if not exists sm_locations_rev_idx on sm_locations (org_id, rev);
create index if not exists sm_locations_upd_idx on sm_locations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_locations_crt_idx on sm_locations (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_locations_code_uk on sm_locations (org_id, code) where deleted_at is null;
create index if not exists sm_locations_parent_id_idx on sm_locations (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_locations_sync on sm_locations;
create trigger sm_locations_sync before insert or update on sm_locations for each row execute function sm_sync_touch('location');
create or replace trigger sm_locations_demo after insert on sm_locations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_locations_demo_t after update or delete on sm_locations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_locations enable row level security;

-- maintenance_plan: برنامه‌های نگهداری
do $cols$
begin
  if to_regclass('sm_maintenance_plans') is not null then
    alter table sm_maintenance_plans add column if not exists workspace_id uuid;
    alter table sm_maintenance_plans add column if not exists domain_id uuid;
    alter table sm_maintenance_plans add column if not exists unit_id uuid;
    alter table sm_maintenance_plans add column if not exists created_at timestamptz not null default now();
    alter table sm_maintenance_plans add column if not exists created_by uuid;
    alter table sm_maintenance_plans add column if not exists updated_at timestamptz not null default now();
    alter table sm_maintenance_plans add column if not exists updated_by uuid;
    alter table sm_maintenance_plans add column if not exists rev bigint not null default 0;
    alter table sm_maintenance_plans add column if not exists version integer not null default 1;
    alter table sm_maintenance_plans add column if not exists deleted_at timestamptz;
    alter table sm_maintenance_plans add column if not exists origin text;
    alter table sm_maintenance_plans add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_maintenance_plans add column if not exists no integer;
    alter table sm_maintenance_plans add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PMP' || no::text else 'PMP' || lpad(no::text, 5, '0') end) stored;
    alter table sm_maintenance_plans add column if not exists name text;
    alter table sm_maintenance_plans add column if not exists status text;
    alter table sm_maintenance_plans add column if not exists generates text;
    alter table sm_maintenance_plans add column if not exists ci_id uuid;
    alter table sm_maintenance_plans add column if not exists location_id uuid;
    alter table sm_maintenance_plans add column if not exists account_id uuid;
    alter table sm_maintenance_plans add column if not exists template_id uuid;
    alter table sm_maintenance_plans add column if not exists group_id uuid;
    alter table sm_maintenance_plans add column if not exists territory_id uuid;
    alter table sm_maintenance_plans add column if not exists every_n integer;
    alter table sm_maintenance_plans add column if not exists interval_unit text;
    alter table sm_maintenance_plans add column if not exists lead_days integer;
    alter table sm_maintenance_plans add column if not exists horizon integer;
    alter table sm_maintenance_plans add column if not exists next_due date;
    alter table sm_maintenance_plans add column if not exists last_generated_due date;
    alter table sm_maintenance_plans add column if not exists priority text;
    alter table sm_maintenance_plans add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_maintenance_plans (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'PMP' || no::text else 'PMP' || lpad(no::text, 5, '0') end) stored,
  name text,
  status text,
  generates text,
  ci_id uuid,
  location_id uuid,
  account_id uuid,
  template_id uuid,
  group_id uuid,
  territory_id uuid,
  every_n integer,
  interval_unit text,
  lead_days integer,
  horizon integer,
  next_due date,
  last_generated_due date,
  priority text,
  description text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_maintenance_plans' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_maintenance_plans', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_maintenance_plans', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_maintenance_plans' and indexname like 'sm\_maintenance\_plans\_search\_%' and indexname not in ('sm_maintenance_plans_search_56291d9d_trgm', 'sm_maintenance_plans_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_maintenance_plans_search_56291d9d_trgm', 'sm_maintenance_plans', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_maintenance_plans_search_custom_trgm', 'sm_maintenance_plans', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_maintenance_plans_no_uk on sm_maintenance_plans (org_id, no);
create index if not exists sm_maintenance_plans_rev_idx on sm_maintenance_plans (org_id, rev);
create index if not exists sm_maintenance_plans_upd_idx on sm_maintenance_plans (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_maintenance_plans_crt_idx on sm_maintenance_plans (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_maintenance_plans_workspace_acc_idx on sm_maintenance_plans (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_maintenance_plans_unit_acc_idx on sm_maintenance_plans (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_maintenance_plans_domain_acc_idx on sm_maintenance_plans (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_maintenance_plans_sync on sm_maintenance_plans;
create trigger sm_maintenance_plans_sync before insert or update on sm_maintenance_plans for each row execute function sm_sync_touch('maintenance_plan');
create or replace trigger sm_maintenance_plans_demo after insert on sm_maintenance_plans for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_maintenance_plans_demo_t after update or delete on sm_maintenance_plans for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_maintenance_plans enable row level security;

-- maintenance_sla: تعهدهای نگهداری دستگاه‌ها
do $cols$
begin
  if to_regclass('sm_maintenance_slas') is not null then
    alter table sm_maintenance_slas add column if not exists workspace_id uuid;
    alter table sm_maintenance_slas add column if not exists domain_id uuid;
    alter table sm_maintenance_slas add column if not exists unit_id uuid;
    alter table sm_maintenance_slas add column if not exists created_at timestamptz not null default now();
    alter table sm_maintenance_slas add column if not exists created_by uuid;
    alter table sm_maintenance_slas add column if not exists updated_at timestamptz not null default now();
    alter table sm_maintenance_slas add column if not exists updated_by uuid;
    alter table sm_maintenance_slas add column if not exists rev bigint not null default 0;
    alter table sm_maintenance_slas add column if not exists version integer not null default 1;
    alter table sm_maintenance_slas add column if not exists deleted_at timestamptz;
    alter table sm_maintenance_slas add column if not exists origin text;
    alter table sm_maintenance_slas add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_maintenance_slas add column if not exists name text;
    alter table sm_maintenance_slas add column if not exists contract_id uuid;
    alter table sm_maintenance_slas add column if not exists categories jsonb;
    alter table sm_maintenance_slas add column if not exists response_hours integer;
    alter table sm_maintenance_slas add column if not exists restore_hours integer;
    alter table sm_maintenance_slas add column if not exists availability_target numeric;
    alter table sm_maintenance_slas add column if not exists counts_maintenance boolean not null default false;
    alter table sm_maintenance_slas add column if not exists penalty_per_hour numeric;
    alter table sm_maintenance_slas add column if not exists penalty_cap numeric;
    alter table sm_maintenance_slas add column if not exists active boolean not null default true;
    alter table sm_maintenance_slas add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_maintenance_slas (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  contract_id uuid,
  categories jsonb,
  response_hours integer,
  restore_hours integer,
  availability_target numeric,
  counts_maintenance boolean not null default false,
  penalty_per_hour numeric,
  penalty_cap numeric,
  active boolean not null default true,
  notes text
);
create index if not exists sm_maintenance_slas_rev_idx on sm_maintenance_slas (org_id, rev);
create index if not exists sm_maintenance_slas_upd_idx on sm_maintenance_slas (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_maintenance_slas_crt_idx on sm_maintenance_slas (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_maintenance_slas_sync on sm_maintenance_slas;
create trigger sm_maintenance_slas_sync before insert or update on sm_maintenance_slas for each row execute function sm_sync_touch('maintenance_sla');
create or replace trigger sm_maintenance_slas_demo after insert on sm_maintenance_slas for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_maintenance_slas_demo_t after update or delete on sm_maintenance_slas for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_maintenance_slas enable row level security;

-- member_profile: نمایه‌های اعضا
do $cols$
begin
  if to_regclass('sm_member_profiles') is not null then
    alter table sm_member_profiles add column if not exists workspace_id uuid;
    alter table sm_member_profiles add column if not exists domain_id uuid;
    alter table sm_member_profiles add column if not exists unit_id uuid;
    alter table sm_member_profiles add column if not exists created_at timestamptz not null default now();
    alter table sm_member_profiles add column if not exists created_by uuid;
    alter table sm_member_profiles add column if not exists updated_at timestamptz not null default now();
    alter table sm_member_profiles add column if not exists updated_by uuid;
    alter table sm_member_profiles add column if not exists rev bigint not null default 0;
    alter table sm_member_profiles add column if not exists version integer not null default 1;
    alter table sm_member_profiles add column if not exists deleted_at timestamptz;
    alter table sm_member_profiles add column if not exists origin text;
    alter table sm_member_profiles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_member_profiles add column if not exists user_id uuid;
    alter table sm_member_profiles add column if not exists name text;
    alter table sm_member_profiles add column if not exists persona text;
    alter table sm_member_profiles add column if not exists roles jsonb;
    alter table sm_member_profiles add column if not exists org_unit_id uuid;
    alter table sm_member_profiles add column if not exists location_id uuid;
    alter table sm_member_profiles add column if not exists manager_id uuid;
    alter table sm_member_profiles add column if not exists domain_unit_id uuid;
    alter table sm_member_profiles add column if not exists workspaces jsonb;
    alter table sm_member_profiles add column if not exists title text;
    alter table sm_member_profiles add column if not exists phone text;
    alter table sm_member_profiles add column if not exists vip boolean not null default false;
    alter table sm_member_profiles add column if not exists skills jsonb;
    alter table sm_member_profiles add column if not exists language text;
    alter table sm_member_profiles add column if not exists timezone text;
    alter table sm_member_profiles add column if not exists out_of_office boolean not null default false;
    alter table sm_member_profiles add column if not exists ooo_until timestamptz;
    alter table sm_member_profiles add column if not exists delegate_id uuid;
  end if;
end
$cols$;
create table if not exists sm_member_profiles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  name text,
  persona text,
  roles jsonb,
  org_unit_id uuid,
  location_id uuid,
  manager_id uuid,
  domain_unit_id uuid,
  workspaces jsonb,
  title text,
  phone text,
  vip boolean not null default false,
  skills jsonb,
  language text,
  timezone text,
  out_of_office boolean not null default false,
  ooo_until timestamptz,
  delegate_id uuid
);
create index if not exists sm_member_profiles_rev_idx on sm_member_profiles (org_id, rev);
create index if not exists sm_member_profiles_upd_idx on sm_member_profiles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_member_profiles_crt_idx on sm_member_profiles (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_member_profiles_user_id_uk on sm_member_profiles (org_id, user_id) where deleted_at is null;
create index if not exists sm_member_profiles_org_unit_id_idx on sm_member_profiles (org_id, org_unit_id) where deleted_at is null;
create index if not exists sm_member_profiles_manager_id_idx on sm_member_profiles (org_id, manager_id) where deleted_at is null;
create index if not exists sm_member_profiles_workspace_acc_idx on sm_member_profiles (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_member_profiles_unit_acc_idx on sm_member_profiles (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_member_profiles_domain_acc_idx on sm_member_profiles (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_member_profiles_user_id_idx on sm_member_profiles (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_member_profiles_sync on sm_member_profiles;
create trigger sm_member_profiles_sync before insert or update on sm_member_profiles for each row execute function sm_sync_touch('member_profile');
create or replace trigger sm_member_profiles_demo after insert on sm_member_profiles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_member_profiles_demo_t after update or delete on sm_member_profiles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_member_profiles enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:16', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۸ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 18/30 (a0c3bc7de847)
-- notification: اعلان‌ها
do $cols$
begin
  if to_regclass('sm_notifications') is not null then
    alter table sm_notifications add column if not exists workspace_id uuid;
    alter table sm_notifications add column if not exists domain_id uuid;
    alter table sm_notifications add column if not exists unit_id uuid;
    alter table sm_notifications add column if not exists created_at timestamptz not null default now();
    alter table sm_notifications add column if not exists created_by uuid;
    alter table sm_notifications add column if not exists updated_at timestamptz not null default now();
    alter table sm_notifications add column if not exists updated_by uuid;
    alter table sm_notifications add column if not exists rev bigint not null default 0;
    alter table sm_notifications add column if not exists version integer not null default 1;
    alter table sm_notifications add column if not exists deleted_at timestamptz;
    alter table sm_notifications add column if not exists origin text;
    alter table sm_notifications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notifications add column if not exists user_id uuid;
    alter table sm_notifications add column if not exists title text;
    alter table sm_notifications add column if not exists body text;
    alter table sm_notifications add column if not exists link text;
    alter table sm_notifications add column if not exists table_key text;
    alter table sm_notifications add column if not exists record_id text;
    alter table sm_notifications add column if not exists record_number text;
    alter table sm_notifications add column if not exists event text;
    alter table sm_notifications add column if not exists kind text;
    alter table sm_notifications add column if not exists actor_id uuid;
    alter table sm_notifications add column if not exists rule_key text;
    alter table sm_notifications add column if not exists read_at timestamptz;
    alter table sm_notifications add column if not exists snoozed_until timestamptz;
  end if;
end
$cols$;
create table if not exists sm_notifications (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  title text,
  body text,
  link text,
  table_key text,
  record_id text,
  record_number text,
  event text,
  kind text,
  actor_id uuid,
  rule_key text,
  read_at timestamptz,
  snoozed_until timestamptz
);
create index if not exists sm_notifications_rev_idx on sm_notifications (org_id, rev);
create index if not exists sm_notifications_upd_idx on sm_notifications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notifications_crt_idx on sm_notifications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_notifications_workspace_acc_idx on sm_notifications (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_notifications_unit_acc_idx on sm_notifications (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_notifications_domain_acc_idx on sm_notifications (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_notifications_user_id_idx on sm_notifications (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_notifications_sync on sm_notifications;
create trigger sm_notifications_sync before insert or update on sm_notifications for each row execute function sm_sync_touch('notification');
create or replace trigger sm_notifications_demo after insert on sm_notifications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notifications_demo_t after update or delete on sm_notifications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notifications enable row level security;

-- notification_channel: کانال‌های پیام
do $cols$
begin
  if to_regclass('sm_notification_channels') is not null then
    alter table sm_notification_channels add column if not exists workspace_id uuid;
    alter table sm_notification_channels add column if not exists domain_id uuid;
    alter table sm_notification_channels add column if not exists unit_id uuid;
    alter table sm_notification_channels add column if not exists created_at timestamptz not null default now();
    alter table sm_notification_channels add column if not exists created_by uuid;
    alter table sm_notification_channels add column if not exists updated_at timestamptz not null default now();
    alter table sm_notification_channels add column if not exists updated_by uuid;
    alter table sm_notification_channels add column if not exists rev bigint not null default 0;
    alter table sm_notification_channels add column if not exists version integer not null default 1;
    alter table sm_notification_channels add column if not exists deleted_at timestamptz;
    alter table sm_notification_channels add column if not exists origin text;
    alter table sm_notification_channels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notification_channels add column if not exists name text;
    alter table sm_notification_channels add column if not exists kind text;
    alter table sm_notification_channels add column if not exists active boolean not null default true;
    alter table sm_notification_channels add column if not exists principal_id uuid;
    alter table sm_notification_channels add column if not exists endpoint text;
    alter table sm_notification_channels add column if not exists token text;
    alter table sm_notification_channels add column if not exists chat_id text;
    alter table sm_notification_channels add column if not exists sms_url text;
    alter table sm_notification_channels add column if not exists sms_method text;
    alter table sm_notification_channels add column if not exists sms_content_type text;
    alter table sm_notification_channels add column if not exists sms_sender text;
    alter table sm_notification_channels add column if not exists sms_body text;
    alter table sm_notification_channels add column if not exists sms_headers jsonb;
    alter table sm_notification_channels add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_notification_channels (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  active boolean not null default true,
  principal_id uuid,
  endpoint text,
  token text,
  chat_id text,
  sms_url text,
  sms_method text,
  sms_content_type text,
  sms_sender text,
  sms_body text,
  sms_headers jsonb,
  description text
);
create index if not exists sm_notification_channels_rev_idx on sm_notification_channels (org_id, rev);
create index if not exists sm_notification_channels_upd_idx on sm_notification_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_channels_crt_idx on sm_notification_channels (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_notification_channels_sync on sm_notification_channels;
create trigger sm_notification_channels_sync before insert or update on sm_notification_channels for each row execute function sm_sync_touch('notification_channel');
create or replace trigger sm_notification_channels_demo after insert on sm_notification_channels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_channels_demo_t after update or delete on sm_notification_channels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_channels enable row level security;

-- notification_pref: تنظیمات اعلان
do $cols$
begin
  if to_regclass('sm_notification_prefs') is not null then
    alter table sm_notification_prefs add column if not exists workspace_id uuid;
    alter table sm_notification_prefs add column if not exists domain_id uuid;
    alter table sm_notification_prefs add column if not exists unit_id uuid;
    alter table sm_notification_prefs add column if not exists created_at timestamptz not null default now();
    alter table sm_notification_prefs add column if not exists created_by uuid;
    alter table sm_notification_prefs add column if not exists updated_at timestamptz not null default now();
    alter table sm_notification_prefs add column if not exists updated_by uuid;
    alter table sm_notification_prefs add column if not exists rev bigint not null default 0;
    alter table sm_notification_prefs add column if not exists version integer not null default 1;
    alter table sm_notification_prefs add column if not exists deleted_at timestamptz;
    alter table sm_notification_prefs add column if not exists origin text;
    alter table sm_notification_prefs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notification_prefs add column if not exists user_id uuid;
    alter table sm_notification_prefs add column if not exists optouts jsonb;
    alter table sm_notification_prefs add column if not exists digest text;
    alter table sm_notification_prefs add column if not exists digest_hour integer;
    alter table sm_notification_prefs add column if not exists quiet_from text;
    alter table sm_notification_prefs add column if not exists quiet_to text;
    alter table sm_notification_prefs add column if not exists read_before timestamptz;
  end if;
end
$cols$;
create table if not exists sm_notification_prefs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  optouts jsonb,
  digest text,
  digest_hour integer,
  quiet_from text,
  quiet_to text,
  read_before timestamptz
);
create index if not exists sm_notification_prefs_rev_idx on sm_notification_prefs (org_id, rev);
create index if not exists sm_notification_prefs_upd_idx on sm_notification_prefs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_prefs_crt_idx on sm_notification_prefs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_notification_prefs_user_id_uk on sm_notification_prefs (org_id, user_id) where deleted_at is null;
create index if not exists sm_notification_prefs_workspace_acc_idx on sm_notification_prefs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_notification_prefs_unit_acc_idx on sm_notification_prefs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_notification_prefs_domain_acc_idx on sm_notification_prefs (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_notification_prefs_user_id_idx on sm_notification_prefs (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_notification_prefs_sync on sm_notification_prefs;
create trigger sm_notification_prefs_sync before insert or update on sm_notification_prefs for each row execute function sm_sync_touch('notification_pref');
create or replace trigger sm_notification_prefs_demo after insert on sm_notification_prefs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_prefs_demo_t after update or delete on sm_notification_prefs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_prefs enable row level security;

-- notification_rule: قانون‌های اعلان
do $cols$
begin
  if to_regclass('sm_notification_rules') is not null then
    alter table sm_notification_rules add column if not exists workspace_id uuid;
    alter table sm_notification_rules add column if not exists domain_id uuid;
    alter table sm_notification_rules add column if not exists unit_id uuid;
    alter table sm_notification_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_notification_rules add column if not exists created_by uuid;
    alter table sm_notification_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_notification_rules add column if not exists updated_by uuid;
    alter table sm_notification_rules add column if not exists rev bigint not null default 0;
    alter table sm_notification_rules add column if not exists version integer not null default 1;
    alter table sm_notification_rules add column if not exists deleted_at timestamptz;
    alter table sm_notification_rules add column if not exists origin text;
    alter table sm_notification_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notification_rules add column if not exists name text;
    alter table sm_notification_rules add column if not exists active boolean not null default true;
    alter table sm_notification_rules add column if not exists mandatory boolean not null default false;
    alter table sm_notification_rules add column if not exists table_key text;
    alter table sm_notification_rules add column if not exists event text;
    alter table sm_notification_rules add column if not exists custom_event text;
    alter table sm_notification_rules add column if not exists entry_kinds jsonb;
    alter table sm_notification_rules add column if not exists condition jsonb;
    alter table sm_notification_rules add column if not exists recipients jsonb;
    alter table sm_notification_rules add column if not exists notify_actor boolean not null default false;
    alter table sm_notification_rules add column if not exists large_groups text;
    alter table sm_notification_rules add column if not exists channels jsonb;
    alter table sm_notification_rules add column if not exists targets jsonb;
    alter table sm_notification_rules add column if not exists template_id uuid;
    alter table sm_notification_rules add column if not exists digest boolean not null default true;
    alter table sm_notification_rules add column if not exists builtin text;
    alter table sm_notification_rules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_notification_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  mandatory boolean not null default false,
  table_key text,
  event text,
  custom_event text,
  entry_kinds jsonb,
  condition jsonb,
  recipients jsonb,
  notify_actor boolean not null default false,
  large_groups text,
  channels jsonb,
  targets jsonb,
  template_id uuid,
  digest boolean not null default true,
  builtin text,
  description text
);
create index if not exists sm_notification_rules_rev_idx on sm_notification_rules (org_id, rev);
create index if not exists sm_notification_rules_upd_idx on sm_notification_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_rules_crt_idx on sm_notification_rules (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_notification_rules_builtin_uk on sm_notification_rules (org_id, builtin) where deleted_at is null;
drop trigger if exists sm_notification_rules_sync on sm_notification_rules;
create trigger sm_notification_rules_sync before insert or update on sm_notification_rules for each row execute function sm_sync_touch('notification_rule');
create or replace trigger sm_notification_rules_demo after insert on sm_notification_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_rules_demo_t after update or delete on sm_notification_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_rules enable row level security;

-- notification_template: الگوهای اعلان
do $cols$
begin
  if to_regclass('sm_notification_templates') is not null then
    alter table sm_notification_templates add column if not exists workspace_id uuid;
    alter table sm_notification_templates add column if not exists domain_id uuid;
    alter table sm_notification_templates add column if not exists unit_id uuid;
    alter table sm_notification_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_notification_templates add column if not exists created_by uuid;
    alter table sm_notification_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_notification_templates add column if not exists updated_by uuid;
    alter table sm_notification_templates add column if not exists rev bigint not null default 0;
    alter table sm_notification_templates add column if not exists version integer not null default 1;
    alter table sm_notification_templates add column if not exists deleted_at timestamptz;
    alter table sm_notification_templates add column if not exists origin text;
    alter table sm_notification_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_notification_templates add column if not exists name text;
    alter table sm_notification_templates add column if not exists event text;
    alter table sm_notification_templates add column if not exists table_key text;
    alter table sm_notification_templates add column if not exists subject text;
    alter table sm_notification_templates add column if not exists body text;
    alter table sm_notification_templates add column if not exists short_text text;
    alter table sm_notification_templates add column if not exists active boolean not null default true;
    alter table sm_notification_templates add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_notification_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  event text,
  table_key text,
  subject text,
  body text,
  short_text text,
  active boolean not null default true,
  description text
);
create index if not exists sm_notification_templates_rev_idx on sm_notification_templates (org_id, rev);
create index if not exists sm_notification_templates_upd_idx on sm_notification_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_notification_templates_crt_idx on sm_notification_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_notification_templates_sync on sm_notification_templates;
create trigger sm_notification_templates_sync before insert or update on sm_notification_templates for each row execute function sm_sync_touch('notification_template');
create or replace trigger sm_notification_templates_demo after insert on sm_notification_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_notification_templates_demo_t after update or delete on sm_notification_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_notification_templates enable row level security;

-- oncall_override: جایگزینی‌های کشیک
do $cols$
begin
  if to_regclass('sm_oncall_overrides') is not null then
    alter table sm_oncall_overrides add column if not exists workspace_id uuid;
    alter table sm_oncall_overrides add column if not exists domain_id uuid;
    alter table sm_oncall_overrides add column if not exists unit_id uuid;
    alter table sm_oncall_overrides add column if not exists created_at timestamptz not null default now();
    alter table sm_oncall_overrides add column if not exists created_by uuid;
    alter table sm_oncall_overrides add column if not exists updated_at timestamptz not null default now();
    alter table sm_oncall_overrides add column if not exists updated_by uuid;
    alter table sm_oncall_overrides add column if not exists rev bigint not null default 0;
    alter table sm_oncall_overrides add column if not exists version integer not null default 1;
    alter table sm_oncall_overrides add column if not exists deleted_at timestamptz;
    alter table sm_oncall_overrides add column if not exists origin text;
    alter table sm_oncall_overrides add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_oncall_overrides add column if not exists schedule_id uuid;
    alter table sm_oncall_overrides add column if not exists user_id uuid;
    alter table sm_oncall_overrides add column if not exists replaces_id uuid;
    alter table sm_oncall_overrides add column if not exists start_at timestamptz;
    alter table sm_oncall_overrides add column if not exists end_at timestamptz;
    alter table sm_oncall_overrides add column if not exists reason text;
  end if;
end
$cols$;
create table if not exists sm_oncall_overrides (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  schedule_id uuid,
  user_id uuid,
  replaces_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  reason text
);
create index if not exists sm_oncall_overrides_rev_idx on sm_oncall_overrides (org_id, rev);
create index if not exists sm_oncall_overrides_upd_idx on sm_oncall_overrides (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_overrides_crt_idx on sm_oncall_overrides (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_overrides_schedule_id_idx on sm_oncall_overrides (org_id, schedule_id) where deleted_at is null;
create index if not exists sm_oncall_overrides_workspace_acc_idx on sm_oncall_overrides (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_oncall_overrides_unit_acc_idx on sm_oncall_overrides (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_oncall_overrides_domain_acc_idx on sm_oncall_overrides (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_oncall_overrides_user_id_idx on sm_oncall_overrides (org_id, user_id) where deleted_at is null;
create index if not exists sm_oncall_overrides_replaces_id_idx on sm_oncall_overrides (org_id, replaces_id) where deleted_at is null;
drop trigger if exists sm_oncall_overrides_sync on sm_oncall_overrides;
create trigger sm_oncall_overrides_sync before insert or update on sm_oncall_overrides for each row execute function sm_sync_touch('oncall_override');
create or replace trigger sm_oncall_overrides_demo after insert on sm_oncall_overrides for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_oncall_overrides_demo_t after update or delete on sm_oncall_overrides for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_oncall_overrides enable row level security;

-- oncall_rotation: چرخش‌های کشیک
do $cols$
begin
  if to_regclass('sm_oncall_rotations') is not null then
    alter table sm_oncall_rotations add column if not exists workspace_id uuid;
    alter table sm_oncall_rotations add column if not exists domain_id uuid;
    alter table sm_oncall_rotations add column if not exists unit_id uuid;
    alter table sm_oncall_rotations add column if not exists created_at timestamptz not null default now();
    alter table sm_oncall_rotations add column if not exists created_by uuid;
    alter table sm_oncall_rotations add column if not exists updated_at timestamptz not null default now();
    alter table sm_oncall_rotations add column if not exists updated_by uuid;
    alter table sm_oncall_rotations add column if not exists rev bigint not null default 0;
    alter table sm_oncall_rotations add column if not exists version integer not null default 1;
    alter table sm_oncall_rotations add column if not exists deleted_at timestamptz;
    alter table sm_oncall_rotations add column if not exists origin text;
    alter table sm_oncall_rotations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_oncall_rotations add column if not exists schedule_id uuid;
    alter table sm_oncall_rotations add column if not exists name text;
    alter table sm_oncall_rotations add column if not exists layer integer;
    alter table sm_oncall_rotations add column if not exists rotation_type text;
    alter table sm_oncall_rotations add column if not exists length_hours integer;
    alter table sm_oncall_rotations add column if not exists active boolean not null default true;
    alter table sm_oncall_rotations add column if not exists start_at timestamptz;
    alter table sm_oncall_rotations add column if not exists end_at timestamptz;
    alter table sm_oncall_rotations add column if not exists members jsonb;
    alter table sm_oncall_rotations add column if not exists restriction text;
    alter table sm_oncall_rotations add column if not exists restrict_days jsonb;
    alter table sm_oncall_rotations add column if not exists restrict_from text;
    alter table sm_oncall_rotations add column if not exists restrict_to text;
  end if;
end
$cols$;
create table if not exists sm_oncall_rotations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  schedule_id uuid,
  name text,
  layer integer,
  rotation_type text,
  length_hours integer,
  active boolean not null default true,
  start_at timestamptz,
  end_at timestamptz,
  members jsonb,
  restriction text,
  restrict_days jsonb,
  restrict_from text,
  restrict_to text
);
create index if not exists sm_oncall_rotations_rev_idx on sm_oncall_rotations (org_id, rev);
create index if not exists sm_oncall_rotations_upd_idx on sm_oncall_rotations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_rotations_crt_idx on sm_oncall_rotations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_rotations_schedule_id_idx on sm_oncall_rotations (org_id, schedule_id) where deleted_at is null;
drop trigger if exists sm_oncall_rotations_sync on sm_oncall_rotations;
create trigger sm_oncall_rotations_sync before insert or update on sm_oncall_rotations for each row execute function sm_sync_touch('oncall_rotation');
create or replace trigger sm_oncall_rotations_demo after insert on sm_oncall_rotations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_oncall_rotations_demo_t after update or delete on sm_oncall_rotations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_oncall_rotations enable row level security;

-- oncall_schedule: برنامه‌های کشیک
do $cols$
begin
  if to_regclass('sm_oncall_schedules') is not null then
    alter table sm_oncall_schedules add column if not exists workspace_id uuid;
    alter table sm_oncall_schedules add column if not exists domain_id uuid;
    alter table sm_oncall_schedules add column if not exists unit_id uuid;
    alter table sm_oncall_schedules add column if not exists created_at timestamptz not null default now();
    alter table sm_oncall_schedules add column if not exists created_by uuid;
    alter table sm_oncall_schedules add column if not exists updated_at timestamptz not null default now();
    alter table sm_oncall_schedules add column if not exists updated_by uuid;
    alter table sm_oncall_schedules add column if not exists rev bigint not null default 0;
    alter table sm_oncall_schedules add column if not exists version integer not null default 1;
    alter table sm_oncall_schedules add column if not exists deleted_at timestamptz;
    alter table sm_oncall_schedules add column if not exists origin text;
    alter table sm_oncall_schedules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_oncall_schedules add column if not exists name text;
    alter table sm_oncall_schedules add column if not exists group_id uuid;
    alter table sm_oncall_schedules add column if not exists calendar_id uuid;
    alter table sm_oncall_schedules add column if not exists timezone text;
    alter table sm_oncall_schedules add column if not exists active boolean not null default true;
    alter table sm_oncall_schedules add column if not exists notify_shifts boolean not null default true;
    alter table sm_oncall_schedules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_oncall_schedules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  group_id uuid,
  calendar_id uuid,
  timezone text,
  active boolean not null default true,
  notify_shifts boolean not null default true,
  description text
);
create index if not exists sm_oncall_schedules_rev_idx on sm_oncall_schedules (org_id, rev);
create index if not exists sm_oncall_schedules_upd_idx on sm_oncall_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_schedules_crt_idx on sm_oncall_schedules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_oncall_schedules_workspace_acc_idx on sm_oncall_schedules (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_oncall_schedules_unit_acc_idx on sm_oncall_schedules (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_oncall_schedules_domain_acc_idx on sm_oncall_schedules (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_oncall_schedules_open_grp_idx on sm_oncall_schedules (org_id, group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_oncall_schedules_sync on sm_oncall_schedules;
create trigger sm_oncall_schedules_sync before insert or update on sm_oncall_schedules for each row execute function sm_sync_touch('oncall_schedule');
create or replace trigger sm_oncall_schedules_demo after insert on sm_oncall_schedules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_oncall_schedules_demo_t after update or delete on sm_oncall_schedules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_oncall_schedules enable row level security;

-- order_guide_rule: قاعده‌های راهنمای سفارش
do $cols$
begin
  if to_regclass('sm_order_guide_rules') is not null then
    alter table sm_order_guide_rules add column if not exists workspace_id uuid;
    alter table sm_order_guide_rules add column if not exists domain_id uuid;
    alter table sm_order_guide_rules add column if not exists unit_id uuid;
    alter table sm_order_guide_rules add column if not exists created_at timestamptz not null default now();
    alter table sm_order_guide_rules add column if not exists created_by uuid;
    alter table sm_order_guide_rules add column if not exists updated_at timestamptz not null default now();
    alter table sm_order_guide_rules add column if not exists updated_by uuid;
    alter table sm_order_guide_rules add column if not exists rev bigint not null default 0;
    alter table sm_order_guide_rules add column if not exists version integer not null default 1;
    alter table sm_order_guide_rules add column if not exists deleted_at timestamptz;
    alter table sm_order_guide_rules add column if not exists origin text;
    alter table sm_order_guide_rules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_order_guide_rules add column if not exists name text;
    alter table sm_order_guide_rules add column if not exists guide_id uuid;
    alter table sm_order_guide_rules add column if not exists item_id uuid;
    alter table sm_order_guide_rules add column if not exists condition jsonb;
    alter table sm_order_guide_rules add column if not exists mandatory boolean not null default false;
    alter table sm_order_guide_rules add column if not exists selected boolean not null default true;
    alter table sm_order_guide_rules add column if not exists cascade boolean not null default true;
    alter table sm_order_guide_rules add column if not exists quantity integer;
    alter table sm_order_guide_rules add column if not exists sort_order integer;
    alter table sm_order_guide_rules add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_order_guide_rules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  guide_id uuid,
  item_id uuid,
  condition jsonb,
  mandatory boolean not null default false,
  selected boolean not null default true,
  cascade boolean not null default true,
  quantity integer,
  sort_order integer,
  active boolean not null default true
);
create index if not exists sm_order_guide_rules_rev_idx on sm_order_guide_rules (org_id, rev);
create index if not exists sm_order_guide_rules_upd_idx on sm_order_guide_rules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_order_guide_rules_crt_idx on sm_order_guide_rules (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_order_guide_rules_guide_id_idx on sm_order_guide_rules (org_id, guide_id) where deleted_at is null;
drop trigger if exists sm_order_guide_rules_sync on sm_order_guide_rules;
create trigger sm_order_guide_rules_sync before insert or update on sm_order_guide_rules for each row execute function sm_sync_touch('order_guide_rule');
create or replace trigger sm_order_guide_rules_demo after insert on sm_order_guide_rules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_order_guide_rules_demo_t after update or delete on sm_order_guide_rules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_order_guide_rules enable row level security;

-- org_unit: واحدهای سازمانی
do $cols$
begin
  if to_regclass('sm_org_units') is not null then
    alter table sm_org_units add column if not exists workspace_id uuid;
    alter table sm_org_units add column if not exists domain_id uuid;
    alter table sm_org_units add column if not exists unit_id uuid;
    alter table sm_org_units add column if not exists created_at timestamptz not null default now();
    alter table sm_org_units add column if not exists created_by uuid;
    alter table sm_org_units add column if not exists updated_at timestamptz not null default now();
    alter table sm_org_units add column if not exists updated_by uuid;
    alter table sm_org_units add column if not exists rev bigint not null default 0;
    alter table sm_org_units add column if not exists version integer not null default 1;
    alter table sm_org_units add column if not exists deleted_at timestamptz;
    alter table sm_org_units add column if not exists origin text;
    alter table sm_org_units add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_org_units add column if not exists name text;
    alter table sm_org_units add column if not exists code text;
    alter table sm_org_units add column if not exists kind text;
    alter table sm_org_units add column if not exists parent_id uuid;
    alter table sm_org_units add column if not exists manager_id uuid;
    alter table sm_org_units add column if not exists location_id uuid;
    alter table sm_org_units add column if not exists is_domain boolean not null default false;
    alter table sm_org_units add column if not exists active boolean not null default true;
    alter table sm_org_units add column if not exists description text;
    alter table sm_org_units add column if not exists path text;
    alter table sm_org_units add column if not exists depth integer;
  end if;
end
$cols$;
create table if not exists sm_org_units (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  code text,
  kind text,
  parent_id uuid,
  manager_id uuid,
  location_id uuid,
  is_domain boolean not null default false,
  active boolean not null default true,
  description text,
  path text,
  depth integer
);
create index if not exists sm_org_units_rev_idx on sm_org_units (org_id, rev);
create index if not exists sm_org_units_upd_idx on sm_org_units (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_org_units_crt_idx on sm_org_units (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_org_units_code_uk on sm_org_units (org_id, code) where deleted_at is null;
create index if not exists sm_org_units_parent_id_idx on sm_org_units (org_id, parent_id) where deleted_at is null;
create index if not exists sm_org_units_manager_id_idx on sm_org_units (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_org_units_sync on sm_org_units;
create trigger sm_org_units_sync before insert or update on sm_org_units for each row execute function sm_sync_touch('org_unit');
create or replace trigger sm_org_units_demo after insert on sm_org_units for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_org_units_demo_t after update or delete on sm_org_units for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_org_units enable row level security;

-- outage: قطعی‌ها
do $cols$
begin
  if to_regclass('sm_outages') is not null then
    alter table sm_outages add column if not exists workspace_id uuid;
    alter table sm_outages add column if not exists domain_id uuid;
    alter table sm_outages add column if not exists unit_id uuid;
    alter table sm_outages add column if not exists created_at timestamptz not null default now();
    alter table sm_outages add column if not exists created_by uuid;
    alter table sm_outages add column if not exists updated_at timestamptz not null default now();
    alter table sm_outages add column if not exists updated_by uuid;
    alter table sm_outages add column if not exists rev bigint not null default 0;
    alter table sm_outages add column if not exists version integer not null default 1;
    alter table sm_outages add column if not exists deleted_at timestamptz;
    alter table sm_outages add column if not exists origin text;
    alter table sm_outages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_outages add column if not exists no integer;
    alter table sm_outages add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'OUT' || no::text else 'OUT' || lpad(no::text, 6, '0') end) stored;
    alter table sm_outages add column if not exists title text;
    alter table sm_outages add column if not exists outage_type text;
    alter table sm_outages add column if not exists service_id uuid;
    alter table sm_outages add column if not exists offering_id uuid;
    alter table sm_outages add column if not exists ci_id uuid;
    alter table sm_outages add column if not exists owner_id uuid;
    alter table sm_outages add column if not exists assignment_group_id uuid;
    alter table sm_outages add column if not exists begin_at timestamptz;
    alter table sm_outages add column if not exists end_at timestamptz;
    alter table sm_outages add column if not exists duration bigint;
    alter table sm_outages add column if not exists impact_pct numeric;
    alter table sm_outages add column if not exists affected_users integer;
    alter table sm_outages add column if not exists customer_minutes integer;
    alter table sm_outages add column if not exists excluded boolean not null default false;
    alter table sm_outages add column if not exists cause text;
    alter table sm_outages add column if not exists cause_detail text;
    alter table sm_outages add column if not exists incident_id uuid;
    alter table sm_outages add column if not exists change_id uuid;
    alter table sm_outages add column if not exists alert_id uuid;
    alter table sm_outages add column if not exists problem_id uuid;
    alter table sm_outages add column if not exists proposed_by text;
    alter table sm_outages add column if not exists description text;
    alter table sm_outages add column if not exists watch_list jsonb;
    alter table sm_outages add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_outages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'OUT' || no::text else 'OUT' || lpad(no::text, 6, '0') end) stored,
  title text,
  outage_type text,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  owner_id uuid,
  assignment_group_id uuid,
  begin_at timestamptz,
  end_at timestamptz,
  duration bigint,
  impact_pct numeric,
  affected_users integer,
  customer_minutes integer,
  excluded boolean not null default false,
  cause text,
  cause_detail text,
  incident_id uuid,
  change_id uuid,
  alert_id uuid,
  problem_id uuid,
  proposed_by text,
  description text,
  watch_list jsonb,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_outages' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_outages', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_outages', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_outages' and indexname like 'sm\_outages\_search\_%' and indexname not in ('sm_outages_search_cae18f1d_trgm', 'sm_outages_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_outages_search_cae18f1d_trgm', 'sm_outages', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_outages_search_custom_trgm', 'sm_outages', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_outages_no_uk on sm_outages (org_id, no);
create index if not exists sm_outages_rev_idx on sm_outages (org_id, rev);
create index if not exists sm_outages_upd_idx on sm_outages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_outages_crt_idx on sm_outages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_outages_service_id_idx on sm_outages (org_id, service_id) where deleted_at is null;
create index if not exists sm_outages_begin_at_idx on sm_outages (org_id, begin_at) where deleted_at is null;
create index if not exists sm_outages_incident_id_idx on sm_outages (org_id, incident_id) where deleted_at is null;
create index if not exists sm_outages_state_idx on sm_outages (org_id, state) where deleted_at is null;
create index if not exists sm_outages_workspace_acc_idx on sm_outages (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_outages_unit_acc_idx on sm_outages (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_outages_domain_acc_idx on sm_outages (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_outages_owner_id_idx on sm_outages (org_id, owner_id) where deleted_at is null;
create index if not exists sm_outages_watch_list_gin on sm_outages using gin (watch_list);
drop trigger if exists sm_outages_sync on sm_outages;
create trigger sm_outages_sync before insert or update on sm_outages for each row execute function sm_sync_touch('outage');
create or replace trigger sm_outages_demo after insert on sm_outages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_outages_demo_t after update or delete on sm_outages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_outages enable row level security;

-- page: فراخوان‌ها
do $cols$
begin
  if to_regclass('sm_pages') is not null then
    alter table sm_pages add column if not exists workspace_id uuid;
    alter table sm_pages add column if not exists domain_id uuid;
    alter table sm_pages add column if not exists unit_id uuid;
    alter table sm_pages add column if not exists created_at timestamptz not null default now();
    alter table sm_pages add column if not exists created_by uuid;
    alter table sm_pages add column if not exists updated_at timestamptz not null default now();
    alter table sm_pages add column if not exists updated_by uuid;
    alter table sm_pages add column if not exists rev bigint not null default 0;
    alter table sm_pages add column if not exists version integer not null default 1;
    alter table sm_pages add column if not exists deleted_at timestamptz;
    alter table sm_pages add column if not exists origin text;
    alter table sm_pages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_pages add column if not exists no integer;
    alter table sm_pages add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PG' || no::text else 'PG' || lpad(no::text, 7, '0') end) stored;
    alter table sm_pages add column if not exists summary text;
    alter table sm_pages add column if not exists alert_id uuid;
    alter table sm_pages add column if not exists user_id uuid;
    alter table sm_pages add column if not exists policy_id uuid;
    alter table sm_pages add column if not exists level integer;
    alter table sm_pages add column if not exists round integer;
    alter table sm_pages add column if not exists channels jsonb;
    alter table sm_pages add column if not exists sent_at timestamptz;
    alter table sm_pages add column if not exists acknowledged_at timestamptz;
    alter table sm_pages add column if not exists ack_via text;
    alter table sm_pages add column if not exists expires_at timestamptz;
    alter table sm_pages add column if not exists failure_reason text;
    alter table sm_pages add column if not exists ack_token_hash text;
    alter table sm_pages add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_pages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PG' || no::text else 'PG' || lpad(no::text, 7, '0') end) stored,
  summary text,
  alert_id uuid,
  user_id uuid,
  policy_id uuid,
  level integer,
  round integer,
  channels jsonb,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  ack_via text,
  expires_at timestamptz,
  failure_reason text,
  ack_token_hash text,
  state text,
  search_6ba6e1c7 text generated always as (translate(coalesce(summary, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_pages' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_6ba6e1c7' loop
    execute format('alter table %I drop column if exists %I', 'sm_pages', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_pages', 'search_6ba6e1c7', $x$translate(coalesce(summary, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_pages' and indexname like 'sm\_pages\_search\_%' and indexname not in ('sm_pages_search_6ba6e1c7_trgm', 'sm_pages_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_pages_search_6ba6e1c7_trgm', 'sm_pages', 'search_6ba6e1c7', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_pages_search_custom_trgm', 'sm_pages', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_pages_no_uk on sm_pages (org_id, no);
create index if not exists sm_pages_rev_idx on sm_pages (org_id, rev);
create index if not exists sm_pages_upd_idx on sm_pages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_pages_crt_idx on sm_pages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_pages_alert_id_idx on sm_pages (org_id, alert_id) where deleted_at is null;
create index if not exists sm_pages_user_id_idx on sm_pages (org_id, user_id) where deleted_at is null;
create index if not exists sm_pages_ack_token_hash_idx on sm_pages (org_id, ack_token_hash) where deleted_at is null;
create index if not exists sm_pages_state_idx on sm_pages (org_id, state) where deleted_at is null;
drop trigger if exists sm_pages_sync on sm_pages;
create trigger sm_pages_sync before insert or update on sm_pages for each row execute function sm_sync_touch('page');
create or replace trigger sm_pages_demo after insert on sm_pages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_pages_demo_t after update or delete on sm_pages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_pages enable row level security;

-- parts_requirement: قطعه‌های لازم
do $cols$
begin
  if to_regclass('sm_parts_requirements') is not null then
    alter table sm_parts_requirements add column if not exists workspace_id uuid;
    alter table sm_parts_requirements add column if not exists domain_id uuid;
    alter table sm_parts_requirements add column if not exists unit_id uuid;
    alter table sm_parts_requirements add column if not exists created_at timestamptz not null default now();
    alter table sm_parts_requirements add column if not exists created_by uuid;
    alter table sm_parts_requirements add column if not exists updated_at timestamptz not null default now();
    alter table sm_parts_requirements add column if not exists updated_by uuid;
    alter table sm_parts_requirements add column if not exists rev bigint not null default 0;
    alter table sm_parts_requirements add column if not exists version integer not null default 1;
    alter table sm_parts_requirements add column if not exists deleted_at timestamptz;
    alter table sm_parts_requirements add column if not exists origin text;
    alter table sm_parts_requirements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_parts_requirements add column if not exists part_name text;
    alter table sm_parts_requirements add column if not exists part_code text;
    alter table sm_parts_requirements add column if not exists quantity numeric;
    alter table sm_parts_requirements add column if not exists wo_task_id uuid;
    alter table sm_parts_requirements add column if not exists work_order_id uuid;
    alter table sm_parts_requirements add column if not exists stockroom text;
    alter table sm_parts_requirements add column if not exists serial_no text;
    alter table sm_parts_requirements add column if not exists defective_returned boolean not null default false;
    alter table sm_parts_requirements add column if not exists rma_no text;
    alter table sm_parts_requirements add column if not exists technician_id uuid;
    alter table sm_parts_requirements add column if not exists assignment_group_id uuid;
    alter table sm_parts_requirements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_parts_requirements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  part_name text,
  part_code text,
  quantity numeric,
  wo_task_id uuid,
  work_order_id uuid,
  stockroom text,
  serial_no text,
  defective_returned boolean not null default false,
  rma_no text,
  technician_id uuid,
  assignment_group_id uuid,
  state text
);
create index if not exists sm_parts_requirements_rev_idx on sm_parts_requirements (org_id, rev);
create index if not exists sm_parts_requirements_upd_idx on sm_parts_requirements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_parts_requirements_crt_idx on sm_parts_requirements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_parts_requirements_wo_task_id_idx on sm_parts_requirements (org_id, wo_task_id) where deleted_at is null;
create index if not exists sm_parts_requirements_work_order_id_idx on sm_parts_requirements (org_id, work_order_id) where deleted_at is null;
create index if not exists sm_parts_requirements_technician_id_idx on sm_parts_requirements (org_id, technician_id) where deleted_at is null;
create index if not exists sm_parts_requirements_assignment_group_id_idx on sm_parts_requirements (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_parts_requirements_state_idx on sm_parts_requirements (org_id, state) where deleted_at is null;
create index if not exists sm_parts_requirements_workspace_acc_idx on sm_parts_requirements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_parts_requirements_unit_acc_idx on sm_parts_requirements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_parts_requirements_domain_acc_idx on sm_parts_requirements (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_parts_requirements_sync on sm_parts_requirements;
create trigger sm_parts_requirements_sync before insert or update on sm_parts_requirements for each row execute function sm_sync_touch('parts_requirement');
create or replace trigger sm_parts_requirements_demo after insert on sm_parts_requirements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_parts_requirements_demo_t after update or delete on sm_parts_requirements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_parts_requirements enable row level security;

-- plan_step: گام‌های بازیابی
do $cols$
begin
  if to_regclass('sm_plan_steps') is not null then
    alter table sm_plan_steps add column if not exists workspace_id uuid;
    alter table sm_plan_steps add column if not exists domain_id uuid;
    alter table sm_plan_steps add column if not exists unit_id uuid;
    alter table sm_plan_steps add column if not exists created_at timestamptz not null default now();
    alter table sm_plan_steps add column if not exists created_by uuid;
    alter table sm_plan_steps add column if not exists updated_at timestamptz not null default now();
    alter table sm_plan_steps add column if not exists updated_by uuid;
    alter table sm_plan_steps add column if not exists rev bigint not null default 0;
    alter table sm_plan_steps add column if not exists version integer not null default 1;
    alter table sm_plan_steps add column if not exists deleted_at timestamptz;
    alter table sm_plan_steps add column if not exists origin text;
    alter table sm_plan_steps add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_plan_steps add column if not exists plan_id uuid;
    alter table sm_plan_steps add column if not exists seq integer;
    alter table sm_plan_steps add column if not exists rto_offset_minutes integer;
    alter table sm_plan_steps add column if not exists title text;
    alter table sm_plan_steps add column if not exists role text;
    alter table sm_plan_steps add column if not exists owner_id uuid;
    alter table sm_plan_steps add column if not exists action text;
  end if;
end
$cols$;
create table if not exists sm_plan_steps (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  plan_id uuid,
  seq integer,
  rto_offset_minutes integer,
  title text,
  role text,
  owner_id uuid,
  action text
);
create index if not exists sm_plan_steps_rev_idx on sm_plan_steps (org_id, rev);
create index if not exists sm_plan_steps_upd_idx on sm_plan_steps (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_plan_steps_crt_idx on sm_plan_steps (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_plan_steps_plan_id_idx on sm_plan_steps (org_id, plan_id) where deleted_at is null;
create index if not exists sm_plan_steps_workspace_acc_idx on sm_plan_steps (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_plan_steps_unit_acc_idx on sm_plan_steps (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_plan_steps_domain_acc_idx on sm_plan_steps (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_plan_steps_owner_id_idx on sm_plan_steps (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_plan_steps_sync on sm_plan_steps;
create trigger sm_plan_steps_sync before insert or update on sm_plan_steps for each row execute function sm_sync_touch('plan_step');
create or replace trigger sm_plan_steps_demo after insert on sm_plan_steps for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_plan_steps_demo_t after update or delete on sm_plan_steps for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_plan_steps enable row level security;

-- portal: درگاه‌ها
do $cols$
begin
  if to_regclass('sm_portals') is not null then
    alter table sm_portals add column if not exists workspace_id uuid;
    alter table sm_portals add column if not exists domain_id uuid;
    alter table sm_portals add column if not exists unit_id uuid;
    alter table sm_portals add column if not exists created_at timestamptz not null default now();
    alter table sm_portals add column if not exists created_by uuid;
    alter table sm_portals add column if not exists updated_at timestamptz not null default now();
    alter table sm_portals add column if not exists updated_by uuid;
    alter table sm_portals add column if not exists rev bigint not null default 0;
    alter table sm_portals add column if not exists version integer not null default 1;
    alter table sm_portals add column if not exists deleted_at timestamptz;
    alter table sm_portals add column if not exists origin text;
    alter table sm_portals add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portals add column if not exists name text;
    alter table sm_portals add column if not exists active boolean not null default true;
    alter table sm_portals add column if not exists sort_order integer;
    alter table sm_portals add column if not exists title text;
    alter table sm_portals add column if not exists subtitle text;
    alter table sm_portals add column if not exists brand_name text;
    alter table sm_portals add column if not exists accent text;
    alter table sm_portals add column if not exists hero text;
    alter table sm_portals add column if not exists logo_id text;
    alter table sm_portals add column if not exists footer text;
    alter table sm_portals add column if not exists privacy_notice text;
    alter table sm_portals add column if not exists chat_enabled boolean not null default true;
    alter table sm_portals add column if not exists chat_name text;
    alter table sm_portals add column if not exists ai_answers boolean not null default true;
    alter table sm_portals add column if not exists report_item_id uuid;
    alter table sm_portals add column if not exists layout jsonb;
    alter table sm_portals add column if not exists published_layout jsonb;
    alter table sm_portals add column if not exists layout_version integer;
    alter table sm_portals add column if not exists published_at timestamptz;
    alter table sm_portals add column if not exists published_by uuid;
    alter table sm_portals add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_portals (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  sort_order integer,
  title text,
  subtitle text,
  brand_name text,
  accent text,
  hero text,
  logo_id text,
  footer text,
  privacy_notice text,
  chat_enabled boolean not null default true,
  chat_name text,
  ai_answers boolean not null default true,
  report_item_id uuid,
  layout jsonb,
  published_layout jsonb,
  layout_version integer,
  published_at timestamptz,
  published_by uuid,
  seeded integer
);
create index if not exists sm_portals_rev_idx on sm_portals (org_id, rev);
create index if not exists sm_portals_upd_idx on sm_portals (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portals_crt_idx on sm_portals (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_portals_sync on sm_portals;
create trigger sm_portals_sync before insert or update on sm_portals for each row execute function sm_sync_touch('portal');
create or replace trigger sm_portals_demo after insert on sm_portals for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portals_demo_t after update or delete on sm_portals for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portals enable row level security;

-- portal_channel: کانال‌های پیام‌رسان
do $cols$
begin
  if to_regclass('sm_portal_channels') is not null then
    alter table sm_portal_channels add column if not exists workspace_id uuid;
    alter table sm_portal_channels add column if not exists domain_id uuid;
    alter table sm_portal_channels add column if not exists unit_id uuid;
    alter table sm_portal_channels add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_channels add column if not exists created_by uuid;
    alter table sm_portal_channels add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_channels add column if not exists updated_by uuid;
    alter table sm_portal_channels add column if not exists rev bigint not null default 0;
    alter table sm_portal_channels add column if not exists version integer not null default 1;
    alter table sm_portal_channels add column if not exists deleted_at timestamptz;
    alter table sm_portal_channels add column if not exists origin text;
    alter table sm_portal_channels add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_channels add column if not exists name text;
    alter table sm_portal_channels add column if not exists kind text;
    alter table sm_portal_channels add column if not exists active boolean not null default true;
    alter table sm_portal_channels add column if not exists bot_username text;
    alter table sm_portal_channels add column if not exists welcome text;
    alter table sm_portal_channels add column if not exists allow_groups boolean not null default false;
    alter table sm_portal_channels add column if not exists rate_per_minute integer;
    alter table sm_portal_channels add column if not exists token text;
    alter table sm_portal_channels add column if not exists outbound_url text;
    alter table sm_portal_channels add column if not exists auth_mode text;
    alter table sm_portal_channels add column if not exists secret text;
    alter table sm_portal_channels add column if not exists hook_key text;
    alter table sm_portal_channels add column if not exists registered_at timestamptz;
    alter table sm_portal_channels add column if not exists last_in_at timestamptz;
    alter table sm_portal_channels add column if not exists received_count integer;
    alter table sm_portal_channels add column if not exists failed_count integer;
    alter table sm_portal_channels add column if not exists last_error text;
  end if;
end
$cols$;
create table if not exists sm_portal_channels (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  active boolean not null default true,
  bot_username text,
  welcome text,
  allow_groups boolean not null default false,
  rate_per_minute integer,
  token text,
  outbound_url text,
  auth_mode text,
  secret text,
  hook_key text,
  registered_at timestamptz,
  last_in_at timestamptz,
  received_count integer,
  failed_count integer,
  last_error text
);
create index if not exists sm_portal_channels_rev_idx on sm_portal_channels (org_id, rev);
create index if not exists sm_portal_channels_upd_idx on sm_portal_channels (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channels_crt_idx on sm_portal_channels (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channels_hook_key_idx on sm_portal_channels (org_id, hook_key) where deleted_at is null;
drop trigger if exists sm_portal_channels_sync on sm_portal_channels;
create or replace trigger sm_portal_channels_demo after insert on sm_portal_channels for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_channels_demo_t after update or delete on sm_portal_channels for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_channels enable row level security;

-- portal_channel_identity: حساب‌های پیام‌رسان
do $cols$
begin
  if to_regclass('sm_portal_channel_identities') is not null then
    alter table sm_portal_channel_identities add column if not exists workspace_id uuid;
    alter table sm_portal_channel_identities add column if not exists domain_id uuid;
    alter table sm_portal_channel_identities add column if not exists unit_id uuid;
    alter table sm_portal_channel_identities add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_channel_identities add column if not exists created_by uuid;
    alter table sm_portal_channel_identities add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_channel_identities add column if not exists updated_by uuid;
    alter table sm_portal_channel_identities add column if not exists rev bigint not null default 0;
    alter table sm_portal_channel_identities add column if not exists version integer not null default 1;
    alter table sm_portal_channel_identities add column if not exists deleted_at timestamptz;
    alter table sm_portal_channel_identities add column if not exists origin text;
    alter table sm_portal_channel_identities add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_channel_identities add column if not exists channel_id uuid;
    alter table sm_portal_channel_identities add column if not exists user_id uuid;
    alter table sm_portal_channel_identities add column if not exists external_id text;
    alter table sm_portal_channel_identities add column if not exists external_name text;
    alter table sm_portal_channel_identities add column if not exists linked_at timestamptz;
    alter table sm_portal_channel_identities add column if not exists conversation_id text;
    alter table sm_portal_channel_identities add column if not exists options jsonb;
    alter table sm_portal_channel_identities add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_portal_channel_identities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  channel_id uuid,
  user_id uuid,
  external_id text,
  external_name text,
  linked_at timestamptz,
  conversation_id text,
  options jsonb,
  active boolean not null default true
);
create index if not exists sm_portal_channel_identities_rev_idx on sm_portal_channel_identities (org_id, rev);
create index if not exists sm_portal_channel_identities_upd_idx on sm_portal_channel_identities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channel_identities_crt_idx on sm_portal_channel_identities (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_channel_identities_channel_id_idx on sm_portal_channel_identities (org_id, channel_id) where deleted_at is null;
create index if not exists sm_portal_channel_identities_user_id_idx on sm_portal_channel_identities (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_channel_identities_external_id_idx on sm_portal_channel_identities (org_id, external_id) where deleted_at is null;
create index if not exists sm_portal_channel_identities_workspace_acc_idx on sm_portal_channel_identities (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_channel_identities_unit_acc_idx on sm_portal_channel_identities (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_channel_identities_domain_acc_idx on sm_portal_channel_identities (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_portal_channel_identities_sync on sm_portal_channel_identities;
create or replace trigger sm_portal_channel_identities_demo after insert on sm_portal_channel_identities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_channel_identities_demo_t after update or delete on sm_portal_channel_identities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_channel_identities enable row level security;

-- portal_feedback: بازخوردها
do $cols$
begin
  if to_regclass('sm_portal_feedback') is not null then
    alter table sm_portal_feedback add column if not exists workspace_id uuid;
    alter table sm_portal_feedback add column if not exists domain_id uuid;
    alter table sm_portal_feedback add column if not exists unit_id uuid;
    alter table sm_portal_feedback add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_feedback add column if not exists created_by uuid;
    alter table sm_portal_feedback add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_feedback add column if not exists updated_by uuid;
    alter table sm_portal_feedback add column if not exists rev bigint not null default 0;
    alter table sm_portal_feedback add column if not exists version integer not null default 1;
    alter table sm_portal_feedback add column if not exists deleted_at timestamptz;
    alter table sm_portal_feedback add column if not exists origin text;
    alter table sm_portal_feedback add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_feedback add column if not exists no integer;
    alter table sm_portal_feedback add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'FBK' || no::text else 'FBK' || lpad(no::text, 6, '0') end) stored;
    alter table sm_portal_feedback add column if not exists short_description text;
    alter table sm_portal_feedback add column if not exists description text;
    alter table sm_portal_feedback add column if not exists state text;
    alter table sm_portal_feedback add column if not exists priority text;
    alter table sm_portal_feedback add column if not exists impact text;
    alter table sm_portal_feedback add column if not exists urgency text;
    alter table sm_portal_feedback add column if not exists category text;
    alter table sm_portal_feedback add column if not exists subcategory text;
    alter table sm_portal_feedback add column if not exists channel text;
    alter table sm_portal_feedback add column if not exists caller_id uuid;
    alter table sm_portal_feedback add column if not exists requested_for uuid;
    alter table sm_portal_feedback add column if not exists opened_by uuid;
    alter table sm_portal_feedback add column if not exists opened_at timestamptz;
    alter table sm_portal_feedback add column if not exists assignment_group_id uuid;
    alter table sm_portal_feedback add column if not exists assigned_to uuid;
    alter table sm_portal_feedback add column if not exists service_id uuid;
    alter table sm_portal_feedback add column if not exists offering_id uuid;
    alter table sm_portal_feedback add column if not exists ci_id uuid;
    alter table sm_portal_feedback add column if not exists location_id uuid;
    alter table sm_portal_feedback add column if not exists due_at timestamptz;
    alter table sm_portal_feedback add column if not exists resolved_at timestamptz;
    alter table sm_portal_feedback add column if not exists resolved_by uuid;
    alter table sm_portal_feedback add column if not exists closed_at timestamptz;
    alter table sm_portal_feedback add column if not exists closed_by uuid;
    alter table sm_portal_feedback add column if not exists close_code text;
    alter table sm_portal_feedback add column if not exists close_notes text;
    alter table sm_portal_feedback add column if not exists parent_id uuid;
    alter table sm_portal_feedback add column if not exists watch_list jsonb;
    alter table sm_portal_feedback add column if not exists approval text;
    alter table sm_portal_feedback add column if not exists escalation integer;
    alter table sm_portal_feedback add column if not exists reassignment_count integer;
    alter table sm_portal_feedback add column if not exists reopen_count integer;
    alter table sm_portal_feedback add column if not exists time_worked bigint;
    alter table sm_portal_feedback add column if not exists first_response_at timestamptz;
    alter table sm_portal_feedback add column if not exists active boolean not null default true;
    alter table sm_portal_feedback add column if not exists sla_due timestamptz;
    alter table sm_portal_feedback add column if not exists knowledge boolean not null default false;
    alter table sm_portal_feedback add column if not exists kind text;
    alter table sm_portal_feedback add column if not exists privacy_right text;
    alter table sm_portal_feedback add column if not exists response text;
    alter table sm_portal_feedback add column if not exists acknowledged_at timestamptz;
    alter table sm_portal_feedback add column if not exists responded_at timestamptz;
    alter table sm_portal_feedback add column if not exists confidential boolean not null default false;
    alter table sm_portal_feedback add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_portal_feedback (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'FBK' || no::text else 'FBK' || lpad(no::text, 6, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  kind text,
  privacy_right text,
  response text,
  acknowledged_at timestamptz,
  responded_at timestamptz,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_portal_feedback' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_portal_feedback', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_portal_feedback', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_portal_feedback' and indexname like 'sm\_portal\_feedback\_search\_%' and indexname not in ('sm_portal_feedback_search_f3bce210_trgm', 'sm_portal_feedback_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_portal_feedback_search_f3bce210_trgm', 'sm_portal_feedback', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_portal_feedback_search_custom_trgm', 'sm_portal_feedback', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_portal_feedback_no_uk on sm_portal_feedback (org_id, no);
create index if not exists sm_portal_feedback_rev_idx on sm_portal_feedback (org_id, rev);
create index if not exists sm_portal_feedback_upd_idx on sm_portal_feedback (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_feedback_crt_idx on sm_portal_feedback (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_feedback_state_idx on sm_portal_feedback (org_id, state) where deleted_at is null;
create index if not exists sm_portal_feedback_assignment_group_id_idx on sm_portal_feedback (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_portal_feedback_assigned_to_idx on sm_portal_feedback (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_portal_feedback_workspace_acc_idx on sm_portal_feedback (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_feedback_unit_acc_idx on sm_portal_feedback (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_feedback_domain_acc_idx on sm_portal_feedback (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_portal_feedback_caller_id_idx on sm_portal_feedback (org_id, caller_id) where deleted_at is null;
create index if not exists sm_portal_feedback_requested_for_idx on sm_portal_feedback (org_id, requested_for) where deleted_at is null;
create index if not exists sm_portal_feedback_opened_by_idx on sm_portal_feedback (org_id, opened_by) where deleted_at is null;
create index if not exists sm_portal_feedback_watch_list_gin on sm_portal_feedback using gin (watch_list);
create index if not exists sm_portal_feedback_open_grp_idx on sm_portal_feedback (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_portal_feedback_opened_brin on sm_portal_feedback using brin (opened_at);
drop trigger if exists sm_portal_feedback_sync on sm_portal_feedback;
create trigger sm_portal_feedback_sync before insert or update on sm_portal_feedback for each row execute function sm_sync_touch('portal_feedback');
create or replace trigger sm_portal_feedback_demo after insert on sm_portal_feedback for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_feedback_demo_t after update or delete on sm_portal_feedback for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_feedback enable row level security;

-- portal_kb_publication: انتشارهای عمومی دانش
do $cols$
begin
  if to_regclass('sm_portal_kb_publications') is not null then
    alter table sm_portal_kb_publications add column if not exists workspace_id uuid;
    alter table sm_portal_kb_publications add column if not exists domain_id uuid;
    alter table sm_portal_kb_publications add column if not exists unit_id uuid;
    alter table sm_portal_kb_publications add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_kb_publications add column if not exists created_by uuid;
    alter table sm_portal_kb_publications add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_kb_publications add column if not exists updated_by uuid;
    alter table sm_portal_kb_publications add column if not exists rev bigint not null default 0;
    alter table sm_portal_kb_publications add column if not exists version integer not null default 1;
    alter table sm_portal_kb_publications add column if not exists deleted_at timestamptz;
    alter table sm_portal_kb_publications add column if not exists origin text;
    alter table sm_portal_kb_publications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_kb_publications add column if not exists name text;
    alter table sm_portal_kb_publications add column if not exists active boolean not null default false;
    alter table sm_portal_kb_publications add column if not exists allow_feedback boolean not null default true;
    alter table sm_portal_kb_publications add column if not exists bases jsonb;
    alter table sm_portal_kb_publications add column if not exists title text;
    alter table sm_portal_kb_publications add column if not exists intro text;
    alter table sm_portal_kb_publications add column if not exists token text;
    alter table sm_portal_kb_publications add column if not exists published_at timestamptz;
    alter table sm_portal_kb_publications add column if not exists published_by uuid;
  end if;
end
$cols$;
create table if not exists sm_portal_kb_publications (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default false,
  allow_feedback boolean not null default true,
  bases jsonb,
  title text,
  intro text,
  token text,
  published_at timestamptz,
  published_by uuid
);
create index if not exists sm_portal_kb_publications_rev_idx on sm_portal_kb_publications (org_id, rev);
create index if not exists sm_portal_kb_publications_upd_idx on sm_portal_kb_publications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_kb_publications_crt_idx on sm_portal_kb_publications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_kb_publications_token_idx on sm_portal_kb_publications (org_id, token) where deleted_at is null;
drop trigger if exists sm_portal_kb_publications_sync on sm_portal_kb_publications;
create trigger sm_portal_kb_publications_sync before insert or update on sm_portal_kb_publications for each row execute function sm_sync_touch('portal_kb_publication');
create or replace trigger sm_portal_kb_publications_demo after insert on sm_portal_kb_publications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_kb_publications_demo_t after update or delete on sm_portal_kb_publications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_kb_publications enable row level security;

-- portal_link: پیوندهای سریع
do $cols$
begin
  if to_regclass('sm_portal_links') is not null then
    alter table sm_portal_links add column if not exists workspace_id uuid;
    alter table sm_portal_links add column if not exists domain_id uuid;
    alter table sm_portal_links add column if not exists unit_id uuid;
    alter table sm_portal_links add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_links add column if not exists created_by uuid;
    alter table sm_portal_links add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_links add column if not exists updated_by uuid;
    alter table sm_portal_links add column if not exists rev bigint not null default 0;
    alter table sm_portal_links add column if not exists version integer not null default 1;
    alter table sm_portal_links add column if not exists deleted_at timestamptz;
    alter table sm_portal_links add column if not exists origin text;
    alter table sm_portal_links add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_links add column if not exists name text;
    alter table sm_portal_links add column if not exists url text;
    alter table sm_portal_links add column if not exists description text;
    alter table sm_portal_links add column if not exists icon text;
    alter table sm_portal_links add column if not exists section_name text;
    alter table sm_portal_links add column if not exists sort_order integer;
    alter table sm_portal_links add column if not exists new_tab boolean not null default true;
    alter table sm_portal_links add column if not exists active boolean not null default true;
    alter table sm_portal_links add column if not exists aud_units jsonb;
    alter table sm_portal_links add column if not exists aud_groups jsonb;
    alter table sm_portal_links add column if not exists aud_locations jsonb;
    alter table sm_portal_links add column if not exists aud_users jsonb;
  end if;
end
$cols$;
create table if not exists sm_portal_links (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  url text,
  description text,
  icon text,
  section_name text,
  sort_order integer,
  new_tab boolean not null default true,
  active boolean not null default true,
  aud_units jsonb,
  aud_groups jsonb,
  aud_locations jsonb,
  aud_users jsonb
);
create index if not exists sm_portal_links_rev_idx on sm_portal_links (org_id, rev);
create index if not exists sm_portal_links_upd_idx on sm_portal_links (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_links_crt_idx on sm_portal_links (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_portal_links_sync on sm_portal_links;
create trigger sm_portal_links_sync before insert or update on sm_portal_links for each row execute function sm_sync_touch('portal_link');
create or replace trigger sm_portal_links_demo after insert on sm_portal_links for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_links_demo_t after update or delete on sm_portal_links for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_links enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:17', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۱۹ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 19/30 (a0c3bc7de847)
-- portal_link_code: کدهای اتصال پیام‌رسان
do $cols$
begin
  if to_regclass('sm_portal_link_codes') is not null then
    alter table sm_portal_link_codes add column if not exists workspace_id uuid;
    alter table sm_portal_link_codes add column if not exists domain_id uuid;
    alter table sm_portal_link_codes add column if not exists unit_id uuid;
    alter table sm_portal_link_codes add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_link_codes add column if not exists created_by uuid;
    alter table sm_portal_link_codes add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_link_codes add column if not exists updated_by uuid;
    alter table sm_portal_link_codes add column if not exists rev bigint not null default 0;
    alter table sm_portal_link_codes add column if not exists version integer not null default 1;
    alter table sm_portal_link_codes add column if not exists deleted_at timestamptz;
    alter table sm_portal_link_codes add column if not exists origin text;
    alter table sm_portal_link_codes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_link_codes add column if not exists user_id uuid;
    alter table sm_portal_link_codes add column if not exists code_hash text;
    alter table sm_portal_link_codes add column if not exists expires_at timestamptz;
    alter table sm_portal_link_codes add column if not exists used_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_portal_link_codes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  code_hash text,
  expires_at timestamptz,
  used_at timestamptz
);
create index if not exists sm_portal_link_codes_rev_idx on sm_portal_link_codes (org_id, rev);
create index if not exists sm_portal_link_codes_upd_idx on sm_portal_link_codes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_link_codes_crt_idx on sm_portal_link_codes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_link_codes_user_id_idx on sm_portal_link_codes (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_link_codes_code_hash_idx on sm_portal_link_codes (org_id, code_hash) where deleted_at is null;
create index if not exists sm_portal_link_codes_workspace_acc_idx on sm_portal_link_codes (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_link_codes_unit_acc_idx on sm_portal_link_codes (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_link_codes_domain_acc_idx on sm_portal_link_codes (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_portal_link_codes_sync on sm_portal_link_codes;
create or replace trigger sm_portal_link_codes_demo after insert on sm_portal_link_codes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_link_codes_demo_t after update or delete on sm_portal_link_codes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_link_codes enable row level security;

-- portal_pref: ترجیح‌های درگاه
do $cols$
begin
  if to_regclass('sm_portal_prefs') is not null then
    alter table sm_portal_prefs add column if not exists workspace_id uuid;
    alter table sm_portal_prefs add column if not exists domain_id uuid;
    alter table sm_portal_prefs add column if not exists unit_id uuid;
    alter table sm_portal_prefs add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_prefs add column if not exists created_by uuid;
    alter table sm_portal_prefs add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_prefs add column if not exists updated_by uuid;
    alter table sm_portal_prefs add column if not exists rev bigint not null default 0;
    alter table sm_portal_prefs add column if not exists version integer not null default 1;
    alter table sm_portal_prefs add column if not exists deleted_at timestamptz;
    alter table sm_portal_prefs add column if not exists origin text;
    alter table sm_portal_prefs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_prefs add column if not exists user_id uuid;
    alter table sm_portal_prefs add column if not exists favorites jsonb;
    alter table sm_portal_prefs add column if not exists portal_id uuid;
  end if;
end
$cols$;
create table if not exists sm_portal_prefs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  favorites jsonb,
  portal_id uuid
);
create index if not exists sm_portal_prefs_rev_idx on sm_portal_prefs (org_id, rev);
create index if not exists sm_portal_prefs_upd_idx on sm_portal_prefs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_prefs_crt_idx on sm_portal_prefs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_portal_prefs_user_id_uk on sm_portal_prefs (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_prefs_user_id_idx on sm_portal_prefs (org_id, user_id) where deleted_at is null;
create index if not exists sm_portal_prefs_workspace_acc_idx on sm_portal_prefs (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portal_prefs_unit_acc_idx on sm_portal_prefs (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portal_prefs_domain_acc_idx on sm_portal_prefs (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_portal_prefs_sync on sm_portal_prefs;
create trigger sm_portal_prefs_sync before insert or update on sm_portal_prefs for each row execute function sm_sync_touch('portal_pref');
create or replace trigger sm_portal_prefs_demo after insert on sm_portal_prefs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_prefs_demo_t after update or delete on sm_portal_prefs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_prefs enable row level security;

-- portal_topic: موضوع‌های درگاه
do $cols$
begin
  if to_regclass('sm_portal_topics') is not null then
    alter table sm_portal_topics add column if not exists workspace_id uuid;
    alter table sm_portal_topics add column if not exists domain_id uuid;
    alter table sm_portal_topics add column if not exists unit_id uuid;
    alter table sm_portal_topics add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_topics add column if not exists created_by uuid;
    alter table sm_portal_topics add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_topics add column if not exists updated_by uuid;
    alter table sm_portal_topics add column if not exists rev bigint not null default 0;
    alter table sm_portal_topics add column if not exists version integer not null default 1;
    alter table sm_portal_topics add column if not exists deleted_at timestamptz;
    alter table sm_portal_topics add column if not exists origin text;
    alter table sm_portal_topics add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_topics add column if not exists name text;
    alter table sm_portal_topics add column if not exists parent_id uuid;
    alter table sm_portal_topics add column if not exists description text;
    alter table sm_portal_topics add column if not exists icon text;
    alter table sm_portal_topics add column if not exists sort_order integer;
    alter table sm_portal_topics add column if not exists active boolean not null default true;
    alter table sm_portal_topics add column if not exists items jsonb;
    alter table sm_portal_topics add column if not exists articles jsonb;
    alter table sm_portal_topics add column if not exists links jsonb;
    alter table sm_portal_topics add column if not exists aud_units jsonb;
    alter table sm_portal_topics add column if not exists aud_groups jsonb;
    alter table sm_portal_topics add column if not exists aud_locations jsonb;
    alter table sm_portal_topics add column if not exists aud_users jsonb;
  end if;
end
$cols$;
create table if not exists sm_portal_topics (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  parent_id uuid,
  description text,
  icon text,
  sort_order integer,
  active boolean not null default true,
  items jsonb,
  articles jsonb,
  links jsonb,
  aud_units jsonb,
  aud_groups jsonb,
  aud_locations jsonb,
  aud_users jsonb
);
create index if not exists sm_portal_topics_rev_idx on sm_portal_topics (org_id, rev);
create index if not exists sm_portal_topics_upd_idx on sm_portal_topics (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_topics_crt_idx on sm_portal_topics (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_topics_parent_id_idx on sm_portal_topics (org_id, parent_id) where deleted_at is null;
drop trigger if exists sm_portal_topics_sync on sm_portal_topics;
create trigger sm_portal_topics_sync before insert or update on sm_portal_topics for each row execute function sm_sync_touch('portal_topic');
create or replace trigger sm_portal_topics_demo after insert on sm_portal_topics for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_topics_demo_t after update or delete on sm_portal_topics for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_topics enable row level security;

-- portal_widget: ابزارک‌های وب‌سایت
do $cols$
begin
  if to_regclass('sm_portal_widgets') is not null then
    alter table sm_portal_widgets add column if not exists workspace_id uuid;
    alter table sm_portal_widgets add column if not exists domain_id uuid;
    alter table sm_portal_widgets add column if not exists unit_id uuid;
    alter table sm_portal_widgets add column if not exists created_at timestamptz not null default now();
    alter table sm_portal_widgets add column if not exists created_by uuid;
    alter table sm_portal_widgets add column if not exists updated_at timestamptz not null default now();
    alter table sm_portal_widgets add column if not exists updated_by uuid;
    alter table sm_portal_widgets add column if not exists rev bigint not null default 0;
    alter table sm_portal_widgets add column if not exists version integer not null default 1;
    alter table sm_portal_widgets add column if not exists deleted_at timestamptz;
    alter table sm_portal_widgets add column if not exists origin text;
    alter table sm_portal_widgets add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portal_widgets add column if not exists name text;
    alter table sm_portal_widgets add column if not exists active boolean not null default true;
    alter table sm_portal_widgets add column if not exists accent text;
    alter table sm_portal_widgets add column if not exists title text;
    alter table sm_portal_widgets add column if not exists greeting text;
    alter table sm_portal_widgets add column if not exists allowed_origins jsonb;
    alter table sm_portal_widgets add column if not exists publication_id uuid;
    alter table sm_portal_widgets add column if not exists chat boolean not null default true;
    alter table sm_portal_widgets add column if not exists consent text;
    alter table sm_portal_widgets add column if not exists widget_key text;
  end if;
end
$cols$;
create table if not exists sm_portal_widgets (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  accent text,
  title text,
  greeting text,
  allowed_origins jsonb,
  publication_id uuid,
  chat boolean not null default true,
  consent text,
  widget_key text
);
create index if not exists sm_portal_widgets_rev_idx on sm_portal_widgets (org_id, rev);
create index if not exists sm_portal_widgets_upd_idx on sm_portal_widgets (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_widgets_crt_idx on sm_portal_widgets (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portal_widgets_widget_key_idx on sm_portal_widgets (org_id, widget_key) where deleted_at is null;
drop trigger if exists sm_portal_widgets_sync on sm_portal_widgets;
create or replace trigger sm_portal_widgets_demo after insert on sm_portal_widgets for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portal_widgets_demo_t after update or delete on sm_portal_widgets for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portal_widgets enable row level security;

-- portfolio: سبدهای پروژه
do $cols$
begin
  if to_regclass('sm_portfolios') is not null then
    alter table sm_portfolios add column if not exists workspace_id uuid;
    alter table sm_portfolios add column if not exists domain_id uuid;
    alter table sm_portfolios add column if not exists unit_id uuid;
    alter table sm_portfolios add column if not exists created_at timestamptz not null default now();
    alter table sm_portfolios add column if not exists created_by uuid;
    alter table sm_portfolios add column if not exists updated_at timestamptz not null default now();
    alter table sm_portfolios add column if not exists updated_by uuid;
    alter table sm_portfolios add column if not exists rev bigint not null default 0;
    alter table sm_portfolios add column if not exists version integer not null default 1;
    alter table sm_portfolios add column if not exists deleted_at timestamptz;
    alter table sm_portfolios add column if not exists origin text;
    alter table sm_portfolios add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portfolios add column if not exists no integer;
    alter table sm_portfolios add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 4 then 'PFL' || no::text else 'PFL' || lpad(no::text, 4, '0') end) stored;
    alter table sm_portfolios add column if not exists name text;
    alter table sm_portfolios add column if not exists code text;
    alter table sm_portfolios add column if not exists parent_id uuid;
    alter table sm_portfolios add column if not exists owner_id uuid;
    alter table sm_portfolios add column if not exists manager_id uuid;
    alter table sm_portfolios add column if not exists budget numeric;
    alter table sm_portfolios add column if not exists goals text;
    alter table sm_portfolios add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_portfolios (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 4 then 'PFL' || no::text else 'PFL' || lpad(no::text, 4, '0') end) stored,
  name text,
  code text,
  parent_id uuid,
  owner_id uuid,
  manager_id uuid,
  budget numeric,
  goals text,
  active boolean not null default true,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_portfolios' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_portfolios', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_portfolios', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_portfolios' and indexname like 'sm\_portfolios\_search\_%' and indexname not in ('sm_portfolios_search_56291d9d_trgm', 'sm_portfolios_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_portfolios_search_56291d9d_trgm', 'sm_portfolios', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_portfolios_search_custom_trgm', 'sm_portfolios', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_portfolios_no_uk on sm_portfolios (org_id, no);
create index if not exists sm_portfolios_rev_idx on sm_portfolios (org_id, rev);
create index if not exists sm_portfolios_upd_idx on sm_portfolios (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolios_crt_idx on sm_portfolios (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_portfolios_code_uk on sm_portfolios (org_id, code) where deleted_at is null;
create index if not exists sm_portfolios_workspace_acc_idx on sm_portfolios (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_portfolios_unit_acc_idx on sm_portfolios (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_portfolios_domain_acc_idx on sm_portfolios (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_portfolios_owner_id_idx on sm_portfolios (org_id, owner_id) where deleted_at is null;
create index if not exists sm_portfolios_manager_id_idx on sm_portfolios (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_portfolios_sync on sm_portfolios;
create trigger sm_portfolios_sync before insert or update on sm_portfolios for each row execute function sm_sync_touch('portfolio');
create or replace trigger sm_portfolios_demo after insert on sm_portfolios for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portfolios_demo_t after update or delete on sm_portfolios for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portfolios enable row level security;

-- portfolio_node: شاخه‌های سبد خدمات
do $cols$
begin
  if to_regclass('sm_portfolio_nodes') is not null then
    alter table sm_portfolio_nodes add column if not exists workspace_id uuid;
    alter table sm_portfolio_nodes add column if not exists domain_id uuid;
    alter table sm_portfolio_nodes add column if not exists unit_id uuid;
    alter table sm_portfolio_nodes add column if not exists created_at timestamptz not null default now();
    alter table sm_portfolio_nodes add column if not exists created_by uuid;
    alter table sm_portfolio_nodes add column if not exists updated_at timestamptz not null default now();
    alter table sm_portfolio_nodes add column if not exists updated_by uuid;
    alter table sm_portfolio_nodes add column if not exists rev bigint not null default 0;
    alter table sm_portfolio_nodes add column if not exists version integer not null default 1;
    alter table sm_portfolio_nodes add column if not exists deleted_at timestamptz;
    alter table sm_portfolio_nodes add column if not exists origin text;
    alter table sm_portfolio_nodes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_portfolio_nodes add column if not exists name text;
    alter table sm_portfolio_nodes add column if not exists parent_id uuid;
    alter table sm_portfolio_nodes add column if not exists kind text;
    alter table sm_portfolio_nodes add column if not exists owner_id uuid;
    alter table sm_portfolio_nodes add column if not exists sort_order integer;
    alter table sm_portfolio_nodes add column if not exists path text;
    alter table sm_portfolio_nodes add column if not exists depth integer;
    alter table sm_portfolio_nodes add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_portfolio_nodes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  parent_id uuid,
  kind text,
  owner_id uuid,
  sort_order integer,
  path text,
  depth integer,
  description text
);
create index if not exists sm_portfolio_nodes_rev_idx on sm_portfolio_nodes (org_id, rev);
create index if not exists sm_portfolio_nodes_upd_idx on sm_portfolio_nodes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolio_nodes_crt_idx on sm_portfolio_nodes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_portfolio_nodes_parent_id_idx on sm_portfolio_nodes (org_id, parent_id) where deleted_at is null;
create index if not exists sm_portfolio_nodes_path_idx on sm_portfolio_nodes (org_id, path) where deleted_at is null;
drop trigger if exists sm_portfolio_nodes_sync on sm_portfolio_nodes;
create trigger sm_portfolio_nodes_sync before insert or update on sm_portfolio_nodes for each row execute function sm_sync_touch('portfolio_node');
create or replace trigger sm_portfolio_nodes_demo after insert on sm_portfolio_nodes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_portfolio_nodes_demo_t after update or delete on sm_portfolio_nodes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_portfolio_nodes enable row level security;

-- priority_matrix: ماتریس‌های اولویت
do $cols$
begin
  if to_regclass('sm_priority_matrices') is not null then
    alter table sm_priority_matrices add column if not exists workspace_id uuid;
    alter table sm_priority_matrices add column if not exists domain_id uuid;
    alter table sm_priority_matrices add column if not exists unit_id uuid;
    alter table sm_priority_matrices add column if not exists created_at timestamptz not null default now();
    alter table sm_priority_matrices add column if not exists created_by uuid;
    alter table sm_priority_matrices add column if not exists updated_at timestamptz not null default now();
    alter table sm_priority_matrices add column if not exists updated_by uuid;
    alter table sm_priority_matrices add column if not exists rev bigint not null default 0;
    alter table sm_priority_matrices add column if not exists version integer not null default 1;
    alter table sm_priority_matrices add column if not exists deleted_at timestamptz;
    alter table sm_priority_matrices add column if not exists origin text;
    alter table sm_priority_matrices add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_priority_matrices add column if not exists name text;
    alter table sm_priority_matrices add column if not exists table_key text;
    alter table sm_priority_matrices add column if not exists impact_field text;
    alter table sm_priority_matrices add column if not exists urgency_field text;
    alter table sm_priority_matrices add column if not exists priority_field text;
    alter table sm_priority_matrices add column if not exists cells jsonb;
    alter table sm_priority_matrices add column if not exists active boolean not null default true;
    alter table sm_priority_matrices add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_priority_matrices (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  table_key text,
  impact_field text,
  urgency_field text,
  priority_field text,
  cells jsonb,
  active boolean not null default true,
  description text
);
create index if not exists sm_priority_matrices_rev_idx on sm_priority_matrices (org_id, rev);
create index if not exists sm_priority_matrices_upd_idx on sm_priority_matrices (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_priority_matrices_crt_idx on sm_priority_matrices (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_priority_matrices_table_key_uk on sm_priority_matrices (org_id, table_key) where deleted_at is null;
drop trigger if exists sm_priority_matrices_sync on sm_priority_matrices;
create trigger sm_priority_matrices_sync before insert or update on sm_priority_matrices for each row execute function sm_sync_touch('priority_matrix');
create or replace trigger sm_priority_matrices_demo after insert on sm_priority_matrices for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_priority_matrices_demo_t after update or delete on sm_priority_matrices for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_priority_matrices enable row level security;

-- problem: مشکلات
do $cols$
begin
  if to_regclass('sm_problems') is not null then
    alter table sm_problems add column if not exists workspace_id uuid;
    alter table sm_problems add column if not exists domain_id uuid;
    alter table sm_problems add column if not exists unit_id uuid;
    alter table sm_problems add column if not exists created_at timestamptz not null default now();
    alter table sm_problems add column if not exists created_by uuid;
    alter table sm_problems add column if not exists updated_at timestamptz not null default now();
    alter table sm_problems add column if not exists updated_by uuid;
    alter table sm_problems add column if not exists rev bigint not null default 0;
    alter table sm_problems add column if not exists version integer not null default 1;
    alter table sm_problems add column if not exists deleted_at timestamptz;
    alter table sm_problems add column if not exists origin text;
    alter table sm_problems add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_problems add column if not exists no integer;
    alter table sm_problems add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PRB' || no::text else 'PRB' || lpad(no::text, 7, '0') end) stored;
    alter table sm_problems add column if not exists short_description text;
    alter table sm_problems add column if not exists description text;
    alter table sm_problems add column if not exists state text;
    alter table sm_problems add column if not exists priority text;
    alter table sm_problems add column if not exists impact text;
    alter table sm_problems add column if not exists urgency text;
    alter table sm_problems add column if not exists category text;
    alter table sm_problems add column if not exists subcategory text;
    alter table sm_problems add column if not exists channel text;
    alter table sm_problems add column if not exists caller_id uuid;
    alter table sm_problems add column if not exists requested_for uuid;
    alter table sm_problems add column if not exists opened_by uuid;
    alter table sm_problems add column if not exists opened_at timestamptz;
    alter table sm_problems add column if not exists assignment_group_id uuid;
    alter table sm_problems add column if not exists assigned_to uuid;
    alter table sm_problems add column if not exists service_id uuid;
    alter table sm_problems add column if not exists offering_id uuid;
    alter table sm_problems add column if not exists ci_id uuid;
    alter table sm_problems add column if not exists location_id uuid;
    alter table sm_problems add column if not exists due_at timestamptz;
    alter table sm_problems add column if not exists resolved_at timestamptz;
    alter table sm_problems add column if not exists resolved_by uuid;
    alter table sm_problems add column if not exists closed_at timestamptz;
    alter table sm_problems add column if not exists closed_by uuid;
    alter table sm_problems add column if not exists close_code text;
    alter table sm_problems add column if not exists close_notes text;
    alter table sm_problems add column if not exists parent_id uuid;
    alter table sm_problems add column if not exists watch_list jsonb;
    alter table sm_problems add column if not exists approval text;
    alter table sm_problems add column if not exists escalation integer;
    alter table sm_problems add column if not exists reassignment_count integer;
    alter table sm_problems add column if not exists reopen_count integer;
    alter table sm_problems add column if not exists time_worked bigint;
    alter table sm_problems add column if not exists first_response_at timestamptz;
    alter table sm_problems add column if not exists active boolean not null default true;
    alter table sm_problems add column if not exists sla_due timestamptz;
    alter table sm_problems add column if not exists knowledge boolean not null default false;
    alter table sm_problems add column if not exists source text;
    alter table sm_problems add column if not exists proactive boolean not null default false;
    alter table sm_problems add column if not exists investigation_reason text;
    alter table sm_problems add column if not exists likelihood text;
    alter table sm_problems add column if not exists risk_score integer;
    alter table sm_problems add column if not exists manager_id uuid;
    alter table sm_problems add column if not exists pending_reason text;
    alter table sm_problems add column if not exists affected_services jsonb;
    alter table sm_problems add column if not exists affected_cis jsonb;
    alter table sm_problems add column if not exists first_incident_id uuid;
    alter table sm_problems add column if not exists template_id uuid;
    alter table sm_problems add column if not exists symptoms text;
    alter table sm_problems add column if not exists workaround text;
    alter table sm_problems add column if not exists cause_code text;
    alter table sm_problems add column if not exists rca_method text;
    alter table sm_problems add column if not exists rca_sections jsonb;
    alter table sm_problems add column if not exists contributing_factors jsonb;
    alter table sm_problems add column if not exists cause_notes text;
    alter table sm_problems add column if not exists fix_notes text;
    alter table sm_problems add column if not exists rca jsonb;
    alter table sm_problems add column if not exists duplicate_of uuid;
    alter table sm_problems add column if not exists known_error boolean not null default false;
    alter table sm_problems add column if not exists target_date date;
    alter table sm_problems add column if not exists review_date date;
    alter table sm_problems add column if not exists incident_count integer;
    alter table sm_problems add column if not exists tech_debt integer;
    alter table sm_problems add column if not exists rca_at timestamptz;
    alter table sm_problems add column if not exists workaround_at timestamptz;
    alter table sm_problems add column if not exists fix_at timestamptz;
    alter table sm_problems add column if not exists monitoring_until date;
    alter table sm_problems add column if not exists time_to_rca bigint;
    alter table sm_problems add column if not exists time_to_fix bigint;
    alter table sm_problems add column if not exists last_activity_at timestamptz;
    alter table sm_problems add column if not exists shared jsonb;
    alter table sm_problems add column if not exists reminded_at timestamptz;
    alter table sm_problems add column if not exists monitoring_done boolean not null default false;
    alter table sm_problems add column if not exists confidential boolean not null default false;
    alter table sm_problems add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_problems (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PRB' || no::text else 'PRB' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  source text,
  proactive boolean not null default false,
  investigation_reason text,
  likelihood text,
  risk_score integer,
  manager_id uuid,
  pending_reason text,
  affected_services jsonb,
  affected_cis jsonb,
  first_incident_id uuid,
  template_id uuid,
  symptoms text,
  workaround text,
  cause_code text,
  rca_method text,
  rca_sections jsonb,
  contributing_factors jsonb,
  cause_notes text,
  fix_notes text,
  rca jsonb,
  duplicate_of uuid,
  known_error boolean not null default false,
  target_date date,
  review_date date,
  incident_count integer,
  tech_debt integer,
  rca_at timestamptz,
  workaround_at timestamptz,
  fix_at timestamptz,
  monitoring_until date,
  time_to_rca bigint,
  time_to_fix bigint,
  last_activity_at timestamptz,
  shared jsonb,
  reminded_at timestamptz,
  monitoring_done boolean not null default false,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problems' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_problems', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_problems', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_problems' and indexname like 'sm\_problems\_search\_%' and indexname not in ('sm_problems_search_f3bce210_trgm', 'sm_problems_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problems_search_f3bce210_trgm', 'sm_problems', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_problems_search_custom_trgm', 'sm_problems', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_problems_no_uk on sm_problems (org_id, no);
create index if not exists sm_problems_rev_idx on sm_problems (org_id, rev);
create index if not exists sm_problems_upd_idx on sm_problems (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problems_crt_idx on sm_problems (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_problems_state_idx on sm_problems (org_id, state) where deleted_at is null;
create index if not exists sm_problems_assignment_group_id_idx on sm_problems (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_problems_assigned_to_idx on sm_problems (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problems_manager_id_idx on sm_problems (org_id, manager_id) where deleted_at is null;
create index if not exists sm_problems_workspace_acc_idx on sm_problems (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problems_unit_acc_idx on sm_problems (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problems_domain_acc_idx on sm_problems (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_problems_caller_id_idx on sm_problems (org_id, caller_id) where deleted_at is null;
create index if not exists sm_problems_requested_for_idx on sm_problems (org_id, requested_for) where deleted_at is null;
create index if not exists sm_problems_opened_by_idx on sm_problems (org_id, opened_by) where deleted_at is null;
create index if not exists sm_problems_watch_list_gin on sm_problems using gin (watch_list);
create index if not exists sm_problems_open_grp_idx on sm_problems (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_problems_opened_brin on sm_problems using brin (opened_at);
drop trigger if exists sm_problems_sync on sm_problems;
create trigger sm_problems_sync before insert or update on sm_problems for each row execute function sm_sync_touch('problem');
create or replace trigger sm_problems_demo after insert on sm_problems for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problems_demo_t after update or delete on sm_problems for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problems enable row level security;

-- problem_candidate: نامزدهای مشکل
do $cols$
begin
  if to_regclass('sm_problem_candidates') is not null then
    alter table sm_problem_candidates add column if not exists workspace_id uuid;
    alter table sm_problem_candidates add column if not exists domain_id uuid;
    alter table sm_problem_candidates add column if not exists unit_id uuid;
    alter table sm_problem_candidates add column if not exists created_at timestamptz not null default now();
    alter table sm_problem_candidates add column if not exists created_by uuid;
    alter table sm_problem_candidates add column if not exists updated_at timestamptz not null default now();
    alter table sm_problem_candidates add column if not exists updated_by uuid;
    alter table sm_problem_candidates add column if not exists rev bigint not null default 0;
    alter table sm_problem_candidates add column if not exists version integer not null default 1;
    alter table sm_problem_candidates add column if not exists deleted_at timestamptz;
    alter table sm_problem_candidates add column if not exists origin text;
    alter table sm_problem_candidates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_problem_candidates add column if not exists no integer;
    alter table sm_problem_candidates add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PCN' || no::text else 'PCN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_problem_candidates add column if not exists title text;
    alter table sm_problem_candidates add column if not exists rule_kind text;
    alter table sm_problem_candidates add column if not exists score integer;
    alter table sm_problem_candidates add column if not exists assigned_to uuid;
    alter table sm_problem_candidates add column if not exists incidents jsonb;
    alter table sm_problem_candidates add column if not exists incident_count integer;
    alter table sm_problem_candidates add column if not exists first_at timestamptz;
    alter table sm_problem_candidates add column if not exists last_at timestamptz;
    alter table sm_problem_candidates add column if not exists category text;
    alter table sm_problem_candidates add column if not exists ci_id uuid;
    alter table sm_problem_candidates add column if not exists service_id uuid;
    alter table sm_problem_candidates add column if not exists signature text;
    alter table sm_problem_candidates add column if not exists problem_id uuid;
    alter table sm_problem_candidates add column if not exists review_notes text;
    alter table sm_problem_candidates add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_problem_candidates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PCN' || no::text else 'PCN' || lpad(no::text, 6, '0') end) stored,
  title text,
  rule_kind text,
  score integer,
  assigned_to uuid,
  incidents jsonb,
  incident_count integer,
  first_at timestamptz,
  last_at timestamptz,
  category text,
  ci_id uuid,
  service_id uuid,
  signature text,
  problem_id uuid,
  review_notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problem_candidates' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_problem_candidates', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_problem_candidates', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_problem_candidates' and indexname like 'sm\_problem\_candidates\_search\_%' and indexname not in ('sm_problem_candidates_search_cae18f1d_trgm', 'sm_problem_candidates_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problem_candidates_search_cae18f1d_trgm', 'sm_problem_candidates', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_problem_candidates_search_custom_trgm', 'sm_problem_candidates', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_problem_candidates_no_uk on sm_problem_candidates (org_id, no);
create index if not exists sm_problem_candidates_rev_idx on sm_problem_candidates (org_id, rev);
create index if not exists sm_problem_candidates_upd_idx on sm_problem_candidates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_candidates_crt_idx on sm_problem_candidates (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_candidates_assigned_to_idx on sm_problem_candidates (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problem_candidates_signature_idx on sm_problem_candidates (org_id, signature) where deleted_at is null;
create index if not exists sm_problem_candidates_state_idx on sm_problem_candidates (org_id, state) where deleted_at is null;
create index if not exists sm_problem_candidates_workspace_acc_idx on sm_problem_candidates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_candidates_unit_acc_idx on sm_problem_candidates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_candidates_domain_acc_idx on sm_problem_candidates (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_problem_candidates_sync on sm_problem_candidates;
create trigger sm_problem_candidates_sync before insert or update on sm_problem_candidates for each row execute function sm_sync_touch('problem_candidate');
create or replace trigger sm_problem_candidates_demo after insert on sm_problem_candidates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_candidates_demo_t after update or delete on sm_problem_candidates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_candidates enable row level security;

-- problem_config: تنظیمات مشکل
do $cols$
begin
  if to_regclass('sm_problem_configs') is not null then
    alter table sm_problem_configs add column if not exists workspace_id uuid;
    alter table sm_problem_configs add column if not exists domain_id uuid;
    alter table sm_problem_configs add column if not exists unit_id uuid;
    alter table sm_problem_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_problem_configs add column if not exists created_by uuid;
    alter table sm_problem_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_problem_configs add column if not exists updated_by uuid;
    alter table sm_problem_configs add column if not exists rev bigint not null default 0;
    alter table sm_problem_configs add column if not exists version integer not null default 1;
    alter table sm_problem_configs add column if not exists deleted_at timestamptz;
    alter table sm_problem_configs add column if not exists origin text;
    alter table sm_problem_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_problem_configs add column if not exists name text;
    alter table sm_problem_configs add column if not exists config_key text;
    alter table sm_problem_configs add column if not exists inactivity_days integer;
    alter table sm_problem_configs add column if not exists monitoring_days integer;
    alter table sm_problem_configs add column if not exists ke_review_days integer;
    alter table sm_problem_configs add column if not exists candidate_window_days integer;
    alter table sm_problem_configs add column if not exists candidate_min_incidents integer;
    alter table sm_problem_configs add column if not exists candidate_reopen_min integer;
    alter table sm_problem_configs add column if not exists close_requires_incident boolean not null default false;
    alter table sm_problem_configs add column if not exists resolve_waiting_incidents boolean not null default true;
    alter table sm_problem_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_problem_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  inactivity_days integer,
  monitoring_days integer,
  ke_review_days integer,
  candidate_window_days integer,
  candidate_min_incidents integer,
  candidate_reopen_min integer,
  close_requires_incident boolean not null default false,
  resolve_waiting_incidents boolean not null default true,
  seeded integer
);
create index if not exists sm_problem_configs_rev_idx on sm_problem_configs (org_id, rev);
create index if not exists sm_problem_configs_upd_idx on sm_problem_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_configs_crt_idx on sm_problem_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_problem_configs_config_key_uk on sm_problem_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_problem_configs_sync on sm_problem_configs;
create trigger sm_problem_configs_sync before insert or update on sm_problem_configs for each row execute function sm_sync_touch('problem_config');
create or replace trigger sm_problem_configs_demo after insert on sm_problem_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_configs_demo_t after update or delete on sm_problem_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_configs enable row level security;

-- problem_task: کارهای مشکل
do $cols$
begin
  if to_regclass('sm_problem_tasks') is not null then
    alter table sm_problem_tasks add column if not exists workspace_id uuid;
    alter table sm_problem_tasks add column if not exists domain_id uuid;
    alter table sm_problem_tasks add column if not exists unit_id uuid;
    alter table sm_problem_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_problem_tasks add column if not exists created_by uuid;
    alter table sm_problem_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_problem_tasks add column if not exists updated_by uuid;
    alter table sm_problem_tasks add column if not exists rev bigint not null default 0;
    alter table sm_problem_tasks add column if not exists version integer not null default 1;
    alter table sm_problem_tasks add column if not exists deleted_at timestamptz;
    alter table sm_problem_tasks add column if not exists origin text;
    alter table sm_problem_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_problem_tasks add column if not exists no integer;
    alter table sm_problem_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_problem_tasks add column if not exists short_description text;
    alter table sm_problem_tasks add column if not exists description text;
    alter table sm_problem_tasks add column if not exists state text;
    alter table sm_problem_tasks add column if not exists priority text;
    alter table sm_problem_tasks add column if not exists impact text;
    alter table sm_problem_tasks add column if not exists urgency text;
    alter table sm_problem_tasks add column if not exists category text;
    alter table sm_problem_tasks add column if not exists subcategory text;
    alter table sm_problem_tasks add column if not exists channel text;
    alter table sm_problem_tasks add column if not exists caller_id uuid;
    alter table sm_problem_tasks add column if not exists requested_for uuid;
    alter table sm_problem_tasks add column if not exists opened_by uuid;
    alter table sm_problem_tasks add column if not exists opened_at timestamptz;
    alter table sm_problem_tasks add column if not exists assignment_group_id uuid;
    alter table sm_problem_tasks add column if not exists assigned_to uuid;
    alter table sm_problem_tasks add column if not exists service_id uuid;
    alter table sm_problem_tasks add column if not exists offering_id uuid;
    alter table sm_problem_tasks add column if not exists ci_id uuid;
    alter table sm_problem_tasks add column if not exists location_id uuid;
    alter table sm_problem_tasks add column if not exists due_at timestamptz;
    alter table sm_problem_tasks add column if not exists resolved_at timestamptz;
    alter table sm_problem_tasks add column if not exists resolved_by uuid;
    alter table sm_problem_tasks add column if not exists closed_at timestamptz;
    alter table sm_problem_tasks add column if not exists closed_by uuid;
    alter table sm_problem_tasks add column if not exists close_code text;
    alter table sm_problem_tasks add column if not exists close_notes text;
    alter table sm_problem_tasks add column if not exists parent_id uuid;
    alter table sm_problem_tasks add column if not exists watch_list jsonb;
    alter table sm_problem_tasks add column if not exists approval text;
    alter table sm_problem_tasks add column if not exists escalation integer;
    alter table sm_problem_tasks add column if not exists reassignment_count integer;
    alter table sm_problem_tasks add column if not exists reopen_count integer;
    alter table sm_problem_tasks add column if not exists time_worked bigint;
    alter table sm_problem_tasks add column if not exists first_response_at timestamptz;
    alter table sm_problem_tasks add column if not exists active boolean not null default true;
    alter table sm_problem_tasks add column if not exists sla_due timestamptz;
    alter table sm_problem_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_problem_tasks add column if not exists problem_id uuid;
    alter table sm_problem_tasks add column if not exists task_type text;
    alter table sm_problem_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_problem_tasks add column if not exists findings text;
  end if;
end
$cols$;
create table if not exists sm_problem_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  problem_id uuid,
  task_type text,
  mandatory boolean not null default true,
  findings text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_problem_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_problem_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_problem_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_problem_tasks' and indexname like 'sm\_problem\_tasks\_search\_%' and indexname not in ('sm_problem_tasks_search_f3bce210_trgm', 'sm_problem_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_problem_tasks_search_f3bce210_trgm', 'sm_problem_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_problem_tasks_search_custom_trgm', 'sm_problem_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_problem_tasks_no_uk on sm_problem_tasks (org_id, no);
create index if not exists sm_problem_tasks_rev_idx on sm_problem_tasks (org_id, rev);
create index if not exists sm_problem_tasks_upd_idx on sm_problem_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_tasks_crt_idx on sm_problem_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_tasks_state_idx on sm_problem_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_problem_tasks_assignment_group_id_idx on sm_problem_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_problem_tasks_assigned_to_idx on sm_problem_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_problem_tasks_problem_id_idx on sm_problem_tasks (org_id, problem_id) where deleted_at is null;
create index if not exists sm_problem_tasks_workspace_acc_idx on sm_problem_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_tasks_unit_acc_idx on sm_problem_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_tasks_domain_acc_idx on sm_problem_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_problem_tasks_caller_id_idx on sm_problem_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_problem_tasks_requested_for_idx on sm_problem_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_problem_tasks_opened_by_idx on sm_problem_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_problem_tasks_watch_list_gin on sm_problem_tasks using gin (watch_list);
create index if not exists sm_problem_tasks_open_grp_idx on sm_problem_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_problem_tasks_opened_brin on sm_problem_tasks using brin (opened_at);
drop trigger if exists sm_problem_tasks_sync on sm_problem_tasks;
create trigger sm_problem_tasks_sync before insert or update on sm_problem_tasks for each row execute function sm_sync_touch('problem_task');
create or replace trigger sm_problem_tasks_demo after insert on sm_problem_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_tasks_demo_t after update or delete on sm_problem_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_tasks enable row level security;

-- problem_template: الگوهای مشکل
do $cols$
begin
  if to_regclass('sm_problem_templates') is not null then
    alter table sm_problem_templates add column if not exists workspace_id uuid;
    alter table sm_problem_templates add column if not exists domain_id uuid;
    alter table sm_problem_templates add column if not exists unit_id uuid;
    alter table sm_problem_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_problem_templates add column if not exists created_by uuid;
    alter table sm_problem_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_problem_templates add column if not exists updated_by uuid;
    alter table sm_problem_templates add column if not exists rev bigint not null default 0;
    alter table sm_problem_templates add column if not exists version integer not null default 1;
    alter table sm_problem_templates add column if not exists deleted_at timestamptz;
    alter table sm_problem_templates add column if not exists origin text;
    alter table sm_problem_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_problem_templates add column if not exists name text;
    alter table sm_problem_templates add column if not exists active boolean not null default true;
    alter table sm_problem_templates add column if not exists sort_order integer;
    alter table sm_problem_templates add column if not exists short_description text;
    alter table sm_problem_templates add column if not exists description text;
    alter table sm_problem_templates add column if not exists source text;
    alter table sm_problem_templates add column if not exists category text;
    alter table sm_problem_templates add column if not exists subcategory text;
    alter table sm_problem_templates add column if not exists impact text;
    alter table sm_problem_templates add column if not exists urgency text;
    alter table sm_problem_templates add column if not exists likelihood text;
    alter table sm_problem_templates add column if not exists assignment_group_id uuid;
    alter table sm_problem_templates add column if not exists service_id uuid;
    alter table sm_problem_templates add column if not exists ci_id uuid;
    alter table sm_problem_templates add column if not exists rca_method text;
    alter table sm_problem_templates add column if not exists rca_sections jsonb;
    alter table sm_problem_templates add column if not exists tasks jsonb;
    alter table sm_problem_templates add column if not exists groups jsonb;
    alter table sm_problem_templates add column if not exists description_note text;
  end if;
end
$cols$;
create table if not exists sm_problem_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default true,
  sort_order integer,
  short_description text,
  description text,
  source text,
  category text,
  subcategory text,
  impact text,
  urgency text,
  likelihood text,
  assignment_group_id uuid,
  service_id uuid,
  ci_id uuid,
  rca_method text,
  rca_sections jsonb,
  tasks jsonb,
  groups jsonb,
  description_note text
);
create index if not exists sm_problem_templates_rev_idx on sm_problem_templates (org_id, rev);
create index if not exists sm_problem_templates_upd_idx on sm_problem_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_problem_templates_crt_idx on sm_problem_templates (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_problem_templates_name_uk on sm_problem_templates (org_id, name) where deleted_at is null;
create index if not exists sm_problem_templates_workspace_acc_idx on sm_problem_templates (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_problem_templates_unit_acc_idx on sm_problem_templates (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_problem_templates_domain_acc_idx on sm_problem_templates (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_problem_templates_open_grp_idx on sm_problem_templates (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_problem_templates_sync on sm_problem_templates;
create trigger sm_problem_templates_sync before insert or update on sm_problem_templates for each row execute function sm_sync_touch('problem_template');
create or replace trigger sm_problem_templates_demo after insert on sm_problem_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_problem_templates_demo_t after update or delete on sm_problem_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_problem_templates enable row level security;

-- project: پروژه‌ها
do $cols$
begin
  if to_regclass('sm_projects') is not null then
    alter table sm_projects add column if not exists workspace_id uuid;
    alter table sm_projects add column if not exists domain_id uuid;
    alter table sm_projects add column if not exists unit_id uuid;
    alter table sm_projects add column if not exists created_at timestamptz not null default now();
    alter table sm_projects add column if not exists created_by uuid;
    alter table sm_projects add column if not exists updated_at timestamptz not null default now();
    alter table sm_projects add column if not exists updated_by uuid;
    alter table sm_projects add column if not exists rev bigint not null default 0;
    alter table sm_projects add column if not exists version integer not null default 1;
    alter table sm_projects add column if not exists deleted_at timestamptz;
    alter table sm_projects add column if not exists origin text;
    alter table sm_projects add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_projects add column if not exists no integer;
    alter table sm_projects add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRJ' || no::text else 'PRJ' || lpad(no::text, 6, '0') end) stored;
    alter table sm_projects add column if not exists name text;
    alter table sm_projects add column if not exists code text;
    alter table sm_projects add column if not exists type text;
    alter table sm_projects add column if not exists methodology text;
    alter table sm_projects add column if not exists priority text;
    alter table sm_projects add column if not exists project_manager_id uuid;
    alter table sm_projects add column if not exists sponsor_id uuid;
    alter table sm_projects add column if not exists portfolio_id uuid;
    alter table sm_projects add column if not exists assignment_group_id uuid;
    alter table sm_projects add column if not exists team jsonb;
    alter table sm_projects add column if not exists org_unit_id uuid;
    alter table sm_projects add column if not exists demand_id uuid;
    alter table sm_projects add column if not exists description text;
    alter table sm_projects add column if not exists planned_start date;
    alter table sm_projects add column if not exists planned_end date;
    alter table sm_projects add column if not exists projected_end date;
    alter table sm_projects add column if not exists actual_start date;
    alter table sm_projects add column if not exists actual_end date;
    alter table sm_projects add column if not exists baseline_end date;
    alter table sm_projects add column if not exists baseline_start date;
    alter table sm_projects add column if not exists baseline_taken_at timestamptz;
    alter table sm_projects add column if not exists est_hours numeric;
    alter table sm_projects add column if not exists actual_hours numeric;
    alter table sm_projects add column if not exists budget numeric;
    alter table sm_projects add column if not exists actual_cost numeric;
    alter table sm_projects add column if not exists objectives text;
    alter table sm_projects add column if not exists scope_in text;
    alter table sm_projects add column if not exists scope_out text;
    alter table sm_projects add column if not exists assumptions text;
    alter table sm_projects add column if not exists health text;
    alter table sm_projects add column if not exists health_override text;
    alter table sm_projects add column if not exists health_reasons jsonb;
    alter table sm_projects add column if not exists schedule_status text;
    alter table sm_projects add column if not exists schedule_variance_days integer;
    alter table sm_projects add column if not exists pct_complete numeric;
    alter table sm_projects add column if not exists tasks_total integer;
    alter table sm_projects add column if not exists tasks_done integer;
    alter table sm_projects add column if not exists tasks_overdue integer;
    alter table sm_projects add column if not exists milestones_overdue integer;
    alter table sm_projects add column if not exists open_risks integer;
    alter table sm_projects add column if not exists last_status_at timestamptz;
    alter table sm_projects add column if not exists health_at timestamptz;
    alter table sm_projects add column if not exists approval text;
    alter table sm_projects add column if not exists lessons text;
    alter table sm_projects add column if not exists closure_notes text;
    alter table sm_projects add column if not exists watch_list jsonb;
    alter table sm_projects add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_projects (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRJ' || no::text else 'PRJ' || lpad(no::text, 6, '0') end) stored,
  name text,
  code text,
  type text,
  methodology text,
  priority text,
  project_manager_id uuid,
  sponsor_id uuid,
  portfolio_id uuid,
  assignment_group_id uuid,
  team jsonb,
  org_unit_id uuid,
  demand_id uuid,
  description text,
  planned_start date,
  planned_end date,
  projected_end date,
  actual_start date,
  actual_end date,
  baseline_end date,
  baseline_start date,
  baseline_taken_at timestamptz,
  est_hours numeric,
  actual_hours numeric,
  budget numeric,
  actual_cost numeric,
  objectives text,
  scope_in text,
  scope_out text,
  assumptions text,
  health text,
  health_override text,
  health_reasons jsonb,
  schedule_status text,
  schedule_variance_days integer,
  pct_complete numeric,
  tasks_total integer,
  tasks_done integer,
  tasks_overdue integer,
  milestones_overdue integer,
  open_risks integer,
  last_status_at timestamptz,
  health_at timestamptz,
  approval text,
  lessons text,
  closure_notes text,
  watch_list jsonb,
  state text,
  search_a180b3a5 text generated always as (translate(coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_projects' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_a180b3a5' loop
    execute format('alter table %I drop column if exists %I', 'sm_projects', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_projects', 'search_a180b3a5', $x$translate(coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_projects' and indexname like 'sm\_projects\_search\_%' and indexname not in ('sm_projects_search_a180b3a5_trgm', 'sm_projects_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_projects_search_a180b3a5_trgm', 'sm_projects', 'search_a180b3a5', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_projects_search_custom_trgm', 'sm_projects', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_projects_no_uk on sm_projects (org_id, no);
create index if not exists sm_projects_rev_idx on sm_projects (org_id, rev);
create index if not exists sm_projects_upd_idx on sm_projects (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_projects_crt_idx on sm_projects (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_projects_code_uk on sm_projects (org_id, code) where deleted_at is null;
create index if not exists sm_projects_project_manager_id_idx on sm_projects (org_id, project_manager_id) where deleted_at is null;
create index if not exists sm_projects_sponsor_id_idx on sm_projects (org_id, sponsor_id) where deleted_at is null;
create index if not exists sm_projects_portfolio_id_idx on sm_projects (org_id, portfolio_id) where deleted_at is null;
create index if not exists sm_projects_assignment_group_id_idx on sm_projects (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_projects_state_idx on sm_projects (org_id, state) where deleted_at is null;
create index if not exists sm_projects_workspace_acc_idx on sm_projects (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_projects_unit_acc_idx on sm_projects (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_projects_domain_acc_idx on sm_projects (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_projects_team_gin on sm_projects using gin (team);
create index if not exists sm_projects_watch_list_gin on sm_projects using gin (watch_list);
drop trigger if exists sm_projects_sync on sm_projects;
create trigger sm_projects_sync before insert or update on sm_projects for each row execute function sm_sync_touch('project');
create or replace trigger sm_projects_demo after insert on sm_projects for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_projects_demo_t after update or delete on sm_projects for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_projects enable row level security;

-- project_config: تنظیمات پروژه‌ها
do $cols$
begin
  if to_regclass('sm_project_configs') is not null then
    alter table sm_project_configs add column if not exists workspace_id uuid;
    alter table sm_project_configs add column if not exists domain_id uuid;
    alter table sm_project_configs add column if not exists unit_id uuid;
    alter table sm_project_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_project_configs add column if not exists created_by uuid;
    alter table sm_project_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_project_configs add column if not exists updated_by uuid;
    alter table sm_project_configs add column if not exists rev bigint not null default 0;
    alter table sm_project_configs add column if not exists version integer not null default 1;
    alter table sm_project_configs add column if not exists deleted_at timestamptz;
    alter table sm_project_configs add column if not exists origin text;
    alter table sm_project_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_project_configs add column if not exists name text;
    alter table sm_project_configs add column if not exists config_key text;
    alter table sm_project_configs add column if not exists scoring_model text;
    alter table sm_project_configs add column if not exists weekly_capacity_hours numeric;
    alter table sm_project_configs add column if not exists status_report_days integer;
    alter table sm_project_configs add column if not exists amber_variance_days integer;
    alter table sm_project_configs add column if not exists red_variance_days integer;
    alter table sm_project_configs add column if not exists red_risk_score integer;
    alter table sm_project_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_project_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  scoring_model text,
  weekly_capacity_hours numeric,
  status_report_days integer,
  amber_variance_days integer,
  red_variance_days integer,
  red_risk_score integer,
  seeded integer
);
create index if not exists sm_project_configs_rev_idx on sm_project_configs (org_id, rev);
create index if not exists sm_project_configs_upd_idx on sm_project_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_project_configs_crt_idx on sm_project_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_project_configs_config_key_uk on sm_project_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_project_configs_sync on sm_project_configs;
create trigger sm_project_configs_sync before insert or update on sm_project_configs for each row execute function sm_sync_touch('project_config');
create or replace trigger sm_project_configs_demo after insert on sm_project_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_project_configs_demo_t after update or delete on sm_project_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_project_configs enable row level security;

-- project_task: کارهای پروژه
do $cols$
begin
  if to_regclass('sm_project_tasks') is not null then
    alter table sm_project_tasks add column if not exists workspace_id uuid;
    alter table sm_project_tasks add column if not exists domain_id uuid;
    alter table sm_project_tasks add column if not exists unit_id uuid;
    alter table sm_project_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_project_tasks add column if not exists created_by uuid;
    alter table sm_project_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_project_tasks add column if not exists updated_by uuid;
    alter table sm_project_tasks add column if not exists rev bigint not null default 0;
    alter table sm_project_tasks add column if not exists version integer not null default 1;
    alter table sm_project_tasks add column if not exists deleted_at timestamptz;
    alter table sm_project_tasks add column if not exists origin text;
    alter table sm_project_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_project_tasks add column if not exists no integer;
    alter table sm_project_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_project_tasks add column if not exists short_description text;
    alter table sm_project_tasks add column if not exists project_id uuid;
    alter table sm_project_tasks add column if not exists parent_id uuid;
    alter table sm_project_tasks add column if not exists kind text;
    alter table sm_project_tasks add column if not exists wbs text;
    alter table sm_project_tasks add column if not exists sort_order integer;
    alter table sm_project_tasks add column if not exists assigned_to uuid;
    alter table sm_project_tasks add column if not exists assignment_group_id uuid;
    alter table sm_project_tasks add column if not exists planned_start date;
    alter table sm_project_tasks add column if not exists planned_end date;
    alter table sm_project_tasks add column if not exists duration_days integer;
    alter table sm_project_tasks add column if not exists depends_on jsonb;
    alter table sm_project_tasks add column if not exists lag_days integer;
    alter table sm_project_tasks add column if not exists start_no_earlier date;
    alter table sm_project_tasks add column if not exists est_hours numeric;
    alter table sm_project_tasks add column if not exists actual_hours numeric;
    alter table sm_project_tasks add column if not exists pct_complete numeric;
    alter table sm_project_tasks add column if not exists baseline_start date;
    alter table sm_project_tasks add column if not exists baseline_end date;
    alter table sm_project_tasks add column if not exists is_critical boolean not null default false;
    alter table sm_project_tasks add column if not exists float_days integer;
    alter table sm_project_tasks add column if not exists actual_start date;
    alter table sm_project_tasks add column if not exists actual_end date;
    alter table sm_project_tasks add column if not exists release_id uuid;
    alter table sm_project_tasks add column if not exists description text;
    alter table sm_project_tasks add column if not exists project_manager_id uuid;
    alter table sm_project_tasks add column if not exists watch_list jsonb;
    alter table sm_project_tasks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_project_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PTASK' || no::text else 'PTASK' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  project_id uuid,
  parent_id uuid,
  kind text,
  wbs text,
  sort_order integer,
  assigned_to uuid,
  assignment_group_id uuid,
  planned_start date,
  planned_end date,
  duration_days integer,
  depends_on jsonb,
  lag_days integer,
  start_no_earlier date,
  est_hours numeric,
  actual_hours numeric,
  pct_complete numeric,
  baseline_start date,
  baseline_end date,
  is_critical boolean not null default false,
  float_days integer,
  actual_start date,
  actual_end date,
  release_id uuid,
  description text,
  project_manager_id uuid,
  watch_list jsonb,
  state text,
  search_9c3826f0 text generated always as (translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_project_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9c3826f0' loop
    execute format('alter table %I drop column if exists %I', 'sm_project_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_project_tasks', 'search_9c3826f0', $x$translate(coalesce(short_description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_project_tasks' and indexname like 'sm\_project\_tasks\_search\_%' and indexname not in ('sm_project_tasks_search_9c3826f0_trgm', 'sm_project_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_project_tasks_search_9c3826f0_trgm', 'sm_project_tasks', 'search_9c3826f0', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_project_tasks_search_custom_trgm', 'sm_project_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_project_tasks_no_uk on sm_project_tasks (org_id, no);
create index if not exists sm_project_tasks_rev_idx on sm_project_tasks (org_id, rev);
create index if not exists sm_project_tasks_upd_idx on sm_project_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_project_tasks_crt_idx on sm_project_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_project_tasks_project_id_idx on sm_project_tasks (org_id, project_id) where deleted_at is null;
create index if not exists sm_project_tasks_parent_id_idx on sm_project_tasks (org_id, parent_id) where deleted_at is null;
create index if not exists sm_project_tasks_assigned_to_idx on sm_project_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_project_tasks_state_idx on sm_project_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_project_tasks_workspace_acc_idx on sm_project_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_project_tasks_unit_acc_idx on sm_project_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_project_tasks_domain_acc_idx on sm_project_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_project_tasks_project_manager_id_idx on sm_project_tasks (org_id, project_manager_id) where deleted_at is null;
create index if not exists sm_project_tasks_watch_list_gin on sm_project_tasks using gin (watch_list);
drop trigger if exists sm_project_tasks_sync on sm_project_tasks;
create trigger sm_project_tasks_sync before insert or update on sm_project_tasks for each row execute function sm_sync_touch('project_task');
create or replace trigger sm_project_tasks_demo after insert on sm_project_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_project_tasks_demo_t after update or delete on sm_project_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_project_tasks enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:18', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

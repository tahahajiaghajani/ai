-- =====================================================================
--  TaskFlow AI — اسکیمای کامل دیتابیس Supabase
--  این فایل «ایدمپوتنت» است: می‌توانید چند بار اجرا کنید بدون اینکه چیزی خراب شود.
--  محل اجرا: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) افزونه‌ها
-- ---------------------------------------------------------------------
-- (فقط اگر نصب نشده باشند ساخته می‌شوند تا اجرای دوباره‌ی اسکریپت خطا ندهد)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net with schema extensions;
  end if;
  if not exists (select 1 from pg_extension where extname = 'vector') then
    create extension vector with schema extensions;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron with schema pg_catalog;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) توابع کمکی عمومی
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) پروفایل کاربران
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  org_unit     text,
  phone        text,
  role         text not null default 'requester' check (role in ('admin','requester')),
  status       text not null default 'pending'   check (status in ('pending','active','disabled')),
  color        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, org_unit, phone)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'org_unit',''),
    nullif(new.raw_user_meta_data->>'phone','')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- کاربرانی که قبل از اجرای این اسکریپت ثبت‌نام کرده‌اند
insert into public.profiles (id, email, full_name)
select u.id, u.email, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin' and p.status = 'active');
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active');
$$;

-- ---------------------------------------------------------------------
-- 3) تسک‌ها
-- ---------------------------------------------------------------------
create sequence if not exists public.task_code_seq;

create table if not exists public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  parent_id             uuid references public.tasks(id) on delete cascade,
  root_id               uuid references public.tasks(id) on delete cascade,
  seq_in_root           int not null default 1,
  relation_type         text check (relation_type in ('continuation','rejection','clarification','revision','other')),
  title                 text not null,
  description           text not null default '',
  kind                  text not null default 'task' check (kind in ('task','event')),
  start_date            date,
  end_date              date,
  event_at              timestamptz,
  priority              text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status                text not null default 'pending_approval' check (status in (
                          'pending_approval','returned','approved',
                          'prework_queued','prework_running','prework_done',
                          'main_queued','main_running','main_done',
                          'closure_pending','closure_rejected','closed','cancelled')),
  progress              int not null default 0 check (progress between 0 and 100),
  requester_id          uuid not null references public.profiles(id),
  return_reason         text,
  closure_note          text,
  closure_reject_reason text,
  admin_note            text,
  slug                  text,
  github_path           text,
  github_issue_number   int,
  claude_session_id     text,
  labels                text[] not null default '{}',
  status_changed_at     timestamptz not null default now(),
  approved_at           timestamptz,
  prework_started_at    timestamptz,
  prework_done_at       timestamptz,
  main_started_at       timestamptz,
  main_done_at          timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_tasks_status    on public.tasks(status);
create index if not exists idx_tasks_requester on public.tasks(requester_id);
create index if not exists idx_tasks_root      on public.tasks(root_id);
create index if not exists idx_tasks_parent    on public.tasks(parent_id);

create or replace function public.tasks_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.tasks;
  v_root   public.tasks;
begin
  if new.parent_id is null then
    new.root_id     := new.id;
    new.seq_in_root := 1;
    if new.code is null then
      new.code := 'T-' || lpad(nextval('public.task_code_seq')::text, 4, '0');
    end if;
  else
    select * into v_parent from public.tasks where id = new.parent_id;
    if v_parent.id is null then
      raise exception 'parent task not found';
    end if;
    select * into v_root from public.tasks where id = coalesce(v_parent.root_id, v_parent.id);
    new.root_id := v_root.id;
    perform pg_advisory_xact_lock(hashtext('task-seq:' || v_root.id::text));
    select coalesce(max(seq_in_root), 1) + 1 into new.seq_in_root
      from public.tasks where root_id = v_root.id;
    if new.code is null then
      new.code := v_root.code || '.' || new.seq_in_root;
    end if;
    new.github_path := coalesce(new.github_path, v_root.github_path);
    new.github_issue_number := coalesce(new.github_issue_number, v_root.github_issue_number);
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_before_insert on public.tasks;
create trigger trg_tasks_before_insert before insert on public.tasks
  for each row execute function public.tasks_before_insert();

create or replace function public.tasks_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_before_update on public.tasks;
create trigger trg_tasks_before_update before update on public.tasks
  for each row execute function public.tasks_before_update();

-- ---------------------------------------------------------------------
-- 4) ارتقاهای خودکار اپلیکیشن (Self-upgrade)
-- ---------------------------------------------------------------------
create sequence if not exists public.upgrade_code_seq;

create table if not exists public.upgrades (
  id          uuid primary key default gen_random_uuid(),
  code        text unique default ('U-' || lpad(nextval('public.upgrade_code_seq')::text, 4, '0')),
  title       text,
  prompt      text not null,
  status      text not null default 'queued' check (status in
                ('queued','running','review','merging','merged','failed','cancelled','rolled_back')),
  branch      text,
  pr_number   int,
  pr_url      text,
  preview_url text,
  summary     text,
  files       jsonb not null default '[]',
  auto_merge  boolean not null default false,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  merged_at   timestamptz
);

drop trigger if exists trg_upgrades_updated on public.upgrades;
create trigger trg_upgrades_updated before update on public.upgrades
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5) صف کارها (جایگزین Celery روی Postgres)
-- ---------------------------------------------------------------------
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references public.tasks(id) on delete cascade,
  upgrade_id    uuid references public.upgrades(id) on delete cascade,
  kind          text not null check (kind in ('prework','main','knowledge','graphify','upgrade','optimize')),
  provider      text not null check (provider in ('gemini','claude','system')),
  status        text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  priority      int  not null default 50,
  step          text,
  state         jsonb not null default '{}',
  payload       jsonb not null default '{}',
  result        jsonb,
  error         text,
  attempts      int not null default 0,
  max_attempts  int not null default 6,
  run_after     timestamptz not null default now(),
  locked_until  timestamptz,
  locked_by     text,
  external_id   text,
  external_url  text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  heartbeat_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists idx_jobs_claim on public.jobs(provider, status, run_after, priority desc, created_at);
create index if not exists idx_jobs_task  on public.jobs(task_id);

-- داده‌ی حجیم هر کار (وضعیت گراف LangGraph و خروجی نیمه‌کاره) — جدا از jobs تا Realtime سبک بماند
create table if not exists public.job_data (
  job_id     uuid primary key references public.jobs(id) on delete cascade,
  graph      jsonb not null default '{}',
  partial    jsonb,
  updated_at timestamptz not null default now()
);

-- وضعیت هر ارائه‌دهنده (Gemini / Claude) — مکث خودکار هنگام رسیدن به لیمیت
create table if not exists public.provider_state (
  provider        text primary key check (provider in ('gemini','claude','system')),
  max_concurrency int not null default 1,
  paused_until    timestamptz,
  pause_reason    text,
  manual_pause    boolean not null default false,
  models          jsonb not null default '{}',
  stats           jsonb not null default '{}',
  updated_at      timestamptz not null default now()
);

insert into public.provider_state (provider, max_concurrency) values
  ('gemini', 1), ('claude', 1), ('system', 2)
on conflict (provider) do nothing;

-- برداشتن کار بعدی از صف به صورت اتمیک (FOR UPDATE SKIP LOCKED + advisory lock)
create or replace function public.claim_job(p_provider text, p_worker text, p_lease_seconds int default 70)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare
  v_state   public.provider_state;
  v_job     public.jobs;
  v_running int;
begin
  perform pg_advisory_xact_lock(hashtext('claim:' || p_provider));

  select * into v_state from public.provider_state where provider = p_provider;
  if v_state.provider is null then return; end if;
  if v_state.manual_pause or (v_state.paused_until is not null and v_state.paused_until > now()) then
    return;
  end if;

  -- ۱) ادامه‌ی کاری که در حال اجراست و قفلش آزاد/منقضی شده
  select * into v_job from public.jobs
   where provider = p_provider and status = 'running'
     and (locked_until is null or locked_until < now())
     and run_after <= now()
   order by priority desc, created_at
   limit 1
   for update skip locked;

  if found then
    update public.jobs set
      attempts     = case when locked_by is not null then attempts + 1 else attempts end,
      locked_by    = p_worker,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      updated_at   = now()
    where id = v_job.id
    returning * into v_job;
    return next v_job;
    return;
  end if;

  -- ۲) ظرفیت هم‌زمانی
  select count(*) into v_running from public.jobs
   where provider = p_provider and status = 'running';
  if v_running >= v_state.max_concurrency then
    return;
  end if;

  -- ۳) شروع کار بعدی صف
  select * into v_job from public.jobs
   where provider = p_provider and status = 'queued' and run_after <= now()
   order by priority desc, created_at
   limit 1
   for update skip locked;

  if not found then return; end if;

  update public.jobs set
    status       = 'running',
    started_at   = coalesce(started_at, now()),
    locked_by    = p_worker,
    locked_until = now() + make_interval(secs => p_lease_seconds),
    heartbeat_at = now(),
    updated_at   = now()
  where id = v_job.id
  returning * into v_job;
  return next v_job;
end $$;

-- ---------------------------------------------------------------------
-- 6) لاگ زنده و رویدادهای هر تسک
-- ---------------------------------------------------------------------
create table if not exists public.task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid references public.tasks(id) on delete cascade,
  upgrade_id  uuid references public.upgrades(id) on delete cascade,
  job_id      uuid references public.jobs(id) on delete set null,
  source      text not null default 'system' check (source in
                ('system','user','gemini','claude','github','graphify','knowledge')),
  kind        text not null default 'log' check (kind in
                ('status','log','tool','thought','search','file','commit','error','warning',
                 'todo','result','message','progress','node')),
  title       text not null,
  detail      text,
  data        jsonb,
  visibility  text not null default 'internal' check (visibility in ('internal','requester')),
  actor_id    uuid,
  created_at  timestamptz not null default now()
);

create index if not exists idx_events_task    on public.task_events(task_id, id desc);
create index if not exists idx_events_upgrade on public.task_events(upgrade_id, id desc);
create index if not exists idx_events_job     on public.task_events(job_id, id desc);

-- ---------------------------------------------------------------------
-- 7) فایل‌های پیوست
-- ---------------------------------------------------------------------
create table if not exists public.task_files (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid references public.tasks(id) on delete cascade,
  upgrade_id            uuid references public.upgrades(id) on delete cascade,
  job_id                uuid references public.jobs(id) on delete set null,
  context               text not null default 'request' check (context in ('request','prework','main','upgrade','output')),
  storage_path          text not null,
  name                  text not null,
  mime                  text,
  size                  bigint,
  uploaded_by           uuid references public.profiles(id),
  github_path           text,
  gemini_uri            text,
  gemini_uri_expires_at timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_files_task on public.task_files(task_id);

-- ---------------------------------------------------------------------
-- 8) حافظه‌ی گفت‌وگو با Gemini (ادامه‌ی چت برای تسک‌های مرتبط)
-- ---------------------------------------------------------------------
create table if not exists public.ai_messages (
  id           bigint generated always as identity primary key,
  root_task_id uuid not null references public.tasks(id) on delete cascade,
  task_id      uuid references public.tasks(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete set null,
  agent        text not null,
  role         text not null check (role in ('user','model')),
  content      text not null,
  tokens       int,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ai_messages_root on public.ai_messages(root_task_id, id);

-- ---------------------------------------------------------------------
-- 9) پایگاه دانش (RAG) — pgvector + جستجوی ترکیبی
-- ---------------------------------------------------------------------
create table if not exists public.knowledge_items (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  metadata    jsonb not null default '{}',
  embedding   extensions.vector(768),
  fts         tsvector generated always as
                (to_tsvector('simple', coalesce(metadata->>'title','') || ' ' || content)) stored,
  use_count   int not null default 0,
  score       real not null default 0,
  exported_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_knowledge_embedding on public.knowledge_items
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists idx_knowledge_fts  on public.knowledge_items using gin (fts);
create index if not exists idx_knowledge_meta on public.knowledge_items using gin (metadata);

create or replace function public.match_knowledge(
  query_embedding extensions.vector(768),
  match_count int default 8,
  filter jsonb default '{}'
) returns table (id uuid, content text, metadata jsonb, similarity float)
language sql stable security definer set search_path = public, extensions as $$
  select k.id, k.content, k.metadata, 1 - (k.embedding <=> query_embedding) as similarity
  from public.knowledge_items k
  where k.metadata @> filter and k.embedding is not null
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

-- جستجوی ترکیبی معنایی + کلیدواژه با Reciprocal Rank Fusion
create or replace function public.hybrid_search_knowledge(
  query_text text,
  query_embedding extensions.vector(768),
  match_count int default 8,
  filter jsonb default '{}'
) returns table (id uuid, content text, metadata jsonb, similarity float, score float)
language sql stable security definer set search_path = public, extensions as $$
  with semantic as (
    select k.id, row_number() over (order by k.embedding <=> query_embedding) as rnk,
           1 - (k.embedding <=> query_embedding) as sim
    from public.knowledge_items k
    where k.metadata @> filter and k.embedding is not null
    order by k.embedding <=> query_embedding
    limit match_count * 3
  ),
  keyword as (
    select k.id, row_number() over (
             order by ts_rank_cd(k.fts, websearch_to_tsquery('simple', query_text)) desc) as rnk
    from public.knowledge_items k
    where k.metadata @> filter
      and k.fts @@ websearch_to_tsquery('simple', query_text)
    limit match_count * 3
  )
  select k.id, k.content, k.metadata,
         coalesce(s.sim, 0)::float as similarity,
         (coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + kw.rnk), 0)
           + least(k.score, 5) * 0.002)::float as score
  from semantic s
  full outer join keyword kw on kw.id = s.id
  join public.knowledge_items k on k.id = coalesce(s.id, kw.id)
  order by score desc
  limit match_count;
$$;

create or replace function public.bump_knowledge_usage(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.knowledge_items set use_count = use_count + 1 where id = any(p_ids);
$$;

-- ---------------------------------------------------------------------
-- 10) یادگیری: بازخورد، نسخه‌های پرامپت و تنظیمات
-- ---------------------------------------------------------------------
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.tasks(id) on delete cascade,
  job_id     uuid references public.jobs(id) on delete set null,
  agent      text,
  rating     smallint not null check (rating between -1 and 1),
  comment    text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.agent_prompts (
  id         uuid primary key default gen_random_uuid(),
  agent      text not null,
  version    int  not null,
  content    text not null,
  is_active  boolean not null default false,
  source     text not null default 'human' check (source in ('default','human','ai')),
  rationale  text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (agent, version)
);

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 11) اعلان‌ها
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications(user_id, id desc);

-- ---------------------------------------------------------------------
-- 12) امنیت سطر (RLS)
--  همه‌ی نوشتن‌ها از طریق سرور (service role) با بررسی مجوز انجام می‌شود؛
--  کلاینت فقط اجازه‌ی خواندن دارد (برای Realtime و نمایش).
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.tasks           enable row level security;
alter table public.upgrades        enable row level security;
alter table public.jobs            enable row level security;
alter table public.job_data        enable row level security;
alter table public.provider_state  enable row level security;
alter table public.task_events     enable row level security;
alter table public.task_files      enable row level security;
alter table public.ai_messages     enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.feedback        enable row level security;
alter table public.agent_prompts   enable row level security;
alter table public.app_settings    enable row level security;
alter table public.notifications   enable row level security;

drop policy if exists "profiles: self or admin" on public.profiles;
create policy "profiles: self or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "tasks: own or admin" on public.tasks;
create policy "tasks: own or admin" on public.tasks for select to authenticated
  using (requester_id = auth.uid() or public.is_admin());

drop policy if exists "events: admin or requester-visible" on public.task_events;
create policy "events: admin or requester-visible" on public.task_events for select to authenticated
  using (
    public.is_admin()
    or (visibility = 'requester'
        and exists (select 1 from public.tasks t where t.id = task_events.task_id and t.requester_id = auth.uid()))
  );

drop policy if exists "files: admin or own task" on public.task_files;
create policy "files: admin or own task" on public.task_files for select to authenticated
  using (
    public.is_admin()
    or (context = 'request'
        and exists (select 1 from public.tasks t where t.id = task_files.task_id and t.requester_id = auth.uid()))
  );

drop policy if exists "notifications: own" on public.notifications;
create policy "notifications: own" on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin read: upgrades" on public.upgrades;
create policy "admin read: upgrades" on public.upgrades for select to authenticated using (public.is_admin());
drop policy if exists "admin read: jobs" on public.jobs;
create policy "admin read: jobs" on public.jobs for select to authenticated using (public.is_admin());
drop policy if exists "admin read: job_data" on public.job_data;
create policy "admin read: job_data" on public.job_data for select to authenticated using (public.is_admin());
drop policy if exists "admin read: provider_state" on public.provider_state;
create policy "admin read: provider_state" on public.provider_state for select to authenticated using (public.is_admin());
drop policy if exists "admin read: ai_messages" on public.ai_messages;
create policy "admin read: ai_messages" on public.ai_messages for select to authenticated using (public.is_admin());
drop policy if exists "admin read: knowledge" on public.knowledge_items;
create policy "admin read: knowledge" on public.knowledge_items for select to authenticated using (public.is_admin());
drop policy if exists "admin read: feedback" on public.feedback;
create policy "admin read: feedback" on public.feedback for select to authenticated using (public.is_admin());
drop policy if exists "admin read: prompts" on public.agent_prompts;
create policy "admin read: prompts" on public.agent_prompts for select to authenticated using (public.is_admin());
drop policy if exists "admin read: settings" on public.app_settings;
create policy "admin read: settings" on public.app_settings for select to authenticated using (public.is_admin());

-- توابع حساس فقط برای service role
revoke execute on function public.claim_job(text, text, int) from public, anon, authenticated;
revoke execute on function public.match_knowledge(extensions.vector, int, jsonb) from public, anon, authenticated;
revoke execute on function public.hybrid_search_knowledge(text, extensions.vector, int, jsonb) from public, anon, authenticated;
revoke execute on function public.bump_knowledge_usage(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_job(text, text, int) to service_role;
grant execute on function public.match_knowledge(extensions.vector, int, jsonb) to service_role;
grant execute on function public.hybrid_search_knowledge(text, extensions.vector, int, jsonb) to service_role;
grant execute on function public.bump_knowledge_usage(uuid[]) to service_role;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- ---------------------------------------------------------------------
-- 13) Storage: باکت خصوصی برای فایل‌های پیوست
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name)
values ('task-files', 'task-files')
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 52428800 where id = 'task-files'$q$;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public') then
    execute $q$update storage.buckets set public = false where id = 'task-files'$q$;
  end if;
end $$;

drop policy if exists "task-files: upload to own folder" on storage.objects;
create policy "task-files: upload to own folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_user()
  );

drop policy if exists "task-files: read own or admin" on storage.objects;
create policy "task-files: read own or admin" on storage.objects for select to authenticated
  using (
    bucket_id = 'task-files'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "task-files: delete own" on storage.objects;
create policy "task-files: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'task-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 14) Realtime — به‌روزرسانی زنده‌ی گراف، لاگ‌ها و صف
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['tasks','task_events','jobs','provider_state','notifications','upgrades'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 15) زمان‌بند (جایگزین Celery beat): pg_cron هر چند ثانیه ورکر Vercel را صدا می‌زند
--     این تابع را خود اپ از صفحه‌ی «تنظیمات» صدا می‌زند؛ لازم نیست دستی اجرا کنید.
-- ---------------------------------------------------------------------
create or replace function public.configure_scheduler(
  p_app_url text,
  p_secret text,
  p_interval text default '30 seconds'
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := rtrim(p_app_url, '/');
begin
  if v_url !~ '^https?://' then
    raise exception 'invalid app url';
  end if;

  perform cron.unschedule(j.jobname) from cron.job j
   where j.jobname in ('taskflow-tick', 'taskflow-daily', 'taskflow-cleanup');

  perform cron.schedule(
    'taskflow-tick',
    p_interval,
    format($cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization', %L),
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 8000)$cmd$,
      v_url || '/api/worker/tick', 'Bearer ' || p_secret)
  );

  perform cron.schedule(
    'taskflow-daily',
    '17 3 * * *',
    format($cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization', %L),
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 8000)$cmd$,
      v_url || '/api/cron/daily', 'Bearer ' || p_secret)
  );

  perform cron.schedule(
    'taskflow-cleanup',
    '41 2 * * *',
    $cmd$
      delete from cron.job_run_details where end_time < now() - interval '2 days';
      delete from public.task_events where kind in ('tool','thought') and created_at < now() - interval '120 days';
      delete from public.notifications where read_at is not null and read_at < now() - interval '60 days';
    $cmd$
  );

  return 'scheduled';
end $$;

create or replace function public.scheduler_status()
returns table (jobname text, schedule text, active boolean, last_status text, last_run timestamptz, last_message text)
language sql stable security definer set search_path = public as $$
  select j.jobname::text, j.schedule::text, j.active,
         d.status::text, d.start_time, left(d.return_message, 300)
  from cron.job j
  left join lateral (
    select r.status, r.start_time, r.return_message
    from cron.job_run_details r where r.jobid = j.jobid
    order by r.start_time desc limit 1
  ) d on true
  where j.jobname like 'taskflow-%';
$$;

create or replace function public.recent_http_responses(p_limit int default 5)
returns table (id bigint, status_code int, error_msg text, created timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.status_code, left(r.error_msg, 300), r.created
  from net._http_response r order by r.id desc limit p_limit;
$$;

revoke execute on function public.configure_scheduler(text, text, text) from public, anon, authenticated;
revoke execute on function public.scheduler_status() from public, anon, authenticated;
revoke execute on function public.recent_http_responses(int) from public, anon, authenticated;
grant execute on function public.configure_scheduler(text, text, text) to service_role;
grant execute on function public.scheduler_status() to service_role;
grant execute on function public.recent_http_responses(int) to service_role;

-- ---------------------------------------------------------------------
-- پایان. پس از اجرا باید پیام «Success. No rows returned» را ببینید.
-- ---------------------------------------------------------------------

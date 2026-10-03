-- =====================================================================
--  TaskFlow AI — یک اپ برای همه (چندکاربره)
--
--  • هر کاربر کلیدهای هوش مصنوعی و GitHub خودش را وصل می‌کند (جدول user_connections، رمزنگاری‌شده)
--  • هر تسک «مسئول» (assignee) دارد؛ هر کسی می‌تواند برای هر کسی تسک ثبت کند
--  • پروژه‌ها (کد و مستندات) به جای پایگاه دانش تکه‌تکه (pgvector) — فایل‌ها کامل در GitHub کاربر
--  • صف کارها برای همه‌ی کاربران مشترک است ولی محدودیت/مکث هر اتصال جداست
--
--  اجرای اول: داده‌های آزمایشی تسک‌ها، صف، لاگ‌ها و تنظیمات قبلی پاک می‌شوند (کاربران می‌مانند).
--  اجرای دوباره‌ی این فایل بی‌خطر است (ایدمپوتنت) و دیگر چیزی را پاک نمی‌کند.
--  محل اجرا: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) پاک‌سازی یک‌باره‌ی داده‌های آزمایشی (فقط وقتی ستون assignee_id هنوز وجود ندارد)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'assignee_id'
  ) then
    truncate table public.task_events, public.task_files, public.ai_messages, public.feedback,
                   public.agent_prompts, public.notifications, public.job_data, public.jobs,
                   public.tasks, public.upgrades
      restart identity cascade;
    delete from public.app_settings;
    alter sequence public.task_code_seq restart with 1;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) نقش‌ها و حالت اپ: owner (مالک اپ) / member؛ حالت ساده یا کامل
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = case when role in ('admin', 'owner') then 'owner' else 'member' end
 where role not in ('owner', 'member');
alter table public.profiles alter column role set default 'member';
alter table public.profiles add constraint profiles_role_check check (role in ('owner', 'member'));

alter table public.profiles add column if not exists mode text not null default 'simple';
alter table public.profiles drop constraint if exists profiles_mode_check;
alter table public.profiles add constraint profiles_mode_check check (mode in ('simple', 'full'));
update public.profiles set mode = 'full' where role = 'owner' and mode <> 'full';

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'owner' and p.status = 'active');
$$;

-- نام قدیمی (در policyهای قبلی و Storage استفاده شده)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;

grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 2) اتصال‌های هر کاربر: کلیدهای هوش مصنوعی و GitHub (رمزنگاری‌شده با AES-GCM در خود اپ)
--    فقط سرور (service role) به این جدول دسترسی دارد؛ کلاینت هیچ policy خواندنی ندارد.
-- ---------------------------------------------------------------------
create table if not exists public.user_connections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('ai', 'github')),
  provider    text not null,
  label       text not null default '',
  base_url    text,
  secret_enc  text not null,
  secret_hint text,
  config      jsonb not null default '{}',
  status      text not null default 'unchecked' check (status in ('unchecked', 'ok', 'error')),
  last_error  text,
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_connections_user on public.user_connections(user_id);
create unique index if not exists uq_connections_github on public.user_connections(user_id) where kind = 'github';

drop trigger if exists trg_connections_updated on public.user_connections;
create trigger trg_connections_updated before update on public.user_connections
  for each row execute function public.set_updated_at();

-- وضعیت لحظه‌ای هر اتصال (مکث خودکار هنگام رسیدن به سقف، مدل‌های مسدود) — برای نمایش زنده
create table if not exists public.connection_state (
  connection_id uuid primary key references public.user_connections(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  paused_until  timestamptz,
  pause_reason  text,
  manual_pause  boolean not null default false,
  models        jsonb not null default '{}',
  stats         jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);
create index if not exists idx_connection_state_user on public.connection_state(user_id);

-- تنظیمات شخصی هر کاربر (مدل هر مرحله، ایجنت‌ها، ورکفلوها، پرامپت پیش‌فرض و …)
create table if not exists public.user_settings (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- نسخه‌های پرامپت هر ایجنت برای هر کاربر جداست
alter table public.agent_prompts add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.agent_prompts drop constraint if exists agent_prompts_agent_version_key;
delete from public.agent_prompts where user_id is null;
alter table public.agent_prompts alter column user_id set not null;
create unique index if not exists uq_agent_prompts_user on public.agent_prompts(user_id, agent, version);

-- ---------------------------------------------------------------------
-- 3) پروژه‌ها: فایل‌های کامل (بدون تکه‌تکه کردن) در GitHub کاربر زیر projects/<slug>/
--    project_files فقط فهرست و نقشه‌ی فایل‌هاست (مسیر، اندازه، خلاصه، نمادها) نه محتوا.
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text not null default '',
  root_path     text not null,
  source        jsonb not null default '{}',
  status        text not null default 'ready' check (status in ('importing', 'indexing', 'ready', 'error')),
  status_detail text,
  file_count    int not null default 0,
  total_size    bigint not null default 0,
  indexed_at    timestamptz,
  knowledge_at  timestamptz,
  graph_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (owner_id, slug)
);

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table if not exists public.project_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  path       text not null,
  size       bigint not null default 0,
  sha        text,
  kind       text not null default 'other' check (kind in ('code', 'doc', 'data', 'asset', 'other')),
  summary    text,
  symbols    text[] not null default '{}',
  imports    text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (project_id, path)
);

-- ---------------------------------------------------------------------
-- 4) تسک‌ها: مسئول انجام (assignee)، پروژه‌ی مرتبط و وضعیت دستی «در حال انجام»
-- ---------------------------------------------------------------------
alter table public.tasks add column if not exists assignee_id uuid references public.profiles(id) on delete cascade;
update public.tasks set assignee_id = requester_id where assignee_id is null;
alter table public.tasks alter column assignee_id set not null;
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists idx_tasks_assignee on public.tasks(assignee_id, status);
create index if not exists idx_tasks_project on public.tasks(project_id);

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in (
  'pending_approval', 'returned', 'approved', 'in_progress',
  'prework_queued', 'prework_running', 'prework_done',
  'main_queued', 'main_running', 'main_done',
  'closure_pending', 'closure_rejected', 'closed', 'cancelled'));

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
    new.project_id := coalesce(new.project_id, v_root.project_id);
  end if;
  return new;
end $$;

-- منبع رویدادهای لاگ: «ai» برای همه‌ی مدل‌ها (هر ارائه‌دهنده) و «project» برای کارهای پروژه
alter table public.task_events drop constraint if exists task_events_source_check;
alter table public.task_events add constraint task_events_source_check check (source in
  ('system', 'user', 'ai', 'gemini', 'claude', 'github', 'graphify', 'knowledge', 'project'));
alter table public.task_events add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists idx_events_project on public.task_events(project_id, id desc);

-- ---------------------------------------------------------------------
-- 5) صف کارها: «خط» (lane) به جای ارائه‌دهنده‌ی سراسری؛ هر کار متعلق به یک کاربر و یک اتصال است
--    llm = کارهایی که داخل اپ با کلید کاربر اجرا می‌شوند | external = GitHub Actions | system
-- ---------------------------------------------------------------------
create table if not exists public.worker_lanes (
  lane        text primary key check (lane in ('llm', 'external', 'system')),
  max_running int not null default 6,
  per_owner   int not null default 1,
  paused      boolean not null default false,
  stats       jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);
insert into public.worker_lanes (lane, max_running, per_owner) values
  ('llm', 6, 1), ('external', 100, 3), ('system', 4, 2)
on conflict (lane) do nothing;

drop function if exists public.claim_job(text, text, int);
drop index if exists public.idx_jobs_claim;

alter table public.jobs add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.jobs add column if not exists connection_id uuid references public.user_connections(id) on delete set null;
alter table public.jobs add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.jobs add column if not exists lane text not null default 'llm';
alter table public.jobs drop constraint if exists jobs_provider_check;
alter table public.jobs drop column if exists provider;
alter table public.jobs drop constraint if exists jobs_lane_check;
alter table public.jobs add constraint jobs_lane_check check (lane in ('llm', 'external', 'system'));
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in
  ('prework', 'main', 'knowledge', 'graphify', 'upgrade', 'optimize', 'import', 'index'));

create index if not exists idx_jobs_lane  on public.jobs(lane, status, run_after, priority desc, created_at);
create index if not exists idx_jobs_owner on public.jobs(owner_id, lane, status);
create index if not exists idx_jobs_project on public.jobs(project_id);

-- جدول قدیمی وضعیت ارائه‌دهنده‌ها (Gemini/Claude سراسری) دیگر لازم نیست
drop table if exists public.provider_state;

-- برداشتن کار بعدی یک خط به صورت اتمیک:
--  • کار در حال اجرایی که قفلش آزاد/منقضی شده ادامه می‌یابد
--  • کار تازه فقط اگر سقف هم‌زمانی خط و سقف هر کاربر اجازه بدهد
--  • کارهای اتصالِ متوقف‌شده (سقف مصرف یا مکث دستی) کنار گذاشته می‌شوند
--  • ترتیب: اولویت، سپس کاری که زودتر از همه نوبت نگرفته (عدالت بین کاربران)
create or replace function public.claim_job(p_lane text, p_worker text, p_lease_seconds int default 70)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare
  v_lane    public.worker_lanes;
  v_job     public.jobs;
  v_running int;
begin
  perform pg_advisory_xact_lock(hashtext('claim:' || p_lane));

  select * into v_lane from public.worker_lanes where lane = p_lane;
  if v_lane.lane is null or v_lane.paused then return; end if;

  select count(*) into v_running from public.jobs where lane = p_lane and status = 'running';

  select j.* into v_job from public.jobs j
   where j.lane = p_lane
     and j.run_after <= now()
     and (
       (j.status = 'running' and (j.locked_until is null or j.locked_until < now()))
       or (
         j.status = 'queued'
         and v_running < v_lane.max_running
         and (select count(*) from public.jobs r
               where r.lane = p_lane and r.status = 'running'
                 and r.owner_id is not distinct from j.owner_id) < v_lane.per_owner
       )
     )
     and not exists (
       select 1 from public.connection_state c
        where c.connection_id = j.connection_id
          and (c.manual_pause or (c.paused_until is not null and c.paused_until > now()))
     )
   order by j.priority desc, coalesce(j.heartbeat_at, j.created_at)
   limit 1
   for update of j skip locked;

  if v_job.id is null then return; end if;

  update public.jobs set
    attempts     = case when status = 'running' and locked_by is not null then attempts + 1 else attempts end,
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

revoke execute on function public.claim_job(text, text, int) from public, anon, authenticated;
grant execute on function public.claim_job(text, text, int) to service_role;

-- ---------------------------------------------------------------------
-- 6) پایگاه دانش تکه‌تکه (pgvector) حذف می‌شود؛ دانش هر پروژه یک فایل KNOWLEDGE.md در GitHub است
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where t.typname = 'vector' and n.nspname = 'extensions') then
    execute 'drop function if exists public.match_knowledge(extensions.vector, int, jsonb)';
    execute 'drop function if exists public.hybrid_search_knowledge(text, extensions.vector, int, jsonb)';
  end if;
end $$;
drop function if exists public.bump_knowledge_usage(uuid[]);
drop table if exists public.knowledge_items;

-- ---------------------------------------------------------------------
-- 7) امنیت سطر (RLS): هر کاربر فقط داده‌ی خودش و تسک‌هایی که در آن‌ها طرف است را می‌بیند؛
--    مالک اپ همه را می‌بیند. نوشتن‌ها فقط از سمت سرور (service role).
-- ---------------------------------------------------------------------
alter table public.user_connections enable row level security;
alter table public.connection_state enable row level security;
alter table public.user_settings    enable row level security;
alter table public.projects         enable row level security;
alter table public.project_files    enable row level security;
alter table public.worker_lanes     enable row level security;

drop policy if exists "profiles: self or admin" on public.profiles;
drop policy if exists "profiles: self or owner" on public.profiles;
create policy "profiles: self or owner" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());

drop policy if exists "tasks: own or admin" on public.tasks;
drop policy if exists "tasks: participants or owner" on public.tasks;
create policy "tasks: participants or owner" on public.tasks for select to authenticated
  using (requester_id = auth.uid() or assignee_id = auth.uid() or public.is_owner());

drop policy if exists "events: admin or requester-visible" on public.task_events;
drop policy if exists "events: participants" on public.task_events;
create policy "events: participants" on public.task_events for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.tasks t where t.id = task_events.task_id and t.assignee_id = auth.uid())
    or exists (select 1 from public.projects p where p.id = task_events.project_id and p.owner_id = auth.uid())
    or (visibility = 'requester'
        and exists (select 1 from public.tasks t where t.id = task_events.task_id and t.requester_id = auth.uid()))
  );

drop policy if exists "files: admin or own task" on public.task_files;
drop policy if exists "files: participants" on public.task_files;
create policy "files: participants" on public.task_files for select to authenticated
  using (
    public.is_owner()
    or exists (select 1 from public.tasks t where t.id = task_files.task_id and t.assignee_id = auth.uid())
    or (context in ('request', 'output')
        and exists (select 1 from public.tasks t where t.id = task_files.task_id and t.requester_id = auth.uid()))
  );

drop policy if exists "admin read: jobs" on public.jobs;
drop policy if exists "jobs: own or owner" on public.jobs;
create policy "jobs: own or owner" on public.jobs for select to authenticated
  using (owner_id = auth.uid() or public.is_owner());

drop policy if exists "admin read: job_data" on public.job_data;
drop policy if exists "job_data: own or owner" on public.job_data;
create policy "job_data: own or owner" on public.job_data for select to authenticated
  using (public.is_owner() or exists (select 1 from public.jobs j where j.id = job_data.job_id and j.owner_id = auth.uid()));

drop policy if exists "admin read: ai_messages" on public.ai_messages;
drop policy if exists "ai_messages: assignee or owner" on public.ai_messages;
create policy "ai_messages: assignee or owner" on public.ai_messages for select to authenticated
  using (public.is_owner() or exists (select 1 from public.tasks t where t.id = ai_messages.task_id and t.assignee_id = auth.uid()));

drop policy if exists "admin read: feedback" on public.feedback;
drop policy if exists "feedback: own or owner" on public.feedback;
create policy "feedback: own or owner" on public.feedback for select to authenticated
  using (created_by = auth.uid() or public.is_owner());

drop policy if exists "admin read: prompts" on public.agent_prompts;
drop policy if exists "prompts: own or owner" on public.agent_prompts;
create policy "prompts: own or owner" on public.agent_prompts for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

drop policy if exists "admin read: settings" on public.app_settings;
drop policy if exists "app_settings: owner" on public.app_settings;
create policy "app_settings: owner" on public.app_settings for select to authenticated using (public.is_owner());

drop policy if exists "admin read: upgrades" on public.upgrades;
drop policy if exists "upgrades: owner" on public.upgrades;
create policy "upgrades: owner" on public.upgrades for select to authenticated using (public.is_owner());

drop policy if exists "user_settings: own" on public.user_settings;
create policy "user_settings: own" on public.user_settings for select to authenticated using (user_id = auth.uid());

drop policy if exists "connection_state: own or owner" on public.connection_state;
create policy "connection_state: own or owner" on public.connection_state for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

drop policy if exists "projects: own or owner" on public.projects;
create policy "projects: own or owner" on public.projects for select to authenticated
  using (owner_id = auth.uid() or public.is_owner());

drop policy if exists "project_files: own or owner" on public.project_files;
create policy "project_files: own or owner" on public.project_files for select to authenticated
  using (public.is_owner() or exists (select 1 from public.projects p where p.id = project_files.project_id and p.owner_id = auth.uid()));

drop policy if exists "worker_lanes: owner" on public.worker_lanes;
create policy "worker_lanes: owner" on public.worker_lanes for select to authenticated using (public.is_owner());

-- ---------------------------------------------------------------------
-- 8) Realtime: جدول وضعیت اتصال‌ها به جای provider_state
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['tasks', 'task_events', 'jobs', 'notifications', 'upgrades', 'connection_state'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- پایان. پس از اجرا باید پیام «Success. No rows returned» را ببینید.
-- ---------------------------------------------------------------------

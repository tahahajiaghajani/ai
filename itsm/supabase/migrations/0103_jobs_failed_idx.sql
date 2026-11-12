-- «کاریز» migration 0103_jobs_failed_idx — سرعت: نمایهٔ کارهای ناموفق پس‌زمینه برای خلاصهٔ کارهای کنسول‌ها
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0103_jobs_failed_idx — سرعت: نمایهٔ کارهای ناموفق پس‌زمینه برای خلاصهٔ کارهای کنسول‌ها
-- ---------------------------------------------------------------------------
create index if not exists sm_jobs_failed_idx on sm_jobs (org_id, done_at) where status = 'failed';

insert into sm_migrations (id) values ('0103_jobs_failed_idx') on conflict (id) do nothing;

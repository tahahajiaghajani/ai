-- «کاریز» migration 0106_jobs_hook_due — کارهای پس‌زمینه: پایان‌بندی هر کار ناتمام (وضعیت نهایی ردیف آن یا نوبت بعدی‌اش) تا انجام نشده، در نوبت‌های بعد دوباره امتحان می‌شود
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0106_jobs_hook_due — کارهای پس‌زمینه: پایان‌بندی هر کار ناتمام (وضعیت نهایی ردیف آن یا نوبت بعدی‌اش) تا انجام نشده، در نوبت‌های بعد دوباره امتحان می‌شود
-- ---------------------------------------------------------------------------
alter table sm_jobs add column if not exists hook_due text;
alter table sm_jobs add column if not exists hook_tries int not null default 0;
create index if not exists sm_jobs_hook_due_idx on sm_jobs (updated_at) where status = 'failed' and hook_due is not null;

insert into sm_migrations (id) values ('0106_jobs_hook_due') on conflict (id) do nothing;

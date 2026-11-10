-- «کاریز» migration 0052_ai_skills — مهارت‌های هوش مصنوعی: پیشنهادهای وابسته به رکورد
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

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

-- «ITSM» migration 0058_ai_agents — عامل‌های هوش مصنوعی: پیشنهادهای عامل‌ها، مسیر رسیدگی و نتیجهٔ هر ردیف
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

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

-- «کاریز» migration 0070_portal_surveys — درگاه سلف‌سرویس: پاسخ‌های نظرسنجی بی‌نام در انتظار ثبت دسته‌ای
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

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

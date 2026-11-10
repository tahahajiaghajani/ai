-- «کاریز» migration 0095_scale — مقیاس بانکی: جست‌وجوی سه‌حرفی (pg_trgm) و نمایه‌های BRIN جریان‌های افزایشی
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

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

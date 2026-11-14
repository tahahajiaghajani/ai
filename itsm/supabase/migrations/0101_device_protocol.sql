-- «کاریز» migration 0101_device_protocol — برنامه‌های ویندوز: پروتکل همگام‌سازی هر دستگاه، تا برنامه‌های قدیمی‌ای که سرور نمی‌پذیرد شمرده شوند
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0101_device_protocol — برنامه‌های ویندوز: پروتکل همگام‌سازی هر دستگاه، تا برنامه‌های قدیمی‌ای که سرور نمی‌پذیرد شمرده شوند
-- ---------------------------------------------------------------------------
alter table sm_devices add column if not exists sync_protocol integer;

insert into sm_migrations (id) values ('0101_device_protocol') on conflict (id) do nothing;

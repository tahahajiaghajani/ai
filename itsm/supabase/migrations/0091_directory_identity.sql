-- «ITSM» migration 0091_directory_identity — پیوند حساب‌ها با خود شیء فهرست کاربران (objectGUID)، نه فقط نام آن
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0091_directory_identity — پیوند حساب‌ها با خود شیء فهرست کاربران (objectGUID)، نه فقط نام آن
-- ---------------------------------------------------------------------------
alter table sm_directory_links add column if not exists object_id text;
create index if not exists sm_directory_links_object_idx on sm_directory_links (source_id, kind, object_id) where object_id is not null;

insert into sm_migrations (id) values ('0091_directory_identity') on conflict (id) do nothing;

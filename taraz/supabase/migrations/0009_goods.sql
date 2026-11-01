-- «تراز» migration 0009_goods — کالا، انبار و فاکتور
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0009_goods — کالا، انبار و فاکتور
-- ---------------------------------------------------------------------------
select 1;

insert into tz_migrations (id) values ('0009_goods') on conflict (id) do nothing;

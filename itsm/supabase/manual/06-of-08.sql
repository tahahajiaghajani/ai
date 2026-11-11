-- «کاریز» — پایگاه داده برای Supabase SQL Editor: بخش ۶ از ۸ (0006_engine_tables:20/30 … 0006_engine_tables:23/30)
-- بخش‌ها را به‌ترتیب، هر کدام یک بار، در یک snippet تازه بچسبانید و Run بزنید (docs/SETUP_FA.md بخش ۱-۵).
-- اجرای دوباره بی‌خطر است. خودکار ساخته می‌شود: npm run schema
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۰ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 20/30 (a0c3bc7de847)
-- purchase_order: سفارش‌های خرید
do $cols$
begin
  if to_regclass('sm_purchase_orders') is not null then
    alter table sm_purchase_orders add column if not exists workspace_id uuid;
    alter table sm_purchase_orders add column if not exists domain_id uuid;
    alter table sm_purchase_orders add column if not exists unit_id uuid;
    alter table sm_purchase_orders add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_orders add column if not exists created_by uuid;
    alter table sm_purchase_orders add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_orders add column if not exists updated_by uuid;
    alter table sm_purchase_orders add column if not exists rev bigint not null default 0;
    alter table sm_purchase_orders add column if not exists version integer not null default 1;
    alter table sm_purchase_orders add column if not exists deleted_at timestamptz;
    alter table sm_purchase_orders add column if not exists origin text;
    alter table sm_purchase_orders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_orders add column if not exists no integer;
    alter table sm_purchase_orders add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PO' || no::text else 'PO' || lpad(no::text, 6, '0') end) stored;
    alter table sm_purchase_orders add column if not exists title text;
    alter table sm_purchase_orders add column if not exists supplier_id uuid;
    alter table sm_purchase_orders add column if not exists requisition_id uuid;
    alter table sm_purchase_orders add column if not exists owner_id uuid;
    alter table sm_purchase_orders add column if not exists order_date date;
    alter table sm_purchase_orders add column if not exists expected_date date;
    alter table sm_purchase_orders add column if not exists delivery_stockroom_id uuid;
    alter table sm_purchase_orders add column if not exists cost_center_id uuid;
    alter table sm_purchase_orders add column if not exists currency text;
    alter table sm_purchase_orders add column if not exists fx_rate numeric;
    alter table sm_purchase_orders add column if not exists total numeric;
    alter table sm_purchase_orders add column if not exists received_at timestamptz;
    alter table sm_purchase_orders add column if not exists notes text;
    alter table sm_purchase_orders add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_purchase_orders (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PO' || no::text else 'PO' || lpad(no::text, 6, '0') end) stored,
  title text,
  supplier_id uuid,
  requisition_id uuid,
  owner_id uuid,
  order_date date,
  expected_date date,
  delivery_stockroom_id uuid,
  cost_center_id uuid,
  currency text,
  fx_rate numeric,
  total numeric,
  received_at timestamptz,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_purchase_orders' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_purchase_orders', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_purchase_orders', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_purchase_orders' and indexname like 'sm\_purchase\_orders\_search\_%' and indexname not in ('sm_purchase_orders_search_cae18f1d_trgm', 'sm_purchase_orders_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_orders_search_cae18f1d_trgm', 'sm_purchase_orders', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_purchase_orders_search_custom_trgm', 'sm_purchase_orders', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_purchase_orders_no_uk on sm_purchase_orders (org_id, no);
create index if not exists sm_purchase_orders_rev_idx on sm_purchase_orders (org_id, rev);
create index if not exists sm_purchase_orders_upd_idx on sm_purchase_orders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_orders_crt_idx on sm_purchase_orders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_orders_supplier_id_idx on sm_purchase_orders (org_id, supplier_id) where deleted_at is null;
create index if not exists sm_purchase_orders_state_idx on sm_purchase_orders (org_id, state) where deleted_at is null;
create index if not exists sm_purchase_orders_workspace_acc_idx on sm_purchase_orders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_purchase_orders_unit_acc_idx on sm_purchase_orders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_purchase_orders_domain_acc_idx on sm_purchase_orders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_purchase_orders_owner_id_idx on sm_purchase_orders (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_purchase_orders_sync on sm_purchase_orders;
create trigger sm_purchase_orders_sync before insert or update on sm_purchase_orders for each row execute function sm_sync_touch('purchase_order');
create or replace trigger sm_purchase_orders_demo after insert on sm_purchase_orders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_orders_demo_t after update or delete on sm_purchase_orders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_orders enable row level security;

-- purchase_order_line: سطرهای سفارش خرید
do $cols$
begin
  if to_regclass('sm_purchase_order_lines') is not null then
    alter table sm_purchase_order_lines add column if not exists workspace_id uuid;
    alter table sm_purchase_order_lines add column if not exists domain_id uuid;
    alter table sm_purchase_order_lines add column if not exists unit_id uuid;
    alter table sm_purchase_order_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_order_lines add column if not exists created_by uuid;
    alter table sm_purchase_order_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_order_lines add column if not exists updated_by uuid;
    alter table sm_purchase_order_lines add column if not exists rev bigint not null default 0;
    alter table sm_purchase_order_lines add column if not exists version integer not null default 1;
    alter table sm_purchase_order_lines add column if not exists deleted_at timestamptz;
    alter table sm_purchase_order_lines add column if not exists origin text;
    alter table sm_purchase_order_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_order_lines add column if not exists po_id uuid;
    alter table sm_purchase_order_lines add column if not exists line_no integer;
    alter table sm_purchase_order_lines add column if not exists model_id uuid;
    alter table sm_purchase_order_lines add column if not exists description text;
    alter table sm_purchase_order_lines add column if not exists quantity integer;
    alter table sm_purchase_order_lines add column if not exists received_qty integer;
    alter table sm_purchase_order_lines add column if not exists unit_price numeric;
    alter table sm_purchase_order_lines add column if not exists amount numeric;
    alter table sm_purchase_order_lines add column if not exists requisition_line_id uuid;
  end if;
end
$cols$;
create table if not exists sm_purchase_order_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  po_id uuid,
  line_no integer,
  model_id uuid,
  description text,
  quantity integer,
  received_qty integer,
  unit_price numeric,
  amount numeric,
  requisition_line_id uuid
);
create index if not exists sm_purchase_order_lines_rev_idx on sm_purchase_order_lines (org_id, rev);
create index if not exists sm_purchase_order_lines_upd_idx on sm_purchase_order_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_order_lines_crt_idx on sm_purchase_order_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_order_lines_po_id_idx on sm_purchase_order_lines (org_id, po_id) where deleted_at is null;
drop trigger if exists sm_purchase_order_lines_sync on sm_purchase_order_lines;
create trigger sm_purchase_order_lines_sync before insert or update on sm_purchase_order_lines for each row execute function sm_sync_touch('purchase_order_line');
create or replace trigger sm_purchase_order_lines_demo after insert on sm_purchase_order_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_order_lines_demo_t after update or delete on sm_purchase_order_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_order_lines enable row level security;

-- purchase_request: درخواست‌های خرید
do $cols$
begin
  if to_regclass('sm_purchase_requests') is not null then
    alter table sm_purchase_requests add column if not exists workspace_id uuid;
    alter table sm_purchase_requests add column if not exists domain_id uuid;
    alter table sm_purchase_requests add column if not exists unit_id uuid;
    alter table sm_purchase_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_requests add column if not exists created_by uuid;
    alter table sm_purchase_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_requests add column if not exists updated_by uuid;
    alter table sm_purchase_requests add column if not exists rev bigint not null default 0;
    alter table sm_purchase_requests add column if not exists version integer not null default 1;
    alter table sm_purchase_requests add column if not exists deleted_at timestamptz;
    alter table sm_purchase_requests add column if not exists origin text;
    alter table sm_purchase_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_requests add column if not exists no integer;
    alter table sm_purchase_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PUR' || no::text else 'PUR' || lpad(no::text, 7, '0') end) stored;
    alter table sm_purchase_requests add column if not exists short_description text;
    alter table sm_purchase_requests add column if not exists description text;
    alter table sm_purchase_requests add column if not exists state text;
    alter table sm_purchase_requests add column if not exists priority text;
    alter table sm_purchase_requests add column if not exists impact text;
    alter table sm_purchase_requests add column if not exists urgency text;
    alter table sm_purchase_requests add column if not exists category text;
    alter table sm_purchase_requests add column if not exists subcategory text;
    alter table sm_purchase_requests add column if not exists channel text;
    alter table sm_purchase_requests add column if not exists caller_id uuid;
    alter table sm_purchase_requests add column if not exists requested_for uuid;
    alter table sm_purchase_requests add column if not exists opened_by uuid;
    alter table sm_purchase_requests add column if not exists opened_at timestamptz;
    alter table sm_purchase_requests add column if not exists assignment_group_id uuid;
    alter table sm_purchase_requests add column if not exists assigned_to uuid;
    alter table sm_purchase_requests add column if not exists service_id uuid;
    alter table sm_purchase_requests add column if not exists offering_id uuid;
    alter table sm_purchase_requests add column if not exists ci_id uuid;
    alter table sm_purchase_requests add column if not exists location_id uuid;
    alter table sm_purchase_requests add column if not exists due_at timestamptz;
    alter table sm_purchase_requests add column if not exists resolved_at timestamptz;
    alter table sm_purchase_requests add column if not exists resolved_by uuid;
    alter table sm_purchase_requests add column if not exists closed_at timestamptz;
    alter table sm_purchase_requests add column if not exists closed_by uuid;
    alter table sm_purchase_requests add column if not exists close_code text;
    alter table sm_purchase_requests add column if not exists close_notes text;
    alter table sm_purchase_requests add column if not exists parent_id uuid;
    alter table sm_purchase_requests add column if not exists watch_list jsonb;
    alter table sm_purchase_requests add column if not exists approval text;
    alter table sm_purchase_requests add column if not exists escalation integer;
    alter table sm_purchase_requests add column if not exists reassignment_count integer;
    alter table sm_purchase_requests add column if not exists reopen_count integer;
    alter table sm_purchase_requests add column if not exists time_worked bigint;
    alter table sm_purchase_requests add column if not exists first_response_at timestamptz;
    alter table sm_purchase_requests add column if not exists active boolean not null default true;
    alter table sm_purchase_requests add column if not exists sla_due timestamptz;
    alter table sm_purchase_requests add column if not exists knowledge boolean not null default false;
    alter table sm_purchase_requests add column if not exists title text;
    alter table sm_purchase_requests add column if not exists department_id uuid;
    alter table sm_purchase_requests add column if not exists dept_service_id uuid;
    alter table sm_purchase_requests add column if not exists sensitive boolean not null default false;
    alter table sm_purchase_requests add column if not exists journey_id uuid;
    alter table sm_purchase_requests add column if not exists child_total integer;
    alter table sm_purchase_requests add column if not exists child_open integer;
    alter table sm_purchase_requests add column if not exists satisfaction integer;
    alter table sm_purchase_requests add column if not exists items text;
    alter table sm_purchase_requests add column if not exists amount numeric;
    alter table sm_purchase_requests add column if not exists currency text;
    alter table sm_purchase_requests add column if not exists supplier text;
    alter table sm_purchase_requests add column if not exists cost_center_id uuid;
    alter table sm_purchase_requests add column if not exists budget_line text;
    alter table sm_purchase_requests add column if not exists needed_by date;
    alter table sm_purchase_requests add column if not exists receiver_id uuid;
    alter table sm_purchase_requests add column if not exists po_number text;
    alter table sm_purchase_requests add column if not exists received_at timestamptz;
    alter table sm_purchase_requests add column if not exists receipt_notes text;
  end if;
end
$cols$;
create table if not exists sm_purchase_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'PUR' || no::text else 'PUR' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  title text,
  department_id uuid,
  dept_service_id uuid,
  sensitive boolean not null default false,
  journey_id uuid,
  child_total integer,
  child_open integer,
  satisfaction integer,
  items text,
  amount numeric,
  currency text,
  supplier text,
  cost_center_id uuid,
  budget_line text,
  needed_by date,
  receiver_id uuid,
  po_number text,
  received_at timestamptz,
  receipt_notes text,
  search_0aff9df4 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '') || ' ' || coalesce(po_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_purchase_requests' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_0aff9df4' loop
    execute format('alter table %I drop column if exists %I', 'sm_purchase_requests', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_purchase_requests', 'search_0aff9df4', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(supplier, '') || ' ' || coalesce(po_number, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_purchase_requests' and indexname like 'sm\_purchase\_requests\_search\_%' and indexname not in ('sm_purchase_requests_search_0aff9df4_trgm', 'sm_purchase_requests_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_requests_search_0aff9df4_trgm', 'sm_purchase_requests', 'search_0aff9df4', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_purchase_requests_search_custom_trgm', 'sm_purchase_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_purchase_requests_no_uk on sm_purchase_requests (org_id, no);
create index if not exists sm_purchase_requests_rev_idx on sm_purchase_requests (org_id, rev);
create index if not exists sm_purchase_requests_upd_idx on sm_purchase_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requests_crt_idx on sm_purchase_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requests_state_idx on sm_purchase_requests (org_id, state) where deleted_at is null;
create index if not exists sm_purchase_requests_assignment_group_id_idx on sm_purchase_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_purchase_requests_assigned_to_idx on sm_purchase_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_purchase_requests_department_id_idx on sm_purchase_requests (org_id, department_id) where deleted_at is null;
create index if not exists sm_purchase_requests_dept_service_id_idx on sm_purchase_requests (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_purchase_requests_receiver_id_idx on sm_purchase_requests (org_id, receiver_id) where deleted_at is null;
create index if not exists sm_purchase_requests_workspace_acc_idx on sm_purchase_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_purchase_requests_unit_acc_idx on sm_purchase_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_purchase_requests_domain_acc_idx on sm_purchase_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_purchase_requests_caller_id_idx on sm_purchase_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_purchase_requests_requested_for_idx on sm_purchase_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_purchase_requests_opened_by_idx on sm_purchase_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_purchase_requests_watch_list_gin on sm_purchase_requests using gin (watch_list);
create index if not exists sm_purchase_requests_open_grp_idx on sm_purchase_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_purchase_requests_opened_brin on sm_purchase_requests using brin (opened_at);
drop trigger if exists sm_purchase_requests_sync on sm_purchase_requests;
create trigger sm_purchase_requests_sync before insert or update on sm_purchase_requests for each row execute function sm_sync_touch('purchase_request');
create or replace trigger sm_purchase_requests_demo after insert on sm_purchase_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_requests_demo_t after update or delete on sm_purchase_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_requests enable row level security;

-- purchase_requisition: درخواست‌های خرید
do $cols$
begin
  if to_regclass('sm_purchase_requisitions') is not null then
    alter table sm_purchase_requisitions add column if not exists workspace_id uuid;
    alter table sm_purchase_requisitions add column if not exists domain_id uuid;
    alter table sm_purchase_requisitions add column if not exists unit_id uuid;
    alter table sm_purchase_requisitions add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_requisitions add column if not exists created_by uuid;
    alter table sm_purchase_requisitions add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_requisitions add column if not exists updated_by uuid;
    alter table sm_purchase_requisitions add column if not exists rev bigint not null default 0;
    alter table sm_purchase_requisitions add column if not exists version integer not null default 1;
    alter table sm_purchase_requisitions add column if not exists deleted_at timestamptz;
    alter table sm_purchase_requisitions add column if not exists origin text;
    alter table sm_purchase_requisitions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_requisitions add column if not exists no integer;
    alter table sm_purchase_requisitions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRQ' || no::text else 'PRQ' || lpad(no::text, 6, '0') end) stored;
    alter table sm_purchase_requisitions add column if not exists title text;
    alter table sm_purchase_requisitions add column if not exists requested_for uuid;
    alter table sm_purchase_requisitions add column if not exists needed_by date;
    alter table sm_purchase_requisitions add column if not exists cost_center_id uuid;
    alter table sm_purchase_requisitions add column if not exists supplier_id uuid;
    alter table sm_purchase_requisitions add column if not exists total numeric;
    alter table sm_purchase_requisitions add column if not exists approval text;
    alter table sm_purchase_requisitions add column if not exists source text;
    alter table sm_purchase_requisitions add column if not exists request_item_id uuid;
    alter table sm_purchase_requisitions add column if not exists stock_rule_id uuid;
    alter table sm_purchase_requisitions add column if not exists purchase_order_id uuid;
    alter table sm_purchase_requisitions add column if not exists justification text;
    alter table sm_purchase_requisitions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_purchase_requisitions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'PRQ' || no::text else 'PRQ' || lpad(no::text, 6, '0') end) stored,
  title text,
  requested_for uuid,
  needed_by date,
  cost_center_id uuid,
  supplier_id uuid,
  total numeric,
  approval text,
  source text,
  request_item_id uuid,
  stock_rule_id uuid,
  purchase_order_id uuid,
  justification text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_purchase_requisitions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_purchase_requisitions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_purchase_requisitions', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_purchase_requisitions' and indexname like 'sm\_purchase\_requisitions\_search\_%' and indexname not in ('sm_purchase_requisitions_search_cae18f1d_trgm', 'sm_purchase_requisitions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_purchase_requisitions_search_cae18f1d_trgm', 'sm_purchase_requisitions', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_purchase_requisitions_search_custom_trgm', 'sm_purchase_requisitions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_purchase_requisitions_no_uk on sm_purchase_requisitions (org_id, no);
create index if not exists sm_purchase_requisitions_rev_idx on sm_purchase_requisitions (org_id, rev);
create index if not exists sm_purchase_requisitions_upd_idx on sm_purchase_requisitions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisitions_crt_idx on sm_purchase_requisitions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisitions_state_idx on sm_purchase_requisitions (org_id, state) where deleted_at is null;
create index if not exists sm_purchase_requisitions_workspace_acc_idx on sm_purchase_requisitions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_purchase_requisitions_unit_acc_idx on sm_purchase_requisitions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_purchase_requisitions_domain_acc_idx on sm_purchase_requisitions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_purchase_requisitions_requested_for_idx on sm_purchase_requisitions (org_id, requested_for) where deleted_at is null;
drop trigger if exists sm_purchase_requisitions_sync on sm_purchase_requisitions;
create trigger sm_purchase_requisitions_sync before insert or update on sm_purchase_requisitions for each row execute function sm_sync_touch('purchase_requisition');
create or replace trigger sm_purchase_requisitions_demo after insert on sm_purchase_requisitions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_requisitions_demo_t after update or delete on sm_purchase_requisitions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_requisitions enable row level security;

-- purchase_requisition_line: اقلام درخواست خرید
do $cols$
begin
  if to_regclass('sm_purchase_requisition_lines') is not null then
    alter table sm_purchase_requisition_lines add column if not exists workspace_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists domain_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists unit_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_purchase_requisition_lines add column if not exists created_by uuid;
    alter table sm_purchase_requisition_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_purchase_requisition_lines add column if not exists updated_by uuid;
    alter table sm_purchase_requisition_lines add column if not exists rev bigint not null default 0;
    alter table sm_purchase_requisition_lines add column if not exists version integer not null default 1;
    alter table sm_purchase_requisition_lines add column if not exists deleted_at timestamptz;
    alter table sm_purchase_requisition_lines add column if not exists origin text;
    alter table sm_purchase_requisition_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_purchase_requisition_lines add column if not exists requisition_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists model_id uuid;
    alter table sm_purchase_requisition_lines add column if not exists description text;
    alter table sm_purchase_requisition_lines add column if not exists quantity integer;
    alter table sm_purchase_requisition_lines add column if not exists unit_price numeric;
    alter table sm_purchase_requisition_lines add column if not exists amount numeric;
  end if;
end
$cols$;
create table if not exists sm_purchase_requisition_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  requisition_id uuid,
  model_id uuid,
  description text,
  quantity integer,
  unit_price numeric,
  amount numeric
);
create index if not exists sm_purchase_requisition_lines_rev_idx on sm_purchase_requisition_lines (org_id, rev);
create index if not exists sm_purchase_requisition_lines_upd_idx on sm_purchase_requisition_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisition_lines_crt_idx on sm_purchase_requisition_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_purchase_requisition_lines_requisition_id_idx on sm_purchase_requisition_lines (org_id, requisition_id) where deleted_at is null;
drop trigger if exists sm_purchase_requisition_lines_sync on sm_purchase_requisition_lines;
create trigger sm_purchase_requisition_lines_sync before insert or update on sm_purchase_requisition_lines for each row execute function sm_sync_touch('purchase_requisition_line');
create or replace trigger sm_purchase_requisition_lines_demo after insert on sm_purchase_requisition_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_purchase_requisition_lines_demo_t after update or delete on sm_purchase_requisition_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_purchase_requisition_lines enable row level security;

-- raid_item: ریسک‌ها، مسئله‌ها و تصمیم‌ها
do $cols$
begin
  if to_regclass('sm_raid_items') is not null then
    alter table sm_raid_items add column if not exists workspace_id uuid;
    alter table sm_raid_items add column if not exists domain_id uuid;
    alter table sm_raid_items add column if not exists unit_id uuid;
    alter table sm_raid_items add column if not exists created_at timestamptz not null default now();
    alter table sm_raid_items add column if not exists created_by uuid;
    alter table sm_raid_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_raid_items add column if not exists updated_by uuid;
    alter table sm_raid_items add column if not exists rev bigint not null default 0;
    alter table sm_raid_items add column if not exists version integer not null default 1;
    alter table sm_raid_items add column if not exists deleted_at timestamptz;
    alter table sm_raid_items add column if not exists origin text;
    alter table sm_raid_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_raid_items add column if not exists no integer;
    alter table sm_raid_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RAID' || no::text else 'RAID' || lpad(no::text, 6, '0') end) stored;
    alter table sm_raid_items add column if not exists title text;
    alter table sm_raid_items add column if not exists kind text;
    alter table sm_raid_items add column if not exists project_id uuid;
    alter table sm_raid_items add column if not exists owner_id uuid;
    alter table sm_raid_items add column if not exists probability integer;
    alter table sm_raid_items add column if not exists impact integer;
    alter table sm_raid_items add column if not exists score integer;
    alter table sm_raid_items add column if not exists due_date date;
    alter table sm_raid_items add column if not exists description text;
    alter table sm_raid_items add column if not exists response text;
    alter table sm_raid_items add column if not exists ai_draft boolean not null default false;
    alter table sm_raid_items add column if not exists project_manager_id uuid;
    alter table sm_raid_items add column if not exists assignment_group_id uuid;
    alter table sm_raid_items add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_raid_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RAID' || no::text else 'RAID' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  project_id uuid,
  owner_id uuid,
  probability integer,
  impact integer,
  score integer,
  due_date date,
  description text,
  response text,
  ai_draft boolean not null default false,
  project_manager_id uuid,
  assignment_group_id uuid,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_raid_items' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_raid_items', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_raid_items', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_raid_items' and indexname like 'sm\_raid\_items\_search\_%' and indexname not in ('sm_raid_items_search_cae18f1d_trgm', 'sm_raid_items_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_raid_items_search_cae18f1d_trgm', 'sm_raid_items', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_raid_items_search_custom_trgm', 'sm_raid_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_raid_items_no_uk on sm_raid_items (org_id, no);
create index if not exists sm_raid_items_rev_idx on sm_raid_items (org_id, rev);
create index if not exists sm_raid_items_upd_idx on sm_raid_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_raid_items_crt_idx on sm_raid_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_raid_items_project_id_idx on sm_raid_items (org_id, project_id) where deleted_at is null;
create index if not exists sm_raid_items_state_idx on sm_raid_items (org_id, state) where deleted_at is null;
create index if not exists sm_raid_items_workspace_acc_idx on sm_raid_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_raid_items_unit_acc_idx on sm_raid_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_raid_items_domain_acc_idx on sm_raid_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_raid_items_owner_id_idx on sm_raid_items (org_id, owner_id) where deleted_at is null;
create index if not exists sm_raid_items_project_manager_id_idx on sm_raid_items (org_id, project_manager_id) where deleted_at is null;
drop trigger if exists sm_raid_items_sync on sm_raid_items;
create trigger sm_raid_items_sync before insert or update on sm_raid_items for each row execute function sm_sync_touch('raid_item');
create or replace trigger sm_raid_items_demo after insert on sm_raid_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_raid_items_demo_t after update or delete on sm_raid_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_raid_items enable row level security;

-- release: انتشارها
do $cols$
begin
  if to_regclass('sm_releases') is not null then
    alter table sm_releases add column if not exists workspace_id uuid;
    alter table sm_releases add column if not exists domain_id uuid;
    alter table sm_releases add column if not exists unit_id uuid;
    alter table sm_releases add column if not exists created_at timestamptz not null default now();
    alter table sm_releases add column if not exists created_by uuid;
    alter table sm_releases add column if not exists updated_at timestamptz not null default now();
    alter table sm_releases add column if not exists updated_by uuid;
    alter table sm_releases add column if not exists rev bigint not null default 0;
    alter table sm_releases add column if not exists version integer not null default 1;
    alter table sm_releases add column if not exists deleted_at timestamptz;
    alter table sm_releases add column if not exists origin text;
    alter table sm_releases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_releases add column if not exists no integer;
    alter table sm_releases add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REL' || no::text else 'REL' || lpad(no::text, 7, '0') end) stored;
    alter table sm_releases add column if not exists short_description text;
    alter table sm_releases add column if not exists description text;
    alter table sm_releases add column if not exists state text;
    alter table sm_releases add column if not exists priority text;
    alter table sm_releases add column if not exists impact text;
    alter table sm_releases add column if not exists urgency text;
    alter table sm_releases add column if not exists category text;
    alter table sm_releases add column if not exists subcategory text;
    alter table sm_releases add column if not exists channel text;
    alter table sm_releases add column if not exists caller_id uuid;
    alter table sm_releases add column if not exists requested_for uuid;
    alter table sm_releases add column if not exists opened_by uuid;
    alter table sm_releases add column if not exists opened_at timestamptz;
    alter table sm_releases add column if not exists assignment_group_id uuid;
    alter table sm_releases add column if not exists assigned_to uuid;
    alter table sm_releases add column if not exists service_id uuid;
    alter table sm_releases add column if not exists offering_id uuid;
    alter table sm_releases add column if not exists ci_id uuid;
    alter table sm_releases add column if not exists location_id uuid;
    alter table sm_releases add column if not exists due_at timestamptz;
    alter table sm_releases add column if not exists resolved_at timestamptz;
    alter table sm_releases add column if not exists resolved_by uuid;
    alter table sm_releases add column if not exists closed_at timestamptz;
    alter table sm_releases add column if not exists closed_by uuid;
    alter table sm_releases add column if not exists close_code text;
    alter table sm_releases add column if not exists close_notes text;
    alter table sm_releases add column if not exists parent_id uuid;
    alter table sm_releases add column if not exists watch_list jsonb;
    alter table sm_releases add column if not exists approval text;
    alter table sm_releases add column if not exists escalation integer;
    alter table sm_releases add column if not exists reassignment_count integer;
    alter table sm_releases add column if not exists reopen_count integer;
    alter table sm_releases add column if not exists time_worked bigint;
    alter table sm_releases add column if not exists first_response_at timestamptz;
    alter table sm_releases add column if not exists active boolean not null default true;
    alter table sm_releases add column if not exists sla_due timestamptz;
    alter table sm_releases add column if not exists knowledge boolean not null default false;
    alter table sm_releases add column if not exists version_name text;
    alter table sm_releases add column if not exists type text;
    alter table sm_releases add column if not exists template_id uuid;
    alter table sm_releases add column if not exists release_manager_id uuid;
    alter table sm_releases add column if not exists parent_release_id uuid;
    alter table sm_releases add column if not exists project_id uuid;
    alter table sm_releases add column if not exists stakeholders jsonb;
    alter table sm_releases add column if not exists affected_cis jsonb;
    alter table sm_releases add column if not exists affected_services jsonb;
    alter table sm_releases add column if not exists impacted_services jsonb;
    alter table sm_releases add column if not exists known_errors_accepted jsonb;
    alter table sm_releases add column if not exists changes_total integer;
    alter table sm_releases add column if not exists changes_open integer;
    alter table sm_releases add column if not exists problems_fixed integer;
    alter table sm_releases add column if not exists planned_start timestamptz;
    alter table sm_releases add column if not exists planned_end timestamptz;
    alter table sm_releases add column if not exists readiness_target_at timestamptz;
    alter table sm_releases add column if not exists window_id uuid;
    alter table sm_releases add column if not exists actual_start timestamptz;
    alter table sm_releases add column if not exists actual_end timestamptz;
    alter table sm_releases add column if not exists deployed_at timestamptz;
    alter table sm_releases add column if not exists released_at timestamptz;
    alter table sm_releases add column if not exists els_days integer;
    alter table sm_releases add column if not exists els_end_at timestamptz;
    alter table sm_releases add column if not exists hold_reason text;
    alter table sm_releases add column if not exists frozen_until timestamptz;
    alter table sm_releases add column if not exists build_plan text;
    alter table sm_releases add column if not exists test_plan text;
    alter table sm_releases add column if not exists deployment_plan text;
    alter table sm_releases add column if not exists rollback_plan text;
    alter table sm_releases add column if not exists communication_plan text;
    alter table sm_releases add column if not exists release_notes text;
    alter table sm_releases add column if not exists go_no_go text;
    alter table sm_releases add column if not exists go_no_go_at timestamptz;
    alter table sm_releases add column if not exists go_conditions text;
    alter table sm_releases add column if not exists checks_total integer;
    alter table sm_releases add column if not exists checks_failed integer;
    alter table sm_releases add column if not exists checks_pending integer;
    alter table sm_releases add column if not exists readiness_pct integer;
    alter table sm_releases add column if not exists checks_run_at timestamptz;
    alter table sm_releases add column if not exists risk_score integer;
    alter table sm_releases add column if not exists risk_band text;
    alter table sm_releases add column if not exists risk_factors jsonb;
    alter table sm_releases add column if not exists lessons text;
    alter table sm_releases add column if not exists els_incidents integer;
    alter table sm_releases add column if not exists rolled_back boolean not null default false;
    alter table sm_releases add column if not exists on_schedule boolean not null default false;
    alter table sm_releases add column if not exists state_before_hold text;
  end if;
end
$cols$;
create table if not exists sm_releases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REL' || no::text else 'REL' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  version_name text,
  type text,
  template_id uuid,
  release_manager_id uuid,
  parent_release_id uuid,
  project_id uuid,
  stakeholders jsonb,
  affected_cis jsonb,
  affected_services jsonb,
  impacted_services jsonb,
  known_errors_accepted jsonb,
  changes_total integer,
  changes_open integer,
  problems_fixed integer,
  planned_start timestamptz,
  planned_end timestamptz,
  readiness_target_at timestamptz,
  window_id uuid,
  actual_start timestamptz,
  actual_end timestamptz,
  deployed_at timestamptz,
  released_at timestamptz,
  els_days integer,
  els_end_at timestamptz,
  hold_reason text,
  frozen_until timestamptz,
  build_plan text,
  test_plan text,
  deployment_plan text,
  rollback_plan text,
  communication_plan text,
  release_notes text,
  go_no_go text,
  go_no_go_at timestamptz,
  go_conditions text,
  checks_total integer,
  checks_failed integer,
  checks_pending integer,
  readiness_pct integer,
  checks_run_at timestamptz,
  risk_score integer,
  risk_band text,
  risk_factors jsonb,
  lessons text,
  els_incidents integer,
  rolled_back boolean not null default false,
  on_schedule boolean not null default false,
  state_before_hold text,
  search_9202f273 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(version_name, '') || ' ' || coalesce(release_notes, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_releases' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_9202f273' loop
    execute format('alter table %I drop column if exists %I', 'sm_releases', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_releases', 'search_9202f273', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, '') || ' ' || coalesce(version_name, '') || ' ' || coalesce(release_notes, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_releases' and indexname like 'sm\_releases\_search\_%' and indexname not in ('sm_releases_search_9202f273_trgm', 'sm_releases_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_releases_search_9202f273_trgm', 'sm_releases', 'search_9202f273', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_releases_search_custom_trgm', 'sm_releases', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_releases_no_uk on sm_releases (org_id, no);
create index if not exists sm_releases_rev_idx on sm_releases (org_id, rev);
create index if not exists sm_releases_upd_idx on sm_releases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_releases_crt_idx on sm_releases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_releases_state_idx on sm_releases (org_id, state) where deleted_at is null;
create index if not exists sm_releases_assignment_group_id_idx on sm_releases (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_releases_assigned_to_idx on sm_releases (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_releases_type_idx on sm_releases (org_id, type) where deleted_at is null;
create index if not exists sm_releases_release_manager_id_idx on sm_releases (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_releases_parent_release_id_idx on sm_releases (org_id, parent_release_id) where deleted_at is null;
create index if not exists sm_releases_project_id_idx on sm_releases (org_id, project_id) where deleted_at is null;
create index if not exists sm_releases_planned_start_idx on sm_releases (org_id, planned_start) where deleted_at is null;
create index if not exists sm_releases_planned_end_idx on sm_releases (org_id, planned_end) where deleted_at is null;
create index if not exists sm_releases_workspace_acc_idx on sm_releases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_releases_unit_acc_idx on sm_releases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_releases_domain_acc_idx on sm_releases (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_releases_caller_id_idx on sm_releases (org_id, caller_id) where deleted_at is null;
create index if not exists sm_releases_requested_for_idx on sm_releases (org_id, requested_for) where deleted_at is null;
create index if not exists sm_releases_opened_by_idx on sm_releases (org_id, opened_by) where deleted_at is null;
create index if not exists sm_releases_watch_list_gin on sm_releases using gin (watch_list);
create index if not exists sm_releases_open_grp_idx on sm_releases (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_releases_opened_brin on sm_releases using brin (opened_at);
drop trigger if exists sm_releases_sync on sm_releases;
create trigger sm_releases_sync before insert or update on sm_releases for each row execute function sm_sync_touch('release');
create or replace trigger sm_releases_demo after insert on sm_releases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_releases_demo_t after update or delete on sm_releases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_releases enable row level security;

-- release_check: بررسی‌های آمادگی
do $cols$
begin
  if to_regclass('sm_release_checks') is not null then
    alter table sm_release_checks add column if not exists workspace_id uuid;
    alter table sm_release_checks add column if not exists domain_id uuid;
    alter table sm_release_checks add column if not exists unit_id uuid;
    alter table sm_release_checks add column if not exists created_at timestamptz not null default now();
    alter table sm_release_checks add column if not exists created_by uuid;
    alter table sm_release_checks add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_checks add column if not exists updated_by uuid;
    alter table sm_release_checks add column if not exists rev bigint not null default 0;
    alter table sm_release_checks add column if not exists version integer not null default 1;
    alter table sm_release_checks add column if not exists deleted_at timestamptz;
    alter table sm_release_checks add column if not exists origin text;
    alter table sm_release_checks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_checks add column if not exists name text;
    alter table sm_release_checks add column if not exists key text;
    alter table sm_release_checks add column if not exists rule text;
    alter table sm_release_checks add column if not exists phase text;
    alter table sm_release_checks add column if not exists blocking boolean not null default true;
    alter table sm_release_checks add column if not exists condition jsonb;
    alter table sm_release_checks add column if not exists types jsonb;
    alter table sm_release_checks add column if not exists sort_order integer;
    alter table sm_release_checks add column if not exists active boolean not null default true;
    alter table sm_release_checks add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_release_checks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  key text,
  rule text,
  phase text,
  blocking boolean not null default true,
  condition jsonb,
  types jsonb,
  sort_order integer,
  active boolean not null default true,
  description text
);
create index if not exists sm_release_checks_rev_idx on sm_release_checks (org_id, rev);
create index if not exists sm_release_checks_upd_idx on sm_release_checks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_checks_crt_idx on sm_release_checks (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_release_checks_key_uk on sm_release_checks (org_id, key) where deleted_at is null;
drop trigger if exists sm_release_checks_sync on sm_release_checks;
create trigger sm_release_checks_sync before insert or update on sm_release_checks for each row execute function sm_sync_touch('release_check');
create or replace trigger sm_release_checks_demo after insert on sm_release_checks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_checks_demo_t after update or delete on sm_release_checks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_checks enable row level security;

-- release_check_result: نتیجه‌های بررسی آمادگی
do $cols$
begin
  if to_regclass('sm_release_check_results') is not null then
    alter table sm_release_check_results add column if not exists workspace_id uuid;
    alter table sm_release_check_results add column if not exists domain_id uuid;
    alter table sm_release_check_results add column if not exists unit_id uuid;
    alter table sm_release_check_results add column if not exists created_at timestamptz not null default now();
    alter table sm_release_check_results add column if not exists created_by uuid;
    alter table sm_release_check_results add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_check_results add column if not exists updated_by uuid;
    alter table sm_release_check_results add column if not exists rev bigint not null default 0;
    alter table sm_release_check_results add column if not exists version integer not null default 1;
    alter table sm_release_check_results add column if not exists deleted_at timestamptz;
    alter table sm_release_check_results add column if not exists origin text;
    alter table sm_release_check_results add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_check_results add column if not exists release_id uuid;
    alter table sm_release_check_results add column if not exists check_id uuid;
    alter table sm_release_check_results add column if not exists name text;
    alter table sm_release_check_results add column if not exists rule text;
    alter table sm_release_check_results add column if not exists phase text;
    alter table sm_release_check_results add column if not exists blocking boolean not null default true;
    alter table sm_release_check_results add column if not exists status text;
    alter table sm_release_check_results add column if not exists message text;
    alter table sm_release_check_results add column if not exists evidence text;
    alter table sm_release_check_results add column if not exists evaluated_at timestamptz;
    alter table sm_release_check_results add column if not exists checked_by uuid;
    alter table sm_release_check_results add column if not exists waiver_reason text;
    alter table sm_release_check_results add column if not exists waived_by uuid;
    alter table sm_release_check_results add column if not exists assignment_group_id uuid;
    alter table sm_release_check_results add column if not exists assigned_to uuid;
    alter table sm_release_check_results add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_check_results (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  release_id uuid,
  check_id uuid,
  name text,
  rule text,
  phase text,
  blocking boolean not null default true,
  status text,
  message text,
  evidence text,
  evaluated_at timestamptz,
  checked_by uuid,
  waiver_reason text,
  waived_by uuid,
  assignment_group_id uuid,
  assigned_to uuid,
  release_manager_id uuid
);
create index if not exists sm_release_check_results_rev_idx on sm_release_check_results (org_id, rev);
create index if not exists sm_release_check_results_upd_idx on sm_release_check_results (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_check_results_crt_idx on sm_release_check_results (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_check_results_release_id_idx on sm_release_check_results (org_id, release_id) where deleted_at is null;
create unique index if not exists sm_release_check_results_release_id_check_id_uk on sm_release_check_results (org_id, release_id, check_id) where deleted_at is null;
create index if not exists sm_release_check_results_workspace_acc_idx on sm_release_check_results (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_check_results_unit_acc_idx on sm_release_check_results (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_check_results_domain_acc_idx on sm_release_check_results (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_check_results_release_manager_id_idx on sm_release_check_results (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_check_results_assigned_to_idx on sm_release_check_results (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_release_check_results_sync on sm_release_check_results;
create trigger sm_release_check_results_sync before insert or update on sm_release_check_results for each row execute function sm_sync_touch('release_check_result');
create or replace trigger sm_release_check_results_demo after insert on sm_release_check_results for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_check_results_demo_t after update or delete on sm_release_check_results for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_check_results enable row level security;

-- release_config: تنظیمات انتشار
do $cols$
begin
  if to_regclass('sm_release_configs') is not null then
    alter table sm_release_configs add column if not exists workspace_id uuid;
    alter table sm_release_configs add column if not exists domain_id uuid;
    alter table sm_release_configs add column if not exists unit_id uuid;
    alter table sm_release_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_release_configs add column if not exists created_by uuid;
    alter table sm_release_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_configs add column if not exists updated_by uuid;
    alter table sm_release_configs add column if not exists rev bigint not null default 0;
    alter table sm_release_configs add column if not exists version integer not null default 1;
    alter table sm_release_configs add column if not exists deleted_at timestamptz;
    alter table sm_release_configs add column if not exists origin text;
    alter table sm_release_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_configs add column if not exists name text;
    alter table sm_release_configs add column if not exists config_key text;
    alter table sm_release_configs add column if not exists els_days integer;
    alter table sm_release_configs add column if not exists failure_window_hours integer;
    alter table sm_release_configs add column if not exists auto_advance boolean not null default true;
    alter table sm_release_configs add column if not exists release_on_production boolean not null default true;
    alter table sm_release_configs add column if not exists update_cmdb_versions boolean not null default true;
    alter table sm_release_configs add column if not exists tag_els_incidents boolean not null default true;
    alter table sm_release_configs add column if not exists default_change_template_id uuid;
    alter table sm_release_configs add column if not exists dora_days integer;
    alter table sm_release_configs add column if not exists dora_definitions jsonb;
    alter table sm_release_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_release_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  els_days integer,
  failure_window_hours integer,
  auto_advance boolean not null default true,
  release_on_production boolean not null default true,
  update_cmdb_versions boolean not null default true,
  tag_els_incidents boolean not null default true,
  default_change_template_id uuid,
  dora_days integer,
  dora_definitions jsonb,
  seeded integer
);
create index if not exists sm_release_configs_rev_idx on sm_release_configs (org_id, rev);
create index if not exists sm_release_configs_upd_idx on sm_release_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_configs_crt_idx on sm_release_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_release_configs_config_key_uk on sm_release_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_release_configs_sync on sm_release_configs;
create trigger sm_release_configs_sync before insert or update on sm_release_configs for each row execute function sm_sync_touch('release_config');
create or replace trigger sm_release_configs_demo after insert on sm_release_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_configs_demo_t after update or delete on sm_release_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_configs enable row level security;

-- release_decision: تصمیم‌های اجرا
do $cols$
begin
  if to_regclass('sm_release_decisions') is not null then
    alter table sm_release_decisions add column if not exists workspace_id uuid;
    alter table sm_release_decisions add column if not exists domain_id uuid;
    alter table sm_release_decisions add column if not exists unit_id uuid;
    alter table sm_release_decisions add column if not exists created_at timestamptz not null default now();
    alter table sm_release_decisions add column if not exists created_by uuid;
    alter table sm_release_decisions add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_decisions add column if not exists updated_by uuid;
    alter table sm_release_decisions add column if not exists rev bigint not null default 0;
    alter table sm_release_decisions add column if not exists version integer not null default 1;
    alter table sm_release_decisions add column if not exists deleted_at timestamptz;
    alter table sm_release_decisions add column if not exists origin text;
    alter table sm_release_decisions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_decisions add column if not exists release_id uuid;
    alter table sm_release_decisions add column if not exists decision text;
    alter table sm_release_decisions add column if not exists conditions text;
    alter table sm_release_decisions add column if not exists rationale text;
    alter table sm_release_decisions add column if not exists decided_by uuid;
    alter table sm_release_decisions add column if not exists decided_at timestamptz;
    alter table sm_release_decisions add column if not exists via text;
    alter table sm_release_decisions add column if not exists snapshot jsonb;
    alter table sm_release_decisions add column if not exists assignment_group_id uuid;
    alter table sm_release_decisions add column if not exists assigned_to uuid;
    alter table sm_release_decisions add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_decisions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  release_id uuid,
  decision text,
  conditions text,
  rationale text,
  decided_by uuid,
  decided_at timestamptz,
  via text,
  snapshot jsonb,
  assignment_group_id uuid,
  assigned_to uuid,
  release_manager_id uuid
);
create index if not exists sm_release_decisions_rev_idx on sm_release_decisions (org_id, rev);
create index if not exists sm_release_decisions_upd_idx on sm_release_decisions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_decisions_crt_idx on sm_release_decisions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_decisions_release_id_idx on sm_release_decisions (org_id, release_id) where deleted_at is null;
create index if not exists sm_release_decisions_workspace_acc_idx on sm_release_decisions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_decisions_unit_acc_idx on sm_release_decisions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_decisions_domain_acc_idx on sm_release_decisions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_decisions_release_manager_id_idx on sm_release_decisions (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_decisions_assigned_to_idx on sm_release_decisions (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_release_decisions_sync on sm_release_decisions;
create trigger sm_release_decisions_sync before insert or update on sm_release_decisions for each row execute function sm_sync_touch('release_decision');
create or replace trigger sm_release_decisions_demo after insert on sm_release_decisions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_decisions_demo_t after update or delete on sm_release_decisions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_decisions enable row level security;

-- release_environment: محیط‌ها
do $cols$
begin
  if to_regclass('sm_release_environments') is not null then
    alter table sm_release_environments add column if not exists workspace_id uuid;
    alter table sm_release_environments add column if not exists domain_id uuid;
    alter table sm_release_environments add column if not exists unit_id uuid;
    alter table sm_release_environments add column if not exists created_at timestamptz not null default now();
    alter table sm_release_environments add column if not exists created_by uuid;
    alter table sm_release_environments add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_environments add column if not exists updated_by uuid;
    alter table sm_release_environments add column if not exists rev bigint not null default 0;
    alter table sm_release_environments add column if not exists version integer not null default 1;
    alter table sm_release_environments add column if not exists deleted_at timestamptz;
    alter table sm_release_environments add column if not exists origin text;
    alter table sm_release_environments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_environments add column if not exists name text;
    alter table sm_release_environments add column if not exists key text;
    alter table sm_release_environments add column if not exists kind text;
    alter table sm_release_environments add column if not exists aliases jsonb;
    alter table sm_release_environments add column if not exists protection text;
    alter table sm_release_environments add column if not exists sort_order integer;
    alter table sm_release_environments add column if not exists allowed_data jsonb;
    alter table sm_release_environments add column if not exists owner_id uuid;
    alter table sm_release_environments add column if not exists assignment_group_id uuid;
    alter table sm_release_environments add column if not exists ci_id uuid;
    alter table sm_release_environments add column if not exists bookable boolean not null default false;
    alter table sm_release_environments add column if not exists color text;
    alter table sm_release_environments add column if not exists active boolean not null default true;
    alter table sm_release_environments add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_release_environments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  key text,
  kind text,
  aliases jsonb,
  protection text,
  sort_order integer,
  allowed_data jsonb,
  owner_id uuid,
  assignment_group_id uuid,
  ci_id uuid,
  bookable boolean not null default false,
  color text,
  active boolean not null default true,
  description text
);
create index if not exists sm_release_environments_rev_idx on sm_release_environments (org_id, rev);
create index if not exists sm_release_environments_upd_idx on sm_release_environments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_environments_crt_idx on sm_release_environments (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_release_environments_key_uk on sm_release_environments (org_id, key) where deleted_at is null;
drop trigger if exists sm_release_environments_sync on sm_release_environments;
create trigger sm_release_environments_sync before insert or update on sm_release_environments for each row execute function sm_sync_touch('release_environment');
create or replace trigger sm_release_environments_demo after insert on sm_release_environments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_environments_demo_t after update or delete on sm_release_environments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_environments enable row level security;

-- release_note: یادداشت‌های انتشار
do $cols$
begin
  if to_regclass('sm_release_notes') is not null then
    alter table sm_release_notes add column if not exists workspace_id uuid;
    alter table sm_release_notes add column if not exists domain_id uuid;
    alter table sm_release_notes add column if not exists unit_id uuid;
    alter table sm_release_notes add column if not exists created_at timestamptz not null default now();
    alter table sm_release_notes add column if not exists created_by uuid;
    alter table sm_release_notes add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_notes add column if not exists updated_by uuid;
    alter table sm_release_notes add column if not exists rev bigint not null default 0;
    alter table sm_release_notes add column if not exists version integer not null default 1;
    alter table sm_release_notes add column if not exists deleted_at timestamptz;
    alter table sm_release_notes add column if not exists origin text;
    alter table sm_release_notes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_notes add column if not exists release_id uuid;
    alter table sm_release_notes add column if not exists title text;
    alter table sm_release_notes add column if not exists audience text;
    alter table sm_release_notes add column if not exists language text;
    alter table sm_release_notes add column if not exists state text;
    alter table sm_release_notes add column if not exists body text;
    alter table sm_release_notes add column if not exists sources jsonb;
    alter table sm_release_notes add column if not exists ai_generated boolean not null default false;
    alter table sm_release_notes add column if not exists published_at timestamptz;
    alter table sm_release_notes add column if not exists published_by uuid;
    alter table sm_release_notes add column if not exists audience_users jsonb;
    alter table sm_release_notes add column if not exists assignment_group_id uuid;
    alter table sm_release_notes add column if not exists assigned_to uuid;
    alter table sm_release_notes add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_notes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  release_id uuid,
  title text,
  audience text,
  language text,
  state text,
  body text,
  sources jsonb,
  ai_generated boolean not null default false,
  published_at timestamptz,
  published_by uuid,
  audience_users jsonb,
  assignment_group_id uuid,
  assigned_to uuid,
  release_manager_id uuid
);
create index if not exists sm_release_notes_rev_idx on sm_release_notes (org_id, rev);
create index if not exists sm_release_notes_upd_idx on sm_release_notes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_notes_crt_idx on sm_release_notes (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_notes_release_id_idx on sm_release_notes (org_id, release_id) where deleted_at is null;
create index if not exists sm_release_notes_workspace_acc_idx on sm_release_notes (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_notes_unit_acc_idx on sm_release_notes (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_notes_domain_acc_idx on sm_release_notes (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_notes_release_manager_id_idx on sm_release_notes (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_notes_assigned_to_idx on sm_release_notes (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_release_notes_sync on sm_release_notes;
create trigger sm_release_notes_sync before insert or update on sm_release_notes for each row execute function sm_sync_touch('release_note');
create or replace trigger sm_release_notes_demo after insert on sm_release_notes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_notes_demo_t after update or delete on sm_release_notes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_notes enable row level security;

-- release_policy: خط‌مشی‌های انتشار
do $cols$
begin
  if to_regclass('sm_release_policies') is not null then
    alter table sm_release_policies add column if not exists workspace_id uuid;
    alter table sm_release_policies add column if not exists domain_id uuid;
    alter table sm_release_policies add column if not exists unit_id uuid;
    alter table sm_release_policies add column if not exists created_at timestamptz not null default now();
    alter table sm_release_policies add column if not exists created_by uuid;
    alter table sm_release_policies add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_policies add column if not exists updated_by uuid;
    alter table sm_release_policies add column if not exists rev bigint not null default 0;
    alter table sm_release_policies add column if not exists version integer not null default 1;
    alter table sm_release_policies add column if not exists deleted_at timestamptz;
    alter table sm_release_policies add column if not exists origin text;
    alter table sm_release_policies add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_policies add column if not exists name text;
    alter table sm_release_policies add column if not exists type text;
    alter table sm_release_policies add column if not exists cadence text;
    alter table sm_release_policies add column if not exists mandatory_checks jsonb;
    alter table sm_release_policies add column if not exists go_no_go_required boolean not null default true;
    alter table sm_release_policies add column if not exists els_days integer;
    alter table sm_release_policies add column if not exists min_lead_days integer;
    alter table sm_release_policies add column if not exists transition_package boolean not null default false;
    alter table sm_release_policies add column if not exists procedure text;
    alter table sm_release_policies add column if not exists revision integer;
    alter table sm_release_policies add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_release_policies (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  type text,
  cadence text,
  mandatory_checks jsonb,
  go_no_go_required boolean not null default true,
  els_days integer,
  min_lead_days integer,
  transition_package boolean not null default false,
  procedure text,
  revision integer,
  active boolean not null default true
);
create index if not exists sm_release_policies_rev_idx on sm_release_policies (org_id, rev);
create index if not exists sm_release_policies_upd_idx on sm_release_policies (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_policies_crt_idx on sm_release_policies (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_release_policies_sync on sm_release_policies;
create trigger sm_release_policies_sync before insert or update on sm_release_policies for each row execute function sm_sync_touch('release_policy');
create or replace trigger sm_release_policies_demo after insert on sm_release_policies for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_policies_demo_t after update or delete on sm_release_policies for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_policies enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:19', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۱ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 21/30 (a0c3bc7de847)
-- release_task: کارهای انتشار
do $cols$
begin
  if to_regclass('sm_release_tasks') is not null then
    alter table sm_release_tasks add column if not exists workspace_id uuid;
    alter table sm_release_tasks add column if not exists domain_id uuid;
    alter table sm_release_tasks add column if not exists unit_id uuid;
    alter table sm_release_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_release_tasks add column if not exists created_by uuid;
    alter table sm_release_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_tasks add column if not exists updated_by uuid;
    alter table sm_release_tasks add column if not exists rev bigint not null default 0;
    alter table sm_release_tasks add column if not exists version integer not null default 1;
    alter table sm_release_tasks add column if not exists deleted_at timestamptz;
    alter table sm_release_tasks add column if not exists origin text;
    alter table sm_release_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_tasks add column if not exists no integer;
    alter table sm_release_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTASK' || no::text else 'RTASK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_release_tasks add column if not exists short_description text;
    alter table sm_release_tasks add column if not exists description text;
    alter table sm_release_tasks add column if not exists state text;
    alter table sm_release_tasks add column if not exists priority text;
    alter table sm_release_tasks add column if not exists impact text;
    alter table sm_release_tasks add column if not exists urgency text;
    alter table sm_release_tasks add column if not exists category text;
    alter table sm_release_tasks add column if not exists subcategory text;
    alter table sm_release_tasks add column if not exists channel text;
    alter table sm_release_tasks add column if not exists caller_id uuid;
    alter table sm_release_tasks add column if not exists requested_for uuid;
    alter table sm_release_tasks add column if not exists opened_by uuid;
    alter table sm_release_tasks add column if not exists opened_at timestamptz;
    alter table sm_release_tasks add column if not exists assignment_group_id uuid;
    alter table sm_release_tasks add column if not exists assigned_to uuid;
    alter table sm_release_tasks add column if not exists service_id uuid;
    alter table sm_release_tasks add column if not exists offering_id uuid;
    alter table sm_release_tasks add column if not exists ci_id uuid;
    alter table sm_release_tasks add column if not exists location_id uuid;
    alter table sm_release_tasks add column if not exists due_at timestamptz;
    alter table sm_release_tasks add column if not exists resolved_at timestamptz;
    alter table sm_release_tasks add column if not exists resolved_by uuid;
    alter table sm_release_tasks add column if not exists closed_at timestamptz;
    alter table sm_release_tasks add column if not exists closed_by uuid;
    alter table sm_release_tasks add column if not exists close_code text;
    alter table sm_release_tasks add column if not exists close_notes text;
    alter table sm_release_tasks add column if not exists parent_id uuid;
    alter table sm_release_tasks add column if not exists watch_list jsonb;
    alter table sm_release_tasks add column if not exists approval text;
    alter table sm_release_tasks add column if not exists escalation integer;
    alter table sm_release_tasks add column if not exists reassignment_count integer;
    alter table sm_release_tasks add column if not exists reopen_count integer;
    alter table sm_release_tasks add column if not exists time_worked bigint;
    alter table sm_release_tasks add column if not exists first_response_at timestamptz;
    alter table sm_release_tasks add column if not exists active boolean not null default true;
    alter table sm_release_tasks add column if not exists sla_due timestamptz;
    alter table sm_release_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_release_tasks add column if not exists release_id uuid;
    alter table sm_release_tasks add column if not exists phase text;
    alter table sm_release_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_release_tasks add column if not exists depends_on jsonb;
    alter table sm_release_tasks add column if not exists sort_order integer;
    alter table sm_release_tasks add column if not exists planned_hours numeric;
    alter table sm_release_tasks add column if not exists release_manager_id uuid;
  end if;
end
$cols$;
create table if not exists sm_release_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTASK' || no::text else 'RTASK' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  release_id uuid,
  phase text,
  mandatory boolean not null default true,
  depends_on jsonb,
  sort_order integer,
  planned_hours numeric,
  release_manager_id uuid,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_release_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_release_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_release_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_release_tasks' and indexname like 'sm\_release\_tasks\_search\_%' and indexname not in ('sm_release_tasks_search_f3bce210_trgm', 'sm_release_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_release_tasks_search_f3bce210_trgm', 'sm_release_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_release_tasks_search_custom_trgm', 'sm_release_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_release_tasks_no_uk on sm_release_tasks (org_id, no);
create index if not exists sm_release_tasks_rev_idx on sm_release_tasks (org_id, rev);
create index if not exists sm_release_tasks_upd_idx on sm_release_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_tasks_crt_idx on sm_release_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_tasks_state_idx on sm_release_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_release_tasks_assignment_group_id_idx on sm_release_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_release_tasks_assigned_to_idx on sm_release_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_release_tasks_release_id_idx on sm_release_tasks (org_id, release_id) where deleted_at is null;
create index if not exists sm_release_tasks_workspace_acc_idx on sm_release_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_release_tasks_unit_acc_idx on sm_release_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_release_tasks_domain_acc_idx on sm_release_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_release_tasks_caller_id_idx on sm_release_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_release_tasks_requested_for_idx on sm_release_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_release_tasks_opened_by_idx on sm_release_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_release_tasks_release_manager_id_idx on sm_release_tasks (org_id, release_manager_id) where deleted_at is null;
create index if not exists sm_release_tasks_watch_list_gin on sm_release_tasks using gin (watch_list);
create index if not exists sm_release_tasks_open_grp_idx on sm_release_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_release_tasks_opened_brin on sm_release_tasks using brin (opened_at);
drop trigger if exists sm_release_tasks_sync on sm_release_tasks;
create trigger sm_release_tasks_sync before insert or update on sm_release_tasks for each row execute function sm_sync_touch('release_task');
create or replace trigger sm_release_tasks_demo after insert on sm_release_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_tasks_demo_t after update or delete on sm_release_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_tasks enable row level security;

-- release_template: الگوهای انتشار
do $cols$
begin
  if to_regclass('sm_release_templates') is not null then
    alter table sm_release_templates add column if not exists workspace_id uuid;
    alter table sm_release_templates add column if not exists domain_id uuid;
    alter table sm_release_templates add column if not exists unit_id uuid;
    alter table sm_release_templates add column if not exists created_at timestamptz not null default now();
    alter table sm_release_templates add column if not exists created_by uuid;
    alter table sm_release_templates add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_templates add column if not exists updated_by uuid;
    alter table sm_release_templates add column if not exists rev bigint not null default 0;
    alter table sm_release_templates add column if not exists version integer not null default 1;
    alter table sm_release_templates add column if not exists deleted_at timestamptz;
    alter table sm_release_templates add column if not exists origin text;
    alter table sm_release_templates add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_templates add column if not exists name text;
    alter table sm_release_templates add column if not exists type text;
    alter table sm_release_templates add column if not exists description text;
    alter table sm_release_templates add column if not exists tasks jsonb;
    alter table sm_release_templates add column if not exists checks jsonb;
    alter table sm_release_templates add column if not exists build_plan text;
    alter table sm_release_templates add column if not exists test_plan text;
    alter table sm_release_templates add column if not exists deployment_plan text;
    alter table sm_release_templates add column if not exists rollback_plan text;
    alter table sm_release_templates add column if not exists communication_plan text;
    alter table sm_release_templates add column if not exists els_days integer;
    alter table sm_release_templates add column if not exists services jsonb;
    alter table sm_release_templates add column if not exists revision integer;
    alter table sm_release_templates add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_release_templates (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  type text,
  description text,
  tasks jsonb,
  checks jsonb,
  build_plan text,
  test_plan text,
  deployment_plan text,
  rollback_plan text,
  communication_plan text,
  els_days integer,
  services jsonb,
  revision integer,
  active boolean not null default true
);
create index if not exists sm_release_templates_rev_idx on sm_release_templates (org_id, rev);
create index if not exists sm_release_templates_upd_idx on sm_release_templates (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_templates_crt_idx on sm_release_templates (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_release_templates_sync on sm_release_templates;
create trigger sm_release_templates_sync before insert or update on sm_release_templates for each row execute function sm_sync_touch('release_template');
create or replace trigger sm_release_templates_demo after insert on sm_release_templates for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_templates_demo_t after update or delete on sm_release_templates for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_templates enable row level security;

-- release_window: پنجره‌های انتشار
do $cols$
begin
  if to_regclass('sm_release_windows') is not null then
    alter table sm_release_windows add column if not exists workspace_id uuid;
    alter table sm_release_windows add column if not exists domain_id uuid;
    alter table sm_release_windows add column if not exists unit_id uuid;
    alter table sm_release_windows add column if not exists created_at timestamptz not null default now();
    alter table sm_release_windows add column if not exists created_by uuid;
    alter table sm_release_windows add column if not exists updated_at timestamptz not null default now();
    alter table sm_release_windows add column if not exists updated_by uuid;
    alter table sm_release_windows add column if not exists rev bigint not null default 0;
    alter table sm_release_windows add column if not exists version integer not null default 1;
    alter table sm_release_windows add column if not exists deleted_at timestamptz;
    alter table sm_release_windows add column if not exists origin text;
    alter table sm_release_windows add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_release_windows add column if not exists name text;
    alter table sm_release_windows add column if not exists kind text;
    alter table sm_release_windows add column if not exists capacity integer;
    alter table sm_release_windows add column if not exists start_at timestamptz;
    alter table sm_release_windows add column if not exists end_at timestamptz;
    alter table sm_release_windows add column if not exists recurrence text;
    alter table sm_release_windows add column if not exists weekdays jsonb;
    alter table sm_release_windows add column if not exists until date;
    alter table sm_release_windows add column if not exists types jsonb;
    alter table sm_release_windows add column if not exists services jsonb;
    alter table sm_release_windows add column if not exists active boolean not null default true;
    alter table sm_release_windows add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_release_windows (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  capacity integer,
  start_at timestamptz,
  end_at timestamptz,
  recurrence text,
  weekdays jsonb,
  until date,
  types jsonb,
  services jsonb,
  active boolean not null default true,
  description text
);
create index if not exists sm_release_windows_rev_idx on sm_release_windows (org_id, rev);
create index if not exists sm_release_windows_upd_idx on sm_release_windows (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_release_windows_crt_idx on sm_release_windows (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_release_windows_sync on sm_release_windows;
create trigger sm_release_windows_sync before insert or update on sm_release_windows for each row execute function sm_sync_touch('release_window');
create or replace trigger sm_release_windows_demo after insert on sm_release_windows for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_release_windows_demo_t after update or delete on sm_release_windows for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_release_windows enable row level security;

-- repair_order: تعمیرهای دارایی
do $cols$
begin
  if to_regclass('sm_repair_orders') is not null then
    alter table sm_repair_orders add column if not exists workspace_id uuid;
    alter table sm_repair_orders add column if not exists domain_id uuid;
    alter table sm_repair_orders add column if not exists unit_id uuid;
    alter table sm_repair_orders add column if not exists created_at timestamptz not null default now();
    alter table sm_repair_orders add column if not exists created_by uuid;
    alter table sm_repair_orders add column if not exists updated_at timestamptz not null default now();
    alter table sm_repair_orders add column if not exists updated_by uuid;
    alter table sm_repair_orders add column if not exists rev bigint not null default 0;
    alter table sm_repair_orders add column if not exists version integer not null default 1;
    alter table sm_repair_orders add column if not exists deleted_at timestamptz;
    alter table sm_repair_orders add column if not exists origin text;
    alter table sm_repair_orders add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_repair_orders add column if not exists no integer;
    alter table sm_repair_orders add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RMA' || no::text else 'RMA' || lpad(no::text, 6, '0') end) stored;
    alter table sm_repair_orders add column if not exists asset_id uuid;
    alter table sm_repair_orders add column if not exists title text;
    alter table sm_repair_orders add column if not exists repair_kind text;
    alter table sm_repair_orders add column if not exists vendor_id uuid;
    alter table sm_repair_orders add column if not exists contract_id uuid;
    alter table sm_repair_orders add column if not exists under_warranty boolean not null default false;
    alter table sm_repair_orders add column if not exists assigned_to uuid;
    alter table sm_repair_orders add column if not exists group_id uuid;
    alter table sm_repair_orders add column if not exists loaner_asset_id uuid;
    alter table sm_repair_orders add column if not exists fault text;
    alter table sm_repair_orders add column if not exists resolution text;
    alter table sm_repair_orders add column if not exists cost numeric;
    alter table sm_repair_orders add column if not exists sent_at timestamptz;
    alter table sm_repair_orders add column if not exists returned_at timestamptz;
    alter table sm_repair_orders add column if not exists previous_state text;
    alter table sm_repair_orders add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_repair_orders (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'RMA' || no::text else 'RMA' || lpad(no::text, 6, '0') end) stored,
  asset_id uuid,
  title text,
  repair_kind text,
  vendor_id uuid,
  contract_id uuid,
  under_warranty boolean not null default false,
  assigned_to uuid,
  group_id uuid,
  loaner_asset_id uuid,
  fault text,
  resolution text,
  cost numeric,
  sent_at timestamptz,
  returned_at timestamptz,
  previous_state text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_repair_orders' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_repair_orders', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_repair_orders', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_repair_orders' and indexname like 'sm\_repair\_orders\_search\_%' and indexname not in ('sm_repair_orders_search_cae18f1d_trgm', 'sm_repair_orders_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_repair_orders_search_cae18f1d_trgm', 'sm_repair_orders', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_repair_orders_search_custom_trgm', 'sm_repair_orders', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_repair_orders_no_uk on sm_repair_orders (org_id, no);
create index if not exists sm_repair_orders_rev_idx on sm_repair_orders (org_id, rev);
create index if not exists sm_repair_orders_upd_idx on sm_repair_orders (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_repair_orders_crt_idx on sm_repair_orders (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_repair_orders_asset_id_idx on sm_repair_orders (org_id, asset_id) where deleted_at is null;
create index if not exists sm_repair_orders_state_idx on sm_repair_orders (org_id, state) where deleted_at is null;
create index if not exists sm_repair_orders_workspace_acc_idx on sm_repair_orders (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_repair_orders_unit_acc_idx on sm_repair_orders (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_repair_orders_domain_acc_idx on sm_repair_orders (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_repair_orders_assigned_to_idx on sm_repair_orders (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_repair_orders_sync on sm_repair_orders;
create trigger sm_repair_orders_sync before insert or update on sm_repair_orders for each row execute function sm_sync_touch('repair_order');
create or replace trigger sm_repair_orders_demo after insert on sm_repair_orders for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_repair_orders_demo_t after update or delete on sm_repair_orders for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_repair_orders enable row level security;

-- request: درخواست‌های خدمت
do $cols$
begin
  if to_regclass('sm_requests') is not null then
    alter table sm_requests add column if not exists workspace_id uuid;
    alter table sm_requests add column if not exists domain_id uuid;
    alter table sm_requests add column if not exists unit_id uuid;
    alter table sm_requests add column if not exists created_at timestamptz not null default now();
    alter table sm_requests add column if not exists created_by uuid;
    alter table sm_requests add column if not exists updated_at timestamptz not null default now();
    alter table sm_requests add column if not exists updated_by uuid;
    alter table sm_requests add column if not exists rev bigint not null default 0;
    alter table sm_requests add column if not exists version integer not null default 1;
    alter table sm_requests add column if not exists deleted_at timestamptz;
    alter table sm_requests add column if not exists origin text;
    alter table sm_requests add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_requests add column if not exists no integer;
    alter table sm_requests add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REQ' || no::text else 'REQ' || lpad(no::text, 7, '0') end) stored;
    alter table sm_requests add column if not exists short_description text;
    alter table sm_requests add column if not exists description text;
    alter table sm_requests add column if not exists state text;
    alter table sm_requests add column if not exists priority text;
    alter table sm_requests add column if not exists impact text;
    alter table sm_requests add column if not exists urgency text;
    alter table sm_requests add column if not exists category text;
    alter table sm_requests add column if not exists subcategory text;
    alter table sm_requests add column if not exists channel text;
    alter table sm_requests add column if not exists caller_id uuid;
    alter table sm_requests add column if not exists requested_for uuid;
    alter table sm_requests add column if not exists opened_by uuid;
    alter table sm_requests add column if not exists opened_at timestamptz;
    alter table sm_requests add column if not exists assignment_group_id uuid;
    alter table sm_requests add column if not exists assigned_to uuid;
    alter table sm_requests add column if not exists service_id uuid;
    alter table sm_requests add column if not exists offering_id uuid;
    alter table sm_requests add column if not exists ci_id uuid;
    alter table sm_requests add column if not exists location_id uuid;
    alter table sm_requests add column if not exists due_at timestamptz;
    alter table sm_requests add column if not exists resolved_at timestamptz;
    alter table sm_requests add column if not exists resolved_by uuid;
    alter table sm_requests add column if not exists closed_at timestamptz;
    alter table sm_requests add column if not exists closed_by uuid;
    alter table sm_requests add column if not exists close_code text;
    alter table sm_requests add column if not exists close_notes text;
    alter table sm_requests add column if not exists parent_id uuid;
    alter table sm_requests add column if not exists watch_list jsonb;
    alter table sm_requests add column if not exists approval text;
    alter table sm_requests add column if not exists escalation integer;
    alter table sm_requests add column if not exists reassignment_count integer;
    alter table sm_requests add column if not exists reopen_count integer;
    alter table sm_requests add column if not exists time_worked bigint;
    alter table sm_requests add column if not exists first_response_at timestamptz;
    alter table sm_requests add column if not exists active boolean not null default true;
    alter table sm_requests add column if not exists sla_due timestamptz;
    alter table sm_requests add column if not exists knowledge boolean not null default false;
    alter table sm_requests add column if not exists needed_by date;
    alter table sm_requests add column if not exists cost_center_id uuid;
    alter table sm_requests add column if not exists items_count integer;
    alter table sm_requests add column if not exists total_price numeric;
    alter table sm_requests add column if not exists recurring_total numeric;
    alter table sm_requests add column if not exists stage text;
    alter table sm_requests add column if not exists fulfillers jsonb;
  end if;
end
$cols$;
create table if not exists sm_requests (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'REQ' || no::text else 'REQ' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  needed_by date,
  cost_center_id uuid,
  items_count integer,
  total_price numeric,
  recurring_total numeric,
  stage text,
  fulfillers jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_requests' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_requests', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_requests', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_requests' and indexname like 'sm\_requests\_search\_%' and indexname not in ('sm_requests_search_f3bce210_trgm', 'sm_requests_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_requests_search_f3bce210_trgm', 'sm_requests', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_requests_search_custom_trgm', 'sm_requests', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_requests_no_uk on sm_requests (org_id, no);
create index if not exists sm_requests_rev_idx on sm_requests (org_id, rev);
create index if not exists sm_requests_upd_idx on sm_requests (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_requests_crt_idx on sm_requests (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_requests_state_idx on sm_requests (org_id, state) where deleted_at is null;
create index if not exists sm_requests_assignment_group_id_idx on sm_requests (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_requests_assigned_to_idx on sm_requests (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_requests_workspace_acc_idx on sm_requests (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_requests_unit_acc_idx on sm_requests (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_requests_domain_acc_idx on sm_requests (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_requests_caller_id_idx on sm_requests (org_id, caller_id) where deleted_at is null;
create index if not exists sm_requests_requested_for_idx on sm_requests (org_id, requested_for) where deleted_at is null;
create index if not exists sm_requests_opened_by_idx on sm_requests (org_id, opened_by) where deleted_at is null;
create index if not exists sm_requests_fulfillers_gin on sm_requests using gin (fulfillers);
create index if not exists sm_requests_watch_list_gin on sm_requests using gin (watch_list);
create index if not exists sm_requests_open_grp_idx on sm_requests (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_requests_opened_brin on sm_requests using brin (opened_at);
drop trigger if exists sm_requests_sync on sm_requests;
create trigger sm_requests_sync before insert or update on sm_requests for each row execute function sm_sync_touch('request');
create or replace trigger sm_requests_demo after insert on sm_requests for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_requests_demo_t after update or delete on sm_requests for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_requests enable row level security;

-- request_answer: پاسخ‌های سفارش
do $cols$
begin
  if to_regclass('sm_request_answers') is not null then
    alter table sm_request_answers add column if not exists workspace_id uuid;
    alter table sm_request_answers add column if not exists domain_id uuid;
    alter table sm_request_answers add column if not exists unit_id uuid;
    alter table sm_request_answers add column if not exists created_at timestamptz not null default now();
    alter table sm_request_answers add column if not exists created_by uuid;
    alter table sm_request_answers add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_answers add column if not exists updated_by uuid;
    alter table sm_request_answers add column if not exists rev bigint not null default 0;
    alter table sm_request_answers add column if not exists version integer not null default 1;
    alter table sm_request_answers add column if not exists deleted_at timestamptz;
    alter table sm_request_answers add column if not exists origin text;
    alter table sm_request_answers add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_answers add column if not exists label text;
    alter table sm_request_answers add column if not exists variable text;
    alter table sm_request_answers add column if not exists request_item_id uuid;
    alter table sm_request_answers add column if not exists item_id uuid;
    alter table sm_request_answers add column if not exists value_text text;
    alter table sm_request_answers add column if not exists value_num numeric;
    alter table sm_request_answers add column if not exists value_date date;
    alter table sm_request_answers add column if not exists requested_for uuid;
    alter table sm_request_answers add column if not exists caller_id uuid;
    alter table sm_request_answers add column if not exists assignment_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_request_answers (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  label text,
  variable text,
  request_item_id uuid,
  item_id uuid,
  value_text text,
  value_num numeric,
  value_date date,
  requested_for uuid,
  caller_id uuid,
  assignment_group_id uuid
);
create index if not exists sm_request_answers_rev_idx on sm_request_answers (org_id, rev);
create index if not exists sm_request_answers_upd_idx on sm_request_answers (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_answers_crt_idx on sm_request_answers (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_answers_variable_idx on sm_request_answers (org_id, variable) where deleted_at is null;
create index if not exists sm_request_answers_request_item_id_idx on sm_request_answers (org_id, request_item_id) where deleted_at is null;
create index if not exists sm_request_answers_item_id_idx on sm_request_answers (org_id, item_id) where deleted_at is null;
create index if not exists sm_request_answers_workspace_acc_idx on sm_request_answers (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_answers_unit_acc_idx on sm_request_answers (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_answers_domain_acc_idx on sm_request_answers (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_answers_requested_for_idx on sm_request_answers (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_answers_caller_id_idx on sm_request_answers (org_id, caller_id) where deleted_at is null;
drop trigger if exists sm_request_answers_sync on sm_request_answers;
create trigger sm_request_answers_sync before insert or update on sm_request_answers for each row execute function sm_sync_touch('request_answer');
create or replace trigger sm_request_answers_demo after insert on sm_request_answers for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_answers_demo_t after update or delete on sm_request_answers for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_answers enable row level security;

-- request_cart: سبدهای سفارش
do $cols$
begin
  if to_regclass('sm_request_carts') is not null then
    alter table sm_request_carts add column if not exists workspace_id uuid;
    alter table sm_request_carts add column if not exists domain_id uuid;
    alter table sm_request_carts add column if not exists unit_id uuid;
    alter table sm_request_carts add column if not exists created_at timestamptz not null default now();
    alter table sm_request_carts add column if not exists created_by uuid;
    alter table sm_request_carts add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_carts add column if not exists updated_by uuid;
    alter table sm_request_carts add column if not exists rev bigint not null default 0;
    alter table sm_request_carts add column if not exists version integer not null default 1;
    alter table sm_request_carts add column if not exists deleted_at timestamptz;
    alter table sm_request_carts add column if not exists origin text;
    alter table sm_request_carts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_carts add column if not exists name text;
    alter table sm_request_carts add column if not exists kind text;
    alter table sm_request_carts add column if not exists user_id uuid;
    alter table sm_request_carts add column if not exists requested_for uuid;
    alter table sm_request_carts add column if not exists location_id uuid;
    alter table sm_request_carts add column if not exists needed_by date;
    alter table sm_request_carts add column if not exists cost_center_id uuid;
    alter table sm_request_carts add column if not exists instructions text;
    alter table sm_request_carts add column if not exists request_id uuid;
    alter table sm_request_carts add column if not exists checked_out_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_request_carts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  kind text,
  user_id uuid,
  requested_for uuid,
  location_id uuid,
  needed_by date,
  cost_center_id uuid,
  instructions text,
  request_id uuid,
  checked_out_at timestamptz
);
create index if not exists sm_request_carts_rev_idx on sm_request_carts (org_id, rev);
create index if not exists sm_request_carts_upd_idx on sm_request_carts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_carts_crt_idx on sm_request_carts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_carts_user_id_idx on sm_request_carts (org_id, user_id) where deleted_at is null;
create index if not exists sm_request_carts_workspace_acc_idx on sm_request_carts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_carts_unit_acc_idx on sm_request_carts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_carts_domain_acc_idx on sm_request_carts (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_request_carts_sync on sm_request_carts;
create trigger sm_request_carts_sync before insert or update on sm_request_carts for each row execute function sm_sync_touch('request_cart');
create or replace trigger sm_request_carts_demo after insert on sm_request_carts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_carts_demo_t after update or delete on sm_request_carts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_carts enable row level security;

-- request_cart_line: اقلام سبد
do $cols$
begin
  if to_regclass('sm_request_cart_lines') is not null then
    alter table sm_request_cart_lines add column if not exists workspace_id uuid;
    alter table sm_request_cart_lines add column if not exists domain_id uuid;
    alter table sm_request_cart_lines add column if not exists unit_id uuid;
    alter table sm_request_cart_lines add column if not exists created_at timestamptz not null default now();
    alter table sm_request_cart_lines add column if not exists created_by uuid;
    alter table sm_request_cart_lines add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_cart_lines add column if not exists updated_by uuid;
    alter table sm_request_cart_lines add column if not exists rev bigint not null default 0;
    alter table sm_request_cart_lines add column if not exists version integer not null default 1;
    alter table sm_request_cart_lines add column if not exists deleted_at timestamptz;
    alter table sm_request_cart_lines add column if not exists origin text;
    alter table sm_request_cart_lines add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_cart_lines add column if not exists title text;
    alter table sm_request_cart_lines add column if not exists cart_id uuid;
    alter table sm_request_cart_lines add column if not exists user_id uuid;
    alter table sm_request_cart_lines add column if not exists item_id uuid;
    alter table sm_request_cart_lines add column if not exists version_id uuid;
    alter table sm_request_cart_lines add column if not exists quantity integer;
    alter table sm_request_cart_lines add column if not exists price numeric;
    alter table sm_request_cart_lines add column if not exists requested_for uuid;
    alter table sm_request_cart_lines add column if not exists requested_for_list jsonb;
    alter table sm_request_cart_lines add column if not exists answers jsonb;
    alter table sm_request_cart_lines add column if not exists saved boolean not null default false;
    alter table sm_request_cart_lines add column if not exists guide_id uuid;
    alter table sm_request_cart_lines add column if not exists sort_order integer;
  end if;
end
$cols$;
create table if not exists sm_request_cart_lines (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  title text,
  cart_id uuid,
  user_id uuid,
  item_id uuid,
  version_id uuid,
  quantity integer,
  price numeric,
  requested_for uuid,
  requested_for_list jsonb,
  answers jsonb,
  saved boolean not null default false,
  guide_id uuid,
  sort_order integer
);
create index if not exists sm_request_cart_lines_rev_idx on sm_request_cart_lines (org_id, rev);
create index if not exists sm_request_cart_lines_upd_idx on sm_request_cart_lines (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_cart_lines_crt_idx on sm_request_cart_lines (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_cart_lines_cart_id_idx on sm_request_cart_lines (org_id, cart_id) where deleted_at is null;
create index if not exists sm_request_cart_lines_user_id_idx on sm_request_cart_lines (org_id, user_id) where deleted_at is null;
create index if not exists sm_request_cart_lines_workspace_acc_idx on sm_request_cart_lines (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_cart_lines_unit_acc_idx on sm_request_cart_lines (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_cart_lines_domain_acc_idx on sm_request_cart_lines (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_request_cart_lines_sync on sm_request_cart_lines;
create trigger sm_request_cart_lines_sync before insert or update on sm_request_cart_lines for each row execute function sm_sync_touch('request_cart_line');
create or replace trigger sm_request_cart_lines_demo after insert on sm_request_cart_lines for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_cart_lines_demo_t after update or delete on sm_request_cart_lines for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_cart_lines enable row level security;

-- request_config: تنظیمات درخواست خدمت
do $cols$
begin
  if to_regclass('sm_request_configs') is not null then
    alter table sm_request_configs add column if not exists workspace_id uuid;
    alter table sm_request_configs add column if not exists domain_id uuid;
    alter table sm_request_configs add column if not exists unit_id uuid;
    alter table sm_request_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_request_configs add column if not exists created_by uuid;
    alter table sm_request_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_configs add column if not exists updated_by uuid;
    alter table sm_request_configs add column if not exists rev bigint not null default 0;
    alter table sm_request_configs add column if not exists version integer not null default 1;
    alter table sm_request_configs add column if not exists deleted_at timestamptz;
    alter table sm_request_configs add column if not exists origin text;
    alter table sm_request_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_configs add column if not exists name text;
    alter table sm_request_configs add column if not exists confirm_days integer;
    alter table sm_request_configs add column if not exists info_reminder_days integer;
    alter table sm_request_configs add column if not exists info_cancel_days integer;
    alter table sm_request_configs add column if not exists sle_window_days integer;
    alter table sm_request_configs add column if not exists default_group_id uuid;
    alter table sm_request_configs add column if not exists calendar_id uuid;
    alter table sm_request_configs add column if not exists seeded boolean not null default false;
    alter table sm_request_configs add column if not exists seed_version integer;
  end if;
end
$cols$;
create table if not exists sm_request_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  confirm_days integer,
  info_reminder_days integer,
  info_cancel_days integer,
  sle_window_days integer,
  default_group_id uuid,
  calendar_id uuid,
  seeded boolean not null default false,
  seed_version integer
);
create index if not exists sm_request_configs_rev_idx on sm_request_configs (org_id, rev);
create index if not exists sm_request_configs_upd_idx on sm_request_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_configs_crt_idx on sm_request_configs (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_request_configs_sync on sm_request_configs;
create trigger sm_request_configs_sync before insert or update on sm_request_configs for each row execute function sm_sync_touch('request_config');
create or replace trigger sm_request_configs_demo after insert on sm_request_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_configs_demo_t after update or delete on sm_request_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_configs enable row level security;

-- request_item: اقلام درخواست‌شده
do $cols$
begin
  if to_regclass('sm_request_items') is not null then
    alter table sm_request_items add column if not exists workspace_id uuid;
    alter table sm_request_items add column if not exists domain_id uuid;
    alter table sm_request_items add column if not exists unit_id uuid;
    alter table sm_request_items add column if not exists created_at timestamptz not null default now();
    alter table sm_request_items add column if not exists created_by uuid;
    alter table sm_request_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_items add column if not exists updated_by uuid;
    alter table sm_request_items add column if not exists rev bigint not null default 0;
    alter table sm_request_items add column if not exists version integer not null default 1;
    alter table sm_request_items add column if not exists deleted_at timestamptz;
    alter table sm_request_items add column if not exists origin text;
    alter table sm_request_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_items add column if not exists no integer;
    alter table sm_request_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RITM' || no::text else 'RITM' || lpad(no::text, 7, '0') end) stored;
    alter table sm_request_items add column if not exists short_description text;
    alter table sm_request_items add column if not exists description text;
    alter table sm_request_items add column if not exists state text;
    alter table sm_request_items add column if not exists priority text;
    alter table sm_request_items add column if not exists impact text;
    alter table sm_request_items add column if not exists urgency text;
    alter table sm_request_items add column if not exists category text;
    alter table sm_request_items add column if not exists subcategory text;
    alter table sm_request_items add column if not exists channel text;
    alter table sm_request_items add column if not exists caller_id uuid;
    alter table sm_request_items add column if not exists requested_for uuid;
    alter table sm_request_items add column if not exists opened_by uuid;
    alter table sm_request_items add column if not exists opened_at timestamptz;
    alter table sm_request_items add column if not exists assignment_group_id uuid;
    alter table sm_request_items add column if not exists assigned_to uuid;
    alter table sm_request_items add column if not exists service_id uuid;
    alter table sm_request_items add column if not exists offering_id uuid;
    alter table sm_request_items add column if not exists ci_id uuid;
    alter table sm_request_items add column if not exists location_id uuid;
    alter table sm_request_items add column if not exists due_at timestamptz;
    alter table sm_request_items add column if not exists resolved_at timestamptz;
    alter table sm_request_items add column if not exists resolved_by uuid;
    alter table sm_request_items add column if not exists closed_at timestamptz;
    alter table sm_request_items add column if not exists closed_by uuid;
    alter table sm_request_items add column if not exists close_code text;
    alter table sm_request_items add column if not exists close_notes text;
    alter table sm_request_items add column if not exists parent_id uuid;
    alter table sm_request_items add column if not exists watch_list jsonb;
    alter table sm_request_items add column if not exists approval text;
    alter table sm_request_items add column if not exists escalation integer;
    alter table sm_request_items add column if not exists reassignment_count integer;
    alter table sm_request_items add column if not exists reopen_count integer;
    alter table sm_request_items add column if not exists time_worked bigint;
    alter table sm_request_items add column if not exists first_response_at timestamptz;
    alter table sm_request_items add column if not exists active boolean not null default true;
    alter table sm_request_items add column if not exists sla_due timestamptz;
    alter table sm_request_items add column if not exists knowledge boolean not null default false;
    alter table sm_request_items add column if not exists request_id uuid;
    alter table sm_request_items add column if not exists cat_item_id uuid;
    alter table sm_request_items add column if not exists item_version_id uuid;
    alter table sm_request_items add column if not exists category_id uuid;
    alter table sm_request_items add column if not exists quantity integer;
    alter table sm_request_items add column if not exists stage text;
    alter table sm_request_items add column if not exists answers jsonb;
    alter table sm_request_items add column if not exists private_answers jsonb;
    alter table sm_request_items add column if not exists secret_answers text;
    alter table sm_request_items add column if not exists price numeric;
    alter table sm_request_items add column if not exists total numeric;
    alter table sm_request_items add column if not exists recurring_price numeric;
    alter table sm_request_items add column if not exists recurring_frequency text;
    alter table sm_request_items add column if not exists cost numeric;
    alter table sm_request_items add column if not exists ad_hoc boolean not null default false;
    alter table sm_request_items add column if not exists fulfilment text;
    alter table sm_request_items add column if not exists approval_rule_id uuid;
    alter table sm_request_items add column if not exists produced_table text;
    alter table sm_request_items add column if not exists produced_id text;
    alter table sm_request_items add column if not exists requires_confirmation boolean not null default false;
    alter table sm_request_items add column if not exists access_until date;
    alter table sm_request_items add column if not exists revoked_at timestamptz;
    alter table sm_request_items add column if not exists subscription_id uuid;
    alter table sm_request_items add column if not exists entitlement jsonb;
    alter table sm_request_items add column if not exists flow_runs jsonb;
    alter table sm_request_items add column if not exists fulfillers jsonb;
    alter table sm_request_items add column if not exists rating integer;
    alter table sm_request_items add column if not exists feedback text;
    alter table sm_request_items add column if not exists sle_p85 bigint;
    alter table sm_request_items add column if not exists approval_requested_at timestamptz;
    alter table sm_request_items add column if not exists approved_at timestamptz;
    alter table sm_request_items add column if not exists fulfilment_started_at timestamptz;
    alter table sm_request_items add column if not exists info_requested boolean not null default false;
    alter table sm_request_items add column if not exists info_since timestamptz;
    alter table sm_request_items add column if not exists info_wait bigint;
    alter table sm_request_items add column if not exists reminded_at timestamptz;
    alter table sm_request_items add column if not exists zero_touch boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_request_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RITM' || no::text else 'RITM' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  request_id uuid,
  cat_item_id uuid,
  item_version_id uuid,
  category_id uuid,
  quantity integer,
  stage text,
  answers jsonb,
  private_answers jsonb,
  secret_answers text,
  price numeric,
  total numeric,
  recurring_price numeric,
  recurring_frequency text,
  cost numeric,
  ad_hoc boolean not null default false,
  fulfilment text,
  approval_rule_id uuid,
  produced_table text,
  produced_id text,
  requires_confirmation boolean not null default false,
  access_until date,
  revoked_at timestamptz,
  subscription_id uuid,
  entitlement jsonb,
  flow_runs jsonb,
  fulfillers jsonb,
  rating integer,
  feedback text,
  sle_p85 bigint,
  approval_requested_at timestamptz,
  approved_at timestamptz,
  fulfilment_started_at timestamptz,
  info_requested boolean not null default false,
  info_since timestamptz,
  info_wait bigint,
  reminded_at timestamptz,
  zero_touch boolean not null default false,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_items' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_request_items', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_request_items', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_request_items' and indexname like 'sm\_request\_items\_search\_%' and indexname not in ('sm_request_items_search_f3bce210_trgm', 'sm_request_items_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_items_search_f3bce210_trgm', 'sm_request_items', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_request_items_search_custom_trgm', 'sm_request_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_request_items_no_uk on sm_request_items (org_id, no);
create index if not exists sm_request_items_rev_idx on sm_request_items (org_id, rev);
create index if not exists sm_request_items_upd_idx on sm_request_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_items_crt_idx on sm_request_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_items_state_idx on sm_request_items (org_id, state) where deleted_at is null;
create index if not exists sm_request_items_assignment_group_id_idx on sm_request_items (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_request_items_assigned_to_idx on sm_request_items (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_request_items_request_id_idx on sm_request_items (org_id, request_id) where deleted_at is null;
create index if not exists sm_request_items_cat_item_id_idx on sm_request_items (org_id, cat_item_id) where deleted_at is null;
create index if not exists sm_request_items_workspace_acc_idx on sm_request_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_items_unit_acc_idx on sm_request_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_items_domain_acc_idx on sm_request_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_items_caller_id_idx on sm_request_items (org_id, caller_id) where deleted_at is null;
create index if not exists sm_request_items_requested_for_idx on sm_request_items (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_items_opened_by_idx on sm_request_items (org_id, opened_by) where deleted_at is null;
create index if not exists sm_request_items_fulfillers_gin on sm_request_items using gin (fulfillers);
create index if not exists sm_request_items_watch_list_gin on sm_request_items using gin (watch_list);
create index if not exists sm_request_items_open_grp_idx on sm_request_items (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_request_items_opened_brin on sm_request_items using brin (opened_at);
drop trigger if exists sm_request_items_sync on sm_request_items;
create trigger sm_request_items_sync before insert or update on sm_request_items for each row execute function sm_sync_touch('request_item');
create or replace trigger sm_request_items_demo after insert on sm_request_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_items_demo_t after update or delete on sm_request_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_items enable row level security;

-- request_subscription: اشتراک‌های خدمت
do $cols$
begin
  if to_regclass('sm_request_subscriptions') is not null then
    alter table sm_request_subscriptions add column if not exists workspace_id uuid;
    alter table sm_request_subscriptions add column if not exists domain_id uuid;
    alter table sm_request_subscriptions add column if not exists unit_id uuid;
    alter table sm_request_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_request_subscriptions add column if not exists created_by uuid;
    alter table sm_request_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_subscriptions add column if not exists updated_by uuid;
    alter table sm_request_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_request_subscriptions add column if not exists version integer not null default 1;
    alter table sm_request_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_request_subscriptions add column if not exists origin text;
    alter table sm_request_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_subscriptions add column if not exists no integer;
    alter table sm_request_subscriptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SUB' || no::text else 'SUB' || lpad(no::text, 6, '0') end) stored;
    alter table sm_request_subscriptions add column if not exists name text;
    alter table sm_request_subscriptions add column if not exists item_id uuid;
    alter table sm_request_subscriptions add column if not exists subscriber_id uuid;
    alter table sm_request_subscriptions add column if not exists request_item_id uuid;
    alter table sm_request_subscriptions add column if not exists quantity integer;
    alter table sm_request_subscriptions add column if not exists recurring_price numeric;
    alter table sm_request_subscriptions add column if not exists recurring_frequency text;
    alter table sm_request_subscriptions add column if not exists start_on date;
    alter table sm_request_subscriptions add column if not exists end_on date;
    alter table sm_request_subscriptions add column if not exists notes text;
    alter table sm_request_subscriptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_request_subscriptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SUB' || no::text else 'SUB' || lpad(no::text, 6, '0') end) stored,
  name text,
  item_id uuid,
  subscriber_id uuid,
  request_item_id uuid,
  quantity integer,
  recurring_price numeric,
  recurring_frequency text,
  start_on date,
  end_on date,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_subscriptions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_request_subscriptions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_request_subscriptions', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_request_subscriptions' and indexname like 'sm\_request\_subscriptions\_search\_%' and indexname not in ('sm_request_subscriptions_search_56291d9d_trgm', 'sm_request_subscriptions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_subscriptions_search_56291d9d_trgm', 'sm_request_subscriptions', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_request_subscriptions_search_custom_trgm', 'sm_request_subscriptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_request_subscriptions_no_uk on sm_request_subscriptions (org_id, no);
create index if not exists sm_request_subscriptions_rev_idx on sm_request_subscriptions (org_id, rev);
create index if not exists sm_request_subscriptions_upd_idx on sm_request_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_subscriptions_crt_idx on sm_request_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_subscriptions_state_idx on sm_request_subscriptions (org_id, state) where deleted_at is null;
create index if not exists sm_request_subscriptions_workspace_acc_idx on sm_request_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_subscriptions_unit_acc_idx on sm_request_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_subscriptions_domain_acc_idx on sm_request_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_subscriptions_subscriber_id_idx on sm_request_subscriptions (org_id, subscriber_id) where deleted_at is null;
drop trigger if exists sm_request_subscriptions_sync on sm_request_subscriptions;
create trigger sm_request_subscriptions_sync before insert or update on sm_request_subscriptions for each row execute function sm_sync_touch('request_subscription');
create or replace trigger sm_request_subscriptions_demo after insert on sm_request_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_subscriptions_demo_t after update or delete on sm_request_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_subscriptions enable row level security;

-- request_task: وظایف انجام
do $cols$
begin
  if to_regclass('sm_request_tasks') is not null then
    alter table sm_request_tasks add column if not exists workspace_id uuid;
    alter table sm_request_tasks add column if not exists domain_id uuid;
    alter table sm_request_tasks add column if not exists unit_id uuid;
    alter table sm_request_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_request_tasks add column if not exists created_by uuid;
    alter table sm_request_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_request_tasks add column if not exists updated_by uuid;
    alter table sm_request_tasks add column if not exists rev bigint not null default 0;
    alter table sm_request_tasks add column if not exists version integer not null default 1;
    alter table sm_request_tasks add column if not exists deleted_at timestamptz;
    alter table sm_request_tasks add column if not exists origin text;
    alter table sm_request_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_request_tasks add column if not exists no integer;
    alter table sm_request_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTSK' || no::text else 'RTSK' || lpad(no::text, 7, '0') end) stored;
    alter table sm_request_tasks add column if not exists short_description text;
    alter table sm_request_tasks add column if not exists description text;
    alter table sm_request_tasks add column if not exists state text;
    alter table sm_request_tasks add column if not exists priority text;
    alter table sm_request_tasks add column if not exists impact text;
    alter table sm_request_tasks add column if not exists urgency text;
    alter table sm_request_tasks add column if not exists category text;
    alter table sm_request_tasks add column if not exists subcategory text;
    alter table sm_request_tasks add column if not exists channel text;
    alter table sm_request_tasks add column if not exists caller_id uuid;
    alter table sm_request_tasks add column if not exists requested_for uuid;
    alter table sm_request_tasks add column if not exists opened_by uuid;
    alter table sm_request_tasks add column if not exists opened_at timestamptz;
    alter table sm_request_tasks add column if not exists assignment_group_id uuid;
    alter table sm_request_tasks add column if not exists assigned_to uuid;
    alter table sm_request_tasks add column if not exists service_id uuid;
    alter table sm_request_tasks add column if not exists offering_id uuid;
    alter table sm_request_tasks add column if not exists ci_id uuid;
    alter table sm_request_tasks add column if not exists location_id uuid;
    alter table sm_request_tasks add column if not exists due_at timestamptz;
    alter table sm_request_tasks add column if not exists resolved_at timestamptz;
    alter table sm_request_tasks add column if not exists resolved_by uuid;
    alter table sm_request_tasks add column if not exists closed_at timestamptz;
    alter table sm_request_tasks add column if not exists closed_by uuid;
    alter table sm_request_tasks add column if not exists close_code text;
    alter table sm_request_tasks add column if not exists close_notes text;
    alter table sm_request_tasks add column if not exists parent_id uuid;
    alter table sm_request_tasks add column if not exists watch_list jsonb;
    alter table sm_request_tasks add column if not exists approval text;
    alter table sm_request_tasks add column if not exists escalation integer;
    alter table sm_request_tasks add column if not exists reassignment_count integer;
    alter table sm_request_tasks add column if not exists reopen_count integer;
    alter table sm_request_tasks add column if not exists time_worked bigint;
    alter table sm_request_tasks add column if not exists first_response_at timestamptz;
    alter table sm_request_tasks add column if not exists active boolean not null default true;
    alter table sm_request_tasks add column if not exists sla_due timestamptz;
    alter table sm_request_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_request_tasks add column if not exists request_item_id uuid;
    alter table sm_request_tasks add column if not exists request_id uuid;
    alter table sm_request_tasks add column if not exists template_id uuid;
    alter table sm_request_tasks add column if not exists sort_order integer;
    alter table sm_request_tasks add column if not exists depends_on uuid;
    alter table sm_request_tasks add column if not exists requester_visible boolean not null default false;
    alter table sm_request_tasks add column if not exists instructions text;
    alter table sm_request_tasks add column if not exists checklist jsonb;
    alter table sm_request_tasks add column if not exists class_of_service text;
    alter table sm_request_tasks add column if not exists blocked boolean not null default false;
    alter table sm_request_tasks add column if not exists blocked_reason text;
    alter table sm_request_tasks add column if not exists blocked_since timestamptz;
    alter table sm_request_tasks add column if not exists blocked_time bigint;
    alter table sm_request_tasks add column if not exists deviation boolean not null default false;
    alter table sm_request_tasks add column if not exists deviation_note text;
    alter table sm_request_tasks add column if not exists revocation boolean not null default false;
  end if;
end
$cols$;
create table if not exists sm_request_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RTSK' || no::text else 'RTSK' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  request_item_id uuid,
  request_id uuid,
  template_id uuid,
  sort_order integer,
  depends_on uuid,
  requester_visible boolean not null default false,
  instructions text,
  checklist jsonb,
  class_of_service text,
  blocked boolean not null default false,
  blocked_reason text,
  blocked_since timestamptz,
  blocked_time bigint,
  deviation boolean not null default false,
  deviation_note text,
  revocation boolean not null default false,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_request_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_request_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_request_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_request_tasks' and indexname like 'sm\_request\_tasks\_search\_%' and indexname not in ('sm_request_tasks_search_f3bce210_trgm', 'sm_request_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_request_tasks_search_f3bce210_trgm', 'sm_request_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_request_tasks_search_custom_trgm', 'sm_request_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_request_tasks_no_uk on sm_request_tasks (org_id, no);
create index if not exists sm_request_tasks_rev_idx on sm_request_tasks (org_id, rev);
create index if not exists sm_request_tasks_upd_idx on sm_request_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_tasks_crt_idx on sm_request_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_request_tasks_state_idx on sm_request_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_request_tasks_assignment_group_id_idx on sm_request_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_request_tasks_assigned_to_idx on sm_request_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_request_tasks_request_item_id_idx on sm_request_tasks (org_id, request_item_id) where deleted_at is null;
create index if not exists sm_request_tasks_request_id_idx on sm_request_tasks (org_id, request_id) where deleted_at is null;
create index if not exists sm_request_tasks_workspace_acc_idx on sm_request_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_request_tasks_unit_acc_idx on sm_request_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_request_tasks_domain_acc_idx on sm_request_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_request_tasks_requested_for_idx on sm_request_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_request_tasks_watch_list_gin on sm_request_tasks using gin (watch_list);
create index if not exists sm_request_tasks_open_grp_idx on sm_request_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_request_tasks_opened_brin on sm_request_tasks using brin (opened_at);
drop trigger if exists sm_request_tasks_sync on sm_request_tasks;
create trigger sm_request_tasks_sync before insert or update on sm_request_tasks for each row execute function sm_sync_touch('request_task');
create or replace trigger sm_request_tasks_demo after insert on sm_request_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_request_tasks_demo_t after update or delete on sm_request_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_request_tasks enable row level security;

-- reservation: رزروها
do $cols$
begin
  if to_regclass('sm_reservations') is not null then
    alter table sm_reservations add column if not exists workspace_id uuid;
    alter table sm_reservations add column if not exists domain_id uuid;
    alter table sm_reservations add column if not exists unit_id uuid;
    alter table sm_reservations add column if not exists created_at timestamptz not null default now();
    alter table sm_reservations add column if not exists created_by uuid;
    alter table sm_reservations add column if not exists updated_at timestamptz not null default now();
    alter table sm_reservations add column if not exists updated_by uuid;
    alter table sm_reservations add column if not exists rev bigint not null default 0;
    alter table sm_reservations add column if not exists version integer not null default 1;
    alter table sm_reservations add column if not exists deleted_at timestamptz;
    alter table sm_reservations add column if not exists origin text;
    alter table sm_reservations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_reservations add column if not exists no integer;
    alter table sm_reservations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RSV' || no::text else 'RSV' || lpad(no::text, 7, '0') end) stored;
    alter table sm_reservations add column if not exists title text;
    alter table sm_reservations add column if not exists space_id uuid;
    alter table sm_reservations add column if not exists start_at timestamptz;
    alter table sm_reservations add column if not exists end_at timestamptz;
    alter table sm_reservations add column if not exists attendees integer;
    alter table sm_reservations add column if not exists booked_for uuid;
    alter table sm_reservations add column if not exists booked_by uuid;
    alter table sm_reservations add column if not exists recurrence text;
    alter table sm_reservations add column if not exists recurrence_until date;
    alter table sm_reservations add column if not exists series_id text;
    alter table sm_reservations add column if not exists services jsonb;
    alter table sm_reservations add column if not exists service_notes text;
    alter table sm_reservations add column if not exists waitlist_position integer;
    alter table sm_reservations add column if not exists checked_in_at timestamptz;
    alter table sm_reservations add column if not exists released_at timestamptz;
    alter table sm_reservations add column if not exists approval text;
    alter table sm_reservations add column if not exists location_id uuid;
    alter table sm_reservations add column if not exists assignment_group_id uuid;
    alter table sm_reservations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_reservations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'RSV' || no::text else 'RSV' || lpad(no::text, 7, '0') end) stored,
  title text,
  space_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  attendees integer,
  booked_for uuid,
  booked_by uuid,
  recurrence text,
  recurrence_until date,
  series_id text,
  services jsonb,
  service_notes text,
  waitlist_position integer,
  checked_in_at timestamptz,
  released_at timestamptz,
  approval text,
  location_id uuid,
  assignment_group_id uuid,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_reservations' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_reservations', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_reservations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_reservations' and indexname like 'sm\_reservations\_search\_%' and indexname not in ('sm_reservations_search_cae18f1d_trgm', 'sm_reservations_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_reservations_search_cae18f1d_trgm', 'sm_reservations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_reservations_search_custom_trgm', 'sm_reservations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_reservations_no_uk on sm_reservations (org_id, no);
create index if not exists sm_reservations_rev_idx on sm_reservations (org_id, rev);
create index if not exists sm_reservations_upd_idx on sm_reservations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_reservations_crt_idx on sm_reservations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_reservations_space_id_idx on sm_reservations (org_id, space_id) where deleted_at is null;
create index if not exists sm_reservations_booked_for_idx on sm_reservations (org_id, booked_for) where deleted_at is null;
create index if not exists sm_reservations_booked_by_idx on sm_reservations (org_id, booked_by) where deleted_at is null;
create index if not exists sm_reservations_location_id_idx on sm_reservations (org_id, location_id) where deleted_at is null;
create index if not exists sm_reservations_assignment_group_id_idx on sm_reservations (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_reservations_state_idx on sm_reservations (org_id, state) where deleted_at is null;
create index if not exists sm_reservations_workspace_acc_idx on sm_reservations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_reservations_unit_acc_idx on sm_reservations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_reservations_domain_acc_idx on sm_reservations (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_reservations_sync on sm_reservations;
create trigger sm_reservations_sync before insert or update on sm_reservations for each row execute function sm_sync_touch('reservation');
create or replace trigger sm_reservations_demo after insert on sm_reservations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_reservations_demo_t after update or delete on sm_reservations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_reservations enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:20', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۲ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 22/30 (a0c3bc7de847)
-- resource_allocation: تخصیص‌های منابع
do $cols$
begin
  if to_regclass('sm_resource_allocations') is not null then
    alter table sm_resource_allocations add column if not exists workspace_id uuid;
    alter table sm_resource_allocations add column if not exists domain_id uuid;
    alter table sm_resource_allocations add column if not exists unit_id uuid;
    alter table sm_resource_allocations add column if not exists created_at timestamptz not null default now();
    alter table sm_resource_allocations add column if not exists created_by uuid;
    alter table sm_resource_allocations add column if not exists updated_at timestamptz not null default now();
    alter table sm_resource_allocations add column if not exists updated_by uuid;
    alter table sm_resource_allocations add column if not exists rev bigint not null default 0;
    alter table sm_resource_allocations add column if not exists version integer not null default 1;
    alter table sm_resource_allocations add column if not exists deleted_at timestamptz;
    alter table sm_resource_allocations add column if not exists origin text;
    alter table sm_resource_allocations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_resource_allocations add column if not exists user_id uuid;
    alter table sm_resource_allocations add column if not exists project_id uuid;
    alter table sm_resource_allocations add column if not exists role text;
    alter table sm_resource_allocations add column if not exists state text;
    alter table sm_resource_allocations add column if not exists start_date date;
    alter table sm_resource_allocations add column if not exists end_date date;
    alter table sm_resource_allocations add column if not exists hours_per_week numeric;
    alter table sm_resource_allocations add column if not exists notes text;
    alter table sm_resource_allocations add column if not exists project_manager_id uuid;
    alter table sm_resource_allocations add column if not exists assignment_group_id uuid;
  end if;
end
$cols$;
create table if not exists sm_resource_allocations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  project_id uuid,
  role text,
  state text,
  start_date date,
  end_date date,
  hours_per_week numeric,
  notes text,
  project_manager_id uuid,
  assignment_group_id uuid
);
create index if not exists sm_resource_allocations_rev_idx on sm_resource_allocations (org_id, rev);
create index if not exists sm_resource_allocations_upd_idx on sm_resource_allocations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_resource_allocations_crt_idx on sm_resource_allocations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_resource_allocations_user_id_idx on sm_resource_allocations (org_id, user_id) where deleted_at is null;
create index if not exists sm_resource_allocations_project_id_idx on sm_resource_allocations (org_id, project_id) where deleted_at is null;
create index if not exists sm_resource_allocations_workspace_acc_idx on sm_resource_allocations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_resource_allocations_unit_acc_idx on sm_resource_allocations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_resource_allocations_domain_acc_idx on sm_resource_allocations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_resource_allocations_project_manager_id_idx on sm_resource_allocations (org_id, project_manager_id) where deleted_at is null;
drop trigger if exists sm_resource_allocations_sync on sm_resource_allocations;
create trigger sm_resource_allocations_sync before insert or update on sm_resource_allocations for each row execute function sm_sync_touch('resource_allocation');
create or replace trigger sm_resource_allocations_demo after insert on sm_resource_allocations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_resource_allocations_demo_t after update or delete on sm_resource_allocations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_resource_allocations enable row level security;

-- role: نقش‌ها
do $cols$
begin
  if to_regclass('sm_roles') is not null then
    alter table sm_roles add column if not exists workspace_id uuid;
    alter table sm_roles add column if not exists domain_id uuid;
    alter table sm_roles add column if not exists unit_id uuid;
    alter table sm_roles add column if not exists created_at timestamptz not null default now();
    alter table sm_roles add column if not exists created_by uuid;
    alter table sm_roles add column if not exists updated_at timestamptz not null default now();
    alter table sm_roles add column if not exists updated_by uuid;
    alter table sm_roles add column if not exists rev bigint not null default 0;
    alter table sm_roles add column if not exists version integer not null default 1;
    alter table sm_roles add column if not exists deleted_at timestamptz;
    alter table sm_roles add column if not exists origin text;
    alter table sm_roles add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_roles add column if not exists key text;
    alter table sm_roles add column if not exists name text;
    alter table sm_roles add column if not exists description text;
    alter table sm_roles add column if not exists persona text;
    alter table sm_roles add column if not exists workspaces text;
    alter table sm_roles add column if not exists domains text;
    alter table sm_roles add column if not exists grants jsonb;
    alter table sm_roles add column if not exists field_groups jsonb;
    alter table sm_roles add column if not exists contains jsonb;
    alter table sm_roles add column if not exists active boolean not null default true;
  end if;
end
$cols$;
create table if not exists sm_roles (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  key text,
  name text,
  description text,
  persona text,
  workspaces text,
  domains text,
  grants jsonb,
  field_groups jsonb,
  contains jsonb,
  active boolean not null default true
);
create index if not exists sm_roles_rev_idx on sm_roles (org_id, rev);
create index if not exists sm_roles_upd_idx on sm_roles (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_roles_crt_idx on sm_roles (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_roles_key_uk on sm_roles (org_id, key) where deleted_at is null;
drop trigger if exists sm_roles_sync on sm_roles;
create trigger sm_roles_sync before insert or update on sm_roles for each row execute function sm_sync_touch('role');
create or replace trigger sm_roles_demo after insert on sm_roles for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_roles_demo_t after update or delete on sm_roles for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_roles enable row level security;

-- saas_account: حساب‌های SaaS
do $cols$
begin
  if to_regclass('sm_saas_accounts') is not null then
    alter table sm_saas_accounts add column if not exists workspace_id uuid;
    alter table sm_saas_accounts add column if not exists domain_id uuid;
    alter table sm_saas_accounts add column if not exists unit_id uuid;
    alter table sm_saas_accounts add column if not exists created_at timestamptz not null default now();
    alter table sm_saas_accounts add column if not exists created_by uuid;
    alter table sm_saas_accounts add column if not exists updated_at timestamptz not null default now();
    alter table sm_saas_accounts add column if not exists updated_by uuid;
    alter table sm_saas_accounts add column if not exists rev bigint not null default 0;
    alter table sm_saas_accounts add column if not exists version integer not null default 1;
    alter table sm_saas_accounts add column if not exists deleted_at timestamptz;
    alter table sm_saas_accounts add column if not exists origin text;
    alter table sm_saas_accounts add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_saas_accounts add column if not exists subscription_id uuid;
    alter table sm_saas_accounts add column if not exists user_id uuid;
    alter table sm_saas_accounts add column if not exists email text;
    alter table sm_saas_accounts add column if not exists external_id text;
    alter table sm_saas_accounts add column if not exists role text;
    alter table sm_saas_accounts add column if not exists last_active_at timestamptz;
    alter table sm_saas_accounts add column if not exists active boolean not null default true;
    alter table sm_saas_accounts add column if not exists label text;
  end if;
end
$cols$;
create table if not exists sm_saas_accounts (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  subscription_id uuid,
  user_id uuid,
  email text,
  external_id text,
  role text,
  last_active_at timestamptz,
  active boolean not null default true,
  label text
);
create index if not exists sm_saas_accounts_rev_idx on sm_saas_accounts (org_id, rev);
create index if not exists sm_saas_accounts_upd_idx on sm_saas_accounts (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_accounts_crt_idx on sm_saas_accounts (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_accounts_subscription_id_idx on sm_saas_accounts (org_id, subscription_id) where deleted_at is null;
create index if not exists sm_saas_accounts_workspace_acc_idx on sm_saas_accounts (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_saas_accounts_unit_acc_idx on sm_saas_accounts (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_saas_accounts_domain_acc_idx on sm_saas_accounts (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_saas_accounts_user_id_idx on sm_saas_accounts (org_id, user_id) where deleted_at is null;
drop trigger if exists sm_saas_accounts_sync on sm_saas_accounts;
create trigger sm_saas_accounts_sync before insert or update on sm_saas_accounts for each row execute function sm_sync_touch('saas_account');
create or replace trigger sm_saas_accounts_demo after insert on sm_saas_accounts for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_saas_accounts_demo_t after update or delete on sm_saas_accounts for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_saas_accounts enable row level security;

-- saas_subscription: اشتراک‌های SaaS
do $cols$
begin
  if to_regclass('sm_saas_subscriptions') is not null then
    alter table sm_saas_subscriptions add column if not exists workspace_id uuid;
    alter table sm_saas_subscriptions add column if not exists domain_id uuid;
    alter table sm_saas_subscriptions add column if not exists unit_id uuid;
    alter table sm_saas_subscriptions add column if not exists created_at timestamptz not null default now();
    alter table sm_saas_subscriptions add column if not exists created_by uuid;
    alter table sm_saas_subscriptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_saas_subscriptions add column if not exists updated_by uuid;
    alter table sm_saas_subscriptions add column if not exists rev bigint not null default 0;
    alter table sm_saas_subscriptions add column if not exists version integer not null default 1;
    alter table sm_saas_subscriptions add column if not exists deleted_at timestamptz;
    alter table sm_saas_subscriptions add column if not exists origin text;
    alter table sm_saas_subscriptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_saas_subscriptions add column if not exists no integer;
    alter table sm_saas_subscriptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SAAS' || no::text else 'SAAS' || lpad(no::text, 5, '0') end) stored;
    alter table sm_saas_subscriptions add column if not exists name text;
    alter table sm_saas_subscriptions add column if not exists supplier_id uuid;
    alter table sm_saas_subscriptions add column if not exists software_model_id uuid;
    alter table sm_saas_subscriptions add column if not exists contract_id uuid;
    alter table sm_saas_subscriptions add column if not exists plan text;
    alter table sm_saas_subscriptions add column if not exists billing_cycle text;
    alter table sm_saas_subscriptions add column if not exists owner_id uuid;
    alter table sm_saas_subscriptions add column if not exists seats integer;
    alter table sm_saas_subscriptions add column if not exists seats_assigned integer;
    alter table sm_saas_subscriptions add column if not exists seats_active integer;
    alter table sm_saas_subscriptions add column if not exists cost_per_seat numeric;
    alter table sm_saas_subscriptions add column if not exists annual_cost numeric;
    alter table sm_saas_subscriptions add column if not exists renewal_date date;
    alter table sm_saas_subscriptions add column if not exists auto_renew boolean not null default true;
    alter table sm_saas_subscriptions add column if not exists cost_center_id uuid;
    alter table sm_saas_subscriptions add column if not exists sso boolean not null default false;
    alter table sm_saas_subscriptions add column if not exists admin_url text;
    alter table sm_saas_subscriptions add column if not exists reminded jsonb;
    alter table sm_saas_subscriptions add column if not exists notes text;
    alter table sm_saas_subscriptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_saas_subscriptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SAAS' || no::text else 'SAAS' || lpad(no::text, 5, '0') end) stored,
  name text,
  supplier_id uuid,
  software_model_id uuid,
  contract_id uuid,
  plan text,
  billing_cycle text,
  owner_id uuid,
  seats integer,
  seats_assigned integer,
  seats_active integer,
  cost_per_seat numeric,
  annual_cost numeric,
  renewal_date date,
  auto_renew boolean not null default true,
  cost_center_id uuid,
  sso boolean not null default false,
  admin_url text,
  reminded jsonb,
  notes text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_saas_subscriptions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_saas_subscriptions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_saas_subscriptions', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_saas_subscriptions' and indexname like 'sm\_saas\_subscriptions\_search\_%' and indexname not in ('sm_saas_subscriptions_search_56291d9d_trgm', 'sm_saas_subscriptions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_saas_subscriptions_search_56291d9d_trgm', 'sm_saas_subscriptions', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_saas_subscriptions_search_custom_trgm', 'sm_saas_subscriptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_saas_subscriptions_no_uk on sm_saas_subscriptions (org_id, no);
create index if not exists sm_saas_subscriptions_rev_idx on sm_saas_subscriptions (org_id, rev);
create index if not exists sm_saas_subscriptions_upd_idx on sm_saas_subscriptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_subscriptions_crt_idx on sm_saas_subscriptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_saas_subscriptions_renewal_date_idx on sm_saas_subscriptions (org_id, renewal_date) where deleted_at is null;
create index if not exists sm_saas_subscriptions_state_idx on sm_saas_subscriptions (org_id, state) where deleted_at is null;
create index if not exists sm_saas_subscriptions_workspace_acc_idx on sm_saas_subscriptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_saas_subscriptions_unit_acc_idx on sm_saas_subscriptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_saas_subscriptions_domain_acc_idx on sm_saas_subscriptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_saas_subscriptions_owner_id_idx on sm_saas_subscriptions (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_saas_subscriptions_sync on sm_saas_subscriptions;
create trigger sm_saas_subscriptions_sync before insert or update on sm_saas_subscriptions for each row execute function sm_sync_touch('saas_subscription');
create or replace trigger sm_saas_subscriptions_demo after insert on sm_saas_subscriptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_saas_subscriptions_demo_t after update or delete on sm_saas_subscriptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_saas_subscriptions enable row level security;

-- schedule: زمان‌بندی‌ها
do $cols$
begin
  if to_regclass('sm_schedules') is not null then
    alter table sm_schedules add column if not exists workspace_id uuid;
    alter table sm_schedules add column if not exists domain_id uuid;
    alter table sm_schedules add column if not exists unit_id uuid;
    alter table sm_schedules add column if not exists created_at timestamptz not null default now();
    alter table sm_schedules add column if not exists created_by uuid;
    alter table sm_schedules add column if not exists updated_at timestamptz not null default now();
    alter table sm_schedules add column if not exists updated_by uuid;
    alter table sm_schedules add column if not exists rev bigint not null default 0;
    alter table sm_schedules add column if not exists version integer not null default 1;
    alter table sm_schedules add column if not exists deleted_at timestamptz;
    alter table sm_schedules add column if not exists origin text;
    alter table sm_schedules add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_schedules add column if not exists name text;
    alter table sm_schedules add column if not exists active boolean not null default false;
    alter table sm_schedules add column if not exists table_key text;
    alter table sm_schedules add column if not exists spec jsonb;
    alter table sm_schedules add column if not exists template jsonb;
    alter table sm_schedules add column if not exists run_as uuid;
    alter table sm_schedules add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_schedules (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  active boolean not null default false,
  table_key text,
  spec jsonb,
  template jsonb,
  run_as uuid,
  description text
);
create index if not exists sm_schedules_rev_idx on sm_schedules (org_id, rev);
create index if not exists sm_schedules_upd_idx on sm_schedules (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_schedules_crt_idx on sm_schedules (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_schedules_sync on sm_schedules;
create trigger sm_schedules_sync before insert or update on sm_schedules for each row execute function sm_sync_touch('schedule');
create or replace trigger sm_schedules_demo after insert on sm_schedules for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_schedules_demo_t after update or delete on sm_schedules for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_schedules enable row level security;

-- sec_config: تنظیمات امنیت
do $cols$
begin
  if to_regclass('sm_sec_configs') is not null then
    alter table sm_sec_configs add column if not exists workspace_id uuid;
    alter table sm_sec_configs add column if not exists domain_id uuid;
    alter table sm_sec_configs add column if not exists unit_id uuid;
    alter table sm_sec_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_configs add column if not exists created_by uuid;
    alter table sm_sec_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_configs add column if not exists updated_by uuid;
    alter table sm_sec_configs add column if not exists rev bigint not null default 0;
    alter table sm_sec_configs add column if not exists version integer not null default 1;
    alter table sm_sec_configs add column if not exists deleted_at timestamptz;
    alter table sm_sec_configs add column if not exists origin text;
    alter table sm_sec_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_configs add column if not exists name text;
    alter table sm_sec_configs add column if not exists config_key text;
    alter table sm_sec_configs add column if not exists secure_workspace_id uuid;
    alter table sm_sec_configs add column if not exists soc_group_id uuid;
    alter table sm_sec_configs add column if not exists auto_promote boolean not null default true;
    alter table sm_sec_configs add column if not exists auto_playbook boolean not null default true;
    alter table sm_sec_configs add column if not exists sir_weights jsonb;
    alter table sm_sec_configs add column if not exists ai_max_classification text;
    alter table sm_sec_configs add column if not exists vuln_group_id uuid;
    alter table sm_sec_configs add column if not exists vuln_sla_critical integer;
    alter table sm_sec_configs add column if not exists vuln_sla_high integer;
    alter table sm_sec_configs add column if not exists vuln_sla_medium integer;
    alter table sm_sec_configs add column if not exists vuln_sla_low integer;
    alter table sm_sec_configs add column if not exists autoclose_missing boolean not null default true;
    alter table sm_sec_configs add column if not exists exception_warn_days integer;
    alter table sm_sec_configs add column if not exists review_changes boolean not null default true;
    alter table sm_sec_configs add column if not exists grc_group_id uuid;
    alter table sm_sec_configs add column if not exists policy_review_months integer;
    alter table sm_sec_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_sec_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  secure_workspace_id uuid,
  soc_group_id uuid,
  auto_promote boolean not null default true,
  auto_playbook boolean not null default true,
  sir_weights jsonb,
  ai_max_classification text,
  vuln_group_id uuid,
  vuln_sla_critical integer,
  vuln_sla_high integer,
  vuln_sla_medium integer,
  vuln_sla_low integer,
  autoclose_missing boolean not null default true,
  exception_warn_days integer,
  review_changes boolean not null default true,
  grc_group_id uuid,
  policy_review_months integer,
  seeded integer
);
create index if not exists sm_sec_configs_rev_idx on sm_sec_configs (org_id, rev);
create index if not exists sm_sec_configs_upd_idx on sm_sec_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_configs_crt_idx on sm_sec_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sec_configs_config_key_uk on sm_sec_configs (org_id, config_key) where deleted_at is null;
drop trigger if exists sm_sec_configs_sync on sm_sec_configs;
create trigger sm_sec_configs_sync before insert or update on sm_sec_configs for each row execute function sm_sync_touch('sec_config');
create or replace trigger sm_sec_configs_demo after insert on sm_sec_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_configs_demo_t after update or delete on sm_sec_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_configs enable row level security;

-- sec_evidence: شواهد و زنجیرهٔ حضانت
do $cols$
begin
  if to_regclass('sm_sec_evidence') is not null then
    alter table sm_sec_evidence add column if not exists workspace_id uuid;
    alter table sm_sec_evidence add column if not exists domain_id uuid;
    alter table sm_sec_evidence add column if not exists unit_id uuid;
    alter table sm_sec_evidence add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_evidence add column if not exists created_by uuid;
    alter table sm_sec_evidence add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_evidence add column if not exists updated_by uuid;
    alter table sm_sec_evidence add column if not exists rev bigint not null default 0;
    alter table sm_sec_evidence add column if not exists version integer not null default 1;
    alter table sm_sec_evidence add column if not exists deleted_at timestamptz;
    alter table sm_sec_evidence add column if not exists origin text;
    alter table sm_sec_evidence add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_evidence add column if not exists no integer;
    alter table sm_sec_evidence add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EVD' || no::text else 'EVD' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_evidence add column if not exists title text;
    alter table sm_sec_evidence add column if not exists kind text;
    alter table sm_sec_evidence add column if not exists sec_incident_id uuid;
    alter table sm_sec_evidence add column if not exists sha256 text;
    alter table sm_sec_evidence add column if not exists description text;
    alter table sm_sec_evidence add column if not exists collected_at timestamptz;
    alter table sm_sec_evidence add column if not exists collected_by uuid;
    alter table sm_sec_evidence add column if not exists custodian_id uuid;
    alter table sm_sec_evidence add column if not exists location text;
    alter table sm_sec_evidence add column if not exists legal_hold boolean not null default false;
    alter table sm_sec_evidence add column if not exists assignment_group_id uuid;
    alter table sm_sec_evidence add column if not exists custody_log jsonb;
    alter table sm_sec_evidence add column if not exists notes text;
    alter table sm_sec_evidence add column if not exists confidential boolean not null default false;
    alter table sm_sec_evidence add column if not exists access_list jsonb;
    alter table sm_sec_evidence add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_evidence (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EVD' || no::text else 'EVD' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  sec_incident_id uuid,
  sha256 text,
  description text,
  collected_at timestamptz,
  collected_by uuid,
  custodian_id uuid,
  location text,
  legal_hold boolean not null default false,
  assignment_group_id uuid,
  custody_log jsonb,
  notes text,
  confidential boolean not null default false,
  access_list jsonb,
  state text,
  search_8f465c07 text generated always as (translate(coalesce(title, '') || ' ' || coalesce(sha256, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_evidence' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_8f465c07' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_evidence', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_evidence', 'search_8f465c07', $x$translate(coalesce(title, '') || ' ' || coalesce(sha256, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_evidence' and indexname like 'sm\_sec\_evidence\_search\_%' and indexname not in ('sm_sec_evidence_search_8f465c07_trgm', 'sm_sec_evidence_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_evidence_search_8f465c07_trgm', 'sm_sec_evidence', 'search_8f465c07', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_evidence_search_custom_trgm', 'sm_sec_evidence', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_evidence_no_uk on sm_sec_evidence (org_id, no);
create index if not exists sm_sec_evidence_rev_idx on sm_sec_evidence (org_id, rev);
create index if not exists sm_sec_evidence_upd_idx on sm_sec_evidence (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_evidence_crt_idx on sm_sec_evidence (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_evidence_sec_incident_id_idx on sm_sec_evidence (org_id, sec_incident_id) where deleted_at is null;
create index if not exists sm_sec_evidence_sha256_idx on sm_sec_evidence (org_id, sha256) where deleted_at is null;
create index if not exists sm_sec_evidence_state_idx on sm_sec_evidence (org_id, state) where deleted_at is null;
create index if not exists sm_sec_evidence_workspace_acc_idx on sm_sec_evidence (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_evidence_unit_acc_idx on sm_sec_evidence (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_evidence_domain_acc_idx on sm_sec_evidence (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_evidence_custodian_id_idx on sm_sec_evidence (org_id, custodian_id) where deleted_at is null;
create index if not exists sm_sec_evidence_collected_by_idx on sm_sec_evidence (org_id, collected_by) where deleted_at is null;
drop trigger if exists sm_sec_evidence_sync on sm_sec_evidence;
create trigger sm_sec_evidence_sync before insert or update on sm_sec_evidence for each row execute function sm_sync_touch('sec_evidence');
create or replace trigger sm_sec_evidence_demo after insert on sm_sec_evidence for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_evidence_demo_t after update or delete on sm_sec_evidence for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_evidence enable row level security;

-- sec_incident: رخدادهای امنیتی
do $cols$
begin
  if to_regclass('sm_sec_incidents') is not null then
    alter table sm_sec_incidents add column if not exists workspace_id uuid;
    alter table sm_sec_incidents add column if not exists domain_id uuid;
    alter table sm_sec_incidents add column if not exists unit_id uuid;
    alter table sm_sec_incidents add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_incidents add column if not exists created_by uuid;
    alter table sm_sec_incidents add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_incidents add column if not exists updated_by uuid;
    alter table sm_sec_incidents add column if not exists rev bigint not null default 0;
    alter table sm_sec_incidents add column if not exists version integer not null default 1;
    alter table sm_sec_incidents add column if not exists deleted_at timestamptz;
    alter table sm_sec_incidents add column if not exists origin text;
    alter table sm_sec_incidents add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_incidents add column if not exists no integer;
    alter table sm_sec_incidents add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIR' || no::text else 'SIR' || lpad(no::text, 7, '0') end) stored;
    alter table sm_sec_incidents add column if not exists short_description text;
    alter table sm_sec_incidents add column if not exists description text;
    alter table sm_sec_incidents add column if not exists state text;
    alter table sm_sec_incidents add column if not exists priority text;
    alter table sm_sec_incidents add column if not exists impact text;
    alter table sm_sec_incidents add column if not exists urgency text;
    alter table sm_sec_incidents add column if not exists category text;
    alter table sm_sec_incidents add column if not exists subcategory text;
    alter table sm_sec_incidents add column if not exists channel text;
    alter table sm_sec_incidents add column if not exists caller_id uuid;
    alter table sm_sec_incidents add column if not exists requested_for uuid;
    alter table sm_sec_incidents add column if not exists opened_by uuid;
    alter table sm_sec_incidents add column if not exists opened_at timestamptz;
    alter table sm_sec_incidents add column if not exists assignment_group_id uuid;
    alter table sm_sec_incidents add column if not exists assigned_to uuid;
    alter table sm_sec_incidents add column if not exists service_id uuid;
    alter table sm_sec_incidents add column if not exists offering_id uuid;
    alter table sm_sec_incidents add column if not exists ci_id uuid;
    alter table sm_sec_incidents add column if not exists location_id uuid;
    alter table sm_sec_incidents add column if not exists due_at timestamptz;
    alter table sm_sec_incidents add column if not exists resolved_at timestamptz;
    alter table sm_sec_incidents add column if not exists resolved_by uuid;
    alter table sm_sec_incidents add column if not exists closed_at timestamptz;
    alter table sm_sec_incidents add column if not exists closed_by uuid;
    alter table sm_sec_incidents add column if not exists close_code text;
    alter table sm_sec_incidents add column if not exists close_notes text;
    alter table sm_sec_incidents add column if not exists parent_id uuid;
    alter table sm_sec_incidents add column if not exists watch_list jsonb;
    alter table sm_sec_incidents add column if not exists approval text;
    alter table sm_sec_incidents add column if not exists escalation integer;
    alter table sm_sec_incidents add column if not exists reassignment_count integer;
    alter table sm_sec_incidents add column if not exists reopen_count integer;
    alter table sm_sec_incidents add column if not exists time_worked bigint;
    alter table sm_sec_incidents add column if not exists first_response_at timestamptz;
    alter table sm_sec_incidents add column if not exists active boolean not null default true;
    alter table sm_sec_incidents add column if not exists sla_due timestamptz;
    alter table sm_sec_incidents add column if not exists knowledge boolean not null default false;
    alter table sm_sec_incidents add column if not exists severity text;
    alter table sm_sec_incidents add column if not exists business_impact text;
    alter table sm_sec_incidents add column if not exists classification text;
    alter table sm_sec_incidents add column if not exists risk_score integer;
    alter table sm_sec_incidents add column if not exists source text;
    alter table sm_sec_incidents add column if not exists attack_vector text;
    alter table sm_sec_incidents add column if not exists mitre_techniques jsonb;
    alter table sm_sec_incidents add column if not exists lead_id uuid;
    alter table sm_sec_incidents add column if not exists playbook_id uuid;
    alter table sm_sec_incidents add column if not exists major boolean not null default false;
    alter table sm_sec_incidents add column if not exists personal_data_breach boolean not null default false;
    alter table sm_sec_incidents add column if not exists records_affected integer;
    alter table sm_sec_incidents add column if not exists affected_users jsonb;
    alter table sm_sec_incidents add column if not exists affected_cis jsonb;
    alter table sm_sec_incidents add column if not exists affected_services jsonb;
    alter table sm_sec_incidents add column if not exists affected_data text;
    alter table sm_sec_incidents add column if not exists it_incident_id uuid;
    alter table sm_sec_incidents add column if not exists problem_id uuid;
    alter table sm_sec_incidents add column if not exists first_malicious_at timestamptz;
    alter table sm_sec_incidents add column if not exists detected_at timestamptz;
    alter table sm_sec_incidents add column if not exists contained_at timestamptz;
    alter table sm_sec_incidents add column if not exists eradicated_at timestamptz;
    alter table sm_sec_incidents add column if not exists recovered_at timestamptz;
    alter table sm_sec_incidents add column if not exists time_to_detect bigint;
    alter table sm_sec_incidents add column if not exists time_to_contain bigint;
    alter table sm_sec_incidents add column if not exists time_to_recover bigint;
    alter table sm_sec_incidents add column if not exists regulatory boolean not null default false;
    alter table sm_sec_incidents add column if not exists regulatory_overdue boolean not null default false;
    alter table sm_sec_incidents add column if not exists root_cause text;
    alter table sm_sec_incidents add column if not exists actions_taken text;
    alter table sm_sec_incidents add column if not exists lessons text;
    alter table sm_sec_incidents add column if not exists pir_done_at timestamptz;
    alter table sm_sec_incidents add column if not exists confidential boolean not null default false;
    alter table sm_sec_incidents add column if not exists access_list jsonb;
  end if;
end
$cols$;
create table if not exists sm_sec_incidents (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIR' || no::text else 'SIR' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  severity text,
  business_impact text,
  classification text,
  risk_score integer,
  source text,
  attack_vector text,
  mitre_techniques jsonb,
  lead_id uuid,
  playbook_id uuid,
  major boolean not null default false,
  personal_data_breach boolean not null default false,
  records_affected integer,
  affected_users jsonb,
  affected_cis jsonb,
  affected_services jsonb,
  affected_data text,
  it_incident_id uuid,
  problem_id uuid,
  first_malicious_at timestamptz,
  detected_at timestamptz,
  contained_at timestamptz,
  eradicated_at timestamptz,
  recovered_at timestamptz,
  time_to_detect bigint,
  time_to_contain bigint,
  time_to_recover bigint,
  regulatory boolean not null default false,
  regulatory_overdue boolean not null default false,
  root_cause text,
  actions_taken text,
  lessons text,
  pir_done_at timestamptz,
  confidential boolean not null default false,
  access_list jsonb,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_incidents' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_incidents', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_incidents', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_incidents' and indexname like 'sm\_sec\_incidents\_search\_%' and indexname not in ('sm_sec_incidents_search_f3bce210_trgm', 'sm_sec_incidents_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_incidents_search_f3bce210_trgm', 'sm_sec_incidents', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_incidents_search_custom_trgm', 'sm_sec_incidents', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_incidents_no_uk on sm_sec_incidents (org_id, no);
create index if not exists sm_sec_incidents_rev_idx on sm_sec_incidents (org_id, rev);
create index if not exists sm_sec_incidents_upd_idx on sm_sec_incidents (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_incidents_crt_idx on sm_sec_incidents (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_incidents_state_idx on sm_sec_incidents (org_id, state) where deleted_at is null;
create index if not exists sm_sec_incidents_caller_id_idx on sm_sec_incidents (org_id, caller_id) where deleted_at is null;
create index if not exists sm_sec_incidents_assignment_group_id_idx on sm_sec_incidents (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_incidents_assigned_to_idx on sm_sec_incidents (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_sec_incidents_lead_id_idx on sm_sec_incidents (org_id, lead_id) where deleted_at is null;
create index if not exists sm_sec_incidents_it_incident_id_idx on sm_sec_incidents (org_id, it_incident_id) where deleted_at is null;
create index if not exists sm_sec_incidents_workspace_acc_idx on sm_sec_incidents (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_incidents_unit_acc_idx on sm_sec_incidents (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_incidents_domain_acc_idx on sm_sec_incidents (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_incidents_watch_list_gin on sm_sec_incidents using gin (watch_list);
create index if not exists sm_sec_incidents_open_grp_idx on sm_sec_incidents (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_sec_incidents_opened_brin on sm_sec_incidents using brin (opened_at);
drop trigger if exists sm_sec_incidents_sync on sm_sec_incidents;
create trigger sm_sec_incidents_sync before insert or update on sm_sec_incidents for each row execute function sm_sync_touch('sec_incident');
create or replace trigger sm_sec_incidents_demo after insert on sm_sec_incidents for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_incidents_demo_t after update or delete on sm_sec_incidents for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_incidents enable row level security;

-- sec_observable: نشانگرها و اطلاعات تهدید
do $cols$
begin
  if to_regclass('sm_sec_observables') is not null then
    alter table sm_sec_observables add column if not exists workspace_id uuid;
    alter table sm_sec_observables add column if not exists domain_id uuid;
    alter table sm_sec_observables add column if not exists unit_id uuid;
    alter table sm_sec_observables add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_observables add column if not exists created_by uuid;
    alter table sm_sec_observables add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_observables add column if not exists updated_by uuid;
    alter table sm_sec_observables add column if not exists rev bigint not null default 0;
    alter table sm_sec_observables add column if not exists version integer not null default 1;
    alter table sm_sec_observables add column if not exists deleted_at timestamptz;
    alter table sm_sec_observables add column if not exists origin text;
    alter table sm_sec_observables add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_observables add column if not exists value text;
    alter table sm_sec_observables add column if not exists type text;
    alter table sm_sec_observables add column if not exists normalized text;
    alter table sm_sec_observables add column if not exists verdict text;
    alter table sm_sec_observables add column if not exists confidence integer;
    alter table sm_sec_observables add column if not exists tlp text;
    alter table sm_sec_observables add column if not exists is_ioc boolean not null default false;
    alter table sm_sec_observables add column if not exists source text;
    alter table sm_sec_observables add column if not exists mitre jsonb;
    alter table sm_sec_observables add column if not exists incidents jsonb;
    alter table sm_sec_observables add column if not exists sightings integer;
    alter table sm_sec_observables add column if not exists first_seen timestamptz;
    alter table sm_sec_observables add column if not exists last_seen timestamptz;
    alter table sm_sec_observables add column if not exists expires_at timestamptz;
    alter table sm_sec_observables add column if not exists enrichment jsonb;
    alter table sm_sec_observables add column if not exists enriched_at timestamptz;
    alter table sm_sec_observables add column if not exists assignment_group_id uuid;
    alter table sm_sec_observables add column if not exists notes text;
  end if;
end
$cols$;
create table if not exists sm_sec_observables (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  value text,
  type text,
  normalized text,
  verdict text,
  confidence integer,
  tlp text,
  is_ioc boolean not null default false,
  source text,
  mitre jsonb,
  incidents jsonb,
  sightings integer,
  first_seen timestamptz,
  last_seen timestamptz,
  expires_at timestamptz,
  enrichment jsonb,
  enriched_at timestamptz,
  assignment_group_id uuid,
  notes text
);
create index if not exists sm_sec_observables_rev_idx on sm_sec_observables (org_id, rev);
create index if not exists sm_sec_observables_upd_idx on sm_sec_observables (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_observables_crt_idx on sm_sec_observables (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_observables_normalized_idx on sm_sec_observables (org_id, normalized) where deleted_at is null;
create index if not exists sm_sec_observables_assignment_group_id_idx on sm_sec_observables (org_id, assignment_group_id) where deleted_at is null;
create unique index if not exists sm_sec_observables_type_normalized_uk on sm_sec_observables (org_id, type, normalized) where deleted_at is null;
create index if not exists sm_sec_observables_workspace_acc_idx on sm_sec_observables (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_observables_unit_acc_idx on sm_sec_observables (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_observables_domain_acc_idx on sm_sec_observables (org_id, domain_id) where deleted_at is null and domain_id is not null;
drop trigger if exists sm_sec_observables_sync on sm_sec_observables;
create trigger sm_sec_observables_sync before insert or update on sm_sec_observables for each row execute function sm_sync_touch('sec_observable');
create or replace trigger sm_sec_observables_demo after insert on sm_sec_observables for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_observables_demo_t after update or delete on sm_sec_observables for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_observables enable row level security;

-- sec_playbook: دستورالعمل‌های پاسخ
do $cols$
begin
  if to_regclass('sm_sec_playbooks') is not null then
    alter table sm_sec_playbooks add column if not exists workspace_id uuid;
    alter table sm_sec_playbooks add column if not exists domain_id uuid;
    alter table sm_sec_playbooks add column if not exists unit_id uuid;
    alter table sm_sec_playbooks add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_playbooks add column if not exists created_by uuid;
    alter table sm_sec_playbooks add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_playbooks add column if not exists updated_by uuid;
    alter table sm_sec_playbooks add column if not exists rev bigint not null default 0;
    alter table sm_sec_playbooks add column if not exists version integer not null default 1;
    alter table sm_sec_playbooks add column if not exists deleted_at timestamptz;
    alter table sm_sec_playbooks add column if not exists origin text;
    alter table sm_sec_playbooks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_playbooks add column if not exists name text;
    alter table sm_sec_playbooks add column if not exists category text;
    alter table sm_sec_playbooks add column if not exists active boolean not null default true;
    alter table sm_sec_playbooks add column if not exists auto_apply boolean not null default true;
    alter table sm_sec_playbooks add column if not exists revision integer;
    alter table sm_sec_playbooks add column if not exists steps jsonb;
    alter table sm_sec_playbooks add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_sec_playbooks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  category text,
  active boolean not null default true,
  auto_apply boolean not null default true,
  revision integer,
  steps jsonb,
  description text
);
create index if not exists sm_sec_playbooks_rev_idx on sm_sec_playbooks (org_id, rev);
create index if not exists sm_sec_playbooks_upd_idx on sm_sec_playbooks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_playbooks_crt_idx on sm_sec_playbooks (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_sec_playbooks_sync on sm_sec_playbooks;
create trigger sm_sec_playbooks_sync before insert or update on sm_sec_playbooks for each row execute function sm_sync_touch('sec_playbook');
create or replace trigger sm_sec_playbooks_demo after insert on sm_sec_playbooks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_playbooks_demo_t after update or delete on sm_sec_playbooks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_playbooks enable row level security;

-- sec_reg_clock: ساعت‌های اطلاع‌رسانی الزامی
do $cols$
begin
  if to_regclass('sm_sec_reg_clocks') is not null then
    alter table sm_sec_reg_clocks add column if not exists workspace_id uuid;
    alter table sm_sec_reg_clocks add column if not exists domain_id uuid;
    alter table sm_sec_reg_clocks add column if not exists unit_id uuid;
    alter table sm_sec_reg_clocks add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_reg_clocks add column if not exists created_by uuid;
    alter table sm_sec_reg_clocks add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_reg_clocks add column if not exists updated_by uuid;
    alter table sm_sec_reg_clocks add column if not exists rev bigint not null default 0;
    alter table sm_sec_reg_clocks add column if not exists version integer not null default 1;
    alter table sm_sec_reg_clocks add column if not exists deleted_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists origin text;
    alter table sm_sec_reg_clocks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_reg_clocks add column if not exists no integer;
    alter table sm_sec_reg_clocks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'REG' || no::text else 'REG' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_reg_clocks add column if not exists sec_incident_id uuid;
    alter table sm_sec_reg_clocks add column if not exists regime_id uuid;
    alter table sm_sec_reg_clocks add column if not exists aware_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists authority text;
    alter table sm_sec_reg_clocks add column if not exists owner_id uuid;
    alter table sm_sec_reg_clocks add column if not exists next_stage text;
    alter table sm_sec_reg_clocks add column if not exists next_due_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists overdue boolean not null default false;
    alter table sm_sec_reg_clocks add column if not exists deadlines jsonb;
    alter table sm_sec_reg_clocks add column if not exists reference text;
    alter table sm_sec_reg_clocks add column if not exists submitted_at timestamptz;
    alter table sm_sec_reg_clocks add column if not exists assignment_group_id uuid;
    alter table sm_sec_reg_clocks add column if not exists notes text;
    alter table sm_sec_reg_clocks add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_reg_clocks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'REG' || no::text else 'REG' || lpad(no::text, 6, '0') end) stored,
  sec_incident_id uuid,
  regime_id uuid,
  aware_at timestamptz,
  authority text,
  owner_id uuid,
  next_stage text,
  next_due_at timestamptz,
  overdue boolean not null default false,
  deadlines jsonb,
  reference text,
  submitted_at timestamptz,
  assignment_group_id uuid,
  notes text,
  state text,
  search_18ed5af9 text generated always as (translate(coalesce(authority, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_reg_clocks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_18ed5af9' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_reg_clocks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_reg_clocks', 'search_18ed5af9', $x$translate(coalesce(authority, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_reg_clocks' and indexname like 'sm\_sec\_reg\_clocks\_search\_%' and indexname not in ('sm_sec_reg_clocks_search_18ed5af9_trgm', 'sm_sec_reg_clocks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_reg_clocks_search_18ed5af9_trgm', 'sm_sec_reg_clocks', 'search_18ed5af9', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_reg_clocks_search_custom_trgm', 'sm_sec_reg_clocks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_reg_clocks_no_uk on sm_sec_reg_clocks (org_id, no);
create index if not exists sm_sec_reg_clocks_rev_idx on sm_sec_reg_clocks (org_id, rev);
create index if not exists sm_sec_reg_clocks_upd_idx on sm_sec_reg_clocks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_crt_idx on sm_sec_reg_clocks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_sec_incident_id_idx on sm_sec_reg_clocks (org_id, sec_incident_id) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_state_idx on sm_sec_reg_clocks (org_id, state) where deleted_at is null;
create index if not exists sm_sec_reg_clocks_workspace_acc_idx on sm_sec_reg_clocks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_reg_clocks_unit_acc_idx on sm_sec_reg_clocks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_reg_clocks_domain_acc_idx on sm_sec_reg_clocks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_reg_clocks_owner_id_idx on sm_sec_reg_clocks (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_sec_reg_clocks_sync on sm_sec_reg_clocks;
create trigger sm_sec_reg_clocks_sync before insert or update on sm_sec_reg_clocks for each row execute function sm_sync_touch('sec_reg_clock');
create or replace trigger sm_sec_reg_clocks_demo after insert on sm_sec_reg_clocks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_reg_clocks_demo_t after update or delete on sm_sec_reg_clocks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_reg_clocks enable row level security;

-- sec_reg_regime: مقررات اطلاع‌رسانی
do $cols$
begin
  if to_regclass('sm_sec_reg_regimes') is not null then
    alter table sm_sec_reg_regimes add column if not exists workspace_id uuid;
    alter table sm_sec_reg_regimes add column if not exists domain_id uuid;
    alter table sm_sec_reg_regimes add column if not exists unit_id uuid;
    alter table sm_sec_reg_regimes add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_reg_regimes add column if not exists created_by uuid;
    alter table sm_sec_reg_regimes add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_reg_regimes add column if not exists updated_by uuid;
    alter table sm_sec_reg_regimes add column if not exists rev bigint not null default 0;
    alter table sm_sec_reg_regimes add column if not exists version integer not null default 1;
    alter table sm_sec_reg_regimes add column if not exists deleted_at timestamptz;
    alter table sm_sec_reg_regimes add column if not exists origin text;
    alter table sm_sec_reg_regimes add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_reg_regimes add column if not exists name text;
    alter table sm_sec_reg_regimes add column if not exists key text;
    alter table sm_sec_reg_regimes add column if not exists active boolean not null default true;
    alter table sm_sec_reg_regimes add column if not exists authority text;
    alter table sm_sec_reg_regimes add column if not exists personal_data boolean not null default false;
    alter table sm_sec_reg_regimes add column if not exists placeholder boolean not null default false;
    alter table sm_sec_reg_regimes add column if not exists stages jsonb;
    alter table sm_sec_reg_regimes add column if not exists description text;
  end if;
end
$cols$;
create table if not exists sm_sec_reg_regimes (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  key text,
  active boolean not null default true,
  authority text,
  personal_data boolean not null default false,
  placeholder boolean not null default false,
  stages jsonb,
  description text
);
create index if not exists sm_sec_reg_regimes_rev_idx on sm_sec_reg_regimes (org_id, rev);
create index if not exists sm_sec_reg_regimes_upd_idx on sm_sec_reg_regimes (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reg_regimes_crt_idx on sm_sec_reg_regimes (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sec_reg_regimes_key_uk on sm_sec_reg_regimes (org_id, key) where deleted_at is null;
drop trigger if exists sm_sec_reg_regimes_sync on sm_sec_reg_regimes;
create trigger sm_sec_reg_regimes_sync before insert or update on sm_sec_reg_regimes for each row execute function sm_sync_touch('sec_reg_regime');
create or replace trigger sm_sec_reg_regimes_demo after insert on sm_sec_reg_regimes for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_reg_regimes_demo_t after update or delete on sm_sec_reg_regimes for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_reg_regimes enable row level security;

-- sec_review: بازبینی‌های امنیتی
do $cols$
begin
  if to_regclass('sm_sec_reviews') is not null then
    alter table sm_sec_reviews add column if not exists workspace_id uuid;
    alter table sm_sec_reviews add column if not exists domain_id uuid;
    alter table sm_sec_reviews add column if not exists unit_id uuid;
    alter table sm_sec_reviews add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_reviews add column if not exists created_by uuid;
    alter table sm_sec_reviews add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_reviews add column if not exists updated_by uuid;
    alter table sm_sec_reviews add column if not exists rev bigint not null default 0;
    alter table sm_sec_reviews add column if not exists version integer not null default 1;
    alter table sm_sec_reviews add column if not exists deleted_at timestamptz;
    alter table sm_sec_reviews add column if not exists origin text;
    alter table sm_sec_reviews add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_reviews add column if not exists no integer;
    alter table sm_sec_reviews add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SRV' || no::text else 'SRV' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_reviews add column if not exists title text;
    alter table sm_sec_reviews add column if not exists kind text;
    alter table sm_sec_reviews add column if not exists change_id uuid;
    alter table sm_sec_reviews add column if not exists due_at timestamptz;
    alter table sm_sec_reviews add column if not exists flags jsonb;
    alter table sm_sec_reviews add column if not exists reviewer_id uuid;
    alter table sm_sec_reviews add column if not exists assignment_group_id uuid;
    alter table sm_sec_reviews add column if not exists decision text;
    alter table sm_sec_reviews add column if not exists findings text;
    alter table sm_sec_reviews add column if not exists conditions text;
    alter table sm_sec_reviews add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_reviews (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SRV' || no::text else 'SRV' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  change_id uuid,
  due_at timestamptz,
  flags jsonb,
  reviewer_id uuid,
  assignment_group_id uuid,
  decision text,
  findings text,
  conditions text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_reviews' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_reviews', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_reviews', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_reviews' and indexname like 'sm\_sec\_reviews\_search\_%' and indexname not in ('sm_sec_reviews_search_cae18f1d_trgm', 'sm_sec_reviews_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_reviews_search_cae18f1d_trgm', 'sm_sec_reviews', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_reviews_search_custom_trgm', 'sm_sec_reviews', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_reviews_no_uk on sm_sec_reviews (org_id, no);
create index if not exists sm_sec_reviews_rev_idx on sm_sec_reviews (org_id, rev);
create index if not exists sm_sec_reviews_upd_idx on sm_sec_reviews (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reviews_crt_idx on sm_sec_reviews (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_reviews_change_id_idx on sm_sec_reviews (org_id, change_id) where deleted_at is null;
create index if not exists sm_sec_reviews_state_idx on sm_sec_reviews (org_id, state) where deleted_at is null;
create index if not exists sm_sec_reviews_workspace_acc_idx on sm_sec_reviews (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_reviews_unit_acc_idx on sm_sec_reviews (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_reviews_domain_acc_idx on sm_sec_reviews (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_reviews_reviewer_id_idx on sm_sec_reviews (org_id, reviewer_id) where deleted_at is null;
drop trigger if exists sm_sec_reviews_sync on sm_sec_reviews;
create trigger sm_sec_reviews_sync before insert or update on sm_sec_reviews for each row execute function sm_sync_touch('sec_review');
create or replace trigger sm_sec_reviews_demo after insert on sm_sec_reviews for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_reviews_demo_t after update or delete on sm_sec_reviews for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_reviews enable row level security;

-- sec_scan_import: ورودهای پویش
do $cols$
begin
  if to_regclass('sm_sec_scan_imports') is not null then
    alter table sm_sec_scan_imports add column if not exists workspace_id uuid;
    alter table sm_sec_scan_imports add column if not exists domain_id uuid;
    alter table sm_sec_scan_imports add column if not exists unit_id uuid;
    alter table sm_sec_scan_imports add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_scan_imports add column if not exists created_by uuid;
    alter table sm_sec_scan_imports add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_scan_imports add column if not exists updated_by uuid;
    alter table sm_sec_scan_imports add column if not exists rev bigint not null default 0;
    alter table sm_sec_scan_imports add column if not exists version integer not null default 1;
    alter table sm_sec_scan_imports add column if not exists deleted_at timestamptz;
    alter table sm_sec_scan_imports add column if not exists origin text;
    alter table sm_sec_scan_imports add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_scan_imports add column if not exists no integer;
    alter table sm_sec_scan_imports add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SCN' || no::text else 'SCN' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_scan_imports add column if not exists name text;
    alter table sm_sec_scan_imports add column if not exists scanner text;
    alter table sm_sec_scan_imports add column if not exists format text;
    alter table sm_sec_scan_imports add column if not exists imported_at timestamptz;
    alter table sm_sec_scan_imports add column if not exists imported_by uuid;
    alter table sm_sec_scan_imports add column if not exists hosts integer;
    alter table sm_sec_scan_imports add column if not exists finding_count integer;
    alter table sm_sec_scan_imports add column if not exists created_count integer;
    alter table sm_sec_scan_imports add column if not exists updated_count integer;
    alter table sm_sec_scan_imports add column if not exists reopened_count integer;
    alter table sm_sec_scan_imports add column if not exists closed_count integer;
    alter table sm_sec_scan_imports add column if not exists unmatched_count integer;
    alter table sm_sec_scan_imports add column if not exists skipped_count integer;
    alter table sm_sec_scan_imports add column if not exists covered_cis jsonb;
    alter table sm_sec_scan_imports add column if not exists errors jsonb;
  end if;
end
$cols$;
create table if not exists sm_sec_scan_imports (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'SCN' || no::text else 'SCN' || lpad(no::text, 6, '0') end) stored,
  name text,
  scanner text,
  format text,
  imported_at timestamptz,
  imported_by uuid,
  hosts integer,
  finding_count integer,
  created_count integer,
  updated_count integer,
  reopened_count integer,
  closed_count integer,
  unmatched_count integer,
  skipped_count integer,
  covered_cis jsonb,
  errors jsonb,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_scan_imports' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_scan_imports', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_scan_imports', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_scan_imports' and indexname like 'sm\_sec\_scan\_imports\_search\_%' and indexname not in ('sm_sec_scan_imports_search_56291d9d_trgm', 'sm_sec_scan_imports_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_scan_imports_search_56291d9d_trgm', 'sm_sec_scan_imports', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_scan_imports_search_custom_trgm', 'sm_sec_scan_imports', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_scan_imports_no_uk on sm_sec_scan_imports (org_id, no);
create index if not exists sm_sec_scan_imports_rev_idx on sm_sec_scan_imports (org_id, rev);
create index if not exists sm_sec_scan_imports_upd_idx on sm_sec_scan_imports (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_scan_imports_crt_idx on sm_sec_scan_imports (org_id, created_at desc, id desc) where deleted_at is null;
drop trigger if exists sm_sec_scan_imports_sync on sm_sec_scan_imports;
create trigger sm_sec_scan_imports_sync before insert or update on sm_sec_scan_imports for each row execute function sm_sync_touch('sec_scan_import');
create or replace trigger sm_sec_scan_imports_demo after insert on sm_sec_scan_imports for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_scan_imports_demo_t after update or delete on sm_sec_scan_imports for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_scan_imports enable row level security;

-- sec_task: کارهای پاسخ
do $cols$
begin
  if to_regclass('sm_sec_tasks') is not null then
    alter table sm_sec_tasks add column if not exists workspace_id uuid;
    alter table sm_sec_tasks add column if not exists domain_id uuid;
    alter table sm_sec_tasks add column if not exists unit_id uuid;
    alter table sm_sec_tasks add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_tasks add column if not exists created_by uuid;
    alter table sm_sec_tasks add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_tasks add column if not exists updated_by uuid;
    alter table sm_sec_tasks add column if not exists rev bigint not null default 0;
    alter table sm_sec_tasks add column if not exists version integer not null default 1;
    alter table sm_sec_tasks add column if not exists deleted_at timestamptz;
    alter table sm_sec_tasks add column if not exists origin text;
    alter table sm_sec_tasks add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_tasks add column if not exists no integer;
    alter table sm_sec_tasks add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIT' || no::text else 'SIT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_sec_tasks add column if not exists short_description text;
    alter table sm_sec_tasks add column if not exists description text;
    alter table sm_sec_tasks add column if not exists state text;
    alter table sm_sec_tasks add column if not exists priority text;
    alter table sm_sec_tasks add column if not exists impact text;
    alter table sm_sec_tasks add column if not exists urgency text;
    alter table sm_sec_tasks add column if not exists category text;
    alter table sm_sec_tasks add column if not exists subcategory text;
    alter table sm_sec_tasks add column if not exists channel text;
    alter table sm_sec_tasks add column if not exists caller_id uuid;
    alter table sm_sec_tasks add column if not exists requested_for uuid;
    alter table sm_sec_tasks add column if not exists opened_by uuid;
    alter table sm_sec_tasks add column if not exists opened_at timestamptz;
    alter table sm_sec_tasks add column if not exists assignment_group_id uuid;
    alter table sm_sec_tasks add column if not exists assigned_to uuid;
    alter table sm_sec_tasks add column if not exists service_id uuid;
    alter table sm_sec_tasks add column if not exists offering_id uuid;
    alter table sm_sec_tasks add column if not exists ci_id uuid;
    alter table sm_sec_tasks add column if not exists location_id uuid;
    alter table sm_sec_tasks add column if not exists due_at timestamptz;
    alter table sm_sec_tasks add column if not exists resolved_at timestamptz;
    alter table sm_sec_tasks add column if not exists resolved_by uuid;
    alter table sm_sec_tasks add column if not exists closed_at timestamptz;
    alter table sm_sec_tasks add column if not exists closed_by uuid;
    alter table sm_sec_tasks add column if not exists close_code text;
    alter table sm_sec_tasks add column if not exists close_notes text;
    alter table sm_sec_tasks add column if not exists parent_id uuid;
    alter table sm_sec_tasks add column if not exists watch_list jsonb;
    alter table sm_sec_tasks add column if not exists approval text;
    alter table sm_sec_tasks add column if not exists escalation integer;
    alter table sm_sec_tasks add column if not exists reassignment_count integer;
    alter table sm_sec_tasks add column if not exists reopen_count integer;
    alter table sm_sec_tasks add column if not exists time_worked bigint;
    alter table sm_sec_tasks add column if not exists first_response_at timestamptz;
    alter table sm_sec_tasks add column if not exists active boolean not null default true;
    alter table sm_sec_tasks add column if not exists sla_due timestamptz;
    alter table sm_sec_tasks add column if not exists knowledge boolean not null default false;
    alter table sm_sec_tasks add column if not exists sec_incident_id uuid;
    alter table sm_sec_tasks add column if not exists phase text;
    alter table sm_sec_tasks add column if not exists mandatory boolean not null default true;
    alter table sm_sec_tasks add column if not exists sort_order integer;
    alter table sm_sec_tasks add column if not exists action text;
    alter table sm_sec_tasks add column if not exists action_target text;
    alter table sm_sec_tasks add column if not exists requires_approval boolean not null default false;
    alter table sm_sec_tasks add column if not exists executed_at timestamptz;
    alter table sm_sec_tasks add column if not exists executed_by uuid;
    alter table sm_sec_tasks add column if not exists started_by uuid;
    alter table sm_sec_tasks add column if not exists action_result text;
  end if;
end
$cols$;
create table if not exists sm_sec_tasks (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'SIT' || no::text else 'SIT' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  sec_incident_id uuid,
  phase text,
  mandatory boolean not null default true,
  sort_order integer,
  action text,
  action_target text,
  requires_approval boolean not null default false,
  executed_at timestamptz,
  executed_by uuid,
  started_by uuid,
  action_result text,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_tasks' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_tasks', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_tasks', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_tasks' and indexname like 'sm\_sec\_tasks\_search\_%' and indexname not in ('sm_sec_tasks_search_f3bce210_trgm', 'sm_sec_tasks_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_tasks_search_f3bce210_trgm', 'sm_sec_tasks', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_tasks_search_custom_trgm', 'sm_sec_tasks', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_tasks_no_uk on sm_sec_tasks (org_id, no);
create index if not exists sm_sec_tasks_rev_idx on sm_sec_tasks (org_id, rev);
create index if not exists sm_sec_tasks_upd_idx on sm_sec_tasks (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_tasks_crt_idx on sm_sec_tasks (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_tasks_state_idx on sm_sec_tasks (org_id, state) where deleted_at is null;
create index if not exists sm_sec_tasks_assignment_group_id_idx on sm_sec_tasks (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_tasks_assigned_to_idx on sm_sec_tasks (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_sec_tasks_sec_incident_id_idx on sm_sec_tasks (org_id, sec_incident_id) where deleted_at is null;
create index if not exists sm_sec_tasks_workspace_acc_idx on sm_sec_tasks (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_tasks_unit_acc_idx on sm_sec_tasks (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_tasks_domain_acc_idx on sm_sec_tasks (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_tasks_caller_id_idx on sm_sec_tasks (org_id, caller_id) where deleted_at is null;
create index if not exists sm_sec_tasks_requested_for_idx on sm_sec_tasks (org_id, requested_for) where deleted_at is null;
create index if not exists sm_sec_tasks_opened_by_idx on sm_sec_tasks (org_id, opened_by) where deleted_at is null;
create index if not exists sm_sec_tasks_watch_list_gin on sm_sec_tasks using gin (watch_list);
create index if not exists sm_sec_tasks_open_grp_idx on sm_sec_tasks (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_sec_tasks_opened_brin on sm_sec_tasks using brin (opened_at);
drop trigger if exists sm_sec_tasks_sync on sm_sec_tasks;
create trigger sm_sec_tasks_sync before insert or update on sm_sec_tasks for each row execute function sm_sync_touch('sec_task');
create or replace trigger sm_sec_tasks_demo after insert on sm_sec_tasks for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_tasks_demo_t after update or delete on sm_sec_tasks for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_tasks enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:21', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

-- ---------------------------------------------------------------------------
-- 0006_engine_tables — جدول‌های رکوردها (ساخته‌شده از تعریف جدول‌ها) — بخش ۲۳ از ۳۰
-- ---------------------------------------------------------------------------
-- engine DDL 23/30 (a0c3bc7de847)
-- sec_verification: احراز هویت‌های تماس‌گیرنده
do $cols$
begin
  if to_regclass('sm_sec_verifications') is not null then
    alter table sm_sec_verifications add column if not exists workspace_id uuid;
    alter table sm_sec_verifications add column if not exists domain_id uuid;
    alter table sm_sec_verifications add column if not exists unit_id uuid;
    alter table sm_sec_verifications add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_verifications add column if not exists created_by uuid;
    alter table sm_sec_verifications add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_verifications add column if not exists updated_by uuid;
    alter table sm_sec_verifications add column if not exists rev bigint not null default 0;
    alter table sm_sec_verifications add column if not exists version integer not null default 1;
    alter table sm_sec_verifications add column if not exists deleted_at timestamptz;
    alter table sm_sec_verifications add column if not exists origin text;
    alter table sm_sec_verifications add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_verifications add column if not exists user_id uuid;
    alter table sm_sec_verifications add column if not exists record_table text;
    alter table sm_sec_verifications add column if not exists record_id text;
    alter table sm_sec_verifications add column if not exists record_number text;
    alter table sm_sec_verifications add column if not exists channel text;
    alter table sm_sec_verifications add column if not exists status text;
    alter table sm_sec_verifications add column if not exists code_hash text;
    alter table sm_sec_verifications add column if not exists expires_at timestamptz;
    alter table sm_sec_verifications add column if not exists attempts integer;
    alter table sm_sec_verifications add column if not exists requested_by uuid;
    alter table sm_sec_verifications add column if not exists verified_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_sec_verifications (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  user_id uuid,
  record_table text,
  record_id text,
  record_number text,
  channel text,
  status text,
  code_hash text,
  expires_at timestamptz,
  attempts integer,
  requested_by uuid,
  verified_at timestamptz
);
create index if not exists sm_sec_verifications_rev_idx on sm_sec_verifications (org_id, rev);
create index if not exists sm_sec_verifications_upd_idx on sm_sec_verifications (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_verifications_crt_idx on sm_sec_verifications (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_verifications_user_id_idx on sm_sec_verifications (org_id, user_id) where deleted_at is null;
create index if not exists sm_sec_verifications_record_id_idx on sm_sec_verifications (org_id, record_id) where deleted_at is null;
create index if not exists sm_sec_verifications_workspace_acc_idx on sm_sec_verifications (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_verifications_unit_acc_idx on sm_sec_verifications (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_verifications_domain_acc_idx on sm_sec_verifications (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_verifications_requested_by_idx on sm_sec_verifications (org_id, requested_by) where deleted_at is null;
drop trigger if exists sm_sec_verifications_sync on sm_sec_verifications;
create trigger sm_sec_verifications_sync before insert or update on sm_sec_verifications for each row execute function sm_sync_touch('sec_verification');
create or replace trigger sm_sec_verifications_demo after insert on sm_sec_verifications for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_verifications_demo_t after update or delete on sm_sec_verifications for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_verifications enable row level security;

-- sec_vuln_exception: استثناهای آسیب‌پذیری
do $cols$
begin
  if to_regclass('sm_sec_vuln_exceptions') is not null then
    alter table sm_sec_vuln_exceptions add column if not exists workspace_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists domain_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists unit_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vuln_exceptions add column if not exists created_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vuln_exceptions add column if not exists updated_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists rev bigint not null default 0;
    alter table sm_sec_vuln_exceptions add column if not exists version integer not null default 1;
    alter table sm_sec_vuln_exceptions add column if not exists deleted_at timestamptz;
    alter table sm_sec_vuln_exceptions add column if not exists origin text;
    alter table sm_sec_vuln_exceptions add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vuln_exceptions add column if not exists no integer;
    alter table sm_sec_vuln_exceptions add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EXC' || no::text else 'EXC' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_vuln_exceptions add column if not exists title text;
    alter table sm_sec_vuln_exceptions add column if not exists kind text;
    alter table sm_sec_vuln_exceptions add column if not exists vulnerability_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists expires_at date;
    alter table sm_sec_vuln_exceptions add column if not exists items jsonb;
    alter table sm_sec_vuln_exceptions add column if not exists justification text;
    alter table sm_sec_vuln_exceptions add column if not exists vex_justification text;
    alter table sm_sec_vuln_exceptions add column if not exists compensating_controls text;
    alter table sm_sec_vuln_exceptions add column if not exists requested_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists approver_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists assignment_group_id uuid;
    alter table sm_sec_vuln_exceptions add column if not exists approval text;
    alter table sm_sec_vuln_exceptions add column if not exists approved_at timestamptz;
    alter table sm_sec_vuln_exceptions add column if not exists approved_by uuid;
    alter table sm_sec_vuln_exceptions add column if not exists warned_at timestamptz;
    alter table sm_sec_vuln_exceptions add column if not exists notes text;
    alter table sm_sec_vuln_exceptions add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_vuln_exceptions (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'EXC' || no::text else 'EXC' || lpad(no::text, 6, '0') end) stored,
  title text,
  kind text,
  vulnerability_id uuid,
  expires_at date,
  items jsonb,
  justification text,
  vex_justification text,
  compensating_controls text,
  requested_by uuid,
  approver_id uuid,
  assignment_group_id uuid,
  approval text,
  approved_at timestamptz,
  approved_by uuid,
  warned_at timestamptz,
  notes text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_vuln_exceptions' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_vuln_exceptions', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_vuln_exceptions', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_vuln_exceptions' and indexname like 'sm\_sec\_vuln\_exceptions\_search\_%' and indexname not in ('sm_sec_vuln_exceptions_search_cae18f1d_trgm', 'sm_sec_vuln_exceptions_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_vuln_exceptions_search_cae18f1d_trgm', 'sm_sec_vuln_exceptions', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_vuln_exceptions_search_custom_trgm', 'sm_sec_vuln_exceptions', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_vuln_exceptions_no_uk on sm_sec_vuln_exceptions (org_id, no);
create index if not exists sm_sec_vuln_exceptions_rev_idx on sm_sec_vuln_exceptions (org_id, rev);
create index if not exists sm_sec_vuln_exceptions_upd_idx on sm_sec_vuln_exceptions (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_crt_idx on sm_sec_vuln_exceptions (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_state_idx on sm_sec_vuln_exceptions (org_id, state) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_workspace_acc_idx on sm_sec_vuln_exceptions (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_vuln_exceptions_unit_acc_idx on sm_sec_vuln_exceptions (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_vuln_exceptions_domain_acc_idx on sm_sec_vuln_exceptions (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_vuln_exceptions_requested_by_idx on sm_sec_vuln_exceptions (org_id, requested_by) where deleted_at is null;
create index if not exists sm_sec_vuln_exceptions_approver_id_idx on sm_sec_vuln_exceptions (org_id, approver_id) where deleted_at is null;
drop trigger if exists sm_sec_vuln_exceptions_sync on sm_sec_vuln_exceptions;
create trigger sm_sec_vuln_exceptions_sync before insert or update on sm_sec_vuln_exceptions for each row execute function sm_sync_touch('sec_vuln_exception');
create or replace trigger sm_sec_vuln_exceptions_demo after insert on sm_sec_vuln_exceptions for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vuln_exceptions_demo_t after update or delete on sm_sec_vuln_exceptions for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vuln_exceptions enable row level security;

-- sec_vuln_item: موردهای آسیب‌پذیر
do $cols$
begin
  if to_regclass('sm_sec_vuln_items') is not null then
    alter table sm_sec_vuln_items add column if not exists workspace_id uuid;
    alter table sm_sec_vuln_items add column if not exists domain_id uuid;
    alter table sm_sec_vuln_items add column if not exists unit_id uuid;
    alter table sm_sec_vuln_items add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vuln_items add column if not exists created_by uuid;
    alter table sm_sec_vuln_items add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vuln_items add column if not exists updated_by uuid;
    alter table sm_sec_vuln_items add column if not exists rev bigint not null default 0;
    alter table sm_sec_vuln_items add column if not exists version integer not null default 1;
    alter table sm_sec_vuln_items add column if not exists deleted_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists origin text;
    alter table sm_sec_vuln_items add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vuln_items add column if not exists no integer;
    alter table sm_sec_vuln_items add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'VIT' || no::text else 'VIT' || lpad(no::text, 7, '0') end) stored;
    alter table sm_sec_vuln_items add column if not exists title text;
    alter table sm_sec_vuln_items add column if not exists vulnerability_id uuid;
    alter table sm_sec_vuln_items add column if not exists ci_id uuid;
    alter table sm_sec_vuln_items add column if not exists host text;
    alter table sm_sec_vuln_items add column if not exists ip_address text;
    alter table sm_sec_vuln_items add column if not exists port integer;
    alter table sm_sec_vuln_items add column if not exists protocol text;
    alter table sm_sec_vuln_items add column if not exists service_id uuid;
    alter table sm_sec_vuln_items add column if not exists source text;
    alter table sm_sec_vuln_items add column if not exists scanner_ref text;
    alter table sm_sec_vuln_items add column if not exists dedupe_key text;
    alter table sm_sec_vuln_items add column if not exists first_detected_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists last_seen_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists times_seen integer;
    alter table sm_sec_vuln_items add column if not exists last_scan_id uuid;
    alter table sm_sec_vuln_items add column if not exists missing_since timestamptz;
    alter table sm_sec_vuln_items add column if not exists proof text;
    alter table sm_sec_vuln_items add column if not exists cvss_score numeric;
    alter table sm_sec_vuln_items add column if not exists epss numeric;
    alter table sm_sec_vuln_items add column if not exists kev boolean not null default false;
    alter table sm_sec_vuln_items add column if not exists asset_criticality text;
    alter table sm_sec_vuln_items add column if not exists exposure text;
    alter table sm_sec_vuln_items add column if not exists compensating text;
    alter table sm_sec_vuln_items add column if not exists risk_score integer;
    alter table sm_sec_vuln_items add column if not exists risk_rating text;
    alter table sm_sec_vuln_items add column if not exists ssvc text;
    alter table sm_sec_vuln_items add column if not exists risk_factors jsonb;
    alter table sm_sec_vuln_items add column if not exists due_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists overdue boolean not null default false;
    alter table sm_sec_vuln_items add column if not exists sla_due timestamptz;
    alter table sm_sec_vuln_items add column if not exists assignment_group_id uuid;
    alter table sm_sec_vuln_items add column if not exists assigned_to uuid;
    alter table sm_sec_vuln_items add column if not exists remediation_id uuid;
    alter table sm_sec_vuln_items add column if not exists change_id uuid;
    alter table sm_sec_vuln_items add column if not exists exception_id uuid;
    alter table sm_sec_vuln_items add column if not exists vex_status text;
    alter table sm_sec_vuln_items add column if not exists vex_justification text;
    alter table sm_sec_vuln_items add column if not exists fixed_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists verified_at timestamptz;
    alter table sm_sec_vuln_items add column if not exists reopen_count integer;
    alter table sm_sec_vuln_items add column if not exists close_notes text;
    alter table sm_sec_vuln_items add column if not exists watch_list jsonb;
    alter table sm_sec_vuln_items add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_vuln_items (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'VIT' || no::text else 'VIT' || lpad(no::text, 7, '0') end) stored,
  title text,
  vulnerability_id uuid,
  ci_id uuid,
  host text,
  ip_address text,
  port integer,
  protocol text,
  service_id uuid,
  source text,
  scanner_ref text,
  dedupe_key text,
  first_detected_at timestamptz,
  last_seen_at timestamptz,
  times_seen integer,
  last_scan_id uuid,
  missing_since timestamptz,
  proof text,
  cvss_score numeric,
  epss numeric,
  kev boolean not null default false,
  asset_criticality text,
  exposure text,
  compensating text,
  risk_score integer,
  risk_rating text,
  ssvc text,
  risk_factors jsonb,
  due_at timestamptz,
  overdue boolean not null default false,
  sla_due timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  remediation_id uuid,
  change_id uuid,
  exception_id uuid,
  vex_status text,
  vex_justification text,
  fixed_at timestamptz,
  verified_at timestamptz,
  reopen_count integer,
  close_notes text,
  watch_list jsonb,
  state text,
  search_cf51b86c text generated always as (translate(coalesce(title, '') || ' ' || coalesce(host, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_vuln_items' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cf51b86c' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_vuln_items', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_vuln_items', 'search_cf51b86c', $x$translate(coalesce(title, '') || ' ' || coalesce(host, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_vuln_items' and indexname like 'sm\_sec\_vuln\_items\_search\_%' and indexname not in ('sm_sec_vuln_items_search_cf51b86c_trgm', 'sm_sec_vuln_items_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_vuln_items_search_cf51b86c_trgm', 'sm_sec_vuln_items', 'search_cf51b86c', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_vuln_items_search_custom_trgm', 'sm_sec_vuln_items', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_vuln_items_no_uk on sm_sec_vuln_items (org_id, no);
create index if not exists sm_sec_vuln_items_rev_idx on sm_sec_vuln_items (org_id, rev);
create index if not exists sm_sec_vuln_items_upd_idx on sm_sec_vuln_items (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_items_crt_idx on sm_sec_vuln_items (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_items_vulnerability_id_idx on sm_sec_vuln_items (org_id, vulnerability_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_ci_id_idx on sm_sec_vuln_items (org_id, ci_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_host_idx on sm_sec_vuln_items (org_id, host) where deleted_at is null;
create index if not exists sm_sec_vuln_items_dedupe_key_idx on sm_sec_vuln_items (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_sec_vuln_items_risk_rating_idx on sm_sec_vuln_items (org_id, risk_rating) where deleted_at is null;
create index if not exists sm_sec_vuln_items_assignment_group_id_idx on sm_sec_vuln_items (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_assigned_to_idx on sm_sec_vuln_items (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_sec_vuln_items_remediation_id_idx on sm_sec_vuln_items (org_id, remediation_id) where deleted_at is null;
create index if not exists sm_sec_vuln_items_state_idx on sm_sec_vuln_items (org_id, state) where deleted_at is null;
create unique index if not exists sm_sec_vuln_items_dedupe_key_uk on sm_sec_vuln_items (org_id, dedupe_key) where deleted_at is null;
create index if not exists sm_sec_vuln_items_workspace_acc_idx on sm_sec_vuln_items (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_vuln_items_unit_acc_idx on sm_sec_vuln_items (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_vuln_items_domain_acc_idx on sm_sec_vuln_items (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_vuln_items_watch_list_gin on sm_sec_vuln_items using gin (watch_list);
drop trigger if exists sm_sec_vuln_items_sync on sm_sec_vuln_items;
create trigger sm_sec_vuln_items_sync before insert or update on sm_sec_vuln_items for each row execute function sm_sync_touch('sec_vuln_item');
create or replace trigger sm_sec_vuln_items_demo after insert on sm_sec_vuln_items for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vuln_items_demo_t after update or delete on sm_sec_vuln_items for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vuln_items enable row level security;

-- sec_vuln_remediation: گروه‌های رفع آسیب‌پذیری
do $cols$
begin
  if to_regclass('sm_sec_vuln_remediations') is not null then
    alter table sm_sec_vuln_remediations add column if not exists workspace_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists domain_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists unit_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vuln_remediations add column if not exists created_by uuid;
    alter table sm_sec_vuln_remediations add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vuln_remediations add column if not exists updated_by uuid;
    alter table sm_sec_vuln_remediations add column if not exists rev bigint not null default 0;
    alter table sm_sec_vuln_remediations add column if not exists version integer not null default 1;
    alter table sm_sec_vuln_remediations add column if not exists deleted_at timestamptz;
    alter table sm_sec_vuln_remediations add column if not exists origin text;
    alter table sm_sec_vuln_remediations add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vuln_remediations add column if not exists no integer;
    alter table sm_sec_vuln_remediations add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 6 then 'VG' || no::text else 'VG' || lpad(no::text, 6, '0') end) stored;
    alter table sm_sec_vuln_remediations add column if not exists title text;
    alter table sm_sec_vuln_remediations add column if not exists vulnerability_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists basis text;
    alter table sm_sec_vuln_remediations add column if not exists assignment_group_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists assigned_to uuid;
    alter table sm_sec_vuln_remediations add column if not exists due_at timestamptz;
    alter table sm_sec_vuln_remediations add column if not exists item_count integer;
    alter table sm_sec_vuln_remediations add column if not exists open_count integer;
    alter table sm_sec_vuln_remediations add column if not exists change_id uuid;
    alter table sm_sec_vuln_remediations add column if not exists solution text;
    alter table sm_sec_vuln_remediations add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_sec_vuln_remediations (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 6 then 'VG' || no::text else 'VG' || lpad(no::text, 6, '0') end) stored,
  title text,
  vulnerability_id uuid,
  basis text,
  assignment_group_id uuid,
  assigned_to uuid,
  due_at timestamptz,
  item_count integer,
  open_count integer,
  change_id uuid,
  solution text,
  state text,
  search_cae18f1d text generated always as (translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_sec_vuln_remediations' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_cae18f1d' loop
    execute format('alter table %I drop column if exists %I', 'sm_sec_vuln_remediations', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_sec_vuln_remediations', 'search_cae18f1d', $x$translate(coalesce(title, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_sec_vuln_remediations' and indexname like 'sm\_sec\_vuln\_remediations\_search\_%' and indexname not in ('sm_sec_vuln_remediations_search_cae18f1d_trgm', 'sm_sec_vuln_remediations_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_sec_vuln_remediations_search_cae18f1d_trgm', 'sm_sec_vuln_remediations', 'search_cae18f1d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_sec_vuln_remediations_search_custom_trgm', 'sm_sec_vuln_remediations', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_sec_vuln_remediations_no_uk on sm_sec_vuln_remediations (org_id, no);
create index if not exists sm_sec_vuln_remediations_rev_idx on sm_sec_vuln_remediations (org_id, rev);
create index if not exists sm_sec_vuln_remediations_upd_idx on sm_sec_vuln_remediations (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_crt_idx on sm_sec_vuln_remediations (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_vulnerability_id_idx on sm_sec_vuln_remediations (org_id, vulnerability_id) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_assignment_group_id_idx on sm_sec_vuln_remediations (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_state_idx on sm_sec_vuln_remediations (org_id, state) where deleted_at is null;
create index if not exists sm_sec_vuln_remediations_workspace_acc_idx on sm_sec_vuln_remediations (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_sec_vuln_remediations_unit_acc_idx on sm_sec_vuln_remediations (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_sec_vuln_remediations_domain_acc_idx on sm_sec_vuln_remediations (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_sec_vuln_remediations_assigned_to_idx on sm_sec_vuln_remediations (org_id, assigned_to) where deleted_at is null;
drop trigger if exists sm_sec_vuln_remediations_sync on sm_sec_vuln_remediations;
create trigger sm_sec_vuln_remediations_sync before insert or update on sm_sec_vuln_remediations for each row execute function sm_sync_touch('sec_vuln_remediation');
create or replace trigger sm_sec_vuln_remediations_demo after insert on sm_sec_vuln_remediations for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vuln_remediations_demo_t after update or delete on sm_sec_vuln_remediations for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vuln_remediations enable row level security;

-- sec_vulnerability: کتابخانهٔ آسیب‌پذیری‌ها
do $cols$
begin
  if to_regclass('sm_sec_vulnerabilities') is not null then
    alter table sm_sec_vulnerabilities add column if not exists workspace_id uuid;
    alter table sm_sec_vulnerabilities add column if not exists domain_id uuid;
    alter table sm_sec_vulnerabilities add column if not exists unit_id uuid;
    alter table sm_sec_vulnerabilities add column if not exists created_at timestamptz not null default now();
    alter table sm_sec_vulnerabilities add column if not exists created_by uuid;
    alter table sm_sec_vulnerabilities add column if not exists updated_at timestamptz not null default now();
    alter table sm_sec_vulnerabilities add column if not exists updated_by uuid;
    alter table sm_sec_vulnerabilities add column if not exists rev bigint not null default 0;
    alter table sm_sec_vulnerabilities add column if not exists version integer not null default 1;
    alter table sm_sec_vulnerabilities add column if not exists deleted_at timestamptz;
    alter table sm_sec_vulnerabilities add column if not exists origin text;
    alter table sm_sec_vulnerabilities add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_sec_vulnerabilities add column if not exists cve_id text;
    alter table sm_sec_vulnerabilities add column if not exists title text;
    alter table sm_sec_vulnerabilities add column if not exists severity text;
    alter table sm_sec_vulnerabilities add column if not exists cvss_score numeric;
    alter table sm_sec_vulnerabilities add column if not exists cvss_version text;
    alter table sm_sec_vulnerabilities add column if not exists cvss_vector text;
    alter table sm_sec_vulnerabilities add column if not exists epss numeric;
    alter table sm_sec_vulnerabilities add column if not exists epss_percentile numeric;
    alter table sm_sec_vulnerabilities add column if not exists kev boolean not null default false;
    alter table sm_sec_vulnerabilities add column if not exists kev_due date;
    alter table sm_sec_vulnerabilities add column if not exists exploit_maturity text;
    alter table sm_sec_vulnerabilities add column if not exists published_at date;
    alter table sm_sec_vulnerabilities add column if not exists cwe text;
    alter table sm_sec_vulnerabilities add column if not exists vendor text;
    alter table sm_sec_vulnerabilities add column if not exists product text;
    alter table sm_sec_vulnerabilities add column if not exists source text;
    alter table sm_sec_vulnerabilities add column if not exists affected_versions text;
    alter table sm_sec_vulnerabilities add column if not exists fixed_versions text;
    alter table sm_sec_vulnerabilities add column if not exists description text;
    alter table sm_sec_vulnerabilities add column if not exists solution text;
    alter table sm_sec_vulnerabilities add column if not exists advisories text;
    alter table sm_sec_vulnerabilities add column if not exists open_items integer;
    alter table sm_sec_vulnerabilities add column if not exists last_seen_at timestamptz;
  end if;
end
$cols$;
create table if not exists sm_sec_vulnerabilities (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  cve_id text,
  title text,
  severity text,
  cvss_score numeric,
  cvss_version text,
  cvss_vector text,
  epss numeric,
  epss_percentile numeric,
  kev boolean not null default false,
  kev_due date,
  exploit_maturity text,
  published_at date,
  cwe text,
  vendor text,
  product text,
  source text,
  affected_versions text,
  fixed_versions text,
  description text,
  solution text,
  advisories text,
  open_items integer,
  last_seen_at timestamptz
);
create index if not exists sm_sec_vulnerabilities_rev_idx on sm_sec_vulnerabilities (org_id, rev);
create index if not exists sm_sec_vulnerabilities_upd_idx on sm_sec_vulnerabilities (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_sec_vulnerabilities_crt_idx on sm_sec_vulnerabilities (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_sec_vulnerabilities_cve_id_uk on sm_sec_vulnerabilities (org_id, cve_id) where deleted_at is null;
drop trigger if exists sm_sec_vulnerabilities_sync on sm_sec_vulnerabilities;
create trigger sm_sec_vulnerabilities_sync before insert or update on sm_sec_vulnerabilities for each row execute function sm_sync_touch('sec_vulnerability');
create or replace trigger sm_sec_vulnerabilities_demo after insert on sm_sec_vulnerabilities for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_sec_vulnerabilities_demo_t after update or delete on sm_sec_vulnerabilities for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_sec_vulnerabilities enable row level security;

-- service: خدمت‌ها
do $cols$
begin
  if to_regclass('sm_services') is not null then
    alter table sm_services add column if not exists workspace_id uuid;
    alter table sm_services add column if not exists domain_id uuid;
    alter table sm_services add column if not exists unit_id uuid;
    alter table sm_services add column if not exists created_at timestamptz not null default now();
    alter table sm_services add column if not exists created_by uuid;
    alter table sm_services add column if not exists updated_at timestamptz not null default now();
    alter table sm_services add column if not exists updated_by uuid;
    alter table sm_services add column if not exists rev bigint not null default 0;
    alter table sm_services add column if not exists version integer not null default 1;
    alter table sm_services add column if not exists deleted_at timestamptz;
    alter table sm_services add column if not exists origin text;
    alter table sm_services add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_services add column if not exists no integer;
    alter table sm_services add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SVC' || no::text else 'SVC' || lpad(no::text, 5, '0') end) stored;
    alter table sm_services add column if not exists name text;
    alter table sm_services add column if not exists service_type text;
    alter table sm_services add column if not exists portfolio_node_id uuid;
    alter table sm_services add column if not exists ci_id uuid;
    alter table sm_services add column if not exists description text;
    alter table sm_services add column if not exists value_proposition text;
    alter table sm_services add column if not exists outcomes text;
    alter table sm_services add column if not exists tags jsonb;
    alter table sm_services add column if not exists service_key text;
    alter table sm_services add column if not exists owner_id uuid;
    alter table sm_services add column if not exists owner_group_id uuid;
    alter table sm_services add column if not exists product_owner_id uuid;
    alter table sm_services add column if not exists relationship_manager_id uuid;
    alter table sm_services add column if not exists support_group_id uuid;
    alter table sm_services add column if not exists change_approval_group_id uuid;
    alter table sm_services add column if not exists stakeholder_groups jsonb;
    alter table sm_services add column if not exists provider_unit_id uuid;
    alter table sm_services add column if not exists consumer_units jsonb;
    alter table sm_services add column if not exists tier text;
    alter table sm_services add column if not exists criticality text;
    alter table sm_services add column if not exists availability_target numeric;
    alter table sm_services add column if not exists calendar_id uuid;
    alter table sm_services add column if not exists channels jsonb;
    alter table sm_services add column if not exists continuity_tier text;
    alter table sm_services add column if not exists rto bigint;
    alter table sm_services add column if not exists rpo bigint;
    alter table sm_services add column if not exists security_classification text;
    alter table sm_services add column if not exists digital_spectrum text;
    alter table sm_services add column if not exists status text;
    alter table sm_services add column if not exists status_override text;
    alter table sm_services add column if not exists status_since timestamptz;
    alter table sm_services add column if not exists status_reason text;
    alter table sm_services add column if not exists status_note text;
    alter table sm_services add column if not exists on_status_page boolean not null default false;
    alter table sm_services add column if not exists documentation_url text;
    alter table sm_services add column if not exists name_en text;
    alter table sm_services add column if not exists description_en text;
    alter table sm_services add column if not exists annual_cost numeric;
    alter table sm_services add column if not exists cost_model text;
    alter table sm_services add column if not exists last_reviewed_at date;
    alter table sm_services add column if not exists review_months integer;
    alter table sm_services add column if not exists review_warned_for date;
    alter table sm_services add column if not exists retire_reason text;
    alter table sm_services add column if not exists approved_at timestamptz;
    alter table sm_services add column if not exists live_at timestamptz;
    alter table sm_services add column if not exists retired_at timestamptz;
    alter table sm_services add column if not exists score integer;
    alter table sm_services add column if not exists watch_list jsonb;
    alter table sm_services add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_services (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SVC' || no::text else 'SVC' || lpad(no::text, 5, '0') end) stored,
  name text,
  service_type text,
  portfolio_node_id uuid,
  ci_id uuid,
  description text,
  value_proposition text,
  outcomes text,
  tags jsonb,
  service_key text,
  owner_id uuid,
  owner_group_id uuid,
  product_owner_id uuid,
  relationship_manager_id uuid,
  support_group_id uuid,
  change_approval_group_id uuid,
  stakeholder_groups jsonb,
  provider_unit_id uuid,
  consumer_units jsonb,
  tier text,
  criticality text,
  availability_target numeric,
  calendar_id uuid,
  channels jsonb,
  continuity_tier text,
  rto bigint,
  rpo bigint,
  security_classification text,
  digital_spectrum text,
  status text,
  status_override text,
  status_since timestamptz,
  status_reason text,
  status_note text,
  on_status_page boolean not null default false,
  documentation_url text,
  name_en text,
  description_en text,
  annual_cost numeric,
  cost_model text,
  last_reviewed_at date,
  review_months integer,
  review_warned_for date,
  retire_reason text,
  approved_at timestamptz,
  live_at timestamptz,
  retired_at timestamptz,
  score integer,
  watch_list jsonb,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_services' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_services', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_services', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_services' and indexname like 'sm\_services\_search\_%' and indexname not in ('sm_services_search_56291d9d_trgm', 'sm_services_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_services_search_56291d9d_trgm', 'sm_services', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_services_search_custom_trgm', 'sm_services', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_services_no_uk on sm_services (org_id, no);
create index if not exists sm_services_rev_idx on sm_services (org_id, rev);
create index if not exists sm_services_upd_idx on sm_services (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_services_crt_idx on sm_services (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_services_portfolio_node_id_idx on sm_services (org_id, portfolio_node_id) where deleted_at is null;
create index if not exists sm_services_ci_id_idx on sm_services (org_id, ci_id) where deleted_at is null;
create unique index if not exists sm_services_service_key_uk on sm_services (org_id, service_key) where deleted_at is null;
create index if not exists sm_services_state_idx on sm_services (org_id, state) where deleted_at is null;
create index if not exists sm_services_workspace_acc_idx on sm_services (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_services_unit_acc_idx on sm_services (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_services_domain_acc_idx on sm_services (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_services_owner_id_idx on sm_services (org_id, owner_id) where deleted_at is null;
create index if not exists sm_services_product_owner_id_idx on sm_services (org_id, product_owner_id) where deleted_at is null;
create index if not exists sm_services_relationship_manager_id_idx on sm_services (org_id, relationship_manager_id) where deleted_at is null;
create index if not exists sm_services_watch_list_gin on sm_services using gin (watch_list);
drop trigger if exists sm_services_sync on sm_services;
create trigger sm_services_sync before insert or update on sm_services for each row execute function sm_sync_touch('service');
create or replace trigger sm_services_demo after insert on sm_services for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_services_demo_t after update or delete on sm_services for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_services enable row level security;

-- service_agreement: توافق‌های مشتری
do $cols$
begin
  if to_regclass('sm_service_agreements') is not null then
    alter table sm_service_agreements add column if not exists workspace_id uuid;
    alter table sm_service_agreements add column if not exists domain_id uuid;
    alter table sm_service_agreements add column if not exists unit_id uuid;
    alter table sm_service_agreements add column if not exists created_at timestamptz not null default now();
    alter table sm_service_agreements add column if not exists created_by uuid;
    alter table sm_service_agreements add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_agreements add column if not exists updated_by uuid;
    alter table sm_service_agreements add column if not exists rev bigint not null default 0;
    alter table sm_service_agreements add column if not exists version integer not null default 1;
    alter table sm_service_agreements add column if not exists deleted_at timestamptz;
    alter table sm_service_agreements add column if not exists origin text;
    alter table sm_service_agreements add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_agreements add column if not exists no integer;
    alter table sm_service_agreements add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AGR' || no::text else 'AGR' || lpad(no::text, 5, '0') end) stored;
    alter table sm_service_agreements add column if not exists name text;
    alter table sm_service_agreements add column if not exists customer_unit_id uuid;
    alter table sm_service_agreements add column if not exists service_id uuid;
    alter table sm_service_agreements add column if not exists offerings jsonb;
    alter table sm_service_agreements add column if not exists valid_from date;
    alter table sm_service_agreements add column if not exists valid_to date;
    alter table sm_service_agreements add column if not exists status text;
    alter table sm_service_agreements add column if not exists terms text;
    alter table sm_service_agreements add column if not exists manager_id uuid;
    alter table sm_service_agreements add column if not exists document_url text;
    alter table sm_service_agreements add column if not exists kind text;
    alter table sm_service_agreements add column if not exists provider_group_id uuid;
    alter table sm_service_agreements add column if not exists customer_contact_id uuid;
    alter table sm_service_agreements add column if not exists supplier_name text;
    alter table sm_service_agreements add column if not exists contract_ref text;
    alter table sm_service_agreements add column if not exists parent_agreement_id uuid;
    alter table sm_service_agreements add column if not exists compliance_target numeric;
    alter table sm_service_agreements add column if not exists at_risk_target numeric;
    alter table sm_service_agreements add column if not exists review_period text;
    alter table sm_service_agreements add column if not exists calendar_id uuid;
    alter table sm_service_agreements add column if not exists volume_limit integer;
    alter table sm_service_agreements add column if not exists monthly_fee numeric;
    alter table sm_service_agreements add column if not exists compliance_pct numeric;
    alter table sm_service_agreements add column if not exists compliance_status text;
    alter table sm_service_agreements add column if not exists experience_pct numeric;
    alter table sm_service_agreements add column if not exists watermelon boolean not null default false;
    alter table sm_service_agreements add column if not exists measured_at timestamptz;
    alter table sm_service_agreements add column if not exists service_hours text;
    alter table sm_service_agreements add column if not exists responsibilities text;
    alter table sm_service_agreements add column if not exists escalation text;
    alter table sm_service_agreements add column if not exists exclusions text;
    alter table sm_service_agreements add column if not exists agreement_version integer;
    alter table sm_service_agreements add column if not exists review_months integer;
    alter table sm_service_agreements add column if not exists next_review_at date;
    alter table sm_service_agreements add column if not exists last_review_at date;
    alter table sm_service_agreements add column if not exists review_overdue boolean not null default false;
    alter table sm_service_agreements add column if not exists review_reminded_for date;
    alter table sm_service_agreements add column if not exists expiry_reminded_for date;
    alter table sm_service_agreements add column if not exists left_force_on date;
    alter table sm_service_agreements add column if not exists approval text;
    alter table sm_service_agreements add column if not exists accepted_at timestamptz;
    alter table sm_service_agreements add column if not exists accepted_by uuid;
    alter table sm_service_agreements add column if not exists template_id uuid;
    alter table sm_service_agreements add column if not exists closed_note text;
    alter table sm_service_agreements add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_service_agreements (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'AGR' || no::text else 'AGR' || lpad(no::text, 5, '0') end) stored,
  name text,
  customer_unit_id uuid,
  service_id uuid,
  offerings jsonb,
  valid_from date,
  valid_to date,
  status text,
  terms text,
  manager_id uuid,
  document_url text,
  kind text,
  provider_group_id uuid,
  customer_contact_id uuid,
  supplier_name text,
  contract_ref text,
  parent_agreement_id uuid,
  compliance_target numeric,
  at_risk_target numeric,
  review_period text,
  calendar_id uuid,
  volume_limit integer,
  monthly_fee numeric,
  compliance_pct numeric,
  compliance_status text,
  experience_pct numeric,
  watermelon boolean not null default false,
  measured_at timestamptz,
  service_hours text,
  responsibilities text,
  escalation text,
  exclusions text,
  agreement_version integer,
  review_months integer,
  next_review_at date,
  last_review_at date,
  review_overdue boolean not null default false,
  review_reminded_for date,
  expiry_reminded_for date,
  left_force_on date,
  approval text,
  accepted_at timestamptz,
  accepted_by uuid,
  template_id uuid,
  closed_note text,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_agreements' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_service_agreements', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_agreements', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_service_agreements' and indexname like 'sm\_service\_agreements\_search\_%' and indexname not in ('sm_service_agreements_search_56291d9d_trgm', 'sm_service_agreements_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_agreements_search_56291d9d_trgm', 'sm_service_agreements', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_agreements_search_custom_trgm', 'sm_service_agreements', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_agreements_no_uk on sm_service_agreements (org_id, no);
create index if not exists sm_service_agreements_rev_idx on sm_service_agreements (org_id, rev);
create index if not exists sm_service_agreements_upd_idx on sm_service_agreements (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_agreements_crt_idx on sm_service_agreements (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_agreements_service_id_idx on sm_service_agreements (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_agreements_provider_group_id_idx on sm_service_agreements (org_id, provider_group_id) where deleted_at is null;
create index if not exists sm_service_agreements_parent_agreement_id_idx on sm_service_agreements (org_id, parent_agreement_id) where deleted_at is null;
create index if not exists sm_service_agreements_state_idx on sm_service_agreements (org_id, state) where deleted_at is null;
create index if not exists sm_service_agreements_workspace_acc_idx on sm_service_agreements (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_agreements_unit_acc_idx on sm_service_agreements (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_agreements_domain_acc_idx on sm_service_agreements (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_agreements_manager_id_idx on sm_service_agreements (org_id, manager_id) where deleted_at is null;
drop trigger if exists sm_service_agreements_sync on sm_service_agreements;
create trigger sm_service_agreements_sync before insert or update on sm_service_agreements for each row execute function sm_sync_touch('service_agreement');
create or replace trigger sm_service_agreements_demo after insert on sm_service_agreements for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_agreements_demo_t after update or delete on sm_service_agreements for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_agreements enable row level security;

-- service_case: پرونده‌های واحدها
do $cols$
begin
  if to_regclass('sm_service_cases') is not null then
    alter table sm_service_cases add column if not exists workspace_id uuid;
    alter table sm_service_cases add column if not exists domain_id uuid;
    alter table sm_service_cases add column if not exists unit_id uuid;
    alter table sm_service_cases add column if not exists created_at timestamptz not null default now();
    alter table sm_service_cases add column if not exists created_by uuid;
    alter table sm_service_cases add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_cases add column if not exists updated_by uuid;
    alter table sm_service_cases add column if not exists rev bigint not null default 0;
    alter table sm_service_cases add column if not exists version integer not null default 1;
    alter table sm_service_cases add column if not exists deleted_at timestamptz;
    alter table sm_service_cases add column if not exists origin text;
    alter table sm_service_cases add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_cases add column if not exists no integer;
    alter table sm_service_cases add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CAS' || no::text else 'CAS' || lpad(no::text, 7, '0') end) stored;
    alter table sm_service_cases add column if not exists short_description text;
    alter table sm_service_cases add column if not exists description text;
    alter table sm_service_cases add column if not exists state text;
    alter table sm_service_cases add column if not exists priority text;
    alter table sm_service_cases add column if not exists impact text;
    alter table sm_service_cases add column if not exists urgency text;
    alter table sm_service_cases add column if not exists category text;
    alter table sm_service_cases add column if not exists subcategory text;
    alter table sm_service_cases add column if not exists channel text;
    alter table sm_service_cases add column if not exists caller_id uuid;
    alter table sm_service_cases add column if not exists requested_for uuid;
    alter table sm_service_cases add column if not exists opened_by uuid;
    alter table sm_service_cases add column if not exists opened_at timestamptz;
    alter table sm_service_cases add column if not exists assignment_group_id uuid;
    alter table sm_service_cases add column if not exists assigned_to uuid;
    alter table sm_service_cases add column if not exists service_id uuid;
    alter table sm_service_cases add column if not exists offering_id uuid;
    alter table sm_service_cases add column if not exists ci_id uuid;
    alter table sm_service_cases add column if not exists location_id uuid;
    alter table sm_service_cases add column if not exists due_at timestamptz;
    alter table sm_service_cases add column if not exists resolved_at timestamptz;
    alter table sm_service_cases add column if not exists resolved_by uuid;
    alter table sm_service_cases add column if not exists closed_at timestamptz;
    alter table sm_service_cases add column if not exists closed_by uuid;
    alter table sm_service_cases add column if not exists close_code text;
    alter table sm_service_cases add column if not exists close_notes text;
    alter table sm_service_cases add column if not exists parent_id uuid;
    alter table sm_service_cases add column if not exists watch_list jsonb;
    alter table sm_service_cases add column if not exists approval text;
    alter table sm_service_cases add column if not exists escalation integer;
    alter table sm_service_cases add column if not exists reassignment_count integer;
    alter table sm_service_cases add column if not exists reopen_count integer;
    alter table sm_service_cases add column if not exists time_worked bigint;
    alter table sm_service_cases add column if not exists first_response_at timestamptz;
    alter table sm_service_cases add column if not exists active boolean not null default true;
    alter table sm_service_cases add column if not exists sla_due timestamptz;
    alter table sm_service_cases add column if not exists knowledge boolean not null default false;
    alter table sm_service_cases add column if not exists title text;
    alter table sm_service_cases add column if not exists department_id uuid;
    alter table sm_service_cases add column if not exists dept_service_id uuid;
    alter table sm_service_cases add column if not exists sensitive boolean not null default false;
    alter table sm_service_cases add column if not exists journey_id uuid;
    alter table sm_service_cases add column if not exists child_total integer;
    alter table sm_service_cases add column if not exists child_open integer;
    alter table sm_service_cases add column if not exists satisfaction integer;
  end if;
end
$cols$;
create table if not exists sm_service_cases (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 7 then 'CAS' || no::text else 'CAS' || lpad(no::text, 7, '0') end) stored,
  short_description text,
  description text,
  state text,
  priority text,
  impact text,
  urgency text,
  category text,
  subcategory text,
  channel text,
  caller_id uuid,
  requested_for uuid,
  opened_by uuid,
  opened_at timestamptz,
  assignment_group_id uuid,
  assigned_to uuid,
  service_id uuid,
  offering_id uuid,
  ci_id uuid,
  location_id uuid,
  due_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  close_code text,
  close_notes text,
  parent_id uuid,
  watch_list jsonb,
  approval text,
  escalation integer,
  reassignment_count integer,
  reopen_count integer,
  time_worked bigint,
  first_response_at timestamptz,
  active boolean not null default true,
  sla_due timestamptz,
  knowledge boolean not null default false,
  title text,
  department_id uuid,
  dept_service_id uuid,
  sensitive boolean not null default false,
  journey_id uuid,
  child_total integer,
  child_open integer,
  satisfaction integer,
  search_f3bce210 text generated always as (translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_cases' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_f3bce210' loop
    execute format('alter table %I drop column if exists %I', 'sm_service_cases', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_cases', 'search_f3bce210', $x$translate(coalesce(short_description, '') || ' ' || coalesce(description, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_service_cases' and indexname like 'sm\_service\_cases\_search\_%' and indexname not in ('sm_service_cases_search_f3bce210_trgm', 'sm_service_cases_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_cases_search_f3bce210_trgm', 'sm_service_cases', 'search_f3bce210', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_cases_search_custom_trgm', 'sm_service_cases', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_cases_no_uk on sm_service_cases (org_id, no);
create index if not exists sm_service_cases_rev_idx on sm_service_cases (org_id, rev);
create index if not exists sm_service_cases_upd_idx on sm_service_cases (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_cases_crt_idx on sm_service_cases (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_cases_state_idx on sm_service_cases (org_id, state) where deleted_at is null;
create index if not exists sm_service_cases_assignment_group_id_idx on sm_service_cases (org_id, assignment_group_id) where deleted_at is null;
create index if not exists sm_service_cases_assigned_to_idx on sm_service_cases (org_id, assigned_to) where deleted_at is null;
create index if not exists sm_service_cases_department_id_idx on sm_service_cases (org_id, department_id) where deleted_at is null;
create index if not exists sm_service_cases_dept_service_id_idx on sm_service_cases (org_id, dept_service_id) where deleted_at is null;
create index if not exists sm_service_cases_workspace_acc_idx on sm_service_cases (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_cases_unit_acc_idx on sm_service_cases (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_cases_domain_acc_idx on sm_service_cases (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_cases_caller_id_idx on sm_service_cases (org_id, caller_id) where deleted_at is null;
create index if not exists sm_service_cases_requested_for_idx on sm_service_cases (org_id, requested_for) where deleted_at is null;
create index if not exists sm_service_cases_opened_by_idx on sm_service_cases (org_id, opened_by) where deleted_at is null;
create index if not exists sm_service_cases_watch_list_gin on sm_service_cases using gin (watch_list);
create index if not exists sm_service_cases_open_grp_idx on sm_service_cases (org_id, assignment_group_id, updated_at desc) where deleted_at is null and active;
create index if not exists sm_service_cases_opened_brin on sm_service_cases using brin (opened_at);
drop trigger if exists sm_service_cases_sync on sm_service_cases;
create trigger sm_service_cases_sync before insert or update on sm_service_cases for each row execute function sm_sync_touch('service_case');
create or replace trigger sm_service_cases_demo after insert on sm_service_cases for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_cases_demo_t after update or delete on sm_service_cases for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_cases enable row level security;

-- service_commitment: تعهدهای خدمت
do $cols$
begin
  if to_regclass('sm_service_commitments') is not null then
    alter table sm_service_commitments add column if not exists workspace_id uuid;
    alter table sm_service_commitments add column if not exists domain_id uuid;
    alter table sm_service_commitments add column if not exists unit_id uuid;
    alter table sm_service_commitments add column if not exists created_at timestamptz not null default now();
    alter table sm_service_commitments add column if not exists created_by uuid;
    alter table sm_service_commitments add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_commitments add column if not exists updated_by uuid;
    alter table sm_service_commitments add column if not exists rev bigint not null default 0;
    alter table sm_service_commitments add column if not exists version integer not null default 1;
    alter table sm_service_commitments add column if not exists deleted_at timestamptz;
    alter table sm_service_commitments add column if not exists origin text;
    alter table sm_service_commitments add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_commitments add column if not exists offering_id uuid;
    alter table sm_service_commitments add column if not exists kind text;
    alter table sm_service_commitments add column if not exists target numeric;
    alter table sm_service_commitments add column if not exists priority text;
    alter table sm_service_commitments add column if not exists calendar_id uuid;
    alter table sm_service_commitments add column if not exists valid_from date;
    alter table sm_service_commitments add column if not exists valid_to date;
    alter table sm_service_commitments add column if not exists generate_sla boolean not null default true;
    alter table sm_service_commitments add column if not exists active boolean not null default true;
    alter table sm_service_commitments add column if not exists revision integer;
    alter table sm_service_commitments add column if not exists sla_definition_id uuid;
    alter table sm_service_commitments add column if not exists label text;
    alter table sm_service_commitments add column if not exists owner_id uuid;
  end if;
end
$cols$;
create table if not exists sm_service_commitments (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  offering_id uuid,
  kind text,
  target numeric,
  priority text,
  calendar_id uuid,
  valid_from date,
  valid_to date,
  generate_sla boolean not null default true,
  active boolean not null default true,
  revision integer,
  sla_definition_id uuid,
  label text,
  owner_id uuid
);
create index if not exists sm_service_commitments_rev_idx on sm_service_commitments (org_id, rev);
create index if not exists sm_service_commitments_upd_idx on sm_service_commitments (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_commitments_crt_idx on sm_service_commitments (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_commitments_offering_id_idx on sm_service_commitments (org_id, offering_id) where deleted_at is null;
create index if not exists sm_service_commitments_workspace_acc_idx on sm_service_commitments (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_commitments_unit_acc_idx on sm_service_commitments (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_commitments_domain_acc_idx on sm_service_commitments (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_commitments_owner_id_idx on sm_service_commitments (org_id, owner_id) where deleted_at is null;
drop trigger if exists sm_service_commitments_sync on sm_service_commitments;
create trigger sm_service_commitments_sync before insert or update on sm_service_commitments for each row execute function sm_sync_touch('service_commitment');
create or replace trigger sm_service_commitments_demo after insert on sm_service_commitments for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_commitments_demo_t after update or delete on sm_service_commitments for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_commitments enable row level security;

-- service_config: تنظیمات سبد خدمات
do $cols$
begin
  if to_regclass('sm_service_configs') is not null then
    alter table sm_service_configs add column if not exists workspace_id uuid;
    alter table sm_service_configs add column if not exists domain_id uuid;
    alter table sm_service_configs add column if not exists unit_id uuid;
    alter table sm_service_configs add column if not exists created_at timestamptz not null default now();
    alter table sm_service_configs add column if not exists created_by uuid;
    alter table sm_service_configs add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_configs add column if not exists updated_by uuid;
    alter table sm_service_configs add column if not exists rev bigint not null default 0;
    alter table sm_service_configs add column if not exists version integer not null default 1;
    alter table sm_service_configs add column if not exists deleted_at timestamptz;
    alter table sm_service_configs add column if not exists origin text;
    alter table sm_service_configs add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_configs add column if not exists name text;
    alter table sm_service_configs add column if not exists config_key text;
    alter table sm_service_configs add column if not exists status_page_title text;
    alter table sm_service_configs add column if not exists notify_subscribers boolean not null default true;
    alter table sm_service_configs add column if not exists status_page_public boolean not null default false;
    alter table sm_service_configs add column if not exists status_page_token text;
    alter table sm_service_configs add column if not exists review_warn_days integer;
    alter table sm_service_configs add column if not exists w_availability integer;
    alter table sm_service_configs add column if not exists w_incidents integer;
    alter table sm_service_configs add column if not exists w_breaches integer;
    alter table sm_service_configs add column if not exists w_csat integer;
    alter table sm_service_configs add column if not exists seeded integer;
  end if;
end
$cols$;
create table if not exists sm_service_configs (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  config_key text,
  status_page_title text,
  notify_subscribers boolean not null default true,
  status_page_public boolean not null default false,
  status_page_token text,
  review_warn_days integer,
  w_availability integer,
  w_incidents integer,
  w_breaches integer,
  w_csat integer,
  seeded integer
);
create index if not exists sm_service_configs_rev_idx on sm_service_configs (org_id, rev);
create index if not exists sm_service_configs_upd_idx on sm_service_configs (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_configs_crt_idx on sm_service_configs (org_id, created_at desc, id desc) where deleted_at is null;
create unique index if not exists sm_service_configs_config_key_uk on sm_service_configs (org_id, config_key) where deleted_at is null;
create index if not exists sm_service_configs_status_page_token_idx on sm_service_configs (org_id, status_page_token) where deleted_at is null;
drop trigger if exists sm_service_configs_sync on sm_service_configs;
create trigger sm_service_configs_sync before insert or update on sm_service_configs for each row execute function sm_sync_touch('service_config');
create or replace trigger sm_service_configs_demo after insert on sm_service_configs for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_configs_demo_t after update or delete on sm_service_configs for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_configs enable row level security;

-- service_design_package: بسته‌های طراحی و گذار
do $cols$
begin
  if to_regclass('sm_service_design_packages') is not null then
    alter table sm_service_design_packages add column if not exists workspace_id uuid;
    alter table sm_service_design_packages add column if not exists domain_id uuid;
    alter table sm_service_design_packages add column if not exists unit_id uuid;
    alter table sm_service_design_packages add column if not exists created_at timestamptz not null default now();
    alter table sm_service_design_packages add column if not exists created_by uuid;
    alter table sm_service_design_packages add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_design_packages add column if not exists updated_by uuid;
    alter table sm_service_design_packages add column if not exists rev bigint not null default 0;
    alter table sm_service_design_packages add column if not exists version integer not null default 1;
    alter table sm_service_design_packages add column if not exists deleted_at timestamptz;
    alter table sm_service_design_packages add column if not exists origin text;
    alter table sm_service_design_packages add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_design_packages add column if not exists no integer;
    alter table sm_service_design_packages add column if not exists number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SDT' || no::text else 'SDT' || lpad(no::text, 5, '0') end) stored;
    alter table sm_service_design_packages add column if not exists name text;
    alter table sm_service_design_packages add column if not exists service_id uuid;
    alter table sm_service_design_packages add column if not exists owner_id uuid;
    alter table sm_service_design_packages add column if not exists reviewer_id uuid;
    alter table sm_service_design_packages add column if not exists functional_reqs text;
    alter table sm_service_design_packages add column if not exists nonfunctional_reqs text;
    alter table sm_service_design_packages add column if not exists design_specs text;
    alter table sm_service_design_packages add column if not exists acceptance_criteria text;
    alter table sm_service_design_packages add column if not exists readiness jsonb;
    alter table sm_service_design_packages add column if not exists readiness_pct numeric;
    alter table sm_service_design_packages add column if not exists state text;
  end if;
end
$cols$;
create table if not exists sm_service_design_packages (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  no integer,
  number text generated always as (case when no is null then null when length(no::text) >= 5 then 'SDT' || no::text else 'SDT' || lpad(no::text, 5, '0') end) stored,
  name text,
  service_id uuid,
  owner_id uuid,
  reviewer_id uuid,
  functional_reqs text,
  nonfunctional_reqs text,
  design_specs text,
  acceptance_criteria text,
  readiness jsonb,
  readiness_pct numeric,
  state text,
  search_56291d9d text generated always as (translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')) stored
);
do $search$
declare s text; old record;
begin
  for old in select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'sm_service_design_packages' and column_name ~ '^search_[0-9a-f]{8}$' and column_name <> 'search_56291d9d' loop
    execute format('alter table %I drop column if exists %I', 'sm_service_design_packages', old.column_name);
  end loop;
  execute format('alter table %I add column if not exists %I text generated always as (%s) stored', 'sm_service_design_packages', 'search_56291d9d', $x$translate(coalesce(name, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$);
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if s is not null then
    for old in select indexname from pg_indexes where schemaname = current_schema() and tablename = 'sm_service_design_packages' and indexname like 'sm\_service\_design\_packages\_search\_%' and indexname not in ('sm_service_design_packages_search_56291d9d_trgm', 'sm_service_design_packages_search_custom_trgm') loop
      execute format('drop index if exists %I', old.indexname);
    end loop;
    execute format('create index if not exists %I on %I using gin (%I %I.gin_trgm_ops) where deleted_at is null', 'sm_service_design_packages_search_56291d9d_trgm', 'sm_service_design_packages', 'search_56291d9d', s);
    execute format('create index if not exists %I on %I using gin ((%s) %I.gin_trgm_ops) where deleted_at is null and custom <> ''{}''::jsonb', 'sm_service_design_packages_search_custom_trgm', 'sm_service_design_packages', $x$translate(custom::text, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')$x$, s);
  end if;
end
$search$;
create unique index if not exists sm_service_design_packages_no_uk on sm_service_design_packages (org_id, no);
create index if not exists sm_service_design_packages_rev_idx on sm_service_design_packages (org_id, rev);
create index if not exists sm_service_design_packages_upd_idx on sm_service_design_packages (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_design_packages_crt_idx on sm_service_design_packages (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_design_packages_service_id_idx on sm_service_design_packages (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_design_packages_state_idx on sm_service_design_packages (org_id, state) where deleted_at is null;
create index if not exists sm_service_design_packages_workspace_acc_idx on sm_service_design_packages (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_design_packages_unit_acc_idx on sm_service_design_packages (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_design_packages_domain_acc_idx on sm_service_design_packages (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_design_packages_owner_id_idx on sm_service_design_packages (org_id, owner_id) where deleted_at is null;
create index if not exists sm_service_design_packages_reviewer_id_idx on sm_service_design_packages (org_id, reviewer_id) where deleted_at is null;
drop trigger if exists sm_service_design_packages_sync on sm_service_design_packages;
create trigger sm_service_design_packages_sync before insert or update on sm_service_design_packages for each row execute function sm_sync_touch('service_design_package');
create or replace trigger sm_service_design_packages_demo after insert on sm_service_design_packages for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_design_packages_demo_t after update or delete on sm_service_design_packages for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_design_packages enable row level security;

-- service_instance: نمونه‌های استقرار خدمت
do $cols$
begin
  if to_regclass('sm_service_instances') is not null then
    alter table sm_service_instances add column if not exists workspace_id uuid;
    alter table sm_service_instances add column if not exists domain_id uuid;
    alter table sm_service_instances add column if not exists unit_id uuid;
    alter table sm_service_instances add column if not exists created_at timestamptz not null default now();
    alter table sm_service_instances add column if not exists created_by uuid;
    alter table sm_service_instances add column if not exists updated_at timestamptz not null default now();
    alter table sm_service_instances add column if not exists updated_by uuid;
    alter table sm_service_instances add column if not exists rev bigint not null default 0;
    alter table sm_service_instances add column if not exists version integer not null default 1;
    alter table sm_service_instances add column if not exists deleted_at timestamptz;
    alter table sm_service_instances add column if not exists origin text;
    alter table sm_service_instances add column if not exists custom jsonb not null default '{}'::jsonb;
    alter table sm_service_instances add column if not exists name text;
    alter table sm_service_instances add column if not exists service_id uuid;
    alter table sm_service_instances add column if not exists environment text;
    alter table sm_service_instances add column if not exists region text;
    alter table sm_service_instances add column if not exists active boolean not null default true;
    alter table sm_service_instances add column if not exists ci_id uuid;
    alter table sm_service_instances add column if not exists ci_group_id uuid;
    alter table sm_service_instances add column if not exists support_group_id uuid;
    alter table sm_service_instances add column if not exists owner_id uuid;
  end if;
end
$cols$;
create table if not exists sm_service_instances (
  id uuid primary key,
  org_id uuid not null references sm_orgs(id) on delete cascade,
  workspace_id uuid,
  domain_id uuid,
  unit_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  rev bigint not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  origin text,
  custom jsonb not null default '{}'::jsonb,
  name text,
  service_id uuid,
  environment text,
  region text,
  active boolean not null default true,
  ci_id uuid,
  ci_group_id uuid,
  support_group_id uuid,
  owner_id uuid
);
create index if not exists sm_service_instances_rev_idx on sm_service_instances (org_id, rev);
create index if not exists sm_service_instances_upd_idx on sm_service_instances (org_id, updated_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_instances_crt_idx on sm_service_instances (org_id, created_at desc, id desc) where deleted_at is null;
create index if not exists sm_service_instances_service_id_idx on sm_service_instances (org_id, service_id) where deleted_at is null;
create index if not exists sm_service_instances_workspace_acc_idx on sm_service_instances (org_id, workspace_id) where deleted_at is null and workspace_id is not null;
create index if not exists sm_service_instances_unit_acc_idx on sm_service_instances (org_id, unit_id) where deleted_at is null and unit_id is not null;
create index if not exists sm_service_instances_domain_acc_idx on sm_service_instances (org_id, domain_id) where deleted_at is null and domain_id is not null;
create index if not exists sm_service_instances_owner_id_idx on sm_service_instances (org_id, owner_id) where deleted_at is null;
create index if not exists sm_service_instances_open_grp_idx on sm_service_instances (org_id, support_group_id, updated_at desc) where deleted_at is null and active;
drop trigger if exists sm_service_instances_sync on sm_service_instances;
create trigger sm_service_instances_sync before insert or update on sm_service_instances for each row execute function sm_sync_touch('service_instance');
create or replace trigger sm_service_instances_demo after insert on sm_service_instances for each row when (current_setting('itsm.demo', true) = new.org_id::text) execute function sm_demo_capture();
create or replace trigger sm_service_instances_demo_t after update or delete on sm_service_instances for each row when (current_setting('itsm.demo', true) = old.org_id::text) execute function sm_demo_touch();
alter table sm_service_instances enable row level security;
insert into sm_meta (key, value, updated_at) values ('engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:22', 'done', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
do $engine$
begin
  if (select count(*) from sm_meta where key like 'engine.ddl.part:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340:%') >= 30 then
    insert into sm_meta (key, value, updated_at) values ('engine.ddl', 'a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', now()) on conflict (key) do update set value = excluded.value, updated_at = now();
    insert into sm_meta (key, value, updated_at) values ('engine.ddl.seen:a0c3bc7de847efc726356c17d0426be580b356b9d4a79a0ea8f9bd8f23625340', 'done', now()) on conflict (key) do nothing;
    delete from sm_meta where key like 'engine.ddl.part:%';
    insert into sm_migrations (id) values ('0006_engine_tables') on conflict (id) do nothing;
  end if;
end
$engine$;

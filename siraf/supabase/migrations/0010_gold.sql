-- «تراز» migration 0010_gold — طلا و جواهر (تکمیلی)
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0010_gold — طلا و جواهر (تکمیلی)
-- ---------------------------------------------------------------------------
alter table tz_gold_lines add column if not exists cost numeric;
alter table tz_gold_lines add column if not exists tag_no text;
alter table tz_gold_lines add column if not exists extra jsonb not null default '{}'::jsonb;

create index if not exists tz_gold_lines_item_idx on tz_gold_lines (org_id, gold_item_id);
create index if not exists tz_gold_docs_kind_idx on tz_gold_docs (org_id, kind, date);
create index if not exists tz_gold_items_in_doc_idx on tz_gold_items (org_id, in_doc_id);
create index if not exists tz_gold_items_out_doc_idx on tz_gold_items (org_id, out_doc_id);
create index if not exists tz_gold_items_category_idx on tz_gold_items (org_id, category_id, status);

insert into tz_migrations (id) values ('0010_gold') on conflict (id) do nothing;

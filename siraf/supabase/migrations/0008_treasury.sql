-- «سیراف» migration 0008_treasury — خزانه‌داری و چک
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0008_treasury — خزانه‌داری و چک
-- ---------------------------------------------------------------------------
create index if not exists tz_cheques_source_idx on tz_cheques (org_id, source_type, source_id);
create index if not exists tz_cheques_sayad_idx on tz_cheques (org_id, direction, sayad_no) where sayad_no is not null and deleted_at is null;
create index if not exists tz_cheques_book_idx on tz_cheques (org_id, cheque_book_id, serial_no) where cheque_book_id is not null and deleted_at is null;
create index if not exists tz_cheques_bank_idx on tz_cheques (org_id, bank_account_id, status) where deleted_at is null;
create index if not exists tz_cheques_history_idx on tz_cheques using gin (history jsonb_path_ops);
create index if not exists tz_treasury_docs_kind_idx on tz_treasury_docs (org_id, kind, date);
create index if not exists tz_treasury_lines_cheque_idx on tz_treasury_lines (cheque_id) where cheque_id is not null;
create index if not exists tz_treasury_allocs_doc_idx on tz_treasury_allocs (doc_id);

insert into tz_migrations (id) values ('0008_treasury') on conflict (id) do nothing;

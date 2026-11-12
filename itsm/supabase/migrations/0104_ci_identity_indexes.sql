-- «کاریز» migration 0104_ci_identity_indexes — شناسایی پیکربندی در مقیاس بانکی: نمایه‌های عبارتی شمارهٔ سریال، برچسب اموال، شناسهٔ BIOS، نام میزبان، FQDN، نشانی MAC و نام
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0104_ci_identity_indexes — شناسایی پیکربندی در مقیاس بانکی: نمایه‌های عبارتی شمارهٔ سریال، برچسب اموال، شناسهٔ BIOS، نام میزبان، FQDN، نشانی MAC و نام
-- ---------------------------------------------------------------------------
create index if not exists sm_cis_ident_serial_idx on sm_cis (org_id, (upper(replace(translate(serial_number, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), ' ', '')))) where deleted_at is null and merged_into is null;
create index if not exists sm_cis_ident_tag_idx on sm_cis (org_id, (upper(replace(translate(asset_tag, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), ' ', '')))) where deleted_at is null and merged_into is null;
create index if not exists sm_cis_ident_bios_idx on sm_cis (org_id, (upper(replace(translate(bios_uuid, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), ' ', '')))) where deleted_at is null and merged_into is null;
create index if not exists sm_cis_ident_host_idx on sm_cis (org_id, (lower(hostname))) where deleted_at is null and merged_into is null;
create index if not exists sm_cis_ident_fqdn_idx on sm_cis (org_id, (lower(fqdn))) where deleted_at is null and merged_into is null;
create index if not exists sm_cis_ident_mac_idx on sm_cis (org_id, (lower(mac_address))) where deleted_at is null and merged_into is null;
create index if not exists sm_cis_ident_name_idx on sm_cis (org_id, (lower(translate(name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يىك‌‍‎‏', 'abcdefghijklmnopqrstuvwxyz01234567890123456789ییک')))) where deleted_at is null and merged_into is null;

insert into sm_migrations (id) values ('0104_ci_identity_indexes') on conflict (id) do nothing;

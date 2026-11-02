-- «سیراف» migration 0011_fx — صرافی و رمزارز (تکمیلی)
create table if not exists tz_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0011_fx — صرافی و رمزارز (تکمیلی)
-- ---------------------------------------------------------------------------
alter table tz_fx_deals add column if not exists fee_base numeric;
alter table tz_fx_deals add column if not exists network_fee numeric not null default 0;
alter table tz_fx_deals add column if not exists avg_cost numeric;
alter table tz_fx_deals add column if not exists market_rate numeric;
alter table tz_fx_deals add column if not exists cancelled_at timestamptz;
alter table tz_fx_deals add column if not exists cancel_reason text;
create index if not exists tz_fx_deals_status_idx on tz_fx_deals (org_id, status, date);

alter table tz_remittances add column if not exists fee_base numeric;
alter table tz_remittances add column if not exists paid_date date;
alter table tz_remittances add column if not exists paid_voucher_id uuid;
create index if not exists tz_remittances_tracking_idx on tz_remittances (org_id, tracking_code);
create index if not exists tz_remittances_corr_idx on tz_remittances (org_id, correspondent_id, status);

create index if not exists tz_fx_rates_latest_idx on tz_fx_rates (org_id, currency_id, at desc)
  where deleted_at is null and quote_currency_id is null;
create index if not exists tz_voucher_lines_currency_idx on tz_voucher_lines (org_id, currency_id)
  where currency_id is not null;

insert into tz_migrations (id) values ('0011_fx') on conflict (id) do nothing;

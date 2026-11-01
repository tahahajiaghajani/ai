// Schema changes of the fx module (idempotent: "if not exists", "create or replace").
// - deals keep the figures used when they were posted (fee in base, network fee, the average
//   cost and market rate of the moment) and when/why they were cancelled;
// - remittances keep the payout date and the id of the payout voucher (a remittance owns two
//   vouchers: the customer's payment when it is registered and the payout when it is paid);
// - indexes for the rate board, tracking codes and currency positions.
export default /* sql */ `
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
`;

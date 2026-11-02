// Integrations (API keys, webhooks from online shops), sync triggers on every aggregate root,
// and Supabase hardening (RLS on, no policies: only the server's own connection reads/writes).
export default /* sql */ `
create table if not exists tz_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes jsonb not null default '["read","write"]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists tz_api_keys_prefix_idx on tz_api_keys (prefix);

create table if not exists tz_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references tz_orgs(id) on delete cascade,
  kind text not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  secret text,
  is_active boolean not null default true,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 0,
  origin text
);

create table if not exists tz_integration_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  integration_id uuid,
  received_at timestamptz not null default now(),
  topic text,
  external_id text,
  payload jsonb,
  status text not null default 'received',
  result jsonb,
  error text
);
create index if not exists tz_integration_events_idx on tz_integration_events (org_id, received_at desc);
create unique index if not exists tz_integration_events_ext_uk on tz_integration_events (integration_id, topic, external_id) where external_id is not null;

-- attach the sync trigger to every aggregate root (entity name = trigger argument)
do $do$
declare
  r record;
begin
  for r in
    select * from (values
      ('tz_orgs', 'org'), ('tz_org_members', 'member'),
      ('tz_fiscal_years', 'fiscal_year'), ('tz_accounts', 'account'), ('tz_details', 'detail'), ('tz_vouchers', 'voucher'),
      ('tz_party_groups', 'party_group'), ('tz_parties', 'party'),
      ('tz_cash_boxes', 'cash_box'), ('tz_bank_accounts', 'bank_account'), ('tz_pos_terminals', 'pos_terminal'),
      ('tz_cheque_books', 'cheque_book'), ('tz_cheques', 'cheque'), ('tz_treasury_docs', 'treasury_doc'),
      ('tz_units', 'unit'), ('tz_item_categories', 'item_category'), ('tz_items', 'item'), ('tz_warehouses', 'warehouse'),
      ('tz_price_lists', 'price_list'), ('tz_stock_docs', 'stock_doc'), ('tz_invoices', 'invoice'),
      ('tz_gold_rates', 'gold_rate'), ('tz_gold_categories', 'gold_category'), ('tz_gold_items', 'gold_item'), ('tz_gold_docs', 'gold_doc'),
      ('tz_currencies', 'currency'), ('tz_fx_rates', 'fx_rate'), ('tz_wallets', 'wallet'), ('tz_fx_deals', 'fx_deal'), ('tz_remittances', 'remittance'),
      ('tz_integrations', 'integration')
    ) as t(tbl, entity)
  loop
    execute format('drop trigger if exists %I on %I', r.tbl || '_sync', r.tbl);
    execute format('create trigger %I before insert or update on %I for each row execute function tz_sync_touch(%L)', r.tbl || '_sync', r.tbl, r.entity);
  end loop;
end
$do$;

-- Supabase: every table is reachable only through the app's own server connection.
do $do$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'tz\\_%' loop
    execute format('alter table %I enable row level security', t.tablename);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t.tablename);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t.tablename);
    end if;
  end loop;
end
$do$;
`;

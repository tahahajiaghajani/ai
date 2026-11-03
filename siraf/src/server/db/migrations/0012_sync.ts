// Sync pull: revisions of user accounts in commit order, and indexes (idempotent).
//
// - A desktop pulls the accounts changed after its user cursor (`tz_users where rev > $1`) and
//   moves the cursor to the highest revision it saw. Revisions came from a sequence, which hands
//   out numbers in call order, not commit order: a slow transaction (disabling a user) holding
//   revision 10 while a login committed 11 was skipped for good by a pull in between. User
//   revisions now come from one counter row (in tz_org_sync, under the nil organisation id)
//   whose row lock is held until commit, like the per-organisation revisions of tz_sync_touch.
// - Every desktop asks each aggregate table for the rows of its organisation changed within a
//   revision window (`where org_id = $1 and rev > $2 and rev <= $3 order by rev`); without an
//   index on (org_id, rev) each poll reads every row of the organisation in all of them.
export default /* sql */ `
insert into tz_org_sync (org_id, rev)
select '00000000-0000-0000-0000-000000000000'::uuid,
       greatest(coalesce((select max(rev) from tz_users), 0), (select last_value from tz_user_rev_seq))
on conflict (org_id) do update set rev = greatest(tz_org_sync.rev, excluded.rev);

create or replace function tz_user_touch() returns trigger language plpgsql as $fn$
declare
  v_rev bigint;
begin
  if coalesce(current_setting('taraz.applying', true), '') <> 'on' then
    new.updated_at := now();
  end if;
  if coalesce(current_setting('taraz.mode', true), '') <> 'desktop' then
    insert into tz_org_sync (org_id, rev) values ('00000000-0000-0000-0000-000000000000', 1)
    on conflict (org_id) do update set rev = tz_org_sync.rev + 1
    returning rev into v_rev;
    new.rev := v_rev;
  end if;
  return new;
end
$fn$;

do $do$
declare
  t text;
begin
  foreach t in array array[
    'tz_org_members', 'tz_fiscal_years', 'tz_accounts', 'tz_details', 'tz_vouchers',
    'tz_party_groups', 'tz_parties', 'tz_cash_boxes', 'tz_bank_accounts', 'tz_pos_terminals',
    'tz_cheque_books', 'tz_cheques', 'tz_treasury_docs', 'tz_units', 'tz_item_categories', 'tz_items',
    'tz_warehouses', 'tz_price_lists', 'tz_stock_docs', 'tz_invoices', 'tz_gold_rates',
    'tz_gold_categories', 'tz_gold_items', 'tz_gold_docs', 'tz_currencies', 'tz_fx_rates', 'tz_wallets',
    'tz_fx_deals', 'tz_remittances', 'tz_integrations'
  ] loop
    if to_regclass(t) is not null then
      execute format('create index if not exists %I on %I (org_id, rev)', t || '_rev_idx', t);
    end if;
  end loop;
end
$do$;

create index if not exists tz_users_rev_idx on tz_users (rev);
`;

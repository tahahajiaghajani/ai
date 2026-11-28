// The demo purge and Windows apps, release 1.1.5 (docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته»):
//
// · sm_demo_purged — the purged-id ledger: (organisation, row id, table) of every row a demo purge removed or left as a
//   tombstone, kept after the pack's own bookkeeping is gone (src/server/modules/demo/ledger.ts). Ids are UUIDs, unique
//   across tables, so the primary key (org_id, row_id) answers «did a purge remove this id?» for any column. It is what
//   stops a Windows app that was away from bringing purged rows back with a push, or storing new references to them
//   (POST /sync/push), and what lets a later purge recognise what an earlier one left behind. Kept at least 30 days and
//   until every Windows app of the organisation has pulled since (the `demo.ledger` job), content-free: ids and table
//   names only.
// · The access version and «everyone's» scope epoch, in bulk: while a transaction's setting `itsm.access_bulk` names an
//   organisation (the demo purge's phases, demo/access-bulk.ts), the per-row triggers of groups, units, workspaces and
//   roles (0007_access) no longer bump the access version and every member's scope epoch once per row — they mark the
//   transaction (`itsm.access_version` / `itsm.access_everyone`) and the purge bumps each once before it commits. A
//   purge that removes a hundred groups and units then moves every member's epoch once, not a hundred times (a Windows
//   app reads everything again once), and a bank-sized pack does not write units × members epoch rows. The bumps of
//   one member (memberships, profiles, participant grants) are unchanged.
export default /* sql */ `
create table if not exists sm_demo_purged (
  org_id uuid not null,
  row_id uuid not null,
  tbl text not null,
  purged_at timestamptz not null default now(),
  primary key (org_id, row_id)
);
create index if not exists sm_demo_purged_at_idx on sm_demo_purged (org_id, purged_at);
alter table sm_demo_purged enable row level security;

create or replace function sm_access_bump(p_org uuid) returns void language plpgsql as $fn$
begin
  if coalesce(current_setting('itsm.access_bulk', true), '') = p_org::text then
    perform set_config('itsm.access_version', p_org::text, true);
    return;
  end if;
  insert into sm_access_state (org_id, version) values (p_org, 1)
  on conflict (org_id) do update set version = sm_access_state.version + 1, updated_at = now();
end
$fn$;

create or replace function sm_access_bump_everyone(p_org uuid) returns void language plpgsql as $fn$
begin
  if coalesce(current_setting('itsm.access_bulk', true), '') = p_org::text then
    perform set_config('itsm.access_everyone', p_org::text, true);
    return;
  end if;
  insert into sm_scope_epochs (org_id, user_id, epoch)
  select m.org_id, m.user_id, 1 from sm_org_members m where m.org_id = p_org and m.deleted_at is null
  on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
end
$fn$;
`;

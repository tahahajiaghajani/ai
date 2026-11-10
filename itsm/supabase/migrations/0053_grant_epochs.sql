-- «کاریز» migration 0053_grant_epochs — دسترسی: بازخوانی برنامهٔ ویندوز وقتی دسترسی مالکان خدمت، تأییدکنندگان و جانشینان تغییر می‌کند
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0053_grant_epochs — دسترسی: بازخوانی برنامهٔ ویندوز وقتی دسترسی مالکان خدمت، تأییدکنندگان و جانشینان تغییر می‌کند
-- ---------------------------------------------------------------------------
create or replace function sm_access_services() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.owner_id is distinct from old.owner_id or new.product_owner_id is distinct from old.product_owner_id
     or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump_user(org, new.owner_id);
    perform sm_access_bump_user(org, new.product_owner_id);
    if old.owner_id is distinct from new.owner_id then perform sm_access_bump_user(org, old.owner_id); end if;
    if old.product_owner_id is distinct from new.product_owner_id then perform sm_access_bump_user(org, old.product_owner_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_delegations() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.from_user is distinct from old.from_user or new.to_user is distinct from old.to_user
     or new.active is distinct from old.active or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
     or new.scopes is distinct from old.scopes or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump_user(org, new.from_user);
    perform sm_access_bump_user(org, new.to_user);
    if old.from_user is distinct from new.from_user then perform sm_access_bump_user(org, old.from_user); end if;
    if old.to_user is distinct from new.to_user then perform sm_access_bump_user(org, old.to_user); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_approvals() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  -- a new approval grants its approver; a removed or skipped one takes the grant away; a decision names who decided
  if tg_op <> 'UPDATE' or new.approver_id is distinct from old.approver_id or new.delegated_from is distinct from old.delegated_from
     or new.decided_by is distinct from old.decided_by or new.deleted_at is distinct from old.deleted_at
     or (new.state = 'skipped') is distinct from (old.state = 'skipped') then
    perform sm_access_bump_user(org, new.approver_id);
    perform sm_access_bump_user(org, new.delegated_from);
    perform sm_access_bump_user(org, new.decided_by);
    if old.approver_id is distinct from new.approver_id then perform sm_access_bump_user(org, old.approver_id); end if;
    if old.delegated_from is distinct from new.delegated_from then perform sm_access_bump_user(org, old.delegated_from); end if;
    if old.decided_by is distinct from new.decided_by then perform sm_access_bump_user(org, old.decided_by); end if;
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_services_access on sm_services;
create trigger sm_services_access after insert or update or delete on sm_services for each row execute function sm_access_services();
drop trigger if exists sm_delegations_access on sm_delegations;
create trigger sm_delegations_access after insert or update or delete on sm_delegations for each row execute function sm_access_delegations();
drop trigger if exists sm_approvals_access on sm_approvals;
create trigger sm_approvals_access after insert or update or delete on sm_approvals for each row execute function sm_access_approvals();

insert into sm_migrations (id) values ('0053_grant_epochs') on conflict (id) do nothing;

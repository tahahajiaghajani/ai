-- «کاریز» migration 0007_access — دسترسی: نسخهٔ پیکربندی دسترسی و شمارندهٔ دامنهٔ دید اعضا
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0007_access — دسترسی: نسخهٔ پیکربندی دسترسی و شمارندهٔ دامنهٔ دید اعضا
-- ---------------------------------------------------------------------------
create table if not exists sm_access_state (
  org_id uuid primary key references sm_orgs(id) on delete cascade,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table sm_access_state enable row level security;

create or replace function sm_access_bump(p_org uuid) returns void language plpgsql as $fn$
begin
  insert into sm_access_state (org_id, version) values (p_org, 1)
  on conflict (org_id) do update set version = sm_access_state.version + 1, updated_at = now();
end
$fn$;

create or replace function sm_access_bump_user(p_org uuid, p_user uuid) returns void language plpgsql as $fn$
begin
  if p_user is null then return; end if;
  insert into sm_scope_epochs (org_id, user_id, epoch) values (p_org, p_user, 1)
  on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
end
$fn$;

create or replace function sm_access_bump_everyone(p_org uuid) returns void language plpgsql as $fn$
begin
  insert into sm_scope_epochs (org_id, user_id, epoch)
  select m.org_id, m.user_id, 1 from sm_org_members m where m.org_id = p_org and m.deleted_at is null
  on conflict (org_id, user_id) do update set epoch = sm_scope_epochs.epoch + 1, updated_at = now();
end
$fn$;

-- one trigger function per table (OLD is null on insert, NEW on delete)
create or replace function sm_access_group_members() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id or new.kind is distinct from old.kind
     or new.valid_from is distinct from old.valid_from or new.valid_to is distinct from old.valid_to or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(org);
    perform sm_access_bump_user(org, new.user_id);
    if old.user_id is distinct from new.user_id then perform sm_access_bump_user(org, old.user_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_member_profiles() returns trigger language plpgsql as $fn$
declare
  org uuid := coalesce(new.org_id, old.org_id);
begin
  if tg_op <> 'UPDATE' or new.roles is distinct from old.roles or new.org_unit_id is distinct from old.org_unit_id
     or new.domain_unit_id is distinct from old.domain_unit_id or new.workspaces is distinct from old.workspaces
     or new.manager_id is distinct from old.manager_id or new.delegate_id is distinct from old.delegate_id
     or new.out_of_office is distinct from old.out_of_office or new.ooo_until is distinct from old.ooo_until
     or new.persona is distinct from old.persona or new.user_id is distinct from old.user_id or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(org);
    perform sm_access_bump_user(org, new.user_id);
    perform sm_access_bump_user(org, new.manager_id);
    perform sm_access_bump_user(org, new.delegate_id);
    if old.user_id is distinct from new.user_id then perform sm_access_bump_user(org, old.user_id); end if;
    if old.manager_id is distinct from new.manager_id then perform sm_access_bump_user(org, old.manager_id); end if;
    if old.delegate_id is distinct from new.delegate_id then perform sm_access_bump_user(org, old.delegate_id); end if;
  end if;
  return null;
end
$fn$;

create or replace function sm_access_groups() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.roles is distinct from old.roles or new.parent_id is distinct from old.parent_id or new.restricted is distinct from old.restricted
     or new.workspace_id is distinct from old.workspace_id or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

create or replace function sm_access_org_units() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.parent_id is distinct from old.parent_id or new.path is distinct from old.path or new.manager_id is distinct from old.manager_id
     or new.is_domain is distinct from old.is_domain or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

create or replace function sm_access_workspaces() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.secure is distinct from old.secure or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

create or replace function sm_access_roles() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.key is distinct from old.key or new.grants is distinct from old.grants or new.field_groups is distinct from old.field_groups
     or new.contains is distinct from old.contains or new.workspaces is distinct from old.workspaces or new.domains is distinct from old.domains
     or new.active is distinct from old.active or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
    perform sm_access_bump_everyone(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_group_members_access on sm_group_members;
create trigger sm_group_members_access after insert or update or delete on sm_group_members for each row execute function sm_access_group_members();
drop trigger if exists sm_member_profiles_access on sm_member_profiles;
create trigger sm_member_profiles_access after insert or update or delete on sm_member_profiles for each row execute function sm_access_member_profiles();
drop trigger if exists sm_groups_access on sm_groups;
create trigger sm_groups_access after insert or update or delete on sm_groups for each row execute function sm_access_groups();
drop trigger if exists sm_org_units_access on sm_org_units;
create trigger sm_org_units_access after insert or update or delete on sm_org_units for each row execute function sm_access_org_units();
drop trigger if exists sm_workspaces_access on sm_workspaces;
create trigger sm_workspaces_access after insert or update or delete on sm_workspaces for each row execute function sm_access_workspaces();
drop trigger if exists sm_roles_access on sm_roles;
create trigger sm_roles_access after insert or update or delete on sm_roles for each row execute function sm_access_roles();

insert into sm_migrations (id) values ('0007_access') on conflict (id) do nothing;

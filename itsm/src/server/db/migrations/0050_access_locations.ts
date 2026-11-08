// Access: the condition environment of a member names their location and the locations above it (`is_my_location`,
// docs/spec/ENGINE.md § Conditions), read from the organisation's access snapshot. The access version must move when
// a member's location or the location tree changes, as it does for units and groups (0007_access) — without a scope
// epoch: locations decide notifications and conditions, never which records a member reads.
export default /* sql */ `
create or replace function sm_access_profile_location() returns trigger language plpgsql as $fn$
begin
  if new.location_id is distinct from old.location_id then
    perform sm_access_bump(new.org_id);
  end if;
  return null;
end
$fn$;

create or replace function sm_access_locations() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'UPDATE' or new.parent_id is distinct from old.parent_id or new.path is distinct from old.path or new.deleted_at is distinct from old.deleted_at then
    perform sm_access_bump(coalesce(new.org_id, old.org_id));
  end if;
  return null;
end
$fn$;

drop trigger if exists sm_member_profiles_location on sm_member_profiles;
create trigger sm_member_profiles_location after update on sm_member_profiles for each row execute function sm_access_profile_location();
drop trigger if exists sm_locations_access on sm_locations;
create trigger sm_locations_access after insert or update or delete on sm_locations for each row execute function sm_access_locations();
`;

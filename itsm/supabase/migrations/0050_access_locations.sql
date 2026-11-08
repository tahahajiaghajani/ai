-- «ITSM» migration 0050_access_locations — دسترسی: مکان عضو در محیط شرط‌ها (مکان من)
create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now());

-- ---------------------------------------------------------------------------
-- 0050_access_locations — دسترسی: مکان عضو در محیط شرط‌ها (مکان من)
-- ---------------------------------------------------------------------------
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

insert into sm_migrations (id) values ('0050_access_locations') on conflict (id) do nothing;

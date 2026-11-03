// 0017: one live product per board key (tz_items.rate_key) also on databases that ran an earlier
// build of 0013 (a preview), which created only a plain index. 0013 now creates the unique index
// itself, so on other databases this is a no-op. A key held twice stays on the product created
// first. Like 0013's data blocks it runs with taraz.applying on: the rows keep their updated_at
// (a migration's touch must not win last-writer-wins against a real edit) and a Windows app does
// not queue them (each side runs the same migration; a later clash is settled by sync).
export default /* sql */ `
do $do$
begin
  perform set_config('taraz.applying', 'on', true);
  update tz_items i set rate_key = null
   where i.rate_key is not null and i.deleted_at is null
     and exists (select 1 from tz_items j
                  where j.org_id = i.org_id and j.rate_key = i.rate_key and j.deleted_at is null
                    and (j.created_at, j.id) < (i.created_at, i.id));
  perform set_config('taraz.applying', 'off', true);
end
$do$;
drop index if exists tz_items_rate_key_idx;
create unique index if not exists tz_items_rate_key_uk on tz_items (org_id, rate_key) where rate_key is not null and deleted_at is null;
`;

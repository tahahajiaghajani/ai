// 0017: one live product per board key (tz_items.rate_key) also on databases that ran an earlier
// build of 0013 (a preview), which created only a plain index. 0013 now creates the unique index
// itself, so on other databases this is a no-op. A key held twice keeps it on the oldest product;
// the others lose it as a normal change (synced like any edit) and can be given a key again.
export default /* sql */ `
update tz_items i set rate_key = null
 where i.rate_key is not null and i.deleted_at is null
   and exists (select 1 from tz_items j where j.org_id = i.org_id and j.rate_key = i.rate_key and j.deleted_at is null and j.id < i.id);
drop index if exists tz_items_rate_key_idx;
create unique index if not exists tz_items_rate_key_uk on tz_items (org_id, rate_key) where rate_key is not null and deleted_at is null;
`;

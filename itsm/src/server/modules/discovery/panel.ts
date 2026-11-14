// Whether a CI's or an asset's page shows the side panel «منبع‌ها و وضعیت پایش» (design A §15, DA4). Today's record kit
// shows a side panel by its `when` over the record and its meta (as event management, CSM and requests do), so the
// record's meta carries `discovery: { panel: true }` only when there is something for this person to see:
//   · they read status (status.ts readerOf: CMDB readers, and for assets also asset readers beyond their own — never
//     requesters, never the Windows app, which readerOf refuses);
//   · a source reports the record (a live item names it) or status is kept for it (its discovery_state row).
// One indexed probe per CI or asset page (sm_discovery_states and sm_discovery_items have ci_id and asset_id indexes).
// What the panel then shows is GET /discovery/panel/:table/:id, which checks the record's read rules again.
import { registerRecordMeta } from "../../engine";
import { isUuid } from "../event/common";
import { readerOf } from "./status";

let installed = false;

export function installPanelMeta(): void {
  if (installed) return;
  installed = true;
  for (const table of ["ci", "asset"] as const) {
    registerRecordMeta(table, async ({ q, ctx, row }) => {
      let cmdb: boolean;
      try {
        cmdb = (await readerOf(ctx)).cmdb;
      } catch {
        return null;
      }
      // a CI's sources and status are the CMDB's (a branch officer sees status on the asset only)
      if (table === "ci" && !cmdb) return null;
      const ciId = table === "ci" ? String(row.id) : isUuid(row.ci_id) ? String(row.ci_id) : null;
      const assetId = table === "asset" ? String(row.id) : null;
      const hit = await q.one<{ on: boolean }>(
        `select exists (select 1 from sm_discovery_states s where s.org_id = $1 and s.deleted_at is null and (s.ci_id = $2::uuid or s.asset_id = $3::uuid))
             or exists (select 1 from sm_discovery_items i where i.org_id = $1 and i.deleted_at is null and (i.state is null or i.state not in ('gone', 'ignored'))
                          and (i.ci_id = $2::uuid or i.asset_id = $3::uuid)) as on`,
        [ctx.org.id, ciId, assetId],
      );
      return hit?.on ? { discovery: { panel: true } } : null;
    });
  }
}

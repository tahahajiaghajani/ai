// «زنده»: a cheap token that changes whenever a business's data changes, so open screens can
// refresh what another device changed (GET /o/:org/pulse, polled by src/ui/lib/live.ts).
// - Web version: the business's sync revision (sm_org_sync), which sm_sync_touch moves on every
//   change of a synced record, whoever made it: a browser or phone, a Windows app's upload, the
//   platform admin. One indexed row read, no table scan.
// - Windows app: a counter of this process, moved after every local write (any browser on the
//   shop network included) and after a download from the web version changed something here.
import type { Ctx } from "./context";

const local = new Map<string, number>();
// a restarted Windows app never hands out a token an open screen already saw
const boot = Date.now();

export function bumpLocal(orgId: string): void {
  local.set(orgId, (local.get(orgId) ?? 0) + 1);
}

export async function pulse(ctx: Ctx): Promise<string> {
  if (ctx.cfg.mode === "cloud") {
    const row = await ctx.db.one<{ rev: string }>(`select rev::text as rev from sm_org_sync where org_id = $1`, [ctx.org.id]);
    return `w${row?.rev ?? "0"}`;
  }
  return `d${boot}.${local.get(ctx.org.id) ?? 0}`;
}

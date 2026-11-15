// «زنده»: a cheap token that changes whenever an organisation's data changes, so open screens can
// refresh what another device changed (GET /o/:org/pulse, polled by src/ui/lib/live.ts). Screens name the
// tables and records they show and are told which of those changed (src/server/live-scope.ts): a write
// elsewhere in the organisation no longer refetches every open page, and nothing the member may not read
// is ever signalled.
// - Web version and server edition: the database's snapshot (`x` + xmin:xmax:xip, src/server/sync/snapshot.ts) —
//   sync revisions are the ids of the transactions that wrote the rows, so «what changed since the screen's last
//   look» is the rows whose writer became visible between its token and this one, whoever wrote them: a browser or
//   phone, a Windows app's upload, a job, the platform admin. One function call, no table read, no lock.
// - Windows app: a counter of this process, moved after every local write (any browser on the
//   shop network included) and after a download from the web version changed something here.
import type { Ctx } from "./context";
import { currentSnap, snapText } from "./sync/snapshot";

const local = new Map<string, number>();
// a restarted Windows app never hands out a token an open screen already saw
const boot = Date.now();

export function bumpLocal(orgId: string): void {
  local.set(orgId, (local.get(orgId) ?? 0) + 1);
}

export async function pulse(ctx: Ctx): Promise<string> {
  if (ctx.cfg.mode === "cloud") return `x${snapText(await currentSnap(ctx.db))}`;
  return `d${boot}.${local.get(ctx.org.id) ?? 0}`;
}

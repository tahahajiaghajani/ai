// Precedence of connector sources (design A §8.1). Each connector owns one CMDB data source (1:1, made by config.ts),
// and that row's place among the sources is guarded on every write path — the record API, AI tools and flows through
// `beforeWrite`, a Windows app's push (which runs no `beforeWrite`) through `validatePush` / `validatePushDelete`:
//   · its kind and its deletion are refused: «این منبع از آنِ اتصال «…» است؛ آن را در «منبع‌های داده» تغییر دهید»;
//   · its priority stays above the settings' manual priority — a connector never outranks what people set by hand —
//     unless the connector's «معتبرتر از ویرایش دستی» (`over_manual`) is on: a CMDB administrator's choice, with
//     re-authentication and a journal line on the connector (the connector's guard, §14.5);
//   · its name, description, staleness and the rest stay editable in the CMDB's screens.
// The module's own trusted writes pass (a connector's soft delete sets its source inactive; the engine's stamps). A
// source whose connector is deleted is an ordinary source again.
import { pushGuard, registerHooks, type PushArgs, type WriteArgs } from "../../engine/hooks";
import { isSystemCtx } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import type { Queryable } from "../../db";
import { cmdbConfig } from "../cmdb/common";

const faNum = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** The refusal of a change to a connector's own source. */
export const ownedSourceMessage = (connector: string) => `این منبع از آنِ اتصال «${connector}» است؛ آن را در «منبع‌های داده» تغییر دهید`;

/** The live connector a data source belongs to, if any. */
export async function sourceOwner(q: Queryable, orgId: string, sourceId: string): Promise<{ id: string; name: string; over_manual: boolean } | null> {
  const r = await q.one<{ id: string; name: string; over_manual: boolean | null }>(
    `select id, name, over_manual from sm_discovery_connectors where org_id = $1 and source_id = $2::uuid and deleted_at is null order by created_at limit 1`,
    [orgId, sourceId],
  );
  return r ? { id: r.id, name: r.name, over_manual: !!r.over_manual } : null;
}

async function guard(w: WriteArgs): Promise<void> {
  if (w.op === "create" || !w.prev) return;
  if (w.trusted && isSystemCtx(w.ctx)) return;
  const owner = await sourceOwner(w.tx, w.ctx.org.id, String(w.prev.id));
  if (!owner) return;
  if (w.op === "delete") throw forbidden(ownedSourceMessage(owner.name));
  if (w.changed.has("kind")) throw bad(ownedSourceMessage(owner.name), { field: "kind" });
  if (w.changed.has("priority") && !owner.over_manual) {
    const manual = (await cmdbConfig(w.tx, w.ctx)).manual_priority;
    if (Number(w.next.priority) <= manual) {
      throw bad(`اولویت منبع اتصال «${owner.name}» باید بیشتر از ${faNum(manual)} (اولویت ویرایش دستی) بماند؛ برای معتبرتر کردن آن، «معتبرتر از ویرایش دستی» را در خود منبع داده روشن کنید`, { field: "priority" });
    }
  }
}

let installed = false;

/** The guard on connector-owned data sources (once per process, from installDiscoveryModule). */
export function installSourceGuard(): void {
  if (installed) return;
  installed = true;
  registerHooks("cmdb_data_source", {
    beforeWrite: guard,
    validatePush: pushGuard(guard),
    async validatePushDelete(p: PushArgs) {
      if (isSystemCtx(p.ctx) || !p.prev) return null;
      const owner = await sourceOwner(p.tx, p.ctx.org.id, String(p.prev.id));
      return owner ? ownedSourceMessage(owner.name) : null;
    },
  });
}

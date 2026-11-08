// The CMDB's hook into change enablement (catalogue CHG-017, CHG-045, CHG-030, CHG-054). Configuration items and
// services arrive with the CMDB module (a parallel branch); until it registers its provider the change keeps the CIs
// and services people pick (`affected_cis`, `affected_services`) and computes no impact — conflicts then compare the
// picked CIs and services only. Contract for the CMDB module:
//
//   registerImpactProvider({
//     impactedServices: async (q, ctx, ciIds, { depth }) => serviceIds,      // upstream services of the CIs (depth-limited)
//     relatedCis: async (q, ctx, ciIds, { depth }) => new Map([[ci, [neighbour…]]]),   // n-hop neighbours (indirect conflicts)
//     owners: async (q, ctx, change) => userIds,                             // service / CI owners (approver source «service_owner»)
//   });
//
// Every function runs inside the change's write transaction (reads only, no network) with the system context of the
// organisation; results are filtered by the caller's access wherever they are shown.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import type { Row } from "./common";

export interface ImpactProvider {
  impactedServices?(q: Queryable, ctx: Ctx, ciIds: string[], opts: { depth: number }): Promise<string[]>;
  relatedCis?(q: Queryable, ctx: Ctx, ciIds: string[], opts: { depth: number }): Promise<Map<string, string[]>>;
  owners?(q: Queryable, ctx: Ctx, change: Row): Promise<string[]>;
}

let provider: ImpactProvider = {};

/** Plug the CMDB in (a later registration replaces the earlier one); returns an unregister function. */
export function registerImpactProvider(p: ImpactProvider): () => void {
  provider = p;
  return () => {
    if (provider === p) provider = {};
  };
}

export const impactProvider = (): ImpactProvider => provider;

/** Services impacted by the CIs (empty without a CMDB provider). */
export async function impactedServicesOf(q: Queryable, ctx: Ctx, ciIds: string[]): Promise<string[] | null> {
  if (!provider.impactedServices || !ciIds.length) return provider.impactedServices ? [] : null;
  return [...new Set(await provider.impactedServices(q, ctx, ciIds, { depth: 3 }))];
}

/** Neighbouring CIs within two hops (empty without a CMDB provider). */
export async function relatedCisOf(q: Queryable, ctx: Ctx, ciIds: string[]): Promise<Map<string, string[]> | undefined> {
  if (!provider.relatedCis || !ciIds.length) return undefined;
  return provider.relatedCis(q, ctx, ciIds, { depth: 2 });
}

// Configuration management plugged into change enablement (src/server/modules/change/impact.ts): the services a
// change's CIs reach (`impacted_services`, catalogue CHG-017), the CIs next to them for indirect conflicts (CHG-045)
// and the owners the approver source «service_owner» asks (CHG-030) — the owners of the record's services (its
// service, its offering's service, its affected and impacted services) and of its CIs. Every function runs inside the
// caller's transaction with the system context of the organisation; reads only.
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { tableDef } from "@shared/tables";
import { registerImpactProvider, type ImpactProvider } from "../change/impact";
import { servicesImpactedBy } from "./impact";
import { walk } from "./graph";
import { isUuid, liveRow, liveRows, sysOf, type Row } from "./common";

const ids = (v: unknown): string[] => (Array.isArray(v) ? v : v ? [v] : []).filter(isUuid).map((x) => String(x).toLowerCase());

/** Neighbours of each CI within `depth` hops (both directions, at most 50 per CI). */
export async function relatedCis(q: Queryable, ctx: Ctx, ciIds: string[], depth: number): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const ci of [...new Set(ids(ciIds))].slice(0, 20)) {
    const w = await walk(q, sysOf(ctx), [ci], { depth: Math.max(1, Math.min(3, depth)), direction: "both", maxNodes: 51 });
    out.set(ci, [...w.depth.keys()].filter((x) => x !== ci));
  }
  return out;
}

/** Owners of the services and CIs a record names (service owners first). */
export async function recordOwners(q: Queryable, ctx: Ctx, row: Row): Promise<string[]> {
  const sys = sysOf(ctx);
  const people = new Set<string>();
  if (tableDef("service")) {
    const services = new Set([...ids(row.service_id), ...ids(row.affected_services), ...ids(row.impacted_services)]);
    if (isUuid(row.offering_id) && tableDef("service_offering")) {
      const o = await liveRow(q, sys, "service_offering", row.offering_id);
      if (isUuid(o?.service_id)) services.add(String(o!.service_id).toLowerCase());
    }
    if (services.size) for (const s of await liveRows(q, sys, "service", { f: "id", op: "in", v: [...services] }, { limit: 100 })) if (isUuid(s.owner_id)) people.add(s.owner_id);
  }
  const cis = [...new Set([...ids(row.ci_id), ...ids(row.affected_cis)])];
  if (cis.length) for (const c of await liveRows(q, sys, "ci", { f: "id", op: "in", v: cis }, { limit: 100 })) if (isUuid(c.owned_by)) people.add(c.owned_by);
  return [...people];
}

export const CMDB_IMPACT_PROVIDER: ImpactProvider = {
  impactedServices: (q, ctx, ciIds, { depth }) => servicesImpactedBy(q, ctx, ciIds, depth),
  relatedCis: (q, ctx, ciIds, { depth }) => relatedCis(q, ctx, ciIds, depth),
  owners: (q, ctx, change) => recordOwners(q, ctx, change),
};

/** Register the CMDB as the change module's impact provider (installCmdbModule). */
export function installCmdbChangeLink(): () => void {
  return registerImpactProvider(CMDB_IMPACT_PROVIDER);
}

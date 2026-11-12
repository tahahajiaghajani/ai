// A stored item's record → an item of the reconciliation engine (design A §6.3, §7.4): the allow-listed CI fields and
// class attributes (@shared/discovery/mapping `ciValues`), its class, the identity hint of a linked item, and its
// `runs_on` relation to its parent (inside one call by index, else the parent's CI). Mismatches with what people and
// ITAM hold (§8.3) are computed from the engine's results by mismatch.ts (DA1 part 2).
import { ciValues } from "@shared/discovery/mapping";
import { ITEM_KIND_CLASS } from "@shared/discovery/kinds";
import type { DiscoveredRecord } from "@shared/discovery/types";
import type { IreItem, IreRelation } from "@shared/cmdb/api";
import { pgArray, type Queryable } from "../../db";

/** The relationship a record's parent gets (a VM runs on its host). */
export const PARENT_REL = "runs_on";

/** The CI class of a record: its own, else the connector's default, else its item kind's (§6.3). */
export function recordClass(record: DiscoveredRecord, defaultClass: string | null): string {
  return record.class || defaultClass || ITEM_KIND_CLASS[record.kind] || "ci";
}

/** May the engine create a CI for this record? Never for ATMs (they match assets, §9.5), else by the create policy. */
export function mayCreate(record: DiscoveredRecord, createPolicy: string | null | undefined): boolean {
  return record.kind !== "atm" && (createPolicy ?? "create") === "create";
}

export interface IreItemInput {
  record: DiscoveredRecord;
  defaultClass: string | null;
  /** the CI the item is linked to */
  hint: string | null;
  relations?: IreRelation[];
  /** leave the serial out: the CI is linked to an asset and ITAM's values carry no provenance yet (§8.3 b) */
  dropSerial?: boolean;
}

export function ireItem(x: IreItemInput): IreItem {
  const { values, attrs } = ciValues(x.record);
  if (x.dropSerial) delete values.serial_number;
  return { class: recordClass(x.record, x.defaultClass), values: { ...values }, attrs, relations: x.relations ?? [], ci_hint: x.hint };
}

/**
 * CIs (of these) linked to an asset: their serial is ITAM's (`syncCi` writes it without provenance until the
 * integrator's stamp lands, §8.3 b), so a tool never updates it — identification still uses it.
 */
export async function cisWithAssets(q: Queryable, orgId: string, ciIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(ciIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await q.query<{ ci_id: string }>(`select ci_id from sm_assets where org_id = $1 and deleted_at is null and ci_id = any($2::uuid[])`, [orgId, pgArray(ids)]);
  return new Set(rows.map((r) => r.ci_id));
}

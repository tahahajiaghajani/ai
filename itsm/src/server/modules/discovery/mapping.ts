// A stored item's record → an item of the reconciliation engine (design A §6.3, §7.4): the allow-listed CI fields and
// class attributes (@shared/discovery/mapping `ciValues`), its class, the identity hint of a linked item, and its
// `runs_on` relation to its parent (inside one call by index, else the parent's CI). The serial is sent like every
// allow-listed field: ITAM's values carry its provenance on the CI (`syncCi`, §8.3 b), so the engine keeps them, and a
// difference becomes a mismatch for the asset manager (mismatch.ts).
import { ciValues } from "@shared/discovery/mapping";
import { ITEM_KIND_CLASS } from "@shared/discovery/kinds";
import type { DiscoveredRecord } from "@shared/discovery/types";
import type { IreItem, IreRelation } from "@shared/cmdb/api";

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
}

export function ireItem(x: IreItemInput): IreItem {
  const { values, attrs } = ciValues(x.record);
  return { class: recordClass(x.record, x.defaultClass), values: { ...values }, attrs, relations: x.relations ?? [], ci_hint: x.hint };
}

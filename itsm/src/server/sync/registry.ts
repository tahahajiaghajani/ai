// Synchronised aggregates: a root row (with rev/updated_at/deleted_at/origin) plus child rows that always
// travel and are replaced together. Every root needs the trigger sm_sync_touch('<entity>') in a migration
// (tests/sync-registry.test.ts checks both). The platform synchronises organisations and their members;
// modules add their own roots here (or call `registerAggregate`).
//
// Record engine tables need nothing here: every TableDef with `features.sync !== false` becomes a root of its own
// (entity = its key) as soon as it is registered, and the engine's journal, history, attachments and links are
// roots too. Their pushes and pulls go through the engine's rules (src/server/engine/sync.ts).
import type { Area } from "@shared/permissions";
import type { Queryable } from "../db";
import { onTableRegistered } from "@shared/tables";
import { allocateNumber } from "../engine/numbering";

export interface ChildDef {
  table: string;
  fk: string;
}

export interface AggregateDef {
  entity: string;
  table: string;
  area: Area;
  children?: ChildDef[];
  /**
   * numbered record (`no` per organisation, and per `kind` when `byKind`; unique index named *_no_*): on a
   * number clash the incoming record takes the next free number
   */
  numbered?: { byKind: boolean };
  /** unique code column: on a clash the incoming row takes the next free code */
  code?: { column: string; start: number };
  /** apply order (lower first) so referenced rows usually arrive before their users */
  order: number;
  /**
   * a record engine root: "record" (a TableDef's table) or one of the engine's own tables. Pushes are checked by
   * the engine (access provider, values) instead of the area level; pulls are filtered by the access provider.
   */
  engine?: "record" | "journal" | "history" | "attachment" | "link";
  /** the next free number for a renumbered record (default: max(no) + 1 among live rows) */
  nextNumber?: (q: Queryable, orgId: string, row: Record<string, unknown>) => Promise<number>;
}

export const AGGREGATES: AggregateDef[] = [
  { entity: "org", table: "sm_orgs", area: "settings", order: 0 },
  { entity: "member", table: "sm_org_members", area: "users", order: 1 },
];

export const BY_ENTITY = new Map(AGGREGATES.map((a) => [a.entity, a]));
export const BY_TABLE = new Map(AGGREGATES.map((a) => [a.table, a]));

/** Adds a synchronised aggregate (a module's root, or a test's fixture); a known entity is replaced. */
export function registerAggregate(def: AggregateDef): void {
  const at = AGGREGATES.findIndex((a) => a.entity === def.entity);
  if (at >= 0) AGGREGATES.splice(at, 1, def);
  else AGGREGATES.push(def);
  AGGREGATES.sort((a, b) => a.order - b.order);
  BY_ENTITY.clear();
  BY_TABLE.clear();
  for (const a of AGGREGATES) {
    BY_ENTITY.set(a.entity, a);
    BY_TABLE.set(a.table, a);
  }
}

/** The engine's own synchronised tables (each row belongs to a record, or links two). */
const ENGINE_SIDE: AggregateDef[] = [
  { entity: "journal", table: "sm_journal", area: "work", order: 20, engine: "journal" },
  { entity: "history", table: "sm_history", area: "work", order: 21, engine: "history" },
  { entity: "attachment", table: "sm_attachments", area: "work", order: 22, engine: "attachment" },
  { entity: "link", table: "sm_links", area: "work", order: 23, engine: "link" },
];
for (const a of ENGINE_SIDE) registerAggregate(a);

// every engine table that synchronises is a root (tables registered later — modules, tests — included)
onTableRegistered((def) => {
  if (def.virtual || def.features?.sync === false) return;
  registerAggregate({
    entity: def.key,
    table: def.table,
    area: def.area,
    order: 10,
    engine: "record",
    ...(def.numbered ? { numbered: { byKind: false }, nextNumber: (q: Queryable, orgId: string) => allocateNumber(q, def, orgId) } : {}),
  });
});

export interface WireAggregate {
  entity: string;
  id: string;
  base_rev: number;
  row: Record<string, unknown>;
  children: Record<string, Record<string, unknown>[]>;
}

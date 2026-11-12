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
    // an access area of the ITSM model (`@shared/access`): engine roots are judged by the access provider, never by
    // the membership-role level of `area`
    area: def.area as Area,
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

// ----- the order of a push (src/server/routes/sync.ts) -----

type PushKey = (row: Record<string, unknown>) => (string | number)[];
const pushKeys = new Map<string, PushKey>();

/**
 * A module's order for its rows within one apply order of a push (docs/spec/ENGINE.md «ترتیب ارسال»): a Windows app
 * sends its outbox in whatever order it reads it, so a ledger's rows come after the record they trace and in their own
 * sequence only when the module says so. Rows without a key sort first and keep the order they came in.
 */
export function registerPushOrder(entity: string, key: PushKey): void {
  pushKeys.set(entity, key);
}

/** The order a push applies its rows in: the aggregates' apply order, then the modules' keys (a stable sort). */
export function comparePush(a: WireAggregate, b: WireAggregate): number {
  const d = (BY_ENTITY.get(a.entity)?.order ?? 99) - (BY_ENTITY.get(b.entity)?.order ?? 99);
  if (d) return d;
  const x = pushKeys.get(a.entity)?.(a.row) ?? [0];
  const y = pushKeys.get(b.entity)?.(b.row) ?? [0];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? "";
    const q = y[i] ?? "";
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

const batches = new WeakMap<object, WireAggregate[]>();

/** The rows of the push being applied for `key` (the pushing member's context), in apply order. */
export function setPushBatch(key: object, rows: WireAggregate[]): void {
  batches.set(key, rows);
}

/** The other rows of the push a row came with (a ledger judged as a segment): empty outside a push. */
export function pushBatchOf(key: object): WireAggregate[] {
  return batches.get(key) ?? [];
}

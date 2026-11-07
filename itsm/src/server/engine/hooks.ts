// Module code around the engine's generic writes, per table (or "*" for every table). All of it runs inside the
// write transaction, so a hook that throws (an AppError with a Persian message) refuses the whole write:
//
//   registerHooks("incident", {
//     beforeWrite(w) { if (w.next.priority === "1" && !w.next.assignment_group_id) throw bad("…"); },
//     afterWrite(w)  { … keep a derived table in step with w.tx … },
//     validateTransition(w) { return w.next.close_code === "duplicate" && !w.next.parent_id ? "…" : null; },
//     guards: { has_approval: (w) => w.prev?.approval === "approved" ? null : "تأیید لازم است" },
//   });
//
// - beforeWrite may change `w.next` (values it sets are coerced like a caller's, without permission checks).
// - afterWrite sees the stored row; use it for follow-ups in the same transaction (never call a model or another
//   service here — enqueue a job instead).
// - validateTransition / guards return a Persian refusal or null. A guard is named by a transition's `guard`.
// - registerRecordMeta adds keys to the `meta` of GET /r/:table/:id (e.g. the SLA module's `sla` timers).
// Each register* returns a function that removes the registration (tests).
import type { CondEnv } from "@shared/model/conditions";
import type { TableDef, Transition } from "@shared/model/types";
import type { Ctx } from "../context";
import type { Queryable, Tx } from "../db";

export type Row = Record<string, any>;
export type WriteOp = "create" | "update" | "transition" | "delete" | "restore";

export interface WriteArgs {
  tx: Tx;
  ctx: Ctx;
  def: TableDef;
  op: WriteOp;
  /** the row as it will be stored (custom fields flattened as u_* keys); mutable in beforeWrite */
  next: Row;
  /** the stored row before this write (null on a create) */
  prev: Row | null;
  /** the fields whose value this write changes */
  changed: Set<string>;
  /** the transition being taken (op "transition") */
  transition?: Transition;
  env: CondEnv;
  /** the fields the caller's input set (empty for deletes) */
  input?: ReadonlySet<string>;
  /** how the write came in (WriteOptions.via; default "api") */
  via?: "api" | "import" | "sync";
  /** trusted server code wrote it (WriteOptions.trusted) */
  trusted?: boolean;
}

/** A row a Windows app pushed (the cloud applying it): hooks do not run again, but may refuse it. */
export interface PushArgs {
  tx: Tx;
  ctx: Ctx;
  def: TableDef;
  /** the stored row (null when the push creates it) */
  prev: Row | null;
  /** the row as it will be stored */
  next: Row;
  changed: Set<string>;
  env: CondEnv;
}

export type HookResult = string | null | undefined | void;

export interface TableHooks {
  beforeWrite?(w: WriteArgs): Promise<void> | void;
  afterWrite?(w: WriteArgs & { row: Row }): Promise<void> | void;
  validateTransition?(w: WriteArgs & { transition: Transition }): Promise<HookResult> | HookResult;
  guards?: Record<string, (w: WriteArgs & { transition: Transition }) => Promise<HookResult> | HookResult>;
  /** a sync push of a record (rules with side effects ran where the person acted): a Persian refusal or null */
  validatePush?(p: PushArgs): Promise<HookResult> | HookResult;
}

const registry = new Map<string, TableHooks[]>();

/** Register hooks for a table key ("*" = every table). Returns an unregister function. */
export function registerHooks(table: string, hooks: TableHooks): () => void {
  registry.set(table, [...(registry.get(table) ?? []), hooks]);
  return () => registry.set(table, (registry.get(table) ?? []).filter((h) => h !== hooks));
}

/** Hooks that apply to `table`: its own first, then the "*" ones, each in registration order. */
export function hooksFor(table: string): TableHooks[] {
  return [...(registry.get(table) ?? []), ...(registry.get("*") ?? [])];
}

/** The guard of that name for `table` (undefined when no module registered it). */
export function guardFor(table: string, name: string) {
  for (const h of hooksFor(table)) if (h.guards?.[name]) return h.guards[name];
  return undefined;
}

export interface MetaArgs {
  q: Queryable;
  ctx: Ctx;
  def: TableDef;
  row: Row;
  env: CondEnv;
}
export type MetaProvider = (m: MetaArgs) => Promise<Record<string, unknown> | null | undefined> | Record<string, unknown> | null | undefined;

const metaProviders = new Map<string, MetaProvider[]>();

/** Add keys to a record's `meta` (GET /r/:table/:id) for `table` ("*" = every table). */
export function registerRecordMeta(table: string, fn: MetaProvider): () => void {
  metaProviders.set(table, [...(metaProviders.get(table) ?? []), fn]);
  return () => metaProviders.set(table, (metaProviders.get(table) ?? []).filter((x) => x !== fn));
}

export function metaProvidersFor(table: string): MetaProvider[] {
  return [...(metaProviders.get(table) ?? []), ...(metaProviders.get("*") ?? [])];
}

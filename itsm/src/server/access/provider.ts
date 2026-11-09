// The access provider: the ONE place the record engine asks who may read, create, change or delete which rows and
// fields. Every read path of the engine (list, get, aggregate, display values of references, journal, history,
// attachments, links, export, import look-ups, sync pull) builds its SQL with `readWhere`; every write path asks
// `canCreate` / `canWrite` / `canDelete` and `writableFields`. Replace the provider with `setAccessProvider` — the
// ITSM access model (org tree, data scopes, field security, domain separation) does exactly that.
//
// Contract for implementations (docs/spec/ENGINE.md § Access provider):
// - `readWhere` returns a SQL predicate on the row aliased `alias`, pushing its parameters onto `params` ($n
//   placeholders numbered from params.length + 1). It MUST include tenant isolation (`<alias>.org_id = $org`) and
//   MUST NOT filter deleted rows (the engine adds `deleted_at is null` where it wants live rows only: the sync pull
//   sends deleted rows the caller may read). For the virtual `user` table the alias is a `sm_org_members` row.
// - `ctx.actor === "system"` (jobs, flows, rules running as the system) is allowed everything within its org.
// - Table row rules (`TableDef.rowAccess`) are applied by the engine on top of the provider; a provider does not
//   repeat them.
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import type { FieldGroup, TableDef, Transition } from "@shared/model/types";
import type { CondEnv } from "@shared/model/conditions";
import type { Area, Level } from "@shared/permissions";
import { DEFAULT_TIMEZONE } from "@shared/constants";

export type Row = Record<string, unknown>;

export interface AccessProvider {
  readonly name: string;
  /** SQL predicate the rows of `def` (aliased `alias`) must satisfy to be readable by `ctx`. */
  readWhere(ctx: Ctx, def: TableDef, alias: string, params: unknown[]): string;
  /** May the caller read rows of this table at all (lists, meta, routes)? */
  canReadTable(ctx: Ctx, def: TableDef): boolean;
  /** May the caller create a row (`row` = the values about to be inserted, when known)? */
  canCreate(ctx: Ctx, def: TableDef, row?: Row | null): boolean;
  /** May the caller change this (readable) row? */
  canWrite(ctx: Ctx, def: TableDef, row: Row): boolean;
  /**
   * How the caller may change this row: "full" (they work it), "requester" (their own record: only its requester
   * fields and transitions) or null. A provider without a requester mode leaves it out (`canWrite` means full).
   */
  writeMode?(ctx: Ctx, def: TableDef, row: Row): "full" | "requester" | null;
  canDelete(ctx: Ctx, def: TableDef, row: Row): boolean;
  /** Fields the caller may see (null = all). Hidden fields are stripped from every output and refused in filters. */
  visibleFields(ctx: Ctx, def: TableDef): ReadonlySet<string> | null;
  /** Fields the caller may set on this row (null row = a new one; null result = all visible ones). */
  writableFields(ctx: Ctx, def: TableDef, row: Row | null): ReadonlySet<string> | null;
  /** Does the caller carry a field group (journal `internal` items need "internal")? */
  hasFieldGroup(ctx: Ctx, group: FieldGroup): boolean;
  /** May the caller take this transition on this row (beyond canWrite)? */
  canTransition(ctx: Ctx, def: TableDef, row: Row, t: Transition): boolean;
  /** The caller's identity for conditions: groups, unit, time zone… (cached per request by the engine). */
  env(ctx: Ctx): Promise<CondEnv>;
  /**
   * Tables in which the caller reads some rows only as a participant with a grant of its own (an approver, a
   * service's owner) although no role reads the table's area: single-record reads (`get`, `requireReadable`), the
   * table's meta, lists and aggregates open for them (over the rows `readWhere` grants them and nothing else);
   * exports and module routes keep asking `canReadTable`.
   * A provider without participants leaves it out.
   */
  participations?(ctx: Ctx, q: Queryable): Promise<ReadonlySet<string>>;
  /**
   * Load whatever the synchronous methods above need about the caller (their roles, groups, units…) through `q` —
   * the request's transaction when there is one. The engine awaits it before any other call for a context
   * (`orgSchema`); a provider that needs nothing leaves it out.
   */
  prepare?(ctx: Ctx, q: Queryable): Promise<void>;
}

export const isSystem = (ctx: Ctx) => ctx.actor === "system";

const DEFAULT_LEVELS = { read: "view", create: "edit", write: "edit", delete: "full" } as const satisfies Record<string, Level>;

/** The level of `def.area` an operation needs (TableDef.levels overrides the defaults). */
export function levelFor(def: TableDef, op: keyof typeof DEFAULT_LEVELS): Level {
  return def.levels?.[op] ?? DEFAULT_LEVELS[op];
}

/**
 * The default provider: tenant isolation plus the platform's area levels (`@shared/permissions`) of `def.area` —
 * read = view, create/write = edit, delete = full (or `def.levels`); all fields visible; journal `internal` items
 * for everyone but viewers; transitions with `roles` need that area level.
 */
export const defaultProvider: AccessProvider = {
  name: "default",
  readWhere(ctx, def, alias, params) {
    if (!isSystem(ctx) && !ctx.can(def.area as Area, levelFor(def, "read"))) return "false";
    params.push(ctx.org.id);
    return `${alias}.org_id = $${params.length}`;
  },
  canReadTable: (ctx, def) => isSystem(ctx) || ctx.can(def.area as Area, levelFor(def, "read")),
  canCreate: (ctx, def) => isSystem(ctx) || ctx.can(def.area as Area, levelFor(def, "create")),
  canWrite: (ctx, def, row) => row.org_id === ctx.org.id && (isSystem(ctx) || ctx.can(def.area as Area, levelFor(def, "write"))),
  canDelete: (ctx, def, row) => row.org_id === ctx.org.id && (isSystem(ctx) || ctx.can(def.area as Area, levelFor(def, "delete"))),
  visibleFields: () => null,
  writableFields: () => null,
  hasFieldGroup(ctx, group) {
    if (isSystem(ctx) || ctx.actor === "support") return true;
    if (group === "internal") return ctx.member.role !== "viewer";
    return true;
  },
  canTransition: (ctx, _def, _row, t) => isSystem(ctx) || !t.roles || ctx.can(t.roles.area as Area, t.roles.level),
  async env(ctx) {
    return {
      userId: ctx.user.id,
      tz: (ctx.org.settings?.timezone as string | undefined) || DEFAULT_TIMEZONE,
      groups: [],
      groupUsers: [ctx.user.id],
      unitId: null,
      unitTree: [],
      unitUsers: [],
      unitTreeUsers: [],
    };
  },
};

let current: AccessProvider = defaultProvider;

/** The provider in use. */
export function access(): AccessProvider {
  return current;
}

/** Install a provider (the ITSM access model, or a test's fake); returns a function that restores the previous one. */
export function setAccessProvider(p: AccessProvider): () => void {
  const prev = current;
  current = p;
  return () => {
    current = prev;
  };
}

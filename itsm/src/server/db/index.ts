// One database interface for both targets:
// - cloud (Vercel): Supabase PostgreSQL through postgres.js (./postgres.ts)
// - desktop and tests: embedded PostgreSQL compiled to WebAssembly (PGlite, ./pglite.ts)
// Both speak the same SQL, use $1..$n parameters and return the same value shapes:
// numeric → string, int8 → number, date → 'YYYY-MM-DD', timestamptz → ISO string, json → object.

export type Row = Record<string, any>;

export interface Queryable {
  /** Run one statement with $1..$n parameters and return its rows. */
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** First row or null. */
  one<T = Row>(text: string, params?: unknown[]): Promise<T | null>;
  /** Run a script of several statements (no parameters). */
  exec(text: string): Promise<void>;
}

export interface Tx extends Queryable {
  readonly inTx: true;
}

export interface Db extends Queryable {
  readonly kind: "postgres" | "pglite";
  /** Run `fn` in a transaction; it commits when `fn` resolves and rolls back when it throws. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ----- before-commit work of a transaction ------------------------------------------------------------------------

type BeforeCommit = () => Promise<void> | void;
const pending = new WeakMap<Tx, Map<string, BeforeCommit>>();
/** Rounds of before-commit work one transaction may run (work that queues work again, e.g. a roll-up of a roll-up). */
const MAX_BEFORE_COMMIT_ROUNDS = 20;

/**
 * Run `fn` once, at the end of the transaction `tx`, just before it commits — whatever writes queue it, however many
 * times: work queued under a `key` that is already waiting is not queued again (`request.rollup:<id>`: an order's
 * totals and state from many item writes, once). The work runs in the same transaction (its writes commit with it,
 * a failure rolls everything back) in the order it was first queued; work it queues runs after it, a key that already
 * ran may run again. Work queued inside a savepoint that rolls back still runs — make it recompute from what is
 * stored. Returns whether it was queued (false: the key was already waiting).
 */
export function onBeforeCommit(tx: Tx, key: string, fn: BeforeCommit): boolean {
  let m = pending.get(tx);
  if (!m) pending.set(tx, (m = new Map()));
  if (m.has(key)) return false;
  m.set(key, fn);
  return true;
}

/**
 * Run the transaction's before-commit work (the database layers call it when the transaction's function resolved).
 * Each key is first locked for the rest of the transaction (a transaction-level advisory lock on the key's hash, keys
 * of a round in sorted order): writes of one organisation run side by side (no organisation-wide lock), so two
 * transactions recomputing the same derived value — an order's totals from its items, a group's roll-up — take turns,
 * and the second one's statements see what the first one committed (READ COMMITTED: a new snapshot per statement).
 */
export async function runBeforeCommit(tx: Tx): Promise<void> {
  for (let round = 0; ; round++) {
    const m = pending.get(tx);
    if (!m || !m.size) return;
    if (round >= MAX_BEFORE_COMMIT_ROUNDS) throw new Error(`before-commit work keeps queueing more work: ${[...m.keys()].slice(0, 5).join(", ")}`);
    pending.delete(tx);
    for (const key of [...m.keys()].sort()) await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`itsm.before_commit:${key}`]);
    for (const fn of m.values()) await fn();
  }
}

/** Values are sent as text; the server decides their types from the statement. */
export function serializeParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v && "toFixed" in (v as object) && typeof (v as { toFixed: unknown }).toFixed === "function" && "isZero" in (v as object)) {
    return (v as { toFixed(): string }).toFixed(); // Decimal
  }
  return JSON.stringify(v);
}

/** Postgres array literal for `= any($1::uuid[])`. */
export function pgArray(values: (string | number)[]): string {
  return `{${values.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

export function toIsoTimestamp(v: string): string {
  // '2026-11-01 13:33:33.103+00' → ISO 8601
  let s = v.replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/** Escape a LIKE pattern and wrap it for "contains". */
export function likeContains(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

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

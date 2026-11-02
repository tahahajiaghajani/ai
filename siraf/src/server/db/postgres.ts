// Cloud adapter: Supabase PostgreSQL through postgres.js.
// Use the Supabase *transaction pooler* URL (port 6543) on Vercel; prepared statements are off
// because the transaction pooler does not support them.
import postgres from "postgres";
import { toIsoTimestamp, type Db, type Row, type Tx } from "./index";

/**
 * postgres.js lets the server decide parameter types and serialises json/jsonb itself, so
 * objects and arrays are passed as they are (a JSON string stays a JSON string, see `types`).
 */
function pgParam(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "toFixed" in (v as object) && "isZero" in (v as object)) return (v as { toFixed(): string }).toFixed();
  return v;
}

const jsonSerialize = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));

export interface PostgresOptions {
  url: string;
  max?: number;
  ssl?: boolean;
}

export function createPostgresDb(opts: PostgresOptions): Db {
  const sql = postgres(opts.url, {
    prepare: false,
    max: opts.max ?? 3,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: opts.ssl === false ? false : "require",
    onnotice: () => {},
    connection: { application_name: "taraz" },
    types: {
      // keep dates as 'YYYY-MM-DD' and timestamps as ISO strings, int8 as JS numbers
      date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      timestamp: { to: 1114, from: [1114], serialize: (x: unknown) => String(x), parse: (x: string) => x },
      timestamptz: { to: 1184, from: [1184], serialize: (x: unknown) => String(x), parse: (x: string) => toIsoTimestamp(x) },
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      json: { to: 114, from: [114], serialize: jsonSerialize, parse: (x: string) => JSON.parse(x) },
      jsonb: { to: 3802, from: [3802], serialize: jsonSerialize, parse: (x: string) => JSON.parse(x) },
    },
  });

  const make = (s: postgres.Sql | postgres.TransactionSql): Pick<Tx, "query" | "one" | "exec"> => ({
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await s.unsafe(text, params.map(pgParam) as never[]);
      return rows as unknown as T[];
    },
    async one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
      const rows = await s.unsafe(text, params.map(pgParam) as never[]);
      return ((rows as unknown as T[])[0] ?? null) as T | null;
    },
    async exec(text: string): Promise<void> {
      await s.unsafe(text);
    },
  });

  const base = make(sql);
  return {
    kind: "postgres",
    ...base,
    async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (t) => fn({ ...make(t), inTx: true }));
      return result as T;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

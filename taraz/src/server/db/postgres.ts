// Cloud adapter: Supabase PostgreSQL through postgres.js.
// Use the Supabase *transaction pooler* URL (port 6543) on Vercel; prepared statements are off
// because the transaction pooler does not support them.
import postgres from "postgres";
import { serializeParam, toIsoTimestamp, type Db, type Row, type Tx } from "./index";

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
    },
  });

  const make = (s: postgres.Sql | postgres.TransactionSql): Pick<Tx, "query" | "one" | "exec"> => ({
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await s.unsafe(text, params.map(serializeParam) as never[]);
      return rows as unknown as T[];
    },
    async one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
      const rows = await s.unsafe(text, params.map(serializeParam) as never[]);
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

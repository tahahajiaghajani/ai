// Desktop/test adapter: PostgreSQL running inside the app (PGlite, WebAssembly).
// The data directory is a normal PostgreSQL data folder on disk; queries are serialised by
// PGlite (one connection), so a transaction holds the database until it ends.
import { PGlite } from "@electric-sql/pglite";
import { serializeParam, toIsoTimestamp, type Db, type Row, type Tx } from "./index";

export interface PgliteOptions {
  /** folder of the database; omit for an in-memory database (tests) */
  dataDir?: string;
  /** desktop mode: local writes are recorded in the sync outbox */
  desktop?: boolean;
  /** start from a backup (tar.gz of a data folder) */
  loadDataDir?: Blob;
}

const parsers = {
  1082: (v: string) => v,
  1114: (v: string) => v,
  1184: (v: string) => toIsoTimestamp(v),
  20: (v: string) => Number(v),
};

export async function createPgliteDb(opts: PgliteOptions = {}): Promise<Db & { pg: PGlite }> {
  const options = { parsers, ...(opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : {}) };
  const pg = opts.dataDir ? new PGlite(opts.dataDir, options) : new PGlite(options);
  await pg.waitReady;
  if (opts.desktop) await pg.exec(`set taraz.mode = 'desktop'`);

  const make = (q: Pick<PGlite, "query" | "exec">) => ({
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const r = await q.query<T>(text, params.map(serializeParam));
      return r.rows;
    },
    async one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
      const r = await q.query<T>(text, params.map(serializeParam));
      return r.rows[0] ?? null;
    },
    async exec(text: string): Promise<void> {
      await q.exec(text);
    },
  });

  const base = make(pg);
  return {
    kind: "pglite",
    pg,
    ...base,
    async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return pg.transaction(async (t) => fn({ ...make(t as unknown as PGlite), inTx: true }));
    },
    async close() {
      await pg.close();
    },
  };
}

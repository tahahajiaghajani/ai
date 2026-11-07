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
  /** offer the pgvector extension to the database (default true; the AI index enables it when it is offered) */
  vector?: boolean;
}

let vectorExt: Promise<unknown | null> | null = null;
/** The pgvector build for PGlite when it is installed (the Windows app ships it); null otherwise. */
function pgliteVector(): Promise<unknown | null> {
  vectorExt ??= import("@electric-sql/pglite-pgvector").then((m) => m.vector ?? null).catch(() => null);
  return vectorExt;
}

const parsers = {
  1082: (v: string) => v,
  1114: (v: string) => v,
  1184: (v: string) => toIsoTimestamp(v),
  20: (v: string) => Number(v),
};

export async function createPgliteDb(opts: PgliteOptions = {}): Promise<Db & { pg: PGlite }> {
  const vector = opts.vector === false ? null : await pgliteVector();
  const options = { parsers, ...(opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : {}), ...(vector ? { extensions: { vector } } : {}) } as ConstructorParameters<typeof PGlite>[0];
  const pg = opts.dataDir ? new PGlite(opts.dataDir, options) : new PGlite(options);
  await pg.waitReady;
  if (opts.desktop) await pg.exec(`set itsm.mode = 'desktop'`);

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
      return pg.transaction(async (t) => {
        const q = make(t as unknown as PGlite);
        let failed: unknown = null;
        const track = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
          try {
            return await f(...a);
          } catch (e) {
            failed ??= e;
            throw e;
          }
        };
        const r = await fn({ query: track(q.query), one: track(q.one), exec: track(q.exec), inTx: true } as Tx);
        // PostgreSQL answers COMMIT of a failed transaction with a silent ROLLBACK, so a statement
        // that failed (and was caught) without a rollback to a savepoint would lose the whole
        // transaction while the caller is told it succeeded. Fail it instead, as postgres.js does.
        if (failed) {
          try {
            await t.query("select 1");
          } catch {
            throw failed;
          }
        }
        return r;
      });
    },
    async close() {
      await pg.close();
    },
  };
}

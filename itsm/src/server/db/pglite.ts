// Desktop/test adapter: PostgreSQL running inside the app (PGlite, WebAssembly).
// The data directory is a normal PostgreSQL data folder on disk; queries are serialised by
// PGlite (one connection), so a transaction holds the database until it ends. A data folder's
// write-ahead log is kept small by ./wal.ts (PGlite has no checkpointer of its own).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { runBeforeCommit, serializeParam, toIsoTimestamp, type Db, type Row, type Tx } from "./index";
import { txEnded } from "./lockprobe";
import { DEMO_SCOPE_SQL, demoScopeOrg, scopedWrite } from "./scope";
import { createWalGuard, openWal, walStartParams, type CheckpointInfo, type WalGuard, type WalGuardOptions } from "./wal";
import type { Logger } from "../context";

export interface PgliteOptions {
  /** folder of the database; omit for an in-memory database (tests) */
  dataDir?: string;
  /** desktop mode: local writes are recorded in the sync outbox */
  desktop?: boolean;
  /** start from a backup (tar.gz of a data folder) */
  loadDataDir?: Blob;
  /** offer the pgvector extension to the database (default true; the AI index enables it when it is offered) */
  vector?: boolean;
  /** where the write-ahead log's checkpoints are reported (a data folder only) */
  log?: Pick<Logger, "info" | "warn">;
  /** the checkpoint scheduler of a data folder (./wal.ts): its thresholds and clock (tests), or false for none */
  wal?: WalGuardOptions | false;
}

export type PgliteDb = Db & {
  pg: PGlite;
  /** CHECKPOINT now (after an open transaction ends): before a dump of the data folder */
  checkpoint(reason: string): Promise<CheckpointInfo | null>;
  /** the write-ahead log's scheduler of a data folder (null in memory) */
  wal: WalGuard | null;
};

/** setImmediate as it was when this module loaded (a test's fake timers never hold the database up) */
const nextTurn: (fn: () => void) => void = (globalThis.setImmediate ?? ((fn: () => void) => setTimeout(fn, 0))).bind(globalThis);
/** The longest run of database work before the event loop gets a turn (see `turn` below). */
const TURN_MS = 50;

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

export async function createPgliteDb(opts: PgliteOptions = {}): Promise<PgliteDb> {
  const vector = opts.vector === false ? null : await pgliteVector();
  const options = {
    parsers,
    ...(opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : {}),
    ...(vector ? { extensions: { vector } } : {}),
    // a data folder: the write-ahead log's limits in force from this start (./wal.ts)
    ...(opts.dataDir ? { startParams: walStartParams(PGlite.defaultStartParams) } : {}),
  } as ConstructorParameters<typeof PGlite>[0];
  const pg = opts.dataDir ? new PGlite(opts.dataDir, options) : new PGlite(options);
  await pg.waitReady;
  if (opts.desktop) await pg.exec(`set itsm.mode = 'desktop'`);
  let wal: WalGuard | null = null;
  if (opts.dataDir) {
    // before anyone else uses the database: the limits persisted, an older version's spare segments walked, a checkpoint
    // (an optimisation: if it fails the database still opens, with the limits of the start parameters)
    try {
      const r = await openWal(pg, join(opts.dataDir, "pg_wal"), (p) => readdirSync(p));
      if (r.persisted || r.walked || r.segments_after < r.segments_before) opts.log?.info("database log prepared", r);
    } catch (e) {
      opts.log?.warn("database log not prepared", String((e as Error)?.message ?? e));
    }
    if (opts.wal !== false) {
      wal = createWalGuard(pg, { log: opts.log, ...opts.wal });
      wal.start();
    }
  }
  // PGlite answers through promises alone, so a run of database work (a job tick, the demo pack's load) kept Node's
  // event loop from reading the next request, serving a file of the page or firing a timer until it paused: in the
  // Windows app up to the 8-second budget of a job tick for every page (desktop-e2e, run 43088978809: API p95 8.5 s).
  // A data folder's database lets the event loop turn before an app call once 50 ms of work have gone by without one.
  let turned = performance.now();
  const turn = async () => {
    if (performance.now() - turned < TURN_MS) return;
    await new Promise<void>((r) => nextTurn(r));
    turned = performance.now();
  };
  const track = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!opts.dataDir) return fn();
    await turn();
    return wal ? wal.track(fn) : fn();
  };

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

  const direct = make(pg);
  // a lone write of demo work runs in a transaction that carries the demo setting (src/server/db/scope.ts)
  // every call of the app counts as activity: the checkpoint scheduler waits for an idle moment
  const base = {
    query: <T = Row>(text: string, params: unknown[] = []): Promise<T[]> => track(() => (scopedWrite(text) ? transaction((t) => t.query<T>(text, params), () => {}) : direct.query<T>(text, params))),
    one: <T = Row>(text: string, params: unknown[] = []): Promise<T | null> => track(() => (scopedWrite(text) ? transaction((t) => t.one<T>(text, params), () => {}) : direct.one<T>(text, params))),
    exec: (text: string): Promise<void> => track(() => (scopedWrite(text) ? transaction((t) => t.exec(text), () => {}) : direct.exec(text))),
  };
  return {
    kind: "pglite",
    pg,
    wal,
    ...base,
    async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      let probed: Tx | null = null;
      let committed = false;
      try {
        const out = await track(() => transaction(fn, (txq) => (probed = txq)));
        committed = true;
        return out;
      } finally {
        // the write-lock probe (off unless a measurement installs it): the transaction is over
        txEnded(probed, committed);
      }
    },
    async checkpoint(reason: string) {
      if (wal) return wal.checkpoint(reason);
      if (!opts.dataDir) return null;
      await pg.exec("CHECKPOINT");
      return { reason, ms: 0, bytes: 0 };
    },
    async close() {
      // a checkpoint first: the shutdown checkpoint of close() is then short, and a quit that cannot wait for it
      // replays only what was written after this one
      wal?.stop();
      if (opts.dataDir && !pg.closed) await (wal ? wal.checkpoint("close") : pg.exec("CHECKPOINT")).catch((e) => opts.log?.warn("database checkpoint before close failed", String((e as Error)?.message ?? e)));
      await pg.close();
    },
  };

  /** One transaction; `seen` learns its handle (the write-lock probe reports by it). */
  async function transaction<T>(fn: (tx: Tx) => Promise<T>, seen: (tx: Tx) => void): Promise<T> {
    return pg.transaction(async (t) => {
      const q = make(t as unknown as PGlite);
      const demo = demoScopeOrg();
      if (demo) await t.query(DEMO_SCOPE_SQL, [demo]);
      let failed: unknown = null;
      const track = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
        try {
          return await f(...a);
        } catch (e) {
          failed ??= e;
          throw e;
        }
      };
      const txq = { query: track(q.query), one: track(q.one), exec: track(q.exec), inTx: true } as Tx;
      seen(txq);
      const r = await fn(txq);
      await runBeforeCommit(txq);
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
  }
}

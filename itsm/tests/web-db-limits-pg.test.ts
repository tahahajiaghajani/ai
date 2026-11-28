// The web version's bounded waits on a real PostgreSQL (PGlite does not enforce statement_timeout): the per-transaction
// limits of the one-statement preamble (src/server/db/postgres.ts txPreamble, src/server/cloud.ts WEB_TX_LIMITS) end a
// long statement (57014), a lock wait (55P03, row or advisory) and a transaction whose client went silent (its session
// ends: CONNECTION_CLOSED) — each mapped to its 503 (src/server/http/errors.ts) — nothing of them leaks out of the
// transaction, withTxLimits overrides them, a pool without limits (scripts/migrate-db.mts, the server edition) has
// none, and the client deadline cancels a statement the server keeps running.
// Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin npx vitest run tests/web-db-limits-pg.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createPostgresDb, withTxLimits, type PostgresOptions } from "@server/db/postgres";
import { inDemoScope } from "@server/db/scope";
import { dbErrorMessage } from "@server/http/errors";
import type { Db } from "@server/db";
import { realPg, realPgAvailable, type RealPg } from "./pg-real";

const LIMITS = { statementMs: 300, lockMs: 200, idleMs: 400 };
const ORG = "0193a3c2-7d4e-7a51-9c3f-5b2e8d1a4f61";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The error `p` rejects with, and when. */
async function failure(p: Promise<unknown>): Promise<{ e: { code?: string; message?: string; cause?: { code?: string } }; ms: number }> {
  const t0 = Date.now();
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, "it should have failed").toBeTruthy();
  return { e: e as { code?: string }, ms: Date.now() - t0 };
}

/** Gates holding a second connection's transaction open; a failed test releases its own (afterEach). */
const open: (() => void)[] = [];
function gate() {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  open.push(release);
  return { held, release };
}

describe.skipIf(!realPgAvailable())("the web version's server-side limits and client deadline on a real PostgreSQL", () => {
  let pg: RealPg;
  const dbs: Db[] = [];
  const pool = (o: Partial<PostgresOptions> = {}) => {
    const db = createPostgresDb({ url: pg.url, ssl: false, max: 2, maxPipeline: 1, queueTimeoutSec: 5, txLimits: LIMITS, ...o });
    dbs.push(db);
    return db;
  };
  let other: Db;

  beforeAll(async () => {
    pg = await realPg("w114limits");
    other = createPostgresDb({ url: pg.url, ssl: false, max: 2 });
    await other.exec(`create table w114_row (id int primary key, v int not null); insert into w114_row values (1, 0);`);
  }, 120_000);
  afterEach(() => {
    for (const r of open.splice(0)) r();
  });
  afterAll(async () => {
    await Promise.all(dbs.map((d) => d.close().catch(() => undefined)));
    await other?.close();
    await pg?.stop();
  });

  it("a statement longer than statement_timeout is cancelled by the server (57014 → db_timeout)", async () => {
    const db = pool();
    const { e, ms } = await failure(db.tx((t) => t.query(`select pg_sleep(1)`)));
    expect(e.code).toBe("57014");
    expect(ms).toBeGreaterThanOrEqual(280);
    expect(ms).toBeLessThan(900);
    expect(dbErrorMessage(e)?.code).toBe("db_timeout");
    // the pool goes on
    expect(await db.one(`select 1 as v`)).toEqual({ v: 1 });
  });

  it("a row locked by another transaction is given up after lock_timeout (55P03 → db_locked)", async () => {
    const db = pool();
    const g = gate();
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const holder = other.tx(async (t) => {
      await t.query(`select v from w114_row where id = 1 for update`);
      locked();
      await g.held;
    });
    await holding;
    const { e, ms } = await failure(db.tx((t) => t.query(`update w114_row set v = v + 1 where id = 1`)));
    expect(e.code).toBe("55P03");
    expect(ms).toBeGreaterThanOrEqual(180);
    expect(ms).toBeLessThan(800);
    expect(dbErrorMessage(e)?.code).toBe("db_locked");
    g.release();
    await holder;
  });

  it("an advisory lock held elsewhere is given up after lock_timeout too (55P03)", async () => {
    const db = pool();
    const g = gate();
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const holder = other.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(724114)`);
      locked();
      await g.held;
    });
    await holding;
    const { e, ms } = await failure(db.tx((t) => t.query(`select pg_advisory_xact_lock(724114)`)));
    expect(e.code).toBe("55P03");
    expect(ms).toBeLessThan(800);
    expect(dbErrorMessage(e)?.code).toBe("db_locked");
    g.release();
    await holder;
  });

  it("a transaction whose client goes silent loses its session after idle_in_transaction_session_timeout (CONNECTION_CLOSED → db_unavailable)", async () => {
    const db = pool();
    const g = gate();
    const t0 = Date.now();
    const run = db.tx(async (t) => {
      await t.query(`update w114_row set v = v + 1 where id = 1`);
      // the client pauses for 800 ms inside its transaction (a request cut off, a stuck call)
      await Promise.race([sleep(800), g.held]);
      await t.query(`select 1`);
    });
    const { e } = await failure(run);
    const ms = Date.now() - t0;
    expect(e.code).toBe("CONNECTION_CLOSED");
    expect(ms).toBeGreaterThanOrEqual(380);
    expect(ms).toBeLessThan(780);
    expect(dbErrorMessage(e)?.code).toBe("db_unavailable");
    g.release();
    // its row lock went with the session: the row is free and unchanged, and the pool goes on
    expect(await other.tx((t) => t.one(`select v from w114_row where id = 1 for update nowait`))).toEqual({ v: 0 });
    expect(await db.one(`select 1 as v`)).toEqual({ v: 1 });
  });

  it("nothing leaks out of a transaction: the same connection's next statement has no limits", async () => {
    const db = pool({ max: 1 });
    expect(await db.tx((t) => t.one(`select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l, current_setting('idle_in_transaction_session_timeout') as i`))).toEqual({ s: "300ms", l: "200ms", i: "400ms" });
    expect(await db.one(`select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l, current_setting('idle_in_transaction_session_timeout') as i, pg_backend_pid() > 0 as same`)).toEqual({ s: "0", l: "0", i: "0", same: true });
    expect(await db.one(`select true as slept from pg_sleep(0.5)`)).toEqual({ slept: true });
  });

  it("the demo scope and the limits are set by the same opening statement", async () => {
    const db = pool();
    const r = await inDemoScope(ORG, () => db.tx((t) => t.one(`select current_setting('itsm.demo') as demo, current_setting('statement_timeout') as s, current_setting('lock_timeout') as l`)));
    expect(r).toEqual({ demo: ORG, s: "300ms", l: "200ms" });
    // a non-UUID scope goes as a parameter
    expect(await inDemoScope("not-a-uuid'--", () => db.tx((t) => t.one(`select current_setting('itsm.demo') as demo`)))).toEqual({ demo: "not-a-uuid'--" });
  });

  it("withTxLimits overrides the pool's limits for what runs inside it (the web version's migration steps), null removes them", async () => {
    const db = pool();
    await expect(db.tx((t) => t.query(`select pg_sleep(0.6)`))).rejects.toMatchObject({ code: "57014" });
    expect(await withTxLimits({ statementMs: 5_000, lockMs: 1_000, idleMs: 5_000 }, () => db.tx((t) => t.one(`select true as slept, current_setting('lock_timeout') as l from pg_sleep(0.6)`)))).toEqual({ slept: true, l: "1s" });
    expect(await withTxLimits(null, () => db.tx((t) => t.one(`select true as slept, current_setting('statement_timeout') as s from pg_sleep(0.6)`)))).toEqual({ slept: true, s: "0" });
  });

  it("a pool without limits (scripts/migrate-db.mts, the server edition) runs a long statement to its end", async () => {
    const db = pool({ txLimits: null });
    expect(await db.tx((t) => t.one(`select true as slept, current_setting('statement_timeout') as s from pg_sleep(1)`))).toEqual({ slept: true, s: "0" });
  });

  it("the client deadline cancels a statement the server keeps running (57014 at the deadline), and the connection goes on", async () => {
    const db = pool({ txLimits: null, statementClientMs: 300, statementGraceMs: 2_000, max: 1 });
    const { e, ms } = await failure(db.one(`select pg_sleep(2)`));
    expect(e.code).toBe("57014");
    expect(ms).toBeGreaterThanOrEqual(280);
    expect(ms).toBeLessThan(900);
    expect(await db.one(`select 2 as v`)).toEqual({ v: 2 });
    // inside a transaction too: cancelled, rolled back, and the pool goes on
    const inTx = await failure(db.tx((t) => t.query(`select pg_sleep(2)`)));
    expect(inTx.e.code).toBe("57014");
    expect(inTx.ms).toBeLessThan(900);
    expect(await db.one(`select 3 as v`)).toEqual({ v: 3 });
  });
});

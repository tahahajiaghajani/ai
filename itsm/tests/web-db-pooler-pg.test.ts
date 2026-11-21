// The web version's pool through a transaction pooler that hands a backend back as soon as a chunk read from it ends
// with ReadyForQuery 'I' — Supabase's Supavisor v2.9.13, the cause of the 1.1.2 outage (the organisation page hung
// until Vercel cut it at 60 s, the backend «active / ClientRead» in an open transaction) — emulated by
// tests/web-db-pooler.ts in front of a real PostgreSQL:
// (a) postgres.js' default pipelining loses answers through it, the web pool (webPoolOptions: no pipelining) never;
// (b) a statement whose answer is lost anyway is given up at the client deadline and its grace (DB_TIMEOUT), and the
//     next statement runs on a fresh pool — in a transaction too, where the rollback is bounded as well;
// (c) sockets that died while the pool sat idle (a paused serverless instance) are left behind with the old pool;
// (d) transactions (parallel reads inside, the preamble, savepoints) and plain reads of three instances at once: no
//     hang, no wrong answer, nothing released early, dropped or delivered to another client.
// Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin npx vitest run tests/web-db-pooler-pg.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPostgresDb, type PoolEvent, type PostgresOptions } from "@server/db/postgres";
import { webPoolOptions } from "@server/cloud";
import type { Db } from "@server/db";
import { realPg, realPgAvailable, type RealPg } from "./pg-real";
import { backendOf, startPooler, type Pooler } from "./web-db-pooler";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** { value } | { error } | { hang: true } within `ms` (a local statement takes milliseconds). */
function guarded<T>(p: Promise<T>, ms: number): Promise<{ value?: T; error?: unknown; hang?: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
    new Promise<{ hang: true }>((r) => (timer = setTimeout(() => r({ hang: true }), ms))),
  ]).finally(() => clearTimeout(timer));
}

describe.skipIf(!realPgAvailable())("the web pool through a pooler that releases a backend on ReadyForQuery 'I' (Supavisor v2.9.13)", () => {
  let pg: RealPg;
  let admin: Db;
  const poolers: Pooler[] = [];
  const dbs: Db[] = [];
  const through = (p: Pooler) => `postgres://app:ignored@127.0.0.1:${p.port}/${new URL(pg.url).pathname.slice(1)}`;
  const pooler = async (poolSize = 3) => {
    const p = await startPooler({ backend: backendOf(pg.url), poolSize });
    poolers.push(p);
    return p;
  };
  /** The web version's pool (src/server/cloud.ts) in front of `p`, without TLS. */
  const web = (p: Pooler, o: Partial<PostgresOptions> = {}) => {
    const db = createPostgresDb({ ...webPoolOptions(through(p), { DATABASE_SSL: "disable" }), onEvent: undefined, ...o });
    dbs.push(db);
    return db;
  };

  beforeAll(async () => {
    pg = await realPg("w114pooler");
    admin = createPostgresDb({ url: pg.url, ssl: false, max: 2 });
    await admin.exec(`create table w114_tx (id serial primary key, org int not null, run text not null, step text not null);
      create table w114_uk (org int not null, k text not null, primary key (org, k));
      insert into w114_uk select g, 'dup' from generate_series(1, 6) g;`);
  }, 120_000);
  afterAll(async () => {
    await Promise.all(dbs.map((d) => d.close().catch(() => undefined)));
    for (const p of poolers) await p.close().catch(() => undefined);
    await admin?.close();
    await pg?.stop();
  });

  it("(a) 60 statements at once on the web pool all get their own answers; postgres.js' default pipelining loses some", async () => {
    const p = await pooler();
    const sixty = (db: Db) => Array.from({ length: 60 }, (_, i) => db.one<{ v: number }>(`select $1::int as v, pg_sleep(0.01)`, [i]));
    const db = web(p, { queueTimeoutSec: 5, statementClientMs: 4_000, statementGraceMs: 500 });
    const t0 = Date.now();
    const r = await guarded(Promise.all(sixty(db)), 5_000);
    expect(r.hang).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(r.value!.map((x) => x?.v)).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(p.stats).toMatchObject({ releasedOwing: 0, droppedMsgs: 0, misdeliveredMsgs: 0 });

    // 1.1.2's pool: the same adapter, postgres.js' default max_pipeline (100), through the same pooler
    const old = createPostgresDb({ url: through(p), ssl: false, max: 3 });
    dbs.push(old);
    let unanswered = 0;
    for (let round = 0; round < 5 && !unanswered; round++) unanswered = (await Promise.all(sixty(old).map((q) => guarded(q, 3_000)))).filter((x) => x.hang).length;
    expect(unanswered).toBeGreaterThan(0);
    // what lost them: a backend handed back while it still owed the next statement's answer
    expect(p.stats.releasedOwing).toBeGreaterThan(0);
  }, 90_000);

  it("(b) a statement whose answer is lost is given up after the client deadline and its grace; the next one runs on a fresh pool", async () => {
    const p = await pooler();
    const events: PoolEvent[] = [];
    const db = web(p, { statementClientMs: 300, statementGraceMs: 200, onEvent: (e) => events.push(e) });
    expect(await db.one(`select $1::int as v`, [1])).toEqual({ v: 1 });

    p.blackhole(/w114-lost/);
    const t0 = Date.now();
    const r = await guarded(db.one(`select $1::int as v /* w114-lost */`, [2]), 5_000);
    const took = Date.now() - t0;
    expect(r.hang).toBeUndefined();
    expect(r.error).toMatchObject({ code: "DB_TIMEOUT", message: "DB_TIMEOUT: no answer from the database in 500 ms" });
    expect(took).toBeGreaterThanOrEqual(480);
    expect(took).toBeLessThan(1_500);
    expect(events).toEqual([{ kind: "gave_up", ms: 500 }]);
    expect(p.stats.blackholedMsgs).toBeGreaterThan(0);

    const t1 = Date.now();
    expect(await db.one(`select $1::int as v`, [3])).toEqual({ v: 3 });
    expect(Date.now() - t1).toBeLessThan(2_000);
    expect(events.slice(1)).toEqual([expect.objectContaining({ kind: "replaced", reason: "gave_up" })]);

    // inside a transaction: the statement is given up, and so is the rollback whose answer is lost with it
    p.blackhole(/w114-lost-in-tx/);
    const t2 = Date.now();
    const tx = await guarded(
      db.tx(async (t) => {
        await t.query(`select $1::int as v`, [4]);
        await t.query(`select $1::int as v /* w114-lost-in-tx */`, [5]);
      }),
      5_000,
    );
    expect(tx.hang).toBeUndefined();
    expect(tx.error).toMatchObject({ code: "DB_TIMEOUT" });
    expect(Date.now() - t2).toBeLessThan(2_500);
    expect(await db.one(`select $1::int as v`, [6])).toEqual({ v: 6 });
    expect(events.filter((e) => e.kind === "replaced")).toHaveLength(2);
  }, 60_000);

  it("(c) sockets that died while the pool sat idle are left behind: the next statement opens a fresh pool", async () => {
    const p = await pooler();
    const events: PoolEvent[] = [];
    const db = web(p, { replaceIdleAfterMs: 300, statementClientMs: 3_000, statementGraceMs: 500, onEvent: (e) => events.push(e) });
    expect(await db.one(`select $1::int as v`, [1])).toEqual({ v: 1 });
    // what a paused serverless instance's sockets are when it wakes: open, and dead
    p.freezeAll();
    await sleep(450);
    const t0 = Date.now();
    const r = await guarded(db.one(`select $1::int as v`, [2]), 2_000);
    expect(r.hang).toBeUndefined();
    expect(r.value).toEqual({ v: 2 });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(events).toEqual([expect.objectContaining({ kind: "replaced", reason: "idle" })]);
    expect((events[0] as { idleMs: number }).idleMs).toBeGreaterThanOrEqual(440);
  }, 60_000);

  it("(d) transactions and plain reads of three instances at once: no hang, no wrong answer, nothing lost or misdelivered", async () => {
    const p = await pooler();
    const instances = [0, 1, 2].map(() => web(p, { queueTimeoutSec: 5 }));
    const problems: string[] = [];
    for (let round = 0; round < 10; round++) {
      await Promise.all(
        instances.map((db, n) =>
          Promise.all(
            [0, 1].map(async (c) => {
              const org = ((round + n * 2 + c) % 6) + 1;
              if (c === 0 && round % 2 === 0) {
                const run = `r${round}i${n}`;
                const r = await guarded(
                  db.tx(async (t) => {
                    await t.query(`insert into w114_tx (org, run, step) values ($1, $2, 'first')`, [org, run]);
                    const reads = await Promise.all([1, 2, 3, 4].map((k) => t.one<{ v: number }>(`select $1::int * 10 + $2::int as v`, [org, k])));
                    if (reads.some((x, k) => x?.v !== org * 10 + k + 1)) problems.push(`${run}: reads in the transaction ${JSON.stringify(reads)}`);
                    const lock = await t.one<{ l: string }>(`select current_setting('lock_timeout') as l`);
                    if (lock?.l !== "10s") problems.push(`${run}: lock_timeout ${lock?.l}`);
                    await t.exec("savepoint a");
                    await t.query(`insert into w114_uk (org, k) values ($1, 'dup')`, [org]).then(
                      () => problems.push(`${run}: a duplicate was inserted`),
                      (e: { code?: string }) => e.code === "23505" || problems.push(`${run}: expected 23505, got ${e.code}`),
                    );
                    await t.exec("rollback to savepoint a");
                    await t.query(`insert into w114_tx (org, run, step) values ($1, $2, 'after')`, [org, run]);
                    await t.exec("release savepoint a");
                  }),
                  5_000,
                );
                if (r.hang) problems.push(`${run}: the transaction hung`);
                else if (r.error) problems.push(`${run}: the transaction failed: ${String(r.error)}`);
                const steps = (await db.query<{ step: string }>(`select step from w114_tx where run = $1 order by id`, [run])).map((x) => x.step).join(",");
                if (steps !== "first,after") problems.push(`${run}: committed ${steps}`);
                return;
              }
              const tag = `${n}.${c}.${round}`;
              const r = await guarded(Promise.all(Array.from({ length: 7 }, (_, k) => db.one<{ v: string }>(`select $1::text || ':' || $2::text as v`, [tag, k]))), 3_000);
              if (r.hang) problems.push(`${tag}: reads hung`);
              else if (r.error) problems.push(`${tag}: reads failed: ${String(r.error)}`);
              else r.value!.forEach((x, k) => x?.v !== `${tag}:${k}` && problems.push(`${tag}: read ${k} got ${x?.v}`));
            }),
          ),
        ),
      );
    }
    expect(problems).toEqual([]);
    expect(p.stats).toMatchObject({ releasedOwing: 0, droppedMsgs: 0, misdeliveredMsgs: 0 });
    expect(p.stats.checkouts).toBeGreaterThan(30);
  }, 120_000);
});

// Helpers of the real-PostgreSQL race suites (tests/races-pg.test.ts, tests/races-desk-pg.test.ts): every world of a
// suite gets its own database on one throwaway PostgreSQL (tests/pg-real.ts), a transaction can be held open while
// racers queue behind its locks, and writes can be made to meet after they decided and before they commit.
import { afterAll, afterEach, beforeAll } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import type { Db, Tx } from "@server/db";
import { Client, useServerDb } from "./helpers";
import { extraDatabase, realPg, type RealPg } from "./pg-real";

/** Gates holding transactions open; a failed test releases its own (afterEach) so none outlives it. */
const open: (() => void)[] = [];
export const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  open.push(resolve);
  return { promise, resolve };
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The longest a racer is given to reach (and wait at) its lock before the holder lets go. */
export const SETTLE = 4000;

/**
 * The databases of a race suite (call it inside the suite's describe): one PostgreSQL for the suite, a database per world
 * (`makeServer` through `useServerDb`), every gate released after each test, everything closed and removed at the end.
 */
export function raceDatabases(name: string): void {
  let pg: RealPg | null = null;
  let seq = 0;
  const pools: Db[] = [];
  beforeAll(async () => {
    pg = await realPg(name);
    useServerDb(async () => {
      const url = await extraDatabase(pg!, `${name}_${process.pid}_${++seq}`);
      const db = createPostgresDb({ url, ssl: false, max: 8 });
      pools.push(db);
      return db;
    });
  }, 120_000);
  afterEach(() => {
    for (const release of open.splice(0)) release();
  });
  afterAll(async () => {
    useServerDb(null);
    // the worlds' pools at once (each gives its connections a few seconds), then the server
    await Promise.all(pools.splice(0).map((db) => Promise.race([db.close().catch(() => undefined), sleep(15_000)])));
    await pg?.stop();
  }, 120_000);
}

/**
 * Hold a transaction open: `work` runs, then the transaction waits (holding every lock it took) until `release()`.
 * `ready` resolves once `work` is done. Its before-commit work runs after the release, as a commit's does.
 */
export function hold(db: Db, work: (tx: Tx) => Promise<unknown>) {
  const inside = deferred();
  const gate = deferred();
  const done = db.tx(async (tx) => {
    await work(tx);
    inside.resolve();
    await gate.promise;
  });
  done.catch(() => inside.resolve());
  return { db, ready: inside.promise, release: () => gate.resolve(), done };
}

/**
 * Wait until `n` sessions of this database wait for a lock (row, transaction or advisory), `settled` resolved, or `ms`
 * passed — so a holder lets go only once the racers are queued behind it (a racer that never waits, the code before a
 * fix, finishes or reaches its write meanwhile).
 */
export async function queued(db: Db, n: number, settled: Promise<unknown>, ms = SETTLE): Promise<void> {
  let done = false;
  settled.then(() => (done = true), () => (done = true));
  const until = Date.now() + ms;
  while (!done && Date.now() < until) {
    const w = await db.one<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
    if ((w?.n ?? 0) >= n) return;
    await sleep(25);
  }
}

/** Run `race` while `holder` holds its locks; release once `waiters` racers are queued behind it (or have finished). */
export async function whileHeld<T>(holder: ReturnType<typeof hold>, race: () => Promise<T>, waiters = 1): Promise<PromiseSettledResult<Awaited<T>>> {
  await holder.ready;
  const racing = race();
  racing.catch(() => undefined);
  await queued(holder.db, waiters, racing);
  holder.release();
  await holder.done;
  const [out] = await Promise.allSettled([racing]);
  return out as PromiseSettledResult<Awaited<T>>;
}

/**
 * A meeting point inside writes (a test's own hook): every caller waits until `n` have arrived — all of them decided
 * their write from what they read and have not committed — then all go on (at the latest after `ms`).
 */
export function meeting(n: number, ms = SETTLE) {
  let arrived = 0;
  const all = deferred();
  return async () => {
    if (++arrived >= n) all.resolve();
    await Promise.race([all.promise, sleep(ms)]);
  };
}

/** An HTTP call whose outcome is part of the test: { status, data } instead of throwing. */
export async function call(c: Client, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  try {
    return { status: 200, data: await c.req(method, path, body, 200) };
  } catch (e) {
    const m = /→ (\d+): ([\s\S]*)$/.exec(String((e as Error).message));
    return { status: m ? Number(m[1]) : 0, data: m ? safeJson(m[2]) : String(e) };
  }
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
export const message = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason) : "");

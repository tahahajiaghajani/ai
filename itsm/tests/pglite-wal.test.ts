// The Windows app's write-ahead log stays bounded (src/server/db/wal.ts, docs/PERFORMANCE_FA.md §14): PGlite has no
// checkpointer, so without checkpoints of our own pg_wal grows until close. The scheduler (fake clock), the limits on a
// data folder of an older version, no checkpoint inside a transaction, a backup restored after the change.
import { describe, expect, it, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteDb } from "@server/db/pglite";
import { createWalGuard, walSegments, WAL_LIMITS_MB, type WalClock, type WalPg } from "@server/db/wal";
import { backupNow } from "@local/backup";

const MB = 1024 * 1024;
const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "kariz-wal-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const segments = (dir: string) => walSegments(join(dir, "pg_wal"), (p) => readdirSync(p));
/** About 40 MB of log: 40 000 rows of 900 bytes written and deleted. */
const churn = `insert into t select g, repeat('x', 900) from generate_series(1, 40000) g; delete from t;`;

// ------------------------------------------------------------------------------------------------- the scheduler

/** A clock whose timers run when the test moves it. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const clock: WalClock & { advance(ms: number): Promise<void> } = {
    now: () => now,
    setTimeout(fn, ms) {
      const t = { at: now + ms, fn, id: ++ids };
      timers.push(t);
      return t.id;
    },
    clearTimeout(id) {
      timers = timers.filter((t) => t.id !== id);
    },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((t) => t !== next);
        now = next.at;
        next.fn();
        // let the step's awaits settle
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      now = until;
    },
  };
  return clock;
}

/** A database whose log grows when the test says so; CHECKPOINT resets it. */
function fakePg() {
  const pg = {
    since: 0,
    checkpoints: 0,
    polls: 0,
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (/pg_wal_lsn_diff/.test(sql)) {
        pg.polls++;
        return { rows: [{ d: pg.since } as T] };
      }
      return { rows: [] };
    },
    async exec(sql: string) {
      if (/^CHECKPOINT$/i.test(sql.trim())) {
        pg.checkpoints++;
        pg.since = 200; // the checkpoint record itself
      }
    },
  };
  return pg as typeof pg & WalPg;
}

describe("the checkpoint scheduler", () => {
  const opts = { volumeBytes: 32 * MB, hardBytes: 128 * MB, maxAgeMs: 300_000, dirtyBytes: 64 * 1024, idleMs: 1000, pollMs: 10_000, idleCheckMs: 250 };

  it("checkpoints after a volume of log, once the database is idle", async () => {
    const clock = fakeClock();
    const pg = fakePg();
    const g = createWalGuard(pg, { clock, ...opts });
    g.start();
    pg.since = 10 * MB;
    await clock.advance(30_000);
    expect(pg.checkpoints).toBe(0);
    pg.since = 40 * MB;
    // the app is busy (a request in flight): the checkpoint waits
    let release!: () => void;
    const busy = g.track(() => new Promise<void>((r) => (release = r)));
    await clock.advance(20_000);
    expect(pg.checkpoints).toBe(0);
    release();
    await busy;
    await clock.advance(500);
    expect(pg.checkpoints).toBe(0); // idle for less than idleMs
    await clock.advance(1_000);
    expect(pg.checkpoints).toBe(1);
    expect(g.stats().last?.reason).toBe("volume");
    // nothing more to do
    await clock.advance(60_000);
    expect(pg.checkpoints).toBe(1);
    g.stop();
  });

  it("past the hard limit it checkpoints even while the app is busy", async () => {
    const clock = fakeClock();
    const pg = fakePg();
    const g = createWalGuard(pg, { clock, ...opts });
    g.start();
    let release!: () => void;
    const busy = g.track(() => new Promise<void>((r) => (release = r)));
    pg.since = 40 * MB;
    await clock.advance(15_000);
    expect(pg.checkpoints).toBe(0);
    pg.since = 130 * MB;
    await clock.advance(10_000);
    expect(pg.checkpoints).toBe(1);
    release();
    await busy;
    g.stop();
  });

  it("checkpoints a few writes after maxAgeMs, and never a database with no writes", async () => {
    const clock = fakeClock();
    const pg = fakePg();
    const g = createWalGuard(pg, { clock, ...opts });
    g.start();
    pg.since = 200; // only the last checkpoint's record
    await clock.advance(20 * 60_000);
    expect(pg.checkpoints).toBe(0);
    pg.since = 2 * MB;
    await clock.advance(4 * 60_000);
    expect(pg.checkpoints).toBe(0);
    await clock.advance(2 * 60_000);
    expect(pg.checkpoints).toBe(1);
    expect(g.stats().last?.reason).toBe("age");
    g.stop();
  });

  it("stop() ends the polling, and concurrent checkpoints share one", async () => {
    const clock = fakeClock();
    const pg = fakePg();
    const g = createWalGuard(pg, { clock, ...opts });
    g.start();
    await clock.advance(30_000);
    const polls = pg.polls;
    expect(polls).toBeGreaterThan(0);
    g.stop();
    await clock.advance(120_000);
    expect(pg.polls).toBe(polls);
    const [a, b] = await Promise.all([g.checkpoint("backup"), g.checkpoint("close")]);
    expect(a).toBe(b);
    expect(pg.checkpoints).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------- a real data folder

describe("a PGlite data folder", () => {
  it("keeps pg_wal bounded after many megabytes of writes, where an unguarded folder keeps all of it", async () => {
    const plain = temp();
    const pg = new PGlite(plain);
    await pg.waitReady;
    await pg.exec(`create table t (id int, pad text)`);
    for (let i = 0; i < 4; i++) await pg.exec(churn);
    const unguarded = segments(plain).length;
    await pg.close();
    expect(unguarded).toBeGreaterThanOrEqual(8);

    const dir = temp();
    const db = await createPgliteDb({ dataDir: dir, vector: false, wal: { volumeBytes: 16 * MB, idleMs: 0, pollMs: 20, idleCheckMs: 10 } });
    await db.exec(`create table t (id int, pad text)`);
    let peak = 0;
    for (let i = 0; i < 4; i++) {
      await db.exec(churn);
      // a pause in the work: the scheduler checkpoints
      await new Promise((r) => setTimeout(r, 150));
      peak = Math.max(peak, segments(dir).length);
    }
    expect(db.wal?.stats().checkpoints).toBeGreaterThan(0);
    // a checkpoint keeps max_wal_size for reuse, plus what was written since
    expect(segments(dir).length).toBeLessThanOrEqual(WAL_LIMITS_MB.max_wal_size / 16 + 4);
    expect(peak).toBeLessThan(unguarded);
    await db.close();
  });

  it("applies and persists the limits on a folder of an older version, and walks through its spare segments", async () => {
    const dir = temp();
    // an older version: PostgreSQL's defaults (max_wal_size 1GB), a clean close that recycled segments ahead of the log
    let pg = new PGlite(dir);
    await pg.waitReady;
    await pg.exec(`create table t (id int, pad text)`);
    for (let i = 0; i < 4; i++) await pg.exec(churn);
    await pg.exec("checkpoint");
    await pg.close();
    const before = segments(dir).length;
    expect(before).toBeGreaterThanOrEqual(8);
    expect(existsSync(join(dir, "postgresql.auto.conf")) ? readFileSync(join(dir, "postgresql.auto.conf"), "utf8") : "").not.toMatch(/max_wal_size/);

    const db = await createPgliteDb({ dataDir: dir, vector: false });
    const s = await db.one<{ max: string; min: string }>(`select current_setting('max_wal_size') as max, current_setting('min_wal_size') as min`);
    expect(s).toEqual({ max: `${WAL_LIMITS_MB.max_wal_size}MB`, min: `${WAL_LIMITS_MB.min_wal_size}MB` });
    expect(segments(dir).length).toBeLessThanOrEqual(WAL_LIMITS_MB.max_wal_size / 16 + 1);
    expect(readFileSync(join(dir, "postgresql.auto.conf"), "utf8")).toMatch(/max_wal_size = '64MB'[\s\S]*min_wal_size = '32MB'|min_wal_size = '32MB'[\s\S]*max_wal_size = '64MB'/);
    expect(await db.one<{ n: number }>(`select count(*)::int as n from t`)).toEqual({ n: 0 });
    await db.close();

    // persisted in the folder: PGlite without our start parameters reads them from postgresql.auto.conf
    pg = new PGlite(dir);
    await pg.waitReady;
    expect((await pg.query<{ s: string }>(`select current_setting('max_wal_size') as s`)).rows[0].s).toBe(`${WAL_LIMITS_MB.max_wal_size}MB`);
    await pg.close();
  });

  it("never checkpoints inside a transaction: a checkpoint asked for during one runs after its commit", async () => {
    const dir = temp();
    const db = await createPgliteDb({ dataDir: dir, vector: false, wal: false });
    await db.exec(`create table k (id int primary key, v text)`);
    let inside = "";
    let checkpointed: Promise<unknown> | null = null;
    await db.tx(async (tx) => {
      await tx.query(`insert into k values (1, 'a')`);
      checkpointed = db.checkpoint("test");
      // give the checkpoint every chance to run now
      await new Promise((r) => setTimeout(r, 100));
      await tx.query(`insert into k values (2, 'b')`);
      inside = (await tx.one<{ l: string }>(`select pg_current_wal_insert_lsn()::text as l`))!.l;
    });
    await checkpointed;
    // its redo point lies after everything the transaction wrote, its commit included
    const after = (await db.one<{ ok: boolean }>(`select (pg_control_checkpoint()).redo_lsn > $1::pg_lsn as ok`, [inside]))!;
    expect(after.ok).toBe(true);
    await db.close();
  });

  it("a backup taken after a checkpoint restores into a working database", async () => {
    const dir = temp();
    // the scheduler stays out of the way of the count below
    const db = await createPgliteDb({ dataDir: join(dir, "db"), vector: false, wal: { pollMs: 3_600_000 } });
    await db.exec(`create table t (id int, pad text); create table keep (id int primary key, v text)`);
    for (let i = 0; i < 2; i++) await db.exec(churn);
    await db.query(`insert into keep values (1, 'پیش از پشتیبان')`);
    const before = db.wal!.stats().checkpoints;
    const b = await backupNow(db, dir, "test");
    expect(db.wal!.stats().checkpoints).toBe(before + 1);
    expect(db.wal!.stats().last?.reason).toBe("backup");
    expect(readFileSync(b.file).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    await db.query(`insert into keep values (2, 'پس از پشتیبان')`);
    await db.close();

    const restored = await createPgliteDb({ dataDir: join(dir, "restored"), vector: false, loadDataDir: new Blob([new Uint8Array(readFileSync(b.file))]) });
    expect(await restored.query(`select id, v from keep order by id`)).toEqual([{ id: 1, v: "پیش از پشتیبان" }]);
    await restored.exec(`insert into keep values (3, 'پس از بازگردانی')`);
    expect((await restored.one<{ n: number }>(`select count(*)::int as n from keep`))!.n).toBe(2);
    await restored.close();
  });
});

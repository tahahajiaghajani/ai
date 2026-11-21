// The Windows app's idle upkeep (src/desktop/upkeep.ts): PGlite has no autovacuum, so the app vacuums and analyses its
// tables itself — only while nobody uses it, one statement at a time with a pause between them, never past its budget
// (those tables wait for the next start), and the template databases are frozen at a start once they grow old.
import { describe, it, expect, afterAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { createUpkeep, upkeepPlan, estimateBytes, UPKEEP_DEFAULTS, type UpkeepRow } from "@local/upkeep";
import { createHeavyLock } from "@local/heavy";
import { readMaintState, writeMaintState, startupMaintenance } from "@local/maintenance";
import { capture, cleanFolders, folder, openDb } from "./desktop-maint-helpers";

afterAll(cleanFolders);

const MIN = 60_000;

/** The database with its statements counted. */
function watched<T extends { exec: (sql: string) => Promise<void> }>(db: T) {
  const statements: string[] = [];
  const exec = db.exec;
  return Object.assign(Object.create(null), db, {
    statements,
    exec: (sql: string) => {
      statements.push(sql);
      return exec(sql);
    },
  }) as T & { statements: string[] };
}

const vacuums = (s: string[]) => s.filter((x) => /^(vacuum \((?!only_database_stats)|analyze )/.test(x));

async function deadTuples(db: { query: (s: string) => Promise<unknown>; one: <T>(s: string) => Promise<T | null> }, table: string): Promise<number> {
  await db.query(`select pg_stat_force_next_flush()`);
  await db.query(`select 1`);
  return Number((await db.one<{ n: number }>(`select coalesce(n_dead_tup, 0)::int as n from pg_stat_user_tables where relname = '${table}'`))?.n ?? 0);
}

describe("the idle upkeep", () => {
  it("does nothing while a person's request is in flight or within five minutes of one", async () => {
    const f = folder();
    const db = watched(await openDb(f));
    try {
      let quiet = 0;
      const up = createUpkeep({ db, log: capture(), quietMs: () => quiet, lock: createHeavyLock(), dataDir: f.dataDir, sleep: async () => {} });
      expect((await up.pass()).skipped).toBe("a person is using the app");
      quiet = 4 * MIN;
      expect((await up.pass()).skipped).toBe("a person is using the app");
      expect(vacuums(db.statements)).toEqual([]);
      await up.stop();
    } finally {
      await db.close();
    }
  });

  it("then vacuums what has dead rows, one statement per step with a pause after each", async () => {
    const f = folder();
    const db = watched(await openDb(f));
    try {
      await db.exec(`create table up_dead (id int primary key, v text); insert into up_dead select g, repeat('d', 100) from generate_series(1, 2000) g; delete from up_dead where id > 500`);
      expect(await deadTuples(db, "up_dead")).toBe(1500);
      // the daily sweep was done just now: only what the counters show
      await writeMaintState(db, { lsn: "0/0", looked_at: new Date().toISOString(), sweep: { cursor: null, done_at: new Date().toISOString() } });
      let pauses = 0;
      const log = capture();
      const up = createUpkeep({ db, log, quietMs: () => 6 * MIN, lock: createHeavyLock(), dataDir: f.dataDir, sleep: async () => void pauses++ });
      db.statements.length = 0;
      const r = await up.pass();
      expect(r.skipped).toBeUndefined();
      expect(r.vacuumed).toBeGreaterThanOrEqual(1);
      const ran = vacuums(db.statements);
      expect(ran.some((s) => /^vacuum \(analyze, skip_database_stats\) "public"\."up_dead"$/.test(s))).toBe(true);
      expect(pauses).toBe(ran.length);
      expect(await deadTuples(db, "up_dead")).toBe(0);
      // the database's oldest transaction id moves on, once per pass
      expect(db.statements.filter((s) => s === "vacuum (only_database_stats)")).toHaveLength(1);
      expect(log.lines.some((l) => /^database upkeep: \d+ tables vacuumed, \d+ analyzed, 0 frozen in \d+\.\d s/.test(l))).toBe(true);
      expect((await readMaintState(db))?.upkeep_at).toBeTruthy();
      await up.stop();
    } finally {
      await db.close();
    }
  });

  it("stops when a person comes back, and the daily sweep resumes where it stopped", async () => {
    const f = folder();
    const db = watched(await openDb(f));
    try {
      let quiet = 6 * MIN;
      let looks = 0;
      const up = createUpkeep({
        db,
        log: capture(),
        quietMs: () => {
          looks++;
          // the pass's first look and three statements, then a person is back
          return looks <= 4 ? quiet : 0;
        },
        lock: createHeavyLock(),
        dataDir: f.dataDir,
        sleep: async () => {},
      });
      db.statements.length = 0;
      const first = await up.pass();
      expect(first.stopped).toBe("a person is using the app");
      const firstRan = vacuums(db.statements);
      expect(firstRan.length).toBe(3);
      const state = await readMaintState(db);
      expect(state?.sweep?.cursor).toBeGreaterThan(0);
      expect(state?.sweep?.done_at ?? null).toBeNull();
      // the next pass goes on from the cursor: none of the first pass's tables again
      looks = -10_000;
      db.statements.length = 0;
      const second = await up.pass();
      expect(second.stopped).toBeUndefined();
      const secondRan = vacuums(db.statements);
      expect(secondRan.length).toBeGreaterThan(10);
      for (const s of firstRan) expect(secondRan).not.toContain(s);
      const done = await readMaintState(db);
      expect(done?.sweep?.cursor ?? null).toBeNull();
      expect(done?.sweep?.done_at).toBeTruthy();
      quiet = 0;
      await up.stop();
    } finally {
      await db.close();
    }
  });

  it("leaves a table whose statement would exceed the budget for the next start (state.deferred)", async () => {
    const f = folder();
    const db = watched(await openDb(f));
    try {
      await db.exec(`create table up_big (id int primary key, v text); insert into up_big select g, repeat('b', 300) from generate_series(1, 20000) g; delete from up_big where id % 2 = 0`);
      await writeMaintState(db, { lsn: "0/0", looked_at: new Date().toISOString(), sweep: { cursor: null, done_at: new Date().toISOString() } });
      const log = capture();
      // a computer that reads 0.1 MB/s: 100 KB in the 1 s budget
      const up = createUpkeep({ db, log, quietMs: () => 6 * MIN, lock: createHeavyLock(), dataDir: f.dataDir, sleep: async () => {}, options: { startMbPerS: 0.1 } });
      db.statements.length = 0;
      const r = await up.pass();
      expect(r.deferred).toContain("public.up_big");
      expect(vacuums(db.statements).some((s) => s.includes(`"up_big"`))).toBe(false);
      expect((await readMaintState(db))?.deferred).toContain("public.up_big");
      expect(log.lines.some((l) => /left for the next start$/.test(l))).toBe(true);
      // after half an hour of quiet the budget is four times larger, still too small; the next start's phase does it
      const started = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: { gateBytes: 1024 * 1024 * 1024 } });
      expect(started.report.vacuumed).toContain("public.up_big");
      expect(log.lines.some((l) => /^maintenance step vacuum:up_big applied \(deferred, \d+(\.\d)? MB scanned, \d+\.\d s\)$/.test(l))).toBe(true);
      expect((await readMaintState(db))?.deferred).toEqual([]);
      await up.stop();
    } finally {
      await db.close();
    }
  });

  it("writes and says nothing at the passes after it left a table for the next start, until something changes", async () => {
    const f = folder();
    const db = watched(await openDb(f));
    try {
      await db.exec(`create table up_stay (id int primary key, v text); insert into up_stay select g, repeat('s', 300) from generate_series(1, 20000) g; delete from up_stay where id % 2 = 0`);
      await writeMaintState(db, { lsn: "0/0", looked_at: new Date().toISOString(), sweep: { cursor: null, done_at: new Date().toISOString() } });
      const log = capture();
      const up = createUpkeep({ db, log, quietMs: () => 6 * MIN, lock: createHeavyLock(), dataDir: f.dataDir, sleep: async () => {}, options: { startMbPerS: 0.1 } });
      const wal = async () => String((await db.one<{ l: string }>(`select pg_current_wal_insert_lsn()::text as l`))!.l);
      const stamp = async () => String((await db.one<{ at: string }>(`select updated_at::text as at from sm_kv where key = 'maint.state'`))!.at);
      const told = () => log.lines.filter((l) => l.startsWith("database upkeep: "));
      expect((await up.pass()).deferred).toEqual(["public.up_stay"]);
      expect(told()).toHaveLength(1);
      const at = await stamp();
      const lsn = await wal();
      // a minute later, and the minute after: the same table over the same budget (this session's counters keep it planned)
      for (let i = 0; i < 2; i++) {
        const r = await up.pass();
        expect(r.deferred).toEqual(["public.up_stay"]);
        expect(r.vacuumed).toBe(0);
      }
      expect(await stamp()).toBe(at);
      expect(await wal()).toBe(lsn);
      expect(told()).toHaveLength(1);
      expect((await readMaintState(db))?.deferred).toEqual(["public.up_stay"]);
      // something new to leave is written and told again
      await db.exec(`create table up_more (id int primary key, v text); insert into up_more select g, repeat('m', 300) from generate_series(1, 20000) g; delete from up_more where id % 2 = 0`);
      expect((await up.pass()).deferred.sort()).toEqual(["public.up_more", "public.up_stay"]);
      expect((await readMaintState(db))?.deferred?.sort()).toEqual(["public.up_more", "public.up_stay"]);
      expect(told()).toHaveLength(2);
      await up.stop();
    } finally {
      await db.close();
    }
  });

  it("waits while a backup holds the heavy lock", async () => {
    const f = folder();
    const db = watched(await openDb(f));
    try {
      const lock = createHeavyLock();
      let release!: () => void;
      const backup = lock.run("backup", () => new Promise<void>((r) => (release = r)));
      const up = createUpkeep({ db, log: capture(), quietMs: () => 6 * MIN, lock, dataDir: f.dataDir, sleep: async () => {} });
      db.statements.length = 0;
      expect((await up.pass()).skipped).toBe("a backup holds the database");
      expect(vacuums(db.statements)).toEqual([]);
      release();
      await backup;
      await up.stop();
    } finally {
      await db.close();
    }
  });

  it("is nothing for a memory database", async () => {
    const db = await createPgliteDb({ vector: false });
    try {
      const up = createUpkeep({ db, log: capture(), quietMs: () => 60 * MIN, lock: createHeavyLock() });
      expect((await up.pass()).skipped).toBe("not a data folder");
    } finally {
      await db.close();
    }
  });
});

describe("the upkeep's plan", () => {
  const row = (oid: number, p: Partial<UpkeepRow> = {}): UpkeepRow => ({
    oid,
    schema: "public",
    name: `t${oid}`,
    relpages: 100,
    reltuples: 10_000,
    relallvisible: 100,
    xid_age: 1000,
    mxid_age: 0,
    n_dead_tup: 0,
    n_ins_since_vacuum: 0,
    n_mod_since_analyze: 0,
    ...p,
  });

  it("orders freeze, dead rows, inserted rows, analyze, then the sweep", () => {
    const rows = [row(1), row(2, { n_mod_since_analyze: 5000 }), row(3, { n_ins_since_vacuum: 5000 }), row(4, { n_dead_tup: 5000 }), row(5, { xid_age: 2e8 })];
    const plan = upkeepPlan(rows, { due: true, cursor: null }, UPKEEP_DEFAULTS);
    expect(plan.map((p) => [p.oid, p.kind])).toEqual([
      [5, "freeze"],
      [4, "vacuum"],
      [3, "vacuum"],
      [2, "analyze"],
      [1, "sweep"],
    ]);
    expect(plan[0].sql).toBe(`vacuum (freeze, skip_database_stats) "public"."t5"`);
    expect(plan[3].sql).toBe(`analyze "public"."t2"`);
    // autovacuum's thresholds: 50 + 10 % dead, 1000 + 20 % inserted, 50 + 10 % changed
    expect(upkeepPlan([row(6, { n_dead_tup: 1000 })], { due: false, cursor: null }, UPKEEP_DEFAULTS)).toEqual([]);
    expect(upkeepPlan([row(7, { n_dead_tup: 1051 })], { due: false, cursor: null }, UPKEEP_DEFAULTS).map((p) => p.kind)).toEqual(["vacuum"]);
    // a table never analysed is analysed with its vacuum
    expect(upkeepPlan([row(8, { reltuples: -1, n_dead_tup: 100 })], { due: false, cursor: null }, UPKEEP_DEFAULTS)[0].sql).toBe(`vacuum (analyze, skip_database_stats) "public"."t8"`);
  });

  it("goes on with the sweep after its cursor, and estimates what a statement reads", () => {
    const rows = [row(10), row(20), row(30), row(40)];
    expect(upkeepPlan(rows, { due: true, cursor: 20 }, UPKEEP_DEFAULTS).map((p) => p.oid)).toEqual([30, 40]);
    expect(upkeepPlan(rows, { due: false, cursor: null }, UPKEEP_DEFAULTS)).toEqual([]);
    // pages not all-visible, growth since the last vacuum, indexes when there are dead rows
    expect(estimateBytes({ relpages: 100, relallvisible: 60, n_dead_tup: 0 }, "vacuum", { heap: 120 * 8192, index: 50 * 8192 })).toBe(60 * 8192);
    expect(estimateBytes({ relpages: 100, relallvisible: 60, n_dead_tup: 5 }, "vacuum", { heap: 100 * 8192, index: 50 * 8192 })).toBe(90 * 8192);
    expect(estimateBytes({ relpages: 100_000, relallvisible: 0, n_dead_tup: 0 }, "analyze", { heap: 100_000 * 8192, index: 0 })).toBe(30_000 * 8192);
  });
});

describe("the template databases", () => {
  it("are frozen at a start once they are old (a low threshold here), and the app's database opens again", async () => {
    const f = folder();
    const db = await openDb(f);
    await db.exec(`create table t_keep (id int primary key); insert into t_keep select generate_series(1, 100)`);
    for (let i = 0; i < 30; i++) await db.exec(`insert into t_keep values (${1000 + i})`);
    const ages = async (d: typeof db) => Object.fromEntries((await d.query<{ datname: string; age: number }>(`select datname, age(datfrozenxid)::int as age from pg_database`)).map((r) => [r.datname, Number(r.age)]));
    const before = await ages(db);
    expect(before.template1).toBeGreaterThan(20);
    const log = capture();
    let told = 0;
    const r = await startupMaintenance(db, {
      dataDir: f.dataDir,
      dbDir: f.dbDir,
      log,
      notify: () => told++,
      options: { templateFreezeAge: 20 },
      reopen: () => createPgliteDb({ dataDir: f.dbDir, vector: false, wal: { pollMs: 3_600_000 } }),
    });
    const next = r.db;
    try {
      expect(r.report.froze).toBe(true);
      expect(told).toBe(1);
      expect(next).not.toBe(db);
      const after = await ages(next);
      expect(after.template1).toBeLessThan(5);
      expect(after.template0).toBeLessThan(5);
      expect(log.lines.some((l) => /^maintenance step freeze:template0 applied \(age \d+ → \d+, \d+ ms\)$/.test(l))).toBe(true);
      expect((await next.one<{ n: number }>(`select count(*)::int as n from t_keep`))!.n).toBe(130);
    } finally {
      await next.close();
    }
  });
});

// The Windows app's start-up maintenance costs a healthy database about a millisecond (src/desktop/maintenance.ts): one
// query and two file checks decide whether to look at the tables at all — dead space can only come from writes, and
// PGlite's statistics cannot tell it (they are zero after every open, the design's premise, checked here too).
import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPgliteDb } from "@server/db/pglite";
import { startupMaintenance, readMaintState, lookNeeded } from "@local/maintenance";
import { capture, cleanFolders, folder, openDb, MB } from "./desktop-maint-helpers";

afterAll(cleanFolders);

/** The database with every statement counted (`queries`). */
function counted<T extends { query: (...a: any[]) => any; one: (...a: any[]) => any; exec: (...a: any[]) => any }>(db: T): T & { queries: string[] } {
  const queries: string[] = [];
  const wrap =
    (f: (...a: any[]) => any) =>
    (...a: any[]) => {
      queries.push(String(a[0]));
      return f(...a);
    };
  return Object.assign(Object.create(null), db, { query: wrap(db.query), one: wrap(db.one), exec: wrap(db.exec), queries });
}

describe("the maintenance's gate", () => {
  it("skips a database that wrote less than the gate's log in one query and records where it looked", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      const log = capture();
      const c = counted(db);
      const t0 = performance.now();
      const r = await startupMaintenance(c, { dataDir: f.dataDir, dbDir: f.dbDir, log });
      const ms = performance.now() - t0;
      expect(r.report.skipped).toBe("a new database");
      expect(r.report.gate?.look).toBe(false);
      expect(ms).toBeLessThan(50);
      // the gate's query, the state written once for this new database, and sm_jobs analysed once (never analysed before)
      expect(c.queries.filter((q) => /pg_current_wal_insert_lsn/.test(q))).toHaveLength(1);
      expect(log.lines.find((l) => l.startsWith("database maintenance: nothing to do"))).toMatch(/^database maintenance: nothing to do \(\d+ ms; \d+ MB of log since the last look\)$/);
      const state = await readMaintState(db);
      expect(state?.v).toBe(1);
      expect(state?.lsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
      expect(state?.looked_at).toBeTruthy();
      // the second start: the gate's query alone, nothing written
      const c2 = counted(db);
      const log2 = capture();
      const r2 = await startupMaintenance(c2, { dataDir: f.dataDir, dbDir: f.dbDir, log: log2 });
      expect(r2.report.skipped).toBe("nothing to do");
      expect(c2.queries).toHaveLength(1);
      expect(r2.report.gate!.ms).toBeLessThan(50);
    } finally {
      await db.close();
    }
  });

  it("analyses a never-analysed sm_jobs once (the job runner's cleanup plans without statistics until then)", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await db.exec(`insert into sm_jobs (id, kind, status, done_at) select gen_random_uuid(), 'x', 'done', now() - interval '5 days' from generate_series(1, 2000)`);
      expect(Number((await db.one<{ t: number }>(`select reltuples::float8 as t from pg_class where relname = 'sm_jobs'`))!.t)).toBe(-1);
      const log = capture();
      const r = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log });
      expect(r.report.analyzed).toBe(true);
      expect(log.lines.some((l) => /^maintenance step analyze:sm_jobs applied \(\d+ ms; never analysed before\)$/.test(l))).toBe(true);
      expect(Number((await db.one<{ t: number }>(`select reltuples::float8 as t from pg_class where relname = 'sm_jobs'`))!.t)).toBe(2000);
      const again = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture() });
      expect(again.report.analyzed).toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it("stays shut after less than the gate's log, and opens once that much was written since the last look", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture() });
      // about 10 MB of log: far from 512 MB
      await db.exec(`create table churn (id int, pad text); insert into churn select g, repeat('c', 900) from generate_series(1, 10000) g; delete from churn`);
      const shut = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture() });
      expect(shut.report.skipped).toBe("nothing to do");
      expect(shut.report.gate!.sinceBytes).toBeGreaterThan(5 * MB);
      expect(shut.report.gate!.sinceBytes).toBeLessThan(512 * MB);
      // the same log against a gate of 1 MB: the tables are looked at
      const open = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture(), options: { gateBytes: 1 * MB } });
      expect(open.report.gate!.look).toBe(true);
      expect(open.report.looked).toBeGreaterThanOrEqual(3);
      // and the look moved the mark: shut again
      const after = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture(), options: { gateBytes: 1 * MB } });
      expect(after.report.skipped).toBe("nothing to do");
    } finally {
      await db.close();
    }
  });

  it("opens for a compaction asked for in Settings, for one cut short, and is switched off by maintenance.off", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture() });
      writeFileSync(join(f.dataDir, "compact.pending"), "x");
      expect((await lookNeeded(db, { dataDir: f.dataDir })).why).toBe("a compaction was asked for in Settings");
      const asked = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture() });
      expect(asked.report.gate!.look).toBe(true);
      // the request is done with (even when nothing needed compacting)
      expect((await lookNeeded(db, { dataDir: f.dataDir })).look).toBe(false);
      writeFileSync(join(f.dataDir, "maintenance.running"), JSON.stringify({ step: "compact", table: "x", started_at: Date.now() }));
      expect((await lookNeeded(db, { dataDir: f.dataDir })).why).toBe("an earlier compaction was cut short");
      writeFileSync(join(f.dataDir, "maintenance.off"), "");
      const log = capture();
      const off = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log });
      expect(off.report.skipped).toBe("switched off");
      expect(log.lines).toContain("database maintenance: switched off (maintenance.off in the data folder)");
    } finally {
      await db.close();
    }
  });

  it("PGlite's statistics start from zero at every open: they cannot tell bloat (the design's premise)", async () => {
    const f = folder();
    let db = await openDb(f);
    await db.exec(`create table stats_probe (id int primary key, v text); insert into stats_probe select g, 'x' from generate_series(1, 5000) g; delete from stats_probe where id <= 4000`);
    await db.query(`select pg_stat_force_next_flush()`);
    const dead = async () => Number((await db.one<{ n: number }>(`select coalesce(n_dead_tup, 0)::int as n from pg_stat_user_tables where relname = 'stats_probe'`))?.n ?? 0);
    expect(await dead()).toBe(4000);
    await db.close();
    db = await createPgliteDb({ dataDir: f.dbDir, vector: false, wal: false });
    try {
      expect(await dead()).toBe(0);
      // and the catalogue never had a size for it (nothing ran VACUUM or ANALYZE)
      expect(await db.one(`select relpages, reltuples::float8 as reltuples from pg_class where relname = 'stats_probe'`)).toEqual({ relpages: 0, reltuples: -1 });
    } finally {
      await db.close();
    }
  });
});

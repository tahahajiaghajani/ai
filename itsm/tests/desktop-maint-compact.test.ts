// The start-up compaction of a bloated Windows app database (src/desktop/maintenance.ts): what it compacts and what it
// leaves, the job queue's retention applied to the old finished jobs, the disk it needs, a step cut short, and the log
// VACUUM FULL writes when the table is read first.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { walSinceCheckpoint } from "@server/db/wal";
import { startupMaintenance, readMaintState, measureTables, planCompaction, requiredBytes, estimateTable, fileSizes, MAINT_DEFAULTS, RETENTION, type MaintOptions } from "@local/maintenance";
import { bloat, capture, cleanFolders, fingerprint, folder, jobs, openDb, size, walAt, MB, SMALL } from "./desktop-maint-helpers";

afterAll(cleanFolders);

const OPT: Partial<MaintOptions> = { ...SMALL };

describe("the start-up compaction", () => {
  it("shrinks a 90 %-dead table by at least 80 % with every row intact, logs its steps, and the next start skips it", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await bloat(db, "t_bloat", 150_000);
      const before = await size(db, "t_bloat");
      const rows = await fingerprint(db, "t_bloat");
      expect(rows.n).toBe(15_000);
      const log = capture();
      let told = 0;
      const r = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: { ...OPT, directMaxBytes: 0 }, notify: () => told++ });
      expect(r.report.error).toBeUndefined();
      expect(r.report.compacted).toContain("t_bloat");
      expect(told).toBe(1);
      const after = await size(db, "t_bloat");
      expect(after).toBeLessThanOrEqual(before * 0.2);
      expect(await fingerprint(db, "t_bloat")).toEqual(rows);
      // its steps, as the splash counts them (src/shared/desktop/ready-watch.ts countProgress)
      const steps = log.lines.filter((l) => /^maintenance step \S+ applied/.test(l));
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps.some((l) => /^maintenance step compact:t_bloat applied \(\d+(\.\d)? MB → \d+(\.\d)? MB in \d+ ms\)$/.test(l))).toBe(true);
      expect(steps.some((l) => /^maintenance step analyze:t_bloat applied/.test(l))).toBe(true);
      expect(log.lines.some((l) => /^database maintenance: looked at \d+ tables in \d+ ms: .* reclaimable in \d+ \(.*t_bloat/.test(l))).toBe(true);
      expect(log.lines.some((l) => /^database maintenance: done in .*: folder .* → .* \(\d+ compacted\)$/.test(l))).toBe(true);
      // a checkpoint last: a crash now would replay next to nothing
      expect(await walSinceCheckpoint(db.pg)).toBeLessThan(1 * MB);
      const state = await readMaintState(db);
      expect(state?.compacted_at).toBeTruthy();
      expect(state?.pending).toEqual([]);
      expect(state?.db_bytes).toBeGreaterThan(0);
      // the next start: the gate's query alone
      const next = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture(), options: { ...OPT, gateBytes: 4 * MB } });
      expect(next.report.skipped).toBe("nothing to do");
    } finally {
      await db.close();
    }
  });

  it("never takes an insert-only table for a candidate", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await bloat(db, "t_live", 150_000, 200, 1);
      const m = await measureTables(db, f.dbDir, { bigTableBytes: 1 * MB, samplePages: MAINT_DEFAULTS.samplePages });
      const t = m.tables.find((x) => x.name === "t_live")!;
      expect(t.sampled).toBe(true);
      expect(t.dead).toBeLessThan(0.15);
      const opt = { ...MAINT_DEFAULTS, ...OPT } as MaintOptions;
      expect(planCompaction(m.tables, null, opt).compact.map((x) => x.name)).not.toContain("t_live");
      // not even with the lower thresholds of a compaction asked for in Settings
      expect(planCompaction(m.tables, null, opt, true).compact.map((x) => x.name)).not.toContain("t_live");
    } finally {
      await db.close();
    }
  });

  it("deletes the finished jobs the queue's own retention deletes, and keeps every other job", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await jobs(db, { oldDone: 60_000, newDone: 300, oldFailed: 200, newFailed: 100, queued: 50, running: 5 });
      const log = capture();
      const r = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: OPT });
      expect(r.report.compacted).toContain("sm_jobs");
      expect(r.report.jobs_deleted).toBe(60_200);
      const left = await db.query<{ kind: string; n: number }>(`select kind, count(*)::int as n from sm_jobs group by kind order by kind`);
      expect(Object.fromEntries(left.map((x) => [x.kind, x.n]))).toEqual({ "new.done": 300, "new.failed": 100, queued: 50, running: 5 });
      expect(log.lines.some((l) => /^maintenance step jobs:sm_jobs:\d+ applied \(.* MB, 60200 finished jobs deleted so far, \d+ ms\)$/.test(l))).toBe(true);
      expect(await size(db, "sm_jobs")).toBeLessThan(2 * MB);
      // the indexes still answer
      expect((await db.one<{ n: number }>(`select count(*)::int as n from sm_jobs where status = 'queued' and run_at <= now() + interval '1 day'`))!.n).toBe(50);
    } finally {
      await db.close();
    }
  });

  it("uses the queue's retention as src/server/jobs/index.ts states it (done 3 days, failed 30 days)", () => {
    const src = readFileSync(join(__dirname, "../src/server/jobs/index.ts"), "utf8");
    const days = (status: string) => Number(new RegExp(`status = '${status}' and done_at < now\\(\\) - interval '(\\d+) days'`).exec(src)?.[1]);
    expect(days("done")).toBe(RETENTION.doneDays);
    expect(days("failed")).toBe(RETENTION.failedDays);
  });

  it("leaves a table that does not fit the disk for a later start (state.pending), and says why", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await bloat(db, "t_bloat", 150_000);
      const before = await size(db, "t_bloat");
      const log = capture();
      const r = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: OPT, freeBytes: () => 1 * MB });
      expect(r.report.compacted).toEqual([]);
      expect(r.report.pending).toEqual(["t_bloat"]);
      expect(await size(db, "t_bloat")).toBe(before);
      expect(log.lines.some((l) => /^database maintenance: t_bloat left for a later start: needs \d+(\.\d)? MB free on the disk, 1\.0 MB free$/.test(l))).toBe(true);
      expect((await readMaintState(db))?.pending).toEqual(["t_bloat"]);
      // the next start goes on, the gate's log or not
      const next = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log: capture(), options: { ...OPT, gateBytes: 1024 * MB } });
      expect(next.report.gate?.why).toBe("tables wait from an earlier start");
      expect(next.report.compacted).toEqual(["t_bloat"]);
      expect((await readMaintState(db))?.pending).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("after a compaction cut short, removes that step's unreferenced files, keeps and reports older ones, and goes on", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await bloat(db, "t_bloat", 150_000);
      const dboid = (await db.one<{ oid: number }>(`select oid::int as oid from pg_database where datname = current_database()`))!.oid;
      const base = join(f.dbDir, "base", String(dboid));
      // what a VACUUM FULL killed midway leaves: new files of a filenode no relation names (main fork, a segment, a map)
      const started = Date.now() - 1000;
      writeFileSync(join(f.dataDir, "maintenance.running"), JSON.stringify({ step: "compact", table: "t_bloat", node_before: 1, started_at: started }));
      for (const n of ["999001", "999001.1", "999001_fsm"]) writeFileSync(join(base, n), Buffer.alloc(64 * 1024));
      // and an unreferenced file from long before that step: not this step's, so only reported
      writeFileSync(join(base, "999002"), Buffer.alloc(8192));
      const hourAgo = new Date(Date.now() - 3_600_000);
      utimesSync(join(base, "999002"), hourAgo, hourAgo);
      const log = capture();
      const r = await startupMaintenance(db, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: OPT });
      expect(r.report.interrupted).toMatchObject({ table: "t_bloat", removed: 3, removed_bytes: 3 * 64 * 1024, kept: 1, kept_bytes: 8192 });
      expect(readdirSync(base).filter((n) => n.startsWith("999001"))).toEqual([]);
      expect(existsSync(join(base, "999002"))).toBe(true);
      expect(log.lines.some((l) => /^database maintenance: an earlier compaction of t_bloat was cut short \(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\); 3 of its files removed \(0\.2 MB\)$/.test(l))).toBe(true);
      expect(log.lines.some((l) => l.startsWith("database maintenance: 1 other files no table names"))).toBe(true);
      expect(existsSync(join(f.dataDir, "maintenance.running"))).toBe(false);
      // and the compaction went on
      expect(r.report.compacted).toContain("t_bloat");
      expect((await fingerprint(db, "t_bloat")).n).toBe(15_000);
    } finally {
      await db.close();
    }
  });

  it("reads a table first on a tight disk: VACUUM FULL then writes less than twice the new size of log", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      // dead rows whose hint bits nobody set (each page's first hint after a checkpoint is a full-page image: data checksums)
      await bloat(db, "t_hint", 150_000);
      await db.checkpoint("test");
      const walOf: Record<string, number> = {};
      const exec = db.exec;
      const measured = Object.assign(Object.create(null), db, {
        exec: async (sql: string) => {
          const w0 = await walAt(db);
          await exec(sql);
          if (/^vacuum \(full\)/.test(sql)) walOf[sql] = (await walAt(db)) - w0;
        },
      });
      const m = await measureTables(db, f.dbDir, { bigTableBytes: 1 * MB, samplePages: 2000 });
      const t = m.tables.find((x) => x.name === "t_hint")!;
      // a disk with room for the hint mode only (this small table's old heap is below the default margins: smaller ones)
      const disk = { diskMargin: 1 * MB, hintWalBytes: 1 * MB, directMaxBytes: MAINT_DEFAULTS.directMaxBytes };
      const fresh = t.compact + t.index * (1 - t.dead);
      const free = 2 * fresh + disk.hintWalBytes + disk.diskMargin + 1 * MB;
      expect(requiredBytes(t, free, disk).mode).toBe("hint");
      expect(requiredBytes(t, free + t.heap + t.toast, disk).mode).toBe("direct");
      const log = capture();
      const r = await startupMaintenance(measured, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: { ...OPT, ...disk, rangePages: 1024 }, freeBytes: () => free });
      expect(r.report.compacted).toContain("t_hint");
      expect(log.lines.some((l) => /^maintenance step hint:t_hint:\d+ applied/.test(l))).toBe(true);
      const wal = walOf[`vacuum (full) "t_hint"`];
      const newSize = await size(db, "t_hint");
      expect(wal).toBeGreaterThan(0);
      expect(wal).toBeLessThan(2 * newSize);
    } finally {
      await db.close();
    }
  });
});

describe("the reading pass of a table with TOAST", () => {
  it("reads the TOAST table too, so VACUUM FULL of the whole table still writes less than twice its new size", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      // rows whose value goes out of line (TOAST): 200 md5s do not compress below the threshold
      await db.exec(`create table t_toast (id int primary key, body text)`);
      await db.exec(`insert into t_toast select g, (select string_agg(md5(g::text || ':' || i::text), '') from generate_series(1, 200) i) from generate_series(1, 6000) g`);
      await db.exec(`delete from t_toast where id % 10 <> 0`);
      await db.checkpoint("test");
      const rel = (await db.one<{ heap: number; toast: number }>(`select pg_relation_size(oid)::float8 as heap, pg_relation_size(reltoastrelid)::float8 as toast from pg_class where relname = 't_toast'`))!;
      const toast = Number(rel.toast);
      expect(toast).toBeGreaterThan(8 * MB);
      const ranges = Math.ceil(Number(rel.heap) / 8192 / 256) + Math.ceil(toast / 8192 / 256);
      const walOf: Record<string, number> = {};
      const exec = db.exec;
      const measured = Object.assign(Object.create(null), db, {
        exec: async (sql: string) => {
          const w0 = await walAt(db);
          await exec(sql);
          if (/^vacuum \(full\)/.test(sql)) walOf[sql] = (await walAt(db)) - w0;
        },
      });
      const log = capture();
      const disk = { diskMargin: 1 * MB, hintWalBytes: 1 * MB, directMaxBytes: 0 };
      const r = await startupMaintenance(measured, { dataDir: f.dataDir, dbDir: f.dbDir, log, options: { ...OPT, ...disk, rangePages: 256 } });
      expect(r.report.compacted).toContain("t_toast");
      // the heap's ranges, then the TOAST table's: the last step's number counts both
      const passes = log.lines.filter((l) => /^maintenance step hint:t_toast:\d+ applied/.test(l));
      expect(Number(/hint:t_toast:(\d+) applied/.exec(passes.at(-1)!)![1])).toBe(ranges);
      const wal = walOf[`vacuum (full) "t_toast"`];
      expect(wal).toBeGreaterThan(0);
      expect(wal).toBeLessThan(2 * (await size(db, "t_toast")));
      expect((await db.one<{ n: number }>(`select count(*)::int as n from t_toast where length(body) = 6400`))!.n).toBe(600);
    } finally {
      await db.close();
    }
  });
});

describe("the look's arithmetic", () => {
  it("estimates from a sample, counts the retention's rows as dead, and sums the main forks per filenode", () => {
    const t = { heap: 100 * MB, toast: 0, index: 10 * MB };
    // a 10 % sample of 5 MB of live rows: 50 MB live of 100
    const e = estimateTable(t, { n: 10_000, b: 5 * MB - 80_000 }, 10);
    expect(e.compact).toBeGreaterThan(50 * MB);
    expect(e.compact).toBeLessThan(55 * MB);
    expect(e.dead).toBeGreaterThan(0.45);
    expect(e.reclaim).toBeCloseTo(t.heap - e.compact + t.index * e.dead, 0);
    // the jobs the retention deletes count as dead
    const j = estimateTable(t, { n: 10_000, b: 5 * MB, gone_n: 9_000, gone_b: 4.5 * MB }, 10);
    expect(j.dead).toBeGreaterThan(0.9);
    expect(j.gone).toBe(90_000);
    expect(estimateTable(t, null, 10)).toEqual({ compact: 100 * MB, dead: 0, reclaim: 0 });
    const sizes = fileSizes(["16384", "16384.1", "16384_fsm", "16384_vm", "16390", "pg_filenode.map", "PG_VERSION", "t3_16400"], (n) => (n === "16384.1" ? 7 : 1));
    expect(Object.fromEntries(sizes)).toEqual({ 16384: 8, 16390: 1 });
  });

  it("plans the largest gain first, only above its thresholds, and asks for disk by mode", () => {
    const opt = { ...MAINT_DEFAULTS } as MaintOptions;
    const tbl = (name: string, heap: number, dead: number) => ({ name, heap, toast: 0, index: 0, sampled: true, compact: heap * (1 - dead), dead, reclaim: heap * dead });
    const tables = [tbl("a", 100 * MB, 0.9), tbl("b", 400 * MB, 0.95), tbl("c", 40 * MB, 0.4), tbl("d", 20 * MB, 0.9)];
    const p = planCompaction(tables, null, opt);
    expect(p.compact.map((t) => t.name)).toEqual(["b", "a"]);
    expect(p.run).toBe(true);
    expect(p.notify).toBe(true);
    // below the phase's threshold together: nothing, unless a table waits from an earlier start
    const small = [tbl("a", 60 * MB, 0.9)];
    expect(planCompaction(small, null, opt).run).toBe(false);
    expect(planCompaction(small, { pending: ["a"] }, opt).run).toBe(true);
    // asked for in Settings: lower thresholds, any candidate runs
    expect(planCompaction([tbl("c", 40 * MB, 0.4)], null, opt, true).compact.map((t) => t.name)).toEqual(["c"]);
    const t = tbl("x", 1000 * MB, 0.9);
    expect(requiredBytes(t, 10_000 * MB, opt).mode).toBe("hint"); // too large for the direct mode
    expect(requiredBytes(tbl("y", 100 * MB, 0.9), 10_000 * MB, opt).mode).toBe("direct");
    expect(requiredBytes(t, 300 * MB, opt).mode).toBe("skip");
  });
});

describe("the database's files", () => {
  it("measures the heap, TOAST and index of every public table from the folder", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await bloat(db, "t_size", 50_000, 200, 1);
      const m = await measureTables(db, f.dbDir, { bigTableBytes: 1024 * MB, samplePages: 2000 });
      const t = m.tables.find((x) => x.name === "t_size")!;
      const exact = await db.one<{ heap: number; toast: number; idx: number }>(
        `select pg_relation_size(c.oid)::float8 as heap, pg_relation_size(c.reltoastrelid)::float8 as toast,
                (pg_indexes_size(c.oid) + pg_indexes_size(c.reltoastrelid))::float8 as idx from pg_class c where c.relname = 't_size'`,
      );
      expect(t.heap).toBe(Number(exact!.heap));
      expect(t.toast).toBe(Number(exact!.toast));
      // its indexes and its TOAST table's
      expect(t.index).toBe(Number(exact!.idx));
      expect(t.sampled).toBe(false);
      const dboid = (await db.one<{ oid: number }>(`select oid::int as oid from pg_database where datname = current_database()`))!.oid;
      const base = join(f.dbDir, "base", String(dboid));
      expect(m.dbBytes).toBe(readdirSync(base).reduce((n, x) => n + statSync(join(base, x)).size, 0));
    } finally {
      await db.close();
    }
  });
});

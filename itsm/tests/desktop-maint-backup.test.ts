// The Windows app's backups (src/desktop/backup-stream.ts, backup.ts): PostgreSQL's online backup streamed through gzip
// while the app goes on writing — never PGlite's dumpDataDir, which built the whole folder in memory on the local server's
// thread (an owner's 3.38 GB folder: 66 s frozen, then "Array buffer allocation failed"). Restored by 1.1.3's loader and
// by the streaming one with every row committed before the backup's stop; refused when the log it needs was recycled;
// cut short when too much log piles up; the WAL guard's checkpoints held off meanwhile.
import { describe, it, expect, afterAll, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPgliteDb, type PgliteDb } from "@server/db/pglite";
import { createWalGuard, type WalClock, type WalPg } from "@server/db/wal";
import { writeOnlineBackup, extractBackup, walFilesBetween, walFileName, parseLsn, BackupStopped, BACKUP_SKIP } from "@local/backup-stream";
import { backupNow, BackupError } from "@local/backup";
import { capture, cleanFolders, folder, openDb, tempFolder, MB } from "./desktop-maint-helpers";

afterAll(cleanFolders);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Inserts a row every few milliseconds into t_seq (ids 1, 2, …) until stopped; `committed` is the last id committed. */
function writer(db: PgliteDb) {
  const w = { committed: 0, running: true, done: Promise.resolve() };
  w.done = (async () => {
    for (let id = 1; w.running; id++) {
      await db.query(`insert into t_seq (id) values ($1)`, [id]);
      w.committed = id;
      await sleep(3);
    }
  })();
  return w;
}

async function seqOf(db: PgliteDb): Promise<{ n: number; max: number; contiguous: boolean }> {
  const r = await db.one<{ n: number; max: number | null }>(`select count(*)::int as n, max(id) as max from t_seq`);
  const n = Number(r!.n);
  const max = Number(r!.max ?? 0);
  return { n, max, contiguous: n === max };
}

describe("an online backup", () => {
  it("never uses dumpDataDir, keeps the thread free while rows are written, and restores with 1.1.3's loader and the streaming one", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await db.exec(`create table t_fill (id int, pad text); insert into t_fill select g, md5(g::text) || repeat('x', 300) from generate_series(1, 100000) g`);
      await db.exec(`create table t_seq (id int primary key, at timestamptz not null default now())`);
      // 1.1.3's backup was PGlite's dumpDataDir: it fails here
      const dump = vi.spyOn(db.pg, "dumpDataDir").mockImplementation(() => {
        throw new Error("dumpDataDir holds the thread and the whole folder in memory");
      });
      const w = writer(db);
      await sleep(50);
      // a 20 ms timer: how late it fires while the backup runs (PGlite's work on the thread, gzip, the reads)
      let late = 0;
      let last = performance.now();
      const probe = setInterval(() => {
        const now = performance.now();
        late = Math.max(late, now - last - 20);
        last = now;
      }, 20);
      const before = w.committed;
      let atStop = 0;
      const spy: PgliteDb = Object.assign(Object.create(null), db, {
        pg: Object.assign(Object.create(db.pg), {
          query: (sql: string, params?: unknown[]) => {
            if (/pg_backup_stop/.test(sql)) atStop = w.committed;
            return db.pg.query(sql, params);
          },
        }),
      });
      const dir = join(f.root, "backups");
      const r = await writeOnlineBackup(spy, f.dbDir, join(dir, "itsm-test.tar.gz"), { label: "test" });
      const after = w.committed;
      clearInterval(probe);
      w.running = false;
      await w.done;
      expect(dump).not.toHaveBeenCalled();
      expect(late).toBeLessThan(250);
      expect(after).toBeGreaterThan(before);
      expect(r.wal_segments).toBeGreaterThanOrEqual(1);
      expect(r.files).toBeGreaterThan(100);
      expect(readdirSync(dir)).toEqual(["itsm-test.tar.gz"]);
      // the guard took no checkpoint of its own meanwhile and runs again
      expect(db.wal!.stats().last?.reason).toBe("backup");
      // 1.1.3's restore: the whole file through PGlite's loadDataDir (a downgrade still restores it)
      const old = await createPgliteDb({ dataDir: join(f.root, "restored-old"), vector: false, wal: false, loadDataDir: new Blob([new Uint8Array(readFileSync(r.file))]) });
      // the streaming restore of this version
      const log = capture();
      await extractBackup(r.file, join(f.root, "restored-new"), log);
      expect(log.lines.some((l) => /^restoring database from backup: \d+ files \(\d+(\.\d)? MB\) extracted in \d+\.\d s$/.test(l))).toBe(true);
      const now = await createPgliteDb({ dataDir: join(f.root, "restored-new"), vector: false, wal: false });
      try {
        for (const restored of [old, now]) {
          const seq = await seqOf(restored);
          // every row committed before pg_backup_stop, none torn or missing in between, none from after the copy
          expect(seq.contiguous).toBe(true);
          expect(seq.max).toBeGreaterThanOrEqual(atStop);
          expect(seq.max).toBeLessThanOrEqual(after);
          expect((await restored.one<{ n: number }>(`select count(*)::int as n from t_fill`))!.n).toBe(100_000);
          // backup_label was consumed by the replay: a working database
          await restored.exec(`insert into t_seq (id) values (1000000)`);
        }
      } finally {
        await old.close();
        await now.close();
      }
    } finally {
      await db.close();
    }
  });

  it("is refused when the log it needs was recycled during the copy, leaving nothing behind", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await db.exec(`create table t_seq (id int primary key, at timestamptz not null default now())`);
      const dir = join(f.root, "backups");
      let n = 0;
      const p = writeOnlineBackup(db, f.dbDir, join(dir, "itsm-x.tar.gz"), {
        onFile: async () => {
          if (++n !== 5) return;
          // what the WAL guard's hold prevents: the log moves on three segments and a checkpoint recycles the old ones
          for (let i = 0; i < 3; i++) {
            await db.pg.query(`insert into t_seq (id) values ($1)`, [i + 1]);
            await db.pg.query(`select pg_switch_wal()`);
          }
          await db.pg.exec(`checkpoint`);
        },
      });
      await expect(p).rejects.toMatchObject({ reason: "missing_wal" });
      await expect(p).rejects.toThrow(/^backup refused: log segment [0-9A-F]{24} between its start and its end is missing$/);
      expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
      // the backup mode ended: another backup runs
      const ok = await writeOnlineBackup(db, f.dbDir, join(dir, "itsm-y.tar.gz"));
      expect(ok.size).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });

  it("is cut short when more log than allowed piles up during the copy, and says so in Persian", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      await db.exec(`create table churn (id int, pad text)`);
      const dir = join(f.root, "backups");
      let once = false;
      const p = writeOnlineBackup(db, f.dbDir, join(dir, "itsm-c.tar.gz"), {
        maxWalBytes: 2 * MB,
        onFile: async () => {
          if (once) return;
          once = true;
          await db.exec(`insert into churn select g, repeat('c', 900) from generate_series(1, 5000) g`);
        },
      });
      await expect(p).rejects.toBeInstanceOf(BackupStopped);
      await expect(p).rejects.toMatchObject({ reason: "cut_short" });
      expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
      // backupNow: a BackupError the bridge retries, with the message a manual backup shows
      const big = db.exec(`insert into churn select g, repeat('c', 900) from generate_series(1, 5000) g`);
      const e = await backupNow(
        Object.assign(Object.create(null), db, {
          pg: Object.assign(Object.create(db.pg), {
            query: async (sql: string, params?: unknown[]) => {
              const r = await db.pg.query(sql, params);
              if (/pg_backup_start/.test(sql)) await db.exec(`insert into churn select g, repeat('c', 900) from generate_series(1, 5000) g`);
              return r;
            },
          }),
        }),
        dir,
        "auto",
        { maxWalBytes: 2 * MB },
      ).catch((x) => x);
      await big;
      expect(e).toBeInstanceOf(BackupError);
      expect(e).toMatchObject({ reason: "cut_short", code: "backup_failed", status: 503 });
      expect(e.message).toMatch(/پشتیبان‌گیری نیمه‌کاره ماند/);
      expect(e.logged).toMatch(/^backup cut short: \d+ MB of log written during the copy$/);
    } finally {
      await db.close();
    }
  });

  it("refuses to start without room on the backups' disk", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      const e = await backupNow(db, join(f.root, "backups"), "manual", { minFreeBytes: 512 * MB, freeBytes: () => 100 * MB }).catch((x) => x);
      expect(e).toMatchObject({ reason: "disk", code: "backup_failed" });
      expect(e.message).toMatch(/فضای خالی دیسک/);
    } finally {
      await db.close();
    }
  });

  it("leaves out what PostgreSQL rebuilds and a running server's files, and keeps the archive's own order", async () => {
    const f = folder();
    const db = await openDb(f);
    try {
      const r = await backupNow(db, join(f.root, "backups"), "layout");
      // the names of the archive, read with the restore's own reader into a folder
      const out = tempFolder();
      await extractBackup(r.file, join(out, "db"));
      const listed = (dir: string, rel = ""): string[] =>
        readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [`${rel}${e.name}/`, ...listed(dir, `${rel}${e.name}/`)] : [`${rel}${e.name}`]));
      const names = listed(join(out, "db"));
      expect(names).toContain("backup_label");
      expect(names).toContain("global/pg_control");
      expect(names).toContain("PG_VERSION");
      expect(names).toContain("pg_wal/archive_status/");
      for (const skipped of ["postmaster.pid", "postmaster.opts"]) expect(names).not.toContain(skipped);
      expect(names.filter((n) => n.startsWith("pg_stat_tmp/") && !n.endsWith("/"))).toEqual([]);
      // only the log from the backup's start to its stop
      const segs = names.filter((n) => /^pg_wal\/[0-9A-F]{24}$/.test(n));
      expect(segs.length).toBeGreaterThanOrEqual(1);
      expect(segs.length).toBeLessThanOrEqual(3);
      expect(BACKUP_SKIP.contents).toContain("pg_wal");
    } finally {
      await db.close();
    }
  });
});

describe("the log segments a restore replays", () => {
  it("names them as PostgreSQL does, from the backup's start to the byte before its stop", async () => {
    expect(parseLsn("16/B374D848")).toBe(0x16 * 2 ** 32 + 0xb374d848);
    expect(walFileName(0x16b3)).toBe("0000000100000016000000B3");
    expect(walFilesBetween("0/7000028", "0/7000120")).toEqual(["000000010000000000000007"]);
    expect(walFilesBetween("0/7FFFFF0", "0/9000010")).toEqual(["000000010000000000000007", "000000010000000000000008", "000000010000000000000009"]);
    // a stop exactly at a segment's start: the segment before it (pg_walfile_name)
    expect(walFilesBetween("0/7000028", "0/8000000")).toEqual(["000000010000000000000007"]);
    expect(walFilesBetween("FF/FF000028", "100/1000010", 2)).toEqual(["00000002000000FF000000FF", "000000020000010000000000", "000000020000010000000001"]);
    // checked against the database's own names
    const db = await createPgliteDb({ vector: false });
    try {
      for (const lsn of ["0/7000028", "1/A0000020", "16/B374D848"]) {
        const pg = (await db.one<{ f: string }>(`select pg_walfile_name($1::pg_lsn) as f`, [lsn]))!.f;
        expect(walFilesBetween(lsn, lsn).at(-1)).toBe(pg);
      }
    } finally {
      await db.close();
    }
  });
});

describe("the WAL guard's hold", () => {
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
          for (let i = 0; i < 20; i++) await Promise.resolve();
        }
        now = until;
      },
    };
    return clock;
  }
  function fakePg() {
    const pg = {
      since: 0,
      checkpoints: 0,
      async query<T>(sql: string): Promise<{ rows: T[] }> {
        return { rows: /pg_wal_lsn_diff/.test(sql) ? [{ d: pg.since } as T] : [] };
      },
      async exec(sql: string) {
        if (/^CHECKPOINT$/i.test(sql.trim())) {
          pg.checkpoints++;
          pg.since = 200;
        }
      },
    };
    return pg as typeof pg & WalPg;
  }

  it("takes no checkpoint of its own past the hard limit until released; an explicit one still runs", async () => {
    const clock = fakeClock();
    const pg = fakePg();
    const g = createWalGuard(pg, { clock, volumeBytes: 32 * MB, hardBytes: 64 * MB, idleMs: 1000, pollMs: 2000, busyPollMs: 250, idleCheckMs: 250 });
    g.start();
    const release = g.hold();
    pg.since = 200 * MB;
    await clock.advance(60_000);
    expect(pg.checkpoints).toBe(0);
    // the app's calls do not slip one in either (the hard limit's look after each call)
    await g.track(async () => {});
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(pg.checkpoints).toBe(0);
    // holds nest
    const second = g.hold();
    release();
    release();
    await clock.advance(10_000);
    expect(pg.checkpoints).toBe(0);
    // close, migrations, a backup's own: explicit checkpoints run
    await g.checkpoint("close");
    expect(pg.checkpoints).toBe(1);
    pg.since = 200 * MB;
    second();
    await clock.advance(3_000);
    expect(pg.checkpoints).toBe(2);
    expect(g.stats().last?.reason).toBe("volume");
    g.stop();
  });
});

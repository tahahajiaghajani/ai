// Restoring a backup of the Windows app (src/desktop/backup.ts takePendingRestore, src/desktop/backup-stream.ts
// extractBackup): the backup is never read into memory — 1.1.3 read it whole, copied it twice into a Blob and let
// PGlite unpack it in memory (about 3.3 times the folder) —, but extracted as a stream into the empty database folder,
// every entry's checksum and path checked, PG_VERSION written last. 1.1.3's backups (PGlite's dumpTar) restore too.
import { describe, it, expect, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { createPgliteDb } from "@server/db/pglite";
import { takePendingRestore, scheduleRestore, backupNow } from "@local/backup";
import { extractBackup, ustarHeader } from "@local/backup-stream";
import { cleanFolders, folder, openDb, tempFolder } from "./desktop-maint-helpers";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), renameSync: vi.fn(actual.renameSync) };
});

afterAll(cleanFolders);

/** A gzip'd tar of the given entries (names written as they are), with PG_VERSION last unless `version` is false. */
function archive(entries: { name: string; data?: Buffer; dir?: boolean }[], version = true): Buffer {
  const parts: Buffer[] = [];
  const all = version ? [...entries, { name: "PG_VERSION", data: Buffer.from("18\n") }] : entries;
  for (const e of all) {
    const data = e.dir ? Buffer.alloc(0) : (e.data ?? Buffer.from("x"));
    parts.push(ustarHeader(e.name, data.length, e.dir ? 0o755 : 0o600, Date.now(), e.dir ? "5" : "0"));
    parts.push(data);
    if (data.length % 512) parts.push(Buffer.alloc(512 - (data.length % 512)));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

describe("a scheduled restore", () => {
  it("is taken without reading the backup: its path and the database set aside (and a stale compaction marker dropped)", () => {
    const root = tempFolder();
    const file = join(root, "itsm-manual-20261121-120000.tar.gz");
    writeFileSync(file, Buffer.alloc(4 * 1024 * 1024, 7));
    mkdirSync(join(root, "db"));
    writeFileSync(join(root, "db", "PG_VERSION"), "18\n");
    writeFileSync(join(root, "maintenance.running"), "{}");
    scheduleRestore(root, file);
    const read = vi.mocked(fs.readFileSync);
    read.mockClear();
    const r = takePendingRestore(root);
    expect(r).not.toBeNull();
    expect(Object.keys(r!).sort()).toEqual(["aside", "file"]);
    expect(r!.file).toBe(file);
    expect(r!.aside && existsSync(join(r!.aside, "PG_VERSION"))).toBe(true);
    expect(existsSync(join(root, "db"))).toBe(false);
    expect(existsSync(join(root, "maintenance.running"))).toBe(false);
    expect(existsSync(join(root, "restore.pending"))).toBe(false);
    // the marker was read (the path in it), the backup never
    expect(read.mock.calls.map((c) => String(c[0]))).not.toContain(file);
  });

  it("puts the database from before a restore back when that restore's start was cut short, and keeps one that finished", () => {
    const root = tempFolder();
    const file = join(root, "itsm-manual-20261121-120000.tar.gz");
    writeFileSync(file, Buffer.alloc(1024, 7));
    mkdirSync(join(root, "db", "base", "5"), { recursive: true });
    writeFileSync(join(root, "db", "PG_VERSION"), "18\n");
    writeFileSync(join(root, "db", "base", "5", "1259"), "the person's data");
    scheduleRestore(root, file);
    const r = takePendingRestore(root)!;
    // the app is killed while the backup is extracted: a folder of some files and no PG_VERSION (written last)
    mkdirSync(join(root, "db", "base", "5"), { recursive: true });
    writeFileSync(join(root, "db", "base", "5", "1259"), "half of the backup");
    // the next start: no restore is pending, and the folder is no database
    const warned: string[] = [];
    expect(takePendingRestore(root, { warn: (m: string) => void warned.push(m) })).toBeNull();
    expect(readFileSync(join(root, "db", "base", "5", "1259"), "utf8")).toBe("the person's data");
    expect(existsSync(join(root, "db", "PG_VERSION"))).toBe(true);
    expect(existsSync(r.aside!)).toBe(false);
    expect(existsSync(join(root, "restore.running"))).toBe(false);
    expect(warned).toEqual([expect.stringMatching(/^restoring a backup was cut short at an earlier start .*: the database from before it is back$/)]);
    // a restore that finished (PG_VERSION written) is the database from then on: the start after it leaves it be
    scheduleRestore(root, file);
    const done = takePendingRestore(root)!;
    mkdirSync(join(root, "db"), { recursive: true });
    writeFileSync(join(root, "db", "PG_VERSION"), "18\n");
    writeFileSync(join(root, "db", "restored"), "the backup's data");
    expect(takePendingRestore(root, { warn: (m: string) => void warned.push(m) })).toBeNull();
    expect(existsSync(join(root, "db", "restored"))).toBe(true);
    expect(existsSync(done.aside!)).toBe(true);
    expect(existsSync(join(root, "restore.running"))).toBe(false);
    expect(warned).toHaveLength(1);
  });

  it("names the database it sets aside before it sets it aside: a start cut short in between still finds it", () => {
    const root = tempFolder();
    const file = join(root, "itsm-manual-20261121-130000.tar.gz");
    writeFileSync(file, Buffer.alloc(1024, 7));
    mkdirSync(join(root, "db"));
    writeFileSync(join(root, "db", "PG_VERSION"), "18\n");
    scheduleRestore(root, file);
    const rename = vi.mocked(fs.renameSync);
    const real = rename.getMockImplementation()!;
    const named: (string | null)[] = [];
    rename.mockImplementationOnce((from, to) => {
      // what a start cut short at this moment would find: the marker names the folder about to be set aside
      const m = existsSync(join(root, "restore.running")) ? (JSON.parse(String(readFileSync(join(root, "restore.running"), "utf8"))) as { aside: string | null }) : null;
      named.push(m?.aside ?? null);
      return real(from, to);
    });
    const r = takePendingRestore(root)!;
    expect(named).toEqual([basename(r.aside!)]);
    // cut short right after the marker, before the folder moved: the next start finds the database in place and drops the marker
    writeFileSync(join(root, "restore.running"), JSON.stringify({ file, aside: "db-before-restore-20261121-130001" }));
    rmSync(join(root, "db"), { recursive: true, force: true });
    rename.mockClear();
    real(r.aside!, join(root, "db"));
    expect(takePendingRestore(root)).toBeNull();
    expect(existsSync(join(root, "db", "PG_VERSION"))).toBe(true);
    expect(existsSync(join(root, "restore.running"))).toBe(false);
  });

  it("restores a 1.1.3 backup (PGlite's dumpDataDir, gzip'd) with the streaming reader", async () => {
    const f = folder();
    const db = await openDb(f);
    const file = join(f.root, "itsm-auto-old.tar.gz");
    try {
      await db.exec(`create table t_old (id int primary key, v text); insert into t_old select g, 'پیش از ۱٫۱٫۴' from generate_series(1, 3000) g`);
      // exactly 1.1.3's backupNow: a checkpoint, the folder's tar from PGlite, gzip'd
      await db.checkpoint("backup");
      const tar = await db.pg.dumpDataDir("none");
      writeFileSync(file, gzipSync(Buffer.from(await tar.arrayBuffer())));
    } finally {
      await db.close();
    }
    const to = join(f.root, "restored");
    await extractBackup(file, to);
    const back = await createPgliteDb({ dataDir: to, vector: false, wal: false });
    try {
      expect(await back.one(`select count(*)::int as n, min(v) as v from t_old`)).toEqual({ n: 3000, v: "پیش از ۱٫۱٫۴" });
    } finally {
      await back.close();
    }
  });

  it("restores a 1.1.3 backup that holds files not PostgreSQL's (1.1.3 kept whatever the folder held), leaving those out", async () => {
    const f = folder();
    const db = await openDb(f);
    const file = join(f.root, "itsm-auto-stray.tar.gz");
    try {
      await db.exec(`create table t_old (id int primary key); insert into t_old select generate_series(1, 300)`);
      // a copy made in Explorer and a folder of notes, in the database folder when 1.1.3 made its backup
      writeFileSync(join(f.dbDir, "postgresql - Copy.conf"), "# a copy\n");
      mkdirSync(join(f.dbDir, "New folder"));
      writeFileSync(join(f.dbDir, "New folder", "notes.txt"), "x");
      await db.checkpoint("backup");
      const tar = await db.pg.dumpDataDir("none");
      writeFileSync(file, gzipSync(Buffer.from(await tar.arrayBuffer())));
    } finally {
      await db.close();
    }
    const to = join(f.root, "restored-stray");
    const lines: string[] = [];
    const r = await extractBackup(file, to, { info: (m: string) => void lines.push(m) });
    expect(r.skipped).toBe(3);
    expect(lines.some((l) => /^restoring database from backup: \d+ files \(.*\) extracted in \d+\.\d s \(3 entries not PostgreSQL's left out\)$/.test(l))).toBe(true);
    expect(existsSync(join(to, "postgresql - Copy.conf"))).toBe(false);
    expect(existsSync(join(to, "New folder"))).toBe(false);
    const back = await createPgliteDb({ dataDir: to, vector: false, wal: false });
    try {
      expect(await back.one(`select count(*)::int as n from t_old`)).toEqual({ n: 300 });
    } finally {
      await back.close();
    }
  });

  it("refuses a truncated or damaged backup and leaves no PG_VERSION (a half folder is never opened)", async () => {
    const f = folder();
    const db = await openDb(f);
    let good: string;
    try {
      await db.exec(`create table t_x (id int, v text); insert into t_x select g, md5(g::text) from generate_series(1, 20000) g`);
      good = (await backupNow(db, join(f.root, "backups"), "manual")).file;
    } finally {
      await db.close();
    }
    const bytes = readFileSync(good);
    // cut in the middle
    const cut = join(f.root, "cut.tar.gz");
    writeFileSync(cut, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await expect(extractBackup(cut, join(f.root, "r-cut"))).rejects.toThrow();
    expect(existsSync(join(f.root, "r-cut", "PG_VERSION"))).toBe(false);
    // a flipped byte in the compressed stream (gzip's check)
    const flipped = Buffer.from(bytes);
    flipped[Math.floor(flipped.length / 2)] ^= 0xff;
    const bad = join(f.root, "bad.tar.gz");
    writeFileSync(bad, flipped);
    await expect(extractBackup(bad, join(f.root, "r-bad"))).rejects.toThrow();
    expect(existsSync(join(f.root, "r-bad", "PG_VERSION"))).toBe(false);
    // an entry whose header checksum does not match (the tar's own check)
    const raw = Buffer.concat([ustarHeader("base/1", 1, 0o600, 0, "0"), Buffer.alloc(511), Buffer.from("x"), Buffer.alloc(1024)]);
    raw[0] = "c".charCodeAt(0); // the name changes after the checksum was computed
    writeFileSync(join(f.root, "sum.tar.gz"), gzipSync(raw));
    await expect(extractBackup(join(f.root, "sum.tar.gz"), join(f.root, "r-sum"))).rejects.toThrow(/damaged entry/);
    // an archive without PG_VERSION is no database
    writeFileSync(join(f.root, "nover.tar.gz"), archive([{ name: "base", dir: true }, { name: "base/1" }], false));
    await expect(extractBackup(join(f.root, "nover.tar.gz"), join(f.root, "r-nover"))).rejects.toThrow(/no PG_VERSION/);
    // and never over a database
    await expect(extractBackup(good, f.dbDir)).rejects.toThrow(/already holds a database/);
  });

  it("refuses names that leave the folder (.., drive letters, backslashes) and keeps an old backup's leading / inside it", async () => {
    const root = tempFolder();
    for (const name of ["../escape", "base/../../escape", "C:/escape", "base\\escape", "./x", "base/./x"]) {
      const file = join(root, "evil.tar.gz");
      writeFileSync(file, archive([{ name }]));
      const to = join(root, `r-${readdirSync(root).length}`);
      await expect(extractBackup(file, to), name).rejects.toThrow(/unexpected path/);
      expect(existsSync(join(root, "escape")), name).toBe(false);
      expect(existsSync(join(to, "PG_VERSION")), name).toBe(false);
    }
    // 1.1.3's archives name every entry from the folder's root ("/base/1"): inside the folder, never at the root
    const file = join(root, "old-names.tar.gz");
    writeFileSync(file, archive([{ name: "/base", dir: true }, { name: "/base/1", data: Buffer.from("one") }, { name: "/etc/passwd-like", data: Buffer.from("two") }]));
    const to = join(root, "r-old");
    await extractBackup(file, to);
    expect(readFileSync(join(to, "base", "1"), "utf8")).toBe("one");
    expect(readFileSync(join(to, "etc", "passwd-like"), "utf8")).toBe("two");
    expect(readFileSync(join(to, "PG_VERSION"), "utf8")).toBe("18\n");
  });
});

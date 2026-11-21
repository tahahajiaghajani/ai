// Restoring a backup of the Windows app (src/desktop/backup.ts takePendingRestore, src/desktop/backup-stream.ts
// extractBackup): the backup is never read into memory — 1.1.3 read it whole, copied it twice into a Blob and let
// PGlite unpack it in memory (about 3.3 times the folder) —, but extracted as a stream into the empty database folder,
// every entry's checksum and path checked, PG_VERSION written last. 1.1.3's backups (PGlite's dumpTar) restore too.
import { describe, it, expect, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createPgliteDb } from "@server/db/pglite";
import { takePendingRestore, scheduleRestore, backupNow } from "@local/backup";
import { extractBackup, ustarHeader } from "@local/backup-stream";
import { cleanFolders, folder, openDb, tempFolder } from "./desktop-maint-helpers";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
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

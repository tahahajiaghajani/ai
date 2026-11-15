// Backups of the local database: a compressed copy of the PostgreSQL data folder.
// Automatic every few hours (and before restores/updates), kept for N copies.
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { PgliteDb } from "@server/db/pglite";

export function backupDir(dataDir: string, configured: string | null) {
  const dir = configured || join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * A copy of the data folder: a checkpoint first (the copy then carries a few segments of write-ahead log, not the
 * backlog of the day, and a restore replays little), then PGlite's tarball of the folder, compressed into the file as a
 * stream (no second copy of it in memory). The same gzip'd tar as PGlite's own `dumpDataDir("gzip")`; a restore loads
 * it with `loadDataDir`.
 */
export async function backupNow(db: Pick<PgliteDb, "pg" | "checkpoint">, dir: string, label = "auto"): Promise<{ file: string; size: number }> {
  await db.checkpoint("backup");
  const tar = await db.pg.dumpDataDir("none");
  const file = join(dir, `itsm-${label}-${stamp()}.tar.gz`);
  try {
    await pipeline(Readable.fromWeb(tar.stream() as Parameters<typeof Readable.fromWeb>[0]), createGzip(), createWriteStream(`${file}.part`));
  } catch (e) {
    rmSync(`${file}.part`, { force: true });
    throw e;
  }
  renameSync(`${file}.part`, file);
  return { file, size: statSync(file).size };
}

/** Backups are named `itsm-<label>-<stamp>.tar.gz` (label: auto, manual, before-restore). */
const BACKUP_FILE = /^itsm-.*\.tar\.gz$/;
const AUTO_FILE = /^itsm-auto-/;

export function listBackups(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => BACKUP_FILE.test(f))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { file: join(dir, f), name: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function pruneBackups(dir: string, keep: number) {
  const autos = listBackups(dir).filter((b) => AUTO_FILE.test(b.name));
  // a broken setting (NaN, a string, …) must never mean «keep none»: slice(NaN) would delete every copy
  const n = Number(keep);
  const k = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 30;
  for (const b of autos.slice(k)) {
    try {
      unlinkSync(b.file);
    } catch {
      /* ignore */
    }
  }
}

/** Marks a backup to be restored at the next start (the database must be closed for it). */
export function scheduleRestore(dataDir: string, file: string) {
  if (!existsSync(file)) throw new Error("فایل پشتیبان پیدا نشد");
  writeFileSync(join(dataDir, "restore.pending"), file, "utf8");
}

/** The marker of a scheduled restore; while it exists the running server takes no more changes. */
export function restorePending(dataDir: string) {
  return existsSync(join(dataDir, "restore.pending"));
}

/**
 * Called before the database opens: if a restore is pending, keep the current database aside
 * and return the backup to load. The caller opens PGlite with `loadDataDir` and, when that
 * fails, puts the current database back with `undoRestore` (a broken backup must not leave
 * an empty database behind).
 */
export function takePendingRestore(dataDir: string): { data: Buffer; aside: string | null } | null {
  const marker = join(dataDir, "restore.pending");
  if (!existsSync(marker)) return null;
  const file = readFileSync(marker, "utf8").trim();
  rmSync(marker, { force: true });
  if (!file || !existsSync(file)) return null;
  const data = readFileSync(file);
  const db = join(dataDir, "db");
  let aside: string | null = null;
  if (existsSync(db)) {
    aside = join(dataDir, `db-before-restore-${stamp()}`);
    renameSync(db, aside);
  }
  return { data, aside };
}

/** A restore could not be loaded: drop what it left in `db` and put the previous database back. */
export function undoRestore(dataDir: string, aside: string | null) {
  const db = join(dataDir, "db");
  if (existsSync(db)) {
    try {
      rmSync(db, { recursive: true, force: true });
    } catch {
      renameSync(db, join(dataDir, `db-failed-restore-${stamp()}`));
    }
  }
  if (aside && existsSync(aside)) renameSync(aside, db);
}

export { basename };

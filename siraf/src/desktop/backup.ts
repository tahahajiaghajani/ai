// Backups of the local database: a compressed copy of the PostgreSQL data folder.
// Automatic every few hours (and before restores/updates), kept for N copies.
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import type { PGlite } from "@electric-sql/pglite";

export function backupDir(dataDir: string, configured: string | null) {
  const dir = configured || join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function backupNow(pg: PGlite, dir: string, label = "auto"): Promise<{ file: string; size: number }> {
  const blob = await pg.dumpDataDir("gzip");
  const buf = Buffer.from(await blob.arrayBuffer());
  const file = join(dir, `siraf-${label}-${stamp()}.tar.gz`);
  writeFileSync(`${file}.part`, buf);
  renameSync(`${file}.part`, file);
  return { file, size: buf.length };
}

/** Backups are named `siraf-<label>-<stamp>.tar.gz`; copies made under the old name «تراز» (`taraz-…`) stay listed. */
const BACKUP_FILE = /^(siraf|taraz)-.*\.tar\.gz$/;
const AUTO_FILE = /^(siraf|taraz)-auto-/;

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
  for (const b of autos.slice(Math.max(1, keep))) {
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

/**
 * Called before the database opens: if a restore is pending, keep the current database aside
 * and return the backup to load. The caller opens PGlite with `loadDataDir`.
 */
export function takePendingRestore(dataDir: string): Buffer | null {
  const marker = join(dataDir, "restore.pending");
  if (!existsSync(marker)) return null;
  const file = readFileSync(marker, "utf8").trim();
  rmSync(marker, { force: true });
  if (!existsSync(file)) return null;
  const db = join(dataDir, "db");
  if (existsSync(db)) renameSync(db, join(dataDir, `db-before-restore-${stamp()}`));
  return readFileSync(file);
}

export { basename };

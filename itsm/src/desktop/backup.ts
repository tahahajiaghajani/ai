// Backups of the local database: a compressed copy of the PostgreSQL data folder.
// Automatic every few hours (and before restores/updates), kept for N copies.
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { AppError } from "@server/http/errors";
import type { Logger } from "@server/context";
import type { PgliteDb } from "@server/db/pglite";
import { BackupStopped, writeOnlineBackup, type BackupFailure } from "./backup-stream";

export function backupDir(dataDir: string, configured: string | null) {
  const dir = configured || join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const MB = 1024 * 1024;
const fmtMb = (b: number) => (b >= 1024 * MB ? `${(b / (1024 * MB)).toFixed(2)} GB` : b >= 10 * MB ? `${Math.round(b / MB)} MB` : `${(b / MB).toFixed(1)} MB`);

/** The Persian message of a backup that did not finish, by why (a manual backup shows it; app.log keeps the English one). */
const FAILED: Record<BackupFailure | "failed", string> = {
  cut_short: "پشتیبان‌گیری نیمه‌کاره ماند، چون در همان زمان داده‌های زیادی در پایگاه داده نوشته شد؛ چند دقیقهٔ دیگر دوباره امتحان کنید.",
  missing_wal: "پشتیبان‌گیری کامل نشد، چون بخشی از گزارش تغییرات پایگاه داده که پشتیبان به آن نیاز داشت در میانهٔ کار پاک شد؛ دوباره امتحان کنید.",
  disk: "فضای خالی دیسک پوشهٔ پشتیبان‌ها برای پشتیبان تازه کافی نیست؛ روی همان دیسک فضا آزاد کنید، مثلاً پشتیبان‌های قدیمی را به دیسک دیگری ببرید.",
  aborted: "پشتیبان‌گیری متوقف شد، چون برنامه در حال بسته شدن است.",
  failed: "پشتیبان گرفته نشد",
};

/**
 * A backup that did not finish: `reason` says why (bridge.ts retries one cut short), the message is the Persian one a
 * manual backup shows, `logged` the English line for app.log.
 */
export class BackupError extends AppError {
  constructor(
    readonly reason: BackupFailure | "failed",
    message: string,
    readonly logged: string,
  ) {
    super(503, "backup_failed", message, { reason });
  }
}

export interface BackupOptions {
  /** aborts a backup under way (the app is closing) */
  signal?: AbortSignal;
  /** where the backup's line goes (app.log) */
  log?: Pick<Logger, "info">;
  /** free bytes the backups' disk must have before a backup starts */
  minFreeBytes?: number;
  /** the copy is cut short past this much log written during it (default 64 MB) */
  maxWalBytes?: number;
  /** free bytes of a folder's disk (tests) */
  freeBytes?: (dir: string) => number;
}

/**
 * A copy of the data folder while the app goes on working (./backup-stream.ts: PostgreSQL's online backup, the folder
 * streamed through gzip into the file, the log written meanwhile added at the end): never the whole folder in memory,
 * the thread and the database never held for long. A checkpoint first (logged as before), so a restore replays little.
 * The same gzip'd tar a restore has always loaded (`loadDataDir` reads it as it read PGlite's own dump), and
 * `extractBackup` restores it as a stream. A backup that does not finish throws a `BackupError` and leaves nothing.
 */
export async function backupNow(
  db: Pick<PgliteDb, "pg" | "checkpoint"> & Partial<Pick<PgliteDb, "wal">>,
  dir: string,
  label = "auto",
  o: BackupOptions = {},
): Promise<{ file: string; size: number }> {
  const dataDir = db.pg.dataDir;
  if (!dataDir || /^(memory|idb):\/\//.test(dataDir)) throw new BackupError("failed", "پشتیبان‌گیری فقط برای پایگاه دادهٔ محلی روی دیسک ممکن است", "backup failed: the database has no data folder");
  const file = join(dir, `itsm-${label}-${stamp()}.tar.gz`);
  try {
    const r = await writeOnlineBackup(db, dataDir.replace(/^file:\/\//, ""), file, {
      label: basename(file),
      signal: o.signal,
      minFreeBytes: o.minFreeBytes,
      maxWalBytes: o.maxWalBytes,
      freeBytes: o.freeBytes,
    });
    o.log?.info(`backup: ${basename(file)} ${fmtMb(r.size)} from ${fmtMb(r.bytes)} in ${(r.ms / 1000).toFixed(1)} s (online; ${r.wal_segments} log segment${r.wal_segments === 1 ? "" : "s"})`);
    return { file: r.file, size: r.size };
  } catch (e) {
    if (e instanceof BackupStopped) throw new BackupError(e.reason, FAILED[e.reason], e.message);
    const why = String((e as Error)?.message ?? e);
    throw new BackupError("failed", `${FAILED.failed}: ${why}`, `backup failed: ${why}`);
  }
}

/** Free bytes a new backup needs on the backups' disk: twice the last one's size and 512 MB more. */
export function backupSpaceNeeded(dir: string): number {
  const last = listBackups(dir)[0]?.size ?? 0;
  return 2 * last + 512 * MB;
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
 * Called before the database opens: if a restore is pending, keep the current database aside and return the backup to
 * load — its path only: the backup is never read into memory (server.ts extracts it as a stream, ./backup-stream.ts
 * `extractBackup`, then opens the folder). When that fails the caller puts the current database back with
 * `undoRestore` (a broken backup must not leave an empty database behind). An interrupted compaction's marker
 * (./maintenance.ts) names files of the database set aside, not of the restored one: it goes too.
 */
export function takePendingRestore(dataDir: string): { file: string; aside: string | null } | null {
  const marker = join(dataDir, "restore.pending");
  if (!existsSync(marker)) return null;
  const file = readFileSync(marker, "utf8").trim();
  rmSync(marker, { force: true });
  if (!file || !existsSync(file)) return null;
  const db = join(dataDir, "db");
  let aside: string | null = null;
  if (existsSync(db)) {
    aside = join(dataDir, `db-before-restore-${stamp()}`);
    renameSync(db, aside);
  }
  rmSync(join(dataDir, "maintenance.running"), { force: true });
  return { file, aside };
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

// What opening the local database will face, read before PGlite touches the data folder (src/desktop/server.ts tells the
// Electron main process, which then waits for the open as long as it takes: @shared/desktop/ready-watch). PGlite has no
// checkpointer, so a database that was not closed cleanly — a forced close, a killed process — replays its write-ahead
// log from the last checkpoint when it opens: synchronously, on the local server's only thread (an 888 MB log took 6.3 s
// on a Linux development machine, and a Windows laptop is slower). After a power cut or a Windows crash that recovery may
// fail: PGlite runs with fsync off, so the log may not have reached the disk before the data it covers, nor the control
// file at all. With fs alone and in milliseconds: one directory listing and the 8 KB control file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MB = 1024 * 1024;

/**
 * pg_control's DBState (src/include/catalog/pg_control.h) of a clean close: DB_SHUTDOWNED. PostgreSQL replays the log
 * for any other state (InitWalRecovery, src/backend/access/transam/xlogrecovery.c) — DB_SHUTDOWNED_IN_RECOVERY (2) too,
 * which only a standby's restartpoint writes and PGlite never does.
 */
const DB_SHUTDOWNED = 1;
/** The last DBState (DB_IN_PRODUCTION): a higher value is not a control file this code knows. */
const LAST_STATE = 6;
/** `unknown` of a data folder that holds no database yet (a first start). */
export const NO_DATABASE = "no database yet";

/** What pg_control says about the database's last close. */
export interface ControlState {
  /** true: not closed cleanly, the log is replayed first; false: closed cleanly; null: unknown (see `unknown`) */
  recovery: boolean | null;
  /** its DBState as read: 1 closed cleanly, 6 left open (in production), 4 a recovery cut short; null when not read */
  state: number | null;
  /**
   * why `recovery` is not known, for app.log (null when it is): "no pg_control", "pg_control is N bytes",
   * "pg_control version N", "state N" (a state this code does not know) or "unreadable: <error code>"
   */
  unknown: string | null;
}

/**
 * What an open faces: the log's size and pg_control's state (`unknown` is NO_DATABASE for a folder without a database;
 * src/desktop/server.ts sets "restoring a backup" and "in memory" for an open that loads no folder).
 */
export interface DatabaseOpening extends ControlState {
  /** size of pg_wal in MB (every file in it, the spare segments an older version recycled included) */
  walMb: number;
}

/** The size of a data folder's pg_wal in MB: the sum of its files' sizes (0 when there is none). */
export function walSizeMb(dbDir: string): number {
  const dir = join(dbDir, "pg_wal");
  let bytes = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      try {
        bytes += statSync(join(dir, e.name)).size;
      } catch {
        /* removed meanwhile */
      }
    }
  } catch {
    return 0;
  }
  return Math.round(bytes / MB);
}

/**
 * A control file's bytes judged: `state` is a 32-bit enum after the 8-byte system identifier and the two 32-bit version
 * numbers (offset 16 in every PostgreSQL since 9.x; little-endian, as WebAssembly writes it).
 */
export function controlState(b: Buffer): ControlState {
  if (b.length < 20) return { recovery: null, state: null, unknown: `pg_control is ${b.length} bytes` };
  const version = b.readUInt32LE(8); // PG_CONTROL_VERSION: 1800 in PGlite 0.5 (PostgreSQL 18)
  if (version < 900 || version > 9999) return { recovery: null, state: null, unknown: `pg_control version ${version}` };
  const state = b.readUInt32LE(16);
  if (state > LAST_STATE) return { recovery: null, state, unknown: `state ${state}` };
  return { recovery: state !== DB_SHUTDOWNED, state, unknown: null };
}

/** Was the database left open — will PostgreSQL replay its log before it opens? And when that cannot be told, why. */
export function readControl(dbDir: string): ControlState {
  let b: Buffer;
  try {
    b = readFileSync(join(dbDir, "global", "pg_control"));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return { recovery: null, state: null, unknown: code === "ENOENT" ? "no pg_control" : `unreadable: ${code ?? "error"}` };
  }
  return controlState(b);
}

/** readControl's verdict alone: true when the log is replayed first, null when that cannot be told. */
export function needsRecovery(dbDir: string): boolean | null {
  return readControl(dbDir).recovery;
}

/** What opening the data folder `dbDir` faces: nothing to replay when it holds no database yet (a first start, NO_DATABASE). */
export function inspectDatabase(dbDir: string): DatabaseOpening {
  if (!existsSync(join(dbDir, "PG_VERSION"))) return { walMb: 0, recovery: null, state: null, unknown: NO_DATABASE };
  return { walMb: walSizeMb(dbDir), ...readControl(dbDir) };
}

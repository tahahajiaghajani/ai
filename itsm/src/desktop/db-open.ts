// What opening the local database will face, read before PGlite touches the data folder (src/desktop/server.ts tells the
// Electron main process, which then waits for the open as long as it takes: @shared/desktop/ready-watch). PGlite has no
// checkpointer, so a database that was not closed cleanly replays its write-ahead log from the last checkpoint when it
// opens — synchronously, on the local server's only thread (an 888 MB log took 6.3 s on a Linux development machine, and a
// Windows laptop is slower). With fs alone and in milliseconds: one directory listing and the 8 KB control file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MB = 1024 * 1024;

/** pg_control's DBState (src/include/catalog/pg_control.h): DB_SHUTDOWNED and DB_SHUTDOWNED_IN_RECOVERY, a clean close. */
const SHUT_DOWN = new Set([1, 2]);
/** The last DBState (DB_IN_PRODUCTION): a higher value is not a control file this code knows. */
const LAST_STATE = 6;

export interface DatabaseOpening {
  /** size of pg_wal in MB (every file in it, the spare segments an older version recycled included) */
  walMb: number;
  /** true: not closed cleanly, the log is replayed first; false: closed cleanly; null: no database yet, or unknown */
  recovery: boolean | null;
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
 * Was the database left open — will PostgreSQL replay its log before it opens? The control file's `state`: a 32-bit enum
 * after the 8-byte system identifier and the two 32-bit version numbers (offset 16 in every PostgreSQL since 9.x;
 * little-endian, as WebAssembly writes it). null when there is no control file this code can read.
 */
export function needsRecovery(dbDir: string): boolean | null {
  try {
    const b = readFileSync(join(dbDir, "global", "pg_control"));
    if (b.length < 20) return null;
    const version = b.readUInt32LE(8); // PG_CONTROL_VERSION: 1800 in PGlite 0.5 (PostgreSQL 18)
    const state = b.readUInt32LE(16);
    if (version < 900 || version > 9999 || state > LAST_STATE) return null;
    return !SHUT_DOWN.has(state);
  } catch {
    return null;
  }
}

/** What opening the data folder `dbDir` faces: nothing to replay when it holds no database yet (a first start). */
export function inspectDatabase(dbDir: string): DatabaseOpening {
  if (!existsSync(join(dbDir, "PG_VERSION"))) return { walMb: 0, recovery: null };
  return { walMb: walSizeMb(dbDir), recovery: needsRecovery(dbDir) };
}

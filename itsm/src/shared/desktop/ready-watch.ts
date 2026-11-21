// How long the Windows app waits for its local server (desktop/src/main.ts), by what the server says it is doing
// (src/desktop/server.ts → backend-entry.ts → the `{ type: "phase" }` messages). Pure: the main process gives it the time.
//
// The local server opens its database on its only thread, synchronously (PGlite is PostgreSQL in WebAssembly). A database
// that was not closed cleanly — the app killed, the computer switched off — first replays its write-ahead log, and that
// takes as long as the log is long: seconds for megabytes, minutes for gigabytes (1.1.0-beta never bounded the log).
// Nothing else runs on that thread meanwhile, so the server cannot say it is alive. The main process used to give the
// whole start 90 s and then killed the server — and a recovery that is cut short starts again from its beginning at the
// next start, which was killed again: the app never opened again (an owner's app.log, 2026-11-11 to 2026-11-17). Now:
//   - before the server reports that it opens its database, and after it reports the database open, the start has
//     READY_BUDGET_MS without a sign of progress (a phase reported, a migration applied), as before;
//   - while the database opens there is no limit: the main process waits as long as the server's process lives (its
//     exit is reported as before), and tells the person what is going on — at once when a large log is replayed, after
//     NOTICE_AFTER_MS for a smaller one, after SLOW_NOTICE_AFTER_MS for an open that replays nothing (a clean database
//     on a slow disk, a first start unpacking the database made at build time, a restore);
//   - the migrations after the open have no fixed limit either: a migration over a large table (an index over a job
//     table a loop filled) can take minutes, and cutting it short repeats it at every start just the same. The person is
//     told after SLOW_NOTICE_AFTER_MS without a migration applied; only MIGRATIONS_CEILING_MS without one ends the start.

/** Without a sign of progress, outside the database's open: the server is taken to be stuck. */
export const READY_BUDGET_MS = 90_000;
/** A replay of the log this long is told to the person (a clean open takes a second or two). */
export const NOTICE_AFTER_MS = 8_000;
/** ... and an open that replays nothing, this long (a first start writes the template's files: 5–11 s on Windows CI). */
export const SLOW_NOTICE_AFTER_MS = 30_000;
/** A write-ahead log this large takes a while to replay: told at once (unless the database was closed cleanly). */
export const LARGE_WAL_MB = 256;
/** During the migrations, a start without a migration applied for this long is taken to be stuck. */
export const MIGRATIONS_CEILING_MS = 30 * 60_000;

/** What the local server reports on its way to "ready" (posted as `{ type: "phase", ...phase }`). */
export type StartPhase =
  | {
      phase: "database";
      /** size of the data folder's pg_wal (MB): what a recovery may have to replay */
      walMb: number;
      /** true: not closed cleanly, PostgreSQL replays the log first; false: closed cleanly; null: unknown or a new database */
      recovery: boolean | null;
    }
  | { phase: "migrations"; /** the database is compacted before ready (src/desktop/maintenance.ts) */ maintenance?: true };

export type StartStage = "starting" | StartPhase["phase"];

/** What the splash tells the person while the database opens. */
export interface StartNotice {
  /**
   * "recovery": the log of a database that was not closed cleanly is replayed; "slow": the open just takes long;
   * "update": a migration of the database after the open takes long
   */
  kind: "recovery" | "slow" | "update" | "maintenance";
  /** since the server began to open the database (for "update": since the migrations began) */
  elapsedMs: number;
}

export type StartVerdict = { kind: "wait"; notice: StartNotice | null } | { kind: "timeout"; stage: StartStage; silentMs: number };

export interface ReadyWatchOptions {
  budgetMs?: number;
  noticeAfterMs?: number;
  slowNoticeAfterMs?: number;
  largeWalMb?: number;
  migrationsCeilingMs?: number;
}

export interface ReadyWatch {
  /** where the start is */
  readonly stage: StartStage;
  /** the server reported a phase (a sign of progress) */
  phase(p: StartPhase, at: number): void;
  /** the server showed progress (a migration applied): its budget starts again */
  progress(at: number): void;
  /** what to do at `at`: wait (and what to tell), or give up */
  check(at: number): StartVerdict;
}

/** The watch of one start, from the fork of the server at `startedAt`. */
export function createReadyWatch(startedAt: number, options: ReadyWatchOptions = {}): ReadyWatch {
  const budget = options.budgetMs ?? READY_BUDGET_MS;
  const noticeAfter = options.noticeAfterMs ?? NOTICE_AFTER_MS;
  const slowNoticeAfter = options.slowNoticeAfterMs ?? SLOW_NOTICE_AFTER_MS;
  const largeWal = options.largeWalMb ?? LARGE_WAL_MB;
  const migrationsCeiling = options.migrationsCeilingMs ?? MIGRATIONS_CEILING_MS;
  let stage: StartStage = "starting";
  let lastSign = startedAt;
  let opening: { at: number; walMb: number; recovery: boolean | null } | null = null;
  let migratingSince: number | null = null;
  let maintainingSince: number | null = null;
  return {
    get stage() {
      return stage;
    },
    phase(p, at) {
      stage = p.phase;
      lastSign = Math.max(lastSign, at);
      opening = p.phase === "database" ? { at, walMb: p.walMb, recovery: p.recovery } : null;
      migratingSince = p.phase === "migrations" ? at : null;
      maintainingSince = p.phase === "migrations" && p.maintenance ? at : null;
    },
    progress(at) {
      lastSign = Math.max(lastSign, at);
    },
    check(at) {
      if (opening) {
        const elapsedMs = Math.max(0, at - opening.at);
        // a large log of a database not known to be closed cleanly: told at once; otherwise once the open takes long
        const large = opening.walMb >= largeWal && opening.recovery !== false;
        const recovery = opening.recovery === true || (opening.recovery === null && large);
        if (!large && elapsedMs < (recovery ? noticeAfter : slowNoticeAfter)) return { kind: "wait", notice: null };
        return { kind: "wait", notice: { kind: recovery ? "recovery" : "slow", elapsedMs } };
      }
      const silentMs = at - lastSign;
      if (migratingSince !== null) {
        // the migrations: no fixed limit while one runs, a note once one takes long, a stop only after a long silence
        if (silentMs >= migrationsCeiling) return { kind: "timeout", stage, silentMs };
        if (maintainingSince !== null) return { kind: "wait", notice: { kind: "maintenance", elapsedMs: Math.max(0, at - maintainingSince) } };
        return { kind: "wait", notice: silentMs >= slowNoticeAfter ? { kind: "update", elapsedMs: Math.max(0, at - migratingSince) } : null };
      }
      return silentMs >= budget ? { kind: "timeout", stage, silentMs } : { kind: "wait", notice: null };
    },
  };
}

/** A `{ type: "phase" }` message from the server's process, checked (anything else: null). */
export function parseStartPhase(m: unknown): StartPhase | null {
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (o.type !== "phase") return null;
  if (o.phase === "migrations") return o.maintenance === true ? { phase: "migrations", maintenance: true } : { phase: "migrations" };
  if (o.phase !== "database") return null;
  const walMb = typeof o.walMb === "number" && Number.isFinite(o.walMb) && o.walMb > 0 ? Math.round(o.walMb) : 0;
  const recovery = typeof o.recovery === "boolean" ? o.recovery : null;
  return { phase: "database", walMb, recovery };
}

/**
 * How many steps of the database's update a chunk of the server's output reports: src/server/db/migrate.ts logs
 * "migration <id> applied" for each migration and "schema step <id> applied" for the engine's chunks, and
 * src/desktop/maintenance.ts "maintenance step <id> applied" for each step of a compaction — each one a sign of progress.
 */
export function countProgress(text: string): number {
  return (text.match(/(?:migration|schema step|maintenance step) \S+ applied/g) ?? []).length;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (s: string) => s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
const two = (n: number) => String(n).padStart(2, "0");

/** A duration as the splash shows it, in Persian digits: ۰:۰۸, ۱۲:۳۴, ۱:۰۲:۰۵. */
export function elapsedFa(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return fa(h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`);
}

/** The note under the product's name while the database opens. */
export const NOTICE_TEXT: Record<StartNotice["kind"], string> = {
  recovery: "پایگاه داده پس از بسته شدن ناگهانی برنامه در حال بازیابی است؛ بسته به حجم آن ممکن است چند دقیقه طول بکشد. لطفاً برنامه را نبندید.",
  slow: "باز شدن پایگاه داده بیش از معمول زمان می‌برد و ممکن است چند دقیقه طول بکشد. لطفاً برنامه را نبندید.",
  update: "به‌روزرسانی پایگاه داده برای این نسخه بیش از معمول زمان می‌برد و ممکن است چند دقیقه طول بکشد. لطفاً برنامه را نبندید.",
  maintenance: "پایگاه داده در حال فشرده‌سازی است تا فضایی که داده‌های پاک‌شده روی دیسک گرفته‌اند آزاد شود؛ بسته به حجم آن ممکن است چند دقیقه طول بکشد. لطفاً برنامه را نبندید.",
};

/**
 * The splash's two texts for a notice: the note, and the status line with the time that has gone by (`base` is the
 * status line the start began with, e.g. «باز کردن داده‌ها…»).
 */
export function noticeTexts(n: StartNotice, base: string): { note: string; status: string } {
  const label = n.kind === "recovery" ? "بازیابی پایگاه داده…" : n.kind === "update" ? "به‌روزرسانی داده‌ها…" : n.kind === "maintenance" ? "فشرده‌سازی پایگاه داده…" : base;
  return { note: NOTICE_TEXT[n.kind], status: `${label} ${elapsedFa(n.elapsedMs)}` };
}

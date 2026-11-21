// How long the Windows app waits for its local server (desktop/src/main.ts), by what the server says it is doing
// (src/desktop/server.ts → backend-entry.ts → the `{ type: "phase" }` messages). Pure: the main process gives it the time.
//
// The local server opens its database on its only thread, synchronously (PGlite is PostgreSQL in WebAssembly). A database
// that was not closed cleanly — a forced close, a killed process — first replays its write-ahead log, and that takes as
// long as the log is long: seconds for megabytes, minutes for gigabytes (1.1.0-beta never bounded the log). After a power
// cut or a Windows crash that recovery may fail: PGlite runs with fsync off, so what reached the disk, and in which order,
// is not guaranteed. Nothing else runs on that thread meanwhile, so the server cannot say it is alive. The main process
// used to give the whole start 90 s and then killed the server — and a recovery that is cut short starts again from its
// beginning at the next start, which was killed again: the app never opened again (an owner's app.log, 2026-11-11 to
// 2026-11-17). Now:
//   - only before the server reports that it opens its database, READY_BUDGET_MS without a sign of it bring up a
//     question — wait on, run the app again, or quit —, never a stop decided for the person (a slow or just switched-on
//     computer, or an antivirus scan of the app's files, can hold that part of the start too): «wait» starts the budget
//     again, and a phase reported meanwhile withdraws the question;
//   - while the database opens there is no limit: the main process waits as long as the server's process lives (its
//     exit is reported as before), and tells the person what is going on — at once when a large log is replayed, after
//     NOTICE_AFTER_MS for a smaller one, after SLOW_NOTICE_AFTER_MS for an open that replays nothing (a clean database
//     on a slow disk, a first start unpacking the database made at build time, a restore);
//   - from the migrations to ready there is no fixed limit either: a migration over a large table (an index over a job
//     table a loop filled) can take minutes, and cutting it short repeats it at every start just the same. The person is
//     told after SLOW_NOTICE_AFTER_MS without a migration or schema step applied (countProgress), and asked whether to
//     wait on only after MIGRATIONS_CEILING_MS without one.
// Every time passed in comes from a monotonic clock (performance.now() in the main process): a step of the system clock —
// Windows Time correcting a drifted laptop — must neither end a healthy start nor stretch a stuck one.

/** Before the database's open, this long without a sign of progress: the person is asked whether to wait on. */
export const READY_BUDGET_MS = 90_000;
/** A replay of the log this long is told to the person (a clean open takes a second or two). */
export const NOTICE_AFTER_MS = 8_000;
/** ... and an open that replays nothing, this long (a first start writes the template's files: 5–11 s on Windows CI). */
export const SLOW_NOTICE_AFTER_MS = 30_000;
/** A write-ahead log this large takes a while to replay: told at once (unless the database was closed cleanly). */
export const LARGE_WAL_MB = 256;
/** From the migrations to ready, this long without a migration or schema step applied: the person is asked. */
export const MIGRATIONS_CEILING_MS = 30 * 60_000;

/** What the local server reports on its way to "ready" (posted as `{ type: "phase", ...phase }`). */
export type StartPhase =
  | {
      phase: "database";
      /** size of the data folder's pg_wal (MB): what a recovery may have to replay */
      walMb: number;
      /** true: not closed cleanly, PostgreSQL replays the log first; false: closed cleanly; null: unknown or a new database */
      recovery: boolean | null;
      /**
       * true: a scheduled restore — the open reads a backup and loads it in place of the data folder, which it sets aside
       * first. A restore cut short is not done again at the next start (src/desktop/backup.ts), so closing the splash
       * meanwhile is asked about in its own words (CLOSE_TEXT.restore)
       */
      restore?: true;
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

/**
 * "wait": go on waiting (and what to tell); "timeout": no sign for too long — the caller asks the person whether to wait
 * on (STALL_TEXT), and `progress()` after a «wait» starts the budget again.
 */
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
  /** while the database opens: whether it replays its log first (a recovery, as far as the server could tell) */
  readonly recovering: boolean;
  /** while the database opens: whether the open is a scheduled restore's (the phase's `restore`) */
  readonly restoring: boolean;
  /** the server reported a phase (a sign of progress) */
  phase(p: StartPhase, at: number): void;
  /** the server showed progress (a migration or schema step applied), or the person chose to wait on: the budget starts again */
  progress(at: number): void;
  /** what to do at `at`: wait (and what to tell), or ask the person */
  check(at: number): StartVerdict;
}

/** The watch of one start, from the fork of the server at `startedAt` (a monotonic clock's time, like every `at`). */
export function createReadyWatch(startedAt: number, options: ReadyWatchOptions = {}): ReadyWatch {
  const budget = options.budgetMs ?? READY_BUDGET_MS;
  const noticeAfter = options.noticeAfterMs ?? NOTICE_AFTER_MS;
  const slowNoticeAfter = options.slowNoticeAfterMs ?? SLOW_NOTICE_AFTER_MS;
  const largeWal = options.largeWalMb ?? LARGE_WAL_MB;
  const migrationsCeiling = options.migrationsCeilingMs ?? MIGRATIONS_CEILING_MS;
  let stage: StartStage = "starting";
  let lastSign = startedAt;
  let opening: { at: number; walMb: number; recovery: boolean | null; restore: boolean } | null = null;
  let migratingSince: number | null = null;
  /** a large log of a database not known to be closed cleanly */
  const large = (o: { walMb: number; recovery: boolean | null }) => o.walMb >= largeWal && o.recovery !== false;
  /** a recovery: not closed cleanly, or a large log of a database whose state cannot be told */
  const replays = (o: { walMb: number; recovery: boolean | null }) => o.recovery === true || (o.recovery === null && large(o));
  let maintainingSince: number | null = null;
  return {
    get stage() {
      return stage;
    },
    get recovering() {
      return !!opening && replays(opening);
    },
    get restoring() {
      return !!opening?.restore;
    },
    phase(p, at) {
      stage = p.phase;
      lastSign = Math.max(lastSign, at);
      opening = p.phase === "database" ? { at, walMb: p.walMb, recovery: p.recovery, restore: p.restore === true } : null;
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
        const recovery = replays(opening);
        if (!large(opening) && elapsedMs < (recovery ? noticeAfter : slowNoticeAfter)) return { kind: "wait", notice: null };
        return { kind: "wait", notice: { kind: recovery ? "recovery" : "slow", elapsedMs } };
      }
      const silentMs = at - lastSign;
      if (migratingSince !== null) {
        // from the migrations to ready: no fixed limit while one runs, a note once one takes long, a question only after
        // a long silence
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
  return { phase: "database", walMb, recovery, ...(o.restore === true ? { restore: true as const } : {}) };
}

/**
 * How many steps of the database's update a chunk of the server's output reports: src/server/db/migrate.ts logs
 * "migration <id> applied" for each migration and "schema step <id> applied" for the engine's chunks and every reconcile
 * chunk — each one a sign of progress.
 */
export function countProgress(text: string): number {
  return (text.match(/(?:migration|schema step) \S+ applied/g) ?? []).length;
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

/**
 * The question of a "timeout" verdict, by its stage ("starting" before the open, "migrations" after it); the main process
 * adds the path of app.log. The time each one names is its budget's.
 */
export const STALL_TEXT = {
  starting: {
    message: "سرور داخلی برنامه هنوز پاسخ نداده است",
    detail: `${fa(String(READY_BUDGET_MS / 1000))} ثانیه است که سرور داخلی خبری نداده است؛ روی رایانهٔ کند یا تازه‌روشن‌شده، یا وقتی ضدویروس فایل‌های برنامه را بررسی می‌کند، ممکن است بیشتر طول بکشد. اگر صبر کنید، برنامه خودش ادامه می‌دهد.`,
  },
  migrations: {
    message: "به‌روزرسانی پایگاه داده پیش نمی‌رود",
    detail: `${fa(String(MIGRATIONS_CEILING_MS / 60_000))} دقیقه است که هیچ مرحله‌ای از به‌روزرسانی پایگاه داده تمام نشده است. می‌توانید باز هم صبر کنید؛ اگر ببندید، مرحلهٔ نیمه‌کاره در اجرای بعدی از نو انجام می‌شود.`,
  },
} as const;
/** Its answers: 0 waits on (also Esc, and a question withdrawn because the server spoke again), 1 runs the app again, 2 quits. */
export const STALL_BUTTONS: readonly string[] = ["صبر می‌کنم", "اجرای دوباره", "خروج"];

/**
 * The question before the splash closes while the database opens or is updated: closing then stops the server midway (it
 * cannot hear a request to stop before it is ready, src/desktop/backend-entry.ts), so a recovery starts over at the next
 * start and a migration is redone.
 */
export const CLOSE_TEXT = {
  database: {
    message: "پایگاه داده هنوز در حال باز شدن است",
    /** while its log is replayed (ReadyWatch.recovering) */
    recovery: "پایگاه داده پس از بسته شدن ناگهانی برنامه در حال بازیابی است. اگر اکنون ببندید، بازیابی در اجرای بعدی از اول آغاز می‌شود. بهتر است صبر کنید تا برنامه باز شود.",
    otherwise: "اگر اکنون ببندید، باز کردن پایگاه داده در اجرای بعدی از نو انجام می‌شود.",
  },
  migrations: {
    message: "به‌روزرسانی پایگاه داده هنوز تمام نشده است",
    detail: "اگر اکنون ببندید، مرحلهٔ نیمه‌کارهٔ به‌روزرسانی در اجرای بعدی از نو انجام می‌شود.",
  },
  /**
   * while a scheduled restore loads its backup (ReadyWatch.restoring): unlike an open, a restore cut short is not done
   * again — its marker is gone and the database folder set aside, so the next start finds no database (a first start)
   * or half of one
   */
  restore: {
    message: "بازگردانی نسخهٔ پشتیبان هنوز تمام نشده است",
    detail: "اگر اکنون ببندید، بازگردانی نیمه‌کاره می‌ماند و ممکن است برنامه در اجرای بعدی باز نشود یا بی‌داده باز شود. بهتر است صبر کنید تا برنامه باز شود.",
  },
} as const;
/** Its answers: 0 keeps the splash (also Esc, and a question withdrawn because the start ended), 1 closes the app. */
export const CLOSE_BUTTONS: readonly string[] = ["صبر می‌کنم", "بستن برنامه"];

/** The close question's two texts for the stage the start is in (and, while the database opens, what the open is). */
export function closeQuestion(stage: "database" | "migrations", recovering: boolean, restoring = false): { message: string; detail: string } {
  if (stage === "migrations") return CLOSE_TEXT.migrations;
  if (restoring) return CLOSE_TEXT.restore;
  return { message: CLOSE_TEXT.database.message, detail: recovering ? CLOSE_TEXT.database.recovery : CLOSE_TEXT.database.otherwise };
}

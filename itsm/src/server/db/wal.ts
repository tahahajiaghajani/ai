// The write-ahead log of a PGlite data folder, kept small (docs/PERFORMANCE_FA.md §15).
//
// PGlite runs PostgreSQL as one standalone backend: there is no checkpointer process, and the WAL-volume trigger in
// XLogWrite only asks for a checkpoint under a postmaster. So nothing checkpoints while the Windows app runs: pg_wal grows
// until the database closes (2 GB in 2.5 hours on a QA server), a crash or a forced quit replays all of it at the next
// start, and every backup (a tarball of the folder built in memory) carries it. For every data folder `createPgliteDb`
// opens (never the in-memory databases of the tests):
//   - small `max_wal_size` / `min_wal_size` (how much a checkpoint keeps for reuse): start parameters, in force at once —
//     also on a folder an older version made —, and persisted in the folder's postgresql.auto.conf (`ALTER SYSTEM`;
//     pg_reload_conf() has no effect in PGlite, so the file alone would only count from the next start);
//   - a checkpoint after open (after walking the log through the spare segments an older version recycled ahead of it,
//     which no checkpoint removes while they are ahead), before every dump (backup), before close, and while running:
//     once `volumeBytes` of log were written since the last one, or `maxAgeMs` after the first write since it, as soon as
//     the database has been idle for `idleMs`; past `hardBytes` at once;
//   - a checkpoint goes through PGlite's public exec(), which waits for an open transaction to end: never inside one.
import type { Logger } from "../context";

const MB = 1024 * 1024;
/** PostgreSQL's WAL segment (PGlite keeps the default). */
export const WAL_SEGMENT_BYTES = 16 * MB;

/**
 * What a checkpoint keeps of the log for reuse, in MB (PostgreSQL's minimum is two segments): after a checkpoint pg_wal
 * holds at most `max` of recycled segments plus what was written since.
 */
export const WAL_LIMITS_MB = { max_wal_size: 64, min_wal_size: 32 } as const;

/** Start parameters of a PGlite data folder: PGlite's own, then the limits above (`-c` wins over the config files). */
export function walStartParams(base: readonly string[]): string[] {
  return [...base, ...Object.entries(WAL_LIMITS_MB).flatMap(([name, mb]) => ["-c", `${name}=${mb}MB`])];
}

export interface WalPg {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

/** The scheduler's clock (tests drive a fake one). */
export interface WalClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: WalClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface WalGuardOptions {
  clock?: WalClock;
  log?: Pick<Logger, "info" | "warn">;
  /** checkpoint (when idle) once this much log was written since the last checkpoint */
  volumeBytes?: number;
  /** ... and at once, idle or not, past this much */
  hardBytes?: number;
  /** ... or this long after the first write since the last checkpoint (bounds the replay after a crash) */
  maxAgeMs?: number;
  /** less log than this since the last checkpoint is not «writes» (the checkpoint's own records) */
  dirtyBytes?: number;
  /** the database counts as idle after this long without a statement of the app */
  idleMs?: number;
  /** how often the scheduler looks at the log */
  pollMs?: number;
  /** ... once the log is past half of `volumeBytes` (so a burst of writes meets `hardBytes` promptly) */
  busyPollMs?: number;
  /** how often it looks for an idle moment once a checkpoint is due */
  idleCheckMs?: number;
}

/**
 * The scheduler's defaults, from the bank pack «کوچک» (scripts/perf-pglite-wal.mjs and the installed app's run of
 * scripts/desktop-e2e.mjs): a checkpoint after 32 MB of log took 35–230 ms; the app's job timer leaves the database idle
 * for 2 s of every 10 even while the pack loads, so the idle-time checkpoint is the usual one; under writes with no pause
 * at all the hard limit keeps pg_wal near 64 MB of new log (plus what a look every 2 s lets through) and the recycled
 * segments. A look is one tiny query.
 */
export const WAL_DEFAULTS = {
  volumeBytes: 32 * MB,
  hardBytes: 64 * MB,
  maxAgeMs: 5 * 60_000,
  dirtyBytes: 64 * 1024,
  idleMs: 1000,
  pollMs: 2000,
  busyPollMs: 250,
  idleCheckMs: 250,
} as const;

export interface CheckpointInfo {
  reason: string;
  /** how long the checkpoint held the database */
  ms: number;
  /** log written since the previous checkpoint (bytes) */
  bytes: number;
}

export interface WalStats {
  checkpoints: number;
  total_ms: number;
  max_ms: number;
  last: (CheckpointInfo & { at: number }) | null;
}

export interface WalGuard {
  /** Wraps one call of the app into the database: while any is running or waiting the database is not idle. */
  track<T>(fn: () => Promise<T>): Promise<T>;
  /** CHECKPOINT now (after an open transaction ends); concurrent callers share one. */
  checkpoint(reason: string): Promise<CheckpointInfo>;
  /** The scheduler. */
  start(): void;
  stop(): void;
  stats(): WalStats;
}

/** Log written since the last checkpoint's redo point: what a crash would replay. */
const SINCE_SQL = `select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), (pg_control_checkpoint()).redo_lsn)::float8 as d`;

export async function walSinceCheckpoint(pg: WalPg): Promise<number> {
  const r = await pg.query<{ d: number | string }>(SINCE_SQL);
  return Number(r.rows[0]?.d ?? 0);
}

export function createWalGuard(pg: WalPg, options: WalGuardOptions = {}): WalGuard {
  const o = { ...WAL_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as typeof WAL_DEFAULTS & WalGuardOptions;
  const clock = options.clock ?? systemClock;
  const log = options.log;
  let inflight = 0;
  let lastActivity = clock.now();
  let dirtySince: number | null = null;
  let due: string | null = null;
  let lastPoll = -Infinity;
  /** the log since the last checkpoint at the last look */
  let last = 0;
  let timer: unknown = null;
  let stopped = true;
  let running: Promise<CheckpointInfo> | null = null;
  const stats: WalStats = { checkpoints: 0, total_ms: 0, max_ms: 0, last: null };

  const idle = () => inflight === 0 && clock.now() - lastActivity >= o.idleMs;
  const schedule = (ms: number) => {
    if (!stopped) timer = clock.setTimeout(() => void step(), ms);
  };

  /** how long until the scheduler looks at the log again: sooner once it has grown past half the volume */
  const pollEvery = () => (last >= o.volumeBytes / 2 ? o.busyPollMs : o.pollMs);
  let stepping = false;

  async function step() {
    if (stepping || stopped) return;
    stepping = true;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    try {
      if (clock.now() - lastPoll >= pollEvery()) {
        const d = await walSinceCheckpoint(pg);
        lastPoll = clock.now();
        last = d;
        if (stopped) return;
        if (d < o.dirtyBytes) dirtySince = null;
        else dirtySince ??= clock.now();
        if (d >= o.hardBytes) {
          due = null;
          await guard.checkpoint("volume");
          return;
        }
        due = d >= o.volumeBytes ? "volume" : dirtySince !== null && clock.now() - dirtySince >= o.maxAgeMs ? "age" : null;
      }
      if (due && idle()) {
        const reason = due;
        due = null;
        await guard.checkpoint(reason);
      }
    } catch (e) {
      if (!stopped) log?.warn("database checkpoint failed", String((e as Error)?.message ?? e));
    } finally {
      stepping = false;
      if (timer === null) schedule(due ? Math.min(o.idleCheckMs, pollEvery()) : pollEvery());
    }
  }

  /**
   * After each call of the app: a look at the log when one is due. PGlite answers through promises alone, so a run of
   * database work (a job tick, a demo load) keeps Node's timers from firing until it pauses; the hard limit must not
   * wait for that pause.
   */
  const kick = () => {
    if (!stopped && !stepping && clock.now() - lastPoll >= pollEvery()) void step();
  };

  const guard: WalGuard = {
    async track<T>(fn: () => Promise<T>): Promise<T> {
      inflight++;
      lastActivity = clock.now();
      try {
        return await fn();
      } finally {
        inflight--;
        lastActivity = clock.now();
        kick();
      }
    },
    checkpoint(reason: string): Promise<CheckpointInfo> {
      running ??= (async () => {
        const bytes = await walSinceCheckpoint(pg).catch(() => 0);
        const t0 = performance.now();
        await pg.exec("CHECKPOINT");
        const info: CheckpointInfo = { reason, ms: Math.round(performance.now() - t0), bytes };
        dirtySince = null;
        last = 0;
        stats.checkpoints++;
        stats.total_ms += info.ms;
        stats.max_ms = Math.max(stats.max_ms, info.ms);
        stats.last = { ...info, at: clock.now() };
        log?.info("database checkpoint", { reason, ms: info.ms, wal_mb: +(bytes / MB).toFixed(1) });
        return info;
      })().finally(() => {
        running = null;
      });
      return running;
    },
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(o.pollMs);
    },
    stop() {
      stopped = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
    stats: () => ({ ...stats, last: stats.last ? { ...stats.last } : null }),
  };
  return guard;
}

// ------------------------------------------------------------------------------------------------ at open

const SEGMENT = /^[0-9A-F]{24}$/;

export interface WalOpenReport {
  /** the limits were written to postgresql.auto.conf now (a folder of an older version) */
  persisted: boolean;
  /** spare segments ahead of the log walked through (an older version recycled them for reuse) */
  walked: number;
  segments_before: number;
  segments_after: number;
  ms: number;
}

/** WAL segment files of a pg_wal folder on disk. */
export function walSegments(pgWal: string, readdir: (p: string) => string[]): string[] {
  try {
    return readdir(pgWal).filter((f) => SEGMENT.test(f)).sort();
  } catch {
    return [];
  }
}

/**
 * Right after PGlite opened a data folder (nothing else uses it yet): the limits persisted, the spare segments an older
 * version left ahead of the log walked through, and a checkpoint, which removes what is beyond the limits.
 */
export async function openWal(pg: WalPg, pgWal: string, readdir: (p: string) => string[]): Promise<WalOpenReport> {
  const t0 = performance.now();
  const before = walSegments(pgWal, readdir);
  // ALTER SYSTEM refuses to run in a transaction block (a multi-statement query is one): one statement each
  const conf = await pg.query<{ name: string; setting: string }>(
    `select name, setting from pg_file_settings where sourcefile like '%postgresql.auto.conf' and name in ('max_wal_size', 'min_wal_size') and error is null`,
  );
  const have = new Map(conf.rows.map((r) => [r.name, r.setting.replace(/^'|'$/g, "")]));
  let persisted = false;
  for (const [name, mb] of Object.entries(WAL_LIMITS_MB)) {
    if (have.get(name) === `${mb}MB`) continue;
    await pg.query(`alter system set ${name} = '${mb}MB'`);
    persisted = true;
  }
  // a segment after the current one is a spare: an older version kept up to 1 GB of them, and a checkpoint only
  // removes segments behind the log. A tiny record and a switch per surplus spare (≈ 10 ms each) puts them behind it.
  const current = (await pg.query<{ f: string }>(`select pg_walfile_name(pg_current_wal_insert_lsn()) as f`)).rows[0]?.f ?? "";
  // a checkpoint itself recycles up to max_wal_size ahead of its redo point: keep that many, walk the rest
  const keep = Math.max(1, WAL_LIMITS_MB.max_wal_size / (WAL_SEGMENT_BYTES / MB) - 1);
  const spare = current ? before.filter((f) => f.slice(0, 8) === current.slice(0, 8) && f > current).length : 0;
  const walked = Math.max(0, spare - keep);
  for (let i = 0; i < walked; i++) await pg.query(`select pg_logical_emit_message(false, 'kariz', 'wal'), pg_switch_wal()`);
  await pg.exec("CHECKPOINT");
  return { persisted, walked, segments_before: before.length, segments_after: walSegments(pgWal, readdir).length, ms: Math.round(performance.now() - t0) };
}

// The one background-job scheduler of the server edition. Every worker is a candidate; the one that takes a
// PostgreSQL session advisory lock (on a dedicated connection) is the leader and alone calls the job queue's `tick` —
// the same tick the web version runs from its cron. Jobs are still claimed with FOR UPDATE SKIP LOCKED, so even a
// stale leader would never run a job twice. When the leader dies its connection closes, PostgreSQL releases the lock
// and another worker takes over within `retryMs`. A write that queued jobs wakes the leader at once with
// NOTIFY itsm_tick (cfg.waitUntil), so record events run within moments instead of the next interval. The leader also
// runs the leader-only chores (scheduled backups).
import postgres from "postgres";
import type { TickResult } from "@server/jobs";
import type { Logger } from "@server/context";

/** Advisory lock key of the scheduler (migrations use 724100). */
export const LEADER_LOCK_KEY = 724150;
export const WAKE_CHANNEL = "itsm_tick";

export interface LeaderLock {
  /** try to become the leader; true while this process holds the lock */
  tryAcquire(): Promise<boolean>;
  /** is the lock still held (its connection alive)? */
  check(): Promise<boolean>;
  release(): Promise<void>;
  /** wake-ups from other workers; returns a function that stops listening */
  listen(onWake: () => void): Promise<() => Promise<void>>;
  /** wake the leader (from any worker) */
  notify(): Promise<void>;
  close(): Promise<void>;
}

/** The PostgreSQL lock: a reserved connection holds pg_try_advisory_lock; LISTEN/NOTIFY wakes the leader. */
export function postgresLock(url: string, opts: { ssl?: boolean } = {}): LeaderLock {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 0,
    max_lifetime: null,
    connect_timeout: 10,
    ssl: opts.ssl ? "require" : false,
    onnotice: () => {},
    connection: { application_name: "itsm-scheduler" },
  });
  let held: postgres.ReservedSql | null = null;
  const drop = () => {
    try {
      held?.release();
    } catch {
      /* already gone */
    }
    held = null;
  };
  return {
    async tryAcquire() {
      if (held) return true;
      const conn = await sql.reserve();
      try {
        const [r] = await conn`select pg_try_advisory_lock(${LEADER_LOCK_KEY}) as ok`;
        if (r?.ok) {
          held = conn;
          return true;
        }
      } catch {
        /* not the leader this time */
      }
      conn.release();
      return false;
    },
    async check() {
      if (!held) return false;
      try {
        const [r] = await held`select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = ${LEADER_LOCK_KEY} and pid = pg_backend_pid() and granted`;
        if (Number(r?.n) > 0) return true;
      } catch {
        /* the connection is gone: so is the lock */
      }
      drop();
      return false;
    },
    async release() {
      if (!held) return;
      try {
        await held`select pg_advisory_unlock(${LEADER_LOCK_KEY})`;
      } catch {
        /* closing the connection releases it too */
      }
      drop();
    },
    async listen(onWake) {
      const sub = await sql.listen(WAKE_CHANNEL, () => onWake());
      return async () => {
        await sub.unlisten().catch(() => undefined);
      };
    },
    async notify() {
      await sql.notify(WAKE_CHANNEL, "");
    },
    async close() {
      drop();
      await sql.end({ timeout: 5 }).catch(() => undefined);
    },
  };
}

export interface SchedulerOptions {
  lock: LeaderLock;
  /** the job queue's tick (bounded by its own budget) */
  tick: () => Promise<TickResult>;
  log: Logger;
  /** pause between ticks when nothing is due (ms) */
  intervalMs: number;
  /** how often a follower tries to become the leader (ms) */
  retryMs?: number;
  /** the leader's chores, called about once a minute while leading (scheduled backups) */
  chores?: () => Promise<void>;
  onLeadership?: (leader: boolean) => void;
  onTick?: (r: TickResult, ms: number) => void;
}

export class Scheduler {
  private leader = false;
  private stopped = true;
  private timer: NodeJS.Timeout | null = null;
  private wakeTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private unlisten: (() => Promise<void>) | null = null;
  private lastChores = 0;
  private choresRunning = false;
  private lastNotify = 0;

  constructor(private o: SchedulerOptions) {}

  get isLeader() {
    return this.leader;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(Math.floor(Math.random() * 500));
  }

  /** Wake the scheduler soon: the leader ticks, a follower tells the leader (at most every 250 ms). */
  wake() {
    if (this.stopped) return;
    if (this.leader) {
      if (!this.running) this.schedule(20);
      return;
    }
    const now = Date.now();
    if (now - this.lastNotify < 250) return;
    this.lastNotify = now;
    void this.o.lock.notify().catch(() => undefined);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.step().finally(() => {
        this.running = null;
      });
    }, ms);
    this.timer.unref?.();
  }

  private setLeader(v: boolean) {
    if (this.leader === v) return;
    this.leader = v;
    this.o.log.info(v ? "scheduler: this worker is now the leader" : "scheduler: leadership lost");
    this.o.onLeadership?.(v);
  }

  private async step(): Promise<void> {
    const retry = this.o.retryMs ?? 5000;
    try {
      if (!this.leader) {
        const won = await this.o.lock.tryAcquire().catch(() => false);
        if (!won) return this.schedule(retry + Math.floor(Math.random() * 1000));
        this.setLeader(true);
        this.unlisten = await this.o.lock
          .listen(() => {
            if (this.leader && !this.running && !this.wakeTimer) {
              // coalesce a burst of wake-ups into one tick
              this.wakeTimer = setTimeout(() => {
                this.wakeTimer = null;
                if (!this.running) this.schedule(0);
              }, 50);
            }
          })
          .catch((e) => {
            this.o.log.warn("scheduler: LISTEN failed; ticking on the interval only", String((e as Error)?.message ?? e));
            return null;
          });
      } else if (!(await this.o.lock.check())) {
        await this.stepDown();
        return this.schedule(retry);
      }
      const t0 = Date.now();
      const r = await this.o.tick();
      this.o.onTick?.(r, Date.now() - t0);
      if (Date.now() - this.lastChores > 60_000 && this.o.chores && !this.choresRunning) {
        this.lastChores = Date.now();
        this.choresRunning = true;
        void this.o
          .chores()
          .catch((e) => this.o.log.error("scheduler: chores failed", String((e as Error)?.message ?? e)))
          .finally(() => {
            this.choresRunning = false;
          });
      }
      this.schedule(r.more ? 0 : r.busy ? 1000 : this.o.intervalMs);
    } catch (e) {
      this.o.log.error("scheduler: tick failed", String((e as Error)?.message ?? e));
      this.schedule(Math.max(1000, this.o.intervalMs));
    }
  }

  private async stepDown() {
    this.setLeader(false);
    const u = this.unlisten;
    this.unlisten = null;
    await u?.().catch(() => undefined);
    await this.o.lock.release().catch(() => undefined);
  }

  /** Stop: wait for a running tick (at most `waitMs`), give up the lock and close its connection. */
  async stop(waitMs = 10_000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.timer = this.wakeTimer = null;
    if (this.running) await Promise.race([this.running, new Promise((r) => setTimeout(r, waitMs).unref?.())]);
    if (this.leader) await this.stepDown();
    await this.o.lock.close().catch(() => undefined);
  }
}

/** The next run of a daily «HH:MM» schedule after `from` (local time of the server). */
export function nextDaily(time: string, from = new Date()): Date {
  const [h, m] = time.split(":").map(Number);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

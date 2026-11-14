// Requests people are waiting for, across the server edition's workers — so the job runner gives way to them.
//
// Only the scheduler leader runs jobs (four at once, back to back while the queue has work), on the same database as
// every worker's requests. While a backlog drains — the bank demo pack «متوسط» leaves about 7,400 jobs — a page's
// requests on any worker compete with the jobs' statements for PostgreSQL's CPU, and on the leader also for its pool
// and its event loop: the administrator's demo incident record took 1.7–3.6 s in bank-sim, its «رخدادهای مشابه» panel
// alone 1.2–2.3 s while its full-text ranking statement ran 1.5–1.8 s in the database (PERFORMANCE_FA §18).
//
// Each worker counts the requests in flight that a person is waiting for (`ForegroundGate`: the API, its background
// polling aside — isBackgroundRequest) and tells the supervisor when it starts and stops having any; the supervisor
// (`ForegroundBoard`) tells every worker whether any worker has. The leader's job runner asks `busy()` before each round
// of jobs (TickOptions.busy, src/server/jobs/index.ts) and waits while it is true — at most YIELD_MS each time, so a
// server in constant use still runs every job, only more slowly. Nothing else changes: the same jobs run, in the same
// order.

/** How long a worker stays «busy» after its last foreground request ended: the gaps between a page's waves of requests. */
export const FOREGROUND_LINGER_MS = 300;

/** A worker's side: its foreground requests in flight and what the other workers have (from the supervisor). */
export class ForegroundGate {
  private local = 0;
  private others = false;
  private reported = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param report tells the supervisor this worker has foreground requests (true) or has had none for `lingerMs` (false);
   *   a standalone server (no supervisor) passes nothing
   */
  constructor(
    private readonly report: (busy: boolean) => void = () => {},
    private readonly lingerMs = FOREGROUND_LINGER_MS,
  ) {}

  /** A foreground request starts. */
  started(): void {
    this.local++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.reported) {
      this.reported = true;
      this.report(true);
    }
  }

  /** A foreground request ended (answered, failed or cut). */
  ended(): void {
    this.local = Math.max(0, this.local - 1);
    if (this.local > 0 || !this.reported || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.local === 0 && this.reported) {
        this.reported = false;
        this.report(false);
      }
    }, this.lingerMs);
    this.timer.unref?.();
  }

  /** What the supervisor says: some worker has foreground requests (possibly this one). */
  setCluster(busy: boolean): void {
    this.others = busy;
  }

  /** Is someone waiting for an answer? (this worker now or within its linger, or any worker as the supervisor knows it) */
  readonly busy = (): boolean => this.local > 0 || this.reported || this.others;

  /** Requests of this worker in flight (tests, «سلامت سرور»). */
  get inFlight(): number {
    return this.local;
  }

  /** Stop the linger timer (the worker closes). */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** The supervisor's side: which workers have foreground requests. */
export class ForegroundBoard {
  private readonly busy = new Set<number>();

  /**
   * A worker says it has (or no longer has) foreground requests. Returns the cluster's state when it changed — what
   * to tell every worker — or null when it did not.
   */
  set(worker: number, on: boolean): boolean | null {
    const before = this.busy.size > 0;
    if (on) this.busy.add(worker);
    else this.busy.delete(worker);
    const after = this.busy.size > 0;
    return before === after ? null : after;
  }

  /** A worker exited: it waits for nothing any more. */
  gone(worker: number): boolean | null {
    return this.set(worker, false);
  }

  /** Does any worker have foreground requests? */
  get any(): boolean {
    return this.busy.size > 0;
  }
}

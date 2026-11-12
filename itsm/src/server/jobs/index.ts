// The job queue (sm_jobs): background work and the outbox of record events, processed by `tick`.
//
// - `enqueue(q, job)` adds a job — inside the caller's write transaction when it is the consequence of a write
//   (the outbox pattern: the job exists exactly when the write committed). A `dedupeKey` makes it idempotent: while a
//   job with the same key (per organisation) is still queued, enqueue returns that job instead of adding another.
// - `registerJobHandler(kind, fn)` handles a kind; "prefix.*" handles every kind starting with "prefix.".
// - `tick(cfg, { budgetMs })` claims due jobs one by one (`for update skip locked`: several cloud instances never
//   take the same job; PGlite is a single connection) and runs their handlers until the budget is spent. A failed
//   job is retried with exponential backoff until `max_attempts`, then kept as `failed` with its last error. A job
//   whose worker died is taken again once its lock (5 minutes) expired.
// Triggers: the Windows app ticks every 10 s (src/desktop/server.ts); the cloud ticks after every write request
// (`cfg.waitUntil`, budget 4 s), on GET /api/cron/tick (Bearer CRON_SECRET; Supabase pg_cron / GitHub Actions /
// Vercel cron) and daily by Vercel cron as a last resort.
// Handlers never run inside a transaction: they open their own (`db.tx`) and may call external services.
import type { Db, Queryable } from "../db";
import { retryTransient } from "../db";
import type { Logger, ServerConfig } from "../context";
import { uuidv7 } from "@shared/id";
import { withLockLabel } from "../db/lockprobe";
import { inDemoScope } from "../db/scope";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  org_id: string | null;
  /**
   * Work of the organisation's demo pack (src/server/db/scope.ts): queued by demo work and about demo rows (its payload
   * names one, or it is the pack's own job). Its handler runs in the demo scope, so what it writes is demo data too.
   */
  demo?: boolean;
  kind: string;
  payload: Record<string, any>;
  status: JobStatus;
  run_at: string;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
  last_error: string | null;
  created_at: string;
}

export interface JobInput {
  kind: string;
  payload?: Record<string, unknown>;
  orgId?: string | null;
  /** when to run (default now) */
  runAt?: Date | string;
  /** or: run after this many milliseconds */
  delayMs?: number;
  /** idempotency key: no second job with this key (per organisation) while one is queued */
  dedupeKey?: string;
  /** default 8 */
  maxAttempts?: number;
}

/** What a tick needs of the server configuration. */
export type JobConfig = Pick<ServerConfig, "db" | "log"> & Partial<Omit<ServerConfig, "db" | "log">>;

export interface JobContext {
  cfg: JobConfig;
  db: Db;
  log: Logger;
  /** when the tick's budget ends (a long handler should stop and return `{ again: 0 }`) */
  deadline: number;
  /** persist a new payload for this job (e.g. progress kept for its next attempt) */
  save(payload: Record<string, unknown>): Promise<void>;
  /**
   * The same inside the caller's transaction: progress that commits (or rolls back) with the work it records — a retry
   * after a crash between the commit and the job's end then skips what is done.
   */
  saveIn(q: Queryable, payload: Record<string, unknown>): Promise<void>;
}

/** A handler returns nothing when the job is done, or `{ again: ms }` to run it again later (not an attempt). */
export type JobResult = void | { again: number };
export type JobHandler = (job: Job, jctx: JobContext) => Promise<JobResult>;

/** A failure that retrying cannot fix: the job is marked failed at once. */
export class PermanentJobError extends Error {}

const handlers = new Map<string, JobHandler>();

/** Handle jobs of `kind` ("prefix.*" for a family). A later registration replaces the earlier one. */
export function registerJobHandler(kind: string, fn: JobHandler): () => void {
  handlers.set(kind, fn);
  return () => {
    if (handlers.get(kind) === fn) handlers.delete(kind);
  };
}

function handlerFor(kind: string): JobHandler | undefined {
  const exact = handlers.get(kind);
  if (exact) return exact;
  const parts = kind.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const h = handlers.get(`${parts.slice(0, i).join(".")}.*`);
    if (h) return h;
  }
  return undefined;
}

const NIL = "00000000-0000-0000-0000-000000000000";

let enqueued = 0;
/**
 * How many jobs this process has queued so far. The web version compares it before and after a request and ticks
 * when the request queued something (a concurrent request may tick too early — harmless — but never too late).
 */
export function jobCounter(): number {
  return enqueued;
}

/** Add a job (use the caller's transaction for jobs that follow a write). Returns its id (or the queued twin's). */
export async function enqueue(q: Queryable, job: JobInput): Promise<string> {
  enqueued++;
  const runAt = job.runAt ? new Date(job.runAt).toISOString() : job.delayMs ? new Date(Date.now() + job.delayMs).toISOString() : null;
  const id = uuidv7();
  const row = await q.one<{ id: string }>(
    `insert into sm_jobs (id, org_id, kind, payload, run_at, max_attempts, dedupe_key)
     values ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, now()), $6, $7)
     on conflict (coalesce(org_id, '${NIL}'::uuid), dedupe_key) where dedupe_key is not null and status = 'queued' do nothing
     returning id`,
    [id, job.orgId ?? null, job.kind, JSON.stringify(job.payload ?? {}), runAt, job.maxAttempts ?? 8, job.dedupeKey ?? null],
  );
  if (row) return row.id;
  const twin = await q.one<{ id: string }>(
    `select id from sm_jobs where coalesce(org_id, '${NIL}'::uuid) = coalesce($1::uuid, '${NIL}'::uuid) and dedupe_key = $2 and status = 'queued'`,
    [job.orgId ?? null, job.dedupeKey ?? null],
  );
  return twin?.id ?? id;
}

/**
 * Add many jobs with one statement (set-based: the deliveries of one notification), with `enqueue`'s rules — a job whose
 * dedupe key has a queued twin (also one earlier in the same list) is left out. Returns how many were added.
 */
export async function enqueueMany(q: Queryable, jobs: JobInput[]): Promise<number> {
  if (!jobs.length) return 0;
  enqueued += jobs.length;
  const now = Date.now();
  const rows = jobs.map((j) => ({
    id: uuidv7(),
    org_id: j.orgId ?? null,
    kind: j.kind,
    payload: j.payload ?? {},
    run_at: j.runAt ? new Date(j.runAt).toISOString() : j.delayMs ? new Date(now + j.delayMs).toISOString() : null,
    max_attempts: j.maxAttempts ?? 8,
    dedupe_key: j.dedupeKey ?? null,
  }));
  const added = await q.query<{ id: string }>(
    `insert into sm_jobs (id, org_id, kind, payload, run_at, max_attempts, dedupe_key)
     select x.id, x.org_id, x.kind, x.payload, coalesce(x.run_at, now()), x.max_attempts, x.dedupe_key
     from jsonb_to_recordset($1::jsonb) as x(id uuid, org_id uuid, kind text, payload jsonb, run_at timestamptz, max_attempts int, dedupe_key text)
     on conflict (coalesce(org_id, '${NIL}'::uuid), dedupe_key) where dedupe_key is not null and status = 'queued' do nothing
     returning id`,
    [JSON.stringify(rows)],
  );
  return added.length;
}

/** Retry delay after `attempts` failed attempts: 15 s, 30 s, 1 min … at most 1 hour, with 20% jitter. */
export function backoffMs(attempts: number): number {
  const base = Math.min(3600_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (1 + Math.random() * 0.2));
}

/**
 * Claim up to `n` due jobs in one statement (`for update skip locked`: concurrent ticks of other processes never take
 * the same job; the partial index sm_jobs_due_idx answers it), else jobs whose worker died (lock expired).
 */
async function claim(db: Db, worker: string, n = 1): Promise<Job[]> {
  const take = (pick: string) =>
    db.query<Job>(
      `update sm_jobs set status = 'running', attempts = attempts + 1, locked_by = $1,
              locked_until = now() + interval '5 minutes', updated_at = now()
       where id in (${pick} for update skip locked)
       returning *, ${DEMO_JOB_SQL} as demo`,
      [worker],
    );
  const due = await take(`select id from sm_jobs where status = 'queued' and run_at <= now() order by run_at, id limit ${Math.max(1, Math.trunc(n))}`);
  if (due.length) return due.sort((a, b) => (a.run_at < b.run_at ? -1 : a.run_at > b.run_at ? 1 : a.id < b.id ? -1 : 1));
  return take(`select id from sm_jobs where status = 'running' and locked_until < now() order by locked_until limit ${Math.max(1, Math.trunc(n))}`);
}

/**
 * Is a job demo work (docs/DEMO_FA.md)? It was queued inside a demo transaction (recorded in sm_demo_rows) and it is
 * about demo data: the pack's own job (`__demo` in its payload) or a payload naming a demo row (a record's event, a
 * per-record timer, a notification of a demo record…). An organisation-wide job that demo work happened to queue (a
 * nightly roll-up, a re-index of a whole table) is not: it runs as ordinary work, and what it derives from demo rows
 * is found by the purge through its references.
 */
const DEMO_JOB_SQL = `(sm_jobs.org_id is not null
  and exists (select 1 from sm_demo_rows d where d.org_id = sm_jobs.org_id and d.row_id = sm_jobs.id)
  and (sm_jobs.payload ? '__demo' or exists (
    select 1 from regexp_matches(sm_jobs.payload::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
    join sm_demo_rows r on r.org_id = sm_jobs.org_id and r.row_id = m[1]::uuid)))`;

const isUniqueViolation = (e: unknown): boolean => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";

async function finish(db: Db, job: Job, status: JobStatus, opts: { error?: string; runInMs?: number; keepAttempt?: boolean } = {}) {
  if (status === "queued") {
    const runInMs = Math.max(0, Math.round(opts.runInMs ?? 0));
    // a job with a dedupe key may have got a queued twin while it ran («اجرا اکنون», a settings save): only one job of
    // a key may be queued (sm_jobs_dedupe_uk), so this one then folds into the twin instead of failing the tick
    try {
      const back = await db.one<{ id: string }>(
        `update sm_jobs set status = 'queued', run_at = now() + ($2::bigint * interval '1 millisecond'), locked_until = null, locked_by = null,
                last_error = coalesce($3, last_error), attempts = attempts - $4, updated_at = now()
         where id = $1 and ($6::text is null or not exists (
           select 1 from sm_jobs t where coalesce(t.org_id, '${NIL}'::uuid) = coalesce($5::uuid, '${NIL}'::uuid)
             and t.dedupe_key = $6::text and t.status = 'queued' and t.id <> $1))
         returning id`,
        [job.id, runInMs, opts.error ?? null, opts.keepAttempt ? 1 : 0, job.org_id ?? null, job.dedupe_key ?? null],
      );
      if (back || !job.dedupe_key) return;
    } catch (e) {
      // the twin was added between the check and the update
      if (!job.dedupe_key || !isUniqueViolation(e)) throw e;
    }
    // the twin runs no later than this one would have run again; this one is done (its last error kept)
    await db.query(
      `update sm_jobs set run_at = least(run_at, now() + ($3::bigint * interval '1 millisecond')), updated_at = now()
       where coalesce(org_id, '${NIL}'::uuid) = coalesce($1::uuid, '${NIL}'::uuid) and dedupe_key = $2 and status = 'queued'`,
      [job.org_id ?? null, job.dedupe_key, runInMs],
    );
    await db.query(
      `update sm_jobs set status = 'done', done_at = now(), locked_until = null, locked_by = null, last_error = coalesce($2, last_error),
              updated_at = now() where id = $1`,
      [job.id, opts.error ?? null],
    );
    return;
  }
  await db.query(
    `update sm_jobs set status = $2, done_at = now(), locked_until = null, locked_by = null, last_error = $3, updated_at = now() where id = $1`,
    [job.id, status, opts.error ?? null],
  );
}

let lastCleanup = 0;
/**
 * Finished jobs are kept a while for inspection: done 3 days, failed 30 days (at most once an hour per process). In
 * batches of 5 000 (sm_jobs_finished_idx): a busy organisation finishes hundreds of thousands of jobs a day, and one
 * statement deleting them all would hold the table and the WAL for long.
 */
async function cleanup(db: Db, deadline: number) {
  if (Date.now() - lastCleanup < 3600_000) return;
  lastCleanup = Date.now();
  for (let round = 0; round < 200 && Date.now() < deadline; round++) {
    const gone = await db.query<{ id: string }>(
      `delete from sm_jobs where id in (
         select id from sm_jobs where (status = 'done' and done_at < now() - interval '3 days') or (status = 'failed' and done_at < now() - interval '30 days')
         limit 5000)
       returning id`,
    );
    if (gone.length < 5000) return;
  }
  // more left than one tick's budget: the next tick of this process goes on
  lastCleanup = 0;
}

export interface TickResult {
  ran: number;
  failed: number;
  /** another tick of this process was already running on this database */
  busy?: boolean;
  /** due jobs were left for the next tick */
  more: boolean;
}

const running = new WeakMap<Db, boolean>();
/** Databases whose server is closing (the Windows app's local server): their runner claims no more jobs. */
const closing = new WeakSet<Db>();
/** The tick in progress on a database: a closing server waits for the jobs it already holds. */
const inProgress = new WeakMap<Db, Promise<void>>();

/**
 * The job runner of this process claims no more jobs on `db` — its server is closing — and this resolves once the tick
 * in progress, if any, has finished the jobs it already holds (src/desktop/server.ts: the database then closes cleanly
 * at once instead of after the rest of the tick's budget, or killed by the app that is quitting).
 */
export async function stopTicks(db: Db): Promise<void> {
  closing.add(db);
  await inProgress.get(db);
}

export interface TickOptions {
  budgetMs?: number;
  max?: number;
  worker?: string;
  concurrency?: number;
  /**
   * Is foreground work waiting? (The Windows app's local server: requests of its window in flight, src/desktop/server.ts.)
   * Before it claims the next job the runner waits until there is none — at most `YIELD_MS` each time —, so a page's
   * burst of requests is answered without the next job's statements between them on PGlite's one connection, and a
   * window in constant use slows the queue down without ever stopping it.
   */
  busy?: () => boolean;
}

/** The longest the runner waits for foreground work before each job (`TickOptions.busy`). */
export const YIELD_MS = 250;

/** Waits while `busy()`, at most `ms`. */
async function quietFor(busy: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (busy() && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
}

/**
 * Run due jobs until `budgetMs` is spent (default 8 s) or `max` jobs ran. `concurrency` (default 1: one job after the
 * other, as PGlite's single connection needs) runs up to that many jobs at once — the server edition's job runner
 * uses it for notification fan-out and SLA timers at scale: each round claims that many due jobs in one statement.
 */
export async function tick(cfg: JobConfig, opts: TickOptions = {}): Promise<TickResult> {
  // a tick started from inside demo work (a demo person's request) lends that scope to no job: each job sets its own
  return inDemoScope(null, () => tickOutsideScope(cfg, opts));
}

async function tickOutsideScope(cfg: JobConfig, opts: TickOptions): Promise<TickResult> {
  const db = cfg.db;
  if (running.get(db)) return { ran: 0, failed: 0, busy: true, more: false };
  if (closing.has(db)) return { ran: 0, failed: 0, more: false };
  running.set(db, true);
  let ended = () => {};
  inProgress.set(db, new Promise<void>((r) => (ended = r)));
  const deadline = Date.now() + (opts.budgetMs ?? 8000);
  const worker = opts.worker ?? `w${process.pid}-${uuidv7().slice(-8)}`;
  const width = Math.max(1, Math.min(32, Math.trunc(opts.concurrency ?? 1)));
  const max = opts.max ?? 1000;
  let ran = 0;
  let failed = 0;
  try {
    await cleanup(db, deadline).catch((e) => cfg.log.warn("job cleanup failed", String((e as Error)?.message ?? e)));
    while (Date.now() < deadline && ran + failed < max && !closing.has(db)) {
      if (opts.busy?.()) {
        await quietFor(opts.busy, Math.min(YIELD_MS, deadline - Date.now()));
        if (Date.now() >= deadline || closing.has(db)) break;
      }
      const jobs = await claim(db, worker, Math.min(width, max - ran - failed));
      if (!jobs.length) return { ran, failed, more: false };
      // jobs of one record (its events) keep their order: they run one after the other, other groups alongside
      const groups = new Map<string, Job[]>();
      for (const job of jobs) {
        const key = job.kind.startsWith("record.") && job.payload?.id ? `record:${job.payload.table ?? ""}:${job.payload.id}` : job.id;
        groups.set(key, [...(groups.get(key) ?? []), job]);
      }
      // allSettled: the tick (and this process's guard against a second one) lasts until every claimed group ended —
      // a tick that ended early would let the next one start a record's later event while its earlier one still runs
      const settled = await Promise.allSettled(
        [...groups.values()].map(async (group) => {
          const out: boolean[] = [];
          for (const job of group) out.push(await runOne(cfg, job, deadline));
          return out;
        }),
      );
      for (const s of settled) {
        if (s.status === "rejected") {
          failed++;
          cfg.log.warn("job run failed", String((s.reason as Error)?.message ?? s.reason));
          continue;
        }
        for (const ok of s.value) if (ok) ran++;
        else failed++;
      }
    }
    if (closing.has(db)) return { ran, failed, more: false };
    const left = await db.one(`select 1 from sm_jobs where status = 'queued' and run_at <= now() limit 1`);
    return { ran, failed, more: !!left };
  } finally {
    running.delete(db);
    inProgress.delete(db);
    ended();
  }
}

async function runOne(cfg: JobConfig, job: Job, deadline: number): Promise<boolean> {
  const db = cfg.db;
  const handler = handlerFor(job.kind);
  const jctx: JobContext = {
    cfg,
    db,
    log: cfg.log,
    // a closing server (stopTicks): a job that looks at its deadline as it goes ends at its next look, and is queued again
    get deadline() {
      return closing.has(db) ? Math.min(deadline, Date.now()) : deadline;
    },
    save: async (payload) => {
      job.payload = payload as Record<string, any>;
      await db.query(`update sm_jobs set payload = $2::jsonb, updated_at = now() where id = $1`, [job.id, JSON.stringify(payload)]);
    },
    saveIn: async (q, payload) => {
      await q.query(`update sm_jobs set payload = $2::jsonb, updated_at = now() where id = $1`, [job.id, JSON.stringify(payload)]);
    },
  };
  try {
    if (!handler) throw new Error(`no handler for job kind "${job.kind}"`);
    // the write-lock probe of measurement runs labels the locks a job takes with its kind (a no-op otherwise); a demo
    // job's writes are demo data (src/server/db/scope.ts), any other job's are not.
    // A deadlock or a serialization failure rolled the handler's transaction back (writes of one organisation run side
    // by side): it runs again at once, a few times, before it counts as a failed attempt (handlers are retried anyway).
    // A run again starts from the progress the job committed — the payload as stored (`saveIn` writes it inside the
    // handler's own transactions), exactly what a later attempt would read
    let runs = 0;
    const r = await retryTransient(async () => {
      if (runs++ > 0) {
        const stored = await db.one<{ payload: Record<string, any> }>(`select payload from sm_jobs where id = $1`, [job.id]);
        if (stored) job.payload = stored.payload;
      }
      return inDemoScope(job.demo && job.org_id ? job.org_id : null, () => withLockLabel(`job ${job.kind}`, () => handler!(job, jctx)));
    }, 4);
    if (r && typeof r.again === "number") await finish(db, job, "queued", { runInMs: r.again, keepAttempt: true });
    else await finish(db, job, "done");
    return true;
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 2000);
    try {
      if (e instanceof PermanentJobError || job.attempts >= job.max_attempts) {
        await finish(db, job, "failed", { error });
        cfg.log.warn(`job ${job.kind} failed`, { id: job.id, error });
      } else {
        await finish(db, job, "queued", { error, runInMs: backoffMs(job.attempts) });
      }
    } catch (e2) {
      // never reject: the tick waits for every group it claimed. The job stays claimed until its lock expires.
      cfg.log.warn(`job ${job.kind}: its outcome was not saved`, { id: job.id, error, cause: String((e2 as Error)?.message ?? e2).slice(0, 2000) });
    }
    return false;
  }
}

/** Jobs of an organisation for the admin screens and tests. */
export async function listJobs(q: Queryable, orgId: string | null, opts: { status?: JobStatus; kind?: string; limit?: number } = {}): Promise<Job[]> {
  const params: unknown[] = [orgId];
  const where = [orgId ? "org_id = $1" : "org_id is null"];
  if (opts.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`kind = $${params.length}`);
  }
  return q.query<Job>(`select * from sm_jobs where ${where.join(" and ")} order by created_at desc, id desc limit ${Math.min(Math.max(opts.limit ?? 100, 1), 1000)}`, params);
}

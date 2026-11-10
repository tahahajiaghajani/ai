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
import type { Logger, ServerConfig } from "../context";
import { uuidv7 } from "@shared/id";

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  org_id: string | null;
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
       returning *`,
      [worker],
    );
  const due = await take(`select id from sm_jobs where status = 'queued' and run_at <= now() order by run_at, id limit ${Math.max(1, Math.trunc(n))}`);
  if (due.length) return due.sort((a, b) => (a.run_at < b.run_at ? -1 : a.run_at > b.run_at ? 1 : a.id < b.id ? -1 : 1));
  return take(`select id from sm_jobs where status = 'running' and locked_until < now() order by locked_until limit ${Math.max(1, Math.trunc(n))}`);
}

async function finish(db: Db, job: Job, status: JobStatus, opts: { error?: string; runInMs?: number; keepAttempt?: boolean } = {}) {
  if (status === "queued") {
    await db.query(
      `update sm_jobs set status = 'queued', run_at = now() + ($2::bigint * interval '1 millisecond'), locked_until = null, locked_by = null,
              last_error = coalesce($3, last_error), attempts = attempts - $4, updated_at = now() where id = $1`,
      [job.id, Math.max(0, Math.round(opts.runInMs ?? 0)), opts.error ?? null, opts.keepAttempt ? 1 : 0],
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

/**
 * Run due jobs until `budgetMs` is spent (default 8 s) or `max` jobs ran. `concurrency` (default 1: one job after the
 * other, as PGlite's single connection needs) runs up to that many jobs at once — the server edition's job runner
 * uses it for notification fan-out and SLA timers at scale: each round claims that many due jobs in one statement.
 */
export async function tick(cfg: JobConfig, opts: { budgetMs?: number; max?: number; worker?: string; concurrency?: number } = {}): Promise<TickResult> {
  const db = cfg.db;
  if (running.get(db)) return { ran: 0, failed: 0, busy: true, more: false };
  running.set(db, true);
  const deadline = Date.now() + (opts.budgetMs ?? 8000);
  const worker = opts.worker ?? `w${process.pid}-${uuidv7().slice(-8)}`;
  const width = Math.max(1, Math.min(32, Math.trunc(opts.concurrency ?? 1)));
  const max = opts.max ?? 1000;
  let ran = 0;
  let failed = 0;
  try {
    await cleanup(db, deadline).catch((e) => cfg.log.warn("job cleanup failed", String((e as Error)?.message ?? e)));
    while (Date.now() < deadline && ran + failed < max) {
      const jobs = await claim(db, worker, Math.min(width, max - ran - failed));
      if (!jobs.length) return { ran, failed, more: false };
      // jobs of one record (its events) keep their order: they run one after the other, other groups alongside
      const groups = new Map<string, Job[]>();
      for (const job of jobs) {
        const key = job.kind.startsWith("record.") && job.payload?.id ? `record:${job.payload.table ?? ""}:${job.payload.id}` : job.id;
        groups.set(key, [...(groups.get(key) ?? []), job]);
      }
      const results = (
        await Promise.all(
          [...groups.values()].map(async (group) => {
            const out: boolean[] = [];
            for (const job of group) out.push(await runOne(cfg, job, deadline));
            return out;
          }),
        )
      ).flat();
      for (const ok of results) if (ok) ran++;
      else failed++;
    }
    const left = await db.one(`select 1 from sm_jobs where status = 'queued' and run_at <= now() limit 1`);
    return { ran, failed, more: !!left };
  } finally {
    running.delete(db);
  }
}

async function runOne(cfg: JobConfig, job: Job, deadline: number): Promise<boolean> {
  const db = cfg.db;
  const handler = handlerFor(job.kind);
  const jctx: JobContext = {
    cfg,
    db,
    log: cfg.log,
    deadline,
    save: async (payload) => {
      job.payload = payload as Record<string, any>;
      await db.query(`update sm_jobs set payload = $2::jsonb, updated_at = now() where id = $1`, [job.id, JSON.stringify(payload)]);
    },
  };
  try {
    if (!handler) throw new Error(`no handler for job kind "${job.kind}"`);
    const r = await handler(job, jctx);
    if (r && typeof r.again === "number") await finish(db, job, "queued", { runInMs: r.again, keepAttempt: true });
    else await finish(db, job, "done");
    return true;
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 2000);
    if (e instanceof PermanentJobError || job.attempts >= job.max_attempts) {
      await finish(db, job, "failed", { error });
      cfg.log.warn(`job ${job.kind} failed`, { id: job.id, error });
    } else {
      await finish(db, job, "queued", { error, runInMs: backoffMs(job.attempts) });
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

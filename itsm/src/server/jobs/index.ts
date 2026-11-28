// The job queue (sm_jobs): background work and the outbox of record events, processed by `tick`.
//
// - `enqueue(q, job)` adds a job — inside the caller's write transaction when it is the consequence of a write
//   (the outbox pattern: the job exists exactly when the write committed). A `dedupeKey` makes it idempotent: while a
//   job with the same key (per organisation) is still queued, enqueue returns that job instead of adding another.
// - `registerJobHandler(kind, fn)` handles a kind; "prefix.*" handles every kind starting with "prefix.".
// - `tick(cfg, { budgetMs })` claims due jobs one by one (`for update skip locked`: several cloud instances never
//   take the same job; PGlite is a single connection) and runs their handlers until the budget is spent. A failed
//   job is retried with exponential backoff until `max_attempts`, then kept as `failed` with its last error.
// - Attempts count consecutive failures (Kariz 1.1.5): a run that returns normally — done, or `{ again }` for later —
//   forgives the deaths and errors before it, so a self-rescheduling chain is never worn down over its life.
// - A running job's lock (`LOCK_MS`, 5 minutes) is renewed every `HEARTBEAT_MS` while its handler works, for at most
//   `HEARTBEAT_MAX_MS` (a hung handler loses its claim at last), and `jctx.save`/`saveIn` renew it too. Only the worker
//   that still holds a claim writes the job's outcome (every statement of `finish` requires it): a lost claim writes
//   nothing and is logged.
// - A job whose worker died is taken again once its lock expired — unless that was its last allowed attempt: it is then
//   failed (`failExhausted`, EXHAUSTED_ERROR) and never run again, and its kind's exhausted hook (`registerJobExhausted`,
//   or the handler's `onExhausted`) puts the kind's own row in a final state or re-arms its chain. A handler that throws
//   at its last attempt gets the same hook (a PermanentJobError is the handler's own decision: no hook), and so does a
//   queued job an administrator cancels («لغو», `cancelQueuedJob`). The statement that fails the job records the hook as
//   owed (`hook_due`): one that failed or was cut is tried again by a later tick (`settleOwedHooks`), until `HOOK_TRIES`.
// - A run that returned is a success whatever happens while its outcome is written: a database failure there is tried
//   again (`OUTCOME_TRIES`), then at this process's next tick — never taken for the handler's failure.
// Triggers: the Windows app ticks every 10 s (src/desktop/server.ts); the server edition's scheduler leader on its
// interval and when a write wakes it (src/server-edition/scheduler.ts). The web version has no timer of its own between
// requests (src/server/app.ts): it ticks once the answer is sent after a write request that queued jobs, when one is due
// (budget 4 s); from any other request at most once a minute per instance, when a job is due or a worker's lock expired
// (`trafficTickDue`, budget 8 s); and on GET /api/cron/tick (Bearer CRON_SECRET; Supabase pg_cron + pg_net every
// minute, a GitHub Actions schedule, and Vercel's daily cron as a last resort; budget 20 s, the only web tick that
// deletes finished jobs). The probe `queueHasDue`, run after the answer in the work handed to `cfg.waitUntil`, lets a
// request's tick run only when there is work.
// Handlers never run inside a transaction: they open their own (`db.tx`) and may call external services.
import type { Db, Queryable } from "../db";
import { pgArray, retryTransient } from "../db";
import type { Logger, ServerConfig } from "../context";
import { dbErrorMessage } from "../http/errors";
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
  /**
   * Persist a new payload for this job (e.g. progress kept for its next attempt); it renews the job's lock like the
   * heartbeat. Throws JobClaimLost, writing nothing, once this worker no longer holds the job: the handler stops there.
   */
  save(payload: Record<string, unknown>): Promise<void>;
  /**
   * The same inside the caller's transaction: progress that commits (or rolls back) with the work it records — a retry
   * after a crash between the commit and the job's end then skips what is done. A lost claim throws JobClaimLost, so
   * the transaction rolls back with the work it would have recorded.
   */
  saveIn(q: Queryable, payload: Record<string, unknown>): Promise<void>;
}

/**
 * A handler returns nothing when the job is done, or `{ again: ms }` to run it again later. Either way the run counted
 * as a success: the job's attempts start again (only consecutive failures exhaust a job).
 */
export type JobResult = void | { again: number };
export type JobHandler = (job: Job, jctx: JobContext) => Promise<JobResult>;

/** A failure that retrying cannot fix: the job is marked failed at once (and its kind's exhausted hook is not called). */
export class PermanentJobError extends Error {}

/** The worker no longer holds the job's claim (another worker took it, it was failed as exhausted, or removed). */
export class JobClaimLost extends Error {
  constructor(id: string) {
    super(`the claim of job ${id} was lost: another worker holds it, or it ended`);
  }
}

/** What an exhausted hook gets besides its job (the job's row as it ended: `failed`, its last error and payload). */
export interface ExhaustedContext {
  cfg: JobConfig;
  db: Db;
  log: Logger;
  /**
   * "died": its worker stopped during the last allowed attempt (`failExhausted`); "error": its handler threw then;
   * "canceled": an administrator canceled it while it was queued («لغو» in the consoles, `cancelQueuedJob`)
   */
  cause: "died" | "error" | "canceled";
  /** what the kind's row may show: EXHAUSTED_ERROR when the worker died, CANCELED_ERROR, else the handler's last error */
  error: string;
}
/**
 * A kind's last word on a job that ended without finishing (its last allowed attempt used, or canceled while queued):
 * it puts the kind's own row (a backup, an agent run, a flow run…) in the final state its handler's last-attempt path
 * would have left, or queues a chain's next round with a back-off. Called after the job is `failed`, in the job's demo
 * scope; owed until it returns — one that throws (its error logged with the job's id) or is cut is called again by a
 * later tick, at most `HOOK_TRIES` times in all. So a hook is compare-and-set (it changes only a row still in the state
 * the job left; a chain's enqueue keeps its dedupe key) and never calls the job's handler.
 */
export type ExhaustedHook = (job: Job, ectx: ExhaustedContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const exhaustedHooks = new Map<string, ExhaustedHook>();

/**
 * Handle jobs of `kind` ("prefix.*" for a family). A later registration replaces the earlier one. `onExhausted` is the
 * kind's exhausted hook (`registerJobExhausted`); the function returned removes both.
 */
export function registerJobHandler(kind: string, fn: JobHandler, opts: { onExhausted?: ExhaustedHook } = {}): () => void {
  handlers.set(kind, fn);
  const offHook = opts.onExhausted ? registerJobExhausted(kind, opts.onExhausted) : () => {};
  return () => {
    if (handlers.get(kind) === fn) handlers.delete(kind);
    offHook();
  };
}

/**
 * The exhausted hook of `kind` ("prefix.*" for a family, found as handlers are: the kind itself first, then the longest
 * family). A later registration replaces the earlier one.
 */
export function registerJobExhausted(kind: string, fn: ExhaustedHook): () => void {
  exhaustedHooks.set(kind, fn);
  return () => {
    if (exhaustedHooks.get(kind) === fn) exhaustedHooks.delete(kind);
  };
}

/** The entry of `kind` in a registry: the kind itself, else the longest "prefix.*" family. */
function lookup<T>(map: Map<string, T>, kind: string): T | undefined {
  const exact = map.get(kind);
  if (exact) return exact;
  const parts = kind.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const h = map.get(`${parts.slice(0, i).join(".")}.*`);
    if (h) return h;
  }
  return undefined;
}

const handlerFor = (kind: string): JobHandler | undefined => lookup(handlers, kind);
const exhaustedFor = (kind: string): ExhaustedHook | undefined => lookup(exhaustedHooks, kind);

/** Does `kind` have an exhausted hook (the stateful kinds' registry test)? */
export const hasExhaustedHook = (kind: string): boolean => !!exhaustedFor(kind);

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

/** How long a claim lasts unless renewed: a job whose lock expired lost its worker (taken again, or failExhausted). */
export const LOCK_MS = 5 * 60_000;
/** How often the lock of a running job is renewed while its handler works (well inside `LOCK_MS`). */
export const HEARTBEAT_MS = 60_000;
/**
 * How long a running job's lock is renewed at most: a handler hung longer loses its claim (its lock expires and
 * «سلامت سامانه» shows its queue as stopped), so a wedged worker cannot hold a job — and the queue behind it — for ever.
 * The longest legitimate jobs (a backup, a directory synchronisation, an import, an asset reconciliation at a bank's
 * scale) stay well below it.
 */
export const HEARTBEAT_MAX_MS = 2 * 3600_000;

/** The lock's timings of one tick (`TickOptions`; tests shorten them). */
interface Timing {
  lockMs: number;
  heartbeatMs: number;
  heartbeatMaxMs: number;
}

const msParam = (v: number) => Math.max(0, Math.round(v));

/**
 * Claim up to `n` due jobs in one statement (`for update skip locked`: concurrent ticks of other processes never take
 * the same job; the partial index sm_jobs_due_idx answers it), else jobs whose worker died (lock expired) and that have
 * an attempt left (one that used its last attempt is failed by `failExhausted`, never run again). The claim stamps
 * `updated_at`: a running job's `updated_at` is when it was claimed (its heartbeat and saves renew only its lock).
 */
async function claim(db: Db, worker: string, n: number, lockMs: number): Promise<Job[]> {
  const take = (pick: string) =>
    db.query<Job>(
      `update sm_jobs set status = 'running', attempts = attempts + 1, locked_by = $1,
              locked_until = now() + ($2::bigint * interval '1 millisecond'), updated_at = now()
       where id in (${pick} for update skip locked)
       returning *, ${DEMO_JOB_SQL} as demo`,
      [worker, msParam(lockMs)],
    );
  const due = await take(`select id from sm_jobs where status = 'queued' and run_at <= now() order by run_at, id limit ${Math.max(1, Math.trunc(n))}`);
  if (due.length) return due.sort((a, b) => (a.run_at < b.run_at ? -1 : a.run_at > b.run_at ? 1 : a.id < b.id ? -1 : 1));
  return take(
    `select id from sm_jobs where status = 'running' and locked_until < now() and attempts < max_attempts order by locked_until limit ${Math.max(1, Math.trunc(n))}`,
  );
}

/**
 * Renew a running job's lock while its handler works: every `heartbeatMs`, until `heartbeatMaxMs` after its claim, and
 * only while this worker still holds the claim. A row the handler's own transaction holds (`saveIn`) is skipped, never
 * waited for — that transaction renews the lock itself; on PGlite (one connection) a beat simply waits its turn.
 */
function heartbeat(db: Db, id: string, worker: string, t: Timing, claimed: number): () => void {
  if (!(t.heartbeatMs > 0)) return () => {};
  let inFlight = false;
  const timer = setInterval(() => {
    if (Date.now() - claimed >= t.heartbeatMaxMs) return void clearInterval(timer);
    if (inFlight) return;
    inFlight = true;
    db.query(
      `update sm_jobs set locked_until = now() + ($3::bigint * interval '1 millisecond')
       where id in (select id from sm_jobs where id = $1 and status = 'running' and locked_by = $2 for update skip locked)`,
      [id, worker, msParam(t.lockMs)],
    )
      .catch(() => undefined)
      .finally(() => (inFlight = false));
  }, t.heartbeatMs);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/** The last error of a job whose worker stopped during its last allowed attempt (after the error it had, if any). */
export const EXHAUSTED_ERROR = "کارگر این کار در آخرین تلاش مجاز پیش از پایان متوقف شد (مثلاً به سقف زمان اجرای سرور رسید)؛ دیگر اجرا نمی‌شود";
/** How much of a job's earlier error stays before `EXHAUSTED_ERROR`: last_error holds 2,000 characters, like runOne's. */
const EARLIER_ERROR_KEPT = 2000 - " · ".length - EXHAUSTED_ERROR.length;
/** Exhausted jobs looked at per tick (sm_jobs_running_idx). */
export const EXHAUSTED_BATCH = 100;

/**
 * Fail the exhausted jobs a pick names: still running, their lock expired, no attempt left; rows held now are skipped.
 * `owe`: the jobs' kind has an exhausted hook — the same statement records it as owed (`hook_due`, its first try).
 */
const failExhaustedSql = (pick: string, owe = false) => `update sm_jobs set status = 'failed', done_at = now(), locked_until = null, locked_by = null,
            last_error = coalesce(left(last_error, ${EARLIER_ERROR_KEPT}) || ' · ', '') || $1, updated_at = now()${owe ? ", hook_due = 'died', hook_tries = 1" : ""}
     where id in (select id from sm_jobs where ${pick} and status = 'running' and locked_until < now() and attempts >= max_attempts
                  for update skip locked)
     returning *, ${DEMO_JOB_SQL} as demo`;

/**
 * Fail the jobs whose worker stopped during their last allowed attempt: still `running`, their lock expired (with the
 * heartbeat that means their worker is gone), no attempt left (`attempts >= max_attempts`; the claim counts an attempt
 * when it takes the job). Their worker was cut off — the web version's function at its time limit, a process that died
 * or closed abruptly — and a job that never fits in that time would otherwise be taken again forever. A long earlier
 * error is shortened, never the reason.
 *
 * At most `EXHAUSTED_BATCH` a tick (sm_jobs_running_idx), the rest at the next one. Jobs of kinds without an exhausted
 * hook go in one statement; those of a kind with one are failed one at a time, each followed by its hook, while the
 * tick has time (at least one a tick) — the others stay as they are for the next tick rather than failed without it.
 */
async function failExhausted(cfg: JobConfig, deadline: number): Promise<number> {
  const db = cfg.db;
  const found = await db.query<{ id: string; kind: string }>(
    `select id, kind from sm_jobs where status = 'running' and locked_until < now() and attempts >= max_attempts order by locked_until limit ${EXHAUSTED_BATCH}`,
  );
  if (!found.length) return 0;
  const told = (r: Job) =>
    cfg.log.warn(`job ${r.kind} failed: its worker stopped during its last allowed attempt`, { id: r.id, org_id: r.org_id, attempts: r.attempts });
  let failed = 0;
  const plain = found.filter((r) => !exhaustedFor(r.kind)).map((r) => r.id);
  if (plain.length) {
    const rows = await db.query<Job>(failExhaustedSql("id = any($2::uuid[])"), [EXHAUSTED_ERROR, pgArray(plain)]);
    for (const r of rows) told(r);
    failed += rows.length;
  }
  let hooked = 0;
  for (const r of found) {
    if (!exhaustedFor(r.kind)) continue;
    if (hooked > 0 && (Date.now() >= deadline || closing.has(db))) break;
    const [job] = await db.query<Job>(failExhaustedSql("id = $2::uuid", true), [EXHAUSTED_ERROR, r.id]);
    if (!job) continue;
    hooked++;
    failed++;
    told(job);
    await runExhaustedHook(cfg, job, "died", EXHAUSTED_ERROR, 1);
  }
  return failed;
}

/** Tries of a job's exhausted hook in all: the first as the job ends, the others at later ticks (`settleOwedHooks`). */
export const HOOK_TRIES = 8;
/** Owed hooks looked at per tick (sm_jobs_hook_due_idx), tried one at a time while the tick has time (at least one). */
export const HOOK_BATCH = 20;
/** The pause before an owed hook's next try: 1, 2, 4… minutes after its last one, at most an hour (8 tries ≈ 3 hours). */
const HOOK_PAUSE_SQL = `(least(60, power(2, greatest(hook_tries - 1, 0)))::int * interval '1 minute')`;

/**
 * Run the exhausted hook a failed job owes, as its `tries`-th try: in the job's demo scope (as `runOne` runs its
 * handler), never throwing. Done, the debt is cleared (only the try that ran: a job revived and owing again keeps its
 * new debt); failed, its error is logged with the job's id and the hook stays owed for a later tick — after its
 * `HOOK_TRIES`-th try it is given up, as an error in the log. A kind that no longer has a hook owes nothing.
 */
async function runExhaustedHook(cfg: JobConfig, job: Job, cause: ExhaustedContext["cause"], error: string, tries: number): Promise<void> {
  const hook = exhaustedFor(job.kind);
  let settled = !hook;
  if (hook) {
    const ectx: ExhaustedContext = { cfg, db: cfg.db, log: cfg.log, cause, error };
    try {
      await inDemoScope(job.demo && job.org_id ? job.org_id : null, () => withLockLabel(`job ${job.kind} exhausted`, () => hook(job, ectx)));
      settled = true;
    } catch (e) {
      const message = String((e as Error)?.message ?? e).slice(0, 2000);
      if (tries >= HOOK_TRIES) {
        settled = true;
        cfg.log.error(`job ${job.kind}: its exhausted hook failed ${tries} times and is given up; the kind's row may be left as the job left it`, { id: job.id, org_id: job.org_id, error: message });
      } else cfg.log.warn(`job ${job.kind}: its exhausted hook failed (tried again later)`, { id: job.id, org_id: job.org_id, tries, error: message });
    }
  }
  if (!settled) return;
  await cfg.db
    .query(`update sm_jobs set hook_due = null where id = $1 and hook_due is not null and hook_tries = $2`, [job.id, tries])
    .catch((e) => cfg.log.warn(`job ${job.kind}: its exhausted hook ran, but clearing what the job owed failed (it runs again later)`, { id: job.id, error: String((e as Error)?.message ?? e).slice(0, 500) }));
}

/**
 * The exhausted hooks failed jobs still owe (`hook_due`: their worker died, their handler threw at the last attempt, or
 * they were canceled — and the hook then failed, or its process stopped before it ran): each whose pause has passed is
 * taken by one tick (its try counted and its stamp renewed in one statement, rows another tick holds skipped) and run
 * again with the cause and error it ended with. At most `HOOK_BATCH` a tick, one at a time while the tick has time.
 */
async function settleOwedHooks(cfg: JobConfig, deadline: number): Promise<void> {
  const db = cfg.db;
  const owed = await db.query<{ id: string }>(
    `select id from sm_jobs where status = 'failed' and hook_due is not null and updated_at < now() - ${HOOK_PAUSE_SQL} order by updated_at limit ${HOOK_BATCH}`,
  );
  let ran = 0;
  for (const o of owed) {
    if (ran > 0 && (Date.now() >= deadline || closing.has(db))) break;
    const [job] = await db.query<Job & { hook_due: ExhaustedContext["cause"]; hook_tries: number }>(
      `update sm_jobs set hook_tries = hook_tries + 1, updated_at = now()
       where id in (select id from sm_jobs where id = $1 and status = 'failed' and hook_due is not null and updated_at < now() - ${HOOK_PAUSE_SQL}
                    for update skip locked)
       returning *, ${DEMO_JOB_SQL} as demo`,
      [o.id],
    );
    if (!job) continue;
    ran++;
    const error = job.hook_due === "died" ? EXHAUSTED_ERROR : (job.last_error ?? EXHAUSTED_ERROR);
    await runExhaustedHook(cfg, job, job.hook_due, error, job.hook_tries);
  }
}

/**
 * The Windows app's start (one process per database, so whatever is `running` was its last process's — one that ended
 * abruptly: a shutdown, a crash): the jobs that process held are taken again by the first tick (or failed, at their
 * last attempt) at once, instead of waiting until the locks its heartbeat renewed run out. Returns how many.
 */
export async function releaseStaleClaims(q: Queryable): Promise<number> {
  const r = await q.query(`update sm_jobs set locked_until = now() - interval '1 second' where status = 'running' and locked_until >= now() returning id`);
  return r.length;
}

/**
 * Is a job demo work (docs/DEMO_FA.md)? It was queued inside a demo transaction (recorded in sm_demo_rows) and it is
 * about demo data: the pack's own job (`__demo` in its payload) or a payload naming a demo row (a record's event, a
 * per-record timer, a notification of a demo record…). An organisation-wide job that demo work happened to queue (a
 * nightly roll-up, a re-index of a whole table, the organisation's `process.timer` woken while it ran) is not: it runs
 * as ordinary work, the purge leaves it queued (demo/purge.ts `removeRows`), and what it derives from demo rows is found
 * by the purge through its references. A condition on the table `sm_jobs` itself (no alias).
 */
export const DEMO_JOB_SQL = `(sm_jobs.org_id is not null
  and exists (select 1 from sm_demo_rows d where d.org_id = sm_jobs.org_id and d.row_id = sm_jobs.id)
  and (sm_jobs.payload ? '__demo' or exists (
    select 1 from regexp_matches(sm_jobs.payload::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
    join sm_demo_rows r on r.org_id = sm_jobs.org_id and r.row_id = m[1]::uuid)))`;

const isUniqueViolation = (e: unknown): boolean => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";

/** Does `worker` still hold the job's claim? */
const holds = async (db: Db, id: string, worker: string): Promise<boolean> =>
  !!(await db.one(`select 1 from sm_jobs where id = $1 and status = 'running' and locked_by = $2`, [id, worker]));

/**
 * Write a job's outcome — only while `worker` still holds its claim (status 'running', locked_by = worker): a claim lost
 * meanwhile (another worker took the job after its lock expired, failExhausted failed it, the demo purge removed it)
 * writes nothing ("lost"), so writing the same outcome again after a try whose answer was lost writes nothing either.
 * `forgive`: the run returned normally, so its attempts start again. `owe`: a job failed at its last attempt owes its
 * kind's exhausted hook (`hook_due`), recorded by the same statement.
 */
async function finish(
  db: Db,
  job: Job,
  worker: string,
  status: JobStatus,
  opts: { error?: string; runInMs?: number; forgive?: boolean; owe?: ExhaustedContext["cause"] } = {},
): Promise<"ok" | "lost"> {
  if (status === "queued") {
    const runInMs = Math.max(0, Math.round(opts.runInMs ?? 0));
    // a job with a dedupe key may have got a queued twin while it ran («اجرا اکنون», a settings save): only one job of
    // a key may be queued (sm_jobs_dedupe_uk), so this one then folds into the twin instead of failing the tick
    try {
      const back = await db.one<{ id: string }>(
        `update sm_jobs set status = 'queued', run_at = now() + ($2::bigint * interval '1 millisecond'), locked_until = null, locked_by = null,
                last_error = coalesce($3, last_error), attempts = case when $4::int = 1 then 0 else attempts end, updated_at = now()
         where id = $1 and status = 'running' and locked_by = $7 and ($6::text is null or not exists (
           select 1 from sm_jobs t where coalesce(t.org_id, '${NIL}'::uuid) = coalesce($5::uuid, '${NIL}'::uuid)
             and t.dedupe_key = $6::text and t.status = 'queued' and t.id <> $1))
         returning id`,
        [job.id, runInMs, opts.error ?? null, opts.forgive ? 1 : 0, job.org_id ?? null, job.dedupe_key ?? null, worker],
      );
      if (back) return "ok";
      if (!job.dedupe_key) return "lost";
    } catch (e) {
      // the twin was added between the check and the update
      if (!job.dedupe_key || !isUniqueViolation(e)) throw e;
    }
    // nothing was updated: the claim was lost, or a queued twin holds the key
    if (!(await holds(db, job.id, worker))) return "lost";
    // the twin runs no later than this one would have run again; this one is done (its last error kept)
    await db.query(
      `update sm_jobs set run_at = least(run_at, now() + ($3::bigint * interval '1 millisecond')), updated_at = now()
       where coalesce(org_id, '${NIL}'::uuid) = coalesce($1::uuid, '${NIL}'::uuid) and dedupe_key = $2 and status = 'queued'`,
      [job.org_id ?? null, job.dedupe_key, runInMs],
    );
    const done = await db.one(
      `update sm_jobs set status = 'done', done_at = now(), locked_until = null, locked_by = null, last_error = coalesce($2, last_error),
              updated_at = now() where id = $1 and status = 'running' and locked_by = $3 returning id`,
      [job.id, opts.error ?? null, worker],
    );
    return done ? "ok" : "lost";
  }
  const r = await db.one(
    `update sm_jobs set status = $2, done_at = now(), locked_until = null, locked_by = null, last_error = $3, updated_at = now()${opts.owe ? ", hook_due = $5, hook_tries = 1" : ""}
     where id = $1 and status = 'running' and locked_by = $4 returning id`,
    opts.owe ? [job.id, status, opts.error ?? null, worker, opts.owe] : [job.id, status, opts.error ?? null, worker],
  );
  return r ? "ok" : "lost";
}

/** Tries of writing a run's outcome while the database fails on it (a busy pool, a timeout, a lost connection). */
export const OUTCOME_TRIES = 3;

/** A database failure the same statement may get past when sent again (busy, slow, locked, gone — not read-only). */
function retryableDbError(e: unknown): boolean {
  const a = dbErrorMessage(e);
  return !!a && a.status === 503 && a.code !== "db_read_only";
}

/**
 * Write a run's outcome (`finish`), sent again — 250 ms, then 500 ms later — while the database fails on it in a way
 * another try may get past. `again`: an earlier try failed, so a "lost" may be that try's own write, committed with its
 * answer lost (a DB_TIMEOUT). `error`: no try wrote it.
 */
async function writeOutcome(write: () => Promise<"ok" | "lost">): Promise<{ out: "ok" | "lost"; again: boolean } | { error: unknown }> {
  for (let i = 1; ; i++) {
    try {
      return { out: await write(), again: i > 1 };
    } catch (e) {
      if (!retryableDbError(e) || i >= OUTCOME_TRIES) return { error: e };
      await new Promise((r) => setTimeout(r, 250 * i));
    }
  }
}

/**
 * Outcomes of runs that returned but whose every write failed, per database: this process writes them at its next
 * tick, first — the job is still its claim (the statements check it) until its lock runs out, `LOCK_MS` after the
 * run's last renewal; only then could another worker take it as a job whose worker died (taken again, or failed with
 * its hook at its last attempt: the residual of a database that stays unreachable, or a process that ends, meanwhile).
 */
const unsavedOutcomes = new WeakMap<Db, Map<string, { kind: string; worker: string; write: () => Promise<"ok" | "lost"> }>>();

async function writeUnsaved(cfg: JobConfig): Promise<void> {
  const pending = unsavedOutcomes.get(cfg.db);
  if (!pending?.size) return;
  for (const [id, u] of [...pending]) {
    let out: "ok" | "lost";
    try {
      out = await u.write();
    } catch {
      continue; // the database still fails: the next tick tries again (a claim lost by then writes nothing)
    }
    pending.delete(id);
    if (out === "lost") cfg.log.warn(`job ${u.kind}: its claim was lost before its outcome could be saved`, { id, worker: u.worker });
    else cfg.log.info(`job ${u.kind}: its outcome was saved at the next tick`, { id });
  }
}

/** Rows one cleanup statement deletes at most. */
export const CLEANUP_BATCH = 2000;
/** The longest a tick spends on cleanup. */
export const CLEANUP_MS = 2000;
/**
 * Done jobs older than 3 days, oldest first, by their row address: an Index Scan of sm_jobs_finished_idx, LockRows and
 * a Tid Scan (2,000 of 82,000 rows in 1.6 ms) — `id in (select … limit n)` was planned as a hash semi join over a
 * sequential scan of the whole table, once per batch. Rows another worker holds are skipped (they are not finished).
 */
export const CLEANUP_DONE_SQL = `delete from sm_jobs where ctid = any(array(select ctid from sm_jobs where status = 'done' and done_at < now() - interval '3 days' order by done_at limit ${CLEANUP_BATCH} for update skip locked))`;
/** Failed jobs older than 30 days, the same way (sm_jobs_finished_idx or sm_jobs_failed_idx). */
export const CLEANUP_FAILED_SQL = `delete from sm_jobs where ctid = any(array(select ctid from sm_jobs where status = 'failed' and done_at < now() - interval '30 days' order by done_at limit ${CLEANUP_BATCH} for update skip locked))`;

let lastCleanup = 0;
/**
 * Finished jobs are kept a while for inspection: done 3 days, failed 30 days — deleted at most once an hour per process,
 * for at most `CLEANUP_MS` of a tick (until its deadline if that comes first), done jobs first, in statements of
 * `CLEANUP_BATCH` rows (a busy organisation finishes hundreds of thousands of jobs a day, and one statement deleting
 * them all would hold the table and the WAL for long). A cleanup with nothing to delete is two index probes.
 */
async function cleanup(db: Db, deadline: number) {
  const started = Date.now();
  if (started - lastCleanup < 3600_000) return;
  lastCleanup = started;
  const until = Math.min(deadline, started + CLEANUP_MS);
  for (const statement of [CLEANUP_DONE_SQL, CLEANUP_FAILED_SQL]) {
    for (;;) {
      if (Date.now() >= until) {
        // time is up with rows perhaps left: the next tick of this process goes on
        lastCleanup = 0;
        return;
      }
      const gone = await db.one<{ n: number }>(`with gone as (${statement} returning 1) select count(*)::int as n from gone`);
      if ((gone?.n ?? 0) < CLEANUP_BATCH) break;
    }
  }
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
   * Is foreground work waiting? (The Windows app's local server: requests of its window, and of signed-in browsers of
   * the office network, in flight, src/desktop/server.ts; the server edition's scheduler leader: signed-in browser
   * requests on any worker of the cluster, src/server-edition/foreground.ts — never machine traffic such as the Windows
   * apps' sync or a probe.) Before it claims the next job (round of jobs) the runner waits until there is
   * none — at most `YIELD_MS` each time —, so a page's burst of requests is answered without the next jobs' statements
   * between them (on PGlite's one connection; for PostgreSQL's CPU and the leader's pool), and a server in constant use
   * slows the queue down without ever stopping it.
   */
  busy?: () => boolean;
  /**
   * Delete finished jobs past their retention first (default true: at most once an hour per process, at most
   * `CLEANUP_MS`). The web version's request ticks pass false, so there it runs from GET /api/cron/tick alone.
   */
  cleanup?: boolean;
  /** How long a claim lasts unless renewed (default `LOCK_MS`; tests shorten it). */
  lockMs?: number;
  /** How often a running job's lock is renewed (default `HEARTBEAT_MS`; 0: never — tests). */
  heartbeatMs?: number;
  /** How long after its claim a running job's lock is renewed at most (default `HEARTBEAT_MAX_MS`). */
  heartbeatMaxMs?: number;
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
  const timing: Timing = { lockMs: opts.lockMs ?? LOCK_MS, heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS, heartbeatMaxMs: opts.heartbeatMaxMs ?? HEARTBEAT_MAX_MS };
  let ran = 0;
  let failed = 0;
  try {
    // first what this process owes: the outcomes of runs that returned while the database failed (their claims are
    // still its own until their locks run out)
    await writeUnsaved(cfg).catch((e) => cfg.log.warn("writing unsaved job outcomes failed", String((e as Error)?.message ?? e)));
    if (opts.cleanup !== false) await cleanup(db, deadline).catch((e) => cfg.log.warn("job cleanup failed", String((e as Error)?.message ?? e)));
    await failExhausted(cfg, deadline).catch((e) => cfg.log.warn("failing exhausted jobs failed", String((e as Error)?.message ?? e)));
    await settleOwedHooks(cfg, deadline).catch((e) => cfg.log.warn("running owed exhausted hooks failed", String((e as Error)?.message ?? e)));
    while (Date.now() < deadline && ran + failed < max && !closing.has(db)) {
      if (opts.busy?.()) {
        await quietFor(opts.busy, Math.min(YIELD_MS, deadline - Date.now()));
        if (Date.now() >= deadline || closing.has(db)) break;
      }
      const jobs = await claim(db, worker, Math.min(width, max - ran - failed), timing.lockMs);
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
          for (const job of group) out.push(await runOne(cfg, job, deadline, worker, timing));
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

async function runOne(cfg: JobConfig, job: Job, deadline: number, worker: string, t: Timing): Promise<boolean> {
  const db = cfg.db;
  const handler = handlerFor(job.kind);
  const claimed = Date.now();
  const lost = () => cfg.log.warn(`job ${job.kind}: its claim was lost`, { id: job.id, worker });
  /** Write the payload (and renew the lock, within the heartbeat's maximum) — only while this worker holds the claim. */
  const keep = async (q: Queryable, payload: Record<string, unknown>) => {
    const renew = Date.now() - claimed < t.heartbeatMaxMs;
    const r = await q.query(
      `update sm_jobs set payload = $2::jsonb${renew ? ", locked_until = greatest(locked_until, now() + ($4::bigint * interval '1 millisecond'))" : ""}
       where id = $1 and status = 'running' and locked_by = $3 returning id`,
      renew ? [job.id, JSON.stringify(payload), worker, msParam(t.lockMs)] : [job.id, JSON.stringify(payload), worker],
    );
    if (!r.length) throw new JobClaimLost(job.id);
  };
  const jctx: JobContext = {
    cfg,
    db,
    log: cfg.log,
    // a closing server (stopTicks): a job that looks at its deadline as it goes ends at its next look, and is queued again
    get deadline() {
      return closing.has(db) ? Math.min(deadline, Date.now()) : deadline;
    },
    save: async (payload) => {
      await keep(db, payload);
      job.payload = payload as Record<string, any>;
    },
    saveIn: (q, payload) => keep(q, payload),
  };
  let r: JobResult;
  try {
    if (!handler) throw new Error(`no handler for job kind "${job.kind}"`);
    // the write-lock probe of measurement runs labels the locks a job takes with its kind (a no-op otherwise); a demo
    // job's writes are demo data (src/server/db/scope.ts), any other job's are not.
    // A deadlock or a serialization failure rolled the handler's transaction back (writes of one organisation run side
    // by side): it runs again at once, a few times, before it counts as a failed attempt (handlers are retried anyway).
    // A run again starts from the progress the job committed — the payload as stored (`saveIn` writes it inside the
    // handler's own transactions), exactly what a later attempt would read
    let runs = 0;
    const stopBeat = heartbeat(db, job.id, worker, t, claimed);
    try {
      r = await retryTransient(async () => {
        if (runs++ > 0) {
          const stored = await db.one<{ payload: Record<string, any> }>(`select payload from sm_jobs where id = $1`, [job.id]);
          if (stored) job.payload = stored.payload;
        }
        return inDemoScope(job.demo && job.org_id ? job.org_id : null, () => withLockLabel(`job ${job.kind}`, () => handler!(job, jctx)));
      }, 4);
    } finally {
      stopBeat();
    }
  } catch (e) {
    if (e instanceof JobClaimLost) {
      lost();
      return false;
    }
    await handlerFailed(cfg, job, worker, e, lost);
    return false;
  }
  // The handler returned: a success, whatever happens while its outcome is written — a run that returned forgives the
  // failures before it (only consecutive ones exhaust a job), and a database failure on that write is tried again,
  // then at this process's next tick; never the handler-failure path, which at a last attempt would fail the job and
  // run its kind's exhausted hook on a healthy row (a demo load «failed», a synchronisation's source «failing»)
  const write = () =>
    r && typeof r.again === "number" ? finish(db, job, worker, "queued", { runInMs: r.again, forgive: true }) : finish(db, job, worker, "done");
  const w = await writeOutcome(write);
  if ("out" in w) {
    if (w.out === "ok") return true;
    if (w.again) cfg.log.warn(`job ${job.kind}: its outcome was written by a try whose answer was lost, or its claim was lost`, { id: job.id, worker });
    else lost();
    return false;
  }
  let pending = unsavedOutcomes.get(db);
  if (!pending) unsavedOutcomes.set(db, (pending = new Map()));
  pending.set(job.id, { kind: job.kind, worker, write });
  cfg.log.warn(`job ${job.kind}: its outcome was not saved (written at this process's next tick)`, { id: job.id, cause: String((w.error as Error)?.message ?? w.error).slice(0, 2000) });
  return false;
}

/**
 * A handler threw (or there is none): the job is queued again with a back-off, or — a PermanentJobError, or its last
 * attempt — failed, and then its kind's exhausted hook runs (owed from the statement that fails the job; not for a
 * PermanentJobError, the handler's own decision). The outcome's write is tried again on a database failure; if no try
 * writes it, the job stays claimed until its lock expires (then taken again, or failed as exhausted). Never throws: the
 * tick waits for every group it claimed.
 */
async function handlerFailed(cfg: JobConfig, job: Job, worker: string, e: unknown, lost: () => void): Promise<void> {
  const error = String((e as Error)?.message ?? e).slice(0, 2000);
  const permanent = e instanceof PermanentJobError;
  const last = permanent || job.attempts >= job.max_attempts;
  const owe = last && !permanent && !!exhaustedFor(job.kind);
  const w = await writeOutcome(() =>
    last
      ? finish(cfg.db, job, worker, "failed", { error, ...(owe ? { owe: "error" as const } : {}) })
      : finish(cfg.db, job, worker, "queued", { error, runInMs: backoffMs(job.attempts) }),
  );
  if (!("out" in w)) {
    cfg.log.warn(`job ${job.kind}: its outcome was not saved`, { id: job.id, error, cause: String((w.error as Error)?.message ?? w.error).slice(0, 2000) });
    return;
  }
  if (w.out === "lost") {
    if (!w.again) lost();
    return;
  }
  if (!last) return;
  cfg.log.warn(`job ${job.kind} failed`, { id: job.id, error });
  // its last attempt failed: the kind settles what the job left
  if (owe) await runExhaustedHook(cfg, { ...job, status: "failed", last_error: error }, "error", error, 1);
}

/**
 * Is there work for a tick — a queued job that is due, a failed job's exhausted hook owed again, or a running job whose
 * worker's lock expired? Three probes of the partial indexes sm_jobs_due_idx, sm_jobs_hook_due_idx and
 * sm_jobs_running_idx (about 1 ms). The web version asks after a request's answer,
 * in the work it hands to `waitUntil` (src/server/app.ts), and ticks only when there is work.
 */
export async function queueHasDue(q: Queryable): Promise<boolean> {
  const r = await q.one<{ due: boolean }>(
    `select (exists (select 1 from sm_jobs where status = 'queued' and run_at <= now())
             or exists (select 1 from sm_jobs where status = 'failed' and hook_due is not null and updated_at < now() - ${HOOK_PAUSE_SQL})
             or exists (select 1 from sm_jobs where status = 'running' and locked_until < now())) as due`,
  );
  return !!r?.due;
}

// ----- the web version's traffic tick --------------------------------------------------------------------------------

/** How often the web version lets a request run the queue (per instance), when a job is due. */
export const TRAFFIC_TICK_EVERY_MS = 60_000;
/** The budget of such a tick: about two of a new organisation's seed jobs (3–5 s each). */
export const TRAFFIC_TICK_BUDGET_MS = 8000;

/** A moment on both clocks: the wall clock (`Date.now()`) and the monotonic one (`performance.now()`). */
export interface TrafficClock {
  wall: number;
  mono: number;
}

const NEVER: TrafficClock = { wall: Number.NEGATIVE_INFINITY, mono: Number.NEGATIVE_INFINITY };
let lastTraffic: TrafficClock = NEVER;

/**
 * Is a traffic tick due — `everyMs` gone by on either clock since `last`? The larger of the two gaps counts: a paused
 * instance (Vercel's Fluid compute freezes it between requests) may come back with its monotonic clock barely moved but
 * the wall clock right, and a wall clock stepped back is still gated by the monotonic one.
 */
export function trafficTickDue(now: TrafficClock, last: TrafficClock, everyMs = TRAFFIC_TICK_EVERY_MS): boolean {
  return Math.max(now.wall - last.wall, now.mono - last.mono) >= everyMs;
}

/** Both clocks now. */
export function trafficClock(): TrafficClock {
  return { wall: Date.now(), mono: performance.now() };
}

/** When this instance last looked at the queue for its traffic (minus infinity on both clocks: not yet). */
export function lastTrafficTick(): TrafficClock {
  return lastTraffic;
}

/** This instance looked at the queue now (a traffic tick's probe, or a write that queued jobs and probed). */
export function stampTraffic(at: TrafficClock = trafficClock()): void {
  lastTraffic = at;
}

/** Forget the stamp (tests): the next request may run a traffic tick. */
export function resetTrafficTick(): void {
  lastTraffic = NEVER;
}

// ----- the consoles' «لغو» and «دوباره» ------------------------------------------------------------------------------

/** The last error of a queued job an administrator canceled («لغو»): what its kind's row shows too. */
export const CANCELED_ERROR = "لغو به دست مدیر";

/**
 * Cancel a queued job («لغو» in the consoles; `orgId`: only that organisation's): it ends `failed` with CANCELED_ERROR
 * and, like a job that ended without finishing, its kind's exhausted hook gives the last word (cause "canceled") — a
 * backup «queued» ends «failed», an agent's run no longer blocks the agent, a chain's next round is queued at its
 * interval — owed from the same statement. Returns the job as it ended, or null when no queued job has the id.
 */
export async function cancelQueuedJob(cfg: JobConfig, id: string, orgId: string | null): Promise<Job | null> {
  const scope = orgId ? "and org_id = $2" : "";
  const found = await cfg.db.one<{ kind: string }>(`select kind from sm_jobs where id = $1 and status = 'queued' ${scope}`, orgId ? [id, orgId] : [id]);
  if (!found) return null;
  const owe = !!exhaustedFor(found.kind);
  const reason = orgId ? "$3" : "$2";
  const job = await cfg.db.one<Job>(
    `update sm_jobs set status = 'failed', last_error = ${reason}, done_at = now(), updated_at = now()${owe ? ", hook_due = 'canceled', hook_tries = 1" : ""}
     where id = $1 and status = 'queued' ${scope} returning *, ${DEMO_JOB_SQL} as demo`,
    orgId ? [id, orgId, CANCELED_ERROR] : [id, CANCELED_ERROR],
  );
  if (!job) return null;
  if (owe) await runExhaustedHook(cfg, job, "canceled", CANCELED_ERROR, 1);
  return job;
}

/** What «دوباره» queued: the failed job itself, or (`twin`) the queued next round of its chain, due now. */
export interface RetriedJob {
  id: string;
  kind: string;
  org_id: string | null;
  twin: boolean;
}

/**
 * Run a failed job again now («دوباره» in the consoles; `orgId`: only that organisation's), with fresh attempts and
 * nothing owed. A job with a dedupe key whose next round is already queued — a chain's exhausted hook re-armed it at its
 * interval, or a save queued it — cannot be queued beside it (sm_jobs_dedupe_uk): that round is brought forward to now
 * instead, and the failed one stays as it ended. Not inside a transaction (a twin queued meanwhile is caught as the
 * unique violation). Null: no failed job has the id.
 */
export async function retryFailedJob(q: Queryable, id: string, orgId: string | null): Promise<RetriedJob | null> {
  const params = orgId ? [id, orgId] : [id];
  const scope = (alias: string) => (orgId ? `and ${alias}org_id = $2` : "");
  const forward = () =>
    q.one<{ id: string; kind: string; org_id: string | null }>(
      `update sm_jobs t set run_at = least(t.run_at, now()), attempts = 0, updated_at = now()
       from sm_jobs f
       where f.id = $1 and f.status = 'failed' ${scope("f.")} and f.dedupe_key is not null
         and t.status = 'queued' and t.dedupe_key = f.dedupe_key and coalesce(t.org_id, '${NIL}'::uuid) = coalesce(f.org_id, '${NIL}'::uuid)
       returning t.id, t.kind, t.org_id`,
      params,
    );
  const twin = await forward();
  if (twin) return { ...twin, twin: true };
  try {
    const r = await q.one<{ id: string; kind: string; org_id: string | null }>(
      `update sm_jobs set status = 'queued', attempts = 0, run_at = now(), locked_until = null, locked_by = null, done_at = null,
              hook_due = null, hook_tries = 0, updated_at = now()
       where id = $1 and status = 'failed' ${scope("")} returning id, kind, org_id`,
      params,
    );
    return r ? { ...r, twin: false } : null;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const late = await forward();
    return late ? { ...late, twin: true } : null;
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

// Cloud (Vercel) wiring: one Hono app per server instance, Supabase through DATABASE_URL.
// Environment is read lazily so `next build` passes without any variables.
//
// No request is ever served on a half-built database. A cold instance first asks whether the schema is this build's
// and whether anything is left of a move into another cluster (one query, ./db/schema-check.ts). Until both are done,
// every /api request answers 503 `migrating` with the progress — the web UI shows «آماده‌سازی پایگاه داده» — while the
// missing steps run after those answers (Next.js `after`, inside the function's time limit), a second or two each,
// resuming where the last one stopped: the schema's (./db/migrate.ts), then the restamp of the synced rows ahead of the
// database's transaction ids (./sync/snapshot.ts restampSteps). The preferred path runs them before any request: the
// Vercel build or scripts/migrate-db.mts from any computer. The app itself (every module) is loaded only once the
// schema is current.
//
// Nothing waits without a bound (Supabase's transaction pooler, Vercel's 60 s cut): the pool's options are
// webPoolOptions (no pipelining, a queue timeout, server-side limits per transaction, a client deadline per statement,
// a fresh pool after a long idle — ./db/postgres.ts), and every request is answered 10 s before its function's cut
// (requestDeadlineMs: 50 s in the API function, 290 s in the assistant's; 503 `timeout`) while its work goes on
// bounded. A database that is busy, slow, locked or gone answers a 503 with a
// tracking code (./http/errors.ts dbErrorMessage), never a 500.
import { after } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { createPostgresDb, withTxLimits, type PostgresOptions, type TxLimits } from "./db/postgres";
import type { Db } from "./db";
import { consoleLogger } from "./context";
import { coldStart, poolerMode } from "./db/schema-check";
import { dbErrorMessage, type AppError } from "./http/errors";
import { APP_VERSION } from "@shared/constants";

type FetchApp = { fetch: (req: Request) => Response | Promise<Response> };
type Env = Record<string, string | undefined>;

/** Time one request may spend on migration steps after its answer (the route's maxDuration is 60 s). */
const stepBudgetMs = () => Math.max(2_000, Number(process.env.MIGRATE_STEP_BUDGET_MS ?? 25_000));
const databaseUrl = () => process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

// ----------------------------------------------------------------------------------------------- the web pool

/** Server-side limits of every web transaction: half the function's 60 s; locks and gaps far below it. */
export const WEB_TX_LIMITS: TxLimits = { statementMs: 30_000, lockMs: 10_000, idleMs: 15_000 };
/**
 * …and of the migration steps the web version runs after its answers: a step must end inside the `after` window or
 * the platform kills it and it repeats forever, so it fails visibly instead (and the message points to
 * scripts/migrate-db.mts, which runs them without limits); a DDL waiting for its lock blocks every reader of the table.
 */
export const MIGRATION_TX_LIMITS: TxLimits = { statementMs: 30_000, lockMs: 5_000, idleMs: 15_000 };
/** The client's deadline per statement (a CancelRequest), and when it gives up (postgres.ts' grace is 5 s). */
const STATEMENT_CLIENT_MS = 30_000;
const STATEMENT_GIVE_UP_MS = STATEMENT_CLIENT_MS + 5_000;
const QUEUE_TIMEOUT_S = 10;
const CONNECT_TIMEOUT_S = 8;
const IDLE_TIMEOUT_S = 20;
const REPLACE_IDLE_AFTER_MS = 60_000;

/**
 * The web version's pool, the same in every pooler mode (src/server/db/postgres.ts has the reasons):
 * - max 3 (DATABASE_POOL_MAX): Supabase Free's Supavisor pool is small, and more client sockets add no backends;
 * - no pipelining: Supavisor v2.9 loses the answer of a statement pipelined behind another;
 * - a connection within 10 s or QUEUE_TIMEOUT (503 db_busy): legitimate waits are milliseconds to ~2 s;
 * - connect within 8 s (a TLS + SCRAM connect takes 50–300 ms; under the queue timeout, so an unreachable database
 *   reports as unreachable, not busy);
 * - WEB_TX_LIMITS per transaction, a CancelRequest at 30 s and DB_TIMEOUT at 35 s per statement;
 * - a fresh pool after 60 s idle (3 × idle_timeout: its sockets are closed already or sat in a paused instance).
 */
export function webPoolOptions(url: string, env: Env = process.env): PostgresOptions {
  return {
    url,
    max: Number(env.DATABASE_POOL_MAX ?? 3),
    ssl: env.DATABASE_SSL !== "disable",
    maxPipeline: 1,
    queueTimeoutSec: QUEUE_TIMEOUT_S,
    connectTimeout: CONNECT_TIMEOUT_S,
    idleTimeout: IDLE_TIMEOUT_S,
    txLimits: WEB_TX_LIMITS,
    statementClientMs: STATEMENT_CLIENT_MS,
    replaceIdleAfterMs: REPLACE_IDLE_AFTER_MS,
    // a pool replaced after a quiet minute is routine on a site with little traffic (info); a statement given up, and
    // the pool replaced for it, is what the owner looks for under Level: Warning (docs/SETUP_FA.md §۹)
    onEvent: (e) =>
      e.kind === "replaced" && e.reason === "idle"
        ? consoleLogger.info(`database pool replaced (idle, idle ${Math.round(e.idleMs / 1000)} s)`)
        : consoleLogger.warn(
            e.kind === "replaced" ? `database pool replaced (${e.reason}, idle ${Math.round(e.idleMs / 1000)} s)` : `a database statement got no answer in ${e.ms} ms: given up`,
          ),
  };
}

/** The limit of the API function (app/api/[[...route]]/route.ts `maxDuration`) that REQUEST_DEADLINE_MS is set for. */
const API_MAX_DURATION_S = 60;

/**
 * When a request is answered at the latest (503 `timeout`): 10 s before its function's cut, for the answer and `after`.
 * REQUEST_DEADLINE_MS is the API function's (60 s); a function with another limit keeps the same margin before its own
 * — the assistant's routes (app/api/o/[org]/ai, 300 s), whose answers that are not streamed (a skill run, its evals, a
 * cited answer, an analytical question, a connection test) may legitimately take minutes.
 */
export function requestDeadlineMs(env: Env = process.env, maxDurationS = API_MAX_DURATION_S): number {
  const raw = env.REQUEST_DEADLINE_MS;
  const n = raw === undefined || raw === "" ? 50_000 : Number(raw);
  const api = Number.isFinite(n) ? Math.max(1_000, n) : 50_000;
  return Math.max(1_000, api + (maxDurationS - API_MAX_DURATION_S) * 1_000);
}

/** What /api/health tells about the web version's database connection and its bounds (docs/SETUP_FA.md §۹). */
export function describeWebDatabase(url: string, env: Env = process.env) {
  const o = webPoolOptions(url, env);
  return {
    pooler: poolerMode(url),
    pool: { max: o.max, pipeline: o.maxPipeline, queue_timeout_s: o.queueTimeoutSec, connect_timeout_s: o.connectTimeout, replace_idle_after_s: (o.replaceIdleAfterMs ?? 0) / 1000 },
    limits: {
      statement_ms: WEB_TX_LIMITS.statementMs,
      lock_ms: WEB_TX_LIMITS.lockMs,
      idle_in_transaction_ms: WEB_TX_LIMITS.idleMs,
      client_cancel_ms: STATEMENT_CLIENT_MS,
      client_give_up_ms: STATEMENT_GIVE_UP_MS,
      request_deadline_ms: requestDeadlineMs(env),
    },
    migration_limits: { statement_ms: MIGRATION_TX_LIMITS.statementMs, lock_ms: MIGRATION_TX_LIMITS.lockMs, idle_in_transaction_ms: MIGRATION_TX_LIMITS.idleMs },
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

/** A failure nobody planned for: logged with its stack under an id the person can quote. */
export function failure(code: string, message: string, e: unknown, status = 500): Response {
  const id = randomUUID().slice(0, 8);
  consoleLogger.error(`${code} [${id}]`, String((e as Error)?.stack ?? e));
  return json(status, { ok: false, error: { code, message: `${message} (کد پیگیری: ${id})`, details: { error_id: id } } });
}

/** A database that is busy, slow or gone (./http/errors.ts): the 503 hono.ts errorResponse gives, with its log line. */
function dbAnswer(mapped: AppError, req: Request, e: unknown): Response {
  const id = randomUUID().slice(0, 8);
  const details = (mapped.details ?? {}) as { retry_after_s?: number; db_code?: string };
  consoleLogger.warn(`database unavailable [${id}] ${details.db_code ?? mapped.code}`, { method: req.method, path: new URL(req.url).pathname, err: String((e as Error)?.message ?? e).slice(0, 300) });
  const retry = details.retry_after_s ?? (mapped.code === "retry" ? 1 : undefined);
  return json(mapped.status, { error: { code: mapped.code, message: `${mapped.message} (کد پیگیری: ${id})`, details: { ...details, error_id: id } } }, retry ? { "retry-after": String(retry) } : {});
}

/**
 * What a failed cold start answers (before the schema is known to be current): QUEUE_TIMEOUT while this instance's own
 * migration steps hold the pool is «migrating» (the steps are the reason); a busy pool or pooler is its 503 db_busy;
 * null for anything else — the caller's db_unreachable.
 */
export function coldStartAnswer(e: unknown, migrating: boolean): "migrating" | AppError | null {
  if ((e as { code?: unknown } | null)?.code === "QUEUE_TIMEOUT" && migrating) return "migrating";
  const mapped = dbErrorMessage(e);
  return mapped?.code === "db_busy" ? mapped : null;
}

/** The progress line of a migration step that failed: a timeout or a lock wait in words, anything else as it came. */
export function migrationStepError(e: unknown, next: string | null): string {
  const code = (e as { code?: unknown } | null)?.code;
  const step = next ? `مرحلهٔ «${next}»` : "مرحلهٔ بعدی";
  if (code === "57014" || code === "DB_TIMEOUT") return `${step} در زمان مجاز نسخهٔ وب تمام نشد؛ scripts/migrate-db.mts را از رایانهٔ خود اجرا کنید (docs/SETUP_FA.md بخش ۹)`;
  if (code === "55P03") return `${step} منتظر قفلی ماند که کار دیگری نگه داشته بود؛ با درخواست بعدی دوباره امتحان می‌شود`;
  return String((e as Error)?.message ?? e).slice(0, 300);
}

/** 503 `timeout`: the request took longer than REQUEST_DEADLINE_MS (its work goes on, bounded, after this answer). */
function deadlineResponse(req: Request, ms: number): Response {
  const id = randomUUID().slice(0, 8);
  consoleLogger.warn(`request deadline [${id}] ${req.method} ${new URL(req.url).pathname}`);
  const message = `پاسخ این درخواست بیش از حد طول کشید؛ چند لحظهٔ دیگر دوباره امتحان کنید. اگر چیزی ذخیره می‌کردید، پیش از تکرار صفحه را تازه کنید تا ببینید ذخیره شده است یا نه (کد پیگیری: ${id})`;
  return json(503, { error: { code: "timeout", message, details: { error_id: id, retry_after_s: 5, deadline_ms: ms } } }, { "retry-after": "5" });
}

// ----------------------------------------------------------------------------------------------- per instance

interface Progress {
  done: number;
  total: number;
  next: string | null;
  error: string | null;
}

let db: Db | null = null;
let ready = false;
let readyCheck: Promise<boolean> | null = null;
let appPromise: Promise<FetchApp> | null = null;
let progress: Progress | null = null;
let running = false;

function database(url: string): Db {
  // a serverless instance answers one request or a few at a time (Fluid compute): a small pool, reused by every request
  db ??= createPostgresDb(webPoolOptions(url));
  return db;
}

/** The progress line while the synced rows of a database moved into another cluster are restamped. */
const RESTAMP_LABEL = "نسخه‌های همگام‌سازی پس از جابه‌جایی پایگاه داده";
const restampLabel = (table: string | null) => (table ? `${RESTAMP_LABEL} (${table})` : RESTAMP_LABEL);

/**
 * Is the schema current, with nothing left of a move into another cluster? Once true it stays true for the instance (a
 * new deployment is a new instance) — until a pull finds the database gone back in transaction ids (`xidRegression`).
 */
async function schemaReady(d: Db): Promise<boolean> {
  if (ready) return true;
  readyCheck ??= (async () => {
    const start = await coldStart(d);
    // the fingerprint `npm run schema` wrote; when it does not match (a stale file, a test registry) the real plan decides
    let complete = start.current;
    if (!complete) {
      const { schemaProgress } = await import("./db/migrate");
      const p = await schemaProgress(d);
      progress = { done: p.done, total: p.total, next: p.next, error: progress?.error ?? null };
      complete = p.complete;
    }
    if (complete && start.xidWaiting) {
      // the restamp's steps report their own progress (runSteps); until the first one, its label alone
      if (!progress?.next?.startsWith(RESTAMP_LABEL)) progress = { done: 0, total: 0, next: RESTAMP_LABEL, error: progress?.error ?? null };
      return false;
    }
    return complete;
  })().finally(() => {
    readyCheck = null;
  });
  ready = await readyCheck;
  return ready;
}

/**
 * Migration steps for one budget, then — the schema current — the restamp's steps for what is left of it: one run per
 * instance at a time; another instance holding the lock makes it stop. Their transactions carry MIGRATION_TX_LIMITS.
 */
async function runSteps(d: Db): Promise<void> {
  if (running) return;
  running = true;
  let phase: "schema" | "restamp" = "schema";
  try {
    await withTxLimits(MIGRATION_TX_LIMITS, async () => {
      const started = Date.now();
      const { migrateSteps } = await import("./db/migrate");
      const r = await migrateSteps(d, { budgetMs: stepBudgetMs(), wait: false, log: (m) => consoleLogger.info(m) });
      const schema = { done: r.done, total: r.total, next: r.next, error: null };
      if (!r.complete || r.busy) {
        progress = schema;
        return;
      }
      // a database moved into another cluster: its synced rows ahead of the transaction ids are restamped in short steps;
      // the epochs move and the mark is lowered only by the one that finishes (./sync/snapshot.ts). Its own progress line
      // (the synced tables) replaces the schema's only while it runs.
      phase = "restamp";
      const { restampSteps } = await import("./sync/snapshot");
      const x = await restampSteps(d, { budgetMs: Math.max(0, stepBudgetMs() - (Date.now() - started)), wait: false, log: (m) => consoleLogger.warn(m) });
      if (x.waiting) progress = { done: x.done, total: x.total, next: restampLabel(x.table), error: null };
      else {
        progress = schema;
        ready = true;
      }
    });
  } catch (e) {
    const id = randomUUID().slice(0, 8);
    consoleLogger.error(`migration step failed [${id}]`, String((e as Error)?.stack ?? e));
    // the step that failed is the first one still pending (its transaction rolled back)
    let next = progress?.next ?? null;
    if (phase === "schema") {
      const { schemaProgress } = await import("./db/migrate");
      next = (await schemaProgress(d).catch(() => null))?.next ?? next;
    } else if (!next?.startsWith(RESTAMP_LABEL)) next = RESTAMP_LABEL;
    progress = { ...(progress ?? { done: 0, total: 0, next: null }), error: `${migrationStepError(e, next)} (کد پیگیری: ${id})` };
  } finally {
    running = false;
  }
}

function inBackground(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}

function migratingResponse(path: string, url: string): Response {
  const auto = process.env.AUTO_MIGRATE !== "false";
  const p = progress ?? { done: 0, total: 0, next: null, error: null };
  const percent = p.total ? Math.floor((p.done / p.total) * 100) : 0;
  const message = auto
    ? `پایگاه داده در حال آماده‌سازی است${p.total ? ` (${fa(p.done)} از ${fa(p.total)} مرحله)` : ""}؛ چند لحظه دیگر خودکار ادامه می‌دهد`
    : "پایگاه داده به‌روز نیست و اجرای خودکار مرحله‌ها خاموش است (AUTO_MIGRATE=false): scripts/migrate-db.mts را اجرا کنید (docs/SETUP_FA.md بخش ۹)";
  const schema = { complete: false, done: p.done, total: p.total, percent, next: p.next, auto, error: p.error };
  const error = { code: "migrating", message, details: schema };
  const headers = { "retry-after": "3" };
  if (path === "/api/health")
    return json(503, { ok: false, db: "ok", mode: "cloud", version: APP_VERSION, schema, pooler: poolerMode(url), database: describeWebDatabase(url), error }, headers);
  return json(503, { error }, headers);
}

function notConfigured(): Response {
  return json(503, { ok: false, error: { code: "not_configured", message: "پایگاه داده تنظیم نشده است: متغیر DATABASE_URL را در Vercel بگذارید (راهنما: docs/SETUP_FA.md)", details: null } });
}

/**
 * The high-water mark of the transaction ids the database handed out, raised once per instance while its app loads
 * (./sync/snapshot.ts: what tells a database moved by dump into another cluster — a Supabase project restored elsewhere
 * — from one that was not). A regression it finds is handled like a schema that is not current: this instance answers
 * 503 «migrating» while the restamp's steps run (runSteps). Never fails the start.
 */
async function raiseXidMark(d: Db): Promise<void> {
  try {
    const { xidRegressionWaiting } = await import("./sync/snapshot");
    if (await xidRegressionWaiting(d, { force: true, log: (m) => consoleLogger.warn(m) })) ready = false;
  } catch (e) {
    consoleLogger.warn("xid check skipped", String((e as Error)?.message ?? e));
  }
}

async function buildApp(d: Db, url: string): Promise<FetchApp> {
  // the mark is raised while the app's modules load (handleCloud asks again whether the instance is ready)
  const [{ createApp }] = await Promise.all([import("./app"), raiseXidMark(d)]);
  const secret = process.env.APP_SECRET || createHash("sha256").update(`itsm:${url}`).digest("hex");
  return createApp({
    mode: "cloud",
    db: d,
    secret,
    // keys of AI connections are refused while the secret is only derived from the database URL
    secretSource: process.env.APP_SECRET ? "env" : "derived",
    allowSignup: process.env.ALLOW_SIGNUP !== "false",
    platformAdmins: (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    origin: "cloud",
    publicUrl: process.env.PUBLIC_URL,
    log: consoleLogger,
    fetch: globalThis.fetch.bind(globalThis),
    database: { pooler: poolerMode(url) },
    // background work after the response (Next.js `after` keeps the Vercel function alive for it)
    waitUntil: (work) => {
      try {
        after(work);
      } catch {
        void work().catch(() => undefined);
      }
    },
    // a pull found the database gone back in transaction ids (moved under this instance): every request answers 503
    // «migrating» again, and the restamp's steps run after those answers (schemaReady, runSteps)
    xidRegression: () => {
      ready = false;
    },
  });
}

/** 503 «migrating» with the progress, and the next steps after the answer (unless AUTO_MIGRATE=false). */
function notReady(d: Db, req: Request, url: string): Response {
  if (process.env.AUTO_MIGRATE !== "false" && !running) inBackground(() => runSteps(d));
  return migratingResponse(new URL(req.url).pathname, url);
}

/** /api/health with what the web version knows about its database connection and its bounds. */
async function withDatabase(res: Response, url: string): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ ...body, database: describeWebDatabase(url) }), { status: res.status, headers });
}

/** Answer one /api request of the web version (handleCloud bounds it in time). */
async function answer(req: Request): Promise<Response> {
  const url = databaseUrl();
  if (!url) return notConfigured();
  let d: Db;
  try {
    d = database(url);
    if (!(await schemaReady(d))) return notReady(d, req, url);
  } catch (e) {
    const cold = coldStartAnswer(e, running);
    if (cold === "migrating" && db) return notReady(db, req, url);
    if (cold && cold !== "migrating") return dbAnswer(cold, req, e);
    return failure("db_unreachable", "پایگاه داده پاسخ نمی‌دهد؛ DATABASE_URL (نشانی Transaction pooler با درگاه 6543) و روشن بودن پروژهٔ Supabase را بررسی کنید", e, 503);
  }
  try {
    appPromise ??= buildApp(d, url).catch((e) => {
      appPromise = null;
      throw e;
    });
    const app = await appPromise;
    // the database found gone back in transaction ids while the app loaded: answered like a schema that is not current
    if (!ready) return notReady(d, req, url);
    const res = await app.fetch(req);
    return new URL(req.url).pathname === "/api/health" ? await withDatabase(res, url) : res;
  } catch (e) {
    const mapped = dbErrorMessage(e);
    if (mapped?.status === 503) return dbAnswer(mapped, req, e);
    return failure("internal", "خطای داخلی سرور؛ دوباره امتحان کنید", e);
  }
}

/**
 * Answer one /api request of the web version — within its deadline (requestDeadlineMs: 10 s before the cut of the
 * function it runs in, `maxDurationS` of its route file — 60 s unless it says otherwise): past it the person gets 503
 * `timeout` while the work goes on in the background, its statements bounded by the pool (a streamed answer counts as
 * answered once its headers are out).
 */
export async function handleCloud(req: Request, opts: { maxDurationS?: number } = {}): Promise<Response> {
  const deadline = requestDeadlineMs(process.env, opts.maxDurationS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = answer(req);
  work.catch(() => undefined);
  const late = new Promise<Response>((resolve) => {
    timer = setTimeout(() => resolve(deadlineResponse(req, deadline)), deadline);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Close this instance's database pool and forget its state (tests start the web entry afresh). */
export async function closeCloud(): Promise<void> {
  const d = db;
  db = null;
  ready = false;
  appPromise = null;
  progress = null;
  await d?.close();
}

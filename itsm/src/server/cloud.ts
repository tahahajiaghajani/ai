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
import { after } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { createPostgresDb } from "./db/postgres";
import type { Db } from "./db";
import { consoleLogger } from "./context";
import { coldStart, poolerMode } from "./db/schema-check";
import { APP_VERSION } from "@shared/constants";

type FetchApp = { fetch: (req: Request) => Response | Promise<Response> };

/** Time one request may spend on migration steps after its answer (the route's maxDuration is 60 s). */
const stepBudgetMs = () => Math.max(2_000, Number(process.env.MIGRATE_STEP_BUDGET_MS ?? 25_000));
const databaseUrl = () => process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

/** A failure nobody planned for: logged with its stack under an id the person can quote. */
export function failure(code: string, message: string, e: unknown, status = 500): Response {
  const id = randomUUID().slice(0, 8);
  consoleLogger.error(`${code} [${id}]`, String((e as Error)?.stack ?? e));
  return json(status, { ok: false, error: { code, message: `${message} (کد پیگیری: ${id})`, details: { error_id: id } } });
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
  db ??= createPostgresDb({ url, max: Number(process.env.DATABASE_POOL_MAX ?? 3), ssl: process.env.DATABASE_SSL !== "disable" });
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
 * instance at a time; another instance holding the lock makes it stop.
 */
async function runSteps(d: Db): Promise<void> {
  if (running) return;
  running = true;
  try {
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
    const { restampSteps } = await import("./sync/snapshot");
    const x = await restampSteps(d, { budgetMs: Math.max(0, stepBudgetMs() - (Date.now() - started)), wait: false, log: (m) => consoleLogger.warn(m) });
    if (x.waiting) progress = { done: x.done, total: x.total, next: restampLabel(x.table), error: null };
    else {
      progress = schema;
      ready = true;
    }
  } catch (e) {
    const id = randomUUID().slice(0, 8);
    consoleLogger.error(`migration step failed [${id}]`, String((e as Error)?.stack ?? e));
    progress = { ...(progress ?? { done: 0, total: 0, next: null }), error: `${String((e as Error)?.message ?? e).slice(0, 300)} (کد پیگیری: ${id})` };
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

function migratingResponse(path: string): Response {
  const auto = process.env.AUTO_MIGRATE !== "false";
  const p = progress ?? { done: 0, total: 0, next: null, error: null };
  const percent = p.total ? Math.floor((p.done / p.total) * 100) : 0;
  const message = auto
    ? `پایگاه داده در حال آماده‌سازی است${p.total ? ` (${fa(p.done)} از ${fa(p.total)} مرحله)` : ""}؛ چند لحظه دیگر خودکار ادامه می‌دهد`
    : "پایگاه داده به‌روز نیست و اجرای خودکار مرحله‌ها خاموش است (AUTO_MIGRATE=false): scripts/migrate-db.mts را اجرا کنید (docs/SETUP_FA.md بخش ۹)";
  const schema = { complete: false, done: p.done, total: p.total, percent, next: p.next, auto, error: p.error };
  const error = { code: "migrating", message, details: schema };
  const headers = { "retry-after": "3" };
  if (path === "/api/health") return json(503, { ok: false, db: "ok", mode: "cloud", version: APP_VERSION, schema, error }, headers);
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
function notReady(d: Db, req: Request): Response {
  if (process.env.AUTO_MIGRATE !== "false" && !running) inBackground(() => runSteps(d));
  return migratingResponse(new URL(req.url).pathname);
}

/** Answer one /api request of the web version. */
export async function handleCloud(req: Request): Promise<Response> {
  const url = databaseUrl();
  if (!url) return notConfigured();
  let d: Db;
  try {
    d = database(url);
    if (!(await schemaReady(d))) return notReady(d, req);
  } catch (e) {
    return failure("db_unreachable", "پایگاه داده پاسخ نمی‌دهد؛ DATABASE_URL (نشانی Transaction pooler با درگاه 6543) و روشن بودن پروژهٔ Supabase را بررسی کنید", e, 503);
  }
  try {
    appPromise ??= buildApp(d, url).catch((e) => {
      appPromise = null;
      throw e;
    });
    const app = await appPromise;
    // the database found gone back in transaction ids while the app loaded: answered like a schema that is not current
    if (!ready) return notReady(d, req);
    return await app.fetch(req);
  } catch (e) {
    return failure("internal", "خطای داخلی سرور؛ دوباره امتحان کنید", e);
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

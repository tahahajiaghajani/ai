// Cloud (Vercel) wiring: one Hono app per server instance, Supabase through DATABASE_URL.
// Environment is read lazily so `next build` passes without any variables.
//
// No request is ever served on a half-built database. A cold instance first asks whether the schema is this build's
// (one query, ./db/schema-check.ts). Until it is, every /api request answers 503 `migrating` with the progress — the
// web UI shows «آماده‌سازی پایگاه داده» — while the missing steps run after those answers (Next.js `after`, inside the
// function's time limit), a second or two each, resuming where the last one stopped (./db/migrate.ts). The preferred
// path runs them before any request: the Vercel build or scripts/migrate-db.mts from any computer. The app itself
// (every module) is loaded only once the schema is current.
import { after } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { createPostgresDb } from "./db/postgres";
import type { Db } from "./db";
import { consoleLogger } from "./context";
import { poolerMode, schemaIsCurrent } from "./db/schema-check";
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

/** Is the schema current? Once true it stays true for the instance (a new deployment is a new instance). */
async function schemaReady(d: Db): Promise<boolean> {
  if (ready) return true;
  readyCheck ??= (async () => {
    // the fingerprint `npm run schema` wrote; when it does not match (a stale file, a test registry) the real plan decides
    if (await schemaIsCurrent(d)) return true;
    const { schemaProgress } = await import("./db/migrate");
    const p = await schemaProgress(d);
    progress = { done: p.done, total: p.total, next: p.next, error: progress?.error ?? null };
    return p.complete;
  })().finally(() => {
    readyCheck = null;
  });
  ready = await readyCheck;
  return ready;
}

/** Migration steps for one budget: one run per instance at a time; another instance holding the lock makes it stop. */
async function runSteps(d: Db): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { migrateSteps } = await import("./db/migrate");
    const r = await migrateSteps(d, { budgetMs: stepBudgetMs(), wait: false, log: (m) => consoleLogger.info(m) });
    progress = { done: r.done, total: r.total, next: r.next, error: null };
    if (r.complete) ready = true;
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
 * A database moved by dump into another cluster (a Supabase project restored elsewhere) may hand out transaction ids
 * below its stored revisions: what is ahead of them starts again — rows, the Windows apps' cursors, purge watermarks —
 * before this instance answers its first pull (./sync/snapshot.ts; `migrate()` runs the same check where it runs). Every
 * instance, whether or not it ran migration steps (AUTO_MIGRATE=false included); never fails the start.
 */
async function checkXids(d: Db): Promise<void> {
  try {
    const { checkXidRegression } = await import("./sync/snapshot");
    await checkXidRegression(d, { force: true, restamp: true, log: (m) => consoleLogger.warn(m) });
  } catch (e) {
    consoleLogger.warn("xid check skipped", String((e as Error)?.message ?? e));
  }
}

async function buildApp(d: Db, url: string): Promise<FetchApp> {
  // the check runs while the app's modules load: no request of this instance reaches the app before it is done
  const [{ createApp }] = await Promise.all([import("./app"), checkXids(d)]);
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
  });
}

/** Answer one /api request of the web version. */
export async function handleCloud(req: Request): Promise<Response> {
  const url = databaseUrl();
  if (!url) return notConfigured();
  let d: Db;
  try {
    d = database(url);
    if (!(await schemaReady(d))) {
      if (process.env.AUTO_MIGRATE !== "false" && !running) inBackground(() => runSteps(d));
      return migratingResponse(new URL(req.url).pathname);
    }
  } catch (e) {
    return failure("db_unreachable", "پایگاه داده پاسخ نمی‌دهد؛ DATABASE_URL (نشانی Transaction pooler با درگاه 6543) و روشن بودن پروژهٔ Supabase را بررسی کنید", e, 503);
  }
  try {
    appPromise ??= buildApp(d, url).catch((e) => {
      appPromise = null;
      throw e;
    });
    return await (await appPromise).fetch(req);
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

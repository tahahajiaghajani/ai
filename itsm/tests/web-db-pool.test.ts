// The web version's database pool (1.1.4) through postgres.js over the PostgreSQL wire protocol (a PGlite socket
// server): the options of every pooler mode (src/server/cloud.ts webPoolOptions), the one-statement transaction
// preamble with the server-side limits and the demo scope (src/server/db/postgres.ts txPreamble), the pool replaced
// after a long idle or a statement given up, the request deadline of handleCloud, /api/health's account of the
// database bounds, and the cold start's answers. The limits themselves are enforced only by a real PostgreSQL
// (PGlite does not apply statement_timeout): tests/web-db-limits-pg.test.ts; the pooler: tests/web-db-pooler-pg.test.ts.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPostgresDb, txPreamble, withTxLimits, type PoolEvent } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
import { inDemoScope } from "@server/db/scope";
import { enqueue, registerJobHandler } from "@server/jobs";
import type { Db } from "@server/db";
import { closeCloud, coldStartAnswer, describeWebDatabase, handleCloud, migrationStepError, MIGRATION_TX_LIMITS, requestDeadlineMs, WEB_TX_LIMITS, webPoolOptions } from "@server/cloud";
import type { AppError } from "@server/http/errors";

const ORG = "0193a3c2-7d4e-7a51-9c3f-5b2e8d1a4f60";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function socketServer() {
  const pg = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  const port = Number(server.getServerConn().split(":").pop());
  return { pg, server, url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` };
}

describe("the web pool's options", () => {
  const URLS = {
    transaction: "postgresql://postgres.abcd:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres",
    session: "postgresql://postgres.abcd:pw@aws-1-eu-central-1.pooler.supabase.com:5432/postgres",
    direct: "postgresql://postgres:pw@db.abcdefghijkl.supabase.co:5432/postgres",
    other: "postgres://postgres@127.0.0.1:5432/postgres",
  };

  it("are the same in every pooler mode: no pipelining, a queue timeout, server-side limits, a client deadline, a fresh pool after 60 s idle", () => {
    for (const [mode, url] of Object.entries(URLS)) {
      const o = webPoolOptions(url, {});
      const { onEvent, ...rest } = o;
      expect(rest, mode).toEqual({
        url,
        max: 3,
        ssl: true,
        maxPipeline: 1,
        queueTimeoutSec: 10,
        connectTimeout: 8,
        idleTimeout: 20,
        txLimits: { statementMs: 30_000, lockMs: 10_000, idleMs: 15_000 },
        statementClientMs: 30_000,
        replaceIdleAfterMs: 60_000,
      });
      expect(typeof onEvent).toBe("function");
      expect(describeWebDatabase(url, {}).pooler).toBe(mode);
    }
    expect(webPoolOptions(URLS.other, { DATABASE_POOL_MAX: "1", DATABASE_SSL: "disable" })).toMatchObject({ max: 1, ssl: false, maxPipeline: 1 });
    expect(WEB_TX_LIMITS).toEqual({ statementMs: 30_000, lockMs: 10_000, idleMs: 15_000 });
    expect(MIGRATION_TX_LIMITS).toEqual({ statementMs: 30_000, lockMs: 5_000, idleMs: 15_000 });
  });

  it("the request deadline: 50 s unless REQUEST_DEADLINE_MS says otherwise, never under 1 s", () => {
    expect(requestDeadlineMs({})).toBe(50_000);
    expect(requestDeadlineMs({ REQUEST_DEADLINE_MS: "45000" })).toBe(45_000);
    expect(requestDeadlineMs({ REQUEST_DEADLINE_MS: "50" })).toBe(1_000);
    expect(requestDeadlineMs({ REQUEST_DEADLINE_MS: "" })).toBe(50_000);
    expect(requestDeadlineMs({ REQUEST_DEADLINE_MS: "soon" })).toBe(50_000);
  });

  it("/api/health's account of them", () => {
    expect(describeWebDatabase(URLS.transaction, { REQUEST_DEADLINE_MS: "45000" })).toEqual({
      pooler: "transaction",
      pool: { max: 3, pipeline: 1, queue_timeout_s: 10, connect_timeout_s: 8, replace_idle_after_s: 60 },
      limits: { statement_ms: 30_000, lock_ms: 10_000, idle_in_transaction_ms: 15_000, client_cancel_ms: 30_000, client_give_up_ms: 35_000, request_deadline_ms: 45_000 },
      migration_limits: { statement_ms: 30_000, lock_ms: 5_000, idle_in_transaction_ms: 15_000 },
    });
  });
});

describe("the transaction preamble", () => {
  it("is ONE simple-protocol statement with the limits and the demo scope", () => {
    const limits = "select set_config('statement_timeout','30000',true), set_config('lock_timeout','10000',true), set_config('idle_in_transaction_session_timeout','15000',true)";
    expect(txPreamble(WEB_TX_LIMITS, null)).toEqual({ text: limits });
    expect(txPreamble(WEB_TX_LIMITS, ORG)).toEqual({ text: `${limits}, set_config('itsm.demo','${ORG}',true)` });
    expect(txPreamble(null, ORG)).toEqual({ text: `select set_config('itsm.demo','${ORG}',true)` });
    expect(txPreamble({ statementMs: 300, lockMs: 200.7, idleMs: 400 }, null)?.text).toBe(
      "select set_config('statement_timeout','300',true), set_config('lock_timeout','200',true), set_config('idle_in_transaction_session_timeout','400',true)",
    );
  });

  it("writes only a UUID into the text; anything else goes as a parameter", () => {
    expect(txPreamble(null, "x'); drop table sm_users; --")).toEqual({ text: "select set_config('itsm.demo',$1,true)", params: ["x'); drop table sm_users; --"] });
    expect(txPreamble(MIGRATION_TX_LIMITS, "org-1")).toEqual({
      text: "select set_config('statement_timeout','30000',true), set_config('lock_timeout','5000',true), set_config('idle_in_transaction_session_timeout','15000',true), set_config('itsm.demo',$1,true)",
      params: ["org-1"],
    });
  });

  it("is null when there is nothing to set", () => {
    expect(txPreamble(null, null)).toBeNull();
    expect(txPreamble(null, "")).toBeNull();
  });
});

describe("the pool over the PostgreSQL protocol", () => {
  let w: Awaited<ReturnType<typeof socketServer>>;
  const dbs: Db[] = [];
  const pool = (o: Partial<Parameters<typeof createPostgresDb>[0]>) => {
    const db = createPostgresDb({ ...webPoolOptions(w.url, { DATABASE_SSL: "disable" }), onEvent: undefined, ...o });
    dbs.push(db);
    return db;
  };
  beforeAll(async () => {
    w = await socketServer();
  });
  afterEach(async () => {
    await Promise.all(dbs.splice(0).map((d) => d.close().catch(() => undefined)));
  });
  afterAll(async () => {
    await w?.server.stop();
    await w?.pg.close();
  });

  const settings = `select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock, current_setting('idle_in_transaction_session_timeout') as idle`;

  it("a web transaction carries its limits, the migration steps theirs, withTxLimits(null) none — and nothing leaks out of a transaction", async () => {
    const db = pool({});
    expect(await db.tx((t) => t.one(settings))).toEqual({ statement: "30s", lock: "10s", idle: "15s" });
    expect(await withTxLimits(MIGRATION_TX_LIMITS, () => db.tx((t) => t.one(settings)))).toEqual({ statement: "30s", lock: "5s", idle: "15s" });
    expect(await withTxLimits(null, () => db.tx((t) => t.one(settings)))).toEqual({ statement: "0", lock: "0", idle: "0" });
    expect(await db.one(settings)).toEqual({ statement: "0", lock: "0", idle: "0" });
    // a pool without limits (scripts/migrate-db.mts, the server edition)
    expect(await pool({ txLimits: null }).tx((t) => t.one(settings))).toEqual({ statement: "0", lock: "0", idle: "0" });
  });

  it("the demo scope comes with the limits in the same transaction, a lone demo write too", async () => {
    const db = pool({});
    const r = await inDemoScope(ORG, () => db.tx((t) => t.one(`select current_setting('itsm.demo', true) as demo, current_setting('lock_timeout') as lock`)));
    expect(r).toEqual({ demo: ORG, lock: "10s" });
    await db.exec(`create table if not exists w114_pool (id int primary key, demo text, lock text)`);
    await inDemoScope(ORG, () => db.query(`insert into w114_pool values (1, current_setting('itsm.demo', true), current_setting('lock_timeout'))`));
    expect(await db.one(`select demo, lock from w114_pool where id = 1`)).toEqual({ demo: ORG, lock: "10s" });
    expect((await db.one<{ demo: string | null }>(`select current_setting('itsm.demo', true) as demo`))?.demo ?? "").toBe("");
  });

  it("a pool left idle longer than replaceIdleAfterMs is replaced before its next statement (once), and its old sockets close", async () => {
    const events: PoolEvent[] = [];
    const db = pool({ replaceIdleAfterMs: 200, onEvent: (e) => events.push(e) });
    expect(await db.one(`select 1 as v`)).toEqual({ v: 1 });
    await sleep(80);
    expect(await db.one(`select 2 as v`)).toEqual({ v: 2 });
    expect(events).toEqual([]);
    await sleep(300);
    expect(await db.one(`select 3 as v`)).toEqual({ v: 3 });
    expect(await db.one(`select 4 as v`)).toEqual({ v: 4 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "replaced", reason: "idle" });
    expect((events[0] as { idleMs: number }).idleMs).toBeGreaterThanOrEqual(290);
    // the old pool's socket is gone: one connection is left on the server
    for (let i = 0; i < 50 && w.server.getStats().activeConnections > 1; i++) await sleep(20);
    expect(w.server.getStats().activeConnections).toBe(1);
  });
  // a statement given up (DB_TIMEOUT) needs a server in another process: PGlite runs in this thread, and a pg_sleep
  // there stops the client's timers too (tests/web-db-limits-pg.test.ts, tests/web-db-pooler-pg.test.ts)
});

describe("the web entry (handleCloud)", () => {
  let w: Awaited<ReturnType<typeof socketServer>>;
  const saved = { ...process.env };
  beforeAll(async () => {
    w = await socketServer();
    const direct = createPostgresDb({ url: w.url, ssl: false, max: 1 });
    await migrate(direct);
    await direct.close();
    Object.assign(process.env, { DATABASE_URL: w.url, DATABASE_SSL: "disable", APP_SECRET: "y".repeat(64) });
    delete process.env.CRON_SECRET;
  }, 600_000);
  afterAll(async () => {
    await closeCloud().catch(() => undefined);
    process.env = saved;
    await w?.server.stop();
    await w?.pg.close();
  });

  const call = (path: string, init?: RequestInit) => handleCloud(new Request(`http://web.test/api${path}`, init));

  it("/api/health carries the database's bounds (no pipelining), and the pooler as before", async () => {
    const res = await call("/health");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, db: "ok", pooler: "other", schema: { complete: true } });
    expect(body.database.pool).toEqual({ max: 3, pipeline: 1, queue_timeout_s: 10, connect_timeout_s: 8, replace_idle_after_s: 60 });
    expect(body.database.limits).toMatchObject({ statement_ms: 30_000, lock_ms: 10_000, idle_in_transaction_ms: 15_000, client_cancel_ms: 30_000, client_give_up_ms: 35_000 });
  });

  it("a request past REQUEST_DEADLINE_MS is answered 503 «timeout» with Retry-After while its work goes on", async () => {
    let finished!: () => void;
    const done = new Promise<void>((r) => (finished = r));
    const off = registerJobHandler("w114.sleep", async () => {
      await sleep(2_500);
      finished();
    });
    const direct = createPostgresDb({ url: w.url, ssl: false, max: 1 });
    try {
      await enqueue(direct, { kind: "w114.sleep" });
      process.env.REQUEST_DEADLINE_MS = "1000";
      const t0 = Date.now();
      const res = await call("/cron/tick");
      const took = Date.now() - t0;
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      const body = await res.json();
      expect(body.error.code).toBe("timeout");
      expect(body.error.message).toMatch(
        /^پاسخ این درخواست بیش از حد طول کشید؛ چند لحظهٔ دیگر دوباره امتحان کنید\. اگر چیزی ذخیره می‌کردید، پیش از تکرار صفحه را تازه کنید تا ببینید ذخیره شده است یا نه \(کد پیگیری: [0-9a-f]{8}\)$/,
      );
      expect(body.error.details).toMatchObject({ retry_after_s: 5, deadline_ms: 1000, error_id: expect.stringMatching(/^[0-9a-f]{8}$/) });
      expect(took).toBeGreaterThanOrEqual(950);
      expect(took).toBeLessThan(2_000);
      // the work was not cut: the job ran to its end and is done
      await done;
      let status: string | undefined;
      for (let i = 0; i < 50 && status !== "done"; i++, await sleep(50)) status = (await direct.one<{ status: string }>(`select status from sm_jobs where kind = 'w114.sleep'`))?.status;
      expect(status).toBe("done");
    } finally {
      delete process.env.REQUEST_DEADLINE_MS;
      off();
      await direct.close();
    }
  }, 60_000);
});

describe("the cold start and the migration steps' answers", () => {
  const err = (code: string, message = code) => Object.assign(new Error(message), { code });

  it("QUEUE_TIMEOUT while this instance's own steps hold the pool is «migrating»; a busy pool otherwise its 503", () => {
    expect(coldStartAnswer(err("QUEUE_TIMEOUT"), true)).toBe("migrating");
    expect(coldStartAnswer(err("QUEUE_TIMEOUT"), false)).toMatchObject({ status: 503, code: "db_busy" });
    expect((coldStartAnswer(err("XX000", "(EMAXCONN) max client connections reached, limit: 200"), true) as AppError).code).toBe("db_busy");
    // anything else is the caller's «db_unreachable» (tests/web-startup.test.ts)
    expect(coldStartAnswer(err("ECONNREFUSED"), true)).toBeNull();
    expect(coldStartAnswer(err("28P01", "password authentication failed"), false)).toBeNull();
    expect(coldStartAnswer(err("CONNECT_TIMEOUT"), false)).toBeNull();
  });

  it("a migration step past the web version's limits says what to do", () => {
    expect(migrationStepError(err("57014"), "0104_ci_identity_indexes")).toBe(
      "مرحلهٔ «0104_ci_identity_indexes» در زمان مجاز نسخهٔ وب تمام نشد؛ scripts/migrate-db.mts را از رایانهٔ خود اجرا کنید (docs/SETUP_FA.md بخش ۹)",
    );
    expect(migrationStepError(err("DB_TIMEOUT"), "x")).toMatch(/^مرحلهٔ «x» در زمان مجاز نسخهٔ وب تمام نشد/);
    expect(migrationStepError(err("55P03"), "engine:create 3/30")).toBe("مرحلهٔ «engine:create 3/30» منتظر قفلی ماند که کار دیگری نگه داشته بود؛ با درخواست بعدی دوباره امتحان می‌شود");
    expect(migrationStepError(err("42P01", 'relation "x" does not exist'), "y")).toBe('relation "x" does not exist');
  });
});

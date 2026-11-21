// A database that is busy, slow, locked, gone or read-only — Supabase's pooler and the web version's bounded waits
// (src/server/db/postgres.ts, src/server/cloud.ts webPoolOptions) — answers a 503 the person can act on, with a
// tracking code and Retry-After, never the 500 «خطای داخلی سرور» of 1.1.2 (src/server/http/errors.ts dbErrorMessage,
// src/server/http/hono.ts errorResponse).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { errorResponse } from "@server/http/hono";
import { dbErrorMessage } from "@server/http/errors";
import { createPostgresDb } from "@server/db/postgres";
import { createPgliteDb } from "@server/db/pglite";
import type { Db, Queryable } from "@server/db";
import { Client, makeServer, signupWithOrg, useServerDb } from "./helpers";

const BUSY = "سامانه اکنون بیش از حد مشغول است و اتصالی به پایگاه داده آزاد نشد؛ چند ثانیهٔ دیگر دوباره امتحان کنید";
// not «stopped half-done»: a DB_TIMEOUT may follow a commit whose answer was lost, so a save is checked before it is repeated
const TIMEOUT = "پایگاه داده در زمان مجاز پاسخ نداد؛ چند لحظهٔ دیگر دوباره امتحان کنید. اگر چیزی ذخیره می‌کردید، پیش از تکرار صفحه را تازه کنید تا ببینید ذخیره شده است یا نه";
const LOCKED = "داده‌ای که این کار لازم دارد اکنون در دست کار دیگری است؛ چند لحظهٔ دیگر دوباره امتحان کنید";
const GONE = "ارتباط با پایگاه داده برقرار نشد یا قطع شد؛ چند لحظهٔ دیگر دوباره امتحان کنید";
// every edition answers it (53100 is a full disk of the server edition or the Windows app too)
const READ_ONLY = "پایگاه داده اکنون فقط‌خواندنی است (معمولاً چون فضای دیسک یا طرح Supabase پر شده است)؛ تا مدیر سامانه فضا آزاد نکند، ثبت و ویرایش ممکن نیست";

/** An error as postgres.js gives it (PostgresError, a driver code, or a Node socket error). */
const pgError = (code: string, message = `error ${code}`) => Object.assign(new Error(message), { code });
/** …marked by src/server/db/postgres.ts as the database's. */
const fromDb = <E extends object>(e: E): E => Object.defineProperty(e, Symbol.for("itsm.db-error"), { value: true });

/** errorResponse on a minimal Hono app: what a route throwing `err` answers, and what the operator's log got. */
async function answer(err: unknown) {
  const warns: { m: string; d: unknown }[] = [];
  const errors: string[] = [];
  const app = new Hono<{ Variables: { cfg: unknown } }>();
  app.use("*", async (c, next) => {
    c.set("cfg", { log: { info() {}, warn: (m: string, d: unknown) => warns.push({ m, d }), error: (m: string) => errors.push(m) } });
    await next();
  });
  app.get("/api/o/x", () => {
    throw err;
  });
  app.onError((e, c) => errorResponse(e, c));
  const res = await app.request("/api/o/x");
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body: (await res.json()) as { error: { code: string; message: string; details: Record<string, unknown> | null } }, warns, errors };
}

const CASES: { name: string; err: () => unknown; code: string; text: string; retry: string | null; dbCode: string }[] = [
  { name: "postgres.js queue timeout", err: () => pgError("QUEUE_TIMEOUT", "QUEUE_TIMEOUT: Waited more than 10 seconds for a connection"), code: "db_busy", text: BUSY, retry: "5", dbCode: "QUEUE_TIMEOUT" },
  { name: "53300 too many connections", err: () => pgError("53300"), code: "db_busy", text: BUSY, retry: "5", dbCode: "53300" },
  { name: "53200 out of memory", err: () => pgError("53200"), code: "db_busy", text: BUSY, retry: "5", dbCode: "53200" },
  { name: "Supavisor checkout timeout", err: () => pgError("XX000", "(ECHECKOUTTIMEOUT) unable to check out connection from the pool after 5000ms in Transaction mode"), code: "db_busy", text: BUSY, retry: "5", dbCode: "ECHECKOUTTIMEOUT" },
  { name: "Supavisor checkout timeout (older words)", err: () => pgError("XX000", "Unable to check out a connection from the pool due to timeout"), code: "db_busy", text: BUSY, retry: "5", dbCode: "XX000" },
  { name: "Supavisor checkout retries", err: () => pgError("XX000", "(ECHECKOUTRETRIES) failed to check out a connection after multiple retries"), code: "db_busy", text: BUSY, retry: "5", dbCode: "ECHECKOUTRETRIES" },
  { name: "Supavisor pool checkout", err: () => pgError("XX000", "(EPOOLCHECKOUT) pool checkout failed: :timeout"), code: "db_busy", text: BUSY, retry: "5", dbCode: "EPOOLCHECKOUT" },
  { name: "Supavisor client limit", err: () => pgError("XX000", "(EMAXCONN) max client connections reached, limit: 200"), code: "db_busy", text: BUSY, retry: "5", dbCode: "EMAXCONN" },
  { name: "Supavisor client limit (upper case, no prefix)", err: () => pgError("XX000", "Max client connections reached"), code: "db_busy", text: BUSY, retry: "5", dbCode: "XX000" },
  { name: "Supavisor session limit", err: () => pgError("XX000", "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"), code: "db_busy", text: BUSY, retry: "5", dbCode: "EMAXCONNSESSION" },
  { name: "57014 statement timeout", err: () => pgError("57014", "canceling statement due to statement timeout"), code: "db_timeout", text: TIMEOUT, retry: "5", dbCode: "57014" },
  { name: "the client deadline", err: () => pgError("DB_TIMEOUT", "DB_TIMEOUT: no answer from the database in 35000 ms"), code: "db_timeout", text: TIMEOUT, retry: "5", dbCode: "DB_TIMEOUT" },
  { name: "25P03 idle in transaction", err: () => pgError("25P03", "terminating connection due to idle-in-transaction timeout"), code: "db_timeout", text: TIMEOUT, retry: "5", dbCode: "25P03" },
  { name: "55P03 lock timeout", err: () => pgError("55P03", "canceling statement due to lock timeout"), code: "db_locked", text: LOCKED, retry: "3", dbCode: "55P03" },
  { name: "connect timeout", err: () => pgError("CONNECT_TIMEOUT", "write CONNECT_TIMEOUT aws-1-eu-central-1.pooler.supabase.com:6543"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "CONNECT_TIMEOUT" },
  { name: "connection closed", err: () => pgError("CONNECTION_CLOSED"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "CONNECTION_CLOSED" },
  { name: "connection ended", err: () => pgError("CONNECTION_ENDED"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "CONNECTION_ENDED" },
  { name: "connection destroyed", err: () => pgError("CONNECTION_DESTROYED"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "CONNECTION_DESTROYED" },
  { name: "57P01 admin shutdown", err: () => pgError("57P01", "terminating connection due to administrator command"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "57P01" },
  { name: "57P02 crash shutdown", err: () => pgError("57P02"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "57P02" },
  { name: "57P03 cannot connect now", err: () => pgError("57P03", "the database system is starting up"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "57P03" },
  { name: "08006 connection failure", err: () => pgError("08006"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "08006" },
  { name: "08P01 protocol violation", err: () => pgError("08P01", "bind message supplies 1 parameters, but prepared statement requires 2"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "08P01" },
  { name: "a socket reset on the database's connection", err: () => fromDb(pgError("ECONNRESET", "read ECONNRESET")), code: "db_unavailable", text: GONE, retry: "5", dbCode: "ECONNRESET" },
  { name: "a refused database connection", err: () => fromDb(pgError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:6543")), code: "db_unavailable", text: GONE, retry: "5", dbCode: "ECONNREFUSED" },
  { name: "a database host not found", err: () => fromDb(pgError("ENOTFOUND", "getaddrinfo ENOTFOUND db.example")), code: "db_unavailable", text: GONE, retry: "5", dbCode: "ENOTFOUND" },
  { name: "Supavisor lost the backend", err: () => pgError("XX000", "(EDBHANDLEREXITED) connection to database closed. Check logs for more information"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "EDBHANDLEREXITED" },
  { name: "Supavisor DbHandler exited", err: () => pgError("XX000", "(EDBHANDLEREXITED) DbHandler exited. Check logs for more information"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "EDBHANDLEREXITED" },
  { name: "Supavisor pool terminating", err: () => pgError("XX000", "(EPOOLTERMINATING) pool terminating: pool is terminating"), code: "db_unavailable", text: GONE, retry: "5", dbCode: "EPOOLTERMINATING" },
  { name: "25006 read-only transaction", err: () => pgError("25006", "cannot execute INSERT in a read-only transaction"), code: "db_read_only", text: READ_ONLY, retry: null, dbCode: "25006" },
  { name: "53100 disk full", err: () => pgError("53100", "could not extend file: No space left on device"), code: "db_read_only", text: READ_ONLY, retry: null, dbCode: "53100" },
];

describe("a database that cannot do the work now answers 503 with a tracking code, never a 500", () => {
  for (const x of CASES) {
    it(`${x.name} → 503 ${x.code}`, async () => {
      const r = await answer(x.err());
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe(x.code);
      expect(r.body.error.message.startsWith(x.text)).toBe(true);
      const id = /\(کد پیگیری: ([0-9a-f]{8})\)$/.exec(r.body.error.message)?.[1];
      expect(id, r.body.error.message).toBeTruthy();
      expect(r.body.error.details).toMatchObject({ error_id: id, db_code: x.dbCode });
      expect(r.retryAfter).toBe(x.retry);
      if (x.retry) expect(r.body.error.details!.retry_after_s).toBe(Number(x.retry));
      else expect(r.body.error.details).not.toHaveProperty("retry_after_s");
      // the operator's log line names the same id and what the database said; nothing is logged as an unhandled error
      expect(r.warns.map((w) => w.m)).toEqual([`database unavailable [${id}] ${x.dbCode}`]);
      expect(r.warns[0].d).toMatchObject({ method: "GET", path: "/api/o/x" });
      expect(r.errors).toEqual([]);
    });
  }

  it("the same messages, without a tracking code, for an import's rows (dbErrorMessage)", () => {
    expect(dbErrorMessage(pgError("QUEUE_TIMEOUT"))).toMatchObject({ status: 503, code: "db_busy", message: BUSY });
    expect(dbErrorMessage(pgError("55P03"))).toMatchObject({ status: 503, code: "db_locked", message: LOCKED, details: { retry_after_s: 3, db_code: "55P03" } });
    expect(dbErrorMessage(pgError("25006"))?.details).toEqual({ db_code: "25006" });
  });

  it("a Node socket code from anything but the database stays a 500 (an outbound call's ECONNRESET is not the database)", async () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"]) {
      const r = await answer(pgError(code, `connect ${code} 10.0.0.1:443`));
      expect(r.status, code).toBe(500);
      expect(r.body.error.code).toBe("internal");
      expect(r.body.error.message).toMatch(/^خطای داخلی سرور؛ دوباره امتحان کنید \(کد پیگیری: [0-9a-f]{8}\)$/);
      expect(r.retryAfter).toBeNull();
    }
    // nor does a pooler-like sentence in an error that is not a database's (XX000) or marked by the adapter
    expect((await answer(new Error("connection to database closed"))).status).toBe(500);
  });

  it("what was mapped before stays as it was: 23505 is a 409, 22P02 a 400, a deadlock the 503 `retry` (Retry-After 1 s)", async () => {
    const dup = await answer(Object.assign(pgError("23505"), { constraint: "sm_users_email_key" }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: "conflict", message: "این ایمیل قبلاً ثبت شده است", details: null });
    expect(dup.retryAfter).toBeNull();
    expect((await answer(pgError("22P02"))).status).toBe(400);
    const deadlock = await answer(pgError("40P01"));
    expect(deadlock.status).toBe(503);
    expect(deadlock.body.error).toEqual({ code: "retry", message: "سیستم مشغول است؛ دوباره امتحان کنید", details: null });
    expect(deadlock.retryAfter).toBe("1");
    expect(deadlock.warns).toEqual([]);
  });

  it("the adapter marks what it rejects with: a refused database connection is the database's (503), not the server's (500)", async () => {
    // nothing listens on port 9: postgres.js rejects with the socket's own ECONNREFUSED
    const db = createPostgresDb({ url: "postgres://postgres:postgres@127.0.0.1:9/postgres", ssl: false, max: 1, connectTimeout: 2 });
    try {
      const e = await db.query("select 1").then(
        () => null,
        (x: unknown) => x,
      );
      expect((e as { code?: string })?.code).toBe("ECONNREFUSED");
      const r = await answer(e);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("db_unavailable");
      const t = await db.tx(async () => 1).then(
        () => null,
        (x: unknown) => x,
      );
      expect((await answer(t)).body.error.code).toBe("db_unavailable");
    } finally {
      await db.close();
    }
  });
});

// /api/meta counted the accounts with `.catch(() => null)`: a count that failed (busy, slow, gone) read as «no account
// yet», so it answered first_run and allow_signup true — a signed-in person was sent round / → /setup → /signup → / until
// the browser throttled the page, blank; a signed-out one got the sign-up form even with ALLOW_SIGNUP=false (UI-1 of the
// 1.1.4 review). Only a missing table is a first run; any other error is the database's 503.
describe("/api/meta takes no database error for a first run", () => {
  const COUNT = /^select count\(\*\)::int as n from sm_users$/;
  /** What the accounts' count of /api/meta gets instead of its answer: an error to throw, or rows. */
  const count: { fail: unknown; rows: unknown[] | null } = { fail: null, rows: null };
  beforeAll(() =>
    useServerDb(async (mode) => {
      const db = await createPgliteDb({ desktop: mode === "desktop" });
      return new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "one" || prop === "query")
            return async (text: string, params?: unknown[]) => {
              if (COUNT.test(text.trim())) {
                if (count.fail) throw count.fail;
                if (count.rows) return prop === "one" ? (count.rows[0] ?? null) : count.rows;
              }
              return (target as Queryable)[prop](text, params);
            };
          const v = Reflect.get(target, prop, receiver);
          return typeof v === "function" ? v.bind(target) : v;
        },
      }) as Db;
    }),
  );
  afterAll(() => {
    useServerDb(null);
    count.fail = null;
    count.rows = null;
  });

  it("a count that fails answers 503 db_busy, signed in or not, never first_run nor allow_signup", async () => {
    const s = await makeServer({ mode: "cloud", config: { allowSignup: false } });
    const signedIn = new Client(s.app);
    await signupWithOrg(signedIn);
    expect(await signedIn.get("/meta")).toMatchObject({ first_run: false, allow_signup: false, signed_in: true });
    // the session's own lookup answers; the count after it waited in the pool's queue and timed out
    count.fail = pgError("QUEUE_TIMEOUT", "QUEUE_TIMEOUT: Waited more than 10 seconds for a connection");
    try {
      for (const c of [signedIn, new Client(s.app)]) {
        const r = await c.get("/meta", 503);
        expect(r.error.code).toBe("db_busy");
        expect(r.first_run).toBeUndefined();
        expect(r.allow_signup).toBeUndefined();
      }
    } finally {
      count.fail = null;
    }
    expect((await new Client(s.app).get("/meta")).first_run).toBe(false);
  }, 120_000);

  it("a signed-in session is never a first run, whatever the count says; a missing accounts table is one", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    await signupWithOrg(c);
    count.rows = [{ n: 0 }];
    try {
      expect(await c.get("/meta")).toMatchObject({ first_run: false, signed_in: true });
      expect((await new Client(s.app).get("/meta")).first_run).toBe(true);
    } finally {
      count.rows = null;
    }
    count.fail = pgError("42P01", 'relation "sm_users" does not exist');
    try {
      expect(await new Client(s.app).get("/meta")).toMatchObject({ first_run: true, allow_signup: true });
    } finally {
      count.fail = null;
    }
  }, 120_000);
});

describe("a database that cannot write now (Supabase's read-only mode) still serves reads", () => {
  it("a session last stamped over 10 minutes ago reads on; a write answers db_read_only; the stamp resumes afterwards", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    // the session's sliding activity stamp is due (every 10 minutes)
    await s.db.exec(`update sm_sessions set last_seen_at = now() - interval '20 minutes'`);
    await s.db.exec(`set default_transaction_read_only = on`);
    try {
      // what every screen reads first, then the organisation and its records: none of them fails on the stamp
      expect((await c.get("/auth/me")).user.email).toBe("owner@example.com");
      expect((await c.get("/meta")).signed_in).toBe(true);
      expect((await c.get(`/o/${org}`)).org.id).toBe(org);
      expect((await c.get(`/o/${org}/r/incident`)).rows).toEqual([]);
      // a write is refused with the database's state, not a 500
      const w = await c.patch("/auth/me", { full_name: "نام تازه" }, 503);
      expect(w.error.code).toBe("db_read_only");
      expect(w.error.message.startsWith(READ_ONLY)).toBe(true);
    } finally {
      await s.db.exec(`set default_transaction_read_only = off`);
    }
    // writable again: the next request stamps the session as before
    await c.get("/auth/me");
    expect((await s.db.one<{ fresh: boolean }>(`select last_seen_at > now() - interval '1 minute' as fresh from sm_sessions`))?.fresh).toBe(true);
  }, 120_000);

  it("a session past its idle timeout ends (401) even when its end cannot be written", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    await signupWithOrg(c);
    await s.db.exec(`update sm_sessions set idle_minutes = 5, last_seen_at = now() - interval '30 minutes'`);
    await s.db.exec(`set default_transaction_read_only = on`);
    try {
      expect((await c.get("/auth/me", 401)).error.code).toBe("unauthorized");
    } finally {
      await s.db.exec(`set default_transaction_read_only = off`);
    }
  }, 120_000);
});

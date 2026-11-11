// The web version's start-up (src/server/cloud.ts) through the very adapter Vercel uses (postgres.js over the wire):
// no request is ever served on a half-built database — /api answers 503 «migrating» with its progress while the steps
// run in the background of those answers — and the owner's reported path («already registered», then a server error
// on sign-in) ends in a working sign-in. Also: sign-up is atomic, and an account made in the Windows app never reaches
// the server by itself (docs/SETUP_FA.md §۹).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPostgresDb } from "@server/db/postgres";
import { createPgliteDb } from "@server/db/pglite";
import { MIGRATIONS } from "@server/db/migrations";
import { hashPassword } from "@server/auth/password";
import { makeServer, Client } from "./helpers";
import { startLocal } from "@local/server";

type Answer = { status: number; json: any };
const closers: (() => Promise<void>)[] = [];
const OWNER = { email: "owner@example.com", password: "Owner-pass-1405", full_name: "مالک سامانه" };

async function wire() {
  const pg = await PGlite.create();
  const port = 56000 + Math.floor(Math.random() * 4000);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  return { pg, server, url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` };
}

/** A fresh copy of the web entry (its per-instance state) on `url`, and a cookie-keeping caller. */
async function webVersion(url: string) {
  vi.resetModules();
  Object.assign(process.env, { DATABASE_URL: url, DATABASE_SSL: "disable", DATABASE_POOL_MAX: "1", MIGRATE_STEP_BUDGET_MS: "2000", PLATFORM_ADMIN_EMAILS: OWNER.email, APP_SECRET: "x".repeat(64) });
  const { handleCloud, closeCloud } = await import("@server/cloud");
  closers.push(closeCloud);
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await handleCloud(
      new Request(`http://web.test/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, json: await res.json() };
  };
  return call;
}

/** Ask /api/health until the schema is current; every answer before that is a 503 with growing progress, never a 500. */
async function untilReady(call: (m: string, p: string) => Promise<Answer>) {
  let last = -1;
  const seen: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const r = await call("GET", "/health");
    if (r.status === 200) {
      expect(r.json).toMatchObject({ ok: true, db: "ok", schema: { complete: true } });
      return seen;
    }
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("migrating");
    expect(r.json.schema.done).toBeGreaterThanOrEqual(last);
    last = r.json.schema.done;
    seen.push(last);
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error("the schema never became current");
}

describe("web version start-up", () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  const saved = { ...process.env };
  afterAll(async () => {
    for (const f of closers) await f().catch(() => undefined);
    for (const f of cleanup.reverse()) await f().catch(() => undefined);
    process.env = saved;
  });

  it("answers 503 «migrating» with progress on a fresh database, never serves it half-built, and then works", async () => {
    const w = await wire();
    cleanup.push(() => w.server.stop(), () => w.pg.close());
    const call = await webVersion(w.url);
    const first = await call("POST", "/auth/signup", OWNER);
    expect(first.status).toBe(503);
    expect(first.json.error.code).toBe("migrating");
    expect(first.json.error.message).toMatch(/پایگاه داده در حال آماده‌سازی است/);
    const seen = await untilReady(call);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
    const up = await call("POST", "/auth/signup", OWNER);
    expect(up.status).toBe(200);
    const me = await call("GET", "/auth/me");
    expect(me.json.user).toMatchObject({ email: OWNER.email, is_platform_admin: true });
    const health = await call("GET", "/health");
    expect(health.json).toMatchObject({ ok: true, version: expect.any(String), schema: { complete: true, percent: 100 }, pooler: "other" });
    expect(health.json.schema.done).toBe(health.json.schema.total);
  }, 600_000);

  it("the owner's database (migration cut after 0005, an account from an interrupted sign-up): repaired, and sign-in works", async () => {
    const w = await wire();
    cleanup.push(() => w.server.stop(), () => w.pg.close());
    // what the previous version left: migrations 0001–0005 and the owner's row from the sign-up that then failed
    const old = createPostgresDb({ url: w.url, ssl: false, max: 1 });
    await old.exec(`create table if not exists sm_migrations (id text primary key, applied_at timestamptz not null default now())`);
    for (const m of MIGRATIONS.slice(0, 5)) {
      await old.exec(m.sql);
      await old.query(`insert into sm_migrations (id) values ($1)`, [m.id]);
    }
    await old.query(`insert into sm_users (id, email, full_name, password_hash, is_platform_admin) values (gen_random_uuid(), $1, $2, $3, true)`, [OWNER.email, OWNER.full_name, await hashPassword(OWNER.password)]);
    await old.close();

    const call = await webVersion(w.url);
    // before the schema is complete: a clear 503, not the 500 the owner saw
    const early = await call("POST", "/auth/login", { email: OWNER.email, password: OWNER.password });
    expect(early.status).toBe(503);
    expect(early.json.error.code).toBe("migrating");
    await untilReady(call);
    const again = await call("POST", "/auth/signup", OWNER);
    expect(again.status).toBe(400);
    expect(again.json.error.message).toMatch(/قبلاً حساب ساخته شده/);
    const login = await call("POST", "/auth/login", { email: OWNER.email, password: OWNER.password });
    expect(login.status).toBe(200);
    const me = await call("GET", "/auth/me");
    expect(me.status).toBe(200);
    expect(me.json.user.is_platform_admin).toBe(true);
    expect(me.json.orgs).toEqual([]); // the organisation wizard comes next
    const org = await call("POST", "/orgs", { name: "سازمان مالک" });
    expect(org.status).toBe(200);
  }, 600_000);
});

describe("sign-up and sign-in on every state an account can be in", () => {
  it("an interrupted sign-up leaves no account: the next sign-up with that address works", async () => {
    const s = await makeServer({ mode: "cloud", config: { platformAdmins: [OWNER.email] } });
    const c = new Client(s.app);
    // the session cannot be written (as on the half-built database the owner had): the sign-up fails as a whole
    await s.db.exec(`alter table sm_sessions rename column auth_method to auth_method_x`);
    const res = await s.app.fetch(new Request("http://local.test/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(OWNER) }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toMatch(/کد پیگیری: [0-9a-f]{8}/);
    expect(body.error.details.error_id).toMatch(/^[0-9a-f]{8}$/);
    expect(await s.db.one(`select count(*)::int as n from sm_users`)).toEqual({ n: 0 });
    await s.db.exec(`alter table sm_sessions rename column auth_method_x to auth_method`);
    const ok = await c.post("/auth/signup", OWNER);
    expect(ok.recovery_code).toMatch(/^[A-Z0-9]{4}-/);
    expect((await c.get("/auth/me")).user.is_platform_admin).toBe(true);
    await s.db.close();
  }, 120_000);

  it("an account made in the Windows app never reaches the server: linking needs a server account first", async () => {
    const cloudSrv = await makeServer({ mode: "cloud" });
    let cloudUrl = "";
    const server = await new Promise<ReturnType<typeof serve>>((ok) => {
      const s = serve({ fetch: cloudSrv.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        cloudUrl = `http://127.0.0.1:${info.port}`;
        ok(s);
      });
    });
    const dataDir = mkdtempSync(join(tmpdir(), "itsm-desk-"));
    const desktop = await startLocal({ dataDir, staticDir: join(__dirname, "..", "public"), port: 0, memory: true, log: { info() {}, warn() {}, error() {} } });
    try {
      const desk = new Client({ fetch: (r: Request) => fetch(r) }, desktop.url);
      await desk.post("/auth/signup", OWNER);
      await desk.post("/orgs", { name: "سازمان ویندوز" });
      // the Windows app links only with an account the server already has; this address has none there
      const refused = await desk.post("/local/cloud/link", { url: cloudUrl, email: OWNER.email, password: OWNER.password, direction: "upload" }, 400);
      expect(refused.error.code).toBe("cloud_refused");
      expect(refused.error.message).toMatch(/ابتدا در نسخهٔ وب با همین ایمیل حساب بسازید/);
      expect(await cloudSrv.db.one(`select count(*)::int as n from sm_users where lower(email) = $1`, [OWNER.email])).toEqual({ n: 0 });
      // so the first sign-up on the web with the same address is a plain sign-up
      const web = new Client(cloudSrv.app);
      expect((await web.post("/auth/signup", OWNER)).ok).toBe(true);
    } finally {
      await desktop.close();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dataDir, { recursive: true, force: true });
      await cloudSrv.db.close();
    }
  }, 180_000);
});

// keep the PGlite import used (the adapter for the in-process servers above)
void createPgliteDb;

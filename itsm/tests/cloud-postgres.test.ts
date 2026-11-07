// The cloud runtime talks to PostgreSQL over the network through postgres.js (as on Vercel with
// Supabase). This suite runs the core flows through that exact adapter against a PostgreSQL
// wire-protocol server, so type handling (jsonb, numeric, dates, arrays) matches the desktop.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPostgresDb } from "@server/db/postgres";
import { createPgliteDb } from "@server/db/pglite";
import { migrate } from "@server/db/migrate";
import { AGGREGATES } from "@server/sync/registry";
import { createApp } from "@server/app";
import type { Db } from "@server/db";
import { Client, quietLog, accountId } from "./helpers";

describe("cloud runtime over the PostgreSQL protocol (postgres.js)", () => {
  let pg: PGlite;
  let server: PGLiteSocketServer;
  let db: Db;
  let c: Client;
  let org = "";

  beforeAll(async () => {
    pg = await PGlite.create();
    const port = 55000 + Math.floor(Math.random() * 5000);
    server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
    await server.start();
    db = createPostgresDb({ url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, ssl: false, max: 1 });
    await migrate(db);
    const app = createApp({ mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) });
    c = new Client(app);
    await c.post("/auth/signup", { email: "cloud@example.com", password: "cloud-pass-1405", full_name: "ابر" });
    org = (await c.post<{ id: string }>("/orgs", { name: "آزمون ابری", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
  });

  afterAll(async () => {
    await db?.close();
    await server?.stop();
    await pg?.close();
  });

  it("stores json columns as real JSON (not JSON strings)", async () => {
    const rows = await db.query<{ t: string; m: string }>(`select jsonb_typeof(detail_kinds) as t, (select jsonb_typeof(modules) from sm_orgs where id = $1) as m from sm_accounts where org_id = $1 and system_key = 'cash'`, [org]);
    expect(rows[0]).toEqual({ t: "array", m: "array" });
    const info = await c.get(`/o/${org}`);
    expect(info.org.modules).toEqual(["goods", "gold", "fx"]);
    const acc = await c.get(`/o/${org}/data/account/options?q=صندوق`);
    expect(Array.isArray(acc.options[0].detail_kinds)).toBe(true);
  });

  it("creates parties, filters by jsonb roles and posts vouchers", async () => {
    await c.post(`/o/${org}/data/party`, { name: "تأمین‌کننده", roles: ["supplier"] });
    const suppliers = await c.get(`/o/${org}/data/party/options?f.role=supplier`);
    expect(suppliers.options.map((o: { label: string }) => o.label)).toContain("تأمین‌کننده");
    const cash = await accountId(db, org, "cash");
    const capital = await accountId(db, org, "capital");
    const box = await db.one<{ detail_id: string }>(`select detail_id from sm_cash_boxes where org_id = $1`, [org]);
    const v = await c.post(`/o/${org}/accounting/vouchers`, { date: "2026-06-01", lines: [{ account_id: cash, detail_id: box!.detail_id, debit: "123456789.5" }, { account_id: capital, credit: "123456789.5" }] });
    const got = await c.get(`/o/${org}/accounting/vouchers/${v.voucher.id}`);
    expect(got.voucher.total_debit).toBe("123456790"); // rial has no decimals: rounded half-up
    expect(got.voucher.date).toBe("2026-06-01");
    const tb = await c.get(`/o/${org}/accounting/reports/trial-balance?level=1`);
    expect(tb.totals.debit).toBe("123456790");
  });

  it("serves a sync pull with proper types", async () => {
    const login = await c.post<{ token: string }>("/auth/login", { email: "cloud@example.com", password: "cloud-pass-1405", device: { name: "test" } });
    const dev = new Client({ fetch: (r: Request) => createApp({ mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) }).fetch(r) });
    dev.token = login.token;
    const page = await dev.get(`/sync/pull?org_id=${org}&cursor=0`);
    const accounts = page.aggregates.filter((a: { entity: string }) => a.entity === "account");
    expect(accounts.length).toBeGreaterThan(100);
    expect(Array.isArray(accounts.find((a: { row: { system_key: string } }) => a.row.system_key === "cash").row.detail_kinds)).toBe(true);
    expect(page.users[0].email).toBe("cloud@example.com");
  });
});

describe("database adapters behave the same", () => {
  let pg: PGlite;
  let server: PGLiteSocketServer;
  let cloud: Db;
  let desktop: Db;

  beforeAll(async () => {
    pg = await PGlite.create();
    const port = 55000 + Math.floor(Math.random() * 5000);
    server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
    await server.start();
    cloud = createPostgresDb({ url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, ssl: false, max: 1 });
    desktop = await createPgliteDb();
    for (const d of [cloud, desktop]) await d.exec(`create table sm_t (id int primary key, v text)`);
  });

  afterAll(async () => {
    await cloud?.close();
    await desktop?.close();
    await server?.stop();
    await pg?.close();
  });

  it("a transaction whose failed statement was caught (no savepoint) fails instead of silently rolling back", async () => {
    for (const d of [cloud, desktop]) {
      const run = d.tx(async (tx) => {
        await tx.query(`insert into sm_t values (1, 'a')`);
        try {
          await tx.query(`insert into sm_t values (1, 'duplicate')`);
        } catch {
          /* ignored by the caller */
        }
        return "saved";
      });
      await expect(run, d.kind).rejects.toMatchObject({ code: "23505" });
      expect(await d.query(`select * from sm_t`), d.kind).toEqual([]);
    }
  });

  it("a statement rolled back to its savepoint keeps the rest of the transaction", async () => {
    for (const d of [cloud, desktop]) {
      const r = await d.tx(async (tx) => {
        await tx.query(`insert into sm_t values (2, 'a')`);
        await tx.query(`savepoint s1`);
        try {
          await tx.query(`insert into sm_t values (2, 'duplicate')`);
        } catch {
          await tx.query(`rollback to savepoint s1`);
        }
        await tx.query(`insert into sm_t values (3, 'b')`);
        return "saved";
      });
      expect(r).toBe("saved");
      expect((await d.query<{ id: number }>(`select id from sm_t order by id`)).map((x) => x.id), d.kind).toEqual([2, 3]);
      await d.query(`delete from sm_t`);
    }
  });
});

describe("indexes for the hot queries", () => {
  it("the sync pull finds changed rows of every aggregate by (organisation, revision)", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    await db.exec(`set enable_seqscan = off`);
    const missing: string[] = [];
    for (const def of [...AGGREGATES.filter((a) => a.table !== "sm_orgs"), { table: "sm_users" }]) {
      const sql = def.table === "sm_users"
        ? `explain select id from sm_users where rev > $1 order by rev limit 500`
        : `explain select id from ${def.table} where org_id = $1 and rev > $2 and rev <= $3 order by rev`;
      const params = def.table === "sm_users" ? [0] : ["00000000-0000-0000-0000-000000000001", 0, 100];
      const plan = (await db.query<{ "QUERY PLAN": string }>(sql, params)).map((r) => r["QUERY PLAN"]).join("\n");
      if (!/Index Cond: .*\brev\b/.test(plan)) missing.push(def.table);
    }
    await db.close();
    expect(missing).toEqual([]);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("migrations and revisions on a real PostgreSQL server (TEST_DATABASE_URL)", () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost/postgres");
  const name = `itsm_test_${Date.now()}`;
  let admin: Db;
  const dbs: Db[] = [];

  beforeAll(async () => {
    admin = createPostgresDb({ url: url.toString(), ssl: false, max: 1 });
    await admin.exec(`create database ${name}`);
    url.pathname = `/${name}`;
    for (let i = 0; i < 6; i++) dbs.push(createPostgresDb({ url: url.toString(), ssl: false, max: 2 }));
  });

  afterAll(async () => {
    await Promise.all(dbs.map((d) => d.close()));
    await admin?.exec(`drop database if exists ${name}`);
    await admin?.close();
  });

  it("several server instances migrating a fresh database at once all succeed", async () => {
    const results = await Promise.allSettled(dbs.map((d) => migrate(d)));
    expect(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const applied = (results as PromiseFulfilledResult<string[]>[]).flatMap((r) => r.value);
    expect(applied.length).toBe(new Set(applied).size);
  });

  it("user revisions follow commit order, so a pull never moves its cursor past an uncommitted change", async () => {
    const [db] = dbs;
    await migrate(db);
    const [a, b] = await db.query<{ id: string }>(`insert into sm_users (email) values ('a@example.com'), ('b@example.com') returning id`);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let updated!: () => void;
    const started = new Promise<void>((r) => (updated = r));
    // a slow transaction (e.g. disabling a user) updates A first …
    const slow = db.tx(async (tx) => {
      await tx.query(`update sm_users set disabled = true where id = $1`, [a.id]);
      updated();
      await gate;
    });
    await started;
    // … while B logs in and commits; a desktop pulling now takes B's revision as its cursor
    const fast = dbs[1].query(`update sm_users set last_login_at = now() where id = $1`, [b.id]);
    await new Promise((r) => setTimeout(r, 150));
    const pull = async (cursor: number) => dbs[2].query<{ id: string; rev: number }>(`select id, rev from sm_users where rev > $1 order by rev`, [cursor]);
    const cursor = Math.max(...(await pull(0)).map((u) => u.rev));
    release();
    await Promise.all([slow, fast]);
    expect((await pull(cursor)).map((u) => u.id)).toContain(a.id);
  });
});

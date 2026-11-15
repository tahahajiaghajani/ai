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
import "./fixtures/module";
import { Client, quietLog } from "./helpers";
import { SYNC_PROTOCOL } from "@shared/constants";
import { currentSnap, deltaSql, type Snap } from "@server/sync/snapshot";

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
    org = (await c.post<{ id: string }>("/orgs", { name: "آزمون ابری", timezone: "Asia/Tehran" })).id;
  });

  afterAll(async () => {
    await db?.close();
    await server?.stop();
    await pg?.close();
  });

  it("stores json columns as real JSON (not JSON strings)", async () => {
    const info = await c.get(`/o/${org}`);
    expect(info.org.modules).toEqual([]);
    expect(info.org.settings.timezone).toBe("Asia/Tehran");
    const item = (await c.post(`/o/${org}/data/test_item`, { name: "سرور", tags: ["critical", "shared"], data: { rack: "A3", ports: [1, 2] } })).row;
    const rows = await db.query<{ s: string; t: string; d: string }>(
      `select (select jsonb_typeof(settings) from sm_orgs where id = $1) as s, jsonb_typeof(tags) as t, jsonb_typeof(data) as d from sm_test_items where id = $2`,
      [org, item.id],
    );
    expect(rows[0]).toEqual({ s: "object", t: "array", d: "object" });
    const got = await c.get(`/o/${org}/data/test_item/${item.id}`);
    expect(got.row.tags).toEqual(["critical", "shared"]);
    expect(got.row.data).toEqual({ rack: "A3", ports: [1, 2] });
  });

  it("filters by jsonb arrays and keeps numerics and dates exact", async () => {
    await c.post(`/o/${org}/data/test_item`, { name: "یدکی", tags: ["spare"], qty: "123456789.125", starts_on: "2026-06-01" });
    const spare = await c.get(`/o/${org}/data/test_item/options?f.tags=spare`);
    expect(spare.options.map((o: { label: string }) => o.label)).toEqual(["یدکی"]);
    const row = (await c.get(`/o/${org}/data/test_item?q=یدکی`)).rows[0];
    expect(String(row.qty)).toBe("123456789.125");
    expect(row.starts_on).toBe("2026-06-01");
    const d = (await c.post(`/o/${org}/test/docs`, { title: "سند", lines: [{ text: "ردیف", qty: "2.5" }] })).doc;
    expect(d.no).toBe(1);
    expect(Number((await c.get(`/o/${org}/test/docs/${d.id}`)).lines[0].qty)).toBe(2.5);
  });

  it("serves a sync pull with proper types", async () => {
    const login = await c.post<{ token: string }>("/auth/login", { email: "cloud@example.com", password: "cloud-pass-1405", device: { name: "test" } });
    const dev = new Client({ fetch: (r: Request) => createApp({ mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: globalThis.fetch.bind(globalThis) }).fetch(r) });
    dev.token = login.token;
    const page = await dev.get(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}`);
    const by = (e: string) => page.aggregates.filter((a: { entity: string }) => a.entity === e);
    expect(by("org")).toHaveLength(1);
    expect(by("org")[0].row.settings.timezone).toBe("Asia/Tehran");
    expect(by("member").map((m: { row: { role: string } }) => m.row.role)).toEqual(["owner"]);
    const items = by("test_item");
    expect(items.length).toBe(2);
    expect(Array.isArray(items.find((a: { row: { name: string } }) => a.row.name === "سرور").row.tags)).toBe(true);
    const docs = by("test_doc");
    expect(docs[0].children.sm_test_doc_lines.map((l: { text: string }) => l.text)).toEqual(["ردیف"]);
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

describe("prepared statements (the server edition's pools)", () => {
  let pg: PGlite;
  let server: PGLiteSocketServer;
  let db: Db;

  beforeAll(async () => {
    pg = await PGlite.create();
    const port = 55000 + Math.floor(Math.random() * 5000);
    server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
    await server.start();
    db = createPostgresDb({ url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, ssl: false, max: 1, prepare: true, idleTimeout: 5, connectTimeout: 10 });
    await db.exec(`create table sm_p (id int primary key, v text, doc jsonb)`);
  });

  afterAll(async () => {
    await db?.close();
    await server?.stop();
    await pg?.close();
  });

  it("prepares parameterised statements once and runs them again, in and out of transactions", async () => {
    for (let i = 1; i <= 3; i++) await db.query(`insert into sm_p (id, v, doc) values ($1, $2, $3::jsonb)`, [i, `v${i}`, { n: i }]);
    const named = await db.query<{ n: number }>(`select count(*)::int as n from pg_prepared_statements where statement like 'insert into sm_p%'`);
    expect(named[0].n).toBe(1); // one named statement, executed three times
    const r = await db.tx(async (tx) => {
      await tx.query(`update sm_p set v = $2 where id = $1`, [1, "x"]);
      await tx.query(`savepoint s1`);
      try {
        await tx.query(`insert into sm_p (id, v, doc) values ($1, $2, $3::jsonb)`, [2, "duplicate", {}]);
      } catch {
        await tx.query(`rollback to savepoint s1`);
      }
      return tx.one<{ v: string; doc: { n: number } }>(`select v, doc from sm_p where id = $1`, [1]);
    });
    expect(r).toEqual({ v: "x", doc: { n: 1 } });
    expect((await db.query<{ id: number }>(`select id from sm_p where id = any($1::int[]) order by id`, ["{1,2,3}"])).map((x) => x.id)).toEqual([1, 2, 3]);
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

  // Revisions are the writing transactions' ids (SYNC_PROTOCOL 16): they no longer follow commit order, and a pull's
  // cursor is its snapshot (src/server/sync/snapshot.ts), never the highest revision it saw.
  it("user revisions are transaction ids: a pull's snapshot never moves its cursor past an uncommitted change, in any commit order", async () => {
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
    // … while B logs in and commits first (no lock between them: B's revision is the newer transaction id)
    await dbs[1].query(`update sm_users set last_login_at = now() where id = $1`, [b.id]);
    const pull = async (since: Snap | null) => {
      const upto = await currentSnap(dbs[2]);
      const params: unknown[] = [];
      const rows = await dbs[2].query<{ id: string; last_login_at: string | null }>(`select id, last_login_at from sm_users u where ${deltaSql("u", since, upto, params)}`, params);
      return { rows, upto };
    };
    // a Windows app pulls now: B's committed change, and A as it was before the open transaction
    const first = await pull(null);
    expect(first.rows.find((u) => u.id === b.id)?.last_login_at).toBeTruthy();
    expect(first.upto.xip.length).toBeGreaterThan(0);
    release();
    await slow;
    // the next pull from that snapshot brings A's change, committed last by the older transaction, and not B again
    const next = (await pull(first.upto)).rows.map((u) => u.id);
    expect(next).toContain(a.id);
    expect(next).not.toContain(b.id);
  });
});

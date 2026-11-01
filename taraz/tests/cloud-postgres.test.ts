// The cloud runtime talks to PostgreSQL over the network through postgres.js (as on Vercel with
// Supabase). This suite runs the core flows through that exact adapter against a PostgreSQL
// wire-protocol server, so type handling (jsonb, numeric, dates, arrays) matches the desktop.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPostgresDb } from "@server/db/postgres";
import { migrate } from "@server/db/migrate";
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
    const rows = await db.query<{ t: string; m: string }>(`select jsonb_typeof(detail_kinds) as t, (select jsonb_typeof(modules) from tz_orgs where id = $1) as m from tz_accounts where org_id = $1 and system_key = 'cash'`, [org]);
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
    const box = await db.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [org]);
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

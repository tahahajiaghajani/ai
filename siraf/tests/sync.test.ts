// End-to-end synchronisation: a cloud server (web) and a Windows installation (desktop) end up
// with the same data — download, upload, edits on both sides, number clashes, conflicts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeServer, Client, accountId } from "./helpers";
import { startLocal, type LocalServer } from "@local/server";
import type { Db } from "@server/db";

const EMAIL = "sync-owner@example.com";
const PASSWORD = "sync-pass-1405";

async function httpClient(base: string) {
  // a cookie-keeping client over real HTTP (the desktop server is a real server)
  const c = new Client({ fetch: (r: Request) => fetch(r) }, base);
  return c;
}

describe("desktop ↔ cloud synchronisation", () => {
  let cloudDb: Db;
  let cloudUrl = "";
  let cloudServer: ReturnType<typeof serve>;
  let cloud: Client;
  let orgId = "";
  let desktop: LocalServer;
  let desk: Client;
  let dataDir = "";

  beforeAll(async () => {
    const s = await makeServer({ mode: "cloud" });
    cloudDb = s.db;
    await new Promise<void>((ok) => {
      cloudServer = serve({ fetch: s.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        cloudUrl = `http://127.0.0.1:${info.port}`;
        ok();
      });
    });
    cloud = await httpClient(cloudUrl);
    await cloud.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    orgId = (await cloud.post<{ id: string }>("/orgs", { name: "صرافی و طلای نمونه", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
    // some data in the cloud before the desktop exists
    await cloud.post(`/o/${orgId}/data/party`, { name: "مشتری ابری", mobile: "09120000001" });
    const cash = await accountId(cloudDb, orgId, "cash");
    const capital = await accountId(cloudDb, orgId, "capital");
    const box = await cloudDb.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [orgId]);
    await cloud.post(`/o/${orgId}/accounting/vouchers`, { date: "2026-04-01", description: "سرمایه", lines: [{ account_id: cash, detail_id: box!.detail_id, debit: "1000000" }, { account_id: capital, credit: "1000000" }] });

    dataDir = mkdtempSync(join(tmpdir(), "taraz-sync-"));
    desktop = await startLocal({ dataDir, staticDir: join(__dirname, "..", "public"), port: 0, memory: true, log: { info() {}, warn() {}, error: console.error } });
    desk = await httpClient(desktop.url);
  });

  afterAll(async () => {
    await desktop?.close();
    await new Promise<void>((r) => cloudServer?.close(() => r()));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("first start: links to the cloud account and downloads the business", async () => {
    const meta = await desk.get("/meta");
    expect(meta.first_run).toBe(true);
    const orgs = await desk.post("/local/cloud/orgs", { url: cloudUrl, email: EMAIL, password: PASSWORD });
    expect(orgs.orgs.map((o: { id: string }) => o.id)).toContain(orgId);
    const linked = await desk.post("/local/cloud/link", { url: cloudUrl, email: EMAIL, password: PASSWORD, org_id: orgId, direction: "download" });
    expect(linked.ok).toBe(true);
    // the cloud password works on the desktop now (password hash came with the members)
    await desk.post("/auth/login", { email: EMAIL, password: PASSWORD });
    const info = await desk.get(`/o/${orgId}`);
    expect(info.org.name).toBe("صرافی و طلای نمونه");
    const parties = await desk.get(`/o/${orgId}/data/party?q=ابری`);
    expect(parties.total).toBe(1);
    const vouchers = await desk.get(`/o/${orgId}/accounting/vouchers`);
    expect(vouchers.total).toBe(1);
  });

  it("desktop changes reach the cloud and cloud changes reach the desktop", async () => {
    const p = await desk.post(`/o/${orgId}/data/party`, { name: "مشتری ویندوز", mobile: "09120000002" });
    await desk.post("/local/sync");
    const inCloud = await cloud.get(`/o/${orgId}/data/party?q=ویندوز`);
    expect(inCloud.total).toBe(1);
    expect(inCloud.rows[0].id).toBe(p.row.id);

    await cloud.patch(`/o/${orgId}/data/party/${p.row.id}`, { name: "مشتری ویندوز (ویرایش در وب)" });
    await desk.post("/local/sync");
    const back = await desk.get(`/o/${orgId}/data/party/${p.row.id}`);
    expect(back.row.name).toBe("مشتری ویندوز (ویرایش در وب)");
  });

  it("documents created on both sides while apart get unique numbers on both sides", async () => {
    const cash = await accountId(cloudDb, orgId, "cash");
    const capital = await accountId(cloudDb, orgId, "capital");
    const box = await cloudDb.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [orgId]);
    const lines = (amt: string) => [{ account_id: cash, detail_id: box!.detail_id, debit: amt }, { account_id: capital, credit: amt }];
    const a = await cloud.post(`/o/${orgId}/accounting/vouchers`, { date: "2026-05-01", description: "از وب", lines: lines("200") });
    const b = await desk.post(`/o/${orgId}/accounting/vouchers`, { date: "2026-05-02", description: "از ویندوز", lines: lines("300") });
    expect(a.voucher.no).toBe(b.voucher.no); // both took the same next number while apart
    await desk.post("/local/sync");
    const cloudList = await cloud.get(`/o/${orgId}/accounting/vouchers`);
    const deskList = await desk.get(`/o/${orgId}/accounting/vouchers`);
    const nos = (l: { rows: { no: number }[] }) => l.rows.map((r) => r.no).sort();
    expect(cloudList.total).toBe(3);
    expect(new Set(nos(cloudList)).size).toBe(3);
    expect(nos(deskList)).toEqual(nos(cloudList));
  });

  it("both sides report the same balances", async () => {
    const tbCloud = await cloud.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    const tbDesk = await desk.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    expect(tbDesk.totals).toEqual(tbCloud.totals);
    expect(tbCloud.totals.debit).toBe("1000500");
  });

  it("a later edit wins a conflict; the outbox empties", async () => {
    const p = (await desk.get(`/o/${orgId}/data/party?q=ابری`)).rows[0];
    await cloud.patch(`/o/${orgId}/data/party/${p.id}`, { notes: "یادداشت وب" });
    await new Promise((r) => setTimeout(r, 30));
    await desk.patch(`/o/${orgId}/data/party/${p.id}`, { notes: "یادداشت ویندوز (جدیدتر)" });
    await desk.post("/local/sync");
    await desk.post("/local/sync");
    const c = await cloud.get(`/o/${orgId}/data/party/${p.id}`);
    const d = await desk.get(`/o/${orgId}/data/party/${p.id}`);
    expect(c.row.notes).toBe("یادداشت ویندوز (جدیدتر)");
    expect(d.row.notes).toBe(c.row.notes);
    const status = await desk.get("/local/sync");
    expect(status.pending).toBe(0);
  });

  it("a back-dated purchase made offline re-costs a later sale on the web, and the new cost comes back", async () => {
    const item = (await cloud.post(`/o/${orgId}/data/item`, { name: "کالای هم‌گام", kind: "goods", vat_pct: "0" })).row;
    const supplier = (await cloud.post(`/o/${orgId}/data/party`, { name: "تأمین‌کننده‌ی هم‌گام", roles: ["supplier"] })).row;
    const customer = (await cloud.post(`/o/${orgId}/data/party`, { name: "خریدار هم‌گام", roles: ["customer"] })).row;
    const doc = (kind: string, date: string, party: string, qty: string, price: string) =>
      ({ kind, date, party_id: party, lines: [{ item_id: item.id, qty, unit_price: price, vat_pct: "0" }] });
    await cloud.post(`/o/${orgId}/goods/invoices`, doc("purchase", "2026-05-10", supplier.id, "10", "100"));
    const sale = (await cloud.post(`/o/${orgId}/goods/invoices`, doc("sale", "2026-05-20", customer.id, "5", "300"))).invoice;
    const cogs = async () => (await cloudDb.one<{ v: string }>(`select (-sum(value))::text as v from tz_stock_moves where source_id = $1`, [sale.id]))!.v;
    expect(Number(await cogs())).toBe(500);
    await desk.post("/local/sync");
    // made on the Windows app while offline, dated before the web purchase
    await desk.post(`/o/${orgId}/goods/invoices`, doc("purchase", "2026-05-01", supplier.id, "10", "200"));
    await desk.post("/local/sync");
    // average cost at the sale: (2000 + 1000) / 20 = 150 → 5 × 150
    expect(Number(await cogs())).toBe(750);
    await desk.post("/local/sync");
    const tbCloud = await cloud.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    const tbDesk = await desk.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    expect(tbDesk.rows).toEqual(tbCloud.rows);
  });

  it("a member whose password the desktop may not hold signs in through the cloud; a changed password stops working here after a sync", async () => {
    await cloud.post(`/o/${orgId}/members`, { email: "visiting@example.com", full_name: "حسابدار مهمان", role: "accountant", password: "visiting-pass-1" });
    // the accountant also keeps the books of a business of their own: the owner's desktop does
    // not receive their password hash
    const visitor = await httpClient(cloudUrl);
    await visitor.post("/auth/login", { email: "visiting@example.com", password: "visiting-pass-1" });
    await visitor.post("/orgs", { name: "دفتر مهمان", business_kind: "services", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 });
    await desk.post("/local/sync");
    const atDesk = await httpClient(desktop.url);
    await atDesk.post("/auth/login", { email: "visiting@example.com", password: "visiting-pass-1" }); // checked by the cloud
    // the password changes in the cloud; after the next sync the old one no longer opens the desktop
    await visitor.post("/auth/password", { current: "visiting-pass-1", next: "visiting-pass-2" });
    await desk.post("/local/sync");
    await new Client({ fetch: (r: Request) => fetch(r) }, desktop.url).post("/auth/login", { email: "visiting@example.com", password: "visiting-pass-1" }, 401);
    await new Client({ fetch: (r: Request) => fetch(r) }, desktop.url).post("/auth/login", { email: "visiting@example.com", password: "visiting-pass-2" });
  });

  it("a cloud account with the e-mail of a desktop-only account cannot sign in as that account", async () => {
    // an account made on the desktop alone (the cloud skips its membership: it has no such account)
    await desk.post(`/o/${orgId}/members`, { email: "local-only@example.com", full_name: "کارمند محلی", role: "sales", password: "local-only-pass-1" });
    await desk.post("/local/sync");
    // someone signs up in the cloud with the same e-mail and a password of their own
    await (await httpClient(cloudUrl)).post("/auth/signup", { email: "local-only@example.com", password: "taken-over-1", full_name: "مهاجم" });
    await (await httpClient(desktop.url)).post("/auth/login", { email: "local-only@example.com", password: "taken-over-1" }, 401);
    await (await httpClient(desktop.url)).post("/auth/login", { email: "local-only@example.com", password: "local-only-pass-1" });
  });
});

// ---------------------------------------------------------------------------------------------
// Edge cases of the protocol, driven directly through SyncClient against an in-process cloud.
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { uuidv7 } from "@shared/id";

let ipSeq = 0;
async function pair(email: string, opts: { localOwner?: boolean } = {}) {
  const cloudSrv = await makeServer({ mode: "cloud" });
  const deskSrv = await makeServer({ mode: "desktop" });
  const ip = `10.9.${++ipSeq}.1`;
  const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(u), init);
    req.headers.set("x-forwarded-for", ip);
    return cloudSrv.app.fetch(req);
  }) as typeof fetch;
  const web = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", ip); return cloudSrv.app.fetch(r); } }, "http://cloud.test");
  await web.post("/auth/signup", { email, password: PASSWORD, full_name: "مالک ابری" });
  const config = defaultConfig();
  const client = new SyncClient({ db: deskSrv.db, config, save() {}, log: { info() {}, warn() {}, error() {} }, fetch: cloudFetch });
  const local = new Client(deskSrv.app, "http://desk.test");
  return { cloudDb: cloudSrv.db, deskDb: deskSrv.db, web, client, config, local, url: "http://cloud.test" };
}

async function linkedPair(email: string) {
  const p = await pair(email);
  const org = (await p.web.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
  await p.client.link({ url: p.url, email, password: PASSWORD, orgId: org, direction: "download" });
  await p.local.post("/auth/login", { email, password: PASSWORD });
  return { ...p, org };
}

describe("synchronisation edge cases", () => {
  it("a member added on the web whose account is older than the desktop's user cursor still reaches the desktop", async () => {
    const p = await pair("cursor-owner@example.com");
    // the colleague's account exists before the owner's organisation
    const colleague = "colleague-old@example.com";
    await p.cloudDb.query(`insert into tz_users (id, email, full_name, password_hash) values ($1, $2, 'همکار', 'x')`, [uuidv7(), colleague]);
    const org = (await p.web.post<{ id: string }>("/orgs", { name: "سازمان", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 })).id;
    await p.client.link({ url: p.url, email: "cursor-owner@example.com", password: PASSWORD, orgId: org, direction: "download" });
    await p.web.post(`/o/${org}/members`, { email: colleague, full_name: "همکار", role: "accountant" });
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const u = await p.deskDb.one(`select id from tz_users where email = $1`, [colleague]);
    expect(u).toBeTruthy();
  });

  it("a number clash on a pulled remittance moves the local one aside instead of failing the pull", async () => {
    const p = await linkedPair("remit-owner@example.com");
    const fy = (await p.deskDb.one<{ id: string }>(`select id from tz_fiscal_years where org_id = $1`, [p.org]))!.id;
    const usd = (await p.deskDb.one<{ id: string }>(`select id from tz_currencies where org_id = $1 and code = 'USD'`, [p.org]))!.id;
    const ins = `insert into tz_remittances (id, org_id, fiscal_year_id, no, date, direction, currency_id, amount) values ($1, $2, $3, 1, '2026-04-08', 'out', $4, 10)`;
    const mine = uuidv7();
    await p.deskDb.query(ins, [mine, p.org, fy, usd]);
    await p.cloudDb.query(ins, [uuidv7(), p.org, fy, usd]);
    await p.client.pullAll();
    const nos = await p.deskDb.query<{ id: string; no: number }>(`select id, no from tz_remittances where org_id = $1 order by no`, [p.org]);
    expect(nos.length).toBe(2);
    expect(nos.find((r) => r.id === mine)!.no).toBe(2);
  });

  it("a newer web edit skipped by a pull while the desktop copy was pending is not lost when the push conflicts", async () => {
    const p = await linkedPair("conflict-owner@example.com");
    const party = (await p.web.post(`/o/${p.org}/data/party`, { name: "طرف حساب" })).row;
    await p.client.syncNow();
    await p.local.patch(`/o/${p.org}/data/party/${party.id}`, { notes: "ویندوز" });
    await new Promise((r) => setTimeout(r, 20));
    await p.web.patch(`/o/${p.org}/data/party/${party.id}`, { notes: "وب (جدیدتر)" });
    // a sign-in check on the desktop pulls without pushing first
    await p.client.pullAll();
    await p.client.syncNow();
    await p.client.syncNow();
    const c = await p.cloudDb.one<{ notes: string }>(`select notes from tz_parties where id = $1`, [party.id]);
    const d = await p.deskDb.one<{ notes: string }>(`select notes from tz_parties where id = $1`, [party.id]);
    expect(c!.notes).toBe("وب (جدیدتر)");
    expect(d!.notes).toBe(c!.notes);
  });

  it("a second business kept only on the desktop does not leak into the linked one", async () => {
    const p = await linkedPair("two-orgs-owner@example.com");
    const other = (await p.local.post<{ id: string }>("/orgs", { name: "کسب‌وکار دوم محلی", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 })).id;
    const party = (await p.local.post(`/o/${other}/data/party`, { name: "مشتری کسب‌وکار دوم" })).row;
    await p.client.syncNow();
    const leaked = await p.cloudDb.one<{ n: number }>(`select count(*)::int as n from tz_parties where id = $1`, [party.id]);
    expect(leaked!.n).toBe(0);
    const accounts = await p.cloudDb.one<{ n: number }>(`select count(*)::int as n from tz_accounts where org_id = $1`, [p.org]);
    const local = await p.deskDb.one<{ n: number }>(`select count(*)::int as n from tz_accounts where org_id = $1`, [p.org]);
    expect(accounts!.n).toBe(local!.n);
    const still = await p.deskDb.one<{ org_id: string }>(`select org_id from tz_parties where id = $1`, [party.id]);
    expect(still!.org_id).toBe(other);
  });

  it("the cloud refuses a pushed row that belongs to another organisation", async () => {
    const p = await linkedPair("foreign-row-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const id = uuidv7();
    const model = (await p.web.post(`/o/${p.org}/data/party`, { name: "نمونه" })).row;
    const row = await p.cloudDb.one<Record<string, unknown>>(`select * from tz_parties where id = $1`, [model.id]);
    const res = await p.web.post(`/sync/push`, {
      org_id: p.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "party", id, base_rev: 0, row: { ...row, id, org_id: uuidv7(), name: "از کسب‌وکار دیگر", code: "5001", updated_at: new Date().toISOString() }, children: {} }],
    });
    expect(res.results[0]).toMatchObject({ status: "error" });
    expect(await p.cloudDb.one(`select 1 from tz_parties where id = $1`, [id])).toBeNull();
  });

  it("an admin cannot make themselves owner through a push", async () => {
    const p = await linkedPair("escalate-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    await p.web.post(`/o/${p.org}/members`, { email: "escalate-admin@example.com", full_name: "مدیر", role: "admin", password: PASSWORD });
    const admin = new Client(p.web["app" as keyof Client] as never, "http://cloud.test");
    await admin.post("/auth/login", { email: "escalate-admin@example.com", password: PASSWORD });
    const mine = await p.cloudDb.one<Record<string, unknown>>(`select m.* from tz_org_members m join tz_users u on u.id = m.user_id where m.org_id = $1 and u.email = 'escalate-admin@example.com'`, [p.org]);
    const res = await admin.post(`/sync/push`, {
      org_id: p.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "member", id: String(mine!.id), base_rev: Number(mine!.rev), row: { ...mine, role: "owner", updated_at: new Date().toISOString() }, children: {} }],
    });
    expect(res.results[0]).toMatchObject({ status: "error" });
    const after = await p.cloudDb.one<{ role: string }>(`select role from tz_org_members where id = $1`, [mine!.id]);
    expect(after!.role).toBe("admin");
  });

  it("an outdated member row from a non-owner gets the cloud's newer copy back instead of a refusal", async () => {
    const p = await linkedPair("stale-member-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    await p.web.post(`/o/${p.org}/members`, { email: "stale-admin@example.com", full_name: "مدیر", role: "admin", password: PASSWORD });
    await p.web.post(`/o/${p.org}/members`, { email: "stale-member@example.com", full_name: "همکار", role: "accountant", password: PASSWORD });
    const admin = new Client(p.web["app" as keyof Client] as never, "http://cloud.test");
    await admin.post("/auth/login", { email: "stale-admin@example.com", password: PASSWORD });
    const old = (await p.cloudDb.one<Record<string, unknown>>(`select m.* from tz_org_members m join tz_users u on u.id = m.user_id where m.org_id = $1 and u.email = 'stale-member@example.com'`, [p.org]))!;
    // the admin's Windows app edits the title offline; the owner then makes the member an owner on the web
    const offlineAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    await p.web.patch(`/o/${p.org}/members/${old.id}`, { role: "owner" });
    const res = await admin.post(`/sync/push`, {
      org_id: p.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "member", id: String(old.id), base_rev: Number(old.rev), row: { ...old, title: "عنوان آفلاین", updated_at: offlineAt }, children: {} }],
    });
    expect(res.results[0]).toMatchObject({ status: "conflict" });
    expect(res.results[0].aggregate.row.role).toBe("owner");
    expect((await p.cloudDb.one<{ role: string }>(`select role from tz_org_members where id = $1`, [old.id]))!.role).toBe("owner");
  });

  it("uploading a business made on the desktop keeps syncing after the cloud account replaces the local user", async () => {
    const p = await pair("upload-owner@example.com");
    // the business was made on the Windows app alone, by a local account with the same e-mail
    await p.local.post("/auth/signup", { email: "upload-owner@example.com", password: PASSWORD, full_name: "مالک محلی" });
    const org = (await p.local.post<{ id: string }>("/orgs", { name: "کسب‌وکار ویندوزی", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 })).id;
    await p.local.post(`/o/${org}/data/party`, { name: "مشتری ویندوزی" });
    await p.client.link({ url: p.url, email: "upload-owner@example.com", password: PASSWORD, orgId: org, direction: "upload" });
    expect(p.client.state.last_error).toBeNull();
    const inCloud = await p.cloudDb.one<{ n: number }>(`select count(*)::int as n from tz_parties where org_id = $1 and name = 'مشتری ویندوزی'`, [org]);
    expect(inCloud!.n).toBe(1);
    await p.web.post(`/o/${org}/data/party`, { name: "مشتری وب" });
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const back = await p.deskDb.one(`select 1 from tz_parties where org_id = $1 and name = 'مشتری وب'`, [org]);
    expect(back).toBeTruthy();
  });
});

describe("synchronisation on the cloud runtime (postgres.js)", () => {
  it("a pushed document whose number is taken in the cloud gets the next free number", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
    const { createPostgresDb } = await import("@server/db/postgres");
    const { migrate } = await import("@server/db/migrate");
    const { createApp } = await import("@server/app");
    const pg = await PGlite.create();
    const port = 50000 + Math.floor(Math.random() * 5000);
    const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
    await server.start();
    const db = createPostgresDb({ url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, ssl: false, max: 1 });
    try {
      await migrate(db);
      const app = createApp({ mode: "cloud", db, secret: "s", allowSignup: true, platformAdmins: [], origin: "cloud", log: { info() {}, warn() {}, error() {} }, fetch: globalThis.fetch.bind(globalThis) });
      const c = new Client(app);
      await c.post("/auth/signup", { email: "pg-sync@example.com", password: PASSWORD, full_name: "ابر" });
      const org = (await c.post<{ id: string }>("/orgs", { name: "ابری", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 })).id;
      const cash = await accountId(db, org, "cash");
      const capital = await accountId(db, org, "capital");
      const box = await db.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [org]);
      const v = (await c.post(`/o/${org}/accounting/vouchers`, { date: "2026-04-01", description: "وب", lines: [{ account_id: cash, detail_id: box!.detail_id, debit: "100" }, { account_id: capital, credit: "100" }] })).voucher;
      // the same document number, made on a desktop while apart
      const line = await db.query<Record<string, unknown>>(`select * from tz_voucher_lines where voucher_id = $1`, [v.id]);
      const root = await db.one<Record<string, unknown>>(`select * from tz_vouchers where id = $1`, [v.id]);
      const id = uuidv7();
      const res = await c.post(`/sync/push`, {
        org_id: org, device_id: uuidv7(), protocol: (await import("@shared/constants")).SYNC_PROTOCOL,
        aggregates: [{ entity: "voucher", id, base_rev: 0, row: { ...root, id, description: "ویندوز", updated_at: new Date().toISOString() }, children: { tz_voucher_lines: line.map((l) => ({ ...l, id: uuidv7(), voucher_id: id })) } }],
      });
      expect(res.results[0].status).toBe("ok");
      expect(res.results[0].renumbered.to).toBe(v.no + 1);
    } finally {
      await db.close();
      await server.stop();
      await pg.close();
    }
  });
});

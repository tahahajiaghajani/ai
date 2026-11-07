// End-to-end synchronisation: a cloud server (web) and a Windows installation (desktop) end up with the same data —
// download, upload, edits on both sides, record-number clashes, conflicts, members and their passwords. Records are
// those of the fixture module (tests/fixtures/module.ts), synchronised exactly like a real module's.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./fixtures/module";
import { makeServer, Client } from "./helpers";
import { startLocal, type LocalServer } from "@local/server";

const EMAIL = "sync-owner@example.com";
const PASSWORD = "sync-pass-1405";

async function httpClient(base: string) {
  // a cookie-keeping client over real HTTP (the desktop server is a real server)
  return new Client({ fetch: (r: Request) => fetch(r) }, base);
}

describe("desktop ↔ cloud synchronisation", () => {
  let cloudUrl = "";
  let cloudServer: ReturnType<typeof serve>;
  let cloud: Client;
  let orgId = "";
  let desktop: LocalServer;
  let desk: Client;
  let dataDir = "";

  beforeAll(async () => {
    const s = await makeServer({ mode: "cloud" });
    await new Promise<void>((ok) => {
      cloudServer = serve({ fetch: s.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        cloudUrl = `http://127.0.0.1:${info.port}`;
        ok();
      });
    });
    cloud = await httpClient(cloudUrl);
    await cloud.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    orgId = (await cloud.post<{ id: string }>("/orgs", { name: "سازمان نمونه", timezone: "Asia/Tehran" })).id;
    // some data in the cloud before the desktop exists
    await cloud.post(`/o/${orgId}/data/test_item`, { name: "قلم ابری", mobile: "09120000001" });
    await cloud.post(`/o/${orgId}/test/docs`, { title: "سند ابری", lines: [{ text: "ردیف ابری", qty: 1 }] });

    dataDir = mkdtempSync(join(tmpdir(), "itsm-sync-"));
    desktop = await startLocal({ dataDir, staticDir: join(__dirname, "..", "public"), port: 0, memory: true, log: { info() {}, warn() {}, error: console.error } });
    desk = await httpClient(desktop.url);
  });

  afterAll(async () => {
    await desktop?.close();
    await new Promise<void>((r) => cloudServer?.close(() => r()));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("first start: links to the cloud account and downloads the organisation", async () => {
    const meta = await desk.get("/meta");
    expect(meta.first_run).toBe(true);
    const orgs = await desk.post("/local/cloud/orgs", { url: cloudUrl, email: EMAIL, password: PASSWORD });
    expect(orgs.orgs.map((o: { id: string }) => o.id)).toContain(orgId);
    const linked = await desk.post("/local/cloud/link", { url: cloudUrl, email: EMAIL, password: PASSWORD, org_id: orgId, direction: "download" });
    expect(linked.ok).toBe(true);
    // the cloud password works on the desktop now (the password hash came with the members)
    await desk.post("/auth/login", { email: EMAIL, password: PASSWORD });
    const info = await desk.get(`/o/${orgId}`);
    expect(info.org.name).toBe("سازمان نمونه");
    expect(info.org.settings.timezone).toBe("Asia/Tehran");
    expect((await desk.get(`/o/${orgId}/data/test_item?q=ابری`)).total).toBe(1);
    const docs = await desk.get(`/o/${orgId}/test/docs`);
    expect(docs.total).toBe(1);
    const read = await desk.get(`/o/${orgId}/test/docs/${docs.rows[0].id}`);
    expect(read.lines.map((l: { text: string }) => l.text)).toEqual(["ردیف ابری"]);
  });

  it("desktop changes reach the cloud and cloud changes reach the desktop", async () => {
    const p = await desk.post(`/o/${orgId}/data/test_item`, { name: "قلم ویندوز", mobile: "09120000002" });
    await desk.post("/local/sync");
    const inCloud = await cloud.get(`/o/${orgId}/data/test_item?q=ویندوز`);
    expect(inCloud.total).toBe(1);
    expect(inCloud.rows[0].id).toBe(p.row.id);

    await cloud.patch(`/o/${orgId}/data/test_item/${p.row.id}`, { name: "قلم ویندوز (ویرایش در وب)" });
    await desk.post("/local/sync");
    const back = await desk.get(`/o/${orgId}/data/test_item/${p.row.id}`);
    expect(back.row.name).toBe("قلم ویندوز (ویرایش در وب)");
    // the organisation's own settings travel too
    await cloud.patch(`/o/${orgId}`, { settings: { timezone: "Asia/Dubai" } });
    await desk.post("/local/sync");
    expect((await desk.get(`/o/${orgId}`)).org.settings.timezone).toBe("Asia/Dubai");
  });

  it("records created on both sides while apart get unique numbers on both sides", async () => {
    const a = await cloud.post(`/o/${orgId}/test/docs`, { title: "از وب" });
    const b = await desk.post(`/o/${orgId}/test/docs`, { title: "از ویندوز" });
    expect(a.doc.no).toBe(b.doc.no); // both took the same next number while apart
    await desk.post("/local/sync");
    const cloudList = await cloud.get(`/o/${orgId}/test/docs`);
    const deskList = await desk.get(`/o/${orgId}/test/docs`);
    const nos = (l: { rows: { no: number }[] }) => l.rows.map((r) => r.no).sort();
    expect(cloudList.total).toBe(3);
    expect(new Set(nos(cloudList)).size).toBe(3);
    expect(nos(deskList)).toEqual(nos(cloudList));
  });

  it("children travel with their root: lines replaced on the web are replaced on the desktop", async () => {
    const doc = (await cloud.get(`/o/${orgId}/test/docs`)).rows[0];
    await cloud.patch(`/o/${orgId}/test/docs/${doc.id}`, { lines: [{ text: "یک", qty: 1 }, { text: "دو", qty: 2 }] });
    await desk.post("/local/sync");
    const read = await desk.get(`/o/${orgId}/test/docs/${doc.id}`);
    expect(read.lines.map((l: { text: string; qty: string }) => [l.text, Number(l.qty)])).toEqual([["یک", 1], ["دو", 2]]);
  });

  it("a later edit wins a conflict; the outbox empties", async () => {
    const p = (await desk.get(`/o/${orgId}/data/test_item?q=ابری`)).rows[0];
    await cloud.patch(`/o/${orgId}/data/test_item/${p.id}`, { notes: "یادداشت وب" });
    await new Promise((r) => setTimeout(r, 30));
    await desk.patch(`/o/${orgId}/data/test_item/${p.id}`, { notes: "یادداشت ویندوز (جدیدتر)" });
    await desk.post("/local/sync");
    await desk.post("/local/sync");
    const c = await cloud.get(`/o/${orgId}/data/test_item/${p.id}`);
    const d = await desk.get(`/o/${orgId}/data/test_item/${p.id}`);
    expect(c.row.notes).toBe("یادداشت ویندوز (جدیدتر)");
    expect(d.row.notes).toBe(c.row.notes);
    const status = await desk.get("/local/sync");
    expect(status.pending).toBe(0);
  });

  it("a member whose password the desktop may not hold signs in through the cloud; a changed password stops working here after a sync", async () => {
    await cloud.post(`/o/${orgId}/members`, { email: "visiting@example.com", full_name: "کارشناس مهمان", role: "member", password: "visiting-pass-1" });
    // the visitor also runs an organisation of their own: the owner's desktop does not receive their password hash
    const visitor = await httpClient(cloudUrl);
    await visitor.post("/auth/login", { email: "visiting@example.com", password: "visiting-pass-1" });
    await visitor.post("/orgs", { name: "دفتر مهمان" });
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
    await desk.post(`/o/${orgId}/members`, { email: "local-only@example.com", full_name: "کارمند محلی", role: "viewer", password: "local-only-pass-1" });
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
async function pair(email: string) {
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
  // every pair signs in from an address of its own (the sign-in limiter counts per address)
  const local = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", `10.8.${ipSeq}.1`); return deskSrv.app.fetch(r); } }, "http://desk.test");
  return { cloudDb: cloudSrv.db, deskDb: deskSrv.db, cloudApp: cloudSrv.app, web, client, config, local, url: "http://cloud.test", ip };
}

async function linkedPair(email: string) {
  const p = await pair(email);
  const org = (await p.web.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام" })).id;
  await p.client.link({ url: p.url, email, password: PASSWORD, orgId: org, direction: "download" });
  await p.local.post("/auth/login", { email, password: PASSWORD });
  return { ...p, org };
}

describe("synchronisation edge cases", () => {
  it("a member added on the web whose account is older than the desktop's user cursor still reaches the desktop", async () => {
    const p = await pair("cursor-owner@example.com");
    // the colleague's account exists before the owner's organisation
    const colleague = "colleague-old@example.com";
    await p.cloudDb.query(`insert into sm_users (id, email, full_name, password_hash) values ($1, $2, 'همکار', 'x')`, [uuidv7(), colleague]);
    const org = (await p.web.post<{ id: string }>("/orgs", { name: "سازمان" })).id;
    await p.client.link({ url: p.url, email: "cursor-owner@example.com", password: PASSWORD, orgId: org, direction: "download" });
    await p.web.post(`/o/${org}/members`, { email: colleague, full_name: "همکار", role: "member" });
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const u = await p.deskDb.one(`select id from sm_users where email = $1`, [colleague]);
    expect(u).toBeTruthy();
  });

  it("a number clash on a pulled record moves the local one aside instead of failing the pull", async () => {
    const p = await linkedPair("number-owner@example.com");
    const ins = `insert into sm_test_docs (id, org_id, no, title) values ($1, $2, 1, $3)`;
    const mine = uuidv7();
    await p.deskDb.query(ins, [mine, p.org, "ویندوز"]);
    await p.cloudDb.query(ins, [uuidv7(), p.org, "وب"]);
    await p.client.pullAll();
    const nos = await p.deskDb.query<{ id: string; no: number }>(`select id, no from sm_test_docs where org_id = $1 order by no`, [p.org]);
    expect(nos.length).toBe(2);
    expect(nos.find((r) => r.id === mine)!.no).toBe(2);
    // the moved record is queued, so the cloud learns its new number
    await p.client.syncNow();
    const inCloud = await p.cloudDb.one<{ no: number }>(`select no from sm_test_docs where id = $1`, [mine]);
    expect(inCloud!.no).toBe(2);
  });

  it("a code clash on a pushed row gives the incoming row the next free code", async () => {
    const p = await linkedPair("code-owner@example.com");
    const a = (await p.local.post(`/o/${p.org}/data/test_item`, { name: "ویندوز" })).row;
    const b = (await p.web.post(`/o/${p.org}/data/test_item`, { name: "وب" })).row;
    expect(a.code).toBe(b.code);
    await p.client.syncNow();
    await p.client.syncNow();
    const codes = await p.cloudDb.query<{ id: string; code: string }>(`select id, code from sm_test_items where org_id = $1 order by code`, [p.org]);
    expect(codes.map((r) => r.code)).toEqual(["1001", "1002"]);
    const local = await p.deskDb.query<{ id: string; code: string }>(`select id, code from sm_test_items where org_id = $1 order by code`, [p.org]);
    expect(local).toEqual(codes);
  });

  it("a newer web edit skipped by a pull while the desktop copy was pending is not lost when the push conflicts", async () => {
    const p = await linkedPair("conflict-owner@example.com");
    const item = (await p.web.post(`/o/${p.org}/data/test_item`, { name: "قلم" })).row;
    await p.client.syncNow();
    await p.local.patch(`/o/${p.org}/data/test_item/${item.id}`, { notes: "ویندوز" });
    await new Promise((r) => setTimeout(r, 20));
    await p.web.patch(`/o/${p.org}/data/test_item/${item.id}`, { notes: "وب (جدیدتر)" });
    // a sign-in check on the desktop pulls without pushing first
    await p.client.pullAll();
    await p.client.syncNow();
    await p.client.syncNow();
    const c = await p.cloudDb.one<{ notes: string }>(`select notes from sm_test_items where id = $1`, [item.id]);
    const d = await p.deskDb.one<{ notes: string }>(`select notes from sm_test_items where id = $1`, [item.id]);
    expect(c!.notes).toBe("وب (جدیدتر)");
    expect(d!.notes).toBe(c!.notes);
  });

  it("a second organisation kept only on the desktop does not leak into the linked one", async () => {
    const p = await linkedPair("two-orgs-owner@example.com");
    const other = (await p.local.post<{ id: string }>("/orgs", { name: "سازمان دوم محلی" })).id;
    const item = (await p.local.post(`/o/${other}/data/test_item`, { name: "قلم سازمان دوم" })).row;
    await p.local.post(`/o/${p.org}/data/test_item`, { name: "قلم سازمان هم‌گام" });
    await p.client.syncNow();
    const leaked = await p.cloudDb.one<{ n: number }>(`select count(*)::int as n from sm_test_items where id = $1`, [item.id]);
    expect(leaked!.n).toBe(0);
    expect(await p.cloudDb.one(`select 1 from sm_orgs where id = $1`, [other])).toBeNull();
    const cloudN = await p.cloudDb.one<{ n: number }>(`select count(*)::int as n from sm_test_items where org_id = $1`, [p.org]);
    expect(cloudN!.n).toBe(1);
    const still = await p.deskDb.one<{ org_id: string }>(`select org_id from sm_test_items where id = $1`, [item.id]);
    expect(still!.org_id).toBe(other);
  });

  it("the cloud refuses a pushed row that belongs to another organisation", async () => {
    const p = await linkedPair("foreign-row-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const id = uuidv7();
    const model = (await p.web.post(`/o/${p.org}/data/test_item`, { name: "نمونه" })).row;
    const row = await p.cloudDb.one<Record<string, unknown>>(`select * from sm_test_items where id = $1`, [model.id]);
    const res = await p.web.post(`/sync/push`, {
      org_id: p.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "test_item", id, base_rev: 0, row: { ...row, id, org_id: uuidv7(), name: "از سازمان دیگر", code: "5001", updated_at: new Date().toISOString() }, children: {} }],
    });
    expect(res.results[0]).toMatchObject({ status: "error" });
    expect(await p.cloudDb.one(`select 1 from sm_test_items where id = $1`, [id])).toBeNull();
  });

  it("refuses a push from a client of another sync protocol", async () => {
    const p = await linkedPair("protocol-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const res = await p.web.post(`/sync/push`, { org_id: p.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL + 1, aggregates: [] }, 400);
    expect(res.error.message).toMatch(/هم‌خوان نیست/);
  });

  it("an admin cannot make themselves owner through a push", async () => {
    const p = await linkedPair("escalate-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    await p.web.post(`/o/${p.org}/members`, { email: "escalate-admin@example.com", full_name: "مدیر", role: "admin", password: PASSWORD });
    const admin = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", p.ip); return p.cloudApp.fetch(r); } }, "http://cloud.test");
    await admin.post("/auth/login", { email: "escalate-admin@example.com", password: PASSWORD });
    const mine = await p.cloudDb.one<Record<string, unknown>>(`select m.* from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and u.email = 'escalate-admin@example.com'`, [p.org]);
    const res = await admin.post(`/sync/push`, {
      org_id: p.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
      aggregates: [{ entity: "member", id: String(mine!.id), base_rev: Number(mine!.rev), row: { ...mine, role: "owner", updated_at: new Date().toISOString() }, children: {} }],
    });
    expect(res.results[0]).toMatchObject({ status: "error" });
    const after = await p.cloudDb.one<{ role: string }>(`select role from sm_org_members where id = $1`, [mine!.id]);
    expect(after!.role).toBe("admin");
  });

  it("an outdated member row from a non-owner gets the cloud's newer copy back instead of a refusal", async () => {
    const p = await linkedPair("stale-member-owner@example.com");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    await p.web.post(`/o/${p.org}/members`, { email: "stale-admin@example.com", full_name: "مدیر", role: "admin", password: PASSWORD });
    await p.web.post(`/o/${p.org}/members`, { email: "stale-member@example.com", full_name: "همکار", role: "member", password: PASSWORD });
    const admin = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", p.ip); return p.cloudApp.fetch(r); } }, "http://cloud.test");
    await admin.post("/auth/login", { email: "stale-admin@example.com", password: PASSWORD });
    const old = (await p.cloudDb.one<Record<string, unknown>>(`select m.* from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and u.email = 'stale-member@example.com'`, [p.org]))!;
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
    expect((await p.cloudDb.one<{ role: string }>(`select role from sm_org_members where id = $1`, [old.id]))!.role).toBe("owner");
  });

  it("uploading an organisation made on the desktop keeps syncing after the cloud account replaces the local user", async () => {
    const p = await pair("upload-owner@example.com");
    // the organisation was made on the Windows app alone, by a local account with the same e-mail
    await p.local.post("/auth/signup", { email: "upload-owner@example.com", password: PASSWORD, full_name: "مالک محلی" });
    const org = (await p.local.post<{ id: string }>("/orgs", { name: "سازمان ویندوزی" })).id;
    await p.local.post(`/o/${org}/data/test_item`, { name: "قلم ویندوزی" });
    await p.local.post(`/o/${org}/test/docs`, { title: "سند ویندوزی", lines: [{ text: "ردیف", qty: 3 }] });
    await p.client.link({ url: p.url, email: "upload-owner@example.com", password: PASSWORD, orgId: org, direction: "upload" });
    expect(p.client.state.last_error).toBeNull();
    const inCloud = await p.cloudDb.one<{ n: number }>(`select count(*)::int as n from sm_test_items where org_id = $1 and name = 'قلم ویندوزی'`, [org]);
    expect(inCloud!.n).toBe(1);
    const lines = await p.cloudDb.query<{ text: string }>(`select l.text from sm_test_doc_lines l join sm_test_docs d on d.id = l.doc_id where d.org_id = $1`, [org]);
    expect(lines.map((l) => l.text)).toEqual(["ردیف"]);
    await p.web.post(`/o/${org}/data/test_item`, { name: "قلم وب" });
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const back = await p.deskDb.one(`select 1 from sm_test_items where org_id = $1 and name = 'قلم وب'`, [org]);
    expect(back).toBeTruthy();
  });
});

describe("synchronisation on the cloud runtime (postgres.js)", () => {
  it("a pushed record whose number is taken in the cloud gets the next free number", async () => {
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
      const org = (await c.post<{ id: string }>("/orgs", { name: "ابری" })).id;
      const d = (await c.post(`/o/${org}/test/docs`, { title: "وب", lines: [{ text: "ردیف وب", qty: 1 }] })).doc;
      // the same record number, made on a desktop while apart
      const lines = await db.query<Record<string, unknown>>(`select * from sm_test_doc_lines where doc_id = $1`, [d.id]);
      const root = await db.one<Record<string, unknown>>(`select * from sm_test_docs where id = $1`, [d.id]);
      const id = uuidv7();
      const res = await c.post(`/sync/push`, {
        org_id: org, device_id: uuidv7(), protocol: (await import("@shared/constants")).SYNC_PROTOCOL,
        aggregates: [{ entity: "test_doc", id, base_rev: 0, row: { ...root, id, title: "ویندوز", updated_at: new Date().toISOString() }, children: { sm_test_doc_lines: lines.map((l) => ({ ...l, id: uuidv7(), doc_id: id })) } }],
      });
      expect(res.results[0].status).toBe("ok");
      expect(res.results[0].renumbered.to).toBe(d.no + 1);
      const pushed = await db.query<{ text: string }>(`select text from sm_test_doc_lines where doc_id = $1`, [id]);
      expect(pushed.map((l) => l.text)).toEqual(["ردیف وب"]);
    } finally {
      await db.close();
      await server.stop();
      await pg.close();
    }
  });
});

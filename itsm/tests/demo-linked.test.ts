// Demo data and a Windows app linked to a server or the web version (docs/DEMO_FA.md): the demo is loaded and purged
// on the server only — the linked app refuses both — and a write inside the demo scope never enters the app's outbox
// (it would reach the server as its user's real work, where the purge cannot find it).
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge, ServerConfig } from "@server/context";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import type { Db } from "@server/db";
import { registerCloudLink } from "@server/sync/link-state";
import { cloudLoginVia } from "@local/bridge";
import { hashPassword } from "@server/auth/password";
import { uuidv7 } from "@shared/id";

const EMAIL = "demo-linked@example.com";
const PASSWORD = "demo-linked-pass-1405";

describe("demo data and a linked Windows app", () => {
  let cloudDb: Db;
  let deskDb: Db;
  let deskApp: { fetch: (r: Request) => Response | Promise<Response> };
  let client: SyncClient;
  let org = "";
  let deskCfg: ServerConfig;
  let cloudApp: { fetch: (r: Request) => Response | Promise<Response> };
  let cloudFetchOf: () => typeof fetch;

  beforeAll(async () => {
    const cloudSrv = await makeServer({ mode: "cloud" });
    cloudDb = cloudSrv.db;
    // the app's bridge: its sign-in through the cloud is the real one (src/desktop/bridge.ts)
    const bridge = {
      notifyLocalWrite() {},
      fetchBlob: (o: string, a: string) => client.fetchBlob(o, a),
      cloudLogin: (email: string, password: string) => cloudLoginVia(client, deskDb, email, password),
    } as unknown as DesktopBridge;
    const deskSrv = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    deskDb = deskSrv.db;
    deskApp = deskSrv.app;
    deskCfg = { mode: "desktop", db: deskDb, secret: "desktop-secret", allowSignup: false, platformAdmins: [], origin: "desktop", log: quietLog, fetch, desktop: bridge };
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloudSrv.app.fetch(new Request(String(u), init))) as typeof fetch;
    cloudApp = cloudSrv.app;
    cloudFetchOf = () => cloudFetch;
    const web = new Client(cloudSrv.app, "http://cloud.test");
    await web.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان پیوندخورده", timezone: "Asia/Tehran" })).id;
    await web.post(`/o/${org}/r/todo`, { short_description: "کار واقعی" });
    const config = defaultConfig();
    client = new SyncClient({ db: deskDb, config, save() {}, log: quietLog, fetch: cloudFetch });
    // as the Windows app's server does (src/desktop/server.ts): its link, read in memory
    registerCloudLink(deskDb, () => config.cloud);
    await client.link({ url: "http://cloud.test", email: EMAIL, password: PASSWORD, orgId: org, direction: "download" });
  }, 600_000);

  it("refuses to load or purge the demo in the linked app", async () => {
    const local = new Client(deskApp, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
    const refused = await local.req("POST", `/o/${org}/demo/load`, { size: "small" }, 409);
    expect(JSON.stringify(refused)).toContain("سرور");
    await local.req("POST", `/o/${org}/demo/purge`, { confirm: "حذف کامل" }, 409);
    expect(await deskDb.one(`select 1 from sm_demo_packs where org_id = $1`, [org])).toBeNull();
  });

  it("never queues a demo-scoped write for the server", async () => {
    const sys = await systemCtx(deskCfg, org);
    const demo = await inDemoScope(org, () => sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار نمایشی" }, { trusted: true })).id)));
    const real = await sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار واقعی محلی" }, { trusted: true })).id));
    expect(await deskDb.one(`select 1 from sm_outbox where id = $1`, [demo])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_outbox where id = $1`, [real])).toBeTruthy();
    await client.syncNow();
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
  }, 120_000);

  it("refuses to upload a standalone app's organisation while it holds demo data", async () => {
    // a standalone app (not linked) may load the small pack; uploading it would make the demo the server's real data
    const bridge = { notifyLocalWrite() {}, fetchBlob: () => Promise.reject(new Error("no blobs")) } as unknown as DesktopBridge;
    const solo = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "solo-secret" } });
    const local = new Client(solo.app, "http://solo.test");
    await local.post("/auth/signup", { email: "solo@example.com", password: PASSWORD, full_name: "مدیر محلی" });
    const soloOrg = (await local.post<{ id: string }>("/orgs", { name: "سازمان محلی", timezone: "Asia/Tehran" })).id;
    const soloCfg: ServerConfig = { ...deskCfg, db: solo.db, secret: "solo-secret", desktop: bridge };
    const sys = await systemCtx(soloCfg, soloOrg);
    const demo = await inDemoScope(soloOrg, () => sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "کار نمایشی محلی" }, { trusted: true })).id)));
    await solo.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_todos') on conflict do nothing`, [soloOrg, demo]);
    const cloud = new Client(cloudApp, "http://cloud.test");
    await cloud.post("/auth/signup", { email: "solo-cloud@example.com", password: PASSWORD, full_name: "مدیر ابری" });
    const up = new SyncClient({ db: solo.db, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetchOf() });
    await expect(up.link({ url: "http://cloud.test", email: "solo-cloud@example.com", password: PASSWORD, orgId: soloOrg, direction: "upload" })).rejects.toThrow(/نمایشی/);
    expect(await cloudDb.one(`select 1 from sm_orgs where id = $1`, [soloOrg])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
  }, 600_000);
  it("a demo person is sent to the server's address on a linked app, never to a switch the app does not have", async () => {
    const PERSONA = "demo-persona-pass-1405";
    // the server: the pack, loaded with demo sign-in on, and two of its people (their passwords stay on the server)
    await cloudDb.query(`insert into sm_demo_packs (org_id, state, size, options, progress) values ($1, 'loaded', 'small', '{"signin": true}'::jsonb, '{}'::jsonb)`, [org]);
    const persona = async (local: string) => {
      const id = uuidv7();
      const email = `${local}.${id.slice(-8)}@aftab-bank.example`;
      await cloudDb.query(`insert into sm_users (id, email, full_name, password_hash, prefs) values ($1, $2, 'کارمند نمایشی', $3, $4::jsonb)`, [id, email, await hashPassword(PERSONA), JSON.stringify({ demo_org: org })]);
      await cloudDb.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users')`, [org, id]);
      await cloudDb.query(`insert into sm_org_members (id, org_id, user_id, role) values ($1, $2, $3, 'member')`, [uuidv7(), org, id]);
      return { id, email };
    };
    const agent = await persona("agent");
    const branch = await persona("branch");
    // in the browser, at the server, the persona signs in
    await new Client(cloudApp, "http://cloud.test").post("/auth/login", { email: agent.email, password: PERSONA });
    // the linked app holds the accounts (marked with the pack) but not their passwords
    await client.syncNow();
    expect(await deskDb.one<{ prefs: Record<string, unknown>; password_hash: string | null }>(`select prefs, password_hash from sm_users where id = $1`, [agent.id])).toEqual({ prefs: { demo_org: org }, password_hash: null });
    const local = new Client(deskApp, "http://desk.test");
    // the server allows demo sign-in: on the linked app the persona is sent there, with its address
    const there = JSON.stringify(await local.req("POST", "/auth/login", { email: agent.email, password: PERSONA }, 403));
    expect(there).toContain("مرورگر");
    expect(there).toContain("http://cloud.test");
    expect(there).not.toContain("«داده‌های نمایشی» برای زمان ارائه روشن کند");
    // switched off on the server: the server proved the password, so the app gives the same answer (never «wrong password»)
    await cloudDb.query(`update sm_demo_packs set options = '{"signin": false}'::jsonb where org_id = $1`, [org]);
    const off = JSON.stringify(await local.req("POST", "/auth/login", { email: branch.email, password: PERSONA }, 403));
    expect(off).toContain("مرورگر");
    // a wrong password stays a wrong password
    await local.req("POST", "/auth/login", { email: branch.email, password: "wrong-password-1405" }, 401);
    await cloudDb.query(`delete from sm_demo_packs where org_id = $1`, [org]);
  }, 120_000);
});

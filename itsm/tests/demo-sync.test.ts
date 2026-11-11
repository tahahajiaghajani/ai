// The demo pack and Windows apps (docs/DEMO_FA.md): when an organisation has a linked Windows app, the purge leaves
// content-free tombstones first — the app's next pull deletes its copies (record, journal, attachment) — and removes
// them for good once every app has pulled past them (`finalizeDemo`). Demo rows here are made the way the pack makes
// them (system writes inside the demo scope); the full bank goes through the same purge in demo-purge.test.ts.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge, ServerConfig } from "@server/context";
import { createIn, systemCtx, addJournalIn } from "@server/engine";
import { TABLES } from "@shared/tables";
import { inDemoScope } from "@server/db/scope";
import { finalizeDemo, purgeStep, demoStatus } from "@server/modules/demo";
import { upload, PNG } from "./engine-helpers";
import type { Db } from "@server/db";

const EMAIL = "demo-sync@example.com";
const PASSWORD = "demo-sync-pass-1405";

describe("demo purge and Windows apps", () => {
  let cloudDb: Db;
  let deskDb: Db;
  let deskApp: { fetch: (r: Request) => Response | Promise<Response> };
  let web: Client;
  let client: SyncClient;
  let org = "";
  let cloudCfg: ServerConfig;
  let demoTodo = "";
  let realTodo = "";

  beforeAll(async () => {
    const cloudSrv = await makeServer({ mode: "cloud" });
    cloudDb = cloudSrv.db;
    cloudCfg = { mode: "cloud", db: cloudDb, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const bridge = { notifyLocalWrite() {}, fetchBlob: (o: string, a: string) => client.fetchBlob(o, a) } as unknown as DesktopBridge;
    const deskSrv = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    deskDb = deskSrv.db;
    deskApp = deskSrv.app;
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloudSrv.app.fetch(new Request(String(u), init))) as typeof fetch;
    web = new Client(cloudSrv.app, "http://cloud.test");
    await web.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان نمایش هم‌گام", timezone: "Asia/Tehran" })).id;
    // a real record, and demo rows written the way the pack writes them
    realTodo = (await web.post(`/o/${org}/r/todo`, { short_description: "کار واقعی" })).row.id;
    await cloudDb.query(`insert into sm_demo_packs (org_id, state, size, progress, counters) values ($1, 'loaded', 'small', '{}'::jsonb, '{}'::jsonb)`, [org]);
    const sys = await systemCtx(cloudCfg, org);
    demoTodo = await inDemoScope(org, () =>
      sys.write(async (tx) => {
        const row = await createIn(tx, sys, "todo", { short_description: "کار نمایشی بانک آفتاب" }, { trusted: true });
        await addJournalIn(tx, sys, TABLES.get("todo")!, row, { kind: "comment", body: "یادداشت نمایشی" }, { trusted: true });
        return String(row.id);
      }),
    );
    // the owner attaches a file to the demo record (a side row of demo data, removed with it)
    const up = await upload(cloudSrv.app, web, `/o/${org}/r/todo/${demoTodo}/attachments`, "demo.png", PNG, "image/png");
    expect(up.status).toBeLessThan(300);
    client = new SyncClient({ db: deskDb, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", email: EMAIL, password: PASSWORD, orgId: org, direction: "download" });
  }, 600_000);

  it("the Windows app holds the demo record, then loses it with the purge's tombstones; the tombstones go for good after", async () => {
    expect(await deskDb.one(`select 1 from sm_todos where id = $1`, [demoTodo])).toBeTruthy();
    expect(await deskDb.one(`select 1 from sm_journal where record_id = $1`, [demoTodo])).toBeTruthy();
    expect(await deskDb.one(`select 1 from sm_attachments where record_id = $1`, [demoTodo])).toBeTruthy();

    // the purge (as the job runs it) with a linked Windows app: tombstones, not deletions
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    for (let i = 0; i < 12; i++) await purgeStep(cloudCfg, org);
    const status = await demoStatus(cloudDb, org);
    expect(status.state).toBe("tombstoned");
    expect(status.waiting_devices).toBe(1);
    // a tombstone keeps no content
    const stone = await cloudDb.one<{ short_description: string | null; deleted_at: string | null }>(`select short_description, deleted_at from sm_todos where id = $1`, [demoTodo]);
    expect(stone?.deleted_at).toBeTruthy();
    expect(stone?.short_description ?? "").toBe("");
    const entry = await cloudDb.one<{ body: string | null; deleted_at: string | null }>(`select body, deleted_at from sm_journal where record_id = $1`, [demoTodo]);
    expect(entry?.deleted_at).toBeTruthy();
    expect(entry?.body ?? "").toBe("");
    // not yet: the Windows app has not pulled
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(false);

    // the Windows app's next pull empties its copies and marks them deleted (the app shows nothing of them; only an
    // empty marker with the id and times stays there); the real record stays as it was
    await client.syncNow();
    const deskTodo = await deskDb.one<{ short_description: string | null; deleted_at: string | null }>(`select short_description, deleted_at from sm_todos where id = $1`, [demoTodo]);
    expect(!deskTodo || (!!deskTodo.deleted_at && !deskTodo.short_description)).toBe(true);
    const deskEntries = await deskDb.query<{ body: string | null; deleted_at: string | null }>(`select body, deleted_at from sm_journal where record_id = $1`, [demoTodo]);
    for (const j of deskEntries) expect(!!j.deleted_at && !j.body).toBe(true);
    const deskFiles = await deskDb.query<{ name: string | null; sha256: string | null; deleted_at: string | null }>(`select name, sha256, deleted_at from sm_attachments where record_id = $1`, [demoTodo]);
    for (const f of deskFiles) expect(!!f.deleted_at && !f.name && !f.sha256).toBe(true);
    // nothing of it is visible in the app
    const local = new Client(deskApp, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
    expect((await local.get(`/o/${org}/r/todo`)).rows.map((r: { id: string }) => r.id)).toEqual([realTodo]);
    expect(await deskDb.one<{ short_description: string }>(`select short_description from sm_todos where id = $1 and deleted_at is null`, [realTodo])).toEqual({ short_description: "کار واقعی" });

    // every app passed the tombstones: they go for good, with the pack's bookkeeping
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(true);
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demoTodo])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_journal where record_id = $1`, [demoTodo])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_attachments where record_id = $1`, [demoTodo])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_blobs where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_rows where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [realTodo])).toBeTruthy();
    expect((await demoStatus(cloudDb, org)).state).toBe("none");
  }, 300_000);
});

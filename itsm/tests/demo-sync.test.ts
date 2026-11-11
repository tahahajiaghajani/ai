// The demo pack and Windows apps (docs/DEMO_FA.md): when an organisation has a linked Windows app, the purge leaves
// content-free tombstones first — the app's next pull deletes its copies (record, journal, attachment) — and removes
// them for good once every app has pulled past them (`finalizeDemo`). Demo rows here are made the way the pack makes
// them (system writes inside the demo scope); the full bank goes through the same purge in demo-purge.test.ts.
//
// Sync revisions are transaction ids (docs/spec/ENGINE.md §13): every hard delete of rows an app may hold — the
// tombstones' own removal, a purge while no app was active, what the platform computed while the purge ran — raises the
// organisation's purge watermark, so an app that did not see the delete reads everything again and drops what the
// server no longer has; an app that pulled the tombstones in time is not made to read everything again.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge, ServerConfig } from "@server/context";
import { createIn, systemCtx, addJournalIn } from "@server/engine";
import { TABLES } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import { inDemoScope } from "@server/db/scope";
import { finalizeDemo, purgeStep, demoStatus } from "@server/modules/demo";
import { saveComputed, tablesInfo } from "@server/modules/demo/purge";
import { upload, PNG } from "./engine-helpers";
import type { Db } from "@server/db";

const EMAIL = "demo-sync@example.com";
const PASSWORD = "demo-sync-pass-1405";

interface PullSeen {
  reset?: boolean;
  full?: boolean;
  has_more?: boolean;
}

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
  let persona = "";
  /** every pull page the Windows app received */
  const pulls: PullSeen[] = [];

  /** A demo record (with a journal entry) written the way the pack writes it. */
  async function demoRecord(text: string): Promise<string> {
    const sys = await systemCtx(cloudCfg, org);
    return inDemoScope(org, () =>
      sys.write(async (tx) => {
        const row = await createIn(tx, sys, "todo", { short_description: text }, { trusted: true });
        await addJournalIn(tx, sys, TABLES.get("todo")!, row, { kind: "comment", body: "یادداشت نمایشی" }, { trusted: true });
        return String(row.id);
      }),
    );
  }

  /** One of the pack's people (as the loader adds them): an account marked with the pack, and its membership. */
  async function newPersona(): Promise<string> {
    const id = uuidv7();
    await inDemoScope(org, () =>
      cloudDb.tx(async (tx) => {
        await tx.query(`insert into sm_users (id, email, full_name, prefs) values ($1, $2, 'کارمند نمایشی', $3::jsonb)`, [id, `persona.${id.slice(-8)}@aftab-bank.example`, JSON.stringify({ demo_org: org })]);
        await tx.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [org, id]);
        await tx.query(`insert into sm_org_members (id, org_id, user_id, role) values ($1, $2, $3, 'member')`, [uuidv7(), org, id]);
      }),
    );
    return id;
  }

  /** A persona's membership as the Windows app holds it: live, an empty deleted marker, or none at all. */
  const membershipOnApp = async (user: string) => {
    const m = await deskDb.one<{ deleted_at: string | null }>(`select deleted_at from sm_org_members where org_id = $1 and user_id = $2`, [org, user]);
    return !m ? "none" : m.deleted_at ? "deleted" : "live";
  };

  /** A pack as the load leaves it; `computed`: the computed tables were saved (the knowledge gaps among them). */
  async function newPack(opts: { computed?: boolean } = {}): Promise<void> {
    await cloudDb.query(`insert into sm_demo_packs (org_id, state, size, progress, counters) values ($1, 'loaded', 'small', '{}'::jsonb, '{}'::jsonb)`, [org]);
    if (!opts.computed) return;
    const computed = await saveComputed(cloudDb, org, await tablesInfo(cloudDb));
    expect(computed).toContain("sm_kb_gaps");
    await cloudDb.query(`update sm_demo_packs set progress = progress || jsonb_build_object('saved', true, 'saved_at', now(), 'computed', $2::jsonb) where org_id = $1`, [org, JSON.stringify(computed)]);
  }

  const phase = async () => (await cloudDb.one<{ purge: string | null }>(`select progress->>'purge' as purge from sm_demo_packs where org_id = $1 and state = 'purging'`, [org]))?.purge ?? null;

  /** Run the purge's phases (as its job does) until `until` is the next phase, or to its end (null). */
  async function purgeUntil(until: string | null): Promise<void> {
    for (let i = 0; i < 12 && (await phase()) !== until; i++) await purgeStep(cloudCfg, org);
    expect(await phase()).toBe(until);
  }

  /** The knowledge quality check opens a gap (the platform itself, outside the demo scope): a computed record. */
  async function gapByThePlatform(signature: string): Promise<string> {
    const sys = await systemCtx(cloudCfg, org);
    const gap = await sys.write((tx) => createIn(tx, sys, "kb_gap", { title: "رمز کارت فراموش شده", kind: "no_article", signature, demand: 3, score: 3 }, { trusted: true }));
    return String(gap.id);
  }

  const watermark = async () => Number((await cloudDb.one<{ purged: string }>(`select purged::text as purged from sm_org_sync where org_id = $1`, [org]))?.purged ?? 0);
  /** Gone from the app, or only an empty deleted marker left there. */
  const goneFromApp = async (table: string, id: string) => {
    const row = await deskDb.one<{ deleted_at: string | null }>(`select deleted_at from ${table} where id = $1`, [id]);
    return !row || !!row.deleted_at;
  };
  /** One sync of the Windows app; the pull pages it received. */
  async function sync(): Promise<PullSeen[]> {
    const from = pulls.length;
    const state = await client.syncNow();
    expect(state.last_error).toBeNull();
    return pulls.slice(from);
  }

  beforeAll(async () => {
    const cloudSrv = await makeServer({ mode: "cloud" });
    cloudDb = cloudSrv.db;
    cloudCfg = { mode: "cloud", db: cloudDb, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const bridge = { notifyLocalWrite() {}, fetchBlob: (o: string, a: string) => client.fetchBlob(o, a) } as unknown as DesktopBridge;
    const deskSrv = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    deskDb = deskSrv.db;
    deskApp = deskSrv.app;
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const res = await cloudSrv.app.fetch(new Request(String(u), init));
      if (String(u).includes("/sync/pull") && res.ok) pulls.push((await res.clone().json()) as PullSeen);
      return res;
    }) as typeof fetch;
    web = new Client(cloudSrv.app, "http://cloud.test");
    await web.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان نمایش هم‌گام", timezone: "Asia/Tehran" })).id;
    // a real record, and demo rows written the way the pack writes them
    realTodo = (await web.post(`/o/${org}/r/todo`, { short_description: "کار واقعی" })).row.id;
    await newPack();
    demoTodo = await demoRecord("کار نمایشی بانک آفتاب");
    // one of the pack's people (as the loader adds them): an account marked with the pack, and its membership
    persona = await newPersona();
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
    expect(await deskDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [org, persona])).toBeTruthy();

    // the purge (as the job runs it) with a linked Windows app: tombstones, not deletions
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    for (let i = 0; i < 12; i++) await purgeStep(cloudCfg, org);
    const status = await demoStatus(cloudDb, org);
    expect(status.state).toBe("tombstoned");
    expect(status.waiting_devices).toBe(1);
    // a tombstone keeps no content
    const stone = await cloudDb.one<{ short_description: string | null; deleted_at: string | null; rev: string }>(`select short_description, deleted_at, rev::text as rev from sm_todos where id = $1`, [demoTodo]);
    expect(stone?.deleted_at).toBeTruthy();
    expect(stone?.short_description ?? "").toBe("");
    const entry = await cloudDb.one<{ body: string | null; deleted_at: string | null }>(`select body, deleted_at from sm_journal where record_id = $1`, [demoTodo]);
    expect(entry?.deleted_at).toBeTruthy();
    expect(entry?.body ?? "").toBe("");
    // the persona's membership stays a tombstone as well until the apps passed it (its account is gone)
    expect(await cloudDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is not null`, [org, persona])).toBeTruthy();
    expect(await cloudDb.one(`select 1 from sm_users where id = $1`, [persona])).toBeNull();
    // the apps must pass the transaction that wrote the last tombstones (a transaction id, not a counter)
    const mark = Number((await cloudDb.one<{ purge_mark: string }>(`select purge_mark::text as purge_mark from sm_demo_packs where org_id = $1`, [org]))!.purge_mark);
    expect(mark).toBeGreaterThan(Number(stone!.rev));
    // nothing went for good yet
    expect(await watermark()).toBe(0);
    // not yet: the Windows app has not pulled
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(false);

    // the Windows app's next pull empties its copies and marks them deleted (the app shows nothing of them; only an
    // empty marker with the id and times stays there); the real record stays as it was
    const seen = await sync();
    expect(seen.some((p) => p.reset)).toBe(false);
    const deskTodo = await deskDb.one<{ short_description: string | null; deleted_at: string | null }>(`select short_description, deleted_at from sm_todos where id = $1`, [demoTodo]);
    expect(!deskTodo || (!!deskTodo.deleted_at && !deskTodo.short_description)).toBe(true);
    const deskEntries = await deskDb.query<{ body: string | null; deleted_at: string | null }>(`select body, deleted_at from sm_journal where record_id = $1`, [demoTodo]);
    for (const j of deskEntries) expect(!!j.deleted_at && !j.body).toBe(true);
    const deskFiles = await deskDb.query<{ name: string | null; sha256: string | null; deleted_at: string | null }>(`select name, sha256, deleted_at from sm_attachments where record_id = $1`, [demoTodo]);
    for (const f of deskFiles) expect(!!f.deleted_at && !f.name && !f.sha256).toBe(true);
    // the persona no longer belongs to the organisation on this computer either
    expect(await deskDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [org, persona])).toBeNull();
    // nothing of it is visible in the app
    const local = new Client(deskApp, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
    expect((await local.get(`/o/${org}/r/todo`)).rows.map((r: { id: string }) => r.id)).toEqual([realTodo]);
    expect(await deskDb.one<{ short_description: string }>(`select short_description from sm_todos where id = $1 and deleted_at is null`, [realTodo])).toEqual({ short_description: "کار واقعی" });
    expect((await demoStatus(cloudDb, org)).waiting_devices).toBe(0);

    // every app passed the tombstones: they go for good, with the pack's bookkeeping
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(true);
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demoTodo])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_journal where record_id = $1`, [demoTodo])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_attachments where record_id = $1`, [demoTodo])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2`, [org, persona])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_blobs where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_rows where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [realTodo])).toBeTruthy();
    expect((await demoStatus(cloudDb, org)).state).toBe("none");
    // their removal raised the purge watermark to the newest tombstone: an app that pulled them reads on as before
    expect(await watermark()).toBeGreaterThanOrEqual(Number(stone!.rev));
    expect(await watermark()).toBeLessThan(mark);
    const after = await sync();
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((p) => p.reset || p.full)).toBe(false);
  }, 300_000);

  it("what the platform computed while the purge ran becomes a tombstone too while an app is linked", async () => {
    await newPack({ computed: true });
    const demo = await demoRecord("کار نمایشی دوم");
    await sync();
    expect(await deskDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeTruthy();
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil("restore");
    // a scheduled check opens a knowledge gap meanwhile, and the app pulls it
    const gap = await gapByThePlatform("demo-sync:restore");
    await sync();
    expect(await deskDb.one(`select 1 from sm_kb_gaps where id = $1 and deleted_at is null`, [gap])).toBeTruthy();
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).state).toBe("tombstoned");
    // the gap is a tombstone (with its history), not deleted: the app learns of it on its next pull
    expect((await cloudDb.one<{ deleted_at: string | null }>(`select deleted_at from sm_kb_gaps where id = $1`, [gap]))?.deleted_at).toBeTruthy();
    const before = await watermark();
    const seen = await sync();
    expect(seen.some((p) => p.reset)).toBe(false);
    expect(await goneFromApp("sm_kb_gaps", gap)).toBe(true);
    expect(await goneFromApp("sm_todos", demo)).toBe(true);
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(true);
    expect(await cloudDb.one(`select 1 from sm_kb_gaps where id = $1`, [gap])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_history where record_id = $1`, [gap])).toBeNull();
    expect(await watermark()).toBeGreaterThan(before);
    expect((await sync()).some((p) => p.reset || p.full)).toBe(false);
  }, 300_000);

  it("a purge while no app was active deletes at once: the app that comes back reads everything again and drops it", async () => {
    await newPack({ computed: true });
    const demo = await demoRecord("کار نمایشی سوم");
    const who = await newPersona();
    await sync();
    expect(await deskDb.one(`select 1 from sm_journal where record_id = $1`, [demo])).toBeTruthy();
    expect(await membershipOnApp(who)).toBe("live");
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil("clear");
    // computed after the expand phase, and pulled by the app
    const gap = await gapByThePlatform("demo-sync:inactive");
    await sync();
    expect(await deskDb.one(`select 1 from sm_kb_gaps where id = $1`, [gap])).toBeTruthy();
    // the app has not synced for over a month: the purge does not wait for it (no tombstones)
    await cloudDb.query(`update sm_devices set last_pull_at = now() - interval '31 days', created_at = now() - interval '31 days' where org_id = $1`, [org]);
    const before = await watermark();
    // removeRows deleted the demo record (no tombstone): the watermark rose to that transaction
    await purgeUntil("accounts");
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
    const removed = await watermark();
    expect(removed).toBeGreaterThan(before);
    // restoreComputed deleted the gap and its trail: the watermark rose again, to its own transaction
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).state).toBe("none");
    expect(await cloudDb.one(`select 1 from sm_kb_gaps where id = $1`, [gap])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_history where record_id = $1`, [gap])).toBeNull();
    expect(await watermark()).toBeGreaterThan(removed);
    // the app comes back: told to read everything again, it drops what the server no longer has (no marker left)
    const seen = await sync();
    expect(seen.some((p) => p.reset)).toBe(true);
    expect(seen.some((p) => p.full)).toBe(true);
    expect(await deskDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_journal where record_id = $1`, [demo])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_kb_gaps where id = $1`, [gap])).toBeNull();
    expect(await deskDb.one<{ short_description: string }>(`select short_description from sm_todos where id = $1 and deleted_at is null`, [realTodo])).toEqual({ short_description: "کار واقعی" });
    // the persona's membership went for good with the pack (no tombstone told the app): the full read drops it too, and
    // the owner's stays
    expect(await membershipOnApp(who)).toBe("none");
    expect(await deskDb.one(`select 1 from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1 and u.email = $2 and m.deleted_at is null`, [org, EMAIL])).toBeTruthy();
    // once read again, the app reads on as before
    expect((await sync()).some((p) => p.reset || p.full)).toBe(false);
  }, 300_000);

  it("an administrator's forced finalisation: the app that never pulled the tombstones reads everything again", async () => {
    await newPack();
    const demo = await demoRecord("کار نمایشی چهارم");
    const who = await newPersona();
    await sync();
    expect(await deskDb.one(`select 1 from sm_todos where id = $1 and deleted_at is null`, [demo])).toBeTruthy();
    expect(await membershipOnApp(who)).toBe("live");
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).waiting_devices).toBe(1);
    const before = await watermark();
    // the app has not pulled; the administrator does not wait for it
    expect(await finalizeDemo(cloudCfg, org, { force: true })).toEqual({ done: true, waiting: 1 });
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
    expect(await watermark()).toBeGreaterThan(before);
    // the app's cursor does not see the removed tombstones: it reads everything again and drops its copy
    const seen = await sync();
    expect(seen.some((p) => p.reset)).toBe(true);
    expect(await deskDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_journal where record_id = $1`, [demo])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_todos where id = $1 and deleted_at is null`, [realTodo])).toBeTruthy();
    // the persona's membership tombstone went before the app pulled it: the full read drops its live copy
    expect(await membershipOnApp(who)).toBe("none");
  }, 300_000);
});

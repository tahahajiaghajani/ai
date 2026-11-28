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
import { SyncClient, resetSyncCursor } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge, ServerConfig } from "@server/context";
import { createIn, systemCtx, addJournalIn } from "@server/engine";
import { TABLES } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import { inDemoScope } from "@server/db/scope";
import { finalizeDemo, purgeStep, demoStatus } from "@server/modules/demo";
import { saveComputed, tablesInfo } from "@server/modules/demo/purge";
import { PURGED_ACCOUNT_NAME } from "@server/modules/demo/ledger";
import { addPerson } from "@server/modules/demo/load";
import { BY_ENTITY } from "@server/sync/registry";
import { writeAggregate } from "@server/sync/apply";
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
  let ownerId = "";
  const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

  /** The owner signed in on the Windows app itself (what the app does offline queues in its outbox). */
  async function localOwner(): Promise<Client> {
    const local = new Client(deskApp, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
    return local;
  }

  /** Live ids of a table of the organisation. */
  const liveIds = async (db: Db, table: string) => (await db.query<{ id: string }>(`select id::text as id from ${table} where org_id = $1 and deleted_at is null order by id`, [org])).map((r) => r.id);

  /** Live rows of the organisation on the server that name an id a purge removed (the trail aside: it is kept by design). */
  async function danglingOnServer(): Promise<string[]> {
    const purged = new Set((await cloudDb.query<{ id: string }>(`select row_id::text as id from sm_demo_purged where org_id = $1`, [org])).map((r) => r.id));
    const out: string[] = [];
    for (const t of ["sm_todos", "sm_journal", "sm_attachments", "sm_links", "sm_org_members"]) {
      const rows = await cloudDb.query<{ j: string }>(`select to_jsonb(x)::text as j from ${t} x where x.org_id = $1 and x.deleted_at is null`, [org]);
      for (const r of rows) for (const id of r.j.match(UUIDS) ?? []) if (purged.has(id)) out.push(`${t}:${id}`);
    }
    return out;
  }

  /** What waits in the Windows app's outbox. */
  const outboxLeft = async () => (await deskDb.query<{ entity: string; id: string; attempts: number }>(`select entity, id::text as id, attempts from sm_outbox`));

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
    ownerId = (await cloudDb.one<{ id: string }>(`select id from sm_users where email = $1`, [EMAIL]))!.id;
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
    // the persona's membership stays a tombstone as well until the apps passed it, and so does its account (1.1.5): no
    // name, address or password of the persona, disabled, marked so that a linked app deletes the account
    expect(await cloudDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is not null`, [org, persona])).toBeTruthy();
    expect(await cloudDb.one(`select email, full_name, password_hash, disabled, prefs from sm_users where id = $1`, [persona])).toEqual({
      email: `purged.${persona}@demo.invalid`, full_name: PURGED_ACCOUNT_NAME, password_hash: null, disabled: true, prefs: { demo_purged: org },
    });
    // the purged-id ledger keeps what the purge removed (ids and tables only), after the pack's bookkeeping too
    const ledger = new Set((await cloudDb.query<{ id: string }>(`select row_id::text as id from sm_demo_purged where org_id = $1`, [org])).map((r) => r.id));
    for (const id of [demoTodo, persona]) expect(ledger.has(id)).toBe(true);
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
    // the persona no longer belongs to the organisation on this computer either, and its account left with its tombstone
    expect(await deskDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [org, persona])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_users where id = $1`, [persona])).toBeNull();
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
    expect(await cloudDb.one(`select 1 from sm_users where id = $1`, [persona])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_blobs where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_rows where org_id = $1`, [org])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_packs where org_id = $1`, [org])).toBeNull();
    // the ledger stays after the pack's bookkeeping (a Windows app away for a while pushes later)
    expect(await cloudDb.one(`select 1 from sm_demo_purged where org_id = $1 and row_id = $2`, [org, demoTodo])).toBeTruthy();
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
    // and its account, which belongs to no organisation here any more (1.1.5)
    expect(await deskDb.one(`select 1 from sm_users where id = $1`, [who])).toBeNull();
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
    // the persona's membership tombstone went before the app pulled it: the full read drops its live copy, and the account
    expect(await membershipOnApp(who)).toBe("none");
    expect(await deskDb.one(`select 1 from sm_users where id = $1`, [who])).toBeNull();
  }, 300_000);
  /**
   * What a Windows app does offline about the pack — after the server's purge, before its next sync: it edits a demo
   * record and comments on it, edits a real record whose pointer named a persona (the purge cleared it there) and one
   * whose requester was a persona (the purge took it with the pack), and makes one real record for a persona (the
   * persona is whose record it is) and one that only points at the persona.
   */
  async function offlineWork(demo: string, who: string, realNaming: string, realRequester: string) {
    const local = await localOwner();
    await local.patch(`/o/${org}/r/todo/${demo}`, { short_description: "ویرایش بیرون از خط" });
    await local.post(`/o/${org}/r/todo/${demo}/journal`, { kind: "comment", body: "یادداشت بیرون از خط" });
    await local.patch(`/o/${org}/r/todo/${realNaming}`, { short_description: "کار واقعی ویرایش‌شده بیرون از خط" });
    // (the app's copy still names the persona as the one it is for: it read the record before the purge)
    await local.patch(`/o/${org}/r/todo/${realRequester}`, { short_description: "درخواست واقعی ویرایش‌شده بیرون از خط" });
    const forPersona = (await local.post(`/o/${org}/r/todo`, { short_description: "کار برای کارمند نمایشی", caller_id: who })).row.id as string;
    const pointing = (await local.post(`/o/${org}/r/todo`, { short_description: "کار واقعی بیرون از خط", assigned_to: who, watch_list: [who, ownerId] })).row.id as string;
    expect((await outboxLeft()).length).toBeGreaterThan(0);
    return { forPersona, pointing };
  }

  /** After the app's sync: nothing came back, nothing dangles, nothing waits, and the app agrees with the server. */
  async function expectSettled(demo: string, who: string, work: { forPersona: string; pointing: string }, realNaming: string, realRequester: string) {
    // the demo record is not brought back (gone, or its content-free tombstone)
    const stone = await cloudDb.one<{ short_description: string | null; deleted_at: string | null }>(`select short_description, deleted_at from sm_todos where id = $1`, [demo]);
    expect(!stone || (!!stone.deleted_at && !stone.short_description)).toBe(true);
    expect(await cloudDb.one(`select 1 from sm_journal where record_id = $1 and deleted_at is null`, [demo])).toBeNull();
    // the record made for the persona was recorded on demo data: not stored, and gone from the app with its trail
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [work.forPersona])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_todos where id = $1`, [work.forPersona])).toBeNull();
    expect(await deskDb.one(`select 1 from sm_history where record_id = $1`, [work.forPersona])).toBeNull();
    // the real record that only pointed at the persona is stored without those pointers, on both sides
    for (const db of [cloudDb, deskDb]) {
      expect(await db.one(`select assigned_to, watch_list, deleted_at from sm_todos where id = $1`, [work.pointing])).toEqual({ assigned_to: null, watch_list: [ownerId], deleted_at: null });
    }
    // the edit of the real record the purge had cleared is taken, its cleared pointer stays cleared
    expect(await cloudDb.one(`select short_description, assigned_to from sm_todos where id = $1`, [realNaming])).toEqual({ short_description: "کار واقعی ویرایش‌شده بیرون از خط", assigned_to: null });
    expect(await deskDb.one(`select assigned_to from sm_todos where id = $1`, [realNaming])).toEqual({ assigned_to: null });
    // a real record whose requester was the persona went with the pack (1.1.5, docs/DEMO_FA.md «قواعد ایمنی»: what was
    // recorded on demo data goes with it, whoever made it): the offline edit of it does not bring it back — on the server
    // it is gone or its content-free tombstone — and the app drops its copy
    const asked = await cloudDb.one<{ short_description: string | null; deleted_at: string | null }>(`select short_description, deleted_at from sm_todos where id = $1`, [realRequester]);
    expect(!asked || (!!asked.deleted_at && !asked.short_description)).toBe(true);
    expect(await goneFromApp("sm_todos", realRequester)).toBe(true);
    // the app's copy of the demo record and the persona's account are gone (or an empty deleted marker)
    expect(await goneFromApp("sm_todos", demo)).toBe(true);
    expect(await deskDb.one(`select 1 from sm_users where id = $1`, [who])).toBeNull();
    // the outbox drained: nothing waits, nothing failed for good
    expect(await outboxLeft()).toEqual([]);
    expect(client.state.failed).toEqual([]);
    // no live row on the server names what the purge removed
    expect(await danglingOnServer()).toEqual([]);
  }

  /** A full read from nothing: afterwards the app holds exactly the server's records. */
  async function expectConsistentFullRead() {
    await resetSyncCursor(deskDb);
    const seen = await sync();
    expect(seen.some((p) => p.full)).toBe(true);
    expect(await liveIds(deskDb, "sm_todos")).toEqual(await liveIds(cloudDb, "sm_todos"));
    expect(await liveIds(deskDb, "sm_journal")).toEqual(await liveIds(cloudDb, "sm_journal"));
    expect(await outboxLeft()).toEqual([]);
  }

  it("offline work on purged demo data comes back neither as data nor as references (tombstones, then finalisation)", async () => {
    await newPack();
    const demo = await demoRecord("کار نمایشی که برنامه بیرون از خط ویرایش می‌کند");
    const who = await newPersona();
    // a real record naming the persona, made online: the purge clears its pointer
    const realNaming = (await web.post(`/o/${org}/r/todo`, { short_description: "کار واقعی با کارشناس نمایشی", assigned_to: who })).row.id as string;
    const realRequester = (await web.post(`/o/${org}/r/todo`, { short_description: "درخواست واقعی برای کارمند نمایشی", caller_id: who })).row.id as string;
    await sync();
    expect(await deskDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeTruthy();
    // the server purges (the app pulled a moment ago: tombstones), while the app works offline
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).state).toBe("tombstoned");
    const work = await offlineWork(demo, who, realNaming, realRequester);
    await sync();
    await expectSettled(demo, who, work, realNaming, realRequester);
    // the tombstones go for good; the app reads on as before, and a full read agrees with the server
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(true);
    expect((await sync()).some((p) => p.reset || p.full)).toBe(false);
    await expectConsistentFullRead();
  }, 300_000);

  it("offline work on purged demo data after a purge with no active app: refused, and the full read is consistent", async () => {
    await newPack();
    const demo = await demoRecord("کار نمایشی دوم بیرون از خط");
    const who = await newPersona();
    const realNaming = (await web.post(`/o/${org}/r/todo`, { short_description: "کار واقعی دوم با کارشناس نمایشی", assigned_to: who })).row.id as string;
    const realRequester = (await web.post(`/o/${org}/r/todo`, { short_description: "درخواست واقعی دوم برای کارمند نمایشی", caller_id: who })).row.id as string;
    await sync();
    // the app has not synced for over a month: the purge deletes at once and raises the purge watermark
    await cloudDb.query(`update sm_devices set last_pull_at = now() - interval '31 days', created_at = now() - interval '31 days' where org_id = $1`, [org]);
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).state).toBe("none");
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
    const work = await offlineWork(demo, who, realNaming, realRequester);
    const seen = await sync();
    // the push came first (nothing brought back), then the watermark's full read
    expect(seen.some((p) => p.reset)).toBe(true);
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [demo])).toBeNull();
    await expectSettled(demo, who, work, realNaming, realRequester);
    await expectConsistentFullRead();
  }, 300_000);

  it("the purge moves every member's scope epoch once, not once per group or unit; the tombstones' removal not at all", async () => {
    await newPack();
    const sys = await systemCtx(cloudCfg, org);
    await inDemoScope(org, () =>
      sys.write(async (tx) => {
        for (let i = 0; i < 3; i++) await createIn(tx, sys, "org_unit", { name: `واحد نمایشی ${i + 1}` }, { trusted: true });
        for (let i = 0; i < 5; i++) await createIn(tx, sys, "group", { name: `گروه نمایشی ${i + 1}` }, { trusted: true });
      }),
    );
    await sync();
    await sync();
    const epoch = async () => Number((await cloudDb.one<{ e: string }>(`select epoch::text as e from sm_scope_epochs where org_id = $1 and user_id = $2`, [org, ownerId]))?.e ?? 0);
    const before = await epoch();
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).state).toBe("tombstoned");
    // one bump per purge step (transaction) that changed the organisation's structure — never one per group or unit
    // (eight here)
    const purged = await epoch();
    expect(purged - before).toBeGreaterThanOrEqual(1);
    expect(purged - before).toBeLessThanOrEqual(2);
    // the app reads everything again once
    const seen = await sync();
    expect(seen.filter((p) => p.reset).length).toBe(1);
    expect((await sync()).some((p) => p.reset || p.full)).toBe(false);
    // the tombstones go for good: every app it waited for pulled them, no epoch moves, no app reads everything again
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(true);
    expect(await epoch()).toBe(purged);
    expect((await sync()).some((p) => p.reset || p.full)).toBe(false);
  }, 300_000);

  it("a second purge recognises what the first left behind; the loader marks a kept persona account again", async () => {
    const other = (await web.post<{ id: string }>("/orgs", { name: "سازمان دوم همان مالک", timezone: "Asia/Tehran" })).id;
    await newPack();
    const first = await demoRecord("کار نمایشی بار نخست");
    const gone = await newPersona();
    // a persona account that also belongs to another organisation: the purge keeps it there (only its mark goes)
    const kept = await newPersona();
    await cloudDb.query(`insert into sm_org_members (id, org_id, user_id, role) values ($1, $2, $3, 'member')`, [uuidv7(), other, kept]);
    const keptEmail = (await cloudDb.one<{ email: string }>(`select email from sm_users where id = $1`, [kept]))!.email;
    const firstRow = (await cloudDb.one<Record<string, unknown>>(`select * from sm_todos where id = $1`, [first]))!;
    const pointing = (await web.post(`/o/${org}/r/todo`, { short_description: "کار واقعی که بعداً به کارمند حذف‌شده اشاره می‌کند" })).row.id as string;
    await cloudDb.query(`update sm_devices set last_pull_at = now() - interval '31 days', created_at = now() - interval '31 days' where org_id = $1`, [org]);
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [first])).toBeNull();
    expect(await cloudDb.one(`select prefs from sm_users where id = $1`, [kept])).toEqual({ prefs: {} });
    expect(await cloudDb.one(`select 1 from sm_demo_purged where org_id = $1 and row_id = $2`, [org, kept])).toBeNull();
    // what that purge left behind (an older app's push, before the ledger existed): the demo record alive again, and a
    // real record pointing at the removed persona
    await cloudDb.tx(async (tx) => {
      await tx.query("set local itsm.applying = 'on'");
      await writeAggregate(tx, BY_ENTITY.get("todo")!, { entity: "todo", id: first, base_rev: 0, row: firstRow, children: {} }, org, "incoming-yields");
      await tx.query(`update sm_todos set assigned_to = $2 where id = $1`, [pointing, gone]);
    });
    // a reload: the kept persona's address is taken again — the account is marked for the pack, never inserted twice
    await newPack();
    const second = await demoRecord("کار نمایشی بار دوم");
    const sys = await systemCtx(cloudCfg, org);
    const again = await inDemoScope(org, () =>
      sys.write((tx) => addPerson(tx, sys, org, { email: keptEmail, name: "کارمند نمایشی دوباره", title: "کارشناس", roles: ["requester"], hash: null })),
    );
    expect(again).toBe(kept);
    expect((await cloudDb.one<{ prefs: Record<string, unknown> }>(`select prefs from sm_users where id = $1`, [kept]))!.prefs.demo_org).toBe(org);
    expect(await cloudDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`, [org, kept])).toBeTruthy();
    // the second purge takes the leftovers of the first too
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [first])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_todos where id = $1`, [second])).toBeNull();
    expect(await cloudDb.one(`select assigned_to, deleted_at from sm_todos where id = $1`, [pointing])).toEqual({ assigned_to: null, deleted_at: null });
    // the kept account is kept again for the other organisation, and stays out of the ledger
    expect(await cloudDb.one(`select prefs from sm_users where id = $1`, [kept])).toEqual({ prefs: {} });
    expect(await cloudDb.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2`, [org, kept])).toBeNull();
    expect(await cloudDb.one(`select 1 from sm_demo_purged where org_id = $1 and row_id = $2`, [org, kept])).toBeNull();
    for (const id of [first, second, gone]) expect(await cloudDb.one(`select 1 from sm_demo_purged where org_id = $1 and row_id = $2`, [org, id])).toBeTruthy();
    expect(await danglingOnServer()).toEqual([]);
    // the app comes back: everything again, consistent with the server
    await sync();
    await expectConsistentFullRead();
  }, 300_000);

  it("a definition the app pushes after the purge, naming only purged data where that would widen it, is never stored widened", async () => {
    // (the review of 1.1.5: the push filter emptied a pushed audience or scope and stored the row as pushed — «خالی
    // یعنی همه» — and an offline edit made after the purge wrote a definition the purge had switched off back on)
    await newPack();
    const sys = await systemCtx(cloudCfg, org);
    const pack = await inDemoScope(org, () =>
      sys.write(async (tx) => ({
        group: String((await createIn(tx, sys, "group", { name: "میز خدمت نمایشی", types: ["assignment"] }, { trusted: true })).id),
        service: String((await createIn(tx, sys, "service", { name: "خدمت کارت نمایشی", service_type: "business" }, { trusted: true })).id),
      })),
    );
    const who = await newPersona();
    // what the owner built on the pack, online: a portal link for its group, an SLA of its service
    const sla = { table_key: "incident", type: "sla", target: "response", start_condition: { f: "priority", op: "in", v: ["1", "2", "3", "4"] } };
    const link = (await web.post(`/o/${org}/r/portal_link`, { name: "سامانهٔ میز خدمت", url: "https://desk.example.com", aud_groups: [pack.group] })).row.id as string;
    const online = (await web.post(`/o/${org}/r/sla_definition`, { ...sla, name: "پاسخ خدمت کارت", duration: 3600, service_id: pack.service })).row.id as string;
    await sync();
    expect(await deskDb.one(`select 1 from sm_portal_links where id = $1 and deleted_at is null`, [link])).toBeTruthy();
    // the server purges while the app is away (tombstones: it pulled a moment ago); the purge switches both off
    await web.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" });
    await purgeUntil(null);
    expect((await demoStatus(cloudDb, org)).state).toBe("tombstoned");
    expect(await cloudDb.one(`select active from sm_portal_links where id = $1`, [link])).toEqual({ active: false });
    expect(await cloudDb.one(`select active, service_id from sm_sla_definitions where id = $1`, [online])).toEqual({ active: false, service_id: null });
    // offline, after the purge, the app (which still holds the pack) edits the link and makes a topic for the persona and
    // an SLA of the pack's service
    const local = await localOwner();
    await local.patch(`/o/${org}/r/portal_link/${link}`, { name: "سامانهٔ میز خدمت (بیرون از خط)" });
    const topic = (await local.post(`/o/${org}/r/portal_topic`, { name: "پرسش‌های کارکنان نمایشی", aud_users: [who] })).row.id as string;
    const offline = (await local.post(`/o/${org}/r/sla_definition`, { ...sla, name: "پاسخ خدمت کارت (بیرون از خط)", duration: 1800, service_id: pack.service })).row.id as string;
    await sync();
    // the link stays as the purge left it (off, its audience empty); the topic and the SLA are stored switched off —
    // never «for everyone» or «every record»
    const l = (await cloudDb.one<Record<string, any>>(`select active, aud_groups, name from sm_portal_links where id = $1`, [link]))!;
    expect(l).toMatchObject({ active: false, name: "سامانهٔ میز خدمت" });
    expect(l.aud_groups ?? []).toEqual([]);
    const t = (await cloudDb.one<Record<string, any>>(`select active, aud_users, deleted_at from sm_portal_topics where id = $1`, [topic]))!;
    expect(t).toMatchObject({ active: false, deleted_at: null });
    expect(t.aud_users ?? []).toEqual([]);
    expect(await cloudDb.one(`select active, service_id, deleted_at from sm_sla_definitions where id = $1`, [offline])).toEqual({ active: false, service_id: null, deleted_at: null });
    // the app took the server's copies, and nothing waits or failed
    expect(await deskDb.one(`select active from sm_portal_links where id = $1`, [link])).toEqual({ active: false });
    expect(await deskDb.one(`select active from sm_portal_topics where id = $1`, [topic])).toEqual({ active: false });
    expect(await deskDb.one(`select active, service_id from sm_sla_definitions where id = $1`, [offline])).toEqual({ active: false, service_id: null });
    expect(await outboxLeft()).toEqual([]);
    expect(client.state.failed).toEqual([]);
    // the owner is told what to review: each of them has its line
    const reviewed = (await cloudDb.query<{ id: string }>(`select entity_id::text as id from sm_audit where org_id = $1 and action = 'demo_purge_review'`, [org])).map((r) => r.id);
    for (const id of [link, topic, offline]) expect(reviewed).toContain(id);
    expect((await finalizeDemo(cloudCfg, org)).done).toBe(true);
  }, 300_000);
});

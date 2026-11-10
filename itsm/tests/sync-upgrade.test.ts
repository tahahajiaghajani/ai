// Synchronisation across updates of the app: a Windows app on another sync protocol, rows from an older schema
// (without the columns added since), the full re-read after a protocol change and the retry of failed uploads after
// a schema change, data migrations that must not travel as edits, a failure inside one aggregate of a push, and an
// organisation made read-only by the platform admin. Records are those of the fixture module.
import { describe, it, expect } from "vitest";
import "./fixtures/module";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { afterWrite, writeAggregate } from "@server/sync/apply";
import { BY_ENTITY } from "@server/sync/registry";
import { SCHEMA_VERSION } from "@server/db/migrations";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import type { Db } from "@server/db";

const PASSWORD = "sync-pass-1405";

let ipSeq = 0;
async function linkedPair(email: string) {
  const cloudSrv = await makeServer({ mode: "cloud" });
  const deskSrv = await makeServer({ mode: "desktop" });
  const ip = `10.19.${++ipSeq}.1`;
  const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(u), init);
    req.headers.set("x-forwarded-for", ip);
    return cloudSrv.app.fetch(req);
  }) as typeof fetch;
  const web = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", ip); return cloudSrv.app.fetch(r); } }, "http://cloud.test");
  await web.post("/auth/signup", { email, password: PASSWORD, full_name: "مالک ابری" });
  const config = defaultConfig();
  const client = new SyncClient({ db: deskSrv.db, config, save() {}, log: { info() {}, warn() {}, error() {} }, fetch: cloudFetch });
  const local = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", `10.18.${ipSeq}.1`); return deskSrv.app.fetch(r); } }, "http://desk.test");
  const org = (await web.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام" })).id;
  await client.link({ url: "http://cloud.test", email, password: PASSWORD, orgId: org, direction: "download" });
  await local.post("/auth/login", { email, password: PASSWORD });
  return { cloudDb: cloudSrv.db, deskDb: deskSrv.db, web, client, local, org };
}

/** a change made as if it came from a sync or a data migration (no outbox entry, no new updated_at) */
async function quietly(db: Db, sql: string, params: unknown[] = []) {
  await db.tx(async (tx) => {
    await tx.query("set local itsm.applying = 'on'");
    await tx.query(sql, params);
  });
}

const items = (db: Db, org: string) =>
  db.query<{ id: string; code: string; name: string; notes: string | null; tags: string[] }>(`select id, code, name, notes, tags from sm_test_items where org_id = $1 and deleted_at is null order by code`, [org]);

describe("a Windows app of another version against the cloud", () => {
  it("the cloud refuses a push of another protocol", async () => {
    const p = await linkedPair("proto-owner@example.com");
    for (const protocol of [SYNC_PROTOCOL - 1, SYNC_PROTOCOL + 1]) {
      const res = await p.web.post(`/sync/push`, { org_id: p.org, device_id: uuidv7(), protocol, aggregates: [] }, 400);
      expect(res.error.message).toContain("به‌روز");
    }
  });

  it("a row without the columns added since keeps their stored values (or takes their defaults)", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    const made = (await c.post(`/o/${org}/data/test_item`, { name: "سرور", tags: ["critical"], qty: "4" })).row;
    const item = (await s.db.one<Record<string, unknown>>(`select * from sm_test_items where id = $1`, [made.id]))!;
    // an older build that knew neither `tags` nor `qty`
    const { tags: _t, qty: _q, ...old } = item;
    const def = BY_ENTITY.get("test_item")!;
    await s.db.tx(async (tx) => {
      await tx.query("set local itsm.applying = 'on'");
      await writeAggregate(tx, def, { entity: "test_item", id: String(item.id), base_rev: 0, row: { ...old, name: "سرور اصلی" }, children: {} }, org, "incoming-yields");
      // a new row from the older app: `tags` (NOT NULL) and `qty` take their defaults
      const id = uuidv7();
      await writeAggregate(tx, def, { entity: "test_item", id, base_rev: 0, row: { ...old, id, code: "9001", name: "قلم تازه" }, children: {} }, org, "incoming-yields");
      const fresh = await tx.one<{ tags: unknown; qty: string }>(`select tags, qty::text as qty from sm_test_items where id = $1`, [id]);
      expect(fresh).toEqual({ tags: [], qty: "0" });
    });
    const after = (await s.db.one<Record<string, unknown>>(`select name, tags, qty::text as qty from sm_test_items where id = $1`, [item.id]))!;
    expect(after).toEqual({ name: "سرور اصلی", tags: ["critical"], qty: "4" });
  });

  it("after a protocol update the Windows app reads everything again and retries uploads that failed", async () => {
    const p = await linkedPair("upgrade-owner@example.com");
    await p.web.post(`/o/${p.org}/data/test_item`, { name: "قلم ابری", notes: "یادداشت ابری", tags: ["shared"] });
    const doc = (await p.web.post(`/o/${p.org}/test/docs`, { title: "سند ابری", lines: [{ text: "ردیف", qty: 1 }] })).doc;
    await p.client.syncNow();
    const before = await items(p.cloudDb, p.org);
    // what the previous version left behind: a column it did not know, a record it skipped, an upload the cloud
    // refused five times
    await quietly(p.deskDb, `update sm_test_items set notes = null, tags = '[]'::jsonb where org_id = $1`, [p.org]);
    await quietly(p.deskDb, `delete from sm_test_docs where id = $1`, [doc.id]);
    const stuck = (await p.local.post(`/o/${p.org}/data/test_item`, { name: "قلم مانده در صف" })).row;
    await p.deskDb.query(`update sm_outbox set attempts = 5, last_error = 'null value in column' where id = $1`, [stuck.id]);
    // the previous protocol's builds kept neither marker
    await p.deskDb.query(`delete from sm_kv where key in ('sync.schema', 'sync.protocol')`);

    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const after = await items(p.deskDb, p.org);
    expect(after.filter((r) => r.id !== stuck.id)).toEqual(before);
    expect(await p.deskDb.one(`select title from sm_test_docs where id = $1`, [doc.id])).toEqual({ title: "سند ابری" });
    expect(await p.deskDb.query(`select text from sm_test_doc_lines where doc_id = $1`, [doc.id])).toEqual([{ text: "ردیف" }]);
    expect(await p.cloudDb.one(`select 1 as ok from sm_test_items where id = $1`, [stuck.id])).toEqual({ ok: 1 });
    expect((await p.deskDb.one<{ value: string }>(`select value from sm_kv where key = 'sync.schema'`))!.value).toBe(SCHEMA_VERSION);
    expect((await p.deskDb.one<{ value: number }>(`select value from sm_kv where key = 'sync.protocol'`))!.value).toBe(SYNC_PROTOCOL);
    expect(p.client.state.failed).toEqual([]);
  });

  it("an update that changes the database but not the sync protocol retries failed uploads without reading everything again", async () => {
    const p = await linkedPair("schema-only-owner@example.com");
    const urls: string[] = [];
    const o = (p.client as unknown as { o: { fetch: typeof fetch } }).o;
    const inner = o.fetch;
    o.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => (urls.push(String(u)), inner(u, init))) as typeof fetch;
    const stuck = (await p.local.post(`/o/${p.org}/data/test_item`, { name: "قلم مانده در صف" })).row;
    await p.deskDb.query(`update sm_outbox set attempts = 5, last_error = 'خطا' where id = $1`, [stuck.id]);
    // a build of the same protocol, one migration behind
    await p.deskDb.query(`update sm_kv set value = '"0003_integrations"'::jsonb where key = 'sync.schema'`);
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(await p.cloudDb.one(`select 1 as ok from sm_test_items where id = $1`, [stuck.id])).toEqual({ ok: 1 });
    expect(urls.filter((u) => u.includes("/sync/pull") && /[?&]cursor=0&/.test(u))).toEqual([]);
    expect((await p.deskDb.one<{ value: string }>(`select value from sm_kv where key = 'sync.schema'`))!.value).toBe(SCHEMA_VERSION);
    expect((await p.deskDb.one<{ value: number }>(`select value from sm_kv where key = 'sync.protocol'`))!.value).toBe(SYNC_PROTOCOL);
  });

  it("a Windows app newer than the web says that the web needs the update and keeps its changes", async () => {
    const p = await linkedPair("old-web-owner@example.com");
    const o = (p.client as unknown as { o: { fetch: typeof fetch } }).o;
    const inner = o.fetch;
    // the web still runs an older protocol
    o.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("/sync/push")) return Response.json({ error: { message: "نسخه‌ی برنامه‌ی ویندوز با سرور هم‌خوان نیست؛ برنامه را به‌روز کنید" } }, { status: 400 });
      if (url.includes("/sync/status")) return Response.json({ protocol: SYNC_PROTOCOL - 1, head: 0 });
      return inner(u, init);
    }) as typeof fetch;
    const item = (await p.local.post(`/o/${p.org}/data/test_item`, { name: "قلم ویندوز" })).row;
    await p.client.syncNow();
    expect(p.client.state.last_error).toContain("نسخه‌ی وب");
    expect(p.client.state.last_error).not.toContain("برنامه را به‌روز کنید");
    expect(await p.deskDb.one(`select 1 as queued from sm_outbox where id = $1`, [item.id])).toEqual({ queued: 1 });
  });
});

describe("data migrations on both runtimes (itsm.applying)", () => {
  it("on a Windows app they queue nothing for upload (the cloud runs the same migration)", async () => {
    const s = await makeServer({ mode: "desktop" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    await c.post(`/o/${org}/data/test_item`, { name: "قلم" });
    await s.db.query(`delete from sm_outbox`);
    await quietly(s.db, `update sm_test_items set notes = 'پر شده با migration' where org_id = $1`, [org]);
    expect(await s.db.query(`select entity, id from sm_outbox`)).toEqual([]);
    // an ordinary write still queues
    await s.db.query(`update sm_test_items set notes = 'ویرایش' where org_id = $1`, [org]);
    expect((await s.db.query(`select entity from sm_outbox`)).map((r) => (r as { entity: string }).entity)).toEqual(["test_item"]);
  });

  it("on the cloud their touches get revisions but keep updated_at", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    const made = (await c.post(`/o/${org}/data/test_item`, { name: "قلم" })).row;
    await quietly(s.db, `update sm_test_items set updated_at = '2026-01-01T00:00:00Z' where id = $1`, [made.id]);
    const mid = (await s.db.one<{ rev: number }>(`select rev from sm_test_items where id = $1`, [made.id]))!.rev;
    await quietly(s.db, `update sm_test_items set notes = 'پر شده با migration' where id = $1`, [made.id]);
    const after = (await s.db.one<{ notes: string; rev: number; updated_at: string }>(`select notes, rev, updated_at from sm_test_items where id = $1`, [made.id]))!;
    expect(after.notes).toBe("پر شده با migration");
    // a desktop pulls it (new revision) without it winning last-writer-wins against a real edit (old updated_at)
    expect(Number(after.rev)).toBeGreaterThan(Number(mid));
    expect(new Date(after.updated_at).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("a failure while an aggregate is written", () => {
  it("rolls back that aggregate only and leaves the push's transaction usable", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    const def = BY_ENTITY.get("test_doc")!;
    const lines = (doc: string) => ({ sm_test_doc_lines: [{ id: uuidv7(), doc_id: doc, line_no: 1, text: "ردیف", qty: 1 }] });
    // a child row the database refuses
    await s.db.query(`create or replace function sm_test_fail() returns trigger language plpgsql as $$ begin raise exception 'doc lines locked'; end $$`);
    await s.db.query(`create trigger sm_test_fail before insert on sm_test_doc_lines for each row execute function sm_test_fail()`);
    const a = uuidv7();
    const b = uuidv7();
    await s.db.tx(async (tx) => {
      await tx.query("set local itsm.applying = 'on'");
      await expect(writeAggregate(tx, def, { entity: "test_doc", id: a, base_rev: 0, row: { id: a, no: 1, title: "الف" }, children: lines(a) }, org, "incoming-yields")).rejects.toThrow("doc lines locked");
      expect(await tx.one(`select 1 from sm_test_docs where id = $1`, [a])).toBeNull();
      // the next aggregate of the same push is applied as usual
      await writeAggregate(tx, def, { entity: "test_doc", id: b, base_rev: 0, row: { id: b, no: 2, title: "ب" }, children: {} }, org, "incoming-yields");
    });
    await s.db.query(`drop trigger sm_test_fail on sm_test_doc_lines`);
    expect(await s.db.one(`select title from sm_test_docs where id = $1`, [b])).toEqual({ title: "ب" });

    // a module's follow-up that fails after the aggregate was written: rolled back too, never retried as a clash
    let calls = 0;
    afterWrite.set("test_doc", async () => {
      calls++;
      throw Object.assign(new Error("follow-up failed"), { code: "23505", constraint: "sm_test_docs_no_uk" });
    });
    try {
      const d = uuidv7();
      await s.db.tx(async (tx) => {
        await tx.query("set local itsm.applying = 'on'");
        await expect(writeAggregate(tx, def, { entity: "test_doc", id: d, base_rev: 0, row: { id: d, no: 3, title: "ج" }, children: lines(d) }, org, "incoming-yields")).rejects.toThrow("follow-up failed");
        expect(await tx.one(`select 1 from sm_test_docs where id = $1`, [d])).toBeNull();
      });
      expect(calls).toBe(1);
    } finally {
      afterWrite.delete("test_doc");
    }
  });
});

describe("an organisation made read-only by the platform admin", () => {
  it("keeps receiving the cloud's changes while its own uploads are refused", async () => {
    const p = await linkedPair("readonly-owner@example.com");
    const web = (await p.web.post(`/o/${p.org}/data/test_item`, { name: "قلم وب" })).row;
    await p.cloudDb.query(`insert into sm_org_admin (org_id, status) values ($1, 'read_only')`, [p.org]);
    const local = (await p.local.post(`/o/${p.org}/data/test_item`, { name: "قلم ویندوز" })).row;
    await p.client.syncNow();
    expect(await p.deskDb.one(`select name from sm_test_items where id = $1`, [web.id])).toEqual({ name: "قلم وب" });
    expect(p.client.state.last_error).toContain("فقط‌خواندنی");
    expect(await p.deskDb.one(`select 1 as queued from sm_outbox where id = $1`, [local.id])).toEqual({ queued: 1 });
    expect(await p.cloudDb.one(`select 1 from sm_test_items where id = $1`, [local.id])).toBeNull();
  });
});

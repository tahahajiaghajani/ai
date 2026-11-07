// Synchronisation across an update of the schema (coins and bars, migration 0013), and the
// clashes that new data brings: board keys, bar numbers, a business made read-only.
import { describe, it, expect } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { writeAggregate } from "@server/sync/apply";
import { BY_ENTITY } from "@server/sync/registry";
import goldBullion from "@server/db/migrations/0013_gold_bullion";
import rateKeyUnique from "@server/db/migrations/0017_rate_key_unique";
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
  const local = new Client(deskSrv.app, "http://desk.test");
  const org = (await web.post<{ id: string }>("/orgs", { name: "طلافروشی هم‌گام", business_kind: "gold", modules: ["gold"], base_currency: "IRR", fiscal_year: 1405 })).id;
  await client.link({ url: "http://cloud.test", email, password: PASSWORD, orgId: org, direction: "download" });
  await local.post("/auth/login", { email, password: PASSWORD });
  return { cloudDb: cloudSrv.db, deskDb: deskSrv.db, web, client, local, org };
}

/** a change made as if it came from a sync (no outbox entry, no new updated_at) */
async function quietly(db: Db, sql: string, params: unknown[] = []) {
  await db.tx(async (tx) => {
    await tx.query("set local itsm.applying = 'on'");
    await tx.query(sql, params);
  });
}

const keys = (db: Db, org: string) =>
  db.query<{ id: string; rate_key: string | null; gold_meta: Record<string, unknown> }>(
    `select id, rate_key, gold_meta from sm_items where org_id = $1 and kind in ('coin', 'bar') and deleted_at is null order by id`,
    [org],
  );

describe("an older Windows app against the updated cloud", () => {
  it("the cloud refuses a push of the previous protocol", async () => {
    expect(SYNC_PROTOCOL).toBeGreaterThanOrEqual(2);
    const p = await linkedPair("proto-owner@example.com");
    const res = await p.web.post(`/sync/push`, { org_id: p.org, device_id: uuidv7(), protocol: 1, aggregates: [] }, 400);
    expect(res.error.message).toContain("به‌روز");
  });

  it("a row without the columns added since keeps their stored values (or takes their defaults)", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    const item = (await s.db.one<Record<string, unknown>>(`select * from sm_items where org_id = $1 and rate_key = 'parsian_500'`, [org]))!;
    const { rate_key: _k, gold_meta: _m, ...old } = item;
    const def = BY_ENTITY.get("item")!;
    await s.db.tx(async (tx) => {
      await tx.query("set local itsm.applying = 'on'");
      await writeAggregate(tx, def, { entity: "item", id: String(item.id), base_rev: 0, row: { ...old, name: "پارسیان نیم گرمی" }, children: {} }, org, "incoming-yields");
      // a new coin from the older app: gold_meta (NOT NULL) takes its default
      const id = uuidv7();
      await writeAggregate(tx, def, { entity: "item", id, base_rev: 0, row: { ...old, id, code: "C900", name: "سکه تازه" }, children: {} }, org, "incoming-yields");
      const fresh = await tx.one<{ rate_key: string | null; gold_meta: unknown }>(`select rate_key, gold_meta from sm_items where id = $1`, [id]);
      expect(fresh).toEqual({ rate_key: null, gold_meta: {} });
    });
    const after = (await s.db.one<Record<string, unknown>>(`select * from sm_items where id = $1`, [item.id]))!;
    expect(after.name).toBe("پارسیان نیم گرمی");
    expect(after.rate_key).toBe("parsian_500");
    expect(after.gold_meta).toEqual(item.gold_meta);
  });

  it("after the update the Windows app reads everything again and retries uploads that failed", async () => {
    const p = await linkedPair("upgrade-owner@example.com");
    const before = await keys(p.cloudDb, p.org);
    expect(before.length).toBeGreaterThan(40);
    // what the previous version left behind: board keys and metadata it did not know, a bar it
    // skipped, a party the cloud refused five times
    const bar = uuidv7();
    await p.cloudDb.query(`insert into sm_gold_bars (id, org_id, bar_no, weight, fineness) values ($1, $2, '900001', 10, 999.9)`, [bar, p.org]);
    await p.client.syncNow();
    await quietly(p.deskDb, `update sm_items set rate_key = null, gold_meta = '{}'::jsonb where org_id = $1`, [p.org]);
    await quietly(p.deskDb, `delete from sm_gold_bars where id = $1`, [bar]);
    const party = (await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری مانده در صف" })).row;
    await p.deskDb.query(`update sm_outbox set attempts = 5, last_error = 'null value in column' where id = $1`, [party.id]);
    // the previous protocol's builds kept neither marker
    await p.deskDb.query(`delete from sm_kv where key in ('sync.schema', 'sync.protocol')`);

    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(await keys(p.deskDb, p.org)).toEqual(before);
    expect(await p.deskDb.one(`select bar_no from sm_gold_bars where id = $1`, [bar])).toEqual({ bar_no: "900001" });
    expect(await p.cloudDb.one(`select 1 as ok from sm_parties where id = $1`, [party.id])).toEqual({ ok: 1 });
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
    const party = (await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری مانده در صف" })).row;
    await p.deskDb.query(`update sm_outbox set attempts = 5, last_error = 'خطا' where id = $1`, [party.id]);
    // a build of the same protocol before `sync.protocol` was kept, one migration behind
    await p.deskDb.query(`delete from sm_kv where key = 'sync.protocol'`);
    await p.deskDb.query(`update sm_kv set value = '"0016_ai_features"'::jsonb where key = 'sync.schema'`);
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(await p.cloudDb.one(`select 1 as ok from sm_parties where id = $1`, [party.id])).toEqual({ ok: 1 });
    expect(urls.filter((u) => u.includes("/sync/pull") && /[?&]cursor=0&/.test(u))).toEqual([]);
    expect((await p.deskDb.one<{ value: string }>(`select value from sm_kv where key = 'sync.schema'`))!.value).toBe(SCHEMA_VERSION);
    expect((await p.deskDb.one<{ value: number }>(`select value from sm_kv where key = 'sync.protocol'`))!.value).toBe(SYNC_PROTOCOL);
  });

  it("a Windows app newer than the web says that the web needs the update and keeps its changes", async () => {
    const p = await linkedPair("old-web-owner@example.com");
    const o = (p.client as unknown as { o: { fetch: typeof fetch } }).o;
    const inner = o.fetch;
    // the web still runs the previous protocol
    o.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("/sync/push")) return Response.json({ error: { message: "نسخه‌ی برنامه‌ی ویندوز با سرور هم‌خوان نیست؛ برنامه را به‌روز کنید" } }, { status: 400 });
      if (url.includes("/sync/status")) return Response.json({ protocol: SYNC_PROTOCOL - 1, head: 0 });
      return inner(u, init);
    }) as typeof fetch;
    const party = (await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری ویندوز" })).row;
    await p.client.syncNow();
    expect(p.client.state.last_error).toContain("نسخه‌ی وب");
    expect(p.client.state.last_error).not.toContain("برنامه را به‌روز کنید");
    expect(await p.deskDb.one(`select 1 as queued from sm_outbox where id = $1`, [party.id])).toEqual({ queued: 1 });
  });
});

describe("migration 0013 on both runtimes", () => {
  it("on a Windows app it queues nothing for upload (the cloud runs it too)", async () => {
    const s = await makeServer({ mode: "desktop" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    await s.db.query(`delete from sm_items where org_id = $1 and rate_key in ('emami_1403', 'parsian_100', 'bar_10')`, [org]);
    await s.db.query(`update sm_items set rate_key = null, gold_meta = '{}'::jsonb where org_id = $1 and rate_key = 'nim'`, [org]);
    await s.db.query(`delete from sm_outbox`);
    await s.db.tx((tx) => tx.exec(goldBullion));
    const back = await s.db.query<{ rate_key: string }>(`select rate_key from sm_items where org_id = $1 and rate_key in ('emami_1403', 'parsian_100', 'bar_10', 'nim')`, [org]);
    expect(back.map((r) => r.rate_key).sort()).toEqual(["bar_10", "emami_1403", "nim", "parsian_100"]);
    expect(await s.db.query(`select entity, id from sm_outbox`)).toEqual([]);
  });

  it("on the cloud its touches get revisions but keep updated_at", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    const nim = (await s.db.one<{ id: string; rev: number }>(`select id, rev from sm_items where org_id = $1 and rate_key = 'nim'`, [org]))!;
    await quietly(s.db, `update sm_items set rate_key = null, gold_meta = '{}'::jsonb, updated_at = '2026-01-01T00:00:00Z' where id = $1`, [nim.id]);
    const mid = (await s.db.one<{ rev: number }>(`select rev from sm_items where id = $1`, [nim.id]))!.rev;
    await s.db.tx((tx) => tx.exec(goldBullion));
    const after = (await s.db.one<{ rate_key: string; rev: number; updated_at: string }>(`select rate_key, rev, updated_at from sm_items where id = $1`, [nim.id]))!;
    expect(after.rate_key).toBe("nim");
    expect(Number(after.rev)).toBeGreaterThan(Number(mid));
    expect(new Date(after.updated_at).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("migration 0017 after an earlier build of 0013", () => {
  it("keeps a doubled board key on the oldest product and makes the key unique", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    // the database as the earlier 0013 left it: a plain index, so a key could be doubled
    await s.db.query(`drop index sm_items_rate_key_uk`);
    await s.db.query(`create index sm_items_rate_key_idx on sm_items (org_id, rate_key) where rate_key is not null and deleted_at is null`);
    const nim = (await s.db.one<{ id: string }>(`select id from sm_items where org_id = $1 and rate_key = 'nim'`, [org]))!;
    const rob = (await s.db.one<{ id: string }>(`select id from sm_items where org_id = $1 and rate_key = 'rob'`, [org]))!;
    // make rob the product created first: it keeps the key although its id sorts later or earlier
    await s.db.query(`update sm_items set created_at = now() - interval '1 day' where id = $1`, [rob.id]);
    const [older, newer] = [rob.id, nim.id];
    await quietly(s.db, `update sm_items set rate_key = 'nim' where id = $1`, [rob.id]);
    const before = (await s.db.one<{ updated_at: string }>(`select updated_at from sm_items where id = $1`, [nim.id]))!.updated_at;
    await s.db.tx((tx) => tx.exec(rateKeyUnique));
    const held = await s.db.query<{ id: string }>(`select id from sm_items where org_id = $1 and rate_key = 'nim' and deleted_at is null`, [org]);
    expect(held.map((r) => r.id)).toEqual([older]);
    const loser = (await s.db.one<{ rate_key: string | null; updated_at: string }>(`select rate_key, updated_at from sm_items where id = $1`, [newer]))!;
    expect(loser.rate_key).toBeNull();
    // a migration's touch keeps updated_at (it must not win last-writer-wins against a real edit)
    expect(new Date(loser.updated_at).toISOString()).toBe(new Date(before).toISOString());
    expect(await s.db.one(`select 1 from pg_indexes where indexname = 'sm_items_rate_key_idx'`)).toBeNull();
    await expect(s.db.query(`update sm_items set rate_key = 'nim' where id = $1`, [newer])).rejects.toThrow();
    // on an up-to-date database it changes nothing
    await s.db.tx((tx) => tx.exec(rateKeyUnique));
    expect((await s.db.query(`select id from sm_items where org_id = $1 and rate_key = 'nim'`, [org])).map((r) => (r as { id: string }).id)).toEqual([older]);
  });
});

describe("clashes brought by coins and bars", () => {
  it("a board key typed on both sides ends on the product edited last, the same on both sides", async () => {
    const p = await linkedPair("key-owner@example.com");
    const ins = (key: string) => `insert into sm_items (id, org_id, code, name, kind, rate_key, gold_weight, fineness) values ($1, $2, $3, 'مدال', 'coin', '${key}', 5, 900)`;
    const pause = () => new Promise((r) => setTimeout(r, 20));
    const holders = (db: Db, key: string) => db.query<{ id: string }>(`select id from sm_items where org_id = $1 and rate_key = $2 and deleted_at is null`, [p.org, key]);

    // offline first, the web later: the web's choice stays, the Windows app's product loses the key
    const offline = uuidv7();
    const web = uuidv7();
    await p.deskDb.query(ins("medal"), [offline, p.org, "C901"]);
    await pause();
    await p.cloudDb.query(ins("medal"), [web, p.org, "C902"]);
    await p.client.syncNow();
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(await holders(p.cloudDb, "medal")).toEqual([{ id: web }]);
    expect(await holders(p.deskDb, "medal")).toEqual([{ id: web }]);
    expect(await p.cloudDb.one(`select rate_key from sm_items where id = $1`, [offline])).toEqual({ rate_key: null });

    // the web first, offline later: the Windows app's choice stays
    const web2 = uuidv7();
    const offline2 = uuidv7();
    await p.cloudDb.query(ins("medal_3"), [web2, p.org, "C905"]);
    await pause();
    await p.deskDb.query(ins("medal_3"), [offline2, p.org, "C906"]);
    await p.client.syncNow();
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(await holders(p.cloudDb, "medal_3")).toEqual([{ id: offline2 }]);
    expect(await holders(p.deskDb, "medal_3")).toEqual([{ id: offline2 }]);
    expect(await p.deskDb.one(`select rate_key from sm_items where id = $1`, [web2])).toEqual({ rate_key: null });

    // pulled and newer: the cloud's product takes the key, the local holder gives it up and is uploaded
    const local = uuidv7();
    await quietly(p.deskDb, `insert into sm_items (id, org_id, code, name, kind, rate_key) values ($1, $2, 'C903', 'سکه محلی', 'coin', 'medal_2')`, [local, p.org]);
    await pause();
    const cloud = uuidv7();
    await p.cloudDb.query(`insert into sm_items (id, org_id, code, name, kind, rate_key) values ($1, $2, 'C904', 'سکه ابری', 'coin', 'medal_2')`, [cloud, p.org]);
    await p.client.pullAll();
    expect(await p.deskDb.one(`select rate_key from sm_items where id = $1`, [cloud])).toEqual({ rate_key: "medal_2" });
    expect(await p.deskDb.one(`select rate_key from sm_items where id = $1`, [local])).toEqual({ rate_key: null });
    expect(await p.deskDb.one(`select 1 as queued from sm_outbox where entity = 'item' and id = $1`, [local])).toEqual({ queued: 1 });

    // pulled but older than a pending local choice: the local holder keeps it, and its upload
    // takes the key from the cloud's product there too
    const cloud4 = uuidv7();
    await p.cloudDb.query(`insert into sm_items (id, org_id, code, name, kind, rate_key) values ($1, $2, 'C907', 'سکه ابری ۲', 'coin', 'medal_4')`, [cloud4, p.org]);
    await pause();
    const local4 = uuidv7();
    await p.deskDb.query(`insert into sm_items (id, org_id, code, name, kind, rate_key) values ($1, $2, 'C908', 'سکه محلی ۲', 'coin', 'medal_4')`, [local4, p.org]);
    await p.client.pullAll();
    expect(await holders(p.deskDb, "medal_4")).toEqual([{ id: local4 }]);
    expect(await p.deskDb.one(`select rate_key from sm_items where id = $1`, [cloud4])).toEqual({ rate_key: null });
    await p.client.syncNow();
    await p.client.syncNow();
    expect(await holders(p.cloudDb, "medal_4")).toEqual([{ id: local4 }]);
    expect(await holders(p.deskDb, "medal_4")).toEqual([{ id: local4 }]);
  });

  it("a bar renumbered by the cloud never takes a deleted bar's number, and its documents follow", async () => {
    const p = await linkedPair("bar-owner@example.com");
    const base = `/o/${p.org}`;
    await p.local.post(`${base}/gold/rates`, { gram18: "50000000", buy_gram18: "49000000", ounce_usd: "2000", usd: "1000000", coins: { emami: "600000000" } });
    const seller = (await p.local.post(`${base}/data/party`, { name: "بنکدار", roles: ["wholesaler"] })).row.id;
    const model = (await p.deskDb.one<{ id: string }>(`select id from sm_items where org_id = $1 and rate_key = 'bar_10'`, [p.org]))!.id;
    const buy = await p.local.post(`${base}/gold/docs`, {
      kind: "purchase", date: "2026-06-05", party_id: seller,
      lines: [{ kind: "bar", item_id: model, weight: "10", fineness: "999.9", bar: { serial_no: "ZX-1", brand: "نمونه" } }],
    });
    const line = buy.doc.lines[0];
    expect(line.bar_no).toBe("900001");
    // meanwhile on the web: a live bar 900001 and a deleted 900002
    await p.cloudDb.query(`insert into sm_gold_bars (id, org_id, bar_no, weight) values ($1, $2, '900001', 5)`, [uuidv7(), p.org]);
    await p.cloudDb.query(`insert into sm_gold_bars (id, org_id, bar_no, weight, deleted_at) values ($1, $2, '900002', 5, now())`, [uuidv7(), p.org]);
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const barId = line.gold_bar_id as string;
    for (const db of [p.cloudDb, p.deskDb]) {
      expect(await db.one(`select bar_no from sm_gold_bars where id = $1`, [barId])).toEqual({ bar_no: "900003" });
      const l = (await db.one<{ tag_no: string; extra: { bar?: { bar_no?: string } } }>(`select tag_no, extra from sm_gold_lines where gold_bar_id = $1`, [barId]))!;
      expect(l.tag_no).toBe("900003");
      if (l.extra.bar?.bar_no) expect(l.extra.bar.bar_no).toBe("900003");
    }
  });
});

describe("a failure after an aggregate is written", () => {
  it("rolls back that aggregate only and leaves the push's transaction usable", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    await s.db.query(`create or replace function sm_test_fail() returns trigger language plpgsql as $$ begin raise exception 'bar lines locked'; end $$`);
    await s.db.query(`create trigger sm_test_fail before update on sm_gold_lines for each statement execute function sm_test_fail()`);
    const def = BY_ENTITY.get("gold_bar")!;
    const bar = uuidv7();
    const other = uuidv7();
    await s.db.tx(async (tx) => {
      await tx.query("set local itsm.applying = 'on'");
      await expect(writeAggregate(tx, def, { entity: "gold_bar", id: bar, base_rev: 0, row: { id: bar, bar_no: "900001", weight: 10 }, children: {} }, org, "incoming-yields")).rejects.toThrow("bar lines locked");
      expect(await tx.one(`select 1 from sm_gold_bars where id = $1`, [bar])).toBeNull();
      // the next aggregate of the same push is applied as usual
      await tx.query(`insert into sm_gold_bars (id, org_id, bar_no, weight) values ($1, $2, '900002', 5)`, [other, org]);
    });
    await s.db.query(`drop trigger sm_test_fail on sm_gold_lines`);
    expect(await s.db.one(`select bar_no from sm_gold_bars where id = $1`, [other])).toEqual({ bar_no: "900002" });
  });
});

describe("a business made read-only by the platform admin", () => {
  it("keeps receiving the cloud's changes while its own uploads are refused", async () => {
    const p = await linkedPair("readonly-owner@example.com");
    const web = (await p.web.post(`/o/${p.org}/data/party`, { name: "مشتری وب" })).row;
    await p.cloudDb.query(`insert into sm_org_admin (org_id, status) values ($1, 'read_only')`, [p.org]);
    const local = (await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری ویندوز" })).row;
    await p.client.syncNow();
    expect(await p.deskDb.one(`select name from sm_parties where id = $1`, [web.id])).toEqual({ name: "مشتری وب" });
    expect(p.client.state.last_error).toContain("فقط‌خواندنی");
    expect(await p.deskDb.one(`select 1 as queued from sm_outbox where id = $1`, [local.id])).toEqual({ queued: 1 });
    expect(await p.cloudDb.one(`select 1 from sm_parties where id = $1`, [local.id])).toBeNull();
  });
});

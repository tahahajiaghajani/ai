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
    await tx.query("set local taraz.applying = 'on'");
    await tx.query(sql, params);
  });
}

const keys = (db: Db, org: string) =>
  db.query<{ id: string; rate_key: string | null; gold_meta: Record<string, unknown> }>(
    `select id, rate_key, gold_meta from tz_items where org_id = $1 and kind in ('coin', 'bar') and deleted_at is null order by id`,
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
    const item = (await s.db.one<Record<string, unknown>>(`select * from tz_items where org_id = $1 and rate_key = 'parsian_500'`, [org]))!;
    const { rate_key: _k, gold_meta: _m, ...old } = item;
    const def = BY_ENTITY.get("item")!;
    await s.db.tx(async (tx) => {
      await tx.query("set local taraz.applying = 'on'");
      await writeAggregate(tx, def, { entity: "item", id: String(item.id), base_rev: 0, row: { ...old, name: "پارسیان نیم گرمی" }, children: {} }, org, "incoming-yields");
      // a new coin from the older app: gold_meta (NOT NULL) takes its default
      const id = uuidv7();
      await writeAggregate(tx, def, { entity: "item", id, base_rev: 0, row: { ...old, id, code: "C900", name: "سکه تازه" }, children: {} }, org, "incoming-yields");
      const fresh = await tx.one<{ rate_key: string | null; gold_meta: unknown }>(`select rate_key, gold_meta from tz_items where id = $1`, [id]);
      expect(fresh).toEqual({ rate_key: null, gold_meta: {} });
    });
    const after = (await s.db.one<Record<string, unknown>>(`select * from tz_items where id = $1`, [item.id]))!;
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
    await p.cloudDb.query(`insert into tz_gold_bars (id, org_id, bar_no, weight, fineness) values ($1, $2, '900001', 10, 999.9)`, [bar, p.org]);
    await p.client.syncNow();
    await quietly(p.deskDb, `update tz_items set rate_key = null, gold_meta = '{}'::jsonb where org_id = $1`, [p.org]);
    await quietly(p.deskDb, `delete from tz_gold_bars where id = $1`, [bar]);
    const party = (await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری مانده در صف" })).row;
    await p.deskDb.query(`update tz_outbox set attempts = 5, last_error = 'null value in column' where id = $1`, [party.id]);
    await p.deskDb.query(`update tz_kv set value = '"0012_sync"'::jsonb where key = 'sync.schema'`);

    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(await keys(p.deskDb, p.org)).toEqual(before);
    expect(await p.deskDb.one(`select bar_no from tz_gold_bars where id = $1`, [bar])).toEqual({ bar_no: "900001" });
    expect(await p.cloudDb.one(`select 1 as ok from tz_parties where id = $1`, [party.id])).toEqual({ ok: 1 });
    expect((await p.deskDb.one<{ value: string }>(`select value from tz_kv where key = 'sync.schema'`))!.value).toBe(SCHEMA_VERSION);
    expect(p.client.state.failed).toEqual([]);
  });
});

describe("migration 0013 on both runtimes", () => {
  it("on a Windows app it queues nothing for upload (the cloud runs it too)", async () => {
    const s = await makeServer({ mode: "desktop" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    await s.db.query(`delete from tz_items where org_id = $1 and rate_key in ('emami_1403', 'parsian_100', 'bar_10')`, [org]);
    await s.db.query(`update tz_items set rate_key = null, gold_meta = '{}'::jsonb where org_id = $1 and rate_key = 'nim'`, [org]);
    await s.db.query(`delete from tz_outbox`);
    await s.db.tx((tx) => tx.exec(goldBullion));
    const back = await s.db.query<{ rate_key: string }>(`select rate_key from tz_items where org_id = $1 and rate_key in ('emami_1403', 'parsian_100', 'bar_10', 'nim')`, [org]);
    expect(back.map((r) => r.rate_key).sort()).toEqual(["bar_10", "emami_1403", "nim", "parsian_100"]);
    expect(await s.db.query(`select entity, id from tz_outbox`)).toEqual([]);
  });

  it("on the cloud its touches get revisions but keep updated_at", async () => {
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c, ["gold"], "gold");
    const nim = (await s.db.one<{ id: string; rev: number }>(`select id, rev from tz_items where org_id = $1 and rate_key = 'nim'`, [org]))!;
    await quietly(s.db, `update tz_items set rate_key = null, gold_meta = '{}'::jsonb, updated_at = '2026-01-01T00:00:00Z' where id = $1`, [nim.id]);
    const mid = (await s.db.one<{ rev: number }>(`select rev from tz_items where id = $1`, [nim.id]))!.rev;
    await s.db.tx((tx) => tx.exec(goldBullion));
    const after = (await s.db.one<{ rate_key: string; rev: number; updated_at: string }>(`select rate_key, rev, updated_at from tz_items where id = $1`, [nim.id]))!;
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
    await s.db.query(`drop index tz_items_rate_key_uk`);
    await s.db.query(`create index tz_items_rate_key_idx on tz_items (org_id, rate_key) where rate_key is not null and deleted_at is null`);
    const nim = (await s.db.one<{ id: string }>(`select id from tz_items where org_id = $1 and rate_key = 'nim'`, [org]))!;
    const rob = (await s.db.one<{ id: string }>(`select id from tz_items where org_id = $1 and rate_key = 'rob'`, [org]))!;
    const [older, newer] = [nim.id, rob.id].sort();
    await s.db.query(`update tz_items set rate_key = 'nim' where id = $1`, [rob.id]);
    await s.db.tx((tx) => tx.exec(rateKeyUnique));
    const held = await s.db.query<{ id: string }>(`select id from tz_items where org_id = $1 and rate_key = 'nim' and deleted_at is null`, [org]);
    expect(held.map((r) => r.id)).toEqual([older]);
    expect((await s.db.one<{ rate_key: string | null }>(`select rate_key from tz_items where id = $1`, [newer]))!.rate_key).toBeNull();
    expect(await s.db.one(`select 1 from pg_indexes where indexname = 'tz_items_rate_key_idx'`)).toBeNull();
    await expect(s.db.query(`update tz_items set rate_key = 'nim' where id = $1`, [newer])).rejects.toThrow();
    // on an up-to-date database it changes nothing
    await s.db.tx((tx) => tx.exec(rateKeyUnique));
    expect((await s.db.query(`select id from tz_items where org_id = $1 and rate_key = 'nim'`, [org])).map((r) => (r as { id: string }).id)).toEqual([older]);
  });
});

describe("clashes brought by coins and bars", () => {
  it("a board key typed on both sides ends on one product, the same on both sides", async () => {
    const p = await linkedPair("key-owner@example.com");
    const ins = `insert into tz_items (id, org_id, code, name, kind, rate_key, gold_weight, fineness) values ($1, $2, $3, 'مدال', 'coin', 'medal', 5, 900)`;
    const mine = uuidv7();
    const theirs = uuidv7();
    await p.deskDb.query(ins, [mine, p.org, "C901"]);
    await p.cloudDb.query(ins, [theirs, p.org, "C902"]);
    await p.client.syncNow();
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const holders = (db: Db) => db.query<{ id: string }>(`select id from tz_items where org_id = $1 and rate_key = 'medal' and deleted_at is null`, [p.org]);
    expect(await holders(p.cloudDb)).toEqual([{ id: mine }]);
    expect(await holders(p.deskDb)).toEqual([{ id: mine }]);
    expect(await p.deskDb.one(`select rate_key from tz_items where id = $1`, [theirs])).toEqual({ rate_key: null });

    // pulled: the cloud's product takes the key, the local holder gives it up and is uploaded
    const local = uuidv7();
    await quietly(p.deskDb, `insert into tz_items (id, org_id, code, name, kind, rate_key) values ($1, $2, 'C903', 'سکه محلی', 'coin', 'medal_2')`, [local, p.org]);
    const cloud = uuidv7();
    await p.cloudDb.query(`insert into tz_items (id, org_id, code, name, kind, rate_key) values ($1, $2, 'C904', 'سکه ابری', 'coin', 'medal_2')`, [cloud, p.org]);
    await p.client.pullAll();
    expect(await p.deskDb.one(`select rate_key from tz_items where id = $1`, [cloud])).toEqual({ rate_key: "medal_2" });
    expect(await p.deskDb.one(`select rate_key from tz_items where id = $1`, [local])).toEqual({ rate_key: null });
    expect(await p.deskDb.one(`select 1 as queued from tz_outbox where entity = 'item' and id = $1`, [local])).toEqual({ queued: 1 });
  });

  it("a bar renumbered by the cloud never takes a deleted bar's number, and its documents follow", async () => {
    const p = await linkedPair("bar-owner@example.com");
    const base = `/o/${p.org}`;
    await p.local.post(`${base}/gold/rates`, { gram18: "50000000", buy_gram18: "49000000", ounce_usd: "2000", usd: "1000000", coins: { emami: "600000000" } });
    const seller = (await p.local.post(`${base}/data/party`, { name: "بنکدار", roles: ["wholesaler"] })).row.id;
    const model = (await p.deskDb.one<{ id: string }>(`select id from tz_items where org_id = $1 and rate_key = 'bar_10'`, [p.org]))!.id;
    const buy = await p.local.post(`${base}/gold/docs`, {
      kind: "purchase", date: "2026-06-05", party_id: seller,
      lines: [{ kind: "bar", item_id: model, weight: "10", fineness: "999.9", bar: { serial_no: "ZX-1", brand: "نمونه" } }],
    });
    const line = buy.doc.lines[0];
    expect(line.bar_no).toBe("900001");
    // meanwhile on the web: a live bar 900001 and a deleted 900002
    await p.cloudDb.query(`insert into tz_gold_bars (id, org_id, bar_no, weight) values ($1, $2, '900001', 5)`, [uuidv7(), p.org]);
    await p.cloudDb.query(`insert into tz_gold_bars (id, org_id, bar_no, weight, deleted_at) values ($1, $2, '900002', 5, now())`, [uuidv7(), p.org]);
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    const barId = line.gold_bar_id as string;
    for (const db of [p.cloudDb, p.deskDb]) {
      expect(await db.one(`select bar_no from tz_gold_bars where id = $1`, [barId])).toEqual({ bar_no: "900003" });
      const l = (await db.one<{ tag_no: string; extra: { bar?: { bar_no?: string } } }>(`select tag_no, extra from tz_gold_lines where gold_bar_id = $1`, [barId]))!;
      expect(l.tag_no).toBe("900003");
      if (l.extra.bar?.bar_no) expect(l.extra.bar.bar_no).toBe("900003");
    }
  });
});

describe("a business made read-only by the platform admin", () => {
  it("keeps receiving the cloud's changes while its own uploads are refused", async () => {
    const p = await linkedPair("readonly-owner@example.com");
    const web = (await p.web.post(`/o/${p.org}/data/party`, { name: "مشتری وب" })).row;
    await p.cloudDb.query(`insert into tz_org_admin (org_id, status) values ($1, 'read_only')`, [p.org]);
    const local = (await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری ویندوز" })).row;
    await p.client.syncNow();
    expect(await p.deskDb.one(`select name from tz_parties where id = $1`, [web.id])).toEqual({ name: "مشتری وب" });
    expect(p.client.state.last_error).toContain("فقط‌خواندنی");
    expect(await p.deskDb.one(`select 1 as queued from tz_outbox where id = $1`, [local.id])).toEqual({ queued: 1 });
    expect(await p.cloudDb.one(`select 1 from tz_parties where id = $1`, [local.id])).toBeNull();
  });
});

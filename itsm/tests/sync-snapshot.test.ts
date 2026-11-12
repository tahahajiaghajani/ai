// The snapshot arithmetic of transaction-id sync revisions (src/server/sync/snapshot.ts): cursors parse strictly, the
// SQL window equals «visible in the newer look and not in the older one» row for row, keyset positions order as
// PostgreSQL orders (rev, uuid), and PGlite (the Windows app's database) has every function the protocol uses.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { afterSql, compareKey, deltaSql, parseAfter, parseSnap, snapText, visibleIn, type Snap } from "@server/sync/snapshot";
import { uuidv7 } from "@shared/id";

let pg: PGlite;
beforeAll(async () => {
  pg = await PGlite.create();
});
afterAll(async () => {
  await pg?.close();
});

describe("snapshot cursors", () => {
  it("parse PostgreSQL's text form and nothing else", () => {
    expect(parseSnap("10:20:12,15")).toEqual({ xmin: 10, xmax: 20, xip: [12, 15] });
    expect(parseSnap("10:10:")).toEqual({ xmin: 10, xmax: 10, xip: [] });
    expect(snapText(parseSnap("10:20:15,12,12")!)).toBe("10:20:12,15");
    for (const bad of ["", "10:20", "20:10:", "10:20:9", "10:20:20", "a:b:", "10:20:12;drop", "1".repeat(20) + ":1:", null, 7]) {
      expect(parseSnap(bad as never)).toBeNull();
    }
    expect(parseAfter("12:0190d2c4-1b2c-7d3e-8f40-123456789abc")).toEqual({ rev: 12, id: "0190d2c4-1b2c-7d3e-8f40-123456789abc" });
    expect(parseAfter("12:not-a-uuid")).toBeNull();
  });

  it("visibility: committed before the look, not in progress at it", () => {
    const s: Snap = { xmin: 100, xmax: 110, xip: [100, 104] };
    expect([99, 100, 101, 104, 109, 110, 120].map((x) => visibleIn(x, s))).toEqual([true, false, true, false, true, false, false]);
  });

  it("the SQL window is exactly «visible now, not visible at the last look», and PGlite has the functions", async () => {
    const got = await pg.query<{ s: string; x: string }>(`select pg_current_snapshot()::text as s, pg_current_xact_id()::text as x`);
    expect(parseSnap(got.rows[0].s)).not.toBeNull();
    expect(Number(got.rows[0].x)).toBeGreaterThan(0);
    const revs = Array.from({ length: 80 }, (_, i) => 90 + i);
    const looks: [Snap | null, Snap][] = [
      [null, { xmin: 120, xmax: 130, xip: [120, 125] }],
      [{ xmin: 100, xmax: 110, xip: [100, 104] }, { xmin: 120, xmax: 130, xip: [120, 125] }],
      [{ xmin: 100, xmax: 110, xip: [] }, { xmin: 110, xmax: 110, xip: [] }],
      [{ xmin: 95, xmax: 140, xip: [95, 101, 133] }, { xmin: 101, xmax: 150, xip: [101, 145] }],
    ];
    for (const [since, upto] of looks) {
      const params: unknown[] = [];
      const where = deltaSql("t", since, upto, params);
      const sql = `select t.rev::bigint as rev from unnest('{${revs.join(",")}}'::bigint[]) as t(rev) where ${where} order by 1`;
      const rows = (await pg.query<{ rev: number }>(sql, params.map(String))).rows.map((r) => Number(r.rev));
      const want = revs.filter((r) => visibleIn(r, upto) && !(since && visibleIn(r, since)));
      expect(rows).toEqual(want);
    }
  });

  it("keyset positions order as PostgreSQL orders (rev, uuid), and the next page starts right after the last row", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ rev: 1000 + (i % 4), id: uuidv7() }));
    // uuids of mixed case and leading digits/letters
    rows.push({ rev: 1001, id: "ffffffff-0000-4000-8000-000000000000" }, { rev: 1001, id: "00000000-0000-4000-8000-000000000000" });
    const values = rows.map((r) => `(${r.rev}, '${r.id}'::uuid)`).join(",");
    const ordered = (await pg.query<{ rev: number; id: string }>(`select rev, id::text as id from (values ${values}) as t(rev, id) order by rev, id`)).rows.map((r) => ({ rev: Number(r.rev), id: r.id }));
    expect([...rows].sort(compareKey)).toEqual(ordered);
    const at = ordered[25];
    const params: unknown[] = [];
    const where = afterSql("t", at, params);
    const rest = (await pg.query<{ rev: number; id: string }>(`select rev, id::text as id from (values ${values}) as t(rev, id) where ${where} order by rev, id`, params.map(String))).rows;
    expect(rest.map((r) => ({ rev: Number(r.rev), id: r.id }))).toEqual(ordered.slice(26));
  });
});

describe("the move to transaction-id revisions (migration 0100)", () => {
  it("stamps counter revisions that ran ahead of the transaction ids, so a full pull still sees those rows", async () => {
    const { makeServer, Client, signupWithOrg } = await import("./helpers");
    await import("./fixtures/module");
    const { default: migration } = await import("@server/db/migrations/0100_xid_revisions");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    const item = (await c.post(`/o/${org}/data/test_item`, { name: "پیش از ارتقا" })).row;
    // an import under the old counter: the revision is far ahead of the transaction ids
    await s.db.tx(async (tx) => {
      await tx.query(`set local session_replication_role = replica`);
      await tx.query(`update sm_test_items set rev = 999999999 where id = $1`, [item.id]);
    });
    // counter values kept outside the synced rows: a Windows app's cursor, the purge mark of a demo pack whose tombstones
    // wait for the apps (a 1.1.0-beta server)
    const owner = (await s.db.one<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1`, [org]))!.user_id;
    const device = (await s.db.one<{ id: string }>(`insert into sm_devices (org_id, user_id, name, cursor, last_pull_at) values ($1, $2, 'بتا', 777, now()) returning id`, [org, owner]))!.id;
    await s.db.query(`insert into sm_demo_packs (org_id, state, purge_mark) values ($1, 'tombstoned', 888)`, [org]);
    const ahead = await c.get(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}`);
    expect(ahead.aggregates.some((a: { id: string }) => a.id === item.id)).toBe(false);
    // the update of a 1.1.0-beta database: the migration has not run there yet
    await s.db.query(`delete from sm_migrations where id = '0100_xid_revisions'`);
    await s.db.exec(migration);
    const rev = Number((await s.db.one<{ rev: number }>(`select rev from sm_test_items where id = $1`, [item.id]))!.rev);
    expect(rev).toBeLessThan(999999999);
    const page = await c.get(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}`);
    expect(page.aggregates.find((a: { id: string }) => a.id === item.id)?.row.name).toBe("پیش از ارتقا");
    // the device reads everything again (cursor 0) and the pack waits for that read: past the migration's transaction
    expect(Number((await s.db.one<{ cursor: number }>(`select cursor from sm_devices where id = $1`, [device]))!.cursor)).toBe(0);
    expect(Number((await s.db.one<{ purge_mark: number }>(`select purge_mark from sm_demo_packs where org_id = $1`, [org]))!.purge_mark)).toBe(rev + 1);
    // supabase/schema.sql run again on that live database (every migration once more): the cursors that moved since stay
    await s.db.query(`insert into sm_migrations (id) values ('0100_xid_revisions') on conflict do nothing`);
    await s.db.query(`update sm_devices set cursor = 4242 where id = $1`, [device]);
    await s.db.exec(migration);
    expect(Number((await s.db.one<{ cursor: number }>(`select cursor from sm_devices where id = $1`, [device]))!.cursor)).toBe(4242);
    expect(Number((await s.db.one<{ purge_mark: number }>(`select purge_mark from sm_demo_packs where org_id = $1`, [org]))!.purge_mark)).toBe(rev + 1);
    await s.db.close();
  }, 120_000);
});

describe("a database restored into another cluster (RESTAMP_SQL: karizctl restore, the startup's transaction-id check)", () => {
  it("stamps rows ahead of the ids and starts cursors, demo marks, the purge watermark and the mark again — not on a Windows app's database nor before 0100", async () => {
    const { makeServer, Client, signupWithOrg } = await import("./helpers");
    await import("./fixtures/module");
    const { BUMP_ALL_EPOCHS_SQL, RESTAMP_SQL } = await import("@server/sync/snapshot");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    const item = (await c.post(`/o/${org}/data/test_item`, { name: "پیش از بازگردانی" })).row;
    const owner = (await s.db.one<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1`, [org]))!.user_id;
    const device = (await s.db.one<{ id: string }>(`insert into sm_devices (org_id, user_id, name, last_pull_at) values ($1, $2, 'بازگردانی', now()) returning id`, [org, owner]))!.id;
    await s.db.query(`insert into sm_demo_packs (org_id, state) values ($1, 'tombstoned')`, [org]);
    // as pg_restore leaves a dump of a cluster whose ids were far ahead (data before triggers)
    await s.db.tx(async (tx) => {
      await tx.query(`set local session_replication_role = replica`);
      await tx.query(`update sm_test_items set rev = 999999999 where id = $1`, [item.id]);
      await tx.query(`update sm_devices set cursor = 999999990 where id = $1`, [device]);
      await tx.query(`update sm_demo_packs set purge_mark = 999999991 where org_id = $1`, [org]);
      await tx.query(`insert into sm_org_sync (org_id, rev, purged) values ($1, 0, 999999992) on conflict (org_id) do update set purged = excluded.purged`, [org]);
      await tx.query(`insert into sm_meta (key, value) values ('sync.xid_high', '999999993') on conflict (key) do update set value = excluded.value`);
    });
    const state = async () => {
      const n = async (sql: string, params: unknown[] = []) => Number(Object.values((await s.db.one<Record<string, unknown>>(sql, params)) ?? { v: 0 })[0]);
      return {
        rev: await n(`select rev from sm_test_items where id = $1`, [item.id]),
        cursor: await n(`select cursor from sm_devices where id = $1`, [device]),
        purge_mark: await n(`select purge_mark from sm_demo_packs where org_id = $1`, [org]),
        purged: await n(`select purged from sm_org_sync where org_id = $1`, [org]),
        mark: await n(`select value from sm_meta where key = 'sync.xid_high'`),
      };
    };
    const ahead = { rev: 999999999, cursor: 999999990, purge_mark: 999999991, purged: 999999992, mark: 999999993 };
    expect(await state()).toEqual(ahead);
    // a Windows app's database: its revisions are the server's, opaque to it
    await s.db.exec(`set itsm.mode = 'desktop'`);
    try {
      await s.db.exec(RESTAMP_SQL);
    } finally {
      await s.db.exec(`reset itsm.mode`);
    }
    expect(await state()).toEqual(ahead);
    // a backup from before transaction-id revisions (1.0, 1.1.0-beta — 1.0 has no demo tables): its migration 0100 does it
    await s.db.query(`delete from sm_migrations where id = '0100_xid_revisions'`);
    await s.db.exec(BUMP_ALL_EPOCHS_SQL);
    expect(await state()).toEqual(ahead);
    await s.db.query(`insert into sm_migrations (id) values ('0100_xid_revisions')`);
    // a database of this version: everything ahead takes the restoring transaction's id (the row's timestamps stay)
    const before = (await s.db.one<{ epoch: number }>(`select epoch from sm_org_sync where org_id = $1`, [org]))!.epoch;
    const at = (await s.db.one<{ t: string }>(`select updated_at::text as t from sm_test_items where id = $1`, [item.id]))!.t;
    await s.db.exec(BUMP_ALL_EPOCHS_SQL);
    const now = await state();
    expect(now.rev).toBeLessThan(999999999);
    expect(now).toEqual({ rev: now.rev, cursor: 0, purge_mark: now.rev + 1, purged: now.rev, mark: now.rev });
    expect(Number((await s.db.one<{ epoch: number }>(`select epoch from sm_org_sync where org_id = $1`, [org]))!.epoch)).toBeGreaterThan(Number(before));
    expect((await s.db.one<{ t: string }>(`select updated_at::text as t from sm_test_items where id = $1`, [item.id]))!.t).toBe(at);
    // a full pull brings the row again (its revision is visible), and a pull from that cursor keeps it (the watermark is seen)
    const session = async (since = "", epoch = "") => {
      const rows = new Map<string, Record<string, unknown>>();
      let snap = "";
      let after = "";
      for (;;) {
        const qs = new URLSearchParams({ org_id: org, protocol: String(SYNC_PROTOCOL) });
        if (since) qs.set("since", since);
        if (snap) qs.set("snap", snap);
        if (after) qs.set("after", after);
        if (epoch) qs.set("epoch", epoch);
        const page = await c.get(`/sync/pull?${qs.toString()}`);
        if (page.reset) return { reset: true, rows, cursor: "", epoch: String(page.epoch) };
        for (const a of page.aggregates as { id: string; row: Record<string, unknown> }[]) rows.set(a.id, a.row);
        epoch = String(page.epoch);
        if (!page.has_more) return { reset: false, rows, cursor: String(page.cursor), epoch };
        snap = String(page.snap);
        after = String(page.after);
      }
    };
    const full = await session();
    expect(full.rows.get(item.id)?.name).toBe("پیش از بازگردانی");
    const next = await session(full.cursor, full.epoch);
    expect(next.reset).toBe(false);
    await s.db.close();
  }, 120_000);
});

describe("Windows apps of an older sync protocol (SYNC_PROTOCOL 16)", () => {
  it("are told to update — on pull and on push, with any cursor — and are never served a page", async () => {
    const { makeServer, Client, signupWithOrg } = await import("./helpers");
    const { SYNC_PROTOCOL } = await import("@shared/constants");
    const { uuidv7 } = await import("@shared/id");
    expect(SYNC_PROTOCOL).toBe(16);
    const s = await makeServer({ mode: "cloud" });
    const c = new Client(s.app);
    const org = await signupWithOrg(c);
    const update = (r: { error: { message: string } }) => expect(r.error.message).toContain("برنامه را به‌روز کنید");
    // 1.0 (protocol 14) and 1.1.0-beta (protocol 15) send no protocol with a pull, and numeric cursors — also 0 (a new
    // link, or after a reset), where a page from nothing would otherwise be read with the old format
    for (const q of ["cursor=120&user_cursor=0", "cursor=0&user_cursor=0", "cursor=0&user_cursor=0&epoch=1731000000000&device_id=" + uuidv7(), ""]) {
      update(await c.req("GET", `/sync/pull?org_id=${org}${q ? `&${q}` : ""}`, undefined, 400));
    }
    // a protocol named, but not this one
    for (const p of [SYNC_PROTOCOL - 1, SYNC_PROTOCOL + 1]) update(await c.req("GET", `/sync/pull?org_id=${org}&protocol=${p}`, undefined, 400));
    // a 1.1.0-beta app's push
    update(await c.req("POST", `/sync/push`, { org_id: org, device_id: uuidv7(), protocol: 15, aggregates: [] }, 400));
    // this protocol is served
    const page = await c.get(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}`);
    expect(typeof page.snap).toBe("string");
    expect(page.full).toBe(true);
    await s.db.close();
  }, 120_000);
});

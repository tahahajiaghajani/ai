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

describe("the move to transaction-id revisions (migration 0096)", () => {
  it("stamps counter revisions that ran ahead of the transaction ids, so a full pull still sees those rows", async () => {
    const { makeServer, Client, signupWithOrg } = await import("./helpers");
    await import("./fixtures/module");
    const { default: migration } = await import("@server/db/migrations/0096_xid_revisions");
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
    const ahead = await c.get(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}`);
    expect(ahead.aggregates.some((a: { id: string }) => a.id === item.id)).toBe(false);
    await s.db.exec(migration);
    const rev = Number((await s.db.one<{ rev: number }>(`select rev from sm_test_items where id = $1`, [item.id]))!.rev);
    expect(rev).toBeLessThan(999999999);
    const page = await c.get(`/sync/pull?org_id=${org}&protocol=${SYNC_PROTOCOL}`);
    expect(page.aggregates.find((a: { id: string }) => a.id === item.id)?.row.name).toBe("پیش از ارتقا");
    // a Windows app of protocol 14 (numeric cursors) is told to update
    const old = await c.req("GET", `/sync/pull?org_id=${org}&cursor=120&user_cursor=0`, undefined, 400);
    expect(old.error.message).toContain("به‌روز");
    await s.db.close();
  }, 120_000);
});

// The demo purge's access bumps in bulk on a real PostgreSQL (migration 0105_demo_purge_sync, modules/demo/access-bulk.ts;
// docs/DEMO_FA.md «برنامهٔ ویندوزِ پیوسته»): inside a purge transaction the per-row triggers of groups, units,
// workspaces and roles only mark the transaction, and one bump of the access version and of every member's scope epoch
// follows just before it commits — on a pooled connection, where the transaction-local setting must not outlive it.
// (tests/demo-sync.test.ts runs the purge itself on PGlite.) Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts).
// Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/demo-access-bulk-pg.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import { pgArray, type Db } from "@server/db";
import { createIn, systemCtx } from "@server/engine";
import { purgeDb } from "@server/modules/demo/access-bulk";
import { uuidv7 } from "@shared/id";
import { useServerDb } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";

let pg: RealPg;
const pools: Db[] = [];

describe.skipIf(!realPgAvailable())("the demo purge's access bumps on a real PostgreSQL", () => {
  let e: EngineOrg;

  beforeAll(async () => {
    pg = await realPg("accessbulk");
    useServerDb(async () => {
      const db = createPostgresDb({ url: await extraDatabase(pg, `accessbulk_${process.pid}`), ssl: false, max: 6 });
      pools.push(db);
      return db;
    });
    e = await engineOrg();
    for (let i = 0; i < 3; i++) await e.member("member");
  }, 180_000);

  afterAll(async () => {
    useServerDb(null);
    await Promise.all(pools.splice(0).map((db) => db.close().catch(() => undefined)));
    await pg?.stop();
  }, 120_000);

  it("five groups removed in one purge transaction move the version and every member's epoch once; elsewhere once per group", async () => {
    const sys = await systemCtx(e.cfg, e.org);
    const groups = async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(String((await sys.write((tx) => createIn(tx, sys, "group", { name: `گروه ${uuidv7()}` }, { trusted: true }))).id));
      return ids;
    };
    const state = async () => ({
      version: Number((await e.db.one<{ v: string }>(`select version::text as v from sm_access_state where org_id = $1`, [e.org]))?.v ?? 0),
      epochs: new Map((await e.db.query<{ u: string; n: string }>(`select user_id::text as u, epoch::text as n from sm_scope_epochs where org_id = $1`, [e.org])).map((r) => [r.u, Number(r.n)])),
    });
    const moved = (a: Awaited<ReturnType<typeof state>>, b: Awaited<ReturnType<typeof state>>) => ({
      version: b.version - a.version,
      epochs: [...b.epochs].map(([u, n]) => n - (a.epochs.get(u) ?? 0)),
    });
    const members = (await e.db.one<{ n: number }>(`select count(*)::int as n from sm_org_members where org_id = $1 and deleted_at is null`, [e.org]))!.n;
    expect(members).toBe(4);
    const remove = (db: Db, ids: string[]) => db.tx((tx) => tx.query(`delete from sm_groups where org_id = $1 and id = any($2::uuid[])`, [e.org, pgArray(ids)]));

    // an ordinary transaction: every group bumps both
    let ids = await groups();
    let before = await state();
    await remove(e.db, ids);
    expect(moved(before, await state())).toEqual({ version: 5, epochs: Array(members).fill(5) });

    // the purge's transaction: once
    ids = await groups();
    before = await state();
    await remove(purgeDb(e.db, e.org), ids);
    expect(moved(before, await state())).toEqual({ version: 1, epochs: Array(members).fill(1) });

    // a purge transaction that touches no access table moves nothing; the tombstones' removal moves the version only
    before = await state();
    await purgeDb(e.db, e.org).tx((tx) => tx.query(`select 1`));
    expect(moved(before, await state())).toEqual({ version: 0, epochs: Array(members).fill(0) });
    ids = await groups();
    before = await state();
    await remove(purgeDb(e.db, e.org, { epochs: false }), ids);
    expect(moved(before, await state())).toEqual({ version: 1, epochs: Array(members).fill(0) });

    // the setting does not outlive its transaction on the pool's connections: later ordinary writes, one group at a
    // time, bump as before
    ids = await groups();
    before = await state();
    for (const id of ids) await remove(e.db, [id]);
    expect(moved(before, await state())).toEqual({ version: 5, epochs: Array(members).fill(5) });
  }, 180_000);
});

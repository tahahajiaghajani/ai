// F3 — holders of organisational roles placed side by side, on a real PostgreSQL: one row per position, person and unit
// holds even for a position held without a unit, which the database's unique index cannot see (NULLs are distinct).
// Two writers placing the same person in the same position (an administrator and a directory sign-in, two imports)
// take turns on a key lock, so the second one's check sees the first one's row. The test holds the first write open
// (created, not committed) while the second runs, and checks the state a serial order gives. Skipped unless
// ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/positions-races-pg.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createPostgresDb } from "@server/db/postgres";
import type { Db, Tx } from "@server/db";
import { createIn, systemCtx } from "@server/engine";
import type { Ctx } from "@server/context";
import { uuidv7 } from "@shared/id";
import { useServerDb } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "./pg-real";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gates: (() => void)[] = [];

/** Hold a transaction open after `work` (its locks and uncommitted rows with it) until `release()`. */
function hold(db: Db, work: (tx: Tx) => Promise<unknown>) {
  let inside!: () => void;
  let open!: () => void;
  const ready = new Promise<void>((r) => (inside = r));
  const gate = new Promise<void>((r) => (open = r));
  gates.push(open);
  const done = db.tx(async (tx) => {
    await work(tx);
    inside();
    await gate;
  });
  done.catch(() => inside());
  return { ready, release: open, done };
}

/** Wait until a session of this database waits for a lock, the racer settled, or a few seconds passed. */
async function queued(db: Db, settled: Promise<unknown>, ms = 4000): Promise<void> {
  let done = false;
  settled.then(() => (done = true), () => (done = true));
  const until = Date.now() + ms;
  while (!done && Date.now() < until) {
    const w = await db.one<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
    if ((w?.n ?? 0) >= 1) return;
    await sleep(25);
  }
}

let pg: RealPg;
let seq = 0;
const pools: Db[] = [];

describe.skipIf(!realPgAvailable())("organisational roles side by side (real PostgreSQL)", () => {
  let e: EngineOrg;
  let sys: Ctx;
  let officer: string;
  let person: string;

  beforeAll(async () => {
    pg = await realPg("positions");
    useServerDb(async () => {
      const url = await extraDatabase(pg, `positions_${process.pid}_${++seq}`);
      const db = createPostgresDb({ url, ssl: false, max: 6 });
      pools.push(db);
      return db;
    });
    e = await engineOrg();
    sys = await systemCtx(e.cfg, e.org);
    officer = String((await sys.write((tx) => createIn(tx, sys, "position", { key: "credit_officer", name: "کارشناس اعتبارات" }, { trusted: true }))).id);
    person = (await e.member("member")).userId;
  }, 180_000);

  afterEach(() => {
    for (const release of gates.splice(0)) release();
  });

  afterAll(async () => {
    useServerDb(null);
    await Promise.all(pools.splice(0).map((db) => Promise.race([db.close().catch(() => undefined), sleep(15_000)])));
    await pg?.stop();
  }, 120_000);

  it("two writers placing the same person in a position held without a unit: one row, the second refused", async () => {
    const holder = { position_id: officer, user_id: person, kind: "primary" };
    // an administrator's write is in flight (row created, not committed) when a directory sign-in places the same holder
    const first = hold(e.db, (tx) => createIn(tx, sys, "position_holder", holder, { trusted: true }));
    await first.ready;
    const second = e.db.tx((tx) => createIn(tx, sys, "position_holder", { ...holder, source: "directory", source_ref: uuidv7() }, { trusted: true }));
    second.catch(() => undefined);
    await queued(e.db, second);
    first.release();
    await first.done;
    const [out] = await Promise.allSettled([second]);
    expect(out.status).toBe("rejected");
    expect(String((out as PromiseRejectedResult).reason?.message)).toMatch(/همین حالا «کارشناس اعتبارات» است$/);
    const rows = await e.db.query(`select source from sm_position_holders where org_id = $1 and position_id = $2 and user_id = $3 and deleted_at is null`, [e.org, officer, person]);
    expect(rows).toEqual([{ source: "manual" }]);
  }, 120_000);
});

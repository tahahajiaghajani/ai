// Migration in steps (src/server/db/migrate.ts): each step fits a serverless request, resumes where the last one
// stopped, is recorded with its own work, and a step cut short leaves nothing behind — the web version's start-up
// (docs/SETUP_FA.md §۹). With ITSM_TEST_PG_URL (a PostgreSQL superuser URL), the lock between instances is checked on
// a real server too.
import { describe, it, expect } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import { createPostgresDb } from "@server/db/postgres";
import { MIGRATION_LOCK, migrate, migrateSteps, schemaProgress } from "@server/db/migrate";
import { engineChunks } from "@server/engine/ddl";
import { schemaIsCurrent } from "@server/db/schema-check";
import type { Db, Tx } from "@server/db";

/** A database whose transactions fail right after running the statement that matches `when` (a function killed mid-step). */
function cutting(db: Db, when: (sql: string) => boolean): Db {
  return {
    ...db,
    tx: <T>(fn: (tx: Tx) => Promise<T>) =>
      db.tx((tx) =>
        fn({
          ...tx,
          inTx: true,
          exec: async (sql: string) => {
            await tx.exec(sql);
            if (when(sql)) throw new Error("killed: the function reached its time limit");
          },
        }),
      ),
  };
}

describe("migration in resumable steps", () => {
  it("advances a step or more per call within a time budget and never runs a step twice", async () => {
    const db = await createPgliteDb({});
    const first = await schemaProgress(db);
    expect(first.complete).toBe(false);
    expect(first.done).toBe(0);
    const seen: string[] = [];
    let last = 0;
    let calls = 0;
    for (;;) {
      const r = await migrateSteps(db, { budgetMs: 1, wait: false });
      calls++;
      expect(r.ran.length).toBeGreaterThanOrEqual(1); // a budget smaller than a step still runs one step
      expect(r.done).toBeGreaterThan(last);
      last = r.done;
      seen.push(...r.ran);
      if (r.complete) break;
      expect(calls).toBeLessThan(200);
    }
    expect(new Set(seen).size).toBe(seen.length);
    // a fresh database never needs the reconcile: the engine DDL recorded its version when its chunks completed
    expect(seen.filter((id) => id.startsWith("reconcile:"))).toEqual([]);
    expect(seen.filter((id) => id.startsWith("engine:"))).toHaveLength(engineChunks().chunks.length);
    expect(calls).toBeGreaterThan(engineChunks().chunks.length);
    expect(await schemaIsCurrent(db)).toBe(true);
    expect(await migrate(db)).toEqual([]);
    await db.close();
  }, 300_000);

  it("rolls a step cut short back completely, and the next run does exactly that step", async () => {
    const db = await createPgliteDb({});
    const { chunks } = engineChunks();
    const victim = chunks[3];
    const table = victim.tables[0];
    await expect(migrate(cutting(db, (sql) => sql === victim.sql))).rejects.toThrow(/killed/);
    // nothing of the step: neither its tables nor its record
    expect(await db.one(`select to_regclass($1) as t`, [table])).toEqual({ t: null });
    const p = await schemaProgress(db);
    expect(p.complete).toBe(false);
    const r = await migrateSteps(db, { budgetMs: 1, wait: false });
    expect(r.ran).toEqual([`engine:${victim.index}`]);
    expect((await db.one<{ t: string | null }>(`select to_regclass($1)::text as t`, [table]))?.t).toBe(table);
    await migrate(db);
    expect(await schemaIsCurrent(db)).toBe(true);
    await db.close();
  }, 300_000);

  it("brings a database built by the previous version (one engine DDL step) up to date through the reconcile only", async () => {
    const db = await createPgliteDb({});
    await migrate(db);
    // an older engine DDL version stored, as after the previous release
    await db.query(`update sm_meta set value = 'previous' where key = 'engine.ddl'`);
    await db.query(`delete from sm_meta where key like 'engine.ddl.seen:%'`);
    expect(await schemaIsCurrent(db)).toBe(false);
    const r = await migrateSteps(db, {});
    expect(r.complete).toBe(true);
    expect(r.ran.every((id) => id.startsWith("reconcile:"))).toBe(true);
    expect(r.ran).toHaveLength(engineChunks().chunks.length);
    expect(r.migrations).toEqual([]);
    await db.close();
  }, 300_000);

  it.skipIf(!process.env.ITSM_TEST_PG_URL)("lets one instance run a step at a time: another one is told it is busy, not queued", async () => {
    const admin = createPostgresDb({ url: process.env.ITSM_TEST_PG_URL!, ssl: false, max: 1 });
    const name = `itsm_steps_${Date.now()}`;
    await admin.exec(`create database ${name}`);
    const url = process.env.ITSM_TEST_PG_URL!.replace(/\/[^/]*$/, `/${name}`);
    const a = createPostgresDb({ url, ssl: false, max: 1 });
    const b = createPostgresDb({ url, ssl: false, max: 1 });
    try {
      // instance A holds the lock (inside one of its steps)
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const holding = a.tx(async (tx) => {
        await tx.query(`select pg_advisory_xact_lock(${MIGRATION_LOCK})`);
        await held;
      });
      await new Promise((r) => setTimeout(r, 200));
      const t = Date.now();
      const r = await migrateSteps(b, { budgetMs: 10_000, wait: false });
      expect(r.busy).toBe(true);
      expect(r.ran).toEqual([]);
      expect(Date.now() - t).toBeLessThan(5_000);
      release();
      await holding;
      const done = await migrateSteps(b, { wait: false });
      expect(done.complete).toBe(true);
      expect(await schemaIsCurrent(b)).toBe(true);
    } finally {
      await a.close();
      await b.close();
      await admin.exec(`drop database if exists ${name} with (force)`).catch(() => undefined);
      await admin.close();
    }
  }, 300_000);
});

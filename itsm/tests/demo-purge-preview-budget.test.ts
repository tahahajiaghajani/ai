// The purge's preview holds its dry run's transaction for a bounded time (Kariz 1.1.5 review,
// purge-editions-preview-write-tx). GET /demo/report runs the purge's plan in one transaction it rolls back: it puts
// back the real rows demo work changed (row locks until the end), registers what derives from the pack, cleans and
// routes in dry mode. Only the expansion and the later steps watched a 25 s budget; the revert, the trail, the plan and
// the names ran on, so a busy preview held those rows — and, on the standalone Windows app, PGlite's one connection —
// for 25 s and more: on the web a person saving one of them waited into the 10 s lock timeout and got 503 db_locked.
// Now every part of the dry run stops at one budget below the web's lock timeout (`PREVIEW_MS`) and the report says it
// is partial; the counts of what goes are always there. The database here answers every statement of the dry run
// 50 ms late (a busy pool), so the plan cannot finish in the budget.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPgliteDb } from "@server/db/pglite";
import type { Db, Tx } from "@server/db";
import { WEB_TX_LIMITS } from "@server/cloud";
import * as demo from "@server/modules/demo";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { useServerDb } from "./helpers";
import { engineOrg, type EngineOrg } from "./engine-helpers";

/** While `on`, every statement inside a transaction answers `ms` late. */
const slow = { on: false, ms: 50, statements: 0 };
function slowTx(db: Db): Db {
  const late = <T>(run: () => Promise<T>) => (slow.on ? (slow.statements++, new Promise<void>((r) => setTimeout(r, slow.ms)).then(run)) : run());
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "tx")
        return <T>(fn: (tx: Tx) => Promise<T>) =>
          target.tx((tx) =>
            fn(
              new Proxy(tx, {
                get(t, p) {
                  const v = Reflect.get(t, p);
                  if (p === "query" || p === "one" || p === "exec") return (...a: unknown[]) => late(() => (v as (...x: unknown[]) => Promise<unknown>).apply(t, a));
                  return typeof v === "function" ? v.bind(t) : v;
                },
              }) as Tx,
            ),
          );
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as Db;
}

let e: EngineOrg;
beforeAll(async () => {
  useServerDb(async (mode) => slowTx(await createPgliteDb({ desktop: mode === "desktop" })));
  e = await engineOrg();
  useServerDb(null);
  const sys = await systemCtx(e.cfg, e.org);
  await e.db.query(
    `insert into sm_demo_packs (org_id, state, size, progress, counters, started_by) values ($1, 'loaded', 'small', jsonb_build_object('saved_at', now(), 'computed', '[]'::jsonb, 'seeds_done', true, 'saved', true), '{}'::jsonb, $2)`,
    [e.org, e.ownerId],
  );
  // a little of the pack, and a real row demo work changed (the dry run puts it back, holding its row)
  const g = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "group", { name: "میز خدمت نمایشی" }, { trusted: true })));
  const todo = await sys.write((tx) => createIn(tx, sys, "todo", { short_description: "کار واقعی" }, { trusted: true }));
  await inDemoScope(e.org, () => sys.write((tx) => tx.query(`update sm_todos set short_description = 'کار واقعی (تغییر نمایشی)', updated_at = now() where id = $1`, [todo.id])));
  expect(g.id).toBeTruthy();
}, 300_000);
afterAll(() => useServerDb(null));

describe("the purge's preview and its transaction", () => {
  it("stays below the web's lock timeout however slow the database is, and says it is partial", async () => {
    slow.on = true;
    slow.statements = 0;
    const t0 = Date.now();
    let report: { partial?: boolean; rows: number; tables: Record<string, number> };
    try {
      report = await e.owner.get(`/o/${e.org}/demo/report`);
    } finally {
      slow.on = false;
    }
    const took = Date.now() - t0;
    expect(report.partial).toBe(true);
    // what goes is counted whatever the budget allowed
    expect(report.rows).toBeGreaterThan(0);
    expect(report.tables.sm_groups).toBe(1);
    // the last statement may run past the budget, never the rest of the plan
    expect(took).toBeLessThan(WEB_TX_LIMITS.lockMs);
    // the budget itself: a person who saves a row the dry run holds waits for it, never into the lock timeout
    expect((demo as { PREVIEW_MS?: number }).PREVIEW_MS).toBeLessThan(WEB_TX_LIMITS.lockMs);
  }, 120_000);

  it("a database that answers in time gives the whole preview", async () => {
    const report = await e.owner.get(`/o/${e.org}/demo/report`);
    expect(report.partial ?? false).toBe(false);
    expect(report.tables.sm_groups).toBe(1);
  }, 120_000);
});

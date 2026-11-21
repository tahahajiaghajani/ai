// Cleanup of finished jobs (Kariz 1.1.4): done jobs are kept 3 days and failed jobs 30 days, then deleted in statements of
// 2,000 rows by their row address (`ctid = any(array(…))`: an index scan of the finished jobs and a TID scan, at a constant
// cost however long the table is — the old `id in (select … limit 5000)` scanned the whole table per batch), done jobs
// first, for at most 2 s of a tick and at most once an hour per process. The web version's request ticks
// (`cleanup: false`) leave it to GET /api/cron/tick. The tests of this file run in order (one module, one hourly gate).
import { describe, it, expect, beforeAll } from "vitest";
import { tick } from "@server/jobs";
import { makeServer, quietLog } from "./helpers";
import type { ServerConfig } from "@server/context";
import type { Db, Queryable, Tx } from "@server/db";

/** The database with every statement recorded, and an optional pause before each delete (a slow database). */
function recording(db: Db) {
  const statements: string[] = [];
  let pauseMs = 0;
  const seen = (text: string) => {
    statements.push(text);
    return /\bdelete from sm_jobs\b/.test(text) && pauseMs ? new Promise((r) => setTimeout(r, pauseMs)) : null;
  };
  const wrap = <Q extends Queryable>(q: Q): Q =>
    new Proxy(q, {
      get(target, prop, receiver) {
        if (prop === "query" || prop === "one") {
          return async (text: string, params?: unknown[]) => {
            await seen(text);
            return target[prop](text, params);
          };
        }
        if (prop === "tx") return (fn: (tx: Tx) => Promise<unknown>) => (target as unknown as Db).tx((tx) => fn(wrap(tx)));
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  return {
    db: wrap(db),
    statements,
    deletes: () => statements.filter((s) => /\bdelete from sm_jobs\b/.test(s)),
    pause(ms: number) {
      pauseMs = ms;
    },
  };
}

describe("cleanup of finished jobs", () => {
  let db: Db;
  let rec: ReturnType<typeof recording>;
  let cfg: ServerConfig;

  beforeAll(async () => {
    db = (await makeServer()).db;
    rec = recording(db);
    cfg = { mode: "cloud", db: rec.db, secret: "t", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const finished = (kind: string, status: string, n: number, age: string) =>
      db.query(
        `insert into sm_jobs (id, kind, status, attempts, run_at, done_at, created_at, updated_at)
         select gen_random_uuid(), $1, $2, 1, now() - $4::interval, now() - $4::interval + (g * interval '1 second'), now() - $4::interval, now() - $4::interval
         from generate_series(1, $3::int) g`,
        [kind, status, n, age],
      );
    await finished("test.old_done", "done", 4500, "4 days");
    await finished("test.young_done", "done", 10, "1 day");
    await finished("test.young_failed", "failed", 5, "10 days");
    await finished("test.old_failed", "failed", 5, "31 days");
  }, 120_000);

  const counts = async () =>
    Object.fromEntries(
      (await db.query<{ kind: string; n: number }>(`select kind, count(*)::int as n from sm_jobs where kind like 'test.%' group by kind`)).map((r) => [r.kind, r.n]),
    );
  const ALL = { "test.old_done": 4500, "test.young_done": 10, "test.young_failed": 5, "test.old_failed": 5 };

  it("a request tick (cleanup: false) deletes nothing", async () => {
    await tick(cfg, { budgetMs: 3000, cleanup: false });
    expect(await counts()).toEqual(ALL);
    expect(rec.deletes()).toEqual([]);
  });

  it("a cleanup that runs out of its 2 s stops with rows left, and the next tick goes on", async () => {
    // every delete takes 1.1 s: the first round ends after 1.1 s, a second one starts and ends past the 2 s
    rec.pause(1100);
    const t0 = Date.now();
    try {
      await tick(cfg, { budgetMs: 20_000 });
    } finally {
      rec.pause(0);
    }
    expect(Date.now() - t0).toBeLessThan(5000);
    const after = await counts();
    expect(rec.deletes().length).toBeGreaterThanOrEqual(1);
    expect(rec.deletes().length).toBeLessThanOrEqual(2);
    expect(after["test.old_done"]).toBe(4500 - 2000 * rec.deletes().length);
    // the failed jobs' turn had not come
    expect(after["test.old_failed"]).toBe(5);
  });

  it("deletes the done jobs older than 3 days and the failed ones older than 30 days, 2,000 rows a statement by ctid", async () => {
    const before = rec.deletes().length;
    await tick(cfg, { budgetMs: 20_000 });
    expect(await counts()).toEqual({ "test.young_done": 10, "test.young_failed": 5 });
    const deletes = rec.deletes();
    // the rest of the done jobs (500 or 2,500: one or two statements), then the failed ones
    expect(deletes.length - before).toBeGreaterThanOrEqual(2);
    for (const d of deletes) {
      expect(d).toContain("ctid = any(array(");
      expect(d).toContain("limit 2000");
      expect(d).not.toMatch(/\bid in\b/);
    }
    expect(deletes.at(-1)).toContain("status = 'failed'");
  });

  it("cleans up at most once an hour per process", async () => {
    await db.query(
      `insert into sm_jobs (id, kind, status, attempts, done_at) select gen_random_uuid(), 'test.old_done', 'done', 1, now() - interval '5 days' from generate_series(1, 3)`,
    );
    const before = rec.deletes().length;
    await tick(cfg, { budgetMs: 2000 });
    expect(rec.deletes().length).toBe(before);
    expect((await counts())["test.old_done"]).toBe(3);
  });
});

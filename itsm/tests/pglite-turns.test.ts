// A long transaction of the Windows app's database lets the event loop turn (src/server/db/pglite.ts,
// docs/PERFORMANCE_FA.md §21). A module's seed after the setup or a step of the demo load writes thousands of
// statements in one transaction, and the local server's one thread was held for all of them, up to 3.3 s: the window's
// files, sockets and timers waited. The app's other queries still wait for the transaction's end: none runs inside it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPgliteDb, type PgliteDb } from "@server/db/pglite";

let dir: string;
let db: PgliteDb;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pglite-turns-"));
  db = await createPgliteDb({ dataDir: dir, vector: false, wal: false });
  await db.exec("create table t (id int primary key)");
}, 60_000);

afterAll(async () => {
  await db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a long transaction of a data-folder database", () => {
  it("lets timers run while it works, and the app's other queries wait for its end", async () => {
    let timerAt = 0;
    let endAt = 0;
    let seen: number | null = null;
    const work = db.tx(async (tx) => {
      await tx.query("insert into t (id) values (1)");
      setTimeout(() => {
        timerAt = performance.now();
        // another request's query: it must not run inside the open transaction
        void db.one<{ n: number }>("select count(*)::int as n from t").then((r) => (seen = r!.n));
      }, 10);
      const t0 = performance.now();
      while (performance.now() - t0 < 400) await tx.query("select 1");
      endAt = performance.now();
      throw new Error("rolled back");
    });
    await expect(work).rejects.toThrow("rolled back");
    // the timer fired while the transaction worked (before: only after its end, 400 ms late)
    expect(timerAt).toBeGreaterThan(0);
    expect(timerAt).toBeLessThan(endAt);
    // the other query waited for the end: it did not see the row of the rolled-back transaction
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toBe(0);
  });
});

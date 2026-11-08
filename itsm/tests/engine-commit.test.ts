// Before-commit work of a transaction (`onBeforeCommit`, docs/spec/ENGINE.md § Hooks): queued once per key however
// many writes queue it, run in the same transaction just before the commit (its writes commit with it, its failure
// rolls everything back), work it queues runs after it; and the request module's order roll-up runs once per
// transaction however many items an order gets.
import { describe, it, expect, beforeAll } from "vitest";
import { onBeforeCommit } from "@server/engine";
import { createPgliteDb } from "@server/db/pglite";
import type { Db } from "@server/db";
import { requestKit, type RequestKit } from "./request-helpers";

describe("onBeforeCommit", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
    await db.exec(`create table if not exists bc_log (n int, what text)`);
  });

  it("runs work once per key, in order, in the transaction, before it commits", async () => {
    const ran: string[] = [];
    await db.tx(async (tx) => {
      for (let i = 0; i < 3; i++) {
        onBeforeCommit(tx, "total", async () => {
          ran.push(`total:${i}`);
          await tx.query(`insert into bc_log (n, what) values ($1, 'total')`, [i]);
        });
      }
      expect(onBeforeCommit(tx, "other", () => void ran.push("other"))).toBe(true);
      expect(onBeforeCommit(tx, "other", () => void ran.push("other again"))).toBe(false);
      // nothing ran yet
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(["total:0", "other"]);
    expect(await db.query(`select n from bc_log where what = 'total'`)).toEqual([{ n: 0 }]);
  });

  it("runs work queued by work, and may run a key again once it ran", async () => {
    const ran: string[] = [];
    await db.tx(async (tx) => {
      onBeforeCommit(tx, "a", () => {
        ran.push("a");
        onBeforeCommit(tx, "b", () => void ran.push("b"));
        onBeforeCommit(tx, "a", () => void ran.push("a again"));
      });
    });
    expect(ran).toEqual(["a", "b", "a again"]);
  });

  it("a failure rolls the whole transaction back; endless re-queueing is refused", async () => {
    await expect(db.tx(async (tx) => {
      await tx.query(`insert into bc_log (n, what) values (1, 'rolled back')`);
      onBeforeCommit(tx, "boom", () => {
        throw new Error("roll-up refused");
      });
    })).rejects.toThrow("roll-up refused");
    expect(await db.query(`select 1 from bc_log where what = 'rolled back'`)).toEqual([]);
    await expect(db.tx(async (tx) => {
      const again = (): void => void onBeforeCommit(tx, "loop", again);
      again();
    })).rejects.toThrow("keeps queueing");
  });
});

describe("the order roll-up runs once per transaction", () => {
  let k: RequestKit;
  beforeAll(async () => {
    k = await requestKit();
  }, 120_000);

  it("an order of three items is totalled once", async () => {
    const buyer = await k.person("commit-buyer@example.com", { roles: ["requester"] });
    const other = await k.item("other_request");
    const lines = [1, 2, 3].map((n) => ({ item_id: other.id, answers: { subject: `مورد ${n}`, details: "—" } }));
    const order = await buyer.client.post(`${k.P}/request/order`, { lines });
    const [req] = await k.rows("request", "id = $2", [order.request.id]);
    expect(req.items_count).toBe(3);
    // one change of the header's count in its history (0 → 3), not one per item
    const history = await k.o.db.query(`select old, new from sm_history where org_id = $1 and table_key = 'request' and record_id = $2 and field = 'items_count'`, [k.o.org, order.request.id]);
    expect(history.filter((h) => h.old !== null)).toEqual([{ old: 0, new: 3 }]);
  });
});

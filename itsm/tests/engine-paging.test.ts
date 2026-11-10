// The modules' reads of live rows (`liveRows`, the engine's `selectRows`): a sweep that asks for more than 10,000 rows
// (installs to reconcile, the ledger's keys of a period, assets to depreciate) gets all of them, read page by page —
// never the first 10,000 in silence (duplicate installs, re-posted accruals, undercounted licences).
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { capture } from "@server/modules/financial";
import { liveRows } from "@server/modules/incident/common";
import { periodKeyOf } from "@shared/financial/logic";
import { todayISO } from "@shared/jalali";

let w: ItamWorld;
type Row = Record<string, any>;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 200 })).rows as Row[];

beforeAll(async () => {
  w = await itamWorld();
  await w.asset({ serial_number: "PG-1", purchase_cost: "100000000", purchase_date: todayISO("Asia/Tehran") });
  await capture(w.sys, periodKeyOf(todayISO("Asia/Tehran")));
}, 120_000);

describe("large reads", () => {
  it("reads every row a sweep asks for beyond 10,000 (no silent cut)", async () => {
    const [seed] = await q("cost_entry", null);
    const db = w.e.cfg.db;
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'sm_cost_entries' and is_generated = 'NEVER' and column_name not in ('id', 'no', 'source_key')`)).map((r) => r.column_name);
    await db.query(`insert into sm_cost_entries (id, source_key, ${cols.join(", ")}) select gen_random_uuid(), 'bulk:' || g, ${cols.map((c) => `t.${c}`).join(", ")} from sm_cost_entries t, generate_series(1, 10050) g where t.id = $1`, [seed.id]);
    const rows = await liveRows(db, w.sys, "cost_entry", { f: "source_key", op: "starts", v: "bulk:" }, { limit: 200_000 });
    expect(rows).toHaveLength(10_050);
    expect(new Set(rows.map((r) => r.id)).size).toBe(10_050);
    expect(await liveRows(db, w.sys, "cost_entry", { f: "source_key", op: "starts", v: "bulk:" }, { limit: 10_020, order: "t.created_at desc" })).toHaveLength(10_020);
  }, 120_000);
});

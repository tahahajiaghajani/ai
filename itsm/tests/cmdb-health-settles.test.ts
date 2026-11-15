// A CI's health check settles (docs/PERFORMANCE_FA.md §20). It compared the stored health — jsonb, read back with its
// keys in jsonb's order — with the one it built as text, so it never found them equal: every check wrote the CI again,
// and the CI's after-write hook queued the next check 3 s later. Every CI ever checked was checked again every 3 s,
// for good, in every edition. Now a check that finds nothing new writes nothing, and the check's own write queues none.
import { beforeAll, describe, expect, it } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { tick } from "@server/jobs";
import { systemCtx, updateIn } from "@server/engine";
import type { Ctx } from "@server/context";
import { computeHealth } from "@server/modules/cmdb";

let e: EngineOrg;
let P: string;
let sys: Ctx;
const one = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await e.db.one<T>(sql, params)) as T;
const queuedChecks = async (ci: string) => Number((await one<{ n: number }>(`select count(*)::int as n from sm_jobs where kind = 'cmdb.health_ci' and status = 'queued' and payload->>'ci' = $1`, [ci])).n);
const updateEvents = async (ci: string) => Number((await one<{ n: number }>(`select count(*)::int as n from sm_jobs where kind = 'record.updated' and payload->>'id' = $1`, [ci])).n);
const stored = (ci: string) => one<{ health_at: string | null; health: Record<string, unknown> | null; tx: string }>(`select health_at::text as health_at, health, xmin::text as tx from sm_cis where id = $1`, [ci]);

/** due jobs until none is left (bounded) */
async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
}
/** the short waits of a CI's jobs skipped (its health check waits 3 s, its relationship rules 2 s), then the queue */
async function drainNow() {
  await e.db.query(`update sm_jobs set run_at = now() where status = 'queued' and kind in ('cmdb.health_ci', 'cmdb.rel_rules')`);
  await drain();
}

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  await e.owner.post(`${P}/cmdb/seed`, {});
  sys = await systemCtx(e.cfg, e.org);
  await drain();
}, 120_000);

describe("the CI health check settles", () => {
  it("writes a CI's health once, queues no check after its own write, and writes nothing when nothing changed", async () => {
    const ci = (await e.owner.post(`${P}/r/ci`, { name: "srv-health-settles", class: "server", state: "operational" })).row;
    await drain();
    // the create queued the first check
    expect(await queuedChecks(ci.id)).toBe(1);
    await drainNow();
    const first = await stored(ci.id);
    expect(first.health_at).toBeTruthy();
    // the premise: jsonb hands the detail back with its keys in another order than the check wrote them
    expect(Object.keys(first.health!)).not.toEqual(["completeness", "recommended", "correctness", "compliance", "missing", "violations", "failed_rules", "warned"]);
    // the check's own write queued no next check (before: one 3 s later, after every check, forever)
    expect(await queuedChecks(ci.id)).toBe(0);
    // a check that finds nothing new writes nothing: no new row version, no event, the same stamp
    const events = await updateEvents(ci.id);
    expect(await sys.write((tx) => computeHealth(tx, sys, { ids: [ci.id] }))).toMatchObject({ processed: 1, updated: 0 });
    expect(await stored(ci.id)).toMatchObject({ health_at: first.health_at, tx: first.tx });
    expect(await updateEvents(ci.id)).toBe(events);
    // a real change is checked again, once
    await e.owner.patch(`${P}/r/ci/${ci.id}`, { serial_number: "HS-0001" });
    expect(await queuedChecks(ci.id)).toBe(1);
    await drainNow();
    expect(await queuedChecks(ci.id)).toBe(0);
  });

  it("a JSON field written again with its keys in another order is no change: the record is not written at all", async () => {
    const ci = (await e.owner.post(`${P}/r/ci`, { name: "srv-same-json", class: "server", state: "operational" })).row;
    await drainNow();
    const before = await stored(ci.id);
    const events = await updateEvents(ci.id);
    // the stored detail with its keys reversed: the same JSON
    const reordered = Object.fromEntries(Object.entries(before.health!).reverse());
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(before.health));
    await sys.write((tx) => updateIn(tx, sys, "ci", ci.id, { health: reordered }, { trusted: true }));
    expect(await stored(ci.id)).toMatchObject({ tx: before.tx, health_at: before.health_at });
    expect(await updateEvents(ci.id)).toBe(events);
    expect(await queuedChecks(ci.id)).toBe(0);
  });
});

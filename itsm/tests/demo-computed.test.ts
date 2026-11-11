// The purge and the computed tables (src/server/modules/demo/purge.ts restoreComputed): the job queue runs on between
// the purge's phases, so a scheduled check can make a computed record meanwhile — e.g. the knowledge quality check opens
// a gap from the demo pack's requests after the expand phase. The purge puts the computed tables back as they were saved
// before the load; what it takes out of them goes with everything that names it, the record event queued about it
// included. (Main CI once found three record.created jobs naming such vanished rows after a purge.)
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { purgeStep } from "@server/modules/demo";
import { saveComputed, tablesInfo } from "@server/modules/demo/purge";

let e: EngineOrg;

beforeAll(async () => {
  e = await engineOrg();
}, 300_000);

async function phase(): Promise<string | null> {
  const p = await e.db.one<{ purge: string | null }>(`select progress->>'purge' as purge from sm_demo_packs where org_id = $1`, [e.org]);
  return p?.purge ?? null;
}

/** A pack whose load saved the computed tables (the load's first step), with one demo record; the purge started. */
async function packToPurge(title: string): Promise<void> {
  await e.owner.post(`/o/${e.org}/demo/load`, { size: "small", force: true });
  const computed = await saveComputed(e.db, e.org, await tablesInfo(e.db));
  expect(computed).toContain("sm_kb_gaps");
  await e.db.query(
    `update sm_demo_packs set progress = progress || jsonb_build_object('saved', true, 'saved_at', now(), 'computed', $2::jsonb) where org_id = $1`,
    [e.org, JSON.stringify(computed)],
  );
  const sys = await systemCtx(e.cfg, e.org);
  await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "incident", { short_description: title, impact: "3", urgency: "3", caller_id: e.ownerId }, { trusted: true })));
  await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
}

/** The knowledge quality check opens a gap (the platform, outside the demo scope): a record event is queued about it. */
async function gapByThePlatform(signature: string): Promise<string> {
  const sys = await systemCtx(e.cfg, e.org);
  const gap = await sys.write((tx) => createIn(tx, sys, "kb_gap", { title: "رمز کارت بانکی فراموش شده", kind: "no_article", signature, demand: 3, score: 3 }, { trusted: true }));
  const queued = await e.db.query<{ kind: string }>(`select kind from sm_jobs where org_id = $1 and payload::text like '%' || $2 || '%'`, [e.org, gap.id]);
  expect(queued.map((j) => j.kind)).toContain("record.created");
  return gap.id as string;
}

async function purgeToEnd(): Promise<void> {
  for (let i = 0; i < 12 && (await phase()); i++) await purgeStep(e.cfg, e.org);
  expect((await e.owner.get(`/o/${e.org}/demo`)).state).toBe("none");
}

async function namedBy(id: string): Promise<string[]> {
  return (await e.db.query<{ kind: string }>(`select kind from sm_jobs where payload::text like '%' || $1 || '%'`, [id])).map((j) => j.kind);
}

describe("the purge and the computed tables", () => {
  it("a computed record made while the purge ran goes with the record event queued about it", async () => {
    await packToPurge("رخداد نمایشی کارت");
    // the purge's phases up to the restore phase (the queue runs other jobs between them)
    for (let i = 0; i < 12 && (await phase()) !== "restore"; i++) await purgeStep(e.cfg, e.org);
    expect(await phase()).toBe("restore");
    const gap = await gapByThePlatform("demo-computed:restore");
    await purgeToEnd();
    expect(await e.db.one(`select 1 from sm_kb_gaps where id = $1`, [gap])).toBeNull();
    expect(await namedBy(gap)).toEqual([]);
  }, 300_000);

  it("also one made after the restore phase, before the purge ends", async () => {
    await packToPurge("رخداد نمایشی خودپرداز");
    for (let i = 0; i < 12 && (await phase()) !== "finish"; i++) await purgeStep(e.cfg, e.org);
    expect(await phase()).toBe("finish");
    const gap = await gapByThePlatform("demo-computed:finish");
    await purgeToEnd();
    expect(await e.db.one(`select 1 from sm_kb_gaps where id = $1`, [gap])).toBeNull();
    expect(await namedBy(gap)).toEqual([]);
    // the numbering is back where it was before the load (the gap's number is free again)
    const n = await e.db.one<{ last: number }>(`select last from sm_numbers where org_id = $1 and table_key = 'kb_gap'`, [e.org]);
    expect(n?.last ?? 0).toBe(0);
  }, 300_000);
});

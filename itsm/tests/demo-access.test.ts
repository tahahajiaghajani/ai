// Who may load and remove the demo pack (docs/DEMO_FA.md), and what it may not touch: only the organisation's
// administrators (settings, full) see the console API (the personas' password with it, only while demo sign-in is on) — every member sees the banner;
// another organisation's people reach nothing; a load over real records is refused unless forced; the purge confirms
// with the typed phrase; a purge removes nothing of another organisation, nor any real row.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { purgeStep } from "@server/modules/demo";

let e: EngineOrg;
let other: EngineOrg;

beforeAll(async () => {
  e = await engineOrg();
  other = await engineOrg();
}, 300_000);

describe("demo pack access", () => {
  it("only administrators reach the console API; every member sees the banner", async () => {
    const member = await e.member("member");
    const admin = await e.member("admin");
    expect((await member.client.get(`/o/${e.org}/demo/banner`)).active).toBe(false);
    await member.client.get(`/o/${e.org}/demo`, 403);
    await member.client.get(`/o/${e.org}/demo/report`, 403);
    await member.client.post(`/o/${e.org}/demo/load`, { size: "small" }, 403);
    await member.client.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" }, 403);
    // an administrator of the organisation (settings, full) reaches it
    const s = await admin.client.get(`/o/${e.org}/demo`);
    expect(s.state).toBe("none");
    // another organisation's owner reaches nothing of this one
    await other.owner.get(`/o/${e.org}/demo`, 403).catch(async () => other.owner.get(`/o/${e.org}/demo`, 404));
    await other.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" }, 403).catch(async () => other.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" }, 404));
  }, 300_000);

  it("refuses a load over real records unless forced, and the purge removes only demo rows of its own organisation", async () => {
    const real = (await e.owner.post(`/o/${e.org}/r/incident`, { short_description: "رخداد واقعی شعبه", impact: "3", urgency: "3" })).row;
    const refused = await e.owner.post(`/o/${e.org}/demo/load`, { size: "small" }, 409);
    expect(JSON.stringify(refused)).toMatch(/واقعی/);
    // forced: the pack starts (its job is queued in the demo scope)
    const started = await e.owner.post(`/o/${e.org}/demo/load`, { size: "small", force: true });
    expect(started.state).toBe("loading");
    // demo rows written the way the pack writes them, in both organisations' scopes
    const sys = await systemCtx(e.cfg, e.org);
    const demo = await inDemoScope(e.org, () => sys.write((tx) => createIn(tx, sys, "incident", { short_description: "رخداد نمایشی", impact: "3", urgency: "3", caller_id: e.ownerId }, { trusted: true })));
    const osys = await systemCtx(other.cfg, other.org);
    const theirs = await inDemoScope(other.org, () => osys.write((tx) => createIn(tx, osys, "incident", { short_description: "رخداد نمایشی سازمان دیگر", impact: "3", urgency: "3" }, { trusted: true })));
    // the real incident refers to the demo one: the report names it, the purge empties the reference
    await e.db.query(`update sm_incidents set parent_id = $2 where id = $1`, [real.id, demo.id]);
    const report = await e.owner.get(`/o/${e.org}/demo/report`);
    expect(report.references).toContainEqual(expect.objectContaining({ table: "sm_incidents", field: "parent_id", rows: 1, action: "cleared" }));
    // the typed confirmation
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف" }, 400);
    await e.owner.post(`/o/${e.org}/demo/purge`, { confirm: "حذف کامل" });
    for (let i = 0; i < 12; i++) await purgeStep(e.cfg, e.org);
    expect((await e.owner.get(`/o/${e.org}/demo`)).state).toBe("none");
    expect(await e.db.one(`select 1 from sm_incidents where id = $1`, [demo.id])).toBeNull();
    const kept = await e.db.one<{ id: string; parent_id: string | null; short_description: string }>(`select id, parent_id, short_description from sm_incidents where id = $1`, [real.id]);
    expect(kept).toEqual({ id: real.id, parent_id: null, short_description: "رخداد واقعی شعبه" });
    // the other organisation's demo row is untouched (its own pack's business)
    expect(await other.db.one(`select 1 from sm_incidents where id = $1`, [theirs.id])).toBeTruthy();
    // only the content-free audit line of the purge stayed (the load never finished: no load line)
    const lines = await e.db.query<{ action: string; summary: string; entity_id: string | null }>(`select action, summary, entity_id from sm_audit where org_id = $1 and action like 'demo%'`, [e.org]);
    expect(lines).toEqual([{ action: "demo_purge", summary: "داده‌های نمایشی حذف شد", entity_id: null }]);
  }, 300_000);
});

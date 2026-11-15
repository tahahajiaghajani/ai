// ITAM ↔ CMDB discovery (itam_config.auto_assets, on by default): a CMDB full of discovered hardware is never turned
// into assets nobody reviewed. Until an asset manager makes the first batch from the dashboard, the daily step only
// counts the hardware CIs without an asset and tells the asset managers (once per new count); the reviewed batch
// confirms the step, which then makes capped daily batches with a summary notification — never for an ATM, CRS or kiosk
// a monitoring tool reports as a plain device (the rule a connector's asset feed keeps, itam/fleet.ts), nor for a CI of
// the demo pack (the organisation's own step takes its own CIs; the pack's work, the pack's).
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { discoveredStep } from "@server/modules/itam";
import { waitingHardware } from "@server/modules/itam/fleet";
import { inDemoScope } from "@server/db/scope";

let w: ItamWorld;
type Row = Record<string, any>;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 500 })).rows as Row[];
const config = async () => (await q("itam_config", null))[0];
const inbox = async (who: "am" | "agent") => ((await w.p[who].client.get(`${w.P}/notify/inbox?limit=50`)).items as Row[]).filter((i) => String(i.subject ?? i.title ?? "").includes("کشف‌شده") || String(i.body ?? "").includes("کشف‌شده"));
const ci = (name: string, cls = "laptop") => w.o.post(`${w.P}/r/ci`, { name, class: cls, state: "operational", serial_number: `SN-${name}` }).then((r) => r.row.id as string);
const assetOf = async (ciId: string) => (await q("asset", { f: "ci_id", op: "eq", v: ciId }))[0] ?? null;

let first: string[] = [];

beforeAll(async () => {
  w = await itamWorld();
  first = [await ci("pc-d1"), await ci("pc-d2"), await ci("srv-d3", "server")];
  await w.drain();
}, 180_000);

describe("discovered hardware before the first reviewed batch", () => {
  it("is on by default for a new organisation, and the daily step only counts and tells the asset managers", async () => {
    const cfg = await config();
    expect(cfg.auto_assets).toBe(true);
    expect(cfg.auto_assets_confirmed_at ?? null).toBeNull();
    const r = await discoveredStep(w.sys, 200);
    expect(r.created).toBe(0);
    expect(r.proposed).toBeGreaterThanOrEqual(3);
    for (const id of first) expect(await assetOf(id)).toBeNull();
    expect((await config()).auto_assets_pending).toBe(r.proposed);
    await w.drain();
    expect((await inbox("am")).length).toBe(1);
    // an agent who does not manage assets is not asked
    expect((await inbox("agent")).length).toBe(0);
    // the dashboard shows the count to asset managers only
    expect((await w.p.am.client.get(`${w.P}/itam/dashboard`)).discovered_pending).toBe(r.proposed);
    expect((await w.p.auditor.client.get(`${w.P}/itam/dashboard`).catch(() => ({ discovered_pending: null }))).discovered_pending ?? null).toBeNull();
  });

  it("tells them once per count: the same count again sends nothing, a new device a fresh summary", async () => {
    await discoveredStep(w.sys, 200);
    await w.drain();
    expect((await inbox("am")).length).toBe(1);
    first.push(await ci("pc-d4"));
    const r = await discoveredStep(w.sys, 200);
    expect(r.created).toBe(0);
    await w.drain();
    expect((await inbox("am")).length).toBe(2);
    for (const id of first) expect(await assetOf(id)).toBeNull();
  });
});

describe("the reviewed batch and the daily step after it", () => {
  it("is made by an asset manager only, and confirms the step", async () => {
    await w.p.req.client.post(`${w.P}/itam/discovered`, {}, 403);
    const r = await w.p.am.client.post(`${w.P}/itam/discovered`, {});
    expect(r.created).toBeGreaterThanOrEqual(4);
    expect(r.remaining).toBe(0);
    for (const id of first) expect(await assetOf(id)).toMatchObject({ state: "in_use", substate: "unverified" });
    const cfg = await config();
    expect(cfg.auto_assets_confirmed_at).toBeTruthy();
    expect(cfg.auto_assets_pending).toBe(0);
    expect((await w.p.am.client.get(`${w.P}/itam/dashboard`)).discovered_pending ?? null).toBeNull();
  });

  it("then makes capped daily batches with a summary for the asset managers", async () => {
    const more = [await ci("pc-d5"), await ci("pc-d6"), await ci("pc-d7")];
    const before = (await inbox("am")).length;
    const r = await discoveredStep(w.sys, 2);
    expect(r.created).toBe(2);
    expect((await Promise.all(more.map(assetOf))).filter(Boolean)).toHaveLength(2);
    await w.drain();
    const items = await inbox("am");
    expect(items.length).toBe(before + 1);
    expect(String(items[0].body ?? "")).toMatch(/۱ دستگاه دیگر/);
    expect((await discoveredStep(w.sys, 2)).created).toBe(1);
    expect((await Promise.all(more.map(assetOf))).filter(Boolean)).toHaveLength(3);
  });

  it("never makes an asset for an ATM, CRS or kiosk a monitoring tool reports as a plain device (the asset feed's rule)", async () => {
    // Zabbix and PRTG report the bank fleet as plain computers: the seeded fleet's model number or Latin model in any
    // spelling («ان‌سی‌آر SelfServ 22e (خودپرداز)» 6622e, «هیوسونگ MX8800 (CRS)», «کیوسک خدمات بانکی ۲۱ اینچ» K21), a
    // terminal id, or a connector's ATM row
    const as = (name: string, model_name?: string) => w.o.post(`${w.P}/r/ci`, { name, class: "computer", state: "operational", serial_number: `SN-${name}`, ...(model_name ? { model_name } : {}) }).then((r) => r.row.id as string);
    const fleet = [await as("atm-z1", "6622E"), await as("atm-z2", "SelfServ 22e"), await as("crs-p1", "mx-8800"), await as("kiosk-p1", "K21"), await as("atm-t1"), await as("atm-i1")];
    await w.e.db.query(`update sm_cis set attrs = coalesce(attrs, '{}'::jsonb) || '{"terminal_id": "10021"}'::jsonb where id = $1`, [fleet[4]]);
    await w.e.db.query(
      `insert into sm_discovery_items (id, org_id, connector_id, external_id, kind, name, state, ci_id, origin) values (gen_random_uuid(), $1, gen_random_uuid(), 'ATM-10022', 'atm', 'atm-i1', 'linked', $2, 'cloud')`,
      [w.e.org, fleet[5]],
    );
    const pc = await as("pc-z9", "OptiPlex 7010");
    expect((await discoveredStep(w.sys, 200)).created).toBe(1);
    expect(await assetOf(pc)).toMatchObject({ state: "in_use", substate: "unverified" });
    for (const id of fleet) expect(await assetOf(id)).toBeNull();
    // nor does an asset manager's batch from the dashboard
    expect(await w.p.am.client.post(`${w.P}/itam/discovered`, {})).toMatchObject({ created: 0, remaining: 0 });
    for (const id of fleet) expect(await assetOf(id)).toBeNull();
  });

  it("never makes an asset for a CI of the demo pack, nor counts one: the organisation's own step takes its own CIs", async () => {
    // the pack's servers and switches (its load makes them without assets), recorded as the pack's rows
    const pack = [await ci("aft-srv-01", "server"), await ci("aft-sw-01", "switch")];
    for (const id of pack) await w.e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_cis')`, [w.e.org, id]);
    const own = await ci("pc-d9");
    const waiting = await waitingHardware(w.e.db, w.e.org, 1000);
    expect(waiting).toContain(own);
    for (const id of pack) expect(waiting).not.toContain(id);
    expect((await discoveredStep(w.sys, 200)).created).toBe(1);
    expect(await assetOf(own)).toMatchObject({ state: "in_use", substate: "unverified" });
    for (const id of pack) expect(await assetOf(id)).toBeNull();
    // nor does an asset manager's batch from the dashboard
    expect(await w.p.am.client.post(`${w.P}/itam/discovered`, {})).toMatchObject({ created: 0, remaining: 0 });
    for (const id of pack) expect(await assetOf(id)).toBeNull();
    // the pack's own work (its demo scope) takes the pack's CIs only
    expect((await inDemoScope(w.e.org, () => waitingHardware(w.e.db, w.e.org, 1000))).sort()).toEqual([...pack].sort());
  });

  it("does nothing when switched off", async () => {
    const cfg = await config();
    await w.o.patch(`${w.P}/r/itam_config/${cfg.id}`, { auto_assets: false });
    const extra = await ci("pc-d8");
    expect(await discoveredStep(w.sys, 200)).toEqual({ proposed: 0, created: 0 });
    expect(await assetOf(extra)).toBeNull();
  });
});

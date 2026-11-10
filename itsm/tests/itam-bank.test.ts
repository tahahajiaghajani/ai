// Bank ITAM end to end (src/server/modules/itam/bank.ts): branch-scoped access (a branch's staff see their branch,
// a region's manager the region, an auditor reads everything and changes nothing), transfers between branches with
// approval, dispatch and the receiving branch's receipt, the hash-chained custody ledger, the branch audit with its
// reconciliation, branch managers' attestation, the ATM fleet (status, incidents, preventive maintenance), the asset
// register by fiscal year and the wipe certificate of a disposal.
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import type { Client } from "./helpers";
import { fromJalali } from "@shared/jalali";

let w: ItamWorld;
const u: Record<string, string> = {};
const m: Record<string, { client: Client; userId: string }> = {};
const a: Record<string, Record<string, any>> = {};
let atmModel: string;
let laptopModel: string;

beforeAll(async () => {
  w = await itamWorld();
  const unit = async (name: string, parent: string | null, extra: Record<string, unknown> = {}) => (await w.o.post(`${w.P}/r/org_unit`, { name, parent_id: parent, ...extra })).row.id as string;
  u.bank = await unit("بانک نمونه", null, { kind: "company" });
  u.tehran = await unit("منطقهٔ تهران", u.bank, { kind: "division", code: "R10" });
  u.vanak = await unit("شعبهٔ ونک", u.tehran, { kind: "branch", code: "1001" });
  u.tajrish = await unit("شعبهٔ تجریش", u.tehran, { kind: "branch", code: "1002" });
  u.isfahan = await unit("منطقهٔ اصفهان", u.bank, { kind: "division", code: "R20" });
  u.naqsh = await unit("شعبهٔ نقش جهان", u.isfahan, { kind: "branch", code: "2001" });
  const member = async (k: string, roles: string[], unitId: string) => {
    m[k] = await w.e.member("member", `${k}@bank.example`);
    await w.o.put(`${w.P}/access/members/${m[k].userId}`, { roles, persona: "agent", org_unit_id: unitId });
  };
  await member("vanak", ["branch_asset_officer"], u.vanak);
  await member("tajrish", ["branch_asset_officer"], u.tajrish);
  await member("naqsh", ["branch_asset_officer"], u.naqsh);
  await member("region", ["regional_asset_manager"], u.tehran);
  await member("boss", ["branch_manager"], u.vanak);
  await w.o.patch(`${w.P}/r/org_unit/${u.vanak}`, { manager_id: m.boss.userId });
  atmModel = await w.idOf("asset_model", "name", "ان‌سی‌آر SelfServ 22e (خودپرداز)");
  laptopModel = await w.idOf("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
  const mk = async (branch: string, data: Record<string, unknown> = {}) => (await w.p.am.client.post(`${w.P}/r/asset`, { model_id: laptopModel, state: "in_use", branch_id: branch, department_id: branch, purchase_cost: "650000000", purchase_date: "2025-05-01", ...data })).row;
  a.v1 = await mk(u.vanak, { serial_number: "V-1" });
  a.v2 = await mk(u.vanak, { serial_number: "V-2" });
  a.v3 = await mk(u.vanak, { serial_number: "V-3" });
  a.t1 = await mk(u.tajrish, { serial_number: "T-1" });
  a.n1 = await mk(u.naqsh, { serial_number: "N-1" });
  a.atm = await mk(u.vanak, { model_id: atmModel, serial_number: "ATM-1", terminal_id: "10010001", purchase_cost: "45000000000", in_service_date: "2025-06-01" });
}, 180_000);

const ids = (rows: any[]) => rows.map((r) => r.id).sort();

describe("branch-scoped access", () => {
  it("shows a branch's staff only their branch's assets and a region's manager the region", async () => {
    const vanak = await m.vanak.client.post(`${w.P}/r/asset/query`, { size: 100 });
    expect(ids(vanak.rows)).toEqual([a.v1.id, a.v2.id, a.v3.id, a.atm.id].sort());
    await m.vanak.client.get(`${w.P}/r/asset/${a.t1.id}`, 404);
    await m.vanak.client.get(`${w.P}/r/asset/${a.n1.id}`, 404);
    expect((await m.vanak.client.post(`${w.P}/r/asset/agg`, { metrics: [{ fn: "count" }] })).totals.count).toBe(4);
    const region = await m.region.client.post(`${w.P}/r/asset/query`, { size: 100 });
    expect(ids(region.rows)).toEqual([a.v1.id, a.v2.id, a.v3.id, a.atm.id, a.t1.id].sort());
    await m.region.client.get(`${w.P}/r/asset/${a.n1.id}`, 404);
    // money only with the financial field group (the regional manager has it, a branch officer does not)
    expect(vanak.rows[0].purchase_cost).toBeUndefined();
    expect(region.rows.find((r: any) => r.id === a.v1.id).purchase_cost).toBe("650000000");
  });

  it("counts the branch inventory over the branches the caller may read", async () => {
    const mine = await m.vanak.client.get(`${w.P}/itam/branches`);
    expect(mine.branches.map((b: any) => b.name)).toEqual(["شعبهٔ ونک"]);
    expect(mine.branches[0]).toMatchObject({ total: 4, fleet: 1, fleet_down: 0, value: null });
    expect(mine.branches[0].by_state.in_use).toBe(4);
    const region = await m.region.client.get(`${w.P}/itam/branches`);
    expect(region.branches.map((b: any) => b.name).sort()).toEqual(["شعبهٔ تجریش", "شعبهٔ ونک"]);
    expect(region.financial).toBe(true);
    expect(region.total).toBe(5);
  });

  it("lets an auditor read every branch and change nothing", async () => {
    const all = await w.p.auditor.client.post(`${w.P}/r/asset/query`, { size: 100 });
    for (const x of Object.values(a)) expect(all.rows.some((r: any) => r.id === x.id)).toBe(true);
    await w.p.auditor.client.patch(`${w.P}/r/asset/${a.v1.id}`, { notes: "x" }, 403);
    await w.p.auditor.client.post(`${w.P}/r/asset_transfer`, { title: "x", from_branch_id: u.vanak, to_branch_id: u.tajrish }, 403);
    expect((await w.p.auditor.client.get(`${w.P}/itam/assets/${a.v1.id}/custody`)).verified.ok).toBe(true);
  });

  it("keeps the branch to the transfer process and new assets to the officer's branches", async () => {
    await m.vanak.client.patch(`${w.P}/r/asset/${a.v1.id}`, { branch_id: u.tajrish }, 403);
    await m.vanak.client.post(`${w.P}/r/asset`, { model_id: laptopModel, state: "in_stock", stockroom_id: await w.idOf("stockroom", "code", "WH-01"), branch_id: u.tajrish }, 403);
    const own = (await m.vanak.client.post(`${w.P}/r/asset`, { model_id: laptopModel, state: "in_stock", stockroom_id: await w.idOf("stockroom", "code", "WH-01"), serial_number: "V-NEW" })).row;
    expect(own.branch_id).toBe(u.vanak);
    await m.vanak.client.patch(`${w.P}/r/asset/${own.id}`, { notes: "ثبت شعبه" });
    // the branch manager reads the branch and changes nothing
    expect((await m.boss.client.get(`${w.P}/r/asset/${a.v2.id}`)).row.serial_number).toBe("V-2");
    await m.boss.client.patch(`${w.P}/r/asset/${a.v2.id}`, { notes: "x" }, 403);
    // the asset manager moves the register directly (custody «تغییر شعبه در دفتر»)
    await w.p.am.client.patch(`${w.P}/r/asset/${own.id}`, { branch_id: u.naqsh });
    const chain = await w.p.am.client.get(`${w.P}/itam/assets/${own.id}/custody`);
    expect(chain.rows.map((r: any) => r.event)).toEqual(["registered", "branch_changed"]);
    expect(chain.verified).toEqual({ rows: 2, ok: true, broken_at: null });
  });
});

describe("transfers between branches", () => {
  let trf: Record<string, any>;

  it("issues a note, sends it for approval, dispatches and puts the assets in transit", async () => {
    trf = (await m.vanak.client.post(`${w.P}/r/asset_transfer`, { title: "انتقال لپ‌تاپ به تجریش", from_branch_id: u.vanak, to_branch_id: u.tajrish, reason: "relocation" })).row;
    expect(trf.number).toMatch(/^TRF/);
    // the other branch's asset cannot ride on this note; an empty note cannot be sent
    await m.vanak.client.post(`${w.P}/r/asset_transfer/${trf.id}/transition`, { to: "pending_approval" }, 409);
    await w.p.am.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: trf.id, asset_id: a.t1.id }, 400);
    await m.vanak.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: trf.id, asset_id: a.v1.id, condition_out: "good" });
    expect((await m.vanak.client.get(`${w.P}/r/asset_transfer/${trf.id}`)).row.item_count).toBe(1);
    await m.vanak.client.post(`${w.P}/r/asset_transfer/${trf.id}/transition`, { to: "pending_approval" });
    // items are frozen once sent; the officer cannot approve their own branch's note
    await m.vanak.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: trf.id, asset_id: a.v2.id }, 409);
    await m.vanak.client.post(`${w.P}/r/asset_transfer/${trf.id}/transition`, { to: "approved" }, 403);
    await m.region.client.post(`${w.P}/r/asset_transfer/${trf.id}/transition`, { to: "approved" });
    await m.vanak.client.post(`${w.P}/r/asset_transfer/${trf.id}/transition`, { to: "in_transit" });
    const t = (await m.vanak.client.get(`${w.P}/r/asset_transfer/${trf.id}`)).row;
    expect(t.state).toBe("in_transit");
    expect(t.dispatched_by).toBe(m.vanak.userId);
    expect((await w.p.am.client.get(`${w.P}/r/asset/${a.v1.id}`)).row.state).toBe("in_transit");
  });

  it("lets the receiving branch read the note, and only it take the receipt", async () => {
    expect((await m.tajrish.client.get(`${w.P}/r/asset_transfer/${trf.id}`)).row.number).toBe(trf.number);
    const inbox = await m.tajrish.client.get(`${w.P}/itam/transfers/inbox`);
    expect(inbox.incoming.map((x: any) => x.id)).toEqual([trf.id]);
    await m.naqsh.client.get(`${w.P}/r/asset_transfer/${trf.id}`, 404);
    const items = await m.tajrish.client.get(`${w.P}/itam/transfers/${trf.id}/items`);
    expect(items.items).toHaveLength(1);
    expect(items.transfer.can_receive).toBe(true);
    // the sender cannot sign the receipt; nobody passes the receipt through the generic transition
    await m.vanak.client.post(`${w.P}/itam/transfers/${trf.id}/receive`, { items: [{ id: items.items[0].id, result: "received" }] }, 403);
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${trf.id}/transition`, { to: "received" }, 403);
    const r = await m.tajrish.client.post(`${w.P}/itam/transfers/${trf.id}/receive`, { items: [{ id: items.items[0].id, result: "received", condition_in: "good" }], note: "سالم رسید" });
    expect(r).toEqual({ state: "received", received: 1, discrepancies: 0 });
    // the asset now belongs to the receiving branch: its staff read it, the sender's no longer do
    const moved = (await m.tajrish.client.get(`${w.P}/r/asset/${a.v1.id}`)).row;
    expect(moved.branch_id).toBe(u.tajrish);
    expect(moved.state).toBe("in_use");
    await m.vanak.client.get(`${w.P}/r/asset/${a.v1.id}`, 404);
    const chain = await w.p.auditor.client.get(`${w.P}/itam/assets/${a.v1.id}/custody`);
    expect(chain.rows.map((x: any) => x.event)).toEqual(["registered", "dispatched", "received"]);
    expect(chain.rows[2].reference).toBe(trf.number);
    expect(chain.verified.ok).toBe(true);
  });

  it("records what did not arrive as a discrepancy and the asset as missing", async () => {
    const t2 = (await m.vanak.client.post(`${w.P}/r/asset_transfer`, { title: "دو دستگاه به تجریش", from_branch_id: u.vanak, to_branch_id: u.tajrish })).row;
    await m.vanak.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t2.id, asset_id: a.v2.id });
    await m.vanak.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t2.id, asset_id: a.v3.id });
    // an asset on an open note cannot ride on another
    const t3 = (await m.vanak.client.post(`${w.P}/r/asset_transfer`, { title: "دیگر", from_branch_id: u.vanak, to_branch_id: u.naqsh })).row;
    await m.vanak.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t3.id, asset_id: a.v2.id }, 409);
    await m.vanak.client.post(`${w.P}/r/asset_transfer/${t2.id}/transition`, { to: "pending_approval" });
    await m.region.client.post(`${w.P}/r/asset_transfer/${t2.id}/transition`, { to: "approved" });
    await m.vanak.client.post(`${w.P}/r/asset_transfer/${t2.id}/transition`, { to: "in_transit" });
    const items = (await m.tajrish.client.get(`${w.P}/itam/transfers/${t2.id}/items`)).items;
    const byAsset = (id: string) => items.find((i: any) => i.asset_id === id).id;
    const r = await m.tajrish.client.post(`${w.P}/itam/transfers/${t2.id}/receive`, { items: [{ id: byAsset(a.v2.id), result: "damaged", note: "قاب شکسته" }, { id: byAsset(a.v3.id), result: "missing" }] });
    expect(r).toEqual({ state: "received_partial", received: 1, discrepancies: 2 });
    const lost = (await w.p.am.client.get(`${w.P}/r/asset/${a.v3.id}`)).row;
    expect(lost.state).toBe("missing");
    expect(lost.branch_id).toBe(u.vanak);
    expect((await w.p.am.client.get(`${w.P}/r/asset_transfer/${t2.id}`)).row.discrepancy_count).toBe(2);
  });
});

describe("transfer approval through the approvals service", () => {
  it("asks the asset-management group and moves the note on its decision", async () => {
    const group = await w.idOf("group", "name", "مدیریت دارایی");
    await w.o.post(`${w.P}/access/groups/${group}/members`, { user_ids: [w.p.am.userId] });
    const atm2 = (await w.p.am.client.post(`${w.P}/r/asset`, { model_id: atmModel, state: "in_use", branch_id: u.tajrish, department_id: u.tajrish, serial_number: "ATM-2" })).row;
    const t = (await m.tajrish.client.post(`${w.P}/r/asset_transfer`, { title: "بازگشت خودپرداز به انبار منطقه", from_branch_id: u.tajrish, to_branch_id: u.tehran, reason: "return_to_central" })).row;
    await m.tajrish.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t.id, asset_id: atm2.id });
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "pending_approval" });
    const a = (await w.p.am.client.get(`${w.P}/approvals/mine`)).approvals.find((x: any) => x.record_id === t.id);
    expect(a).toBeTruthy();
    await w.p.am.client.post(`${w.P}/approvals/${a.id}/decide`, { decision: "approved", comment: "تأیید" });
    expect((await w.p.am.client.get(`${w.P}/r/asset_transfer/${t.id}`)).row.state).toBe("approved");
    // the region (the destination itself) reads it; the receipt there puts the ATM in use at the region's unit
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "in_transit" });
    const items = (await m.region.client.get(`${w.P}/itam/transfers/${t.id}/items`)).items;
    expect((await m.region.client.post(`${w.P}/itam/transfers/${t.id}/receive`, { items: [{ id: items[0].id, result: "received" }] })).state).toBe("received");
    expect((await w.p.am.client.get(`${w.P}/r/asset/${atm2.id}`)).row.branch_id).toBe(u.tehran);
  });
});

describe("branch audit and reconciliation", () => {
  it("counts a branch, completes with discrepancies and closes only once they are settled", async () => {
    // a branch's officer cannot plan another branch's count
    await m.vanak.client.post(`${w.P}/r/inventory_audit`, { name: "شمارش تجریش", scope_kind: "branch", branch_id: u.tajrish }, 403);
    const aud = (await m.tajrish.client.post(`${w.P}/r/inventory_audit`, { name: "شمارش پاییز تجریش", scope_kind: "branch", branch_id: u.tajrish })).row;
    await m.tajrish.client.post(`${w.P}/r/inventory_audit/${aud.id}/transition`, { to: "in_progress" });
    const started = (await m.tajrish.client.get(`${w.P}/r/inventory_audit/${aud.id}`)).row;
    expect(started.expected_count).toBe(3); // t1, v1 (received) and v2 (received damaged)
    // the region's manager sees the branch's count and its items; another branch's officer does not
    await m.naqsh.client.get(`${w.P}/r/inventory_audit/${aud.id}`, 404);
    expect((await m.region.client.post(`${w.P}/r/inventory_audit_item/query`, { filter: { f: "audit_id", op: "eq", v: aud.id } })).rows).toHaveLength(3);
    const t1 = (await w.p.am.client.get(`${w.P}/r/asset/${a.t1.id}`)).row;
    expect((await m.tajrish.client.post(`${w.P}/itam/audits/${aud.id}/scan`, { code: t1.asset_tag })).result).toBe("found");
    expect((await m.tajrish.client.post(`${w.P}/itam/audits/${aud.id}/scan`, { code: "SN-UNKNOWN-77" })).result).toBe("unknown");
    await m.tajrish.client.post(`${w.P}/r/inventory_audit/${aud.id}/transition`, { to: "completed" });
    const done = (await m.tajrish.client.get(`${w.P}/r/inventory_audit/${aud.id}`)).row;
    expect(done.discrepancy_open).toBe(3); // v1 and v2 unseen, one unknown code
    await m.tajrish.client.post(`${w.P}/r/inventory_audit/${aud.id}/transition`, { to: "closed" }, 409);
    const items = (await m.tajrish.client.post(`${w.P}/r/inventory_audit_item/query`, { filter: { f: "audit_id", op: "eq", v: aud.id }, size: 50 })).rows;
    const of = (asset: string) => items.find((i: any) => i.asset_id === asset);
    const unknown = items.find((i: any) => i.result === "unexpected");
    // a settlement must fit the result; the auditor settles nothing
    await m.tajrish.client.post(`${w.P}/itam/audit-items/${of(a.v1.id).id}/resolve`, { resolution: "registered" }, 400);
    await w.p.auditor.client.post(`${w.P}/itam/audit-items/${of(a.v1.id).id}/resolve`, { resolution: "found" }, 403);
    expect((await m.tajrish.client.post(`${w.P}/itam/audit-items/${of(a.v1.id).id}/resolve`, { resolution: "found", note: "در اتاق رئیس" })).open).toBe(2);
    await m.tajrish.client.post(`${w.P}/itam/audit-items/${of(a.v2.id).id}/resolve`, { resolution: "confirmed_missing" });
    expect((await w.p.am.client.get(`${w.P}/r/asset/${a.v2.id}`)).row.state).toBe("missing");
    const reg = await m.tajrish.client.post(`${w.P}/itam/audit-items/${unknown.id}/resolve`, { resolution: "registered", model_id: laptopModel });
    expect(reg.open).toBe(0);
    const added = (await m.tajrish.client.get(`${w.P}/r/asset/${reg.asset_id}`)).row;
    expect(added.branch_id).toBe(u.tajrish);
    expect(added.serial_number).toBe("SN-UNKNOWN-77");
    await m.tajrish.client.post(`${w.P}/r/inventory_audit/${aud.id}/transition`, { to: "closed" });
    const chain = await w.p.am.client.get(`${w.P}/itam/assets/${a.t1.id}/custody`);
    expect(chain.rows.map((x: any) => x.event)).toContain("audited");
  });
});

describe("branch managers' attestation", () => {
  it("opens one per branch and period, which the branch manager signs with exceptions", async () => {
    await m.vanak.client.post(`${w.P}/itam/attestations/open`, {}, 403);
    const r = await w.p.am.client.post(`${w.P}/itam/attestations/open`, {});
    expect(r.opened).toBeGreaterThanOrEqual(3);
    expect((await w.p.am.client.post(`${w.P}/itam/attestations/open`, {})).opened).toBe(0);
    const mine = (await m.boss.client.post(`${w.P}/r/branch_attestation/query`, {})).rows;
    expect(mine).toHaveLength(1);
    expect(mine[0].branch_id).toBe(u.vanak);
    expect(mine[0].manager_id).toBe(m.boss.userId);
    const list = await m.boss.client.get(`${w.P}/itam/attestations/${mine[0].id}/assets`);
    expect(list.assets.length).toBeGreaterThanOrEqual(2);
    // only the branch's people attest; the signature is required
    await m.tajrish.client.post(`${w.P}/itam/attestations/${mine[0].id}/attest`, { signed_name: "x x x", exceptions: [] }, 404);
    await m.boss.client.post(`${w.P}/itam/attestations/${mine[0].id}/attest`, { signed_name: "", exceptions: [] }, 400);
    // the branch's asset officer, whose work the attestation checks, cannot sign it
    await m.vanak.client.post(`${w.P}/itam/attestations/${mine[0].id}/attest`, { signed_name: "مسئول اموال", exceptions: [] }, 403);
    const res = await m.boss.client.post(`${w.P}/itam/attestations/${mine[0].id}/attest`, { signed_name: "رئیس شعبهٔ ونک", exceptions: [{ asset_id: a.atm.id, issue: "damaged", note: "صفحه‌نمایش خط دارد" }] });
    expect(res).toEqual({ state: "attested_exceptions", exceptions: 1 });
    const att = (await w.p.am.client.get(`${w.P}/r/branch_attestation/${mine[0].id}`)).row;
    expect(att.exception_count).toBe(1);
    expect(att.signed_name).toBe("رئیس شعبهٔ ونک");
    await m.boss.client.post(`${w.P}/itam/attestations/${mine[0].id}/attest`, { signed_name: "دوباره", exceptions: [] }, 409);
  });
});

describe("the ATM fleet", () => {
  it("starts a device in service, records status periods and opens a cash incident on request", async () => {
    expect(a.atm.device_status).toBe("in_service");
    const r = await m.vanak.client.post(`${w.P}/itam/fleet/${a.atm.id}/status`, { status: "out_of_cash", reason: "کاست‌ها خالی است", incident: true });
    expect(r.asset.device_status).toBe("out_of_cash");
    expect(r.incident?.number).toBeTruthy();
    await m.tajrish.client.post(`${w.P}/itam/fleet/${a.atm.id}/status`, { status: "in_service" }, 404);
    await m.vanak.client.post(`${w.P}/itam/fleet/${a.v2.id}/status`, { status: "in_service" }, 404);
    const periods = (await w.p.am.client.post(`${w.P}/r/device_status_event/query`, { filter: { f: "asset_id", op: "eq", v: a.atm.id }, sort: "from_at" })).rows;
    expect(periods.map((p: any) => p.status)).toEqual(["in_service", "out_of_cash"]);
    expect(periods[0].to_at).toBeTruthy();
    expect(periods[1].reason).toBe("کاست‌ها خالی است");
    // the ledgers are the module's
    await w.p.am.client.post(`${w.P}/r/device_status_event`, { asset_id: a.atm.id, status: "in_service", from_at: new Date().toISOString() }, 403);
    await w.p.am.client.post(`${w.P}/r/asset_custody`, { asset_id: a.atm.id, event: "registered" }, 403);
  });

  it("shows the fleet within the caller's branches with status counts and risk", async () => {
    const f = await m.vanak.client.get(`${w.P}/itam/fleet`);
    expect(f.total).toBe(1);
    expect(f.status.out_of_cash).toBe(1);
    expect(f.devices[0]).toMatchObject({ id: a.atm.id, terminal_id: "10010001", branch: "شعبهٔ ونک", region: "منطقهٔ تهران" });
    expect(f.devices[0].risk.score).toBeGreaterThanOrEqual(0);
    expect((await m.tajrish.client.get(`${w.P}/itam/fleet`)).total).toBe(0);
    const risk = await m.vanak.client.post(`${w.P}/itam/fleet/${a.atm.id}/risk`);
    expect(risk.text).toContain("ریسک خرابی");
  });

  it("creates preventive maintenance plans that field service turns into work orders", async () => {
    await m.vanak.client.post(`${w.P}/itam/fleet/pm-plans`, {}, 403);
    // the ATM's CI (queued link job) before planning
    await w.drain();
    const atm = (await w.p.am.client.get(`${w.P}/r/asset/${a.atm.id}`)).row;
    expect(atm.ci_id).toBeTruthy();
    const r = await w.o.post(`${w.P}/itam/fleet/pm-plans`, { every_n: 3, interval_unit: "month" });
    expect(r.created).toBe(2); // both ATMs (Vanak's and the one returned to the region)
    expect((await w.o.post(`${w.P}/itam/fleet/pm-plans`, {})).created).toBe(0);
    const plans = (await w.o.post(`${w.P}/r/maintenance_plan/query`, { filter: { f: "ci_id", op: "eq", v: atm.ci_id } })).rows;
    expect(plans).toHaveLength(1);
    expect(plans[0].every_n).toBe(3);
  });
});

describe("the asset register «دفتر اموال»", () => {
  it("gives a fiscal year's cost, depreciation and book values with financial access only", async () => {
    await m.vanak.client.get(`${w.P}/itam/register?fy=1404`, 403);
    const reg = await w.p.am.client.get(`${w.P}/itam/register?fy=1404&branch_id=${u.vanak}`);
    expect(reg.fiscal_year).toBe(1404);
    expect(reg.from).toBe(fromJalali(1404, 1, 1));
    const atm = reg.rows.find((r: any) => r.id === a.atm.id);
    expect(atm.cost).toBe("45000000000");
    expect(atm.acquired_in_year).toBe(true);
    // 7 years straight line, 5% residual, from the month after 1404-03-11: Tir … Esfand = 9 months
    expect(atm.months_charged).toBe(9);
    expect(atm.charge).toBe(String(Math.round((45000000000 * 0.95 * 9) / 84)));
    expect(reg.totals.cost).toBeTruthy();
    const region = await m.region.client.get(`${w.P}/itam/register?fy=1404`);
    expect(region.rows.some((r: any) => r.id === a.n1.id)).toBe(false);
  });
});

describe("secure disposal", () => {
  it("issues a wipe certificate with a fingerprint once the evidence is complete", async () => {
    const order = (await w.p.am.client.post(`${w.P}/r/disposal_order`, { title: "اسقاط دیسک‌ها", method: "destroy" })).row;
    const item = (await w.p.am.client.post(`${w.P}/r/disposal_item`, { order_id: order.id, asset_id: a.n1.id })).row;
    expect(item.certificate_hash).toBeFalsy();
    await w.p.am.client.get(`${w.P}/itam/disposal-items/${item.id}/certificate`, 409);
    const done = (await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { sanitization_method: "purge", sanitized_at: new Date().toISOString(), sanitized_by: w.p.am.userId, witness_id: w.p.agent.userId, certificate_no: "WIPE-1405-001", wipe_tool: "Blancco" })).row;
    expect(done.certificate_hash).toMatch(/^[0-9a-f]{64}$/);
    const cert = await w.p.am.client.get(`${w.P}/itam/disposal-items/${item.id}/certificate`);
    expect(cert).toMatchObject({ certificate_no: "WIPE-1405-001", tool: "Blancco", asset: { serial: "N-1", branch: "شعبهٔ نقش جهان" } });
    const chain = await w.p.am.client.get(`${w.P}/itam/assets/${a.n1.id}/custody`);
    expect(chain.rows.map((x: any) => x.event)).toContain("wiped");
  });
});

describe("asset tags «پلاک اموال»", () => {
  it("numbers new assets by the organisation's pattern: branch code, class code and digits", async () => {
    const cfg = (await w.o.post(`${w.P}/r/itam_config/query`, {})).rows[0];
    await w.o.patch(`${w.P}/r/itam_config/${cfg.id}`, { tag_prefix: "BK-", tag_pattern: "{prefix}{branch}-{class}-{seq}" });
    const atm = (await w.p.am.client.post(`${w.P}/r/asset`, { model_id: atmModel, state: "in_use", branch_id: u.vanak, department_id: u.vanak, serial_number: "ATM-TAG" })).row;
    const digits = String(atm.number).replace(/\D/g, "");
    expect((await w.p.am.client.get(`${w.P}/r/asset/${atm.id}`)).row.asset_tag).toBe(`BK-1001-ATM-${digits}`);
  });
});

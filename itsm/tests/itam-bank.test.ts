// Bank ITAM end to end (src/server/modules/itam/bank.ts): branch-scoped access (a branch's staff see their branch,
// a region's manager the region, an auditor reads everything and changes nothing), transfers between branches with
// approval, dispatch and the receiving branch's receipt, the hash-chained custody ledger, the branch audit with its
// reconciliation, branch managers' attestation, the ATM fleet (status, incidents, preventive maintenance), the asset
// register by fiscal year and the wipe certificate of a disposal.
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import type { Client } from "./helpers";
import { fromJalali } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { CONTACT_SLACK_MS, PAGING } from "@server/modules/itam/bank";

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
  a.atm = await mk(u.vanak, { model_id: atmModel, serial_number: "ATM-1", terminal_id: "10010001", purchase_cost: "45000000000", in_service_date: "2025-06-01", os_name: "Windows 10 IoT Enterprise LTSC 2021" });
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
    expect(a.atm.os_eos_date).toBe("2032-01-13"); // the published end of support of its OS
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

  it("reconciles the year's depreciation with the cost ledger the financial module posts (same first month)", async () => {
    const cc = (await w.o.post(`${w.P}/r/org_unit`, { name: "مرکز هزینهٔ شعب", kind: "cost_center", parent_id: u.bank })).row.id;
    await w.p.am.client.patch(`${w.P}/r/asset/${a.atm.id}`, { cost_center_id: cc });
    // Tir 1404 is the ATM's first charged month («از ماه بعد از بهره‌برداری»); Khordad has no charge
    await w.p.fin.client.post(`${w.P}/financial/capture`, { period: "1404-03" });
    await w.p.fin.client.post(`${w.P}/financial/capture`, { period: "1404-04" });
    const reg = await w.p.am.client.get(`${w.P}/itam/register?fy=1404&branch_id=${u.vanak}`);
    expect(reg.reconciled).toBe(true);
    const atm = reg.rows.find((r: any) => r.id === a.atm.id);
    const month = Math.round((45000000000 * 0.95) / 84);
    expect(Number(atm.ledger)).toBe(month);
    expect(Number(atm.difference)).toBe(Number(atm.charge) - month);
    expect(reg.mismatches).toBeGreaterThanOrEqual(1);
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

// ---------------------------------------------------------------------------------------------------------------
// 1.1 review fixes: pushes held to the API's rules, separation of duties, the keyed custody chain, complete totals

/** A stored row in the shape a Windows app pushes it, with `patch` and a later stamp. */
async function pushed(c: Client, table: string, id: string, patch: Record<string, unknown>): Promise<{ status: string; message?: string }> {
  const r = (await w.e.db.one<Record<string, unknown>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
  const row = { ...JSON.parse(JSON.stringify(r)), ...patch, updated_at: new Date(Date.now() + 5_000).toISOString() };
  return (await c.post(`/sync/push`, { org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: table, id, base_rev: Number(r.rev), row }] })).results[0];
}
async function pushNew(c: Client, table: string, row: Record<string, unknown>): Promise<{ status: string; message?: string }> {
  const id = uuidv7();
  const now = new Date().toISOString();
  return (await c.post(`/sync/push`, { org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity: table, id, base_rev: 0, row: { id, org_id: w.e.org, created_at: now, updated_at: now, ...row } }] })).results[0];
}
const stored = async (table: string, id: string) => (await w.e.db.one<Record<string, any>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
const fresh = async (branch: string, data: Record<string, unknown> = {}) => (await w.p.am.client.post(`${w.P}/r/asset`, { model_id: laptopModel, state: "in_use", branch_id: branch, department_id: branch, purchase_cost: "500000000", purchase_date: "2025-04-01", ...data })).row;

describe("a Windows app's push is held to the same rules", () => {
  it("refuses an officer's push of the attestation's manager or due date", async () => {
    const att = (await w.p.am.client.post(`${w.P}/r/branch_attestation/query`, { filter: { f: "branch_id", op: "eq", v: u.tajrish } })).rows[0];
    expect(att.state).toBe("open");
    const before = await stored("branch_attestation", att.id);
    const r = await pushed(m.tajrish.client, "branch_attestation", att.id, { manager_id: m.tajrish.userId, due_date: "2099-01-01" });
    expect(r.status).toBe("error");
    const after = await stored("branch_attestation", att.id);
    expect(after.manager_id).toBe(before.manager_id);
    await m.tajrish.client.post(`${w.P}/itam/attestations/${att.id}/attest`, { signed_name: "مسئول اموال تجریش", exceptions: [] }, 403);
  });

  it("refuses a pushed change of an approved note's destination and a note issued for another branch", async () => {
    const t = (await m.tajrish.client.post(`${w.P}/r/asset_transfer`, { title: "به ونک", from_branch_id: u.tajrish, to_branch_id: u.vanak })).row;
    await m.tajrish.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t.id, asset_id: a.t1.id });
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "pending_approval" });
    await m.region.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "approved" });
    expect((await pushed(m.tajrish.client, "asset_transfer", t.id, { to_branch_id: u.naqsh })).status).toBe("error");
    expect((await stored("asset_transfer", t.id)).to_branch_id).toBe(u.vanak);
    // the requester stays who asked
    expect((await pushed(m.tajrish.client, "asset_transfer", t.id, { requested_by: m.region.userId })).status).toBe("error");
    // a Tajrish officer cannot push a note issued by Vanak
    const forged = await pushNew(m.tajrish.client, "asset_transfer", { title: "جعلی", from_branch_id: u.vanak, to_branch_id: u.tajrish, state: "draft", requested_by: m.tajrish.userId });
    expect(forged.status).toBe("error");
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "canceled" });
  });
});

describe("separation of duties of a transfer", () => {
  let x1: Record<string, any>;
  let t: Record<string, any>;

  it("lets nobody approve a note they asked for, nor change who asked", async () => {
    x1 = await fresh(u.vanak, { serial_number: "SOD-1" });
    t = (await m.region.client.post(`${w.P}/r/asset_transfer`, { title: "انتقال منطقه", from_branch_id: u.vanak, to_branch_id: u.tajrish })).row;
    expect(t.requested_by).toBe(m.region.userId);
    await m.region.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t.id, asset_id: x1.id });
    await m.region.client.patch(`${w.P}/r/asset_transfer/${t.id}`, { requested_by: m.vanak.userId }, 403);
    await m.region.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "pending_approval" });
    const own = await m.region.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "approved" }, 409);
    expect(own.error.message).toContain("دیگری");
    expect((await stored("asset_transfer", t.id)).state).toBe("pending_approval");
    await w.p.am.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "approved" });
  });

  it("lets nobody sign the receipt of a note they asked for or sent", async () => {
    await m.region.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "in_transit" });
    const items = (await m.tajrish.client.get(`${w.P}/itam/transfers/${t.id}/items`)).items;
    expect((await m.region.client.get(`${w.P}/itam/transfers/${t.id}/items`)).transfer.can_receive).toBe(false);
    await m.region.client.post(`${w.P}/itam/transfers/${t.id}/receive`, { items: [{ id: items[0].id, result: "received" }] }, 403);
    expect((await m.tajrish.client.post(`${w.P}/itam/transfers/${t.id}/receive`, { items: [{ id: items[0].id, result: "received" }] })).state).toBe("received");
  });

  it("keeps an asset in repair off a note (the asset model sends it nowhere from there)", async () => {
    const r = await fresh(u.vanak, { serial_number: "REP-1" });
    await w.p.am.client.post(`${w.P}/r/asset/${r.id}/transition`, { to: "in_repair" });
    const n = (await m.vanak.client.post(`${w.P}/r/asset_transfer`, { title: "به کارگاه", from_branch_id: u.vanak, to_branch_id: u.tehran })).row;
    const refused = await m.vanak.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: n.id, asset_id: r.id }, 409);
    expect(refused.error.message).toContain("تعمیر");
  });
});

describe("the custody chain is the server's", () => {
  it("signs rows with the server's key and refuses a pushed rewrite or a forged row", async () => {
    const assetId = (await w.p.am.client.post(`${w.P}/r/asset/query`, { filter: { f: "serial_number", op: "eq", v: "SOD-1" } })).rows[0].id;
    const chain = await w.p.am.client.get(`${w.P}/itam/assets/${assetId}/custody`);
    expect(chain.verified.ok).toBe(true);
    const last = chain.rows[chain.rows.length - 1];
    expect(last.hash).toMatch(/^k1:[0-9a-f]{64}$/);
    // the receiving officer may change the asset, yet not rewrite its chain
    const r = await pushed(m.tajrish.client, "asset_custody", last.id, { note: "FORGED", event: "transfer_missing" });
    expect(r.status).toBe("error");
    const again = await w.p.am.client.get(`${w.P}/itam/assets/${assetId}/custody`);
    expect(again.verified.ok).toBe(true);
    expect(again.rows[again.rows.length - 1].note).toBe(last.note ?? null);
    // nor delete a row, nor add one that does not continue the stored chain
    expect((await pushed(m.tajrish.client, "asset_custody", last.id, { deleted_at: new Date().toISOString() })).status).toBe("error");
    const forged = await pushNew(m.tajrish.client, "asset_custody", { asset_id: assetId, seq: Number(last.seq) + 5, at: new Date().toISOString(), event: "attested", note: "جعلی", hash: "0".repeat(64) });
    expect(forged.status).toBe("error");
    // a row that continues the chain (the trace of the asset change pushed before it) is chained and signed here,
    // recorded as the member's
    expect((await pushed(m.tajrish.client, "asset", assetId, { assigned_to: m.tajrish.userId })).status).toBe("ok");
    const next = await pushNew(m.tajrish.client, "asset_custody", { asset_id: assetId, seq: Number(last.seq) + 1, at: new Date().toISOString(), event: "assigned", branch_id: u.tajrish, holder_id: m.tajrish.userId, actor_id: m.region.userId, prev_hash: "x", hash: "0".repeat(64) });
    expect(next.status).toBe("ok");
    const signed = await w.p.am.client.get(`${w.P}/itam/assets/${assetId}/custody`);
    expect(signed.verified.ok).toBe(true);
    const row = signed.rows[signed.rows.length - 1];
    expect(row.actor_id).toBe(m.tajrish.userId);
    expect(row.prev_hash).toBe(last.hash);
  });

  it("still verifies a chain written before the key, and breaks on a keyed row rewritten with a client's bare hash", async () => {
    const { custodyDigest } = await import("@server/modules/itam/bank");
    // a 1.0 chain (bare SHA-256) that goes on with keyed rows
    const old = await fresh(u.vanak, { serial_number: "LEGACY-1" });
    const [first] = (await w.p.am.client.get(`${w.P}/itam/assets/${old.id}/custody`)).rows;
    await w.e.db.query(`update sm_asset_custody set hash = $2 where id = $1`, [first.id, custodyDigest("", first)]);
    expect((await w.p.am.client.get(`${w.P}/itam/assets/${old.id}/custody`)).verified.ok).toBe(true);
    await w.p.am.client.patch(`${w.P}/r/asset/${old.id}`, { assigned_to: w.p.req.userId });
    const chain = await w.p.am.client.get(`${w.P}/itam/assets/${old.id}/custody`);
    expect(chain.verified).toEqual({ rows: 2, ok: true, broken_at: null });
    expect(chain.rows[1].hash.startsWith("k1:")).toBe(true);
    // a keyed chain whose row is rewritten with a recomputed bare hash (all a client can compute) is broken
    const x = await fresh(u.vanak, { serial_number: "KEYED-1" });
    await w.p.am.client.patch(`${w.P}/r/asset/${x.id}`, { assigned_to: w.p.req.userId });
    const rows = (await w.p.am.client.get(`${w.P}/itam/assets/${x.id}/custody`)).rows;
    await w.e.db.query(`update sm_asset_custody set hash = $2, note = 'x' where id = $1`, [rows[1].id, custodyDigest(rows[0].hash, { ...rows[1], note: "x" })]);
    expect((await w.p.am.client.get(`${w.P}/itam/assets/${x.id}/custody`)).verified).toEqual({ rows: 2, ok: false, broken_at: 2 });
  });

  it("refuses a pushed rewrite or deletion of a device status period", async () => {
    const periods = (await w.p.am.client.post(`${w.P}/r/device_status_event/query`, { filter: { f: "asset_id", op: "eq", v: a.atm.id }, sort: "from_at" })).rows;
    const closed = periods[0];
    expect(closed.to_at).toBeTruthy();
    expect((await pushed(m.vanak.client, "device_status_event", closed.id, { status: "in_service", minutes: 0, to_at: closed.from_at })).status).toBe("error");
    expect((await pushed(m.vanak.client, "device_status_event", closed.id, { deleted_at: new Date().toISOString() })).status).toBe("error");
    const after = await stored("device_status_event", closed.id);
    expect(after.minutes).toBe(closed.minutes);
    expect(after.deleted_at).toBeNull();
    // closing the open period is the one change a push may make; the minutes are computed here
    const open = periods[periods.length - 1];
    expect(open.to_at).toBeFalsy();
    const end = new Date(Date.now() - 1000);
    // ...once the device itself left that status (the app pushes the device's change before its period), and when it
    // did as the server decided it (a member without a registered Windows app: the server stamps the change)
    expect((await pushed(m.vanak.client, "asset", a.atm.id, { device_status: "in_service", device_status_at: end.toISOString() })).status).toBe("ok");
    expect((await pushed(m.vanak.client, "device_status_event", open.id, { to_at: end.toISOString(), minutes: 99999 })).status).toBe("ok");
    const changed = Date.parse((await stored("asset", a.atm.id)).device_status_at);
    expect(changed).toBeGreaterThanOrEqual(end.getTime());
    const closed2 = await stored("device_status_event", open.id);
    expect(Date.parse(closed2.to_at)).toBe(changed);
    expect(closed2.minutes).toBe(Math.max(0, Math.round((changed - Date.parse(open.from_at)) / 60_000)));
  });
});

describe("a wipe needs a second and a third person", () => {
  it("issues no certificate without a distinct witness, and only a third approver reviews it", async () => {
    const x = await fresh(u.naqsh, { serial_number: "WIPE-SOD" });
    const order = (await w.p.am.client.post(`${w.P}/r/disposal_order`, { title: "اسقاط با شاهد", method: "destroy" })).row;
    const item = (await w.p.am.client.post(`${w.P}/r/disposal_item`, { order_id: order.id, asset_id: x.id })).row;
    const evidence = { sanitization_method: "purge", sanitized_at: new Date().toISOString(), sanitized_by: w.p.am.userId, certificate_no: "WIPE-SOD-1" };
    // no witness: no certificate
    expect((await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, evidence)).row.certificate_hash).toBeFalsy();
    // the performer is not their own witness
    await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { witness_id: w.p.am.userId }, 400);
    const done = (await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { witness_id: w.p.agent.userId })).row;
    expect(done.certificate_hash).toMatch(/^[0-9a-f]{64}$/);
    // the performer does not review their own wipe
    await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { verified: true }, 403);
    await w.p.am.client.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "approved" });
    const early = await w.p.am.client.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "completed" }, 409);
    expect(early.error.message).toContain("گواهی");
    expect((await w.o.patch(`${w.P}/r/disposal_item/${item.id}`, { verified: true })).row.verified).toBe(true);
    await w.p.am.client.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "completed" });
    expect((await w.p.am.client.get(`${w.P}/r/asset/${x.id}`)).row.state).toBe("disposed");
  });
});

describe("totals over every row", () => {
  it("keeps a retired asset on the register until disposal, as the cost ledger does", async () => {
    const x = await fresh(u.tajrish, { serial_number: "RET-1", purchase_date: "2025-03-01", in_service_date: "2025-03-01" });
    const rowOf = async () => (await w.p.am.client.get(`${w.P}/itam/register?fy=1405&branch_id=${u.tajrish}`)).rows.find((r: any) => r.id === x.id);
    const before = await rowOf();
    await w.p.am.client.post(`${w.P}/r/asset/${x.id}/transition`, { to: "retired", data: { retire_reason: "در انتظار اسقاط" } });
    const after = await rowOf();
    expect(after.state).toBe("retired");
    expect(after.end).toBeNull();
    expect(after.charge).toBe(before.charge);
    expect(after.disposals).toBe("0");
  });

  it("computes the register, its reconciliation and the fleet over every row and says when the list is cut", async () => {
    const reg = await w.p.am.client.get(`${w.P}/itam/register?fy=1404`);
    const fleet = await w.p.am.client.get(`${w.P}/itam/fleet`);
    expect(reg.truncated).toBe(false);
    expect(fleet.truncated).toBe(false);
    const saved = { ...PAGING };
    try {
      Object.assign(PAGING, { size: 1, registerRows: 1, fleetRows: 1 });
      const small = await w.p.am.client.get(`${w.P}/itam/register?fy=1404`);
      expect(small.totals).toEqual(reg.totals);
      expect(small.mismatches).toBe(reg.mismatches);
      expect(small.total_rows).toBe(reg.rows.length);
      expect(reg.rows.length).toBeGreaterThan(1);
      expect(small.rows).toHaveLength(1);
      expect(small.truncated).toBe(true);
      const f = await w.p.am.client.get(`${w.P}/itam/fleet`);
      expect(f.total).toBe(fleet.total);
      expect(f.status).toEqual(fleet.status);
      expect(f.contracts).toEqual(fleet.contracts);
      expect(f.devices).toHaveLength(1);
      expect(f.truncated).toBe(true);
    } finally {
      Object.assign(PAGING, saved);
    }
  });
});

// 1.1-beta re-verification: the variants of the review findings that stayed open
describe("re-verified: pushes and separation of duties hold for new rows too", () => {
  it("lets no branch officer open an attestation naming themselves, online or pushed", async () => {
    await m.tajrish.client.post(`${w.P}/r/branch_attestation`, { title: "تأیید خودم", branch_id: u.tajrish, manager_id: m.tajrish.userId }, 403);
    expect((await pushNew(m.tajrish.client, "branch_attestation", { title: "تأیید خودم", branch_id: u.tajrish, manager_id: m.tajrish.userId, state: "open" })).status).toBe("error");
    const mine = await w.e.db.query(`select 1 from sm_branch_attestations where manager_id = $1`, [m.tajrish.userId]);
    expect(mine.length).toBe(0);
  });

  it("starts every member's note as a draft and keeps an approved note's destination stockroom", async () => {
    expect((await pushNew(m.tajrish.client, "asset_transfer", { title: "تأییدشده از پیش", from_branch_id: u.tajrish, to_branch_id: u.vanak, state: "approved", requested_by: m.tajrish.userId })).status).toBe("error");
    await m.tajrish.client.post(`${w.P}/r/asset_transfer`, { title: "تأییدشده از پیش", from_branch_id: u.tajrish, to_branch_id: u.vanak, state: "approved" }, 409);
    const t = (await m.tajrish.client.post(`${w.P}/r/asset_transfer`, { title: "به ونک با انبار", from_branch_id: u.tajrish, to_branch_id: u.vanak })).row;
    await m.tajrish.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t.id, asset_id: a.t1.id });
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "pending_approval" });
    await m.region.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "approved" });
    const room = (await w.p.am.client.post(`${w.P}/r/stockroom/query`, {})).rows[0];
    if (room) expect((await pushed(m.tajrish.client, "asset_transfer", t.id, { to_stockroom_id: room.id })).status).toBe("error");
    // the dispatch is the web version's: a push does not send the note (nor name, or leave out, who sent it)
    expect((await pushed(w.p.am.client, "asset_transfer", t.id, { state: "in_transit", dispatched_by: null, dispatched_at: new Date().toISOString() })).status).toBe("error");
    const after = await stored("asset_transfer", t.id);
    expect(after.state).toBe("approved");
    expect(after.dispatched_by).toBeNull();
    await m.tajrish.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "canceled" });
  });

  it("lets nobody approve, through the approvals service, a note they issued for someone else", async () => {
    const x = await fresh(u.vanak, { serial_number: "SOD-ISSUER" });
    const t = (await w.p.am.client.post(`${w.P}/r/asset_transfer`, { title: "به نام دیگری", from_branch_id: u.vanak, to_branch_id: u.tajrish, requested_by: m.vanak.userId })).row;
    expect(t.requested_by).toBe(m.vanak.userId);
    await w.p.am.client.post(`${w.P}/r/asset_transfer_item`, { transfer_id: t.id, asset_id: x.id });
    await w.p.am.client.post(`${w.P}/r/asset_transfer/${t.id}/transition`, { to: "pending_approval" });
    const mine = (await w.p.am.client.get(`${w.P}/approvals/mine`)).approvals.filter((y: any) => y.record_id === t.id);
    expect(mine).toEqual([]);
    expect(await w.e.db.one(`select 1 from sm_approvals where record_id = $1 and approver_id = $2`, [t.id, w.p.am.userId])).toBeNull();
    expect((await stored("asset_transfer", t.id)).state).toBe("pending_approval");
  });

  it("takes no pushed custody row that matches no change of the asset, and no outage shortened without one", async () => {
    const x = await fresh(u.tajrish, { serial_number: "CUSTODY-FORGE" });
    const chain = (await w.p.am.client.get(`${w.P}/itam/assets/${x.id}/custody`)).rows;
    const last = chain[chain.length - 1];
    const seq = Number(last.seq);
    expect((await pushNew(m.tajrish.client, "asset_custody", { asset_id: x.id, seq: seq + 1, at: new Date().toISOString(), event: "received", branch_id: u.tajrish, from_branch_id: u.naqsh, reference: "TRF-FAKE", note: "رسید جعلی" })).status).toBe("error");
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    expect((await pushNew(m.tajrish.client, "asset_custody", { asset_id: x.id, seq: seq + 1, at: old, event: "attested", branch_id: u.tajrish, note: "امضا: رئیس" })).status).toBe("error");
    expect((await w.p.am.client.get(`${w.P}/itam/assets/${x.id}/custody`)).rows.map((r: any) => r.event)).toEqual(chain.map((r: any) => r.event));
    // an ATM offline for three days: a push closing the period after one minute, the device still offline, is refused
    const atm = await fresh(u.vanak, { model_id: atmModel, serial_number: "ATM-OUTAGE", terminal_id: "10010077" });
    await m.vanak.client.post(`${w.P}/itam/fleet/${atm.id}/status`, { status: "offline" });
    const periods = (await w.p.am.client.post(`${w.P}/r/device_status_event/query`, { filter: { f: "asset_id", op: "eq", v: atm.id }, sort: "from_at" })).rows;
    const open = periods[periods.length - 1];
    expect(open.status).toBe("offline");
    const from = new Date(Date.now() - 3 * 86_400_000);
    await w.e.db.query(`update sm_device_status_events set from_at = $2 where id = $1`, [open.id, from.toISOString()]);
    expect((await pushed(m.vanak.client, "device_status_event", open.id, { to_at: new Date(from.getTime() + 60_000).toISOString() })).status).toBe("error");
    const kept = await stored("device_status_event", open.id);
    expect(kept.to_at).toBeNull();
    expect(kept.minutes).toBeNull();
  });

  it("keeps the review of a wipe from whoever recorded its evidence, and a pushed fingerprint is not taken", async () => {
    const x = await fresh(u.naqsh, { serial_number: "WIPE-ONE-PERSON" });
    const order = (await w.p.am.client.post(`${w.P}/r/disposal_order`, { title: "اسقاط یک‌نفره", method: "destroy" })).row;
    const item = (await w.p.am.client.post(`${w.P}/r/disposal_item`, { order_id: order.id, asset_id: x.id })).row;
    const done = (await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { sanitization_method: "purge", sanitized_at: new Date().toISOString(), certificate_no: "WIPE-ONE-1", sanitized_by: w.p.agent.userId, witness_id: w.p.req.userId })).row;
    expect(done.certificate_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(done.evidence_by).toBe(w.p.am.userId);
    // am named two other people, yet recorded it: am does not review it
    await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { verified: true }, 403);
    expect((await w.o.patch(`${w.P}/r/disposal_item/${item.id}`, { verified: true })).row.verified).toBe(true);
    // a pushed item with a fingerprint of the app's own: the certificate is issued here only
    const y = await fresh(u.naqsh, { serial_number: "WIPE-PUSH" });
    const r = await pushNew(w.p.am.client, "disposal_item", { order_id: order.id, asset_id: y.id, sanitization_method: "purge", sanitized_at: new Date().toISOString(), certificate_no: "WIPE-PUSH-1", sanitized_by: w.p.am.userId, certificate_hash: "a".repeat(64), certificate_issued_at: new Date().toISOString(), verified: false });
    if (r.status === "ok") {
      const row = await w.e.db.one<Record<string, any>>(`select certificate_hash from sm_disposal_items where asset_id = $1`, [y.id]);
      expect(row?.certificate_hash ?? null).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 1.1: what a Windows app pushes of its asset changes — the times are the server's to decide (within the push's bounds)
// and a custody segment is judged and chained as a whole, whatever order its rows come in

type Wire = { entity: string; id: string; base_rev: number; row: Record<string, unknown> };
const isoAt = (ms: number) => new Date(ms).toISOString();
/** A stored row as a Windows app pushes it back, with `patch` and a later stamp. */
async function asWire(table: string, id: string, patch: Record<string, unknown> = {}): Promise<Wire> {
  const r = (await w.e.db.one<Record<string, unknown>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
  return { entity: table, id, base_rev: Number(r.rev), row: { ...JSON.parse(JSON.stringify(r)), ...patch, updated_at: isoAt(Date.now() + 5_000) } };
}
/** A row the app made. */
function made(table: string, row: Record<string, unknown>): Wire {
  const id = String(row.id ?? uuidv7());
  const now = isoAt(Date.now());
  return { entity: table, id, base_rev: 0, row: { org_id: w.e.org, created_at: now, updated_at: now, ...row, id } };
}
/** One push of several rows (any order); the results by row id. */
async function pushAll(c: Client, aggs: Wire[]): Promise<Map<string, { status: string; message?: string }>> {
  const r = await c.post(`/sync/push`, { org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: aggs.map((x) => ({ ...x, children: {} })) });
  return new Map((r.results as { id: string; status: string; message?: string }[]).map((x) => [x.id, x]));
}
const statuses = (m: Map<string, { status: string }>) => [...m.values()].map((x) => x.status);
const periodsOf = async (id: string) => (await w.p.am.client.post(`${w.P}/r/device_status_event/query`, { filter: { f: "asset_id", op: "eq", v: id }, sort: "from_at", size: 50 })).rows as Record<string, any>[];

describe("a Windows app's device status times are the server's", () => {
  let app: { client: Client; userId: string };
  let device = "";
  let seq = 0;
  const lastPull = (ms: number) => w.e.db.query(`update sm_devices set last_pull_at = $2 where id = $1`, [device, isoAt(ms)]);
  /** A Vanak ATM whose stored history is `statuses` from `starts` on (the last one open): as if recorded back then. */
  async function atmWith(statuses: string[], starts: number[]): Promise<{ id: string; periods: Record<string, any>[] }> {
    const atm = await fresh(u.vanak, { model_id: atmModel, serial_number: `ATM-T${++seq}`, terminal_id: `1001${String(500 + seq)}` });
    for (const st of statuses.slice(1)) await m.vanak.client.post(`${w.P}/itam/fleet/${atm.id}/status`, { status: st });
    const periods = await periodsOf(atm.id);
    expect(periods.map((x) => x.status)).toEqual(statuses);
    for (let i = 0; i < periods.length; i++) {
      const to = i + 1 < periods.length ? isoAt(starts[i + 1]) : null;
      await w.e.db.query(`update sm_device_status_events set from_at = $2, to_at = $3, minutes = $4 where id = $1`, [periods[i].id, isoAt(starts[i]), to, to ? Math.round((starts[i + 1] - starts[i]) / 60_000) : null]);
    }
    await w.e.db.query(`update sm_assets set device_status_at = $2 where id = $1`, [atm.id, isoAt(starts[starts.length - 1])]);
    return { id: atm.id, periods: await periodsOf(atm.id) };
  }

  beforeAll(async () => {
    // a Vanak officer whose Windows app is registered (its contact with the server bounds what it may date)
    app = await w.e.member("member", "vanak-app@bank.example");
    await w.o.put(`${w.P}/access/members/${app.userId}`, { roles: ["branch_asset_officer"], persona: "agent", org_unit_id: u.vanak });
    device = (await app.client.post(`/sync/register`, { org_id: w.e.org, name: "رایانهٔ شعبهٔ ونک", platform: "windows" })).device_id;
  });

  it("dates an online app's backdated change after its last contact: a three-day outage stays three days", async () => {
    const began = Date.now() - 3 * 86_400_000;
    const atm = await atmWith(["in_service", "offline"], [began - 86_400_000, began]);
    const open = atm.periods[1];
    // the app synced seconds ago, and now says the device came back a minute after the outage began
    await lastPull(Date.now() - 5_000);
    const claimed = isoAt(began + 60_000);
    const next = made("device_status_event", { asset_id: atm.id, status: "in_service", from_at: claimed });
    const res = await pushAll(app.client, [next, await asWire("device_status_event", open.id, { to_at: claimed, minutes: 1 }), await asWire("asset", atm.id, { device_status: "in_service", device_status_at: claimed })]);
    expect(statuses(res)).toEqual(["ok", "ok", "ok"]);
    const at = Date.parse((await stored("asset", atm.id)).device_status_at);
    expect(at).toBeGreaterThanOrEqual(Date.now() - 5_000 - CONTACT_SLACK_MS - 60_000);
    const closed = await stored("device_status_event", open.id);
    expect(Date.parse(closed.to_at)).toBe(at);
    expect(closed.minutes).toBeGreaterThan(3 * 24 * 60 - 10);
    expect(Date.parse((await stored("device_status_event", next.id)).from_at)).toBe(at);
  });

  it("keeps an offline app's times within the push's bounds — a change and back included — and none in the future", async () => {
    // in service for four hours; the app's last sync two hours ago; offline since, it recorded «بدون وجه نقد» an hour
    // ago and «در سرویس» again half an hour ago
    const atm = await atmWith(["in_service"], [Date.now() - 4 * 3_600_000]);
    const open = atm.periods[0];
    await lastPull(Date.now() - 2 * 3_600_000);
    const out = Date.now() - 3_600_000;
    const back = Date.now() - 1_800_000;
    const p1 = made("device_status_event", { asset_id: atm.id, status: "out_of_cash", from_at: isoAt(out), to_at: isoAt(back), minutes: 30 });
    const p2 = made("device_status_event", { asset_id: atm.id, status: "in_service", from_at: isoAt(back) });
    const res = await pushAll(app.client, [p2, await asWire("asset", atm.id, { device_status: "in_service", device_status_at: isoAt(back) }), p1, await asWire("device_status_event", open.id, { to_at: isoAt(out), minutes: 180 })]);
    expect(statuses(res)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(Date.parse((await stored("asset", atm.id)).device_status_at)).toBe(back);
    expect(Date.parse((await stored("device_status_event", open.id)).to_at)).toBe(out);
    const cash = await stored("device_status_event", p1.id);
    expect([Date.parse(cash.from_at), Date.parse(cash.to_at), cash.minutes]).toEqual([out, back, 30]);
    const now = await stored("device_status_event", p2.id);
    expect([Date.parse(now.from_at), now.to_at]).toEqual([back, null]);
    // a time after the push is the push's own
    const tomorrow = isoAt(Date.now() + 86_400_000);
    const later = made("device_status_event", { asset_id: atm.id, status: "maintenance", from_at: tomorrow });
    const before = Date.now();
    const res2 = await pushAll(app.client, [await asWire("asset", atm.id, { device_status: "maintenance", device_status_at: tomorrow }), later, await asWire("device_status_event", p2.id, { to_at: tomorrow })]);
    expect(statuses(res2)).toEqual(["ok", "ok", "ok"]);
    const at = Date.parse((await stored("asset", atm.id)).device_status_at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(Date.parse((await stored("device_status_event", later.id)).from_at)).toBe(at);
    expect(Date.parse((await stored("device_status_event", p2.id)).to_at)).toBe(at);
  });

  it("stamps the change of a member without a registered app, and takes no period without the device's change", async () => {
    const atm = await atmWith(["in_service", "out_of_service"], [Date.now() - 3 * 86_400_000, Date.now() - 2 * 86_400_000]);
    const open = atm.periods[1];
    // a period of another status while the device stays as it is: refused (it is the trace of no change)
    const stray = made("device_status_event", { asset_id: atm.id, status: "offline", from_at: isoAt(Date.now() - 86_400_000) });
    expect(statuses(await pushAll(app.client, [stray, await asWire("device_status_event", open.id, { to_at: isoAt(Date.now() - 86_400_000) })]))).toEqual(["error", "error"]);
    expect((await stored("device_status_event", open.id)).to_at).toBeNull();
    // m.vanak has no Windows app registered: whatever time comes, the server's
    const before = Date.now();
    expect((await pushed(m.vanak.client, "asset", atm.id, { device_status: "in_service", device_status_at: isoAt(Date.now() - 86_400_000) })).status).toBe("ok");
    expect(Date.parse((await stored("asset", atm.id)).device_status_at)).toBeGreaterThanOrEqual(before);
    expect((await pushed(m.vanak.client, "device_status_event", open.id, { to_at: isoAt(Date.now() - 86_400_000) })).status).toBe("ok");
    expect(Date.parse((await stored("device_status_event", open.id)).to_at)).toBeGreaterThanOrEqual(before);
  });

  it("decides the time of a status cleared on the app too: an outage is not shortened by clearing it", async () => {
    const began = Date.now() - 2 * 86_400_000;
    const atm = await atmWith(["in_service", "offline"], [began - 86_400_000, began]);
    const open = atm.periods[1];
    await lastPull(Date.now() - 5_000);
    // the app clears the status and says it was cleared a minute after the outage began (and the outage ended then)
    const claimed = isoAt(began + 60_000);
    const res = await pushAll(app.client, [await asWire("device_status_event", open.id, { to_at: claimed, minutes: 1 }), await asWire("asset", atm.id, { device_status: null, device_status_at: claimed })]);
    expect(statuses(res)).toEqual(["ok", "ok"]);
    const a = await stored("asset", atm.id);
    expect(a.device_status).toBeNull();
    const at = Date.parse(a.device_status_at);
    expect(at).toBeGreaterThanOrEqual(Date.now() - 5_000 - CONTACT_SLACK_MS - 60_000);
    const closed = await stored("device_status_event", open.id);
    expect(Date.parse(closed.to_at)).toBe(at);
    expect(closed.minutes).toBeGreaterThan(2 * 24 * 60 - 10);
    // an offline app's change and clear in one push: every new period closed, the last when the status was cleared
    const atm2 = await atmWith(["in_service"], [Date.now() - 4 * 3_600_000]);
    await lastPull(Date.now() - 2 * 3_600_000);
    const out = Date.now() - 3_600_000;
    const cleared = Date.now() - 1_800_000;
    const p1 = made("device_status_event", { asset_id: atm2.id, status: "maintenance", from_at: isoAt(out), to_at: isoAt(cleared), minutes: 30 });
    const res2 = await pushAll(app.client, [p1, await asWire("device_status_event", atm2.periods[0].id, { to_at: isoAt(out), minutes: 180 }), await asWire("asset", atm2.id, { device_status: null, device_status_at: isoAt(cleared) })]);
    expect(statuses(res2)).toEqual(["ok", "ok", "ok"]);
    expect(Date.parse((await stored("asset", atm2.id)).device_status_at)).toBe(cleared);
    expect(Date.parse((await stored("device_status_event", atm2.periods[0].id)).to_at)).toBe(out);
    const m1 = await stored("device_status_event", p1.id);
    expect([Date.parse(m1.from_at), Date.parse(m1.to_at), m1.minutes]).toEqual([out, cleared, 30]);
    expect(await periodsOf(atm2.id).then((ps) => ps.filter((x) => !x.to_at))).toEqual([]);
  });
});

describe("a Windows app's custody segment", () => {
  const chainOf = async (id: string) => w.p.am.client.get(`${w.P}/itam/assets/${id}/custody`);
  const move = (asset: string, seq: number, from: string, to: string, at: number) => made("asset_custody", { asset_id: asset, seq, at: isoAt(at), event: "branch_changed", branch_id: to, from_branch_id: from, prev_hash: "x", hash: "0".repeat(64) });

  it("chains A→B→A in event order, signed here, whatever order its rows come in", async () => {
    const x = await fresh(u.vanak, { serial_number: "ABA-1" });
    const before = await chainOf(x.id);
    const last = before.rows[before.rows.length - 1];
    const n = Number(last.seq);
    const t = Date.now();
    const toB = move(x.id, n + 1, u.vanak, u.tajrish, t - 60_000);
    const backA = move(x.id, n + 2, u.tajrish, u.vanak, t - 30_000);
    // one push: the move back first, then the move away, then the asset (back where it was; only its version moved)
    const res = await pushAll(w.p.am.client, [backA, toB, await asWire("asset", x.id)]);
    expect(statuses(res)).toEqual(["ok", "ok", "ok"]);
    const after = await chainOf(x.id);
    expect(after.verified).toEqual({ rows: before.rows.length + 2, ok: true, broken_at: null });
    const [r1, r2] = after.rows.slice(-2);
    expect([r1.id, r1.seq, r1.branch_id, r1.from_branch_id]).toEqual([toB.id, n + 1, u.tajrish, u.vanak]);
    expect([r2.id, r2.seq, r2.branch_id, r2.from_branch_id]).toEqual([backA.id, n + 2, u.vanak, u.tajrish]);
    expect([r1.prev_hash, r2.prev_hash]).toEqual([last.hash, r1.hash]);
    for (const r of [r1, r2]) {
      expect(r.hash).toMatch(/^k1:[0-9a-f]{64}$/);
      expect(r.actor_id).toBe(w.p.am.userId);
    }
    expect(Date.parse(r1.at)).toBeLessThanOrEqual(Date.parse(r2.at));
    expect((await stored("asset", x.id)).branch_id).toBe(u.vanak);
  });

  it("waits for a segment that comes split or with a gap, and takes it whole once complete", async () => {
    const x = await fresh(u.vanak, { serial_number: "ABA-2" });
    const before = await chainOf(x.id);
    const n = Number(before.rows[before.rows.length - 1].seq);
    const t = Date.now();
    const toB = move(x.id, n + 1, u.vanak, u.tajrish, t - 60_000);
    const backA = move(x.id, n + 2, u.tajrish, u.vanak, t - 30_000);
    // the move back alone: a gap before it; the move away alone: the chain would say Tajrish while the asset is in Vanak
    expect(statuses(await pushAll(w.p.am.client, [backA]))).toEqual(["error"]);
    expect(statuses(await pushAll(w.p.am.client, [toB]))).toEqual(["error"]);
    expect((await chainOf(x.id)).rows).toHaveLength(before.rows.length);
    // the app sends them again together (its outbox keeps them): taken in order
    expect(statuses(await pushAll(w.p.am.client, [backA, toB]))).toEqual(["ok", "ok"]);
    const after = await chainOf(x.id);
    expect(after.verified.ok).toBe(true);
    expect(after.rows.slice(-2).map((r: any) => r.id)).toEqual([toB.id, backA.id]);
  });

  it("takes no branch move, even there and back, from someone who does not move assets between branches", async () => {
    const x = await fresh(u.vanak, { serial_number: "ABA-3" });
    const before = await chainOf(x.id);
    const n = Number(before.rows[before.rows.length - 1].seq);
    const t = Date.now();
    const res = await pushAll(m.vanak.client, [move(x.id, n + 1, u.vanak, u.tajrish, t - 60_000), move(x.id, n + 2, u.tajrish, u.vanak, t - 30_000)]);
    expect(statuses(res)).toEqual(["error", "error"]);
    expect((await chainOf(x.id)).rows).toHaveLength(before.rows.length);
  });

  it("numbers the segment of an app behind the server's chain after it, and keeps every link verifiable", async () => {
    const x = await fresh(u.vanak, { serial_number: "ABA-4" });
    const seen = await chainOf(x.id);
    const n = Number(seen.rows[seen.rows.length - 1].seq);
    // meanwhile the web version records an assignment (the app has not pulled it)
    await w.p.am.client.patch(`${w.P}/r/asset/${x.id}`, { assigned_to: w.p.req.userId });
    await w.p.am.client.patch(`${w.P}/r/asset/${x.id}`, { assigned_to: null });
    const t = Date.now();
    const toB = move(x.id, n + 1, u.vanak, u.tajrish, t - 60_000);
    const backA = move(x.id, n + 2, u.tajrish, u.vanak, t - 30_000);
    expect(statuses(await pushAll(w.p.am.client, [toB, backA]))).toEqual(["ok", "ok"]);
    const after = await chainOf(x.id);
    expect(after.verified.ok).toBe(true);
    expect(after.rows.map((r: any) => r.event)).toEqual([...seen.rows.map((r: any) => r.event), "assigned", "returned", "branch_changed", "branch_changed"]);
    expect(after.rows.slice(-2).map((r: any) => Number(r.seq))).toEqual([n + 3, n + 4]);
    // the app's own times stay in order after the server's rows
    const [ret, r1] = after.rows.slice(-3);
    expect(Date.parse(r1.at)).toBeGreaterThanOrEqual(Date.parse(ret.at));
  });
});

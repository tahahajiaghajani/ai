// Regressions of the ITAM, supplier and financial review: a confidential contract's ledger entries are read only by
// its readers; only the holder signs an acknowledgement; a contract is activated by its approval while the rule is in
// force (never after a rejection); a requisition keeps what its approvers approved and is never approved from draft
// or by its own requester; disposal orders take assets only before approval; a goods receipt posts at most what is
// left of each order line (dated on the organisation's calendar); audits count and mark only what the counter may read
// and change; book values move on with the Jalali month and disposal writes off the schedule's value; chargeback
// credits equal its debits; one automatic requisition per stock rule while it is on its way; and the request-item
// panel tells who may hand over.
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { seedRequestDefaults } from "@server/modules/request";
import { checkStockRules, itamSweep, seedItamDefaults } from "@server/modules/itam";
import { capture } from "@server/modules/financial";
import { liveRows } from "@server/modules/incident/common";
import { transitionIn, updateIn } from "@server/engine";
import { fiscalYearOf, periodKeyOf } from "@shared/financial/logic";
import { addDays, dateISOIn, todayISO } from "@shared/jalali";

let w: ItamWorld;
type Row = Record<string, any>;
const today = () => todayISO("Asia/Tehran");
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 200 })).rows as Row[];
/** the status a request ended with (the client throws on anything but the expected status) */
const code = (p: Promise<unknown>) => p.then(() => 200, (e: Error) => Number(/→ (\d{3})/.exec(String(e.message))?.[1] ?? 0));
const sysWrite = (table: string, id: string, data: Row) => w.sys.write((tx) => updateIn(tx, w.sys, table, id, data, { trusted: true, keepVersion: true }));
const sysMove = (table: string, id: string, to: string, data: Row = {}) => w.sys.write((tx) => transitionIn(tx, w.sys, table, id, to, data, { trusted: true }));
let sup = "";
let cc = "";
let laptop = "";
let monitor = "";
let central = "";

beforeAll(async () => {
  w = await itamWorld();
  await seedRequestDefaults(w.e.cfg, w.e.org);
  await seedItamDefaults(w.e.cfg, w.e.org, { force: true });
  await w.drain();
  sup = await w.idOf("supplier", "name", "شرکت پشتیبانی شبکهٔ پارس (نمونه)");
  cc = await w.idOf("org_unit", "code", "CC-IT-INF");
  laptop = await w.idOf("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
  monitor = await w.idOf("asset_model", "name", "سامسونگ ۲۴ اینچ S24C360");
  central = await w.idOf("stockroom", "code", "WH-01");
}, 180_000);

describe("contracts and the ledger", () => {
  it("keeps the ledger entries of a confidential contract to the contract's readers", async () => {
    // the asset manager's confidential contract (empty access list): not even the organisation's owner reads it
    const c = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "قرارداد محرمانهٔ نگهداری", supplier_id: sup, contract_type: "support", start_date: addDays(today(), -30), end_date: addDays(today(), 335), confidential: true, owner_id: w.p.am.userId })).row;
    await sysWrite("contract", c.id, { annual_value: "12000000000" });
    await sysMove("contract", c.id, "active");
    const r = await capture(w.sys, periodKeyOf(today()));
    expect(r.by_source.contract).toBeGreaterThanOrEqual(1);
    const mine = await liveRows(w.sys.db, w.sys, "cost_entry", { f: "contract_id", op: "eq", v: c.id });
    expect(mine).toHaveLength(1);
    await w.p.fin.client.get(`${w.P}/r/contract/${c.id}`, 404);
    for (const who of [w.p.fin, w.p.auditor]) {
      expect((await who.client.post(`${w.P}/r/cost_entry/query`, { filter: { f: "contract_id", op: "eq", v: c.id } })).rows).toHaveLength(0);
      await who.client.get(`${w.P}/r/cost_entry/${mine[0].id}`, 404);
    }
  });

  it("activates a contract only through its approval while the rule is in force, never after a rejection", async () => {
    await w.o.put(`${w.P}/access/members/${w.p.am.userId}`, { manager_id: w.p.fin.userId });
    const c = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "قرارداد سی میلیاردی", supplier_id: sup, contract_type: "support", start_date: today(), end_date: addDays(today(), 365) })).row;
    expect(await code(w.p.am.client.post(`${w.P}/r/contract/${c.id}/transition`, { to: "active" }))).toBe(409);
    await w.p.am.client.post(`${w.P}/r/contract/${c.id}/transition`, { to: "pending_approval" });
    const a = (await w.p.fin.client.get(`${w.P}/approvals/mine`)).approvals.find((x: Row) => x.record_id === c.id);
    await w.p.fin.client.post(`${w.P}/approvals/${a.id}/decide`, { decision: "rejected", comment: "مبلغ بیش از بودجه است" });
    expect((await one("contract", c.id)).state).toBe("negotiation");
    expect(await code(w.p.am.client.post(`${w.P}/r/contract/${c.id}/transition`, { to: "active" }))).toBe(409);
    expect((await one("contract", c.id)).state).toBe("negotiation");
  });
});

describe("contract approval rules that do not apply", () => {
  it("leaves direct activation to contracts no active rule would ask approval for", async () => {
    const seeded = await w.idOf("approval_rule", "name", "تأیید قرارداد");
    await w.o.patch(`${w.P}/r/approval_rule/${seeded}`, { active: false });
    const rule = (await w.o.post(`${w.P}/r/approval_rule`, { table_key: "contract", name: "تأیید قراردادهای ابری", active: true, mode: "sequential", condition: { and: [{ f: "state", op: "eq", v: "pending_approval" }, { f: "contract_type", op: "eq", v: "cloud" }] }, levels: [{ name: "مدیر", sources: [{ kind: "manager" }], rule: "any" }] })).row;
    try {
      const support = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "پشتیبانی چاپگرها", supplier_id: sup, contract_type: "support", start_date: today(), end_date: addDays(today(), 365) })).row;
      expect((await w.p.am.client.post(`${w.P}/r/contract/${support.id}/transition`, { to: "active" })).row.state).toBe("active");
      const cloud = (await w.p.am.client.post(`${w.P}/r/contract`, { name: "میزبانی ابری تازه", supplier_id: sup, contract_type: "cloud", start_date: today(), end_date: addDays(today(), 365) })).row;
      expect(await code(w.p.am.client.post(`${w.P}/r/contract/${cloud.id}/transition`, { to: "active" }))).toBe(409);
    } finally {
      await w.o.patch(`${w.P}/r/approval_rule/${rule.id}`, { active: false });
      await w.o.patch(`${w.P}/r/approval_rule/${seeded}`, { active: true });
    }
  });
});

describe("acknowledgements", () => {
  it("lets only the holder accept or decline, and sign only with that decision", async () => {
    const a = await w.asset({ serial_number: "RF-ACK-1" });
    await w.drain();
    await w.p.am.client.post(`${w.P}/itam/assets/${a.id}/checkout`, { assigned_to: w.p.req.userId });
    const [ack] = await q("asset_acknowledgement", { and: [{ f: "asset_id", op: "eq", v: a.id }, { f: "state", op: "eq", v: "pending" }] });
    expect(ack).toBeTruthy();
    expect(await code(w.p.am.client.post(`${w.P}/r/asset_acknowledgement/${ack.id}/transition`, { to: "accepted", data: { signature_name: "درخواست‌دهندهٔ آزمایشی" } }))).toBe(403);
    expect(await code(w.p.am.client.patch(`${w.P}/r/asset_acknowledgement/${ack.id}`, { signature_name: "امضای جعلی" }))).toBe(403);
    expect((await one("asset", a.id)).ack_state).toBe("pending");
    await w.p.req.client.post(`${w.P}/itam/acks/${ack.id}/decide`, { decision: "accept", signature_name: "درخواست‌دهندهٔ آزمایشی" });
    // a decided acknowledgement is closed (locked) for everyone
    expect(await code(w.p.am.client.patch(`${w.P}/r/asset_acknowledgement/${ack.id}`, { signature_name: "بازنویسی" }))).toBeGreaterThanOrEqual(400);
    expect((await one("asset_acknowledgement", ack.id)).signature_name).toBe("درخواست‌دهندهٔ آزمایشی");
    expect((await one("asset", a.id)).ack_state).toBe("accepted");
  });
});

describe("procurement and disposal", () => {
  it("keeps what approvers approve: lines only in draft, never approved from draft or by its own requester", async () => {
    const prq = (await w.p.am.client.post(`${w.P}/r/purchase_requisition`, { title: "نمایشگرهای تیم" })).row;
    await w.p.am.client.post(`${w.P}/r/purchase_requisition_line`, { requisition_id: prq.id, model_id: monitor, quantity: 2 });
    // the asset manager holds procurement approval, but not for their own requisition and not from draft
    expect(await code(w.p.am.client.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "approved" }))).toBeGreaterThanOrEqual(400);
    await w.p.am.client.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "pending_approval" });
    expect(await code(w.p.am.client.post(`${w.P}/r/purchase_requisition_line`, { requisition_id: prq.id, model_id: monitor, quantity: 40 }))).toBe(409);
    expect(await code(w.p.am.client.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "approved" }))).toBe(409);
    expect(await one("purchase_requisition", prq.id)).toMatchObject({ state: "pending_approval", total: String(2 * 95_000_000) });
    // another approver may
    expect((await w.o.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "approved" })).row.state).toBe("approved");
  });

  it("takes assets into a disposal order only while it waits for approval", async () => {
    const a1 = await w.asset({ model_id: monitor, serial_number: "RF-DSP-1" });
    const a2 = await w.asset({ model_id: monitor, serial_number: "RF-DSP-2" });
    const order = (await w.p.am.client.post(`${w.P}/r/disposal_order`, { title: "اسقاط نمایشگرهای کهنه", method: "recycle" })).row;
    await w.p.am.client.post(`${w.P}/r/disposal_item`, { order_id: order.id, asset_id: a1.id });
    await w.o.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "approved" });
    expect(await code(w.p.am.client.post(`${w.P}/r/disposal_item`, { order_id: order.id, asset_id: a2.id }))).toBe(409);
    expect((await one("asset", a2.id)).state).toBe("in_stock");
  });

  it("receives at most what is left of each order line, dated on the organisation's calendar", async () => {
    const po = (await w.p.proc.client.post(`${w.P}/r/purchase_order`, { title: "سفارش نمایشگر", supplier_id: sup })).row;
    const line = (await w.p.proc.client.post(`${w.P}/r/purchase_order_line`, { po_id: po.id, model_id: monitor, quantity: 10, unit_price: "95000000" })).row;
    await w.p.proc.client.post(`${w.P}/r/purchase_order/${po.id}/transition`, { to: "ordered" });
    expect(await code(w.p.proc.client.post(`${w.P}/itam/po/${po.id}/receive`, { stockroom_id: central, lines: [{ po_line_id: line.id, quantity: 10 }, { po_line_id: line.id, quantity: 10 }] }))).toBe(400);
    // 01:30 Tehran on 1 Azar 1405 is 22:00 UTC the day before
    const grn = (await w.p.proc.client.post(`${w.P}/r/goods_receipt`, { po_id: po.id, stockroom_id: central, received_at: "2026-11-21T22:00:00.000Z" })).row;
    await w.p.proc.client.post(`${w.P}/r/goods_receipt_line`, { receipt_id: grn.id, po_line_id: line.id, quantity: 6 });
    expect(await code(w.p.proc.client.post(`${w.P}/r/goods_receipt_line`, { receipt_id: grn.id, po_line_id: line.id, quantity: 6 }))).toBe(409);
    await w.p.proc.client.post(`${w.P}/r/goods_receipt/${grn.id}/transition`, { to: "posted" });
    const assets = await q("asset", { f: "po_id", op: "eq", v: po.id });
    expect(assets).toHaveLength(6);
    expect(assets.every((a) => a.purchase_date === "2026-11-22")).toBe(true);
    expect(dateISOIn("2026-11-21T22:00:00.000Z", "Asia/Tehran")).toBe("2026-11-22");
    const more = (await w.p.proc.client.post(`${w.P}/r/goods_receipt`, { po_id: po.id, stockroom_id: central })).row;
    await w.p.proc.client.post(`${w.P}/r/goods_receipt_line`, { receipt_id: more.id, po_line_id: line.id, quantity: 5 });
    expect(await code(w.p.proc.client.post(`${w.P}/r/goods_receipt/${more.id}/transition`, { to: "posted" }))).toBe(409);
    expect((await one("purchase_order_line", line.id)).received_qty).toBe(6);
  });

  it("raises one automatic requisition per stock rule while it is on its way", async () => {
    const room = (await w.o.post(`${w.P}/r/stockroom`, { name: "انبار آزمون سفارش خودکار", code: "WH-RF" })).row.id as string;
    const rule = (await w.p.am.client.post(`${w.P}/r/stock_rule`, { model_id: laptop, stockroom_id: room, min_qty: 2, max_qty: 5, auto_requisition: true })).row;
    const assets: Row[] = [];
    for (let i = 0; i < 3; i++) assets.push(await w.asset({ serial_number: `RF-STK-${i}`, stockroom_id: room }));
    const count = async () => (await q("purchase_requisition", { f: "stock_rule_id", op: "eq", v: rule.id })).length;
    await checkStockRules(w.sys);
    expect(await count()).toBe(0);
    await w.p.am.client.post(`${w.P}/itam/assets/${assets[0].id}/checkout`, { assigned_to: w.p.req.userId });
    await checkStockRules(w.sys);
    expect(await count()).toBe(1);
    await w.p.am.client.post(`${w.P}/itam/assets/${assets[0].id}/checkin`, { stockroom_id: room, condition: "good" });
    await checkStockRules(w.sys);
    await w.p.am.client.post(`${w.P}/itam/assets/${assets[1].id}/checkout`, { assigned_to: w.p.req2.userId });
    await checkStockRules(w.sys);
    expect(await count()).toBe(1);
  });
});

describe("audits", () => {
  it("counts and marks only the assets the counter may read and change", async () => {
    const P = w.P;
    const floor = (await w.o.post(`${P}/r/group`, { name: "پشتیبانی طبقهٔ سوم", types: ["assignment"] })).row.id as string;
    const board = (await w.o.post(`${P}/r/group`, { name: "دارایی‌های هیئت‌مدیره", types: ["assignment"] })).row.id as string;
    await w.o.put(`${P}/access/roles/floor_auditor`, { name: "ممیز طبقه", persona: "agent", grants: { asset: { read: "group", create: true, write: "group" } }, field_groups: [], contains: [], workspaces: "member", domains: "own" });
    const x = await w.e.member("member", "floor-auditor@example.com");
    await w.o.put(`${P}/access/members/${x.userId}`, { roles: ["floor_auditor"], persona: "agent" });
    await w.o.post(`${P}/access/groups/${floor}/members`, { user_ids: [x.userId] });
    const loc = (await w.o.post(`${P}/r/location`, { name: "طبقهٔ سوم ستاد", kind: "floor" })).row.id as string;
    const mine = await w.asset({ model_id: monitor, serial_number: "RF-AUD-1", location_id: loc, managed_by_group_id: floor });
    const theirs = await w.asset({ model_id: monitor, serial_number: "RF-AUD-2", location_id: loc, managed_by_group_id: board, asset_tag: "TAG-BOARD-2" });
    await x.client.get(`${P}/r/asset/${theirs.id}`, 404);
    const audit = (await x.client.post(`${P}/r/inventory_audit`, { name: "شمارش طبقهٔ سوم", scope_kind: "location", location_id: loc, group_id: floor, mark_missing: true })).row;
    await x.client.post(`${P}/r/inventory_audit/${audit.id}/transition`, { to: "in_progress" });
    expect((await one("inventory_audit", audit.id)).expected_count).toBe(1);
    const scanned = await x.client.post(`${P}/itam/audits/${audit.id}/scan`, { code: "TAG-BOARD-2" });
    expect(scanned.result).toBe("unknown");
    expect(scanned.asset).toBeNull();
    await x.client.post(`${P}/r/inventory_audit/${audit.id}/transition`, { to: "completed" });
    const t = await one("asset", theirs.id);
    expect(t.state).toBe("in_stock");
    expect(t.last_audit_at ?? null).toBeNull();
    expect((await one("asset", mine.id)).state).toBe("missing");
  });
});

describe("book values and finance", () => {
  it("moves book values on with the Jalali month, and writes off at disposal what the schedule says", async () => {
    const a = await w.asset({ serial_number: "RF-BV-1", purchase_cost: "360000000", purchase_date: "2026-09-01", in_service_date: "2026-09-01", cost_center_id: cc });
    // refreshed on 19 Aban (2026-11-10); on 4 Azar (2026-11-25) the Jalali month moved on, the Gregorian one did not
    await sysWrite("asset", a.id, { book_value_at: "2026-11-10" });
    await itamSweep(w.sys, "2026-11-25");
    expect((await one("asset", a.id)).book_value_at).toBe("2026-11-25");
    // bought this month: one month's depreciation posted, then disposed with a stored book value a month behind
    const b = await w.asset({ serial_number: "RF-BV-2", purchase_cost: "360000000", purchase_date: today(), in_service_date: today(), cost_center_id: cc });
    const period = periodKeyOf(today());
    await capture(w.sys, period);
    await sysMove("asset", b.id, "retired", { retire_reason: "آزمون اسقاط" });
    await sysMove("asset", b.id, "disposed", { disposal_method: "recycle", sanitization_method: "purge", sanitized_at: new Date().toISOString(), certificate_no: "SAN-RF-2" });
    await sysWrite("asset", b.id, { book_value: "360000000" });
    await capture(w.sys, period);
    const rows = await q("cost_entry", { and: [{ f: "asset_id", op: "eq", v: b.id }, { f: "source", op: "in", v: ["depreciation", "disposal"] }] });
    expect(rows.map((r) => r.source).sort()).toEqual(["depreciation", "disposal"]);
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(360_000_000);
  });

  it("credits a chargeback's sources only with what it charges to units (a service without units charges nobody)", async () => {
    const P = w.P;
    const hw = await w.idOf("cost_type", "code", "HW");
    await w.p.fin.client.post(`${P}/r/cost_entry`, { entry_date: today(), amount: "1200000000", description: "هزینهٔ زیرساخت", cost_center_id: cc, cost_type_id: hw });
    const lonely = (await w.o.post(`${P}/r/service`, { name: "خدمت بی‌واحد", service_type: "business" })).row;
    const served = (await w.o.post(`${P}/r/service`, { name: "خدمت با واحد", service_type: "business", consumer_units: [await w.idOf("org_unit", "code", "CC-HR")] })).row;
    const rule = (await w.p.fin.client.post(`${P}/r/allocation_rule`, { name: "زیرساخت نیمانیم", source_cost_center_id: cc, method: "percent", sort_order: 1 })).row;
    await w.p.fin.client.post(`${P}/r/allocation_target`, { rule_id: rule.id, service_id: lonely.id, percent: "50" });
    await w.p.fin.client.post(`${P}/r/allocation_target`, { rule_id: rule.id, service_id: served.id, percent: "50" });
    const seeded = await w.idOf("allocation_rule", "name", "تسهیم هزینه‌های زیرساخت به خدمت‌ها");
    await w.p.fin.client.patch(`${P}/r/allocation_rule/${seeded}`, { active: false });
    const y = (await w.p.fin.client.post(`${P}/r/fiscal_year/query`, { filter: { f: "year", op: "eq", v: fiscalYearOf(today()) } })).rows[0];
    const ps = await w.p.fin.client.post(`${P}/r/fiscal_period/query`, { filter: { f: "fiscal_year_id", op: "eq", v: y.id }, sort: "key", size: 12 });
    const run = (await w.p.fin.client.post(`${P}/r/allocation_run`, { name: "تسهیم با خدمت بی‌واحد", mode: "chargeback", fiscal_year_id: y.id, period_from_id: ps.rows[0].id, period_to_id: ps.rows[11].id })).row;
    const calc = await w.p.fin.client.post(`${P}/financial/allocation-runs/${run.id}/calculate`);
    expect(Number(calc.total_pool)).toBeGreaterThan(0);
    await w.p.fin.client.post(`${P}/r/allocation_run/${run.id}/transition`, { to: "approved" });
    await w.p.fin.client.post(`${P}/financial/allocation-runs/${run.id}/post`);
    const alloc = (await w.p.fin.client.post(`${P}/r/cost_entry/query`, { filter: { f: "source", op: "eq", v: "allocation" }, size: 200 })).rows as Row[];
    expect(alloc.length).toBeGreaterThan(1);
    expect(alloc.reduce((s, e) => s + Number(e.amount), 0)).toBe(0);
  });
});

describe("the requested item's hand-over panel", () => {
  it("tells who may hand the assets over (a reader of assets sees them without the buttons)", async () => {
    const item = (await w.p.req.client.post(`${w.P}/request/order`, { lines: [{ item_id: await w.idOf("catalog_item", "code", "new_laptop"), quantity: 1, answers: { model: "standard", os: "windows", reason: "کار روزانه" } }] })).items[0];
    await w.drain();
    if ((await one("request_item", item.id)).state !== "in_fulfilment") await sysMove("request_item", item.id, "in_fulfilment");
    await w.drain();
    const am = await w.p.am.client.get(`${w.P}/itam/request-items/${item.id}/assets`);
    expect(am.can_assign).toBe(true);
    const shown = [...am.assets, ...am.candidates];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((a: Row) => a.can_assign)).toBe(true);
    const auditor = await w.p.auditor.client.get(`${w.P}/itam/request-items/${item.id}/assets`);
    expect(auditor.can_assign).toBe(false);
    expect([...auditor.assets, ...auditor.candidates].length).toBeGreaterThan(0);
    expect([...auditor.assets, ...auditor.candidates].some((a: Row) => a.can_assign)).toBe(false);
  });
});

// IT asset management end to end: seeds (idempotent), the asset lifecycle and its ledgers (assignment history, stock
// movements, acknowledgements), the CI kept in step, repairs, secure disposal with data-wipe certificates, audits with
// scans, procurement from requisition to goods receipt, stock rules and their alerts.
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { seedItamDefaults, checkStockRules } from "@server/modules/itam";
import { BANK_MODELS } from "@server/modules/itam/seed";

let w: ItamWorld;
beforeAll(async () => {
  w = await itamWorld();
}, 120_000);

describe("seeds", () => {
  it("adds models, stockrooms, software, rules and roles once", async () => {
    const again = await seedItamDefaults(w.e.cfg, w.e.org);
    expect(again.skipped).toBe(true);
    const models = await w.o.post(`${w.P}/r/asset_model/query`, { size: 50 });
    // 12 office and data-centre models and the bank device models (ATM, CRS, kiosk, POS, HSM, CCTV, UPS, branch network…)
    expect(models.rows.length).toBe(12 + BANK_MODELS.length);
    const sw = await w.o.post(`${w.P}/r/software_model/query`, { size: 50 });
    expect(sw.rows.map((r: any) => r.name)).toContain("Windows 11 Pro");
    const rules = await w.o.post(`${w.P}/r/notification_rule/query`, { filter: { f: "table_key", op: "eq", v: "asset" }, size: 20 });
    expect(rules.rows.length).toBeGreaterThanOrEqual(3);
    const roles = await w.o.get(`${w.P}/access/roles`);
    expect(roles.roles.map((r: any) => r.key)).toEqual(expect.arrayContaining(["procurement_manager", "it_finance", "branch_asset_officer", "regional_asset_manager", "branch_manager"]));
    const forced = await seedItamDefaults(w.e.cfg, w.e.org, { force: true });
    expect(forced.created.asset_model ?? 0).toBe(0);
  });
});

describe("the asset lifecycle", () => {
  it("gets a tag, its model's data, a warranty and a CI", async () => {
    const a = await w.asset({ serial_number: "PF-LT-0001" });
    expect(a.asset_tag).toMatch(/^IT-\d+$/);
    expect(a.category).toBe("laptop");
    expect(a.substate).toBe("available");
    expect(a.warranty_end).toBeTruthy();
    await w.drain();
    const fresh = (await w.o.get(`${w.P}/r/asset/${a.id}`)).row;
    expect(fresh.ci_id).toBeTruthy();
    const ci = (await w.o.get(`${w.P}/r/ci/${fresh.ci_id}`)).row;
    expect(ci.class).toBe("laptop");
    expect(ci.serial_number).toBe("PF-LT-0001");
    expect(ci.install_status).toBe("in_stock");
  });

  it("is handed over, acknowledged, returned and keeps its history and ledger", async () => {
    const a = await w.asset({ serial_number: "PF-LT-0002" });
    await w.drain();
    const out = await w.p.am.client.post(`${w.P}/itam/assets/${a.id}/checkout`, { assigned_to: w.p.req.userId, condition: "new", note: "کارمند تازه" });
    expect(out.asset.state).toBe("in_use");
    expect(out.asset.ack_state).toBe("pending");
    const ci = (await w.o.get(`${w.P}/r/ci/${out.asset.ci_id}`)).row;
    expect(ci.used_by).toBe(w.p.req.userId);
    expect(ci.install_status).toBe("installed");
    // the person sees it, accepts the terms with their name
    const mine = await w.p.req.client.get(`${w.P}/itam/my-assets`);
    expect(mine.assets.map((x: any) => x.id)).toContain(a.id);
    const ack = mine.acks.find((k: any) => k.asset_id === a.id);
    expect(ack).toBeTruthy();
    await w.p.req.client.post(`${w.P}/itam/acks/${ack.id}/decide`, { decision: "accept", signature_name: "ک" }, 400);
    await w.p.req2.client.post(`${w.P}/itam/acks/${ack.id}/decide`, { decision: "accept", signature_name: "نفر دیگر" }, 404);
    const decided = await w.p.req.client.post(`${w.P}/itam/acks/${ack.id}/decide`, { decision: "accept", signature_name: "درخواست‌دهندهٔ آزمایشی" });
    expect(decided.ack.state).toBe("accepted");
    expect((await w.o.get(`${w.P}/r/asset/${a.id}`)).row.ack_state).toBe("accepted");
    // back to stock: the assignment closes with its condition, the ledger records issue and return
    const central = await w.idOf("stockroom", "code", "WH-01");
    const back = await w.p.am.client.post(`${w.P}/itam/assets/${a.id}/checkin`, { stockroom_id: central, condition: "good" });
    expect(back.asset.state).toBe("in_stock");
    expect(back.asset.assigned_to).toBeNull();
    const hist = await w.o.post(`${w.P}/r/asset_assignment/query`, { filter: { f: "asset_id", op: "eq", v: a.id } });
    expect(hist.rows).toHaveLength(1);
    expect(hist.rows[0].to_at).toBeTruthy();
    expect(hist.rows[0].condition_in).toBe("good");
    expect(hist.rows[0].condition_out).toBe("new");
    const moves = await w.o.post(`${w.P}/r/stock_movement/query`, { filter: { f: "asset_id", op: "eq", v: a.id }, sort: "moved_at" });
    expect(moves.rows.map((m: any) => m.kind)).toEqual(["receipt", "issue", "return"]);
    expect(moves.rows.map((m: any) => m.quantity)).toEqual([1, -1, 1]);
    const v360 = await w.p.am.client.get(`${w.P}/itam/assets/${a.id}/360`);
    expect(v360.assignments).toHaveLength(1);
    expect(v360.ci?.id).toBe(out.asset.ci_id);
    expect(v360.costs).toBeTruthy();
    expect(v360.timeline.length).toBeGreaterThan(2);
  });

  it("needs someone or somewhere to deploy to, and a stockroom to return to", async () => {
    const a = await w.asset();
    await w.p.am.client.post(`${w.P}/r/asset/${a.id}/transition`, { to: "in_use" }, 409);
    const used = await w.p.am.client.post(`${w.P}/itam/assets/${a.id}/checkout`, { location_id: null, assigned_to: w.p.req2.userId });
    await w.p.am.client.post(`${w.P}/r/asset/${a.id}/transition`, { to: "in_stock", data: { stockroom_id: null } }, 400);
    expect(used.asset.state).toBe("in_use");
  });

  it("goes to repair and comes back to its holder", async () => {
    const a = await w.asset();
    await w.p.am.client.post(`${w.P}/itam/assets/${a.id}/checkout`, { assigned_to: w.p.req.userId });
    const vendor = await w.idOf("supplier", "name", "Lenovo");
    const rma = (await w.p.am.client.post(`${w.P}/r/repair_order`, { asset_id: a.id, title: "صفحه‌کلید", fault: "چند کلید کار نمی‌کند", vendor_id: vendor })).row;
    expect(rma.under_warranty).toBe(true);
    expect(rma.repair_kind).toBe("vendor");
    let asset = (await w.o.get(`${w.P}/r/asset/${a.id}`)).row;
    expect(asset.state).toBe("in_repair");
    expect(asset.substate).toBe("vendor_repair");
    await w.p.am.client.post(`${w.P}/r/repair_order/${rma.id}/transition`, { to: "repaired", data: { resolution: "صفحه‌کلید تعویض شد" } });
    asset = (await w.o.get(`${w.P}/r/asset/${a.id}`)).row;
    expect(asset.state).toBe("in_use");
    expect(asset.assigned_to).toBe(w.p.req.userId);
  });

  it("disposes only with a data-wipe certificate for data-bearing assets", async () => {
    const a = await w.asset({ serial_number: "PF-LT-DISP" });
    await w.drain();
    const recycler = await w.idOf("supplier", "name", "پیمانکار بازیافت سبز (نمونه)");
    const order = (await w.p.am.client.post(`${w.P}/r/disposal_order`, { title: "اسقاط لپ‌تاپ‌های قدیمی", method: "recycle", vendor_id: recycler })).row;
    const item = (await w.p.am.client.post(`${w.P}/r/disposal_item`, { order_id: order.id, asset_id: a.id })).row;
    expect((await w.o.get(`${w.P}/r/asset/${a.id}`)).row.state).toBe("retired");
    await w.p.am.client.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "approved" });
    const refused = await w.p.am.client.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "completed" }, 409);
    expect(refused.error.message).toContain("گواهی");
    await w.p.am.client.patch(`${w.P}/r/disposal_item/${item.id}`, { sanitization_method: "purge", sanitized_at: new Date().toISOString(), certificate_no: "WIPE-1405-001", verified: true });
    await w.p.am.client.post(`${w.P}/r/disposal_order/${order.id}/transition`, { to: "completed" });
    const gone = (await w.o.get(`${w.P}/r/asset/${a.id}`)).row;
    expect(gone.state).toBe("disposed");
    expect(gone.certificate_no).toBe("WIPE-1405-001");
    expect(gone.disposal_method).toBe("recycle");
    const ci = (await w.o.get(`${w.P}/r/ci/${gone.ci_id}`)).row;
    expect(ci.state).toBe("disposed");
    // a disposed asset is locked
    await w.p.am.client.patch(`${w.P}/r/asset/${a.id}`, { notes: "تغییر" }, 409);
  });
});

describe("audits with scans", () => {
  it("counts expected assets, finds by tag, serial or link, and marks the rest missing", async () => {
    const room = (await w.p.am.client.post(`${w.P}/r/stockroom`, { name: "انبار شمارش", code: "WH-AUD" })).row;
    const a1 = await w.asset({ stockroom_id: room.id, serial_number: "AUD-1" });
    const a2 = await w.asset({ stockroom_id: room.id, serial_number: "AUD-2" });
    const a3 = await w.asset({ stockroom_id: room.id, serial_number: "AUD-3" });
    const other = await w.asset({ serial_number: "AUD-ELSEWHERE" });
    const audit = (await w.p.am.client.post(`${w.P}/r/inventory_audit`, { name: "شمارش آزمایشی", scope_kind: "stockroom", stockroom_id: room.id, mark_missing: true })).row;
    await w.p.am.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: "x" }, 409);
    await w.p.am.client.post(`${w.P}/r/inventory_audit/${audit.id}/transition`, { to: "in_progress" });
    const s1 = await w.p.am.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: a1.asset_tag });
    expect(s1.result).toBe("found");
    expect(s1.counts.expected).toBe(3);
    expect((await w.p.am.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: "AUD-2" })).result).toBe("found");
    expect((await w.p.am.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: `https://itsm.example/${w.e.org}/assets/${a2.id}` })).result).toBe("duplicate");
    expect((await w.p.am.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: other.asset_tag })).result).toBe("moved");
    expect((await w.p.am.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: "NO-SUCH-TAG" })).result).toBe("unknown");
    await w.p.agent.client.post(`${w.P}/itam/audits/${audit.id}/scan`, { code: "AUD-3" }, 403);
    await w.p.am.client.post(`${w.P}/r/inventory_audit/${audit.id}/transition`, { to: "completed" });
    const done = (await w.o.get(`${w.P}/r/inventory_audit/${audit.id}`)).row;
    expect(done.found_count).toBe(2);
    expect(done.missing_count).toBe(1);
    const lost = (await w.o.get(`${w.P}/r/asset/${a3.id}`)).row;
    expect(lost.state).toBe("missing");
    expect(lost.last_audit_result).toBe("missing");
    expect((await w.o.get(`${w.P}/r/asset/${a1.id}`)).row.last_audit_result).toBe("found");
  });
});

describe("procurement", () => {
  it("runs from a requisition to an order and a goods receipt that creates the assets", async () => {
    const monitor = await w.idOf("asset_model", "name", "سامسونگ ۲۴ اینچ S24C360");
    const toner = await w.idOf("asset_model", "name", "کارتریج تونر HP 85A");
    const prq = (await w.p.proc.client.post(`${w.P}/r/purchase_requisition`, { title: "نمایشگر و تونر" })).row;
    await w.p.proc.client.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "pending_approval" }, 409);
    await w.p.proc.client.post(`${w.P}/r/purchase_requisition_line`, { requisition_id: prq.id, model_id: monitor, quantity: 2 });
    await w.p.proc.client.post(`${w.P}/r/purchase_requisition_line`, { requisition_id: prq.id, model_id: toner, quantity: 5, unit_price: "7000000" });
    const withLines = (await w.o.get(`${w.P}/r/purchase_requisition/${prq.id}`)).row;
    expect(withLines.total).toBe(String(2 * 95000000 + 5 * 7000000));
    // submitted, and approved by an approver other than whom it is for (never from draft)
    await w.p.proc.client.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "pending_approval" });
    await w.o.post(`${w.P}/r/purchase_requisition/${prq.id}/transition`, { to: "approved" });
    const orders = await w.p.proc.client.post(`${w.P}/itam/requisitions/${prq.id}/order`);
    expect(orders.orders).toHaveLength(1);
    const poId = orders.orders[0].id;
    expect((await w.o.get(`${w.P}/r/purchase_requisition/${prq.id}`)).row.state).toBe("ordered");
    await w.p.proc.client.post(`${w.P}/r/purchase_order/${poId}/transition`, { to: "ordered" });
    const lines = await w.o.post(`${w.P}/r/purchase_order_line/query`, { filter: { f: "po_id", op: "eq", v: poId }, sort: "line_no" });
    const central = await w.idOf("stockroom", "code", "WH-01");
    const monitorLine = lines.rows.find((l: any) => l.model_id === monitor);
    const tonerLine = lines.rows.find((l: any) => l.model_id === toner);
    const r1 = await w.p.proc.client.post(`${w.P}/itam/po/${poId}/receive`, { stockroom_id: central, lines: [{ po_line_id: monitorLine.id, quantity: 1, serials: ["MON-001"] }] });
    expect(r1.assets).toBe(1);
    expect((await w.o.get(`${w.P}/r/purchase_order/${poId}`)).row.state).toBe("partially_received");
    await w.p.proc.client.post(`${w.P}/itam/po/${poId}/receive`, { stockroom_id: central, lines: [{ po_line_id: monitorLine.id, quantity: 5 }] }, 409);
    const r2 = await w.p.proc.client.post(`${w.P}/itam/po/${poId}/receive`, { stockroom_id: central, lines: [{ po_line_id: monitorLine.id, quantity: 1, serials: ["MON-002"] }, { po_line_id: tonerLine.id, quantity: 5 }] });
    expect(r2.assets).toBe(2);
    expect((await w.o.get(`${w.P}/r/purchase_order/${poId}`)).row.state).toBe("received");
    const mon = await w.o.post(`${w.P}/r/asset/query`, { filter: { f: "serial_number", op: "eq", v: "MON-001" } });
    expect(mon.rows[0].purchase_cost).toBe("95000000");
    expect(mon.rows[0].po_id).toBe(poId);
    const tonerAsset = await w.o.post(`${w.P}/r/asset/query`, { filter: { and: [{ f: "model_id", op: "eq", v: toner }, { f: "po_id", op: "eq", v: poId }] } });
    expect(tonerAsset.rows[0].quantity).toBe(5);
    expect(tonerAsset.rows[0].asset_class).toBe("consumable");
  });

  it("alerts once when stock falls to the reorder point and raises requisitions from the stock view", async () => {
    const stock = await w.p.am.client.get(`${w.P}/itam/stock`);
    const phones = stock.rows.find((r: any) => r.model.includes("Galaxy"));
    expect(phones.status).toBe("out");
    expect(phones.order_qty).toBeGreaterThan(0);
    const r = await checkStockRules(w.sys);
    expect(r.checked).toBeGreaterThan(0);
    const again = await checkStockRules(w.sys);
    expect(again.alerts).toBe(0);
    const prq = await w.p.am.client.post(`${w.P}/itam/stock/requisition`, { rule_ids: [phones.rule_id] });
    const lines = await w.o.post(`${w.P}/r/purchase_requisition_line/query`, { filter: { f: "requisition_id", op: "eq", v: prq.id } });
    expect(lines.rows[0].quantity).toBe(phones.order_qty);
  });
});

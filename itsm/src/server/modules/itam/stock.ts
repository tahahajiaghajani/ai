// Stock, procurement and physical audits (catalogue ITAM-013/014/015/020/024/025/026/029): stock levels per model and
// stockroom computed from the assets in stock (individually tracked ones count one, quantity-tracked ones their
// quantity), stock rules re-checked with alerts and optional requisitions, a requisition raised from low stock,
// orders made from an approved requisition (one per supplier), receiving against an order (a goods receipt posted in
// one transaction), and the scans of a physical audit.
import type { Cond } from "@shared/model/conditions";
import type { ReceiveInput, ScanResult, StockDashboard, StockRow } from "@shared/itam/api";
import { orderQuantity, parseScan, stockStatus } from "@shared/itam/logic";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { aggregate, createIn, defFor, emitEvent, get, list, transitionIn, updateIn } from "../../engine";
import { holds, isUuid, liveRow, liveRows, lockedRow, sysOf, type Row } from "./common";

interface Level {
  available: number;
  reserved: number;
  defective: number;
  total: number;
}

/** Stock per (model, stockroom) from the assets in stock, read with `ctx` (the system sees all). */
export async function stockLevels(ctx: Ctx): Promise<{ levels: Map<string, Level>; display: Record<string, string> }> {
  const r = await aggregate(ctx, "asset", {
    filter: { f: "state", op: "eq", v: "in_stock" },
    groupBy: ["model_id", "stockroom_id", "substate"],
    metrics: [{ fn: "sum", field: "quantity" }, { fn: "count" }],
    limit: 5000,
  });
  const levels = new Map<string, Level>();
  for (const g of r.rows) {
    const [model, room, sub] = g.keys as (string | null)[];
    if (!model || !room) continue;
    const key = `${model}|${room}`;
    const l = levels.get(key) ?? { available: 0, reserved: 0, defective: 0, total: 0 };
    const qty = Number(g.values["sum:quantity"] ?? g.values.count ?? 0);
    l.total += qty;
    if (sub === "available") l.available += qty;
    else if (sub === "reserved") l.reserved += qty;
    else if (sub === "defective") l.defective += qty;
    levels.set(key, l);
  }
  return { levels, display: r.display ?? {} };
}

export async function stockDashboard(ctx: Ctx): Promise<StockDashboard> {
  const { levels, display } = await stockLevels(ctx);
  const rules = (await list(ctx, "stock_rule", { filter: { f: "active", op: "eq", v: true }, size: 2000, total: false }).catch(() => null)) ?? { rows: [] as Row[], display: {} as Record<string, string> };
  const rooms = await list(ctx, "stockroom", { filter: { f: "active", op: "eq", v: true }, size: 500, total: false, fields: ["name", "stockroom_type"] });
  const models = new Map<string, Row>();
  const modelIds = new Set<string>([...levels.keys()].map((k) => k.split("|")[0]));
  for (const r of rules.rows) if (isUuid(r.model_id)) modelIds.add(String(r.model_id));
  if (modelIds.size) for (const m of (await list(ctx, "asset_model", { ids: [...modelIds], size: modelIds.size, total: false, fields: ["name", "category"] })).rows) models.set(String(m.id), m);
  const roomName = new Map(rooms.rows.map((r) => [String(r.id), String(r.name ?? "")]));
  const rows: StockRow[] = [];
  const seen = new Set<string>();
  const row = (model: string, room: string, rule: Row | null): StockRow => {
    const l = levels.get(`${model}|${room}`) ?? { available: 0, reserved: 0, defective: 0, total: 0 };
    const status = rule ? stockStatus(l.available, rule) : null;
    return {
      model_id: model, model: String(models.get(model)?.name ?? display[model] ?? rules.display[model] ?? ""), category: (models.get(model)?.category as string) ?? null,
      stockroom_id: room, stockroom: roomName.get(room) ?? display[room] ?? rules.display[room] ?? "",
      ...l, rule_id: rule ? String(rule.id) : null, min_qty: rule ? Number(rule.min_qty ?? 0) : null, max_qty: rule ? Number(rule.max_qty ?? 0) : null,
      status, order_qty: rule && status !== "ok" ? orderQuantity(l.available, rule) : 0,
    };
  };
  for (const r of rules.rows) {
    const key = `${r.model_id}|${r.stockroom_id}`;
    seen.add(key);
    rows.push(row(String(r.model_id), String(r.stockroom_id), r));
  }
  for (const key of levels.keys()) if (!seen.has(key)) rows.push(row(key.split("|")[0], key.split("|")[1], null));
  rows.sort((a, b) => (a.stockroom === b.stockroom ? a.model.localeCompare(b.model, "fa") : a.stockroom.localeCompare(b.stockroom, "fa")));
  const alerts = rows.filter((r) => r.status === "low" || r.status === "out");
  return {
    stockrooms: rooms.rows.map((r) => ({
      id: String(r.id), name: String(r.name ?? ""), type: (r.stockroom_type as string) ?? null,
      available: rows.filter((x) => x.stockroom_id === r.id).reduce((n, x) => n + x.available, 0), alerts: alerts.filter((x) => x.stockroom_id === r.id).length,
    })),
    rows,
    alerts,
  };
}

/**
 * Re-check every active stock rule (as the system): store its available quantity and status, alert the stockroom's
 * people once per drop below the reorder point (event `record.itam.stock_low`), and raise a draft requisition for
 * rules that ask for one.
 */
export async function checkStockRules(sys: Ctx): Promise<{ checked: number; alerts: number; requisitions: number }> {
  const { levels } = await stockLevels(sys);
  const rules = await liveRows(sys.db, sys, "stock_rule", { f: "active", op: "eq", v: true } as Cond, { limit: 5000 });
  let alerts = 0;
  let requisitions = 0;
  for (const listed of rules) {
    const l = levels.get(`${listed.model_id}|${listed.stockroom_id}`) ?? { available: 0, reserved: 0, defective: 0, total: 0 };
    const seen = stockStatus(l.available, listed);
    if (Number(listed.available ?? -1) === l.available && listed.status === seen && !(seen !== "ok" && (listed.status === "ok" || !listed.status))) continue;
    await sys.write(async (tx) => {
      // the rule locked and judged as stored: two checks at once (the job and «بررسی» by hand) take turns, and the
      // second finds the drop already alerted and the requisition already on its way — one purchase per shortage
      const rule = await lockedRow(tx, sys, "stock_rule", listed.id);
      if (!rule || !rule.active) return;
      const status = stockStatus(l.available, rule);
      const dropped = status !== "ok" && (rule.status === "ok" || !rule.status);
      if (Number(rule.available ?? -1) === l.available && rule.status === status && !dropped) return;
      const patch: Row = { available: l.available, status };
      if (dropped) {
        patch.last_alert_at = new Date().toISOString();
        const room = await liveRow(tx, sys, "stockroom", rule.stockroom_id);
        const users = [room?.manager_id].filter(isUuid);
        await emitEvent(tx, sys, { kind: "record.itam.stock_low", table: "stock_rule", id: rule.id, number: null, data: { users, available: l.available, min_qty: rule.min_qty, status } });
        alerts++;
        // one purchase on its way per rule: a swing back above the reorder point and down again raises no second one
        if (rule.auto_requisition && !(await openRequisitionOf(tx, sys, rule))) {
          const prq = await requisitionFor(tx, sys, [{ rule, available: l.available }], "reorder");
          if (prq) {
            patch.last_requisition_id = prq.id;
            requisitions++;
          }
        }
      }
      await updateIn(tx, sys, "stock_rule", rule.id, patch, { trusted: true });
    });
  }
  return { checked: rules.length, alerts, requisitions };
}

/**
 * The requisition of a stock rule still on its way — its last one, or any raised for it, while a draft, waiting for
 * approval, approved, or ordered with an order not yet received — else null.
 */
async function openRequisitionOf(tx: Parameters<Parameters<Ctx["write"]>[0]>[0], sys: Ctx, rule: Row): Promise<Row | null> {
  const mine: Cond[] = [{ f: "stock_rule_id", op: "eq", v: rule.id }];
  if (isUuid(rule.last_requisition_id)) mine.push({ f: "id", op: "eq", v: rule.last_requisition_id });
  const prqs = await liveRows(tx, sys, "purchase_requisition", { or: mine } as Cond, { order: "t.created_at desc", limit: 20 });
  for (const r of prqs) {
    if (["draft", "pending_approval", "approved"].includes(String(r.state))) return r;
    if (r.state !== "ordered") continue;
    const orders = await liveRows(tx, sys, "purchase_order", { f: "requisition_id", op: "eq", v: r.id } as Cond, { limit: 50 });
    if (!orders.length || orders.some((o) => ["draft", "ordered", "partially_received"].includes(String(o.state)))) return r;
  }
  return null;
}

/** A draft requisition with one line per rule (the quantity to order), in the given transaction. */
async function requisitionFor(tx: Parameters<Parameters<Ctx["write"]>[0]>[0], ctx: Ctx, items: { rule: Row; available: number }[], source: "reorder" | "manual"): Promise<Row | null> {
  const lines = items.map((i) => ({ rule: i.rule, qty: orderQuantity(i.available, i.rule) })).filter((l) => l.qty > 0);
  if (!lines.length) return null;
  const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  const first = lines[0].rule;
  const room = await liveRow(tx, sys, "stockroom", first.stockroom_id);
  const title = lines.length === 1 ? `تأمین موجودی: ${first.label ?? ""}` : `تأمین موجودی ${room?.name ?? ""} (${lines.length} قلم)`;
  const prq = await createIn(tx, sys, "purchase_requisition", {
    title: title.slice(0, 200), source: "reorder", stock_rule_id: lines.length === 1 ? first.id : null, requested_for: room?.manager_id ?? (ctx.actor === "system" ? null : ctx.user.id),
    justification: lines.map((l) => `- ${l.rule.label ?? ""}: موجودی زیر نقطهٔ سفارش (${l.rule.min_qty})، سفارش ${l.qty}`).join("\n"),
  }, { trusted: true });
  for (const l of lines) await createIn(tx, sys, "purchase_requisition_line", { requisition_id: prq.id, model_id: l.rule.model_id, quantity: l.qty }, { trusted: true });
  void source;
  return prq;
}

/** A requisition for the chosen low stock rules (the stock dashboard's «درخواست خرید»). */
export async function requisitionFromRules(ctx: Ctx, ruleIds: string[]): Promise<{ id: string; number: string | null }> {
  const { def } = await defFor(ctx, "purchase_requisition");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ثبت درخواست خرید را ندارید");
  const { levels } = await stockLevels(ctx);
  const rules = (await list(ctx, "stock_rule", { ids: ruleIds.slice(0, 200), size: 200, total: false })).rows;
  if (!rules.length) throw notFound("قاعدهٔ موجودی پیدا نشد");
  const items = rules.map((rule) => ({ rule, available: (levels.get(`${rule.model_id}|${rule.stockroom_id}`) ?? { available: 0 }).available }));
  const prq = await ctx.write(async (tx) => {
    const r = await requisitionFor(tx, ctx, items, "manual");
    if (!r) throw conflict("این اقلام کمبودی ندارند");
    for (const rule of rules) await updateIn(tx, sysOf(ctx), "stock_rule", String(rule.id), { last_requisition_id: r.id }, { trusted: true });
    return r;
  });
  return { id: String(prq.id), number: (prq.number as string) ?? null };
}

/** Orders from an approved requisition: one purchase order per supplier (the line's model's default vendor). */
export async function ordersFromRequisition(ctx: Ctx, id: string): Promise<{ orders: { id: string; number: string | null }[] }> {
  const { row } = await get(ctx, "purchase_requisition", id);
  if (row.state !== "approved") throw conflict("فقط درخواست خرید تأییدشده سفارش داده می‌شود");
  const { def } = await defFor(ctx, "purchase_order");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ثبت سفارش خرید را ندارید");
  const sys = sysOf(ctx, ctx.user.id);
  const orders = await ctx.write(async (tx) => {
    const lines = await liveRows(tx, sys, "purchase_requisition_line", { f: "requisition_id", op: "eq", v: id } as Cond, { limit: 2000, order: "t.created_at" });
    const bySupplier = new Map<string, Row[]>();
    for (const l of lines) {
      const model = isUuid(l.model_id) ? await liveRow(tx, sys, "asset_model", l.model_id) : null;
      const supplier = String(row.supplier_id ?? model?.default_vendor_id ?? "");
      bySupplier.set(supplier, [...(bySupplier.get(supplier) ?? []), l]);
    }
    const out: { id: string; number: string | null }[] = [];
    for (const [supplier, ls] of bySupplier) {
      const po = await createIn(tx, ctx, "purchase_order", {
        title: String(row.title ?? "").slice(0, 200), supplier_id: isUuid(supplier) ? supplier : null, requisition_id: id, cost_center_id: row.cost_center_id ?? null,
      });
      for (const l of ls) await createIn(tx, ctx, "purchase_order_line", { po_id: po.id, model_id: l.model_id ?? null, description: l.description, quantity: l.quantity, unit_price: l.unit_price ?? null, requisition_line_id: l.id });
      out.push({ id: String(po.id), number: (po.number as string) ?? null });
    }
    await transitionIn(tx, sys, "purchase_requisition", id, "ordered", {});
    await updateIn(tx, sys, "purchase_requisition", id, { purchase_order_id: out[0]?.id ?? null }, { trusted: true });
    return out;
  });
  return { orders };
}

/** Receive goods of an order in one step: a goods receipt with its lines, posted (the hooks create the assets). */
export async function receive(ctx: Ctx, poId: string, input: ReceiveInput): Promise<{ receipt_id: string; number: string | null; assets: number }> {
  const { row: po } = await get(ctx, "purchase_order", poId);
  const stockroom = input.stockroom_id ?? po.delivery_stockroom_id;
  if (!isUuid(stockroom)) throw bad("انبار دریافت را مشخص کنید");
  const lines = input.lines.filter((l) => Number(l.quantity) > 0);
  if (!lines.length) throw bad("تعداد دریافت‌شده را وارد کنید");
  if (new Set(lines.map((l) => l.po_line_id.toLowerCase())).size !== lines.length) throw bad("هر سطر سفارش یک بار در رسید می‌آید؛ تعدادها را در همان سطر جمع کنید");
  const result = await ctx.write(async (tx) => {
    const grn = await createIn(tx, ctx, "goods_receipt", { po_id: poId, stockroom_id: stockroom, note: input.note ?? null });
    for (const l of lines) {
      await createIn(tx, ctx, "goods_receipt_line", {
        receipt_id: grn.id, po_line_id: l.po_line_id, quantity: Math.floor(Number(l.quantity)),
        serials: (l.serials ?? []).map((s) => s.trim()).filter(Boolean).join("\n") || null, asset_tags: (l.asset_tags ?? []).map((s) => s.trim()).filter(Boolean).join("\n") || null,
      });
    }
    await transitionIn(tx, ctx, "goods_receipt", String(grn.id), "posted", {});
    const fresh = await liveRow(tx, sysOf(ctx), "goods_receipt", grn.id);
    return { receipt_id: String(grn.id), number: (grn.number as string) ?? null, assets: Number(fresh?.assets_created ?? 0) };
  });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Physical audits (ITAM-029)

async function auditCounts(q: Ctx["db"], sys: Ctx, auditId: string): Promise<ScanResult["counts"]> {
  const items = await liveRows(q, sys, "inventory_audit_item", { f: "audit_id", op: "eq", v: auditId } as Cond, { limit: 20000 });
  return {
    expected: items.filter((i) => i.expected).length,
    found: items.filter((i) => i.result === "found").length,
    missing: items.filter((i) => i.result === "missing").length,
    unexpected: items.filter((i) => i.result === "unexpected" || i.result === "moved").length,
  };
}

/** One scan of an audit: the asset found by link, id, number, tag or serial, and its result. */
export async function scan(ctx: Ctx, auditId: string, code: string): Promise<ScanResult> {
  const { row: audit } = await get(ctx, "inventory_audit", auditId);
  const { def } = await defFor(ctx, "inventory_audit");
  if (!access().canWrite(ctx, def, audit)) throw forbidden("اجازهٔ شمارش در این ممیزی را ندارید");
  if (audit.state !== "in_progress") throw conflict("شمارش آغاز نشده یا پایان یافته است");
  const ref = parseScan(code);
  if (!ref) throw bad("کد خالی است");
  const sys = sysOf(ctx, ctx.user.id);
  const where: Cond = ref.kind === "id" ? { f: "id", op: "eq", v: ref.value } : ref.kind === "number" ? { f: "number", op: "eq", v: ref.value } : { or: [{ f: "asset_tag", op: "eq", v: ref.value }, { f: "serial_number", op: "eq", v: ref.value }] };
  // resolved with the counter's own access: an asset they may not read is «unknown» (nothing of it is told)
  const [asset] = await liveRows(ctx.db, ctx, "asset", where, { limit: 1 });
  return ctx.write(async (tx) => {
    // the audit read shared until commit and still counting: scans of one audit run side by side, its completion
    // (which locks it for update) waits for the scans in flight, and a scan that comes after it is refused — a counted
    // asset is never left «missing» by a completion that did not see its scan
    const live = await lockedRow(tx, sys, "inventory_audit", auditId, "share");
    if (live?.state !== "in_progress") throw conflict("شمارش آغاز نشده یا پایان یافته است");
    const at = new Date().toISOString();
    const info = (a: Row | undefined) => (a ? { id: String(a.id), number: (a.number as string) ?? null, name: String(a.name ?? ""), asset_tag: (a.asset_tag as string) ?? null } : null);
    if (!asset) {
      const item = await createIn(tx, sys, "inventory_audit_item", { audit_id: auditId, expected: false, result: "unexpected", scanned_code: code.slice(0, 300), scanned_at: at, scanned_by: ctx.user.id, note: "دارایی‌ای با این کد ثبت نشده است", label: code.slice(0, 300) }, { trusted: true });
      return { result: "unknown" as const, message: "این کد به دارایی ثبت‌شده‌ای نمی‌خورد", item_id: String(item.id), asset: null, counts: await auditCounts(tx as never, sys, auditId) };
    }
    const [item] = await liveRows(tx, sys, "inventory_audit_item", { and: [{ f: "audit_id", op: "eq", v: auditId }, { f: "asset_id", op: "eq", v: asset.id }] } as Cond, { limit: 1 });
    if (item && item.result === "found") return { result: "duplicate" as const, message: "این دارایی پیش‌تر شمرده شده است", item_id: String(item.id), asset: info(asset), counts: await auditCounts(tx as never, sys, auditId) };
    if (item) {
      await updateIn(tx, sys, "inventory_audit_item", item.id, { result: "found", scanned_code: code.slice(0, 300), scanned_at: at, scanned_by: ctx.user.id }, { trusted: true });
      return { result: "found" as const, message: "دیده شد", item_id: String(item.id), asset: info(asset), counts: await auditCounts(tx as never, sys, auditId) };
    }
    // an asset that is somewhere else on record: moved (counted, with where it was found)
    const here = audit.scope_kind === "location" ? audit.location_id : audit.stockroom_id;
    const created = await createIn(tx, sys, "inventory_audit_item", {
      audit_id: auditId, asset_id: asset.id, expected: false, result: "moved", scanned_code: code.slice(0, 300), scanned_at: at, scanned_by: ctx.user.id,
      note: "در این محل ثبت نشده بود", label: `${asset.number ?? ""} — ${asset.name ?? ""}`.slice(0, 300),
    }, { trusted: true });
    void here;
    return { result: "moved" as const, message: "این دارایی جای دیگری ثبت شده است", item_id: String(created.id), asset: info(asset), counts: await auditCounts(tx as never, sys, auditId) };
  });
}

export const requisitionTable = () => tableDef("purchase_requisition");
export { holds };

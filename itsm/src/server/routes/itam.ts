// HTTP API of IT asset management under /api/o/:org/itam (docs/modules/itam_FA.md «API»). Records themselves (assets,
// models, stockrooms, orders, entitlements…) are served by the generic engine API (/r/asset…); these routes are what it
// cannot express: the dashboard, «دارایی‌های من», check-out and check-in, the asset 360, the stock view and
// requisitions from it, receiving, ordering, audit scans, the compliance position and its runs, labels, the hand-over of
// requested items, leavers, and the AI narratives (rule-based without a model). Every handler works with the caller's
// context; services that act as the system check the caller's grant first.
import { z } from "zod";
import type { ItamDashboard, ItamMeta, LabelData, RequestItemAssets } from "@shared/itam/api";
import { qrPayload } from "@shared/itam/logic";
import { ASSET_STATES } from "@shared/tables/itam";
import { addDays } from "@shared/jalali";
import type { Cond } from "@shared/model/conditions";
import { router, body, query } from "../http/hono";
import { bad, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { aggregate, defFor, get, list } from "../engine";
import {
  asset360, confirmDiscovered, checkStockRules, checkin, checkout, compliance, decideAck, ensureItamSweep, hasGroup, holds, itamConfig, itamText, leaverReturn,
  licenceFacts, licenceNarrative, linkCi, myAssets, ordersFromRequisition, receive, reconcile, reportAsset, requisitionFromRules, scan, seedItamDefaultsIn, stockDashboard,
  syncInstalls, assetSummaryText,
} from "../modules/itam";
import { isUuid, liveRows, orgToday, sysOf } from "../modules/itam/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");

export const itamRoutes = router();

const needManage = async (ctx: Parameters<typeof holds>[0], area = "asset") => {
  if (!(await holds(ctx, area, "write", "group"))) throw forbidden("این کار با مدیر دارایی است");
};

itamRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const cfg = await itamConfig(ctx.db, ctx);
  await ensureItamSweep(ctx.db, ctx.org.id);
  const meta: ItamMeta = {
    can_manage: await holds(ctx, "asset", "write", "group"),
    can_approve: await holds(ctx, "asset", "approve"),
    financial: await hasGroup(ctx, "financial"),
    software: await holds(ctx, "software", "read"),
    procurement: await holds(ctx, "procurement", "read"),
    contracts: await holds(ctx, "contract", "read"),
    ai: ["itam.license_optimization", "itam.asset_summary"],
    config: { tag_prefix: cfg.tag_prefix, qr_base_url: cfg.qr_base_url ?? "", unused_days: cfg.unused_days, label_org: ctx.org.name ?? "" },
  };
  return c.json(meta);
});

itamRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!(await holds(ctx, "asset", "write", "all"))) throw forbidden("افزودن پیش‌فرض‌های دارایی با مدیر دارایی است");
  const r = await ctx.write((tx) => seedItamDefaultsIn(tx, ctx, { force: true }));
  return c.json({ created: r.created });
});

// ----- dashboard (ITAM-076) -------------------------------------------------------------------------------------

itamRoutes.get("/dashboard", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "asset");
  if (!access().canReadTable(ctx, def)) throw forbidden("به دارایی‌ها دسترسی ندارید");
  const today = orgToday(ctx);
  const live: Cond = { f: "state", op: "nin", v: ["disposed", "canceled"] };
  const byState = await aggregate(ctx, "asset", { filter: live, groupBy: ["state"], metrics: [{ fn: "count" }] });
  const byCat = await aggregate(ctx, "asset", { filter: live, groupBy: ["category"], metrics: [{ fn: "count" }] });
  const count = async (table: string, filter: Cond) => (await list(ctx, table, { filter, size: 1, total: true }).catch(() => null))?.total ?? 0;
  const n = (state: string) => Number(byState.rows.find((g) => g.keys[0] === state)?.values.count ?? 0);
  const out: ItamDashboard = {
    total: byState.rows.reduce((a, g) => a + Number(g.values.count ?? 0), 0),
    by_state: byState.rows.map((g) => ({ state: String(g.keys[0] ?? ""), label: ASSET_STATES.states.find((s) => s.value === g.keys[0])?.label ?? String(g.keys[0] ?? ""), count: Number(g.values.count ?? 0) })),
    by_category: byCat.rows.map((g) => ({ category: String(g.keys[0] ?? ""), label: String(g.labels?.[0] ?? g.keys[0] ?? "بدون دسته"), count: Number(g.values.count ?? 0) })),
    in_stock: n("in_stock"),
    in_use: n("in_use"),
    missing: n("missing"),
    warranty_expiring: await count("asset", { and: [live, { f: "warranty_end", op: "between", v: [today, addDays(today, 90)] }] }),
    lease_ending: await count("asset", { and: [live, { f: "lease_end", op: "between", v: [today, addDays(today, 90)] }] }),
    pending_acks: await count("asset_acknowledgement", { f: "state", op: "eq", v: "pending" }),
    stock_alerts: await count("stock_rule", { and: [{ f: "active", op: "eq", v: true }, { f: "status", op: "in", v: ["low", "out"] }] }),
    open_repairs: await count("repair_order", { f: "state", op: "in", v: ["new", "diagnosing", "awaiting_vendor", "awaiting_parts"] }),
    pending_disposal: await count("disposal_order", { f: "state", op: "in", v: ["requested", "approved", "sanitizing", "awaiting_certificate"] }),
    money: null,
    compliance: null,
    renewals_90: null,
  };
  if (await hasGroup(ctx, "financial")) {
    const m = await aggregate(ctx, "asset", { filter: live, metrics: [{ fn: "sum", field: "purchase_cost" }, { fn: "sum", field: "book_value" }] });
    out.money = { purchase_cost: String(m.totals?.["sum:purchase_cost"] ?? "0"), book_value: String(m.totals?.["sum:book_value"] ?? "0") };
  }
  if (await holds(ctx, "software", "read")) {
    const runs = await list(ctx, "license_reconcile_run", { filter: { f: "status", op: "eq", v: "done" }, sort: "-started_at", size: 1, total: false });
    const r = runs.rows[0];
    out.compliance = r ? { products: Number(r.products ?? 0), under_licensed: Number(r.under_licensed ?? 0), exposure: (r.exposure as string) ?? null, savings: (r.savings as string) ?? null, run_at: (r.finished_at as string) ?? null } : { products: 0, under_licensed: 0, exposure: null, savings: null, run_at: null };
  }
  if (await holds(ctx, "contract", "read")) out.renewals_90 = await count("contract", { and: [{ f: "state", op: "eq", v: "active" }, { f: "end_date", op: "between", v: [today, addDays(today, 90)] }] });
  // discovered hardware waiting for an asset manager's first reviewed batch (the daily step creates nothing before it)
  if (await holds(ctx, "asset", "write", "group")) {
    const [cfg] = await liveRows(ctx.db, sysOf(ctx), "itam_config", null, { order: "t.created_at", limit: 1 });
    out.discovered_pending = cfg && cfg.auto_assets !== false && !cfg.auto_assets_confirmed_at && Number(cfg.auto_assets_pending ?? 0) > 0 ? Number(cfg.auto_assets_pending) : null;
  }
  return c.json(out);
});

// ----- the person's own assets (ITAM-009/010) -------------------------------------------------------------------

itamRoutes.get("/my-assets", async (c) => c.json(await myAssets(c.get("ctx"))));

itamRoutes.post("/assets/:id/report", async (c) => {
  const input = await body(c, z.object({ kind: z.enum(["lost", "broken", "not_mine"]), note: z.string().max(4000).nullish() }));
  return c.json(await reportAsset(c.get("ctx"), id(c.req.param("id")), input.kind, input.note ?? null));
});

itamRoutes.post("/acks/:id/decide", async (c) => {
  const input = await body(c, z.object({ decision: z.enum(["accept", "decline"]), signature_name: z.string().max(160).nullish(), note: z.string().max(2000).nullish() }));
  return c.json({ ack: await decideAck(c.get("ctx"), id(c.req.param("id")), input) });
});

// ----- check-out and check-in (ITAM-008) ------------------------------------------------------------------------

itamRoutes.post("/assets/:id/checkout", async (c) => {
  const input = await body(c, z.object({
    assigned_to: UUID.nullish(), location_id: UUID.nullish(), department_id: UUID.nullish(), usage_type: z.enum(["permanent", "loaner"]).optional(),
    expected_return_at: DATE.nullish(), condition: z.string().max(20).nullish(), note: z.string().max(2000).nullish(), request_item_id: UUID.nullish(),
  }));
  return c.json({ asset: await checkout(c.get("ctx"), id(c.req.param("id")), input) });
});

itamRoutes.post("/assets/:id/checkin", async (c) => {
  const input = await body(c, z.object({ stockroom_id: UUID, condition: z.string().max(20).nullish(), substate: z.string().max(40).nullish(), note: z.string().max(2000).nullish() }));
  return c.json({ asset: await checkin(c.get("ctx"), id(c.req.param("id")), input) });
});

itamRoutes.get("/assets/:id/360", async (c) => c.json(await asset360(c.get("ctx"), id(c.req.param("id")))));

itamRoutes.post("/assets/:id/summary", async (c) => {
  const ctx = c.get("ctx");
  const assetId = id(c.req.param("id"));
  await get(ctx, "asset", assetId);
  return c.json(await itamText(ctx, "itam.asset_summary", { table: "asset", id: assetId }, async () => assetSummaryText(await asset360(ctx, assetId))));
});

itamRoutes.post("/assets/:id/link-ci", async (c) => {
  const ctx = c.get("ctx");
  const assetId = id(c.req.param("id"));
  const { row } = await get(ctx, "asset", assetId);
  const { def } = await defFor(ctx, "asset");
  if (!access().canWrite(ctx, def, row)) throw forbidden("اجازهٔ تغییر این دارایی را ندارید");
  return c.json(await linkCi(sysOf(ctx, ctx.user.id), assetId));
});

// ----- stock and procurement (ITAM-013/015/024/025/026) --------------------------------------------------------

itamRoutes.get("/stock", async (c) => c.json(await stockDashboard(c.get("ctx"))));

itamRoutes.post("/stock/requisition", async (c) => {
  const input = await body(c, z.object({ rule_ids: z.array(UUID).min(1).max(200) }));
  return c.json(await requisitionFromRules(c.get("ctx"), input.rule_ids.map((x) => x.toLowerCase())));
});

itamRoutes.post("/stock/check", async (c) => {
  const ctx = c.get("ctx");
  await needManage(ctx);
  return c.json(await checkStockRules(sysOf(ctx, ctx.user.id)));
});

itamRoutes.post("/po/:id/receive", async (c) => {
  const input = await body(c, z.object({
    stockroom_id: UUID.nullish(), note: z.string().max(2000).nullish(),
    lines: z.array(z.object({ po_line_id: UUID, quantity: z.number().int().min(0).max(10000), serials: z.array(z.string().max(120)).max(10000).optional(), asset_tags: z.array(z.string().max(60)).max(10000).optional() })).min(1).max(500),
  }));
  return c.json(await receive(c.get("ctx"), id(c.req.param("id")), input));
});

itamRoutes.post("/requisitions/:id/order", async (c) => c.json(await ordersFromRequisition(c.get("ctx"), id(c.req.param("id")))));

itamRoutes.post("/audits/:id/scan", async (c) => {
  const input = await body(c, z.object({ code: z.string().min(1).max(500) }));
  return c.json(await scan(c.get("ctx"), id(c.req.param("id")), input.code));
});

// ----- software (ITAM-050/058/059/062) --------------------------------------------------------------------------

itamRoutes.get("/compliance", async (c) => c.json(await compliance(c.get("ctx"))));

itamRoutes.post("/compliance/run", async (c) => {
  const ctx = c.get("ctx");
  await needManage(ctx, "software");
  return c.json(await reconcile(sysOf(ctx, ctx.user.id), "manual"));
});

itamRoutes.post("/software/sync", async (c) => {
  const ctx = c.get("ctx");
  await needManage(ctx, "software");
  const sys = sysOf(ctx, ctx.user.id);
  const sync = await syncInstalls(sys);
  const run = await reconcile(sys, "manual");
  return c.json({ sync, run });
});

itamRoutes.post("/compliance/narrative", async (c) => {
  const ctx = c.get("ctx");
  return c.json(await itamText(ctx, "itam.license_optimization", {}, async () => licenceNarrative(await licenceFacts(ctx))));
});

// ----- labels (ITAM-028) ----------------------------------------------------------------------------------------

itamRoutes.get("/labels", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ ids: z.string().max(40_000).optional(), stockroom: UUID.optional(), model: UUID.optional() }));
  const ids = (q.ids ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(isUuid).slice(0, 1000);
  const filter: Cond[] = [{ f: "state", op: "nin", v: ["disposed", "canceled"] }];
  if (q.stockroom) filter.push({ f: "stockroom_id", op: "eq", v: q.stockroom.toLowerCase() });
  if (q.model) filter.push({ f: "model_id", op: "eq", v: q.model.toLowerCase() });
  if (!ids.length && filter.length === 1) throw bad("دارایی‌ها، انبار یا مدل را مشخص کنید");
  const r = await list(ctx, "asset", { ids: ids.length ? ids : undefined, filter: { and: filter }, size: 1000, total: false, sort: "number", fields: ["number", "name", "asset_tag", "serial_number", "model_id", "location_id"] });
  const cfg = await itamConfig(ctx.db, ctx);
  const t = await list(ctx, "label_template", { filter: { f: "active", op: "eq", v: true }, size: 50, total: false, fields: ["name", "is_default", "cols_count", "rows_count", "label_width_mm", "label_height_mm", "margin_top_mm", "margin_side_mm", "gap_x_mm", "gap_y_mm", "fields", "title"] });
  const data: LabelData = {
    assets: r.rows.map((a) => ({
      id: String(a.id), number: (a.number as string) ?? null, name: String(a.name ?? ""), asset_tag: (a.asset_tag as string) ?? null, serial_number: (a.serial_number as string) ?? null,
      model: a.model_id ? r.display[String(a.model_id)] ?? null : null, location: a.location_id ? r.display[String(a.location_id)] ?? null : null,
      payload: qrPayload(cfg.qr_base_url, ctx.org.id, { id: String(a.id), asset_tag: a.asset_tag as string, number: a.number as string }),
    })),
    templates: t.rows.map((x) => ({
      id: String(x.id), name: String(x.name ?? ""), is_default: !!x.is_default, cols_count: Number(x.cols_count ?? 3), rows_count: Number(x.rows_count ?? 8),
      label_width_mm: String(x.label_width_mm ?? "63.5"), label_height_mm: String(x.label_height_mm ?? "33.9"), margin_top_mm: String(x.margin_top_mm ?? "13"), margin_side_mm: String(x.margin_side_mm ?? "7"),
      gap_x_mm: String(x.gap_x_mm ?? "2.5"), gap_y_mm: String(x.gap_y_mm ?? "0"), fields: Array.isArray(x.fields) ? (x.fields as string[]) : ["tag", "name"], title: (x.title as string) ?? null,
    })),
  };
  return c.json(data);
});

// ----- requested items: hand-over from stock (ITAM-020/021) -----------------------------------------------------

itamRoutes.get("/request-items/:id/assets", async (c) => {
  const ctx = c.get("ctx");
  const itemId = id(c.req.param("id"));
  const { row } = await get(ctx, "request_item", itemId);
  const sys = sysOf(ctx);
  const bindings = isUuid(row.cat_item_id) ? await liveRows(ctx.db, sys, "catalog_item_model", { f: "catalog_item_id", op: "eq", v: row.cat_item_id } as Cond, { limit: 20 }) : [];
  const models = bindings.length ? await list(ctx, "asset_model", { ids: bindings.map((b) => String(b.model_id)), size: 20, total: false, fields: ["name"] }).catch(() => null) : null;
  const linked = await list(ctx, "asset", { filter: { f: "request_item_id", op: "eq", v: itemId }, size: 50, total: false, fields: ["number", "name", "asset_tag", "state", "substate", "assigned_to"] }).catch(() => null);
  const free = bindings.length ? await list(ctx, "asset", { filter: { and: [{ f: "model_id", op: "in", v: bindings.map((b) => b.model_id) }, { f: "state", op: "eq", v: "in_stock" }, { f: "substate", op: "eq", v: "available" }] }, size: 30, total: false, fields: ["number", "name", "asset_tag", "stockroom_id"] }).catch(() => null) : null;
  const out: RequestItemAssets = {
    item: { id: itemId, number: (row.number as string) ?? null, requested_for: (row.requested_for as string) ?? null, state: String(row.state) },
    models: (models?.rows ?? []).map((m) => ({ id: String(m.id), name: String(m.name ?? "") })),
    assets: (linked?.rows ?? []).map((a) => ({ id: String(a.id), number: (a.number as string) ?? null, name: String(a.name ?? ""), asset_tag: (a.asset_tag as string) ?? null, state: String(a.state), substate: (a.substate as string) ?? null, assigned_to: (a.assigned_to as string) ?? null })),
    candidates: (free?.rows ?? []).map((a) => ({ id: String(a.id), number: (a.number as string) ?? null, name: String(a.name ?? ""), asset_tag: (a.asset_tag as string) ?? null, stockroom: a.stockroom_id ? free!.display[String(a.stockroom_id)] ?? null : null })),
  };
  return c.json(out);
});

itamRoutes.post("/request-items/:id/assign", async (c) => {
  const ctx = c.get("ctx");
  const itemId = id(c.req.param("id"));
  const input = await body(c, z.object({ asset_id: UUID }));
  const { row } = await get(ctx, "request_item", itemId);
  const who = row.requested_for ?? row.caller_id;
  if (!isUuid(who)) throw bad("درخواست‌کنندهٔ این قلم مشخص نیست");
  return c.json({ asset: await checkout(ctx, input.asset_id.toLowerCase(), { assigned_to: who, location_id: (row.location_id as string) ?? null, request_item_id: itemId, note: `تحویل با ${row.number ?? ""}` }) });
});

// ----- leavers and discovery (ITAM-002/011) ---------------------------------------------------------------------

itamRoutes.post("/leaver/:userId", async (c) => {
  const input = await body(c, z.object({ due_date: DATE.nullish() }));
  return c.json(await leaverReturn(c.get("ctx"), id(c.req.param("userId")), input.due_date ?? null));
});

// the asset manager's reviewed batch: makes assets for discovered hardware and confirms the daily step
itamRoutes.post("/discovered", async (c) => {
  const ctx = c.get("ctx");
  await needManage(ctx);
  return c.json(await confirmDiscovered(ctx, 500));
});

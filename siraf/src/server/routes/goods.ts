// /api/o/:org/goods — routes of the goods module (see src/server/modules/goods/):
// invoices (sales, purchases, returns, quotes, orders), stock documents, costing, price lists,
// look-ups for the editors, inventory and commerce reports and the dashboard summary.
import { z } from "zod";
import { router, body } from "../http/hono";
import { forbidden } from "../http/errors";
import { isUuid } from "@shared/id";
import type { Area, Level } from "@shared/permissions";
import { todayISO } from "@shared/jalali";
import { INVOICE_KINDS, needAny, orgTimezone } from "../modules/goods/common";
import {
  convertInvoice, createInvoice, deleteInvoice, getInvoice, invoiceSchema, listInvoices, returnableLines, setInvoiceStatus, updateInvoice,
} from "../modules/goods/invoices";
import {
  countSheet, createStockDoc, deleteStockDoc, getStockDoc, listStockDocs, setStockDocStatus, stockDocSchema, updateStockDoc,
} from "../modules/goods/stockdocs";
import { getPriceListItems, itemLookup, lookupPrices, partyInfo, priceListAllItems, replacePriceListItems } from "../modules/goods/prices";
import { analysis, goodsSummary, kardex, stockReport } from "../modules/goods/reports";
import { moadianInvoice } from "../modules/goods/moadian";
import { recomputeAll } from "../modules/goods/stock";

export const goodsRoutes = router();

// Nothing outside this module calls /goods: coins are sold through /gold, treasury finds open
// invoices with /treasury/invoices, online orders go through the integrations routes.
goodsRoutes.use("*", async (c, next) => {
  if (!c.get("ctx").hasModule("goods")) throw forbidden("ماژول کالا و بازرگانی برای این کسب‌وکار فعال نیست");
  await next();
});

const LOOKUP_AREAS: [Area, Level][] = [["sales", "view"], ["purchases", "view"], ["inventory", "view"]];

// ---------------------------------------------------------------- dashboard

goodsRoutes.get("/summary", async (c) => c.json(await goodsSummary(c.get("ctx"))));

// ---------------------------------------------------------------- look-ups for the editors

const lookupQuery = (q: Record<string, string>, tz: string) => ({
  kinds: q.kinds ? q.kinds.split(",") : undefined,
  warehouseId: q.warehouse_id || null,
  invoiceKind: q.invoice_kind && (INVOICE_KINDS as readonly string[]).includes(q.invoice_kind) ? q.invoice_kind : null,
  partyId: q.party_id || null,
  priceListId: q.price_list_id || null,
  date: q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayISO(tz),
});

/** ?q=… (name, code, barcode, SKU) or ?ids=a,b — with stock and the price for ?invoice_kind=&party_id= */
goodsRoutes.get("/items/lookup", async (c) => {
  const ctx = c.get("ctx");
  needAny(ctx, LOOKUP_AREAS);
  const q = c.req.query();
  const rows = await itemLookup(ctx, {
    ...lookupQuery(q, orgTimezone(ctx)),
    q: q.q,
    ids: q.ids ? q.ids.split(",").filter(isUuid) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json({ rows });
});

/** Exact barcode / code / SKU (barcode scanners). */
goodsRoutes.get("/items/by-code", async (c) => {
  const ctx = c.get("ctx");
  needAny(ctx, LOOKUP_AREAS);
  const q = c.req.query();
  const rows = await itemLookup(ctx, { ...lookupQuery(q, orgTimezone(ctx)), code: q.code ?? "", limit: 1 });
  return c.json({ item: rows[0] ?? null });
});

goodsRoutes.get("/parties/:id/info", async (c) => {
  const ctx = c.get("ctx");
  needAny(ctx, [["parties", "view"], ["sales", "view"], ["purchases", "view"]]);
  return c.json(await partyInfo(ctx, c.req.param("id")));
});

/** Default prices: ?kind=sale&party_id=&price_list_id=&date=&items=a,b&qty= */
goodsRoutes.get("/prices", async (c) => {
  const ctx = c.get("ctx");
  needAny(ctx, [["sales", "view"], ["purchases", "view"]]);
  const q = c.req.query();
  const ids = (q.items ?? "").split(",").filter(isUuid);
  const prices = await lookupPrices(ctx.db, ctx, {
    kind: q.kind || "sale",
    partyId: q.party_id || null,
    priceListId: q.price_list_id || null,
    date: q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : todayISO(orgTimezone(ctx)),
    items: ids.map((item_id) => ({ item_id, qty: q.qty || "1" })),
  });
  return c.json({ prices: Object.fromEntries(prices) });
});

// ---------------------------------------------------------------- price lists

goodsRoutes.get("/price-lists/:id/items", async (c) => c.json(await getPriceListItems(c.get("ctx"), c.req.param("id"))));

/** Every active good and service, for «افزودن همه‌ی کالاها» (sales edit, no inventory permission needed). */
goodsRoutes.get("/price-lists/:id/all-items", async (c) => c.json(await priceListAllItems(c.get("ctx"), c.req.param("id"))));

goodsRoutes.put("/price-lists/:id/items", async (c) => {
  const input = await body(c, z.object({
    items: z.array(z.object({
      item_id: z.string().uuid("کالا را انتخاب کنید"),
      price: z.union([z.string().max(40), z.number()]),
      min_qty: z.union([z.string().max(40), z.number()]).nullish(),
    })).max(20000),
  }));
  return c.json(await replacePriceListItems(c.get("ctx"), c.req.param("id"), input.items));
});

// ---------------------------------------------------------------- invoices

goodsRoutes.get("/invoices", async (c) => c.json(await listInvoices(c.get("ctx"), c.req.query())));

goodsRoutes.post("/invoices", async (c) => {
  const input = await body(c, invoiceSchema);
  return c.json({ invoice: await createInvoice(c.get("ctx"), input) });
});

goodsRoutes.get("/invoices/:id", async (c) => c.json({ invoice: await getInvoice(c.get("ctx"), c.req.param("id")) }));

goodsRoutes.put("/invoices/:id", async (c) => {
  const input = await body(c, invoiceSchema);
  return c.json({ invoice: await updateInvoice(c.get("ctx"), c.req.param("id"), input) });
});

goodsRoutes.delete("/invoices/:id", async (c) => c.json(await deleteInvoice(c.get("ctx"), c.req.param("id"))));

goodsRoutes.post("/invoices/:id/post", async (c) => c.json({ invoice: await setInvoiceStatus(c.get("ctx"), c.req.param("id"), "posted") }));
goodsRoutes.post("/invoices/:id/unpost", async (c) => c.json({ invoice: await setInvoiceStatus(c.get("ctx"), c.req.param("id"), "draft") }));
goodsRoutes.post("/invoices/:id/cancel", async (c) => c.json({ invoice: await setInvoiceStatus(c.get("ctx"), c.req.param("id"), "cancelled") }));

goodsRoutes.post("/invoices/:id/convert", async (c) => {
  const input = await body(c, z.object({
    kind: z.enum(INVOICE_KINDS).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست").nullish(),
    status: z.enum(["draft", "posted"]).optional(),
  }));
  return c.json({ invoice: await convertInvoice(c.get("ctx"), c.req.param("id"), input) });
});

goodsRoutes.get("/invoices/:id/returnable", async (c) => c.json(await returnableLines(c.get("ctx"), c.req.param("id"))));

goodsRoutes.get("/invoices/:id/moadian", async (c) => c.json(await moadianInvoice(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- stock documents

goodsRoutes.get("/stock-docs", async (c) => c.json(await listStockDocs(c.get("ctx"), c.req.query())));
goodsRoutes.get("/stock-docs/count-sheet", async (c) => c.json(await countSheet(c.get("ctx"), c.req.query())));

goodsRoutes.post("/stock-docs", async (c) => {
  const input = await body(c, stockDocSchema);
  return c.json({ doc: await createStockDoc(c.get("ctx"), input) });
});

goodsRoutes.get("/stock-docs/:id", async (c) => c.json({ doc: await getStockDoc(c.get("ctx"), c.req.param("id")) }));

goodsRoutes.put("/stock-docs/:id", async (c) => {
  const input = await body(c, stockDocSchema);
  return c.json({ doc: await updateStockDoc(c.get("ctx"), c.req.param("id"), input) });
});

goodsRoutes.delete("/stock-docs/:id", async (c) => c.json(await deleteStockDoc(c.get("ctx"), c.req.param("id"))));
goodsRoutes.post("/stock-docs/:id/post", async (c) => c.json({ doc: await setStockDocStatus(c.get("ctx"), c.req.param("id"), "posted") }));
goodsRoutes.post("/stock-docs/:id/unpost", async (c) => c.json({ doc: await setStockDocStatus(c.get("ctx"), c.req.param("id"), "draft") }));

// ---------------------------------------------------------------- costing

/** Rebuild moving-average costs (all goods, or ?item_id=) and refresh the affected vouchers. */
goodsRoutes.post("/costing/recompute", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("inventory", "full");
  const input = await body(c, z.object({ item_id: z.string().uuid().nullish() }));
  const r = await ctx.write((tx) => recomputeAll(tx, ctx, input.item_id ?? null));
  return c.json({ ok: true, ...r });
});

// ---------------------------------------------------------------- reports

goodsRoutes.get("/reports/stock", async (c) => c.json(await stockReport(c.get("ctx"), c.req.query())));
goodsRoutes.get("/reports/kardex", async (c) => c.json(await kardex(c.get("ctx"), c.req.query())));
goodsRoutes.get("/reports/sales", async (c) => c.json(await analysis(c.get("ctx"), "sales", c.req.query())));
goodsRoutes.get("/reports/purchases", async (c) => c.json(await analysis(c.get("ctx"), "purchases", c.req.query())));

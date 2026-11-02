// /api/o/:org/gold — routes of the gold module (see src/server/modules/gold/).
import { z } from "zod";
import { router, body } from "../http/hono";
import { bad, forbidden } from "../http/errors";
import { D, isNumeric } from "@shared/money";
import { priceBullion, priceJewelry, priceOldGold, quoteBullion, quoteParsian, weightForBudget, type WageType } from "@shared/gold";
import { productQuote } from "@shared/gold-quote";
import { goldSettings, moneyStep, quoteEnv, saveGoldSettings } from "../modules/gold/settings";
import { addRate, deleteRate, fetchLive, latestRate, latestWithChange, listRates } from "../modules/gold/rates";
import { bulkCreateItems, itemByTag, listCoins, listItems, setReserved } from "../modules/gold/items";
import { cancelDoc, createDoc, deleteDoc, docSchema, listDocs, postDoc, prepare, readDoc, updateDoc } from "../modules/gold/docs";
import { coinReport, consignmentReport, partyBalances, salesReport, stockReport, summary } from "../modules/gold/reports";
import { catalogueAction, coinKardex, deleteProduct, productSchema, products, saveProduct, seedCatalogueAction } from "../modules/gold/catalogue";
import { barEditSchema, barLookup, listBars, readBar, setBarReserved, updateBar } from "../modules/gold/bars";
import { coinBubbles, goldPosition } from "../modules/gold/position";
import { KINDS } from "../modules/gold/pricing";

export const goldRoutes = router();

goldRoutes.use("*", async (c, next) => {
  if (!c.get("ctx").hasModule("gold")) throw forbidden("ماژول طلا و جواهر برای این کسب‌وکار فعال نیست");
  await next();
});

const num = z.union([z.string().max(40), z.number()]).nullish();
const page = (q: Record<string, string>) => ({ page: q.page ? Number(q.page) || 1 : 1, size: q.size ? Number(q.size) || 50 : 50 });

// ---------------------------------------------------------------- settings

goldRoutes.get("/settings", (c) => {
  const ctx = c.get("ctx");
  ctx.need("gold", "view");
  return c.json({ settings: goldSettings(ctx.org), kinds: KINDS });
});

goldRoutes.put("/settings", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.can("gold", "full") && !ctx.can("settings", "edit")) throw forbidden();
  const input = await body(
    c,
    z.object({
      profit_pct: num, tax_pct: num, round_step: num, old_deduction_pct: num, purchase_tax_pct: num, usd: num,
      provider: z.enum(["auto", "tgju", "goldapi", "custom"]).nullish(),
      price_source: z
        .object({
          url: z.string().max(500).nullish(),
          unit: z.enum(["rial", "toman"]).nullish(),
          paths: z.record(z.string().max(45), z.string().max(200).nullish()).nullish(),
        })
        .nullish(),
      kyc: z.object({ enabled: z.boolean().nullish(), threshold: num }).nullish(),
      bars: z
        .object({
          basis: z.enum(["actual", "nominal"]).nullish(), fee_sealed_pct: num, fee_opened_pct: num, assay_fee: num, opened_fineness: num,
          premium_bands: z.array(z.object({ max: num, pct: z.union([z.string().max(20), z.number()]) })).max(10).nullish(),
        })
        .nullish(),
      vat_history: z.array(z.object({ from: z.string().max(10), pct: z.union([z.string().max(10), z.number()]) })).max(20).nullish(),
      stale_minutes: num,
      deviation_pct: num,
    }),
  );
  const str = (v: unknown) => (v === undefined ? undefined : v === null ? null : String(v));
  const settings = await ctx.write((tx) =>
    saveGoldSettings(tx, ctx, {
      profit_pct: str(input.profit_pct), tax_pct: str(input.tax_pct), round_step: str(input.round_step), old_deduction_pct: str(input.old_deduction_pct),
      purchase_tax_pct: str(input.purchase_tax_pct), usd: str(input.usd), provider: input.provider, price_source: input.price_source as never,
      stale_minutes: str(input.stale_minutes), deviation_pct: str(input.deviation_pct),
      kyc: input.kyc === undefined ? undefined : input.kyc ? { enabled: input.kyc.enabled ?? true, threshold: str(input.kyc.threshold) } : null,
      bars: input.bars === undefined ? undefined : input.bars
        ? {
            basis: input.bars.basis ?? null, fee_sealed_pct: str(input.bars.fee_sealed_pct), fee_opened_pct: str(input.bars.fee_opened_pct),
            assay_fee: str(input.bars.assay_fee), opened_fineness: str(input.bars.opened_fineness),
            premium_bands: input.bars.premium_bands?.map((b) => ({ max: str(b.max), pct: String(b.pct) })) ?? null,
          }
        : null,
      vat_history: input.vat_history === undefined ? undefined : (input.vat_history ?? []).map((v) => ({ from: v.from, pct: String(v.pct) })),
    }),
  );
  return c.json({ settings });
});

// ---------------------------------------------------------------- rates

goldRoutes.get("/rates", async (c) => {
  const q = c.req.query();
  return c.json(await listRates(c.get("ctx"), { ...page(q), from: q.from || null, to: q.to || null }));
});

goldRoutes.get("/rates/latest", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("gold", "view");
  return c.json(await latestWithChange(ctx.db, ctx.org.id));
});

goldRoutes.post("/rates", async (c) => {
  const input = await body(
    c,
    z.object({
      at: z.string().max(40).nullish(), mazaneh: num, gram18: num, gram24: num, ounce_usd: num, usd: num, buy_gram18: num,
      coins: z.record(z.string().max(40), num).nullish(), coins_buy: z.record(z.string().max(40), num).nullish(), note: z.string().max(300).nullish(),
      confirm: z.boolean().nullish(),
    }),
  );
  return c.json({ rate: await addRate(c.get("ctx"), input) });
});

goldRoutes.post("/rates/fetch", async (c) => {
  const input = await body(c, z.object({ provider: z.enum(["auto", "tgju", "goldapi", "custom"]).nullish(), usd: num, save: z.boolean().nullish() }));
  return c.json(await fetchLive(c.get("ctx"), { provider: input.provider ?? undefined, usd: input.usd, save: input.save ?? true }));
});

goldRoutes.delete("/rates/:id", async (c) => c.json(await deleteRate(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- price calculator

goldRoutes.post("/calc", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("gold", "view");
  const raw = await c.req.json().catch(() => {
    throw bad("بدنه‌ی درخواست JSON معتبر نیست");
  });
  const s = goldSettings(ctx.org);
  const step = moneyStep(s, ctx.org.money_decimals);
  const n = (v: unknown, d = "0") => (isNumeric(v) ? D(v as string).toString() : d);
  switch (raw?.type) {
    case "jewelry":
      return c.json({
        result: priceJewelry({
          weight: n(raw.weight), fineness: n(raw.fineness, "750"), gram18: n(raw.gram18), wageType: (["percent", "per_gram", "fixed"].includes(raw.wage_type) ? raw.wage_type : "percent") as WageType,
          wageValue: n(raw.wage_value), profitPct: n(raw.profit_pct, s.profit_pct), taxPct: n(raw.tax_pct, s.tax_pct), stonePrice: n(raw.stone), discount: n(raw.discount), roundStep: step,
        }),
      });
    case "old":
      return c.json({ result: priceOldGold({ weight: n(raw.weight), fineness: n(raw.fineness, "750"), gram18: n(raw.gram18), deductionPct: n(raw.deduction_pct, s.old_deduction_pct), roundStep: step }) });
    case "bullion":
      return c.json({ result: { total: priceBullion(n(raw.weight), n(raw.fineness, "750"), n(raw.mazaneh), step) } });
    case "budget":
      return c.json({
        result: {
          weight: weightForBudget(n(raw.budget), {
            fineness: n(raw.fineness, "750"), gram18: n(raw.gram18), wageType: (["percent", "per_gram", "fixed"].includes(raw.wage_type) ? raw.wage_type : "percent") as WageType,
            wageValue: n(raw.wage_value), profitPct: n(raw.profit_pct, s.profit_pct), taxPct: n(raw.tax_pct, s.tax_pct),
          }),
        },
      });
    case "parsian":
      return c.json({
        result: quoteParsian({
          sut: n(raw.sut), qty: n(raw.qty, "1"), gram18: n(raw.gram18), wageType: (["percent", "per_gram", "fixed"].includes(raw.wage_type) ? raw.wage_type : "percent") as WageType,
          wageValue: n(raw.wage_value), profitPct: n(raw.profit_pct), taxPct: n(raw.tax_pct, s.tax_pct), vatMode: raw.vat_mode === "exempt" ? "exempt" : "wage_profit", roundStep: step,
        }),
      });
    case "bullion_quote":
      return c.json({
        result: quoteBullion({ weight: n(raw.weight), fineness: n(raw.fineness, "750"), mazaneh: isNumeric(raw.mazaneh) ? n(raw.mazaneh) : undefined, buyGram18: isNumeric(raw.buy_gram18) ? n(raw.buy_gram18) : undefined, deductionPct: n(raw.deduction_pct), roundStep: step }),
      });
    case "product": {
      // today's quote of a catalogue coin or bar model (sell or buy) with the breakdown and bubble
      if (typeof raw.item_id !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.item_id)) throw bad("سکه یا شمش را انتخاب کنید");
      const prod = (await products(ctx.db, ctx.org.id, ["coin", "bar"], [raw.item_id]))[0];
      if (!prod) throw bad("سکه یا شمش پیدا نشد");
      const rate = await latestRate(ctx.db, ctx.org.id);
      const q = productQuote(prod, rate, quoteEnv(ctx.org), {
        side: raw.side === "buy" ? "buy" : "sell", qty: n(raw.qty, "1"), weight: isNumeric(raw.weight) ? n(raw.weight) : undefined,
        fineness: isNumeric(raw.fineness) ? n(raw.fineness) : undefined, seal_status: typeof raw.seal_status === "string" ? raw.seal_status : null,
      });
      if (!q) throw bad(`برای «${prod.name}» قیمتی در تابلو نیست`);
      return c.json({ result: q });
    }
    case "doc": {
      const parsed = docSchema.safeParse(raw.doc);
      if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? "اطلاعات سند معتبر نیست");
      const p = await prepare(ctx.db, ctx, parsed.data, typeof raw.doc_id === "string" && /^[0-9a-f-]{36}$/i.test(raw.doc_id) ? raw.doc_id : null, { preview: true });
      return c.json({ result: { header: p.header, lines: p.lines, totals: p.totals } });
    }
    default:
      throw bad("نوع محاسبه معتبر نیست (jewelry, old, bullion, budget, parsian, bullion_quote, product, doc)");
  }
});

// ---------------------------------------------------------------- items and coins

goldRoutes.get("/items", async (c) => {
  const q = c.req.query();
  return c.json(await listItems(c.get("ctx"), { ...q, ...page(q) }));
});

goldRoutes.get("/items/by-tag/:tag", async (c) => c.json(await itemByTag(c.get("ctx"), decodeURIComponent(c.req.param("tag")), c.req.query("gram18") ?? null)));

goldRoutes.post("/items/bulk", async (c) => {
  const item = z.object({
    tag_no: z.string().max(40).nullish(), category_id: z.string().uuid().nullish(), title: z.string().max(200).nullish(), fineness: num,
    gross_weight: num, stone_weight: num, wage_type: z.enum(["percent", "per_gram", "fixed"]).nullish(), wage_value: num, profit_pct: num,
    stone_desc: z.string().max(200).nullish(), stone_price: num, supplier_id: z.string().uuid().nullish(), ownership: z.enum(["own", "consignment"]).nullish(),
    cost: num, notes: z.string().max(500).nullish(),
  });
  const input = await body(c, z.object({ defaults: item.partial().nullish(), items: z.array(item.partial()).min(1).max(500) }));
  return c.json(await bulkCreateItems(c.get("ctx"), { defaults: input.defaults ?? undefined, items: input.items as never }));
});

goldRoutes.post("/items/:id/reserve", async (c) => {
  const input = await body(c, z.object({ note: z.string().max(300).nullish() }));
  return c.json({ item: await setReserved(c.get("ctx"), c.req.param("id"), true, input.note) });
});
goldRoutes.post("/items/:id/release", async (c) => c.json({ item: await setReserved(c.get("ctx"), c.req.param("id"), false) }));

goldRoutes.get("/coins", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("gold", "view");
  return c.json({ coins: await listCoins(ctx.db, ctx.org.id, c.req.query("to") || null) });
});
goldRoutes.get("/coins/:id/kardex", async (c) => c.json(await coinKardex(c.get("ctx"), c.req.param("id"), { from: c.req.query("from") || null, to: c.req.query("to") || null })));

// ---------------------------------------------------------------- catalogue (coins and bar models)

goldRoutes.get("/catalogue", async (c) => {
  const q = c.req.query();
  return c.json(await catalogueAction(c.get("ctx"), { kind: q.kind || null, to: q.to || null, active: q.active || null }));
});
goldRoutes.post("/catalogue/seed", async (c) => c.json(await seedCatalogueAction(c.get("ctx"))));
goldRoutes.post("/catalogue", async (c) => c.json({ product: await saveProduct(c.get("ctx"), null, await body(c, productSchema)) }));
goldRoutes.put("/catalogue/:id", async (c) => c.json({ product: await saveProduct(c.get("ctx"), c.req.param("id"), await body(c, productSchema)) }));
goldRoutes.delete("/catalogue/:id", async (c) => c.json(await deleteProduct(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- bars

goldRoutes.get("/bars", async (c) => {
  const q = c.req.query();
  return c.json(await listBars(c.get("ctx"), { ...q, ...page(q) }));
});
goldRoutes.get("/bars/lookup/:code", async (c) => c.json(await barLookup(c.get("ctx"), decodeURIComponent(c.req.param("code")))));
goldRoutes.get("/bars/:id", async (c) => c.json(await readBar(c.get("ctx"), c.req.param("id"))));
goldRoutes.patch("/bars/:id", async (c) => c.json({ bar: await updateBar(c.get("ctx"), c.req.param("id"), await body(c, barEditSchema)) }));
goldRoutes.post("/bars/:id/reserve", async (c) => c.json({ bar: await setBarReserved(c.get("ctx"), c.req.param("id"), true) }));
goldRoutes.post("/bars/:id/release", async (c) => c.json({ bar: await setBarReserved(c.get("ctx"), c.req.param("id"), false) }));

// ---------------------------------------------------------------- documents

goldRoutes.get("/docs", async (c) => {
  const q = c.req.query();
  return c.json(await listDocs(c.get("ctx"), { ...q, ...page(q) }));
});

goldRoutes.get("/docs/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("gold", "view");
  return c.json({ doc: await readDoc(ctx.db, ctx.org.id, c.req.param("id")) });
});

goldRoutes.post("/docs", async (c) => c.json({ doc: await createDoc(c.get("ctx"), await body(c, docSchema)) }));
goldRoutes.put("/docs/:id", async (c) => c.json({ doc: await updateDoc(c.get("ctx"), c.req.param("id"), await body(c, docSchema)) }));
goldRoutes.post("/docs/:id/post", async (c) => c.json({ doc: await postDoc(c.get("ctx"), c.req.param("id")) }));
goldRoutes.post("/docs/:id/cancel", async (c) => c.json({ doc: await cancelDoc(c.get("ctx"), c.req.param("id")) }));
goldRoutes.delete("/docs/:id", async (c) => c.json(await deleteDoc(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- reports

goldRoutes.get("/reports/stock", async (c) => c.json(await stockReport(c.get("ctx"), { to: c.req.query("to") || null })));
goldRoutes.get("/reports/parties", async (c) => c.json(await partyBalances(c.get("ctx"), { to: c.req.query("to") || null, scope: c.req.query("scope") || null })));
goldRoutes.get("/reports/sales", async (c) => {
  const q = c.req.query();
  return c.json(await salesReport(c.get("ctx"), { from: q.from || null, to: q.to || null, group: q.group || null, kinds: q.kinds || null }));
});
goldRoutes.get("/reports/consignment", async (c) => c.json(await consignmentReport(c.get("ctx"))));
goldRoutes.get("/reports/coins", async (c) => c.json(await coinReport(c.get("ctx"), { to: c.req.query("to") || null })));
goldRoutes.get("/reports/bars", async (c) => {
  const q = c.req.query();
  return c.json(await listBars(c.get("ctx"), { ...q, ...page(q), ownership: q.ownership || "own", status: q.to ? undefined : "in_stock,reserved" }));
});
goldRoutes.get("/reports/position", async (c) => c.json(await goldPosition(c.get("ctx"), c.req.query("to") || null)));
goldRoutes.get("/reports/bubbles", async (c) => c.json(await coinBubbles(c.get("ctx"), Number(c.req.query("days") || 30))));
goldRoutes.get("/summary", async (c) => c.json(await summary(c.get("ctx"))));

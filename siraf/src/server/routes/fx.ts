// /api/o/:org/fx — routes of the fx module (see src/server/modules/fx/).
import { z } from "zod";
import { router, body } from "../http/hono";
import { forbidden } from "../http/errors";
import { PROVIDERS } from "../modules/fx/common";
import * as rates from "../modules/fx/rates";
import * as deals from "../modules/fx/deals";
import * as rem from "../modules/fx/remittances";
import * as wallets from "../modules/fx/wallets";
import * as reports from "../modules/fx/reports";
import * as reval from "../modules/fx/revaluation";
import { readSettings, writeSettings } from "../modules/fx/settings";

export const fxRoutes = router();

fxRoutes.use("*", async (c, next) => {
  if (!c.get("ctx").hasModule("fx")) throw forbidden("ماژول صرافی برای این کسب‌وکار فعال نیست");
  await next();
});

const amount = z.union([z.string().max(60), z.number()]).transform((v) => String(v));
const optAmount = z.union([z.string().max(60), z.number()]).nullish().transform((v) => (v === null || v === undefined ? null : String(v)));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");
const uuid = z.string().uuid();
const method = z.enum(["cash", "bank", "wallet", "party"], { message: "روش دریافت/پرداخت را انتخاب کنید" });
const person = z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullish();
const q = (c: { req: { query(): Record<string, string> } }) => c.req.query();

// ---------------------------------------------------------------- settings
fxRoutes.get("/settings", async (c) => c.json(await readSettings(c.get("ctx"))));
fxRoutes.put("/settings", async (c) => {
  const input = await body(
    c,
    z.object({
      providers: z.array(z.enum(PROVIDERS.map((p) => p.id) as [string, ...string[]])).max(12).optional(),
      margin_pct: z.union([z.string(), z.number()]).nullish(),
      refresh_seconds: z.number().int().nullish(),
      kyc_threshold: z.union([z.string(), z.number()]).nullish(),
      allow_negative: z.boolean().optional(),
      custom: z.array(z.object({
        code: z.string().max(12),
        url: z.string().max(1000),
        path: z.string().max(300),
        unit: z.enum(["base", "usd"]).default("base"),
        factor: z.union([z.string(), z.number()]).nullish(),
        // the request header that carries this runtime's key (the key itself goes in `keys`)
        header: z.string().max(100).nullish(),
        label: z.string().max(100).nullish(),
        link: z.string().max(400).nullish(),
      })).max(30).optional(),
      // keys of custom sources on this runtime, per origin: write-only, never returned
      keys: z.array(z.object({ origin: z.string().max(300), key: z.string().max(2000).nullish(), remove: z.boolean().nullish() })).max(30).optional(),
    }),
  );
  return c.json(await writeSettings(c.get("ctx"), input));
});

// ---------------------------------------------------------------- rates
fxRoutes.get("/rates", async (c) => c.json(await rates.ratesBoard(c.get("ctx"))));
fxRoutes.get("/rates/history", async (c) => {
  const p = q(c);
  return c.json(await rates.rateHistory(c.get("ctx"), p.currency_id ?? "", { from: p.from, to: p.to, limit: Number(p.limit) || undefined }));
});
fxRoutes.post("/rates", async (c) => {
  const input = await body(
    c,
    z.object({
      at: z.string().nullish(),
      rates: z.array(z.object({ currency_id: uuid, buy: optAmount, sell: optAmount, mid: optAmount, quote_currency_id: uuid.nullish() })).min(1, "نرخی برای ثبت نیست").max(300),
    }),
  );
  return c.json(await rates.setRates(c.get("ctx"), input));
});
fxRoutes.post("/rates/refresh", async (c) => {
  const input = await body(c, z.object({ currency_ids: z.array(uuid).max(300).optional(), kinds: z.array(z.enum(["fiat", "crypto", "metal"])).max(3).optional() }));
  return c.json(await rates.refreshRates(c.get("ctx"), input.currency_ids ?? [], input.kinds ?? []));
});
fxRoutes.delete("/rates/:id", async (c) => c.json(await rates.deleteRate(c.get("ctx"), c.req.param("id"))));
fxRoutes.get("/prices/live", async (c) => {
  const symbols = (q(c).symbols ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return c.json(await rates.liveQuotes(c.get("ctx"), symbols));
});

// ---------------------------------------------------------------- deals
const dealSchema = z.object({
  date,
  kind: z.enum(["buy", "sell", "exchange"]).nullish(),
  party_id: uuid.nullish(),
  walkin: person,
  in_currency_id: z.string({ message: "ارزی که مشتری می‌دهد را انتخاب کنید" }).uuid("ارزی که مشتری می‌دهد را انتخاب کنید"),
  in_amount: optAmount,
  in_method: method,
  in_ref_id: uuid.nullish(),
  out_currency_id: z.string({ message: "ارزی که مشتری می‌گیرد را انتخاب کنید" }).uuid("ارزی که مشتری می‌گیرد را انتخاب کنید"),
  out_amount: optAmount,
  out_method: method,
  out_ref_id: uuid.nullish(),
  rate: optAmount,
  fee: optAmount,
  fee_currency_id: uuid.nullish(),
  network_fee: optAmount,
  tx_hash: z.string().max(200).nullish(),
  network: z.string().max(20).nullish(),
  address: z.string().max(200).nullish(),
  description: z.string().max(1000).nullish(),
  status: z.enum(["draft", "posted"]).optional(),
});

fxRoutes.get("/deals", async (c) => {
  const p = q(c);
  return c.json(await deals.listDeals(c.get("ctx"), { ...p, page: Number(p.page) || 1, size: Number(p.size) || 50 }));
});
fxRoutes.post("/deals/preview", async (c) => {
  const input = await body(c, dealSchema.extend({ id: uuid.nullish() }));
  return c.json(await deals.previewDeal(c.get("ctx"), input as deals.DealInput, input.id ?? null));
});
fxRoutes.post("/deals", async (c) => c.json(await deals.saveDeal(c.get("ctx"), (await body(c, dealSchema)) as deals.DealInput)));
fxRoutes.get("/deals/:id", async (c) => c.json({ deal: await deals.getDeal(c.get("ctx"), c.req.param("id")) }));
fxRoutes.put("/deals/:id", async (c) => c.json(await deals.saveDeal(c.get("ctx"), (await body(c, dealSchema)) as deals.DealInput, c.req.param("id"))));
fxRoutes.post("/deals/:id/post", async (c) => c.json(await deals.postDeal(c.get("ctx"), c.req.param("id"))));
fxRoutes.post("/deals/:id/cancel", async (c) => {
  const input = await body(c, z.object({ reason: z.string().max(500).nullish() }));
  return c.json({ deal: await deals.cancelDeal(c.get("ctx"), c.req.param("id"), input.reason) });
});
fxRoutes.delete("/deals/:id", async (c) => c.json(await deals.deleteDeal(c.get("ctx"), c.req.param("id"))));
fxRoutes.get("/parties/:id/balances", async (c) => c.json(await deals.partyBalances(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- remittances
const remSchema = z.object({
  date,
  direction: z.enum(["out", "in"], { message: "نوع حواله را انتخاب کنید" }),
  party_id: uuid.nullish(),
  sender: person,
  beneficiary: person,
  correspondent_id: z.string({ message: "همکار را انتخاب کنید" }).uuid("همکار را انتخاب کنید"),
  currency_id: z.string({ message: "ارز حواله را انتخاب کنید" }).uuid("ارز حواله را انتخاب کنید"),
  amount,
  rate: optAmount,
  fee: optAmount,
  correspondent_fee: optAmount,
  pay_method: method,
  pay_ref_id: uuid.nullish(),
  pay_currency_id: uuid.nullish(),
  tracking_code: z.string().max(60).nullish(),
  description: z.string().max(1000).nullish(),
});

fxRoutes.get("/remittances", async (c) => {
  const p = q(c);
  return c.json(await rem.listRemittances(c.get("ctx"), { ...p, page: Number(p.page) || 1, size: Number(p.size) || 50 }));
});
fxRoutes.post("/remittances", async (c) => c.json({ remittance: await rem.saveRemittance(c.get("ctx"), (await body(c, remSchema)) as rem.RemittanceInput) }));
fxRoutes.get("/remittances/:id", async (c) => c.json({ remittance: await rem.getRemittance(c.get("ctx"), c.req.param("id")) }));
fxRoutes.put("/remittances/:id", async (c) => c.json({ remittance: await rem.saveRemittance(c.get("ctx"), (await body(c, remSchema)) as rem.RemittanceInput, c.req.param("id")) }));
fxRoutes.post("/remittances/:id/status", async (c) => {
  const input = await body(c, z.object({ status: z.enum(["pending", "sent", "paid", "cancelled", "returned"]), date: date.nullish(), note: z.string().max(500).nullish() }));
  return c.json({ remittance: await rem.setRemittanceStatus(c.get("ctx"), c.req.param("id"), input) });
});
fxRoutes.delete("/remittances/:id", async (c) => c.json(await rem.deleteRemittance(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- wallets
fxRoutes.get("/wallets", async (c) => c.json(await wallets.listWallets(c.get("ctx"))));
fxRoutes.post("/wallets/refresh-all", async (c) => c.json(await wallets.refreshAllWallets(c.get("ctx"))));
fxRoutes.post("/wallets/:id/refresh", async (c) => c.json(await wallets.refreshWallet(c.get("ctx"), c.req.param("id"))));

// ---------------------------------------------------------------- reports
fxRoutes.get("/reports/positions", async (c) => {
  const p = q(c);
  return c.json(await reports.positions(c.get("ctx"), { date: p.date, from: p.from, to: p.to }));
});
fxRoutes.get("/reports/cash", async (c) => {
  const p = q(c);
  return c.json(await reports.cashReport(c.get("ctx"), { date: p.date, cash_box_id: p.cash_box_id }));
});
fxRoutes.get("/reports/deals", async (c) => {
  const p = q(c);
  return c.json(await reports.dealsReport(c.get("ctx"), { from: p.from, to: p.to, currency_id: p.currency_id }));
});
fxRoutes.get("/reports/correspondents", async (c) => c.json(await reports.correspondentBalances(c.get("ctx"), { date: q(c).date })));
fxRoutes.get("/summary", async (c) => c.json(await reports.summary(c.get("ctx"))));

// ---------------------------------------------------------------- revaluation
const revalSchema = z.object({
  date,
  include_parties: z.boolean().optional(),
  rates: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});
fxRoutes.post("/revaluation/preview", async (c) => c.json(await reval.previewRevaluation(c.get("ctx"), await body(c, revalSchema))));
fxRoutes.post("/revaluation", async (c) => c.json(await reval.postRevaluation(c.get("ctx"), await body(c, revalSchema))));
fxRoutes.get("/revaluations", async (c) => c.json(await reval.listRevaluations(c.get("ctx"))));
fxRoutes.delete("/revaluations/:id", async (c) => c.json(await reval.removeRevaluation(c.get("ctx"), c.req.param("id"))));

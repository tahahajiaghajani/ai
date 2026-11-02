// /api/o/:org/ai/* — AI features: insights and the daily brief, report explanations, forecasts and
// plans, document reading (capture). Stream D owns this file; mounted by ./ai.ts.
// Every route needs ai:view; each feature also obeys its switch in the business's AI settings and
// the permissions of the data it reads (checked by the services).
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { bad } from "../http/errors";
import { aiHttpError } from "../modules/ai/errors";
import { isUuid } from "@shared/id";
import type { AiSettings } from "@shared/ai/types";
import type { Ctx } from "../context";
import { loadSettings } from "../modules/ai/settings";
import { INSIGHT_STATUSES, listInsights, refreshInsights, setInsightStatus } from "../modules/ai/features/insights";
import { dailyBrief } from "../modules/ai/features/brief";
import { explainInput, explainReport } from "../modules/ai/features/explain";
import { FORECAST_SERIES, deadStockList, forecast, forecastNarrative, rateList, reorderList, type ForecastKind } from "../modules/ai/features/forecasts";
import { deletePlan, getPlan, listPlans, makePlan, planInput } from "../modules/ai/features/plan";
import { captureDocument, captureInput } from "../modules/ai/features/capture";
import { businessToday } from "../modules/ai/tools/common";

export const aiFeatureRoutes = router();

const FEATURE_FA: Record<keyof AiSettings["features"], string> = {
  assistant: "دستیار", proposals: "پیش‌نویس‌ها", insights: "بینش‌ها", explain: "تحلیل گزارش‌ها", capture: "خواندن سند", forecast: "پیش‌بینی و برنامه",
};

function ctxOf(c: C): Ctx {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  return ctx;
}

async function needFeature(ctx: Ctx, key: keyof AiSettings["features"]) {
  const s = await loadSettings(ctx.db, ctx.org.id);
  if (!s.features[key]) throw aiHttpError("disabled", `«${FEATURE_FA[key]}» در تنظیمات هوش مصنوعی این کسب‌وکار خاموش است`);
}

const idParam = (c: C) => {
  const id = c.req.param("id") ?? "";
  if (!isUuid(id)) throw bad("شناسه معتبر نیست");
  return id;
};

// ---------------------------------------------------------------- insights and the brief

aiFeatureRoutes.get("/insights", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await listInsights(ctx, { all: c.req.query("all") === "1" }));
});

aiFeatureRoutes.post("/insights/refresh", async (c) => {
  const ctx = ctxOf(c);
  ctx.need("ai", "edit");
  await needFeature(ctx, "insights");
  await refreshInsights(ctx, { force: true });
  return c.json(await listInsights(ctx));
});

aiFeatureRoutes.post("/insights/:id/status", async (c) => {
  const ctx = ctxOf(c);
  const id = c.req.param("id") ?? "";
  if (!/^[0-9a-f]{32}$/.test(id)) throw bad("شناسه معتبر نیست");
  const input = await body(c, z.object({ status: z.enum(INSIGHT_STATUSES), snooze_until: z.string().max(40).nullish() }));
  return c.json({ insight: await setInsightStatus(ctx, id, input.status, input.snooze_until ?? null) });
});

aiFeatureRoutes.get("/brief", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "insights");
  return c.json({ brief: await dailyBrief(ctx, { refresh: c.req.query("refresh") === "1", signal: c.req.raw.signal }) });
});

// ---------------------------------------------------------------- report explanations

aiFeatureRoutes.post("/explain", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "explain");
  const input = await body(c, explainInput);
  return c.json({ explanation: await explainReport(ctx, input, { signal: c.req.raw.signal }) });
});

// ---------------------------------------------------------------- forecasts and plans

const forecastQuery = z.object({
  grain: z.enum(["month", "week"]).optional(),
  horizon: z.coerce.number().int().min(1).max(26).optional(),
  item: z.string().max(120).optional(),
  category: z.string().max(120).optional(),
  rate: z.string().max(60).optional(),
});

function seriesParam(c: C): ForecastKind {
  const s = c.req.param("series") ?? "";
  if (!(FORECAST_SERIES as readonly string[]).includes(s)) throw bad("نوع پیش‌بینی معتبر نیست");
  return s as ForecastKind;
}

aiFeatureRoutes.get("/forecast/rates", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "forecast");
  return c.json({ rates: await rateList(ctx, businessToday(ctx)) });
});

aiFeatureRoutes.get("/forecast/reorder", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "forecast");
  return c.json({ items: await reorderList(ctx, businessToday(ctx)) });
});

aiFeatureRoutes.get("/forecast/dead_stock", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "forecast");
  return c.json({ items: await deadStockList(ctx, businessToday(ctx)) });
});

aiFeatureRoutes.get("/forecast/:series", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "forecast");
  const kind = seriesParam(c);
  const p = query(c, forecastQuery);
  return c.json(await forecast(ctx, kind, p, businessToday(ctx)));
});

aiFeatureRoutes.post("/forecast/:series/narrative", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "forecast");
  const kind = seriesParam(c);
  const p = await body(c, forecastQuery);
  const r = await forecastNarrative(ctx, kind, p, businessToday(ctx), c.req.raw.signal);
  return c.json({ markdown: r.markdown, source: r.source, model: r.model, note_fa: r.note_fa, series: r.forecast.series });
});

aiFeatureRoutes.post("/plan", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "forecast");
  const input = await body(c, planInput);
  return c.json({ plan: await makePlan(ctx, input, { signal: c.req.raw.signal }) });
});

aiFeatureRoutes.get("/plans", async (c) => c.json({ plans: await listPlans(ctxOf(c)) }));
aiFeatureRoutes.get("/plans/:id", async (c) => c.json({ plan: await getPlan(ctxOf(c), idParam(c)) }));
aiFeatureRoutes.delete("/plans/:id", async (c) => {
  await deletePlan(ctxOf(c), idParam(c));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- document reading

aiFeatureRoutes.post("/capture", async (c) => {
  const ctx = ctxOf(c);
  await needFeature(ctx, "capture");
  const input = await body(c, captureInput);
  return c.json({ capture: await captureDocument(ctx, input, { signal: c.req.raw.signal }) });
});

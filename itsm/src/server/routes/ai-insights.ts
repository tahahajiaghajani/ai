// HTTP API of the insights under /api/o/:org/ai/insights (docs/spec/AI.md §16; contracts in @shared/ai/insights). The
// cards of the last two weeks a member may see (the visibility rule of src/server/modules/ai/insights/views.ts), a
// model's narrative of one of them on request, and — for AI administrators — computing a period or sending its
// digests now.
import { z } from "zod";
import { router, body, query, errorResponse } from "../http/hono";
import { forbidden, notFound } from "../http/errors";
import type { InsightsResult } from "@shared/ai/insights";
import { orgTz, systemCtx } from "../engine";
import { todayISO } from "@shared/jalali";
import { loadSettings } from "../modules/ai/settings";
import { canSee, ensureInsightsTick, insightRows, insightTables, narrateInsight, periodOf, runPeriod, sendDigests, viewOf, visibleInsights } from "../modules/ai/insights";
import { storeNarrative } from "../modules/ai/insights/views";

export const insightRoutes = router();

insightRoutes.onError(errorResponse);

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");

insightRoutes.get("/insights", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.can("ai", "view")) throw forbidden("به هوش مصنوعی دسترسی ندارید");
  await ensureInsightsTick(ctx.db, ctx.org.id).catch(() => undefined);
  const q = query(c, z.object({ period: z.enum(["daily", "weekly"]).optional(), days: z.coerce.number().int().min(1).max(60).optional() }));
  const since = new Date(Date.now() - (q.days ?? 14) * 86_400_000).toISOString();
  const rows = await insightRows(ctx, { period: q.period, since, limit: 200 });
  const { views, hidden } = await visibleInsights(ctx, rows);
  const out: InsightsResult = { insights: views, hidden, enabled: (await loadSettings(ctx.db, ctx.org.id)).insights.enabled, can_run: ctx.can("ai", "full") };
  return c.json(out);
});

insightRoutes.post("/insights/:id/narrate", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.can("ai", "view")) throw forbidden("به هوش مصنوعی دسترسی ندارید");
  const [row] = await insightRows(ctx, { id: UUID.parse(c.req.param("id")).toLowerCase(), limit: 1 });
  if (!row || !(await canSee(ctx, row))) throw notFound("بینش پیدا نشد");
  const view = await viewOf(ctx, row);
  if (row.narrative_ai && row.narrative) return c.json({ text: row.narrative, ai: true });
  const text = await narrateInsight(ctx, view, insightTables(row));
  if (!text) return c.json({ text: row.narrative ?? "", ai: false });
  await storeNarrative(ctx, row.id, text);
  return c.json({ text, ai: true });
});

insightRoutes.post("/insights/run", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const input = await body(c, z.object({ period: z.enum(["daily", "weekly"]) }));
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const tz = orgTz(sys);
  const n = await runPeriod(ctx.cfg, ctx.org.id, periodOf(input.period, todayISO(tz), tz));
  return c.json({ insights: n });
});

insightRoutes.post("/insights/digest", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const input = await body(c, z.object({ period: z.enum(["daily", "weekly"]) }));
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const tz = orgTz(sys);
  const p = periodOf(input.period, todayISO(tz), tz);
  const r = await sendDigests(ctx.cfg, ctx.org.id, p);
  return c.json({ sent: r.sent });
});

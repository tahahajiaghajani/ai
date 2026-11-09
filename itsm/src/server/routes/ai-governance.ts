// HTTP API of the AI governance console under /api/o/:org/ai/governance (docs/spec/AI.md §14; contracts in
// @shared/ai/governance). AI administrators only (ai:full): inventory, usage and cost, evaluation and model metrics,
// feedback counts, the guard log, the data-use policy per table, human oversight, model cards and the audit export.
import { z } from "zod";
import { router, body, query, errorResponse } from "../http/hono";
import { auditExport, dataPolicies, feedbackReport, governanceOverview, guardLog, modelCards, oversightView, qualityReport, saveDataPolicy, usageReport } from "../modules/ai/governance";

export const governanceRoutes = router();

governanceRoutes.onError(errorResponse);

const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");

governanceRoutes.get("/governance/overview", async (c) => c.json(await governanceOverview(c.get("ctx"))));

governanceRoutes.get("/governance/usage", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(366).optional() }));
  return c.json(await usageReport(c.get("ctx"), q.days ?? 30));
});

governanceRoutes.get("/governance/quality", async (c) => c.json(await qualityReport(c.get("ctx"))));

governanceRoutes.get("/governance/feedback", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(366).optional() }));
  return c.json(await feedbackReport(c.get("ctx"), q.days ?? 90));
});

governanceRoutes.get("/governance/guard-log", async (c) => {
  const q = query(c, z.object({ kind: z.enum(["policy", "access", "guardrail", "refusal", "budget"]).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }));
  return c.json({ entries: await guardLog(c.get("ctx"), q) });
});

governanceRoutes.get("/governance/data-policies", async (c) => c.json({ tables: await dataPolicies(c.get("ctx")) }));

governanceRoutes.put("/governance/data-policies/:table", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ use: z.enum(["cloud", "local", "never"]), pii: z.enum(["inherit", "masked", "aggregates"]).default("inherit"), note: z.string().max(1000).nullish() }));
  await saveDataPolicy(ctx, { table: TABLE.parse(c.req.param("table")), ...input });
  return c.json({ ok: true });
});

governanceRoutes.get("/governance/oversight", async (c) => c.json(await oversightView(c.get("ctx"))));

governanceRoutes.get("/governance/model-cards", async (c) => c.json({ cards: await modelCards(c.get("ctx")) }));

governanceRoutes.get("/governance/export", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(730).optional() }));
  const data = await auditExport(c.get("ctx"), q.days ?? 90);
  c.header("content-disposition", `attachment; filename="ai-governance-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.json(data);
});

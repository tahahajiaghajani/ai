// HTTP API of IT financial management under /api/o/:org/financial (docs/modules/financial_FA.md «API»). Fiscal years,
// periods, cost types, rates, the ledger, budgets and the cost model's rules and runs are served by the generic engine
// API; these routes are budget against actual and its narrative (AI with a rule-based fallback), the spend views, cost
// capture now, reversal of an entry, the allocation run's calculation, posting and statement, a service's cost and
// fiscal years on demand. Money needs the financial field group; actions check the caller's grant.
import { z } from "zod";
import type { FinancialMeta } from "@shared/financial/api";
import { fiscalYearOf, periodKeyOf } from "@shared/financial/logic";
import { router, body, query } from "../http/hono";
import { forbidden } from "../http/errors";
import { list } from "../engine";
import {
  budgetVsActualFor, calculateRun, capture, ensureFiscalYear, financialConfig, postRun, reverseEntry, seedFinancialDefaultsIn, serviceCost, spendFor, statementOf, varianceNarrative,
} from "../modules/financial";
import { hasGroup, holds, orgToday, sysOf } from "../modules/itam/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const YEAR = z.coerce.number().int().min(1300).max(1600);

export const financialRoutes = router();

const needFinance = async (ctx: Parameters<typeof holds>[0]) => {
  if (!(await holds(ctx, "financial", "write", "all"))) throw forbidden("این کار با مدیر مالی فناوری اطلاعات است");
};

financialRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const cfg = await financialConfig(ctx.db, ctx);
  const years = await list(ctx, "fiscal_year", { sort: "-year", size: 20, total: false }).catch(() => null);
  const meta: FinancialMeta = {
    years: (years?.rows ?? []).map((y) => ({ id: String(y.id), year: Number(y.year), name: String(y.name ?? ""), status: String(y.status ?? "open") })),
    current_year: fiscalYearOf(orgToday(ctx)),
    currency_display: cfg.currency_display === "toman" ? "toman" : "rial",
    can_manage: await holds(ctx, "financial", "write", "all"),
    can_approve: await holds(ctx, "financial", "approve"),
    financial: await hasGroup(ctx, "financial"),
    ai: ["financial.variance"],
  };
  return c.json(meta);
});

financialRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  await needFinance(ctx);
  const r = await ctx.write((tx) => seedFinancialDefaultsIn(tx, ctx, { force: true }));
  return c.json({ created: r.created });
});

financialRoutes.get("/bva", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ year: YEAR.optional(), from: z.coerce.number().int().min(1).max(12).optional(), to: z.coerce.number().int().min(1).max(12).optional(), cost_center: UUID.optional() }));
  return c.json(await budgetVsActualFor(ctx, q.year ?? fiscalYearOf(orgToday(ctx)), { from: q.from, to: q.to, costCenterId: q.cost_center?.toLowerCase() ?? null }));
});

financialRoutes.post("/bva/narrative", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ year: YEAR.optional(), cost_center_id: UUID.nullish() }));
  return c.json(await varianceNarrative(ctx, input.year ?? fiscalYearOf(orgToday(ctx)), input.cost_center_id?.toLowerCase() ?? null));
});

financialRoutes.get("/spend", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ year: YEAR.optional() }));
  return c.json(await spendFor(ctx, q.year ?? fiscalYearOf(orgToday(ctx))));
});

financialRoutes.post("/capture", async (c) => {
  const ctx = c.get("ctx");
  await needFinance(ctx);
  const input = await body(c, z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, "دوره معتبر نیست").nullish() }));
  return c.json(await capture(sysOf(ctx, ctx.user.id), input.period ?? periodKeyOf(orgToday(ctx))));
});

financialRoutes.post("/entries/:id/reverse", async (c) => {
  const input = await body(c, z.object({ reason: z.string().min(2).max(300) }));
  return c.json(await reverseEntry(c.get("ctx"), id(c.req.param("id")), input.reason));
});

financialRoutes.post("/allocation-runs/:id/calculate", async (c) => c.json(await calculateRun(c.get("ctx"), id(c.req.param("id")))));
financialRoutes.post("/allocation-runs/:id/post", async (c) => c.json(await postRun(c.get("ctx"), id(c.req.param("id")))));
financialRoutes.get("/allocation-runs/:id/statement", async (c) => c.json(await statementOf(c.get("ctx"), id(c.req.param("id")))));

financialRoutes.get("/services/:id/cost", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ year: YEAR.optional() }));
  return c.json(await serviceCost(ctx, id(c.req.param("id")), q.year ?? fiscalYearOf(orgToday(ctx))));
});

financialRoutes.post("/years", async (c) => {
  const ctx = c.get("ctx");
  await needFinance(ctx);
  const input = await body(c, z.object({ year: YEAR }));
  const y = await ensureFiscalYear(sysOf(ctx, ctx.user.id), input.year);
  return c.json({ id: y.id, year: y.year });
});

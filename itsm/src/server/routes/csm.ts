// HTTP API of customer service management under /api/o/:org/csm (docs/modules/csm_FA.md). Accounts, contacts,
// products, the installed base, contracts, entitlements, cases, escalations, plans, reviews and notices are served by
// the generic engine API (/r/<table>); these routes are the operations it cannot express, each with the caller's
// context.
//
//   GET  /meta · POST /seed
//   GET  /accounts/:id/360                 customer 360 (as the caller reads it)
//   POST /cases/:id/raise                  an incident or a problem raised from a customer case (linked)
//   POST /cases/:id/broadcast              one public update to every child of a major case
//   POST /next                             the next case of the caller's groups, assigned to them
//   POST /incidents/:id/proactive          proactive cases for the accounts an incident affects
//   POST /reviews/:id/pack                 the pack of a quarterly review
//   POST /notices/:id/send                 send an approved notice (with evidence)
//   POST /health/refresh                   recompute relationship health now (CSM managers)
//   GET  /dashboard                        volumes, backlog and quality
import { z } from "zod";
import { router, body } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor, orgSchema } from "../engine";
import { broadcast, csmConfig, csmDashboard, customer360, healthSweepIn, managesCsm, nextCase, proactiveCasesIn, raiseInternal, reviewPack, seedCsmDefaults, sendNotice, CSM_SEED_VERSION } from "../modules/csm";
import { mayWriteRecord, sysOf } from "../modules/csm/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());

export const csmRoutes = router();

async function needCsm(ctx: Parameters<typeof orgSchema>[0]) {
  const { def } = await defFor(ctx, "customer_case");
  if (!access().canReadTable(ctx, def)) throw forbidden("به خدمات مشتریان دسترسی ندارید");
  return ctx;
}

csmRoutes.get("/meta", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  const cfg = await csmConfig(ctx.db, sysOf(ctx));
  return c.json({ seeded: cfg.seeded >= CSM_SEED_VERSION, manages: await managesCsm(ctx.db, ctx), config: { auto_close_days: cfg.auto_close_days, proactive_on_major: cfg.proactive_on_major } });
});

csmRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  const { def } = await defFor(ctx, "csm_config");
  if (!access().canCreate(ctx, def, null) || !(await managesCsm(ctx.db, ctx))) throw forbidden("افزودن پیش‌فرض‌های خدمات مشتریان با مدیر خدمات مشتریان یا مدیر سامانه است");
  return c.json(await seedCsmDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

csmRoutes.get("/accounts/:id/360", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  return c.json(await customer360(ctx, UUID.parse(c.req.param("id"))));
});

csmRoutes.post("/cases/:id/raise", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  const input = await body(c, z.object({ table: z.enum(["incident", "problem"]).default("incident"), short_description: z.string().max(200).nullish() }));
  return c.json(await raiseInternal(ctx, UUID.parse(c.req.param("id")), input));
});

csmRoutes.post("/cases/:id/broadcast", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  const input = await body(c, z.object({ body: z.string().min(1).max(20_000) }));
  return c.json(await broadcast(ctx, UUID.parse(c.req.param("id")), input.body));
});

csmRoutes.post("/next", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  return c.json({ case: await nextCase(ctx) });
});

csmRoutes.post("/incidents/:id/proactive", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  const id = UUID.parse(c.req.param("id"));
  if (!(await managesCsm(ctx.db, ctx)) && !(await mayWriteRecord(ctx.db, ctx, "incident", id))) throw forbidden("پرونده‌های پیش‌دستانه را مدیر خدمات مشتریان یا کارشناس همان رخداد می‌سازد");
  return c.json(await ctx.write((tx) => proactiveCasesIn(tx, ctx, id)));
});

csmRoutes.post("/reviews/:id/pack", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  return c.json(await reviewPack(ctx, UUID.parse(c.req.param("id"))));
});

csmRoutes.post("/notices/:id/send", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  return c.json(await sendNotice(ctx, UUID.parse(c.req.param("id"))));
});

csmRoutes.post("/health/refresh", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  if (!(await managesCsm(ctx.db, ctx))) throw forbidden("محاسبهٔ دوبارهٔ سلامت حساب‌ها با مدیر خدمات مشتریان است");
  const sys = sysOf(ctx);
  return c.json({ accounts: await ctx.write((tx) => healthSweepIn(tx, sys)) });
});

csmRoutes.get("/dashboard", async (c) => {
  const ctx = await needCsm(c.get("ctx"));
  return c.json(await csmDashboard(ctx));
});

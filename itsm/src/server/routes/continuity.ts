// HTTP API of availability, capacity and continuity under /api/o/:org/continuity (docs/modules/continuity_FA.md
// «API»). Records (outages, capacity records, BIAs, plans, steps, exercises) are served by the generic engine API
// (/r/outage…); these routes are what it cannot express: the availability report and a service's trend, the
// continuity dashboard, a BIA from the template, the exercise clock (start, steps, finish), an outage from an
// incident and the defaults.
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { forbidden } from "../http/errors";
import { get } from "../engine";
import { availabilityReport, biaFromTemplate, continuityDashboard, finishExercise, isContinuityManager, markStep, outageFromIncident, seedContinuityDefaults, serviceTrend, startExercise } from "../modules/continuity";
import { compositeAvailability, type Component } from "@shared/continuity/logic";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const unit = z.enum(["month", "quarter", "year"]);

export const continuityRoutes = router();

continuityRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!(await isContinuityManager(ctx))) throw forbidden("افزودن پیش‌فرض‌ها با مدیر تداوم است");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  return c.json(await seedContinuityDefaults(ctx.cfg, ctx.org.id, { force: input.force ?? true }));
});

continuityRoutes.get("/availability", async (c) => {
  const ctx = c.get("ctx");
  const qp = query(c, z.object({ unit: unit.optional(), offset: z.coerce.number().int().min(-36).max(0).optional() }));
  return c.json(await availabilityReport(ctx, qp.unit ?? "month", qp.offset ?? 0));
});

continuityRoutes.get("/availability/:id", async (c) => {
  const ctx = c.get("ctx");
  const qp = query(c, z.object({ unit: unit.optional(), count: z.coerce.number().int().min(1).max(24).optional() }));
  return c.json(await serviceTrend(ctx, id(c.req.param("id")), qp.unit ?? "month", qp.count ?? 12));
});

/** Composite availability of a component tree (serial ΠA, redundant 1 − Π(1 − A)): what-if for designers. */
const comp: z.ZodType<Component> = z.lazy(() => z.union([z.object({ a: z.number().min(0).max(100) }), z.object({ serial: z.array(comp).min(1).max(50) }), z.object({ parallel: z.array(comp).min(1).max(50) })]));
continuityRoutes.post("/composite", async (c) => {
  const input = await body(c, z.object({ tree: comp }));
  return c.json({ availability: compositeAvailability(input.tree) });
});

continuityRoutes.get("/dashboard", async (c) => c.json(await continuityDashboard(c.get("ctx"))));

continuityRoutes.post("/bia/from-template", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ template_id: UUID.nullable().optional(), title: z.string().min(1).max(200), service_id: UUID.nullable().optional(), activity: z.string().max(200).nullable().optional() }));
  const row = await biaFromTemplate(ctx, input);
  return c.json(await get(ctx, "bia", String(row.id)));
});

continuityRoutes.post("/exercises/:id/start", async (c) => {
  const ctx = c.get("ctx");
  const row = await startExercise(ctx, id(c.req.param("id")));
  return c.json(await get(ctx, "exercise", String(row.id)));
});

continuityRoutes.post("/exercises/:id/steps/:seq", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ done: z.boolean().optional() }));
  const row = await markStep(ctx, id(c.req.param("id")), Number(c.req.param("seq")), input.done ?? true);
  return c.json(await get(ctx, "exercise", String(row.id)));
});

continuityRoutes.post("/exercises/:id/finish", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ result: z.enum(["passed", "partial", "failed"]), actual_recovery: z.number().int().min(0).nullable().optional(), actual_data_loss: z.number().int().min(0).nullable().optional(), findings: z.string().max(20_000).nullable().optional() }));
  const row = await finishExercise(ctx, id(c.req.param("id")), input);
  return c.json(await get(ctx, "exercise", String(row.id)));
});

continuityRoutes.post("/outages/from-incident", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ incident_id: UUID }));
  const row = await outageFromIncident(ctx, input.incident_id.toLowerCase());
  return c.json(await get(ctx, "outage", String(row.id)));
});

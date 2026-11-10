// HTTP API of enterprise service management under /api/o/:org/esm (docs/modules/esm_FA.md). Departments, services,
// cases, journeys, spaces, reservations and visitors are served by the generic engine API (/r/<table>); these routes
// are the operations it cannot express, each with the caller's context.
//
//   GET  /meta · POST /seed
//   GET  /departments                        the departments the caller belongs to (their «میز واحد») and all live ones
//   GET  /departments/:key/home              a department's workspace home (queues, figures, services, journeys)
//   GET  /portal/sections                    the portal's registration hook: the sections the caller may see
//   POST /route                              services ranked for a sentence (cross-department routing)
//   GET  /my/cases · GET /my/todos           the caller's open department cases; their HR tasks and journeys
//   POST /cases/:table/:id/transfer          move a case to another department
//   POST /cases/:table/:id/child             a case of another department working for this one
//   POST /journeys                           start a journey from a template
//   GET  /journeys/:id/tracker               the journey tracker
//   GET  /templates/:id/preview?anchor       planned dates of a template's activities
//   GET  /spaces/availability                bookable spaces with their busy spans
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor, orgSchema } from "../engine";
import {
  administersEsm, availability, childCase, departmentHome, departments, esmConfig, journeyTracker, myDepartments, myOpenCases, myTodos, portalSections, previewTemplate, routeText, seedEsmDefaults,
  startJourney, transferCase, ESM_SEED_VERSION,
} from "../modules/esm";
import { sysOf } from "../modules/esm/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{1,60}$/, "جدول معتبر نیست");

export const esmRoutes = router();

const member = async (c: C) => {
  const ctx = c.get("ctx");
  await orgSchema(ctx);
  return ctx;
};

esmRoutes.get("/meta", async (c) => {
  const ctx = await member(c);
  const cfg = await esmConfig(ctx.db, sysOf(ctx));
  const mine = await myDepartments(ctx.db, ctx);
  return c.json({ seeded: cfg.seeded >= ESM_SEED_VERSION, admin: await administersEsm(ctx.db, ctx), departments: mine.map((d) => ({ id: d.id, key: d.key, name: d.name, kind: d.kind, icon: d.icon ?? null, color: d.color ?? null, status: d.status, case_table: d.case_table })) });
});

esmRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  if (!(await administersEsm(ctx.db, ctx))) throw forbidden("افزودن بستهٔ واحدها با مدیر خدمات سازمانی یا مدیر سامانه است");
  return c.json(await seedEsmDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

esmRoutes.get("/departments", async (c) => {
  const ctx = await member(c);
  const mine = new Set((await myDepartments(ctx.db, ctx)).map((d) => String(d.id)));
  const all = (await departments(ctx.db, ctx)).filter((d) => d.status !== "retired");
  // the caller sees which departments exist (to transfer or ask), and which ones are theirs
  return c.json({ departments: all.map((d) => ({ id: d.id, key: d.key, name: d.name, kind: d.kind, icon: d.icon ?? null, color: d.color ?? null, status: d.status, case_table: d.case_table, mine: mine.has(String(d.id)) })) });
});

esmRoutes.get("/departments/:key/home", async (c) => {
  const ctx = await member(c);
  return c.json(await departmentHome(ctx, c.req.param("key")));
});

esmRoutes.get("/portal/sections", async (c) => {
  const ctx = await member(c);
  return c.json({ sections: await portalSections(ctx) });
});

esmRoutes.post("/route", async (c) => {
  const ctx = await member(c);
  const input = await body(c, z.object({ text: z.string().min(1).max(500) }));
  return c.json(await routeText(ctx, input.text));
});

esmRoutes.get("/my/cases", async (c) => {
  const ctx = await member(c);
  const q = query(c, z.object({ department: z.string().max(40).optional() }));
  let rows = await myOpenCases(ctx);
  if (q.department) {
    const dept = (await departments(ctx.db, ctx)).find((d) => d.key === q.department);
    rows = dept ? rows.filter((r) => r.department_id === dept.id) : [];
  }
  return c.json({ cases: rows });
});

esmRoutes.get("/my/todos", async (c) => {
  const ctx = await member(c);
  return c.json(await myTodos(ctx));
});

esmRoutes.post("/cases/:table/:id/transfer", async (c) => {
  const ctx = await member(c);
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  const input = await body(c, z.object({ department_id: UUID, service_id: UUID.nullish(), note: z.string().min(1).max(2000) }));
  return c.json(await transferCase(ctx, table, id, input));
});

esmRoutes.post("/cases/:table/:id/child", async (c) => {
  const ctx = await member(c);
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  const input = await body(c, z.object({ department_id: UUID, service_id: UUID.nullish(), short_description: z.string().min(1).max(200), description: z.string().max(20_000).nullish() }));
  return c.json(await childCase(ctx, table, id, input));
});

esmRoutes.post("/journeys", async (c) => {
  const ctx = await member(c);
  const input = await body(c, z.object({
    template_id: UUID, anchor_date: DATE, subject_person_id: UUID.nullish(), subject_name: z.string().max(160).nullish(), manager_id: UUID.nullish(), hr_owner_id: UUID.nullish(),
    employment_type: z.string().max(40).nullish(), location_id: UUID.nullish(), org_unit_id: UUID.nullish(), name: z.string().max(200).nullish(), notes: z.string().max(5000).nullish(),
  }));
  return c.json({ journey: await startJourney(ctx, input) });
});

esmRoutes.get("/journeys/:id/tracker", async (c) => {
  const ctx = await member(c);
  return c.json(await journeyTracker(ctx, UUID.parse(c.req.param("id"))));
});

esmRoutes.get("/templates/:id/preview", async (c) => {
  const ctx = await member(c);
  const { def } = await defFor(ctx, "journey_template");
  if (!access().canReadTable(ctx, def)) throw forbidden("به الگوهای سفر دسترسی ندارید");
  const q = query(c, z.object({ anchor: DATE }));
  return c.json(await previewTemplate(ctx, UUID.parse(c.req.param("id")), q.anchor));
});

esmRoutes.get("/spaces/availability", async (c) => {
  const ctx = await member(c);
  const { def } = await defFor(ctx, "space");
  if (!access().canReadTable(ctx, def)) throw forbidden("به فضاها دسترسی ندارید");
  const q = query(c, z.object({ from: z.string().max(40), to: z.string().max(40), kind: z.string().max(40).optional(), location: UUID.optional(), capacity: z.coerce.number().int().min(0).max(10_000).optional() }));
  return c.json(await availability(ctx, q));
});

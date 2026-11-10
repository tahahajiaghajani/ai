// HTTP API of project and portfolio management under /api/o/:org/project (docs/modules/project_FA.md). Portfolios,
// demands, projects, tasks, RAID items, status reports, allocations and time entries are served by the generic engine
// API (/r/<table>); these routes are the operations it cannot express, each with the caller's context.
//
//   GET  /meta · POST /seed
//   GET  /portfolio?portfolio                    the portfolio view (health, progress, variance, money, demand pipeline)
//   GET  /demands/board                          the intake board by state, best score first
//   POST /demands/:id/convert                    an approved demand becomes a project
//   POST /from/:table/:id                        a project from an ITSM record («برخاسته از»)
//   GET  /projects/:id/gantt                     WBS, dates, dependencies, critical path, baselines
//   POST /projects/:id/baseline                  take the baseline
//   POST /projects/:id/recalc                    recompute the plan, roll-ups and health
//   POST /projects/:id/copy                      a new project from this one's plan (template)
//   POST /projects/:id/status/draft              a status report draft (AI summary when available; saved on demand)
//   GET  /resources?from&weeks&project           the resource heat map
//   GET  /timesheet?from&days                    the caller's own time and open tasks of a period
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor } from "../engine";
import {
  baseline, convertDemand, copyProject, demandBoard, draftStatus, ganttOf, managesProjects, needProjectWrite, portfolioView, projectConfig, projectFrom, recalcProject, resourceView, seedProjectDefaults,
  timesheet, PROJECT_SEED_VERSION,
} from "../modules/project";
import { sysOf } from "../modules/release";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");

export const projectRoutes = router();

async function needProjects(c: C) {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "project");
  if (!access().canReadTable(ctx, def)) throw forbidden("به پروژه‌ها دسترسی ندارید");
  return ctx;
}

projectRoutes.get("/meta", async (c) => {
  const ctx = await needProjects(c);
  const cfg = await projectConfig(ctx.db, sysOf(ctx));
  return c.json({ seeded: cfg.seeded >= PROJECT_SEED_VERSION, manages: await managesProjects(ctx.db, ctx), config: { scoring_model: cfg.scoring_model, capacity: cfg.capacity, status_report_days: cfg.status_report_days } });
});

projectRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  const { def } = await defFor(ctx, "project_config");
  if (!access().canCreate(ctx, def, null) || !(await managesProjects(ctx.db, ctx))) throw forbidden("افزودن پیش‌فرض‌های پروژه با مدیر پروژه‌ها یا مدیر سامانه است");
  return c.json(await seedProjectDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

projectRoutes.get("/portfolio", async (c) => {
  const ctx = await needProjects(c);
  const q = query(c, z.object({ portfolio: UUID.optional() }));
  return c.json(await portfolioView(ctx, q));
});

projectRoutes.get("/demands/board", async (c) => {
  const ctx = await needProjects(c);
  return c.json(await demandBoard(ctx));
});

projectRoutes.post("/demands/:id/convert", async (c) => {
  const ctx = await needProjects(c);
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(200).optional(), project_manager_id: UUID.nullish(), planned_start: DATE.nullish(), planned_end: DATE.nullish() }));
  return c.json(await convertDemand(ctx, UUID.parse(c.req.param("id")), input));
});

projectRoutes.post("/from/:table/:id", async (c) => {
  const ctx = await needProjects(c);
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(200).optional() }));
  const table = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).parse(c.req.param("table"));
  return c.json(await projectFrom(ctx, table, UUID.parse(c.req.param("id")), input));
});

projectRoutes.get("/projects/:id/gantt", async (c) => {
  const ctx = await needProjects(c);
  return c.json(await ganttOf(ctx, UUID.parse(c.req.param("id"))));
});

projectRoutes.post("/projects/:id/baseline", async (c) => {
  const ctx = await needProjects(c);
  return c.json(await baseline(ctx, UUID.parse(c.req.param("id"))));
});

projectRoutes.post("/projects/:id/recalc", async (c) => {
  const ctx = await needProjects(c);
  const id = UUID.parse(c.req.param("id"));
  await needProjectWrite(ctx, id);
  await recalcProject(ctx, id);
  return c.json(await ganttOf(ctx, id));
});

projectRoutes.post("/projects/:id/copy", async (c) => {
  const ctx = await needProjects(c);
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(200), planned_start: DATE }));
  return c.json(await copyProject(ctx, UUID.parse(c.req.param("id")), input));
});

projectRoutes.post("/projects/:id/status/draft", async (c) => {
  const ctx = await needProjects(c);
  const input = await body(c, z.object({ save: z.boolean().optional() }));
  const id = UUID.parse(c.req.param("id"));
  if (input.save) await needProjectWrite(ctx, id);
  return c.json(await draftStatus(ctx, id, input));
});

projectRoutes.get("/resources", async (c) => {
  const ctx = await needProjects(c);
  const q = query(c, z.object({ from: DATE.optional(), weeks: z.coerce.number().int().min(1).max(52).default(12), project: UUID.optional() }));
  return c.json(await resourceView(ctx, q));
});

projectRoutes.get("/timesheet", async (c) => {
  const ctx = await needProjects(c);
  const q = query(c, z.object({ from: DATE, days: z.coerce.number().int().min(1).max(31).default(7) }));
  return c.json(await timesheet(ctx, q));
});

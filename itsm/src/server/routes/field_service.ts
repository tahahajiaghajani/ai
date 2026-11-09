// HTTP API of field service under /api/o/:org/field_service (docs/modules/field_service_FA.md). Work orders, tasks,
// templates, territories, technicians, parts, plans and time are served by the generic engine API (/r/<table>); these
// routes are the operations it cannot express, each with the caller's context.
//
//   GET  /meta · POST /seed
//   GET  /board?day&territory              the dispatch board of a day
//   GET  /tasks/:id/candidates?start       technicians ranked for a task
//   POST /tasks/:id/assign                 assign (the board's drop) — { technician_id, start, force }
//   POST /tasks/:id/auto-assign            the best feasible technician now
//   POST /tasks/:id/step                   accept | reject | depart | arrive | complete | leave (with the position)
//   POST /tasks/:id/signoff                the customer's sign-off (name and signature attachment)
//   GET  /my-day?day                       the technician's visits in route order
//   POST /from/:table/:id                  a work order for a record
//   GET  /work-orders/:id/slots            free appointment slots (capacity only)
//   POST /work-orders/:id/book             book a slot
//   POST /maintenance/run                  generate the due planned maintenance now (dispatchers)
//   GET  /dashboard                        field KPIs
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor } from "../engine";
import {
  appointmentSlots, assignTask, autoAssign, bookAppointment, candidatesFor, dispatchBoard, dispatches, fieldDashboard, fsmConfig, generateMaintenanceIn, myDay, seedFsmDefaults, signOff, visitStep, workOrderFrom, FSM_SEED_VERSION,
} from "../modules/field_service";
import { sysOf } from "../modules/field_service/common";
import type { Ctx } from "../context";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");
const COORD = z.union([z.number(), z.string().max(30)]).nullish();

export const fieldServiceRoutes = router();

async function needField(ctx: Ctx, table = "wo_task") {
  const { def } = await defFor(ctx, table);
  if (!access().canReadTable(ctx, def)) throw forbidden("به خدمات میدانی دسترسی ندارید");
  return ctx;
}

fieldServiceRoutes.get("/meta", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const cfg = await fsmConfig(ctx.db, sysOf(ctx));
  return c.json({ seeded: cfg.seeded >= FSM_SEED_VERSION, dispatches: await dispatches(ctx.db, ctx), config: { map_provider: cfg.map_provider, travel_speed_kmh: cfg.travel_speed_kmh } });
});

fieldServiceRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  const { def } = await defFor(ctx, "fsm_config");
  if (!access().canCreate(ctx, def, null) || !(await dispatches(ctx.db, ctx))) throw forbidden("افزودن پیش‌فرض‌های خدمات میدانی با مدیر خدمات میدانی یا مدیر سامانه است");
  return c.json(await seedFsmDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

fieldServiceRoutes.get("/board", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const q = query(c, z.object({ day: DATE.optional(), territory: UUID.optional() }));
  return c.json(await dispatchBoard(ctx, q));
});

fieldServiceRoutes.get("/tasks/:id/candidates", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const q = query(c, z.object({ start: z.string().max(40).optional() }));
  return c.json({ candidates: await candidatesFor(ctx, UUID.parse(c.req.param("id")), q.start ?? null) });
});

fieldServiceRoutes.post("/tasks/:id/assign", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const input = await body(c, z.object({ technician_id: UUID, start: z.string().max(40).nullish(), force: z.boolean().optional() }));
  return c.json(await assignTask(ctx, UUID.parse(c.req.param("id")), input));
});

fieldServiceRoutes.post("/tasks/:id/auto-assign", async (c) => {
  const ctx = await needField(c.get("ctx"));
  return c.json(await autoAssign(ctx, UUID.parse(c.req.param("id"))));
});

fieldServiceRoutes.post("/tasks/:id/step", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const input = await body(c, z.object({ step: z.enum(["accept", "reject", "depart", "arrive", "complete", "leave"]), lat: COORD, lng: COORD, resolution: z.string().max(20_000).nullish(), reason: z.string().max(2000).nullish(), checklist_answers: z.record(z.string(), z.unknown()).nullish() }));
  return c.json(await visitStep(ctx, UUID.parse(c.req.param("id")), input.step, input));
});

fieldServiceRoutes.post("/tasks/:id/signoff", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const input = await body(c, z.object({ signer_name: z.string().min(1).max(120), attachment_id: UUID.nullish() }));
  return c.json(await signOff(ctx, UUID.parse(c.req.param("id")), input));
});

fieldServiceRoutes.get("/my-day", async (c) => {
  const ctx = await needField(c.get("ctx"));
  const q = query(c, z.object({ day: DATE.optional() }));
  return c.json(await myDay(ctx, q.day ?? null));
});

fieldServiceRoutes.post("/from/:table/:id", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "work_order");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ساخت دستور کار را ندارید");
  const table = z.string().regex(/^[a-z][a-z0-9_]{1,60}$/).parse(c.req.param("table"));
  const input = await body(c, z.object({ short_description: z.string().max(200).nullish(), template_id: UUID.nullish(), work_type: z.string().max(40).nullish(), site_address: z.string().max(2000).nullish(), site_lat: COORD, site_lng: COORD, symptoms: z.string().max(5000).nullish() }));
  return c.json(await workOrderFrom(ctx, table, UUID.parse(c.req.param("id")), input));
});

fieldServiceRoutes.get("/work-orders/:id/slots", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ from: z.string().max(40).optional(), days: z.coerce.number().int().min(1).max(14).optional() }));
  return c.json(await appointmentSlots(ctx, UUID.parse(c.req.param("id")), q));
});

fieldServiceRoutes.post("/work-orders/:id/book", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ start: z.string().min(10).max(40) }));
  return c.json(await bookAppointment(ctx, UUID.parse(c.req.param("id")), input));
});

fieldServiceRoutes.post("/maintenance/run", async (c) => {
  const ctx = await needField(c.get("ctx"));
  if (!(await dispatches(ctx.db, ctx))) throw forbidden("اجرای برنامه‌های نگهداری با توزیع‌کننده است");
  const sys = sysOf(ctx);
  return c.json({ generated: await ctx.write((tx) => generateMaintenanceIn(tx, sys)) });
});

fieldServiceRoutes.get("/dashboard", async (c) => {
  const ctx = await needField(c.get("ctx"));
  return c.json(await fieldDashboard(ctx));
});

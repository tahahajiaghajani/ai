// HTTP API of the SLA service (docs/spec/services/sla.md §6), under /api/o/:org:
//   /calendars  holidays for the UI's calendars, a calendar's spec for the editors' previews, the default seed
//   /sla        the SLA timeline of a record
//   /approvals  «تأییدهای من», decisions (one or many), a record's approvals, ad-hoc requests and withdrawal
//   /rules      the UI policies of a table (the record UI's policy source)
// Configuration itself (calendars, holidays, SLA definitions, rules…) is served by the generic engine API (/r/<table>).
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor } from "../engine";
import {
  cancelApprovals, decide, decideMany, holidaysBetween, myApprovals, recordApprovals, requestApproval, seedCalendars, slaConfig, slaTimeline, uiPolicies,
} from "../modules/sla";
import { IR_HOLIDAY_YEARS } from "../modules/sla/holidays-ir";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست (YYYY-MM-DD)");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");

// ---------------------------------------------------------------------------------------------------------------
// /calendars

export const calendarRoutes = router();

calendarRoutes.get("/holidays", async (c) => {
  const q = query(c, z.object({ from: DATE, to: DATE, calendar: UUID.optional() }));
  return c.json({ holidays: await holidaysBetween(c.get("ctx").db, c.get("ctx"), q.from, q.to, q.calendar ?? null) });
});

calendarRoutes.get("/:id/spec", async (c) => {
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const q = query(c, z.object({ from: DATE, to: DATE }));
  const { def } = await defFor(ctx, "calendar");
  if (!access().canReadTable(ctx, def)) throw forbidden("به تقویم‌های کاری دسترسی ندارید");
  const cfg = await slaConfig(ctx.db, ctx);
  const cal = cfg.rows.calendar.find((r) => r.id === id);
  if (!cal) return c.json({ error: { code: "not_found", message: "تقویم پیدا نشد" } }, 404);
  return c.json({ id, name: cal.name, timezone: cal.timezone, hours: cal.hours, holidays: await holidaysBetween(ctx.db, ctx, q.from, q.to, id) });
});

calendarRoutes.get("/bundled", (c) => c.json({ years: IR_HOLIDAY_YEARS, set: "ir" }));

calendarRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ years: z.array(z.number().int().min(1300).max(1600)).max(20).optional() }));
  const { def } = await defFor(ctx, "holiday");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ افزودن تعطیلات را ندارید");
  return c.json(await seedCalendars(ctx.cfg, ctx.org.id, { years: input.years }));
});

// ---------------------------------------------------------------------------------------------------------------
// /sla

export const slaRoutes = router();

slaRoutes.get("/records/:table/:id", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  return c.json(await slaTimeline(c.get("ctx"), table, id));
});

// ---------------------------------------------------------------------------------------------------------------
// /approvals

export const approvalRoutes = router();

const decision = z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().max(4000).nullish() });

approvalRoutes.get("/mine", async (c) => {
  const q = query(c, z.object({ scope: z.enum(["pending", "decided"]).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
  return c.json(await myApprovals(c.get("ctx"), q));
});

approvalRoutes.post("/decide", async (c) => {
  const input = await body(c, decision.extend({ ids: z.array(UUID).min(1).max(200) }));
  return c.json(await decideMany(c.get("ctx"), input.ids, input));
});

approvalRoutes.post("/:id/decide", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const input = await body(c, decision);
  return c.json(await decide(c.get("ctx"), id, input));
});

approvalRoutes.get("/record/:table/:id", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  return c.json(await recordApprovals(c.get("ctx"), table, id));
});

approvalRoutes.post("/record/:table/:id/request", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  const input = await body(
    c,
    z.object({
      users: z.array(UUID).max(200).optional(),
      groups: z.array(UUID).max(50).optional(),
      rule: z.enum(["any", "all", "count", "percent"]).optional(),
      threshold: z.number().int().min(1).max(1000).nullish(),
      comment: z.string().max(4000).nullish(),
      expire_hours: z.number().min(0).max(24 * 365).nullish(),
    }),
  );
  return c.json(await requestApproval(c.get("ctx"), table, id, input));
});

approvalRoutes.post("/record/:table/:id/cancel", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  return c.json(await cancelApprovals(c.get("ctx"), table, id));
});

// ---------------------------------------------------------------------------------------------------------------
// /rules

export const ruleRoutes = router();

ruleRoutes.get("/ui-policies/:table", async (c) => c.json(await uiPolicies(c.get("ctx"), TABLE.parse(c.req.param("table")))));

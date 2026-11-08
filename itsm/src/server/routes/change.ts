// HTTP API of change enablement under /api/o/:org/change (docs/modules/change_FA.md). The records themselves —
// changes, tasks, models, templates, windows, CABs, meetings, conflicts, outages, reviews, lockdowns, questions,
// settings — are served by the generic engine API (/r/<table>); these routes are the operations the generic API cannot
// express. Each one reads and writes through the engine with the caller's context (access, field locks, the lifecycle
// guard), so a route never shows or changes what the caller could not through /r.
//
//   GET  /meta                                   AI skills available, the settings the screens need
//   POST /seed                                   add the module's defaults (create access to change settings)
//   GET  /calendar · /calendar.ics               the forward schedule of change (changes, windows, outages, lockdowns, holidays)
//   POST /windows/from-holidays                  blackouts from the official holidays of a Jalali year
//   GET  /records/:id/risk · PUT …/risk          the risk panel; the questionnaire's answers
//   POST /records/:id/risk/explain               the risk narrative (AI when registered, else deterministic)
//   POST /records/:id/conflicts/check            detect the change's conflicts again
//   GET  /records/:id/slots                      the scheduling assistant's free slots
//   GET  /records/:id/readiness · /impact · /similar · /evidence · /votes · /pir-draft
//   POST /records/:id/copy · /children · /hold · /resume · /backout · /pir
//   POST /from/:table/:id                        a change from another record («آغازشده از»)
//   GET  /catalog · POST /catalog/:id/order      the standard-change catalogue
//   GET  /cab/workbench · POST /cab/:cab/next · POST /cab/meetings/:id/refresh · …/items/:item/decide
//   GET  /cab/meetings/:id/minutes · /pack · POST /cab/meetings/:id/complete
//   GET  /suspects · POST /detected · GET /ci/:id/timeline · GET /dashboard
import { z } from "zod";
import { STATE_OPTIONS, WINDOW_KINDS } from "@shared/tables/change";
import { explainRisk } from "@shared/change/logic";
import { router, body, query, type C } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor, get } from "../engine";
import {
  aiCapabilities, changeAi, changeConfig, completeMeeting, decideItem, draftMinutes, draftPir, ensurePir, recomputeConflicts, refreshAgenda, scheduleNext, seedChangeDefaults, slotsFor,
  sysOf, workbench, CHANGE_SEED_VERSION,
} from "../modules/change";
import { catalogue, changeFrom, copyChange, createChildren, holdChange, orderStandard, resumeChange, riskView, saveAnswers, startBackout } from "../modules/change/actions";
import { blackoutsFromHolidays, calendarIcs, calendarView } from "../modules/change/calendar";
import { changeDashboard } from "../modules/change/dashboard";
import { cabPack, ciTimeline, cycleVotes, detectedChange, evidencePack, impactView, readinessView, similarChanges, suspects } from "../modules/change/insights";
import { pirReasons } from "@shared/change/logic";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const INSTANT = z.string().min(10).max(40).refine((s) => Number.isFinite(Date.parse(s)), "زمان معتبر نیست");
const LIST = z.string().max(2000).optional().transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined));
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");

const stateLabel = (v: string) => STATE_OPTIONS.find((o) => o.value === v)?.label ?? v;
const windowLabel = (v: string) => WINDOW_KINDS.find((o) => o.value === v)?.label ?? v;

export const changeRoutes = router();

/** The caller must read changes at all (a 403 rather than empty answers). */
async function needChanges(c: C) {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "change_request");
  if (!access().canReadTable(ctx, def)) throw forbidden("به تغییرها دسترسی ندارید");
  return ctx;
}

changeRoutes.get("/meta", async (c) => {
  const ctx = await needChanges(c);
  const cfg = await changeConfig(ctx.db, sysOf(ctx));
  return c.json({
    ai: aiCapabilities(),
    seeded: cfg.seeded >= CHANGE_SEED_VERSION,
    config: {
      risk_moderate_from: cfg.risk_moderate_from, risk_high_from: cfg.risk_high_from, risk_very_high_from: cfg.risk_very_high_from, questionnaire_weight: cfg.questionnaire_weight,
      lead_days: { low: cfg.lead_days_low, moderate: cfg.lead_days_moderate, high: cfg.lead_days_high, very_high: cfg.lead_days_very_high },
      cab_risks: cfg.cab_risks, default_cab_id: cfg.default_cab_id, emergency_cab_id: cfg.emergency_cab_id, window_alert_minutes: cfg.window_alert_minutes,
    },
  });
});

changeRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  const { def } = await defFor(ctx, "change_config");
  if (!access().canCreate(ctx, def, null)) throw forbidden("افزودن پیش‌فرض‌های تغییر با مدیر سامانه است");
  return c.json(await seedChangeDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

// ----- calendar ------------------------------------------------------------------------------------------------

const CalendarQ = z.object({ from: INSTANT, to: INSTANT, types: LIST, groups: LIST, states: LIST, mine: z.enum(["1", "0", "true", "false"]).optional() });
const calendarInput = (q: z.infer<typeof CalendarQ>) => ({ from: q.from, to: q.to, types: q.types, groups: q.groups?.filter((g) => UUID.safeParse(g).success), states: q.states, mine: q.mine === "1" || q.mine === "true" });

changeRoutes.get("/calendar", async (c) => {
  const q = query(c, CalendarQ);
  return c.json(await calendarView(c.get("ctx"), calendarInput(q)));
});

changeRoutes.get("/calendar.ics", async (c) => {
  const q = query(c, CalendarQ);
  const text = await calendarIcs(c.get("ctx"), calendarInput(q), { state: stateLabel, window: windowLabel });
  return c.body(text, 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="change-calendar.ics"' });
});

changeRoutes.post("/windows/from-holidays", async (c) => {
  const input = await body(c, z.object({ year: z.number().int().min(1390).max(1500), enforcement: z.enum(["block", "warn"]).optional() }));
  return c.json(await blackoutsFromHolidays(c.get("ctx"), input));
});

// ----- one change ----------------------------------------------------------------------------------------------

changeRoutes.get("/records/:id/risk", async (c) => c.json(await riskView(c.get("ctx"), UUID.parse(c.req.param("id")))));

changeRoutes.put("/records/:id/risk", async (c) => {
  const input = await body(c, z.object({ answers: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])), version: z.number().int().optional() }));
  return c.json(await saveAnswers(c.get("ctx"), UUID.parse(c.req.param("id")), input.answers, input.version));
});

changeRoutes.post("/records/:id/risk/explain", async (c) => {
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const ai = changeAi().riskNarrative;
  if (ai) {
    await get(ctx, "change_request", id);
    return c.json({ text: (await ai(ctx, id)).text, ai: true });
  }
  const v = await riskView(ctx, id);
  return c.json({ text: explainRisk(v.result, { manual: v.risk_source !== "calculated" ? { level: String(v.risk), reason: v.risk_override_reason } : null }), ai: false });
});

changeRoutes.post("/records/:id/conflicts/check", async (c) => {
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const { row, meta } = await get(ctx, "change_request", id);
  if (!meta.canWrite) throw forbidden("اجازهٔ تغییر این درخواست تغییر را ندارید");
  const r = await ctx.write((tx) => recomputeConflicts(tx, ctx, String(row.id)));
  return c.json({ added: r.added, open: r.open });
});

changeRoutes.get("/records/:id/slots", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(90).optional(), limit: z.coerce.number().int().min(1).max(20).optional() }));
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const r = await slotsFor(ctx, id, q);
  const explain = changeAi().explainSlots;
  return c.json({ ...r, narrative: explain && r.slots.length ? (await explain(ctx, id, r.slots)).text : null });
});

changeRoutes.get("/records/:id/readiness", async (c) => c.json(await readinessView(c.get("ctx"), UUID.parse(c.req.param("id")))));
changeRoutes.get("/records/:id/impact", async (c) => c.json(await impactView(c.get("ctx"), UUID.parse(c.req.param("id")))));
changeRoutes.get("/records/:id/similar", async (c) => {
  const q = query(c, z.object({ limit: z.coerce.number().int().min(1).max(30).optional() }));
  return c.json(await similarChanges(c.get("ctx"), UUID.parse(c.req.param("id")), q.limit));
});
changeRoutes.get("/records/:id/evidence", async (c) => c.json(await evidencePack(c.get("ctx"), UUID.parse(c.req.param("id")))));
changeRoutes.get("/records/:id/votes", async (c) => c.json(await cycleVotes(c.get("ctx"), UUID.parse(c.req.param("id")))));
changeRoutes.get("/records/:id/pir-draft", async (c) => c.json(await draftPir(c.get("ctx"), UUID.parse(c.req.param("id")))));

changeRoutes.post("/records/:id/pir", async (c) => {
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const { row, meta } = await get(ctx, "change_request", id);
  if (!meta.canWrite) throw forbidden("اجازهٔ تغییر این درخواست تغییر را ندارید");
  const { def } = await defFor(ctx, "change_pir");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ساخت بازبینی پس از اجرا را ندارید");
  const cfg = await changeConfig(ctx.db, sysOf(ctx));
  const reasons = pirReasons(row, null, cfg.pir_required_for);
  const pir = await ctx.write((tx) => ensurePir(tx, ctx, row, reasons.length ? reasons : ["manual"]));
  return c.json({ pir, existing: !pir ? row.pir_id ?? null : null });
});

const Dates = z.array(z.object({ start: INSTANT, end: INSTANT })).max(20);

changeRoutes.post("/records/:id/copy", async (c) => {
  const input = await body(c, z.object({ sections: z.array(z.enum(["main", "scope", "plans", "schedule"])).max(4).optional(), tasks: z.boolean().optional(), dates: Dates.optional() }));
  const rows = await copyChange(c.get("ctx"), UUID.parse(c.req.param("id")), input);
  return c.json({ changes: rows.map((r) => ({ id: r.id, number: r.number })) });
});

changeRoutes.post("/records/:id/children", async (c) => {
  const input = await body(c, z.object({ cis: z.array(UUID).max(50).optional(), titles: z.array(z.string().min(1).max(200)).max(50).optional() }));
  const rows = await createChildren(c.get("ctx"), UUID.parse(c.req.param("id")), input);
  return c.json({ changes: rows.map((r) => ({ id: r.id, number: r.number })) });
});

changeRoutes.post("/records/:id/hold", async (c) => {
  const input = await body(c, z.object({ reason: z.string().min(1).max(40), note: z.string().max(4000).nullish() }));
  return c.json({ row: await holdChange(c.get("ctx"), UUID.parse(c.req.param("id")), input) });
});

changeRoutes.post("/records/:id/resume", async (c) => {
  const input = await body(c, z.object({ note: z.string().max(4000).nullish() }));
  return c.json({ row: await resumeChange(c.get("ctx"), UUID.parse(c.req.param("id")), input) });
});

changeRoutes.post("/records/:id/backout", async (c) => {
  const input = await body(c, z.object({ note: z.string().min(1, "دلیل بازگشت را بنویسید").max(4000) }));
  return c.json({ row: await startBackout(c.get("ctx"), UUID.parse(c.req.param("id")), input) });
});

changeRoutes.post("/from/:table/:id", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const input = await body(c, z.object({
    type: z.enum(["standard", "normal", "emergency"]).optional(), short_description: z.string().min(1).max(200).optional(), template_id: UUID.optional(),
    planned_start: INSTANT.optional(), planned_end: INSTANT.optional(), assignment_group_id: UUID.optional(),
  }));
  return c.json({ row: await changeFrom(c.get("ctx"), table, UUID.parse(c.req.param("id")), input) });
});

// ----- the standard-change catalogue ---------------------------------------------------------------------------

changeRoutes.get("/catalog", async (c) => {
  const q = query(c, z.object({ q: z.string().max(200).optional(), category: z.string().max(60).optional() }));
  return c.json(await catalogue(c.get("ctx"), q));
});

changeRoutes.post("/catalog/:id/order", async (c) => {
  const input = await body(c, z.object({
    planned_start: INSTANT.optional(), planned_end: INSTANT.optional(), short_description: z.string().min(1).max(200).optional(), description: z.string().max(20_000).optional(),
    ci_id: UUID.optional(), service_id: UUID.optional(), affected_cis: z.array(UUID).max(200).optional(), assignment_group_id: UUID.optional(), assigned_to: UUID.optional(),
    submit: z.boolean().optional(),
  }));
  return c.json(await orderStandard(c.get("ctx"), UUID.parse(c.req.param("id")), input));
});

// ----- CAB ------------------------------------------------------------------------------------------------------

changeRoutes.get("/cab/workbench", async (c) => {
  const q = query(c, z.object({ meeting: UUID.optional() }));
  return c.json(await workbench(c.get("ctx"), q.meeting ?? null));
});

changeRoutes.post("/cab/:cab/next", async (c) => c.json({ meeting: await scheduleNext(c.get("ctx"), UUID.parse(c.req.param("cab"))) }));

changeRoutes.post("/cab/meetings/:id/refresh", async (c) => {
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const { meta } = await get(ctx, "cab_meeting", id);
  if (!meta.canWrite) throw forbidden("به‌روزرسانی دستور جلسه با رئیس جلسه یا مدیر تغییر است");
  return c.json(await ctx.write((tx) => refreshAgenda(tx, ctx, id)));
});

changeRoutes.post("/cab/meetings/:id/items/:item/decide", async (c) => {
  const input = await body(c, z.object({ decision: z.enum(["approved", "rejected", "deferred", "info_requested", "reviewed"]), comment: z.string().max(4000).nullish() }));
  return c.json({ item: await decideItem(c.get("ctx"), UUID.parse(c.req.param("id")), UUID.parse(c.req.param("item")), input) });
});

changeRoutes.get("/cab/meetings/:id/minutes", async (c) => c.json(await draftMinutes(c.get("ctx"), UUID.parse(c.req.param("id")))));
changeRoutes.get("/cab/meetings/:id/pack", async (c) => c.json(await cabPack(c.get("ctx"), UUID.parse(c.req.param("id")))));

changeRoutes.post("/cab/meetings/:id/complete", async (c) => {
  const input = await body(c, z.object({ minutes: z.string().max(200_000).nullish(), version: z.number().int().optional() }));
  return c.json({ meeting: await completeMeeting(c.get("ctx"), UUID.parse(c.req.param("id")), { minutes: input.minutes ?? undefined, version: input.version }) });
});

// ----- across changes -------------------------------------------------------------------------------------------

changeRoutes.get("/suspects", async (c) => {
  const q = query(c, z.object({ incident: UUID.optional(), ci: UUID.optional(), service: UUID.optional(), at: INSTANT.optional(), hours: z.coerce.number().int().min(1).max(336).optional() }));
  await needChanges(c);
  return c.json(await suspects(c.get("ctx"), q));
});

changeRoutes.post("/detected", async (c) => {
  const input = await body(c, z.object({ ci_id: UUID, at: INSTANT.optional(), summary: z.string().min(1).max(200), source: z.enum(["drift", "audit", "monitoring", "manual"]).optional(), description: z.string().max(20_000).optional() }));
  return c.json(await detectedChange(c.get("ctx"), input));
});

changeRoutes.get("/ci/:id/timeline", async (c) => c.json(await ciTimeline(c.get("ctx"), UUID.parse(c.req.param("id")))));

changeRoutes.get("/dashboard", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(730).optional() }));
  await needChanges(c);
  return c.json(await changeDashboard(c.get("ctx"), q));
});

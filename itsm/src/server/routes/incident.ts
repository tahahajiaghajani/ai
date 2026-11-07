// HTTP API of incident management under /api/o/:org/incident (docs/modules/incident_FA.md «API»). Records themselves
// (incidents, tasks, reviews, templates, canned responses, settings) are served by the generic engine API
// (/r/incident…); these routes are the operations the generic API cannot express. Every handler works with the
// caller's context: the engine and the access provider decide what they may read and change (404 for records they
// may not read, 403 for actions their access does not allow).
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { defFor, get } from "../engine";
import { MANUAL_KINDS, TIMELINE_KINDS, type TimelineKind } from "@shared/incident/logic";
import {
  addTimelineEvent, aiCapabilities, applyKnownError, AUDIENCES, changeTimelineEvent, createRelated, draftReview, escalate, incidentAi, incidentConfig, incidentDashboard,
  knownErrorMatches, majorAction, mergeIncidents, promoteEntry, readiness, seedIncidentDefaults, sendUpdate, similarIncidents, timelineOf, type Audience,
} from "../modules/incident";
import { seedProblemDefaults } from "../modules/problem";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const text = (max: number) => z.string().max(max, `حداکثر ${max} نویسه`);
/** A record as the caller may see it (fields they may not read stripped), never the raw stored row. */
const shaped = async (ctx: Parameters<typeof get>[0], table: string, rid: string) => {
  const r = await get(ctx, table, rid);
  return { row: r.row, display: r.display };
};

export const incidentRoutes = router();

// what the screens need to know: AI skills available, the settings people see, audiences and timeline kinds
incidentRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "incident");
  if (!access().canReadTable(ctx, def)) throw forbidden("به رخدادها دسترسی ندارید");
  const cfg = await incidentConfig(ctx.db, ctx);
  return c.json({
    ai: aiCapabilities(),
    settings: {
      reopen_window_days: cfg.reopen_window_days,
      auto_close_days: cfg.auto_close_days,
      mi_default_cadence: cfg.mi_default_cadence,
      propagate_comments: cfg.propagate_comments,
      cascade_children: cfg.cascade_children,
    },
    audiences: AUDIENCES,
    timeline_kinds: Object.fromEntries(Object.entries(TIMELINE_KINDS).map(([k, v]) => [k, v.label])),
    manual_kinds: MANUAL_KINDS,
  });
});

incidentRoutes.get("/dashboard", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(365).optional() }));
  return c.json(await incidentDashboard(c.get("ctx"), q.days ?? 30));
});

// the organisation's defaults (also re-adds what was deleted): whoever may create settings rows
incidentRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "incident_config");
  if (!access().canCreate(ctx, def, null)) throw forbidden("افزودن پیش‌فرض‌ها با مدیر تنظیمات است");
  const incident = await seedIncidentDefaults(ctx.cfg, ctx.org.id, { force: true });
  const problem = await seedProblemDefaults(ctx.cfg, ctx.org.id, { force: true });
  return c.json({ incident, problem });
});

incidentRoutes.get("/:id/similar", async (c) => {
  const q = query(c, z.object({ limit: z.coerce.number().int().min(1).max(30).optional() }));
  return c.json(await similarIncidents(c.get("ctx"), id(c.req.param("id")), q.limit ?? 8));
});

incidentRoutes.get("/:id/known-errors", async (c) => c.json(await knownErrorMatches(c.get("ctx"), id(c.req.param("id")))));

incidentRoutes.get("/:id/readiness", async (c) => c.json(await readiness(c.get("ctx"), id(c.req.param("id")))));

incidentRoutes.post("/:id/escalate", async (c) => {
  const input = await body(c, z.object({ kind: z.enum(["functional", "hierarchical"]), group_id: UUID.nullish(), reason: text(2000) }));
  const ctx = c.get("ctx");
  const row = await escalate(ctx, id(c.req.param("id")), input);
  return c.json(await shaped(ctx, "incident", row.id));
});

incidentRoutes.post("/:id/merge", async (c) => {
  const input = await body(c, z.object({ ids: z.array(UUID).min(1).max(50) }));
  return c.json(await mergeIncidents(c.get("ctx"), id(c.req.param("id")), input.ids));
});

incidentRoutes.post("/:id/related", async (c) => {
  const input = await body(c, z.object({ mode: z.enum(["child", "copy", "follow_up"]), short_description: text(200).nullish() }));
  const ctx = c.get("ctx");
  const row = await createRelated(ctx, id(c.req.param("id")), input.mode, input);
  return c.json(await shaped(ctx, "incident", row.id));
});

incidentRoutes.post("/:id/apply-known-error", async (c) => {
  const input = await body(c, z.object({ known_error_id: UUID, resolve: z.boolean().optional() }));
  const ctx = c.get("ctx");
  const row = await applyKnownError(ctx, id(c.req.param("id")), input.known_error_id, { resolve: input.resolve });
  return c.json(await shaped(ctx, "incident", row.id));
});

const major = z.object({
  action: z.enum(["propose", "declare", "reject", "downgrade"]),
  reason: text(4000).nullish(),
  mi_manager_id: UUID.nullish(),
  mi_comms_id: UUID.nullish(),
  comm_cadence: z.number().int().min(0).max(1440).nullish(),
  bridge_url: z.string().url("نشانی معتبر نیست").max(500).nullish().or(z.literal("")),
  chat_url: z.string().url("نشانی معتبر نیست").max(500).nullish().or(z.literal("")),
  stakeholders: z.array(UUID).max(200).nullish(),
});

incidentRoutes.post("/:id/major", async (c) => {
  const { action, ...input } = await body(c, major);
  const ctx = c.get("ctx");
  const row = await majorAction(ctx, id(c.req.param("id")), action, { ...input, bridge_url: input.bridge_url || undefined, chat_url: input.chat_url || undefined });
  return c.json(await shaped(ctx, "incident", row.id));
});

incidentRoutes.get("/:id/timeline", async (c) => c.json(await timelineOf(c.get("ctx"), id(c.req.param("id")))));

const kinds = Object.keys(TIMELINE_KINDS) as [TimelineKind, ...TimelineKind[]];

incidentRoutes.post("/:id/timeline", async (c) => {
  const input = await body(c, z.object({ at: z.string().max(40).nullish(), kind: z.enum(kinds), title: text(300), body: text(4000).nullish(), key: z.boolean().optional() }));
  return c.json({ event: await addTimelineEvent(c.get("ctx"), id(c.req.param("id")), input) });
});

incidentRoutes.post("/:id/timeline/promote", async (c) => {
  const input = await body(c, z.object({ entry_id: UUID, kind: z.enum(kinds).optional() }));
  return c.json({ event: await promoteEntry(c.get("ctx"), id(c.req.param("id")), input.entry_id, input.kind ?? "note") });
});

incidentRoutes.patch("/:id/timeline/:eventId", async (c) => {
  const input = await body(c, z.object({ key: z.boolean() }));
  return c.json(await changeTimelineEvent(c.get("ctx"), id(c.req.param("id")), id(c.req.param("eventId")), { key: input.key }));
});

incidentRoutes.delete("/:id/timeline/:eventId", async (c) => c.json(await changeTimelineEvent(c.get("ctx"), id(c.req.param("id")), id(c.req.param("eventId")), { remove: true })));

incidentRoutes.post("/:id/updates", async (c) => {
  const input = await body(c, z.object({
    audience: z.enum(Object.keys(AUDIENCES) as [Audience, ...Audience[]]),
    subject: text(200),
    body: text(20_000),
    channels: z.array(z.enum(["in_app", "email", "sms"])).max(3).optional(),
  }));
  return c.json(await sendUpdate(c.get("ctx"), id(c.req.param("id")), input));
});

incidentRoutes.post("/:id/review", async (c) => {
  const ctx = c.get("ctx");
  const r = await draftReview(ctx, id(c.req.param("id")));
  return c.json({ ...(await shaped(ctx, "incident_review", r.row.id)), created: r.created });
});

// AI skills (only when the AI layer registered them): suggestions, never writes
const SKILLS = ["summarize", "suggestResolution", "draftKnowledge", "draftUpdate"] as const;
incidentRoutes.post("/:id/ai/:skill", async (c) => {
  const skill = z.enum(SKILLS).parse(c.req.param("skill"));
  const input = await body(c, z.object({ audience: z.string().max(40).optional() }).passthrough());
  const ai = incidentAi();
  const ctx = c.get("ctx");
  const rid = id(c.req.param("id"));
  await get(ctx, "incident", rid); // 404 unless the caller may read it
  if (skill === "summarize" && ai.summarize) return c.json(await ai.summarize(ctx, rid));
  if (skill === "suggestResolution" && ai.suggestResolution) return c.json(await ai.suggestResolution(ctx, rid));
  if (skill === "draftKnowledge" && ai.draftKnowledge) return c.json(await ai.draftKnowledge(ctx, rid));
  if (skill === "draftUpdate" && ai.draftUpdate) return c.json(await ai.draftUpdate(ctx, rid, input.audience ?? "stakeholders"));
  throw notFound("این توانایی هوش مصنوعی هنوز فعال نیست");
});

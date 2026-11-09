// HTTP API of the self-service portal (docs/modules/portal_FA.md «API»). Records themselves (portals, quick links,
// topics, surveys and their questions and triggers, feedback, connectors, widgets, public knowledge) are served by the
// generic engine API (/r/portal…); these routes are what it cannot express, and every one works with the caller's own
// context (requester projections, their own records, their approvals):
//   GET  /config · POST /portal-choice · GET /home · GET /catalog · POST /favorites/:item · GET /topics/:id
//   GET  /search · POST /search/answer · POST /events
//   GET  /items · GET /tickets/:table/:id · POST /tickets/:table/:id/reply · POST /tickets/:table/:id/action
//   POST /tickets/:table/:id/suggest
//   GET  /todo · GET /approvals/:id
//   GET  /surveys/:invitation · POST /surveys/:invitation · GET /survey-results · POST /surveys/send/:survey
//   GET  /record-surveys/:table/:id
//   GET  /profile · POST /link-code · DELETE /identities/:id
//   POST /layout/:portal/publish · GET /logo/:portal · POST /seed · GET /analytics
//   connectors: POST /channels/:id/secret · /rotate-key · /register · GET /channels/:id/log
//   widgets: POST /widgets/:id/key · GET /widgets/:id/snippet
//   public knowledge: GET /public-kb · POST /public-kb/:id
// Sign-in-free (on /api/public, rate limited per client; the connectors' hook and the widget's search per key too):
//   POST /portal/hooks/:key                      a messenger's or a gateway's delivery (signed)
//   GET  /portal/survey/:token · POST …           a survey by its signed single-use link
//   GET  /portal/kb/:token · /search · /a/:slug · POST /a/:slug/vote   published knowledge
//   GET  /portal/widget/:key.js · /config · /search (from the widget's allowed sites only)
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { AppError, bad, forbidden, notFound } from "../http/errors";
import { rateLimit, type RateLimitOptions } from "../http/ratelimit";
import { publicRoutes } from "./public";
import {
  approvalDetail, catalogPage, channelLog, choosePortal, ensurePortalSweep, logEvent, managesChannels, myIdentities, myItems, newChannelSecret, newLinkCode, portalAnalytics, portalConfig, portalHome, portalLogo, portalSearch,
  portalTodo, publicKbArticle, publicKbHome, publicKbSearch, publicKbVote, publicSurveyView, publications, publishLayout, receiveHook, recordSurveys, registerChannelWebhook, replySuggestions, replyToTicket, rotateChannelKey,
  rotateWidgetKey, searchAnswer, seedPortalDefaults, sendCampaign, setPublication, submitPublicSurvey, submitSurvey, surveyResults, surveyView, ticketAction, ticketView, toggleFavorite, topicPage, unlinkIdentity,
  widgetConfig, widgetScript, widgetSearch, widgetSnippet, managesPortal, MAX_HOOK_BYTES,
} from "../modules/portal";
import { liveRow, liveRows, subjectFor, sysOf } from "../modules/portal/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{1,60}$/, "جدول معتبر نیست");
const id = (c: C, name = "id") => UUID.parse(c.req.param(name));

export const portalRoutes = router();

// ---------------------------------------------------------------------------------------------------------------
// The portal itself

portalRoutes.get("/config", async (c) => {
  const q = query(c, z.object({ portal: UUID.optional(), preview: z.enum(["1", "0"]).optional() }));
  return c.json(await portalConfig(c.get("ctx"), { portal: q.portal ?? null, preview: q.preview === "1" }));
});

portalRoutes.post("/portal-choice", async (c) => {
  const p = await body(c, z.object({ portal: UUID }));
  await choosePortal(c.get("ctx"), p.portal);
  return c.json({ ok: true });
});

portalRoutes.get("/home", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ portal: UUID.optional(), preview: z.enum(["1", "0"]).optional() }));
  const cfg = await portalConfig(ctx, { portal: q.portal ?? null, preview: q.preview === "1" });
  const home = await portalHome(ctx, cfg);
  await logEvent(ctx.db, ctx, { kind: "home" });
  return c.json(home);
});

portalRoutes.get("/catalog", async (c) => {
  const q = query(c, z.object({ category: UUID.optional(), q: z.string().max(200).optional() }));
  return c.json(await catalogPage(c.get("ctx"), { category: q.category ?? null, q: q.q ?? null }));
});

portalRoutes.post("/favorites/:item", async (c) => {
  const p = await body(c, z.object({ on: z.boolean() }));
  return c.json({ favorites: await toggleFavorite(c.get("ctx"), id(c, "item"), p.on) });
});

portalRoutes.get("/topics/:id", async (c) => c.json(await topicPage(c.get("ctx"), id(c))));

portalRoutes.get("/search", async (c) => {
  const q = query(c, z.object({ q: z.string().max(200).default(""), session: z.string().max(80).optional(), log: z.enum(["0", "1"]).optional() }));
  return c.json(await portalSearch(c.get("ctx"), q.q, { session: q.session ?? null, log: q.log !== "0" }));
});

portalRoutes.post("/search/answer", async (c) => {
  const ctx = c.get("ctx");
  const p = await body(c, z.object({ q: z.string().trim().min(1).max(500) }));
  const answer = await searchAnswer(ctx, p.q);
  if (answer) await logEvent(ctx.db, ctx, { kind: "answer", query: p.q, results: answer.citations.length, data: { fallback: answer.fallback } });
  return c.json({ answer });
});

/** What the portal's screens report: deflections, orders and reports made there, clicks on results. */
portalRoutes.post("/events", async (c) => {
  const ctx = c.get("ctx");
  const p = await body(c, z.object({ kind: z.enum(["deflect", "order", "report", "click", "feedback"]), query: z.string().max(300).nullish(), ref_table: TABLE.nullish(), ref_id: UUID.nullish(), session: z.string().max(80).nullish() }));
  await logEvent(ctx.db, ctx, { kind: p.kind, query: p.query ?? null, ref_table: p.ref_table ?? null, ref_id: p.ref_id ?? null, session_id: p.session ?? null });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------------------------------------------
// «درخواست‌های من» and the ticket page

portalRoutes.get("/items", async (c) => {
  const q = query(c, z.object({ tab: z.enum(["mine", "shared", "team"]).default("mine"), state: z.enum(["open", "closed", "all"]).default("open"), q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(100).default(1), size: z.coerce.number().int().min(1).max(50).default(20) }));
  return c.json(await myItems(c.get("ctx"), q));
});

portalRoutes.get("/tickets/:table/:id", async (c) => c.json(await ticketView(c.get("ctx"), TABLE.parse(c.req.param("table")), id(c))));

portalRoutes.post("/tickets/:table/:id/reply", async (c) => {
  const p = await body(c, z.object({ body: z.string().trim().min(1, "متن پاسخ خالی است").max(20_000), attachments: z.array(UUID).max(20).default([]) }));
  await replyToTicket(c.get("ctx"), TABLE.parse(c.req.param("table")), id(c), p.body, p.attachments);
  return c.json(await ticketView(c.get("ctx"), TABLE.parse(c.req.param("table")), id(c)));
});

portalRoutes.post("/tickets/:table/:id/action", async (c) => {
  const p = await body(c, z.object({ action: z.enum(["confirm", "reopen", "cancel", "withdraw", "chase"]), comment: z.string().max(4000).nullish(), rating: z.number().int().min(1).max(5).nullish() }));
  const table = TABLE.parse(c.req.param("table"));
  await ticketAction(c.get("ctx"), table, id(c), p);
  return c.json(await ticketView(c.get("ctx"), table, id(c)));
});

portalRoutes.post("/tickets/:table/:id/suggest", async (c) => {
  const ctx = c.get("ctx");
  const table = TABLE.parse(c.req.param("table"));
  // the ticket must be one the portal shows the caller
  await ticketView(ctx, table, id(c));
  return c.json(await replySuggestions(ctx, table, id(c)));
});

// ---------------------------------------------------------------------------------------------------------------
// «کارهای من» and approvals

portalRoutes.get("/todo", async (c) => c.json(await portalTodo(c.get("ctx"))));
portalRoutes.get("/approvals/:id", async (c) => c.json(await approvalDetail(c.get("ctx"), id(c))));

// ---------------------------------------------------------------------------------------------------------------
// Surveys

portalRoutes.get("/surveys/:id", async (c) => c.json(await surveyView(c.get("ctx"), id(c))));

portalRoutes.post("/surveys/:id", async (c) => {
  const p = await body(c, z.object({ answers: z.record(z.string(), z.unknown()) }));
  return c.json(await submitSurvey(c.get("ctx"), id(c), p.answers));
});

portalRoutes.get("/survey-results", async (c) => {
  const q = query(c, z.object({ survey: UUID.optional(), days: z.coerce.number().int().min(7).max(730).default(90) }));
  return c.json(await surveyResults(c.get("ctx"), { survey: q.survey ?? null, days: q.days }));
});

portalRoutes.post("/surveys/send/:survey", async (c) => c.json(await sendCampaign(c.get("ctx"), id(c, "survey"))));

portalRoutes.get("/record-surveys/:table/:id", async (c) => c.json(await recordSurveys(c.get("ctx"), TABLE.parse(c.req.param("table")), id(c))));

// ---------------------------------------------------------------------------------------------------------------
// Profile and messengers

portalRoutes.get("/profile", async (c) => {
  const ctx = c.get("ctx");
  const sys = sysOf(ctx);
  const [profile] = await liveRows(ctx.db, sys, "member_profile", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  const names = async (table: string, rid: unknown) => (typeof rid === "string" ? String((await liveRow(ctx.db, sys, table, rid))?.name ?? "") || null : null);
  const manager = typeof profile?.manager_id === "string" ? await ctx.db.one<{ full_name: string | null; email: string }>(`select full_name, email from sm_users where id = $1`, [profile.manager_id]) : null;
  const channels = await liveRows(ctx.db, sys, "portal_channel", { f: "active", op: "eq", v: true }, { limit: 20 });
  return c.json({
    user: { id: ctx.user.id, name: ctx.user.full_name ?? ctx.user.email, email: ctx.user.email, mobile: ctx.user.mobile ?? null },
    profile: { unit: await names("org_unit", profile?.org_unit_id), location: await names("location", profile?.location_id), manager: manager ? (manager.full_name || manager.email) : null, title: (profile?.title as string) ?? null, persona: (profile?.persona as string) ?? null },
    identities: await myIdentities(ctx),
    channels: channels.length,
  });
});

portalRoutes.post("/link-code", async (c) => c.json(await newLinkCode(c.get("ctx"))));

portalRoutes.delete("/identities/:id", async (c) => {
  await unlinkIdentity(c.get("ctx"), id(c));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------------------------------------------
// Administration

portalRoutes.post("/layout/:id/publish", async (c) => c.json({ portal: await publishLayout(c.get("ctx"), id(c)) }));

portalRoutes.get("/logo/:id", async (c) => {
  const { data, mime } = await portalLogo(c.get("ctx"), id(c));
  return new Response(Buffer.from(data), { status: 200, headers: { "content-type": mime, "content-length": String(data.byteLength), "x-content-type-options": "nosniff", "cache-control": "private, max-age=86400" } });
});

portalRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!(await managesPortal(ctx))) throw forbidden("افزودن پیش‌فرض‌های درگاه با مدیران کاتالوگ است");
  const p = await body(c, z.object({ force: z.boolean().optional() }));
  const r = await seedPortalDefaults(ctx.cfg, ctx.org.id, { force: p.force });
  await ensurePortalSweep(ctx.db, ctx.org.id);
  return c.json(r);
});

portalRoutes.get("/analytics", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }));
  return c.json(await portalAnalytics(c.get("ctx"), q.days));
});

portalRoutes.post("/channels/:id/secret", async (c) => c.json(await newChannelSecret(c.get("ctx"), id(c))));
portalRoutes.post("/channels/:id/rotate-key", async (c) => c.json(await rotateChannelKey(c.get("ctx"), id(c))));
portalRoutes.post("/channels/:id/register", async (c) => c.json(await registerChannelWebhook(c.get("ctx"), id(c))));
portalRoutes.get("/channels/:id/log", async (c) => c.json(await channelLog(c.get("ctx"), id(c))));

portalRoutes.post("/widgets/:id/key", async (c) => c.json(await rotateWidgetKey(c.get("ctx"), id(c))));
portalRoutes.get("/widgets/:id/snippet", async (c) => {
  const ctx = c.get("ctx");
  if (!(await managesChannels(ctx))) throw forbidden("ابزارک وب‌سایت را مدیران اتصال‌ها تنظیم می‌کنند");
  const row = await liveRow(ctx.db, sysOf(ctx), "portal_widget", id(c));
  if (!row) throw notFound("ابزارک پیدا نشد");
  return c.json({ snippet: typeof row.widget_key === "string" && row.widget_key ? widgetSnippet(ctx.cfg, row.widget_key) : null });
});

portalRoutes.get("/public-kb", async (c) => c.json({ publications: await publications(c.get("ctx")) }));
portalRoutes.post("/public-kb/:id", async (c) => {
  const p = await body(c, z.object({ enabled: z.boolean(), regenerate: z.boolean().optional() }));
  return c.json(await setPublication(c.get("ctx"), id(c), p));
});

/** Who manages people (for «تیم من»): a small answer the screens use. */
portalRoutes.get("/me", async (c) => {
  const ctx = c.get("ctx");
  const s = await subjectFor(ctx);
  return c.json({ team: s.reportees.length > 0 || s.managedTree.length > 0, admin: await managesPortal(ctx), channels_admin: await managesChannels(ctx) });
});

// ---------------------------------------------------------------------------------------------------------------
// Sign-in-free endpoints (/api/public/portal/…)

/** A connector's deliveries: 300 a minute per webhook key (on top of the public router's per-client limit). */
const HOOK_LIMIT: RateLimitOptions = { name: "portal-hook", limit: 300, windowMs: 60_000, key: (c) => String(c.req.param("key") ?? "") };
/** A widget's guest searches: 60 a minute per widget and client. */
const WIDGET_LIMIT: RateLimitOptions = { name: "portal-widget", limit: 60, windowMs: 60_000 };
/** Survey answers by link: 20 a minute per client. */
const SURVEY_LIMIT: RateLimitOptions = { name: "portal-survey", limit: 20, windowMs: 60_000 };

const headersOf = (c: C) => (name: string) => c.req.header(name);

publicRoutes.post("/portal/hooks/:key", rateLimit(HOOK_LIMIT), async (c) => {
  if (Number(c.req.header("content-length") ?? 0) > MAX_HOOK_BYTES) throw new AppError(413, "too_large", "حجم پیام بیش از اندازه است");
  const raw = await c.req.text();
  return c.json(await receiveHook(c.get("cfg"), c.req.param("key"), headersOf(c), raw));
});

publicRoutes.get("/portal/survey/:token", async (c) => c.json(await publicSurveyView(c.get("cfg"), c.req.param("token"))));
publicRoutes.post("/portal/survey/:token", rateLimit(SURVEY_LIMIT), async (c) => {
  const p = await body(c, z.object({ answers: z.record(z.string(), z.unknown()) }));
  return c.json(await submitPublicSurvey(c.get("cfg"), c.req.param("token"), p.answers));
});

publicRoutes.get("/portal/kb/:token", async (c) => c.json(await publicKbHome(c.get("cfg"), c.req.param("token"))));
publicRoutes.get("/portal/kb/:token/search", async (c) => {
  const q = query(c, z.object({ q: z.string().max(120).default(""), base: z.string().max(40).optional() }));
  return c.json(await publicKbSearch(c.get("cfg"), c.req.param("token"), q.q, q.base ?? null));
});
publicRoutes.get("/portal/kb/:token/a/:slug", async (c) => c.json(await publicKbArticle(c.get("cfg"), c.req.param("token"), c.req.param("slug"))));
publicRoutes.post("/portal/kb/:token/a/:slug/vote", rateLimit(SURVEY_LIMIT), async (c) => {
  const p = await body(c, z.object({ helpful: z.boolean() }));
  return c.json(await publicKbVote(c.get("cfg"), c.req.param("token"), c.req.param("slug"), p.helpful));
});

publicRoutes.get("/portal/widget/:file", async (c) => {
  const file = c.req.param("file");
  const m = /^([A-Za-z0-9_-]{16,80})\.js$/.exec(file);
  if (!m) throw notFound("ابزارک پیدا نشد");
  await widgetConfig(c.get("cfg"), m[1]);
  return new Response(widgetScript(m[1]), { status: 200, headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
});
publicRoutes.get("/portal/widget/:key/config", async (c) => c.json(await widgetConfig(c.get("cfg"), c.req.param("key"))));

// a GET (the platform refuses cross-origin mutations): the Origin a browser sends must be one of the widget's sites
publicRoutes.get("/portal/widget/:key/search", rateLimit(WIDGET_LIMIT), async (c) => {
  const q = query(c, z.object({ q: z.string().max(120).default("") }));
  const r = await widgetSearch(c.get("cfg"), c.req.param("key"), c.req.header("origin"), q.q);
  c.header("Vary", "Origin");
  return c.json({ hits: r.hits });
});

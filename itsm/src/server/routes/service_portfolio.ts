// HTTP API of the service portfolio under /api/o/:org/service_portfolio (docs/modules/service_portfolio_FA.md «API»).
// Records themselves (services, offerings, commitments, subscriptions, proposals…) are served by the generic engine
// API (/r/service…); these routes are what it cannot express: the status page and its public link, self-service
// subscriptions, the owner's scorecard, portfolio reports, rationalization, catalogue health, technology risk,
// «my services» and entitlements, the service picker and affected services from CIs, and the AI skills (409 until
// the AI layer registers them). The public status page is GET /api/public/status/:key (no sign-in, rate limited; a
// projection), also at its first address GET /api/v1/status/:key; the page people open is /p/status/:key.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { AppError, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { createIn, defFor, removeIn, systemCtx, updateIn } from "../engine";
import { lockKey } from "../db";
import { todayISO } from "@shared/jalali";
import type { ServiceMeta, ServicePickerHit } from "@shared/service_portfolio/api";
import { publicApiRoutes } from "./integrations";
import { PUBLIC_LIMIT, publicRoutes } from "./public";
import { rateLimit } from "../http/ratelimit";
import type { C } from "../http/hono";
import { servicesImpactedBy } from "../modules/cmdb/impact";
import {
  catalogueHealth, entitledOfferings, isPortfolioManager, myServices, orgOfStatusToken, portfolioAi, portfolioAiCapabilities, portfolioReport, publicView,
  rationalization, refreshStatuses, scoreDay, seedPortfolioDefaults, serviceConfig, servicePicker, serviceScorecard, statusPage, technologyRisk,
} from "../modules/service_portfolio";
import { isUuid, liveRow, liveRows, sysOf } from "../modules/service_portfolio/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();

const needManager = async (ctx: Parameters<typeof isPortfolioManager>[0]) => {
  if (!(await isPortfolioManager(ctx))) throw forbidden("این کار با مدیر سبد خدمات است");
};

/** The caller reads services at all (the area's read grant on the table). */
async function needServices(ctx: Parameters<typeof isPortfolioManager>[0]) {
  const { def } = await defFor(ctx, "service");
  if (!access().canReadTable(ctx, def)) throw forbidden("به سبد خدمات دسترسی ندارید");
  return def;
}

const notRegistered = () => new AppError(409, "not_available", "این قابلیت هوش مصنوعی هنوز فعال نشده است");

export const servicePortfolioRoutes = router();

servicePortfolioRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "service");
  const cfg = await serviceConfig(ctx.db, ctx);
  const meta: ServiceMeta = {
    can_manage: await isPortfolioManager(ctx),
    can_create: access().canCreate(ctx, def, null),
    ai: portfolioAiCapabilities(),
    status_page_public: !!cfg.status_page_public,
  };
  return c.json(meta);
});

// ---------------------------------------------------------------------------------------------------------------
// The status page (every member of the organisation; services their owners published)

servicePortfolioRoutes.get("/status", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(90).optional() }));
  const page = await statusPage(ctx, { days: q.days, forUser: ctx.user.id });
  const manager = await isPortfolioManager(ctx);
  const cfg = manager ? await serviceConfig(ctx.db, ctx) : null;
  return c.json({ ...page, can_manage: manager, public_token: manager && cfg?.status_page_public ? cfg.status_page_token : null });
});

servicePortfolioRoutes.post("/status/public", async (c) => {
  const ctx = c.get("ctx");
  await needManager(ctx);
  const input = await body(c, z.object({ enabled: z.boolean(), regenerate: z.boolean().optional() }));
  if (input.enabled && ctx.cfg.mode === "desktop") throw new AppError(400, "desktop", "صفحهٔ وضعیت عمومی فقط در نسخهٔ وب منتشر می‌شود");
  const sys = sysOf(ctx);
  const token = await ctx.write(async (tx) => {
    const cfg = await serviceConfig(tx, sys);
    const next = input.enabled ? (input.regenerate || !cfg.status_page_token ? randomBytes(24).toString("base64url") : cfg.status_page_token) : cfg.status_page_token;
    const values = { status_page_public: input.enabled, status_page_token: next };
    if (cfg.id) await updateIn(tx, sys, "service_config", cfg.id, values, { trusted: true });
    else await createIn(tx, sys, "service_config", { config_key: "default", name: "تنظیمات سبد خدمات", ...values }, { trusted: true });
    return input.enabled ? next : null;
  });
  return c.json({ enabled: input.enabled, token });
});

servicePortfolioRoutes.post("/status/refresh", async (c) => {
  const ctx = c.get("ctx");
  await needManager(ctx);
  const sys = sysOf(ctx);
  return c.json(await ctx.write((tx) => refreshStatuses(tx, sys)));
});

// self-service subscriptions: to a service on the status page, one of «my services», or one the caller may read
servicePortfolioRoutes.post("/services/:id/subscribe", async (c) => {
  const ctx = c.get("ctx");
  const serviceId = id(c.req.param("id"));
  const sys = sysOf(ctx);
  const s = await liveRow(ctx.db, sys, "service", serviceId);
  if (!s || !["live", "transition"].includes(s.state)) throw notFound("خدمت پیدا نشد یا مشترک تازه نمی‌پذیرد");
  const readable = !!(await liveRow(ctx.db, ctx, "service", serviceId));
  const mine = readable || s.on_status_page || (await myServices(ctx, ctx.user.id)).some((m) => m.id === serviceId);
  if (!mine) throw notFound("خدمت پیدا نشد یا مشترک تازه نمی‌پذیرد");
  // the person's subscription key, then their subscription looked for: two clicks at once make one subscription
  const out = await ctx.write(async (tx) => {
    await lockKey(tx, `service.subscribe:${serviceId}:${ctx.user.id}`);
    const [existing] = await liveRows(tx, sys, "service_subscription", { and: [{ f: "service_id", op: "eq", v: serviceId }, { f: "user_id", op: "eq", v: ctx.user.id }, { f: "subscriber_kind", op: "eq", v: "user" }] }, { limit: 1 });
    if (existing) return { id: existing.id, created: false };
    const row = await createIn(tx, sys, "service_subscription", { service_id: serviceId, subscriber_kind: "user", user_id: ctx.user.id, origin_kind: "self", notify: true, valid_from: todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran")) }, { trusted: true });
    return { id: row.id, created: true };
  });
  return c.json(out);
});

servicePortfolioRoutes.post("/services/:id/unsubscribe", async (c) => {
  const ctx = c.get("ctx");
  const serviceId = id(c.req.param("id"));
  const sys = sysOf(ctx);
  const rows = await liveRows(ctx.db, sys, "service_subscription", { and: [{ f: "service_id", op: "eq", v: serviceId }, { f: "user_id", op: "eq", v: ctx.user.id }, { f: "subscriber_kind", op: "eq", v: "user" }] }, { limit: 20 });
  await ctx.write(async (tx) => {
    for (const r of rows) await removeIn(tx, sys, "service_subscription", r.id, { trusted: true });
  });
  return c.json({ removed: rows.length });
});

// ---------------------------------------------------------------------------------------------------------------
// Owners and managers

servicePortfolioRoutes.get("/services/:id/scorecard", async (c) => c.json(await serviceScorecard(c.get("ctx"), id(c.req.param("id")))));

servicePortfolioRoutes.post("/services/:id/review", async (c) => {
  const ctx = c.get("ctx");
  const serviceId = id(c.req.param("id"));
  const def = await needServices(ctx);
  const s = await liveRow(ctx.db, ctx, "service", serviceId);
  if (!s) throw notFound("خدمت پیدا نشد");
  if (!access().canWrite(ctx, def, s)) throw forbidden("بازبینی این خدمت با مالک آن است");
  const today = todayISO(String(ctx.org.settings?.timezone ?? "Asia/Tehran"));
  const row = await ctx.write((tx) => updateIn(tx, ctx, "service", serviceId, { last_reviewed_at: today }));
  return c.json({ id: row.id, last_reviewed_at: row.last_reviewed_at });
});

servicePortfolioRoutes.get("/report", async (c) => {
  const ctx = c.get("ctx");
  await needServices(ctx);
  return c.json(await portfolioReport(ctx));
});

servicePortfolioRoutes.get("/rationalization", async (c) => {
  const ctx = c.get("ctx");
  await needServices(ctx);
  return c.json(await rationalization(ctx));
});

servicePortfolioRoutes.get("/health", async (c) => {
  const ctx = c.get("ctx");
  await needServices(ctx);
  return c.json(await catalogueHealth(ctx));
});

servicePortfolioRoutes.get("/technology", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "technology_standard");
  if (!access().canReadTable(ctx, def)) throw forbidden("به استانداردهای فناوری دسترسی ندارید");
  return c.json({ rows: await technologyRisk(ctx) });
});

servicePortfolioRoutes.post("/score/run", async (c) => {
  const ctx = c.get("ctx");
  await needManager(ctx);
  const input = await body(c, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  const sys = sysOf(ctx);
  return c.json(await ctx.write((tx) => scoreDay(tx, sys, { day: input.day })));
});

servicePortfolioRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  await needManager(ctx);
  return c.json(await seedPortfolioDefaults(ctx.cfg, ctx.org.id, { force: true }));
});

// ---------------------------------------------------------------------------------------------------------------
// Everyone: «my services», entitlements, pickers

servicePortfolioRoutes.get("/mine", async (c) => {
  const ctx = c.get("ctx");
  return c.json({ services: await myServices(ctx, ctx.user.id) });
});

servicePortfolioRoutes.get("/entitled", async (c) => {
  const ctx = c.get("ctx");
  const { offerings } = await entitledOfferings(ctx, ctx.user.id);
  return c.json({ offerings: offerings.map((o) => ({ id: String(o.id), name: String(o.name), service_id: String(o.service_id), level: o.level ?? null })) });
});

servicePortfolioRoutes.get("/picker", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({
    q: z.string().max(200).optional(),
    kind: z.enum(["service", "offering"]).optional(),
    service: UUID.optional(),
    ci: z.string().max(400).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }));
  const ciIds = (q.ci ?? "").split(",").map((x) => x.trim()).filter(isUuid);
  return c.json({ hits: await servicePicker(ctx, { q: q.q, kind: q.kind, service_id: q.service ?? null, ci_ids: ciIds, limit: q.limit }) });
});

// the services a record's CIs reach (incidents, problems and changes fill «خدمت‌های متأثر» with it); hidden ones counted
servicePortfolioRoutes.post("/affected", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ ci_ids: z.array(UUID).min(1).max(20) }));
  const reached = await servicesImpactedBy(ctx.db, ctx, input.ci_ids);
  const rows = reached.length ? await liveRows(ctx.db, ctx, "service", { f: "id", op: "in", v: reached }, { order: "t.name", limit: 100 }) : [];
  const hits: ServicePickerHit[] = rows.map((s) => ({ id: String(s.id), number: s.number ?? null, name: String(s.name), kind: "service", state: s.state ?? null, status: s.status ?? null, tier: s.tier ?? null, ci_id: s.ci_id ?? null, derived: true }));
  return c.json({ services: hits, restricted: Math.max(0, reached.length - hits.length) });
});

// ---------------------------------------------------------------------------------------------------------------
// AI skills (registered by the AI layer; 409 until then)

servicePortfolioRoutes.post("/ai/describe/:id", async (c) => {
  const ctx = c.get("ctx");
  const ai = portfolioAi();
  if (!ai.describe) throw notRegistered();
  const serviceId = id(c.req.param("id"));
  if (!(await liveRow(ctx.db, ctx, "service", serviceId))) throw notFound("خدمت پیدا نشد");
  const input = await body(c, z.object({ tone: z.enum(["formal", "plain"]).optional() }));
  return c.json(await ai.describe(ctx, serviceId, input));
});

servicePortfolioRoutes.post("/ai/translate/:id", async (c) => {
  const ctx = c.get("ctx");
  const ai = portfolioAi();
  if (!ai.translate) throw notRegistered();
  const serviceId = id(c.req.param("id"));
  if (!(await liveRow(ctx.db, ctx, "service", serviceId))) throw notFound("خدمت پیدا نشد");
  const input = await body(c, z.object({ to: z.enum(["fa", "en"]) }));
  return c.json(await ai.translate(ctx, serviceId, input.to));
});

servicePortfolioRoutes.post("/ai/classify", async (c) => {
  const ctx = c.get("ctx");
  const ai = portfolioAi();
  if (!ai.classify) throw notRegistered();
  const input = await body(c, z.object({ text: z.string().min(3).max(5000), caller_id: UUID.nullish(), ci_id: UUID.nullish() }));
  const hits = await ai.classify(ctx, input);
  // only services the caller may read
  const ids = hits.map((h) => h.service_id).filter(isUuid);
  const readable = new Set((ids.length ? await liveRows(ctx.db, ctx, "service", { f: "id", op: "in", v: ids }) : []).map((s) => String(s.id)));
  return c.json({ suggestions: hits.filter((h) => !h.service_id || readable.has(h.service_id)) });
});

servicePortfolioRoutes.post("/ai/narrative/:id", async (c) => {
  const ctx = c.get("ctx");
  const ai = portfolioAi();
  if (!ai.narrative) throw notRegistered();
  const serviceId = id(c.req.param("id"));
  const facts = await serviceScorecard(ctx, serviceId);
  return c.json(await ai.narrative(ctx, serviceId, facts));
});

servicePortfolioRoutes.post("/ai/gaps", async (c) => {
  const ctx = c.get("ctx");
  const ai = portfolioAi();
  if (!ai.gaps) throw notRegistered();
  await needServices(ctx);
  const input = await body(c, z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
  return c.json(await ai.gaps(ctx, input));
});

// ---------------------------------------------------------------------------------------------------------------
// The public status page (no sign-in): GET /api/v1/status/:key — published services only, as a projection

async function publicStatus(c: C) {
  const cfg = c.get("cfg");
  const orgId = await orgOfStatusToken(cfg.db, c.req.param("key") ?? "");
  if (!orgId) throw notFound("صفحهٔ وضعیت پیدا نشد");
  const sys = await systemCtx(cfg, orgId);
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(90).optional() }));
  const page = publicView(await statusPage(sys, { days: q.days }));
  c.header("Cache-Control", "public, max-age=60");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(page);
}

publicRoutes.get("/status/:key", publicStatus);
publicApiRoutes.get("/status/:key", rateLimit(PUBLIC_LIMIT), publicStatus);


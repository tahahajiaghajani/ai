// Inbound webhooks (/api/hooks/:id), the key-authenticated public API (/api/v1) and integration management
// (/api/o/:org/integrations).
//
// A webhook stores every signed delivery (sm_integration_events, one row per sender event id) and hands it to
// the module that registered its topic (`registerTopicHandler` in modules/integrations/service.ts), acting as
// the organisation's owner. Without a handler the event stays «دریافت شد» for people to see and can be
// processed later with «تلاش دوباره» once a module understands it. The public API authenticates with an API
// key (Authorization: Bearer sm_… or X-API-Key); modules mount their own endpoints on `publicApiRoutes` and
// open their context with `apiCtx`.
import { z } from "zod";
import { router, body, type C } from "../http/hono";
import { AppError, bad, forbidden, notFound, unauthorized } from "../http/errors";
import { makeCtx, type AuthUser, type Ctx, type MemberRow, type OrgRow, type ServerConfig } from "../context";
import {
  MAX_HOOK_BYTES, createApiKey, createIntegration, eventExternalId, eventTopic, handlerFor, integrationSecret, loadIntegration,
  resolveApiKey, verifySignature, type HookEvent, type IntegrationConfig,
} from "../modules/integrations/service";
import { updateRow } from "../db/sql";
import { uuidv7 } from "@shared/id";
import { orgStatus, statusError } from "../modules/platform/org-admin";

/** Act on behalf of the organisation's owner (webhooks and API keys have no signed-in user). */
export async function ownerCtx(cfg: ServerConfig, orgId: string): Promise<Ctx> {
  const org = await cfg.db.one<OrgRow>(`select * from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان پیدا نشد");
  const member = await cfg.db.one<MemberRow>(
    `select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and role = 'owner' and is_active and deleted_at is null order by created_at limit 1`,
    [orgId],
  );
  if (!member) throw forbidden("مالک سازمان پیدا نشد");
  const user = await cfg.db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [member.user_id]);
  // a suspended organisation is closed to keys and webhooks as to its members (read-only refuses writes in ctx.write)
  const status = await orgStatus(cfg.db, orgId);
  if (status.status === "suspended") throw statusError(status);
  return makeCtx(cfg, user!, org, member, { status });
}

type EventRow = { id: string; integration_id: string | null; topic: string; external_id: string | null; payload: unknown };

type Outcome = { handled: false } | { handled: true; ok: true; result: Record<string, unknown> } | { handled: true; ok: false; message: string };

/**
 * Hand a stored event to the module that handles its topic and record the outcome on the event. Without a
 * handler the event keeps its status («دریافت شد»).
 */
async function processEvent(cfg: ServerConfig, orgId: string, ev: EventRow, integration: HookEvent["integration"]): Promise<Outcome> {
  const handler = handlerFor(ev.topic);
  if (!handler) return { handled: false };
  try {
    const ctx = await ownerCtx(cfg, orgId);
    const result = (await handler(ctx, { id: ev.id, topic: ev.topic, external_id: ev.external_id, payload: ev.payload, integration })) ?? {};
    await cfg.db.query(`update sm_integration_events set status = 'processed', result = $2, error = null where id = $1`, [ev.id, result]);
    return { handled: true, ok: true, result };
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 500);
    await cfg.db.query(`update sm_integration_events set status = 'failed', error = $2 where id = $1`, [ev.id, message]);
    return { handled: true, ok: false, message };
  }
}

const tooLarge = () => new AppError(413, "too_large", "حجم رویداد بیش از اندازهٔ مجاز است");

// ---------------------------------------------------------------- webhooks (public)

export const hookRoutes = router();

hookRoutes.post("/:id", async (c) => {
  const cfg = c.get("cfg");
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("اتصال پیدا نشد");
  const integ = await loadIntegration(cfg.db, id);
  if (!integ.is_active) return c.json({ ok: false, message: "این اتصال غیرفعال است" }, 410);
  if (Number(c.req.header("content-length") ?? 0) > MAX_HOOK_BYTES) throw tooLarge();
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_HOOK_BYTES) throw tooLarge();
  const secret = integrationSecret(cfg.secret, integ.secret);
  const header = (h: string) => c.req.header(h);
  if (!verifySignature(secret, raw, header)) throw unauthorized("امضای درخواست معتبر نیست");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw bad("بدنهٔ درخواست JSON نیست");
  }
  const topic = eventTopic(header, payload);
  const externalId = eventExternalId(header, payload);
  const eventId = uuidv7();
  const inserted = await cfg.db.one<{ id: string }>(
    `insert into sm_integration_events (id, org_id, integration_id, topic, external_id, payload, status)
     values ($1, $2, $3, $4, $5, $6, 'received') on conflict do nothing returning id`,
    [eventId, integ.org_id, integ.id, topic, externalId, payload],
  );
  await cfg.db.query(`update sm_integrations set last_event_at = now() where id = $1`, [integ.id]);
  // a retried delivery (the same sender event id) is stored once
  if (!inserted) return c.json({ ok: true, duplicate: true });
  const ev = { id: eventId, integration_id: integ.id, topic, external_id: externalId, payload };
  const outcome = await processEvent(cfg, integ.org_id, ev, { id: integ.id, name: integ.name, config: integ.config ?? {} });
  if (!outcome.handled) return c.json({ ok: true, id: eventId, status: "received" });
  // 200 even when the handler failed, so the sender does not retry forever; the event is retried from the app
  if (!outcome.ok) return c.json({ ok: false, id: eventId, status: "failed", message: outcome.message });
  return c.json({ ok: true, id: eventId, status: "processed", result: outcome.result });
});

// ---------------------------------------------------------------- public API (/api/v1)

export const publicApiRoutes = router();

/** The organisation context of an API key with the given scope (refused without it); modules use it for their endpoints. */
export async function apiCtx(c: C, scope: "read" | "write"): Promise<Ctx> {
  const cfg = c.get("cfg");
  const auth = c.req.header("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key");
  const k = await resolveApiKey(cfg.db, key);
  if (!k) throw unauthorized("کلید API معتبر نیست");
  if (!k.scopes.includes(scope)) throw forbidden("این کلید اجازهٔ این کار را ندارد");
  return ownerCtx(cfg, k.org_id);
}

/** Checks a key: which organisation it opens. */
publicApiRoutes.get("/ping", async (c) => {
  const ctx = await apiCtx(c, "read");
  return c.json({ ok: true, org: { id: ctx.org.id, name: ctx.org.name } });
});

// ---------------------------------------------------------------- management (/api/o/:org/integrations)

export const integrationRoutes = router();

integrationRoutes.get("/", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const rows = await ctx.db.query<{ id: string }>(
    `select id, kind, name, config, is_active, last_event_at, created_at,
            (select count(*)::int from sm_integration_events e where e.integration_id = i.id) as events,
            (select count(*)::int from sm_integration_events e where e.integration_id = i.id and e.status = 'failed') as failed
     from sm_integrations i where org_id = $1 and deleted_at is null order by created_at`,
    [ctx.org.id],
  );
  return c.json({ integrations: rows.map((r) => ({ ...r, webhook_path: `/api/hooks/${r.id}` })) });
});

const description = z.string().trim().max(400).nullish();

integrationRoutes.post("/", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({
    name: z.string().trim().min(2, "نام اتصال را وارد کنید").max(120),
    description,
    secret: z.union([z.literal(""), z.string().trim().min(16, "کلید امضا دست‌کم ۱۶ نویسه است").max(200)]).nullish(),
  }));
  const config: IntegrationConfig = { description: input.description || null };
  return c.json({ integration: await createIntegration(ctx, { name: input.name, config, secret: input.secret || null }) });
});

integrationRoutes.patch("/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "full");
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120).optional(), description, is_active: z.boolean().optional() }));
  const row = await ctx.write(async (tx) => {
    const cur = await tx.one<{ config: IntegrationConfig }>(`select config from sm_integrations where id = $1 and org_id = $2 and deleted_at is null`, [c.req.param("id"), ctx.org.id]);
    if (!cur) throw notFound("اتصال پیدا نشد");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.is_active !== undefined) patch.is_active = input.is_active;
    if (input.description !== undefined) patch.config = { ...(cur.config ?? {}), description: input.description || null };
    return updateRow(tx, "sm_integrations", { id: c.req.param("id"), org_id: ctx.org.id }, patch, "id, kind, name, config, is_active");
  });
  return c.json({ integration: row });
});

integrationRoutes.delete("/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "full");
  await ctx.write((tx) => tx.query(`update sm_integrations set deleted_at = now(), is_active = false where id = $1 and org_id = $2`, [c.req.param("id"), ctx.org.id]));
  return c.json({ ok: true });
});

integrationRoutes.get("/events", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const integration = c.req.query("integration");
  const params: unknown[] = [ctx.org.id];
  if (integration && /^[0-9a-f-]{36}$/i.test(integration)) params.push(integration);
  const rows = await ctx.db.query(
    `select e.id, e.integration_id, e.received_at, e.topic, e.external_id, e.status, e.result, e.error, i.name as integration_name
     from sm_integration_events e left join sm_integrations i on i.id = e.integration_id
     where e.org_id = $1 ${params.length > 1 ? "and e.integration_id = $2" : ""} order by e.received_at desc limit 200`,
    params,
  );
  return c.json({ events: rows });
});

/** One delivery with its body as the sender sent it. */
integrationRoutes.get("/events/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const ev = await ctx.db.one(
    `select e.id, e.integration_id, e.received_at, e.topic, e.external_id, e.status, e.result, e.error, e.payload, i.name as integration_name
     from sm_integration_events e left join sm_integrations i on i.id = e.integration_id where e.id = $1 and e.org_id = $2`,
    [c.req.param("id"), ctx.org.id],
  );
  if (!ev) throw notFound("رویداد پیدا نشد");
  return c.json({ event: ev });
});

integrationRoutes.post("/events/:id/retry", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "edit");
  const ev = await ctx.db.one<EventRow>(
    `select id, integration_id, topic, external_id, payload from sm_integration_events where id = $1 and org_id = $2`,
    [c.req.param("id"), ctx.org.id],
  );
  if (!ev) throw notFound("رویداد پیدا نشد");
  if (!handlerFor(ev.topic)) throw bad(`برای رویدادهای «${ev.topic}» هنوز پردازشی تعریف نشده است`);
  const integ = ev.integration_id ? await loadIntegration(ctx.db, ev.integration_id).catch(() => null) : null;
  const outcome = await processEvent(ctx.cfg, ctx.org.id, ev, { id: integ?.id ?? "", name: integ?.name ?? "", config: integ?.config ?? {} });
  if (outcome.handled && !outcome.ok) throw bad(outcome.message);
  return c.json({ ok: true, result: outcome.handled ? outcome.result : null });
});

integrationRoutes.get("/api-keys", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "view");
  const rows = await ctx.db.query(
    `select k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at, u.full_name as created_by_name
     from sm_api_keys k left join sm_users u on u.id = k.created_by where k.org_id = $1 order by k.created_at desc`,
    [ctx.org.id],
  );
  return c.json({ keys: rows });
});

integrationRoutes.post("/api-keys", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120), scopes: z.array(z.enum(["read", "write"])).min(1).default(["read", "write"]) }));
  return c.json(await createApiKey(ctx, input.name, input.scopes));
});

integrationRoutes.delete("/api-keys/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("integrations", "full");
  // revoking closes a door: allowed even while the organisation is read-only
  await ctx.db.query(`update sm_api_keys set revoked_at = now() where id = $1 and org_id = $2 and revoked_at is null`, [c.req.param("id"), ctx.org.id]);
  return c.json({ ok: true });
});

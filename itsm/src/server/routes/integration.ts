// The integration hub's HTTP API (docs/modules/integration_FA.md):
//   · /api/o/:org/integration/… (signed-in members; the integrations area): the hub's overview, integration users'
//     roles and keys, secrets shown once, the OpenAPI preview of an integration user, webhook deliveries and replays,
//     inbound deliveries, LDAP previews and applies, Jira/GitHub links, scheduled exports and the call log
//   · on the public API /api/v1 (mounted on publicApiRoutes here): the record API with keys of integration users
//     (/r/…, /meta/…), /openapi.json, inbound endpoints (/in/:id), SCIM (/scim/:source/…) and the issue trackers'
//     webhooks (/issues/:connection/hook)
import { z } from "zod";
import type { Context } from "hono";
import { router, body } from "../http/hono";
import { bad, forbidden, notFound } from "../http/errors";
import { rateLimit } from "../http/ratelimit";
import { cleanScopes, scopeAllows } from "@shared/integration/scopes";
import { scimError } from "@shared/integration/scim";
import { tableDef } from "@shared/tables";
import { randomToken } from "../auth/password";
import { updateIn } from "../engine";
import { recordRoutes } from "./records";
import { publicApiRoutes } from "./integrations";
import { needIntegrations, principalCtx, liveRow } from "../modules/integration/common";
import { hubOverview } from "../modules/integration/hub";
import { createKey, integrationRoles, listKeys, revokeKey, setIntegrationRoles } from "../modules/integration/users";
import { apiAuth, apiScopes, metaForKey, openApiFor } from "../modules/integration/api";
import { listDeliveries, replayDelivery, resumeSubscription, testSubscription } from "../modules/integration/webhooks";
import { inboundEvents, MAX_INBOUND_BYTES, receiveInbound, retryInbound } from "../modules/integration/inbound";
import { applyDirectory, approveSource, directoryRun, directoryRuns, previewDirectory, testDirectory } from "../modules/integration/directory";
import { mappingPreview, sourceSignins, ssoChecklist, testLogin } from "../modules/integration/directory-login";
import { linkIssue, receiveIssueHook, refreshRef, refsOf } from "../modules/integration/issues";
import { runScheduleNow } from "../modules/integration/exports";
import {
  createGroup, createUser, deleteGroup, deleteUser, getGroup, getUser, listGroups, listUsers, patchGroupById, patchUserById, scimSession, ScimError, serviceProviderConfig,
} from "../modules/integration/scim";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const uuid = (s: string | undefined, what = "مورد") => {
  const r = UUID.safeParse(s ?? "");
  if (!r.success) throw notFound(`${what} پیدا نشد`);
  return r.data.toLowerCase();
};
const apiBase = (c: Context) => `${new URL(c.req.url).origin}/api/v1`;

export const integrationHubRoutes = router();

integrationHubRoutes.get("/hub", async (c) => c.json(await hubOverview(c.get("ctx"))));

// ---------------------------------------------------------------- integration users, roles and keys

integrationHubRoutes.get("/users/:id/roles", async (c) => {
  const ctx = c.get("ctx");
  needIntegrations(ctx, "view");
  return c.json({ roles: await integrationRoles(ctx, uuid(c.req.param("id"), "کاربر یکپارچه‌سازی")) });
});

integrationHubRoutes.put("/users/:id/roles", async (c) => {
  const input = await body(c, z.object({ roles: z.array(z.string().max(41)).max(30) }));
  return c.json(await setIntegrationRoles(c.get("ctx"), uuid(c.req.param("id"), "کاربر یکپارچه‌سازی"), input.roles));
});

integrationHubRoutes.get("/keys", async (c) => {
  const user = c.req.query("user");
  return c.json({ keys: await listKeys(c.get("ctx"), user ? uuid(user, "کاربر یکپارچه‌سازی") : null) });
});

integrationHubRoutes.post("/users/:id/keys", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(2, "نام کلید را وارد کنید").max(120),
      scopes: z.array(z.object({ table: z.string().max(63), ops: z.array(z.enum(["read", "create", "update", "delete"])).min(1) })).min(1).max(200),
      rate_limit: z.number().int().min(1).max(100_000).nullish(),
      expires_at: z.string().datetime({ offset: true }).nullish(),
    }),
  );
  return c.json(await createKey(c.get("ctx"), uuid(c.req.param("id"), "کاربر یکپارچه‌سازی"), { ...input, scopes: cleanScopes(input.scopes) }));
});

integrationHubRoutes.delete("/keys/:id", async (c) => {
  await revokeKey(c.get("ctx"), uuid(c.req.param("id"), "کلید"));
  return c.json({ ok: true });
});

/** The OpenAPI document an integration user's keys would see (every operation its roles allow). */
integrationHubRoutes.get("/openapi", async (c) => {
  const ctx = c.get("ctx");
  needIntegrations(ctx, "view");
  const { ctx: p } = await principalCtx(ctx.cfg, ctx.org.id, uuid(c.req.query("user"), "کاربر یکپارچه‌سازی"));
  return c.json(await openApiFor(p, null, apiBase(c)));
});

// ---------------------------------------------------------------- secrets shown once

const SECRETS: Record<string, string> = {
  webhook_subscription: "secret",
  inbound_endpoint: "token",
  issue_connection: "webhook_secret",
  directory_source: "scim_token",
  export_schedule: "secret",
};

/** «راز تازه»: a new secret for a row's signing secret or token, shown once (the old one stops working). */
integrationHubRoutes.post("/secret", async (c) => {
  const ctx = c.get("ctx");
  needIntegrations(ctx, "full");
  const input = await body(c, z.object({ table: z.string().max(63), id: UUID }));
  const field = SECRETS[input.table];
  if (!field) throw bad("این جدول راز قابل ساخت ندارد");
  const row = await liveRow(ctx.db, ctx, input.table, input.id);
  if (!row) throw notFound("ردیف پیدا نشد");
  const secret = randomToken(input.table === "directory_source" ? 32 : 24);
  await ctx.write((tx) => updateIn(tx, ctx, input.table, input.id, { [field]: secret }, { version: Number(row.version) }));
  return c.json({ secret, field, path: input.table === "inbound_endpoint" ? `/api/v1/in/${input.id}` : input.table === "issue_connection" ? `/api/v1/issues/${input.id}/hook` : input.table === "directory_source" ? `/api/v1/scim/${input.id}` : null });
});

// ---------------------------------------------------------------- webhooks and inbound endpoints

integrationHubRoutes.get("/webhooks/deliveries", async (c) =>
  c.json({ deliveries: await listDeliveries(c.get("ctx"), { subscription: c.req.query("subscription") ? uuid(c.req.query("subscription"), "اشتراک") : null, status: c.req.query("status") || null }) }),
);
integrationHubRoutes.post("/webhooks/deliveries/:id/replay", async (c) => {
  await replayDelivery(c.get("ctx"), uuid(c.req.param("id"), "ارسال"));
  return c.json({ ok: true });
});
integrationHubRoutes.post("/webhooks/:id/test", async (c) => {
  const input = await body(c, z.object({ record_id: UUID.nullish() }));
  return c.json(await testSubscription(c.get("ctx"), uuid(c.req.param("id"), "اشتراک"), input.record_id ?? null));
});
integrationHubRoutes.post("/webhooks/:id/resume", async (c) => {
  await resumeSubscription(c.get("ctx"), uuid(c.req.param("id"), "اشتراک"));
  return c.json({ ok: true });
});

integrationHubRoutes.get("/inbound/events", async (c) => c.json({ events: await inboundEvents(c.get("ctx"), c.req.query("endpoint") ? uuid(c.req.query("endpoint"), "نقطهٔ دریافت") : null) }));
integrationHubRoutes.post("/inbound/events/:id/retry", async (c) => c.json(await retryInbound(c.get("ctx"), uuid(c.req.param("id"), "دریافتی"))));

// ---------------------------------------------------------------- directories

integrationHubRoutes.post("/directory/:id/test", async (c) => c.json(await testDirectory(c.get("ctx"), uuid(c.req.param("id"), "منبع"))));
integrationHubRoutes.post("/directory/:id/preview", async (c) => c.json(await previewDirectory(c.get("ctx"), uuid(c.req.param("id"), "منبع"))));
integrationHubRoutes.post("/directory/:id/apply", async (c) => {
  const input = await body(c, z.object({ run_id: UUID, roles: z.boolean().default(false) }));
  return c.json(await applyDirectory(c.get("ctx"), uuid(c.req.param("id"), "منبع"), input.run_id, { roles: input.roles }));
});
integrationHubRoutes.post("/directory/:id/approve", async (c) => c.json({ source: await approveSource(c.get("ctx"), uuid(c.req.param("id"), "منبع")) }));
integrationHubRoutes.get("/directory/:id/runs", async (c) => c.json({ runs: await directoryRuns(c.get("ctx"), uuid(c.req.param("id"), "منبع")) }));
integrationHubRoutes.get("/directory/runs/:runId", async (c) => c.json({ run: await directoryRun(c.get("ctx"), uuid(c.req.param("runId"), "اجرا")) }));
// «ورود با حساب سازمانی»: test a login name without its password, preview the mappings, the SSO checklist, the source's sign-ins
integrationHubRoutes.post("/directory/:id/login-test", async (c) => {
  const input = await body(c, z.object({ login: z.string().trim().min(1, "نام کاربری را وارد کنید").max(300) }));
  return c.json(await testLogin(c.get("ctx"), uuid(c.req.param("id"), "منبع"), input.login));
});
integrationHubRoutes.get("/directory/:id/mappings", async (c) => c.json(await mappingPreview(c.get("ctx"), uuid(c.req.param("id"), "منبع"))));
integrationHubRoutes.get("/directory/:id/sso", async (c) => c.json(await ssoChecklist(c.get("ctx"), uuid(c.req.param("id"), "منبع"), new URL(c.req.url).host)));
integrationHubRoutes.get("/directory/:id/signins", async (c) => c.json({ events: await sourceSignins(c.get("ctx"), uuid(c.req.param("id"), "منبع")) }));

// ---------------------------------------------------------------- Jira and GitHub

integrationHubRoutes.post("/issues/link", async (c) => {
  const input = await body(c, z.object({ connection_id: UUID, table: z.string().min(1).max(63), record_id: UUID, remote_key: z.string().max(80).nullish() }));
  return c.json({ ref: await linkIssue(c.get("ctx"), input) });
});
integrationHubRoutes.get("/issues/refs", async (c) => {
  const table = c.req.query("table") ?? "";
  if (!tableDef(table)) throw bad("جدول معتبر نیست");
  return c.json({ refs: await refsOf(c.get("ctx"), table, uuid(c.req.query("id"), "رکورد")) });
});
integrationHubRoutes.post("/issues/refs/:id/refresh", async (c) => c.json({ ref: await refreshRef(c.get("ctx"), uuid(c.req.param("id"), "پیوند")) }));

// ---------------------------------------------------------------- scheduled exports and the call log

integrationHubRoutes.post("/exports/:id/run", async (c) => c.json(await runScheduleNow(c.get("ctx"), uuid(c.req.param("id"), "خروجی زمان‌بندی‌شده"))));

integrationHubRoutes.get("/log", async (c) => {
  const ctx = c.get("ctx");
  needIntegrations(ctx, "view");
  const params: unknown[] = [ctx.org.id];
  const where = ["org_id = $1"];
  const kind = c.req.query("kind");
  if (kind) where.push(`kind = $${params.push(kind)}`);
  const ref = c.req.query("ref");
  if (ref) where.push(`ref_id = $${params.push(uuid(ref, "مرجع"))}`);
  if (c.req.query("status") === "failed") where.push("not ok");
  const rows = await ctx.db.query(`select id, at, kind, ref_id, method, target, status, ok, latency_ms, summary, error from sm_int_log where ${where.join(" and ")} order by at desc, id desc limit 200`, params);
  return c.json({ rows });
});

// ================================================================ the public API (/api/v1)

const pub = router();

// the record API: the engine's own routes, as the key's integration user, within the key's scopes
pub.use("/r/*", apiAuth, apiScopes);
pub.use("/meta/*", apiAuth);
pub.use("/attachments/*", apiAuth, async (c, next) => {
  if (!scopeAllows(c.get("apiCaller").key.table_scopes, "*", "read")) throw forbidden("دریافت پیوست‌ها کلیدی با خواندن همهٔ جدول‌ها می‌خواهد");
  await next();
});
pub.all("/blobs/*", () => {
  throw forbidden("این مسیر فقط برای همگام‌سازی برنامهٔ ویندوز است");
});
pub.get("/meta/tables", async (c) => c.json(await metaForKey(c.get("ctx"), c.get("apiCaller").key.table_scopes)));
pub.get("/meta/tables/:key", async (c, next) => {
  if (!scopeAllows(c.get("apiCaller").key.table_scopes, c.req.param("key"), "read")) throw forbidden("این کلید اجازهٔ خواندن این جدول را ندارد");
  await next();
});
pub.get("/openapi.json", apiAuth, async (c) => c.json(await openApiFor(c.get("ctx"), c.get("apiCaller").key.table_scopes, apiBase(c))));
pub.route("/", recordRoutes);

// inbound endpoints
pub.post("/in/:id", rateLimit({ name: "inbound", limit: 600, windowMs: 60_000, key: (c) => c.req.param("id") ?? "" }), async (c) => {
  if (Number(c.req.header("content-length") ?? 0) > MAX_INBOUND_BYTES) throw bad("حجم پیام بیش از اندازه است");
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_INBOUND_BYTES) throw bad("حجم پیام بیش از اندازه است");
  return c.json(await receiveInbound(c.get("cfg"), c.req.param("id"), raw, (h) => c.req.header(h)));
});

// the issue trackers' webhooks
pub.post("/issues/:id/hook", rateLimit({ name: "issue-hooks", limit: 600, windowMs: 60_000, key: (c) => c.req.param("id") ?? "" }), async (c) => {
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_INBOUND_BYTES) throw bad("حجم پیام بیش از اندازه است");
  return c.json(await receiveIssueHook(c.get("cfg"), c.req.param("id"), raw, (h) => c.req.header(h), (q) => c.req.query(q)));
});

// SCIM 2.0
const scim = router();
scim.use("*", rateLimit({ name: "scim", limit: 1200, windowMs: 60_000, key: (c) => c.req.param("source") ?? "" }));
scim.onError((err, c) => {
  if (err instanceof ScimError) return c.json(scimError(err.status, err.message, err.scimType), err.status as 400, { "content-type": "application/scim+json" });
  const status = (err as { status?: number }).status ?? 500;
  return c.json(scimError(status, String((err as Error).message ?? err)), (status >= 400 && status < 600 ? status : 500) as 400, { "content-type": "application/scim+json" });
});
const session = (c: Context) => scimSession(c.get("cfg"), c.req.param("source") ?? "", c.req.header("authorization"), `${apiBase(c)}/scim/${c.req.param("source")}`);
const scimJson = (c: Context, data: unknown, status = 200) => c.json(data as object, status as 200, { "content-type": "application/scim+json" });
const scimBody = async (c: Context): Promise<Record<string, any>> => {
  try {
    const v = JSON.parse((await c.req.text()) || "{}");
    if (!v || typeof v !== "object") throw new Error();
    return v;
  } catch {
    throw new ScimError(400, "بدنهٔ درخواست JSON نیست", "invalidSyntax");
  }
};
const page = (c: Context) => ({ start: Math.max(1, Number(c.req.query("startIndex") ?? 1) || 1), count: Math.min(200, Math.max(1, Number(c.req.query("count") ?? 100) || 100)) });

scim.get("/:source/ServiceProviderConfig", async (c) => {
  await session(c);
  return scimJson(c, serviceProviderConfig(`${apiBase(c)}/scim/${c.req.param("source")}`));
});
scim.get("/:source/Users", async (c) => {
  const s = await session(c);
  const p = page(c);
  return scimJson(c, await listUsers(s, c.req.query("filter") ?? null, p.start, p.count));
});
scim.get("/:source/Users/:id", async (c) => scimJson(c, await getUser(await session(c), c.req.param("id"))));
scim.post("/:source/Users", async (c) => scimJson(c, await createUser(await session(c), await scimBody(c)), 201));
scim.patch("/:source/Users/:id", async (c) => {
  const s = await session(c);
  const b = await scimBody(c);
  return scimJson(c, await patchUserById(s, c.req.param("id"), Array.isArray(b.Operations) ? b.Operations : []));
});
scim.put("/:source/Users/:id", async (c) => {
  const s = await session(c);
  return scimJson(c, await patchUserById(s, c.req.param("id"), [], await scimBody(c)));
});
scim.delete("/:source/Users/:id", async (c) => {
  await deleteUser(await session(c), c.req.param("id"));
  return c.body(null, 204);
});
scim.get("/:source/Groups", async (c) => {
  const s = await session(c);
  return scimJson(c, await listGroups(s, c.req.query("filter") ?? null, page(c).start));
});
scim.get("/:source/Groups/:id", async (c) => scimJson(c, await getGroup(await session(c), c.req.param("id"))));
scim.post("/:source/Groups", async (c) => scimJson(c, await createGroup(await session(c), await scimBody(c)), 201));
scim.patch("/:source/Groups/:id", async (c) => {
  const s = await session(c);
  const b = await scimBody(c);
  await patchGroupById(s, c.req.param("id"), Array.isArray(b.Operations) ? b.Operations : []);
  return c.body(null, 204);
});
scim.delete("/:source/Groups/:id", async (c) => {
  await deleteGroup(await session(c), c.req.param("id"));
  return c.body(null, 204);
});
pub.route("/scim", scim);

publicApiRoutes.route("/", pub);

export { pub as integrationPublicRoutes };

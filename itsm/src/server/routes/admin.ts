// /api/admin — «مدیریت سامانه», only for platform admins (PLATFORM_ADMIN_EMAILS or the first account):
// overview, organisations (platform metadata, status, notes, AI switch, support sessions), accounts,
// security events, the admin audit log and system health. /admin/ai (stream B) is the AI policy.
// Nothing here returns an organisation's documents: those need a support session.
import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import { router, body, requireUser, type Env } from "../http/hono";
import { forbidden, notFound } from "../http/errors";
import { aiAdminRoutes } from "./ai-admin";
import { platformConsoleRoutes } from "./admin-platform";
import { adminAudit, listOrgs, listUsers, orgDetail, overview, userDetail } from "../modules/platform/console";
import { systemHealth } from "../modules/platform/health";
import { listSecurityEvents, requestMeta } from "../modules/platform/security";
import { ORG_STATUSES, updateOrgAdmin } from "../modules/platform/org-admin";
import { endSupport, listSupportSessions, startSupport, SUPPORT_MAX_HOURS } from "../modules/platform/support";
import { setPlatformAdmin, setUserDisabled, signOutEverywhere, temporaryPassword } from "../modules/platform/users";
import type { OrgStatus } from "../context";

const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get("user")?.is_platform_admin) throw forbidden("این بخش فقط برای مدیر سامانه است");
  await next();
};

export const adminRoutes = router();
adminRoutes.use("*", requireUser, requireAdmin);
adminRoutes.route("/ai", aiAdminRoutes);
// plans and limits, feature flags, announcements, jobs, backups, version, audit of every organisation (admin module)
adminRoutes.route("/", platformConsoleRoutes);

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const qs = (v: string | undefined) => (v ?? "").trim() || null;
const isoBefore = (v: string | undefined) => (v && !Number.isNaN(Date.parse(v)) ? v : null);

// ---------------------------------------------------------------- overview and health

adminRoutes.get("/overview", async (c) => c.json(await overview(c.get("cfg"))));
adminRoutes.get("/health", async (c) => c.json(await systemHealth(c.get("cfg"))));
// «سلامت سرور» of the server edition (src/server-edition/health.ts); absent elsewhere
adminRoutes.get("/server", async (c) => {
  const server = c.get("cfg").server;
  if (!server) throw notFound("این بخش فقط در نسخهٔ سرور است");
  return c.json(await server.health());
});

/** Kept for older clients: the overview's main figures in the earlier shape. */
adminRoutes.get("/stats", async (c) => {
  const o = await overview(c.get("cfg"));
  return c.json({
    stats: {
      users: o.kpis.users.total,
      disabled_users: o.kpis.users.disabled,
      orgs: o.kpis.orgs.total,
      active_sessions: o.kpis.users.active_7d,
      devices: o.kpis.devices.total,
      db_bytes: o.kpis.db.bytes,
    },
  });
});

// ---------------------------------------------------------------- organisations

adminRoutes.get("/orgs", async (c) => {
  const status = c.req.query("status");
  const orgs = await listOrgs(c.get("cfg").db, {
    q: qs(c.req.query("q")),
    status: ORG_STATUSES.includes(status as OrgStatus) ? (status as OrgStatus) : null,
    module: qs(c.req.query("module")),
    inactive: c.req.query("inactive") === "1" || c.req.query("inactive") === "true",
    support: c.req.query("support") === "1" || c.req.query("support") === "true",
  });
  return c.json({ orgs });
});

adminRoutes.get("/orgs/:id", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("سازمان پیدا نشد");
  const detail = await orgDetail(c.get("cfg"), id, c.get("user").id);
  if (!detail) throw notFound("سازمان پیدا نشد");
  return c.json(detail);
});

adminRoutes.patch("/orgs/:id", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("سازمان پیدا نشد");
  const input = await body(
    c,
    z.object({
      status: z.enum(["active", "read_only", "suspended"]).optional(),
      status_reason: z.string().trim().max(300).nullish(),
      notes: z.string().max(4000).nullish(),
      ai_disabled: z.boolean().optional(),
    }),
  );
  const admin = await updateOrgAdmin(c.get("cfg"), c.get("user"), id, input, requestMeta(c));
  return c.json({ admin });
});

adminRoutes.get("/orgs/:id/support", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("سازمان پیدا نشد");
  return c.json({ sessions: await listSupportSessions(c.get("cfg").db, { org_id: id, limit: 100 }) });
});

adminRoutes.post("/orgs/:id/support", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("سازمان پیدا نشد");
  const input = await body(
    c,
    z.object({
      level: z.enum(["view", "edit"]),
      reason: z.string().max(500),
      hours: z.number().int().min(1).max(SUPPORT_MAX_HOURS).optional(),
    }),
  );
  const session = await startSupport(c.get("cfg"), c.get("user"), id, input, requestMeta(c));
  return c.json({ session });
});

adminRoutes.get("/support", async (c) =>
  c.json({ sessions: await listSupportSessions(c.get("cfg").db, { active: c.req.query("active") === "1", limit: 200 }) }),
);

adminRoutes.post("/support/:id/end", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("جلسهٔ پشتیبانی پیدا نشد");
  return c.json({ session: await endSupport(c.get("cfg"), c.get("user"), id, {}, requestMeta(c)) });
});

// ---------------------------------------------------------------- accounts

adminRoutes.get("/users", async (c) => {
  const f = c.req.query("filter");
  const users = await listUsers(c.get("cfg"), {
    q: qs(c.req.query("q")),
    filter: f === "admins" || f === "disabled" || f === "never" || f === "inactive" ? f : null,
  });
  return c.json({ users });
});

adminRoutes.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) throw notFound("کاربر پیدا نشد");
  const detail = await userDetail(c.get("cfg"), id);
  if (!detail) throw notFound("کاربر پیدا نشد");
  return c.json(detail);
});

adminRoutes.patch("/users/:id", async (c) => {
  const input = await body(c, z.object({ disabled: z.boolean(), reason: z.string().trim().max(300).nullish() }));
  return c.json(await setUserDisabled(c.get("cfg"), c.get("user"), c.req.param("id"), input.disabled, input.reason || null, requestMeta(c)));
});

adminRoutes.post("/users/:id/sign-out", async (c) => c.json(await signOutEverywhere(c.get("cfg"), c.get("user"), c.req.param("id"), requestMeta(c))));

adminRoutes.post("/users/:id/password", async (c) => {
  const input = await body(c, z.object({ reason: z.string().max(300) }));
  return c.json(await temporaryPassword(c.get("cfg"), c.get("user"), c.req.param("id"), input.reason, requestMeta(c)));
});

adminRoutes.post("/users/:id/platform-admin", async (c) => {
  const input = await body(c, z.object({ granted: z.boolean() }));
  return c.json(await setPlatformAdmin(c.get("cfg"), c.get("user"), c.req.param("id"), input.granted, requestMeta(c)));
});

// ---------------------------------------------------------------- logs

adminRoutes.get("/security-events", async (c) => {
  const ok = c.req.query("ok");
  const events = await listSecurityEvents(c.get("cfg").db, {
    kind: qs(c.req.query("kind")),
    ok: ok === "true" ? true : ok === "false" ? false : null,
    q: qs(c.req.query("q")),
    user_id: isId(c.req.query("user") ?? "") ? c.req.query("user") : null,
    org_id: isId(c.req.query("org") ?? "") ? c.req.query("org") : null,
    before: isoBefore(c.req.query("before")),
    limit: 100,
  });
  return c.json({ events });
});

adminRoutes.get("/audit", async (c) => {
  const actor = c.req.query("actor");
  const rows = await adminAudit(c.get("cfg").db, {
    actor: actor === "platform" || actor === "support" ? actor : null,
    q: qs(c.req.query("q")),
    org_id: isId(c.req.query("org") ?? "") ? c.req.query("org") : null,
    before: isoBefore(c.req.query("before")),
    limit: 100,
  });
  return c.json({ rows });
});

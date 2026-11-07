// The HTTP API — the same Hono app runs on Vercel (cloud) and inside the Windows app (desktop).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./http/hono";
import { errorResponse, loadOrg, optionalUser, requireUser, sameOrigin } from "./http/hono";
import type { ServerConfig } from "./context";
import { authRoutes } from "./routes/auth";
import { orgRoutes, orgsRoutes } from "./routes/org";
import { dataRoutes } from "./routes/data";
import { accountingRoutes } from "./routes/accounting";
import { moduleRoutes } from "./routes/modules";
import { syncRoutes } from "./routes/sync";
import { hookRoutes, publicApiRoutes, integrationRoutes } from "./routes/integrations";
import { localRoutes } from "./routes/local";
import { adminRoutes } from "./routes/admin";
import { migrationStatus } from "./db/migrate";
import { APP_NAME, APP_VERSION, SYNC_PROTOCOL } from "@shared/constants";

// validation messages that a schema does not word itself come out in Persian
z.config(z.locales.fa());

export function createApp(cfg: ServerConfig) {
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    c.set("cfg", cfg);
    await next();
  });
  app.use("*", sameOrigin);
  app.onError((err, c) => errorResponse(err, c));
  app.notFound((c) => c.json({ error: { code: "not_found", message: "این مسیر وجود ندارد" } }, 404));

  app.get("/health", async (c) => {
    let db = "ok";
    try {
      await cfg.db.query("select 1");
    } catch (e) {
      db = String((e as Error).message ?? e);
    }
    return c.json({ ok: db === "ok", db, mode: cfg.mode, version: APP_VERSION });
  });

  app.get("/meta", optionalUser, async (c) => {
    const status = await migrationStatus(cfg.db).catch(() => null);
    const users = await cfg.db.one<{ n: number }>(`select count(*)::int as n from sm_users`).catch(() => null);
    const user = c.get("user");
    return c.json({
      app: APP_NAME,
      version: APP_VERSION,
      sync_protocol: SYNC_PROTOCOL,
      mode: cfg.mode,
      allow_signup: cfg.allowSignup || (users?.n ?? 0) === 0,
      first_run: (users?.n ?? 0) === 0,
      schema: status ? { pending: status.pending, current: status.current, latest: status.latest } : null,
      signed_in: !!user,
      desktop: cfg.mode === "desktop" && (user || (users?.n ?? 0) === 0) ? await cfg.desktop?.info().catch(() => null) : null,
    });
  });

  // keeps a free Supabase project awake (called daily by vercel.json cron)
  app.get("/cron/keepalive", async (c) => {
    const secret = process.env.CRON_SECRET;
    if (secret && c.req.header("authorization") !== `Bearer ${secret}`) return c.json({ ok: false }, 401);
    await cfg.db.query("select 1");
    return c.json({ ok: true });
  });

  app.route("/auth", authRoutes);
  app.route("/orgs", orgsRoutes);
  app.route("/admin", adminRoutes);

  const org = new Hono<Env>();
  org.use("*", requireUser, loadOrg);
  org.route("/", orgRoutes);
  org.route("/data", dataRoutes);
  org.route("/accounting", accountingRoutes);
  org.route("/", moduleRoutes);
  org.route("/integrations", integrationRoutes);
  app.route("/o/:org", org);

  app.route("/sync", syncRoutes);
  app.route("/hooks", hookRoutes);
  app.route("/v1", publicApiRoutes);
  if (cfg.mode === "desktop") app.route("/local", localRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
export { requireUser };

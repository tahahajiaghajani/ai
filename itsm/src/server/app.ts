// The HTTP API — the same Hono app runs on Vercel (cloud) and inside the Windows app (desktop).
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./http/hono";
import { errorResponse, loadOrg, optionalUser, rateLimit, requireUser, sameOrigin } from "./http/hono";
import type { ServerConfig } from "./context";
import { authRoutes } from "./routes/auth";
import { orgRoutes, orgsRoutes } from "./routes/org";
import { dataRoutes } from "./routes/data";
import { moduleRoutes } from "./routes/modules";
import { syncRoutes } from "./routes/sync";
import { hookRoutes, publicApiRoutes, integrationRoutes } from "./routes/integrations";
import { publicRoutes } from "./routes/public";
import { localRoutes } from "./routes/local";
import { adminRoutes } from "./routes/admin";
import { recordRoutes } from "./routes/records";
import { flowHookRoutes } from "./routes/flows";
import { jobCounter, lastTrafficTick, queueHasDue, stampTraffic, tick, trafficClock, trafficTickDue, TRAFFIC_TICK_BUDGET_MS } from "./jobs";
import "./engine";
import { migrationStatus, schemaProgress } from "./db/migrate";
import { APP_NAME, APP_VERSION, SYNC_PROTOCOL } from "@shared/constants";

// validation messages that a schema does not word itself come out in Persian
z.config(z.locales.fa());

/** The budget of the tick after a write request that queued jobs. */
const AFTER_WRITE_TICK_MS = 4000;
/** The longest the job probe waits after an answer (a busy pool, a slow database: no tick this time). */
const PROBE_WAIT_MS = 2000;

/** Is a job due or a worker's lock expired? False when the database does not say so within `PROBE_WAIT_MS`. */
async function dueWithin(cfg: ServerConfig): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), PROBE_WAIT_MS);
  });
  try {
    return await Promise.race([queueHasDue(cfg.db).catch(() => false), late]);
  } finally {
    clearTimeout(timer);
  }
}

export function createApp(cfg: ServerConfig) {
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    c.set("cfg", cfg);
    await next();
  });
  app.use("*", sameOrigin);
  // The job queue from the API's own traffic, where cfg.waitUntil runs work after the answer (the web version: Vercel
  // has no timer between requests; the server edition: it wakes the scheduler leader). Once the answer is ready:
  // - a write that queued jobs (record events, a new organisation's seeds…) asks for a tick of 4 s when a job is due;
  // - the web version's other requests, at most once a minute per instance, ask for one of 8 s when a job is due or a
  //   worker's lock expired (a new organisation's seeds come due 10 minutes after it was made, and without a heartbeat
  //   nothing else would run them).
  // The probe (`queueHasDue`, two partial-index lookups, about 1 ms) runs in that work, after the answer, and the tick
  // only when there is work: a probe that waits for a connection (a busy pool) holds no answer back and gives up after
  // `PROBE_WAIT_MS` without a tick. GET /api/cron/tick ticks itself (20 s, with the cleanup); request ticks never clean up.
  app.use("*", async (c, next) => {
    const before = jobCounter();
    await next();
    const waitUntil = cfg.waitUntil;
    if (!waitUntil || c.req.path.startsWith("/api/cron/")) return;
    const run = (budgetMs: number, probe: boolean) =>
      waitUntil(async () => {
        try {
          if (probe && !(await dueWithin(cfg))) return;
          await tick(cfg, { budgetMs, cleanup: false });
        } catch (e) {
          cfg.log.warn("job tick failed", String((e as Error)?.message ?? e));
        }
      });
    const m = c.req.method;
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && jobCounter() !== before) {
      // the server edition's waitUntil only wakes its scheduler leader, whose own tick claims what is due: no probe
      if (cfg.server) run(AFTER_WRITE_TICK_MS, false);
      else {
        stampTraffic();
        run(AFTER_WRITE_TICK_MS, true);
      }
      return;
    }
    if (cfg.mode !== "cloud" || cfg.server || !trafficTickDue(trafficClock(), lastTrafficTick())) return;
    stampTraffic();
    run(TRAFFIC_TICK_BUDGET_MS, true);
  });
  app.onError((err, c) => errorResponse(err, c));
  app.notFound((c) => c.json({ error: { code: "not_found", message: "این مسیر وجود ندارد" } }, 404));

  // database reachable, migration stage x/y, app version (docs/SETUP_FA.md §۹); the web version answers this itself
  // with 503 and the progress while its schema is being prepared (src/server/cloud.ts)
  app.get("/health", async (c) => {
    let db = "ok";
    try {
      await cfg.db.query("select 1");
    } catch (e) {
      db = String((e as Error).message ?? e);
    }
    const schema = db === "ok" ? await schemaProgress(cfg.db).catch(() => null) : null;
    const ok = db === "ok" && !!schema?.complete;
    return c.json(
      {
        ok,
        db,
        mode: cfg.mode,
        version: APP_VERSION,
        schema: schema ? { complete: schema.complete, done: schema.done, total: schema.total, percent: schema.total ? Math.floor((schema.done / schema.total) * 100) : 0, next: schema.next } : null,
        ...(cfg.database ? { pooler: cfg.database.pooler } : {}),
      },
      ok ? 200 : 503,
    );
  });

  app.get("/meta", optionalUser, async (c) => {
    const status = await migrationStatus(cfg.db).catch(() => null);
    // only a missing accounts table is a first run: a count that failed (busy, slow, gone) is the database's 503, never
    // «no account yet», which sent a signed-in person round / → /setup → /signup → / and showed anyone the sign-up form
    const users = await cfg.db.one<{ n: number }>(`select count(*)::int as n from sm_users`).catch((e) => {
      if ((e as { code?: string } | null)?.code === "42P01") return null;
      throw e;
    });
    const user = c.get("user");
    // a session proves an account exists
    const none = !user && (users?.n ?? 0) === 0;
    return c.json({
      app: APP_NAME,
      version: APP_VERSION,
      sync_protocol: SYNC_PROTOCOL,
      mode: cfg.mode,
      // the web version, the Windows app, or the server edition (Windows Server on an organisation's intranet)
      edition: cfg.server ? "server" : cfg.mode === "desktop" ? "desktop" : "web",
      server: cfg.server ? cfg.server.info() : null,
      allow_signup: cfg.allowSignup || none,
      first_run: none,
      schema: status ? { pending: status.pending, current: status.current, latest: status.latest } : null,
      signed_in: !!user,
      desktop: cfg.mode === "desktop" && (user || none) ? await cfg.desktop?.info().catch(() => null) : null,
    });
  });

  // keeps a free Supabase project awake (called daily by vercel.json cron)
  app.get("/cron/keepalive", async (c) => {
    const secret = process.env.CRON_SECRET;
    if (secret && c.req.header("authorization") !== `Bearer ${secret}`) return c.json({ ok: false }, 401);
    await cfg.db.query("select 1");
    return c.json({ ok: true });
  });

  // the job queue's heartbeat on the web version: Supabase pg_cron + pg_net, a GitHub Actions schedule or Vercel
  // cron call it (Bearer CRON_SECRET when it is set; without one, at most every 10 s per instance). The only web tick
  // that also deletes finished jobs past their retention (request ticks pass cleanup: false)
  app.on(["GET", "POST"], "/cron/tick", async (c) => {
    const secret = process.env.CRON_SECRET;
    if (secret && c.req.header("authorization") !== `Bearer ${secret}`) return c.json({ ok: false }, 401);
    if (!secret) rateLimit("cron-tick", 1, 10_000);
    const r = await tick(cfg, { budgetMs: 20_000 });
    return c.json({ ok: true, ...r });
  });

  app.route("/auth", authRoutes);
  app.route("/orgs", orgsRoutes);
  app.route("/admin", adminRoutes);

  const org = new Hono<Env>();
  org.use("*", requireUser, loadOrg);
  org.route("/", orgRoutes);
  org.route("/", recordRoutes);
  org.route("/data", dataRoutes);
  org.route("/", moduleRoutes);
  org.route("/integrations", integrationRoutes);
  app.route("/o/:org", org);

  app.route("/sync", syncRoutes);
  app.route("/hooks/flows", flowHookRoutes);
  app.route("/hooks", hookRoutes);
  app.route("/v1", publicApiRoutes);
  // the sign-in-free API of public pages (rate limited; what modules publish on purpose)
  app.route("/public", publicRoutes);
  if (cfg.mode === "desktop") app.route("/local", localRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
export { requireUser };

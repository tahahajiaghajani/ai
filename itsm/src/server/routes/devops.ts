// HTTP API of DevOps (docs/modules/devops_FA.md).
//
// Signed, sign-in-free endpoints on /api/public (rate limited per client by the public router and per connection
// here; nothing is answered without a valid signature of the connection's secret):
//   POST /api/public/devops/hooks/:key           a tool's delivery (GitHub, GitLab, Azure DevOps, Jenkins, generic)
//   POST /api/public/devops/gates/:key           the deployment gate: «may this pipeline deploy now?»
//   GET  /api/public/devops/gates/:key/:id       the gate's answer (signature over the gate id)
//
// Under /api/o/:org/devops (the caller's context; the records themselves through /r/<table>):
//   GET  /meta · POST /seed
//   POST /connections/:id/secret                 a new signing secret, shown once (release manager)
//   POST /connections/:id/rotate-key             a new webhook URL key (release manager)
//   POST /connections/:id/test                   a signed «ping» through the whole delivery path
//   POST /events/:id/retry                       process a failed or ignored event again (release manager)
//   GET  /dora?days&service · GET /pipeline?days&service
//   GET  /records/:table/:id/development         commits, pull requests, builds and deployments of a record
//   POST /gates/:id/decide                       approve, reject or approve with an exception (release manager)
//   GET  /gates/verify                           recompute the gates' evidence hash chain
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { forbidden, notFound } from "../http/errors";
import { rateLimit, type RateLimitOptions } from "../http/ratelimit";
import { publicRoutes } from "./public";
import { access } from "../access/provider";
import { defFor, get, readSecret, transition, update, updateIn } from "../engine";
import { managesReleases, sysOf, liveRow } from "../modules/release";
import {
  developmentOf, doraView, gateStatus, hmacHex, ingestDelivery, newSecret, pipelineView, processEvent, randomKey, requestGate, seedDevopsDefaults, verifyChain, DEMO_CONNECTION_NAME,
} from "../modules/devops";
import { normalize, type ConnectionKind } from "@shared/devops/logic";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const KEY = z.string().regex(/^[A-Za-z0-9_-]{10,80}$/, "کلید معتبر نیست");

/** A connection's deliveries: 600 a minute per webhook key (on top of the public router's per-client limit). */
const HOOK_LIMIT: RateLimitOptions = { name: "devops-hook", limit: 600, windowMs: 60_000, key: (c) => String(c.req.param("key") ?? "") };

const headersOf = (c: C) => (name: string) => c.req.header(name);

// ---------------------------------------------------------------- signed public endpoints

publicRoutes.post("/devops/hooks/:key", rateLimit(HOOK_LIMIT), async (c) => {
  const key = KEY.parse(c.req.param("key"));
  const raw = await c.req.text();
  const r = await ingestDelivery(c.get("cfg"), key, headersOf(c), raw);
  return c.json({ ok: r.status !== "failed", ...r });
});

const GATE_BODY = z.object({
  environment: z.string().trim().min(1).max(80),
  service: z.string().max(200).nullish(),
  version: z.string().max(80).nullish(),
  commit: z.string().max(64).nullish(),
  run: z.string().max(200).nullish(),
  change: z.string().max(40).nullish(),
  pipeline: z.string().max(200).nullish(),
  summary: z.string().max(300).nullish(),
});

publicRoutes.post("/devops/gates/:key", rateLimit(HOOK_LIMIT), async (c) => {
  const key = KEY.parse(c.req.param("key"));
  const raw = await c.req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const input = GATE_BODY.parse(parsed ?? {});
  const gate = await requestGate(c.get("cfg"), key, headersOf(c), raw, input);
  return c.json({ id: gate.id, number: gate.number, state: gate.state, allowed: ["approved", "overridden"].includes(String(gate.state)), reason: gate.reason ?? null, rule: gate.rule ?? null, timeout_at: gate.timeout_at ?? null }, gate.state === "pending" ? 202 : 200);
});

publicRoutes.get("/devops/gates/:key/:id", rateLimit(HOOK_LIMIT), async (c) => {
  const key = KEY.parse(c.req.param("key"));
  const id = UUID.parse(c.req.param("id"));
  return c.json(await gateStatus(c.get("cfg"), key, headersOf(c), id));
});

// ---------------------------------------------------------------- organisation routes

export const devopsRoutes = router();

async function needDevops(c: C) {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "devops_connection");
  if (!access().canReadTable(ctx, def)) throw forbidden("به دواپس دسترسی ندارید");
  return ctx;
}

async function needManager(c: C) {
  const ctx = await needDevops(c);
  if (!(await managesReleases(ctx.db, ctx))) throw forbidden("این کار با مدیر انتشار است");
  return ctx;
}

devopsRoutes.get("/meta", async (c) => {
  const ctx = await needDevops(c);
  const demo = await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_devops_connections where org_id = $1 and deleted_at is null`, [ctx.org.id]);
  return c.json({ seeded: Number(demo?.n ?? 0) > 0, manages: await managesReleases(ctx.db, ctx), hook_path: "/api/public/devops/hooks/", gate_path: "/api/public/devops/gates/", demo: DEMO_CONNECTION_NAME });
});

devopsRoutes.post("/seed", async (c) => {
  const ctx = await needManager(c);
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  return c.json(await seedDevopsDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

devopsRoutes.post("/connections/:id/secret", async (c) => {
  const ctx = await needManager(c);
  const id = UUID.parse(c.req.param("id"));
  const secret = newSecret();
  const r = await update(ctx, "devops_connection", id, { secret });
  return c.json({ secret, hook_url: `/api/public/devops/hooks/${r.row.hook_key}`, gate_url: `/api/public/devops/gates/${r.row.hook_key}`, rotated_at: r.row.secret_rotated_at ?? null });
});

devopsRoutes.post("/connections/:id/rotate-key", async (c) => {
  const ctx = await needManager(c);
  const id = UUID.parse(c.req.param("id"));
  await get(ctx, "devops_connection", id);
  const key = randomKey();
  await ctx.write((tx) => updateIn(tx, sysOf(ctx), "devops_connection", id, { hook_key: key }, { trusted: true }));
  return c.json({ hook_key: key, hook_url: `/api/public/devops/hooks/${key}` });
});

devopsRoutes.post("/connections/:id/test", async (c) => {
  const ctx = await needManager(c);
  const id = UUID.parse(c.req.param("id"));
  const { row } = await get(ctx, "devops_connection", id);
  const { def } = await defFor(ctx, "devops_connection");
  const secret = await readSecret(ctx.db, ctx, def, id, "secret");
  if (!secret) return c.json({ ok: false, message: "هنوز رازی برای این اتصال ساخته نشده است" });
  const raw = JSON.stringify({ type: "ping", delivery_id: `test-${Date.now()}` });
  const sig = `sha256=${hmacHex(secret, raw)}`;
  const r = await ingestDelivery(ctx.cfg, String(row.hook_key), (n) => (n === "x-signature-256" ? sig : undefined), raw);
  return c.json({ ok: r.status === "processed", ...r });
});

devopsRoutes.post("/events/:id/retry", async (c) => {
  const ctx = await needManager(c);
  const id = UUID.parse(c.req.param("id"));
  const sys = sysOf(ctx);
  const ev = await liveRow(ctx.db, sys, "dev_event", id);
  if (!ev) throw notFound("رویداد پیدا نشد");
  const conn = await liveRow(ctx.db, sys, "devops_connection", ev.connection_id);
  if (!conn) throw notFound("اتصال پیدا نشد");
  if (!ev.payload || (ev.payload as Record<string, unknown>).truncated) return c.json({ status: "failed", message: "بدنهٔ این رویداد نگه داشته نشده است" });
  const kind = String(conn.kind ?? "generic") as ConnectionKind;
  const header = (n: string) => (kind === "github" && n === "x-github-event") || (kind === "gitlab" && n === "x-gitlab-event") ? String(ev.provider_event ?? "") || undefined : undefined;
  return c.json(await processEvent(sys, conn, ev, normalize(kind, header, ev.payload)));
});

devopsRoutes.get("/dora", async (c) => {
  const ctx = await needDevops(c);
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(365).default(90), service: UUID.optional() }));
  return c.json(await doraView(ctx, q));
});

devopsRoutes.get("/pipeline", async (c) => {
  const ctx = await needDevops(c);
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(365).default(60), service: UUID.optional() }));
  return c.json(await pipelineView(ctx, q));
});

devopsRoutes.get("/records/:table/:id/development", async (c) => {
  await needDevops(c);
  const ctx = c.get("ctx");
  const table = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).parse(c.req.param("table"));
  return c.json(await developmentOf(ctx, table, UUID.parse(c.req.param("id"))));
});

devopsRoutes.post("/gates/:id/decide", async (c) => {
  const ctx = await needManager(c);
  const input = await body(c, z.object({ decision: z.enum(["approved", "rejected", "overridden"]), reason: z.string().max(2000).optional() }));
  const id = UUID.parse(c.req.param("id"));
  return c.json(await transition(ctx, "change_gate", id, input.decision, input.reason ? { reason: input.reason } : {}));
});

devopsRoutes.get("/gates/verify", async (c) => {
  const ctx = await needDevops(c);
  return c.json(await verifyChain(sysOf(ctx)));
});

// HTTP API of the predictive AI under /api/o/:org/ai/ml (docs/spec/AI.md §13.7; contracts in @shared/ai/ml). Every
// handler works with the caller's own context: a record's predictions only for its readers, a draft's from what the
// person typed, forecasts counted from what the caller may list, clusters with only their readable members. The model
// registry is for AI administrators (ai:full).
import { z } from "zod";
import { router, body, query, errorResponse } from "../http/hono";
import { bad, forbidden } from "../http/errors";
import type { ClusterView, ForecastView, MlModelView, MlPrediction, MlRecordView } from "@shared/ai/ml";
import { create, orgSchema, update } from "../engine";
import { enqueue } from "../jobs";
import { access } from "../access/provider";
import { readableIds } from "../access/service";
import {
  applyPrediction, clustersFor, decideCluster, dismissPrediction, draftPredictions, ensureMlTick, forecastFor, modelRow, modelViews, patchModel, recordPredictions,
} from "../modules/ai/ml";

export const mlRoutes = router();

mlRoutes.onError(errorResponse);

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");
const MODEL_KEY = z.string().regex(/^[a-z][a-z0-9_:.]{0,120}$/, "کلید مدل معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();

mlRoutes.get("/ml/records/:table/:id", async (c) => {
  const ctx = c.get("ctx");
  await ensureMlTick(ctx.db, ctx.org.id).catch(() => undefined);
  const out: MlRecordView = await recordPredictions(ctx, TABLE.parse(c.req.param("table")), id(c.req.param("id")));
  return c.json(out);
});

mlRoutes.post("/ml/predict", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ table: TABLE, values: z.record(z.string(), z.unknown()).default({}) }));
  const out: { predictions: MlPrediction[] } = { predictions: await draftPredictions(ctx, input) };
  return c.json(out);
});

mlRoutes.post("/ml/predictions/:id/apply", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ value: z.string().max(200).nullish(), version: z.number().int().optional() }));
  return c.json(await applyPrediction(ctx, id(c.req.param("id")), input));
});

mlRoutes.post("/ml/predictions/:id/dismiss", async (c) => {
  const ctx = c.get("ctx");
  return c.json(await dismissPrediction(ctx, id(c.req.param("id"))));
});

mlRoutes.get("/ml/forecast", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.can("ai", "view")) throw forbidden("به هوش مصنوعی دسترسی ندارید");
  const q = query(c, z.object({ table: TABLE, by: z.string().max(80).optional(), value: z.string().max(200).optional(), grain: z.enum(["day", "week"]).optional(), horizon: z.coerce.number().int().min(1).max(60).optional() }));
  const out: ForecastView = await forecastFor(ctx, q);
  return c.json(out);
});

mlRoutes.get("/ml/clusters", async (c) => {
  const ctx = c.get("ctx");
  if (!ctx.can("ai", "view")) throw forbidden("به هوش مصنوعی دسترسی ندارید");
  const q = query(c, z.object({ table: TABLE.default("incident") }));
  const out: { clusters: ClusterView[] } = { clusters: await clustersFor(ctx, q.table) };
  return c.json(out);
});

mlRoutes.post("/ml/clusters/:id/dismiss", async (c) => {
  const ctx = c.get("ctx");
  const cid = id(c.req.param("id"));
  const table = TABLE.parse((await body(c, z.object({ table: TABLE }))).table);
  // only someone who sees the cluster (enough readable members) decides it
  if (!(await clustersFor(ctx, table, { id: cid })).length) throw forbidden("این خوشه را نمی‌بینید");
  await decideCluster(ctx, cid, { status: "dismissed" });
  return c.json({ ok: true });
});

/**
 * «ثبت مسئله» from a cluster: a problem created with the caller's own access, and the cluster's members they may
 * change linked to it (each through the record service; a member they may not change stays unlinked).
 */
mlRoutes.post("/ml/clusters/:id/problem", async (c) => {
  const ctx = c.get("ctx");
  const cid = id(c.req.param("id"));
  const input = await body(c, z.object({ table: TABLE, title: z.string().trim().min(3).max(200) }));
  const [cluster] = await clustersFor(ctx, input.table, { id: cid });
  if (!cluster) throw forbidden("این خوشه را نمی‌بینید");
  const schema = await orgSchema(ctx);
  const pdef = schema.def("problem");
  if (!pdef || !access().canCreate(ctx, pdef)) throw forbidden("اجازهٔ ثبت مسئله ندارید");
  const list = cluster.members.map((m) => `- ${m.number ?? ""} ${m.title}`.trim()).join("\n");
  const problem = await create(ctx, "problem", { short_description: input.title, description: `نامزد مسئله از خوشهٔ ${cluster.size} رکورد مشابه (پیشنهاد هوش مصنوعی):\n\n${list}` });
  const pid = String(problem.row.id);
  let linked = 0;
  const readable = await readableIds(ctx, input.table, cluster.members.map((m) => m.id));
  for (const m of cluster.members) {
    if (!readable.has(m.id)) continue;
    try {
      await update(ctx, input.table, m.id, { problem_id: pid });
      linked++;
    } catch {
      // a member the caller may not change stays unlinked
    }
  }
  await decideCluster(ctx, cid, { status: "converted", problem_id: pid });
  return c.json({ problem_id: pid, number: problem.row.number ?? null, linked });
});

// ----- the registry (AI administrators) ----------------------------------------------------------------------------

mlRoutes.get("/ml/models", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  await ensureMlTick(ctx.db, ctx.org.id).catch(() => undefined);
  const out: { models: MlModelView[] } = { models: await modelViews(ctx) };
  return c.json(out);
});

mlRoutes.patch("/ml/models/:key", async (c) => {
  const ctx = c.get("ctx");
  const key = MODEL_KEY.parse(c.req.param("key"));
  const pct = z.number().min(0.05).max(0.999);
  const patch = await body(
    c,
    z.object({ enabled: z.boolean(), threshold_show: pct, threshold_apply: pct.nullable(), schedule: z.enum(["daily", "weekly", "monthly", "manual"]), seed: z.number().int().min(1).max(2_147_483_647) }).partial(),
  );
  await patchModel(ctx, key, patch);
  return c.json({ ok: true });
});

mlRoutes.post("/ml/models/:key/train", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const key = MODEL_KEY.parse(c.req.param("key"));
  if (!(await modelRow(ctx.db, ctx.org.id, key))) throw bad("مدل پیدا نشد");
  await ctx.write((tx) => enqueue(tx, { kind: "ai.ml.train", orgId: ctx.org.id, payload: { key, force: true }, dedupeKey: `ai.ml.train:${key}`, maxAttempts: 3 }), { internal: true });
  return c.json({ queued: true });
});

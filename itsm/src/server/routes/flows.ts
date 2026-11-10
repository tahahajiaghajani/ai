// Flows API (docs/spec/services/flows.md §10). Flows, versions, HTTP connections and schedules are engine tables —
// lists, forms and edits go through /r/<table>; these routes add what records cannot: publishing, test and manual
// runs, run history with step logs, cancelling, the built-in approval's decisions and webhook keys. Mounted at
// /api/o/:org/flows (routes/modules.ts); the inbound webhook at /api/hooks/flows/:id (app.ts).
import { z } from "zod";
import { body, limitByIp, query, rateLimit, router } from "../http/hono";
import { AppError, bad } from "../http/errors";
import { tick } from "../jobs";
import {
  cancelFlowRun, decideWait, flowCatalog, flowProblems, installFlows, listRuns, manualRun, newWebhookToken, publishFlow, runDetail, testRun, webhookRun,
} from "../modules/flows";
import { get } from "../engine";

installFlows();

export const flowRoutes = router();

const runInput = z.object({
  table: z.string().max(60).nullish(),
  record_id: z.string().max(40).nullish(),
  inputs: z.record(z.string(), z.unknown()).nullish(),
});

flowRoutes.get("/catalog", async (c) => c.json(flowCatalog()));

flowRoutes.post("/:id/validate", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ graph: z.unknown().optional() }));
  const r = await get(ctx, "flow", c.req.param("id"));
  return c.json({ problems: await flowProblems(ctx, r.row, input.graph) });
});

flowRoutes.post("/:id/publish", async (c) => {
  const input = await body(c, z.object({ note: z.string().max(300).nullish(), version: z.number().int().nullish() }));
  return c.json(await publishFlow(c.get("ctx"), c.req.param("id"), input));
});

flowRoutes.post("/:id/webhook-token", async (c) => c.json(await newWebhookToken(c.get("ctx"), c.req.param("id"))));

flowRoutes.post("/:id/run", async (c) => {
  const ctx = c.get("ctx");
  rateLimit(`flow-run:${ctx.user.id}`, 30, 60_000);
  const input = await body(c, runInput);
  const run = await manualRun(ctx, c.req.param("id"), { table: input.table ?? null, record_id: input.record_id ?? null, inputs: input.inputs ?? {} });
  return c.json(await runDetail(ctx, run));
});

flowRoutes.post("/:id/test", async (c) => {
  const ctx = c.get("ctx");
  rateLimit(`flow-test:${ctx.user.id}`, 30, 60_000);
  const input = await body(c, runInput.extend({ graph: z.unknown().optional() }));
  const run = await testRun(ctx, c.req.param("id"), { table: input.table ?? null, record_id: input.record_id ?? null, graph: input.graph, inputs: input.inputs ?? {} });
  return c.json(await runDetail(ctx, run));
});

flowRoutes.get("/runs", async (c) => {
  const q = query(
    c,
    z.object({
      flow: z.string().uuid().optional(),
      state: z.enum(["running", "waiting", "completed", "failed", "canceled"]).optional(),
      test: z.enum(["true", "false"]).optional(),
      page: z.coerce.number().int().min(1).optional(),
      size: z.coerce.number().int().min(1).max(200).optional(),
    }),
  );
  return c.json(await listRuns(c.get("ctx"), { flow: q.flow, state: q.state, test: q.test === undefined ? undefined : q.test === "true", page: q.page, size: q.size }));
});

flowRoutes.get("/runs/:runId", async (c) => c.json(await runDetail(c.get("ctx"), c.req.param("runId"))));

flowRoutes.post("/runs/:runId/cancel", async (c) => c.json(await cancelFlowRun(c.get("ctx"), c.req.param("runId"))));

flowRoutes.post("/waits/:waitId/decide", async (c) => {
  const input = await body(c, z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(2000).nullish() }));
  return c.json(await decideWait(c.get("ctx"), c.req.param("waitId"), input));
});

// ---------------------------------------------------------------- inbound webhooks (public)

/** Body limit of an inbound webhook. */
const MAX_HOOK = 256 * 1024;

export const flowHookRoutes = router();

flowHookRoutes.post("/:id", async (c) => {
  const cfg = c.get("cfg");
  limitByIp(c, "flow-hook", 120, 60_000);
  rateLimit(`flow-hook:${c.req.param("id")}`, 120, 60_000);
  if (Number(c.req.header("content-length") ?? 0) > MAX_HOOK) throw new AppError(413, "too_large", "حجم درخواست بیش از اندازهٔ مجاز است");
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_HOOK) throw new AppError(413, "too_large", "حجم درخواست بیش از اندازهٔ مجاز است");
  let payload: unknown = raw;
  const type = c.req.header("content-type") ?? "";
  if (type.includes("json") || /^\s*[[{]/.test(raw)) {
    try {
      payload = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      throw bad("بدنهٔ درخواست JSON معتبر نیست");
    }
  }
  const auth = c.req.header("authorization");
  const q = c.req.query();
  const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : c.req.header("x-flow-token") ?? q.token ?? null;
  const { token: _drop, ...rest } = q;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.req.header())) {
    const key = k.toLowerCase();
    if ((key.startsWith("x-") || key === "content-type" || key === "user-agent") && !/token|key|secret|signature|auth/.test(key) && Object.keys(headers).length < 30) {
      headers[key] = String(v).slice(0, 500);
    }
  }
  const r = await webhookRun(cfg, c.req.param("id"), token, { body: payload, query: rest, headers });
  cfg.waitUntil?.(() => tick(cfg, { budgetMs: 4000 }).catch((e) => cfg.log.warn("job tick failed", String((e as Error)?.message ?? e))));
  return c.json({ ok: true, run: r.run }, 202);
});

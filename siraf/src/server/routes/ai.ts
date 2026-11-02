// /api/o/:org/ai — the business's AI: connections and keys, settings, the assistant (SSE),
// conversations, proposals, usage, the Windows-app relay, and (mounted below) the AI features of
// stream D. Request/response shapes: src/shared/ai/api.ts.
// Permissions: ai:view to ask the assistant (read tools), ai:edit for drafts, ai:full to manage
// connections, keys, settings, budgets, usage and the activity log; conversations are private to
// their author.
import { z } from "zod";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { router, body, query, errorResponse, type C } from "../http/hono";
import { AppError, forbidden, notFound } from "../http/errors";
import type { AiErrorKind, AiStreamEvent } from "@shared/ai/types";
import type { AiRelayEvent } from "@shared/ai/api";
import { aiErrorText } from "@shared/ai/errors";
import { fromJalali, toJalali, todayISO } from "@shared/jalali";
import { aiFeatureRoutes } from "./ai-features";
import {
  appSecretMissing, availablePresets, connectionInputSchema, connectionTestSchema, createConnection, deleteConnection, listConnections,
  publicConnection, refreshModels, resumeConnection, setConnectionKey, testConnection, testUnsaved, updateConnection,
} from "../modules/ai/connections";
import { loadPolicy, saveSettings, settingsPatchSchema, visibleSettings, disabledByPlatform } from "../modules/ai/settings";
import { loadEnv, runTurn } from "../modules/ai/chain";
import { statusView } from "../modules/ai/engine";
import { AiUnavailableError, asHttpError } from "../modules/ai/errors";
import { AGENT_LIMITS, abortLocal, continueChat, startChat, type Emit } from "../modules/ai/agent";
import { deleteThread, getData, listThreads, messageViews, ownThread, patchThread, rateMessage, requestStop, threadDetail } from "../modules/ai/threads";
import { confirmAction, listActions, rejectAction } from "../modules/ai/actions";
import { budgetState, orgTimeZone, usageReport } from "../modules/ai/usage";
import { assertRelayAllowed, cloudLink, redactRelay, relayRequestSchema, relayToRun } from "../modules/ai/relay";
import { fakeEnabled } from "../modules/ai/adapters/fake";
import { pgArray } from "../db";
import { toolsFor } from "../modules/ai/tools";

export const aiRoutes = router();

// AI that cannot answer a plain JSON request (capture, connection tests …) → `ai_<kind>` with the kind in details
aiRoutes.onError((err, c) => errorResponse(asHttpError(err), c));

const HEARTBEAT_MS = 15_000;

/** Server-sent events with heartbeats and abort propagation; errors become an `error` event. */
function sse<E extends { type: string }>(c: C, run: (emit: (ev: E) => void, signal: AbortSignal) => Promise<void>, onError: (e: unknown) => E[]) {
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  const ac = new AbortController();
  const req = c.req.raw.signal;
  if (req.aborted) ac.abort();
  else req.addEventListener("abort", () => ac.abort(), { once: true });
  return streamSSE(c, async (stream: SSEStreamingApi) => {
    stream.onAbort(() => ac.abort());
    let queue: Promise<unknown> = Promise.resolve();
    const emit = (ev: E) => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }))).catch(() => undefined);
    };
    const beat = setInterval(() => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.write(": ping\n\n"))).catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
      await run(emit, ac.signal);
    } catch (e) {
      for (const ev of onError(e)) emit(ev);
    } finally {
      clearInterval(beat);
      await queue;
    }
  });
}

function errorEvent(c: C, e: unknown): { kind: AiErrorKind; message_fa: string } {
  if (e instanceof AiUnavailableError) return { kind: e.kind, message_fa: e.message };
  if (e instanceof AppError) return { kind: e.status === 403 ? "disabled" : e.status === 400 ? "invalid" : "other", message_fa: e.message };
  c.get("cfg").log.error("ai stream failed", String((e as Error)?.stack ?? e));
  return { kind: "other", message_fa: aiErrorText("other").message };
}

function chatErrors(c: C) {
  return (e: unknown): AiStreamEvent[] => [{ type: "error", ...errorEvent(c, e) }, { type: "done", message_id: "", stop: "error" }];
}

// ---------------------------------------------------------------- presets, status, settings

aiRoutes.get("/presets", async (c) => {
  const ctx = c.get("ctx");
  return c.json({ presets: await availablePresets(ctx), mode: ctx.cfg.mode, fake: fakeEnabled() });
});

aiRoutes.get("/status", async (c) => c.json(await statusView(c.get("ctx"))));

aiRoutes.get("/settings", async (c) => {
  const ctx = c.get("ctx");
  const canManage = ctx.can("ai", "full");
  const env = await loadEnv(ctx);
  return c.json({
    settings: visibleSettings(env.settings, canManage),
    can_manage: canManage,
    policy: {
      disabled: disabledByPlatform(env.policy, ctx.org.id),
      allowed_presets: env.policy.allowed_presets,
      allowed_protocols: env.policy.allowed_protocols,
      monthly_cap_usd: env.policy.default_monthly_cap_usd,
    },
    app_secret_missing: canManage && appSecretMissing(ctx.cfg),
    mode: ctx.cfg.mode,
    linked: !!cloudLink(ctx.cfg),
  });
});

aiRoutes.put("/settings", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const patch = await body(c, settingsPatchSchema);
  const settings = await saveSettings(ctx, patch);
  const policy = await loadPolicy(ctx.cfg);
  return c.json({
    settings,
    can_manage: true,
    policy: { disabled: disabledByPlatform(policy, ctx.org.id), allowed_presets: policy.allowed_presets, allowed_protocols: policy.allowed_protocols, monthly_cap_usd: policy.default_monthly_cap_usd },
    app_secret_missing: appSecretMissing(ctx.cfg),
    mode: ctx.cfg.mode,
    linked: !!cloudLink(ctx.cfg),
  });
});

// ---------------------------------------------------------------- connections (ai:full)

aiRoutes.get("/connections", async (c) => {
  const ctx = c.get("ctx");
  return c.json({ connections: await listConnections(ctx), app_secret_missing: appSecretMissing(ctx.cfg) });
});

aiRoutes.post("/connections", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  return c.json(await createConnection(ctx, await body(c, connectionInputSchema)));
});

aiRoutes.patch("/connections/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  return c.json(await updateConnection(ctx, c.req.param("id"), await body(c, connectionInputSchema.partial())));
});

aiRoutes.delete("/connections/:id", async (c) => {
  await deleteConnection(c.get("ctx"), c.req.param("id"));
  return c.json({ ok: true });
});

aiRoutes.put("/connections/:id/key", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const { key } = await body(c, z.object({ key: z.string().max(8000) }));
  return c.json({ connection: await setConnectionKey(ctx, c.req.param("id"), key) });
});

aiRoutes.post("/connections/:id/test", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const { models } = await body(c, z.object({ models: z.array(z.string().max(160)).max(4).optional() }));
  return c.json(await testConnection(ctx, c.req.param("id"), models));
});

aiRoutes.post("/test", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  return c.json(await testUnsaved(ctx, await body(c, connectionTestSchema)));
});

aiRoutes.post("/connections/:id/models", async (c) => c.json(await refreshModels(c.get("ctx"), c.req.param("id"))));

aiRoutes.post("/connections/:id/resume", async (c) => c.json({ connection: await resumeConnection(c.get("ctx"), c.req.param("id")) }));

aiRoutes.get("/connections/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  return c.json({ connection: await publicConnection(ctx, c.req.param("id")) });
});

// ---------------------------------------------------------------- the assistant (ai:view)

const attachment = z.object({ name: z.string().trim().min(1).max(200), mime: z.string().max(100), data: z.string().max(12_000_000) });
const pageContext = z
  .object({
    path: z.string().max(300).optional(),
    title: z.string().max(200).optional(),
    record: z.object({ type: z.string().max(40), id: z.string().max(80), label: z.string().max(200).optional() }).nullish(),
    report: z.object({ key: z.string().max(80), params: z.record(z.string(), z.unknown()).optional() }).nullish(),
  })
  .nullish();
const chatSchema = z.object({
  thread_id: z.string().uuid().nullish(),
  text: z.string().trim().max(20_000).default(""),
  attachments: z.array(attachment).max(4).optional(),
  context: pageContext,
}).refine((v) => v.text.length > 0 || !!v.attachments?.length, { message: "پرسش خالی است", path: ["text"] });

aiRoutes.post("/chat", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const req = await body(c, chatSchema);
  return sse<AiStreamEvent>(c, (emit: Emit, signal) => startChat(ctx, req, emit, signal), chatErrors(c));
});

aiRoutes.post("/threads/:id/continue", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const id = c.req.param("id");
  await ownThread(ctx, id);
  return sse<AiStreamEvent>(c, (emit: Emit, signal) => continueChat(ctx, id, emit, signal), chatErrors(c));
});

aiRoutes.post("/threads/:id/stop", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const id = c.req.param("id");
  const flagged = await requestStop(ctx, id);
  const here = abortLocal(id);
  return c.json({ ok: true, stopped: flagged || here });
});

aiRoutes.get("/threads", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const q = query(c, z.object({ q: z.string().max(200).optional(), archived: z.string().optional(), limit: z.coerce.number().int().min(1).max(300).optional() }));
  return c.json({ threads: await listThreads(ctx, { q: q.q, archived: q.archived === "1" || q.archived === "true", limit: q.limit }) });
});

aiRoutes.get("/threads/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  return c.json({ thread: threadDetail(await ownThread(ctx, c.req.param("id"))) });
});

aiRoutes.patch("/threads/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const patch = await body(c, z.object({ title: z.string().max(200).optional(), pinned: z.boolean().optional(), archived: z.boolean().optional() }));
  return c.json({ thread: await patchThread(ctx, c.req.param("id"), patch) });
});

aiRoutes.delete("/threads/:id", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  await deleteThread(ctx, c.req.param("id"));
  return c.json({ ok: true });
});

aiRoutes.get("/threads/:id/messages", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const thread = await ownThread(ctx, c.req.param("id"));
  const detail = threadDetail(thread);
  return c.json({ messages: await messageViews(ctx, thread), running: detail.running });
});

aiRoutes.post("/messages/:id/rating", async (c) => {
  c.get("ctx").need("ai", "view");
  const { rating } = await body(c, z.object({ rating: z.union([z.literal(1), z.literal(-1), z.null()]) }));
  await rateMessage(c.get("ctx"), c.req.param("id"), rating);
  return c.json({ ok: true });
});

aiRoutes.get("/data/:ref", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  return c.json(await getData(ctx, c.req.param("ref")));
});

// ---------------------------------------------------------------- proposals

aiRoutes.get("/actions", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const q = query(
    c,
    z.object({
      status: z.enum(["proposed", "executing", "executed", "rejected", "expired", "failed"]).optional(),
      mine: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  );
  return c.json({ actions: await listActions(ctx, { status: q.status, mine: q.mine === "1" || q.mine === "true", limit: q.limit }) });
});

aiRoutes.post("/actions/:id/confirm", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  return c.json({ proposal: await confirmAction(ctx, c.req.param("id")) });
});

aiRoutes.post("/actions/:id/reject", async (c) => {
  c.get("ctx").need("ai", "view");
  const { reason } = await body(c, z.object({ reason: z.string().max(300).optional() }));
  return c.json({ proposal: await rejectAction(c.get("ctx"), c.req.param("id"), reason) });
});

// ---------------------------------------------------------------- activity log and usage (ai:full)

aiRoutes.get("/tool-calls", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const q = query(c, z.object({ tool: z.string().max(60).optional(), user: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
  const params: unknown[] = [ctx.org.id];
  let where = "t.org_id = $1";
  if (q.tool) {
    params.push(q.tool);
    where += ` and t.tool = $${params.length}`;
  }
  if (q.user) {
    params.push(q.user);
    where += ` and t.user_id = $${params.length}`;
  }
  params.push(q.limit ?? 100);
  const rows = await ctx.db.query<{ id: string; thread_id: string | null; user_id: string | null; name: string | null; tool: string; ok: boolean; summary: string | null; ms: number | null; input: unknown; created_at: string }>(
    `select t.id, t.thread_id, t.user_id, u.full_name as name, t.tool, t.ok, t.summary, t.ms, t.input, t.created_at
     from tz_ai_tool_calls t left join tz_users u on u.id = t.user_id where ${where} order by t.created_at desc limit $${params.length}`,
    params,
  );
  // conversation ids are only linked for the caller's own conversations
  const own = new Set(
    rows.length
      ? (await ctx.db.query<{ id: string }>(`select id from tz_ai_threads where user_id = $1 and id = any($2::uuid[])`, [ctx.user.id, pgArray(rows.map((r) => r.thread_id).filter(Boolean) as string[])])).map((r) => r.id)
      : [],
  );
  const titles = new Map(toolsFor(ctx, { proposals: true }).map((t) => [t.name, t.title_fa]));
  return c.json({
    calls: rows.map((r) => ({
      id: r.id,
      thread_id: r.thread_id && own.has(r.thread_id) ? r.thread_id : null,
      user: { id: r.user_id, name: r.name },
      tool: r.tool,
      title_fa: titles.get(r.tool) ?? r.tool,
      ok: r.ok,
      summary: r.summary,
      ms: r.ms,
      input: r.input,
      created_at: r.created_at,
    })),
  });
});

aiRoutes.get("/usage", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const q = query(c, z.object({ from: z.string().regex(day).optional(), to: z.string().regex(day).optional() }));
  const today = todayISO(orgTimeZone(ctx));
  const j = toJalali(today);
  const env = await loadEnv(ctx);
  const budget = await budgetState(ctx, env.settings, env.policy);
  return c.json(await usageReport(ctx, q.from ?? fromJalali(j.jy, j.jm, 1), q.to ?? today, budget));
});

// ---------------------------------------------------------------- Windows app → web version relay

aiRoutes.post("/relay", async (c) => {
  const ctx = c.get("ctx");
  if (ctx.cfg.mode !== "cloud") throw notFound("این مسیر فقط در نسخهٔ وب است");
  if (c.get("session")?.kind !== "device") throw forbidden("فقط نسخهٔ ویندوز متصل به این کسب‌وکار می‌تواند از این مسیر استفاده کند");
  ctx.need("ai", "view");
  // the business's switches (assistant, each feature, document reading) and its data policy bind the Windows app too
  const relayed = await body(c, relayRequestSchema);
  const env = await loadEnv(ctx);
  const req = redactRelay(relayed, env.settings.data_policy);
  assertRelayAllowed(ctx, env.settings, req);
  return sse<AiRelayEvent>(
    c,
    async (emit, signal) => {
      // the turn must end before the function is killed (300 s), as the assistant's own steps do
      const deadline = AbortSignal.timeout(AGENT_LIMITS.hardMs);
      const run = relayToRun(req, AbortSignal.any([signal, deadline]));
      // tools never run here: the request carries their descriptions only, the Windows app runs them
      const result = await runTurn(ctx, { ...run, env, hooks: { onText: (d) => emit({ type: "text", delta: d }), onThinking: (d) => emit({ type: "thinking", delta: d }) } });
      if (result.result.stop === "aborted" && deadline.aborted && !signal.aborted) {
        // cut off by the time limit, not by the person: the Windows app keeps the text it already
        // received and shows a timeout (a plain "aborted" result would read as a stop)
        emit({ type: "error", kind: "timeout", message_fa: aiErrorText("timeout", { desktop: true }).message, retry_after_ms: null });
        return;
      }
      emit({ type: "result", result });
    },
    (e) => [{ type: "error", ...errorEvent(c, e), retry_after_ms: null }],
  );
});

aiRoutes.route("/", aiFeatureRoutes);

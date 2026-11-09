// /api/o/:org/ai/va — the virtual agent's conversation API (contracts: src/shared/ai/va.ts; docs/spec/AI.md §11.9). Any
// member of the organisation talks to it — a requester first of all; every step runs with the caller's own access, so
// no route needs more than membership. The topics are edited on the record pages of `va_topic` (AI administrators);
// GET /va/topics seeds the built-in ones. Mounted in ./modules.ts.
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { router, body, errorResponse, type C } from "../http/hono";
import { AppError } from "../http/errors";
import type { VaInput, VaStreamEvent } from "@shared/ai/va";
import { VA_CHANNELS } from "@shared/ai/va";
import { topicsOf, vaConversations, vaEnd, vaHandoff, vaMessages, vaSend, vaStart } from "../modules/ai/va";

export const vaRoutes = router();

vaRoutes.onError(errorResponse);

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (c: C) => UUID.parse(c.req.param("id")).toLowerCase();
const inputSchema = z.union([
  z.object({ text: z.string().trim().min(1, "پیام خالی است").max(4000) }),
  z.object({ action: z.enum(["confirm", "cancel"]) }),
  z.object({ action: z.literal("choose"), value: z.string().min(1).max(120) }),
]);

vaRoutes.get("/va/conversations", async (c) => c.json({ conversations: await vaConversations(c.get("ctx")) }));

vaRoutes.post("/va/conversations", async (c) => {
  const p = await body(c, z.object({ channel: z.enum(VA_CHANNELS).default("portal"), text: z.string().max(4000).nullish() }));
  return c.json({ reply: await vaStart(c.get("ctx"), { channel: p.channel, text: p.text ?? null }) });
});

vaRoutes.get("/va/conversations/:id/messages", async (c) => c.json({ messages: await vaMessages(c.get("ctx"), id(c)) }));

vaRoutes.post("/va/conversations/:id/messages", async (c) => {
  const p = (await body(c, inputSchema)) as VaInput;
  return c.json({ reply: await vaSend(c.get("ctx"), id(c), p) });
});

/** The same, streamed: the answer's text as it is written, then the whole reply (SSE). */
vaRoutes.post("/va/conversations/:id/messages/stream", async (c) => {
  const ctx = c.get("ctx");
  const conv = id(c);
  const p = (await body(c, inputSchema)) as VaInput;
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    let queue: Promise<unknown> = Promise.resolve();
    const emit = (ev: VaStreamEvent) => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }))).catch(() => undefined);
    };
    try {
      const reply = await vaSend(ctx, conv, p, (delta) => emit({ type: "text", delta }));
      emit({ type: "reply", reply });
    } catch (e) {
      if (!(e instanceof AppError)) c.get("cfg").log.error("virtual agent message failed", String((e as Error)?.stack ?? e));
      emit({ type: "error", message_fa: e instanceof AppError ? e.message : "پاسخ آماده نشد؛ دوباره بفرستید" });
    } finally {
      await queue;
    }
  });
});

vaRoutes.post("/va/conversations/:id/handoff", async (c) => {
  const p = await body(c, z.object({ note: z.string().max(1000).nullish() }));
  return c.json({ reply: await vaHandoff(c.get("ctx"), id(c), p.note ?? null) });
});

vaRoutes.post("/va/conversations/:id/end", async (c) => c.json({ reply: await vaEnd(c.get("ctx"), id(c)) }));

vaRoutes.get("/va/topics", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  return c.json({ topics: await topicsOf(ctx) });
});

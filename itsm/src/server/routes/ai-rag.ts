// /api/o/:org/ai — retrieval and cited answers, the index's admin endpoints and the smart documents library
// (contracts: src/shared/ai/rag.ts). Asking needs ai:view; managing the index ai:full; documents follow the engine's
// access (area knowledge, each collection's sharing). Mounted next to ./ai.ts in ./modules.ts.
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { router, body, errorResponse, type C } from "../http/hono";
import { AppError, bad } from "../http/errors";
import type { AiAskEvent } from "@shared/ai/rag";
import { aiErrorText } from "@shared/ai/errors";
import { DOC_COLLECTION, DOC_DOCUMENT } from "@shared/tables/docs";
import { AiUnavailableError, asHttpError } from "../modules/ai/errors";
import {
  askWithCitations, documentPages, publicPassages, queueBackfill, queueReconcile, ragStatus, reingestDocument, removeOwned, retrieve, uploadDocument,
} from "../modules/ai/rag";

export const ragRoutes = router();

ragRoutes.onError((err, c) => errorResponse(asHttpError(err), c));

const scopeSchema = z
  .object({
    tables: z.array(z.string().max(60)).max(50).optional(),
    collections: z.array(z.string().uuid()).max(100).optional(),
    documents: z.array(z.string().uuid()).max(500).optional(),
    records: z.array(z.object({ table: z.string().max(60), id: z.string().uuid() })).max(100).optional(),
  })
  .nullish();

const askSchema = z.object({
  question: z.string().trim().min(2, "پرسش را بنویسید").max(2000, "پرسش حداکثر ۲۰۰۰ نویسه است"),
  scope: scopeSchema,
  k: z.number().int().min(1).max(20).optional(),
});

ragRoutes.post("/ask", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const p = await body(c, askSchema);
  return c.json(await askWithCitations(ctx, p.question, p.scope ?? {}, { k: p.k, signal: c.req.raw.signal }));
});

const HEARTBEAT_MS = 15_000;

function streamError(c: C, e: unknown): Extract<AiAskEvent, { type: "error" }> {
  if (e instanceof AiUnavailableError) return { type: "error", kind: e.kind, message_fa: e.message };
  if (e instanceof AppError) return { type: "error", kind: e.status === 403 ? "disabled" : "invalid", message_fa: e.message };
  c.get("cfg").log.error("ai ask stream failed", String((e as Error)?.stack ?? e));
  return { type: "error", kind: "other", message_fa: aiErrorText("other").message };
}

ragRoutes.post("/ask/stream", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const p = await body(c, askSchema);
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  const ac = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => ac.abort(), { once: true });
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => ac.abort());
    let queue: Promise<unknown> = Promise.resolve();
    const emit = (ev: AiAskEvent) => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }))).catch(() => undefined);
    };
    const beat = setInterval(() => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.write(": ping\n\n"))).catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
      const result = await askWithCitations(ctx, p.question, p.scope ?? {}, {
        k: p.k,
        signal: ac.signal,
        onPassages: (passages, info) => emit({ type: "passages", passages, info }),
        onText: (delta) => emit({ type: "text", delta }),
      });
      emit({ type: "done", result });
    } catch (e) {
      emit(streamError(c, e));
    } finally {
      clearInterval(beat);
      await queue;
    }
  });
});

ragRoutes.post("/retrieve", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const p = await body(c, z.object({ query: z.string().trim().min(1).max(2000), scope: scopeSchema, k: z.number().int().min(1).max(30).optional(), rerank: z.boolean().optional() }));
  const r = await retrieve(ctx, p.query, { ...(p.scope ?? {}), k: p.k, rerank: p.rerank, signal: c.req.raw.signal });
  return c.json({ passages: publicPassages(r.passages), info: r.info });
});

ragRoutes.get("/rag/status", async (c) => c.json(await ragStatus(c.get("ctx"))));

ragRoutes.post("/rag/rebuild", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  const p = await body(c, z.object({ table: z.string().max(60).nullish(), force: z.boolean().optional() }));
  return c.json({ queued: await queueBackfill(ctx.db, ctx.org.id, { table: p.table ?? null, force: p.force ?? true }) });
});

ragRoutes.post("/rag/reconcile", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "full");
  return c.json({ queued: await queueReconcile(ctx.db, ctx.org.id) });
});

// ---------------------------------------------------------------- smart documents

const UPLOAD_LIMIT = 101 * 1024 * 1024;
const tooLarge = () => {
  throw new AppError(413, "too_large", "حجم پرونده بیش از حد مجاز است");
};

ragRoutes.post("/docs/upload", bodyLimit({ maxSize: UPLOAD_LIMIT, onError: tooLarge }), async (c) => {
  const form = await c.req.parseBody().catch(() => {
    throw bad("پرونده دریافت نشد (multipart/form-data با فیلدهای file و collection_id)");
  });
  const file = form.file;
  const collection = String(form.collection_id ?? "");
  if (!file || typeof file === "string") throw bad("پرونده دریافت نشد (multipart/form-data با فیلدهای file و collection_id)");
  if (!/^[0-9a-f-]{36}$/i.test(collection)) throw bad("مجموعهٔ اسناد را انتخاب کنید");
  const data = new Uint8Array(await file.arrayBuffer());
  const title = typeof form.title === "string" ? form.title : null;
  const document = await uploadDocument(c.get("ctx"), { collection_id: collection, title, file: { name: file.name, type: file.type, data } });
  return c.json({ document });
});

ragRoutes.get("/docs/:id/pages", async (c) => c.json(await documentPages(c.get("ctx"), c.req.param("id"), c.req.query("chunk") ?? null)));

ragRoutes.post("/docs/:id/reingest", async (c) => {
  await reingestDocument(c.get("ctx"), c.req.param("id"));
  return c.json({ ok: true });
});

ragRoutes.delete("/docs/collections/:id", async (c) => {
  await removeOwned(c.get("ctx"), DOC_COLLECTION, c.req.param("id"));
  return c.json({ ok: true });
});

ragRoutes.delete("/docs/:id", async (c) => {
  await removeOwned(c.get("ctx"), DOC_DOCUMENT, c.req.param("id"));
  return c.json({ ok: true });
});

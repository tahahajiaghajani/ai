// /api/o/:org/ai/skills — the AI skills framework (contracts: src/shared/ai/skills.ts; docs/spec/AI.md §11). Running a
// skill needs ai:view and whatever the skill and the record ask (the runtime checks them with the caller's own
// access); the admin endpoints need ai:full. Mounted next to ./ai.ts in ./modules.ts.
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { router, body, query, errorResponse, type C } from "../http/hono";
import { AppError, bad } from "../http/errors";
import { aiErrorText } from "@shared/ai/errors";
import type { SkillStreamEvent } from "@shared/ai/skills";
import { AiUnavailableError, asHttpError } from "../modules/ai/errors";
import {
  adminView, copySkill, listRuns, patchSkill, proposeFromRun, publishVersion, rateRun, resolveSkill, runCore, runOwner, runSkill, runEvals, saveEval, savePrincipal, saveVersion,
  skillsForRecord, skillsForText, testRun, usageRows,
} from "../modules/ai/skills";

export const skillRoutes = router();

skillRoutes.onError((err, c) => errorResponse(asHttpError(err), c));

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const KEY = z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/, "کلید مهارت معتبر نیست");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");

const runSchema = z.object({
  table: TABLE.nullish(),
  id: UUID.nullish(),
  text: z.string().max(20_000).nullish(),
  params: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])).optional(),
  propose: z.boolean().optional(),
});

const key = (c: C) => KEY.parse(c.req.param("key"));

// ---------------------------------------------------------------- the record panel, the composer and field assists

skillRoutes.get("/skills/for/:table/:id", async (c) => {
  const ctx = c.get("ctx");
  return c.json(await skillsForRecord(ctx, TABLE.parse(c.req.param("table")), UUID.parse(c.req.param("id")).toLowerCase()));
});

skillRoutes.get("/skills/text", async (c) => c.json({ skills: await skillsForText(c.get("ctx")) }));

skillRoutes.post("/skills/:key/run", async (c) => {
  const ctx = c.get("ctx");
  const p = await body(c, runSchema);
  return c.json(await runSkill(ctx, key(c), { table: p.table ?? null, id: p.id?.toLowerCase() ?? null, text: p.text ?? null, params: p.params ?? {} }, { propose: p.propose !== false, signal: c.req.raw.signal }));
});

const HEARTBEAT_MS = 15_000;

function streamError(c: C, e: unknown): Extract<SkillStreamEvent, { type: "error" }> {
  if (e instanceof AiUnavailableError) return { type: "error", kind: e.kind, message_fa: e.message, needs_settings: e.kind === "not_configured" || e.kind === "disabled" || e.kind === "budget" };
  if (e instanceof AppError) return { type: "error", kind: e.code, message_fa: e.message };
  c.get("cfg").log.error("ai skill stream failed", String((e as Error)?.stack ?? e));
  return { type: "error", kind: "other", message_fa: aiErrorText("other").message };
}

skillRoutes.post("/skills/:key/run/stream", async (c) => {
  const ctx = c.get("ctx");
  const k = key(c);
  const p = await body(c, runSchema);
  const rs = await resolveSkill(ctx, k);
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  const ac = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => ac.abort(), { once: true });
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => ac.abort());
    let queue: Promise<unknown> = Promise.resolve();
    const emit = (ev: SkillStreamEvent) => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) }))).catch(() => undefined);
    };
    const beat = setInterval(() => {
      queue = queue.then(() => (stream.aborted ? undefined : stream.write(": ping\n\n"))).catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
      emit({ type: "meta", skill: rs.cfg.key, name: rs.cfg.name });
      const { result } = await runCore(ctx, rs, { table: p.table ?? null, id: p.id?.toLowerCase() ?? null, text: p.text ?? null, params: p.params ?? {} }, { propose: p.propose !== false, signal: ac.signal, onText: (delta) => emit({ type: "text", delta }) });
      emit({ type: "done", result });
    } catch (e) {
      emit(streamError(c, e));
    } finally {
      clearInterval(beat);
      await queue;
    }
  });
});

// ---------------------------------------------------------------- runs (private to their authors)

skillRoutes.get("/skills/runs", async (c) => {
  const q = query(c, z.object({ table: TABLE.optional(), id: UUID.optional(), all: z.enum(["1", "0"]).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }));
  return c.json({ runs: await listRuns(c.get("ctx"), { table: q.table ?? null, id: q.id?.toLowerCase() ?? null, all: q.all === "1", limit: q.limit }) });
});

skillRoutes.post("/skills/runs/:id/feedback", async (c) => {
  const p = await body(c, z.object({ rating: z.union([z.literal(1), z.literal(-1), z.null()]), comment: z.string().max(1000).nullish() }));
  return c.json(await rateRun(c.get("ctx"), UUID.parse(c.req.param("id")).toLowerCase(), p.rating, p.comment ?? null));
});

// a run's writes as a proposal on its record, later (its author only; built again from the stored run, never the client)
skillRoutes.post("/skills/runs/:id/proposal", async (c) => {
  const ctx = c.get("ctx");
  const run = await runOwner(ctx, UUID.parse(c.req.param("id")).toLowerCase());
  if (!run.table_key || !run.record_id) throw bad("این اجرا به رکوردی وابسته نیست");
  // run the skill again as the caller: the proposal reflects what they may read and change now
  const rs = await resolveSkill(ctx, String(run.skill_key));
  const { result, input } = await runCore(ctx, rs, { table: String(run.table_key), id: String(run.record_id), params: (run.params as Record<string, unknown>) ?? {} }, { propose: false });
  return c.json({ proposal: await proposeFromRun(ctx, rs, input, result, { principal: "person" }) });
});

// ---------------------------------------------------------------- administration (ai:full)

skillRoutes.get("/skills/admin", async (c) => c.json(await adminView(c.get("ctx"))));

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(2000),
    enabled: z.boolean(),
    tables: z.array(TABLE.or(z.literal("*"))).max(40),
    tier: z.enum(["fast", "standard", "reasoning"]),
    grounding: z.enum(["none", "similar", "knowledge", "documents"]),
    grounding_k: z.number().int().min(1).max(12),
    collections: z.array(UUID).max(50),
    triggers: z.array(z.enum(["manual", "event", "schedule"])).max(3),
    events: z.array(z.enum(["created", "updated", "assigned", "state_changed", "commented"])).max(5),
    condition: z.record(z.string(), z.unknown()).nullable(),
    schedule_minutes: z.number().int().min(15).max(10_080).nullable(),
    schedule_filter: z.record(z.string(), z.unknown()).nullable(),
    roles: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/)).max(40),
    field_groups: z.array(z.enum(["internal", "financial", "personal", "security", "hr", "admin"])).max(6),
    auto_apply: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(20),
    daily_limit: z.number().int().min(1).max(1_000_000).nullable(),
    user_daily_limit: z.number().int().min(1).max(100_000).nullable(),
  })
  .partial();

skillRoutes.patch("/skills/admin/:key", async (c) => c.json({ skill: await patchSkill(c.get("ctx"), key(c), await body(c, patchSchema)) }));

skillRoutes.post("/skills/admin/:key/versions", async (c) => {
  const p = await body(
    c,
    z.object({
      system: z.string().min(1).max(20_000),
      template: z.string().min(1).max(20_000),
      output_schema: z.record(z.string(), z.unknown()).nullish(),
      temperature: z.number().min(0).max(2).nullish(),
      max_tokens: z.number().int().min(64).max(32_000).nullish(),
      note: z.string().trim().min(2, "یادداشت تغییر را بنویسید").max(300),
    }),
  );
  return c.json({ version: await saveVersion(c.get("ctx"), key(c), { ...p, output_schema: p.output_schema ?? null, temperature: p.temperature ?? null, max_tokens: p.max_tokens ?? null }) });
});

skillRoutes.post("/skills/admin/:key/publish", async (c) => {
  const p = await body(c, z.object({ version_id: UUID.nullable() }));
  return c.json({ skill: await publishVersion(c.get("ctx"), key(c), p.version_id?.toLowerCase() ?? null) });
});

skillRoutes.post("/skills/admin/:key/copy", async (c) => {
  const p = await body(c, z.object({ key: KEY, name: z.string().trim().min(2).max(120) }));
  return c.json({ skill: await copySkill(c.get("ctx"), key(c), p) });
});

skillRoutes.post("/skills/admin/:key/test", async (c) => {
  const p = await body(c, runSchema.extend({ version_id: UUID.nullish() }));
  return c.json(await testRun(c.get("ctx"), key(c), { table: p.table ?? null, id: p.id?.toLowerCase() ?? null, text: p.text ?? null, params: p.params ?? {}, version_id: p.version_id?.toLowerCase() ?? null }));
});

const caseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  table: TABLE.nullish(),
  id: UUID.nullish(),
  text: z.string().max(20_000).nullish(),
  params: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])).optional(),
  expect: z.object({
    contains: z.array(z.string().max(200)).max(20).optional(),
    not_contains: z.array(z.string().max(200)).max(20).optional(),
    min_chars: z.number().int().min(0).max(100_000).optional(),
    max_chars: z.number().int().min(0).max(100_000).optional(),
    json_keys: z.array(z.string().max(60)).max(20).optional(),
    language: z.enum(["fa", "en"]).optional(),
    cites: z.boolean().optional(),
  }),
});

skillRoutes.post("/skills/admin/:key/evals", async (c) => {
  const p = await body(c, z.object({ id: UUID.nullish(), name: z.string().trim().min(2).max(120), cases: z.array(caseSchema).min(1).max(30) }));
  return c.json({ eval: await saveEval(c.get("ctx"), key(c), { id: p.id?.toLowerCase() ?? null, name: p.name, cases: p.cases }) });
});

skillRoutes.post("/skills/admin/:key/evals/run", async (c) => {
  const p = await body(c, z.object({ eval_id: UUID.nullish() }));
  return c.json({ evals: await runEvals(c.get("ctx"), key(c), p.eval_id?.toLowerCase() ?? null) });
});

skillRoutes.get("/skills/admin/usage", async (c) => {
  const q = query(c, z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));
  return c.json({ rows: await usageRows(c.get("ctx"), q.from, q.to) });
});

skillRoutes.post("/skills/admin/principal", async (c) => {
  const p = await body(c, z.object({ roles: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/)).max(20), active: z.boolean().optional() }));
  return c.json({ principal: await savePrincipal(c.get("ctx"), p) });
});

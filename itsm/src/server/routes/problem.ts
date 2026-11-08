// HTTP API of problem management under /api/o/:org/problem (docs/modules/problem_FA.md «API»). Problems, problem tasks,
// known errors, candidates, corrective actions and the settings row are served by the generic engine API
// (/r/problem…); these routes are the operations it cannot express. Every handler works with the caller's context.
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { defFor, get, systemCtx } from "../engine";
import { problemAi } from "../modules/incident";
import {
  copyFindings, createFromIncidents, createKnownError, linkIncidents, mergeCandidate, mergeProblems, problemDashboard, problemSweep, promoteCandidate, shareSolution,
} from "../modules/problem";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const ids = z.array(UUID).min(1).max(200);

const fromInput = z.object({
  short_description: z.string().max(200).nullish(),
  description: z.string().max(20_000).nullish(),
  assignment_group_id: UUID.nullish(),
  assigned_to: UUID.nullish(),
});

/** A record as the caller may see it (fields they may not read stripped), never the raw stored row. */
const shaped = async (ctx: Parameters<typeof get>[0], table: string, rid: string) => {
  const r = await get(ctx, table, rid);
  return { row: r.row, display: r.display };
};

export const problemRoutes = router();

problemRoutes.get("/dashboard", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(730).optional() }));
  return c.json(await problemDashboard(c.get("ctx"), q.days ?? 90));
});

problemRoutes.post("/from-incidents", async (c) => {
  const input = await body(c, fromInput.extend({ incident_ids: ids }));
  const { incident_ids, ...rest } = input;
  const ctx = c.get("ctx");
  const r = await createFromIncidents(ctx, incident_ids, rest);
  return c.json({ problem: (await shaped(ctx, "problem", r.problem.id)).row, done: r.done, failed: r.failed });
});

// run the candidate rules now: whoever may create candidates (problem managers and above)
problemRoutes.post("/candidates/run", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "problem_candidate");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجرای قاعده‌های نامزد با کارشناسان مشکل است");
  const r = await problemSweep(await systemCtx(ctx.cfg, ctx.org.id));
  return c.json(r.candidates);
});

problemRoutes.post("/candidates/:id/promote", async (c) => {
  const input = await body(c, fromInput);
  const ctx = c.get("ctx");
  const r = await promoteCandidate(ctx, id(c.req.param("id")), input);
  return c.json({ problem: (await shaped(ctx, "problem", r.problem.id)).row, done: r.done, failed: r.failed });
});

problemRoutes.post("/candidates/:id/merge", async (c) => {
  const input = await body(c, z.object({ problem_id: UUID }));
  return c.json(await mergeCandidate(c.get("ctx"), id(c.req.param("id")), input.problem_id));
});

problemRoutes.post("/tasks/:id/copy-findings", async (c) => {
  const ctx = c.get("ctx");
  const row = await copyFindings(ctx, id(c.req.param("id")));
  return c.json(await shaped(ctx, "problem", row.id));
});

problemRoutes.post("/:id/link-incidents", async (c) => {
  const input = await body(c, z.object({ incident_ids: ids, unlink: z.boolean().optional() }));
  return c.json(await linkIncidents(c.get("ctx"), id(c.req.param("id")), input.incident_ids, { unlink: input.unlink }));
});

problemRoutes.post("/:id/merge", async (c) => {
  const input = await body(c, z.object({ ids: z.array(UUID).min(1).max(20) }));
  return c.json(await mergeProblems(c.get("ctx"), id(c.req.param("id")), input.ids));
});

problemRoutes.post("/:id/share", async (c) => {
  const input = await body(c, z.object({ kind: z.enum(["workaround", "fix"]), audience: z.enum(["agents", "callers"]).optional() }));
  return c.json(await shareSolution(c.get("ctx"), id(c.req.param("id")), input));
});

problemRoutes.post("/:id/known-error", async (c) => {
  const ctx = c.get("ctx");
  const row = await createKnownError(ctx, id(c.req.param("id")));
  return c.json(await shaped(ctx, "known_error", row.id));
});

// AI skills (only when the AI layer registered them): suggestions, never writes
const SKILLS = ["draftRca", "summarize"] as const;
problemRoutes.post("/:id/ai/:skill", async (c) => {
  const skill = z.enum(SKILLS).parse(c.req.param("skill"));
  const ctx = c.get("ctx");
  const rid = id(c.req.param("id"));
  await get(ctx, "problem", rid); // 404 unless the caller may read it
  const ai = problemAi();
  if (skill === "draftRca" && ai.draftRca) return c.json(await ai.draftRca(ctx, rid));
  if (skill === "summarize" && ai.summarize) return c.json(await ai.summarize(ctx, rid));
  throw notFound("این توانایی هوش مصنوعی هنوز فعال نیست");
});

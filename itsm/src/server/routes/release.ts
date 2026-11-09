// HTTP API of release and deployment management under /api/o/:org/release (docs/modules/release_FA.md). The records
// themselves — releases, tasks, templates, policies, checks and their results, decisions, environments, bookings,
// windows, deployments, notes, defects, flags, artifacts, settings — are served by the generic engine API
// (/r/<table>); these routes are the operations it cannot express. Each one reads and writes through the engine with
// the caller's context (access, field locks, guards), so a route never shows or changes what /r would not.
//
//   GET  /meta                                   settings the screens need, whether the caller manages releases
//   POST /seed                                   add the module's defaults (create access to the release settings)
//   GET  /roadmap?from&to&service&type           releases and the bands of windows and freezes (the roadmap)
//   GET  /board                                  the readiness board (releases in build, test and readiness)
//   GET  /dashboard?days                         reporting of a period
//   GET  /records/:id/overview                   scope, deployments, checks, decisions, traceability
//   POST /records/:id/checks/run                 evaluate the release's readiness checks now
//   POST /records/:id/checks/:result/verdict     a person's verdict on a manual check (pass / fail / na)
//   POST /records/:id/checks/:result/waive       waive a check with a reason (the release manager's authority)
//   POST /records/:id/decide                     the go / go with conditions / no-go decision
//   POST /records/:id/scope                      add changes, problems, known errors, incidents or work items
//   POST /records/:id/change                     a normal change for the release (its plans copied, linked «شامل»)
//   POST /records/:id/notes/draft                a release note for an audience (AI or rule-based; saved on demand)
//   POST /records/:id/briefing                   readiness briefing with blockers (AI or rule-based)
//   GET  /records/:id/risk                       the stored risk with its explanation
//   POST /records/:id/recalc                     recompute risk and checks
//   POST /deployments/:id/narrative              the deployment risk narrative (AI or rule-based)
import { z } from "zod";
import { router, body, query, type C } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { addLink, defFor, get, update } from "../engine";
import {
  briefingFacts, changeForRelease, decideRelease, deploymentNarrative, draftNotes, evaluateChecksIn, managesReleases, readinessBoard, recalcRelease, releaseConfig, releaseDashboard, releaseOverview,
  releaseRiskExplanation, roadmap, saveDraftNote, seedReleaseDefaults, sysOf, RELEASE_SEED_VERSION, noAi,
} from "../modules/release";
import { runSkill } from "../modules/ai/skills/runtime";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const INSTANT = z.string().min(10).max(40).refine((s) => Number.isFinite(Date.parse(s)), "زمان معتبر نیست");

/** Tables a release's scope may name, and the link kind each one takes. */
const SCOPE_KINDS: Record<string, string> = { change_request: "release_includes", problem: "fixes", known_error: "fixes", incident: "release_includes", project_task: "release_includes", defect: "release_includes", dev_pull_request: "release_includes" };

export const releaseRoutes = router();

/** The caller must read releases at all (a 403 rather than empty answers). */
async function needReleases(c: C) {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "release");
  if (!access().canReadTable(ctx, def)) throw forbidden("به انتشارها دسترسی ندارید");
  return ctx;
}

/** The caller works this release (writes it). */
async function needWork(c: C, id: string) {
  const ctx = await needReleases(c);
  const { row } = await get(ctx, "release", id);
  const { def } = await defFor(ctx, "release");
  if (!access().canWrite(ctx, def, row) || row.$writable === false) throw forbidden("اجازهٔ کار روی این انتشار را ندارید");
  return { ctx, row };
}

releaseRoutes.get("/meta", async (c) => {
  const ctx = await needReleases(c);
  const cfg = await releaseConfig(ctx.db, sysOf(ctx));
  return c.json({
    seeded: cfg.seeded >= RELEASE_SEED_VERSION,
    manages: await managesReleases(ctx.db, ctx),
    config: { els_days: cfg.els_days, failure_window_hours: cfg.failure_window_hours, auto_advance: cfg.auto_advance, release_on_production: cfg.release_on_production, dora_days: Number((cfg as Record<string, unknown>).dora_days ?? 90) },
  });
});

releaseRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  const { def } = await defFor(ctx, "release_config");
  if (!access().canCreate(ctx, def, null) || !(await managesReleases(ctx.db, ctx))) throw forbidden("افزودن پیش‌فرض‌های انتشار با مدیر انتشار یا مدیر سامانه است");
  return c.json(await seedReleaseDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

releaseRoutes.get("/roadmap", async (c) => {
  const ctx = await needReleases(c);
  const q = query(c, z.object({ from: INSTANT, to: INSTANT, service: UUID.optional(), type: z.string().max(40).optional() }));
  if (Date.parse(q.to) - Date.parse(q.from) > 400 * 86_400_000) throw forbidden("بازهٔ نقشهٔ راه حداکثر ۴۰۰ روز است");
  return c.json(await roadmap(ctx, q));
});

releaseRoutes.get("/board", async (c) => {
  const ctx = await needReleases(c);
  return c.json(await readinessBoard(ctx));
});

releaseRoutes.get("/dashboard", async (c) => {
  const ctx = await needReleases(c);
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(730).default(90) }));
  return c.json(await releaseDashboard(ctx, q.days));
});

releaseRoutes.get("/records/:id/overview", async (c) => {
  const ctx = await needReleases(c);
  return c.json(await releaseOverview(ctx, UUID.parse(c.req.param("id"))));
});

releaseRoutes.post("/records/:id/checks/run", async (c) => {
  const { ctx, row } = await needWork(c, UUID.parse(c.req.param("id")));
  const out = await ctx.write((tx) => evaluateChecksIn(tx, sysOf(ctx), String(row.id)));
  // answer with what the caller reads of the results
  const fresh = await releaseOverview(ctx, String(row.id));
  return c.json({ readiness: out.readiness, checks: fresh.checks });
});

releaseRoutes.post("/records/:id/checks/:result/verdict", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const { ctx } = await needWork(c, id);
  const input = await body(c, z.object({ status: z.enum(["pass", "fail", "na", "pending"]), evidence: z.string().max(4000).optional(), message: z.string().max(1000).optional() }));
  const resultId = UUID.parse(c.req.param("result"));
  const { row } = await get(ctx, "release_check_result", resultId);
  if (row.release_id !== id) throw forbidden("این بررسی از این انتشار نیست");
  const saved = await update(ctx, "release_check_result", resultId, { status: input.status, ...(input.evidence !== undefined ? { evidence: input.evidence } : {}), ...(input.message !== undefined ? { message: input.message } : {}) });
  return c.json(saved);
});

releaseRoutes.post("/records/:id/checks/:result/waive", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const ctx = await needReleases(c);
  const input = await body(c, z.object({ reason: z.string().trim().min(3, "دلیل چشم‌پوشی را بنویسید").max(2000) }));
  if (!(await managesReleases(ctx.db, ctx))) throw forbidden("چشم‌پوشی از بررسی آمادگی با مدیر انتشار است");
  const resultId = UUID.parse(c.req.param("result"));
  const { row } = await get(ctx, "release_check_result", resultId);
  if (row.release_id !== id) throw forbidden("این بررسی از این انتشار نیست");
  return c.json(await update(ctx, "release_check_result", resultId, { status: "waived", waiver_reason: input.reason }));
});

releaseRoutes.post("/records/:id/decide", async (c) => {
  await needReleases(c);
  const ctx = c.get("ctx");
  const input = await body(c, z.object({
    decision: z.enum(["go", "go_with_conditions", "no_go"]),
    rationale: z.string().trim().min(3, "دلیل تصمیم را بنویسید").max(4000),
    conditions: z.string().max(4000).nullish(),
    return_to: z.enum(["test", "build"]).optional(),
  }));
  const decision = await decideRelease(ctx, UUID.parse(c.req.param("id")), input);
  return c.json({ decision, release: (await get(ctx, "release", String(decision.release_id))).row });
});

releaseRoutes.post("/records/:id/scope", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const { ctx } = await needWork(c, id);
  const input = await body(c, z.object({ table: z.enum(Object.keys(SCOPE_KINDS) as [string, ...string[]]), ids: z.array(UUID).min(1).max(100) }));
  const kind = SCOPE_KINDS[input.table];
  const added: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const other of input.ids) {
    try {
      await addLink(ctx, "release", id, { kind, table: input.table, id: other });
      added.push(other);
    } catch (e) {
      skipped.push({ id: other, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json({ added, skipped });
});

releaseRoutes.post("/records/:id/change", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const { ctx } = await needWork(c, id);
  return c.json(await changeForRelease(ctx, id));
});

releaseRoutes.post("/records/:id/notes/draft", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const ctx = await needReleases(c);
  const input = await body(c, z.object({ audience: z.enum(["end_users", "operations", "management"]).default("end_users"), language: z.enum(["fa", "en"]).default("fa"), save: z.boolean().optional() }));
  const draft = await draftNotes(ctx, id, input.audience);
  if (!input.save) return c.json(draft);
  await needWork(c, id);
  const note = await saveDraftNote(ctx, id, { ...draft, audience: input.audience, language: input.language });
  return c.json({ ...draft, note });
});

releaseRoutes.post("/records/:id/briefing", async (c) => {
  const id = UUID.parse(c.req.param("id"));
  const ctx = await needReleases(c);
  const rule = await briefingFacts(ctx, id);
  try {
    const r = await runSkill(ctx, "release.briefing", { table: "release", id }, { noFallback: true });
    if ((r.text ?? "").trim()) return c.json({ text: r.text, ai: true, model: r.model });
  } catch (e) {
    if (!noAi(e)) throw e;
  }
  return c.json({ text: rule.text, ai: false, model: null });
});

releaseRoutes.get("/records/:id/risk", async (c) => {
  const ctx = await needReleases(c);
  const { row } = await get(ctx, "release", UUID.parse(c.req.param("id")));
  return c.json({ score: row.risk_score ?? null, band: row.risk_band ?? null, factors: row.risk_factors ?? [], explanation: releaseRiskExplanation(row) });
});

releaseRoutes.post("/records/:id/recalc", async (c) => {
  const { ctx, row } = await needWork(c, UUID.parse(c.req.param("id")));
  await recalcRelease(sysOf(ctx), String(row.id), { checks: true });
  return c.json((await get(ctx, "release", String(row.id))).row);
});

releaseRoutes.post("/deployments/:id/narrative", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "deployment");
  if (!access().canReadTable(ctx, def)) throw forbidden("به استقرارها دسترسی ندارید");
  return c.json(await deploymentNarrative(ctx, UUID.parse(c.req.param("id"))));
});

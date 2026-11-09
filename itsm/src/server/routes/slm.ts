// HTTP API of service level management under /api/o/:org/slm (docs/modules/slm_FA.md). Agreements (the portfolio's
// `service_agreement`), targets, compliance, credits, reviews, the improvement register, XLA policies and scores and
// templates are served by the generic engine API (/r/<table>); these routes are the operations it cannot express, each
// with the caller's context (the engine's access checks first, then the module's own rules).
//
//   GET  /meta · POST /seed · GET /overview · GET /at-risk?scope&min&limit
//   GET  /agreements/:id/360                     live compliance, trend, breaches, experience, tree, reviews, credits
//   POST /agreements/:id/measure                 measure the current period now
//   GET  /agreements/:id/document?customer       the Persian agreement document (customer view: customer-facing targets)
//   POST /agreements/:id/document/draft          the document's wording by AI (the generated document without AI)
//   POST /agreements/:id/accept                  the customer's acceptance
//   POST /agreements/:id/link-commitments        targets from the offerings' commitments
//   POST /agreements/from-template               a new agreement with a template's document and targets
//   POST /targets/:id/manual                     a period value of a «ثبت دستی» target
//   GET  /targets/:id/recommend?p                recommended hours per priority and the what-if replay
//   POST /targets/:id/simulate                   the what-if replay of proposed hours
//   GET  /reviews/:id/pack · POST /reviews/:id/pack      the review pack (build or rebuild)
//   POST /reviews/:id/narrative · POST /reviews/:id/suggest · POST /reviews/:id/actions
//   GET  /records/:table/:id/xla · POST /records/:table/:id/xla
import { z } from "zod";
import type { XlaView } from "@shared/slm/api";
import { csiSuggestions, packNarrative, xlaExplanation, type XlaResult } from "@shared/slm/logic";
import { router, body, query, type C } from "../http/hono";
import { forbidden, conflict } from "../http/errors";
import { access } from "../access/provider";
import { createIn, defFor, get, transitionIn, updateIn } from "../engine";
import {
  acceptAgreement, agreement360, atRisk, buildPack, documentOf, fromTemplate, linkCommitments, managesSlm, measureNow, packOf, readsSlm, recommend, runSkillOrRules,
  scoreRecordIn, seedSlmDefaults, setManualValue, slmConfig, slmOverview, SLM_SEED_VERSION,
} from "../modules/slm";
import { liveRow, liveRows, sysOf } from "../modules/slm/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست").transform((s) => s.toLowerCase());
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");
const HOURS = z.record(z.enum(["1", "2", "3", "4", "5"]), z.number().min(0).max(100_000).nullable());

export const slmRoutes = router();

async function needSla(c: C) {
  const ctx = c.get("ctx");
  if (!(await readsSlm(ctx))) throw forbidden("به مدیریت سطح خدمت دسترسی ندارید");
  return ctx;
}

slmRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const cfg = await slmConfig(ctx.db, sysOf(ctx));
  return c.json({
    seeded: cfg.seeded >= SLM_SEED_VERSION,
    manages: await managesSlm(ctx.db, ctx),
    reads: await readsSlm(ctx),
    config: { compliance_target: cfg.compliance_target, at_risk_target: cfg.at_risk_target, review_months: cfg.review_months, k_min: cfg.k_min, watermelon_gap: cfg.watermelon_gap, require_experience_target: !!cfg.require_experience_target },
  });
});

slmRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  if (!(await managesSlm(ctx.db, ctx))) throw forbidden("افزودن پیش‌فرض‌های سطح خدمت با مدیر سطح خدمت یا مدیر سامانه است");
  return c.json(await seedSlmDefaults(ctx.cfg, ctx.org.id, { force: input.force }));
});

slmRoutes.get("/overview", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "service_agreement");
  if (!access().canReadTable(ctx, def)) throw forbidden("به توافق‌ها دسترسی ندارید");
  return c.json(await slmOverview(ctx));
});

slmRoutes.get("/at-risk", async (c) => {
  const ctx = await needSla(c);
  const q = query(c, z.object({ scope: z.enum(["mine", "groups"]).optional(), min: z.coerce.number().min(0).max(100).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }));
  return c.json({ items: await atRisk(ctx, q) });
});

// ----- agreements ------------------------------------------------------------------------------------------------------

slmRoutes.get("/agreements/:id/360", async (c) => {
  const ctx = c.get("ctx");
  return c.json(await agreement360(ctx, UUID.parse(c.req.param("id"))));
});

slmRoutes.post("/agreements/:id/measure", async (c) => {
  const ctx = await needSla(c);
  return c.json(await measureNow(ctx, UUID.parse(c.req.param("id"))));
});

slmRoutes.get("/agreements/:id/document", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ customer: z.enum(["0", "1"]).optional() }));
  return c.json(await documentOf(ctx, UUID.parse(c.req.param("id")), { customer: q.customer === "1" }));
});

slmRoutes.post("/agreements/:id/document/draft", async (c) => {
  const ctx = c.get("ctx");
  const id = UUID.parse(c.req.param("id"));
  const r = await runSkillOrRules(ctx, "slm.agreement_document", { table: "service_agreement", id }, (x) => (x.text ? x.text : null), async () => (await documentOf(ctx, id)).markdown);
  return c.json({ markdown: r.value, ai: r.ai });
});

slmRoutes.post("/agreements/:id/accept", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ note: z.string().trim().max(1000).nullish() }));
  const row = await acceptAgreement(ctx, UUID.parse(c.req.param("id")), input.note ?? null);
  return c.json({ accepted_at: row.accepted_at, accepted_by: row.accepted_by });
});

slmRoutes.post("/agreements/:id/link-commitments", async (c) => {
  const ctx = await needSla(c);
  return c.json(await linkCommitments(ctx, UUID.parse(c.req.param("id"))));
});

slmRoutes.post("/agreements/from-template", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({
    template_id: UUID, name: z.string().trim().min(2).max(160), service_id: UUID, customer_unit_id: UUID,
    valid_from: DATE.nullish(), valid_to: DATE.nullish(), manager_id: UUID.nullish(), provider_group_id: UUID.nullish(), supplier_name: z.string().trim().max(160).nullish(),
    offerings: z.array(UUID).max(50).optional(),
  }));
  const row = await fromTemplate(ctx, input);
  return c.json({ id: row.id, number: row.number ?? null });
});

// ----- targets ---------------------------------------------------------------------------------------------------------

slmRoutes.post("/targets/:id/manual", async (c) => {
  const ctx = await needSla(c);
  const input = await body(c, z.object({ value: z.number().min(0).max(100) }));
  await setManualValue(ctx, UUID.parse(c.req.param("id")), input.value);
  return c.json({ ok: true });
});

slmRoutes.get("/targets/:id/recommend", async (c) => {
  const ctx = await needSla(c);
  const q = query(c, z.object({ p: z.coerce.number().min(50).max(99).optional() }));
  return c.json(await recommend(ctx, UUID.parse(c.req.param("id")), { percentile: q.p }));
});

slmRoutes.post("/targets/:id/simulate", async (c) => {
  const ctx = await needSla(c);
  const input = await body(c, z.object({ hours: HOURS, p: z.number().min(50).max(99).optional() }));
  return c.json(await recommend(ctx, UUID.parse(c.req.param("id")), { percentile: input.p, proposed: input.hours }));
});

// ----- reviews ---------------------------------------------------------------------------------------------------------

async function readableReview(c: C) {
  const ctx = await needSla(c);
  const id = UUID.parse(c.req.param("id"));
  const r = await get(ctx, "slm_review", id);
  const review: Record<string, any> = { ...(r.row as Record<string, any>), pack: (await liveRow(ctx.db, sysOf(ctx), "slm_review", id))?.pack ?? null };
  return { ctx, id, review, meta: r.meta };
}

slmRoutes.get("/reviews/:id/pack", async (c) => {
  const { ctx, review } = await readableReview(c);
  return c.json({ pack: await packOf(ctx.db, ctx, review), stored: !!review.pack });
});

slmRoutes.post("/reviews/:id/pack", async (c) => {
  const { ctx, id, review, meta } = await readableReview(c);
  if (!meta.canWrite) throw forbidden("ساختن بستهٔ بازبینی با کسانی است که بازبینی را تغییر می‌دهند");
  if (review.state === "scheduled") {
    await ctx.write((tx) => transitionIn(tx, ctx, "slm_review", id, "prepared"));
  } else if (["prepared", "held", "actions_open"].includes(String(review.state))) {
    const sys = sysOf(ctx);
    const pack = await buildPack(ctx.db, ctx, review);
    await sys.write((tx) => updateIn(tx, sys, "slm_review", id, { pack, pack_at: pack.generated_at }, { trusted: true }));
  } else throw conflict("بستهٔ بازبینی بسته یا لغوشده دوباره ساخته نمی‌شود");
  const fresh = await liveRow(ctx.db, sysOf(ctx), "slm_review", id);
  return c.json({ pack: fresh?.pack ?? null });
});

slmRoutes.post("/reviews/:id/narrative", async (c) => {
  const { ctx, id, review, meta } = await readableReview(c);
  const input = await body(c, z.object({ save: z.boolean().optional() }));
  if (input.save && !meta.canWrite) throw forbidden("ذخیرهٔ روایت با کسانی است که بازبینی را تغییر می‌دهند");
  const pack = await packOf(ctx.db, ctx, review);
  const r = await runSkillOrRules(ctx, "slm.review_narrative", { table: "slm_review", id }, (x) => (x.text ? x.text : null), () => packNarrative(pack));
  if (input.save) {
    const sys = sysOf(ctx);
    await sys.write((tx) => updateIn(tx, sysOf(ctx, ctx.user.id), "slm_review", id, { narrative: r.value, narrative_ai: r.ai }, { trusted: true }));
  }
  return c.json({ text: r.value, ai: r.ai });
});

slmRoutes.post("/reviews/:id/suggest", async (c) => {
  const { ctx, id, review } = await readableReview(c);
  const pack = await packOf(ctx.db, ctx, review);
  const r = await runSkillOrRules(
    ctx, "slm.csi_suggest", { table: "slm_review", id },
    (x) => (x.json && Array.isArray((x.json as { items?: unknown }).items) ? ((x.json as { items: { title: string; description: string; value: number; effort: number }[] }).items) : null),
    () => csiSuggestions(pack).map(({ title, description, value, effort }) => ({ title, description, value, effort })),
  );
  return c.json({ items: r.value, ai: r.ai });
});

slmRoutes.post("/reviews/:id/actions", async (c) => {
  const { ctx, id, review } = await readableReview(c);
  const input = await body(c, z.object({
    items: z.array(z.object({ title: z.string().trim().min(2).max(200), description: z.string().max(2000).nullish(), value: z.number().int().min(1).max(5).optional(), effort: z.number().int().min(1).max(5).optional(), ai: z.boolean().optional() })).min(1).max(10),
  }));
  const { def } = await defFor(ctx, "slm_improvement");
  if (!access().canCreate(ctx, def, null)) throw forbidden("ثبت اقدام بهبود به دسترسی ایجاد در «توافق سطح خدمت» نیاز دارد");
  const created = await ctx.write(async (tx) => {
    const out: string[] = [];
    for (const it of input.items) {
      const row = await createIn(tx, ctx, "slm_improvement", {
        short_description: it.title, description: it.description ?? null, value: it.value ?? 3, effort: it.effort ?? 3,
        review_id: id, agreement_id: review.agreement_id ?? null, source: it.ai ? "ai" : "review",
      });
      out.push(String(row.id));
    }
    return out;
  });
  return c.json({ created });
});

// ----- experience scores of records ------------------------------------------------------------------------------------

async function xlaView(ctx: Parameters<typeof scoreRecordIn>[1], table: string, id: string): Promise<XlaView | null> {
  const sys = sysOf(ctx);
  const [row] = await liveRows(ctx.db, sys, "slm_xla_score", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }] }, { limit: 1 });
  if (!row) return null;
  const r: XlaResult = { score: Number(row.score ?? 0), band: row.band, reliability: Number(row.reliability ?? 0), quality: Number(row.quality ?? 0), effort: Number(row.effort ?? 0), survey: !!row.survey, drivers: Array.isArray(row.drivers) ? row.drivers : [] };
  const policy = row.policy_id ? await liveRow(ctx.db, sys, "slm_xla_policy", row.policy_id) : null;
  return { ...r, explanation: xlaExplanation(r), computed_at: row.computed_at ?? null, policy: policy?.name ?? null };
}

slmRoutes.get("/records/:table/:id/xla", async (c) => {
  const ctx = await needSla(c);
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  await get(ctx, table, id); // the record must be readable (404 otherwise)
  return c.json({ xla: await xlaView(ctx, table, id) });
});

slmRoutes.post("/records/:table/:id/xla", async (c) => {
  const ctx = await needSla(c);
  const table = TABLE.parse(c.req.param("table"));
  const id = UUID.parse(c.req.param("id"));
  await get(ctx, table, id);
  const sys = sysOf(ctx);
  await sys.write((tx) => scoreRecordIn(tx, sys, table, id));
  return c.json({ xla: await xlaView(ctx, table, id) });
});

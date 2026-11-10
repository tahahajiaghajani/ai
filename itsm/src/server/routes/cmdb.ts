// HTTP API of configuration management under /api/o/:org/cmdb (docs/modules/cmdb_FA.md «API»). Records themselves
// (CIs, classes, relationships, rules, findings, baselines…) are served by the generic engine API (/r/ci…); these routes
// are what the generic API cannot express: the dependency map, impact analysis and what-if, the reconciliation
// engine and imports, health, merge, baselines, suggestions, queries, the CI picker and the Windows app's collector.
// Every handler works with the caller's context; the services cut every answer to what the caller may read.
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { bad, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { addJournalIn, createIn, defFor, get, list, orgSchema, savepoint, updateIn } from "../engine";
import { enqueue } from "../jobs";
import { tableDef } from "@shared/tables";
import type { CiPickerHit, CmdbMeta } from "@shared/cmdb/api";
import {
  acceptSuggestion, applyRelRules, ciSummaryFacts, classTree, cmdbAiCapabilities, cmdbConfig, compareBaseline, computeHealth, createOrUpdate, dependencyMap,
  driftFromBaseline, finishRun, healthSummary, identifyOnly, impactAnalysis, impactText, mapRow, mergeCis, mergePreview, pathBetween, provenance,
  rejectSuggestion, relTypes, runLocalCollector, collectLocalInventory, runQuery, runUrlSource, seedCmdbDefaults, startRun, suggestFromIncidents,
  takeSnapshot, undoMerge,
} from "../modules/cmdb";
import { isCmdbAdmin, liveRow, liveRows, sysOf } from "../modules/cmdb/common";
import type { Cond } from "@shared/model/conditions";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const KEY = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "کلید معتبر نیست");
const cond = z.any().nullish() as z.ZodType<Cond | null | undefined>;

const needAdmin = async (ctx: Parameters<typeof isCmdbAdmin>[0]) => {
  if (!(await isCmdbAdmin(ctx))) throw forbidden("این کار با مدیر پیکربندی است");
};

const item = z.object({
  class: z.string().max(63).nullish(),
  values: z.record(z.string(), z.unknown()).default({}),
  attrs: z.record(z.string(), z.unknown()).nullish(),
  relations: z.array(z.object({
    type: z.string().max(63),
    direction: z.enum(["out", "in"]).optional(),
    item: z.number().int().min(0).optional(),
    ci_id: UUID.optional(),
    match: z.object({ class: z.string().max(63).nullish(), values: z.record(z.string(), z.unknown()) }).optional(),
  })).max(50).optional(),
});

export const cmdbRoutes = router();

cmdbRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const { def } = await defFor(ctx, "ci");
  if (!access().canReadTable(ctx, def)) throw forbidden("به پایگاه پیکربندی دسترسی ندارید");
  const cfg = await cmdbConfig(ctx.db, ctx);
  const meta: CmdbMeta = {
    desktop: ctx.cfg.mode === "desktop",
    can_admin: await isCmdbAdmin(ctx),
    can_write: access().canCreate(ctx, def, null),
    ai: cmdbAiCapabilities(),
    config: { impact_depth: cfg.impact_depth, map_max_nodes: cfg.map_max_nodes, controlled_mode: cfg.controlled_mode },
  };
  return c.json(meta);
});

// the class tree with what each class inherits, and the relationship types (pickers, forms, the class manager)
cmdbRoutes.get("/classes", async (c) => {
  const ctx = c.get("ctx");
  const tree = await classTree(ctx.db, ctx);
  const types = await relTypes(ctx.db, ctx);
  const classes = [...tree.byKey.values()].map((cl) => {
    const r = tree.resolve(cl.key)!;
    return { ...cl, ancestry: r.ancestry, all_attrs: r.allAttrs, all_required: r.allRequired, all_recommended: r.allRecommended, all_rel_rules: r.allRelRules, all_controlled: r.allControlled, stale_days_effective: r.staleDays };
  });
  return c.json({ classes, types: [...types.values()] });
});

const mapQuery = z.object({
  roots: z.array(UUID).min(1).max(20),
  depth: z.number().int().min(1).max(6).optional(),
  direction: z.enum(["both", "dependents", "dependencies"]).optional(),
  types: z.array(z.string().max(63)).max(50).optional(),
  classes: z.array(z.string().max(63)).max(100).optional(),
  as_of: z.string().max(40).nullish(),
  overlays: z.boolean().optional(),
  include_hidden: z.boolean().optional(),
  max_nodes: z.number().int().min(10).max(2000).optional(),
});
cmdbRoutes.post("/map", async (c) => c.json(await dependencyMap(c.get("ctx"), await body(c, mapQuery))));

cmdbRoutes.get("/path", async (c) => {
  const q = query(c, z.object({ from: UUID, to: UUID }));
  return c.json(await pathBetween(c.get("ctx"), q.from.toLowerCase(), q.to.toLowerCase()));
});

const impactQuery = z.object({
  ci_ids: z.array(UUID).min(1).max(50),
  state: z.enum(["down", "degraded", "maintenance"]).optional(),
  depth: z.number().int().min(1).max(20).optional(),
  as_of: z.string().max(40).nullish(),
});
cmdbRoutes.post("/impact", async (c) => c.json(await impactAnalysis(c.get("ctx"), await body(c, impactQuery))));

// a what-if simulation kept with its result (on a change or a business impact analysis)
cmdbRoutes.post("/impact/save", async (c) => {
  const input = await body(c, impactQuery.extend({ name: z.string().min(1).max(160), linked_table: KEY.nullish(), linked_id: UUID.nullish() }));
  const ctx = c.get("ctx");
  const r = await impactAnalysis(ctx, input);
  let linkedLabel: string | null = null;
  if (input.linked_table && input.linked_id) {
    if (!tableDef(input.linked_table)) throw bad("جدول رکورد مرتبط شناخته نیست");
    const linked = await get(ctx, input.linked_table, input.linked_id);
    linkedLabel = String(linked.display?.[input.linked_id] ?? linked.row.number ?? linked.row.id);
  }
  const row = await ctx.write(async (tx) => {
    return createIn(tx, ctx, "ci_impact_sim", {
      name: input.name, sim_state: r.state, ci_ids: input.ci_ids, linked_table: input.linked_table ?? null, linked_id: input.linked_id ?? null, linked_label: linkedLabel,
    });
  });
  await ctx.write((tx) => updateIn(tx, sysOf(ctx), "ci_impact_sim", row.id, { summary: impactText(r), result: { counts: r.counts, services: r.services, cis: r.cis.slice(0, 200), computed_at: r.computed_at } }, { trusted: true }));
  return c.json({ id: row.id, summary: impactText(r) });
});

cmdbRoutes.get("/health", async (c) => c.json(await healthSummary(c.get("ctx"))));

cmdbRoutes.post("/health/run", async (c) => {
  const ctx = c.get("ctx");
  await needAdmin(ctx);
  await ctx.write((tx) => enqueue(tx, { kind: "cmdb.health_all", orgId: ctx.org.id, payload: {}, dedupeKey: "cmdb.health_all" }));
  return c.json({ queued: true });
});

cmdbRoutes.post("/ci/:id/health", async (c) => {
  const ctx = c.get("ctx");
  const ciId = id(c.req.param("id"));
  await get(ctx, "ci", ciId);
  const r = await ctx.write((tx) => computeHealth(tx, sysOf(ctx), { ids: [ciId] }));
  const h = r.results.get(ciId);
  return c.json({ health: h ?? null });
});

cmdbRoutes.get("/ci/:id/summary", async (c) => c.json(await ciSummaryFacts(c.get("ctx"), id(c.req.param("id")))));
cmdbRoutes.get("/ci/:id/provenance", async (c) => c.json(await provenance(c.get("ctx"), id(c.req.param("id")))));

// the CI picker of other modules: readable CIs by number or words (requesters: only the CIs they own or use)
cmdbRoutes.get("/picker", async (c) => {
  const ctx = c.get("ctx");
  const q = query(c, z.object({ q: z.string().max(200).optional(), class: z.string().max(63).optional(), mine: z.coerce.boolean().optional(), retired: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(50).optional() }));
  const { def } = await defFor(ctx, "ci");
  const tree = await classTree(ctx.db, ctx);
  const parts: Cond[] = [];
  if (!q.retired) parts.push({ f: "state", op: "nin", v: ["retired", "disposed", "canceled"] });
  if (q.class && tree.get(q.class)) parts.push({ f: "class", op: "in", v: tree.descendants(q.class) });
  if (q.mine) parts.push({ or: [{ f: "used_by", op: "is_me" }, { f: "owned_by", op: "is_me" }] });
  const toHit = (r: Record<string, any>, display: Record<string, string> = {}): CiPickerHit => ({
    id: r.id, number: r.number ?? null, name: r.name, class: r.class, class_label: tree.label(r.class), state: r.state ?? null, used_by: r.used_by ?? null,
    secondary: [tree.label(r.class), r.fqdn ?? r.hostname ?? r.serial_number ?? null, r.used_by ? display[r.used_by] ?? null : null].filter(Boolean).join(" · "),
  });
  if (access().canReadTable(ctx, def)) {
    const r = await list(ctx, "ci", { q: q.q, filter: parts.length ? { and: parts } : undefined, size: q.limit ?? 20, sort: "name", fields: ["number", "name", "class", "state", "used_by", "fqdn", "hostname", "serial_number"], total: false });
    return c.json({ hits: r.rows.map((x) => toHit(x as never, r.display)) });
  }
  // a requester: their own devices only (the portal's «دستگاه من»), names and classes nothing more
  const own: Cond = { and: [...parts.filter((p) => !("or" in p)), { or: [{ f: "used_by", op: "eq", v: ctx.user.id }, { f: "owned_by", op: "eq", v: ctx.user.id }] }] };
  const rows = await liveRows(ctx.db, sysOf(ctx), "ci", own, { order: "t.name", limit: q.limit ?? 20 });
  const needle = (q.q ?? "").trim().toLowerCase();
  return c.json({ hits: rows.filter((r) => !needle || String(r.name).toLowerCase().includes(needle) || String(r.number ?? "").toLowerCase().includes(needle)).map((r) => ({ ...toHit(r), secondary: tree.label(r.class) })) });
});

// the reconciliation engine
cmdbRoutes.post("/ire/identify", async (c) => {
  const input = await body(c, z.object({ item }));
  return c.json(await identifyOnly(c.get("ctx"), input.item));
});

cmdbRoutes.post("/ire/items", async (c) => {
  const input = await body(c, z.object({ source_id: UUID.nullish(), items: z.array(item).min(1).max(1000), dry_run: z.boolean().optional(), default_class: z.string().max(63).nullish(), run_id: UUID.nullish() }));
  return c.json(await createOrUpdate(c.get("ctx"), input));
});

// imports: a run collects batches of rows mapped to CI fields
cmdbRoutes.post("/import/runs", async (c) => {
  const input = await body(c, z.object({ name: z.string().min(1).max(160), source_id: UUID.nullish(), class: z.string().max(63).nullish(), file_name: z.string().max(180).nullish(), dry_run: z.boolean().optional() }));
  const row = await startRun(c.get("ctx"), input);
  return c.json({ run: { id: row.id, number: row.number ?? null } });
});

cmdbRoutes.post("/import/runs/:id/batch", async (c) => {
  const ctx = c.get("ctx");
  const runId = id(c.req.param("id"));
  const input = await body(c, z.object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
    mapping: z.record(z.string(), z.string().max(120)).optional(),
    default_class: z.string().max(63).nullish(),
    dry_run: z.boolean().optional(),
  }));
  const run = await liveRow(ctx.db, ctx, "cmdb_import_run", runId);
  if (!run) throw notFound("اجرای ورود داده پیدا نشد");
  const mapping = input.mapping ?? Object.fromEntries(Object.keys(input.rows[0] ?? {}).map((k) => [k, k]));
  const items = input.rows.map((r) => mapRow(r, mapping, input.default_class ?? run.class ?? null));
  return c.json(await createOrUpdate(ctx, { source_id: run.source_id ?? null, items, dry_run: input.dry_run ?? run.dry_run, run_id: input.dry_run ? null : runId, default_class: input.default_class ?? run.class ?? null }));
});

cmdbRoutes.post("/import/runs/:id/finish", async (c) => {
  const input = await body(c, z.object({ error: z.string().max(2000).nullish() }));
  const row = await finishRun(c.get("ctx"), id(c.req.param("id")), input.error ?? null);
  return c.json({ run: { id: row.id, state: row.state } });
});

cmdbRoutes.post("/sources/:id/run", async (c) => {
  const ctx = c.get("ctx");
  await needAdmin(ctx);
  return c.json(await runUrlSource(sysOf(ctx), id(c.req.param("id"))));
});

// merge
const mergeInput = z.object({ survivor: UUID, absorbed: z.array(UUID).min(1).max(20), task_id: UUID.nullish() });
cmdbRoutes.post("/merge/preview", async (c) => {
  const input = await body(c, mergeInput);
  return c.json(await mergePreview(c.get("ctx"), input.survivor.toLowerCase(), input.absorbed));
});
cmdbRoutes.post("/merge", async (c) => {
  const input = await body(c, mergeInput);
  return c.json(await mergeCis(c.get("ctx"), input.survivor.toLowerCase(), input.absorbed, { taskId: input.task_id ?? null }));
});
cmdbRoutes.post("/merge/:task/undo", async (c) => c.json(await undoMerge(c.get("ctx"), id(c.req.param("task")))));

// baselines
cmdbRoutes.post("/baselines/:id/snapshot", async (c) => {
  const row = await takeSnapshot(c.get("ctx"), id(c.req.param("id")));
  return c.json({ item_count: row.item_count, taken_at: row.taken_at });
});
cmdbRoutes.get("/baselines/:id/compare", async (c) => {
  const q = query(c, z.object({ against: UUID.optional() }));
  return c.json(await compareBaseline(c.get("ctx"), id(c.req.param("id")), q.against ?? null));
});
cmdbRoutes.post("/baselines/:id/drift", async (c) => c.json(await driftFromBaseline(c.get("ctx"), id(c.req.param("id")))));

// relationship suggestions and rules
cmdbRoutes.post("/suggestions/run", async (c) => {
  const ctx = c.get("ctx");
  await needAdmin(ctx);
  return c.json(await ctx.write((tx) => suggestFromIncidents(tx, sysOf(ctx))));
});
cmdbRoutes.post("/suggestions/:id/accept", async (c) => {
  const input = await body(c, z.object({ type: z.string().max(63).nullish() }));
  const row = await acceptSuggestion(c.get("ctx"), id(c.req.param("id")), input.type ?? null);
  return c.json({ state: row.state, rel_id: row.rel_id ?? null });
});
cmdbRoutes.post("/suggestions/:id/reject", async (c) => {
  const row = await rejectSuggestion(c.get("ctx"), id(c.req.param("id")));
  return c.json({ state: row.state });
});
cmdbRoutes.post("/rel-rules/run", async (c) => {
  const ctx = c.get("ctx");
  await needAdmin(ctx);
  return c.json(await ctx.write((tx) => applyRelRules(tx, sysOf(ctx))));
});

// queries (class, condition, relationship steps)
cmdbRoutes.post("/query", async (c) => {
  const input = await body(c, z.object({
    class: z.string().max(63).nullish(),
    condition: cond,
    steps: z.array(z.object({ type: z.string().max(63), direction: z.enum(["out", "in"]), class: z.string().max(63).nullish(), condition: cond })).max(5).optional(),
    page: z.number().int().min(1).max(1000).optional(),
    size: z.number().int().min(1).max(200).optional(),
    fields: z.array(z.string().max(80)).max(20).optional(),
  }));
  return c.json(await runQuery(c.get("ctx"), input));
});

// «پیکربندی نادرست» on a task (CMDB-078): the correction, a note on the task and a finding for the CI's owner
cmdbRoutes.post("/wrong-ci", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ table: KEY, id: UUID, field: z.string().max(63).optional(), correct_ci_id: UUID.nullish(), note: z.string().max(2000).nullish() }));
  const field = input.field ?? "ci_id";
  const def = tableDef(input.table);
  if (!def || !def.fields.some((f) => f.name === field && f.ref === "ci" && f.type === "ref")) throw bad("این رکورد پیکربندی ندارد");
  const rec = await get(ctx, input.table, input.id);
  if (!rec.meta.canWrite) throw forbidden("اجازهٔ تغییر این رکورد را ندارید");
  const wrong = rec.row[field] as string | null;
  if (!wrong) throw bad("پیکربندی‌ای روی این رکورد نیست");
  if (input.correct_ci_id) await get(ctx, "ci", input.correct_ci_id);
  const out = await ctx.write(async (tx) => {
    if (input.correct_ci_id) await updateIn(tx, ctx, input.table, input.id, { [field]: input.correct_ci_id }, { version: undefined });
    const schema = await orgSchema(ctx, tx);
    const effective = schema.def(input.table) ?? def;
    if (effective.features?.journal) {
      const note = `پیکربندی نادرست بود${input.correct_ci_id ? " و اصلاح شد" : ""}.${input.note ? `\n\n${input.note}` : ""}`;
      await savepoint(tx, () => addJournalIn(tx, ctx, effective, { ...rec.row, id: input.id }, { kind: "work_note", body: note })).catch(() => undefined);
    }
    const ci = await liveRow(tx, sysOf(ctx), "ci", wrong);
    const key = `wrong_ci:${input.table}:${input.id}`;
    const [open] = await liveRows(tx, sysOf(ctx), "cmdb_finding", { and: [{ f: "dedupe_key", op: "eq", v: key }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
    if (open || !ci) return { finding_id: open?.id ?? null };
    const f = await createIn(tx, sysOf(ctx, ctx.user.id), "cmdb_finding", {
      short_description: `«${ci.name}» به اشتباه روی ${rec.row.number ?? def.label} ثبت شده بود`.slice(0, 200), ci_id: ci.id, kind: "wrong_ci", severity: "low", dedupe_key: key, auto: true,
      detail: input.note ?? null, assigned_to: ci.owned_by ?? null, assignment_group_id: ci.support_group_id ?? null, workspace_id: ci.workspace_id ?? null,
    }, { trusted: true });
    return { finding_id: f.id };
  });
  return c.json(out);
});

// the Windows app's own inventory (desktop only)
cmdbRoutes.get("/collector/local/preview", async (c) => {
  const ctx = c.get("ctx");
  if (ctx.cfg.mode !== "desktop") throw forbidden("جمع‌آوری موجودی این رایانه فقط در نسخهٔ ویندوزی است");
  const q = query(c, z.object({ software: z.coerce.boolean().optional() }));
  return c.json({ inventory: await collectLocalInventory({ software: q.software }) });
});
cmdbRoutes.post("/collector/local", async (c) => {
  const input = await body(c, z.object({ include_software: z.boolean().optional(), dry_run: z.boolean().optional() }));
  const r = await runLocalCollector(c.get("ctx"), { software: input.include_software, dryRun: input.dry_run });
  return c.json(r);
});

// the organisation's defaults (also re-adds what was deleted)
cmdbRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  await needAdmin(ctx);
  return c.json(await seedCmdbDefaults(ctx.cfg, ctx.org.id, { force: true }));
});

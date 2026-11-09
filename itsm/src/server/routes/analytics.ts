// HTTP API of analytics under /api/o/:org/analytics (docs/modules/analytics_FA.md «API»; contracts in
// @shared/analytics/api). Definitions — reports, dashboards, indicators, schedules, deliveries, settings — are engine
// records served by the generic API (/r/analytics_report…); these routes RUN them. Every handler works with the
// caller's own context: reports, widgets, scorecards and the KPI hub count only what the caller may read, a shared
// definition never shares data, stored scores are read only by the indicator's score readers, and an Excel file holds
// what its downloader (or a schedule's recipient) may see. Everything needs the reports area's read right.
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { bad, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { contentDisposition, createIn, defFor, orgSchema, orgTz, updateIn } from "../engine";
import { TABLES } from "@shared/tables";
import { indicatorProblem } from "@shared/analytics/kpi";
import { libraryFor, KPI_LIBRARY, LIBRARY_DASHBOARDS, dashboardsFor } from "@shared/analytics/library";
import type { AnalyticsMeta, AskResult, IndicatorHubView, LibraryView, RunInput } from "@shared/analytics/api";
import { DEFINITION_TABLES } from "@shared/analytics/api";
import type { Cond } from "@shared/model/conditions";
import type { DashboardFilter, FilterValues, ReportSpec, Widget } from "@shared/analytics/types";
import { applyDashboardFilters } from "@shared/analytics/model";
import {
  analyticsAiCapabilities, analyticsConfig, canAdmin, canAuthor, canRead, collectNow, dashboardView, ensureTick, exportBundle, homeDashboard, importBundle, indicatorHub,
  isRestricted, narrate, narrativeFacts, questionToReport, runOne, runReport, runSchedule, runWidget, scorecard, seedAnalyticsDefaults, resultSheet, workbook, fileName,
  aboutSheet, snapshotStep, scoreItem, indicatorNarrative,
} from "../modules/analytics";
import { canEditDefinition } from "../modules/analytics/dashboards";
import { liveRow, liveRows, sysOf } from "../modules/analytics/common";
import type { Ctx } from "../context";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const anyJson = z.any();
const spec = z.any().refine((v) => v && typeof v === "object" && typeof v.table === "string", "تعریف گزارش معتبر نیست") as z.ZodType<ReportSpec>;
const values = z.record(z.string(), z.unknown()).default({}) as z.ZodType<FilterValues>;

const need = (ctx: Ctx) => {
  if (!canRead(ctx)) throw forbidden("به گزارش‌ها دسترسی ندارید");
};
const needAdmin = (ctx: Ctx) => {
  need(ctx);
  if (!canAdmin(ctx)) throw forbidden("این کار با مدیر گزارش‌هاست");
};

export const analyticsRoutes = router();

// ----- meta ------------------------------------------------------------------------------------------------------------

analyticsRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const schema = await orgSchema(ctx);
  const cfg = await analyticsConfig(ctx.db, ctx);
  const tables: AnalyticsMeta["tables"] = [];
  for (const t of TABLES.values()) {
    const def = schema.def(t.key);
    if (!def || def.virtual || def.module === "analytics" || !access().canReadTable(ctx, def)) continue;
    tables.push({ key: def.key, label: def.label, plural: def.plural, module: def.module ?? null });
  }
  // organisations created before the module get their tick (deliveries, snapshots) the first time anyone looks
  if (cfg.seeded) await ensureTick(ctx.db, ctx.org.id).catch(() => undefined);
  const meta: AnalyticsMeta = { can_author: canAuthor(ctx), can_admin: canAdmin(ctx), k: cfg.small_cell_k, tables, ai: analyticsAiCapabilities(), seeded: cfg.seeded > 0, timezone: orgTz(ctx) };
  return c.json(meta);
});

// ----- reports ---------------------------------------------------------------------------------------------------------

/** Apply a dashboard's controls to a definition (the designer previews widgets with them). */
async function withFilters(ctx: Ctx, s: ReportSpec, filters: DashboardFilter[] | undefined, vals: FilterValues | undefined): Promise<ReportSpec> {
  if (!filters?.length || !vals || !Object.keys(vals).length) return s;
  const schema = await orgSchema(ctx);
  const def = schema.def(s.table);
  return def ? applyDashboardFilters(s, def, filters, vals, schema.lookup).spec : s;
}

analyticsRoutes.post("/run", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ spec, extra: anyJson.nullish(), filters: z.array(anyJson).max(8).optional(), values: values.optional() })) as RunInput;
  const s = await withFilters(ctx, input.spec, input.filters, input.values);
  return c.json(await runReport(ctx, s, { extra: (input.extra as Cond | null) ?? null }));
});

/** A saved report the caller may read (404 otherwise). */
async function readableReport(ctx: Ctx, reportId: string) {
  const r = await liveRow(ctx.db, ctx, "analytics_report", reportId);
  if (!r) throw notFound("گزارش پیدا نشد یا با شما به اشتراک گذاشته نشده است");
  return r;
}

analyticsRoutes.post("/reports/:id/run", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ extra: anyJson.nullish(), filters: z.array(anyJson).max(8).optional(), values: values.optional() }));
  const r = await readableReport(ctx, id(c.req.param("id")));
  const s = await withFilters(ctx, r.spec as ReportSpec, input.filters as DashboardFilter[] | undefined, input.values);
  return c.json(await runReport(ctx, s, { extra: (input.extra as Cond | null) ?? null }));
});

/** An Excel file of a result (what the caller may see). */
async function xlsxResponse(ctx: Ctx, title: string, s: ReportSpec): Promise<Response> {
  const r = await runReport(ctx, s);
  const schema = await orgSchema(ctx);
  const at = new Date();
  const bytes = await workbook([resultSheet(title, r, schema), aboutSheet([["گزارش", title], ["جدول", r.table_label], ["رکوردها", String(r.total_n)], ["دسترسی", "فقط رکوردهایی که شما اجازهٔ دیدن آن‌ها را دارید"]])]);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-length": String(bytes.byteLength),
      "content-disposition": contentDisposition(fileName(title, at)),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

analyticsRoutes.post("/xlsx", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ spec, title: z.string().max(150).optional(), filters: z.array(anyJson).max(8).optional(), values: values.optional() }));
  const s = await withFilters(ctx, input.spec, input.filters as DashboardFilter[] | undefined, input.values);
  return xlsxResponse(ctx, input.title?.trim() || "گزارش", s);
});

analyticsRoutes.get("/reports/:id/xlsx", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const r = await readableReport(ctx, id(c.req.param("id")));
  return xlsxResponse(ctx, String(r.name), r.spec as ReportSpec);
});

// ----- dashboards ------------------------------------------------------------------------------------------------------

analyticsRoutes.get("/dashboards/:id", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  return c.json(await dashboardView(ctx, id(c.req.param("id"))));
});

analyticsRoutes.post("/dashboards/:id/widgets/:wid", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ values: values.optional() }));
  const wid = z.string().regex(/^[a-z0-9_-]{1,40}$/i, "ابزارک معتبر نیست").parse(c.req.param("wid"));
  return c.json(await runWidget(ctx, id(c.req.param("id")), wid, input.values ?? {}));
});

/** A widget being designed (not saved yet), run as the caller with the dashboard's controls. */
analyticsRoutes.post("/widgets/preview", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ widget: anyJson, filters: z.array(anyJson).max(8).optional(), values: values.optional() }));
  const w = input.widget as Widget;
  if (!w || typeof w !== "object" || !["report", "indicator", "scorecard", "text"].includes(String(w.kind))) throw bad("ابزارک معتبر نیست");
  return c.json(await runOne(ctx, w, (input.filters ?? []) as DashboardFilter[], input.values ?? {}));
});

analyticsRoutes.get("/home", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  return c.json(await homeDashboard(ctx));
});

// ----- indicators ------------------------------------------------------------------------------------------------------

analyticsRoutes.get("/scorecard", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const q = query(c, z.object({ practice: z.string().max(20).optional(), ids: z.string().max(4000).optional(), keys: z.string().max(4000).optional(), trend: z.coerce.number().int().min(2).max(24).optional() }));
  const ids = q.ids ? q.ids.split(",").filter((x) => UUID.safeParse(x).success) : undefined;
  const keys = q.keys ? q.keys.split(",").filter(Boolean).slice(0, 50) : undefined;
  return c.json(await scorecard(ctx, { practice: q.practice, ids, keys, trend: q.trend ?? 12 }));
});

analyticsRoutes.get("/indicators/:id/hub", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const hub = await indicatorHub(ctx, id(c.req.param("id")), { canCollect: canAdmin(ctx) });
  const narrative: IndicatorHubView["narrative"] = hub.item.restricted ? null : { text: indicatorNarrative(hub.item, hub.breakdowns), ai: false };
  const out: IndicatorHubView = { ...hub, narrative };
  return c.json(out);
});

analyticsRoutes.post("/indicators/:id/collect", async (c) => {
  const ctx = c.get("ctx");
  needAdmin(ctx);
  return c.json(await collectNow(ctx, id(c.req.param("id")), true));
});

/** Validate an indicator being written (formula, parts) and compute its current value as the caller. */
analyticsRoutes.post("/indicators/check", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ formula: z.string().max(500), parts: z.array(anyJson).max(10), breakdowns: z.array(z.string().max(80)).max(5).optional(), grain: z.enum(["day", "week", "month", "quarter", "year"]).optional() }));
  const schema = await orgSchema(ctx);
  const problem = indicatorProblem({ formula: input.formula, parts: input.parts as never, breakdowns: input.breakdowns ?? [] }, schema.lookup);
  if (problem) return c.json({ problem, item: null });
  const row = { id: "00000000-0000-0000-0000-000000000000", key: "preview", name: "پیش‌نمایش", practice: "other", unit: "number", direction: "none", formula: input.formula, parts: input.parts, grain: input.grain ?? "month", breakdowns: [], active: true };
  const item = await scoreItem(ctx, row, { trend: 6 });
  return c.json({ problem: null, item });
});

analyticsRoutes.post("/collect", async (c) => {
  const ctx = c.get("ctx");
  needAdmin(ctx);
  const r = await snapshotStep(ctx.cfg, ctx.org.id, { since: new Date().toISOString(), deadline: Date.now() + 60_000 });
  return c.json(r);
});

// ----- questions and narratives ----------------------------------------------------------------------------------------

analyticsRoutes.post("/ask", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ question: z.string().trim().min(2, "پرسش کوتاه است").max(500) }));
  const r = await questionToReport(ctx, input.question);
  let result: AskResult["result"] = null;
  let problem = r.problem;
  if (r.spec) {
    try {
      result = await runReport(ctx, r.spec);
    } catch (e) {
      if (!isRestricted(e) && !(e instanceof Error && "status" in e && (e as { status: number }).status === 400)) throw e;
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  const out: AskResult = { spec: r.spec, chips: r.chips, problem, ai: r.ai, result };
  return c.json(out);
});

analyticsRoutes.post("/narrate", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ spec: spec.optional(), report_id: UUID.optional(), title: z.string().max(150).optional() }));
  let s = input.spec ?? null;
  let title = input.title ?? "گزارش";
  if (input.report_id) {
    const r = await readableReport(ctx, input.report_id.toLowerCase());
    s = r.spec as ReportSpec;
    title = String(r.name);
  }
  if (!s) throw bad("گزارشی برای شرح داده نشده است");
  const result = await runReport(ctx, s);
  return c.json(await narrate(ctx, narrativeFacts(title, s, result)));
});

// ----- export and import -----------------------------------------------------------------------------------------------

analyticsRoutes.post("/export", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ reports: z.array(UUID).max(100).optional(), dashboards: z.array(UUID).max(100).optional(), indicators: z.array(UUID).max(100).optional() }));
  return c.json(await exportBundle(ctx, input));
});

analyticsRoutes.post("/import", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const input = await body(c, z.object({ bundle: anyJson, folder: z.string().max(80).nullish() }));
  return c.json(await importBundle(ctx, input.bundle, { folder: input.folder ?? null }));
});

// ----- schedules -------------------------------------------------------------------------------------------------------

analyticsRoutes.post("/schedules/:id/send", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const sid = id(c.req.param("id"));
  const s = await liveRow(ctx.db, ctx, "analytics_schedule", sid);
  if (!s) throw notFound("زمان‌بندی پیدا نشد");
  if (s.owner_id !== ctx.user.id && !canAdmin(ctx)) throw forbidden("فقط مالک زمان‌بندی آن را می‌فرستد");
  const outcomes = await runSchedule(ctx.cfg, ctx, sid, { manual: true });
  return c.json({ outcomes });
});

// ----- administration of definitions -----------------------------------------------------------------------------------

const defTable = z.enum(DEFINITION_TABLES);

analyticsRoutes.post("/certify", async (c) => {
  const ctx = c.get("ctx");
  needAdmin(ctx);
  const input = await body(c, z.object({ table: defTable.exclude(["analytics_schedule"]), id: UUID, certified: z.boolean() }));
  const row = await liveRow(ctx.db, ctx, input.table, input.id.toLowerCase());
  if (!row) throw notFound("تعریف پیدا نشد");
  const out = await ctx.write((tx) => updateIn(tx, ctx, input.table, row.id, { certified: input.certified }, { trusted: true }));
  return c.json({ row: out });
});

analyticsRoutes.post("/transfer", async (c) => {
  const ctx = c.get("ctx");
  needAdmin(ctx);
  const input = await body(c, z.object({ table: defTable, id: UUID, owner_id: UUID }));
  const sys = sysOf(ctx);
  const row = await liveRow(ctx.db, sys, input.table, input.id.toLowerCase());
  if (!row) throw notFound("تعریف پیدا نشد");
  const member = await ctx.db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null and is_active`, [ctx.org.id, input.owner_id.toLowerCase()]);
  if (!member) throw bad("مالک تازه عضو فعال این سازمان نیست");
  // ownership moves on behalf of the administrator (audited in the record's history)
  const out = await ctx.write((tx) => updateIn(tx, sysOf(ctx, ctx.user.id), input.table, row.id, { owner_id: input.owner_id.toLowerCase() }, { trusted: true }));
  return c.json({ row: out });
});

analyticsRoutes.post("/copy", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  if (!canAuthor(ctx)) throw forbidden("ساختن گزارش و داشبورد برای شما مجاز نیست");
  const input = await body(c, z.object({ table: z.enum(["analytics_report", "analytics_dashboard"]), id: UUID, name: z.string().trim().min(1).max(150).optional() }));
  const row = await liveRow(ctx.db, ctx, input.table, input.id.toLowerCase());
  if (!row) throw notFound("تعریف پیدا نشد");
  const name = input.name ?? `رونوشت ${row.name}`.slice(0, 150);
  const data =
    input.table === "analytics_report"
      ? { name, description: row.description ?? null, folder: row.folder ?? null, spec: row.spec, status: "draft", shares: [] }
      : { name, description: row.description ?? null, folder: row.folder ?? null, layout: row.layout, filters: row.filters ?? [], tv_cycle: row.tv_cycle ?? 20, refresh_minutes: row.refresh_minutes ?? 5, shares: [] };
  const out = await ctx.write((tx) => createIn(tx, ctx, input.table, data));
  return c.json({ row: out });
});

/** May the caller change this definition? (the screens offer «ویرایش» only then; the server checks every write) */
analyticsRoutes.get("/can-edit/:table/:id", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const table = defTable.parse(c.req.param("table"));
  const row = await liveRow(ctx.db, ctx, table, id(c.req.param("id")));
  if (!row) throw notFound("تعریف پیدا نشد");
  return c.json({ can_edit: await canEditDefinition(ctx, table, row), can_admin: canAdmin(ctx) });
});

// ----- the library and the defaults --------------------------------------------------------------------------------------

analyticsRoutes.get("/library", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const schema = await orgSchema(ctx);
  const have = await liveRows(ctx.db, sysOf(ctx), "analytics_indicator", { f: "key", op: "nempty" }, { limit: 500 });
  const dash = await liveRows(ctx.db, sysOf(ctx), "analytics_dashboard", { f: "library_key", op: "nempty" }, { limit: 100 });
  const keys = new Set(have.map((r) => String(r.key)));
  const dkeys = new Set(dash.map((r) => String(r.library_key)));
  const available = new Set(libraryFor(schema.lookup).map((k) => k.key));
  const okDash = new Set(dashboardsFor(schema.lookup).map((d) => d.key));
  const out: LibraryView = {
    indicators: KPI_LIBRARY.map((k) => ({ key: k.key, name: k.name, practice: k.practice, available: available.has(k.key), installed: keys.has(k.key), reason: available.has(k.key) ? null : indicatorProblem(k, schema.lookup) })),
    dashboards: LIBRARY_DASHBOARDS.map((d) => ({ key: d.key, name: d.name, available: okDash.has(d.key), installed: dkeys.has(d.key) })),
  };
  return c.json(out);
});

analyticsRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  needAdmin(ctx);
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  return c.json(await seedAnalyticsDefaults(ctx.cfg, ctx.org.id, { force: input.force ?? false }));
});

/** The engine table definitions of a report's table, checked for the caller (the designer's field lists). */
analyticsRoutes.get("/tables/:table", async (c) => {
  const ctx = c.get("ctx");
  need(ctx);
  const { def } = await defFor(ctx, c.req.param("table"));
  if (def.virtual || !access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const visible = access().visibleFields(ctx, def);
  return c.json({ key: def.key, fields: def.fields.filter((f) => !visible || visible.has(f.name)).map((f) => f.name) });
});

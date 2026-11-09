// JSON export and import of definitions (catalogue ANA-013/050): reports, dashboards and indicators travel between
// organisations (or a Windows app and the web) as a bundle of definitions only — no ids, owners, sharing or data.
// Export takes what the caller may read (a dashboard brings the saved reports its widgets show, and the indicators
// they name travel as keys); import creates everything as the caller's own, private definitions, through the engine
// with the caller's context (the hooks validate each definition against this organisation's schema and the caller's
// access), and reuses an indicator that already exists here under the same key rather than duplicating it.
import { bundleProblem, layoutFromBundle, layoutToBundle, makeBundle } from "@shared/analytics/share";
import type { AnalyticsBundle, BundleDashboard, BundleIndicator, BundleReport, DashboardFilter, DashboardLayout, IndicatorPart, ReportSpec, Widget } from "@shared/analytics/types";
import type { ImportResult } from "@shared/analytics/api";
import type { Ctx } from "../../context";
import { AppError, bad, forbidden } from "../../http/errors";
import { createIn } from "../../engine";
import { canAuthor, isUuid, liveRows, type Row } from "./common";
import { indicatorOf } from "./indicators";

const ids = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter(isUuid).slice(0, 100) : []);

/** The bundle of the definitions the caller may read among `want` (ids). */
export async function exportBundle(ctx: Ctx, want: { reports?: string[]; dashboards?: string[]; indicators?: string[] }): Promise<AnalyticsBundle> {
  const dashboards = ids(want.dashboards).length ? await liveRows(ctx.db, ctx, "analytics_dashboard", { f: "id", op: "in", v: ids(want.dashboards) }, { limit: 100 }) : [];
  const widgetReports = dashboards.flatMap((d) => ((d.layout as DashboardLayout | null)?.widgets ?? []).map((w) => w.report_id)).filter(isUuid);
  const reportIds = [...new Set([...ids(want.reports), ...widgetReports])];
  const reports = reportIds.length ? await liveRows(ctx.db, ctx, "analytics_report", { f: "id", op: "in", v: reportIds }, { limit: 200 }) : [];
  const widgetIndicators = dashboards.flatMap((d) => ((d.layout as DashboardLayout | null)?.widgets ?? []).flatMap((w) => [w.indicator_id, ...(w.indicator_ids ?? [])])).filter(isUuid);
  const indicatorIds = [...new Set([...ids(want.indicators), ...widgetIndicators])];
  const indicators = indicatorIds.length ? await liveRows(ctx.db, ctx, "analytics_indicator", { f: "id", op: "in", v: indicatorIds }, { limit: 200 }) : [];

  const refOf = new Map(reports.map((r, i) => [String(r.id), `r${i + 1}`]));
  const keyOf = new Map(indicators.map((r) => [String(r.id), String(r.key)]));
  const outReports: BundleReport[] = reports.map((r) => ({ ref: refOf.get(String(r.id))!, name: String(r.name), description: r.description ?? null, folder: r.folder ?? null, spec: r.spec as ReportSpec }));
  const outDashboards: BundleDashboard[] = dashboards.map((d, i) => ({
    ref: `d${i + 1}`,
    name: String(d.name),
    description: d.description ?? null,
    folder: d.folder ?? null,
    layout: layoutToBundle(d.layout as DashboardLayout, (id) => refOf.get(id) ?? null, (id) => keyOf.get(id) ?? null),
    filters: Array.isArray(d.filters) ? (d.filters as DashboardFilter[]) : [],
    tv_cycle: d.tv_cycle ?? null,
    refresh_minutes: d.refresh_minutes ?? null,
  }));
  const outIndicators: BundleIndicator[] = indicators.map((r) => {
    const { id: _id, formula_version: _v, certified: _c, ...def } = indicatorOf(r);
    return { ...def, ref: String(r.key) };
  });
  return makeBundle({ reports: outReports, dashboards: outDashboards, indicators: outIndicators });
}

const reason = (e: unknown) => (e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e));

/** Import a bundle as the caller's own definitions (each one validated by the tables' hooks; failures are listed). */
export async function importBundle(ctx: Ctx, input: unknown, opts: { folder?: string | null } = {}): Promise<ImportResult> {
  if (!canAuthor(ctx)) throw forbidden("ساختن گزارش و داشبورد برای شما مجاز نیست");
  const problem = bundleProblem(input);
  if (problem) throw bad(problem);
  const b = input as AnalyticsBundle;
  const out: ImportResult = { reports: 0, dashboards: 0, indicators: 0, skipped: [], ids: { reports: [], dashboards: [], indicators: [] } };
  const folder = (opts.folder ?? "").trim().slice(0, 80) || null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

  // indicators: reuse an existing key, else create (the caller's own)
  const indicatorIds = new Map<string, string>();
  const keys = (b.indicators ?? []).map((x) => String(x?.key ?? "")).filter(Boolean);
  if (keys.length) for (const r of await liveRows(ctx.db, ctx, "analytics_indicator", { f: "key", op: "in", v: keys }, { limit: 300 })) indicatorIds.set(String(r.key), String(r.id));
  for (const x of b.indicators ?? []) {
    const key = String(x?.key ?? "");
    if (!key || indicatorIds.has(key)) continue;
    try {
      const row = await ctx.write((tx) =>
        createIn(tx, ctx, "analytics_indicator", {
          key,
          name: str(x.name, 150) ?? key,
          description: str(x.description, 2000),
          practice: x.practice,
          unit: x.unit,
          direction: x.direction,
          grain: x.grain,
          formula: x.formula,
          parts: (x.parts ?? []) as IndicatorPart[],
          breakdowns: x.breakdowns ?? [],
          target: x.target ?? null,
          warn: x.warn ?? null,
          crit: x.crit ?? null,
          decimals: x.decimals ?? null,
        }),
      );
      indicatorIds.set(key, String(row.id));
      out.indicators++;
      out.ids.indicators.push(String(row.id));
    } catch (e) {
      out.skipped.push(`شاخص «${str(x?.name, 80) ?? key}»: ${reason(e)}`);
    }
  }

  const reportIds = new Map<string, string>();
  for (const x of b.reports ?? []) {
    try {
      const row = await ctx.write((tx) => createIn(tx, ctx, "analytics_report", { name: str(x.name, 150) ?? "گزارش", description: str(x.description, 2000), folder: folder ?? str(x.folder, 80), spec: x.spec, status: "draft", shares: [] }));
      reportIds.set(String(x.ref), String(row.id));
      out.reports++;
      out.ids.reports.push(String(row.id));
    } catch (e) {
      out.skipped.push(`گزارش «${str(x?.name, 80) ?? "?"}»: ${reason(e)}`);
    }
  }

  for (const x of b.dashboards ?? []) {
    try {
      const layout = layoutFromBundle(x.layout ?? { widgets: [] }, (ref) => reportIds.get(ref) ?? null, (key) => indicatorIds.get(key) ?? null);
      const dropped: Widget[] = [];
      layout.widgets = layout.widgets.filter((w) => {
        const ok = w.kind === "report" ? !!(w.spec || w.report_id) : w.kind === "indicator" ? !!w.indicator_id : w.kind === "scorecard" ? !!w.indicator_ids?.length : true;
        if (!ok) dropped.push(w);
        return ok;
      });
      const row = await ctx.write((tx) =>
        createIn(tx, ctx, "analytics_dashboard", {
          name: str(x.name, 150) ?? "داشبورد",
          description: str(x.description, 2000),
          folder: folder ?? str(x.folder, 80),
          layout,
          filters: x.filters ?? [],
          tv_cycle: x.tv_cycle ?? 20,
          refresh_minutes: x.refresh_minutes ?? 5,
          shares: [],
        }),
      );
      out.dashboards++;
      out.ids.dashboards.push(String(row.id));
      if (dropped.length) out.skipped.push(`داشبورد «${str(x.name, 80)}»: ${dropped.length} ابزارک بی‌گزارش یا بی‌شاخص کنار گذاشته شد`);
    } catch (e) {
      out.skipped.push(`داشبورد «${str(x?.name, 80) ?? "?"}»: ${reason(e)}`);
    }
  }
  return out;
}

export type { Row };

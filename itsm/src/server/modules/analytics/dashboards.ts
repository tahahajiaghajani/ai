// Dashboards as their viewer sees them (catalogue ANA-010/011/049/051): the definition is shared, the data never is.
// A dashboard opens only for those its sharing names (the row rule); each widget runs with the VIEWER's access — a
// saved report the viewer may not read, a table or field outside their access, makes that one widget «در دسترس شما
// نیست» while the others still draw; the dashboard's controls (time window, field filters) are applied to every
// widget whose table has the field. The home dashboard of a member is the one marked as the home of one of their
// workspaces, else one marked as everyone's home among those they read.
import { applyDashboardFilters } from "@shared/analytics/model";
import type { DashboardFilter, DashboardLayout, FilterValues, ReportSpec, Widget } from "@shared/analytics/types";
import type { DashboardView, HomeDashboard, WidgetRun } from "@shared/analytics/api";
import type { Ctx } from "../../context";
import { notFound } from "../../http/errors";
import { subjectOf } from "../../access";
import { orgSchema } from "../../engine";
import { mayWriteRecord } from "../change/common";
import { isUuid, liveRow, liveRows, num, type Row } from "./common";
import { isRestricted, runReport } from "./query";
import { scorecard, scoreItem } from "./indicators";

const RESTRICTED = "این ابزارک داده‌ای را نشان می‌دهد که در دسترس شما نیست";

/** May the caller change this definition (the area's write right and the row rule: owner or editor)? */
export async function canEditDefinition(ctx: Ctx, table: string, row: Row): Promise<boolean> {
  if (ctx.actor === "system") return true;
  return mayWriteRecord(ctx.db, ctx, table, row.id);
}

/**
 * A definition the caller may open: readable, and — while it is in the recycle bin — only for those who may change it
 * (who can restore it); for everyone else it is gone (404), shared or not.
 */
export async function openableDefinition(ctx: Ctx, table: "analytics_report" | "analytics_dashboard", id: string): Promise<Row | null> {
  const row = await liveRow(ctx.db, ctx, table, id);
  if (!row) return null;
  if (row.trashed && !(await canEditDefinition(ctx, table, row))) return null;
  return row;
}

function layoutOf(row: Row): DashboardLayout {
  const l = row.layout as DashboardLayout | null;
  return { tabs: Array.isArray(l?.tabs) ? l!.tabs : [], widgets: Array.isArray(l?.widgets) ? l!.widgets : [] };
}

/** A readable dashboard as the caller may see it (404 when they may not read it, or it is in the recycle bin for others). */
export async function dashboardView(ctx: Ctx, id: string): Promise<DashboardView> {
  const row = await openableDefinition(ctx, "analytics_dashboard", id);
  if (!row) throw notFound("داشبورد پیدا نشد یا با شما به اشتراک گذاشته نشده است");
  return viewOf(ctx, row);
}

async function viewOf(ctx: Ctx, row: Row): Promise<DashboardView> {
  const layout = layoutOf(row);
  const reportIds = [...new Set(layout.widgets.map((w) => w.report_id).filter(isUuid))];
  const indicatorIds = [...new Set(layout.widgets.flatMap((w) => [w.indicator_id, ...(w.indicator_ids ?? [])]).filter(isUuid))];
  const reports = reportIds.length ? await liveRows(ctx.db, ctx, "analytics_report", { f: "id", op: "in", v: reportIds }, { limit: 100 }) : [];
  const indicators = indicatorIds.length ? await liveRows(ctx.db, ctx, "analytics_indicator", { f: "id", op: "in", v: indicatorIds }, { limit: 200 }) : [];
  return {
    id: String(row.id),
    number: (row.number as string) ?? null,
    name: String(row.name ?? ""),
    description: (row.description as string) ?? null,
    layout,
    filters: Array.isArray(row.filters) ? (row.filters as DashboardFilter[]) : [],
    tv_cycle: num(row.tv_cycle) ?? 20,
    refresh_minutes: num(row.refresh_minutes) ?? 5,
    certified: !!row.certified,
    can_edit: await canEditDefinition(ctx, "analytics_dashboard", row),
    owner_id: (row.owner_id as string) ?? null,
    version: Number(row.version ?? 1),
    reports: Object.fromEntries(reports.map((r) => [String(r.id), String(r.name ?? "")])),
    indicators: Object.fromEntries(indicators.map((r) => [String(r.id), String(r.name ?? "")])),
  };
}

/** The definition a report widget runs: its own, or the saved report's when the viewer may read that report. */
async function widgetSpec(ctx: Ctx, w: Widget): Promise<{ spec: ReportSpec; report: { id: string; name: string } | null } | null> {
  if (w.spec) return { spec: w.spec, report: null };
  if (!isUuid(w.report_id)) return null;
  const r = await liveRow(ctx.db, ctx, "analytics_report", w.report_id);
  if (!r || r.trashed) return null;
  return { spec: r.spec as ReportSpec, report: { id: String(r.id), name: String(r.name ?? "") } };
}

/** One widget of a dashboard, computed as the caller with the dashboard's controls applied. */
export async function runWidget(ctx: Ctx, dashboardId: string, widgetId: string, values: FilterValues = {}, opts: { now?: number } = {}): Promise<WidgetRun> {
  const row = await openableDefinition(ctx, "analytics_dashboard", dashboardId);
  if (!row) throw notFound("داشبورد پیدا نشد یا با شما به اشتراک گذاشته نشده است");
  const w = layoutOf(row).widgets.find((x) => x.id === widgetId);
  if (!w) throw notFound("ابزارک پیدا نشد");
  const filters = Array.isArray(row.filters) ? (row.filters as DashboardFilter[]) : [];
  return runOne(ctx, w, filters, values, opts);
}

/** A widget (of a stored dashboard or of one being designed) as the caller. */
export async function runOne(ctx: Ctx, w: Widget, filters: DashboardFilter[], values: FilterValues, opts: { now?: number } = {}): Promise<WidgetRun> {
  try {
    switch (w.kind) {
      case "text":
        return { kind: "text", text: String(w.text ?? "") };
      case "report": {
        const s = await widgetSpec(ctx, w);
        if (!s) return { kind: "restricted", restricted: true, reason: "گزارش این ابزارک با شما به اشتراک گذاشته نشده است" };
        const schema = await orgSchema(ctx);
        const def = schema.def(s.spec.table);
        if (!def) return { kind: "restricted", restricted: true, reason: `جدول «${s.spec.table}» در این سازمان نیست` };
        const applied = applyDashboardFilters(s.spec, def, filters, values, schema.lookup);
        const result = await runReport(ctx, applied.spec, { now: opts.now });
        return { kind: "report", result, spec: applied.spec, applied: applied.applied, ignored: applied.ignored, report: s.report };
      }
      case "indicator": {
        const ind = isUuid(w.indicator_id) ? await liveRow(ctx.db, ctx, "analytics_indicator", w.indicator_id) : w.indicator_key ? (await liveRows(ctx.db, ctx, "analytics_indicator", { f: "key", op: "eq", v: w.indicator_key }, { limit: 1 }))[0] : null;
        if (!ind) return { kind: "restricted", restricted: true, reason: "شاخص این ابزارک پیدا نشد" };
        return { kind: "indicator", item: await scoreItem(ctx, ind, { now: opts.now, trend: 12 }) };
      }
      case "scorecard": {
        const ids = (w.indicator_ids ?? []).filter(isUuid);
        const r = ids.length ? await scorecard(ctx, { ids, now: opts.now, trend: 12 }) : await scorecard(ctx, { keys: w.indicator_keys ?? [], now: opts.now, trend: 12 });
        return { kind: "scorecard", items: r.items };
      }
    }
  } catch (e) {
    if (isRestricted(e)) return { kind: "restricted", restricted: true, reason: e.status === 403 ? (e.message || RESTRICTED) : RESTRICTED };
    throw e;
  }
  return { kind: "restricted", restricted: true, reason: "این نوع ابزارک شناخته نیست" };
}

/** The caller's home dashboard: their workspace's, else one marked for everyone (certified and newest first). */
export async function homeDashboard(ctx: Ctx): Promise<HomeDashboard> {
  const rows = await liveRows(
    ctx.db,
    ctx,
    "analytics_dashboard",
    { and: [{ f: "trashed", op: "eq", v: false }, { or: [{ f: "is_home", op: "eq", v: true }, { f: "home_workspaces", op: "nempty" }] }] },
    { order: "t.certified desc, t.updated_at desc", limit: 50 },
  );
  if (!rows.length) return { dashboard: null, reason: null };
  const mine = new Set(ctx.actor === "system" ? [] : subjectOf(ctx).workspaces);
  const ws = rows.find((r) => Array.isArray(r.home_workspaces) && (r.home_workspaces as string[]).some((w) => mine.has(w)));
  if (ws) return { dashboard: await viewOf(ctx, ws), reason: "workspace" };
  const all = rows.find((r) => r.is_home);
  return all ? { dashboard: await viewOf(ctx, all), reason: "everyone" } : { dashboard: null, reason: null };
}

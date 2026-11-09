// Data of the analytics screens (src/server/routes/analytics.ts, contracts in @shared/analytics/api): typed calls and
// query keys. Light on purpose: the module's index imports it; the screens load with their pages.
import type { Cond } from "@shared/model/conditions";
import type {
  AnalyticsMeta, AskResult, DashboardView, HomeDashboard, ImportResult, IndicatorHubView, LibraryView, NarrateResult, SeedResult, WidgetRun, AnalyticsBundle,
} from "@shared/analytics/api";
import type { DashboardFilter, FilterValues, ReportResult, ReportSpec, ScorecardItem, Widget } from "@shared/analytics/types";
import { ApiError, type OrgApi } from "../../lib/api";

export const ANALYTICS_KEYS = {
  all: ["analytics"] as const,
  meta: (org: string) => ["analytics", org, "meta"] as const,
  run: (org: string, spec: unknown, extra?: unknown) => ["analytics", org, "run", spec, extra ?? null] as const,
  report: (org: string, id: string, values?: unknown) => ["analytics", org, "report", id, values ?? null] as const,
  dashboard: (org: string, id: string) => ["analytics", org, "dashboard", id] as const,
  widget: (org: string, id: string, wid: string, values: unknown) => ["analytics", org, "widget", id, wid, values] as const,
  preview: (org: string, widget: unknown, values: unknown) => ["analytics", org, "preview", widget, values] as const,
  home: (org: string) => ["analytics", org, "home"] as const,
  scorecard: (org: string, q: unknown) => ["analytics", org, "scorecard", q] as const,
  hub: (org: string, id: string) => ["analytics", org, "hub", id] as const,
  library: (org: string) => ["analytics", org, "library"] as const,
};

export const analyticsApi = {
  meta: (api: OrgApi) => api.get<AnalyticsMeta>("/analytics/meta"),
  run: (api: OrgApi, spec: ReportSpec, o: { extra?: Cond | null; filters?: DashboardFilter[]; values?: FilterValues } = {}) => api.post<ReportResult>("/analytics/run", { spec, ...o }),
  runReport: (api: OrgApi, id: string, o: { extra?: Cond | null; filters?: DashboardFilter[]; values?: FilterValues } = {}) => api.post<ReportResult>(`/analytics/reports/${id}/run`, o),
  dashboard: (api: OrgApi, id: string) => api.get<DashboardView>(`/analytics/dashboards/${id}`),
  widget: (api: OrgApi, id: string, wid: string, values: FilterValues) => api.post<WidgetRun>(`/analytics/dashboards/${id}/widgets/${wid}`, { values }),
  preview: (api: OrgApi, widget: Widget, filters: DashboardFilter[], values: FilterValues) => api.post<WidgetRun>("/analytics/widgets/preview", { widget, filters, values }),
  home: (api: OrgApi) => api.get<HomeDashboard>("/analytics/home"),
  scorecard: (api: OrgApi, q: { practice?: string; ids?: string[]; trend?: number } = {}) =>
    api.get<{ items: ScorecardItem[] }>("/analytics/scorecard", { practice: q.practice, ids: q.ids?.join(","), trend: q.trend }),
  hub: (api: OrgApi, id: string) => api.get<IndicatorHubView>(`/analytics/indicators/${id}/hub`),
  collect: (api: OrgApi, id: string) => api.post<{ scores: number; alerts: number }>(`/analytics/indicators/${id}/collect`),
  collectAll: (api: OrgApi) => api.post<{ done: boolean; scores: number; alerts: number; skipped: string[] }>("/analytics/collect"),
  checkIndicator: (api: OrgApi, body: { formula: string; parts: unknown[]; breakdowns?: string[]; grain?: string }) => api.post<{ problem: string | null; item: ScorecardItem | null }>("/analytics/indicators/check", body),
  ask: (api: OrgApi, question: string) => api.post<AskResult>("/analytics/ask", { question }),
  narrate: (api: OrgApi, body: { spec?: ReportSpec; report_id?: string; title?: string }) => api.post<NarrateResult>("/analytics/narrate", body),
  exportBundle: (api: OrgApi, body: { reports?: string[]; dashboards?: string[]; indicators?: string[] }) => api.post<AnalyticsBundle>("/analytics/export", body),
  importBundle: (api: OrgApi, bundle: unknown, folder?: string | null) => api.post<ImportResult>("/analytics/import", { bundle, folder }),
  send: (api: OrgApi, id: string) => api.post<{ outcomes: { user: string; status: string }[] }>(`/analytics/schedules/${id}/send`),
  certify: (api: OrgApi, table: string, id: string, certified: boolean) => api.post(`/analytics/certify`, { table, id, certified }),
  transfer: (api: OrgApi, table: string, id: string, owner_id: string) => api.post(`/analytics/transfer`, { table, id, owner_id }),
  copy: (api: OrgApi, table: "analytics_report" | "analytics_dashboard", id: string, name?: string) => api.post<{ row: { id: string } }>(`/analytics/copy`, { table, id, name }),
  canEdit: (api: OrgApi, table: string, id: string) => api.get<{ can_edit: boolean; can_admin: boolean }>(`/analytics/can-edit/${table}/${id}`),
  library: (api: OrgApi) => api.get<LibraryView>("/analytics/library"),
  seed: (api: OrgApi, force = false) => api.post<SeedResult>("/analytics/seed", { force }),
};

/** Download an Excel file of a definition (built on the server with the caller's access). */
export async function downloadXlsx(orgId: string, body: { spec: ReportSpec; title?: string; filters?: DashboardFilter[]; values?: FilterValues } | { report_id: string }): Promise<void> {
  const byId = "report_id" in body;
  const res = await fetch(byId ? `/api/o/${orgId}/analytics/reports/${body.report_id}/xlsx` : `/api/o/${orgId}/analytics/xlsx`, {
    method: byId ? "GET" : "POST",
    credentials: "same-origin",
    headers: byId ? undefined : { "content-type": "application/json" },
    body: byId ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `خطای ${res.status}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : "report.xlsx";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Save a bundle as a JSON file. */
export function saveJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".json") ? name : `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Data of the service portfolio screens (/service_portfolio/…): the status page and its public link, subscriptions,
// the owner's scorecard, portfolio reports, rationalization, catalogue health, technology risk, «my services», the
// service picker and affected services. Light on purpose: the module's index imports it.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type { CatalogueHealth, MyService, PortfolioReport, RationalizationRow, ServiceMeta, ServicePickerHit, ServiceScorecard, StatusPage } from "@shared/service_portfolio/api";

export type { CatalogueHealth, MyService, PortfolioReport, RationalizationRow, ServiceMeta, ServicePickerHit, ServiceScorecard, StatusPage };

export interface TechnologyRiskRow {
  id: string;
  name: string;
  product_version: string | null;
  status: string;
  eol_date: string | null;
  risk: string | null;
  cis: number;
  services: { id: string; name: string }[];
}

export const SPF_KEYS = {
  all: (org: string) => ["service_portfolio", org] as const,
  meta: (org: string) => ["service_portfolio", org, "meta"] as const,
  status: (org: string, days: number) => ["service_portfolio", org, "status", days] as const,
  mine: (org: string) => ["service_portfolio", org, "mine"] as const,
  scorecard: (org: string, id: string) => ["service_portfolio", org, "scorecard", id] as const,
  report: (org: string) => ["service_portfolio", org, "report"] as const,
  rationalization: (org: string) => ["service_portfolio", org, "rationalization"] as const,
  health: (org: string) => ["service_portfolio", org, "health"] as const,
  technology: (org: string) => ["service_portfolio", org, "technology"] as const,
  picker: (org: string, q: unknown) => ["service_portfolio", org, "picker", q] as const,
};
registerLiveQueries("service_portfolio");

export const spfApi = {
  meta: (api: OrgApi) => api.get<ServiceMeta>("/service_portfolio/meta"),
  status: (api: OrgApi, days = 90) => api.get<StatusPage>("/service_portfolio/status", { days: String(days) }),
  publish: (api: OrgApi, enabled: boolean, regenerate = false) => api.post<{ enabled: boolean; token: string | null }>("/service_portfolio/status/public", { enabled, regenerate }),
  refreshStatus: (api: OrgApi) => api.post<{ checked: number; changed: number }>("/service_portfolio/status/refresh"),
  subscribe: (api: OrgApi, id: string) => api.post<{ id: string; created: boolean }>(`/service_portfolio/services/${id}/subscribe`),
  unsubscribe: (api: OrgApi, id: string) => api.post<{ removed: number }>(`/service_portfolio/services/${id}/unsubscribe`),
  scorecard: (api: OrgApi, id: string) => api.get<ServiceScorecard>(`/service_portfolio/services/${id}/scorecard`),
  reviewed: (api: OrgApi, id: string) => api.post<{ id: string; last_reviewed_at: string }>(`/service_portfolio/services/${id}/review`),
  report: (api: OrgApi) => api.get<PortfolioReport>("/service_portfolio/report"),
  rationalization: (api: OrgApi) => api.get<{ rows: RationalizationRow[]; cost_visible: boolean; axis: "cost" | "load" }>("/service_portfolio/rationalization"),
  health: (api: OrgApi) => api.get<CatalogueHealth>("/service_portfolio/health"),
  technology: (api: OrgApi) => api.get<{ rows: TechnologyRiskRow[] }>("/service_portfolio/technology"),
  runScores: (api: OrgApi, day?: string) => api.post<{ scored: number; day: string }>("/service_portfolio/score/run", day ? { day } : {}),
  mine: (api: OrgApi) => api.get<{ services: MyService[] }>("/service_portfolio/mine"),
  picker: (api: OrgApi, q: { q?: string; kind?: "service" | "offering"; service?: string; ci?: string; limit?: number }) => api.get<{ hits: ServicePickerHit[] }>("/service_portfolio/picker", q as Record<string, string>),
  affected: (api: OrgApi, ciIds: string[]) => api.post<{ services: ServicePickerHit[]; restricted: number }>("/service_portfolio/affected", { ci_ids: ciIds }),
  seed: (api: OrgApi) => api.post<{ created: Record<string, number> }>("/service_portfolio/seed"),
};

/** The public status page's address for a key (web version). */
export const publicStatusUrl = (token: string) => `${window.location.origin}/api/v1/status/${token}`;

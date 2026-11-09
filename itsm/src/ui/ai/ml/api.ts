// Typed calls of the predictive AI, «پرسش تحلیلی», insights and the governance console (docs/spec/AI.md §13–16;
// server routes src/server/routes/ai-{ml,insights,governance}.ts). Light: imported by registrations, pages load lazily.
import type { AskReportResult, ClusterView, ForecastView, MlModelPatch, MlModelView, MlPrediction, MlRecordView } from "@shared/ai/ml";
import type { InsightsResult } from "@shared/ai/insights";
import type { DataPolicyRow, GovernanceFeedback, GovernanceOverview, GovernanceQuality, GovernanceUsage, GuardEntry, ModelCard, OversightView } from "@shared/ai/governance";
import type { ReportSpec } from "@shared/analytics/types";
import type { OrgApi } from "../../lib/api";

export const ML_KEYS = {
  record: (org: string, table: string, id: string) => ["ai-ml", org, "record", table, id] as const,
  forecast: (org: string, q: unknown) => ["ai-ml", org, "forecast", q] as const,
  clusters: (org: string, table: string) => ["ai-ml", org, "clusters", table] as const,
  models: (org: string) => ["ai-ml", org, "models"] as const,
  insights: (org: string, period: string) => ["ai-insights", org, period] as const,
  gov: (org: string, part: string, q?: unknown) => ["ai-gov", org, part, q ?? null] as const,
};

export const mlApi = {
  record: (api: OrgApi, table: string, id: string) => api.get<MlRecordView>(`/ai/ml/records/${table}/${id}`),
  draft: (api: OrgApi, table: string, values: Record<string, unknown>) => api.post<{ predictions: MlPrediction[] }>("/ai/ml/predict", { table, values }),
  apply: (api: OrgApi, id: string, value?: string | null, version?: number) => api.post<{ ok: true }>(`/ai/ml/predictions/${id}/apply`, { value, version }),
  dismiss: (api: OrgApi, id: string) => api.post<{ ok: true }>(`/ai/ml/predictions/${id}/dismiss`, {}),
  forecast: (api: OrgApi, q: { table: string; by?: string; value?: string; grain?: "day" | "week"; horizon?: number }) =>
    api.get<ForecastView>("/ai/ml/forecast", Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>),
  clusters: (api: OrgApi, table: string) => api.get<{ clusters: ClusterView[] }>("/ai/ml/clusters", { table }),
  dismissCluster: (api: OrgApi, id: string, table: string) => api.post<{ ok: true }>(`/ai/ml/clusters/${id}/dismiss`, { table }),
  clusterProblem: (api: OrgApi, id: string, table: string, title: string) => api.post<{ problem_id: string; number: string | null; linked: number }>(`/ai/ml/clusters/${id}/problem`, { table, title }),
  models: (api: OrgApi) => api.get<{ models: MlModelView[] }>("/ai/ml/models"),
  patchModel: (api: OrgApi, key: string, patch: MlModelPatch) => api.patch<{ ok: true }>(`/ai/ml/models/${encodeURIComponent(key)}`, patch),
  trainModel: (api: OrgApi, key: string) => api.post<{ queued: boolean }>(`/ai/ml/models/${encodeURIComponent(key)}/train`, {}),
  ask: (api: OrgApi, question: string) => api.post<AskReportResult>("/ai/ask-report", { question }),
  saveAsk: (api: OrgApi, spec: ReportSpec, name: string, question?: string) => api.post<{ id: string; path: string }>("/ai/ask-report/save", { spec, name, question }),
};

export const insightsApi = {
  list: (api: OrgApi, period?: string) => api.get<InsightsResult>("/ai/insights", period ? { period } : undefined),
  narrate: (api: OrgApi, id: string) => api.post<{ text: string; ai: boolean }>(`/ai/insights/${id}/narrate`, {}),
  run: (api: OrgApi, period: "daily" | "weekly") => api.post<{ insights: number }>("/ai/insights/run", { period }),
  digest: (api: OrgApi, period: "daily" | "weekly") => api.post<{ sent: number }>("/ai/insights/digest", { period }),
};

export const govApi = {
  overview: (api: OrgApi) => api.get<GovernanceOverview>("/ai/governance/overview"),
  usage: (api: OrgApi, days: number) => api.get<GovernanceUsage>("/ai/governance/usage", { days: String(days) }),
  quality: (api: OrgApi) => api.get<GovernanceQuality>("/ai/governance/quality"),
  feedback: (api: OrgApi) => api.get<GovernanceFeedback>("/ai/governance/feedback"),
  guard: (api: OrgApi, kind?: string) => api.get<{ entries: GuardEntry[] }>("/ai/governance/guard-log", kind ? { kind } : undefined),
  policies: (api: OrgApi) => api.get<{ tables: DataPolicyRow[] }>("/ai/governance/data-policies"),
  savePolicy: (api: OrgApi, table: string, p: { use: string; pii: string; note?: string | null }) => api.put<{ ok: true }>(`/ai/governance/data-policies/${table}`, p),
  oversight: (api: OrgApi) => api.get<OversightView>("/ai/governance/oversight"),
  cards: (api: OrgApi) => api.get<{ cards: ModelCard[] }>("/ai/governance/model-cards"),
  exportJson: (api: OrgApi, days: number) => api.get<Record<string, unknown>>("/ai/governance/export", { days: String(days) }),
};

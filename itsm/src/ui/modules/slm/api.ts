// Data of the service level management screens (src/server/routes/slm.ts): typed calls and query keys.
import type { Agreement360, AtRiskItem, CsiSuggestion, Recommendation, ReviewPack, SlmMeta, SlmOverview, XlaView } from "@shared/slm/api";
import type { OrgApi } from "../../lib/api";

export const SLM_KEYS = {
  all: ["slm"] as const,
  meta: (org: string) => ["slm", org, "meta"] as const,
  overview: (org: string) => ["slm", org, "overview"] as const,
  a360: (org: string, id: string) => ["slm", org, "360", id] as const,
  doc: (org: string, id: string, customer: boolean) => ["slm", org, "doc", id, customer] as const,
  pack: (org: string, id: string) => ["slm", org, "pack", id] as const,
  recommend: (org: string, id: string, p: number) => ["slm", org, "recommend", id, p] as const,
  xla: (org: string, table: string, id: string) => ["slm", org, "xla", table, id] as const,
  atRisk: (org: string, scope: string) => ["slm", org, "at-risk", scope] as const,
};

export const slmApi = {
  meta: (api: OrgApi) => api.get<SlmMeta>("/slm/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>("/slm/seed", {}),
  overview: (api: OrgApi) => api.get<SlmOverview>("/slm/overview"),
  atRisk: (api: OrgApi, scope: "mine" | "groups", min = 50) => api.get<{ items: AtRiskItem[] }>("/slm/at-risk", { scope, min, limit: 100 }),
  a360: (api: OrgApi, id: string) => api.get<Agreement360>(`/slm/agreements/${id}/360`),
  measure: (api: OrgApi, id: string) => api.post<{ overall: number | null; status: string; period: string | null }>(`/slm/agreements/${id}/measure`),
  document: (api: OrgApi, id: string, customer = false) => api.get<{ markdown: string; customer_view: boolean }>(`/slm/agreements/${id}/document`, customer ? { customer: "1" } : {}),
  draftDocument: (api: OrgApi, id: string) => api.post<{ markdown: string; ai: boolean }>(`/slm/agreements/${id}/document/draft`),
  accept: (api: OrgApi, id: string, note?: string) => api.post<{ accepted_at: string; accepted_by: string }>(`/slm/agreements/${id}/accept`, { note: note || null }),
  linkCommitments: (api: OrgApi, id: string) => api.post<{ added: number }>(`/slm/agreements/${id}/link-commitments`),
  fromTemplate: (api: OrgApi, input: Record<string, unknown>) => api.post<{ id: string; number: string | null }>("/slm/agreements/from-template", input),
  manual: (api: OrgApi, targetId: string, value: number) => api.post<{ ok: true }>(`/slm/targets/${targetId}/manual`, { value }),
  recommend: (api: OrgApi, targetId: string, p = 85) => api.get<Recommendation>(`/slm/targets/${targetId}/recommend`, { p }),
  simulate: (api: OrgApi, targetId: string, hours: Record<string, number | null>, p = 85) => api.post<Recommendation>(`/slm/targets/${targetId}/simulate`, { hours, p }),
  pack: (api: OrgApi, id: string) => api.get<{ pack: ReviewPack; stored: boolean }>(`/slm/reviews/${id}/pack`),
  buildPack: (api: OrgApi, id: string) => api.post<{ pack: ReviewPack | null }>(`/slm/reviews/${id}/pack`),
  narrative: (api: OrgApi, id: string, save: boolean) => api.post<{ text: string; ai: boolean }>(`/slm/reviews/${id}/narrative`, { save }),
  suggest: (api: OrgApi, id: string) => api.post<{ items: Pick<CsiSuggestion, "title" | "description" | "value" | "effort">[]; ai: boolean }>(`/slm/reviews/${id}/suggest`),
  actions: (api: OrgApi, id: string, items: { title: string; description?: string | null; value?: number; effort?: number; ai?: boolean }[]) => api.post<{ created: string[] }>(`/slm/reviews/${id}/actions`, { items }),
  xla: (api: OrgApi, table: string, id: string) => api.get<{ xla: XlaView | null }>(`/slm/records/${table}/${id}/xla`),
  rescore: (api: OrgApi, table: string, id: string) => api.post<{ xla: XlaView | null }>(`/slm/records/${table}/${id}/xla`),
};

// Data of the customer service screens (src/server/routes/csm.ts): typed calls and query keys.
import type { OrgApi } from "../../lib/api";
import type { Row } from "./model";

export interface Customer360 {
  account: Row;
  display: Record<string, string>;
  contacts: Row[];
  open_cases: Row[];
  recent_cases: Row[];
  entitlements: Row[];
  install_base: Row[];
  contracts: Row[];
  escalations: Row[];
  reviews: Row[];
  health: { day: string; score: number | null; status: string }[];
  csat: number | null;
  csat_n: number;
}

export interface CsmDashboard {
  open: { key: string; label: string; count: number }[];
  by_type: { key: string; label: string; count: number }[];
  by_channel: { key: string; label: string; count: number }[];
  by_product: { key: string; label: string; count: number }[];
  by_account: { key: string; label: string; count: number }[];
  created_30d: number;
  resolved_30d: number;
  acceptance: number | null;
  complaints_30d: number;
  breached_open: number;
  csat: number | null;
}

export const CSM_KEYS = {
  all: ["csm"] as const,
  meta: (org: string) => ["csm", org, "meta"] as const,
  c360: (org: string, id: string) => ["csm", org, "360", id] as const,
  dashboard: (org: string) => ["csm", org, "dashboard"] as const,
};

export const csmApi = {
  meta: (api: OrgApi) => api.get<{ seeded: boolean; manages: boolean; config: { auto_close_days: number; proactive_on_major: boolean } }>("/csm/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>("/csm/seed", {}),
  c360: (api: OrgApi, id: string) => api.get<Customer360>(`/csm/accounts/${id}/360`),
  raise: (api: OrgApi, id: string, table: "incident" | "problem", short_description?: string | null) => api.post<{ table: string; id: string; number: string | null }>(`/csm/cases/${id}/raise`, { table, short_description }),
  broadcast: (api: OrgApi, id: string, body: string) => api.post<{ sent: number }>(`/csm/cases/${id}/broadcast`, { body }),
  next: (api: OrgApi) => api.post<{ case: Row | null }>("/csm/next", {}),
  proactive: (api: OrgApi, incident: string) => api.post<{ created: number; accounts: number }>(`/csm/incidents/${incident}/proactive`, {}),
  reviewPack: (api: OrgApi, id: string) => api.post<{ pack: Row; narrative: string }>(`/csm/reviews/${id}/pack`, {}),
  sendNotice: (api: OrgApi, id: string) => api.post<{ sent: number; evidence: Row }>(`/csm/notices/${id}/send`, {}),
  refreshHealth: (api: OrgApi) => api.post<{ accounts: number }>("/csm/health/refresh", {}),
  dashboard: (api: OrgApi) => api.get<CsmDashboard>("/csm/dashboard"),
};

// Data of the supplier and contract screens (/supplier/…) and of the financial screens (/financial/…): typed calls and
// query keys. Light on purpose: the modules' index files import it; the pages load with their routes.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type { BvaPayload, ExtractResult, FinancialMeta, Renewals, ServiceCost, SpendPayload, Statement, Supplier360, SupplierMeta } from "@shared/financial/api";
import type { AiText } from "@shared/itam/api";

export type { BvaPayload, ExtractResult, FinancialMeta, Renewals, ServiceCost, SpendPayload, Statement, Supplier360, SupplierMeta, AiText };

export const SUPPLIER_KEYS = {
  meta: (org: string) => ["supplier", org, "meta"] as const,
  renewals: (org: string, months: number) => ["supplier", org, "renewals", months] as const,
  s360: (org: string, id: string) => ["supplier", org, "360", id] as const,
};
export const FINANCIAL_KEYS = {
  meta: (org: string) => ["financial", org, "meta"] as const,
  bva: (org: string, q: unknown) => ["financial", org, "bva", q] as const,
  spend: (org: string, year: number) => ["financial", org, "spend", year] as const,
  statement: (org: string, id: string) => ["financial", org, "statement", id] as const,
  serviceCost: (org: string, id: string, year: number) => ["financial", org, "service", id, year] as const,
};
registerLiveQueries("supplier", "financial");

export const supplierApi = {
  meta: (api: OrgApi) => api.get<SupplierMeta>("/supplier/meta"),
  renewals: (api: OrgApi, months: number) => api.get<Renewals>("/supplier/renewals", { months: String(months) }),
  renew: (api: OrgApi, id: string, input: { start_date?: string | null; end_date?: string | null; value?: string | null } = {}) => api.post<{ id: string; number: string | null }>(`/supplier/contracts/${id}/renew`, input),
  extract: (api: OrgApi, id: string) => api.post<ExtractResult>(`/supplier/contracts/${id}/extract`),
  obligations: (api: OrgApi, id: string, items: { title: string; party: "supplier" | "us"; due_date?: string | null; recurrence?: string }[]) => api.post<{ created: string[] }>(`/supplier/contracts/${id}/obligations`, { items }),
  s360: (api: OrgApi, id: string) => api.get<Supplier360>(`/supplier/suppliers/${id}/360`),
  scorecards: (api: OrgApi) => api.post<{ suppliers: number }>("/supplier/scorecards/run"),
};

export const financialApi = {
  meta: (api: OrgApi) => api.get<FinancialMeta>("/financial/meta"),
  bva: (api: OrgApi, q: { year: number; from?: number; to?: number; cost_center?: string | null }) =>
    api.get<BvaPayload>("/financial/bva", Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]))),
  narrative: (api: OrgApi, year: number, costCenterId: string | null) => api.post<AiText>("/financial/bva/narrative", { year, cost_center_id: costCenterId }),
  spend: (api: OrgApi, year: number) => api.get<SpendPayload>("/financial/spend", { year: String(year) }),
  capture: (api: OrgApi, period?: string | null) => api.post<{ period: string; created: number; by_source: Record<string, number> }>("/financial/capture", { period: period ?? null }),
  reverse: (api: OrgApi, id: string, reason: string) => api.post<{ id: string; number: string | null }>(`/financial/entries/${id}/reverse`, { reason }),
  calculate: (api: OrgApi, id: string) => api.post<{ total_pool: string; total_allocated: string; results: number }>(`/financial/allocation-runs/${id}/calculate`),
  post: (api: OrgApi, id: string) => api.post<{ entries: number }>(`/financial/allocation-runs/${id}/post`),
  statement: (api: OrgApi, id: string) => api.get<Statement>(`/financial/allocation-runs/${id}/statement`),
  serviceCost: (api: OrgApi, id: string, year: number) => api.get<ServiceCost>(`/financial/services/${id}/cost`, { year: String(year) }),
  year: (api: OrgApi, year: number) => api.post<{ id: string; year: number }>("/financial/years", { year }),
};

// Data of the IT asset management screens: the module's operations (/itam/…) as typed calls and query keys, and the
// supplier and financial modules' calls the asset screens use. Light on purpose: the module's index imports it; the
// pages load with their routes.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type {
  AiText, Asset360, CheckinInput, CheckoutInput, Compliance, ItamDashboard, ItamMeta, LabelData, MyAssets, ReceiveInput, ReportKind, RequestItemAssets, ScanResult, StockDashboard,
} from "@shared/itam/api";

export type { AiText, Asset360, Compliance, ItamDashboard, ItamMeta, LabelData, MyAssets, RequestItemAssets, ScanResult, StockDashboard };

export const ITAM_KEYS = {
  all: (org: string) => ["itam", org] as const,
  meta: (org: string) => ["itam", org, "meta"] as const,
  dashboard: (org: string) => ["itam", org, "dashboard"] as const,
  mine: (org: string) => ["itam", org, "mine"] as const,
  a360: (org: string, id: string) => ["itam", org, "360", id] as const,
  stock: (org: string) => ["itam", org, "stock"] as const,
  compliance: (org: string) => ["itam", org, "compliance"] as const,
  labels: (org: string, q: string) => ["itam", org, "labels", q] as const,
  item: (org: string, id: string) => ["itam", org, "item", id] as const,
};
registerLiveQueries("itam");

type Row = Record<string, unknown>;

export const itamApi = {
  meta: (api: OrgApi) => api.get<ItamMeta>("/itam/meta"),
  seed: (api: OrgApi) => api.post<{ created: Record<string, number> }>("/itam/seed"),
  dashboard: (api: OrgApi) => api.get<ItamDashboard>("/itam/dashboard"),
  myAssets: (api: OrgApi) => api.get<MyAssets>("/itam/my-assets"),
  report: (api: OrgApi, id: string, kind: ReportKind, note: string | null) => api.post<{ table: string; id: string; number: string | null }>(`/itam/assets/${id}/report`, { kind, note }),
  decideAck: (api: OrgApi, id: string, input: { decision: "accept" | "decline"; signature_name?: string | null; note?: string | null }) => api.post<{ ack: Row }>(`/itam/acks/${id}/decide`, input),
  checkout: (api: OrgApi, id: string, input: CheckoutInput) => api.post<{ asset: Row }>(`/itam/assets/${id}/checkout`, input),
  checkin: (api: OrgApi, id: string, input: CheckinInput) => api.post<{ asset: Row }>(`/itam/assets/${id}/checkin`, input),
  a360: (api: OrgApi, id: string) => api.get<Asset360>(`/itam/assets/${id}/360`),
  summary: (api: OrgApi, id: string) => api.post<AiText>(`/itam/assets/${id}/summary`),
  linkCi: (api: OrgApi, id: string) => api.post<{ ci_id: string | null; message: string | null }>(`/itam/assets/${id}/link-ci`),
  stock: (api: OrgApi) => api.get<StockDashboard>("/itam/stock"),
  stockRequisition: (api: OrgApi, ruleIds: string[]) => api.post<{ id: string; number: string | null }>("/itam/stock/requisition", { rule_ids: ruleIds }),
  stockCheck: (api: OrgApi) => api.post<{ checked: number; alerts: number; requisitions: number }>("/itam/stock/check"),
  receive: (api: OrgApi, poId: string, input: ReceiveInput) => api.post<{ receipt_id: string; number: string | null; assets: number }>(`/itam/po/${poId}/receive`, input),
  order: (api: OrgApi, requisitionId: string) => api.post<{ orders: { id: string; number: string | null }[] }>(`/itam/requisitions/${requisitionId}/order`),
  scan: (api: OrgApi, auditId: string, code: string) => api.post<ScanResult>(`/itam/audits/${auditId}/scan`, { code }),
  compliance: (api: OrgApi) => api.get<Compliance>("/itam/compliance"),
  complianceRun: (api: OrgApi) => api.post<{ run_id: string; products: number; under_licensed: number }>("/itam/compliance/run"),
  softwareSync: (api: OrgApi) => api.post<{ sync: { seen: number; created: number; updated: number; removed: number; matched: number } }>("/itam/software/sync"),
  narrative: (api: OrgApi) => api.post<AiText>("/itam/compliance/narrative"),
  labels: (api: OrgApi, q: Record<string, string>) => api.get<LabelData>("/itam/labels", q),
  requestItem: (api: OrgApi, id: string) => api.get<RequestItemAssets>(`/itam/request-items/${id}/assets`),
  assignToItem: (api: OrgApi, id: string, assetId: string) => api.post<{ asset: Row }>(`/itam/request-items/${id}/assign`, { asset_id: assetId }),
  leaver: (api: OrgApi, userId: string, dueDate: string | null) => api.post<{ assets: number; allocations: number; accounts: number }>(`/itam/leaver/${userId}`, { due_date: dueDate }),
  discovered: (api: OrgApi) => api.post<{ created: number; models: number; remaining: number }>("/itam/discovered"),
};

/** The organisation's money display (Rials or Tomans, from the financial settings); Rials when unknown. */
export const moneyUnitOf = (api: OrgApi) => api.get<{ currency_display: "rial" | "toman" }>("/financial/meta").then((m) => m.currency_display).catch(() => "rial" as const);

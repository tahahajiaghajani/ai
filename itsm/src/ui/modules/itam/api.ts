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

// ----- bank: branches, transfers, the ATM fleet, the asset register, reconciliation, attestation, custody -----

export interface BranchRow {
  branch_id: string | null;
  name: string;
  code: string | null;
  region: string | null;
  total: number;
  by_state: Record<string, number>;
  value: string | null;
  fleet: number;
  fleet_down: number;
  missing: number;
  transfers_out: number;
  transfers_in: number;
  in_transit: number;
  last_audit: { id: string; number: string | null; state: string; completed_at: string | null; missing: number } | null;
  open_discrepancies: number;
  attestation: { id: string; number: string | null; state: string; period: string | null; due_date: string | null; overdue: boolean; exceptions: number } | null;
}
export interface TransferView { id: string; number: string | null; title: string; state: string; reason: string; from: string | null; to: string | null; items: number; dispatched_at: string | null; can_receive: boolean }
export interface TransferItemView { id: string; label: string | null; asset_id: string; condition_out: string | null; result: string; condition_in: string | null; note: string | null }
export interface Risk { score: number; level: "low" | "medium" | "high"; reasons: string[] }
export interface FleetDevice {
  id: string; number: string | null; asset_tag: string | null; name: string | null; category: string; terminal_id: string | null; branch_id: string | null; branch: string | null; region: string | null;
  site_type: string | null; device_status: string; device_status_at: string | null; os_name: string | null; os_eos_date: string | null; eos: "past" | "soon" | "ok" | "unknown"; firmware_version: string | null;
  model: string | null; contract: string | null; availability: string; down_minutes: number; penalty: { breaches: number; late_hours: number; amount: string | null } | null; open_work_orders: number;
  next_pm: string | null; ci_id: string | null; risk: Risk;
}
export interface Fleet {
  days: number; total: number; status: Record<string, number>; eos: { past: number; soon: number; ok: number; unknown: number }; availability: string;
  regions: { id: string; name: string; devices: number; availability: string }[];
  contracts: { id: string; name: string; number: string | null; devices: number; availability: string; target: string | null; below_target: boolean; breaches: number; late_hours: number; penalty: string | null }[];
  devices: FleetDevice[]; financial: boolean; can_manage: boolean; can_plan: boolean;
}
export interface RegisterRow {
  id: string; number: string | null; asset_tag: string | null; name: string | null; category: string | null; model: string | null; serial_number: string | null; branch: string | null; branch_code: string | null;
  state: string; in_service: string | null; end: string | null; method: string; life_months: number | null; cost: string; opening_cost: string; additions: string; disposals: string;
  opening_accumulated: string; charge: string; closing_accumulated: string; closing_book: string; months_charged: number;
  /** reconciliation: the year's depreciation in the cost ledger and the register's charge minus it */
  ledger?: string; difference?: string;
}
export interface AssetRegister {
  fiscal_year: number; from: string; to: string; rows: RegisterRow[]; totals: Record<string, string | null>; reconciled: boolean; mismatches: number;
  branches: { branch: string; count: number; cost: string; charge: string; book: string }[];
}
export interface WipeCertificate {
  certificate_no: string; issued_at: string; hash: string; verified: boolean; method: string; tool: string | null; sanitized_at: string | null; sanitized_by: string | null; witness: string | null;
  asset: { number: string | null; tag: string | null; name: string | null; serial: string | null; model: string | null; branch: string | null } | null;
  order: { number: string | null; title: string; state: string } | null; org: string;
}

export const BANK_KEYS = {
  branches: (org: string) => ["itam", org, "branches"] as const,
  inbox: (org: string) => ["itam", org, "transfers", "inbox"] as const,
  transfer: (org: string, id: string) => ["itam", org, "transfers", id] as const,
  fleet: (org: string, days: number) => ["itam", org, "fleet", days] as const,
  register: (org: string, q: string) => ["itam", org, "register", q] as const,
  custody: (org: string, id: string) => ["itam", org, "custody", id] as const,
  attestation: (org: string, id: string) => ["itam", org, "attestation", id] as const,
  audit: (org: string, id: string) => ["itam", org, "audit-items", id] as const,
};

export const bankApi = {
  branches: (api: OrgApi) => api.get<{ branches: BranchRow[]; financial: boolean; can_transfer: boolean; total: number }>("/itam/branches"),
  inbox: (api: OrgApi) => api.get<{ incoming: TransferView[]; all: TransferView[] }>("/itam/transfers/inbox"),
  transferItems: (api: OrgApi, id: string) => api.get<{ transfer: { id: string; number: string | null; title: string; state: string; can_receive: boolean }; items: TransferItemView[] }>(`/itam/transfers/${id}/items`),
  receive: (api: OrgApi, id: string, body: { items: { id: string; result: "received" | "damaged" | "missing"; condition_in?: string | null; note?: string | null }[]; note?: string | null }) =>
    api.post<{ state: string; received: number; discrepancies: number }>(`/itam/transfers/${id}/receive`, body),
  fleet: (api: OrgApi, days: number) => api.get<Fleet>("/itam/fleet", { days }),
  setStatus: (api: OrgApi, id: string, body: { status: string; reason?: string | null; incident?: boolean }) => api.post<{ asset: Row; incident: { id: string; number: string | null } | null }>(`/itam/fleet/${id}/status`, body),
  pmPlans: (api: OrgApi, body: { every_n?: number; interval_unit?: string; group_id?: string | null }) => api.post<{ created: number; skipped: number }>("/itam/fleet/pm-plans", body),
  risk: (api: OrgApi, id: string) => api.post<AiText>(`/itam/fleet/${id}/risk`),
  register: (api: OrgApi, q: { fy: number; branch_id?: string; category?: string }) => api.get<AssetRegister>("/itam/register", q),
  resolve: (api: OrgApi, itemId: string, body: { resolution: string; note?: string | null; model_id?: string | null }) =>
    api.post<{ item: Row; open: number; asset_id: string | null; transfer_id: string | null }>(`/itam/audit-items/${itemId}/resolve`, body),
  attestationAssets: (api: OrgApi, id: string) => api.get<{ attestation: Row; assets: Row[] }>(`/itam/attestations/${id}/assets`),
  attest: (api: OrgApi, id: string, body: { signed_name: string; exceptions: { asset_id: string; issue: string; note?: string | null }[]; note?: string | null }) =>
    api.post<{ state: string; exceptions: number }>(`/itam/attestations/${id}/attest`, body),
  openAttestations: (api: OrgApi) => api.post<{ opened: number; overdue: number }>("/itam/attestations/open"),
  custody: (api: OrgApi, id: string) => api.get<{ rows: Row[]; verified: { rows: number; ok: boolean; broken_at: number | null } }>(`/itam/assets/${id}/custody`),
  certificate: (api: OrgApi, itemId: string) => api.get<WipeCertificate>(`/itam/disposal-items/${itemId}/certificate`),
};

/** The organisation's money display (Rials or Tomans, from the financial settings); Rials when unknown. */
export const moneyUnitOf = (api: OrgApi) => api.get<{ currency_display: "rial" | "toman" }>("/financial/meta").then((m) => m.currency_display).catch(() => "rial" as const);

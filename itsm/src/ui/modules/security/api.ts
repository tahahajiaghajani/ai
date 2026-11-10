// Data of the security screens: the module's operations (/security/…) as typed calls and React Query keys. Light on
// purpose: the module's index imports it; the components load with their pages.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type {
  AccessRiskFlag, HardeningReport, MyPolicy, MyReport, PiiFieldFinding, PrivilegedReview, RiskHeatmap, ScanImportResult, SecurityDashboard, SoaRow, SocWorkspace, VerificationState,
} from "@shared/security/api";

export type { AccessRiskFlag, HardeningReport, MyPolicy, MyReport, PiiFieldFinding, PrivilegedReview, RiskHeatmap, ScanImportResult, SecurityDashboard, SoaRow, SocWorkspace, VerificationState };

export const SEC_KEYS = {
  all: (org: string) => ["security", org] as const,
  meta: (org: string) => ["security", org, "meta"] as const,
  soc: (org: string) => ["security", org, "soc"] as const,
  dashboard: (org: string) => ["security", org, "dashboard"] as const,
  facts: (org: string, id: string) => ["security", org, "facts", id] as const,
  regimes: (org: string, id: string) => ["security", org, "regimes", id] as const,
  promoted: (org: string, id: string) => ["security", org, "promoted", id] as const,
  myReports: (org: string) => ["security", org, "my-reports"] as const,
  myPolicies: (org: string) => ["security", org, "my-policies"] as const,
  soa: (org: string, fw: string | null) => ["security", org, "soa", fw ?? ""] as const,
  heatmap: (org: string) => ["security", org, "heatmap"] as const,
  crosswalk: (org: string, id: string) => ["security", org, "crosswalk", id] as const,
  campaign: (org: string, id: string) => ["security", org, "campaign", id] as const,
  coverage: (org: string) => ["security", org, "coverage"] as const,
  review: (org: string, what: string) => ["security", org, "review", what] as const,
  pii: (org: string, table: string, id: string) => ["security", org, "pii", table, id] as const,
};
registerLiveQueries("security");

export interface SecurityMeta {
  ai: string[];
  settings: { vuln_sla: Record<string, number>; ai_max_classification: string; seeded: boolean };
  can: { ops: boolean; vuln: boolean; compliance: boolean; risk: boolean; manage_security: boolean; manage_compliance: boolean; manage_risk: boolean; review: boolean };
}

export interface IncidentFacts {
  times: { detect: number | null; contain: number | null; recover: number | null };
  open_tasks: number;
  observables: { id: string; type: string; value: string; verdict: string; is_ioc: boolean; sightings: number }[];
  clocks: { id: string; number: string | null; state: string; next_stage: string | null; next_due_at: string | null; overdue: boolean; deadlines: { stage: string; label: string; due_at: string; submitted_at: string | null }[] }[];
}

export interface Regime {
  id: string;
  name: string;
  authority: string | null;
  personal_data: boolean;
  placeholder: boolean;
  stages: { key: string; label: string; hours: number }[];
}

export const securityApi = {
  meta: (api: OrgApi) => api.get<SecurityMeta>("/security/meta"),
  seed: (api: OrgApi) => api.post("/security/seed", {}),
  soc: (api: OrgApi) => api.get<SocWorkspace>("/security/soc"),
  handover: (api: OrgApi, hours = 12) => api.get<{ text: string }>("/security/handover", { hours }),
  dashboard: (api: OrgApi) => api.get<SecurityDashboard>("/security/dashboard"),
  facts: (api: OrgApi, id: string) => api.get<IncidentFacts>(`/security/incidents/${id}/facts`),
  regimes: (api: OrgApi, id: string) => api.get<{ regimes: Regime[] }>(`/security/incidents/${id}/regimes`),
  playbook: (api: OrgApi, id: string, playbook_id: string) => api.post<{ tasks: number }>(`/security/incidents/${id}/playbook`, { playbook_id }),
  addObservables: (api: OrgApi, id: string, values: string[], opts: { is_ioc?: boolean; verdict?: string } = {}) => api.post<{ added: number }>(`/security/incidents/${id}/observables`, { values, ...opts }),
  extractObservables: (api: OrgApi, id: string) => api.post<{ added: number }>(`/security/incidents/${id}/observables/extract`, {}),
  startClock: (api: OrgApi, id: string, regime_id: string, aware_at?: string | null) => api.post(`/security/incidents/${id}/clocks`, { regime_id, aware_at: aware_at ?? null }),
  submitStage: (api: OrgApi, clockId: string, stage: string, reference?: string | null) => api.post(`/security/clocks/${clockId}/submit`, { stage, reference: reference ?? null }),
  enrich: (api: OrgApi, id: string) => api.post(`/security/observables/${id}/enrich`, {}),
  transfer: (api: OrgApi, id: string, to: string, location?: string | null, note?: string | null) => api.post(`/security/evidence/${id}/transfer`, { to, location: location ?? null, note: note ?? null }),
  promote: (api: OrgApi, incidentId: string) => api.post<{ id: string; number: string | null; created: boolean }>(`/security/promote/${incidentId}`, {}),
  promoted: (api: OrgApi, incidentId: string) => api.get<{ sir: { id: string; number: string | null } | null; can_promote: boolean }>(`/security/promoted/${incidentId}`),
  reportPhishing: (api: OrgApi, input: { subject: string; sender?: string; body?: string; headers?: string }) => api.post<{ receipt: string | null; grouped: boolean }>("/security/phishing", input),
  myReports: (api: OrgApi) => api.get<{ reports: MyReport[] }>("/security/my-reports"),
  importScan: (api: OrgApi, input: { name: string; content: string; scanner?: string | null; format?: string | null; dry_run?: boolean }) => api.post<ScanImportResult>("/security/scans/import", input),
  groupRemediations: (api: OrgApi, basis: "solution" | "owner", item_ids?: string[]) => api.post<{ groups: number; items: number }>("/security/remediations/group", { basis, item_ids }),
  remediationChange: (api: OrgApi, id: string) => api.post<{ change_id: string; number: string | null }>(`/security/remediations/${id}/change`, {}),
  coverage: (api: OrgApi) => api.get<{ in_scope: number; scanned_7: number; scanned_30: number; unscanned: { id: string; number: string | null; name: string }[] }>("/security/coverage"),
  soa: (api: OrgApi, framework?: string | null) => api.get<{ framework: { id: string; name: string; compliance_pct: string | null } | null; rows: SoaRow[]; display: Record<string, string> }>("/security/soa", framework ? { framework } : undefined),
  approveSoa: (api: OrgApi, ids: string[]) => api.post<{ approved: number }>("/security/soa/approve", { ids }),
  crosswalk: (api: OrgApi, id: string) => api.get<{ frameworks: { framework_id: string; framework: string; requirements: { id: string; code: string; title: string; compliance: string }[] }[] }>(`/security/controls/${id}/crosswalk`),
  measure: (api: OrgApi) => api.post<{ measured: number; failing: number; issues: number }>("/security/indicators/measure", {}),
  myPolicies: (api: OrgApi) => api.get<{ policies: MyPolicy[] }>("/security/policies/mine"),
  acknowledge: (api: OrgApi, campaignId: string) => api.post(`/security/policies/campaigns/${campaignId}/ack`, {}),
  campaignStatus: (api: OrgApi, id: string) => api.get<{ audience: number; acknowledged: number; rate: number | null; pending: string[]; display: Record<string, string> }>(`/security/policies/campaigns/${id}/status`),
  heatmap: (api: OrgApi) => api.get<RiskHeatmap>("/security/risks/heatmap"),
  accessRisk: (api: OrgApi) => api.get<{ flags: AccessRiskFlag[]; members: number; privileged: number }>("/security/access-risk"),
  privileged: (api: OrgApi, days: number) => api.get<PrivilegedReview>("/security/privileged", { days }),
  hardening: (api: OrgApi) => api.get<HardeningReport>("/security/hardening"),
  startVerify: (api: OrgApi, input: { table: string; id: string; user_id: string; channel?: string }) => api.post<VerificationState>("/security/verify", input),
  checkVerify: (api: OrgApi, id: string, code: string) => api.post<VerificationState>(`/security/verify/${id}/check`, { code }),
  pii: (api: OrgApi, table: string, id: string) => api.get<{ fields: PiiFieldFinding[] }>(`/security/pii/${table}/${id}`),
  redact: (api: OrgApi, table: string, id: string, fields: string[]) => api.post<{ fields: string[]; redacted: number }>(`/security/pii/${table}/${id}/redact`, { fields }),
  policyAsk: (api: OrgApi, text: string) => api.post<{ text: string | null; citations: { n: number; table: string; id: string; title: string }[]; fallback?: boolean; label?: string }>("/ai/skills/security.policy_qa/run", { text }),
};

/** «۲ ساعت و ۳۰ دقیقه» from seconds. */
export function durationFa(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  const fa = (n: number) => n.toLocaleString("fa-IR");
  if (h >= 48) return `${fa(Math.round(h / 24))} روز`;
  if (!h) return `${fa(m)} دقیقه`;
  return m ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : `${fa(h)} ساعت`;
}

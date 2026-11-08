// Data of the change screens (src/server/routes/change.ts): typed calls, query keys and a refresh helper. Light on
// purpose: the module's index imports it; the components live in lazily loaded pages.
import { useQueryClient } from "@tanstack/react-query";
import type { OrgApi } from "../../lib/api";
import { useOrg } from "../../lib/org";
import type { RecordRow } from "../../records/model/types";
import type { QuestionView, Row, Votes, WindowOcc } from "./model";

export const CHANGE_KEYS = {
  all: ["change"] as const,
  meta: (org: string) => ["change", org, "meta"] as const,
  calendar: (org: string, q: Record<string, unknown>) => ["change", org, "calendar", q] as const,
  record: (org: string, id: string, what: string, extra?: unknown) => ["change", org, "record", id, what, extra ?? null] as const,
  workbench: (org: string, meeting: string | null) => ["change", org, "workbench", meeting] as const,
  catalog: (org: string, q: string) => ["change", org, "catalog", q] as const,
  dashboard: (org: string, days: number) => ["change", org, "dashboard", days] as const,
};

export interface ChangeMeta {
  ai: string[];
  seeded: boolean;
  config: { risk_moderate_from: number; risk_high_from: number; risk_very_high_from: number; questionnaire_weight: number; lead_days: Record<string, number>; cab_risks: string[]; default_cab_id: string | null; emergency_cab_id: string | null; window_alert_minutes: number };
}

export interface CalendarData {
  from: string;
  to: string;
  timezone: string;
  changes: RecordRow[];
  windows: WindowOcc[];
  outages: RecordRow[];
  lockdowns: RecordRow[];
  holidays: { date: string; title: string; half?: boolean; predicted?: boolean }[];
  display: Record<string, string>;
}

export interface RiskFactorView {
  key: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface RiskView {
  id: string;
  version: number;
  risk: string | null;
  risk_source: string;
  risk_override_reason: string | null;
  result: { score: number; level: string; questionnaire: { score: number | null; answered: number; total: number; missing: string[] }; profile: number; factors: RiskFactorView[] };
  explanation: string;
  questions: QuestionView[];
  answers: Record<string, string>;
  bands: { moderate: number; high: number; very_high: number; questionnaire_weight: number };
  team_score: number | null;
  lead: { days: number | null; required: number; late: boolean };
  locked: boolean;
  ai: string[];
}

export interface Readiness {
  checks: { key: string; label: string; ok: boolean; kind: "change" | "docs" }[];
  score: number;
  status: string;
  unanswered: number;
  ai: { score: number; findings: string[] } | null;
}

export interface Slots {
  duration: number;
  earliest: string;
  slots: { start: string; end: string }[];
  narrative: string | null;
}

export interface Workbench {
  meeting: RecordRow | null;
  meta?: Record<string, unknown>;
  meetings: RecordRow[];
  items: RecordRow[];
  changes: RecordRow[];
  display: Record<string, string>;
  votes: Record<string, Votes>;
  can_manage: boolean;
}

export interface CatalogItem extends RecordRow {
  success_rate: number | null;
}

export interface Dashboard {
  period_days: number;
  open_by_state: Record<string, number>;
  by_type: Record<string, number>;
  outcomes: Record<string, number>;
  kpis: Record<string, number | null>;
  trend: { key: string; label: string; values: Record<string, number> }[];
  risk_bands: { risk: string; implemented: number; failed: number; failure_rate: number | null }[];
  backlog: RecordRow[];
  upcoming: RecordRow[];
  scores: RecordRow[];
  display: Record<string, string>;
}

const rec = (id: string) => `/change/records/${id}`;

export const changeApi = {
  meta: (api: OrgApi) => api.get<ChangeMeta>("/change/meta"),
  seed: (api: OrgApi, force = false) => api.post<{ skipped: boolean; created: Record<string, number> }>("/change/seed", { force }),
  calendar: (api: OrgApi, q: { from: string; to: string; types?: string; groups?: string; mine?: string }) => api.get<CalendarData>("/change/calendar", q),
  fromHolidays: (api: OrgApi, year: number, enforcement: "block" | "warn") => api.post<{ created: number; skipped: number }>("/change/windows/from-holidays", { year, enforcement }),
  risk: (api: OrgApi, id: string) => api.get<RiskView>(`${rec(id)}/risk`),
  saveRisk: (api: OrgApi, id: string, answers: Record<string, string | number>, version?: number) => api.put<RiskView>(`${rec(id)}/risk`, { answers, version }),
  explainRisk: (api: OrgApi, id: string) => api.post<{ text: string; ai: boolean }>(`${rec(id)}/risk/explain`),
  checkConflicts: (api: OrgApi, id: string) => api.post<{ added: number; open: number }>(`${rec(id)}/conflicts/check`),
  slots: (api: OrgApi, id: string, days: number) => api.get<Slots>(`${rec(id)}/slots`, { days }),
  readiness: (api: OrgApi, id: string) => api.get<Readiness>(`${rec(id)}/readiness`),
  impact: (api: OrgApi, id: string) =>
    api.get<{ cis: string[]; services: string[]; impacted: string[]; provider: boolean; simulations: { id: string; name: string; sim_state: string | null; summary: string | null; owner_id: string | null; mine: boolean; created_at: string | null }[]; display: Record<string, string> }>(`${rec(id)}/impact`),
  /** a what-if simulation of the change's CIs saved with the change (configuration management) */
  simulate: (api: OrgApi, id: string, name: string, ciIds: string[]) => api.post<{ id: string; summary: string }>("/cmdb/impact/save", { name, ci_ids: ciIds.slice(0, 50), state: "down", linked_table: "change_request", linked_id: id }),
  similar: (api: OrgApi, id: string) => api.get<{ items: Row[]; summary: { total: number; failed: number; failure_rate: number } | null }>(`${rec(id)}/similar`),
  evidence: (api: OrgApi, id: string) => api.get<{ markdown: string }>(`${rec(id)}/evidence`),
  votes: (api: OrgApi, id: string) => api.get<Votes>(`${rec(id)}/votes`),
  pirDraft: (api: OrgApi, id: string) => api.get<{ sections: Record<string, string>; ai: boolean }>(`${rec(id)}/pir-draft`),
  createPir: (api: OrgApi, id: string) => api.post<{ pir: RecordRow | null; existing: string | null }>(`${rec(id)}/pir`),
  copy: (api: OrgApi, id: string, body: { sections?: string[]; tasks?: boolean; dates?: { start: string; end: string }[] }) => api.post<{ changes: { id: string; number: string }[] }>(`${rec(id)}/copy`, body),
  children: (api: OrgApi, id: string, body: { cis?: string[]; titles?: string[] }) => api.post<{ changes: { id: string; number: string }[] }>(`${rec(id)}/children`, body),
  hold: (api: OrgApi, id: string, reason: string, note: string | null) => api.post<{ row: RecordRow }>(`${rec(id)}/hold`, { reason, note }),
  resume: (api: OrgApi, id: string, note: string | null) => api.post<{ row: RecordRow }>(`${rec(id)}/resume`, { note }),
  backout: (api: OrgApi, id: string, note: string) => api.post<{ row: RecordRow }>(`${rec(id)}/backout`, { note }),
  from: (api: OrgApi, table: string, id: string, body: Record<string, unknown> = {}) => api.post<{ row: RecordRow }>(`/change/from/${table}/${id}`, body),
  catalog: (api: OrgApi, q: string) => api.get<{ items: CatalogItem[]; display: Record<string, string> }>("/change/catalog", q ? { q } : undefined),
  order: (api: OrgApi, id: string, body: Record<string, unknown>) => api.post<{ change: RecordRow; warning: string | null }>(`/change/catalog/${id}/order`, body),
  workbench: (api: OrgApi, meeting: string | null) => api.get<Workbench>("/change/cab/workbench", meeting ? { meeting } : undefined),
  nextMeeting: (api: OrgApi, cab: string) => api.post<{ meeting: RecordRow }>(`/change/cab/${cab}/next`),
  refreshAgenda: (api: OrgApi, meeting: string) => api.post<{ added: number; synced: number }>(`/change/cab/meetings/${meeting}/refresh`),
  decide: (api: OrgApi, meeting: string, item: string, decision: string, comment: string | null) => api.post<{ item: RecordRow }>(`/change/cab/meetings/${meeting}/items/${item}/decide`, { decision, comment }),
  minutes: (api: OrgApi, meeting: string) => api.get<{ text: string; ai: boolean }>(`/change/cab/meetings/${meeting}/minutes`),
  pack: (api: OrgApi, meeting: string) => api.get<{ markdown: string; ai: boolean }>(`/change/cab/meetings/${meeting}/pack`),
  complete: (api: OrgApi, meeting: string, minutes: string | null, version?: number) => api.post<{ meeting: RecordRow }>(`/change/cab/meetings/${meeting}/complete`, { minutes, version }),
  dashboard: (api: OrgApi, days: number) => api.get<Dashboard>("/change/dashboard", { days }),
};

/** Invalidate the module's queries (and the record pages' data) after an action. */
export function useChangeRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return () => {
    void qc.invalidateQueries({ queryKey: ["change", orgId] });
    void qc.invalidateQueries({ queryKey: ["records", orgId] });
  };
}

// Data of the continuity screens: the module's operations (/continuity/…) as typed calls and React Query keys.
import type { OrgApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";

export const CONTINUITY_KEYS = {
  all: (org: string) => ["continuity", org] as const,
  availability: (org: string, unit: string, offset: number) => ["continuity", org, "availability", unit, offset] as const,
  trend: (org: string, id: string, unit: string) => ["continuity", org, "trend", id, unit] as const,
  dashboard: (org: string) => ["continuity", org, "dashboard"] as const,
};
registerLiveQueries("continuity");

export interface Availability {
  agreed_ms: number;
  downtime_ms: number;
  outage_ms: number;
  failures: number;
  availability: number | null;
  mtbf_ms: number | null;
  mtrs_ms: number | null;
  mtbsi_ms: number | null;
  target: number | null;
  met: boolean | null;
  budget_ms: number | null;
  budget_left_ms: number | null;
}

export interface ServiceAvailability extends Availability {
  id: string;
  number: string | null;
  name: string;
  tier: string | null;
  outages: number;
}

export interface AvailabilityReport {
  period: { unit: string; offset: number; label: string; from: string; to: string };
  services: ServiceAvailability[];
  totals: { services: number; with_target: number; meeting: number; average: number | null; downtime_ms: number; failures: number };
}

export interface ServiceTrend {
  service: { id: string; number: string | null; name: string; target: number | null };
  periods: (Availability & { label: string; key: string })[];
  outages: Record<string, any>[];
  display: Record<string, string>;
}

export interface ContinuityDashboard {
  critical_services: number;
  bia_coverage: number | null;
  plans: number;
  plans_current: number;
  plan_currency: number | null;
  tested_12m: number;
  tested_share: number | null;
  exercises_12m: number;
  results: { passed: number; partial: number; failed: number };
  rto_achievement: number | null;
  rpo_achievement: number | null;
  capacity: { warning: number; critical: number; exhausting: number };
  open_outages: number;
  reviews_due: number;
}

export const continuityApi = {
  availability: (api: OrgApi, unit: string, offset: number) => api.get<AvailabilityReport>("/continuity/availability", { unit, offset: String(offset) }),
  trend: (api: OrgApi, id: string, unit: string) => api.get<ServiceTrend>(`/continuity/availability/${id}`, { unit }),
  dashboard: (api: OrgApi) => api.get<ContinuityDashboard>("/continuity/dashboard"),
  biaFromTemplate: (api: OrgApi, body: { title: string; service_id?: string | null }) => api.post<{ row: { id: string } }>("/continuity/bia/from-template", body),
  startExercise: (api: OrgApi, id: string) => api.post(`/continuity/exercises/${id}/start`, {}),
  step: (api: OrgApi, id: string, seq: number, done: boolean) => api.post(`/continuity/exercises/${id}/steps/${seq}`, { done }),
  finish: (api: OrgApi, id: string, body: { result: string; actual_recovery?: number | null; actual_data_loss?: number | null }) => api.post(`/continuity/exercises/${id}/finish`, body),
  outageFromIncident: (api: OrgApi, incident_id: string) => api.post<{ row: { id: string; number: string } }>("/continuity/outages/from-incident", { incident_id }),
};

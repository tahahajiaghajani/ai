// Data of the incident screens: the module's operations (/incident/…: similar incidents, known-error matches, what
// blocks a resolution, escalation, merge, related incidents, the major-incident overlay, the war room's timeline and
// stakeholder updates, the review draft, the dashboard, the defaults) as typed calls and React Query hooks. Light on
// purpose: the module's index imports it; the components load with their pages.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgApi } from "../../lib/api";
import { useOrg } from "../../lib/org";
import { registerLiveQueries } from "../../lib/live";
import type { AnnouncementItem, Bucket, IncidentDashboard, KnownErrorHit, Readiness, SimilarHit } from "@shared/incident/api";
import type { TimelineItem, TimelineKind } from "@shared/incident/logic";

export type { IncidentDashboard, Bucket, TimelineItem, TimelineKind, SimilarHit, KnownErrorHit, Readiness, AnnouncementItem };

export const INCIDENT_KEYS = {
  all: (org: string) => ["incident", org] as const,
  meta: (org: string) => ["incident", org, "meta"] as const,
  similar: (org: string, id: string) => ["incident", org, "similar", id] as const,
  knownErrors: (org: string, id: string) => ["incident", org, "known-errors", id] as const,
  readiness: (org: string, id: string) => ["incident", org, "readiness", id] as const,
  timeline: (org: string, id: string) => ["incident", org, "timeline", id] as const,
  dashboard: (org: string, days: number) => ["incident", org, "dashboard", days] as const,
  announcements: (org: string) => ["incident", org, "announcements"] as const,
};
registerLiveQueries("incident");

export interface IncidentMeta {
  ai: string[];
  settings: { reopen_window_days: number; auto_close_days: number; mi_default_cadence: number; propagate_comments: boolean; cascade_children: boolean };
  audiences: Record<string, string>;
  timeline_kinds: Record<string, string>;
  manual_kinds: TimelineKind[];
}
export type MajorAction = "propose" | "declare" | "reject" | "downgrade";
export interface MergeResult {
  merged: string[];
  failed: { id: string; message: string }[];
}

export const incidentApi = {
  meta: (api: OrgApi) => api.get<IncidentMeta>("/incident/meta"),
  similar: (api: OrgApi, id: string) => api.get<{ hits: SimilarHit[]; display: Record<string, string> }>(`/incident/${id}/similar`),
  knownErrors: (api: OrgApi, id: string) => api.get<{ hits: KnownErrorHit[] }>(`/incident/${id}/known-errors`),
  readiness: (api: OrgApi, id: string) => api.get<Readiness>(`/incident/${id}/readiness`),
  escalate: (api: OrgApi, id: string, body: { kind: "functional" | "hierarchical"; group_id?: string | null; reason: string }) => api.post(`/incident/${id}/escalate`, body),
  merge: (api: OrgApi, id: string, ids: string[]) => api.post<MergeResult>(`/incident/${id}/merge`, { ids }),
  related: (api: OrgApi, id: string, mode: "child" | "copy" | "follow_up", short_description?: string) => api.post<{ row: { id: string; number: string } }>(`/incident/${id}/related`, { mode, short_description }),
  applyKnownError: (api: OrgApi, id: string, known_error_id: string, resolve = false) => api.post(`/incident/${id}/apply-known-error`, { known_error_id, resolve }),
  major: (api: OrgApi, id: string, body: { action: MajorAction; reason?: string; mi_manager_id?: string | null; mi_comms_id?: string | null; comm_cadence?: number | null; bridge_url?: string | null; stakeholders?: string[] }) =>
    api.post(`/incident/${id}/major`, body),
  timeline: (api: OrgApi, id: string) => api.get<{ items: TimelineItem[]; display: Record<string, string> }>(`/incident/${id}/timeline`),
  addEvent: (api: OrgApi, id: string, body: { at?: string | null; kind: TimelineKind; title: string; body?: string | null; key?: boolean }) => api.post(`/incident/${id}/timeline`, body),
  promote: (api: OrgApi, id: string, entry_id: string) => api.post(`/incident/${id}/timeline/promote`, { entry_id }),
  keyEvent: (api: OrgApi, id: string, eventId: string, key: boolean) => api.patch(`/incident/${id}/timeline/${eventId}`, { key }),
  removeEvent: (api: OrgApi, id: string, eventId: string) => api.del(`/incident/${id}/timeline/${eventId}`),
  sendUpdate: (api: OrgApi, id: string, body: { audience: string; subject: string; body: string; channels: string[] }) => api.post<{ recipients: number }>(`/incident/${id}/updates`, body),
  review: (api: OrgApi, id: string) => api.post<{ row: { id: string; number: string }; created: boolean }>(`/incident/${id}/review`),
  dashboard: (api: OrgApi, days: number) => api.get<IncidentDashboard>("/incident/dashboard", { days }),
  seed: (api: OrgApi) => api.post<{ incident: { skipped: boolean; created: Record<string, number> }; problem: { skipped: boolean; created: Record<string, number> } }>("/incident/seed"),
  problemFrom: (api: OrgApi, incident_ids: string[]) => api.post<{ problem: { id: string; number: string }; done: string[]; failed: { id: string; message: string }[] }>("/problem/from-incidents", { incident_ids }),
  ai: (api: OrgApi, id: string, skill: string, body: Record<string, unknown> = {}) => api.post(`/incident/${id}/ai/${skill}`, body),
  announcements: (api: OrgApi) => api.get<{ items: AnnouncementItem[] }>("/incident/announcements"),
  announce: (api: OrgApi, id: string) => api.post<{ row: { id: string; number: string }; created: boolean }>(`/incident/${id}/announcement`),
  computePeriod: (api: OrgApi, id: string, overwrite = false) => api.post<{ row: Record<string, unknown> }>(`/incident/period-reviews/${id}/compute`, { overwrite }),
};

/** The announcements on air for me (refreshed every two minutes and with the module's live updates). */
export function useAnnouncements() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: INCIDENT_KEYS.announcements(orgId), queryFn: () => incidentApi.announcements(api), staleTime: 60_000, refetchInterval: 120_000 });
}

export function useIncidentMeta() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: INCIDENT_KEYS.meta(orgId), queryFn: () => incidentApi.meta(api), staleTime: 5 * 60_000 });
}

export function useTimeline(id: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: INCIDENT_KEYS.timeline(orgId, id), queryFn: () => incidentApi.timeline(api, id), enabled: !!id });
}

/** Invalidate everything the module shows about one incident (after an action). */
export function useIncidentRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return () => qc.invalidateQueries({ queryKey: INCIDENT_KEYS.all(orgId) });
}

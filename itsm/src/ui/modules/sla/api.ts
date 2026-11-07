// Data of the SLA service's screens (docs/spec/services/sla.md §6): «تأییدهای من», a record's approvals and SLA
// timeline, a calendar's spec for the editors' previews, the bundled official holidays, the owner sources of the rule
// builder, and the two sources the record UI plugs in (holidays for calendars and timelines, stored UI policies).
// Light on purpose: the module's index imports it; the components live in the lazily loaded pages.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgApi } from "../../lib/api";
import { useOrg } from "../../lib/org";
import type { Holiday } from "../../records/extensions";
import type { UiPolicy } from "../../records/model/policies";

export const SLA_KEYS = {
  all: ["sla"] as const,
  mine: (org: string, scope: string) => ["sla", org, "approvals", "mine", scope] as const,
  count: (org: string) => ["sla", org, "approvals", "count"] as const,
  record: (org: string, table: string, id: string) => ["sla", org, "approvals", "record", table, id] as const,
  timeline: (org: string, table: string, id: string) => ["sla", org, "timeline", table, id] as const,
  spec: (org: string, id: string, from: string, to: string) => ["sla", org, "calendar-spec", id, from, to] as const,
  bundled: (org: string) => ["sla", org, "bundled"] as const,
  sources: (org: string) => ["sla", org, "approver-sources"] as const,
};

/** One approval as «تأییدهای من» and the record's panel show it. */
export interface ApprovalView {
  id: string;
  version: number;
  table_key: string;
  table_label: string;
  record_id: string;
  record_number: string | null;
  record_title: string | null;
  rule_id: string | null;
  rule_name: string | null;
  level: number;
  level_name: string | null;
  round: number;
  approver_id: string | null;
  group_id: string | null;
  source: string | null;
  rule: string;
  threshold: number | null;
  state: string;
  comments: string | null;
  due_at: string | null;
  requested_at: string | null;
  requested_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
  delegated_from: string | null;
  on_behalf_of: string | null;
  can_decide: boolean;
}

export interface MyApprovals {
  approvals: ApprovalView[];
  display: Record<string, string>;
  delegators: string[];
}

export interface RecordApprovals {
  approvals: ApprovalView[];
  display: Record<string, string>;
  aggregate: "not_requested" | "requested" | "approved" | "rejected";
  can_request: boolean;
}

export interface TimelineEvent {
  at: string;
  kind: "start" | "pause" | "resume" | "warning" | "breach" | "stop" | "cancel" | "repair";
  label: string;
  detail?: string;
}

export interface TimerView {
  id: string;
  label: string;
  type: string;
  target: string;
  state: "in_progress" | "paused" | "achieved" | "breached" | "canceled";
  start_at: string | null;
  due_at: string | null;
  stop_at: string | null;
  paused: boolean;
  breached: boolean;
  met: boolean;
  percent: number;
  remaining_ms: number | null;
  elapsed_ms: number;
  duration_ms: number;
  events: TimelineEvent[];
}

export interface CalendarSpec {
  id: string;
  name: string;
  timezone: string;
  hours: unknown;
  holidays: { date: string; title: string; half?: boolean; predicted?: boolean }[];
}

export type Decision = "approved" | "rejected";

export const approvalsApi = {
  mine: (api: OrgApi, scope: "pending" | "decided") => api.get<MyApprovals>("/approvals/mine", { scope }),
  count: async (api: OrgApi) => (await api.get<{ count: number }>("/approvals/mine/count")).count,
  record: (api: OrgApi, table: string, id: string) => api.get<RecordApprovals>(`/approvals/record/${table}/${id}`),
  decide: (api: OrgApi, id: string, decision: Decision, comment?: string | null) => api.post<{ aggregate: string }>(`/approvals/${id}/decide`, { decision, comment: comment || null }),
  decideMany: (api: OrgApi, ids: string[], decision: Decision, comment?: string | null) =>
    api.post<{ done: number; failed: { id: string; message: string }[] }>("/approvals/decide", { ids, decision, comment: comment || null }),
  request: (api: OrgApi, table: string, id: string, body: { users?: string[]; groups?: string[]; rule?: string; threshold?: number | null; comment?: string | null; expire_hours?: number | null }) =>
    api.post<{ aggregate: string }>(`/approvals/record/${table}/${id}/request`, body),
  cancel: (api: OrgApi, table: string, id: string) => api.post<{ canceled: number; aggregate: string }>(`/approvals/record/${table}/${id}/cancel`),
  sources: (api: OrgApi) => api.get<{ owners: string[] }>("/approvals/sources"),
};

export const calendarsApi = {
  spec: (api: OrgApi, id: string, from: string, to: string) => api.get<CalendarSpec>(`/calendars/${id}/spec`, { from, to }),
  /** the Jalali years of the bundled official calendar (1404…) */
  bundled: (api: OrgApi) => api.get<{ years: number[]; set: string }>("/calendars/bundled"),
  seed: (api: OrgApi, years: number[]) => api.post<Record<string, unknown>>("/calendars/seed", { years }),
  timeline: (api: OrgApi, table: string, id: string) => api.get<{ timers: TimerView[] }>(`/sla/records/${table}/${id}`),
};

export function useMyApprovals(scope: "pending" | "decided") {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SLA_KEYS.mine(orgId, scope), queryFn: () => approvalsApi.mine(api, scope), staleTime: 15_000 });
}

export function useRecordApprovals(table: string, id: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SLA_KEYS.record(orgId, table, id), queryFn: () => approvalsApi.record(api, table, id), staleTime: 10_000 });
}

export function useSlaTimeline(table: string, id: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SLA_KEYS.timeline(orgId, table, id), queryFn: () => calendarsApi.timeline(api, table, id), staleTime: 15_000 });
}

export function useCalendarSpec(id: string | null | undefined, from: string, to: string) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SLA_KEYS.spec(orgId, id ?? "", from, to), queryFn: () => calendarsApi.spec(api, id!, from, to), enabled: !!id, staleTime: 60_000 });
}

export function useBundledHolidays() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SLA_KEYS.bundled(orgId), queryFn: () => calendarsApi.bundled(api), staleTime: Infinity });
}

export function useApproverSources() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: SLA_KEYS.sources(orgId), queryFn: () => approvalsApi.sources(api), staleTime: 5 * 60_000 });
}

/** Forget what the service's screens and the record UI derived from approvals, holidays or policies. */
export function useSlaRefresh() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return {
    approvals: () => {
      // the «تأییدهای من» badge of the sidebar too
      void qc.invalidateQueries({ queryKey: ["shell-counts", orgId] });
      return qc.invalidateQueries({ queryKey: ["sla", orgId, "approvals"] });
    },
    holidays: () => {
      void qc.invalidateQueries({ queryKey: ["records-holidays", orgId] });
      void qc.invalidateQueries({ queryKey: ["sla", orgId, "calendar-spec"] });
    },
    policies: (table?: string) => qc.invalidateQueries({ queryKey: table ? ["records-policies", orgId, table] : ["records-policies", orgId] }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sources of the record UI (records/extensions.ts)

/** Holidays of the organisation's default calendar between two dates (CalendarView, TimelineView). */
export async function holidaySource(api: OrgApi, from: string, to: string): Promise<Holiday[]> {
  const r = await api.get<{ holidays: { date: string; title: string; half?: boolean }[] }>("/calendars/holidays", { from, to });
  return r.holidays.map((h) => ({ date: h.date, title: h.title, ...(h.half ? { half: true } : {}) }));
}

/** The organisation's stored UI policies of a table (RecordPage applies them with the module's own). */
export async function policySource(api: OrgApi, table: string): Promise<UiPolicy[]> {
  return (await api.get<{ policies: UiPolicy[] }>(`/rules/ui-policies/${table}`)).policies;
}

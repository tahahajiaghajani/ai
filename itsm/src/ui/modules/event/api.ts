// Data of the event and on-call screens: the module's operations (/event/…) as typed calls and React Query keys.
// Light on purpose: the module's index imports it; components load with their pages.
import type { OrgApi } from "../../lib/api";
import { api as rootApi, publicApi } from "../../lib/api";
import { registerLiveQueries } from "../../lib/live";
import type { AckView, AiAnswer, ConsoleView, EventMeta, OnCallNow, ShiftsView, SourceKey, TimelineView } from "@shared/event/api";

export type { AckView, AiAnswer, ConsoleView, EventMeta, OnCallNow, ShiftsView, SourceKey, TimelineView };

export const EVENT_KEYS = {
  all: (org: string) => ["event", org] as const,
  meta: (org: string) => ["event", org, "meta"] as const,
  console: (org: string, scope: string, q: string, severity: string) => ["event", org, "console", scope, q, severity] as const,
  timeline: (org: string, id: string) => ["event", org, "timeline", id] as const,
  causes: (org: string, id: string) => ["event", org, "causes", id] as const,
  oncallNow: (org: string, group?: string) => ["event", org, "oncall-now", group ?? ""] as const,
  shifts: (org: string, id: string, from: string, to: string) => ["event", org, "shifts", id, from, to] as const,
  mine: (org: string) => ["event", org, "mine"] as const,
  reports: (org: string, days: number) => ["event", org, "reports", days] as const,
  noise: (org: string, days: number) => ["event", org, "noise", days] as const,
  load: (org: string, days: number) => ["event", org, "load", days] as const,
};
registerLiveQueries("event");

export type ActionName = "ack" | "unack" | "assign" | "take" | "snooze" | "close" | "reopen" | "suppress" | "note" | "ungroup" | "incident";

export interface Bucket {
  key: string;
  label: string;
  count: number;
}

export interface Stats {
  avg: number | null;
  median: number | null;
  p90: number | null;
  count: number;
}

export interface OpsReport {
  days: number;
  totals: { alerts: number; events: number; open: number; acknowledged: number; incidents: number; groups: number; paged_alerts: number; maintenance: number };
  compression: number | null;
  noise_reduction: number | null;
  mtta: Stats;
  mttr: Stats;
  by_severity: Bucket[];
  by_source: Bucket[];
  by_team: Bucket[];
  by_state: Bucket[];
  by_hour: Bucket[];
  noisiest: Bucket[];
  noise: Bucket[];
  trend: { day: string; label: string; created: number; cleared: number; events: number }[];
  pages: { total: number; acknowledged: number; ack_rate: number | null; ack_median: number | null; after_hours: number; by_person: Bucket[] };
  display: Record<string, string>;
}

export interface NoiseReport {
  days: number;
  alerts: number;
  noise_share: number | null;
  never_acked_share: number | null;
  items: { fingerprint: string; title: string; node: string | null; source: string | null; alerts: number; never_acked: number; flapping: number; transient: number; incidents: number; suggestion: string }[];
  sources: { key: string; label: string; alerts: number; noise: number }[];
}

export interface LoadReport {
  days: number;
  rows: { user_id: string; oncall_hours: number; pages: number; after_hours_pages: number; acknowledged: number }[];
  display: Record<string, string>;
}

export interface Cause {
  kind: "alert" | "change";
  id: string;
  number: string | null;
  title: string;
  score: number;
  evidence: string[];
}

export interface SimulationResult {
  checked: number;
  matched: number;
  outcomes: Record<string, number>;
  samples: { id: string; message: string; before: Record<string, unknown>; after: Record<string, unknown>; outcome: string | null }[];
}

export const eventApi = {
  meta: (api: OrgApi) => api.get<EventMeta>("/event/meta"),
  console: (api: OrgApi, p: { scope: string; q?: string; severity?: string }) => api.get<ConsoleView>("/event/console", { scope: p.scope, ...(p.q ? { q: p.q } : {}), ...(p.severity ? { severity: p.severity } : {}) }),
  action: (api: OrgApi, id: string, action: ActionName, body: Record<string, unknown> = {}) => api.post(`/event/alerts/${id}/${action}`, body),
  bulk: (api: OrgApi, ids: string[], action: "ack" | "take" | "close" | "snooze" | "suppress", body: Record<string, unknown> = {}) => api.post<{ done: number; failed: { id: string; message: string }[] }>("/event/alerts-bulk", { ids, action, ...body }),
  group: (api: OrgApi, id: string, action: "ack" | "take" | "close" | "incident", body: Record<string, unknown> = {}) => api.post<{ done: number; skipped?: number; failed: { id: string; message: string }[] }>(`/event/groups/${id}/${action}`, body),
  timeline: (api: OrgApi, id: string) => api.get<TimelineView>(`/event/alerts/${id}/timeline`),
  causes: (api: OrgApi, id: string) => api.get<{ causes: Cause[]; summary: string; hints: string }>(`/event/groups/${id}/causes`),
  aiSummary: (api: OrgApi, id: string) => api.post<AiAnswer>(`/event/groups/${id}/ai/summary`, {}),
  aiCauses: (api: OrgApi, id: string) => api.post<AiAnswer>(`/event/groups/${id}/ai/causes`, {}),
  aiNoise: (api: OrgApi, days: number) => api.post<AiAnswer>("/event/ai/noise", { days }),
  sourceKey: (api: OrgApi, id: string) => api.post<SourceKey>(`/event/sources/${id}/key`, {}),
  sourceTest: (api: OrgApi, id: string, payload: unknown) => api.post<{ events: Record<string, unknown>[]; skipped: string | null; confirm: boolean }>(`/event/sources/${id}/test`, { payload }),
  simulate: (api: OrgApi, body: { rule_id?: string; rule?: Record<string, unknown>; days?: number }) => api.post<SimulationResult>("/event/rules/simulate", body),
  oncallNow: (api: OrgApi, groupId?: string) => api.get<{ items: OnCallNow[]; display: Record<string, string> }>("/event/oncall/now", groupId ? { group_id: groupId } : undefined),
  shifts: (api: OrgApi, id: string, from: string, to: string) => api.get<ShiftsView>(`/event/oncall/schedules/${id}/shifts`, { from, to }),
  take: (api: OrgApi, id: string, body: { minutes?: number; start_at?: string; end_at?: string; replaces_id?: string | null; user_id?: string | null; reason?: string }) => api.post(`/event/oncall/schedules/${id}/take`, body),
  mine: (api: OrgApi, days = 30) => api.get<{ items: { schedule_id: string; schedule: string; start: string; end: string; override: boolean }[] }>("/event/oncall/mine", { days: String(days) }),
  reports: (api: OrgApi, days: number) => api.get<OpsReport>("/event/reports", { days: String(days) }),
  noise: (api: OrgApi, days: number) => api.get<NoiseReport>("/event/noise", { days: String(days) }),
  load: (api: OrgApi, days: number) => api.get<LoadReport>("/event/oncall/load", { days: String(days) }),
  seed: (api: OrgApi) => api.post("/event/seed", { force: true }),
};

/** The sign-in-free acknowledgement page's calls (/api/public/ack/<token>). */
export const ackApi = {
  view: (token: string) => publicApi.get<AckView>(`/ack/${encodeURIComponent(token)}`),
  ack: (token: string) => rootApi.post<AckView>(`/public/ack/${encodeURIComponent(token)}`, {}),
};

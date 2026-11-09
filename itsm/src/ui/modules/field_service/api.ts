// Data of the field service screens (src/server/routes/field_service.ts): typed calls and query keys.
import type { OrgApi } from "../../lib/api";
import type { Row } from "./model";

export interface Lane {
  user_id: string;
  name: string;
  skills: string[];
  contractor: boolean;
  available: boolean;
  max: number;
  shift: { start: string; end: string }[];
  tasks: Row[];
  clashes: [string, string][];
}

export interface Board {
  day: string;
  from: string;
  to: string;
  lanes: Lane[];
  queue: Row[];
  display: Record<string, string>;
  dispatcher: boolean;
}

export interface Candidate {
  user_id: string;
  name: string | null;
  feasible: boolean;
  score: number;
  blockers: string[];
  reasons: string[];
  distance_km: number | null;
  travel_minutes: number | null;
}

export interface Visit {
  task: Row;
  work_order: Row | null;
  parts: Row[];
  nav: string | null;
  leg: { id: string; km: number | null; minutes: number | null } | null;
}

export type Step = "accept" | "reject" | "depart" | "arrive" | "complete" | "leave";

export const FIELD_KEYS = {
  all: ["field_service"] as const,
  meta: (org: string) => ["field_service", org, "meta"] as const,
  board: (org: string, day: string, territory: string | null) => ["field_service", org, "board", day, territory] as const,
  candidates: (org: string, task: string, start: string | null) => ["field_service", org, "candidates", task, start] as const,
  myDay: (org: string, day: string) => ["field_service", org, "my-day", day] as const,
  slots: (org: string, wo: string) => ["field_service", org, "slots", wo] as const,
  dashboard: (org: string) => ["field_service", org, "dashboard"] as const,
};

export const fieldApi = {
  meta: (api: OrgApi) => api.get<{ seeded: boolean; dispatches: boolean; config: { map_provider: string; travel_speed_kmh: number } }>("/field_service/meta"),
  seed: (api: OrgApi) => api.post<{ skipped: boolean; created: Record<string, number> }>("/field_service/seed", {}),
  board: (api: OrgApi, day: string, territory: string | null) => api.get<Board>("/field_service/board", { day, ...(territory ? { territory } : {}) }),
  candidates: (api: OrgApi, task: string, start: string | null) => api.get<{ candidates: Candidate[] }>(`/field_service/tasks/${task}/candidates`, start ? { start } : {}),
  assign: (api: OrgApi, task: string, input: { technician_id: string; start?: string | null; force?: boolean }) =>
    api.post<{ assigned: boolean; warnings: string[]; task?: Row; score?: number }>(`/field_service/tasks/${task}/assign`, input),
  autoAssign: (api: OrgApi, task: string) => api.post<{ assigned: boolean; warnings: string[]; task?: Row }>(`/field_service/tasks/${task}/auto-assign`, {}),
  step: (api: OrgApi, task: string, step: Step, input: { lat?: number | null; lng?: number | null; resolution?: string | null; reason?: string | null; checklist_answers?: Record<string, unknown> | null } = {}) =>
    api.post<{ task: Row }>(`/field_service/tasks/${task}/step`, { step, ...input }),
  signoff: (api: OrgApi, task: string, input: { signer_name: string; attachment_id?: string | null }) => api.post<{ task: Row; report: string }>(`/field_service/tasks/${task}/signoff`, input),
  myDay: (api: OrgApi, day: string) => api.get<{ day: string; visits: Visit[]; total_km: number; total_minutes: number; display: Record<string, string>; map_provider: string }>("/field_service/my-day", { day }),
  from: (api: OrgApi, table: string, id: string, input: Row = {}) => api.post<{ id: string; number: string | null }>(`/field_service/from/${table}/${id}`, input),
  slots: (api: OrgApi, wo: string, from?: string | null, days?: number) =>
    api.get<{ task?: { id: string; number: string | null }; slots: { start: string; end: string; capacity: number }[] }>(`/field_service/work-orders/${wo}/slots`, { ...(from ? { from } : {}), ...(days ? { days } : {}) }),
  book: (api: OrgApi, wo: string, start: string) => api.post<{ window_start: string; window_end: string }>(`/field_service/work-orders/${wo}/book`, { start }),
  runMaintenance: (api: OrgApi) => api.post<{ generated: number }>("/field_service/maintenance/run", {}),
  dashboard: (api: OrgApi) =>
    api.get<{ completed: number; first_time_fix: number | null; on_time_arrival: number | null; schedule_adherence: number | null; mean_dispatch_minutes: number | null; travel_ratio: number | null; unassigned: number; sample: number }>(
      "/field_service/dashboard",
    ),
};

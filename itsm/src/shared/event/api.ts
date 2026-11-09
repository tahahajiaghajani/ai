// API contracts of event management and on-call (/api/o/:org/event/…), shared by the server and the screens.
// No server or UI imports.

/** An alert as the console shows it (the visible fields the console asks for, plus what the caller may do). */
export interface ConsoleAlert {
  id: string;
  number: string | null;
  short_description: string;
  severity: string;
  priority: string | null;
  state: string;
  node: string | null;
  resource: string | null;
  metric: string | null;
  ci_id: string | null;
  service_id: string | null;
  assignment_group_id: string | null;
  assigned_to: string | null;
  event_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  group_id: string | null;
  incident_id: string | null;
  noise_label: string | null;
  escalation_state: string | null;
  escalation_level: number | null;
  symptom: boolean;
  source_id: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  version: number;
  can_respond: boolean;
}

export interface ConsoleGroup {
  id: string;
  number: string | null;
  title: string;
  severity: string;
  priority: string | null;
  state: string;
  reason: string | null;
  alert_count: number;
  open_count: number;
  assignment_group_id: string | null;
  assigned_to: string | null;
  incident_id: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  ci_id: string | null;
  alerts: ConsoleAlert[];
}

export interface ConsoleView {
  groups: ConsoleGroup[];
  /** alerts outside any group (or in a group the caller may not read) */
  alerts: ConsoleAlert[];
  counts: { total: number; open: number; acknowledged: number; critical: number; unassigned: number };
  display: Record<string, string>;
  truncated: boolean;
}

export interface OnCallNow {
  schedule_id: string;
  schedule: string;
  group_id: string | null;
  user_id: string | null;
  override: boolean;
  until: string | null;
}

export interface ShiftView {
  start: string;
  end: string;
  user_id: string | null;
  layer: number | null;
  rotation_id: string | null;
  override_id: string | null;
}

export interface ShiftsView {
  schedule: { id: string; name: string; group_id: string | null; timezone: string; calendar_id: string | null };
  from: string;
  to: string;
  final: ShiftView[];
  layers: { rotation_id: string; name: string; layer: number; restriction: string; shifts: ShiftView[] }[];
  overrides: { id: string; user_id: string; replaces_id: string | null; start_at: string; end_at: string; reason: string | null }[];
  gaps: { start: string; end: string }[];
  now: string;
  can_take: boolean;
  /** user id → name */
  display: Record<string, string>;
}

export type TimelineKind = "seen" | "opened" | "paged" | "page_ack" | "page_expired" | "acknowledged" | "cleared" | "closed";

export interface TimelineView {
  items: { at: string; kind: TimelineKind; label: string; level?: number; user_id?: string; state?: string }[];
  /** the levels still ahead of a running escalation */
  planned: { at: string; level: number; target: string }[];
  policy: { id: string; name: string; repeat_times: number; levels: { level: number; delay_minutes: number; target: string; channels: string[] }[] } | null;
  state: string;
  display: Record<string, string>;
}

export interface AiAnswer {
  text: string;
  ai: boolean;
  label: string;
  model: string | null;
}

export interface SourceKey {
  key: string;
  hint: string;
  url: string;
  header_url: string;
}

export interface EventMeta {
  can: { configure: boolean; oncall: boolean; ai: boolean };
  config: { auto_close_minutes: number; flap_threshold: number; flap_window_minutes: number; retention_days: number };
  ingest_path: string;
}

/** The acknowledgement page's view of a page (no people, no ids). */
export interface AckView {
  title: string;
  number: string | null;
  severity: string;
  severity_label: string;
  state: string;
  state_label: string;
  page_state: string;
  expired: boolean;
  acknowledged_at: string | null;
  changed?: boolean;
}

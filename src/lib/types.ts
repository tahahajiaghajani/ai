import type { FlowSummary } from "@/lib/workflow/types";
export type Role = "admin" | "requester";
export type ProfileStatus = "pending" | "active" | "disabled";

export type TaskStatus =
  | "pending_approval"
  | "returned"
  | "approved"
  | "prework_queued"
  | "prework_running"
  | "prework_done"
  | "main_queued"
  | "main_running"
  | "main_done"
  | "closure_pending"
  | "closure_rejected"
  | "closed"
  | "cancelled";

export type Priority = "low" | "medium" | "high" | "critical";
export type RelationType = "continuation" | "rejection" | "clarification" | "revision" | "other";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  org_unit: string | null;
  phone: string | null;
  role: Role;
  status: ProfileStatus;
  color: string | null;
  /** public URL of the profile picture (column added by the avatars migration) */
  avatar_url?: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface Task {
  id: string;
  code: string;
  parent_id: string | null;
  root_id: string | null;
  seq_in_root: number;
  relation_type: RelationType | null;
  title: string;
  description: string;
  kind: "task" | "event";
  start_date: string | null;
  end_date: string | null;
  event_at: string | null;
  priority: Priority;
  status: TaskStatus;
  progress: number;
  requester_id: string;
  return_reason: string | null;
  closure_note: string | null;
  closure_reject_reason: string | null;
  admin_note: string | null;
  slug: string | null;
  github_path: string | null;
  github_issue_number: number | null;
  claude_session_id: string | null;
  labels: string[];
  status_changed_at: string;
  approved_at: string | null;
  prework_started_at: string | null;
  prework_done_at: string | null;
  main_started_at: string | null;
  main_done_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type JobKind = "prework" | "main" | "knowledge" | "graphify" | "upgrade" | "optimize";
export type Provider = "gemini" | "claude" | "system";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface NodeState {
  status: "pending" | "running" | "done" | "error" | "skipped" | "paused";
  started_at?: string;
  finished_at?: string;
  model?: string;
  detail?: string;
  done?: number;
  total?: number;
}

export interface JobState {
  nodes?: Record<string, NodeState>;
  todos?: TodoItem[];
  /** the workflow this job runs (agents and their dependencies), for the live view */
  flow?: FlowSummary;
  live?: { node?: string; chars?: number; thought?: string; at?: string; model?: string };
  usage?: { input: number; output: number; thoughts: number; calls: number };
  counts?: Record<string, number>;
  [k: string]: unknown;
}

export interface Job {
  id: string;
  task_id: string | null;
  upgrade_id: string | null;
  kind: JobKind;
  provider: Provider;
  status: JobStatus;
  priority: number;
  step: string | null;
  state: JobState;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  locked_by: string | null;
  external_id: string | null;
  external_url: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  updated_at: string;
}

export type EventSource = "system" | "user" | "gemini" | "claude" | "github" | "graphify" | "knowledge";
export type EventKind =
  | "status"
  | "log"
  | "tool"
  | "thought"
  | "search"
  | "file"
  | "commit"
  | "error"
  | "warning"
  | "todo"
  | "result"
  | "message"
  | "progress"
  | "node";

export interface TaskEvent {
  id: number;
  task_id: string | null;
  upgrade_id: string | null;
  job_id: string | null;
  source: EventSource;
  kind: EventKind;
  title: string;
  detail: string | null;
  data: Record<string, unknown> | null;
  visibility: "internal" | "requester";
  actor_id: string | null;
  created_at: string;
}

export interface TaskFile {
  id: string;
  task_id: string | null;
  upgrade_id: string | null;
  job_id: string | null;
  context: "request" | "prework" | "main" | "upgrade" | "output";
  storage_path: string;
  name: string;
  mime: string | null;
  size: number | null;
  uploaded_by: string | null;
  github_path: string | null;
  gemini_uri: string | null;
  gemini_uri_expires_at: string | null;
  created_at: string;
}

export interface ProviderState {
  provider: Provider;
  max_concurrency: number;
  paused_until: string | null;
  pause_reason: string | null;
  manual_pause: boolean;
  models: Record<string, { blocked_until?: string; reason?: string }>;
  stats: Record<string, unknown>;
  updated_at: string;
}

export interface Upgrade {
  id: string;
  code: string;
  title: string | null;
  prompt: string;
  status: "queued" | "running" | "review" | "merging" | "merged" | "failed" | "cancelled" | "rolled_back";
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  preview_url: string | null;
  summary: string | null;
  files: unknown[];
  auto_merge: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
}

export interface NotificationRow {
  id: number;
  user_id: string;
  task_id: string | null;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface KnowledgeRow {
  id: string;
  content: string;
  metadata: {
    kind?: string;
    title?: string;
    tags?: string[];
    task_id?: string;
    task_code?: string;
    requester_id?: string;
    source?: string;
    chunk?: number;
  };
  use_count: number;
  score: number;
  created_at: string;
}

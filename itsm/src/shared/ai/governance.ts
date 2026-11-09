// Contracts of the AI governance console (docs/spec/AI.md §14; HTTP under /api/o/:org/ai/governance, ai:full). Every
// figure is an organisation-wide aggregate or a configuration — no record content and no person's private output
// (skill runs stay private to their authors: feedback is counted, never quoted).
import type { MlModelView } from "./ml";

export type DataUse = "cloud" | "local" | "never";
export type DataPii = "inherit" | "masked" | "aggregates";

export interface GovernanceOverview {
  enabled: boolean;
  disabled_by_platform: boolean;
  data_policy: "full" | "masked" | "aggregates";
  /** switches of «قابلیت‌ها» and the registered features under each */
  features: { key: string; label: string; on: boolean; labels: string[] }[];
  connections: { id: string; label: string; preset: string; local: boolean; enabled: boolean; status: string | null; models: string[] }[];
  skills: { key: string; name: string; module: string | null; enabled: boolean; tier: string; output: string; triggers: string[]; auto_apply: string[]; runs_30d: number; errors_30d: number; up: number; down: number }[];
  agents: { key: string; name: string; module: string | null; enabled: boolean; autonomy: string; auto_actions: string[]; principal: boolean; runs_30d: number; failed_30d: number }[];
  models: { key: string; name: string; kind: string; table_label: string; status: string; enabled: boolean; version: number; beats_baseline: boolean; threshold_apply: number | null; trained_at: string | null }[];
  /** the service member that triggered skills act as, and whether it is set up */
  principal: { set: boolean; roles: string[] };
  /** AI capabilities other modules registered (analytics, virtual agent…) */
  capabilities: string[];
}

export interface UsageDay {
  day: string;
  feature: string;
  calls: number;
  errors: number;
  input: number;
  output: number;
  cost_usd: string;
}

export interface GovernanceUsage {
  from: string;
  to: string;
  days: UsageDay[];
  by_feature: { feature: string; calls: number; errors: number; input: number; output: number; cost_usd: string; avg_ms: number | null }[];
  by_model: { model: string; preset: string | null; calls: number; cost_usd: string }[];
  total_cost_usd: string;
}

export interface GovernanceQuality {
  evals: { skill_key: string; name: string; score: number | null; run_at: string | null; model: string | null }[];
  models: Pick<MlModelView, "key" | "name" | "kind" | "status" | "version" | "history" | "metrics" | "baseline" | "beats_baseline">[];
}

export interface GovernanceFeedback {
  skills: { skill_key: string; runs: number; up: number; down: number; with_comment: number }[];
  predictions: { model_key: string; name: string; applied: number; auto_applied: number; dismissed: number; agreed: number; outcomes: number }[];
  proposals: { status: string; n: number }[];
}

export interface GuardEntry {
  id: string;
  at: string;
  kind: string;
  feature: string | null;
  tables: string[];
  user: string | null;
  detail: string | null;
}

export interface DataPolicyRow {
  table: string;
  label: string;
  module: string;
  use: DataUse;
  pii: DataPii;
  note: string | null;
  /** a row exists (else the default: cloud, the organisation's masking) */
  explicit: boolean;
  /** indexed for retrieval (its text may reach answers) */
  rag: boolean;
  id: string | null;
  version: number | null;
}

export interface OversightView {
  proposals_on: boolean;
  agents: { key: string; name: string; autonomy: string; approvers: number; approver_group: boolean; auto_actions: string[] }[];
  skills_auto_apply: { key: string; name: string; fields: string[] }[];
  models_auto_apply: { key: string; name: string; threshold: number }[];
}

export interface ModelCard {
  key: string;
  kind: "skill" | "agent" | "model";
  name: string;
  purpose: string;
  data: string[];
  inputs: string[];
  outputs: string;
  evaluation: string;
  limitations: string[];
  oversight: string;
  version: string | null;
  updated_at: string | null;
}

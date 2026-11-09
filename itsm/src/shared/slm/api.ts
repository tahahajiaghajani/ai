// API contracts of service level management (src/server/routes/slm.ts ↔ src/ui/modules/slm).
import type { ComplianceStatus, Experience, ReviewPack, CsiSuggestion } from "./logic";

export type { ComplianceStatus, Experience, ReviewPack, CsiSuggestion };

export interface SlmMeta {
  seeded: boolean;
  manages: boolean;
  reads: boolean;
  config: { compliance_target: number; at_risk_target: number; review_months: number; k_min: number; watermelon_gap: number; require_experience_target: boolean };
}

export interface TargetLive {
  id: string;
  name: string;
  kind: string;
  metric_category: string;
  customer_facing: boolean;
  definition_id: string | null;
  goal: number | null;
  at_risk: number | null;
  value: number | null;
  status: ComplianceStatus;
  total: number;
  met: number;
  breached: number;
  excluded: number;
  over_limit: boolean;
  trend: { key: string; label: string; value: number | null; status: ComplianceStatus; final: boolean }[];
}

export interface Agreement360 {
  agreement: Record<string, any>;
  display: Record<string, string>;
  period: { key: string; label: string; start: string; end: string };
  /** null: the caller does not read the module's targets (a customer contact sees the document only) */
  targets: TargetLive[] | null;
  overall: { value: number | null; status: ComplianceStatus };
  experience: Experience | null;
  watermelon: { gap: number | null; flagged: boolean };
  breaches: { by: string; label: string; count: number }[];
  children: { id: string; number: string | null; name: string; kind: string; state: string; compliance_status: string | null }[];
  reviews: { id: string; number: string | null; title: string; state: string; scheduled_at: string | null }[];
  credits: { id: string; number: string | null; period_label: string | null; credit_pct: string | null; amount: string | null; state: string }[];
  improvements: { open: number; overdue: number };
  flags: { review_overdue: boolean; expiring_days: number | null; in_force: boolean; no_experience_target: boolean };
  can: { write: boolean; manage: boolean; accept: boolean; transitions: { to: string; label: string }[] };
}

export interface SlmOverview {
  agreements: { total: number; in_force: number; by_kind: Record<string, number>; by_status: Record<ComplianceStatus, number> };
  attention: { id: string; number: string | null; name: string; kind: string; reason: string; tone: "danger" | "warning" | "info" }[];
  reviews_due: { id: string; number: string | null; title: string; scheduled_at: string | null; state: string }[];
  improvements: { open: number; overdue: number; done_month: number };
  breaches_month: number;
  attainment_month: number | null;
}

export interface AtRiskItem {
  task_sla_id: string;
  table: string;
  record_id: string;
  number: string | null;
  title: string | null;
  priority: string | null;
  assigned_to: string | null;
  group_id: string | null;
  name: string;
  type: string;
  percent: number | null;
  planned_end_at: string | null;
  remaining_ms: number | null;
  breached: boolean;
  paused: boolean;
  probability: number | null;
  level: "critical" | "high" | "medium" | "low";
  reason: string;
}

export interface Recommendation {
  table: string;
  target: string;
  window: { from: string; to: string; label: string };
  percentile: number;
  current: Record<string, number | null>;
  recommended: Record<string, { hours: number | null; n: number }>;
  simulation: { current: SimResult; recommended: SimResult; proposed?: SimResult };
}

export interface SimResult {
  total: number;
  breached: number;
  pct: number | null;
  byPriority: Record<string, { total: number; breached: number }>;
}

export interface XlaView {
  score: number;
  band: string;
  reliability: number;
  quality: number;
  effort: number;
  survey: boolean;
  drivers: { rule: string; theme: string; label: string; count: number; points: number }[];
  explanation: string;
  computed_at: string | null;
  policy: string | null;
}

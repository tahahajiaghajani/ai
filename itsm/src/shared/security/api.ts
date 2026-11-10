// Contracts of the security module's HTTP API (/api/o/:org/security/…): what the routes answer and the screens read.
// Records themselves are served by the engine's generic API (/r/sec_incident…). Imported by the UI.

export interface ScanImportResult {
  scanner: string;
  format: string;
  findings: number;
  hosts: number;
  matched_hosts: number;
  unmatched_hosts: number;
  /** distinct (asset, vulnerability) pairs */
  items: number;
  created: number;
  updated: number;
  reopened: number;
  /** fixed or verified because a covering scan no longer saw them */
  closed: number;
  skipped: number;
  errors: string[];
  import_id: string | null;
  dry_run: boolean;
}

export interface Count {
  key: string;
  label: string;
  count: number;
}

export interface SocTile {
  key: string;
  label: string;
  value: number;
  tone?: "danger" | "warning" | null;
  /** list path (org-relative) the tile opens */
  path?: string;
}

export interface SocWorkspace {
  tiles: SocTile[];
  workload: { user_id: string; name: string; open: number; critical: number }[];
  top: { id: string; number: string | null; title: string; state: string; state_label: string; severity: string | null; risk_score: number | null; assigned_to: string | null; sla_due: string | null }[];
  times: { mttd: number | null; mttc: number | null; mttr: number | null; closed: number; false_positive_rate: number | null };
  handover: string;
  display: Record<string, string>;
}

export interface MyReport {
  number: string | null;
  reported_at: string | null;
  status: string;
  outcome: string | null;
}

export interface MyPolicy {
  campaign_id: string;
  campaign_number: string | null;
  title: string;
  policy_id: string;
  policy_title: string;
  version_label: string | null;
  summary: string | null;
  body: string | null;
  due_at: string | null;
  acked_at: string | null;
  overdue: boolean;
}

export interface FrameworkCompliance {
  id: string;
  key: string;
  name: string;
  placeholder: boolean;
  total: number;
  applicable: number;
  compliant: number;
  implemented: number;
  percent: number | null;
  implemented_percent: number | null;
  soa_approved: number;
}

export interface HeatCell {
  likelihood: number;
  impact: number;
  count: number;
  rating: string | null;
}

export interface RiskHeatmap {
  likelihood_labels: string[];
  impact_labels: string[];
  inherent: HeatCell[];
  residual: HeatCell[];
  above_appetite: { id: string; number: string | null; title: string; residual_score: number | null; appetite_score: number | null; owner_id: string | null }[];
  by_category: Count[];
  display: Record<string, string>;
}

export interface SecurityDashboard {
  ops: null | {
    open: number;
    by_severity: Count[];
    by_state: Count[];
    times: SocWorkspace["times"];
    regulatory: { running: number; overdue: number; submitted_on_time: number; submitted: number; timeliness: number | null };
  };
  vuln: null | {
    open: number;
    by_rating: Count[];
    overdue: number;
    kev_open: number;
    kev_overdue: number;
    sla_percent: number | null;
    mttr_days: number | null;
    ageing: Count[];
    exceptions_open: number;
    exceptions_expired: number;
    coverage: { in_scope: number; scanned_7: number; scanned_30: number };
  };
  compliance: null | {
    frameworks: FrameworkCompliance[];
    controls: number;
    pass_rate: number | null;
    tested_6m: number | null;
    indicators_failing: number;
    issues_open: number;
    issues_overdue: number;
    findings_open: number;
    findings_overdue: number;
    attestation_rate: number | null;
    policies_review_due: number;
    csf_gap: number | null;
  };
  risk: null | {
    open: number;
    by_rating: Count[];
    above_appetite: number;
    complete_percent: number | null;
    reviewed_6m: number | null;
    actions_on_time: number | null;
    culture_ratio: number | null;
    acceptances_expiring: number;
  };
}

export interface SoaRow {
  id: string;
  code: string;
  title: string;
  theme: string | null;
  applicable: boolean;
  justification: string | null;
  implementation: string;
  compliance: string;
  soa_state: string;
  owner_id: string | null;
  controls: { id: string; number: string | null; name: string; effectiveness: string; indicator_status: string }[];
}

export interface AccessRiskFlag {
  kind: "dormant_privileged" | "external_internal_role" | "sod_conflict" | "broad_admin" | "secure_outsider_admin";
  label: string;
  user_id: string;
  name: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface PrivilegedAction {
  at: string;
  source: "security_event" | "audit" | "history";
  kind: string;
  label: string;
  user_id: string | null;
  actor: string | null;
  detail: string;
  ok: boolean;
}

export interface PrivilegedReview {
  entries: PrivilegedAction[];
  /** SHA-256 chain over the entries in order (tamper evidence of an exported review) */
  chain: string;
}

export interface HardeningCheck {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail" | "na";
  detail: string;
  remedy: string | null;
  weight: number;
}

export interface HardeningReport {
  score: number;
  checks: HardeningCheck[];
}

export interface PiiFieldFinding {
  field: string;
  label: string;
  findings: { kind: string; label: string; masked: string }[];
}

export interface VerificationState {
  id: string;
  status: "pending" | "verified" | "failed" | "expired";
  expires_at: string | null;
  attempts: number;
  channel: string;
}

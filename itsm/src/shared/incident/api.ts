// Contracts of the incident and problem APIs shared by the server and the screens (answers of /incident/… and
// /problem/… that are not engine records). No server or UI imports.

export interface Bucket {
  key: string;
  label: string;
  count: number;
}

export interface IncidentDashboard {
  days: number;
  from: string;
  open: { total: number; unassigned: number; major: number; by_priority: Bucket[]; by_state: Bucket[] };
  flow: { created: number; resolved: number; trend: { key: string; label: string; created: number; resolved: number }[] };
  times: {
    mtta_median: number | null;
    mttr_median: number | null;
    mttr_p90: number | null;
    by_priority: { key: string; label: string; count: number; median: number | null; p90: number | null }[];
  };
  quality: { reopen_rate: number | null; first_time_rate: number | null; reassign_avg: number | null; ping_pong_rate: number | null; known_error_rate: number | null; template_rate: number | null };
  ageing: Bucket[];
  sla: { met: number; breached: number; compliance: number | null; at_risk: number } | null;
  major: { declared: number; mttr_median: number | null; reviews: number };
  channels: Bucket[];
  categories: Bucket[];
}


export interface ProblemDashboard {
  days: number;
  from: string;
  open: { total: number; with_known_error: number; proactive: number; by_state: Bucket[]; by_priority: Bucket[] };
  ageing: Bucket[];
  times: { rca_median: number | null; fix_median: number | null };
  coverage: { incidents: number; linked: number; rate: number | null; majors: number; majors_with_problem: number; major_rate: number | null };
  known_errors: { active: number; published: number; by_effectiveness: Bucket[] };
  capa: { open: number; overdue: number; done: number } | null;
  candidates: number | null;
  top: { id: string; number: string | null; short_description: string; state: string; risk_score: number; incident_count: number }[];
  pareto: { categories: Bucket[]; cis: Bucket[] };
  display: Record<string, string>;
}


export interface Match {
  score: number;
  /** why it matched, in Persian, strongest first */
  reasons: string[];
}

export interface SimilarHit extends Match {
  id: string;
  number: string | null;
  short_description: string;
  state: string;
  priority: string | null;
  opened_at: string | null;
  resolved_at: string | null;
  close_code: string | null;
  close_notes: string | null;
  open: boolean;
  problem_id: string | null;
}

export interface KnownErrorHit extends Match {
  id: string;
  number: string | null;
  short_description: string;
  state: string;
  workaround: string | null;
  problem_id: string | null;
  use_count: number;
}

export interface Readiness {
  can_resolve: boolean;
  blockers: string[];
  tasks: { id: string; number: string | null; short_description: string; state: string }[];
  missing: string[];
}

export interface Outcome {
  done: string[];
  failed: { id: string; message: string }[];
}

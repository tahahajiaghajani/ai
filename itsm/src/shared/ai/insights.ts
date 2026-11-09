// Contracts of the insights (docs/spec/AI.md §16; HTTP under /api/o/:org/ai/insights). Client-safe.

export type InsightPeriod = "daily" | "weekly";
export type InsightSeverity = "info" | "notice" | "warning" | "critical";

export const INSIGHT_KINDS: Record<string, string> = {
  volume: "حجم کار",
  volume_spike: "جهش حجم",
  backlog: "کارهای باز و کهنه",
  sla: "پایبندی به توافق سطح خدمت",
  resolution: "زمان حل",
  reopen: "بازگشایی‌ها",
  change_success: "موفقیت تغییرها",
  fulfilment: "زمان انجام درخواست‌ها",
  alert_storm: "طوفان هشدار",
};

export const SEVERITY_LABELS: Record<InsightSeverity, string> = { info: "اطلاع", notice: "قابل توجه", warning: "هشدار", critical: "بحرانی" };

export interface InsightDriver {
  /** the value of the breakdown (an option, an id) */
  key: string;
  label: string;
  current: number;
  previous: number | null;
  /** current − previous */
  delta: number | null;
}

export interface InsightView {
  id: string;
  period: InsightPeriod;
  period_key: string;
  period_label: string;
  kind: string;
  kind_label: string;
  table: string;
  table_label: string;
  severity: InsightSeverity;
  anomaly: boolean;
  score: number;
  title: string;
  /** the numbers the card shows (computed by code) */
  numbers: Record<string, number | string | null>;
  /** what moved most: the breakdown's values with their change */
  drivers: InsightDriver[];
  driver_field: string | null;
  narrative: string | null;
  narrative_ai: boolean;
  created_at: string;
}

export interface InsightsResult {
  insights: InsightView[];
  /** insights of the period this viewer may not see (counted, never described) */
  hidden: number;
  enabled: boolean;
  can_run: boolean;
}

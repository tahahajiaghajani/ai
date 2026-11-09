// Contracts of the predictive AI (docs/spec/AI.md §13; HTTP under /api/o/:org/ai/ml). Client-safe: the record panel,
// the forms, the forecast charts and the governance console share them with the server.

export type MlKind = "classifier" | "risk" | "duplicate" | "cluster";
export type MlStatus = "new" | "training" | "ready" | "below_baseline" | "insufficient" | "failed" | "retired";
export type MlSchedule = "daily" | "weekly" | "monthly" | "manual";
export type PredictionStatus = "open" | "applied" | "auto_applied" | "dismissed" | "outcome";

export const ML_KIND_LABELS: Record<MlKind, string> = {
  classifier: "طبقه‌بندی متن",
  risk: "احتمال پیشامد",
  duplicate: "کشف تکراری",
  cluster: "خوشه‌بندی",
};

export const ML_STATUS_LABELS: Record<MlStatus, string> = {
  new: "در انتظار نخستین آموزش",
  training: "در حال آموزش",
  ready: "آماده و در کار",
  below_baseline: "زیر خط پایه (به کار نمی‌رود)",
  insufficient: "دادهٔ ناکافی",
  failed: "خطا در آموزش",
  retired: "کنار گذاشته",
};

export const ML_SCHEDULE_LABELS: Record<MlSchedule, string> = { daily: "روزانه", weekly: "هفتگی", monthly: "ماهانه", manual: "فقط دستی" };

export const PREDICTION_STATUS_LABELS: Record<PredictionStatus, string> = {
  open: "پیشنهاد",
  applied: "به کار رفت",
  auto_applied: "خودکار اعمال شد",
  dismissed: "رد شد",
  outcome: "نتیجه ثبت شد",
};

/** «زیاد» from 80%, «متوسط» from 60%, else «کم» — the words beside every confidence (colour is never the only cue). */
export function confidenceBand(score: number): { key: "high" | "medium" | "low"; label: string } {
  if (score >= 0.8) return { key: "high", label: "اطمینان زیاد" };
  if (score >= 0.6) return { key: "medium", label: "اطمینان متوسط" };
  return { key: "low", label: "اطمینان کم" };
}

/** A risk in words: «زیاد» at or above the model's alert threshold, «متوسط» from half of it. */
export function riskBand(p: number, alert: number): { key: "high" | "medium" | "low"; label: string } {
  if (p >= alert) return { key: "high", label: "خطر زیاد" };
  if (p >= alert / 2) return { key: "medium", label: "خطر متوسط" };
  return { key: "low", label: "خطر کم" };
}

export interface MlReason {
  /** what pushed the prediction: a word of the text, or «فیلد: مقدار» */
  label: string;
  /** > 0 pushes towards the answer (or raises the risk), < 0 against it */
  weight: number;
}

export interface MlPrediction {
  /** null for a draft (computed now, never stored) */
  id: string | null;
  model: string;
  kind: Exclude<MlKind, "cluster">;
  name: string;
  field: string | null;
  field_label: string | null;
  value: string | null;
  value_label: string | null;
  /** the record's value of the field now (classifiers) */
  current: string | null;
  current_label: string | null;
  score: number;
  alternatives: { value: string; label: string; score: number }[];
  why: MlReason[];
  status: PredictionStatus;
  model_version: number;
  trained_at: string | null;
  /** the model's holdout figures, for «چرا؟» */
  quality: { accuracy?: number | null; macro_f1?: number | null; auc?: number | null; skill?: number | null } | null;
  /** at or above the model's display threshold (below: shown only on request) */
  confident: boolean;
  /** the alert threshold of a risk model */
  alert: number | null;
  /** may the viewer apply it (writes the field with their own access) */
  can_apply: boolean;
}

export interface MlRecordView {
  predictions: MlPrediction[];
  /** models of this table exist but none is ready (the panel says why) */
  note: string | null;
}

export interface MlDraftInput {
  table: string;
  values: Record<string, unknown>;
}

export interface ForecastPoint {
  date: string;
  p10: number;
  p50: number;
  p90: number;
  holiday: boolean;
}

export interface ForecastView {
  ok: boolean;
  refused_reason_fa: string | null;
  method_fa: string;
  table: string;
  table_label: string;
  grain: "day" | "week";
  by: { field: string; label: string; value: string } | null;
  history: { date: string; count: number; holiday: boolean }[];
  points: ForecastPoint[];
  holiday_factor: number;
  weekday_profile: number[];
  backtest: { mae: number | null; mase: number | null; coverage80: number | null; n: number } | null;
  anomalies: number[];
  staffing: { date: string; people_p50: number; people_p90: number }[];
  assumptions: { handle_minutes: number; productive_hours: number; handle_from_data: boolean };
}

export interface ClusterView {
  id: string;
  table: string;
  run_at: string;
  status: string;
  problem_id: string | null;
  members: { id: string; number: string | null; title: string; sim: number }[];
  size: number;
  cohesion: number;
  words: string[];
}

export interface MlModelView {
  key: string;
  kind: MlKind;
  name: string;
  table: string;
  table_label: string;
  target: string | null;
  target_label: string | null;
  inputs: string[];
  enabled: boolean;
  status: MlStatus;
  version: number;
  seed: number;
  threshold_show: number;
  threshold_apply: number | null;
  schedule: MlSchedule;
  metrics: Record<string, unknown> | null;
  baseline: Record<string, unknown> | null;
  beats_baseline: boolean;
  history: { version: number; trained_at: string; rows: number; summary: Record<string, number | null>; beats: boolean }[];
  training_rows: number;
  trained_at: string | null;
  train_after: string | null;
  last_error: string | null;
  /** live counts of the predictions of this model (all records: AI administrators only) */
  predictions: { open: number; applied: number; auto_applied: number; dismissed: number; outcome: number; agreed: number };
}

export interface MlModelPatch {
  enabled?: boolean;
  threshold_show?: number;
  threshold_apply?: number | null;
  schedule?: MlSchedule;
  seed?: number;
}

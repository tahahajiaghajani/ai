// HTTP contracts of analytics under /api/o/:org/analytics (src/server/routes/analytics.ts), shared by the server and
// the screens. Definitions themselves (reports, dashboards, indicators, schedules) are engine records served by the
// generic API (/r/analytics_report…); these routes run them — always with the caller's own access.
import type { Cond } from "../model/conditions";
import type {
  AnalyticsBundle, DashboardFilter, DashboardLayout, FilterValues, IndicatorDef, PeriodInfo, ReportResult, ReportSpec, RestrictedResult, ScorecardItem, ScorePoint,
} from "./types";
import type { NlChip } from "./nl";

export interface AnalyticsMeta {
  /** may create reports and dashboards (the reports area's create right) */
  can_author: boolean;
  /** report administrator (certify, transfer, settings, collect now, re-add the defaults) */
  can_admin: boolean;
  /** the organisation's small-cell threshold (0 = off) */
  k: number;
  /** tables the caller may report on */
  tables: { key: string; label: string; plural: string; module: string | null }[];
  /** AI capabilities registered by the AI layer («analytics.ask» …) */
  ai: string[];
  seeded: boolean;
  timezone: string;
}

/** POST /analytics/run: a definition run as the caller, with a drill-down condition and dashboard controls. */
export interface RunInput {
  spec: ReportSpec;
  extra?: Cond | null;
  filters?: DashboardFilter[];
  values?: FilterValues;
}

/** What one widget of a dashboard shows to the caller. */
export type WidgetRun =
  | { kind: "report"; result: ReportResult; spec: ReportSpec; applied: string[]; ignored: string[]; report: { id: string; name: string } | null }
  | { kind: "indicator"; item: ScorecardItem }
  | { kind: "scorecard"; items: ScorecardItem[] }
  | { kind: "text"; text: string }
  | ({ kind: "restricted" } & RestrictedResult);

export interface DashboardView {
  id: string;
  number: string | null;
  name: string;
  description: string | null;
  layout: DashboardLayout;
  filters: DashboardFilter[];
  tv_cycle: number;
  refresh_minutes: number;
  certified: boolean;
  can_edit: boolean;
  owner_id: string | null;
  version: number;
  /** names of the saved reports the widgets show (those the caller may read) */
  reports: Record<string, string>;
  /** names of the indicators the widgets show (those the caller may read) */
  indicators: Record<string, string>;
}

/** GET /analytics/home: the caller's home dashboard (their workspace's, else one marked for everyone they read). */
export interface HomeDashboard {
  dashboard: DashboardView | null;
  /** why this one: the workspace it is the home of, or «همه» */
  reason: "workspace" | "everyone" | null;
}

export interface Breakdown {
  field: string;
  label: string;
  elements: { key: string; label: string; value: number | null; parts: Record<string, number | null>; n: number }[];
}

/** GET /analytics/indicators/:id/hub — «این عدد را توضیح بده». */
export interface IndicatorHubView {
  item: ScorecardItem;
  definition: IndicatorDef & { id: string; formula_version: number; certified: boolean };
  breakdowns: Breakdown[];
  history: ScorePoint[] | null;
  stored_breakdowns: { field: string; period: string; elements: { key: string; label: string; value: number | null }[] }[];
  records: { name: string; table: string; filter: Cond | null }[];
  can_collect: boolean;
  /** a narrative from the computed numbers (rule-based unless the AI layer wrote it) */
  narrative: { text: string; ai: boolean } | null;
}

/** POST /analytics/ask: a question → a definition (and its result, run as the caller). */
export interface AskResult {
  spec: ReportSpec | null;
  chips: NlChip[];
  problem: string | null;
  /** true when a model interpreted the question (the AI layer), false for the rule-based parser */
  ai: boolean;
  result: ReportResult | null;
}

export interface NarrateResult {
  text: string;
  ai: boolean;
}

export interface LibraryView {
  indicators: { key: string; name: string; practice: string; available: boolean; installed: boolean; reason: string | null }[];
  dashboards: { key: string; name: string; available: boolean; installed: boolean }[];
}

export interface SeedResult {
  skipped: boolean;
  created: Record<string, number>;
}

export interface ImportResult {
  reports: number;
  dashboards: number;
  indicators: number;
  /** what was not imported and why (Persian) */
  skipped: string[];
  /** ids of the created definitions */
  ids: { reports: string[]; dashboards: string[]; indicators: string[] };
}

export type { AnalyticsBundle, PeriodInfo };

/** The definition tables a few routes act on (certify, transfer, copy). */
export const DEFINITION_TABLES = ["analytics_report", "analytics_dashboard", "analytics_indicator", "analytics_schedule"] as const;
export type DefinitionTable = (typeof DEFINITION_TABLES)[number];

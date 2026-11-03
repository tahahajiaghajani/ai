// What the E2 screens read from /api/o/:org/ai/*: every response shape comes from @shared/ai/api; the cash-flow
// week below is the page's own view of it.
import type { AiConnectionPublic, AiJob, AiRef, AiTestReport } from "@shared/ai/types";

export type {
  AiStatus as AiStatusView,
  AiPreset as AiPresetView,
  AiConnectionInput,
  AiUsageReport as AiUsageView,
  AiUsageTotals,
  AiActionView,
  AiToolCallView,
  AiSettingsView,
  AiBudgetState,
} from "@shared/ai/api";

export type { AiConnectionPublic, AiTestReport };

export type { AiBriefView, AiRateRange, AiStockAdvice, AiPlanView, AiPlanSummary, AiExplanation, AiForecastResponse, AiCashflowDetails } from "@shared/ai/api";

/** One week of «جریان نقدی ۱۳ هفته» as the page draws it (from AiCashWeek of GET /ai/forecast/cashflow). */
export interface AiCashWeek {
  start: string;
  end: string;
  label?: string | null;
  opening: string;
  inflow: string;
  outflow: string;
  closing: string;
  p10?: string | null;
  p90?: string | null;
  shortfall?: boolean;
  /** only the pessimistic case falls short */
  risk?: boolean;
  items?: { label: string; amount: string; kind?: string; ref?: AiRef | null }[];
}

export interface AiCashForecastView {
  unit?: string;
  opening: string;
  weeks: AiCashWeek[];
  method?: string | null;
  notes?: string[];
  refused_reason_fa?: string | null;
}

export type { AiJob };

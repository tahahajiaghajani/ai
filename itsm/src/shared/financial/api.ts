// HTTP contracts of supplier and contract management (/supplier/…) and IT financial management (/financial/…),
// shared by the routes and the screens.
import type { CalendarEntry } from "../supplier/logic";
import type { BvaCell, MoneyUnit } from "./logic";

export interface SupplierMeta {
  can_manage: boolean;
  contracts: boolean;
  financial: boolean;
  ai: string[];
}

export interface RenewalMonth {
  key: string;
  label: string;
  start: string;
  end: string;
  entries: CalendarEntry[];
}

export interface Renewals {
  months: RenewalMonth[];
  overdue: CalendarEntry[];
  counts: { notice_30: number; end_90: number; auto: number; value_90: string | null };
}

export interface ExtractSuggestion {
  field: string;
  label: string;
  value: unknown;
  current: unknown;
  evidence: string | null;
  page: number | null;
}

export interface ExtractResult {
  source: { kind: "document" | "attachment" | "none"; name: string | null; pages: number };
  suggestions: ExtractSuggestion[];
  obligations: { title: string; party: "supplier" | "us"; due_hint: string | null; evidence: string | null }[];
  summary: string | null;
  ai: boolean;
  model: string | null;
}

export interface Supplier360 {
  supplier: { id: string; name: string; state: string; score: number | null };
  contracts: { id: string; number: string | null; name: string; type: string | null; state: string; end_date: string | null; annual_value: string | null }[];
  obligations: { id: string; number: string | null; title: string; due_date: string | null; state: string }[];
  scorecards: { period: string; label: string; score: number | null; delivery: number | null; quality: number | null; sla: number | null; review: number | null }[];
  assets: { total: number; in_use: number; in_repair: number };
  repairs: number;
  orders: { open: number; late: number };
  spend: { year: number; total: string; by_source: { source: string; amount: string }[] } | null;
}

export interface FinancialMeta {
  years: { id: string; year: number; name: string; status: string }[];
  current_year: number;
  currency_display: MoneyUnit;
  can_manage: boolean;
  can_approve: boolean;
  financial: boolean;
  ai: string[];
}

export interface BvaPayload {
  year: number;
  periods: string[];
  unit: MoneyUnit;
  rows: (BvaCell & {
    cost_center_id: string;
    name: string;
    by_type: (BvaCell & { cost_type_id: string; name: string })[];
    by_month: (BvaCell & { period_key: string; label: string })[];
  })[];
  total: BvaCell;
  budgets: number;
}

export interface SpendPayload {
  year: number;
  total: string;
  capex: string;
  opex: string;
  by_type: { id: string; name: string; amount: string }[];
  by_source: { source: string; label: string; amount: string }[];
  by_supplier: { id: string; name: string; amount: string }[];
  by_month: { period_key: string; label: string; amount: string }[];
  by_service: { id: string; name: string; amount: string }[];
}

export interface StatementLine {
  service_id: string | null;
  service: string;
  amount: string;
  basis: string;
}

export interface Statement {
  run: { id: string; number: string | null; name: string; mode: string; state: string; period: string };
  units: { unit_id: string | null; unit: string; total: string; lines: StatementLine[] }[];
  services: { service_id: string; service: string; total: string }[];
  total: string;
}

export interface ServiceCost {
  service: { id: string; name: string };
  year: number;
  direct: string;
  allocated: string;
  assets: string;
  total: string;
  by_month: { period_key: string; label: string; amount: string }[];
}

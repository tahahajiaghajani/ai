// Contracts of the service portfolio API (/api/o/:org/service_portfolio/…) shared by the server and the screens: the
// status page (in the organisation and by public link), the service owner's scorecard, portfolio reports and
// rationalization, catalogue health, «my services» with entitlements, and the service picker other modules use.
// Imported by the UI: keep it free of server imports.
import type { DayBar, ServiceStatus } from "./logic";

export interface StatusPageService {
  id: string;
  number: string | null;
  name: string;
  status: ServiceStatus;
  since: string | null;
  note: string | null;
  /** daily bars over the window (oldest first) and the availability over it (0–100) */
  bars: DayBar[];
  availability: number;
  tier: string | null;
  /** the portfolio node the service sits under (for grouping) */
  group: string | null;
  /** the caller subscribes to it (in the organisation only) */
  subscribed?: boolean;
}

export interface StatusPage {
  title: string;
  overall: ServiceStatus;
  services: StatusPageService[];
  days: number;
  updated_at: string;
  /** in the organisation only: the caller may manage the page (publish, link) */
  can_manage?: boolean;
  /** in the organisation only, for managers: the public link's key (null: no public page) */
  public_token?: string | null;
}

export interface ScoreTrendPoint {
  day: string;
  score: number | null;
  availability: number | null;
  incidents: number;
}

export interface ServiceScorecard {
  service: {
    id: string;
    number: string | null;
    name: string;
    state: string;
    status: string;
    status_reason: string | null;
    tier: string | null;
    owner_id: string | null;
    ci_id: string | null;
    score: number | null;
    availability_target: number | null;
  };
  kpis: {
    open_incidents: number;
    major_incidents: number;
    incidents_30d: number;
    breaches_30d: number;
    open_problems: number;
    upcoming_changes: number | null;
    subscribers: number;
    offerings: number;
    active_offerings: number;
    commitments: number;
    availability_30d: number | null;
    csat: number | null;
    dependencies: number;
    dependents: number;
  };
  trend: ScoreTrendPoint[];
  components: Record<string, number> | null;
  offerings: { id: string; number: string | null; name: string; level: string | null; state: string; commitments: number }[];
  /** what the scorecard could not show (a table the caller may not read) */
  hidden: string[];
  review: { last: string | null; due: string | null; overdue: boolean };
}

export interface PortfolioCount {
  key: string;
  label: string;
  count: number;
}

export interface PortfolioReport {
  total: number;
  by_state: PortfolioCount[];
  by_tier: PortfolioCount[];
  by_type: PortfolioCount[];
  by_node: PortfolioCount[];
  by_owner: PortfolioCount[];
  /** average days from approval to going live, per service type */
  time_to_market: { type: string; label: string; days: number | null; services: number }[];
  /** pipeline / catalogue / retired views (SPF-002) */
  views: { pipeline: number; catalogue: number; retired: number };
  completeness: number | null;
  cost: { total: string | null; visible: boolean };
}

export interface RationalizationRow {
  id: string;
  number: string | null;
  name: string;
  state: string;
  tier: string | null;
  node: string | null;
  score: number | null;
  annual_cost: string | null;
  subscribers: number;
  incidents_90d: number;
  requests_90d: number | null;
  /** 0–100: business value from tier, subscribers and assessments */
  value: number;
  /** quadrant on cost × value */
  quadrant: "invest" | "maintain" | "review" | "retire";
  /** services this one looks like (same node, similar name or tags) */
  overlaps: { id: string; name: string; similarity: number }[];
  reasons: string[];
}

export interface HealthCheck {
  key: string;
  label: string;
  /** services the check applies to and how many pass */
  total: number;
  passing: number;
  /** a few failing services (readable ones) */
  failing: { id: string; number: string | null; name: string }[];
}

export interface CatalogueHealth {
  score: number | null;
  checks: HealthCheck[];
  review_due: { id: string; number: string | null; name: string; due: string; overdue: boolean; owner_id: string | null }[];
  computed_at: string;
}

export interface MyService {
  id: string;
  number: string | null;
  name: string;
  status: string;
  note: string | null;
  /** why the caller has it: a subscription (direct, group, unit, location), an agreement of their unit, an offering open to them */
  via: ("subscription" | "group" | "unit" | "location" | "agreement" | "entitlement")[];
  offerings: { id: string; name: string; level: string | null }[];
  subscription_id: string | null;
}

export interface ServicePickerHit {
  id: string;
  number: string | null;
  name: string;
  kind: "service" | "offering";
  service_id?: string | null;
  state: string | null;
  status: string | null;
  tier: string | null;
  ci_id: string | null;
  /** derived from a CI's dependencies (affected services) */
  derived?: boolean;
}

export interface ServiceMeta {
  can_manage: boolean;
  can_create: boolean;
  ai: string[];
  status_page_public: boolean;
}

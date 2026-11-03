// Request and response shapes of the AI HTTP API (server: src/server/routes/ai.ts and
// ai-admin.ts). Client-safe. Every path below is relative to /api/o/:org/ai unless noted.
//
//   GET    /presets                     → { presets: AiPreset[]; mode; fake }   (presets usable here; fake = test mode)
//   GET    /status                      → AiStatus
//   GET    /connections                 → { connections: AiConnectionPublic[]; app_secret_missing }   (ai:full)
//   POST   /connections   AiConnectionInput            → { connection; warning }                    (ai:full)
//   GET    /connections/:id               → { connection }                                           (ai:full)
//   PATCH  /connections/:id  Partial<AiConnectionInput> → { connection; warning }                    (ai:full; blank key keeps it while the destination is the same)
//   DELETE /connections/:id                → { ok }                                                   (ai:full)
//   PUT    /connections/:id/key  { key }   → { connection }                                           (ai:full; write-only)
//   POST   /connections/:id/test { models? } → AiTestReport                                           (ai:full)
//   POST   /test  AiConnectionTestInput    → AiTestReport (unsaved values; key may be blank with connection_id)
//   POST   /connections/:id/models         → { models; connection }                                  (ai:full)
//   POST   /connections/:id/resume         → { connection }   (clears rate/quota holds)              (ai:full)
//   GET    /settings                       → AiSettingsView                                           (ai:view; ai:full sees everything)
//   PUT    /settings  AiSettingsPatch      → AiSettingsView                                           (ai:full)
//   POST   /chat  AiChatRequest            → text/event-stream of AiStreamEvent                       (ai:view)
//   POST   /threads/:id/continue           → text/event-stream of AiStreamEvent                       (author)
//   POST   /threads/:id/stop               → { ok; stopped }                                          (author)
//   GET    /threads?q=&archived=1          → { threads: AiThreadSummary[] }                           (own threads)
//   GET    /threads/:id                    → { thread: AiThreadDetail }                               (author)
//   PATCH  /threads/:id  { title?, pinned?, archived? } → { thread: AiThreadDetail }                 (author)
//   DELETE /threads/:id                    → { ok }                                                   (author)
//   GET    /threads/:id/messages           → { messages: AiMessageView[]; running }                   (author)
//   POST   /messages/:id/rating { rating: 1 | -1 | null } → { ok }                                    (author)
//   GET    /data/:ref                      → AiDataView                                               (author)
//   GET    /actions?status=&mine=1&limit=  → { actions: AiActionView[] }                             (ai:full: all; others: own)
//   POST   /actions/:id/confirm            → { proposal: AiProposal }   (header Idempotency-Key optional)
//   POST   /actions/:id/reject  { reason? } → { proposal: AiProposal }
//   GET    /tool-calls?tool=&user=&limit=  → { calls: AiToolCallView[] }                              (ai:full)
//   GET    /usage?from=&to=                → AiUsageReport                                            (ai:full)
//   POST   /relay                          → text/event-stream of AiRelayEvent (web version only; Windows app's device token)
//   /api/admin/ai/overview (GET) → AiAdminOverview; /api/admin/ai/policy (GET, PUT Partial<AiPolicy>) → { policy: AiPolicy }
//
// SSE frames: `event: <type>` + `data: <AiStreamEvent as JSON>`; a `: ping` comment every 15 s.
// Before the stream starts, a missing permission (403) or an invalid body (400) is an ordinary JSON
// error; everything after (AI off, budget, provider errors, a busy thread) is an `error` event
// followed by `done` with stop "error".
// The stream ends after `done`, or after `continue` (the step budget of this request ran out: POST
// /threads/:id/continue right away and keep appending to the same answer).
import type { Area, Level } from "../permissions";
import type { AiPreset } from "./presets";
import type {
  AiCaptureResult,
  AiConnectionPublic,
  AiEffort,
  AiErrorKind,
  AiForecastSeries,
  AiInsight,
  AiJob,
  AiPageContext,
  AiProposal,
  AiProtocol,
  AiRef,
  AiSettings,
  AiThreadSummary,
} from "./types";

export type { AiPreset };

export interface AiBudgetState {
  /** alert: spending reached alert_pct of a cap; stopped: a cap is reached and the AI waits */
  state: "ok" | "alert" | "stopped";
  /** this Jalali month, the whole business (USD, decimal string) */
  month_usd: string;
  month_cap_usd: string | null;
  /** today, the caller */
  today_usd: string;
  today_cap_usd: string | null;
  alert_pct: number;
}

export interface AiStatus {
  /** the business switch is on and the platform has not turned AI off */
  enabled: boolean;
  /** a usable connection (or the web version's, for a linked Windows app) serves the assistant */
  configured: boolean;
  /** the assistant can answer now */
  ok: boolean;
  kind: AiErrorKind | null;
  message_fa: string | null;
  remedy_fa: string | null;
  can_use: boolean; // ai:view
  can_propose: boolean; // ai:edit and drafts switched on
  can_manage: boolean; // ai:full
  features: AiSettings["features"];
  budget: AiBudgetState;
  /** first model of the assistant chain and its connection label */
  model: string | null;
  connection: string | null;
  route: "direct" | "via_cloud" | null;
  mode: "cloud" | "desktop";
  /** web version without APP_SECRET: keys cannot be stored (shown to ai:full only) */
  app_secret_missing: boolean;
}

export interface AiConnectionsResponse {
  connections: AiConnectionPublic[];
  /** web version without APP_SECRET: keys cannot be stored */
  app_secret_missing: boolean;
}

export interface AiConnectionInput {
  preset: string;
  label?: string;
  /** only for presets that offer several protocols */
  protocol?: AiProtocol;
  base_url?: string | null;
  /** write-only; on PATCH a blank key keeps the stored one */
  key?: string;
  models?: { smart?: string[]; fast?: string[]; vision?: string[] };
  enabled?: boolean;
  priority?: number;
  /** PATCH only: save without the stored key (refused for a key-required service). A new service
   *  or base URL with a stored key needs either the key again or this flag. */
  remove_key?: boolean;
}

export interface AiConnectionTestInput extends AiConnectionInput {
  /** test edited values of a saved connection: a blank key uses the stored one */
  connection_id?: string | null;
}

export type AiSettingsPatch = Partial<{
  enabled: boolean;
  routing: Partial<AiSettings["routing"]>;
  effort: Partial<Record<AiJob, AiEffort>>;
  features: Partial<AiSettings["features"]>;
  data_policy: AiSettings["data_policy"];
  budgets: Partial<AiSettings["budgets"]>;
  instructions: string;
  retention_days: number;
  use_cloud: boolean;
}>;

export interface AiSettingsView {
  /** members without ai:full get the switches only (routing empty, budgets null, instructions blank) */
  settings: AiSettings;
  can_manage: boolean;
  /** what the platform administrator decided for this business */
  policy: { disabled: boolean; allowed_presets: string[] | null; allowed_protocols: AiProtocol[] | null; monthly_cap_usd: string | null };
  app_secret_missing: boolean;
  mode: "cloud" | "desktop";
  /** Windows app linked to the web version (use_cloud is possible) */
  linked: boolean;
}

export interface AiAttachmentInput {
  name: string;
  mime: string; // image/png | image/jpeg | image/webp | image/gif | application/pdf
  data: string; // base64
}

export interface AiChatRequest {
  thread_id?: string | null;
  text: string;
  attachments?: AiAttachmentInput[];
  context?: AiPageContext | null;
}

export interface AiThreadDetail extends AiThreadSummary {
  context: AiPageContext | null;
  archived: boolean;
  /** an answer is being prepared right now */
  running: boolean;
  created_at: string;
}

export interface AiDataView {
  id: string;
  rows: Record<string, unknown>[];
  meta: { title?: string; [k: string]: unknown };
  total_rows: number;
  /** more rows existed than were kept */
  truncated: boolean;
}

export interface AiActionView extends AiProposal {
  thread_id: string | null;
  area: Area;
  level: Level;
  user: { id: string; name: string | null };
  confirmed_by: { id: string; name: string | null } | null;
  confirmed_at: string | null;
  created_at: string;
  /** the caller may confirm or reject it now */
  can_decide: boolean;
}

export interface AiToolCallView {
  id: string;
  thread_id: string | null;
  user: { id: string | null; name: string | null };
  tool: string;
  title_fa: string;
  ok: boolean;
  summary: string | null;
  ms: number | null;
  /** the input as it was logged (personal identifiers masked) */
  input: unknown;
  created_at: string;
}

export interface AiUsageTotals {
  cost_usd: string;
  calls: number;
  errors: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  /** calls to models missing from the price table (counted as 0) */
  unpriced_calls: number;
}

export interface AiUsageReport {
  from: string;
  to: string;
  totals: AiUsageTotals;
  by_day: ({ day: string } & AiUsageTotals)[];
  by_model: ({ model: string; preset: string | null } & AiUsageTotals)[];
  by_feature: ({ feature: string } & AiUsageTotals)[];
  by_user: ({ user_id: string | null; name: string | null } & AiUsageTotals)[];
  budget: AiBudgetState;
}

/** Platform policy (tz_kv "ai.policy"), set by the platform administrator. */
export interface AiPolicy {
  /** AI off for every business */
  kill_switch: boolean;
  disabled_orgs: string[];
  /** null = every protocol / preset */
  allowed_protocols: AiProtocol[] | null;
  allowed_presets: string[] | null;
  /** monthly ceiling per business (USD); a business's own budget can only be lower */
  default_monthly_cap_usd: string | null;
  updated_at: string | null;
}

export interface AiAdminBusiness {
  org_id: string;
  name: string;
  /** the business's own switch */
  enabled: boolean;
  disabled_by_platform: boolean;
  connections: number;
  presets: string[];
  status: "ok" | "error" | "unchecked" | "none";
  last_error: { kind: AiErrorKind; at: string } | null;
  month: { cost_usd: string; calls: number; errors: number };
  users_month: number;
  last_used_at: string | null;
}

export interface AiAdminOverview {
  businesses: AiAdminBusiness[];
  totals: { businesses_enabled: number; connections: number; month_cost_usd: string; month_calls: number };
  policy: AiPolicy;
}

/** Events of POST /relay (Windows app → web version): model output only, tools run on the Windows app. */
export type AiRelayEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "result"; result: unknown }
  | { type: "error"; kind: AiErrorKind; message_fa: string; retry_after_ms: number | null };

// ---------------------------------------------------------------- AI features (server: src/server/routes/ai-features.ts)
//
//   GET    /insights?all=1                 → { insights: AiInsight[]; enabled; day }
//   POST   /insights/refresh               → same                                             (ai:edit)
//   POST   /insights/:id/status  AiInsightStatusInput → { insight: AiInsight }
//   GET    /brief?refresh=1                → { brief: AiBriefView }
//   POST   /explain  AiExplainRequest      → { explanation: AiExplanation }
//   GET    /forecast/cashflow              → AiForecastResponse<AiCashflowDetails>
//   GET    /forecast/sales|demand?grain=&horizon=&item=&category= → AiForecastResponse
//   GET    /forecast/rate?rate=gold18|mazaneh|coin:<key>|fx:<code> → AiForecastResponse   (one rate)
//   GET    /forecast/rates                 → { rates: AiRateRange[] }                         (every rate of the business)
//   GET    /forecast/reorder | /forecast/dead_stock → { items: AiStockAdvice[]; unit }        (goods; inventory:view)
//   POST   /forecast/:series/narrative  AiForecastQuery → AiForecastNarrative
//   POST   /plan  { horizon, focus? }      → { plan: AiPlanView }
//   GET    /plans                          → { plans: AiPlanSummary[] };  GET /plans/:id → { plan: AiPlanView };  DELETE /plans/:id → { ok }
//   POST   /capture  AiCaptureRequest      → { capture: AiCaptureResult & { cached } }
//
// A request that fails because AI cannot answer (switched off, not set up, budget, the provider's
// error) is an ordinary JSON error whose code is `ai_<kind>` and whose details carry the kind:
//   { error: { code: "ai_not_configured", message: "…", details: { kind: "not_configured" } } }
// The UI shows the Persian title and remedy of that kind (src/shared/ai/errors.ts).

export interface AiErrorBody {
  error: { code: `ai_${AiErrorKind}` | string; message: string; details: { kind: AiErrorKind } | Record<string, unknown> | null };
}

export interface AiInsightStatusInput {
  status: AiInsight["status"];
  /** snoozed: until when (ISO date or timestamp; default one day) */
  snooze_until?: string | null;
}

/** «خلاصهٔ امروز». */
export interface AiBriefView {
  day: string; // ISO business day
  date_fa: string;
  facts: {
    key: string;
    label: string;
    value: string;
    hint?: string | null;
    /** in = money coming in, danger/warning = needs attention */
    tone?: "in" | "danger" | "warning" | null;
    /** in-app path (without the org prefix) of the page behind the number */
    path?: string | null;
  }[];
  insights: AiInsight[];
  /** short markdown written by the model, or the template */
  markdown: string;
  source: "ai" | "template";
  model: string | null;
  note_fa?: string | null;
  generated_at: string;
}

/** Report keys of POST /explain and the run_report tool. */
export const AI_REPORT_KEYS = [
  "trial_balance", "income_statement", "balance_sheet", "ledger", "party_statement", "journal", "detail_balances",
  "cash_bank_book", "treasury_balances", "cheques_due",
  "sales_report", "purchases_report", "stock", "kardex",
  "gold_stock", "gold_position", "gold_sales", "gold_parties", "gold_coins", "gold_bars",
  "fx_positions", "fx_cash", "fx_deals", "fx_correspondents", "fx_remittances",
] as const;
export type AiReportKey = (typeof AI_REPORT_KEYS)[number];

/** Names report pages use for the same reports. */
export const AI_REPORT_ALIASES: Record<string, AiReportKey> = {
  cash_book: "cash_bank_book",
  goods_sales: "sales_report",
  goods_purchases: "purchases_report",
};

export interface AiExplainRequest {
  report: AiReportKey | keyof typeof AI_REPORT_ALIASES;
  /**
   * The report page's own parameters, as the page sends them to its endpoint: from, to, date, fiscal_year_id, drafts,
   * level, account_id, detail_id, party_id, item_id, cash_box_id, bank_account_id, direction, group, low, scope …
   * (unknown ones are ignored)
   */
  params?: Record<string, unknown> | null;
  /** instead of from/to: a Jalali preset or dates */
  period?: { preset?: string | null; from?: string | null; to?: string | null } | null;
  /** «تحلیل دوباره»: skip any cache */
  fresh?: boolean;
}

export interface AiExplanation {
  report: AiReportKey;
  title_fa: string;
  period_fa: string;
  markdown: string;
  key_points: string[];
  questions: string[];
  source: "ai" | "template";
  model: string | null;
  note_fa?: string | null;
}

/** Query of GET /forecast/:series (and the body of POST /forecast/:series/narrative). */
export interface AiForecastQuery {
  grain?: "month" | "week";
  horizon?: number;
  /** sales/demand: one item (id, code or exact name) */
  item?: string | null;
  /** sales/demand: one item category (id or exact name) */
  category?: string | null;
  /** rate: gold18 | mazaneh | coin:<board key> | fx:<currency code> */
  rate?: string | null;
}

export interface AiForecastResponse<D = Record<string, unknown>> {
  series: AiForecastSeries;
  details: D;
  refs: AiRef[];
}

/** One week of the 13-week cash flow (money as decimal strings in the base currency). */
export interface AiCashWeek {
  week_start: string;
  week_end: string;
  label: string;
  opening: string;
  cheques_in: string;
  cheques_out: string;
  invoices_in: string;
  invoices_out: string;
  recurring_out: string;
  inflow: string;
  outflow: string;
  net: string;
  closing_p50: string;
  closing_p10: string;
  closing_p90: string;
  /** the expected closing balance is negative */
  shortfall: boolean;
  /** the pessimistic closing balance is negative */
  risk: boolean;
  /** what makes up the week (largest first, bounded) */
  items: { label: string; amount: string; kind: "cheque_in" | "cheque_out" | "invoice_in" | "invoice_out" | "recurring"; ref?: AiRef | null }[];
}

export interface AiCashflowDetails {
  opening: { cash: string; bank: string; total: string };
  weekly_recurring_costs: string;
  weeks: AiCashWeek[];
  shortfall_weeks: string[];
  risk_weeks: string[];
  assumptions_fa: string[];
}

/** Range of a market rate for the next day, week and month (information, not advice). */
export interface AiRateRange {
  /** the rate spec: gold18 | mazaneh | coin:<key> | fx:<code> */
  key: string;
  title_fa: string;
  unit: string;
  last: string;
  /** when the last rate was recorded */
  at: string | null;
  /** the last rate is older than two days */
  stale: boolean;
  horizons: { days: number; p10: string; p50: string; p90: string }[];
  coverage80: string | null;
  n: number | null;
  refused_reason_fa?: string | null;
  /** daily closes recorded */
  observations: number;
  /** a range from less than 60 daily closes: shown, but with low confidence */
  thin: boolean;
  /** daily closes, oldest first (at most 90) */
  history: { period: string; value: string }[];
}

/** A reorder suggestion or a dead-stock item. */
export interface AiStockAdvice {
  item_id: string;
  code: string | null;
  name: string;
  unit: string | null;
  stock: string;
  suggested_qty: string | null;
  /** days the stock lasts at the average daily sales of the last 90 days */
  days_cover: number | null;
  last_sale: string | null;
  value: string | null;
  reason_fa: string | null;
}

export interface AiForecastNarrative {
  markdown: string;
  source: "ai" | "template";
  model: string | null;
  note_fa: string | null;
  series: AiForecastSeries;
}

export interface AiPlanSummary {
  id: string;
  title: string;
  horizon: "month" | "quarter";
  focus: string | null;
  source: "ai" | "template";
  created_at: string;
}

export interface AiPlanView extends AiPlanSummary {
  content: {
    horizon: "month" | "quarter";
    from: string;
    to: string;
    sections: { key: string; title: string; lines: string[] }[];
    steps: { title: string; detail: string; when: string | null; area: string | null }[];
    risks: string[];
  };
  markdown: string;
  model: string | null;
  note_fa?: string | null;
}

/** Field keys a capture returns per kind (values stay as read; `<date field>_iso` and `party_id` are added by the server). */
export const AI_CAPTURE_FIELDS = {
  purchase_invoice: ["seller_name", "seller_national_id", "seller_economic_code", "seller_phone", "invoice_no", "date", "subtotal", "discount", "tax", "total", "currency_unit"],
  id_card: ["first_name", "last_name", "father_name", "national_id", "birth_date", "id_doc_no", "expiry"],
  cheque: ["sayad_id", "serial_no", "bank_name", "branch_name", "account_no", "iban", "account_owner", "payee", "amount", "amount_words", "due_date", "issuer_national_id"],
  receipt: ["payer", "payee", "amount", "date", "reference", "bank_name", "card_last4", "description"],
} as const satisfies Record<AiCaptureResult["kind"], readonly string[]>;

/** Keys of each line of a purchase invoice capture. */
export const AI_CAPTURE_LINE_FIELDS = ["description", "code", "qty", "unit", "unit_price", "discount", "tax", "total"] as const;

export type AiCaptureField<K extends AiCaptureResult["kind"]> = (typeof AI_CAPTURE_FIELDS)[K][number];

export interface AiCaptureRequest {
  kind: AiCaptureResult["kind"];
  mime: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  /** base64 */
  file: string;
  name?: string | null;
}

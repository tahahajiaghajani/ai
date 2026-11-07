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
  AiConnectionPublic,
  AiEmbedConfig,
  AiEffort,
  AiErrorKind,
  AiJob,
  AiPageContext,
  AiProposal,
  AiProtocol,
  AiSettings,
  AiThreadSummary,
} from "./types";

export type { AiPreset };

export interface AiBudgetState {
  /** alert: spending reached alert_pct of a cap; stopped: a cap is reached and the AI waits */
  state: "ok" | "alert" | "stopped";
  /** this Jalali month, the whole organisation (USD, decimal string) */
  month_usd: string;
  month_cap_usd: string | null;
  /** today, the caller */
  today_usd: string;
  today_cap_usd: string | null;
  alert_pct: number;
}

export interface AiStatus {
  /** the organisation's switch is on and the platform has not turned AI off */
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
  /** the provider's free plan: usage counted at zero cost, outside the budget */
  free_tier?: boolean;
  /** the embedding model of retrieval; null or a blank model = this connection does not embed */
  embed?: { model?: string | null; dims?: number | null; api?: AiEmbedConfig["api"] } | null;
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
  cloud_first: AiJob[];
  rag: Partial<AiSettings["rag"]>;
}>;

export interface AiSettingsView {
  /** members without ai:full get the switches only (routing empty, budgets null, instructions blank) */
  settings: AiSettings;
  can_manage: boolean;
  /** what the platform administrator decided for this organisation */
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

/** Platform policy (sm_kv "ai.policy"), set by the platform administrator. */
export interface AiPolicy {
  /** AI off for every organisation */
  kill_switch: boolean;
  disabled_orgs: string[];
  /** null = every protocol / preset */
  allowed_protocols: AiProtocol[] | null;
  allowed_presets: string[] | null;
  /** monthly ceiling per organisation (USD); an organisation's own budget can only be lower */
  default_monthly_cap_usd: string | null;
  updated_at: string | null;
}

export interface AiAdminOrg {
  org_id: string;
  name: string;
  /** the organisation's own switch */
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
  orgs: AiAdminOrg[];
  totals: { orgs_enabled: number; connections: number; month_cost_usd: string; month_calls: number };
  policy: AiPolicy;
}

/** Events of POST /relay (Windows app → web version): model output only, tools run on the Windows app. */
export type AiRelayEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "result"; result: unknown }
  | { type: "error"; kind: AiErrorKind; message_fa: string; retry_after_ms: number | null };

// ---------------------------------------------------------------- AI features of modules
//
// A module's own AI feature (a summary, a classification, a suggested reply…) calls `generate` (src/server/modules/
// ai/engine.ts) from its routes. A request that fails because AI cannot answer (switched off, not set up, budget,
// the provider's error) is an ordinary JSON error whose code is `ai_<kind>` and whose details carry the kind:
//   { error: { code: "ai_not_configured", message: "…", details: { kind: "not_configured" } } }
// The UI shows the Persian title and remedy of that kind (src/shared/ai/errors.ts).

export interface AiErrorBody {
  error: { code: `ai_${AiErrorKind}` | string; message: string; details: { kind: AiErrorKind } | Record<string, unknown> | null };
}

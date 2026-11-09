// Contracts of the AI layer shared by the server (engine, tools, the assistant) and the UI (assistant, AI
// settings, the platform console). Client-safe: no server imports.
// Owners may ADD fields and union members; never rename or remove one without updating every user.

// ---------------------------------------------------------------- providers and connections

/** Wire protocol of a provider: decides which adapter talks to it. */
export type AiProtocol = "anthropic" | "openai-responses" | "openai-chat" | "gemini";

/** What a connection is used for; each job maps to a (connection, model) chain in the settings. */
export type AiJob = "assistant" | "analysis" | "fast" | "vision";

export type AiEffort = "low" | "medium" | "high" | "max";

export type AiConnectionStatus = "unchecked" | "ok" | "error" | "paused";

/** Error classes, normalised across providers (Persian explanations live in src/shared/ai/errors.ts). */
export type AiErrorKind =
  | "auth" | "region" | "quota" | "rate" | "overloaded" | "model" | "invalid" | "refusal"
  | "timeout" | "network" | "budget" | "disabled" | "not_configured" | "empty" | "other";

/** A connection as the UI sees it. The key itself never leaves the server. */
export interface AiConnectionPublic {
  id: string;
  label: string;
  preset: string; // id from src/shared/ai/presets.ts
  protocol: AiProtocol;
  base_url: string | null;
  has_key: boolean;
  key_hint: string | null; // e.g. "…a1B2"
  key_unreadable?: boolean; // stored key cannot be decrypted (secret changed): ask for it again
  models: { smart: string[]; fast: string[]; vision: string[] };
  available_models?: string[]; // last list read from the provider
  status: AiConnectionStatus;
  last_error: { kind: AiErrorKind; message: string; at: string; /** the provider's own words, keys removed */ detail?: string | null } | null;
  checked_at: string | null;
  paused_until: string | null;
  enabled: boolean;
  priority: number;
  /** the provider's free plan (Gemini with an AI Studio key, OpenRouter free models…): counted at zero cost */
  free_tier: boolean;
  /** the embedding model of «نمایه و بازیابی» on this connection (null: it does not embed) */
  embed?: AiEmbedConfig | null;
  created_by_name?: string | null;
  updated_at: string;
}

/** Result of «آزمایش اتصال»: one row per model tried. */
export interface AiTestReport {
  ok: boolean;
  ms: number;
  models: { model: string; ok: boolean; ms: number; reply?: string; kind?: AiErrorKind; message_fa?: string; provider_message?: string }[];
  available_models?: string[];
  route: "direct" | "via_cloud";
}

/** A connection's embedding capability: model, vector size (null = the model's own) and API style. */
export interface AiEmbedConfig {
  model: string;
  dims: number | null;
  api: "openai" | "gemini" | "voyage" | "cohere" | "jina" | "fake";
}

// ---------------------------------------------------------------- settings

/** «نمایه و بازیابی»: the organisation's retrieval (RAG) settings on this runtime. */
export interface AiRagSettings {
  /** records and documents are indexed and AI answers may cite them */
  enabled: boolean;
  /** the connection whose embedding model indexes everything (null = the first enabled connection that embeds) */
  embed_connection_id: string | null;
  /** a fast model re-orders the passages found before an answer (one more model call per question) */
  rerank: boolean;
  /** a short summary of each uploaded document (one model call per document) */
  summaries: boolean;
  /** passages an answer may use */
  top_k: number;
}

export type AiDataPolicy = "full" | "masked" | "aggregates";

export interface AiSettings {
  enabled: boolean;
  /** job -> ordered chain of { connection_id, model }; the first that works answers */
  routing: Record<AiJob, { connection_id: string; model: string }[]>;
  effort: Record<AiJob, AiEffort>;
  /** switches of the AI features; modules add theirs (each with a default) */
  features: {
    assistant: boolean;
    proposals: boolean; // the assistant may prepare drafts for confirmation
    files: boolean; // images and PDFs may be sent to the models (questions with files, a module's document reading)
    agents: boolean; // AI agents run (the organisation's kill switch: off stops every agent at its next step)
    virtual_agent: boolean; // the virtual agent («دستیار مجازی») answers requesters with a model (rule-based routing stays)
  };
  /** masked = national ids, mobiles, card numbers and IBANs are masked before anything reaches a model */
  data_policy: AiDataPolicy;
  budgets: { monthly_usd: string | null; user_daily_usd: string | null; alert_pct: number };
  /** free text the organisation writes about itself and how answers should look */
  instructions: string;
  retention_days: number;
  /** Windows app linked to the web version: send model calls through the web version's connections */
  use_cloud: boolean;
  /**
   * Windows app with use_cloud on: jobs the web version answers first («اول نسخهٔ وب»); this computer's connections
   * answer them only when the web version cannot. Always empty on the web version.
   */
  cloud_first: AiJob[];
  /** «نمایه و بازیابی» (retrieval) */
  rag: AiRagSettings;
}

// ---------------------------------------------------------------- assistant: references, proposals, events

/** A link to a record the answer talks about (rendered as a chip that opens the record). */
export interface AiRef {
  type: string; // "member" | "org" | "report" | a module's record type («incident», «asset»…)
  id: string;
  label: string;
  path?: string; // in-app path (without the org prefix), e.g. "settings/users"
}

export type AiProposalStatus = "proposed" | "executing" | "executed" | "rejected" | "expired" | "failed";

/** What applying a proposal did, row by row (a batch proposal): counts and each row's result. */
export interface AiProposalOutcome {
  ok: number;
  failed: number;
  rows: { label: string; ok: boolean; message?: string | null; path?: string | null }[];
}

/** A write the assistant prepared; nothing happens until a permitted person confirms it. */
export interface AiProposal {
  id: string;
  kind: string; // the executor that runs it once confirmed (src/server/modules/ai/tools/proposals.ts), e.g. a module's «incident»
  title_fa: string;
  summary_fa: string;
  /** rows shown on the card: label/value pairs, money as formatted strings */
  preview: { label: string; value: string }[];
  lines?: { cells: string[] }[];
  line_headers?: string[];
  warnings?: string[];
  status: AiProposalStatus;
  /** where the same data can be opened in its normal form for editing instead of confirming here */
  edit_path?: string;
  result?: AiRef | null;
  error?: string | null;
  expires_at: string;
  /** a batch proposal: how many records it changes (the card shows the count and a sample in `lines`) */
  count?: number;
  /** what applying it did, row by row (batch proposals report every row; a failed row never stops the others) */
  outcome?: AiProposalOutcome | null;
  /** an AI agent's proposal: the agent (docs/spec/AI.md §11.8) */
  agent?: { key: string; name: string } | null;
  /** the record it is about (a batch: the table only) */
  record?: { table: string; id: string | null } | null;
}

export interface AiChartSpec {
  kind: "bar" | "line" | "area" | "pie";
  title?: string;
  x: string; // field name
  series: { field: string; label: string }[];
  unit?: string;
}

/** Server-sent events of POST /ai/chat and POST /ai/threads/:id/continue. */
export type AiStreamEvent =
  | { type: "meta"; thread_id: string; message_id: string; model: string | null; connection: string | null }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; call_id: string; tool: string; title_fa: string; input_fa?: string }
  | { type: "tool_end"; call_id: string; ok: boolean; summary_fa?: string; refs?: AiRef[]; data_ref?: string | null }
  | { type: "proposal"; proposal: AiProposal }
  | { type: "chart"; data_ref: string; spec: AiChartSpec }
  | { type: "table"; data_ref: string; title?: string; columns: { key: string; title: string; numeric?: boolean }[]; total_rows: number }
  | { type: "usage"; input: number; output: number; cache_read: number; cache_write: number; cost_usd: string | null }
  | { type: "continue"; thread_id: string } // the step budget of this request ran out: POST /ai/threads/:id/continue
  | { type: "error"; kind: AiErrorKind; message_fa: string }
  | { type: "done"; message_id: string; stop: "end" | "max_steps" | "stopped" | "error" | "refusal" };

/** Context the UI sends with a question (the page the user is on and what is selected). */
export interface AiPageContext {
  path?: string; // current route without the org prefix
  title?: string; // page title
  record?: { type: string; id: string; label?: string } | null;
  report?: { key: string; params?: Record<string, unknown> } | null;
  /** a list page: the table it lists and its filters from the query string */
  list?: { table: string; params?: Record<string, string> } | null;
}

export interface AiThreadSummary {
  id: string;
  title: string;
  updated_at: string;
  pinned: boolean;
}

/** A message as stored and shown again when a conversation is reopened. */
export interface AiMessageView {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
  tools?: { call_id: string; tool: string; title_fa: string; ok: boolean; summary_fa?: string }[];
  refs?: AiRef[];
  proposals?: AiProposal[];
  charts?: { data_ref: string; spec: AiChartSpec }[];
  tables?: { data_ref: string; title?: string; columns: { key: string; title: string; numeric?: boolean }[]; total_rows: number }[];
  attachments?: { name: string; mime: string }[];
  rating?: 1 | -1 | null;
  model?: string | null;
  /** how the answer ended (assistant messages) */
  status?: "done" | "running" | "pending" | "stopped" | "error" | "refusal" | "max_steps";
  /** why the answer could not be completed */
  error?: { kind: AiErrorKind; message_fa: string } | null;
  /** a step budget ran out: POST /threads/:id/continue finishes it */
  can_continue?: boolean;
}

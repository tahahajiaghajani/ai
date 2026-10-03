/**
 * Provider-neutral message format. Each adapter (Google, Anthropic, OpenAI-compatible) converts it
 * to its own wire format. Assistant turns keep the provider's raw content (`raw`) so a tool loop can
 * hand back exactly what the model produced (Gemini thought signatures, Claude thinking blocks).
 */
import type { ProviderProtocol } from "@/lib/ai/providers";

export type Block =
  | { type: "text"; text: string }
  /** binary file (image/PDF) as base64; adapters that cannot take it get `fallback` text instead */
  | { type: "file"; name: string; mime: string; data: string; fallback?: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean };

export interface LlmMessage {
  role: "user" | "assistant";
  content: Block[];
  /** provider-native content of an assistant turn (replayed as-is to the same protocol) */
  raw?: { protocol: ProviderProtocol; model: string; content: unknown };
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON schema of the input object */
  parameters: Record<string, unknown>;
}

export type Effort = "LOW" | "MEDIUM" | "HIGH";

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  /** ask for JSON matching this schema (no tools in the same request) */
  json?: Record<string, unknown>;
  effort?: Effort;
  maxOutputTokens?: number;
  /** Google Search grounding / provider web search, when supported */
  useSearch?: boolean;
  signal?: AbortSignal;
}

export interface LlmHooks {
  /** total visible text so far (throttled by the caller) */
  onText?: (chars: number) => void;
  /** a readable fragment of the model's reasoning summary, when the provider exposes one */
  onThought?: (text: string) => void;
}

export interface LlmUsage {
  input: number;
  output: number;
  thoughts: number;
}

export interface LlmResponse {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  stop: "end" | "tool" | "max_tokens" | "refusal" | "aborted";
  usage: LlmUsage;
  model: string;
  /** provider-native assistant content (see LlmMessage.raw) */
  raw: unknown;
  searchQueries?: string[];
}

export interface LlmAdapter {
  protocol: ProviderProtocol;
  /** one model turn (streamed); never throws on abort: returns stop "aborted" with the partial text */
  turn(req: LlmRequest, hooks?: LlmHooks): Promise<LlmResponse>;
  listModels(): Promise<string[]>;
}

/** Normalised provider error, used to decide: retry, next model, pause the connection, or fail. */
export interface LlmErrorInfo {
  kind: "rate" | "quota_daily" | "quota_none" | "overloaded" | "auth" | "invalid" | "media" | "other";
  status: number;
  message: string;
  retryAfterMs: number | null;
}

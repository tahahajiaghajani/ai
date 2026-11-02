// Provider-neutral messages, tools and turn results shared by the adapters, the routing chain, the
// assistant loop and the Windows→web relay. Assistant turns keep the provider's own content
// (`native`) so the next turn can replay it unchanged (thinking blocks, encrypted reasoning items,
// thought signatures); history is append-only.
import type { AiEffort, AiErrorKind, AiProtocol } from "@shared/ai/types";
import type { AiPreset } from "@shared/ai/presets";

export type Part =
  | { type: "text"; text: string }
  /** image or PDF as base64 — only ever in user turns */
  | { type: "file"; name?: string; mime: string; data: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; content: string; is_error?: boolean };

export interface NativeContent {
  protocol: AiProtocol;
  model: string;
  /** the connection that produced it: replayed only to the same account */
  connection_id: string;
  content: unknown;
}

export interface NeutralMessage {
  role: "user" | "assistant";
  parts: Part[];
  native?: NativeContent | null;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the input object (normalised; see schema.ts) */
  schema: Record<string, unknown>;
}

export interface TurnRequest {
  model: string;
  /** stable instructions: frozen so providers can cache them */
  system: string;
  /** business notes appended after the stable instructions (data, rarely changes) */
  systemNotes?: string;
  messages: NeutralMessage[];
  tools?: ToolSpec[];
  /** structured output: the answer must be JSON matching this schema (never with tools) */
  output?: { name: string; schema: Record<string, unknown> } | null;
  effort?: AiEffort | null;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface TurnHooks {
  onText?(delta: string): void;
  onThinking?(delta: string): void;
}

export interface Usage {
  /** uncached input tokens */
  input: number;
  /** output tokens, reasoning included */
  output: number;
  cache_read: number;
  cache_write: number;
  /** part of `output` spent on reasoning */
  reasoning: number;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    reasoning: a.reasoning + b.reasoning,
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** the raw arguments could not be parsed as a JSON object */
  invalid?: string;
}

export type TurnStop =
  | "end"
  | "tool"
  | "max_tokens"
  | "refusal"
  | "aborted"
  /** a tool call's input arrived broken after visible text was streamed: the text stands alone */
  | "bad_tool_input";

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stop: TurnStop;
  usage: Usage;
  /** the model that answered (a provider-side fallback may name another) */
  model: string;
  /** provider-native assistant content for replay (null when the turn was cut short) */
  native: unknown;
  /** cost reported by the provider itself (OpenRouter), USD */
  providerCostUsd?: string | null;
}

export interface Adapter {
  protocol: AiProtocol;
  /** one streamed model turn; never throws on abort (returns stop "aborted" with the partial text) */
  turn(req: TurnRequest, hooks?: TurnHooks): Promise<TurnResult>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}

/** A connection ready to call: the key is decrypted only for the call. */
export interface ResolvedConnection {
  id: string;
  label: string;
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
  key: string | null;
}

export interface AdapterEnv {
  fetch: typeof fetch;
  mode: "cloud" | "desktop";
  publicUrl?: string;
}

/** A provider error normalised to an AiErrorKind (messages are scrubbed of key patterns). */
export class ProviderError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
    public status: number | null = null,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

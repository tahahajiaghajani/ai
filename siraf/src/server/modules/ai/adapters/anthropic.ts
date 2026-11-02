// Claude through the official SDK (@anthropic-ai/sdk 1.x, API version 2026-10-21): a streamed
// manual loop step — client.beta.messages.stream() + finalMessage(). Rules (claude-api notes):
// no temperature/top_p/top_k, adaptive thinking (omitted or {type:"adaptive"}), an explicit
// output_config.effort, never a forced tool_choice, strict tools with eager input streaming (the
// loop validates every input with zod), refusal handling, server-side fallbacks on the Claude API
// itself, prompt caching (frozen tools + system first, top-level cache_control), images/PDF only in
// user turns, the full assistant content stored and replayed unchanged (thinking blocks included).
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { anthropicAdaptive, anthropicEffortSupported } from "@shared/ai/effort";
import { scrubSecrets } from "../crypto";
import { ProviderError, type Adapter, type AdapterEnv, type NeutralMessage, type ResolvedConnection, type ToolCall, type TurnRequest, type TurnResult, ZERO_USAGE } from "../types";
import { classifyStatus, isAbort, retryAfterMs } from "./http";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Preserved thinking: what to do with a replayed thinking block whose conversation changed. */
const BINDING_BETA = "thinking-binding-controls-2026-08-01";
/** The 400 of an enforced account whose replayed history no longer matches a thinking block. */
const BINDING_RE = /bound to a different conversation|prefix_mismatch_behavior/i;

/**
 * What a connection turned out not to accept (or to need), kept for the process so that every
 * later request does not pay for the same failed call again: a gateway without the fallback beta
 * or strict tools, or an account that needs `drop_block` for threads whose earlier turns changed
 * (business notes or the tool set edited since).
 */
const QUIRKS = new Map<string, { noBetas?: boolean; noStrict?: boolean; dropBlock?: boolean }>();
function quirks(id: string) {
  let q = QUIRKS.get(id);
  if (!q) QUIRKS.set(id, (q = {}));
  return q;
}

const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/**
 * The JSON-schema subset Claude accepts for strict tools and structured outputs: every object
 * closed (`additionalProperties: false`), no numeric/length/size constraints, no defaults or
 * open maps. Like the SDK's own transform, a dropped constraint is kept as a hint in the
 * description; zod validates the answer against the full schema afterwards.
 */
export function anthropicSchema(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown): Record<string, unknown> => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return {};
    const src = { ...(node as Record<string, unknown>) };
    const out: Record<string, unknown> = {};
    const take = (k: string) => {
      const v = src[k];
      delete src[k];
      return v;
    };
    const ref = take("$ref");
    if (typeof ref === "string") return { $ref: ref };
    const defs = take("$defs");
    if (defs && typeof defs === "object") out.$defs = Object.fromEntries(Object.entries(defs as Record<string, unknown>).map(([k, v]) => [k, walk(v)]));
    for (const k of ["anyOf", "oneOf"]) {
      const v = take(k);
      if (Array.isArray(v)) out.anyOf = v.map(walk);
    }
    const allOf = take("allOf");
    if (Array.isArray(allOf)) out.allOf = allOf.map(walk);
    const type = take("type");
    if (type !== undefined) out.type = type;
    for (const k of ["description", "title", "enum", "const"]) {
      const v = take(k);
      if (v !== undefined) out[k] = v;
    }
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("object") || src.properties) {
      const props = (take("properties") ?? {}) as Record<string, unknown>;
      out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, walk(v)]));
      const req = take("required");
      if (Array.isArray(req) && req.length) out.required = req.filter((k) => typeof k === "string" && k in props);
      take("additionalProperties");
      take("propertyNames");
      take("patternProperties");
      out.additionalProperties = false;
    }
    if (types.includes("array") || src.items) {
      const items = take("items");
      if (items && typeof items === "object" && !Array.isArray(items)) out.items = walk(items);
      const min = take("minItems");
      if (min === 0 || min === 1) out.minItems = min;
      else if (min !== undefined) src.minItems = min;
    }
    if (types.includes("string")) {
      const f = take("format");
      if (typeof f === "string" && SUPPORTED_FORMATS.has(f)) out.format = f;
      else if (f !== undefined) src.format = f;
    }
    // defaults and examples are not constraints, and zod's safe-integer bounds say nothing: dropped without a hint
    for (const k of ["default", "examples", "$schema", "$id", "prefixItems"]) delete src[k];
    for (const k of ["minimum", "maximum"]) if (typeof src[k] === "number" && Math.abs(src[k] as number) >= Number.MAX_SAFE_INTEGER) delete src[k];
    // a union of primitive types as anyOf (the form every grammar compiler takes)
    if (Array.isArray(out.type) && !out.anyOf && out.type.every((t) => ["string", "number", "integer", "boolean", "null"].includes(String(t)))) {
      out.anyOf = (out.type as string[]).map((t) => ({ type: t }));
      delete out.type;
    }
    const left = Object.entries(src).filter(([, v]) => v !== undefined);
    if (left.length) {
      const hint = `{${left.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}}`;
      out.description = out.description ? `${String(out.description)}\n\n${hint}` : hint;
    }
    return out;
  };
  const root = walk(schema);
  if (root.type !== "object") return { type: "object", properties: {}, additionalProperties: false };
  return root;
}

/** The Claude API itself (server-side fallbacks and betas are only sent there). */
export function isOfficialAnthropic(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}

function fallbackModel(model: string): boolean {
  return /^claude-(opus|sonnet)-5-5/.test(model);
}

function toolResultBlock(p: { id: string; content: string; is_error?: boolean }): BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: p.id, content: p.content || "(empty)", ...(p.is_error ? { is_error: true } : {}) };
}

function userContent(m: NeutralMessage, media: { images: boolean; pdf: boolean }): BetaContentBlockParam[] {
  const results: BetaContentBlockParam[] = [];
  const files: BetaContentBlockParam[] = [];
  const texts: BetaContentBlockParam[] = [];
  for (const p of m.parts) {
    if (p.type === "tool_result") results.push(toolResultBlock(p));
    else if (p.type === "file") {
      if (p.mime === "application/pdf" && media.pdf) {
        files.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } });
      } else if (/^image\/(png|jpeg|gif|webp)$/.test(p.mime) && media.images) {
        files.push({ type: "image", source: { type: "base64", media_type: p.mime as "image/png", data: p.data } });
      } else texts.push({ type: "text", text: `[attachment ${p.name ?? ""} (${p.mime}) cannot be read by this model]` });
    } else if (p.type === "text" && p.text) texts.push({ type: "text", text: p.text });
  }
  // tool results first (the API requires it), then documents before the question
  const out = [...results, ...files, ...texts];
  return out.length ? out : [{ type: "text", text: "." }];
}

function assistantContent(m: NeutralMessage, conn: ResolvedConnection, model: string): BetaContentBlockParam[] {
  const n = m.native;
  if (n && n.protocol === "anthropic" && n.connection_id === conn.id && n.model === model && Array.isArray(n.content) && n.content.length) {
    return n.content as BetaContentBlockParam[];
  }
  const out: BetaContentBlockParam[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && p.text) out.push({ type: "text", text: p.text });
    else if (p.type === "tool_call") out.push({ type: "tool_use", id: p.id, name: p.name, input: p.input });
  }
  return out.length ? out : [{ type: "text", text: "." }];
}

export function toAnthropicMessages(messages: NeutralMessage[], conn: ResolvedConnection, model: string): BetaMessageParam[] {
  const media = conn.preset.media;
  return messages.map((m) => (m.role === "user" ? { role: "user", content: userContent(m, media) } : { role: "assistant", content: assistantContent(m, conn, model) }));
}

/** Map an SDK error to a ProviderError (most specific class first). */
export function anthropicError(err: unknown, known: (string | null)[]): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", "پاسخی در زمان مقرر نرسید");
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("network", scrubSecrets(err.message, known).slice(0, 300));
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { type?: string; message?: string } } | undefined;
    const type = body?.error?.type ?? null;
    const msg = scrubSecrets(`${err.status ?? ""}: ${body?.error?.message ?? err.message}`, known);
    const status = typeof err.status === "number" ? err.status : 0;
    const kind = type === "overloaded_error" ? "overloaded" : type === "rate_limit_error" ? classifyStatus(429, msg, type) : status ? classifyStatus(status, msg, type) : "other";
    return new ProviderError(kind, msg, status || null, retryAfterMs(err.headers as Headers | undefined, msg));
  }
  return new ProviderError("other", scrubSecrets(String((err as Error)?.message ?? err), known).slice(0, 300));
}

export function anthropicAdapter(conn: ResolvedConnection, env: AdapterEnv): Adapter {
  const official = isOfficialAnthropic(conn.baseUrl);
  const key = conn.key ?? "";
  const client = new Anthropic({
    apiKey: key || "none",
    baseURL: conn.baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, ""),
    fetch: env.fetch,
    // the routing chain decides about retries and fallbacks; the SDK must not wait on its own
    maxRetries: 0,
    timeout: 280_000,
    // gateways and proxies often read X-Api-Key instead of the Bearer header
    ...(official || !key ? {} : { defaultHeaders: { "x-api-key": key } }),
  });
  // a gateway that rejects the fallback beta or strict tools gets them no more (per connection)
  const q = quirks(conn.id);

  async function once(req: TurnRequest, hooks: Parameters<Adapter["turn"]>[1], state: { emitted: boolean; text: string }): Promise<TurnResult> {
    const system: BetaTextBlockParam[] = [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }];
    if (req.systemNotes) system.push({ type: "text", text: req.systemNotes });
    const tools: BetaTool[] | undefined = req.tools?.length
      ? req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          ...(q.noStrict
            ? { input_schema: t.schema as BetaTool["input_schema"] }
            : { input_schema: anthropicSchema(t.schema) as BetaTool["input_schema"], strict: true, eager_input_streaming: true }),
        }))
      : undefined;
    const adaptive = anthropicAdaptive(req.model);
    const betas = [...(official && !q.noBetas && fallbackModel(req.model) ? [FALLBACK_BETA] : []), ...(adaptive && q.dropBlock ? [BINDING_BETA] : [])];
    const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      system,
      messages: toAnthropicMessages(req.messages, conn, req.model),
      cache_control: { type: "ephemeral" },
      stream: true,
      ...(tools ? { tools } : {}),
      ...(adaptive ? { thinking: { type: "adaptive", display: "summarized", ...(q.dropBlock ? { block_binding: { prefix_mismatch_behavior: "drop_block" as const } } : {}) } } : {}),
      ...((req.effort && anthropicEffortSupported(req.model)) || req.output
        ? {
            output_config: {
              ...(req.effort && anthropicEffortSupported(req.model) ? { effort: req.effort } : {}),
              ...(req.output ? { format: { type: "json_schema", schema: anthropicSchema(req.output.schema) } } : {}),
            },
          }
        : {}),
      ...(betas.length ? { betas } : {}),
      ...(betas.includes(FALLBACK_BETA) ? { fallbacks: "default" as const } : {}),
    };
    const stream = client.beta.messages.stream(params, { signal: req.signal });
    stream.on("text", (d) => {
      state.emitted = true;
      state.text += d;
      hooks?.onText?.(d);
    });
    stream.on("thinking", (d) => hooks?.onThinking?.(d));
    let message: BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (req.signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
        return { text: state.text, toolCalls: [], stop: "aborted", usage: { ...ZERO_USAGE }, model: req.model, native: null };
      }
      throw err;
    }
    const u = message.usage;
    const usage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      cache_write: u.cache_creation_input_tokens ?? 0,
      reasoning: u.output_tokens_details?.thinking_tokens ?? 0,
    };
    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolUses = message.content.filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use");
    const toolCalls: ToolCall[] = toolUses.map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input && typeof b.input === "object" && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
    }));
    const base = { text, usage, model: message.model ?? req.model, native: JSON.parse(JSON.stringify(message.content)) as unknown };
    if (message.stop_reason === "refusal") return { ...base, toolCalls: [], stop: "refusal", native: null };
    // a tool input cut off at max_tokens can still look valid: never run it
    if (message.stop_reason === "max_tokens") return { ...base, toolCalls: [], stop: "max_tokens", native: toolCalls.length ? null : base.native };
    return { ...base, toolCalls, stop: toolCalls.length ? "tool" : "end" };
  }

  return {
    protocol: "anthropic",
    async turn(req, hooks) {
      const state = { emitted: false, text: "" };
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(req, hooks, state);
        } catch (err) {
          if (req.signal?.aborted) return { text: state.text, toolCalls: [], stop: "aborted", usage: { ...ZERO_USAGE }, model: req.model, native: null };
          const isApi = err instanceof Anthropic.APIError;
          const status = isApi ? (err as InstanceType<typeof Anthropic.APIError>).status : null;
          const msg = String((err as Error)?.message ?? "");
          if (attempt < 2 && !state.emitted && status === 400) {
            // preserved thinking: an earlier turn of this thread changed (business notes or the
            // tool set edited since); its reasoning is dropped instead of failing the thread
            if (!q.dropBlock && anthropicAdaptive(req.model) && BINDING_RE.test(msg)) {
              q.dropBlock = true;
              continue;
            }
            // gateways that do not know the fallback beta, strict tools or eager streaming
            if (official && !q.noBetas && fallbackModel(req.model) && /beta|fallback/i.test(msg) && !BINDING_RE.test(msg)) {
              q.noBetas = true;
              continue;
            }
            if (!q.noStrict && req.tools?.length && /strict|eager_input_streaming|schema/i.test(msg)) {
              q.noStrict = true;
              continue;
            }
          }
          // eager input streaming: a tool input that is not parseable JSON rejects finalMessage
          if (!isApi && !isAbort(err) && attempt < 1 && !(err instanceof Anthropic.APIConnectionError) && /json|parse/i.test(msg)) {
            if (state.emitted) return { text: state.text, toolCalls: [], stop: "bad_tool_input", usage: { ...ZERO_USAGE }, model: req.model, native: null };
            continue;
          }
          throw anthropicError(err, [key]);
        }
      }
    },
    async listModels(signal) {
      try {
        const out: string[] = [];
        for await (const m of client.models.list({ limit: 100 }, { signal })) {
          out.push(m.id);
          if (out.length >= 300) break;
        }
        return out;
      } catch (err) {
        throw anthropicError(err, [key]);
      }
    },
  };
}

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Block, LlmAdapter, LlmErrorInfo, LlmMessage, LlmRequest, LlmResponse } from "@/lib/ai/llm/types";

const clients = new Map<string, Anthropic>();

function client(apiKey: string, baseURL?: string | null): Anthropic {
  const key = `${baseURL ?? ""}|${apiKey}`;
  let c = clients.get(key);
  if (!c) {
    // retries are handled by the app's queue (model fallback, pausing the connection)
    c = new Anthropic({ apiKey, baseURL: baseURL || undefined, maxRetries: 0, timeout: 15 * 60_000 });
    clients.set(key, c);
  }
  return c;
}

/** Models with adaptive thinking and the effort control (Claude 4.6 and later, except Haiku). */
function adaptive(model: string): boolean {
  return /claude-(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])/.test(model);
}

/** Models where a declined (refused) request is re-run server-side on Anthropic's recommended fallback. */
function serverFallback(model: string): boolean {
  return /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/.test(model);
}

const EFFORT = { LOW: "low", MEDIUM: "medium", HIGH: "high" } as const;

/**
 * Structured outputs need `additionalProperties: false` on every object and do not support numeric,
 * string-length or complex array constraints, so those are removed (the app validates the result).
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "minItems", "uniqueItems"].includes(k)) continue;
    out[k] = strictSchema(v);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export function anthropicError(err: unknown): LlmErrorInfo {
  const e = err as { status?: number; message?: string; headers?: Record<string, string> | Headers };
  const status = Number(e?.status ?? 0);
  const message = e?.message ?? String(err);
  let retryAfterMs: number | null = null;
  const h = e?.headers;
  const ra = h ? (typeof (h as Headers).get === "function" ? (h as Headers).get("retry-after") : (h as Record<string, string>)["retry-after"]) : null;
  if (ra && Number.isFinite(Number(ra))) retryAfterMs = Number(ra) * 1000;
  let kind: LlmErrorInfo["kind"] = "other";
  if (err instanceof Anthropic.RateLimitError || status === 429) kind = "rate";
  else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || status === 401 || status === 403) kind = "auth";
  else if (status === 529 || status >= 500) kind = "overloaded";
  else if (status === 400 && /credit balance|billing|spend limit/i.test(message)) kind = "quota_none";
  else if (status === 400 || status === 404 || status === 413) kind = /image|document|pdf|media/i.test(message) ? "media" : "invalid";
  return { kind, status, message, retryAfterMs };
}

type Param = Record<string, unknown>;

function toContent(blocks: Block[]): Param[] {
  const out: Param[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      if (b.text) out.push({ type: "text", text: b.text });
    } else if (b.type === "file") {
      if (b.mime.startsWith("image/") && /png|jpe?g|gif|webp/.test(b.mime)) {
        out.push({ type: "text", text: `[فایل: ${b.name}]` }, { type: "image", source: { type: "base64", media_type: b.mime === "image/jpg" ? "image/jpeg" : b.mime, data: b.data } });
      } else if (b.mime === "application/pdf") {
        out.push({ type: "document", title: b.name, source: { type: "base64", media_type: "application/pdf", data: b.data } });
      } else out.push({ type: "text", text: b.fallback ?? `[فایل ${b.name} (${b.mime}) قابل خواندن نیست]` });
    } else if (b.type === "tool_call") out.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    else if (b.type === "tool_result") out.push({ type: "tool_result", tool_use_id: b.id, content: b.content || "(خالی)", ...(b.isError ? { is_error: true } : {}) });
  }
  return out;
}

function toMessages(messages: LlmMessage[]): Param[] {
  const out: Param[] = [];
  for (const m of messages) {
    const content = m.raw?.protocol === "anthropic" && Array.isArray(m.raw.content) ? (m.raw.content as Param[]) : toContent(m.content);
    if (!content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) (last.content as Param[]).push(...content);
    else out.push({ role: m.role, content });
  }
  return out;
}

export function anthropicAdapter(apiKey: string, baseUrl?: string | null): LlmAdapter {
  const ai = client(apiKey, baseUrl);
  return {
    protocol: "anthropic",

    async listModels() {
      const names: string[] = [];
      for await (const m of ai.models.list({ limit: 100 })) names.push(m.id);
      return names;
    },

    async turn(req: LlmRequest, hooks): Promise<LlmResponse> {
      const smart = adaptive(req.model);
      const output: Param = {};
      if (smart && req.effort) output.effort = EFFORT[req.effort];
      if (req.json) output.format = { type: "json_schema", schema: strictSchema(req.json) };
      const params: Param = {
        model: req.model,
        max_tokens: req.maxOutputTokens ?? 64000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: toMessages(req.messages),
        ...(smart ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
        ...(Object.keys(output).length ? { output_config: output } : {}),
      };
      if (req.tools?.length) {
        params.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true }));
      }

      let text = "";
      // a request declined by the model's safeguards is re-run server-side on the recommended fallback model
      type Streaming = { on(event: "text" | "thinking", cb: (delta: string, snapshot: string) => void): unknown; finalMessage(): Promise<unknown> };
      const stream = (
        serverFallback(req.model)
          ? ai.beta.messages.stream({ ...(params as object), betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as unknown as Parameters<typeof ai.beta.messages.stream>[0], { signal: req.signal })
          : ai.messages.stream(params as unknown as Parameters<typeof ai.messages.stream>[0], { signal: req.signal })
      ) as unknown as Streaming;
      stream.on("text", (_delta: string, snapshot: string) => {
        text = snapshot;
        hooks?.onText?.(snapshot.length);
      });
      stream.on("thinking", (_delta: string, snapshot: string) => hooks?.onThought?.(snapshot));

      let message: { content: Param[]; stop_reason: string | null; usage: { input_tokens?: number; output_tokens?: number }; model: string };
      try {
        message = (await stream.finalMessage()) as unknown as typeof message;
      } catch (err) {
        if (req.signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
          return { text, toolCalls: [], stop: "aborted", usage: { input: 0, output: 0, thoughts: 0 }, model: req.model, raw: null };
        }
        throw err;
      }
      const blocks = message.content ?? [];
      const finalText = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: String(b.id), name: String(b.name), input: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown> }));
      const reason = message.stop_reason;
      const stop: LlmResponse["stop"] = reason === "refusal" ? "refusal" : reason === "max_tokens" ? "max_tokens" : calls.length ? "tool" : "end";
      return {
        text: finalText,
        toolCalls: stop === "tool" ? calls : [],
        stop,
        usage: { input: message.usage?.input_tokens ?? 0, output: message.usage?.output_tokens ?? 0, thoughts: 0 },
        model: message.model || req.model,
        raw: blocks,
      };
    },
  };
}

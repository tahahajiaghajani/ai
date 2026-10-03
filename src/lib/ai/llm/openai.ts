import "server-only";
import { providerPreset } from "@/lib/ai/providers";
import type { Block, LlmAdapter, LlmErrorInfo, LlmMessage, LlmRequest, LlmResponse } from "@/lib/ai/llm/types";

/**
 * OpenAI-compatible Chat Completions (OpenAI, Kimi/Moonshot, NVIDIA build, OpenRouter, custom).
 * Plain fetch + server-sent events, so vendor differences stay visible and easy to handle.
 */
export class HttpLlmError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null,
    public retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "HttpLlmError";
  }
}

/**
 * A 429 is a per-minute limit unless the text says otherwise. Some providers (Google's compatible
 * endpoint) add "check your plan and billing" to every limit, so the window named in the message
 * decides first and only an explicit "no credits" means the key is out of money.
 */
export function rateKind(code: string | null, m: string): "rate" | "quota_daily" | "quota_none" {
  if (/\blimit: 0\b/.test(m)) return "quota_none";
  if (/per\s*minute|PerMinute|RPM|TPM|retry in \d/i.test(m)) return "rate";
  if (/per\s*day|PerDay|daily|RPD/i.test(m)) return "quota_daily";
  if (code === "insufficient_quota" || /insufficient_quota|insufficient (credits|balance)|credit balance|no credits|out of credits|payment required/i.test(m)) return "quota_none";
  return "rate";
}

/** "Please retry in 56.7s" in the message when no Retry-After header came. */
export function retryHint(m: string): number | null {
  const s = /retry (?:in|after) ([\d.]+)\s*s/i.exec(m);
  return s ? Math.ceil(Number(s[1]) * 1000) : null;
}

export function openaiError(err: unknown): LlmErrorInfo {
  if (err instanceof HttpLlmError) {
    const m = err.message;
    let kind: LlmErrorInfo["kind"] = "other";
    if (err.status === 429) kind = rateKind(err.code, m);
    else if (err.status === 401 || err.status === 403) kind = "auth";
    else if (err.status === 402) kind = "quota_none";
    else if (err.status >= 500) kind = "overloaded";
    else if (err.status === 400 || err.status === 404 || err.status === 413 || err.status === 422) kind = /image|file|pdf|media|vision|multimodal/i.test(m) ? "media" : "invalid";
    return { kind, status: err.status, message: m, retryAfterMs: err.retryAfterMs ?? retryHint(m) };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { kind: /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(message) ? "overloaded" : "other", status: 0, message, retryAfterMs: null };
}

type Msg = Record<string, unknown>;

function userContent(blocks: Block[], media: { images: boolean; pdf: boolean }): string | Msg[] {
  const parts: Msg[] = [];
  for (const b of blocks) {
    if (b.type === "text") parts.push({ type: "text", text: b.text });
    else if (b.type === "file") {
      if (media.images && b.mime.startsWith("image/")) {
        parts.push({ type: "text", text: `[فایل: ${b.name}]` }, { type: "image_url", image_url: { url: `data:${b.mime};base64,${b.data}` } });
      } else if (media.pdf && b.mime === "application/pdf") {
        parts.push({ type: "file", file: { filename: b.name, file_data: `data:application/pdf;base64,${b.data}` } });
      } else parts.push({ type: "text", text: b.fallback ?? `[فایل ${b.name} (${b.mime}) برای این مدل قابل ارسال نیست]` });
    }
  }
  return parts.every((p) => p.type === "text") ? parts.map((p) => String(p.text)).join("\n") : parts;
}

/** Gemini's OpenAI-compatible endpoint also needs a (placeholder) thought signature on replayed calls. */
const GEMINI_SKIP = { google: { thought_signature: "skip_thought_signature_validator" } };

function toMessages(system: string, messages: LlmMessage[], media: { images: boolean; pdf: boolean }, gemini = false): Msg[] {
  const out: Msg[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (m.raw?.protocol === "openai" && m.raw.content && typeof m.raw.content === "object") {
        out.push(m.raw.content as Msg);
        continue;
      }
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const calls = m.content.filter((b) => b.type === "tool_call") as Extract<Block, { type: "tool_call" }>[];
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) }, ...(gemini ? { extra_content: GEMINI_SKIP } : {}) })) }
          : {}),
      });
      continue;
    }
    // user turn: tool results become "tool" messages, everything else one user message
    const results = m.content.filter((b) => b.type === "tool_result") as Extract<Block, { type: "tool_result" }>[];
    for (const r of results) out.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content || "(خالی)" });
    const rest = m.content.filter((b) => b.type !== "tool_result");
    if (rest.length) out.push({ role: "user", content: userContent(rest, media) });
  }
  return out;
}

async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<Msg> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as Msg;
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
}

function isReasoningModel(model: string) {
  return /^(o\d|gpt-5)/.test(model);
}

export function openaiAdapter(provider: string, apiKey: string, baseUrl: string | null): LlmAdapter {
  const preset = providerPreset(provider);
  const base = (baseUrl || preset.baseUrl || "").replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(provider === "openrouter" ? { "HTTP-Referer": "https://github.com/taskflow-ai", "X-Title": "TaskFlow AI" } : {}),
  };

  async function post(body: Msg, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text.slice(0, 1500) || res.statusText;
      let code: string | null = null;
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } | string; message?: string; detail?: string };
        const e = typeof j.error === "object" ? j.error : null;
        message = e?.message ?? (typeof j.error === "string" ? j.error : null) ?? j.message ?? j.detail ?? message;
        code = e?.code ?? e?.type ?? null;
      } catch {
        /* not JSON */
      }
      const ra = Number(res.headers.get("retry-after"));
      throw new HttpLlmError(res.status, `${res.status}: ${message}`, code, Number.isFinite(ra) && ra > 0 ? ra * 1000 : null);
    }
    return res;
  }

  return {
    protocol: "openai",

    async listModels() {
      const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new HttpLlmError(res.status, `${res.status}: ${(await res.text()).slice(0, 300)}`, null, null);
      const j = (await res.json()) as { data?: { id: string }[] };
      return (j.data ?? []).map((m) => m.id).filter(Boolean);
    },

    async turn(req: LlmRequest, hooks): Promise<LlmResponse> {
      const official = provider === "openai";
      const max = req.maxOutputTokens ?? (req.json ? 32768 : 16384);
      const body: Msg = {
        model: req.model,
        messages: toMessages(req.system, req.messages, preset.media, /generativelanguage\.googleapis\.com/.test(base)),
        stream: true,
        ...(official ? { max_completion_tokens: max } : { max_tokens: max }),
        ...(official || provider === "openrouter" ? { stream_options: { include_usage: true } } : {}),
      };
      if (official && req.effort && isReasoningModel(req.model)) body.reasoning_effort = req.effort.toLowerCase();
      if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (req.json) {
        body.response_format = official
          ? { type: "json_schema", json_schema: { name: "result", schema: req.json, strict: false } }
          : { type: "json_object" };
      }

      let text = "";
      let reasoning = "";
      let finish: string | null = null;
      let model = req.model;
      const usage = { input: 0, output: 0, thoughts: 0 };
      // extra: provider additions that must be sent back as received (Gemini's thought signatures)
      const calls = new Map<number, { id: string; name: string; args: string; extra?: Msg }>();
      let res: Response;
      try {
        res = await post(body, req.signal);
      } catch (err) {
        if (req.signal?.aborted) return { text, toolCalls: [], stop: "aborted", usage, model, raw: null };
        throw err;
      }
      try {
        for await (const ev of sse(res.body!)) {
          if (typeof ev.model === "string") model = ev.model;
          const u = ev.usage as { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
          if (u) {
            usage.input = u.prompt_tokens ?? usage.input;
            usage.output = u.completion_tokens ?? usage.output;
            usage.thoughts = u.completion_tokens_details?.reasoning_tokens ?? usage.thoughts;
          }
          const choice = (ev.choices as Msg[] | undefined)?.[0];
          if (!choice) continue;
          const delta = (choice.delta ?? {}) as Msg;
          if (typeof delta.content === "string" && delta.content) {
            text += delta.content;
            hooks?.onText?.(text.length);
          }
          const r = (delta.reasoning_content ?? delta.reasoning) as string | undefined;
          if (typeof r === "string" && r) {
            reasoning += r;
            hooks?.onThought?.(reasoning);
          }
          for (const tc of (delta.tool_calls as Msg[] | undefined) ?? []) {
            const i = Number(tc.index ?? 0);
            const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
            const cur = calls.get(i) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = String(tc.id);
            if (fn.name) cur.name += fn.name;
            if (fn.arguments) cur.args += fn.arguments;
            if (tc.extra_content && typeof tc.extra_content === "object") cur.extra = { ...(cur.extra ?? {}), ...(tc.extra_content as Msg) };
            calls.set(i, cur);
          }
          if (choice.finish_reason) finish = String(choice.finish_reason);
        }
      } catch (err) {
        if (req.signal?.aborted) return { text, toolCalls: [], stop: "aborted", usage, model, raw: null };
        throw err;
      }

      const toolCalls = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([i, c]) => {
          let input: Record<string, unknown> = {};
          try {
            input = c.args.trim() ? (JSON.parse(c.args) as Record<string, unknown>) : {};
          } catch {
            input = { __invalid_json: c.args.slice(0, 2000) };
          }
          return { id: c.id || `call_${i}`, name: c.name, input, args: c.args, extra: c.extra };
        })
        .filter((c) => c.name);
      const raw: Msg = {
        role: "assistant",
        content: text || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length
          ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || JSON.stringify(c.input) }, ...(c.extra ? { extra_content: c.extra } : {}) })) }
          : {}),
      };
      const stop: LlmResponse["stop"] = toolCalls.length ? "tool" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end";
      return { text, toolCalls: toolCalls.map(({ id, name, input }) => ({ id, name, input })), stop, usage, model, raw };
    },
  };
}

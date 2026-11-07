// OpenAI-compatible Chat Completions — every other service: OpenRouter, DeepSeek, Qwen, Kimi,
// Mistral, Groq, xAI, NVIDIA, Metis, AvalAI, GapGPT, other Iranian gateways, Ollama, LM Studio,
// llama.cpp. Raw fetch + server-sent events (ported from Task Flow) so vendor differences stay
// visible: reasoning_content, Gemini-compatible thought signatures, OpenRouter's reported cost.
import { chatReasoningEffort } from "@shared/ai/effort";
import { ProviderError, type Adapter, type AdapterEnv, type NeutralMessage, type ResolvedConnection, type ToolCall, type TurnRequest, type TurnResult, ZERO_USAGE } from "../types";
import { IDLE_MS, connectMs, errorFromResponse, idleSignal, joinUrl, networkError, parseArgs, readSse } from "./http";
import { APP_NAME_EN } from "@shared/constants";

type Msg = Record<string, unknown>;

/** Gemini's OpenAI-compatible endpoint needs a (placeholder) thought signature on replayed calls. */
const GEMINI_SKIP = { google: { thought_signature: "skip_thought_signature_validator" } };

function userContent(m: NeutralMessage, media: { images: boolean; pdf: boolean }): string | Msg[] {
  const parts: Msg[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && p.text) parts.push({ type: "text", text: p.text });
    else if (p.type === "file") {
      if (media.images && p.mime.startsWith("image/")) parts.push({ type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } });
      else if (media.pdf && p.mime === "application/pdf") parts.push({ type: "file", file: { filename: p.name ?? "document.pdf", file_data: `data:application/pdf;base64,${p.data}` } });
      else parts.push({ type: "text", text: `[attachment ${p.name ?? ""} (${p.mime}) cannot be read by this model]` });
    }
  }
  if (!parts.length) return ".";
  return parts.every((p) => p.type === "text") ? parts.map((p) => String(p.text)).join("\n") : parts;
}

export function toChatMessages(req: TurnRequest, conn: ResolvedConnection, gemini: boolean): Msg[] {
  const system = req.systemNotes ? `${req.system}\n\n${req.systemNotes}` : req.system;
  const out: Msg[] = [{ role: "system", content: system }];
  for (const m of req.messages) {
    if (m.role === "assistant") {
      const n = m.native;
      if (n && n.protocol === "openai-chat" && n.connection_id === conn.id && n.content && typeof n.content === "object") {
        out.push(n.content as Msg);
        continue;
      }
      const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
      const calls = m.parts.filter((p): p is Extract<typeof p, { type: "tool_call" }> => p.type === "tool_call");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) }, ...(gemini ? { extra_content: GEMINI_SKIP } : {}) })) }
          : {}),
      });
      continue;
    }
    for (const p of m.parts) if (p.type === "tool_result") out.push({ role: "tool", tool_call_id: p.id, content: p.is_error ? `ERROR: ${p.content}` : p.content || "(empty)" });
    const rest: NeutralMessage = { role: "user", parts: m.parts.filter((p) => p.type !== "tool_result") };
    if (rest.parts.length) out.push({ role: "user", content: userContent(rest, conn.preset.media) });
  }
  return out;
}

export function openaiChatAdapter(conn: ResolvedConnection, env: AdapterEnv): Adapter {
  const base = conn.baseUrl.replace(/\/+$/, "");
  const key = conn.key;
  const gemini = /generativelanguage\.googleapis\.com/.test(base);
  const openrouter = conn.preset.id === "openrouter" || /openrouter\.ai/.test(base);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    // OpenRouter's app attribution: the name always, the site only when PUBLIC_URL says what it is
    ...(openrouter ? { "X-Title": APP_NAME_EN, ...(env.publicUrl ? { "HTTP-Referer": env.publicUrl } : {}) } : {}),
  };
  // parameters a service rejected once are not sent again by this adapter
  const dropped = new Set<string>();

  async function post(body: Msg, signal: AbortSignal): Promise<Response> {
    const res = await env.fetch(joinUrl(base, "chat/completions"), { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw await errorFromResponse(res, [key]);
    return res;
  }

  function buildBody(req: TurnRequest): Msg {
    const body: Msg = {
      model: req.model,
      messages: toChatMessages(req, conn, gemini),
      stream: true,
    };
    if (!dropped.has("stream_options")) body.stream_options = { include_usage: true };
    if (conn.preset.send_max_tokens !== false && !dropped.has("max_tokens")) body.max_tokens = Math.min(req.maxTokens, 32_000);
    if (req.effort && conn.preset.chat_effort && !dropped.has("reasoning_effort")) body.reasoning_effort = chatReasoningEffort(req.effort);
    if (openrouter && req.effort && !dropped.has("reasoning")) body.reasoning = { effort: chatReasoningEffort(req.effort) };
    if (openrouter) body.usage = { include: true };
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } }));
    if (req.output) {
      body.response_format = dropped.has("json_schema")
        ? dropped.has("response_format")
          ? undefined
          : { type: "json_object" }
        : { type: "json_schema", json_schema: { name: req.output.name, schema: req.output.schema, strict: false } };
    }
    return body;
  }

  return {
    protocol: "openai-chat",
    async listModels(signal) {
      const t = idleSignal(signal, 20_000);
      try {
        const res = await env.fetch(joinUrl(base, "models"), { headers, signal: t.signal });
        if (!res.ok) throw await errorFromResponse(res, [key]);
        const j = (await res.json()) as { data?: { id?: string }[]; models?: { name?: string; model?: string }[] };
        const ids = (j.data ?? []).map((m) => m.id ?? "").concat((j.models ?? []).map((m) => m.model ?? m.name ?? ""));
        return [...new Set(ids.filter(Boolean))];
      } catch (err) {
        throw networkError(err, t.timedOut(), [key]);
      } finally {
        t.done();
      }
    },

    async turn(req, hooks): Promise<TurnResult> {
      let text = "";
      let reasoning = "";
      let finish: string | null = null;
      let model = req.model;
      let cost: string | null = null;
      const usage = { ...ZERO_USAGE };
      const calls = new Map<number, { id: string; name: string; args: string; extra?: Msg }>();
      const t = idleSignal(req.signal, connectMs(conn));
      try {
        let res: Response | null = null;
        for (let attempt = 0; !res; attempt++) {
          try {
            res = await post(buildBody(req), t.signal);
          } catch (err) {
            // an optional parameter the service does not know: drop it once and ask again
            if (err instanceof ProviderError && err.kind === "invalid" && attempt < 4) {
              const m = err.message;
              const param = ["stream_options", "reasoning_effort", "max_tokens", "json_schema", "response_format"].find((p) => m.includes(p) && !dropped.has(p))
                ?? (req.output && !dropped.has("json_schema") && /response.?format|json/i.test(m) ? "json_schema" : undefined)
                ?? (openrouter && !dropped.has("reasoning") && /reasoning/i.test(m) ? "reasoning" : undefined);
              if (param) {
                dropped.add(param);
                continue;
              }
            }
            throw err;
          }
        }
        // after the first byte the stream may think quietly for a while; any byte resets the timer
        t.touch(IDLE_MS);
        for await (const { data } of readSse(res.body!, () => t.touch())) {
          if (!data || typeof data !== "object") continue;
          const ev = data as Msg;
          if (ev.error) {
            const e = ev.error as { message?: string; code?: string | number };
            throw new ProviderError("other", String(e.message ?? "provider error").slice(0, 500));
          }
          if (typeof ev.model === "string" && ev.model) model = ev.model;
          const u = ev.usage as
            | { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number }; prompt_cache_hit_tokens?: number }
            | undefined;
          if (u) {
            const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
            usage.input = Math.max(0, (u.prompt_tokens ?? 0) - cached);
            usage.cache_read = cached;
            usage.output = u.completion_tokens ?? usage.output;
            usage.reasoning = u.completion_tokens_details?.reasoning_tokens ?? usage.reasoning;
            if (typeof u.cost === "number") cost = String(u.cost);
          }
          const choice = (ev.choices as Msg[] | undefined)?.[0];
          if (!choice) continue;
          const delta = (choice.delta ?? choice.message ?? {}) as Msg;
          if (typeof delta.content === "string" && delta.content) {
            text += delta.content;
            hooks?.onText?.(delta.content);
          }
          const r = (delta.reasoning_content ?? delta.reasoning) as unknown;
          if (typeof r === "string" && r) {
            reasoning += r;
            hooks?.onThinking?.(r);
          }
          for (const tc of (delta.tool_calls as Msg[] | undefined) ?? []) {
            const i = Number(tc.index ?? calls.size);
            const fn = (tc.function ?? {}) as { name?: string; arguments?: string };
            const cur = calls.get(i) ?? { id: "", name: "", args: "" };
            if (tc.id) cur.id = String(tc.id);
            if (fn.name) cur.name = cur.name && cur.name !== fn.name ? cur.name + fn.name : fn.name;
            if (fn.arguments) cur.args += fn.arguments;
            if (tc.extra_content && typeof tc.extra_content === "object") cur.extra = { ...(cur.extra ?? {}), ...(tc.extra_content as Msg) };
            calls.set(i, cur);
          }
          if (choice.finish_reason) finish = String(choice.finish_reason);
        }
      } catch (err) {
        if (req.signal?.aborted) return { text, toolCalls: [], stop: "aborted", usage, model, native: null };
        throw networkError(err, t.timedOut(), [key]);
      } finally {
        t.done();
      }

      const toolCalls: (ToolCall & { args: string; extra?: Msg })[] = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, c]) => c.name)
        .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, ...parseArgs(c.args), args: c.args, extra: c.extra }));
      const native: Msg = {
        role: "assistant",
        content: text || null,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length
          ? { tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" }, ...(c.extra ? { extra_content: c.extra } : gemini ? { extra_content: GEMINI_SKIP } : {}) })) }
          : {}),
      };
      const clean = toolCalls.map(({ id, name, input, invalid }) => ({ id, name, input, ...(invalid ? { invalid } : {}) }));
      if (finish === "content_filter" && !text && !clean.length) return { text, toolCalls: [], stop: "refusal", usage, model, native: null, providerCostUsd: cost };
      if (finish === "length") return { text, toolCalls: [], stop: "max_tokens", usage, model, native: clean.length ? null : native, providerCostUsd: cost };
      return { text, toolCalls: clean, stop: clean.length ? "tool" : "end", usage, model, native, providerCostUsd: cost };
    },
  };
}

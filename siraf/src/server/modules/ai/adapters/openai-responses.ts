// Official OpenAI (and xAI) through the Responses API — GPT-6.x needs it for tools together with
// reasoning. Stateless: store:false, encrypted reasoning items are requested and the turn's output
// items are stored verbatim and replayed in the next request (function_call_output answers them).
import { openaiEffort, openaiReasoningModel } from "@shared/ai/effort";
import { ProviderError, type Adapter, type AdapterEnv, type NeutralMessage, type ResolvedConnection, type ToolCall, type TurnRequest, type TurnResult, ZERO_USAGE } from "../types";
import { CONNECT_MS, IDLE_MS, errorFromResponse, idleSignal, joinUrl, networkError, parseArgs, readSse } from "./http";
import { strictSchema } from "../schema";

type Item = Record<string, unknown>;

function userItem(m: NeutralMessage, media: { images: boolean; pdf: boolean }): Item | null {
  const content: Item[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && p.text) content.push({ type: "input_text", text: p.text });
    else if (p.type === "file") {
      if (media.images && p.mime.startsWith("image/")) content.push({ type: "input_image", image_url: `data:${p.mime};base64,${p.data}` });
      else if (media.pdf && p.mime === "application/pdf") content.push({ type: "input_file", filename: p.name ?? "document.pdf", file_data: `data:application/pdf;base64,${p.data}` });
      else content.push({ type: "input_text", text: `[attachment ${p.name ?? ""} (${p.mime}) cannot be read by this model]` });
    }
  }
  return content.length ? { role: "user", content } : null;
}

export function toResponsesInput(req: TurnRequest, conn: ResolvedConnection): Item[] {
  const out: Item[] = [];
  for (const m of req.messages) {
    if (m.role === "assistant") {
      const n = m.native;
      if (n && n.protocol === "openai-responses" && n.connection_id === conn.id && n.model === req.model && Array.isArray(n.content)) {
        out.push(...(n.content as Item[]));
        continue;
      }
      const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
      if (text) out.push({ role: "assistant", content: [{ type: "output_text", text }] });
      for (const p of m.parts) if (p.type === "tool_call") out.push({ type: "function_call", call_id: p.id, name: p.name, arguments: JSON.stringify(p.input) });
      continue;
    }
    for (const p of m.parts) if (p.type === "tool_result") out.push({ type: "function_call_output", call_id: p.id, output: p.is_error ? `ERROR: ${p.content}` : p.content || "(empty)" });
    const u = userItem({ role: "user", parts: m.parts.filter((p) => p.type !== "tool_result") }, conn.preset.media);
    if (u) out.push(u);
  }
  return out;
}

export function openaiResponsesAdapter(conn: ResolvedConnection, env: AdapterEnv): Adapter {
  const base = conn.baseUrl.replace(/\/+$/, "");
  const key = conn.key;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  let sendEffort = true;

  function buildBody(req: TurnRequest): Item {
    const reasoning = openaiReasoningModel(req.model);
    const body: Item = {
      model: req.model,
      instructions: req.systemNotes ? `${req.system}\n\n${req.systemNotes}` : req.system,
      input: toResponsesInput(req, conn),
      stream: true,
      store: false,
      max_output_tokens: req.maxTokens,
      ...(reasoning ? { include: ["reasoning.encrypted_content"] } : {}),
    };
    if (reasoning) body.reasoning = { ...(req.effort && sendEffort ? { effort: openaiEffort(req.effort) } : {}), summary: "auto" };
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.schema, strict: false }));
    if (req.output) body.text = { format: { type: "json_schema", name: req.output.name, schema: strictSchema(req.output.schema), strict: true } };
    return body;
  }

  return {
    protocol: "openai-responses",
    async listModels(signal) {
      const t = idleSignal(signal, 20_000);
      try {
        const res = await env.fetch(joinUrl(base, "models"), { headers, signal: t.signal });
        if (!res.ok) throw await errorFromResponse(res, [key]);
        const j = (await res.json()) as { data?: { id?: string }[] };
        return (j.data ?? []).map((m) => m.id ?? "").filter(Boolean);
      } catch (err) {
        throw networkError(err, t.timedOut(), [key]);
      } finally {
        t.done();
      }
    },

    async turn(req, hooks): Promise<TurnResult> {
      let text = "";
      let model = req.model;
      const usage = { ...ZERO_USAGE };
      let output: Item[] | null = null;
      const done: Item[] = [];
      let status: string | null = null;
      let incomplete: string | null = null;
      let refusal = "";
      const t = idleSignal(req.signal, CONNECT_MS);
      try {
        let res: Response | null = null;
        for (let attempt = 0; !res; attempt++) {
          try {
            const r = await env.fetch(joinUrl(base, "responses"), { method: "POST", headers, body: JSON.stringify(buildBody(req)), signal: t.signal });
            if (!r.ok) throw await errorFromResponse(r, [key]);
            res = r;
          } catch (err) {
            if (err instanceof ProviderError && err.kind === "invalid" && attempt === 0 && sendEffort && /effort|reasoning/i.test(err.message)) {
              sendEffort = false;
              continue;
            }
            throw err;
          }
        }
        t.touch(IDLE_MS);
        for await (const { event, data } of readSse(res.body!, () => t.touch())) {
          if (!data || typeof data !== "object") continue;
          const ev = data as Item;
          const type = String(ev.type ?? event ?? "");
          if (type === "response.output_text.delta" && typeof ev.delta === "string") {
            text += ev.delta;
            hooks?.onText?.(ev.delta);
          } else if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && typeof ev.delta === "string") {
            hooks?.onThinking?.(ev.delta);
          } else if (type === "response.refusal.delta" && typeof ev.delta === "string") {
            refusal += ev.delta;
          } else if (type === "response.output_item.done" && ev.item && typeof ev.item === "object") {
            done.push(ev.item as Item);
          } else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
            const r = (ev.response ?? {}) as Item;
            status = String(r.status ?? type.split(".")[1]);
            if (typeof r.model === "string") model = r.model;
            if (Array.isArray(r.output)) output = r.output as Item[];
            const u = r.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } } | undefined;
            if (u) {
              const cached = u.input_tokens_details?.cached_tokens ?? 0;
              usage.input = Math.max(0, (u.input_tokens ?? 0) - cached);
              usage.cache_read = cached;
              usage.output = u.output_tokens ?? 0;
              usage.reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
            }
            incomplete = ((r.incomplete_details as { reason?: string } | null)?.reason as string | undefined) ?? null;
            if (type === "response.failed") {
              const e = (r.error ?? {}) as { code?: string; message?: string };
              throw new ProviderError(/rate/i.test(e.code ?? "") ? "rate" : /quota/i.test(e.code ?? "") ? "quota" : "overloaded", String(e.message ?? "response failed").slice(0, 400));
            }
          } else if (type === "error") {
            const e = (ev.error ?? ev) as { code?: string; message?: string };
            const code = String(e.code ?? "");
            throw new ProviderError(/rate_limit/.test(code) ? "rate" : /quota/.test(code) ? "quota" : /server|overload/.test(code) ? "overloaded" : "other", String(e.message ?? "provider error").slice(0, 400));
          }
        }
      } catch (err) {
        if (req.signal?.aborted) return { text, toolCalls: [], stop: "aborted", usage, model, native: null };
        throw networkError(err, t.timedOut(), [key]);
      } finally {
        t.done();
      }

      const items = output ?? done;
      const toolCalls: ToolCall[] = items
        .filter((i) => i.type === "function_call")
        .map((i) => ({ id: String(i.call_id ?? i.id ?? ""), name: String(i.name ?? ""), ...parseArgs(String(i.arguments ?? "")) }));
      if (!text) {
        for (const i of items) {
          if (i.type !== "message" || !Array.isArray(i.content)) continue;
          for (const c of i.content as Item[]) {
            if (c.type === "output_text" && typeof c.text === "string") text += c.text;
            if (c.type === "refusal" && typeof c.refusal === "string") refusal += c.refusal;
          }
        }
      }
      if (refusal && !text && !toolCalls.length) return { text: "", toolCalls: [], stop: "refusal", usage, model, native: null };
      if (status === "incomplete" && incomplete === "content_filter") return { text, toolCalls: [], stop: "refusal", usage, model, native: null };
      if (status === "incomplete") return { text, toolCalls: [], stop: "max_tokens", usage, model, native: toolCalls.length ? null : items };
      return { text, toolCalls, stop: toolCalls.length ? "tool" : "end", usage, model, native: items };
    },
  };
}

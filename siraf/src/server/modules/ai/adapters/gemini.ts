// Google Gemini through the REST API: models/{m}:streamGenerateContent?alt=sse, stateless
// (store:false), no sampling parameters, thinking level per effort, and the model's parts —
// thoughts and thought signatures included — stored and replayed exactly.
import { geminiThinkingLevel } from "@shared/ai/effort";
import { ProviderError, type Adapter, type AdapterEnv, type NeutralMessage, type ResolvedConnection, type ToolCall, type TurnRequest, type TurnResult, ZERO_USAGE } from "../types";
import { IDLE_MS, connectMs, errorFromResponse, idleSignal, joinUrl, networkError, readSse } from "./http";
import { geminiSchema } from "../schema";

type GPart = Record<string, unknown>;
type GContent = { role: "user" | "model"; parts: GPart[] };

/** Documented placeholder for function calls replayed without their original signature. */
const SKIP_SIGNATURE = "skip_thought_signature_validator";
/** Ids we made up for calls that came without one are not sent back. */
const LOCAL_ID = /^call_\d+_/;
const idField = (id: string) => (LOCAL_ID.test(id) ? {} : { id });

function userParts(m: NeutralMessage, media: { images: boolean; pdf: boolean }): GPart[] {
  const out: GPart[] = [];
  for (const p of m.parts) {
    if (p.type === "tool_result") {
      out.push({ functionResponse: { ...idField(p.id), name: p.name, response: p.is_error ? { error: p.content } : { result: p.content } } });
    } else if (p.type === "file") {
      if ((media.images && p.mime.startsWith("image/")) || (media.pdf && p.mime === "application/pdf")) out.push({ inlineData: { mimeType: p.mime, data: p.data } });
      else out.push({ text: `[attachment ${p.name ?? ""} (${p.mime}) cannot be read by this model]` });
    } else if (p.type === "text" && p.text) out.push({ text: p.text });
  }
  return out.length ? out : [{ text: "." }];
}

export function toGeminiContents(req: TurnRequest, conn: ResolvedConnection): GContent[] {
  return req.messages.map((m) => {
    if (m.role === "user") return { role: "user", parts: userParts(m, conn.preset.media) };
    const n = m.native;
    if (n && n.protocol === "gemini" && n.connection_id === conn.id && n.model === req.model && Array.isArray(n.content) && n.content.length) {
      return { role: "model", parts: n.content as GPart[] };
    }
    const parts: GPart[] = [];
    for (const p of m.parts) {
      if (p.type === "text" && p.text) parts.push({ text: p.text });
      else if (p.type === "tool_call") parts.push({ functionCall: { ...idField(p.id), name: p.name, args: p.input }, thoughtSignature: SKIP_SIGNATURE });
    }
    return { role: "model", parts: parts.length ? parts : [{ text: "." }] };
  });
}

export function geminiAdapter(conn: ResolvedConnection, env: AdapterEnv): Adapter {
  const base = conn.baseUrl.replace(/\/+$/, "");
  const key = conn.key;
  const headers: Record<string, string> = { "content-type": "application/json", ...(key ? { "x-goog-api-key": key } : {}) };
  let sendStore = true;
  let sendThinking = true;

  function buildBody(req: TurnRequest): Record<string, unknown> {
    const level = req.effort && sendThinking ? geminiThinkingLevel(req.effort, req.model) : null;
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxTokens,
      ...(sendThinking && /gemini-(2\.5|3|4)/.test(req.model) ? { thinkingConfig: { includeThoughts: true, ...(level ? { thinkingLevel: level } : {}) } } : {}),
      ...(req.output ? { responseMimeType: "application/json", responseJsonSchema: geminiSchema(req.output.schema) } : {}),
    };
    return {
      systemInstruction: { parts: [{ text: req.systemNotes ? `${req.system}\n\n${req.systemNotes}` : req.system }] },
      contents: toGeminiContents(req, conn),
      ...(req.tools?.length
        ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: geminiSchema(t.schema) })) }] }
        : {}),
      generationConfig,
      ...(sendStore ? { store: false } : {}),
    };
  }

  return {
    protocol: "gemini",
    async listModels(signal) {
      const t = idleSignal(signal, 20_000);
      try {
        const res = await env.fetch(`${joinUrl(base, "models")}?pageSize=200`, { headers, signal: t.signal });
        if (!res.ok) throw await errorFromResponse(res, [key]);
        const j = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
        return (j.models ?? [])
          .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
          .map((m) => String(m.name ?? "").replace(/^models\//, ""))
          .filter(Boolean);
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
      const parts: GPart[] = [];
      let finish: string | null = null;
      let blocked = false;
      const t = idleSignal(req.signal, connectMs(conn));
      try {
        let res: Response | null = null;
        for (let attempt = 0; !res; attempt++) {
          try {
            const url = `${joinUrl(base, `models/${encodeURIComponent(req.model)}:streamGenerateContent`)}?alt=sse`;
            const r = await env.fetch(url, { method: "POST", headers, body: JSON.stringify(buildBody(req)), signal: t.signal });
            if (!r.ok) throw await errorFromResponse(r, [key]);
            res = r;
          } catch (err) {
            if (err instanceof ProviderError && err.kind === "invalid" && attempt < 2) {
              if (sendStore && /\bstore\b/i.test(err.message)) {
                sendStore = false;
                continue;
              }
              if (sendThinking && /thinking/i.test(err.message)) {
                sendThinking = false;
                continue;
              }
            }
            throw err;
          }
        }
        t.touch(IDLE_MS);
        for await (const { data } of readSse(res.body!, () => t.touch())) {
          if (!data || typeof data !== "object") continue;
          const ev = data as Record<string, unknown>;
          if (ev.error) {
            const e = ev.error as { code?: number; message?: string; status?: string };
            throw new ProviderError(e.code === 429 ? "rate" : (e.code ?? 0) >= 500 ? "overloaded" : "other", String(e.message ?? "provider error").slice(0, 400));
          }
          if (typeof ev.modelVersion === "string") model = ev.modelVersion;
          if ((ev.promptFeedback as { blockReason?: string } | undefined)?.blockReason) blocked = true;
          const um = ev.usageMetadata as { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
          if (um) {
            const cached = um.cachedContentTokenCount ?? 0;
            usage.input = Math.max(0, (um.promptTokenCount ?? 0) - cached);
            usage.cache_read = cached;
            usage.reasoning = um.thoughtsTokenCount ?? 0;
            usage.output = (um.candidatesTokenCount ?? 0) + usage.reasoning;
          }
          const cand = (ev.candidates as { content?: { parts?: GPart[] }; finishReason?: string }[] | undefined)?.[0];
          if (!cand) continue;
          if (cand.finishReason) finish = cand.finishReason;
          for (const p of cand.content?.parts ?? []) {
            if (typeof p.text === "string") {
              if (p.thought) hooks?.onThinking?.(p.text);
              else {
                text += p.text;
                hooks?.onText?.(p.text);
              }
              // merge streamed text pieces of the same kind; a signed part stays as it came (its
              // signature belongs to that part only, and a signature closes a piece)
              const last = parts[parts.length - 1];
              if (last && typeof last.text === "string" && !!last.thought === !!p.thought && !last.thoughtSignature && !p.thoughtSignature && !last.functionCall) {
                last.text = String(last.text) + p.text;
                continue;
              }
            }
            parts.push({ ...p });
          }
        }
      } catch (err) {
        if (req.signal?.aborted) return { text, toolCalls: [], stop: "aborted", usage, model, native: null };
        throw networkError(err, t.timedOut(), [key]);
      } finally {
        t.done();
      }
      const toolCalls: ToolCall[] = parts
        .filter((p) => p.functionCall && typeof p.functionCall === "object")
        .map((p, i) => {
          const fc = p.functionCall as { id?: string; name?: string; args?: unknown };
          const args = fc.args && typeof fc.args === "object" && !Array.isArray(fc.args) ? (fc.args as Record<string, unknown>) : {};
          return { id: fc.id ? String(fc.id) : `call_${i}_${String(fc.name)}`, name: String(fc.name ?? ""), input: args };
        });
      if (blocked || (finish && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(finish) && !text && !toolCalls.length)) {
        return { text: "", toolCalls: [], stop: "refusal", usage, model, native: null };
      }
      if (finish === "MAX_TOKENS") return { text, toolCalls: [], stop: "max_tokens", usage, model, native: toolCalls.length ? null : parts };
      return { text, toolCalls, stop: toolCalls.length ? "tool" : "end", usage, model, native: parts };
    },
  };
}

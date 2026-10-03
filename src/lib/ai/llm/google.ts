import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { parseGeminiError } from "@/lib/ai/quota";
import type { Block, LlmAdapter, LlmErrorInfo, LlmMessage, LlmRequest, LlmResponse } from "@/lib/ai/llm/types";

const clients = new Map<string, GoogleGenAI>();
const listed = new Map<string, { at: number; names: string[] }>();

function client(apiKey: string): GoogleGenAI {
  let c = clients.get(apiKey);
  if (!c) {
    c = new GoogleGenAI({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
}

/** "auto" = newest free Flash models; "auto-lite" = newest Flash-Lite models. */
export const AUTO_MODEL = "auto";
export const AUTO_LITE_MODEL = "auto-lite";

function versionOf(name: string): number[] {
  return (name.match(/gemini-(\d+(?:\.\d+)*)-flash/)?.[1] ?? "0").split(".").map(Number);
}

function newestFirst(a: string, b: string): number {
  const va = versionOf(a);
  const vb = versionOf(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Stable (non-preview) Flash and Flash-Lite text models, newest first. */
export function pickFlashModels(names: string[]): { flash: string[]; lite: string[] } {
  const clean = names.map((n) => n.replace(/^models\//, ""));
  return {
    flash: clean.filter((n) => /^gemini-\d+(?:\.\d+)*-flash$/.test(n)).sort(newestFirst),
    lite: clean.filter((n) => /^gemini-\d+(?:\.\d+)*-flash-lite$/.test(n)).sort(newestFirst),
  };
}

/**
 * Expands "auto" / "auto-lite" into concrete models (newest first, then the -latest aliases). Free
 * daily quotas are per model (the newest allow only ~20 requests/day), so several generations are
 * walked; Lite is the last resort so a run never stalls for a whole day.
 */
export function expandAuto(models: string[], names: string[]): string[] {
  const { flash, lite } = pickFlashModels(names);
  const out: string[] = [];
  for (const m of models) {
    if (m === AUTO_MODEL || !m) out.push(...flash.slice(0, 4), "gemini-flash-latest", ...lite.slice(0, 1), "gemini-flash-lite-latest");
    else if (m === AUTO_LITE_MODEL) out.push(...lite.slice(0, 2), "gemini-flash-lite-latest");
    else out.push(m);
  }
  return [...new Set(out)];
}

export function googleError(err: unknown): LlmErrorInfo {
  const info = parseGeminiError(err);
  let kind: LlmErrorInfo["kind"] = "other";
  if (info.isQuota) kind = info.limitZero ? "quota_none" : info.isDaily ? "quota_daily" : "rate";
  else if (info.httpStatus === 401 || info.httpStatus === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(info.message)) kind = "auth";
  // a cut-off stream ("Incomplete JSON segment") or a dropped connection is retried like a busy model
  else if (info.isOverloaded || /Incomplete JSON segment|fetch failed|ECONNRESET|socket hang up|terminated|other side closed/i.test(info.message)) kind = "overloaded";
  else if (info.isInvalid) kind = /mime|inline|file|image|pdf/i.test(info.message) ? "media" : "invalid";
  return { kind, status: info.httpStatus, message: info.message, retryAfterMs: info.retryDelayMs };
}

/** Placeholder signature for function calls whose real signature is not available. */
export const SKIP_SIGNATURE = "skip_thought_signature_validator";

function toParts(blocks: Block[]): Part[] {
  const parts: Part[] = [];
  for (const b of blocks) {
    if (b.type === "text") parts.push({ text: b.text });
    else if (b.type === "file") {
      parts.push({ text: `\n[فایل: ${b.name}]` });
      parts.push({ inlineData: { mimeType: b.mime, data: b.data } });
      // a call without its original thought signature (written by another model, or replayed after a
      // model switch) carries Google's documented placeholder: Gemini 3 rejects unsigned calls
    } else if (b.type === "tool_call") parts.push({ functionCall: { id: b.id, name: b.name, args: b.input }, thoughtSignature: SKIP_SIGNATURE });
    else if (b.type === "tool_result") parts.push({ functionResponse: { id: b.id, name: b.name, response: b.isError ? { error: b.content } : { output: b.content } } });
  }
  return parts;
}

function toContents(messages: LlmMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts = m.raw?.protocol === "google" && Array.isArray(m.raw.content) ? (m.raw.content as Part[]) : toParts(m.content);
    if (!parts.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts!.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

export function googleAdapter(apiKey: string): LlmAdapter {
  const ai = client(apiKey);
  return {
    protocol: "google",

    async listModels() {
      const hit = listed.get(apiKey);
      if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.names;
      const names: string[] = [];
      const pager = await ai.models.list({ config: { pageSize: 200 } });
      for await (const m of pager) {
        if (m.name && (m.supportedActions ?? []).includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
      }
      listed.set(apiKey, { at: Date.now(), names });
      return names;
    },

    async turn(req: LlmRequest, hooks): Promise<LlmResponse> {
      const config: GenerateContentConfig = {
        systemInstruction: req.system,
        maxOutputTokens: req.maxOutputTokens ?? (req.json ? 65536 : 32768),
        thinkingConfig: { includeThoughts: true, ...(req.effort ? { thinkingLevel: ThinkingLevel[req.effort] } : {}) },
        abortSignal: req.signal,
      };
      if (req.json) {
        config.responseMimeType = "application/json";
        config.responseJsonSchema = req.json;
      }
      if (req.tools?.length) {
        config.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }];
      } else if (req.useSearch && !req.json) {
        config.tools = [{ googleSearch: {} }];
      }

      let text = "";
      let thought = "";
      const raw: Part[] = [];
      const calls: LlmResponse["toolCalls"] = [];
      const queries = new Set<string>();
      let finish: string | undefined;
      const usage = { input: 0, output: 0, thoughts: 0 };
      try {
        const stream = await ai.models.generateContentStream({ model: req.model, contents: toContents(req.messages), config });
        for await (const chunk of stream) {
          const cand = chunk.candidates?.[0];
          for (const part of cand?.content?.parts ?? []) {
            const prev = raw[raw.length - 1];
            // merge streamed text fragments (a part carrying a thought signature stays separate)
            if (part.text !== undefined && prev?.text !== undefined && !prev.thoughtSignature && !part.thoughtSignature && !!prev.thought === !!part.thought && !part.functionCall) {
              prev.text += part.text;
            } else raw.push({ ...part });
            if (part.functionCall?.name) {
              calls.push({ id: part.functionCall.id || `call_${calls.length + 1}`, name: part.functionCall.name, input: (part.functionCall.args ?? {}) as Record<string, unknown> });
            } else if (part.text) {
              if (part.thought) {
                thought += part.text;
                hooks?.onThought?.(thought);
              } else {
                text += part.text;
                hooks?.onText?.(text.length);
              }
            }
          }
          if (cand?.finishReason) finish = String(cand.finishReason);
          for (const q of cand?.groundingMetadata?.webSearchQueries ?? []) queries.add(q);
          if (chunk.usageMetadata) {
            usage.input = chunk.usageMetadata.promptTokenCount ?? usage.input;
            usage.output = chunk.usageMetadata.candidatesTokenCount ?? usage.output;
            usage.thoughts = chunk.usageMetadata.thoughtsTokenCount ?? usage.thoughts;
          }
        }
      } catch (err) {
        if (req.signal?.aborted) {
          return { text, toolCalls: [], stop: "aborted", usage, model: req.model, raw, searchQueries: [...queries] };
        }
        throw err;
      }
      const stop: LlmResponse["stop"] = calls.length ? "tool" : finish === "MAX_TOKENS" ? "max_tokens" : finish === "SAFETY" || finish === "PROHIBITED_CONTENT" ? "refusal" : "end";
      return { text, toolCalls: calls, stop, usage, model: req.model, raw, searchQueries: [...queries] };
    },
  };
}

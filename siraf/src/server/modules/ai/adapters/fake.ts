// Scripted, deterministic model for tests and screenshots (only when SIRAF_AI_FAKE=1). It never
// touches the network. What the last user message asks decides what it does:
//   [tool:NAME {json}]      call tool NAME with that input (several directives → parallel calls)
//   [loop:N NAME {json}]    call NAME again after each result until it ran N times, then answer
//   «فروش»                  analyze_metric {metric:"sales_amount"} (when the tool is offered)
//   «پیش‌نویس فاکتور»        propose_invoice {kind:"sale"} (when offered)
//   [json:{...}]            structured output: return exactly this JSON (also found in the bytes of an attached file)
//   [error:KIND]            fail with that AiErrorKind (e.g. rate, auth, region, quota, overloaded)
//   [refuse]                refuse   ·  [think] stream a short reasoning first  ·  [slow] stream slowly
// After tool results it answers in Persian, quoting the numbers the tools returned.
import type { AiErrorKind } from "@shared/ai/types";
import { ProviderError, type Adapter, type NeutralMessage, type ToolCall, type TurnRequest, type TurnResult } from "../types";

export const FAKE_MODELS = ["fake-smart", "fake-fast", "fake-vision"];

export function fakeEnabled(): boolean {
  return process.env.SIRAF_AI_FAKE === "1";
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok) => {
    if (signal?.aborted) return ok();
    const t = setTimeout(ok, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      ok();
    }, { once: true });
  });

function lastUserText(messages: NeutralMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    // the business context block is not part of the question
    if (t.trim() && !m.parts.some((p) => p.type === "tool_result")) return t.replace(/<context>[\s\S]*?<\/context>/g, "").trim();
  }
  return "";
}

/** Tool results of the current answer (after the last real question). */
function currentResults(messages: NeutralMessage[]): { name: string; content: string; is_error?: boolean }[] {
  const out: { name: string; content: string; is_error?: boolean }[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      const results = m.parts.filter((p): p is Extract<typeof p, { type: "tool_result" }> => p.type === "tool_result");
      if (!results.length) break;
      out.unshift(...results.map((r) => ({ name: r.name, content: r.content, is_error: r.is_error })));
    }
  }
  return out;
}

/** The balanced `{…}` that starts at `i` (strings respected), or null. */
function objectAt(text: string, i: number): { json: string; end: number } | null {
  if (text[i] !== "{") return null;
  let depth = 0;
  let str = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (str) {
      if (ch === "\\") j++;
      else if (ch === '"') str = false;
      continue;
    }
    if (ch === '"') str = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return { json: text.slice(i, j + 1), end: j + 1 };
  }
  return null;
}

/** `[tool:NAME {json}]` directives; the JSON may hold arrays and nested objects. */
function directives(text: string): { name: string; input: Record<string, unknown> }[] {
  const out: { name: string; input: Record<string, unknown> }[] = [];
  const re = /\[tool:([a-z_][\w]*)\s*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let input: Record<string, unknown> = {};
    const o = objectAt(text, re.lastIndex);
    if (o) {
      try {
        input = JSON.parse(o.json) as Record<string, unknown>;
      } catch {
        input = {};
      }
      re.lastIndex = o.end;
    }
    out.push({ name: m[1], input });
  }
  return out;
}

/** A `[json:{…}]` directive in the question, or in the bytes of an attached file (scanned documents in screenshots). */
function jsonDirective(question: string, messages: NeutralMessage[]): string | null {
  const find = (t: string) => {
    const i = t.indexOf("[json:");
    return i < 0 ? null : (objectAt(t, i + 6)?.json ?? null);
  };
  const q = find(question);
  if (q) return q;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type !== "file" || p.data.length > 200_000) continue;
      const hit = find(Buffer.from(p.data, "base64").toString("utf8"));
      if (hit) return hit;
    }
    break;
  }
  return null;
}

/** Numbers worth quoting from a tool result (decimal strings and numbers, with their keys). */
function facts(content: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (v: unknown, key: string, depth: number) => {
    if (out.length >= 4 || depth > 4) return;
    if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) out.push(`${key}: ${v}`);
    else if (Array.isArray(v)) v.slice(0, 3).forEach((x, i) => walk(x, `${key}[${i}]`, depth + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(data, "value", 0);
  return out;
}

/** A value that satisfies a JSON schema (structured output without a [json:…] directive). */
export function sampleFor(schema: unknown, depth = 0): unknown {
  const s = (schema ?? {}) as Record<string, unknown>;
  if (depth > 6) return null;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.const !== undefined) return s.const;
  const any = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (any?.length) return sampleFor(any.find((x) => (x as { type?: string }).type !== "null") ?? any[0], depth + 1);
  const type = Array.isArray(s.type) ? (s.type as string[]).find((t) => t !== "null") : (s.type as string | undefined);
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const props = (s.properties ?? {}) as Record<string, unknown>;
      for (const k of (s.required as string[] | undefined) ?? Object.keys(props)) out[k] = sampleFor(props[k], depth + 1);
      return out;
    }
    case "array":
      return [];
    case "string":
      return "نمونه";
    case "number":
    case "integer":
      return typeof s.minimum === "number" ? s.minimum : 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

function estimate(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function fakeAdapter(connectionId: string): Adapter {
  return {
    protocol: "openai-chat",
    async listModels() {
      return [...FAKE_MODELS];
    },
    async turn(req: TurnRequest, hooks): Promise<TurnResult> {
      const question = lastUserText(req.messages);
      const results = currentResults(req.messages);
      const promptChars = req.system.length + JSON.stringify(req.messages).length;
      const usage = { input: estimate(" ".repeat(promptChars)), output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
      const err = /\[error:([a-z_]+)\]/.exec(question);
      if (err && !results.length) throw new ProviderError(err[1] as AiErrorKind, `fake ${err[1]} error`, err[1] === "rate" ? 429 : 400, err[1] === "rate" ? 1000 : null);
      if (/\[refuse\]/.test(question)) return { text: "", toolCalls: [], stop: "refusal", usage, model: req.model, native: null };

      const slow = /\[slow\]/.test(question);
      const emit = async (text: string): Promise<string> => {
        let sent = "";
        const chunks = text.match(/.{1,12}/gsu) ?? [];
        for (const c of chunks) {
          if (req.signal?.aborted) break;
          if (slow) await sleep(60, req.signal);
          if (req.signal?.aborted) break;
          sent += c;
          hooks?.onText?.(c);
        }
        return sent;
      };
      if (/\[think\]/.test(question) && !results.length) hooks?.onThinking?.("بررسی پرسش و انتخاب ابزار مناسب…");

      const offered = new Set((req.tools ?? []).map((t) => t.name));
      let calls: { name: string; input: Record<string, unknown> }[] = [];
      const loop = /\[loop:(\d+)\s+([a-z_][\w]*)\s*(\{[^\]]*\})?\]/.exec(question);
      if (loop) {
        const want = Number(loop[1]);
        const done = results.filter((r) => r.name === loop[2]).length;
        if (done < want && offered.has(loop[2])) {
          let input: Record<string, unknown> = {};
          try {
            input = loop[3] ? (JSON.parse(loop[3]) as Record<string, unknown>) : {};
          } catch {
            input = {};
          }
          calls = [{ name: loop[2], input }];
        }
      } else if (!results.length && !req.output) {
        calls = directives(question).filter((d) => offered.has(d.name));
        if (!calls.length && /پیش‌?نویس فاکتور/.test(question) && offered.has("propose_invoice")) calls = [{ name: "propose_invoice", input: { kind: "sale" } }];
        else if (!calls.length && /فروش/.test(question) && offered.has("analyze_metric")) calls = [{ name: "analyze_metric", input: { metric: "sales_amount" } }];
      }
      if (calls.length) {
        const step = req.messages.length;
        const toolCalls: ToolCall[] = calls.map((c, i) => ({ id: `fake_${step}_${i}`, name: c.name, input: c.input }));
        const text = await emit(results.length ? "" : "برای پاسخ، داده‌ها را از دفاتر می‌خوانم.");
        usage.output = estimate(text) + 20;
        return { text, toolCalls, stop: req.signal?.aborted ? "aborted" : "tool", usage, model: req.model, native: { role: "assistant", content: text || null } };
      }

      let answer: string;
      if (req.output) {
        answer = jsonDirective(question, req.messages) ?? JSON.stringify(sampleFor(req.output.schema));
      } else if (results.length) {
        const lines = results.map((r) => {
          if (r.is_error) return `- ابزار ${r.name} خطا داد: ${r.content.slice(0, 160)}`;
          if (r.content.includes('"awaiting_confirmation"')) return `- پیش‌نویس ${r.name} آماده شد؛ تا آن را در کارت بالا تأیید نکنید چیزی ثبت نمی‌شود.`;
          const f = facts(r.content);
          return `- بر پایهٔ ${r.name}: ${f.length ? f.join("، ") : "داده‌ای برنگشت"}`;
        });
        answer = `پاسخ آزمایشی بر پایهٔ ابزارها:\n\n${lines.join("\n")}`;
      } else if (/[«»؟]|[؀-ۿ]/.test(question)) {
        answer = `پاسخ آزمایشی: «${question.replace(/\[[^\]]*\]/g, "").trim().slice(0, 300)}»`;
      } else answer = `Fake answer: ${question.slice(0, 300)}`;
      const sent = await emit(answer);
      usage.output = estimate(sent);
      if (req.signal?.aborted) return { text: sent, toolCalls: [], stop: "aborted", usage, model: req.model, native: null };
      return { text: sent, toolCalls: [], stop: "end", usage, model: req.model, native: { role: "assistant", content: sent, connection: connectionId } };
    },
  };
}

import "server-only";
import { adapterFor } from "@/lib/ai/llm";
import { providerPreset } from "@/lib/ai/providers";
import { handleModelError, SAFETY_MARGIN_MS, streamHooks, stripMedia, usableChain, type GenContext } from "@/lib/ai/generate";
import { DeadlineError, FatalError, TransientError } from "@/lib/errors";
import type { Connection } from "@/lib/connections";
import type { Block, Effort, LlmMessage, LlmResponse, ToolDef } from "@/lib/ai/llm/types";

/** Thrown by a tool to return an error result to the model (the loop continues). */
export class ToolError extends Error {}

export interface AgentTool {
  def: ToolDef;
  run(input: Record<string, unknown>): Promise<string>;
}

/** Persisted between worker invocations (job_data), so a long run continues where it stopped. */
export interface AgentTranscript {
  messages: LlmMessage[];
  turns: number;
  model?: string;
  /** consecutive turns cut off by the time limit (the model is then asked for shorter steps) */
  interrupted?: number;
  finished?: boolean;
  summary?: string;
}

export interface AgentOptions {
  agent: string;
  conn: Connection;
  model: string;
  system: string;
  tools: AgentTool[];
  transcript: AgentTranscript;
  effort?: Effort;
  maxTurns: number;
  deadline: number;
  ctx: GenContext;
  save(t: AgentTranscript): Promise<void>;
  /** called for every tool call (live log) */
  onTool?(name: string, input: Record<string, unknown>, result: { ok: boolean; text: string }): Promise<void>;
  /** "finish" tool name; without it the loop ends when the model answers without calling a tool */
  finishTool?: string;
}

/** A turn needs at least this much time; with less left the loop yields to the next invocation. */
const MIN_TURN_MS = 25_000;
/** OpenAI-compatible models have smaller contexts: old tool results are shortened past this size. */
const COMPACT_CHARS = 350_000;

const SHORTER =
  "\n\n(یادداشت سیستم: پاسخ قبلی‌ات به دلیل محدودیت زمان قطع شد و از دست رفت. هر پاسخ را کوتاه نگه دار: فایل‌های بزرگ را با چند بار append_file هر کدام حداکثر ۱۵۰ خط بنویس و برای تغییر فایل موجود از edit_file استفاده کن.)";
const TRUNCATED =
  "\n\n(یادداشت سیستم: پاسخ قبلی‌ات به سقف طول خروجی رسید و ابزار اجرا نشد. محتوای بزرگ را در چند فراخوانی کوچک‌تر بنویس.)";

function appendNote(t: AgentTranscript, note: string) {
  const last = t.messages[t.messages.length - 1];
  if (!last || last.role !== "user") return;
  const block = last.content.findLast((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  if (block) block.text += note;
  else last.content.push({ type: "text", text: note.trim() });
}

/** Minimal validation of tool input against the tool's own JSON schema (required keys and types). */
export function validateInput(def: ToolDef, input: Record<string, unknown>): string | null {
  if ("__invalid_json" in input) return "ورودی ابزار JSON معتبر نبود؛ دوباره و کامل بفرست";
  const schema = def.parameters as { properties?: Record<string, { type?: string }>; required?: string[] };
  for (const key of schema.required ?? []) {
    if (input[key] === undefined || input[key] === null) return `پارامتر «${key}» لازم است`;
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    const v = input[key];
    if (v === undefined || v === null || !spec.type) continue;
    const ok = spec.type === "integer" ? Number.isInteger(v) : spec.type === "array" ? Array.isArray(v) : typeof v === spec.type;
    if (!ok) return `پارامتر «${key}» باید از نوع ${spec.type} باشد`;
  }
  return null;
}

function compact(messages: LlmMessage[]): LlmMessage[] {
  let size = JSON.stringify(messages).length;
  if (size < COMPACT_CHARS) return messages;
  const out = messages.map((m) => ({ ...m, content: m.content.map((b) => ({ ...b })) as Block[] }));
  // shorten the oldest tool results first, keeping the last 6 messages intact
  for (let i = 0; i < out.length - 6 && size >= COMPACT_CHARS; i++) {
    for (const b of out[i].content) {
      if (b.type === "tool_result" && b.content.length > 600) {
        size -= b.content.length - 120;
        b.content = `${b.content.slice(0, 100)}\n…(برای صرفه‌جویی حذف شد؛ اگر لازم است دوباره بخوان)`;
      }
    }
  }
  return out;
}

/**
 * Runs a tool-calling agent until it finishes, the turn budget runs out or the invocation's time is
 * up (then it throws DeadlineError and continues from the saved transcript next time). The history is
 * only ever appended to, as the Claude API requires for its thinking blocks.
 */
export async function runAgent(opts: AgentOptions): Promise<{ summary: string; model?: string }> {
  const t = opts.transcript;
  if (t.finished) return { summary: t.summary ?? "", model: t.model };
  const adapter = adapterFor(opts.conn);
  const protocol = providerPreset(opts.conn.provider).protocol;
  const byName = new Map(opts.tools.map((x) => [x.def.name, x]));
  const state = { overloadRetried: new Set<string>(), effortDropped: false, mediaDropped: false, searchDropped: true };
  let effort = opts.effort;
  let chain = await usableChain(opts.conn, opts.model, opts.ctx, t.model);
  let ci = 0;

  while (t.turns < opts.maxTurns) {
    const left = opts.deadline - Date.now() - SAFETY_MARGIN_MS;
    if (left < MIN_TURN_MS) {
      await opts.save(t);
      throw new DeadlineError();
    }
    const model = chain[ci];
    if (!model) throw new TransientError(`هیچ‌یک از مدل‌های «${opts.conn.label}» پاسخ نداد`, 60_000);
    // a model switch mid-run cannot reuse another model's raw turns
    if (t.model && t.model !== model) for (const m of t.messages) delete m.raw;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    const hooks = streamHooks(opts.ctx, opts.agent, model);
    let res: LlmResponse;
    try {
      res = await adapter.turn(
        {
          model,
          system: opts.system,
          messages: protocol === "openai" ? compact(t.messages) : t.messages,
          tools: opts.tools.map((x) => x.def),
          effort,
          maxOutputTokens: 32000,
          signal: controller.signal,
        },
        hooks,
      );
    } catch (err) {
      clearTimeout(timer);
      const r = await handleModelError(opts, model, chain[ci + 1], err, state);
      if (r === "next") ci++;
      else if (r === "no-effort") {
        state.effortDropped = true;
        effort = undefined;
      } else if (r === "no-media") {
        state.mediaDropped = true;
        for (const m of t.messages) m.content = stripMedia(m.content);
      }
      if (r === "next" && !chain[ci]) chain = await usableChain(opts.conn, opts.model, opts.ctx);
      continue;
    }
    clearTimeout(timer);
    opts.ctx.addUsage(res.usage);
    t.model = model;

    if (res.stop === "aborted") {
      t.interrupted = (t.interrupted ?? 0) + 1;
      if (t.interrupted >= 1) appendNote(t, SHORTER);
      await opts.save(t);
      throw new DeadlineError("یک مرحله‌ی ایجنت به محدودیت زمان خورد؛ ادامه در اجرای بعدی");
    }
    t.interrupted = 0;
    if (res.stop === "refusal") throw new FatalError(`مدل ${model} ادامه‌ی این کار را رد کرد (رد ایمنی)`);
    if (res.stop === "max_tokens" && res.toolCalls.length === 0 && !res.text.trim()) {
      appendNote(t, TRUNCATED);
      t.turns++;
      await opts.save(t);
      continue;
    }

    const assistant: Block[] = [];
    if (res.text.trim()) assistant.push({ type: "text", text: res.text });
    for (const c of res.toolCalls) assistant.push({ type: "tool_call", id: c.id, name: c.name, input: c.input });
    t.messages.push({ role: "assistant", content: assistant, raw: res.raw ? { protocol, model, content: res.raw } : undefined });
    t.turns++;

    if (!res.toolCalls.length) {
      // answered without a tool: that answer is the result
      t.finished = true;
      t.summary = res.text.trim();
      await opts.save(t);
      return { summary: t.summary, model };
    }

    const results: Block[] = [];
    let finishSummary: string | null = null;
    for (const call of res.toolCalls) {
      const tool = byName.get(call.name);
      let ok = true;
      let text: string;
      if (res.stop === "max_tokens") {
        ok = false;
        text = "ورودی این ابزار به دلیل سقف طول خروجی ناقص ماند و اجرا نشد؛ آن را در بخش‌های کوچک‌تر دوباره بفرست.";
      } else if (!tool) {
        ok = false;
        text = `ابزار «${call.name}» وجود ندارد. ابزارهای مجاز: ${[...byName.keys()].join(", ")}`;
      } else {
        const invalid = validateInput(tool.def, call.input);
        if (invalid) {
          ok = false;
          text = invalid;
        } else if (call.name === opts.finishTool) {
          finishSummary = String(call.input.summary ?? "").trim();
          text = "پایان ثبت شد.";
        } else {
          try {
            text = await tool.run(call.input);
          } catch (err) {
            ok = false;
            text = err instanceof ToolError ? err.message : `خطا: ${(err as Error).message}`;
            if (!(err instanceof ToolError) && (err instanceof DeadlineError || err instanceof FatalError)) throw err;
          }
        }
      }
      results.push({ type: "tool_result", id: call.id, name: call.name, content: text, isError: !ok });
      await opts.onTool?.(call.name, call.input, { ok, text });
    }
    t.messages.push({ role: "user", content: results });
    if (finishSummary !== null) {
      t.finished = true;
      t.summary = finishSummary || res.text.trim();
      await opts.save(t);
      return { summary: t.summary, model };
    }
    await opts.save(t);
  }
  t.finished = true;
  t.summary = `${t.summary ?? ""}\n(کار پس از ${t.turns} مرحله به سقف تعداد مراحل رسید و متوقف شد.)`.trim();
  await opts.save(t);
  return { summary: t.summary, model: t.model };
}

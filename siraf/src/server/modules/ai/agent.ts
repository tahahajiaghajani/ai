// The assistant loop: one request = model turns and tool rounds until the answer is complete, the
// person stops it, the step limit is reached, or (web version) the request's time budget runs out
// — then a `continue` event tells the client to POST /threads/:id/continue. Read tools run in
// parallel with validated input and the caller's permissions; proposal tools only prepare drafts
// (tz_ai_actions). Every finished step is persisted before the next one starts.
import type { Ctx } from "../../context";
import type { AiErrorKind, AiStreamEvent } from "@shared/ai/types";
import type { AiChatRequest } from "@shared/ai/api";
import { aiErrorText } from "@shared/ai/errors";
import { todayISO } from "@shared/jalali";
import { uuidv7 } from "@shared/id";
import { D } from "@shared/money";
import { AppError, bad, conflict } from "../../http/errors";
import { toolsFor } from "./tools";
import type { AiToolDef, ToolResult, ToolRuntime } from "./tools/registry";
import { storeProposal } from "./actions";
import { AiUnavailableError } from "./errors";
import { assertUsable, chainFor, loadEnv, runTurn, unavailable, type AiEnv } from "./chain";
import { ASSISTANT_SYSTEM, businessNotes, contextBlock } from "./prompts";
import { redactPrompt, redactValue } from "./redact";
import { dropNulls, jsonSchemaOf } from "./schema";
import {
  acquireRun, createThread, emptyUi, history, insertStep, insertUserMessage, logToolCall, ownThread, putData, purgeOld, releaseRun, renewRun, stopRequested, threadTitle,
  type StepParts, type StepStatus, type StepUi, type ThreadRow,
} from "./threads";
import { orgTimeZone } from "./usage";
import { addUsage, ZERO_USAGE, type NeutralMessage, type Part, type ToolCall, type ToolSpec, type Usage } from "./types";
import { cloudLink } from "./relay";

/** Per-request limits (tests may lower them). */
export const AGENT_LIMITS = {
  /** model turns per request */
  maxSteps: 12,
  /** web version: stop starting new turns after this and ask the client to continue */
  budgetMs: 240_000,
  /** web version: a step still running this long after the request began is cut off (the function limit is 300 s) */
  hardMs: 285_000,
  /** characters of one tool result sent to the model */
  toolChars: 24_000,
  maxTokens: 32_000,
  /** the thread lease of one request */
  leaseMs: 300_000,
};

export type Emit = (ev: AiStreamEvent) => void;

/** Requests running on this server instance: POST /threads/:id/stop aborts them at once. */
const RUNNING = new Map<string, AbortController>();

const ATTACH_MIME = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;
const ATTACH_MAX = 4;
const ATTACH_BYTES = 8 * 1024 * 1024;

function shortInput(input: unknown): string | undefined {
  const s = JSON.stringify(input ?? {});
  if (!s || s === "{}") return undefined;
  return s.length > 140 ? `${s.slice(0, 138)}…` : s;
}

function toolSpecs(tools: AiToolDef[]): ToolSpec[] {
  // a stable order keeps the provider's prompt cache warm
  return [...tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, description: t.description, schema: jsonSchemaOf(t.input) }));
}

function stringifyResult(data: unknown, max: number): string {
  let s: string;
  try {
    s = JSON.stringify(data ?? null);
  } catch {
    s = String(data);
  }
  return s.length > max ? `${s.slice(0, max)}… [truncated: ask for a narrower period or fewer rows]` : s;
}

interface RunState {
  ctx: Ctx;
  env: AiEnv;
  thread: ThreadRow;
  runId: string;
  replyTo: string;
  answerId: string;
  /** steps of this answer already stored (continue) */
  stepsBefore: number;
  messages: NeutralMessage[];
  emit: Emit;
  signal: AbortSignal;
  started: number;
}

/** POST /ai/chat */
export async function startChat(ctx: Ctx, req: AiChatRequest, emit: Emit, clientSignal: AbortSignal): Promise<void> {
  ctx.need("ai", "view");
  const env = await loadEnv(ctx);
  await assertUsable(ctx, env);
  if (!env.settings.features.assistant) throw unavailable(ctx, "disabled");
  const text = String(req.text ?? "").trim();
  if (!text && !req.attachments?.length) throw bad("پرسش خالی است");
  if (text.length > 20_000) throw bad("پرسش بیش از اندازه طولانی است");
  const attachments = req.attachments ?? [];
  if (attachments.length) {
    if (!env.settings.features.capture) throw bad("فرستادن فایل به هوش مصنوعی در تنظیمات خاموش است");
    if (attachments.length > ATTACH_MAX) throw bad(`حداکثر ${ATTACH_MAX} فایل در هر پرسش`);
    for (const a of attachments) {
      if (!ATTACH_MIME.test(a.mime)) throw bad("فقط تصویر (PNG، JPEG، WebP، GIF) و PDF پذیرفته می‌شود");
      if (a.data.length * 0.75 > ATTACH_BYTES) throw bad("حجم هر فایل حداکثر ۸ مگابایت است");
    }
  }
  const chain = await chainFor(ctx, "assistant", env);
  if (!chain.entries.length && !(ctx.cfg.mode === "desktop" && env.settings.use_cloud && cloudLink(ctx.cfg))) {
    throw unavailable(ctx, chain.total ? (chain.held ?? "rate") : "not_configured");
  }

  const thread = req.thread_id ? await ownThread(ctx, req.thread_id) : await createThread(ctx, threadTitle(text || attachments.map((a) => a.name).join("، ")), req.context ?? null);
  const runId = uuidv7();
  if (!(await acquireRun(ctx, thread.id, runId, AGENT_LIMITS.leaseMs))) throw conflict("پاسخ قبلی این گفتگو هنوز در حال آماده شدن است");
  try {
    if (!req.thread_id) void purgeOld(ctx, env.settings.retention_days);
    const prior = await history(ctx, thread.id);
    const block = await contextBlock(ctx, req.context ?? thread.context, env.settings.data_policy);
    // files without a question: the model is asked what they are and what can be done with them
    const question = text || "(The person sent the attached file(s) without a question: say briefly what they contain and what you can do with them in Siraf.)";
    const modelText = `${block}\n\n${redactPrompt(question, env.settings.data_policy)}`;
    // stored for replay without the file contents (they are sent only with this question)
    const storedParts: Part[] = [...attachments.map((a) => ({ type: "text" as const, text: `[attachment: ${a.name} (${a.mime})]` })), { type: "text", text: modelText }];
    const userId = await insertUserMessage(ctx, thread.id, text, storedParts, { attachments: attachments.map((a) => ({ name: a.name, mime: a.mime })), context: req.context ?? null });
    const liveParts: Part[] = [...attachments.map((a) => ({ type: "file" as const, name: a.name, mime: a.mime, data: a.data })), { type: "text", text: modelText }];
    const messages = [...prior.messages, { role: "user" as const, parts: liveParts }];
    await runAnswer({ ctx, env, thread, runId, replyTo: userId, answerId: uuidv7(), stepsBefore: 0, messages, emit, signal: clientSignal, started: Date.now() });
  } finally {
    await releaseRun(ctx, thread.id, runId);
  }
}

/** POST /ai/threads/:id/continue */
export async function continueChat(ctx: Ctx, threadId: string, emit: Emit, clientSignal: AbortSignal): Promise<void> {
  ctx.need("ai", "view");
  const thread = await ownThread(ctx, threadId);
  const env = await loadEnv(ctx);
  await assertUsable(ctx, env);
  if (!env.settings.features.assistant) throw unavailable(ctx, "disabled");
  const runId = uuidv7();
  if (!(await acquireRun(ctx, thread.id, runId, AGENT_LIMITS.leaseMs))) throw conflict("پاسخ قبلی این گفتگو هنوز در حال آماده شدن است");
  try {
    const h = await history(ctx, thread.id);
    if (!h.pending) {
      emit({ type: "done", message_id: "", stop: "end" });
      return;
    }
    await runAnswer({ ctx, env, thread, runId, replyTo: h.pending.replyTo, answerId: h.pending.answerId, stepsBefore: h.pending.steps, messages: h.messages, emit, signal: clientSignal, started: Date.now() });
  } finally {
    await releaseRun(ctx, thread.id, runId);
  }
}

/** POST /ai/threads/:id/stop: abort here at once; other instances see the flag between steps. */
export function abortLocal(threadId: string): boolean {
  const c = RUNNING.get(threadId);
  if (!c) return false;
  c.abort();
  return true;
}

async function runAnswer(s: RunState): Promise<void> {
  const { ctx, env, thread, emit } = s;
  const local = new AbortController();
  RUNNING.set(thread.id, local);
  const signal = AbortSignal.any([s.signal, local.signal]);
  const tools = toolsFor(ctx, { proposals: env.settings.features.proposals });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs = toolSpecs(tools);
  const first = (await chainFor(ctx, "assistant", env)).entries[0];
  emit({ type: "meta", thread_id: thread.id, message_id: s.answerId, model: first?.model ?? null, connection: first?.row.label ?? null });

  let usage: Usage = { ...ZERO_USAGE };
  let cost = "0";
  let priced = true;
  /** usage of the current step (stored on its row; the event reports the request's total) */
  let stepUsage: Usage | null = null;
  let firstStepId = s.stepsBefore ? s.answerId : null;
  const stepId = () => {
    const id = firstStepId ? uuidv7() : s.answerId;
    firstStepId = s.answerId;
    return id;
  };
  const emitUsage = () =>
    emit({ type: "usage", input: usage.input, output: usage.output, cache_read: usage.cache_read, cache_write: usage.cache_write, cost_usd: priced ? cost : null });
  const finish = async (status: StepStatus, text: string, ui: StepUi, extra: Partial<StepParts> = {}, model: string | null = null, connectionId: string | null = null, native: unknown = null) => {
    if (text || status !== "done" || ui.tools.length || extra.calls?.length) {
      await insertStep(ctx, {
        id: stepId(), threadId: thread.id, replyTo: s.replyTo, text, parts: { calls: [], results: [], final: true, ui, ...extra }, native: native as never,
        model, connectionId, usage: stepUsage, status,
      });
    }
  };

  // some text of this answer was already streamed (an earlier step of this request)
  let answered = false;
  try {
    for (let step = s.stepsBefore; ; step++) {
      if (signal.aborted || (step > s.stepsBefore && (await stopRequested(ctx, thread.id, s.runId)))) {
        local.abort();
        // the answer ends here: without a final row the stored tool step would read as "pending"
        stepUsage = null;
        await finish("stopped", "", emptyUi());
        emitUsage();
        emit({ type: "done", message_id: s.answerId, stop: "stopped" });
        return;
      }
      if (ctx.cfg.mode === "cloud" && step > s.stepsBefore && Date.now() - s.started > AGENT_LIMITS.budgetMs) {
        emitUsage();
        emit({ type: "continue", thread_id: thread.id });
        return;
      }
      if (step > s.stepsBefore) await renewRun(ctx, thread.id, s.runId, AGENT_LIMITS.leaseMs);
      let streamed = "";
      stepUsage = null;
      // web version: the step (model turn and its tools) must end before the function is killed
      const deadline = ctx.cfg.mode === "cloud" ? AbortSignal.timeout(Math.max(1_000, AGENT_LIMITS.hardMs - (Date.now() - s.started))) : null;
      const stepSignal = deadline ? AbortSignal.any([signal, deadline]) : signal;
      let result;
      try {
        result = await runTurn(ctx, {
          job: "assistant",
          feature: "assistant",
          env,
          threadId: thread.id,
          hooks: {
            onText: (d) => {
              // a new step's text starts a new paragraph, as the stored answer joins its steps
              if (!streamed && answered) emit({ type: "text", delta: "\n\n" });
              streamed += d;
              answered = true;
              emit({ type: "text", delta: d });
            },
            onThinking: (d) => emit({ type: "thinking", delta: d }),
          },
          request: {
            system: ASSISTANT_SYSTEM,
            systemNotes: businessNotes(env.settings.instructions),
            messages: s.messages,
            tools: specs.length ? specs : undefined,
            effort: env.settings.effort.assistant,
            maxTokens: AGENT_LIMITS.maxTokens,
            signal: stepSignal,
          },
        });
      } catch (e) {
        const kind: AiErrorKind = e instanceof AiUnavailableError ? e.kind : "other";
        const message_fa = e instanceof AiUnavailableError ? e.message : aiErrorText("other").message;
        if (!(e instanceof AiUnavailableError)) ctx.cfg.log.error("ai assistant step failed", String((e as Error)?.message ?? e));
        await finish("error", streamed, { ...emptyUi(), error: { kind, message_fa } });
        emitUsage();
        emit({ type: "error", kind, message_fa });
        emit({ type: "done", message_id: s.answerId, stop: "error" });
        return;
      }
      const r = result.result;
      stepUsage = r.usage;
      usage = addUsage(usage, r.usage);
      cost = D(cost).plus(result.cost_usd || "0").toFixed();
      priced = priced && result.priced;
      // replayed only to the model id it was asked of (the provider reports dated snapshots)
      const native = r.native && result.protocol ? { protocol: result.protocol, model: result.requested_model || result.model, connection_id: result.connection_id ?? "", content: r.native } : null;

      if (r.stop === "aborted" && !signal.aborted && deadline?.aborted) {
        // cut off by the request's time limit, not by the person
        const text = r.text || streamed;
        if (!text && step > s.stepsBefore) {
          // nothing of this step reached anyone: the stored tool step is continued by the next request
          emitUsage();
          emit({ type: "continue", thread_id: thread.id });
          return;
        }
        const message_fa = aiErrorText("timeout").message;
        await finish("error", text, { ...emptyUi(), error: { kind: "timeout", message_fa } }, {}, result.model, result.connection_id);
        emitUsage();
        emit({ type: "error", kind: "timeout", message_fa });
        emit({ type: "done", message_id: s.answerId, stop: "error" });
        return;
      }
      if (r.stop === "aborted") {
        await finish("stopped", r.text || streamed, emptyUi(), {}, result.model, result.connection_id);
        emitUsage();
        emit({ type: "done", message_id: s.answerId, stop: "stopped" });
        return;
      }
      if (r.stop === "refusal") {
        const message_fa = unavailable(ctx, "refusal").message;
        await finish("refusal", r.text, { ...emptyUi(), error: { kind: "refusal", message_fa } }, {}, result.model, result.connection_id);
        emitUsage();
        emit({ type: "error", kind: "refusal", message_fa });
        emit({ type: "done", message_id: s.answerId, stop: "refusal" });
        return;
      }
      if (!r.toolCalls.length) {
        await finish("done", r.text, emptyUi(), {}, result.model, result.connection_id, native);
        emitUsage();
        emit({ type: "done", message_id: s.answerId, stop: "end" });
        return;
      }
      if (step + 1 >= AGENT_LIMITS.maxSteps) {
        // the model still wants tools after the last allowed step: keep its text, run nothing
        await finish("max_steps", r.text, emptyUi(), {}, result.model, result.connection_id);
        emitUsage();
        emit({ type: "done", message_id: s.answerId, stop: "max_steps" });
        return;
      }

      // ---- tool round
      const id = stepId();
      const ui = emptyUi();
      const results = await runTools(s, id, r.toolCalls, byName, ui, stepSignal, deadline);
      const note = step + 2 >= AGENT_LIMITS.maxSteps ? "Step limit reached: answer now with what the tool results above show; do not call more tools." : undefined;
      await insertStep(ctx, {
        id, threadId: thread.id, replyTo: s.replyTo, text: r.text,
        parts: { calls: r.toolCalls.map(({ id: cid, name, input }) => ({ id: cid, name, input })), results, ...(note ? { note } : {}), final: false, ui },
        native, model: result.model, connectionId: result.connection_id, usage: r.usage, status: "done",
      });
      s.messages.push({
        role: "assistant",
        parts: [...(r.text ? [{ type: "text" as const, text: r.text }] : []), ...r.toolCalls.map((c) => ({ type: "tool_call" as const, id: c.id, name: c.name, input: c.input }))],
        native,
      });
      s.messages.push({
        role: "user",
        parts: [...results.map((x) => ({ type: "tool_result" as const, id: x.id, name: x.name, content: x.content, ...(x.is_error ? { is_error: true } : {}) })), ...(note ? [{ type: "text" as const, text: note }] : [])],
      });
    }
  } finally {
    if (RUNNING.get(thread.id) === local) RUNNING.delete(thread.id);
  }
}

class ToolCutOff extends AppError {
  constructor() {
    super(504, "tool_timeout", "The tool did not finish within this request's time limit. Call it again, or narrow it (a shorter period, fewer rows).");
  }
}

/** The tool's promise, or a ToolCutOff as soon as the step's signal fires. */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(new ToolCutOff());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ToolCutOff());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

async function runTools(
  s: RunState,
  messageId: string,
  calls: ToolCall[],
  byName: Map<string, AiToolDef>,
  ui: StepUi,
  signal: AbortSignal,
  /** web version: the step's time limit (a tool the person stops still finishes, as before) */
  deadline: AbortSignal | null,
): Promise<StepParts["results"]> {
  const { ctx, env, thread, emit } = s;
  const policy = env.settings.data_policy;
  const rt: ToolRuntime = {
    today: todayISO(orgTimeZone(ctx)),
    dataPolicy: policy,
    putData: (rows, meta) => putData(ctx, thread.id, rows, meta, env.settings.retention_days),
    signal,
  };
  const out = new Map<string, { id: string; name: string; content: string; is_error?: boolean }>();

  const runOne = async (call: ToolCall) => {
    const def = byName.get(call.name);
    emit({ type: "tool_start", call_id: call.id, tool: call.name, title_fa: def?.title_fa ?? call.name, input_fa: shortInput(redactValue(call.input, policy === "full" ? "masked" : policy)) });
    const t0 = Date.now();
    let content: string;
    let ok = false;
    let summary: string | undefined;
    let res: ToolResult | null = null;
    try {
      if (!def) throw new AppError(400, "unknown_tool", `Unknown tool ${call.name}. Use only the tools you were given.`);
      if (call.invalid) throw new AppError(400, "invalid_input", `The tool input was not a JSON object: ${call.invalid.slice(0, 300)}`);
      let parsed = def.input.safeParse(call.input);
      if (!parsed.success) parsed = def.input.safeParse(dropNulls(call.input));
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        throw new AppError(400, "invalid_input", `Invalid input for ${call.name}: ${issues}`);
      }
      // the step's deadline bounds the tools too: a tool still running when it fires is answered
      // with an error (its query may finish in the background; nothing of it is used)
      res = deadline ? await untilAborted(def.run(ctx, parsed.data, rt), deadline) : await def.run(ctx, parsed.data, rt);
      ok = true;
      summary = res.summary_fa;
      let data: unknown = redactValue(res.data, policy);
      if (res.proposal) {
        const proposal = await storeProposal(ctx, { threadId: thread.id, messageId, callId: call.id, tool: call.name, proposal: res.proposal });
        ui.proposals.push(proposal.id);
        emit({ type: "proposal", proposal });
        data = {
          proposal_id: proposal.id,
          status: "awaiting_confirmation",
          title: proposal.title_fa,
          note: "A draft card is shown to the person. Nothing is saved until they confirm it; tell them to review and confirm or edit it.",
          details: data ?? null,
        };
      }
      content = stringifyResult(data, AGENT_LIMITS.toolChars);
      if (res.data_ref && res.chart) {
        ui.charts.push({ data_ref: res.data_ref, spec: res.chart });
        emit({ type: "chart", data_ref: res.data_ref, spec: res.chart });
      }
      if (res.data_ref && res.table) {
        ui.tables.push({ data_ref: res.data_ref, ...res.table });
        emit({ type: "table", data_ref: res.data_ref, ...res.table });
      }
      for (const ref of res.refs ?? []) if (!ui.refs.some((x) => x.type === ref.type && x.id === ref.id)) ui.refs.push(ref);
    } catch (e) {
      const msg = e instanceof AppError ? e.message : "The tool failed unexpectedly.";
      if (!(e instanceof AppError)) ctx.cfg.log.error("ai tool failed", { tool: call.name, err: String((e as Error)?.message ?? e) });
      content = JSON.stringify({ error: msg });
      summary = e instanceof ToolCutOff ? "زمان ابزار تمام شد" : e instanceof AppError && /[؀-ۿ]/.test(msg) ? msg : "ابزار خطا داد";
    }
    const ms = Date.now() - t0;
    ui.tools.push({ call_id: call.id, tool: call.name, title_fa: def?.title_fa ?? call.name, ok, ...(summary ? { summary_fa: summary } : {}) });
    emit({ type: "tool_end", call_id: call.id, ok, ...(summary ? { summary_fa: summary } : {}), ...(res?.refs?.length ? { refs: res.refs } : {}), data_ref: res?.data_ref ?? null });
    out.set(call.id, { id: call.id, name: call.name, content, ...(ok ? {} : { is_error: true }) });
    await ctx
      .write((tx) => logToolCall(tx, ctx, { id: uuidv7(), threadId: thread.id, messageId, tool: call.name, input: redactValue(call.input, policy === "full" ? "masked" : policy), ok, summary: summary ?? null, ms }), { internal: true })
      .catch(() => undefined);
  };

  // read tools in parallel; proposals one after another (each stores a row)
  const reads = calls.filter((c) => byName.get(c.name)?.kind !== "propose");
  const proposes = calls.filter((c) => byName.get(c.name)?.kind === "propose");
  await Promise.all(reads.map(runOne));
  for (const c of proposes) await runOne(c);
  return calls.map((c) => out.get(c.id)!);
}


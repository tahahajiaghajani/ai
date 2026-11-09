// AI engine — public API. A module's AI feature calls `generate` for a single answer (a summary, a classification,
// reading a document…); the assistant loop lives in ./agent.ts. Every call goes through the job's routing chain
// (fallbacks, holds), the budgets, the usage ledger and the organisation's data policy.
import type { z } from "zod";
import type { Ctx } from "../../context";
import type { AiEffort, AiErrorKind, AiJob, AiSettings } from "@shared/ai/types";
import type { AiStatus } from "@shared/ai/api";
import { aiErrorText } from "@shared/ai/errors";
import { AiUnavailableError } from "./errors";
import { assertUsable, chainFor, loadEnv, runTurn, unavailable, WEB_LABEL, webFirst, webLink, type AiEnv } from "./chain";
import { appSecretMissing } from "./connections";
import { redactDataBlocks, redactPrompt } from "./redact";
import { dataUsePlan, strictestPii } from "./datause";
import { dropNulls, jsonSchemaOf } from "./schema";
import { disabledByPlatform, featureSwitch } from "./settings";
import { budgetState } from "./usage";
import { parseJsonLoose } from "./adapters/http";
import type { Part } from "./types";

export { AiUnavailableError };

export interface GenerateAttachment {
  name?: string;
  mime: string; // image/png, image/jpeg, image/webp, application/pdf
  data: string; // base64
}

export interface GenerateOptions<S extends z.ZodTypeAny | undefined = undefined> {
  job: AiJob;
  /** usage-ledger label of the feature (registered with registerAiFeature in ./settings), e.g. "summary" */
  feature: string;
  /** stable instructions (cached by providers) */
  system: string;
  /** the user turn: data and question; untrusted text of the organisation must be wrapped as data */
  prompt: string;
  attachments?: GenerateAttachment[];
  /** structured output: the reply is parsed and validated against this schema */
  schema?: S;
  effort?: AiEffort;
  maxTokens?: number;
  /** sampling temperature (skills' versions); only OpenAI-compatible chat services of non-reasoning models get it */
  temperature?: number | null;
  signal?: AbortSignal;
  /** the raw JSON Schema sent to the provider instead of the zod schema's (a skill version's own output schema) */
  jsonSchema?: Record<string, unknown>;
  /** the answer as it is written (plain-text answers; a streamed answer is never asked again of another model) */
  onText?: (delta: string) => void;
  /**
   * the tables whose data the prompt carries: their data-use policy decides which models may answer (none, local ones
   * only, any) and may ask for stricter masking than the organisation's (datause.ts)
   */
  tables?: string[];
}

export interface GenerateResult<T = unknown> {
  text: string;
  object: T | null;
  model: string;
  connection: string;
  usage: { input: number; output: number; cache_read: number; cache_write: number; cost_usd: string | null };
}


/** Single answer through the job's routing chain (fallbacks, budgets, usage ledger, data policy). */
export async function generate<S extends z.ZodTypeAny | undefined = undefined>(
  ctx: Ctx,
  opts: GenerateOptions<S>,
): Promise<GenerateResult<S extends z.ZodTypeAny ? z.infer<S> : null>> {
  if (!ctx.can("ai", "view")) throw unavailable(ctx, "disabled");
  const env = await loadEnv(ctx);
  const sw = featureSwitch(opts.feature);
  if (sw && !env.settings.features[sw]) throw unavailable(ctx, "disabled");
  if (opts.attachments?.length && !env.settings.features.files) throw unavailable(ctx, "disabled");
  // a table may ask for stricter masking than the organisation's: the strictest of the call's tables applies
  const plan = opts.tables?.length ? await dataUsePlan(ctx, opts.tables) : null;
  const pii = strictestPii(env.settings.data_policy, plan?.pii);
  const parts: Part[] = [
    ...(opts.attachments ?? []).map((a) => ({ type: "file" as const, name: a.name, mime: a.mime, data: a.data })),
    // data blocks are redacted as structured data (names hidden under "aggregates"), the rest as typed text
    { type: "text", text: redactPrompt(redactDataBlocks(opts.prompt, pii), pii) },
  ];
  const output = opts.schema ? { name: "result", schema: opts.jsonSchema ?? jsonSchemaOf(opts.schema) } : null;
  const run = async (extra?: string) =>
    runTurn(ctx, {
      job: opts.job,
      feature: opts.feature,
      env,
      tables: opts.tables,
      request: {
        system: opts.system,
        messages: [{ role: "user", parts: extra ? [...parts, { type: "text", text: extra }] : parts }],
        output,
        effort: opts.effort ?? env.settings.effort[opts.job],
        maxTokens: opts.maxTokens ?? 16_000,
        ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
        signal: opts.signal,
      },
      hooks: opts.onText && !opts.schema ? { onText: opts.onText } : undefined,
    });
  let r = await run();
  if (r.result.stop === "refusal") throw unavailable(ctx, "refusal");
  if (r.result.stop === "aborted") throw new AiUnavailableError("timeout", "درخواست لغو شد");
  let object: unknown = null;
  if (opts.schema) {
    const parse = (text: string) => (opts.schema as z.ZodTypeAny).safeParse(dropNulls(parseJsonLoose(text)));
    let parsed = parse(r.result.text);
    if (!parsed.success) {
      // one more try, telling the model what was wrong
      r = await run(`Your previous reply was not valid JSON for the schema (${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}). Reply with the JSON object only.`);
      parsed = parse(r.result.text);
      if (!parsed.success) throw unavailable(ctx, "invalid");
    }
    object = parsed.data;
  } else if (!r.result.text.trim()) throw unavailable(ctx, "empty");
  const u = r.result.usage;
  return {
    text: r.result.text,
    object: object as GenerateResult<S extends z.ZodTypeAny ? z.infer<S> : null>["object"],
    model: r.model,
    connection: r.connection_label ?? "",
    usage: { input: u.input, output: u.output, cache_read: u.cache_read, cache_write: u.cache_write, cost_usd: r.priced ? r.cost_usd : null },
  };
}

/** Is AI usable for this job right now (configured, enabled, within budget)? Never throws. */
export async function aiStatus(ctx: Ctx, job: AiJob = "assistant"): Promise<{ ok: boolean; kind?: AiErrorKind; message_fa?: string }> {
  try {
    if (!ctx.can("ai", "view")) return { ok: false, kind: "disabled", message_fa: aiErrorText("disabled").message };
    const env = await loadEnv(ctx);
    await assertUsable(ctx, env);
    const { entries, held, total } = await chainFor(ctx, job, env);
    if (entries.length || webLink(ctx, env)) return { ok: true };
    const kind: AiErrorKind = total ? (held ?? "rate") : "not_configured";
    return { ok: false, kind, message_fa: unavailable(ctx, kind).message };
  } catch (e) {
    if (e instanceof AiUnavailableError) return { ok: false, kind: e.kind, message_fa: e.message };
    return { ok: false, kind: "other", message_fa: aiErrorText("other").message };
  }
}

/** GET /ai/status: everything the UI needs to show the assistant and the AI settings. */
export async function statusView(ctx: Ctx, env?: AiEnv): Promise<AiStatus> {
  const e = env ?? (await loadEnv(ctx));
  const canUse = ctx.can("ai", "view");
  const canManage = ctx.can("ai", "full");
  const byPlatform = disabledByPlatform(e.policy, ctx.org.id);
  const budget = await budgetState(ctx, e.settings, e.policy);
  const { entries, held, total } = await chainFor(ctx, "assistant", e);
  const link = webLink(ctx, e);
  const configured = entries.length > 0 || total > 0 || !!link;
  let kind: AiErrorKind | null = null;
  if (!canUse) kind = "disabled";
  else if (byPlatform || !e.settings.enabled) kind = "disabled";
  else if (!e.settings.features.assistant) kind = "disabled";
  else if (budget.state === "stopped") kind = "budget";
  else if (!entries.length && !link) kind = total ? (held ?? "rate") : "not_configured";
  const text = kind ? aiErrorText(kind, { canManage, desktop: ctx.cfg.mode === "desktop", byPlatform }) : null;
  // «اول نسخهٔ وب» for the assistant: the web version answers first, with a model its own chain picks
  const first = webFirst(ctx, e, "assistant") ? undefined : entries[0];
  return {
    enabled: !byPlatform && e.settings.enabled,
    configured,
    ok: !kind,
    kind,
    message_fa: text?.message ?? null,
    remedy_fa: text?.remedy ?? null,
    can_use: canUse && !byPlatform && e.settings.enabled && e.settings.features.assistant,
    can_propose: ctx.can("ai", "edit") && e.settings.features.proposals,
    can_manage: canManage,
    features: e.settings.features,
    budget,
    model: first?.model ?? null,
    connection: first?.row.label ?? (link ? WEB_LABEL : null),
    route: first ? "direct" : link ? "via_cloud" : null,
    mode: ctx.cfg.mode,
    app_secret_missing: canManage && appSecretMissing(ctx.cfg),
  };
}

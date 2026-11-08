// Windows app → web version relay. When the Windows app is linked to the web version and the
// organisation turned on «استفاده از اتصال‌های نسخهٔ وب», model calls that no local connection can
// serve — and, with «اول نسخهٔ وب», every call of the jobs chosen for it, before the local chain —
// go to POST /api/o/:org/ai/relay of the web version with the device token: the web version
// runs only the model turn through its own chain (its keys never leave it) and streams the result
// back; tools always run on the Windows app against its own database.
import { z } from "zod";
import type { Ctx, ServerConfig } from "../../context";
import type { AiDataPolicy, AiErrorKind, AiSettings } from "@shared/ai/types";
import type { AiRelayEvent } from "@shared/ai/api";
import { aiErrorText } from "@shared/ai/errors";
import { bad } from "../../http/errors";
import { AiUnavailableError } from "./errors";
import { featureSwitch } from "./settings";
import { readSse } from "./adapters/http";
import type { ChainResult, RunOptions } from "./chain";
import { recordUsage } from "./usage";
import { redactContextBlock, redactDataBlocks, redactPrompt, redactToolContent } from "./redact";
import type { TurnRequest } from "./types";

export interface CloudLink {
  url: string;
  token: string;
  org_id: string;
}

type LinkGetter = () => { url: string | null; token: string | null; org_id: string | null } | null;
const links = new WeakMap<object, LinkGetter>();

/** Called by the Windows app's server with a reader of its cloud link (src/desktop/server.ts). */
export function registerCloudLink(db: object, get: LinkGetter): void {
  links.set(db, get);
}

export function cloudLink(cfg: ServerConfig): CloudLink | null {
  if (cfg.mode !== "desktop") return null;
  const l = links.get(cfg.db)?.();
  return l?.url && l.token && l.org_id ? { url: l.url.replace(/\/+$/, ""), token: l.token, org_id: l.org_id } : null;
}

const part = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(400_000) }),
  z.object({ type: z.literal("file"), name: z.string().max(200).optional(), mime: z.string().max(100), data: z.string().max(15_000_000) }),
  z.object({ type: z.literal("tool_call"), id: z.string().max(200), name: z.string().max(100), input: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("tool_result"), id: z.string().max(200), name: z.string().max(100), content: z.string().max(400_000), is_error: z.boolean().optional() }),
]);

export const relayRequestSchema = z.object({
  job: z.enum(["assistant", "analysis", "fast", "vision"]),
  feature: z.string().max(40),
  request: z.object({
    system: z.string().max(100_000),
    systemNotes: z.string().max(10_000).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          parts: z.array(part).max(200),
          native: z.object({ protocol: z.enum(["anthropic", "openai-responses", "openai-chat", "gemini"]), model: z.string(), connection_id: z.string(), content: z.unknown() }).nullish(),
        }),
      )
      .max(400),
    tools: z.array(z.object({ name: z.string().max(100), description: z.string().max(10_000), schema: z.record(z.string(), z.unknown()) })).max(64).optional(),
    output: z.object({ name: z.string().max(100), schema: z.record(z.string(), z.unknown()) }).nullish(),
    effort: z.enum(["low", "medium", "high", "max"]).nullish(),
    maxTokens: z.number().int().min(1).max(128_000),
  }),
});
export type RelayRequest = z.infer<typeof relayRequestSchema>;

/**
 * Desktop side: one model turn through the web version. With `startMs`, the web version must begin its answer within
 * that time (it sends its headers before the model runs), or the turn fails with `network`.
 */
export async function relayTurn(ctx: Ctx, link: CloudLink, opts: RunOptions, startMs?: number): Promise<ChainResult> {
  if (link.org_id !== ctx.org.id) throw new AiUnavailableError("not_configured", aiErrorText("not_configured", { canManage: ctx.can("ai", "full"), desktop: true }).message);
  const { signal, ...request } = opts.request;
  const body: RelayRequest = { job: opts.job, feature: opts.feature, request: request as RelayRequest["request"] };
  const t0 = Date.now();
  const start = new AbortController();
  const timer = startMs ? setTimeout(() => start.abort(), startMs) : null;
  let res: Response;
  try {
    res = await ctx.cfg.fetch(`${link.url}/api/o/${link.org_id}/ai/relay`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${link.token}` },
      body: JSON.stringify(body),
      signal: timer ? (signal ? AbortSignal.any([signal, start.signal]) : start.signal) : signal,
    });
  } catch {
    if (signal?.aborted) return aborted();
    throw new AiUnavailableError("network", aiErrorText("network", { desktop: true }).message);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (signal?.aborted) return aborted();
  if (!res.ok || !res.body) {
    let msg = "";
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      msg = "";
    }
    const kind: AiErrorKind = res.status === 401 ? "auth" : res.status === 403 ? "disabled" : res.status === 429 ? "rate" : "network";
    throw new AiUnavailableError(kind, msg || aiErrorText(kind, { desktop: true }).message);
  }
  let final: ChainResult | null = null;
  try {
    for await (const { data } of readSse(res.body)) {
      const ev = data as AiRelayEvent;
      if (!ev || typeof ev !== "object") continue;
      if (ev.type === "text") opts.hooks?.onText?.(ev.delta);
      else if (ev.type === "thinking") opts.hooks?.onThinking?.(ev.delta);
      else if (ev.type === "result") final = ev.result as ChainResult;
      else if (ev.type === "error") throw new AiUnavailableError(ev.kind, ev.message_fa);
    }
  } catch (e) {
    if (signal?.aborted) return aborted();
    throw e instanceof AiUnavailableError ? e : new AiUnavailableError("network", aiErrorText("network", { desktop: true }).message);
  }
  if (!final) throw new AiUnavailableError("network", aiErrorText("network", { desktop: true }).message);
  await recordUsage(ctx, {
    feature: opts.feature, job: opts.job, preset: final.preset, model: final.model, route: "via_cloud", usage: final.result.usage,
    provider_cost: final.cost_usd, ms: Date.now() - t0, ok: final.result.stop !== "refusal", thread_id: opts.threadId,
  });
  return { ...final, route: "via_cloud" };
}

function aborted(): ChainResult {
  return {
    result: { text: "", toolCalls: [], stop: "aborted", usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, model: "", native: null },
    connection_id: null, connection_label: null, preset: null, protocol: null, model: "", route: "via_cloud", cost_usd: "0", priced: true,
  };
}

/** Ledger labels a Windows app may relay: the assistant and the registered features of modules (with their switches). */
const relayable = (feature: string) => feature === "assistant" || featureSwitch(feature) !== undefined;
/** Output tokens of one relayed turn (the assistant's own per-turn limit). */
export const RELAY_MAX_TOKENS = 32_000;

/**
 * Web side: the organisation's switches apply to relayed turns as to its own — the assistant switch for the
 * assistant, each feature's switch, and «فایل و تصویر» for any file. Throws.
 */
export function assertRelayAllowed(ctx: Ctx, settings: AiSettings, body: RelayRequest): void {
  const off = () => new AiUnavailableError("disabled", aiErrorText("disabled", { canManage: ctx.can("ai", "full") }).message);
  if (!relayable(body.feature)) throw bad("این درخواست هوش مصنوعی شناخته نیست");
  if ((body.feature === "assistant" || body.job === "assistant") && !settings.features.assistant) throw off();
  const sw = featureSwitch(body.feature);
  if (sw && !settings.features[sw]) throw off();
  if (body.request.messages.some((m) => m.parts.some((p) => p.type === "file")) && !settings.features.files) throw off();
}

/**
 * Web side: the web version's data policy binds relayed turns too. The Windows app keeps its own
 * AI settings (not synced; its policy may be laxer), so the relayed text is redacted again here
 * under the web version's policy: data blocks and the context block of the questions, tool
 * results, and identifiers in any text. Redacting what is already redacted changes nothing.
 * A message whose text changed loses its native replay (it would carry the original text).
 */
export function redactRelay(body: RelayRequest, policy: AiDataPolicy): RelayRequest {
  if (policy === "full") return body;
  const messages = body.request.messages.map((m) => {
    let changed = false;
    const parts = m.parts.map((p) => {
      if (p.type === "text") {
        const text = redactPrompt(m.role === "user" ? redactContextBlock(redactDataBlocks(p.text, policy), policy) : p.text, policy);
        if (text === p.text) return p;
        changed = true;
        return { ...p, text };
      }
      if (p.type === "tool_result") {
        const content = redactToolContent(p.content, policy);
        if (content === p.content) return p;
        changed = true;
        return { ...p, content };
      }
      return p;
    });
    return changed ? { ...m, parts, native: null } : m;
  });
  return { ...body, request: { ...body.request, messages } };
}

/** Web side: the request as a TurnRequest without a model (the web version's chain picks it). */
export function relayToRun(body: RelayRequest, signal: AbortSignal): RunOptions {
  const request = body.request as Omit<TurnRequest, "model" | "signal">;
  return {
    job: body.job,
    feature: body.feature,
    request: { ...request, maxTokens: Math.min(request.maxTokens, RELAY_MAX_TOKENS), signal },
  };
}

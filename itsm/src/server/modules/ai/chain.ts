// Routing: a job's ordered (connection, model) chain, provider errors turned into decisions
// (next connection, short holds, one retry), budgets checked before every call and every call
// written to the usage ledger. Holds live in the database so every server instance respects them.
// The Windows app may also ask the linked web version: last, when every local link failed, or
// first for the jobs in `cloud_first` («اول نسخهٔ وب»).
import type { Ctx } from "../../context";
import type { AiErrorKind, AiJob, AiProtocol, AiSettings } from "@shared/ai/types";
import type { AiPolicy } from "@shared/ai/api";
import { aiErrorText } from "@shared/ai/errors";
import { jobTier } from "@shared/ai/effort";
import { presetById } from "@shared/ai/presets";
import { uuidv7 } from "@shared/id";
import { createAdapter } from "./adapters";
import { fakeEnabled } from "./adapters/fake";
import { CONNECT_MS } from "./adapters/http";
import { adapterEnv, connectionRows, markConnection, resolveConnection, type ConnRow } from "./connections";
import { AiUnavailableError } from "./errors";
import { cloudLink, relayTurn, type CloudLink } from "./relay";
import { disabledByPlatform, loadPolicy, loadSettings } from "./settings";
import { budgetState, recordUsage } from "./usage";
import { dataUsePlan, isLocalConnection, refuseNever, refuseNoLocal } from "./datause";
import { orgAiDisabled } from "../platform/org-admin";
import { BlockedAddressError, ProviderError, type TurnHooks, type TurnRequest, type TurnResult } from "./types";

export interface ChainEntry {
  row: ConnRow;
  model: string;
}

export interface ChainResult {
  result: TurnResult;
  connection_id: string | null;
  connection_label: string | null;
  preset: string | null;
  /** wire protocol of the connection that answered (decides whether its native content can be replayed) */
  protocol: AiProtocol | null;
  /** the model the provider reports (dated snapshot, served fallback): ledger and display */
  model: string;
  /** the model id this connection was asked for: native content is replayed only to that id */
  requested_model?: string;
  route: "direct" | "via_cloud";
  cost_usd: string;
  priced: boolean;
}

/** How long a hold lasts. */
const RATE_HOLD_MS = 60_000;
const RATE_HOLD_MAX_MS = 10 * 60_000;
const QUOTA_HOLD_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Milliseconds until the next midnight in a time zone (Google's free quotas reset at midnight Pacific). */
export function msUntilMidnight(timeZone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  const secs = n("hour") * 3600 + Number(parts.find((p) => p.type === "minute")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "second")?.value ?? 0);
  return (86_400 - secs) * 1000;
}

/**
 * How long a spent quota keeps a model out of the chain. A model the plan does not include at all («limit: 0»,
 * e.g. a Pro model on a free Gemini key): a day. Google's daily free quota («…PerDay…»): until just after its reset at
 * midnight Pacific — but a reset that is minutes away may come late, so then only the usual half hour. Anything else:
 * half an hour, or what the provider asks for (at most a day).
 */
export function quotaHoldMs(message: string, retryAfterMs: number | null = null, now = new Date()): number {
  if (/\blimit: 0\b/.test(message)) return DAY_MS;
  if (/PerDay/.test(message)) {
    const left = msUntilMidnight("America/Los_Angeles", now);
    return left > 23 * 60 * 60_000 ? QUOTA_HOLD_MS : Math.max(QUOTA_HOLD_MS, left + 5 * 60_000);
  }
  return Math.min(Math.max(QUOTA_HOLD_MS, retryAfterMs ?? 0), DAY_MS);
}

export interface AiEnv {
  settings: AiSettings;
  policy: AiPolicy;
}

export async function loadEnv(ctx: Ctx): Promise<AiEnv> {
  const [settings, policy, offByAdmin] = await Promise.all([
    loadSettings(ctx.db, ctx.org.id),
    loadPolicy(ctx.cfg),
    ctx.cfg.mode === "cloud" ? orgAiDisabled(ctx.db, ctx.org.id).catch(() => false) : false,
  ]);
  // «مدیریت سامانه» can switch one organisation off (sm_org_admin) as well as through the policy
  if (offByAdmin && !policy.disabled_orgs.includes(ctx.org.id)) policy.disabled_orgs = [...policy.disabled_orgs, ctx.org.id];
  return { settings, policy };
}

function message(kind: AiErrorKind, ctx: Ctx, byPlatform = false): string {
  const t = aiErrorText(kind, { canManage: ctx.can("ai", "full"), desktop: ctx.cfg.mode === "desktop", byPlatform });
  return `${t.message} ${t.remedy}`;
}

export function unavailable(ctx: Ctx, kind: AiErrorKind, byPlatform = false): AiUnavailableError {
  return new AiUnavailableError(kind, message(kind, ctx, byPlatform));
}

/** How the Windows app names the web version where a connection's label would stand. */
export const WEB_LABEL = "نسخهٔ وب";

/** The linked web version, when this Windows app may use its connections («استفاده از اتصال‌های نسخهٔ وب»). */
export function webLink(ctx: Ctx, env: AiEnv): CloudLink | null {
  return ctx.cfg.mode === "desktop" && env.settings.use_cloud ? cloudLink(ctx.cfg) : null;
}

/** «اول نسخهٔ وب»: the linked web version answers this job before any connection of this computer. */
export function webFirst(ctx: Ctx, env: AiEnv, job: AiJob): CloudLink | null {
  return env.settings.cloud_first.includes(job) ? webLink(ctx, env) : null;
}

/** May this connection be used here (runtime, test mode, platform policy)? */
export function rowAllowed(ctx: Ctx, row: ConnRow, policy: AiPolicy): boolean {
  if (!row.enabled) return false;
  if (row.preset === "fake") return fakeEnabled();
  if (policy.allowed_presets && !policy.allowed_presets.includes(row.preset)) return false;
  if (policy.allowed_protocols && !policy.allowed_protocols.includes(row.protocol)) return false;
  // local models (Ollama, LM Studio, llama.cpp) only in the Windows app
  const preset = presetById(row.preset);
  return !preset || preset.runtimes.includes(ctx.cfg.mode === "cloud" ? "web" : "desktop");
}

interface Hold {
  connection_id: string;
  model: string;
  until: string;
  kind: string | null;
}

async function activeHolds(ctx: Ctx): Promise<Hold[]> {
  return ctx.db.query<Hold>(`select connection_id, model, until, kind from sm_ai_holds where org_id = $1 and until > now()`, [ctx.org.id]);
}

/** Pause one model of a connection (or the whole connection with model "") on every server instance. */
export async function hold(ctx: Ctx, connectionId: string, model: string, ms: number, kind: AiErrorKind, reason: string): Promise<void> {
  const until = new Date(Date.now() + ms).toISOString();
  await ctx
    .write(
      (tx) =>
        tx.query(
          `insert into sm_ai_holds (id, org_id, connection_id, model, until, kind, reason) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (connection_id, model) do update set until = greatest(sm_ai_holds.until, excluded.until), kind = excluded.kind, reason = excluded.reason`,
          [uuidv7(), ctx.org.id, connectionId, model, until, kind, reason.slice(0, 300)],
        ),
      { internal: true },
    )
    .catch(() => undefined);
}

/** The ordered chain for a job: the organisation's routing, or every enabled connection with its tier model. */
export async function chainFor(ctx: Ctx, job: AiJob, env: AiEnv): Promise<{ entries: ChainEntry[]; held: AiErrorKind | null; total: number }> {
  const rows = (await connectionRows(ctx.db, ctx.org.id)).filter((r) => rowAllowed(ctx, r, env.policy));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tier = jobTier(job);
  let entries: ChainEntry[];
  const routed = env.settings.routing[job] ?? [];
  if (routed.length) {
    entries = routed.flatMap((x) => (byId.has(x.connection_id) ? [{ row: byId.get(x.connection_id)!, model: x.model }] : []));
  } else {
    // every model of the tier in its listed order («اولی اصلی است؛ بقیه به‌ترتیب جایگزین می‌شوند»): a free plan's
    // daily quota is per model, so the second model keeps answering when the first one runs out
    entries = rows.flatMap((row) => {
      const models = row.models?.[tier]?.length ? row.models[tier]! : (row.models?.smart ?? []);
      return [...new Set(models.filter(Boolean))].map((model) => ({ row, model }));
    });
  }
  const total = entries.length;
  const holds = await activeHolds(ctx);
  let held: AiErrorKind | null = null;
  entries = entries.filter((e) => {
    const h = holds.find((x) => x.connection_id === e.row.id && (x.model === "" || x.model === e.model));
    if (h) held = (h.kind as AiErrorKind) ?? "rate";
    return !h;
  });
  return { entries, held, total };
}

export interface RunOptions {
  job: AiJob;
  feature: string;
  request: Omit<TurnRequest, "model">;
  hooks?: TurnHooks;
  threadId?: string | null;
  env?: AiEnv;
  /**
   * the tables whose data the request carries: the data-use policy of each (datause.ts) decides which connections may
   * answer — none («هرگز»), the local ones only («فقط محلی»), or any
   */
  tables?: string[];
}

/** Throws AiUnavailableError when AI is off or over budget for this member. */
export async function assertUsable(ctx: Ctx, env: AiEnv): Promise<void> {
  if (disabledByPlatform(env.policy, ctx.org.id)) throw unavailable(ctx, "disabled", true);
  if (!env.settings.enabled) throw unavailable(ctx, "disabled");
  const budget = await budgetState(ctx, env.settings, env.policy);
  if (budget.state === "stopped") throw unavailable(ctx, "budget");
}

/**
 * The second try after a provider rejected a request as invalid: without the effort setting.
 * Files stay: an answer about an attachment the model never saw is worse than moving on to the next connection.
 */
function stripForRetry(req: Omit<TurnRequest, "model">): Omit<TurnRequest, "model"> | null {
  if (!req.effort) return null;
  return { ...req, effort: null };
}

/**
 * «اول نسخهٔ وب»: one turn through the web version before this computer's chain. Its answer is final — a refusal or a
 * stop included, never asked again of another model. A failure (unreachable, no answer begun within CONNECT_MS, its
 * connections held, switched off or over budget there) comes back as the error, so that this computer's connections
 * answer instead; once part of an answer has reached the person, the failure is thrown, as in the chain.
 */
async function askWebFirst(ctx: Ctx, link: CloudLink, opts: RunOptions): Promise<ChainResult | AiUnavailableError> {
  let emitted = false;
  const hooks: TurnHooks = {
    onText: (d) => {
      emitted = true;
      opts.hooks?.onText?.(d);
    },
    onThinking: (d) => opts.hooks?.onThinking?.(d),
  };
  try {
    return await relayTurn(ctx, link, { ...opts, hooks }, CONNECT_MS);
  } catch (e) {
    if (emitted || opts.request.signal?.aborted || !(e instanceof AiUnavailableError) || e.kind === "refusal") throw e;
    return e;
  }
}

/** One model turn through the job's chain with fallbacks. */
export async function runTurn(ctx: Ctx, opts: RunOptions): Promise<ChainResult> {
  const env = opts.env ?? (await loadEnv(ctx));
  await assertUsable(ctx, env);
  // the data-use policy of the tables in the request, before any call: never → refused; local → local connections
  // only, and never the web version's (a relay leaves this computer)
  const plan = opts.tables?.length ? await dataUsePlan(ctx, opts.tables) : null;
  if (plan?.use === "never") await refuseNever(ctx, plan, opts.feature);
  const localOnly = plan?.use === "local";
  const link = localOnly ? null : webLink(ctx, env);
  // the Windows app with «اول نسخهٔ وب» on for this job: a model on this computer (minutes for the assistant's long
  // first prompt without a graphics card) answers only when the web version cannot
  let webError: AiUnavailableError | null = null;
  if (link && env.settings.cloud_first.includes(opts.job)) {
    const first = await askWebFirst(ctx, link, opts);
    if (!(first instanceof AiUnavailableError)) return first;
    webError = first;
  }
  const chain = await chainFor(ctx, opts.job, env);
  const { held, total } = chain;
  let entries = chain.entries;
  if (localOnly) {
    entries = entries.filter((e) => isLocalConnection(e.row));
    if (!entries.length) {
      const configured = (await connectionRows(ctx.db, ctx.org.id)).some((r) => rowAllowed(ctx, r, env.policy) && isLocalConnection(r));
      if (configured) throw unavailable(ctx, held ?? "rate");
      await refuseNoLocal(ctx, plan!, opts.feature);
    }
  }

  if (!entries.length) {
    if (webError) throw webError;
    if (link) return relayTurn(ctx, link, opts);
    throw unavailable(ctx, total ? (held ?? "rate") : "not_configured");
  }

  let lastKind: AiErrorKind = "other";
  let lastDetail = "";
  for (const entry of entries) {
    let conn;
    try {
      conn = resolveConnection(ctx.cfg, entry.row);
    } catch (e) {
      const pe = e as ProviderError;
      lastKind = pe.kind ?? "auth";
      lastDetail = pe.message;
      continue;
    }
    const adapter = createAdapter(conn, adapterEnv(ctx.cfg));
    let req = opts.request;
    let retried = false;
    for (;;) {
      let emitted = false;
      const hooks: TurnHooks = {
        onText: (d) => {
          emitted = true;
          opts.hooks?.onText?.(d);
        },
        onThinking: (d) => opts.hooks?.onThinking?.(d),
      };
      const t0 = Date.now();
      const local = conn.preset.region === "local";
      try {
        const result = await adapter.turn({ ...req, model: entry.model }, hooks);
        const cost = await recordUsage(ctx, {
          feature: opts.feature, job: opts.job, connection_id: conn.id, preset: conn.preset.id, model: result.model || entry.model, usage: result.usage,
          provider_cost: result.providerCostUsd, local, free: entry.row.free_tier, ms: Date.now() - t0, ok: result.stop !== "refusal", error_kind: result.stop === "refusal" ? "refusal" : null, thread_id: opts.threadId,
        });
        if (entry.row.status !== "ok") void markConnection(ctx, conn.id, { ok: true });
        const out: ChainResult = { result, connection_id: conn.id, connection_label: conn.label, preset: conn.preset.id, protocol: conn.protocol, model: result.model || entry.model, requested_model: entry.model, route: "direct", cost_usd: cost.cost_usd, priced: cost.priced };
        if (result.stop === "aborted" || emitted) return out;
        if (result.stop === "refusal") {
          lastKind = "refusal";
          if (entry === entries[entries.length - 1]) return out;
          break;
        }
        if (!result.text.trim() && !result.toolCalls.length && result.stop !== "max_tokens") {
          lastKind = "empty";
          if (!retried) {
            retried = true;
            continue;
          }
          break;
        }
        return out;
      } catch (e) {
        if (opts.request.signal?.aborted) {
          return { result: { text: "", toolCalls: [], stop: "aborted", usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, model: entry.model, native: null }, connection_id: conn.id, connection_label: conn.label, preset: conn.preset.id, protocol: conn.protocol, model: entry.model, route: "direct", cost_usd: "0", priced: true };
        }
        const pe = e instanceof ProviderError ? e : new ProviderError("other", String((e as Error)?.message ?? e).slice(0, 300));
        await recordUsage(ctx, { feature: opts.feature, job: opts.job, connection_id: conn.id, preset: conn.preset.id, model: entry.model, free: entry.row.free_tier, ms: Date.now() - t0, ok: false, error_kind: pe.kind, thread_id: opts.threadId });
        lastKind = pe.kind;
        lastDetail = pe.message;
        // part of an answer already reached the person: a second model would start it over
        if (emitted) throw new AiUnavailableError(pe.kind, message(pe.kind, ctx));
        if (pe.kind === "rate") {
          // per model: providers (Gemini, OpenAI, Groq…) count requests per minute per model, so the connection's
          // other models stay usable; a provider that counts per key answers the next model with its own 429
          await hold(ctx, conn.id, entry.model, Math.min(Math.max(pe.retryAfterMs ?? RATE_HOLD_MS, 5_000), RATE_HOLD_MAX_MS), "rate", pe.message);
          break;
        }
        if (pe.kind === "quota") {
          await hold(ctx, conn.id, entry.model, quotaHoldMs(pe.message, pe.retryAfterMs), "quota", pe.message);
          break;
        }
        if (pe instanceof BlockedAddressError) {
          // the address itself is refused: no retry, and the connection shows why
          await markConnection(ctx, conn.id, { ok: false, kind: pe.kind, detail: pe.message });
          break;
        }
        if ((pe.kind === "overloaded" || pe.kind === "timeout" || pe.kind === "network") && !retried) {
          retried = true;
          await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 700)));
          continue;
        }
        if (pe.kind === "invalid" && !retried) {
          retried = true;
          const next = stripForRetry(req);
          if (next) {
            req = next;
            continue;
          }
        }
        if (pe.kind === "auth" || pe.kind === "region" || pe.kind === "model") await markConnection(ctx, conn.id, { ok: false, kind: pe.kind, detail: pe.message });
        break;
      }
    }
  }
  // the Windows app: every local link failed (a foreign service refused Iran, a gateway was down, a quota ran
  // out), so the web version's connections answer when «استفاده از اتصال‌های نسخهٔ وب» is on — unless it was
  // asked first and could not
  if (link && !webError && lastKind !== "refusal") return relayTurn(ctx, link, opts);
  const err = unavailable(ctx, lastKind);
  if (lastDetail && ctx.can("ai", "full")) err.message = `${err.message} (${lastDetail.slice(0, 200)})`;
  throw err;
}

// Routing: a job's ordered (connection, model) chain, provider errors turned into decisions
// (next connection, short holds, one retry), budgets checked before every call and every call
// written to the usage ledger. Holds live in the database so every server instance respects them.
import type { Ctx } from "../../context";
import type { AiErrorKind, AiJob, AiProtocol, AiSettings } from "@shared/ai/types";
import type { AiPolicy } from "@shared/ai/api";
import { aiErrorText } from "@shared/ai/errors";
import { jobTier } from "@shared/ai/effort";
import { presetById } from "@shared/ai/presets";
import { uuidv7 } from "@shared/id";
import { createAdapter } from "./adapters";
import { fakeEnabled } from "./adapters/fake";
import { adapterEnv, connectionRows, markConnection, resolveConnection, type ConnRow } from "./connections";
import { AiUnavailableError } from "./errors";
import { cloudLink, relayTurn } from "./relay";
import { disabledByPlatform, loadPolicy, loadSettings } from "./settings";
import { budgetState, recordUsage } from "./usage";
import { orgAiDisabled } from "../platform/org-admin";
import { ProviderError, type TurnHooks, type TurnRequest, type TurnResult } from "./types";

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
  // «مدیریت سامانه» can switch one business off (tz_org_admin) as well as through the policy
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
  return ctx.db.query<Hold>(`select connection_id, model, until, kind from tz_ai_holds where org_id = $1 and until > now()`, [ctx.org.id]);
}

async function hold(ctx: Ctx, connectionId: string, model: string, ms: number, kind: AiErrorKind, reason: string): Promise<void> {
  const until = new Date(Date.now() + ms).toISOString();
  await ctx
    .write(
      (tx) =>
        tx.query(
          `insert into tz_ai_holds (id, org_id, connection_id, model, until, kind, reason) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (connection_id, model) do update set until = greatest(tz_ai_holds.until, excluded.until), kind = excluded.kind, reason = excluded.reason`,
          [uuidv7(), ctx.org.id, connectionId, model, until, kind, reason.slice(0, 300)],
        ),
      { internal: true },
    )
    .catch(() => undefined);
}

/** The ordered chain for a job: the business's routing, or every enabled connection with its tier model. */
export async function chainFor(ctx: Ctx, job: AiJob, env: AiEnv): Promise<{ entries: ChainEntry[]; held: AiErrorKind | null; total: number }> {
  const rows = (await connectionRows(ctx.db, ctx.org.id)).filter((r) => rowAllowed(ctx, r, env.policy));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tier = jobTier(job);
  let entries: ChainEntry[];
  const routed = env.settings.routing[job] ?? [];
  if (routed.length) {
    entries = routed.flatMap((x) => (byId.has(x.connection_id) ? [{ row: byId.get(x.connection_id)!, model: x.model }] : []));
  } else {
    entries = rows.flatMap((row) => {
      const m = row.models?.[tier]?.[0] ?? row.models?.smart?.[0];
      return m ? [{ row, model: m }] : [];
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
 * Files stay: a reading of a document the model never saw (capture caches it for 30 days) or an
 * answer about an attachment it did not get is worse than moving on to the next connection.
 */
function stripForRetry(req: Omit<TurnRequest, "model">): Omit<TurnRequest, "model"> | null {
  if (!req.effort) return null;
  return { ...req, effort: null };
}

/** One model turn through the job's chain with fallbacks. */
export async function runTurn(ctx: Ctx, opts: RunOptions): Promise<ChainResult> {
  const env = opts.env ?? (await loadEnv(ctx));
  await assertUsable(ctx, env);
  const { entries, held, total } = await chainFor(ctx, opts.job, env);

  if (!entries.length) {
    const link = ctx.cfg.mode === "desktop" && env.settings.use_cloud ? cloudLink(ctx.cfg) : null;
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
          provider_cost: result.providerCostUsd, local, ms: Date.now() - t0, ok: result.stop !== "refusal", error_kind: result.stop === "refusal" ? "refusal" : null, thread_id: opts.threadId,
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
        await recordUsage(ctx, { feature: opts.feature, job: opts.job, connection_id: conn.id, preset: conn.preset.id, model: entry.model, ms: Date.now() - t0, ok: false, error_kind: pe.kind, thread_id: opts.threadId });
        lastKind = pe.kind;
        lastDetail = pe.message;
        // part of an answer already reached the person: a second model would start it over
        if (emitted) throw new AiUnavailableError(pe.kind, message(pe.kind, ctx));
        if (pe.kind === "rate") {
          await hold(ctx, conn.id, "", Math.min(Math.max(pe.retryAfterMs ?? RATE_HOLD_MS, 5_000), RATE_HOLD_MAX_MS), "rate", pe.message);
          break;
        }
        if (pe.kind === "quota") {
          await hold(ctx, conn.id, entry.model, QUOTA_HOLD_MS, "quota", pe.message);
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
  const err = unavailable(ctx, lastKind);
  if (lastDetail && ctx.can("ai", "full")) err.message = `${err.message} (${lastDetail.slice(0, 200)})`;
  throw err;
}

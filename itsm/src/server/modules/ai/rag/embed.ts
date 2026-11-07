// The organisation's embedding model for retrieval: which connection embeds (the setting, or the first enabled
// connection with an embedding model), and `embedTexts` — Persian normalisation and the data policy before anything
// leaves, batches per API, one retry on a passing failure, holds on rate limits and quotas (per model, in sm_ai_holds,
// like the chat chain), the usage ledger (feature «rag_embed») and the budgets. Without a usable model the index keeps
// working with the local embedder and full-text search; vectors follow once the model answers (job rag.embed).
import type { Ctx } from "../../../context";
import type { AiEmbedConfig, AiErrorKind } from "@shared/ai/types";
import { clipTokens, normalizeFa } from "@shared/ai/text";
import { aiErrorText } from "@shared/ai/errors";
import { adapterEnv, connectionRows, markConnection, resolveConnection, type ConnRow } from "../connections";
import { assertUsable, hold, loadEnv, quotaHoldMs, rowAllowed, type AiEnv } from "../chain";
import { recordUsage } from "../usage";
import { redactPrompt } from "../redact";
import { BlockedAddressError, ProviderError, type ResolvedConnection } from "../types";
import { AiUnavailableError } from "../errors";
import { EMBED_BATCH, embedCall, type EmbedKind } from "../adapters/embed";

export type { EmbedKind };

export interface EmbedderInfo {
  /** what the vectors are comparable by: preset, model and size */
  key: string;
  row: ConnRow;
  config: AiEmbedConfig;
}

/** The key of a connection's embedding (vectors with the same key are comparable). */
export function embedKey(row: Pick<ConnRow, "preset">, cfg: AiEmbedConfig): string {
  return `${row.preset}:${cfg.model}:${cfg.dims ?? "n"}`;
}

/**
 * The embedding model retrieval uses on this runtime: the connection named in «نمایه و بازیابی», else the first enabled
 * connection (by priority) with an embedding model. Null = the local embedder only. AI switched off or a held model does
 * not change it (vectors stay comparable; calls wait).
 */
export async function activeEmbedder(ctx: Ctx, env?: AiEnv): Promise<EmbedderInfo | null> {
  const e = env ?? (await loadEnv(ctx));
  if (!e.settings.rag.enabled) return null;
  const rows = (await connectionRows(ctx.db, ctx.org.id)).filter((r) => r.embed?.model && rowAllowed(ctx, r, e.policy));
  const chosen = e.settings.rag.embed_connection_id ? rows.find((r) => r.id === e.settings.rag.embed_connection_id) : rows[0];
  const row = chosen ?? (e.settings.rag.embed_connection_id ? null : rows[0]);
  if (!row?.embed) return null;
  return { key: embedKey(row, row.embed), row, config: row.embed };
}

/** The embedding model cannot answer now; `retryInMs` is when it may (a hold), null when unknown. */
export class EmbedUnavailableError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
    public retryInMs: number | null = null,
  ) {
    super(message);
    this.name = "EmbedUnavailableError";
  }
}

/** A hold on the embedding model (or its whole connection): when it ends, or null. */
export async function embedHeldUntil(ctx: Ctx, info: EmbedderInfo): Promise<{ until: number; kind: string | null } | null> {
  const h = await ctx.db.one<{ until: string; kind: string | null }>(
    `select until, kind from sm_ai_holds where org_id = $1 and connection_id = $2 and (model = '' or model = $3) and until > now() order by until desc limit 1`,
    [ctx.org.id, info.row.id, info.config.model],
  );
  return h ? { until: Date.parse(String(h.until)), kind: h.kind } : null;
}

const RATE_HOLD_MS = 60_000;

/**
 * Vectors of `texts` from the organisation's embedding model (same order). Throws EmbedUnavailableError when AI is off,
 * over budget, held, or the provider fails (after one retry of a passing failure); nothing is half-done for the caller.
 */
export async function embedTexts(ctx: Ctx, info: EmbedderInfo, texts: string[], kind: EmbedKind, opts: { signal?: AbortSignal; env?: AiEnv } = {}): Promise<number[][]> {
  if (!texts.length) return [];
  const env = opts.env ?? (await loadEnv(ctx));
  try {
    await assertUsable(ctx, env);
  } catch (e) {
    if (e instanceof AiUnavailableError) throw new EmbedUnavailableError(e.kind, e.message);
    throw e;
  }
  const held = await embedHeldUntil(ctx, info);
  if (held) throw new EmbedUnavailableError((held.kind as AiErrorKind) ?? "rate", aiErrorText((held.kind as AiErrorKind) ?? "rate").message, Math.max(1000, held.until - Date.now()));
  let conn: ResolvedConnection;
  try {
    conn = resolveConnection(ctx.cfg, info.row);
  } catch (e) {
    const pe = e as ProviderError;
    throw new EmbedUnavailableError(pe.kind ?? "auth", pe.message);
  }
  const policy = env.settings.data_policy;
  const local = conn.preset.region === "local";
  // what leaves the server: the normal form, personal identifiers masked by the data policy, at most ~6000 tokens each
  const inputs = texts.map((t) => clipTokens(local ? normalizeFa(t) : redactPrompt(normalizeFa(t), policy), 6000) || ".");
  const out: number[][] = [];
  const size = EMBED_BATCH[info.config.api] ?? 64;
  for (let i = 0; i < inputs.length; i += size) {
    const batch = inputs.slice(i, i + size);
    let retried = false;
    for (;;) {
      const t0 = Date.now();
      try {
        const r = await embedCall(conn, info.config, batch, kind, adapterEnv(ctx.cfg), opts.signal);
        await recordUsage(ctx, {
          feature: "rag_embed", job: "embed", connection_id: conn.id, preset: conn.preset.id, model: info.config.model,
          usage: { input: r.tokens, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, local, free: info.row.free_tier, ms: Date.now() - t0, ok: true,
        });
        if (info.row.status === "error") void markConnection(ctx, conn.id, { ok: true });
        out.push(...r.vectors);
        break;
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError("other", String((e as Error)?.message ?? e).slice(0, 300));
        await recordUsage(ctx, { feature: "rag_embed", job: "embed", connection_id: conn.id, preset: conn.preset.id, model: info.config.model, local, free: info.row.free_tier, ms: Date.now() - t0, ok: false, error_kind: pe.kind });
        if (opts.signal?.aborted) throw new EmbedUnavailableError("timeout", "درخواست لغو شد");
        if (pe.kind === "rate") {
          const ms = Math.min(Math.max(pe.retryAfterMs ?? RATE_HOLD_MS, 5_000), 10 * 60_000);
          await hold(ctx, conn.id, info.config.model, ms, "rate", pe.message);
          throw new EmbedUnavailableError("rate", aiErrorText("rate").message, ms);
        }
        if (pe.kind === "quota") {
          const ms = quotaHoldMs(pe.message, pe.retryAfterMs);
          await hold(ctx, conn.id, info.config.model, ms, "quota", pe.message);
          throw new EmbedUnavailableError("quota", aiErrorText("quota").message, ms);
        }
        if (!(pe instanceof BlockedAddressError) && (pe.kind === "overloaded" || pe.kind === "timeout" || pe.kind === "network") && !retried) {
          retried = true;
          await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 700)));
          continue;
        }
        if (pe instanceof BlockedAddressError || pe.kind === "auth" || pe.kind === "region" || pe.kind === "model") await markConnection(ctx, conn.id, { ok: false, kind: pe.kind, detail: pe.message });
        throw new EmbedUnavailableError(pe.kind, `${aiErrorText(pe.kind).message}${ctx.can("ai", "full") ? ` (${pe.message.slice(0, 200)})` : ""}`);
      }
    }
  }
  return out;
}

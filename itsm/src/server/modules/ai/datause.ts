// The data-use policy per table (docs/spec/AI.md §14.2) — the organisation's data policy (redact.ts: what is masked
// before anything leaves) extended to WHERE a table's data may go:
//   · «مدل‌های ابری و محلی» (cloud, the default): any connection of the chain;
//   · «فقط مدل‌های محلی سازمان» (local): only connections that run on the organisation's own computers — the local
//     presets (Ollama, LM Studio, llama.cpp) and any connection whose address is this computer or the private network —
//     never the web version's connections through the relay;
//   · «هرگز» (never): no model at all; the call is refused before it is made.
// A table may also ask for stricter masking than the organisation's («پوشاندن شناسه‌ها» / «… و نام افراد»). Every
// model call that carries record data names its tables (`tables` of generate / runTurn; the assistant and agents add
// the tables of every tool result in the conversation); the chain applies the strictest rule of those tables before any
// call, and refusals are written to the governance log (sm_ai_guard_log). Policies are engine rows (`ai_data_policy`,
// synced: one policy on the web version and the Windows app); only AI administrators change them.
import type { AiDataPolicy } from "@shared/ai/types";
import { AI_DATA_POLICY } from "@shared/tables/ai-governance";
import { presetById } from "@shared/ai/presets";
import { tableDef } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../../context";
import { registerHooks } from "../../engine";
import { AppError, bad, forbidden } from "../../http/errors";
import { AiUnavailableError } from "./errors";
import type { ConnRow } from "./connections";

export type DataUse = "cloud" | "local" | "never";

export interface TablePolicy {
  use: DataUse;
  pii: AiDataPolicy | null;
}

export interface DataUsePlan {
  use: DataUse;
  /** the strictest masking the tables ask for (null: the organisation's own) */
  pii: AiDataPolicy | null;
  /** tables whose data may reach no model */
  never: string[];
  /** tables whose data may reach local models only */
  local: string[];
  tables: string[];
}

const TTL = 30_000;
const cache = new Map<string, { at: number; rows: Map<string, TablePolicy> }>();

/** Forget an organisation's policies (a policy row was written). */
export const invalidateDataUse = (orgId: string): void => void cache.delete(orgId);

/** The organisation's policies by table (rows as the system; a short memory per organisation). */
export async function tablePolicies(ctx: Ctx): Promise<Map<string, TablePolicy>> {
  const hit = cache.get(ctx.org.id);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const rows = await ctx.db.query<{ table_key: string; use: string; pii: string }>(`select table_key, "use", pii from sm_ai_data_policies where org_id = $1 and deleted_at is null`, [ctx.org.id]).catch(() => []);
  const out = new Map<string, TablePolicy>();
  for (const r of rows) {
    const use: DataUse = r.use === "local" || r.use === "never" ? r.use : "cloud";
    const pii: AiDataPolicy | null = r.pii === "masked" || r.pii === "aggregates" ? r.pii : null;
    out.set(r.table_key, { use, pii });
  }
  cache.set(ctx.org.id, { at: Date.now(), rows: out });
  return out;
}

const PII_RANK: Record<AiDataPolicy, number> = { full: 0, masked: 1, aggregates: 2 };

/** The stricter of two maskings. */
export function strictestPii(a: AiDataPolicy, b: AiDataPolicy | null | undefined): AiDataPolicy {
  return b && PII_RANK[b] > PII_RANK[a] ? b : a;
}

/** The rule a call carrying data of `tables` is held to: never wins over local, local over cloud. */
export async function dataUsePlan(ctx: Ctx, tables: Iterable<string | null | undefined>): Promise<DataUsePlan> {
  const list = [...new Set([...tables].filter((t): t is string => typeof t === "string" && !!t))].sort();
  if (!list.length) return { use: "cloud", pii: null, never: [], local: [], tables: [] };
  const policies = await tablePolicies(ctx);
  const never: string[] = [];
  const local: string[] = [];
  let pii: AiDataPolicy | null = null;
  for (const t of list) {
    const p = policies.get(t);
    if (!p) continue;
    if (p.use === "never") never.push(t);
    else if (p.use === "local") local.push(t);
    if (p.pii) pii = pii ? strictestPii(pii, p.pii) : p.pii;
  }
  return { use: never.length ? "never" : local.length ? "local" : "cloud", pii, never, local, tables: list };
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+\.(local|lan|internal))$/i;

/**
 * Does a connection run on the organisation's own computers: a local preset (Ollama, LM Studio, llama.cpp), or any
 * connection whose address is this computer or the private network. (The test responder counts as a cloud service
 * unless its address says otherwise.)
 */
export function isLocalConnection(row: Pick<ConnRow, "preset" | "base_url">): boolean {
  const preset = presetById(row.preset);
  const url = row.base_url ?? (preset?.region === "local" ? preset.base_url : null);
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (host && PRIVATE_HOST.test(host)) return true;
  return preset?.region === "local" && row.preset !== "fake";
}

const labelOf = (t: string) => tableDef(t)?.plural ?? t;

/** The Persian refusal of a plan («داده‌های رخدادها به هیچ مدلی داده نمی‌شود…»). */
export function policyMessage(plan: DataUsePlan, reason: "never" | "local"): string {
  if (reason === "never") return `سیاست دادهٔ سازمان اجازه نمی‌دهد دادهٔ «${plan.never.map(labelOf).join("، ")}» به هیچ مدل هوش مصنوعی برسد.`;
  return `دادهٔ «${plan.local.map(labelOf).join("، ")}» فقط به مدل‌های محلی سازمان داده می‌شود و هیچ مدل محلی‌ای در زنجیرهٔ این کار نیست.`;
}

/** A refusal or hold-back of the AI layer, kept for the governance console (never fails the caller). */
export async function logGuard(ctx: Ctx, e: { kind: "policy" | "guardrail" | "access" | "budget"; feature?: string | null; tables?: string[]; detail?: string | null }): Promise<void> {
  await ctx
    .write(
      (tx) =>
        tx.query(`insert into sm_ai_guard_log (id, org_id, kind, feature, tables, user_id, detail) values ($1, $2, $3, $4, $5::text[], $6, $7)`, [
          uuidv7(),
          ctx.org.id,
          e.kind,
          e.feature?.slice(0, 60) ?? null,
          `{${(e.tables ?? []).map((t) => t.replace(/[^a-z0-9_]/g, "")).join(",")}}`,
          ctx.actor === "system" ? null : ctx.user.id,
          e.detail?.slice(0, 500) ?? null,
        ]),
      { internal: true },
    )
    .catch(() => undefined);
}

/** Refuse a call whose plan forbids every model (logged), as an «ai_policy» error with the Persian reason. */
export async function refuseNever(ctx: Ctx, plan: DataUsePlan, feature: string): Promise<never> {
  const message = policyMessage(plan, "never");
  await logGuard(ctx, { kind: "policy", feature, tables: plan.never, detail: message });
  throw new AiUnavailableError("policy", message);
}

/** Refuse a local-only call that has no local model (logged). */
export async function refuseNoLocal(ctx: Ctx, plan: DataUsePlan, feature: string): Promise<never> {
  const message = policyMessage(plan, "local");
  await logGuard(ctx, { kind: "policy", feature, tables: plan.local, detail: message });
  throw new AiUnavailableError("policy", message);
}

let installed = false;

/** Guards of the policy rows: AI administrators only, a known table, one row per table; the cache follows writes. */
export function installDataUse(): void {
  if (installed) return;
  installed = true;
  registerHooks(AI_DATA_POLICY, {
    beforeWrite(w) {
      if (w.ctx.actor !== "system" && !w.ctx.can("ai", "full")) throw forbidden("سیاست دادهٔ هوش مصنوعی را فقط مدیر هوش مصنوعی سازمان تغییر می‌دهد");
      if (w.op === "delete") return;
      const t = tableDef(String(w.next.table_key ?? ""));
      if (!t || t.virtual) throw bad(`جدول «${String(w.next.table_key ?? "")}» وجود ندارد`);
      if (w.op === "update" && w.prev && w.prev.table_key !== w.next.table_key) throw bad("جدول یک سیاست پس از ثبت تغییر نمی‌کند");
    },
    afterWrite(w) {
      invalidateDataUse(w.ctx.org.id);
    },
  });
}

// ----- conversations: the assistant and the agents ----------------------------------------------------------------

const GENERATED_TOOL = /^(?:search|get|aggregate|history|draft_create|draft_update|draft_transition|draft_batch)_([a-z][a-z0-9_]*)$/;

/** The tables a tool call reads: a generated tool's own table, the `table`/`to_table`/`tables` of its input, and the
 * tables a registered tool declares. */
export function toolTables(name: string, input: unknown, declared: readonly string[] = []): string[] {
  const out = new Set<string>(declared);
  const m = GENERATED_TOOL.exec(name);
  if (m && tableDef(m[1])) out.add(m[1]);
  const p = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const k of ["table", "to_table"]) if (typeof p[k] === "string" && tableDef(p[k] as string)) out.add(p[k] as string);
  if (Array.isArray(p.tables)) for (const t of p.tables) if (typeof t === "string" && tableDef(t)) out.add(t);
  return [...out];
}

/** The tables of the records a tool's result refers to (its refs). */
export const refTables = (refs: readonly { type: string }[] | undefined): string[] => [...new Set((refs ?? []).map((r) => r.type).filter((t) => !!tableDef(t)))];

/** The key under which a tool result names tables its call did not (kept in the conversation for later turns). */
export const DATA_TABLES_KEY = "data_tables";

interface ConvPart {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  is_error?: boolean;
}

/**
 * The tables whose data a conversation holds: every tool call that answered (by its name and input) and the tables a
 * result named itself. Computed from the stored history, so a later turn of the same conversation is held to the
 * same policy as the turn that read the data.
 */
export function conversationTables(messages: readonly { parts: readonly ConvPart[] }[], declared: (name: string) => readonly string[] = () => []): string[] {
  const failed = new Set<string>();
  const out = new Set<string>();
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== "tool_result") continue;
      if (p.is_error && p.id) failed.add(p.id);
      const at = p.content ? p.content.indexOf(`"${DATA_TABLES_KEY}":[`) : -1;
      if (at >= 0) {
        const list = /\[([^\]]*)\]/.exec(p.content!.slice(at))?.[1] ?? "";
        for (const t of list.split(",").map((x) => x.replace(/["\s]/g, ""))) if (tableDef(t)) out.add(t);
      }
    }
  }
  for (const m of messages) for (const p of m.parts) if (p.type === "tool_call" && p.name && !(p.id && failed.has(p.id))) for (const t of toolTables(p.name, p.input, declared(p.name))) out.add(t);
  return [...out].sort();
}

/**
 * May a tool's data join this conversation: refused (an AppError the loop hands the model as the tool's error, logged)
 * when a table's policy is «هرگز», or «فقط محلی» while the conversation's models are not all local.
 */
export async function assertToolData(ctx: Ctx, tables: readonly string[], feature: string, localOnlyChain: boolean): Promise<DataUsePlan> {
  const plan = await dataUsePlan(ctx, tables);
  if (plan.use === "cloud" || (plan.use === "local" && localOnlyChain)) return plan;
  const message = policyMessage(plan, plan.use === "never" ? "never" : "local");
  await logGuard(ctx, { kind: "policy", feature, tables: plan.use === "never" ? plan.never : plan.local, detail: message });
  throw new AppError(403, "ai_policy", message, { kind: "policy" });
}

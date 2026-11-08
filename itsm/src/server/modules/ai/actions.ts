// Proposals: writes the assistant prepared (sm_ai_actions). Nothing changes until a permitted
// person confirms one: confirming re-checks the proposal's own area/level, runs the executor of
// stream D (the normal service, inside its own ctx.write), and writes an «ai_action» audit row
// with the confirming person as the actor. Confirming twice returns the first result; proposals
// expire after 24 hours.
import { createHash } from "node:crypto";
import type { Ctx } from "../../context";
import type { AiProposal, AiProposalStatus, AiRef } from "@shared/ai/types";
import type { AiActionView } from "@shared/ai/api";
import type { Area, Level } from "@shared/permissions";
import { uuidv7 } from "@shared/id";
import { pgArray } from "../../db";
import { AppError, conflict, forbidden, notFound } from "../../http/errors";
import { audit } from "../data/crud";
import { tableDef } from "@shared/tables";
import type { FieldGroup } from "@shared/model/types";
import { access } from "../../access/provider";
import { readableIds } from "../../access/service";
import type { AiProposalInput } from "./tools/registry";
import { executeProposal } from "./tools/proposals";

export const PROPOSAL_TTL_MS = 24 * 3600 * 1000;

interface ActionRow {
  id: string;
  org_id: string;
  thread_id: string | null;
  message_id: string | null;
  user_id: string;
  kind: string;
  tool: string | null;
  area: Area;
  level: Level;
  payload: unknown;
  payload_hash: string;
  preview: Omit<AiProposal, "id" | "kind" | "status" | "expires_at" | "result" | "error">;
  status: AiProposalStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  result: AiRef | null;
  error: string | null;
  expires_at: string;
  created_at: string;
  /** a skill's proposal: the record it would change and the fields it touches (null for the assistant's) */
  record_table: string | null;
  record_id: string | null;
  fields: string[] | null;
  skill_run_id: string | null;
  principal: string | null;
}

const COLS = `id, org_id, thread_id, message_id, user_id, kind, tool, area, level, payload, payload_hash, preview, status, confirmed_by, confirmed_at, result, error, expires_at, created_at, record_table, record_id, fields, skill_run_id, principal`;

/** JSON with object keys sorted at every level: the same text before and after a jsonb round trip (which reorders keys). */
function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    return v;
  };
  // the JSON round trip first drops undefined fields and turns dates into strings, as storing does
  return JSON.stringify(norm(JSON.parse(JSON.stringify(value ?? null))));
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function effectiveStatus(r: ActionRow): AiProposalStatus {
  return r.status === "proposed" && Date.parse(r.expires_at) <= Date.now() ? "expired" : r.status;
}

export function toProposal(r: ActionRow): AiProposal {
  const p = r.preview;
  return {
    id: r.id,
    kind: r.kind,
    title_fa: p.title_fa,
    summary_fa: p.summary_fa,
    preview: p.preview ?? [],
    ...(p.lines ? { lines: p.lines } : {}),
    ...(p.line_headers ? { line_headers: p.line_headers } : {}),
    ...(p.warnings?.length ? { warnings: p.warnings } : {}),
    status: effectiveStatus(r),
    ...(p.edit_path ? { edit_path: p.edit_path } : {}),
    result: r.result ?? null,
    error: r.error ?? null,
    expires_at: r.expires_at,
  };
}

/** Store a proposal returned by a tool (one per tool call: a retried step never doubles it). */
export async function storeProposal(ctx: Ctx, c: { threadId: string; messageId: string; callId: string; tool: string; proposal: AiProposalInput }): Promise<AiProposal> {
  const p = c.proposal;
  const id = uuidv7();
  // the step's message id is part of the key: providers that omit tool-call ids get made-up ones
  // (call_0_…) that repeat in later turns of the same conversation
  const key = createHash("sha256").update(`${ctx.org.id}:${c.threadId}:${c.messageId}:${c.callId}`).digest("hex");
  const preview = { title_fa: p.title_fa, summary_fa: p.summary_fa, preview: p.preview, lines: p.lines, line_headers: p.line_headers, warnings: p.warnings, edit_path: p.edit_path };
  const row = await ctx.write(
    async (tx) => {
      await tx.query(
        `insert into sm_ai_actions (id, org_id, thread_id, message_id, user_id, kind, tool, area, level, payload, payload_hash, preview, idempotency_key, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, now() + interval '24 hours')
         on conflict (idempotency_key) do nothing`,
        [id, ctx.org.id, c.threadId, c.messageId, ctx.user.id, p.kind, c.tool, p.area, p.level, JSON.stringify(p.payload ?? null), hashPayload(p.payload), JSON.stringify(preview), key],
      );
      return tx.one<ActionRow>(`select ${COLS} from sm_ai_actions where idempotency_key = $1`, [key]);
    },
    { internal: true },
  );
  return toProposal(row!);
}

/** What a skill hands over to be stored as a proposal on a record (see ./skills/proposals.ts). */
export interface RecordProposalInput extends AiProposalInput {
  record: { table: string; id: string };
  /** fields the proposal reads or changes: only people who see all of them see the proposal */
  fields: string[];
  run_id: string | null;
  principal: "person" | "service";
  /** hours until it expires (default 24; proposals of triggered skills wait longer) */
  ttl_hours?: number;
}

/** Store a skill's proposal on a record (one per run and kind: a retried job never doubles it). */
export async function storeRecordProposal(ctx: Ctx, p: RecordProposalInput): Promise<AiProposal> {
  const id = uuidv7();
  const key = createHash("sha256").update(`${ctx.org.id}:skill:${p.run_id ?? id}:${p.kind}`).digest("hex");
  const preview = { title_fa: p.title_fa, summary_fa: p.summary_fa, preview: p.preview, lines: p.lines, line_headers: p.line_headers, warnings: p.warnings, edit_path: p.edit_path };
  const hours = Math.max(1, Math.min(24 * 30, Math.round(p.ttl_hours ?? 24)));
  const row = await ctx.write(
    async (tx) => {
      await tx.query(
        `insert into sm_ai_actions (id, org_id, thread_id, message_id, user_id, kind, tool, area, level, payload, payload_hash, preview, idempotency_key, expires_at,
                                    record_table, record_id, fields, skill_run_id, principal)
         values ($1, $2, null, null, $3, $4, 'skill', $5, $6, $7::jsonb, $8, $9::jsonb, $10, now() + ($11 || ' hours')::interval, $12, $13, $14::text[], $15, $16)
         on conflict (idempotency_key) do nothing`,
        [
          id, ctx.org.id, ctx.user.id, p.kind, p.area, p.level, JSON.stringify(p.payload ?? null), hashPayload(p.payload), JSON.stringify(preview), key, String(hours),
          p.record.table, p.record.id, pgArray([...new Set(p.fields)]), p.run_id, p.principal,
        ],
      );
      return tx.one<ActionRow>(`select ${COLS} from sm_ai_actions where idempotency_key = $1`, [key]);
    },
    { internal: true },
  );
  return toProposal(row!);
}

/** May the caller read the record of a skill's proposal and every field it involves (their own access, now)? */
async function seesRecord(ctx: Ctx, r: Pick<ActionRow, "record_table" | "record_id" | "fields">): Promise<boolean> {
  if (!r.record_table || !r.record_id) return false;
  const def = tableDef(r.record_table);
  if (!def || def.virtual) return false;
  try {
    if (!(await readableIds(ctx, r.record_table, [r.record_id])).has(r.record_id.toLowerCase())) return false;
  } catch {
    return false;
  }
  // tokens: a field of the record, `@g:<group>` a field group the run read, `@r:<table>:<id>` a source it used
  const visible = access().visibleFields(ctx, def);
  const sources = new Map<string, string[]>();
  for (const f of r.fields ?? []) {
    if (f.startsWith("@g:")) {
      if (!access().hasFieldGroup(ctx, f.slice(3) as FieldGroup)) return false;
    } else if (f.startsWith("@r:")) {
      const [, t, sid] = f.split(":");
      if (t && sid) sources.set(t, [...(sources.get(t) ?? []), sid]);
    } else if (visible && !visible.has(f)) return false;
  }
  for (const [t, ids] of sources) {
    const ok = await readableIds(ctx, t, ids).catch(() => new Set<string>());
    if (ids.some((x) => !ok.has(x.toLowerCase()))) return false;
  }
  return true;
}

/** Open proposals of skills on one record that the caller may see (the record's «هوش مصنوعی» panel). */
export async function recordProposals(ctx: Ctx, table: string, id: string): Promise<AiProposal[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const rows = await ctx.db.query<ActionRow>(
    `select ${COLS} from sm_ai_actions where org_id = $1 and record_table = $2 and record_id = $3 and status = 'proposed' and expires_at > now() order by created_at desc limit 30`,
    [ctx.org.id, table, id.toLowerCase()],
  );
  const out: AiProposal[] = [];
  for (const r of rows) if (await canSee(ctx, r)) out.push(toProposal(r));
  return out;
}

export async function proposalViews(ctx: Ctx, ids: string[]): Promise<AiProposal[]> {
  if (!ids.length) return [];
  const rows = await ctx.db.query<ActionRow>(`select ${COLS} from sm_ai_actions where org_id = $1 and id = any($2::uuid[])`, [ctx.org.id, pgArray(ids)]);
  return rows.map(toProposal);
}

async function actionRow(ctx: Ctx, id: string): Promise<ActionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("پیشنهاد پیدا نشد");
  const r = await ctx.db.one<ActionRow>(`select ${COLS} from sm_ai_actions where org_id = $1 and id = $2`, [ctx.org.id, id]);
  if (!r) throw notFound("پیشنهاد پیدا نشد");
  return r;
}

/**
 * Who sees a proposal. A skill's proposal on a record: whoever may read that record and every field it involves, now —
 * its author included, and an AI manager without that access does not. The assistant's: its author or an AI manager.
 */
async function canSee(ctx: Ctx, r: ActionRow): Promise<boolean> {
  if (r.record_table && r.record_id) return seesRecord(ctx, r);
  return r.user_id === ctx.user.id || ctx.can("ai", "full");
}

/**
 * May the caller decide about this proposal: the assistant's — its author or an AI manager, with the document's own
 * level; a skill's — whoever sees it and may use AI (the write is applied with that person's own access, checked again).
 */
async function canDecide(ctx: Ctx, r: ActionRow): Promise<boolean> {
  if (r.record_table && r.record_id) return ctx.can("ai", "view") && ctx.can(r.area, r.level) && (await seesRecord(ctx, r));
  return (r.user_id === ctx.user.id || ctx.can("ai", "full")) && ctx.can(r.area, r.level);
}

async function assertVisible(ctx: Ctx, r: ActionRow): Promise<void> {
  if (!(await canSee(ctx, r))) throw notFound("پیشنهاد پیدا نشد");
}

const STATUS_FA: Record<AiProposalStatus, string> = {
  proposed: "در انتظار تأیید",
  executing: "در حال اجرا",
  executed: "انجام شده",
  rejected: "رد شده",
  expired: "منقضی شده",
  failed: "ناموفق",
};

export async function confirmAction(ctx: Ctx, id: string): Promise<AiProposal> {
  ctx.need("ai", "view");
  let r = await actionRow(ctx, id);
  await assertVisible(ctx, r);
  if (!(await canDecide(ctx, r))) throw forbidden(r.record_table ? "برای اعمال این پیشنهاد باید رکورد و همهٔ فیلدهای آن را ببینید" : "برای تأیید این پیشنهاد، دسترسی همان بخش را لازم دارید");
  const status = effectiveStatus(r);
  if (status === "executed") return toProposal(r);
  if (status === "expired") {
    await ctx.write((tx) => tx.query(`update sm_ai_actions set status = 'expired', updated_at = now() where id = $1 and status = 'proposed'`, [id]), { internal: true });
    throw conflict("این پیشنهاد منقضی شده است؛ از دستیار بخواهید دوباره آماده‌اش کند");
  }
  if (status !== "proposed") throw conflict(`این پیشنهاد ${STATUS_FA[status]} است`);
  const claimed = await ctx.write(
    (tx) =>
      tx.one(
        `update sm_ai_actions set status = 'executing', confirmed_by = $2, confirmed_at = now(), updated_at = now() where id = $1 and status = 'proposed' and expires_at > now() returning id`,
        [id, ctx.user.id],
      ),
    { internal: true },
  );
  if (!claimed) {
    r = await actionRow(ctx, id);
    if (r.status === "executed") return toProposal(r);
    throw conflict(`این پیشنهاد ${STATUS_FA[effectiveStatus(r)]} است`);
  }
  if (hashPayload(r.payload) !== r.payload_hash) {
    await ctx.write((tx) => tx.query(`update sm_ai_actions set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, "داده‌های پیشنهاد دست خورده است"]), { internal: true });
    throw conflict("داده‌های پیشنهاد دست خورده است و اجرا نشد");
  }
  let ref: AiRef;
  try {
    ref = await executeProposal(ctx, r.kind, r.payload);
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "اجرای پیشنهاد ناموفق بود";
    if (!(e instanceof AppError)) ctx.cfg.log.error("ai proposal failed", String((e as Error)?.message ?? e));
    await ctx.write((tx) => tx.query(`update sm_ai_actions set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, msg.slice(0, 500)]), { internal: true });
    return toProposal(await actionRow(ctx, id));
  }
  await ctx.write(async (tx) => {
    await tx.query(`update sm_ai_actions set status = 'executed', result = $2::jsonb, error = null, updated_at = now() where id = $1`, [id, JSON.stringify(ref)]);
    await audit(tx, ctx, "ai_action", r.kind, /^[0-9a-f-]{36}$/i.test(ref.id) ? ref.id : null, `${r.preview.title_fa} (پیشنهاد دستیار، تأیید شد)`, {
      source: "ai",
      proposal_id: id,
      thread_id: r.thread_id,
      proposed_by: r.user_id,
      result: ref,
    });
  }, { internal: true });
  return toProposal(await actionRow(ctx, id));
}

export async function rejectAction(ctx: Ctx, id: string, reason?: string): Promise<AiProposal> {
  ctx.need("ai", "view");
  const r = await actionRow(ctx, id);
  await assertVisible(ctx, r);
  if (r.user_id !== ctx.user.id && !(await canDecide(ctx, r))) throw forbidden();
  const status = effectiveStatus(r);
  if (status !== "proposed") throw conflict(`این پیشنهاد ${STATUS_FA[status]} است`);
  await ctx.write(
    (tx) => tx.query(`update sm_ai_actions set status = 'rejected', confirmed_by = $2, confirmed_at = now(), error = $3, updated_at = now() where id = $1 and status = 'proposed'`, [id, ctx.user.id, reason?.trim().slice(0, 300) || null]),
    { internal: true },
  );
  return toProposal(await actionRow(ctx, id));
}

export async function listActions(ctx: Ctx, opts: { status?: AiProposalStatus; mine?: boolean; limit?: number }): Promise<AiActionView[]> {
  const params: unknown[] = [ctx.org.id];
  let where = `a.org_id = $1`;
  if (opts.mine || !ctx.can("ai", "full")) {
    params.push(ctx.user.id);
    where += ` and a.user_id = $${params.length}`;
  }
  if (opts.status === "expired") where += ` and (a.status = 'expired' or (a.status = 'proposed' and a.expires_at <= now()))`;
  else if (opts.status === "proposed") where += ` and a.status = 'proposed' and a.expires_at > now()`;
  else if (opts.status) {
    params.push(opts.status);
    where += ` and a.status = $${params.length}`;
  }
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const rows = await ctx.db.query<ActionRow & { user_name: string | null; confirmer_name: string | null }>(
    `select ${COLS.split(", ").map((c) => `a.${c}`).join(", ")}, u.full_name as user_name, cu.full_name as confirmer_name
     from sm_ai_actions a left join sm_users u on u.id = a.user_id left join sm_users cu on cu.id = a.confirmed_by
     where ${where} order by a.created_at desc limit $${params.length}`,
    params,
  );
  // a skill's proposals on records: only those whose record and fields the caller sees now (an AI manager too)
  const seen: typeof rows = [];
  for (const r of rows) if (!r.record_id || (await canSee(ctx, r))) seen.push(r);
  const decide = new Map<string, boolean>();
  for (const r of seen) decide.set(r.id, effectiveStatus(r) === "proposed" && (await canDecide(ctx, r)));
  return seen.map((r) => ({
    ...toProposal(r),
    thread_id: r.user_id === ctx.user.id ? r.thread_id : null,
    area: r.area,
    level: r.level,
    user: { id: r.user_id, name: r.user_name },
    confirmed_by: r.confirmed_by ? { id: r.confirmed_by, name: r.confirmer_name } : null,
    confirmed_at: r.confirmed_at,
    created_at: r.created_at,
    can_decide: decide.get(r.id) ?? false,
  }));
}

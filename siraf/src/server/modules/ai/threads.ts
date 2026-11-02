// Conversations: private to their author. Messages are append-only — one row per question and one
// per finished step of an answer (the provider's native content kept for replay) — and are turned
// back into the neutral history for the next model call and into AiMessageView for the UI.
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import type { AiChartSpec, AiErrorKind, AiMessageView, AiPageContext, AiProposal, AiRef, AiThreadSummary } from "@shared/ai/types";
import type { AiDataView, AiThreadDetail } from "@shared/ai/api";
import { uuidv7 } from "@shared/id";
import { likeContains } from "../../db";
import { conflict, notFound } from "../../http/errors";
import type { NativeContent, NeutralMessage, Part, ToolCall } from "./types";
import { proposalViews } from "./actions";

export interface ThreadRow {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  context: AiPageContext | null;
  pinned: boolean;
  archived_at: string | null;
  run_id: string | null;
  run_until: string | null;
  stop_requested_at: string | null;
  created_at: string;
  updated_at: string;
}

/** UI parts of one step of an answer. */
export interface StepUi {
  tools: { call_id: string; tool: string; title_fa: string; ok: boolean; summary_fa?: string }[];
  refs: AiRef[];
  proposals: string[];
  charts: { data_ref: string; spec: AiChartSpec }[];
  tables: { data_ref: string; title?: string; columns: { key: string; title: string; numeric?: boolean }[]; total_rows: number }[];
  error?: { kind: AiErrorKind; message_fa: string } | null;
}

export interface StepParts {
  calls: ToolCall[];
  results: { id: string; name: string; content: string; is_error?: boolean }[];
  /** extra text sent with the tool results (e.g. «answer now: the step limit is reached») */
  note?: string;
  /** the answer ended with this step */
  final: boolean;
  ui: StepUi;
}

export type StepStatus = "done" | "stopped" | "error" | "refusal" | "max_steps";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  kind: "message" | "step";
  reply_to: string | null;
  text: string;
  parts: Record<string, unknown> | null;
  native: unknown;
  model: string | null;
  connection_id: string | null;
  usage: unknown;
  rating: number | null;
  status: string;
  created_at: string;
}

export function emptyUi(): StepUi {
  return { tools: [], refs: [], proposals: [], charts: [], tables: [] };
}

const THREAD_COLS = `id, org_id, user_id, title, context, pinned, archived_at, run_id, run_until, stop_requested_at, created_at, updated_at`;

/** The caller's own thread (anyone else's is "not found"). */
export async function ownThread(ctx: Ctx, id: string): Promise<ThreadRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("گفتگو پیدا نشد");
  const t = await ctx.db.one<ThreadRow>(`select ${THREAD_COLS} from tz_ai_threads where id = $1 and org_id = $2 and user_id = $3`, [id, ctx.org.id, ctx.user.id]);
  if (!t) throw notFound("گفتگو پیدا نشد");
  return t;
}

export function threadTitle(text: string): string {
  const t = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  return (t.length > 60 ? `${t.slice(0, 58)}…` : t) || "گفتگوی تازه";
}

export async function createThread(ctx: Ctx, title: string, context: AiPageContext | null): Promise<ThreadRow> {
  const id = uuidv7();
  await ctx.write(
    (tx) => tx.query(`insert into tz_ai_threads (id, org_id, user_id, title, context) values ($1, $2, $3, $4, $5::jsonb)`, [id, ctx.org.id, ctx.user.id, title.slice(0, 200), context ? JSON.stringify(context) : null]),
    { internal: true },
  );
  return ownThread(ctx, id);
}

function running(t: ThreadRow): boolean {
  return !!t.run_id && !!t.run_until && Date.parse(t.run_until) > Date.now();
}

export function threadSummary(t: ThreadRow): AiThreadSummary {
  return { id: t.id, title: t.title, updated_at: t.updated_at, pinned: t.pinned };
}

export function threadDetail(t: ThreadRow): AiThreadDetail {
  return { ...threadSummary(t), context: t.context, archived: !!t.archived_at, running: running(t), created_at: t.created_at };
}

export async function listThreads(ctx: Ctx, opts: { q?: string; archived?: boolean; limit?: number }): Promise<AiThreadSummary[]> {
  const params: unknown[] = [ctx.org.id, ctx.user.id];
  let where = `org_id = $1 and user_id = $2 and archived_at is ${opts.archived ? "not null" : "null"}`;
  if (opts.q?.trim()) {
    params.push(likeContains(opts.q.trim()));
    where += ` and (title ilike $${params.length} or exists (select 1 from tz_ai_messages m where m.thread_id = tz_ai_threads.id and m.role = 'user' and m.text ilike $${params.length}))`;
  }
  params.push(Math.min(opts.limit ?? 100, 300));
  const rows = await ctx.db.query<ThreadRow>(`select ${THREAD_COLS} from tz_ai_threads where ${where} order by pinned desc, updated_at desc limit $${params.length}`, params);
  return rows.map(threadSummary);
}

export async function patchThread(ctx: Ctx, id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }): Promise<AiThreadDetail> {
  await ownThread(ctx, id);
  await ctx.write(
    (tx) =>
      tx.query(
        `update tz_ai_threads set title = coalesce($2, title), pinned = coalesce($3, pinned),
           archived_at = case when $4::boolean is null then archived_at when $4::boolean then coalesce(archived_at, now()) else null end
         where id = $1`,
        [id, patch.title?.trim() ? patch.title.trim().slice(0, 200) : null, patch.pinned ?? null, patch.archived ?? null],
      ),
    { internal: true },
  );
  return threadDetail(await ownThread(ctx, id));
}

export async function deleteThread(ctx: Ctx, id: string): Promise<void> {
  const t = await ownThread(ctx, id);
  if (running(t)) throw conflict("پاسخی در این گفتگو در حال آماده شدن است؛ پس از پایان آن دوباره امتحان کنید");
  await ctx.write((tx) => tx.query(`delete from tz_ai_threads where id = $1`, [id]), { internal: true });
}

/** Conversations older than the retention period are removed (with their messages and data). */
/** Read documents (ID cards, cheques: national ids, birth dates, IBANs) live no longer than the retention, and never over 30 days (their cache window). */
const CAPTURE_PURGE_SQL = `delete from tz_ai_captures where org_id = $1 and created_at < now() - (least(greatest($2::int, 1), 30) * interval '1 day')`;

export async function purgeCaptures(ctx: Ctx, days: number): Promise<void> {
  await ctx.write((tx) => tx.query(CAPTURE_PURGE_SQL, [ctx.org.id, days]), { internal: true }).catch(() => undefined);
}

export async function purgeOld(ctx: Ctx, days: number): Promise<void> {
  await ctx
    .write(
      async (tx) => {
        await tx.query(`delete from tz_ai_threads where org_id = $1 and pinned = false and updated_at < now() - ($2::int * interval '1 day') and (run_until is null or run_until < now())`, [ctx.org.id, days]);
        await tx.query(`delete from tz_ai_data_refs where org_id = $1 and expires_at < now()`, [ctx.org.id]);
        await tx.query(CAPTURE_PURGE_SQL, [ctx.org.id, days]);
      },
      { internal: true },
    )
    .catch(() => undefined);
}

// ---------------------------------------------------------------- run lease and stop

/** Take the thread for one request; false when another answer is being prepared. */
export async function acquireRun(ctx: Ctx, threadId: string, runId: string, leaseMs: number): Promise<boolean> {
  const r = await ctx.write(
    (tx) =>
      tx.one(
        `update tz_ai_threads set run_id = $2, run_until = now() + ($3::int * interval '1 millisecond'), stop_requested_at = null, updated_at = now()
         where id = $1 and (run_id is null or run_until is null or run_until < now()) returning id`,
        [threadId, runId, leaseMs],
      ),
    { internal: true },
  );
  return !!r;
}

/** Keep the lease while a long answer (Windows app: no time budget) is still working. */
export async function renewRun(ctx: Ctx, threadId: string, runId: string, leaseMs: number): Promise<void> {
  await ctx
    .write((tx) => tx.query(`update tz_ai_threads set run_until = now() + ($3::int * interval '1 millisecond') where id = $1 and run_id = $2`, [threadId, runId, leaseMs]), { internal: true })
    .catch(() => undefined);
}

export async function releaseRun(ctx: Ctx, threadId: string, runId: string): Promise<void> {
  await ctx
    .write((tx) => tx.query(`update tz_ai_threads set run_id = null, run_until = null, updated_at = now() where id = $1 and run_id = $2`, [threadId, runId]), { internal: true })
    .catch(() => undefined);
}

export async function stopRequested(ctx: Ctx, threadId: string, runId: string): Promise<boolean> {
  const r = await ctx.db.one<{ stop: boolean }>(`select (stop_requested_at is not null) as stop from tz_ai_threads where id = $1 and run_id = $2`, [threadId, runId]);
  return r ? r.stop : true;
}

export async function requestStop(ctx: Ctx, threadId: string): Promise<boolean> {
  const t = await ownThread(ctx, threadId);
  if (!running(t)) return false;
  await ctx.write((tx) => tx.query(`update tz_ai_threads set stop_requested_at = now() where id = $1 and run_id is not null`, [threadId]), { internal: true });
  return true;
}

// ---------------------------------------------------------------- messages

export async function insertUserMessage(ctx: Ctx, threadId: string, text: string, modelParts: Part[], meta: { attachments: { name: string; mime: string }[]; context: AiPageContext | null }): Promise<string> {
  const id = uuidv7();
  await ctx.write(
    async (tx) => {
      await tx.query(
        `insert into tz_ai_messages (id, thread_id, org_id, user_id, role, kind, text, parts, native, status) values ($1, $2, $3, $4, 'user', 'message', $5, $6::jsonb, $7::jsonb, 'done')`,
        [id, threadId, ctx.org.id, ctx.user.id, text, JSON.stringify(meta), JSON.stringify({ parts: modelParts })],
      );
      await tx.query(`update tz_ai_threads set updated_at = now() where id = $1`, [threadId]);
    },
    { internal: true },
  );
  return id;
}

export interface StepInput {
  id: string;
  threadId: string;
  replyTo: string;
  text: string;
  parts: StepParts;
  native: NativeContent | null;
  model: string | null;
  connectionId: string | null;
  usage: unknown;
  status: StepStatus;
}

export async function insertStep(ctx: Ctx, s: StepInput, extra?: (tx: Tx) => Promise<void>): Promise<void> {
  await ctx.write(
    async (tx) => {
      await tx.query(
        `insert into tz_ai_messages (id, thread_id, org_id, user_id, role, kind, reply_to, text, parts, native, model, connection_id, usage, status)
         values ($1, $2, $3, $4, 'assistant', 'step', $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb, $12)`,
        [s.id, s.threadId, ctx.org.id, ctx.user.id, s.replyTo, s.text, JSON.stringify(s.parts), s.native ? JSON.stringify(s.native) : null, s.model, s.connectionId, s.usage ? JSON.stringify(s.usage) : null, s.status],
      );
      await tx.query(`update tz_ai_threads set updated_at = now() where id = $1`, [s.threadId]);
      if (extra) await extra(tx);
    },
    { internal: true },
  );
}

async function messageRows(ctx: Ctx, threadId: string): Promise<MessageRow[]> {
  return ctx.db.query<MessageRow>(
    `select id, role, kind, reply_to, text, parts, native, model, connection_id, usage, rating, status, created_at from tz_ai_messages where thread_id = $1 order by seq`,
    [threadId],
  );
}

function stepParts(row: MessageRow): StepParts {
  const p = (row.parts ?? {}) as Partial<StepParts>;
  return { calls: p.calls ?? [], results: p.results ?? [], note: p.note, final: p.final ?? true, ui: { ...emptyUi(), ...(p.ui ?? {}) } };
}

/** Merge consecutive user turns (an unanswered question, results of an abandoned answer). */
function pushMessage(out: NeutralMessage[], m: NeutralMessage) {
  const last = out[out.length - 1];
  if (last && last.role === "user" && m.role === "user") {
    const results = [...last.parts, ...m.parts].filter((p) => p.type === "tool_result");
    const rest = [...last.parts, ...m.parts].filter((p) => p.type !== "tool_result");
    last.parts = [...results, ...rest];
    return;
  }
  out.push(m);
}

export interface HistoryState {
  messages: NeutralMessage[];
  /** the last answer stopped after tool results (step budget): it can be continued */
  pending: { replyTo: string; answerId: string; steps: number } | null;
}

/** The neutral history the next model call sees. */
export async function history(ctx: Ctx, threadId: string): Promise<HistoryState> {
  const rows = await messageRows(ctx, threadId);
  const out: NeutralMessage[] = [];
  const firstStep = new Map<string, string>();
  const stepCount = new Map<string, number>();
  let last: MessageRow | null = null;
  // questions whose files went to the model but are replayed as placeholders (the bytes are not kept)
  const filesGone = new Set<string>();
  for (const row of rows) {
    last = row;
    if (row.role === "user") {
      const parts = ((row.native as { parts?: Part[] } | null)?.parts ?? [{ type: "text", text: row.text }]) as Part[];
      const meta = (row.parts ?? {}) as { attachments?: unknown[] };
      if (meta.attachments?.length && !parts.some((p) => p.type === "file")) filesGone.add(row.id);
      pushMessage(out, { role: "user", parts });
      continue;
    }
    if (row.reply_to) {
      if (!firstStep.has(row.reply_to)) firstStep.set(row.reply_to, row.id);
      stepCount.set(row.reply_to, (stepCount.get(row.reply_to) ?? 0) + 1);
    }
    const sp = stepParts(row);
    const answered = new Set(sp.results.map((r) => r.id));
    const calls = sp.calls.filter((c) => answered.has(c.id));
    const parts: Part[] = [];
    if (row.text) parts.push({ type: "text", text: row.text });
    for (const c of calls) parts.push({ type: "tool_call", id: c.id, name: c.name, input: c.input });
    if (!parts.length) continue;
    // native content only when it matches exactly what is replayed (all calls answered), and never
    // for an answer to a question whose files are replayed as placeholders: its reasoning (Claude's
    // thinking signatures) is bound to the conversation with the files, so replaying it after the
    // edit would be refused; the answer is replayed as plain text and tool calls, the same way in
    // every later request (append-only from then on)
    const native = calls.length === sp.calls.length && !(row.reply_to && filesGone.has(row.reply_to)) ? ((row.native as NativeContent | null) ?? null) : null;
    out.push({ role: "assistant", parts, native });
    if (sp.results.length) {
      const rp: Part[] = sp.results.map((r) => ({ type: "tool_result", id: r.id, name: r.name, content: r.content, ...(r.is_error ? { is_error: true } : {}) }));
      if (sp.note) rp.push({ type: "text", text: sp.note });
      pushMessage(out, { role: "user", parts: rp });
    }
  }
  let pending: HistoryState["pending"] = null;
  if (last && last.role === "assistant" && last.status === "done" && last.reply_to) {
    const sp = stepParts(last);
    if (!sp.final && sp.results.length) pending = { replyTo: last.reply_to, answerId: firstStep.get(last.reply_to) ?? last.id, steps: stepCount.get(last.reply_to) ?? 1 };
  }
  return { messages: out, pending };
}

/** Messages as the UI shows them: each answer's steps joined into one assistant message. */
export async function messageViews(ctx: Ctx, thread: ThreadRow): Promise<AiMessageView[]> {
  const rows = await messageRows(ctx, thread.id);
  const proposalIds = rows.flatMap((r) => (r.role === "assistant" ? stepParts(r).ui.proposals : []));
  const proposals = new Map<string, AiProposal>((await proposalViews(ctx, proposalIds)).map((p) => [p.id, p]));
  const out: AiMessageView[] = [];
  const answers = new Map<string, AiMessageView>();
  const isRunning = running(thread);
  for (const row of rows) {
    if (row.role === "user") {
      const meta = (row.parts ?? {}) as { attachments?: { name: string; mime: string }[] };
      out.push({ id: row.id, role: "user", text: row.text, created_at: row.created_at, attachments: meta.attachments?.length ? meta.attachments : undefined });
      continue;
    }
    const sp = stepParts(row);
    const key = row.reply_to ?? row.id;
    let a = answers.get(key);
    if (!a) {
      a = { id: row.id, role: "assistant", text: "", created_at: row.created_at, tools: [], refs: [], proposals: [], charts: [], tables: [], rating: (row.rating as 1 | -1 | null) ?? null, model: row.model, status: "done", error: null };
      answers.set(key, a);
      out.push(a);
    }
    if (row.text) a.text = a.text ? `${a.text}\n\n${row.text}` : row.text;
    a.tools!.push(...sp.ui.tools);
    for (const r of sp.ui.refs) if (!a.refs!.some((x) => x.type === r.type && x.id === r.id)) a.refs!.push(r);
    for (const id of sp.ui.proposals) {
      const p = proposals.get(id);
      if (p) a.proposals!.push(p);
    }
    a.charts!.push(...sp.ui.charts);
    a.tables!.push(...sp.ui.tables);
    if (row.model) a.model = row.model;
    a.status = row.status === "done" ? (sp.final ? "done" : "pending") : (row.status as AiMessageView["status"]);
    a.error = sp.ui.error ?? null;
    a.can_continue = a.status === "pending" && !isRunning;
  }
  const lastAnswer = out[out.length - 1];
  if (isRunning && lastAnswer?.role === "assistant" && lastAnswer.status === "pending") lastAnswer.status = "running";
  return out;
}

export async function rateMessage(ctx: Ctx, id: string, rating: 1 | -1 | null): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("پیام پیدا نشد");
  const row = await ctx.db.one<{ id: string }>(
    `select m.id from tz_ai_messages m join tz_ai_threads t on t.id = m.thread_id where m.id = $1 and m.role = 'assistant' and t.org_id = $2 and t.user_id = $3`,
    [id, ctx.org.id, ctx.user.id],
  );
  if (!row) throw notFound("پیام پیدا نشد");
  await ctx.write((tx) => tx.query(`update tz_ai_messages set rating = $2 where id = $1`, [id, rating]), { internal: true });
}

// ---------------------------------------------------------------- tool-call log and data refs

export async function logToolCall(tx: Tx, ctx: Ctx, c: { id: string; threadId: string; messageId: string; tool: string; input: unknown; ok: boolean; summary: string | null; ms: number }): Promise<void> {
  await tx.query(
    `insert into tz_ai_tool_calls (id, thread_id, message_id, org_id, user_id, tool, input, ok, summary, ms) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
    [c.id, c.threadId, c.messageId, ctx.org.id, ctx.user.id, c.tool, JSON.stringify(c.input ?? null), c.ok, c.summary?.slice(0, 300) ?? null, Math.round(c.ms)],
  );
}

export const DATA_ROWS_MAX = 2000;

export async function putData(ctx: Ctx, threadId: string | null, rows: Record<string, unknown>[], meta: Record<string, unknown> | undefined, retentionDays: number): Promise<string> {
  const id = uuidv7();
  const kept = rows.slice(0, DATA_ROWS_MAX);
  await ctx.write(
    (tx) =>
      tx.query(
        `insert into tz_ai_data_refs (id, org_id, user_id, thread_id, rows, meta, expires_at) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now() + ($7::int * interval '1 day'))`,
        [id, ctx.org.id, ctx.user.id, threadId, JSON.stringify(kept), JSON.stringify({ ...(meta ?? {}), total_rows: rows.length, truncated: rows.length > kept.length }), retentionDays],
      ),
    { internal: true },
  );
  return id;
}

export async function getData(ctx: Ctx, ref: string): Promise<AiDataView> {
  if (!/^[0-9a-f-]{36}$/i.test(ref)) throw notFound("داده پیدا نشد");
  const r = await ctx.db.one<{ id: string; rows: Record<string, unknown>[]; meta: Record<string, unknown> | null }>(
    `select id, rows, meta from tz_ai_data_refs where id = $1 and org_id = $2 and user_id = $3 and expires_at > now()`,
    [ref, ctx.org.id, ctx.user.id],
  );
  if (!r) throw notFound("داده پیدا نشد");
  const meta = r.meta ?? {};
  return { id: r.id, rows: r.rows ?? [], meta: meta as AiDataView["meta"], total_rows: Number(meta.total_rows ?? r.rows?.length ?? 0), truncated: meta.truncated === true };
}

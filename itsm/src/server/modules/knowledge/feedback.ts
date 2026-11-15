// Feedback and quality signals from readers (KB-044, KB-045, KB-052, KB-054): «مفید بود؟» (one vote per member and
// article, changeable), a 1–5 rating, flags with a reason — collected into one open knowledge task per article for its
// owner group, so a run of reports does not become a run of tasks — knowledge gaps reported from a record or a
// search, and «مشکلم حل شد» deflections. Readers (requesters too) need no write grant in knowledge: the module writes
// as the system on their behalf after checking that they may read the article.
import { queryTerms, searchForm, stem } from "@shared/ai/text";
import type { Ctx } from "../../context";
import { lockKey, type Queryable, type Tx } from "../../db";
import { addJournalIn, createIn, defFor, get, updateIn } from "../../engine";
import { bad, forbidden } from "../../http/errors";
import { baseOf, isUuid, kbConfig, liveRow, liveRows, sysOf, type Row } from "./common";
import { logEvent } from "./events";

const asMember = (ctx: Ctx) => (ctx.actor === "system" ? ctx : sysOf(ctx, ctx.user.id));

/** The article as the caller may read it (404 otherwise) and its base. */
async function readableArticle(ctx: Ctx, id: string) {
  if (!isUuid(id)) throw bad("شناسه معتبر نیست");
  const a = (await get(ctx, "kb_article", id)).row as Row;
  const base = await baseOf(ctx.db, ctx, a.base_id);
  return { a, base };
}

async function mine(q: Queryable, ctx: Ctx, articleId: string, kinds: string[]): Promise<Row | null> {
  const [r] = await liveRows(q, sysOf(ctx), "kb_feedback", { and: [{ f: "article_id", op: "eq", v: articleId }, { f: "user_id", op: "eq", v: ctx.user.id }, { f: "kind", op: "in", v: kinds }] }, { order: "t.created_at desc", limit: 1 });
  return r ?? null;
}

/**
 * One vote and one rating per member and article: the member's earlier one is looked for inside the write, under the
 * member's key on the article — a double click or two tabs submitting at once change one row instead of adding two.
 */
async function ownFeedbackIn(tx: Tx, ctx: Ctx, articleId: string, kinds: string[]): Promise<Row | null> {
  if (ctx.actor === "system") return null;
  await lockKey(tx, `kb.feedback:${articleId}:${ctx.user.id}`);
  return mine(tx, ctx, articleId, kinds);
}

export async function vote(ctx: Ctx, articleId: string, input: { helpful: boolean; reason?: string | null; comment?: string | null; session_id?: string | null; channel?: string | null }) {
  const { a, base } = await readableArticle(ctx, articleId);
  if (base && base.allow_ratings === false) throw forbidden("رأی دادن در این پایگاه خاموش است");
  if (base && base.allow_comments === false && String(input.comment ?? "").trim()) throw forbidden("نظر خوانندگان در این پایگاه بسته است");
  const kind = input.helpful ? "helpful" : "not_helpful";
  const sys = asMember(ctx);
  const data = { kind, reason: input.helpful ? null : input.reason ?? null, comment: input.comment ? String(input.comment).slice(0, 4000) : null, channel: input.channel ?? "portal", version_label: a.version_label ?? null };
  await sys.write(async (tx) => {
    const prev = await ownFeedbackIn(tx, ctx, articleId, ["helpful", "not_helpful"]);
    return prev ? updateIn(tx, sys, "kb_feedback", prev.id, data, { trusted: true }) : createIn(tx, sys, "kb_feedback", { ...data, article_id: articleId, user_id: ctx.user.id }, { trusted: true });
  });
  await logEvent(ctx.db, ctx, { kind: "vote", article_id: articleId, value: input.helpful ? 1 : -1, session_id: input.session_id ?? null, channel: input.channel ?? "portal" });
  const fresh = await liveRow(ctx.db, sysOf(ctx), "kb_article", articleId);
  return { vote: kind, helpful_yes: Number(fresh?.helpful_yes ?? 0), helpful_no: Number(fresh?.helpful_no ?? 0) };
}

export async function rate(ctx: Ctx, articleId: string, rating: number) {
  const { a, base } = await readableArticle(ctx, articleId);
  if (base && base.allow_ratings === false) throw forbidden("امتیاز دادن در این پایگاه خاموش است");
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) throw bad("امتیازی از ۱ تا ۵ بدهید");
  const sys = asMember(ctx);
  await sys.write(async (tx) => {
    const prev = await ownFeedbackIn(tx, ctx, articleId, ["rating"]);
    return prev ? updateIn(tx, sys, "kb_feedback", prev.id, { rating: r }, { trusted: true }) : createIn(tx, sys, "kb_feedback", { article_id: articleId, user_id: ctx.user.id, kind: "rating", rating: r, version_label: a.version_label ?? null }, { trusted: true });
  });
  await logEvent(ctx.db, ctx, { kind: "rating", article_id: articleId, value: r });
  const fresh = await liveRow(ctx.db, sysOf(ctx), "kb_article", articleId);
  return { rating: r, rating_avg: fresh?.rating_avg ?? null, rating_count: Number(fresh?.rating_count ?? 0) };
}

const REASON_LABEL: Record<string, string> = { incorrect: "نادرست است", outdated: "قدیمی شده است", unclear: "روشن نیست", duplicate: "تکراری است", missing_step: "گامی جا افتاده است", broken_link: "پیوند یا تصویر خراب", other: "دلیل دیگر" };

/** Flag an article: a feedback row and the article's one open flag task (created or added to). */
export async function flagArticle(ctx: Ctx, articleId: string, input: { reason: string; comment?: string | null; channel?: string | null; record?: { table: string; id: string; number?: string | null } | null }) {
  const { a } = await readableArticle(ctx, articleId);
  if (!(input.reason in REASON_LABEL)) throw bad("دلیل گزارش را انتخاب کنید");
  const sys = asMember(ctx);
  const comment = input.comment ? String(input.comment).slice(0, 4000) : null;
  const out = await sys.write(async (tx) => {
    // the article's flag key first: reports of one article at the same moment take turns, so the second finds the
    // first one's open task (one task, its count from the stored row) instead of opening another
    await lockKey(tx, `kb.flag_task:${articleId}`);
    const [open] = await liveRows(tx, sys, "kb_task", { and: [{ f: "article_id", op: "eq", v: articleId }, { f: "kind", op: "eq", v: "flag" }, { f: "active", op: "eq", v: true }] }, { order: "t.created_at", limit: 1 });
    const line = `- ${REASON_LABEL[input.reason]}${comment ? `: ${comment}` : ""}${input.record?.number ? ` (از ${input.record.number})` : ""}`;
    let task: Row;
    if (open) {
      task = await updateIn(tx, sys, "kb_task", open.id, { feedback_count: Number(open.feedback_count ?? 0) + 1 }, { trusted: true, keepVersion: true });
      const { def } = await defFor(sys, "kb_task", tx);
      await addJournalIn(tx, sys, def, task, { kind: "work_note", body: `گزارش تازه:\n${line}` }, { trusted: true, author: ctx.actor === "system" ? null : ctx.user.id });
    } else {
      task = await createIn(tx, sys, "kb_task", {
        kind: "flag", article_id: articleId, priority: input.reason === "incorrect" ? "2" : "3", feedback_count: 1,
        short_description: `ایراد مقاله ${a.number ?? ""}: ${String(a.title).slice(0, 150)}`,
        description: `گزارش‌های خوانندگان:\n${line}`, caller_id: ctx.actor === "system" ? null : ctx.user.id,
        source_table: input.record?.table ?? null, source_id: input.record?.id ?? null, source_number: input.record?.number ?? null,
      }, { trusted: true });
    }
    const fb = await createIn(tx, sys, "kb_feedback", { article_id: articleId, user_id: ctx.user.id, kind: "flag", reason: input.reason, comment, channel: input.channel ?? "portal", state: "in_task", task_id: task.id, version_label: a.version_label ?? null }, { trusted: true });
    return { task, feedback: fb };
  });
  await logEvent(ctx.db, ctx, { kind: "flag", article_id: articleId, channel: input.channel ?? "portal", record_table: input.record?.table ?? null, record_id: input.record?.id ?? null, data: { reason: input.reason } });
  return { task_id: out.task.id, task_number: out.task.number ?? null };
}

/** A stable signature of a topic (the first stemmed terms, sorted). */
export function topicSignature(text: string): string {
  return [...new Set(queryTerms(text).map(stem))].slice(0, 6).sort().join(" ").slice(0, 300);
}

/** Report a knowledge gap (from a record, a search without results, or by hand): one gap per topic, demand counted. */
export async function reportGap(ctx: Ctx, input: { text: string; kind?: "reported" | "zero_result" | "no_article"; record?: { table: string; id: string; number?: string | null } | null; base_id?: string | null }) {
  const text = String(input.text ?? "").trim().slice(0, 250);
  if (text.length < 3) throw bad("موضوع کمبود دانش را بنویسید");
  const signature = topicSignature(text) || searchForm(text).slice(0, 300);
  const sys = asMember(ctx);
  const cfg = await kbConfig(ctx.db, sysOf(ctx));
  const now = new Date().toISOString();
  const gap = await sys.write(async (tx) => {
    // one gap per topic: reports of one topic at the same moment take turns on its key (the second adds its demand)
    await lockKey(tx, `kb.gap:${ctx.org.id}:${signature}`);
    const [g] = await liveRows(tx, sys, "kb_gap", { and: [{ f: "signature", op: "eq", v: signature }, { f: "state", op: "in", v: ["open", "in_progress"] }] }, { limit: 1 });
    const sample = input.record ? { table: input.record.table, id: input.record.id, number: input.record.number ?? null, at: now } : { text, at: now };
    if (g) {
      const samples = [sample, ...(Array.isArray(g.samples) ? g.samples : [])].slice(0, 20);
      return updateIn(tx, sys, "kb_gap", g.id, { demand: Number(g.demand ?? 0) + 1, last_seen_at: now, samples, score: Number(g.score ?? 0) + 1 }, { trusted: true, keepVersion: true });
    }
    const created = await createIn(tx, sys, "kb_gap", { title: text, kind: input.kind ?? "reported", signature, demand: 1, score: 1, last_seen_at: now, samples: [sample], base_id: input.base_id ?? null, group_id: cfg.default_group_id }, { trusted: true });
    if ((input.kind ?? "reported") === "reported") {
      await createIn(tx, sys, "kb_task", { kind: "gap", gap_id: created.id, priority: "3", short_description: `کمبود دانش: ${text.slice(0, 180)}`, description: input.record?.number ? `گزارش‌شده از ${input.record.number}` : null, caller_id: ctx.actor === "system" ? null : ctx.user.id, assignment_group_id: cfg.default_group_id, source_table: input.record?.table ?? null, source_id: input.record?.id ?? null, source_number: input.record?.number ?? null }, { trusted: true });
    }
    return created;
  });
  return { gap_id: gap.id, number: gap.number ?? null };
}

/** «مشکلم حل شد»: a deflection of a search (or an article) in a session. */
export async function deflect(ctx: Ctx, input: { article_id?: string | null; query?: string | null; session_id?: string | null; channel?: string | null }) {
  if (input.article_id) await readableArticle(ctx, input.article_id);
  await logEvent(ctx.db, ctx, { kind: "deflect", article_id: input.article_id ?? null, query: input.query ?? null, session_id: input.session_id ?? null, channel: input.channel ?? "portal" });
  return { ok: true as const };
}

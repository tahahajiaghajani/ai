// Articles and their versions (KB-003, KB-015, KB-018, KB-019): an article holds the published content; every edit is a
// version — one open draft at a time, a minor edit or a new major version. Submitting a draft either publishes it at
// once (no approval needed) or asks the base's approvers through the approvals service (rules seeded on kb_version);
// the decision publishes or returns it. Publishing swaps the published pointer, marks the previous version outdated,
// copies the content into the article, sets the review and validity dates and stamps who published it. Every function
// here runs inside the caller's transaction (or opens one) and writes through the engine.
import { versionLabel, nextVersion, isInternalArticle, templateSkeleton, cleanSections, lineDiff, diffStats, type DiffLine } from "@shared/knowledge/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, createIn, defFor, emitEvent, get, moveAttachmentsIn, transitionIn, updateIn } from "../../engine";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { addDaysISO, articleOf, attachmentRefs, baseOf, categoryOf, contributesTo, liveRow, liveRows, sysOf, todayIn, uniq, type Row } from "./common";

const CONTENT = ["title", "summary", "body", "internal_body", "keywords", "tags"] as const;
const OPEN_VERSION = ["draft", "in_review", "scheduled"];

export interface NewArticleInput {
  base_id: string;
  category_id?: string | null;
  template_id?: string | null;
  article_type?: string | null;
  title: string;
  summary?: string | null;
  body?: string | null;
  internal_body?: string | null;
  keywords?: string[];
  tags?: string[];
  language?: string | null;
  visibility?: string | null;
  kcs_confidence?: string | null;
  owner_group_id?: string | null;
  external_url?: string | null;
  translation_of?: string | null;
  known_error_id?: string | null;
  problem_id?: string | null;
  source?: { table: string; id: string; number?: string | null } | null;
  ai_provenance?: Record<string, unknown> | null;
  machine_translated?: boolean;
  change_note?: string | null;
}

/** The open draft (or review) of an article, if any. */
export async function openVersion(q: Tx, ctx: Ctx, articleId: string): Promise<Row | null> {
  const [v] = await liveRows(q, sysOf(ctx), "kb_version", { and: [{ f: "article_id", op: "eq", v: articleId }, { f: "state", op: "in", v: OPEN_VERSION }] }, { order: "t.created_at desc", limit: 1 });
  return v ?? null;
}

/** Create an article and its first draft in one transaction (the caller must contribute to the base). */
export async function createArticleIn(tx: Tx, ctx: Ctx, input: NewArticleInput): Promise<{ article: Row; version: Row }> {
  const base = await baseOf(tx, ctx, input.base_id);
  if (!base) throw notFound("پایگاه دانش پیدا نشد");
  const category = input.category_id ? await categoryOf(tx, ctx, input.category_id) : null;
  if (!contributesTo(ctx, base, { category })) throw forbidden("اجازهٔ نوشتن در این پایگاه دانش را ندارید");
  // the template asked for, else the active template of the article's type, else the base's default
  let template = input.template_id ? await liveRow(tx, sysOf(ctx), "kb_template", input.template_id) : null;
  if (!template && input.article_type) {
    const [t] = await liveRows(tx, sysOf(ctx), "kb_template", { and: [{ f: "article_type", op: "eq", v: input.article_type }, { f: "active", op: "eq", v: true }] }, { order: "t.sort_order, t.name", limit: 1 });
    template = t ?? null;
  }
  if (!template && base.default_template_id) template = await liveRow(tx, sysOf(ctx), "kb_template", base.default_template_id);
  const skeleton = template ? templateSkeleton(cleanSections(template.sections)) : { body: "", internal: "" };
  const master = input.translation_of ? await articleOf(tx, ctx, input.translation_of) : null;
  const kcs = base.kcs_enabled && !input.kcs_confidence ? "not_validated" : input.kcs_confidence ?? "validated";
  const title = String(input.title ?? "").trim().slice(0, 250);
  if (!title) throw bad("عنوان مقاله را بنویسید");
  const content = {
    title,
    summary: input.summary ?? null,
    body: input.body ?? skeleton.body ?? "",
    internal_body: input.internal_body ?? skeleton.internal ?? "",
    keywords: input.keywords ?? [],
    tags: input.tags ?? [],
  };
  const me = ctx.actor === "system" ? null : ctx.user.id;
  const article = await createIn(
    tx,
    ctx,
    "kb_article",
    {
      ...content,
      base_id: base.id,
      category_id: category?.id ?? null,
      template_id: template?.id ?? null,
      article_type: input.article_type ?? template?.article_type ?? "how_to",
      language: input.language ?? (master ? (master.language === "fa" ? "en" : "fa") : "fa"),
      visibility: input.visibility ?? "inherit",
      kcs_confidence: kcs,
      governance: input.article_type === "policy" ? "compliance" : "experience",
      owner_group_id: input.owner_group_id ?? category?.managed_by_groups?.[0] ?? base.manager_group_id ?? null,
      external_url: input.external_url ?? null,
      translation_of: master?.id ?? null,
      master_version: master ? Number(master.major ?? 0) || null : null,
      known_error_id: input.known_error_id ?? null,
      problem_id: input.problem_id ?? null,
      source_table: input.source?.table ?? null,
      source_id: input.source?.id ?? null,
      source_number: input.source?.number ?? null,
      machine_translated: !!input.machine_translated,
      ...(me ? { author_id: me, owner_id: me } : {}),
    },
    { trusted: true },
  );
  const version = await createIn(tx, ctx, "kb_version", { ...content, article_id: article.id, change_kind: "major", change_note: input.change_note ?? "نسخهٔ نخست", ai_provenance: input.ai_provenance ?? null, ...(me ? { author_id: me } : {}) }, { trusted: true });
  return { article: (await articleOf(tx, ctx, article.id)) ?? article, version };
}

/** Start a new draft of a published article from its published content (or an older version's). */
export async function newDraftIn(tx: Tx, ctx: Ctx, articleId: string, opts: { kind?: "minor" | "major"; from?: string | null; note?: string | null } = {}): Promise<Row> {
  const article = await articleOf(tx, ctx, articleId);
  if (!article) throw notFound("مقاله پیدا نشد");
  if (["retired", "trashed"].includes(article.state)) throw conflict("مقالهٔ بازنشسته یا حذف‌شده را اول بازگردانید");
  const open = await openVersion(tx, ctx, articleId);
  if (open) throw conflict(`این مقاله پیش‌نویس باز دارد (نسخهٔ ${open.version_label ?? ""})؛ همان را ادامه دهید`);
  let src: Row = article;
  if (opts.from) {
    const old = await liveRow(tx, sysOf(ctx), "kb_version", opts.from);
    if (!old || old.article_id !== articleId) throw notFound("نسخه پیدا نشد");
    src = old;
  }
  const me = ctx.actor === "system" ? null : ctx.user.id;
  const data: Row = { article_id: articleId, change_kind: opts.kind ?? "minor", change_note: opts.note ?? (opts.from ? `بازگردانی از نسخهٔ ${src.version_label ?? ""}` : null), ...(me ? { author_id: me } : {}) };
  for (const f of CONTENT) data[f] = src[f] ?? (f === "keywords" || f === "tags" ? [] : null);
  return createIn(tx, ctx, "kb_version", data, { trusted: true });
}

/**
 * Publish a version (approved, or no approval needed): schedule it when `publish_at` is ahead, else swap it in.
 * Runs as the system on behalf of `by` (the approver or the author).
 */
export async function publishIn(tx: Tx, ctx: Ctx, versionId: string, by: string | null): Promise<Row> {
  const sys = sysOf(ctx, by);
  const v = await liveRow(tx, sys, "kb_version", versionId);
  if (!v) throw notFound("نسخه پیدا نشد");
  const article = await articleOf(tx, sys, v.article_id);
  if (!article) throw notFound("مقاله پیدا نشد");
  const now = new Date().toISOString();
  const later = v.publish_at && Date.parse(v.publish_at) > Date.now() + 30_000;
  if (later) {
    if (v.state !== "scheduled") await transitionIn(tx, sys, "kb_version", v.id, "scheduled", { approved_at: now, approved_by: by }, { trusted: true });
    if (!article.published_version_id && article.state !== "scheduled") await transitionIn(tx, sys, "kb_article", article.id, "scheduled", {}, { trusted: true });
    return (await liveRow(tx, sys, "kb_version", v.id))!;
  }
  const base = await baseOf(tx, sys, article.base_id);
  // the previous published version becomes outdated
  if (article.published_version_id && article.published_version_id !== v.id) {
    const prev = await liveRow(tx, sys, "kb_version", article.published_version_id);
    if (prev && prev.state === "published") await transitionIn(tx, sys, "kb_version", prev.id, "outdated", {}, { trusted: true });
  }
  const approved = v.needs_approval ? { approved_at: v.approved_at ?? now, approved_by: v.approved_by ?? by } : {};
  await transitionIn(tx, sys, "kb_version", v.id, "published", { published_at: now, published_by: by, reviewer_ids: [], ...approved }, { trusted: true });

  const today = todayIn(sys);
  const patch: Row = {
    title: v.title,
    summary: v.summary ?? null,
    body: v.body ?? "",
    internal_body: v.internal_body ?? "",
    keywords: v.keywords ?? [],
    tags: v.tags ?? [],
    version_label: v.version_label ?? versionLabel(Number(v.major ?? 1), Number(v.minor ?? 0)),
    major: Number(v.major ?? 1),
    minor: Number(v.minor ?? 0),
    published_version_id: v.id,
    draft_version_id: null,
    has_draft: false,
    published_at: now,
    published_by: by,
    first_published_at: article.first_published_at ?? now,
    last_reviewed_at: now,
    last_reviewed_by: by,
    review_due: false,
    reviewer_ids: [],
    ai_provenance: v.ai_provenance ?? null,
  };
  const reviewDays = Number(base?.review_days ?? 0);
  if (reviewDays > 0 && (!article.review_at || article.review_at <= today)) patch.review_at = addDaysISO(today, reviewDays);
  const validDays = Number(base?.default_valid_days ?? 0);
  if (validDays > 0 && !article.valid_to) patch.valid_to = addDaysISO(today, validDays);
  if (!article.valid_from) patch.valid_from = today;
  if (article.state === "published") await updateIn(tx, sys, "kb_article", article.id, patch, { trusted: true });
  else await transitionIn(tx, sys, "kb_article", article.id, "published", patch, { trusted: true });
  // the draft's files its published text shows go with it to the article (readers see only those, render.ts)
  await moveAttachmentsIn(tx, sys, { table: "kb_version", id: v.id }, { table: "kb_article", id: article.id }, attachmentRefs(`${v.body ?? ""}\n${v.internal_body ?? ""}`));

  const { def } = await defFor(sys, "kb_article", tx);
  const stored = (await articleOf(tx, sys, article.id))!;
  await addJournalIn(tx, sys, def, stored, { kind: "system", visibility: "internal", body: `نسخهٔ ${patch.version_label} منتشر شد${v.change_note ? `: ${String(v.change_note).slice(0, 300)}` : ""}.` }, { trusted: true, author: by });
  const major = Number(article.major ?? 0) > 0 && Number(v.major ?? 1) > Number(article.major ?? 0);
  await emitEvent(tx, sys, { kind: "record.kb.published", table: "kb_article", id: article.id, number: stored.number ?? null, actor: by, data: { version_id: v.id, version: patch.version_label, major, first: !article.published_version_id } });
  if (major) await markTranslationsStale(tx, sys, article.id, Number(v.major));
  return stored;
}

/** A new major version of a master leaves its translations behind (KB-059): flagged and a translation task each. */
async function markTranslationsStale(tx: Tx, sys: Ctx, masterId: string, major: number): Promise<void> {
  const translations = await liveRows(tx, sys, "kb_article", { and: [{ f: "translation_of", op: "eq", v: masterId }, { f: "state", op: "nin", v: ["trashed"] }] }, { limit: 200 });
  for (const t of translations) {
    if (Number(t.master_version ?? 0) >= major) continue;
    await updateIn(tx, sys, "kb_article", t.id, { translation_stale: true }, { trusted: true, keepVersion: true, allowLocked: true });
    await createIn(tx, sys, "kb_task", { kind: "translation", article_id: t.id, short_description: `ترجمه را با نسخهٔ ${major}.0 همگام کنید: ${String(t.title).slice(0, 150)}`, assigned_to: t.owner_id ?? null, priority: "4" }, { trusted: true });
  }
}

/** Submit a draft: review (approval rules) or straight publication; returns the version as the caller sees it. */
export async function submitVersion(ctx: Ctx, versionId: string, opts: { publish_at?: string | null } = {}) {
  await ctx.write(async (tx) => {
    const v = await liveRow(tx, sysOf(ctx), "kb_version", versionId);
    if (!v) throw notFound("نسخه پیدا نشد");
    if (opts.publish_at !== undefined && v.state === "draft") await updateIn(tx, ctx, "kb_version", versionId, { publish_at: opts.publish_at }, {});
    await transitionIn(tx, ctx, "kb_version", versionId, "in_review", {}, {});
  });
  return get(ctx, "kb_version", versionId);
}

/** Line diff of two versions of one article (both readable by the caller). */
export async function diffVersions(ctx: Ctx, a: string, b: string): Promise<{ from: Row; to: Row; fields: { field: string; label: string; lines: DiffLine[]; added: number; removed: number }[] }> {
  const from = (await get(ctx, "kb_version", a)).row as Row;
  const to = (await get(ctx, "kb_version", b)).row as Row;
  if (from.article_id !== to.article_id) throw bad("دو نسخه از یک مقاله را مقایسه کنید");
  const labels: Record<string, string> = { title: "عنوان", summary: "خلاصه", body: "متن", internal_body: "بخش داخلی", keywords: "کلیدواژه‌ها", tags: "برچسب‌ها" };
  const fields = [];
  for (const f of CONTENT) {
    if (!(f in from) && !(f in to)) continue; // a field the caller may not see
    const x = Array.isArray(from[f]) ? (from[f] as string[]).join("\n") : String(from[f] ?? "");
    const y = Array.isArray(to[f]) ? (to[f] as string[]).join("\n") : String(to[f] ?? "");
    if (x === y) continue;
    const lines = lineDiff(x, y);
    fields.push({ field: f, label: labels[f], lines, ...diffStats(lines) });
  }
  return { from, to, fields };
}

/** Whether the article's content would reach requesters (external base, not an internal article). */
export async function reachesRequesters(tx: Tx, ctx: Ctx, article: Row): Promise<boolean> {
  const base = await baseOf(tx, ctx, article.base_id);
  return !!base && base.kind !== "internal" && !isInternalArticle(article);
}

export { nextVersion, uniq };

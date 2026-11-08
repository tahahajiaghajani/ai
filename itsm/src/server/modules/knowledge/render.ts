// The reading view of an article (KB-049, KB-005, KB-006, KB-020, KB-021, KB-039, KB-059, KB-080): the article as the
// reader may see it (the internal section only for agents), its reusable blocks expanded for this reader (internal
// blocks only for agents, unpublished ones never), its table of contents, the banners that explain its state
// (retired with its replacement, possibly outdated, expired, AI-drafted, machine-translated, internal, a controlled
// document), the path of categories, translations, related articles, attachments, the glossary terms it uses, the
// reader's own vote, rating, subscription and pending acknowledgement, and what the reader may do. A view is logged
// once per sitting.
import type { KbBanner, KbReadView, KbTranslation } from "@shared/knowledge/api";
import { blockRefs, headings } from "@shared/knowledge/logic";
import { searchForm, stem } from "@shared/ai/text";
import { LIVE_STATES } from "@shared/tables/knowledge";
import type { Ctx } from "../../context";
import { get, listAttachments } from "../../engine";
import { contributesTo, holdsInternal, isKbApprover, liveRows, managesBase, rowsById, sysOf, todayIn, type Row } from "./common";
import { searchKnowledge } from "./search";
import { logEvent, viewedRecently } from "./events";
import { openVersion } from "./versions";
import { myAttestation } from "./attest";

/** `{{block:KBB000012}}` replaced by the block's text for this reader (or nothing). */
export async function expandBlocks(ctx: Ctx, md: string): Promise<string> {
  const refs = blockRefs(md);
  if (!refs.length) return md;
  const rows = await liveRows(ctx.db, ctx, "kb_block", { and: [{ f: "number", op: "in", v: refs }, { f: "state", op: "eq", v: "published" }] }, { limit: 200 });
  const by = new Map(rows.map((r) => [String(r.number).toUpperCase(), String(r.body ?? "")]));
  return md.replace(/\{\{\s*block\s*:\s*([A-Za-z]{1,6}-?\d{1,12})\s*\}\}/g, (_m, n: string) => by.get(n.toUpperCase().replace("-", "")) ?? "");
}

/** Active glossary terms whose forms appear in a text. */
async function glossaryIn(ctx: Ctx, text: string) {
  const norm = ` ${searchForm(text)} `;
  if (norm.trim().length < 2) return [];
  const rows = await liveRows(ctx.db, ctx, "kb_glossary", { f: "active", op: "eq", v: true }, { limit: 2000 });
  const out = [];
  for (const r of rows) {
    const forms = [...new Set([r.term, r.approved_fa, ...(Array.isArray(r.synonyms) ? r.synonyms : [])].filter(Boolean).map(String))];
    const hit = forms.filter((f) => {
      const s = stem(searchForm(f));
      return s.length >= 2 && norm.includes(` ${s}`);
    });
    if (hit.length) out.push({ term: String(r.term), definition: r.definition ?? null, approved_fa: r.approved_fa ?? null, forms: hit });
    if (out.length >= 40) break;
  }
  return out;
}

export async function readArticle(ctx: Ctx, id: string, opts: { session_id?: string | null; channel?: string | null; log?: boolean } = {}): Promise<KbReadView> {
  const r = await get(ctx, "kb_article", id);
  const a = r.row as Row;
  const display = r.display as Record<string, string>;
  const sys = sysOf(ctx);
  const internal = holdsInternal(ctx);
  const [base] = await rowsById(ctx.db, ctx, "kb_base", [a.base_id]);
  const baseSys = base ?? (await rowsById(ctx.db, sys, "kb_base", [a.base_id]))[0] ?? null;
  const [category] = a.category_id ? await rowsById(ctx.db, ctx, "kb_category", [a.category_id]) : [];
  const pathIds = category ? String(category.path ?? "").split("/").filter(Boolean) : [];
  const pathRows = pathIds.length ? await rowsById(ctx.db, ctx, "kb_category", pathIds) : [];
  const path = pathIds.map((pid) => pathRows.find((p) => p.id === pid)).filter((p): p is Row => !!p).map((p) => ({ id: p.id as string, name: String(p.name) }));

  const body = await expandBlocks(ctx, String(a.body ?? ""));
  const internalBody = "internal_body" in a && internal ? await expandBlocks(ctx, String(a.internal_body ?? "")) : null;
  const toc = headings(`${body}\n${internalBody ?? ""}`);

  // banners
  const banners: KbBanner[] = [];
  const today = todayIn(ctx);
  if (a.state === "retired") {
    let link: KbBanner["link"] = null;
    if (a.replaced_by) {
      const [rep] = await rowsById(ctx.db, ctx, "kb_article", [a.replaced_by]);
      if (rep) link = { id: rep.id, title: rep.title, number: rep.number ?? null };
    }
    banners.push({ kind: "retired", tone: "danger", text: link ? "این مقاله بازنشسته شده است؛ مقالهٔ جایگزین را بخوانید." : "این مقاله بازنشسته شده است و ممکن است دیگر درست نباشد.", link });
  } else if (["draft", "in_review", "scheduled"].includes(a.state)) {
    banners.push({ kind: a.state === "scheduled" ? "scheduled" : "draft", tone: "info", text: a.state === "scheduled" ? "این مقاله برای انتشار زمان‌بندی شده است و هنوز منتشر نشده است." : a.kcs_confidence === "wip" ? "مقالهٔ در حال کار: هنوز کامل و تأیید نشده است." : "این مقاله هنوز منتشر نشده است." });
  }
  if (a.valid_to && String(a.valid_to) < today && a.state !== "retired") banners.push({ kind: "expired", tone: "warning", text: "مدت اعتبار این مقاله گذشته است؛ پیش از به‌کار بستن آن را بررسی کنید." });
  else if (a.review_due && a.state !== "retired") banners.push({ kind: "outdated", tone: "warning", text: "موعد بازبینی این مقاله گذشته است؛ ممکن است قدیمی باشد." });
  if (a.confidential && internal) banners.push({ kind: "internal", tone: "info", text: "فقط کارشناسان این مقاله را می‌بینند." });
  if (a.governance === "compliance") banners.push({ kind: "compliance", tone: "info", text: `سند کنترل‌شده${a.doc_number ? ` به شمارهٔ ${a.doc_number}` : ""}${a.issuing_authority ? `، صادرکننده: ${a.issuing_authority}` : ""}.` });
  const prov = (a.ai_provenance && typeof a.ai_provenance === "object" ? a.ai_provenance : null) as Row | null;
  if (a.machine_translated) banners.push({ kind: "machine", tone: "warning", text: "ترجمهٔ ماشینی؛ هنوز کسی آن را تأیید نکرده است." });
  else if (prov && !prov.validated_by) banners.push({ kind: "ai", tone: "warning", text: "با کمک هوش مصنوعی نوشته شده و هنوز کارشناس دارای مجوز آن را تأیید نکرده است." });
  if (a.translation_stale) banners.push({ kind: "stale_translation", tone: "warning", text: "نسخهٔ اصلی این مقاله تغییر کرده است؛ این ترجمه ممکن است قدیمی باشد." });

  // translations (master and its translations the reader may read)
  const masterId = a.translation_of ?? a.id;
  const family = [...(await rowsById(ctx.db, ctx, "kb_article", [masterId], { f: "state", op: "in", v: LIVE_STATES })), ...(await liveRows(ctx.db, ctx, "kb_article", { and: [{ f: "translation_of", op: "eq", v: masterId }, { f: "state", op: "in", v: LIVE_STATES }] }, { limit: 30 }))];
  const translations: KbTranslation[] = family.filter((t) => t.id !== a.id).map((t) => ({ id: t.id, language: t.language ?? "fa", title: t.title, number: t.number ?? null, stale: !!t.translation_stale, master: t.id === masterId }));

  // related articles (keyword search on the title and keywords)
  let related: KbReadView["related"] = [];
  if (LIVE_STATES.includes(a.state)) {
    const q = [a.title, ...((a.keywords as string[] | null) ?? []).slice(0, 4)].join(" ");
    const s = await searchKnowledge(ctx, { q, size: 6, log: false, semantic: false });
    related = s.hits.filter((h) => h.id !== a.id && h.id !== a.translation_of && !translations.some((t) => t.id === h.id)).slice(0, 5);
  }

  const { attachments } = await listAttachments(ctx, "kb_article", id);
  const glossary = await glossaryIn(ctx, `${a.title}\n${body}`);

  // the reader's own feedback, subscription and acknowledgement
  let vote: KbReadView["my"]["vote"] = null;
  let rating: number | null = null;
  let subscribed = false;
  if (ctx.actor !== "system") {
    const fb = await liveRows(ctx.db, sys, "kb_feedback", { and: [{ f: "article_id", op: "eq", v: id }, { f: "user_id", op: "eq", v: ctx.user.id }, { f: "kind", op: "in", v: ["helpful", "not_helpful", "rating"] }] }, { order: "t.created_at desc", limit: 5 });
    vote = (fb.find((f) => f.kind === "helpful" || f.kind === "not_helpful")?.kind as "helpful" | "not_helpful" | undefined) ?? null;
    rating = Number(fb.find((f) => f.kind === "rating")?.rating ?? 0) || null;
    const subs = await liveRows(ctx.db, sys, "kb_subscription", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { or: [{ and: [{ f: "target_table", op: "eq", v: "kb_article" }, { f: "target_id", op: "eq", v: id }] }, ...(a.category_id ? [{ and: [{ f: "target_table", op: "eq" as const, v: "kb_category" }, { f: "target_id", op: "eq" as const, v: a.category_id }] }] : []), { and: [{ f: "target_table", op: "eq", v: "kb_base" }, { f: "target_id", op: "eq", v: a.base_id }] }] }] }, { limit: 3 });
    subscribed = subs.some((s) => s.target_table === "kb_article");
  }
  const acknowledgement = ctx.actor === "system" ? null : await myAttestation(ctx, id);

  // what the reader may do
  const contributor = contributesTo(ctx, baseSys, { category, article: a });
  const open = contributor ? await openVersion(ctx.db as never, ctx, id) : null;
  const meta = r.meta as { canWrite?: boolean };
  const live = LIVE_STATES.includes(a.state);
  const can = {
    edit: contributor && !["retired", "trashed"].includes(a.state),
    draft: open?.id ?? null,
    review: contributor && live,
    retire: contributor && live && !!meta.canWrite,
    restore: (a.state === "trashed" || a.state === "retired") && (contributor || isKbApprover(ctx)),
    approve: isKbApprover(ctx),
    feedback: live && baseSys?.allow_ratings !== false,
    flag: live,
    subscribe: ctx.actor !== "system",
    attest: !!acknowledgement && !acknowledgement.acked_at,
    manage: managesBase(ctx, baseSys),
  };
  if (opts.log !== false && live && !(await viewedRecently(ctx.db, ctx, id))) await logEvent(ctx.db, ctx, { kind: "view", article_id: id, session_id: opts.session_id ?? null, channel: opts.channel ?? "portal" });

  return {
    article: a,
    display,
    body,
    internal_body: internalBody,
    toc,
    base: base ? { id: base.id, name: base.name, kind: base.kind, allow_comments: base.allow_comments !== false, allow_ratings: base.allow_ratings !== false } : null,
    path,
    banners,
    translations,
    related,
    attachments: attachments.map((x) => ({ id: x.id, name: x.name, mime: x.mime, size: x.size, previewable: x.previewable })),
    glossary,
    provenance: prov ? { model: (prov.model as string) ?? null, validated_by: (prov.validated_by as string) ?? null, validated_by_name: prov.validated_by ? display[String(prov.validated_by)] ?? null : null, source_refs: Array.isArray(prov.source_refs) ? (prov.source_refs as string[]) : [], machine_translated: !!a.machine_translated } : a.machine_translated ? { machine_translated: true } : null,
    my: { vote, rating, subscribed, acknowledgement },
    can,
    author_name: a.author_id ? display[a.author_id] ?? null : null,
    owner_name: a.owner_id ? display[a.owner_id] ?? null : null,
    reviewer_name: a.last_reviewed_by ? display[a.last_reviewed_by] ?? null : null,
  };
}

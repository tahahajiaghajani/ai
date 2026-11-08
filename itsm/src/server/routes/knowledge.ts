// HTTP API of knowledge management under /api/o/:org/knowledge (docs/modules/knowledge_FA.md «API»; contracts in
// src/shared/knowledge/api.ts). Bases, categories, articles, versions, templates, tasks and the other tables are
// served by the generic engine API (/r/kb_…); these routes are what it cannot express: the knowledge home, Persian
// search and suggestions, the reading view, authoring (new articles, drafts, submission, diff, restore, checks),
// lifecycle (retire, restore, review), feedback (votes, ratings, flags, gaps, deflection), records (suggestions,
// attach/detach, capture), read-and-acknowledge, dashboards, the workspace, access diagnostics and the AI helpers.
// Every handler works with the caller's context: the engine and the access provider decide what they may read and
// change (404 for articles they may not read, 403 for actions their access does not allow).
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import { router, body, errorResponse, query } from "../http/hono";
import { AppError, bad, forbidden, notFound } from "../http/errors";
import { asHttpError } from "../modules/ai/errors";
import { createIn, get, orgSchema, systemCtx, transitionIn, updateIn } from "../engine";
import { cancelApprovals } from "../modules/sla";
import { parseFile } from "../modules/ai/rag";
import { cleanText, detectLang } from "@shared/ai/text";
import { ARTICLE_TYPES } from "@shared/tables/knowledge";
import {
  acknowledge, articleFromKnownError, attachArticle, attestationStatus, captureFromRecord, checkVersion, contributesTo, createArticleIn, deflect, detachArticle, diffVersions, draftOfRecord, draftWithAi,
  explainAccess, flagArticle, isKbAdmin, kbDashboard, kbHome, kbSweep, kbWorkspace, knowledgeAi, knowledgeAiCapabilities, myAttestations, newDraftIn, rate, readArticle, reownArticles, reportGap,
  restoreArticle, retireArticle, reviewArticle, searchKnowledge, seedKnowledgeDefaults, submitVersion, suggestForRecord, suggestForText, translateDraft, vote, writeAssist, logEvent, WRITE_ACTIONS,
  licenceLevel,
} from "../modules/knowledge";
import { baseOf, liveRow, liveRows, sysOf, type Row } from "../modules/knowledge/common";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const text = (max: number) => z.string().max(max, `حداکثر ${max} نویسه`);
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");
const session = text(80).nullish();

export const knowledgeRoutes = router();
knowledgeRoutes.onError((err, c) => errorResponse(err instanceof AppError ? err : asHttpError(err), c));
// the caller's access subject is loaded once, before the module asks who they are (grants, groups, field groups)
knowledgeRoutes.use("*", async (c, next) => {
  await orgSchema(c.get("ctx"));
  await next();
});

// ---------------------------------------------------------------------------------------------------------------
// what the screens need, the home, search

knowledgeRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  return c.json({ ai: ctx.can("ai", "view") ? knowledgeAiCapabilities() : [], write_actions: WRITE_ACTIONS, types: ARTICLE_TYPES, admin: isKbAdmin(ctx) });
});

knowledgeRoutes.get("/home", async (c) => c.json(await kbHome(c.get("ctx"))));

const searchQuery = z.object({
  q: text(300).optional(),
  base: UUID.optional(),
  category: UUID.optional(),
  type: text(40).optional(),
  language: text(10).optional(),
  sort: z.enum(["relevance", "recent", "popular"]).optional(),
  page: z.coerce.number().int().min(1).max(200).optional(),
  size: z.coerce.number().int().min(1).max(50).optional(),
  session: session,
  channel: text(20).optional(),
  retired: z.enum(["0", "1"]).optional(),
});

knowledgeRoutes.get("/search", async (c) => {
  const p = query(c, searchQuery);
  return c.json(await searchKnowledge(c.get("ctx"), { q: p.q ?? "", base_id: p.base, category_id: p.category, type: p.type, language: p.language, sort: p.sort, page: p.page, size: p.size, session_id: p.session ?? null, channel: p.channel ?? "search", include_retired: p.retired === "1" }));
});

knowledgeRoutes.post("/suggest", async (c) => {
  const p = await body(c, z.object({ text: text(300), session_id: session, channel: text(20).nullish(), size: z.number().int().min(1).max(8).optional() }));
  return c.json(await suggestForText(c.get("ctx"), { text: p.text, session_id: p.session_id ?? null, channel: p.channel ?? "portal", size: p.size }));
});

knowledgeRoutes.post("/click", async (c) => {
  const p = await body(c, z.object({ article_id: UUID, query: text(300).nullish(), position: z.number().int().min(0).max(500).nullish(), session_id: session, channel: text(20).nullish() }));
  const ctx = c.get("ctx");
  await get(ctx, "kb_article", p.article_id);
  await logEvent(ctx.db, ctx, { kind: "click", article_id: p.article_id, query: p.query ?? null, position: p.position ?? null, session_id: p.session_id ?? null, channel: p.channel ?? "search" });
  return c.json({ ok: true });
});

knowledgeRoutes.post("/deflect", async (c) => {
  const p = await body(c, z.object({ article_id: UUID.nullish(), query: text(300).nullish(), session_id: session, channel: text(20).nullish() }));
  return c.json(await deflect(c.get("ctx"), p));
});

// ---------------------------------------------------------------------------------------------------------------
// articles

knowledgeRoutes.get("/articles/:id/read", async (c) => {
  const q = query(c, z.object({ session: session, channel: text(20).optional() }));
  return c.json(await readArticle(c.get("ctx"), id(c.req.param("id")), { session_id: q.session ?? null, channel: q.channel ?? "portal" }));
});

const newArticle = z.object({
  base_id: UUID,
  category_id: UUID.nullish(),
  template_id: UUID.nullish(),
  article_type: z.enum(ARTICLE_TYPES.map((t) => t.value) as [string, ...string[]]).nullish(),
  title: text(250).min(1, "عنوان مقاله را بنویسید"),
  summary: text(1000).nullish(),
  body: text(200_000).nullish(),
  internal_body: text(200_000).nullish(),
  keywords: z.array(text(60)).max(50).optional(),
  tags: z.array(text(60)).max(50).optional(),
  language: text(10).nullish(),
  visibility: z.enum(["inherit", "internal"]).nullish(),
  owner_group_id: UUID.nullish(),
  external_url: text(2000).nullish(),
});

knowledgeRoutes.post("/articles", async (c) => {
  const p = await body(c, newArticle);
  const ctx = c.get("ctx");
  const r = await ctx.write((tx) => createArticleIn(tx, ctx, p));
  return c.json({ article: (await get(ctx, "kb_article", r.article.id)).row, version: (await get(ctx, "kb_version", r.version.id)).row });
});

knowledgeRoutes.post("/articles/:id/draft", async (c) => {
  const p = await body(c, z.object({ kind: z.enum(["minor", "major"]).optional(), from: UUID.nullish(), note: text(2000).nullish() }));
  const ctx = c.get("ctx");
  const aid = id(c.req.param("id"));
  await get(ctx, "kb_article", aid);
  const v = await ctx.write((tx) => newDraftIn(tx, ctx, aid, { kind: p.kind, from: p.from ?? null, note: p.note ?? null }));
  return c.json({ version: (await get(ctx, "kb_version", v.id)).row });
});

knowledgeRoutes.post("/articles/:id/retire", async (c) => {
  const p = await body(c, z.object({ reason: text(2000), replaced_by: UUID.nullish(), at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }));
  const r = await retireArticle(c.get("ctx"), id(c.req.param("id")), { reason: p.reason, replaced_by: p.replaced_by ?? null, at: p.at ?? null });
  return c.json({ row: r.row, display: r.display });
});

knowledgeRoutes.post("/articles/:id/restore", async (c) => {
  const r = await restoreArticle(c.get("ctx"), id(c.req.param("id")));
  return c.json({ row: r.row, display: r.display });
});

knowledgeRoutes.post("/articles/:id/review", async (c) => {
  const p = await body(c, z.object({ outcome: z.enum(["confirm", "update", "retire"]), note: text(2000).nullish(), reason: text(2000).nullish() }));
  return c.json(await reviewArticle(c.get("ctx"), id(c.req.param("id")), p));
});

knowledgeRoutes.post("/articles/:id/vote", async (c) => {
  const p = await body(c, z.object({ helpful: z.boolean(), reason: text(40).nullish(), comment: text(4000).nullish(), session_id: session, channel: text(20).nullish() }));
  return c.json(await vote(c.get("ctx"), id(c.req.param("id")), p));
});

knowledgeRoutes.post("/articles/:id/rate", async (c) => {
  const p = await body(c, z.object({ rating: z.number().int().min(1).max(5) }));
  return c.json(await rate(c.get("ctx"), id(c.req.param("id")), p.rating));
});

knowledgeRoutes.post("/articles/:id/flag", async (c) => {
  const p = await body(c, z.object({ reason: z.enum(["incorrect", "outdated", "unclear", "duplicate", "missing_step", "broken_link", "other"]), comment: text(4000).nullish(), channel: text(20).nullish(), record: z.object({ table: TABLE, id: UUID, number: text(40).nullish() }).nullish() }));
  return c.json(await flagArticle(c.get("ctx"), id(c.req.param("id")), p));
});

/** Follow (or stop following) an article, a category or a base — every reader may, for themselves. */
async function subscribe(ctx: Parameters<typeof get>[0], table: "kb_article" | "kb_category" | "kb_base", target: string, on: boolean, events?: string[]) {
  const r = await get(ctx, table, target); // 404 unless readable
  const sys = sysOf(ctx, ctx.user.id);
  const [existing] = await liveRows(ctx.db, sysOf(ctx), "kb_subscription", { and: [{ f: "user_id", op: "eq", v: ctx.user.id }, { f: "target_table", op: "eq", v: table }, { f: "target_id", op: "eq", v: target }] }, { limit: 1 });
  await sys.write(async (tx) => {
    if (on && !existing) await createIn(tx, sys, "kb_subscription", { user_id: ctx.user.id, target_table: table, target_id: target, target_label: String((r.row as Row).title ?? (r.row as Row).name ?? "").slice(0, 250), ...(events ? { events } : {}) }, { trusted: true });
    else if (on && existing && events) await updateIn(tx, sys, "kb_subscription", existing.id, { events }, { trusted: true });
    else if (!on && existing) {
      const { removeIn } = await import("../engine");
      await removeIn(tx, sys, "kb_subscription", existing.id);
    }
  });
  return { subscribed: on };
}

const subBody = z.object({ target_table: z.enum(["kb_article", "kb_category", "kb_base"]), target_id: UUID, events: z.array(z.enum(["published", "major", "retired"])).max(3).optional() });
knowledgeRoutes.post("/subscriptions", async (c) => {
  const p = await body(c, subBody);
  if (c.get("ctx").actor === "system") throw bad("اشتراک با عضو است");
  return c.json(await subscribe(c.get("ctx"), p.target_table, p.target_id.toLowerCase(), true, p.events));
});
knowledgeRoutes.post("/subscriptions/remove", async (c) => {
  const p = await body(c, subBody);
  return c.json(await subscribe(c.get("ctx"), p.target_table, p.target_id.toLowerCase(), false));
});

knowledgeRoutes.get("/articles/:id/access", async (c) => {
  const q = query(c, z.object({ user: UUID }));
  return c.json(await explainAccess(c.get("ctx"), id(c.req.param("id")), q.user.toLowerCase()));
});

/** A translation of an article: an empty draft in another language, or a machine translation draft (labelled). */
knowledgeRoutes.post("/articles/:id/translate", async (c) => {
  const p = await body(c, z.object({ language: text(10).min(2), machine: z.boolean().optional() }));
  const ctx = c.get("ctx");
  const aid = id(c.req.param("id"));
  const master = (await get(ctx, "kb_article", aid)).row as Row;
  if (master.translation_of) throw bad("از نسخهٔ اصلی ترجمه کنید، نه از ترجمه");
  if (p.language === master.language) throw bad("زبان ترجمه با زبان مقاله یکی است");
  const [existing] = await liveRows(ctx.db, ctx, "kb_article", { and: [{ f: "translation_of", op: "eq", v: aid }, { f: "language", op: "eq", v: p.language }, { f: "state", op: "ne", v: "trashed" }] }, { limit: 1 });
  if (existing) throw bad("ترجمه به این زبان از پیش وجود دارد");
  let content: { title: string; summary: string | null; body: string } = { title: String(master.title), summary: (master.summary as string) ?? null, body: String(master.body ?? "") };
  let provenance: Record<string, unknown> | null = null;
  if (p.machine) {
    ctx.need("ai", "view");
    const t = await translateDraft(ctx, { title: content.title, summary: content.summary, body: content.body, from: String(master.language ?? "fa"), to: p.language });
    content = { title: t.title, summary: t.summary ?? null, body: t.body };
    provenance = { model: t.model, prompt_version: "kb.translate.1", source_refs: [String(master.number ?? aid)], kind: "translation" };
  }
  const r = await ctx.write((tx) =>
    createArticleIn(tx, ctx, {
      base_id: master.base_id, category_id: master.category_id ?? null, template_id: master.template_id ?? null, article_type: master.article_type ?? null,
      title: content.title, summary: content.summary, body: content.body, internal_body: "", keywords: (master.keywords as string[]) ?? [], language: p.language,
      translation_of: aid, machine_translated: !!p.machine, ai_provenance: provenance, change_note: p.machine ? "ترجمهٔ ماشینی" : "ترجمه",
    }),
  );
  return c.json({ article: (await get(ctx, "kb_article", r.article.id)).row, version: (await get(ctx, "kb_version", r.version.id)).row });
});

// ---------------------------------------------------------------------------------------------------------------
// versions

knowledgeRoutes.post("/versions/:id/submit", async (c) => {
  const p = await body(c, z.object({ publish_at: z.string().datetime().nullish() }));
  const r = await submitVersion(c.get("ctx"), id(c.req.param("id")), { publish_at: p.publish_at });
  return c.json({ row: r.row, display: r.display });
});

knowledgeRoutes.post("/versions/:id/withdraw", async (c) => {
  const ctx = c.get("ctx");
  const vid = id(c.req.param("id"));
  const v = (await get(ctx, "kb_version", vid)).row as Row;
  if (!["in_review", "scheduled"].includes(String(v.state))) throw bad("این نسخه در بازبینی نیست");
  if (v.author_id !== ctx.user.id && !isKbAdmin(ctx)) throw forbidden("نویسنده نسخه را از بازبینی برمی‌گرداند");
  await ctx.write((tx) => transitionIn(tx, ctx, "kb_version", vid, "draft", {}, {}));
  await cancelApprovals(ctx, "kb_version", vid).catch(() => undefined);
  const r = await get(ctx, "kb_version", vid);
  return c.json({ row: r.row, display: r.display });
});

knowledgeRoutes.get("/versions/:id/check", async (c) => c.json(await checkVersion(c.get("ctx"), id(c.req.param("id")))));

knowledgeRoutes.get("/diff", async (c) => {
  const q = query(c, z.object({ a: UUID, b: UUID }));
  const d = await diffVersions(c.get("ctx"), q.a.toLowerCase(), q.b.toLowerCase());
  return c.json({ from: { id: d.from.id, version_label: d.from.version_label ?? null, state: d.from.state ?? null }, to: { id: d.to.id, version_label: d.to.version_label ?? null, state: d.to.state ?? null }, fields: d.fields });
});

knowledgeRoutes.post("/versions/:id/restore", async (c) => {
  const ctx = c.get("ctx");
  const vid = id(c.req.param("id"));
  const old = (await get(ctx, "kb_version", vid)).row as Row;
  const v = await ctx.write((tx) => newDraftIn(tx, ctx, String(old.article_id), { kind: "minor", from: vid }));
  return c.json({ version: (await get(ctx, "kb_version", v.id)).row });
});

/** A licensed person validates AI-written or machine-translated content (the label clears on the next publication). */
knowledgeRoutes.post("/versions/:id/validate-ai", async (c) => {
  const ctx = c.get("ctx");
  const vid = id(c.req.param("id"));
  const v = (await get(ctx, "kb_version", vid)).row as Row;
  const article = await liveRow(ctx.db, sysOf(ctx), "kb_article", v.article_id);
  const base = article ? await baseOf(ctx.db, ctx, article.base_id) : null;
  if (v.author_id === ctx.user.id && !isKbAdmin(ctx)) throw forbidden("متن هوش مصنوعی را کسی جز درخواست‌کنندهٔ پیش‌نویس تأیید می‌کند");
  const lvl = base?.kcs_enabled ? await licenceLevel(ctx.db, ctx, ctx.user.id, base.id) : "publisher";
  if (!contributesTo(ctx, base, { article }) || !(lvl === "publisher" || lvl === "coach" || lvl === "kde" || isKbAdmin(ctx))) throw forbidden("تأیید متن هوش مصنوعی مجوز منتشرکننده می‌خواهد");
  const sys = sysOf(ctx, ctx.user.id);
  const prov = { ...((v.ai_provenance as Row) ?? {}), validated_by: ctx.user.id, validated_at: new Date().toISOString() };
  await sys.write(async (tx) => {
    await updateIn(tx, sys, "kb_version", vid, { ai_validated_by: ctx.user.id, ai_provenance: prov }, { trusted: true });
    if (article && article.published_version_id === vid) await updateIn(tx, sys, "kb_article", article.id, { ai_provenance: prov, machine_translated: false }, { trusted: true, keepVersion: true });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------------------------------------------
// records: suggestions, links, capture

knowledgeRoutes.get("/records/:table/:id", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const q = query(c, z.object({ q: text(300).optional(), session: session }));
  return c.json(await suggestForRecord(c.get("ctx"), table, id(c.req.param("id")), { q: q.q ?? null, session_id: q.session ?? null }));
});

knowledgeRoutes.post("/records/:table/:id/attach", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const p = await body(c, z.object({ article_id: UUID, kind: z.enum(["kb_solved_by", "kb_workaround", "kb_related"]).optional(), note: text(500).nullish(), query: text(300).nullish(), session_id: session }));
  return c.json(await attachArticle(c.get("ctx"), { table, id: id(c.req.param("id")), article_id: p.article_id.toLowerCase(), kind: p.kind, note: p.note ?? null, query: p.query ?? null, session_id: p.session_id ?? null }));
});

knowledgeRoutes.post("/records/:table/:id/detach", async (c) => {
  const table = TABLE.parse(c.req.param("table"));
  const p = await body(c, z.object({ link_id: UUID, reason: text(500) }));
  return c.json(await detachArticle(c.get("ctx"), { table, id: id(c.req.param("id")), link_id: p.link_id.toLowerCase(), reason: p.reason }));
});

knowledgeRoutes.post("/capture", async (c) => {
  const p = await body(c, z.object({ table: TABLE, id: UUID, base_id: UUID.nullish(), category_id: UUID.nullish(), template_id: UUID.nullish(), wip: z.boolean().optional(), title: text(250).nullish(), ai: z.boolean().optional() }));
  const ctx = c.get("ctx");
  const rid = p.id.toLowerCase();
  let r;
  if (p.ai) {
    ctx.need("ai", "view");
    const { draft, record } = await draftOfRecord(ctx, p.table, rid);
    const ext = knowledgeAi().draftFromRecord;
    const ai = ext ? await ext(ctx, p.table, rid) : await draftWithAi(ctx, { ...draft, number: record.number ?? null });
    const created = await captureFromRecord(ctx, { table: p.table, id: rid, base_id: p.base_id, category_id: p.category_id, template_id: p.template_id, title: ai.title });
    const sys = sysOf(ctx, ctx.user.id);
    const provenance = { model: ai.model ?? null, prompt_version: "kb.draft.1", source_refs: [String(record.number ?? rid)], kind: "draft" };
    await sys.write((tx) => updateIn(tx, sys, "kb_version", created.version.id, { title: ai.title, summary: ai.summary ?? null, body: ai.body, keywords: ai.keywords ?? draft.keywords, ai_provenance: provenance }, { trusted: true }));
    r = created;
  } else {
    r = await captureFromRecord(ctx, { table: p.table, id: rid, base_id: p.base_id, category_id: p.category_id, template_id: p.template_id, wip: p.wip, title: p.title });
  }
  return c.json({ article: (await get(ctx, "kb_article", r.article.id)).row, version: r.version ? (await get(ctx, "kb_version", r.version.id)).row : null });
});

knowledgeRoutes.post("/known-errors/:id/article", async (c) => {
  const p = await body(c, z.object({ base_id: UUID.nullish() }));
  const ctx = c.get("ctx");
  const r = await articleFromKnownError(ctx, id(c.req.param("id")), p.base_id ?? null);
  return c.json({ article: (await get(ctx, "kb_article", r.article.id)).row, existing: r.existing });
});

knowledgeRoutes.post("/gaps", async (c) => {
  const p = await body(c, z.object({ text: text(250), record: z.object({ table: TABLE, id: UUID, number: text(40).nullish() }).nullish(), base_id: UUID.nullish() }));
  const ctx = c.get("ctx");
  if (p.record) await get(ctx, p.record.table, p.record.id);
  return c.json(await reportGap(ctx, { text: p.text, kind: "reported", record: p.record ?? null, base_id: p.base_id ?? null }));
});

// ---------------------------------------------------------------------------------------------------------------
// read and acknowledge

knowledgeRoutes.get("/attestations/mine", async (c) => c.json({ items: await myAttestations(c.get("ctx")) }));
knowledgeRoutes.post("/attestations/:id/ack", async (c) => c.json(await acknowledge(c.get("ctx"), id(c.req.param("id")))));
knowledgeRoutes.get("/attestations/:id/status", async (c) => c.json(await attestationStatus(c.get("ctx"), id(c.req.param("id")))));

// ---------------------------------------------------------------------------------------------------------------
// dashboards, workspace, administration

knowledgeRoutes.get("/dashboard", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(7).max(730).optional() }));
  return c.json(await kbDashboard(c.get("ctx"), q.days ?? 90));
});

knowledgeRoutes.get("/workspace", async (c) => c.json(await kbWorkspace(c.get("ctx"))));

knowledgeRoutes.post("/reown", async (c) => {
  const p = await body(c, z.object({ from: UUID, to: UUID, base_id: UUID.nullish() }));
  return c.json(await reownArticles(c.get("ctx"), { from: p.from.toLowerCase(), to: p.to.toLowerCase(), base_id: p.base_id ?? null }));
});

/** Merge a duplicate pair: the other article retires with this one as its replacement. */
knowledgeRoutes.post("/duplicates/:id/merge", async (c) => {
  const p = await body(c, z.object({ keep: z.enum(["a", "b"]), reason: text(500).nullish() }));
  const ctx = c.get("ctx");
  const did = id(c.req.param("id"));
  const d = (await get(ctx, "kb_duplicate", did)).row as Row;
  const keep = p.keep === "a" ? d.article_a : d.article_b;
  const drop = p.keep === "a" ? d.article_b : d.article_a;
  await retireArticle(ctx, drop, { reason: p.reason || "تکراری؛ با مقالهٔ دیگر ادغام شد", replaced_by: keep });
  await ctx.write((tx) => transitionIn(tx, ctx, "kb_duplicate", did, "merged", {}, {}));
  return c.json({ ok: true, kept: keep, retired: drop });
});

knowledgeRoutes.post("/sweep", async (c) => {
  const ctx = c.get("ctx");
  if (!isKbAdmin(ctx)) throw forbidden("اجرای بررسی‌های دانش با مدیران دانش است");
  const p = await body(c, z.object({ daily: z.boolean().optional() }));
  return c.json(await kbSweep(await systemCtx(ctx.cfg, ctx.org.id), { daily: p.daily ?? true }));
});

knowledgeRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!isKbAdmin(ctx)) throw forbidden("افزودن پیش‌فرض‌های دانش با مدیران دانش است");
  const p = await body(c, z.object({ force: z.boolean().optional() }));
  return c.json(await seedKnowledgeDefaults(ctx.cfg, ctx.org.id, { force: p.force }));
});

// ---------------------------------------------------------------------------------------------------------------
// AI helpers (the organisation's own models; suggestions only — people apply them)

knowledgeRoutes.post("/ai/write", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const p = await body(c, z.object({ action: z.enum(Object.keys(WRITE_ACTIONS) as [string, ...string[]]), text: text(20_000), base_id: UUID.nullish() }));
  const base = p.base_id ? await baseOf(ctx.db, ctx, p.base_id) : null;
  return c.json(await writeAssist(ctx, { action: p.action as never, text: p.text, instructions: (base?.description as string) ?? null }));
});

const SKILLS = ["suggestMetadata", "validate", "prescoreAqi", "judgeDuplicate", "curate"] as const;
knowledgeRoutes.post("/ai/:skill", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("ai", "view");
  const skill = z.enum(SKILLS).parse(c.req.param("skill"));
  const p = await body(c, z.object({ id: UUID.nullish(), other: UUID.nullish() }));
  const ai = knowledgeAi();
  if (skill === "suggestMetadata" && ai.suggestMetadata && p.id) {
    await get(ctx, "kb_version", p.id);
    return c.json(await ai.suggestMetadata(ctx, p.id));
  }
  if (skill === "validate" && ai.validate && p.id) {
    await get(ctx, "kb_version", p.id);
    return c.json(await ai.validate(ctx, p.id));
  }
  if (skill === "prescoreAqi" && ai.prescoreAqi && p.id) {
    await get(ctx, "kb_quality_review", p.id);
    return c.json(await ai.prescoreAqi(ctx, p.id));
  }
  if (skill === "judgeDuplicate" && ai.judgeDuplicate && p.id && p.other) {
    await get(ctx, "kb_article", p.id);
    await get(ctx, "kb_article", p.other);
    return c.json(await ai.judgeDuplicate(ctx, p.id, p.other));
  }
  if (skill === "curate" && ai.curate) return c.json(await ai.curate(ctx));
  throw notFound("این توانایی هوش مصنوعی هنوز فعال نیست");
});

// ---------------------------------------------------------------------------------------------------------------
// import (KB-017): Markdown, text, HTML, Word and PDF files become drafts in a base

const IMPORT_LIMIT = 21 * 1024 * 1024;
knowledgeRoutes.post("/import", bodyLimit({ maxSize: IMPORT_LIMIT, onError: () => { throw new AppError(413, "too_large", "پرونده‌ها بزرگ‌تر از ۲۰ مگابایت است"); } }), async (c) => {
  const ctx = c.get("ctx");
  const form = await c.req.parseBody({ all: true }).catch(() => {
    throw bad("پرونده دریافت نشد (multipart/form-data با فیلدهای base_id و file)");
  });
  const baseId = String(form.base_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(baseId)) throw bad("پایگاه دانش را انتخاب کنید");
  const files = (Array.isArray(form.file) ? form.file : [form.file]).filter((f): f is File => !!f && typeof f !== "string").slice(0, 20);
  if (!files.length) throw bad("پرونده‌ای برای درون‌ریزی نیامده است");
  const created: { id: string; number: string | null; title: string }[] = [];
  const failed: { name: string; message: string }[] = [];
  const existing = new Set((await liveRows(ctx.db, ctx, "kb_article", { f: "base_id", op: "eq", v: baseId }, { limit: 20_000 })).map((a) => String(a.title).trim()));
  for (const f of files) {
    try {
      const parsed = await parseFile(f.name, f.type, new Uint8Array(await f.arrayBuffer()));
      const content = cleanText(parsed.pages.map((p) => p.text).join("\n\n"));
      if (!content.trim()) throw bad(parsed.problem ?? "متنی در این پرونده پیدا نشد");
      const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
      const title = (heading || f.name.replace(/\.[a-z0-9]+$/i, "")).slice(0, 250);
      if (existing.has(title)) throw bad("مقاله‌ای با همین عنوان در این پایگاه هست");
      const lang = detectLang(content);
      const r = await ctx.write((tx) => createArticleIn(tx, ctx, { base_id: baseId, title, body: heading ? content.replace(/^#\s+.+$/m, "").trim() : content, language: lang === "en" ? "en" : "fa", change_note: `درون‌ریزی از ${f.name}` }));
      existing.add(title);
      created.push({ id: r.article.id, number: r.article.number ?? null, title });
    } catch (e) {
      failed.push({ name: f.name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json({ created, failed });
});

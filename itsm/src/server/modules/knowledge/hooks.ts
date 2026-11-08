// Behaviour of the knowledge tables on every write path, inside the write's transaction:
//
//   kb_base       created and removed by knowledge administrators; contributors (owner, managers, approvers, named
//                 contributors) and the unit sub-trees of its audience compiled into k_* / r_units / x_units; «داخلی»
//                 makes it «فقط کارشناسان»; «سری» switches AI off; a base with articles is not removed
//   kb_category   managed by the base's managers; path and depth; no cycles, same base as its parent; the nearest
//                 audience on its chain (c_*) and the managed-by groups down the chain (m_groups) — children follow
//   kb_article    contributors only; category of the same base, template allowed in the base; «فقط کارشناسان» from
//                 the visibility, KCS confidence and type; audience unit sub-trees; the base's workspace; stamps of
//                 retirement and trash; reviewers of a retirement request; guards for retirement, trash and restore
//   kb_version    one open draft per article, by contributors; numbers; content locked outside drafts; hash, words
//                 and the quality checks; submission checks the template's required sections, sensitive data in
//                 content that reaches requesters, and computes who approves (or publishes at once)
//   kb_feedback   counters of the article (votes, rating, open flags)
//   kb_task       title, owner group (article → base → the settings' group); closing settles its feedback
//   kb_snippet/kb_block/kb_decision_tree   «فقط کارشناسان» from their visibility; blocks re-index their host articles
//   kb_template, kb_glossary, kb_search_rule, kb_domain, kb_licence   administrators only; template sections checked
//   kb_attestation the article's version; kb_quality_review the AQI score; kb_duplicate the pair key
import { cleanSections, contentHash, isInternalArticle, missingSections, nextVersion, qualityChecks, scanSensitive, sectionsProblem, wordCount } from "@shared/knowledge/logic";
import { stateCategory } from "@shared/model/task";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, defFor, registerHooks, transitionIn, updateIn, validationError, type WriteArgs } from "../../engine";
import { enqueue } from "../../jobs";
import { conflict, forbidden } from "../../http/errors";
import {
  activeMembers, articleOf, baseOf, categoryOf, contributesTo, countRows, expandUnits, groupMembers, ids, isKbAdmin, isKbApprover, kbConfig, liveRow, liveRows, managesBase, rowsById, sysOf, uniq, type Row,
} from "./common";
import { publishIn } from "./versions";
import { licenceLevel } from "./kcs";

const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);
const leaving = (w: WriteArgs, state: string) => w.op !== "create" && w.prev?.state === state && w.next.state !== state;
const isSys = (ctx: Ctx) => ctx.actor === "system";
const touched = (w: WriteArgs, fields: string[]) => w.op === "create" || fields.some((f) => w.changed.has(f));

function adminOnly(w: WriteArgs, what: string): void {
  if (isSys(w.ctx) || w.trusted || isKbAdmin(w.ctx)) return;
  throw forbidden(`${what} را فقط مدیران دانش تعریف و تغییر می‌دهند`);
}

// ---------------------------------------------------------------------------------------------------------------
// kb_base

async function baseBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    adminOnly(w, "پایگاه‌های دانش");
    const n = await countRows(w.tx, sysOf(w.ctx), "kb_article", { and: [{ f: "base_id", op: "eq", v: w.prev?.id }, { f: "state", op: "ne", v: "trashed" }] });
    if (n) throw conflict(`این پایگاه ${n} مقاله دارد؛ اول آن‌ها را به پایگاه دیگری ببرید یا بایگانی کنید`);
    return;
  }
  if (w.op === "create") adminOnly(w, "پایگاه‌های دانش");
  const n = w.next;
  if (n.classification === "secret") n.ai_enabled = false;
  n.confidential = n.kind === "internal";
  if (touched(w, ["owner_id", "approvers", "contrib_users", "manager_group_id", "approver_groups", "contrib_groups"])) {
    n.k_users = uniq([n.owner_id, ...ids(n.approvers), ...ids(n.contrib_users)]);
    n.k_groups = uniq([n.manager_group_id, ...ids(n.approver_groups), ...ids(n.contrib_groups)]);
  }
  if (touched(w, ["read_units", "units_tree"])) n.r_units = await expandUnits(w.tx, w.ctx, n.read_units, n.units_tree !== false);
  if (touched(w, ["deny_units"])) n.x_units = await expandUnits(w.tx, w.ctx, n.deny_units, true);
  if (n.default_template_id && ids(n.allowed_templates).length && !ids(n.allowed_templates).includes(n.default_template_id)) {
    throw validationError({ default_template_id: "قالب پیش‌فرض باید از قالب‌های مجاز باشد" });
  }
}

async function baseAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "create" || w.op === "delete") return;
  // what AI may use, and how, lives in the index: re-index the base's articles
  if (["ai_requesters", "kind", "classification"].some((f) => w.changed.has(f))) {
    await enqueue(w.tx, { kind: "kb.reindex", orgId: w.ctx.org.id, payload: { base_id: w.row.id }, dedupeKey: `kb.reindex:${w.row.id}`, delayMs: 2_000 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// kb_category

/** The compiled audience of a category from its own settings and its parent's compiled values. */
async function compileCategory(tx: Tx, ctx: Ctx, n: Row, parent: Row | null): Promise<Row> {
  const own = n.read_mode === "audience";
  const units = own ? await expandUnits(tx, ctx, n.read_units, n.units_tree !== false) : [];
  return {
    path: `${parent?.path ?? "/"}${n.id}/`,
    depth: parent ? Number(parent.depth ?? 0) + 1 : 0,
    c_all: own ? false : parent ? parent.c_all !== false : true,
    c_users: own ? ids(n.read_users) : parent ? ids(parent.c_users) : [],
    c_groups: own ? ids(n.read_groups) : parent ? ids(parent.c_groups) : [],
    c_units: own ? units : parent ? ids(parent.c_units) : [],
    m_groups: uniq([...(parent ? ids(parent.m_groups) : []), ...ids(n.managed_by_groups)]),
  };
}

async function categoryBefore(w: WriteArgs): Promise<void> {
  const sys = sysOf(w.ctx);
  if (w.op === "delete") {
    const id = w.prev?.id;
    const arts = await countRows(w.tx, sys, "kb_article", { and: [{ f: "category_id", op: "eq", v: id }, { f: "state", op: "ne", v: "trashed" }] });
    const kids = await countRows(w.tx, sys, "kb_category", { f: "parent_id", op: "eq", v: id });
    if (arts || kids) throw conflict("این دسته مقاله یا زیردسته دارد؛ اول آن‌ها را جابه‌جا کنید");
    if (!isSys(w.ctx) && !managesBase(w.ctx, await baseOf(w.tx, w.ctx, w.prev?.base_id))) throw forbidden("دسته‌ها را مدیران همان پایگاه تغییر می‌دهند");
    return;
  }
  const n = w.next;
  const base = await baseOf(w.tx, w.ctx, n.base_id);
  if (!base) throw validationError({ base_id: "پایگاه دانش پیدا نشد" });
  if (!isSys(w.ctx) && !w.trusted && !managesBase(w.ctx, base)) throw forbidden("دسته‌ها را مدیران همان پایگاه تغییر می‌دهند");
  let parent: Row | null = null;
  if (n.parent_id) {
    if (n.parent_id === n.id) throw validationError({ parent_id: "دسته زیرمجموعهٔ خودش نیست" });
    parent = await categoryOf(w.tx, w.ctx, n.parent_id);
    if (!parent) throw validationError({ parent_id: "دستهٔ بالاتر پیدا نشد" });
    if (parent.base_id !== n.base_id) throw validationError({ parent_id: "دستهٔ بالاتر باید از همین پایگاه باشد" });
    if (String(parent.path ?? "").includes(`/${n.id}/`)) throw validationError({ parent_id: "این جابه‌جایی دور می‌سازد" });
  }
  if (touched(w, ["featured"]) && ids(n.featured).length) {
    const arts = await rowsById(w.tx, sys, "kb_article", ids(n.featured));
    if (arts.some((a) => a.base_id !== n.base_id)) throw validationError({ featured: "مقاله‌های ویژه باید از همین پایگاه باشند" });
  }
  if (touched(w, ["parent_id", "read_mode", "read_users", "read_groups", "read_units", "units_tree", "managed_by_groups", "base_id"])) Object.assign(n, await compileCategory(w.tx, w.ctx, n, parent));
}

async function categoryAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op !== "update" && w.op !== "transition") return;
  if (!["path", "c_all", "c_users", "c_groups", "c_units", "m_groups"].some((f) => w.changed.has(f))) return;
  // children follow their parent (each one's own hook carries it further down)
  const sys = sysOf(w.ctx);
  const kids = await liveRows(w.tx, sys, "kb_category", { f: "parent_id", op: "eq", v: w.row.id }, { limit: 500 });
  for (const k of kids) await updateIn(w.tx, sys, "kb_category", k.id, await compileCategory(w.tx, sys, k, w.row), { trusted: true, keepVersion: true });
}

// ---------------------------------------------------------------------------------------------------------------
// kb_article

/** The base's approvers (users, members of the approver groups, else of the managers' group), active, minus `exclude`. */
export async function approversFor(tx: Tx, ctx: Ctx, base: Row, exclude: (string | null | undefined)[] = []): Promise<string[]> {
  const groups = ids(base.approver_groups).length ? ids(base.approver_groups) : ids([base.manager_group_id]);
  const people = uniq([...ids(base.approvers), ...(await groupMembers(tx, ctx, groups))]);
  const active = await activeMembers(tx, ctx.org.id, people);
  return people.filter((p) => active.has(p) && !exclude.includes(p)).slice(0, 50);
}

async function articleBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    if (!isSys(w.ctx) && w.prev?.state !== "trashed") throw conflict("مقاله را اول به سطل بازیافت ببرید");
    return;
  }
  const n = w.next;
  const sys = sysOf(w.ctx);
  const base = await baseOf(w.tx, w.ctx, n.base_id);
  if (!base) throw validationError({ base_id: "پایگاه دانش پیدا نشد" });
  const category = n.category_id ? await categoryOf(w.tx, w.ctx, n.category_id) : null;
  if (n.category_id && (!category || category.base_id !== n.base_id)) throw validationError({ category_id: "دسته باید از همین پایگاه باشد" });
  if (!isSys(w.ctx) && (w.op === "create" || w.changed.has("base_id") || w.changed.has("category_id")) && !contributesTo(w.ctx, base, { category, article: w.prev })) {
    throw forbidden("اجازهٔ نوشتن در این پایگاه دانش را ندارید");
  }
  if (w.op === "create" && base.state === "archived") throw conflict("این پایگاه بایگانی شده است");
  if (touched(w, ["template_id", "base_id"]) && n.template_id && ids(base.allowed_templates).length && !ids(base.allowed_templates).includes(n.template_id)) {
    throw validationError({ template_id: "این قالب در این پایگاه مجاز نیست" });
  }
  if (n.replaced_by && n.replaced_by === n.id) throw validationError({ replaced_by: "مقاله جایگزین خودش نیست" });
  if (n.translation_of && n.translation_of === n.id) throw validationError({ translation_of: "مقاله ترجمهٔ خودش نیست" });
  if (n.article_type === "link" && touched(w, ["article_type", "external_url"]) && !n.external_url && w.op !== "create") throw validationError({ external_url: "نشانی منبع بیرونی را بنویسید" });
  n.confidential = isInternalArticle(n);
  n.workspace_id = base.workspace_id ?? null;
  if (touched(w, ["read_units", "units_tree"])) n.r_units = await expandUnits(w.tx, w.ctx, n.read_units, n.units_tree !== false);
  if (touched(w, ["deny_units"])) n.x_units = await expandUnits(w.tx, w.ctx, n.deny_units, true);

  const now = new Date().toISOString();
  if (entering(w, "retired")) {
    n.retired_at = now;
    n.retire_at = null;
    n.reviewer_ids = [];
  }
  if (leaving(w, "retired") && n.state !== "trashed") n.retired_at = null;
  if (entering(w, "trashed")) n.trashed_at = now;
  if (leaving(w, "trashed")) n.trashed_at = null;
  if (entering(w, "pending_retirement")) n.reviewer_ids = await approversFor(w.tx, sys, base, [w.ctx.actor === "system" ? null : w.ctx.user.id]);
  if (leaving(w, "pending_retirement")) n.reviewer_ids = [];
  if (n.replaced_by && touched(w, ["replaced_by"])) {
    const r = await articleOf(w.tx, w.ctx, n.replaced_by);
    if (!r || ["retired", "trashed"].includes(r.state)) throw validationError({ replaced_by: "مقالهٔ جایگزین باید منتشرشده باشد" });
  }
}

async function articleAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  if (entering(w, "retired") || entering(w, "trashed")) {
    // an open draft goes with it
    const open = await liveRows(w.tx, sys, "kb_version", { and: [{ f: "article_id", op: "eq", v: w.row.id }, { f: "state", op: "eq", v: "draft" }] }, { limit: 5 });
    for (const v of open) await transitionIn(w.tx, sys, "kb_version", v.id, "discarded", {}, { trusted: true });
    const { def } = await defFor(sys, "kb_article", w.tx);
    const body = entering(w, "retired") ? `مقاله بازنشسته شد${w.row.retire_reason ? `: ${String(w.row.retire_reason).slice(0, 300)}` : "."}` : "مقاله به سطل بازیافت رفت.";
    await addJournalIn(w.tx, sys, def, w.row, { kind: "system", visibility: "internal", body }, { trusted: true, author: w.ctx.actor === "system" ? null : w.ctx.user.id });
  }
  if (w.op === "create" || ["state", "base_id", "category_id"].some((f) => w.changed.has(f))) {
    await enqueue(w.tx, { kind: "kb.counts", orgId: w.ctx.org.id, payload: {}, dedupeKey: "kb.counts", delayMs: 5_000 });
  }
}

const articleGuards = {
  async kb_can_retire(w: WriteArgs) {
    if (isSys(w.ctx) || isKbApprover(w.ctx)) return null;
    const base = await baseOf(w.tx, w.ctx, w.next.base_id);
    return base?.retire_approval && w.prev?.state !== "pending_retirement" ? "بازنشستگی در این پایگاه تأیید می‌خواهد؛ «درخواست بازنشستگی» را بزنید" : null;
  },
  async kb_can_trash(w: WriteArgs) {
    if (isSys(w.ctx)) return null;
    const base = await baseOf(w.tx, w.ctx, w.next.base_id);
    return contributesTo(w.ctx, base, { article: w.prev }) ? null : "اجازهٔ حذف این مقاله را ندارید";
  },
  kb_restore_draft(w: WriteArgs) {
    return w.prev?.published_version_id ? "این مقاله پیش‌تر منتشر شده است؛ به «بازنشسته» بازمی‌گردد" : null;
  },
  kb_restore_retired(w: WriteArgs) {
    return w.prev?.published_version_id ? null : "این مقاله هرگز منتشر نشده است؛ به «پیش‌نویس» بازمی‌گردد";
  },
};

// ---------------------------------------------------------------------------------------------------------------
// kb_version

const CONTENT = ["title", "summary", "body", "internal_body", "keywords", "tags"];

/** The checks a draft carries (quality score, blocking items, sensitive data in what reaches requesters). */
async function versionChecks(tx: Tx, ctx: Ctx, v: Row, article: Row, base: Row | null) {
  const template = article.template_id ? await liveRow(tx, sysOf(ctx), "kb_template", article.template_id) : null;
  const sections = template ? cleanSections(template.sections) : [];
  const external = !!base && base.kind !== "internal" && !isInternalArticle(article);
  const r = qualityChecks({ title: v.title, summary: v.summary, body: v.body, internal_body: v.internal_body, article_type: article.article_type, keywords: v.keywords, sections, external });
  return { report: r, sections, external };
}

async function versionBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    if (!isSys(w.ctx) && w.prev?.state !== "draft") throw conflict("فقط پیش‌نویس حذف می‌شود");
    return;
  }
  const n = w.next;
  const sys = sysOf(w.ctx);
  const article = await articleOf(w.tx, w.ctx, n.article_id);
  if (!article) throw validationError({ article_id: "مقاله پیدا نشد" });
  const base = await baseOf(w.tx, w.ctx, article.base_id);
  if (w.op === "create") {
    if (["retired", "trashed"].includes(article.state) && !isSys(w.ctx)) throw conflict("مقالهٔ بازنشسته یا حذف‌شده را اول بازگردانید");
    if (!isSys(w.ctx)) {
      const category = article.category_id ? await categoryOf(w.tx, w.ctx, article.category_id) : null;
      if (!contributesTo(w.ctx, base, { category, article })) throw forbidden("اجازهٔ ویرایش این مقاله را ندارید");
      if (article.governance === "compliance" && !(article.owner_id === w.ctx.user.id || article.author_id === w.ctx.user.id || isKbAdmin(w.ctx) || (base && (base.k_users ?? []).includes(w.ctx.user.id)))) {
        throw forbidden("این مقاله انطباق‌محور است؛ فقط مالک و مسئولان پایگاه آن را ویرایش می‌کنند");
      }
    }
    const open = await liveRows(w.tx, sys, "kb_version", { and: [{ f: "article_id", op: "eq", v: article.id }, { f: "state", op: "in", v: ["draft", "in_review", "scheduled"] }] }, { limit: 1 });
    if (open.length) throw conflict("این مقاله پیش‌نویس باز دارد؛ همان را ادامه دهید");
  } else if (!isSys(w.ctx) && w.prev?.state !== "draft" && CONTENT.some((f) => w.changed.has(f))) {
    throw conflict(w.prev?.state === "in_review" ? "نسخهٔ در بازبینی ویرایش نمی‌شود؛ اول آن را به پیش‌نویس برگردانید" : "این نسخه دیگر ویرایش نمی‌شود؛ پیش‌نویس تازه بسازید");
  }
  if (touched(w, ["change_kind"]) && (w.op === "create" || (w.prev?.state === "draft" && n.state === "draft"))) {
    const v = nextVersion(Number(article.major ?? 0), Number(article.minor ?? 0), n.change_kind === "major" ? "major" : "minor", !!article.published_version_id);
    n.major = v.major;
    n.minor = v.minor;
    n.version_label = v.label;
  }
  if (touched(w, CONTENT)) {
    n.content_hash = contentHash(n);
    n.word_count = wordCount(String(n.body ?? "")) + wordCount(String(n.internal_body ?? ""));
    const { report } = await versionChecks(w.tx, w.ctx, n, article, base);
    n.checks = { score: report.score, blocking: report.blocking.map((b) => b.key), sensitive: report.findings.length, unsafe: report.unsafe.length, words: report.words };
  }
  if (entering(w, "in_review")) {
    const author = n.author_id ?? null;
    const lvl = base?.kcs_enabled && author ? await licenceLevel(w.tx, sys, author, base.id) : null;
    let needs = !!base?.publish_approval || article.article_type === "procedure" || article.governance === "compliance";
    if (base?.kcs_enabled) {
      if (lvl === "publisher" || lvl === "coach" || lvl === "kde") needs = article.article_type === "procedure" || article.governance === "compliance";
      else if (lvl === "candidate") needs = true;
    }
    n.needs_approval = needs;
    n.approval_mode = base?.approval_mode ?? "any";
    n.reviewer_ids = needs && base ? await approversFor(w.tx, sys, base, [author]) : [];
    n.submitted_at = new Date().toISOString();
    n.submitted_by = isSys(w.ctx) ? n.submitted_by ?? null : w.ctx.user.id;
  }
  if (leaving(w, "in_review") && n.state === "draft") {
    n.reviewer_ids = [];
    n.needs_approval = false;
  }
}

async function versionAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  const v = w.row;
  const article = await articleOf(w.tx, sys, v.article_id);
  if (!article) return;
  const by = isSys(w.ctx) ? null : w.ctx.user.id;
  if (w.op === "create") {
    await updateIn(w.tx, sys, "kb_article", article.id, { draft_version_id: v.id, has_draft: !!article.published_version_id }, { trusted: true, keepVersion: true });
    return;
  }
  if (entering(w, "in_review")) {
    if (!v.needs_approval) {
      await publishIn(w.tx, w.ctx, v.id, by);
      return;
    }
    const patch: Row = { reviewer_ids: v.reviewer_ids ?? [] };
    await updateIn(w.tx, sys, "kb_article", article.id, patch, { trusted: true, keepVersion: true });
    if (!article.published_version_id && article.state === "draft") await transitionIn(w.tx, sys, "kb_article", article.id, "in_review", {}, { trusted: true });
    return;
  }
  if (leaving(w, "in_review") || leaving(w, "scheduled")) {
    if (v.state === "draft") {
      await updateIn(w.tx, sys, "kb_article", article.id, { reviewer_ids: [] }, { trusted: true, keepVersion: true });
      if (!article.published_version_id && ["in_review", "scheduled"].includes(article.state)) await transitionIn(w.tx, sys, "kb_article", article.id, "draft", {}, { trusted: true });
    }
  }
  if (entering(w, "discarded") && article.draft_version_id === v.id) {
    await updateIn(w.tx, sys, "kb_article", article.id, { draft_version_id: null, has_draft: false }, { trusted: true, keepVersion: true, allowLocked: true });
  }
}

const versionGuards = {
  async kb_can_submit(w: WriteArgs) {
    const n = w.next;
    const article = await articleOf(w.tx, w.ctx, n.article_id);
    if (!article) return "مقاله پیدا نشد";
    const base = await baseOf(w.tx, w.ctx, article.base_id);
    if (!String(n.title ?? "").trim()) return "عنوان را بنویسید";
    const { report, sections, external } = await versionChecks(w.tx, w.ctx, n, article, base);
    const missing = missingSections(sections, String(n.body ?? ""), String(n.internal_body ?? ""));
    if (missing.length) return `بخش‌های الزامی قالب خالی‌اند: ${missing.map((m) => `«${m.label}»`).join("، ")}`;
    if (external) {
      const found = scanSensitive(`${n.title}\n${n.summary ?? ""}\n${n.body ?? ""}`);
      if (found.length) return `در متنی که درخواست‌کنندگان می‌بینند ${[...new Set(found.map((f) => f.label))].join("، ")} هست؛ آن را حذف کنید یا به بخش داخلی ببرید`;
    }
    if (report.blocking.length) return report.blocking.map((b) => b.hint ?? b.label).join("؛ ");
    if (n.needs_approval && !(n.reviewer_ids ?? []).length) return "این پایگاه تأییدکننده‌ای جز نویسنده ندارد؛ از مدیر پایگاه بخواهید تأییدکننده تعیین کند";
    return null;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// kb_feedback, kb_task

/** The article's vote, rating and flag counters, from its feedback (as the system). */
export async function recountFeedback(tx: Tx, ctx: Ctx, articleId: string): Promise<void> {
  const sys = sysOf(ctx);
  const rows = await liveRows(tx, sys, "kb_feedback", { f: "article_id", op: "eq", v: articleId }, { limit: 50_000 });
  const yes = rows.filter((r) => r.kind === "helpful").length;
  const no = rows.filter((r) => r.kind === "not_helpful").length;
  const ratings = rows.filter((r) => r.kind === "rating" && Number(r.rating) > 0).map((r) => Number(r.rating));
  const flags = rows.filter((r) => r.kind === "flag" && (r.state === "open" || r.state === "in_task")).length;
  const avg = ratings.length ? (ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(2) : null;
  const a = await articleOf(tx, sys, articleId);
  if (!a) return;
  if (a.helpful_yes === yes && a.helpful_no === no && Number(a.rating_count ?? 0) === ratings.length && Number(a.open_flags ?? 0) === flags && String(a.rating_avg ?? "") === String(avg ?? "")) return;
  await updateIn(tx, sys, "kb_article", articleId, { helpful_yes: yes, helpful_no: no, rating_count: ratings.length, rating_avg: avg, open_flags: flags }, { trusted: true, keepVersion: true, allowLocked: true });
}

async function feedbackBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.kind === "flag" && !n.reason) throw validationError({ reason: "دلیل گزارش را انتخاب کنید" });
  if (n.kind === "rating" && !(Number(n.rating) >= 1 && Number(n.rating) <= 5)) throw validationError({ rating: "امتیازی از ۱ تا ۵ بدهید" });
}

async function feedbackAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "create" || w.changed.has("state") || w.changed.has("kind") || w.changed.has("rating") || w.op === "delete") await recountFeedback(w.tx, w.ctx, String((w.row ?? w.prev)!.article_id));
}

async function taskBefore(w: WriteArgs): Promise<void> {
  if (w.op !== "create") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  const article = n.article_id ? await articleOf(w.tx, sys, n.article_id) : null;
  const base = article ? await baseOf(w.tx, sys, article.base_id) : null;
  if (!n.assignment_group_id) n.assignment_group_id = article?.owner_group_id ?? base?.manager_group_id ?? (await kbConfig(w.tx, sys)).default_group_id ?? null;
  if (!n.assigned_to && !n.assignment_group_id && article?.owner_id) n.assigned_to = article.owner_id;
  if (!String(n.short_description ?? "").trim()) n.short_description = article ? `${String(article.title).slice(0, 160)} — ${n.kind}` : "کار دانش";
}

async function taskAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "create" || w.op === "delete" || !w.changed.has("state")) return;
  const cat = stateCategory(w.def.states, w.row.state);
  if (cat !== "resolved" && cat !== "closed" && cat !== "canceled") return;
  const sys = sysOf(w.ctx);
  const fb = await liveRows(w.tx, sys, "kb_feedback", { and: [{ f: "task_id", op: "eq", v: w.row.id }, { f: "state", op: "in", v: ["open", "in_task"] }] }, { limit: 1000 });
  for (const f of fb) await updateIn(w.tx, sys, "kb_feedback", f.id, { state: cat === "canceled" ? "dismissed" : "addressed" }, { trusted: true });
}

// ---------------------------------------------------------------------------------------------------------------
// snippets, blocks, trees; definitions

function visibilityBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  w.next.confidential = w.next.visibility === "internal";
}

async function snippetBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  visibilityBefore(w);
  if (isSys(w.ctx) || w.trusted) return;
  if (w.op === "create" || w.changed.has("base_id")) {
    const base = await baseOf(w.tx, w.ctx, w.next.base_id);
    if (!contributesTo(w.ctx, base)) throw forbidden("اجازهٔ نوشتن در این پایگاه دانش را ندارید");
  }
}

async function blockAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") return;
  if (w.row.state === "published" && (entering(w, "published") || w.changed.has("body") || w.changed.has("visibility"))) {
    await enqueue(w.tx, { kind: "kb.block_hosts", orgId: w.ctx.org.id, payload: { block_id: w.row.id }, dedupeKey: `kb.block_hosts:${w.row.id}`, delayMs: 2_000 });
  }
}

function treeBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  visibilityBefore(w);
  const nodes = w.next.nodes;
  if (nodes !== null && nodes !== undefined) {
    if (!Array.isArray(nodes)) throw validationError({ nodes: "گره‌ها باید فهرست باشد" });
    const known = new Set(nodes.map((x: Row) => String(x?.id ?? "")));
    for (const x of nodes as Row[]) {
      if (!x || !x.id) throw validationError({ nodes: "هر گره شناسه می‌خواهد" });
      for (const o of Array.isArray(x.options) ? x.options : []) if (o?.next && !known.has(String(o.next))) throw validationError({ nodes: `گزینهٔ «${o.label ?? ""}» به گره ناموجود «${o.next}» می‌رود` });
    }
    if (w.next.start && !known.has(String(w.next.start))) throw validationError({ start: "گره آغاز در فهرست نیست" });
  }
}

async function templateBefore(w: WriteArgs): Promise<void> {
  adminOnly(w, "قالب‌های مقاله");
  if (w.op === "delete") return;
  const problem = sectionsProblem(w.next.sections);
  if (problem) throw validationError({ sections: problem });
  if (Array.isArray(w.next.sections)) w.next.sections = cleanSections(w.next.sections);
}

async function attestationBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const article = await articleOf(w.tx, w.ctx, n.article_id);
  if (!article) throw validationError({ article_id: "مقاله پیدا نشد" });
  if (!isSys(w.ctx) && !w.trusted) {
    const base = await baseOf(w.tx, w.ctx, article.base_id);
    if (!(isKbAdmin(w.ctx) || article.owner_id === w.ctx.user.id || (base && (base.k_users ?? []).includes(w.ctx.user.id)) || managesBase(w.ctx, base))) throw forbidden("کارزار تأیید مطالعه را مالک مقاله یا مدیران پایگاه می‌سازند");
  }
  if (touched(w, ["article_id"]) || entering(w, "active")) n.version_label = article.version_label ?? null;
  if (entering(w, "active") && !["published", "pending_retirement"].includes(article.state)) throw conflict("مقاله باید منتشرشده باشد");
}

async function qualityBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (!isSys(w.ctx) && !w.trusted && n.reviewer_id !== w.ctx.user.id && !isKbAdmin(w.ctx) && w.changed.has("results")) throw forbidden("نتیجهٔ ارزیابی را مربی ثبت می‌کند");
  const cfg = await kbConfig(w.tx, w.ctx);
  const { aqiScore } = await import("@shared/knowledge/logic");
  n.score = aqiScore((n.results ?? {}) as Row, cfg.aqi_items);
}

async function qualityAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !(entering(w, "done") || (w.row.state === "done" && w.changed.has("results")))) return;
  const sys = sysOf(w.ctx);
  const done = await liveRows(w.tx, sys, "kb_quality_review", { and: [{ f: "article_id", op: "eq", v: w.row.article_id }, { f: "state", op: "eq", v: "done" }] }, { order: "t.updated_at desc", limit: 3 });
  const avg = Math.round(done.reduce((s, r) => s + Number(r.score ?? 0), 0) / Math.max(1, done.length));
  await updateIn(w.tx, sys, "kb_article", w.row.article_id, { quality_score: avg }, { trusted: true, keepVersion: true, allowLocked: true });
}

function duplicateBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  const [a, b] = [String(w.next.article_a), String(w.next.article_b)].sort();
  if (a === b) throw validationError({ article_b: "یک مقاله تکراریِ خودش نیست" });
  w.next.pair_key = `${a}:${b}`.slice(0, 80);
}

let installed = false;

export function installKnowledgeHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("kb_base", { beforeWrite: baseBefore, afterWrite: baseAfter });
  registerHooks("kb_category", { beforeWrite: categoryBefore, afterWrite: categoryAfter });
  registerHooks("kb_article", { beforeWrite: articleBefore, afterWrite: articleAfter, guards: articleGuards });
  registerHooks("kb_version", { beforeWrite: versionBefore, afterWrite: versionAfter, guards: versionGuards });
  registerHooks("kb_feedback", { beforeWrite: feedbackBefore, afterWrite: feedbackAfter });
  registerHooks("kb_task", { beforeWrite: taskBefore, afterWrite: taskAfter });
  registerHooks("kb_snippet", { beforeWrite: snippetBefore });
  registerHooks("kb_block", { beforeWrite: visibilityBefore, afterWrite: blockAfter });
  registerHooks("kb_decision_tree", { beforeWrite: treeBefore });
  registerHooks("kb_template", { beforeWrite: templateBefore });
  for (const [t, label] of [["kb_glossary", "واژه‌نامه"], ["kb_search_rule", "قاعده‌های جست‌وجو"], ["kb_domain", "حوزه‌های دانش"], ["kb_licence", "مجوزهای KCS"]] as const) {
    registerHooks(t, { beforeWrite: (w) => adminOnly(w, label) });
  }
  registerHooks("kb_attestation", { beforeWrite: attestationBefore });
  registerHooks("kb_quality_review", { beforeWrite: qualityBefore, afterWrite: qualityAfter });
  registerHooks("kb_duplicate", { beforeWrite: duplicateBefore });
}

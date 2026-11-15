// Quality of the knowledge base, rule-based (the AI layer adds its own judges through ai.ts):
//   · the checks of a draft for its author (KB-071/074/079): the quality rubric, sensitive data in what reaches
//     requesters, unsafe commands, empty required sections and near-duplicates among the published articles
//   · health (KB-057/075): freshness, feedback, use, quality and integrity per article, with the next best action
//   · duplicates (KB-073): word shingles over the published articles of a base, an inverted index for candidates,
//     containment above the settings' threshold → «مقاله‌های احتمالاً تکراری» for a knowledge manager to merge or dismiss
//   · integrity (KB-058): missing images, images without description, links to retired or missing articles, very long
//     articles → one integrity task per article
//   · sampling for the content standard checklist (KB-055): each month a few published articles per author go to a
//     coach as AQI reviews
//   · gaps (KB-072): repeated searches without results, and resolved records in one category without any article
import type { KbVersionCheck } from "@shared/knowledge/api";
import { cleanSections, healthScore, imageRefs, isInternalArticle, linkRefs, missingSections, qualityChecks, shingles, similarity, wordCount } from "@shared/knowledge/logic";
import type { Ctx } from "../../context";
import { condEnv, createIn, get, orgSchema, readable, updateIn } from "../../engine";
import { addDaysISO, baseOf, daysBetween, kbConfig, liveRow, liveRows, openKbTaskIn, sysOf, todayIn, uniq, type Row } from "./common";
import { lockKey } from "../../db";
import { queryStats, viewCounts } from "./events";
import { memberCtx } from "../../access/service";
import { coachesOf } from "./kcs";
import { reportGap, topicSignature } from "./feedback";

/** The checks of a version for its author (the caller must read it). */
export async function checkVersion(ctx: Ctx, versionId: string): Promise<KbVersionCheck> {
  const v = (await get(ctx, "kb_version", versionId)).row as Row;
  const sys = sysOf(ctx);
  const article = await liveRow(ctx.db, sys, "kb_article", v.article_id);
  const base = article ? await baseOf(ctx.db, sys, article.base_id) : null;
  const template = article?.template_id ? await liveRow(ctx.db, sys, "kb_template", article.template_id) : null;
  const sections = template ? cleanSections(template.sections) : [];
  const external = !!base && base.kind !== "internal" && !!article && !isInternalArticle(article);
  const r = qualityChecks({ title: v.title, summary: v.summary, body: v.body, internal_body: v.internal_body, article_type: article?.article_type, keywords: v.keywords, sections, external });
  const missing = missingSections(sections, String(v.body ?? ""), String(v.internal_body ?? "")).map((m) => m.label);
  const cfg = await kbConfig(ctx.db, sys);
  const duplicates: KbVersionCheck["duplicates"] = [];
  if (article && String(v.body ?? "").length > 40) {
    const others = (await liveRows(ctx.db, ctx, "kb_article", { and: [{ f: "base_id", op: "eq", v: article.base_id }, { f: "state", op: "in", v: ["published", "pending_retirement"] }] }, { limit: 1500 })).filter((o) => o.id !== article.id);
    for (const o of others) {
      const s = similarity({ title: v.title, body: String(v.body ?? "") }, { title: o.title, body: String(o.body ?? "") });
      if (s >= cfg.duplicate_threshold - 10) duplicates.push({ id: o.id, number: o.number ?? null, title: o.title, similarity: s });
    }
    duplicates.sort((a, b) => b.similarity - a.similarity);
    duplicates.splice(5);
  }
  return { score: r.score, items: r.items, findings: r.findings, unsafe: r.unsafe, words: r.words, readability: r.readability, missing, external, duplicates };
}

/** Health and next action of every live article (nightly, as the system). */
export async function computeHealth(sys: Ctx): Promise<number> {
  const cfg = await kbConfig(sys.db, sys);
  const today = todayIn(sys);
  const arts = await liveRows(sys.db, sys, "kb_article", { f: "state", op: "in", v: ["published", "pending_retirement"] }, { limit: 20_000 });
  if (!arts.length) return 0;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const views = await viewCounts(sys.db, sys.org.id, since);
  const reuse = new Map<string, number>();
  const rows = await sys.db.query<{ to_id: string; n: string | number }>(
    `select to_id, count(distinct from_id) as n from sm_links where org_id = $1 and to_table = 'kb_article' and kind in ('kb_solved_by', 'kb_workaround') and deleted_at is null and created_at > $2 group by to_id`,
    [sys.org.id, since],
  );
  for (const r of rows) reuse.set(r.to_id, Number(r.n));
  const dups = new Set((await liveRows(sys.db, sys, "kb_duplicate", { f: "state", op: "eq", v: "proposed" }, { limit: 5000 })).flatMap((d) => [d.article_a, d.article_b]));
  let changed = 0;
  for (const a of arts) {
    const h = healthScore({
      daysToExpiry: a.valid_to ? daysBetween(today, String(a.valid_to)) : null,
      daysPastReview: a.review_at ? daysBetween(String(a.review_at), today) : null,
      helpfulYes: Number(a.helpful_yes ?? 0),
      helpfulNo: Number(a.helpful_no ?? 0),
      views90: views.get(a.id) ?? 0,
      reuse90: reuse.get(a.id) ?? 0,
      openFlags: Number(a.open_flags ?? 0),
      duplicate: dups.has(a.id),
      aqi: a.quality_score === null || a.quality_score === undefined ? null : Number(a.quality_score),
      quality: null,
      translationStale: !!a.translation_stale,
      daysSinceUse: a.last_used_at ? daysBetween(String(a.last_used_at).slice(0, 10), today) : a.published_at ? daysBetween(String(a.published_at).slice(0, 10), today) : null,
    }, cfg.stale_days);
    if (a.health_score === h.score && a.next_action === h.next_action) continue;
    await sys.write((tx) => updateIn(tx, sys, "kb_article", a.id, { health_score: h.score, next_action: h.next_action }, { trusted: true, keepVersion: true, allowLocked: true }));
    changed++;
  }
  return changed;
}

/** Near-duplicate pairs among the published articles of each base (nightly). */
export async function findDuplicates(sys: Ctx): Promise<number> {
  const cfg = await kbConfig(sys.db, sys);
  const arts = await liveRows(sys.db, sys, "kb_article", { f: "state", op: "in", v: ["published", "pending_retirement"] }, { limit: 5000 });
  const byBase = new Map<string, Row[]>();
  for (const a of arts) byBase.set(a.base_id, [...(byBase.get(a.base_id) ?? []), a]);
  const known = new Set((await liveRows(sys.db, sys, "kb_duplicate", null, { limit: 20_000 })).map((d) => d.pair_key));
  let created = 0;
  for (const list of byBase.values()) {
    if (list.length < 2) continue;
    const sets = list.map((a) => shingles(`${a.title}\n${a.body ?? ""}`));
    const index = new Map<number, number[]>();
    sets.forEach((s, i) => s.forEach((h) => index.set(h, [...(index.get(h) ?? []), i])));
    const overlap = new Map<string, number>();
    for (const holders of index.values()) {
      if (holders.length < 2 || holders.length > 50) continue;
      for (let x = 0; x < holders.length; x++) for (let y = x + 1; y < holders.length; y++) {
        const k = `${holders[x]}:${holders[y]}`;
        overlap.set(k, (overlap.get(k) ?? 0) + 1);
      }
    }
    for (const [k, n] of overlap) {
      const [i, j] = k.split(":").map(Number);
      if (n / Math.max(1, Math.min(sets[i].size, sets[j].size)) < 0.3) continue;
      const s = similarity({ title: list[i].title, body: String(list[i].body ?? "") }, { title: list[j].title, body: String(list[j].body ?? "") });
      if (s < cfg.duplicate_threshold) continue;
      const [a, b] = [list[i].id, list[j].id].sort();
      if (known.has(`${a}:${b}`)) continue;
      known.add(`${a}:${b}`);
      await sys.write((tx) => createIn(tx, sys, "kb_duplicate", { article_a: a, article_b: b, similarity: s, method: "shingles" }, { trusted: true }));
      created++;
    }
  }
  return created;
}

/** Integrity findings of published articles → one open integrity task per article (weekly). */
export async function integrityChecks(sys: Ctx): Promise<number> {
  const arts = await liveRows(sys.db, sys, "kb_article", { f: "state", op: "in", v: ["published", "pending_retirement"] }, { limit: 5000 });
  if (!arts.length) return 0;
  const numbers = new Map((await liveRows(sys.db, sys, "kb_article", null, { limit: 50_000 })).map((a) => [String(a.number), a.state]));
  const atts = await sys.db.query<{ record_id: string; id: string }>(`select record_id, id from sm_attachments where org_id = $1 and table_key = 'kb_article' and deleted_at is null`, [sys.org.id]);
  const attBy = new Map<string, Set<string>>();
  for (const r of atts) attBy.set(r.record_id, (attBy.get(r.record_id) ?? new Set()).add(r.id));
  let created = 0;
  for (const a of arts) {
    const text = `${a.body ?? ""}\n${a.internal_body ?? ""}`;
    const issues: string[] = [];
    for (const img of imageRefs(text)) {
      if (img.attachment && !attBy.get(a.id)?.has(img.attachment)) issues.push("تصویری که در متن آمده در پیوست‌ها نیست");
      if (!img.attachment) issues.push(`تصویر از نشانی بیرونی (${img.src.slice(0, 60)}) نمایش داده نمی‌شود`);
      if (!img.alt) issues.push("تصویر بدون متن جایگزین");
    }
    for (const n of linkRefs(text).articles) {
      const st = numbers.get(n);
      if (!st) issues.push(`پیوند به مقالهٔ ناموجود ${n}`);
      else if (st === "retired" || st === "trashed") issues.push(`پیوند به مقالهٔ بازنشستهٔ ${n}`);
    }
    if (wordCount(text) > 4000) issues.push("مقاله بسیار بلند است؛ آن را به چند مقاله بشکنید");
    const unique = uniq(issues);
    if (!unique.length) continue;
    const made = await sys.write(async (tx) => {
      if (await openKbTaskIn(tx, sys, "integrity", a.id, { f: "article_id", op: "eq", v: a.id })) return false;
      await createIn(tx, sys, "kb_task", { kind: "integrity", article_id: a.id, priority: "4", short_description: `بررسی یکپارچگی ${a.number}: ${String(a.title).slice(0, 140)}`, description: unique.map((x) => `- ${x}`).join("\n") }, { trusted: true });
      return true;
    });
    if (made) created++;
  }
  return created;
}

/** Monthly AQI samples: a few published articles of each author for a coach. */
export async function sampleAqi(sys: Ctx): Promise<number> {
  const cfg = await kbConfig(sys.db, sys);
  if (cfg.aqi_per_author <= 0) return 0;
  const today = todayIn(sys);
  const period = today.slice(0, 7);
  const existing = await liveRows(sys.db, sys, "kb_quality_review", { f: "period", op: "eq", v: period }, { limit: 10_000 });
  if (existing.length) return 0;
  const since = `${addDaysISO(today, -90)}T00:00:00Z`;
  const arts = await liveRows(sys.db, sys, "kb_article", { and: [{ f: "state", op: "eq", v: "published" }, { f: "published_at", op: "gte", v: since }] }, { limit: 5000 });
  const byAuthor = new Map<string, Row[]>();
  for (const a of arts) if (a.author_id) byAuthor.set(a.author_id, [...(byAuthor.get(a.author_id) ?? []), a]);
  let created = 0;
  for (const [author, list] of byAuthor) {
    const pick = [...list].sort((x, y) => String(x.id).localeCompare(String(y.id))).slice(0, cfg.aqi_per_author);
    for (const a of pick) {
      const base = await baseOf(sys.db, sys, a.base_id);
      // the first coach (else the base's owner) who reads the article: a coach licensed for every base may not
      const candidates = [...(await coachesOf(sys.db, sys, a.base_id)), ...(base?.owner_id ? [base.owner_id] : [])].filter((c, i, all) => c !== author && all.indexOf(c) === i);
      let reviewer: string | null = null;
      for (const c of candidates) {
        const mctx = await memberCtx(sys.cfg, sys.org.id, c).catch(() => null);
        if (mctx && (await liveRow(sys.db, mctx, "kb_article", a.id))) {
          reviewer = c;
          break;
        }
      }
      const made = await sys.write(async (tx) => {
        // the month's review of the article looked for again under its key: two samples at once make it once
        await lockKey(tx, `kb.aqi:${a.id}:${period}`);
        const [again] = await liveRows(tx, sys, "kb_quality_review", { and: [{ f: "article_id", op: "eq", v: a.id }, { f: "period", op: "eq", v: period }] }, { limit: 1 });
        if (again) return false;
        await createIn(tx, sys, "kb_quality_review", { article_id: a.id, version_label: a.version_label ?? null, period, author_id: author, reviewer_id: reviewer, results: {} }, { trusted: true });
        // the title only for a reviewer who reads it; the managers' group gets the article's number
        const label = reviewer ? String(a.title).slice(0, 140) : String(a.number ?? "");
        await createIn(tx, sys, "kb_task", { kind: "aqi", article_id: a.id, priority: "4", assigned_to: reviewer, assignment_group_id: reviewer ? null : base?.manager_group_id ?? cfg.default_group_id, short_description: `ارزیابی کیفیت (${period}): ${label}` }, { trusted: true });
        return true;
      });
      if (made) created++;
    }
  }
  return created;
}

/** Gaps from the event stream and from resolved records without articles (daily). */
export async function detectGaps(sys: Ctx): Promise<number> {
  let n = 0;
  for (const z of await queryStats(sys.db, sys.org.id, 30, { zeroOnly: true, limit: 50 })) {
    if (z.zero < 3 || z.clicks > 0) continue;
    const sig = topicSignature(z.query);
    if (!sig) continue;
    const [g] = await liveRows(sys.db, sys, "kb_gap", { f: "signature", op: "eq", v: sig }, { limit: 1 });
    if (g) {
      if (Number(g.demand ?? 0) !== z.zero && ["open", "in_progress"].includes(g.state)) await sys.write((tx) => updateIn(tx, sys, "kb_gap", g.id, { demand: z.zero, score: z.zero, last_seen_at: z.last_at }, { trusted: true, keepVersion: true }));
      continue;
    }
    await reportGap(sys, { text: z.query, kind: "zero_result" });
    n++;
  }
  // resolved incidents of the last 30 days without a knowledge link, by category (five or more)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const schema = await orgSchema(sys);
  const idef = schema.def("incident");
  let rows: { category: string | null; n: string | number; sample: string[] }[] = [];
  if (idef) {
    const env = await condEnv(sys);
    const params: unknown[] = [];
    const where = readable(sys, idef, "i", params, env);
    params.push(since);
    rows = await sys.db.query(
      `select i.category, count(*) as n, (array_agg(i.number order by i.resolved_at desc))[1:5] as sample from ${idef.table} i
        where ${where} and i.resolved_at > $${params.length} and i.category is not null
          and not exists (select 1 from sm_links l where l.org_id = i.org_id and l.from_id = i.id and l.to_table = 'kb_article' and l.deleted_at is null)
        group by i.category having count(*) >= 5 order by n desc limit 20`,
      params,
    );
  }
  for (const r of rows) {
    const title = `رخدادهای حل‌شدهٔ بی‌مقاله در دستهٔ «${r.category}»`;
    const sig = `no_article:${r.category}`;
    const [g] = await liveRows(sys.db, sys, "kb_gap", { f: "signature", op: "eq", v: sig }, { limit: 1 });
    const cfg = await kbConfig(sys.db, sys);
    await sys.write((tx) =>
      g
        ? updateIn(tx, sys, "kb_gap", g.id, { demand: Number(r.n), score: Number(r.n), last_seen_at: new Date().toISOString(), samples: (r.sample ?? []).map((number) => ({ number })) }, { trusted: true, keepVersion: true })
        : createIn(tx, sys, "kb_gap", { title, kind: "no_article", signature: sig, demand: Number(r.n), score: Number(r.n), last_seen_at: new Date().toISOString(), samples: (r.sample ?? []).map((number) => ({ number })), group_id: cfg.default_group_id }, { trusted: true }),
    );
    if (!g) n++;
  }
  return n;
}

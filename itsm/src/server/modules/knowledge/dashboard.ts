// What the knowledge screens summarise (KB-049, KB-063, KB-065, KB-052, KB-077), always with the caller's access:
//   · the knowledge home — bases and categories with their readable article counts, featured, popular, new and recently
//     viewed articles, and what waits for the caller (reviews, tasks, acknowledgements, drafts)
//   · the dashboard — inventory by state, base and type, freshness, flags, the best and worst articles, search
//     analytics, deflection, feedback, reuse and link rate, translations, the AQI (only the caller's own reviews: the
//     results belong to the author and the coach), 90/0 of captured articles and the readiness of each base
//   · the knowledge manager's workspace — insight cards, queues and the built-in knowledge routines
// Counts of records come from `aggregate`/`countRows` with the caller's context; event figures from the stream.
import { createHash, randomUUID } from "node:crypto";
import type { KbCard, KbCount, KbDashboard, KbHome, KbWorkspace } from "@shared/knowledge/api";
import type { TableDef } from "@shared/model/types";
import { ARTICLE_TYPES, LIVE_STATES } from "@shared/tables/knowledge";
import { scanSensitive } from "@shared/knowledge/logic";
import type { Ctx } from "../../context";
import { aggregate, condEnv, orgSchema, readable } from "../../engine";
import { access } from "../../access/provider";
import { forbidden } from "../../http/errors";
import {
  addDaysISO, canAuthor, contributesTo, countRows, holdsInternal, isKbAdmin, isKbApprover, kbConfig, liveRows, managesBase, myGroups, sysOf, todayIn, writesAll, type Row,
} from "./common";
import { cardOf, cardsByIds, labelsOf } from "./search";
import { eventTotals, queryStats, recentlyViewed } from "./events";
import { myAttestations } from "./attest";
import { knowledgeAiCapabilities } from "./ai";

const live = { f: "state", op: "in" as const, v: LIVE_STATES };

async function cards(ctx: Ctx, rows: Row[]): Promise<KbCard[]> {
  const labels = await labelsOf(ctx, rows);
  return rows.map((r) => cardOf(r, labels));
}

async function counts(ctx: Ctx, field: string, filter: Record<string, unknown> | null = live): Promise<Map<string, number>> {
  const r = await aggregate(ctx, "kb_article", { filter: filter as never, groupBy: [field], metrics: [{ fn: "count" }], limit: 2000 });
  return new Map(r.rows.map((x) => [String(x.keys[0] ?? ""), Number(x.values.count ?? 0)]));
}

// ---------------------------------------------------------------------------------------------------------------
// Article counts per audience (the knowledge home's bases and categories): cached for a minute per audience set

/** Tables whose rows decide who reads an article (its own rules walk to its base and category). */
const AUDIENCE_TABLES = ["kb_article", "kb_base", "kb_category"];
const COUNT_TTL = 60_000;
const MAX_ENTRIES = 5_000;
/** A member id no row names: «somebody with these groups, units and roles» (never a real user). */
const NOBODY = randomUUID();

interface CountEntry {
  at: number;
  gen: string;
  value: Promise<{ base: Map<string, number>; category: Map<string, number> }>;
}
const countCache = new Map<string, CountEntry>();
const namedCache = new Map<string, { gen: string; users: Promise<Set<string>> }>();
/** Exposed to tests: how many audience counts were computed and how many were served from the cache. */
export const audienceCountStats = { computed: 0, served: 0 };

/**
 * The organisation's knowledge generation: the newest sync revision of articles, bases and categories. Publishing,
 * retiring, moving an article or changing any audience moves it, so every process recounts at once (TTL otherwise).
 */
async function knowledgeGen(ctx: Ctx): Promise<string> {
  const r = await ctx.db.one<{ g: string | null }>(
    `select greatest((select max(rev) from sm_kb_articles where org_id = $1), (select max(rev) from sm_kb_bases where org_id = $1), (select max(rev) from sm_kb_categories where org_id = $1))::text as g`,
    [ctx.org.id],
  );
  return r?.g ?? "0";
}

/** Everyone a person field of the audience tables names (author, owner, reviewers, readers, denied, contributors…). */
function namedUsers(ctx: Ctx, gen: string, defs: TableDef[]): Promise<Set<string>> {
  const hit = namedCache.get(ctx.org.id);
  if (hit && hit.gen === gen) return hit.users;
  const parts: string[] = [];
  for (const def of defs) {
    for (const f of def.fields) {
      if (f.custom) continue;
      if (f.type === "user") parts.push(`select ${f.name}::text as u from ${def.table} where org_id = $1 and ${f.name} is not null`);
      else if (f.type === "users") parts.push(`select jsonb_array_elements_text(${f.name}) as u from ${def.table} where org_id = $1 and jsonb_typeof(${f.name}) = 'array'`);
    }
  }
  const users = parts.length
    ? ctx.db.query<{ u: string }>(`select distinct lower(u) as u from (${parts.join(" union all ")}) x`, [ctx.org.id]).then((rows) => new Set(rows.map((r) => r.u)))
    : Promise.resolve(new Set<string>());
  namedCache.set(ctx.org.id, { gen, users });
  users.catch(() => namedCache.delete(ctx.org.id));
  return users;
}

/**
 * Readable live articles per base and per category, as `ctx` may read them — computed once a minute per AUDIENCE SET and
 * shared by everyone in it. The key is the article read predicate itself (its SQL and every parameter: the person's
 * groups, units, roles, workspaces, field groups, the participant terms that apply), so two people share counts only
 * when the same predicate decides what they read. The person's own id is part of that predicate (author, reviewer,
 * named reader, denied…); it is replaced by an id nobody holds only for people no audience row names and who take part
 * in no knowledge record through a grant — for them it decides nothing, and the counts are computed for «somebody with
 * these groups, units and roles». Anyone named gets counts of their own. The knowledge generation (newest revision of
 * articles, bases, categories) is part of the key: publishing, retiring or an audience change recounts at once.
 */
async function audienceCounts(ctx: Ctx): Promise<{ base: Map<string, number>; category: Map<string, number> }> {
  const schema = await orgSchema(ctx);
  const defs = AUDIENCE_TABLES.map((k) => schema.def(k)).filter((d): d is TableDef => !!d);
  const def = schema.def("kb_article");
  if (!def || ctx.actor === "system") return { base: await counts(ctx, "base_id"), category: await counts(ctx, "category_id") };
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const rule = readable(ctx, def, "t", params, env);
  const gen = await knowledgeGen(ctx);
  const me = ctx.user.id.toLowerCase();
  const grants = access().participations ? await access().participations!(ctx, ctx.db) : new Set<string>();
  const participates = [...grants].some((t) => AUDIENCE_TABLES.includes(t));
  const anonymous = !participates && !(await namedUsers(ctx, gen, defs)).has(me);
  // the person's own id wherever the predicate carries it: in its text, alone, in an array literal ("{…}") or a JSON list
  const own = new RegExp(me.replace(/-/g, "\\-"), "gi");
  const where = anonymous ? rule.replace(own, NOBODY) : rule;
  const bound = anonymous ? params.map((v) => (typeof v === "string" ? v.replace(own, NOBODY) : v)) : params;
  // the walks' table aliases are numbered per compilation (w218, w240…): numbered in order of appearance for the key
  const aliases = new Map<string, number>();
  const canonical = where.replace(/\bw(\d+)\b/g, (_, n: string) => `w#${aliases.get(n) ?? aliases.set(n, aliases.size).get(n)}`);
  const key = createHash("sha256").update(JSON.stringify([ctx.org.id, gen, canonical, bound])).digest("base64url");
  const hit = countCache.get(key);
  if (hit && hit.gen === gen && Date.now() - hit.at < COUNT_TTL) {
    audienceCountStats.served++;
    return hit.value;
  }
  audienceCountStats.computed++;
  const states = bound.length + 1;
  const value = (async () => {
    const rows = await ctx.db.query<{ base_id: string | null; category_id: string | null; n: number }>(
      `select t.base_id::text as base_id, t.category_id::text as category_id, count(*)::int as n from ${def.table} t
       where ${where} and t.state = any($${states}::text[]) group by 1, 2`,
      [...bound, `{${LIVE_STATES.join(",")}}`],
    );
    const base = new Map<string, number>();
    const category = new Map<string, number>();
    for (const r of rows) {
      if (r.base_id) base.set(r.base_id, (base.get(r.base_id) ?? 0) + r.n);
      if (r.category_id) category.set(r.category_id, (category.get(r.category_id) ?? 0) + r.n);
    }
    return { base, category };
  })();
  countCache.set(key, { at: Date.now(), gen, value });
  value.catch(() => countCache.delete(key));
  if (countCache.size > MAX_ENTRIES) countCache.delete(countCache.keys().next().value!);
  return value;
}

/** Forget the cached audience counts (tests; a process that knows knowledge changed may call it too). */
export function clearAudienceCounts(): void {
  countCache.clear();
  namedCache.clear();
}

export async function kbHome(ctx: Ctx): Promise<KbHome> {
  const bases = await liveRows(ctx.db, ctx, "kb_base", { f: "state", op: "eq", v: "active" }, { order: "t.sort_order, t.name", limit: 200 });
  const cats = await liveRows(ctx.db, ctx, "kb_category", { f: "state", op: "eq", v: "active" }, { order: "t.depth, t.sort_order, t.name", limit: 2000 });
  const { base: perBase, category: perCat } = await audienceCounts(ctx);
  // a category's count includes its sub-categories
  const total = new Map<string, number>();
  for (const c of cats) for (const id of String(c.path ?? "").split("/").filter(Boolean)) total.set(id, (total.get(id) ?? 0) + (perCat.get(c.id) ?? 0));
  const featuredIds = [...new Set(cats.flatMap((c) => (Array.isArray(c.featured) ? c.featured : [])))].slice(0, 12);
  const featured = await cards(ctx, await cardsByIds(ctx, featuredIds));
  const popular = await liveRows(ctx.db, ctx, "kb_article", live, { order: "t.view_count desc, t.reuse_count desc, t.published_at desc", limit: 6 });
  const recent = await liveRows(ctx.db, ctx, "kb_article", live, { order: "t.published_at desc nulls last", limit: 6 });
  const viewed = await cards(ctx, await cardsByIds(ctx, await recentlyViewed(ctx.db, ctx, 6)));
  const reviews = await countRows(ctx.db, ctx, "kb_version", { and: [{ f: "state", op: "eq", v: "in_review" }, { f: "reviewer_ids", op: "is_me" }] });
  const tasks = await countRows(ctx.db, ctx, "kb_task", { and: [{ f: "active", op: "eq", v: true }, { or: [{ f: "assigned_to", op: "is_me" }, { and: [{ f: "assigned_to", op: "empty" }, { f: "assignment_group_id", op: "is_my_group" }] }] }] });
  const drafts = await countRows(ctx.db, ctx, "kb_version", { and: [{ f: "state", op: "eq", v: "draft" }, { f: "author_id", op: "is_me" }] });
  const attestations = ctx.actor === "system" ? 0 : (await myAttestations(ctx)).filter((a) => !a.acked_at).length;
  return {
    bases: bases.map((b) => ({
      id: b.id, name: b.name, description: b.description ?? null, kind: b.kind, icon: b.icon ?? null, color: b.color ?? null, article_count: perBase.get(b.id) ?? 0,
      restricted: b.read_mode === "audience", contribute: contributesTo(ctx, b), manage: managesBase(ctx, b), allow_comments: b.allow_comments !== false, allow_ratings: b.allow_ratings !== false,
    })),
    categories: cats.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id ?? null, base_id: c.base_id, icon: c.icon ?? null, description: c.description ?? null, article_count: total.get(c.id) ?? 0, depth: Number(c.depth ?? 0), restricted: c.c_all === false })),
    featured,
    popular: await cards(ctx, popular),
    recent: await cards(ctx, recent),
    viewed,
    can: { author: canAuthor(ctx), manage: isKbAdmin(ctx) || writesAll(ctx), ai: ctx.actor !== "system" && ctx.can("ai", "view"), internal: holdsInternal(ctx) },
    pending: { reviews, tasks, attestations, drafts },
  };
}

/**
 * The article cards a home page shows — featured (by the categories), most viewed and newest — as the person may read
 * them, without the knowledge home's counts and queues (the portal's home: a few small queries, not sixteen).
 */
export async function kbCards(ctx: Ctx, limit = 6): Promise<{ featured: KbCard[]; popular: KbCard[]; recent: KbCard[] }> {
  const cats = await liveRows(ctx.db, ctx, "kb_category", { and: [{ f: "state", op: "eq", v: "active" }, { f: "featured", op: "nempty" }] }, { order: "t.depth, t.sort_order, t.name", limit: 200 });
  const featuredIds = [...new Set(cats.flatMap((c) => (Array.isArray(c.featured) ? c.featured : [])))].slice(0, 12);
  const [featuredRows, popular, recent] = await Promise.all([
    cardsByIds(ctx, featuredIds),
    liveRows(ctx.db, ctx, "kb_article", live, { order: "t.view_count desc, t.reuse_count desc, t.published_at desc", limit }),
    liveRows(ctx.db, ctx, "kb_article", live, { order: "t.published_at desc nulls last", limit }),
  ]);
  const labels = await labelsOf(ctx, [...featuredRows, ...popular, ...recent]);
  return { featured: featuredRows.map((r) => cardOf(r, labels)), popular: popular.map((r) => cardOf(r, labels)), recent: recent.map((r) => cardOf(r, labels)) };
}

const typeLabel = (v: string) => ARTICLE_TYPES.find((t) => t.value === v)?.label ?? v;
const STATE_LABELS: Record<string, string> = { draft: "پیش‌نویس", in_review: "در بازبینی", scheduled: "زمان‌بندی‌شده", published: "منتشرشده", pending_retirement: "در انتظار بازنشستگی", retired: "بازنشسته", trashed: "در سطل بازیافت" };

/** Readable resolved incidents in a window and how many of them have a knowledge link (system counts, for rates). */
async function linkRate(ctx: Ctx, since: string): Promise<{ resolved: number; linked: number }> {
  const schema = await orgSchema(ctx);
  const def = schema.def("incident");
  if (!def) return { resolved: 0, linked: 0 };
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = readable(ctx, def, "i", params, env);
  params.push(since);
  const r = await ctx.db.one<{ n: string | number; l: string | number }>(
    `select count(*) as n, sum(case when exists (select 1 from sm_links l where l.org_id = i.org_id and l.from_id = i.id and l.to_table = 'kb_article' and l.deleted_at is null) then 1 else 0 end) as l
       from ${def.table} i where ${where} and i.resolved_at > $${params.length}`,
    params,
  );
  return { resolved: Number(r?.n ?? 0), linked: Number(r?.l ?? 0) };
}

/** Sessions with knowledge activity and how many ended without a request (explicitly «حل شد», or no incident in the window). */
async function deflection(sys: Ctx, days: number, hours: number) {
  const rows = await sys.db.query<{ session_id: string; user_id: string | null; first: string; solved: boolean }>(
    `select session_id, max(user_id::text) as user_id, min(at) as first, bool_or(kind = 'deflect') as solved
       from sm_kb_events where org_id = $1 and session_id is not null and kind in ('search', 'view', 'deflect') and at > now() - ($2 || ' days')::interval
      group by session_id`,
    [sys.org.id, String(days)],
  );
  const schema = await orgSchema(sys);
  const def = schema.def("incident");
  let deflected = 0;
  let solved = 0;
  for (const s of rows) {
    if (s.solved) {
      solved++;
      deflected++;
      continue;
    }
    if (!s.user_id || !def) continue;
    const env = await condEnv(sys);
    const params: unknown[] = [];
    const where = readable(sys, def, "i", params, env);
    params.push(s.user_id, s.first, String(hours));
    const r = await sys.db.one(`select 1 from ${def.table} i where ${where} and i.caller_id = $${params.length - 2}::uuid and i.created_at >= $${params.length - 1} and i.created_at < $${params.length - 1}::timestamptz + ($${params.length} || ' hours')::interval limit 1`, params);
    if (!r && Date.parse(s.first) < Date.now() - hours * 3_600_000) deflected++;
  }
  return { sessions: rows.length, deflected, rate: rows.length ? Math.round((100 * deflected) / rows.length) : 0, solved_clicks: solved };
}

export async function kbDashboard(ctx: Ctx, days = 90): Promise<KbDashboard> {
  if (!holdsInternal(ctx) && !isKbAdmin(ctx)) throw forbidden("داشبورد دانش برای کارشناسان است");
  const sys = sysOf(ctx);
  const today = todayIn(ctx);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const states = await counts(ctx, "state", null);
  const n = (s: string) => states.get(s) ?? 0;
  const review_due = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "review_due", op: "eq", v: true }] });
  const expiring = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "valid_to", op: "between", v: [today, addDaysISO(today, 30)] }] });
  const flagged = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "open_flags", op: "gt", v: 0 }] });
  const internal = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "confidential", op: "eq", v: true }] });
  const byBase = await aggregate(ctx, "kb_article", { filter: live, groupBy: ["base_id"], metrics: [{ fn: "count" }] });
  const byType = await counts(ctx, "article_type");
  const top = await liveRows(ctx.db, ctx, "kb_article", live, { order: "t.view_count desc, t.reuse_count desc", limit: 8 });
  const bottom = await liveRows(ctx.db, ctx, "kb_article", { and: [live, { f: "helpful_no", op: "gte", v: 2 }] }, { order: "(t.helpful_no::float / greatest(1, t.helpful_yes + t.helpful_no)) desc", limit: 8 });
  // the event stream (what everyone typed, sessions, deflection) is the knowledge managers'; query texts that hold
  // personal or technical data are masked even for them
  const managers = isKbAdmin(ctx) || writesAll(ctx);
  const masked = (rows: Awaited<ReturnType<typeof queryStats>>) => rows.map((r) => (scanSensitive(r.query).length ? { ...r, query: "[متن حساس]" } : r));
  const ev = managers ? await eventTotals(sys.db, ctx.org.id, days) : {};
  const queries = managers ? masked(await queryStats(sys.db, ctx.org.id, days, { limit: 15 })) : [];
  const zero = managers ? masked(await queryStats(sys.db, ctx.org.id, days, { zeroOnly: true, limit: 15 })) : [];
  const searches = ev.search ?? 0;
  const zeroCount = zero.reduce((s, z) => s + z.zero, 0);
  const totalsAgg = await aggregate(ctx, "kb_article", { filter: live, metrics: [{ fn: "sum", field: "helpful_yes" }, { fn: "sum", field: "helpful_no" }, { fn: "sum", field: "open_flags" }] });
  const helpful = Number(totalsAgg.totals["sum:helpful_yes"] ?? 0);
  const notHelpful = Number(totalsAgg.totals["sum:helpful_no"] ?? 0);
  const openTasks = await countRows(ctx.db, ctx, "kb_task", { f: "active", op: "eq", v: true });
  // links to the articles the reader reads; incidents the reader reads
  const adef = (await orgSchema(ctx)).def("kb_article")!;
  const lparams: unknown[] = [ctx.org.id, since];
  const aread = readable(ctx, adef, "a", lparams, await condEnv(ctx));
  const linksRow = await ctx.db.one<{ n: string | number; a: string | number }>(
    `select count(*) as n, count(distinct l.to_id) as a from sm_links l join ${adef.table} a on a.id = l.to_id
      where l.org_id = $1 and l.to_table = 'kb_article' and l.kind in ('kb_solved_by', 'kb_workaround') and l.deleted_at is null and l.created_at > $2 and ${aread}`,
    lparams,
  );
  const lr = await linkRate(ctx, since);
  const translated = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "translation_of", op: "nempty" }] });
  const stale = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "translation_stale", op: "eq", v: true }] });
  const masters = new Set((await liveRows(ctx.db, ctx, "kb_article", { and: [live, { f: "translation_of", op: "nempty" }] }, { limit: 5000 })).map((r) => r.translation_of)).size;
  const reviews = await liveRows(ctx.db, ctx, "kb_quality_review", { and: [{ f: "state", op: "eq", v: "done" }, { f: "updated_at", op: "gte", v: since }] }, { limit: 5000 });
  const byAuthor = new Map<string, number[]>();
  for (const r of reviews) if (r.author_id) byAuthor.set(r.author_id, [...(byAuthor.get(r.author_id) ?? []), Number(r.score ?? 0)]);
  const names = new Map<string, string>();
  if (byAuthor.size) {
    const rows = await sys.db.query<{ user_id: string; full_name: string | null }>(`select m.user_id, u.full_name from sm_org_members m join sm_users u on u.id = m.user_id where m.org_id = $1`, [ctx.org.id]);
    for (const r of rows) names.set(r.user_id, r.full_name ?? "");
  }
  const captured = await liveRows(ctx.db, ctx, "kb_article", { and: [{ f: "source_id", op: "nempty" }, { f: "created_at", op: "gte", v: since }, { f: "state", op: "ne", v: "trashed" }] }, { limit: 5000 });
  const externalCaptured = captured.filter((a) => !a.confidential && LIVE_STATES.includes(a.state)).length;
  const bases = await liveRows(ctx.db, ctx, "kb_base", { f: "state", op: "eq", v: "active" }, { order: "t.sort_order, t.name", limit: 100 });
  const readiness = [];
  for (const b of bases) {
    const arts = await liveRows(ctx.db, ctx, "kb_article", { and: [live, { f: "base_id", op: "eq", v: b.id }] }, { limit: 5000 });
    if (!arts.length) {
      readiness.push({ key: b.id, label: b.name, articles: 0, records: 0, coverage: 0, freshness: 0, usage: 0, score: 0 });
      continue;
    }
    const fresh = arts.filter((a) => !a.review_due && !(a.valid_to && String(a.valid_to) < today)).length / arts.length;
    const used = arts.filter((a) => Number(a.view_count ?? 0) > 0 || Number(a.reuse_count ?? 0) > 0).length / arts.length;
    const helpfulRatio = arts.reduce((s, a) => s + Number(a.helpful_yes ?? 0), 0) / Math.max(1, arts.reduce((s, a) => s + Number(a.helpful_yes ?? 0) + Number(a.helpful_no ?? 0), 0));
    const coverage = Math.min(1, arts.length / 20);
    readiness.push({ key: b.id, label: b.name, articles: arts.length, records: 0, coverage: Math.round(100 * coverage), freshness: Math.round(100 * fresh), usage: Math.round(100 * used), score: Math.round(100 * (0.3 * coverage + 0.3 * fresh + 0.2 * used + 0.2 * helpfulRatio)) });
  }
  const toCounts = (m: Map<string, number>, label: (k: string) => string): KbCount[] => [...m.entries()].map(([key, count]) => ({ key, label: label(key), count })).sort((a, b) => b.count - a.count);
  return {
    days,
    totals: { published: n("published") + n("pending_retirement"), drafts: n("draft"), in_review: n("in_review") + n("scheduled"), retired: n("retired"), review_due, expiring, flagged, internal },
    by_state: toCounts(states, (k) => STATE_LABELS[k] ?? k),
    by_base: byBase.rows.map((r) => ({ key: String(r.keys[0] ?? ""), label: r.labels[0] ?? "", count: Number(r.values.count ?? 0) })),
    by_type: toCounts(byType, typeLabel),
    top: await cards(ctx, top),
    bottom: await cards(ctx, bottom),
    queries,
    zero,
    events: ev,
    search: { searches, zero_rate: searches ? Math.round((100 * zeroCount) / searches) : 0, click_rate: searches ? Math.round((100 * (ev.click ?? 0)) / searches) : 0 },
    deflection: managers ? await deflection(sys, days, (await kbConfig(ctx.db, sys)).deflection_hours) : { sessions: 0, deflected: 0, rate: 0, solved_clicks: 0 },
    feedback: { helpful, not_helpful: notHelpful, ratio: helpful + notHelpful ? Math.round((100 * helpful) / (helpful + notHelpful)) : 0, open_flags: Number(totalsAgg.totals["sum:open_flags"] ?? 0), open_tasks: openTasks },
    reuse: { links: Number(linksRow?.n ?? 0), articles_reused: Number(linksRow?.a ?? 0), link_rate: lr.resolved ? Math.round((100 * lr.linked) / lr.resolved) : 0 },
    translation: { masters, translated, stale },
    aqi: {
      reviews: reviews.length,
      average: reviews.length ? Math.round(reviews.reduce((s, r) => s + Number(r.score ?? 0), 0) / reviews.length) : null,
      by_author: [...byAuthor.entries()].map(([user_id, xs]) => ({ user_id, name: names.get(user_id) ?? "", score: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length), reviews: xs.length })).sort((a, b) => a.score - b.score),
    },
    capture: { from_records: captured.length, external: externalCaptured, ratio_90_0: captured.length ? Math.round((100 * externalCaptured) / captured.length) : 0 },
    readiness,
  };
}

export async function kbWorkspace(ctx: Ctx): Promise<KbWorkspace> {
  if (!(isKbAdmin(ctx) || writesAll(ctx) || isKbApprover(ctx) || canAuthor(ctx))) throw forbidden("میز کار دانش برای نویسندگان و مدیران دانش است");
  const today = todayIn(ctx);
  const sys = sysOf(ctx);
  const expiringRows = await liveRows(ctx.db, ctx, "kb_article", { and: [live, { or: [{ f: "review_due", op: "eq", v: true }, { f: "valid_to", op: "lte", v: addDaysISO(today, 30) }, { f: "review_at", op: "lte", v: addDaysISO(today, 14) }] }] }, { order: "t.review_at nulls last", limit: 20 });
  const flaggedRows = await liveRows(ctx.db, ctx, "kb_article", { and: [live, { f: "open_flags", op: "gt", v: 0 }] }, { order: "t.open_flags desc", limit: 20 });
  const unhealthyRows = await liveRows(ctx.db, ctx, "kb_article", { and: [live, { or: [{ f: "health_score", op: "lt", v: 50 }, { f: "next_action", op: "in", v: ["update", "merge", "retire"] }] }] }, { order: "t.health_score nulls last", limit: 20 });
  const dupRows = await liveRows(ctx.db, ctx, "kb_duplicate", { f: "state", op: "eq", v: "proposed" }, { order: "t.similarity desc", limit: 20 });
  const dupCards = await cardsByIds(ctx, [...new Set(dupRows.flatMap((d) => [d.article_a, d.article_b]))]);
  const dl = await labelsOf(ctx, dupCards);
  const byId = new Map(dupCards.map((c) => [c.id, cardOf(c, dl)]));
  const gaps = await liveRows(ctx.db, ctx, "kb_gap", { f: "state", op: "in", v: ["open", "in_progress"] }, { order: "t.score desc, t.last_seen_at desc", limit: 20 });
  const reviews = await liveRows(ctx.db, ctx, "kb_version", { and: [{ f: "state", op: "eq", v: "in_review" }, { f: "reviewer_ids", op: "is_me" }] }, { order: "t.submitted_at", limit: 20 });
  const tasks = await liveRows(ctx.db, ctx, "kb_task", { and: [{ f: "active", op: "eq", v: true }, { or: [{ f: "assigned_to", op: "is_me" }, { f: "assignment_group_id", op: "in", v: myGroups(ctx).length ? myGroups(ctx) : ["00000000-0000-0000-0000-000000000000"] }] }] }, { order: "t.sla_due nulls last, t.opened_at", limit: 30 });
  // built-in routines (KB-028): high-priority incidents written up within five days, reviews on time, translations current
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const before = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const schema = await orgSchema(sys);
  let p12 = { total: 0, met: 0 };
  const idef = schema.def("incident");
  if (idef) {
    // the incidents the reader reads (never the organisation's count through the system)
    const env = await condEnv(ctx);
    const params: unknown[] = [];
    const where = readable(ctx, idef, "i", params, env);
    params.push(since, before);
    const r = await ctx.db.one<{ n: string | number; m: string | number }>(
      `select count(*) as n, sum(case when exists (select 1 from sm_links l where l.org_id = i.org_id and l.to_table = 'kb_article' and l.deleted_at is null and l.created_at <= i.resolved_at + interval '5 days' and (l.from_id = i.id or l.to_id = i.id)) then 1 else 0 end) as m
         from ${idef.table} i where ${where} and i.priority in ('1', '2') and i.resolved_at > $${params.length - 1} and i.resolved_at < $${params.length}`,
      params,
    );
    p12 = { total: Number(r?.n ?? 0), met: Number(r?.m ?? 0) };
  }
  const liveCount = await countRows(ctx.db, ctx, "kb_article", live);
  const onTime = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "review_due", op: "eq", v: false }] });
  const trans = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "translation_of", op: "nempty" }] });
  const transOk = await countRows(ctx.db, ctx, "kb_article", { and: [live, { f: "translation_of", op: "nempty" }, { f: "translation_stale", op: "eq", v: false }] });
  const cards0 = [
    { key: "reviews", label: "در انتظار تأیید شما", count: reviews.length, tone: reviews.length ? "warning" : "ok", path: "kb/reviews" },
    { key: "tasks", label: "کارهای دانش باز", count: tasks.length, tone: tasks.length ? "info" : "ok", path: "kb/tasks" },
    { key: "expiring", label: "نیازمند بازبینی یا رو به انقضا", count: expiringRows.length, tone: expiringRows.length ? "warning" : "ok", path: "kb/workspace#expiring" },
    { key: "flagged", label: "گزارش ایراد باز", count: flaggedRows.length, tone: flaggedRows.length ? "danger" : "ok", path: "kb/workspace#flagged" },
    { key: "duplicates", label: "احتمالاً تکراری", count: dupRows.length, tone: dupRows.length ? "warning" : "ok", path: "kb/duplicates" },
    { key: "gaps", label: "شکاف‌های دانش", count: gaps.length, tone: gaps.length ? "info" : "ok", path: "kb/gaps" },
  ] as KbWorkspace["cards"];
  return {
    cards: cards0,
    expiring: await cards(ctx, expiringRows),
    flagged: await cards(ctx, flaggedRows),
    unhealthy: (await cards(ctx, unhealthyRows)).map((c, i) => ({ ...c, health_score: unhealthyRows[i].health_score ?? null, next_action: unhealthyRows[i].next_action ?? null })),
    duplicates: dupRows.map((d) => ({ id: d.id, a: byId.get(d.article_a) ?? null, b: byId.get(d.article_b) ?? null, similarity: Number(d.similarity ?? 0) })).filter((d) => d.a && d.b),
    gaps: gaps.map((g) => ({ id: g.id, number: g.number ?? null, title: g.title, demand: Number(g.demand ?? 0), kind: g.kind, last_seen_at: g.last_seen_at ?? null })),
    reviews: reviews.map((v) => ({ id: v.id, article_id: v.article_id, title: v.title, version_label: v.version_label ?? null, author_id: v.author_id ?? null, submitted_at: v.submitted_at ?? null })),
    tasks: tasks.map((t) => ({ id: t.id, number: t.number ?? null, short_description: t.short_description, kind: t.kind, state: t.state, assigned_to: t.assigned_to ?? null, sla_due: t.sla_due ?? null })),
    routines: [
      { key: "capture_p12", label: "رخدادهای اولویت ۱ و ۲ با مقاله در پنج روز", target: 90, met: p12.met, total: p12.total },
      { key: "reviews_on_time", label: "مقاله‌های بازبینی‌شده به‌موقع", target: 95, met: onTime, total: liveCount },
      { key: "translations_current", label: "ترجمه‌های همگام با نسخهٔ اصلی", target: 90, met: transOk, total: trans },
    ],
    ai: knowledgeAiCapabilities(),
  };
}

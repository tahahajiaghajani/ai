// Persian-aware knowledge search (KB-035/036/038/039/040, KB-041, KB-050): one query over the articles the caller may
// read, live only (published or awaiting retirement), in the search form on both sides — Arabic/Persian letters and
// digits unified, half-spaces, diacritics, tatweel and hamza seats folded (`searchForm` in JS, its SQL twin here) —
// with stop words dropped, light stems matched as parts of words, quoted phrases, the glossary's synonyms and approved
// equivalents, field weights (title, keywords, summary, body; the internal section only for agents), popularity as a
// tie-breaker, the organisation's search rules (pin, boost, demote, hide) and, when the member may use AI, the
// semantic matches of the AI index fused by reciprocal rank. Facets, highlighted excerpts, sorting and paging come
// back with every answer; each first page is logged to the knowledge event stream (zero results feed the gap list).
import type { KbSearchHit, KbSearchParams, KbSearchResult, KbFacet, KbSnippetHit } from "@shared/knowledge/api";
import { excerpt, parseQuery } from "@shared/knowledge/logic";
import { searchForm, stem } from "@shared/ai/text";
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { condEnv, orgSchema, readable } from "../../engine";
import { LIVE_STATES } from "@shared/tables/knowledge";
import { holdsInternal, liveRows, rowsById, sysOf, type Row } from "./common";
import { logEvent } from "./events";

const PAIRS: [string, string][] = [
  ["ي", "ی"], ["ى", "ی"], ["ك", "ک"], ["ە", "ه"], ["أ", "ا"], ["إ", "ا"], ["ٱ", "ا"], ["آ", "ا"], ["ؤ", "و"], ["ئ", "ی"], ["ة", "ه"], ["ۀ", "ه"],
  ...[..."۰۱۲۳۴۵۶۷۸۹"].map((c, i) => [c, String(i)] as [string, string]),
  ...[..."٠١٢٣٤٥٦٧٨٩"].map((c, i) => [c, String(i)] as [string, string]),
];
const DROP = "‌‍ًٌٍَُِّْٰـء";
const FROM = PAIRS.map((p) => p[0]).join("") + DROP;
const TO = PAIRS.map((p) => p[1]).join("");

/** The SQL twin of `searchForm` for substring matching (lower-cased, letters and digits folded, marks dropped). */
export const normExpr = (expr: string) => `translate(lower(coalesce(${expr}, '')), '${FROM}', '${TO}')`;
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface Glossary {
  term: string;
  forms: string[];
}

/** Active glossary terms with their search forms (term, synonyms, approved equivalent). */
async function glossary(ctx: Ctx): Promise<Glossary[]> {
  const rows = await liveRows(ctx.db, sysOf(ctx), "kb_glossary", { f: "active", op: "eq", v: true }, { limit: 2000 });
  return rows.map((r) => ({ term: String(r.term), forms: [...new Set([r.term, r.approved_fa, ...(Array.isArray(r.synonyms) ? r.synonyms : [])].filter(Boolean).map((x: string) => stem(searchForm(x))).filter((x) => x.length >= 2))] }));
}

/** Each query term with its alternatives from the glossary (a term matching a glossary form takes all its forms). */
export function expandTerms(terms: string[], g: Glossary[]): { groups: string[][]; expanded: string[] } {
  const groups: string[][] = [];
  const expanded: string[] = [];
  for (const t of terms) {
    const hit = g.find((x) => x.forms.includes(t));
    if (hit) {
      groups.push([...new Set([t, ...hit.forms])]);
      if (hit.forms.length > 1) expanded.push(hit.term);
    } else groups.push([t]);
  }
  return { groups, expanded };
}

interface Rule {
  kind: "pin" | "boost" | "demote" | "hide";
  articles: string[];
}

async function rulesFor(ctx: Ctx, q: string): Promise<Rule[]> {
  const norm = searchForm(q);
  if (!norm) return [];
  const rows = await liveRows(ctx.db, sysOf(ctx), "kb_search_rule", { f: "active", op: "eq", v: true }, { limit: 500 });
  return rows.filter((r) => searchForm(r.query) && norm.includes(searchForm(r.query))).map((r) => ({ kind: r.kind, articles: Array.isArray(r.articles) ? r.articles : [] }));
}

const CARD_COLS = ["id", "number", "title", "summary", "article_type", "base_id", "category_id", "language", "state", "published_at", "last_reviewed_at", "view_count", "reuse_count", "helpful_yes", "helpful_no", "confidential", "version_label", "review_due", "translation_of", "updated_at"];

/** Readable live articles by id (cards), in the order given. */
export async function cardsByIds(ctx: Ctx, idsIn: string[], opts: { states?: string[] } = {}): Promise<Row[]> {
  if (!idsIn.length) return [];
  const schema = await orgSchema(ctx);
  const def = schema.def("kb_article")!;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = [readable(ctx, def, "t", params, env)];
  params.push(pgArray(idsIn));
  where.push(`t.id = any($${params.length}::uuid[])`);
  params.push(pgArray(opts.states ?? LIVE_STATES));
  where.push(`t.state = any($${params.length}::text[])`);
  const rows = await ctx.db.query<Row>(`select ${CARD_COLS.map((c) => `t.${c}`).join(", ")} from sm_kb_articles t where ${where.join(" and ")}`, params);
  const by = new Map(rows.map((r) => [r.id, r]));
  return idsIn.map((id) => by.get(id)).filter((r): r is Row => !!r);
}

/** Display names of bases and categories the caller may read. */
export async function labelsOf(ctx: Ctx, rows: Row[]): Promise<{ bases: Map<string, string>; categories: Map<string, string> }> {
  const baseIds = [...new Set(rows.map((r) => r.base_id).filter(Boolean))];
  const catIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))];
  const bases = new Map<string, string>();
  const categories = new Map<string, string>();
  if (baseIds.length) for (const b of await rowsById(ctx.db, ctx, "kb_base", baseIds)) bases.set(b.id, b.name);
  if (catIds.length) for (const c of await rowsById(ctx.db, ctx, "kb_category", catIds)) categories.set(c.id, c.name);
  return { bases, categories };
}

const ln = (x: number) => Math.log(1 + Math.max(0, x));

/** Search the knowledge base (see the header). */
export async function searchKnowledge(ctx: Ctx, p: KbSearchParams): Promise<KbSearchResult> {
  const q = String(p.q ?? "").trim().slice(0, 300);
  const size = Math.max(1, Math.min(50, p.size ?? 20));
  const page = Math.max(1, p.page ?? 1);
  const sort = p.sort ?? "relevance";
  const internal = holdsInternal(ctx);
  const { terms, phrases } = parseQuery(q);
  const g = terms.length ? await glossary(ctx) : [];
  const { groups, expanded } = expandTerms(terms, g);
  const schema = await orgSchema(ctx);
  const def = schema.def("kb_article")!;
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = [readable(ctx, def, "t", params, env)];
  params.push(pgArray(p.include_retired ? [...LIVE_STATES, "retired"] : LIVE_STATES));
  where.push(`t.state = any($${params.length}::text[])`);

  const F = { t: normExpr("t.title"), s: normExpr("t.summary"), k: `${normExpr("t.keywords::text")} || ' ' || ${normExpr("t.tags::text")} || ' ' || ${normExpr("t.doc_number")}`, b: normExpr("t.body"), i: internal ? normExpr("t.internal_body") : "''::text" };
  const like = (term: string) => {
    params.push(`%${likeEsc(term)}%`);
    return `$${params.length}::text`;
  };
  const groupSql: { any: string; score: string }[] = [];
  for (const alts of groups) {
    const parts = alts.map((a) => {
      const ph = like(a);
      return { t: `c.t like ${ph}`, k: `c.k like ${ph}`, s: `c.s like ${ph}`, b: `c.b like ${ph}`, i: `c.i like ${ph}` };
    });
    const anyOf = (k: "t" | "k" | "s" | "b" | "i") => `(${parts.map((x) => x[k]).join(" or ")})`;
    groupSql.push({
      any: `(${anyOf("t")} or ${anyOf("k")} or ${anyOf("s")} or ${anyOf("b")} or ${anyOf("i")})`,
      score: `(case when ${anyOf("t")} then 8 when ${anyOf("k")} then 5 when ${anyOf("s")} then 3 when ${anyOf("b")} then 1 when ${anyOf("i")} then 1 else 0 end)`,
    });
  }
  const phraseSql = phrases.map((ph) => {
    const x = like(ph);
    return { any: `(c.t like ${x} or c.s like ${x} or c.b like ${x} or c.i like ${x})`, score: `(case when c.t like ${x} then 6 when c.s like ${x} or c.b like ${x} or c.i like ${x} then 3 else 0 end)` };
  });
  const all = [...groupSql, ...phraseSql];
  const scoreExpr = all.length ? all.map((x) => x.score).join(" + ") : "0";
  const matchedExpr = all.length ? all.map((x) => `(case when ${x.any} then 1 else 0 end)`).join(" + ") : "0";
  const base = `with c as (select t.id, t.base_id, t.category_id, t.article_type, t.language, t.published_at, t.updated_at, t.view_count, t.reuse_count, t.helpful_yes, t.helpful_no,
                     ${F.t} as t, ${F.s} as s, ${F.k} as k, ${F.b} as b, ${F.i} as i
                from sm_kb_articles t where ${where.join(" and ")})
     select c.id, c.base_id, c.category_id, c.article_type, c.language, c.published_at, c.updated_at, c.view_count, c.reuse_count, c.helpful_yes, c.helpful_no,
            (${scoreExpr}) as score, (${matchedExpr}) as matched
       from c`;
  let relaxed = false;
  let rows: Row[];
  if (!all.length) {
    rows = await ctx.db.query<Row>(`${base} order by c.published_at desc nulls last limit 2000`, params);
  } else {
    rows = await ctx.db.query<Row>(`${base} where ${all.map((x) => x.any).join(" and ")} limit 2000`, params);
    if (!rows.length && all.length > 1) {
      rows = await ctx.db.query<Row>(`${base} where ${all.map((x) => x.any).join(" or ")} limit 2000`, params);
      relaxed = rows.length > 0;
    }
  }

  // rules of the organisation
  const rules = q ? await rulesFor(ctx, q) : [];
  const hidden = new Set(rules.filter((r) => r.kind === "hide").flatMap((r) => r.articles));
  const pinned = rules.filter((r) => r.kind === "pin").flatMap((r) => r.articles).filter((id) => !hidden.has(id));
  const boost = new Set(rules.filter((r) => r.kind === "boost").flatMap((r) => r.articles));
  const demote = new Set(rules.filter((r) => r.kind === "demote").flatMap((r) => r.articles));
  type Scored = Row & { _score: number; _semantic?: boolean };
  let scored: Scored[] = rows
    .filter((r) => !hidden.has(r.id))
    .map((r) => {
      let s = Number(r.score ?? 0) + (relaxed ? Number(r.matched ?? 0) * 2 : 0) + 0.5 * ln(Number(r.reuse_count ?? 0)) + 0.2 * ln(Number(r.view_count ?? 0));
      if (boost.has(r.id)) s = s * 1.5 + 5;
      if (demote.has(r.id)) s *= 0.4;
      return { ...r, _score: s };
    });
  scored.sort((a, b) => b._score - a._score);

  // semantic matches of the AI index, fused by reciprocal rank (members who may use AI)
  let semantic = false;
  if (q && p.semantic !== false && terms.length && (ctx.actor !== "system" && ctx.can("ai", "view"))) {
    try {
      const { retrieve } = await import("../ai/rag");
      const r = await retrieve(ctx, q, { tables: ["kb_article"], k: 15 });
      const order = [...new Set(r.passages.map((x) => x.citation.id))].filter((id) => !hidden.has(id));
      if (order.length) {
        semantic = true;
        const known = new Map(scored.map((x, i) => [x.id, i]));
        const extra = order.filter((id) => !known.has(id));
        const extraRows = extra.length ? await cardsByIds(ctx, extra) : [];
        const fused = new Map<string, number>();
        scored.forEach((x, i) => fused.set(x.id, 1 / (60 + i)));
        order.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + 0.8 / (60 + i)));
        for (const e of extraRows) scored.push({ ...e, _score: 0, _semantic: true });
        if (sort === "relevance") scored.sort((a, b) => (fused.get(b.id) ?? 0) - (fused.get(a.id) ?? 0));
      }
    } catch {
      // no AI index, no model: keyword results stand
    }
  }
  if (pinned.length) {
    const have = new Set(scored.map((x) => x.id));
    const missing = pinned.filter((id) => !have.has(id));
    const extra = missing.length ? await cardsByIds(ctx, missing) : [];
    const pinRows: Scored[] = [...scored.filter((x) => pinned.includes(x.id)), ...extra.map((e) => ({ ...e, _score: 0 }) as Scored)];
    pinRows.sort((a, b) => pinned.indexOf(a.id) - pinned.indexOf(b.id));
    scored = [...pinRows.map((x) => ({ ...x, _pinned: true })), ...scored.filter((x) => !pinned.includes(x.id))];
  }

  // facets over every match, then the facet filters
  const facet = (key: string): KbFacet[] => {
    const m = new Map<string, number>();
    for (const r of scored) if (r[key]) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => ({ key: k, label: k, count: n }));
  };
  const facets = { base: facet("base_id"), category: facet("category_id"), type: facet("article_type"), language: facet("language") };
  let filtered = scored;
  if (p.base_id) filtered = filtered.filter((r) => r.base_id === p.base_id);
  if (p.category_id) filtered = filtered.filter((r) => r.category_id === p.category_id);
  if (p.type) filtered = filtered.filter((r) => r.article_type === p.type);
  if (p.language) filtered = filtered.filter((r) => r.language === p.language);
  if (sort === "recent") filtered = [...filtered].sort((a, b) => String(b.published_at ?? b.updated_at ?? "").localeCompare(String(a.published_at ?? a.updated_at ?? "")));
  if (sort === "popular") filtered = [...filtered].sort((a, b) => Number(b.view_count ?? 0) + 5 * Number(b.reuse_count ?? 0) - (Number(a.view_count ?? 0) + 5 * Number(a.reuse_count ?? 0)));
  const total = filtered.length;
  const pageRows = filtered.slice((page - 1) * size, page * size);

  // the page: cards with excerpts (internal text only for agents)
  const cards = await cardsByIds(ctx, pageRows.map((r) => r.id), { states: p.include_retired ? [...LIVE_STATES, "retired"] : undefined });
  const bodies = new Map<string, { body: string; internal: string }>();
  if (cards.length) {
    const params2: unknown[] = [];
    const w2 = [readable(ctx, def, "t", params2, env)];
    params2.push(pgArray(cards.map((c) => c.id)));
    w2.push(`t.id = any($${params2.length}::uuid[])`);
    const bs = await ctx.db.query<Row>(`select t.id, t.body${internal ? ", t.internal_body" : ""} from sm_kb_articles t where ${w2.join(" and ")}`, params2);
    for (const b of bs) bodies.set(b.id, { body: String(b.body ?? ""), internal: internal ? String(b.internal_body ?? "") : "" });
  }
  const labels = await labelsOf(ctx, cards);
  const baseLabels = await labelsOf(ctx, scored.map((r) => ({ base_id: r.base_id, category_id: r.category_id })) as Row[]);
  facets.base = facets.base.map((x) => ({ ...x, label: baseLabels.bases.get(x.key) ?? x.key })).filter((x) => baseLabels.bases.has(x.key));
  facets.category = facets.category.map((x) => ({ ...x, label: baseLabels.categories.get(x.key) ?? x.key })).filter((x) => baseLabels.categories.has(x.key));
  const flat = groups.flat();
  const meta = new Map(pageRows.map((r) => [r.id, r as Scored & { _pinned?: boolean }]));
  const hits: KbSearchHit[] = cards.map((c) => {
    const m = meta.get(c.id);
    const b = bodies.get(c.id);
    const text = b?.body && excerpt(b.body, flat).length > 20 ? b.body : `${c.summary ?? ""}\n${b?.internal ?? ""}`;
    return {
      ...(cardOf(c, labels) as KbSearchHit),
      score: Math.round((m?._score ?? 0) * 100) / 100,
      snippet: excerpt(text || String(c.summary ?? ""), flat, 240),
      semantic: !!m?._semantic,
      pinned: !!m?._pinned,
    };
  });

  const snippets = q && terms.length && page === 1 ? await searchSnippets(ctx, groups) : [];
  if (q && page === 1 && p.log !== false) await logEvent(ctx.db, ctx, { kind: "search", query: q, results: total, session_id: p.session_id ?? null, channel: p.channel ?? "search", data: relaxed ? { relaxed: true } : null });
  return { query: q, terms: flat, expanded, total, page, size, sort, relaxed, semantic, hits, facets, snippets };
}

/** A search hit / list card of an article (labels resolved, never content the caller may not see). */
export function cardOf(c: Row, labels: { bases: Map<string, string>; categories: Map<string, string> }) {
  return {
    id: c.id,
    number: c.number ?? null,
    title: String(c.title ?? ""),
    summary: c.summary ?? null,
    article_type: c.article_type ?? null,
    base_id: c.base_id ?? null,
    base_name: c.base_id ? labels.bases.get(c.base_id) ?? null : null,
    category_id: c.category_id ?? null,
    category_name: c.category_id ? labels.categories.get(c.category_id) ?? null : null,
    language: c.language ?? null,
    state: c.state ?? null,
    published_at: c.published_at ?? null,
    last_reviewed_at: c.last_reviewed_at ?? null,
    view_count: Number(c.view_count ?? 0),
    reuse_count: Number(c.reuse_count ?? 0),
    helpful_yes: Number(c.helpful_yes ?? 0),
    helpful_no: Number(c.helpful_no ?? 0),
    internal: c.confidential === true,
    version_label: c.version_label ?? null,
    review_due: c.review_due === true,
  };
}

/** Published answer snippets matching every term group (readable ones). */
async function searchSnippets(ctx: Ctx, groups: string[][]): Promise<KbSnippetHit[]> {
  const schema = await orgSchema(ctx);
  const def = schema.def("kb_snippet");
  if (!def) return [];
  const env = await condEnv(ctx);
  const params: unknown[] = [];
  const where = [readable(ctx, def, "t", params, env), `t.state = 'published'`, `(t.valid_to is null or t.valid_to >= current_date)`];
  for (const alts of groups) {
    const ors = alts.map((a) => {
      params.push(`%${likeEsc(a)}%`);
      return `(${normExpr("t.question")} like $${params.length} or ${normExpr("t.answer")} like $${params.length})`;
    });
    where.push(`(${ors.join(" or ")})`);
  }
  const rows = await ctx.db.query<Row>(`select t.id, t.number, t.question, t.answer, t.source_article_id, t.confidential from sm_kb_snippets t where ${where.join(" and ")} order by t.updated_at desc limit 3`, params);
  return rows.map((r) => ({ id: r.id, number: r.number ?? null, question: r.question, answer: r.answer, source_article_id: r.source_article_id ?? null, internal: r.confidential === true }));
}

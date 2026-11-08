// The knowledge event stream (KB-064; table sm_kb_events, migration 0045): searches with the normalised query and the
// number of results, article views, clicks on results (with their position), votes, flags, links to records,
// «مشکلم حل شد» deflections and the suggestions shown next to records. Writing an event never fails the request that
// caused it. Readers of the stream are the module's own aggregates (popular articles, recently viewed, search
// analytics, deflection); each runtime keeps its own stream.
import { uuidv7 } from "@shared/id";
import { searchForm } from "@shared/ai/text";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { pgArray } from "../../db";
import { personaOf } from "./common";

export type KbEventKind = "search" | "view" | "click" | "vote" | "rating" | "flag" | "link" | "unlink" | "deflect" | "suggest" | "create" | "attest" | "tree" | "ticket";

export interface KbEventInput {
  kind: KbEventKind;
  article_id?: string | null;
  record_table?: string | null;
  record_id?: string | null;
  query?: string | null;
  results?: number | null;
  position?: number | null;
  value?: number | null;
  session_id?: string | null;
  channel?: string | null;
  data?: Record<string, unknown> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** Append an event (best effort: a failure is logged, never thrown). */
export async function logEvent(q: Queryable, ctx: Ctx, e: KbEventInput): Promise<void> {
  try {
    const user = ctx.actor === "system" ? null : ctx.user.id;
    await q.query(
      `insert into sm_kb_events (id, org_id, kind, user_id, session_id, persona, channel, article_id, record_table, record_id, query, results, position, value, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        uuidv7(), ctx.org.id, e.kind, user, e.session_id ? String(e.session_id).slice(0, 80) : null, ctx.actor === "system" ? null : personaOf(ctx), e.channel ? String(e.channel).slice(0, 20) : null,
        uuidOrNull(e.article_id), e.record_table ? String(e.record_table).slice(0, 60) : null, uuidOrNull(e.record_id),
        e.query ? searchForm(e.query).slice(0, 300) : null, e.results ?? null, e.position ?? null, e.value ?? null, e.data ? JSON.stringify(e.data) : null,
      ],
    );
  } catch (err) {
    ctx.cfg.log?.warn?.("kb event not written", { err: String(err) });
  }
}

/** Was this member's view of this article logged in the last `minutes` (views count once per sitting)? */
export async function viewedRecently(q: Queryable, ctx: Ctx, articleId: string, minutes = 30): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const r = await q.one(`select 1 from sm_kb_events where org_id = $1 and kind = 'view' and user_id = $2 and article_id = $3 and at > now() - ($4 || ' minutes')::interval limit 1`, [ctx.org.id, ctx.user.id, articleId, String(minutes)]);
  return !!r;
}

/** The member's recently viewed articles (newest first, distinct). */
export async function recentlyViewed(q: Queryable, ctx: Ctx, limit = 8): Promise<string[]> {
  if (ctx.actor === "system") return [];
  const rows = await q.query<{ article_id: string }>(
    `select article_id from sm_kb_events where org_id = $1 and user_id = $2 and kind = 'view' and article_id is not null group by article_id order by max(at) desc limit $3`,
    [ctx.org.id, ctx.user.id, limit],
  );
  return rows.map((r) => r.article_id);
}

/** Views per article since `since` (for the counters and popularity). */
export async function viewCounts(q: Queryable, orgId: string, since: string | null, articleIds?: string[]): Promise<Map<string, number>> {
  const params: unknown[] = [orgId];
  let where = `org_id = $1 and kind = 'view' and article_id is not null`;
  if (since) {
    params.push(since);
    where += ` and at > $${params.length}`;
  }
  if (articleIds) {
    params.push(pgArray(articleIds));
    where += ` and article_id = any($${params.length}::uuid[])`;
  }
  const rows = await q.query<{ article_id: string; n: string | number }>(`select article_id, count(*) as n from sm_kb_events where ${where} group by article_id`, params);
  return new Map(rows.map((r) => [r.article_id, Number(r.n)]));
}

export interface QueryStat {
  query: string;
  searches: number;
  zero: number;
  clicks: number;
  last_at: string;
}

/** Search analytics over a window: top queries, zero-result queries, clicks (click-through), by normalised query. */
export async function queryStats(q: Queryable, orgId: string, days: number, opts: { zeroOnly?: boolean; limit?: number } = {}): Promise<QueryStat[]> {
  const rows = await q.query<{ query: string; searches: string | number; zero: string | number; clicks: string | number; last_at: string }>(
    `with s as (select query, session_id, at, results from sm_kb_events where org_id = $1 and kind = 'search' and query is not null and query <> '' and at > now() - ($2 || ' days')::interval),
          c as (select query, count(*) as clicks from sm_kb_events where org_id = $1 and kind = 'click' and query is not null and at > now() - ($2 || ' days')::interval group by query)
     select s.query, count(*) as searches, sum(case when coalesce(s.results, 0) = 0 then 1 else 0 end) as zero, coalesce(max(c.clicks), 0) as clicks, max(s.at) as last_at
       from s left join c on c.query = s.query
      group by s.query
     ${opts.zeroOnly ? "having sum(case when coalesce(s.results, 0) = 0 then 1 else 0 end) > 0" : ""}
      order by ${opts.zeroOnly ? "zero" : "searches"} desc, last_at desc
      limit $3`,
    [orgId, String(days), opts.limit ?? 20],
  );
  return rows.map((r) => ({ query: r.query, searches: Number(r.searches), zero: Number(r.zero), clicks: Number(r.clicks), last_at: r.last_at }));
}

/** Counts of event kinds over a window (dashboards). */
export async function eventTotals(q: Queryable, orgId: string, days: number): Promise<Record<string, number>> {
  const rows = await q.query<{ kind: string; n: string | number }>(`select kind, count(*) as n from sm_kb_events where org_id = $1 and at > now() - ($2 || ' days')::interval group by kind`, [orgId, String(days)]);
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
}

/** Forget events older than the retention (the sweep, daily). */
export async function pruneEvents(q: Queryable, orgId: string, days: number): Promise<number> {
  const rows = await q.query<{ id: string }>(`delete from sm_kb_events where org_id = $1 and at < now() - ($2 || ' days')::interval returning id`, [orgId, String(Math.max(30, days))]);
  return rows.length;
}

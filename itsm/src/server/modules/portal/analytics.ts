// Portal and conversation analytics (PTL-050, PTL-051) for the portal's administrators: adoption (people who opened
// the portal), searches and the zero-result share, the queries people type most (and those that find nothing — the
// knowledge gaps), AI answers, «مشکلم حل شد» deflections, orders and reports started from the portal, the virtual
// agent's conversations by channel and its containment (conversations that ended without a hand-off), the messaging
// connectors' traffic and the surveys' response rate and CSAT. Everything is counted in SQL; people's queries are
// shown only as aggregates (the most frequent), never with who typed them.
import type { PortalAnalytics } from "@shared/portal/api";
import { formatJalali } from "@shared/jalali";
import type { Ctx } from "../../context";
import { aggregate } from "../../engine";
import { forbidden } from "../../http/errors";
import { DAY_MS, liveRows, readsPortalAnalytics, sysOf } from "./common";

const n = (v: unknown) => Number(v ?? 0) || 0;

export async function portalAnalytics(ctx: Ctx, daysIn = 30): Promise<PortalAnalytics> {
  if (!(await readsPortalAnalytics(ctx))) throw forbidden("تحلیل درگاه را مدیران درگاه و گزارش‌ها می‌بینند");
  const days = Math.min(365, Math.max(7, Math.round(daysIn)));
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const org = ctx.org.id;
  const tz = String(ctx.org.settings?.timezone ?? "Asia/Tehran");
  const q = ctx.db;
  const [kinds, visitors, top, topZero, daily] = await Promise.all([
    q.query<{ kind: string; total: string; zero: string }>(`select kind, count(*) as total, count(*) filter (where results = 0) as zero from sm_portal_events where org_id = $1 and at >= $2 group by kind`, [org, since]),
    q.one<{ n: string }>(`select count(distinct user_id) as n from sm_portal_events where org_id = $1 and at >= $2 and user_id is not null`, [org, since]),
    q.query<{ query: string; n: string }>(`select query, count(*) as n from sm_portal_events where org_id = $1 and at >= $2 and kind = 'search' and query is not null group by query order by count(*) desc, query limit 15`, [org, since]),
    q.query<{ query: string; n: string }>(`select query, count(*) as n from sm_portal_events where org_id = $1 and at >= $2 and kind in ('search', 'public_search', 'widget_search') and results = 0 and query is not null group by query order by count(*) desc, query limit 15`, [org, since]),
    q.query<{ day: string; visitors: string; searches: string }>(
      `select to_char((at at time zone $3)::date, 'YYYY-MM-DD') as day, count(distinct user_id) as visitors, count(*) filter (where kind = 'search') as searches
       from sm_portal_events where org_id = $1 and at >= $2 group by 1 order by 1`,
      [org, since, tz],
    ),
  ]);
  const k = new Map(kinds.map((r) => [r.kind, { total: n(r.total), zero: n(r.zero) }]));
  const searches = k.get("search")?.total ?? 0;
  const zero = k.get("search")?.zero ?? 0;

  const sys = sysOf(ctx);
  const conv = await aggregate(sys, "va_conversation", { filter: { f: "created_at", op: "gte", v: since }, groupBy: ["channel"], metrics: [{ fn: "count" }] }).catch(() => null);
  const handed = await aggregate(sys, "va_conversation", { filter: { and: [{ f: "created_at", op: "gte", v: since }, { or: [{ f: "state", op: "eq", v: "handoff" }, { f: "handoff_id", op: "nempty" }] }] }, groupBy: [], metrics: [{ fn: "count" }] }).catch(() => null);
  const conversations = n(conv?.totals.count);
  const handoffs = n(handed?.totals.count);

  const channelRows = await liveRows(q, sys, "portal_channel", null, { order: "t.name", limit: 50 });
  const traffic = await q.query<{ channel_id: string; received: string; failed: string }>(
    `select channel_id, count(*) filter (where direction = 'in') as received, count(*) filter (where direction = 'out' and status = 'failed') as failed
     from sm_portal_channel_log where org_id = $1 and at >= $2 group by channel_id`,
    [org, since],
  );
  const linked = await aggregate(sys, "portal_channel_identity", { filter: { f: "active", op: "eq", v: true }, groupBy: ["channel_id"], metrics: [{ fn: "count" }] }).catch(() => null);
  const byChannel = new Map(traffic.map((t) => [t.channel_id, t]));
  const linkedBy = new Map((linked?.rows ?? []).map((r) => [String(r.keys[0]), n(r.values.count)]));

  const invited = await aggregate(sys, "survey_invitation", { filter: { f: "sent_at", op: "gte", v: since }, groupBy: [], metrics: [{ fn: "count" }] }).catch(() => null);
  const responses = await aggregate(sys, "survey_response", { filter: { and: [{ f: "submitted_at", op: "gte", v: since }, { f: "csat", op: "nempty" }] }, groupBy: ["satisfied"], metrics: [{ fn: "count" }] }).catch(() => null);
  const all = await aggregate(sys, "survey_response", { filter: { f: "submitted_at", op: "gte", v: since }, groupBy: [], metrics: [{ fn: "count" }] }).catch(() => null);
  let yes = 0;
  let rated = 0;
  for (const r of responses?.rows ?? []) {
    rated += n(r.values.count);
    if (r.keys[0] === true || r.keys[0] === "true") yes += n(r.values.count);
  }

  return {
    days,
    visitors: n(visitors?.n),
    searches,
    zero,
    zero_rate: searches ? Math.round((zero / searches) * 100) : null,
    answers: k.get("answer")?.total ?? 0,
    deflections: k.get("deflect")?.total ?? 0,
    orders: k.get("order")?.total ?? 0,
    reports: k.get("report")?.total ?? 0,
    top_queries: top.map((r) => ({ query: r.query, count: n(r.n) })),
    top_zero: topZero.map((r) => ({ query: r.query, count: n(r.n) })),
    chat: {
      conversations,
      handoffs,
      containment: conversations ? Math.round(((conversations - Math.min(handoffs, conversations)) / conversations) * 100) : null,
      by_channel: (conv?.rows ?? []).map((r) => ({ channel: String(r.keys[0] ?? "portal"), count: n(r.values.count) })),
    },
    channels: channelRows.map((c) => ({ name: String(c.name), kind: String(c.kind), received: n(byChannel.get(String(c.id))?.received), failed: n(byChannel.get(String(c.id))?.failed), linked: linkedBy.get(String(c.id)) ?? 0 })),
    surveys: { invited: n(invited?.totals.count), responses: n(all?.totals.count), csat_pct: rated ? Math.round((yes / rated) * 100) : null },
    daily: daily.map((d) => ({ day: d.day, label: formatJalali(d.day), visitors: n(d.visitors), searches: n(d.searches) })),
  };
}

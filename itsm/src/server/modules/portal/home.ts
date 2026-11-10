// The portal's home page and catalogue (PTL-001, PTL-005, PTL-008, PTL-013, PTL-014, PTL-049): everything is read with
// the person's own context — the catalogue as they are entitled to it (the request module's `browse`), knowledge they
// may read, announcements on air for their audience, their own records and approvals — except two counts that are
// organisation-wide by nature and never show a record: the trending order counts per catalogue item (only the
// ranking reaches the page) and the published status page. Quick links and topics are filtered by their audience
// with the person's context (`AUDIENCE_COND`). Each part fails on its own: the page shows what it could read.
import type { Cond } from "@shared/model/conditions";
import { AUDIENCE_COND, type WidgetType } from "@shared/portal/logic";
import { STATUS_RANK, type ServiceStatus } from "@shared/service_portfolio/logic";
import { tableDef } from "@shared/tables";
import type { ArticleLite, CategoryLite, ItemLite, LinkLite, PortalCatalog, PortalConfig, PortalHome, TopicLite, TopicPage } from "@shared/portal/api";
import type { Ctx } from "../../context";
import { aggregate, list } from "../../engine";
import { notFound } from "../../http/errors";
import { browse, type BrowseResult, type ItemCard } from "../request";
import { activeAnnouncements } from "../incident";
import { kbCards, cardsByIds, labelsOf } from "../knowledge";
import { myAttestations } from "../knowledge";
import { statusPage } from "../service_portfolio";
import { myApprovalCount } from "../sla";
import { DAY_MS, isUuid, liveRow, liveRows, moduleLinksFor, sysOf, type PortalModuleLink, type Row } from "./common";
import { favoritesOf } from "./config";
import { myItems } from "./items";
import { pendingInvitations } from "./surveys";
import { portalSections } from "../esm/portal";
import type { PortalSection } from "@shared/esm/portal";

const itemLite = (it: ItemCard, favs: Set<string>): ItemLite => ({
  id: it.id,
  name: it.name,
  short_description: it.short_description,
  icon: it.icon,
  color: it.color,
  category_id: it.category_id,
  type: it.type,
  orderable: it.orderable,
  promise: it.promise,
  favorite: favs.has(it.id),
});

const categoryLite = (c: BrowseResult["categories"][number]): CategoryLite => ({ id: c.id, name: c.name, description: c.description, icon: c.icon, count: c.count });

const linkLite = (r: Row): LinkLite => ({
  id: String(r.id),
  name: String(r.name),
  url: String(r.url ?? ""),
  description: (r.description as string) ?? null,
  icon: (r.icon as string) ?? null,
  section: (r.section_name as string) ?? null,
  new_tab: r.new_tab !== false,
});

const topicLite = (r: Row): TopicLite => ({ id: String(r.id), name: String(r.name), description: (r.description as string) ?? null, icon: (r.icon as string) ?? null, parent_id: isUuid(r.parent_id) ? String(r.parent_id) : null });

async function safeBrowse(ctx: Ctx, opts: Parameters<typeof browse>[1] = {}): Promise<BrowseResult | null> {
  try {
    return await browse(ctx, opts);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Popular, recent and favourite items (PTL-008)

const TRENDING_MS = 10 * 60_000;
const trendingCache = new Map<string, { at: number; ids: string[] }>();

/** Catalogue items ranked by orders over the last 90 days (organisation-wide counts; only the order is used). */
export async function trendingItemIds(ctx: Ctx): Promise<string[]> {
  const hit = trendingCache.get(ctx.org.id);
  if (hit && Date.now() - hit.at < TRENDING_MS) return hit.ids;
  let ids: string[] = [];
  try {
    const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
    const r = await aggregate(sysOf(ctx), "request_item", { filter: { f: "opened_at", op: "gte", v: since }, groupBy: ["cat_item_id"], metrics: [{ fn: "count" }], limit: 40 });
    ids = r.rows.map((x) => String(x.keys[0] ?? "")).filter(isUuid);
  } catch {
    ids = [];
  }
  trendingCache.set(ctx.org.id, { at: Date.now(), ids });
  return ids;
}

/** The distinct items the person ordered most recently (their own orders, read with their access). */
export async function recentItemIds(ctx: Ctx, limit = 10): Promise<string[]> {
  if (ctx.actor === "system") return [];
  try {
    const r = await list(ctx, "request_item", { filter: { or: [{ f: "requested_for", op: "is_me" }, { f: "opened_by", op: "is_me" }] }, sort: "-opened_at", fields: ["cat_item_id"], size: 60, total: false });
    const out: string[] = [];
    for (const row of r.rows) {
      const id = String(row.cat_item_id ?? "");
      if (isUuid(id) && !out.includes(id)) out.push(id);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function ranked(items: ItemCard[], order: string[]): ItemCard[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return items.filter((i) => at.has(i.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
}

/** Featured items first, then the most ordered (only items the person may see; information-only items last). */
function popularOf(items: ItemCard[], trending: string[], limit: number): ItemCard[] {
  const out: ItemCard[] = [];
  const add = (it: ItemCard) => {
    if (!out.some((x) => x.id === it.id)) out.push(it);
  };
  for (const it of items) if (it.featured && !it.hidden) add(it);
  for (const it of ranked(items, trending)) if (!it.hidden) add(it);
  for (const it of items) if (!it.hidden && it.orderable) add(it);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------------------------------------------
// Audience-filtered portal content

/** Rows of a portal content table the person is in the audience of (read with their own context). */
export async function audienceRows(ctx: Ctx, table: "portal_link" | "portal_topic", where: Cond | null = null, limit = 200): Promise<Row[]> {
  const cond: Cond = { and: [{ f: "active", op: "eq", v: true }, ...(ctx.actor === "system" ? [] : [AUDIENCE_COND]), ...(where ? [where] : [])] };
  try {
    return await liveRows(ctx.db, ctx, table, cond, { order: "t.sort_order, t.name", limit });
  } catch {
    return [];
  }
}

/** A module's page as a quick link (security's «گزارش ایمیل فیشینگ»…): opened in the app. */
const moduleLinkLite = (l: PortalModuleLink): LinkLite => ({
  id: `module:${l.key}`,
  name: l.name,
  url: l.path,
  description: l.description ?? null,
  icon: l.icon ?? null,
  section: l.section ?? null,
  new_tab: false,
  internal: true,
});

/** The portal's quick links for this member: the administrators' links, then the pages other modules registered. */
export async function quickLinks(ctx: Ctx, limit = 50): Promise<LinkLite[]> {
  const own = (await audienceRows(ctx, "portal_link", null, limit)).map(linkLite);
  const modules = ctx.actor === "system" ? [] : (await moduleLinksFor(ctx)).map(moduleLinkLite);
  return [...modules, ...own].slice(0, Math.max(1, limit));
}

export async function topics(ctx: Ctx, parent: string | null = null): Promise<TopicLite[]> {
  return (await audienceRows(ctx, "portal_topic", parent ? { f: "parent_id", op: "eq", v: parent } : { f: "parent_id", op: "empty" })).map(topicLite);
}

/** Article cards by id, as the person may read them (agents-only articles left out). */
async function articlesByIds(ctx: Ctx, ids: string[]): Promise<ArticleLite[]> {
  if (!ids.length) return [];
  try {
    const rows = await cardsByIds(ctx, ids);
    const labels = await labelsOf(ctx, rows);
    return rows
      .filter((r) => r.confidential !== true && r.visibility !== "internal")
      .map((r) => ({ id: String(r.id), number: (r.number as string) ?? null, title: String(r.title ?? ""), summary: (r.summary as string) ?? null, base_name: labels.bases.get(String(r.base_id)) ?? null, helpful_yes: Number(r.helpful_yes ?? 0) }));
  } catch {
    return [];
  }
}

/** A topic's page: what sits under it, each part read with the person's access and filtered by audience. */
export async function topicPage(ctx: Ctx, id: string): Promise<TopicPage> {
  if (!isUuid(id)) throw notFound("موضوع پیدا نشد");
  const [row] = await audienceRows(ctx, "portal_topic", { f: "id", op: "eq", v: id }, 1);
  if (!row) throw notFound("موضوع پیدا نشد");
  const path: TopicLite[] = [];
  for (let cur = isUuid(row.parent_id) ? String(row.parent_id) : null, i = 0; cur && i < 10; i++) {
    const p = await liveRow(ctx.db, ctx, "portal_topic", cur).catch(() => null);
    if (!p) break;
    path.unshift(topicLite(p));
    cur = isUuid(p.parent_id) ? String(p.parent_id) : null;
  }
  const favs = new Set(await favoritesOf(ctx));
  const itemIds = Array.isArray(row.items) ? (row.items as string[]).filter(isUuid) : [];
  const b = itemIds.length ? await safeBrowse(ctx, { ids: itemIds }) : null;
  const linkIds = new Set(Array.isArray(row.links) ? (row.links as string[]) : []);
  const links = linkIds.size ? (await audienceRows(ctx, "portal_link", { f: "id", op: "in", v: [...linkIds] })).map(linkLite) : [];
  return {
    topic: topicLite(row),
    path,
    children: await topics(ctx, id),
    items: (b?.items ?? []).map((i) => itemLite(i, favs)),
    articles: await articlesByIds(ctx, Array.isArray(row.articles) ? (row.articles as string[]).filter(isUuid) : []),
    links,
  };
}

/** The catalogue as the person may order from it, with their favourites and recent items (PTL-008). */
export async function catalogPage(ctx: Ctx, opts: { category?: string | null; q?: string | null } = {}): Promise<PortalCatalog> {
  const b = await browse(ctx, { category: opts.category ?? null, q: opts.q ?? null });
  const favs = await favoritesOf(ctx);
  const favSet = new Set(favs);
  const recentIds = opts.q || opts.category ? [] : await recentItemIds(ctx, 8);
  const all = recentIds.length ? ((await safeBrowse(ctx, { ids: recentIds }))?.items ?? []) : [];
  return {
    categories: b.categories.map(categoryLite),
    items: b.items.map((i) => itemLite(i, favSet)),
    favorites: favs,
    recent: ranked(all, recentIds).map((i) => itemLite(i, favSet)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Today's service status

const OUTAGE_STATUS: Record<string, ServiceStatus> = { outage: "major_outage", degradation: "degraded", planned: "maintenance" };

/**
 * The service status card: the services the organisation publishes on its status page (the service portfolio's status
 * of each business service, never a CI), each at least as bad as an ongoing outage the continuity module recorded on it
 * (a full outage with partial impact counts as a partial outage). Only the service's name, status and the owner's
 * published note reach the page — never an outage's title, cause, CI or incident.
 */
export async function statusCard(ctx: Ctx): Promise<PortalHome["status"]> {
  const p = await statusPage(ctx, { days: 7 });
  if (!p.services.length) return null;
  const worse = new Map<string, ServiceStatus>();
  if (tableDef("outage")) {
    const ids = p.services.map((s) => s.id).filter(isUuid);
    const ongoing = ids.length
      ? await liveRows(ctx.db, sysOf(ctx), "outage", { and: [{ f: "state", op: "eq", v: "ongoing" }, { f: "service_id", op: "in", v: ids }, { f: "begin_at", op: "lte", v: new Date().toISOString() }] }, { limit: 500 }).catch(() => [] as Row[])
      : [];
    for (const o of ongoing) {
      let st = OUTAGE_STATUS[String(o.outage_type)] ?? "degraded";
      if (st === "major_outage" && Number(o.impact_pct ?? 100) < 100) st = "partial_outage";
      const cur = worse.get(String(o.service_id));
      if (!cur || STATUS_RANK[st] > STATUS_RANK[cur]) worse.set(String(o.service_id), st);
    }
  }
  const rows = p.services.map((s) => {
    const o = worse.get(s.id);
    return { name: s.name, status: o && STATUS_RANK[o] > STATUS_RANK[s.status] ? o : s.status, note: s.note };
  });
  rows.sort((a, x) => STATUS_RANK[x.status] - STATUS_RANK[a.status]);
  const overall = rows.reduce<ServiceStatus>((acc, r) => (STATUS_RANK[r.status] > STATUS_RANK[acc] ? r.status : acc), p.overall);
  return { overall, services: rows.slice(0, 8) };
}

// ---------------------------------------------------------------------------------------------------------------
// The home page

async function part<T>(on: boolean, fn: () => Promise<T>, empty: T): Promise<T> {
  if (!on) return empty;
  try {
    return await fn();
  } catch {
    return empty;
  }
}

/** Everything the enabled widgets of the person's home page show, in one answer. */
export async function portalHome(ctx: Ctx, cfg: PortalConfig): Promise<PortalHome> {
  const on = new Map<WidgetType, number>();
  for (const w of cfg.layout) if (w.enabled) on.set(w.type, w.limit ?? 6);
  const has = (t: WidgetType) => on.has(t);
  const lim = (t: WidgetType, d: number) => on.get(t) ?? d;
  const needCatalog = has("popular") || has("favorites") || has("categories");
  const b = needCatalog ? await safeBrowse(ctx) : null;
  const favList = await favoritesOf(ctx);
  const favs = new Set(favList);

  const [announcements, approvals, surveys, acks, open, trending, recent, links, topicRows, knowledge, status] = await Promise.all([
    part(has("announcements"), async () => (await activeAnnouncements(ctx)).items, []),
    part(has("actions"), () => myApprovalCount(ctx), 0),
    part(has("actions"), async () => (await pendingInvitations(ctx)).length, 0),
    part(has("actions"), async () => (await myAttestations(ctx)).filter((a) => !a.acked_at).length, 0),
    part(has("my_items") || has("actions"), () => myItems(ctx, { tab: "mine", state: "open", page: 1, size: Math.max(lim("my_items", 4), 20) }), null),
    part(has("popular") && !!b, () => trendingItemIds(ctx), [] as string[]),
    part(has("favorites") && !!b, () => recentItemIds(ctx, 8), [] as string[]),
    part(has("links"), () => quickLinks(ctx, lim("links", 8)), [] as LinkLite[]),
    part(has("topics"), () => topics(ctx), [] as TopicLite[]),
    part(has("knowledge"), async () => {
      // the cards alone: the knowledge home's per-base counts and queues are not shown here
      const h = await kbCards(ctx, lim("knowledge", 5));
      const cards = [...h.popular, ...h.featured, ...h.recent].filter((c, i, a) => !c.internal && a.findIndex((x) => x.id === c.id) === i);
      return cards.slice(0, lim("knowledge", 5)).map((c) => ({ id: c.id, number: c.number, title: c.title, summary: c.summary, base_name: c.base_name, helpful_yes: c.helpful_yes }) as ArticleLite);
    }, [] as ArticleLite[]),
    part(has("status"), () => statusCard(ctx), null as PortalHome["status"]),
  ]);
  // the sections the service modules publish for the person (each source fails on its own inside portalSections)
  const sections = await part(has("departments"), () => portalSections(ctx), [] as PortalSection[]);

  const items = b?.items ?? [];
  const favItems = items.filter((i) => favs.has(i.id));
  const recentItems = ranked(items, recent).filter((i) => !favs.has(i.id));
  return {
    announcements,
    actions: { approvals, surveys, acknowledgements: acks, waiting_you: open ? open.items.filter((i) => i.stage === "waiting_you").length : 0 },
    my: { open: open?.total ?? 0, items: (open?.items ?? []).slice(0, lim("my_items", 4)) },
    popular: popularOf(items, trending, lim("popular", 6)).map((i) => itemLite(i, favs)),
    favorites: [...favItems, ...recentItems].slice(0, lim("favorites", 6)).map((i) => itemLite(i, favs)),
    categories: (b?.categories ?? []).filter((c) => !c.parent_id).slice(0, lim("categories", 8)).map(categoryLite),
    topics: topicRows.slice(0, lim("topics", 8)),
    links,
    knowledge,
    status,
    sections,
  };
}

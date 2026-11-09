// The portal's universal search (PTL-006): one box over knowledge (the knowledge module's Persian search: glossary,
// rules, semantic fusion — with the person's access), the catalogue as they may order from it, their own records,
// quick links, topics and announcements on air for them. Every source reads with the person's context; Persian typing
// differences are folded (`normalizeSearch`). Each search is logged (the query's search form and how many results),
// so zero-result queries reach the analytics and knowledge gaps (PTL-050).
import { normalizeSearch } from "@shared/model/conditions";
import type { PortalSearchHit, PortalSearchResult } from "@shared/portal/api";
import type { Ctx } from "../../context";
import { browse } from "../request";
import { searchKnowledge } from "../knowledge";
import { activeAnnouncements } from "../incident";
import { logEvent, moduleLinksFor } from "./common";
import { audienceRows } from "./home";
import { myItems } from "./items";

const norm = (s: unknown) => normalizeSearch(String(s ?? "")).toLowerCase();

/** Every word of the query appears in the text (Persian-normalised). */
function matches(text: string, q: string): boolean {
  const t = norm(text);
  return norm(q).split(/\s+/).filter((w) => w.length > 1).every((w) => t.includes(w));
}

const excerpt = (s: unknown, n = 160): string | null => {
  const t = String(s ?? "").replace(/[#*_>`[\]()]/g, " ").replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null;
};

async function safe<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return empty;
  }
}

/** Search everything the person may see (see the file's head); `log: false` for type-ahead. */
export async function portalSearch(ctx: Ctx, qIn: string, opts: { session?: string | null; log?: boolean; size?: number } = {}): Promise<PortalSearchResult> {
  const q = qIn.trim().slice(0, 200);
  const size = Math.min(10, Math.max(3, opts.size ?? 6));
  const empty: PortalSearchResult = { q, hits: [], counts: { article: 0, item: 0, record: 0, link: 0, topic: 0, announcement: 0 }, zero: false };
  if (q.length < 2) return empty;

  const [kb, catalog, records, links, topicRows, announcements] = await Promise.all([
    safe(() => searchKnowledge(ctx, { q, size, channel: "portal", session_id: opts.session ?? null, log: opts.log !== false }), null),
    safe(() => browse(ctx, { q }), null),
    safe(() => myItems(ctx, { tab: "mine", state: "all", q, page: 1, size: 5 }), null),
    safe(() => audienceRows(ctx, "portal_link"), []),
    safe(() => audienceRows(ctx, "portal_topic"), []),
    safe(async () => (await activeAnnouncements(ctx)).items, []),
  ]);
  // pages other modules offer every member (security's «گزارش ایمیل فیشینگ»…), opened in the app
  const moduleLinks = await safe(() => moduleLinksFor(ctx), []);

  const hits: PortalSearchHit[] = [];
  for (const h of (kb?.hits ?? []).filter((x) => !x.internal).slice(0, size)) hits.push({ kind: "article", id: h.id, title: h.title, snippet: h.snippet || h.summary, path: `portal/kb/${h.id}`, meta: h.base_name });
  for (const it of (catalog?.items ?? []).slice(0, size)) hits.push({ kind: "item", id: it.id, title: it.name, snippet: it.short_description, path: `portal/items/${it.id}`, meta: it.promise || null });
  for (const r of records?.items ?? []) hits.push({ kind: "record", id: r.id, title: r.title, snippet: null, path: `portal/t/${r.table}/${r.id}`, meta: [r.number, r.stage_label].filter(Boolean).join(" · ") });
  for (const l of links.filter((x) => matches(`${x.name} ${x.description ?? ""} ${x.section_name ?? ""}`, q)).slice(0, size)) hits.push({ kind: "link", id: String(l.id), title: String(l.name), snippet: (l.description as string) ?? null, path: String(l.url), external: true });
  for (const l of moduleLinks.filter((x) => matches(`${x.name} ${x.description ?? ""} ${x.keywords ?? ""}`, q)).slice(0, 3)) hits.push({ kind: "link", id: `module:${l.key}`, title: l.name, snippet: l.description ?? null, path: l.path });
  for (const t of topicRows.filter((x) => matches(`${x.name} ${x.description ?? ""}`, q)).slice(0, size)) hits.push({ kind: "topic", id: String(t.id), title: String(t.name), snippet: (t.description as string) ?? null, path: `portal/topics/${t.id}` });
  for (const a of announcements.filter((x) => matches(`${x.title} ${x.body ?? ""}`, q)).slice(0, 3)) hits.push({ kind: "announcement", id: a.id, title: a.title, snippet: excerpt(a.body), path: "portal" });

  const counts = { article: 0, item: 0, record: 0, link: 0, topic: 0, announcement: 0 } as PortalSearchResult["counts"];
  for (const h of hits) counts[h.kind]++;
  const result: PortalSearchResult = { q, hits, counts, zero: hits.length === 0 };
  if (opts.log !== false) await logEvent(ctx.db, ctx, { kind: "search", query: q, results: hits.length, session_id: opts.session ?? null });
  return result;
}

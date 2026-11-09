// Public knowledge (KB-031, anonymous read ACC-004): bases an organisation publishes on purpose, read without sign-in at
// /p/kb/<token> through /api/public/portal/kb/<token>/… (rate limited, noindex). Nothing else is reachable:
//   · a publication names bases; only those that are open to every reader of knowledge count — external, «همهٔ
//     خوانندگان دانش», not agents-only, no «هرگز نبینند» list, active;
//   · from them only articles that are live (published or pending retirement), classified «عمومی», not agents-only,
//     without a narrowed audience or a deny list, and outside categories that narrow their audience;
//   · what goes out is a projection: title, summary, body (published reusable blocks that are not agents-only are
//     expanded; images and links to articles that are not public become plain text; the internal section never),
//     the base's name and the publication date — no record ids, numbers or people. Articles and bases are named by
//     opaque slugs: their ids under a permutation keyed by the runtime's secret and the publication's token (AES on
//     the 16 bytes of the id), so a slug means nothing elsewhere and a new token changes every address.
// A guest's vote («مفید بود؟») goes into the portal's event stream (knowledge feedback needs a member).
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { Cond } from "@shared/model/conditions";
import { blockRefs } from "@shared/knowledge/logic";
import { LIVE_STATES } from "@shared/tables/knowledge";
import type { PublicKbArticle, PublicKbCard, PublicKbHome } from "@shared/portal/api";
import type { Ctx, ServerConfig } from "../../context";
import { systemCtx, updateIn } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { isUuid, liveRow, liveRows, logPortalEvent, publishesKnowledge, sysOf, type Row } from "./common";

// ---------------------------------------------------------------------------------------------------------------
// Slugs

const keyOf = (secret: string, token: string) => createHmac("sha256", secret).update(`portal.kb:${token}`).digest();

export function slugOf(secret: string, token: string, id: string): string {
  const c = createCipheriv("aes-256-ecb", keyOf(secret, token), null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(Buffer.from(id.replace(/-/g, ""), "hex")), c.final()]).toString("base64url");
}

export function idOfSlug(secret: string, token: string, slug: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) return null;
  const raw = Buffer.from(slug, "base64url");
  if (raw.length !== 16) return null;
  const d = createDecipheriv("aes-256-ecb", keyOf(secret, token), null);
  d.setAutoPadding(false);
  const h = Buffer.concat([d.update(raw), d.final()]).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// What is public

/** Bases that may be public: open to every knowledge reader. */
export const PUBLIC_BASE: Cond = {
  and: [
    { f: "kind", op: "eq", v: "external" },
    { f: "read_mode", op: "eq", v: "everyone" },
    { f: "confidential", op: "ne", v: true },
    { f: "state", op: "eq", v: "active" },
    { f: "deny_users", op: "empty" },
    { f: "deny_groups", op: "empty" },
    { f: "deny_units", op: "empty" },
  ],
};

/** Articles that may be public, inside the given (public) bases. */
export function publicArticles(bases: string[]): Cond {
  return {
    and: [
      { f: "base_id", op: "in", v: bases },
      { f: "state", op: "in", v: LIVE_STATES },
      { f: "classification", op: "eq", v: "public" },
      { f: "visibility", op: "ne", v: "internal" },
      { f: "confidential", op: "ne", v: true },
      { f: "audience_mode", op: "ne", v: "narrow" },
      { f: "deny_users", op: "empty" },
      { f: "deny_groups", op: "empty" },
      { f: "deny_units", op: "empty" },
      { or: [{ f: "category_id", op: "empty" }, { f: "category_id.c_all", op: "eq", v: true }] },
    ],
  };
}

interface Pub {
  sys: Ctx;
  row: Row;
  token: string;
  bases: Row[];
}

/** The publication a token opens (active, on this runtime), with its bases that may be public. */
async function openPublication(cfg: ServerConfig, token: string): Promise<Pub> {
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) throw notFound("صفحهٔ دانش پیدا نشد");
  const hit = await cfg.db.one<{ id: string; org_id: string }>(`select id, org_id from sm_portal_kb_publications where token = $1 and active = true and deleted_at is null limit 1`, [token]).catch(() => null);
  if (!hit) throw notFound("صفحهٔ دانش پیدا نشد");
  const sys = await systemCtx(cfg, hit.org_id);
  const row = await liveRow(sys.db, sys, "portal_kb_publication", hit.id);
  if (!row || row.active !== true) throw notFound("صفحهٔ دانش پیدا نشد");
  const ids = Array.isArray(row.bases) ? (row.bases as string[]).filter(isUuid) : [];
  const bases = ids.length ? await liveRows(sys.db, sys, "kb_base", { and: [{ f: "id", op: "in", v: ids }, PUBLIC_BASE] }, { order: "t.sort_order, t.name", limit: 50 }) : [];
  return { sys, row, token, bases };
}

const CARD_ORDER = "t.view_count desc nulls last, t.published_at desc nulls last, t.id";

function cardOf(p: Pub, a: Row): PublicKbCard {
  const base = p.bases.find((b) => b.id === a.base_id);
  return { slug: slugOf(p.sys.cfg.secret, p.token, String(a.id)), title: String(a.title ?? ""), summary: (a.summary as string) ?? null, base: base ? String(base.name) : null, updated: (a.published_at as string) ?? null };
}

const articleRows = (p: Pub, extra: Cond | null, order = CARD_ORDER, limit = 20) =>
  p.bases.length ? liveRows(p.sys.db, p.sys, "kb_article", extra ? { and: [publicArticles(p.bases.map((b) => String(b.id))), extra] } : publicArticles(p.bases.map((b) => String(b.id))), { order, limit }) : Promise.resolve([] as Row[]);

/** The public home page of a publication. */
export async function publicKbHome(cfg: ServerConfig, token: string): Promise<PublicKbHome> {
  const p = await openPublication(cfg, token);
  const counts = new Map<string, number>();
  for (const b of p.bases) counts.set(String(b.id), (await articleRows(p, { f: "base_id", op: "eq", v: b.id }, "t.id", 2000)).length);
  const [popular, recent] = await Promise.all([articleRows(p, null, CARD_ORDER, 8), articleRows(p, null, "t.published_at desc nulls last, t.id", 8)]);
  await logPortalEvent(p.sys.db, p.sys.org.id, null, { kind: "public_view", channel: "public" });
  return {
    title: String(p.row.title ?? "مرکز راهنما"),
    intro: (p.row.intro as string) ?? null,
    bases: p.bases.map((b) => ({ key: slugOf(cfg.secret, token, String(b.id)), name: String(b.name), description: (b.description as string) ?? null, count: counts.get(String(b.id)) ?? 0 })),
    popular: popular.map((a) => cardOf(p, a)),
    recent: recent.map((a) => cardOf(p, a)),
    feedback: p.row.allow_feedback !== false,
  };
}

/** Search the public articles (every word in the title, summary, body or keywords; Persian-normalised). */
export async function publicKbSearch(cfg: ServerConfig, token: string, qIn: string, baseKey?: string | null, channel: "public" | "widget" = "public"): Promise<{ hits: PublicKbCard[] }> {
  const p = await openPublication(cfg, token);
  const q = qIn.trim().slice(0, 120);
  const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return { hits: [] };
  const and: Cond[] = words.map((w) => ({ or: ["title", "summary", "body", "keywords"].map((f) => ({ f, op: "contains" as const, v: w })) }));
  const baseId = baseKey ? idOfSlug(cfg.secret, token, baseKey) : null;
  if (baseId) and.push({ f: "base_id", op: "eq", v: baseId });
  const rows = await articleRows(p, { and }, CARD_ORDER, 20);
  await logPortalEvent(p.sys.db, p.sys.org.id, null, { kind: channel === "widget" ? "widget_search" : "public_search", channel, query: q, results: rows.length });
  return { hits: rows.map((a) => cardOf(p, a)) };
}

/** A public article by its slug (404 when it is not public). */
async function publicArticle(p: Pub, slug: string): Promise<Row> {
  const id = idOfSlug(p.sys.cfg.secret, p.token, slug);
  if (!id) throw notFound("مقاله پیدا نشد");
  const [a] = await articleRows(p, { f: "id", op: "eq", v: id }, "t.id", 1);
  if (!a) throw notFound("مقاله پیدا نشد");
  return a;
}

/** The body as published for guests (see the file's head). */
async function publicBody(p: Pub, md: string): Promise<string> {
  let text = String(md ?? "");
  const refs = blockRefs(text);
  if (refs.length) {
    const rows = await liveRows(p.sys.db, p.sys, "kb_block", { and: [{ f: "number", op: "in", v: refs }, { f: "state", op: "eq", v: "published" }, { f: "confidential", op: "ne", v: true }] }, { limit: 200 });
    const by = new Map(rows.map((r) => [String(r.number).toUpperCase(), String(r.body ?? "")]));
    text = text.replace(/\{\{\s*block\s*:\s*([A-Za-z]{1,6}-?\d{1,12})\s*\}\}/g, (_m, n: string) => by.get(n.toUpperCase().replace("-", "")) ?? "");
  }
  // images (attachments need a member's session) become their description
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string) => (alt.trim() ? `(تصویر: ${alt.trim()})` : ""));
  // links to other articles: their public address when they are public, else plain text; in-app paths become text
  const numbers = [...new Set([...text.matchAll(/\]\(kb:(KB-?\d{1,9})\)/gi)].map((m) => m[1].toUpperCase().replace("-", "")))];
  const slugs = new Map<string, string>();
  if (numbers.length) for (const a of await articleRows(p, { f: "number", op: "in", v: numbers }, "t.id", 200)) slugs.set(String(a.number).toUpperCase(), slugOf(p.sys.cfg.secret, p.token, String(a.id)));
  text = text.replace(/\[([^\]]+)\]\(kb:(KB-?\d{1,9})\)/gi, (_m, label: string, n: string) => {
    const s = slugs.get(n.toUpperCase().replace("-", ""));
    return s ? `[${label}](/p/kb/${p.token}/a/${s})` : label;
  });
  text = text.replace(/\[([^\]]+)\]\((\/(?!p\/)[^)]*)\)/g, (_m, label: string) => label);
  return text;
}

export async function publicKbArticle(cfg: ServerConfig, token: string, slug: string): Promise<PublicKbArticle> {
  const p = await openPublication(cfg, token);
  const a = await publicArticle(p, slug);
  const related = a.category_id ? await articleRows(p, { and: [{ f: "category_id", op: "eq", v: a.category_id }, { f: "id", op: "ne", v: a.id }] }, CARD_ORDER, 5) : [];
  await logPortalEvent(p.sys.db, p.sys.org.id, null, { kind: "public_view", channel: "public", ref_table: "kb_article", ref_id: String(a.id) });
  return { ...cardOf(p, a), body: await publicBody(p, String(a.body ?? "")), related: related.map((r) => cardOf(p, r)), feedback: p.row.allow_feedback !== false };
}

/** A guest's «مفید بود؟» (the portal's event stream; one per guest is not enforced — it is a signal, rate limited). */
export async function publicKbVote(cfg: ServerConfig, token: string, slug: string, helpful: boolean): Promise<{ ok: true }> {
  const p = await openPublication(cfg, token);
  if (p.row.allow_feedback === false) throw forbidden("بازخورد برای این صفحه بسته است");
  const a = await publicArticle(p, slug);
  await logPortalEvent(p.sys.db, p.sys.org.id, null, { kind: "public_vote", channel: "public", value: helpful ? 1 : 0, ref_table: "kb_article", ref_id: String(a.id) });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Administration (knowledge publishers)

export interface PublicationView {
  id: string;
  name: string;
  active: boolean;
  url: string | null;
  bases: { id: string; name: string; public: boolean; articles: number; held_back: number }[];
}

/** The publications with their link and what each base publishes or holds back. */
export async function publications(ctx: Ctx): Promise<PublicationView[]> {
  if (!(await publishesKnowledge(ctx))) throw forbidden("انتشار عمومی دانش با تأییدکنندگان و مدیران دانش است");
  const sys = sysOf(ctx);
  const rows = await liveRows(ctx.db, sys, "portal_kb_publication", null, { order: "t.name", limit: 50 });
  const out: PublicationView[] = [];
  for (const r of rows) {
    const ids = Array.isArray(r.bases) ? (r.bases as string[]).filter(isUuid) : [];
    const bases = ids.length ? await liveRows(ctx.db, sys, "kb_base", { f: "id", op: "in", v: ids }, { limit: 50 }) : [];
    const open = new Set((ids.length ? await liveRows(ctx.db, sys, "kb_base", { and: [{ f: "id", op: "in", v: ids }, PUBLIC_BASE] }, { limit: 50 }) : []).map((b) => String(b.id)));
    const view: PublicationView = { id: String(r.id), name: String(r.name), active: r.active === true, url: r.active === true && r.token ? `${(ctx.cfg.publicUrl ?? "").replace(/\/+$/, "")}/p/kb/${r.token}` : null, bases: [] };
    for (const b of bases) {
      const live = await liveRows(ctx.db, sys, "kb_article", { and: [{ f: "base_id", op: "eq", v: b.id }, { f: "state", op: "in", v: LIVE_STATES }] }, { order: "t.id", limit: 5000 });
      const pub = open.has(String(b.id)) ? (await liveRows(ctx.db, sys, "kb_article", publicArticles([String(b.id)]), { order: "t.id", limit: 5000 })).length : 0;
      view.bases.push({ id: String(b.id), name: String(b.name), public: open.has(String(b.id)), articles: pub, held_back: live.length - pub });
    }
    out.push(view);
  }
  return out;
}

/** Turn a publication's public link on or off, or give it a new address. */
export async function setPublication(ctx: Ctx, id: string, input: { enabled: boolean; regenerate?: boolean }): Promise<{ enabled: boolean; url: string | null }> {
  if (!(await publishesKnowledge(ctx))) throw forbidden("انتشار عمومی دانش با تأییدکنندگان و مدیران دانش است");
  if (input.enabled && ctx.cfg.mode === "desktop") throw bad("دانش عمومی فقط در نسخهٔ وب منتشر می‌شود");
  const sys = sysOf(ctx);
  return ctx.write(async (tx) => {
    const row = await liveRow(tx, sys, "portal_kb_publication", id);
    if (!row) throw notFound("انتشار پیدا نشد");
    if (input.enabled && !(Array.isArray(row.bases) && (row.bases as string[]).length)) throw bad("دست‌کم یک پایگاه دانش را برگزینید");
    const token = input.regenerate || !row.token ? randomBytes(24).toString("base64url") : String(row.token);
    await updateIn(tx, sys, "portal_kb_publication", id, { active: input.enabled, token, ...(input.enabled ? { published_at: new Date().toISOString(), published_by: ctx.user.id } : {}) }, { trusted: true });
    return { enabled: input.enabled, url: input.enabled ? `${(ctx.cfg.publicUrl ?? "").replace(/\/+$/, "")}/p/kb/${token}` : null };
  });
}

/** The token of a publication (the widget's guest search), when it is on. */
export async function publicationToken(sys: Ctx, id: unknown): Promise<string | null> {
  if (!isUuid(id)) return null;
  const row = await liveRow(sys.db, sys, "portal_kb_publication", id);
  return row && row.active === true && typeof row.token === "string" ? row.token : null;
}

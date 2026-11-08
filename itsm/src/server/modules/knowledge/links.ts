// Articles in the flow of work (KB-042, KB-046): typed engine links from a record (incident, problem, request, change…)
// to an article — «حل‌شده با» (solved by), «راه‌حل موقت از» (workaround applied), «مرتبط با» — and from an article to the
// record it was written from («ساخته‌شده از»). Linking needs write access to the record and read access to the article
// (the engine's rule); unlinking needs a reason, written as an internal note on the record. Reuse is the number of
// distinct records that were solved or worked around with the article — not page views — recounted on every change.
import { registerLinkKind } from "@shared/model/links";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, addLink, defFor, get, listLinks, removeLink, updateIn, type LinkView } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { requesterOnly } from "../incident/common";
import { articleOf, isUuid, liveRow, sysOf } from "./common";
import { logEvent } from "./events";

export const KB_LINK_KINDS = {
  kb_solved_by: { out: "حل‌شده با مقالهٔ", in: "راه‌حلِ" },
  kb_workaround: { out: "راه‌حل موقت از مقالهٔ", in: "راه‌حل موقتِ" },
  kb_related: { out: "مقالهٔ مرتبط", in: "مرتبط با رکورد" },
  kb_created_from: { out: "ساخته‌شده از", in: "مقالهٔ ساخته‌شده از این رکورد" },
} as const;
export type KbLinkKind = keyof typeof KB_LINK_KINDS;
/** Kinds that count as reuse of an article. */
export const REUSE_KINDS: KbLinkKind[] = ["kb_solved_by", "kb_workaround"];

export function installLinkKinds(): void {
  for (const [k, v] of Object.entries(KB_LINK_KINDS)) registerLinkKind(k, v);
}

/** Distinct records solved or worked around with the article, and when last (raw count over the engine's link table). */
export async function reuseOf(q: Queryable, orgId: string, articleId: string): Promise<{ count: number; last: string | null }> {
  const r = await q.one<{ n: string | number; last: string | null }>(
    `select count(distinct from_id) as n, max(created_at) as last from sm_links where org_id = $1 and to_table = 'kb_article' and to_id = $2 and kind = any($3::text[]) and deleted_at is null`,
    [orgId, articleId, `{${REUSE_KINDS.join(",")}}`],
  );
  return { count: Number(r?.n ?? 0), last: r?.last ?? null };
}

/** Keep the article's reuse counter in step with its links (as the system). */
export async function recountReuse(tx: Tx, ctx: Ctx, articleId: string): Promise<number> {
  const sys = sysOf(ctx);
  const a = await articleOf(tx, sys, articleId);
  if (!a) return 0;
  const { count, last } = await reuseOf(tx, ctx.org.id, articleId);
  if (Number(a.reuse_count ?? 0) !== count || (last && a.last_used_at !== last)) {
    await updateIn(tx, sys, "kb_article", articleId, { reuse_count: count, last_used_at: last ?? a.last_used_at ?? null }, { trusted: true, keepVersion: true, allowLocked: true });
  }
  return count;
}

export interface LinkedArticle {
  link_id: string;
  kind: string;
  label: string;
  article: { id: string; number: string | null; title: string; state: string | null; state_label: string | null };
  created_at: string;
  created_by: string | null;
}

/** Articles linked to a record, as the caller may see them. */
export async function linkedArticles(ctx: Ctx, table: string, id: string): Promise<LinkedArticle[]> {
  const { links } = await listLinks(ctx, table, id);
  return links
    .filter((l: LinkView) => l.other.table === "kb_article" && l.kind in KB_LINK_KINDS)
    .map((l) => ({ link_id: l.id, kind: l.kind, label: l.label, article: { id: l.other.id, number: l.other.number, title: l.other.display, state: l.other.state, state_label: l.other.state_label }, created_at: l.created_at, created_by: l.created_by }));
}

/** Attach an article to a record (the caller writes the record and reads the article). */
/**
 * Does the caller work records of this table (an agent's write scope, not the requester side)? Reuse is the desk's
 * judgement that an article solved a record; a requester's write access to their own record does not make one.
 */
export async function worksRecords(ctx: Ctx, table: string): Promise<boolean> {
  if (ctx.actor === "system") return true;
  const { def } = await defFor(ctx, table);
  return !requesterOnly(ctx, def.area);
}

export async function attachArticle(ctx: Ctx, input: { table: string; id: string; article_id: string; kind?: KbLinkKind; note?: string | null; query?: string | null; session_id?: string | null }) {
  const kind = input.kind ?? "kb_solved_by";
  if (!(await worksRecords(ctx, input.table))) throw forbidden("پیوند مقاله به رکورد با کارشناسانی است که روی آن کار می‌کنند");
  if (!(kind in KB_LINK_KINDS) || kind === "kb_created_from") throw bad("نوع پیوند معتبر نیست");
  if (!isUuid(input.id) || !isUuid(input.article_id)) throw bad("شناسه معتبر نیست");
  await get(ctx, "kb_article", input.article_id); // 404 unless readable
  const existing = (await linkedArticles(ctx, input.table, input.id)).find((l) => l.article.id === input.article_id && l.kind === kind);
  const link = existing ? null : await addLink(ctx, input.table, input.id, { kind, table: "kb_article", id: input.article_id, note: input.note ?? null });
  const reuse = await ctx.write((tx) => recountReuse(tx, ctx, input.article_id));
  await logEvent(ctx.db, ctx, { kind: "link", article_id: input.article_id, record_table: input.table, record_id: input.id, query: input.query ?? null, session_id: input.session_id ?? null, channel: "record", data: { kind } });
  return { link_id: link?.id ?? existing!.link_id, reuse_count: reuse, already: !!existing };
}

/** Detach an article from a record, with a reason kept as an internal note on the record. */
export async function detachArticle(ctx: Ctx, input: { table: string; id: string; link_id: string; reason: string }) {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw bad("دلیل جدا کردن مقاله را بنویسید");
  if (!(await worksRecords(ctx, input.table))) throw forbidden("پیوند مقاله به رکورد با کارشناسانی است که روی آن کار می‌کنند");
  const linked = (await linkedArticles(ctx, input.table, input.id)).find((l) => l.link_id === input.link_id);
  if (!linked) throw notFound("پیوند پیدا نشد");
  await removeLink(ctx, input.table, input.id, input.link_id);
  await ctx.write(async (tx) => {
    const { def } = await defFor(ctx, input.table, tx);
    if (def.features?.journal) {
      const row = await liveRow(tx, ctx, input.table, input.id);
      if (row) await addJournalIn(tx, ctx, def, row, { kind: "work_note", body: `مقالهٔ ${linked.article.number ?? ""} «${linked.article.title}» جدا شد: ${reason.slice(0, 500)}` }, { trusted: true });
    }
    await recountReuse(tx, ctx, linked.article.id);
  });
  await logEvent(ctx.db, ctx, { kind: "unlink", article_id: linked.article.id, record_table: input.table, record_id: input.id, channel: "record", data: { reason: reason.slice(0, 200) } });
  return { ok: true as const };
}

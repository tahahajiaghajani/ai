// Knowledge next to work (KB-041, KB-050): suggestions for a record — from its title, description, category and CI,
// searched with the reader's access (semantic matches included when the member may use AI) — with the articles already
// linked, answer snippets, and whether the caller may link articles to it or write one from it; type-ahead
// suggestions while someone describes a new request (the requester's own access: internal knowledge never shows); and
// the «مقاله‌های پیشنهادی» block of notification templates (KB-051), searched as the recipient.
import type { KbRecordPanel, KbSuggestion } from "@shared/knowledge/api";
import { escapeMarkdown, plainLine } from "@shared/notify";
import type { Ctx } from "../../context";
import { defFor, get } from "../../engine";
import { access } from "../../access/provider";
import { canAuthor, kbConfig, liveRows, sysOf, type Row } from "./common";
import { searchKnowledge } from "./search";
import { linkedArticles, worksRecords } from "./links";
import { logEvent } from "./events";
import { registerTemplateBlock } from "../notify";

/** The query a record suggests: its title, the start of its description and its category's label. */
function queryOf(row: Row, display: Record<string, string>): string {
  const parts = [row.short_description ?? row.title ?? row.name ?? "", String(row.description ?? row.symptoms ?? "").slice(0, 240)];
  if (row.ci_id && display[row.ci_id]) parts.push(display[row.ci_id]);
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function suggestForRecord(ctx: Ctx, table: string, id: string, opts: { q?: string | null; session_id?: string | null } = {}): Promise<KbRecordPanel> {
  const r = await get(ctx, table, id);
  const row = r.row as Row;
  const cfg = await kbConfig(ctx.db, sysOf(ctx));
  const { def } = await defFor(ctx, table);
  const q = (opts.q ?? "").trim() || queryOf(row, r.display);
  let linked: KbRecordPanel["linked"] = [];
  if (def.features?.links) linked = (await linkedArticles(ctx, table, id)).map((l) => ({ link_id: l.link_id, kind: l.kind, label: l.label, article: l.article, created_at: l.created_at }));
  const res = q ? await searchKnowledge(ctx, { q, size: cfg.suggest_limit + linked.length, channel: "record", log: false, session_id: opts.session_id ?? null }) : null;
  const linkedIds = new Map(linked.map((l) => [l.article.id, l.kind]));
  const suggestions: KbSuggestion[] = (res?.hits ?? []).map((h) => ({ ...h, linked: linkedIds.get(h.id) ?? null })).filter((h) => !h.linked).slice(0, cfg.suggest_limit);
  const [captured] = await liveRows(ctx.db, ctx, "kb_article", { and: [{ f: "source_id", op: "eq", v: id }, { f: "state", op: "ne", v: "trashed" }] }, { order: "t.created_at desc", limit: 1 });
  if (suggestions.length) await logEvent(ctx.db, ctx, { kind: "suggest", record_table: table, record_id: id, query: q, results: suggestions.length, channel: "record", session_id: opts.session_id ?? null });
  const canWrite = !!(r.meta as { canWrite?: boolean }).canWrite && !!def.features?.links && (await worksRecords(ctx, table));
  return {
    linked,
    suggestions,
    snippets: res?.snippets ?? [],
    query: q,
    can: { link: canWrite, capture: canAuthor(ctx) && access().canReadTable(ctx, def) },
    captured: captured ? { id: captured.id, number: captured.number ?? null, title: captured.title, state: captured.state } : null,
  };
}

/** Type-ahead deflection: articles and snippets for a description being typed (logged as a search of the session). */
export async function suggestForText(ctx: Ctx, input: { text: string; session_id?: string | null; channel?: string | null; size?: number }) {
  const text = String(input.text ?? "").trim().slice(0, 300);
  if (text.length < 3) return { hits: [], snippets: [], query: text };
  const res = await searchKnowledge(ctx, { q: text, size: Math.min(8, input.size ?? 5), channel: input.channel ?? "portal", session_id: input.session_id ?? null });
  return { hits: res.hits, snippets: res.snippets, query: text };
}

/** Fields of a work record its suggestions are searched with (those the table has). */
const QUERY_FIELDS = ["short_description", "title", "name", "description", "symptoms"];

/**
 * `{{block.kb_suggestions}}` in notification templates (KB-051): up to three live articles the recipient may read that
 * best match the record (its title and the start of its description), as links to their reading view — the
 * acknowledgement of a new request or incident shows the requester what may already solve it. Searched by its words as
 * the recipient (audiences, «فقط کارشناسان» and the organisation's search rules apply; nothing is logged as a search;
 * no model is called while messages go out); empty when nothing matches. Offered on the work tables the knowledge
 * panel sits on (tables with links), not on knowledge's own.
 */
export function installKbTemplateBlock(): void {
  registerTemplateBlock("kb_suggestions", {
    label: "مقاله‌های پیشنهادی دانش",
    description: "تا سه مقاله که گیرنده اجازهٔ خواندنشان را دارد و بیش از همه به این رکورد می‌خورند، با پیوند",
    tables: (def) => def.module !== "knowledge" && !!def.features?.links,
    fields: QUERY_FIELDS,
    async render({ ctx, row, link }) {
      const q = queryOf(row as Row, {});
      if (!q) return null;
      const cfg = await kbConfig(ctx.db, sysOf(ctx));
      // words only: no model calls while messages go out, and nothing when nothing matches
      const res = await searchKnowledge(ctx, { q, size: Math.max(1, Math.min(3, cfg.suggest_limit)), channel: "notify", log: false, semantic: false });
      const hits = res.hits.slice(0, 3);
      if (!hits.length) return null;
      return {
        markdown: hits.map((h) => `- [${escapeMarkdown(plainLine(h.title, 160))}](${link(`kb/a/${h.id}`)})${h.summary ? `: ${escapeMarkdown(plainLine(h.summary, 160))}` : ""}`).join("\n"),
        text: hits.map((h) => `${plainLine(h.title, 80)} ${link(`kb/a/${h.id}`)}`).join("؛ "),
      };
    },
  });
}

// @mentions in journal bodies. A mention is written into the markdown as a link with the `mention:` scheme —
// `@[سارا محمدی](mention:2f0c…)` — so it survives as plain text everywhere, renders as a person chip in the activity
// stream, and the notification service can find who was mentioned (`mentionedIds`). Pure: no React, no antd.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENTION = /@\[([^\]\n]{1,120})\]\(mention:([0-9a-fA-F-]{36})\)/g;

/** The markdown of a mention (brackets in a name are dropped so the link stays well-formed). */
export function formatMention(id: string, name: string): string {
  const clean = name.replace(/[[\]()\n]/g, " ").replace(/\s+/g, " ").trim() || "کاربر";
  return `@[${clean}](mention:${id.toLowerCase()})`;
}

/** Ids of the people a body mentions, once each, in order. */
export function mentionedIds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION)) {
    const id = m[2].toLowerCase();
    if (UUID.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** True for an href written by `formatMention`. */
export const isMentionHref = (href: string | undefined | null): boolean => !!href && /^mention:[0-9a-f-]{36}$/i.test(href);

/**
 * The mention being typed at the caret: the text after an `@` that starts a word, up to the caret (no line break,
 * at most 40 characters). Null when the caret is not in one.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/[\s([{«"'،]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n[\]()]/.test(query)) return null;
  return { start: at, query };
}

/** Replaces the typed `@query` (from `start` to `caret`) with a mention; returns the text and the new caret. */
export function insertMention(text: string, start: number, caret: number, id: string, name: string): { text: string; caret: number } {
  const m = `${formatMention(id, name)} `;
  return { text: text.slice(0, start) + m + text.slice(caret), caret: start + m.length };
}

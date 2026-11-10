// Pure logic of the knowledge screens (tests: tests/knowledge-ui.test.ts): the editor's insertions (headings,
// callouts, code, tables, images, blocks, links to articles), callouts in the reading view (GitHub-style
// `> [!note]`), reading time, highlighted excerpts, the search page's URL state, the category tree, the table of
// contents' active heading, what a draft changed, and the labels and tones the screens share. No React, no antd.
import { headings, highlightRanges } from "@shared/knowledge/logic";
import { searchForm } from "@shared/ai/text";
import { toPersianDigits } from "../../lib/fa";
import type { KbCategoryNode } from "@shared/knowledge/api";

export const faNum = (n: number | string | null | undefined) => toPersianDigits(String(n ?? 0));

// ---------------------------------------------------------------- editor insertions

export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** The line that holds `at` (its start and end offsets). */
function lineAt(text: string, at: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const nl = text.indexOf("\n", at);
  return { from, to: nl < 0 ? text.length : nl };
}

/** Text inserted as its own block (blank lines around it), the caret placed inside `select` of the inserted text. */
export function insertBlock(text: string, start: number, end: number, block: string, select?: [number, number]): Edit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.length === 0 || after.startsWith("\n\n") ? "\n" : after.startsWith("\n") ? "\n" : "\n\n";
  const next = before + lead + block + tail + after;
  const at = before.length + lead.length;
  return select ? { text: next, start: at + select[0], end: at + select[1] } : { text: next, start: at + block.length, end: at + block.length };
}

/** Turns the line under the caret into a heading of `level` (or back to text when it already is one). */
export function toggleHeading(text: string, start: number, level: 2 | 3 | 4): Edit {
  const { from, to } = lineAt(text, start);
  const line = text.slice(from, to);
  const m = /^(#{1,6})\s+/.exec(line);
  const bare = m ? line.slice(m[0].length) : line;
  const same = m && m[1].length === level;
  const next = same ? bare : `${"#".repeat(level)} ${bare || "عنوان بخش"}`;
  const textOut = text.slice(0, from) + next + text.slice(to);
  const caret = from + next.length;
  return { text: textOut, start: same ? caret : from + level + 1, end: caret };
}

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

export const CALLOUTS: Record<CalloutKind, { label: string; tone: "info" | "ok" | "accent" | "warning" | "danger" }> = {
  note: { label: "یادداشت", tone: "info" },
  tip: { label: "نکته", tone: "ok" },
  important: { label: "مهم", tone: "accent" },
  warning: { label: "هشدار", tone: "warning" },
  caution: { label: "احتیاط", tone: "danger" },
};

/** A callout block around the selection (or a placeholder). */
export function insertCallout(text: string, start: number, end: number, kind: CalloutKind): Edit {
  const sel = text.slice(start, end).trim() || "متن را این‌جا بنویسید";
  const body = sel.split("\n").map((l) => `> ${l}`).join("\n");
  const block = `> [!${kind.toUpperCase()}]\n${body}`;
  const head = `> [!${kind.toUpperCase()}]\n> `.length;
  return insertBlock(text, start, end, block, [head, block.length]);
}

/** A fenced code block (LTR in the reading view) around the selection. */
export function insertCode(text: string, start: number, end: number, lang = ""): Edit {
  const sel = text.slice(start, end) || "دستور";
  const block = `\`\`\`${lang}\n${sel}\n\`\`\``;
  return insertBlock(text, start, end, block, [4 + lang.length, 4 + lang.length + sel.length]);
}

/** A table of `cols` × `rows` with Persian header placeholders. */
export function insertTable(text: string, start: number, end: number, cols = 3, rows = 2): Edit {
  const c = Math.max(1, Math.min(8, cols));
  const head = `| ${Array.from({ length: c }, (_, i) => `ستون ${faNum(i + 1)}`).join(" | ")} |`;
  const sep = `| ${Array.from({ length: c }, () => "---").join(" | ")} |`;
  const body = Array.from({ length: Math.max(1, Math.min(20, rows)) }, () => `| ${Array.from({ length: c }, () => " ").join(" | ")} |`);
  const block = [head, sep, ...body].join("\n");
  return insertBlock(text, start, end, block, [2, 2 + `ستون ${faNum(1)}`.length]);
}

/** An image from the article's attachments: `![description](attachment:<id>)`. */
export function insertImage(text: string, start: number, end: number, attachmentId: string, alt: string): Edit {
  const desc = alt.replace(/[[\]]/g, "").trim() || "توضیح تصویر";
  const block = `![${desc}](attachment:${attachmentId})`;
  return insertBlock(text, start, end, block, [2, 2 + desc.length]);
}

/** A reusable block placeholder `{{block:KBB000012}}` (expanded for each reader by the server). */
export function insertBlockRef(text: string, start: number, end: number, number: string): Edit {
  return insertBlock(text, start, end, `{{block:${number}}}`);
}

/** A link to another article by number (the reading view turns «KB000123» into a link). */
export function insertArticleLink(text: string, start: number, end: number, number: string, title: string): Edit {
  const label = text.slice(start, end) || title;
  const piece = `[${label.replace(/[[\]]/g, "")}](kb:${number})`;
  const next = text.slice(0, start) + piece + text.slice(end);
  return { text: next, start: start + piece.length, end: start + piece.length };
}

/** The `{{block:…}}` placeholders and `kb:` links an editor preview should show as such. */
export const KB_LINK = /^kb:(KB-?\d{1,9})$/i;

// ---------------------------------------------------------------- callouts in the reading view

/** `[!NOTE]` at the start of a block quote → its kind and the rest of the first line. */
export function calloutOf(firstText: string): { kind: CalloutKind; rest: string } | null {
  const m = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i.exec(firstText);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as CalloutKind, rest: firstText.slice(m[0].length) };
}

// ---------------------------------------------------------------- remark plugins of the reading view (mdast, minimal local types)

interface MdNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Top-level ATX headings of levels 1–4 get the slugs `headings()` computed for the same text, in order. */
export const remarkSlugs = (source: string) => () => (tree: MdNode) => {
  const slugs = headings(source).map((h) => h.slug);
  let i = 0;
  for (const n of tree.children ?? []) {
    if (n.type !== "heading" || (n.depth ?? 9) > 4) continue;
    const at = n.position?.start.offset ?? -1;
    if (at < 0 || !/^\s{0,3}#/.test(source.slice(at, at + 4))) continue;
    const slug = slugs[i++];
    if (slug) n.data = { ...(n.data ?? {}), hProperties: { ...(n.data?.hProperties ?? {}), id: slug } };
  }
};

/** `> [!WARNING]` block quotes become `<aside class="kb-callout" data-kind="warning">` (the marker removed). */
export const remarkCallouts = () => (tree: MdNode) => {
  const walk = (n: MdNode) => {
    for (const c of n.children ?? []) {
      if (c.type === "blockquote") {
        const p = c.children?.[0];
        const t = p?.type === "paragraph" ? p.children?.[0] : undefined;
        const hit = t?.type === "text" ? calloutOf(String(t.value ?? "")) : null;
        if (hit && t && p) {
          t.value = hit.rest.replace(/^\s*\n/, "");
          if (!t.value && (p.children?.length ?? 0) > 1 && p.children![1].type === "break") p.children!.splice(1, 1);
          if (!t.value && (p.children?.length ?? 0) === 1) c.children!.shift();
          c.data = { hName: "aside", hProperties: { className: ["kb-callout", `is-${CALLOUTS[hit.kind].tone}`], "data-kind": hit.kind, role: "note" } };
        }
      }
      walk(c);
    }
  };
  walk(tree);
};

/** Keeps the URLs the components decide on; anything else (javascript:, data:, …) becomes nothing. */
export const urlTransform = (url: string) => (/^(https?:|mailto:|attachment:|kb:|#|\/)/i.test(url) ? url : "");

// ---------------------------------------------------------------- reading

/** Minutes to read (≈ 180 Persian words a minute, at least one). */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(Math.max(0, words) / 180));
}

export const readingLabel = (words: number) => `${faNum(readingMinutes(words))} دقیقه مطالعه`;

/** Splits plain text into pieces with the query's terms marked (for search excerpts). */
export function highlight(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const s = String(text ?? "");
  const ranges = highlightRanges(s, terms.map((t) => searchForm(t)).filter(Boolean));
  if (!ranges.length) return s ? [{ text: s, hit: false }] : [];
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: s.slice(at, a), hit: false });
    out.push({ text: s.slice(a, b), hit: true });
    at = b;
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false });
  return out;
}

/** «۸ از ۱۰ نفر مفید دانستند» */
export function helpfulLine(yes: number, no: number): string | null {
  const n = yes + no;
  if (!n) return null;
  return `${faNum(yes)} از ${faNum(n)} نفر این مقاله را مفید دانستند`;
}

/** The heading the reader is in: the last one whose top is above the reading line. */
export function activeHeading(tops: { slug: string; top: number }[], line: number): string | null {
  let cur: string | null = null;
  for (const t of tops) {
    if (t.top <= line) cur = t.slug;
    else break;
  }
  return cur ?? tops[0]?.slug ?? null;
}

// ---------------------------------------------------------------- search page state

export interface SearchState {
  q: string;
  base: string | null;
  category: string | null;
  type: string | null;
  language: string | null;
  sort: "relevance" | "recent" | "popular";
  page: number;
}

const SORTS = ["relevance", "recent", "popular"] as const;

export function readSearch(sp: URLSearchParams): SearchState {
  const sort = sp.get("sort");
  const page = Number(sp.get("page") ?? 1);
  return {
    q: (sp.get("q") ?? "").slice(0, 300),
    base: sp.get("base") || null,
    category: sp.get("category") || null,
    type: sp.get("type") || null,
    language: sp.get("lang") || null,
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as SearchState["sort"]) : "relevance",
    page: Number.isInteger(page) && page >= 1 && page <= 200 ? page : 1,
  };
}

/** The URL of a search state (defaults left out); changing anything but the page goes back to page one. */
export function writeSearch(prev: SearchState, patch: Partial<SearchState>): URLSearchParams {
  const s = { ...prev, ...patch };
  if (!("page" in patch)) s.page = 1;
  const sp = new URLSearchParams();
  if (s.q) sp.set("q", s.q);
  if (s.base) sp.set("base", s.base);
  if (s.category) sp.set("category", s.category);
  if (s.type) sp.set("type", s.type);
  if (s.language) sp.set("lang", s.language);
  if (s.sort !== "relevance") sp.set("sort", s.sort);
  if (s.page > 1) sp.set("page", String(s.page));
  return sp;
}

// ---------------------------------------------------------------- category tree

export interface CategoryTree extends KbCategoryNode {
  children: CategoryTree[];
  /** articles in the node and every node below it */
  total: number;
}

/** Categories of one base as a tree (orphans at the top), siblings in the server's order. */
export function categoryTree(nodes: KbCategoryNode[], baseId: string): CategoryTree[] {
  const mine = nodes.filter((n) => n.base_id === baseId);
  const by = new Map<string, CategoryTree>(mine.map((n) => [n.id, { ...n, children: [], total: Number(n.article_count ?? 0) }]));
  const roots: CategoryTree[] = [];
  for (const n of mine) {
    const node = by.get(n.id)!;
    const parent = n.parent_id ? by.get(n.parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sum = (n: CategoryTree, seen: Set<string>): number => {
    if (seen.has(n.id)) return 0;
    seen.add(n.id);
    n.total = Number(n.article_count ?? 0) + n.children.reduce((s, c) => s + sum(c, seen), 0);
    return n.total;
  };
  const seen = new Set<string>();
  for (const r of roots) sum(r, seen);
  return roots;
}

// ---------------------------------------------------------------- drafts

export const DRAFT_FIELDS = ["title", "summary", "body", "internal_body", "keywords", "tags", "change_note", "change_kind"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
export type DraftValues = Partial<Record<DraftField, unknown>>;

const norm = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : v === null || v === undefined ? "" : String(v));

/** The fields of a draft that differ from what was saved (what autosave sends). */
export function draftChanges(saved: DraftValues, current: DraftValues): DraftValues {
  const out: DraftValues = {};
  for (const f of DRAFT_FIELDS) if (f in current && norm(saved[f]) !== norm(current[f])) out[f] = current[f];
  return out;
}

// ---------------------------------------------------------------- labels

export const VERSION_TONE: Record<string, "neutral" | "info" | "warning" | "ok" | "danger"> = {
  draft: "info",
  in_review: "warning",
  scheduled: "info",
  published: "ok",
  outdated: "neutral",
  discarded: "neutral",
};

export const BANNER_TONE: Record<string, "info" | "warning" | "danger"> = { info: "info", warning: "warning", danger: "danger" };

export const FLAG_REASONS: { value: string; label: string }[] = [
  { value: "incorrect", label: "نادرست است" },
  { value: "outdated", label: "قدیمی شده است" },
  { value: "unclear", label: "روشن نیست" },
  { value: "missing_step", label: "گامی جا افتاده است" },
  { value: "broken_link", label: "پیوند یا تصویر خراب است" },
  { value: "duplicate", label: "تکراری است" },
  { value: "other", label: "دلیل دیگر" },
];

export const NOT_HELPFUL_REASONS: { value: string; label: string }[] = [
  { value: "unclear", label: "روشن نبود" },
  { value: "incorrect", label: "درست کار نکرد" },
  { value: "outdated", label: "قدیمی است" },
  { value: "missing_step", label: "کامل نبود" },
  { value: "other", label: "چیز دیگری می‌خواستم" },
];

export const LINK_KINDS: { value: "kb_solved_by" | "kb_workaround" | "kb_related"; label: string }[] = [
  { value: "kb_solved_by", label: "با این مقاله حل شد" },
  { value: "kb_workaround", label: "راه‌حل موقت از این مقاله" },
  { value: "kb_related", label: "مرتبط" },
];

export const LANGUAGES: { value: string; label: string }[] = [
  { value: "fa", label: "فارسی" },
  { value: "en", label: "انگلیسی" },
  { value: "ar", label: "عربی" },
  { value: "tr", label: "ترکی" },
  { value: "ku", label: "کردی" },
  { value: "az", label: "آذری" },
];

export const languageLabel = (code: string | null | undefined) => LANGUAGES.find((l) => l.value === code)?.label ?? (code ?? "");

// ---------------------------------------------------------------- decision trees

export interface TreeStep {
  id: string;
  title: string | null;
  text: string | null;
  options: { label: string; next: string }[];
  article_id: string | null;
  outcome: string | null;
}

/** The nodes of a decision tree as stored (malformed entries dropped) and where it starts. */
export function treeNodes(raw: unknown, start?: string | null): { nodes: Map<string, TreeStep>; start: string | null } {
  const nodes = new Map<string, TreeStep>();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id || nodes.has(id)) continue;
    const options = (Array.isArray(o.options) ? o.options : [])
      .map((x) => (x && typeof x === "object" ? { label: String((x as Record<string, unknown>).label ?? "").trim(), next: String((x as Record<string, unknown>).next ?? "").trim() } : null))
      .filter((x): x is { label: string; next: string } => !!x && !!x.label && !!x.next);
    const text = o.text ?? o.question ?? o.answer;
    nodes.set(id, {
      id,
      title: o.title ? String(o.title) : null,
      text: text ? String(text) : null,
      options,
      article_id: typeof o.article_id === "string" && /^[0-9a-f-]{36}$/i.test(o.article_id) ? o.article_id.toLowerCase() : null,
      outcome: o.outcome ? String(o.outcome) : null,
    });
  }
  const first = start && nodes.has(start) ? start : (nodes.keys().next().value ?? null);
  return { nodes, start: first };
}

/** Is a table one whose records the knowledge panel belongs on (a task-like engine table with links, not knowledge's own)? */
export function takesKnowledge(def: { key: string; module?: string; features?: { links?: boolean }; fields: { name: string }[] }): boolean {
  if (def.key.startsWith("kb_") || def.module === "knowledge") return false;
  if (!def.features?.links) return false;
  return def.fields.some((f) => f.name === "short_description");
}

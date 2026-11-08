// Structure-aware chunking of a RAG document (a record's text fields, a document's pages). Pure: the indexer and the
// tests call it with the document a builder produced.
//
// - Partitions: text of different field groups is never mixed in one chunk — a caller who lacks a group loses only
//   the chunks of that group (the public description of a ticket stays retrievable without its internal notes).
//   The title is prefixed to every chunk, so the title's own group (if any) joins every chunk's groups.
// - Blocks: markdown headings build a breadcrumb; lists, tables and fenced code stay whole; paragraphs are split by
//   blank lines; a block above the size limit is split by sentences, then by words.
// - Chunks: blocks are packed up to `max` tokens (default 700); small sections are merged until `min` (default 350)
//   and the next section starts a new chunk; a chunk cut inside a section carries up to `overlap` tokens of the
//   previous one. Pages (documents) are sections of their own, so citations keep their page anchors.
// - Small-to-big: a section split into several chunks gets a `parent` chunk (the section, up to `parentMax` tokens)
//   that answers carry instead of the small chunk that matched.
import type { FieldGroup } from "@shared/model/types";
import { cleanText, clipTokens, estimateTokens } from "@shared/ai/text";

/** One piece of text of a document: a field's value or a page. */
export interface RagPart {
  /** field name (records) or "content" (documents) */
  field: string;
  /** Persian label of the field, for citations */
  label?: string;
  text: string;
  /** field group of the value (null = row access only) */
  group?: FieldGroup | null;
  /** page anchor (documents) */
  page?: number | null;
  /** markdown headings and lists are recognised in both; "text" only splits paragraphs */
  format?: "markdown" | "text";
}

/** What a builder produces for one record. */
export interface RagDocument {
  title: string;
  /** the field the title comes from and its group: every chunk carries the title, so it carries the group too */
  titleField?: string | null;
  titleGroup?: FieldGroup | null;
  /** record number (INC0000012) */
  number?: string | null;
  lang?: string | null;
  parts: RagPart[];
}

export interface ChunkOptions {
  max?: number;
  min?: number;
  overlap?: number;
  parentMax?: number;
}

export interface Chunk {
  ord: number;
  kind: "chunk" | "parent";
  /** ord of the parent chunk (small-to-big), null when the chunk is a whole section */
  parent: number | null;
  /** main field of the chunk */
  field: string;
  fields: string[];
  /** field groups whose values the chunk contains (sorted) */
  groups: string[];
  heading: string | null;
  page: number | null;
  pageEnd: number | null;
  /** the passage as shown and cited */
  text: string;
  /** title + heading + text: what is embedded and searched */
  embedText: string;
  tokens: number;
}

export const CHUNKER_VERSION = "c2";
const DEFAULTS: Required<ChunkOptions> = { max: 700, min: 350, overlap: 80, parentMax: 1600 };

interface Block {
  text: string;
  tokens: number;
  path: string[];
  page: number | null;
  field: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_RE = /^\s*(?:[-*+•▪◦]|\d{1,3}[.)]|[a-zA-Z][.)])\s+|^\s*\|/;
const FENCE_RE = /^\s*(```|~~~)/;

/** Sentences of a paragraph (Persian and Latin end marks, line breaks). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟؛…])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pieces of at most `max` tokens: by sentences, then by words. */
function splitLong(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const s of sentences(text)) {
    if (estimateTokens(s) > max) {
      push();
      let piece = "";
      for (const w of s.split(/\s+/)) {
        if (piece && estimateTokens(`${piece} ${w}`) > max) {
          out.push(piece);
          piece = w;
        } else piece = piece ? `${piece} ${w}` : w;
      }
      if (piece) out.push(piece);
      continue;
    }
    if (cur && estimateTokens(`${cur} ${s}`) > max) push();
    cur = cur ? `${cur} ${s}` : s;
  }
  push();
  return out;
}

/** Blocks of one part: headings set the breadcrumb, lists/tables/code stay whole, paragraphs split on blank lines. */
export function blocksOf(part: RagPart, max = DEFAULTS.max): Block[] {
  // passages keep the text as written; embedding and search normalise it (normalizeFa / searchForm)
  const text = cleanText(part.text);
  if (!text) return [];
  const markdown = part.format !== "text";
  const lines = text.split("\n");
  const path: string[] = [];
  const out: Block[] = [];
  let buf: string[] = [];
  let kind: "para" | "list" | null = null;
  const flush = () => {
    const t = buf.join("\n").trim();
    buf = [];
    kind = null;
    if (!t) return;
    const tokens = estimateTokens(t);
    const pieces = tokens > max ? splitLong(t, max) : [t];
    for (const p of pieces) out.push({ text: p, tokens: estimateTokens(p), path: [...path], page: part.page ?? null, field: part.field });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (markdown && FENCE_RE.test(line)) {
      flush();
      const fence = FENCE_RE.exec(line)![1];
      const code = [line];
      while (++i < lines.length) {
        code.push(lines[i]);
        if (lines[i].trim().startsWith(fence)) break;
      }
      buf = code;
      flush();
      continue;
    }
    const h = markdown ? HEADING_RE.exec(line) : null;
    if (h) {
      flush();
      const level = h[1].length;
      path.length = Math.min(path.length, level - 1);
      path[level - 1] = h[2].replace(/[*_`]/g, "").trim();
      for (let k = 0; k < level - 1; k++) path[k] ??= "";
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const isList = markdown && LIST_RE.test(line);
    // a list or table continues over its own items and their indented continuation lines
    if (kind === "list" && (isList || /^\s{2,}\S/.test(line))) {
      buf.push(line);
      continue;
    }
    if (isList) {
      flush();
      kind = "list";
      buf.push(line);
      continue;
    }
    if (kind === "list") flush();
    kind = "para";
    buf.push(line);
  }
  flush();
  return out.map((b) => ({ ...b, path: b.path.filter(Boolean) }));
}

const sectionKey = (b: Block) => `${b.field}\u0001${b.page ?? ""}\u0001${b.path.join("\u0002")}`;

/** The chunks of a document (children in order, then their parents). */
export function chunkDocument(doc: RagDocument, options: ChunkOptions = {}): Chunk[] {
  const o = { ...DEFAULTS, ...options };
  const title = cleanText(doc.title).replace(/\s+/g, " ").slice(0, 300);
  const head = title ? `${title}${doc.number ? ` (${doc.number})` : ""}` : (doc.number ?? "");
  // partitions by field group: public text first, then each group alone
  const partitions = new Map<string, RagPart[]>();
  for (const p of doc.parts) {
    if (!String(p.text ?? "").trim()) continue;
    const key = p.group ?? "";
    if (!partitions.has(key)) partitions.set(key, []);
    partitions.get(key)!.push(p);
  }
  // public text first, then each group in the order it appears
  const order = [...partitions.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
  const children: Chunk[] = [];
  const parents: Chunk[] = [];
  let ord = 0;

  for (const key of order) {
    const groups = [...new Set([key, doc.titleGroup ?? ""].filter(Boolean))].sort();
    const blocks = partitions.get(key)!.flatMap((p) => blocksOf(p, o.max));
    if (!blocks.length) continue;
    // sections: consecutive blocks of one field, page and breadcrumb
    const sections: Block[][] = [];
    for (const b of blocks) {
      const last = sections[sections.length - 1];
      if (last && sectionKey(last[0]) === sectionKey(b)) last.push(b);
      else sections.push([b]);
    }
    const sectionOfChild: number[] = [];
    let cur: { blocks: Block[]; tokens: number; section: number } | null = null;
    const emit = () => {
      if (!cur || !cur.blocks.length) return;
      const first = cur.blocks[0];
      // a block that opens another section inside the chunk is preceded by its heading
      const lines: string[] = [];
      let prevKey = sectionKey(first);
      for (const b of cur.blocks) {
        const k = sectionKey(b);
        if (k !== prevKey && b.path.length) lines.push(b.path[b.path.length - 1]);
        prevKey = k;
        lines.push(b.text);
      }
      const text = lines.join("\n\n");
      const heading = first.path.length ? first.path.join(" › ") : null;
      const pages = cur.blocks.map((b) => b.page).filter((x): x is number => x !== null);
      children.push({
        ord: ord++,
        kind: "chunk",
        parent: null,
        field: first.field,
        fields: [...new Set(cur.blocks.map((b) => b.field).concat(doc.titleField ? [doc.titleField] : []))],
        groups,
        heading,
        page: pages.length ? Math.min(...pages) : null,
        pageEnd: pages.length ? Math.max(...pages) : null,
        text,
        embedText: [head, heading, text].filter(Boolean).join("\n"),
        tokens: estimateTokens(text),
      });
      sectionOfChild.push(cur.section);
    };
    sections.forEach((sec, si) => {
      // a new section starts a new chunk once the current one is big enough; a new page always does, and text with a
      // page never shares a chunk with text without one (a document's summary stays apart from its pages), so every
      // citation's page anchor holds for its whole passage
      const lastPage = cur?.blocks[cur.blocks.length - 1]?.page ?? null;
      const pageBreak = !!cur?.blocks.length && lastPage !== (sec[0].page ?? null);
      if (cur && (cur.tokens >= o.min || pageBreak)) {
        emit();
        cur = null;
      }
      for (const b of sec) {
        if (cur && cur.tokens + b.tokens > o.max) {
          const prev: { blocks: Block[]; tokens: number; section: number } = cur;
          emit();
          // overlap within a section: the tail of the previous chunk
          const tail = prev.blocks[prev.blocks.length - 1];
          const carry: Block[] = [];
          if (tail && sectionKey(tail) === sectionKey(b)) {
            if (tail.tokens <= o.overlap) carry.push(tail);
            else {
              const ss = sentences(tail.text);
              let t = "";
              for (let k = ss.length - 1; k >= 0; k--) {
                const next = t ? `${ss[k]} ${t}` : ss[k];
                if (estimateTokens(next) > o.overlap) break;
                t = next;
              }
              if (t) carry.push({ ...tail, text: t, tokens: estimateTokens(t) });
            }
          }
          cur = { blocks: carry, tokens: carry.reduce((n, x) => n + x.tokens, 0), section: si };
        }
        if (!cur) cur = { blocks: [], tokens: 0, section: si };
        cur.blocks.push(b);
        cur.tokens += b.tokens;
      }
    });
    emit();

    // parents: a section split over several chunks (its first block opened them)
    const firstChild = children.length - sectionOfChild.length;
    const bySection = new Map<number, number[]>();
    sectionOfChild.forEach((s, i) => {
      if (!bySection.has(s)) bySection.set(s, []);
      bySection.get(s)!.push(firstChild + i);
    });
    for (const [s, idxs] of bySection) {
      if (idxs.length < 2) continue;
      const sec = sections[s];
      const text = clipTokens(sec.map((b) => b.text).join("\n\n"), o.parentMax);
      const heading = sec[0].path.length ? sec[0].path.join(" › ") : null;
      const pages = sec.map((b) => b.page).filter((x): x is number => x !== null);
      const p: Chunk = {
        ord: -1,
        kind: "parent",
        parent: null,
        field: sec[0].field,
        fields: [...new Set(sec.map((b) => b.field).concat(doc.titleField ? [doc.titleField] : []))],
        groups,
        heading,
        page: pages.length ? Math.min(...pages) : null,
        pageEnd: pages.length ? Math.max(...pages) : null,
        text,
        embedText: [head, heading, text].filter(Boolean).join("\n"),
        tokens: estimateTokens(text),
      };
      parents.push(p);
      (p as { children?: number[] }).children = idxs;
    }
  }
  for (const p of parents) {
    p.ord = ord++;
    for (const i of (p as { children?: number[] }).children ?? []) children[i].parent = p.ord;
    delete (p as { children?: number[] }).children;
  }
  return [...children, ...parents];
}

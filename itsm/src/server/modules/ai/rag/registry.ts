// What the AI index holds: tables declare their RAG document in their TableDef (`ai: { title, text }`, fields with
// `ai: { index, redact }`, `features.rag`), and modules may register a custom document builder for a table
// (`registerRagSource`) — e.g. the smart documents, whose text lives in pages. A builder runs as the system in a job and
// returns the parts with their field groups; the chunker keeps groups apart and retrieval drops a part a caller may not
// see. Fields of the `ai_private` group and secrets are never indexed. A table with `ai.attachments` also indexes the
// text of its records' attachments, a part per file (and page), cited to the record and read with the record's access.
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import type { FieldDef, TableDef } from "@shared/model/types";
import { TABLES } from "@shared/tables";
import { ident } from "../../../db/sql";
import { pgArray } from "../../../db";
import { filtersSide } from "../../../engine/hooks";
import { maskText } from "../redact";
import type { RagDocument, RagPart } from "./chunker";
import { fileKind, parseFile } from "./parsers";

export type { RagDocument, RagPart };

export interface RagBuildArgs {
  /** the system context of the record's organisation */
  ctx: Ctx;
  q: Queryable;
  def: TableDef;
  /** the record as stored (every field, custom fields as `u_*`) */
  row: Record<string, unknown>;
}

export interface RagSource {
  /** table key */
  table: string;
  /** the document of one record (null: nothing to index) */
  build(args: RagBuildArgs): Promise<RagDocument | null>;
  /** a later change of the builder (re-indexes every record of the table once) */
  version?: string;
  /** in-app path of a record (default r/<table>/<id>), for citations */
  path?(id: string, row: { page?: number | null; chunk?: string }): string;
  /**
   * AI-channel rule: an extra SQL predicate on the source row (aliased `alias`) that must hold for AI to use it — e.g.
   * published articles only, or documents of collections that allow AI. Push parameters onto `params`. Evaluated live
   * with every retrieval, on top of the caller's read access.
   */
  aiWhere?(alias: string, params: unknown[]): string;
  /**
   * The record's own AI-use rule, whatever its state (an article «هرگز» or «سری», a base or a collection with AI off):
   * when it does not hold, no skill reads the record — not even a draft being worked on. Default: `aiWhere`.
   */
  aiChannel?(alias: string, params: unknown[]): string;
}

const SOURCES = new Map<string, RagSource>();
const CHANNELS = new Map<string, (alias: string, params: unknown[]) => string>();

/** The AI-use rule of a table that is no RAG source (an article's drafts follow their article). */
export function registerAiChannel(table: string, rule: (alias: string, params: unknown[]) => string): () => void {
  CHANNELS.set(table, rule);
  return () => {
    if (CHANNELS.get(table) === rule) CHANNELS.delete(table);
  };
}

/**
 * Does the record's AI-use rule hold (`aiChannel` of its source or a registered rule; none = yes)? Read as stored —
 * the caller's access to the record is checked by whoever loads it.
 */
export async function aiChannelOpen(q: Queryable, orgId: string, table: string, id: string): Promise<boolean> {
  const src = SOURCES.get(table);
  const rule = CHANNELS.get(table) ?? src?.aiChannel ?? src?.aiWhere;
  if (!rule) return true;
  const def = TABLES.get(table);
  if (!def || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const params: unknown[] = [id, orgId];
  const cond = rule("t", params);
  const r = await q.one<{ ok: number }>(`select 1 as ok from ${ident(def.table)} t where t.id = $1::uuid and t.org_id = $2::uuid and t.deleted_at is null and (${cond})`, params);
  return !!r;
}

/** The refusal when a record is closed to AI. */
export const AI_CLOSED = "این رکورد برای هوش مصنوعی بسته است";

/** A module's own document builder for one of its tables (replaces the TableDef default). */
export function registerRagSource(src: RagSource): () => void {
  SOURCES.set(src.table, src);
  return () => {
    if (SOURCES.get(src.table) === src) SOURCES.delete(src.table);
  };
}

export function ragSource(table: string): RagSource | undefined {
  return SOURCES.get(table);
}

/** Does a table declare a RAG document (a custom builder, or `ai` without `features.rag: false`, or `features.rag`)? */
export function isRagTable(def: TableDef | undefined): def is TableDef {
  if (!def || def.virtual) return false;
  if (SOURCES.has(def.key)) return true;
  if (def.features?.rag === false) return false;
  return !!def.ai || def.features?.rag === true;
}

/** Every table the index covers (registered definitions; organisations' custom fields come from orgSchema). */
export function ragTables(): TableDef[] {
  return [...TABLES.values()].filter(isRagTable).sort((a, b) => (a.key < b.key ? -1 : 1));
}

const TEXT_TYPES = new Set(["string", "text", "markdown"]);

/** Fields of the default document: `ai.text`, plus fields marked `ai.index`, minus `ai.index: false`, secrets, ai_private and fields kept out of replicas (`noSync`). */
export function documentFields(def: TableDef): FieldDef[] {
  const named = new Set(def.ai?.text ?? []);
  return def.fields.filter((f) => {
    if (f.type === "secret" || f.group === "ai_private" || f.noSync || f.ai?.index === false) return false;
    if (!TEXT_TYPES.has(f.type)) return false;
    if (f.name === (def.ai?.title ?? def.display)) return false;
    return named.has(f.name) || f.ai?.index === true || (!def.ai && def.features?.rag === true && f.search === true);
  });
}

/** The record number shown in citations (INC0000012), when the table is numbered. */
export function recordNumber(def: TableDef, row: Record<string, unknown>): string | null {
  return def.numbered && row.number ? String(row.number) : null;
}

/** The default document of a record: its title and the text fields the TableDef names, each with its field group. */
export function defaultDocument(def: TableDef, row: Record<string, unknown>): RagDocument | null {
  const titleName = def.ai?.title ?? def.display;
  const titleField = def.fields.find((f) => f.name === titleName);
  const hiddenTitle = !titleField || titleField.type === "secret" || titleField.group === "ai_private";
  const title = hiddenTitle ? "" : String(row[titleName] ?? "").trim();
  const parts: RagPart[] = [];
  for (const f of documentFields(def)) {
    const raw = row[f.name];
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const text = f.ai?.redact ? maskText(String(raw)) : String(raw);
    parts.push({ field: f.name, label: f.label, text, group: f.group ?? null, format: f.type === "markdown" ? "markdown" : "text" });
  }
  if (!title && !parts.length) return null;
  // a record with a title only is still findable by it
  if (!parts.length && titleField) parts.push({ field: titleField.name, label: titleField.label, text: title, group: titleField.group ?? null, format: "text" });
  return {
    title: titleField?.ai?.redact ? maskText(title) : title,
    titleField: hiddenTitle ? null : titleName,
    titleGroup: hiddenTitle ? null : (titleField?.group ?? null),
    number: recordNumber(def, row),
    parts,
  };
}

/** What of a record's attachments the index reads (`ai.attachments`). */
export const ATTACHMENT_LIMITS = { files: 20, bytes: 15 * 1024 * 1024, chars: 200_000 } as const;

/**
 * The text of a record's attachments as parts of its document: one part per file and page, labelled with the file's
 * name, in `group` (default none: whoever reads the record) — or, with `files`, only those files, each in its own
 * group. Images (OCR is per runtime), unknown types, files over the size limit and contents a Windows app has not
 * fetched yet are left out; each file gives at most `ATTACHMENT_LIMITS.chars` characters.
 */
export async function attachmentParts(q: Queryable, orgId: string, table: string, id: string, group: RagPart["group"] = null, files?: { id: string; group: RagPart["group"] }[]): Promise<RagPart[]> {
  if (files && !files.length) return [];
  const only = files ? new Map(files.map((f) => [f.id.toLowerCase(), f.group ?? null])) : null;
  const rows = await q.query<{ id: string; name: string; mime: string; size: number; sha256: string }>(
    `select id, name, mime, size, sha256 from sm_attachments where org_id = $1 and table_key = $2 and record_id = $3 and deleted_at is null${only ? " and id = any($4::uuid[])" : ""}
     order by created_at, id limit ${ATTACHMENT_LIMITS.files}`,
    only ? [orgId, table, id, pgArray([...only.keys()])] : [orgId, table, id],
  );
  const parts: RagPart[] = [];
  for (const a of rows) {
    const fileGroup = only ? (only.get(String(a.id).toLowerCase()) ?? null) : group;
    const kind = fileKind(a.name, a.mime);
    if (Number(a.size) > ATTACHMENT_LIMITS.bytes || kind === "image" || kind === "other") continue;
    const blob = await q.one<{ b64: string }>(`select encode(data, 'base64') as b64 from sm_blobs where org_id = $1 and sha256 = $2`, [orgId, a.sha256]);
    if (!blob) continue;
    const parsed = await parseFile(a.name, a.mime, new Uint8Array(Buffer.from(blob.b64, "base64"))).catch(() => null);
    if (!parsed || parsed.kind !== "text") continue;
    let budget: number = ATTACHMENT_LIMITS.chars;
    const many = parsed.pages.length > 1;
    for (const p of parsed.pages) {
      const text = p.text.trim().slice(0, budget);
      if (!text) continue;
      budget -= text.length;
      parts.push({ field: `attachment:${a.id}`, label: `پیوست «${a.name}»`, text, group: fileGroup, page: many ? p.page : null, format: "text" });
      if (budget <= 0) break;
    }
  }
  return parts;
}

/** The document of a record: the table's registered builder, or the TableDef default; with its attachments' text when the table asks. */
export async function buildDocument(args: RagBuildArgs): Promise<RagDocument | null> {
  const src = SOURCES.get(args.def.key);
  const doc = src ? await src.build(args) : defaultDocument(args.def, args.row);
  if (!args.def.ai?.attachments || !args.def.features?.attachments || (doc && doc.attachments === false)) return doc;
  const named = doc?.attachments ? doc.attachments.files : undefined;
  // a table that shows each reader only some of its files (`filterSide`) indexes only the files its builder names: the
  // index never answers with a file the attachments API would hide
  if (!named && filtersSide(args.def.key)) return doc;
  const extra = await attachmentParts(args.q, args.ctx.org.id, args.def.key, String(args.row.id), doc?.attachments ? (doc.attachments.group ?? null) : null, named);
  if (!extra.length) return doc;
  if (doc) return { ...doc, parts: [...doc.parts, ...extra] };
  // nothing but attachments: still findable by them, under the record's title
  if (src) return null;
  const titleName = args.def.ai.title ?? args.def.display;
  const tf = args.def.fields.find((f) => f.name === titleName);
  const hidden = !tf || tf.type === "secret" || tf.group === "ai_private";
  return { title: hidden ? "" : String(args.row[titleName] ?? "").trim(), titleField: hidden ? null : titleName, titleGroup: hidden ? null : (tf?.group ?? null), number: recordNumber(args.def, args.row), parts: extra };
}

/** In-app path of a cited record (the module's own page when its source says so). */
export function citationPath(table: string, id: string, extra: { page?: number | null; chunk?: string } = {}): string {
  const src = SOURCES.get(table);
  return src?.path?.(id, extra) ?? `r/${table}/${id}`;
}

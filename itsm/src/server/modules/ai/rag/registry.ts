// What the AI index holds: tables declare their RAG document in their TableDef (`ai: { title, text }`, fields with
// `ai: { index, redact }`, `features.rag`), and modules may register a custom document builder for a table
// (`registerRagSource`) — e.g. the smart documents, whose text lives in pages. A builder runs as the system in a job and
// returns the parts with their field groups; the chunker keeps groups apart and retrieval drops a part a caller may not
// see. Fields of the `ai_private` group and secrets are never indexed.
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import type { FieldDef, TableDef } from "@shared/model/types";
import { TABLES } from "@shared/tables";
import { maskText } from "../redact";
import type { RagDocument, RagPart } from "./chunker";

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
}

const SOURCES = new Map<string, RagSource>();

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

/** Fields of the default document: `ai.text`, plus fields marked `ai.index`, minus `ai.index: false`, secrets and ai_private. */
export function documentFields(def: TableDef): FieldDef[] {
  const named = new Set(def.ai?.text ?? []);
  return def.fields.filter((f) => {
    if (f.type === "secret" || f.group === "ai_private" || f.ai?.index === false) return false;
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

/** The document of a record: the table's registered builder, or the TableDef default. */
export async function buildDocument(args: RagBuildArgs): Promise<RagDocument | null> {
  const src = SOURCES.get(args.def.key);
  if (src) return src.build(args);
  return defaultDocument(args.def, args.row);
}

/** In-app path of a cited record (the module's own page when its source says so). */
export function citationPath(table: string, id: string, extra: { page?: number | null; chunk?: string } = {}): string {
  const src = SOURCES.get(table);
  return src?.path?.(id, extra) ?? `r/${table}/${id}`;
}

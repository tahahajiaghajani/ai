// Client-side shapes of the record engine's HTTP API (docs/spec/ENGINE.md §12) and of the UI kit's own state.
// Pure types and tiny helpers: no React, no antd — the model folder is unit-tested in node (tests/ui-records-*).
import type { Cond } from "@shared/model/conditions";
import type { Option, StateCategory, TableDef } from "@shared/model/types";

/** A table as GET /meta/tables returns it: the organisation's effective definition and what the caller may do. */
export interface TableMeta extends TableDef {
  /** `participant`: only the records the person takes part in open (an approver without a role in the area) */
  can: { read: true; create: boolean; participant?: true };
}

export interface TablesPayload {
  tables: TableMeta[];
  /** options of every choice list the tables name (tenant edits applied) */
  choices: Record<string, Option[]>;
}

/** A record as the API returns it: id, version (the concurrency token), number and the visible fields. */
export interface RecordRow {
  id: string;
  version: number;
  number?: string | null;
  [field: string]: unknown;
}

/** Labels of referenced records and members: `{ [id]: label }`. Ids the caller may not read are absent. */
export type DisplayMap = Record<string, string>;

export interface RecordTransition {
  to: string;
  label: string;
  /** fields that must have a value once the transition is applied */
  requires: string[];
  category: StateCategory | null;
}

/** `meta` of a single record (GET /r/:table/:id). Modules add keys with `registerRecordMeta` (sla, viewers…). */
export interface RecordMeta {
  canWrite: boolean;
  canDelete: boolean;
  /** fields the caller cannot change on this record */
  readonly: string[];
  transitions: RecordTransition[];
  locked: boolean;
  watching?: boolean;
  /** "participant": the person reads this record only as a participant with a grant of its own (an approver) */
  reach?: "participant";
  sla?: unknown;
  viewers?: unknown;
  [k: string]: unknown;
}

export interface RecordResult {
  row: RecordRow;
  display: DisplayMap;
  meta: RecordMeta;
}

export interface ListQuery {
  filter?: Cond | null;
  q?: string;
  sort?: string;
  page?: number;
  size?: number;
  fields?: string[];
  ids?: string[];
  view?: string;
  total?: boolean;
  /** keyset pagination: the `next` cursor of the previous page */
  after?: string;
}

export interface ListResult {
  rows: RecordRow[];
  /** null when not counted (`total: false`); with `capped`, a lower bound */
  total: number | null;
  /** more rows match than `total` (the server counts up to 10 000: «بیش از ۱۰٬۰۰۰») */
  capped?: boolean;
  /** cursor of the next page when the sort allows keyset pagination */
  next?: string | null;
  page: number;
  size: number;
  display: DisplayMap;
}

export interface AggregateRow {
  keys: unknown[];
  labels: string[];
  values: Record<string, string | number | null>;
}

export interface AggregateResult {
  groups: unknown;
  rows: AggregateRow[];
  totals: Record<string, string | number | null>;
  display: DisplayMap;
}

export type JournalKind = "comment" | "work_note" | "system" | "email_in" | "email_out" | "approval" | "ai";

export interface JournalEntry {
  id: string;
  kind: JournalKind;
  visibility: "public" | "internal";
  body: string;
  author: string | null;
  created_at: string;
  data: Record<string, unknown> | null;
  attachments: { id: string; name: string; mime: string; size: number }[];
}

export interface HistoryEntry {
  id: string;
  field: string;
  label: string;
  type: string;
  old: unknown;
  new: unknown;
  actor: string | null;
  at: string;
}

export interface LinkItem {
  id: string;
  kind: string;
  direction: "out" | "in";
  /** the relation as read from this record («ناشی از»، «علت»…) */
  label: string;
  other: { table: string; id: string; number: string | null; display: string; state: string | null; state_label: string | null };
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export interface AttachmentItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  uploaded_by: string | null;
  created_at: string;
  /** a raster image the UI may show inline */
  previewable: boolean;
}

/** A saved list view (`view` table). */
export interface ViewRow extends RecordRow {
  table_key: string;
  name: string;
  owner_id: string | null;
  shared: boolean;
  is_default: boolean;
  kind: "list" | "kanban" | "calendar" | "chart" | string;
  filter: Cond | null;
  q: string | null;
  columns: unknown;
  sort: string | null;
  group_by: string | null;
  page_size: number | null;
}

/** An API error as the UI sees it (ApiError of lib/api.ts carries these). */
export interface ApiErrorLike {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Per-field messages of a 400 `validation` / 403 `forbidden_field` / 409 `duplicate` error. */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  const d = (e as { details?: { fields?: unknown } } | null)?.details;
  const f = d?.fields;
  if (!f || typeof f !== "object" || Array.isArray(f)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>)) out[k] = typeof v === "string" ? v : "مقدار این فیلد پذیرفته نشد";
  return out;
}

/** True for the engine's stale-version answer (409 version_conflict). */
export const isConflict = (e: unknown): boolean => {
  const x = e as Partial<ApiErrorLike> | null;
  return !!x && x.status === 409 && x.code === "version_conflict";
};

// What modules plug into the generic record UI, per table (or "*" for every table): list presets (a queue's fixed
// filter, columns, sort, quick filters, board and calendar settings, row tones, bulk actions), record-page widgets
// (header actions, «بیشتر» menu items, side-panel widgets, tabs), the composer's two slots (`cannedResponses`,
// `aiDraft`), UI policies, kanban card fields, and where a table's records live in the app (their path). Later
// services plug in the organisation's stored UI policies and the holiday calendar with `setPolicySource` /
// `setHolidaySource`. A module registers once, at import time; `registerRecordExtensions` returns an unregister
// function (tests).
import type { ReactNode } from "react";
import type { Cond } from "@shared/model/conditions";
import type { OrgApi } from "../lib/api";
import type { UiPolicy } from "./model/policies";
import type { ListMode } from "./model/views";
import type { DisplayMap, RecordMeta, RecordRow, TableMeta } from "./model/types";
import type { Schema } from "./model/schema";

/** What record-page widgets get. */
export interface RecordContext {
  table: string;
  def: TableMeta;
  schema: Schema;
  row: RecordRow;
  display: DisplayMap;
  meta: RecordMeta;
  /** saves fields of this record (with its version; conflicts open the dialog) */
  save: (data: Record<string, unknown>) => Promise<boolean>;
  /** takes a transition (asks for the fields it requires first) */
  transition: (to: string) => Promise<boolean>;
  /** reloads the record and its activity */
  refresh: () => void;
}

/** What the composer's slots get: the record, the tab in use and the text being written. */
export interface ComposerContext {
  record: RecordContext;
  kind: "comment" | "work_note";
  text: string;
  /** replaces the whole text */
  setText: (text: string) => void;
  /** inserts at the caret */
  insert: (text: string) => void;
}

export interface SidePanelWidget {
  key: string;
  title: string;
  order?: number;
  when?: (ctx: RecordContext) => boolean;
  render: (ctx: RecordContext) => ReactNode;
}

export interface RecordTab {
  key: string;
  label: string;
  order?: number;
  when?: (ctx: RecordContext) => boolean;
  render: (ctx: RecordContext) => ReactNode;
}

export interface MoreAction {
  key: string;
  label: string;
  danger?: boolean;
  when?: (ctx: RecordContext) => boolean;
  run: (ctx: RecordContext) => void | Promise<void>;
}

/** A bulk action of a list besides the built-in ones (set field, assign, transition, watch, delete). */
export interface BulkAction {
  key: string;
  label: string;
  danger?: boolean;
  /** runs on the selected ids; return a Persian summary for the toast */
  run: (ids: string[], api: OrgApi) => Promise<string | void>;
}

export interface ListPreset {
  /** always applied (a queue); shown as a quiet line, not editable in the builder */
  filter?: Cond | null;
  /** default columns (a person's own choice still wins) */
  columns?: string[];
  sort?: string;
  /** quick filters on when the page opens */
  quick?: string[];
  pageSize?: number;
  groupBy?: string | null;
  /** view modes offered (default: list, plus board/calendar/timeline when the table supports them) */
  modes?: ListMode[];
  board?: {
    field?: string;
    /** WIP limits by column value */
    wip?: Record<string, number>;
    /** fields on a card besides the number and title (default: priority and assignee) */
    cardFields?: string[];
    /** group cards into horizontal lanes by this field */
    swimlane?: string;
  };
  calendar?: { start: string; end?: string };
  timeline?: { start: string; end: string };
  /** row colouring by rule: a quiet tint for rows that need attention */
  rowTone?: (row: RecordRow) => "danger" | "warning" | null;
  bulkActions?: BulkAction[];
  /** the sentence of the empty list («هنوز رخدادی ثبت نشده است») */
  emptyText?: string;
}

export interface RecordExtensions {
  /** org-relative base path of the table's pages («incidents» → incidents, incidents/new, incidents/:id) */
  path?: string;
  list?: ListPreset;
  policies?: UiPolicy[];
  headerActions?: (ctx: RecordContext) => ReactNode;
  moreActions?: MoreAction[];
  sidePanels?: SidePanelWidget[];
  tabs?: RecordTab[];
  /** composer slot: canned responses («پاسخ‌های آماده»); renders nothing when absent */
  cannedResponses?: (c: ComposerContext) => ReactNode;
  /** composer slot: an AI draft of the reply or note; renders nothing when absent */
  aiDraft?: (c: ComposerContext) => ReactNode;
  /** fields shown on kanban cards and record previews */
  cardFields?: string[];
  /** fields a new record starts with (a template), on top of the definition's defaults */
  defaults?: (search: URLSearchParams) => Record<string, unknown>;
}

const REGISTRY = new Map<string, RecordExtensions[]>();
let version = 0;

/** Adds extensions for a table ("*" = every table). Several registrations merge; returns an unregister function. */
export function registerRecordExtensions(table: string, ext: RecordExtensions): () => void {
  const list = REGISTRY.get(table) ?? [];
  list.push(ext);
  REGISTRY.set(table, list);
  version++;
  return () => {
    const l = REGISTRY.get(table);
    if (!l) return;
    const i = l.indexOf(ext);
    if (i >= 0) l.splice(i, 1);
    version++;
  };
}

/** Changes whenever a registration changes (memo key). */
export const extensionsVersion = (): number => version;

/**
 * The extensions of a table: "*" first, then the table's own, in registration order. Lists and arrays add up;
 * a later scalar (path, slot, preset value) wins.
 */
export function extensionsFor(table: string): RecordExtensions {
  const parts = [...(REGISTRY.get("*") ?? []), ...(REGISTRY.get(table) ?? [])];
  const out: RecordExtensions = {};
  const headers: NonNullable<RecordExtensions["headerActions"]>[] = [];
  for (const p of parts) {
    if (p.path) out.path = p.path;
    if (p.list) out.list = mergePreset(out.list, p.list);
    if (p.policies) out.policies = [...(out.policies ?? []), ...p.policies];
    if (p.headerActions) headers.push(p.headerActions);
    if (p.moreActions) out.moreActions = [...(out.moreActions ?? []), ...p.moreActions];
    if (p.sidePanels) out.sidePanels = [...(out.sidePanels ?? []), ...p.sidePanels];
    if (p.tabs) out.tabs = [...(out.tabs ?? []), ...p.tabs];
    if (p.cannedResponses) out.cannedResponses = p.cannedResponses;
    if (p.aiDraft) out.aiDraft = p.aiDraft;
    if (p.cardFields) out.cardFields = p.cardFields;
    if (p.defaults) out.defaults = p.defaults;
  }
  if (headers.length) out.headerActions = (ctx) => headers.map((h) => h(ctx));
  out.sidePanels?.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  out.tabs?.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return out;
}

function mergePreset(a: ListPreset | undefined, b: ListPreset): ListPreset {
  if (!a) return { ...b };
  return {
    ...a,
    ...b,
    board: a.board || b.board ? { ...a.board, ...b.board } : undefined,
    bulkActions: [...(a.bulkActions ?? []), ...(b.bulkActions ?? [])],
  };
}

// ---------------------------------------------------------------- paths

/** Org-relative base path of a table's pages: the module's, else the generic `r/<table>`. */
export const tablePath = (table: string): string => extensionsFor(table).path ?? `r/${table}`;
/** Org-relative path of a record. */
export const recordPath = (table: string, id: string): string => `${tablePath(table)}/${id}`;
/** Org-relative path of a new record's form. */
export const newRecordPath = (table: string): string => `${tablePath(table)}/new`;

// ---------------------------------------------------------------- pluggable sources

export interface Holiday {
  /** ISO date */
  date: string;
  title: string;
  /** a half working day */
  half?: boolean;
}

type PolicySource = (api: OrgApi, table: string) => Promise<UiPolicy[]>;
type HolidaySource = (api: OrgApi, from: string, to: string) => Promise<Holiday[]>;

let policySource: PolicySource | null = null;
let holidaySource: HolidaySource | null = null;

/** The organisation's stored UI policies (the platform's `ui_policy` table, once it exists). */
export function setPolicySource(fn: PolicySource | null): void {
  policySource = fn;
}
export const getPolicySource = (): PolicySource | null => policySource;

/** Holidays of the organisation's calendar (shaded in CalendarView; Fridays always are). */
export function setHolidaySource(fn: HolidaySource | null): void {
  holidaySource = fn;
}
export const getHolidaySource = (): HolidaySource | null => holidaySource;

// The state of a list page — saved view, filter, quick filters, search, sort, grouping, page, page size and the
// view mode (list, board, calendar, timeline) — kept in the URL so every list is a deep link, and saved views
// (`view` table: personal or shared, a default per person or for everyone) loaded into and saved from it.
// Selecting a view copies its settings into the page (the filter is editable in the builder, nothing is hidden);
// «ذخیره» writes them back, «ذخیره به‌عنوان نمای جدید» creates a personal view. Pure: no React, no antd.
import type { Cond } from "@shared/model/conditions";
import { decodeFilter, encodeFilter, isCondShape } from "./filter";
import { sameValue } from "./values";
import type { ViewRow } from "./types";

/** Every field of a saved view: lists leave out long values (the filter, the columns) unless they are asked for. */
export const VIEW_FIELDS = ["table_key", "name", "owner_id", "shared", "is_default", "kind", "filter", "q", "columns", "sort", "group_by", "page_size"];

export type ListMode = "list" | "board" | "calendar" | "timeline";
export const LIST_MODES: ListMode[] = ["list", "board", "calendar", "timeline"];
export const PAGE_SIZES = [20, 50, 100, 200];
export const DEFAULT_PAGE_SIZE = 50;

export interface ListState {
  /** the saved view the page started from */
  view: string | null;
  filter: Cond | null;
  /** keys of the quick filters that are on */
  quick: string[];
  q: string;
  /** "" = the table's default order */
  sort: string;
  groupBy: string | null;
  size: number;
  page: number;
  mode: ListMode;
}

export const emptyListState = (o: Partial<ListState> = {}): ListState => ({
  view: null, filter: null, quick: [], q: "", sort: "", groupBy: null, size: DEFAULT_PAGE_SIZE, page: 1, mode: "list", ...o,
});

const int = (s: string | null, d: number, min: number, max: number) => {
  const n = Number(s);
  return s !== null && Number.isInteger(n) && n >= min && n <= max ? n : d;
};

/** The page's state from its query string (unknown or malformed parts fall back to `base`). */
export function readListState(p: URLSearchParams, base: Partial<ListState> = {}): ListState {
  const b = emptyListState(base);
  const mode = p.get("mode") as ListMode | null;
  const filter = p.has("filter") ? decodeFilter(p.get("filter")) : b.filter;
  return {
    view: p.get("view") || b.view,
    filter,
    quick: p.has("quick") ? (p.get("quick") ?? "").split(",").filter(Boolean) : b.quick,
    q: p.get("q") ?? b.q,
    sort: p.get("sort") ?? b.sort,
    groupBy: p.has("group") ? p.get("group") || null : b.groupBy,
    size: int(p.get("size"), b.size, 5, 500),
    page: int(p.get("page"), 1, 1, 100000),
    mode: mode && LIST_MODES.includes(mode) ? mode : b.mode,
  };
}

/** The query string of a state: only what differs from `base`, so a plain list keeps a clean URL. */
export function writeListState(s: ListState, base: Partial<ListState> = {}): URLSearchParams {
  const b = emptyListState(base);
  const p = new URLSearchParams();
  if (s.view) p.set("view", s.view);
  if (!sameValue(s.filter, b.filter)) p.set("filter", encodeFilter(s.filter));
  if (s.quick.join(",") !== b.quick.join(",")) p.set("quick", s.quick.join(","));
  if (s.q) p.set("q", s.q);
  if (s.sort && s.sort !== b.sort) p.set("sort", s.sort);
  if (s.groupBy !== b.groupBy) p.set("group", s.groupBy ?? "");
  if (s.size !== b.size) p.set("size", String(s.size));
  if (s.page > 1) p.set("page", String(s.page));
  if (s.mode !== b.mode) p.set("mode", s.mode);
  return p;
}

const modeOfKind = (kind: string | null | undefined): ListMode => (kind === "kanban" ? "board" : kind === "calendar" ? "calendar" : "list");
export const kindOfMode = (m: ListMode): string => (m === "board" ? "kanban" : m === "calendar" ? "calendar" : "list");

/** The columns a view stores (`columns` json: a list of names, or `{ columns: [...] }`). */
export function viewColumns(v: Pick<ViewRow, "columns">): string[] | null {
  const c = v.columns as unknown;
  const list = Array.isArray(c) ? c : c && typeof c === "object" && Array.isArray((c as { columns?: unknown }).columns) ? (c as { columns: unknown[] }).columns : null;
  return list ? list.filter((x): x is string => typeof x === "string") : null;
}

/** A view's settings as page state (and its columns, when it stores some). */
export function stateOfView(v: ViewRow): { state: Partial<ListState>; columns: string[] | null } {
  return {
    state: {
      view: v.id,
      filter: v.filter && isCondShape(v.filter) ? v.filter : null,
      quick: [],
      q: v.q ?? "",
      sort: v.sort ?? "",
      groupBy: v.group_by || null,
      size: v.page_size ?? DEFAULT_PAGE_SIZE,
      page: 1,
      mode: modeOfKind(v.kind),
    },
    columns: viewColumns(v),
  };
}

/** The fields of a `view` row that hold a page's state (the body of «ذخیره» and «ذخیره به‌عنوان نمای جدید»). */
export function viewBody(s: ListState, columns: string[], quickCond: Cond | null): Record<string, unknown> {
  const filter = quickCond ? (s.filter ? { and: [s.filter, quickCond] } : quickCond) : s.filter;
  return {
    filter: filter ?? null,
    q: s.q || null,
    sort: s.sort || null,
    group_by: s.groupBy || null,
    page_size: s.size,
    columns,
    kind: kindOfMode(s.mode),
  };
}

/** True when the page no longer matches the view it started from. */
export function viewDirty(v: ViewRow | null | undefined, s: ListState, columns: string[]): boolean {
  if (!v) return false;
  const saved = stateOfView(v);
  const cols = saved.columns;
  return (
    !sameValue(saved.state.filter ?? null, s.filter) ||
    s.quick.length > 0 ||
    (saved.state.q ?? "") !== s.q ||
    (saved.state.sort ?? "") !== s.sort ||
    (saved.state.groupBy ?? null) !== s.groupBy ||
    (saved.state.size ?? DEFAULT_PAGE_SIZE) !== s.size ||
    (cols !== null && cols.join(",") !== columns.join(",")) ||
    (v.kind ? modeOfKind(v.kind) !== s.mode && s.mode !== "timeline" : false)
  );
}

/** The view a page opens with: the person's own default, else a shared default; null for none. */
export function defaultView(views: readonly ViewRow[], me: string | null | undefined): ViewRow | null {
  const mine = views.find((v) => v.is_default && v.owner_id === me);
  if (mine) return mine;
  return views.find((v) => v.is_default && v.shared && v.owner_id !== me) ?? null;
}

/** The person's views first, then the shared views of others; each by name. */
export function groupViews(views: readonly ViewRow[], me: string | null | undefined): { mine: ViewRow[]; shared: ViewRow[] } {
  const byName = (a: ViewRow, b: ViewRow) => a.name.localeCompare(b.name, "fa");
  return {
    mine: views.filter((v) => v.owner_id === me).sort(byName),
    shared: views.filter((v) => v.owner_id !== me && v.shared).sort(byName),
  };
}

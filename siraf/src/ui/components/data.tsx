// Generic data screens: a server-paginated table, a form built from field definitions, and the
// complete list+form page for any master-data entity in @shared/entities.
// Look (components.md §4, §5, §7, §8): compact 32 px rows, unfilled 400-weight headers, numeric columns start-aligned
// with tabular figures and never ellipsized, a sticky header, skeleton rows on the first load, the old rows at 60 %
// on refetch, row actions revealed on hover, and empty states with one helpful line and one action.
import "./kit.css";
import { Children, Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Table, Button, Input, Select, Drawer, Form, Switch, Dropdown, Upload, Tooltip, Popconfirm, Popover, Space, Segmented } from "antd";
import type { ColumnsType, ColumnType, TablePaginationConfig, TableProps } from "antd/es/table";
import { Plus, Pencil, Trash2, Download, RotateCw, Search, Ellipsis, Upload as UploadIcon, ImagePlus, Check, SearchX, CircleAlert, ListPlus, ListFilter, ChevronDown } from "lucide-react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ENTITIES, fieldsFor, type EntityDef, type FieldDef } from "@shared/entities";
import { checkFormat } from "@shared/validate";
import { faDigits } from "@shared/format";
import { useOrg } from "../lib/org";
import { useAction, useNotify, useDebounced, useIsPhone } from "../lib/hooks";
import { errorText } from "../lib/api";
import { exportExcel } from "../lib/excel";
import { Money, JDate, Weight, Amount, StatusTag, EmptyState, Chip } from "./display";
import { NumberInput, MoneyInput, PctInput, WeightInput, DateInput, RefSelect, AccountSelect, FilterChip, DateRangeChip } from "./inputs";
import { PageHeader } from "./layout";
import { ImportDrawer } from "./import";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
/** The sticky header sits under the glass top bar (48) and its 8 px canvas band (shell.css). */
const TOPBAR_OFFSET = 56;
const SKELETON_ROWS = 8;
const SKEL_WIDTHS = [72, 58, 84, 64, 90, 52, 76, 66];

/** Columns the kit treats as figures: `className: "sf-num"`, or the old RTL convention `align: "left"`. */
function isNumericColumn(c: ColumnType<any>): boolean {
  return c.align === "left" || /\bsf-num\b/.test(String(c.className ?? ""));
}

/**
 * Numeric columns are start-aligned (right in RTL: an LTR number then lines up its units digits), tabular and never
 * ellipsized (components.md §4.2). The old `align: "left"` is turned into exactly that.
 */
function normalizeColumns<T>(cols: ColumnsType<T>): ColumnsType<T> {
  return cols.map((c) => {
    if ("children" in c && c.children) return { ...c, children: normalizeColumns(c.children) };
    const col = c as ColumnType<T>;
    if (!isNumericColumn(col)) return c;
    const { align: _align, ...rest } = col;
    return { ...rest, className: cx(String(col.className ?? "").replace(/\bsf-num\b/, "").trim(), "sf-num"), ellipsis: false };
  });
}

/** The same columns drawing skeleton bars: text cells 55–90 % wide, figures a short start-aligned bar. */
function skeletonColumns<T>(cols: ColumnsType<T>): ColumnsType<T> {
  return cols.map((c, i) => {
    if ("children" in c && c.children) return { ...c, children: skeletonColumns(c.children) };
    const col = c as ColumnType<T>;
    const numeric = /\bsf-num\b/.test(String(col.className ?? ""));
    const bare = !col.title;
    return {
      ...col,
      sorter: false,
      onCell: undefined,
      render: (_: unknown, __: T, row: number) =>
        bare ? null : (
          <span className="sf-skel-cell">
            <i className="sf-skel" style={{ inlineSize: numeric ? 72 : `${SKEL_WIDTHS[(i + row) % SKEL_WIDTHS.length]}%`, minInlineSize: 32, maxInlineSize: 220 }} />
          </span>
        ),
    };
  });
}

// ---------------------------------------------------------------- phone: stacked rows

const colKey = (c: ColumnType<any>) => String(c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join(".") : (c.dataIndex ?? "")));
const colTitle = (c: ColumnType<any>) => (typeof c.title === "string" ? c.title : "");
const isDateCol = (c: ColumnType<any>) => /(^|_|\.)(date|due|at|time|when)($|_)|date$/i.test(colKey(c)) || /تاریخ|سررسید|زمان/.test(colTitle(c));
const isStatusCol = (c: ColumnType<any>) => /status|state/i.test(colKey(c)) || /^وضعیت/.test(colTitle(c));
const isFigureCol = (c: ColumnType<any>) => /\bsf-num\b/.test(String(c.className ?? "")) && !isDateCol(c);
const AMOUNT_RE = /amount|total|sum|net|price|value|balance|مبلغ|جمع|مانده|ارزش|کل/i;
const NAME_RE = /name|party|title|desc|memo|customer|supplier|account|نام|شرح|طرف|شخص|عنوان|مشتری|حساب|دریافت از|پرداخت به|^از$|^به$/i;

function cellOf<T>(c: ColumnType<T>, r: T, i: number): ReactNode {
  const di = c.dataIndex;
  const path = di === undefined || di === null ? [] : Array.isArray(di) ? di : [di];
  let v: unknown = r;
  for (const k of path) v = v == null ? undefined : (v as Record<string, unknown>)[k as string];
  if (!path.length) v = undefined;
  const out = c.render ? (c.render(v, r, i) as unknown) : v;
  if (out && typeof out === "object" && !isValidElement(out) && !Array.isArray(out) && "children" in (out as object)) return (out as { children: ReactNode }).children;
  if (out === undefined || out === null || out === "") return c.render ? null : <span className="sf-zero">—</span>;
  return out as ReactNode;
}

/**
 * Below 640 px a list row becomes a stack (no sideways scroll, no figure cut at the edge): line 1 the document number
 * and date with the status and row actions at the end, line 2 the party or description, line 3 the amount on its own
 * line, start-aligned, then up to three other columns as quiet «label value» pairs. Returns null when the columns
 * cannot be stacked (grouped headers).
 */
function stackColumns<T>(cols: ColumnsType<T>, skeleton: boolean): ColumnsType<T> | null {
  if (cols.some((c) => "children" in c && c.children)) return null;
  const leaf = cols as ColumnType<T>[];
  const titled = leaf.filter((c) => !!c.title && !c.hidden);
  if (titled.length < 2) return null;
  const actions = leaf.filter((c) => !c.title && (c.render || c.dataIndex));
  const used = new Set<ColumnType<T>>();
  const take = (c: ColumnType<T> | undefined) => (c && !used.has(c) ? (used.add(c), c) : undefined);
  const first = titled[0];
  const id = !isDateCol(first) && !isStatusCol(first) && !NAME_RE.test(colTitle(first) || colKey(first)) ? take(first) : undefined;
  const date = take(titled.find((c) => !used.has(c) && isDateCol(c)));
  const status = take(titled.find((c) => !used.has(c) && isStatusCol(c)));
  const texts = titled.filter((c) => !used.has(c) && !isFigureCol(c) && !isDateCol(c));
  const name = take(texts.find((c) => NAME_RE.test(colTitle(c)) || NAME_RE.test(colKey(c))) ?? texts[0]);
  const figures = titled.filter((c) => !used.has(c) && isFigureCol(c));
  const amount = take(figures.find((c) => AMOUNT_RE.test(colTitle(c)) || AMOUNT_RE.test(colKey(c))) ?? figures[0]);
  const rest = titled.filter((c) => !used.has(c)).slice(0, 3);
  const skel = (w: number | string) => <i className="sf-skel" style={{ inlineSize: w }} />;
  return [
    {
      key: "__stack",
      className: "sf-stk-cell",
      render: (_: unknown, r: T, i: number) =>
        skeleton ? (
          <div className="sf-stk">
            <div className="sf-stk-l1">{skel(120)}</div>
            <div className="sf-stk-l2">{skel("62%")}</div>
            <div className="sf-stk-l3">{skel(96)}</div>
          </div>
        ) : (
          <div className="sf-stk">
            <div className="sf-stk-l1">
              {id ? <span className="sf-stk-id">{cellOf(id, r, i)}</span> : null}
              {id && date ? <span className="sf-stk-dot" aria-hidden /> : null}
              {date ? <span className="sf-stk-date">{cellOf(date, r, i)}</span> : null}
              {!id && !date && name ? <span className="sf-stk-name">{cellOf(name, r, i)}</span> : null}
              <span className="sf-stk-end">
                {status ? cellOf(status, r, i) : null}
                {actions.map((a) => (
                  <Fragment key={colKey(a)}>{cellOf(a, r, i)}</Fragment>
                ))}
              </span>
            </div>
            {name && (id || date) ? <div className="sf-stk-l2">{cellOf(name, r, i)}</div> : null}
            {amount || rest.length ? (
              <div className="sf-stk-l3">
                {amount ? (
                  <span className="sf-stk-amt">
                    {cellOf(amount, r, i)}
                    {/\(([^)]+)\)/.test(colTitle(amount)) ? <span className="sf-unit">{"\u00a0"}{/\(([^)]+)\)/.exec(colTitle(amount))![1]}</span> : null}
                  </span>
                ) : null}
                {rest.map((c) => (
                  <span key={colKey(c)} className="sf-stk-kv">
                    {colTitle(c) ? <span className="sf-stk-k">{colTitle(c)}</span> : null}
                    <span className="sf-stk-v">{cellOf(c, r, i)}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ),
    },
  ];
}

// ---------------------------------------------------------------- filters row (§2)

/** The toolbar's own controls, with fragments and antd `Space` wrappers opened up. */
function flattenToolbar(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  Children.forEach(node, (c) => {
    if (!isValidElement(c)) return;
    const props = c.props as { children?: ReactNode };
    if (c.type === Fragment || c.type === Space) out.push(...flattenToolbar(props.children));
    else out.push(c);
  });
  return out;
}

const isDateInput = (e: ReactElement | undefined): e is ReactElement<{ value?: string | null; onChange?: (v: string | null) => void; placeholder?: string }> => !!e && e.type === DateInput;
const isSearchInput = (e: ReactElement) => e.type === Input || e.type === Input.Search;

/** «از تاریخ» + «تا تاریخ» (side by side, or in a `.bk-range` wrapper with «تا» between) become one range chip. */
function mergeDateRanges(items: ReactElement[]): ReactElement[] {
  const out: ReactElement[] = [];
  const chip = (a: ReactElement, b: ReactElement, key: string) => {
    const pa = a.props as { value?: string | null; onChange?: (v: string | null) => void };
    const pb = b.props as { value?: string | null; onChange?: (v: string | null) => void };
    return (
      <DateRangeChip
        key={key}
        value={{ from: pa.value ?? null, to: pb.value ?? null }}
        onChange={(r) => {
          if ((r.from ?? null) !== (pa.value ?? null)) pa.onChange?.(r.from);
          if ((r.to ?? null) !== (pb.value ?? null)) pb.onChange?.(r.to);
        }}
      />
    );
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const inner = isDateInput(it) ? [] : flattenToolbar((it.props as { children?: ReactNode }).children).filter(isDateInput);
    if (inner.length === 2 && flattenToolbar((it.props as { children?: ReactNode }).children).every((x) => isDateInput(x) || x.type === "span")) {
      out.push(chip(inner[0], inner[1], String(it.key ?? `range${i}`)));
    } else if (isDateInput(it) && isDateInput(items[i + 1]) && !/^تا/.test(String(it.props.placeholder ?? ""))) {
      out.push(chip(it, items[i + 1], String(it.key ?? `range${i}`)));
      i++;
    } else out.push(it);
  }
  return out;
}

/** Whether a filter control holds a value (for the «پالایه‌های بیشتر (n)» count). */
function isApplied(e: ReactElement): boolean {
  const p = e.props as Record<string, unknown>;
  if (e.type === Segmented || isSearchInput(e)) return false;
  if (e.type === DateRangeChip) {
    const v = p.value as { from?: string | null; to?: string | null };
    return !!(v?.from || v?.to);
  }
  if (p["aria-pressed"] === true) return true;
  const v = p.value;
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== "" && v !== false;
}

const MAX_VISIBLE = 4;

/**
 * The filters row of a list (components.md §2): one row, at most four controls visible (the search plus three), the
 * rest behind «پالایه‌های بیشتر» with the number applied; a from/to date pair is one range chip. On a phone: the search
 * at full width and one «پالایه‌ها» button that opens a bottom sheet with the other filters.
 */
function FilterBar({ toolbar, tools, onClear }: { toolbar: ReactNode; tools: ReactNode; onClear?: () => void }) {
  const phone = useIsPhone();
  const [sheet, setSheet] = useState(false);
  const all = mergeDateRanges(flattenToolbar(toolbar)).map((e, i) => (e.key == null ? cloneElement(e, { key: `f${i}` }) : e));
  // «پاک کردن» (a `.sf-fclear` link) always stays at the end of the visible row
  const isClear = (e: ReactElement) => /\bsf-fclear\b/.test(String((e.props as { className?: string }).className ?? ""));
  // the search always comes first (it is the one that fills the row on a phone)
  const controls = all.filter((e) => !isClear(e));
  const si = controls.findIndex(isSearchInput);
  const items = si > 0 ? [controls[si], ...controls.slice(0, si), ...controls.slice(si + 1)] : controls;
  const trailing = all.filter(isClear);
  const search = phone && items[0] && isSearchInput(items[0]) ? items[0] : null;
  const rest = search ? items.slice(1) : items;
  const visible = phone ? (search ? [search] : rest.length <= 1 ? rest : []) : items.length > MAX_VISIBLE ? items.slice(0, MAX_VISIBLE) : items;
  const hidden = phone ? (search || rest.length > 1 ? rest : []) : items.slice(visible.length);
  const applied = hidden.filter(isApplied).length;
  const count = applied ? <span className="sf-fmore-n">{faDigits(applied)}</span> : null;
  const moreLabel = phone ? "پالایه‌ها" : "پالایه‌های بیشتر";
  const moreBtn = (
    <span className={cx("sf-fchip", applied > 0 && "is-on")}>
      <button type="button" className="sf-fchip-b" onClick={phone ? () => setSheet(true) : undefined} aria-haspopup="dialog">
        <ListFilter {...ICON} className="sf-fchip-ic" aria-hidden />
        <span className="sf-fchip-t">{moreLabel}</span>
        {count}
        {phone ? null : <ChevronDown size={14} strokeWidth={1.4} absoluteStrokeWidth className="sf-fchip-chev" aria-hidden />}
      </button>
    </span>
  );
  return (
    <div className="sf-st-bar no-print" data-phone={phone ? "" : undefined}>
      <div className="sf-st-filters">
        {visible}
        {hidden.length ? (
          phone ? (
            moreBtn
          ) : (
            <Popover trigger={["click"]} placement="bottomRight" rootClassName="sf-fmore-pop" content={<div className="sf-fmore">{hidden}</div>}>
              {moreBtn}
            </Popover>
          )
        ) : null}
        {phone ? null : trailing}
      </div>
      <div className="sf-st-tools">{tools}</div>
      {phone && hidden.length ? (
        <Drawer
          open={sheet}
          onClose={() => setSheet(false)}
          placement="bottom"
          title="پالایه‌ها"
          closable={{ placement: "end" }}
          rootClassName="sf-fsheet"
          size="auto"
          footer={
            <div className="sf-fsheet-f">
              {onClear && applied ? (
                <Button type="text" onClick={onClear}>
                  پاک کردن همه
                </Button>
              ) : null}
              <Button type="primary" onClick={() => setSheet(false)}>
                نمایش نتایج
              </Button>
            </div>
          }
        >
          <div className="sf-fmore">{hidden}</div>
        </Drawer>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- server table

export interface ServerTableProps<T> {
  path: string;
  params?: Record<string, string | number | undefined | null>;
  columns: ColumnsType<T>;
  rowKey?: string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  toolbar?: ReactNode;
  exportName?: string;
  exportColumns?: { title: string; value: (r: T) => string | number | null | undefined; type?: "number" | "text" }[];
  queryKey?: unknown[];
  rowClassName?: (row: T) => string;
  summary?: (rows: readonly T[]) => ReactNode;
  scrollX?: number | string;
  select?: (data: any) => { rows: T[]; total: number };
  /** extra buttons beside reload/export */
  tools?: ReactNode;
  /** the record open in the side sheet: the neutral selected fill plus the 3 px Dusk start bar */
  activeKey?: string | null;
  /** what an empty, unfiltered table shows (default: a quiet «هنوز موردی ثبت نشده است») */
  empty?: ReactNode;
  /** search or filters are applied: an empty result is «پیدا نشد» with a way back */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** bulk actions: antd rowSelection (the checkbox column comes first) */
  rowSelection?: TableProps<T>["rowSelection"];
  /** the header sticks under the top bar while the page scrolls (default true) */
  sticky?: boolean;
  /** density: compact 32 px rows (the default on lists and ledgers) or comfortable 40 px */
  size?: "small" | "middle";
  /** called with the visible page and the total whenever they change */
  onData?: (rows: T[], total: number) => void;
}

export function ServerTable<T extends { id?: string }>({
  path, params, columns, rowKey = "id", onRowClick, pageSize = 50, toolbar, exportName, exportColumns, queryKey, rowClassName, summary, scrollX, select, tools,
  activeKey, empty, filtered, onClearFilters, rowSelection, sticky = true, size = "small", onData,
}: ServerTableProps<T>) {
  const { api } = useOrg();
  const [page, setPage] = useState(1);
  const [size_, setSize] = useState(pageSize);
  const [sort, setSort] = useState<{ field?: string; dir?: "asc" | "desc" }>({});
  const [exporting, setExporting] = useState(false);
  const q = useQuery({
    queryKey: [...(queryKey ?? ["table", path]), params, page, size_, sort],
    queryFn: () => api.get(path, { ...params, page, size: size_, sort: sort.field, dir: sort.dir }),
    placeholderData: keepPreviousData,
  });
  const data = select ? select(q.data) : { rows: (q.data?.rows ?? []) as T[], total: q.data?.total ?? 0 };
  const n = useNotify();
  const cols = useMemo(() => normalizeColumns(columns), [columns]);
  const firstLoad = q.isLoading && !q.data;
  const keyOf = (r: T) => String((r as Record<string, unknown>)[rowKey] ?? "");

  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  useEffect(() => {
    if (q.data !== undefined) onDataRef.current?.(data.rows, data.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  // a search, a filter or a new page size can leave the current page past the end: go back to the first one
  const paramsKey = JSON.stringify(params ?? {});
  const lastParams = useRef(paramsKey);
  useEffect(() => {
    if (lastParams.current !== paramsKey) {
      lastParams.current = paramsKey;
      setPage(1);
    }
  }, [paramsKey]);

  const searching = filtered ?? Object.entries(params ?? {}).some(([k, v]) => k === "q" && v !== undefined && v !== null && String(v).trim() !== "");

  const emptyNode = q.isError ? (
    <EmptyState
      icon={CircleAlert}
      title="بارگذاری انجام نشد"
      description={errorText(q.error)}
      action={
        <Button icon={<RotateCw {...ICON} />} onClick={() => q.refetch()}>
          تلاش دوباره
        </Button>
      }
    />
  ) : searching ? (
    <EmptyState
      icon={SearchX}
      title="چیزی پیدا نشد"
      description="عبارت جستجو یا پالایه‌ها را تغییر دهید."
      action={onClearFilters ? <Button onClick={onClearFilters}>پاک کردن پالایه‌ها</Button> : undefined}
    />
  ) : (
    empty ?? <EmptyState />
  );

  const doExport = async () => {
    if (!exportName || !exportColumns) return;
    setExporting(true);
    try {
      // every page (500 rows each), not only the visible one
      const rows: T[] = [];
      for (let p = 1; p <= 100; p++) {
        const all = await api.get(path, { ...params, page: p, size: 500, sort: sort.field, dir: sort.dir });
        const got = select ? select(all) : { rows: (all.rows ?? []) as T[], total: Number(all.total ?? 0) };
        rows.push(...got.rows);
        if (!got.rows.length || rows.length >= got.total || got.rows.length < 500) break;
      }
      await exportExcel(exportName, exportColumns, rows);
    } catch (e) {
      n.error(e);
    } finally {
      setExporting(false);
    }
  };

  const hasBar = !!(toolbar || exportName || tools);
  const skeletonRows = useMemo(() => Array.from({ length: SKELETON_ROWS }, (_, i) => ({ [rowKey]: `__skel${i}` }) as unknown as T), [rowKey]);
  const skelCols = useMemo(() => skeletonColumns(cols), [cols]);

  const rowKeyDown = (r: T) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    const tr = e.currentTarget;
    const sibling = (dir: "next" | "prev") => {
      let el = (dir === "next" ? tr.nextElementSibling : tr.previousElementSibling) as HTMLElement | null;
      while (el && !el.classList.contains("ant-table-row")) el = (dir === "next" ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
      return el;
    };
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick?.(r);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const el = sibling(e.key === "ArrowDown" ? "next" : "prev");
      if (el) {
        e.preventDefault();
        el.focus();
      }
    }
  };

  const phone = useIsPhone();
  const stacked = useMemo(() => (phone ? stackColumns(cols, false) : null), [phone, cols]);
  const stackedSkel = useMemo(() => (phone ? stackColumns(cols, true) : null), [phone, cols]);
  const tableCols = stacked ? (firstLoad ? stackedSkel! : stacked) : firstLoad ? skelCols : cols;

  return (
    <div
      className={cx("sf-st", stacked && "is-stacked")}
      data-clickable={onRowClick ? "" : undefined}
      data-busy={q.isFetching && q.isPlaceholderData ? "" : undefined}
      aria-busy={q.isFetching || undefined}
    >
      {hasBar ? (
        <FilterBar
          toolbar={toolbar}
          onClear={onClearFilters}
          tools={
            <>
              {tools}
              <Tooltip title="بازخوانی">
                <Button type="text" icon={<RotateCw {...ICON} className={q.isFetching && !firstLoad ? "sf-spin" : undefined} />} onClick={() => q.refetch()} aria-label="بازخوانی" />
              </Tooltip>
              {exportName && exportColumns ? (
                <Tooltip title="خروجی اکسل">
                  <Button type="text" icon={<Download {...ICON} />} loading={exporting} onClick={doExport} aria-label="خروجی اکسل" />
                </Tooltip>
              ) : null}
            </>
          }
        />
      ) : null}
      <Table<T>
        className="tz-table"
        size={size}
        data-density={size === "small" ? "compact" : "comfortable"}
        rowKey={rowKey}
        columns={tableCols}
        dataSource={firstLoad ? skeletonRows : data.rows}
        scroll={stacked ? undefined : { x: scrollX ?? "max-content" }}
        showHeader={!stacked}
        tableLayout={stacked ? "fixed" : undefined}
        sticky={sticky && !stacked ? { offsetHeader: TOPBAR_OFFSET } : undefined}
        rowSelection={firstLoad ? undefined : rowSelection}
        rowClassName={(r: T) => (firstLoad ? "sf-skel-row" : cx(rowClassName?.(r), activeKey != null && keyOf(r) === activeKey && "ant-table-row-selected"))}
        locale={{ emptyText: emptyNode }}
        onRow={
          onRowClick && !firstLoad
            ? (r) => ({ onClick: () => onRowClick(r), onKeyDown: rowKeyDown(r), tabIndex: 0 }) as React.HTMLAttributes<HTMLElement>
            : undefined
        }
        summary={firstLoad ? undefined : summary}
        onChange={(p: TablePaginationConfig, _f, s) => {
          setPage(p.current ?? 1);
          setSize(p.pageSize ?? pageSize);
          const so = Array.isArray(s) ? s[0] : s;
          setSort(so?.order ? { field: String(so.field ?? so.columnKey), dir: so.order === "descend" ? "desc" : "asc" } : {});
        }}
        pagination={
          firstLoad
            ? false
            : {
                current: page,
                pageSize: size_,
                total: data.total,
                showSizeChanger: !phone,
                pageSizeOptions: [20, 50, 100, 200],
                showTotal: (t) => `${faDigits(t)} ردیف`,
                size: "small",
                simple: phone,
                hideOnSinglePage: data.total <= 20,
              }
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- client table

export type DataTableProps<T> = TableProps<T> & {
  /** stack rows on a phone instead of scrolling sideways (default true) */
  stack?: boolean;
};

/**
 * A client-side table with the kit's defaults (components.md §4): compact 32 px rows, numeric columns (`sf-num` or
 * the old `align: "left"`) start-aligned, tabular and never ellipsized, `scroll.x` to fit, and on a phone the
 * stacked rows of `ServerTable` (the amount on its own line) instead of a sideways scroll.
 */
export function DataTable<T extends object>({ columns, stack = true, size = "small", scroll, className, showHeader, sticky, ...rest }: DataTableProps<T>) {
  const phone = useIsPhone();
  const cols = useMemo(() => normalizeColumns(columns ?? []), [columns]);
  const stacked = useMemo(() => (phone && stack ? stackColumns(cols, false) : null), [phone, stack, cols]);
  return (
    <Table<T>
      {...rest}
      className={cx("tz-table", stacked && "is-stacked", className)}
      size={size}
      data-density={size === "small" ? "compact" : "comfortable"}
      columns={stacked ?? cols}
      scroll={stacked ? undefined : (scroll ?? { x: "max-content" })}
      showHeader={stacked ? false : showHeader}
      tableLayout={stacked ? "fixed" : rest.tableLayout}
      sticky={stacked ? undefined : sticky}
    />
  );
}

// ---------------------------------------------------------------- cells by field type

/** Strings that are Latin by nature (components.md §4.6): Geist Mono, LTR, as stored. */
const LATIN_FORMATS = new Set<FieldDef["format"]>(["iban", "card", "email", "sayad", "taxGoodsId"]);

export function renderCell(f: FieldDef, v: unknown, row?: Record<string, unknown>): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="sf-zero">—</span>;
  switch (f.type) {
    case "money":
      return <Money v={v as string} />;
    case "decimal":
    case "int":
      return <Amount v={v as string} />;
    case "pct":
      return <Amount v={v as string} suffix="٪" />;
    case "weight":
      return <Weight v={v as string} />;
    case "date":
      return <JDate v={v as string} />;
    case "bool":
      // «فعال» is the normal state (plain text); the exception — inactive — is the neutral chip
      if (f.name === "is_active") return v ? <span className="sf-status">فعال</span> : <Chip tone="neutral">غیرفعال</Chip>;
      return v ? (
        <span className="inline-flex text-ink-2" aria-label="بله">
          <Check {...ICON} />
        </span>
      ) : (
        <span className="sf-zero" aria-label="خیر">
          —
        </span>
      );
    case "select":
      if (f.name === "status" || f.name === "kyc_status")
        return <StatusTag s={String(v)} map={Object.fromEntries((f.options ?? []).map((o) => [o.value, [o.label, o.value === "verified" || o.value === "in_stock" ? "success" : o.value === "rejected" ? "error" : o.value === "none" ? "success" : "default"]]))} />;
      return f.options?.find((o) => o.value === v)?.label ?? String(v);
    case "multiselect":
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(v) ? v : []).map((x) => (
            <Chip key={String(x)} tone="neutral" dot={false}>
              {f.options?.find((o) => o.value === x)?.label ?? String(x)}
            </Chip>
          ))}
        </span>
      );
    case "ref":
      return <RefLabel entity={f.ref!} id={String(v)} />;
    case "code":
    case "text":
      if (f.format && LATIN_FORMATS.has(f.format)) return <bdi className="sf-mono">{String(v)}</bdi>;
      return f.ltr ? <span className="sf-num">{faDigits(String(v))}</span> : <span>{String(v)}</span>;
    case "image":
      return <img src={String(v)} alt="" className="block h-7 w-7 rounded-md object-cover shadow-[inset_0_0_0_1px_var(--sf-line-2)]" />;
    default:
      return String(v);
  }
  void row;
}

export function RefLabel({ entity, id }: { entity: string; id: string }) {
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ["option", entity, id],
    queryFn: () => api.get<{ options: { id: string; label: string; sub?: string }[] }>(`/data/${entity}/options`, { ids: id }).then((r) => r.options[0] ?? null),
    staleTime: 300_000,
  });
  if (!q.data) return q.isLoading ? <i className="sf-skel inline-block align-middle" style={{ inlineSize: 72 }} /> : <span className="sf-zero">—</span>;
  return <span>{q.data.label}</span>;
}

// ---------------------------------------------------------------- inputs by field type

export function FieldInput({ f, ...props }: { f: FieldDef; value?: any; onChange?: (v: any) => void; disabled?: boolean }) {
  switch (f.type) {
    case "textarea":
      return <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} {...props} />;
    case "int":
      return <NumberInput decimals={0} {...props} />;
    case "decimal":
      return <NumberInput decimals={8} {...props} />;
    case "money":
      return <MoneyInput {...props} />;
    case "pct":
      return <PctInput {...props} />;
    case "weight":
      return <WeightInput {...props} />;
    case "bool":
      return <Switch checked={!!props.value} onChange={props.onChange} disabled={props.disabled} />;
    case "date":
      return <DateInput allowClear {...props} />;
    case "select":
      return <Select allowClear={!f.required} options={f.options} placeholder="انتخاب…" {...props} />;
    case "multiselect":
      return <Select mode={f.options && f.options.length ? "multiple" : "tags"} options={f.options} placeholder="انتخاب…" {...props} />;
    case "ref":
      return f.ref === "account" ? <AccountSelect allowClear {...props} /> : <RefSelect entity={f.ref!} filters={f.refFilter} allowClear {...props} />;
    case "json":
      return (
        <Input.TextArea
          className="sf-code"
          autoSize={{ minRows: 2, maxRows: 8 }}
          value={typeof props.value === "string" ? props.value : props.value ? JSON.stringify(props.value) : ""}
          onChange={(e) => props.onChange?.(e.target.value)}
          disabled={props.disabled}
        />
      );
    case "image":
      return <ImageInput value={props.value} onChange={props.onChange} />;
    default: {
      const latin = !!f.format && LATIN_FORMATS.has(f.format);
      const digits = f.format === "mobile" || f.format === "nationalId" || f.format === "postal" || f.format === "economic";
      return (
        <Input
          dir={f.ltr ? "ltr" : undefined}
          className={latin ? "sf-code" : f.ltr ? "sf-numin" : ""}
          inputMode={f.format === "mobile" ? "tel" : f.format === "email" ? "email" : digits ? "numeric" : undefined}
          placeholder={f.type === "code" ? "خودکار" : undefined}
          maxLength={f.maxLength}
          autoComplete="off"
          {...props}
        />
      );
    }
  }
}

/** Picks an image, shrinks it in the browser and returns a data URL (≈ ≤ 300 KB). */
export function ImageInput({ value, onChange }: { value?: string | null; onChange?: (v: string | null) => void }) {
  const n = useNotify();
  return (
    <div className="sf-img">
      {value ? (
        <img src={value} alt="" className="sf-img-thumb" />
      ) : (
        <span className="sf-img-thumb sf-img-empty" aria-hidden>
          <ImagePlus size={22} strokeWidth={1.4} absoluteStrokeWidth />
        </span>
      )}
      <div className="flex flex-col items-start gap-1">
        <Upload
          accept="image/*"
          showUploadList={false}
          beforeUpload={async (file) => {
            try {
              onChange?.(await shrinkImage(file, 640));
            } catch {
              n.warn("خواندن تصویر ممکن نشد");
            }
            return false;
          }}
        >
          <Button icon={<UploadIcon {...ICON} />}>{value ? "تغییر تصویر" : "انتخاب تصویر"}</Button>
        </Upload>
        {value ? (
          <Button type="text" size="small" danger onClick={() => onChange?.(null)}>
            حذف تصویر
          </Button>
        ) : (
          <span className="sf-note">JPG یا PNG؛ خودکار کوچک می‌شود.</span>
        )}
      </div>
    </div>
  );
}

export async function shrinkImage(file: File, max = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- generated form

/** Short values that may sit two to a row in a sheet (components.md §5: «وزن + عیار»، «نرخ + اجرت»). */
const SHORT_TYPES = new Set<FieldDef["type"]>(["money", "decimal", "int", "pct", "weight", "date", "code"]);

/**
 * Spans for a sheet: one column, except two neighbouring short fields (figures, dates, codes), which pair up.
 * Wide pages keep the definition's 24-column spans.
 */
function sheetSpans(fs: FieldDef[]): number[] {
  const out = fs.map(() => 24);
  for (let i = 0; i + 1 < fs.length; i++) {
    const a = fs[i];
    const b = fs[i + 1];
    if (SHORT_TYPES.has(a.type) && SHORT_TYPES.has(b.type) && (a.span ?? 12) <= 12 && (b.span ?? 12) <= 12) {
      out[i] = 12;
      out[i + 1] = 12;
      i++;
    }
  }
  return out;
}

const isEmptyValue = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

/** «Ctrl ↵» inside a button: an LTR isolate in a 4 px RTL wrapper (components.md §6). */
function KbdHint({ keys }: { keys: string[] }) {
  return (
    <span className="sf-kbd-w" aria-hidden>
      <bdi dir="ltr" className="sh-keys">
        {keys.map((k) => (
          <kbd key={k} className="sh-kbd">
            {k}
          </kbd>
        ))}
      </bdi>
    </span>
  );
}

export function EntityForm({ def, initial, onSaved, onCancel, extra }: { def: EntityDef; initial?: Record<string, any> | null; onSaved?: (row: any) => void; onCancel?: () => void; extra?: ReactNode }) {
  const { api, org } = useOrg();
  const [form] = Form.useForm();
  const box = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState(true);
  const fields = fieldsFor(def, org.modules).filter((f) => !f.hidden);
  const editing = !!initial?.id;
  const sections = useMemo(() => {
    const m = new Map<string, FieldDef[]>();
    for (const f of fields) {
      const s = f.section ?? "";
      m.set(s, [...(m.get(s) ?? []), f]);
    }
    return [...m.entries()];
  }, [fields]);
  const initialValues = useMemo(() => {
    const v: Record<string, any> = {};
    for (const f of fields) v[f.name] = initial?.[f.name] ?? (editing ? null : f.default ?? null);
    return v;
  }, [initial, editing, fields]);
  // long groups of optional fields (هویت، احراز هویت، تماس…) start closed: a section after the first with no required
  // field, opened when it already holds something the user entered
  const optionalSection = (title: string, fs: FieldDef[], i: number) => i > 0 && !!title && fs.length > 1 && !fs.some((f) => f.required);
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        sections
          .filter(([title, fs], i) => !optionalSection(title, fs, i) || (editing && fs.some((f) => !isEmptyValue(initial?.[f.name]) && initial?.[f.name] !== f.default)))
          .map(([title]) => title),
      ),
  );
  const toggle = (title: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(title)) n.delete(title);
      else n.add(title);
      return n;
    });
  const save = useAction(
    (values: Record<string, any>) => (editing ? api.patch(`/data/${def.key}/${initial!.id}`, values) : api.post(`/data/${def.key}`, values)),
    { success: editing ? "ذخیره شد" : `${def.title} ثبت شد`, invalidate: [["table"], ["options", def.key], ["option", def.key]], onSuccess: (d: any) => onSaved?.(d.row) },
  );

  // a form inside a sheet is one column; focus lands at once on the first empty required text field (never a select
  // that already has its default), so keystrokes typed while the sheet slides in are never lost (components.md §1.5)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setSheet(!!el.closest(".ant-drawer") || el.clientWidth <= 600);
    const items = [...el.querySelectorAll<HTMLElement>(".ant-form-item")].filter((it) => !it.closest("[hidden]"));
    const textOf = (it: HTMLElement) => (it.querySelector(".ant-select") ? null : it.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([disabled]):not([readonly]):not([type=checkbox]):not([type=file]), textarea:not([disabled])"));
    const required = items.filter((it) => it.querySelector(".ant-form-item-required"));
    const target =
      required.map(textOf).find((i) => i && !i.value) ??
      required.map(textOf).find(Boolean) ??
      items.map(textOf).find(Boolean) ??
      el.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])");
    target?.focus({ preventScroll: true });
  }, []);

  const sectionOf = (name: string) => sections.find(([, fs]) => fs.some((f) => f.name === name))?.[0];

  return (
    <div
      ref={box}
      className="sf-form"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          form.submit();
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={(v) => save.mutate(v)}
        onFinishFailed={({ errorFields }) => {
          // a mistake inside a closed section opens it, so the error is seen
          const titles = errorFields.map((f) => sectionOf(String(f.name[0]))).filter((t): t is string => t !== undefined);
          if (titles.some((t) => !open.has(t))) setOpen((o) => new Set([...o, ...titles]));
        }}
        // «(اختیاری)» only where it informs: never on a switch, nor inside a closed-by-default optional group
        requiredMark={(label, { required }) =>
          required || (isValidElement(label) && (label.props as Record<string, unknown>)["data-nomark"] !== undefined) ? (
            label
          ) : (
            <>
              {label}
              <span className="ant-form-item-optional">(اختیاری)</span>
            </>
          )
        }
        scrollToFirstError
      >
        {sections.map(([title, fs], si) => {
          const collapsible = optionalSection(title, fs, si);
          const shown = !collapsible || open.has(title);
          const spans = sheet ? sheetSpans(fs) : fs.map((f) => Math.min(f.span ?? 12, 24));
          return (
            <section key={title || "main"} className={cx("sf-form-sec", collapsible && "is-collapsible", shown && "is-open")}>
              {collapsible ? (
                <button type="button" className="sf-form-sec-t sf-form-sec-btn" aria-expanded={shown} onClick={() => toggle(title)}>
                  <ChevronDown size={14} strokeWidth={1.4} absoluteStrokeWidth className="sf-form-sec-chev" aria-hidden />
                  <span>{title}</span>
                  <span className="sf-form-sec-meta">اختیاری</span>
                </button>
              ) : title ? (
                <h3 className="sf-form-sec-t">{title}</h3>
              ) : null}
              <div className="sf-form-grid" hidden={!shown}>
                {fs.map((f, i) => (
                  <div key={f.name} style={{ ["--span" as string]: spans[i] }}>
                    <Form.Item
                      name={f.name}
                      label={f.type === "bool" || collapsible ? <span data-nomark="">{f.label}</span> : f.label}
                      extra={f.help}
                      valuePropName={f.type === "bool" ? "checked" : "value"}
                      rules={[
                        ...(f.required && f.type !== "code" ? [{ required: true, message: `«${f.label}» را وارد کنید.` }] : []),
                        ...(f.format
                          ? [{ validator: (_: unknown, v: string) => { const p = v ? checkFormat(f.format!, v) : null; return p ? Promise.reject(new Error(p)) : Promise.resolve(); } }]
                          : []),
                      ]}
                      validateTrigger={f.format ? "onBlur" : undefined}
                    >
                      {f.type === "bool" ? <Switch disabled={f.readonly} /> : <FieldInput f={f} disabled={f.readonly} />}
                    </Form.Item>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {extra}
        <div className="sf-form-foot">
          <Button onClick={onCancel}>انصراف</Button>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {save.isPending ? "در حال ثبت…" : editing ? "ذخیره‌ی تغییرات" : "ثبت"}
            <KbdHint keys={["Ctrl", "↵"]} />
          </Button>
        </div>
      </Form>
    </div>
  );
}

// ---------------------------------------------------------------- complete entity page

export interface EntityPageProps {
  entity: string;
  title?: string;
  extraColumns?: ColumnsType<any>;
  rowActions?: (row: any) => { key: string; label: ReactNode; onClick: () => void; danger?: boolean }[];
  headerActions?: ReactNode;
  defaultFilters?: Record<string, string>;
  onOpen?: (row: any) => void;
  drawerWidth?: number;
  hideNew?: boolean;
}

const NUMERIC_TYPES = ["money", "decimal", "int", "weight", "pct"];

export function EntityPage({ entity, title, extraColumns = [], rowActions, headerActions, defaultFilters, onOpen, drawerWidth = 560, hideNew }: EntityPageProps) {
  const def = ENTITIES[entity];
  const [importing, setImporting] = useState(false);
  const { org, can, api } = useOrg();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(defaultFilters ?? {});
  const [editing, setEditing] = useState<Record<string, any> | null | undefined>(undefined);
  const [total, setTotal] = useState<number | null>(null);
  const dq = useDebounced(q);
  const fields = fieldsFor(def, org.modules);
  const canEdit = can(def.area, "edit");
  const canDelete = can(def.area, "full");
  const n = useNotify();
  const del = useAction((id: string) => api.del(`/data/${entity}/${id}`), { success: "حذف شد", invalidate: [["table"], ["options", entity]] });
  const sheetOpen = editing !== undefined;
  // one-record forms are one column (components.md §5): a sheet is 480–560 px, never a wide multi-column panel
  const sheetWidth = Math.min(drawerWidth, 560);

  // toasts move beside an open sheet (siraf-antd.css reads --sf-sheet-w): tell it how wide this one is
  useEffect(() => {
    if (!sheetOpen) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("--sf-sheet-w");
    root.style.setProperty("--sf-sheet-w", `${sheetWidth}px`);
    return () => {
      if (prev) root.style.setProperty("--sf-sheet-w", prev);
      else root.style.removeProperty("--sf-sheet-w");
    };
  }, [sheetOpen, sheetWidth]);

  const columns: ColumnsType<any> = [
    ...fields
      .filter((f) => f.list)
      .map((f) => {
        const numeric = NUMERIC_TYPES.includes(f.type);
        return {
          key: f.name,
          dataIndex: f.name,
          title: f.label,
          sorter: ["text", "code", "date", "money", "decimal", "int", "weight"].includes(f.type),
          className: numeric || f.type === "date" || f.type === "code" ? "sf-num" : undefined,
          width: f.type === "money" || f.type === "weight" ? 136 : undefined,
          render: (v: unknown, row: Record<string, unknown>) => renderCell(f, v, row),
        };
      }),
    ...extraColumns,
    {
      key: "_actions",
      width: 52,
      fixed: "end" as const,
      render: (_: unknown, row: any) => {
        const head = [
          ...(canEdit ? [{ key: "edit", icon: <Pencil {...ICON} />, label: "ویرایش", onClick: () => setEditing(row) }] : []),
          ...(rowActions?.(row) ?? []),
        ];
        const items = [
          ...head,
          ...(canDelete
            ? [
                ...(head.length ? [{ type: "divider" as const }] : []),
                {
                  key: "del",
                  icon: <Trash2 {...ICON} />,
                  danger: true,
                  label: "حذف",
                  onClick: async () => {
                    if (await n.confirm(`حذف «${row[def.display] ?? ""}»؟`, "اگر در اسناد استفاده شده باشد حذف نمی‌شود؛ می‌توانید آن را غیرفعال کنید.", true)) del.mutate(row.id);
                  },
                },
              ]
            : []),
        ];
        if (!items.length) return null;
        return (
          <span className="sf-row-act" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Dropdown trigger={["click"]} menu={{ items }} placement="bottomLeft" rootClassName="sf-glass">
              <Button type="text" size="small" icon={<Ellipsis {...ICON} />} aria-label="عملیات" />
            </Dropdown>
          </span>
        );
      },
    },
  ];

  const filterFields = fields.filter((f) => f.filter && (f.type === "select" || f.type === "multiselect" || f.type === "bool"));
  const params: Record<string, string> = { q: dq };
  for (const [k, v] of Object.entries(filters)) if (v) params[`f.${k}`] = v;
  const applied = Object.entries(filters).some(([k, v]) => v && v !== (defaultFilters ?? {})[k]);
  const clear = () => {
    setQ("");
    setFilters(defaultFilters ?? {});
  };

  return (
    <div>
      <PageHeader
        title={title ?? def.plural}
        subtitle={total ? `${faDigits(total)} ردیف` : undefined}
        actions={
          <>
            {headerActions}
            {canEdit && !hideNew ? (
              <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setEditing(null)}>
                {def.title} جدید
              </Button>
            ) : null}
          </>
        }
      />
      <div className="sf-card">
        <ServerTable
          path={`/data/${entity}`}
          params={params}
          columns={columns}
          activeKey={editing?.id ?? null}
          onData={(_, t) => setTotal(t)}
          filtered={!!dq.trim() || applied}
          onClearFilters={clear}
          empty={
            <EmptyState
              icon={ListPlus}
              title={`فهرست ${def.plural} خالی است`}
              description={canEdit && !hideNew ? `اولین ${def.title} را ثبت کنید یا فهرست را از اکسل وارد کنید.` : undefined}
              action={
                canEdit && !hideNew ? (
                  // the header already holds the page's one primary: the empty state repeats it quietly
                  <Button icon={<Plus {...ICON} />} onClick={() => setEditing(null)}>
                    {def.title} جدید
                  </Button>
                ) : undefined
              }
              secondary={
                canEdit && !hideNew ? (
                  <button type="button" className="sf-link border-0 bg-transparent p-0 text-[13px]" onClick={() => setImporting(true)}>
                    ورود از اکسل
                  </button>
                ) : undefined
              }
            />
          }
          onRowClick={onOpen || canEdit ? (r) => (onOpen ? onOpen(r) : setEditing(r)) : undefined}
          rowClassName={(r: any) => (r.is_active === false ? "row-muted" : "")}
          tools={
            canEdit && !hideNew ? (
              <Tooltip title="ورود از اکسل">
                <Button type="text" icon={<UploadIcon {...ICON} />} onClick={() => setImporting(true)} aria-label="ورود از اکسل" />
              </Tooltip>
            ) : null
          }
          exportName={def.plural}
          exportColumns={fields.filter((f) => f.list).map((f) => ({ title: f.label, value: (r: any) => (Array.isArray(r[f.name]) ? r[f.name].join("، ") : r[f.name]), type: NUMERIC_TYPES.includes(f.type) ? "number" : "text" }))}
          toolbar={
            <>
              <Input
                allowClear
                prefix={<Search {...ICON} className="text-ink-3" aria-hidden />}
                placeholder="جستجو…"
                aria-label={`جستجو در ${def.plural}`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="!w-64 max-sm:!w-full"
              />
              {filterFields.map((f) => (
                <FilterChip
                  key={f.name}
                  label={f.label}
                  value={filters[f.name] || null}
                  onChange={(v) => setFilters({ ...filters, [f.name]: v ?? "" })}
                  options={f.type === "bool" ? [{ value: "true", label: `${f.label}: بله` }, { value: "false", label: `${f.label}: خیر` }] : (f.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))}
                />
              ))}
              {applied ? (
                <button type="button" className="sf-link sf-fclear" onClick={clear}>
                  پاک کردن
                </button>
              ) : null}
            </>
          }
        />
      </div>
      <Drawer
        open={sheetOpen}
        onClose={() => setEditing(undefined)}
        size={sheetWidth}
        placement="left"
        closable={{ placement: "end" }}
        title={editing?.id ? `ویرایش ${def.title}` : `${def.title} جدید`}
        destroyOnHidden
        styles={{ body: { paddingBottom: 0 } }}
      >
        {sheetOpen ? <EntityForm key={editing?.id ?? "new"} def={def} initial={editing} onSaved={() => setEditing(undefined)} onCancel={() => setEditing(undefined)} /> : null}
      </Drawer>
      {importing ? <ImportDrawer def={def} open={importing} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

export { Popconfirm };

// RecordList: the list page of any engine table — server-side paging, sort and search, the FilterBuilder, quick
// filters, saved views (personal/shared, default, «ذخیره به‌عنوان نمای جدید»), the column chooser, group-by with
// collapsible groups and counts, row selection with bulk actions, inline edit of simple fields, Excel export
// (Jalali dates) and import, density, keyboard (j/k, Enter, x, /, Esc), live refresh through «زنده» without losing
// scroll or selection, cards on a phone, skeletons on the first load and empty states with one helpful action.
// The same page switches to the board, calendar and timeline views of the table.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dropdown, Input, Segmented, Select, Table, Tooltip, type InputRef } from "antd";
import type { ColumnsType, ColumnType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import {
  Plus, Search, ListFilter, RotateCw, Download, Upload, Ellipsis, List, Kanban, CalendarDays, GanttChart, Rows3, Rows2, SearchX, CircleAlert, Pencil, ChevronDown, ChevronLeft, Inbox, X,
} from "lucide-react";
import type { Cond } from "@shared/model/conditions";
import { pathLabel, resolvePath } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { faDigits, formatNumber } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useIsPhone, useLocalState, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { EmptyState } from "../../components/display";
import { ToggleChip } from "../../components/inputs";
import { cx } from "../../components/blocks";
import { useAggregate, useMe, useRecordActions, useRecordList, useTableDef, useViewActions, useViews, patchListRows, snapshotLists } from "../data/hooks";
import { extensionsFor, extensionsVersion, newRecordPath, recordPath, type ListPreset } from "../extensions";
import { andAll, countConditions, describeFilter, fromCond, quickCond, quickFilters } from "../model/filter";
import { fieldOf, isGroupable, isInlineEditable, isSortable, optionLabel, parseSort, recordLabel, displayText, type Schema } from "../model/schema";
import { boardField } from "../model/kanban";
import { defaultView, emptyListState, stateOfView, viewBody, viewColumns, viewDirty, type ListMode } from "../model/views";
import { isConflict, type RecordRow, type TableMeta, type ViewRow } from "../model/types";
import { FieldValue, RecordNo, Empty } from "../fields/display";
import { FieldInput } from "../fields/FieldInput";
import { FilterBuilder } from "../filter/FilterBuilder";
import { listQuery, useColumns, useListState, baseState } from "./state";
import { ColumnChooser, ViewsMenu } from "./toolbar";
import { BulkBar } from "./bulk";
import { exportList, ImportRecords } from "./transfer";
import { KanbanBoard } from "../board/KanbanBoard";
import { CalendarView } from "../board/CalendarView";
import { TimelineView } from "../board/TimelineView";
import "../records.css";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const SKELETON_ROWS = 8;

export interface RecordListProps {
  table: string;
  /** a module's preset on top of what the table registered */
  preset?: ListPreset;
  /** the page title (default: the table's plural) */
  title?: ReactNode;
  /** header actions beside «… تازه» */
  actions?: ReactNode;
  /** inside another page (a related list, a dashboard): no page header, state kept locally */
  embedded?: boolean;
  /** embedded lists: the condition that ties them to their parent */
  baseFilter?: Cond | null;
  /** embedded lists: values a record created from here starts with (sent as URL parameters to the new form) */
  newDefaults?: Record<string, string>;
  /** open a record (default: its page) */
  onOpen?: (row: RecordRow) => void;
}

/** The list page of a table: loads its definition, then the list. */
export function RecordList(props: RecordListProps) {
  const { def, schema, isLoading, error, missing } = useTableDef(props.table);
  if (missing) return <MissingTable table={props.table} embedded={props.embedded} />;
  if (error && !def)
    return <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={errorText(error)} />;
  if (!def || !schema || isLoading) return <ListSkeleton embedded={props.embedded} />;
  return <ListBody key={def.key} def={def} schema={schema} {...props} />;
}

function MissingTable({ table, embedded }: { table: string; embedded?: boolean }) {
  return (
    <>
      {embedded ? null : <PageHeader title="فهرست پیدا نشد" />}
      <EmptyState icon={SearchX} title="این فهرست در دسترس نیست" description={`جدول «${table}» وجود ندارد یا به آن دسترسی ندارید.`} />
    </>
  );
}

function ListSkeleton({ embedded }: { embedded?: boolean }) {
  return (
    <div className="rk-list" aria-busy="true" aria-label="در حال بارگذاری">
      {embedded ? null : <div className="rk-skel-h"><i className="ds-skel" style={{ inlineSize: 180 }} /></div>}
      <div className="rk-tb"><i className="ds-skel" style={{ inlineSize: "40%" }} /></div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rk-skel-row"><i className="ds-skel" style={{ inlineSize: `${[82, 64, 76, 58, 88, 70][i]}%` }} /></div>
      ))}
    </div>
  );
}

type Row = RecordRow & { __group?: { key: string; label: string; count: number | null; collapsed: boolean } };

function ListBody({ def, schema, preset: presetProp, title, actions, embedded, baseFilter, newDefaults, onOpen }: RecordListProps & { def: TableMeta; schema: Schema }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const phone = useIsPhone();
  const { userId, tz } = useMe();
  const ext = useMemo(() => extensionsFor(def.key), [def.key, extensionsVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const preset = useMemo<ListPreset>(() => ({ ...ext.list, ...presetProp, board: { ...ext.list?.board, ...presetProp?.board } }), [ext.list, presetProp]);
  const [state, set] = useListState(preset, !!embedded);
  const [params] = useSearchParams();
  const { columns, setColumns, setViewColumns, widths } = useColumns(def, schema, preset, !!embedded);
  const views = useViews(embedded ? null : def.key);
  const viewActions = useViewActions(def.key);
  const actionsApi = useRecordActions(def.key);
  const current = useMemo(() => views.data?.find((v) => v.id === state.view) ?? null, [views.data, state.view]);
  const [density, setDensity] = useLocalState<"compact" | "comfortable">("itsm.records.density", "compact");
  const [filterOpen, setFilterOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchRef = useRef<InputRef>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  const qc = useQueryClient();

  // the page opens with the person's default view; a link with only ?view= applies that view
  const applied = useRef<string | null>(null);
  const applyView = useCallback(
    (v: ViewRow | null) => {
      // "" = chosen «همه»: the default view must not come back
      applied.current = v?.id ?? "";
      if (!v) {
        set({ ...emptyListState(baseState(preset)) });
        setViewColumns(null);
        return;
      }
      const s = stateOfView(v);
      set({ ...emptyListState(baseState(preset)), ...s.state });
      setViewColumns(s.columns);
    },
    [set, setViewColumns, preset],
  );
  useEffect(() => {
    if (embedded || !views.data) return;
    const listParams = ["filter", "quick", "q", "sort", "group", "size", "mode"].some((k) => params.has(k));
    if (state.view && current && applied.current !== current.id) {
      applied.current = current.id;
      if (!listParams) applyView(current);
      else setViewColumns(viewColumns(current));
    } else if (!state.view && applied.current === null && !listParams) {
      applied.current = "";
      const dv = defaultView(views.data, userId);
      if (dv) applyView(dv);
    }
  }, [views.data, state.view, current, embedded, params, userId, applyView, setViewColumns]);

  const board = boardField(def, preset.board?.field);
  const calendar = preset.calendar ?? def.features?.calendar;
  const timeline = preset.timeline ?? (def.features?.calendar?.end ? { start: def.features.calendar.start, end: def.features.calendar.end } : undefined);
  const modes: ListMode[] = (preset.modes ?? ["list", "board", "calendar", "timeline"]).filter(
    (m) => m === "list" || (m === "board" && !!board) || (m === "calendar" && !!calendar) || (m === "timeline" && !!timeline),
  );
  const mode: ListMode = modes.includes(state.mode) ? state.mode : "list";

  const fixed = useMemo(() => andAll(preset.filter ?? null, baseFilter ?? null), [preset.filter, baseFilter]);
  const { query, filter } = useMemo(() => listQuery(def, state, columns, { fixed, presetSort: preset.sort }), [def, state, columns, fixed, preset.sort]);
  const list = useRecordList(def.key, query, { enabled: mode === "list" });
  const groupF = state.groupBy ? fieldOf(def, state.groupBy) : undefined;
  const agg = useAggregate(def.key, { filter, q: query.q, groupBy: groupF ? [groupF.name] : [] }, { enabled: mode === "list" && !!groupF });

  // selection survives live refreshes and paging; a new filter or search clears it
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selAll, setSelAll] = useState(false);
  const selKey = JSON.stringify([filter, query.q]);
  useEffect(() => {
    setSel(new Set());
    setSelAll(false);
  }, [selKey]);

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? null;
  // a list of more than 10 000 rows is counted up to there (the server's limit): «بیش از ۱۰٬۰۰۰ ردیف»
  const capped = !!list.data?.capped;
  const display = list.data?.display ?? {};
  const firstLoad = list.isLoading && !list.data;
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [state.page, selKey]);

  const open = useCallback(
    (row: RecordRow) => {
      if (onOpen) onOpen(row);
      else nav(`/${orgId}/${recordPath(def.key, row.id)}`);
    },
    [onOpen, nav, orgId, def.key],
  );

  const canEdit = def.can.create; // the table-level hint; the server decides per record
  const dirty = viewDirty(current, state, columns);
  const searching = !!state.q || !!state.filter || state.quick.length > 0;
  const conditionCount = state.filter ? countConditions(fromCond(state.filter)) : 0;

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (mode !== "list" || phone) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.closest("input, textarea, select, [contenteditable=true], .ant-select, .ant-modal, .ant-drawer, .ant-popover, .ant-dropdown") || t.isContentEditable)) return;
      const visible = rows;
      if (e.code === "Slash") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.code === "KeyJ" || e.code === "KeyK") {
        e.preventDefault();
        if (!visible.length) return;
        setActive((a) => {
          const next = e.code === "KeyJ" ? Math.min(visible.length - 1, a + 1) : Math.max(0, a - 1);
          requestAnimationFrame(() => document.querySelector(`[data-row-key="${visible[next]?.id}"]`)?.scrollIntoView({ block: "nearest" }));
          return next;
        });
      } else if (e.key === "Enter" && active >= 0 && visible[active]) {
        e.preventDefault();
        open(visible[active]);
      } else if (e.code === "KeyX" && active >= 0 && visible[active]) {
        e.preventDefault();
        const id = visible[active].id;
        setSel((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (e.key === "Escape" && (sel.size || selAll)) {
        setSel(new Set());
        setSelAll(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, phone, rows, active, open, sel.size, selAll]);

  // ---------------------------------------------------------------- inline edit
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null);
  const saveCell = async (row: RecordRow, f: FieldDef, value: unknown) => {
    setEditing(null);
    if (JSON.stringify(row[f.name] ?? null) === JSON.stringify(value ?? null)) return;
    const rollback = snapshotLists(qc, orgId, def.key);
    patchListRows(qc, orgId, def.key, row.id, { [f.name]: value });
    try {
      await actionsApi.update(row.id, { [f.name]: value }, row.version);
    } catch (e) {
      rollback();
      if (isConflict(e)) {
        n.warn("این رکورد را کس دیگری تغییر داده است؛ فهرست تازه شد", { description: "تغییر خود را دوباره روی مقدار تازه انجام دهید." });
        actionsApi.refreshLists();
      } else n.error(e);
    }
  };

  // ---------------------------------------------------------------- columns
  const sortParts = parseSort(query.sort);
  const tableCols = useMemo<ColumnsType<Row>>(() => {
    const cols: ColumnsType<Row> = [];
    columns.forEach((name, i) => {
      const r = name.includes(".") ? resolvePath(def, name, schema.lookup) : null;
      const f = r ? r.field : fieldOf(def, name);
      if (!f) return;
      const numeric = !!FIELD_TYPES[f.type].numeric;
      const sortable = !name.includes(".") && isSortable(f);
      const sp = sortParts.find((p) => p.field === name);
      const editable = canEdit && !name.includes(".") && isInlineEditable(f) && !(def.states && f.name === def.states.field);
      const col: ColumnType<Row> = {
        key: name,
        dataIndex: name,
        title: r ? pathLabel(def, name, schema.lookup) : f.label,
        className: cx(numeric && "ds-num", "rk-col"),
        width: widths[name],
        ellipsis: !numeric && f.type !== "users" && f.type !== "tags" && f.type !== "multichoice",
        sorter: sortable ? true : undefined,
        sortOrder: sp ? (sp.desc ? "descend" : "ascend") : null,
        showSorterTooltip: false,
        onCell: (row) => (row.__group ? { colSpan: i === 0 ? columns.length : 0 } : {}),
        render: (_: unknown, row: Row) => {
          if (row.__group) return i === 0 ? <GroupHeader g={row.__group} onToggle={() => toggleGroup(row.__group!.key)} /> : null;
          if (firstLoad) return <i className="ds-skel" style={{ inlineSize: numeric ? 64 : `${[72, 58, 84, 64, 90][(i + rows.length) % 5]}%` }} />;
          const v = r ? row[name] : row[f.name];
          const cell = <FieldValue field={f} value={v} table={def.key} schema={schema} display={display} compact me={userId} tz={tz} />;
          const first = name === "number" || (!fieldOf(def, "number") && name === def.display);
          const content = first ? (
            <Link className="rk-open" to={`/${orgId}/${recordPath(def.key, row.id)}`} onClick={(e) => e.stopPropagation()}>
              {name === "number" ? <RecordNo no={String(row.number ?? "")} /> : cell}
            </Link>
          ) : (
            cell
          );
          if (!editable) return content;
          if (editing?.id === row.id && editing.field === f.name)
            return <InlineEditor row={row} f={f} def={def} schema={schema} tz={tz} display={display} onSave={(v2) => saveCell(row, f, v2)} onCancel={() => setEditing(null)} />;
          return (
            <span className="rk-cell-edit">
              {content}
              <button
                type="button"
                className="rk-pen"
                aria-label={`ویرایش ${f.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing({ id: row.id, field: f.name });
                }}
              >
                <Pencil {...I14} aria-hidden />
              </button>
            </span>
          );
        },
      };
      cols.push(col);
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, def, schema, display, editing, firstLoad, widths, query.sort, userId, tz, orgId, canEdit]);

  // ---------------------------------------------------------------- groups
  const groupInfo = useMemo(() => {
    const m = new Map<string, { label: string; count: number | null }>();
    for (const r of agg.data?.rows ?? []) {
      const k = r.keys[0] === null || r.keys[0] === undefined ? "" : String(r.keys[0]);
      m.set(k, { label: r.labels[0] ?? k, count: Number(r.values.count ?? 0) });
    }
    return m;
  }, [agg.data]);
  const toggleGroup = (k: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const dataSource: Row[] = useMemo(() => {
    if (firstLoad) return Array.from({ length: SKELETON_ROWS }, (_, i) => ({ id: `__skel${i}`, version: 0 }));
    if (!groupF) return rows;
    const out: Row[] = [];
    let last: string | null = null;
    for (const r of rows) {
      const raw = r[groupF.name];
      const k = raw === null || raw === undefined || raw === "" ? "" : String(raw);
      if (k !== last) {
        last = k;
        const info = groupInfo.get(k);
        const label = k === "" ? "(خالی)" : groupF.type === "bool" ? (raw === true ? "بله" : "خیر") : FIELD_TYPES[groupF.type].family === "ref" ? (display[k] ?? info?.label ?? "(محدود)") : groupF.type === "choice" ? optionLabel(groupF, schema.choices, k) : (info?.label ?? k);
        out.push({ id: `__g:${k}`, version: 0, __group: { key: k, label, count: info?.count ?? null, collapsed: collapsed.has(k) } });
      }
      if (!collapsed.has(k)) out.push(r);
    }
    return out;
  }, [rows, groupF, groupInfo, collapsed, firstLoad, display, schema.choices]);

  // ---------------------------------------------------------------- actions
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await exportList(api, def, { filter, q: query.q, sort: query.sort, columns, tz });
      if (r.truncated) n.warn(`فقط ${faDigits(r.rows)} ردیف نخست در فایل آمد`, { description: "برای ردیف‌های بیشتر، فهرست را با پالایه کوچک‌تر کنید." });
      else n.ok(`${faDigits(r.rows)} ردیف در فایل اکسل ذخیره شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setExporting(false);
    }
  };
  const newPath = () => {
    const q = new URLSearchParams(newDefaults ?? {});
    return `/${orgId}/${newRecordPath(def.key)}${q.toString() ? `?${q}` : ""}`;
  };
  const saveView = async () => {
    if (!current) return;
    try {
      const body = viewBody(state, columns, quickCond(def, state.quick));
      await viewActions.update(current, body);
      // the quick filters now live in the view's filter
      set({ quick: [], filter: (body.filter as Cond | null) ?? null });
      n.ok(`نمای «${current.name}» ذخیره شد`);
    } catch (e) {
      n.error(e);
    }
  };
  const saveViewAs = async (o: { name: string; shared: boolean; is_default: boolean }) => {
    const v = await viewActions.create({ name: o.name, shared: o.shared, is_default: o.is_default, ...viewBody(state, columns, quickCond(def, state.quick)) });
    applied.current = v.id;
    set({ view: v.id, quick: [], filter: v.filter ?? null });
    n.ok(`نمای «${o.name}» ساخته شد`);
  };

  const qfs = quickFilters(def);
  const pageIds = rows.map((r) => r.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const selectedIds = [...sel];
  const moreMenu = [
    { key: "export", icon: <Download {...I16} />, label: exporting ? "در حال ساخت فایل…" : "خروجی اکسل", disabled: exporting },
    ...(def.can.create && !embedded ? [{ key: "import", icon: <Upload {...I16} />, label: "ورود از اکسل" }] : []),
  ];

  const header = embedded ? null : (
    <PageHeader
      title={title ?? def.plural}
      actions={
        <>
          {actions}
          <Dropdown trigger={["click"]} rootClassName="ds-glass" menu={{ items: moreMenu, onClick: ({ key }) => (key === "export" ? doExport() : setImporting(true)) }}>
            <Button icon={<Ellipsis {...I16} />} aria-label="کارهای دیگر" />
          </Dropdown>
          {def.can.create ? (
            <Button type="primary" icon={<Plus {...I16} />} onClick={() => nav(newPath())}>
              {def.label} تازه
            </Button>
          ) : null}
        </>
      }
    />
  );

  const emptyNode = list.isError ? (
    <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={errorText(list.error)} action={<Button icon={<RotateCw {...I16} />} onClick={() => list.refetch()}>تلاش دوباره</Button>} />
  ) : searching ? (
    <EmptyState icon={SearchX} title="چیزی پیدا نشد" description="عبارت جست‌وجو یا پالایه‌ها را تغییر دهید." action={<Button onClick={() => set({ q: "", filter: null, quick: [] })}>پاک کردن پالایه‌ها</Button>} />
  ) : (
    <EmptyState
      icon={Inbox}
      title={preset.emptyText ?? `هنوز ${def.plural} ثبت نشده است`}
      action={def.can.create ? <Button type="primary" icon={<Plus {...I16} />} onClick={() => nav(newPath())}>{def.label} تازه</Button> : undefined}
    />
  );

  return (
    <div className={cx("rk-list", embedded && "is-embedded")}>
      {header}
      <div className="rk-tb" role="toolbar" aria-label="ابزار فهرست">
        <div className="rk-tb-s">
          {!embedded ? (
            <ViewsMenu
              def={def}
              views={views.data ?? []}
              current={current}
              dirty={dirty}
              me={userId}
              onSelect={(v) => applyView(v)}
              onSave={saveView}
              onSaveAs={saveViewAs}
            />
          ) : null}
          <Input
            ref={searchRef}
            className="rk-search"
            allowClear
            prefix={<Search {...I16} className="text-ink-3" aria-hidden />}
            placeholder={phone ? "جست‌وجو" : "جست‌وجو یا شماره…  /"}
            aria-label="جست‌وجو"
            defaultValue={state.q}
            key={`q:${state.view ?? ""}`}
            onChange={(e) => {
              const v = e.target.value;
              window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => set({ q: v }), 300);
            }}
            onPressEnter={(e) => set({ q: (e.target as HTMLInputElement).value })}
          />
          <Button className={cx("rk-fbtn", (filterOpen || conditionCount > 0) && "is-on")} icon={<ListFilter {...I16} />} onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}>
            پالایه{conditionCount ? <Badge count={faDigits(conditionCount)} size="small" className="rk-badge" /> : null}
          </Button>
        </div>
        <div className="rk-tb-e">
          {modes.length > 1 ? (
            <Segmented
              value={mode}
              onChange={(m) => set({ mode: m as ListMode })}
              options={modes.map((m) => ({ value: m, label: <ModeIcon mode={m} />, title: MODE_LABELS[m] }))}
              aria-label="نوع نما"
            />
          ) : null}
          {mode === "list" && !phone ? (
            <>
              <Select
                className="rk-group"
                value={state.groupBy ?? ""}
                onChange={(g) => set({ groupBy: g || null })}
                options={[{ value: "", label: "بدون گروه‌بندی" }, ...def.fields.filter(isGroupable).map((f) => ({ value: f.name, label: `گروه‌بندی: ${f.label}` }))]}
                popupMatchSelectWidth={false}
                aria-label="گروه‌بندی"
              />
              <ColumnChooser def={def} columns={columns} onChange={setColumns} />
              <Tooltip title={density === "compact" ? "ردیف‌های بازتر" : "ردیف‌های فشرده"}>
                <Button type="text" className="rk-tool" icon={density === "compact" ? <Rows2 {...I16} /> : <Rows3 {...I16} />} onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")} aria-label="تراکم ردیف‌ها" />
              </Tooltip>
            </>
          ) : null}
          <Tooltip title="بازخوانی">
            <Button type="text" className="rk-tool" icon={<RotateCw {...I16} className={list.isFetching && !firstLoad ? "ds-spin" : undefined} />} onClick={() => list.refetch()} aria-label="بازخوانی" />
          </Tooltip>
          {embedded && def.can.create ? (
            <Button icon={<Plus {...I16} />} onClick={() => nav(newPath())}>
              {def.label} تازه
            </Button>
          ) : null}
        </div>
      </div>

      {qfs.length ? (
        <div className="rk-qf" role="group" aria-label="پالایه‌های سریع">
          {qfs.map((q) => (
            <ToggleChip key={q.key} on={state.quick.includes(q.key)} onChange={(on) => set({ quick: on ? [...state.quick, q.key] : state.quick.filter((k) => k !== q.key) })}>
              {q.label}
            </ToggleChip>
          ))}
        </div>
      ) : null}
      {filterOpen ? (
        <div className="rk-fpanel ds-enter">
          <FilterBuilder def={def} schema={schema} value={state.filter} onChange={(c) => set({ filter: c })} display={display} tz={tz} />
          <div className="rk-fpanel-f">
            <Button size="small" type="text" onClick={() => set({ filter: null })} disabled={!state.filter}>
              پاک کردن
            </Button>
            <Button size="small" type="text" icon={<X {...I14} />} onClick={() => setFilterOpen(false)}>
              بستن
            </Button>
          </div>
        </div>
      ) : state.filter ? (
        <p className="rk-fsum">
          <ListFilter {...I14} aria-hidden /> {describeFilter(state.filter, def, { lookup: schema.lookup, choices: schema.choices, display, tz })}
        </p>
      ) : null}
      {preset.filter ? <p className="rk-fixed">{describeFilter(preset.filter, def, { lookup: schema.lookup, choices: schema.choices, tz })}</p> : null}

      {(sel.size > 0 || selAll) && mode === "list" ? (
        <BulkBar
          def={def}
          schema={schema}
          ids={selectedIds}
          all={selAll}
          total={total}
          canSelectAll={pageAll && (total ?? 0) > pageIds.length}
          onSelectAll={() => setSelAll(true)}
          onClear={() => {
            setSel(new Set());
            setSelAll(false);
          }}
          query={query}
          filter={filter}
          extra={preset.bulkActions}
        />
      ) : null}

      {mode === "board" && board ? (
        <KanbanBoard def={def} schema={schema} field={board} filter={filter} q={query.q} wip={preset.board?.wip} cardFields={preset.board?.cardFields ?? ext.cardFields} swimlane={preset.board?.swimlane} onOpen={open} />
      ) : mode === "calendar" && calendar ? (
        <CalendarView def={def} schema={schema} start={calendar.start} end={calendar.end} filter={filter} q={query.q} onOpen={open} />
      ) : mode === "timeline" && timeline ? (
        <TimelineView def={def} schema={schema} start={timeline.start} end={timeline.end} filter={filter} q={query.q} onOpen={open} />
      ) : phone ? (
        <CardList def={def} schema={schema} rows={rows} display={display} columns={columns} loading={firstLoad} empty={!firstLoad && !rows.length ? emptyNode : null} onOpen={open} me={userId} tz={tz} />
      ) : (
        <Table<Row>
          className={cx("ds-table rk-table", density === "comfortable" && "is-comfy")}
          size={density === "compact" ? "small" : "middle"}
          rowKey="id"
          columns={tableCols}
          dataSource={dataSource}
          tableLayout="auto"
          scroll={{ x: "max-content" }}
          sticky={embedded ? undefined : { offsetHeader: 56 }}
          showSorterTooltip={false}
          locale={{ emptyText: firstLoad ? " " : emptyNode }}
          rowClassName={(r, i) =>
            cx(
              r.__group && "rk-grow",
              firstLoad && "ds-skel-row",
              !r.__group && i === activeIndex(dataSource, rows, active) && "is-active",
              !r.__group && sel.has(r.id) && "ant-table-row-selected",
              !r.__group && !firstLoad && preset.rowTone?.(r) ? `rk-tone-${preset.rowTone(r)}` : undefined,
            )
          }
          onRow={(r) =>
            r.__group || firstLoad
              ? {}
              : ({
                  onClick: (e: React.MouseEvent) => {
                    if ((e.target as HTMLElement).closest("a, button, input, .ant-select, .ant-checkbox-wrapper, .ant-switch")) return;
                    open(r);
                  },
                  "data-row-key": r.id,
                } as React.HTMLAttributes<HTMLElement>)
          }
          rowSelection={
            firstLoad
              ? undefined
              : {
                  columnWidth: 40,
                  selectedRowKeys: [...sel],
                  preserveSelectedRowKeys: true,
                  getCheckboxProps: (r: Row) => ({ disabled: !!r.__group, className: r.__group ? "rk-hide" : undefined, "aria-label": `انتخاب ${recordLabel(def, r)}` }) as never,
                  onChange: (keys) => {
                    const onPage = new Set(pageIds);
                    const next = new Set([...sel].filter((k) => !onPage.has(k)));
                    for (const k of keys) if (!String(k).startsWith("__g:")) next.add(String(k));
                    setSel(next);
                    if (selAll && next.size < sel.size) setSelAll(false);
                  },
                }
          }
          onChange={(p: TablePaginationConfig, _f, s: SorterResult<Row> | SorterResult<Row>[]) => {
            const so = Array.isArray(s) ? s[0] : s;
            const nextSort = so?.order ? `${so.order === "descend" ? "-" : ""}${String(so.columnKey ?? so.field)}` : "";
            const sortChanged = nextSort !== (state.sort || "") && (so?.order || state.sort);
            if (sortChanged) set({ sort: nextSort });
            else if ((p.current ?? 1) !== state.page || (p.pageSize ?? state.size) !== state.size) set({ page: p.current ?? 1, size: p.pageSize ?? state.size }, { replace: false });
          }}
          pagination={
            firstLoad
              ? false
              : {
                  current: state.page,
                  pageSize: state.size,
                  total: total ?? undefined,
                  showSizeChanger: true,
                  pageSizeOptions: [20, 50, 100, 200],
                  showTotal: (t) => (capped ? `بیش از ${formatNumber(t)} ردیف` : `${faDigits(t)} ردیف`),
                  size: "small",
                  hideOnSinglePage: (total ?? 0) <= 20,
                }
          }
        />
      )}
      {importing ? <ImportRecords def={def} open={importing} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

/** Index of the keyboard-active row within the grouped data source. */
function activeIndex(data: Row[], rows: RecordRow[], active: number): number {
  if (active < 0 || !rows[active]) return -1;
  return data.findIndex((r) => r.id === rows[active].id);
}

const MODE_LABELS: Record<ListMode, string> = { list: "فهرست", board: "تابلو", calendar: "تقویم", timeline: "خط زمانی" };

function ModeIcon({ mode }: { mode: ListMode }) {
  const Icon = mode === "list" ? List : mode === "board" ? Kanban : mode === "calendar" ? CalendarDays : GanttChart;
  return (
    <span className="rk-mode" aria-label={MODE_LABELS[mode]}>
      <Icon {...I16} aria-hidden />
      <span className="rk-mode-t">{MODE_LABELS[mode]}</span>
    </span>
  );
}

function GroupHeader({ g, onToggle }: { g: NonNullable<Row["__group"]>; onToggle: () => void }) {
  return (
    <button type="button" className="rk-ghead" onClick={(e) => (e.stopPropagation(), onToggle())} aria-expanded={!g.collapsed}>
      {g.collapsed ? <ChevronLeft {...I14} aria-hidden /> : <ChevronDown {...I14} aria-hidden />}
      <span className="rk-ghead-l">{g.label}</span>
      {g.count !== null ? <span className="rk-ghead-n ds-num">{faDigits(g.count)}</span> : null}
    </button>
  );
}

function InlineEditor({ row, f, def, schema, tz, display, onSave, onCancel }: { row: RecordRow; f: FieldDef; def: TableMeta; schema: Schema; tz: string; display: Record<string, string>; onSave: (v: unknown) => void; onCancel: () => void }) {
  const [v, setV] = useState<unknown>(row[f.name] ?? null);
  const immediate = ["choice", "bool", "user", "group", "ref", "color", "rating"].includes(f.type);
  return (
    <span
      className="rk-inline"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!immediate && !e.currentTarget.contains(e.relatedTarget as Node | null)) onSave(v);
      }}
    >
      <FieldInput
        field={f}
        value={v}
        onChange={(x) => {
          setV(x);
          if (immediate) onSave(x);
        }}
        def={def}
        schema={schema}
        row={row}
        display={display}
        compact
        autoFocus
        tz={tz}
        onCommit={() => onSave(v)}
        onCancel={onCancel}
      />
    </span>
  );
}

/** Phone: a record per card — number and state, the title, three quiet facts. */
function CardList({ def, schema, rows, display, columns, loading, empty, onOpen, me, tz }: { def: TableMeta; schema: Schema; rows: RecordRow[]; display: Record<string, string>; columns: string[]; loading: boolean; empty: ReactNode; onOpen: (r: RecordRow) => void; me: string | null; tz: string }) {
  if (loading)
    return (
      <div className="rk-cards" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rk-card is-skel">
            <i className="ds-skel" style={{ inlineSize: "40%" }} />
            <i className="ds-skel" style={{ inlineSize: "85%" }} />
          </div>
        ))}
      </div>
    );
  if (empty) return <>{empty}</>;
  const stateF = def.states ? fieldOf(def, def.states.field) : undefined;
  const facts = columns.filter((c) => c !== "number" && c !== def.display && c !== def.states?.field && !c.includes(".")).slice(0, 3);
  return (
    <ul className="rk-cards">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="rk-card" onClick={() => onOpen(r)}>
            <span className="rk-card-l1">
              <RecordNo no={r.number ? String(r.number) : null} />
              {stateF ? <FieldValue field={stateF} value={r[stateF.name]} table={def.key} schema={schema} compact /> : null}
            </span>
            <span className="rk-card-t">{displayText(def, r) || <Empty />}</span>
            {facts.length ? (
              <span className="rk-card-f">
                {facts.map((c) => {
                  const f = fieldOf(def, c)!;
                  return (
                    <Fragment key={c}>
                      <span className="rk-card-k">{f.label}</span>
                      <span className="rk-card-v">
                        <FieldValue field={f} value={r[c]} table={def.key} schema={schema} display={display} compact me={me} tz={tz} />
                      </span>
                    </Fragment>
                  );
                })}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

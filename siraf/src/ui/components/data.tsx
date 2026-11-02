// Generic data screens: a server-paginated table, a form built from field definitions, and the
// complete list+form page for any master-data entity in @shared/entities.
// Look (components.md §4, §5, §7, §8): compact 32 px rows, unfilled 400-weight headers, numeric columns start-aligned
// with tabular figures and never ellipsized, a sticky header, skeleton rows on the first load, the old rows at 60 %
// on refetch, row actions revealed on hover, and empty states with one helpful line and one action.
import "./kit.css";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Table, Button, Input, Select, Drawer, Form, Switch, Dropdown, Upload, Tooltip, Popconfirm } from "antd";
import type { ColumnsType, ColumnType, TablePaginationConfig, TableProps } from "antd/es/table";
import { Plus, Pencil, Trash2, Download, RotateCw, Search, Ellipsis, Upload as UploadIcon, ImagePlus, Check, SearchX, CircleAlert, ListPlus } from "lucide-react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ENTITIES, fieldsFor, type EntityDef, type FieldDef } from "@shared/entities";
import { checkFormat } from "@shared/validate";
import { faDigits } from "@shared/format";
import { useOrg } from "../lib/org";
import { useAction, useNotify, useDebounced } from "../lib/hooks";
import { errorText } from "../lib/api";
import { exportExcel } from "../lib/excel";
import { Money, JDate, Weight, Amount, StatusTag, EmptyState, Chip } from "./display";
import { NumberInput, MoneyInput, PctInput, WeightInput, DateInput, RefSelect, AccountSelect } from "./inputs";
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

  return (
    <div className="sf-st" data-clickable={onRowClick ? "" : undefined} data-busy={q.isFetching && q.isPlaceholderData ? "" : undefined} aria-busy={q.isFetching || undefined}>
      {hasBar ? (
        <div className="sf-st-bar no-print">
          <div className="sf-st-filters">{toolbar}</div>
          <div className="sf-st-tools">
            {tools}
            <Tooltip title="بازخوانی">
              <Button type="text" icon={<RotateCw {...ICON} className={q.isFetching && !firstLoad ? "sf-spin" : undefined} />} onClick={() => q.refetch()} aria-label="بازخوانی" />
            </Tooltip>
            {exportName && exportColumns ? (
              <Tooltip title="خروجی اکسل">
                <Button type="text" icon={<Download {...ICON} />} loading={exporting} onClick={doExport} aria-label="خروجی اکسل" />
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}
      <Table<T>
        className="tz-table"
        size={size}
        rowKey={rowKey}
        columns={firstLoad ? skelCols : cols}
        dataSource={firstLoad ? skeletonRows : data.rows}
        scroll={{ x: scrollX ?? "max-content" }}
        sticky={sticky ? { offsetHeader: TOPBAR_OFFSET } : undefined}
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
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100, 200],
                showTotal: (t) => `${faDigits(t)} ردیف`,
                size: "small",
                hideOnSinglePage: data.total <= 20,
              }
        }
      />
    </div>
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

/** Narrow sheets (≤ 600 px) set the fields two per row; wider forms keep the definition's 24-column spans. */
const narrowSpan = (span: number) => (span > 12 ? 24 : 12);

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
  const [narrow, setNarrow] = useState(false);
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
  const save = useAction(
    (values: Record<string, any>) => (editing ? api.patch(`/data/${def.key}/${initial!.id}`, values) : api.post(`/data/${def.key}`, values)),
    { success: editing ? "ذخیره شد" : `${def.title} ثبت شد`, invalidate: [["table"], ["options", def.key], ["option", def.key]], onSuccess: (d: any) => onSaved?.(d.row) },
  );

  // the sheet's width decides the grid; focus lands on the first empty required field (or the first field) at once,
  // so keystrokes typed while the sheet slides in are never lost (components.md §1.5)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setNarrow(el.clientWidth <= 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const items = [...el.querySelectorAll<HTMLElement>(".ant-form-item")];
    const inputOf = (it: HTMLElement) => it.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([disabled]):not([type=checkbox]):not([type=file]), textarea:not([disabled])");
    const required = items.find((it) => it.querySelector(".ant-form-item-required") && inputOf(it) && !inputOf(it)!.value);
    const target = inputOf(required ?? items[0] ?? el) ?? null;
    target?.focus({ preventScroll: true });
    return () => ro.disconnect();
  }, []);

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
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={(v) => save.mutate(v)} requiredMark="optional" scrollToFirstError>
        {sections.map(([title, fs]) => (
          <section key={title || "main"} className="sf-form-sec">
            {title ? <h3 className="sf-form-sec-t">{title}</h3> : null}
            <div className="sf-form-grid">
              {fs.map((f) => {
                const span = Math.min(f.span ?? 12, 24);
                return (
                  <div key={f.name} style={{ ["--span" as string]: narrow ? narrowSpan(span) : span }}>
                    <Form.Item
                      name={f.name}
                      label={f.label}
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
                );
              })}
            </div>
          </section>
        ))}
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

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** The rendered width of a short label in the UI font (filter chips size to their words). */
function textWidth(s: string, weight = 500, size = 14): number {
  if (measureCtx === undefined) measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!measureCtx) return s.length * 8;
  const family = getComputedStyle(document.body).fontFamily || "Vazirmatn, sans-serif";
  measureCtx.font = `${weight} ${size}px ${family}`;
  return measureCtx.measureText(s).width;
}

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

  // toasts move beside an open sheet (siraf-antd.css reads --sf-sheet-w): tell it how wide this one is
  useEffect(() => {
    if (!sheetOpen) return;
    const root = document.documentElement;
    const prev = root.style.getPropertyValue("--sf-sheet-w");
    root.style.setProperty("--sf-sheet-w", `${drawerWidth}px`);
    return () => {
      if (prev) root.style.setProperty("--sf-sheet-w", prev);
      else root.style.removeProperty("--sf-sheet-w");
    };
  }, [sheetOpen, drawerWidth]);

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
        subtitle={total !== null ? `${faDigits(total)} ردیف` : undefined}
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
                  <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setEditing(null)}>
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
              {filterFields.map((f) => {
                const on = !!filters[f.name];
                const opts = f.type === "bool" ? [{ value: "true", label: `${f.label}: بله` }, { value: "false", label: `${f.label}: خیر` }] : (f.options ?? []);
                // a chip is as wide as its words (antd's placeholder is absolutely positioned and gives no width)
                const shown = on ? String(opts.find((o) => o.value === filters[f.name])?.label ?? filters[f.name]) : f.label;
                const width = Math.max(72, Math.ceil(textWidth(shown) * 1.06) + 54);
                return (
                  <Select
                    key={f.name}
                    allowClear
                    variant={on ? "filled" : "borderless"}
                    placeholder={f.label}
                    aria-label={f.label}
                    className={cx("sf-filter", on && "is-on")}
                    style={{ width }}
                    popupMatchSelectWidth={false}
                    value={filters[f.name] || undefined}
                    onChange={(v) => setFilters({ ...filters, [f.name]: v ?? "" })}
                    options={opts}
                  />
                );
              })}
              {applied || q ? (
                <button type="button" className="sf-link border-0 bg-transparent p-0 text-[13px]" onClick={clear}>
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
        size={drawerWidth}
        placement="left"
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

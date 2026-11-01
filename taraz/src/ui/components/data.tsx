// Generic data screens: a server-paginated table, a form built from field definitions, and the
// complete list+form page for any master-data entity in @shared/entities.
import { useMemo, useState, type ReactNode } from "react";
import { Table, Button, Input, Select, Drawer, Form, Switch, Space, Dropdown, Tag, Upload, Tooltip, Popconfirm } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined, FileExcelOutlined, ReloadOutlined, SearchOutlined, MoreOutlined, UploadOutlined } from "@ant-design/icons";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ENTITIES, fieldsFor, type EntityDef, type FieldDef } from "@shared/entities";
import { checkFormat } from "@shared/validate";
import { faDigits } from "@shared/format";
import { useOrg } from "../lib/org";
import { useAction, useNotify, useDebounced } from "../lib/hooks";
import { exportExcel } from "../lib/excel";
import { Money, JDate, Weight, Amount, StatusTag, EmptyState } from "./display";
import { NumberInput, MoneyInput, PctInput, WeightInput, DateInput, RefSelect, AccountSelect } from "./inputs";
import { PageHeader } from "./layout";

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
}

export function ServerTable<T extends { id?: string }>({
  path, params, columns, rowKey = "id", onRowClick, pageSize = 50, toolbar, exportName, exportColumns, queryKey, rowClassName, summary, scrollX, select,
}: ServerTableProps<T>) {
  const { api } = useOrg();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [sort, setSort] = useState<{ field?: string; dir?: "asc" | "desc" }>({});
  const q = useQuery({
    queryKey: [...(queryKey ?? ["table", path]), params, page, size, sort],
    queryFn: () => api.get(path, { ...params, page, size, sort: sort.field, dir: sort.dir }),
    placeholderData: keepPreviousData,
  });
  const data = select ? select(q.data) : { rows: (q.data?.rows ?? []) as T[], total: q.data?.total ?? 0 };
  const n = useNotify();
  return (
    <div>
      {toolbar || exportName ? (
        <div className="no-print mb-3 flex flex-wrap items-center gap-2">
          {toolbar}
          <div className="ms-auto flex gap-1">
            <Tooltip title="بازخوانی">
              <Button icon={<ReloadOutlined />} onClick={() => q.refetch()} loading={q.isFetching} />
            </Tooltip>
            {exportName && exportColumns ? (
              <Tooltip title="خروجی اکسل">
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={async () => {
                    try {
                      const all = await api.get(path, { ...params, page: 1, size: 500, sort: sort.field, dir: sort.dir });
                      const rows = select ? select(all).rows : (all.rows as T[]);
                      await exportExcel(exportName, exportColumns, rows);
                    } catch (e) {
                      n.error(e);
                    }
                  }}
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : null}
      <Table<T>
        className="tz-table"
        size="small"
        rowKey={rowKey}
        loading={q.isLoading}
        columns={columns}
        dataSource={data.rows}
        scroll={{ x: scrollX ?? "max-content" }}
        rowClassName={rowClassName}
        locale={{ emptyText: <EmptyState /> }}
        onRow={onRowClick ? (r) => ({ onClick: () => onRowClick(r), style: { cursor: "pointer" } }) : undefined}
        summary={summary}
        onChange={(p: TablePaginationConfig, _f, s) => {
          setPage(p.current ?? 1);
          setSize(p.pageSize ?? pageSize);
          const so = Array.isArray(s) ? s[0] : s;
          setSort(so?.order ? { field: String(so.field ?? so.columnKey), dir: so.order === "descend" ? "desc" : "asc" } : {});
        }}
        pagination={{
          current: page,
          pageSize: size,
          total: data.total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `${faDigits(t)} مورد`,
          size: "small",
          hideOnSinglePage: data.total <= 20,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- cells by field type

export function renderCell(f: FieldDef, v: unknown, row?: Record<string, unknown>): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
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
      return v ? <Tag color="green" variant="filled">بله</Tag> : <Tag variant="filled">خیر</Tag>;
    case "select":
      if (f.name === "status" || f.name === "kyc_status") return <StatusTag s={String(v)} map={Object.fromEntries((f.options ?? []).map((o) => [o.value, [o.label, o.value === "verified" || o.value === "in_stock" ? "success" : o.value === "rejected" ? "error" : "default"]]))} />;
      return f.options?.find((o) => o.value === v)?.label ?? String(v);
    case "multiselect":
      return (
        <span className="flex flex-wrap gap-1">
          {(Array.isArray(v) ? v : []).map((x) => (
            <Tag key={String(x)} variant="filled" className="!m-0">
              {f.options?.find((o) => o.value === x)?.label ?? String(x)}
            </Tag>
          ))}
        </span>
      );
    case "ref":
      return <RefLabel entity={f.ref!} id={String(v)} />;
    case "code":
    case "text":
      return <span className={f.ltr ? "ltr num" : ""}>{f.ltr ? faDigits(String(v)) : String(v)}</span>;
    case "image":
      return <img src={String(v)} alt="" className="h-8 w-8 rounded object-cover" />;
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
  if (!q.data) return <span className="text-muted">…</span>;
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
      return <Select allowClear={!f.required} options={f.options} {...props} />;
    case "multiselect":
      return <Select mode={f.options && f.options.length ? "multiple" : "tags"} options={f.options} {...props} />;
    case "ref":
      return f.ref === "account" ? <AccountSelect allowClear {...props} /> : <RefSelect entity={f.ref!} filters={f.refFilter} allowClear {...props} />;
    case "json":
      return (
        <Input.TextArea
          className="ltr font-mono text-xs"
          autoSize={{ minRows: 2, maxRows: 8 }}
          value={typeof props.value === "string" ? props.value : props.value ? JSON.stringify(props.value) : ""}
          onChange={(e) => props.onChange?.(e.target.value)}
          disabled={props.disabled}
        />
      );
    case "image":
      return <ImageInput value={props.value} onChange={props.onChange} />;
    default:
      return <Input dir={f.ltr ? "ltr" : undefined} className={f.ltr ? "num" : ""} {...props} />;
  }
}

/** Picks an image, shrinks it in the browser and returns a data URL (≈ ≤ 300 KB). */
export function ImageInput({ value, onChange }: { value?: string | null; onChange?: (v: string | null) => void }) {
  const n = useNotify();
  return (
    <div className="flex items-center gap-3">
      {value ? <img src={value} alt="" className="h-20 w-20 rounded-lg border border-line object-cover" /> : null}
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
        <Button icon={<UploadOutlined />}>{value ? "تغییر تصویر" : "انتخاب تصویر"}</Button>
      </Upload>
      {value ? (
        <Button type="link" danger onClick={() => onChange?.(null)}>
          حذف
        </Button>
      ) : null}
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

export function EntityForm({ def, initial, onSaved, onCancel, extra }: { def: EntityDef; initial?: Record<string, any> | null; onSaved?: (row: any) => void; onCancel?: () => void; extra?: ReactNode }) {
  const { api, org } = useOrg();
  const [form] = Form.useForm();
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
  return (
    <Form form={form} layout="vertical" initialValues={initialValues} onFinish={(v) => save.mutate(v)} requiredMark="optional" scrollToFirstError>
      {sections.map(([title, fs]) => (
        <div key={title || "main"} className={title ? "mt-2" : ""}>
          {title ? <div className="mb-3 mt-1 border-b border-line pb-1.5 text-xs font-bold text-muted">{title}</div> : null}
          <div className="grid grid-cols-24 gap-x-3" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {fs.map((f) => (
              <div key={f.name} style={{ gridColumn: `span ${Math.min(f.span ?? 12, 24)} / span ${Math.min(f.span ?? 12, 24)}` }} className="max-sm:!col-span-full">
                <Form.Item
                  name={f.name}
                  label={f.label}
                  tooltip={f.help}
                  valuePropName={f.type === "bool" ? "checked" : "value"}
                  rules={[
                    ...(f.required && f.type !== "code" ? [{ required: true, message: `«${f.label}» را وارد کنید` }] : []),
                    ...(f.format
                      ? [{ validator: (_: unknown, v: string) => { const p = v ? checkFormat(f.format!, v) : null; return p ? Promise.reject(new Error(p)) : Promise.resolve(); } }]
                      : []),
                  ]}
                >
                  {f.type === "bool" ? <Switch disabled={f.readonly} /> : <FieldInput f={f} disabled={f.readonly} />}
                </Form.Item>
              </div>
            ))}
          </div>
        </div>
      ))}
      {extra}
      <div className="sticky bottom-0 -mx-6 mt-2 flex gap-2 border-t border-line bg-surface px-6 py-3">
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          {editing ? "ذخیره‌ی تغییرات" : "ثبت"}
        </Button>
        <Button onClick={onCancel}>انصراف</Button>
      </div>
    </Form>
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

export function EntityPage({ entity, title, extraColumns = [], rowActions, headerActions, defaultFilters, onOpen, drawerWidth = 720, hideNew }: EntityPageProps) {
  const def = ENTITIES[entity];
  const { org, can, api } = useOrg();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(defaultFilters ?? {});
  const [editing, setEditing] = useState<Record<string, any> | null | undefined>(undefined);
  const dq = useDebounced(q);
  const fields = fieldsFor(def, org.modules);
  const canEdit = can(def.area, "edit");
  const canDelete = can(def.area, "full");
  const n = useNotify();
  const del = useAction((id: string) => api.del(`/data/${entity}/${id}`), { success: "حذف شد", invalidate: [["table"], ["options", entity]] });

  const columns: ColumnsType<any> = [
    ...fields
      .filter((f) => f.list)
      .map((f) => ({
        key: f.name,
        dataIndex: f.name,
        title: f.label,
        sorter: ["text", "code", "date", "money", "decimal", "int", "weight"].includes(f.type),
        align: (["money", "decimal", "int", "weight", "pct"].includes(f.type) ? "left" : undefined) as "left" | undefined,
        render: (v: unknown, row: Record<string, unknown>) => renderCell(f, v, row),
      })),
    ...extraColumns,
    {
      key: "_actions",
      width: 56,
      fixed: "left" as const,
      render: (_: unknown, row: any) => {
        const items = [
          ...(canEdit ? [{ key: "edit", icon: <EditOutlined />, label: "ویرایش", onClick: () => setEditing(row) }] : []),
          ...(rowActions?.(row) ?? []),
          ...(canDelete
            ? [{
                key: "del",
                icon: <DeleteOutlined />,
                danger: true,
                label: "حذف",
                onClick: async () => {
                  if (await n.confirm(`حذف «${row[def.display] ?? ""}»؟`, "اگر در اسناد استفاده شده باشد حذف نمی‌شود؛ می‌توانید آن را غیرفعال کنید.", true)) del.mutate(row.id);
                },
              }]
            : []),
        ];
        if (!items.length) return null;
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <Dropdown trigger={["click"]} menu={{ items }}>
              <Button type="text" size="small" icon={<MoreOutlined />} aria-label="عملیات" />
            </Dropdown>
          </span>
        );
      },
    },
  ];

  const filterFields = fields.filter((f) => f.filter && (f.type === "select" || f.type === "multiselect" || f.type === "bool"));
  const params: Record<string, string> = { q: dq };
  for (const [k, v] of Object.entries(filters)) if (v) params[`f.${k}`] = v;

  return (
    <div>
      <PageHeader
        title={title ?? def.plural}
        actions={
          <>
            {headerActions}
            {canEdit && !hideNew ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
                {def.title} جدید
              </Button>
            ) : null}
          </>
        }
      />
      <div className="tz-card p-3 md:p-4">
        <ServerTable
          path={`/data/${entity}`}
          params={params}
          columns={columns}
          onRowClick={(r) => (onOpen ? onOpen(r) : canEdit ? setEditing(r) : undefined)}
          rowClassName={(r: any) => (r.is_active === false ? "row-muted" : "")}
          exportName={def.plural}
          exportColumns={fields.filter((f) => f.list).map((f) => ({ title: f.label, value: (r: any) => (Array.isArray(r[f.name]) ? r[f.name].join("، ") : r[f.name]), type: ["money", "decimal", "int", "weight", "pct"].includes(f.type) ? "number" : "text" }))}
          toolbar={
            <Space wrap>
              <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="جستجو…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-64" />
              {filterFields.map((f) => (
                <Select
                  key={f.name}
                  allowClear
                  placeholder={f.label}
                  className="!min-w-36"
                  value={filters[f.name] || undefined}
                  onChange={(v) => setFilters({ ...filters, [f.name]: v ?? "" })}
                  options={f.type === "bool" ? [{ value: "true", label: `${f.label}: بله` }, { value: "false", label: `${f.label}: خیر` }] : f.options}
                />
              ))}
            </Space>
          }
        />
      </div>
      <Drawer
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        size={drawerWidth}
        title={editing?.id ? `ویرایش ${def.title}` : `${def.title} جدید`}
        destroyOnHidden
        styles={{ body: { paddingBottom: 0 } }}
      >
        {editing !== undefined ? <EntityForm def={def} initial={editing} onSaved={() => setEditing(undefined)} onCancel={() => setEditing(undefined)} /> : null}
      </Drawer>
    </div>
  );
}

export { Popconfirm };

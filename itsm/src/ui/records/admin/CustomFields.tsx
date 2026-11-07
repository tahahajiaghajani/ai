// «فیلدهای سفارشی»: the fields an organisation adds to a table (`custom_field` rows named u_*, stored in the record's
// `custom` json and treated like built-in fields everywhere), and its own label, help text, list column and
// «الزامی» for the table's existing fields. Changes reach every open page through the refreshed definitions.
import { useMemo, useState } from "react";
import { Button, Checkbox, Drawer, Input, Radio, Select, Switch, Table, Tooltip } from "antd";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X } from "lucide-react";
import type { FieldDef, FieldType, Option } from "@shared/model/types";
import { COLOR_KEYS, FIELD_TYPES } from "@shared/model/types";
import { CUSTOM_FIELD_TYPES } from "@shared/tables/core";
import { FORM_ROW } from "@shared/model/arrangement";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState } from "../../components/display";
import { Card } from "../../components/blocks";
import { useRecordActions, useRecordList, useRefreshSchema, useSchema } from "../data/hooks";
import { fieldErrorsOf, type RecordRow, type TableMeta } from "../model/types";
import { COLOR_LABELS } from "../model/colors";
import { formLayout } from "../model/layout";
import { ChoiceTag } from "../fields/display";
import { TablePicker, customisableTables, useTableParam } from "./shared";
import "../records.css";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const NAME = /^[a-z0-9_]{1,40}$/;

export default function CustomFields() {
  const { can } = useOrg();
  const n = useNotify();
  const { schema } = useSchema();
  const [def, setTable] = useTableParam(schema);
  const refresh = useRefreshSchema();
  const actions = useRecordActions("custom_field");
  const editable = can("settings", "edit");
  const rows = useRecordList(
    "custom_field",
    { filter: def ? { and: [{ f: "table_key", op: "eq", v: def.key }, { f: "name", op: "ne", v: FORM_ROW }] } : null, size: 500, sort: "sort_order,name", total: false },
    { enabled: !!def },
  );
  const [editing, setEditing] = useState<{ row?: RecordRow; base?: FieldDef } | null>(null);
  const all = rows.data?.rows ?? [];
  const custom = all.filter((r) => String(r.name).startsWith("u_"));
  const overrides = new Map(all.filter((r) => !String(r.name).startsWith("u_")).map((r) => [String(r.name), r]));
  const builtIn = useMemo(() => (def ? def.fields.filter((f) => !f.custom && !f.system && !f.base && !f.hidden) : []), [def]);

  const remove = async (r: RecordRow) => {
    if (!(await n.confirm(`حذف فیلد «${r.label}»؟`, "مقدارهای ذخیره‌شده در رکوردها می‌مانند ولی دیگر دیده نمی‌شوند.", true))) return;
    try {
      await actions.remove(r.id, r.version);
      await refresh();
      n.ok(`فیلد «${r.label}» حذف شد`);
    } catch (e) {
      n.error(e);
    }
  };

  if (schema && !customisableTables(schema).length) return <EmptyState title="جدولی برای سفارشی‌سازی نیست" />;
  return (
    <div className="rk-admin">
      <PageHeader
        title="فیلدهای سفارشی"
        actions={
          editable && def ? (
            <Button type="primary" icon={<Plus {...I16} />} onClick={() => setEditing({})}>
              فیلد تازه
            </Button>
          ) : null
        }
      />
      <div className="rk-admin-bar">
        <TablePicker schema={schema} value={def?.key} onChange={setTable} />
      </div>
      {def ? (
        <>
          <Card title="فیلدهای افزوده">
            <Table<RecordRow>
              size="small"
              className="ds-table"
              rowKey="id"
              loading={rows.isLoading}
              dataSource={custom}
              pagination={false}
              locale={{ emptyText: <EmptyState compact title="هنوز فیلدی افزوده نشده است" action={editable ? <Button onClick={() => setEditing({})}>فیلد تازه</Button> : undefined} /> }}
              columns={[
                { key: "label", title: "برچسب", dataIndex: "label" },
                { key: "name", title: "نام فنی", dataIndex: "name", render: (v: string) => <bdi dir="ltr" className="ds-mono">{v}</bdi> },
                { key: "type", title: "نوع", dataIndex: "type", render: (v: FieldType) => FIELD_TYPES[v]?.label ?? v },
                { key: "flags", title: "ویژگی‌ها", render: (_: unknown, r) => [r.required && "الزامی", r.list && "ستون فهرست", r.filter && "پالایه", r.search && "جست‌وجو"].filter(Boolean).join("، ") || "—" },
                { key: "active", title: "فعال", dataIndex: "active", render: (v: boolean) => (v ? "بله" : "خیر") },
                {
                  key: "a",
                  title: "",
                  width: 80,
                  render: (_: unknown, r) =>
                    editable ? (
                      <span className="flex gap-1">
                        <Tooltip title="ویرایش">
                          <Button type="text" size="small" icon={<Pencil {...I14} />} onClick={() => setEditing({ row: r })} aria-label={`ویرایش ${r.label}`} />
                        </Tooltip>
                        <Tooltip title="حذف">
                          <Button type="text" size="small" danger icon={<Trash2 {...I14} />} onClick={() => remove(r)} aria-label={`حذف ${r.label}`} />
                        </Tooltip>
                      </span>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Card title="فیلدهای موجود">
            <Table<FieldDef>
              size="small"
              className="ds-table"
              rowKey="name"
              dataSource={builtIn}
              pagination={false}
              columns={[
                { key: "label", title: "برچسب", dataIndex: "label", render: (v: string, f) => (overrides.has(f.name) ? <span>{v} <span className="rk-me">(تغییر داده‌شده)</span></span> : v) },
                { key: "name", title: "نام فنی", dataIndex: "name", render: (v: string) => <bdi dir="ltr" className="ds-mono">{v}</bdi> },
                { key: "type", title: "نوع", dataIndex: "type", render: (v: FieldType) => FIELD_TYPES[v]?.label ?? v },
                { key: "req", title: "الزامی", dataIndex: "required", render: (v: boolean) => (v ? "بله" : "خیر") },
                {
                  key: "a",
                  title: "",
                  width: 48,
                  render: (_: unknown, f) =>
                    editable ? (
                      <Tooltip title="برچسب و راهنما">
                        <Button type="text" size="small" icon={<Pencil {...I14} />} onClick={() => setEditing({ base: f, row: overrides.get(f.name) })} aria-label={`ویرایش ${f.label}`} />
                      </Tooltip>
                    ) : null,
                },
              ]}
            />
          </Card>
        </>
      ) : null}
      {editing && def ? (
        <FieldDrawer
          def={def}
          row={editing.row}
          base={editing.base}
          nextOrder={Math.max(0, ...custom.map((r) => Number(r.sort_order ?? 0))) + 10}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface Draft {
  name: string;
  label: string;
  type: FieldType;
  mode: "static" | "list";
  choices: string;
  options: Option[];
  ref: string;
  required: boolean;
  list: boolean;
  search: boolean;
  filter: boolean;
  help: string;
  section: string;
  max_length: number | null;
  active: boolean;
}

function FieldDrawer({ def, row, base, nextOrder, onClose, onSaved }: { def: TableMeta; row?: RecordRow; base?: FieldDef; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const n = useNotify();
  const { schema } = useSchema();
  const actions = useRecordActions("custom_field");
  const override = !!base;
  const [d, setD] = useState<Draft>(() => ({
    name: row ? String(row.name).replace(/^u_/, "") : (base?.name ?? ""),
    label: String(row?.label ?? base?.label ?? ""),
    type: ((row?.type as FieldType) ?? base?.type ?? "string") as FieldType,
    mode: row?.choices ? "list" : "static",
    choices: String(row?.choices ?? ""),
    options: Array.isArray(row?.options) ? (row!.options as Option[]) : [],
    ref: String(row?.ref ?? ""),
    required: !!(row?.required ?? false),
    list: !!(row?.list ?? false),
    search: !!(row?.search ?? false),
    filter: !!(row?.filter ?? false),
    help: String(row?.help ?? base?.help ?? ""),
    section: String(row?.section ?? ""),
    max_length: (row?.max_length as number | null) ?? null,
    active: row ? row.active !== false : true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const isChoice = d.type === "choice" || d.type === "multichoice";
  const isRef = d.type === "ref" || d.type === "refs";
  const sections = useMemo(() => [...new Set(formLayout(def, { mode: "create" }).flatMap((t) => t.sections.map((s) => s.label).filter(Boolean) as string[]))], [def]);
  const lists = Object.keys(schema?.choices ?? {}).sort();
  const targets = [...(schema?.tables.values() ?? [])].filter((t) => !t.virtual && t.key !== "custom_field" && t.key !== "choice" && t.key !== "view");

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!override && !NAME.test(d.name)) errs.name = "نام فنی فقط حروف کوچک لاتین، رقم و _ (حداکثر ۴۰)";
    if (!d.label.trim()) errs.label = "برچسب را بنویسید";
    if (!override && isChoice && d.mode === "static" && !d.options.filter((o) => o.value.trim()).length) errs.options = "دست‌کم یک گزینه بیفزایید";
    if (!override && isChoice && d.mode === "list" && !d.choices) errs.choices = "فهرست گزینه‌ها را انتخاب کنید";
    if (!override && isRef && !d.ref) errs.ref = "جدول مقصد را انتخاب کنید";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const data: Record<string, unknown> = override
      ? { label: d.label.trim(), help: d.help.trim() || null, required: d.required, list: d.list }
      : {
          label: d.label.trim(),
          type: d.type,
          choices: isChoice && d.mode === "list" ? d.choices : null,
          options: isChoice && d.mode === "static" ? d.options.filter((o) => o.value.trim()).map((o, i) => ({ ...o, value: o.value.trim(), label: o.label.trim() || o.value.trim(), order: i + 1 })) : null,
          ref: isRef ? d.ref : null,
          required: d.required,
          list: d.list,
          search: d.search && FIELD_TYPES[d.type].sql === "text",
          filter: d.filter,
          help: d.help.trim() || null,
          section: d.section.trim() || null,
          max_length: d.max_length,
          active: d.active,
        };
    setBusy(true);
    try {
      if (row) await actions.update(row.id, data, row.version);
      else await actions.create({ table_key: def.key, name: override ? base!.name : `u_${d.name}`, ...(override ? {} : { sort_order: nextOrder }), ...data });
      n.ok(`فیلد «${d.label.trim()}» ذخیره شد`);
      onSaved();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (Object.keys(fe).length) setErrors(fe);
      else n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      size={560}
      placement="left"
      title={override ? `برچسب و راهنمای «${base!.label}»` : row ? `ویرایش «${row.label}»` : `فیلد تازه برای ${def.plural}`}
      onClose={onClose}
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2 py-1">
          <Button onClick={onClose}>انصراف</Button>
          <Button type="primary" onClick={save} loading={busy}>
            ذخیره
          </Button>
        </div>
      }
    >
      <div className="rk-stack">
        <Labeled label="برچسب" error={errors.label} htmlFor="cf-label">
          <Input id="cf-label" value={d.label} onChange={(e) => set({ label: e.target.value })} maxLength={80} autoFocus />
        </Labeled>
        {!override ? (
          <>
            <Labeled label="نام فنی" error={errors.name} htmlFor="cf-name" hint={row ? "نام فنی پس از ساخت تغییر نمی‌کند." : "در گزارش‌ها، API و ورود از اکسل به کار می‌رود."}>
              <Input id="cf-name" dir="ltr" className="ds-mono" prefix={<span className="text-ink-3">u_</span>} value={d.name} disabled={!!row} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} placeholder="cost_center" maxLength={40} />
            </Labeled>
            <Labeled label="نوع" htmlFor="cf-type">
              <Select id="cf-type" value={d.type} disabled={!!row} onChange={(t) => set({ type: t })} options={CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPES[t].label }))} showSearch={{ optionFilterProp: "label" }} />
            </Labeled>
            {isChoice ? (
              <Labeled label="گزینه‌ها" error={errors.options ?? errors.choices}>
                <Radio.Group value={d.mode} onChange={(e) => set({ mode: e.target.value })} options={[{ value: "static", label: "گزینه‌های همین فیلد" }, { value: "list", label: "یک فهرست گزینهٔ موجود" }]} />
                {d.mode === "list" ? (
                  <Select value={d.choices || undefined} onChange={(v) => set({ choices: v })} options={lists.map((l) => ({ value: l, label: l }))} placeholder="فهرست" showSearch />
                ) : (
                  <OptionsEditor value={d.options} onChange={(options) => set({ options })} />
                )}
              </Labeled>
            ) : null}
            {isRef ? (
              <Labeled label="جدول مقصد" error={errors.ref}>
                <Select value={d.ref || undefined} onChange={(v) => set({ ref: v })} options={targets.map((t) => ({ value: t.key, label: t.plural }))} showSearch={{ optionFilterProp: "label" }} disabled={!!row} />
              </Labeled>
            ) : null}
            <Labeled label="بخش فرم" hint="خالی: بخش نخست. چیدمان کامل در «چیدمان فرم‌ها».">
              <Select mode="tags" maxCount={1} value={d.section ? [d.section] : []} onChange={(v: string[]) => set({ section: v[v.length - 1] ?? "" })} options={sections.map((s) => ({ value: s, label: s }))} placeholder="بخش" />
            </Labeled>
          </>
        ) : null}
        <Labeled label="راهنما" htmlFor="cf-help" hint="کنار برچسب، با نشانگر ⓘ.">
          <Input.TextArea id="cf-help" value={d.help} onChange={(e) => set({ help: e.target.value })} maxLength={300} autoSize={{ minRows: 2, maxRows: 5 }} />
        </Labeled>
        <div className="rk-stack-s">
          <Checkbox checked={d.required} onChange={(e) => set({ required: e.target.checked })} disabled={override && !!base?.required}>
            الزامی
          </Checkbox>
          <Checkbox checked={d.list} onChange={(e) => set({ list: e.target.checked })}>
            ستون پیش‌فرض فهرست
          </Checkbox>
          {!override ? (
            <>
              <Checkbox checked={d.filter} onChange={(e) => set({ filter: e.target.checked })}>
                در پالایه‌ها (پرکاربرد)
              </Checkbox>
              {FIELD_TYPES[d.type].sql === "text" ? (
                <Checkbox checked={d.search} onChange={(e) => set({ search: e.target.checked })}>
                  در جست‌وجو
                </Checkbox>
              ) : null}
              <span className="rk-switch">
                <Switch checked={d.active} onChange={(v) => set({ active: v })} size="small" aria-label="فعال" />
                <span>فعال</span>
              </span>
            </>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}

function Labeled({ label, error, hint, htmlFor, children }: { label: string; error?: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="rk-stack-s">
      <label className="rk-lbl" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="rk-err" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="rk-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/** Static options of a choice field: value (Latin), label, colour; order by the arrows. */
export function OptionsEditor({ value, onChange }: { value: Option[]; onChange: (o: Option[]) => void }) {
  const set = (i: number, p: Partial<Option>) => onChange(value.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const move = (i: number, d: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="rk-stack-s">
      {value.map((o, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1">
          <Input size="small" dir="ltr" className="ds-mono" style={{ inlineSize: 110 }} value={o.value} onChange={(e) => set(i, { value: e.target.value.replace(/\s+/g, "_") })} placeholder="value" aria-label="مقدار" />
          <Input size="small" style={{ inlineSize: 150 }} value={o.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="برچسب" aria-label="برچسب" />
          <Select
            size="small"
            style={{ inlineSize: 110 }}
            value={o.color}
            allowClear
            onChange={(c) => set(i, { color: c })}
            placeholder="رنگ"
            options={COLOR_KEYS.map((k) => ({ value: k, label: COLOR_LABELS[k] }))}
            optionRender={(x) => <ChoiceTag option={{ value: String(x.value), label: String(x.label), color: x.value as Option["color"] }} />}
            aria-label="رنگ"
          />
          <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="بالاتر" />
          <Button type="text" size="small" icon={<ArrowDown {...I14} />} disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="پایین‌تر" />
          <Button type="text" size="small" icon={<X {...I14} />} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="حذف گزینه" />
        </div>
      ))}
      <Button size="small" type="text" icon={<Plus {...I14} />} onClick={() => onChange([...value, { value: "", label: "" }])} className="self-start">
        گزینه
      </Button>
    </div>
  );
}

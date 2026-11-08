// The builder's question designer (REQ-005…REQ-008): the item's questions in order (move up and down, edit in a
// drawer, delete), «پرسش تازه» by type, question sets attached to the item, and its form policies — a condition on the
// answers (the record kit's condition builder over the form itself) and what it does to which questions. Rows are
// saved through the generic API (the server checks names, options and patterns); every change marks a published item
// «تغییر منتشرنشده» and the live preview follows.
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Dropdown, Empty, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, Tag, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { describe, type Cond } from "@shared/model/conditions";
import { formDef, type FormSchema } from "@shared/request/form";
import { CHOICE_TYPES, FIELD_CLASSES, POLICY_SCOPES, variableType } from "@shared/request/vocab";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { Card, Field, ICON14 } from "../../components/blocks";
import { FilterBuilder, RecordSelect, recordsApi, useRecordList, useSchema, type TableMeta } from "../../records";
import { newQuestion, nextOrder, policySentence, reorder, typeGroups } from "./model";

type Row = Record<string, any>;

const QUESTION_FIELDS = ["label", "name", "type", "sort_order", "required", "readonly", "hidden", "width", "field_class", "default_value", "choices", "ref_table", "min", "max", "max_length", "price_per_unit", "regex", "regex_message", "help", "placeholder", "map_to", "active"];

export function Questions({ itemId, item, schema, canWrite, onChanged }: { itemId: string; item: Row; schema: FormSchema; canWrite: boolean; onChanged: () => void }) {
  const { api } = useOrg();
  const notify = useNotify();
  const list = useRecordList("catalog_variable", { filter: { f: "item_id", op: "eq", v: itemId }, sort: "sort_order,label", size: 200, fields: QUESTION_FIELDS });
  const rows = (list.data?.rows ?? []) as Row[];
  const [edit, setEdit] = useState<Row | null>(null);
  const changed = () => {
    void list.refetch();
    onChanged();
  };
  const add = useAction(async (type: string) => recordsApi.create(api, "catalog_variable", { ...newQuestion(type, nextOrder(rows), rows.map((r) => String(r.name))), item_id: itemId }), {
    onSuccess: (r) => {
      changed();
      setEdit(r.row as Row);
    },
  });
  const move = async (from: number, to: number) => {
    try {
      for (const x of reorder(rows as { id: string; sort_order?: unknown }[], from, to)) await recordsApi.update(api, "catalog_variable", x.id, { sort_order: x.sort_order });
      changed();
    } catch (e) {
      notify.error(e);
    }
  };
  const remove = useAction((r: Row) => recordsApi.remove(api, "catalog_variable", String(r.id)), { success: "پرسش حذف شد.", onSuccess: changed });
  const menu = { items: typeGroups().map((g) => ({ key: g.group, type: "group" as const, label: g.group, children: g.types.map((t) => ({ key: t.value, label: t.label })) })), onClick: ({ key }: { key: string }) => add.mutate(key) };
  const sets = (Array.isArray(item.variable_sets) ? item.variable_sets : []) as string[];

  return (
    <div className="rq-form">
      <Card
        title="پرسش‌ها"
        tools={
          canWrite ? (
            <Dropdown menu={menu} trigger={["click"]}>
              <Button type="primary" icon={<Plus {...ICON14} />} loading={add.isPending}>
                پرسش تازه
              </Button>
            </Dropdown>
          ) : null
        }
      >
        {!rows.length ? <Empty description="هنوز پرسشی ندارد" /> : null}
        {rows.map((r, i) => (
          <div key={r.id} className="rq-qrow">
            <div className="rq-qrow-b">
              <span>
                {r.label} {r.required ? <span className="rq-req">*</span> : null}
              </span>
              <span className="rq-line-m">
                <Tag variant="filled">{variableType(r.type)?.label ?? r.type}</Tag>
                {r.hidden ? <span>پنهان</span> : null}
                {r.field_class && r.field_class !== "public" ? <span>{FIELD_CLASSES.find((c) => c.value === r.field_class)?.label}</span> : null}
                {r.active === false ? <span>غیرفعال</span> : null}
              </span>
            </div>
            <span className="rq-qrow-n">{r.name}</span>
            {canWrite ? (
              <span className="rq-qrow-x">
                <Button size="small" type="text" icon={<ArrowUp {...ICON14} />} aria-label="بالاتر" disabled={i === 0} onClick={() => move(i, i - 1)} />
                <Button size="small" type="text" icon={<ArrowDown {...ICON14} />} aria-label="پایین‌تر" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} />
                <Button size="small" type="text" icon={<Pencil {...ICON14} />} aria-label="ویرایش" onClick={() => setEdit(r)} />
                <Popconfirm title="این پرسش حذف شود؟" okText="حذف" cancelText="انصراف" onConfirm={() => remove.mutate(r)}>
                  <Button size="small" type="text" danger icon={<Trash2 {...ICON14} />} aria-label="حذف" />
                </Popconfirm>
              </span>
            ) : null}
          </div>
        ))}
      </Card>
      <Card title="مجموعه‌پرسش‌ها">
        <Field label="مجموعه‌پرسش‌های این قلم" hint="پرسش‌های مشترک (مانند «مرکز هزینه») یا جدول چندسطری؛ تغییر در مجموعه به همهٔ اقلامش می‌رسد">
          <RecordSelect
            table="variable_set"
            multiple
            value={sets}
            disabled={!canWrite}
            onChange={async (v) => {
              try {
                await recordsApi.update(api, "catalog_item", itemId, { variable_sets: Array.isArray(v) ? v : v ? [v] : [] });
                onChanged();
              } catch (e) {
                notify.error(e);
              }
            }}
          />
        </Field>
      </Card>
      <Policies itemId={itemId} schema={schema} canWrite={canWrite} onChanged={onChanged} />
      <QuestionDrawer row={edit} schema={schema} onClose={() => setEdit(null)} onSaved={changed} />
    </div>
  );
}

function QuestionDrawer({ row, schema, onClose, onSaved }: { row: Row | null; schema: FormSchema; onClose: () => void; onSaved: () => void }) {
  const { api } = useOrg();
  const { schema: tables } = useSchema();
  const [draft, setDraft] = useState<Row>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = row?.id ?? "";
  useEffect(() => {
    setDraft(row ? { ...row } : {});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!row) return null;
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const type = String(draft.type ?? "string");
  const numeric = ["int", "decimal", "money", "rating", "duration"].includes(type);
  const textual = ["string", "text", "email", "url", "phone", "ip"].includes(type);
  const choices = (Array.isArray(draft.choices) ? draft.choices : []) as { value: string; label: string; price?: string }[];
  const tableOptions = tables ? [...tables.tables.values()].filter((t) => !t.virtual).map((t) => ({ value: t.key, label: `${t.plural} (${t.key})` })) : [];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data: Row = {};
      for (const k of QUESTION_FIELDS) if (JSON.stringify(draft[k] ?? null) !== JSON.stringify(row[k] ?? null)) data[k] = draft[k] ?? null;
      if (Object.keys(data).length) await recordsApi.update(api, "catalog_variable", String(row.id), data, Number(row.version) || undefined);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const nameTaken = schema.variables.some((v) => v.name === draft.name && v.name !== row.name);
  return (
    <Drawer open title={`پرسش: ${row.label}`} onClose={onClose} size="large" destroyOnHidden footer={<Space><Button type="primary" loading={busy} onClick={save}>ذخیره</Button><Button onClick={onClose}>انصراف</Button></Space>}>
      <div className="rq-form">
        <Field label="پرسش">
          <Input value={draft.label ?? ""} onChange={(e) => set("label", e.target.value)} maxLength={200} />
        </Field>
        <Field label="نام فنی" hint={nameTaken ? "این نام در فرم هست" : "کلید پاسخ در گردش‌کارها، الگوی عنوان و API"}>
          <Input className="ltr" dir="ltr" value={draft.name ?? ""} onChange={(e) => set("name", e.target.value.toLowerCase())} maxLength={60} status={nameTaken ? "error" : undefined} />
        </Field>
        <Field label="نوع">
          <Select value={type} onChange={(v) => set("type", v)} options={typeGroups().map((g) => ({ label: g.group, options: g.types }))} />
        </Field>
        <Space wrap>
          <Switch checked={!!draft.required} onChange={(v) => set("required", v)} /> الزامی
          <Switch checked={!!draft.hidden} onChange={(v) => set("hidden", v)} /> پنهان (قاعده‌ها نمایانش می‌کنند)
          <Switch checked={!!draft.readonly} onChange={(v) => set("readonly", v)} /> فقط‌خواندنی
          <Switch checked={draft.active !== false} onChange={(v) => set("active", v)} /> فعال
        </Space>
        <Field label="پهنا">
          <Segmented value={draft.width === "half" ? "half" : "full"} onChange={(v) => set("width", v)} options={[{ value: "full", label: "تمام عرض" }, { value: "half", label: "نیم عرض" }]} />
        </Field>
        <Field label="ردهٔ داده" hint="حساس: فقط درخواست‌کننده و کارشناسان دارای دسترسی، و پس از بستن پوشانده می‌شود؛ محرمانه: فقط‌نوشتنی">
          <Select value={draft.field_class ?? "public"} onChange={(v) => set("field_class", v)} options={FIELD_CLASSES.map((c) => ({ value: c.value, label: c.label }))} />
        </Field>
        {CHOICE_TYPES.has(type) ? (
          <Field label="گزینه‌ها" hint="مقدار کلید پایدار گزینه است؛ مبلغ به قیمت قلم افزوده می‌شود">
            <div className="rq-choices">
              {choices.map((c, i) => (
                <div key={i} className="rq-choice">
                  <Input className="ltr" dir="ltr" placeholder="value" value={c.value} onChange={(e) => set("choices", choices.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label="مقدار گزینه" />
                  <Input placeholder="برچسب" value={c.label} onChange={(e) => set("choices", choices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="برچسب گزینه" />
                  <InputNumber placeholder="مبلغ (ریال)" min={0} value={c.price ? Number(c.price) : null} onChange={(v) => set("choices", choices.map((x, j) => (j === i ? { ...x, price: v ? String(v) : undefined } : x)))} aria-label="مبلغ گزینه" style={{ inlineSize: "100%" }} />
                  <Button type="text" danger icon={<Trash2 {...ICON14} />} aria-label="حذف گزینه" onClick={() => set("choices", choices.filter((_, j) => j !== i))} />
                </div>
              ))}
              <Button icon={<Plus {...ICON14} />} onClick={() => set("choices", [...choices, { value: `opt${choices.length + 1}`, label: `گزینهٔ ${(choices.length + 1).toLocaleString("fa-IR")}` }])}>
                گزینهٔ تازه
              </Button>
            </div>
          </Field>
        ) : null}
        {type === "reference" || type === "list_collector" ? (
          <Field label="جدول ارجاع">
            <Select showSearch value={draft.ref_table || undefined} onChange={(v) => set("ref_table", v)} options={tableOptions} optionFilterProp="label" />
          </Field>
        ) : null}
        {numeric ? (
          <Space wrap>
            <Field label="کمینه">
              <InputNumber value={draft.min ?? null} onChange={(v) => set("min", v === null ? null : String(v))} />
            </Field>
            <Field label="بیشینه">
              <InputNumber value={draft.max ?? null} onChange={(v) => set("max", v === null ? null : String(v))} />
            </Field>
            <Field label="مبلغ هر واحد (ریال)">
              <InputNumber min={0} value={draft.price_per_unit ? Number(draft.price_per_unit) : null} onChange={(v) => set("price_per_unit", v ? String(v) : null)} />
            </Field>
          </Space>
        ) : null}
        {textual ? (
          <>
            <Field label="بیشترین طول">
              <InputNumber min={1} max={20000} value={draft.max_length ?? null} onChange={(v) => set("max_length", v)} />
            </Field>
            <Field label="الگوی اعتبارسنجی (regex)">
              <Input className="ltr" dir="ltr" value={draft.regex ?? ""} onChange={(e) => set("regex", e.target.value || null)} />
            </Field>
            <Field label="پیام الگو">
              <Input value={draft.regex_message ?? ""} onChange={(e) => set("regex_message", e.target.value || null)} />
            </Field>
          </>
        ) : null}
        <Field label="مقدار پیش‌فرض" hint="برای کاربر: $me؛ برای تاریخ: $today؛ برای گزینه‌ها: مقدار گزینه">
          <Input value={draft.default_value ?? ""} onChange={(e) => set("default_value", e.target.value || null)} />
        </Field>
        <Field label="راهنما">
          <Input.TextArea value={draft.help ?? ""} onChange={(e) => set("help", e.target.value || null)} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} />
        </Field>
        <Field label="متن نمونه">
          <Input value={draft.placeholder ?? ""} onChange={(e) => set("placeholder", e.target.value || null)} maxLength={120} />
        </Field>
        <Field label="نگاشت به فیلد" hint="فیلد قلم درخواست‌شده یا رکورد مقصد، مانند access_until یا short_description">
          <Input className="ltr" dir="ltr" value={draft.map_to ?? ""} onChange={(e) => set("map_to", e.target.value || null)} maxLength={60} />
        </Field>
        {error ? <Alert type="error" title={error} /> : null}
      </div>
    </Drawer>
  );
}

const TRI = [
  { value: "", label: "—" },
  { value: "true", label: "بله" },
  { value: "false", label: "خیر" },
];
const tri = (v: unknown) => (v === true ? "true" : v === false ? "false" : "");
const fromTri = (v: string) => (v === "true" ? true : v === "false" ? false : undefined);

/** The item's form policies: «اگر … ← نمایش / الزامی / فقط‌خواندنی …». */
function Policies({ itemId, schema, canWrite, onChanged }: { itemId: string; schema: FormSchema; canWrite: boolean; onChanged: () => void }) {
  const { api, timezone } = useOrg();
  const { schema: tables } = useSchema();
  const list = useRecordList("catalog_ui_policy", { filter: { f: "item_id", op: "eq", v: itemId }, sort: "sort_order,name", size: 200, fields: ["name", "condition", "actions", "applies_to", "sort_order", "active", "message"] });
  const rows = (list.data?.rows ?? []) as Row[];
  const def = useMemo(() => ({ ...formDef(schema), can: { read: true as const, create: true } }) as TableMeta, [schema]);
  const labels = useMemo(() => Object.fromEntries(schema.variables.map((v) => [v.name, v.label])), [schema]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = () => {
    void list.refetch();
    onChanged();
  };
  const remove = useAction((r: Row) => recordsApi.remove(api, "catalog_ui_policy", String(r.id)), { success: "قاعده حذف شد.", onSuccess: changed });
  const save = async () => {
    if (!edit) return;
    setError(null);
    try {
      const data = { name: edit.name, condition: edit.condition ?? null, actions: edit.actions ?? [], applies_to: edit.applies_to ?? "both", message: edit.message ?? null, active: edit.active !== false };
      if (edit.id) await recordsApi.update(api, "catalog_ui_policy", String(edit.id), data);
      else await recordsApi.create(api, "catalog_ui_policy", { ...data, item_id: itemId, sort_order: nextOrder(rows) });
      setEdit(null);
      changed();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const sentence = (r: Row) => {
    let d = "";
    try {
      d = r.condition && Object.keys(r.condition).length && tables ? describe(r.condition as Cond, def, { lookup: tables.lookup }) : "";
    } catch {
      d = "شرط نامعتبر";
    }
    return policySentence({ actions: Array.isArray(r.actions) ? r.actions : [] }, d, labels);
  };
  const actions = (Array.isArray(edit?.actions) ? edit!.actions : []) as { variable: string; visible?: boolean; mandatory?: boolean; readonly?: boolean }[];
  const setActions = (a: typeof actions) => setEdit((e) => (e ? { ...e, actions: a } : e));
  return (
    <Card title="قاعده‌های فرم" tools={canWrite ? <Button icon={<Plus {...ICON14} />} onClick={() => setEdit({ name: "قاعدهٔ تازه", condition: null, actions: [], applies_to: "both" })}>قاعدهٔ تازه</Button> : null}>
      {!rows.length ? <Empty description="قاعده‌ای ندارد؛ پرسش‌ها همیشه همان‌طورند که تعریف شده‌اند" /> : null}
      {rows.map((r) => (
        <div key={r.id} className="rq-qrow">
          <div className="rq-qrow-b">
            <span>{r.name}</span>
            <span className="rq-line-m">{sentence(r)}</span>
          </div>
          {canWrite ? (
            <span className="rq-qrow-x">
              <Tooltip title="ویرایش">
                <Button size="small" type="text" icon={<Pencil {...ICON14} />} aria-label="ویرایش" onClick={() => setEdit({ ...r })} />
              </Tooltip>
              <Popconfirm title="این قاعده حذف شود؟" okText="حذف" cancelText="انصراف" onConfirm={() => remove.mutate(r)}>
                <Button size="small" type="text" danger icon={<Trash2 {...ICON14} />} aria-label="حذف" />
              </Popconfirm>
            </span>
          ) : null}
        </div>
      ))}
      <Drawer open={!!edit} title="قاعدهٔ فرم" onClose={() => setEdit(null)} size="large" destroyOnHidden footer={<Space><Button type="primary" onClick={save}>ذخیره</Button><Button onClick={() => setEdit(null)}>انصراف</Button></Space>}>
        {edit && tables ? (
          <div className="rq-form">
            <Field label="نام">
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="کجا">
              <Select value={edit.applies_to ?? "both"} onChange={(v) => setEdit({ ...edit, applies_to: v })} options={POLICY_SCOPES.map((o) => ({ value: o.value, label: o.label }))} />
            </Field>
            <Field label="شرط" hint="خالی یعنی همیشه">
              <FilterBuilder def={def} schema={tables} value={(edit.condition as Cond | null) ?? null} onChange={(c) => setEdit({ ...edit, condition: c })} walk={false} tz={timezone} />
            </Field>
            <Field label="اقدام‌ها">
              <div className="rq-choices">
                {actions.map((a, i) => (
                  <div key={i} className="rq-choice">
                    <Select value={a.variable} onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, variable: v } : x)))} options={schema.variables.map((v) => ({ value: v.name, label: v.label }))} aria-label="پرسش" />
                    <Space wrap>
                      <span>نمایش</span>
                      <Select size="small" value={tri(a.visible)} onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, visible: fromTri(v) } : x)))} options={TRI} aria-label="نمایش" />
                      <span>الزامی</span>
                      <Select size="small" value={tri(a.mandatory)} onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, mandatory: fromTri(v) } : x)))} options={TRI} aria-label="الزامی" />
                      <span>فقط‌خواندنی</span>
                      <Select size="small" value={tri(a.readonly)} onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, readonly: fromTri(v) } : x)))} options={TRI} aria-label="فقط‌خواندنی" />
                    </Space>
                    <span />
                    <Button type="text" danger icon={<Trash2 {...ICON14} />} aria-label="حذف اقدام" onClick={() => setActions(actions.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <Button icon={<Plus {...ICON14} />} onClick={() => setActions([...actions, { variable: schema.variables[0]?.name ?? "", visible: true }])} disabled={!schema.variables.length}>
                  اقدام تازه
                </Button>
              </div>
            </Field>
            <Field label="پیام (اختیاری)" hint="هنگام اعمال قاعده بالای فرم دیده می‌شود">
              <Input value={edit.message ?? ""} onChange={(e) => setEdit({ ...edit, message: e.target.value || null })} maxLength={300} />
            </Field>
            {error ? <Alert type="error" title={error} /> : null}
          </div>
        ) : null}
      </Drawer>
    </Card>
  );
}

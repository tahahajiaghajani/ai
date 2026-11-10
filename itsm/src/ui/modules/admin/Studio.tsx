// «استودیو»: custom tables and fields on the record engine — the slots and the tables in them, a new table drafted from
// a Persian description (the AI skill, or rules without a model) with a live preview of its form, the fields of any
// table, publishing versions and restoring one, packages (JSON) exported to and imported from other organisations with
// a preview, and the entry points to the designers that work on every table (fields, choice lists, forms, views,
// business rules, UI policies, flows).
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Input, Modal, Select, Space, Table, Upload } from "antd";
import { Wand2, Plus, Trash2, Upload as UploadIcon, Download, History, Send, Table2, ListPlus, List, LayoutTemplate, Workflow, SlidersHorizontal, Bookmark, Route } from "lucide-react";
import type { FieldDef, FieldType } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { STUDIO_TYPES, fieldNameFor, slotPrefix, type StudioField, type TableDraft } from "@shared/admin/studio";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, Skeleton } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { FieldInput, RecordList } from "../../records";
import { useSchema } from "../../records/data/hooks";

type Row = Record<string, any>;

interface SlotView {
  slot: string;
  table: Row | null;
  records: number;
  fields: number;
}

const ENTRY_POINTS = (table: string) => [
  { label: "فیلدهای سفارشی", icon: ListPlus, path: `settings/fields?table=${table}` },
  { label: "فهرست‌های گزینه", icon: List, path: "settings/choices" },
  { label: "چیدمان فرم", icon: LayoutTemplate, path: `settings/forms?table=${table}` },
  { label: "نماهای ذخیره‌شده", icon: Bookmark, path: `settings/views?table=${table}` },
  { label: "قاعده‌های کسب‌وکار", icon: Route, path: "sla/business-rules" },
  { label: "سیاست‌های فرم", icon: SlidersHorizontal, path: "sla/ui-policies" },
  { label: "گردش‌کارها", icon: Workflow, path: "flows" },
];

/** A draft's fields as engine field definitions (the live preview renders them with the record kit's editors). */
function asFieldDefs(fields: StudioField[]): FieldDef[] {
  return fields.map((f) => ({ name: f.name, label: f.label, type: f.type, required: f.required, choices: f.options ?? undefined, ref: f.ref ?? undefined, help: f.help ?? undefined }) as FieldDef);
}

function Preview({ title, fields }: { title: string; fields: StudioField[] }) {
  const { schema } = useSchema();
  const { timezone } = useOrg();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const base = schema?.def("custom_01") ?? schema?.def("todo");
  if (!schema || !base) return <Skeleton rows={3} />;
  const defs = asFieldDefs(fields);
  const def = { ...base, key: "studio_preview", label: title, plural: title, fields: [...base.fields.filter((f) => f.name === "title"), ...defs] };
  return (
    <div className="flex flex-col gap-3" aria-label="پیش‌نمایش فرم">
      {def.fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-2">
            {f.label}
            {f.required ? <span className="text-danger"> *</span> : null}
          </span>
          <FieldInput field={f} value={values[f.name] ?? null} onChange={(v) => setValues((x) => ({ ...x, [f.name]: v }))} def={def} schema={schema} row={values} tz={timezone} />
        </label>
      ))}
    </div>
  );
}

function FieldsEditor({ value, onChange }: { value: StudioField[]; onChange: (v: StudioField[]) => void }) {
  const set = (i: number, patch: Partial<StudioField>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => onChange([...value, { name: fieldNameFor("فیلد تازه", value.map((f) => f.name)), label: "فیلد تازه", type: "string" }]);
  return (
    <div className="flex flex-col gap-2">
      {value.map((f, i) => (
        <div key={f.name} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_auto_auto] sm:items-center">
          <Input value={f.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="برچسب" />
          <Select value={f.type} onChange={(t: FieldType) => set(i, { type: t, options: t === "choice" || t === "multichoice" ? f.options ?? [] : null })} options={STUDIO_TYPES.filter((t) => !["ref", "refs"].includes(t)).map((t) => ({ value: t, label: FIELD_TYPES[t].label }))} aria-label="نوع" />
          <Checkbox checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })}>
            الزامی
          </Checkbox>
          <Button type="text" aria-label="حذف فیلد" icon={<Trash2 {...ICON} />} onClick={() => onChange(value.filter((_, j) => j !== i))} />
          {f.type === "choice" || f.type === "multichoice" ? (
            <Select
              mode="tags"
              className="sm:col-span-4"
              value={(f.options ?? []).map((o) => o.label)}
              onChange={(labels: string[]) => set(i, { options: labels.map((label, j) => ({ value: (f.options ?? []).find((o) => o.label === label)?.value ?? `o${j + 1}`, label })) })}
              placeholder="گزینه‌ها را بنویسید و Enter بزنید"
              aria-label="گزینه‌ها"
            />
          ) : null}
        </div>
      ))}
      <Button icon={<Plus {...ICON} />} onClick={add}>
        فیلد دیگر
      </Button>
    </div>
  );
}

function NewTable({ onDone }: { onDone: () => void }) {
  const { api } = useOrg();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const make = useAction(() => api.post<{ draft: TableDraft; ai: boolean }>("/admin/studio/draft", { description: text }), {
    onSuccess: (d) => {
      setDraft(d.draft);
      setAi(d.ai);
    },
  });
  const create = useAction(() => api.post<{ slot: string }>("/admin/studio/tables", { label: draft!.label, plural: draft!.plural, description: draft!.description, icon: draft!.icon, fields: draft!.fields }), {
    success: (d) => `جدول در ${d.slot} ساخته شد`,
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-2">جدول را به فارسی شرح دهید</span>
          <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: ثبت ملاقات‌ها با فیلدهای نام مهمان (الزامی)، تاریخ ملاقات، میزبان، شماره تماس و وضعیت" />
        </label>
        <Space>
          <Button icon={<Wand2 {...ICON} />} onClick={() => make.mutate(undefined)} loading={make.isPending} disabled={text.trim().length < 5}>
            ساخت پیش‌نویس
          </Button>
          {ai !== null ? <Chip tone={ai ? "accent" : "neutral"}>{ai ? "ساخته‌شده با هوش مصنوعی — بازبینی کنید" : "بدون مدل و با قاعده ساخته شد"}</Chip> : null}
        </Space>
        {draft ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-label="نام جدول" />
              <Input value={draft.plural} onChange={(e) => setDraft({ ...draft, plural: e.target.value })} aria-label="نام جمع" />
            </div>
            <FieldsEditor value={draft.fields} onChange={(fields) => setDraft({ ...draft, fields })} />
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => create.mutate(undefined)} loading={create.isPending}>
              ساخت جدول
            </Button>
          </>
        ) : null}
      </div>
      <Card title="پیش‌نمایش فرم">{draft ? <Preview title={draft.label} fields={draft.fields} /> : <EmptyState compact icon={Table2} title="پیش‌نویس را بسازید تا فرم را ببینید" />}</Card>
    </div>
  );
}

function PackageIO() {
  const { api } = useOrg();
  const qc = useQueryClient();
  const [pkg, setPkg] = useState<unknown>(null);
  const [plan, setPlan] = useState<{ tables: { code: string; label: string; action: string; slot: string | null; fields: { change: string }[] }[]; fields: { label: string; fields: { change: string }[] }[]; problems: string[] } | null>(null);
  const exp = useAction(() => api.get("/admin/studio/export"), {
    onSuccess: (d) => {
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "studio-package.json";
      a.click();
      URL.revokeObjectURL(a.href);
    },
  });
  const preview = useAction((p: unknown) => api.post("/admin/studio/import", { package: p, dry_run: true }), { onSuccess: (d) => setPlan(d as typeof plan) });
  const apply = useAction(() => api.post("/admin/studio/import", { package: pkg, dry_run: false }), {
    success: "بسته وارد شد",
    onSuccess: () => {
      setPlan(null);
      qc.invalidateQueries({ queryKey: ["admin", "studio"] });
    },
  });
  const count = (fs: { change: string }[], c: string) => fs.filter((f) => f.change === c).length;
  return (
    <Card title="بستهٔ استودیو (خروجی و ورود میان سازمان‌ها)">
      <Space wrap>
        <Button icon={<Download {...ICON} />} onClick={() => exp.mutate(undefined)} loading={exp.isPending}>
          خروجی JSON
        </Button>
        <Upload
          accept="application/json,.json"
          showUploadList={false}
          beforeUpload={async (file) => {
            try {
              const p = JSON.parse(await file.text());
              setPkg(p);
              preview.mutate(p);
            } catch {
              setPlan({ tables: [], fields: [], problems: ["فایل JSON خوانده نشد"] });
            }
            return false;
          }}
        >
          <Button icon={<UploadIcon {...ICON} />}>ورود بسته…</Button>
        </Upload>
      </Space>
      <Modal open={!!plan} title="پیش‌نمایش ورود بسته" onCancel={() => setPlan(null)} onOk={() => apply.mutate(undefined)} okText="ورود" okButtonProps={{ disabled: !!plan?.problems.length }} confirmLoading={apply.isPending} destroyOnHidden>
        {plan?.problems.length ? <Note tone="danger">{plan.problems.join("؛ ")}</Note> : null}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {plan?.tables.map((t) => (
            <li key={t.code}>
              <Chip tone={t.action === "create" ? "in" : "neutral"}>{t.action === "create" ? "جدول تازه" : "به‌روزرسانی"}</Chip> «{t.label}» <span className="ltr ds-mono text-ink-3">{t.code}</span>
              {t.slot ? <span className="text-ink-3"> ← {t.slot}</span> : null} — {fa(count(t.fields, "new"))} فیلد تازه، {fa(count(t.fields, "changed"))} تغییر
            </li>
          ))}
          {plan?.fields.map((g) => (
            <li key={g.label}>
              فیلدهای «{g.label}»: {fa(count(g.fields, "new"))} تازه، {fa(count(g.fields, "changed"))} تغییر
            </li>
          ))}
        </ul>
      </Modal>
    </Card>
  );
}

export default function Studio() {
  const { api, orgId, can } = useOrg();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "studio"], queryFn: () => api.get<{ slots: SlotView[] }>("/admin/studio") });
  const [creating, setCreating] = useState(false);
  const del = useAction((slot: string) => api.del(`/admin/studio/tables/${slot}`), { success: "جدول حذف شد", invalidate: [["admin", "studio"]] });
  const publish = useAction((slot: string) => api.post(`/admin/studio/tables/${slot}/publish`, { note: null }), { success: "نسخهٔ تازه منتشر شد", invalidate: [["admin", "studio"]] });
  const used = (q.data?.slots ?? []).filter((s) => s.table);
  const free = (q.data?.slots ?? []).length - used.length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="استودیو" actions={can("settings", "edit") && free ? <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setCreating((x) => !x)}>جدول تازه</Button> : undefined} />
      {creating ? (
        <Card title="جدول تازه">
          <NewTable
            onDone={() => {
              setCreating(false);
              qc.invalidateQueries({ queryKey: ["admin", "studio"] });
              qc.invalidateQueries({ queryKey: ["records-meta"] });
            }}
          />
        </Card>
      ) : null}
      {!q.data ? (
        <Skeleton rows={4} />
      ) : used.length ? (
        <Card title={`جدول‌های سفارشی (${fa(used.length)} از ${fa(q.data.slots.length)})`} flush>
          <Table<SlotView>
            rowKey="slot"
            pagination={false}
            dataSource={used}
            scroll={{ x: true }}
            columns={[
              { title: "نام", render: (_, s) => <Link to={`/${orgId}/studio/t/${s.slot}`}>{s.table!.label}</Link> },
              { title: "کد", render: (_, s) => <span className="ltr ds-mono">{s.table!.code}</span> },
              { title: "شماره‌گذاری", render: (_, s) => <span className="ltr ds-mono">{slotPrefix(s.slot)}-000001</span> },
              { title: "فیلدها", render: (_, s) => <span className="ds-num">{fa(s.fields)}</span> },
              { title: "رکوردها", render: (_, s) => <span className="ds-num">{fa(s.records)}</span> },
              { title: "نسخه", render: (_, s) => (s.table!.revision ? <span className="ds-num">{fa(s.table!.revision)}</span> : <Chip tone="warning">منتشر نشده</Chip>) },
              {
                title: "",
                render: (_, s) => (
                  <Space>
                    <Button size="small" icon={<Send {...ICON} />} onClick={() => publish.mutate(s.slot)}>انتشار نسخه</Button>
                    <Link to={`/${orgId}/settings/fields?table=${s.slot}`}>فیلدها</Link>
                    <Button size="small" danger type="text" icon={<Trash2 {...ICON} />} aria-label="حذف جدول" disabled={s.records > 0} onClick={() => del.mutate(s.slot)} />
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ) : (
        <EmptyState icon={Table2} title="هنوز جدول سفارشی‌ای نساخته‌اید" action={can("settings", "edit") ? <Button type="primary" icon={<Wand2 {...ICON} />} onClick={() => setCreating(true)}>ساخت از شرح فارسی</Button> : undefined} />
      )}
      <PackageIO />
      <Card title="ابزارهای طراحی همهٔ جدول‌ها">
        <div className="flex flex-wrap gap-2">
          {ENTRY_POINTS("").map((e) => (
            <Link key={e.label} to={`/${orgId}/${e.path}`} className="ds-card inline-flex items-center gap-2 px-3 py-2">
              <e.icon {...ICON} aria-hidden />
              {e.label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** A custom table's records under its own name, with its versions and designers. */
export function CustomTable() {
  const { slot = "" } = useParams();
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ["admin", "studio"], queryFn: () => api.get<{ slots: SlotView[] }>("/admin/studio") });
  const table = q.data?.slots.find((s) => s.slot === slot)?.table ?? null;
  const versions = useQuery({
    queryKey: ["admin", "studio-versions", table?.code],
    queryFn: () => api.get<{ rows: Row[] }>("/r/studio_version", { filter: JSON.stringify({ f: "table_code", op: "eq", v: table!.code }), sort: "-revision", size: "20" }),
    enabled: !!table,
  });
  const restore = useAction((id: string) => api.post(`/admin/studio/versions/${id}/restore`), { success: "نسخه بازگردانی شد", invalidate: [["admin", "studio"], ["records-meta"]] });
  const title = useMemo(() => table?.plural ?? slot, [table, slot]);
  if (q.isLoading) return <Skeleton rows={5} />;
  if (!table) return <EmptyState icon={Table2} title="این جایگاه جدولی ندارد" />;
  return (
    <div className="flex flex-col gap-4">
      <RecordList table={slot} title={title} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="نسخه‌ها" tools={<History {...ICON} aria-hidden />}>
          {(versions.data?.rows ?? []).length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {versions.data!.rows.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="ds-num">{fa(v.revision)}</span> — {v.note || v.title} <span className="text-ink-3"><JDateTime v={v.created_at} /></span>
                  </span>
                  <Button size="small" onClick={() => restore.mutate(String(v.id))}>بازگردانی</Button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-3">هنوز نسخه‌ای منتشر نشده است</span>
          )}
        </Card>
        <Card title="طراحی">
          <div className="flex flex-wrap gap-2">
            {ENTRY_POINTS(slot).map((e) => (
              <Link key={e.label} to={`/${orgId}/${e.path}`} className="ds-card inline-flex items-center gap-2 px-3 py-2">
                <e.icon {...ICON} aria-hidden />
                {e.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

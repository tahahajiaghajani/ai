// «فیلدهای جدول‌ها» (design F §3.3, §8.1; the old custom-field manager of settings/fields, with its table picker kept in
// `?table=`): every field of a table's form — form-hidden ones too, with the chip «پنهان در فرم» and «نمایش در فرم» —
// module-internal ones left out. Module fields carry their lock chips with the reasons; organisation fields come from
// the library («از کتابخانه») or belong to this table only («فیلد همین جدول»). Actions: «افزودن از کتابخانه», «فیلد
// تازهٔ همین جدول», «افزودن به کتابخانه» (a table-only field becomes a library field of the same name and storage),
// «الزامی برای…» (همه / فقط کارشناسان) with the creation paths it binds, labels and help, removing an organisation field.
// Hiding and requiring go through F1's overrides route (`settings` edit), which refuses the same combinations with the
// same reasons; table-only fields keep the generic API of `custom_field`, as before.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Alert, Button, Checkbox, Drawer, Dropdown, Input, Modal, Radio, Select, Switch, Table, Tooltip } from "antd";
import { BookPlus, Check, Eye, EyeOff, Library as LibraryIcon, Lock, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FieldDef, FieldType, Option } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { CUSTOM_FIELD_TYPES } from "@shared/tables/core";
import { FORM_ROW } from "@shared/model/arrangement";
import type { RequiredFor } from "@shared/forms/paths";
import { tableDef } from "@shared/tables";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { Card } from "../../../../components/blocks";
import { useRecordActions, useRecordList, useRefreshSchema, useSchema } from "../../../../records/data/hooks";
import { fieldErrorsOf, type RecordRow, type TableMeta } from "../../../../records/model/types";
import { formLayout } from "../../../../records/model/layout";
import { TablePicker, customisableTables, useTableParam } from "../../../../records/admin/shared";
import { FIELD_KEYS, fieldsApi, type LibraryEntry } from "./api";
import {
  KIND_LABELS, attachable, hideBlocker, promoteBody, requireBlocker, requirementText, tableFieldRows, type FieldsAccess, type TableFieldRow,
} from "./model";
import { F, I14, I16, OptionsEditor, useCloseGuard, useSheetSize } from "./parts";

const NAME = /^[a-z0-9_]{1,40}$/;
const COLUMNS = [
  "table_key", "name", "label", "type", "choices", "options", "ref", "required", "required_for", "list", "search", "filter", "help", "placeholder", "section",
  "max_length", "sort_order", "active", "library_id", "form_hidden", "field_group",
];

export interface TableFieldsProps {
  access: FieldsAccess;
  library: LibraryEntry[] | undefined;
  slot: HTMLElement | null;
}

type Dialog =
  | { kind: "edit"; row?: RecordRow; base?: FieldDef }
  | { kind: "require"; field: TableFieldRow }
  | { kind: "attach" }
  | null;

export function TableFields({ access, library, slot }: TableFieldsProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { schema } = useSchema();
  const [def, setTable] = useTableParam(schema);
  const refresh = useRefreshSchema();
  const actions = useRecordActions("custom_field");
  const rows = useRecordList(
    "custom_field",
    { filter: def ? { and: [{ f: "table_key", op: "eq", v: def.key }, { f: "name", op: "ne", v: FORM_ROW }] } : null, size: 500, sort: "sort_order,name", fields: COLUMNS, total: false },
    { enabled: !!def },
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = def ? tableDef(def.key) : undefined;
  const all = rows.data?.rows ?? [];
  const fields = useMemo(() => (def ? tableFieldRows(def, base, all) : []), [def, base, all]);
  const custom = all.filter((r) => String(r.name).startsWith("u_"));
  const onTable = new Set(fields.map((f) => f.name));
  const candidates = attachable(library ?? [], def?.key ?? "", onTable);
  const libraryId = (name: string) => library?.find((l) => l.name === name)?.id ?? null;

  const done = async (text: string) => {
    await Promise.all([refresh(), qc.invalidateQueries({ queryKey: FIELD_KEYS.all(orgId) })]);
    n.ok(text);
  };
  /** «پنهان در فرم» / «نمایش در فرم» and the requirement: F1's overrides route (the server's refusals come back as they are) */
  const override = async (f: TableFieldRow, input: Parameters<typeof fieldsApi.overrides>[2][string], text: string) => {
    if (!def) return;
    setBusy(f.name);
    try {
      await fieldsApi.overrides(api, def.key, { [f.name]: input });
      await rows.refetch();
      await done(text);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const promote = async (f: TableFieldRow) => {
    const r = f.row;
    if (!r) return;
    const p = promoteBody(r);
    if ("problem" in p) return n.warn(p.problem);
    if (!(await n.confirm(`افزودن «${f.label}» به کتابخانه؟`, "فیلدی با همین نام و نوع در کتابخانه ساخته می‌شود و این جدول آن را به کار می‌برد؛ مقدارهای ثبت‌شده می‌مانند.", false, "افزودن به کتابخانه"))) return;
    setBusy(f.name);
    try {
      const made = await fieldsApi.saveField(api, null, p.body);
      await actions.update(r.id, { library_id: made.row.id }, r.version);
      await rows.refetch();
      await done(`«${f.label}» به کتابخانه افزوده شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (f: TableFieldRow) => {
    const r = f.row;
    if (!r) return;
    if (!(await n.confirm(`حذف فیلد «${f.label}» از ${def?.plural ?? "جدول"}؟`, "مقدارهای ذخیره‌شده در رکوردها می‌مانند ولی دیگر دیده نمی‌شوند.", true))) return;
    setBusy(f.name);
    try {
      await actions.remove(r.id, r.version);
      await done(`فیلد «${f.label}» حذف شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };

  const menu = (f: TableFieldRow) => {
    const items: { key: string; label: React.ReactNode; icon: React.ReactNode; disabled?: boolean; danger?: boolean; onClick: () => void }[] = [];
    if (f.kind === "library") {
      const id = libraryId(f.name);
      if (id) items.push({ key: "lib", label: "ویرایش در کتابخانه", icon: <LibraryIcon {...I14} />, onClick: () => nav(`/${orgId}/settings/fields?tab=library&field=${id}`) });
    } else if (access.customWrite) {
      items.push({ key: "edit", label: f.kind === "module" ? "برچسب و راهنما" : "ویرایش", icon: <Pencil {...I14} />, onClick: () => setDialog(f.kind === "module" ? { kind: "edit", base: def?.fields.find((x) => x.name === f.name), row: f.row ?? undefined } : { kind: "edit", row: f.row ?? undefined }) });
    }
    if (access.settingsEdit && f.active) {
      const hb = hideBlocker(f);
      if (f.formHidden) items.push({ key: "show", label: "نمایش در فرم", icon: <Eye {...I14} />, onClick: () => override(f, { form_hidden: false }, `«${f.label}» در فرم نمایش داده می‌شود`) });
      else items.push({ key: "hide", label: <MenuLabel text="پنهان در فرم" why={hb} />, icon: <EyeOff {...I14} />, disabled: !!hb, onClick: () => override(f, { form_hidden: true }, `«${f.label}» از فرم پنهان شد`) });
      const rb = requireBlocker(f);
      items.push({ key: "req", label: <MenuLabel text="الزامی برای…" why={rb} />, icon: <Check {...I14} />, disabled: !!rb, onClick: () => setDialog({ kind: "require", field: f }) });
    }
    if (f.kind === "table" && f.active && access.designWrite && access.customWrite) items.push({ key: "promote", label: "افزودن به کتابخانه", icon: <BookPlus {...I14} />, onClick: () => promote(f) });
    if (f.kind !== "module" && f.row && access.customWrite) items.push({ key: "remove", label: "حذف از جدول", icon: <Trash2 {...I14} />, danger: true, onClick: () => remove(f) });
    return items;
  };

  const head =
    slot && def
      ? createPortal(
          <>
            {access.settingsEdit && access.designRead ? (
              <Button icon={<LibraryIcon {...I16} />} onClick={() => setDialog({ kind: "attach" })}>
                افزودن از کتابخانه
              </Button>
            ) : null}
            {access.customWrite ? (
              <Button type="primary" icon={<Plus {...I16} />} onClick={() => setDialog({ kind: "edit" })}>
                فیلد تازهٔ همین جدول
              </Button>
            ) : null}
          </>,
          slot,
        )
      : null;

  if (schema && !customisableTables(schema).length) return <EmptyState title="جدولی برای سفارشی‌سازی نیست" />;
  return (
    <div className="wff-tab">
      {head}
      <div className="wff-bar">
        <TablePicker schema={schema} value={def?.key} onChange={setTable} />
        {def ? <span className="rk-hint">پنهان کردن فقط فرم را تغییر می‌دهد؛ فیلد در فهرست‌ها، پالایه‌ها و خروجی می‌ماند.</span> : null}
      </div>
      {!def ? (
        <Loader />
      ) : (
        <Card flush>
          <Table<TableFieldRow>
            size="small"
            className="ds-table"
            rowKey="name"
            loading={rows.isLoading}
            dataSource={fields}
            pagination={false}
            scroll={{ x: 820 }}
            rowClassName={(f) => (f.formHidden || !f.active ? "wff-dim" : "")}
            columns={[
              {
                key: "label",
                title: "برچسب",
                render: (_: unknown, f) => (
                  <span className="wff-cell-2">
                    <span className="text-ink">{f.label}</span>
                    {f.defaultLabel ? <span className="rk-hint">برچسب ماژول: {f.defaultLabel}</span> : null}
                  </span>
                ),
              },
              { key: "name", title: "نام فنی", dataIndex: "name", render: (v: string) => <bdi dir="ltr" className="ds-mono">{v}</bdi> },
              { key: "type", title: "نوع", render: (_: unknown, f) => FIELD_TYPES[f.type]?.label ?? f.type },
              { key: "kind", title: "از کجا", render: (_: unknown, f) => <span className={f.kind === "module" ? "text-ink-3" : "text-ink"}>{KIND_LABELS[f.kind]}</span> },
              {
                key: "marks",
                title: "وضعیت در فرم",
                render: (_: unknown, f) => (
                  <span className="wff-marks">
                    {!f.active ? <Chip dot={false}>خاموش</Chip> : null}
                    {f.formHidden ? (
                      <span className="inline-flex items-center gap-1">
                        <Chip tone="warning">پنهان در فرم</Chip>
                        {access.settingsEdit ? (
                          <Button size="small" type="link" icon={<Eye {...I14} />} loading={busy === f.name} onClick={() => override(f, { form_hidden: false }, `«${f.label}» در فرم نمایش داده می‌شود`)}>
                            نمایش در فرم
                          </Button>
                        ) : null}
                      </span>
                    ) : null}
                    {requirementText(f) ? <Chip tone="info">{requirementText(f)}</Chip> : null}
                    {f.locks.map((l) => (
                      <Tooltip key={l.reason} title="ماژول به این فیلد وابسته است؛ پنهان یا الزامی نمی‌شود، ولی برچسب و راهنمایش تغییر می‌کند">
                        <span className="wff-lock">
                          <Lock {...I14} aria-hidden />
                          {l.label}
                        </span>
                      </Tooltip>
                    ))}
                  </span>
                ),
              },
              {
                key: "a",
                title: <span className="sr-only">کارها</span>,
                width: 56,
                // within reach on a phone, where the table scrolls sideways
                fixed: "end" as const,
                render: (_: unknown, f) => {
                  const items = menu(f);
                  if (!items.length) return null;
                  return (
                    <Dropdown trigger={["click"]} menu={{ items: items.map(({ onClick, ...i }) => ({ ...i, onClick: () => onClick() })) }}>
                      <Button type="text" size="small" icon={<MoreHorizontal {...I16} />} loading={busy === f.name} aria-label={`کارهای فیلد «${f.label}»`} />
                    </Dropdown>
                  );
                },
              },
            ]}
          />
        </Card>
      )}
      {dialog?.kind === "edit" && def ? (
        <FieldDrawer
          def={def}
          row={dialog.row}
          base={dialog.base}
          nextOrder={Math.max(0, ...custom.map((r) => Number(r.sort_order ?? 0))) + 10}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      ) : null}
      {dialog?.kind === "require" && def ? (
        <RequireDialog
          table={def}
          field={dialog.field}
          onClose={() => setDialog(null)}
          onSave={async (rf) => {
            const f = dialog.field;
            setDialog(null);
            await override(f, rf ? { required: true, required_for: rf } : { required: false }, rf ? `«${f.label}» ${rf === "all" ? "برای همه" : "برای کارشناسان"} الزامی شد` : `الزام «${f.label}» برداشته شد`);
          }}
        />
      ) : null}
      {dialog?.kind === "attach" && def ? (
        <AttachDialog
          table={def}
          candidates={candidates}
          onClose={() => setDialog(null)}
          onAttached={async (label) => {
            setDialog(null);
            await rows.refetch();
            await done(`«${label}» به ${def.plural} افزوده شد`);
          }}
        />
      ) : null}
    </div>
  );
}

/** A menu item's words, and why it is not offered when it is not. */
function MenuLabel({ text, why }: { text: string; why: string | null }) {
  return (
    <span className="wff-mi">
      {text}
      {why ? <small>{why}</small> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «الزامی برای…»: whom a requirement binds, and the creation paths it affects (§3.3)

function RequireDialog({ table, field, onClose, onSave }: { table: TableMeta; field: TableFieldRow; onClose: () => void; onSave: (rf: RequiredFor | null) => void }) {
  const { api, orgId } = useOrg();
  const [choice, setChoice] = useState<RequiredFor | "none">(field.formRequired ?? "all");
  const rf: RequiredFor = choice === "none" ? "all" : choice;
  const paths = useQuery({ queryKey: FIELD_KEYS.paths(orgId, table.key, rf), queryFn: () => fieldsApi.paths(api, table.key, rf), enabled: choice !== "none" });
  const blockers = choice === "none" ? [] : (paths.data?.blockers ?? []);
  return (
    <Modal
      open
      title={`الزامی برای… «${field.label}»`}
      onCancel={onClose}
      okText="ذخیره"
      cancelText="انصراف"
      onOk={() => onSave(choice === "none" ? null : choice)}
      okButtonProps={{ disabled: blockers.length > 0 || (choice !== "none" && paths.isLoading) }}
      width={560}
    >
      <div className="wff-stack">
        <Radio.Group
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          options={[
            { value: "all", label: "همه" },
            { value: "agents", label: "فقط کارشناسان" },
            ...(field.formRequired ? [{ value: "none", label: "اختیاری (برداشتن الزام)" }] : []),
          ]}
        />
        {choice === "none" ? null : paths.isLoading ? (
          <Loader />
        ) : paths.data ? (
          <>
            <p className="rk-hint">این الزام فقط ثبت‌های افراد را می‌سنجد. مسیرهای ساخت «{table.plural}»:</p>
            <ul className="wff-paths" aria-label="مسیرهای ساخت رکورد">
              {paths.data.effects.map((e) => (
                <li key={e.path.key} className={e.checked ? "is-on" : "is-off"}>
                  {e.checked ? <Check {...I14} aria-label="بررسی می‌شود" /> : <X {...I14} aria-label="بررسی نمی‌شود" />}
                  <span className="wff-path-l">{e.path.label}</span>
                  <span className="rk-hint">{e.text}</span>
                </li>
              ))}
            </ul>
            {blockers.map((b) => (
              <Alert key={b} type="warning" showIcon title={b} />
            ))}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «افزودن از کتابخانه»

function AttachDialog({ table, candidates, onClose, onAttached }: { table: TableMeta; candidates: LibraryEntry[]; onClose: () => void; onAttached: (label: string) => void }) {
  const { api } = useOrg();
  const n = useNotify();
  const [field, setField] = useState<string | null>(null);
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => [...new Set(formLayout(table, { mode: "create" }).flatMap((t) => t.sections.map((s) => s.label).filter(Boolean) as string[]))], [table]);
  const picked = candidates.find((c) => c.id === field);
  const attach = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await fieldsApi.attach(api, { table: table.key, field: picked.id, section: section.trim() || null });
      onAttached(picked.label);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={`افزودن از کتابخانه به ${table.plural}`} onCancel={onClose} okText="افزودن" cancelText="انصراف" onOk={attach} okButtonProps={{ disabled: !picked, loading: busy }} width={520}>
      <div className="wff-stack">
        {!candidates.length ? (
          <EmptyState compact title="فیلد آماده‌ای در کتابخانه نیست" description="فیلدهای کتابخانه یا پیش‌تر به این جدول افزوده شده‌اند یا بازنشسته‌اند." />
        ) : (
          <>
            <F label="فیلد کتابخانه" htmlFor="wff-attach-f">
              <Select
                id="wff-attach-f"
                value={field ?? undefined}
                onChange={(v) => setField(v)}
                options={candidates.map((c) => ({ value: c.id, label: `${c.label} · ${c.type_label}` }))}
                showSearch={{ optionFilterProp: "label" }}
                placeholder="جست‌وجوی فیلد…"
                autoFocus
              />
            </F>
            <F label="بخش فرم" htmlFor="wff-attach-s" hint="خالی: بخش نخست؛ چیدمان کامل در «چیدمان فرم‌ها»">
              <Select id="wff-attach-s" mode="tags" maxCount={1} value={section ? [section] : []} onChange={(v: string[]) => setSection(v[v.length - 1] ?? "")} options={sections.map((s) => ({ value: s, label: s }))} placeholder="بخش" />
            </F>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A table-only field (u_*), or the label, help and sample text of a module field (the old manager's sheet)

interface Draft {
  name: string;
  label: string;
  type: FieldType;
  mode: "static" | "list";
  choices: string;
  options: Option[];
  ref: string;
  list: boolean;
  search: boolean;
  filter: boolean;
  help: string;
  placeholder: string;
  section: string;
  max_length: number | null;
  active: boolean;
}

function FieldDrawer({ def, row, base, nextOrder, onClose, onSaved }: { def: TableMeta; row?: RecordRow; base?: FieldDef; nextOrder: number; onClose: () => void; onSaved: () => void }) {
  const n = useNotify();
  const { schema } = useSchema();
  const actions = useRecordActions("custom_field");
  const size = useSheetSize(560);
  const override = !!base;
  const initial = useMemo<Draft>(
    () => ({
      name: row ? String(row.name).replace(/^u_/, "") : (base?.name ?? ""),
      label: String(row?.label ?? base?.label ?? ""),
      type: ((row?.type as FieldType) ?? base?.type ?? "string") as FieldType,
      mode: row?.choices ? "list" : "static",
      choices: String(row?.choices ?? ""),
      options: Array.isArray(row?.options) ? (row!.options as Option[]) : [],
      ref: String(row?.ref ?? ""),
      list: !!(row?.list ?? false),
      search: !!(row?.search ?? false),
      filter: !!(row?.filter ?? false),
      help: String(row?.help ?? base?.help ?? ""),
      placeholder: String(row?.placeholder ?? base?.placeholder ?? ""),
      section: String(row?.section ?? ""),
      max_length: (row?.max_length as number | null) ?? null,
      active: row ? row.active !== false : true,
    }),
    [row, base],
  );
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const close = useCloseGuard(dirty, onClose);
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
      ? { label: d.label.trim(), help: d.help.trim() || null, placeholder: d.placeholder.trim() || null, list: d.list }
      : {
          label: d.label.trim(),
          type: d.type,
          choices: isChoice && d.mode === "list" ? d.choices : null,
          options: isChoice && d.mode === "static" ? d.options.filter((o) => o.value.trim()).map((o, i) => ({ ...o, value: o.value.trim(), label: o.label.trim() || o.value.trim(), order: i + 1 })) : null,
          ref: isRef ? d.ref : null,
          list: d.list,
          search: d.search && FIELD_TYPES[d.type].sql === "text",
          filter: d.filter,
          help: d.help.trim() || null,
          placeholder: d.placeholder.trim() || null,
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
      size={size}
      placement="left"
      title={override ? `برچسب و راهنمای «${base!.label}»` : row ? `ویرایش «${row.label}»` : `فیلد تازهٔ ${def.plural}`}
      onClose={close}
      destroyOnHidden
      footer={
        <div className="wff-foot">
          <span className="wff-foot-gap" />
          <Button onClick={close}>انصراف</Button>
          <Button type="primary" onClick={save} loading={busy} disabled={!!row && !dirty}>
            ذخیره
          </Button>
        </div>
      }
    >
      <div className="wff-stack">
        <F label="برچسب" error={errors.label} htmlFor="wff-cf-label">
          <Input id="wff-cf-label" value={d.label} onChange={(e) => set({ label: e.target.value })} maxLength={80} autoFocus />
        </F>
        {!override ? (
          <>
            <F label="نام فنی" error={errors.name} htmlFor="wff-cf-name" hint={row ? "نام فنی پس از ساخت تغییر نمی‌کند." : "در گزارش‌ها، API و ورود از اکسل به کار می‌رود."}>
              <span dir="ltr" className="wff-ltr">
                <Input id="wff-cf-name" className="ds-mono" prefix={<span className="text-ink-3">u_</span>} value={d.name} disabled={!!row} onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} placeholder="cost_center" maxLength={40} />
              </span>
            </F>
            <F label="نوع" htmlFor="wff-cf-type">
              <Select id="wff-cf-type" value={d.type} disabled={!!row} onChange={(t) => set({ type: t })} options={CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPES[t].label }))} showSearch={{ optionFilterProp: "label" }} />
            </F>
            {isChoice ? (
              <F label="گزینه‌ها" error={errors.options ?? errors.choices}>
                <Radio.Group value={d.mode} onChange={(e) => set({ mode: e.target.value })} options={[{ value: "static", label: "گزینه‌های همین فیلد" }, { value: "list", label: "یک فهرست گزینهٔ موجود" }]} />
                {d.mode === "list" ? (
                  <Select value={d.choices || undefined} onChange={(v) => set({ choices: v })} options={lists.map((l) => ({ value: l, label: l }))} placeholder="فهرست" showSearch aria-label="فهرست گزینه" />
                ) : (
                  <OptionsEditor value={d.options} onChange={(options) => set({ options })} />
                )}
              </F>
            ) : null}
            {isRef ? (
              <F label="جدول مقصد" error={errors.ref} htmlFor="wff-cf-ref">
                <Select id="wff-cf-ref" value={d.ref || undefined} onChange={(v) => set({ ref: v })} options={targets.map((t) => ({ value: t.key, label: t.plural }))} showSearch={{ optionFilterProp: "label" }} disabled={!!row} />
              </F>
            ) : null}
            <F label="بخش فرم" htmlFor="wff-cf-sec" hint="خالی: بخش نخست. چیدمان کامل در «چیدمان فرم‌ها».">
              <Select id="wff-cf-sec" mode="tags" maxCount={1} value={d.section ? [d.section] : []} onChange={(v: string[]) => set({ section: v[v.length - 1] ?? "" })} options={sections.map((s) => ({ value: s, label: s }))} placeholder="بخش" />
            </F>
          </>
        ) : null}
        <F label="راهنما" htmlFor="wff-cf-help" hint="کنار برچسب، با نشانگر ⓘ.">
          <Input.TextArea id="wff-cf-help" value={d.help} onChange={(e) => set({ help: e.target.value })} maxLength={300} autoSize={{ minRows: 2, maxRows: 5 }} />
        </F>
        <F label="متن نمونه" htmlFor="wff-cf-ph" hint="درون کادر خالی، تا چیزی نوشته شود.">
          <Input id="wff-cf-ph" value={d.placeholder} onChange={(e) => set({ placeholder: e.target.value })} maxLength={120} />
        </F>
        <div className="wff-checks">
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
                <Switch checked={d.active} onChange={(v) => set({ active: v })} size="small" aria-label="روشن" />
                <span>روشن</span>
              </span>
            </>
          ) : null}
        </div>
        {!override ? <p className="rk-hint">الزامی بودن و پنهان شدن در فرم را از فهرست فیلدها تنظیم کنید؛ آن‌جا مسیرهای ساخت رکورد هم دیده می‌شود.</p> : null}
      </div>
    </Drawer>
  );
}

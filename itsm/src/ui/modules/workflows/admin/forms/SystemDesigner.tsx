// A table's default form («فرم سامانه», design F §3.3, §8.2; package F5 — it takes over «چیدمان فرم‌ها»): the palette
// (the table's fields, fields no section holds, library fields to add, «فیلد تازه» made in the library's own sheet and
// added here), the canvas of tabs › sections › fields (drag,
// or Alt+↑/↓; form-hidden fields stay, dimmed, with «پنهان در فرم»), and the inspector: the field's label, help and
// sample text (overrides shared by every place the form appears; library fields take theirs from «فیلدها»),
// «پنهان در فرم», «الزامی برای…» with the creation paths it binds, its locks with their reasons, the UI policies that
// act on it. No width and no per-form label: `_form` stores field names only. Changes are a draft with undo and redo;
// «ذخیرهٔ فرم» shows what changes and sends it in one call (PUT /forms/system/:table/overrides, `settings` edit).
// «پیش‌نمایش» splits the canvas with the form as «ثبت‌کننده» or «کارشناس» fill it. Phones get the preview only.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Dropdown, Input, Modal, Segmented, Tooltip } from "antd";
import { BookPlus, Eye, MoreHorizontal, PencilRuler, Plus, Redo2, RotateCcw, Save, Search, Undo2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FIELD_TYPES } from "@shared/model/types";
import { isFieldItem, type FormItem } from "@shared/forms/layout";
import { faDigits } from "@shared/format";
import { tableDef } from "@shared/tables";
import { matchesFa } from "../../../../lib/fa";
import { useOrg } from "../../../../lib/org";
import { useIsPhone, useNotify } from "../../../../lib/hooks";
import { PageHeader } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { Note } from "../../../../components/blocks";
import { useMe, useRecordActions, useRecordList, useRefreshSchema, useSchema } from "../../../../records/data/hooks";
import { formLayout, spanOf } from "../../../../records/model/layout";
import { sameValue } from "../../../../records/model/values";
import type { TableMeta } from "../../../../records/model/types";
import { FIELD_KEYS, fieldsApi, type LibraryEntry } from "../fields/api";
import { FieldSheet } from "../fields/FieldSheet";
import { attachable, fieldsAccess } from "../fields/model";
import { FORM_KEYS, formsApi } from "./api";
import {
  PERSONAS, addSection, addTab, clampSel, defaultLayout, insertItem, moveItem, reconcileDraft, removeSection, removeTab, renameTab, rightsSummary, shiftItem, shiftSection,
  shiftTab, sysMarks, systemChanges, systemDraft, systemFields, systemRights, targetSection, typingKey, unplaced, updateSection, previewTable, findField,
  type Persona, type Sel, type SystemChanges, type SystemDraft,
} from "./model";
import { MoveControls, SectionInspector, SysFieldInspector, TabInspector } from "./Inspectors";
import { Block, DesignCanvas, I14, I16, PreviewForm, SaveStatus, dragField, useHistory, useLeaveGuard, useUndoKeys, type PreviewTab } from "./parts";
import "../../../../records/records.css";
import "../fields/fields.css";
import "./forms.css";

const NOT_DESIGNED = new Set(["custom_field", "choice", "view"]);

export default function SystemDesigner() {
  const { table = "" } = useParams<{ table: string }>();
  const org = useOrg();
  const { api, orgId } = org;
  const access = fieldsAccess(org);
  const phone = useIsPhone();
  const { schema, isLoading } = useSchema();
  const def = NOT_DESIGNED.has(table) ? undefined : schema?.def(table);
  const base = tableDef(table);
  const fields = useMemo(() => (def ? systemFields(def, base) : []), [def, base]);
  const stored = useMemo(() => (def ? systemDraft(def, fields) : null), [def, fields]);

  if (!access.designRead) return <EmptyState title="به «فرم‌ها» دسترسی ندارید" description="دیدن و تغییر فرم‌ها با طراحان فرم و گردش‌کار و مدیران تنظیمات سازمان است." />;
  if (isLoading || (!schema && !def)) return <Loader />;
  if (!def || !stored) return <EmptyState title="این جدول پیدا نشد" description="فرم پیش‌فرض جدول‌هایی که سازمان به کار می‌برد در «فرم‌ها» فهرست شده است." />;
  return <Designer key={table} table={table} def={def} fields={fields} stored={stored} editable={access.settingsEdit && !phone} access={access} phone={phone} orgId={orgId} api={api} />;
}

type Access = ReturnType<typeof fieldsAccess>;

interface DesignerProps {
  table: string;
  def: TableMeta;
  fields: ReturnType<typeof systemFields>;
  stored: SystemDraft;
  editable: boolean;
  access: Access;
  phone: boolean;
  orgId: string;
  api: ReturnType<typeof useOrg>["api"];
}

function Designer({ table, def, fields, stored, editable, access, phone, orgId, api }: DesignerProps) {
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshSchema();
  const { schema } = useSchema();
  const { tz } = useMe();
  const hist = useHistory<SystemDraft>(stored);
  const draft = hist.value;
  const [baseline, setBaseline] = useState<SystemDraft>(stored);
  const baseRef = useRef(stored);
  const resetNext = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // the table changed under the draft (saved, a field added or removed): keep unsaved edits, take the new fields
  useEffect(() => {
    const prev = baseRef.current;
    if (sameValue(prev, stored)) return;
    baseRef.current = stored;
    setBaseline(stored);
    if (resetNext.current || sameValue(draftRef.current, prev)) {
      resetNext.current = false;
      hist.reset(stored);
    } else hist.set(reconcileDraft(draftRef.current, fields));
  }, [stored, fields, hist.reset, hist.set]);

  const [sel, setSel] = useState<Sel | null>(null);
  const [preview, setPreview] = useState(false);
  const [persona, setPersona] = useState<Persona>("requester");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<SystemChanges | null>(null);
  const [newField, setNewField] = useState(false);
  const [busy, setBusy] = useState(false);

  const changes = useMemo(() => systemChanges(fields, baseline, draft), [fields, baseline, draft]);
  const dirty = changes.count > 0;
  useLeaveGuard(dirty, `/${orgId}/settings/forms`);
  useUndoKeys(editable, hist.undo, hist.redo);

  const unit = useQuery({ queryKey: FIELD_KEYS.unit(orgId), queryFn: () => fieldsApi.moneyUnit(api), staleTime: 300_000 });
  const library = useQuery({ queryKey: FIELD_KEYS.library(orgId), queryFn: () => fieldsApi.library(api), enabled: editable, staleTime: 30_000 });
  // «فیلد تازه»: a library field made in its own sheet, then added to this table
  const canMake = editable && access.designWrite;
  const types = useQuery({ queryKey: FIELD_KEYS.types(orgId), queryFn: () => fieldsApi.types(api), enabled: canMake, staleTime: 60_000 });
  const policies = useQuery({ queryKey: FORM_KEYS.policies(orgId, table), queryFn: () => formsApi.policies(api, table), enabled: access.settingsRead, staleTime: 60_000 });
  const vp = useQuery({ queryKey: FORM_KEYS.viewpoint(orgId, table, persona), queryFn: () => formsApi.systemPreview(api, table, persona), staleTime: 60_000 });
  const blockersAll = useQuery({ queryKey: FIELD_KEYS.paths(orgId, table, "all"), queryFn: () => fieldsApi.paths(api, table, "all"), enabled: editable, staleTime: 60_000 });
  const rows = useRecordList(
    "custom_field",
    { filter: { f: "table_key", op: "eq", v: table }, size: 500, fields: ["name", "active", "library_id"], total: false },
    { enabled: editable && access.customWrite },
  );
  const actions = useRecordActions("custom_field");

  const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);
  const defs = useMemo(() => new Map(def.fields.map((f) => [f.name, f])), [def]);
  const loose = unplaced(draft, fields);
  // a requirement for «همه» the server would refuse (the portal's built-in report cannot carry the field)
  const problems = Object.entries(draft.fields)
    .filter(([name, o]) => o.requiredFor === "all" && baseline.fields[name]?.requiredFor !== "all")
    .flatMap(([name]) => (blockersAll.data?.blockers.length ? [`«${draft.fields[name].label || name}»: ${blockersAll.data.blockers[0]}`] : []));

  // a change of the layout: the draft's next value, and where the selection goes (`key`: typing on in one box)
  const layoutEdit = useCallback(
    (fn: (d: SystemDraft) => { layout: SystemDraft["layout"]; sel?: Sel | null }, key?: string) => {
      const d = draftRef.current;
      const r = fn(d);
      hist.set({ ...d, layout: r.layout, arranged: true }, key);
      if (r.sel !== undefined) setSel(r.sel);
    },
    [hist.set],
  );
  const setField = (name: string, patch: Partial<SystemDraft["fields"][string]>) => {
    const d = draftRef.current;
    const next = { ...d.fields[name], ...patch };
    hist.set({ ...d, fields: { ...d.fields, [name]: next } }, typingKey(`field:${name}`, d.fields[name], next));
  };

  const place = (name: string) => layoutEdit((d) => insertItem(d.layout, { field: name }, targetSection(d.layout, sel)));
  const attach = async (id: string, label: string, ask = true) => {
    if (ask && !(await n.confirm(`افزودن «${label}» به «${def.plural}»؟`, "فیلد کتابخانه همین حالا به جدول افزوده می‌شود و در بخش برگزیده می‌نشیند.", false, "افزودن"))) return;
    const target = targetSection(draft.layout, sel);
    const section = draft.layout.tabs[target.t]?.sections[target.s]?.label ?? null;
    try {
      await fieldsApi.attach(api, { table, field: id, section });
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: FIELD_KEYS.all(orgId) }), qc.invalidateQueries({ queryKey: FORM_KEYS.list(orgId) })]);
      n.ok(`«${label}» به «${def.plural}» افزوده شد`);
    } catch (e) {
      n.error(e);
    }
  };
  const removeField = async (name: string) => {
    const r = rows.data?.rows.find((x) => x.name === name && x.active !== false);
    const label = draft.fields[name]?.label || name;
    if (!r) return;
    if (!(await n.confirm(`حذف «${label}» از «${def.plural}»؟`, "مقدارهای ثبت‌شده در رکوردها می‌مانند ولی دیگر دیده نمی‌شوند.", true))) return;
    try {
      await actions.remove(r.id, r.version);
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: FIELD_KEYS.all(orgId) }), qc.invalidateQueries({ queryKey: FORM_KEYS.list(orgId) })]);
      setSel(null);
      n.ok(`«${label}» از «${def.plural}» حذف شد`);
    } catch (e) {
      n.error(e);
    }
  };
  const save = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await formsApi.saveSystem(api, table, confirm.body);
      resetNext.current = true;
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: FORM_KEYS.all(orgId) })]);
      setConfirm(null);
      n.ok(`فرم «${def.plural}» ذخیره شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const describe = (item: FormItem) => {
    if (!isFieldItem(item)) return { label: item.text, span: 24, note: item.tone ?? "info" };
    const f = byName.get(item.field);
    const o = draft.fields[item.field];
    const d = defs.get(item.field);
    if (!f || !o) return { label: item.field, span: 8 };
    return {
      label: o.label || f.label,
      meta: [FIELD_TYPES[f.type]?.label ?? f.type, ...sysMarks(f, o)].join(" · "),
      span: d ? spanOf(d) : 8,
      required: f.moduleRequired || !!o.requiredFor,
      locked: f.locks.length > 0,
      dim: o.hidden,
    };
  };

  // ------------------------------------------------------------------ the preview
  const vpData = vp.data?.as;
  const rights = useMemo(() => (vpData ? systemRights(def, fields, draft, vpData) : null), [def, fields, draft, vpData]);
  const shownDef = useMemo(() => previewTable(def, draft), [def, draft]);
  const previewTabs = useMemo<PreviewTab[]>(() => {
    if (!rights) return [];
    return formLayout(shownDef, { mode: "create" }).map((t) => ({
      label: t.label,
      sections: t.sections.map((s) => ({
        key: s.key,
        label: s.label,
        items: s.fields.filter((f) => rights[f.name] && rights[f.name] !== "hidden").map((f) => ({ kind: "field" as const, name: f.name, field: f, right: rights[f.name], span: spanOf(f), label: f.label, help: f.help })),
      })),
    }));
  }, [shownDef, rights]);
  const previewPanel = (
    <section className="wfm-panel wfm-preview" aria-label="پیش‌نمایش فرم">
      <div className="wfm-preview-bar">
        <h2 className="wfm-panel-t">پیش‌نمایش</h2>
        <Segmented size="small" value={persona} onChange={(v) => setPersona(v as Persona)} options={PERSONAS} aria-label="دیدگاه" />
        {rights ? <span className="rk-hint">{rightsSummary(rights)}</span> : null}
      </div>
      {!schema || !rights ? (
        <Loader />
      ) : (
        <PreviewForm tabs={previewTabs} def={shownDef} schema={schema} tz={tz} unit={unit.data ?? "rial"} values={values} onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))} idPrefix="wfm-sp" />
      )}
    </section>
  );

  const header = (
    <PageHeader
      back={`/${orgId}/settings/forms`}
      title={`فرم ${def.plural}`}
      subtitle={
        <span className="wfm-toolbar">
          <Chip>فرم سامانه</Chip>
          {baseline.arranged ? <Chip tone="info">چیدمان سازمان</Chip> : null}
          {editable ? <SaveStatus state={problems.length ? "invalid" : dirty ? "pending" : "saved"} at={null} problems={problems.length} /> : null}
        </span>
      }
      actions={
        phone ? null : (
          <>
            {editable ? (
              <>
                <Tooltip title="واگرد (Ctrl+Z)">
                  <Button icon={<Undo2 {...I16} />} onClick={hist.undo} disabled={!hist.canUndo} aria-label="واگرد" />
                </Tooltip>
                <Tooltip title="ازنو (Ctrl+Shift+Z)">
                  <Button icon={<Redo2 {...I16} />} onClick={hist.redo} disabled={!hist.canRedo} aria-label="ازنو" />
                </Tooltip>
              </>
            ) : null}
            <Button icon={preview ? <PencilRuler {...I16} /> : <Eye {...I16} />} onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
              {preview ? "طراحی" : "پیش‌نمایش"}
            </Button>
            {editable ? (
              <>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "reset", icon: <RotateCcw {...I14} />, label: "بازگشت به چیدمان پیش‌فرض", disabled: !draft.arranged },
                      { key: "fields", icon: <BookPlus {...I14} />, label: "فیلدهای این جدول در «فیلدها»" },
                    ],
                    onClick: ({ key }) => {
                      if (key === "reset") hist.set((d) => ({ ...d, layout: defaultLayout(def), arranged: false }));
                      else nav(`/${orgId}/settings/fields?tab=tables&table=${table}`);
                    },
                  }}
                >
                  <Button icon={<MoreHorizontal {...I16} />} aria-label="کارهای دیگر" />
                </Dropdown>
                <Button type="primary" icon={<Save {...I16} />} disabled={!dirty || problems.length > 0} onClick={() => setConfirm(changes)}>
                  ذخیرهٔ فرم
                </Button>
              </>
            ) : null}
          </>
        )
      }
    />
  );

  if (phone)
    return (
      <div className="rk-admin wfm-page wfm-phone">
        {header}
        <Note>ویرایش این فرم روی رایانه ممکن است.</Note>
        {previewPanel}
      </div>
    );

  // ------------------------------------------------------------------ the palette and the inspector
  const lib = editable && library.data ? attachable(library.data.fields, table, new Set(fields.map((f) => f.name))).filter((e) => !q.trim() || matchesFa(`${e.label} ${e.name}`, q)) : [];
  const found = q.trim() ? fields.filter((f) => matchesFa(`${draft.fields[f.name]?.label ?? f.label} ${f.name}`, q)) : [];
  const palette = (
    <aside className="wfm-panel wfm-palette" aria-label="فیلدها">
      <Input allowClear size="small" prefix={<Search {...I14} aria-hidden />} placeholder="جست‌وجوی فیلد" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی فیلد" />
      {found.length ? (
        <Block title="فیلدهای این جدول">
          <ul className="wfm-pal-list">
            {found.map((f) => (
              <li key={f.name}>
                <button
                  type="button"
                  className="wfm-pal-item"
                  onClick={() => {
                    const at = findField(draft.layout, f.name);
                    if (at) setSel({ kind: "item", ...at });
                  }}
                >
                  {draft.fields[f.name]?.label || f.label}
                  <small>{FIELD_TYPES[f.type]?.label}</small>
                </button>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {loose.length ? (
        <Block title="فیلدهای بی‌جا">
          <p className="rk-hint">این‌ها در بخش نخست می‌آیند؛ هر کدام را به بخشی ببرید.</p>
          <ul className="wfm-pal-list">
            {loose.map((f) => (
              <li key={f.name}>
                <button type="button" className="wfm-pal-item" draggable={editable} onDragStart={(e: DragEvent) => dragField(e, f.name)} onClick={() => editable && place(f.name)} disabled={!editable}>
                  {draft.fields[f.name]?.label || f.label}
                  <small>{FIELD_TYPES[f.type]?.label}</small>
                </button>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {canMake ? (
        <span className="wfm-pal-actions">
          <Button size="small" icon={<Plus {...I14} />} onClick={() => setNewField(true)} disabled={!types.data}>
            فیلد تازه
          </Button>
        </span>
      ) : null}
      {editable ? (
        <Block title="کتابخانه">
          {library.isLoading ? (
            <Loader />
          ) : lib.length ? (
            <ul className="wfm-pal-list">
              {lib.slice(0, 60).map((e) => (
                <li key={e.id}>
                  <button type="button" className="wfm-pal-item" onClick={() => attach(e.id, e.label)} aria-label={`افزودن ${e.label} به ${def.plural}`}>
                    {e.label}
                    <small>{e.type_label}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rk-hint">فیلد آماده‌ای در کتابخانه نیست.</p>
          )}
        </Block>
      ) : null}
      {!editable ? <p className="rk-hint">تغییر فرم‌های سامانه با دسترسی ویرایش «تنظیمات» است.</p> : null}
    </aside>
  );

  const item = sel?.kind === "item" ? draft.layout.tabs[sel.t]?.sections[sel.s]?.items[sel.i] : null;
  const itemAt = sel?.kind === "item" ? { t: sel.t, s: sel.s, i: sel.i } : null;
  const moves = itemAt ? (
    <MoveControls
      layout={draft.layout}
      at={itemAt}
      onShift={(d) => layoutEdit((x) => shiftItem(x.layout, itemAt, d))}
      onMoveTo={(t, s) => layoutEdit((x) => moveItem(x.layout, itemAt, { t, s }))}
    />
  ) : null;
  const libId = (name: string) => library.data?.fields.find((l) => l.name === name)?.id ?? null;
  let inspector: React.ReactNode;
  if (item && isFieldItem(item) && byName.get(item.field)) {
    const f = byName.get(item.field)!;
    const row = rows.data?.rows.find((r) => r.name === f.name && r.active !== false);
    inspector = (
      <SysFieldInspector
        table={table}
        tablePlural={def.plural}
        field={f}
        value={draft.fields[f.name]}
        editable={editable}
        libraryId={libId(f.name)}
        policies={access.settingsRead ? (policies.data ?? []) : null}
        onChange={(p) => setField(f.name, p)}
        onRemove={editable && access.customWrite && f.kind !== "module" && row ? () => removeField(f.name) : undefined}
        moves={moves}
      />
    );
  } else if (sel?.kind === "section") {
    inspector = (
      <SectionInspector
        layout={draft.layout}
        t={sel.t}
        s={sel.s}
        editable={editable}
        onChange={(p) => layoutEdit((d) => ({ layout: updateSection(d.layout, sel.t, sel.s, p as never) }), "label" in p ? `section:${sel.t}:${sel.s}` : undefined)}
        onShift={(d) => layoutEdit((x) => shiftSection(x.layout, sel.t, sel.s, d))}
        onRemove={() => layoutEdit((d) => {
          const layout = removeSection(d.layout, sel.t, sel.s);
          return { layout, sel: clampSel(layout, sel) };
        })}
      />
    );
  } else if (sel?.kind === "tab") {
    inspector = (
      <TabInspector
        layout={draft.layout}
        t={sel.t}
        editable={editable}
        onRename={(label) => layoutEdit((d) => ({ layout: renameTab(d.layout, sel.t, label) }), `tab:${sel.t}`)}
        onShift={(d) => layoutEdit((x) => shiftTab(x.layout, sel.t, d))}
        onRemove={() => layoutEdit((d) => {
          const layout = removeTab(d.layout, sel.t);
          return { layout, sel: clampSel(layout, sel) };
        })}
      />
    );
  } else {
    const hidden = Object.values(draft.fields).filter((o) => o.hidden).length;
    const required = fields.filter((f) => f.moduleRequired || draft.fields[f.name]?.requiredFor).length;
    inspector = (
      <Block title={`فرم ${def.plural}`}>
        <p className="rk-hint">
          {faDigits(fields.length)} فیلد، {faDigits(required)} الزامی، {faDigits(hidden)} پنهان در فرم
        </p>
        <p className="rk-hint">فیلد، بخش یا زبانه‌ای را برگزینید تا تنظیم‌هایش این‌جا بیاید. با Alt و پیکان بالا و پایین، فیلد برگزیده جابه‌جا می‌شود.</p>
      </Block>
    );
  }

  return (
    <div className="rk-admin wfm-page">
      {header}
      {problems.map((p) => (
        <Alert key={p} type="warning" showIcon title={p} />
      ))}
      <div className={preview ? "wfm-designer is-preview" : "wfm-designer"}>
        {preview ? null : palette}
        <DesignCanvas
          layout={draft.layout}
          describe={describe}
          selected={sel}
          onSelect={setSel}
          editable={editable}
          onMove={(from, to) => layoutEdit((d) => moveItem(d.layout, from, to))}
          onDropField={(name, to) => layoutEdit((d) => insertItem(d.layout, { field: name }, to))}
          onShift={(at, d) => layoutEdit((x) => shiftItem(x.layout, at, d))}
          onAddSection={(t) => layoutEdit((d) => addSection(d.layout, t))}
          onAddTab={() => layoutEdit((d) => addTab(d.layout))}
        />
        {preview ? previewPanel : <aside className="wfm-panel wfm-inspector" aria-label="تنظیم‌های برگزیده">{inspector}</aside>}
      </div>
      {newField && types.data ? (
        <FieldSheet
          id={null}
          entry={null}
          library={library.data?.fields ?? []}
          types={types.data}
          unit={unit.data ?? "rial"}
          access={access}
          onClose={() => setNewField(false)}
          onSaved={(id) => {
            setNewField(false);
            const made = qc.getQueryData<{ fields: LibraryEntry[] }>(FIELD_KEYS.library(orgId))?.fields.find((f) => f.id === id);
            if (made) void attach(made.id, made.label, false);
          }}
        />
      ) : null}
      {confirm ? (
        <Modal open title={`ذخیرهٔ فرم «${def.plural}»؟`} onCancel={() => setConfirm(null)} okText="ذخیره" cancelText="انصراف" onOk={save} okButtonProps={{ loading: busy }} width={560}>
          <div className="wfm-stack">
            <p className="rk-hint">این تغییرها به فرم همهٔ جاهایی می‌رسد که «{def.plural}» ثبت یا ویرایش می‌شود:</p>
            <ul className="wfm-diff">
              {confirm.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

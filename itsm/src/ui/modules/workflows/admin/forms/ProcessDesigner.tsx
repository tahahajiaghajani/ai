// A process form («فرم گردش‌کار», design F §3.2, §8.2; package F5): the palette (library fields not on the form — the
// demo pack's marked «نمایشی», and one added to the organisation's own form says the purge takes it out —, «فیلد
// تازه» through the library's own sheet, «یادداشت»), the canvas of tabs › sections › items on the form's grid (drag,
// or Alt+↑/↓; hidden items stay, dimmed), and the inspector: this form's label, help and width, the item's behaviour
// («الزامی»، «فقط‌خواندنی»، «پنهان») and «نمایش وقتی…» on the form's other fields; a section's columns; a note's text and
// tone. The draft saves itself (PATCH /forms/:id) once the server's own checks pass, with the state in the header
// («ذخیره شد، ۲ دقیقه پیش»), undo and redo; a running case keeps the snapshot of its version, so a change reaches
// cases with the next publish of a process. «پیش‌نمایش» splits the canvas with the saved form as a person sees it at a
// step that uses it (the step's rights) and from a viewpoint, sample values checked as a submission would be.
// Phones get the preview only.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { Alert, Button, Input, Select, Tooltip } from "antd";
import { Eye, NotebookPen, PencilRuler, Plus, Redo2, Search, Trash2, Undo2 } from "lucide-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FieldDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { cleanFormLayout, formValuesDef, isFieldItem, type FieldItem, type FormItem, type NoteItem } from "@shared/forms/layout";
import { faDigits } from "@shared/format";
import { errorText } from "../../../../lib/api";
import { useOrg } from "../../../../lib/org";
import { useDebounced, useIsPhone, useNotify } from "../../../../lib/hooks";
import { PageHeader } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { Field, Note } from "../../../../components/blocks";
import { useMe, useSchema } from "../../../../records/data/hooks";
import type { TableMeta } from "../../../../records/model/types";
import { DemoTag, RightsMatrix } from "../../kit";
import { FIELD_KEYS, fieldsApi, type LibraryEntry } from "../fields/api";
import { fieldsAccess, packFieldNotice } from "../fields/model";
import { FieldSheet } from "../fields/FieldSheet";
import { FORM_KEYS, formsApi, type FormDetail, type FormOut } from "./api";
import {
  VIEWPOINTS, addSection, addTab, autoSpan, clampSel, draftProblems, insertItem, itemMarks, libraryDef, moveItem, paletteFields, processDraft, processPatch,
  removeItem, removeSection, removeTab, renameTab, shiftItem, shiftSection, shiftTab, stepsUsing, targetSection, typingKey, updateItem, updateSection, behaviourOf,
  type ProcessDraft, type SaveState, type Sel,
} from "./model";
import { MoveControls, ProcessItemInspector, SectionInspector, TabInspector } from "./Inspectors";
import { Block, DesignCanvas, I14, I16, PreviewForm, SaveStatus, dragField, useHistory, useLeaveGuard, useUndoKeys, type PreviewTab } from "./parts";
import "../../../../records/records.css";
import "../fields/fields.css";
import "./forms.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProcessDesigner() {
  const { id = "" } = useParams<{ id: string }>();
  const org = useOrg();
  const { api, orgId } = org;
  const access = fieldsAccess(org);
  const detail = useQuery({ queryKey: FORM_KEYS.detail(orgId, id), queryFn: () => formsApi.get(api, id), enabled: access.designRead && UUID.test(id), retry: false });
  if (!access.designRead) return <EmptyState title="به «فرم‌ها» دسترسی ندارید" description="دیدن و تغییر فرم‌ها با طراحان فرم و گردش‌کار و مدیران تنظیمات سازمان است." />;
  if (detail.isLoading) return <Loader />;
  if (!detail.data) return <EmptyState title="فرم پیدا نشد" description={detail.error ? errorText(detail.error) : "این فرم دیگر نیست یا نشانی آن درست نیست."} />;
  return <Designer key={id} detail={detail.data} />;
}

function Designer({ detail }: { detail: FormDetail }) {
  const org = useOrg();
  const { api, orgId, writable } = org;
  const access = fieldsAccess(org);
  const phone = useIsPhone();
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { schema } = useSchema();
  const { tz } = useMe();
  const id = detail.form.id;
  const editable = detail.editable && writable && !phone;

  const hist = useHistory<ProcessDraft>(processDraft(detail.form));
  const draft = hist.value;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [saved, setSaved] = useState<FormOut>(detail.form);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const [state, setState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(detail.form.updated_at);
  const [sel, setSel] = useState<Sel | null>(null);
  const [preview, setPreview] = useState(false);
  const [q, setQ] = useState("");
  const [newField, setNewField] = useState(false);

  // definitions: the form's own (the server's), the preview's, and the library's list for fields just added
  // (the server's definitions only: a field just added shows the library's line until its next save brings them)
  const [defs, setDefs] = useState<Record<string, FieldDef>>(() => Object.fromEntries(Object.entries(detail.fields).flatMap(([k, v]) => (v.def ? [[k, v.def]] : []))));
  const defsRef = useRef(defs);
  defsRef.current = defs;
  const library = useQuery({ queryKey: FIELD_KEYS.library(orgId), queryFn: () => fieldsApi.library(api), staleTime: 30_000 });
  const types = useQuery({ queryKey: FIELD_KEYS.types(orgId), queryFn: () => fieldsApi.types(api), enabled: editable && access.designWrite, staleTime: 60_000 });
  const unit = useQuery({ queryKey: FIELD_KEYS.unit(orgId), queryFn: () => fieldsApi.moneyUnit(api), staleTime: 300_000 });
  const lib = useMemo(() => library.data?.fields ?? [], [library.data]);
  const libByName = useMemo(() => new Map(lib.map((e) => [e.name, e])), [lib]);
  const defOf = useCallback((name: string): FieldDef | undefined => defs[name] ?? (libByName.get(name) ? libraryDef(libByName.get(name)!) : undefined), [defs, libByName]);
  const retired = useMemo(() => new Set(lib.filter((e) => e.status === "retired").map((e) => e.name)), [lib]);
  const kept = useMemo(() => new Set(saved.fields), [saved.fields]);
  const problems = useMemo(() => draftProblems(draft, defOf, retired, kept), [draft, defOf, retired, kept]);
  const patch = useMemo(() => processPatch(saved, draft), [saved, draft]);

  // ------------------------------------------------------------------ autosave
  const queue = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const p = processPatch(savedRef.current, draftRef.current);
      if (!p) return setState("saved");
      setState("saving");
      try {
        const r = await formsApi.update(api, id, p);
        savedRef.current = r.form;
        setSaved(r.form);
        setSavedAt(r.form.updated_at ?? new Date().toISOString());
        setState(processPatch(r.form, draftRef.current) ? "pending" : "saved");
        void qc.invalidateQueries({ queryKey: FORM_KEYS.list(orgId) });
        // fields just added: their definitions as the form's snapshot will take them (options, checks)
        if (r.form.fields.some((name) => !defsRef.current[name])) {
          void formsApi.get(api, id).then((d) => setDefs((x) => ({ ...x, ...Object.fromEntries(Object.entries(d.fields).flatMap(([k, v]) => (v.def ? [[k, v.def]] : []))) })), () => undefined);
        }
      } catch (e) {
        setState("error");
        n.error(e, { key: `wfm-save-${id}` });
      }
    });
  }, [api, id, n, orgId, qc]);
  useEffect(() => {
    if (!editable) return;
    if (!patch) {
      setState((s) => (s === "saving" ? s : "saved"));
      return;
    }
    if (problems.length) return setState("invalid");
    setState((s) => (s === "saving" ? s : "pending"));
    const t = window.setTimeout(flush, 800);
    return () => window.clearTimeout(t);
  }, [patch, problems.length, editable, flush]);
  useLeaveGuard(editable && state !== "saved", `/${orgId}/settings/forms`);
  useUndoKeys(editable, hist.undo, hist.redo);

  // a change of the layout, and where the selection goes (`key`: typing on in one box is one step of undo)
  const edit = useCallback(
    (fn: (d: ProcessDraft) => { layout: ProcessDraft["layout"]; sel?: Sel | null }, key?: string) => {
      const d = draftRef.current;
      const r = fn(d);
      hist.set({ ...d, layout: r.layout }, key);
      if (r.sel !== undefined) setSel(r.sel);
    },
    [hist.set],
  );
  const add = (name: string, to?: { t: number; s: number; i?: number }) => {
    edit((d) => insertItem(d.layout, { field: name }, to ?? targetSection(d.layout, sel)));
    // one of the demo pack's fields on the organisation's own form: «حذف داده‌های نمایشی» takes it out again
    const notice = packFieldNotice(libByName.get(name), { form: detail });
    if (notice) n.warn(notice, { key: `wfm-pack-${name}` });
  };
  const addNote = () => edit((d) => insertItem(d.layout, { text: "یادداشت تازه", tone: "info" }, targetSection(d.layout, sel)));
  const remove = async () => {
    if (detail.usage.processes.length) return;
    if (!(await n.confirm(`حذف فرم «${saved.name}»؟`, "فرم از فهرست فرم‌ها برداشته می‌شود.", true))) return;
    try {
      await formsApi.remove(api, id);
      await qc.invalidateQueries({ queryKey: FORM_KEYS.all(orgId) });
      nav(`/${orgId}/settings/forms`);
    } catch (e) {
      n.error(e);
    }
  };

  // ------------------------------------------------------------------ the preview
  const [stepKey, setStepKey] = useState<string>("");
  const [as, setAs] = useState("me");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const sampled = useDebounced(values, 400);
  const sources = useQuery({ queryKey: FORM_KEYS.steps(orgId), queryFn: () => formsApi.processSources(api), enabled: preview || phone, staleTime: 60_000 });
  const steps = useMemo(() => (sources.data ? stepsUsing(id, sources.data) : []), [sources.data, id]);
  const step = steps.find((s) => s.key === stepKey) ?? null;
  const body = useMemo(() => ({ rights: step?.rights ?? null, as, values: Object.keys(sampled).length ? sampled : null }), [step, as, sampled]);
  const pv = useQuery({
    queryKey: FORM_KEYS.preview(orgId, id, saved.updated_at ?? "", JSON.stringify(body)),
    queryFn: () => formsApi.preview(api, id, body),
    enabled: preview || phone,
    placeholderData: keepPreviousData,
    retry: false,
  });
  useEffect(() => {
    if (pv.data?.fields) setDefs((x) => ({ ...x, ...pv.data!.fields }));
  }, [pv.data]);
  const valuesDef = useMemo(() => ({ ...formValuesDef(cleanFormLayout(draft.layout), defOf, saved.name), can: { read: true as const, create: true } }) as TableMeta, [draft.layout, defOf, saved.name]);
  const previewDef = useMemo(() => ({ ...formValuesDef(saved.layout, (nm: string) => pv.data?.fields[nm] ?? defOf(nm), saved.name), can: { read: true as const, create: true } }) as TableMeta, [saved.layout, pv.data, defOf, saved.name]);
  const tabs = useMemo<PreviewTab[]>(
    () =>
      (pv.data?.view.tabs ?? []).map((t) => ({
        label: t.label,
        sections: t.sections.map((s, si) => ({
          key: `${t.label}:${si}`,
          label: s.label,
          items: s.items.map((x) => (x.kind === "note" ? { kind: "note" as const, text: x.text, tone: x.tone } : { kind: "field" as const, name: x.name, field: x.field, right: x.right, span: x.span, label: x.label, help: x.help })),
        })),
      })),
    [pv.data],
  );
  const previewPanel = (
    <section className="wfm-panel wfm-preview" aria-label="پیش‌نمایش فرم">
      <div className="wfm-preview-bar">
        <h2 className="wfm-panel-t">پیش‌نمایش</h2>
        <Select
          size="small"
          value={stepKey}
          onChange={setStepKey}
          aria-label="مرحله"
          popupMatchSelectWidth={false}
          options={[{ value: "", label: "خود فرم (بی‌مرحله)" }, ...steps.map((s) => ({ value: s.key, label: s.label }))]}
        />
        <Select size="small" value={as} onChange={setAs} aria-label="دیدگاه" options={VIEWPOINTS} />
      </div>
      {!steps.length && sources.data ? <p className="rk-hint">هنوز مرحله‌ای از گردش‌کارها این فرم را به کار نمی‌برد؛ فرم با رفتار خودش نشان داده می‌شود.</p> : null}
      {step ? (
        <details className="wfm-step-rights">
          <summary className="rk-hint">حق‌های مرحلهٔ «{step.label}»</summary>
          <RightsMatrix form={saved.layout} fields={(nm: string) => pv.data?.fields[nm] ?? defOf(nm)} value={step.rights} stepLabel={step.label} />
        </details>
      ) : null}
      {pv.data?.publish_problems.length ? <Alert type="warning" showIcon title={`انتشار با این فرم پذیرفته نمی‌شود: ${pv.data.publish_problems.join("؛ ")}`} /> : null}
      {pv.error ? <Alert type="error" showIcon title={errorText(pv.error)} /> : null}
      {!schema || (!pv.data && pv.isLoading) ? (
        <Loader />
      ) : pv.data ? (
        <PreviewForm
          key={`${stepKey}|${as}`}
          tabs={tabs}
          def={previewDef}
          schema={schema}
          tz={tz}
          unit={unit.data ?? "rial"}
          values={values}
          onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))}
          problems={pv.data.check?.problems}
          idPrefix="wfm-pp"
        />
      ) : null}
      {editable && state !== "saved" ? <p className="rk-hint">پیش‌نمایش آخرین نسخهٔ ذخیره‌شده را نشان می‌دهد.</p> : null}
    </section>
  );

  const status =
    saved.status === "published" ? (
      <Chip tone="in">{`منتشرشده، نسخهٔ ${faDigits(saved.version_no)}`}</Chip>
    ) : (
      <Chip>پیش‌نویس</Chip>
    );
  const header = (
    <PageHeader
      back={`/${orgId}/settings/forms`}
      title={draft.name.trim() || saved.name}
      subtitle={
        <span className="wfm-toolbar">
          {status}
          {detail.demo ? <DemoTag title="فرم دادهٔ نمایشی" /> : null}
          {saved.changed ? <Chip tone="warning">تغییرهای منتشرنشده</Chip> : null}
          {editable ? <SaveStatus state={state} at={savedAt} problems={problems.length} onRetry={flush} /> : null}
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
            <Button type="primary" icon={preview ? <PencilRuler {...I16} /> : <Eye {...I16} />} onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
              {preview ? "طراحی" : "پیش‌نمایش"}
            </Button>
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

  // ------------------------------------------------------------------ palette, canvas, inspector
  const offered = paletteFields(lib, draft.layout, q);
  const palette = (
    <aside className="wfm-panel wfm-palette" aria-label="فیلدهای کتابخانه">
      <Input allowClear size="small" prefix={<Search {...I14} aria-hidden />} placeholder="جست‌وجوی فیلد" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی فیلد" />
      {editable ? (
        <span className="wfm-pal-actions">
          {access.designWrite ? (
            <Button size="small" icon={<Plus {...I14} />} onClick={() => setNewField(true)}>
              فیلد تازه
            </Button>
          ) : null}
          <Button size="small" icon={<NotebookPen {...I14} />} onClick={addNote}>
            یادداشت
          </Button>
        </span>
      ) : null}
      <Block title="کتابخانه">
        {library.isLoading ? (
          <Loader />
        ) : offered.length ? (
          <ul className="wfm-pal-list">
            {offered.slice(0, 80).map((e) => (
              <li key={e.id}>
                <button type="button" className="wfm-pal-item" draggable={editable} onDragStart={(ev: DragEvent) => dragField(ev, e.name)} onClick={() => editable && add(e.name)} disabled={!editable} aria-label={`افزودن ${e.label} به فرم`}>
                  {e.label}
                  {e.demo ? <DemoTag title="فیلد دادهٔ نمایشی" /> : null}
                  <small>{e.type_label}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rk-hint">{lib.length ? "همهٔ فیلدهای کتابخانه در این فرم هستند." : "هنوز فیلدی در کتابخانه نیست."}</p>
        )}
      </Block>
    </aside>
  );

  const describe = (item: FormItem) => {
    if (!isFieldItem(item)) return { label: item.text, meta: item.tone === "warning" ? "یادداشت هشدار" : "یادداشت", span: 24, note: item.tone ?? "info" };
    const d = defOf(item.field);
    const e = libByName.get(item.field);
    const columns = sectionColumns(item);
    return {
      label: item.label || d?.label || item.field,
      meta: [e?.type_label ?? (d ? FIELD_TYPES[d.type]?.label : "فیلد ناشناخته"), ...itemMarks(item), ...(retired.has(item.field) ? ["بازنشسته"] : []), ...(e?.demo ? ["نمایشی"] : [])].join(" · "),
      span: item.span ?? autoSpan(d?.type, columns),
      required: behaviourOf(item) === "required",
      dim: behaviourOf(item) === "hidden",
    };
  };
  function sectionColumns(item: FieldItem): 1 | 2 | undefined {
    for (const t of draft.layout.tabs) for (const s of t.sections) if (s.items.includes(item)) return s.columns;
    return undefined;
  }

  const item = sel?.kind === "item" ? draft.layout.tabs[sel.t]?.sections[sel.s]?.items[sel.i] : null;
  const itemAt = sel?.kind === "item" ? { t: sel.t, s: sel.s, i: sel.i } : null;
  const moves = itemAt ? (
    <MoveControls layout={draft.layout} at={itemAt} onShift={(d) => edit((x) => shiftItem(x.layout, itemAt, d))} onMoveTo={(t, s) => edit((x) => moveItem(x.layout, itemAt, { t, s }))} />
  ) : null;
  let inspector: React.ReactNode;
  if (item && itemAt) {
    const e = isFieldItem(item) ? libByName.get(item.field) : undefined;
    inspector = (
      <ProcessItemInspector
        item={item as FieldItem | NoteItem}
        def={isFieldItem(item) ? (defOf(item.field) ?? null) : null}
        library={e ? { id: e.id, type_label: e.type_label, status: e.status } : null}
        columns={draft.layout.tabs[itemAt.t]?.sections[itemAt.s]?.columns}
        editable={editable}
        valuesDef={valuesDef}
        schema={schema}
        onChange={(x) => edit((d) => ({ layout: updateItem(d.layout, itemAt, x) }), typingKey(`item:${itemAt.t}:${itemAt.s}:${itemAt.i}`, item, x))}
        onRemove={() => edit((d) => {
          const layout = removeItem(d.layout, itemAt);
          return { layout, sel: clampSel(layout, sel) };
        })}
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
        columns
        onChange={(p) => edit((d) => ({ layout: updateSection(d.layout, sel.t, sel.s, p as never) }), "label" in p ? `section:${sel.t}:${sel.s}` : undefined)}
        onShift={(d) => edit((x) => shiftSection(x.layout, sel.t, sel.s, d))}
        onRemove={async () => {
          const count = draft.layout.tabs[sel.t]?.sections[sel.s]?.items.length ?? 0;
          if (count && !(await n.confirm("حذف بخش و همهٔ اجزای آن؟", `${faDigits(count)} جزء از فرم برداشته می‌شود؛ با «واگرد» برمی‌گردد.`, true))) return;
          edit((d) => {
            const layout = removeSection(d.layout, sel.t, sel.s);
            return { layout, sel: clampSel(layout, sel) };
          });
        }}
      />
    );
  } else if (sel?.kind === "tab") {
    inspector = (
      <TabInspector
        layout={draft.layout}
        t={sel.t}
        editable={editable}
        onRename={(label) => edit((d) => ({ layout: renameTab(d.layout, sel.t, label) }), `tab:${sel.t}`)}
        onShift={(d) => edit((x) => shiftTab(x.layout, sel.t, d))}
        onRemove={async () => {
          if (!(await n.confirm("حذف زبانه و همهٔ بخش‌های آن؟", "اجزای این زبانه از فرم برداشته می‌شوند؛ با «واگرد» برمی‌گردند.", true))) return;
          edit((d) => {
            const layout = removeTab(d.layout, sel.t);
            return { layout, sel: clampSel(layout, sel) };
          });
        }}
      />
    );
  } else {
    inspector = (
      <Block title="فرم">
        <Field label="نام فرم" htmlFor="wfm-form-name">
          <Input id="wfm-form-name" value={draft.name} onChange={(e) => hist.set({ ...draftRef.current, name: e.target.value }, "form:name")} maxLength={120} disabled={!editable} />
        </Field>
        <Field label="شرح" htmlFor="wfm-form-desc">
          <Input.TextArea id="wfm-form-desc" value={draft.description} onChange={(e) => hist.set({ ...draftRef.current, description: e.target.value }, "form:description")} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} disabled={!editable} />
        </Field>
        <Field label="به کار رفته در">
          {detail.usage.processes.length ? (
            <ul className="wfm-policies">
              {detail.usage.processes.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <span className="rk-hint">هنوز گردش‌کاری این فرم را به کار نمی‌برد.</span>
          )}
        </Field>
        <p className="rk-hint">حق دیدن و تغییر هر فیلد در هر مرحله را طراح گردش‌کار تعیین می‌کند؛ تغییر این فرم با انتشار بعدی گردش‌کار به پرونده‌ها می‌رسد.</p>
        {editable ? (
          <Tooltip title={detail.usage.processes.length ? "فرمی که گردش‌کاری به کار می‌برد حذف نمی‌شود" : undefined}>
            <Button size="small" danger icon={<Trash2 {...I14} />} disabled={!!detail.usage.processes.length} onClick={remove} className="self-start">
              حذف فرم
            </Button>
          </Tooltip>
        ) : null}
      </Block>
    );
  }

  return (
    <div className="rk-admin wfm-page">
      {header}
      {problems.length && editable ? <Alert type="warning" showIcon title={`ذخیره نمی‌شود: ${problems.join("؛ ")}`} /> : null}
      <div className={preview ? "wfm-designer is-preview" : "wfm-designer"}>
        {preview ? null : palette}
        {draft.layout.tabs.length ? (
          <DesignCanvas
            layout={draft.layout}
            describe={describe}
            sectionMeta={(t, s) => (draft.layout.tabs[t].sections[s].columns === 1 ? "یک ستون" : "دو ستون")}
            selected={sel}
            onSelect={setSel}
            editable={editable}
            onMove={(from, to) => edit((d) => moveItem(d.layout, from, to))}
            onDropField={(name, to) => add(name, to)}
            onShift={(at, d) => edit((x) => shiftItem(x.layout, at, d))}
            onRemove={(at) => edit((d) => {
              const layout = removeItem(d.layout, at);
              return { layout, sel: clampSel(layout, { kind: "item", ...at }) };
            })}
            onAddSection={(t) => edit((d) => addSection(d.layout, t))}
            onAddTab={() => edit((d) => addTab(d.layout))}
          />
        ) : (
          <div className="wfm-panel">
            <EmptyState
              compact
              title="فرم هنوز خالی است"
              description={editable ? "فیلدی از کتابخانه برگزینید یا زبانه‌ای بسازید." : undefined}
              action={editable ? <Button onClick={() => edit((d) => addTab(d.layout))}>زبانهٔ نخست</Button> : undefined}
            />
          </div>
        )}
        {preview ? previewPanel : <aside className="wfm-panel wfm-inspector" aria-label="تنظیم‌های برگزیده">{inspector}</aside>}
      </div>
      {newField && types.data ? (
        <FieldSheet
          id={null}
          entry={null}
          library={lib}
          types={types.data}
          unit={unit.data ?? "rial"}
          access={access}
          onClose={() => setNewField(false)}
          onSaved={(newId) => {
            setNewField(false);
            const made = qc.getQueryData<{ fields: LibraryEntry[] }>(FIELD_KEYS.library(orgId))?.fields.find((f) => f.id === newId);
            if (made) add(made.name);
          }}
        />
      ) : null}
    </div>
  );
}

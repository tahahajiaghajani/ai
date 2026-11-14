// «تنظیمات گردش‌کار» (design F §3.5, §8.4 «Process settings», package F6): the process's name, key, category and
// description; its managers, manager groups and confidentiality — who reads and manages its cases, which take effect
// on the next publish and reach every case of the process («با انتشار بعدی اعمال می‌شود»); who may start it (the
// person's own positions — anywhere or in a fixed unit — groups, access roles or named people: what «شروع» is offered
// by; «فقط این نقش‌ها و افراد» without a rule says it still means every member), the title of its cases (pills of the
// start form's fields and the requester) and «درخواست‌دهنده چه می‌بیند». Every change is part of the draft (undo,
// autosave).
import { useEffect, useId, useRef, useState } from "react";
import { Button, Checkbox, Drawer, Input, Radio, Select, type InputRef } from "antd";
import type { AssigneeRule } from "@shared/process";
import { faDigits } from "@shared/format";
import { Note } from "../../../../components/blocks";
import { RecordSelect, UserSelect } from "../../../../records/fields/RecordSelect";
import { useSheetSize } from "../fields/parts";
import { AssigneeRules } from "../../kit";
import type { ProcessDraft, ProcessOut } from "./api";
import { STARTER_SCOPE, insertText, nameProblem, requesterViewOptions, startersNote, titleSample, type CaseField, type DesignerDraft } from "./model";
import { F, PillMenu } from "./parts";

export interface SettingsProps {
  value: DesignerDraft;
  onChange: (next: DesignerDraft, key?: string) => void;
  editable: boolean;
  process: ProcessOut;
  /** every value of the case (the process's forms) */
  fields: CaseField[];
  /** what a title may name: the start form's fields, the requester, «برای چه کسی» */
  titleFields: { name: string; label: string }[];
  /** the start form's fields (always read by the requester) */
  startFields: { name: string; label: string }[];
  /** what the next publish changes in the access settings (F4c's diff of the saved draft; null: nothing published yet) */
  access: string[] | null;
  /** the section to show first */
  focus?: string | null;
  onClose: () => void;
}

export function ProcessSettings({ value, onChange, editable, process, fields, titleFields, startFields, access, focus, onClose }: SettingsProps) {
  const uid = useId();
  const size = useSheetSize(560);
  const draft = value.draft;
  const off = !editable;
  const set = (patch: Partial<ProcessDraft>, key?: string) => onChange({ ...value, draft: { ...draft, ...patch } }, key);
  const [some, setSome] = useState(draft.starters.length > 0);
  const title = useRef<InputRef>(null);
  const labels = new Map(titleFields.map((f) => [f.name, f.label]));
  const sample = titleSample(draft.title_template, (k) => labels.get(k), value.name || process.name);
  const viewOptions = requesterViewOptions(fields, startFields).map((f) => ({ value: f.name, label: f.label }));
  useEffect(() => {
    if (!focus) return;
    const at = focus === "manager_groups" ? "managers" : focus;
    const t = window.setTimeout(() => document.getElementById(`${uid}-${at}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 120);
    return () => window.clearTimeout(t);
  }, [focus, uid]);

  const putPill = (pill: string) => {
    const el = title.current?.input;
    const text = draft.title_template ?? "";
    const r = insertText(text, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length, pill);
    set({ title_template: r.value || null });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  };

  return (
    <Drawer open size={size} placement="left" title="تنظیمات گردش‌کار" onClose={onClose} destroyOnHidden footer={<div className="wff-foot"><span className="wff-foot-gap" /><Button onClick={onClose}>بستن</Button></div>}>
      <div className="wfp-settings">
        <section aria-labelledby={`${uid}-about-h`} id={`${uid}-about`}>
          <h3 className="wfp-sub" id={`${uid}-about-h`}>
            درباره
          </h3>
          <F label="نام" htmlFor={`${uid}-name`} error={nameProblem(value.name) || undefined}>
            <Input id={`${uid}-name`} value={value.name} maxLength={120} disabled={off} onChange={(e) => onChange({ ...value, name: e.target.value }, "settings:name")} />
          </F>
          <F label="کلید" htmlFor={`${uid}-key`} hint="پس از ساخت تغییر نمی‌کند.">
            <Input id={`${uid}-key`} value={process.key} dir="ltr" className="ds-mono" readOnly disabled />
          </F>
          <F label="دسته" htmlFor={`${uid}-category`}>
            <Input id={`${uid}-category`} value={value.category} maxLength={80} disabled={off} placeholder="مالی، منابع انسانی…" onChange={(e) => onChange({ ...value, category: e.target.value }, "settings:category")} />
          </F>
          <F label="شرح" htmlFor={`${uid}-description`}>
            <Input.TextArea id={`${uid}-description`} value={value.description} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} disabled={off} onChange={(e) => onChange({ ...value, description: e.target.value }, "settings:description")} />
          </F>
        </section>

        <section aria-labelledby={`${uid}-managers-h`} id={`${uid}-managers`}>
          <h3 className="wfp-sub" id={`${uid}-managers-h`}>
            مسئولان و دسترسی
          </h3>
          <F label="مسئولان گردش‌کار" htmlFor={`${uid}-mgr`} hint="پرونده‌های متوقف و مرحله‌های بی‌انجام‌دهنده به آن‌ها می‌رسد و همهٔ پرونده‌های این گردش‌کار را می‌بینند.">
            <UserSelect id={`${uid}-mgr`} multiple value={draft.managers} disabled={off} onChange={(v) => set({ managers: ((v as string[] | null) ?? []).map((x) => x.toLowerCase()) })} />
          </F>
          <F label="گروه‌های مسئول" htmlFor={`${uid}-groups`}>
            <RecordSelect id={`${uid}-groups`} table="group" multiple value={draft.manager_groups} disabled={off} onChange={(v) => set({ manager_groups: ((v as string[] | null) ?? []).map((x) => x.toLowerCase()) })} />
          </F>
          <Checkbox checked={draft.confidential} disabled={off} onChange={(e) => set({ confidential: e.target.checked })}>
            محرمانه: پرونده‌ها را فقط درخواست‌دهنده، انجام‌دهندگان مرحله‌ها و مسئولان می‌بینند
          </Checkbox>
          {draft.confidential && !draft.managers.length && !draft.manager_groups.length ? <Note tone="warning">گردش‌کار محرمانه دست‌کم یک مسئول یا گروه مسئول می‌خواهد.</Note> : null}
          {access?.length ? (
            <Note>
              <strong>با انتشار بعدی اعمال می‌شود و به همهٔ پرونده‌های این گردش‌کار می‌رسد:</strong>
              <ul className="wfh-diff">
                {access.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Note>
          ) : null}
        </section>

        <section aria-labelledby={`${uid}-starters-h`} id={`${uid}-starters`}>
          <h3 className="wfp-sub" id={`${uid}-starters-h`}>
            آغاز پرونده
          </h3>
          <F label="چه کسانی آغاز می‌کنند">
            <Radio.Group
              value={some ? "some" : "all"}
              disabled={off}
              onChange={(e) => {
                const next = e.target.value === "some";
                setSome(next);
                if (!next) set({ starters: [] });
              }}
              options={[
                { value: "all", label: "همهٔ اعضای سازمان" },
                { value: "some", label: "فقط این نقش‌ها و افراد" },
              ]}
            />
          </F>
          {some ? (
            <AssigneeRules
              value={draft.starters}
              onChange={off ? undefined : (starters: AssigneeRule[]) => set({ starters })}
              plain
              scope={STARTER_SCOPE}
              addLabel={draft.starters.length ? "قاعدهٔ دیگر" : "افزودن قاعده"}
            />
          ) : null}
          {startersNote(draft.starters, some) ? <Note tone="warning">{startersNote(draft.starters, some)}</Note> : null}
          <span id={`${uid}-title_template`} />
          <F
            label="عنوان پرونده‌ها"
            htmlFor={`${uid}-title`}
            extra={editable ? <PillMenu fields={titleFields} meta={false} onPick={putPill} /> : undefined}
            hint={<span>نمونه: {sample}</span>}
          >
            <Input id={`${uid}-title`} ref={title} value={draft.title_template ?? ""} maxLength={300} disabled={off} placeholder="خالی: نام گردش‌کار" onChange={(e) => set({ title_template: e.target.value || null }, "settings:title")} />
          </F>
          <span id={`${uid}-requester_view`} />
          <F label="درخواست‌دهنده چه می‌بیند" htmlFor={`${uid}-view`} hint={`فیلدهای فرم «ثبت درخواست»${startFields.length ? ` (${faDigits(startFields.length)} فیلد)` : ""} را همیشه می‌بیند؛ از فیلدهای دیگر هرچه را باید ببیند برگزینید.`}>
            <Select id={`${uid}-view`} mode="multiple" value={draft.requester_view} disabled={off} placeholder="فیلدی برگزینید" options={viewOptions} onChange={(v) => set({ requester_view: v })} showSearch={{ optionFilterProp: "label" }} />
          </F>
        </section>
      </div>
    </Drawer>
  );
}

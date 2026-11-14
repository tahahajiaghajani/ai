// The inspectors of the form designers (design F §8.2): a tab, a section, the moves of an item, a field of a table's
// default form (its label, help and sample text as overrides, «پنهان در فرم», «الزامی برای…» with the creation paths it
// binds, the lock chips with their reasons, the UI policies that act on it) and an item of a process form (this form's
// label, help and width, its behaviour, «نمایش وقتی…», a note's text and tone). Every control has a Persian label;
// read-only without `editable`.
import { Link } from "react-router";
import { Alert, Button, Input, Radio, Select, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Check, ExternalLink, Trash2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { isFieldItem, type FieldItem, type FormLayoutV2, type NoteItem, type Span } from "@shared/forms/layout";
import { REQUIRED_FOR_LABELS, type RequiredFor } from "@shared/forms/paths";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { Chip, Loader } from "../../../../components/display";
import { FilterBuilder } from "../../../../records/filter/FilterBuilder";
import type { Schema } from "../../../../records/model/schema";
import { newRecordPath, recordPath } from "../../../../records/extensions";
import { F } from "../fields/parts";
import { FIELD_KEYS, fieldsApi } from "../fields/api";
import type { PolicyRow } from "./api";
import {
  BEHAVIOURS, SPAN_OPTIONS, SYS_KIND_LABELS, autoSpan, behaviourOf, groupLabel, hideBlocker, ownTexts, requireBlocker, sectionList, withBehaviour,
  type Behaviour, type SysField, type SysOverride,
} from "./model";
import { Block, I14, LockChips } from "./parts";

// ---------------------------------------------------------------------------------------------------------------
// Tabs, sections, moves

export function TabInspector({ layout, t, editable, onRename, onShift, onRemove }: { layout: FormLayoutV2; t: number; editable: boolean; onRename: (label: string) => void; onShift: (d: -1 | 1) => void; onRemove: () => void }) {
  const tab = layout.tabs[t];
  if (!tab) return null;
  const fields = tab.sections.reduce((n, s) => n + s.items.filter(isFieldItem).length, 0);
  return (
    <Block title="زبانه">
      <F label="نام زبانه" htmlFor="wfm-tab-label">
        <Input id="wfm-tab-label" value={tab.label} onChange={(e) => onRename(e.target.value)} maxLength={80} disabled={!editable} />
      </F>
      <p className="rk-hint">
        {faDigits(tab.sections.length)} بخش، {faDigits(fields)} فیلد
      </p>
      {editable ? (
        <div className="wfm-moves">
          <Button size="small" icon={<ArrowUp {...I14} />} disabled={t === 0} onClick={() => onShift(-1)}>
            زبانهٔ قبل
          </Button>
          <Button size="small" icon={<ArrowDown {...I14} />} disabled={t === layout.tabs.length - 1} onClick={() => onShift(1)}>
            زبانهٔ بعد
          </Button>
          <Tooltip title={layout.tabs.length === 1 ? "فرم دست‌کم یک زبانه دارد" : undefined}>
            <Button size="small" danger icon={<Trash2 {...I14} />} disabled={layout.tabs.length === 1} onClick={onRemove}>
              حذف زبانه
            </Button>
          </Tooltip>
        </div>
      ) : null}
    </Block>
  );
}

export function SectionInspector({
  layout, t, s, editable, columns, onChange, onShift, onRemove,
}: {
  layout: FormLayoutV2;
  t: number;
  s: number;
  editable: boolean;
  /** process forms: one or two columns */
  columns?: boolean;
  onChange: (patch: { label?: string | null; columns?: 1 | 2 | null }) => void;
  onShift: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const sec = layout.tabs[t]?.sections[s];
  if (!sec) return null;
  const all = sectionList(layout);
  const at = all.findIndex((x) => x.t === t && x.s === s);
  return (
    <Block title="بخش">
      <F label="نام بخش" htmlFor="wfm-sec-label" hint="خالی: بخش بی‌نام">
        <Input id="wfm-sec-label" value={sec.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} maxLength={80} disabled={!editable} />
      </F>
      {columns ? (
        <F label="ستون‌ها">
          <Radio.Group
            value={sec.columns ?? 2}
            onChange={(e) => onChange({ columns: e.target.value })}
            disabled={!editable}
            options={[
              { value: 1, label: "یک ستون" },
              { value: 2, label: "دو ستون" },
            ]}
          />
        </F>
      ) : null}
      {editable ? (
        <div className="wfm-moves">
          <Button size="small" icon={<ArrowUp {...I14} />} disabled={at <= 0} onClick={() => onShift(-1)}>
            بالاتر
          </Button>
          <Button size="small" icon={<ArrowDown {...I14} />} disabled={at >= all.length - 1} onClick={() => onShift(1)}>
            پایین‌تر
          </Button>
          <Button size="small" danger icon={<Trash2 {...I14} />} onClick={onRemove}>
            حذف بخش
          </Button>
        </div>
      ) : null}
    </Block>
  );
}

/** «بالاتر»، «پایین‌تر» and «انتقال به…» of an item (Alt+↑/↓ on the canvas does the same). */
export function MoveControls({ layout, at, onShift, onMoveTo }: { layout: FormLayoutV2; at: { t: number; s: number; i: number }; onShift: (d: -1 | 1) => void; onMoveTo: (t: number, s: number) => void }) {
  const all = sectionList(layout);
  const here = all.findIndex((x) => x.t === at.t && x.s === at.s);
  const last = (layout.tabs[at.t]?.sections[at.s]?.items.length ?? 1) - 1;
  return (
    <div className="wfm-moves">
      <Button size="small" icon={<ArrowUp {...I14} />} disabled={here === 0 && at.i === 0} onClick={() => onShift(-1)}>
        بالاتر
      </Button>
      <Button size="small" icon={<ArrowDown {...I14} />} disabled={here === all.length - 1 && at.i === last} onClick={() => onShift(1)}>
        پایین‌تر
      </Button>
      {all.length > 1 ? (
        <Select
          size="small"
          value={null}
          placeholder="انتقال به…"
          aria-label="انتقال به بخش"
          options={all.filter((x) => x.t !== at.t || x.s !== at.s).map((x) => ({ value: `${x.t}:${x.s}`, label: x.label }))}
          onChange={(v: string | null) => {
            if (!v) return;
            const [t, s] = v.split(":").map(Number);
            onMoveTo(t, s);
          }}
          popupMatchSelectWidth={false}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A field of a table's default form

export interface SysFieldInspectorProps {
  table: string;
  tablePlural: string;
  field: SysField;
  value: SysOverride;
  editable: boolean;
  /** the library field's id (its sheet in «فیلدها») */
  libraryId: string | null;
  policies: PolicyRow[] | null;
  onChange: (patch: Partial<SysOverride>) => void;
  /** an organisation field leaves the table (its values stay in the records) */
  onRemove?: () => void;
  moves: React.ReactNode;
}

export function SysFieldInspector({ table, tablePlural, field: f, value: o, editable, libraryId, policies, onChange, onRemove, moves }: SysFieldInspectorProps) {
  const { orgId } = useOrg();
  const texts = editable && ownTexts(f);
  const hb = hideBlocker(f, o);
  const rb = requireBlocker(f, o);
  const choice: RequiredFor | "none" = o.requiredFor ?? "none";
  const acting = (policies ?? []).filter((p) => p.actions.some((a) => a.field === f.name));
  return (
    <Block title={o.label || f.label}>
      <span className="wfm-facts">
        <span>{SYS_KIND_LABELS[f.kind]}</span>
        <span>· {FIELD_TYPES[f.type]?.label ?? f.type}</span>
        <bdi dir="ltr" className="ds-mono">
          {f.name}
        </bdi>
        {f.group ? <Chip tone="info">{groupLabel(f.group)}</Chip> : null}
      </span>
      <LockChips locks={f.locks} />
      <F label="برچسب" htmlFor="wfm-f-label" hint={f.defaultLabel && f.defaultLabel !== o.label ? `برچسب ماژول: ${f.defaultLabel}` : undefined}>
        <Input id="wfm-f-label" value={o.label} placeholder={f.defaultLabel ?? undefined} onChange={(e) => onChange({ label: e.target.value })} maxLength={80} disabled={!texts} />
      </F>
      <F label="راهنما" htmlFor="wfm-f-help">
        <Input.TextArea id="wfm-f-help" value={o.help} onChange={(e) => onChange({ help: e.target.value })} maxLength={300} autoSize={{ minRows: 1, maxRows: 4 }} disabled={!texts} />
      </F>
      <F label="متن نمونه" htmlFor="wfm-f-ph">
        <Input id="wfm-f-ph" value={o.placeholder} onChange={(e) => onChange({ placeholder: e.target.value })} maxLength={120} disabled={!texts} />
      </F>
      {f.kind === "library" ? (
        <p className="rk-hint">
          برچسب، راهنما و متن نمونهٔ فیلد کتابخانه در «فیلدها» تغییر می‌کند و به همهٔ جدول‌هایش می‌رسد.{" "}
          {libraryId ? (
            <Link className="ds-link" to={`/${orgId}/settings/fields?tab=library&field=${libraryId}`}>
              باز کردن در کتابخانه
            </Link>
          ) : null}
        </p>
      ) : null}
      <F label="پنهان در فرم" hint={hb && !o.hidden ? hb : "فیلد در فهرست‌ها، پالایه‌ها و خروجی می‌ماند"}>
        <Switch checked={o.hidden} onChange={(v) => onChange({ hidden: v })} disabled={!editable || (!o.hidden && !!hb)} aria-label="پنهان در فرم" />
      </F>
      <F label="الزامی برای…" hint={f.moduleRequired ? "ماژول آن را الزامی می‌خواهد" : rb && !o.requiredFor ? rb : undefined}>
        <Radio.Group
          value={f.moduleRequired ? "none" : choice}
          onChange={(e) => onChange({ requiredFor: e.target.value === "none" ? null : (e.target.value as RequiredFor) })}
          disabled={!editable || f.moduleRequired || (!o.requiredFor && !!rb)}
          options={[
            { value: "none", label: "اختیاری" },
            { value: "all", label: REQUIRED_FOR_LABELS.all },
            { value: "agents", label: REQUIRED_FOR_LABELS.agents },
          ]}
        />
      </F>
      {o.requiredFor && !f.moduleRequired ? <CreationPaths table={table} plural={tablePlural} requiredFor={o.requiredFor} /> : null}
      {policies ? (
        <F label="شرط‌ها">
          {acting.length ? (
            <ul className="wfm-policies">
              {acting.map((p) => (
                <li key={p.id}>
                  <Link className="ds-link" to={`/${orgId}/${recordPath("ui_policy", p.id)}`}>
                    {p.name}
                  </Link>
                  {p.active ? null : <span className="rk-hint"> (خاموش)</span>}
                </li>
              ))}
            </ul>
          ) : (
            <span className="rk-hint">سیاست فرمی این فیلد را جابه‌جا نمی‌کند.</span>
          )}
          {editable ? (
            <Link className="ds-link wfm-moves" to={`/${orgId}/${newRecordPath("ui_policy")}?table_key=${table}&name=${encodeURIComponent(`شرط «${o.label || f.label}»`)}`}>
              <ExternalLink {...I14} aria-hidden />
              سیاست فرم تازه برای این فیلد
            </Link>
          ) : null}
        </F>
      ) : null}
      {editable ? moves : null}
      {onRemove ? (
        <div className="wfm-moves">
          <Button size="small" danger icon={<Trash2 {...I14} />} onClick={onRemove}>
            حذف از جدول
          </Button>
        </div>
      ) : null}
    </Block>
  );
}

/** The creation paths a requirement binds («بررسی می‌شود») and the ones it does not, with what blocks it (§3.3). */
export function CreationPaths({ table, plural, requiredFor }: { table: string; plural: string; requiredFor: RequiredFor }) {
  const { api, orgId } = useOrg();
  const paths = useQuery({ queryKey: FIELD_KEYS.paths(orgId, table, requiredFor), queryFn: () => fieldsApi.paths(api, table, requiredFor), staleTime: 60_000 });
  if (paths.isLoading) return <Loader />;
  if (!paths.data) return null;
  return (
    <div className="wfm-stack">
      <p className="rk-hint">این الزام فقط ثبت‌های افراد را می‌سنجد. مسیرهای ساخت «{plural}»:</p>
      <ul className="wfm-paths" aria-label="مسیرهای ساخت رکورد">
        {paths.data.effects.map((e) => (
          <li key={e.path.key} className={e.checked ? "is-on" : "is-off"}>
            {e.checked ? <Check {...I14} aria-label="بررسی می‌شود" /> : <X {...I14} aria-label="بررسی نمی‌شود" />}
            <span>{e.path.label}</span>
            <span className="rk-hint">{e.text}</span>
          </li>
        ))}
      </ul>
      {paths.data.blockers.map((b) => (
        <Alert key={b} type="warning" showIcon title={b} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// An item of a process form

export interface ProcessItemInspectorProps {
  item: FieldItem | NoteItem;
  /** the field's definition (from the library or the form's snapshot) */
  def: FieldDef | null;
  /** the library field's id, type label and status */
  library: { id: string; type_label: string; status: string } | null;
  columns: 1 | 2 | undefined;
  editable: boolean;
  /** the form's own fields, for «نمایش وقتی…» */
  valuesDef: import("@shared/model/types").TableDef;
  schema: Schema | undefined;
  onChange: (item: FieldItem | NoteItem) => void;
  onRemove: () => void;
  moves: React.ReactNode;
}

export function ProcessItemInspector({ item, def, library, columns, editable, valuesDef, schema, onChange, onRemove, moves }: ProcessItemInspectorProps) {
  const { orgId } = useOrg();
  if (!isFieldItem(item)) {
    return (
      <Block title="یادداشت">
        <F label="متن یادداشت" htmlFor="wfm-note-text">
          <Input.TextArea id="wfm-note-text" value={item.text} onChange={(e) => onChange({ ...item, text: e.target.value })} maxLength={500} autoSize={{ minRows: 2, maxRows: 6 }} disabled={!editable} />
        </F>
        <F label="لحن">
          <Radio.Group
            value={item.tone ?? "info"}
            onChange={(e) => onChange({ ...item, tone: e.target.value })}
            disabled={!editable}
            options={[
              { value: "info", label: "آگاهی" },
              { value: "warning", label: "هشدار" },
            ]}
          />
        </F>
        {editable ? moves : null}
        {editable ? (
          <div className="wfm-moves">
            <Button size="small" danger icon={<Trash2 {...I14} />} onClick={onRemove}>
              حذف یادداشت
            </Button>
          </div>
        ) : null}
      </Block>
    );
  }
  const name = def?.label ?? item.field;
  const set = (patch: Partial<FieldItem>) => onChange({ ...item, ...patch });
  const auto = autoSpan(def?.type, columns);
  // a condition may read the form's other fields, never the field it shows
  const condDef = { ...valuesDef, fields: valuesDef.fields.filter((f) => f.name !== item.field) };
  return (
    <Block title={item.label || name}>
      <span className="wfm-facts">
        {library ? <span>{library.type_label}</span> : def ? <span>{FIELD_TYPES[def.type]?.label ?? def.type}</span> : null}
        <bdi dir="ltr" className="ds-mono">
          {item.field}
        </bdi>
        {def?.group ? <Chip tone="info">{groupLabel(def.group as never)}</Chip> : null}
        {library?.status === "retired" ? <Chip tone="warning">بازنشسته</Chip> : null}
      </span>
      <F label="برچسب در این فرم" htmlFor="wfm-i-label" hint={`خالی: «${name}»`}>
        <Input id="wfm-i-label" value={item.label ?? ""} placeholder={name} onChange={(e) => set({ label: e.target.value || undefined })} maxLength={80} disabled={!editable} />
      </F>
      <F label="راهنما در این فرم" htmlFor="wfm-i-help">
        <Input.TextArea id="wfm-i-help" value={item.help ?? ""} placeholder={def?.help} onChange={(e) => set({ help: e.target.value || undefined })} maxLength={300} autoSize={{ minRows: 1, maxRows: 4 }} disabled={!editable} />
      </F>
      <F label="پهنا" htmlFor="wfm-i-span">
        <Select
          id="wfm-i-span"
          value={item.span ?? 0}
          onChange={(v: number) => set({ span: v ? (v as Span) : undefined })}
          disabled={!editable}
          options={[{ value: 0, label: `خودکار (${SPAN_OPTIONS.find((o) => o.value === auto)?.label})` }, ...SPAN_OPTIONS]}
        />
      </F>
      <F label="رفتار در این فرم" hint="حق هر مرحله در طراحی گردش‌کار تعیین می‌شود؛ این‌جا رفتار پیش‌فرض فرم است">
        <Radio.Group value={behaviourOf(item)} onChange={(e) => onChange(withBehaviour(item, e.target.value as Behaviour))} disabled={!editable} options={BEHAVIOURS} />
      </F>
      <F label="نمایش وقتی…" hint="خالی: همیشه دیده می‌شود">
        {schema ? (
          <FilterBuilder def={condDef} schema={schema} value={(item.showIf as Cond | undefined) ?? null} onChange={(c) => set({ showIf: c ?? undefined })} disabled={!editable} walk={false} noSummary />
        ) : (
          <Loader />
        )}
      </F>
      {library ? (
        <Link className="ds-link wfm-moves" to={`/${orgId}/settings/fields?tab=library&field=${library.id}`}>
          <ExternalLink {...I14} aria-hidden />
          باز کردن در کتابخانه
        </Link>
      ) : null}
      {editable ? moves : null}
      {editable ? (
        <div className="wfm-moves">
          <Button size="small" danger icon={<Trash2 {...I14} />} onClick={onRemove}>
            برداشتن از فرم
          </Button>
        </div>
      ) : null}
    </Block>
  );
}

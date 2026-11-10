// The body of a record: its sections (and the fields' grid spans) from the layout, in view mode by default — values
// read-only, a pencil to edit one field in place — or as a whole form (edit-all, a new record). UI policies decide
// live what is hidden, required or read-only; server validation errors appear under their fields. View mode is a
// focused view: empty fields fold behind «نمایش فیلدهای خالی» (remembered per person; required ones always show),
// empty references to tables the organisation does not have yet are left out, and engine-maintained fields sit in a
// collapsed «اطلاعات سامانه».
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { Pencil, Check, X, ChevronDown, Info, Eye, EyeOff } from "lucide-react";
import type { FieldDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { useLocalState } from "../../lib/hooks";
import { cx } from "../../components/blocks";
import type { LayoutSection } from "../model/layout";
import { spanOf } from "../model/layout";
import type { FormState } from "../model/policies";
import { isEmptyValue, targetOf, type Schema } from "../model/schema";
import type { DisplayMap, TableMeta } from "../model/types";
import { FieldValue } from "../fields/display";
import { FieldInput } from "../fields/FieldInput";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface RecordFormProps {
  def: TableMeta;
  schema: Schema;
  sections: LayoutSection[];
  values: Record<string, unknown>;
  state: FormState;
  /** "view": read-only with inline edits; "edit": every editable field is an input */
  mode: "view" | "edit";
  errors: Record<string, string>;
  display: DisplayMap;
  me: string | null;
  tz: string;
  onChange: (field: string, value: unknown) => void;
  /** view mode: saves one field (resolves true when saved) */
  onSaveField?: (field: string, value: unknown) => Promise<boolean>;
  /** id prefix for labels */
  idPrefix?: string;
}

/** An empty reference to a table the organisation does not have yet (a module still to come): nothing to pick. */
const unusable = (f: FieldDef, def: TableMeta, schema: Schema, v: unknown) => {
  if (FIELD_TYPES[f.type].family !== "ref" || !isEmptyValue(v)) return false;
  const t = targetOf(f, def) ?? (f.type === "group" ? "group" : null);
  return !!t && !schema.def(t);
};

export function RecordForm({ def, schema, sections, values, state, mode, errors, display, me, tz, onChange, onSaveField, idPrefix = "rf" }: RecordFormProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useLocalState("itsm.records.showEmpty", false);
  const firstError = useRef<string | null>(null);
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first && first !== firstError.current) {
      firstError.current = first;
      document.getElementById(`${idPrefix}-${first}`)?.focus();
    }
    if (!first) firstError.current = null;
  }, [errors, idPrefix]);

  // view mode: what an empty field would show is «—»; fold those unless asked (an open inline edit stays)
  const folded = (f: FieldDef) =>
    mode === "view" && isEmptyValue(values[f.name]) && editing !== f.name && (state.readonly.has(f.name) || (!showEmpty && !state.required.has(f.name)));
  let emptyCount = 0;
  const visible = (s: LayoutSection) =>
    s.fields.filter((f) => {
      if (state.hidden.has(f.name) || unusable(f, def, schema, values[f.name])) return false;
      if (folded(f)) {
        if (!state.readonly.has(f.name)) emptyCount++;
        return false;
      }
      return true;
    });
  const shown = sections.map((s) => ({ s, fields: visible(s) }));

  return (
    <div className="rk-form">
      {shown.map(({ s, fields }) => {
        if (!fields.length) return null;
        const body = (
          <div className="rk-grid">
            {fields.map((f) => (
              <FieldBox
                key={f.name}
                f={f}
                id={`${idPrefix}-${f.name}`}
                def={def}
                schema={schema}
                values={values}
                state={state}
                mode={mode}
                error={errors[f.name]}
                display={display}
                me={me}
                tz={tz}
                editing={editing === f.name}
                onEdit={(on) => setEditing(on ? f.name : null)}
                onChange={(v) => onChange(f.name, v)}
                onSave={onSaveField}
              />
            ))}
          </div>
        );
        if (s.system)
          return (
            <details key={s.key} className="rk-sec rk-sec-sys">
              <summary>
                <ChevronDown {...I14} className="rk-sec-chev" aria-hidden />
                {s.label}
              </summary>
              {body}
            </details>
          );
        return (
          <section key={s.key} className="rk-sec" aria-label={s.label ?? undefined}>
            {s.label ? <h3 className="rk-sec-t">{s.label}</h3> : null}
            {body}
          </section>
        );
      })}
      {mode === "view" && (emptyCount > 0 || showEmpty) ? (
        <button type="button" className="rk-empty-toggle" onClick={() => setShowEmpty(!showEmpty)} aria-pressed={showEmpty}>
          {showEmpty ? <EyeOff {...I14} aria-hidden /> : <Eye {...I14} aria-hidden />}
          {showEmpty ? "پنهان کردن فیلدهای خالی" : `نمایش ${faDigits(emptyCount)} فیلد خالی`}
        </button>
      ) : null}
    </div>
  );
}

interface FieldBoxProps {
  f: FieldDef;
  id: string;
  def: TableMeta;
  schema: Schema;
  values: Record<string, unknown>;
  state: FormState;
  mode: "view" | "edit";
  error?: string;
  display: DisplayMap;
  me: string | null;
  tz: string;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onChange: (v: unknown) => void;
  onSave?: (field: string, value: unknown) => Promise<boolean>;
}

function FieldBox({ f, id, def, schema, values, state, mode, error, display, me, tz, editing, onEdit, onChange, onSave }: FieldBoxProps) {
  const readonly = state.readonly.has(f.name);
  const required = state.required.has(f.name);
  const waiting = state.waiting.get(f.name);
  const span = spanOf(f);
  const label = (
    <span className="rk-f-l">
      <label htmlFor={id}>{f.label}</label>
      {required && !readonly ? <span className="rk-req" aria-label="الزامی">*</span> : null}
      {f.help ? (
        <Tooltip title={f.help}>
          <Info {...I14} className="rk-f-help" aria-label={f.help} />
        </Tooltip>
      ) : null}
    </span>
  );
  let body: ReactNode;
  if (mode === "edit" && !readonly) {
    body = (
      <FieldInput
        id={id}
        field={f}
        value={values[f.name] ?? null}
        onChange={onChange}
        def={def}
        schema={schema}
        row={values}
        display={display}
        tz={tz}
        waitingFor={waiting}
        status={error ? "error" : undefined}
        aria-label={f.label}
      />
    );
  } else if (editing && !readonly && onSave) {
    body = <InlineField f={f} id={id} def={def} schema={schema} values={values} display={display} tz={tz} waiting={waiting} onDone={() => onEdit(false)} onSave={onSave} />;
  } else {
    body = (
      <div className={cx("rk-f-v", !readonly && onSave && "is-editable")} id={id} tabIndex={!readonly && onSave ? -1 : undefined}>
        <FieldValue field={f} value={values[f.name]} table={def.key} schema={schema} display={display} me={me} tz={tz} />
        {!readonly && onSave ? (
          <button type="button" className="rk-f-pen" aria-label={`ویرایش ${f.label}`} onClick={() => onEdit(true)}>
            <Pencil {...I14} aria-hidden />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cx("rk-f", error && "has-error")} style={{ ["--rk-span" as string]: String(span) }} onDoubleClick={() => mode === "view" && !readonly && onSave && !editing && onEdit(true)}>
      {label}
      {body}
      {error ? (
        <span className="rk-err" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** One field edited in place: Enter / ✓ saves, Esc / × cancels; choices and pickers save as soon as they change. */
function InlineField({ f, id, def, schema, values, display, tz, waiting, onDone, onSave }: { f: FieldDef; id: string; def: TableMeta; schema: Schema; values: Record<string, unknown>; display: DisplayMap; tz: string; waiting?: string; onDone: () => void; onSave: (field: string, value: unknown) => Promise<boolean> }) {
  const [v, setV] = useState<unknown>(values[f.name] ?? null);
  const [busy, setBusy] = useState(false);
  // one-value pickers save on change; text, numbers, dates and multi-value fields wait for Enter or ✓
  const immediate = ["choice", "bool", "user", "group", "ref", "color", "rating"].includes(f.type);
  const save = async (value: unknown) => {
    setBusy(true);
    const ok = await onSave(f.name, value);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="rk-f-inline" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onDone())}>
      <div className="rk-f-inline-in">
        <FieldInput
          id={id}
          field={f}
          value={v}
          onChange={(x) => {
            setV(x);
            if (immediate) void save(x);
          }}
          def={def}
          schema={schema}
          row={{ ...values, [f.name]: v }}
          display={display}
          tz={tz}
          autoFocus
          waitingFor={waiting}
          onCommit={() => void save(v)}
          onCancel={onDone}
          disabled={busy}
        />
      </div>
      {!immediate ? (
        <span className="rk-f-inline-a">
          <Button size="small" type="primary" icon={<Check {...I14} />} loading={busy} onClick={() => void save(v)} aria-label="ذخیره" />
          <Button size="small" icon={<X {...I14} />} onClick={onDone} aria-label="انصراف" disabled={busy} />
        </span>
      ) : null}
    </div>
  );
}

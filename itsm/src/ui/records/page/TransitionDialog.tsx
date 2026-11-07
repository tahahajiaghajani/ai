// Taking a transition that requires fields («حل شد» needs a close code and close notes): a dialog asks for exactly
// those fields (prefilled from the record), then takes the transition with them in one call. Used by the record
// header, kanban drops and anywhere a module offers a transition.
import { useMemo, useState } from "react";
import { Modal } from "antd";
import type { FieldDef } from "@shared/model/types";
import { useNotify } from "../../lib/hooks";
import { useMe, useRecordActions } from "../data/hooks";
import { fieldOf, isEmptyValue, type Schema } from "../model/schema";
import { fieldErrorsOf, isConflict, type RecordResult, type RecordRow, type TableMeta } from "../model/types";
import { FieldInput } from "../fields/FieldInput";

export interface TransitionTarget {
  to: string;
  label: string;
  requires: string[];
}

export interface TransitionDialogProps {
  def: TableMeta;
  schema: Schema;
  row: RecordRow;
  display?: Record<string, string>;
  transition: TransitionTarget | null;
  onClose: () => void;
  onDone?: (r: RecordResult) => void;
  /** a stale version: the caller reloads (the record page opens its conflict dialog) */
  onConflict?: () => void;
}

export function TransitionDialog({ def, schema, row, display, transition, onClose, onDone, onConflict }: TransitionDialogProps) {
  const actions = useRecordActions(def.key);
  const { tz } = useMe();
  const n = useNotify();
  const fields = useMemo(() => (transition?.requires ?? []).map((r) => fieldOf(def, r)).filter((f): f is FieldDef => !!f), [def, transition]);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const values = { ...row, ...data };
  const missing = fields.filter((f) => isEmptyValue(values[f.name]));

  const submit = async () => {
    if (!transition || missing.length) return;
    setBusy(true);
    try {
      const send: Record<string, unknown> = {};
      for (const f of fields) send[f.name] = values[f.name];
      const r = await actions.transition(row.id, transition.to, send, row.version);
      n.ok(`${transition.label}: انجام شد`);
      setData({});
      setErrors({});
      onDone?.(r);
      onClose();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (Object.keys(fe).length) setErrors(fe);
      else if (isConflict(e) && onConflict) {
        onClose();
        onConflict();
      } else n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!transition}
      title={transition ? `«${transition.label}»` : ""}
      okText={transition?.label ?? "تأیید"}
      cancelText="انصراف"
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okButtonProps={{ disabled: missing.length > 0 }}
      width={560}
      destroyOnHidden
    >
      <div className="rk-stack">
        <p className="rk-hint">برای این تغییر وضعیت، این فیلدها را کامل کنید.</p>
        {fields.map((f, i) => (
          <div key={f.name} className="rk-stack-s">
            <label className="rk-lbl" htmlFor={`rk-tr-${f.name}`}>
              {f.label} <span className="rk-req" aria-hidden>*</span>
            </label>
            <FieldInput
              id={`rk-tr-${f.name}`}
              field={f}
              value={values[f.name] ?? null}
              onChange={(v) => setData((d) => ({ ...d, [f.name]: v }))}
              def={def}
              schema={schema}
              row={values}
              display={display}
              tz={tz}
              autoFocus={i === 0}
              status={errors[f.name] ? "error" : undefined}
            />
            {errors[f.name] ? <span className="rk-err" role="alert">{errors[f.name]}</span> : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** True when a transition needs the dialog (a required field is still empty on the row). */
export function needsDialog(def: TableMeta, row: Record<string, unknown>, requires: readonly string[]): boolean {
  return requires.some((r) => !!fieldOf(def, r) && isEmptyValue(row[r]));
}

export { isConflict };

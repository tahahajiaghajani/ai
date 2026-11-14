// Small parts of the process designer (design F §8.4, package F6): a duration (amount and unit), the comparisons of
// «شرط» and «انتخاب» on the case's values — a field of the process's forms, a comparison, and a value typed as that
// field takes it (an amount in the organisation's unit, kept in Rial; a choice from its options) — and the menu that
// puts a case value's pill into a text («درج فیلد»).
import { useMemo, useState, type ReactNode } from "react";
import { Button, Dropdown, Input, InputNumber, Select } from "antd";
import { Braces, Plus, Trash2, X } from "lucide-react";
import { DURATION_UNITS, RULE_OPS } from "@shared/flows/nodes";
import type { Duration } from "@shared/process";
import { rialFromInput } from "@shared/forms/fieldtypes";
import type { MoneyUnit } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { MoneyInput } from "../../../../components/inputs";
import { Field } from "../../../../components/blocks";
import { I14 } from "../fields/parts";
import { CASE_META, NO_RIGHT, casePill, pillField, unitFromRial, type CaseField, type CaseRule } from "./model";

export { I14, I16 } from "../fields/parts";

/** A labelled control; an error replaces the hint and is announced; `extra` sits at the label's end (a menu). */
export function F({ label, error, hint, htmlFor, extra, children, className }: { label: ReactNode; error?: string; hint?: ReactNode; htmlFor?: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Field
      label={label}
      htmlFor={htmlFor}
      extra={extra}
      className={className}
      hint={
        error ? (
          <span className="rk-err" role="alert">
            {error}
          </span>
        ) : (
          hint
        )
      }
    >
      {children}
    </Field>
  );
}

/** An amount and a unit of time; cleared with «×» when `clearable`. */
export function DurationField({ value, onChange, disabled, clearable, id, label }: { value: Duration | null | undefined; onChange: (d: Duration | null) => void; disabled?: boolean; clearable?: boolean; id?: string; label: string }) {
  return (
    <span className="wfp-dur" role="group" aria-label={label}>
      <InputNumber
        id={id}
        min={1}
        max={9999}
        value={value?.amount ?? null}
        disabled={disabled}
        placeholder="مقدار"
        aria-label={`${label}: مقدار`}
        onChange={(v) => (v === null || v === undefined || Number(v) <= 0 ? onChange(null) : onChange({ amount: Number(v), unit: value?.unit ?? "day" }))}
      />
      <Select
        value={value?.unit ?? "day"}
        disabled={disabled || !value}
        aria-label={`${label}: واحد`}
        onChange={(unit) => value && onChange({ amount: value.amount, unit })}
        options={DURATION_UNITS.map((u) => ({ value: u.value, label: u.label }))}
      />
      {clearable && value && !disabled ? <Button type="text" size="small" icon={<X {...I14} />} aria-label={`برداشتن ${label}`} onClick={() => onChange(null)} /> : null}
    </span>
  );
}

/** The case values a text may name, as a menu that inserts `{{case.<field>}}`. */
export function PillMenu({ fields, onPick, disabled, meta = true }: { fields: readonly { name: string; label: string }[]; onPick: (pill: string) => void; disabled?: boolean; meta?: boolean }) {
  const items = [...fields.map((f) => ({ key: f.name, label: f.label })), ...(meta ? CASE_META.filter((m) => !fields.some((f) => f.name === m.name)).map((m) => ({ key: m.name, label: m.label })) : [])];
  return (
    <Dropdown disabled={disabled || !items.length} trigger={["click"]} menu={{ items, onClick: ({ key }) => onPick(casePill(key)) }}>
      <Button size="small" icon={<Braces {...I14} />}>
        درج فیلد
      </Button>
    </Dropdown>
  );
}

const OPS = RULE_OPS.map((o) => ({ value: o.value, label: o.label }));

function RuleValue({ field, value, onChange, unit, disabled, label }: { field: CaseField | undefined; value: string; onChange: (v: string) => void; unit: MoneyUnit; disabled?: boolean; label: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  if (field?.type === "money") {
    const shown = typed ?? unitFromRial(value, unit);
    return (
      <MoneyInput
        value={shown || null}
        disabled={disabled}
        unit={unit === "toman" ? "تومان" : "ریال"}
        aria-label={label}
        onChange={(v) => {
          setTyped(v ?? "");
          onChange(rialFromInput(v, unit) ?? "");
        }}
      />
    );
  }
  if ((field?.type === "choice" || field?.type === "multichoice") && field.options.length) {
    return <Select value={value || undefined} disabled={disabled} aria-label={label} placeholder="گزینه" onChange={(v) => onChange(String(v ?? ""))} options={field.options.map((o) => ({ value: o.value, label: o.label }))} />;
  }
  if (field?.type === "bool") {
    return (
      <Select
        value={value || undefined}
        disabled={disabled}
        aria-label={label}
        onChange={(v) => onChange(String(v))}
        options={[
          { value: "true", label: "بله" },
          { value: "false", label: "خیر" },
        ]}
      />
    );
  }
  return <Input value={value} disabled={disabled} aria-label={label} placeholder="مقدار" onChange={(e) => onChange(e.target.value)} />;
}

/**
 * The comparisons of «شرط» or of a case of «انتخاب»: each a case value (a field of the process's forms, or the case's
 * own number, title, requester…), a comparison and a value. The value is kept as the case keeps it (amounts in Rial).
 */
export function CaseRulesEditor({ value, onChange, fields, unit, disabled }: { value: CaseRule[]; onChange?: (v: CaseRule[]) => void; fields: readonly CaseField[]; unit: MoneyUnit; disabled?: boolean }) {
  const off = disabled || !onChange;
  const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);
  const options = useMemo(
    () => [
      { label: "فیلدهای فرم", options: fields.map((f) => ({ value: casePill(f.name), label: f.label })) },
      { label: "پرونده", options: CASE_META.map((m) => ({ value: casePill(m.name), label: m.label })) },
    ],
    [fields],
  );
  const set = (i: number, patch: Partial<CaseRule>) => onChange?.(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="wfp-rules">
      {value.map((r, i) => {
        const name = pillField(r.left);
        const known = !!name && (byName.has(name) || CASE_META.some((m) => m.name === name));
        const n = faDigits(i + 1);
        return (
          <div key={i} className="wfp-rule" role="group" aria-label={`مقایسهٔ ${n}`}>
            <div className="wfp-rule-l">
            {known || !r.left ? (
              <Select
                value={r.left || undefined}
                disabled={off}
                placeholder="فیلد"
                showSearch={{ optionFilterProp: "label" }}
                aria-label={`مقایسهٔ ${n}: فیلد`}
                popupMatchSelectWidth={false}
                onChange={(left) => set(i, { left, right: "" })}
                options={options}
              />
            ) : (
              <Input dir="ltr" className="ds-mono" value={r.left} disabled={off} aria-label={`مقایسهٔ ${n}: داده`} onChange={(e) => set(i, { left: e.target.value })} />
            )}
            {off ? null : <Button type="text" size="small" icon={<Trash2 {...I14} />} aria-label={`حذف مقایسهٔ ${n}`} onClick={() => onChange?.(value.filter((_, j) => j !== i))} />}
            </div>
            <div className="wfp-rule-r">
              <Select value={r.op} disabled={off} aria-label={`مقایسهٔ ${n}: نوع`} popupMatchSelectWidth={false} onChange={(op) => set(i, { op, ...(NO_RIGHT.has(op) ? { right: "" } : {}) })} options={OPS} />
              {NO_RIGHT.has(r.op) ? null : <RuleValue key={r.left} field={name ? byName.get(name) : undefined} value={r.right} onChange={(right) => set(i, { right })} unit={unit} disabled={off} label={`مقایسهٔ ${n}: مقدار`} />}
            </div>
          </div>
        );
      })}
      {off ? null : (
        <Button size="small" icon={<Plus {...I14} />} className="self-start" onClick={() => onChange?.([...value, { left: "", op: "eq", right: "" }])}>
          افزودن مقایسه
        </Button>
      )}
    </div>
  );
}

// Small parts of «فیلدها»: a labelled control with its error, the editor of a choice field's own options (from the
// old custom-field manager), the side sheet's width (a full page on phones) and its unsaved-changes guard.
import { useCallback, type ReactNode } from "react";
import { Button, Input, Select } from "antd";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { Option } from "@shared/model/types";
import { COLOR_KEYS } from "@shared/model/types";
import { Field } from "../../../../components/blocks";
import { useIsPhone, useNotify } from "../../../../lib/hooks";
import { COLOR_LABELS } from "../../../../records/model/colors";
import { ChoiceTag } from "../../../../records/fields/display";

export const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
export const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** A labelled control; an error replaces the hint and is announced. */
export function F({ label, error, hint, htmlFor, children, className }: { label: ReactNode; error?: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <Field
      label={label}
      htmlFor={htmlFor}
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

/** The width of a side sheet: `w` on screens, the whole width on phones (the sheet is then the page). */
export function useSheetSize(w = 560): number | string {
  return useIsPhone() ? "100%" : w;
}

/** Closing a sheet with unsaved changes asks first. */
export function useCloseGuard(dirty: boolean, onClose: () => void) {
  const n = useNotify();
  return useCallback(async () => {
    if (dirty && !(await n.confirm("تغییرها ذخیره نشده‌اند؛ بسته شود؟", "آنچه تغییر داده‌اید از دست می‌رود.", true, "بستن بدون ذخیره"))) return;
    onClose();
  }, [dirty, n, onClose]);
}

/** A choice field's own options: value (Latin), label, colour; ordered with the arrows. */
export function OptionsEditor({ value, onChange, disabled }: { value: Option[]; onChange: (o: Option[]) => void; disabled?: boolean }) {
  const set = (i: number, p: Partial<Option>) => onChange(value.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const move = (i: number, d: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="wff-options">
      {value.map((o, i) => (
        <div key={i} className="wff-option">
          <Input size="small" dir="ltr" className="ds-mono wff-option-v" value={o.value} disabled={disabled} onChange={(e) => set(i, { value: e.target.value.replace(/\s+/g, "_") })} placeholder="value" aria-label={`مقدار گزینهٔ ${i + 1}`} />
          <Input size="small" className="wff-option-l" value={o.label} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} placeholder="برچسب" aria-label={`برچسب گزینهٔ ${i + 1}`} />
          <Select
            size="small"
            className="wff-option-c"
            value={o.color}
            allowClear
            disabled={disabled}
            onChange={(c) => set(i, { color: c })}
            placeholder="رنگ"
            options={COLOR_KEYS.map((k) => ({ value: k, label: COLOR_LABELS[k] }))}
            optionRender={(x) => <ChoiceTag option={{ value: String(x.value), label: String(x.label), color: x.value as Option["color"] }} />}
            aria-label={`رنگ گزینهٔ ${i + 1}`}
          />
          {disabled ? null : (
            <span className="wff-option-a">
              <Button type="text" size="small" icon={<ArrowUp {...I14} />} disabled={i === 0} onClick={() => move(i, -1)} aria-label="بالاتر" />
              <Button type="text" size="small" icon={<ArrowDown {...I14} />} disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="پایین‌تر" />
              <Button type="text" size="small" icon={<X {...I14} />} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`حذف گزینهٔ ${i + 1}`} />
            </span>
          )}
        </div>
      ))}
      {disabled ? null : (
        <Button size="small" type="text" icon={<Plus {...I14} />} onClick={() => onChange([...value, { value: "", label: "" }])} className="self-start">
          گزینه
        </Button>
      )}
    </div>
  );
}

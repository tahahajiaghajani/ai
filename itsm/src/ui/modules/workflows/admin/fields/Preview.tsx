// «پیش‌نمایش» of a field type or a library field (design F §8.1): the live input exactly as a record form shows it
// (the record kit's FieldInput, with the widgets modules supply), its value checked by the shared validators as the
// server would, a checked identifier shown grouped as lists show it, and money in the organisation's unit — typed in
// that unit, stored in Rials.
import { useEffect, useMemo, useState } from "react";
import type { FieldDef } from "@shared/model/types";
import type { MoneyUnit } from "@shared/financial/logic";
import { formatFieldMoney, moneyUnitOf, rialFromInput } from "@shared/forms/fieldtypes";
import { fieldValueProblem, groupChecked } from "@shared/forms/validators";
import { localDate } from "@shared/model/jalali-buckets";
import { MoneyInput } from "../../../../components/inputs";
import { FieldInput } from "../../../../records/fields/FieldInput";
import { useMe, useSchema } from "../../../../records/data/hooks";
import type { TableMeta } from "../../../../records/model/types";

const UNIT_LABEL: Record<MoneyUnit, string> = { rial: "ریال", toman: "تومان" };

/** The table a previewed field pretends to belong to (no record: a «پیوست» says files come after saving). */
const holder = (f: FieldDef): TableMeta => ({ key: "field_def", table: "", label: "فیلد", plural: "فیلدها", module: "fields", area: "process_design", display: "label", fields: [f], can: { read: true, create: false } }) as unknown as TableMeta;

export function FieldPreview({ field, unit, empty }: { field: FieldDef | null; unit: MoneyUnit; empty?: string }) {
  const { schema } = useSchema();
  const { tz } = useMe();
  const [value, setValue] = useState<unknown>(null);
  const [typed, setTyped] = useState<string | null>(null);
  // another type or settings: start again from an empty value
  const shape = field ? `${field.type}|${field.widget ?? ""}|${field.check ?? ""}|${field.ref ?? ""}|${JSON.stringify(field.choices ?? null)}` : "";
  useEffect(() => {
    setValue(null);
    setTyped(null);
  }, [shape]);
  const def = useMemo(() => (field ? holder(field) : null), [field]);
  if (!field || !def || !schema) return <p className="rk-hint">{empty ?? "نوع و تنظیم‌ها را کامل کنید تا پیش‌نمایش دیده شود."}</p>;
  const today = localDate(Date.now(), tz);
  const problem = fieldValueProblem(field, value, { today });
  const shown = field.check && field.check !== "attachments" && typeof value === "string" && value ? groupChecked(field.check, value) : null;
  const money = field.type === "money" ? moneyUnitOf(field, unit) : null;
  return (
    <div className="wff-preview" aria-label="پیش‌نمایش فیلد">
      <div className="wff-preview-l">
        {field.label}
        {field.formRequired || field.required ? <span className="text-danger" aria-hidden> *</span> : null}
      </div>
      {money ? (
        <MoneyInput
          value={typed}
          onChange={(v) => {
            setTyped(v === null ? null : String(v));
            setValue(v === null ? null : rialFromInput(v, money));
          }}
          unit={UNIT_LABEL[money]}
          placeholder={field.placeholder}
          aria-label={field.label}
        />
      ) : (
        <FieldInput field={field} value={value} onChange={setValue} def={def} schema={schema} tz={tz} aria-label={field.label} status={problem ? "error" : undefined} />
      )}
      {field.help ? <div className="rk-hint">{field.help}</div> : null}
      {problem ? (
        <div className="rk-err" role="alert">
          {problem}
        </div>
      ) : null}
      {money && value ? (
        <div className="rk-hint">
          ذخیره: <bdi>{formatFieldMoney({}, value, "rial", { suffix: true })}</bdi> · نمایش: <bdi>{formatFieldMoney(field, value, unit, { suffix: true })}</bdi>
        </div>
      ) : null}
      {shown && !problem ? (
        <div className="rk-hint">
          نمایش در فهرست‌ها: <bdi dir="ltr" className="ds-mono">{shown}</bdi>
        </div>
      ) : null}
    </div>
  );
}

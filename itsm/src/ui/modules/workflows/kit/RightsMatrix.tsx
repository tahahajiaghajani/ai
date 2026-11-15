// The rights matrix of a step (design F §3.2, §8.4 «فرم» tab): the form's fields as rows × «پنهان | خواندنی | ویرایش |
// الزامی», with «همه خواندنی» and the default for the fields the step does not name. A row shows what a person at the
// step gets (`effectiveRights`, the same function the step form, the apply and the read redaction use); a choice
// states the field's right. Locked, read-only and system fields cannot be made editable; field groups and the form's
// own flags show as chips. Native radios: Tab reaches a row, the arrow keys choose within it. Read-only without
// `onChange` (a published version, a phone).
import { useId } from "react";
import { Button, Select } from "antd";
import { Lock } from "lucide-react";
import { RIGHTS, RIGHT_LABELS, type FieldSource, type FormLayoutV2, type Right, type StepRights } from "@shared/forms/layout";
import { faDigits } from "@shared/format";
import { cx } from "../../../components/blocks";
import { EmptyState } from "../../../components/display";
import { allRead, rightsRows, setDefaultRight, setFieldRight, type RightsRow } from "./model";
import "./kit.css";

export interface RightsMatrixProps {
  /** the step's form */
  form: FormLayoutV2;
  /** the definitions of its fields (the version's snapshot or the library) */
  fields: FieldSource;
  value: StepRights | null | undefined;
  /** absent: read-only */
  onChange?: (v: StepRights) => void;
  /** further fields nobody edits at this step */
  locked?: Iterable<string>;
  /** the step's name, for the table's caption */
  stepLabel?: string;
  className?: string;
}

function Chips({ row }: { row: RightsRow }) {
  if (!row.chips.length) return null;
  return (
    <span className="wfk-chips">
      {row.chips.map((c) => (
        <span key={c.label} className={cx("wfk-chip", c.kind === "lock" && "is-lock", c.kind === "group" && "is-group")}>
          {c.kind === "lock" ? <Lock size={11} strokeWidth={1.5} absoluteStrokeWidth aria-hidden /> : null}
          {c.label}
        </span>
      ))}
    </span>
  );
}

export function RightsMatrix({ form, fields, value, onChange, locked, stepLabel, className }: RightsMatrixProps) {
  const uid = useId();
  const rows = rightsRows(form, fields, value, locked);
  const readOnly = !onChange;
  const dflt: Right = value?.default ?? "read";
  const stated = rows.filter((r) => r.stated).length;
  if (!rows.length) return <EmptyState title="این فرم فیلدی ندارد" description="فیلدها را در فرم بچینید تا دسترسی هر مرحله به آن‌ها را تعیین کنید." />;
  // rows grouped by their section, in layout order
  const sections: { name: string; rows: RightsRow[] }[] = [];
  for (const r of rows) {
    const last = sections[sections.length - 1];
    if (last && last.name === r.section) last.rows.push(r);
    else sections.push({ name: r.section, rows: [r] });
  }
  return (
    <div className={cx("wfk-rights", className)}>
      <div className="wfk-rights-bar">
        <label className="wfk-grow" htmlFor={readOnly ? undefined : `${uid}-default`}>
          فیلدهایی که تعیین نشده‌اند:{" "}
          {readOnly ? (
            <strong>{RIGHT_LABELS[dflt]}</strong>
          ) : (
            <Select
              id={`${uid}-default`}
              size="small"
              value={dflt}
              style={{ width: 110 }}
              onChange={(v) => onChange(setDefaultRight(value, v))}
              options={RIGHTS.map((r) => ({ value: r, label: RIGHT_LABELS[r] }))}
              aria-label="دسترسی پیش‌فرض فیلدها"
            />
          )}
        </label>
        {stated ? <span className="ds-num">{faDigits(stated)} فیلد جدا تعیین شده</span> : null}
        {readOnly ? null : (
          <Button size="small" onClick={() => onChange(allRead())} disabled={dflt === "read" && !stated}>
            همه خواندنی
          </Button>
        )}
      </div>
      <div className="wfk-rights-wrap">
        <table className="wfk-rights-t">
          <caption className="sr-only">{stepLabel ? `دسترسی مرحلهٔ «${stepLabel}» به فیلدهای فرم` : "دسترسی مرحله به فیلدهای فرم"}</caption>
          <thead>
            <tr>
              <th scope="col">فیلد</th>
              {RIGHTS.map((r) => (
                <th key={r} scope="col" className="wfk-rc">
                  {RIGHT_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => [
              s.name && sections.length > 1 ? (
                <tr key={`s:${s.name}`} className="wfk-rights-sec">
                  <th scope="colgroup" colSpan={RIGHTS.length + 1}>
                    {s.name}
                  </th>
                </tr>
              ) : null,
              ...s.rows.map((row) => (
                <tr key={row.field}>
                  <th scope="row">
                    <span className="wfk-rights-f">
                      <span>{row.label}</span>
                      <Chips row={row} />
                    </span>
                  </th>
                  {RIGHTS.map((r) => {
                    const off = readOnly || row.disabled.includes(r);
                    const checked = row.effective === r;
                    return (
                      <td key={r} className="wfk-rc">
                        <label className={cx("wfk-radio", off && "is-off", checked && !row.stated && "is-default")} title={row.disabled.includes(r) ? "این فیلد در این مرحله ویرایش نمی‌شود" : undefined}>
                          <input
                            type="radio"
                            name={`wfk-right-${uid}-${row.field}`}
                            value={r}
                            checked={checked}
                            disabled={off && !checked}
                            aria-label={`${row.label}: ${RIGHT_LABELS[r]}${checked && !row.stated ? " (پیش‌فرض)" : ""}`}
                            onChange={() => !off && onChange?.(setFieldRight(value, row.field, r))}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

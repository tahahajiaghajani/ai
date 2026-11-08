// Small form controls of the change screens: antd Form.Item injects `value` and `onChange`, so these wrap the record
// kit's inputs (which take them as required props) for use inside forms.
import { DateTimeInput, RecordSelect } from "../../records";
import { useOrg } from "../../lib/org";

/** A Jalali date and 24-hour time in the organisation's zone. */
export function FormDateTime(p: { value?: string | null; onChange?: (v: string | null) => void; id?: string }) {
  const { timezone } = useOrg();
  return <DateTimeInput value={p.value ?? null} onChange={(v) => p.onChange?.(v)} tz={timezone} />;
}

/** Records of a table (one or many). */
export function FormRecords(p: { table: string; multiple?: boolean; value?: string | string[] | null; onChange?: (v: string | string[] | null) => void; placeholder?: string }) {
  return <RecordSelect table={p.table} multiple={p.multiple} value={p.value ?? (p.multiple ? [] : null)} onChange={(v) => p.onChange?.(v)} placeholder={p.placeholder} />;
}

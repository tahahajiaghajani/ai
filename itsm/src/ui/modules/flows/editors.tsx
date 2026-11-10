// Editors of the property panel: inputs with data pills (a picker inserts {{…}} at the caret), field values for a
// table, data comparisons, recipients, durations, and the rows of variables, mappings and headers.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Input, Popover, Select, Tooltip, type InputRef } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Braces, Plus, Trash2 } from "lucide-react";
import { DURATION_UNITS, RULE_OPS } from "@shared/flows";
import type { Cond } from "@shared/model/conditions";
import { normalizeFa } from "../../lib/fa";
import { ICON14 } from "../../components/blocks";
import { FilterBuilder, RecordSelect, UserSelect, useSchema } from "../../records";
import { writableFields, type FieldLite, type Pill } from "./model";

/** The data pills a step may use, grouped and searchable; picking one calls `onPick` with `{{path}}`. */
export function PillPicker({ pills, onPick, children }: { pills: Pill[]; onPick: (text: string) => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = normalizeFa(q.trim());
    const list = n ? pills.filter((p) => normalizeFa(`${p.label} ${p.path} ${p.group}`).includes(n)) : pills;
    const groups = new Map<string, Pill[]>();
    for (const p of list) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
    return [...groups.entries()];
  }, [pills, q]);
  const content = (
    <div className="fl-pills">
      <Input size="small" placeholder="جست‌وجوی داده" value={q} onChange={(e) => setQ(e.target.value)} allowClear autoFocus />
      {shown.length ? null : <div className="fl-step-meta" style={{ padding: 8 }}>داده‌ای پیدا نشد</div>}
      {shown.map(([group, items]) => (
        <div key={group}>
          <div className="fl-pal-group">{group}</div>
          {items.map((p) => (
            <button
              type="button"
              key={p.path}
              className="fl-pill"
              onClick={() => {
                onPick(`{{${p.path}}}`);
                setOpen(false);
              }}
            >
              <span>{p.label}</span>
              <code>{p.path}</code>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <Popover open={open} onOpenChange={setOpen} trigger="click" content={content} placement="bottomLeft" destroyOnHidden>
      {children ?? (
        <Tooltip title="درج داده">
          <Button size="small" type="text" icon={<Braces {...ICON14} />} aria-label="درج داده" />
        </Tooltip>
      )}
    </Popover>
  );
}

function insertAt(el: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string, text: string): { value: string; caret: number } {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length };
}

/** One line with data pills. */
export function PillInput({ value, onChange, pills, placeholder, ltr, disabled }: { value: unknown; onChange: (v: string) => void; pills: Pill[]; placeholder?: string; ltr?: boolean; disabled?: boolean }) {
  const ref = useRef<InputRef>(null);
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return (
    <Input
      ref={ref}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      dir={ltr ? "ltr" : undefined}
      onChange={(e) => onChange(e.target.value)}
      suffix={
        disabled ? undefined : (
          <PillPicker
            pills={pills}
            onPick={(t) => {
              const r = insertAt(ref.current?.input, text, t);
              onChange(r.value);
              requestAnimationFrame(() => ref.current?.input?.setSelectionRange(r.caret, r.caret));
            }}
          />
        )
      }
    />
  );
}

/** Several lines (Markdown or a JSON body) with data pills. */
export function PillTextArea({ value, onChange, pills, ltr, rows = 4, disabled, placeholder }: { value: unknown; onChange: (v: string) => void; pills: Pill[]; ltr?: boolean; rows?: number; disabled?: boolean; placeholder?: string }) {
  const ref = useRef<TextAreaRef>(null);
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
  return (
    <div style={{ position: "relative" }}>
      <Input.TextArea
        ref={ref}
        value={text}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        dir={ltr ? "ltr" : undefined}
        className={ltr ? "fl-mono" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {disabled ? null : (
        <div style={{ position: "absolute", insetInlineEnd: 4, bottom: 4 }}>
          <PillPicker
            pills={pills}
            onPick={(t) => {
              const el = ref.current?.resizableTextArea?.textArea;
              const r = insertAt(el, text, t);
              onChange(r.value);
              requestAnimationFrame(() => el?.setSelectionRange(r.caret, r.caret));
            }}
          />
        </div>
      )}
    </div>
  );
}

const del = (onClick: () => void, disabled?: boolean) => <Button size="small" type="text" icon={<Trash2 {...ICON14} />} aria-label="حذف" onClick={onClick} disabled={disabled} />;
const add = (label: string, onClick: () => void, disabled?: boolean) => (
  <Button size="small" icon={<Plus {...ICON14} />} onClick={onClick} disabled={disabled} style={{ alignSelf: "flex-start" }}>
    {label}
  </Button>
);

/** { field: template } for a table's writable fields. */
export function ValuesEditor({ value, onChange, fields, pills, disabled }: { value: unknown; onChange: (v: Record<string, unknown>) => void; fields: FieldLite[] | undefined; pills: Pill[]; disabled?: boolean }) {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const entries = Object.entries(obj);
  const options = writableFields(fields).map((f) => ({ value: f.name, label: f.label }));
  const set = (list: [string, unknown][]) => onChange(Object.fromEntries(list));
  return (
    <div className="fl-rows">
      {entries.map(([k, v], i) => (
        <div className="fl-row" key={`${k}-${i}`}>
          <Select
            size="middle"
            showSearch
            optionFilterProp="label"
            value={k || undefined}
            placeholder="فیلد"
            options={options.filter((o) => o.value === k || !(o.value in obj))}
            onChange={(nk) => set(entries.map((e, j) => (j === i ? [nk, e[1]] : e)))}
            disabled={disabled}
          />
          <PillInput value={v} pills={pills} onChange={(nv) => set(entries.map((e, j) => (j === i ? [e[0], nv] : e)))} disabled={disabled} />
          {del(() => set(entries.filter((_, j) => j !== i)), disabled)}
        </div>
      ))}
      {fields ? add("افزودن فیلد", () => set([...entries, ["", ""]]), disabled || options.length <= entries.length) : <div className="fl-step-meta">ابتدا جدول را انتخاب کنید</div>}
    </div>
  );
}

/** [{ left, op, right }] comparisons of data. */
export function RulesEditor({ value, onChange, pills, disabled }: { value: unknown; onChange: (v: unknown[]) => void; pills: Pill[]; disabled?: boolean }) {
  const rules = Array.isArray(value) ? (value as { left?: unknown; op?: string; right?: unknown }[]) : [];
  const set = (i: number, patch: Record<string, unknown>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="fl-rows">
      {rules.map((r, i) => (
        <div className="fl-row is-rule" key={i}>
          <PillInput value={r.left} pills={pills} onChange={(v) => set(i, { left: v })} placeholder="{{vars.x}}" disabled={disabled} />
          <Select value={r.op ?? "eq"} options={RULE_OPS.map((o) => ({ value: o.value, label: o.label }))} onChange={(op) => set(i, { op })} disabled={disabled} />
          {r.op === "empty" || r.op === "nempty" ? <span /> : <PillInput value={r.right} pills={pills} onChange={(v) => set(i, { right: v })} disabled={disabled} />}
          {del(() => onChange(rules.filter((_, j) => j !== i)), disabled)}
        </div>
      ))}
      {add("افزودن مقایسه", () => onChange([...rules, { left: "", op: "eq", right: "" }]), disabled)}
    </div>
  );
}

/** People, user fields of the record, and groups. */
export function RecipientsEditor({ value, onChange, fields, disabled }: { value: unknown; onChange: (v: Record<string, string[]>) => void; fields: FieldLite[] | undefined; disabled?: boolean }) {
  const v = (value && typeof value === "object" ? value : {}) as { users?: string[]; fields?: string[]; groups?: string[] };
  const set = (patch: Record<string, string[]>) => onChange({ users: v.users ?? [], fields: v.fields ?? [], groups: v.groups ?? [], ...patch });
  const userFields = (fields ?? []).filter((f) => f.type === "user" || f.type === "users").map((f) => ({ value: f.name, label: f.label }));
  return (
    <div className="fl-rows">
      <UserSelect multiple value={v.users ?? []} onChange={(x) => set({ users: (x as string[]) ?? [] })} placeholder="اعضا" disabled={disabled} />
      <Select mode="multiple" value={v.fields ?? []} options={userFields} onChange={(x) => set({ fields: x })} placeholder="افراد رکورد (کارشناس، درخواست‌دهنده…)" disabled={disabled || !userFields.length} />
      <RecordSelect table="group" multiple value={v.groups ?? []} onChange={(x) => set({ groups: (x as string[]) ?? [] })} placeholder="گروه‌ها" disabled={disabled} />
    </div>
  );
}

export function DurationEditor({ value, onChange, disabled }: { value: unknown; onChange: (v: { amount: number; unit: string } | null) => void; disabled?: boolean }) {
  const d = (value && typeof value === "object" ? value : {}) as { amount?: number; unit?: string };
  return (
    <div className="fl-row" style={{ gridTemplateColumns: "minmax(0,1fr) 120px" }}>
      <Input
        inputMode="numeric"
        value={d.amount === undefined || d.amount === null ? "" : String(d.amount)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))));
          onChange(e.target.value.trim() === "" ? null : { amount: Number.isFinite(n) ? n : 0, unit: d.unit ?? "hour" });
        }}
        disabled={disabled}
        placeholder="مقدار"
      />
      <Select value={d.unit ?? "hour"} options={DURATION_UNITS} onChange={(unit) => onChange({ amount: d.amount ?? 1, unit })} disabled={disabled} />
    </div>
  );
}

/** Rows of two inputs: [{ name, value }], [{ name, path }] or [{ key, value }]. */
export function RowsEditor({
  value, onChange, keys, labels, pills, ltrSecond, disabled, addLabel,
}: { value: unknown; onChange: (v: Record<string, unknown>[]) => void; keys: [string, string]; labels: [string, string]; pills?: Pill[]; ltrSecond?: boolean; disabled?: boolean; addLabel: string }) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="fl-rows">
      {rows.map((r, i) => (
        <div className="fl-row" key={i}>
          <Input dir="ltr" value={String(r[keys[0]] ?? "")} placeholder={labels[0]} onChange={(e) => set(i, keys[0], e.target.value)} disabled={disabled} />
          {pills ? (
            <PillInput value={r[keys[1]]} pills={pills} onChange={(v) => set(i, keys[1], v)} placeholder={labels[1]} ltr={ltrSecond} disabled={disabled} />
          ) : (
            <Input dir={ltrSecond ? "ltr" : undefined} value={String(r[keys[1]] ?? "")} placeholder={labels[1]} onChange={(e) => set(i, keys[1], e.target.value)} disabled={disabled} />
          )}
          {del(() => onChange(rows.filter((_, j) => j !== i)), disabled)}
        </div>
      ))}
      {add(addLabel, () => onChange([...rows, { [keys[0]]: "", [keys[1]]: "" }]), disabled)}
    </div>
  );
}

/** An engine condition on a table (the records kit's builder). */
export function ConditionEditor({ table, value, onChange, disabled }: { table: string; value: unknown; onChange: (c: Cond | null) => void; disabled?: boolean }) {
  const { schema } = useSchema();
  const def = table && schema ? schema.def(table) : undefined;
  if (!def || !schema) return <div className="fl-step-meta">ابتدا جدول را انتخاب کنید</div>;
  return <FilterBuilder def={def} schema={schema} value={(value as Cond) ?? null} onChange={onChange} disabled={disabled} />;
}

/** A table of the organisation (records only; optionally the ones the caller may create in). */
export function TableSelect({ value, onChange, placeholder, creatable, disabled, allowClear = true }: { value: unknown; onChange: (v: string | null) => void; placeholder?: string; creatable?: boolean; disabled?: boolean; allowClear?: boolean }) {
  const { schema } = useSchema();
  const options = useMemo(
    () =>
      [...(schema?.tables.values() ?? [])]
        .filter((t) => !t.virtual && !["flow", "flow_version", "flow_connection", "schedule"].includes(t.key) && (!creatable || t.can.create))
        .map((t) => ({ value: t.key, label: t.plural }))
        .sort((a, b) => a.label.localeCompare(b.label, "fa")),
    [schema, creatable],
  );
  return (
    <Select
      showSearch
      optionFilterProp="label"
      allowClear={allowClear}
      value={typeof value === "string" && value ? value : undefined}
      placeholder={placeholder ?? "جدول"}
      options={options}
      onChange={(v) => onChange(v ?? null)}
      disabled={disabled}
    />
  );
}

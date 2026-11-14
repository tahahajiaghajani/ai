// The settings a field type or a library field may set (design F §3.1): only what its built-in type allows
// (`BuiltinFieldType.editable`) — length and pattern, numbers' limits and decimals, money's unit, date limits as tokens
// or dates, the files a «پیوست» takes, a reference's table and condition — and, for choice types, the options:
// their own, a shared list, or (an organisation's type that has them) the type's. The server cleans and checks the
// same keys (`cleanSettings`) and answers in Persian.
import { Checkbox, Input, Radio, Select } from "antd";
import type { Cond } from "@shared/model/conditions";
import type { BuiltinFieldType, SettingKey } from "@shared/forms/fieldtypes";
import { FILE_KINDS } from "@shared/forms/validators";
import { NumberInput } from "../../../../components/inputs";
import { FilterBuilder } from "../../../../records/filter/FilterBuilder";
import type { Schema } from "../../../../records/model/schema";
import { editableKeys, isChoiceStorage, type OptionsMode, type SettingsDraft } from "./model";
import { F, OptionsEditor } from "./parts";

export interface SettingsEditorProps {
  b: BuiltinFieldType;
  value: SettingsDraft;
  onChange: (d: SettingsDraft) => void;
  schema: Schema | undefined;
  disabled?: boolean;
  /** the type behind a library field already gives options (its own or a list): the field may keep them */
  inherited?: boolean;
  errors?: Record<string, string>;
  /** element ids are prefixed (two sheets never share one) */
  idp: string;
}

const MIN_MAX_LABELS: Partial<Record<string, [string, string]>> = {
  money: ["کمترین مبلغ (ریال)", "بیشترین مبلغ (ریال)"],
  duration: ["کمترین مدت (ثانیه)", "بیشترین مدت (ثانیه)"],
};

export function SettingsEditor({ b, value: d, onChange, schema, disabled, inherited, errors = {}, idp }: SettingsEditorProps) {
  const keys = new Set<SettingKey>(editableKeys(b));
  const set = (p: Partial<SettingsDraft>) => onChange({ ...d, ...p });
  const decimals = b.base === "int" ? 0 : b.base === "money" ? 0 : 6;
  const files = b.settings.check === "attachments";
  const lists = Object.keys(schema?.choices ?? {}).sort();
  const target = d.ref ?? b.settings.ref ?? null;
  const targetDef = target ? schema?.def(target) : undefined;
  const tables = [...(schema?.tables.values() ?? [])].filter((t) => !t.virtual && t.key !== "user").sort((x, y) => x.plural.localeCompare(y.plural, "fa"));
  const [minLabel, maxLabel] = MIN_MAX_LABELS[b.base] ?? ["کمینه", "بیشینه"];
  const choice = isChoiceStorage(b.base) && (b.editable.includes("options") || b.editable.includes("choices"));
  const modes: { value: OptionsMode; label: string }[] = [
    { value: "inline", label: "گزینه‌های همین‌جا" },
    { value: "list", label: "یک فهرست گزینهٔ مشترک" },
    ...(inherited ? [{ value: "inherit" as const, label: "گزینه‌های نوع" }] : []),
  ];
  const nothing = !keys.size && !choice;
  return (
    <div className="wff-grid">
      {nothing ? <p className="rk-hint wff-wide">این نوع تنظیم دیگری ندارد.</p> : null}
      {keys.has("maxLength") ? (
        <F label="حداکثر طول" htmlFor={`${idp}-maxlen`} error={errors.maxLength}>
          <NumberInput id={`${idp}-maxlen`} value={d.maxLength ?? null} decimals={0} onChange={(v) => set({ maxLength: v === null ? null : Number(v) })} disabled={disabled} placeholder="پیش‌فرض" />
        </F>
      ) : null}
      {keys.has("ltr") ? (
        <F label="جهت نوشتن">
          <Checkbox checked={d.ltr === true} onChange={(e) => set({ ltr: e.target.checked || undefined })} disabled={disabled}>
            چپ‌به‌راست (لاتین و رقم)
          </Checkbox>
        </F>
      ) : null}
      {keys.has("pattern") ? (
        <F
          label="الگو"
          htmlFor={`${idp}-pattern`}
          error={errors.pattern}
          hint={
            <>
              عبارت منظم؛ مانند <bdi dir="ltr" className="ds-mono">{"^\\d{6}$"}</bdi> برای شش رقم
            </>
          }
          className="wff-wide"
        >
          <Input id={`${idp}-pattern`} dir="ltr" className="ds-mono" value={d.pattern ?? ""} onChange={(e) => set({ pattern: e.target.value })} disabled={disabled} maxLength={300} />
        </F>
      ) : null}
      {keys.has("patternMessage") && d.pattern ? (
        <F label="پیام نادرستی" htmlFor={`${idp}-pmsg`} className="wff-wide">
          <Input id={`${idp}-pmsg`} value={d.patternMessage ?? ""} onChange={(e) => set({ patternMessage: e.target.value })} disabled={disabled} maxLength={200} placeholder="کد پرسنلی شش رقم است" />
        </F>
      ) : null}
      {keys.has("min") ? (
        <F label={minLabel} htmlFor={`${idp}-min`}>
          <NumberInput id={`${idp}-min`} value={d.min ?? null} decimals={decimals} allowNegative onChange={(v) => set({ min: v === null ? null : Number(v) })} disabled={disabled} />
        </F>
      ) : null}
      {keys.has("max") ? (
        <F label={files ? "بیشترین شمار پرونده‌ها" : b.base === "rating" ? "بیشترین امتیاز" : maxLabel} htmlFor={`${idp}-max`}>
          <NumberInput id={`${idp}-max`} value={d.max ?? null} decimals={files || b.base === "rating" ? 0 : decimals} allowNegative={!files && b.base !== "rating"} onChange={(v) => set({ max: v === null ? null : Number(v) })} disabled={disabled} placeholder={files || b.base === "rating" ? String(b.settings.max ?? "") : undefined} />
        </F>
      ) : null}
      {keys.has("decimals") ? (
        <F label="رقم‌های اعشار" htmlFor={`${idp}-dec`}>
          <NumberInput id={`${idp}-dec`} value={d.decimals ?? null} decimals={0} onChange={(v) => set({ decimals: v === null ? null : Number(v) })} disabled={disabled} placeholder="آزاد" />
        </F>
      ) : null}
      {keys.has("unit") ? (
        <F label="واحد نمایش" htmlFor={`${idp}-unit`} hint="مبلغ همیشه به ریال ذخیره می‌شود">
          <Select
            id={`${idp}-unit`}
            value={d.unit ?? ""}
            onChange={(v) => set({ unit: v ? (v as "rial" | "toman") : null })}
            options={[
              { value: "", label: "همان واحد سازمان" },
              { value: "rial", label: "ریال" },
              { value: "toman", label: "تومان" },
            ]}
            disabled={disabled}
          />
        </F>
      ) : null}
      {keys.has("minDate") ? (
        <F label="از تاریخ" htmlFor={`${idp}-mind`} hint={<>مانند <bdi dir="ltr" className="ds-mono">$today</bdi>، <bdi dir="ltr" className="ds-mono">$today-7d</bdi> یا <bdi dir="ltr" className="ds-mono">2026-03-21</bdi></>}>
          <Input id={`${idp}-mind`} dir="ltr" className="ds-mono" value={d.minDate ?? ""} onChange={(e) => set({ minDate: e.target.value })} disabled={disabled} placeholder="$today" />
        </F>
      ) : null}
      {keys.has("maxDate") ? (
        <F label="تا تاریخ" htmlFor={`${idp}-maxd`} hint={<>مانند <bdi dir="ltr" className="ds-mono">$today+30d</bdi> یا <bdi dir="ltr" className="ds-mono">2026-12-31</bdi></>}>
          <Input id={`${idp}-maxd`} dir="ltr" className="ds-mono" value={d.maxDate ?? ""} onChange={(e) => set({ maxDate: e.target.value })} disabled={disabled} placeholder="$today+30d" />
        </F>
      ) : null}
      {keys.has("accept") ? (
        <F label="نوع پرونده‌ها" htmlFor={`${idp}-accept`} hint="خالی: هر پرونده‌ای؛ پسوندها را هم می‌توان نوشت" className="wff-wide">
          <Select
            id={`${idp}-accept`}
            mode="tags"
            value={d.accept ?? []}
            onChange={(v: string[]) => set({ accept: v.map((x) => x.trim().toLowerCase().replace(/^\./, "")).filter(Boolean) })}
            options={Object.entries(FILE_KINDS).map(([k, x]) => ({ value: k, label: x.label }))}
            tokenSeparators={[",", "،", " "]}
            disabled={disabled}
            placeholder="هر پرونده‌ای"
          />
        </F>
      ) : null}
      {keys.has("ref") ? (
        <F label="جدول مقصد" htmlFor={`${idp}-ref`} error={errors.ref} className="wff-wide">
          <Select
            id={`${idp}-ref`}
            value={d.ref ?? undefined}
            onChange={(v) => set({ ref: v ?? null, refFilter: null })}
            options={tables.map((t) => ({ value: t.key, label: t.plural }))}
            showSearch={{ optionFilterProp: "label" }}
            disabled={disabled}
            placeholder="جدول"
          />
        </F>
      ) : null}
      {keys.has("refFilter") && targetDef && schema ? (
        <F label="فقط رکوردهایی که…" className="wff-wide" hint="خالی: همهٔ رکوردهای جدول">
          <FilterBuilder def={targetDef} schema={schema} value={d.refFilter ?? null} onChange={(c: Cond | null) => set({ refFilter: c })} disabled={disabled} />
        </F>
      ) : null}
      {choice ? (
        <F label="گزینه‌ها" error={errors.options} className="wff-wide">
          <Radio.Group value={d.optionsMode} onChange={(e) => set({ optionsMode: e.target.value })} options={modes} disabled={disabled} />
          {d.optionsMode === "list" ? (
            <Select value={d.choices ?? undefined} onChange={(v) => set({ choices: v ?? null })} options={lists.map((l) => ({ value: l, label: l }))} showSearch placeholder="فهرست گزینه" disabled={disabled} aria-label="فهرست گزینه" />
          ) : d.optionsMode === "inline" ? (
            <OptionsEditor value={d.options} onChange={(options) => set({ options })} disabled={disabled} />
          ) : null}
        </F>
      ) : null}
    </div>
  );
}

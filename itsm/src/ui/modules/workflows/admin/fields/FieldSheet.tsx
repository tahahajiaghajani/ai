// The side sheet of a library field «فیلد» (design F §3.1, §8.1): on top «پیش‌نمایش» — the live input as a form shows
// it, money in the organisation's unit — then «پایه» (label, technical name, type, help, sample text), «اعتبارسنجی»
// (what the type allows), «پیش‌فرض و گزینه‌ها», «دسترسی» (the field group, list column, search, filters) and where the
// field is used. A field in use keeps its name and its storage; «بازنشسته کردن» says what it means first. Writes go
// to F1's routes (`process_design` write or `settings` edit); a person who may only read sees the same sheet, read-only.
import { useEffect, useId, useMemo, useState } from "react";
import { Button, Checkbox, Drawer, Input, Select } from "antd";
import { Archive, ArchiveRestore } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoneyUnit } from "@shared/financial/logic";
import { FIELD_GROUPS, FIELD_TYPES } from "@shared/model/types";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { Note } from "../../../../components/blocks";
import { Chip, Loader } from "../../../../components/display";
import { useRefreshSchema, useSchema } from "../../../../records/data/hooks";
import { fieldErrorsOf } from "../../../../records/model/types";
import { FIELD_KEYS, fieldsApi, type LibraryEntry, type TypesResult } from "./api";
import {
  RETIRE_TEXT, fieldDraft, fieldDraftProblems, fieldPayload, isChoiceStorage, isUsed, optionsModeOf, previewField, resolvedType, typeChoices, typeHasOptions, typeOptions, usageText,
  type FieldDraft, type FieldsAccess,
} from "./model";
import { FieldPreview } from "./Preview";
import { SettingsEditor } from "./SettingsEditor";
import { F, I16, useCloseGuard, useSheetSize } from "./parts";
import { UsageList } from "./Usage";

export interface FieldSheetProps {
  /** the library field's id; null: a new field */
  id: string | null;
  entry: LibraryEntry | null;
  library: readonly LibraryEntry[];
  types: TypesResult | undefined;
  unit: MoneyUnit;
  access: FieldsAccess;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function FieldSheet({ id, entry, library, types, unit, access, onClose, onSaved }: FieldSheetProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const refresh = useRefreshSchema();
  const { schema } = useSchema();
  const idp = useId().replace(/:/g, "");
  const size = useSheetSize(600);
  const row = useQuery({ queryKey: FIELD_KEYS.row(orgId, "field_def", id ?? "new"), queryFn: () => fieldsApi.row(api, "field_def", id!), enabled: !!id });
  const initial = useMemo(() => (id ? (row.data ? fieldDraft(row.data) : null) : fieldDraft(null)), [id, row.data]);
  const [d, setD] = useState<FieldDraft | null>(initial);
  useEffect(() => setD(initial), [initial]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const used = isUsed(entry?.usage);
  const retired = entry?.status === "retired";
  const readOnly = !access.designWrite;
  const t = resolvedType(d?.type, types);
  const inherited = typeHasOptions(t);
  const draft = d ? { ...d, settings: { ...d.settings, optionsMode: optionsModeOf(d.settings, t) } } : d;
  const dirty = !!d && !!initial && JSON.stringify(d) !== JSON.stringify(initial);
  const close = useCloseGuard(dirty && !readOnly, onClose);
  const preview = useMemo(() => (draft ? previewField(draft, t) : null), [draft, t]);
  const options = typeOptions(typeChoices(types), types?.groups ?? ({} as TypesResult["groups"]), { storage: used ? (entry?.storage ?? null) : null, current: d?.type });
  // the group of sensitivity of a field on tables is the tables' to change (`settings` edit, F1's rule)
  const groupLocked = used && !!entry?.usage.tables.length && !access.settingsEdit;
  const choiceFields = library.filter((f) => f.id !== id && (f.storage === "choice" || f.storage === "multichoice"));
  const set = (p: Partial<FieldDraft>) => setD((x) => (x ? { ...x, ...p } : x));

  const after = async (newId: string) => {
    await Promise.all([qc.invalidateQueries({ queryKey: FIELD_KEYS.all(orgId) }), refresh()]);
    onSaved(newId);
  };
  const save = async () => {
    if (!draft || !t) return;
    const problems = fieldDraftProblems(draft, t);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const r = await fieldsApi.saveField(api, id, fieldPayload(draft, t));
      n.ok(`فیلد «${draft.label.trim()}» ذخیره شد`);
      await after(String(r.row.id));
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (Object.keys(fe).length) setErrors(fe);
      else n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (status: "active" | "retired") => {
    if (!id || !entry) return;
    if (status === "retired" && !(await n.confirm(`بازنشسته کردن «${entry.label}»؟`, RETIRE_TEXT, false, "بازنشسته کردن"))) return;
    setBusy(true);
    try {
      await fieldsApi.saveField(api, id, { status });
      n.ok(status === "retired" ? `«${entry.label}» بازنشسته شد` : `«${entry.label}» دوباره فعال شد`);
      await after(id);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const title = id ? (entry?.label ?? "فیلد") : "فیلد تازه";
  return (
    <Drawer
      open
      size={size}
      placement="left"
      title={
        <span className="wff-title">
          {title}
          {retired ? <Chip dot={false}>بازنشسته</Chip> : null}
        </span>
      }
      onClose={close}
      destroyOnHidden
      footer={
        readOnly ? null : (
          <div className="wff-foot">
            {id && entry ? (
              retired ? (
                <Button icon={<ArchiveRestore {...I16} />} onClick={() => setStatus("active")} disabled={busy}>
                  فعال کردن دوباره
                </Button>
              ) : (
                <Button icon={<Archive {...I16} />} onClick={() => setStatus("retired")} disabled={busy}>
                  بازنشسته کردن
                </Button>
              )
            ) : null}
            <span className="wff-foot-gap" />
            <Button onClick={close}>انصراف</Button>
            <Button type="primary" onClick={save} loading={busy} disabled={!draft || !t || (!!id && !dirty)}>
              ذخیره
            </Button>
          </div>
        )
      }
    >
      {!draft ? (
        <div className="grid place-items-center py-10">
          <Loader />
        </div>
      ) : (
        <div className="wff-sheet">
          <section className="wff-sec" aria-labelledby={`${idp}-pv`}>
            <h3 id={`${idp}-pv`}>پیش‌نمایش</h3>
            <FieldPreview field={preview} unit={unit} />
          </section>
          {used ? (
            <Note>
              این فیلد در {usageText(entry?.usage)} به کار رفته است؛ نام فنی و نوع ذخیره‌اش ثابت می‌ماند و سخت‌تر کردن اعتبارسنجی فقط ثبت‌های تازه را
              می‌سنجد.
            </Note>
          ) : null}
          <section className="wff-sec" aria-labelledby={`${idp}-base`}>
            <h3 id={`${idp}-base`}>پایه</h3>
            <div className="wff-grid">
              <F label="برچسب" htmlFor={`${idp}-label`} error={errors.label}>
                <Input id={`${idp}-label`} value={draft.label} onChange={(e) => set({ label: e.target.value })} maxLength={80} disabled={readOnly} autoFocus={!id} />
              </F>
              <F label="نام فنی" htmlFor={`${idp}-name`} error={errors.name} hint={used ? "پس از نخستین کاربرد تغییر نمی‌کند" : "در API، گزارش‌ها و ورود از اکسل"}>
                <span dir="ltr" className="wff-ltr">
                  <Input
                    id={`${idp}-name`}
                    className="ds-mono"
                    prefix={<span className="text-ink-3">u_</span>}
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                    maxLength={40}
                    disabled={readOnly || used}
                    placeholder="national_id"
                  />
                </span>
              </F>
              <F label="نوع فیلد" htmlFor={`${idp}-type`} error={errors.type} hint={used ? "فقط نوعی با همان نوع ذخیره" : undefined}>
                <Select id={`${idp}-type`} value={draft.type} onChange={(v) => set({ type: v })} options={options} showSearch={{ optionFilterProp: "label" }} disabled={readOnly} />
              </F>
              <F label="متن نمونه" htmlFor={`${idp}-ph`}>
                <Input id={`${idp}-ph`} value={draft.placeholder} onChange={(e) => set({ placeholder: e.target.value })} maxLength={120} disabled={readOnly} />
              </F>
              <F label="راهنما" htmlFor={`${idp}-help`} className="wff-wide">
                <Input.TextArea id={`${idp}-help`} value={draft.help} onChange={(e) => set({ help: e.target.value })} maxLength={300} autoSize={{ minRows: 1, maxRows: 4 }} disabled={readOnly} />
              </F>
            </div>
          </section>
          {t ? (
            <section className="wff-sec" aria-labelledby={`${idp}-val`}>
              <h3 id={`${idp}-val`}>{isChoiceStorage(t.base) ? "اعتبارسنجی و گزینه‌ها" : "اعتبارسنجی"}</h3>
              <SettingsEditor b={t.builtin} value={draft.settings} onChange={(settings) => set({ settings })} schema={schema} disabled={readOnly} inherited={inherited} errors={errors} idp={idp} />
            </section>
          ) : null}
          <section className="wff-sec" aria-labelledby={`${idp}-def`}>
            <h3 id={`${idp}-def`}>پیش‌فرض</h3>
            <div className="wff-grid">
              <F
                label="مقدار پیش‌فرض"
                htmlFor={`${idp}-dv`}
                hint={
                  <>
                    یک مقدار، یا <bdi dir="ltr">$today</bdi>، <bdi dir="ltr">$now</bdi>، <bdi dir="ltr">$me</bdi>، <bdi dir="ltr">$my_unit</bdi>
                  </>
                }
              >
                <Input id={`${idp}-dv`} dir="ltr" className="ds-mono" value={draft.default_value} onChange={(e) => set({ default_value: e.target.value })} maxLength={500} disabled={readOnly} />
              </F>
              {t && isChoiceStorage(t.base) ? (
                <F label="وابسته به" htmlFor={`${idp}-dep`} hint="گزینه‌ها با مقدار این فیلد پالایش می‌شوند">
                  <Select
                    id={`${idp}-dep`}
                    value={draft.depends_on ?? undefined}
                    allowClear
                    onChange={(v) => set({ depends_on: v ?? null })}
                    options={choiceFields.map((f) => ({ value: f.name, label: f.label }))}
                    disabled={readOnly}
                    placeholder="هیچ"
                  />
                </F>
              ) : null}
            </div>
          </section>
          <section className="wff-sec" aria-labelledby={`${idp}-acc`}>
            <h3 id={`${idp}-acc`}>دسترسی</h3>
            <div className="wff-grid">
              <F label="گروه حساسیت" htmlFor={`${idp}-grp`} hint={groupLocked ? "این فیلد در جدول‌ها به کار رفته است؛ تغییر گروهش با دسترسی «تنظیمات سازمان» است" : "فقط دارندگان این گروه فیلد آن را می‌بینند"}>
                <Select
                  id={`${idp}-grp`}
                  value={draft.field_group ?? undefined}
                  allowClear
                  onChange={(v) => set({ field_group: v ?? null })}
                  options={Object.entries(FIELD_GROUPS).map(([value, label]) => ({ value, label }))}
                  disabled={readOnly || groupLocked}
                  placeholder="همه"
                />
              </F>
              <F label="در فهرست‌ها">
                <span className="wff-checks">
                  <Checkbox checked={draft.list} onChange={(e) => set({ list: e.target.checked })} disabled={readOnly}>
                    ستون پیش‌فرض
                  </Checkbox>
                  <Checkbox checked={draft.filter} onChange={(e) => set({ filter: e.target.checked })} disabled={readOnly}>
                    در پالایه‌ها
                  </Checkbox>
                  {t && FIELD_TYPES[t.base]?.sql === "text" ? (
                    <Checkbox checked={draft.search} onChange={(e) => set({ search: e.target.checked })} disabled={readOnly}>
                      در جست‌وجو
                    </Checkbox>
                  ) : null}
                </span>
              </F>
            </div>
          </section>
          {entry && used ? (
            <section className="wff-sec" aria-labelledby={`${idp}-use`}>
              <h3 id={`${idp}-use`}>به کار رفته در</h3>
              <UsageList usage={entry.usage} />
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

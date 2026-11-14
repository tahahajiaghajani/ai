// The side sheet of a field type «نوع فیلد» (design F §3.1, §8.1): a built-in type read-only with its lock chip
// «پیش‌فرض»; an organisation's type editable — «بر پایهٔ» (a built-in type), its widget within the storage type, the
// validation and display its base allows, options for choice types — with the same live preview as a field. Editing a
// type in use may change labels, messages, limits and the widget within its storage; tightening applies to new writes.
import { useEffect, useId, useMemo, useState } from "react";
import { Button, Drawer, Input, Select } from "antd";
import { Archive, ArchiveRestore, Lock } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoneyUnit } from "@shared/financial/logic";
import { FIELD_TYPES } from "@shared/model/types";
import { WIDGET_LABELS, builtinFieldType, libraryFieldDef, resolveFieldType, widgetsFor } from "@shared/forms/fieldtypes";
import { faDigits } from "@shared/format";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { Note } from "../../../../components/blocks";
import { Chip, Loader } from "../../../../components/display";
import { useRefreshSchema, useSchema } from "../../../../records/data/hooks";
import { fieldErrorsOf } from "../../../../records/model/types";
import { FIELD_KEYS, fieldsApi, type OrgTypeEntry, type TypesResult } from "./api";
import { draftType, settingsLines, typeDraft, typeDraftProblems, typePayload, type TypeDraft, type FieldsAccess } from "./model";
import { FieldPreview } from "./Preview";
import { SettingsEditor } from "./SettingsEditor";
import { F, I14, I16, useCloseGuard, useSheetSize } from "./parts";

export type TypeSheetTarget = { builtin: string } | { id: string | null };

export interface TypeSheetProps {
  target: TypeSheetTarget;
  types: TypesResult | undefined;
  unit: MoneyUnit;
  access: FieldsAccess;
  onClose: () => void;
  onSaved: () => void;
}

/** A sample field of a type, for its preview. */
const sampleOf = (t: ReturnType<typeof resolveFieldType>, label: string) => (t ? libraryFieldDef({ name: "u_preview", label, type: t.key }, t) : null);

export function TypeSheet(p: TypeSheetProps) {
  return "builtin" in p.target ? <BuiltinSheet {...p} keyOf={p.target.builtin} /> : <OrgTypeSheet {...p} id={p.target.id} />;
}

function BuiltinSheet({ keyOf, types, unit, onClose }: TypeSheetProps & { keyOf: string }) {
  const size = useSheetSize(520);
  const entry = types?.builtin.find((b) => b.key === keyOf);
  const t = resolveFieldType(keyOf);
  const sample = useMemo(() => sampleOf(t, entry?.label ?? keyOf), [t, entry, keyOf]);
  const settings = t ? settingsLines(t) : [];
  return (
    <Drawer
      open
      size={size}
      placement="left"
      onClose={onClose}
      destroyOnHidden
      title={
        <span className="wff-title">
          {entry?.label ?? keyOf}
          <Chip dot={false}>
            <span className="inline-flex items-center gap-1">
              <Lock {...I14} aria-hidden /> پیش‌فرض
            </span>
          </Chip>
        </span>
      }
    >
      <div className="wff-sheet">
        <section className="wff-sec">
          <h3>پیش‌نمایش</h3>
          <FieldPreview field={sample} unit={unit} />
        </section>
        {t ? (
          <section className="wff-sec">
            <h3>ویژگی‌ها</h3>
            <dl className="wff-facts">
              <div>
                <dt>گروه</dt>
                <dd>{types?.groups[t.group]}</dd>
              </div>
              <div>
                <dt>نوع ذخیره</dt>
                <dd>{FIELD_TYPES[t.base]?.label ?? t.base}</dd>
              </div>
              <div>
                <dt>نمایش</dt>
                <dd>{WIDGET_LABELS[t.settings.widget]}</dd>
              </div>
              {settings.length ? (
                <div>
                  <dt>تنظیم‌ها</dt>
                  <dd>{settings.join("، ")}</dd>
                </div>
              ) : null}
              <div>
                <dt>فیلدهای این نوع</dt>
                <dd>{faDigits(entry?.fields ?? 0)}</dd>
              </div>
            </dl>
            <p className="rk-hint">نوع‌های پیش‌فرض تغییر نمی‌کنند؛ برای نسخهٔ خود سازمان، «نوع فیلد تازه» را بر پایهٔ همین نوع بسازید.</p>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

function OrgTypeSheet({ id, types, unit, access, onClose, onSaved }: TypeSheetProps & { id: string | null }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const refresh = useRefreshSchema();
  const { schema } = useSchema();
  const idp = useId().replace(/:/g, "");
  const size = useSheetSize(600);
  const entry: OrgTypeEntry | undefined = id ? types?.types.find((x) => x.id === id) : undefined;
  const row = useQuery({ queryKey: FIELD_KEYS.row(orgId, "field_type", id ?? "new"), queryFn: () => fieldsApi.row(api, "field_type", id!), enabled: !!id });
  const initial = useMemo(() => (id ? (row.data ? typeDraft(row.data) : null) : typeDraft(null)), [id, row.data]);
  const [d, setD] = useState<TypeDraft | null>(initial);
  useEffect(() => setD(initial), [initial]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const readOnly = !access.designWrite;
  const used = (entry?.fields ?? 0) > 0;
  const retired = entry?.status === "retired";
  const dirty = !!d && !!initial && JSON.stringify(d) !== JSON.stringify(initial);
  const close = useCloseGuard(dirty && !readOnly, onClose);
  const b = d ? builtinFieldType(d.base) : undefined;
  const resolved = useMemo(() => (d ? draftType(d) : null), [d]);
  const sample = useMemo(() => sampleOf(resolved, d?.name || b?.label || "نمونه"), [resolved, d?.name, b]);
  const set = (p: Partial<TypeDraft>) => setD((x) => (x ? { ...x, ...p } : x));
  // a type in use keeps its storage: only bases of the same storage type
  const bases = (types?.builtin ?? []).filter((x) => x.available && (!used || !b || x.storage === b.base));
  const baseOptions = Object.entries(types?.groups ?? {})
    .map(([g, label]) => ({ label, options: bases.filter((x) => x.group === g).map((x) => ({ value: x.key, label: x.label })) }))
    .filter((g) => g.options.length);
  const widgets = b ? widgetsFor(b.base, b.settings.ref) : [];

  const after = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: FIELD_KEYS.all(orgId) }), refresh()]);
    onSaved();
  };
  const save = async () => {
    if (!d) return;
    const problems = typeDraftProblems(d);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const body = typePayload(d);
      // the key never changes once made
      if (id) delete body.key;
      await fieldsApi.saveType(api, id, body);
      n.ok(`نوع «${d.name.trim()}» ذخیره شد`);
      await after();
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
    if (status === "retired" && !(await n.confirm(`بازنشسته کردن نوع «${entry.name}»؟`, "برای فیلدهای تازه پیشنهاد نمی‌شود؛ فیلدهایی که از آن ساخته شده‌اند می‌مانند.", false, "بازنشسته کردن"))) return;
    setBusy(true);
    try {
      await fieldsApi.saveType(api, id, { status });
      n.ok(status === "retired" ? `نوع «${entry.name}» بازنشسته شد` : `نوع «${entry.name}» دوباره فعال شد`);
      await after();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      size={size}
      placement="left"
      onClose={close}
      destroyOnHidden
      title={
        <span className="wff-title">
          {id ? (entry?.name ?? "نوع فیلد") : "نوع فیلد تازه"}
          {retired ? <Chip dot={false}>بازنشسته</Chip> : null}
        </span>
      }
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
            <Button type="primary" onClick={save} loading={busy} disabled={!d || (!!id && !dirty)}>
              ذخیره
            </Button>
          </div>
        )
      }
    >
      {!d ? (
        <div className="grid place-items-center py-10">
          <Loader />
        </div>
      ) : (
        <div className="wff-sheet">
          <section className="wff-sec" aria-labelledby={`${idp}-pv`}>
            <h3 id={`${idp}-pv`}>پیش‌نمایش</h3>
            <FieldPreview field={sample} unit={unit} />
          </section>
          {used ? (
            <Note>
              {faDigits(entry?.fields ?? 0)} فیلد از این نوع ساخته شده است؛ نوع ذخیره‌اش ثابت می‌ماند، نمایش فقط میان نمایش‌های همان نوع ذخیره عوض می‌شود و
              سخت‌تر کردن اعتبارسنجی فقط ثبت‌های تازه را می‌سنجد.
            </Note>
          ) : null}
          <section className="wff-sec" aria-labelledby={`${idp}-base`}>
            <h3 id={`${idp}-base`}>پایه</h3>
            <div className="wff-grid">
              <F label="نام" htmlFor={`${idp}-name`} error={errors.name}>
                <Input id={`${idp}-name`} value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} disabled={readOnly} autoFocus={!id} placeholder="کد پرسنلی" />
              </F>
              <F label="کلید" htmlFor={`${idp}-key`} error={errors.key} hint={id ? "پس از ساخت تغییر نمی‌کند" : undefined}>
                <Input
                  id={`${idp}-key`}
                  dir="ltr"
                  className="ds-mono"
                  prefix={<span className="text-ink-3">u_</span>}
                  value={d.key}
                  onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                  maxLength={40}
                  disabled={readOnly || !!id}
                  placeholder="personnel_code"
                />
              </F>
              <F label="بر پایهٔ" htmlFor={`${idp}-b`} error={errors.base} hint={used ? "فقط نوعی با همان نوع ذخیره" : undefined}>
                <Select id={`${idp}-b`} value={d.base} onChange={(v) => set({ base: v, widget: null })} options={baseOptions} showSearch={{ optionFilterProp: "label" }} disabled={readOnly} />
              </F>
              <F label="نمایش" htmlFor={`${idp}-w`}>
                <Select
                  id={`${idp}-w`}
                  value={d.widget ?? b?.settings.widget}
                  onChange={(v) => set({ widget: v })}
                  options={widgets.map((w) => ({ value: w, label: WIDGET_LABELS[w] }))}
                  disabled={readOnly || widgets.length < 2}
                />
              </F>
              <F label="شرح" htmlFor={`${idp}-desc`} className="wff-wide">
                <Input.TextArea id={`${idp}-desc`} value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} autoSize={{ minRows: 1, maxRows: 4 }} disabled={readOnly} />
              </F>
            </div>
          </section>
          {b ? (
            <section className="wff-sec" aria-labelledby={`${idp}-val`}>
              <h3 id={`${idp}-val`}>اعتبارسنجی و نمایش</h3>
              <SettingsEditor b={b} value={d.settings} onChange={(settings) => set({ settings })} schema={schema} disabled={readOnly} errors={errors} idp={idp} />
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

// «قانون اعلان»: when (table, event, a custom event's name, the note kinds, a condition built with FilterBuilder on
// the record after the change plus an optional «تغییر» trigger that compares with the value before it), to whom
// (people on the record, its user and group fields, members, groups, roles; the person who made the change is left
// out unless chosen), how (channels, outside channels, template, digest, mandatory) and a preview on a sample record
// as the caller would receive it. A built-in is edited as a copy that replaces it; «بازگشت به پیش‌فرض» deletes the
// copy. Every recipient later gets only what they may read (the server renders per recipient).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Button, Checkbox, Input, Popconfirm, Select, Switch } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, RotateCcw, Trash2 } from "lucide-react";
import { NOTIFY_CHANNELS, NOTIFY_EVENTS, NOTIFY_EVENT_KEYS, type NotifyChannel, type NotifyEvent } from "@shared/notify";
import { ENTRY_KIND_OPTIONS } from "@shared/tables/notify";
import type { Cond, Leaf } from "@shared/model/conditions";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14, Note } from "../../components/blocks";
import { EmptyState, Skeleton } from "../../components/display";
import { FilterBuilder } from "../../records/filter/FilterBuilder";
import { FieldInput } from "../../records/fields/FieldInput";
import { RecordSelect } from "../../records/fields/RecordSelect";
import { useRecord, useSchema, keys as recordKeys } from "../../records/data/hooks";
import { recordsApi } from "../../records/data/api";
import { fieldErrorsOf, type TableMeta } from "../../records/model/types";
import { KEYS, useRules } from "./api";
import { CHANGE_OPS, CHANGE_OP_LABELS, joinChange, splitChange, type ChangeOp } from "./model";
import { NEW_RULE, RecipientsPicker, TableSelect, draftOf, rowOf, type RuleDraft } from "./parts";
import { PreviewPanel } from "./Preview";
import "./notify.css";

function F({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`nf-field${wide ? " nf-wide" : ""}`}>
      <span className="nf-label">{label}</span>
      {children}
      {error ? <span className="nf-err">{error}</span> : null}
    </label>
  );
}

const EVENT_OPTIONS = NOTIFY_EVENT_KEYS.map((k) => ({ value: k, label: NOTIFY_EVENTS[k].label }));
const CHANNEL_OPTIONS = (Object.keys(NOTIFY_CHANNELS) as NotifyChannel[]).map((k) => ({ value: k, label: NOTIFY_CHANNELS[k].label }));

export default function RuleEditor({ mode }: { mode: "new" | "builtin" | "row" }) {
  const { id, key } = useParams();
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const { schema } = useSchema();
  const rules = useRules(mode === "builtin");
  const rec = useRecord(mode === "row" ? "notification_rule" : null, mode === "row" ? id : null);
  const builtin = mode === "builtin" ? rules.data?.rules.find((r) => r.builtin === key && (r.is_builtin || r.replaces)) : undefined;

  const source = useMemo<RuleDraft | null>(() => {
    if (mode === "new") return NEW_RULE;
    if (mode === "builtin") return builtin ? draftOf(builtin) : null;
    return rec.data ? draftOf(rec.data.row) : null;
  }, [mode, builtin, rec.data]);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(null);
    setErrors({});
  }, [mode, id, key]);

  const d = draft ?? source;
  const def = d?.table_key && d.table_key !== "*" ? schema?.def(d.table_key) : undefined;
  const split = useMemo(() => splitChange(d?.condition), [d?.condition]);
  const canWrite = mode === "row" ? !!rec.data?.meta.canWrite : !!schema?.def("notification_rule")?.can.create;
  const set = (p: Partial<RuleDraft>) => d && setDraft({ ...d, ...p });
  const setCond = (base: Cond | null, change: Leaf | null) => set({ condition: joinChange(base, change) });

  if (mode === "builtin" && builtin?.replaces && builtin.id) return <Navigate to={`/${orgId}/notify/rules/${builtin.id}`} replace />;

  const title = mode === "new" ? "قانون اعلان تازه" : (d?.name ?? "قانون اعلان");
  const loading = (mode === "row" && rec.isLoading) || (mode === "builtin" && rules.isLoading) || !schema;
  const missing = !loading && !d;

  const save = async () => {
    if (!d) return;
    setSaving(true);
    setErrors({});
    try {
      const data = rowOf(d);
      if (mode === "row") {
        await recordsApi.update(api, "notification_rule", id!, data, rec.data?.row.version);
        await qc.invalidateQueries({ queryKey: recordKeys.record(orgId, "notification_rule", id!) });
        setDraft(null);
      } else {
        const r = await recordsApi.create(api, "notification_rule", data);
        nav(`/${orgId}/notify/rules/${r.row.id}`, { replace: true });
      }
      void qc.invalidateQueries({ queryKey: KEYS.rules(orgId) });
      n.ok("قانون ذخیره شد.");
    } catch (e) {
      setErrors(fieldErrorsOf(e));
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      await recordsApi.remove(api, "notification_rule", id!, rec.data?.row.version);
      void qc.invalidateQueries({ queryKey: KEYS.rules(orgId) });
      n.ok(d?.builtin ? "قانون به پیش‌فرض برگشت." : "قانون حذف شد.");
      nav(`/${orgId}/notify/rules`);
    } catch (e) {
      n.error(e);
    }
  };

  const actions = (
    <>
      {mode === "row" && rec.data?.meta.canDelete ? (
        <Popconfirm
          title={d?.builtin ? "تغییرهای این قانون کنار گذاشته شود و قانون پیش‌فرض برگردد؟" : "این قانون حذف شود؟"}
          okText={d?.builtin ? "بازگشت" : "حذف"}
          cancelText="انصراف"
          onConfirm={remove}
        >
          <Button icon={d?.builtin ? <RotateCcw {...ICON14} /> : <Trash2 {...ICON14} />}>{d?.builtin ? "بازگشت به پیش‌فرض" : "حذف"}</Button>
        </Popconfirm>
      ) : null}
      {canWrite ? (
        <Button type="primary" loading={saving} disabled={mode !== "new" && !draft} onClick={save}>
          ذخیره
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} back={`/${orgId}/notify/rules`} actions={d ? actions : null} />
      {loading ? (
        <Skeleton rows={8} />
      ) : missing || !d ? (
        <EmptyState icon={BellRing} title="این قانون پیدا نشد" />
      ) : (
        <div className="nf-editor">
          <div className="flex min-w-0 flex-col gap-4">
            {d.builtin ? <Note>قانون پیش‌فرض؛ با ذخیره، نسخهٔ سازمان جای آن را می‌گیرد.</Note> : null}
            {errors.builtin ? <Note tone="danger">{errors.builtin}</Note> : null}
            <Card title="چه زمانی">
              <div className="nf-form">
                <F label="نام" error={errors.name}>
                  <Input value={d.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} disabled={!canWrite} status={errors.name ? "error" : undefined} />
                </F>
                <F label="فعال">
                  <Switch checked={d.active} onChange={(v) => set({ active: v })} disabled={!canWrite} aria-label="فعال" />
                </F>
                <F label="جدول" error={errors.table_key}>
                  <TableSelect
                    schema={schema}
                    value={d.table_key}
                    allowAll={!!d.builtin}
                    disabled={!canWrite || !!d.builtin}
                    status={errors.table_key ? "error" : undefined}
                    onChange={(v) => set({ table_key: v, condition: null, recipients: { ...d.recipients, fields: [] } })}
                  />
                </F>
                <F label="رویداد" error={errors.event}>
                  <Select value={d.event} options={EVENT_OPTIONS} onChange={(v: NotifyEvent) => set({ event: v, template_id: null })} disabled={!canWrite} aria-label="رویداد" />
                </F>
                {d.event === "custom" ? (
                  <F label="نام رویداد سفارشی" error={errors.custom_event} wide>
                    <Input dir="ltr" value={d.custom_event ?? ""} maxLength={80} placeholder="major_declared" onChange={(e) => set({ custom_event: e.target.value || null })} disabled={!canWrite} />
                  </F>
                ) : null}
                {d.event === "commented" || d.event === "mentioned" ? (
                  <F label="نوع یادداشت (خالی: همه)" wide>
                    <Checkbox.Group value={d.entry_kinds} options={ENTRY_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => set({ entry_kinds: v as string[] })} disabled={!canWrite} />
                  </F>
                ) : null}
                <div className="nf-field nf-wide">
                  <span className="nf-label">شرط</span>
                  {d.builtin ? (
                    <Note>قانون پیش‌فرض برای همهٔ جدول‌هاست و شرط نمی‌گیرد.</Note>
                  ) : !def ? (
                    <Note>نخست جدول را انتخاب کنید.</Note>
                  ) : split.complex ? (
                    <Note>این شرط با API نوشته شده و اینجا ویرایش نمی‌شود.</Note>
                  ) : (
                    <>
                      <FilterBuilder def={def} schema={schema!} value={split.base} onChange={(c) => setCond(c, split.change)} disabled={!canWrite} tz={timezone} />
                      <ChangeTrigger def={def} change={split.change} onChange={(c) => setCond(split.base, c)} disabled={!canWrite} tz={timezone} />
                    </>
                  )}
                  {errors.condition ? <span className="nf-err">{errors.condition}</span> : null}
                </div>
              </div>
            </Card>

            <Card title="به چه کسانی">
              <div className="flex flex-col gap-3">
                <RecipientsPicker value={d.recipients} onChange={(r) => set({ recipients: r })} def={def} schema={schema} display={rec.data?.display} disabled={!canWrite} />
                {errors.recipients ? <span className="nf-err text-[12px]">{errors.recipients}</span> : null}
                <Checkbox checked={d.notify_actor} onChange={(e) => set({ notify_actor: e.target.checked })} disabled={!canWrite}>
                  به انجام‌دهندهٔ تغییر هم خبر داده شود
                </Checkbox>
              </div>
            </Card>

            <Card title="از چه راهی">
              <div className="nf-form">
                <F label="راه‌های ارسال" error={errors.channels} wide>
                  <Checkbox.Group value={d.channels} options={CHANNEL_OPTIONS} onChange={(v) => set({ channels: v as NotifyChannel[] })} disabled={!canWrite} />
                </F>
                {d.channels.includes("webhook") || d.channels.includes("sms") ? (
                  <F label="کانال‌های بیرونی" error={errors.targets} wide>
                    <RecordSelect table="notification_channel" multiple value={d.targets} onChange={(v) => set({ targets: (v as string[] | null) ?? [] })} display={rec.data?.display} disabled={!canWrite} placeholder="پیام‌رسان، وب‌هوک یا درگاه پیامک" />
                  </F>
                ) : null}
                <F label="الگو" error={errors.template_id}>
                  <RecordSelect
                    table="notification_template"
                    value={d.template_id}
                    onChange={(v) => set({ template_id: (v as string | null) ?? null })}
                    filter={{ or: [{ f: "event", op: "eq", v: d.event }, { f: "event", op: "empty" }] }}
                    display={rec.data?.display}
                    disabled={!canWrite}
                    allowClear
                    placeholder="الگوی پیش‌فرض رویداد"
                  />
                </F>
                <F label="شیوه">
                  <div className="flex flex-col gap-1">
                    <Checkbox checked={d.digest} onChange={(e) => set({ digest: e.target.checked })} disabled={!canWrite}>
                      در خلاصهٔ ایمیلی گیرنده بیاید
                    </Checkbox>
                    <Checkbox checked={d.mandatory} onChange={(e) => set({ mandatory: e.target.checked })} disabled={!canWrite}>
                      اجباری (خاموش‌شدنی نیست و بی‌درنگ می‌رود)
                    </Checkbox>
                  </div>
                </F>
                <F label="توضیح" wide>
                  <Input.TextArea value={d.description ?? ""} maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(e) => set({ description: e.target.value || null })} disabled={!canWrite} />
                </F>
              </div>
            </Card>
          </div>
          <aside className="nf-side" aria-label="پیش‌نمایش">
            <PreviewPanel input={{ table: d.table_key ?? "*", event: d.event, template_id: d.template_id }} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** «فقط وقتی … تغییر کرد (به …)»: the rule-only operators, compared with the record before the change. */
function ChangeTrigger({ def, change, onChange, disabled, tz }: { def: TableMeta; change: Leaf | null; onChange: (c: Leaf | null) => void; disabled?: boolean; tz: string }) {
  const { schema } = useSchema();
  const fields = def.fields.filter((f) => !f.hidden && f.type !== "secret" && f.type !== "json" && f.type !== "markdown");
  const field = change ? def.fields.find((x) => x.name === change.f) : undefined;
  const op = (change?.op ?? "changed") as ChangeOp;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
      <span>و فقط وقتی</span>
      <Select
        size="small"
        className="min-w-40"
        allowClear
        placeholder="هر تغییری"
        value={change?.f}
        options={fields.map((f) => ({ value: f.name, label: f.label }))}
        onChange={(f?: string) => onChange(f ? { f, op: "changed" } : null)}
        disabled={disabled}
        aria-label="فیلدی که تغییر می‌کند"
      />
      {change ? (
        <Select
          size="small"
          value={op}
          options={CHANGE_OPS.map((o) => ({ value: o, label: CHANGE_OP_LABELS[o] }))}
          onChange={(o: ChangeOp) => onChange(o === "changed" ? { f: change.f, op: o } : { f: change.f, op: o, v: change.v ?? null })}
          disabled={disabled}
          aria-label="نوع تغییر"
        />
      ) : null}
      {change && field && op !== "changed" && schema ? (
        <div className="min-w-48">
          <FieldInput field={{ ...field, required: false }} value={change.v ?? null} onChange={(v) => onChange({ ...change, v })} def={def} schema={schema} compact disabled={disabled} tz={tz} aria-label="مقدار" />
        </div>
      ) : null}
    </div>
  );
}

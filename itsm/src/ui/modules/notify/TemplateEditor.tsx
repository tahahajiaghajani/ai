// «الگوی اعلان»: subject, Markdown body and the short text of SMS and messengers, with the placeholders of the chosen
// table (a click inserts one at the caret of the field last edited), problems of the template language shown as
// you type, the event's default text as a starting point, and a live preview on a sample record.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, Input, Popconfirm, Select, Switch, type InputRef } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2, Wand2 } from "lucide-react";
import { DEFAULT_TEMPLATES, NOTIFY_EVENTS, NOTIFY_EVENT_KEYS, parseTemplate, type NotifyEvent } from "@shared/notify";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { EmptyState, Skeleton } from "../../components/display";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../records/fields/MarkdownEditor";
import { useRecord, useSchema, keys as recordKeys } from "../../records/data/hooks";
import { recordsApi } from "../../records/data/api";
import { fieldErrorsOf } from "../../records/model/types";
import { tablePath } from "../../records/extensions";
import { insertAt, placeholderTag, placeholdersFor } from "./model";
import { TableSelect } from "./parts";
import { PreviewPanel } from "./Preview";
import "./notify.css";

interface TemplateDraft {
  name: string;
  event: NotifyEvent | null;
  table_key: string | null;
  subject: string;
  body: string;
  short_text: string;
  active: boolean;
  description: string;
}

const EMPTY: TemplateDraft = { name: "", event: null, table_key: null, subject: "", body: "", short_text: "", active: true, description: "" };
const EVENT_OPTIONS = NOTIFY_EVENT_KEYS.map((k) => ({ value: k, label: NOTIFY_EVENTS[k].label }));
type Slot = "subject" | "body" | "short_text";

function F({ label, error, wide, children }: { label: string; error?: string | null; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`nf-field${wide ? " nf-wide" : ""}`}>
      <span className="nf-label">{label}</span>
      {children}
      {error ? <span className="nf-err">{error}</span> : null}
    </div>
  );
}

export default function TemplateEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const n = useNotify();
  const { schema } = useSchema();
  const rec = useRecord(isNew ? null : "notification_template", isNew ? null : id);
  const source = useMemo<TemplateDraft | null>(() => {
    if (isNew) return EMPTY;
    const r = rec.data?.row;
    if (!r) return null;
    return {
      name: String(r.name ?? ""),
      event: (r.event as NotifyEvent | null) ?? null,
      table_key: (r.table_key as string | null) ?? null,
      subject: String(r.subject ?? ""),
      body: String(r.body ?? ""),
      short_text: String(r.short_text ?? ""),
      active: r.active !== false,
      description: String(r.description ?? ""),
    };
  }, [isNew, rec.data]);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [slot, setSlot] = useState<Slot>("body");
  const subjectRef = useRef<InputRef>(null);
  const shortRef = useRef<TextAreaRef>(null);
  const bodyRef = useRef<MarkdownEditorHandle>(null);
  useEffect(() => {
    setDraft(null);
    setErrors({});
  }, [id]);

  const d = draft ?? source;
  const set = (p: Partial<TemplateDraft>) => d && setDraft({ ...d, ...p });
  const canWrite = isNew ? !!schema?.def("notification_template")?.can.create : !!rec.data?.meta.canWrite;
  const def = d?.table_key ? schema?.def(d.table_key) : undefined;
  const placeholders = useMemo(() => placeholdersFor(def), [def]);
  const problems = useMemo(
    () => ({ subject: parseTemplate(d?.subject).error, body: parseTemplate(d?.body).error, short_text: parseTemplate(d?.short_text).error }),
    [d?.subject, d?.body, d?.short_text],
  );

  const insert = (path: string) => {
    if (!d || !canWrite) return;
    const tag = placeholderTag(path);
    if (slot === "body" && bodyRef.current) {
      bodyRef.current.insert(tag);
      return;
    }
    const el = slot === "subject" ? subjectRef.current?.input : shortRef.current?.resizableTextArea?.textArea;
    const r = insertAt(d[slot], tag, el?.selectionStart);
    set({ [slot]: r.value } as Partial<TemplateDraft>);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  };
  const fillDefault = () => {
    if (!d?.event) return;
    const t = DEFAULT_TEMPLATES[d.event];
    set({ subject: t.subject, body: t.body, short_text: t.short });
  };

  const save = async () => {
    if (!d) return;
    setSaving(true);
    setErrors({});
    const data = { ...d, short_text: d.short_text || null, description: d.description || null };
    try {
      if (isNew) {
        const r = await recordsApi.create(api, "notification_template", data);
        nav(`/${orgId}/notify/templates/${r.row.id}`, { replace: true });
      } else {
        await recordsApi.update(api, "notification_template", id!, data, rec.data?.row.version);
        await qc.invalidateQueries({ queryKey: recordKeys.record(orgId, "notification_template", id!) });
        setDraft(null);
      }
      n.ok("الگو ذخیره شد.");
    } catch (e) {
      setErrors(fieldErrorsOf(e));
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    try {
      await recordsApi.remove(api, "notification_template", id!, rec.data?.row.version);
      n.ok("الگو حذف شد.");
      nav(`/${orgId}/${tablePath("notification_template")}`);
    } catch (e) {
      n.error(e);
    }
  };

  const loading = (!isNew && rec.isLoading) || !schema;
  const hasProblem = !!(problems.subject || problems.body || problems.short_text);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isNew ? "الگوی اعلان تازه" : (d?.name || "الگوی اعلان")}
        back={`/${orgId}/${tablePath("notification_template")}`}
        actions={
          d ? (
            <>
              {!isNew && rec.data?.meta.canDelete ? (
                <Popconfirm title="این الگو حذف شود؟ قانون‌هایی که آن را دارند به متن پیش‌فرض برمی‌گردند." okText="حذف" cancelText="انصراف" onConfirm={remove}>
                  <Button icon={<Trash2 {...ICON14} />}>حذف</Button>
                </Popconfirm>
              ) : null}
              {canWrite ? (
                <Button type="primary" loading={saving} disabled={(!isNew && !draft) || hasProblem} onClick={save}>
                  ذخیره
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {loading ? (
        <Skeleton rows={8} />
      ) : !d ? (
        <EmptyState icon={FileText} title="این الگو پیدا نشد" />
      ) : (
        <div className="nf-editor">
          <Card>
            <div className="nf-form">
              <F label="نام" error={errors.name}>
                <Input value={d.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} disabled={!canWrite} status={errors.name ? "error" : undefined} />
              </F>
              <F label="فعال">
                <Switch checked={d.active} onChange={(v) => set({ active: v })} disabled={!canWrite} aria-label="فعال" />
              </F>
              <F label="برای رویداد" error={errors.event}>
                <div className="flex gap-2">
                  <Select className="min-w-0 flex-1" allowClear placeholder="هر رویدادی" value={d.event ?? undefined} options={EVENT_OPTIONS} onChange={(v?: NotifyEvent) => set({ event: v ?? null })} disabled={!canWrite} aria-label="برای رویداد" />
                  <Button icon={<Wand2 {...ICON14} />} disabled={!canWrite || !d.event} onClick={fillDefault} title="متن پیش‌فرض این رویداد" aria-label="متن پیش‌فرض این رویداد" />
                </div>
              </F>
              <F label="جدول نمونه" error={errors.table_key}>
                <TableSelect schema={schema} value={d.table_key} onChange={(v) => set({ table_key: v })} disabled={!canWrite} />
              </F>
              <F label="موضوع" error={problems.subject ?? errors.subject} wide>
                <Input
                  ref={subjectRef}
                  value={d.subject}
                  maxLength={300}
                  onFocus={() => setSlot("subject")}
                  onChange={(e) => set({ subject: e.target.value })}
                  disabled={!canWrite}
                  status={problems.subject || errors.subject ? "error" : undefined}
                  aria-label="موضوع"
                />
              </F>
              <F label="متن" error={problems.body ?? errors.body} wide>
                <div onFocus={() => setSlot("body")}>
                  <MarkdownEditor ref={bodyRef} value={d.body} onChange={(v) => set({ body: v })} minRows={8} maxRows={24} disabled={!canWrite} status={problems.body || errors.body ? "error" : undefined} aria-label="متن" />
                </div>
              </F>
              <F label="متن کوتاه (پیامک و پیام‌رسان؛ خالی: موضوع)" error={problems.short_text ?? errors.short_text} wide>
                <Input.TextArea
                  ref={shortRef}
                  value={d.short_text}
                  maxLength={500}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  onFocus={() => setSlot("short_text")}
                  onChange={(e) => set({ short_text: e.target.value })}
                  disabled={!canWrite}
                  status={problems.short_text || errors.short_text ? "error" : undefined}
                  aria-label="متن کوتاه"
                />
              </F>
              <F label="توضیح" wide>
                <Input.TextArea value={d.description} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(e) => set({ description: e.target.value })} disabled={!canWrite} />
              </F>
            </div>
          </Card>
          <aside className="nf-side" aria-label="پیش‌نمایش و جای‌نگهدارها">
            <PreviewPanel input={{ table: d.table_key ?? "*", event: d.event ?? "updated", subject: d.subject, body: d.body, short_text: d.short_text || null }} />
            <Card title="جای‌نگهدارها">
              <ul className="nf-ph" aria-label="جای‌نگهدارها">
                {placeholders.map((p) => (
                  <li key={p.path}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.path)} disabled={!canWrite} title={`افزودن به ${slot === "subject" ? "موضوع" : slot === "body" ? "متن" : "متن کوتاه"}`}>
                      <span>{p.label}</span>
                      <code>{placeholderTag(p.path)}</code>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert("#if field}}…{{else}}…{{/if")} disabled={!canWrite}>
                    <span>شرط</span>
                    <code>{"{{#if field}}…{{/if}}"}</code>
                  </button>
                </li>
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

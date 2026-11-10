// The preview of a notification on a sample record — the record the editor picks, or the table's latest one the
// caller may read — rendered by the server exactly as a recipient with the caller's access would get it: the in-app
// item (subject and Markdown body), the e-mail (the RTL layout in a sandboxed frame) and the short text of SMS and
// messengers. Template problems (unclosed blocks, unknown tags) are listed above it.
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { Card, Field, Note } from "../../components/blocks";
import { EmptyState, Skeleton } from "../../components/display";
import { RecordMarkdown } from "../../records/fields/display";
import { RecordSelect } from "../../records/fields/RecordSelect";
import { errorText } from "../../lib/api";
import { useSchema } from "../../records/data/hooks";
import type { PreviewInput, PreviewResult } from "./api";
import { TableSelect } from "./parts";

type View = "app" | "email" | "short";
const VIEWS: { value: View; label: string }[] = [
  { value: "app", label: "درون برنامه" },
  { value: "email", label: "ایمیل" },
  { value: "short", label: "پیامک و پیام‌رسان" },
];

/** `input.table` empty or «*» (a built-in, a template for any table): the panel offers a sample table of its own. */
export function PreviewPanel({ input, title = "پیش‌نمایش" }: { input: Omit<PreviewInput, "record_id"> | null; title?: string }) {
  const { api, orgId } = useOrg();
  const { schema } = useSchema();
  const [record, setRecord] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [view, setView] = useState<View>("app");
  const fixed = input?.table && input.table !== "*" ? input.table : null;
  const table = fixed ?? sample;
  useEffect(() => setRecord(null), [table]);
  // debounce the text (a new object every render would restart the timer for ever)
  const text = useDebounced(table && input ? JSON.stringify({ ...input, table, record_id: record }) : "", 400);
  const body = useMemo(() => (text ? (JSON.parse(text) as PreviewInput) : null), [text]);
  const q = useQuery({
    queryKey: ["notify-preview", orgId, body],
    queryFn: () => api.post<PreviewResult>("/notify/preview", body!),
    enabled: !!body,
    placeholderData: (prev) => prev,
    retry: false,
  });
  const r = q.data;

  return (
    <Card title={title}>
      {!fixed ? (
        <Field label="جدول نمونه" className="mb-3">
          <TableSelect
            schema={schema}
            value={sample}
            onChange={(v) => {
              setSample(v);
              setRecord(null);
            }}
          />
        </Field>
      ) : null}
      {!table ? (
        <EmptyState compact icon={Eye} title="برای پیش‌نمایش، جدول را انتخاب کنید" />
      ) : (
        <div className="nf-preview">
          <Field label="رکورد نمونه">
            <RecordSelect key={table} table={table} value={record} onChange={(v) => setRecord((v as string | null) ?? null)} placeholder={r?.record?.label ?? "آخرین رکورد"} allowClear size="small" />
          </Field>
          {q.error ? <Note tone="danger">{errorText(q.error)}</Note> : null}
          {r?.problems.length ? (
            <Note tone="warning">
              {r.problems.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </Note>
          ) : null}
          {q.isLoading ? (
            <Skeleton rows={4} />
          ) : !r ? null : !r.record ? (
            <EmptyState compact icon={Eye} title="رکوردی برای نمونه نیست" />
          ) : (
            <>
              <Segmented size="small" value={view} options={VIEWS} onChange={(v) => setView(v as View)} block />
              {view === "app" ? (
                <div className="flex flex-col gap-2">
                  <div className="nf-preview-subject">{r.subject}</div>
                  {r.body ? <RecordMarkdown className="nf-preview-body" text={r.body} /> : null}
                </div>
              ) : view === "email" ? (
                r.html ? <iframe className="nf-mail" title="پیش‌نمایش ایمیل" sandbox="" srcDoc={r.html} /> : null
              ) : (
                <div className="nf-preview-short">{r.short}</div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

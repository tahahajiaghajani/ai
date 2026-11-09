// Record-page and list parts of the tenant console:
//   ImportActions   on an import set: read the file (columns, sample rows, suggested mapping — rules, or the AI skill),
//                   make a transform map from the suggestions, dry run (checked and rolled back) and run
//   NoticeActions   on a system notice: tell every member now (bell and e-mail by their preferences)
//   ExportButton    on the list of data exports: request one (tables, format, journal) — built in the background as
//                   the person who asked, so it holds only what they may read
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Modal, Radio, Select, Table } from "antd";
import { Download, FileSearch, Megaphone, Play, FlaskConical, Sparkles } from "lucide-react";
import { specFromSuggestions, type Suggestion } from "@shared/admin/mapping";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { Chip } from "../../components/display";
import { ICON, Note } from "../../components/blocks";
import type { RecordContext } from "../../records/extensions";

interface Analysis {
  headers: string[];
  sample: Record<string, string>[];
  total: number;
  suggestions: Suggestion[];
  file: string;
}

interface RunResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: { row: number; field?: string; message: string }[];
}

const confidence = (c: number) => (c >= 0.9 ? <Chip tone="in">مطمئن</Chip> : c >= 0.6 ? <Chip tone="warning">احتمالی</Chip> : <Chip tone="neutral">نامطمئن</Chip>);

// ---------------------------------------------------------------- import sets

export function ImportActions({ ctx }: { ctx: RecordContext }) {
  const { api, can } = useOrg();
  const id = String(ctx.row.id);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Suggestion[]>([]);
  const [ai, setAi] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const analyze = useAction(() => api.post<Analysis>(`/admin/imports/${id}/analyze`), {
    onSuccess: (a) => {
      setAnalysis(a);
      setMapping(a.suggestions);
      setAi(false);
    },
  });
  const suggest = useAction(() => api.post<{ mapping: Suggestion[]; ai: boolean }>("/admin/imports/suggest", { table: ctx.row.target_table, headers: analysis!.headers, sample: analysis!.sample.slice(0, 5) }), {
    onSuccess: (r) => {
      setMapping(r.mapping);
      setAi(r.ai);
    },
    success: (r) => (r.ai ? "نگاشت پیشنهادی هوش مصنوعی آماده است" : "هوش مصنوعی در دسترس نیست؛ پیشنهاد قاعده‌محور نمایش داده شد"),
  });
  const makeMap = useAction(
    async () => {
      const spec = specFromSuggestions(mapping);
      const r = await api.post<Record<string, any>>("/r/transform_map", { name: `نقشهٔ ${ctx.row.name ?? ""}`.trim().slice(0, 120), target_table: ctx.row.target_table, rules: spec.rules, key_field: null, active: true });
      await ctx.save({ transform_map_id: r.id ?? r.row?.id });
    },
    {
      success: "نقشهٔ تبدیل ساخته و به این مجموعه وصل شد",
      onSuccess: () => {
        setAnalysis(null);
        ctx.refresh();
      },
    },
  );
  const run = useAction((dry: boolean) => api.post<RunResult>(`/admin/imports/${id}/run`, { dry_run: dry }), {
    onSuccess: (r) => {
      setResult(r);
      if (!r.dryRun) ctx.refresh();
    },
  });
  if (!can("settings", "edit")) return null;
  const hasMap = !!ctx.row.transform_map_id;
  return (
    <>
      <Button icon={<FileSearch {...ICON} />} loading={analyze.isPending} onClick={() => analyze.mutate(undefined)}>
        بررسی فایل
      </Button>
      <Button icon={<FlaskConical {...ICON} />} disabled={!hasMap} loading={run.isPending && run.variables === true} onClick={() => run.mutate(true)}>
        اجرای آزمایشی
      </Button>
      <Button type="primary" icon={<Play {...ICON} />} disabled={!hasMap} loading={run.isPending && run.variables === false} onClick={() => run.mutate(false)}>
        ورود
      </Button>
      <Modal
        open={!!analysis}
        title={analysis ? `«${analysis.file}» — ${fa(analysis.total)} ردیف` : ""}
        width={760}
        onCancel={() => setAnalysis(null)}
        destroyOnHidden
        footer={[
          <Button key="ai" icon={<Sparkles {...ICON} />} loading={suggest.isPending} onClick={() => suggest.mutate(undefined)}>
            پیشنهاد هوش مصنوعی
          </Button>,
          <Button key="map" type="primary" disabled={!mapping.some((m) => m.field)} loading={makeMap.isPending} onClick={() => makeMap.mutate(undefined)}>
            ساخت نقشهٔ تبدیل از این نگاشت
          </Button>,
        ]}
      >
        {analysis ? (
          <div className="flex flex-col gap-3">
            {ai ? <Note>این نگاشت را هوش مصنوعی پیشنهاد کرده است؛ پیش از ورود، اجرای آزمایشی بگیرید.</Note> : null}
            <Table
              size="small"
              rowKey="header"
              dataSource={mapping}
              pagination={false}
              columns={[
                { title: "ستون فایل", dataIndex: "header" },
                { title: "نمونه", key: "sample", render: (_: unknown, m: Suggestion) => <span className="text-[12px] text-ink-2">{analysis.sample[0]?.[m.header] ?? ""}</span> },
                { title: "فیلد", dataIndex: "field", render: (v: string | null) => (v ? <span className="ltr ds-mono text-[12px]">{v}</span> : <span className="text-ink-3">—</span>) },
                { title: "اطمینان", dataIndex: "confidence", render: (v: number, m: Suggestion) => (m.field ? <span title={m.reason}>{confidence(v)}</span> : null) },
              ]}
            />
          </div>
        ) : null}
      </Modal>
      <Modal open={!!result} title={result?.dryRun ? "نتیجهٔ اجرای آزمایشی" : "نتیجهٔ ورود"} onCancel={() => setResult(null)} footer={<Button onClick={() => setResult(null)}>بستن</Button>} width={640} destroyOnHidden>
        {result ? (
          <div className="flex flex-col gap-3">
            <span className="text-ink">
              از <span className="ds-num">{fa(result.total)}</span> ردیف: <span className="ds-num">{fa(result.created)}</span> تازه، <span className="ds-num">{fa(result.updated)}</span> به‌روز،{" "}
              <span className="ds-num">{fa(result.errors.length)}</span> خطا{result.dryRun ? " (چیزی ذخیره نشد)" : ""}
            </span>
            {result.errors.length ? (
              <Table
                size="small"
                rowKey={(e) => `${e.row}:${e.field ?? ""}:${e.message}`}
                dataSource={result.errors.slice(0, 200)}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                columns={[
                  { title: "ردیف", dataIndex: "row", width: 70, render: (v: number) => <span className="ds-num">{fa(v + 1)}</span> },
                  { title: "فیلد", dataIndex: "field", width: 130, render: (v?: string) => <span className="ltr ds-mono text-[12px]">{v ?? "—"}</span> },
                  { title: "خطا", dataIndex: "message" },
                ]}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- notices

export function NoticeActions({ ctx }: { ctx: RecordContext }) {
  const { api, can } = useOrg();
  const publish = useAction(() => api.post<{ notified: number }>(`/admin/notices/${ctx.row.id}/publish`), { success: (r) => `به ${fa(r.notified)} عضو اعلام شد` });
  if (!can("settings", "edit") || ctx.row.source === "platform" || ctx.row.active === false) return null;
  return (
    <Button
      icon={<Megaphone {...ICON} />}
      loading={publish.isPending}
      onClick={() => Modal.confirm({ title: "اعلام به همهٔ اعضا؟", content: "اعلان این اطلاعیه برای همهٔ اعضای فعال فرستاده می‌شود.", okText: "اعلام", cancelText: "انصراف", onOk: () => publish.mutateAsync(undefined) })}
    >
      اعلام به اعضا
    </Button>
  );
}

// ---------------------------------------------------------------- data exports

export function ExportButton() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ title?: string; tables: string[]; format: "json" | "csv" | "xlsx"; include_journal?: boolean }>();
  const meta = useQuery({ queryKey: ["meta", "tables"], queryFn: () => api.get<{ tables: { key: string; plural: string; virtual?: boolean }[] }>("/meta/tables"), staleTime: 60_000, enabled: open });
  const request = useAction((v: { title?: string; tables: string[]; format: string; include_journal?: boolean }) => api.post<{ export: { id: string } }>("/admin/exports", v), {
    success: "درخواست خروجی ثبت شد؛ آماده که شد خبرتان می‌کنیم",
    invalidate: [["records"]],
    onSuccess: (r) => {
      setOpen(false);
      nav(`/${orgId}/settings/exports/${r.export.id}`);
    },
  });
  if (!can("settings", "edit")) return null;
  return (
    <>
      <Button type="primary" icon={<Download {...ICON} />} onClick={() => setOpen(true)}>
        درخواست خروجی
      </Button>
      <Modal open={open} title="درخواست خروجی داده" okText="درخواست" cancelText="انصراف" confirmLoading={request.isPending} onCancel={() => setOpen(false)} onOk={() => form.validateFields().then((v) => request.mutate(v))} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ format: "xlsx", tables: [] }} requiredMark={false}>
          <Form.Item name="title" label="عنوان">
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="tables" label="جدول‌ها" rules={[{ required: true, type: "array", min: 1, message: "دست‌کم یک جدول انتخاب کنید" }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" loading={meta.isLoading} options={(meta.data?.tables ?? []).filter((t) => !t.virtual).map((t) => ({ value: t.key, label: t.plural }))} maxCount={40} />
          </Form.Item>
          <Form.Item name="format" label="قالب">
            <Radio.Group
              options={[
                { value: "xlsx", label: "اکسل" },
                { value: "csv", label: "CSV" },
                { value: "json", label: "JSON" },
              ]}
            />
          </Form.Item>
          <Form.Item name="include_journal" valuePropName="checked">
            <Checkbox>یادداشت‌ها و گفت‌وگوها هم بیاید</Checkbox>
          </Form.Item>
        </Form>
        <Note>خروجی فقط رکوردها و فیلدهایی را دارد که شما می‌توانید ببینید و پس از چند روز پاک می‌شود.</Note>
      </Modal>
    </>
  );
}

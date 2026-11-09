// «کارها و پشتیبان‌ها» of the platform owner's console: the background-job monitor of every organisation (counts per
// kind, the oldest waiting job, failures; retry, cancel, run the queue now), per-organisation backups (made in the
// background, checked against their hash, downloaded, restored as a new organisation, deleted) and the version and
// upgrade status (schema migrations, engine DDL, the Windows apps that sync and their versions, what is new).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Popconfirm, Segmented, Select, Table } from "antd";
import { CheckCheck, Download, Play, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { api } from "../../../lib/api";
import { useAction } from "../../../lib/hooks";
import { fa, jDate } from "../../../lib/fa";
import { PageHeader } from "../../../components/layout";
import { Chip, Skeleton, StatCard } from "../../../components/display";
import { Card } from "../../../components/blocks";
import { ICON, When, ago, bytes, useAdminQuery } from "../../../pages/admin/ui";

type Tab = "jobs" | "backups" | "version";
type Row = Record<string, any>;

const JOB_STATUS: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = { queued: ["در صف", "neutral"], running: ["در حال اجرا", "warning"], failed: ["ناموفق", "danger"], done: ["انجام‌شده", "in"] };
const BACKUP_STATUS: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = { queued: ["در صف", "neutral"], running: ["در حال ساخت", "warning"], ready: ["آماده", "in"], failed: ["ناموفق", "danger"] };

function OrgSelect({ value, onChange, placeholder = "همهٔ سازمان‌ها" }: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const orgs = useAdminQuery<{ orgs: { id: string; name: string }[] }>(["console", "orgs"], "/admin/orgs");
  return <Select allowClear showSearch optionFilterProp="label" value={value ?? undefined} onChange={(v) => onChange(v ?? null)} placeholder={placeholder} className="min-w-52" options={(orgs.data?.orgs ?? []).map((o) => ({ value: o.id, label: o.name }))} />;
}

const waited = (s: number) => (s < 60 ? "بی‌تأخیر" : s < 3600 ? `${fa(Math.round(s / 60))} دقیقه` : `${fa(Math.round(s / 3600))} ساعت`);

function Jobs() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>("failed");
  const [kind, setKind] = useState<string | null>(null);
  const [org, setOrg] = useState<string | null>(null);
  const summary = useAdminQuery<{ kinds: { kind: string; queued: number; running: number; failed: number; done: number; oldest_queued: string | null }[]; totals: Record<string, number>; backlog_seconds: number; failed_24h: number }>(["console", "jobs", "summary", org], "/admin/jobs/summary", { org });
  const jobs = useAdminQuery<{ jobs: Row[] }>(["console", "jobs", "list", status, kind, org], "/admin/jobs", { status, kind, org });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "console", "jobs"] });
  const act = useAction((v: { id: string; action: "retry" | "cancel" }) => api.post(`/admin/jobs/${v.id}/${v.action}`), { success: "انجام شد", onSuccess: refresh });
  const tick = useAction(() => api.post<{ ran?: number; done?: number }>("/admin/jobs/tick"), { success: "صف یک بار اجرا شد", onSuccess: refresh });
  const s = summary.data;
  return (
    <div className="flex flex-col gap-4">
      {s ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="خلاصه">
          <StatCard title="در صف" value={<span className="ds-num">{fa(s.totals.queued ?? 0)}</span>} hint={`انتظار: ${waited(s.backlog_seconds)}`} />
          <StatCard title="در حال اجرا" value={<span className="ds-num">{fa(s.totals.running ?? 0)}</span>} />
          <StatCard title="ناموفق" value={<span className="ds-num">{fa(s.totals.failed ?? 0)}</span>} tone={s.totals.failed ? "bad" : "muted"} hint={`${fa(s.failed_24h)} در ۲۴ ساعت`} />
          <StatCard title="انجام‌شده" value={<span className="ds-num">{fa(s.totals.done ?? 0)}</span>} />
        </section>
      ) : (
        <Skeleton rows={2} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select allowClear value={status ?? undefined} onChange={(v) => setStatus(v ?? null)} placeholder="وضعیت" className="min-w-36" options={Object.entries(JOB_STATUS).map(([k, [l]]) => ({ value: k, label: l }))} />
        <Select allowClear showSearch value={kind ?? undefined} onChange={(v) => setKind(v ?? null)} placeholder="گونهٔ کار" className="min-w-52" options={(s?.kinds ?? []).map((k) => ({ value: k.kind, label: k.kind }))} />
        <OrgSelect value={org} onChange={setOrg} />
        <Button icon={<Play {...ICON} />} loading={tick.isPending} onClick={() => tick.mutate(undefined)} className="ms-auto">
          اجرای صف
        </Button>
      </div>
      <Card flush>
        <Table
          size="small"
          rowKey="id"
          loading={jobs.isLoading}
          dataSource={jobs.data?.jobs ?? []}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: true }}
          columns={[
            { title: "زمان", dataIndex: "created_at", width: 150, render: (v: string) => <When v={v} /> },
            { title: "سازمان", dataIndex: "org_name", render: (v: string | null) => v ?? <span className="text-ink-3">سامانه</span> },
            { title: "کار", dataIndex: "kind", render: (v: string) => <span className="ltr ds-mono text-[12px]">{v}</span> },
            { title: "وضعیت", dataIndex: "status", width: 110, render: (v: string) => <Chip tone={JOB_STATUS[v]?.[1] ?? "neutral"}>{JOB_STATUS[v]?.[0] ?? v}</Chip> },
            { title: "تلاش", width: 70, render: (_: unknown, r: Row) => <span className="ds-num">{fa(r.attempts)}/{fa(r.max_attempts)}</span> },
            { title: "خطا", dataIndex: "last_error", render: (v: string | null) => (v ? <span className="line-clamp-2 text-[12px] text-ink-2" title={v}>{v}</span> : <span className="text-ink-3">—</span>) },
            {
              key: "act",
              width: 100,
              render: (_: unknown, r: Row) => (
                <span className="flex gap-1">
                  {r.status === "failed" ? <Button size="small" type="text" aria-label="اجرای دوباره" icon={<RotateCcw {...ICON} />} onClick={() => act.mutate({ id: r.id, action: "retry" })} /> : null}
                  {r.status === "queued" ? <Button size="small" type="text" aria-label="لغو" icon={<X {...ICON} />} onClick={() => act.mutate({ id: r.id, action: "cancel" })} /> : null}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

function Backups() {
  const qc = useQueryClient();
  const [org, setOrg] = useState<string | null>(null);
  const [make, setMake] = useState(false);
  const [form] = Form.useForm<{ org_id: string; note?: string }>();
  const list = useAdminQuery<{ backups: Row[] }>(["console", "backups", org], "/admin/backups", { org });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "console", "backups"] });
  const create = useAction((v: { org_id: string; note?: string }) => api.post("/admin/backups", v), {
    success: "پشتیبان در صف ساخت است",
    onSuccess: () => {
      setMake(false);
      refresh();
    },
  });
  const verify = useAction((id: string) => api.post<{ ok: boolean; message: string; tables: number; rows: number }>(`/admin/backups/${id}/verify`), { success: (r) => (r.ok ? `${r.message} (${fa(r.tables)} جدول، ${fa(r.rows)} ردیف)` : r.message) });
  const restore = useAction((id: string) => api.post<{ org_id: string; name: string }>(`/admin/backups/${id}/restore`), { success: (r) => `سازمان «${r.name}» از پشتیبان ساخته شد`, onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }) });
  const remove = useAction((id: string) => api.del(`/admin/backups/${id}`), { success: "پشتیبان حذف شد", onSuccess: refresh });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <OrgSelect value={org} onChange={setOrg} />
        <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setMake(true)} className="ms-auto">
          پشتیبان تازه
        </Button>
      </div>
      <Card flush>
        <Table
          size="small"
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data?.backups ?? []}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          scroll={{ x: true }}
          columns={[
            { title: "زمان", dataIndex: "created_at", width: 150, render: (v: string) => <When v={v} /> },
            { title: "سازمان", dataIndex: "org_name", render: (v: string | null) => v ?? "—" },
            { title: "وضعیت", dataIndex: "status", width: 110, render: (v: string, r: Row) => <Chip tone={BACKUP_STATUS[v]?.[1] ?? "neutral"} title={r.error ?? undefined}>{BACKUP_STATUS[v]?.[0] ?? v}</Chip> },
            { title: "جدول / ردیف", render: (_: unknown, r: Row) => (r.status === "ready" ? <span className="ds-num">{fa(r.tables ?? 0)} / {fa(r.rows ?? 0)}</span> : "—") },
            { title: "حجم", dataIndex: "bytes", render: (v: number | null, r: Row) => (r.status === "ready" ? bytes(v) : "—") },
            { title: "یادداشت", dataIndex: "note", render: (v: string | null) => v ?? <span className="text-ink-3">—</span> },
            {
              key: "act",
              width: 150,
              render: (_: unknown, r: Row) => (
                <span className="flex gap-1">
                  {r.status === "ready" ? (
                    <>
                      <a href={`/api/admin/backups/${r.id}/download`} aria-label="دریافت" className="ant-btn ant-btn-text ant-btn-sm ant-btn-icon-only inline-flex items-center justify-center">
                        <Download {...ICON} />
                      </a>
                      <Button size="small" type="text" aria-label="بررسی سلامت" loading={verify.isPending && verify.variables === r.id} icon={<CheckCheck {...ICON} />} onClick={() => verify.mutate(r.id)} />
                      <Popconfirm title="از این پشتیبان سازمانی تازه ساخته شود؟" description="سازمان فعلی دست نمی‌خورد؛ رازها و کلیدها بازگردانده نمی‌شوند." okText="بازگردانی" cancelText="انصراف" onConfirm={() => restore.mutateAsync(r.id)}>
                        <Button size="small" type="text" aria-label="بازگردانی" icon={<Undo2 {...ICON} />} />
                      </Popconfirm>
                    </>
                  ) : null}
                  <Popconfirm title="این پشتیبان حذف شود؟" okText="حذف" cancelText="انصراف" onConfirm={() => remove.mutateAsync(r.id)}>
                    <Button size="small" type="text" aria-label="حذف" icon={<Trash2 {...ICON} />} />
                  </Popconfirm>
                </span>
              ),
            },
          ]}
        />
      </Card>
      <Modal open={make} title="پشتیبان تازه" okText="ساخت" cancelText="انصراف" confirmLoading={create.isPending} onCancel={() => setMake(false)} onOk={() => form.validateFields().then((v) => create.mutate(v))} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ org_id: org ?? undefined }}>
          <Form.Item name="org_id" label="سازمان" rules={[{ required: true, message: "سازمان را انتخاب کنید" }]}>
            <OrgSelect value={null} onChange={() => undefined} placeholder="سازمان" />
          </Form.Item>
          <Form.Item name="note" label="یادداشت">
            <Input maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

interface Version {
  app_version: string;
  sync_protocol: number;
  mode: "cloud" | "desktop";
  node: string;
  schema: { applied: number; pending: string[]; current: string | null; latest: string | null };
  engine_ddl: { hash: string | null; updated_at: string } | null;
  devices: { app_version: string | null; n: number; last: string | null }[];
  devices_outdated: number;
  orgs: number;
  changelog: { version: string; date: string; items: string[] }[];
}

function VersionTab() {
  const q = useAdminQuery<Version>(["console", "version"], "/admin/version");
  const v = q.data;
  if (!v) return <Skeleton rows={6} />;
  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="نسخه">
        <StatCard title="نسخهٔ سامانه" value={<span className="ds-num ds-latin">{v.app_version}</span>} hint={v.mode === "cloud" ? "نسخهٔ وب" : "نسخهٔ ویندوز"} />
        <StatCard title="ساختار پایگاه داده" value={v.schema.pending.length ? `${fa(v.schema.pending.length)} مهاجرت مانده` : "به‌روز"} tone={v.schema.pending.length ? "bad" : "ok"} hint={v.schema.latest ? <span className="ds-latin">{v.schema.latest}</span> : undefined} />
        <StatCard title="پروتکل همگام‌سازی" value={<span className="ds-num">{fa(v.sync_protocol)}</span>} hint={<span className="ds-latin">Node {v.node}</span>} />
        <StatCard title="برنامه‌های ویندوز قدیمی" value={<span className="ds-num">{fa(v.devices_outdated)}</span>} tone={v.devices_outdated ? "bad" : "muted"} hint={`${fa(v.orgs)} سازمان`} />
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="برنامه‌های ویندوز" flush>
          <Table
            size="small"
            rowKey={(d) => d.app_version ?? "?"}
            dataSource={v.devices}
            pagination={false}
            columns={[
              { title: "نسخه", dataIndex: "app_version", render: (x: string | null) => <span className="ds-latin">{x ?? "نامعلوم"}</span> },
              { title: "دستگاه", dataIndex: "n", render: (n: number) => <span className="ds-num">{fa(n)}</span> },
              { title: "آخرین همگام‌سازی", dataIndex: "last", render: (x: string | null) => ago(x) },
              { key: "s", render: (_: unknown, d) => (d.app_version && d.app_version !== v.app_version ? <Chip tone="warning">نیازمند ارتقا</Chip> : <Chip tone="in">به‌روز</Chip>) },
            ]}
          />
        </Card>
        <Card title="تازه‌ها">
          <div className="flex flex-col gap-3">
            {v.changelog.map((c) => (
              <div key={c.version}>
                <div className="text-[13px] text-ink-2">
                  نسخهٔ <span className="ds-latin">{c.version}</span> · <span className="ds-num">{jDate(new Date(c.date))}</span>
                </div>
                <ul className="m-0 mt-1 list-disc ps-5 text-[13px]">
                  {c.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {v.schema.pending.length ? (
        <Card title="مهاجرت‌های مانده">
          <ul className="m-0 list-disc ps-5 ltr ds-mono text-[12px]">
            {v.schema.pending.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

export default function Operations() {
  const [tab, setTab] = useState<Tab>("jobs");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="کارها و پشتیبان‌ها" />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        className="self-start"
        options={[
          { value: "jobs", label: "کارهای پس‌زمینه" },
          { value: "backups", label: "پشتیبان‌ها" },
          { value: "version", label: "نسخه و ارتقا" },
        ]}
      />
      {tab === "jobs" ? <Jobs /> : tab === "backups" ? <Backups /> : <VersionTab />}
    </div>
  );
}

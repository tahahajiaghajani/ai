// «گزارش‌های سامانه»: the organisation's own logs in one place — background jobs (retry or cancel a failed or queued
// one), notification deliveries, flow runs, calls of the integration hub and security events — filtered by status and
// text, newest first, «بیشتر» for older rows. The record audit trail stays in «گزارش رویدادها».
import { useState } from "react";
import { Link } from "react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, Input, Segmented, Select, Table } from "antd";
import { RotateCcw, Search, X } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, JDateTime, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";

type Kind = "jobs" | "notifications" | "flows" | "integrations" | "security";
type Row = Record<string, any>;

interface Page {
  kind: Kind;
  rows: Row[];
  summary?: { totals: { queued: number; running: number; failed: number; done: number }; failed_24h: number; backlog_seconds: number };
}

const KINDS: { value: Kind; label: string }[] = [
  { value: "jobs", label: "کارهای پس‌زمینه" },
  { value: "notifications", label: "اعلان‌ها" },
  { value: "flows", label: "گردش‌کارها" },
  { value: "integrations", label: "اتصال‌ها" },
  { value: "security", label: "امنیت" },
];

const STATUSES: Record<Kind, { value: string; label: string }[]> = {
  jobs: [
    { value: "failed", label: "ناموفق" },
    { value: "queued", label: "در صف" },
    { value: "running", label: "در حال اجرا" },
    { value: "done", label: "انجام‌شده" },
  ],
  notifications: [
    { value: "failed", label: "ناموفق" },
    { value: "sent", label: "فرستاده" },
    { value: "skipped", label: "کنار گذاشته" },
    { value: "queued", label: "در صف" },
  ],
  flows: [
    { value: "failed", label: "ناموفق" },
    { value: "running", label: "در حال اجرا" },
    { value: "waiting", label: "در انتظار" },
    { value: "done", label: "پایان‌یافته" },
    { value: "cancelled", label: "لغوشده" },
  ],
  integrations: [{ value: "failed", label: "ناموفق" }],
  security: [{ value: "failed", label: "ناموفق" }],
};

const TONE: Record<string, "in" | "warning" | "danger" | "neutral"> = { done: "in", sent: "in", failed: "danger", queued: "neutral", running: "warning", waiting: "neutral", skipped: "neutral", cancelled: "neutral" };
const label = (kind: Kind, s: string) => STATUSES[kind].find((x) => x.value === s)?.label ?? s;
const State = ({ kind, s }: { kind: Kind; s: string }) => <Chip tone={TONE[s] ?? "neutral"}>{label(kind, s)}</Chip>;
const Ok = ({ ok }: { ok: boolean }) => <Chip tone={ok ? "in" : "danger"}>{ok ? "موفق" : "ناموفق"}</Chip>;
const Err = ({ v }: { v: string | null }) => (v ? <span className="line-clamp-2 text-[12px] text-ink-2" title={v}>{v}</span> : <span className="text-ink-3">—</span>);
const Mono = ({ v }: { v: string | null }) => <span className="ltr ds-mono text-[12px]">{v ?? "—"}</span>;

export default function Logs() {
  const { api, orgId, can } = useOrg();
  const [kind, setKind] = useState<Kind>("jobs");
  const [status, setStatus] = useState<string | null>(null);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 350);
  const key = ["admin", "logs", kind, status, q];
  const logs = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Page>("/admin/logs", { kind, status: status ?? undefined, q: q || undefined, before: pageParam ?? undefined }),
    getNextPageParam: (last) => {
      if (last.rows.length < 100) return undefined;
      const r = last.rows[last.rows.length - 1];
      return String(r.created_at ?? r.started_at ?? r.at ?? "") || undefined;
    },
  });
  const job = useAction((v: { id: string; action: "retry" | "cancel" }) => api.post(`/admin/jobs/${v.id}/${v.action}`), { invalidate: [["admin", "logs"]], success: (r: unknown) => ((r as { status?: string }).status === "queued" ? "کار دوباره در صف است" : "کار لغو شد") });
  const rows = logs.data?.pages.flatMap((p) => p.rows) ?? [];
  const summary = logs.data?.pages[0]?.summary;

  const columns: Record<Kind, object[]> = {
    jobs: [
      { title: "زمان", dataIndex: "created_at", width: 150, render: (v: string) => <JDateTime v={v} /> },
      { title: "کار", dataIndex: "kind", render: (v: string) => <Mono v={v} /> },
      { title: "وضعیت", dataIndex: "status", width: 110, render: (v: string) => <State kind="jobs" s={v} /> },
      { title: "تلاش", width: 70, render: (_: unknown, r: Row) => <span className="ds-num">{fa(r.attempts)}/{fa(r.max_attempts)}</span> },
      { title: "خطا", dataIndex: "last_error", render: (v: string | null) => <Err v={v} /> },
      {
        key: "act",
        width: 120,
        render: (_: unknown, r: Row) =>
          can("settings", "full") && (r.status === "failed" || r.status === "queued") ? (
            <span className="flex gap-1">
              {r.status === "failed" ? <Button size="small" icon={<RotateCcw {...ICON} />} onClick={() => job.mutate({ id: r.id, action: "retry" })}>دوباره</Button> : null}
              {r.status === "queued" ? <Button size="small" icon={<X {...ICON} />} onClick={() => job.mutate({ id: r.id, action: "cancel" })}>لغو</Button> : null}
            </span>
          ) : null,
      },
    ],
    notifications: [
      { title: "زمان", dataIndex: "created_at", width: 150, render: (v: string) => <JDateTime v={v} /> },
      { title: "قاعده", dataIndex: "rule_name", render: (v: string | null) => v ?? "—" },
      { title: "رکورد", dataIndex: "record_number", render: (v: string | null) => <Mono v={v} /> },
      { title: "کانال", dataIndex: "channel", width: 90 },
      { title: "وضعیت", dataIndex: "status", width: 110, render: (v: string) => <State kind="notifications" s={v} /> },
      { title: "شرح", render: (_: unknown, r: Row) => <Err v={r.error ?? r.reason ?? null} /> },
    ],
    flows: [
      { title: "آغاز", dataIndex: "started_at", width: 150, render: (v: string) => <JDateTime v={v} /> },
      { title: "گردش‌کار", dataIndex: "flow_name", render: (v: string, r: Row) => <Link to={`/${orgId}/flows/${r.flow_id}/design`}>{v}</Link> },
      { title: "وضعیت", dataIndex: "state", width: 110, render: (v: string) => <State kind="flows" s={v} /> },
      { title: "گام", dataIndex: "steps_count", width: 60, render: (v: number) => <span className="ds-num">{fa(v ?? 0)}</span> },
      { title: "خطا", dataIndex: "error", render: (v: string | null) => <Err v={v} /> },
    ],
    integrations: [
      { title: "زمان", dataIndex: "at", width: 150, render: (v: string) => <JDateTime v={v} /> },
      { title: "رابط", dataIndex: "kind", width: 110, render: (v: string) => <Mono v={v} /> },
      { title: "مقصد", dataIndex: "target", render: (v: string | null, r: Row) => <span className="ltr ds-mono text-[12px]">{[r.method, v].filter(Boolean).join(" ")}</span> },
      { title: "نتیجه", dataIndex: "ok", width: 90, render: (v: boolean) => <Ok ok={v} /> },
      { title: "پاسخ", dataIndex: "status", width: 70, render: (v: number | null) => <span className="ds-num">{v ?? "—"}</span> },
      { title: "شرح", render: (_: unknown, r: Row) => <Err v={r.error ?? r.summary ?? null} /> },
    ],
    security: [
      { title: "زمان", dataIndex: "at", width: 150, render: (v: string) => <JDateTime v={v} /> },
      { title: "رویداد", dataIndex: "kind", render: (v: string) => <Mono v={v} /> },
      { title: "نتیجه", dataIndex: "ok", width: 90, render: (v: boolean) => <Ok ok={v} /> },
      { title: "حساب", dataIndex: "email", render: (v: string | null) => <Mono v={v} /> },
      { title: "IP", dataIndex: "ip", width: 130, render: (v: string | null) => <Mono v={v} /> },
    ],
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="گزارش‌های سامانه" extra={<Link to={`/${orgId}/settings/audit`}>گزارش رویدادها</Link>} />
      {kind === "jobs" && summary ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="خلاصهٔ کارها">
          <StatCard title="در صف" value={<span className="ds-num">{fa(summary.totals.queued)}</span>} />
          <StatCard title="در حال اجرا" value={<span className="ds-num">{fa(summary.totals.running)}</span>} />
          <StatCard title="ناموفق" value={<span className="ds-num">{fa(summary.totals.failed)}</span>} tone={summary.totals.failed ? "bad" : "muted"} />
          <StatCard title="ناموفق در ۲۴ ساعت" value={<span className="ds-num">{fa(summary.failed_24h)}</span>} />
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Kind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            setStatus(null);
          }}
          options={KINDS}
        />
        <Select allowClear value={status ?? undefined} onChange={(v) => setStatus(v ?? null)} placeholder="وضعیت" options={STATUSES[kind]} className="min-w-36" />
        <Input allowClear prefix={<Search {...ICON} />} value={text} onChange={(e) => setText(e.target.value)} placeholder="جست‌وجو" className="max-w-64" />
      </div>
      <Card flush>
        <Table size="small" rowKey="id" loading={logs.isLoading} dataSource={rows} pagination={false} scroll={{ x: true }} columns={columns[kind] as never} />
        {logs.hasNextPage ? (
          <div className="flex justify-center p-3">
            <Button loading={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>
              بیشتر
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

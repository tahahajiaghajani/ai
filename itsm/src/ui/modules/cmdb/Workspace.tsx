// «پایگاه پیکربندی» — the CMDB workspace (catalogue CMDB-072/030/073): the health of the data (completeness,
// correctness, compliance — one score per principal class and its daily trend), what needs attention (stale CIs,
// duplicates to review, drift, open findings, CIs without an owner, orphans), the data sources and their last runs, and
// the way into the map, impact analysis and imports. Figures come from the server's health facts over the CIs the
// person may read.
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Space, Table } from "antd";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, FileUp, GitFork, RefreshCw, Zap } from "lucide-react";
import type { ClassHealth } from "@shared/cmdb/api";
import { formatJalali } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, JDateTime, Loader, StatCard } from "../../components/display";
import { cmdbApi, CMDB_KEYS } from "./api";
import { listWith } from "./model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const score = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fa(Math.round(v)));

function Pct({ v }: { v: number }) {
  const tone = v >= 85 ? "var(--ds-in)" : v >= 60 ? "var(--ds-warning-fill)" : "var(--ds-danger)";
  return (
    <span className="flex items-center gap-2">
      <span className="cm-meter" style={{ minWidth: 56 }} aria-hidden>
        <span style={{ width: `${Math.max(3, v)}%`, background: tone }} />
      </span>
      <span className="ds-num text-[12px]">{fa(Math.round(v))}</span>
    </span>
  );
}

export default function Workspace() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const meta = useQuery({ queryKey: CMDB_KEYS.meta(orgId), queryFn: () => cmdbApi.meta(api), staleTime: 300_000 });
  const h = useQuery({ queryKey: CMDB_KEYS.health(orgId), queryFn: () => cmdbApi.health(api), staleTime: 60_000 });
  const run = useMutation({ mutationFn: () => cmdbApi.runHealth(api), onSuccess: () => message.success("محاسبهٔ سلامت در پس‌زمینه آغاز شد"), onError: (e: Error) => message.error(e.message) });
  const d = h.data;
  const list = (cond: unknown) => () => nav(`/${orgId}/${cond ? listWith("cis", cond) : "cis"}`);
  const cols = [
    { title: "کلاس", dataIndex: "label", key: "label", render: (v: string, r: ClassHealth) => <Link className="ds-link" to={`/${orgId}/${listWith("cis", { f: "class", op: "eq", v: r.class })}`}>{v}</Link> },
    { title: "تعداد", dataIndex: "total", key: "total", width: 80, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "امتیاز", dataIndex: "score", key: "score", width: 130, sorter: (a: ClassHealth, b: ClassHealth) => a.score - b.score, render: (v: number) => <Pct v={v} /> },
    { title: "کامل بودن", dataIndex: "completeness", key: "c", width: 130, render: (v: number) => <Pct v={v} /> },
    { title: "درستی", dataIndex: "correctness", key: "k", width: 130, render: (v: number) => <Pct v={v} /> },
    { title: "انطباق", dataIndex: "compliance", key: "p", width: 130, render: (v: number) => <Pct v={v} /> },
    { title: "کهنه", dataIndex: "stale", key: "stale", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "تکراری", dataIndex: "duplicates", key: "dup", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "بی‌رابطه", dataIndex: "orphans", key: "orph", width: 80, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "بی‌مالک", dataIndex: "no_owner", key: "own", width: 80, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
  ];
  return (
    <div>
      <PageHeader
        title="پایگاه پیکربندی"
        actions={
          <Space wrap>
            <Button icon={<GitFork {...ICON} />} onClick={() => nav(`/${orgId}/cmdb/map`)}>نقشهٔ وابستگی</Button>
            <Button icon={<Zap {...ICON} />} onClick={() => nav(`/${orgId}/cmdb/impact`)}>تحلیل اثر</Button>
            <Button icon={<FileUp {...ICON} />} onClick={() => nav(`/${orgId}/cmdb/import`)}>ورود داده</Button>
            {meta.data?.can_admin ? <Button icon={<RefreshCw {...ICON} />} loading={run.isPending} onClick={() => run.mutate()}>محاسبهٔ سلامت</Button> : null}
          </Space>
        }
      />
      {h.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داده‌های پیکربندی در دسترس نیست" description="به پایگاه پیکربندی دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : !d.total ? (
        <EmptyState
          title="هنوز پیکربندی‌ای ثبت نشده است"
          description="پیکربندی‌ها را یکی‌یکی ثبت کنید، از فایل وارد کنید یا در نسخهٔ ویندوزی موجودی همین رایانه را جمع‌آوری کنید."
          icon={Activity}
          action={<Button type="primary" onClick={() => nav(`/${orgId}/cmdb/import`)}>ورود از فایل</Button>}
          secondary={<Button onClick={() => nav(`/${orgId}/cis/new`)}>ثبت پیکربندی</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="cm-tiles ds-stagger">
            <StatCard title="پیکربندی" value={fa(d.total)} onClick={list(null)} />
            <StatCard title="امتیاز سلامت" value={score(d.score)} hint={d.computed_at ? `آخرین محاسبه ${formatJalali(d.computed_at.slice(0, 10))}` : "هنوز محاسبه نشده"} />
            <StatCard title="کامل بودن" value={score(d.completeness)} />
            <StatCard title="درستی" value={score(d.correctness)} />
            <StatCard title="انطباق" value={score(d.compliance)} />
            <StatCard title="کهنه" value={fa(d.stale)} onClick={list({ f: "is_stale", op: "eq", v: true })} />
            <StatCard title="یافتهٔ باز" value={fa(d.open_findings)} onClick={() => nav(`/${orgId}/cmdb/findings`)} />
            <StatCard title="تکراری برای بررسی" value={fa(d.open_dedup)} onClick={() => nav(`/${orgId}/cmdb/duplicates`)} />
            <StatCard title="انحراف باز" value={fa(d.open_drift)} onClick={() => nav(`/${orgId}/cmdb/drifts`)} />
          </div>
          {d.trend.length > 1 ? (
            <Card title="روند امتیاز سلامت">
              <div style={{ height: 200 }} dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.trend.map((t) => ({ ...t, label: formatJalali(t.day).slice(5) }))} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--ds-line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: string) => faDigits(v)} />
                    <YAxis domain={[0, 100]} width={32} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
                    <Tooltip formatter={(v) => [fa(Number(v)), "امتیاز"]} labelFormatter={(l) => faDigits(String(l))} />
                    <Line type="monotone" dataKey="score" stroke="var(--ds-chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
          <Card title="سلامت بر پایهٔ کلاس" flush>
            <Table rowKey="class" size="small" dataSource={d.classes} columns={cols} pagination={false} scroll={{ x: 1000 }} />
          </Card>
          {d.sources.length ? (
            <Card title="منبع‌های داده" flush>
              <Table
                rowKey="id"
                size="small"
                dataSource={d.sources}
                pagination={false}
                columns={[
                  { title: "منبع", dataIndex: "name", key: "name", render: (v: string, r: { id: string }) => <Link className="ds-link" to={`/${orgId}/cmdb/sources/${r.id}`}>{v}</Link> },
                  { title: "آخرین اجرا", dataIndex: "last_run_at", key: "at", width: 180, render: (v: string | null) => (v ? <JDateTime v={v} /> : <span className="text-ink-3">—</span>) },
                  { title: "نتیجه", dataIndex: "last_status", key: "st", render: (v: string | null) => v ?? <span className="text-ink-3">—</span> },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

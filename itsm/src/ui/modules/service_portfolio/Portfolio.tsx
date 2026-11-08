// «سبد خدمات» — the portfolio's overview (catalogue SPF-002/003/039/041/028): the pipeline, catalogue and retired
// views, completeness, time to market, counts by stage, tier, type, branch and owner, annual cost when the person sees
// money, the catalogue's health checks with the services that fail them, reviews falling due, and technology at risk
// with the services it reaches. Tiles open the matching lists.
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Progress, Space, Table, Tabs } from "antd";
import { ConciergeBell, Gauge, LayoutGrid, Plus } from "lucide-react";
import type { HealthCheck, PortfolioCount } from "@shared/service_portfolio/api";
import { formatMoney } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, JDate, Loader, StatCard } from "../../components/display";
import { spfApi, SPF_KEYS, type TechnologyRiskRow } from "./api";
import "./spf.css";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const listWith = (path: string, cond: unknown) => `${path}?filter=${encodeURIComponent(JSON.stringify(cond))}`;

function Counts({ items }: { items: PortfolioCount[] }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  if (!items.length) return <p className="text-[13px] text-ink-3">داده‌ای نیست.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((x) => (
        <li key={x.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate text-ink-2" title={x.label}>{x.label}</span>
          <span className="h-2 overflow-hidden rounded-xs bg-sunken" aria-hidden>
            <span className="block h-full rounded-xs" style={{ width: `${(x.count / max) * 100}%`, background: "var(--ds-chart-5)" }} />
          </span>
          <span className="ds-num text-ink">{fa(x.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function CheckRow({ c, orgId }: { c: HealthCheck; orgId: string }) {
  const pctv = c.total ? Math.round((c.passing / c.total) * 100) : 100;
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="text-ink">{c.label}</span>
        <span className="ds-num text-ink-3">{fa(c.passing)} از {fa(c.total)}</span>
      </div>
      <Progress percent={pctv} showInfo={false} size="small" strokeColor={pctv >= 90 ? "var(--ds-in)" : pctv >= 60 ? "var(--ds-warning-fill)" : "var(--ds-danger)"} />
      {c.failing.length ? (
        <p className="text-[12.5px] text-ink-3">
          {c.failing.map((s, i) => (
            <span key={s.id}>
              {i ? "، " : ""}
              <Link className="ds-link" to={`/${orgId}/services/${s.id}`}>{s.name}</Link>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

export default function Portfolio() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const meta = useQuery({ queryKey: SPF_KEYS.meta(orgId), queryFn: () => spfApi.meta(api), staleTime: 300_000 });
  const report = useQuery({ queryKey: SPF_KEYS.report(orgId), queryFn: () => spfApi.report(api), staleTime: 60_000 });
  const health = useQuery({ queryKey: SPF_KEYS.health(orgId), queryFn: () => spfApi.health(api), staleTime: 60_000 });
  const tech = useQuery({ queryKey: SPF_KEYS.technology(orgId), queryFn: () => spfApi.technology(api), staleTime: 300_000 });
  const scores = useMutation({ mutationFn: () => spfApi.runScores(api), onSuccess: (r) => message.success(`امتیاز ${fa(r.scored)} خدمت محاسبه شد`), onError: (e: Error) => message.error(e.message) });
  const r = report.data;
  const h = health.data;
  return (
    <div>
      <PageHeader
        title="سبد خدمات"
        actions={
          <Space wrap>
            {meta.data?.can_create ? <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav(`/${orgId}/services/new`)}>خدمت تازه</Button> : null}
            <Button icon={<LayoutGrid {...ICON} />} onClick={() => nav(`/${orgId}/services?mode=board`)}>تابلوی مراحل</Button>
            {meta.data?.can_manage ? <Button icon={<Gauge {...ICON} />} loading={scores.isPending} onClick={() => scores.mutate()}>محاسبهٔ امتیازها</Button> : null}
          </Space>
        }
      />
      {report.isLoading ? (
        <Loader />
      ) : !r ? (
        <EmptyState title="سبد خدمات در دسترس نیست" description="به سبد خدمات دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : !r.total ? (
        <EmptyState title="هنوز خدمتی ثبت نشده" description="خدمت‌هایی را که فناوری اطلاعات ارائه می‌کند با مالک، رده، گزینه‌ها و تعهدهایشان ثبت کنید." icon={ConciergeBell} action={meta.data?.can_create ? <Button type="primary" onClick={() => nav(`/${orgId}/services/new`)}>خدمت تازه</Button> : undefined} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="spf-tiles ds-stagger">
            <StatCard title="در کاتالوگ" value={fa(r.views.catalogue)} onClick={() => nav(`/${orgId}/${listWith("services", { f: "state", op: "in", v: ["live", "deprecated"] })}`)} />
            <StatCard title="در دست ساخت" value={fa(r.views.pipeline)} onClick={() => nav(`/${orgId}/${listWith("services", { f: "state", op: "in", v: ["proposed", "approved", "design", "transition"] })}`)} />
            <StatCard title="کنارگذاشته" value={fa(r.views.retired)} onClick={() => nav(`/${orgId}/${listWith("services", { f: "state", op: "in", v: ["retired", "rejected"] })}`)} />
            <StatCard title="کامل بودن سبد" value={r.completeness === null ? "—" : `${fa(r.completeness)}٪`} hint="مالک، شرح و نتایج" />
            <StatCard title="سلامت کاتالوگ" value={h?.score === null || h?.score === undefined ? "—" : `${fa(h.score)}٪`} />
            {r.cost.visible && r.cost.total ? <StatCard title="هزینهٔ سالانهٔ کاتالوگ" value={formatMoney(r.cost.total)} /> : null}
          </div>
          <Tabs
            items={[
              {
                key: "report", label: "گزارش‌ها",
                children: (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Card title="بر پایهٔ مرحله"><Counts items={r.by_state} /></Card>
                    <Card title="بر پایهٔ رده"><Counts items={r.by_tier} /></Card>
                    <Card title="بر پایهٔ شاخه"><Counts items={r.by_node} /></Card>
                    <Card title="بر پایهٔ مالک"><Counts items={r.by_owner} /></Card>
                    <Card title="بر پایهٔ نوع"><Counts items={r.by_type} /></Card>
                    <Card title="زمان رسیدن به بهره‌برداری">
                      <ul className="flex flex-col gap-1.5 text-[13px]">
                        {r.time_to_market.map((t) => (
                          <li key={t.type} className="flex items-center justify-between gap-2">
                            <span className="text-ink-2">{t.label}</span>
                            <span className="ds-num text-ink">{t.days === null ? "—" : `${fa(t.days)} روز`}<span className="text-ink-3"> ({fa(t.services)} خدمت)</span></span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                ),
              },
              {
                key: "health", label: "سلامت کاتالوگ",
                children: health.isLoading ? <Loader /> : h ? (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <Card title="بررسی‌ها"><ul className="flex flex-col">{h.checks.map((c) => <CheckRow key={c.key} c={c} orgId={orgId} />)}</ul></Card>
                    <Card title="بازبینی‌های پیش رو" flush>
                      {h.review_due.length ? (
                        <Table
                          rowKey="id"
                          size="small"
                          pagination={false}
                          dataSource={h.review_due}
                          columns={[
                            { title: "خدمت", dataIndex: "name", key: "n", render: (v: string, s: { id: string; overdue: boolean }) => <Link className="ds-link" to={`/${orgId}/services/${s.id}`}>{v}</Link> },
                            { title: "موعد", dataIndex: "due", key: "d", width: 120, render: (v: string, s: { id: string; overdue: boolean }) => (s.overdue ? <Chip tone="danger"><JDate v={v} /></Chip> : <JDate v={v} />) },
                          ]}
                        />
                      ) : (
                        <EmptyState compact title="بازبینی‌ای تا یک ماه آینده نیست" />
                      )}
                    </Card>
                  </div>
                ) : null,
              },
              {
                key: "technology", label: "ریسک فناوری",
                children: tech.isLoading ? <Loader /> : (
                  <Card flush>
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={tech.data?.rows ?? []}
                      scroll={{ x: 720 }}
                      locale={{ emptyText: "استاندارد فناوری‌ای تعریف نشده است" }}
                      columns={[
                        { title: "محصول", dataIndex: "name", key: "n", render: (v: string, t: TechnologyRiskRow) => <Link className="ds-link" to={`/${orgId}/portfolio/standards/${t.id}`}><bdi>{v}{t.product_version ? ` ${t.product_version}` : ""}</bdi></Link> },
                        { title: "ریسک", dataIndex: "risk", key: "r", width: 200, render: (v: string | null) => (v ? <Chip tone={v === "ممنوع" || v.startsWith("پشتیبانی") ? "danger" : "warning"}>{v}</Chip> : <span className="text-ink-3">—</span>) },
                        { title: "پایان پشتیبانی", dataIndex: "eol_date", key: "e", width: 120, render: (v: string | null) => <JDate v={v} /> },
                        { title: "پیکربندی", dataIndex: "cis", key: "c", width: 90, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                        { title: "خدمت‌های متأثر", dataIndex: "services", key: "s", render: (v: TechnologyRiskRow["services"]) => (v.length ? v.map((s, i) => <span key={s.id}>{i ? "، " : ""}<Link className="ds-link" to={`/${orgId}/services/${s.id}`}>{s.name}</Link></span>) : <span className="text-ink-3">—</span>) },
                      ]}
                    />
                  </Card>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

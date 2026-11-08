// «داشبورد رخدادها» (catalogue INC-082): open work, flow (created vs resolved), MTTA and MTTR (median and p90 by
// priority), SLA compliance and what is at risk, reopen / first-time resolution / ping-pong rates, backlog ageing,
// channels and categories — over 7, 30 or 90 days. The server computes every figure from the incidents the person may
// read; tiles open the matching queue.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table } from "antd";
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { fa, pct } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { INCIDENT_KEYS, incidentApi, type Bucket } from "./api";
import { durationText } from "./model";

const PERIODS = [
  { value: 7, label: "۷ روز" },
  { value: 30, label: "۳۰ روز" },
  { value: 90, label: "۹۰ روز" },
];

/** Horizontal bars of a distribution (counts, never animated). */
export function Bars({ items, label }: { items: Bucket[]; label: string }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  if (!items.length) return <p className="text-[13px] text-ink-3">داده‌ای نیست.</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {items.map((x) => (
        <li key={x.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate text-ink-2" title={x.label}>
            {x.label || "(خالی)"}
          </span>
          <span className="h-2 overflow-hidden rounded-xs bg-sunken" aria-hidden>
            <span className="block h-full rounded-xs" style={{ width: `${(x.count / max) * 100}%`, background: "var(--ds-chart-1)" }} />
          </span>
          <span className="ds-num text-ink">{fa(x.count)}</span>
        </li>
      ))}
    </ul>
  );
}

const rate = (v: number | null) => (v === null ? "—" : pct(v / 100));

export default function Dashboard() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: INCIDENT_KEYS.dashboard(orgId, days), queryFn: () => incidentApi.dashboard(api, days), staleTime: 60_000 });
  const go = (path: string) => () => nav(`/${orgId}/${path}`);
  const d = q.data;
  return (
    <div>
      <PageHeader title="داشبورد رخدادها" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={PERIODS} />} />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داشبورد در دسترس نیست" description="به رخدادها دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="رخدادهای باز" value={fa(d.open.total)} hint={`${fa(d.open.unassigned)} بی‌کارشناس`} onClick={go("incidents/unassigned")} />
            <StatCard title="رخداد عمدهٔ فعال" value={fa(d.open.major)} hint={`${fa(d.major.declared)} اعلام در دوره`} onClick={go("incidents/major")} />
            <StatCard title="ثبت / حل در دوره" value={`${fa(d.flow.created)} / ${fa(d.flow.resolved)}`} hint={d.flow.created > d.flow.resolved ? "انباشت در حال افزایش" : "انباشت ثابت یا رو به کاهش"} />
            <StatCard title="رعایت توافق" value={d.sla ? rate(d.sla.compliance) : "—"} hint={d.sla ? `${fa(d.sla.breached)} نقض · ${fa(d.sla.at_risk)} در خطر` : "دسترسی به زمان‌سنج‌ها لازم است"} onClick={go("incidents/at-risk")} />
            <StatCard title="میانهٔ زمان تا شروع رسیدگی" value={durationText(d.times.mtta_median) || "—"} />
            <StatCard title="میانهٔ زمان حل" value={durationText(d.times.mttr_median) || "—"} hint={d.times.mttr_p90 !== null ? `صدک ۹۰: ${durationText(d.times.mttr_p90)}` : undefined} />
            <StatCard title="حل بی‌ارجاع و بی‌بازگشایی" value={rate(d.quality.first_time_rate)} hint={`بازگشایی ${rate(d.quality.reopen_rate)}`} />
            <StatCard title="پاس‌کاری (بیش از دو ارجاع)" value={rate(d.quality.ping_pong_rate)} hint={d.quality.reassign_avg !== null ? `میانگین ارجاع ${fa(Number(d.quality.reassign_avg), 1)}` : undefined} />
          </div>
          <Card title="ثبت و حل">
            {d.flow.trend.length ? (
              <div className="h-[220px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.flow.trend} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                    <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} minTickGap={16} />
                    <YAxis orientation="right" allowDecimals={false} tickCount={4} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
                    <Tooltip cursor={{ fill: "var(--ds-hover)" }} isAnimationActive={false} formatter={(v) => fa(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="created" name="ثبت" fill="var(--ds-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                    <Bar dataKey="resolved" name="حل" fill="var(--ds-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">در این دوره رخدادی ثبت نشده است.</p>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="باز به تفکیک اولویت">
              <Bars items={d.open.by_priority} label="رخدادهای باز به تفکیک اولویت" />
            </Card>
            <Card title="سن رخدادهای باز">
              <Bars items={d.ageing} label="سن رخدادهای باز" />
            </Card>
            <Card title="زمان حل به تفکیک اولویت" flush>
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={d.times.by_priority}
                locale={{ emptyText: "در این دوره رخدادی حل نشده است" }}
                columns={[
                  { title: "اولویت", dataIndex: "label" },
                  { title: "حل‌شده", dataIndex: "count", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "میانه", dataIndex: "median", align: "end", render: (v: number | null) => <span className="ds-num">{durationText(v) || "—"}</span> },
                  { title: "صدک ۹۰", dataIndex: "p90", align: "end", render: (v: number | null) => <span className="ds-num">{durationText(v) || "—"}</span> },
                ]}
              />
            </Card>
            <Card title="کیفیت و دانش">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-ink-2">حل با خطای شناخته‌شده</dt>
                <dd className="ds-num text-ink">{rate(d.quality.known_error_rate)}</dd>
                <dt className="text-ink-2">ثبت با الگو</dt>
                <dd className="ds-num text-ink">{rate(d.quality.template_rate)}</dd>
                <dt className="text-ink-2">میانهٔ زمان حل رخداد عمده</dt>
                <dd className="ds-num text-ink">{durationText(d.major.mttr_median) || "—"}</dd>
                <dt className="text-ink-2">بازبینی‌های منتشرشده</dt>
                <dd className="ds-num text-ink">{fa(d.major.reviews)}</dd>
              </dl>
            </Card>
            <Card title="مجرای دریافت">
              <Bars items={d.channels} label="رخدادها به تفکیک مجرای دریافت" />
            </Card>
            <Card title="دسته‌های پرتکرار">
              <Bars items={d.categories} label="رخدادها به تفکیک دسته" />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

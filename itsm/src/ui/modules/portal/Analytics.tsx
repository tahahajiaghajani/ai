// «آمار درگاه» (PTL-050, PTL-051): how people use self-service over a period — visitors and searches a day, searches
// that found nothing (knowledge gaps to write), AI answers, deflections (a search or an article that ended without a
// ticket), orders and reports from the portal; the assistant's conversations by channel, hand-offs and containment; the
// messaging connectors' traffic and linked accounts; survey response and satisfaction. Counts only, never people.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Skeleton, Table } from "antd";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, StatCard } from "../../components/display";
import { PORTAL_KEYS, portalApi } from "./api";

const PERIODS = [
  { value: 7, label: "۷ روز" },
  { value: 30, label: "۳۰ روز" },
  { value: 90, label: "۹۰ روز" },
];
const CHANNEL_LABEL: Record<string, string> = { portal: "درگاه", app: "برنامه", email: "ایمیل", messenger: "پیام‌رسان", sms: "پیامک", test: "آزمایش" };
const KIND_LABEL: Record<string, string> = { telegram: "تلگرام", bale: "بله", webhook: "وب‌هوک" };

function Ranked({ items, empty }: { items: { label: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  if (!items.length) return <p className="m-0 text-[13px] text-ink-3">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((x) => (
        <li key={x.label} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate text-ink-2" title={x.label}>
            {x.label}
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

export default function Analytics() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: PORTAL_KEYS.analytics(orgId, days), queryFn: () => portalApi.analytics(api, days), retry: false, staleTime: 60_000 });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="آمار درگاه" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={PERIODS} />} />
      {q.isLoading ? (
        <Skeleton active />
      ) : !d ? (
        <EmptyState title="آمار درگاه در دسترس نیست" description="دیدن آمار برای مدیران درگاه و گزارش‌ها است." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="بازدیدکننده" value={fa(d.visitors)} hint={`${fa(d.searches)} جست‌وجو`} />
            <StatCard title="جست‌وجوی بی‌نتیجه" value={d.zero_rate === null ? "—" : `${fa(d.zero_rate)}٪`} hint={`${fa(d.zero)} بار`} />
            <StatCard title="پیشگیری از ثبت" value={fa(d.deflections)} hint={`${fa(d.answers)} پاسخ هوشمند`} />
            <StatCard title="سفارش و گزارش از درگاه" value={`${fa(d.orders)} / ${fa(d.reports)}`} />
            <StatCard title="گفتگوهای دستیار" value={fa(d.chat.conversations)} hint={`${fa(d.chat.handoffs)} سپرده به کارشناس`} />
            <StatCard title="حل بی‌کارشناس" value={d.chat.containment === null ? "—" : `${fa(d.chat.containment)}٪`} hint="گفتگوهایی که به کارشناس نرسید" />
            <StatCard title="پاسخ نظرسنجی" value={`${fa(d.surveys.responses)} / ${fa(d.surveys.invited)}`} hint={d.surveys.csat_pct === null ? undefined : `رضایت ${fa(d.surveys.csat_pct)}٪`} />
          </div>
          <Card title="روزانه">
            {d.daily.length ? (
              <div className="h-[220px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.daily} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                    <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} minTickGap={16} />
                    <YAxis orientation="right" allowDecimals={false} tickCount={4} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
                    <Tooltip cursor={{ fill: "var(--ds-hover)" }} isAnimationActive={false} formatter={(v) => fa(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="visitors" name="بازدیدکننده" fill="var(--ds-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                    <Bar dataKey="searches" name="جست‌وجو" fill="var(--ds-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-ink-3">در این دوره کسی از درگاه استفاده نکرده است.</p>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="پرتکرارترین جست‌وجوها">
              <Ranked items={d.top_queries.map((x) => ({ label: x.query, count: x.count }))} empty="جست‌وجویی نبوده است." />
            </Card>
            <Card title="جست‌وجوهای بی‌نتیجه (مقاله‌های لازم)">
              <Ranked items={d.top_zero.map((x) => ({ label: x.query, count: x.count }))} empty="همهٔ جست‌وجوها نتیجه داشتند." />
            </Card>
            <Card title="گفتگوها به تفکیک مجرا">
              <Ranked items={d.chat.by_channel.map((x) => ({ label: CHANNEL_LABEL[x.channel] ?? x.channel, count: x.count }))} empty="گفتگویی نبوده است." />
            </Card>
            <Card title="پیام‌رسان‌ها" flush>
              <Table
                size="small"
                pagination={false}
                rowKey="name"
                dataSource={d.channels}
                locale={{ emptyText: "پیام‌رسانی وصل نشده است" }}
                columns={[
                  { title: "مجرا", dataIndex: "name", render: (v: string, r) => `${v} (${KIND_LABEL[r.kind] ?? r.kind})` },
                  { title: "دریافتی", dataIndex: "received", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "ناموفق", dataIndex: "failed", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "حساب وصل", dataIndex: "linked", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                ]}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

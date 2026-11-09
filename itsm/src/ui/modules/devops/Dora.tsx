// «شاخص‌های DORA» (DEV-015): deployment frequency, lead time for changes, change failure rate and failed deployment
// recovery time of production deployments in a period, each with its performance band against the organisation's
// thresholds and its definition; the rework rate; the change velocity (deployments from pipelines with automatic
// standard changes versus manual ones); the weekly series and the breakdown per service. Numbers come from the
// server with the person's access; the screen only presents them.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Tooltip } from "antd";
import { BarChart, Bar, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { Info } from "lucide-react";
import { formatJalali, toFa } from "@shared/jalali";
import type { DoraBand } from "@shared/devops/logic";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card, ICON14 } from "../../components/blocks";
import { DEVOPS_KEYS, devopsApi } from "./api";
import { bandLabel, bandTone, frequencyText, humanDuration } from "./model";

function Metric({ title, value, band, help, sub }: { title: string; value: string; band: DoraBand; help?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
        {title}
        {help ? (
          <Tooltip title={help}>
            <Info {...ICON14} className="text-ink-3" aria-label={help} />
          </Tooltip>
        ) : null}
      </div>
      <div className="ds-num text-[20px] text-ink">{value}</div>
      <div className="flex items-center gap-2">
        <Chip tone={bandTone(band)}>{bandLabel(band)}</Chip>
        {sub ? <span className="text-[12px] text-ink-3">{sub}</span> : null}
      </div>
    </div>
  );
}

export default function Dora() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: DEVOPS_KEYS.dora(orgId, days, null), queryFn: () => devopsApi.dora(api, days) });
  const d = q.data;
  const o = d?.overall;
  const def = (k: string) => d?.definitions?.[k] ? `${d.definitions[k].name}: ${d.definitions[k].formula}` : undefined;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="شاخص‌های DORA" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }, { value: 180, label: "۱۸۰ روز" }]} aria-label="بازه" />} />
      {q.isLoading ? (
        <Loader />
      ) : !d || !o ? (
        <EmptyState title="شاخص‌ها در دسترس نیست" />
      ) : !o.deployments ? (
        <EmptyState title="در این بازه استقرار عملیاتی پایان‌یافته‌ای ثبت نشده است" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric title="تناوب استقرار" value={frequencyText(o.frequency.per_day)} band={o.frequency.band} help={def("frequency")} sub={`${toFa(o.successful)} استقرار موفق`} />
            <Metric title="زمان تحویل تغییر (میانه)" value={humanDuration(o.lead_time.p50)} band={o.lead_time.band} help={def("lead_time")} sub={`از ${toFa(o.lead_time.n)} استقرار`} />
            <Metric title="نرخ شکست تغییر" value={o.change_failure_rate.pct === null ? "—" : `${toFa(o.change_failure_rate.pct)}٪`} band={o.change_failure_rate.band} help={def("cfr")} sub={`${toFa(o.failures)} از ${toFa(o.deployments)}`} />
            <Metric title="زمان بازیابی (میانه)" value={humanDuration(o.recovery.p50)} band={o.recovery.band} help={def("recovery")} sub={o.recovery.open ? `${toFa(o.recovery.open)} هنوز بازیابی نشده` : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="استقرار در هر هفته" className="lg:col-span-2">
              <div style={{ height: 240 }} role="img" aria-label="تعداد استقرارهای موفق و ناموفق در هر هفته">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={o.weekly.map((w) => ({ label: formatJalali(w.week, { style: "short" }), ok: w.deployments, failed: w.failures }))} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                    <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} />
                    <YAxis orientation="right" allowDecimals={false} tickCount={4} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => toFa(v)} />
                    <ChartTooltip cursor={{ fill: "var(--ds-hover)" }} formatter={(v, name) => [toFa(Number(v ?? 0)), name === "ok" ? "موفق" : "شکست"]} isAnimationActive={false} />
                    <Legend formatter={(name: string) => (name === "ok" ? "موفق" : "شکست")} />
                    <Bar dataKey="ok" stackId="a" fill="var(--ds-chart-1)" maxBarSize={28} />
                    <Bar dataKey="failed" stackId="a" fill="var(--ds-chart-4)" maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="سرعت تغییر دواپس">
              <ul className="flex flex-col gap-1.5 text-[13px]">
                <li className="flex justify-between"><span>استقرارهای عملیاتی</span><span className="ds-num">{toFa(d.velocity.deployments)}</span></li>
                <li className="flex justify-between"><span>از خط لوله‌ها</span><span className="ds-num">{toFa(d.velocity.from_pipelines)}</span></li>
                <li className="flex justify-between"><span>با تغییر مجاز</span><span className="ds-num">{toFa(d.velocity.with_change)}</span></li>
                <li className="flex justify-between"><span>دستی</span><span className="ds-num">{toFa(d.velocity.manual)}</span></li>
                <li className="flex justify-between border-t border-line pt-1.5"><span>نرخ دوباره‌کاری (هات‌فیکس)</span><span className="ds-num">{o.rework_rate.pct === null ? "—" : `${toFa(o.rework_rate.pct)}٪`}</span></li>
              </ul>
            </Card>
          </div>
          {d.services.length > 1 ? (
            <Card title="به تفکیک خدمت">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="text-ink-3">
                      <th className="py-1 text-start font-normal">خدمت</th>
                      <th className="py-1 text-end font-normal">استقرار</th>
                      <th className="py-1 text-end font-normal">تناوب</th>
                      <th className="py-1 text-end font-normal">زمان تحویل</th>
                      <th className="py-1 text-end font-normal">نرخ شکست</th>
                      <th className="py-1 text-end font-normal">بازیابی</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.services.map((s) => (
                      <tr key={s.service ?? "none"} className="border-t border-line">
                        <td className="py-1.5">{s.service ? (d.display[s.service] ?? "(محدود)") : "بدون خدمت"}</td>
                        <td className="ds-num py-1.5 text-end">{toFa(s.deployments)}</td>
                        <td className="py-1.5 text-end">{frequencyText(s.frequency.per_day)}</td>
                        <td className="py-1.5 text-end">{humanDuration(s.lead_time.p50)}</td>
                        <td className="ds-num py-1.5 text-end">{s.change_failure_rate.pct === null ? "—" : `${toFa(s.change_failure_rate.pct)}٪`}</td>
                        <td className="py-1.5 text-end">{humanDuration(s.recovery.p50)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

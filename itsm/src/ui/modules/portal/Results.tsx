// «نتیجهٔ نظرسنجی‌ها» (PTL-038…040): for those who manage surveys — responses and response rate, CSAT (the share of 4–5),
// NPS, effort, happiness and lost time over a period, by week or month, the spread of the scores, by group, and the
// latest comments (anonymous answers carry no record or person). One survey or all.
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Select, Skeleton, Table } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, StatCard } from "../../components/display";
import { recordsApi } from "../../records";
import { PORTAL_KEYS, portalApi } from "./api";

const PERIODS = [
  { value: 30, label: "۳۰ روز" },
  { value: 90, label: "۹۰ روز" },
  { value: 365, label: "یک سال" },
];
const num = (v: number | null, d = 0, suffix = "") => (v === null || v === undefined ? "—" : `${fa(v, d)}${suffix}`);

/** Vertical bars of a score's spread (1–5 or 0–10). */
function Spread({ values, from, label }: { values: number[]; from: number; label: string }) {
  const max = Math.max(1, ...values);
  if (!values.some((v) => v > 0)) return <p className="m-0 text-[13px] text-ink-3">پاسخی نیست.</p>;
  return (
    <div className="flex h-[120px] items-end gap-1.5" role="img" aria-label={`${label}: ${values.map((v, i) => `${fa(i + from)}: ${fa(v)}`).join("، ")}`} dir="ltr">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="ds-num text-[11px] text-ink-3">{v ? fa(v) : ""}</span>
          <span className="block w-full rounded-t-[3px]" style={{ height: `${Math.max(2, (v / max) * 84)}px`, background: "var(--ds-chart-1)" }} />
          <span className="ds-num text-[11.5px] text-ink-2">{fa(i + from)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Results() {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const survey = sp.get("survey");
  const [days, setDays] = useState(90);
  const surveys = useQuery({ queryKey: [...PORTAL_KEYS.all(orgId), "surveys-list"], queryFn: () => recordsApi.list(api, "survey", { size: 100, sort: "name", fields: ["name", "kind", "active"] }) });
  const q = useQuery({ queryKey: PORTAL_KEYS.results(orgId, survey, days), queryFn: () => portalApi.results(api, survey, days), retry: false });
  const r = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="نتیجهٔ نظرسنجی‌ها"
        actions={
          <>
            <Select
              value={survey ?? ""}
              onChange={(v) => setSp(v ? { survey: v } : {}, { replace: true })}
              options={[{ value: "", label: "همهٔ نظرسنجی‌ها" }, ...(surveys.data?.rows ?? []).map((s) => ({ value: s.id, label: String(s.name) }))]}
              style={{ minInlineSize: 220 }}
              aria-label="نظرسنجی"
            />
            <Segmented value={days} onChange={(v) => setDays(Number(v))} options={PERIODS} />
          </>
        }
      />
      {q.isLoading ? (
        <Skeleton active />
      ) : !r ? (
        <EmptyState title="نتیجه‌ها در دسترس نیست" description="دیدن نتیجه‌ها برای مدیران نظرسنجی است." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="پاسخ‌ها" value={fa(r.totals.responses)} hint={`از ${fa(r.totals.invited)} دعوت · نرخ پاسخ ${num(r.totals.rate, 0, "٪")}`} />
            <StatCard title="رضایت (CSAT)" value={num(r.totals.csat_pct, 0, "٪")} hint={r.totals.csat_avg !== null ? `میانگین ${fa(r.totals.csat_avg, 1)} از ۵` : "پرسش رضایت پاسخ نگرفته"} />
            <StatCard title="NPS" value={num(r.totals.nps)} hint="از −۱۰۰ تا +۱۰۰" />
            <StatCard title="سختی کار (CES)" value={num(r.totals.ces_avg, 1)} hint={r.totals.happiness_avg !== null ? `شادمانی ${fa(r.totals.happiness_avg, 1)} · وقت ازدست‌رفته ${num(r.totals.lost_minutes_avg, 0, " دقیقه")}` : undefined} />
          </div>
          <Card title="روند">
            {r.trend.length ? (
              <div className="h-[220px]" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.trend} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                    <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} minTickGap={16} />
                    <YAxis orientation="right" allowDecimals={false} tickCount={4} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
                    <Tooltip cursor={{ fill: "var(--ds-hover)" }} isAnimationActive={false} formatter={(v, name) => [fa(Number(v)), name === "responses" ? "پاسخ" : "CSAT٪"]} />
                    <Bar dataKey="responses" name="responses" fill="var(--ds-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                    <Bar dataKey="csat_pct" name="csat" fill="var(--ds-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-ink-3">در این دوره پاسخی نرسیده است.</p>
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="پخش امتیاز رضایت (۱ تا ۵)">
              <Spread values={r.distribution.csat} from={1} label="پخش امتیاز رضایت" />
            </Card>
            <Card title="پخش امتیاز توصیه (۰ تا ۱۰)">
              <Spread values={r.distribution.nps} from={0} label="پخش امتیاز توصیه" />
            </Card>
            <Card title="به تفکیک گروه" flush>
              <Table
                size="small"
                pagination={false}
                rowKey={(g) => g.id ?? "none"}
                dataSource={r.groups}
                locale={{ emptyText: "پاسخی نیست" }}
                columns={[
                  { title: "گروه", dataIndex: "name" },
                  { title: "پاسخ", dataIndex: "responses", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "CSAT", dataIndex: "csat_pct", align: "end", render: (v: number | null) => <span className="ds-num">{num(v, 0, "٪")}</span> },
                ]}
              />
            </Card>
            <Card title="تازه‌ترین نظرها" flush>
              {r.comments.length ? (
                <ul className="m-0 list-none p-0">
                  {r.comments.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0">
                      <span className="text-ink">{c.comment}</span>
                      <span className="text-[12px] text-ink-3">
                        {formatJalali(c.at.slice(0, 10))}
                        {c.csat !== null ? ` · رضایت ${fa(c.csat)} از ۵` : ""}
                        {c.record_number ? ` · ${c.record_number}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 p-4 text-[13px] text-ink-3">نظری نوشته نشده است.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// «پیش‌بینی حجم کار» (catalogue AI-052/AI-116): the daily or weekly volume of a table the viewer reads — counted with
// their own access — forecast with the Iranian week and the official holidays, its 80% band, unusual days, the
// backtest in a sentence and staffing hints with their assumptions. Optionally one service, group or channel.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Select, Table } from "antd";
import { useSearchParams } from "react-router";
import type { ForecastView } from "@shared/ai/ml";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { Card, Note } from "../../components/blocks";
import { ML_KEYS, mlApi } from "./api";
import { ForecastChart } from "./ForecastChart";
import { backtestText } from "./model";
import "./ml.css";

const TABLES = [
  { value: "incident", label: "رخدادها" },
  { value: "request_item", label: "اقلام درخواست" },
  { value: "change_request", label: "تغییرها" },
  { value: "problem", label: "مشکل‌ها" },
];

export default function ForecastPage() {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const table = sp.get("table") || "incident";
  const [grain, setGrain] = useState<"day" | "week">(sp.get("grain") === "week" ? "week" : "day");
  const q = useQuery({ queryKey: ML_KEYS.forecast(orgId, { table, grain }), queryFn: () => mlApi.forecast(api, { table, grain }), retry: false });
  const f: ForecastView | undefined = q.data;
  const staffing = useMemo(() => (f?.staffing ?? []).slice(0, 14), [f]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="پیش‌بینی حجم کار"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select size="small" value={table} options={TABLES} onChange={(v) => setSp({ table: v, grain })} aria-label="جدول" style={{ minInlineSize: 140 }} />
            <Segmented
              size="small"
              value={grain}
              onChange={(v) => setGrain(v as "day" | "week")}
              options={[
                { value: "day", label: "روزانه" },
                { value: "week", label: "هفتگی" },
              ]}
            />
          </div>
        }
      />
      {q.isLoading ? <Skeleton rows={6} /> : null}
      {q.error ? <Note tone="warning">{(q.error as Error).message}</Note> : null}
      {f ? (
        <>
          <Card title={`${f.table_label}${f.by ? ` — ${f.by.label}` : ""}`} meta={<span className="ml-muted">با دسترسی خود شما شمرده شده است</span>}>
            {f.ok ? <ForecastChart f={f} /> : <EmptyState compact title="پیش‌بینی ساخته نشد" description={f.refused_reason_fa ?? undefined} />}
            <p className="ml-muted">{backtestText(f)}</p>
            {f.grain === "day" && f.ok ? (
              <p className="ml-muted">
                اثر تعطیلات رسمی: {faDigits(Math.round(f.holiday_factor * 100))}٪ حجم یک روز عادی هم‌نام؛ الگوی هفته از خود داده‌ها آموخته می‌شود.
              </p>
            ) : null}
          </Card>
          {staffing.length ? (
            <Card title="نیروی پیشنهادی" meta={<span className="ml-muted">فرض: هر مورد {faDigits(f.assumptions.handle_minutes)} دقیقه{f.assumptions.handle_from_data ? " (میانهٔ «زمان کار» ثبت‌شده)" : ""}، هر نفر {faDigits(f.assumptions.productive_hours)} ساعت مفید در روز</span>}>
              <Table
                size="small"
                rowKey="date"
                pagination={false}
                dataSource={staffing.map((s, i) => ({ ...s, p50: f.points[i]?.p50 ?? null, holiday: f.points[i]?.holiday ?? false }))}
                columns={[
                  { title: "روز", dataIndex: "date", render: (d: string, r) => `${formatJalali(d, { style: "short" })}${r.holiday ? " · تعطیل" : ""}` },
                  { title: "حجم پیش‌بینی‌شده", dataIndex: "p50", align: "end", render: (v: number | null) => <span className="ds-num">{v === null ? "—" : faDigits(Math.round(v))}</span> },
                  { title: "نیرو (معمول)", dataIndex: "people_p50", align: "end", render: (v: number) => <span className="ds-num">{faDigits(v)}</span> },
                  { title: "نیرو (روز شلوغ)", dataIndex: "people_p90", align: "end", render: (v: number) => <span className="ds-num">{faDigits(v)}</span> },
                ]}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

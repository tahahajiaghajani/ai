// «دسترس‌پذیری خدمت‌ها» — the service availability dashboard (catalogue CON-002/004): for a Jalali month, quarter or
// year (and the ones before it), every service the person may read with its availability on its agreed hours against
// the target, the downtime against the budget, failures, MTBF and MTRS, outages; services missing their target
// first. A service opens its trend over the last twelve periods and its outages.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Segmented, Table } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { formatJalaliDateTime } from "@shared/jalali";
import { OUTAGE_TYPES } from "@shared/tables/continuity";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { recordPath, newRecordPath } from "../../records/extensions";
import { CONTINUITY_KEYS, continuityApi, type ServiceAvailability } from "./api";
import { availabilityText, availabilityTone, minutesText } from "./model";
import "../event/event.css";

type Unit = "month" | "quarter" | "year";
const UNITS: { value: Unit; label: string }[] = [
  { value: "month", label: "ماه" },
  { value: "quarter", label: "فصل" },
  { value: "year", label: "سال" },
];
const outageType = (v: unknown) => OUTAGE_TYPES.find((o) => o.value === v)?.label ?? "";

export default function Availability() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [unit, setUnit] = useState<Unit>("month");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<ServiceAvailability | null>(null);
  const q = useQuery({ queryKey: CONTINUITY_KEYS.availability(orgId, unit, offset), queryFn: () => continuityApi.availability(api, unit, offset), placeholderData: (p) => p, staleTime: 60_000 });
  const d = q.data;
  return (
    <div className="ev-page">
      <PageHeader
        title="دسترس‌پذیری خدمت‌ها"
        actions={
          <Button type="primary" onClick={() => nav(`/${orgId}/${newRecordPath("outage")}`)}>
            ثبت قطعی
          </Button>
        }
      />
      <div className="ev-tb" role="toolbar" aria-label="دوره">
        <Segmented value={unit} onChange={(v) => (setUnit(v as Unit), setOffset(0))} options={UNITS} />
        <Button icon={<ChevronRight {...ICON14} />} aria-label="دورهٔ قبلی" onClick={() => setOffset(offset - 1)} />
        <Button disabled={offset === 0} onClick={() => setOffset(0)}>
          دورهٔ جاری
        </Button>
        <Button icon={<ChevronLeft {...ICON14} />} aria-label="دورهٔ بعدی" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} />
        <h2 className="m-0 text-[15px] font-medium">{d?.period.label ?? ""}</h2>
      </div>
      {q.isLoading && !d ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="دسترس‌پذیری بارگذاری نشد" description="به خدمت‌ها دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="میانگین دسترس‌پذیری" value={availabilityText(d.totals.average, 3)} />
            <StatCard title="در هدف" value={`${fa(d.totals.meeting)} از ${fa(d.totals.with_target)}`} hint="خدمت‌های دارای هدف" />
            <StatCard title="خرابی‌ها" value={fa(d.totals.failures)} />
            <StatCard title="دقیقه‌های از دست رفته" value={minutesText(d.totals.downtime_ms)} />
          </div>
          {!d.services.length ? (
            <EmptyState title="خدمت زنده‌ای نیست" description="دسترس‌پذیری خدمت‌های زنده و در گذار حساب می‌شود." />
          ) : (
            <Card title="خدمت‌ها" flush>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                scroll={{ x: true }}
                dataSource={d.services}
                onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: "pointer" } })}
                columns={[
                  { title: "خدمت", dataIndex: "name", render: (v: string, r) => <span>{v} <span className="ds-num ltr text-[12px] text-ink-3">{r.number}</span></span> },
                  {
                    title: "دسترس‌پذیری",
                    dataIndex: "availability",
                    align: "end",
                    render: (v: number | null, r) => {
                      const t = availabilityTone(v, r.target);
                      return <span className={`ds-num ${t === "bad" ? "text-danger" : t === "warn" ? "text-warning" : t === "good" ? "text-in" : ""}`}>{availabilityText(v, 3)}</span>;
                    },
                  },
                  { title: "هدف", dataIndex: "target", align: "end", render: (v: number | null) => <span className="ds-num">{v === null ? "—" : availabilityText(v, 2)}</span> },
                  { title: "از دست رفته", dataIndex: "downtime_ms", align: "end", render: (v: number) => <span className="ds-num">{minutesText(v)}</span> },
                  { title: "مانده از بودجه", dataIndex: "budget_left_ms", align: "end", render: (v: number | null) => <span className={`ds-num ${v !== null && v < 0 ? "text-danger" : ""}`}>{v === null ? "—" : minutesText(v)}</span> },
                  { title: "خرابی", dataIndex: "failures", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  { title: "MTBF", dataIndex: "mtbf_ms", align: "end", render: (v: number | null) => <span className="ds-num">{v === null ? "—" : minutesText(v)}</span> },
                  { title: "MTRS", dataIndex: "mtrs_ms", align: "end", render: (v: number | null) => <span className="ds-num">{v === null ? "—" : minutesText(v)}</span> },
                ]}
              />
            </Card>
          )}
        </>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""} size="large" destroyOnHidden>
        {open ? <Trend id={open.id} unit={unit} /> : null}
      </Drawer>
    </div>
  );
}

function Trend({ id, unit }: { id: string; unit: Unit }) {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: CONTINUITY_KEYS.trend(orgId, id, unit), queryFn: () => continuityApi.trend(api, id, unit), staleTime: 60_000 });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState title="روند بارگذاری نشد" />;
  const data = d.periods.map((p) => ({ label: p.label, value: p.availability ?? null }));
  const min = Math.min(99, ...data.map((x) => x.value ?? 100), d.service.target ?? 100);
  return (
    <div className="flex flex-col gap-4">
      <div className="h-[220px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 0, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
            <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} minTickGap={8} />
            <YAxis orientation="right" domain={[Math.floor(min), 100]} width={44} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
            <Tooltip isAnimationActive={false} formatter={(v) => availabilityText(Number(v), 3)} />
            {d.service.target !== null ? <ReferenceLine y={d.service.target} stroke="var(--ds-danger)" strokeDasharray="4 3" /> : null}
            <Bar dataKey="value" name="دسترس‌پذیری" fill="var(--ds-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Card title="قطعی‌ها" flush>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: true }}
          dataSource={d.outages}
          locale={{ emptyText: "قطعی‌ای ثبت نشده یا به آن دسترسی ندارید" }}
          onRow={(r) => ({ onClick: () => nav(`/${orgId}/${recordPath("outage", String(r.id))}`), style: { cursor: "pointer" } })}
          columns={[
            { title: "شماره", dataIndex: "number", render: (v: string) => <span className="ds-num ltr">{v}</span> },
            { title: "عنوان", dataIndex: "title" },
            { title: "نوع", dataIndex: "outage_type", render: (v: string) => <Chip tone={v === "outage" ? "danger" : v === "degradation" ? "warning" : "neutral"}>{outageType(v)}</Chip> },
            { title: "شروع", dataIndex: "begin_at", render: (v: string) => formatJalaliDateTime(v, timezone) },
            { title: "مدت", dataIndex: "duration", align: "end", render: (v: number | null) => <span className="ds-num">{v === null || v === undefined ? "ادامه دارد" : minutesText(Number(v) * 1000)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

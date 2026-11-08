// «داشبورد درخواست‌ها» (REQ-054): volumes, open items by state and stage, the most ordered items with their 85th
// percentile, fulfilment time as percentiles (never only the mean), delivery within the promise, approval cycle time
// and rejections, first-time-right, waiting for requesters, zero-touch and self-service rates, catalogue completeness
// (ad-hoc share), the backlog by age and satisfaction — every number computed by the server from what the viewer may
// read.
import { useState } from "react";
import { Segmented } from "antd";
import { STAGES, REQUEST_CHANNELS, label } from "@shared/request/vocab";
import { REQUEST_ITEM_STATES } from "@shared/tables/request";
import { PageHeader } from "../../components/layout";
import { Loader, StatCard, EmptyState } from "../../components/display";
import { Card } from "../../components/blocks";
import { useRequestDashboard } from "./api";
import { durationText } from "./model";

const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("fa-IR")}٪`);
const stateLabel = (k: string) => REQUEST_ITEM_STATES.states.find((s) => s.value === k)?.label ?? k;

function Bars({ rows, of }: { rows: { key: string; label: string; count: number }[]; of?: number }) {
  const max = of ?? Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <EmptyState compact title="داده‌ای نیست" />;
  return (
    <div className="rq-bars">
      {rows.map((r) => (
        <div key={r.key} className="rq-bar">
          <span>{r.label}</span>
          <span className="rq-bar-t" aria-hidden>
            <span style={{ inlineSize: `${Math.round((r.count / max) * 100)}%` }} />
          </span>
          <span className="rq-bar-n">{r.count.toLocaleString("fa-IR")}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const q = useRequestDashboard(days);
  const d = q.data;
  return (
    <>
      <PageHeader
        title="داشبورد درخواست‌ها"
        actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 7, label: "۷ روز" }, { value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }]} />}
      />
      {q.isLoading ? <Loader /> : null}
      {d ? (
        <div className="rq-form">
          <div className="rq-kpis">
            <StatCard title="سفارش‌شده" value={d.totals.ordered.toLocaleString("fa-IR")} />
            <StatCard title="باز" value={d.totals.open.toLocaleString("fa-IR")} />
            <StatCard title="گذشته از موعد" value={d.totals.overdue.toLocaleString("fa-IR")} />
            <StatCard title="انجام تا موعد وعده" value={pct(d.within_promise)} />
            <StatCard title="میانهٔ زمان انجام" value={durationText(d.fulfilment.p50) || "—"} />
            <StatCard title="۸۵٪ انجام‌ها تا" value={durationText(d.fulfilment.p85) || "—"} />
            <StatCard title="۹۵٪ انجام‌ها تا" value={durationText(d.fulfilment.p95) || "—"} />
            <StatCard title="میانگین زمان تأیید" value={d.approval.avg_hours === null ? "—" : `${d.approval.avg_hours.toLocaleString("fa-IR")} ساعت`} />
            <StatCard title="نرخ رد" value={pct(d.approval.rejection_rate)} />
            <StatCard title="درست در بار نخست" value={pct(d.first_time_right)} />
            <StatCard title="سهم انتظار برای درخواست‌کننده" value={pct(d.waiting_share)} />
            <StatCard title="انجام بدون دخالت کارشناس" value={pct(d.zero_touch)} />
            <StatCard title="سفارش خودخدمت" value={pct(d.self_service)} />
            <StatCard title="درخواست بدون مدل" value={pct(d.ad_hoc)} />
            <StatCard title="رضایت" value={d.csat.avg === null ? "—" : `${d.csat.avg.toLocaleString("fa-IR")} از ۵`} />
          </div>
          <div className="rq-two">
            <Card title="اقلام باز بر پایهٔ وضعیت">
              <Bars rows={d.by_state.map((r) => ({ key: r.key, label: stateLabel(r.key), count: r.count }))} />
            </Card>
            <Card title="اقلام باز بر پایهٔ مرحله">
              <Bars rows={d.by_stage.map((r) => ({ key: r.key, label: label(STAGES, r.key) || "—", count: r.count }))} />
            </Card>
            <Card title="پرسفارش‌ترین اقلام" meta={<span className="rq-card-f">با زمان انجام ۸۵٪</span>}>
              <Bars rows={d.top_items.map((r) => ({ key: r.id, label: `${d.display[r.id] ?? "—"}${r.p85 ? ` (${durationText(r.p85)})` : ""}`, count: r.count }))} />
            </Card>
            <Card title="مجرای سفارش">
              <Bars rows={d.by_channel.map((r) => ({ key: r.key, label: label(REQUEST_CHANNELS, r.key) || "—", count: r.count }))} />
            </Card>
            <Card title="سن اقلام باز">
              <Bars rows={d.backlog} />
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

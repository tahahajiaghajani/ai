// «گزارش‌های عملیات» (catalogue EVT-048, EVT-032, EVT-042): alerts and events per day, compression and noise
// reduction, MTTA and MTTR, distributions (severity, source, team, hour of day, noisiest hosts), paging; the
// alert-quality review with rule suggestions and its AI narration (rule-based without a model); on-call load and
// fairness per person. Every figure is computed by the server from what the person may read.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Table } from "antd";
import { Sparkles } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { EVENT_KEYS, eventApi, type AiAnswer, type Bucket } from "./api";
import { durationText } from "./model";
import "./event.css";

const PERIODS = [
  { value: 7, label: "۷ روز" },
  { value: 30, label: "۳۰ روز" },
  { value: 90, label: "۹۰ روز" },
];

function Bars({ items, label }: { items: Bucket[]; label: string }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  if (!items.length) return <p className="m-0 text-[13px] text-ink-3">داده‌ای نیست.</p>;
  return (
    <ul className="ev-bars m-0 p-0" aria-label={label}>
      {items.map((x) => (
        <li key={x.key}>
          <span className="truncate text-ink-2" title={x.label}>
            {x.label}
          </span>
          <span className="bar" aria-hidden>
            <span style={{ inlineSize: `${(x.count / max) * 100}%` }} />
          </span>
          <span className="ds-num">{fa(x.count)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Reports() {
  const [tab, setTab] = useState<"ops" | "noise" | "load">("ops");
  const [days, setDays] = useState(30);
  return (
    <div className="ev-page">
      <PageHeader
        title="گزارش‌های عملیات"
        actions={
          <>
            <Segmented value={tab} onChange={(v) => setTab(v as "ops" | "noise" | "load")} options={[{ value: "ops", label: "هشدارها" }, { value: "noise", label: "کیفیت هشدار" }, { value: "load", label: "بار کشیک" }]} />
            <Segmented value={days} onChange={(v) => setDays(Number(v))} options={PERIODS} />
          </>
        }
      />
      {tab === "ops" ? <Ops days={days} /> : tab === "noise" ? <Noise days={days} /> : <Load days={days} />}
    </div>
  );
}

function Ops({ days }: { days: number }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: EVENT_KEYS.reports(orgId, days), queryFn: () => eventApi.reports(api, days), staleTime: 60_000 });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState title="گزارش در دسترس نیست" description="به هشدارها دسترسی ندارید یا بارگذاری انجام نشد." />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="هشدارها / رویدادها" value={`${fa(d.totals.alerts)} / ${fa(d.totals.events)}`} hint={d.compression !== null ? `فشرده‌سازی ${fa(d.compression, 1)} رویداد برای هر هشدار` : undefined} />
        <StatCard title="کاهش نویز" value={d.noise_reduction !== null ? `${fa(d.noise_reduction, 1)}٪` : "—"} hint={`${fa(d.totals.paged_alerts)} هشدار فراخوان داشت`} />
        <StatCard title="میانهٔ زمان تأیید (MTTA)" value={durationText(d.mtta.median) || "—"} hint={d.mtta.p90 !== null ? `صدک ۹۰: ${durationText(d.mtta.p90)}` : undefined} />
        <StatCard title="میانهٔ زمان رفع (MTTR)" value={durationText(d.mttr.median) || "—"} hint={d.mttr.p90 !== null ? `صدک ۹۰: ${durationText(d.mttr.p90)}` : undefined} />
        <StatCard title="باز اکنون" value={fa(d.totals.open)} hint={`${fa(d.totals.maintenance)} در نگهداری یا تغییر`} />
        <StatCard title="رخداد از هشدار" value={fa(d.totals.incidents)} hint={`${fa(d.totals.groups)} گروه هم‌بسته`} />
        <StatCard title="فراخوان‌ها" value={fa(d.pages.total)} hint={d.pages.ack_rate !== null ? `${fa(d.pages.ack_rate, 1)}٪ تأیید · میانه ${durationText(d.pages.ack_median) || "—"}` : undefined} />
        <StatCard title="فراخوان بیرون از ساعات کاری" value={fa(d.pages.after_hours)} />
      </div>
      <Card title="هشدارها و رویدادها در روز">
        <div className="h-[220px]" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.trend} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
              <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} minTickGap={16} />
              <YAxis orientation="right" allowDecimals={false} tickCount={4} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
              <Tooltip cursor={{ fill: "var(--ds-hover)" }} isAnimationActive={false} formatter={(v) => fa(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="created" name="هشدار تازه" fill="var(--ds-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              <Bar dataKey="cleared" name="رفع‌شده" fill="var(--ds-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="شدت">
          <Bars items={d.by_severity} label="هشدارها به تفکیک شدت" />
        </Card>
        <Card title="منبع">
          <Bars items={d.by_source} label="هشدارها به تفکیک منبع" />
        </Card>
        <Card title="تیم">
          <Bars items={d.by_team} label="هشدارها به تفکیک تیم" />
        </Card>
        <Card title="پرهشدارترین میزبان‌ها">
          <Bars items={d.noisiest} label="پرهشدارترین میزبان‌ها" />
        </Card>
        <Card title="ساعت روز">
          <Bars items={d.by_hour.filter((h) => h.count > 0)} label="هشدارها به تفکیک ساعت" />
        </Card>
        <Card title="فراخوان به تفکیک فرد">
          <Bars items={d.pages.by_person} label="فراخوان‌ها به تفکیک فرد" />
        </Card>
      </div>
    </div>
  );
}

function Noise({ days }: { days: number }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const q = useQuery({ queryKey: EVENT_KEYS.noise(orgId, days), queryFn: () => eventApi.noise(api, days), staleTime: 60_000 });
  const [ai, setAi] = useState<AiAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const narrate = async () => {
    setBusy(true);
    try {
      setAi(await eventApi.aiNoise(api, days));
    } catch (e) {
      n.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState title="گزارش در دسترس نیست" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="هشدارها" value={fa(d.alerts)} />
        <StatCard title="سهم نویز" value={d.noise_share !== null ? `${fa(d.noise_share, 1)}٪` : "—"} />
        <StatCard title="رفع بی‌تأیید" value={d.never_acked_share !== null ? `${fa(d.never_acked_share, 1)}٪` : "—"} />
      </div>
      <Card
        title="روایت بازبینی"
        tools={
          <Button size="small" icon={<Sparkles {...ICON14} />} loading={busy} onClick={narrate}>
            بنویس
          </Button>
        }
      >
        {ai ? (
          <>
            <div className="ev-md">{ai.text}</div>
            <div className="mt-2 text-[11.5px] text-ink-3">{ai.ai ? "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید" : ai.label}</div>
          </>
        ) : (
          <p className="m-0 text-[13px] text-ink-3">برای روایت کوتاه پرنویزترین هشدارها و قاعده‌های پیشنهادی، «بنویس» را بزنید.</p>
        )}
      </Card>
      <Card title="پرتکرارترین هشدارها" flush>
        <Table
          size="small"
          rowKey="fingerprint"
          pagination={false}
          dataSource={d.items}
          locale={{ emptyText: "هشدار پرتکراری در این دوره نبود" }}
          scroll={{ x: true }}
          columns={[
            { title: "هشدار", dataIndex: "title", render: (v: string, r) => <span title={r.node ?? ""}>{v}</span> },
            { title: "منبع", dataIndex: "source", render: (v: string | null) => v ?? "—" },
            { title: "بار", dataIndex: "alerts", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
            { title: "نوسان", dataIndex: "flapping", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
            { title: "بی‌تأیید", dataIndex: "never_acked", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
            { title: "پیشنهاد", dataIndex: "suggestion" },
          ]}
        />
      </Card>
    </div>
  );
}

function Load({ days }: { days: number }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: EVENT_KEYS.load(orgId, days), queryFn: () => eventApi.load(api, days), staleTime: 60_000 });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState title="گزارش در دسترس نیست" description="به برنامه‌های کشیک دسترسی ندارید." />;
  return (
    <Card title="بار و عدالت کشیک" flush>
      <Table
        size="small"
        rowKey="user_id"
        pagination={false}
        dataSource={d.rows}
        locale={{ emptyText: "در این دوره کشیکی نبود" }}
        scroll={{ x: true }}
        columns={[
          { title: "نفر", dataIndex: "user_id", render: (v: string) => d.display[v] ?? "عضو" },
          { title: "ساعت کشیک", dataIndex: "oncall_hours", align: "end", render: (v: number) => <span className="ds-num">{fa(v, 1)}</span> },
          { title: "فراخوان", dataIndex: "pages", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
          { title: "بیرون از ساعات کاری", dataIndex: "after_hours_pages", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
          { title: "تأییدشده", dataIndex: "acknowledged", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
        ]}
      />
    </Card>
  );
}

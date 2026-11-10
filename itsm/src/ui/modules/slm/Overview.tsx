// «نمای کلی سطح خدمت»: the service level indicators of analytics (the module's KPIs reused as analytics tiles), the
// agreements in force by status and kind, what needs attention (missed and at-risk agreements, watermelons, overdue
// reviews, agreements ending), the reviews ahead, the improvement register's numbers and the SLA timers at risk in the
// caller's teams.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Space } from "antd";
import { FilePlus2, Handshake } from "lucide-react";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDate, Loader, StatCard } from "../../components/display";
import { Card, ICON } from "../../components/blocks";
import { recordPath } from "../../records";
import { KpiTile } from "../analytics/parts";
import { ANALYTICS_KEYS, analyticsApi } from "../analytics/api";
import { SLM_KEYS, slmApi } from "./api";
import { kindShort, remainingText, STATUS_LABEL, STATUS_TONE, URGENCY_LABEL, URGENCY_TONE } from "./model";
import "./slm.css";

export function AtRiskTable({ scope }: { scope: "mine" | "groups" }) {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: SLM_KEYS.atRisk(orgId, scope), queryFn: () => slmApi.atRisk(api, scope), refetchInterval: 120_000 });
  if (q.isLoading) return <Loader />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState compact title="زمان‌سنجی در خطر نیست" />;
  return (
    <table className="slm-table">
      <thead><tr><th scope="col">رکورد</th><th scope="col">زمان‌سنج</th><th scope="col">فوریت</th><th scope="col">موعد</th><th scope="col">احتمال نقض</th></tr></thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.task_sla_id}>
            <th scope="row" className="text-start font-normal">
              <Link className="ds-link" to={`/${orgId}/${recordPath(i.table, i.record_id)}`}><span className="ds-latin">{i.number}</span> {i.title}</Link>
            </th>
            <td>{i.name}{i.paused ? <span className="text-ink-3 text-[12px]"> (متوقف)</span> : null}</td>
            <td><Chip tone={URGENCY_TONE[i.level]} title={i.reason}>{URGENCY_LABEL[i.level]}</Chip></td>
            <td className="text-[12px]">{i.breached ? <span className="text-danger">نقض شده</span> : remainingText(i.remaining_ms)}</td>
            <td className="ds-num">{i.probability === null ? "—" : `${toFa(Math.round(i.probability * 100))}٪`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Overview() {
  const { api, orgId, allows } = useOrg();
  const [scope, setScope] = useState<"mine" | "groups">("groups");
  const meta = useQuery({ queryKey: SLM_KEYS.meta(orgId), queryFn: () => slmApi.meta(api) });
  const q = useQuery({ queryKey: SLM_KEYS.overview(orgId), queryFn: () => slmApi.overview(api) });
  const kpis = useQuery({ queryKey: ANALYTICS_KEYS.scorecard(orgId, { practice: "sla" }), queryFn: () => analyticsApi.scorecard(api, { practice: "sla", trend: 6 }), enabled: allows({ area: "reports" }) });
  const seed = useAction(() => slmApi.seed(api), { success: "پیش‌فرض‌های سطح خدمت افزوده شد", invalidate: [SLM_KEYS.all] });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="مدیریت سطح خدمت"
        actions={
          <Space wrap>
            {meta.data && !meta.data.seeded && meta.data.manages ? <Button onClick={() => seed.mutate(undefined)} loading={seed.isPending}>افزودن پیش‌فرض‌ها</Button> : null}
            {allows({ area: "service", op: "create" }) ? <Link to={`/${orgId}/slm/new-agreement`}><Button type="primary" icon={<FilePlus2 {...ICON} />}>توافق تازه از الگو</Button></Link> : null}
          </Space>
        }
      />
      {q.isLoading ? <Loader /> : !d ? null : (
        <>
          <div className="slm-stats">
            <StatCard title="توافق‌های در جریان" value={toFa(d.agreements.in_force)} hint={`${toFa(d.agreements.total)} توافق در همهٔ مراحل`} />
            <StatCard title="برآورده نشد" value={toFa(d.agreements.by_status.missed)} />
            <StatCard title="در خطر" value={toFa(d.agreements.by_status.at_risk)} />
            <StatCard title="دستیابی این ماه" value={d.attainment_month === null ? "—" : `${toFa(d.attainment_month)}٪`} hint={`${toFa(d.breaches_month)} نقض در ماه`} />
            <StatCard title="اقدام‌های بهبود باز" value={toFa(d.improvements.open)} hint={d.improvements.overdue ? `${toFa(d.improvements.overdue)} عقب‌افتاده` : undefined} />
          </div>
          {kpis.data?.items.length ? (
            <Card title="شاخص‌های سطح خدمت">
              <div className="slm-kpi-grid">{kpis.data.items.slice(0, 8).map((k) => <KpiTile key={k.id} item={k} compact />)}</div>
            </Card>
          ) : null}
          <div className="slm-cols">
            <Card title="نیازمند توجه" meta={d.attention.length ? toFa(d.attention.length) : undefined}>
              {!d.attention.length ? <EmptyState compact icon={Handshake} title="همهٔ توافق‌ها روبه‌راه‌اند" /> : (
                <ul className="flex flex-col gap-2">
                  {d.attention.map((x, i) => (
                    <li key={`${x.id}:${i}`} className="flex items-start justify-between gap-2">
                      <span><Link className="ds-link" to={`/${orgId}/slm/agreements/${x.id}/360`}>{x.name}</Link> <span className="text-[12px] text-ink-3">{kindShort(x.kind)}</span><br /><span className="text-[12px] text-ink-2">{x.reason}</span></span>
                      <Chip tone={x.tone === "danger" ? "danger" : x.tone === "warning" ? "warning" : "neutral"}>{x.tone === "danger" ? "فوری" : x.tone === "warning" ? "هشدار" : "یادآوری"}</Chip>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="بازبینی‌های پیش رو">
              {!d.reviews_due.length ? <p className="text-ink-3 text-[13px]">بازبینی بازی نیست.</p> : (
                <ul className="flex flex-col gap-1">
                  {d.reviews_due.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link className="ds-link truncate" to={`/${orgId}/slm/reviews/${r.id}/pack`}>{r.title}</Link>
                      <span className="text-[12px] text-ink-3"><JDate v={r.scheduled_at} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="وضعیت توافق‌های در جریان">
              <div className="flex flex-col gap-2">
                {(["met", "at_risk", "missed", "no_data"] as const).map((s) => (
                  <div key={s} className="flex items-center justify-between"><Chip tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Chip><span className="ds-num">{toFa(d.agreements.by_status[s] ?? 0)}</span></div>
                ))}
                <div className="text-[12px] text-ink-3 mt-1">{Object.entries(d.agreements.by_kind).map(([k, n]) => `${kindShort(k)}: ${toFa(n)}`).join(" · ")}</div>
              </div>
            </Card>
          </div>
        </>
      )}
      <Card title="زمان‌سنج‌های در خطر" tools={<Segmented size="small" value={scope} onChange={(v) => setScope(v as "mine" | "groups")} options={[{ value: "groups", label: "گروه‌های من" }, { value: "mine", label: "کارهای من" }]} />}>
        <AtRiskTable scope={scope} />
      </Card>
    </div>
  );
}

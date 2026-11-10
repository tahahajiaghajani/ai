// «داشبورد انتشار» (REL-040): the period's releases by type and state, on-time and success shares, rollbacks,
// incidents of early life support, open high-risk releases, deployments per environment and the next deliveries.
// Every number comes from the server with the person's access.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "antd";
import { toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime, Loader, StatCard } from "../../components/display";
import { Card } from "../../components/blocks";
import { recordPath } from "../../records";
import { RELEASE_KEYS, releaseApi } from "./api";
import { riskLabel, riskTone, stateLabel, typeLabel, type Row } from "./model";

const pct = (v: unknown) => (v === null || v === undefined ? "—" : `${toFa(Number(v))}٪`);

export default function Dashboard() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: RELEASE_KEYS.dashboard(orgId, days), queryFn: () => releaseApi.dashboard(api, days) });
  const d = q.data as Row | undefined;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="داشبورد انتشار" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }, { value: 365, label: "یک سال" }]} aria-label="بازه" />} />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داشبورد در دسترس نیست" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard title="انتشارهای دوره" value={toFa(d.kpis.releases)} hint={`${toFa(d.kpis.deployed)} مستقرشده`} />
            <StatCard title="عرضهٔ به‌موقع" value={pct(d.kpis.on_time_pct)} />
            <StatCard title="انتشار موفق" value={pct(d.kpis.success_pct)} hint={`${toFa(d.kpis.rolled_back)} بازگردانده`} />
            <StatCard title="رخدادهای پشتیبانی آغازین" value={toFa(d.kpis.els_incidents)} hint={`${toFa(d.kpis.high_risk_open)} انتشار پرریسک باز`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="انتشارها به تفکیک نوع">
              <ul className="flex flex-col gap-1 text-[13px]">
                {Object.entries(d.by_type as Record<string, number>).map(([k, n]) => (
                  <li key={k} className="flex justify-between"><span>{typeLabel(k)}</span><span className="ds-num">{toFa(n)}</span></li>
                ))}
              </ul>
            </Card>
            <Card title="انتشارهای باز به تفکیک مرحله">
              <ul className="flex flex-col gap-1 text-[13px]">
                {Object.entries(d.by_state as Record<string, number>).length ? (
                  Object.entries(d.by_state as Record<string, number>).map(([k, n]) => (
                    <li key={k} className="flex justify-between"><span>{stateLabel(k)}</span><span className="ds-num">{toFa(n)}</span></li>
                  ))
                ) : (
                  <li className="text-ink-3">انتشار بازی نیست.</li>
                )}
              </ul>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="استقرارها در هر محیط">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 text-start font-normal">محیط</th>
                    <th className="py-1 text-end font-normal">موفق</th>
                    <th className="py-1 text-end font-normal">ناموفق</th>
                    <th className="py-1 text-end font-normal">بازگردانده</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(d.per_environment as Record<string, Row>).map(([env, v]) => (
                    <tr key={env} className="border-t border-line">
                      <td className="py-1.5">{(d.display as Record<string, string>)[env] ?? "—"}</td>
                      <td className="ds-num py-1.5 text-end">{toFa(v.succeeded)}</td>
                      <td className="ds-num py-1.5 text-end">{toFa(v.failed)}</td>
                      <td className="ds-num py-1.5 text-end">{toFa(v.rolled_back)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="عرضه‌های پیش رو">
              {(d.upcoming as Row[]).length ? (
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {(d.upcoming as Row[]).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2">
                      <Link className="ds-link" to={`/${orgId}/${recordPath("release", r.id)}`}>{r.number}</Link>
                      <span className="flex-1 truncate">{r.short_description}</span>
                      {r.risk_band ? <Chip tone={riskTone(r.risk_band)}>{riskLabel(r.risk_band)}</Chip> : null}
                      {r.planned_end ? <span className="text-ink-3"><JDateTime v={r.planned_end} /></span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3">انتشاری در راه نیست.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

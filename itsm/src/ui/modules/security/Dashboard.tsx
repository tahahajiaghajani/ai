// «داشبورد امنیت و انطباق» (SEC-069): security operations (open by severity, MTTD / MTTC / MTTR, false positives,
// regulatory timeliness), vulnerabilities (open by rating, overdue, KEV, SLA %, time to remediate, ageing, exceptions,
// scan coverage), compliance (per framework, control pass rate and testing, failing indicators, issues, findings,
// attestation, policy reviews, CSF gap) and risk (by rating, above appetite, completeness, reviews, treatment, risk
// culture, expiring acceptances). The server computes every figure from what the caller reads; a section without
// access is left out.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Table } from "antd";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { SEC_KEYS, durationFa, securityApi } from "./api";
import type { Count, FrameworkCompliance } from "@shared/security/api";

const fa = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("fa-IR"));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("fa-IR")}٪`);

function Bars({ items, label }: { items: Count[]; label: string }) {
  const max = Math.max(1, ...items.map((x) => x.count));
  if (!items.some((x) => x.count)) return <p className="text-[13px] text-ink-3">داده‌ای نیست.</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {items.map((x) => (
        <li key={x.key} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate text-ink-2">{x.label}</span>
          <span className="h-2 overflow-hidden rounded-xs bg-sunken" aria-hidden>
            <span className="block h-full rounded-xs" style={{ width: `${(x.count / max) * 100}%`, background: "var(--ds-chart-1)" }} />
          </span>
          <span className="ds-num text-ink">{fa(x.count)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const q = useQuery({ queryKey: SEC_KEYS.dashboard(orgId), queryFn: () => securityApi.dashboard(api), staleTime: 60_000 });
  const go = (path: string) => () => nav(`/${orgId}/${path}`);
  const d = q.data;
  const empty = d && !d.ops && !d.vuln && !d.compliance && !d.risk;
  return (
    <div>
      <PageHeader title="داشبورد امنیت و انطباق" />
      {q.isLoading ? (
        <Loader />
      ) : !d || empty ? (
        <EmptyState title="داشبورد در دسترس نیست" description="به امنیت، آسیب‌پذیری، انطباق یا ریسک دسترسی ندارید." />
      ) : (
        <div className="flex flex-col gap-6">
          {d.ops ? (
            <section className="flex flex-col gap-3" aria-label="عملیات امنیت">
              <h2 className="text-[15px] text-ink">عملیات امنیت</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="رخدادهای امنیتی باز" value={fa(d.ops.open)} onClick={go("security/incidents")} />
                <StatCard title="میانگین زمان تا کشف" value={durationFa(d.ops.times.mttd)} hint={`مهار: ${durationFa(d.ops.times.mttc)}`} />
                <StatCard title="میانگین زمان تا بازیابی" value={durationFa(d.ops.times.mttr)} hint={`نرخ مثبت کاذب: ${pct(d.ops.times.false_positive_rate)}`} />
                <StatCard title="اطلاع‌رسانی الزامی در موعد" value={pct(d.ops.regulatory.timeliness)} hint={`${fa(d.ops.regulatory.running)} در جریان · ${fa(d.ops.regulatory.overdue)} با دیرکرد`} onClick={go("security/clocks")} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="باز به تفکیک شدت">
                  <Bars items={d.ops.by_severity} label="رخدادهای باز به تفکیک شدت" />
                </Card>
                <Card title="باز به تفکیک مرحله">
                  <Bars items={d.ops.by_state} label="رخدادهای باز به تفکیک مرحله" />
                </Card>
              </div>
            </section>
          ) : null}
          {d.vuln ? (
            <section className="flex flex-col gap-3" aria-label="آسیب‌پذیری">
              <h2 className="text-[15px] text-ink">آسیب‌پذیری</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="موردهای باز" value={fa(d.vuln.open)} hint={`${fa(d.vuln.overdue)} گذشته از موعد`} onClick={go("security/vuln/items")} />
                <StatCard title="رفع در موعد (۹۰ روز)" value={pct(d.vuln.sla_percent)} hint={d.vuln.mttr_days === null ? undefined : `میانگین رفع: ${fa(d.vuln.mttr_days)} روز`} />
                <StatCard title="KEV باز / گذشته از موعد" value={`${fa(d.vuln.kev_open)} / ${fa(d.vuln.kev_overdue)}`} onClick={go("security/vuln/overdue")} />
                <StatCard title="پوشش پویش (۳۰ روز)" value={d.vuln.coverage.in_scope ? pct(Math.round((d.vuln.coverage.scanned_30 / d.vuln.coverage.in_scope) * 1000) / 10) : "—"} hint={`${fa(d.vuln.coverage.scanned_30)} از ${fa(d.vuln.coverage.in_scope)} پیکربندی`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="باز به تفکیک ردهٔ ریسک">
                  <Bars items={d.vuln.by_rating} label="موردهای باز به تفکیک رده" />
                </Card>
                <Card title="سن موردهای باز">
                  <Bars items={d.vuln.ageing} label="سن موردهای باز" />
                </Card>
                <Card title="استثناها">
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                    <dt className="text-ink-2">باز یا در انتظار تأیید</dt>
                    <dd className="ds-num">{fa(d.vuln.exceptions_open)}</dd>
                    <dt className="text-ink-2">منقضی‌شده و هنوز باز</dt>
                    <dd className="ds-num">{d.vuln.exceptions_expired ? <Chip tone="danger">{fa(d.vuln.exceptions_expired)}</Chip> : "۰"}</dd>
                  </dl>
                </Card>
              </div>
            </section>
          ) : null}
          {d.compliance ? (
            <section className="flex flex-col gap-3" aria-label="انطباق">
              <h2 className="text-[15px] text-ink">انطباق</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="نرخ قبولی آزمون کنترل‌ها" value={pct(d.compliance.pass_rate)} hint={`آزموده در شش ماه: ${pct(d.compliance.tested_6m)}`} onClick={go("grc/tests")} />
                <StatCard title="پایش خودکار نقض‌شده" value={fa(d.compliance.indicators_failing)} hint={`${fa(d.compliance.controls)} کنترل فعال`} onClick={go("grc/controls")} />
                <StatCard title="مسائل و یافته‌های باز" value={`${fa(d.compliance.issues_open)} / ${fa(d.compliance.findings_open)}`} hint={`گذشته از موعد: ${fa(d.compliance.issues_overdue + d.compliance.findings_overdue)}`} onClick={go("grc/issues")} />
                <StatCard title="نرخ پذیرش خط‌مشی‌ها" value={pct(d.compliance.attestation_rate)} hint={`${fa(d.compliance.policies_review_due)} خط‌مشی تا ۳۰ روز بازنگری می‌خواهد`} onClick={go("grc/campaigns")} />
              </div>
              <Card title="انطباق چارچوب‌ها" flush tools={d.compliance.csf_gap !== null ? <span className="text-[13px] text-ink-2">شکاف CSF: <span className="ds-num">{fa(d.compliance.csf_gap)}</span></span> : null}>
                <Table<FrameworkCompliance>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={d.compliance.frameworks}
                  onRow={(r) => ({ onClick: go(`grc/soa?framework=${r.id}`), style: { cursor: "pointer" } })}
                  columns={[
                    { title: "چارچوب", dataIndex: "name", render: (v: string, r) => <span>{v}{r.placeholder ? <span className="ms-2 text-ink-3">(جای‌نگهدار)</span> : null}</span> },
                    { title: "کاربست‌پذیر", dataIndex: "applicable", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                    { title: "پیاده‌شده", dataIndex: "implemented_percent", align: "end", render: (v: number | null) => <span className="ds-num">{pct(v)}</span> },
                    { title: "منطبق", dataIndex: "percent", align: "end", render: (v: number | null) => <span className="ds-num">{pct(v)}</span> },
                    { title: "تأیید در SoA", dataIndex: "soa_approved", align: "end", render: (v: number) => <span className="ds-num">{fa(v)}</span> },
                  ]}
                />
              </Card>
            </section>
          ) : null}
          {d.risk ? (
            <section className="flex flex-col gap-3" aria-label="ریسک">
              <h2 className="text-[15px] text-ink">ریسک</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="ریسک‌های باز" value={fa(d.risk.open)} hint={`${fa(d.risk.above_appetite)} بالاتر از اشتها`} onClick={go("grc/heatmap")} />
                <StatCard title="کامل بودن ثبت ریسک" value={pct(d.risk.complete_percent)} hint="مالک، احتمال، اثر، درمان و بازنگری" onClick={go("grc/risks")} />
                <StatCard title="بازنگری‌شده در شش ماه" value={pct(d.risk.reviewed_6m)} hint={`اقدام‌های درمان در موعد: ${pct(d.risk.actions_on_time)}`} />
                <StatCard title="فرهنگ ریسک" value={pct(d.risk.culture_ratio)} hint={`پذیرش‌های رو به انقضا: ${fa(d.risk.acceptances_expiring)}`} />
              </div>
              <Card title="ریسک باقی‌مانده به تفکیک رده">
                <Bars items={d.risk.by_rating} label="ریسک‌های باز به تفکیک رده" />
              </Card>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

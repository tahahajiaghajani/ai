// «داشبورد مشکلات» (catalogue PRB-031, PRB-013, PRB-026): open problems by state, priority and age, the top problems
// by risk, root-cause and fix times, how many incidents and major incidents have a problem, the KEDB, corrective
// actions, candidates waiting for review, and the Pareto of recurring incidents by category and CI.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "antd";
import { useOrg } from "../../lib/org";
import { fa, pct } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { recordPath } from "../../records";
import { Bars } from "../incident/Dashboard";
import { durationText } from "../incident/model";
import { PROBLEM_KEYS, problemApi } from "./api";

const PERIODS = [
  { value: 30, label: "۳۰ روز" },
  { value: 90, label: "۹۰ روز" },
  { value: 365, label: "یک سال" },
];
const rate = (v: number | null) => (v === null ? "—" : pct(v / 100));

export default function ProblemDashboard() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: PROBLEM_KEYS.dashboard(orgId, days), queryFn: () => problemApi.dashboard(api, days), staleTime: 60_000 });
  const d = q.data;
  const go = (path: string) => () => nav(`/${orgId}/${path}`);
  return (
    <div>
      <PageHeader title="داشبورد مشکلات" actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={PERIODS} />} />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داشبورد در دسترس نیست" description="به مشکلات دسترسی ندارید یا بارگذاری انجام نشد." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title="مشکلات باز" value={fa(d.open.total)} hint={`${fa(d.open.with_known_error)} با خطای شناخته‌شده`} onClick={go("problems")} />
            <StatCard title="پوشش رخدادها" value={rate(d.coverage.rate)} hint={`${fa(d.coverage.linked)} از ${fa(d.coverage.incidents)} رخداد دوره`} />
            <StatCard title="رخداد عمدهٔ دارای مشکل" value={rate(d.coverage.major_rate)} hint={`${fa(d.coverage.majors_with_problem)} از ${fa(d.coverage.majors)}`} />
            <StatCard title="سهم پیش‌گیرانه" value={d.open.total ? pct(d.open.proactive / d.open.total) : "—"} />
            <StatCard title="میانهٔ زمان یافتن علت" value={durationText(d.times.rca_median) || "—"} />
            <StatCard title="میانهٔ زمان رفع" value={durationText(d.times.fix_median) || "—"} />
            <StatCard title="خطاهای شناخته‌شدهٔ فعال" value={fa(d.known_errors.active)} hint={`${fa(d.known_errors.published)} انتشار در دوره`} onClick={go("known-errors")} />
            <StatCard title="اقدام‌های اصلاحی باز" value={d.capa ? fa(d.capa.open) : "—"} hint={d.capa ? `${fa(d.capa.overdue)} گذشته از موعد · ${fa(d.capa.done)} انجام‌شده` : undefined} onClick={go("corrective-actions")} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="مشکلات پرریسک">
              {!d.top.length ? (
                <p className="text-[13px] text-ink-3">مشکل بازی نیست.</p>
              ) : (
                <ol className="flex flex-col gap-1.5 text-[13px]">
                  {d.top.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <Link to={`/${orgId}/${recordPath("problem", p.id)}`} className="ds-link min-w-0 truncate">
                        <bdi className="ds-num">{p.number}</bdi> {p.short_description}
                      </Link>
                      <span className="ds-num ms-auto shrink-0 text-ink-3">ریسک {fa(p.risk_score)} · {fa(p.incident_count)} رخداد</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="باز به تفکیک وضعیت">
              <Bars items={d.open.by_state} label="مشکلات باز به تفکیک وضعیت" />
            </Card>
            <Card title="سن مشکلات باز">
              <Bars items={d.ageing} label="سن مشکلات باز" />
            </Card>
            <Card title="اثربخشی راه‌حل‌های موقت">
              <Bars items={d.known_errors.by_effectiveness} label="خطاهای شناخته‌شده به تفکیک اثربخشی" />
            </Card>
            <Card title="رخدادهای پرتکرار به تفکیک دسته">
              <Bars items={d.pareto.categories} label="رخدادها به تفکیک دسته" />
            </Card>
            <Card title="رخدادهای پرتکرار به تفکیک پیکربندی">
              <Bars items={d.pareto.cis.map((x) => ({ ...x, label: d.display[x.key] ?? x.label }))} label="رخدادها به تفکیک پیکربندی" />
            </Card>
          </div>
          {d.candidates ? (
            <Card title="نامزدهای مشکل">
              <Link to={`/${orgId}/problem-candidates`} className="ds-link text-[13px]">
                {fa(d.candidates)} نامزد منتظر بررسی است
              </Link>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

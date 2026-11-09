// «نمای سبد پروژه‌ها» (PRJ-007/011/045): projects by health with progress, schedule variance and money, the demand
// pipeline and totals; and «بار منابع» (PRJ-037/038): allocated hours per person and week against the weekly capacity.
// Money fields of the financial group reach only people who read them (the sums cover what was readable).
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Progress, Segmented } from "antd";
import { formatJalali, toFa } from "@shared/jalali";
import { DEMAND_STATES, PROJECT_STATES } from "@shared/tables/project";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader, StatCard, Money } from "../../components/display";
import { Card } from "../../components/blocks";
import { recordPath } from "../../records";
import { PROJECT_KEYS, projectApi } from "./api";
import { healthLabel, healthTone, loadTone, type Row } from "./model";
import "./project.css";

const stateLabel = (v: unknown) => PROJECT_STATES.states.find((s) => s.value === v)?.label ?? String(v ?? "");
const HEALTH_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2, unknown: 3 };

export function Portfolio() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: PROJECT_KEYS.portfolio(orgId, null), queryFn: () => projectApi.portfolio(api) });
  const d = q.data;
  const projects = [...((d?.projects as Row[]) ?? [])].sort((a, b) => (HEALTH_ORDER[String(a.health ?? "unknown")] ?? 3) - (HEALTH_ORDER[String(b.health ?? "unknown")] ?? 3));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="سبد پروژه‌ها" />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="سبد پروژه‌ها در دسترس نیست" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard title="پروژه‌ها" value={toFa(d.totals.projects)} />
            <StatCard title="در خطر" value={toFa(d.totals.at_risk)} hint={`${toFa(d.by_health.red ?? 0)} قرمز`} />
            <StatCard title="بودجه" value={<Money v={d.totals.budget} />} />
            <StatCard title="هزینهٔ واقعی" value={<Money v={d.totals.actual_cost} />} />
          </div>
          <Card title="پروژه‌ها">
            {projects.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead>
                    <tr className="text-ink-3">
                      <th className="py-1 text-start font-normal">پروژه</th>
                      <th className="py-1 text-start font-normal">سلامت</th>
                      <th className="py-1 text-start font-normal">وضعیت</th>
                      <th className="py-1 text-start font-normal">پیشرفت</th>
                      <th className="py-1 text-end font-normal">انحراف (روز)</th>
                      <th className="py-1 text-end font-normal">پایان پیش‌بینی</th>
                      <th className="py-1 text-start font-normal">مدیر پروژه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id} className="border-t border-line">
                        <td className="py-1.5"><Link className="ds-link" to={`/${orgId}/${recordPath("project", p.id)}`}>{p.name}</Link> <span className="text-[12px] text-ink-3">{p.number}</span></td>
                        <td className="py-1.5"><Chip tone={healthTone(p.health)}>{healthLabel(p.health)}</Chip></td>
                        <td className="py-1.5">{stateLabel(p.state)}</td>
                        <td className="py-1.5" style={{ minInlineSize: 120 }}><Progress percent={Number(p.pct_complete ?? 0)} size="small" format={(v) => `${toFa(v ?? 0)}٪`} /></td>
                        <td className={`ds-num py-1.5 text-end ${Number(p.schedule_variance_days ?? 0) > 0 ? "text-warning" : ""}`}>{p.schedule_variance_days === null || p.schedule_variance_days === undefined ? "—" : toFa(p.schedule_variance_days)}</td>
                        <td className="py-1.5 text-end">{p.projected_end ? formatJalali(p.projected_end) : "—"}</td>
                        <td className="py-1.5">{(d.display as Record<string, string>)[String(p.project_manager_id)] ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-ink-3">پروژه‌ای ثبت نشده است.</p>
            )}
          </Card>
          <Card title="تقاضاهای در راه">
            <ul className="flex flex-wrap gap-4 text-[13px]">
              {DEMAND_STATES.states.filter((s) => ["submitted", "screening", "qualified", "approved"].includes(s.value)).map((s) => (
                <li key={s.value} className="flex items-center gap-2"><span>{s.label}</span><span className="ds-num text-ink">{toFa((d.demand_pipeline as Record<string, number>)[s.value] ?? 0)}</span></li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

export function Resources() {
  const { api, orgId } = useOrg();
  const [weeks, setWeeks] = useState(12);
  const q = useQuery({ queryKey: PROJECT_KEYS.resources(orgId, weeks), queryFn: () => projectApi.resources(api, weeks) });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="بار منابع" actions={<Segmented value={weeks} onChange={(v) => setWeeks(Number(v))} options={[{ value: 6, label: "۶ هفته" }, { value: 12, label: "۱۲ هفته" }, { value: 26, label: "۲۶ هفته" }]} aria-label="بازه" />} />
      {q.isLoading ? (
        <Loader />
      ) : !d || !d.people.length ? (
        <EmptyState title="در این بازه تخصیصی ثبت نشده است" />
      ) : (
        <div className="overflow-x-auto">
          <table className="pj-heat" aria-label={`ساعت تخصیص‌یافته در هر هفته؛ ظرفیت ${toFa(d.capacity)} ساعت`}>
            <thead>
              <tr>
                <th scope="col" className="text-start">فرد</th>
                {d.weeks.map((w) => <th key={w} scope="col">{formatJalali(w, { style: "short" })}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.user_id}>
                  <th scope="row" className="text-start">{d.display[p.user_id] ?? "(محدود)"}</th>
                  {p.weeks.map((w) => (
                    <td key={w.week} data-load={loadTone(w.load)} title={`${toFa(w.hours)} ساعت — ${toFa(w.load)}٪ ظرفیت`}>
                      <span className="ds-num">{w.hours ? toFa(w.hours) : ""}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-ink-3">ظرفیت هفتگی هر نفر: {toFa(d.capacity)} ساعت؛ خانهٔ قرمز یعنی بیش از ظرفیت.</p>
        </div>
      )}
    </div>
  );
}

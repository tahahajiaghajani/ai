// «داشبورد تغییرات» (CHG-075, CHG-057, CHG-028, CHG-022): KPIs of a period (success, failure and backout rates,
// change-caused incidents, emergency and standard shares, late changes, schedule compliance, PIR completion), the
// pipeline by state, changes per Jalali month by type, failure rate per risk band (a calibrated risk model fails more
// often at higher risk), the authorization backlog, the next seven days and the teams' success scores. Every number
// comes from the server (with the person's access); the screen only presents them.
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Segmented } from "antd";
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { CHANGE_STATES, CHANGE_TYPES, SCORE_BANDS } from "@shared/tables/change";
import { formatJalaliDateTime, toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card } from "../../components/blocks";
import { recordPath } from "../../records";
import { CHANGE_KEYS, changeApi } from "./api";
import { calibrated, kpiRows, riskChip, riskLabel, type Row } from "./model";
import "./change.css";

const TYPE_COLORS: Record<string, string> = { normal: "var(--ds-chart-1)", standard: "var(--ds-chart-6)", emergency: "var(--ds-chart-4)", latent: "var(--ds-chart-other)" };
const stateLabel = (v: string) => CHANGE_STATES.states.find((s) => s.value === v)?.label ?? v;

export default function Dashboard() {
  const { api, orgId, timezone } = useOrg();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: CHANGE_KEYS.dashboard(orgId, days), queryFn: () => changeApi.dashboard(api, days) });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="داشبورد تغییرات"
        actions={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }, { value: 365, label: "یک سال" }]} aria-label="بازه" />}
      />
      {q.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="داشبورد در دسترس نیست" />
      ) : (
        <>
          <Kpis k={d.kpis} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="تغییرها در هر ماه">
              {d.trend.length ? (
                <div style={{ height: 240 }} role="img" aria-label="تعداد تغییرها در هر ماه به تفکیک نوع">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.trend.map((t) => ({ label: t.label, ...t.values }))} margin={{ top: 8, right: 0, left: 4, bottom: 0 }} barCategoryGap="22%">
                      <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                      <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} />
                      <YAxis orientation="right" allowDecimals={false} tickCount={4} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => toFa(v)} />
                      <Tooltip cursor={{ fill: "var(--ds-hover)" }} formatter={(v, name) => [toFa(Number(v ?? 0)), CHANGE_TYPES.find((o) => o.value === String(name))?.label ?? String(name)]} isAnimationActive={false} />
                      <Legend formatter={(name: string) => CHANGE_TYPES.find((o) => o.value === name)?.label ?? name} />
                      {CHANGE_TYPES.map((t) => (
                        <Bar key={t.value} dataKey={t.value} stackId="a" fill={TYPE_COLORS[t.value] ?? "var(--ds-chart-other)"} maxBarSize={28} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-ink-3">در شش ماه گذشته تغییری ثبت نشده است.</p>
              )}
            </Card>
            <Card title="شکست به تفکیک ریسک">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="py-1 text-start font-normal">ریسک</th>
                    <th className="py-1 text-end font-normal">اجراشده</th>
                    <th className="py-1 text-end font-normal">ناموفق</th>
                    <th className="py-1 text-end font-normal">نرخ شکست</th>
                  </tr>
                </thead>
                <tbody>
                  {d.risk_bands.map((b) => (
                    <tr key={b.risk} className="border-t border-line">
                      <td className="py-1.5">
                        <Chip tone={riskChip(b.risk)}>{riskLabel(b.risk)}</Chip>
                      </td>
                      <td className="ds-num py-1.5 text-end">{toFa(b.implemented)}</td>
                      <td className="ds-num py-1.5 text-end">{toFa(b.failed)}</td>
                      <td className="ds-num py-1.5 text-end">{b.failure_rate === null ? "—" : `${toFa(b.failure_rate)}٪`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(() => {
                const c = calibrated(d.risk_bands);
                return c === null ? (
                  <p className="mt-2 text-[12px] text-ink-3">برای سنجش درستی ریسک، دست‌کم دو رده با پنج تغییر اجراشده لازم است.</p>
                ) : (
                  <p className={`mt-2 text-[12px] ${c ? "text-in" : "text-warning"}`}>{c ? "نرخ شکست با ریسک بالا می‌رود؛ سنجش ریسک درست کار می‌کند." : "نرخ شکست با ریسک هم‌خوان نیست؛ پرسش‌نامه و آستانه‌ها را بازبینی کنید."}</p>
                );
              })()}
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="هفت روز پیش رو">
              <ChangeRows rows={d.upcoming} display={d.display} timezone={timezone} orgId={orgId} empty="تغییری برای هفت روز آینده زمان‌بندی نشده است." />
            </Card>
            <Card title="در ارزیابی و انتظار تأیید">
              <ChangeRows rows={d.backlog} display={d.display} timezone={timezone} orgId={orgId} empty="تغییری در انتظار ارزیابی یا تأیید نیست." state />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="تغییرهای باز به تفکیک وضعیت">
              <ul className="flex flex-col gap-1 text-[13px]">
                {Object.entries(d.open_by_state).length ? (
                  Object.entries(d.open_by_state).map(([k, n]) => (
                    <li key={k} className="flex justify-between">
                      <span>{stateLabel(k)}</span>
                      <span className="ds-num">{toFa(n)}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-ink-3">تغییر بازی نیست.</li>
                )}
              </ul>
            </Card>
            <Card title="امتیاز موفقیت تیم‌ها">
              {d.scores.length ? (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {(d.scores as Row[]).map((s) => (
                    <li key={String(s.id)} className="flex items-center justify-between gap-2">
                      <span>{String(s.title)}</span>
                      <span className="flex items-center gap-2">
                        <span className="ds-num text-ink-3">{toFa(Number(s.implemented ?? 0))} اجرا</span>
                        {s.band ? <Chip tone={s.band === "poor" ? "danger" : s.band === "fair" ? "warning" : "in"}>{SCORE_BANDS.find((o) => o.value === s.band)?.label}</Chip> : null}
                        <b className="ds-num">{s.score === null ? "—" : toFa(Number(s.score))}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3">هنوز امتیازی حساب نشده است (هر شب از تغییرهای اجراشده حساب می‌شود).</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpis({ k }: { k: Record<string, number | null> }) {
  const { counts, rates } = kpiRows(k);
  return (
    <div className="chg-kpis">
      {[...counts, ...rates].map((x) => (
        <div key={x.key} className="chg-kpi" data-v={x.verdict ?? undefined}>
          <b>{x.value === null ? "—" : `${toFa(x.value)}${x.unit === "%" ? "٪" : ""}`}</b>
          <span>{x.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChangeRows({ rows, display, timezone, orgId, empty, state }: { rows: Row[]; display: Record<string, string>; timezone: string; orgId: string; empty: string; state?: boolean }) {
  void display;
  if (!rows.length) return <p className="text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((c) => (
        <li key={String(c.id)} className="flex flex-col">
          <Link className="ds-link text-[13px]" to={`/${orgId}/${recordPath("change_request", String(c.id))}`}>
            <span className="ds-ltr">{String(c.number)}</span> {String(c.short_description)}
          </Link>
          <span className="text-[12px] text-ink-3">
            {state ? `${stateLabel(String(c.state))} · ` : ""}
            {riskLabel(c.risk)} · {c.planned_start ? formatJalaliDateTime(String(c.planned_start), timezone) : "بدون زمان"}
          </span>
        </li>
      ))}
    </ul>
  );
}

// «کارت امتیاز شاخص‌ها» and the KPI hub (catalogue ANA-005/012/036): every active indicator with the viewer's own
// numbers for the current Jalali period — status against the target and thresholds, the change against the previous
// period, the trend as a sparkline — by practice; a tile opens the hub: the score and its trend (live, and the stored
// snapshots for those the indicator lets read them), the target line, breakdowns, the records behind the number,
// the definition and a narrative built from the numbers. Report administrators collect a snapshot on demand.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, Space, Tooltip } from "antd";
import { Camera, LayoutGrid, Rows3, Pencil } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Legend } from "recharts";
import { PRACTICE_OPTIONS } from "@shared/tables/analytics";
import { GRAIN_OPTIONS } from "@shared/tables/analytics";
import { UNITS } from "@shared/analytics/kpi";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader, Chip } from "../../components/display";
import { Card, ICON14 } from "../../components/blocks";
import { recordPath, tablePath, useSchema } from "../../records";
import { analyticsApi, ANALYTICS_KEYS } from "./api";
import { CHIP_TONE, KpiTile, RestrictedNote, statusText } from "./parts";
import { DeltaBadge } from "./Chart";
import { ScorecardTable } from "./DashboardPage";
import { axisValue, exactValue, recordsHref, STATUS_TONE } from "./model";
import "./analytics.css";

export function Scorecard() {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const [practice, setPractice] = useState<string>("");
  const [view, setView] = useState<"tiles" | "table">("tiles");
  const q = useQuery({ queryKey: ANALYTICS_KEYS.scorecard(orgId, practice), queryFn: () => analyticsApi.scorecard(api, { practice: practice || undefined, trend: 12 }) });
  const items = q.data?.items ?? [];
  const open = (id: string) => navigate(`/${orgId}/analytics/indicators/${id}`);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="کارت امتیاز شاخص‌ها"
        actions={
          <Segmented value={view} onChange={(v) => setView(v as typeof view)} options={[{ value: "tiles", icon: <LayoutGrid {...ICON14} />, label: "کارت" }, { value: "table", icon: <Rows3 {...ICON14} />, label: "جدول" }]} aria-label="نمایش" />
        }
      />
      <Segmented value={practice} onChange={(v) => setPractice(String(v))} options={[{ value: "", label: "همه" }, ...PRACTICE_OPTIONS.filter((p) => p.value !== "other").map((p) => ({ value: p.value, label: p.label }))]} aria-label="فرایند" />
      {q.isLoading ? (
        <Loader />
      ) : q.error ? (
        <EmptyState title="کارت امتیاز در دسترس نیست" description={errorText(q.error)} />
      ) : !items.length ? (
        <EmptyState title="شاخصی تعریف نشده است" description="کتابخانهٔ شاخص‌ها را مدیر گزارش‌ها از «تنظیمات گزارش‌ها» می‌افزاید." />
      ) : view === "tiles" ? (
        <div className="an-kpis">
          {items.map((i) => (
            <KpiTile key={i.id} item={i} onOpen={() => open(i.id)} />
          ))}
        </div>
      ) : (
        <Card flush>
          <ScorecardTable items={items} onOpen={open} />
        </Card>
      )}
    </div>
  );
}

export function IndicatorHub() {
  const { id = "" } = useParams();
  const { api, orgId, timezone } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const { schema } = useSchema();
  const q = useQuery({ queryKey: ANALYTICS_KEYS.hub(orgId, id), queryFn: () => analyticsApi.hub(api, id) });
  const [collecting, setCollecting] = useState(false);
  if (q.isLoading) return <Loader />;
  if (q.error || !q.data) return <EmptyState title="شاخص در دسترس نیست" description={errorText(q.error)} />;
  const { item: i, definition: d } = q.data;
  const live = new Map(i.trend.map((p) => [p.key, p.value]));
  const stored = new Map((q.data.history ?? []).map((p) => [p.key, p.value]));
  const keys = [...new Set([...(q.data.history ?? []).map((p) => p.key), ...i.trend.map((p) => p.key)])].sort();
  const labelOf = new Map([...(q.data.history ?? []), ...i.trend].map((p) => [p.key, p.label]));
  const series = keys.map((k) => ({ label: labelOf.get(k) ?? k, live: live.get(k) ?? null, stored: stored.get(k) ?? null }));
  const collect = async () => {
    setCollecting(true);
    try {
      const r = await analyticsApi.collect(api, id);
      n.ok(`${faDigits(r.scores)} امتیاز ذخیره شد`);
      await qc.invalidateQueries({ queryKey: ANALYTICS_KEYS.hub(orgId, id) });
    } catch (e) {
      n.error(e);
    } finally {
      setCollecting(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={d.name}
        back="analytics/scorecard"
        actions={
          <Space size={8}>
            <Link to={`/${orgId}/${recordPath("analytics_indicator", id)}`}>
              <Button icon={<Pencil {...ICON14} />}>تعریف</Button>
            </Link>
            {q.data.can_collect ? (
              <Tooltip title="ذخیرهٔ امتیاز این دوره و دورهٔ پیش برای کل سازمان">
                <Button icon={<Camera {...ICON14} />} loading={collecting} onClick={collect}>
                  عکس اکنون
                </Button>
              </Tooltip>
            ) : null}
          </Space>
        }
      />
      {i.restricted ? (
        <RestrictedNote reason={i.restricted} />
      ) : (
        <>
          <div className="an-hub-top">
            <div className="an-hub-score">
              <div className="an-muted">{i.current.label}</div>
              <div className="an-hub-val ds-t-figure">{exactValue(i.current.value, i.unit, i.decimals)}</div>
              <Space size={8} wrap>
                <Chip tone={CHIP_TONE[STATUS_TONE[i.status]]}>{statusText(i)}</Chip>
                <DeltaBadge delta={i.delta} direction={i.direction} />
                <span className="an-muted">دورهٔ پیش: {exactValue(i.previous.value, i.unit, i.decimals)}</span>
              </Space>
              <dl className="an-hub-facts">
                {i.target !== null ? (<><dt>هدف</dt><dd>{exactValue(i.target, i.unit, i.decimals)}</dd></>) : null}
                {i.warn !== null ? (<><dt>آستانهٔ هشدار</dt><dd>{exactValue(i.warn, i.unit, i.decimals)}</dd></>) : null}
                {i.crit !== null ? (<><dt>آستانهٔ بحران</dt><dd>{exactValue(i.crit, i.unit, i.decimals)}</dd></>) : null}
                <dt>دوره</dt>
                <dd>{GRAIN_OPTIONS.find((g) => g.value === d.grain)?.label ?? d.grain}</dd>
                <dt>واحد</dt>
                <dd>{UNITS[d.unit]}</dd>
              </dl>
            </div>
            {q.data.narrative ? (
              <div className="an-narrative">
                <p>{q.data.narrative.text}</p>
                <span className="an-muted">{q.data.narrative.ai ? "ساخته‌شده با هوش مصنوعی — پیش از استفاده بازبینی کنید" : "از روی عددهای محاسبه‌شده"}</span>
              </div>
            ) : null}
          </div>
          <Card title="روند" meta={<span className="an-muted">{q.data.history === null ? "مقدارهای زنده با دسترسی شما" : "زنده با دسترسی شما و عکس‌های ذخیره‌شدهٔ کل سازمان"}</span>}>
            {series.length ? (
              <div style={{ height: 260 }} role="img" aria-label={`روند ${d.name}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
                    <XAxis dataKey="label" reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} />
                    <YAxis orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => axisValue(v, i.unit)} width={56} />
                    <RTooltip formatter={(v, name) => [exactValue(v as number, i.unit, i.decimals), name === "live" ? "زنده (دسترسی شما)" : "عکس ذخیره‌شده"]} isAnimationActive={false} />
                    <Legend formatter={(v: string) => (v === "live" ? "زنده (دسترسی شما)" : "عکس ذخیره‌شده (کل سازمان)")} wrapperStyle={{ fontSize: 12 }} />
                    {i.target !== null ? <ReferenceLine y={i.target} stroke="var(--ds-chart-compare)" strokeDasharray="4 3" label={{ value: "هدف", position: "insideTopLeft", fill: "var(--ds-text-3)", fontSize: 11 }} /> : null}
                    {i.trend.length ? <Line dataKey="live" stroke="var(--ds-chart-1)" strokeWidth={2} dot connectNulls isAnimationActive={false} /> : null}
                    {q.data.history?.length ? <Line dataKey="stored" stroke="var(--ds-chart-3)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} /> : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState compact title="هنوز روندی ثبت نشده است" description="روند شاخص‌های لحظه‌ای از عکس‌های روزانه ساخته می‌شود." />
            )}
          </Card>
          {q.data.breakdowns.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {q.data.breakdowns.map((b) => (
                <Card key={b.field} title={`به تفکیک ${b.label}`} flush>
                  <table className="an-table">
                    <thead>
                      <tr>
                        <th scope="col">{b.label}</th>
                        <th scope="col" className="an-num">مقدار</th>
                        <th scope="col" className="an-num">رکوردها</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.elements.map((e) => (
                        <tr key={e.key}>
                          <td>{e.label}</td>
                          <td className="an-num">{exactValue(e.value, i.unit, i.decimals)}</td>
                          <td className="an-num">{faDigits(e.n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          ) : null}
        </>
      )}
      <Card title="تعریف">
        <p className="an-desc">{d.description || "شرحی نوشته نشده است."}</p>
        <div className="an-formula" dir="ltr">{d.formula}</div>
        <ul className="an-parts">
          {q.data.records.map((r) => {
            const part = d.parts.find((p) => p.name === r.name);
            const t = schema?.def(r.table);
            return (
              <li key={r.name}>
                <code dir="ltr">{r.name}</code>
                <span>{part?.fn} {part?.field ? `«${t?.fields.find((f) => f.name === part.field)?.label ?? part.field}»` : ""} در «{t?.plural ?? r.table}»</span>
                {t ? (
                  <Link className="ds-link" to={recordsHref(`/${orgId}/${tablePath(r.table)}`, r.filter)}>
                    رکوردهای این دوره
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="an-muted">
          نسخهٔ فرمول {faDigits(d.formula_version)}{d.certified ? " · تأییدشده" : ""} · مقدارهای زنده همیشه با دسترسی خود شما حساب می‌شوند{timezone ? "" : ""}
        </div>
      </Card>
    </div>
  );
}

export default Scorecard;

// The service page's extensions (catalogue SPF-009/015/016/039): header actions (the service's map and impact through
// its CI, «بازبینی انجام شد», «مشترک شوم»), the live status panel (status, why, since when, the owner's message), and
// the tabs «کارنامه» (the owner's scorecard: open and major incidents, breaches, problems, changes, subscribers,
// availability against the target, satisfaction, the score's trend and parts, offerings and their commitments, the
// review date) and «مدل خدمت» (the layered map from the service's CI: offerings, supporting services, applications,
// infrastructure).
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Space, Table, Tooltip } from "antd";
import { Bell, CalendarCheck, GitFork, Zap } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { statusLabel } from "@shared/service_portfolio/logic";
import { OFFERING_LEVELS } from "@shared/tables/service_portfolio";
import { formatJalali } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa, pct } from "../../lib/fa";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, JDate, JDateTime, Loader, StatCard } from "../../components/display";
import type { RecordContext } from "../../records/extensions";
import { spfApi, SPF_KEYS } from "./api";
import { statusColor, statusTone } from "./model";
import "./spf.css";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export function ServiceHeaderActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const id = String(ctx.row.id);
  const ci = ctx.row.ci_id ? String(ctx.row.ci_id) : null;
  const reviewed = useMutation({
    mutationFn: () => spfApi.reviewed(api, id),
    onSuccess: () => {
      message.success("بازبینی خدمت ثبت شد");
      ctx.refresh();
      void qc.invalidateQueries({ queryKey: SPF_KEYS.all(orgId) });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const subscribe = useMutation({ mutationFn: () => spfApi.subscribe(api, id), onSuccess: (r) => message.success(r.created ? "مشترک این خدمت شدید" : "پیش‌تر مشترک بودید"), onError: (e: Error) => message.error(e.message) });
  const live = ["live", "transition"].includes(String(ctx.row.state));
  return (
    <Space size={6} wrap>
      {ci ? (
        <Link to={`/${orgId}/cmdb/map?root=${ci}&dir=dependencies&depth=3`}>
          <Button size="small" icon={<GitFork {...ICON} />}>نقشه</Button>
        </Link>
      ) : null}
      {ci ? (
        <Link to={`/${orgId}/cmdb/impact?ci=${ci}`}>
          <Button size="small" icon={<Zap {...ICON} />}>اثر</Button>
        </Link>
      ) : null}
      {ctx.meta.canWrite && live ? <Button size="small" icon={<CalendarCheck {...ICON} />} loading={reviewed.isPending} onClick={() => reviewed.mutate()}>بازبینی انجام شد</Button> : null}
      {live ? <Button size="small" icon={<Bell {...ICON} />} loading={subscribe.isPending} onClick={() => subscribe.mutate()}>مشترک شوم</Button> : null}
    </Space>
  );
}

/** «وضعیت جاری» side panel. */
export function ServiceStatusPanel({ ctx }: { ctx: RecordContext }) {
  const row = ctx.row as Record<string, unknown>;
  const status = String(row.status ?? "operational");
  const manual = row.status_override && row.status_override !== "auto";
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex items-center gap-2">
        <i className="spf-dot" style={{ background: statusColor(status) }} aria-hidden />
        {status === "operational" ? <span className="text-ink">{statusLabel(status)}</span> : <Chip tone={statusTone(status)}>{statusLabel(status)}</Chip>}
        {manual ? <span className="text-[12px] text-ink-3">(تعیین دستی)</span> : null}
      </div>
      {row.status_reason ? <p className="text-ink-2">{String(row.status_reason)}</p> : null}
      {row.status_since ? (
        <span className="text-ink-3">
          از <JDateTime v={String(row.status_since)} />
        </span>
      ) : null}
      {row.status_note ? <p className="text-ink-2">{String(row.status_note)}</p> : null}
      {row.on_status_page ? <span className="text-[12px] text-ink-3">روی صفحهٔ وضعیت منتشر شده است.</span> : null}
    </div>
  );
}

/** «کارنامه» tab: the owner's scorecard. */
export function ScorecardTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: SPF_KEYS.scorecard(orgId, id), queryFn: () => spfApi.scorecard(api, id), staleTime: 60_000 });
  if (q.isLoading) return <Loader />;
  const d = q.data;
  if (!d) return <EmptyState compact title="کارنامه در دسترس نیست" />;
  const k = d.kpis;
  const target = d.service.availability_target;
  return (
    <div className="flex flex-col gap-3">
      {d.review.overdue ? <Note tone="warning">{`موعد بازبینی این خدمت (${formatJalali(d.review.due)}) گذشته است.`}</Note> : null}
      <div className="spf-tiles">
        <StatCard title="امتیاز عملکرد" value={d.service.score === null ? "—" : fa(d.service.score)} />
        <StatCard title="دسترس‌پذیری ۳۰ روز" value={k.availability_30d === null ? "—" : pct(k.availability_30d / 100, 2)} hint={target ? `هدف ${pct(target / 100, 2)}` : undefined} />
        <StatCard title="رخداد باز" value={fa(k.open_incidents)} hint={k.major_incidents ? `${fa(k.major_incidents)} عمده` : undefined} />
        <StatCard title="رخداد ۳۰ روز" value={fa(k.incidents_30d)} hint={k.breaches_30d ? `${fa(k.breaches_30d)} نقض توافق` : undefined} />
        <StatCard title="مشکل باز" value={fa(k.open_problems)} />
        {k.upcoming_changes !== null ? <StatCard title="تغییر باز" value={fa(k.upcoming_changes)} /> : null}
        <StatCard title="مشترک" value={fa(k.subscribers)} />
        <StatCard title="رضایت" value={k.csat === null ? "—" : fa(k.csat, 1)} />
        <StatCard title="وابستگی‌ها" value={fa(k.dependencies)} hint={`${fa(k.dependents)} وابسته`} />
      </div>
      {d.trend.length > 1 ? (
        <Card title="روند امتیاز">
          <div style={{ height: 180 }} dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend.map((t) => ({ ...t, label: formatJalali(t.day).slice(5) }))} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v) => faDigits(String(v))} />
                <YAxis domain={[0, 100]} width={30} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v) => fa(Number(v))} />
                <ChartTooltip formatter={(v) => [fa(Number(v)), "امتیاز"]} labelFormatter={(l) => faDigits(String(l))} />
                <Line type="monotone" dataKey="score" stroke="var(--ds-chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {d.components ? (
            <p className="mt-2 text-[12.5px] text-ink-3">
              اجزا (آخرین روز): دسترس‌پذیری {fa(d.components.availability ?? 0)}، رخدادها {fa(d.components.incidents ?? 0)}، توافق‌ها {fa(d.components.breaches ?? 0)}، رضایت {fa(d.components.csat ?? 0)}
            </p>
          ) : null}
        </Card>
      ) : null}
      <Card title="گزینه‌ها و تعهدها" flush>
        {d.offerings.length ? (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={d.offerings}
            columns={[
              { title: "گزینه", dataIndex: "name", key: "n", render: (v: string, o: { id: string }) => <Link className="ds-link" to={`/${orgId}/service-offerings/${o.id}`}>{v}</Link> },
              { title: "سطح", dataIndex: "level", key: "l", width: 110, render: (v: string | null) => OFFERING_LEVELS.find((x) => x.value === v)?.label ?? "—" },
              { title: "وضعیت", dataIndex: "state", key: "s", width: 120, render: (v: string) => ({ draft: "پیش‌نویس", active: "فعال", deprecated: "رو به کنارگذاری", retired: "کنارگذاشته" } as Record<string, string>)[v] ?? v },
              { title: "تعهد", dataIndex: "commitments", key: "c", width: 80, render: (v: number) => (v ? <span className="ds-num">{fa(v)}</span> : <Tooltip title="این گزینه تعهد فعالی ندارد"><Chip tone="warning">ندارد</Chip></Tooltip>) },
            ]}
          />
        ) : (
          <EmptyState compact title="گزینه‌ای ثبت نشده" description="برای زنده شدن، خدمت دست‌کم یک گزینهٔ فعال لازم دارد." />
        )}
      </Card>
      <p className="text-[12.5px] text-ink-3">
        آخرین بازبینی: <JDate v={d.review.last} /> · بازبینی بعدی: <JDate v={d.review.due} />
        {d.hidden.length ? ` · بدون دسترسی شما: ${d.hidden.join("، ")}` : ""}
      </p>
    </div>
  );
}

// «کارنامه» (WFM-034/032/035/041): the person's own scorecard and their coaching notes (written for them alone), their
// teams' numbers (teams below the minimum size show nothing), individuals of a team only for those who oversee it and
// hold the «hr» field group, and the leaderboard of the people who opted in beside the team totals.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, Space, Switch, Tabs } from "antd";
import { Sparkles } from "lucide-react";
import { toFa } from "@shared/jalali";
import type { AgentMetrics } from "@shared/workforce/logic";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { RecordMarkdown } from "../../records";
import { WFM_KEYS, wfmApi, type TeamPerformance } from "./api";
import { METRIC_ROWS, metricText } from "./model";
import "./workforce.css";

function Scorecard({ m }: { m: AgentMetrics }) {
  return (
    <dl className="wfm-score">
      {METRIC_ROWS.map((r) => (
        <div key={r.key}>
          <dt>{r.label}</dt>
          <dd className="ds-num">{metricText(m, r)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Team({ t }: { t: TeamPerformance }) {
  if (t.suppressed || !t.metrics) return <Card title={t.name}><p className="text-[13px] text-ink-3">این تیم کوچک‌تر از آن است که آمارش بی‌آنکه افراد شناخته شوند نشان داده شود.</p></Card>;
  return (
    <Card title={t.name} meta={`${toFa(t.members)} نفر`}>
      <Scorecard m={t.metrics} />
      {t.people ? (
        <div className="overflow-x-auto mt-3">
          <table className="wfm-people">
            <thead><tr><th scope="col" className="text-start">فرد</th>{METRIC_ROWS.slice(0, 7).map((r) => <th key={r.key} scope="col">{r.label}</th>)}</tr></thead>
            <tbody>
              {t.people.map((p) => (
                <tr key={p.user_id}>
                  <th scope="row" className="text-start font-normal">{p.name}</th>
                  {METRIC_ROWS.slice(0, 7).map((r) => <td key={r.key} className="ds-num">{metricText(p.metrics, r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : t.people_restricted ? <p className="text-[12px] text-ink-3 mt-2">عددهای فردی فقط برای سرپرستان دارای دسترسی «منابع انسانی» است.</p> : null}
    </Card>
  );
}

function Leaderboard() {
  const { api, orgId } = useOrg();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: WFM_KEYS.leaderboard(orgId, null), queryFn: () => wfmApi.leaderboard(api) });
  const home = useQuery({ queryKey: WFM_KEYS.home(orgId), queryFn: () => wfmApi.home(api) });
  const opt = useAction((v: boolean) => wfmApi.prefs(api, { leaderboard: v }), { onSuccess: () => { qc.invalidateQueries({ queryKey: WFM_KEYS.leaderboard(orgId, null) }); qc.invalidateQueries({ queryKey: WFM_KEYS.home(orgId) }); } });
  if (q.isLoading) return <Loader />;
  const d = q.data;
  if (!d?.enabled) return <EmptyState title="جدول امتیازها در این سازمان خاموش است" />;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-[13px]">
        <Switch checked={!!home.data?.presence.leaderboard} onChange={(v) => opt.mutate(v)} loading={opt.isPending} />
        نام من در جدول امتیازها بیاید
      </label>
      <div className="wfm-cols">
        <Card title="تیم‌ها" meta={d.period}>
          {d.teams.map((t, i) => <div key={t.group_id} className="flex justify-between text-[13px]"><span>{toFa(i + 1)}. {t.name}</span><span className="ds-num">{toFa(t.points)}</span></div>)}
        </Card>
        <Card title="افراد (با رضایت خودشان)" meta={d.period}>
          {!d.people.length ? <p className="text-[13px] text-ink-3">هنوز کسی حضور در جدول را نپذیرفته است.</p> : d.people.map((p, i) => (
            <div key={p.user_id} className="flex justify-between text-[13px]"><span>{toFa(i + 1)}. {p.name}{p.me ? " (من)" : ""}</span><span className="ds-num">{toFa(p.points)}</span></div>
          ))}
        </Card>
      </div>
    </div>
  );
}

export default function Performance() {
  const { api, orgId } = useOrg();
  const [period, setPeriod] = useState<"month" | "last_month" | "quarter">("month");
  const q = useQuery({ queryKey: WFM_KEYS.performance(orgId, { period }), queryFn: () => wfmApi.performance(api, { period }) });
  const [coach, setCoach] = useState<{ text: string; ai: boolean } | null>(null);
  const coaching = useAction(() => wfmApi.coaching(api), { onSuccess: setCoach });
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="کارنامه" actions={<Segmented value={period} onChange={(v) => setPeriod(v as typeof period)} options={[{ value: "month", label: "این ماه" }, { value: "last_month", label: "ماه پیش" }, { value: "quarter", label: "این فصل" }]} />} />
      <Tabs
        items={[
          {
            key: "me", label: "کارنامهٔ من",
            children: q.isLoading ? <Loader /> : !d?.me ? <EmptyState title="داده‌ای نیست" /> : (
              <div className="flex flex-col gap-4">
                <Card title="عددهای من" meta={d.period.label} tools={<Button icon={<Sparkles {...ICON} />} loading={coaching.isPending} onClick={() => coaching.mutate(undefined)}>یادداشت مربی‌گری</Button>}>
                  <Scorecard m={d.me} />
                </Card>
                {coach ? (
                  <Card title="یادداشت مربی‌گری برای شما" meta={coach.ai ? "نوشتهٔ هوش مصنوعی از عددهای شما" : "قاعده‌محور"}>
                    <RecordMarkdown text={coach.text} />
                  </Card>
                ) : null}
                <Note>این عددها و یادداشت مربی‌گری فقط برای شماست؛ سرپرستان آمار تیم را می‌بینند.</Note>
              </div>
            ),
          },
          {
            key: "teams", label: "تیم‌های من",
            children: q.isLoading ? <Loader /> : !d?.teams.length ? <EmptyState title="عضو تیمی نیستید" /> : <div className="flex flex-col gap-4">{d.teams.map((t) => <Team key={t.group_id} t={t} />)}</div>,
          },
          { key: "board", label: "جدول امتیازها", children: <Leaderboard /> },
        ]}
      />
      <Space />
      {d?.can.individuals ? <Chip tone="neutral">دسترسی «منابع انسانی» دارید؛ عددهای فردی تیم‌هایی که سرپرستی می‌کنید نشان داده می‌شود.</Chip> : null}
    </div>
  );
}

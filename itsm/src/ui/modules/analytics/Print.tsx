// The print view of a report or a dashboard (catalogue ANA-016 «PDF»): the same results the person sees, laid out
// for paper with a Jalali header — the browser's «چاپ» saves it as PDF. The shell hides itself in print.
import { useEffect } from "react";
import { useParams } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Printer } from "lucide-react";
import { formatJalaliDateTime, todayISO } from "@shared/jalali";
import type { ReportSpec } from "@shared/analytics/types";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { EmptyState, Loader } from "../../components/display";
import { ICON14, PrintHead } from "../../components/blocks";
import { recordsApi, useSchema } from "../../records";
import { analyticsApi, ANALYTICS_KEYS } from "./api";
import { ResultView } from "./Chart";
import { KpiTile, RestrictedNote } from "./parts";
import { ScorecardTable } from "./DashboardPage";
import "./analytics.css";

export default function Print() {
  const { kind = "report", id = "" } = useParams();
  return kind === "dashboard" ? <PrintDashboard id={id} /> : <PrintReport id={id} />;
}

function Toolbar() {
  return (
    <div className="an-print-bar">
      <Button type="primary" icon={<Printer {...ICON14} />} onClick={() => window.print()}>
        چاپ یا ذخیره به PDF
      </Button>
    </div>
  );
}

function PrintReport({ id }: { id: string }) {
  const { api, orgId, timezone } = useOrg();
  const { schema } = useSchema();
  const rec = useQuery({ queryKey: ["records", orgId, "analytics_report", id], queryFn: () => recordsApi.get(api, "analytics_report", id) });
  const run = useQuery({ queryKey: ANALYTICS_KEYS.report(orgId, id), queryFn: () => analyticsApi.runReport(api, id) });
  useEffect(() => {
    if (rec.data) document.title = String(rec.data.row.name ?? "گزارش");
  }, [rec.data]);
  if (rec.isLoading || run.isLoading) return <Loader />;
  if (rec.error || run.error || !rec.data || !run.data) return <EmptyState title="گزارش در دسترس نیست" description={errorText(rec.error ?? run.error)} />;
  const spec = rec.data.row.spec as ReportSpec;
  return (
    <div className="an-print">
      <Toolbar />
      <PrintHead title={String(rec.data.row.name)} no={String(rec.data.row.number ?? "")} date={todayISO(timezone)} lines={[`${run.data.table_label} · ${run.data.total_n.toLocaleString("fa-IR")} رکورد · ${formatJalaliDateTime(run.data.generated_at, timezone)}`, "فقط رکوردهایی که شما اجازهٔ دیدن آن‌ها را دارید"]} />
      {rec.data.row.description ? <p className="an-desc">{String(rec.data.row.description)}</p> : null}
      <div className="an-print-chart">
        <ResultView spec={spec} result={run.data} height={380} schema={schema} />
      </div>
      {run.data.kind === "agg" && !["table", "pivot"].includes(spec.viz) ? <ResultView spec={spec} result={run.data} asTable schema={schema} /> : null}
    </div>
  );
}

function PrintDashboard({ id }: { id: string }) {
  const { api, orgId, timezone } = useOrg();
  const { schema } = useSchema();
  const view = useQuery({ queryKey: ANALYTICS_KEYS.dashboard(orgId, id), queryFn: () => analyticsApi.dashboard(api, id) });
  const widgets = (view.data?.layout.widgets ?? []).slice().sort((a, b) => (a.tab ?? "").localeCompare(b.tab ?? "") || a.y - b.y || a.x - b.x);
  const runs = useQueries({ queries: widgets.map((w) => ({ queryKey: ANALYTICS_KEYS.widget(orgId, id, w.id, {}), queryFn: () => analyticsApi.widget(api, id, w.id, {}) })) });
  useEffect(() => {
    if (view.data) document.title = view.data.name;
  }, [view.data]);
  if (view.isLoading) return <Loader />;
  if (view.error || !view.data) return <EmptyState title="داشبورد در دسترس نیست" description={errorText(view.error)} />;
  return (
    <div className="an-print">
      <Toolbar />
      <PrintHead title={view.data.name} no={view.data.number} date={todayISO(timezone)} lines={["فقط رکوردهایی که شما اجازهٔ دیدن آن‌ها را دارید"]} />
      {widgets.map((w, i) => {
        const r = runs[i]?.data;
        const title = w.title || (w.report_id ? view.data.reports[w.report_id] : null) || (r?.kind === "report" ? r.result.table_label : "");
        return (
          <section key={w.id} className="an-print-widget">
            {title ? <h2>{title}</h2> : null}
            {!r ? (
              <Loader />
            ) : r.kind === "report" ? (
              <ResultView spec={r.spec} result={r.result} height={300} schema={schema} />
            ) : r.kind === "indicator" ? (
              <KpiTile item={r.item} />
            ) : r.kind === "scorecard" ? (
              <ScorecardTable items={r.items} />
            ) : r.kind === "restricted" ? (
              <RestrictedNote reason={r.reason} />
            ) : (
              <p>{r.text}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Spin } from "antd";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Money } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { D } from "@shared/money";
import { faDigits, formatPct } from "@shared/format";

export default function IncomeStatement() {
  const { api, fy } = useOrg();
  const [range, setRange] = useRange();
  const q = useQuery({ queryKey: ["income", range, fy?.id], queryFn: () => api.get("/accounting/reports/income-statement", { from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }) });
  const d = q.data;
  const net = D(d?.net ?? 0);
  const margin = D(d?.total_income ?? 0).isZero() ? null : net.div(D(d.total_income)).times(100);
  const Block = ({ title, rows, total }: { title: string; rows: any[]; total: string }) => (
    <div className="mb-5">
      <div className="mb-2 border-b border-line pb-1 text-sm font-bold">{title}</div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
          <span><span className="num text-xs text-muted">{faDigits(r.code)}</span> {r.name}</span>
          <Money v={r.amount} />
        </div>
      ))}
      {!rows.length ? <div className="py-2 text-xs text-muted">گردشی ندارد</div> : null}
      <div className="mt-1 flex justify-between border-t border-dashed border-line pt-2 font-bold">
        <span>جمع {title}</span>
        <Money v={total} />
      </div>
    </div>
  );
  return (
    <div>
      <PageHeader title="صورت سود و زیان" />
      <div className="tz-card print-sheet mx-auto max-w-3xl p-4 md:p-6">
        <ReportTitle title="صورت سود و زیان" range={range} />
        <ReportFilters range={range} setRange={setRange} />
        {q.isLoading || !d ? (
          <div className="grid h-40 place-content-center"><Spin /></div>
        ) : (
          <>
            <Block title="درآمدها" rows={d.income} total={d.total_income} />
            <Block title="بهای تمام‌شده و هزینه‌ها" rows={d.expense} total={d.total_expense} />
            <div className={`flex items-center justify-between rounded-xl p-4 text-lg font-extrabold ${net.gte(0) ? "bg-[color-mix(in_srgb,var(--tz-success)_10%,transparent)] text-ok" : "bg-[color-mix(in_srgb,var(--tz-danger)_10%,transparent)] text-bad"}`}>
              <span>{net.gte(0) ? "سود خالص" : "زیان خالص"}</span>
              <span className="flex items-center gap-3">
                {margin ? <span className="text-xs font-normal">حاشیه‌ی سود {formatPct(margin.toFixed(1), 1)}</span> : null}
                <Money v={net.abs().toString()} />
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Income statement (صورت سود و زیان): income and expenses of the period with one figure column, negatives in
// accounting parentheses, and the net result with its margin. Each account opens its ledger.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Skeleton } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Amt, Card, Period, PrintFoot, ScalePicker, ScaleProvider, unitCaption, useScale } from "./kit";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { pct } from "../../lib/fa";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";

export function StatementBlock({ title, rows, total, totalLabel, soft }: { title: string; rows: any[]; total?: string; totalLabel?: string; soft?: boolean }) {
  const { orgId } = useOrg();
  return (
    <div className="bk-st-sec">
      <div className="bk-st-t">
        {title}
        {rows.length ? <small>{faDigits(rows.length)} حساب</small> : null}
      </div>
      {rows.map((r) => (
        <Link key={r.id} className="bk-st-row" to={`/${orgId}/reports/ledger?account=${r.id}`}>
          <span className="bk-acc">
            <i>{faDigits(r.code)}</i>
            <span>{r.name}</span>
          </span>
          <Amt v={r.amount} parens />
        </Link>
      ))}
      {!rows.length ? <div className="bk-st-none">گردشی ندارد</div> : null}
      {total !== undefined ? (
        <div className={`bk-st-row bk-st-sum${soft ? " is-soft" : ""}`}>
          <span>{totalLabel ?? `جمع ${title}`}</span>
          <Amt v={total} parens />
        </div>
      ) : null}
    </div>
  );
}

export default function IncomeStatement() {
  const { api, fy, unit } = useOrg();
  const [range, setRange] = useRange();
  const [scale, setScale] = useScale();
  const q = useQuery({ queryKey: ["income", range, fy?.id], queryFn: () => api.get("/accounting/reports/income-statement", { from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }) });
  const d = q.data;
  const net = D(d?.net ?? 0);
  const margin = D(d?.total_income ?? 0).isZero() ? null : net.div(D(d.total_income));
  return (
    <div>
      <PageHeader title="صورت سود و زیان" actions={<AiExplainButton report="income_statement" params={{ from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }} title="صورت سود و زیان" />} />
      <ReportFilters range={range} setRange={setRange} />
      <ScaleProvider scale={scale}>
        <Card
          title="سود و زیان"
          meta={
            <>
              <Period from={range.from} to={range.to} />
              <span className="bk-cap">{unitCaption(scale, unit)}</span>
            </>
          }
          tools={<ScalePicker scale={scale} onChange={setScale} />}
          bodyClass="bk-stmt is-narrow !px-7 !py-6"
        >
          <ReportTitle title="صورت سود و زیان" range={range} />
          {q.isLoading || !d ? (
            <Skeleton rows={10} />
          ) : (
            <>
              <StatementBlock title="درآمدها" rows={d.income} total={d.total_income} />
              <StatementBlock title="بهای تمام‌شده و هزینه‌ها" rows={d.expense} total={d.total_expense} />
              <div className="bk-st-net">
                <div>
                  {net.gte(0) ? "سود خالص" : "زیان خالص"}
                  {margin ? <small>حاشیهٔ سود {pct(margin.toNumber())}</small> : null}
                </div>
                <Amt v={net.toString()} parens zero="۰" />
              </div>
            </>
          )}
          <PrintFoot sign={["تهیه‌کننده", "تأییدکننده"]} />
        </Card>
      </ScaleProvider>
    </div>
  );
}

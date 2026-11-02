// Balance sheet (ترازنامه، صورت وضعیت مالی) at a date: assets beside liabilities and equity, one figure column per side,
// negatives in accounting parentheses. Each account opens its ledger.
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, Skeleton } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Amt, Card, PrintFoot, ScalePicker, ScaleProvider, unitCaption, useScale } from "./kit";
import { StatementBlock } from "./IncomeStatement";
import { D } from "@shared/money";
import { formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";

export default function BalanceSheet() {
  const { api, fy, unit } = useOrg();
  const [range, setRange] = useRange();
  const [scale, setScale] = useScale();
  const q = useQuery({ queryKey: ["bs", range.to, range.drafts, fy?.id], queryFn: () => api.get("/accounting/reports/balance-sheet", { to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }) });
  const d = q.data;
  const right = d ? D(d.total_liabilities).plus(D(d.total_equity)) : D(0);
  const gap = d ? D(d.total_assets).minus(right) : D(0);
  return (
    <div>
      <PageHeader title="ترازنامه" />
      <ReportFilters range={range} setRange={setRange} noFrom />
      <ScaleProvider scale={scale}>
        <Card
          title="صورت وضعیت مالی"
          meta={
            <>
              {range.to ? <span className="bk-period sf-num">در {formatJalali(range.to)}</span> : null}
              <span className="bk-cap">{unitCaption(scale, unit)}</span>
              {d && !d.balanced ? (
                <Chip tone="danger" fig>
                  ناتراز، اختلاف {formatNumber(gap.abs())}
                </Chip>
              ) : null}
            </>
          }
          tools={<ScalePicker scale={scale} onChange={setScale} />}
          bodyClass="bk-stmt !px-7 !py-6"
        >
          <ReportTitle title="ترازنامه" range={range} noFrom />
          {q.isLoading || !d ? (
            <Skeleton rows={10} />
          ) : (
            <div className="bk-st-cols">
              <div>
                <StatementBlock title="دارایی‌ها" rows={d.assets} />
                <div className="bk-st-net">
                  <div>جمع دارایی‌ها</div>
                  <Amt v={d.total_assets} parens zero="۰" />
                </div>
              </div>
              <div>
                <StatementBlock title="بدهی‌ها" rows={d.liabilities} total={d.total_liabilities} totalLabel="جمع بدهی‌ها" soft />
                <div className="bk-st-sec">
                  <StatementBlock title="حقوق مالکانه" rows={d.equity} />
                  <div className="bk-st-row">
                    <span>{D(d.current_result).gte(0) ? "سود دورهٔ جاری" : "زیان دورهٔ جاری"}</span>
                    <Amt v={d.current_result} parens />
                  </div>
                  <div className="bk-st-row bk-st-sum is-soft">
                    <span>جمع حقوق مالکانه</span>
                    <Amt v={d.total_equity} parens />
                  </div>
                </div>
                <div className="bk-st-net">
                  <div>جمع بدهی‌ها و حقوق مالکانه</div>
                  <Amt v={right.toString()} parens zero="۰" />
                </div>
              </div>
            </div>
          )}
          <PrintFoot sign={["تهیه‌کننده", "تأییدکننده"]} />
        </Card>
      </ScaleProvider>
    </div>
  );
}

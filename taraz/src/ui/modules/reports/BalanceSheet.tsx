import { useQuery } from "@tanstack/react-query";
import { Spin, Tag } from "antd";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Money } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { faDigits } from "@shared/format";
import { D } from "@shared/money";

export default function BalanceSheet() {
  const { api, fy } = useOrg();
  const [range, setRange] = useRange();
  const q = useQuery({ queryKey: ["bs", range.to, range.drafts, fy?.id], queryFn: () => api.get("/accounting/reports/balance-sheet", { to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }) });
  const d = q.data;
  const List = ({ rows }: { rows: any[] }) => (
    <>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
          <span><span className="num text-xs text-muted">{faDigits(r.code)}</span> {r.name}</span>
          <Money v={r.amount} />
        </div>
      ))}
      {!rows.length ? <div className="py-2 text-xs text-muted">—</div> : null}
    </>
  );
  return (
    <div>
      <PageHeader title="ترازنامه" subtitle="صورت وضعیت مالی در تاریخ انتخاب‌شده" extra={d ? (d.balanced ? <Tag color="success" variant="filled">تراز</Tag> : <Tag color="error" variant="filled">ناتراز</Tag>) : null} />
      <div className="tz-card print-sheet p-4 md:p-6">
        <ReportTitle title="ترازنامه" range={range} />
        <ReportFilters range={range} setRange={setRange} noFrom />
        {q.isLoading || !d ? (
          <div className="grid h-40 place-content-center"><Spin /></div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 rounded-lg bg-brand-soft px-3 py-2 font-bold text-brand">دارایی‌ها</div>
              <List rows={d.assets} />
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-extrabold"><span>جمع دارایی‌ها</span><Money v={d.total_assets} /></div>
            </div>
            <div>
              <div className="mb-2 rounded-lg bg-gold-soft px-3 py-2 font-bold text-gold">بدهی‌ها</div>
              <List rows={d.liabilities} />
              <div className="mt-2 flex justify-between border-t border-dashed border-line pt-2 font-bold"><span>جمع بدهی‌ها</span><Money v={d.total_liabilities} /></div>
              <div className="mb-2 mt-5 rounded-lg bg-surface-2 px-3 py-2 font-bold">حقوق مالکانه</div>
              <List rows={d.equity} />
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span>{D(d.current_result).gte(0) ? "سود دوره‌ی جاری" : "زیان دوره‌ی جاری"}</span>
                <Money v={d.current_result} />
              </div>
              <div className="mt-2 flex justify-between border-t border-dashed border-line pt-2 font-bold"><span>جمع حقوق مالکانه</span><Money v={d.total_equity} /></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-extrabold"><span>جمع بدهی‌ها و حقوق مالکانه</span><Money v={D(d.total_liabilities).plus(D(d.total_equity)).toString()} /></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

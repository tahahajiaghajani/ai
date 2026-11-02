// «جریان نقدی ۱۳ هفته»: opening cash and bank balance, what comes in and goes out each week (cheques due both ways,
// open invoices at their expected pay dates, average recurring costs), the closing balance with its range, and the
// weeks where it may fall short — with the items of each week.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Table } from "antd";
import { Wallet } from "lucide-react";
import { useOrg } from "../../lib/org";
import { EmptyState, Skeleton } from "../../components/display";
import { Card } from "../../modules/reports/kit";
import { num, pickScale, scaled } from "../../modules/dashboard/kit";
import { fa } from "../../lib/fa";
import type { AiCashWeek } from "../kit/types";
import { CashChart, type CashRow } from "./charts";
import { cashOf, cashSummary } from "./data";
import { Disclaimer, ExplainForecast, LoadError, useForecast, weekLabel } from "./shared";

export function CashTab() {
  const { unit, orgId } = useOrg();
  const q = useForecast("cashflow", {}, cashOf);
  const f = q.data;
  const [open, setOpen] = useState<string | null>(null);
  const s = useMemo(() => pickScale(f ? [f.opening, ...f.weeks.flatMap((w) => [w.inflow, w.outflow, w.closing])] : [], f?.unit ?? unit), [f, unit]);
  const rows: CashRow[] = useMemo(
    () =>
      (f?.weeks ?? []).map((w, i) => ({
        week: weekLabel(w.start) || fa(i + 1),
        title: `هفتهٔ ${fa(i + 1)}، از ${weekLabel(w.start)} تا ${weekLabel(w.end)}`,
        inflow: num(w.inflow),
        outflow: num(w.outflow),
        closing: num(w.closing),
        band: w.p10 !== null && w.p10 !== undefined && w.p90 !== null && w.p90 !== undefined ? [num(w.p10), num(w.p90)] : null,
        shortfall: !!w.shortfall,
      })),
    [f],
  );

  if (q.isLoading)
    return (
      <div className="bk-card">
        <div className="bk-card-b">
          <Skeleton rows={8} />
        </div>
      </div>
    );
  if (q.error) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  if (!f || f.refused_reason_fa || !f.weeks.length)
    return (
      <div className="bk-card">
        <EmptyState icon={Wallet} title={f?.refused_reason_fa ?? "برای پیش‌بینی جریان نقدی دادهٔ کافی نیست."} />
      </div>
    );

  const sum = cashSummary(f);
  return (
    <div className="bk-stack">
      <div className="ai-kpis" aria-label={`مبالغ به ${s.unit}`}>
        <div className="ai-kpi">
          <small>موجودی نقد و بانک امروز، {s.unit}</small>
          <b>{scaled(f.opening, s)}</b>
        </div>
        <div className="ai-kpi">
          <small>ورودی ۱۳ هفته، {s.unit}</small>
          <b>{scaled(sum.inflow, s)}</b>
        </div>
        <div className="ai-kpi">
          <small>خروجی ۱۳ هفته، {s.unit}</small>
          <b>{scaled(sum.outflow, s)}</b>
        </div>
        <div className="ai-kpi" data-tone={sum.low.value < 0 ? "danger" : undefined}>
          <small>کمترین مانده، {s.unit}</small>
          <b>{scaled(sum.low.value, s)}</b>
          {sum.low.week >= 0 ? <span>هفتهٔ {fa(sum.low.week + 1)}، {weekLabel(f.weeks[sum.low.week].start)}</span> : <span>امروز</span>}
        </div>
      </div>
      {sum.short.length ? (
        <div className="ai-fc-alert" role="status">
          <i className="sf-nuqta" aria-hidden />
          <span>
            <b>
              {fa(sum.short.length)} هفته ممکن است با کمبود نقدینگی روبه‌رو شود؛ اولی هفتهٔ {fa(sum.first + 1)} ({weekLabel(f.weeks[sum.first].start)}).
            </b>{" "}
            پیگیری مطالبات سررسیده یا جابه‌جایی پرداخت‌ها را بررسی کنید.
          </span>
        </div>
      ) : null}
      <Card title="ماندهٔ نقد و بانک در ۱۳ هفتهٔ آینده" meta={<span className="bk-cap">مبالغ به {s.unit}</span>}>
        <CashChart rows={rows} s={s} aria={`پیش‌بینی ماندهٔ نقد و بانک: ${rows.map((r) => `${r.week} ${scaled(r.closing, s)}`).join("، ")}`} />
        <div className="ai-fc-legend" aria-hidden>
          <span><i className="is-in" />ورودی</span>
          <span><i className="is-out" />خروجی</span>
          <span><i className="is-line" />ماندهٔ پایان هفته</span>
          <span><i className="is-short" />هفتهٔ کمبود</span>
        </div>
        <Disclaimer>
          {f.method ? `${f.method}. ` : ""}
          چک‌ها در سررسید و فاکتورهای باز در زمان معمول پرداخت هر شخص حساب شده‌اند؛ بازه، نوسان هزینه‌ها و دیرکرد وصول را نشان می‌دهد.
        </Disclaimer>
        <ExplainForecast series="cashflow" params={{}} title="جریان نقدی ۱۳ هفتهٔ آینده" />
      </Card>
      <Card title="هفته به هفته" flush>
        <Table<AiCashWeek & { i: number }>
          className="bk-tbl"
          size="small"
          rowKey={(r) => r.start || String(r.i)}
          dataSource={f.weeks.map((w, i) => ({ ...w, i }))}
          pagination={false}
          scroll={{ x: 640 }}
          rowClassName={(r) => (r.shortfall ? "ai-fc-short" : "")}
          expandable={{
            expandedRowKeys: open ? [open] : [],
            onExpand: (o, r) => setOpen(o ? r.start || String(r.i) : null),
            rowExpandable: (r) => !!r.items?.length,
            expandedRowRender: (r) => (
              <ul className="ai-fc-items">
                {(r.items ?? []).map((it, k) => (
                  <li key={k}>
                    <span>{it.ref?.path ? <Link className="sf-link" to={`/${orgId}/${it.ref.path.replace(/^\/+/, "")}`}>{it.label}</Link> : it.label}</span>
                    <b className={num(it.amount) < 0 ? "" : "text-in"}>{scaled(it.amount, s)}</b>
                  </li>
                ))}
              </ul>
            ),
          }}
          columns={[
            { key: "w", title: "هفته", width: 170, render: (_, r) => <span className="whitespace-nowrap">{fa(r.i + 1)}. {weekLabel(r.start)} تا {weekLabel(r.end)}</span> },
            { key: "in", title: "ورودی", align: "end", width: 136, render: (_, r) => <span className="sf-num">{scaled(r.inflow, s)}</span> },
            { key: "out", title: "خروجی", align: "end", width: 136, render: (_, r) => <span className="sf-num">{scaled(r.outflow, s)}</span> },
            {
              key: "close",
              title: "ماندهٔ پایان هفته",
              align: "end",
              width: 150,
              render: (_, r) => <span className={`sf-num ${num(r.closing) < 0 ? "text-danger" : ""}`}>{scaled(r.closing, s)}</span>,
            },
            {
              key: "range",
              title: "بازهٔ ۸۰٪",
              align: "end",
              width: 190,
              render: (_, r) => (r.p10 !== null && r.p90 !== null && r.p10 !== undefined && r.p90 !== undefined ? <span className="sf-num text-ink-3">{scaled(r.p10, s)} تا {scaled(r.p90, s)}</span> : <span className="sf-zero">—</span>),
            },
          ]}
        />
      </Card>
    </div>
  );
}

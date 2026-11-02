import { useState } from "react";
import { Table, Alert, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Money, JDate, Balance, Amount, Weight } from "../../components/display";
import { AccountSelect, DetailSelect, CurrencySelect } from "../../components/inputs";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { faDigits } from "@shared/format";
import { D } from "@shared/money";
import { exportExcel } from "../../lib/excel";
import { formatJalali } from "@shared/jalali";

export default function Ledger() {
  const { api, fy, orgId } = useOrg();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [range, setRange] = useRange();
  const [accountId, setAccountId] = useState<string | null>(sp.get("account"));
  const [detailId, setDetailId] = useState<string | null>(sp.get("detail"));
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const enabled = !!accountId || !!detailId;
  const q = useQuery({
    queryKey: ["ledger", accountId, detailId, currencyId, range, fy?.id],
    queryFn: () => api.get("/accounting/reports/ledger", { account_id: accountId, detail_id: detailId, currency_id: currencyId, from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }),
    enabled,
  });
  const rows = (q.data?.rows ?? []) as any[];
  const hasFx = rows.some((r) => !D(r.fx_debit).isZero() || !D(r.fx_credit).isZero());
  const hasW = rows.some((r) => !D(r.w_debit).isZero() || !D(r.w_credit).isZero());
  return (
    <div>
      <PageHeader title="دفتر حساب" subtitle="گردش و مانده‌ی هر حساب کل، معین یا تفصیلی" />
      <div className="tz-card print-sheet p-3 md:p-4">
        <ReportTitle title="دفتر حساب" range={range} />
        <div className="no-print mb-3 grid gap-2 md:grid-cols-3">
          <AccountSelect value={accountId} onChange={setAccountId} allowClear placeholder="حساب (هر سطحی)" />
          <DetailSelect value={detailId} onChange={setDetailId} allowClear placeholder="تفصیلی (شخص، بانک، صندوق…)" />
          <CurrencySelect value={currencyId} onChange={setCurrencyId} allowClear placeholder="فقط یک ارز (اختیاری)" />
        </div>
        <ReportFilters range={range} setRange={setRange}>
          {q.data ? (
            <a
              className="text-xs"
              onClick={() =>
                exportExcel("دفتر حساب", [
                  { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
                  { title: "سند", value: (r: any) => r.no, type: "number" },
                  { title: "حساب", value: (r: any) => r.account_name },
                  { title: "تفصیلی", value: (r: any) => r.detail_name },
                  { title: "شرح", value: (r: any) => r.description },
                  { title: "بدهکار", value: (r: any) => r.debit, type: "number" },
                  { title: "بستانکار", value: (r: any) => r.credit, type: "number" },
                  { title: "مانده", value: (r: any) => r.balance, type: "number" },
                ], rows)
              }
            >
              خروجی اکسل
            </a>
          ) : null}
        </ReportFilters>
        {!enabled ? (
          <Alert type="info" showIcon title="حساب یا تفصیلی را انتخاب کنید" />
        ) : (
          <>
            {q.data ? (
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <Tag variant="filled">مانده‌ی ابتدای دوره: <Balance v={q.data.opening} /></Tag>
                {(q.data.fx_balances ?? [])
                  .filter((f: any) => !D(f.opening).isZero())
                  .map((f: any) => (
                    <Tag key={f.currency_id} variant="filled">ارزی: <Amount v={f.opening} suffix={f.currency_code} /></Tag>
                  ))}
                {!D(q.data.opening_w).isZero() ? <Tag variant="filled">وزن: <Weight v={q.data.opening_w} /></Tag> : null}
              </div>
            ) : null}
            <Table
              className="tz-table"
              size="small"
              rowKey={(r: any) => `${r.voucher_id}-${r.line_no}`}
              loading={q.isLoading}
              dataSource={rows}
              pagination={{ pageSize: 200, hideOnSinglePage: true, size: "small" }}
              scroll={{ x: "max-content" }}
              onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/accounting/vouchers/${r.voucher_id}`), style: { cursor: "pointer" } })}
              columns={[
                { key: "date", dataIndex: "date", title: "تاریخ", width: 100, render: (v) => <JDate v={v} /> },
                { key: "no", dataIndex: "no", title: "سند", width: 70, render: (v) => <span className="num">{faDigits(v)}</span> },
                { key: "acc", title: "حساب", render: (_, r: any) => <span><span className="num text-muted">{faDigits(r.account_code)}</span> {r.account_name}</span> },
                { key: "det", dataIndex: "detail_name", title: "تفصیلی", render: (v) => v ?? <span className="text-muted">—</span> },
                { key: "desc", dataIndex: "description", title: "شرح", ellipsis: true },
                ...(hasFx ? [{ key: "fx", title: "ارزی", align: "left" as const, render: (_: unknown, r: any) => (D(r.fx_debit).isZero() && D(r.fx_credit).isZero() ? null : <Amount v={D(r.fx_debit).minus(D(r.fx_credit)).toString()} suffix={r.currency_code} />) }, { key: "rate", dataIndex: "fx_rate", title: "نرخ", align: "left" as const, render: (v: string) => (v ? <Amount v={v} /> : null) }] : []),
                ...(hasW ? [{ key: "w", title: "وزن", align: "left" as const, render: (_: unknown, r: any) => (D(r.w_debit).isZero() && D(r.w_credit).isZero() ? null : <Weight v={D(r.w_debit).minus(D(r.w_credit)).toString()} />) }] : []),
                { key: "dr", dataIndex: "debit", title: "بدهکار", align: "left", render: (v) => <Money v={v} zero="" /> },
                { key: "cr", dataIndex: "credit", title: "بستانکار", align: "left", render: (v) => <Money v={v} zero="" /> },
                { key: "bal", dataIndex: "balance", title: "مانده", align: "left", render: (v) => <Balance v={v} /> },
              ]}
              summary={() =>
                q.data ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={5 + (hasFx ? 2 : 0) + (hasW ? 1 : 0)}>جمع دوره</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="left"><Money v={q.data.totals.debit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="left"><Money v={q.data.totals.credit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="left"><Balance v={q.data.totals.balance} /></Table.Summary.Cell>
                  </Table.Summary.Row>
                ) : null
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

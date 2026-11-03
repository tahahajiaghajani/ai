// Ledger (دفتر حساب): the movements of an account at any level or of a subsidiary (تفصیلی), with the opening balance,
// a running «مانده» with its «تشخیص» (بد / بس) and the period totals. Rows open their voucher.
import { useMemo, useState } from "react";
import { Table } from "antd";
import { BookOpenText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { JDate, Amount, Weight, Balance, EmptyState } from "../../components/display";
import { AccountSelect, DetailSelect, CurrencySelect } from "../../components/inputs";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Acc, Amt, Card, DocNo, Period, PrintFoot, cx } from "./kit";
import { D } from "@shared/money";
import { exportExcel } from "../../lib/excel";
import { formatJalali } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";
import { usePrinting } from "../../lib/print";

const side = (v: string | number | null | undefined) => {
  const d = D(v ?? 0);
  return d.isZero() ? "—" : d.gt(0) ? "بد" : "بس";
};

export default function Ledger() {
  const printing = usePrinting(); // antd's sticky header would print as its own, misaligned table
  const { api, fy, orgId, unit } = useOrg();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [range, setRange] = useRange();
  const [accountId, setAccountId] = useState<string | null>(sp.get("account") || null);
  const [detailId, setDetailId] = useState<string | null>(sp.get("detail") || null);
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const enabled = !!accountId || !!detailId;
  const q = useQuery({
    queryKey: ["ledger", accountId, detailId, currencyId, range, fy?.id],
    queryFn: () => api.get("/accounting/reports/ledger", { account_id: accountId, detail_id: detailId, currency_id: currencyId, from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }),
    enabled,
  });
  const d = q.data;
  const rows = (d?.rows ?? []) as any[];
  const hasFx = rows.some((r) => !D(r.fx_debit).isZero() || !D(r.fx_credit).isZero());
  const hasW = rows.some((r) => !D(r.w_debit).isZero() || !D(r.w_credit).isZero());
  const data = useMemo(() => (d ? [{ __open: true, key: "opening", balance: d.opening }, ...rows.map((r) => ({ ...r, key: `${r.voucher_id}-${r.line_no}` }))] : []), [d, rows]);
  // the «حساب» column says nothing when every row is on one account (the account picked as the filter);
  // «تفصیلی» says nothing when no row has one, or when every row is on the filtered detail
  const showAcc = !rows.length || rows.some((r) => r.account_code !== rows[0].account_code);
  const showDet = rows.some((r) => r.detail_name) && (!detailId || rows.some((r) => r.detail_name !== rows[0].detail_name));
  // the card's title: what was picked, else what the rows say (the detail when filtering by one, else the single account)
  const name = title ?? (detailId ? rows[0]?.detail_name : !showAcc && rows[0] ? `${faDigits(rows[0].account_code)} ${rows[0].account_name}` : null) ?? null;
  const lead = 1 + (showAcc ? 1 : 0) + (showDet ? 1 : 0); // the cells the opening row spans
  const tableX = 104 + 64 + (showAcc ? 220 : 0) + (showDet ? 180 : 0) + 240 + (hasFx ? 136 + 112 : 0) + (hasW ? 128 : 0) + 136 * 3 + 84;

  return (
    <div>
      <PageHeader title="دفتر حساب" actions={<AiExplainButton report="ledger" params={{ account_id: accountId, detail_id: detailId, currency_id: currencyId, from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }} title={title ? `دفتر حساب ${title}` : "دفتر حساب"} disabled={!accountId && !detailId} />} />
      <div className="bk-filters no-print">
        <AccountSelect
          value={accountId}
          onChange={(v, o) => {
            setAccountId(v);
            if (v) setTitle(o?.label ?? null);
          }}
          allowClear
          placeholder="حساب (هر سطحی)"
          className="!w-72"
        />
        <DetailSelect
          value={detailId}
          onChange={(v, o) => {
            setDetailId(v);
            if (v) setTitle(o?.label ?? null);
          }}
          allowClear
          placeholder="تفصیلی: شخص، بانک، صندوق…"
          className="!w-60"
        />
        <CurrencySelect value={currencyId} onChange={setCurrencyId} allowClear placeholder="ارز" className="!w-36" />
      </div>
      <ReportFilters
        range={range}
        setRange={setRange}
        onExport={
          d
            ? () =>
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
            : undefined
        }
      />

      {!enabled ? (
        <Card>
          <EmptyState icon={BookOpenText} title="حسابی انتخاب نشده" description="حساب یا تفصیلی را از پالایه‌های بالا انتخاب کنید تا گردش و ماندهٔ آن بیاید." />
        </Card>
      ) : (
        <Card
          title={name ?? "گردش حساب"}
          meta={
            <>
              <Period from={range.from} to={range.to} />
              <span className="bk-cap">مبالغ به {unit}</span>
            </>
          }
          flush
        >
          <ReportTitle title={`دفتر حساب${name ? ` — ${name}` : ""}`} range={range} />
          {d ? (
            <div className="bk-strip">
              <div>
                <small>ماندهٔ ابتدای دوره</small>
                <b><Balance v={d.opening} /></b>
              </div>
              <div>
                <small>گردش بدهکار</small>
                <b><Amt v={d.totals.debit} /></b>
              </div>
              <div>
                <small>گردش بستانکار</small>
                <b><Amt v={d.totals.credit} /></b>
              </div>
              <div>
                <small>ماندهٔ پایان دوره</small>
                <b><Balance v={d.totals.balance} /></b>
              </div>
              {(d.fx_balances ?? [])
                .filter((f: any) => !D(f.opening).isZero())
                .map((f: any) => (
                  <div key={f.currency_id}>
                    <small>ماندهٔ ارزی ابتدای دوره</small>
                    <b><Amount v={f.opening} suffix={f.currency_code} /></b>
                  </div>
                ))}
              {!D(d.opening_w).isZero() ? (
                <div>
                  <small>ماندهٔ وزنی ابتدای دوره</small>
                  <b><Weight v={d.opening_w} /></b>
                </div>
              ) : null}
            </div>
          ) : null}
          <Table
            className="bk-tbl"
            size="small"
            rowKey="key"
            loading={q.isFetching && !d}
            dataSource={data}
            pagination={{ pageSize: 200, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
            scroll={{ x: tableX }}
            tableLayout="fixed"
            sticky={printing ? undefined : { offsetHeader: 56 }}
            locale={{ emptyText: " " }}
            rowClassName={(r: any) => cx(r.__open ? "bk-open" : "bk-click")}
            onRow={(r: any) =>
              r.__open
                ? {}
                : {
                    onClick: () => nav(`/${orgId}/accounting/vouchers/${r.voucher_id}`),
                    onKeyDown: (e) => {
                      if (e.key === "Enter") nav(`/${orgId}/accounting/vouchers/${r.voucher_id}`);
                    },
                    tabIndex: 0,
                  }
            }
            columns={[
              { key: "date", dataIndex: "date", title: "تاریخ", width: 104, render: (v, r: any) => (r.__open ? null : <JDate v={v} />) },
              { key: "no", dataIndex: "no", title: "سند", width: 64, render: (v, r: any) => (r.__open ? null : <DocNo n={v} />) },
              ...(showAcc
                ? [
                    {
                      key: "acc",
                      title: "حساب",
                      width: 220,
                      ellipsis: true,
                      render: (_: unknown, r: any) => (r.__open ? <span>ماندهٔ ابتدای دوره</span> : <Acc code={r.account_code} name={r.account_name} />),
                      onCell: (r: any) => (r.__open ? { colSpan: lead } : {}),
                    },
                  ]
                : []),
              ...(showDet
                ? [
                    {
                      key: "det",
                      dataIndex: "detail_name",
                      title: "تفصیلی",
                      width: 180,
                      ellipsis: true,
                      render: (v: string | null, r: any) => (r.__open && !showAcc ? <span>ماندهٔ ابتدای دوره</span> : v ?? <span className="sf-zero">—</span>),
                      onCell: (r: any) => (r.__open ? (showAcc ? { colSpan: 0 } : { colSpan: lead }) : {}),
                    },
                  ]
                : []),
              {
                key: "desc",
                dataIndex: "description",
                title: "شرح",
                ellipsis: true,
                render: (v: string, r: any) => (r.__open && lead === 1 ? <span>ماندهٔ ابتدای دوره</span> : <span className="bk-2">{v}</span>),
                onCell: (r: any) => (r.__open && lead > 1 ? { colSpan: 0 } : {}),
              },
              ...(hasFx
                ? [
                    {
                      key: "fx",
                      title: "ارزی",
                      className: "sf-num",
                      width: 136,
                      render: (_: unknown, r: any) => (r.__open || (D(r.fx_debit).isZero() && D(r.fx_credit).isZero()) ? null : <Amount v={D(r.fx_debit).minus(D(r.fx_credit)).toString()} suffix={r.currency_code} />),
                    },
                    { key: "rate", dataIndex: "fx_rate", title: "نرخ", className: "sf-num", width: 112, render: (v: string, r: any) => (r.__open || !v ? null : <Amount v={v} />) },
                  ]
                : []),
              ...(hasW
                ? [{ key: "w", title: "وزن (گرم)", className: "sf-num", width: 128, render: (_: unknown, r: any) => (r.__open || (D(r.w_debit).isZero() && D(r.w_credit).isZero()) ? null : <Weight v={D(r.w_debit).minus(D(r.w_credit)).toString()} unit={false} />) }]
                : []),
              { key: "dr", dataIndex: "debit", title: "بدهکار", className: "sf-num", width: 136, render: (v, r: any) => (r.__open ? null : <Amt v={v} zero="" />) },
              { key: "cr", dataIndex: "credit", title: "بستانکار", className: "sf-num", width: 136, render: (v, r: any) => (r.__open ? null : <Amt v={v} zero="" />) },
              { key: "bal", dataIndex: "balance", title: "مانده", className: "sf-num", width: 136, render: (v) => <Amt v={D(v ?? 0).abs().toString()} /> },
              { key: "side", dataIndex: "balance", title: "تشخیص", width: 84, render: (v) => <span className="bk-plain">{side(v)}</span> },
            ]}
            summary={() =>
              d ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2 + lead + (hasFx ? 2 : 0) + (hasW ? 1 : 0)} className="bk-sum-l">
                      جمع دوره<small>{faDigits(rows.length)} ردیف</small>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} className="sf-num"><Amt v={d.totals.debit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} className="sf-num"><Amt v={d.totals.credit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} className="sf-num"><Amt v={D(d.totals.balance).abs().toString()} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={4}><span className="bk-plain">{side(d.totals.balance)}</span></Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
          <PrintFoot />
        </Card>
      )}
    </div>
  );
}

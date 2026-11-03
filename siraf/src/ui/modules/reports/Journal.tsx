// Journal (دفتر روزنامه): every voucher line in date order; each voucher starts a group, credits step in.
import { useMemo } from "react";
import { Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { JDate, EmptyState } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Acc, Amt, Card, DocNo, Period, PrintFoot, cx } from "./kit";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { exportExcel } from "../../lib/excel";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";
import { usePrinting } from "../../lib/print";

export default function Journal() {
  const printing = usePrinting(); // antd's sticky header would print as its own, misaligned table
  const { api, fy, unit, orgId } = useOrg();
  const nav = useNavigate();
  const [range, setRange] = useRange("month");
  const q = useQuery({
    queryKey: ["journal", range, fy?.id],
    queryFn: () => api.get("/accounting/reports/journal", { from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }).then((r) => r.rows as any[]),
  });
  const rows = q.data ?? [];
  const first = (i: number) => i === 0 || rows[i - 1]?.voucher_id !== rows[i].voucher_id;
  const totals = useMemo(() => rows.reduce((a, r) => ({ dr: a.dr.plus(D(r.debit)), cr: a.cr.plus(D(r.credit)) }), { dr: D(0), cr: D(0) }), [rows]);
  const vouchers = useMemo(() => new Set(rows.map((r) => r.voucher_id)).size, [rows]);
  const index = useMemo(() => new Map(rows.map((r, i) => [`${r.voucher_id}-${r.line_no}`, i])), [rows]);

  return (
    <div>
      <PageHeader title="دفتر روزنامه" actions={<AiExplainButton report="journal" params={{ from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }} title="دفتر روزنامه" />} />
      <ReportFilters
        range={range}
        setRange={setRange}
        onExport={() =>
          exportExcel("دفتر روزنامه", [
            { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
            { title: "سند", value: (r: any) => r.no, type: "number" },
            { title: "کد حساب", value: (r: any) => r.account_code },
            { title: "حساب", value: (r: any) => r.account_name },
            { title: "تفصیلی", value: (r: any) => r.detail_name },
            { title: "شرح", value: (r: any) => r.description ?? r.voucher_description },
            { title: "بدهکار", value: (r: any) => r.debit, type: "number" },
            { title: "بستانکار", value: (r: any) => r.credit, type: "number" },
          ], rows)
        }
      />
      <Card
        title="دفتر روزنامه"
        meta={
          <>
            <Period from={range.from} to={range.to} />
            <span className="bk-cap">مبالغ به {unit}</span>
          </>
        }
        flush
      >
        <ReportTitle title="دفتر روزنامه" range={range} />
        <Table
          className="bk-tbl bk-journal"
          size="small"
          rowKey={(r: any) => `${r.voucher_id}-${r.line_no}`}
          loading={q.isFetching && !q.data}
          dataSource={rows}
          pagination={{ pageSize: 300, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
          scroll={{ x: 980 }}
          tableLayout="fixed"
          sticky={printing ? undefined : { offsetHeader: 56 }}
          locale={{ emptyText: q.isLoading ? " " : <EmptyState title="در این دوره سندی نیست" description="بازهٔ تاریخ را تغییر دهید." /> }}
          rowClassName={(r: any) => cx("bk-click", first(index.get(`${r.voucher_id}-${r.line_no}`) ?? 0) && "bk-vstart")}
          onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/accounting/vouchers/${r.voucher_id}`) })}
          columns={[
            { key: "date", dataIndex: "date", title: "تاریخ", width: 104, render: (v, r: any) => (first(index.get(`${r.voucher_id}-${r.line_no}`) ?? 0) ? <JDate v={v} /> : null) },
            { key: "no", dataIndex: "no", title: "سند", width: 64, render: (v, r: any) => (first(index.get(`${r.voucher_id}-${r.line_no}`) ?? 0) ? <DocNo n={v} /> : null) },
            {
              key: "acc",
              title: "حساب",
              width: 300,
              ellipsis: true,
              render: (_, r: any) => (
                <span style={{ display: "block", paddingInlineStart: D(r.credit).gt(0) ? 28 : 0 }}>
                  <Acc code={r.account_code} name={r.account_name} sub={r.detail_name ?? undefined} />
                </span>
              ),
            },
            { key: "desc", title: "شرح", ellipsis: true, render: (_, r: any) => <span className="bk-2">{r.description ?? r.voucher_description}</span> },
            { key: "dr", dataIndex: "debit", title: "بدهکار", className: "sf-num", width: 152, render: (v) => <Amt v={v} zero="" /> },
            { key: "cr", dataIndex: "credit", title: "بستانکار", className: "sf-num", width: 152, render: (v) => <Amt v={v} zero="" /> },
          ]}
          summary={() =>
            rows.length ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4} className="bk-sum-l">
                    جمع دوره<small>{faDigits(vouchers)} سند، {faDigits(rows.length)} ردیف</small>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} className="sf-num"><Amt v={totals.dr.toString()} /></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} className="sf-num"><Amt v={totals.cr.toString()} /></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
        <PrintFoot />
      </Card>
    </div>
  );
}

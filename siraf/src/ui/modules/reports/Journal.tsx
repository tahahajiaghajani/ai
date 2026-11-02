import { Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Money, JDate } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { faDigits } from "@shared/format";

export default function Journal() {
  const { api, fy } = useOrg();
  const [range, setRange] = useRange("month");
  const q = useQuery({ queryKey: ["journal", range, fy?.id], queryFn: () => api.get("/accounting/reports/journal", { from: range.from, to: range.to, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }).then((r) => r.rows as any[]) });
  return (
    <div>
      <PageHeader title="دفتر روزنامه" />
      <div className="tz-card print-sheet p-3 md:p-4">
        <ReportTitle title="دفتر روزنامه" range={range} />
        <ReportFilters range={range} setRange={setRange} />
        <Table
          className="tz-table"
          size="small"
          rowKey={(r: any) => `${r.voucher_id}-${r.line_no}`}
          loading={q.isLoading}
          dataSource={q.data ?? []}
          pagination={{ pageSize: 300, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
          columns={[
            { key: "date", dataIndex: "date", title: "تاریخ", render: (v, r: any, i) => (i === 0 || (q.data ?? [])[i - 1]?.voucher_id !== r.voucher_id ? <JDate v={v} /> : null) },
            { key: "no", dataIndex: "no", title: "سند", render: (v, r: any, i) => (i === 0 || (q.data ?? [])[i - 1]?.voucher_id !== r.voucher_id ? <b className="num">{faDigits(v)}</b> : null) },
            { key: "acc", title: "حساب", render: (_, r: any) => <span style={{ paddingInlineStart: Number(r.credit) > 0 ? 24 : 0 }}><span className="num text-muted">{faDigits(r.account_code)}</span> {r.account_name}{r.detail_name ? <span className="text-muted"> / {r.detail_name}</span> : null}</span> },
            { key: "desc", title: "شرح", render: (_, r: any) => r.description ?? r.voucher_description, ellipsis: true },
            { key: "dr", dataIndex: "debit", title: "بدهکار", align: "left", render: (v) => <Money v={v} zero="" /> },
            { key: "cr", dataIndex: "credit", title: "بستانکار", align: "left", render: (v) => <Money v={v} zero="" /> },
          ]}
        />
      </div>
    </div>
  );
}

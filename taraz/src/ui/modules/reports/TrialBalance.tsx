import { useState } from "react";
import { Table, Segmented, Switch } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Money, Weight } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { faDigits } from "@shared/format";
import { D } from "@shared/money";
import { exportExcel } from "../../lib/excel";

export default function TrialBalance() {
  const { api, fy, orgId } = useOrg();
  const nav = useNavigate();
  const [range, setRange] = useRange();
  const [level, setLevel] = useState<number>(3);
  const [cols, setCols] = useState<4 | 6 | 8>(6);
  const [weights, setWeights] = useState(false);
  const q = useQuery({
    queryKey: ["tb", range, level, fy?.id],
    queryFn: () => api.get("/accounting/reports/trial-balance", { from: range.from, to: range.to, level, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }),
  });
  const rows = (q.data?.rows ?? []) as any[];
  const side = (v: string, s: "dr" | "cr") => {
    const d = D(v);
    return s === "dr" ? (d.gt(0) ? d.toString() : "0") : d.lt(0) ? d.abs().toString() : "0";
  };
  const t = q.data?.totals;
  const columns: any[] = [
    { key: "code", dataIndex: "code", title: "کد", width: 90, render: (v: string, r: any) => <span className="num" style={{ paddingInlineStart: (r.level - 1) * 12 }}>{faDigits(v)}</span> },
    { key: "name", dataIndex: "name", title: "نام حساب" },
    ...(cols === 8
      ? [
          { key: "odr", title: "مانده‌ی ابتدای دوره — بدهکار", align: "left", render: (_: unknown, r: any) => <Money v={side(r.opening, "dr")} zero="" /> },
          { key: "ocr", title: "مانده‌ی ابتدای دوره — بستانکار", align: "left", render: (_: unknown, r: any) => <Money v={side(r.opening, "cr")} zero="" /> },
        ]
      : []),
    ...(cols >= 6
      ? [
          { key: "dr", dataIndex: "debit", title: "گردش بدهکار", align: "left", render: (v: string) => <Money v={v} zero="" /> },
          { key: "cr", dataIndex: "credit", title: "گردش بستانکار", align: "left", render: (v: string) => <Money v={v} zero="" /> },
        ]
      : []),
    { key: "bdr", title: "مانده بدهکار", align: "left", render: (_: unknown, r: any) => <Money v={side(r.balance, "dr")} zero="" /> },
    { key: "bcr", title: "مانده بستانکار", align: "left", render: (_: unknown, r: any) => <Money v={side(r.balance, "cr")} zero="" /> },
    ...(weights ? [{ key: "w", dataIndex: "w_balance", title: "مانده‌ی وزنی", align: "left", render: (v: string) => <Weight v={v} zero="" /> }] : []),
  ];
  return (
    <div>
      <PageHeader title="تراز آزمایشی" subtitle="روی هر حساب بزنید تا دفتر آن باز شود" />
      <div className="tz-card print-sheet p-3 md:p-4">
        <ReportTitle title="تراز آزمایشی" range={range} />
        <ReportFilters range={range} setRange={setRange}>
          <Segmented size="small" value={level} onChange={(v) => setLevel(v as number)} options={[{ value: 1, label: "گروه" }, { value: 2, label: "کل" }, { value: 3, label: "معین" }]} />
          <Segmented size="small" value={cols} onChange={(v) => setCols(v as 4 | 6 | 8)} options={[{ value: 4, label: "۴ ستونی" }, { value: 6, label: "۶ ستونی" }, { value: 8, label: "۸ ستونی" }]} />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <Switch size="small" checked={weights} onChange={setWeights} /> وزن طلا
          </label>
          <a
            className="text-xs"
            onClick={() =>
              exportExcel("تراز آزمایشی", [
                { title: "کد", value: (r: any) => r.code },
                { title: "نام حساب", value: (r: any) => r.name },
                { title: "مانده ابتدای دوره", value: (r: any) => r.opening, type: "number" },
                { title: "گردش بدهکار", value: (r: any) => r.debit, type: "number" },
                { title: "گردش بستانکار", value: (r: any) => r.credit, type: "number" },
                { title: "مانده", value: (r: any) => r.balance, type: "number" },
              ], rows)
            }
          >
            خروجی اکسل
          </a>
        </ReportFilters>
        <Table
          className="tz-table"
          size="small"
          rowKey="id"
          loading={q.isLoading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: "max-content" }}
          rowClassName={(r: any) => `row-level-${r.level} cursor-pointer`}
          onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/reports/ledger?account=${r.id}`) })}
          summary={() =>
            t ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={2}>جمع</Table.Summary.Cell>
                  {cols === 8 ? (
                    <>
                      <Table.Summary.Cell index={2} align="left"><Money v={t.opening_dr} /></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="left"><Money v={t.opening_cr} /></Table.Summary.Cell>
                    </>
                  ) : null}
                  {cols >= 6 ? (
                    <>
                      <Table.Summary.Cell index={4} align="left"><Money v={t.debit} /></Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="left"><Money v={t.credit} /></Table.Summary.Cell>
                    </>
                  ) : null}
                  <Table.Summary.Cell index={6} align="left"><Money v={t.balance_dr} /></Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="left"><Money v={t.balance_cr} /></Table.Summary.Cell>
                  {weights ? <Table.Summary.Cell index={8} /> : null}
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
      </div>
    </div>
  );
}

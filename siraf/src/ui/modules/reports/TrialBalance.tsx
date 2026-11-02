// Trial balance (تراز آزمایشی) in 4, 6 or 8 columns at the group, general or subsidiary level. Rows open the ledger.
import { useState } from "react";
import { Segmented, Table } from "antd";
import { Weight as WeightIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Weight } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Amt, Card, ICON, Period, PrintFoot, ScalePicker, ScaleProvider, cx, unitCaption, useScale } from "./kit";
import { faDigits, formatNumber } from "@shared/format";
import { D } from "@shared/money";
import { exportExcel } from "../../lib/excel";

const TOP = 56;

export default function TrialBalance() {
  const { api, fy, orgId, unit, has } = useOrg();
  const nav = useNavigate();
  const [range, setRange] = useRange();
  const [level, setLevel] = useState<number>(3);
  const [cols, setCols] = useState<4 | 6 | 8>(6);
  const [weights, setWeights] = useState(false);
  const [scale, setScale] = useScale();
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
  const diff = t ? D(t.balance_dr).minus(D(t.balance_cr)) : D(0);
  const money = (key: string, title: string, get: (r: any) => string) => ({
    key,
    title,
    className: "sf-num",
    width: 152,
    render: (_: unknown, r: any) => <Amt v={get(r)} zero="" />,
  });
  const columns: any[] = [
    {
      key: "code",
      dataIndex: "code",
      title: "کد",
      width: 96,
      render: (v: string, r: any) => (
        <span className="sf-num bk-3" style={{ paddingInlineStart: (r.level - 1) * 12 }}>
          {faDigits(v)}
        </span>
      ),
    },
    {
      key: "name",
      dataIndex: "name",
      title: "نام حساب",
      ellipsis: true,
      render: (v: string, r: any) => <span style={{ paddingInlineStart: (r.level - 1) * 16 }}>{v}</span>,
    },
    ...(cols === 8
      ? [{ key: "open", title: "ماندهٔ ابتدای دوره", children: [money("odr", "بدهکار", (r) => side(r.opening, "dr")), money("ocr", "بستانکار", (r) => side(r.opening, "cr"))] }]
      : []),
    ...(cols >= 6 ? [{ key: "turn", title: "گردش دوره", children: [money("dr", "بدهکار", (r) => r.debit), money("cr", "بستانکار", (r) => r.credit)] }] : []),
    { key: "bal", title: cols === 4 ? "مانده" : "ماندهٔ پایان دوره", children: [money("bdr", "بدهکار", (r) => side(r.balance, "dr")), money("bcr", "بستانکار", (r) => side(r.balance, "cr"))] },
    ...(weights ? [{ key: "w", dataIndex: "w_balance", title: "ماندهٔ وزنی (گرم)", className: "sf-num", width: 136, render: (v: string) => <Weight v={v} zero="" unit={false} /> }] : []),
  ];

  return (
    <div>
      <PageHeader title="تراز آزمایشی" />
      <ReportFilters
        range={range}
        setRange={setRange}
        onExport={() =>
          exportExcel("تراز آزمایشی", [
            { title: "کد", value: (r: any) => r.code },
            { title: "نام حساب", value: (r: any) => r.name },
            { title: "مانده ابتدای دوره", value: (r: any) => r.opening, type: "number" },
            { title: "گردش بدهکار", value: (r: any) => r.debit, type: "number" },
            { title: "گردش بستانکار", value: (r: any) => r.credit, type: "number" },
            { title: "مانده", value: (r: any) => r.balance, type: "number" },
          ], rows)
        }
        end={
          has("gold") ? (
            <button type="button" className="bk-tog" aria-pressed={weights} onClick={() => setWeights(!weights)}>
              <WeightIcon {...ICON} aria-hidden />
              وزن طلا
            </button>
          ) : null
        }
      />
      <ScaleProvider scale={scale}>
        <Card
          title={`تراز ${faDigits(cols)} ستونی`}
          meta={
            <>
              <Period from={range.from} to={range.to} />
              <span className="bk-cap">{unitCaption(scale, unit)}</span>
              {t && !diff.isZero() ? (
                <Chip tone="danger" fig>
                  ناتراز، اختلاف {formatNumber(diff.abs())}
                </Chip>
              ) : null}
            </>
          }
          tools={
            <>
              <Segmented size="small" value={level} onChange={(v) => setLevel(v as number)} options={[{ value: 1, label: "گروه" }, { value: 2, label: "کل" }, { value: 3, label: "معین" }]} />
              <Segmented size="small" value={cols} onChange={(v) => setCols(v as 4 | 6 | 8)} options={[{ value: 4, label: "۴ ستونی" }, { value: 6, label: "۶ ستونی" }, { value: 8, label: "۸ ستونی" }]} />
              <ScalePicker scale={scale} onChange={setScale} />
            </>
          }
          flush
        >
          <ReportTitle title={`تراز آزمایشی ${faDigits(cols)} ستونی`} range={range} />
          <Table
            className="bk-tbl"
            size="small"
            rowKey="id"
            loading={q.isFetching && !q.data}
            dataSource={rows}
            columns={columns}
            pagination={false}
            bordered={false}
            scroll={{ x: "max-content" }}
            sticky={{ offsetHeader: TOP }}
            locale={{ emptyText: q.isLoading ? " " : <EmptyState title="در این دوره گردشی نیست" description="بازهٔ تاریخ را تغییر دهید یا پیش‌نویس‌ها را هم بیاورید." /> }}
            rowClassName={(r: any) => cx("bk-click", `bk-lv-${level === 1 ? 2 : r.level}`)}
            onRow={(r: any) => ({
              onClick: () => nav(`/${orgId}/reports/ledger?account=${r.id}`),
              onKeyDown: (e) => {
                if (e.key === "Enter") nav(`/${orgId}/reports/ledger?account=${r.id}`);
              },
              tabIndex: 0,
            })}
            summary={() =>
              t ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2} className="bk-sum-l">
                      جمع<small>{faDigits(rows.filter((r) => r.level === level).length)} حساب</small>
                    </Table.Summary.Cell>
                    {cols === 8 ? (
                      <>
                        <Table.Summary.Cell index={2} className="sf-num"><Amt v={t.opening_dr} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={3} className="sf-num"><Amt v={t.opening_cr} /></Table.Summary.Cell>
                      </>
                    ) : null}
                    {cols >= 6 ? (
                      <>
                        <Table.Summary.Cell index={4} className="sf-num"><Amt v={t.debit} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={5} className="sf-num"><Amt v={t.credit} /></Table.Summary.Cell>
                      </>
                    ) : null}
                    <Table.Summary.Cell index={6} className="sf-num"><Amt v={t.balance_dr} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={7} className="sf-num"><Amt v={t.balance_cr} /></Table.Summary.Cell>
                    {weights ? <Table.Summary.Cell index={8} /> : null}
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
          <PrintFoot sign={["تهیه‌کننده", "تأییدکننده"]} />
        </Card>
      </ScaleProvider>
    </div>
  );
}

// Trial balance (تراز آزمایشی) in 4, 6 or 8 columns at the group, general or subsidiary level. Rows open the ledger.
import { useState } from "react";
import { Button, Dropdown, Table } from "antd";
import { ChevronDown, Weight as WeightIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Weight } from "../../components/display";
import { ReportFilters, ReportTitle, useRange } from "./Filters";
import { Amt, Card, ICON, ICON14, Period, PrintFoot, ScalePicker, ScaleProvider, cx, unitCaption, useScale } from "./kit";
import { faDigits, formatNumber } from "@shared/format";
import { D } from "@shared/money";
import { exportExcel } from "../../lib/excel";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";
import { usePrinting } from "../../lib/print";

const TOP = 56;

export default function TrialBalance() {
  const printing = usePrinting(); // antd's sticky header would print as its own, misaligned table
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
      width: 80,
      render: (v: string) => <span className="sf-num bk-3">{faDigits(v)}</span>,
    },
    {
      key: "name",
      dataIndex: "name",
      title: "نام حساب",
      ellipsis: true,
      render: (v: string, r: any) => <span style={{ paddingInlineStart: (r.level - 1) * 12 }}>{v}</span>,
    },
    ...(cols === 8
      ? [{ key: "open", title: "ماندهٔ ابتدای دوره", children: [money("odr", "بدهکار", (r) => side(r.opening, "dr")), money("ocr", "بستانکار", (r) => side(r.opening, "cr"))] }]
      : []),
    ...(cols >= 6 ? [{ key: "turn", title: "گردش دوره", children: [money("dr", "بدهکار", (r) => r.debit), money("cr", "بستانکار", (r) => r.credit)] }] : []),
    { key: "bal", title: cols === 4 ? "مانده" : "ماندهٔ پایان دوره", children: [money("bdr", "بدهکار", (r) => side(r.balance, "dr")), money("bcr", "بستانکار", (r) => side(r.balance, "cr"))] },
    ...(weights ? [{ key: "w", dataIndex: "w_balance", title: "ماندهٔ وزنی (گرم)", className: "sf-num", width: 136, render: (v: string) => <Weight v={v} zero="" unit={false} /> }] : []),
  ];

  // the money groups of the chosen layout, shared by the screen table and the printed sheet
  const groups: { key: string; title: string; dr: (r: any) => string; cr: (r: any) => string; tdr: string; tcr: string }[] = t
    ? [
        ...(cols === 8 ? [{ key: "open", title: "ماندهٔ ابتدای دوره", dr: (r: any) => side(r.opening, "dr"), cr: (r: any) => side(r.opening, "cr"), tdr: t.opening_dr, tcr: t.opening_cr }] : []),
        ...(cols >= 6 ? [{ key: "turn", title: "گردش دوره", dr: (r: any) => r.debit, cr: (r: any) => r.credit, tdr: t.debit, tcr: t.credit }] : []),
        { key: "bal", title: cols === 4 ? "مانده" : "ماندهٔ پایان دوره", dr: (r: any) => side(r.balance, "dr"), cr: (r: any) => side(r.balance, "cr"), tdr: t.balance_dr, tcr: t.balance_cr },
      ]
    : [];
  const LEVELS: Record<number, string> = { 1: "گروه", 2: "کل", 3: "معین" };
  const count = rows.filter((r) => r.level === level).length;

  return (
    <div>
      <PageHeader title="تراز آزمایشی" actions={<AiExplainButton report="trial_balance" params={{ from: range.from, to: range.to, level, fiscal_year_id: fy?.id, drafts: range.drafts ? 1 : 0 }} title="تراز آزمایشی" />} />
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
          className={cols >= 6 ? "bk-wide" : undefined}
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
              <Dropdown
                trigger={["click"]}
                rootClassName="sf-glass"
                menu={{
                  selectable: true,
                  multiple: true,
                  selectedKeys: [`lv-${level}`, `c-${cols}`],
                  onClick: ({ key }) => {
                    const [k, v] = key.split("-");
                    if (k === "lv") setLevel(Number(v));
                    else setCols(Number(v) as 4 | 6 | 8);
                  },
                  items: [
                    { type: "group", label: "سطح حساب‌ها", children: [1, 2, 3].map((v) => ({ key: `lv-${v}`, label: LEVELS[v] })) },
                    { type: "divider" },
                    { type: "group", label: "ستون‌ها", children: [4, 6, 8].map((v) => ({ key: `c-${v}`, label: `${faDigits(v)} ستونی` })) },
                  ],
                }}
              >
                <Button size="small" type="text" className="bk-view-btn">
                  <span className="bk-3">نمایش</span>
                  <span>
                    {LEVELS[level]}، {faDigits(cols)} ستونی
                  </span>
                  <ChevronDown {...ICON14} aria-hidden />
                </Button>
              </Dropdown>
              <ScalePicker scale={scale} onChange={setScale} />
            </>
          }
          flush
        >
          <ReportTitle title={`تراز آزمایشی ${faDigits(cols)} ستونی`} range={range} />
          <div className="no-print">
          <Table
            className={cx("bk-tbl", weights && "has-tail")}
            size="small"
            rowKey="id"
            loading={q.isFetching && !q.data}
            dataSource={rows}
            columns={columns}
            pagination={false}
            bordered={false}
            scroll={{ x: "max-content" }}
            sticky={printing ? undefined : { offsetHeader: TOP }}
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
                      جمع<small>{faDigits(count)} حساب</small>
                    </Table.Summary.Cell>
                    {groups.flatMap((g, i) => [
                      <Table.Summary.Cell key={`${g.key}-dr`} index={2 + i * 2} className="sf-num"><Amt v={g.tdr} /></Table.Summary.Cell>,
                      <Table.Summary.Cell key={`${g.key}-cr`} index={3 + i * 2} className="sf-num"><Amt v={g.tcr} /></Table.Summary.Cell>,
                    ])}
                    {weights ? <Table.Summary.Cell index={2 + groups.length * 2} /> : null}
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
          </div>
          {t ? (
            // the printed sheet: one plain table, so the totals (tfoot) share the columns of the rows above them
            <div className="bk-po">
              <table className={cx("bk-ptbl bk-tb-p", cols === 8 && "is-8")}>
                <colgroup>
                  <col className="c" />
                  <col />
                  {groups.flatMap((g) => [<col key={`${g.key}-dr`} className="m" />, <col key={`${g.key}-cr`} className="m" />])}
                  {weights ? <col className="m" /> : null}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2}>کد</th>
                    <th rowSpan={2}>نام حساب</th>
                    {groups.map((g) => (
                      <th key={g.key} colSpan={2} className="g">
                        {g.title}
                      </th>
                    ))}
                    {weights ? <th rowSpan={2} className="n">ماندهٔ وزنی (گرم)</th> : null}
                  </tr>
                  <tr>
                    {groups.flatMap((g) => [
                      <th key={`${g.key}-dr`} className="n">بدهکار</th>,
                      <th key={`${g.key}-cr`} className="n">بستانکار</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`lv-${level === 1 ? 2 : r.level}`}>
                      <td className="n">{faDigits(r.code)}</td>
                      <td style={{ paddingInlineStart: (r.level - 1) * 12 }}>{r.name}</td>
                      {groups.flatMap((g) => [
                        <td key={`${g.key}-dr`} className="n"><Amt v={g.dr(r)} zero="" /></td>,
                        <td key={`${g.key}-cr`} className="n"><Amt v={g.cr(r)} zero="" /></td>,
                      ])}
                      {weights ? <td className="n"><Weight v={r.w_balance} zero="" unit={false} /></td> : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      جمع {faDigits(count)} حساب
                    </td>
                    {groups.flatMap((g) => [
                      <td key={`${g.key}-dr`} className="n"><Amt v={g.tdr} /></td>,
                      <td key={`${g.key}-cr`} className="n"><Amt v={g.tcr} /></td>,
                    ])}
                    {weights ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
          <PrintFoot sign={["تهیه‌کننده", "تأییدکننده"]} />
        </Card>
      </ScaleProvider>
    </div>
  );
}

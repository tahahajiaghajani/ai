// Sales and profit report (گزارش فروش و سود): net sales, cost of goods sold and gross profit by
// item, customer, item group or month; purchases by item or supplier. Excel export, print.
import { useState } from "react";
import { Button, Segmented, Table, Tabs } from "antd";
import { DataTable } from "../../components/data";
import { Boxes, FileSpreadsheet, Percent, Printer, ReceiptText, ShoppingBag, TrendingUp } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { useIsPhone, useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { Money, StatCard } from "../../components/display";
import { DateInput, PartySelect } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits, formatCompact, formatNumber } from "@shared/format";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";
import { LatinRuns, Qty } from "./components";

type Tab = "item" | "party" | "category" | "month" | "p-item" | "p-party";

const TABS: { key: Tab; label: string; side: "sales" | "purchases"; group: string; col: string }[] = [
  { key: "item", label: "فروش بر اساس کالا", side: "sales", group: "item", col: "کالا / خدمت" },
  { key: "party", label: "بر اساس مشتری", side: "sales", group: "party", col: "مشتری" },
  { key: "category", label: "بر اساس گروه کالا", side: "sales", group: "category", col: "گروه کالا" },
  { key: "month", label: "ماهانه", side: "sales", group: "month", col: "ماه" },
  { key: "p-item", label: "خرید بر اساس کالا", side: "purchases", group: "item", col: "کالا / خدمت" },
  { key: "p-party", label: "خرید بر اساس تأمین‌کننده", side: "purchases", group: "party", col: "تأمین‌کننده" },
];

export default function SalesReports() {
  const { api, fy, org } = useOrg();
  const n = useNotify();
  const [tab, setTab] = useState<Tab>("item");
  const [from, setFrom] = useState<string | null>(fy?.start_date ?? presetRange("year").from);
  const [to, setTo] = useState<string | null>(fy?.end_date ?? presetRange("year").to);
  const [partyId, setPartyId] = useState<string | null>(null);
  const t = TABS.find((x) => x.key === tab)!;
  // the party filter is hidden on the by-customer / by-supplier tabs (they list every party) and
  // is then not sent either
  const partyShown = t.group !== "party";
  const party = partyShown ? partyId : null;
  const r = useQuery({
    queryKey: ["goods-analysis", t.side, t.group, from, to, party],
    queryFn: () => api.get(`/goods/reports/${t.side}`, { group: t.group, from, to, party_id: party }),
  });
  const rows = (r.data?.rows ?? []) as any[];
  const totals = r.data?.totals;
  const sales = t.side === "sales";
  const phone = useIsPhone();
  const presetOf = (): string | undefined => {
    if (fy && from === fy.start_date && to === fy.end_date) return "fy";
    for (const k of ["quarter", "month", "lastMonth", "today"] as const) {
      const p = presetRange(k as "month", todayISO());
      if (p.from === from && p.to === to) return k;
    }
    return undefined;
  };
  const exportRows = async () => {
    try {
      await exportExcel(t.label, [
        { title: t.col, value: (x: any) => (x.code ? `${x.code} — ${x.label}` : x.label) },
        ...(t.group === "item" ? [{ title: "مقدار", value: (x: any) => x.qty, type: "number" as const }] : []),
        { title: sales ? "فروش خالص" : "مبلغ خرید", value: (x: any) => x.amount, type: "number" as const },
        ...(sales
          ? [
              { title: "بهای تمام‌شده", value: (x: any) => x.cost, type: "number" as const },
              { title: "سود ناخالص", value: (x: any) => x.profit, type: "number" as const },
              { title: "درصد سود", value: (x: any) => x.margin_pct, type: "number" as const },
            ]
          : [{ title: "مالیات", value: (x: any) => x.tax, type: "number" as const }]),
        { title: "تعداد فاکتور", value: (x: any) => x.invoices, type: "number" as const },
      ], rows);
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <div>
      <PageHeader
        title="گزارش فروش و سود"
        actions={
          <>
            <Button icon={<Ic icon={FileSpreadsheet} />} onClick={exportRows} disabled={!rows.length}>اکسل</Button>
            <Button icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="sf-filters no-print">
        <Segmented
          size="small"
          value={presetOf() ?? ""}
          options={[
            { value: "fy", label: "سال مالی" },
            { value: "quarter", label: "فصل" },
            { value: "month", label: "این ماه" },
            { value: "lastMonth", label: "ماه قبل" },
            { value: "today", label: "امروز" },
          ]}
          onChange={(v) => {
            if (v === "fy" && fy) {
              setFrom(fy.start_date);
              setTo(fy.end_date);
            } else {
              const p = presetRange(v as "month", todayISO());
              setFrom(p.from);
              setTo(p.to);
            }
          }}
        />
        <DateInput value={from} onChange={setFrom} allowClear placeholder="از تاریخ" className="!w-36" />
        <DateInput value={to} onChange={setTo} allowClear placeholder="تا تاریخ" className="!w-36" />
        {partyShown ? <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder={sales ? "همه‌ی مشتریان" : "همه‌ی تأمین‌کنندگان"} className="!w-56" /> : null}
      </div>
      {totals ? (
        <div className="no-print mb-4 grid sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title={sales ? "فروش خالص" : "خرید خالص"} icon={<Ic icon={ShoppingBag} />} value={<Money v={totals.amount} unit />} />
          {sales ? <StatCard title="بهای تمام‌شده" icon={<Ic icon={Boxes} />} value={<Money v={totals.cost} unit />} /> : <StatCard title="مالیات خرید" icon={<Ic icon={Percent} />} value={<Money v={totals.tax} unit />} />}
          {sales ? <StatCard title="سود ناخالص" icon={<Ic icon={TrendingUp} />} value={<Money v={totals.profit} unit />} hint={totals.margin_pct ? `${formatNumber(totals.margin_pct, { dp: 1 })}٪ از فروش` : undefined} /> : null}
          <StatCard title="تعداد فاکتور" icon={<Ic icon={ReceiptText} />} value={faDigits(totals.invoices)} />
        </div>
      ) : null}
      <div className="sf-card print-sheet">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-semibold">{org.name}</div>
          <div className="text-base font-semibold">{t.label}</div>
          <div className="text-xs">{from ? `از ${formatJalali(from)}` : ""} {to ? `تا ${formatJalali(to)}` : ""}</div>
        </div>
        <Tabs className="no-print px-5" activeKey={tab} onChange={(k) => setTab(k as Tab)} items={TABS.map((x) => ({ key: x.key, label: x.label }))} />
        {t.group === "month" && rows.length ? (
          <div className="no-print h-64 px-3 pb-2">
            <ResponsiveContainer>
              <BarChart data={rows.map((x) => ({ label: x.label, amount: Number(x.amount), profit: Number(x.profit ?? 0) }))} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="var(--sf-chart-grid)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--sf-text-3)" }} tickLine={false} axisLine={{ stroke: "var(--sf-chart-axis)" }} reversed />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 12, fill: "var(--sf-text-3)" }} tickLine={false} axisLine={false} orientation="right" width={72} />
                <Tooltip
                  cursor={{ fill: "var(--sf-hover)" }}
                  formatter={(v, k) => [formatCompact(Number(v)), k === "amount" ? "فروش خالص" : "سود ناخالص"]}
                  contentStyle={{ background: "var(--sf-raised)", border: 0, borderRadius: 8, boxShadow: "var(--sf-shadow-e3)", direction: "rtl", fontSize: 13 }}
                  labelStyle={{ color: "var(--sf-text-3)", fontSize: 12 }}
                />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-[12px] text-ink-2">{v === "amount" ? "فروش خالص" : "سود ناخالص"}</span>} />
                <Bar dataKey="amount" fill="var(--sf-accent-line)" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500} />
                <Bar dataKey="profit" fill="var(--sf-chart-6)" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <DataTable
          size="small"
          rowKey="key"
          loading={r.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small" }}
          scroll={{ x: "max-content" }}
          columns={[
            { key: "label", dataIndex: "label", title: t.col, render: (v, x: any) => <span>{x.code ? <span className="sf-docno me-2 text-ink-3">{faDigits(x.code)}</span> : null}<LatinRuns text={v} /></span> },
            ...(t.group === "item" ? [{ key: "qty", dataIndex: "qty", title: "مقدار", className: "sf-num", render: (v: string) => <Qty v={v} /> }] : []),
            { key: "amount", dataIndex: "amount", title: sales ? "فروش خالص" : "مبلغ خرید", className: "sf-num", sorter: (a: any, b: any) => D(a.amount).cmp(D(b.amount)), render: (v: string) => <Money v={v} /> },
            ...(sales
              ? [
                  { key: "cost", dataIndex: "cost", title: "بهای تمام‌شده", className: "sf-num", render: (v: string) => <Money v={v} /> },
                  { key: "profit", dataIndex: "profit", title: "سود ناخالص", className: "sf-num", sorter: (a: any, b: any) => D(a.profit).cmp(D(b.profit)), render: (v: string) => <Money v={v} /> },
                  { key: "margin", dataIndex: "margin_pct", title: "درصد سود", className: "sf-num", render: (v: string | null) => (v === null ? "—" : <span className="sf-num">{formatNumber(v, { dp: 1 })}٪</span>) },
                ]
              : [{ key: "tax", dataIndex: "tax", title: "مالیات", className: "sf-num", render: (v: string) => <Money v={v} /> }]),
            { key: "invoices", dataIndex: "invoices", title: "فاکتور", className: "sf-num", render: (v: number) => <span className="sf-num">{faDigits(v)}</span> },
          ]}
          showSorterTooltip={false}
          summary={() =>
            totals && rows.length && !phone ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={t.group === "item" ? 2 : 1}>جمع</Table.Summary.Cell>
                <Table.Summary.Cell index={1} className="sf-num"><Money v={totals.amount} /></Table.Summary.Cell>
                {sales ? (
                  <>
                    <Table.Summary.Cell index={2} className="sf-num"><Money v={totals.cost} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} className="sf-num"><Money v={totals.profit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} className="sf-num">{totals.margin_pct ? <span className="sf-num">{formatNumber(totals.margin_pct, { dp: 1 })}٪</span> : null}</Table.Summary.Cell>
                  </>
                ) : (
                  <Table.Summary.Cell index={2} className="sf-num"><Money v={totals.tax} /></Table.Summary.Cell>
                )}
                <Table.Summary.Cell index={5} className="sf-num"><span className="sf-num">{faDigits(totals.invoices)}</span></Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </div>
    </div>
  );
}

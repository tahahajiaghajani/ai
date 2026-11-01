// Sales and profit report (گزارش فروش و سود): net sales, cost of goods sold and gross profit by
// item, customer, item group or month; purchases by item or supplier. Excel export, print.
import { useState } from "react";
import { Button, Segmented, Table, Tabs } from "antd";
import { FileExcelOutlined, PrinterOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { Money, StatCard } from "../../components/display";
import { DateInput, PartySelect } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits, formatCompact, formatNumber } from "@shared/format";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";
import { Qty } from "./components";

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
  const r = useQuery({
    queryKey: ["goods-analysis", t.side, t.group, from, to, partyId],
    queryFn: () => api.get(`/goods/reports/${t.side}`, { group: t.group, from, to, party_id: partyId }),
  });
  const rows = (r.data?.rows ?? []) as any[];
  const totals = r.data?.totals;
  const sales = t.side === "sales";
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
        subtitle="فروش خالص (پس از تخفیف‌ها و برگشتی‌ها، بدون مالیات)، بهای تمام‌شده و سود ناخالص"
        actions={
          <>
            <Button icon={<FileExcelOutlined />} onClick={exportRows} disabled={!rows.length}>اکسل</Button>
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          size="small"
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
        {t.group !== "party" ? <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder={sales ? "همه‌ی مشتریان" : "همه‌ی تأمین‌کنندگان"} className="!w-56" /> : null}
      </div>
      {totals ? (
        <div className="no-print mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title={sales ? "فروش خالص" : "خرید خالص"} value={<Money v={totals.amount} />} />
          {sales ? <StatCard title="بهای تمام‌شده" value={<Money v={totals.cost} />} tone="muted" /> : <StatCard title="مالیات خرید" value={<Money v={totals.tax} />} tone="muted" />}
          {sales ? <StatCard title="سود ناخالص" value={<Money v={totals.profit} colored />} tone="ok" hint={totals.margin_pct ? `${formatNumber(totals.margin_pct, { dp: 1 })}٪ از فروش` : undefined} /> : null}
          <StatCard title="تعداد فاکتور" value={faDigits(totals.invoices)} tone="gold" />
        </div>
      ) : null}
      <div className="tz-card print-sheet p-3 md:p-4">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div className="text-base font-semibold">{t.label}</div>
          <div className="text-xs">{from ? `از ${formatJalali(from)}` : ""} {to ? `تا ${formatJalali(to)}` : ""}</div>
        </div>
        <Tabs className="no-print" activeKey={tab} onChange={(k) => setTab(k as Tab)} items={TABS.map((x) => ({ key: x.key, label: x.label }))} />
        {t.group === "month" && rows.length ? (
          <div className="no-print mb-4 h-64">
            <ResponsiveContainer>
              <BarChart data={rows.map((x) => ({ label: x.label, amount: Number(x.amount), profit: Number(x.profit ?? 0) }))} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--tz-line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--tz-muted)" }} reversed />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 10, fill: "var(--tz-muted)" }} orientation="right" width={80} />
                <Tooltip formatter={(v) => formatCompact(Number(v))} contentStyle={{ fontFamily: "Vazirmatn", borderRadius: 8, direction: "rtl" }} />
                <Legend formatter={(v) => (v === "amount" ? "فروش خالص" : "سود ناخالص")} />
                <Bar dataKey="amount" fill="#0e7490" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="profit" fill="#b8862f" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <Table
          className="tz-table"
          size="small"
          rowKey="key"
          loading={r.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small" }}
          scroll={{ x: "max-content" }}
          columns={[
            { key: "label", dataIndex: "label", title: t.col, render: (v, x: any) => <span>{x.code ? <span className="num text-muted">{faDigits(x.code)} </span> : null}{v}</span> },
            ...(t.group === "item" ? [{ key: "qty", dataIndex: "qty", title: "مقدار", align: "left" as const, render: (v: string) => <Qty v={v} /> }] : []),
            { key: "amount", dataIndex: "amount", title: sales ? "فروش خالص" : "مبلغ خرید", align: "left" as const, sorter: (a: any, b: any) => D(a.amount).cmp(D(b.amount)), render: (v: string) => <Money v={v} /> },
            ...(sales
              ? [
                  { key: "cost", dataIndex: "cost", title: "بهای تمام‌شده", align: "left" as const, render: (v: string) => <Money v={v} /> },
                  { key: "profit", dataIndex: "profit", title: "سود ناخالص", align: "left" as const, sorter: (a: any, b: any) => D(a.profit).cmp(D(b.profit)), render: (v: string) => <Money v={v} colored /> },
                  { key: "margin", dataIndex: "margin_pct", title: "درصد سود", align: "left" as const, render: (v: string | null) => (v === null ? "—" : <span className="num">{formatNumber(v, { dp: 1 })}٪</span>) },
                ]
              : [{ key: "tax", dataIndex: "tax", title: "مالیات", align: "left" as const, render: (v: string) => <Money v={v} /> }]),
            { key: "invoices", dataIndex: "invoices", title: "فاکتور", align: "left" as const, render: (v: number) => <span className="num">{faDigits(v)}</span> },
          ]}
          summary={() =>
            totals && rows.length ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={t.group === "item" ? 2 : 1}>جمع</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="left"><Money v={totals.amount} /></Table.Summary.Cell>
                {sales ? (
                  <>
                    <Table.Summary.Cell index={2} align="left"><Money v={totals.cost} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="left"><Money v={totals.profit} colored /></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="left">{totals.margin_pct ? <span className="num">{formatNumber(totals.margin_pct, { dp: 1 })}٪</span> : null}</Table.Summary.Cell>
                  </>
                ) : (
                  <Table.Summary.Cell index={2} align="left"><Money v={totals.tax} /></Table.Summary.Cell>
                )}
                <Table.Summary.Cell index={5} align="left"><span className="num">{faDigits(totals.invoices)}</span></Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </div>
    </div>
  );
}

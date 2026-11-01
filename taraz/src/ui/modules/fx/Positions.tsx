// Currency position and profit (موقعیت ارزی و سود): holdings per currency with average cost,
// book and market value and unrealized profit; realized profit of a period by currency and day.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Segmented, Table, Tabs } from "antd";
import { PrinterOutlined, RiseOutlined, FundOutlined, WalletOutlined, PercentageOutlined } from "@ant-design/icons";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { Money, StatCard, EmptyState, JDate } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatCompact } from "@shared/format";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";
import { CurrencyChip, FxAmount, KIND_FA, rateLabel } from "./shared";

const LEG_FA: Record<string, string> = { fx_cash: "صندوق", fx_bank: "بانک", crypto_wallets: "کیف‌پول" };

export default function Positions() {
  const { api, org, fy } = useOrg();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const [date, setDate] = useState<string | null>(todayISO(tz));
  const [from, setFrom] = useState<string | null>(fy?.start_date ?? presetRange("year").from);
  const [to, setTo] = useState<string | null>(fy?.end_date ?? presetRange("year").to);
  const pos = useQuery({ queryKey: ["fx-positions", date, from, to], queryFn: () => api.get("/fx/reports/positions", { date, from, to }) });
  const deals = useQuery({ queryKey: ["fx-deals-report", from, to], queryFn: () => api.get("/fx/reports/deals", { from, to }) });
  const p = pos.data;
  const baseDp = org.money_decimals ?? 0;
  return (
    <div>
      <PageHeader
        title="موقعیت ارزی و سود"
        actions={<Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>}
      />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">موجودی تا</span>
        <DateInput value={date} onChange={setDate} className="!w-36" />
        <span className="ms-4 text-xs text-muted">سود محقق‌شده از</span>
        <DateInput value={from} onChange={setFrom} className="!w-36" />
        <span className="text-xs text-muted">تا</span>
        <DateInput value={to} onChange={setTo} className="!w-36" />
        <Segmented
          size="small"
          onChange={(v) => {
            const r = v === "fy" && fy ? { from: fy.start_date, to: fy.end_date } : presetRange(v as "month");
            setFrom(r.from);
            setTo(r.to);
          }}
          options={[{ value: "fy", label: "سال مالی" }, { value: "quarter", label: "فصل" }, { value: "month", label: "ماه" }, { value: "today", label: "امروز" }]}
        />
      </div>
      <div className="mb-3 hidden text-center print:block">
        <div className="text-lg font-bold">{org.name}</div>
        <div>موقعیت ارزی تا {formatJalali(date)}</div>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="ارزش دفتری ارزها" value={<Money v={p?.totals.book_value ?? 0} unit />} icon={<WalletOutlined />} />
        <StatCard title="ارزش روز (نرخ تابلو)" value={<Money v={p?.totals.market_value ?? 0} unit />} icon={<FundOutlined />} tone="muted" />
        <StatCard title="سود (زیان) تحقق‌نیافته" value={<Money v={p?.totals.unrealized ?? 0} colored />} icon={<RiseOutlined />} tone={D(p?.totals.unrealized ?? 0).lt(0) ? "bad" : "ok"} hint="ارزش روز − ارزش دفتری" />
        <StatCard
          title="سود محقق‌شده‌ی دوره"
          value={<Money v={D(p?.realized.profit ?? 0).plus(D(p?.realized.fees ?? 0)).toFixed()} colored />}
          icon={<PercentageOutlined />}
          tone="gold"
          hint={p ? <>معاملات <Money v={p.realized.profit} /> · کارمزد <Money v={p.realized.fees} />{!D(p.realized.revaluation).isZero() ? <> · تسعیر <Money v={p.realized.revaluation} /></> : null}</> : null}
        />
      </div>
      {p?.totals.missing_rates?.length ? <Alert className="!mb-4 no-print" type="warning" showIcon title={`نرخ این ارزها در تابلو نیست و ارزش روزشان حساب نشد: ${p.totals.missing_rates.join("، ")}`} /> : null}
      <Tabs
        items={[
          {
            key: "pos",
            label: "موقعیت ارزها",
            children: (
              <Section bodyClass="p-0">
                <Table
                  className="tz-table print-sheet"
                  size="small"
                  rowKey="currency_id"
                  loading={pos.isLoading}
                  dataSource={p?.rows ?? []}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  locale={{ emptyText: <EmptyState title="موجودی ارزی ثبت نشده است" /> }}
                  expandable={{
                    rowExpandable: (r: any) => r.legs.length > 0,
                    expandedRowRender: (r: any) => (
                      <div className="grid gap-1 py-1">
                        {r.legs.map((l: any) => (
                          <div key={`${l.key}-${l.detail_id}`} className="flex flex-wrap gap-4 text-xs">
                            <span className="w-16 text-muted">{LEG_FA[l.key] ?? l.key}</span>
                            <span className="w-48">{l.name ?? "—"}</span>
                            <FxAmount v={l.fx} code={r.code} dp={r.decimals} />
                            <Money v={l.base} />
                          </div>
                        ))}
                      </div>
                    ),
                  }}
                  columns={[
                    { key: "c", title: "ارز", render: (_, r: any) => <span className="flex items-center gap-2"><CurrencyChip c={r} /> {r.name}</span> },
                    { key: "h", title: "موجودی", align: "left", render: (_, r: any) => <FxAmount v={r.holdings} dp={r.decimals} strong /> },
                    { key: "avg", title: "میانگین بها", align: "left", render: (_, r: any) => <span className="num">{r.avg_cost ? rateLabel(r.avg_cost, baseDp) : "—"}</span> },
                    { key: "book", title: "ارزش دفتری", align: "left", render: (_, r: any) => <Money v={r.book_value} /> },
                    { key: "rate", title: "نرخ روز", align: "left", render: (_, r: any) => <span className="num text-muted">{r.market_rate ? rateLabel(r.market_rate, baseDp) : "—"}</span> },
                    { key: "mv", title: "ارزش روز", align: "left", render: (_, r: any) => (r.market_value ? <Money v={r.market_value} /> : <span className="text-muted">—</span>) },
                    { key: "un", title: "تحقق‌نیافته", align: "left", render: (_, r: any) => (r.unrealized ? <Money v={r.unrealized} colored /> : <span className="text-muted">—</span>) },
                    { key: "cust", title: "مانده‌ی مشتریان", align: "left", render: (_, r: any) => <FxAmount v={r.customers_net} dp={r.decimals} colored /> },
                    { key: "corr", title: "مانده‌ی همکاران", align: "left", render: (_, r: any) => <FxAmount v={r.correspondents_net} dp={r.decimals} colored /> },
                    { key: "exp", title: "موقعیت خالص", align: "left", render: (_, r: any) => <FxAmount v={r.exposure} dp={r.decimals} strong /> },
                  ]}
                  summary={(rows) =>
                    rows.length ? (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={4}>جمع</Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="left"><Money v={p?.totals.book_value ?? 0} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={5} />
                        <Table.Summary.Cell index={6} align="left"><Money v={p?.totals.market_value ?? 0} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={7} align="left"><Money v={p?.totals.unrealized ?? 0} colored /></Table.Summary.Cell>
                        <Table.Summary.Cell index={8} colSpan={3} />
                      </Table.Summary.Row>
                    ) : null
                  }
                />
                <div className="px-4 py-2 text-[11px] text-muted">
                  موجودی = صندوق‌های ارزی + بانک‌های ارزی + کیف‌پول‌ها. میانگین بها = ارزش دفتری ÷ موجودی (پس از تسعیر، نرخ تسعیر). موقعیت خالص = موجودی + طلب از مشتریان و همکاران − بدهی به آن‌ها.
                </div>
              </Section>
            ),
          },
          {
            key: "profit",
            label: "سود معاملات",
            children: <ProfitReport data={deals.data} loading={deals.isLoading} baseDp={baseDp} />,
          },
        ]}
      />
    </div>
  );
}

function ProfitReport({ data, loading, baseDp }: { data: any; loading: boolean; baseDp: number }) {
  const chart = (data?.by_day ?? []).map((d: any) => ({ day: formatJalali(d.date).slice(5), profit: Number(d.profit), fees: Number(d.fees) }));
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="تعداد معاملات" value={faDigits(data?.totals.count ?? 0)} tone="muted" />
        <StatCard title="حجم معاملات" value={<Money v={data?.totals.volume ?? 0} unit />} />
        <StatCard title="سود معاملات" value={<Money v={data?.totals.profit ?? 0} colored />} tone="ok" />
        <StatCard title="درآمد کارمزد" value={<Money v={data?.totals.fees ?? 0} />} tone="gold" />
      </div>
      {chart.length > 1 ? (
        <Section title="سود روزانه">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--tz-line)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--tz-muted)" }} reversed />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 10, fill: "var(--tz-muted)" }} orientation="right" width={70} />
                <Tooltip formatter={(v) => formatCompact(Number(v))} contentStyle={{ fontFamily: "Vazirmatn", borderRadius: 8, direction: "rtl" }} />
                <Legend formatter={(v) => (v === "profit" ? "سود معامله" : "کارمزد")} />
                <Bar dataKey="profit" stackId="a" fill="#0e7490" maxBarSize={26} />
                <Bar dataKey="fees" stackId="a" fill="#b8862f" radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      ) : null}
      <Section title="به تفکیک ارز" bodyClass="p-0">
        <Table
          className="tz-table"
          size="small"
          rowKey="currency_id"
          loading={loading}
          dataSource={data?.by_currency ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState title="در این دوره معامله‌ای ثبت نشده است" /> }}
          columns={[
            { key: "c", title: "ارز", render: (_, r: any) => <span className="flex items-center gap-2"><CurrencyChip c={{ code: r.code, kind: "fiat" }} /> {r.name}</span> },
            { key: "bc", title: "خرید (تعداد)", align: "center", render: (_, r: any) => <span className="num">{faDigits(r.buy_count)}</span> },
            { key: "b", title: "مقدار خرید", align: "left", render: (_, r: any) => <FxAmount v={r.bought} dp={r.decimals} /> },
            { key: "ab", title: "میانگین نرخ خرید", align: "left", render: (_, r: any) => <span className="num text-muted">{r.avg_buy ? rateLabel(r.avg_buy, baseDp) : "—"}</span> },
            { key: "sc", title: "فروش (تعداد)", align: "center", render: (_, r: any) => <span className="num">{faDigits(r.sell_count)}</span> },
            { key: "s", title: "مقدار فروش", align: "left", render: (_, r: any) => <FxAmount v={r.sold} dp={r.decimals} /> },
            { key: "as", title: "میانگین نرخ فروش", align: "left", render: (_, r: any) => <span className="num text-muted">{r.avg_sell ? rateLabel(r.avg_sell, baseDp) : "—"}</span> },
            { key: "x", title: "تبدیل (ورود/خروج)", align: "left", render: (_, r: any) => <span className="text-xs"><FxAmount v={r.exchange_in} dp={r.decimals} /> / <FxAmount v={r.exchange_out} dp={r.decimals} /></span> },
            { key: "cost", title: "بهای تمام‌شده", align: "left", render: (_, r: any) => <Money v={r.cost} /> },
            { key: "p", title: "سود", align: "left", render: (_, r: any) => <Money v={r.profit} colored /> },
            { key: "f", title: "کارمزد", align: "left", render: (_, r: any) => <Money v={r.fees} zero="—" /> },
          ]}
        />
      </Section>
      <Section title="به تفکیک نوع معامله" bodyClass="p-0">
        <Table
          className="tz-table"
          size="small"
          rowKey="kind"
          dataSource={data?.by_kind ?? []}
          pagination={false}
          columns={[
            { key: "k", dataIndex: "kind", title: "نوع", render: (v) => KIND_FA[v] ?? v },
            { key: "n", dataIndex: "count", title: "تعداد", render: (v) => <span className="num">{faDigits(v)}</span> },
            { key: "v", dataIndex: "volume", title: "حجم", align: "left", render: (v) => <Money v={v} /> },
            { key: "p", dataIndex: "profit", title: "سود", align: "left", render: (v) => <Money v={v} colored /> },
            { key: "f", dataIndex: "fees", title: "کارمزد", align: "left", render: (v) => <Money v={v} zero="—" /> },
          ]}
        />
      </Section>
      {(data?.by_day ?? []).length ? (
        <Section title="به تفکیک روز" bodyClass="p-0">
          <Table
            className="tz-table"
            size="small"
            rowKey="date"
            dataSource={[...(data?.by_day ?? [])].reverse()}
            pagination={{ pageSize: 31, hideOnSinglePage: true, size: "small" }}
            columns={[
              { key: "d", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
              { key: "n", dataIndex: "count", title: "تعداد", render: (v) => <span className="num">{faDigits(v)}</span> },
              { key: "v", dataIndex: "volume", title: "حجم", align: "left", render: (v) => <Money v={v} /> },
              { key: "p", dataIndex: "profit", title: "سود", align: "left", render: (v) => <Money v={v} colored /> },
              { key: "f", dataIndex: "fees", title: "کارمزد", align: "left", render: (v) => <Money v={v} zero="—" /> },
            ]}
          />
        </Section>
      ) : null}
    </div>
  );
}

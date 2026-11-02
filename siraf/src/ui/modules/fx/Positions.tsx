// Currency position and profit (موقعیت ارزی و سود): holdings per currency with average cost,
// book and market value and unrealized profit; realized profit of a period by currency and day.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Table, Tabs, Tooltip as Tip } from "antd";
import { ArrowLeftRight, ChartLine, Info, Percent, Printer, Rows3, TrendingUp, Wallet } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { Money, StatCard, EmptyState, JDate } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatCompact } from "@shared/format";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";
import { CurrencyAvatar, CurrencyName, FxAmount, KIND_FA, rateLabel } from "./shared";

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
        actions={<Button icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ</Button>}
      />
      <div className="sf-filters no-print">
        <span className="text-[13px] text-ink-3">موجودی تا</span>
        <DateInput value={date} onChange={setDate} className="!w-36" />
        <span className="sf-sep" aria-hidden />
        <span className="text-[13px] text-ink-3">سود محقق‌شده از</span>
        <DateInput value={from} onChange={setFrom} className="!w-36" />
        <span className="text-[13px] text-ink-3">تا</span>
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
        <div className="text-lg font-semibold">{org.name}</div>
        <div>موقعیت ارزی تا {formatJalali(date)}</div>
      </div>
      <div className="mb-4 grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="ارزش دفتری ارزها" value={<Money v={p?.totals.book_value ?? 0} unit />} icon={<Ic icon={Wallet} />} />
        <StatCard title="ارزش روز (نرخ تابلو)" value={<Money v={p?.totals.market_value ?? 0} unit />} icon={<Ic icon={ChartLine} />} />
        <StatCard title="سود (زیان) تحقق‌نیافته" value={<Money v={p?.totals.unrealized ?? 0} unit />} icon={<Ic icon={TrendingUp} />} hint="ارزش روز − ارزش دفتری" />
        <StatCard
          title="سود محقق‌شده‌ی دوره"
          value={<Money v={D(p?.realized.profit ?? 0).plus(D(p?.realized.fees ?? 0)).toFixed()} unit />}
          icon={<Ic icon={Percent} />}
         
          hint={p ? <>معاملات <Money v={p.realized.profit} />، کارمزد <Money v={p.realized.fees} />{!D(p.realized.revaluation).isZero() ? <>، تسعیر <Money v={p.realized.revaluation} /></> : null}</> : null}
        />
      </div>
      {p?.totals.missing_rates?.length ? <div className="sf-inline no-print mb-4" data-tone="warning"><i className="sf-nuqta" aria-hidden /><span><b>نرخ ندارد.</b> ارزش روز این ارزها حساب نشد: {p.totals.missing_rates.join("، ")}</span></div> : null}
      <Tabs
        items={[
          {
            key: "pos",
            label: "موقعیت ارزها",
            children: (
              <Section bodyClass="p-0">
                <Table
                  className="print-sheet"
                  size="small"
                  rowKey="currency_id"
                  loading={pos.isLoading}
                  dataSource={p?.rows ?? []}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  locale={{ emptyText: <EmptyState title="موجودی ارزی ثبت نشده است" /> }}
                  expandable={{
                    rowExpandable: (r: any) => r.legs.length > 0 || !D(r.customers_net ?? 0).isZero() || !D(r.correspondents_net ?? 0).isZero(),
                    expandedRowRender: (r: any) => (
                      <div className="sf-pos-legs">
                        {r.legs.map((l: any) => (
                          <div key={`${l.key}-${l.detail_id}`} className="r">
                            <span className="k">{LEG_FA[l.key] ?? l.key}</span>
                            <span className="nm">{l.name ?? "—"}</span>
                            <FxAmount v={l.fx} code={r.code} dp={r.decimals} />
                            <span className="b"><Money v={l.base} /></span>
                          </div>
                        ))}
                        {!D(r.customers_net ?? 0).isZero() ? (
                          <div className="r">
                            <span className="k">مشتریان</span>
                            <span className="nm">{D(r.customers_net).gt(0) ? "طلب از مشتریان" : "بدهی به مشتریان"}</span>
                            <FxAmount v={D(r.customers_net).abs().toFixed()} code={r.code} dp={r.decimals} />
                            <span className="b" />
                          </div>
                        ) : null}
                        {!D(r.correspondents_net ?? 0).isZero() ? (
                          <div className="r">
                            <span className="k">همکاران</span>
                            <span className="nm">{D(r.correspondents_net).gt(0) ? "طلب از همکاران" : "بدهی به همکاران"}</span>
                            <FxAmount v={D(r.correspondents_net).abs().toFixed()} code={r.code} dp={r.decimals} />
                            <span className="b" />
                          </div>
                        ) : null}
                      </div>
                    ),
                  }}
                  columns={[
                    { key: "c", title: "ارز", render: (_, r: any) => <span className="sf-pos-cur"><CurrencyAvatar code={r.code} size="sm" /><span>{r.name}</span></span> },
                    { key: "h", title: "موجودی", className: "sf-num", render: (_, r: any) => <FxAmount v={r.holdings} dp={r.decimals} strong /> },
                    { key: "avg", title: "میانگین بها", className: "sf-num", render: (_, r: any) => <span className="sf-num">{r.avg_cost ? rateLabel(r.avg_cost, baseDp) : "—"}</span> },
                    { key: "book", title: "ارزش دفتری", className: "sf-num", render: (_, r: any) => <Money v={r.book_value} /> },
                    { key: "rate", title: "نرخ روز", className: "sf-num", render: (_, r: any) => <span className="sf-num text-ink-3">{r.market_rate ? rateLabel(r.market_rate, baseDp) : "—"}</span> },
                    { key: "mv", title: "ارزش روز", className: "sf-num", render: (_, r: any) => (r.market_value ? <Money v={r.market_value} /> : <span className="sf-zero">—</span>) },
                    { key: "un", title: "تحقق‌نیافته", className: "sf-num", render: (_, r: any) => (r.unrealized ? <Money v={r.unrealized} zero="—" /> : <span className="sf-zero">—</span>) },
                    {
                      key: "exp",
                      title: (
                        <Tip title="موجودی (صندوق‌ها، بانک‌ها و کیف‌پول‌های ارزی) به‌اضافه‌ی طلب از مشتریان و همکاران، منهای بدهی به آن‌ها. میانگین بها = ارزش دفتری ÷ موجودی.">
                          <span className="inline-flex items-center gap-1">موقعیت خالص<Ic icon={Info} size={14} className="text-ink-3" /></span>
                        </Tip>
                      ),
                      className: "sf-num",
                      render: (_, r: any) => <FxAmount v={r.exposure} dp={r.decimals} strong />,
                    },
                  ]}
                  summary={(rows) =>
                    rows.length ? (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={4}>جمع</Table.Summary.Cell>
                        <Table.Summary.Cell index={4} className="sf-num"><Money v={p?.totals.book_value ?? 0} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={5} />
                        <Table.Summary.Cell index={6} className="sf-num"><Money v={p?.totals.market_value ?? 0} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={7} className="sf-num"><Money v={p?.totals.unrealized ?? 0} /></Table.Summary.Cell>
                        <Table.Summary.Cell index={8} />
                      </Table.Summary.Row>
                    ) : null
                  }
                />
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
      <div className="grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="تعداد معاملات" icon={<Ic icon={Rows3} />} value={faDigits(data?.totals.count ?? 0)} />
        <StatCard title="حجم معاملات" icon={<Ic icon={ArrowLeftRight} />} value={<Money v={data?.totals.volume ?? 0} unit />} />
        <StatCard title="سود معاملات" icon={<Ic icon={TrendingUp} />} value={<Money v={data?.totals.profit ?? 0} unit />} />
        <StatCard title="درآمد کارمزد" icon={<Ic icon={Percent} />} value={<Money v={data?.totals.fees ?? 0} unit />} />
      </div>
      {chart.length > 1 ? (
        <Section title="سود روزانه">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={chart} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="var(--sf-chart-grid)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--sf-text-3)" }} tickLine={false} axisLine={{ stroke: "var(--sf-chart-axis)" }} reversed />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 12, fill: "var(--sf-text-3)" }} tickLine={false} axisLine={false} orientation="right" width={64} />
                <Tooltip
                  cursor={{ fill: "var(--sf-hover)" }}
                  formatter={(v, k) => [formatCompact(Number(v)), k === "profit" ? "سود معامله" : "کارمزد"]}
                  contentStyle={{ background: "var(--sf-raised)", border: 0, borderRadius: 8, boxShadow: "var(--sf-shadow-e3)", direction: "rtl", fontSize: 13 }}
                  labelStyle={{ color: "var(--sf-text-3)", fontSize: 12 }}
                />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-[12px] text-ink-2">{v === "profit" ? "سود معامله" : "کارمزد"}</span>} />
                <Bar dataKey="profit" stackId="a" fill="var(--sf-accent-line)" maxBarSize={24} animationDuration={500} />
                <Bar dataKey="fees" stackId="a" fill="var(--sf-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      ) : null}
      <Section title="به تفکیک ارز" bodyClass="p-0">
        <Table
          className=""
          size="small"
          rowKey="currency_id"
          loading={loading}
          dataSource={data?.by_currency ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState title="در این دوره معامله‌ای ثبت نشده است" /> }}
          columns={[
            { key: "c", title: "ارز", render: (_, r: any) => <CurrencyName c={{ code: r.code, name: r.name }} /> },
            { key: "bc", title: "خرید (تعداد)", align: "center", render: (_, r: any) => <span className="sf-num">{faDigits(r.buy_count)}</span> },
            { key: "b", title: "مقدار خرید", className: "sf-num", render: (_, r: any) => <FxAmount v={r.bought} dp={r.decimals} /> },
            { key: "ab", title: "میانگین نرخ خرید", className: "sf-num", render: (_, r: any) => <span className="sf-num text-ink-3">{r.avg_buy ? rateLabel(r.avg_buy, baseDp) : "—"}</span> },
            { key: "sc", title: "فروش (تعداد)", align: "center", render: (_, r: any) => <span className="sf-num">{faDigits(r.sell_count)}</span> },
            { key: "s", title: "مقدار فروش", className: "sf-num", render: (_, r: any) => <FxAmount v={r.sold} dp={r.decimals} /> },
            { key: "as", title: "میانگین نرخ فروش", className: "sf-num", render: (_, r: any) => <span className="sf-num text-ink-3">{r.avg_sell ? rateLabel(r.avg_sell, baseDp) : "—"}</span> },
            { key: "x", title: "تبدیل (ورود/خروج)", className: "sf-num", render: (_, r: any) => <span><FxAmount v={r.exchange_in} dp={r.decimals} /><span className="sf-sep" aria-hidden /><FxAmount v={r.exchange_out} dp={r.decimals} /></span> },
            { key: "cost", title: "بهای تمام‌شده", className: "sf-num", render: (_, r: any) => <Money v={r.cost} /> },
            { key: "p", title: "سود", className: "sf-num", render: (_, r: any) => <Money v={r.profit} /> },
            { key: "f", title: "کارمزد", className: "sf-num", render: (_, r: any) => <Money v={r.fees} zero="—" /> },
          ]}
        />
      </Section>
      <Section title="به تفکیک نوع معامله" bodyClass="p-0">
        <Table
          className=""
          size="small"
          rowKey="kind"
          dataSource={data?.by_kind ?? []}
          pagination={false}
          columns={[
            { key: "k", dataIndex: "kind", title: "نوع", render: (v) => KIND_FA[v] ?? v },
            { key: "n", dataIndex: "count", title: "تعداد", render: (v) => <span className="sf-num">{faDigits(v)}</span> },
            { key: "v", dataIndex: "volume", title: "حجم", className: "sf-num", render: (v) => <Money v={v} /> },
            { key: "p", dataIndex: "profit", title: "سود", className: "sf-num", render: (v) => <Money v={v} /> },
            { key: "f", dataIndex: "fees", title: "کارمزد", className: "sf-num", render: (v) => <Money v={v} zero="—" /> },
          ]}
        />
      </Section>
      {(data?.by_day ?? []).length ? (
        <Section title="به تفکیک روز" bodyClass="p-0">
          <Table
            className=""
            size="small"
            rowKey="date"
            dataSource={[...(data?.by_day ?? [])].reverse()}
            pagination={{ pageSize: 31, hideOnSinglePage: true, size: "small" }}
            columns={[
              { key: "d", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
              { key: "n", dataIndex: "count", title: "تعداد", render: (v) => <span className="sf-num">{faDigits(v)}</span> },
              { key: "v", dataIndex: "volume", title: "حجم", className: "sf-num", render: (v) => <Money v={v} /> },
              { key: "p", dataIndex: "profit", title: "سود", className: "sf-num", render: (v) => <Money v={v} /> },
              { key: "f", dataIndex: "fees", title: "کارمزد", className: "sf-num", render: (v) => <Money v={v} zero="—" /> },
            ]}
          />
        </Section>
      ) : null}
    </div>
  );
}

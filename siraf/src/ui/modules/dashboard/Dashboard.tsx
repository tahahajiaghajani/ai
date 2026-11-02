import { useQuery } from "@tanstack/react-query";
import { Button, Spin, Table, Tag, Empty } from "antd";
import { WalletOutlined, BankOutlined, RiseOutlined, FallOutlined, UserOutlined, ShopOutlined, PlusOutlined, FileTextOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { PageHeader, Section } from "../../components/layout";
import { StatCard, Money, JDate, StatusTag } from "../../components/display";
import { formatCompact, faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { D } from "@shared/money";
import { getWidgets } from "./widgets";
import "./register";

export default function Dashboard() {
  const { api, org, orgId, has, can } = useOrg();
  const { me } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["dashboard", orgId], queryFn: () => api.get("/dashboard"), refetchInterval: 60_000 });
  const d = q.data;
  const hour = new Date().getHours();
  const hello = hour < 12 ? "صبح بخیر" : hour < 17 ? "روز بخیر" : "عصر بخیر";
  const widgets = getWidgets().filter((w) => !w.module || has(w.module));
  return (
    <div>
      <PageHeader
        title={`${hello}، ${me?.user.full_name?.split(" ")[0] ?? ""}`}
        subtitle={d ? `${formatJalali(d.today, { style: "full" })} · ${org.name}` : org.name}
        actions={
          <>
            {can("accounting", "edit") ? <Button icon={<FileTextOutlined />} onClick={() => nav(`/${orgId}/accounting/vouchers/new`)}>سند جدید</Button> : null}
            {has("goods") && can("sales", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/sales/invoices/new`)}>فاکتور فروش</Button> : null}
            {has("gold") && can("gold", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/gold/sale/new`)}>فروش طلا</Button> : null}
            {has("fx") && can("fx", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/fx/deals/new`)}>معامله‌ی ارز</Button> : null}
          </>
        }
      />
      {q.isLoading || !d ? (
        <div className="grid h-64 place-content-center"><Spin /></div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="موجودی صندوق‌ها" value={<Money v={d.totals.cash} />} icon={<WalletOutlined />} onClick={() => nav(`/${orgId}/treasury/cash-boxes`)} />
            <StatCard title="موجودی بانک‌ها" value={<Money v={d.totals.bank} />} icon={<BankOutlined />} onClick={() => nav(`/${orgId}/treasury/bank-accounts`)} />
            <StatCard title="طلب از مشتریان" value={<Money v={d.totals.receivable} />} hint={!D(d.totals.cheques_receivable).isZero() ? <>چک‌های دریافتنی: <Money v={d.totals.cheques_receivable} /></> : null} icon={<UserOutlined />} tone="gold" onClick={() => nav(`/${orgId}/reports/detail-balances`)} />
            <StatCard title="بدهی به تأمین‌کنندگان" value={<Money v={d.totals.payable} />} hint={!D(d.totals.cheques_payable).isZero() ? <>چک‌های پرداختنی: <Money v={d.totals.cheques_payable} /></> : null} icon={<ShopOutlined />} tone="bad" />
          </div>
          <div className="mb-4 grid gap-3 lg:grid-cols-3">
            <Section title="درآمد و هزینه‌ی شش ماه اخیر" className="lg:col-span-2">
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={d.trend.map((t: any) => ({ ...t, income: Number(t.income), expense: Number(t.expense) }))} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--tz-line)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--tz-muted)" }} reversed />
                    <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fontSize: 10, fill: "var(--tz-muted)" }} orientation="right" width={80} />
                    <Tooltip formatter={(v) => formatCompact(Number(v))} contentStyle={{ fontFamily: "Vazirmatn", borderRadius: 8, direction: "rtl" }} />
                    <Legend formatter={(v) => (v === "income" ? "درآمد" : "هزینه")} />
                    <Bar dataKey="income" fill="#0e7490" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="expense" fill="#b8862f" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <div className="grid gap-3">
              <StatCard title="درآمد این ماه" value={<Money v={d.totals.income_month} />} icon={<RiseOutlined />} tone="ok" />
              <StatCard title="هزینه‌ی این ماه" value={<Money v={d.totals.expense_month} />} icon={<FallOutlined />} tone="bad" />
              <StatCard title="سود سال مالی تا امروز" value={<Money v={D(d.totals.income_year).minus(D(d.totals.expense_year)).toString()} colored />} icon={<RiseOutlined />} />
            </div>
          </div>
          {widgets.length ? <div className="mb-4 grid gap-3 lg:grid-cols-2">{widgets.map((w) => <div key={w.key}>{w.render()}</div>)}</div> : null}
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="چک‌های سررسید دو هفته‌ی آینده" extra={<Button size="small" type="link" onClick={() => nav(`/${orgId}/treasury/cheques`)}>همه</Button>} bodyClass="p-0">
              {d.cheques.length ? (
                <Table
                  className="tz-table"
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={d.cheques}
                  columns={[
                    { key: "due", dataIndex: "due_date", title: "سررسید", render: (v) => <JDate v={v} /> },
                    { key: "dir", dataIndex: "direction", title: "نوع", render: (v) => <Tag variant="filled" color={v === "received" ? "cyan" : "gold"}>{v === "received" ? "دریافتی" : "پرداختی"}</Tag> },
                    { key: "party", dataIndex: "party_name", title: "شخص" },
                    { key: "amount", dataIndex: "amount", title: "مبلغ", align: "left", render: (v) => <Money v={v} /> },
                    { key: "st", dataIndex: "status", title: "وضعیت", render: (v) => <StatusTag s={v} /> },
                  ]}
                />
              ) : (
                <Empty className="!py-8" image={Empty.PRESENTED_IMAGE_SIMPLE} description="چک سررسیدشده‌ای نیست" />
              )}
            </Section>
            <Section title="آخرین اسناد" extra={<Button size="small" type="link" onClick={() => nav(`/${orgId}/accounting/vouchers`)}>همه</Button>} bodyClass="p-0">
              <Table
                className="tz-table"
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={d.recent}
                onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/accounting/vouchers/${r.id}`), style: { cursor: "pointer" } })}
                locale={{ emptyText: "هنوز سندی ثبت نشده" }}
                columns={[
                  { key: "no", dataIndex: "no", title: "سند", render: (v) => <b className="num">{faDigits(v)}</b> },
                  { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
                  { key: "desc", dataIndex: "description", title: "شرح", ellipsis: true },
                  { key: "amt", dataIndex: "total_debit", title: "مبلغ", align: "left", render: (v) => <Money v={v} /> },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

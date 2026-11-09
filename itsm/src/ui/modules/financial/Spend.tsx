// «هزینه‌های فناوری اطلاعات» (catalogue FIN-039/040): the fiscal year's IT spend from the cost ledger — total, CapEx and
// OpEx, by month, cost type, source (purchases, depreciation, contracts, subscriptions, licences, repairs…), supplier
// and service. Money needs the financial field group.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, Table } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Receipt } from "lucide-react";
import { formatRial } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader, StatCard } from "../../components/display";
import { Money, useMoneyUnit } from "../itam/parts";
import { financialApi, FINANCIAL_KEYS } from "../supplier/api";

export default function Spend() {
  const { api, orgId } = useOrg();
  const unit = useMoneyUnit();
  const meta = useQuery({ queryKey: FINANCIAL_KEYS.meta(orgId), queryFn: () => financialApi.meta(api), staleTime: 300_000 });
  const [year, setYear] = useState<number | null>(null);
  const y = year ?? meta.data?.current_year ?? null;
  const q = useQuery({ queryKey: FINANCIAL_KEYS.spend(orgId, y ?? 0), queryFn: () => financialApi.spend(api, y!), enabled: !!y });
  const d = q.data;
  const table = (title: string, rows: { key: string; name: string; amount: string }[]) => (
    <Card title={title} flush>
      <Table rowKey="key" size="small" pagination={{ pageSize: 10, hideOnSinglePage: true }} dataSource={rows} columns={[
        { title: "", dataIndex: "name", key: "name" },
        { title: "مبلغ", dataIndex: "amount", key: "amount", width: 180, render: (v: string) => <Money v={v} /> },
      ]} />
    </Card>
  );
  return (
    <div>
      <PageHeader title="هزینه‌های فناوری اطلاعات" actions={<Select aria-label="سال مالی" value={y ?? undefined} onChange={setYear} style={{ minWidth: 140 }} options={(meta.data?.years ?? []).map((x) => ({ value: x.year, label: x.name }))} />} />
      {q.isLoading || meta.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="دادهٔ مالی در دسترس نیست" description="نمای هزینه‌ها گروه فیلد «مالی» لازم دارد." icon={Receipt} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles">
            <StatCard title={`هزینهٔ سال ${faDigits(d.year)}`} value={<Money v={d.total} compact />} />
            <StatCard title="سرمایه‌ای (CapEx)" value={<Money v={d.capex} compact />} />
            <StatCard title="جاری (OpEx)" value={<Money v={d.opex} compact />} />
          </div>
          <Card title="ماه به ماه">
            <div style={{ height: 220 }} dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.by_month.map((m) => ({ label: m.label, amount: Number(m.amount) }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--ds-line)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} />
                  <YAxis width={70} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => formatRial(String(v), unit, { suffix: false, compact: true })} />
                  <Tooltip formatter={(v) => [formatRial(String(v), unit), "هزینه"]} />
                  <Bar dataKey="amount" fill="var(--ds-chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <div className="itam-two">
            {table("بر پایهٔ نوع هزینه", d.by_type.map((x) => ({ key: x.id, name: x.name, amount: x.amount })))}
            {table("بر پایهٔ منبع", d.by_source.map((x) => ({ key: x.source, name: x.label, amount: x.amount })))}
            {table("بر پایهٔ تأمین‌کننده", d.by_supplier.map((x) => ({ key: x.id, name: x.name, amount: x.amount })))}
            {table("بر پایهٔ خدمت", d.by_service.map((x) => ({ key: x.id, name: x.name, amount: x.amount })))}
          </div>
        </div>
      )}
    </div>
  );
}

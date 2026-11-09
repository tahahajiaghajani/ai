// «بودجه و هزینهٔ واقعی» (catalogue FIN-010/012/013): the fiscal year's approved budgets against the costs posted, per
// cost centre or unit — used share, variance and status — opened by cost type and by Jalali month, the variance
// narrative (AI over the server's decomposition, or rule-based without a model), and cost capture now for IT finance.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Select, Space, Table } from "antd";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw, Sparkles, Wallet } from "lucide-react";
import type { BvaPayload } from "@shared/financial/api";
import { formatRial } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { JALALI_MONTHS } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { RecordMarkdown } from "../../records";
import { AiLabel, ICON, Meter, Money } from "../itam/parts";
import { financialApi, FINANCIAL_KEYS, type AiText } from "../supplier/api";

type Row = BvaPayload["rows"][number];
const STATUS: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = { under: ["در محدوده", "in"], near: ["نزدیک سقف", "warning"], over: ["بیش از بودجه", "danger"], unbudgeted: ["بدون بودجه", "neutral"] };

export default function BudgetVsActual() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: FINANCIAL_KEYS.meta(orgId), queryFn: () => financialApi.meta(api), staleTime: 300_000 });
  const [year, setYear] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number]>([1, 12]);
  const y = year ?? meta.data?.current_year ?? null;
  const query = { year: y ?? 0, from: range[0], to: range[1] };
  const q = useQuery({ queryKey: FINANCIAL_KEYS.bva(orgId, query), queryFn: () => financialApi.bva(api, query), enabled: !!y });
  const [story, setStory] = useState<AiText | null>(null);
  const narrate = useMutation({ mutationFn: () => financialApi.narrative(api, y!, null), onSuccess: setStory, onError: (e: Error) => message.error(e.message) });
  const capture = useMutation({
    mutationFn: () => financialApi.capture(api),
    onSuccess: (r) => {
      message.success(`${fa(r.created)} هزینه برای ${r.period} ثبت شد`);
      qc.invalidateQueries({ queryKey: ["financial", orgId] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const d = q.data;
  const unit = d?.unit ?? "rial";
  const money = (v: string) => <Money v={v} />;
  const tile = (v: string) => <Money v={v} compact />;
  const chart = d ? d.rows.slice(0, 10).map((r) => ({ name: r.name, budget: Number(r.budget), actual: Number(r.actual) })) : [];
  const months = JALALI_MONTHS.map((m, i) => ({ value: i + 1, label: m }));
  return (
    <div>
      <PageHeader
        title="بودجه و هزینهٔ واقعی"
        actions={
          <Space wrap>
            <Select aria-label="سال مالی" value={y ?? undefined} onChange={setYear} style={{ minWidth: 140 }} options={(meta.data?.years ?? []).map((x) => ({ value: x.year, label: x.name }))} />
            <Select aria-label="از ماه" value={range[0]} onChange={(v) => setRange([v, Math.max(v, range[1])])} options={months} style={{ minWidth: 110 }} />
            <Select aria-label="تا ماه" value={range[1]} onChange={(v) => setRange([Math.min(range[0], v), v])} options={months} style={{ minWidth: 110 }} />
            <Button icon={<Sparkles {...ICON} />} loading={narrate.isPending} disabled={!d} onClick={() => narrate.mutate()}>روایت انحراف</Button>
            {meta.data?.can_manage ? <Button icon={<RefreshCw {...ICON} />} loading={capture.isPending} onClick={() => capture.mutate()}>ثبت هزینه‌های این ماه</Button> : null}
          </Space>
        }
      />
      {q.isLoading || meta.isLoading ? (
        <Loader />
      ) : !d ? (
        <EmptyState title="دادهٔ مالی در دسترس نیست" description="مقایسهٔ بودجه با هزینه گروه فیلد «مالی» لازم دارد." icon={Wallet} />
      ) : !d.rows.length ? (
        <EmptyState title="بودجهٔ مصوب یا هزینه‌ای برای این بازه نیست" icon={Wallet} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles">
            <StatCard title="بودجه" value={tile(d.total.budget)} />
            <StatCard title="هزینهٔ واقعی" value={tile(d.total.actual)} />
            <StatCard title="باقی‌مانده" value={tile(d.total.variance)} />
            <StatCard title="مصرف بودجه" value={d.total.used_pct === null ? "—" : `${faDigits(d.total.used_pct)}٪`} hint={`${fa(d.budgets)} بودجهٔ مصوب`} />
          </div>
          {story ? (
            <Card title="روایت انحراف بودجه">
              <RecordMarkdown text={story.text} />
              <AiLabel ai={story.ai} model={story.model} />
            </Card>
          ) : null}
          <Card title="بودجه در برابر هزینه">
            <div style={{ height: 240 }} dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--ds-line)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} interval={0} />
                  <YAxis width={70} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => formatRial(String(v), unit, { suffix: false, compact: true })} />
                  <Tooltip formatter={(v, n) => [formatRial(String(v), unit), n === "budget" ? "بودجه" : "هزینه"]} />
                  <Legend formatter={(v) => (v === "budget" ? "بودجه" : "هزینهٔ واقعی")} />
                  <Bar dataKey="budget" fill="var(--ds-chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="actual" fill="var(--ds-chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="به تفکیک مرکز هزینه" flush>
            <Table
              rowKey="cost_center_id"
              size="small"
              pagination={false}
              dataSource={d.rows}
              scroll={{ x: 900 }}
              expandable={{
                expandedRowRender: (r: Row) => (
                  <div className="itam-two">
                    <Table rowKey="cost_type_id" size="small" pagination={false} dataSource={r.by_type} columns={[
                      { title: "نوع هزینه", dataIndex: "name", key: "name" },
                      { title: "بودجه", dataIndex: "budget", key: "budget", render: money },
                      { title: "واقعی", dataIndex: "actual", key: "actual", render: money },
                      { title: "مصرف", dataIndex: "used_pct", key: "used", render: (v: number | null) => <Meter pct={v} /> },
                    ]} />
                    <Table rowKey="period_key" size="small" pagination={false} dataSource={r.by_month.filter((m) => m.budget !== "0" || m.actual !== "0")} columns={[
                      { title: "ماه", dataIndex: "label", key: "label" },
                      { title: "بودجه", dataIndex: "budget", key: "budget", render: money },
                      { title: "واقعی", dataIndex: "actual", key: "actual", render: money },
                    ]} />
                  </div>
                ),
              }}
              columns={[
                { title: "مرکز هزینه یا واحد", dataIndex: "name", key: "name" },
                { title: "بودجه", dataIndex: "budget", key: "budget", render: money },
                { title: "هزینهٔ واقعی", dataIndex: "actual", key: "actual", render: money },
                { title: "باقی‌مانده", dataIndex: "variance", key: "variance", render: money },
                { title: "مصرف", dataIndex: "used_pct", key: "used", width: 160, render: (v: number | null) => <Meter pct={v} /> },
                { title: "وضعیت", dataIndex: "status", key: "status", width: 130, render: (v: string) => <Chip tone={STATUS[v][1]}>{STATUS[v][0]}</Chip> },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

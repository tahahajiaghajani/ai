// Exchange deals list with filters (period, kind, status, currency, customer) and totals.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Segmented, Select, Space, Tag } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { DateInput, PartySelect } from "../../components/inputs";
import { Money, JDate, StatusTag, StatCard } from "../../components/display";
import { faDigits } from "@shared/format";
import { presetRange } from "@shared/jalali";
import { CurrencyPick, DEAL_STATUS, FxAmount, KIND_COLOR, KIND_FA, rateLabel, useBoard } from "./shared";

export default function Deals() {
  const { orgId, api, can, org, unit } = useOrg();
  const nav = useNavigate();
  const board = useBoard();
  const month = presetRange("month");
  const [from, setFrom] = useState<string | null>(month.from);
  const [to, setTo] = useState<string | null>(month.to);
  const [kind, setKind] = useState<string>("");
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [currency, setCurrency] = useState<string | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const params = { from, to, kind: kind || undefined, status, currency_id: currency, party_id: party, q: dq };
  const sums = useQuery({ queryKey: ["table", "fx-deals-sums", params], queryFn: () => api.get("/fx/deals", { ...params, size: 1 }) });
  const baseDp = org.money_decimals ?? 0;
  const dpOf = (code: string, decimals: number) => (code === org.base_currency ? baseDp : Number(decimals ?? 2));
  const codeOf = (code: string) => (code === org.base_currency ? unit : code);

  return (
    <div>
      <PageHeader
        title="معاملات ارز"
        actions={can("fx", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/fx/deals/new`)}>معامله‌ی جدید</Button> : null}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="تعداد معاملات" value={faDigits(sums.data?.total ?? 0)} tone="muted" />
        <StatCard title="حجم معاملات" value={<Money v={sums.data?.sums?.volume ?? 0} unit />} />
        <StatCard title="سود معاملات" value={<Money v={sums.data?.sums?.profit ?? 0} colored />} tone="ok" />
        <StatCard title="درآمد کارمزد" value={<Money v={sums.data?.sums?.fees ?? 0} />} tone="gold" />
      </div>
      <div className="tz-card p-3 md:p-4">
        <ServerTable
          path="/fx/deals"
          params={params}
          queryKey={["table", "fx-deals"]}
          onRowClick={(r: any) => nav(`/${orgId}/fx/deals/${r.id}`)}
          rowClassName={(r: any) => (r.status === "cancelled" ? "row-muted" : "")}
          exportName="معاملات ارز"
          exportColumns={[
            { title: "شماره", value: (r: any) => r.no, type: "number" },
            { title: "تاریخ", value: (r: any) => r.date },
            { title: "نوع", value: (r: any) => KIND_FA[r.kind] },
            { title: "مشتری", value: (r: any) => r.customer_name ?? "" },
            { title: "ارز دریافتی", value: (r: any) => r.in_code },
            { title: "مبلغ دریافتی", value: (r: any) => r.in_amount, type: "number" },
            { title: "ارز پرداختی", value: (r: any) => r.out_code },
            { title: "مبلغ پرداختی", value: (r: any) => r.out_amount, type: "number" },
            { title: "نرخ", value: (r: any) => r.rate, type: "number" },
            { title: "ارزش", value: (r: any) => r.base_value, type: "number" },
            { title: "سود", value: (r: any) => r.profit, type: "number" },
            { title: "کارمزد", value: (r: any) => r.fee_base, type: "number" },
            { title: "وضعیت", value: (r: any) => DEAL_STATUS[r.status]?.[0] ?? r.status },
          ]}
          toolbar={
            <Space wrap>
              <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" className="!w-36" allowClear />
              <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" className="!w-36" allowClear />
              <Segmented size="small" value={kind} onChange={(v) => setKind(String(v))} options={[{ value: "", label: "همه" }, { value: "buy", label: "خرید" }, { value: "sell", label: "فروش" }, { value: "exchange", label: "تبدیل" }]} />
              <Select allowClear placeholder="وضعیت" className="!w-32" value={status} onChange={setStatus} options={Object.entries(DEAL_STATUS).map(([value, [label]]) => ({ value, label }))} />
              <CurrencyPick currencies={(board.data?.currencies ?? []).filter((c) => !c.is_base)} value={currency} onChange={setCurrency} allowClear className="!w-36" />
              <PartySelect value={party} onChange={(id) => setParty(id)} allowClear className="!w-44" />
              <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="شماره، نام، TxID…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-44" />
            </Space>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "ش", width: 60, render: (v) => <b className="num">{faDigits(v)}</b> },
            { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
            { key: "kind", dataIndex: "kind", title: "نوع", render: (v) => <Tag color={KIND_COLOR[v]} variant="filled" className="!m-0">{KIND_FA[v]}</Tag> },
            { key: "customer", dataIndex: "customer_name", title: "مشتری", render: (v) => v ?? <span className="text-muted">گذری</span> },
            { key: "in", title: "دریافت از مشتری", align: "left", render: (_, r: any) => <FxAmount v={r.in_amount} code={codeOf(r.in_code)} dp={dpOf(r.in_code, r.in_decimals)} /> },
            { key: "out", title: "پرداخت به مشتری", align: "left", render: (_, r: any) => <FxAmount v={r.out_amount} code={codeOf(r.out_code)} dp={dpOf(r.out_code, r.out_decimals)} /> },
            { key: "rate", dataIndex: "rate", title: "نرخ", align: "left", render: (v, r: any) => <span className="num text-muted">{r.kind === "exchange" ? rateLabel(v) : rateLabel(v, baseDp)}</span> },
            { key: "profit", dataIndex: "profit", title: "سود", align: "left", render: (v, r: any) => (r.kind === "buy" ? <span className="text-muted">—</span> : <Money v={v ?? 0} colored />) },
            { key: "fee", dataIndex: "fee_base", title: "کارمزد", align: "left", render: (v) => <Money v={v ?? 0} zero="—" /> },
            { key: "status", dataIndex: "status", title: "وضعیت", render: (v) => <StatusTag s={v} map={DEAL_STATUS} /> },
          ]}
        />
      </div>
    </div>
  );
}

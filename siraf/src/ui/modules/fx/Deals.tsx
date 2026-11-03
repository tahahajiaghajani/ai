// Exchange deals list with filters (period, kind, status, currency, customer) and totals.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Segmented, Select, Space, Tag } from "antd";
import { ArrowLeftRight, Percent, Plus, Rows3, Search, TrendingUp } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { DateInput, PartySelect } from "../../components/inputs";
import { Money, JDate, StatusTag, StatCard } from "../../components/display";
import { faDigits } from "@shared/format";
import { presetRange } from "@shared/jalali";
import { CurrencyPick, DEAL_STATUS, FxAmount, KIND_FA, rateLabel, useBoard } from "./shared";

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
        actions={can("fx", "edit") ? <Button type="primary" icon={<Ic icon={Plus} />} onClick={() => nav(`/${orgId}/fx/deals/new`)}>معامله‌ی جدید</Button> : null}
      />
      <div className="mb-4 grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="تعداد معاملات" icon={<Ic icon={Rows3} />} value={faDigits(sums.data?.total ?? 0)} />
        <StatCard title="حجم معاملات" icon={<Ic icon={ArrowLeftRight} />} value={<Money v={sums.data?.sums?.volume ?? 0} unit />} />
        <StatCard title="سود معاملات" icon={<Ic icon={TrendingUp} />} value={<Money v={sums.data?.sums?.profit ?? 0} unit />} />
        <StatCard title="درآمد کارمزد" icon={<Ic icon={Percent} />} value={<Money v={sums.data?.sums?.fees ?? 0} unit />} />
      </div>
      <div className="sf-card">
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
              <Input allowClear prefix={<Ic icon={Search} className="text-ink-3" />} placeholder="شماره، نام، TxID…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-44" />
            </Space>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "شماره", width: 72, render: (v) => <span className="sf-docno">{faDigits(v)}</span> },
            { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
            { key: "kind", dataIndex: "kind", title: "نوع", render: (v) => <span className="text-ink-2">{KIND_FA[v]}</span> },
            { key: "customer", dataIndex: "customer_name", title: "مشتری", render: (v) => v ?? <span className="text-ink-3">مشتری گذری</span> },
            { key: "in", title: "دریافت از مشتری", className: "sf-num", render: (_, r: any) => <FxAmount v={r.in_amount} code={codeOf(r.in_code)} dp={dpOf(r.in_code, r.in_decimals)} /> },
            { key: "out", title: "پرداخت به مشتری", className: "sf-num", render: (_, r: any) => <FxAmount v={r.out_amount} code={codeOf(r.out_code)} dp={dpOf(r.out_code, r.out_decimals)} /> },
            { key: "rate", dataIndex: "rate", title: "نرخ", className: "sf-num", render: (v, r: any) => <span className="sf-num text-ink-3">{r.kind === "exchange" ? rateLabel(v) : rateLabel(v, baseDp)}</span> },
            { key: "profit", dataIndex: "profit", title: "سود", className: "sf-num", render: (v, r: any) => (r.kind === "buy" ? <span className="sf-zero">—</span> : <Money v={v ?? 0} />) },
            { key: "fee", dataIndex: "fee_base", title: "کارمزد", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
            { key: "status", dataIndex: "status", title: "وضعیت", render: (v) => <StatusTag s={v} map={DEAL_STATUS} /> },
          ]}
        />
      </div>
    </div>
  );
}

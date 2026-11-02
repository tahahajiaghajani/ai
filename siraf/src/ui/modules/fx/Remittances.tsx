// Remittances (حواله‌ها): outgoing and incoming remittances with filters, and the balances of
// every correspondent (همکار) per currency.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Segmented, Select, Space, Table, Tabs, Tooltip } from "antd";
import { ArrowLeft, FileInput, FileOutput, Plus, Search, Send } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { DateInput, PartySelect } from "../../components/inputs";
import { Chip, Money, JDate, EmptyState } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { FxAmount, REM_STATUS, RemStatus, trackNo } from "./shared";

export default function Remittances() {
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  const [tab, setTab] = useState("list");
  return (
    <div>
      <PageHeader
        title="حواله‌ها"
        actions={
          can("fx", "edit") ? (
            <>
              <Button icon={<Ic icon={FileInput} />} onClick={() => nav(`/${orgId}/fx/remittances/new?direction=in`)}>حواله‌ی وارده</Button>
              <Button type="primary" icon={<Ic icon={FileOutput} />} onClick={() => nav(`/${orgId}/fx/remittances/new?direction=out`)}>حواله‌ی صادره</Button>
            </>
          ) : null
        }
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "list", label: "فهرست حواله‌ها", children: <List /> },
          { key: "corr", label: "مانده‌ی همکاران", children: <Correspondents /> },
        ]}
      />
    </div>
  );
}

function List() {
  const { orgId, org, unit } = useOrg();
  const nav = useNavigate();
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [corr, setCorr] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const baseDp = org.money_decimals ?? 0;
  return (
    <div className="sf-card">
      <ServerTable
        path="/fx/remittances"
        queryKey={["table", "fx-remittances"]}
        params={{ direction: direction || undefined, status: status.join(",") || undefined, correspondent_id: corr, from, to, q: dq }}
        onRowClick={(r: any) => nav(`/${orgId}/fx/remittances/${r.id}`)}
        rowClassName={(r: any) => (r.status === "cancelled" || r.status === "returned" ? "row-muted" : "")}
        exportName="حواله‌ها"
        exportColumns={[
          { title: "شماره", value: (r: any) => r.no, type: "number" },
          { title: "تاریخ", value: (r: any) => r.date },
          { title: "نوع", value: (r: any) => (r.direction === "out" ? "صادره" : "وارده") },
          { title: "کد رهگیری", value: (r: any) => r.tracking_code },
          { title: "فرستنده", value: (r: any) => r.sender?.name ?? "" },
          { title: "ذی‌نفع", value: (r: any) => r.beneficiary?.name ?? "" },
          { title: "همکار", value: (r: any) => r.correspondent_name },
          { title: "ارز", value: (r: any) => r.currency_code },
          { title: "مبلغ", value: (r: any) => r.amount, type: "number" },
          { title: "معادل", value: (r: any) => r.base_amount, type: "number" },
          { title: "کارمزد", value: (r: any) => r.fee_base, type: "number" },
          { title: "وضعیت", value: (r: any) => REM_STATUS[r.status]?.[0] ?? r.status },
        ]}
        toolbar={
          <Space wrap>
            <Segmented size="small" value={direction} onChange={(v) => setDirection(String(v))} options={[{ value: "", label: "همه" }, { value: "out", label: "صادره" }, { value: "in", label: "وارده" }]} />
            <Select mode="multiple" allowClear placeholder="وضعیت" className="!min-w-40" value={status} onChange={setStatus} options={Object.entries(REM_STATUS).map(([value, [label]]) => ({ value, label }))} maxTagCount={2} />
            <PartySelect role="correspondent" value={corr} onChange={(id) => setCorr(id)} allowClear placeholder="همکار…" className="!w-48" />
            <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" className="!w-36" allowClear />
            <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" className="!w-36" allowClear />
            <Input allowClear prefix={<Ic icon={Search} className="text-ink-3" />} placeholder="کد رهگیری، نام…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-48" />
          </Space>
        }
        columns={[
          { key: "no", dataIndex: "no", title: "شماره", width: 64, render: (v) => <span className="sf-docno">{faDigits(v)}</span> },
          { key: "date", dataIndex: "date", title: "تاریخ", width: 104, render: (v) => <JDate v={v} /> },
          { key: "dir", dataIndex: "direction", title: "نوع", width: 72, render: (v) => <span className="text-ink-2">{v === "out" ? "صادره" : "وارده"}</span> },
          {
            key: "who",
            title: "فرستنده ← ذی‌نفع",
            render: (_, r: any) => (
              <div className="sf-rem-route">
                <span className="nm">
                  <span dir="auto" className="a">{r.sender?.name ?? r.party_name ?? "—"}</span>
                  <Ic icon={ArrowLeft} size={14} className="shrink-0 text-ink-3" />
                  <span dir="auto" className="b">{r.beneficiary?.name ?? "—"}</span>
                </span>
                <span className="tk">کد رهگیری <bdi dir="ltr" className="sf-num">{trackNo(r.tracking_code)}</bdi></span>
              </div>
            ),
          },
          { key: "corr", dataIndex: "correspondent_name", title: "همکار", render: (v) => <span className="sf-rem-corr" title={v}>{v}</span> },
          {
            key: "amount",
            title: "مبلغ",
            className: "sf-num",
            render: (_, r: any) => (
              <div className="sf-rem-amt">
                <FxAmount v={r.amount} code={r.currency_code === org.base_currency ? unit : r.currency_code} dp={r.currency_code === org.base_currency ? baseDp : Number(r.currency_decimals ?? 2)} strong />
                {r.currency_code !== org.base_currency ? <span className="eq"><Money v={r.base_amount ?? 0} zero="—" /><span className="sf-unit">{"\u00a0"}{unit}</span></span> : null}
              </div>
            ),
          },
          { key: "fee", dataIndex: "fee_base", title: `کارمزد (${unit})`, className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
          { key: "status", dataIndex: "status", title: "وضعیت", width: 108, render: (v) => <RemStatus s={v} /> },
        ]}
      />
    </div>
  );
}

function Correspondents() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const [date, setDate] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["fx-correspondents", date], queryFn: () => api.get("/fx/reports/correspondents", { date }) });
  const rows = q.data?.rows ?? [];
  return (
    <div className="sf-card">
      <div className="no-print flex flex-wrap items-center gap-3 px-4 pb-3.5 pt-3.5">
        <DateInput value={date} onChange={setDate} placeholder="تا تاریخ (امروز)" className="!w-40" allowClear />
        <span className="text-[12px] text-ink-3">«طلب»: همکار به ما بدهکار است؛ «بدهی»: ما به همکار بدهکاریم؛ «در جریان»: حواله‌ی صادره‌ی پرداخت‌نشده.</span>
      </div>
      <Table
        className=""
        size="small"
        rowKey="party_id"
        loading={q.isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <EmptyState icon={Send} title="همکاری ثبت نشده است" description="در پرونده‌ی شخص نقش «همکار صرافی / کارگزار» را بزنید." /> }}
        onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/parties/${r.party_id}`), style: { cursor: "pointer" } })}
        columns={[
          { key: "name", dataIndex: "name", title: "همکار", render: (v, r: any) => <span><span className="sf-docno me-2 text-ink-3">{faDigits(r.code)}</span>{v}</span> },
          {
            key: "bal",
            title: "مانده به تفکیک ارز",
            render: (_, r: any) =>
              r.currencies.length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {r.currencies.map((c: any) => (
                    <Tooltip key={c.currency_id} title={<span>معادل {faDigits(D(c.balance_base).toFixed(0))}{!D(c.in_transit).isZero() ? `، در جریان ${faDigits(D(c.in_transit).toFixed())}` : ""}</span>}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <span className="sf-cur">{c.code}</span>
                        <bdi dir="ltr" className="sf-fxa">{formatNumber(D(c.balance).abs(), { dp: 8, fa: false })}</bdi>
                        <span className="text-[12px] text-ink-3">{D(c.balance).gt(0) ? "طلب" : D(c.balance).lt(0) ? "بدهی" : ""}</span>
                        {!D(c.in_transit).isZero() ? <span className="text-[12px] text-ink-3">(در جریان <bdi dir="ltr" className="sf-fxa">{formatNumber(D(c.in_transit), { dp: 8, fa: false })}</bdi>)</span> : null}
                      </span>
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <span className="text-ink-3">تسویه</span>
              ),
          },
          {
            key: "open",
            title: "حواله‌های باز",
            render: (_, r: any) => (
              <span className="inline-flex flex-wrap gap-1.5">
                {r.open.out_pending ? <span className="sf-chip sf-chip-fig" data-tone="neutral"><i className="sf-nuqta is-sea" aria-hidden /><span>{faDigits(r.open.out_pending)} در انتظار</span></span> : null}
                {r.open.out_sent ? <span className="sf-chip sf-chip-fig" data-tone="neutral"><i className="sf-nuqta is-sea" aria-hidden /><span>{faDigits(r.open.out_sent)} در راه</span></span> : null}
                {r.open.in_pending ? <Chip tone="neutral" fig>{faDigits(r.open.in_pending)} وارده</Chip> : null}
                {!r.open.out_pending && !r.open.out_sent && !r.open.in_pending ? <span className="sf-zero">—</span> : null}
              </span>
            ),
          },
          {
            key: "go",
            width: 50,
            render: (_, r: any) => (
              <span className="sf-row-act"><Tooltip title="حواله‌ی جدید"><Button size="small" type="text" icon={<Ic icon={Plus} />} onClick={(e) => { e.stopPropagation(); nav(`/${orgId}/fx/remittances/new?direction=out&correspondent=${r.party_id}`); }} aria-label="حواله‌ی جدید" /></Tooltip></span>
            ),
          },
        ]}
      />
    </div>
  );
}

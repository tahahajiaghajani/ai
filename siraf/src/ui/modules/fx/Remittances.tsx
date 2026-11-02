// Remittances (حواله‌ها): outgoing and incoming remittances with filters, and the balances of
// every correspondent (همکار) per currency.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Segmented, Select, Space, Table, Tabs, Tag, Tooltip } from "antd";
import { PlusOutlined, SearchOutlined, ExportOutlined, ImportOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { DateInput, PartySelect } from "../../components/inputs";
import { Money, JDate, StatusTag, EmptyState } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { FxAmount, REM_STATUS } from "./shared";

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
              <Button icon={<ImportOutlined />} onClick={() => nav(`/${orgId}/fx/remittances/new?direction=in`)}>حواله‌ی وارده</Button>
              <Button type="primary" icon={<ExportOutlined />} onClick={() => nav(`/${orgId}/fx/remittances/new?direction=out`)}>حواله‌ی صادره</Button>
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
    <div className="tz-card p-3 md:p-4">
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
            <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="کد رهگیری، نام…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-48" />
          </Space>
        }
        columns={[
          { key: "no", dataIndex: "no", title: "ش", width: 60, render: (v) => <b className="num">{faDigits(v)}</b> },
          { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
          { key: "dir", dataIndex: "direction", title: "نوع", render: (v) => <Tag variant="filled" color={v === "out" ? "gold" : "cyan"} className="!m-0">{v === "out" ? "صادره" : "وارده"}</Tag> },
          { key: "track", dataIndex: "tracking_code", title: "کد رهگیری", render: (v) => <span className="num ltr">{faDigits(v ?? "")}</span> },
          { key: "who", title: "فرستنده ← ذی‌نفع", render: (_, r: any) => <span className="text-xs">{r.sender?.name ?? r.party_name ?? "—"} ← <b>{r.beneficiary?.name ?? "—"}</b></span> },
          { key: "corr", dataIndex: "correspondent_name", title: "همکار" },
          { key: "amount", title: "مبلغ", align: "left", render: (_, r: any) => <FxAmount v={r.amount} code={r.currency_code === org.base_currency ? unit : r.currency_code} dp={r.currency_code === org.base_currency ? baseDp : Number(r.currency_decimals ?? 2)} strong /> },
          { key: "base", dataIndex: "base_amount", title: "معادل", align: "left", render: (v) => <Money v={v ?? 0} /> },
          { key: "fee", dataIndex: "fee_base", title: "کارمزد", align: "left", render: (v) => <Money v={v ?? 0} zero="—" /> },
          { key: "status", dataIndex: "status", title: "وضعیت", render: (v) => <StatusTag s={v} map={REM_STATUS} /> },
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
    <div className="tz-card p-3 md:p-4">
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <DateInput value={date} onChange={setDate} placeholder="تا تاریخ (امروز)" className="!w-40" allowClear />
        <span className="text-xs text-muted">مانده‌ی مثبت: همکار به ما بدهکار است · منفی: ما به همکار بدهکاریم · «در جریان»: حواله‌های صادره‌ای که هنوز پرداخت نشده‌اند</span>
      </div>
      <Table
        className="tz-table"
        size="small"
        rowKey="party_id"
        loading={q.isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <EmptyState title="همکاری ثبت نشده است؛ در پرونده‌ی شخص نقش «همکار صرافی / کارگزار» را بزنید" /> }}
        onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/parties/${r.party_id}`), style: { cursor: "pointer" } })}
        columns={[
          { key: "name", dataIndex: "name", title: "همکار", render: (v, r: any) => <div><b>{v}</b> <span className="num text-xs text-muted">{faDigits(r.code)}</span></div> },
          {
            key: "bal",
            title: "مانده به تفکیک ارز",
            render: (_, r: any) =>
              r.currencies.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {r.currencies.map((c: any) => (
                    <Tooltip key={c.currency_id} title={<span>معادل: {faDigits(D(c.balance_base).toFixed(0))}{!D(c.in_transit).isZero() ? ` · در جریان: ${faDigits(D(c.in_transit).toFixed())}` : ""}</span>}>
                      <Tag variant="filled" color={D(c.balance).gt(0) ? "cyan" : D(c.balance).lt(0) ? "gold" : "default"} className="num !m-0">
                        <span className="ltr">{c.code}</span> {faDigits(D(c.balance).abs().toFixed())} {D(c.balance).gt(0) ? "طلب" : D(c.balance).lt(0) ? "بدهی" : ""}
                        {!D(c.in_transit).isZero() ? <span className="ms-1 text-[10px] opacity-75">(+{faDigits(D(c.in_transit).toFixed())} در جریان)</span> : null}
                      </Tag>
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <span className="text-muted">تسویه</span>
              ),
          },
          {
            key: "open",
            title: "حواله‌های باز",
            render: (_, r: any) => (
              <span className="num text-xs">
                {r.open.out_pending ? <Tag variant="filled" color="orange">{faDigits(r.open.out_pending)} در انتظار</Tag> : null}
                {r.open.out_sent ? <Tag variant="filled" color="blue">{faDigits(r.open.out_sent)} ارسال‌شده</Tag> : null}
                {r.open.in_pending ? <Tag variant="filled" color="cyan">{faDigits(r.open.in_pending)} وارده</Tag> : null}
                {!r.open.out_pending && !r.open.out_sent && !r.open.in_pending ? <span className="text-muted">—</span> : null}
              </span>
            ),
          },
          {
            key: "go",
            width: 50,
            render: (_, r: any) => (
              <Button size="small" type="text" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); nav(`/${orgId}/fx/remittances/new?direction=out&correspondent=${r.party_id}`); }} aria-label="حواله‌ی جدید" />
            ),
          },
        ]}
      />
    </div>
  );
}

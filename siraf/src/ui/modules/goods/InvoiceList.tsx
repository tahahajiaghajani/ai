// List of one kind of commercial document (sales invoices, returns, quotes, orders, purchases)
// with search, date range, status, party and "unsettled only" filters and Excel export.
import { useState } from "react";
import { Button, Input, Select, Space, Switch } from "antd";
import { Plus, Search } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { JDate, Money } from "../../components/display";
import { DateInput, PartySelect } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { INVOICE_META, INVOICE_STATUS, type InvoiceKind } from "./labels";
import { InvoiceStatus } from "./components";

export default function InvoiceList({ kind }: { kind: InvoiceKind }) {
  const meta = INVOICE_META[kind];
  const { api, fy, orgId, can } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q);
  const params = { kind, fiscal_year_id: fy?.id, q: dq, status, from, to, party_id: partyId, open: open ? "1" : undefined };
  const sum = useQuery({
    queryKey: ["table", "goods-invoices-sum", params],
    queryFn: () => api.get("/goods/invoices", { ...params, size: 1 }).then((r) => ({ total: r.sum_total as string, count: r.total as number })),
  });
  const settleLabel = meta.settle === "receipt" ? "دریافت‌شده" : "پرداخت‌شده";
  return (
    <div>
      <PageHeader
        title={meta.plural}
        subtitle={sum.data ? <span className="sf-doc-meta"><span><span className="sf-num">{faDigits(sum.data.count)}</span> سند</span><span className="sf-sep" aria-hidden /><span>جمع <Money v={sum.data.total} unit /></span></span> : fy?.title}
        actions={can(meta.area, "edit") ? <Button type="primary" icon={<Ic icon={Plus} />} onClick={() => nav(`/${orgId}/${meta.path}/new`)}>{meta.title} جدید</Button> : null}
      />
      <div className="sf-card">
        <ServerTable
          path="/goods/invoices"
          params={params}
          queryKey={["table", "goods-invoices", kind]}
          onRowClick={(r: any) => nav(`/${orgId}/${meta.path}/${r.id}`)}
          rowClassName={(r: any) => (r.status === "cancelled" ? "row-muted" : "")}
          exportName={meta.plural}
          exportColumns={[
            { title: "شماره", value: (r: any) => r.no, type: "number" },
            { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
            { title: meta.party, value: (r: any) => r.buyer_name && r.buyer_name !== r.party_name ? `${r.party_name} (${r.buyer_name})` : r.party_name },
            { title: "مبلغ", value: (r: any) => r.total, type: "number" },
            ...(meta.postable ? [{ title: settleLabel, value: (r: any) => r.allocated, type: "number" as const }, { title: "مانده", value: (r: any) => r.remaining, type: "number" as const }] : []),
            { title: "وضعیت", value: (r: any) => INVOICE_STATUS[r.status]?.[0] ?? r.status },
          ]}
          toolbar={
            <Space wrap>
              <Input allowClear prefix={<Ic icon={Search} className="text-ink-3" />} placeholder="شماره، نام یا شماره‌ی عطف" value={q} onChange={(e) => setQ(e.target.value)} className="!w-56" />
              <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" allowClear className="!w-36" />
              <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" allowClear className="!w-36" />
              <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder={meta.party} className="!w-52" />
              <Select allowClear placeholder="وضعیت" value={status} onChange={setStatus} className="!w-32" options={Object.entries(INVOICE_STATUS).filter(([k]) => meta.postable || k !== "posted").map(([k, [l]]) => ({ value: k, label: l }))} />
              {meta.postable ? (
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Switch size="small" checked={open} onChange={setOpen} /> فقط تسویه‌نشده
                </label>
              ) : null}
            </Space>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "شماره", width: 80, sorter: true, render: (v) => <span className="sf-docno">{faDigits(v)}</span> },
            { key: "date", dataIndex: "date", title: "تاریخ", width: 110, sorter: true, render: (v) => <JDate v={v} /> },
            {
              key: "party_name",
              dataIndex: "party_name",
              title: meta.party,
              sorter: true,
              render: (v, r: any) => (
                <span>
                  {v}
                  {r.buyer_name && r.buyer_name !== v ? <span className="text-[12px] text-ink-3"> ({r.buyer_name})</span> : null}
                </span>
              ),
            },
            ...(kind === "purchase" || kind === "purchase_return" ? [{ key: "ref", dataIndex: "ref_no", title: "شماره‌ی فروشنده", render: (v: string) => (v ? <span className="sf-docno">{faDigits(v)}</span> : <span className="sf-zero">—</span>) }] : []),
            { key: "total", dataIndex: "total", title: "مبلغ", className: "sf-num", sorter: true, width: 148, render: (v) => <Money v={v} /> },
            ...(meta.postable
              ? [
                  { key: "allocated", dataIndex: "allocated", title: settleLabel, className: "sf-num", width: 140, render: (v: string) => <Money v={v} zero="—" /> },
                  {
                    key: "remaining",
                    dataIndex: "remaining",
                    title: "مانده",
                    className: "sf-num",
                    width: 140,
                    render: (v: string | null) => (v === null || !D(v).gt(0) ? <span className="sf-zero">—</span> : <Money v={v} className="font-medium" />),
                  },
                ]
              : []),
            ...(kind !== "purchase_return" && kind !== "sale_return"
              ? [{ key: "due_date", dataIndex: "due_date", title: kind === "quote" ? "اعتبار تا" : "سررسید", width: 110, sorter: true, render: (v: string | null) => <JDate v={v} /> }]
              : []),
            {
              key: "status",
              dataIndex: "status",
              title: "وضعیت",
              width: 140,
              render: (v, r: any) => (
                <span className="flex flex-wrap items-center gap-2">
                  <InvoiceStatus s={v} />
                  {r.extra?.converted_to ? <span className="sf-status">تبدیل‌شده</span> : null}
                </span>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

// List of gold documents with filters by kind, status, date, party and number / tag search.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Dropdown, Input, Select, Space } from "antd";
import { Plus, Search } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { DateInput, PartySelect } from "../../components/inputs";
import { JDate, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { gw, DOC_KINDS, KINDS, KIND_PATH, KindTag, StatusOf, type DocKind } from "./shared";

export const KIND_GROUPS: { label: string; kinds: DocKind[] }[] = [
  { label: "فروش", kinds: ["sale", "bullion_sale"] },
  { label: "خرید", kinds: ["purchase", "buyback"] },
  { label: "امانی", kinds: ["consign_in", "consign_return"] },
  { label: "کارگاه و ذوب", kinds: ["workshop_out", "workshop_in", "melt"] },
  { label: "سایر", kinds: ["opening"] },
];

export function NewDocButton({ kinds, label = "سند جدید", primary = true }: { kinds?: DocKind[]; label?: string; primary?: boolean }) {
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  if (!can("gold", "edit")) return null;
  const list = kinds ?? [...DOC_KINDS];
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: KIND_GROUPS.map((g) => ({
          type: "group" as const,
          key: g.label,
          label: g.label,
          children: g.kinds.filter((k) => list.includes(k)).map((k) => ({ key: k, label: KINDS[k].title, onClick: () => nav(`/${orgId}/${KIND_PATH[k]}/new`) })),
        })).filter((g) => g.children.length),
      }}
    >
      <Button type={primary ? "primary" : "default"} icon={<Ic icon={Plus} />}>{label}</Button>
    </Dropdown>
  );
}

export function DocsTable({ kinds, partyId, compact }: { kinds?: string; partyId?: string | null; compact?: boolean }) {
  const { orgId, fy } = useOrg();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [kind, setKind] = useState<string | undefined>(kinds ?? sp.get("kind") ?? undefined);
  const [status, setStatus] = useState<string | undefined>();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [party, setParty] = useState<string | null>(partyId ?? null);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const params = useMemo(() => ({ kind, status, from, to, party_id: party, q: dq, fiscal_year_id: from || to ? undefined : fy?.id }), [kind, status, from, to, party, dq, fy?.id]);
  return (
    <ServerTable<any>
      path="/gold/docs"
      params={params}
      queryKey={["table", "/gold/docs"]}
      onRowClick={(r) => nav(`/${orgId}/gold/docs/${r.id}`)}
      rowClassName={(r) => (r.status === "cancelled" ? "row-muted" : "")}
      exportName="اسناد طلا"
      exportColumns={[
        { title: "نوع", value: (r) => r.kind_title },
        { title: "شماره", value: (r) => r.no, type: "number" },
        { title: "تاریخ", value: (r) => r.date },
        { title: "طرف حساب", value: (r) => r.party_name ?? r.buyer_name ?? "" },
        { title: "وزن ۷۵۰ خروجی", value: (r) => r.weight_out, type: "number" },
        { title: "وزن ۷۵۰ ورودی", value: (r) => r.weight_in, type: "number" },
        { title: "اجرت", value: (r) => r.wage, type: "number" },
        { title: "مالیات", value: (r) => r.tax, type: "number" },
        { title: "مبلغ", value: (r) => r.total, type: "number" },
        { title: "مانده", value: (r) => r.remaining, type: "number" },
        { title: "وضعیت", value: (r) => r.status },
      ]}
      toolbar={
        compact ? undefined : (
          <Space wrap>
            <Input allowClear prefix={<Ic icon={Search} className="text-ink-3" />} placeholder="شماره، اتیکت یا نام…" className="!w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            {kinds ? null : (
              <Select
                allowClear
                placeholder="نوع سند"
                className="!w-48"
                value={kind}
                onChange={setKind}
                options={KIND_GROUPS.map((g) => ({ label: g.label, options: g.kinds.map((k) => ({ value: k, label: KINDS[k].title })) }))}
              />
            )}
            <Select allowClear placeholder="وضعیت" className="!w-32" value={status} onChange={setStatus} options={[{ value: "posted", label: "ثبت‌شده" }, { value: "draft", label: "پیش‌نویس" }, { value: "cancelled", label: "باطل‌شده" }]} />
            <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" className="!w-32" allowClear />
            <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" className="!w-32" allowClear />
            {partyId === undefined ? <PartySelect value={party} onChange={setParty} allowClear placeholder="طرف حساب" className="!w-52" /> : null}
          </Space>
        )
      }
      columns={[
        { key: "no", dataIndex: "no", title: "شماره", render: (v) => <span className="sf-docno">{faDigits(v)}</span> },
        { key: "kind", dataIndex: "kind", title: "نوع", render: (v) => <KindTag kind={v} /> },
        { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
        { key: "party", title: "طرف حساب", render: (_, r) => r.party_name ?? r.buyer_name ?? <span className="text-ink-3">مشتری گذری</span> },
        { key: "wo", dataIndex: "weight_out", title: "خروجی ۷۵۰ (گرم)", className: "sf-num", width: 128, render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <span className="sf-num">{gw(v)}</span>) },
        { key: "wi", dataIndex: "weight_in", title: "ورودی ۷۵۰ (گرم)", className: "sf-num", width: 128, render: (v) => (D(v).isZero() ? <span className="sf-zero">—</span> : <span className="sf-num">{gw(v)}</span>) },
        { key: "total", dataIndex: "total", title: "مبلغ", className: "sf-num", width: 140, render: (v) => <Money v={v} zero="—" /> },
        { key: "rem", dataIndex: "remaining", title: "مانده", className: "sf-num", width: 140, render: (v) => <Money v={v ?? 0} zero="—" /> },
        { key: "st", dataIndex: "status", title: "وضعیت", render: (v) => <StatusOf s={v} /> },
        { key: "v", dataIndex: "voucher_no", title: "سند", render: (v) => (v ? <span className="sf-docno text-ink-3">{faDigits(v)}</span> : null) },
      ]}
    />
  );
}

export default function Docs() {
  return (
    <div>
      <PageHeader title="اسناد طلا" actions={<NewDocButton />} />
      <div className="sf-card">
        <DocsTable />
      </div>
    </div>
  );
}

import { useState } from "react";
import { Button, Input, Select, Space, Tag } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { Money, JDate, StatusTag } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";

const KIND: Record<string, [string, string]> = {
  normal: ["عادی", "default"], auto: ["خودکار", "purple"], opening: ["افتتاحیه", "blue"], closing: ["اختتامیه", "geekblue"], temp_closing: ["بستن موقت", "cyan"],
};

export default function Vouchers() {
  const { fy, orgId, can } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [kind, setKind] = useState<string | undefined>();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const dq = useDebounced(q);
  return (
    <div>
      <PageHeader
        title="اسناد حسابداری"
        subtitle={fy ? `${fy.title} · از ${formatJalali(fy.start_date)} تا ${formatJalali(fy.end_date)}` : undefined}
        actions={can("accounting", "edit") ? <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/accounting/vouchers/new`)}>سند جدید</Button> : null}
      />
      <div className="tz-card p-3 md:p-4">
        <ServerTable
          path="/accounting/vouchers"
          params={{ fiscal_year_id: fy?.id, q: dq, status, kind, from, to }}
          onRowClick={(r: any) => nav(`/${orgId}/accounting/vouchers/${r.id}`)}
          exportName="اسناد حسابداری"
          exportColumns={[
            { title: "شماره", value: (r: any) => r.no, type: "number" },
            { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
            { title: "شرح", value: (r: any) => r.description },
            { title: "جمع", value: (r: any) => r.total_debit, type: "number" },
            { title: "وضعیت", value: (r: any) => r.status },
          ]}
          toolbar={
            <Space wrap>
              <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="شماره یا شرح سند" value={q} onChange={(e) => setQ(e.target.value)} className="!w-56" />
              <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" allowClear className="!w-36" />
              <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" allowClear className="!w-36" />
              <Select allowClear placeholder="وضعیت" value={status} onChange={setStatus} className="!w-32" options={[{ value: "draft", label: "پیش‌نویس" }, { value: "posted", label: "ثبت‌شده" }, { value: "final", label: "قطعی" }]} />
              <Select allowClear placeholder="نوع" value={kind} onChange={setKind} className="!w-32" options={Object.entries(KIND).map(([k, [l]]) => ({ value: k, label: l }))} />
            </Space>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "شماره", width: 80, render: (v) => <b className="num">{faDigits(v)}</b> },
            { key: "date", dataIndex: "date", title: "تاریخ", width: 110, render: (v) => <JDate v={v} /> },
            { key: "description", dataIndex: "description", title: "شرح", ellipsis: true },
            { key: "kind", dataIndex: "kind", title: "نوع", width: 100, render: (v) => <Tag color={KIND[v]?.[1]} variant="filled">{KIND[v]?.[0] ?? v}</Tag> },
            { key: "total", dataIndex: "total_debit", title: "جمع سند", align: "left", width: 160, render: (v) => <Money v={v} /> },
            { key: "status", dataIndex: "status", title: "وضعیت", width: 100, render: (v) => <StatusTag s={v} /> },
            { key: "by", dataIndex: "created_by_name", title: "ثبت‌کننده", width: 140, render: (v) => <span className="text-muted">{v ?? "—"}</span> },
          ]}
        />
      </div>
    </div>
  );
}

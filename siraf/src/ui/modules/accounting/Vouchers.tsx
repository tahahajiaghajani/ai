// Vouchers of the fiscal year (اسناد حسابداری): compact ledger list with search, a date range and status/kind filters.
import { useState } from "react";
import { Button, Input, Select } from "antd";
import { Plus, Search, FileText } from "lucide-react";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { useDebounced, useHotkey } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { JDate, StatusTag, EmptyState } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { formatJalali } from "@shared/jalali";
import { Amt, BtnKeys, DocNo, ICON, cx } from "../reports/kit";

const KIND: Record<string, string> = { normal: "عادی", auto: "خودکار", opening: "افتتاحیه", closing: "اختتامیه", temp_closing: "بستن موقت" };
const SOURCE: Record<string, string> = {
  invoice: "فاکتور", treasury_doc: "خزانه", cheque_op: "چک", stock_doc: "انبار", gold_doc: "طلا", fx_deal: "ارز", remittance: "حواله", fx_revaluation: "تسعیر", closing: "بستن حساب‌ها", opening: "افتتاحیه",
};
const STATUS = [
  { value: "draft", label: "پیش‌نویس" },
  { value: "posted", label: "ثبت‌شده" },
  { value: "final", label: "قطعی" },
];

export default function Vouchers() {
  const { fy, orgId, can, unit } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [kind, setKind] = useState<string | undefined>();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const dq = useDebounced(q);
  const canEdit = can("accounting", "edit");
  const create = () => nav(`/${orgId}/accounting/vouchers/new`);
  useHotkey("alt+n", () => canEdit && create(), [canEdit]);
  const filtered = !!(dq || status || kind || from || to);
  const clear = () => {
    setQ("");
    setStatus(undefined);
    setKind(undefined);
    setFrom(null);
    setTo(null);
  };
  return (
    <div>
      <PageHeader
        title="اسناد حسابداری"
        subtitle={fy ? <span className="sf-num">{fy.title}، {formatJalali(fy.start_date)} تا {formatJalali(fy.end_date)}</span> : undefined}
        actions={
          canEdit ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={create}>
              سند جدید
              <BtnKeys k={["Alt", "N"]} />
            </Button>
          ) : null
        }
      />
      <div className="sf-card">
        <ServerTable
          path="/accounting/vouchers"
          params={{ fiscal_year_id: fy?.id, q: dq, status, kind, from, to }}
          onRowClick={(r: any) => nav(`/${orgId}/accounting/vouchers/${r.id}`)}
          filtered={filtered}
          scrollX={980}
          onClearFilters={clear}
          empty={
            <EmptyState
              icon={FileText}
              title="هنوز سندی ثبت نشده"
              description="اسناد دستی و اسنادی که فاکتورها و دریافت و پرداخت‌ها خودکار می‌سازند اینجا می‌آیند."
              action={canEdit ? <Button type="primary" icon={<Plus {...ICON} />} onClick={create}>سند جدید</Button> : undefined}
            />
          }
          exportName="اسناد حسابداری"
          exportColumns={[
            { title: "شماره", value: (r: any) => r.no, type: "number" },
            { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
            { title: "شرح", value: (r: any) => r.description },
            { title: "جمع", value: (r: any) => r.total_debit, type: "number" },
            { title: "وضعیت", value: (r: any) => STATUS.find((s) => s.value === r.status)?.label ?? r.status },
          ]}
          toolbar={
            <>
              <Input allowClear prefix={<Search {...ICON} className="bk-3" />} placeholder="شماره یا شرح سند" value={q} onChange={(e) => setQ(e.target.value)} className="!w-56" />
              <span className="bk-range">
                <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" allowClear />
                <span>تا</span>
                <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" allowClear />
              </span>
              <Select allowClear variant="borderless" placeholder="وضعیت" value={status} onChange={setStatus} className={cx("sf-filter", status && "is-on")} popupMatchSelectWidth={false} options={STATUS} />
              <Select allowClear variant="borderless" placeholder="نوع" value={kind} onChange={setKind} className={cx("sf-filter", kind && "is-on")} popupMatchSelectWidth={false} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
            </>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "سند", width: 72, render: (v) => <DocNo n={v} /> },
            { key: "date", dataIndex: "date", title: "تاریخ", width: 108, render: (v) => <JDate v={v} /> },
            { key: "description", dataIndex: "description", title: "شرح", ellipsis: true, render: (v) => v ?? <span className="sf-zero">—</span> },
            {
              key: "kind",
              dataIndex: "kind",
              title: "نوع",
              width: 132,
              render: (v, r: any) => (v === "normal" ? null : <span className="bk-plain">{KIND[v] ?? v}{v === "auto" && r.source_type && SOURCE[r.source_type] ? `، ${SOURCE[r.source_type]}` : ""}</span>),
            },
            { key: "total", dataIndex: "total_debit", title: `جمع سند (${unit})`, className: "sf-num", width: 168, render: (v) => <Amt v={v} /> },
            { key: "status", dataIndex: "status", title: "وضعیت", width: 104, render: (v) => <StatusTag s={v} /> },
            { key: "by", dataIndex: "created_by_name", title: "ثبت‌کننده", width: 140, ellipsis: true, render: (v) => <span className="bk-3">{v ?? "—"}</span> },
          ]}
        />
      </div>
    </div>
  );
}

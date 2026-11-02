// Audit log (گزارش رویدادها): who changed what and when — the last 300 events, searchable on the page.
import { useMemo, useState } from "react";
import { Input, Segmented, Table } from "antd";
import { Search, ScrollText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EmptyState, JDateTime } from "../../components/display";
import { matchesFa } from "../../lib/fa";
import { faDigits } from "@shared/format";
import { ENTITIES } from "@shared/entities";
import { ICON, Who } from "../reports/kit";

const ACTION: Record<string, string> = {
  create: "ثبت",
  insert: "ثبت",
  update: "ویرایش",
  delete: "حذف",
  status: "تغییر وضعیت",
  post: "قطعی‌کردن",
  unpost: "برگشت از قطعی",
  cancel: "ابطال",
  member_add: "افزودن کاربر",
  cheque_deposit: "واگذاری چک",
  cheque_clear: "وصول چک",
  cheque_cash: "وصول نقدی چک",
  cheque_bounce: "برگشت چک",
  cheque_endorse: "خرج چک",
  cheque_return: "عودت چک",
  cheque_cancel: "ابطال چک",
  cheque_undo: "برگشت عملیات چک",
};

/** Persian names of the audited parts; definitions fall back to their entity title, anything else to «سایر». */
const ENTITY: Record<string, string> = {
  voucher: "سند حسابداری",
  account: "حساب",
  fiscal_year: "سال مالی",
  invoice: "فاکتور",
  stock_doc: "سند انبار",
  treasury_doc: "سند خزانه",
  cheque: "چک",
  remittance: "حواله",
  fx_deal: "معاملهٔ ارز",
  fx_revaluation: "تسعیر ارز",
  fx_rate: "نرخ ارز",
  gold_doc: "سند طلا",
  gold_rate: "نرخ طلا",
  member: "کاربر",
  org: "کسب‌وکار",
};
const entityName = (k: string | null | undefined) => (k ? ENTITY[k] ?? ENTITIES[k]?.title ?? "سایر" : "سایر");
const actionName = (k: string | null | undefined) => (k ? ACTION[k] ?? "سایر" : "سایر");

export default function Audit() {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api.get("/audit").then((r) => r.rows as any[]) });
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const rows = useMemo(
    () => (q.data ?? []).filter((r) => (action === "all" || r.action === action || (action === "create" && r.action === "insert")) && (!search || matchesFa(`${r.full_name ?? ""} ${entityName(r.entity)} ${actionName(r.action)} ${r.summary ?? ""}`, search))),
    [q.data, search, action],
  );
  return (
    <div>
      <PageHeader title="گزارش رویدادها" subtitle={q.data ? `${faDigits(q.data.length)} رویداد آخر` : undefined} />
      <div className="sf-card">
        <div className="sf-st">
          <div className="sf-st-bar">
            <div className="sf-st-filters">
              <Input allowClear prefix={<Search {...ICON} className="bk-3" />} placeholder="کاربر، بخش یا شرح" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-64" />
              <Segmented
                value={action}
                onChange={(v) => setAction(String(v))}
                options={[
                  { value: "all", label: "همه" },
                  { value: "create", label: "ثبت" },
                  { value: "update", label: "ویرایش" },
                  { value: "delete", label: "حذف" },
                ]}
              />
            </div>
          </div>
          <Table
            className="bk-tbl"
            size="small"
            rowKey="id"
            loading={q.isLoading}
            dataSource={rows}
            pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
            scroll={{ x: 960 }}
            tableLayout="fixed"
            sticky={{ offsetHeader: 56 }}
            locale={{ emptyText: q.isLoading ? " " : <EmptyState icon={ScrollText} title={search || action !== "all" ? "رویدادی با این شرایط نیست" : "هنوز رویدادی ثبت نشده"} /> }}
            columns={[
              { key: "at", dataIndex: "at", title: "زمان", width: 152, render: (v) => <span className="bk-2"><JDateTime v={v} /></span> },
              { key: "user", dataIndex: "full_name", title: "کاربر", width: 200, ellipsis: true, render: (v) => <Who name={v} /> },
              { key: "action", dataIndex: "action", title: "عمل", width: 104, render: (v) => <span className={v === "delete" ? "text-danger" : undefined}>{actionName(v)}</span> },
              { key: "entity", dataIndex: "entity", title: "بخش", width: 140, ellipsis: true, render: (v) => <span className="bk-2">{entityName(v)}</span> },
              { key: "summary", dataIndex: "summary", title: "شرح", ellipsis: true },
              { key: "origin", dataIndex: "origin", title: "مبدأ", width: 80, render: (v) => <span className="bk-plain">{v === "cloud" ? "وب" : "ویندوز"}</span> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

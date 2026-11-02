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
import { ICON, Who } from "../reports/kit";

const ACTION: Record<string, string> = { create: "ثبت", update: "ویرایش", delete: "حذف", member_add: "افزودن کاربر" };

export default function Audit() {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api.get("/audit").then((r) => r.rows as any[]) });
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const rows = useMemo(
    () => (q.data ?? []).filter((r) => (action === "all" || r.action === action) && (!search || matchesFa(`${r.full_name ?? ""} ${r.entity ?? ""} ${r.summary ?? ""}`, search))),
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
              { key: "action", dataIndex: "action", title: "عمل", width: 104, render: (v) => <span className={v === "delete" ? "text-danger" : undefined}>{ACTION[v] ?? v}</span> },
              { key: "entity", dataIndex: "entity", title: "بخش", width: 140, ellipsis: true, render: (v) => <span className="bk-2">{v}</span> },
              { key: "summary", dataIndex: "summary", title: "شرح", ellipsis: true },
              { key: "origin", dataIndex: "origin", title: "مبدأ", width: 80, render: (v) => <span className="bk-plain">{v === "cloud" ? "وب" : "ویندوز"}</span> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

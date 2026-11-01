import { Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { JDateTime } from "../../components/display";

const ACTION: Record<string, string> = { create: "ثبت", update: "ویرایش", delete: "حذف", member_add: "افزودن کاربر" };

export default function Audit() {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api.get("/audit").then((r) => r.rows) });
  return (
    <div>
      <PageHeader title="گزارش رویدادها" subtitle="چه کسی، چه زمانی، چه چیزی را تغییر داد (۳۰۰ رویداد آخر)" />
      <div className="tz-card p-3">
        <Table
          className="tz-table"
          size="small"
          rowKey="id"
          loading={q.isLoading}
          dataSource={q.data ?? []}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          columns={[
            { key: "at", dataIndex: "at", title: "زمان", render: (v) => <JDateTime v={v} /> },
            { key: "user", dataIndex: "full_name", title: "کاربر" },
            { key: "action", dataIndex: "action", title: "عمل", render: (v) => ACTION[v] ?? v },
            { key: "entity", dataIndex: "entity", title: "بخش" },
            { key: "summary", dataIndex: "summary", title: "شرح" },
            { key: "origin", dataIndex: "origin", title: "مبدأ", render: (v) => <span className="text-xs text-muted">{v === "cloud" ? "وب" : "ویندوز"}</span> },
          ]}
        />
      </div>
    </div>
  );
}

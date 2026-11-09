// «بازبینی دسترسی و سخت‌سازی» (SEC-059, SEC-060, SEC-061; access administrators and auditors): access-risk flags
// (dormant privileged accounts, external members with internal roles, separation-of-duties conflicts, too many
// administrators), the privileged-action and read-audit review over the platform's logs with the chain hash of the
// list, and the hardening console's checks and score.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table, Tabs } from "antd";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, JDateTime, Loader, StatCard } from "../../components/display";
import { SEC_KEYS, securityApi, type AccessRiskFlag, type HardeningReport, type PrivilegedReview } from "./api";

const SEV: Record<string, [string, "danger" | "warning" | "neutral"]> = { high: ["زیاد", "danger"], medium: ["متوسط", "warning"], low: ["کم", "neutral"] };
const STATUS: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = { pass: ["برقرار", "in"], warn: ["هشدار", "warning"], fail: ["نیازمند اقدام", "danger"], na: ["در دسترس نیست", "neutral"] };
const SOURCE: Record<string, string> = { security_event: "رویداد امنیتی", audit: "ممیزی سازمان", history: "تاریخچهٔ دسترسی" };

function AccessRisk() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: SEC_KEYS.review(orgId, "risk"), queryFn: () => securityApi.accessRisk(api) });
  if (q.isLoading) return <Loader />;
  if (!q.data) return <EmptyState title="در دسترس نیست" description="این بخش برای مدیران دسترسی و ممیزان است." />;
  return (
    <Card flush title={`${q.data.flags.length.toLocaleString("fa-IR")} نشانهٔ ریسک در ${q.data.members.toLocaleString("fa-IR")} عضو فعال`}>
      <Table<AccessRiskFlag>
        size="small"
        rowKey={(r) => `${r.kind}:${r.user_id}`}
        pagination={{ pageSize: 25, showSizeChanger: false }}
        dataSource={q.data.flags}
        locale={{ emptyText: "نشانه‌ای از ریسک دسترسی پیدا نشد" }}
        columns={[
          { title: "شدت", dataIndex: "severity", width: 90, render: (v: string) => <Chip tone={SEV[v]?.[1] ?? "neutral"}>{SEV[v]?.[0] ?? v}</Chip> },
          { title: "عضو", dataIndex: "name" },
          { title: "نشانه", dataIndex: "label" },
          { title: "جزئیات", dataIndex: "detail", ellipsis: true },
        ]}
      />
    </Card>
  );
}

function Privileged() {
  const { api, orgId } = useOrg();
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: [...SEC_KEYS.review(orgId, "privileged"), days], queryFn: () => securityApi.privileged(api, days) });
  const d: PrivilegedReview | undefined = q.data;
  return (
    <Card
      flush
      title="اقدام‌های ممتاز و خواندن پرونده‌های امنیتی"
      tools={<Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 7, label: "۷ روز" }, { value: 30, label: "۳۰ روز" }, { value: 90, label: "۹۰ روز" }]} />}
    >
      {q.isLoading ? (
        <Loader />
      ) : (
        <>
          <Table
            size="small"
            rowKey={(r, i) => `${r.at}-${i}`}
            pagination={{ pageSize: 50, showSizeChanger: false }}
            dataSource={d?.entries ?? []}
            locale={{ emptyText: "در این دوره اقدام ممتازی ثبت نشده است" }}
            columns={[
              { title: "زمان", dataIndex: "at", width: 170, render: (v: string) => <JDateTime v={v} /> },
              { title: "منبع", dataIndex: "source", width: 140, render: (v: string) => SOURCE[v] ?? v },
              { title: "اقدام", dataIndex: "label" },
              { title: "انجام‌دهنده", dataIndex: "actor", render: (v: string | null) => v ?? "—" },
              { title: "جزئیات", dataIndex: "detail", ellipsis: true },
              { title: "", dataIndex: "ok", width: 80, render: (v: boolean) => (v ? null : <Chip tone="danger">ناموفق</Chip>) },
            ]}
          />
          {d?.chain ? (
            <p className="px-4 py-2 text-[12px] text-ink-3">
              چکیدهٔ زنجیره‌ای فهرست: <bdi dir="ltr" className="font-mono">{d.chain}</bdi>
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function Hardening() {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: SEC_KEYS.review(orgId, "hardening"), queryFn: () => securityApi.hardening(api) });
  const d: HardeningReport | undefined = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="امتیاز سخت‌سازی" value={`${d.score.toLocaleString("fa-IR")} از ۱۰۰`} />
        <StatCard title="نیازمند اقدام" value={d.checks.filter((c) => c.status === "fail").length.toLocaleString("fa-IR")} />
        <StatCard title="هشدار" value={d.checks.filter((c) => c.status === "warn").length.toLocaleString("fa-IR")} />
      </div>
      <Card flush>
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={d.checks}
          columns={[
            { title: "بررسی", dataIndex: "label" },
            { title: "وضعیت", dataIndex: "status", width: 140, render: (v: string) => <Chip tone={STATUS[v]?.[1] ?? "neutral"}>{STATUS[v]?.[0] ?? v}</Chip> },
            { title: "جزئیات", dataIndex: "detail" },
            { title: "اقدام پیشنهادی", dataIndex: "remedy", render: (v: string | null) => v ?? "—" },
          ]}
        />
      </Card>
    </div>
  );
}

export default function Review() {
  const [tab, setTab] = useState("risk");
  return (
    <div>
      <PageHeader title="بازبینی دسترسی و سخت‌سازی" />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        destroyOnHidden
        items={[
          { key: "risk", label: "ریسک دسترسی", children: <AccessRisk /> },
          { key: "privileged", label: "اقدام‌های ممتاز", children: <Privileged /> },
          { key: "hardening", label: "سخت‌سازی", children: <Hardening /> },
        ]}
      />
    </div>
  );
}

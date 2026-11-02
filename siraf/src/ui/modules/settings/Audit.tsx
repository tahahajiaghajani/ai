// Audit log (گزارش رویدادها): who changed what and when — the last 300 events, searchable on the page —
// and the platform admin's support sessions in this business («حالت پشتیبانی»): reason, level, start,
// end and the changes made in each; an owner or manager can end a live one.
import { useMemo, useState } from "react";
import { Button, Input, Segmented, Table, Tooltip } from "antd";
import { Search, ScrollText, LifeBuoy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime } from "../../components/display";
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
  support_start: "آغاز پشتیبانی",
  support_end: "پایان پشتیبانی",
  support_write: "تغییر",
  org_status: "وضعیت کسب‌وکار",
  org_ai: "هوش مصنوعی",
};

/** Who made the change: a member, the platform admin in a support session, or from «مدیریت سامانه». */
const ACTOR: Record<string, [string, "warning" | "accent"]> = { support: ["پشتیبانی", "warning"], platform: ["مدیر سامانه", "accent"] };

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
  support_session: "حالت پشتیبانی",
};
const entityName = (k: string | null | undefined) => (k ? ENTITY[k] ?? ENTITIES[k]?.title ?? "سایر" : "سایر");
const actionName = (k: string | null | undefined) => (k ? ACTION[k] ?? "سایر" : "سایر");

interface SupportRow {
  id: string;
  level: "view" | "edit";
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  state: "active" | "ended" | "expired";
  admin_name: string | null;
  admin_email: string | null;
  ended_by_name: string | null;
}

const STATE: Record<SupportRow["state"], [string, "warning" | "neutral"]> = { active: ["در جریان", "warning"], ended: ["پایان‌یافته", "neutral"], expired: ["سرآمده", "neutral"] };

export default function Audit() {
  const [view, setView] = useState<"events" | "support">("events");
  const sessions = useSupportSessions();
  const live = (sessions.data?.sessions ?? []).filter((s) => s.state === "active").length;
  return (
    <div>
      <PageHeader
        title="گزارش رویدادها"
        extra={
          <Segmented
            value={view}
            onChange={(v) => setView(v as "events" | "support")}
            options={[
              { value: "events", label: "رویدادها" },
              { value: "support", label: live ? `حالت پشتیبانی (${faDigits(live)} در جریان)` : "حالت پشتیبانی" },
            ]}
          />
        }
      />
      {view === "events" ? <Events /> : <SupportSessions />}
    </div>
  );
}

function useSupportSessions() {
  const { api } = useOrg();
  return useQuery({ queryKey: ["support-sessions"], queryFn: () => api.get<{ sessions: SupportRow[]; can_end: boolean }>("/support-sessions") });
}

function SupportSessions() {
  const { api } = useOrg();
  const n = useNotify();
  const q = useSupportSessions();
  const end = useAction((id: string) => api.post(`/support-sessions/${id}/end`), { success: "حالت پشتیبانی پایان یافت.", invalidate: [["support-sessions"], ["audit"]] });
  const canEnd = !!q.data?.can_end;
  return (
    <div className="sf-card">
      <Table<SupportRow>
        className="bk-tbl"
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={q.data?.sessions ?? []}
        pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
        scroll={{ x: 900 }}
        tableLayout="fixed"
        locale={{ emptyText: q.isLoading ? " " : <EmptyState icon={LifeBuoy} title="مدیر سامانه تاکنون در حالت پشتیبانی وارد این کسب‌وکار نشده است" /> }}
        columns={[
          { key: "at", dataIndex: "started_at", title: "آغاز", width: 152, render: (v) => <span className="bk-2"><JDateTime v={v} /></span> },
          {
            key: "who",
            title: "مدیر سامانه",
            width: 200,
            ellipsis: true,
            render: (_, r) => (
              <span className="min-w-0">
                <span className="block truncate">{r.admin_name ?? "—"}</span>
                {r.admin_email ? (
                  <bdi dir="ltr" className="sf-latin bk-3 block truncate" style={{ fontSize: 12 }}>
                    {r.admin_email}
                  </bdi>
                ) : null}
              </span>
            ),
          },
          { key: "level", dataIndex: "level", title: "سطح", width: 120, render: (v) => (v === "edit" ? "مشاهده و اصلاح" : "فقط مشاهده") },
          { key: "reason", dataIndex: "reason", title: "دلیل", ellipsis: { showTitle: false }, render: (v) => <Tooltip title={v}><span>{v}</span></Tooltip> },
          {
            key: "end",
            title: "پایان",
            width: 168,
            render: (_, r) =>
              r.state === "active" ? (
                <span className="bk-2">
                  تا <JDateTime v={r.expires_at} />
                </span>
              ) : (
                <span className="bk-2">
                  <JDateTime v={r.ended_at ?? r.expires_at} />
                  {r.ended_by_name && r.state === "ended" ? <span className="bk-3 block truncate text-[12px]">به دست {r.ended_by_name}</span> : null}
                </span>
              ),
          },
          { key: "state", dataIndex: "state", title: "وضعیت", width: 110, render: (v: SupportRow["state"]) => <Chip tone={STATE[v][1]}>{STATE[v][0]}</Chip> },
          {
            key: "a",
            width: 96,
            render: (_, r) =>
              r.state === "active" && canEnd ? (
                <Button
                  size="small"
                  loading={end.isPending && end.variables === r.id}
                  onClick={async () => {
                    if (await n.confirm("پایان حالت پشتیبانی؟", "مدیر سامانه از این کسب‌وکار خارج می‌شود.", true, "پایان")) end.mutate(r.id);
                  }}
                >
                  پایان
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

function Events() {
  const { api } = useOrg();
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api.get("/audit").then((r) => r.rows as any[]) });
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const rows = useMemo(
    () =>
      (q.data ?? []).filter(
        (r) =>
          (action === "all" || (action === "support" ? r.actor_kind && r.actor_kind !== "user" : r.action === action || (action === "create" && r.action === "insert"))) &&
          (!search || matchesFa(`${r.full_name ?? ""} ${entityName(r.entity)} ${actionName(r.action)} ${r.summary ?? ""}`, search)),
      ),
    [q.data, search, action],
  );
  return (
    <div>
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
                  { value: "support", label: "مدیر سامانه" },
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
              {
                key: "user",
                dataIndex: "full_name",
                title: "کاربر",
                width: 220,
                ellipsis: true,
                render: (v, r: any) =>
                  ACTOR[r.actor_kind] ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Who name={v} />
                      <Chip tone={ACTOR[r.actor_kind][1]}>{ACTOR[r.actor_kind][0]}</Chip>
                    </span>
                  ) : (
                    <Who name={v} />
                  ),
              },
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

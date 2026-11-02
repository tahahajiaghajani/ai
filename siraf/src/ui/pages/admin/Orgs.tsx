// «کسب‌وکارها»: every business with its owner, modules, members, Windows apps, last activity and platform
// status; search by name or a member's email/mobile, filters by status, module, inactivity and support.
import { useState } from "react";
import { Input, Segmented, Select, Table } from "antd";
import { Building2, LifeBuoy, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState } from "../../components/display";
import { useDebounced, useIsPhone } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { MODULES } from "@shared/constants";
import { ICON, Mods, StatusChip, ago, kindTitle, useAdminQuery, type OrgStatus } from "./ui";

export interface OrgListRow {
  id: string;
  name: string;
  legal_name: string | null;
  business_kind: string;
  modules: string[];
  city: string | null;
  created_at: string;
  status: OrgStatus;
  status_reason: string | null;
  ai_disabled: boolean;
  members: number;
  owner: { name: string; email: string; mobile: string | null } | null;
  vouchers: number;
  devices: number;
  last_activity: string | null;
  support_active: boolean;
}

export default function Orgs() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q);
  const status = params.get("status") ?? "";
  const module = params.get("module") ?? "";
  const extra = params.get("inactive") ? "inactive" : params.get("support") ? "support" : "";
  const phone = useIsPhone();
  const nav = useNavigate();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const list = useAdminQuery<{ orgs: OrgListRow[] }>(["orgs", dq, status, module, extra], "/admin/orgs", {
    q: dq || undefined,
    status: status || undefined,
    module: module || undefined,
    inactive: extra === "inactive" ? 1 : undefined,
    support: extra === "support" ? 1 : undefined,
  });
  const rows = list.data?.orgs ?? [];
  const filtered = !!(dq || status || module || extra);
  return (
    <div>
      <PageHeader title="کسب‌وکارها" subtitle={list.data ? `${fa(rows.length)} کسب‌وکار` : undefined} />
      <div className="bk-card">
        <div className="ad-filters">
          <Input allowClear prefix={<Search {...ICON} className="text-ink-3" />} placeholder="نام، ایمیل یا موبایل اعضا" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی کسب‌وکار" />
          <Segmented
            value={status}
            onChange={(v) => set("status", String(v))}
            options={[
              { value: "", label: "همه" },
              { value: "active", label: "فعال" },
              { value: "read_only", label: "فقط‌خواندنی" },
              { value: "suspended", label: "معلق" },
            ]}
          />
          <Select
            value={module}
            onChange={(v) => set("module", v)}
            style={{ minInlineSize: 130 }}
            aria-label="بخش"
            options={[{ value: "", label: "همهٔ بخش‌ها" }, ...MODULES.map((m) => ({ value: m.key, label: m.title }))]}
          />
          <Select
            value={extra}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              next.delete("inactive");
              next.delete("support");
              if (v) next.set(v, "1");
              setParams(next, { replace: true });
            }}
            style={{ minInlineSize: 170 }}
            aria-label="فعالیت"
            options={[
              { value: "", label: "هر فعالیتی" },
              { value: "inactive", label: "بی‌فعالیت در ۳۰ روز" },
              { value: "support", label: "در حالت پشتیبانی" },
            ]}
          />
        </div>
        <Table<OrgListRow>
          className="bk-tbl"
          size="middle"
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
          scroll={phone ? undefined : { x: 1000 }}
          onRow={(r) => ({ onClick: () => nav(`/admin/orgs/${r.id}`), className: "cursor-pointer" })}
          locale={{ emptyText: list.isLoading ? " " : <EmptyState icon={Building2} title={filtered ? "کسب‌وکاری با این شرایط نیست" : "هنوز کسب‌وکاری ساخته نشده است"} /> }}
          columns={
            phone
              ? [
                  {
                    key: "m",
                    title: "کسب‌وکار",
                    render: (_, r) => (
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-ink">{r.name}</div>
                          <div className="truncate text-[12px] text-ink-3">
                            {r.owner?.name ?? "بدون مالک"} · {fa(r.members)} عضو · {ago(r.last_activity)}
                          </div>
                        </div>
                        <StatusChip s={r.status} />
                      </div>
                    ),
                  },
                ]
              : [
                  {
                    key: "name",
                    title: "کسب‌وکار",
                    render: (_, r) => (
                      <span className="block min-w-0">
                        <span className="flex items-center gap-2 font-medium text-ink">
                          {r.name}
                          {r.support_active ? <LifeBuoy size={14} strokeWidth={1.4} absoluteStrokeWidth className="text-warning" aria-label="در حالت پشتیبانی" /> : null}
                        </span>
                        <span className="ad-sub">
                          {kindTitle(r.business_kind)}
                          {r.city ? ` · ${r.city}` : ""}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "owner",
                    title: "مالک",
                    width: 220,
                    render: (_, r) =>
                      r.owner ? (
                        <span className="block min-w-0">
                          <span className="block truncate">{r.owner.name}</span>
                          <bdi dir="ltr" className="sf-latin ad-sub block truncate">
                            {r.owner.email}
                          </bdi>
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      ),
                  },
                  { key: "mods", title: "بخش‌ها", width: 190, render: (_, r) => <Mods list={r.modules} /> },
                  { key: "members", dataIndex: "members", title: "اعضا", width: 70, className: "sf-num", render: (v) => fa(v) },
                  { key: "devices", dataIndex: "devices", title: "ویندوز", width: 70, className: "sf-num", render: (v) => (v ? fa(v) : <span className="text-ink-3">—</span>) },
                  { key: "act", dataIndex: "last_activity", title: "آخرین فعالیت", width: 130, render: (v) => <span className="text-ink-2">{ago(v)}</span> },
                  {
                    key: "status",
                    dataIndex: "status",
                    title: "وضعیت",
                    width: 150,
                    render: (v: OrgStatus, r) => (
                      <span className="inline-flex flex-wrap items-center gap-1">
                        <StatusChip s={v} />
                        {r.ai_disabled ? <Chip tone="neutral">بدون هوش مصنوعی</Chip> : null}
                      </span>
                    ),
                  },
                ]
          }
        />
      </div>
    </div>
  );
}

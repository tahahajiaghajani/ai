// Platform owner's page: users (disable / enable), businesses and database usage.
import { useState } from "react";
import { Button, Input, Progress, Switch, Table, Tabs, Tag } from "antd";
import { ArrowRightOutlined, DatabaseOutlined, ShopOutlined, TeamOutlined, FileTextOutlined } from "@ant-design/icons";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useNotify, useDebounced } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Logo } from "../../components/layout";
import { StatCard, JDateTime } from "../../components/display";
import { faDigits, formatNumber } from "@shared/format";
import { BUSINESS_KINDS, MODULES } from "@shared/constants";

// Supabase Free projects hold up to 500 MB
const FREE_DB_BYTES = 500 * 1024 * 1024;

const mb = (b: number) => `${formatNumber((b / 1024 / 1024).toFixed(1))} مگابایت`;

export default function Admin() {
  const { me, meta } = useSession();
  const n = useNotify();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api.get<{ stats: Record<string, number> }>("/admin/stats") });
  const users = useQuery({ queryKey: ["admin", "users", dq], queryFn: () => api.get<{ users: any[] }>("/admin/users", { q: dq }) });
  const orgs = useQuery({ queryKey: ["admin", "orgs"], queryFn: () => api.get<{ orgs: any[] }>("/admin/orgs") });
  if (!me?.user.is_platform_admin) return <div className="p-10 text-center text-muted">این بخش فقط برای مدیر سامانه است.</div>;
  const s = stats.data?.stats;
  const used = Number(s?.db_bytes ?? 0);

  const toggle = async (id: string, disabled: boolean) => {
    try {
      await api.patch(`/admin/users/${id}`, { disabled });
      n.ok(disabled ? "حساب غیرفعال شد و از همه‌ی دستگاه‌ها خارج شد" : "حساب فعال شد");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Logo />
        <Link to="/orgs">
          <Button icon={<ArrowRightOutlined />}>کسب‌وکارها</Button>
        </Link>
      </div>
      <h1 className="mb-4 text-xl font-bold">مدیریت سامانه</h1>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="کاربران" value={faDigits(s?.users ?? 0)} hint={s?.disabled_users ? `${faDigits(s.disabled_users)} غیرفعال` : undefined} icon={<TeamOutlined />} />
        <StatCard title="کسب‌وکارها" value={faDigits(s?.orgs ?? 0)} icon={<ShopOutlined />} tone="gold" />
        <StatCard title="اسناد حسابداری" value={formatNumber(s?.vouchers ?? 0)} hint={`${faDigits(s?.active_sessions ?? 0)} نشست فعال در ۷ روز`} icon={<FileTextOutlined />} tone="ok" />
        <div className="tz-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            <DatabaseOutlined /> حجم پایگاه‌داده
          </div>
          <div className="mt-1 text-lg font-bold">{mb(used)}</div>
          {meta?.mode === "cloud" ? (
            <>
              <Progress percent={Math.min(100, Math.round((used / FREE_DB_BYTES) * 100))} size="small" status={used > FREE_DB_BYTES * 0.8 ? "exception" : "normal"} showInfo={false} />
              <div className="text-xs text-muted">از ۵۰۰ مگابایت طرح رایگان Supabase</div>
            </>
          ) : null}
        </div>
      </div>
      <div className="tz-card p-3 md:p-4">
        <Tabs
          items={[
            {
              key: "users",
              label: "کاربران",
              children: (
                <>
                  <Input allowClear placeholder="جستجوی ایمیل، نام یا موبایل…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 !w-72" />
                  <Table
                    size="small"
                    rowKey="id"
                    loading={users.isLoading}
                    dataSource={users.data?.users ?? []}
                    pagination={{ pageSize: 25, hideOnSinglePage: true }}
                    scroll={{ x: 800 }}
                    columns={[
                      { key: "name", title: "نام", render: (_: unknown, u: any) => <span className="font-medium">{u.full_name}{u.is_platform_admin ? <Tag className="ms-2" color="gold" variant="filled">مدیر سامانه</Tag> : null}</span> },
                      { key: "email", title: "ایمیل", dataIndex: "email", render: (v: string) => <span className="ltr">{v}</span> },
                      { key: "orgs", title: "کسب‌وکار", dataIndex: "orgs", width: 90, render: (v: number) => faDigits(v) },
                      { key: "seen", title: "آخرین ورود", dataIndex: "last_seen_at", width: 170, render: (v: string | null) => (v ? <JDateTime v={v} /> : "—") },
                      { key: "created", title: "عضویت", dataIndex: "created_at", width: 170, render: (v: string) => <JDateTime v={v} /> },
                      {
                        key: "active",
                        title: "فعال",
                        width: 80,
                        render: (_: unknown, u: any) => <Switch size="small" checked={!u.disabled} disabled={u.id === me.user.id} onChange={(on) => toggle(u.id, !on)} />,
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "orgs",
              label: "کسب‌وکارها",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  loading={orgs.isLoading}
                  dataSource={orgs.data?.orgs ?? []}
                  pagination={{ pageSize: 25, hideOnSinglePage: true }}
                  scroll={{ x: 800 }}
                  columns={[
                    { key: "name", title: "نام", render: (_: unknown, o: any) => <Link to={`/${o.id}`} className="font-medium">{o.name}</Link> },
                    { key: "kind", title: "نوع", dataIndex: "business_kind", render: (v: string) => BUSINESS_KINDS.find((b) => b.key === v)?.title ?? v },
                    { key: "modules", title: "ماژول‌ها", dataIndex: "modules", render: (v: string[]) => (v ?? []).map((m) => <Tag key={m} variant="filled">{MODULES.find((x) => x.key === m)?.title ?? m}</Tag>) },
                    { key: "members", title: "کاربر", dataIndex: "members", width: 70, render: (v: number) => faDigits(v) },
                    { key: "vouchers", title: "سند", dataIndex: "vouchers", width: 80, render: (v: number) => formatNumber(v) },
                    { key: "invoices", title: "فاکتور", dataIndex: "invoices", width: 80, render: (v: number) => formatNumber(v) },
                    { key: "last", title: "آخرین فعالیت", dataIndex: "last_activity", width: 170, render: (v: string | null) => (v ? <JDateTime v={v} /> : "—") },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

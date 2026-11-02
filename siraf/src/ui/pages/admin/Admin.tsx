// Platform owner's page: users (disable / enable), businesses and database usage.
import { useState, type ReactNode } from "react";
import { Button, Input, Switch, Table, Tabs, Tooltip } from "antd";
import { ArrowRight, Database, Building2, Users, FileText, Search } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useNotify, useDebounced } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { useCountUp } from "../../lib/motion";
import { fa, jDate, jTime, SEP } from "../../lib/fa";
import { BUSINESS_KINDS, MODULES } from "@shared/constants";
import { ICON, PlainFrame, initials } from "../kit";

// Supabase Free projects hold up to 500 MB
const FREE_DB_BYTES = 500 * 1024 * 1024;

function When({ v }: { v: string | null | undefined }) {
  if (!v) return <span className="text-ink-3">—</span>;
  const d = new Date(v);
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      <span className="sf-num">{jDate(d)}</span>
      <span className="sf-num text-ink-3">{jTime(d)}</span>
    </span>
  );
}

function Stat({ icon, label, children, foot, visual, i }: { icon: ReactNode; label: string; children: ReactNode; foot?: ReactNode; visual?: ReactNode; i: number }) {
  return (
    <div className="pg-stat sf-enter" style={{ ["--sf-i" as string]: i }}>
      <div className="pg-stat-l">
        {icon}
        {label}
      </div>
      <div className="pg-stat-v">{children}</div>
      {visual}
      {foot ? <div className="pg-stat-f">{foot}</div> : null}
    </div>
  );
}

function Count({ n }: { n: number }) {
  const v = useCountUp(n);
  return <span className="sf-t-figure sf-num">{fa(Math.round(v))}</span>;
}

export default function Admin() {
  const { me, meta } = useSession();
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("users");
  const dq = useDebounced(q);
  const isAdmin = !!me?.user.is_platform_admin;
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: () => api.get<{ stats: Record<string, number> }>("/admin/stats"), enabled: isAdmin });
  const users = useQuery({ queryKey: ["admin", "users", dq], queryFn: () => api.get<{ users: any[] }>("/admin/users", { q: dq }), enabled: isAdmin });
  const orgs = useQuery({ queryKey: ["admin", "orgs"], queryFn: () => api.get<{ orgs: any[] }>("/admin/orgs"), enabled: isAdmin });

  if (!isAdmin)
    return (
      <PlainFrame>
        <div className="pg-list">
          <div className="pg-empty">
            <span className="pg-empty-tile">
              <Users size={28} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
            </span>
            <h2>دسترسی به مدیریت سامانه ندارید.</h2>
            <p>این بخش فقط برای مدیر سامانه است.</p>
            <Button onClick={() => nav("/orgs")}>بازگشت به کسب‌وکارها</Button>
          </div>
        </div>
      </PlainFrame>
    );

  const s = stats.data?.stats;
  const used = Number(s?.db_bytes ?? 0);
  const usedMb = used / 1024 / 1024;
  const ratio = Math.min(1, used / FREE_DB_BYTES);
  const cloud = meta?.mode === "cloud";

  const toggle = async (id: string, disabled: boolean) => {
    try {
      await api.patch(`/admin/users/${id}`, { disabled });
      n.ok(disabled ? "حساب غیرفعال شد و از همهٔ دستگاه‌ها خارج شد." : "حساب فعال شد.");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    }
  };

  const userRows = users.data?.users ?? [];
  const orgRows = orgs.data?.orgs ?? [];

  return (
    <PlainFrame wide>
      <div className="pg-ph">
        <Tooltip title="کسب‌وکارها">
          <Link to="/orgs" aria-label="بازگشت به کسب‌وکارها" className="inline-grid size-8 place-items-center rounded-md text-ink-2 hover:bg-[var(--sf-hover)] hover:text-ink">
            <ArrowRight {...ICON} />
          </Link>
        </Tooltip>
        <h1 className="sf-t-page">مدیریت سامانه</h1>
        <span className="pg-ph-meta">{cloud ? "نسخهٔ وب" : "نسخهٔ ویندوز"}</span>
      </div>

      <section className="pg-stats" aria-label="آمار سامانه" aria-busy={stats.isLoading}>
        <Stat i={0} icon={<Users {...ICON} />} label="کاربران" foot={s?.disabled_users ? <><span className="sf-num">{fa(s.disabled_users)}</span> غیرفعال</> : "همه فعال"}>
          <Count n={s?.users ?? 0} />
        </Stat>
        <Stat i={1} icon={<Building2 {...ICON} />} label="کسب‌وکارها">
          <Count n={s?.orgs ?? 0} />
        </Stat>
        <Stat i={2} icon={<FileText {...ICON} />} label="اسناد حسابداری" foot={<><span className="sf-num">{fa(s?.active_sessions ?? 0)}</span> نشست فعال در ۷ روز</>}>
          <Count n={s?.vouchers ?? 0} />
        </Stat>
        <Stat
          i={3}
          icon={<Database {...ICON} />}
          label="حجم پایگاه‌داده"
          visual={
            cloud ? (
              <div className="pg-meter" data-hot={ratio > 0.8 || undefined} role="meter" aria-label="سهم مصرف‌شده از طرح رایگان" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
                <i style={{ inlineSize: `${Math.max(ratio * 100, 1)}%` }} />
              </div>
            ) : null
          }
          foot={cloud ? <>از ۵۰۰ مگابایت طرح رایگان، <span className="sf-num">{fa(ratio * 100, 0)}٪</span></> : "روی همین رایانه"}
        >
          <span className="sf-t-figure sf-num">{fa(usedMb, usedMb < 10 ? 1 : 0)}</span>
          <span className="sf-unit">مگابایت</span>
        </Stat>
      </section>
      <div className="pg-panel">
        <Tabs
          className="pg-tabs"
          activeKey={tab}
          onChange={setTab}
          tabBarStyle={{ paddingInline: 16 }}
          items={[
            { key: "users", label: <>کاربران {users.data ? <span className="sf-num ms-1 text-ink-3">{fa(userRows.length)}</span> : null}</> },
            { key: "orgs", label: <>کسب‌وکارها {orgs.data ? <span className="sf-num ms-1 text-ink-3">{fa(orgRows.length)}</span> : null}</> },
          ]}
        />
        {tab === "users" ? (
          <>
            <div className="pg-filters">
              <Input
                allowClear
                prefix={<Search {...ICON} className="text-ink-3" aria-hidden />}
                placeholder="جستجوی ایمیل، نام یا شمارهٔ همراه"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="!w-80 max-w-full"
                aria-label="جستجوی کاربران"
              />
              <span className="pg-count">{users.data ? `${fa(userRows.length)} کاربر` : null}</span>
            </div>
            <Table
              size="small"
              rowKey="id"
              loading={users.isLoading}
              dataSource={userRows}
              pagination={{ pageSize: 25, hideOnSinglePage: true }}
              scroll={{ x: 880 }}
              rowClassName={(u: any) => (u.disabled ? "pg-off" : "")}
              locale={{ emptyText: q ? `برای «${q}» کاربری پیدا نشد.` : "هنوز کاربری نیست." }}
              columns={[
                {
                  key: "name",
                  title: "نام",
                  render: (_: unknown, u: any) => (
                    <span className="pg-person">
                      <span className="pg-av" aria-hidden>
                        {initials(u.full_name)}
                      </span>
                      <span className="truncate font-medium">{u.full_name}</span>
                      {u.is_platform_admin ? <span className="pg-chip">مدیر سامانه</span> : null}
                      {u.disabled ? <span className="pg-chip">غیرفعال</span> : null}
                    </span>
                  ),
                },
                { key: "email", title: "ایمیل", dataIndex: "email", render: (v: string) => <span className="sf-latin">{v}</span> },
                { key: "orgs", title: "کسب‌وکار", dataIndex: "orgs", width: 96, render: (v: number) => <span className="sf-num">{fa(v ?? 0)}</span> },
                { key: "seen", title: "آخرین ورود", dataIndex: "last_seen_at", width: 168, render: (v: string | null) => <When v={v} /> },
                { key: "created", title: "عضویت", dataIndex: "created_at", width: 168, render: (v: string) => <When v={v} /> },
                {
                  key: "active",
                  title: "فعال",
                  width: 72,
                  render: (_: unknown, u: any) => (
                    <Switch size="small" checked={!u.disabled} disabled={u.id === me!.user.id} onChange={(on) => toggle(u.id, !on)} aria-label={u.disabled ? `فعال کردن ${u.full_name}` : `غیرفعال کردن ${u.full_name}`} />
                  ),
                },
              ]}
            />
          </>
        ) : (
          <Table
            size="small"
            rowKey="id"
            loading={orgs.isLoading}
            dataSource={orgRows}
            pagination={{ pageSize: 25, hideOnSinglePage: true }}
            scroll={{ x: 960 }}
            locale={{ emptyText: "هنوز کسب‌وکاری ساخته نشده." }}
            columns={[
              {
                key: "name",
                title: "نام",
                render: (_: unknown, o: any) => (
                  <Link to={`/${o.id}`} className="pg-person !text-ink hover:underline">
                    <span className="pg-av !rounded-md" aria-hidden>
                      {String(o.name ?? "").trim().slice(0, 1)}
                    </span>
                    <span className="truncate font-medium">{o.name}</span>
                  </Link>
                ),
              },
              { key: "kind", title: "نوع", dataIndex: "business_kind", render: (v: string) => <span className="text-ink-2">{BUSINESS_KINDS.find((b) => b.key === v)?.title.replace(/\s*\(.*\)$/, "") ?? v}</span> },
              {
                key: "modules",
                title: "بخش‌ها",
                dataIndex: "modules",
                render: (v: string[]) => <span className="text-ink-2">{(v ?? []).length ? (v ?? []).map((m) => MODULES.find((x) => x.key === m)?.title ?? m).join(SEP) : "—"}</span>,
              },
              { key: "members", title: "کاربر", dataIndex: "members", width: 72, render: (v: number) => <span className="sf-num">{fa(v ?? 0)}</span> },
              { key: "vouchers", title: "سند", dataIndex: "vouchers", width: 88, render: (v: number) => <span className="sf-num">{fa(v ?? 0)}</span> },
              { key: "invoices", title: "فاکتور", dataIndex: "invoices", width: 88, render: (v: number) => <span className="sf-num">{fa(v ?? 0)}</span> },
              { key: "last", title: "آخرین فعالیت", dataIndex: "last_activity", width: 168, render: (v: string | null) => <When v={v} /> },
            ]}
          />
        )}
      </div>
    </PlainFrame>
  );
}

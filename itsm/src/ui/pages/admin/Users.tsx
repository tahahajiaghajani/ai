// «کاربران»: every account with its businesses, sessions, last activity and failed sign-ins; the side sheet
// (/admin/users/<id>) shows memberships, live sessions, Windows apps and security events, and the account
// actions: disable/enable, sign out everywhere, a temporary password with a reason, platform admin on/off.
import { useState } from "react";
import { Button, Drawer, Form, Input, Modal, Segmented, Table, Tooltip, message } from "antd";
import { Copy, KeyRound, LogOut, Search, ShieldCheck, ShieldOff, UserCheck, UserX, Users as UsersIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { Card, Note } from "../../modules/reports/kit";
import { api } from "../../lib/api";
import { useDebounced, useIsPhone, useNotify } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { fa } from "../../lib/fa";
import { ROLES, type Role } from "@shared/permissions";
import { ICON, ICON14, EVENT_KIND, StatusChip, When, ago, eventDetail, useAdminQuery, type OrgStatus, type SecurityEvent } from "./ui";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  mobile: string | null;
  is_platform_admin: boolean;
  env_admin: boolean;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  orgs: number;
  sessions: number;
  failed_24h: number;
}

interface UserDetail {
  user: UserRow & { has_recovery: boolean; recently_admin?: boolean };
  memberships: { id: string; org_id: string; org_name: string; role: Role; title: string | null; is_active: boolean; org_status: OrgStatus }[];
  sessions: { id: string; kind: string; device_name: string | null; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string }[];
  devices: { id: string; name: string; app_version: string | null; org_name: string | null; last_push_at: string | null }[];
  events: SecurityEvent[];
}

function browser(ua: string | null): string {
  if (!ua) return "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  if (/Electron|Siraf/i.test(ua)) return "برنامهٔ ویندوز";
  return "";
}

function TempPassword({ user, open, onClose }: { user: UserRow; open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = useNotify();
  const qc = useQueryClient();
  const close = () => {
    setPw(null);
    onClose();
  };
  return (
    <Modal open={open} onCancel={close} title={`رمز موقت برای ${user.full_name}`} footer={null} destroyOnHidden width={460}>
      {pw ? (
        <>
          <Note tone="warning" className="mb-4">
            <b>این رمز دوباره نمایش داده نمی‌شود.</b> آن را به کاربر بدهید؛ پس از ورود رمز را عوض کند.
          </Note>
          <div className="bk-copy">
            <code style={{ fontSize: 18, letterSpacing: ".04em" }}>{pw}</code>
            <Tooltip title="رونوشت">
              <Button
                type="text"
                icon={<Copy {...ICON} />}
                aria-label="رونوشت"
                onClick={() => {
                  void navigator.clipboard?.writeText(pw);
                  message.success("رونوشت شد.");
                }}
              />
            </Tooltip>
          </div>
          <div className="flex justify-end pt-4">
            <Button type="primary" onClick={close}>
              یادداشت کردم
            </Button>
          </div>
        </>
      ) : (
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={async (v: { reason: string }) => {
            setBusy(true);
            try {
              const r = await api.post<{ temp_password: string }>(`/admin/users/${user.id}/password`, v);
              setPw(r.temp_password);
              qc.invalidateQueries({ queryKey: ["admin"] });
            } catch (e) {
              n.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="mb-4 mt-0 text-[13px] leading-5 text-ink-2">رمز فعلی کنار می‌رود و همهٔ ورودهای این حساب بسته می‌شود.</p>
          <Form.Item name="reason" label="دلیل" rules={[{ required: true, message: "دلیل را بنویسید." }, { min: 5, message: "دست‌کم ۵ نویسه بنویسید." }]}>
            <Input autoFocus maxLength={300} placeholder="مثلاً: درخواست تلفنی کاربر پس از احراز هویت" />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>انصراف</Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              ساخت رمز موقت
            </Button>
          </div>
        </Form>
      )}
    </Modal>
  );
}

function UserSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdminQuery<UserDetail>(["user", id], `/admin/users/${id}`);
  const { me } = useSession();
  const n = useNotify();
  const qc = useQueryClient();
  const [pw, setPw] = useState(false);
  const d = q.data;
  const self = me?.user.id === id;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      n.ok(done);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    }
  };
  const u = d?.user;
  return (
    <Drawer open onClose={onClose} size={560} title={u?.full_name ?? "کاربر"} destroyOnHidden>
      {!u ? (
        <Skeleton rows={8} />
      ) : (
        <div className="ad-stack">
          <div>
            <bdi dir="ltr" className="ds-latin block text-ink-2">
              {u.email}
            </bdi>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {u.is_platform_admin ? <Chip tone="accent">مدیر سامانه{u.env_admin ? " (از تنظیمات)" : ""}</Chip> : null}
              {/* a listed address is no proof of owning it: this account is not an administrator */}
              {!u.is_platform_admin && u.env_admin ? <Chip tone="neutral">نشانی مالک سامانه، بدون دسترسی مدیر</Chip> : null}
              {u.disabled ? <Chip tone="danger">غیرفعال</Chip> : <Chip tone="in">فعال</Chip>}
              {!u.has_recovery ? <Chip tone="neutral">بدون کد بازیابی</Chip> : null}
            </span>
          </div>
          <dl className="ad-dl">
            <dt>ساخته‌شده</dt>
            <dd>
              <When v={u.created_at} />
            </dd>
            <dt>آخرین ورود</dt>
            <dd>{u.last_login_at ? <When v={u.last_login_at} /> : "هرگز"}</dd>
            {u.mobile ? (
              <>
                <dt>موبایل</dt>
                <dd>
                  <bdi dir="ltr" className="ds-latin">
                    {u.mobile}
                  </bdi>
                </dd>
              </>
            ) : null}
          </dl>
          <div className="ad-bar">
            {u.disabled ? (
              <Button icon={<UserCheck {...ICON14} />} onClick={() => run(() => api.patch(`/admin/users/${id}`, { disabled: false }), "حساب فعال شد.")}>
                فعال کردن
              </Button>
            ) : (
              <Button
                danger
                icon={<UserX {...ICON14} />}
                disabled={self || (u.is_platform_admin && u.env_admin)}
                onClick={async () => {
                  if (await n.confirm(`غیرفعال کردن ${u.full_name}؟`, "از همهٔ دستگاه‌ها خارج می‌شود و دیگر نمی‌تواند وارد شود.", true, "غیرفعال کن"))
                    await run(() => api.patch(`/admin/users/${id}`, { disabled: true }), "حساب غیرفعال شد.");
                }}
              >
                غیرفعال کردن
              </Button>
            )}
            <Button
              icon={<LogOut {...ICON14} />}
              onClick={async () => {
                if (await n.confirm(`خروج ${u.full_name} از همهٔ دستگاه‌ها؟`, self ? "این نشست شما هم بسته می‌شود." : "برای ادامه باید دوباره وارد شود."))
                  await run(() => api.post(`/admin/users/${id}/sign-out`), "از همهٔ دستگاه‌ها خارج شد.");
              }}
            >
              خروج از همهٔ دستگاه‌ها
            </Button>
            {/* an admin's password is changed by himself (or with his recovery code), never from here */}
            <Tooltip title={!self && !u.is_platform_admin && u.recently_admin ? "دسترسی مدیر سامانه به‌تازگی از این حساب گرفته شده است" : undefined}>
              <Button icon={<KeyRound {...ICON14} />} disabled={self || u.is_platform_admin || u.env_admin || !!u.recently_admin} onClick={() => setPw(true)}>
                رمز موقت
              </Button>
            </Tooltip>
            {u.is_platform_admin ? (
              <Tooltip title={self ? "دسترسی خودتان را نمی‌توانید بردارید" : u.env_admin ? "این ایمیل در PLATFORM_ADMIN_EMAILS است" : undefined}>
                <Button
                  icon={<ShieldOff {...ICON14} />}
                  disabled={self || u.env_admin}
                  onClick={async () => {
                    if (await n.confirm(`گرفتن دسترسی مدیر سامانه از ${u.full_name}؟`, "حالت‌های پشتیبانی در جریانش هم پایان می‌یابد.", true, "بگیر"))
                      await run(() => api.post(`/admin/users/${id}/platform-admin`, { granted: false }), "دسترسی مدیر سامانه گرفته شد.");
                  }}
                >
                  گرفتن دسترسی مدیر
                </Button>
              </Tooltip>
            ) : (
              <Button
                icon={<ShieldCheck {...ICON14} />}
                disabled={u.disabled}
                onClick={async () => {
                  if (await n.confirm(`${u.full_name} مدیر سامانه شود؟`, "به همهٔ کاربران، سازمان‌ها و حالت پشتیبانی دسترسی پیدا می‌کند."))
                    await run(() => api.post(`/admin/users/${id}/platform-admin`, { granted: true }), "دسترسی مدیر سامانه داده شد.");
                }}
              >
                مدیر سامانه
              </Button>
            )}
          </div>

          <Card title="سازمان‌ها" flush>
            {d.memberships.length ? (
              <ul className="ad-list">
                {d.memberships.map((m) => (
                  <li key={m.id}>
                    <span className="ad-li-main">
                      <Link to={`/admin/orgs/${m.org_id}`} className="ad-li-t ds-link">
                        {m.org_name}
                      </Link>
                      <span className="ad-li-d">
                        {ROLES[m.role]?.title ?? m.role}
                        {m.title ? ` · ${m.title}` : ""}
                        {m.is_active ? "" : " · غیرفعال"}
                      </span>
                    </span>
                    {m.org_status !== "active" ? <StatusChip s={m.org_status} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">عضو سازمانی نیست.</p>
            )}
          </Card>

          <Card title="نشست‌های باز" meta={<span className="ad-sub ds-num">{fa(d.sessions.length)}</span>} flush>
            {d.sessions.length ? (
              <ul className="ad-list">
                {d.sessions.map((s) => (
                  <li key={s.id}>
                    <span className="ad-li-main">
                      <span className="ad-li-t">{s.kind === "device" ? (s.device_name ?? "برنامهٔ ویندوز") : browser(s.user_agent) || "مرورگر"}</span>
                      <span className="ad-li-d">
                        <bdi dir="ltr" className="ds-latin">
                          {s.ip ?? ""}
                        </bdi>
                        {` · آغاز ${ago(s.created_at)}`}
                      </span>
                    </span>
                    <span className="ad-li-end">{ago(s.last_seen_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">نشست بازی ندارد.</p>
            )}
          </Card>

          <Card title="رویدادهای امنیتی" tools={<Link to={`/admin/security?user=${id}`} className="ds-link text-[13px]">همه</Link>} flush>
            {d.events.length ? (
              <ul className="ad-list">
                {d.events.slice(0, 12).map((e) => (
                  <li key={e.id}>
                    <span className="ad-li-main">
                      <span className="ad-li-t">
                        {EVENT_KIND[e.kind] ?? e.kind}
                        {e.ok ? null : <span className="text-danger"> · ناموفق</span>}
                      </span>
                      <span className="ad-li-d">{[e.org_name, eventDetail(e), e.ip].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="ad-li-end">
                      <When v={e.at} block />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">رویدادی ثبت نشده است.</p>
            )}
          </Card>
          <TempPassword user={u} open={pw} onClose={() => setPw(false)} />
        </div>
      )}
    </Drawer>
  );
}

export default function Users({ openId }: { openId: string | null }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const dq = useDebounced(q);
  const phone = useIsPhone();
  const nav = useNavigate();
  const list = useAdminQuery<{ users: UserRow[] }>(["users", dq, filter], "/admin/users", { q: dq || undefined, filter: filter || undefined });
  const rows = list.data?.users ?? [];
  return (
    <div>
      <PageHeader title="کاربران" subtitle={list.data ? `${fa(rows.length)} حساب` : undefined} />
      <div className="bk-card">
        <div className="ad-filters">
          <Input allowClear prefix={<Search {...ICON} className="text-ink-3" />} placeholder="نام، ایمیل یا موبایل" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی کاربر" />
          <Segmented
            value={filter}
            onChange={(v) => setFilter(String(v))}
            options={[
              { value: "", label: "همه" },
              { value: "admins", label: "مدیران سامانه" },
              { value: "disabled", label: "غیرفعال" },
              { value: "inactive", label: "بی‌فعالیت" },
              { value: "never", label: "هرگز وارد نشده" },
            ]}
          />
        </div>
        <Table<UserRow>
          className="bk-tbl"
          size="middle"
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 50, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
          scroll={phone ? undefined : { x: 900 }}
          onRow={(r) => ({ onClick: () => nav(`/admin/users/${r.id}`), className: "cursor-pointer" })}
          locale={{ emptyText: list.isLoading ? " " : <EmptyState icon={UsersIcon} title={dq || filter ? "کاربری با این شرایط نیست" : "هنوز حسابی ساخته نشده است"} /> }}
          columns={
            phone
              ? [
                  {
                    key: "m",
                    title: "کاربر",
                    render: (_, r) => (
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{r.full_name}</div>
                          <bdi dir="ltr" className="ds-latin ad-sub block truncate">
                            {r.email}
                          </bdi>
                        </div>
                        {r.disabled ? <Chip tone="danger">غیرفعال</Chip> : r.is_platform_admin ? <Chip tone="accent">مدیر</Chip> : null}
                      </div>
                    ),
                  },
                ]
              : [
                  {
                    key: "n",
                    title: "کاربر",
                    render: (_, r) => (
                      <span className="block min-w-0">
                        <span className="flex items-center gap-2 font-medium">
                          {r.full_name}
                          {r.is_platform_admin ? <Chip tone="accent">مدیر سامانه</Chip> : null}
                        </span>
                        <bdi dir="ltr" className="ds-latin ad-sub block truncate">
                          {r.email}
                        </bdi>
                      </span>
                    ),
                  },
                  { key: "o", dataIndex: "orgs", title: "سازمان", width: 90, className: "ds-num", render: (v) => fa(v) },
                  { key: "s", dataIndex: "sessions", title: "نشست باز", width: 90, className: "ds-num", render: (v) => fa(v) },
                  { key: "seen", dataIndex: "last_seen_at", title: "آخرین فعالیت", width: 140, render: (v) => <span className="text-ink-2">{ago(v)}</span> },
                  { key: "f", dataIndex: "failed_24h", title: "ورود ناموفق", width: 100, className: "ds-num", render: (v) => (v ? <span className="text-danger">{fa(v)}</span> : <span className="text-ink-3">—</span>) },
                  { key: "st", dataIndex: "disabled", title: "وضعیت", width: 100, render: (v) => (v ? <Chip tone="danger">غیرفعال</Chip> : <Chip tone="in">فعال</Chip>) },
                ]
          }
        />
      </div>
      {openId ? <UserSheet key={openId} id={openId} onClose={() => nav("/admin/users")} /> : null}
    </div>
  );
}

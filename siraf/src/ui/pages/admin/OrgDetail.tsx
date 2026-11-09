// One business in «مدیریت سامانه»: platform metadata only (never its documents): profile, owners and members,
// sizes, Windows apps, AI status, platform status with its reason, the AI switch, internal notes, support
// sessions and security events. «حالت پشتیبانی» opens the business itself.
import { useEffect, useState } from "react";
import { Button, Form, Input, Segmented, Switch, Tooltip } from "antd";
import { Building2, LifeBuoy, LogIn } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { Card, Note } from "../../modules/reports/kit";
import { api, ApiError } from "../../lib/api";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { ENTITIES } from "@shared/entities";
import { ROLES, type Role } from "@shared/permissions";
import type { AiAdminOverview } from "@shared/ai/api";
import { SupportDialog } from "./SupportDialog";
import { timeLeft } from "../../components/shell/SupportBanner";
import { ICON, EVENT_KIND, LoadFailed, Mods, ORG_STATUS, StatusChip, When, ago, bytes, eventDetail, kindTitle, usd, useAdminQuery, type OrgStatus, type SecurityEvent } from "./ui";

interface SupportRow {
  id: string;
  admin_user_id: string;
  admin_name: string | null;
  level: "view" | "edit";
  reason: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  state: "active" | "ended" | "expired";
}

interface Detail {
  org: { id: string; name: string; legal_name: string | null; business_kind: string; modules: string[]; base_currency: string; province: string | null; city: string | null; phone: string | null; mobile: string | null; email: string | null; created_at: string };
  admin: { status: OrgStatus; status_reason: string | null; notes: string | null; ai_disabled: boolean; updated_at: string | null; updated_by_name: string | null };
  members: { id: string; user_id: string; role: Role; title: string | null; is_active: boolean; full_name: string; email: string; mobile: string | null; last_login_at: string | null; disabled: boolean }[];
  devices: { id: string; name: string; platform: string | null; app_version: string | null; last_push_at: string | null; last_pull_at: string | null; revoked_at: string | null; user_name: string | null }[];
  last_activity: string | null;
  sizes: { total_bytes: number; items: { entity: string; rows: number; bytes: number }[] };
  support: { active: SupportRow | null; sessions: SupportRow[] };
  events: SecurityEvent[];
  is_member: boolean;
}

const SIZE_NAME: Record<string, string> = { audit: "گزارش رویدادها", voucher: "اسناد حسابداری", invoice: "فاکتورها", gold_doc: "اسناد طلا", fx_deal: "معاملات ارز", treasury_doc: "اسناد خزانه" };
const sizeName = (e: string) => SIZE_NAME[e] ?? ENTITIES[e]?.plural ?? e;

function AiStatus({ orgId, disabled }: { orgId: string; disabled: boolean }) {
  const q = useQuery({
    queryKey: ["admin", "ai", "overview"],
    queryFn: () => api.get<AiAdminOverview>("/admin/ai/overview"),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (q.isLoading) return <Skeleton rows={2} />;
  const b = q.data?.businesses?.find((x) => x.org_id === orgId);
  if (!q.data) return <p className="m-0 text-[13px] text-ink-3">گزارش هوش مصنوعی هنوز در دسترس نیست.</p>;
  if (!b || !b.connections)
    return <p className="m-0 text-[13px] text-ink-3">{disabled ? "هوش مصنوعی این کسب‌وکار خاموش است." : "این کسب‌وکار هنوز کلید هوش مصنوعی نگذاشته است."}</p>;
  return (
    <dl className="ad-dl">
      <dt>اتصال‌ها</dt>
      <dd>
        <span className="sf-num">{fa(b.connections)}</span> · <span className="sf-latin">{b.presets.join("، ")}</span>
      </dd>
      <dt>وضعیت</dt>
      <dd>{disabled || b.disabled_by_platform ? <Chip tone="neutral">خاموش از سوی سامانه</Chip> : b.status === "error" ? <Chip tone="danger">خطا</Chip> : b.enabled ? <Chip tone="in">روشن</Chip> : <Chip tone="neutral">خاموش</Chip>}</dd>
      <dt>این ماه</dt>
      <dd>
        <span className="sf-num sf-latin">{usd(b.month.cost_usd)}</span> · <span className="sf-num">{fa(b.month.calls)}</span> درخواست · <span className="sf-num">{fa(b.users_month)}</span> نفر
      </dd>
      <dt>آخرین استفاده</dt>
      <dd>{ago(b.last_used_at)}</dd>
    </dl>
  );
}

function PlatformState({ d }: { d: Detail }) {
  const n = useNotify();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    form.setFieldsValue({ status: d.admin.status, status_reason: d.admin.status_reason ?? "", notes: d.admin.notes ?? "" });
  }, [d.admin, form]);
  const save = async (key: string, patch: Record<string, unknown>, done: string) => {
    setBusy(key);
    try {
      await api.patch(`/admin/orgs/${d.org.id}`, patch);
      n.ok(done);
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="وضعیت در سامانه">
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="status" label="وضعیت">
          <Segmented options={(Object.keys(ORG_STATUS) as OrgStatus[]).map((s) => ({ value: s, label: ORG_STATUS[s][0] }))} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) =>
            getFieldValue("status") !== "active" ? (
              <>
                <p className="-mt-3 mb-3 text-[13px] leading-5 text-ink-3">
                  {getFieldValue("status") === "suspended" ? "اعضا دیگر به این کسب‌وکار دسترسی ندارند." : "اعضا همه‌چیز را می‌بینند ولی تغییری ثبت نمی‌شود."} دلیل را اعضا می‌بینند.
                </p>
                <Form.Item name="status_reason" label="دلیل" rules={[{ required: true, message: "دلیل را بنویسید." }]}>
                  <Input maxLength={300} />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
        <Button
          loading={busy === "status"}
          onClick={async () => {
            const v = await form.validateFields(["status", "status_reason"]);
            await save("status", { status: v.status, status_reason: v.status_reason ?? null }, "وضعیت ذخیره شد.");
          }}
        >
          ذخیرهٔ وضعیت
        </Button>
        <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
          <Switch
            checked={!d.admin.ai_disabled}
            loading={busy === "ai"}
            onChange={(on) => save("ai", { ai_disabled: !on }, on ? "هوش مصنوعی روشن شد." : "هوش مصنوعی خاموش شد.")}
            aria-label="هوش مصنوعی این کسب‌وکار"
          />
          <span>
            <span className="block">هوش مصنوعی</span>
            <span className="ad-sub">خاموش کردن، همهٔ درخواست‌های هوش مصنوعی این کسب‌وکار را متوقف می‌کند.</span>
          </span>
        </div>
        <Form.Item name="notes" label="یادداشت داخلی" className="!mb-3 mt-5" extra="فقط مدیران سامانه می‌بینند.">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} maxLength={4000} />
        </Form.Item>
        <Button loading={busy === "notes"} onClick={() => save("notes", { notes: form.getFieldValue("notes") ?? "" }, "یادداشت ذخیره شد.")}>
          ذخیرهٔ یادداشت
        </Button>
        {d.admin.updated_at ? (
          <p className="ad-sub mb-0 mt-3">
            آخرین تغییر: <When v={d.admin.updated_at} />
            {d.admin.updated_by_name ? ` · ${d.admin.updated_by_name}` : ""}
          </p>
        ) : null}
      </Form>
    </Card>
  );
}

export default function OrgDetail({ id }: { id: string }) {
  const q = useAdminQuery<Detail>(["org", id], `/admin/orgs/${id}`);
  const nav = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const d = q.data;
  if (q.error && !d)
    return (
      <div>
        <PageHeader title="کسب‌وکار" back="/admin/orgs" />
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={Building2} title="این کسب‌وکار پیدا نشد" action={<Button onClick={() => nav("/admin/orgs")}>فهرست کسب‌وکارها</Button>} />
        ) : (
          <LoadFailed error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
        )}
      </div>
    );
  if (!d)
    return (
      <div>
        <PageHeader title="کسب‌وکار" back="/admin/orgs" />
        <Skeleton rows={8} />
      </div>
    );
  const live = d.support.active;
  const end = async (sid: string) => {
    try {
      await api.post(`/admin/support/${sid}/end`);
      n.ok("حالت پشتیبانی پایان یافت.");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (e) {
      n.error(e);
    }
  };
  const owners = d.members.filter((m) => m.role === "owner" && m.is_active);
  return (
    <div>
      <PageHeader
        title={d.org.name}
        back="/admin/orgs"
        subtitle={<StatusChip s={d.admin.status} />}
        actions={
          d.is_member ? (
            <Button type="primary" icon={<LogIn {...ICON} />} onClick={() => nav(`/${d.org.id}`)}>
              باز کردن
            </Button>
          ) : live ? (
            <>
              <Button onClick={() => end(live.id)}>پایان پشتیبانی</Button>
              <Button type="primary" icon={<LogIn {...ICON} />} onClick={() => nav(`/${d.org.id}`)}>
                ادامهٔ پشتیبانی
              </Button>
            </>
          ) : (
            <Button type="primary" icon={<LifeBuoy {...ICON} />} onClick={() => setDialog(true)}>
              حالت پشتیبانی
            </Button>
          )
        }
      />
      {live ? (
        <Note tone="warning" className="mb-4">
          <b>حالت پشتیبانی در جریان است</b> ({live.level === "edit" ? "مشاهده و اصلاح" : "فقط مشاهده"}، {timeLeft(new Date(live.expires_at).getTime() - Date.now())} مانده).
        </Note>
      ) : null}
      {d.admin.status !== "active" && d.admin.status_reason ? (
        <Note tone={d.admin.status === "suspended" ? "danger" : "warning"} className="mb-4">
          <b>{ORG_STATUS[d.admin.status][0]}:</b> {d.admin.status_reason}
        </Note>
      ) : null}

      <div className="ad-grid !mt-0">
        <div className="ad-stack">
          <Card title="مشخصات">
            <dl className="ad-dl">
              <dt>نوع</dt>
              <dd>{kindTitle(d.org.business_kind)}</dd>
              {d.org.legal_name ? (
                <>
                  <dt>نام حقوقی</dt>
                  <dd>{d.org.legal_name}</dd>
                </>
              ) : null}
              <dt>بخش‌ها</dt>
              <dd>
                <Mods list={d.org.modules} />
              </dd>
              <dt>ساخته‌شده</dt>
              <dd>
                <When v={d.org.created_at} />
              </dd>
              <dt>آخرین فعالیت</dt>
              <dd>{ago(d.last_activity)}</dd>
              <dt>مالک</dt>
              <dd>
                {owners.length
                  ? owners.map((o) => (
                      <span key={o.id} className="block">
                        {o.full_name} ·{" "}
                        <bdi dir="ltr" className="sf-latin">
                          {o.mobile ?? o.email}
                        </bdi>
                      </span>
                    ))
                  : "—"}
              </dd>
              {d.org.phone || d.org.mobile || d.org.email ? (
                <>
                  <dt>تماس</dt>
                  <dd>
                    <bdi dir="ltr" className="sf-latin">
                      {[d.org.mobile, d.org.phone, d.org.email].filter(Boolean).join(" · ")}
                    </bdi>
                  </dd>
                </>
              ) : null}
              {d.org.city ? (
                <>
                  <dt>شهر</dt>
                  <dd>{[d.org.province, d.org.city].filter(Boolean).join("، ")}</dd>
                </>
              ) : null}
            </dl>
          </Card>

          <Card title="اعضا" meta={<span className="ad-sub sf-num">{fa(d.members.length)}</span>} flush>
            <ul className="ad-list">
              {d.members.map((m) => (
                <li key={m.id}>
                  <span className="ad-li-main">
                    <Link to={`/admin/users/${m.user_id}`} className="ad-li-t sf-link">
                      {m.full_name}
                    </Link>
                    <bdi dir="ltr" className="sf-latin ad-li-d">
                      {m.email}
                    </bdi>
                  </span>
                  {!m.is_active ? <Chip tone="neutral">غیرفعال</Chip> : m.disabled ? <Chip tone="danger">حساب بسته</Chip> : null}
                  <span className="ad-li-end text-end">
                    <span className="block text-ink-2">{ROLES[m.role]?.title ?? m.role}</span>
                    <span className="block text-[12px]">{ago(m.last_login_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="حالت پشتیبانی" flush>
            {d.support.sessions.length ? (
              <ul className="ad-list">
                {d.support.sessions.map((s) => (
                  <li key={s.id}>
                    <span className="ad-tone" data-tone={s.state === "active" ? "warning" : undefined} aria-hidden>
                      <LifeBuoy {...ICON} />
                    </span>
                    <span className="ad-li-main">
                      <Tooltip title={s.reason}>
                        <span className="ad-li-t">{s.reason}</span>
                      </Tooltip>
                      <span className="ad-li-d">
                        {s.admin_name} · {s.level === "edit" ? "مشاهده و اصلاح" : "فقط مشاهده"} · {s.state === "active" ? "در جریان" : s.state === "ended" ? "پایان‌یافته" : "سرآمده"}
                      </span>
                    </span>
                    <span className="ad-li-end">
                      <When v={s.started_at} block />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">تاکنون حالت پشتیبانی در این کسب‌وکار آغاز نشده است.</p>
            )}
          </Card>
        </div>

        <div className="ad-stack">
          <PlatformState d={d} />
          <Card title="هوش مصنوعی">
            <AiStatus orgId={d.org.id} disabled={d.admin.ai_disabled} />
          </Card>
          <Card title="حجم داده" meta={<span className="ad-sub">{bytes(d.sizes.total_bytes)}</span>} flush>
            {d.sizes.items.length ? (
              <ul className="ad-list">
                {d.sizes.items.slice(0, 8).map((s) => (
                  <li key={s.entity}>
                    <span className="ad-li-main">
                      <span className="ad-li-t">{sizeName(s.entity)}</span>
                    </span>
                    <span className="ad-li-end">
                      <span className="sf-num">{fa(s.rows)}</span> ردیف · <span className="sf-num">{bytes(s.bytes)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">هنوز داده‌ای ثبت نشده است.</p>
            )}
          </Card>
          <Card title="برنامهٔ ویندوز" flush>
            {d.devices.length ? (
              <ul className="ad-list">
                {d.devices.map((v) => (
                  <li key={v.id}>
                    <span className="ad-li-main">
                      <span className="ad-li-t">{v.name || "رایانهٔ بی‌نام"}</span>
                      <span className="ad-li-d">
                        {v.user_name ?? "—"}
                        {v.app_version ? ` · نسخهٔ ${v.app_version}` : ""}
                        {v.revoked_at ? " · لغوشده" : ""}
                      </span>
                    </span>
                    <span className="ad-li-end">{ago(v.last_push_at && v.last_pull_at ? (v.last_push_at > v.last_pull_at ? v.last_push_at : v.last_pull_at) : (v.last_push_at ?? v.last_pull_at))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">برنامهٔ ویندوزی به این کسب‌وکار وصل نیست.</p>
            )}
          </Card>
          <Card title="رویدادهای امنیتی" tools={<Link to={`/admin/security?org=${d.org.id}`} className="sf-link text-[13px]">همه</Link>} flush>
            {d.events.length ? (
              <ul className="ad-list">
                {d.events.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <span className="ad-li-main">
                      <span className="ad-li-t">
                        {EVENT_KIND[e.kind] ?? e.kind}
                        {e.ok ? null : <span className="text-danger"> · ناموفق</span>}
                      </span>
                      <span className="ad-li-d">{[e.user_name ?? e.email, eventDetail(e)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="ad-li-end">{ago(e.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 px-5 py-4 text-[13px] text-ink-3">رویدادی ثبت نشده است.</p>
            )}
          </Card>
        </div>
      </div>
      <SupportDialog org={d.org} open={dialog} onClose={() => setDialog(false)} />
    </div>
  );
}

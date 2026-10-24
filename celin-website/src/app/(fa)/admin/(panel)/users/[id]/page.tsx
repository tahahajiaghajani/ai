import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { listMembers } from "@/lib/members";
import { listOrders } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { formatDate, formatPhone, formatPrice, num } from "@/lib/format";
import { Badge, Card, DbMissing, PageHeader } from "@/components/admin/ui";
import { ProCodeProvider } from "@/components/admin/pro-code-dialog";
import { ExtendCodeButton, IssueCodeButton, RevealCodeButton, RevokeCodeButton } from "@/components/admin/pro-actions";
import { DangerCard, ProfileForm, SecurityCard } from "@/components/admin/users-detail";
import { OrdersList } from "@/components/admin/orders-list";
import { ProBadge, Row, whatsappUrl } from "@/components/admin/sales-ui";
import { Icon } from "@/components/ui/icons";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const members = await listMembers();
  if (!members) {
    return (
      <>
        <PageHeader title="کاربر" back={{ href: "/admin/users", label: "کاربران" }} />
        <DbMissing />
      </>
    );
  }
  const m = members.find((x) => x.id === id);
  if (!m) notFound();
  const [orders, settings] = await Promise.all([listOrders(m.id), getSettings()]);
  const defaultDays = settings.pro.defaultDays;
  const open = m.pro.code_id && (m.pro.state === "active" || m.pro.state === "issued" || m.pro.state === "expired");
  const profile = { name: m.name, phone: m.phone, email: m.email, business: m.business, city: m.city, address: m.address, postal_code: m.postal_code, admin_note: m.admin_note };

  return (
    <ProCodeProvider siteUrl={env.siteUrl}>
      <PageHeader
        title={m.name || "بدون نام"}
        back={{ href: "/admin/users", label: "کاربران" }}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="ltr">{formatPhone(m.phone, "fa")}</span>
            <span>عضویت {formatDate(m.created_at, "fa")}</span>
            {m.last_sign_in_at && <span>آخرین ورود {formatDate(m.last_sign_in_at, "fa", true)}</span>}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {m.role === "admin" && <Badge tone="ink">مدیر</Badge>}
            {m.disabled && <Badge tone="danger">غیرفعال</Badge>}
            {m.created_by_admin && <Badge>ساخته‌شده در پنل</Badge>}
            <ProBadge state={m.pro.state} />
          </div>
        }
      />

      {/* phone: Pro and contact first, then the profile, orders and security */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="contents min-w-0 lg:block lg:space-y-6">
          <div className="order-3 lg:order-none">
            <ProfileForm key={JSON.stringify(profile)} id={m.id} initial={profile} />
          </div>
          <div className="order-4 lg:order-none">
            <Card title="سفارش‌ها" sub={m.orders ? `${num(m.orders, "fa")} سفارش · جمع خرید ${formatPrice(m.spent, "fa")}` : undefined} padded={!orders.length}>
              {orders.length ? <OrdersList orders={orders} variant="member" bare /> : <p className="text-sm text-muted">این عضو هنوز سفارشی ثبت نکرده است.</p>}
            </Card>
          </div>
        </div>

        <div className="contents min-w-0 lg:block lg:space-y-6">
          <div className="order-1 lg:order-none">
            <Card title="اشتراک Pro">
              <div className="flex items-center justify-between gap-3">
                <ProBadge state={m.pro.state} />
                {m.pro.hint && (
                  <span className="text-xs text-muted">
                    <span className="ltr font-mono tabular-nums">•••• •••• {m.pro.hint}</span>
                  </span>
                )}
              </div>
              <div className="mt-3 divide-y divide-line border-t border-line">
                <Row label="اعتبار">{m.pro.state === "none" ? "—" : m.pro.expires_at ? `تا ${formatDate(m.pro.expires_at, "fa")}` : "بدون انقضا"}</Row>
                {m.pro.state === "issued" && <Row label="وضعیت">عضو هنوز کد را وارد نکرده است.</Row>}
              </div>
              {m.pending_request && (
                <Link href="/admin/pro" className="mt-3 flex items-center justify-between gap-3 border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning">
                  درخواست Pro در انتظار بررسی است
                  <Icon name="chevron" className="size-3.5 rotate-180" />
                </Link>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {open && m.pro.code_id && <RevealCodeButton codeId={m.pro.code_id} name={m.name} phone={m.phone} />}
                {open && m.pro.code_id && <ExtendCodeButton codeId={m.pro.code_id} name={m.name} defaultDays={defaultDays} />}
                {open && m.pro.code_id && m.pro.state !== "expired" && <RevokeCodeButton codeId={m.pro.code_id} />}
                <IssueCodeButton
                  userId={m.id}
                  name={m.name}
                  phone={m.phone}
                  defaultDays={defaultDays}
                  replaces={Boolean(open)}
                  variant={open ? "secondary" : "gold"}
                  label={open ? "کد تازه" : "صدور کد Pro"}
                />
              </div>
            </Card>
          </div>

          <div className="order-2 lg:order-none">
            <Card title="تماس">
              <div className="flex flex-wrap gap-2">
                <a href={`tel:${m.phone}`} className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-3 text-sm hover:border-ink">
                  <Icon name="phone" className="size-4" />
                  تماس
                </a>
                <a href={whatsappUrl(m.phone)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-3 text-sm hover:border-ink">
                  <Icon name="whatsapp" className="size-4" />
                  واتس‌اپ
                </a>
                {m.email && (
                  <a href={`mailto:${m.email}`} className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-3 text-sm hover:border-ink">
                    <Icon name="mail" className="size-4" />
                    ایمیل
                  </a>
                )}
              </div>
            </Card>
          </div>

          <div className="order-5 lg:order-none">
            <SecurityCard id={m.id} hasPassword={m.has_password} disabled={m.disabled} admin={m.role === "admin"} promoteBlock={m.promote_block} name={m.name} phone={formatPhone(m.phone, "fa")} />
          </div>
          <div className="order-6 lg:order-none">
            <DangerCard id={m.id} orders={m.orders} />
          </div>
        </div>
      </div>
    </ProCodeProvider>
  );
}

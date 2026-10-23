import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { listMembers, type MemberRow } from "@/lib/members";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { formatDate, formatPhone, formatPrice, latinDigits, num } from "@/lib/format";
import { Badge, DbMissing, Empty, LinkButton, PageHeader, Tabs } from "@/components/admin/ui";
import { ProCodeProvider } from "@/components/admin/pro-code-dialog";
import { CreateMemberButton } from "@/components/admin/users-create";
import { ProBadge, SearchBox } from "@/components/admin/sales-ui";

const FILTERS: { key: string; label: string; test: (m: MemberRow) => boolean }[] = [
  { key: "", label: "همه", test: () => true },
  { key: "pro", label: "Pro فعال", test: (m: MemberRow) => m.pro.state === "active" },
  { key: "nopro", label: "بدون Pro", test: (m: MemberRow) => m.pro.state !== "active" && m.pro.state !== "issued" },
  { key: "request", label: "درخواست در انتظار", test: (m: MemberRow) => m.pending_request },
  { key: "admin", label: "مدیر", test: (m: MemberRow) => m.role === "admin" },
  { key: "disabled", label: "غیرفعال", test: (m: MemberRow) => m.disabled },
];

function matches(m: MemberRow, q: string): boolean {
  if (!q) return true;
  const t = latinDigits(q).toLowerCase().trim();
  const digits = t.replace(/[\s\-+]/g, "");
  if (/^\d{3,}$/.test(digits)) {
    const d = digits.replace(/^(0098|98)/, "0");
    return m.phone.includes(d) || m.phone.includes(digits);
  }
  return [m.name, m.business, m.city, m.email].some((v) => v.toLowerCase().includes(t));
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const f = FILTERS.find((x) => x.key === sp.f) ?? FILTERS[0];
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const [members, settings] = await Promise.all([listMembers(), getSettings()]);
  if (!members) {
    return (
      <>
        <PageHeader title="کاربران" />
        <DbMissing />
      </>
    );
  }
  const found = members.filter((m) => matches(m, q));
  const rows = found.filter((m) => f.test(m));
  const href = (k: string) => {
    const p = new URLSearchParams();
    if (k) p.set("f", k);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/admin/users?${s}` : "/admin/users";
  };

  return (
    <ProCodeProvider siteUrl={env.siteUrl}>
      <PageHeader title="کاربران" sub={`${num(members.length, "fa")} حساب`} actions={<CreateMemberButton defaultDays={settings.pro.defaultDays} />} />
      <Tabs active={f.key} items={FILTERS.map((x) => ({ key: x.key, label: x.label, href: href(x.key), count: x.key ? found.filter((m) => x.test(m)).length : undefined }))} />
      <div className="mb-5">
        <SearchBox action="/admin/users" q={q} placeholder="نام، موبایل یا کسب‌وکار" keep={{ f: f.key }} />
      </div>
      {rows.length ? (
        <MembersList rows={rows} />
      ) : q ? (
        <Empty title="کاربری پیدا نشد" action={<LinkButton href={f.key ? `/admin/users?f=${f.key}` : "/admin/users"}>پاک کردن جستجو</LinkButton>}>
          بخشی از نام، شماره‌ی موبایل یا نام کسب‌وکار را بنویسید.
        </Empty>
      ) : (
        <Empty title={members.length ? "در این فهرست کسی نیست" : "هنوز کاربری ثبت نشده است"}>
          {members.length ? "فیلتر دیگری را انتخاب کنید." : "اعضا با ثبت‌نام در سایت یا با «کاربر جدید» این‌جا اضافه می‌شوند."}
        </Empty>
      )}
    </ProCodeProvider>
  );
}

function MembersList({ rows }: { rows: MemberRow[] }) {
  const cols = "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_64px_minmax(0,1fr)_minmax(0,0.8fr)]";
  return (
    <div className="border border-line bg-white">
      <div className={`hidden gap-4 border-b border-line bg-bone/60 px-4 py-2.5 text-xs text-muted lg:grid ${cols}`}>
        <span>نام</span>
        <span>کسب‌وکار / شهر</span>
        <span>اشتراک</span>
        <span>سفارش</span>
        <span>جمع خرید</span>
        <span>عضویت</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((m) => (
          <li key={m.id}>
            <Link href={`/admin/users/${m.id}`} className={`grid gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-ground lg:items-center ${cols} ${m.disabled ? "opacity-60" : ""}`}>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{m.name || "بدون نام"}</span>
                    {m.role === "admin" && <Badge tone="ink">مدیر</Badge>}
                    {m.disabled && <Badge tone="danger">غیرفعال</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    <span className="ltr">{formatPhone(m.phone, "fa")}</span>
                  </div>
                </div>
                <span className="lg:hidden">
                  <ProBadge state={m.pro.state} />
                </span>
              </div>
              <div className="min-w-0 text-xs text-ink-2 lg:text-sm">
                <span className="truncate">{[m.business, m.city].filter(Boolean).join(" · ") || <span className="text-faint">—</span>}</span>
              </div>
              <div className="hidden lg:block">
                <div className="flex flex-wrap items-center gap-1.5">
                  <ProBadge state={m.pro.state} />
                  {m.pending_request && <Badge tone="warning">درخواست</Badge>}
                </div>
                {m.pro.expires_at && (m.pro.state === "active" || m.pro.state === "issued") && <div className="mt-1 text-[11px] text-muted">تا {formatDate(m.pro.expires_at, "fa")}</div>}
              </div>
              {/* phone: one line of numbers */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted lg:hidden">
                {m.pending_request && <Badge tone="warning">درخواست در انتظار</Badge>}
                <span>{num(m.orders, "fa")} سفارش</span>
                {m.spent > 0 && <span>{formatPrice(m.spent, "fa")}</span>}
                <span>عضویت {formatDate(m.created_at, "fa")}</span>
              </div>
              <span className="hidden text-sm lg:block">{num(m.orders, "fa")}</span>
              <span className="hidden text-sm lg:block">{m.spent ? formatPrice(m.spent, "fa") : "—"}</span>
              <span className="hidden text-xs text-muted lg:block">{formatDate(m.created_at, "fa")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

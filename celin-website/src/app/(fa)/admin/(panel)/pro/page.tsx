import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { listCodes, listRequests, type CodeListRow, type RequestRow } from "@/lib/members";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { formatDate, formatPhone, num } from "@/lib/format";
import { Badge, DbMissing, Empty, PageHeader, Tabs } from "@/components/admin/ui";
import { ProCodeProvider } from "@/components/admin/pro-code-dialog";
import { ApproveRequestButton, ExtendCodeButton, IssueCodeButton, RejectRequestButton, RevealCodeButton, RevokeCodeButton } from "@/components/admin/pro-actions";
import { KIND_LABEL, ProBadge } from "@/components/admin/sales-ui";
import { Icon } from "@/components/ui/icons";

export default async function ProPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const tab = sp.tab === "codes" ? "codes" : "requests";
  const [requests, codes, settings] = await Promise.all([listRequests(), listCodes(), getSettings()]);
  const defaultDays = settings.pro.defaultDays;
  if (!requests || !codes) {
    return (
      <>
        <PageHeader title="اشتراک Pro" />
        <DbMissing />
      </>
    );
  }
  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const decided = requests.filter((r) => r.status !== "pending");
  const live = codes.filter((c) => c.state === "active" || c.state === "issued").length;

  return (
    <ProCodeProvider siteUrl={env.siteUrl}>
      <PageHeader title="اشتراک Pro" sub={`${num(codes.filter((c) => c.state === "active").length, "fa")} عضو فعال`} />
      <Tabs
        active={tab}
        items={[
          { key: "requests", label: "درخواست‌ها", href: "/admin/pro", count: pending.length },
          { key: "codes", label: "کدها", href: "/admin/pro?tab=codes", count: live },
        ]}
      />
      {tab === "requests" ? <Requests pending={pending} decided={decided} defaultDays={defaultDays} /> : <Codes codes={codes} defaultDays={defaultDays} />}
    </ProCodeProvider>
  );
}

function Requests({ pending, decided, defaultDays }: { pending: RequestRow[]; decided: RequestRow[]; defaultDays: number }) {
  return (
    <div className="space-y-6">
      {pending.length ? (
        <ul className="space-y-3">
          {pending.map((r) => (
            <RequestCard key={r.id} r={r} defaultDays={defaultDays} />
          ))}
        </ul>
      ) : (
        <Empty title="درخواست تازه‌ای نیست">درخواست‌های اشتراک Pro که اعضا از سایت می‌فرستند، این‌جا برای تأیید نمایش داده می‌شوند.</Empty>
      )}
      {decided.length > 0 && (
        <details className="group border border-line bg-white">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm text-ink-2 [&::-webkit-details-marker]:hidden">
            <span>درخواست‌های بررسی‌شده ({num(decided.length, "fa")})</span>
            <Icon name="chevron-down" className="size-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm text-muted">
                <span className="min-w-0">
                  <Link href={`/admin/users/${r.user_id}`} className="font-medium text-ink-2 hover:text-ink">
                    {r.user?.name || "حساب حذف‌شده"}
                  </Link>
                  {r.business && <span> · {r.business}</span>}
                  {r.reply && <span className="block text-xs">پاسخ: {r.reply}</span>}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  <Badge tone={r.status === "approved" ? "success" : "neutral"}>{r.status === "approved" ? "تأیید شد" : "رد شد"}</Badge>
                  {r.decided_at && formatDate(r.decided_at, "fa")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RequestCard({ r, defaultDays }: { r: RequestRow; defaultDays: number }) {
  const u = r.user;
  const insta = r.instagram
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/\/.*$/, "");
  return (
    <li className="border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <Link href={`/admin/users/${r.user_id}`} className="text-base font-medium hover:text-gold-text">
            {u?.name || "—"}
          </Link>
          {u?.phone && (
            <div className="mt-0.5 text-sm text-muted">
              <a href={`tel:${u.phone}`} className="ltr hover:text-ink">
                {formatPhone(u.phone, "fa")}
              </a>
            </div>
          )}
        </div>
        <span className="text-xs text-muted">{formatDate(r.created_at, "fa", true)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-[11px] text-muted">کسب‌وکار</dt>
          <dd>{r.business || u?.business || "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">شهر</dt>
          <dd>{r.city || u?.city || "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">نوع فعالیت</dt>
          <dd>{KIND_LABEL[r.kind] ?? r.kind}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted">اینستاگرام</dt>
          <dd>
            {insta ? (
              <a href={`https://instagram.com/${encodeURIComponent(insta)}`} target="_blank" rel="noreferrer" className="ltr text-gold-text hover:underline">
                @{insta}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {r.note && (
          <div className="col-span-2 lg:col-span-4">
            <dt className="text-[11px] text-muted">توضیح</dt>
            <dd className="leading-7 whitespace-pre-line">{r.note}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
        <ApproveRequestButton id={r.id} userId={r.user_id} name={u?.name ?? ""} phone={u?.phone ?? ""} defaultDays={defaultDays} size="md" />
        <RejectRequestButton id={r.id} name={u?.name ?? ""} size="md" />
      </div>
    </li>
  );
}

function Codes({ codes, defaultDays }: { codes: CodeListRow[]; defaultDays: number }) {
  if (!codes.length) return <Empty title="هنوز کدی صادر نشده است">با تأیید یک درخواست یا از صفحه‌ی هر کاربر، کد اشتراک Pro صادر می‌شود.</Empty>;
  // the newest code of each member (only there a fresh code is offered)
  const latest = new Set<string>();
  const seen = new Set<string>();
  for (const c of codes) if (!seen.has(c.user_id)) (seen.add(c.user_id), latest.add(c.id));
  const cols = "lg:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]";
  return (
    <div className="border border-line bg-white">
      <div className={`hidden gap-4 border-b border-line bg-bone/60 px-4 py-2.5 text-xs text-muted lg:grid ${cols}`}>
        <span>عضو</span>
        <span>کد</span>
        <span>وضعیت</span>
        <span>انقضا</span>
        <span>آخرین استفاده</span>
        <span className="w-[272px]" />
      </div>
      <ul className="divide-y divide-line">
        {codes.map((c) => {
          const open = c.state !== "revoked";
          const name = c.user?.name ?? "";
          const phone = c.user?.phone ?? "";
          return (
            <li key={c.id} className={`grid gap-3 px-4 py-3.5 lg:items-center lg:gap-4 ${cols} ${open ? "" : "bg-ground/60"}`}>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin/users/${c.user_id}`} className={`block truncate text-sm font-medium hover:text-gold-text ${open ? "" : "text-muted"}`}>
                    {name || "—"}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    <span className="ltr">{formatPhone(phone, "fa")}</span>
                    <span className="lg:hidden"> · صادر {formatDate(c.created_at, "fa")}</span>
                  </div>
                </div>
                <span className="lg:hidden">
                  <ProBadge state={c.state} />
                </span>
              </div>
              <span className="text-xs text-muted">
                <span className="ltr font-mono tabular-nums">•••• •••• {c.hint}</span>
              </span>
              <span className="hidden lg:block">
                <ProBadge state={c.state} />
                <span className="mt-1 block text-[11px] text-muted">صادر {formatDate(c.created_at, "fa")}</span>
              </span>
              <span className="text-xs text-ink-2">
                <span className="text-muted lg:hidden">انقضا: </span>
                {c.revoked_at ? `باطل ${formatDate(c.revoked_at, "fa")}` : c.expires_at ? formatDate(c.expires_at, "fa") : "بدون انقضا"}
              </span>
              <span className="text-xs text-ink-2">
                <span className="text-muted lg:hidden">آخرین استفاده: </span>
                {c.last_used_at ? formatDate(c.last_used_at, "fa", true) : c.redeemed_at ? formatDate(c.redeemed_at, "fa", true) : "هنوز وارد نشده"}
              </span>
              <div className="flex flex-wrap gap-2 lg:w-[272px] lg:justify-end">
                {open && <RevealCodeButton codeId={c.id} userId={c.user_id} name={name} phone={phone} />}
                {open && <ExtendCodeButton codeId={c.id} name={name} defaultDays={defaultDays} />}
                {open && c.state !== "expired" && <RevokeCodeButton codeId={c.id} />}
                {latest.has(c.id) && (c.state === "revoked" || c.state === "expired") && (
                  <IssueCodeButton userId={c.user_id} name={name} phone={phone} defaultDays={defaultDays} replaces={c.state === "expired"} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
